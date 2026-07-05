/**
 * AgentMail Reply Approval Routes
 * Phases 1–10: Queue, approval workflow, send, outcome tracking, analytics.
 * Human approval is mandatory — no email is ever sent automatically.
 */

import type { Express } from "express";
import { resolveOrgIdOrThrow } from "./lib/resolve-org-id";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { sendAgentEmail, replyFromAgentInbox, type AgentInbox } from "./services/agentmail-service";
import { writeTimeline } from "./services/ceo-heartbeat-service";
import { attentionItems } from "@shared/schema";

// ─── Helpers ────────────────────────────────────────────────────────────────

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}
function row0(r: unknown): any { return rows(r)[0] ?? null; }

async function getOrgId(req: any): Promise<string> {
  // Trusted server-side org resolution ONLY — never from client query/body/params.
  // Throws OrgResolutionError (converted to 403 by orgErrorMiddleware) when the
  // org cannot be determined from the authenticated session — fail closed.
  return await resolveOrgIdOrThrow(req);
}

// ─── Classifications that support auto-drafts ────────────────────────────────

export const DRAFTABLE_CLASSIFICATIONS = new Set([
  "new_lead",
  "pricing_question",
  "booking_request",
  "reschedule_request",
  "employment_candidate",
  "support_issue",
  "athlete_parent_question",
  "coach_partner_inquiry",
  "general_question",
]);

// ─── Table setup ─────────────────────────────────────────────────────────────

