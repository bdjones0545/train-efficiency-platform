/**
 * Kevin Outcome Service — Phase 3
 *
 * Records closed-loop feedback (approval, rejection, modification, dismissal)
 * and forwards outcomes asynchronously to Kevin/Hermes behind
 * KEVIN_OUTCOME_FORWARDING_ENABLED.
 *
 * Key principles:
 * - Non-blocking and fail-open
 * - Approval ≠ operational success (these are separate outcomes)
 * - Org-isolated
 * - Sanitized payloads (no secrets, no raw PII)
 *
 * Hermes /v1/outcomes endpoint is not yet available.
 * Outcomes are stored locally; forwarding activates when the endpoint exists.
 */

import { db } from "../db";
import { kevinOutcomes } from "@shared/schema";
import { eq, and, lte } from "drizzle-orm";
import { randomUUID } from "crypto";
import { recordKevinAuditEvent } from "./kevin-audit-service";

// ─── Config ───────────────────────────────────────────────────────────────────

function isOutcomeForwardingEnabled(): boolean {
  const master = (process.env.KEVIN_INTEGRATION_ENABLED || "").trim().toLowerCase();
  const fwd = (process.env.KEVIN_OUTCOME_FORWARDING_ENABLED || "").trim().toLowerCase();
  const truthy = (v: string) => v === "1" || v === "true" || v === "yes";
  return truthy(master) && truthy(fwd);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type KevinOutcomeInput = {
  orgId: string;
  outcome:
    | "accepted"
    | "modified"
    | "rejected"
    | "dismissed"
    | "no_action"
    | "successful"
    | "unsuccessful"
    | "unknown";
  signalId?: string | null;
  contextRequestId?: string | null;
  runId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  resultSummary?: string | null;
  wasUseful?: boolean | null;
  wasModified?: boolean | null;
  recurred?: boolean | null;
  recordedBy?: string | null;
};

// ─── Record ───────────────────────────────────────────────────────────────────

/**
 * Record a Kevin outcome. Non-blocking, fail-open.
 * Returns the outcome ID or null on failure.
 */
export async function recordKevinOutcome(
  input: KevinOutcomeInput,
): Promise<string | null> {
  try {
    if (!(process.env.KEVIN_INTEGRATION_ENABLED || "").match(/^(1|true|yes)$/i)) {
      return null;
    }

    const id = randomUUID();
    await db.insert(kevinOutcomes).values({
      id,
      orgId: input.orgId,
      signalId: input.signalId ?? null,
      contextRequestId: input.contextRequestId ?? null,
      runId: input.runId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      outcome: input.outcome,
      resultSummary: input.resultSummary
        ? String(input.resultSummary).slice(0, 1000)
        : null,
      wasUseful: input.wasUseful ?? null,
      wasModified: input.wasModified ?? null,
      recurred: input.recurred ?? null,
      recordedBy: input.recordedBy ? String(input.recordedBy).slice(0, 200) : null,
      forwardStatus: "pending",
      forwardAttempts: 0,
    });

    void recordKevinAuditEvent({
      orgId: input.orgId,
      eventType: "outcome.recorded",
      payload: {
        outcomeId: id,
        outcome: input.outcome,
        entityType: input.entityType ?? null,
        signalId: input.signalId ?? null,
      },
    });

    // Async forward (non-blocking)
    void forwardKevinOutcome(id);

    return id;
  } catch (e: any) {
    console.warn("[KevinOutcomes] record failed (non-fatal):", e?.message);
    return null;
  }
}

// ─── Forward ──────────────────────────────────────────────────────────────────

/**
 * Forward a single outcome to Kevin/Hermes.
 *
 * NOTE: Hermes /v1/outcomes endpoint is not yet available.
 * Outcomes are stored locally. When the endpoint is ready:
 *   1. Set KEVIN_OUTCOME_FORWARDING_ENABLED=true
 *   2. Hermes will receive structured outcome payloads for learning
 *
 * Required Hermes contract:
 *   POST /v1/outcomes
 *   Authorization: Bearer {KEVIN_HERMES_API_KEY}
 *   Content-Type: application/json
 *   Body: { outcome_id, org_id, outcome_type, signal_id, context_request_id,
 *           entity_type, entity_id, was_useful, was_modified, summary, occurred_at }
 *   Response: { ok: true, outcome_id: string }
 */
export async function forwardKevinOutcome(outcomeId: string): Promise<void> {
  if (!isOutcomeForwardingEnabled()) return;

  try {
    const [outcome] = await db
      .select()
      .from(kevinOutcomes)
      .where(eq(kevinOutcomes.id, outcomeId))
      .limit(1);
    if (!outcome) return;
    if (outcome.forwardStatus === "forwarded") return;

    // Hermes endpoint not yet available — store for later
    // When available, call hermesSubmitOutcome() here
    const { hermesSubmitOutcome } = await import("./kevin-hermes-client");
    await hermesSubmitOutcome({
      outcomeId: outcome.id,
      orgId: outcome.orgId,
      outcomeType: outcome.outcome,
      signalId: outcome.signalId ?? undefined,
      contextRequestId: outcome.contextRequestId ?? undefined,
      entityType: outcome.entityType ?? undefined,
      entityId: outcome.entityId ?? undefined,
      wasUseful: outcome.wasUseful ?? undefined,
      wasModified: outcome.wasModified ?? undefined,
      summary: outcome.resultSummary ?? undefined,
      occurredAt: outcome.createdAt?.toISOString() ?? new Date().toISOString(),
    });

    await db
      .update(kevinOutcomes)
      .set({ forwardStatus: "forwarded", forwardedAt: new Date() })
      .where(eq(kevinOutcomes.id, outcomeId));
  } catch (e: any) {
    // Fail gracefully — increment attempts, mark failed
    try {
      await db
        .update(kevinOutcomes)
        .set({
          forwardStatus: "failed",
          lastForwardError: String(e?.message ?? e).slice(0, 400),
          forwardAttempts: db
            .select({ c: kevinOutcomes.forwardAttempts })
            .from(kevinOutcomes)
            .where(eq(kevinOutcomes.id, outcomeId))
            .then((r) => (r[0]?.c ?? 0) + 1) as any,
        })
        .where(eq(kevinOutcomes.id, outcomeId));
    } catch {}
  }
}

// ─── Flush ────────────────────────────────────────────────────────────────────

export async function flushPendingKevinOutcomes(): Promise<void> {
  if (!isOutcomeForwardingEnabled()) return;
  try {
    const pending = await db
      .select()
      .from(kevinOutcomes)
      .where(eq(kevinOutcomes.forwardStatus, "pending"))
      .limit(50);
    for (const o of pending) {
      await forwardKevinOutcome(o.id).catch(() => {});
    }
  } catch {}
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export async function recordAgentMailApproved(opts: {
  orgId: string;
  replyId: string;
  approvedBy: string;
  hadEdits: boolean;
  contextRequestId?: string | null;
}): Promise<void> {
  await recordKevinOutcome({
    orgId: opts.orgId,
    outcome: opts.hadEdits ? "modified" : "accepted",
    entityType: "agentmail_reply",
    entityId: opts.replyId,
    wasModified: opts.hadEdits,
    wasUseful: true,
    recordedBy: opts.approvedBy,
    contextRequestId: opts.contextRequestId ?? null,
    resultSummary: opts.hadEdits ? "Approved with edits" : "Approved without edits",
  });
}

export async function recordAgentMailRejected(opts: {
  orgId: string;
  replyId: string;
  rejectedBy: string;
  reason?: string | null;
  contextRequestId?: string | null;
}): Promise<void> {
  await recordKevinOutcome({
    orgId: opts.orgId,
    outcome: "rejected",
    entityType: "agentmail_reply",
    entityId: opts.replyId,
    wasUseful: false,
    recordedBy: opts.rejectedBy,
    contextRequestId: opts.contextRequestId ?? null,
    resultSummary: opts.reason
      ? `Rejected: ${opts.reason.slice(0, 200)}`
      : "Rejected",
  });
}

export async function recordSignalDismissed(opts: {
  orgId: string;
  signalId: string;
  dismissedBy: string;
}): Promise<void> {
  await recordKevinOutcome({
    orgId: opts.orgId,
    outcome: "dismissed",
    signalId: opts.signalId,
    entityType: "kevin_signal",
    entityId: opts.signalId,
    recordedBy: opts.dismissedBy,
    resultSummary: "Signal dismissed by admin",
  });
}
