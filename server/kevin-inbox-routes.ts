/**
 * Kevin Inbox Routes — Kevin's AgentMail-first org communication center.
 *
 * Kevin's single inbox is kevin@trainefficiency.com (AgentMail).
 * He handles ALL org communications through that inbox, organized per-org
 * by inbox labels that he creates manually on his VM.
 *
 * ⚠️ AgentMail v0 has NO programmatic label-creation API.
 *    This means label records in kevin_org_inbox_labels have sync_status='pending_vm'
 *    until Kevin manually creates the label on his VM and marks it 'created'.
 *    We NEVER falsely claim labels are created — the table tracks what is known.
 *
 * GET /api/kevin/inbox returns:
 *   - Kevin's live AgentMail threads (from kevin@trainefficiency.com)
 *   - This org's label record (with truthful sync_status)
 *   - Pending approval drafts Kevin has queued (gmail_agent_actions)
 *   - Scheduled / pending-review follow-ups (agent_mail_followups)
 *   - Recent sent / failed activity
 *   - Automation state (emergency pause, follow-up sequences)
 *
 * Read-only — all mutations go through existing safety-gated endpoints.
 * Org resolution is ALWAYS server-side via resolveOrgIdOrThrow (fail closed).
 */

import type { Express } from "express";
import { sql, and, eq, isNull, desc, inArray } from "drizzle-orm";
import { db } from "./db";
import { gmailAgentActions, orgAiGovernanceSettings } from "@shared/schema";
import { resolveOrgIdOrThrow, handleOrgError } from "./lib/resolve-org-id";

// ─── Kevin's dedicated AgentMail inbox ───────────────────────────────────────

export const KEVIN_INBOX_EMAIL = "kevin@trainefficiency.com";

/**
 * Sync status for Kevin's per-org inbox label.
 *
 * pending_vm   — label row registered in DB; Kevin still needs to create it on his VM.
 *                AgentMail v0 has no label-creation API, so we cannot do this
 *                programmatically. This is the ONLY valid initial state.
 * created      — Kevin confirmed label exists in AgentMail (set by Kevin's VM callback).
 * failed       — Kevin's VM attempted creation but hit a permanent error.
 * unsupported  — External system does not support this label type.
 */
export type LabelSyncStatus = "pending_vm" | "created" | "failed" | "unsupported";

// ─── AgentMail fetch helper ───────────────────────────────────────────────────

function getAgentMailConfig() {
  return {
    apiKey: process.env.AGENTMAIL_API_KEY ?? "",
    baseUrl: (process.env.AGENTMAIL_BASE_URL ?? "https://api.agentmail.to/v0").replace(/\/$/, ""),
  };
}