async function ensureReplyTables(): Promise<void> {
  // Reply queue
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_mail_reply_queue (
        id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        organization_id      TEXT NOT NULL,
        inbound_message_id   TEXT NOT NULL,
        inbox                TEXT NOT NULL,
        agent_name           TEXT NOT NULL,
        classification       TEXT NOT NULL,
        recipient_email      TEXT NOT NULL,
        recipient_name       TEXT,
        subject              TEXT NOT NULL,
        draft_body           TEXT NOT NULL,
        edited_body          TEXT,
        final_body           TEXT,
        status               TEXT NOT NULL DEFAULT 'drafted',
        approval_status      TEXT NOT NULL DEFAULT 'pending_review',
        approved_by          TEXT,
        approved_at          TIMESTAMPTZ,
        sent_at              TIMESTAMPTZ,
        provider_message_id  TEXT,
        thread_id            TEXT,
        delivery_status      TEXT,
        rejection_reason     TEXT,
        confidence           DOUBLE PRECISION DEFAULT 0,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reply_queue_org         ON agent_mail_reply_queue (organization_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reply_queue_status      ON agent_mail_reply_queue (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reply_queue_approval    ON agent_mail_reply_queue (approval_status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reply_queue_inbox       ON agent_mail_reply_queue (inbox)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reply_queue_inbound     ON agent_mail_reply_queue (inbound_message_id)`);
    // Dedup migration: remove duplicate rows before creating the unique index.
    // Keeps the oldest record per (organization_id, inbound_message_id) pair so
    // the UNIQUE INDEX creation never fails on deployments with pre-existing dups.
    await db.execute(sql`
      DELETE FROM agent_mail_reply_queue
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT DISTINCT ON (organization_id, inbound_message_id) id
          FROM agent_mail_reply_queue
          ORDER BY organization_id, inbound_message_id, created_at ASC
        ) dedup_set
      )
    `).catch(() => {});
    // Unique constraint: one reply draft per inbound message per org.
    // Prevents the same inbound email from spawning multiple simultaneous drafts
    // on webhook replay or concurrent worker pickup.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_queue_inbound_unique
      ON agent_mail_reply_queue (organization_id, inbound_message_id)
    `);
  } catch (e: any) {
    console.error("[AgentMail Reply] Queue table error:", e?.message);
  }

  // Outcome tracking
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_mail_reply_outcomes (
        id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        reply_queue_id         TEXT NOT NULL,
        organization_id        TEXT NOT NULL,
        agent_name             TEXT NOT NULL,
        inbox                  TEXT NOT NULL,
        classification         TEXT NOT NULL,
        outcome_type           TEXT NOT NULL,
        response_time_minutes  DOUBLE PRECISION,
        actor                  TEXT,
        notes                  TEXT,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reply_outcome_org    ON agent_mail_reply_outcomes (organization_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reply_outcome_agent  ON agent_mail_reply_outcomes (agent_name)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reply_outcome_type   ON agent_mail_reply_outcomes (outcome_type)`);
  } catch (e: any) {
    console.error("[AgentMail Reply] Outcomes table error:", e?.message);
  }
}

// ─── Outcome logger ──────────────────────────────────────────────────────────

async function logOutcome(params: {
  replyQueueId: string;
  organizationId: string;
  agentName: string;
  inbox: string;
  classification: string;
  outcomeType: "approved_without_edit" | "approved_with_edit" | "rejected" | "sent" | "delivery_failed";
  createdAt: Date;
  actor?: string;
  notes?: string;
}): Promise<void> {
  const responseMinutes = (Date.now() - params.createdAt.getTime()) / 60000;
  try {
    await db.execute(sql`
      INSERT INTO agent_mail_reply_outcomes (
        id, reply_queue_id, organization_id, agent_name, inbox, classification,
        outcome_type, response_time_minutes, actor, notes, created_at
      ) VALUES (
        gen_random_uuid()::text,
        ${params.replyQueueId},
        ${params.organizationId},
        ${params.agentName},
        ${params.inbox},
        ${params.classification},
        ${params.outcomeType},
        ${Math.round(responseMinutes * 10) / 10},
        ${params.actor ?? null},
        ${params.notes ?? null},
        NOW()
      )
    `);
  } catch (e: any) {
    console.error("[AgentMail Reply] Outcome log error:", e?.message);
  }
}

// ─── Attention inbox helpers ──────────────────────────────────────────────────

async function createReplyApprovalAttentionItem(
  orgId: string,
  replyId: string,
  subject: string,
  agentName: string,
  inbox: string,
  classification: string,
): Promise<void> {
  try {
    await db.insert(attentionItems).values({
      orgId,
      level: "important",
      category: "agentmail_reply",
      title: `Reply awaiting approval: ${subject.slice(0, 70)}`,
      body: `${agentName} drafted a reply to an inbound ${classification.replace(/_/g, " ")} email via ${inbox}@. Review and approve before sending.`,
      source: "agentmail_reply",
      sourceId: replyId,
      severity: 70,
      urgency: 65,
      businessImpact: 60,
      confidence: 0.9,
      actionUrl: `/admin/agentmail?tab=replies`,
      actionLabel: "Review Reply",
      status: "active",
      metadata: { replyQueueId: replyId, inbox, agentName, classification },
    }).onConflictDoNothing();
  } catch (e: any) {
    console.error("[AgentMail Reply] Attention item error:", e?.message);
  }
}

async function dismissReplyAttentionItem(orgId: string, replyId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE attention_items
      SET status = 'completed', updated_at = NOW()
      WHERE org_id = ${orgId}
        AND source = 'agentmail_reply'
        AND source_id = ${replyId}
    `);
  } catch { /* non-fatal */ }
}

// ─── Timeline logger ─────────────────────────────────────────────────────────

async function logReplyTimeline(
  orgId: string,
  agentName: string,
  actionType: string,
  summary: string,
  replyId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await writeTimeline({
      orgId,
      agentName,
      actionType,
      actionStatus: "completed",
      priority: 3,
      relatedEntityType: "reply_queue",
      relatedEntityId: replyId,
      summary,
      requiresApproval: false,
      metadata,
    });
  } catch (e: any) {
    console.error("[AgentMail Reply] Timeline error:", e?.message);
  }
}

// ─── Public helper: create a reply queue entry ───────────────────────────────

