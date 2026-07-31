/**
 * Kevin Inbox Routes — Kevin's AgentMail-based org communication center.
 *
 * Kevin's single inbox is kevin@trainefficiency.com (AgentMail).
 * He handles ALL org communications through that one inbox and organises
 * each org under its own label on his VM.
 *
 * This endpoint returns:
 *   - Kevin's live AgentMail threads (from kevin@trainefficiency.com)
 *   - Pending approval drafts Kevin has queued (gmail_agent_actions)
 *   - Scheduled / pending-review follow-ups (agent_mail_followups)
 *   - Recent sent / failed activity
 *   - Automation state (emergency pause, follow-up sequences)
 *   - Org label registry (what label Kevin uses for this org)
 *
 * Read-only — mutations go through existing gated endpoints.
 * Org resolution is ALWAYS server-side via resolveOrgIdOrThrow (fail closed).
 */

import type { Express } from "express";
import { sql, and, eq, isNull, desc, inArray } from "drizzle-orm";
import { db } from "./db";
import { gmailAgentActions, orgAiGovernanceSettings } from "@shared/schema";
import { resolveOrgIdOrThrow, handleOrgError } from "./lib/resolve-org-id";

// ─── Kevin's dedicated AgentMail inbox ───────────────────────────────────────

const KEVIN_INBOX = "kevin@trainefficiency.com";

function getAgentMailConfig() {
  return {
    apiKey: process.env.AGENTMAIL_API_KEY ?? "",
    baseUrl: (process.env.AGENTMAIL_BASE_URL ?? "https://api.agentmail.to/v0").replace(/\/$/, ""),
  };
}

async function fetchKevinThreads(limit = 30): Promise<{
  ok: boolean;
  threads: any[];
  error?: string;
}> {
  const { apiKey, baseUrl } = getAgentMailConfig();
  if (!apiKey) return { ok: false, threads: [], error: "AgentMail not configured" };

  try {
    const res = await fetch(`${baseUrl}/inboxes/${KEVIN_INBOX}/threads?limit=${limit}`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) return { ok: false, threads: [], error: data?.message ?? `HTTP ${res.status}` };
    const threads: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.threads) ? data.threads
      : Array.isArray(data?.messages) ? data.messages
      : [];
    return { ok: true, threads };
  } catch (err: any) {
    return { ok: false, threads: [], error: err?.message ?? "Network error" };
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

const PENDING_STATUSES = ["proposed", "pending_approval", "awaiting_approval", "blocked"];

// ─── Ensure org-label table exists ───────────────────────────────────────────

let labelTableReady = false;
async function ensureLabelTable() {
  if (labelTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kevin_org_inbox_labels (
      id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id        TEXT NOT NULL UNIQUE,
      label_name    TEXT NOT NULL,
      label_color   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notified_at   TIMESTAMPTZ,
      notes         TEXT
    )
  `);
  labelTableReady = true;
}

/**
 * Called from ensureOrgAiInfrastructure when a new org is provisioned.
 * Inserts a label record so Kevin knows to create the matching label
 * on his VM inbox.
 */
export async function ensureKevinOrgLabel(orgId: string, orgName?: string): Promise<void> {
  try {
    await ensureLabelTable();
    const label = (orgName ?? orgId).replace(/[^a-zA-Z0-9\s\-_]/g, "").trim().slice(0, 60) || orgId;
    await db.execute(sql`
      INSERT INTO kevin_org_inbox_labels (org_id, label_name)
      VALUES (${orgId}, ${label})
      ON CONFLICT (org_id) DO NOTHING
    `);
    console.log(`[KevinInbox] Label registered for org=${orgId} label="${label}"`);
  } catch (err: any) {
    console.error(`[KevinInbox] ensureKevinOrgLabel error: ${err?.message}`);
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export function registerKevinInboxRoutes(app: Express, isAuthenticated: any, requireRole: any) {
  app.get("/api/kevin/inbox", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res: any) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      await ensureLabelTable();

      const [
        kevinThreadsResult,
        pendingApprovals,
        recentActions,
        followupsRaw,
        sentFollowupsRaw,
        governanceRows,
        labelRows,
      ] = await Promise.all([
        // Kevin's live AgentMail inbox threads
        fetchKevinThreads(30),

        // Pending approval drafts Kevin has queued for this org
        db.select().from(gmailAgentActions).where(and(
          eq(gmailAgentActions.orgId, orgId),
          eq(gmailAgentActions.approvalRequired, true),
          isNull(gmailAgentActions.executedAt),
          inArray(gmailAgentActions.status, PENDING_STATUSES),
        )).orderBy(desc(gmailAgentActions.createdAt)).limit(25),

        // Recent executed / failed / rejected activity for this org
        db.select().from(gmailAgentActions).where(and(
          eq(gmailAgentActions.orgId, orgId),
          inArray(gmailAgentActions.status, ["executed", "auto_executed", "failed", "rejected", "dismissed"]),
        )).orderBy(desc(gmailAgentActions.createdAt)).limit(25),

        // Upcoming / pending-review follow-up steps
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

        // This org's Kevin inbox label
        db.execute(sql`
          SELECT label_name, label_color, created_at, notified_at
          FROM kevin_org_inbox_labels
          WHERE org_id = ${orgId}
          LIMIT 1
        `).catch(() => []),
      ]);

      const followups = rows(followupsRaw);
      const sentFollowups = rows(sentFollowupsRaw);
      const governance: any = Array.isArray(governanceRows) ? governanceRows[0] : null;
      const emergencyPaused = governance?.emergencyPauseEnabled === true;
      const orgLabel: any = rows(labelRows)[0] ?? null;

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

      // Normalise AgentMail thread shape — API may return slightly different fields
      const kevinThreads = kevinThreadsResult.threads.map((t: any) => ({
        id: t.id ?? t.thread_id ?? t.threadId,
        subject: t.subject ?? "(no subject)",
        from: t.from?.email ?? t.from ?? t.sender_email ?? null,
        fromName: t.from?.name ?? t.sender_name ?? null,
        to: Array.isArray(t.to) ? t.to.map((r: any) => r?.email ?? r).join(", ") : (t.to ?? null),
        snippet: t.snippet ?? t.body_text?.slice(0, 200) ?? null,
        date: t.date ?? t.updated_at ?? t.received_at ?? null,
        isRead: t.is_read ?? t.read ?? true,
        labels: Array.isArray(t.labels) ? t.labels : [],
        messageCount: t.message_count ?? t.messages?.length ?? 1,
      }));

      res.json({
        kevinInbox: {
          email: KEVIN_INBOX,
          configured: kevinThreadsResult.ok,
          threadCount: kevinThreads.length,
          threads: kevinThreads,
          error: kevinThreadsResult.error ?? null,
        },
        orgLabel: orgLabel
          ? {
              labelName: orgLabel.label_name,
              labelColor: orgLabel.label_color,
              createdAt: orgLabel.created_at,
            }
          : null,
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
          kevinThreads: kevinThreads.length,
          scheduledFollowups: followups.length,
          failedRecently:
            recentActions.filter((a) => a.status === "failed").length +
            sentFollowups.filter((f) => f.status === "failed").length,
        },
      });
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      console.error("[Kevin Inbox] error:", err?.message);
      res.status(500).json({ message: "Failed to load Kevin inbox" });
    }
  });
}
