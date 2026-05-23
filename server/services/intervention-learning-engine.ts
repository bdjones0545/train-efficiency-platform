/**
 * Intervention Learning Engine
 *
 * Analyzes intervention outcomes to surface which intervention types,
 * timing patterns, and athlete profiles produce the best results.
 * All reasoning is explainable — no black-box models.
 */

import { db } from "../db";
import {
  interventionOutcomes,
  programAdaptationDrafts,
  athleteContextObjects,
  orgUsers,
  type InterventionOutcome,
} from "@shared/schema";
import { eq, and, isNotNull, desc, gte, sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type InterventionEffectivenessStats = {
  interventionType: string;
  label: string;
  totalOutcomes: number;
  improvedCount: number;
  noChangeCount: number;
  worsenedCount: number;
  inconclusiveCount: number;
  effectivenessRate: number;
  avgReadinessDelta: number | null;
  avgComplianceDelta: number | null;
  avgRpeDelta: number | null;
  avgDaysToEvaluation: number | null;
  confidence: "high" | "medium" | "low";
  insight: string;
};

export type OrgLearningInsights = {
  topEffectiveType: string | null;
  leastEffectiveType: string | null;
  avgResolutionDays: number | null;
  totalOutcomesTracked: number;
  byType: InterventionEffectivenessStats[];
  recentTrend: string;
  keyInsight: string;
};

export type AthleteResponseProfile = {
  athleteUserId: string;
  totalInterventions: number;
  improvedCount: number;
  responseRate: number;
  bestRespondingType: string | null;
  insight: string;
};

// ─── Labels ───────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  deload: "Deload Week",
  injury_modification: "Injury Modification",
  recovery_emphasis: "Recovery Emphasis",
  program_simplification: "Program Simplification",
  comprehensive_review: "Comprehensive Review",
  load_reduction: "Load Reduction",
  coach_conversation: "Coach Conversation",
  education_hydration: "Hydration Education",
  education_sleep: "Sleep Education",
  reduced_frequency: "Reduced Frequency",
  movement_modification: "Movement Modification",
  recovery_session: "Recovery Session",
  motivational_outreach: "Motivational Outreach",
  schedule_adjustment: "Schedule Adjustment",
};

// ─── Confidence tier based on sample size ────────────────────────────────────

function confidenceTier(n: number): "high" | "medium" | "low" {
  if (n >= 20) return "high";
  if (n >= 7) return "medium";
  return "low";
}

// ─── Generate a human-readable insight for an intervention type ───────────────

function generateTypeInsight(stats: Omit<InterventionEffectivenessStats, "insight">): string {
  const label = TYPE_LABELS[stats.interventionType] ?? stats.interventionType;
  if (stats.totalOutcomes === 0) return `No outcome data yet for ${label}.`;

  const rate = stats.effectivenessRate;
  const sampleNote = stats.confidence === "low" ? " (limited sample)" : "";

  if (rate >= 75) {
    return `${label} is highly effective — improved outcomes in ${rate}% of cases${sampleNote}.`;
  }
  if (rate >= 55) {
    return `${label} shows moderate effectiveness (${rate}% improvement rate${sampleNote}).`;
  }
  if (rate >= 30) {
    return `${label} has mixed results — improvement in ${rate}% of cases. Consider pairing with other interventions.`;
  }
  return `${label} shows low effectiveness in tracked outcomes (${rate}%)${sampleNote}. Consider alternative approaches.`;
}

// ─── Core: compute effectiveness stats by type ────────────────────────────────

