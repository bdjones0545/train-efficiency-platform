/**
 * Workflow Job Queue Engine — Phase 4
 *
 * Durable, idempotent, retry-safe job queue for all agent actions,
 * workflow steps, tool calls, and scheduled triggers.
 *
 * Every mutating operation in the system goes through here.
 *
 * Safety guarantees:
 *   - All jobs are org-scoped (no cross-org leakage)
 *   - Idempotency keys prevent duplicate execution
 *   - All locks expire automatically (no deadlocks)
 *   - Emergency pause stops future jobs, never corrupts in-flight ones
 *   - All lifecycle events write to unified_agent_action_log
 *   - Governance is re-checked on every manual retry
 *   - Bounded retries with classified failures
 */

import { db } from "./db";
import { workflowJobs, agentExecutionLocks, orgExecutionRateLimits } from "@shared/schema";
import { eq, and, lte, lt, isNull, or, sql, desc, inArray } from "drizzle-orm";
import { logUnifiedAction } from "./unified-action-logger";
import { getGovernanceSettings } from "./capability-enforcement-engine";

// ─── Constants ────────────────────────────────────────────────────────────────

export const LOCK_TTL_MS = 5 * 60 * 1000;    // 5 minutes default lock TTL
export const STUCK_JOB_THRESHOLD_MS = 10 * 60 * 1000;  // 10 minutes = stuck
export const WORKER_ID = `worker-${process.pid}-${Date.now()}`;

// Retry backoff schedule (ms) — per attempt
const BACKOFF_SCHEDULE = [5_000, 15_000, 60_000, 300_000, 900_000];

// Default max attempts per job type
const MAX_ATTEMPTS_BY_TYPE: Record<string, number> = {
  workflow_step: 3,
  tool_execution: 3,
  scheduled_trigger: 5,
  retry: 3,
  approval_timeout: 2,
  memory_lifecycle: 2,
  business_brain_run: 2,
  notification: 5,
};

// Default rate limit windows (max executions)
const DEFAULT_RATE_LIMITS: Record<string, { window: string; max: number }> = {
  communication: { window: "hour", max: 50 },
  scheduling: { window: "hour", max: 100 },
  finance: { window: "hour", max: 25 },
  research: { window: "hour", max: 10 },
  workflow: { window: "hour", max: 200 },
  ai_reasoning: { window: "day", max: 100 },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobPriority = "low" | "normal" | "high" | "critical";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "retrying" | "cancelled" | "dead_letter" | "paused";
export type ErrorType = "transient" | "blocked" | "fatal" | "governance" | "timeout" | "rate_limited";
export type JobType =
  | "workflow_step" | "tool_execution" | "scheduled_trigger" | "retry"
  | "approval_timeout" | "memory_lifecycle" | "business_brain_run" | "notification";

export type EnqueueJobInput = {
  orgId: string;
  jobType: JobType;
  payload: Record<string, any>;
  priority?: JobPriority;
  scheduledFor?: Date;
  idempotencyKey?: string;
  workflowRunId?: string;
  workflowStepId?: string;
  maxAttempts?: number;
};

export type JobExecutionResult = {
  jobId: string;
  status: JobStatus;
  result?: Record<string, any>;
  error?: string;
  errorType?: ErrorType;
  duplicate?: boolean;
};

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Add a new job to the queue. Idempotent: if a job with the same
 * idempotencyKey already exists and is not failed/cancelled, return it.
 */
export async function enqueueWorkflowJob(input: EnqueueJobInput): Promise<JobExecutionResult> {
  // Idempotency check — never create duplicate jobs
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(workflowJobs)
      .where(eq(workflowJobs.idempotencyKey, input.idempotencyKey));

    if (existing && !["failed", "cancelled", "dead_letter"].includes(existing.status)) {
      await logUnifiedAction({
        orgId: input.orgId,
        actorType: "system",
        actorName: "job-queue",
        actionType: "duplicate_job_prevented",
        status: "completed",
        riskLevel: "low",
        reasoningSummary: `Duplicate job prevented: idempotency key "${input.idempotencyKey}" already exists (status: ${existing.status}).`,
        outputSnapshot: { existingJobId: existing.id, status: existing.status },
      });
      return { jobId: existing.id, status: existing.status as JobStatus, duplicate: true };
    }
  }

  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS_BY_TYPE[input.jobType] ?? 3;

  const [job] = await db.insert(workflowJobs).values({
    id: crypto.randomUUID(),
    orgId: input.orgId,
    workflowRunId: input.workflowRunId ?? null,
    workflowStepId: input.workflowStepId ?? null,
    jobType: input.jobType,
    status: "queued",
    priority: input.priority ?? "normal",
    scheduledFor: input.scheduledFor ?? new Date(),
    attempts: 0,
    maxAttempts,
    retryBackoffMs: BACKOFF_SCHEDULE[0],
    payload: input.payload,
    idempotencyKey: input.idempotencyKey ?? null,
  }).returning();

  await logUnifiedAction({
    orgId: input.orgId,
    actorType: "system",
    actorName: "job-queue",
    actionType: "job_enqueued",
    status: "completed",
    riskLevel: "low",
    reasoningSummary: `Job enqueued: ${input.jobType} (priority: ${input.priority ?? "normal"})`,
    inputSnapshot: { jobType: input.jobType, idempotencyKey: input.idempotencyKey },
    outputSnapshot: { jobId: job.id },
  });

  return { jobId: job.id, status: "queued" };
}