export async function createReplyQueueEntry(params: {
  organizationId: string;
  inboundMessageId: string;
  inbox: string;
  agentName: string;
  classification: string;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  draftBody: string;
  confidence?: number;
  threadId?: string;
}): Promise<string | null> {
  if (!DRAFTABLE_CLASSIFICATIONS.has(params.classification)) return null;
  if (!params.draftBody?.trim()) return null;

  try {
    const inserted = rows(await db.execute(sql`
      INSERT INTO agent_mail_reply_queue (
        id, organization_id, inbound_message_id, inbox, agent_name, classification,
        recipient_email, recipient_name, subject, draft_body,
        status, approval_status, confidence, thread_id, created_at, updated_at
      ) VALUES (
        gen_random_uuid()::text,
        ${params.organizationId},
        ${params.inboundMessageId},
        ${params.inbox},
        ${params.agentName},
        ${params.classification},
        ${params.recipientEmail},
        ${params.recipientName ?? null},
        ${params.subject},
        ${params.draftBody},
        ${"drafted"},
        ${"pending_review"},
        ${params.confidence ?? 0},
        ${params.threadId ?? null},
        NOW(), NOW()
      )
      RETURNING id
    `));

    const replyId = inserted[0]?.id;
    if (!replyId) return null;

    // Update status to pending_review
    await db.execute(sql`
      UPDATE agent_mail_reply_queue SET status = 'pending_review' WHERE id = ${replyId}
    `);

    // Attention inbox
    await createReplyApprovalAttentionItem(
      params.organizationId,
      replyId,
      params.subject,
      params.agentName,
      params.inbox,
      params.classification,
    );

    // Timeline
    await logReplyTimeline(
      params.organizationId,
      params.agentName,
      "agentmail_reply_drafted",
      `${params.agentName} drafted a reply to ${params.recipientEmail} via ${params.inbox}@ — awaiting human approval`,
      replyId,
      { inbox: params.inbox, classification: params.classification, confidence: params.confidence },
    );

    return replyId;
  } catch (e: any) {
    console.error("[AgentMail Reply] Queue entry creation error:", e?.message);
    return null;
  }
}

// ─── Route registration ──────────────────────────────────────────────────────

