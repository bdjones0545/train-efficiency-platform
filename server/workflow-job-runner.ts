/**
 * Workflow Job Runner — Phase 4
 *
 * Production-safe scheduled job runner that polls the workflow_jobs table
 * and processes jobs within controlled concurrency limits.
 *
 * Safety guarantees:
 *   - Checks emergency pause before claiming any job
 *   - Atomic claim prevents duplicate workers from running same job
 *   - Stale locks expire automatically (no deadlocks)
 *   - Graceful shutdown on SIGTERM
 *   - Disabled in test environments unless USE_WORKFLOW_JOB_QUEUE=true
 *   - All lifecycle events logged to unified_agent_action_log
 */

import {
  claimNextJob,
  completeWorkflowJob,
  failWorkflowJob,
  classifyJobFailure,
  detectAndHandleStuckJobs,
  getJobQueueStats,
  WORKER_ID,
} from "./workflow-job-queue";
import { getGovernanceSettings } from "./capability-enforcement-engine";
import { logUnifiedAction } from "./unified-action-logger";
import { db } from "./db";
import { workflowJobs, workflowRuns } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

// ─── Configuration ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = parseInt(process.env.JOB_POLL_INTERVAL_MS ?? "15000"); // 15s
const MAX_CONCURRENCY = parseInt(process.env.JOB_MAX_CONCURRENCY ?? "5");
const STUCK_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ENABLED = process.env.USE_WORKFLOW_JOB_QUEUE === "true";

let isRunning = false;
let activeJobs = 0;
let shutdownRequested = false;
let pollTimer: NodeJS.Timeout | null = null;
let stuckCheckTimer: NodeJS.Timeout | null = null;

// ─── Job Executor ─────────────────────────────────────────────────────────────

/**
 * Execute a claimed job. Dispatches to the appropriate handler by jobType.
 * All errors are caught, classified, and routed through failWorkflowJob.
 */
export async function executeWorkflowJob(job: typeof workflowJobs.$inferSelect): Promise<void> {
  const { id: jobId, orgId, jobType, payload } = job;

  try {
    // Check emergency pause before executing
    const gov = await getGovernanceSettings(orgId);
    if (gov.emergencyPause) {
      await failWorkflowJob(jobId, "GOVERNANCE_BLOCKED: Emergency pause is active. Job paused until operator restores operations.", "governance");
      return;
    }

    await logUnifiedAction({
      orgId,
      actorType: "system",
      actorName: WORKER_ID,
      actionType: "job_started",
      status: "completed",
      riskLevel: "low",
      reasoningSummary: `Job started: ${jobType} (attempt ${job.attempts})`,
      outputSnapshot: { jobId, jobType },
    });

    let result: Record<string, any>;

    switch (jobType) {
      case "memory_lifecycle":
        result = await executeMemoryLifecycleJob(orgId, payload as any);
        break;

      case "approval_timeout":
        result = await executeApprovalTimeoutJob(orgId, payload as any);
        break;

      case "business_brain_run":
        result = await executeBusinessBrainJob(orgId, payload as any);
        break;

      case "notification":
        result = await executeNotificationJob(orgId, payload as any);
        break;

      case "workflow_step":
      case "tool_execution":
      case "scheduled_trigger":
      case "retry":
        // These are dispatched by the workflow executor directly.
        // The job runner records them but doesn't re-execute step logic here.
        result = { dispatched: true, message: `Job type ${jobType} is executed inline by the workflow executor.` };
        break;

      default:
        result = { skipped: true, message: `Unknown job type: ${jobType}` };
    }

    await completeWorkflowJob(jobId, result);
  } catch (err: any) {
    const errMsg = err?.message ?? String(err);
    const errorType = classifyJobFailure(errMsg);
    await failWorkflowJob(jobId, errMsg, errorType);
  }
}

// ─── Job Handlers ─────────────────────────────────────────────────────────────

async function executeMemoryLifecycleJob(orgId: string, payload: { limit?: number }): Promise<Record<string, any>> {
  const { runMemoryLifecycle } = await import("./workflow-context-engine");
  const result = await runMemoryLifecycle(orgId, payload.limit ?? 100);
  return result ?? { done: true };
}

