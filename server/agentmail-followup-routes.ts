/**
 * AgentMail Follow-Up Routes
 * NEVER sends automatically — all sends require human approval.
 */

import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { attentionItems } from "@shared/schema";
import { writeTimeline } from "./services/ceo-heartbeat-service";
import {
  processDueFollowups,
  cancelFollowupsForThread,
  markFollowupSkipped,
  sendApprovedFollowup,
  SEQUENCE_RULES,
} from "./services/agentmail-followup-service";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}
function row0(r: unknown): any { return rows(r)[0] ?? null; }
function getOrgId(req: any): string | null {
  return req.user?.orgId ?? req.query.orgId ?? null;
}

// ─── Table setup ─────────────────────────────────────────────────────────────

async function ensureFollowupTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_mail_followups (
        id                          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        organization_id             TEXT NOT NULL,
        source_inbound_message_id   TEXT,
        source_reply_queue_id       TEXT,
        inbox                       TEXT NOT NULL,
        agent_name                  TEXT NOT NULL,
        classification              TEXT NOT NULL,
        recipient_email             TEXT NOT NULL,
        recipient_name              TEXT,
        subject                     TEXT NOT NULL,
        followup_body               TEXT NOT NULL,
        edited_body                 TEXT,
        sequence_name               TEXT NOT NULL,
        sequence_step               INTEGER NOT NULL DEFAULT 1,
        scheduled_for               TIMESTAMPTZ NOT NULL,
        status                      TEXT NOT NULL DEFAULT 'scheduled',
        approval_status             TEXT NOT NULL DEFAULT 'pending',
        approved_by                 TEXT,
        approved_at                 TIMESTAMPTZ,
        sent_at                     TIMESTAMPTZ,
        provider_message_id         TEXT,
        skipped_reason              TEXT,
        error_message               TEXT,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_followup_org        ON agent_mail_followups (organization_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_followup_status     ON agent_mail_followups (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_followup_scheduled  ON agent_mail_followups (scheduled_for)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_followup_inbox      ON agent_mail_followups (inbox)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_followup_inbound    ON agent_mail_followups (source_inbound_message_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_followup_reply      ON agent_mail_followups (source_reply_queue_id)`);
  } catch (e: any) {
    console.error("[AgentMail Followup] Table setup error:", e?.message);
  }
}

// ─── Cron ────────────────────────────────────────────────────────────────────

function startFollowupCron(): void {
  const INTERVAL = 20 * 60 * 1000; // every 20 minutes

  const run = async () => {
    try {
      await processDueFollowups();
    } catch (e: any) {
      console.error("[FollowupCron] Error:", e?.message);
    }
  };

  // Run once shortly after startup
  setTimeout(run, 30 * 1000);
  setInterval(run, INTERVAL);
  console.log("[FollowupCron] Started — checking every 20 minutes");
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerAgentMailFollowupRoutes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void,
): Promise<void> {
  await ensureFollowupTable();
  startFollowupCron();

  // ── GET /api/agentmail/followups ─────────────────────────────────────────
  app.get("/api/agentmail/followups", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const {
        status, inbox, classification, agent_name, due_today,
        overdue, limit = "150", offset = "0",
      } = req.query as Record<string, string>;
      const now = new Date().toISOString();
      const todayEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();

      let followups = rows(await db.execute(sql`
        SELECT f.*,
          im.body_text  AS inbound_body,
          im.from_email AS inbound_from_email,
          im.subject    AS inbound_subject,
          im.received_at AS inbound_received_at,
          rq.draft_body AS first_reply_body,
          rq.edited_body AS first_reply_edited_body,
          rq.approved_by AS first_reply_approved_by
        FROM agent_mail_followups f
        LEFT JOIN agent_mail_inbound_messages im ON im.id = f.source_inbound_message_id
        LEFT JOIN agent_mail_reply_queue rq ON rq.id = f.source_reply_queue_id
        WHERE f.organization_id = ${orgId}
        ORDER BY f.scheduled_for ASC
        LIMIT ${Math.min(parseInt(limit, 10) || 150, 500)}
        OFFSET ${parseInt(offset, 10) || 0}
      `).catch(() => []));

      if (status)          followups = followups.filter((f: any) => f.status === status);
      if (inbox)           followups = followups.filter((f: any) => f.inbox === inbox);
      if (classification)  followups = followups.filter((f: any) => f.classification === classification);
      if (agent_name)      followups = followups.filter((f: any) => f.agent_name === agent_name);
      if (due_today === "true") followups = followups.filter((f: any) => f.scheduled_for <= todayEnd);
      if (overdue === "true")   followups = followups.filter((f: any) => f.scheduled_for < now && f.status === "scheduled");

      const statsRows = rows(await db.execute(sql`
        SELECT status, COUNT(*)::int AS cnt
        FROM agent_mail_followups
        WHERE organization_id = ${orgId}
        GROUP BY status
      `).catch(() => []));
      const byStatus: Record<string, number> = {};
      for (const r of statsRows) byStatus[r.status] = r.cnt;

      const pendingReview = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM agent_mail_followups
        WHERE organization_id = ${orgId} AND status = 'pending_review'
      `).catch(() => []))[0]?.cnt ?? 0;

      const overdueCount = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM agent_mail_followups
        WHERE organization_id = ${orgId}
          AND status = 'scheduled'
          AND scheduled_for < ${now}
      `).catch(() => []))[0]?.cnt ?? 0;

      const dueTodayCount = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM agent_mail_followups
        WHERE organization_id = ${orgId}
          AND status IN ('scheduled','pending_review')
          AND scheduled_for <= ${todayEnd}
      `).catch(() => []))[0]?.cnt ?? 0;

      res.json({
        followups,
        total: followups.length,
        byStatus,
        pendingReview,
        overdueCount,
        dueTodayCount,
        availableSequences: Object.entries(SEQUENCE_RULES).map(([cls, rule]) => ({
          classification: cls,
          sequenceName: rule.name,
          steps: rule.steps.length,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to fetch followups" });
    }
  });

  // ── GET /api/agentmail/followups/:id ────────────────────────────────────
  app.get("/api/agentmail/followups/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const followup = row0(await db.execute(sql`
        SELECT f.*,
          im.body_text   AS inbound_body,
          im.body_html   AS inbound_body_html,
          im.from_email  AS inbound_from_email,
          im.from_name   AS inbound_from_name,
          im.subject     AS inbound_subject,
          im.received_at AS inbound_received_at,
          rq.draft_body  AS first_reply_body,
          rq.edited_body AS first_reply_edited_body,
          rq.sent_at     AS first_reply_sent_at,
          rq.approved_by AS first_reply_approved_by
        FROM agent_mail_followups f
        LEFT JOIN agent_mail_inbound_messages im ON im.id = f.source_inbound_message_id
        LEFT JOIN agent_mail_reply_queue rq ON rq.id = f.source_reply_queue_id
        WHERE f.id = ${id} AND f.organization_id = ${orgId}
      `).catch(() => []));

      if (!followup) return res.status(404).json({ message: "Follow-up not found" });

      // Prior followups in same sequence
      const priorFollowups = rows(await db.execute(sql`
        SELECT id, sequence_step, status, sent_at, followup_body, subject
        FROM agent_mail_followups
        WHERE organization_id = ${orgId}
          AND source_inbound_message_id = ${followup.source_inbound_message_id}
          AND sequence_step < ${followup.sequence_step}
        ORDER BY sequence_step ASC
      `).catch(() => []));

      res.json({ ...followup, priorFollowups });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to fetch followup" });
    }
  });

  // ── PATCH /api/agentmail/followups/:id ──────────────────────────────────
  app.patch("/api/agentmail/followups/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const { edited_body } = req.body;
      if (!edited_body?.trim()) return res.status(400).json({ message: "edited_body is required" });

      await db.execute(sql`
        UPDATE agent_mail_followups
        SET edited_body = ${edited_body}, updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${orgId}
          AND status NOT IN ('sent','cancelled','failed')
      `);

      res.json({ ok: true, message: "Follow-up draft updated" });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to update follow-up" });
    }
  });

  // ── POST /api/agentmail/followups/:id/approve ───────────────────────────
  app.post("/api/agentmail/followups/:id/approve", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const approver = req.user?.claims?.email ?? req.user?.email ?? "admin";

      const f = row0(await db.execute(sql`
        SELECT * FROM agent_mail_followups WHERE id = ${id} AND organization_id = ${orgId}
      `).catch(() => []));
      if (!f) return res.status(404).json({ message: "Follow-up not found" });
      if (f.status === "sent") return res.status(400).json({ message: "Already sent" });
      if (f.approval_status === "approved") return res.status(400).json({ message: "Already approved" });

      await db.execute(sql`
        UPDATE agent_mail_followups
        SET approval_status = 'approved', approved_by = ${approver},
            approved_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${orgId}
      `);

      await writeTimeline({
        orgId,
        agentName: f.agent_name,
        actionType: "agentmail_followup_approved",
        actionStatus: "completed",
        priority: 3,
        relatedEntityType: "followup",
        relatedEntityId: id,
        summary: `${approver} approved ${f.agent_name} follow-up step ${f.sequence_step} for ${f.recipient_email} — ready to send`,
        requiresApproval: false,
        metadata: { inbox: f.inbox, approver, step: f.sequence_step },
      }).catch(() => {});

      res.json({ ok: true, approvedBy: approver });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to approve follow-up" });
    }
  });

  // ── POST /api/agentmail/followups/:id/reject ────────────────────────────
  app.post("/api/agentmail/followups/:id/reject", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const { reason } = req.body;
      const actor = req.user?.claims?.email ?? "admin";

      const f = row0(await db.execute(sql`
        SELECT * FROM agent_mail_followups WHERE id = ${id} AND organization_id = ${orgId}
      `).catch(() => []));
      if (!f) return res.status(404).json({ message: "Follow-up not found" });
      if (f.status === "sent") return res.status(400).json({ message: "Already sent" });

      await db.execute(sql`
        UPDATE agent_mail_followups
        SET status = 'skipped', approval_status = 'rejected',
            skipped_reason = ${reason ?? "Rejected by reviewer"},
            updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${orgId}
      `);

      // Dismiss attention item
      await db.execute(sql`
        UPDATE attention_items
        SET status = 'completed', updated_at = NOW()
        WHERE source = 'agentmail_followup' AND source_id = ${id}
      `).catch(() => {});

      await writeTimeline({
        orgId,
        agentName: f.agent_name,
        actionType: "agentmail_followup_skipped",
        actionStatus: "completed",
        priority: 2,
        relatedEntityType: "followup",
        relatedEntityId: id,
        summary: `${actor} skipped ${f.agent_name} follow-up step ${f.sequence_step} for ${f.recipient_email} — reason: ${reason ?? "none"}`,
        requiresApproval: false,
        metadata: { reason },
      }).catch(() => {});

      // Wire rejection into global learning loop
      if (reason) {
        try {
          const { agentMessageFeedback: amfTable } = await import("@shared/schema");
          const [fbRow] = await db.insert(amfTable).values({
            orgId,
            proposalId: id,
            agentName: f.agent_name ?? null,
            messageType: "agentmail_followup",
            originalBody: f.followup_body ?? null,
            decision: "rejected",
            rejectionReason: reason,
            reviewedBy: actor,
            communicationDomain: "athlete_lead",
          } as any).returning();
          if (fbRow?.id) {
            const { extractMessageLearningFromFeedback } = await import("./services/message-learning-service");
            extractMessageLearningFromFeedback(orgId, fbRow.id).catch(console.error);
          }
        } catch (learningErr) {
          console.error("[agentmail-followup-reject] learning loop error (non-fatal):", learningErr);
        }
      }

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to reject follow-up" });
    }
  });

  // ── POST /api/agentmail/followups/:id/send ──────────────────────────────
  app.post("/api/agentmail/followups/:id/send", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const actor = req.user?.claims?.email ?? "admin";

      const result = await sendApprovedFollowup({ followupId: id, organizationId: orgId, actor });

      if (result.ok) {
        res.json({ ok: true, messageId: result.messageId, sentAt: new Date().toISOString() });
      } else {
        res.status(result.error === "Already sent" ? 400 : result.error === "Not approved yet" ? 400 : 502)
          .json({ ok: false, error: result.error });
      }
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to send follow-up" });
    }
  });

  // ── POST /api/agentmail/followups/:id/cancel ────────────────────────────
  app.post("/api/agentmail/followups/:id/cancel", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const { reason, cancelAll } = req.body;
      const actor = req.user?.claims?.email ?? "admin";

      const f = row0(await db.execute(sql`
        SELECT * FROM agent_mail_followups WHERE id = ${id} AND organization_id = ${orgId}
      `).catch(() => []));
      if (!f) return res.status(404).json({ message: "Follow-up not found" });

      if (cancelAll) {
        const cancelled = await cancelFollowupsForThread({
          organizationId: orgId,
          sourceInboundMessageId: f.source_inbound_message_id,
          sourceReplyQueueId: f.source_reply_queue_id,
          reason: reason ?? `Manually cancelled by ${actor}`,
          cancelledBy: actor,
        });

        await writeTimeline({
          orgId,
          agentName: f.agent_name,
          actionType: "agentmail_sequence_cancelled",
          actionStatus: "completed",
          priority: 2,
          relatedEntityType: "followup_sequence",
          relatedEntityId: f.source_inbound_message_id ?? id,
          summary: `${actor} cancelled ${f.sequence_name} sequence for ${f.recipient_email} — ${cancelled} step(s) cancelled`,
          requiresApproval: false,
          metadata: { reason, cancelledCount: cancelled },
        }).catch(() => {});

        // Dismiss attention items for all
        await db.execute(sql`
          UPDATE attention_items
          SET status = 'completed', updated_at = NOW()
          WHERE source = 'agentmail_followup'
            AND source_id IN (
              SELECT id FROM agent_mail_followups
              WHERE organization_id = ${orgId}
                AND (source_inbound_message_id = ${f.source_inbound_message_id ?? ""}
                  OR source_reply_queue_id = ${f.source_reply_queue_id ?? ""})
            )
        `).catch(() => {});

        res.json({ ok: true, cancelled });
      } else {
        await db.execute(sql`
          UPDATE agent_mail_followups
          SET status = 'cancelled', skipped_reason = ${reason ?? `Cancelled by ${actor}`},
              updated_at = NOW()
          WHERE id = ${id} AND organization_id = ${orgId}
            AND status NOT IN ('sent','failed')
        `);

        await db.execute(sql`
          UPDATE attention_items
          SET status = 'completed', updated_at = NOW()
          WHERE source = 'agentmail_followup' AND source_id = ${id}
        `).catch(() => {});

        res.json({ ok: true, cancelled: 1 });
      }
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to cancel follow-up" });
    }
  });

  // ── POST /api/agentmail/followups/process-due ───────────────────────────
  app.post("/api/agentmail/followups/process-due", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const result = await processDueFollowups();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to process due follow-ups" });
    }
  });

  // ── GET /api/agentmail/followups/analytics ──────────────────────────────
  app.get("/api/agentmail/followup-analytics", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const now = new Date().toISOString();

      const summary = row0(await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
          COUNT(*) FILTER (WHERE status = 'pending_review')::int AS pending_review,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
          COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'scheduled' AND scheduled_for < ${now})::int AS overdue,
          COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '24 hours')::int AS sent_today
        FROM agent_mail_followups
        WHERE organization_id = ${orgId}
      `).catch(() => [])) ?? {};

      // Most active inbox
      const inboxRows = rows(await db.execute(sql`
        SELECT inbox, COUNT(*)::int AS cnt
        FROM agent_mail_followups
        WHERE organization_id = ${orgId}
        GROUP BY inbox
        ORDER BY cnt DESC
        LIMIT 1
      `).catch(() => []));
      const mostActiveInbox = inboxRows[0]?.inbox ?? null;

      // Agent with most pending
      const agentRows = rows(await db.execute(sql`
        SELECT agent_name, COUNT(*)::int AS cnt
        FROM agent_mail_followups
        WHERE organization_id = ${orgId} AND status = 'pending_review'
        GROUP BY agent_name
        ORDER BY cnt DESC
        LIMIT 1
      `).catch(() => []));
      const mostPendingAgent = agentRows[0]?.agent_name ?? null;

      // Most common classification needing follow-up
      const classRows = rows(await db.execute(sql`
        SELECT classification, COUNT(*)::int AS cnt
        FROM agent_mail_followups
        WHERE organization_id = ${orgId} AND status IN ('scheduled','pending_review')
        GROUP BY classification
        ORDER BY cnt DESC
        LIMIT 1
      `).catch(() => []));
      const mostCommonClassification = classRows[0]?.classification ?? null;

      // Per-agent metrics
      const agentMetrics = rows(await db.execute(sql`
        SELECT
          agent_name,
          COUNT(*)::int AS scheduled,
          COUNT(*) FILTER (WHERE status IN ('approved','sent'))::int AS approved,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
          COUNT(*) FILTER (WHERE status = 'scheduled' AND scheduled_for < ${now})::int AS overdue
        FROM agent_mail_followups
        WHERE organization_id = ${orgId}
        GROUP BY agent_name
        ORDER BY scheduled DESC
      `).catch(() => []));

      // Per-classification metrics
      const classMetrics = rows(await db.execute(sql`
        SELECT
          classification,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
          COUNT(*) FILTER (WHERE status IN ('cancelled','skipped'))::int AS cancelled,
          ROUND(AVG(EXTRACT(EPOCH FROM (sent_at - created_at))/3600)::numeric, 1) AS avg_hours_to_send
        FROM agent_mail_followups
        WHERE organization_id = ${orgId}
        GROUP BY classification
        ORDER BY total DESC
      `).catch(() => []));

      res.json({
        summary: { ...summary, mostActiveInbox, mostPendingAgent, mostCommonClassification },
        agentMetrics: agentMetrics.map((r: any) => ({
          agentName: r.agent_name,
          scheduled: r.scheduled,
          approved: r.approved,
          sent: r.sent,
          cancelled: r.cancelled,
          overdue: r.overdue,
          sendRate: r.scheduled > 0 ? Math.round((r.sent / r.scheduled) * 100) : null,
        })),
        classificationMetrics: classMetrics.map((r: any) => ({
          classification: r.classification,
          total: r.total,
          sent: r.sent,
          cancelled: r.cancelled,
          sendRate: r.total > 0 ? Math.round((r.sent / r.total) * 100) : null,
          cancellationRate: r.total > 0 ? Math.round((r.cancelled / r.total) * 100) : null,
          avgHoursToSend: parseFloat(r.avg_hours_to_send ?? "0") || null,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to fetch followup analytics" });
    }
  });
}
