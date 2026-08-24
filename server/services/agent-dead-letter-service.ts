/**
 * Agent Dead-Letter Queue (Priority 4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Catches unrecoverable job failures so nothing is silently lost.
 * Table is created via executeSql (no migration required).
 * Retry schedule: 5 min → 15 min → final_failed after max_retries.
 */

import { db, pool } from "../db";
import { sql } from "drizzle-orm";
import { CircuitOpenError, executeWithCircuitBreaker, jitteredDelayMs, type RetryRandom } from "./retry-reliability";
import { isShuttingDown, registerShutdownStop, trackBackgroundTask } from "./runtime-shutdown";
import { CURRENT_DURABLE_PAYLOAD_VERSION, normalizeDeadLetterPayload } from "./durable-payload-versioning";
import type { Pool, PoolClient } from "pg";
import { isRequiredFeatureSchemaReady } from "../required-feature-readiness-state";

let tableReady = false;
type SchemaExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export async function ensureAgentDeadLetterSchema(executor: SchemaExecutor = pool): Promise<void> {
  if (executor === pool && (tableReady || isRequiredFeatureSchemaReady())) return;
  try {
    await executor.query(`CREATE TABLE IF NOT EXISTS agent_dead_letter_queue (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        job_name    TEXT NOT NULL,
        org_id      TEXT,
        error_message TEXT NOT NULL,
        error_stack TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        next_retry_at TIMESTAMPTZ,
        final_failed_at TIMESTAMPTZ,
        status      TEXT NOT NULL DEFAULT 'pending',
        payload     JSONB,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )`);
    await executor.query(`ALTER TABLE agent_dead_letter_queue ALTER COLUMN org_id SET NOT NULL`);
    await executor.query(`ALTER TABLE agent_dead_letter_queue ADD COLUMN IF NOT EXISTS locked_by TEXT`);
    await executor.query(`ALTER TABLE agent_dead_letter_queue ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ`);
    await executor.query(`ALTER TABLE agent_dead_letter_queue ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`);
    await executor.query(`ALTER TABLE agent_dead_letter_queue ADD COLUMN IF NOT EXISTS execution_generation INTEGER NOT NULL DEFAULT 0`);
    await executor.query(`ALTER TABLE agent_dead_letter_queue ADD COLUMN IF NOT EXISTS replayed_by TEXT`);
    await executor.query(`ALTER TABLE agent_dead_letter_queue ADD COLUMN IF NOT EXISTS payload_version INTEGER NOT NULL DEFAULT 0`);
    await executor.query(`CREATE INDEX IF NOT EXISTS agent_dlq_due_idx ON agent_dead_letter_queue(status, next_retry_at, created_at)`);
    await executor.query(`CREATE TABLE IF NOT EXISTS agent_dead_letter_effects (
        dead_letter_id TEXT NOT NULL REFERENCES agent_dead_letter_queue(id),
        org_id TEXT NOT NULL,
        execution_generation INTEGER NOT NULL,
        effect_key TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'started',
        result JSONB,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        PRIMARY KEY(dead_letter_id, execution_generation, effect_key)
      )`);
    if (executor === pool) tableReady = true;
  } catch (err: any) {
    console.error("[DeadLetter] Table init failed:", err.message);
    throw err;
  }
}

const ensureTable = ensureAgentDeadLetterSchema;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeadLetterJob {
  id: string;
  jobName: string;
  orgId: string;
  errorMessage: string;
  errorStack: string | null;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date | null;
  finalFailedAt: Date | null;
  status: "pending" | "processing" | "retrying" | "final_failed" | "resolved";
  payload: unknown;
  payloadVersion: number;
  createdAt: Date;
  updatedAt: Date;
  lockedBy: string | null;
  lockedAt: Date | null;
  completedAt: Date | null;
  executionGeneration: number;
}

export interface ClaimedDeadLetterJob extends DeadLetterJob { lockedBy: string }

const RETRY_DELAYS_SECONDS = [300, 900, 3600];

