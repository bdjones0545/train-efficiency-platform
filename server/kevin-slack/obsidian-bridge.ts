/**
 * Kevin Slack EOH — Obsidian Memory Bridge
 *
 * Stores sanitized Kevin memory events in Obsidian.
 *
 * Rules:
 * - Never store full Slack transcripts
 * - Never store casual conversation
 * - Never store Slack tokens, signing secrets, or raw PII
 * - Use structured summaries: intent / decision / action / outcome / confidence / traceId
 * - Obsidian failure must NEVER block Slack actions or TE workflows
 */

import { isObsidianMemoryEnabled } from "./config";

export interface KevinSlackMemoryEvent {
  intent: string;
  decision: string;
  action: string;
  outcome: string;
  organization: string;
  application: "trainefficiency";
  confidence: number;
  traceId: string;
  slackTeamId: string;
  slackUserId: string;
}

const ELIGIBLE_INTENTS = new Set([
  "create_session",
  "reschedule_session",
  "cancel_session",
  "view_schedule",
  "view_approvals",
  "health_check",
]);

export async function storeSlackMemoryEvent(event: KevinSlackMemoryEvent): Promise<void> {
  if (!isObsidianMemoryEnabled()) return;
  if (!ELIGIBLE_INTENTS.has(event.intent)) return;

  try {
    const { createNote } = await import("../services/obsidian-service");

    const folder = "Kevin/Slack";
    const title = `Slack-${event.intent}-${event.traceId.slice(0, 8)}`;
    const content = [
      "---",
      `intent: ${event.intent}`,
      `decision: ${event.decision}`,
      `action: ${event.action}`,
      `outcome: ${event.outcome}`,
      `organization: ${event.organization}`,
      `application: ${event.application}`,
      `confidence: ${event.confidence}`,
      `trace_id: ${event.traceId}`,
      `recorded_at: ${new Date().toISOString()}`,
      "---",
      "",
      `## Kevin Slack Interaction`,
      ``,
      `**Intent:** ${event.intent}`,
      `**Decision:** ${event.decision}`,
      `**Action:** ${event.action}`,
      `**Outcome:** ${event.outcome}`,
      `**Confidence:** ${(event.confidence * 100).toFixed(0)}%`,
      ``,
      `*TraceID: ${event.traceId}*`,
    ].join("\n");

    await createNote(folder, title, content, {
      tags: ["kevin", "slack", event.intent, "auto-captured"],
    });
  } catch (err: any) {
    // Obsidian failure must never propagate
    console.warn("[Kevin Slack] Obsidian bridge error (non-blocking):", err?.message);
  }
}
