/**
 * Daily Operations Engine — Phase 4
 *
 * Every morning, generates a proactive operations brief for the org:
 *   - Critical athlete list (red + escalating yellow)
 *   - Unresolved intervention queue (drafted but not approved)
 *   - Predicted churn risks (compliance + engagement signals)
 *   - Coach action priorities (ordered list)
 *   - Recommended org actions
 *   - Recovery bottlenecks
 *   - Staffing / workload concerns
 *
 * Pushes the brief into:
 *   - Organization Intelligence State (DB)
 *   - Command Center (via org intelligence state query)
 *   - Coach briefing enrichment (event bus event)
 */

import { db } from "../db";
import {
  organizationIntelligenceState,
  athleteContextObjects,
  programAdaptationDrafts,
  workoutReadinessCheckins,
  workoutCompletionLogs,
  orgUsers,
  organizationEventLog,
} from "@shared/schema";
import { eq, and, desc, gte, sql, lt } from "drizzle-orm";
import { publishEvent } from "../events/event-bus";
import { refreshOrgIntelligenceState } from "../orchestration/organization-intelligence-orchestrator";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CriticalAthlete {
  athleteUserId: string;
  athleteName: string;
  riskLevel: "red" | "yellow";
  priorityScore: number;
  activeSignals: string[];
  unresolvedInterventions: number;
  daysSinceLastAction: number;
}

export interface ChurnRiskAthlete {
  athleteUserId: string;
  athleteName: string;
  churnProbability: "high" | "medium";
  complianceRate: number;
  lastEngagement?: string;
  signals: string[];
}

export interface CoachActionPriority {
  rank: number;
  athleteUserId: string;
  athleteName: string;
  actionType: string;
  rationale: string;
  urgency: "critical" | "high" | "medium" | "low";
  estimatedTimeMin: number;
}

export interface OrgRecommendedAction {
  category: "staffing" | "revenue" | "retention" | "programming" | "engagement";
  action: string;
  rationale: string;
  urgency: "critical" | "high" | "medium";
  affectedCount?: number;
}

