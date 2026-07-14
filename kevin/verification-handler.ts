/**
 * Kevin Verification & Outcome Handler — Step 15
 *
 * Do not mark work complete based on intent acceptance alone.
 * Completion requires:
 *   - Terminal intent state
 *   - Terminal task state (where applicable)
 *   - Successful execution verification
 *   - Retrieved outcome record
 *
 * Records:
 *   - Expected result
 *   - Actual result
 *   - Verification status
 *   - Deviations
 *   - Final outcome
 *   - Confidence
 *   - Human approval or rejection
 *   - Downstream result (when available)
 *
 * Learning: outcomes update institutional memory but NEVER expand Kevin's permissions.
 */

import type { TrainEfficiencyClient, IntentRecord, TaskRecord } from "./te-client";
import { TERMINAL_INTENT_STATES, TERMINAL_TASK_STATES } from "./te-client";
import { obsIntentStateChange, obsTaskStateChange, obsVerificationFailed, obsOutcomeRetrieved } from "./observability";
import { buildOutcomeReport, buildFailure } from "./structured-responses";
import type { ActionBlock } from "./structured-responses";

export interface VerificationRecord {
  intentId: string;
  capabilityKey: string;
  organizationId: string;
  correlationId: string;

  expectedResult?: string;
  actualResult?: string;
  verificationStatus: "passed" | "failed" | "partial" | "skipped" | "pending";
  deviations: string[];

  finalOutcome: "success" | "failure" | "partial" | "pending";
  confidence?: number;
  humanApproval?: "approved" | "rejected" | "none";
  downstreamResult?: string;

  intentTerminal: boolean;
  taskTerminal: boolean;
  complete: boolean;

  block: ActionBlock;
}

/**
 * Poll intent until it reaches a terminal state.
 * Returns the final intent and verification status.
 */
export async function pollIntentToCompletion(
  client: TrainEfficiencyClient,
  intentId: string,
  orgId: string,
  correlationId: string,
  opts: { maxPolls?: number; intervalMs?: number } = {},
): Promise<{ intent: IntentRecord; timedOut: boolean }> {
  const maxPolls  = opts.maxPolls  ?? 20;
  const intervalMs = opts.intervalMs ?? 3_000;
  let lastState: string | undefined;

  for (let i = 0; i < maxPolls; i++) {
    if (i > 0) await _sleep(intervalMs);

    try {
      const { intent } = await client.getIntent(intentId, orgId, correlationId);

      if (intent.state !== lastState) {
        obsIntentStateChange({ intentId, from: lastState, to: intent.state, correlationId });
        lastState = intent.state;
      }

      if (TERMINAL_INTENT_STATES.has(intent.state)) {
        // Also log task state if present
        for (const task of intent.tasks ?? []) {
          if (TERMINAL_TASK_STATES.has(task.state)) {
            obsTaskStateChange({ taskId: task.id, to: task.state, correlationId });
          }
        }
        return { intent, timedOut: false };
      }
    } catch {
      // Non-fatal — keep polling
    }
  }

  // Timed out
  const { intent } = await client.getIntent(intentId, orgId, correlationId).catch(() => ({
    intent: { id: intentId, state: "failed" as const, capabilityKey: "", goal: "", organizationId: orgId },
  }));
  return { intent, timedOut: true };
}

/**
 * Request verification and retrieve the outcome record.
 * This is the final step before marking work complete.
 */
export async function verifyAndRecordOutcome(
  client: TrainEfficiencyClient,
  args: {
    intent: IntentRecord;
    resourceId?: string;
    additionalArgs?: Record<string, unknown>;
    expectedResult?: string;
    confidence?: number;
    humanApproval?: "approved" | "rejected" | "none";
    correlationId: string;
  },
): Promise<VerificationRecord> {
  const { intent, correlationId } = args;
  const orgId = intent.organizationId;
  const capabilityKey = intent.capabilityKey;

  // Determine verification status from intent state
  const intentTerminal = TERMINAL_INTENT_STATES.has(intent.state);
  const tasks = intent.tasks ?? [];
  const taskTerminal = tasks.length === 0 || tasks.every((t: TaskRecord) => TERMINAL_TASK_STATES.has(t.state));

  // Attempt live verification if we have a resource ID
  let verificationStatus: VerificationRecord["verificationStatus"] = "pending";
  let deviations: string[] = [];
  let actualResult: string | undefined;

  if (args.resourceId && intent.state === "completed") {
    try {
      const { verification } = await client.submitVerification({
        intentId: intent.id,
        capabilityKey,
        resourceId: args.resourceId,
        additionalArgs: args.additionalArgs,
        orgId,
        correlationId,
      });

      verificationStatus = (verification.status as any) ?? "skipped";
      deviations = verification.deviation ? [verification.deviation as string] : [];
      actualResult = verification.status as string;

      if (verificationStatus === "failed" || verificationStatus === "partial") {
        obsVerificationFailed({ intentId: intent.id, deviation: deviations[0], correlationId });
      }
    } catch {
      verificationStatus = "skipped";
    }
  } else if (intent.state === "completed") {
    verificationStatus = "skipped"; // no resource to verify against
  } else if (intent.state === "failed") {
    verificationStatus = "failed";
    deviations.push(`Intent reached terminal state: ${intent.state}`);
  }

  // Determine final outcome
  const finalOutcome: VerificationRecord["finalOutcome"] =
    intent.state === "completed" && verificationStatus !== "failed"
      ? "success"
      : intent.state === "partially_completed"
        ? "partial"
        : intent.state === "failed" || intent.state === "dead_lettered"
          ? "failure"
          : "pending";

  obsOutcomeRetrieved({ intentId: intent.id, outcome: finalOutcome, correlationId });

  // Record the outcome for learning (fire-and-forget — never used to expand permissions)
  if (finalOutcome !== "pending") {
    void client.recordOutcome({
      intentId: intent.id,
      capabilityKey,
      outcome: finalOutcome,
      humanFeedback: args.humanApproval !== "none" ? args.humanApproval : undefined,
      kevinConfidence: args.confidence,
      orgId,
      correlationId,
    }).catch(() => { /* non-fatal */ });
  }

  const complete = intentTerminal && taskTerminal && finalOutcome !== "pending";
  const block: ActionBlock = finalOutcome === "success"
    ? buildOutcomeReport(intent, finalOutcome)
    : buildFailure({ summary: `Operation ${finalOutcome}: ${deviations[0] ?? intent.state}`, errorCode: deviations[0], retryable: false });

  return {
    intentId: intent.id,
    capabilityKey,
    organizationId: orgId,
    correlationId,
    expectedResult: args.expectedResult,
    actualResult,
    verificationStatus,
    deviations,
    finalOutcome,
    confidence: args.confidence,
    humanApproval: args.humanApproval,
    intentTerminal,
    taskTerminal,
    complete,
    block,
  };
}

function _sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
