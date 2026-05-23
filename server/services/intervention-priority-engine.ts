/**
 * Intervention Priority Engine
 *
 * Scores pending adaptation drafts and intervention recommendations across
 * the full athlete signal space. Uses explainable heuristic logic only —
 * no black-box ML. Every score is auditable and fully traceable.
 */

import { db } from "../db";
import {
  programAdaptationDrafts,
  athleteInterventionRecommendations,
  athleteContextObjects,
  workoutCompletionLogs,
  workoutReadinessCheckins,
  workoutSessionExerciseLogs,
  orgUsers,
  type AthleteContextObject,
  type ProgramAdaptationDraft,
} from "@shared/schema";
import { eq, and, desc, gte, inArray } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PriorityLevel = "low" | "medium" | "high" | "critical";

export type PrioritizedIntervention = {
  id: string;
  sourceType: "adaptation_draft" | "intervention_recommendation";
  athleteUserId: string;
  athleteName: string;
  orgId: string;
  interventionType: string;
  adaptationType?: string;

  // Priority scoring
  priorityScore: number;
  priorityLevel: PriorityLevel;
  urgencyReason: string;
  recommendedAction: string;
  confidenceScore: number;
  estimatedRisk: string;

  // Multi-signal context
  activeSignals: SignalFinding[];
  signalOverlapBonus: number;
  trajectoryLabel: string;
  trajectoryRationale: string;

  // Original record metadata
  triggerSignals?: any[];
  adaptationRationale?: string;
  status: string;
  createdAt: string | null;
  draftSessions?: any[];
  generationError?: string | null;
};

export type SignalFinding = {
  signal: string;
  label: string;
  severity: "low" | "medium" | "high" | "critical";
  weight: number;
  description: string;
};

export type AthleteRiskProfile = {
  athleteUserId: string;
  athleteName: string;
  orgId: string;
  priorityScore: number;
  priorityLevel: PriorityLevel;
  signals: SignalFinding[];
  trajectoryLabel: string;
  trajectoryRationale: string;
  confidenceScore: number;
  pendingDraftCount: number;
  context: AthleteContextObject | null;
};

// ─── Signal weight table ──────────────────────────────────────────────────────

const SIGNAL_WEIGHTS: Record<string, number> = {
  readiness_low: 20,
  readiness_moderate: 8,
  compliance_critical: 25,
  compliance_declining: 12,
  rpe_spiked_high: 18,
  rpe_elevated: 8,
  new_pain_reported: 22,
  risk_escalated_to_red: 20,
  missed_sessions: 15,
  long_duration_issue: 10,
  multi_signal_overlap_2: 10,
  multi_signal_overlap_3: 20,
  multi_signal_overlap_4plus: 35,
};

// ─── Trajectory heuristics ────────────────────────────────────────────────────