export interface DailyOperationsBrief {
  orgId: string;
  generatedAt: string;
  criticalAthletes: CriticalAthlete[];
  unresolvedInterventions: Array<{
    draftId: string;
    athleteUserId: string;
    athleteName: string;
    interventionType: string;
    daysWaiting: number;
    priorityScore?: number;
  }>;
  predictedChurnRisks: ChurnRiskAthlete[];
  coachActionPriorities: CoachActionPriority[];
  recommendedOrgActions: OrgRecommendedAction[];
  recoveryBottlenecks: Array<{ athleteUserId: string; athleteName: string; bottleneck: string }>;
  staffingConcerns: string[];
  summary: {
    criticalCount: number;
    churnsAtRisk: number;
    unresolvedCount: number;
    topPriority: string;
    overallOrgStatus: "healthy" | "caution" | "critical";
  };
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export async function generateDailyOperationsBrief(orgId: string): Promise<DailyOperationsBrief> {
  const generatedAt = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  // ── Fetch athlete contexts ──────────────────────────────────────────────────
  const contexts = await db.select()
    .from(athleteContextObjects)
    .where(eq(athleteContextObjects.orgId, orgId));

  // ── Fetch pending intervention drafts ──────────────────────────────────────
  const pendingDrafts = await db.select()
    .from(programAdaptationDrafts)
    .where(and(
      eq(programAdaptationDrafts.orgId, orgId),
      eq(programAdaptationDrafts.status, "pending")
    ))
    .orderBy(desc(programAdaptationDrafts.createdAt));

  // Build lookup: athleteUserId → draft count
  const draftCountByAthlete = new Map<string, number>();
  const draftsByAthlete = new Map<string, typeof pendingDrafts[0]>();
  for (const draft of pendingDrafts) {
    const count = draftCountByAthlete.get(draft.athleteUserId) ?? 0;
    draftCountByAthlete.set(draft.athleteUserId, count + 1);
    if (!draftsByAthlete.has(draft.athleteUserId)) {
      draftsByAthlete.set(draft.athleteUserId, draft);
    }
  }

  // ── Build critical athletes list ────────────────────────────────────────────
  const criticalAthletes: CriticalAthlete[] = [];
  const churnRisks: ChurnRiskAthlete[] = [];
  const recoveryBottlenecks: Array<{ athleteUserId: string; athleteName: string; bottleneck: string }> = [];

  for (const ctx of contexts) {
    const data = ctx.contextData as any;
    const riskLevel = data?.riskLevel ?? "green";
    const signals: string[] = [];
    let priorityScore = 0;

    // Signal detection
    if (data?.readinessTrend?.avg7d != null && data.readinessTrend.avg7d < 5) {
      signals.push("low_readiness");
      priorityScore += 20;
    }
    if (data?.complianceRate != null && data.complianceRate < 50) {
      signals.push("critical_compliance");
      priorityScore += 25;
    } else if (data?.complianceRate != null && data.complianceRate < 70) {
      signals.push("declining_compliance");
      priorityScore += 12;
    }
    if (data?.recentPainAreas?.length > 0) {
      signals.push("pain_reported");
      priorityScore += 22;
    }
    if (data?.rpeTrend === "high") {
      signals.push("high_rpe");
      priorityScore += 18;
    }
    if (data?.missedSessions != null && data.missedSessions > 2) {
      signals.push("missed_sessions");
      priorityScore += 15;
    }

    const unresolvedCount = draftCountByAthlete.get(ctx.athleteUserId) ?? 0;
    const lastDraft = draftsByAthlete.get(ctx.athleteUserId);
    const daysWaiting = lastDraft?.createdAt
      ? Math.floor((Date.now() - new Date(lastDraft.createdAt).getTime()) / 86400000)
      : 0;

    if (riskLevel === "red" || (riskLevel === "yellow" && priorityScore >= 30)) {
      criticalAthletes.push({
        athleteUserId: ctx.athleteUserId,
        athleteName: (data?.athleteName ?? ctx.athleteUserId) as string,
        riskLevel: riskLevel as "red" | "yellow",
        priorityScore,
        activeSignals: signals,
        unresolvedInterventions: unresolvedCount,
        daysSinceLastAction: daysWaiting,
      });
    }

    // Churn risk detection
    const isChurnRisk = (data?.complianceRate ?? 100) < 60 ||
      (data?.missedSessions ?? 0) >= 3 ||
      signals.includes("declining_compliance");

    if (isChurnRisk) {
      churnRisks.push({
        athleteUserId: ctx.athleteUserId,
        athleteName: (data?.athleteName ?? ctx.athleteUserId) as string,
        churnProbability: (data?.complianceRate ?? 100) < 40 ? "high" : "medium",
        complianceRate: data?.complianceRate ?? 100,
        signals,
      });
    }

    // Recovery bottlenecks
    if (signals.includes("low_readiness") && signals.includes("high_rpe")) {
      recoveryBottlenecks.push({
        athleteUserId: ctx.athleteUserId,
        athleteName: (data?.athleteName ?? ctx.athleteUserId) as string,
        bottleneck: "Low readiness + high RPE — likely under-recovered. Deload or rest day recommended.",
      });
    }
  }

  // Sort critical by priority score desc
  criticalAthletes.sort((a, b) => b.priorityScore - a.priorityScore);
  churnRisks.sort((a, b) => a.complianceRate - b.complianceRate);

  // ── Unresolved interventions ────────────────────────────────────────────────
  const unresolvedInterventions = pendingDrafts.slice(0, 20).map(draft => {
    const daysWaiting = draft.createdAt
      ? Math.floor((Date.now() - new Date(draft.createdAt).getTime()) / 86400000)
      : 0;
    const signals = (draft.triggerSignals as any[] | null) ?? [];
    const priorityScore = signals.length * 10;
    return {
      draftId: draft.id,
      athleteUserId: draft.athleteUserId,
      athleteName: String(draft.notes ?? draft.athleteUserId),
      interventionType: String(draft.adaptationType ?? "program_adjustment"),
      daysWaiting,
      priorityScore,
    };
  });

  // ── Coach action priorities ─────────────────────────────────────────────────
  const coachActionPriorities: CoachActionPriority[] = [];
  let rank = 1;

  // Critical athletes first
  for (const athlete of criticalAthletes.slice(0, 3)) {
    coachActionPriorities.push({
      rank: rank++,
      athleteUserId: athlete.athleteUserId,
      athleteName: athlete.athleteName,
      actionType: athlete.unresolvedInterventions > 0 ? "approve_intervention" : "review_athlete",
      rationale: `${athlete.activeSignals.map(s => s.replace(/_/g, " ")).join(", ")} — score ${athlete.priorityScore}`,
      urgency: athlete.riskLevel === "red" ? "critical" : "high",
      estimatedTimeMin: athlete.unresolvedInterventions > 0 ? 10 : 5,
    });
  }

  // Stale pending drafts (> 3 days)
  const staleDrafts = unresolvedInterventions.filter(d => d.daysWaiting >= 3);
  for (const draft of staleDrafts.slice(0, 2)) {
    if (coachActionPriorities.length >= 5) break;
    coachActionPriorities.push({
      rank: rank++,
      athleteUserId: draft.athleteUserId,
      athleteName: draft.athleteName,
      actionType: "approve_or_dismiss_draft",
      rationale: `Adaptation draft has been waiting ${draft.daysWaiting} days — needs a decision`,
      urgency: draft.daysWaiting >= 7 ? "high" : "medium",
      estimatedTimeMin: 5,
    });
  }

  // Churn risks
  for (const churn of churnRisks.slice(0, 2)) {
    if (coachActionPriorities.length >= 7) break;
    coachActionPriorities.push({
      rank: rank++,
      athleteUserId: churn.athleteUserId,
      athleteName: churn.athleteName,
      actionType: "re_engagement_outreach",
      rationale: `${Math.round(churn.complianceRate)}% compliance — churn risk ${churn.churnProbability}`,
      urgency: churn.churnProbability === "high" ? "high" : "medium",
      estimatedTimeMin: 3,
    });
  }

  // ── Recommended org actions ─────────────────────────────────────────────────
  const recommendedOrgActions: OrgRecommendedAction[] = [];

  if (criticalAthletes.length >= 3) {
    recommendedOrgActions.push({
      category: "programming",
      action: `Review program intensity for ${criticalAthletes.length} athletes showing fatigue signals`,
      rationale: "Multiple concurrent high-readiness alerts suggest systemic overload",
      urgency: "high",
      affectedCount: criticalAthletes.length,
    });
  }

  if (churnRisks.filter(c => c.churnProbability === "high").length >= 2) {
    recommendedOrgActions.push({
      category: "retention",
      action: "Launch re-engagement campaign for low-compliance athletes",
      rationale: `${churnRisks.filter(c => c.churnProbability === "high").length} athletes at high churn risk`,
      urgency: "high",
      affectedCount: churnRisks.length,
    });
  }

  if (staleDrafts.length >= 5) {
    recommendedOrgActions.push({
      category: "programming",
      action: `Clear ${staleDrafts.length} stale intervention drafts — approve, modify, or dismiss`,
      rationale: "Old unapproved drafts reduce coach trust in the system",
      urgency: "medium",
      affectedCount: staleDrafts.length,
    });
  }

  if (recoveryBottlenecks.length >= 2) {
    recommendedOrgActions.push({
      category: "programming",
      action: "Consider an org-wide deload week for athletes showing recovery deficits",
      rationale: `${recoveryBottlenecks.length} athletes showing combined low readiness + high RPE pattern`,
      urgency: "medium",
      affectedCount: recoveryBottlenecks.length,
    });
  }

  // ── Staffing concerns ───────────────────────────────────────────────────────
  const staffingConcerns: string[] = [];
  const pendingPerCoach = pendingDrafts.length;
  if (pendingPerCoach >= 10) {
    staffingConcerns.push(`${pendingPerCoach} pending intervention drafts — coach may be overloaded; consider distributing review workload`);
  }
  if (criticalAthletes.length >= 5) {
    staffingConcerns.push(`${criticalAthletes.length} critical athletes require attention simultaneously — additional coach support may be needed`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const overallStatus =
    criticalAthletes.filter(a => a.riskLevel === "red").length >= 3
      ? "critical"
      : criticalAthletes.length >= 2 || churnRisks.filter(c => c.churnProbability === "high").length >= 2
      ? "caution"
      : "healthy";

  const topPriority = coachActionPriorities[0]
    ? `${coachActionPriorities[0].actionType.replace(/_/g, " ")} for ${coachActionPriorities[0].athleteName}`
    : "No critical actions — org is healthy";

  const brief: DailyOperationsBrief = {
    orgId,
    generatedAt,
    criticalAthletes,
    unresolvedInterventions,
    predictedChurnRisks: churnRisks,
    coachActionPriorities,
    recommendedOrgActions,
    recoveryBottlenecks,
    staffingConcerns,
    summary: {
      criticalCount: criticalAthletes.length,
      churnsAtRisk: churnRisks.length,
      unresolvedCount: unresolvedInterventions.length,
      topPriority,
      overallOrgStatus: overallStatus,
    },
  };

  // ── Persist to org intelligence state ──────────────────────────────────────
  try {
    await db.update(organizationIntelligenceState)
      .set({
        predictedChurnRisks: churnRisks.length,
        lastDailyOpsAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizationIntelligenceState.orgId, orgId));
  } catch {}

  // ── Emit event ─────────────────────────────────────────────────────────────
  publishEvent("ops.daily.briefing.generated", {
    orgId,
    criticalAthleteCount: criticalAthletes.length,
    unresolvedInterventions: unresolvedInterventions.length,
    predictedChurnRisks: churnRisks.length,
    recommendedActionsCount: recommendedOrgActions.length,
    generatedAt,
  }, {
    orgId,
    sourceSystem: "daily-operations-engine",
    idempotencyKey: `daily-ops:${orgId}:${new Date().toISOString().slice(0, 10)}`,
  });

  // Refresh org state
  setImmediate(() => refreshOrgIntelligenceState(orgId).catch(() => {}));

  return brief;
}

// ─── Cron Entry Point ─────────────────────────────────────────────────────────

export async function runDailyOperationsCron(): Promise<{ orgs: number; errors: number }> {
  let orgsProcessed = 0, errors = 0;
  try {
    const { orgMemberships } = await import("@shared/schema");
    const orgs = await db.selectDistinct({ orgId: orgMemberships.orgId })
      .from(orgMemberships)
      .limit(100)
      .catch(() => []);

    for (const { orgId } of orgs) {
      try {
        await generateDailyOperationsBrief(orgId);
        orgsProcessed++;
      } catch (err: any) {
        console.error(`[DailyOps] Error for org ${orgId}:`, err?.message);
        errors++;
      }
    }
  } catch (err: any) {
    console.error("[DailyOps] Cron error:", err?.message);
  }
  return { orgs: orgsProcessed, errors };
}
