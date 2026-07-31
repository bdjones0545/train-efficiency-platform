/**
 * Kevin Inbox Routes — org-scoped AI communication center.
 *
 * Aggregates, for the authenticated org only:
 *   - Pending email approvals (gmail_agent_actions)
 *   - Scheduled / pending-review follow-ups (agent_mail_followups)
 *   - Recent sent / failed automation activity
 *   - Automation state (emergency pause, follow-up sequences)
 *
 * Read-only aggregation — all mutations go through the existing, already
 * safety-gated endpoints (/api/ai-approvals/*, /api/agentmail/followups/*).
 * Org resolution is ALWAYS server-side via resolveOrgIdOrThrow (fail closed).
 */

import type { Express } from "express";
import { sql, and, eq, or, isNull, desc, inArray } from "drizzle-orm";
import { db } from "./db";
import { gmailAgentActions, orgAiGovernanceSettings } from "@shared/schema";
import { resolveOrgIdOrThrow, handleOrgError } from "./lib/resolve-org-id";

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

const PENDING_STATUSES = ["proposed", "pending_approval", "awaiting_approval", "blocked"];

export function registerKevinInboxRoutes(app: Express, isAuthenticated: any, requireRole: any) {
  app.get("/api/kevin/inbox", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res: any) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);

      const [pendingApprovals, recentActions, followupsRaw, sentFollowupsRaw, governanceRows] = await Promise.all([
        // Pending approvals (same criteria as /api/ai-approvals)
        db.select().from(gmailAgentActions).where(and(
          eq(gmailAgentActions.orgId, orgId),
          eq(gmailAgentActions.approvalRequired, true),
          isNull(gmailAgentActions.executedAt),
          inArray(gmailAgentActions.status, PENDING_STATUSES),
        )).orderBy(desc(gmailAgentActions.createdAt)).limit(25),

        // Recent executed / failed / rejected activity
        db.select().from(gmailAgentActions).where(and(
          eq(gmailAgentActions.orgId, orgId),
          inArray(gmailAgentActions.status, ["executed", "auto_executed", "failed", "rejected", "dismissed"]),
        )).orderBy(desc(gmailAgentActions.createdAt)).limit(25),

        // Upcoming / pending-review follow-up sequence steps (raw-SQL table)
        db.execute(sql`
          SELECT id, recipient_email, recipient_name, subject, sequence_name, sequence_step,
                 scheduled_for, status, approval_status, sent_at, error_message, created_at
          FROM agent_mail_followups
          WHERE organization_id = ${orgId}
            AND status IN ('scheduled', 'processing', 'pending_review')
          ORDER BY scheduled_for ASC
          LIMIT 25
        `).catch(() => []),

        // Recently sent/failed follow-ups
        db.execute(sql`
          SELECT id, recipient_email, subject, sequence_name, sequence_step,
                 status, sent_at, error_message
          FROM agent_mail_followups
          WHERE organization_id = ${orgId}
            AND status IN ('sent', 'failed', 'cancelled', 'skipped')
          ORDER BY COALESCE(sent_at, updated_at) DESC
          LIMIT 15
        `).catch(() => []),

        db.select().from(orgAiGovernanceSettings)
          .where(eq(orgAiGovernanceSettings.orgId, orgId)).limit(1)
          .catch(() => [] as any[]),
      ]);

      const followups = rows(followupsRaw);
      const sentFollowups = rows(sentFollowupsRaw);
      const governance: any = Array.isArray(governanceRows) ? governanceRows[0] : null;
      const emergencyPaused = governance?.emergencyPauseEnabled === true;

      // Active automation sequences summary
      const sequenceMap = new Map<string, { sequenceName: string; scheduledSteps: number; nextScheduledFor: string | null }>();
      for (const f of followups) {
        const key = f.sequence_name ?? "default";
        const entry = sequenceMap.get(key) ?? { sequenceName: key, scheduledSteps: 0, nextScheduledFor: null };
        entry.scheduledSteps++;
        const sf = f.scheduled_for ? new Date(f.scheduled_for).toISOString() : null;
        if (sf && (!entry.nextScheduledFor || sf < entry.nextScheduledFor)) entry.nextScheduledFor = sf;
        sequenceMap.set(key, entry);
      }

      res.json({
        approvals: pendingApprovals.map((a) => ({
          id: a.id,
          actionType: a.actionType,
          recipientEmail: a.recipientEmail,
          subject: a.subject,
          bodyPreview: a.bodyPreview,
          riskLevel: a.riskLevel,
          status: a.status,
          createdByAgent: a.createdByAgent,
          communicationDomain: a.communicationDomain,
          createdAt: a.createdAt,
        })),
        followups: followups.map((f) => ({
          id: f.id,
          recipientEmail: f.recipient_email,
          recipientName: f.recipient_name,
          subject: f.subject,
          sequenceName: f.sequence_name,
          sequenceStep: f.sequence_step,
          scheduledFor: f.scheduled_for,
          status: f.status,
          approvalStatus: f.approval_status,
        })),
        recentActivity: [
          ...recentActions.map((a) => ({
            id: a.id,
            kind: "email_action" as const,
            subject: a.subject,
            recipientEmail: a.recipientEmail,
            status: a.status,
            errorMessage: a.errorMessage,
            at: a.executedAt ?? a.createdAt,
          })),
          ...sentFollowups.map((f) => ({
            id: f.id,
            kind: "followup" as const,
            subject: f.subject,
            recipientEmail: f.recipient_email,
            status: f.status,
            errorMessage: f.error_message,
            at: f.sent_at,
          })),
        ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()).slice(0, 25),
        automations: {
          emergencyPaused,
          sequences: Array.from(sequenceMap.values()),
        },
        counts: {
          pendingApprovals: pendingApprovals.length,
          scheduledFollowups: followups.length,
          failedRecently: recentActions.filter((a) => a.status === "failed").length
            + sentFollowups.filter((f) => f.status === "failed").length,
        },
      });
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      console.error("[Kevin Inbox] error:", err?.message);
      res.status(500).json({ message: "Failed to load Kevin inbox" });
    }
  });
}
