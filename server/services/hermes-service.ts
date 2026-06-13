/**
 * Hermes Service — Phase 1 + Sprint 1 Safety Fix
 *
 * Minimal, safe orchestration layer that connects system outcome events to
 * Obsidian learning notes via the existing recordOutcomeLearning() and
 * writeHermesLearning() functions in obsidian-service.ts.
 *
 * Sprint 1 addition:
 *   - Every Hermes event now ALSO writes to agent_operating_timeline
 *   - Timeline write succeeds even if Obsidian is down/unconfigured
 *   - Obsidian write failure never silences the timeline entry
 *
 * Phase 1 scope:
 *   - processOutcomeEvent() — single entry point for all Hermes learning writes
 *   - Supports: software_improvement_task_created, communication_outcome_recorded
 *   - Never throws if Obsidian is unavailable
 *   - Returns structured success/failure metadata for audit logging
 */

import {
  recordOutcomeLearning,
  writeHermesLearning,
  isObsidianConfigured,
} from "./obsidian-service";
import { writeTimeline } from "./ceo-heartbeat-service";

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
  timelineId?: string;
  skipped?: boolean;
  error?: string;
}

// ─── Timeline helper ───────────────────────────────────────────────────────────

async function writeHermesTimeline(opts: {
  orgId?: string;
  source: HermesSource;
  summary: string;
  metadata?: Record<string, any>;
  error?: string;
}): Promise<string | undefined> {
  if (!opts.orgId) return undefined;
  try {
    const id = await writeTimeline({
      orgId: opts.orgId,
      agentName: "Hermes Learning Engine",
      systemName: "Hermes",
      actionType: `hermes_${opts.source}`,
      actionStatus: opts.error ? "failed" : "completed",
      priority: 2,
      summary: opts.summary,
      errorMessage: opts.error,
      metadata: {
        source: opts.source,
        obsidianConfigured: isObsidianConfigured(),
        ...opts.metadata,
      },
    });
    return id || undefined;
  } catch (err: any) {
    console.warn("[Hermes] Timeline write failed (non-fatal):", err?.message);
    return undefined;
  }
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
    const summary = `[Hermes] Obsidian not configured — learning stored in timeline only (source=${source})`;
    console.log(summary);

    const timelineId = await writeHermesTimeline({
      orgId: payload.orgId,
      source,
      summary,
      metadata: { domain: payload.domain, skipped: true },
    });

    return { ...base, success: true, skipped: true, timelineId };
  }

  try {
    let result: HermesResult;

    if (source === "software_improvement_task_created") {
      result = await handleSoftwareImprovementTask(base, payload);
    } else if (source === "communication_outcome_recorded") {
      result = await handleCommunicationOutcome(base, payload);
    } else {
      console.warn(`[Hermes] Unknown source="${source}" — no learning written`);
      result = { ...base, success: false, error: `Unknown source: ${source}` };
    }

    const timelineId = await writeHermesTimeline({
      orgId: payload.orgId,
      source,
      summary: result.success
        ? `[Hermes] Learning written — source=${source} domain=${payload.domain}`
        : `[Hermes] Learning failed — source=${source}: ${result.error}`,
      metadata: {
        domain: payload.domain,
        taskId: payload.taskId,
        decisionId: payload.decisionId,
        agentType: payload.agentType,
        success: result.success,
      },
      error: result.success ? undefined : result.error,
    });

    return { ...result, timelineId };
  } catch (err: any) {
    const errMsg = err.message ?? "unknown error";
    console.error(`[Hermes] ✗ Failed to write learning (source=${source}): ${errMsg}`);

    const timelineId = await writeHermesTimeline({
      orgId: payload.orgId,
      source,
      summary: `[Hermes] Learning write failed — source=${source}: ${errMsg}`,
      metadata: { domain: payload.domain },
      error: errMsg,
    });

    return { ...base, success: false, error: errMsg, timelineId };
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
