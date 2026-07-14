/**
 * Kevin ↔ AgentMail Bridge — Phase 8
 *
 * Connects Kevin intents to the existing AgentMail system.
 *
 * Kevin may:
 *  - Request a new email draft (email.create_draft)
 *  - Request a reply draft (email.reply_draft)
 *  - Submit a draft for approval (always routed through existing approval flow)
 *  - Inspect delivery status
 *  - Monitor replies and attributed outcomes
 *
 * Kevin must NOT:
 *  - Send emails autonomously unless org + capability are set to `auto`
 *  - Bypass AgentMail's existing Send Guard
 *  - Create a second email-writing system
 *
 * High-risk email actions default to: draft → approval → send
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { recordKevinAuditEvent } from "./kevin-audit-service";
import { recordKevinOutcome } from "./kevin-outcome-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DraftRequestInput {
  orgId: string;
  intentId: string;
  toName?: string;
  toEmail?: string;
  subject?: string;
  bodyContext?: string;
  leadId?: string;
  replyToActionId?: string;
  communicationDomain?: string;
  kevinConfidence?: number;
  producerAgent?: string;
}

export interface DraftResult {
  ok: boolean;
  actionId: string | null;
  draftExists: boolean;
  status: string;
  error?: string;
}

// ─── Draft creation ────────────────────────────────────────────────────────────

/**
 * Ask AgentMail to create a new outbound draft on Kevin's behalf.
 * Always creates a draft — never sends directly.
 * The draft will appear in the AI Approvals queue for human review.
 */
export async function requestEmailDraft(input: DraftRequestInput): Promise<DraftResult> {
  try {
    const actionId = randomUUID();
    const subject = input.subject ?? "Follow-up from Kevin";
    const body = input.bodyContext ?? "";

    await db.execute(sql`
      INSERT INTO gmail_agent_actions (
        id, org_id, action_type, status, recipient_email, subject, body_preview,
        lead_id, communication_domain, created_by_agent, approval_required, risk_level
      ) VALUES (
        ${actionId},
        ${input.orgId},
        'outbound_email',
        'proposed',
        ${input.toEmail ?? null},
        ${subject},
        ${body.slice(0, 500)},
        ${input.leadId ?? null},
        ${input.communicationDomain ?? "general"},
        ${"kevin"},
        true,
        'medium'
      )
    `);

    void recordKevinAuditEvent({
      orgId: input.orgId,
      eventType: "agentmail_bridge.draft_created",
      payload: {
        intentId: input.intentId,
        actionId,
        toEmail: input.toEmail ? `${input.toEmail.slice(0, 3)}***` : null,
        subject: subject.slice(0, 100),
      },
    });

    return { ok: true, actionId, draftExists: true, status: "draft" };
  } catch (e: any) {
    console.warn("[KevinAgentMailBridge] requestEmailDraft error:", e?.message);
    return { ok: false, actionId: null, draftExists: false, status: "error", error: e?.message };
  }
}

/**
 * Ask AgentMail to create a reply draft to an existing conversation.
 */
export async function requestReplyDraft(input: DraftRequestInput): Promise<DraftResult> {
  if (!input.replyToActionId) {
    return { ok: false, actionId: null, draftExists: false, status: "error", error: "replyToActionId required" };
  }

  try {
    // Look up the original action
    const origResult = await db.execute(sql`
      SELECT id, org_id, recipient_email, subject, lead_id, communication_domain
      FROM gmail_agent_actions
      WHERE id = ${input.replyToActionId} AND org_id = ${input.orgId}
      LIMIT 1
    `);
    const origRows = Array.isArray((origResult as any)?.rows)
      ? (origResult as any).rows
      : Array.isArray(origResult)
        ? origResult
        : [];
    const orig = origRows[0];

    const actionId = randomUUID();
    const subject = `Re: ${orig?.subject ?? input.subject ?? "Follow-up"}`;

    await db.execute(sql`
      INSERT INTO gmail_agent_actions (
        id, org_id, action_type, status, recipient_email, subject, body_preview,
        lead_id, communication_domain, created_by_agent, approval_required, risk_level
      ) VALUES (
        ${actionId},
        ${input.orgId},
        'reply',
        'proposed',
        ${orig?.recipient_email ?? input.toEmail ?? null},
        ${subject},
        ${(input.bodyContext ?? "").slice(0, 500)},
        ${orig?.lead_id ?? input.leadId ?? null},
        ${orig?.communication_domain ?? input.communicationDomain ?? "general"},
        ${"kevin"},
        true,
        'medium'
      )
    `);

    void recordKevinAuditEvent({
      orgId: input.orgId,
      eventType: "agentmail_bridge.reply_draft_created",
      payload: {
        intentId: input.intentId,
        actionId,
        replyToActionId: input.replyToActionId,
      },
    });

    return { ok: true, actionId, draftExists: true, status: "draft" };
  } catch (e: any) {
    console.warn("[KevinAgentMailBridge] requestReplyDraft error:", e?.message);
    return { ok: false, actionId: null, draftExists: false, status: "error", error: e?.message };
  }
}

/**
 * Inspect the current status of a draft/sent email action.
 */
export async function inspectEmailStatus(
  orgId: string,
  actionId: string,
): Promise<{
  found: boolean;
  status: string | null;
  humanApproved: boolean;
  sentAt: string | null;
  deliveryStatus: string | null;
}> {
  try {
    const result = await db.execute(sql`
      SELECT id, status, approved_by, executed_at
      FROM gmail_agent_actions
      WHERE id = ${actionId} AND org_id = ${orgId}
      LIMIT 1
    `);
    const rows = Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : Array.isArray(result)
        ? result
        : [];
    const row = rows[0];
    if (!row) return { found: false, status: null, humanApproved: false, sentAt: null, deliveryStatus: null };

    return {
      found: true,
      status: row.status ?? null,
      humanApproved: Boolean(row.approved_by),
      sentAt: row.executed_at?.toISOString?.() ?? null,
      deliveryStatus: row.status ?? null,
    };
  } catch {
    return { found: false, status: null, humanApproved: false, sentAt: null, deliveryStatus: null };
  }
}

/**
 * Record the outcome of an AgentMail action initiated by Kevin.
 */
export async function recordEmailOutcome(
  orgId: string,
  intentId: string,
  actionId: string,
  outcome: "accepted" | "rejected" | "modified" | "sent" | "failed",
  approvedBy?: string,
): Promise<void> {
  await recordKevinOutcome({
    orgId,
    outcome: outcome === "sent" ? "successful" : outcome === "accepted" ? "accepted" : outcome === "rejected" ? "rejected" : "modified",
    entityType: "agentmail_action",
    entityId: actionId,
    wasUseful: outcome !== "rejected",
    wasModified: outcome === "modified",
    recordedBy: approvedBy ?? "kevin_bridge",
    resultSummary: `Email ${outcome} for intent ${intentId}`,
  });
}

/**
 * List Kevin-initiated email drafts for an org.
 */
export async function listKevinDrafts(orgId: string, limit = 20): Promise<any[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, status, to_email, to_name, subject, human_approved,
             ai_confidence, created_at, sent_at, delivery_status, communication_domain
      FROM gmail_agent_actions
      WHERE org_id = ${orgId}
        AND source_agent = 'kevin'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rows = Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : Array.isArray(result)
        ? result
        : [];
    // Redact email addresses partially
    return rows.map((r: any) => ({
      ...r,
      to_email: r.to_email ? `${String(r.to_email).slice(0, 3)}***` : null,
    }));
  } catch {
    return [];
  }
}
