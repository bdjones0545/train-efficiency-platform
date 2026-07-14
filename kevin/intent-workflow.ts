/**
 * Kevin Executive Intent Workflow — Steps 7 & 8
 *
 * Full operating loop:
 *   User request / platform signal
 *     → Determine executive objective
 *     → Discover applicable capability
 *     → Validate required arguments
 *     → Generate reason, confidence, expected result
 *     → Submit signed intent
 *     → Track intent and task states
 *     → Handle approval if required
 *     → Retrieve verified outcome
 *     → Report result
 *     → Update institutional memory
 *
 * Every request carries: requestId, idempotencyKey, correlationId,
 * organizationId, capabilityKey+version, structuredArgs, reason, goal,
 * confidence, expectedResult, sourceContext.
 *
 * Mode handling (Step 8):
 *   disabled          → explain unavailable, stop
 *   observe           → retrieve/inspect only, no side effects
 *   recommend         → provide recommendation, no side effects
 *   draft             → create reversible draft
 *   require_approval  → submit, surface approval state, STOP execution
 *   auto              → execute through control plane only
 */

import { randomUUID } from "crypto";
import type { TrainEfficiencyClient, IntentRecord, ApprovalRecord } from "./te-client";
import { TERMINAL_INTENT_STATES } from "./te-client";
import type { OperationalModel } from "./operational-model";
import { isCapabilityExecutable, getEffectiveMode } from "./operational-model";
import type { MappedCapability } from "./capability-map";
import type { ActionBlock } from "./structured-responses";
import {
  buildCapabilityUnavailable, buildDirectAnswer, buildRecommendation,
  buildDraftCreated, buildApprovalRequired, buildOutcomeReport,
  buildFailure, buildWarning, intentToBlock, modeToBlock,
} from "./structured-responses";
import { pollApproval, verifyApprovalPayloadMatch } from "./approval-handler";
import { pollIntentToCompletion, verifyAndRecordOutcome } from "./verification-handler";
import type { VerificationRecord } from "./verification-handler";
import {
  obsIntentSubmit, obsIntentStateChange, obsApprovalStateChange, obsOutcomeRetrieved,
} from "./observability";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExecutiveRequest {
  /** Natural-language goal from user or platform signal */
  goal: string;
  /** Reason Kevin is pursuing this goal */
  reason: string;
  /** Kevin's confidence that this capability is correct for the goal (0–1) */
  confidence: number;
  /** The specific capability Kevin intends to use */
  capabilityKey: string;
  capabilityVersion?: string;
  /** Structured arguments for the capability executor */
  structuredArgs?: Record<string, unknown>;
  /** What Kevin expects the result to be */
  expectedResult?: string;
  /** Organization scope — NEVER inferred from Kevin's own context */
  organizationId: string;
  /**
   * Initiating user ID if supplied by TrainEfficiency.
   * Kevin NEVER invents user authority.
   */
  initiatingUserId?: string;
  /** Source context for attribution */
  sourceContext?: Record<string, unknown>;
  /** Pre-computed idempotency key (optional — generated if absent) */
  idempotencyKey?: string;
  /** Thread-through correlation ID */
  correlationId?: string;
  /** If true, poll for completion (default: true) */
  awaitCompletion?: boolean;
  /** Resource ID for verification (e.g. draftId, actionId) — set after execution */
  resourceIdForVerification?: string;
}

export interface WorkflowResult {
  success: boolean;
  mode: string;
  intentId?: string;
  approvalId?: string;
  correlationId: string;
  block: ActionBlock;
  verification?: VerificationRecord;
  stopped: boolean;
  stopReason?: string;
  rawIntent?: IntentRecord;
}

// ─── Main workflow ────────────────────────────────────────────────────────────

/**
 * Execute the full Kevin executive intent workflow (Steps 7–8).
 * Returns a WorkflowResult with a structured ActionBlock for display.
 */
