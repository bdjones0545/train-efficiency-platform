/**
 * Apex Agent — Growth & Revenue Agent
 * agentType: "growth_agent" | name: "Apex"
 *
 * Runs daily (or on-demand). For every org:
 *   1. Reads deal pipeline, prospects, and lead intelligence profiles
 *   2. Scores each signal by urgency × estimated value
 *   3. Detects abandoned applications, stale high-intent leads, overdue follow-ups
 *   4. Produces ranked recommendations (NO auto-send — suggestions only)
 *   5. Writes every evaluated signal + run summary to unified_agent_action_log
 *      with actorType = "growth_agent" so the workforce dashboard shows live counts
 */

import { db } from "../db";
import { sql, and, eq, lt, lte, isNotNull, or, not, inArray } from "drizzle-orm";
import {
  teamTrainingDeals,
  teamTrainingProspects,
  leadIntelligenceProfiles,
  organizations,
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
  estimatedValue: number;
  staleDays: number;
  recommendedAction: string;
  reasoningSummary: string;
  confidenceScore: number;
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
  recommendationsGenerated: number;
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

function scoreUrgency(staleDays: number, estimatedValue: number): UrgencyLevel {
  const valueScore = estimatedValue > 5000 ? 3 : estimatedValue > 1000 ? 2 : 1;
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

// ─── Signal detectors ─────────────────────────────────────────────────────────

async function detectDealSignals(orgId: string): Promise<ApexSignal[]> {
  const signals: ApexSignal[] = [];
  const now = new Date();

  const rawDeals = await storage.getTeamTrainingDeals(orgId);

  for (const deal of rawDeals) {
    if (deal.status === "won" || deal.status === "lost") continue;

    const prospectName = (deal as any).prospect?.prospectName ?? `Deal ${deal.id.slice(0, 8)}`;
    const estimatedValue = deal.estimatedValue ?? 0;
    const staleDays = daysSince(deal.lastActivityAt);
    const overdueDays = daysUntil(deal.nextFollowUpAt);

    // 1. Overdue follow-up
    if (deal.nextFollowUpAt && overdueDays < 0) {
      const overdue = Math.abs(overdueDays);
      const urgency = scoreUrgency(overdue, estimatedValue);
      signals.push({
        signalType: "overdue_followup",
        urgency,
        entityType: "deal",
        entityId: deal.id,
        entityName: prospectName,
        estimatedValue,
        staleDays: overdue,
        recommendedAction: `Follow up with ${prospectName} — scheduled follow-up is ${overdue} day${overdue !== 1 ? "s" : ""} overdue`,
        reasoningSummary: `Deal "${prospectName}" had a follow-up scheduled for ${deal.nextFollowUpAt?.toLocaleDateString() ?? "unknown"} that has not been actioned. Current status: ${deal.status}.`,
        confidenceScore: 0.92,
      });
      continue;
    }

    // 2. High-value stale deal (probability > 50%, no activity in 5+ days)
    if (deal.probability > 50 && staleDays >= 5 && estimatedValue > 0) {
      const urgency = scoreUrgency(staleDays, estimatedValue);
      signals.push({
        signalType: "high_value_stale_deal",
        urgency,
        entityType: "deal",
        entityId: deal.id,
        entityName: prospectName,
        estimatedValue,
        staleDays,
        recommendedAction: `Re-engage ${prospectName} — high-probability deal (${deal.probability}%) has stalled for ${staleDays} days`,
        reasoningSummary: `Deal "${prospectName}" is ${deal.probability}% likely to close (est. $${estimatedValue.toLocaleString()}) but has had no activity for ${staleDays} days. Last contact: ${deal.lastContactAt?.toLocaleDateString() ?? "never"}.`,
        confidenceScore: 0.88,
      });
      continue;
    }

    // 3. Abandoned deal (new/contacted, no activity in 14+ days)
    if ((deal.status === "new" || deal.status === "contacted") && staleDays >= 14) {
      const urgency = scoreUrgency(staleDays, estimatedValue);
      signals.push({
        signalType: "abandoned_deal",
        urgency,
        entityType: "deal",
        entityId: deal.id,
        entityName: prospectName,
        estimatedValue,
        staleDays,
        recommendedAction: `Rescue ${prospectName} — deal appears abandoned (${staleDays} days without activity)`,
        reasoningSummary: `Deal "${prospectName}" is stuck at "${deal.status}" with no activity for ${staleDays} days. Consider a re-engagement outreach or mark as lost to keep the pipeline clean.`,
        confidenceScore: 0.80,
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
        estimatedValue,
        staleDays,
        recommendedAction: `Check in on ${prospectName} — no deal activity for ${staleDays} days`,
        reasoningSummary: `Active deal "${prospectName}" (status: ${deal.status}) has had no recorded activity for ${staleDays} days.`,
        confidenceScore: 0.70,
      });
    }
  }

  return signals;
}

async function detectProspectSignals(orgId: string): Promise<ApexSignal[]> {
  const signals: ApexSignal[] = [];

  const prospects = await storage.getTeamTrainingProspects(orgId);

  for (const p of prospects) {
    if (p.outreachStatus === "Not Interested" || p.outreachStatus === "Do Not Contact") continue;

    const estimatedValue = p.estimatedValue ?? 0;
    const staleDays = daysSince(p.lastContactedAt);
    const hasEmail = !!(p.contactEmail || p.decisionMakerEmail);

    // Uncontacted high-value prospect with a good contact
    if (p.outreachStatus === "New" && estimatedValue > 0 && hasEmail) {
      signals.push({
        signalType: "uncontacted_high_value_prospect",
        urgency: estimatedValue > 3000 ? "high" : "medium",
        entityType: "prospect",
        entityId: p.id,
        entityName: p.prospectName,
        estimatedValue,
        staleDays,
        recommendedAction: `Initiate outreach to ${p.prospectName} — high-value prospect with verified contact has never been contacted`,
        reasoningSummary: `${p.prospectName} (${p.organizationType}, ${p.sport}) is estimated at $${estimatedValue.toLocaleString()} and has a ${p.contactQuality ?? "unknown"} quality contact. Status: "New" — no outreach has occurred.`,
        confidenceScore: 0.85,
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

    // Hot lead cooling — was hot but hasn't been touched in 3+ days
    if (isHot && staleDays >= 3) {
      signals.push({
        signalType: "hot_lead_cooling",
        urgency: staleDays >= 7 ? "critical" : "high",
        entityType: "lead",
        entityId: profile.submissionId,
        entityName: `Lead ${profile.submissionId.slice(0, 8)}`,
        estimatedValue: 0,
        staleDays,
        recommendedAction: `Act on hot lead ${profile.submissionId.slice(0, 8)} — marked hot but no activity for ${staleDays} days (cooling window closing)`,
        reasoningSummary: `Lead scored ${score}/100 with temperature "hot" but has had no interaction for ${staleDays} days. Suggested action: ${profile.suggestedNextAction ?? "follow up immediately"}.`,
        confidenceScore: 0.90,
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
        entityName: `Lead ${profile.submissionId.slice(0, 8)}`,
        estimatedValue: 0,
        staleDays,
        recommendedAction: `Action required on high-score lead ${profile.submissionId.slice(0, 8)} — scored ${score}/100 but sitting unworked for ${staleDays} days`,
        reasoningSummary: `New lead (score: ${score}/100) submitted ${staleDays} days ago. Stage is still "new_lead" — no follow-up action has been taken. Pipeline stage: ${profile.pipelineStage}.`,
        confidenceScore: 0.83,
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
    return b.estimatedValue - a.estimatedValue;
  });
}

// ─── Core run function ────────────────────────────────────────────────────────

export async function runApexForOrg(
  orgId: string,
  triggeredBy: "cron" | "manual" | "startup" = "cron"
): Promise<ApexRunResult> {
  const runId = crypto.randomUUID();
  const startedAt = new Date();

  let dealSignals: ApexSignal[] = [];
  let prospectSignals: ApexSignal[] = [];
  let leadSignals: ApexSignal[] = [];
  let error: string | undefined;

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
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  // Write one unified_agent_action_log entry per signal (these drive the action count)
  for (const signal of allSignals) {
    await logUnifiedAction({
      orgId,
      actorType: "growth_agent",
      actorName: "Apex",
      actionType: `apex:${signal.signalType}`,
      entityType: signal.entityType,
      entityId: signal.entityId,
      workflowRunId: runId,
      status: "requires_approval",
      confidenceScore: signal.confidenceScore,
      riskLevel: urgencyToRisk(signal.urgency),
      reasoningSummary: signal.reasoningSummary,
      inputSnapshot: {
        entityName: signal.entityName,
        estimatedValue: signal.estimatedValue,
        staleDays: signal.staleDays,
        urgency: signal.urgency,
        triggeredBy,
      },
      outputSnapshot: {
        recommendedAction: signal.recommendedAction,
        signalType: signal.signalType,
        rank: allSignals.indexOf(signal) + 1,
      },
      rollbackAvailable: false,
    });
  }

  // Write one run summary entry
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
      : `Apex scanned ${dealSignals.length + prospectSignals.length + leadSignals.length > 0 ? "pipeline" : "empty pipeline"} — detected ${allSignals.length} signal${allSignals.length !== 1 ? "s" : ""} across deals, prospects, and leads`,
    inputSnapshot: { triggeredBy, orgId },
    outputSnapshot: {
      dealsEvaluated: dealSignals.length,
      prospectsEvaluated: prospectSignals.length,
      leadsEvaluated: leadSignals.length,
      signalsDetected: allSignals.length,
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
    recommendationsGenerated: allSignals.length,
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
        `[Apex][${org.id}] Completed in ${result.durationMs}ms — ${result.signalsDetected} signals detected`
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
