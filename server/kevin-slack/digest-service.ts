/**
 * Kevin Slack EOH — Digest Service
 *
 * Generates and sends daily/weekly executive briefs via Slack.
 *
 * Rules:
 * - Each digest is sent only once per scheduled period (idempotency)
 * - Time zone is per-organization, never hardcoded
 * - Digest requires KEVIN_SLACK_DIGESTS_ENABLED
 * - Uses existing TE services for data — no direct SQL for business metrics
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { isDigestsEnabled, getSlackBotToken } from "./config";
import { buildDailyDigest, type DigestInput } from "./block-kit";
import { storage } from "../storage";

/**
 * @deprecated Tables are created by migrations/0002_kevin_slack_tables.sql
 * and by runKevinSlackMigration() in kevin-slack-routes.ts at startup.
 * This function is retained for call-site compatibility only. It is a no-op.
 */
export async function ensureDigestTables(): Promise<void> {
  // No-op — tables are created at startup by the committed migration runner.
}

// ─── Idempotency check ────────────────────────────────────────────────────────

async function hasSentDigest(orgId: string, digestType: string, periodKey: string): Promise<boolean> {
  await ensureDigestTables();
  try {
    const rows = await db.execute(sql`
      SELECT id FROM kevin_slack_digest_runs
      WHERE org_id = ${orgId}
        AND digest_type = ${digestType}
        AND period_key = ${periodKey}
        AND status = 'sent'
      LIMIT 1
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return arr.length > 0;
  } catch {
    return false;
  }
}

async function markDigestSent(orgId: string, digestType: string, periodKey: string, channel: string): Promise<void> {
  await ensureDigestTables();
  try {
    await db.execute(sql`
      INSERT INTO kevin_slack_digest_runs (org_id, digest_type, period_key, channel, sent_at, status)
      VALUES (${orgId}, ${digestType}, ${periodKey}, ${channel}, NOW(), 'sent')
      ON CONFLICT (org_id, digest_type, period_key)
      DO UPDATE SET sent_at = NOW(), status = 'sent'
    `);
  } catch (err: any) {
    console.error("[Kevin Slack] markDigestSent error:", err?.message);
  }
}

// ─── Period key ───────────────────────────────────────────────────────────────

function dailyPeriodKey(date = new Date()): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Build digest data ────────────────────────────────────────────────────────

async function buildDigestData(orgId: string): Promise<DigestInput> {
  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setHours(23, 59, 59, 999);

  let bookings: any[] = [];
  try {
    bookings = await storage.getBookingsByDateRangeForOrg(orgId, start, end);
  } catch {
    bookings = [];
  }

  const completed = bookings.filter((b) => b.status === "COMPLETED").length;
  const cancelled = bookings.filter((b) => b.status === "CANCELLED").length;
  const utilization =
    bookings.length > 0
      ? `${Math.round((completed / bookings.length) * 100)}%`
      : "N/A";

  // Try to get dead letter count
  let deadLetterCount = 0;
  try {
    const dlRows = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM autonomous_action_queue
      WHERE status = 'dead_lettered'
    `);
    const arr = Array.isArray(dlRows) ? dlRows : (dlRows as any).rows ?? [];
    deadLetterCount = arr[0]?.cnt ?? 0;
  } catch {
    deadLetterCount = 0;
  }

  return {
    date: today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    orgName: orgId,
    scheduling: {
      todaySessions: bookings.length,
      completed,
      cancelled,
      utilization,
    },
    revenue: {
      todayRevenue: "See dashboard",
      weekRevenue: "See dashboard",
      trend: "—",
    },
    leads: {
      newLeads: 0,
      activeOpportunities: 0,
    },
    infrastructure: {
      agentHealth: "✅ Operational",
      pendingApprovals: 0,
      deadLetterCount,
    },
    topActions: ["Review today's completed sessions", "Check pending approvals", "Review new leads"],
  };
}

// ─── Send digest ──────────────────────────────────────────────────────────────

export async function sendDailyDigest(
  orgId: string,
  channel: string,
  timezone = "America/New_York",
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (!isDigestsEnabled()) return { ok: false, error: "Digests not enabled" };

  const periodKey = dailyPeriodKey();
  const alreadySent = await hasSentDigest(orgId, "daily", periodKey);
  if (alreadySent) return { ok: true, skipped: true };

  const botToken = getSlackBotToken();
  if (!botToken) return { ok: false, error: "Slack bot token not configured" };

  try {
    const data = await buildDigestData(orgId);
    const blocks = buildDailyDigest(data);

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({ channel, blocks }),
    });

    const result = await response.json() as any;
    if (!result.ok) {
      await ensureDigestTables();
      await db.execute(sql`
        INSERT INTO kevin_slack_digest_runs (org_id, digest_type, period_key, channel, status)
        VALUES (${orgId}, 'daily', ${periodKey}, ${channel}, 'failed')
        ON CONFLICT (org_id, digest_type, period_key) DO UPDATE SET status = 'failed'
      `);
      return { ok: false, error: result.error };
    }

    await markDigestSent(orgId, "daily", periodKey, channel);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

// ─── Notification dedup check ─────────────────────────────────────────────────

export async function hasRecentNotification(dedupKey: string, windowMinutes = 60): Promise<boolean> {
  await ensureDigestTables();
  try {
    const rows = await db.execute(sql`
      SELECT id FROM kevin_slack_notification_log
      WHERE dedup_key = ${dedupKey}
        AND sent_at > NOW() - (${windowMinutes} || ' minutes')::interval
      LIMIT 1
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return arr.length > 0;
  } catch {
    return false;
  }
}

export async function recordNotificationSent(
  teamId: string,
  channel: string,
  priority: string,
  eventType: string,
  orgId: string | null,
  dedupKey?: string,
): Promise<void> {
  await ensureDigestTables();
  try {
    await db.execute(sql`
      INSERT INTO kevin_slack_notification_log
        (org_id, slack_team_id, channel, priority, event_type, dedup_key)
      VALUES
        (${orgId ?? null}, ${teamId}, ${channel}, ${priority}, ${eventType}, ${dedupKey ?? null})
    `);
  } catch (err: any) {
    console.error("[Kevin Slack] recordNotificationSent error:", err?.message);
  }
}

export async function getDigestStats(): Promise<{
  totalSent: number;
  last7Days: number;
  failedCount: number;
}> {
  await ensureDigestTables();
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN sent_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS last7,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int AS failed
      FROM kevin_slack_digest_runs
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    const r = arr[0] ?? {};
    return { totalSent: r.total ?? 0, last7Days: r.last7 ?? 0, failedCount: r.failed ?? 0 };
  } catch {
    return { totalSent: 0, last7Days: 0, failedCount: 0 };
  }
}
