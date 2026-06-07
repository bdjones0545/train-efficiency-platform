/**
 * Opportunity Outreach Execution Agent — Phase 7
 * Converts approved outreach drafts into real outbound conversations via AgentMail.
 *
 * Safety guarantees:
 * - Only approved drafts can be sent
 * - Every send requires an explicit human trigger
 * - No auto-send, no scheduled sends, no autonomous execution
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  sendAgentEmail,
  isAgentMailConfigured,
} from "./agentmail-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  executionId: string;
  messageId:   string | undefined;
  status:      "sent" | "failed" | "pending";
  error?:      string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? null;
}

async function logEvent(orgId: string, action: string, eventType = "scan"): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
      VALUES (${orgId}, 'Outreach Execution Agent', ${action}, ${eventType})
    `);
  } catch { /* non-fatal */ }
}

// ─── Table bootstrap ──────────────────────────────────────────────────────────

export async function ensureExecutionsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_outreach_executions (
      id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id               TEXT NOT NULL,
      opportunity_id       TEXT NOT NULL,
      draft_id             TEXT NOT NULL,
      recipient_name       TEXT NOT NULL DEFAULT '',
      recipient_email      TEXT NOT NULL,
      subject              TEXT NOT NULL,
      body                 TEXT NOT NULL,
      agentmail_message_id TEXT,
      status               TEXT NOT NULL DEFAULT 'pending',
      delivery_status      TEXT NOT NULL DEFAULT 'unknown',
      reply_detected       BOOLEAN NOT NULL DEFAULT FALSE,
      sent_at              TIMESTAMPTZ,
      delivered_at         TIMESTAMPTZ,
      replied_at           TIMESTAMPTZ,
      error_message        TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Add recipient_email column to outreach drafts for persistence
  await db.execute(sql`
    ALTER TABLE opportunity_outreach_drafts
      ADD COLUMN IF NOT EXISTS recipient_name  TEXT NOT NULL DEFAULT ''
  `);
  await db.execute(sql`
    ALTER TABLE opportunity_outreach_drafts
      ADD COLUMN IF NOT EXISTS recipient_email TEXT NOT NULL DEFAULT ''
  `);
}

// ─── Execute an approved outreach draft ───────────────────────────────────────

export async function executeOutreachDraft(
  orgId:          string,
  draftId:        string,
  recipientEmail: string,
  recipientName:  string = "",
): Promise<ExecutionResult> {
  await ensureExecutionsTable();

  // ── 1. Fetch and validate draft ─────────────────────────────────────────────
  const draft = row0(await db.execute(sql`
    SELECT d.*, o.title AS opportunity_title, o.company, o.type AS opportunity_type
    FROM   opportunity_outreach_drafts d
    JOIN   opportunity_acquisition_opportunities o ON o.id = d.opportunity_id
    WHERE  d.id = ${draftId} AND d.org_id = ${orgId}
  `));

  if (!draft) {
    throw Object.assign(new Error("Draft not found"), { status: 404 });
  }
  if (draft.status !== "approved") {
    throw Object.assign(
      new Error(`Draft must be approved before sending. Current status: ${draft.status}`),
      { status: 400 },
    );
  }

  const opportunityId: string = draft.opportunity_id;
  const subject:       string = draft.subject;
  const body:          string = draft.body;
  const company:       string = draft.company ?? "";
  const title:         string = draft.opportunity_title ?? "";

  await logEvent(orgId,
    `Outreach Execution Started — "${title}" at ${company || "unknown company"} (draft ${draftId})`,
    "draft",
  );

  // ── 2. Persist recipient on draft ───────────────────────────────────────────
  await db.execute(sql`
    UPDATE opportunity_outreach_drafts
    SET recipient_email = ${recipientEmail},
        recipient_name  = ${recipientName}
    WHERE id = ${draftId}
  `);

  // ── 3. Create execution record (pending) ────────────────────────────────────
  const execRow = row0(await db.execute(sql`
    INSERT INTO opportunity_outreach_executions
      (org_id, opportunity_id, draft_id, recipient_name, recipient_email,
       subject, body, status, delivery_status)
    VALUES
      (${orgId}, ${opportunityId}, ${draftId},
       ${recipientName}, ${recipientEmail},
       ${subject}, ${body}, 'pending', 'unknown')
    RETURNING id
  `));
  const executionId: string = execRow?.id ?? "unknown";

  // ── 4. Send via AgentMail ───────────────────────────────────────────────────
  let sendResult: { ok: boolean; messageId?: string; error?: string };

  if (!isAgentMailConfigured()) {
    // AgentMail not configured — mark as pending, log note, return gracefully
    const note = "AgentMail not configured. Execution queued as pending.";
    await db.execute(sql`
      UPDATE opportunity_outreach_executions
      SET status = 'pending', error_message = ${note}
      WHERE id = ${executionId}
    `);
    await logEvent(orgId, `Outreach Execution Pending — AgentMail not configured. Draft ${draftId} queued.`, "info");
    return { executionId, messageId: undefined, status: "pending", error: note };
  }

  try {
    sendResult = await sendAgentEmail({
      organizationId: orgId,
      agentName:      "Opportunity Outreach Agent",
      fromInbox:      "revenue",
      to:             recipientEmail,
      subject,
      body,
      replyTo:        undefined,
    });
  } catch (e: any) {
    sendResult = { ok: false, error: e.message };
  }

  // ── 5. Handle result ────────────────────────────────────────────────────────
  if (!sendResult.ok) {
    const errMsg = sendResult.error ?? "Unknown AgentMail error";
    await db.execute(sql`
      UPDATE opportunity_outreach_executions
      SET status = 'failed', error_message = ${errMsg}
      WHERE id = ${executionId}
    `);
    await logEvent(orgId,
      `Outreach Failed — "${title}" at ${company}: ${errMsg}`,
      "info",
    );
    throw Object.assign(new Error(errMsg), { status: 502, executionId });
  }

  const messageId = sendResult.messageId;

  // ── 6. Mark execution as sent ───────────────────────────────────────────────
  await db.execute(sql`
    UPDATE opportunity_outreach_executions SET
      status               = 'sent',
      delivery_status      = 'sent',
      agentmail_message_id = ${messageId ?? null},
      sent_at              = NOW()
    WHERE id = ${executionId}
  `);

  // ── 7. Update draft → sent ──────────────────────────────────────────────────
  await db.execute(sql`
    UPDATE opportunity_outreach_drafts
    SET status = 'sent', sent_at = NOW()
    WHERE id = ${draftId}
  `);

  // ── 8. Update opportunity → contacted ──────────────────────────────────────
  await db.execute(sql`
    UPDATE opportunity_acquisition_opportunities
    SET status = 'contacted'
    WHERE id = ${opportunityId} AND org_id = ${orgId}
  `);

  // ── 9. Log success events ───────────────────────────────────────────────────
  await logEvent(orgId,
    `Outreach Sent — "${title}" at ${company} (to: ${recipientEmail}, message: ${messageId ?? "n/a"})`,
    "draft",
  );

  return { executionId, messageId, status: "sent" };
}
