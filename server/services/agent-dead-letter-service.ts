/**
 * Agent Dead-Letter Queue (Priority 4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Catches unrecoverable job failures so nothing is silently lost.
 * Table is created via executeSql (no migration required).
 * Retry schedule: 5 min → 15 min → final_failed after max_retries.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_dead_letter_queue (
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
      )
    `);
    tableReady = true;
  } catch (err: any) {
    console.error("[DeadLetter] Table init failed:", err.message);
  }
}

ensureTable().catch(() => {});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeadLetterJob {
  id: string;
  jobName: string;
  orgId: string | null;
  errorMessage: string;
  errorStack: string | null;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date | null;
  finalFailedAt: Date | null;
  status: "pending" | "retrying" | "final_failed" | "resolved";
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function pushToDeadLetter(opts: {
  jobName: string;
  orgId?: string;
  error: Error | string;
  payload?: unknown;
  maxRetries?: number;
}): Promise<string | null> {
  try {
    await ensureTable();
    const errorMessage = opts.error instanceof Error ? opts.error.message : String(opts.error);
    const errorStack = opts.error instanceof Error ? (opts.error.stack ?? null) : null;
    const maxRetries = opts.maxRetries ?? 3;
    const nextRetryAt = new Date(Date.now() + 5 * 60 * 1000);

    const rows = await db.execute(sql`
      INSERT INTO agent_dead_letter_queue
        (job_name, org_id, error_message, error_stack, max_retries, next_retry_at, payload, status)
      VALUES
        (${opts.jobName}, ${opts.orgId ?? null}, ${errorMessage}, ${errorStack},
         ${maxRetries}, ${nextRetryAt.toISOString()},
         ${JSON.stringify(opts.payload ?? null)}::jsonb, 'pending')
      RETURNING id
    `);

    const id = Array.isArray(rows)
      ? (rows as any[])[0]?.id
      : (rows as any).rows?.[0]?.id;
    console.warn(`[DeadLetter] Queued: ${opts.jobName} org=${opts.orgId ?? "global"} id=${id}`);
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
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
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
    await db.execute(sql`
      UPDATE agent_dead_letter_queue SET
        retry_count = retry_count + 1,
        next_retry_at = NOW() + INTERVAL '15 minutes',
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
