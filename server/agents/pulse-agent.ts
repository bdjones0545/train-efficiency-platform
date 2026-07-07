/**
 * Pulse Agent — Retention Agent
 * agentType: "retention_agent" | name: "Pulse"
 *
 * Runs daily (or on-demand). For every org:
 *   1. Expires stale pending_review recommendations (> 7 days old)
 *   2. Scans client attendance, booking history, package/subscription status,
 *      communication history, and client value
 *   3. Detects churn and retention signals
 *   4. Deduplicates: skips signals that already have a pending_review recommendation
 *   5. Inserts new recommendations into pulse_recommendations table
 *   6. Writes run summary to unified_agent_action_log (workforce dashboard counter)
 *
 * Recommendation-only — no automatic outreach.
 */

import { db } from "../db";
import { sql, and, eq, lt, gte, inArray, desc } from "drizzle-orm";
import {
  bookings,
  userSubscriptions,
  userProfiles,
  users,
  organizations,
} from "@shared/schema";
import { logUnifiedAction } from "../unified-action-logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PulseSignalType =
  | "inactive_client"
  | "high_churn_risk"
  | "expiring_subscription"
  | "cancelled_subscription"
  | "no_show_pattern"
  | "declining_frequency"
  | "lapsed_client"
  | "low_session_remaining";

export type UrgencyLevel = "critical" | "high" | "medium" | "low";

export interface PulseSignal {
  signalType: PulseSignalType;
  urgency: UrgencyLevel;
  entityType: "client" | "subscription" | "booking";
  entityId: string;
  entityName: string;
  estimatedValueCents: number;
  staleDays: number;
  recommendedAction: string;
  reasonText: string;
  confidenceScore: number;
  sourceUrl: string;
}