async function computeEffectivenessStats(orgId: string): Promise<InterventionEffectivenessStats[]> {
  const outcomes = await db.select()
    .from(interventionOutcomes)
    .where(and(
      eq(interventionOutcomes.orgId, orgId),
      isNotNull(interventionOutcomes.evaluatedAt),
    ))
    .orderBy(desc(interventionOutcomes.createdAt))
    .limit(500);

  // Group by intervention type
  const byType = new Map<string, InterventionOutcome[]>();
  for (const o of outcomes) {
    const key = o.interventionType;
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(o);
  }

  const result: InterventionEffectivenessStats[] = [];

  for (const [type, records] of byType.entries()) {
    const improved = records.filter((r) => r.outcomeStatus === "improved").length;
    const noChange = records.filter((r) => r.outcomeStatus === "no_change").length;
    const worsened = records.filter((r) => r.outcomeStatus === "worsened").length;
    const inconclusive = records.filter((r) => r.outcomeStatus === "inconclusive").length;
    const evaluated = improved + noChange + worsened;
    const effectivenessRate = evaluated > 0 ? Math.round((improved / evaluated) * 100) : 0;

    const readinessDeltas = records.map((r) => r.readinessDelta).filter((v): v is number => v !== null);
    const complianceDeltas = records.map((r) => r.complianceDelta).filter((v): v is number => v !== null);
    const rpeDeltas = records.map((r) => r.rpeDelta).filter((v): v is number => v !== null);

    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

    // Average days from creation to evaluation
    const durations = records
      .filter((r) => r.evaluatedAt && r.createdAt)
      .map((r) => (r.evaluatedAt!.getTime() - r.createdAt!.getTime()) / (1000 * 60 * 60 * 24));
    const avgDays = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

    const partialStats = {
      interventionType: type,
      label: TYPE_LABELS[type] ?? type,
      totalOutcomes: records.length,
      improvedCount: improved,
      noChangeCount: noChange,
      worsenedCount: worsened,
      inconclusiveCount: inconclusive,
      effectivenessRate,
      avgReadinessDelta: avg(readinessDeltas),
      avgComplianceDelta: avg(complianceDeltas),
      avgRpeDelta: avg(rpeDeltas),
      avgDaysToEvaluation: avgDays,
      confidence: confidenceTier(evaluated),
    };

    result.push({
      ...partialStats,
      insight: generateTypeInsight(partialStats),
    });
  }

  return result.sort((a, b) => b.effectivenessRate - a.effectivenessRate);
}

// ─── Recent trend ─────────────────────────────────────────────────────────────

async function computeRecentTrend(orgId: string): Promise<string> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentOutcomes = await db.select()
    .from(interventionOutcomes)
    .where(and(
      eq(interventionOutcomes.orgId, orgId),
      isNotNull(interventionOutcomes.evaluatedAt),
      gte(interventionOutcomes.evaluatedAt, thirtyDaysAgo),
    ))
    .limit(50);

  if (recentOutcomes.length === 0) return "No recent outcome data to trend.";

  const improved = recentOutcomes.filter((r) => r.outcomeStatus === "improved").length;
  const rate = Math.round((improved / recentOutcomes.length) * 100);

  if (rate >= 70) return `Strong outcomes over past 30 days — ${rate}% of recent interventions improved athlete status.`;
  if (rate >= 50) return `Moderate outcomes trend — ${rate}% improvement rate in the past 30 days.`;
  return `Recent outcomes below target — ${rate}% improvement rate. Review intervention types in use.`;
}

// ─── Main export: full org learning report ────────────────────────────────────

export async function buildOrgLearningInsights(orgId: string): Promise<OrgLearningInsights> {
  const [byType, trend, totalRow] = await Promise.all([
    computeEffectivenessStats(orgId),
    computeRecentTrend(orgId),
    db.select({ count: sql<number>`count(*)::int` })
      .from(interventionOutcomes)
      .where(eq(interventionOutcomes.orgId, orgId)),
  ]);

  const totalOutcomes = totalRow[0]?.count ?? 0;

  const withData = byType.filter((t) => t.totalOutcomes >= 3);
  const topEffective = withData.length > 0 ? withData[0].interventionType : null;
  const leastEffective = withData.length > 1 ? withData[withData.length - 1].interventionType : null;

  const allDays = byType
    .map((t) => t.avgDaysToEvaluation)
    .filter((v): v is number => v !== null);
  const avgResolutionDays = allDays.length > 0
    ? Math.round(allDays.reduce((a, b) => a + b, 0) / allDays.length)
    : null;

  let keyInsight = "No outcome data collected yet. Approve and track interventions to build learning data.";
  if (totalOutcomes > 0 && byType.length > 0) {
    if (topEffective) {
      const label = TYPE_LABELS[topEffective] ?? topEffective;
      keyInsight = `${label} is the most effective intervention type based on ${byType[0].totalOutcomes} tracked outcomes (${byType[0].effectivenessRate}% improvement rate).`;
    }
  }

  return {
    topEffectiveType: topEffective,
    leastEffectiveType: leastEffective,
    avgResolutionDays,
    totalOutcomesTracked: totalOutcomes,
    byType,
    recentTrend: trend,
    keyInsight,
  };
}

// ─── Athlete-level response profile ──────────────────────────────────────────