// ─── Claim ────────────────────────────────────────────────────────────────────

/**
 * Atomically claim the next available job for this worker.
 * Uses UPDATE...RETURNING to prevent race conditions between workers.
 */
export async function claimNextJob(orgId?: string): Promise<typeof workflowJobs.$inferSelect | null> {
  const now = new Date();

  // Build the claim query — atomic UPDATE...RETURNING pattern
  const conditions = [
    or(eq(workflowJobs.status, "queued"), eq(workflowJobs.status, "retrying")),
    lte(workflowJobs.scheduledFor, now),
    or(isNull(workflowJobs.lockedBy), lt(workflowJobs.lockedAt, new Date(now.getTime() - LOCK_TTL_MS))),
  ];

  if (orgId) conditions.push(eq(workflowJobs.orgId, orgId));

  // Find candidate (priority order: critical > high > normal > low)
  const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };

  const candidates = await db
    .select()
    .from(workflowJobs)
    .where(and(...conditions))
    .orderBy(sql`CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`, workflowJobs.scheduledFor)
    .limit(1);

  if (!candidates.length) return null;

  const candidate = candidates[0];

  // Atomic lock acquisition
  const [claimed] = await db
    .update(workflowJobs)
    .set({
      status: "running",
      lockedBy: WORKER_ID,
      lockedAt: now,
      startedAt: now,
      attempts: sql`${workflowJobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(and(
      eq(workflowJobs.id, candidate.id),
      or(isNull(workflowJobs.lockedBy), lt(workflowJobs.lockedAt, new Date(now.getTime() - LOCK_TTL_MS))),
    ))
    .returning();

  if (!claimed) return null; // Another worker claimed it first

  await logUnifiedAction({
    orgId: claimed.orgId,
    actorType: "system",
    actorName: WORKER_ID,
    actionType: "job_claimed",
    status: "completed",
    riskLevel: "low",
    reasoningSummary: `Job claimed by worker: ${claimed.jobType} (attempt ${(claimed.attempts ?? 0)})`,
    outputSnapshot: { jobId: claimed.id, workerId: WORKER_ID },
  });

  return claimed;
}

// ─── Complete ─────────────────────────────────────────────────────────────────

export async function completeWorkflowJob(jobId: string, result: Record<string, any>): Promise<void> {
  const now = new Date();
  const [job] = await db
    .update(workflowJobs)
    .set({ status: "completed", completedAt: now, result, lockedBy: null, lockedAt: null, updatedAt: now })
    .where(eq(workflowJobs.id, jobId))
    .returning();

  if (job) {
    await logUnifiedAction({
      orgId: job.orgId,
      actorType: "system",
      actorName: "job-queue",
      actionType: "job_completed",
      status: "completed",
      riskLevel: "low",
      reasoningSummary: `Job completed: ${job.jobType} after ${job.attempts} attempt(s).`,
      outputSnapshot: { jobId, jobType: job.jobType, durationMs: job.startedAt ? now.getTime() - new Date(job.startedAt).getTime() : null },
    });
  }
}

// ─── Fail + Retry ─────────────────────────────────────────────────────────────

/**
 * Classify and handle a job failure. Routes to retry, dead letter, or paused
 * based on the error type and remaining attempts.
 */
export async function failWorkflowJob(
  jobId: string,
  error: string,
  errorType: ErrorType = "transient",
): Promise<void> {
  const [job] = await db.select().from(workflowJobs).where(eq(workflowJobs.id, jobId));
  if (!job) return;

  const now = new Date();
  const attempts = job.attempts ?? 0;
  const maxAttempts = job.maxAttempts ?? 3;

  await logUnifiedAction({
    orgId: job.orgId,
    actorType: "system",
    actorName: "job-queue",
    actionType: "job_failed",
    status: "failed",
    riskLevel: errorType === "fatal" ? "critical" : "medium",
    reasoningSummary: `Job failed (${errorType}): ${error.substring(0, 200)}`,
    outputSnapshot: { jobId, attempts, maxAttempts, errorType },
  });

  // Governance failures → pause until operator acts
  if (errorType === "governance") {
    await db.update(workflowJobs).set({
      status: "paused",
      lastError: error,
      errorType,
      failedAt: now,
      lockedBy: null,
      lockedAt: null,
      updatedAt: now,
    }).where(eq(workflowJobs.id, jobId));

    await logUnifiedAction({
      orgId: job.orgId,
      actorType: "system",
      actorName: "job-queue",
      actionType: "job_paused",
      status: "completed",
      riskLevel: "high",
      reasoningSummary: `Job paused due to governance block. Operator review required before retry.`,
    });
    return;
  }

  // Fatal failures → dead letter immediately
  if (errorType === "fatal" || attempts >= maxAttempts) {
    await moveToDeadLetter(jobId, error, errorType);
    return;
  }

  // Transient / rate_limited / timeout / blocked → schedule retry
  await retryWorkflowJob(jobId, error, errorType);
}

export async function retryWorkflowJob(jobId: string, error: string, errorType: ErrorType): Promise<void> {
  const [job] = await db.select().from(workflowJobs).where(eq(workflowJobs.id, jobId));
  if (!job) return;

  const attempts = job.attempts ?? 0;
  const backoffMs = BACKOFF_SCHEDULE[Math.min(attempts, BACKOFF_SCHEDULE.length - 1)];

  // Rate limited → longer backoff
  const effectiveBackoff = errorType === "rate_limited" ? Math.max(backoffMs, 300_000) : backoffMs;
  const nextRetryAt = new Date(Date.now() + effectiveBackoff);

  await db.update(workflowJobs).set({
    status: "retrying",
    lastError: error,
    errorType,
    nextRetryAt,
    scheduledFor: nextRetryAt,
    lockedBy: null,
    lockedAt: null,
    updatedAt: new Date(),
  }).where(eq(workflowJobs.id, jobId));

  await logUnifiedAction({
    orgId: job.orgId,
    actorType: "system",
    actorName: "job-queue",
    actionType: "job_retry_scheduled",
    status: "completed",
    riskLevel: "low",
    reasoningSummary: `Job retry scheduled in ${(effectiveBackoff / 1000).toFixed(0)}s (attempt ${attempts}/${job.maxAttempts}, error type: ${errorType}).`,
    outputSnapshot: { jobId, nextRetryAt: nextRetryAt.toISOString(), errorType },
  });
}

// ─── Dead Letter ──────────────────────────────────────────────────────────────

export async function moveToDeadLetter(jobId: string, error: string, errorType: ErrorType): Promise<void> {
  const now = new Date();
  const [job] = await db
    .update(workflowJobs)
    .set({ status: "dead_letter", lastError: error, errorType, failedAt: now, lockedBy: null, lockedAt: null, updatedAt: now })
    .where(eq(workflowJobs.id, jobId))
    .returning();

  if (job) {
    await logUnifiedAction({
      orgId: job.orgId,
      actorType: "system",
      actorName: "job-queue",
      actionType: "job_moved_to_dead_letter",
      status: "failed",
      riskLevel: "high",
      reasoningSummary: `Job moved to dead letter after ${job.attempts} attempt(s): ${error.substring(0, 200)}`,
      outputSnapshot: { jobId, jobType: job.jobType, errorType, attempts: job.attempts },
    });
  }
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelWorkflowJob(jobId: string, orgId: string, cancelledBy: string): Promise<void> {
  const [job] = await db
    .update(workflowJobs)
    .set({ status: "cancelled", lockedBy: null, lockedAt: null, updatedAt: new Date() })
    .where(and(eq(workflowJobs.id, jobId), eq(workflowJobs.orgId, orgId)))
    .returning();

  if (job) {
    await logUnifiedAction({
      orgId,
      actorType: "admin",
      actorName: cancelledBy,
      actionType: "job_cancelled",
      status: "completed",
      riskLevel: "low",
      reasoningSummary: `Job cancelled by ${cancelledBy}: ${job.jobType}`,
    });
  }
}

// ─── Org Pause / Resume ───────────────────────────────────────────────────────

export async function pauseOrgJobs(orgId: string, pausedBy: string): Promise<number> {
  const result = await db
    .update(workflowJobs)
    .set({ status: "paused", updatedAt: new Date() })
    .where(and(
      eq(workflowJobs.orgId, orgId),
      inArray(workflowJobs.status, ["queued", "retrying"]),
    ))
    .returning();

  await logUnifiedAction({
    orgId,
    actorType: "admin",
    actorName: pausedBy,
    actionType: "job_paused",
    status: "completed",
    riskLevel: "high",
    reasoningSummary: `${result.length} org jobs paused by ${pausedBy} (emergency pause).`,
  });

  return result.length;
}

export async function resumeOrgJobs(orgId: string, resumedBy: string): Promise<number> {
  const result = await db
    .update(workflowJobs)
    .set({ status: "queued", scheduledFor: new Date(), updatedAt: new Date() })
    .where(and(
      eq(workflowJobs.orgId, orgId),
      eq(workflowJobs.status, "paused"),
    ))
    .returning();

  await logUnifiedAction({
    orgId,
    actorType: "admin",
    actorName: resumedBy,
    actionType: "job_resumed",
    status: "completed",
    riskLevel: "medium",
    reasoningSummary: `${result.length} org jobs resumed by ${resumedBy}.`,
  });

  return result.length;
}

// ─── Execution Locks ──────────────────────────────────────────────────────────

/**
 * Acquire a named execution lock. Returns true if acquired, false if already locked.
 * Automatically releases expired locks.
 */
export async function acquireExecutionLock(
  orgId: string,
  lockKey: string,
  lockedBy: string,
  entityType?: string,
  entityId?: string,
  workflowRunId?: string,
  ttlMs = LOCK_TTL_MS,
): Promise<boolean> {
  const now = new Date();

  // Clean up any expired lock for this key first
  await db.delete(agentExecutionLocks)
    .where(and(
      eq(agentExecutionLocks.lockKey, lockKey),
      lt(agentExecutionLocks.expiresAt, now),
    ));

  try {
    await db.insert(agentExecutionLocks).values({
      id: crypto.randomUUID(),
      orgId,
      lockKey,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      workflowRunId: workflowRunId ?? null,
      lockedBy,
      expiresAt: new Date(now.getTime() + ttlMs),
    });

    await logUnifiedAction({
      orgId,
      actorType: "system",
      actorName: lockedBy,
      actionType: "execution_lock_acquired",
      status: "completed",
      riskLevel: "low",
      reasoningSummary: `Execution lock acquired: ${lockKey}`,
      outputSnapshot: { lockKey, entityType, entityId, ttlMs },
    });

    return true;
  } catch (_) {
    // Unique constraint violation — lock already held
    return false;
  }
}

export async function releaseExecutionLock(orgId: string, lockKey: string): Promise<void> {
  const [deleted] = await db
    .delete(agentExecutionLocks)
    .where(and(eq(agentExecutionLocks.lockKey, lockKey), eq(agentExecutionLocks.orgId, orgId)))
    .returning();

  if (deleted) {
    await logUnifiedAction({
      orgId,
      actorType: "system",
      actorName: deleted.lockedBy,
      actionType: "execution_lock_released",
      status: "completed",
      riskLevel: "low",
      reasoningSummary: `Execution lock released: ${lockKey}`,
    });
  }
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export async function checkAndIncrementRateLimit(
  orgId: string,
  category: string,
): Promise<{ allowed: boolean; reason?: string; resetAt?: Date }> {
  const now = new Date();
  const defaultConfig = DEFAULT_RATE_LIMITS[category];
  if (!defaultConfig) return { allowed: true };

  const window = defaultConfig.window;
  const maxEx = defaultConfig.max;

  // Get or create rate limit record
  let [record] = await db
    .select()
    .from(orgExecutionRateLimits)
    .where(and(
      eq(orgExecutionRateLimits.orgId, orgId),
      eq(orgExecutionRateLimits.category, category),
      eq(orgExecutionRateLimits.limitWindow, window),
    ));

  // Determine window reset time
  const windowDurations: Record<string, number> = {
    minute: 60_000, hour: 3_600_000, day: 86_400_000,
  };
  const windowMs = windowDurations[window] ?? 3_600_000;

  if (!record || !record.resetAt || new Date(record.resetAt) < now) {
    // Create or reset window
    const resetAt = new Date(now.getTime() + windowMs);
    if (record) {
      [record] = await db.update(orgExecutionRateLimits)
        .set({ currentCount: 0, resetAt, updatedAt: now })
        .where(eq(orgExecutionRateLimits.id, record.id))
        .returning();
    } else {
      try {
        [record] = await db.insert(orgExecutionRateLimits).values({
          id: crypto.randomUUID(),
          orgId,
          category,
          limitWindow: window,
          maxExecutions: maxEx,
          currentCount: 0,
          resetAt,
        }).returning();
      } catch (_) {
        return { allowed: true }; // Race condition — allow and continue
      }
    }
  }

  const currentCount = record?.currentCount ?? 0;
  const maxAllowed = record?.maxExecutions ?? maxEx;

  if (currentCount >= maxAllowed) {
    await logUnifiedAction({
      orgId,
      actorType: "system",
      actorName: "job-queue",
      actionType: "rate_limit_hit",
      status: "failed",
      riskLevel: "medium",
      reasoningSummary: `Rate limit hit for ${category}: ${currentCount}/${maxAllowed} per ${window}. Resets at ${record?.resetAt?.toISOString()}.`,
    });
    return { allowed: false, reason: `Rate limit exceeded for ${category}: ${currentCount}/${maxAllowed} per ${window}`, resetAt: record?.resetAt ?? undefined };
  }

  // Increment counter
  if (record) {
    await db.update(orgExecutionRateLimits)
      .set({ currentCount: sql`${orgExecutionRateLimits.currentCount} + 1`, updatedAt: now })
      .where(eq(orgExecutionRateLimits.id, record.id));
  }

  return { allowed: true };
}

// ─── Failure Classification ───────────────────────────────────────────────────

export function classifyJobFailure(error: string): ErrorType {
  const e = error.toLowerCase();
  if (e.includes("governance") || e.includes("emergency pause") || e.includes("governance_blocked") || e.includes("capability_denied")) return "governance";
  if (e.includes("rate limit") || e.includes("429") || e.includes("too many requests") || e.includes("quota")) return "rate_limited";
  if (e.includes("timeout") || e.includes("econnreset") || e.includes("enotfound") || e.includes("econnrefused")) return "timeout";
  if (e.includes("not found") && (e.includes("entity") || e.includes("workflow") || e.includes("deleted"))) return "fatal";
  if (e.includes("invalid") && (e.includes("definition") || e.includes("schema") || e.includes("required"))) return "fatal";
  if (e.includes("missing") && (e.includes("email") || e.includes("phone") || e.includes("integration"))) return "blocked";
  return "transient";
}

// ─── Stuck Job Detection ──────────────────────────────────────────────────────

export async function detectAndHandleStuckJobs(): Promise<{ stuckCount: number; fixedCount: number }> {
  const stuckThreshold = new Date(Date.now() - STUCK_JOB_THRESHOLD_MS);

  const stuckJobs = await db
    .select()
    .from(workflowJobs)
    .where(and(
      eq(workflowJobs.status, "running"),
      lt(workflowJobs.startedAt, stuckThreshold),
    ));

  let fixedCount = 0;

  for (const job of stuckJobs) {
    const attempts = job.attempts ?? 0;
    const maxAttempts = job.maxAttempts ?? 3;

    await logUnifiedAction({
      orgId: job.orgId,
      actorType: "system",
      actorName: "stuck-job-monitor",
      actionType: "stuck_job_detected",
      status: "failed",
      riskLevel: "high",
      reasoningSummary: `Stuck job detected: ${job.jobType} (running for >${STUCK_JOB_THRESHOLD_MS / 60000} minutes, attempt ${attempts}).`,
      outputSnapshot: { jobId: job.id, jobType: job.jobType, startedAt: job.startedAt?.toISOString() },
    });

    if (attempts >= maxAttempts) {
      await moveToDeadLetter(job.id, "Job exceeded max execution time (stuck)", "timeout");
    } else {
      // Release lock and reschedule
      await db.update(workflowJobs).set({
        status: "retrying",
        lockedBy: null,
        lockedAt: null,
        lastError: "Stuck: exceeded execution time limit",
        errorType: "timeout",
        scheduledFor: new Date(Date.now() + BACKOFF_SCHEDULE[Math.min(attempts, BACKOFF_SCHEDULE.length - 1)]),
        updatedAt: new Date(),
      }).where(eq(workflowJobs.id, job.id));
    }
    fixedCount++;
  }

  // Also release stale locks (expired)
  await db.delete(agentExecutionLocks).where(lt(agentExecutionLocks.expiresAt, new Date()));

  return { stuckCount: stuckJobs.length, fixedCount };
}

// ─── Analytics / Stats ────────────────────────────────────────────────────────

export async function getJobQueueStats(orgId: string) {
  const allStatuses = ["queued", "running", "completed", "failed", "retrying", "cancelled", "dead_letter", "paused"];

  const rows = await db
    .select({ status: workflowJobs.status, count: sql<number>`count(*)::int` })
    .from(workflowJobs)
    .where(eq(workflowJobs.orgId, orgId))
    .groupBy(workflowJobs.status);

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = r.count;

  const stuckThreshold = new Date(Date.now() - STUCK_JOB_THRESHOLD_MS);
  const [stuckResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflowJobs)
    .where(and(
      eq(workflowJobs.orgId, orgId),
      eq(workflowJobs.status, "running"),
      lt(workflowJobs.startedAt, stuckThreshold),
    ));

  // Average execution time from recently completed jobs
  const [avgResult] = await db
    .select({ avgMs: sql<number>`AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::int` })
    .from(workflowJobs)
    .where(and(
      eq(workflowJobs.orgId, orgId),
      eq(workflowJobs.status, "completed"),
      sql`completed_at > NOW() - INTERVAL '24 hours'`,
    ));

  const rateLimits = await db.select().from(orgExecutionRateLimits)
    .where(eq(orgExecutionRateLimits.orgId, orgId));

  return {
    queued: counts.queued ?? 0,
    running: counts.running ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    retrying: counts.retrying ?? 0,
    cancelled: counts.cancelled ?? 0,
    deadLetter: counts.dead_letter ?? 0,
    paused: counts.paused ?? 0,
    stuck: stuckResult?.count ?? 0,
    avgExecutionMs: avgResult?.avgMs ?? 0,
    rateLimits,
  };
}

export async function getDeadLetterJobs(orgId: string, limit = 50) {
  return db
    .select()
    .from(workflowJobs)
    .where(and(eq(workflowJobs.orgId, orgId), eq(workflowJobs.status, "dead_letter")))
    .orderBy(desc(workflowJobs.failedAt))
    .limit(limit);
}

export async function getJobsForWorkflowRun(orgId: string, workflowRunId: string) {
  return db
    .select()
    .from(workflowJobs)
    .where(and(eq(workflowJobs.orgId, orgId), eq(workflowJobs.workflowRunId, workflowRunId)))
    .orderBy(workflowJobs.createdAt);
}

export async function retryDeadLetterJob(jobId: string, orgId: string, retriedBy: string): Promise<{ ok: boolean; error?: string }> {
  const [job] = await db.select().from(workflowJobs).where(and(eq(workflowJobs.id, jobId), eq(workflowJobs.orgId, orgId)));
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status !== "dead_letter" && job.status !== "failed" && job.status !== "paused") {
    return { ok: false, error: `Cannot retry job with status: ${job.status}` };
  }

  // Re-check governance before allowing manual retry
  try {
    const gov = await getGovernanceSettings(orgId);
    if (gov.emergencyPause) {
      return { ok: false, error: "Cannot retry: emergency pause is active. Disable it in AI Governance first." };
    }
  } catch (_) { /* non-blocking */ }

  await db.update(workflowJobs).set({
    status: "queued",
    lockedBy: null,
    lockedAt: null,
    lastError: null,
    errorType: null,
    nextRetryAt: null,
    scheduledFor: new Date(),
    updatedAt: new Date(),
  }).where(eq(workflowJobs.id, jobId));

  await logUnifiedAction({
    orgId,
    actorType: "admin",
    actorName: retriedBy,
    actionType: "job_retry_scheduled",
    status: "completed",
    riskLevel: "medium",
    reasoningSummary: `Dead letter job manually retried by ${retriedBy}: ${job.jobType}`,
    outputSnapshot: { jobId, previousStatus: job.status },
  });

  return { ok: true };
}