// ─── Write ────────────────────────────────────────────────────────────────────

export async function pushToDeadLetter(opts: {
  jobName: string;
  orgId: string;
  error: Error | string;
  payload?: unknown;
  maxRetries?: number;
  retryRandom?: RetryRandom;
}): Promise<string | null> {
  try {
    await ensureTable();
    const errorMessage = opts.error instanceof Error ? opts.error.message : String(opts.error);
    const errorStack = opts.error instanceof Error ? (opts.error.stack ?? null) : null;
    const maxRetries = opts.maxRetries ?? 3;
    const rows = await db.execute(sql`
      INSERT INTO agent_dead_letter_queue
        (job_name, org_id, error_message, error_stack, max_retries, next_retry_at, payload_version, payload, status)
      VALUES
        (${opts.jobName}, ${opts.orgId}, ${errorMessage}, ${errorStack},
         ${maxRetries}, NOW() + (${jitteredDelayMs(300_000, opts.retryRandom)} * INTERVAL '1 millisecond'), ${CURRENT_DURABLE_PAYLOAD_VERSION},
         ${JSON.stringify(opts.payload ?? null)}::jsonb, 'pending')
      RETURNING id
    `);

    const id = Array.isArray(rows)
      ? (rows as any[])[0]?.id
      : (rows as any).rows?.[0]?.id;
    console.warn(`[DeadLetter] Queued: ${opts.jobName} org=${opts.orgId} id=${id}`);
    return id ?? null;
  } catch (err: any) {
    console.error("[DeadLetter] pushToDeadLetter error:", err.message);
    return null;
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getDeadLetterJobs(opts?: {
  orgId?: string;
  status?: string;
  limit?: number;
}): Promise<DeadLetterJob[]> {
  try {
    await ensureTable();
    const limit = opts?.limit ?? 50;

    let rows: any[];
    if (opts?.orgId && opts?.status) {
      const r = await db.execute(sql`
        SELECT * FROM agent_dead_letter_queue
        WHERE org_id = ${opts.orgId} AND status = ${opts.status}
        ORDER BY created_at DESC LIMIT ${limit}
      `);
      rows = Array.isArray(r) ? r : (r as any).rows ?? [];
    } else if (opts?.orgId) {
      const r = await db.execute(sql`
        SELECT * FROM agent_dead_letter_queue
        WHERE org_id = ${opts.orgId}
        ORDER BY created_at DESC LIMIT ${limit}
      `);
      rows = Array.isArray(r) ? r : (r as any).rows ?? [];
    } else if (opts?.status) {
      const r = await db.execute(sql`
        SELECT * FROM agent_dead_letter_queue
        WHERE status = ${opts.status}
        ORDER BY created_at DESC LIMIT ${limit}
      `);
      rows = Array.isArray(r) ? r : (r as any).rows ?? [];
    } else {
      const r = await db.execute(sql`
        SELECT * FROM agent_dead_letter_queue
        ORDER BY created_at DESC LIMIT ${limit}
      `);
      rows = Array.isArray(r) ? r : (r as any).rows ?? [];
    }

    return rows.map((r: any) => ({
      id: r.id,
      jobName: r.job_name,
      orgId: r.org_id,
      errorMessage: r.error_message,
      errorStack: r.error_stack,
      retryCount: r.retry_count,
      maxRetries: r.max_retries,
      nextRetryAt: r.next_retry_at ? new Date(r.next_retry_at) : null,
      finalFailedAt: r.final_failed_at ? new Date(r.final_failed_at) : null,
      status: r.status,
      payload: r.payload,
      payloadVersion: r.payload_version ?? 0,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
      lockedBy: r.locked_by,
      lockedAt: r.locked_at ? new Date(r.locked_at) : null,
      completedAt: r.completed_at ? new Date(r.completed_at) : null,
      executionGeneration: r.execution_generation ?? 0,
    }));
  } catch (err: any) {
    console.error("[DeadLetter] getDeadLetterJobs error:", err.message);
    return [];
  }
}

export async function getDeadLetterSummary(orgId?: string): Promise<{
  total: number;
  pending: number;
  finalFailed: number;
  resolved: number;
}> {
  try {
    await ensureTable();
    const r = orgId
      ? await db.execute(sql`
          SELECT status, COUNT(*)::int as count FROM agent_dead_letter_queue
          WHERE org_id = ${orgId} GROUP BY status
        `)
      : await db.execute(sql`
          SELECT status, COUNT(*)::int as count FROM agent_dead_letter_queue GROUP BY status
        `);

    const rows: any[] = Array.isArray(r) ? r : (r as any).rows ?? [];
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = Number(row.count);

    return {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      pending: (counts["pending"] ?? 0) + (counts["retrying"] ?? 0),
      finalFailed: counts["final_failed"] ?? 0,
      resolved: counts["resolved"] ?? 0,
    };
  } catch {
    return { total: 0, pending: 0, finalFailed: 0, resolved: 0 };
  }
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function markJobResolved(jobId: string): Promise<boolean> {
  try {
    await ensureTable();
    await db.execute(sql`
      UPDATE agent_dead_letter_queue
      SET status = 'resolved', updated_at = NOW()
      WHERE id = ${jobId}
    `);
    return true;
  } catch {
    return false;
  }
}

export async function incrementRetryCount(jobId: string): Promise<void> {
  try {
    await ensureTable();
    const delayMs = jitteredDelayMs(15 * 60_000);
    await db.execute(sql`
      UPDATE agent_dead_letter_queue SET
        retry_count = retry_count + 1,
        next_retry_at = NOW() + (${delayMs} * INTERVAL '1 millisecond'),
        status = CASE
          WHEN retry_count + 1 >= max_retries THEN 'final_failed'
          ELSE 'retrying'
        END,
        final_failed_at = CASE
          WHEN retry_count + 1 >= max_retries THEN NOW()
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE id = ${jobId}
    `);
  } catch {}
}

function mapJob(r: any): ClaimedDeadLetterJob {
  return {
    id: r.id, jobName: r.job_name, orgId: r.org_id, errorMessage: r.error_message,
    errorStack: r.error_stack, retryCount: r.retry_count, maxRetries: r.max_retries,
    nextRetryAt: r.next_retry_at ? new Date(r.next_retry_at) : null,
    finalFailedAt: r.final_failed_at ? new Date(r.final_failed_at) : null,
    status: r.status, payload: r.payload, payloadVersion: r.payload_version ?? 0, createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at), lockedBy: r.locked_by,
    lockedAt: r.locked_at ? new Date(r.locked_at) : null,
    completedAt: r.completed_at ? new Date(r.completed_at) : null,
    executionGeneration: r.execution_generation ?? 0,
  };
}

/** Atomic pending/due-or-expired claim. An optional org is for tenant-scoped operators/tests. */
export async function claimDeadLetterJob(workerId: string, orgId?: string): Promise<ClaimedDeadLetterJob | null> {
  await ensureTable();
  const result = await db.execute(sql`
    WITH candidate AS (
      SELECT id FROM agent_dead_letter_queue
      WHERE (${orgId ?? null}::text IS NULL OR org_id = ${orgId ?? null})
        AND (
          (status IN ('pending','retrying') AND COALESCE(next_retry_at, NOW()) <= NOW())
          OR (status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes')
        )
      ORDER BY COALESCE(next_retry_at, created_at), created_at
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE agent_dead_letter_queue q SET status='processing', locked_by=${workerId}, locked_at=NOW(), updated_at=NOW()
    FROM candidate WHERE q.id=candidate.id RETURNING q.*
  `);
  const rows: any[] = Array.isArray(result) ? result as any[] : (result as any).rows ?? [];
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function completeDeadLetterJob(job: ClaimedDeadLetterJob): Promise<boolean> {
  const r = await db.execute(sql`UPDATE agent_dead_letter_queue SET status='resolved', completed_at=NOW(),
    next_retry_at=NULL, locked_by=NULL, locked_at=NULL, updated_at=NOW()
    WHERE id=${job.id} AND org_id=${job.orgId} AND status='processing' AND locked_by=${job.lockedBy} RETURNING id`);
  const rows: any[] = Array.isArray(r) ? r as any[] : (r as any).rows ?? [];
  return rows.length === 1;
}

export async function failDeadLetterJob(job: ClaimedDeadLetterJob, error: Error | string, permanent = false): Promise<boolean> {
  const message = error instanceof Error ? error.message : String(error);
  const nextAttempt = job.retryCount + 1;
  const exhausted = permanent || nextAttempt >= job.maxRetries;
  // The initial queue insertion already owns the 5-minute window. A failed
  // replay advances to the next persisted window: 15 minutes, then 1 hour.
  const delay = RETRY_DELAYS_SECONDS[Math.min(nextAttempt, RETRY_DELAYS_SECONDS.length - 1)];
  const r = await db.execute(sql`UPDATE agent_dead_letter_queue SET
    retry_count=${nextAttempt}, error_message=${message},
    status=${exhausted ? "final_failed" : "retrying"},
    next_retry_at=${exhausted ? null : sql`NOW() + (${jitteredDelayMs(delay * 1000)} * INTERVAL '1 millisecond')`},
    final_failed_at=${exhausted ? sql`NOW()` : null}, locked_by=NULL, locked_at=NULL, updated_at=NOW()
    WHERE id=${job.id} AND org_id=${job.orgId} AND status='processing' AND locked_by=${job.lockedBy} RETURNING id`);
  const rows: any[] = Array.isArray(r) ? r as any[] : (r as any).rows ?? [];
  return rows.length === 1;
}

export async function replayDeadLetterJob(jobId: string, orgId: string, replayedBy: string): Promise<boolean> {
  await ensureTable();
  const r = await db.execute(sql`UPDATE agent_dead_letter_queue SET status='pending', retry_count=0,
    next_retry_at=NOW(), final_failed_at=NULL, locked_by=NULL, locked_at=NULL,
    execution_generation=execution_generation+1, replayed_by=${replayedBy}, updated_at=NOW()
    WHERE id=${jobId} AND org_id=${orgId} AND status IN ('final_failed','resolved') RETURNING id`);
  const rows: any[] = Array.isArray(r) ? r as any[] : (r as any).rows ?? [];
  return rows.length === 1;
}

export type DeadLetterReplayHandler = (job: ClaimedDeadLetterJob) => Promise<unknown>;
const handlers = new Map<string, DeadLetterReplayHandler>();
const handlerDependencies = new Map<string, string>();
export function registerDeadLetterReplayHandler(
  jobName: string, handler: DeadLetterReplayHandler, options?: { dependencyKey?: string },
): () => void {
  handlers.set(jobName, handler);
  if (options?.dependencyKey) handlerDependencies.set(jobName, options.dependencyKey);
  return () => { handlers.delete(jobName); handlerDependencies.delete(jobName); };
}

async function deferDeadLetterJob(job: ClaimedDeadLetterJob, retryAfterMs: number): Promise<void> {
  await db.execute(sql`UPDATE agent_dead_letter_queue SET status='retrying',locked_by=NULL,locked_at=NULL,
    next_retry_at=NOW() + (${jitteredDelayMs(Math.max(1_000, retryAfterMs))} * INTERVAL '1 millisecond'),updated_at=NOW()
    WHERE id=${job.id} AND org_id=${job.orgId} AND status='processing' AND locked_by=${job.lockedBy}`);
}

export async function requeueAgentActionDeadLetter(job: ClaimedDeadLetterJob): Promise<void> {
  const payload = job.payload as { actionId?: unknown; orgId?: unknown } | null;
  if (!payload || typeof payload.actionId !== "string" ||
      (payload.orgId !== undefined && payload.orgId !== job.orgId)) {
    throw new Error("Malformed agent_action_executor dead-letter payload");
  }
  const effectKey = "requeue_agent_action";
  const result = await db.execute(sql`
    WITH owned_action AS (
      SELECT id FROM gmail_agent_actions WHERE id=${payload.actionId} AND org_id=${job.orgId}
    ), inserted_effect AS (
      INSERT INTO agent_dead_letter_effects
        (dead_letter_id,org_id,execution_generation,effect_key,state,result,completed_at)
      SELECT ${job.id},${job.orgId},${job.executionGeneration},${effectKey},'completed',
        jsonb_build_object('actionId', id),NOW() FROM owned_action
      ON CONFLICT DO NOTHING RETURNING dead_letter_id
    ), requeued AS (
      UPDATE gmail_agent_actions SET status='proposed'
      WHERE id IN (SELECT id FROM owned_action) AND EXISTS (SELECT 1 FROM inserted_effect)
      RETURNING id
    )
    SELECT EXISTS(SELECT 1 FROM owned_action) AS owned,
      EXISTS(SELECT 1 FROM agent_dead_letter_effects WHERE dead_letter_id=${job.id}
        AND execution_generation=${job.executionGeneration} AND effect_key=${effectKey} AND state='completed') AS recorded
  `);
  const rows: any[] = Array.isArray(result) ? result as any[] : (result as any).rows ?? [];
  if (!rows[0]?.owned && !rows[0]?.recorded) throw new Error("Tenant-owned agent action not found");
}

export async function processOneDeadLetterJob(workerId: string, orgId?: string): Promise<boolean> {
  const job = await claimDeadLetterJob(workerId, orgId);
  if (!job) return false;
  const handler = handlers.get(job.jobName);
  if (!handler) {
    await failDeadLetterJob(job, `Unsupported dead-letter work type: ${job.jobName}`, true);
    return true;
  }
  try {
    job.payload = normalizeDeadLetterPayload({ workType: job.jobName, version: job.payloadVersion,
      payload: job.payload, authoritativeOrgId: job.orgId });
    const dependencyKey = handlerDependencies.get(job.jobName);
    if (dependencyKey) await executeWithCircuitBreaker(dependencyKey, () => handler(job), pool);
    else await handler(job);
    await completeDeadLetterJob(job);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid durable payload:")) {
      await failDeadLetterJob(job, error, true);
      return true;
    }
    if (error instanceof CircuitOpenError) {
      await deferDeadLetterJob(job, error.retryAfterMs);
      return true;
    }
    await failDeadLetterJob(job, error instanceof Error ? error : String(error));
  }
  return true;
}

let workerTimer: NodeJS.Timeout | null = null;
let workerStopping = false;
export async function startAgentDeadLetterWorker(): Promise<void> {
  if (workerTimer || isShuttingDown()) return;
  await ensureTable();
  registerDeadLetterReplayHandler("agent_action_executor", requeueAgentActionDeadLetter);
  workerStopping = false;
  const workerId = `agent-dlq-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const poll = async () => {
    if (workerStopping || isShuttingDown()) return;
    try {
      for (let processed = 0; !workerStopping && !isShuttingDown() && processed < 25; processed++) {
        if (!await processOneDeadLetterJob(workerId)) break;
      }
    }
    catch (error: any) { console.error("[AgentDeadLetterWorker] poll failed:", error.message); }
  };
  registerShutdownStop("agent-dead-letter-worker", stopAgentDeadLetterWorker);
  await trackBackgroundTask("agent-dead-letter-poll", poll);
  if (workerStopping || isShuttingDown()) return;
  workerTimer = setInterval(() => { void trackBackgroundTask("agent-dead-letter-poll", poll); }, 30_000);
  workerTimer.unref();
  console.log("[AgentDeadLetterWorker] Started");
}

export function stopAgentDeadLetterWorker(): void {
  workerStopping = true;
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}
