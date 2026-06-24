/**
 * Apex Agent — Growth & Revenue Agent
 * agentType: "growth_agent" | name: "Apex"
 *
 * Runs daily (or on-demand). For every org:
 *   1. Expires stale pending_review recommendations (> 7 days old)
 *   2. Reads deal pipeline, prospects, and lead intelligence profiles
 *   3. Scores each signal by urgency × estimated value
 *   4. Deduplicates: skips signals that already have a pending_review recommendation
 *   5. Inserts new recommendations into apex_recommendations table
 *   6. Writes run summary to unified_agent_action_log (workforce dashboard counter)
 */

import { db } from "../db";
import { sql, and, eq, lt, ne } from "drizzle-orm";
import {
  teamTrainingDeals,
  teamTrainingProspects,
  leadIntelligenceProfiles,
  organizations,
  apexRecommendations,
} from "@shared/schema";
import { logUnifiedAction } from "../unified-action-logger";
import { storage } from "../storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignalType =
  | "stale_active_deal"
  | "high_value_stale_deal"
  | "abandoned_deal"
  | "overdue_followup"
  | "hot_lead_cooling"
  | "uncontacted_high_value_prospect"
  | "new_lead_no_action";

export type UrgencyLevel = "critical" | "high" | "medium" | "low";

export interface ApexSignal {
  signalType: SignalType;
  urgency: UrgencyLevel;
  entityType: "deal" | "prospect" | "lead";
  entityId: string;
  entityName: string;
  estimatedValueCents: number;
  staleDays: number;
  recommendedAction: string;
  reasonText: string;
  confidenceScore: number;
  sourceUrl: string;
}