export async function executeIntentWorkflow(
  client: TrainEfficiencyClient,
  model: OperationalModel,
  req: ExecutiveRequest,
): Promise<WorkflowResult> {
  const correlationId = req.correlationId ?? randomUUID();
  const { capabilityKey, organizationId } = req;

  // ── Step 1: Check capability availability ───────────────────────────────────
  if (!isCapabilityExecutable(model, capabilityKey)) {
    return {
      success: false,
      mode: "disabled",
      correlationId,
      block: buildCapabilityUnavailable(capabilityKey, "Capability is not in the live registry or is disabled."),
      stopped: true,
      stopReason: "capability_not_executable",
    };
  }

  // ── Step 2: Get effective mode ──────────────────────────────────────────────
  const effectiveMode = getEffectiveMode(model, capabilityKey);

  // ── Step 3: Mode-specific pre-flight ───────────────────────────────────────
  const modeBlock = modeToBlock(effectiveMode, capabilityKey);

  if (effectiveMode === "disabled") {
    return {
      success: false,
      mode: "disabled",
      correlationId,
      block: buildCapabilityUnavailable(capabilityKey, "This capability is currently disabled."),
      stopped: true,
      stopReason: "capability_disabled",
    };
  }

  if (effectiveMode === "observe") {
    // Retrieve/inspect only — no side effects
    return {
      success: true,
      mode: "observe",
      correlationId,
      block: buildDirectAnswer("Observation", `Retrieving information for ${capabilityKey}. No side effects will be created.`),
      stopped: false,
    };
  }

  if (effectiveMode === "recommend") {
    // Provide recommendation only
    return {
      success: true,
      mode: "recommend",
      correlationId,
      block: buildRecommendation({
        title: `Recommendation: ${capabilityKey}`,
        summary: `Based on your objective — "${req.goal}" — Kevin recommends proceeding with this capability when escalated to draft or approval mode.`,
        confidence: req.confidence,
      }),
      stopped: false,
    };
  }

  // ── Step 4: Submit the intent ───────────────────────────────────────────────
  let intent: IntentRecord;
  try {
    const submitted = await client.submitIntent({
      organizationId,
      initiatingUserId: req.initiatingUserId, // never invented
      capabilityKey,
      capabilityVersion: req.capabilityVersion ?? "1",
      requestedMode: effectiveMode,
      goal: req.goal,
      reason: req.reason,
      confidence: req.confidence,
      structuredArgs: req.structuredArgs ?? {},
      sourceContext: req.sourceContext ?? { channel: "kevin_executive_agent" },
      idempotencyKey: req.idempotencyKey,
      correlationId,
    });
    intent = submitted.intent;
  } catch (err: any) {
    return {
      success: false,
      mode: effectiveMode,
      correlationId,
      block: buildFailure({ summary: `Failed to submit intent: ${err?.message ?? "unknown error"}`, errorCode: err?.code, retryable: err?.retryable ?? false }),
      stopped: true,
      stopReason: err?.code ?? "SUBMIT_FAILED",
    };
  }

  obsIntentSubmit({ intentId: intent.id, capabilityKey, correlationId, orgId: organizationId });

  // ── Step 5: Handle require_approval mode — STOP HERE ───────────────────────
  if (effectiveMode === "require_approval") {
    // Surface the approval state. Do NOT resubmit. Stop execution chain.
    const pendingApproval = intent.approvals?.[0];
    if (pendingApproval) {
      obsApprovalStateChange({ approvalId: pendingApproval.id, state: pendingApproval.state, correlationId });
      return {
        success: false,
        mode: "require_approval",
        intentId: intent.id,
        approvalId: pendingApproval.id,
        correlationId,
        block: buildApprovalRequired(pendingApproval),
        stopped: true,
        stopReason: "awaiting_approval",
        rawIntent: intent,
      };
    }

    // Intent submitted but approval record not yet created — poll once
    await _sleep(2000);
    try {
      const { intent: refreshed } = await client.getIntent(intent.id, organizationId, correlationId);
      intent = refreshed;
      obsIntentStateChange({ intentId: intent.id, from: "received", to: intent.state, correlationId });

      const approval = refreshed.approvals?.[0];
      if (approval) {
        return {
          success: false,
          mode: "require_approval",
          intentId: intent.id,
          approvalId: approval.id,
          correlationId,
          block: buildApprovalRequired(approval),
          stopped: true,
          stopReason: "awaiting_approval",
          rawIntent: intent,
        };
      }
    } catch { /* non-fatal */ }

    return {
      success: false,
      mode: "require_approval",
      intentId: intent.id,
      correlationId,
      block: buildWarning({ title: "Awaiting Approval", summary: "An approval has been requested. Kevin will not proceed until a human approves this action.", severity: "medium" }),
      stopped: true,
      stopReason: "awaiting_approval",
      rawIntent: intent,
    };
  }

  // ── Step 6: Draft mode — create reversible draft ────────────────────────────
  if (effectiveMode === "draft") {
    // Intent submitted — surface the draft state
    return {
      success: true,
      mode: "draft",
      intentId: intent.id,
      correlationId,
      block: buildDraftCreated({ intentId: intent.id }),
      stopped: false,
      rawIntent: intent,
    };
  }

  // ── Step 7: Auto mode — poll for completion and verify ─────────────────────
  if (req.awaitCompletion !== false) {
    const { intent: finalIntent, timedOut } = await pollIntentToCompletion(
      client, intent.id, organizationId, correlationId,
    );

    if (timedOut && !TERMINAL_INTENT_STATES.has(finalIntent.state)) {
      return {
        success: false,
        mode: effectiveMode,
        intentId: intent.id,
        correlationId,
        block: buildWarning({ title: "Execution Timed Out", summary: `Intent for ${capabilityKey} has not reached a terminal state yet. Kevin will not retry.`, severity: "medium" }),
        stopped: true,
        stopReason: "poll_timeout",
        rawIntent: finalIntent,
      };
    }

    // Verify and record outcome
    const verification = await verifyAndRecordOutcome(client, {
      intent: finalIntent,
      resourceId: req.resourceIdForVerification,
      expectedResult: req.expectedResult,
      confidence: req.confidence,
      humanApproval: "none",
      correlationId,
    });

    obsOutcomeRetrieved({ intentId: finalIntent.id, outcome: verification.finalOutcome, correlationId });

    return {
      success: verification.finalOutcome === "success",
      mode: effectiveMode,
      intentId: finalIntent.id,
      correlationId,
      block: verification.block,
      verification,
      stopped: false,
      rawIntent: finalIntent,
    };
  }

  // Async — return submitted state without waiting
  return {
    success: true,
    mode: effectiveMode,
    intentId: intent.id,
    correlationId,
    block: intentToBlock(intent),
    stopped: false,
    rawIntent: intent,
  };
}

