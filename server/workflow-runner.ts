/**
 * Workflow Runner — background cron for resuming waiting/pending workflows.
 * Runs every 10 minutes. Safe against duplicate execution.
 */

import { storage } from "./storage";
import { orchestrator } from "./workflow-orchestrator";

let _running = false;

export async function runWorkflowCycle(): Promise<void> {
  if (_running) {
    console.log("[WorkflowRunner] Cycle already in progress, skipping.");
    return;
  }
  _running = true;
  const start = Date.now();
  let advanced = 0;
  let failed = 0;
  let retried = 0;

  try {
    // Get all orgs with active runs
    const activeRuns = await storage.getAllActiveWorkflowRuns();

    // Group by org
    const orgIds = [...new Set(activeRuns.map(r => r.orgId))];

    for (const orgId of orgIds) {
      try {
        const result = await orchestrator.advanceWaiting(orgId);
        advanced += result.advanced;
        failed += result.errors;
      } catch (err: any) {
        console.error(`[WorkflowRunner] Error advancing org ${orgId}:`, err.message);
        failed++;
      }
    }

    // Retry retryable failures (retryCount < 3, failed < 1 hour ago)
    const failedRuns = await storage.getRetryableFailedRuns();
    for (const run of failedRuns) {
      try {
        await orchestrator.resume(run.id);
        retried++;
      } catch (err: any) {
        console.error(`[WorkflowRunner] Retry error run=${run.id}:`, err.message);
      }
    }

    const elapsed = Date.now() - start;
    if (advanced > 0 || retried > 0 || failed > 0) {
      console.log(`[WorkflowRunner] Cycle complete in ${elapsed}ms — advanced: ${advanced}, retried: ${retried}, errors: ${failed}`);
    }
  } catch (err: any) {
    console.error("[WorkflowRunner] Cycle error:", err.message);
  } finally {
    _running = false;
  }
}

export function startWorkflowRunner(): void {
  const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  console.log("[WorkflowRunner] started — will run every 10 minutes");
  setInterval(() => {
    runWorkflowCycle().catch(err => console.error("[WorkflowRunner] Unhandled error:", err.message));
  }, INTERVAL_MS);
  // Run once at startup after a short delay
  setTimeout(() => {
    runWorkflowCycle().catch(err => console.error("[WorkflowRunner] Startup error:", err.message));
  }, 15000);
}
