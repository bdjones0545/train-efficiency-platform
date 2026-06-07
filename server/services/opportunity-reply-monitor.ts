/**
 * Opportunity Reply Monitor — Phase 8
 * Polls AgentMail inboxes for replies associated with sent opportunity outreach.
 * Ingests replies, runs classification, and persists results.
 *
 * Safety: read + classify only — no autonomous replies.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  getInboxMessages,
  isAgentMailConfigured,
  type AgentInbox,
} from "./agentmail-service";
import {
  classifyReply,
  ensureReplyEventsTable,
} from "./opportunity-reply-intelligence-agent";

// ─── Inboxes to monitor ───────────────────────────────────────────────────────

const MONITORED_INBOXES: AgentInbox[] = ["revenue", "operations", "ceo"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}

// ─── Manual / simulated reply ingestion (used by POST endpoint) ───────────────

export async function ingestReply(
  orgId: string,
  payload: {
    executionId: string;
    senderName:  string;
    senderEmail: string;
    subject:     string;
    body:        string;
    receivedAt?: string;
  },
): Promise<{ replyId: string; classification: string; suggestedNextAction: string }> {
  await ensureReplyEventsTable();

  const result = await classifyReply(orgId, payload.executionId, {
    senderName:  payload.senderName,
    senderEmail: payload.senderEmail,
    subject:     payload.subject,
    body:        payload.body,
    receivedAt:  payload.receivedAt ?? new Date().toISOString(),
  });

  // Fetch the reply event we just created (most recent for this execution)
  const r = rows(await db.execute(sql`
    SELECT id FROM opportunity_reply_events
    WHERE org_id = ${orgId} AND execution_id = ${payload.executionId}
    ORDER BY created_at DESC LIMIT 1
  `));

  return {
    replyId:             r[0]?.id ?? "unknown",
    classification:      result.classification,
    suggestedNextAction: result.suggestedNextAction,
  };
}

// ─── Poll AgentMail inboxes for replies ───────────────────────────────────────

export async function pollInboxesForReplies(orgId: string): Promise<{
  checked: number;
  newReplies: number;
  errors: string[];
}> {
  await ensureReplyEventsTable();

  if (!isAgentMailConfigured()) {
    return { checked: 0, newReplies: 0, errors: ["AgentMail not configured"] };
  }

  // Fetch all sent executions for this org to match replies
  const executions = rows(await db.execute(sql`
    SELECT id, agentmail_message_id, recipient_email, opportunity_id
    FROM   opportunity_outreach_executions
    WHERE  org_id = ${orgId} AND status IN ('sent', 'delivered')
  `));

  if (executions.length === 0) return { checked: 0, newReplies: 0, errors: [] };

  // Build lookup: messageId → executionId
  const messageMap = new Map<string, string>();
  for (const ex of executions) {
    if (ex.agentmail_message_id) messageMap.set(ex.agentmail_message_id, ex.id);
  }

  // Fetch already-seen reply subjects to avoid duplicates
  const seenRows = rows(await db.execute(sql`
    SELECT sender_email, subject FROM opportunity_reply_events WHERE org_id = ${orgId}
  `));
  const seenKeys = new Set(seenRows.map((r: any) => `${r.sender_email}::${r.subject}`));

  let checked  = 0;
  let newReplies = 0;
  const errors: string[] = [];

  for (const inbox of MONITORED_INBOXES) {
    try {
      const { ok, messages } = await getInboxMessages(`${inbox}`, 50);
      if (!ok) continue;

      for (const raw of messages as any[]) {
        checked++;
        const msgId   = raw?.in_reply_to ?? raw?.inReplyTo ?? raw?.thread_id ?? null;
        const subject = raw?.subject ?? "";
        const from    = raw?.from ?? raw?.sender ?? "";
        const body    = raw?.text ?? raw?.body ?? raw?.html ?? "";
        const receivedAt = raw?.received_at ?? raw?.date ?? new Date().toISOString();

        // Extract sender
        const emailMatch = typeof from === "string" ? from.match(/<([^>]+)>/) : null;
        const senderEmail = emailMatch ? emailMatch[1] : (typeof from === "string" ? from : "");
        const senderName  = typeof from === "string" ? from.replace(/<[^>]+>/, "").trim() : "";

        // Match to an execution by message-id, or by recipient email
        let executionId: string | null = msgId ? (messageMap.get(msgId) ?? null) : null;
        if (!executionId && senderEmail) {
          const matched = executions.find((e: any) => e.recipient_email === senderEmail);
          executionId = matched?.id ?? null;
        }

        if (!executionId) continue;

        // Deduplicate
        const key = `${senderEmail}::${subject}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        // Classify
        await classifyReply(orgId, executionId, { senderName, senderEmail, subject, body, receivedAt });
        newReplies++;
      }
    } catch (e: any) {
      errors.push(`${inbox}: ${e.message}`);
    }
  }

  return { checked, newReplies, errors };
}