export interface ApexRunResult {
  orgId: string;
  runId: string;
  triggeredBy: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  dealsEvaluated: number;
  prospectsEvaluated: number;
  leadsEvaluated: number;
  signalsDetected: number;
  newRecommendations: number;
  skippedDuplicates: number;
  expired: number;
  signals: ApexSignal[];
  error?: string;
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

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

function scoreUrgency(staleDays: number, estimatedValueCents: number): UrgencyLevel {
  const valueScore = estimatedValueCents > 500_000 ? 3 : estimatedValueCents > 100_000 ? 2 : 1;
  const staleScore = staleDays > 21 ? 4 : staleDays > 14 ? 3 : staleDays > 7 ? 2 : 1;
  const combined = valueScore + staleScore;
  if (combined >= 6) return "critical";
  if (combined >= 5) return "high";
  if (combined >= 3) return "medium";
  return "low";
}

function urgencyToRisk(urgency: UrgencyLevel): "low" | "medium" | "high" | "critical" {
  return urgency as "low" | "medium" | "high" | "critical";
}

function sourceUrlFor(entityType: "deal" | "prospect" | "lead"): string {
  if (entityType === "deal") return "/admin/team-training-deals";
  if (entityType === "prospect") return "/admin/team-training-leads";
  return "/admin/lead-pipeline";
}

// ─── Table setup ──────────────────────────────────────────────────────────────

export async function ensureApexRecommendationsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS apex_recommendations (
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
}

// ─── Signal detectors ─────────────────────────────────────────────────────────

async function detectDealSignals(orgId: string): Promise<ApexSignal[]> {
  const signals: ApexSignal[] = [];

  const rawDeals = await storage.getTeamTrainingDeals(orgId).catch(() => []);

  for (const deal of rawDeals) {
    if (deal.status === "won" || deal.status === "lost") continue;

    const prospectName = (deal as any).prospect?.prospectName ?? `Deal ${deal.id.slice(0, 8)}`;
    const estimatedValueCents = Math.round((deal.estimatedValue ?? 0) * 100);
    const staleDays = daysSince(deal.lastActivityAt);
    const overdueDays = daysUntil(deal.nextFollowUpAt);
    const sourceUrl = sourceUrlFor("deal");

    // 1. Overdue follow-up
    if (deal.nextFollowUpAt && overdueDays < 0) {
      const overdue = Math.abs(overdueDays);
      const urgency = scoreUrgency(overdue, estimatedValueCents);
      signals.push({
        signalType: "overdue_followup",
        urgency,
        entityType: "deal",
        entityId: deal.id,
        entityName: prospectName,
        estimatedValueCents,
        staleDays: overdue,
        recommendedAction: `Follow up with ${prospectName} — scheduled follow-up is ${overdue} day${overdue !== 1 ? "s" : ""} overdue`,
        reasonText: `Deal "${prospectName}" had a follow-up scheduled for ${deal.nextFollowUpAt?.toLocaleDateString() ?? "unknown"} that has not been actioned. Current status: ${deal.status}. Estimated value: $${(estimatedValueCents / 100).toLocaleString()}.`,
        confidenceScore: 0.92,
        sourceUrl,
      });
      continue;
    }

    // 2. High-value stale deal (probability > 50%, no activity in 5+ days)
    if (deal.probability > 50 && staleDays >= 5 && estimatedValueCents > 0) {
      const urgency = scoreUrgency(staleDays, estimatedValueCents);
      signals.push({
        signalType: "high_value_stale_deal",
        urgency,
        entityType: "deal",
        entityId: deal.id,
        entityName: prospectName,
        estimatedValueCents,
        staleDays,
        recommendedAction: `Re-engage ${prospectName} — high-probability deal (${deal.probability}%) has stalled for ${staleDays} days`,
        reasonText: `Deal "${prospectName}" is ${deal.probability}% likely to close (est. $${(estimatedValueCents / 100).toLocaleString()}) but has had no activity for ${staleDays} days. Last contact: ${deal.lastContactAt?.toLocaleDateString() ?? "never"}. High-probability stale deals lose momentum fast.`,
        confidenceScore: 0.88,
        sourceUrl,
      });
      continue;
    }

    // 3. Abandoned deal (new/contacted, no activity in 14+ days)
    if ((deal.status === "new" || deal.status === "contacted") && staleDays >= 14) {
      const urgency = scoreUrgency(staleDays, estimatedValueCents);
      signals.push({
        signalType: "abandoned_deal",
        urgency,
        entityType: "deal",
        entityId: deal.id,
        entityName: prospectName,
        estimatedValueCents,
        staleDays,
        recommendedAction: `Rescue ${prospectName} — deal appears abandoned (${staleDays} days without activity)`,
        reasonText: `Deal "${prospectName}" is stuck at "${deal.status}" with no activity for ${staleDays} days. Without re-engagement, this deal is likely lost. Consider a re-engagement outreach or mark as lost to keep the pipeline clean.`,
        confidenceScore: 0.80,
        sourceUrl,
      });
      continue;
    }

    // 4. General stale active deal (7+ days, medium/low value)
    if (staleDays >= 7 && deal.status !== "new") {
      signals.push({
        signalType: "stale_active_deal",
        urgency: "low",
        entityType: "deal",
        entityId: deal.id,
        entityName: prospectName,
        estimatedValueCents,
        staleDays,
        recommendedAction: `Check in on ${prospectName} — no deal activity for ${staleDays} days`,
        reasonText: `Active deal "${prospectName}" (status: ${deal.status}) has had no recorded activity for ${staleDays} days. A quick check-in keeps momentum and signals intent to prospects.`,
        confidenceScore: 0.70,
        sourceUrl,
      });
    }
  }

  return signals;
}

async function detectProspectSignals(orgId: string): Promise<ApexSignal[]> {
  const signals: ApexSignal[] = [];

  const prospects = await storage.getTeamTrainingProspects(orgId).catch(() => []);

  for (const p of prospects) {
    if (p.outreachStatus === "Not Interested" || p.outreachStatus === "Do Not Contact") continue;

    const estimatedValueCents = Math.round((p.estimatedValue ?? 0) * 100);
    const staleDays = daysSince(p.lastContactedAt);
    const hasEmail = !!(p.contactEmail || p.decisionMakerEmail);

    // Uncontacted high-value prospect with a good contact
    if (p.outreachStatus === "New" && estimatedValueCents > 0 && hasEmail) {
      signals.push({
        signalType: "uncontacted_high_value_prospect",
        urgency: estimatedValueCents > 300_000 ? "high" : "medium",
        entityType: "prospect",
        entityId: p.id,
        entityName: p.prospectName,
        estimatedValueCents,
        staleDays,
        recommendedAction: `Initiate outreach to ${p.prospectName} — high-value prospect with verified contact has never been contacted`,
        reasonText: `${p.prospectName} (${p.organizationType ?? "organization"}, ${p.sport ?? "sport unknown"}) is estimated at $${(estimatedValueCents / 100).toLocaleString()} annually. They have a ${p.contactQuality ?? "unknown"} quality contact on file and status is "New" — no outreach has occurred. First-mover advantage is highest now.`,
        confidenceScore: 0.85,
        sourceUrl: sourceUrlFor("prospect"),
      });
    }
  }

  return signals;
}

async function detectLeadSignals(orgId: string): Promise<ApexSignal[]> {
  const signals: ApexSignal[] = [];

  const profiles = await db
    .select()
    .from(leadIntelligenceProfiles)
    .where(
      and(
        eq(leadIntelligenceProfiles.orgId, orgId),
        eq(leadIntelligenceProfiles.suppressed, false),
        eq(leadIntelligenceProfiles.unsubscribed, false),
      )
    )
    .limit(200)
    .catch(() => []);

  for (const profile of profiles) {
    const staleDays = daysSince(profile.lastInteractionAt ?? profile.createdAt);
    const score = profile.leadScore ?? 0;
    const isHot = profile.temperature === "hot";
    const isNew = profile.pipelineStage === "new_lead";
    const displayName = `Lead ${profile.submissionId.slice(0, 8)}`;

    // Hot lead cooling — was hot but hasn't been touched in 3+ days
    if (isHot && staleDays >= 3) {
      signals.push({
        signalType: "hot_lead_cooling",
        urgency: staleDays >= 7 ? "critical" : "high",
        entityType: "lead",
        entityId: profile.submissionId,
        entityName: displayName,
        estimatedValueCents: 0,
        staleDays,
        recommendedAction: `Act on hot lead ${displayName} — marked hot but no activity for ${staleDays} days (cooling window closing)`,
        reasonText: `Lead scored ${score}/100 with temperature "hot" but has had no interaction for ${staleDays} days. Hot leads go cold in 7–14 days without contact. Suggested action: ${profile.suggestedNextAction ?? "follow up immediately"}.`,
        confidenceScore: 0.90,
        sourceUrl: sourceUrlFor("lead"),
      });
      continue;
    }

    // High-score new lead with no action taken after 48 hours
    if (isNew && score >= 70 && staleDays >= 2) {
      signals.push({
        signalType: "new_lead_no_action",
        urgency: "high",
        entityType: "lead",
        entityId: profile.submissionId,
        entityName: displayName,
        estimatedValueCents: 0,
        staleDays,
        recommendedAction: `Action required on high-score lead ${displayName} — scored ${score}/100 but sitting unworked for ${staleDays} days`,
        reasonText: `New lead (score: ${score}/100) submitted ${staleDays} days ago. Stage is still "new_lead" — no follow-up action has been taken. High-score leads contacted within 5 minutes convert at 8× the rate of those contacted after 30 minutes.`,
        confidenceScore: 0.83,
        sourceUrl: sourceUrlFor("lead"),
      });
    }
  }

  return signals;
}

// ─── Rank signals ─────────────────────────────────────────────────────────────

function rankSignals(signals: ApexSignal[]): ApexSignal[] {
  const urgencyWeight: Record<UrgencyLevel, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return [...signals].sort((a, b) => {
    const uDiff = urgencyWeight[b.urgency] - urgencyWeight[a.urgency];
    if (uDiff !== 0) return uDiff;
    return b.estimatedValueCents - a.estimatedValueCents;
  });
}

// ─── Dedup check ─────────────────────────────────────────────────────────────

async function hasPendingRecommendation(orgId: string, signalType: string, entityId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT id FROM apex_recommendations
    WHERE org_id = ${orgId}
      AND signal_type = ${signalType}
      AND entity_id = ${entityId}
      AND status = 'pending_review'
    LIMIT 1
  `).catch(() => ({ rows: [] }));
  const r = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  return r.length > 0;
}

// ─── Auto-expire stale pending recommendations ────────────────────────────────

async function expireStalePendingRecs(orgId: string): Promise<number> {
  const now = new Date();
  const result = await db.execute(sql`
    UPDATE apex_recommendations
    SET status = 'expired', status_updated_at = ${now}, status_updated_by = 'system'
    WHERE org_id = ${orgId}
      AND status = 'pending_review'
      AND expires_at IS NOT NULL
      AND expires_at < ${now}
  `).catch(() => ({ rowCount: 0 }));
  return (result as any).rowCount ?? 0;
}

// ─── Core run function ────────────────────────────────────────────────────────

export async function runApexForOrg(
  orgId: string,
  triggeredBy: "cron" | "manual" | "startup" = "cron"
): Promise<ApexRunResult> {
  const runId = crypto.randomUUID();
  const startedAt = new Date();

  // Ensure table exists
  await ensureApexRecommendationsTable();

  let dealSignals: ApexSignal[] = [];
  let prospectSignals: ApexSignal[] = [];
  let leadSignals: ApexSignal[] = [];
  let error: string | undefined;

  // Step 1: Auto-expire stale pending recommendations
  const expired = await expireStalePendingRecs(orgId);

  // Step 2: Detect signals
  try {
    [dealSignals, prospectSignals, leadSignals] = await Promise.all([
      detectDealSignals(orgId),
      detectProspectSignals(orgId),
      detectLeadSignals(orgId),
    ]);
  } catch (err: any) {
    error = err.message ?? "Unknown error during signal detection";
    console.error(`[Apex][${orgId}] Signal detection error:`, err);
  }

  const allSignals = rankSignals([...dealSignals, ...prospectSignals, ...leadSignals]);
  const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Step 3: Write to apex_recommendations (with dedup)
  let newRecommendations = 0;
  let skippedDuplicates = 0;

  for (const signal of allSignals) {
    const alreadyPending = await hasPendingRecommendation(orgId, signal.signalType, signal.entityId);
    if (alreadyPending) {
      skippedDuplicates++;
      continue;
    }

    await db.insert(apexRecommendations).values({
      orgId,
      signalType: signal.signalType,
      entityType: signal.entityType,
      entityId: signal.entityId,
      entityName: signal.entityName,
      urgency: signal.urgency,
      estimatedValueCents: signal.estimatedValueCents,
      reasonText: signal.reasonText,
      recommendedAction: signal.recommendedAction,
      confidenceScore: signal.confidenceScore,
      staleDays: signal.staleDays,
      sourceUrl: signal.sourceUrl,
      status: "pending_review",
      runId,
      expiresAt: sevenDaysOut,
    }).catch((err) => {
      console.error(`[Apex][${orgId}] Failed to insert recommendation for ${signal.signalType}/${signal.entityId}:`, err);
    });

    newRecommendations++;
  }

  // Step 4: Write run summary to unified_agent_action_log (workforce dashboard counter)
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  await logUnifiedAction({
    orgId,
    actorType: "growth_agent",
    actorName: "Apex",
    actionType: "apex:run_complete",
    workflowRunId: runId,
    status: error ? "failed" : "completed",
    riskLevel: "low",
    reasoningSummary: error
      ? `Apex run failed: ${error}`
      : `Apex scanned pipeline — ${newRecommendations} new recommendation${newRecommendations !== 1 ? "s" : ""}, ${skippedDuplicates} deduplicated, ${expired} expired`,
    inputSnapshot: { triggeredBy, orgId },
    outputSnapshot: {
      dealsEvaluated: dealSignals.length,
      prospectsEvaluated: prospectSignals.length,
      leadsEvaluated: leadSignals.length,
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
    dealsEvaluated: dealSignals.length,
    prospectsEvaluated: prospectSignals.length,
    leadsEvaluated: leadSignals.length,
    signalsDetected: allSignals.length,
    newRecommendations,
    skippedDuplicates,
    expired,
    signals: allSignals,
    error,
  };
}

// ─── Multi-org daily run ──────────────────────────────────────────────────────

export async function runApexForAllOrgs(triggeredBy: "cron" | "manual" | "startup" = "cron"): Promise<void> {
  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .limit(100)
    .catch(() => []);

  if (orgs.length === 0) {
    console.log("[Apex] No organizations found — skipping run");
    return;
  }

  console.log(`[Apex] Starting daily run for ${orgs.length} org(s) — triggered by ${triggeredBy}`);

  for (const org of orgs) {
    try {
      const result = await runApexForOrg(org.id, triggeredBy);
      console.log(
        `[Apex][${org.id}] Completed in ${result.durationMs}ms — ${result.newRecommendations} new, ${result.skippedDuplicates} deduped, ${result.expired} expired`
      );
    } catch (err) {
      console.error(`[Apex][${org.id}] Run failed:`, err);
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

const DAILY_MS = 24 * 60 * 60 * 1000;

let _apexTimer: ReturnType<typeof setTimeout> | null = null;

export function startApexDailyCron(): void {
  if (_apexTimer) return;

  const tick = async () => {
    await runApexForAllOrgs("cron").catch((err) =>
      console.error("[Apex] Cron tick error:", err)
    );
  };

  // Run once 2 minutes after startup, then every 24 hours
  setTimeout(tick, 2 * 60 * 1000);
  _apexTimer = setInterval(tick, DAILY_MS);

  console.log("[Apex] Daily cron started — first run in 2 minutes, then every 24h");
}