export async function registerAgentMailReplyRoutes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void,
): Promise<void> {
  await ensureReplyTables();

  // ── GET /api/agentmail/replies ─────────────────────────────────────────────
  app.get("/api/agentmail/replies", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const {
        inbox, classification, status, approval_status, agent_name,
        limit = "100", offset = "0",
      } = req.query as Record<string, string>;

      let replies = rows(await db.execute(sql`
        SELECT rq.*, im.body_text AS inbound_body, im.from_name AS inbound_from_name, im.received_at AS inbound_received_at
        FROM agent_mail_reply_queue rq
        LEFT JOIN agent_mail_inbound_messages im ON im.id = rq.inbound_message_id
        WHERE rq.organization_id = ${orgId}
        ORDER BY rq.created_at DESC
        LIMIT ${Math.min(parseInt(limit, 10) || 100, 500)}
        OFFSET ${parseInt(offset, 10) || 0}
      `).catch(() => []));

      if (inbox)           replies = replies.filter((r: any) => r.inbox === inbox);
      if (classification)  replies = replies.filter((r: any) => r.classification === classification);
      if (status)          replies = replies.filter((r: any) => r.status === status);
      if (approval_status) replies = replies.filter((r: any) => r.approval_status === approval_status);
      if (agent_name)      replies = replies.filter((r: any) => r.agent_name === agent_name);

      const statsRows = rows(await db.execute(sql`
        SELECT approval_status, COUNT(*)::int AS cnt
        FROM agent_mail_reply_queue
        WHERE organization_id = ${orgId}
        GROUP BY approval_status
      `).catch(() => []));
      const byApprovalStatus: Record<string, number> = {};
      for (const r of statsRows) byApprovalStatus[r.approval_status] = r.cnt;

      res.json({ replies, total: replies.length, byApprovalStatus });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to fetch replies" });
    }
  });

  // ── GET /api/agentmail/replies/:id ────────────────────────────────────────
  app.get("/api/agentmail/replies/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const reply = row0(await db.execute(sql`
        SELECT rq.*,
          im.body_text     AS inbound_body,
          im.body_html     AS inbound_body_html,
          im.from_email    AS inbound_from_email,
          im.from_name     AS inbound_from_name,
          im.subject       AS inbound_subject,
          im.inbox         AS inbound_inbox,
          im.received_at   AS inbound_received_at,
          im.action_payload AS inbound_action_payload
        FROM agent_mail_reply_queue rq
        LEFT JOIN agent_mail_inbound_messages im ON im.id = rq.inbound_message_id
        WHERE rq.id = ${id} AND rq.organization_id = ${orgId}
      `).catch(() => []));

      if (!reply) return res.status(404).json({ message: "Reply not found" });

      // Outcome history
      const outcomes = rows(await db.execute(sql`
        SELECT * FROM agent_mail_reply_outcomes
        WHERE reply_queue_id = ${id}
        ORDER BY created_at ASC
      `).catch(() => []));

      res.json({ ...reply, outcomes });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to fetch reply" });
    }
  });

  // ── PATCH /api/agentmail/replies/:id ─────────────────────────────────────
  app.patch("/api/agentmail/replies/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const { edited_body } = req.body;
      if (!edited_body?.trim()) return res.status(400).json({ message: "edited_body is required" });

      await db.execute(sql`
        UPDATE agent_mail_reply_queue
        SET edited_body = ${edited_body}, updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${orgId}
          AND status NOT IN ('sent', 'failed')
      `);

      res.json({ ok: true, message: "Draft updated" });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to update draft" });
    }
  });

  // ── POST /api/agentmail/replies/:id/approve ───────────────────────────────
  app.post("/api/agentmail/replies/:id/approve", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const approver = (req as any).user?.claims?.email ?? (req as any).user?.email ?? "admin";

      const reply = row0(await db.execute(sql`
        SELECT * FROM agent_mail_reply_queue
        WHERE id = ${id} AND organization_id = ${orgId}
      `).catch(() => []));
      if (!reply) return res.status(404).json({ message: "Reply not found" });
      if (reply.status === "sent") return res.status(400).json({ message: "Already sent" });
      if (reply.approval_status === "approved") return res.status(400).json({ message: "Already approved" });

      await db.execute(sql`
        UPDATE agent_mail_reply_queue
        SET approval_status = 'approved', approved_by = ${approver},
            approved_at = NOW(), status = 'approved', updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${orgId}
      `);

      const hasEdits = !!reply.edited_body;
      await logOutcome({
        replyQueueId: id,
        organizationId: orgId,
        agentName: reply.agent_name,
        inbox: reply.inbox,
        classification: reply.classification,
        outcomeType: hasEdits ? "approved_with_edit" : "approved_without_edit",
        createdAt: new Date(reply.created_at),
        actor: approver,
      });

      await logReplyTimeline(
        orgId, reply.agent_name, "agentmail_reply_approved",
        `${approver} approved ${reply.agent_name} reply to ${reply.recipient_email} via ${reply.inbox}@ — ready to send`,
        id, { inbox: reply.inbox, approver, hasEdits },
      );

      // Positive learning signal — fire-and-forget
      try {
        const { agentMessageFeedback: amfTable } = await import("@shared/schema");
        const fbValues: any = {
          orgId,
          proposalId: id,
          agentName: reply.agent_name ?? null,
          messageType: reply.classification ?? "agentmail_reply",
          originalSubject: reply.subject ?? null,
          originalBody: reply.draft_body ?? null,
          decision: hasEdits ? "edited_and_approved" : "approved",
          reviewedBy: approver,
          communicationDomain: "athlete_lead",
        };
        if (hasEdits) {
          fbValues.editedBody = reply.edited_body;
          fbValues.reviewerNotes = "Approved with edits — learn from improvements";
        }
        const [fbRow] = await db.insert(amfTable).values(fbValues).returning();
        if (fbRow?.id) {
          const { extractMessageLearningFromFeedback } = await import("./services/message-learning-service");
          extractMessageLearningFromFeedback(orgId, fbRow.id).catch(console.error);
        }
      } catch (learningErr) {
        console.error("[agentmail-approve] learning loop error (non-fatal):", learningErr);
      }

      res.json({ ok: true, approvedBy: approver, approvedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to approve reply" });
    }
  });

  // ── POST /api/agentmail/replies/:id/reject ────────────────────────────────
  app.post("/api/agentmail/replies/:id/reject", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const { reason } = req.body;
      const actor = (req as any).user?.claims?.email ?? "admin";

      const reply = row0(await db.execute(sql`
        SELECT * FROM agent_mail_reply_queue
        WHERE id = ${id} AND organization_id = ${orgId}
      `).catch(() => []));
      if (!reply) return res.status(404).json({ message: "Reply not found" });
      if (reply.status === "sent") return res.status(400).json({ message: "Already sent — cannot reject" });

      await db.execute(sql`
        UPDATE agent_mail_reply_queue
        SET approval_status = 'rejected', status = 'rejected',
            rejection_reason = ${reason ?? "No reason provided"}, updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${orgId}
      `);

      await logOutcome({
        replyQueueId: id,
        organizationId: orgId,
        agentName: reply.agent_name,
        inbox: reply.inbox,
        classification: reply.classification,
        outcomeType: "rejected",
        createdAt: new Date(reply.created_at),
        actor,
        notes: reason,
      });

      await dismissReplyAttentionItem(orgId, id);

      await logReplyTimeline(
        orgId, reply.agent_name, "agentmail_reply_rejected",
        `${actor} rejected ${reply.agent_name} draft for ${reply.recipient_email} — reason: ${reason ?? "none"}`,
        id, { inbox: reply.inbox, reason },
      );

      // Wire AgentMail rejections into the global learning loop so future
      // drafts from this agent improve based on human feedback.
      if (reason?.trim()) {
        try {
          const { agentMessageFeedback } = await import("@shared/schema");
          const userId = (req as any).user?.claims?.sub ?? (req as any).user?.id;
          const [fbRow] = await db.insert(agentMessageFeedback).values({
            orgId,
            proposalId: id,
            agentName: reply.agent_name ?? null,
            messageType: reply.classification ?? "agentmail_reply",
            originalSubject: reply.subject ?? null,
            originalBody: reply.draft_body ?? null,
            decision: "rejected",
            rejectionReason: reason,
            reviewedBy: userId ?? actor,
            communicationDomain: "athlete_lead",
          } as any).returning();
          if (fbRow?.id) {
            const { extractMessageLearningFromFeedback } = await import("./services/message-learning-service");
            extractMessageLearningFromFeedback(orgId, fbRow.id).catch(console.error);
          }
        } catch (learningErr) {
          console.error("[agentmail-reject] learning loop error (non-fatal):", learningErr);
        }
      }

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to reject reply" });
    }
  });

  // ── POST /api/agentmail/replies/:id/send ─────────────────────────────────
  app.post("/api/agentmail/replies/:id/send", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const actor = (req as any).user?.claims?.email ?? "admin";

      const reply = row0(await db.execute(sql`
        SELECT * FROM agent_mail_reply_queue
        WHERE id = ${id} AND organization_id = ${orgId}
      `).catch(() => []));
      if (!reply) return res.status(404).json({ message: "Reply not found" });
      if (reply.status === "sent") return res.status(400).json({ message: "Already sent — idempotent guard" });
      if (reply.approval_status !== "approved") {
        return res.status(400).json({ message: "Reply must be approved before sending" });
      }

      const bodyToSend: string = reply.edited_body?.trim() || reply.draft_body;

      // Send via AgentMail
      let sendResult: { ok: boolean; messageId?: string; error?: string; blocked?: boolean };
      if (reply.thread_id) {
        sendResult = await replyFromAgentInbox({
          organizationId: orgId,
          agentName: reply.agent_name,
          fromInbox: reply.inbox as AgentInbox,
          threadId: reply.thread_id,
          to: reply.recipient_email,
          subject: reply.subject,
          body: bodyToSend,
          humanApproved: true,
        });
      } else {
        sendResult = await sendAgentEmail({
          organizationId: orgId,
          agentName: reply.agent_name,
          fromInbox: reply.inbox as AgentInbox,
          to: reply.recipient_email,
          subject: reply.subject,
          body: bodyToSend,
          humanApproved: true,
        });
      }

      if (sendResult.ok) {
        await db.execute(sql`
          UPDATE agent_mail_reply_queue
          SET status = 'sent', final_body = ${bodyToSend},
              sent_at = NOW(), provider_message_id = ${sendResult.messageId ?? null},
              delivery_status = 'delivered', updated_at = NOW()
          WHERE id = ${id}
        `);

        await logOutcome({
          replyQueueId: id,
          organizationId: orgId,
          agentName: reply.agent_name,
          inbox: reply.inbox,
          classification: reply.classification,
          outcomeType: "sent",
          createdAt: new Date(reply.created_at),
          actor,
        });

        await dismissReplyAttentionItem(orgId, id);

        await logReplyTimeline(
          orgId, reply.agent_name, "agentmail_reply_sent",
          `${reply.agent_name} email sent to ${reply.recipient_email} via ${reply.inbox}@ — approved by ${actor}`,
          id, { inbox: reply.inbox, actor, messageId: sendResult.messageId },
        );

        // Auto-schedule follow-up sequence after a successful reply send
        if (DRAFTABLE_CLASSIFICATIONS.has(reply.classification)) {
          try {
            const { createFollowupSequence } = await import("./services/agentmail-followup-service");
            // Fetch original inbound body for context
            let inboundBody: string | null = null;
            if (reply.inbound_message_id) {
              const inboundRow = rows(await db.execute(sql`
                SELECT body_text FROM agent_mail_inbound_messages WHERE id = ${reply.inbound_message_id}
              `).catch(() => []));
              inboundBody = inboundRow[0]?.body_text ?? null;
            }
            await createFollowupSequence({
              organizationId: orgId,
              sourceInboundMessageId: reply.inbound_message_id ?? null,
              sourceReplyQueueId: id,
              inbox: reply.inbox,
              agentName: reply.agent_name,
              classification: reply.classification,
              recipientEmail: reply.recipient_email,
              recipientName: reply.recipient_name ?? null,
              originalSubject: reply.subject,
              originalInboundBody: inboundBody,
              firstReplyBody: bodyToSend,
              baseSentAt: new Date(),
            });
          } catch (e: any) {
            console.error("[AgentMail Reply] Follow-up sequence creation error:", e?.message);
          }
        }

        res.json({ ok: true, messageId: sendResult.messageId, sentAt: new Date().toISOString() });
      } else {
        await db.execute(sql`
          UPDATE agent_mail_reply_queue
          SET status = 'failed', delivery_status = 'failed',
              rejection_reason = ${sendResult.error ?? "Send failed"}, updated_at = NOW()
          WHERE id = ${id}
        `);

        await logOutcome({
          replyQueueId: id,
          organizationId: orgId,
          agentName: reply.agent_name,
          inbox: reply.inbox,
          classification: reply.classification,
          outcomeType: "delivery_failed",
          createdAt: new Date(reply.created_at),
          actor,
          notes: sendResult.error,
        });

        res.status(502).json({ ok: false, error: sendResult.error ?? "Send failed" });
      }
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to send reply" });
    }
  });

  // ── GET /api/agentmail/analytics ──────────────────────────────────────────
  app.get("/api/agentmail/analytics", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      // Per-agent metrics
      const agentRows = rows(await db.execute(sql`
        SELECT
          agent_name,
          COUNT(*) FILTER (WHERE outcome_type IN ('approved_without_edit','approved_with_edit','sent'))::int AS approvals,
          COUNT(*) FILTER (WHERE outcome_type = 'approved_with_edit')::int AS edits,
          COUNT(*) FILTER (WHERE outcome_type = 'rejected')::int AS rejections,
          COUNT(*) FILTER (WHERE outcome_type = 'sent')::int AS sends,
          COUNT(*) FILTER (WHERE outcome_type = 'delivery_failed')::int AS delivery_failures,
          ROUND(AVG(response_time_minutes)::numeric, 1) AS avg_response_time_minutes
        FROM agent_mail_reply_outcomes
        WHERE organization_id = ${orgId}
        GROUP BY agent_name
        ORDER BY approvals DESC
      `).catch(() => []));

      // Total drafts per agent from queue
      const draftRows = rows(await db.execute(sql`
        SELECT agent_name, COUNT(*)::int AS drafts_generated
        FROM agent_mail_reply_queue
        WHERE organization_id = ${orgId}
        GROUP BY agent_name
      `).catch(() => []));
      const draftsByAgent: Record<string, number> = {};
      for (const r of draftRows) draftsByAgent[r.agent_name] = r.drafts_generated;

      const agentMetrics = agentRows.map((r: any) => ({
        agentName: r.agent_name,
        draftsGenerated: draftsByAgent[r.agent_name] ?? 0,
        approvals: r.approvals ?? 0,
        edits: r.edits ?? 0,
        rejections: r.rejections ?? 0,
        sends: r.sends ?? 0,
        deliveryFailures: r.delivery_failures ?? 0,
        avgResponseTimeMinutes: parseFloat(r.avg_response_time_minutes ?? "0"),
        approvalRate: r.approvals + r.rejections > 0
          ? Math.round((r.approvals / (r.approvals + r.rejections)) * 100)
          : null,
        editRate: r.approvals > 0
          ? Math.round((r.edits / r.approvals) * 100)
          : null,
      }));

      // Per-classification metrics
      const classRows = rows(await db.execute(sql`
        SELECT
          classification,
          COUNT(*) FILTER (WHERE outcome_type IN ('approved_without_edit','approved_with_edit'))::int AS approvals,
          COUNT(*) FILTER (WHERE outcome_type = 'approved_with_edit')::int AS edits,
          COUNT(*) FILTER (WHERE outcome_type = 'rejected')::int AS rejections,
          COUNT(*) FILTER (WHERE outcome_type = 'sent')::int AS sends,
          COUNT(*)::int AS total
        FROM agent_mail_reply_outcomes
        WHERE organization_id = ${orgId}
        GROUP BY classification
        ORDER BY total DESC
      `).catch(() => []));

      const classMetrics = classRows.map((r: any) => ({
        classification: r.classification,
        total: r.total ?? 0,
        approvalPct: r.total > 0 ? Math.round((r.approvals / r.total) * 100) : null,
        editPct: r.approvals > 0 ? Math.round((r.edits / r.approvals) * 100) : null,
        rejectionPct: r.total > 0 ? Math.round((r.rejections / r.total) * 100) : null,
        sendPct: r.total > 0 ? Math.round((r.sends / r.total) * 100) : null,
      }));

      // Summary totals
      const totals = rows(await db.execute(sql`
        SELECT
          COUNT(*)::int AS total_replies,
          COUNT(*) FILTER (WHERE status = 'pending_review')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_unsent,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
          COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '24 hours')::int AS sent_today
        FROM agent_mail_reply_queue
        WHERE organization_id = ${orgId}
      `).catch(() => []))[0] ?? {};

      const avgTime = rows(await db.execute(sql`
        SELECT ROUND(AVG(response_time_minutes)::numeric, 1) AS avg_min
        FROM agent_mail_reply_outcomes
        WHERE organization_id = ${orgId}
          AND outcome_type IN ('approved_without_edit','approved_with_edit')
      `).catch(() => []))[0]?.avg_min;

      res.json({
        summary: {
          ...totals,
          avgApprovalTimeMinutes: parseFloat(avgTime ?? "0"),
        },
        agentMetrics,
        classificationMetrics: classMetrics,
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to fetch analytics" });
    }
  });
}