// ─── Resume after approval ────────────────────────────────────────────────────

/**
 * Resume workflow after an approval has been granted.
 * Validates payload match, then polls for completion and verifies outcome.
 */
export async function resumeAfterApproval(
  client: TrainEfficiencyClient,
  args: {
    intentId: string;
    approval: ApprovalRecord;
    originalPayload: Record<string, unknown>;
    expectedResult?: string;
    confidence?: number;
    organizationId: string;
    correlationId: string;
    resourceIdForVerification?: string;
  },
): Promise<WorkflowResult> {
  const { correlationId, organizationId } = args;

  // Verify payload hasn't changed since approval
  const payloadCheck = verifyApprovalPayloadMatch(
    args.approval as unknown as Record<string, unknown>,
    args.originalPayload,
  );

  if (!payloadCheck.matches) {
    return {
      success: false,
      mode: "require_approval",
      intentId: args.intentId,
      correlationId,
      block: buildFailure({
        title: "Payload Mismatch After Approval",
        summary: `Approved payload no longer matches: fields changed: ${payloadCheck.mismatches.join(", ")}. Cannot proceed.`,
        errorCode: "PAYLOAD_MISMATCH",
        retryable: false,
      }),
      stopped: true,
      stopReason: "payload_mismatch",
    };
  }

  // Poll to completion
  const { intent: finalIntent } = await pollIntentToCompletion(client, args.intentId, organizationId, correlationId);

  // Verify and record
  const verification = await verifyAndRecordOutcome(client, {
    intent: finalIntent,
    resourceId: args.resourceIdForVerification,
    expectedResult: args.expectedResult,
    confidence: args.confidence,
    humanApproval: args.approval.state === "approved" ? "approved" : "rejected",
    correlationId,
  });

  return {
    success: verification.finalOutcome === "success",
    mode: "require_approval",
    intentId: finalIntent.id,
    correlationId,
    block: verification.block,
    verification,
    stopped: false,
    rawIntent: finalIntent,
  };
}

function _sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