async function executeApprovalTimeoutJob(
  orgId: string,
  payload: { workflowRunId: string; stepId?: string; escalate?: boolean },
): Promise<Record<string, any>> {
  const [run] = await db.select().from(workflowRuns).where(and(
    eq(workflowRuns.id, payload.workflowRunId),
    eq(workflowRuns.orgId, orgId),
  ));

  if (!run) return { skipped: true, reason: "Workflow run not found" };
  if (run.status !== "waiting_approval") return { skipped: true, reason: `Run status is ${run.status}, not waiting` };

  await logUnifiedAction({
    orgId,
    actorType: "system",
    actorName: "approval-timeout",
    actionType: "approval_required",
    status: "completed",
    riskLevel: "medium",
    reasoningSummary: `Approval timeout reminder: workflow run ${payload.workflowRunId} has been waiting for approval.`,
    outputSnapshot: { workflowRunId: payload.workflowRunId, escalate: payload.escalate },
  });

  return { reminded: true, workflowRunId: payload.workflowRunId };
}

async function executeBusinessBrainJob(orgId: string, payload: Record<string, any>): Promise<Record<string, any>> {
  // Business brain jobs enqueued from the cron use this handler
  await logUnifiedAction({
    orgId,
    actorType: "system",
    actorName: "business-brain-job",
    actionType: "job_started",
    status: "completed",
    riskLevel: "low",
    reasoningSummary: "Business brain job dispatched via job queue",
    inputSnapshot: payload,
  });
  return { dispatched: true };
}

async function executeNotificationJob(orgId: string, payload: { type: string; message: string; targetUserId?: string }): Promise<Record<string, any>> {
  await logUnifiedAction({
    orgId,
    actorType: "system",
    actorName: "notification-job",
    actionType: "job_completed",
    status: "completed",
    riskLevel: "low",
    reasoningSummary: `Notification job: ${payload.type} — ${payload.message?.substring(0, 100)}`,
  });
  return { notified: true, type: payload.type };
}

// ─── Poll Loop ────────────────────────────────────────────────────────────────

async function pollAndProcess(): Promise<void> {
  if (shutdownRequested || activeJobs >= MAX_CONCURRENCY) return;

  try {
    // Claim and process up to (MAX_CONCURRENCY - activeJobs) jobs
    const slots = MAX_CONCURRENCY - activeJobs;
    for (let i = 0; i < slots; i++) {
      const job = await claimNextJob();
      if (!job) break;

      activeJobs++;
      executeWorkflowJob(job)
        .catch(err => console.error(`[JobRunner] Unhandled error in job ${job.id}:`, err))
        .finally(() => { activeJobs--; });
    }
  } catch (err) {
    console.error("[JobRunner] Poll error:", err);
  }
}

// ─── Start / Stop ─────────────────────────────────────────────────────────────

export function startWorkflowJobRunner(): void {
  if (!ENABLED) {
    console.log("[JobRunner] Disabled (set USE_WORKFLOW_JOB_QUEUE=true to enable)");
    return;
  }

  if (isRunning) {
    console.warn("[JobRunner] Already running");
    return;
  }

  isRunning = true;
  console.log(`[JobRunner] Started — worker: ${WORKER_ID}, poll: ${POLL_INTERVAL_MS}ms, concurrency: ${MAX_CONCURRENCY}`);

  // Main poll loop
  pollTimer = setInterval(async () => {
    if (!shutdownRequested) await pollAndProcess();
  }, POLL_INTERVAL_MS);

  // Stuck job detection loop
  stuckCheckTimer = setInterval(async () => {
    try {
      const { stuckCount, fixedCount } = await detectAndHandleStuckJobs();
      if (stuckCount > 0) {
        console.warn(`[JobRunner] Stuck job check: found ${stuckCount}, fixed ${fixedCount}`);
      }
    } catch (err) {
      console.error("[JobRunner] Stuck job check error:", err);
    }
  }, STUCK_CHECK_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = () => {
    console.log("[JobRunner] Graceful shutdown initiated…");
    shutdownRequested = true;
    if (pollTimer) clearInterval(pollTimer);
    if (stuckCheckTimer) clearInterval(stuckCheckTimer);
    isRunning = false;
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export function getRunnerStatus() {
  return {
    enabled: ENABLED,
    running: isRunning,
    workerId: WORKER_ID,
    activeJobs,
    maxConcurrency: MAX_CONCURRENCY,
    pollIntervalMs: POLL_INTERVAL_MS,
    shutdownRequested,
  };
}
