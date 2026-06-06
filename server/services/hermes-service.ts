/**
 * Hermes Service — Phase 1
 *
 * Minimal, safe orchestration layer that connects system outcome events to
 * Obsidian learning notes via the existing recordOutcomeLearning() and
 * writeHermesLearning() functions in obsidian-service.ts.
 *
 * Phase 1 scope:
 *   - processOutcomeEvent() — single entry point for all Hermes learning writes
 *   - Supports: software_improvement_task_created, communication_outcome_recorded
 *   - Never throws if Obsidian is unavailable
 *   - Returns structured success/failure metadata for audit logging
 *
 * NOT in Phase 1:
 *   - No external Hermes API
 *   - No Codex submission
 *   - No autonomous trust updates
 *   - No agent prompt injection
 */

import {
  recordOutcomeLearning,
  writeHermesLearning,
  isObsidianConfigured,
} from "./obsidian-service";

// ─── Source types ──────────────────────────────────────────────────────────────

export type HermesSource =
  | "software_improvement_task_created"
  | "communication_outcome_recorded";

// ─── Payload ───────────────────────────────────────────────────────────────────

export interface HermesOutcomePayload {
  orgId?: string;
  domain: string;
  tags?: string[];

  // software_improvement_task_created
  taskId?: string;
  severity?: string;
  title?: string;
  affectedArea?: string;

  // communication_outcome_recorded
  agentType?: string;
  outcomeStatus?: string;
  outcomeScore?: number;
  revenueCents?: number;
  decisionId?: string;
}

// ─── Result ────────────────────────────────────────────────────────────────────

export interface HermesResult {
  success: boolean;
  source: HermesSource;
  obsidianConfigured: boolean;
  skipped?: boolean;
  error?: string;
}

// ─── Main entry point ──────────────────────────────────────────────────────────

export async function processOutcomeEvent(
  source: HermesSource,
  payload: HermesOutcomePayload,
): Promise<HermesResult> {
  const base: Omit<HermesResult, "success"> = {
    source,
    obsidianConfigured: isObsidianConfigured(),
  };

  if (!isObsidianConfigured()) {
    console.log(
      `[Hermes] Obsidian not configured — skipping learning write (source=${source})`,
    );
    return { ...base, success: true, skipped: true };
  }

  try {
    if (source === "software_improvement_task_created") {
      return await handleSoftwareImprovementTask(base, payload);
    }

    if (source === "communication_outcome_recorded") {
      return await handleCommunicationOutcome(base, payload);
    }

    console.warn(`[Hermes] Unknown source="${source}" — no learning written`);
    return { ...base, success: false, error: `Unknown source: ${source}` };
  } catch (err: any) {
    console.error(
      `[Hermes] ✗ Failed to write learning (source=${source}): ${err.message}`,
    );
    return { ...base, success: false, error: err.message };
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleSoftwareImprovementTask(
  base: Omit<HermesResult, "success">,
  payload: HermesOutcomePayload,
): Promise<HermesResult> {
  const { taskId, severity = "medium", title, affectedArea, orgId, tags } = payload;

  const outcome = `A ${severity} severity software issue was detected: "${title ?? "unknown"}"`;
  const observation = affectedArea
    ? `Affected area: ${affectedArea}`
    : "Affected area not specified";
  const learning = [
    `Engineering task created for review${taskId ? ` (id: ${taskId})` : ""}.`,
    `Priority: ${severity}.`,
    `Engineering team should investigate and resolve the reported issue.`,
  ].join(" ");

  await recordOutcomeLearning({
    outcome,
    observation,
    learning,
    domain: payload.domain,
    orgId,
    tags: ["software_improvement", severity, ...(tags ?? [])],
  });

  console.log(
    `[Hermes] ✓ Learning written — source=software_improvement_task_created taskId=${taskId ?? "unknown"} severity=${severity}`,
  );
  return { ...base, success: true };
}

async function handleCommunicationOutcome(
  base: Omit<HermesResult, "success">,
  payload: HermesOutcomePayload,
): Promise<HermesResult> {
  const {
    agentType,
    domain,
    outcomeStatus = "recorded",
    outcomeScore,
    revenueCents,
    decisionId,
    orgId,
    tags,
  } = payload;

  const scoreNote =
    outcomeScore != null ? ` (score: ${outcomeScore}/100)` : "";
  const revenueNote =
    revenueCents != null && revenueCents > 0
      ? `  \n**Revenue:** $${(revenueCents / 100).toFixed(2)}`
      : "";

  const topic = `${agentType ?? "agent"} outcome — ${domain}`;
  const content = [
    `**Status:** ${outcomeStatus}${scoreNote}`,
    `**Domain:** ${domain}`,
    `**Agent:** ${agentType ?? "unknown"}`,
    decisionId ? `**Decision ID:** ${decisionId}` : null,
    revenueNote || null,
  ]
    .filter(Boolean)
    .join("  \n");

  await writeHermesLearning({
    topic,
    content,
    source: "agent_communication_outcomes",
    orgId,
    tags: [
      "communication_outcome",
      domain,
      agentType ?? "unknown",
      ...(tags ?? []),
    ],
  });

  console.log(
    `[Hermes] ✓ Learning written — source=communication_outcome_recorded decisionId=${decisionId ?? "unknown"} domain=${domain}`,
  );
  return { ...base, success: true };
}
