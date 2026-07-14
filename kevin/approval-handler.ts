/**
 * Kevin Approval Handler — Step 14
 *
 * Conservative approval polling and state management.
 *
 * Rules:
 *   - Report exactly what is awaiting approval
 *   - Include the approval reference returned by TE
 *   - Stop execution chain when approval is pending
 *   - Poll conservatively (not repeatedly)
 *   - Resume only after approval state changes to a terminal state
 *   - Ensure approved payload still matches before proceeding
 *   - Respect approval expiration
 *   - A policy requiring approval is NOT an error
 */

import type { TrainEfficiencyClient, ApprovalRecord } from "./te-client";
import { TERMINAL_APPROVAL_STATES } from "./te-client";
import { obsApprovalStateChange } from "./observability";
import { buildApprovalRequired } from "./structured-responses";
import type { ActionBlock } from "./structured-responses";

export interface ApprovalPollResult {
  approval: ApprovalRecord;
  resolved: boolean;
  approved: boolean;
  rejected: boolean;
  expired: boolean;
  block: ActionBlock;
}

export interface ApprovalHandlerOptions {
  /** Max poll attempts (default: 12) */
  maxPolls?: number;
  /** Poll interval in ms (default: 5000 — conservative) */
  pollIntervalMs?: number;
  /** Whether to surface a structured block to the user on pending */
  emitPendingBlock?: boolean;
}

/**
 * Poll an approval conservatively until it reaches a terminal state or we time out.
 * Never hammers the endpoint — uses conservative intervals.
 * Stops and returns on first terminal state.
 */
export async function pollApproval(
  client: TrainEfficiencyClient,
  approvalId: string,
  orgId: string,
  correlationId: string,
  opts: ApprovalHandlerOptions = {},
): Promise<ApprovalPollResult> {
  const maxPolls     = opts.maxPolls     ?? 12;
  const intervalMs   = opts.pollIntervalMs ?? 5_000;

  let last: ApprovalRecord | null = null;
  let lastState: string | undefined;

  for (let i = 0; i < maxPolls; i++) {
    if (i > 0) await _sleep(intervalMs);

    try {
      const { approval } = await client.getApproval(approvalId, orgId, correlationId);
      last = approval;

      if (approval.state !== lastState) {
        obsApprovalStateChange({ approvalId, state: approval.state, correlationId });
        lastState = approval.state;
      }

      if (TERMINAL_APPROVAL_STATES.has(approval.state)) {
        return _buildResult(approval);
      }

      // Check expiry
      if (approval.expiresAt && new Date(approval.expiresAt) < new Date()) {
        return _buildResult({ ...approval, state: "expired" });
      }
    } catch {
      // Non-fatal poll failure — stop polling, return last known state
      break;
    }
  }

  // Timed out — return last known state or a synthetic pending
  const synthetic: ApprovalRecord = last ?? {
    id: approvalId,
    intentId: "",
    state: "pending",
    capabilityKey: "",
  };
  return {
    approval: synthetic,
    resolved: false,
    approved: false,
    rejected: false,
    expired: false,
    block: buildApprovalRequired(synthetic),
  };
}

function _buildResult(approval: ApprovalRecord): ApprovalPollResult {
  return {
    approval,
    resolved: TERMINAL_APPROVAL_STATES.has(approval.state),
    approved: approval.state === "approved",
    rejected: approval.state === "rejected",
    expired:  approval.state === "expired",
    block: buildApprovalRequired(approval),
  };
}

/**
 * Verify that the payload to be executed still matches the originally approved payload.
 * Must be called before proceeding after approval.
 */
export function verifyApprovalPayloadMatch(
  approvedPayload: Record<string, unknown>,
  currentPayload: Record<string, unknown>,
): { matches: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const sensitiveFields = new Set(["recipient", "recipientEmail", "organizationId", "orgId", "capabilityKey"]);

  for (const key of Object.keys(currentPayload)) {
    if (!sensitiveFields.has(key)) continue;
    if (JSON.stringify(approvedPayload[key]) !== JSON.stringify(currentPayload[key])) {
      mismatches.push(key);
    }
  }

  return { matches: mismatches.length === 0, mismatches };
}

function _sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