export interface PulseRunResult {
  orgId: string;
  runId: string;
  triggeredBy: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  clientsEvaluated: number;
  subscriptionsEvaluated: number;
  signalsDetected: number;
  newRecommendations: number;
  skippedDuplicates: number;
  expired: number;
  signals: PulseSignal[];
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(date: Date | string | null | undefined): number {
  if (!date) return 999;
  const d = typeof date === "string" ? new Date(date) : date;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function daysUntil(date: Date | string | null | undefined): number {
  if (!date) return 999;
  const d = typeof date === "string" ? new Date(date) : date;
  return Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function scoreUrgency(staleDays: number, churnRisk: number): UrgencyLevel {
  if (staleDays >= 60 || churnRisk >= 90) return "critical";
  if (staleDays >= 30 || churnRisk >= 70) return "high";
  if (staleDays >= 14 || churnRisk >= 50) return "medium";
  return "low";
}

function clientSourceUrl(clientId: string): string {
  return `/admin/clients/${clientId}`;
}

// ─── Table setup ──────────────────────────────────────────────────────────────

export async function ensurePulseRecommendationsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pulse_recommendations (
      id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id               TEXT NOT NULL,
      signal_type          TEXT NOT NULL,
      entity_type          TEXT NOT NULL,
      entity_id            TEXT NOT NULL,
      entity_name          TEXT,
      urgency              TEXT NOT NULL DEFAULT 'medium',
      estimated_value_cents INTEGER DEFAULT 0,
      reason_text          TEXT,
      recommended_action   TEXT,
      confidence_score     DOUBLE PRECISION,
      stale_days           INTEGER DEFAULT 0,
      source_url           TEXT,
      status               TEXT NOT NULL DEFAULT 'pending_review',
      status_updated_at    TIMESTAMPTZ,
      status_updated_by    TEXT,
      dismiss_reason       TEXT,
      run_id               TEXT,
      expires_at           TIMESTAMPTZ,
      created_at           TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await db.execute(sql`CREATE INDEX IF NOT EXISTS pulse_rec_org_status ON pulse_recommendations (org_id, status)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pulse_rec_dedup ON pulse_recommendations (org_id, signal_type, entity_id, status)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pulse_rec_created ON pulse_recommendations (org_id, created_at DESC)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pulse_rec_expires ON pulse_recommendations (org_id, expires_at) WHERE status = 'pending_review'`).catch(() => {});
}

// ─── Dedup check ──────────────────────────────────────────────────────────────

async function hasPendingRecommendation(
  orgId: string,
  signalType: string,
  entityId: string
): Promise<boolean> {
  const rows = await db
    .execute(
      sql`
      SELECT id FROM pulse_recommendations
      WHERE org_id = ${orgId}
        AND signal_type = ${signalType}
        AND entity_id = ${entityId}
        AND status = 'pending_review'
      LIMIT 1
    `
    )
    .catch(() => ({ rows: [] }));
  const r = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  return r.length > 0;
}

// ─── Auto-expire stale pending recommendations ─────────────────────────────────

async function expireStalePendingRecs(orgId: string): Promise<number> {
  const now = new Date();
  const result = await db
    .execute(
      sql`
    UPDATE pulse_recommendations
    SET status = 'expired', status_updated_at = ${now}, status_updated_by = 'system'
    WHERE org_id = ${orgId}
      AND status = 'pending_review'
      AND expires_at IS NOT NULL
      AND expires_at < ${now}
  `
    )
    .catch(() => ({ rowCount: 0 }));
  return (result as any).rowCount ?? 0;
}

// ─── Signal detectors ─────────────────────────────────────────────────────────

interface ClientBookingStats {
  clientId: string;
  clientName: string;
  clientEmail: string;
  totalBookings: number;
  lastBookingAt: Date | null;
  recentBookings30d: number;
  recentBookings60d: number;
  cancelledLast30d: number;
  noShowLast30d: number;
  staleDays: number;
}

async function buildClientStats(
  orgId: string,
  clientIds: string[]
): Promise<ClientBookingStats[]> {
  if (clientIds.length === 0) return [];

  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Get user details
  const clientUsers = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, clientIds.slice(0, 150)))
    .catch(() => []);

  const userMap = new Map(clientUsers.map((u) => [u.id, u]));

  // Get all bookings for these clients in this org (last 90 days)
  const d90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const allBookings = await db
    .select({
      clientId: bookings.clientId,
      startAt: bookings.startAt,
      status: bookings.status,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        gte(bookings.startAt, d90),
        inArray(bookings.clientId, clientIds.slice(0, 150))
      )
    )
    .catch(() => []);

  // Get most recent booking per client (all time)
  const latestBookings = await db
    .execute(
      sql`
    SELECT DISTINCT ON (client_id) client_id, start_at
    FROM bookings
    WHERE organization_id = ${orgId}
      AND client_id = ANY(${sql.raw(`ARRAY[${clientIds.slice(0, 150).map((id) => `'${id}'`).join(",")}]`)})
    ORDER BY client_id, start_at DESC
  `
    )
    .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
    .catch(() => []);

  const lastBookingMap = new Map<string, Date | null>();
  for (const row of latestBookings) {
    lastBookingMap.set(row.client_id, row.start_at ? new Date(row.start_at) : null);
  }

  const statsMap = new Map<string, ClientBookingStats>();

  for (const cid of clientIds.slice(0, 150)) {
    const u = userMap.get(cid);
    const name = u
      ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email
      : `Client ${cid.slice(0, 8)}`;
    const email = u?.email ?? "";

    const myBookings = allBookings.filter((b) => b.clientId === cid);
    const lastAt = lastBookingMap.get(cid) ?? null;

    statsMap.set(cid, {
      clientId: cid,
      clientName: name,
      clientEmail: email,
      totalBookings: myBookings.length,
      lastBookingAt: lastAt,
      recentBookings30d: myBookings.filter(
        (b) =>
          b.startAt >= d30 &&
          b.status !== "CANCELLED" &&
          b.status !== "NO_SHOW"
      ).length,
      recentBookings60d: myBookings.filter(
        (b) =>
          b.startAt >= d60 &&
          b.status !== "CANCELLED" &&
          b.status !== "NO_SHOW"
      ).length,
      cancelledLast30d: myBookings.filter(
        (b) => b.startAt >= d30 && b.status === "CANCELLED"
      ).length,
      noShowLast30d: myBookings.filter(
        (b) => b.startAt >= d30 && b.status === "NO_SHOW"
      ).length,
      staleDays: daysSince(lastAt),
    });
  }

  return Array.from(statsMap.values());
}

async function detectClientSignals(
  orgId: string
): Promise<PulseSignal[]> {
  const signals: PulseSignal[] = [];

  // Get all CLIENT profiles for this org
  const clientProfiles = await db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.organizationId, orgId),
        eq(userProfiles.role, "CLIENT")
      )
    )
    .catch(() => []);

  const clientIds = clientProfiles.map((p) => p.userId);
  if (clientIds.length === 0) return signals;

  const stats = await buildClientStats(orgId, clientIds);

  for (const stat of stats) {
    const {
      clientId,
      clientName,
      staleDays,
      recentBookings30d,
      recentBookings60d,
      cancelledLast30d,
      noShowLast30d,
    } = stat;

    const sourceUrl = clientSourceUrl(clientId);

    // 1. Lapsed client — no booking in 60+ days
    if (staleDays >= 60) {
      const urgency = scoreUrgency(staleDays, staleDays >= 90 ? 95 : 80);
      signals.push({
        signalType: "lapsed_client",
        urgency,
        entityType: "client",
        entityId: clientId,
        entityName: clientName,
        estimatedValueCents: 0,
        staleDays,
        recommendedAction: `Win back ${clientName} — no activity for ${staleDays} days`,
        reasonText: `${clientName} has not booked a session in ${staleDays} days. Clients inactive for 60+ days have a significantly higher churn probability. A personal re-engagement outreach now can recover 20–40% of lapsed clients.`,
        confidenceScore: 0.92,
        sourceUrl,
      });
      continue;
    }

    // 2. High churn risk — inactive + multiple cancellations
    if (
      staleDays >= 21 &&
      (cancelledLast30d >= 2 || noShowLast30d >= 2)
    ) {
      const churnRisk =
        Math.min(
          90,
          60 + cancelledLast30d * 8 + noShowLast30d * 6 + Math.min(staleDays - 21, 30)
        );
      const urgency = scoreUrgency(staleDays, churnRisk);
      signals.push({
        signalType: "high_churn_risk",
        urgency,
        entityType: "client",
        entityId: clientId,
        entityName: clientName,
        estimatedValueCents: 0,
        staleDays,
        recommendedAction: `Intervene with ${clientName} — high churn risk (${cancelledLast30d} cancellations, ${noShowLast30d} no-shows in 30 days)`,
        reasonText: `${clientName} has ${cancelledLast30d} cancellations and ${noShowLast30d} no-shows in the last 30 days, combined with ${staleDays} days since their last confirmed session. This pattern is a strong churn indicator. Proactive coach outreach is recommended.`,
        confidenceScore: 0.88,
        sourceUrl,
      });
      continue;
    }

    // 3. Inactive client — no booking in 30 days
    if (staleDays >= 30 && staleDays < 60) {
      const urgency = scoreUrgency(staleDays, 55);
      signals.push({
        signalType: "inactive_client",
        urgency,
        entityType: "client",
        entityId: clientId,
        entityName: clientName,
        estimatedValueCents: 0,
        staleDays,
        recommendedAction: `Re-engage ${clientName} — no bookings for ${staleDays} days`,
        reasonText: `${clientName} last attended a session ${staleDays} days ago. Clients with 30+ day gaps are at elevated churn risk. A check-in message or session offer could re-establish momentum.`,
        confidenceScore: 0.80,
        sourceUrl,
      });
      continue;
    }

    // 4. Declining frequency — active 60d ago but very low 30d
    if (
      recentBookings60d >= 3 &&
      recentBookings30d <= 1 &&
      staleDays >= 14
    ) {
      signals.push({
        signalType: "declining_frequency",
        urgency: "medium",
        entityType: "client",
        entityId: clientId,
        entityName: clientName,
        estimatedValueCents: 0,
        staleDays,
        recommendedAction: `Check in with ${clientName} — session frequency dropped significantly`,
        reasonText: `${clientName} attended ${recentBookings60d} sessions in the prior 30-day window but only ${recentBookings30d} in the last 30 days. Declining frequency often precedes full churn. Early intervention is most effective.`,
        confidenceScore: 0.75,
        sourceUrl,
      });
      continue;
    }

    // 5. No-show pattern
    if (noShowLast30d >= 2) {
      signals.push({
        signalType: "no_show_pattern",
        urgency: "medium",
        entityType: "client",
        entityId: clientId,
        entityName: clientName,
        estimatedValueCents: 0,
        staleDays,
        recommendedAction: `Address no-show pattern with ${clientName} — ${noShowLast30d} missed sessions in 30 days`,
        reasonText: `${clientName} has missed ${noShowLast30d} sessions without cancelling in the last 30 days. Repeated no-shows indicate disengagement. Consider a check-in to understand barriers and adjust scheduling.`,
        confidenceScore: 0.72,
        sourceUrl,
      });
    }
  }

  return signals;
}