async function fetchKevinThreads(limit = 30): Promise<{
  ok: boolean;
  threads: any[];
  errorKind?: "not_configured" | "auth_failure" | "rate_limit" | "upstream_error" | "timeout" | "malformed";
  errorMessage?: string;
}> {
  const { apiKey, baseUrl } = getAgentMailConfig();
  if (!apiKey) return { ok: false, threads: [], errorKind: "not_configured", errorMessage: "AGENTMAIL_API_KEY not set" };

  try {
    const res = await fetch(`${baseUrl}/inboxes/${KEVIN_INBOX_EMAIL}/threads?limit=${limit}`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch {
      return { ok: false, threads: [], errorKind: "malformed", errorMessage: "Upstream returned non-JSON" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, threads: [], errorKind: "auth_failure", errorMessage: "AgentMail authentication failed" };
    }
    if (res.status === 429) {
      return { ok: false, threads: [], errorKind: "rate_limit", errorMessage: "AgentMail rate limited" };
    }
    if (!res.ok) {
      // Do NOT expose raw API error (may contain internal details)
      return { ok: false, threads: [], errorKind: "upstream_error", errorMessage: `AgentMail returned ${res.status}` };
    }
    const threads: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.threads) ? data.threads
      : Array.isArray(data?.messages) ? data.messages
      : [];
    // Dedup by id
    const seen = new Set<string>();
    const deduped = threads.filter(t => {
      const key = t?.id ?? t?.thread_id ?? null;
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
    return { ok: true, threads: deduped };
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError" || err?.message?.includes("timeout");
    return {
      ok: false, threads: [],
      errorKind: isTimeout ? "timeout" : "upstream_error",
      errorMessage: isTimeout ? "AgentMail request timed out" : "Network error reaching AgentMail",
    };
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

const PENDING_STATUSES = ["proposed", "pending_approval", "awaiting_approval", "blocked"];

// ─── kevin_org_inbox_labels table ────────────────────────────────────────────
// Tracks per-org label requests for Kevin's inbox.
// sync_status reflects what is KNOWN, not what is claimed.

let _labelTableReady = false;

async function ensureLabelTable() {
  if (_labelTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kevin_org_inbox_labels (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id            TEXT NOT NULL,
      label_name        TEXT NOT NULL,
      label_color       TEXT,
      sync_status       TEXT NOT NULL DEFAULT 'pending_vm',
      agentmail_label_id TEXT,
      last_sync_attempt TIMESTAMPTZ,
      synced_at         TIMESTAMPTZ,
      last_error        TEXT,
      retry_count       INTEGER NOT NULL DEFAULT 0,
      notes             TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT kevin_org_inbox_labels_org_id_unique UNIQUE (org_id)
    )
  `);
  // Idempotent migrations for pre-existing tables that lack the new columns
  const migrations = [
    `ALTER TABLE kevin_org_inbox_labels ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'pending_vm'`,
    `ALTER TABLE kevin_org_inbox_labels ADD COLUMN IF NOT EXISTS agentmail_label_id TEXT`,
    `ALTER TABLE kevin_org_inbox_labels ADD COLUMN IF NOT EXISTS last_sync_attempt TIMESTAMPTZ`,
    `ALTER TABLE kevin_org_inbox_labels ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ`,
    `ALTER TABLE kevin_org_inbox_labels ADD COLUMN IF NOT EXISTS last_error TEXT`,
    `ALTER TABLE kevin_org_inbox_labels ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE kevin_org_inbox_labels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  ];
  for (const m of migrations) {
    await db.execute(sql.raw(m)).catch(() => {});
  }
  _labelTableReady = true;
}

/**
 * Normalize an org name to a safe, deterministic label name.
 * Rules: strip non-alphanumeric chars except spaces/dashes/underscores,
 * collapse whitespace, truncate to 60 chars, fall back to org_id prefix.
 */
function normalizeLabelName(raw: string | null | undefined, orgId: string): string {
  if (!raw?.trim()) return `org-${orgId.slice(0, 8)}`;
  return raw
    .replace(/[^a-zA-Z0-9\s\-_]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60)
    || `org-${orgId.slice(0, 8)}`;
}

/**
 * Register (or idempotently confirm) a Kevin inbox label for an org.
 * Sets sync_status='pending_vm' — the truthful state when AgentMail v0
 * does not support programmatic label creation.
 *
 * Safe under concurrent calls: ON CONFLICT DO NOTHING.
 * Renaming an org does NOT update an existing label (prevents silent duplicates).
 */
export async function ensureKevinOrgLabel(orgId: string, orgName?: string): Promise<void> {
  try {
    await ensureLabelTable();
    const labelName = normalizeLabelName(orgName, orgId);
    await db.execute(sql`
      INSERT INTO kevin_org_inbox_labels (org_id, label_name, sync_status, updated_at)
      VALUES (${orgId}, ${labelName}, 'pending_vm', NOW())
      ON CONFLICT (org_id) DO NOTHING
    `);
    console.log(`[KevinInbox] Label registered org=${orgId} label="${labelName}" status=pending_vm`);
  } catch (err: any) {
    console.error(`[KevinInbox] ensureKevinOrgLabel error: ${err?.message}`);
  }
}

/**
 * Mark a label as successfully created by Kevin's VM.
 * This is the ONLY path that sets sync_status='created'.
 * Called from Kevin's VM callback endpoint (not yet built — placeholder).
 */
export async function markKevinLabelCreated(orgId: string, agentmailLabelId?: string): Promise<void> {
  await ensureLabelTable();
  await db.execute(sql`
    UPDATE kevin_org_inbox_labels
    SET sync_status = 'created',
        agentmail_label_id = ${agentmailLabelId ?? null},
        synced_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
    WHERE org_id = ${orgId}
  `);
}

/**
 * Record a label sync failure from Kevin's VM.
 */
export async function recordKevinLabelSyncFailure(orgId: string, error: string, permanent = false): Promise<void> {
  await ensureLabelTable();
  await db.execute(sql`
    UPDATE kevin_org_inbox_labels
    SET sync_status = ${permanent ? "failed" : "pending_vm"},
        last_sync_attempt = NOW(),
        last_error = ${error.slice(0, 500)},
        retry_count = retry_count + 1,
        updated_at = NOW()
    WHERE org_id = ${orgId}
  `);
}

/**
 * Backfill all orgs that do not yet have a label record.
 * Safe to run multiple times — idempotent.
 */
export async function backfillKevinOrgLabels(): Promise<{ registered: number; errors: number }> {
  await ensureLabelTable();
  let registered = 0; let errors = 0;
  try {
    const orgsRaw = await db.execute(sql`
      SELECT o.id, o.name
      FROM organizations o
      WHERE NOT EXISTS (
        SELECT 1 FROM kevin_org_inbox_labels k WHERE k.org_id = o.id
      )
    `);
    const orgs = rows(orgsRaw);
    for (const org of orgs) {
      try { await ensureKevinOrgLabel(org.id, org.name); registered++; }
      catch { errors++; }
    }
  } catch (err: any) {
    console.error(`[KevinInbox] backfillKevinOrgLabels error: ${err?.message}`);
    errors++;
  }
  return { registered, errors };
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
        fetchKevinThreads(30),

        db.select().from(gmailAgentActions).where(and(
          eq(gmailAgentActions.orgId, orgId),
          eq(gmailAgentActions.approvalRequired, true),
          isNull(gmailAgentActions.executedAt),
          inArray(gmailAgentActions.status, PENDING_STATUSES),
        )).orderBy(desc(gmailAgentActions.createdAt)).limit(25),

        db.select().from(gmailAgentActions).where(and(
          eq(gmailAgentActions.orgId, orgId),
          inArray(gmailAgentActions.status, ["executed", "auto_executed", "failed", "rejected", "dismissed"]),
        )).orderBy(desc(gmailAgentActions.createdAt)).limit(25),

        db.execute(sql`
          SELECT id, recipient_email, recipient_name, subject, sequence_name, sequence_step,
                 scheduled_for, status, approval_status, sent_at, error_message, created_at
          FROM agent_mail_followups
          WHERE organization_id = ${orgId}
            AND status IN ('scheduled', 'processing', 'pending_review')
          ORDER BY scheduled_for ASC LIMIT 25
        `).catch(() => []),

        db.execute(sql`
          SELECT id, recipient_email, subject, sequence_name, sequence_step,
                 status, sent_at, error_message
          FROM agent_mail_followups
          WHERE organization_id = ${orgId}
            AND status IN ('sent', 'failed', 'cancelled', 'skipped')
          ORDER BY COALESCE(sent_at, updated_at) DESC LIMIT 15
        `).catch(() => []),

        db.select().from(orgAiGovernanceSettings)
          .where(eq(orgAiGovernanceSettings.orgId, orgId)).limit(1)
          .catch(() => [] as any[]),

        // This org's Kevin inbox label — server-resolved org only, no client input
        db.execute(sql`
          SELECT label_name, label_color, sync_status, agentmail_label_id,
                 last_sync_attempt, synced_at, last_error, retry_count, created_at, updated_at
          FROM kevin_org_inbox_labels
          WHERE org_id = ${orgId}
          LIMIT 1
        `).catch(() => []),
      ]);

      const followups = rows(followupsRaw);
      const sentFollowups = rows(sentFollowupsRaw);
      const governance: any = Array.isArray(governanceRows) ? governanceRows[0] : null;
      const emergencyPaused = governance?.emergencyPauseEnabled === true;
      const labelRow: any = rows(labelRows)[0] ?? null;

      const sequenceMap = new Map<string, { sequenceName: string; scheduledSteps: number; nextScheduledFor: string | null }>();
      for (const f of followups) {
        const key = f.sequence_name ?? "default";
        const entry = sequenceMap.get(key) ?? { sequenceName: key, scheduledSteps: 0, nextScheduledFor: null };
        entry.scheduledSteps++;
        const sf = f.scheduled_for ? new Date(f.scheduled_for).toISOString() : null;
        if (sf && (!entry.nextScheduledFor || sf < entry.nextScheduledFor)) entry.nextScheduledFor = sf;
        sequenceMap.set(key, entry);
      }

      // Normalize AgentMail thread shape — ordered newest-first as returned by API
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
          email: KEVIN_INBOX_EMAIL,
          configured: kevinThreadsResult.ok,
          threadCount: kevinThreads.length,
          threads: kevinThreads,
          // errorKind is surfaced for diagnostics but NEVER contains credentials
          errorKind: kevinThreadsResult.errorKind ?? null,
          errorMessage: kevinThreadsResult.errorMessage ?? null,
        },
        // Truthful label status — pending_vm means Kevin still needs to create it on his VM
        orgLabel: labelRow ? {
          labelName: labelRow.label_name,
          labelColor: labelRow.label_color,
          syncStatus: labelRow.sync_status as LabelSyncStatus,
          agentmailLabelId: labelRow.agentmail_label_id ?? null,
          lastSyncAttempt: labelRow.last_sync_attempt ?? null,
          syncedAt: labelRow.synced_at ?? null,
          lastError: labelRow.last_error ?? null,
          retryCount: labelRow.retry_count ?? 0,
          createdAt: labelRow.created_at,
        } : null,
        // Pending outbound drafts Kevin created — distinct from inbound threads
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
            id: a.id, kind: "email_action" as const,
            subject: a.subject, recipientEmail: a.recipientEmail,
            status: a.status, errorMessage: a.errorMessage,
            at: a.executedAt ?? a.createdAt,
          })),
          ...sentFollowups.map((f) => ({
            id: f.id, kind: "followup" as const,
            subject: f.subject, recipientEmail: f.recipient_email,
            status: f.status, errorMessage: f.error_message, at: f.sent_at,
          })),
        ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()).slice(0, 25),
        automations: { emergencyPaused, sequences: Array.from(sequenceMap.values()) },
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