export async function buildAthleteResponseProfile(
  athleteUserId: string,
  orgId: string
): Promise<AthleteResponseProfile> {
  const outcomes = await db.select()
    .from(interventionOutcomes)
    .where(and(
      eq(interventionOutcomes.orgId, orgId),
      eq(interventionOutcomes.athleteUserId, athleteUserId),
      isNotNull(interventionOutcomes.evaluatedAt),
    ))
    .limit(50);

  if (outcomes.length === 0) {
    return { athleteUserId, totalInterventions: 0, improvedCount: 0, responseRate: 0, bestRespondingType: null, insight: "No outcome history for this athlete yet." };
  }

  const improved = outcomes.filter((o) => o.outcomeStatus === "improved").length;
  const responseRate = Math.round((improved / outcomes.length) * 100);

  // Which type performs best for this athlete
  const byType = new Map<string, number>();
  for (const o of outcomes) {
    if (o.outcomeStatus === "improved") {
      byType.set(o.interventionType, (byType.get(o.interventionType) ?? 0) + 1);
    }
  }
  const bestType = byType.size > 0
    ? [...byType.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const insight = bestType
    ? `This athlete responds best to ${TYPE_LABELS[bestType] ?? bestType} (${responseRate}% overall improvement rate).`
    : `${responseRate}% improvement rate across ${outcomes.length} tracked interventions.`;

  return {
    athleteUserId,
    totalInterventions: outcomes.length,
    improvedCount: improved,
    responseRate,
    bestRespondingType: bestType,
    insight,
  };
}

// ─── Auto-evaluate outcomes that have passed their evaluation window ──────────

export async function runOutcomeEvaluationCron(orgId: string): Promise<{ evaluated: number; errors: number }> {
  const evaluationWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days after approval

  const pending = await db.select()
    .from(interventionOutcomes)
    .where(and(
      eq(interventionOutcomes.orgId, orgId),
      eq(interventionOutcomes.outcomeStatus, "pending_evaluation"),
      gte(interventionOutcomes.approvedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    ))
    .limit(50);

  const eligible = pending.filter((o) =>
    o.approvedAt && o.approvedAt.getTime() < evaluationWindow.getTime()
  );

  let evaluated = 0;
  let errors = 0;

  for (const outcome of eligible) {
    try {
      const afterCtx = await db.select()
        .from(athleteContextObjects)
        .where(and(
          eq(athleteContextObjects.orgId, orgId),
          eq(athleteContextObjects.athleteUserId, outcome.athleteUserId),
        ))
        .limit(1);

      if (!afterCtx[0]) continue;

      const ctx = afterCtx[0];
      const beforeSnap = outcome.beforeSnapshot as any;

      const readinessAfter = Math.round(
        ((ctx.last30DayReadinessTrend as any[]) ?? [])
          .slice(0, 7)
          .map((r: any) => r.score ?? 0)
          .reduce((a: number, b: number) => a + b, 0) /
        Math.max(1, Math.min(7, ((ctx.last30DayReadinessTrend as any[]) ?? []).length)) * 10
      );

      const complianceAfter = ctx.complianceRate ?? 0;
      const readinessDelta = beforeSnap?.readinessBefore ? readinessAfter - beforeSnap.readinessBefore : null;
      const complianceDelta = beforeSnap?.complianceBefore ? complianceAfter - beforeSnap.complianceBefore : null;

      let outcomeStatus: string = "no_change";
      if (readinessDelta !== null && readinessDelta > 5) outcomeStatus = "improved";
      else if (complianceDelta !== null && complianceDelta > 10) outcomeStatus = "improved";
      else if (ctx.riskLevel === "green" && beforeSnap?.riskLevelBefore !== "green") outcomeStatus = "improved";
      else if (readinessDelta !== null && readinessDelta < -10) outcomeStatus = "worsened";

      await db.update(interventionOutcomes).set({
        readinessAfter,
        complianceAfter,
        readinessDelta: readinessDelta ?? undefined,
        complianceDelta: complianceDelta ?? undefined,
        riskLevelAfter: ctx.riskLevel ?? undefined,
        afterSnapshot: {
          readinessTrend: ctx.readinessTrend,
          complianceRate: ctx.complianceRate,
          riskLevel: ctx.riskLevel,
          evaluatedAt: new Date().toISOString(),
        },
        outcomeStatus,
        evaluatedAt: new Date(),
        aiEffectivenessRating: outcomeStatus === "improved" ? 75 : outcomeStatus === "worsened" ? 20 : 50,
        updatedAt: new Date(),
      }).where(eq(interventionOutcomes.id, outcome.id));

      evaluated++;
    } catch (err: any) {
      console.error(`[LearningEngine] Outcome eval failed for ${outcome.id}:`, err.message);
      errors++;
    }
  }

  return { evaluated, errors };
}