function computeTrajectory(context: AthleteContextObject | null, signals: SignalFinding[]): {
  label: string;
  rationale: string;
} {
  if (!context) return { label: "insufficient data", rationale: "Not enough context to model trajectory." };

  const highSignals = signals.filter((s) => s.severity === "high" || s.severity === "critical");
  const hasInjury = signals.some((s) => s.signal === "new_pain_reported");
  const hasCompliance = signals.some((s) => s.signal === "compliance_critical" || s.signal === "compliance_declining");
  const hasRPE = signals.some((s) => s.signal === "rpe_spiked_high");
  const hasReadiness = signals.some((s) => s.signal === "readiness_low");
  const hasMissed = signals.some((s) => s.signal === "missed_sessions");
  const compliance = context.complianceRate ?? 100;

  if (hasInjury && hasRPE && hasReadiness) {
    return {
      label: "possible overreaching pattern",
      rationale: "Combination of new pain, elevated RPE, and low readiness is consistent with overreaching. Immediate load reduction recommended.",
    };
  }
  if (compliance < 40 && hasMissed) {
    return {
      label: "high risk of disengagement",
      rationale: `Compliance at ${compliance}% with recent missed sessions. Pattern is consistent with early dropout risk. Motivational outreach or schedule simplification may restore engagement.`,
    };
  }
  if (hasReadiness && !hasCompliance && !hasInjury) {
    return {
      label: "likely temporary fatigue",
      rationale: "Low readiness without compliance drop or injury typically indicates temporary fatigue. Monitor for 3–5 days before escalating.",
    };
  }
  if (hasRPE && !hasReadiness) {
    return {
      label: "high probability compliance decline",
      rationale: "Sustained high RPE without readiness decline often precedes compliance drop within 1–2 weeks. Proactive load reduction advised.",
    };
  }
  if (highSignals.length >= 3) {
    return {
      label: "multi-factor risk escalation",
      rationale: `${highSignals.length} high-severity signals active simultaneously. Risk is unlikely to self-resolve without intervention.`,
    };
  }
  if (highSignals.length === 1) {
    return {
      label: "early warning — monitor",
      rationale: "Single signal elevated. May resolve with minor adjustment. Low-urgency monitoring recommended.",
    };
  }
  return {
    label: "stable with watchpoints",
    rationale: "Some signals detected but pattern does not suggest imminent escalation.",
  };
}

// ─── Signal detection from context object ────────────────────────────────────

function detectSignalsFromContext(context: AthleteContextObject): SignalFinding[] {
  const signals: SignalFinding[] = [];
  const compliance = context.complianceRate ?? 100;
  const injuryNotes = (context.injuryNotes as any[]) ?? [];
  const rpeValues = ((context.recentRPETrend as any[]) ?? []).map((r: any) => r.rpe).filter((v: any) => typeof v === "number");
  const rpeAvg = rpeValues.length > 0 ? rpeValues.reduce((a: number, b: number) => a + b, 0) / rpeValues.length : null;

  if (context.readinessTrend === "low") {
    signals.push({ signal: "readiness_low", label: "Low readiness", severity: "high", weight: SIGNAL_WEIGHTS.readiness_low, description: "Athlete readiness trend is low over 30 days." });
  } else if (context.readinessTrend === "moderate") {
    signals.push({ signal: "readiness_moderate", label: "Moderate readiness", severity: "medium", weight: SIGNAL_WEIGHTS.readiness_moderate, description: "Readiness trend is moderate — trending down from baseline." });
  }

  if (compliance < 50) {
    signals.push({ signal: "compliance_critical", label: "Critical compliance", severity: "critical", weight: SIGNAL_WEIGHTS.compliance_critical, description: `Compliance at ${compliance}% — critically low.` });
  } else if (compliance < 70) {
    signals.push({ signal: "compliance_declining", label: "Declining compliance", severity: "medium", weight: SIGNAL_WEIGHTS.compliance_declining, description: `Compliance at ${compliance}% — below optimal threshold.` });
  }

  if (rpeAvg !== null && rpeAvg >= 8.5) {
    signals.push({ signal: "rpe_spiked_high", label: "RPE spiked", severity: "high", weight: SIGNAL_WEIGHTS.rpe_spiked_high, description: `Average RPE is ${rpeAvg.toFixed(1)}/10 — near-maximal sustained effort.` });
  } else if (rpeAvg !== null && rpeAvg >= 7.5) {
    signals.push({ signal: "rpe_elevated", label: "Elevated RPE", severity: "medium", weight: SIGNAL_WEIGHTS.rpe_elevated, description: `Average RPE is ${rpeAvg.toFixed(1)}/10 — moderately high.` });
  }

  if (injuryNotes.length > 0) {
    const areas = injuryNotes.flatMap((n: any) => n.areas ?? []).slice(0, 3);
    signals.push({ signal: "new_pain_reported", label: "Pain reported", severity: "high", weight: SIGNAL_WEIGHTS.new_pain_reported, description: `Pain reports in: ${areas.length > 0 ? areas.join(", ") : "unspecified area"}.` });
  }

  if (context.riskLevel === "red") {
    signals.push({ signal: "risk_escalated_to_red", label: "High risk level", severity: "critical", weight: SIGNAL_WEIGHTS.risk_escalated_to_red, description: "Athlete risk level is red — multiple compounding factors." });
  }

  return signals;
}

