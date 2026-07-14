/**
 * Kevin Closed-Loop Learning Service — Phase 14
 *
 * Connects Kevin execution outcomes to the Hermes auto-learnings system.
 * Records: intent, capability, recommendation, draft, approval, execution,
 * verification, downstream business outcome, human feedback, Kevin confidence.
 *
 * Rules:
 * - Never allows Kevin to autonomously grant himself broader permissions
 * - Learning improves recommendations and confidence only
 * - Permission changes require authorized human action
 */

import { recordHermesLearning } from "./hermes-learning-service";
import { db } from "../db";
import { sql } from "drizzle-orm";

export type OutcomeType =
  | "intent_completed"
  | "intent_failed"
  | "intent_cancelled"
  | "task_completed"
  | "task_failed"
  | "draft_created"
  | "draft_approved"
  | "draft_rejected"
  | "email_sent"
  | "email_failed"
  | "approval_approved"
  | "approval_rejected"
  | "policy_denied"
  | "verification_failed"
  | "verification_passed";

export interface KevinOutcomeLearningInput {
  orgId: string;
  intentId: string;
  capabilityKey: string;
  outcomeType: OutcomeType;
  outcome: "success" | "failure" | "partial" | "rejected";
  recommendation?: string;
  draftId?: string;
  approvalResult?: "approved" | "rejected" | "requested_changes";
  executionResult?: "success" | "failure";
  verificationResult?: "passed" | "failed" | "partial" | "skipped";
  downstreamBusinessOutcome?: string;
  humanFeedback?: string;
  specialistAgent?: string;
  kevinConfidence?: number;
  timeToCompletionMs?: number;
  shouldRepeat?: boolean;
  policyRecommendation?: string;
  correlationId?: string;
}

// ─── Record a Kevin outcome learning ─────────────────────────────────────────

export async function recordKevinOutcomeLearning(input: KevinOutcomeLearningInput): Promise<void> {
  try {
    const {
      orgId, intentId, capabilityKey, outcomeType, outcome,
      recommendation, draftId, approvalResult, executionResult,
      verificationResult, downstreamBusinessOutcome, humanFeedback,
      specialistAgent, kevinConfidence, timeToCompletionMs,
      shouldRepeat, policyRecommendation, correlationId,
    } = input;

    // Determine learning type
    const memoryType = outcome === "success" ? "success_pattern" : "failure_pattern";

    // Build structured insight
    const parts: string[] = [
      `Kevin executed capability '${capabilityKey}' with outcome '${outcome}'.`,
    ];
    if (recommendation) parts.push(`Recommendation: ${recommendation}`);
    if (approvalResult) parts.push(`Human approval: ${approvalResult}`);
    if (executionResult) parts.push(`Execution: ${executionResult}`);
    if (verificationResult) parts.push(`Verification: ${verificationResult}`);
    if (downstreamBusinessOutcome) parts.push(`Business outcome: ${downstreamBusinessOutcome}`);
    if (humanFeedback) parts.push(`Human feedback: ${humanFeedback}`);
    if (specialistAgent) parts.push(`Specialist agent: ${specialistAgent}`);
    if (kevinConfidence !== undefined) parts.push(`Kevin confidence: ${kevinConfidence}`);
    if (timeToCompletionMs) parts.push(`Time to complete: ${Math.round(timeToCompletionMs / 1000)}s`);
    if (shouldRepeat !== undefined) parts.push(`Should repeat: ${shouldRepeat}`);
    if (policyRecommendation) parts.push(`Policy note: ${policyRecommendation}`);

    const content = parts.join(" | ");

    // Confidence weight: approvals carry 1.0, rejections 0.7 (per architecture spec)
    const baseConfidence = approvalResult === "approved" ? 100 : approvalResult === "rejected" ? 70 : 85;
    const confidenceScore = Math.min(100, Math.max(50, baseConfidence));

    await recordHermesLearning({
      orgId,
      domain: "kevin_operations",
      source: "kevin_executive_agent",
      memoryType,
      content,
      confidenceScore,
      sourceContext: {
        intentId,
        capabilityKey,
        outcomeType,
        correlationId,
        draftId,
        specialistAgent,
      },
    });

    // Also write to the kevin_outcomes table if it exists
    await db.execute(sql`
      INSERT INTO kevin_outcomes (
        id, org_id, intent_id, capability_key, outcome_type, outcome,
        approval_result, execution_result, verification_result,
        specialist_agent, kevin_confidence, time_to_completion_ms,
        should_repeat, human_feedback, correlation_id, recorded_at
      ) VALUES (
        gen_random_uuid(), ${orgId}, ${intentId}, ${capabilityKey}, ${outcomeType}, ${outcome},
        ${approvalResult ?? null}, ${executionResult ?? null}, ${verificationResult ?? null},
        ${specialistAgent ?? null}, ${kevinConfidence ?? null}, ${timeToCompletionMs ?? null},
        ${shouldRepeat ?? null}, ${humanFeedback ?? null}, ${correlationId ?? null}, NOW()
      )
      ON CONFLICT DO NOTHING
    `).catch(() => { /* kevin_outcomes may not exist yet — non-fatal */ });

  } catch {
    /* non-fatal — learning failures must never block execution */
  }
}

// ─── Table setup ─────────────────────────────────────────────────────────────

export async function ensureKevinOutcomesTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kevin_outcomes (
      id                    TEXT PRIMARY KEY,
      org_id                TEXT NOT NULL,
      intent_id             TEXT,
      capability_key        TEXT NOT NULL,
      outcome_type          TEXT NOT NULL,
      outcome               TEXT NOT NULL,
      approval_result       TEXT,
      execution_result      TEXT,
      verification_result   TEXT,
      specialist_agent      TEXT,
      kevin_confidence      NUMERIC,
      time_to_completion_ms BIGINT,
      should_repeat         BOOLEAN,
      human_feedback        TEXT,
      correlation_id        TEXT,
      recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ko_org       ON kevin_outcomes (org_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ko_capability ON kevin_outcomes (capability_key)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ko_outcome    ON kevin_outcomes (outcome)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ko_recorded   ON kevin_outcomes (recorded_at DESC)`);
}

// ─── Query recent outcomes ────────────────────────────────────────────────────

export async function getRecentKevinOutcomes(
  orgId: string,
  limit = 20,
): Promise<any[]> {
  try {
    const rows = await db.execute(sql`
      SELECT * FROM kevin_outcomes
      WHERE org_id = ${orgId}
      ORDER BY recorded_at DESC
      LIMIT ${limit}
    `);
    return Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
  } catch {
    return [];
  }
}

export async function getCapabilityOutcomeStats(orgId: string): Promise<any[]> {
  try {
    const rows = await db.execute(sql`
      SELECT
        capability_key,
        COUNT(*)                                             AS total,
        COUNT(*) FILTER (WHERE outcome = 'success')          AS successes,
        COUNT(*) FILTER (WHERE outcome = 'failure')          AS failures,
        AVG(kevin_confidence)                                AS avg_confidence,
        AVG(time_to_completion_ms)                           AS avg_completion_ms
      FROM kevin_outcomes
      WHERE org_id = ${orgId}
      GROUP BY capability_key
      ORDER BY total DESC
    `);
    return Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
  } catch {
    return [];
  }
}