async function detectSubscriptionSignals(
  orgId: string
): Promise<PulseSignal[]> {
  const signals: PulseSignal[] = [];
  const now = new Date();
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Expiring subscriptions (next 14 days)
  const expiring = await db
    .select()
    .from(userSubscriptions)
    .where(
      and(
        eq(userSubscriptions.organizationId, orgId),
        eq(userSubscriptions.status, "active"),
        lt(userSubscriptions.currentPeriodEnd, in14Days),
        gte(userSubscriptions.currentPeriodEnd, now)
      )
    )
    .limit(100)
    .catch(() => []);

  for (const sub of expiring) {
    const daysLeft = daysUntil(sub.currentPeriodEnd);
    const urgency: UrgencyLevel = daysLeft <= 3 ? "critical" : daysLeft <= 7 ? "high" : "medium";
    const sessionsLeft = sub.sessionsRemaining ?? null;

    signals.push({
      signalType: "expiring_subscription",
      urgency,
      entityType: "subscription",
      entityId: sub.id,
      entityName: `Subscription ${sub.id.slice(0, 8)}`,
      estimatedValueCents: 0,
      staleDays: 0,
      recommendedAction: `Renew subscription for user ${sub.userId.slice(0, 8)} — expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
      reasonText: `Subscription ${sub.id.slice(0, 8)} expires on ${sub.currentPeriodEnd?.toLocaleDateString() ?? "unknown"}. ${
        sessionsLeft != null ? `${sessionsLeft} session${sessionsLeft !== 1 ? "s" : ""} remaining. ` : ""
      }Proactive renewal outreach reduces involuntary churn. Contact the client now before the subscription lapses.`,
      confidenceScore: 0.95,
      sourceUrl: `/admin/clients/${sub.userId}`,
    });
  }

  // Low sessions remaining (≤ 2 sessions left on active subscription)
  const lowSessions = await db
    .select()
    .from(userSubscriptions)
    .where(
      and(
        eq(userSubscriptions.organizationId, orgId),
        eq(userSubscriptions.status, "active"),
        sql`sessions_remaining IS NOT NULL AND sessions_remaining <= 2 AND sessions_remaining > 0`
      )
    )
    .limit(100)
    .catch(() => []);

  for (const sub of lowSessions) {
    // Skip if already flagged for expiry
    if (expiring.some((e) => e.id === sub.id)) continue;

    const sessionsLeft = sub.sessionsRemaining ?? 1;
    signals.push({
      signalType: "low_session_remaining",
      urgency: sessionsLeft === 1 ? "high" : "medium",
      entityType: "subscription",
      entityId: sub.id,
      entityName: `Subscription ${sub.id.slice(0, 8)}`,
      estimatedValueCents: 0,
      staleDays: 0,
      recommendedAction: `Upsell or renew — client ${sub.userId.slice(0, 8)} has only ${sessionsLeft} session${sessionsLeft !== 1 ? "s" : ""} left`,
      reasonText: `Subscription ${sub.id.slice(0, 8)} has ${sessionsLeft} session${sessionsLeft !== 1 ? "s" : ""} remaining. This is the optimal moment to present a renewal or upgrade offer before the client exhausts their package and potentially churns.`,
      confidenceScore: 0.90,
      sourceUrl: `/admin/clients/${sub.userId}`,
    });
  }

  // Recently cancelled subscriptions
  const cancelled = await db
    .select()
    .from(userSubscriptions)
    .where(
      and(
        eq(userSubscriptions.organizationId, orgId),
        eq(userSubscriptions.status, "cancelled"),
        gte(userSubscriptions.updatedAt, last30d)
      )
    )
    .limit(50)
    .catch(() => []);

  for (const sub of cancelled) {
    const daysSinceCancelled = daysSince(sub.updatedAt);
    signals.push({
      signalType: "cancelled_subscription",
      urgency: daysSinceCancelled <= 7 ? "high" : "medium",
      entityType: "subscription",
      entityId: sub.id,
      entityName: `Subscription ${sub.id.slice(0, 8)}`,
      estimatedValueCents: 0,
      staleDays: daysSinceCancelled,
      recommendedAction: `Win-back outreach for cancelled client ${sub.userId.slice(0, 8)} — cancelled ${daysSinceCancelled} day${daysSinceCancelled !== 1 ? "s" : ""} ago`,
      reasonText: `Subscription ${sub.id.slice(0, 8)} was cancelled ${daysSinceCancelled} days ago. Win-back success rates are highest within the first 14 days of cancellation. A personalised outreach with an incentive now can recover 15–25% of cancellations.`,
      confidenceScore: 0.82,
      sourceUrl: `/admin/clients/${sub.userId}`,
    });
  }

  return signals;
}

// ─── Rank signals ──────────────────────────────────────────────────────────────

function rankSignals(signals: PulseSignal[]): PulseSignal[] {
  const urgencyWeight: Record<UrgencyLevel, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return [...signals].sort((a, b) => {
    const uDiff = urgencyWeight[b.urgency] - urgencyWeight[a.urgency];
    if (uDiff !== 0) return uDiff;
    return b.staleDays - a.staleDays;
  });
}

// ─── Core run function ────────────────────────────────────────────────────────

export async function runPulseForOrg(
  orgId: string,
  triggeredBy: "cron" | "manual" | "startup" = "cron"
): Promise<PulseRunResult> {
  const runId = crypto.randomUUID();
  const startedAt = new Date();

  await ensurePulseRecommendationsTable();

  let clientSignals: PulseSignal[] = [];
  let subscriptionSignals: PulseSignal[] = [];
  let error: string | undefined;

  // Step 1: Auto-expire stale pending recommendations
  const expired = await expireStalePendingRecs(orgId);

  // Step 2: Detect signals in parallel
  try {
    [clientSignals, subscriptionSignals] = await Promise.all([
      detectClientSignals(orgId),
      detectSubscriptionSignals(orgId),
    ]);
  } catch (err: any) {
    error = err.message ?? "Unknown error during signal detection";
    console.error(`[Pulse][${orgId}] Signal detection error:`, err);
  }

  const allSignals = rankSignals([...clientSignals, ...subscriptionSignals]);
  const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Step 3: Write to pulse_recommendations (with dedup)
  let newRecommendations = 0;
  let skippedDuplicates = 0;

  for (const signal of allSignals) {
    const alreadyPending = await hasPendingRecommendation(
      orgId,
      signal.signalType,
      signal.entityId
    );
    if (alreadyPending) {
      skippedDuplicates++;
      continue;
    }

    await db
      .execute(
        sql`
      INSERT INTO pulse_recommendations (
        id, org_id, signal_type, entity_type, entity_id, entity_name,
        urgency, estimated_value_cents, reason_text, recommended_action,
        confidence_score, stale_days, source_url, status, run_id, expires_at, created_at
      ) VALUES (
        gen_random_uuid()::text,
        ${orgId}, ${signal.signalType}, ${signal.entityType}, ${signal.entityId},
        ${signal.entityName}, ${signal.urgency}, ${signal.estimatedValueCents},
        ${signal.reasonText}, ${signal.recommendedAction}, ${signal.confidenceScore},
        ${signal.staleDays}, ${signal.sourceUrl}, 'pending_review',
        ${runId}, ${sevenDaysOut}, NOW()
      )
    `
      )
      .catch((err) => {
        console.error(
          `[Pulse][${orgId}] Failed to insert recommendation for ${signal.signalType}/${signal.entityId}:`,
          err
        );
      });

    newRecommendations++;
  }

  // Step 4: Write run summary to unified_agent_action_log
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  await logUnifiedAction({
    orgId,
    actorType: "retention_agent",
    actorName: "Pulse",
    actionType: "pulse:run_complete",
    workflowRunId: runId,
    status: error ? "failed" : "completed",
    riskLevel: "low",
    reasoningSummary: error
      ? `Pulse run failed: ${error}`
      : `Pulse scanned retention signals — ${newRecommendations} new recommendation${newRecommendations !== 1 ? "s" : ""}, ${skippedDuplicates} deduplicated, ${expired} expired`,
    inputSnapshot: { triggeredBy, orgId },
    outputSnapshot: {
      clientsEvaluated: clientSignals.length,
      subscriptionsEvaluated: subscriptionSignals.length,
      signalsDetected: allSignals.length,
      newRecommendations,
      skippedDuplicates,
      expired,
      durationMs,
      error: error ?? null,
    },
    errorMessage: error,
    rollbackAvailable: false,
  });

  return {
    orgId,
    runId,
    triggeredBy,
    startedAt,
    completedAt,
    durationMs,
    clientsEvaluated: clientSignals.length,
    subscriptionsEvaluated: subscriptionSignals.length,
    signalsDetected: allSignals.length,
    newRecommendations,
    skippedDuplicates,
    expired,
    signals: allSignals,
    error,
  };
}

// ─── Multi-org daily run ───────────────────────────────────────────────────────

export async function runPulseForAllOrgs(
  triggeredBy: "cron" | "manual" | "startup" = "cron"
): Promise<void> {
  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .limit(100)
    .catch(() => []);

  if (orgs.length === 0) {
    console.log("[Pulse] No organizations found — skipping run");
    return;
  }

  console.log(
    `[Pulse] Starting daily run for ${orgs.length} org(s) — triggered by ${triggeredBy}`
  );

  const { acquireJobLock, releaseJobLock } = await import("../services/ceo-heartbeat-service");

  for (const org of orgs) {
    // Per-org lock: prevents duplicate daily runs across instances (autoscale).
    const { acquired, lockKey } = await acquireJobLock(org.id, "pulse_daily_cron", 1440).catch(
      () => ({ acquired: true, lockKey: "" })
    );
    if (!acquired) {
      console.log(`[Pulse][${org.id}] Lock held — skipping duplicate run`);
      continue;
    }
    try {
      const result = await runPulseForOrg(org.id, triggeredBy);
      console.log(
        `[Pulse][${org.id}] Completed in ${result.durationMs}ms — ${result.newRecommendations} new, ${result.skippedDuplicates} deduped, ${result.expired} expired`
      );
    } catch (err) {
      console.error(`[Pulse][${org.id}] Run failed:`, err);
    } finally {
      if (lockKey) await releaseJobLock(lockKey).catch(() => {});
    }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

const DAILY_MS = 24 * 60 * 60 * 1000;

let _pulseTimer: ReturnType<typeof setTimeout> | null = null;

export function startPulseDailyCron(): void {
  if (_pulseTimer) return;

  const tick = async () => {
    await runPulseForAllOrgs("cron").catch((err) =>
      console.error("[Pulse] Cron tick error:", err)
    );
  };

  // Run once 3 minutes after startup (offset from Apex's 2-minute start), then every 24 hours
  setTimeout(tick, 3 * 60 * 1000);
  _pulseTimer = setInterval(tick, DAILY_MS);

  console.log(
    "[Pulse] Daily cron started — first run in 3 minutes, then every 24h"
  );
}