// ─── Multi-signal overlap bonus ───────────────────────────────────────────────

function computeOverlapBonus(signals: SignalFinding[]): number {
  const highCount = signals.filter((s) => s.severity === "high" || s.severity === "critical").length;
  if (highCount >= 4) return SIGNAL_WEIGHTS.multi_signal_overlap_4plus;
  if (highCount === 3) return SIGNAL_WEIGHTS.multi_signal_overlap_3;
  if (highCount === 2) return SIGNAL_WEIGHTS.multi_signal_overlap_2;
  return 0;
}

// ─── Final score computation ──────────────────────────────────────────────────

function computeScore(signals: SignalFinding[], overlapBonus: number): number {
  const baseScore = signals.reduce((acc, s) => acc + s.weight, 0);
  return Math.min(100, Math.round(baseScore + overlapBonus));
}

function scoreToPriorityLevel(score: number): PriorityLevel {
  if (score >= 70) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

function computeConfidence(context: AthleteContextObject | null, signals: SignalFinding[]): number {
  if (!context) return 30;

  let conf = 50;

  // More data points → higher confidence
  const readingPoints = (context.last30DayReadinessTrend as any[])?.length ?? 0;
  if (readingPoints >= 15) conf += 15;
  else if (readingPoints >= 7) conf += 8;

  const rpePoints = (context.recentRPETrend as any[])?.length ?? 0;
  if (rpePoints >= 10) conf += 10;
  else if (rpePoints >= 5) conf += 5;

  // Multiple corroborating signals → higher confidence
  if (signals.length >= 4) conf += 15;
  else if (signals.length >= 2) conf += 8;

  // Sustained issues vs one-day spike
  if (context.readinessTrend === "low") conf += 5;

  return Math.min(99, conf);
}

// ─── Urgency reason builder ───────────────────────────────────────────────────

function buildUrgencyReason(signals: SignalFinding[], context: AthleteContextObject | null): string {
  const parts: string[] = [];
  for (const s of signals.filter((x) => x.severity === "high" || x.severity === "critical").slice(0, 3)) {
    parts.push(s.description);
  }
  if (parts.length === 0 && signals.length > 0) {
    parts.push(signals[0].description);
  }
  return parts.join(" ") || "Multiple athlete signals require attention.";
}

// ─── Recommended action builder ──────────────────────────────────────────────

function buildRecommendedAction(adaptationType: string | null, signals: SignalFinding[]): string {
  const hasInjury = signals.some((s) => s.signal === "new_pain_reported");
  const hasCompliance = signals.some((s) => s.signal === "compliance_critical");
  const hasRPE = signals.some((s) => s.signal === "rpe_spiked_high");
  const hasMissed = signals.some((s) => s.signal === "missed_sessions");

  if (hasInjury) return "Review and approve injury modification draft, or schedule a coach conversation.";
  if (adaptationType === "deload") return "Approve deload week draft to reduce accumulated fatigue.";
  if (adaptationType === "recovery_emphasis") return "Approve recovery emphasis draft to address low readiness.";
  if (adaptationType === "program_simplification" || hasCompliance) return "Approve simplified program draft or conduct motivational outreach.";
  if (hasRPE) return "Approve deload or load reduction. Consider sleep/recovery education.";
  if (hasMissed) return "Initiate motivational outreach or schedule adjustment conversation.";
  return "Review adaptation draft and approve, edit, or assign education.";
}

// ─── Main scorer: one adaptation draft → PrioritizedIntervention ─────────────

async function scoreDraft(
  draft: ProgramAdaptationDraft,
  athleteName: string,
  context: AthleteContextObject | null
): Promise<PrioritizedIntervention> {
  const signals = context ? detectSignalsFromContext(context) : [];

  // Also incorporate signals embedded in the draft itself
  const draftSignals = (draft.triggerSignals as any[]) ?? [];
  for (const ds of draftSignals) {
    if (!signals.find((s) => s.signal === ds.signal)) {
      signals.push({
        signal: ds.signal,
        label: ds.signal.replace(/_/g, " "),
        severity: ds.severity ?? "medium",
        weight: SIGNAL_WEIGHTS[ds.signal] ?? 10,
        description: ds.description ?? ds.signal.replace(/_/g, " "),
      });
    }
  }

  const overlapBonus = computeOverlapBonus(signals);
  const score = computeScore(signals, overlapBonus);
  const level = scoreToPriorityLevel(score);
  const confidence = computeConfidence(context, signals);
  const trajectory = computeTrajectory(context, signals);

  return {
    id: draft.id,
    sourceType: "adaptation_draft",
    athleteUserId: draft.athleteUserId,
    athleteName,
    orgId: draft.orgId,
    interventionType: draft.adaptationType,
    adaptationType: draft.adaptationType,
    priorityScore: score,
    priorityLevel: level,
    urgencyReason: buildUrgencyReason(signals, context),
    recommendedAction: buildRecommendedAction(draft.adaptationType, signals),
    confidenceScore: confidence,
    estimatedRisk: context?.riskLevel ?? "unknown",
    activeSignals: signals,
    signalOverlapBonus: overlapBonus,
    trajectoryLabel: trajectory.label,
    trajectoryRationale: trajectory.rationale,
    triggerSignals: draftSignals,
    adaptationRationale: draft.adaptationRationale ?? undefined,
    status: draft.status,
    createdAt: draft.createdAt?.toISOString() ?? null,
    draftSessions: (draft.draftSessions as any[]) ?? [],
    generationError: draft.generationError,
  };
}

// ─── Score an athlete intervention recommendation ─────────────────────────────

async function scoreIntervention(
  intv: any,
  athleteName: string,
  context: AthleteContextObject | null
): Promise<PrioritizedIntervention> {
  const signals = context ? detectSignalsFromContext(context) : [];
  const overlapBonus = computeOverlapBonus(signals);
  const score = computeScore(signals, overlapBonus);
  const level = scoreToPriorityLevel(score);
  const confidence = computeConfidence(context, signals);
  const trajectory = computeTrajectory(context, signals);

  return {
    id: intv.id,
    sourceType: "intervention_recommendation",
    athleteUserId: intv.athleteUserId,
    athleteName,
    orgId: intv.orgId,
    interventionType: intv.recommendationType ?? "general",
    priorityScore: score,
    priorityLevel: level,
    urgencyReason: intv.summary ?? buildUrgencyReason(signals, context),
    recommendedAction: intv.suggestedAction ?? buildRecommendedAction(null, signals),
    confidenceScore: confidence,
    estimatedRisk: context?.riskLevel ?? "unknown",
    activeSignals: signals,
    signalOverlapBonus: overlapBonus,
    trajectoryLabel: trajectory.label,
    trajectoryRationale: trajectory.rationale,
    status: intv.status,
    createdAt: intv.createdAt?.toISOString() ?? null,
  };
}

// ─── Public: build full prioritized queue for org ─────────────────────────────

export async function buildPrioritizedInterventionQueue(orgId: string): Promise<{
  prioritizedQueue: PrioritizedIntervention[];
  criticalAthletes: AthleteRiskProfile[];
  summary: { critical: number; high: number; medium: number; low: number };
}> {
  // Fetch pending drafts + interventions + contexts in parallel
  const [drafts, interventions, contexts, athleteNameRows] = await Promise.all([
    db.select().from(programAdaptationDrafts)
      .where(and(eq(programAdaptationDrafts.orgId, orgId), eq(programAdaptationDrafts.status, "pending_review")))
      .orderBy(desc(programAdaptationDrafts.createdAt))
      .limit(30),
    db.select().from(athleteInterventionRecommendations)
      .where(and(eq(athleteInterventionRecommendations.orgId, orgId), eq(athleteInterventionRecommendations.status, "pending")))
      .orderBy(desc(athleteInterventionRecommendations.createdAt))
      .limit(30),
    db.select().from(athleteContextObjects)
      .where(eq(athleteContextObjects.orgId, orgId))
      .limit(100),
    db.select({ id: orgUsers.id, name: orgUsers.name })
      .from(orgUsers)
      .where(eq(orgUsers.orgId, orgId))
      .limit(200),
  ]);

  const contextMap = new Map(contexts.map((c) => [c.athleteUserId, c]));
  const nameMap = new Map(athleteNameRows.map((r) => [r.id, r.name ?? "Unknown"]));

  const scoredItems: PrioritizedIntervention[] = [];

  for (const draft of drafts) {
    const name = nameMap.get(draft.athleteUserId) ?? "Unknown";
    const ctx = contextMap.get(draft.athleteUserId) ?? null;
    const scored = await scoreDraft(draft, name, ctx);
    scoredItems.push(scored);
  }

  for (const intv of interventions) {
    const name = nameMap.get(intv.athleteUserId) ?? "Unknown";
    const ctx = contextMap.get(intv.athleteUserId) ?? null;
    const scored = await scoreIntervention(intv, name, ctx);
    scoredItems.push(scored);
  }

  // Sort descending by priority score
  const prioritizedQueue = scoredItems.sort((a, b) => b.priorityScore - a.priorityScore);

  // Build critical athletes (top athletes needing attention, deduplicated by athlete)
  const athleteScoreMap = new Map<string, AthleteRiskProfile>();
  for (const item of prioritizedQueue) {
    const existing = athleteScoreMap.get(item.athleteUserId);
    if (!existing || item.priorityScore > existing.priorityScore) {
      const ctx = contextMap.get(item.athleteUserId) ?? null;
      const trajectory = computeTrajectory(ctx, item.activeSignals);
      athleteScoreMap.set(item.athleteUserId, {
        athleteUserId: item.athleteUserId,
        athleteName: item.athleteName,
        orgId: item.orgId,
        priorityScore: item.priorityScore,
        priorityLevel: item.priorityLevel,
        signals: item.activeSignals,
        trajectoryLabel: trajectory.label,
        trajectoryRationale: trajectory.rationale,
        confidenceScore: item.confidenceScore,
        pendingDraftCount: prioritizedQueue.filter((x) => x.athleteUserId === item.athleteUserId).length,
        context: ctx,
      });
    }
  }

  const criticalAthletes = Array.from(athleteScoreMap.values())
    .filter((a) => a.priorityLevel === "critical" || a.priorityLevel === "high")
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 10);

  const summary = {
    critical: prioritizedQueue.filter((x) => x.priorityLevel === "critical").length,
    high: prioritizedQueue.filter((x) => x.priorityLevel === "high").length,
    medium: prioritizedQueue.filter((x) => x.priorityLevel === "medium").length,
    low: prioritizedQueue.filter((x) => x.priorityLevel === "low").length,
  };

  return { prioritizedQueue, criticalAthletes, summary };
}

// ─── Score a single athlete (for context refresh trigger) ────────────────────

export function scoreAthleteFromContext(context: AthleteContextObject): {
  priorityScore: number;
  priorityLevel: PriorityLevel;
  signals: SignalFinding[];
  trajectoryLabel: string;
  confidenceScore: number;
} {
  const signals = detectSignalsFromContext(context);
  const overlapBonus = computeOverlapBonus(signals);
  const score = computeScore(signals, overlapBonus);
  const level = scoreToPriorityLevel(score);
  const confidence = computeConfidence(context, signals);
  const trajectory = computeTrajectory(context, signals);

  return {
    priorityScore: score,
    priorityLevel: level,
    signals,
    trajectoryLabel: trajectory.label,
    confidenceScore: confidence,
  };
}
