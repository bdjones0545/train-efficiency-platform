import { db } from "../db";
import {
  athleteContextObjects,
  workoutReadinessCheckins,
  workoutCompletionLogs,
  workoutSessionExerciseLogs,
  workoutSessions,
  workoutPrograms,
  workoutProgramAssignments,
  prLiftEntries,
  prLiftTypes,
  athleteRiskFlags,
  athleteInterventionRecommendations,
  orgUsers,
  type AthleteContextObject,
} from "@shared/schema";
import { eq, and, desc, gte, inArray, sql } from "drizzle-orm";
import { checkAndGenerateAdaptationDraft } from "./program-adaptation-engine";

const STALE_THRESHOLD_HOURS = 12;

// ─── Readiness trend classifier ──────────────────────────────────────────────

function classifyReadinessTrend(scores: number[]): "low" | "moderate" | "high" | "unknown" {
  if (scores.length === 0) return "unknown";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 7) return "high";
  if (avg >= 5) return "moderate";
  return "low";
}

function classifyRPETrend(rpeValues: number[]): "high" | "moderate" | "normal" | "unknown" {
  if (rpeValues.length === 0) return "unknown";
  const avg = rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length;
  if (avg >= 8) return "high";
  if (avg >= 6) return "moderate";
  return "normal";
}

function classifyRiskLevel(complianceRate: number, readinessTrend: string, rpeAvg: number | null): "red" | "yellow" | "green" {
  if (complianceRate < 40) return "red";
  if (readinessTrend === "low") return "red";
  if (rpeAvg !== null && rpeAvg >= 9) return "red";
  if (complianceRate < 65) return "yellow";
  if (readinessTrend === "moderate" && complianceRate < 75) return "yellow";
  return "green";
}

// ─── Core builder ────────────────────────────────────────────────────────────

export async function buildAthleteContextObject(
  athleteUserId: string,
  orgId: string,
  trigger: string = "manual"
): Promise<AthleteContextObject> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // ── Run all data queries in parallel ────────────────────────────────────────
  const [
    readinessCheckins,
    completionLogs,
    exerciseLogs,
    activeAssignments,
    riskFlags,
    interventions,
    recentPRs,
    athleteProfile,
  ] = await Promise.all([
    // Last 30 days readiness check-ins
    db.select()
      .from(workoutReadinessCheckins)
      .where(and(
        eq(workoutReadinessCheckins.orgId, orgId),
        eq(workoutReadinessCheckins.athleteUserId, athleteUserId),
        gte(workoutReadinessCheckins.createdAt, thirtyDaysAgo),
      ))
      .orderBy(desc(workoutReadinessCheckins.createdAt))
      .limit(60)
      .catch(() => []),

    // Last 30 days session completions
    db.select()
      .from(workoutCompletionLogs)
      .where(and(
        eq(workoutCompletionLogs.orgId, orgId),
        eq(workoutCompletionLogs.athleteUserId, athleteUserId),
        gte(workoutCompletionLogs.createdAt, thirtyDaysAgo),
      ))
      .orderBy(desc(workoutCompletionLogs.createdAt))
      .limit(60)
      .catch(() => []),

    // Last 7 days exercise RPE logs
    db.select()
      .from(workoutSessionExerciseLogs)
      .where(and(
        eq(workoutSessionExerciseLogs.orgId, orgId),
        eq(workoutSessionExerciseLogs.athleteUserId, athleteUserId),
        gte(workoutSessionExerciseLogs.createdAt, sevenDaysAgo),
      ))
      .orderBy(desc(workoutSessionExerciseLogs.createdAt))
      .limit(50)
      .catch(() => []),

    // Active program assignments
    db.select({
      assignmentId: workoutProgramAssignments.id,
      programId: workoutProgramAssignments.workoutProgramId,
      assignedAt: workoutProgramAssignments.assignedAt,
      programTitle: workoutPrograms.title,
      programGoal: workoutPrograms.goal,
      durationWeeks: workoutPrograms.durationWeeks,
      createdAt: workoutPrograms.createdAt,
    })
      .from(workoutProgramAssignments)
      .innerJoin(workoutPrograms, eq(workoutProgramAssignments.workoutProgramId, workoutPrograms.id))
      .where(and(
        eq(workoutProgramAssignments.orgId, orgId),
        eq(workoutProgramAssignments.athleteUserId, athleteUserId),
        eq(workoutProgramAssignments.status, "active"),
      ))
      .orderBy(desc(workoutProgramAssignments.assignedAt))
      .limit(1)
      .catch(() => []),

    // Active risk flags
    db.select()
      .from(athleteRiskFlags)
      .where(and(
        eq(athleteRiskFlags.orgId, orgId),
        eq(athleteRiskFlags.athleteUserId, athleteUserId),
        eq(athleteRiskFlags.status, "active"),
      ))
      .orderBy(desc(athleteRiskFlags.createdAt))
      .limit(10)
      .catch(() => []),

    // Recent interventions (last 60 days)
    db.select()
      .from(athleteInterventionRecommendations)
      .where(and(
        eq(athleteInterventionRecommendations.orgId, orgId),
        eq(athleteInterventionRecommendations.athleteUserId, athleteUserId),
        gte(athleteInterventionRecommendations.createdAt, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)),
      ))
      .orderBy(desc(athleteInterventionRecommendations.createdAt))
      .limit(10)
      .catch(() => []),

    // Recent PRs
    db.select({
      value: prLiftEntries.value,
      unit: prLiftEntries.unit,
      entryDate: prLiftEntries.entryDate,
      liftName: prLiftTypes.name,
      liftCategory: prLiftTypes.category,
    })
      .from(prLiftEntries)
      .innerJoin(prLiftTypes, eq(prLiftEntries.liftTypeId, prLiftTypes.id))
      .where(and(
        eq(prLiftEntries.orgId, orgId),
        eq(prLiftEntries.userId, athleteUserId),
      ))
      .orderBy(desc(prLiftEntries.createdAt))
      .limit(15)
      .catch(() => []),

    // Athlete profile for injury notes / coach notes
    db.select()
      .from(orgUsers)
      .where(eq(orgUsers.id, athleteUserId))
      .limit(1)
      .catch(() => []),
  ]);

  // ── Compute readiness trend ──────────────────────────────────────────────────
  const readinessScores = readinessCheckins
    .map((c) => c.readinessScore)
    .filter((s): s is number => s !== null);

  const readinessTrendLabel = classifyReadinessTrend(readinessScores);

  const readinessTrendData = readinessCheckins.slice(0, 30).map((c) => ({
    date: c.createdAt,
    score: c.readinessScore,
    sleepQuality: c.sleepQuality,
    sorenessLevel: c.sorenessLevel,
    fatigueLevel: c.fatigueLevel,
    stressLevel: c.stressLevel,
    motivationLevel: c.motivationLevel,
    painAreas: c.painAreas,
    notes: c.notes,
  }));

  // ── Compute compliance rate ──────────────────────────────────────────────────
  // Get total sessions assigned in the last 30 days for this athlete
  let totalAssignedSessions = 0;
  const completedCount = completionLogs.length;

  if (activeAssignments.length > 0) {
    const assignment = activeAssignments[0];
    const daysSinceAssignment = assignment.assignedAt
      ? Math.max(1, Math.floor((Date.now() - new Date(assignment.assignedAt).getTime()) / (24 * 60 * 60 * 1000)))
      : 30;
    const programSessions = await db.select({ count: sql<number>`count(*)` })
      .from(workoutSessions)
      .where(eq(workoutSessions.workoutProgramId, assignment.programId))
      .catch(() => [{ count: 0 }]);
    const totalProgramSessions = Number((programSessions[0] as any)?.count ?? 0);
    const programDurationDays = (assignment.durationWeeks ?? 4) * 7;
    const weeksElapsed = Math.min(daysSinceAssignment / 7, assignment.durationWeeks ?? 4);
    totalAssignedSessions = Math.round((totalProgramSessions / (assignment.durationWeeks ?? 4)) * weeksElapsed);
  }

  const complianceRate = totalAssignedSessions > 0
    ? Math.min(100, Math.round((completedCount / totalAssignedSessions) * 100))
    : completedCount > 0 ? 75 : 0;

  // ── Compute RPE trend ────────────────────────────────────────────────────────
  const rpeValues = exerciseLogs
    .map((l) => l.rpe)
    .filter((r): r is number => r !== null && r >= 1 && r <= 10);

  const rpeTrend = classifyRPETrend(rpeValues);
  const rpeAvg = rpeValues.length > 0
    ? Math.round(rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length)
    : null;

  const rpeTrendData = exerciseLogs.slice(0, 20).map((l) => ({
    date: l.createdAt,
    exerciseName: l.exerciseName,
    rpe: l.rpe,
    notes: l.notes,
  }));

  // ── Compute risk level ───────────────────────────────────────────────────────
  const riskLevel = classifyRiskLevel(complianceRate, readinessTrendLabel, rpeAvg);

  // ── Current program context ──────────────────────────────────────────────────
  let currentProgramId: string | null = null;
  let currentProgramWeek: number | null = null;
  let currentProgramPhase: string | null = null;

  if (activeAssignments.length > 0) {
    const assignment = activeAssignments[0];
    currentProgramId = assignment.programId;
    const daysSince = assignment.assignedAt
      ? Math.floor((Date.now() - new Date(assignment.assignedAt).getTime()) / (24 * 60 * 60 * 1000))
      : 0;
    currentProgramWeek = Math.min(Math.floor(daysSince / 7) + 1, assignment.durationWeeks ?? 4);
    if (currentProgramWeek <= 1) currentProgramPhase = "introductory";
    else if (currentProgramWeek >= (assignment.durationWeeks ?? 4)) currentProgramPhase = "peak";
    else if (currentProgramWeek % 4 === 0) currentProgramPhase = "deload";
    else currentProgramPhase = "accumulation";
  }

  // ── Missed sessions ──────────────────────────────────────────────────────────
  const recentMissed: any[] = [];
  if (totalAssignedSessions > completedCount) {
    recentMissed.push({
      estimatedMissed: totalAssignedSessions - completedCount,
      period: "last 30 days",
    });
  }

  // ── Session feedback ─────────────────────────────────────────────────────────
  const sessionFeedback = completionLogs.slice(0, 10).map((l) => ({
    date: l.completedAt,
    rating: l.rating,
    notes: l.notes,
  }));

  // ── Injury notes from pain area reports ─────────────────────────────────────
  const injuryNotes = readinessCheckins
    .filter((c) => c.painAreas && Array.isArray(c.painAreas) && (c.painAreas as any[]).length > 0)
    .slice(0, 5)
    .map((c) => ({
      date: c.createdAt,
      areas: c.painAreas,
      notes: c.notes,
    }));

  // ── Risk flags ────────────────────────────────────────────────────────────────
  const riskFlagsData = riskFlags.map((f) => ({
    flagType: f.flagType,
    severity: f.severity,
    title: f.title,
    summary: f.summary,
    recommendation: f.recommendation,
    createdAt: f.createdAt,
  }));

  // ── Intervention history ──────────────────────────────────────────────────────
  const interventionHistoryData = interventions.map((i) => ({
    type: i.recommendationType,
    title: i.title,
    status: i.status,
    severity: i.severity,
    createdAt: i.createdAt,
  }));

  // ── AI summary generation ─────────────────────────────────────────────────────
  const aiSummary = generateContextSummary({
    readinessTrend: readinessTrendLabel,
    complianceRate,
    rpeAvg,
    rpeTrend,
    riskLevel,
    riskFlagsCount: riskFlags.length,
    currentProgramPhase,
    currentProgramWeek,
    injuryCount: injuryNotes.length,
    interventionCount: interventions.length,
  });

  // ── Upsert into DB ────────────────────────────────────────────────────────────
  const contextPayload = {
    athleteUserId,
    orgId,
    currentProgramId,
    currentProgramWeek,
    currentProgramPhase,
    complianceRate,
    readinessTrend: readinessTrendLabel,
    riskLevel,
    last30DayReadinessTrend: readinessTrendData,
    recentSessionFeedback: sessionFeedback,
    recentRPETrend: rpeTrendData,
    recentPRs: recentPRs,
    missedSessions: recentMissed,
    injuryNotes: injuryNotes,
    coachNotes: (athleteProfile[0] as any)?.coachNotes ? [{ note: (athleteProfile[0] as any).coachNotes }] : [],
    interventionHistory: interventionHistoryData,
    educationHistory: [],
    riskFlags: riskFlagsData,
    aiSummary,
    lastRefreshTrigger: trigger,
    updatedAt: new Date(),
  };

  const [existing] = await db.select()
    .from(athleteContextObjects)
    .where(and(
      eq(athleteContextObjects.athleteUserId, athleteUserId),
      eq(athleteContextObjects.orgId, orgId),
    ))
    .limit(1);

  // Capture previous context for change detection BEFORE overwriting
  const previousContext: AthleteContextObject | null = existing ?? null;

  let result: AthleteContextObject;

  if (existing) {
    const [updated] = await db.update(athleteContextObjects)
      .set(contextPayload)
      .where(eq(athleteContextObjects.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [inserted] = await db.insert(athleteContextObjects)
      .values(contextPayload)
      .returning();
    result = inserted;
  }

  // Fire adaptation draft check asynchronously — never block the context rebuild
  // Only run on explicit triggers (not every stale auto-refresh to avoid spam)
  if (trigger !== "auto_stale_refresh") {
    setImmediate(async () => {
      try {
        const draft = await checkAndGenerateAdaptationDraft(previousContext, result);
        if (draft) {
          console.log(`[ContextBroker] Adaptation draft generated: id=${draft.id} type=${draft.adaptationType} athlete=${athleteUserId}`);
        }
      } catch (err: any) {
        console.error(`[ContextBroker] Adaptation draft check failed for athlete=${athleteUserId}:`, err.message);
      }
    });
  }

  return result;
}

// ─── Simple text summary for AI prompts ──────────────────────────────────────

function generateContextSummary(data: {
  readinessTrend: string;
  complianceRate: number;
  rpeAvg: number | null;
  rpeTrend: string;
  riskLevel: string;
  riskFlagsCount: number;
  currentProgramPhase: string | null;
  currentProgramWeek: number | null;
  injuryCount: number;
  interventionCount: number;
}): string {
  const parts: string[] = [];

  parts.push(`Readiness trend (last 30 days): ${data.readinessTrend}`);
  parts.push(`Session compliance rate: ${data.complianceRate}%`);

  if (data.rpeAvg !== null) {
    parts.push(`Average RPE (last 7 days): ${data.rpeAvg}/10 (${data.rpeTrend})`);
  }

  if (data.currentProgramPhase) {
    parts.push(`Current program phase: ${data.currentProgramPhase} (week ${data.currentProgramWeek ?? "?"})`);
  }

  if (data.injuryCount > 0) {
    parts.push(`Recent pain area reports: ${data.injuryCount} in last 30 days`);
  }

  if (data.riskFlagsCount > 0) {
    parts.push(`Active risk flags: ${data.riskFlagsCount}`);
  }

  if (data.interventionCount > 0) {
    parts.push(`Recent interventions: ${data.interventionCount} in last 60 days`);
  }

  parts.push(`Overall risk level: ${data.riskLevel}`);

  return parts.join(". ") + ".";
}

// ─── Get context, refresh if stale ───────────────────────────────────────────

export async function getAthleteContextForAI(
  athleteUserId: string,
  orgId: string
): Promise<AthleteContextObject> {
  const [existing] = await db.select()
    .from(athleteContextObjects)
    .where(and(
      eq(athleteContextObjects.athleteUserId, athleteUserId),
      eq(athleteContextObjects.orgId, orgId),
    ))
    .limit(1);

  if (!existing) {
    return buildAthleteContextObject(athleteUserId, orgId, "auto");
  }

  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);
  const isStale = !existing.updatedAt || existing.updatedAt < staleThreshold;

  if (isStale) {
    return buildAthleteContextObject(athleteUserId, orgId, "auto_stale_refresh");
  }

  return existing;
}

// ─── Refresh (explicit trigger) ──────────────────────────────────────────────

export async function refreshAthleteContextObject(
  athleteUserId: string,
  orgId: string,
  trigger: string = "manual"
): Promise<AthleteContextObject> {
  return buildAthleteContextObject(athleteUserId, orgId, trigger);
}

// ─── Summarize context for AI prompt injection ───────────────────────────────

export function summarizeAthleteContextForPrompt(context: AthleteContextObject): string {
  const lines: string[] = [
    "=== ATHLETE INTELLIGENCE CONTEXT ===",
  ];

  if (context.aiSummary) {
    lines.push(context.aiSummary);
  }

  if (context.currentProgramPhase) {
    lines.push(`Program phase: ${context.currentProgramPhase}, week ${context.currentProgramWeek ?? "?"}`);
  }

  // Readiness modifiers
  if (context.readinessTrend === "low") {
    lines.push("READINESS ALERT: Athlete readiness has been consistently low. Reduce volume and intensity. Prioritize recovery. Do not apply aggressive load progressions.");
  } else if (context.readinessTrend === "moderate") {
    lines.push("READINESS NOTE: Athlete readiness is moderate. Apply conservative load progressions.");
  }

  // Compliance modifiers
  if ((context.complianceRate ?? 100) < 50) {
    lines.push("COMPLIANCE ALERT: Athlete compliance is critically low (<50%). Generate simpler sessions. Reduce complexity and volume. Prioritize adherence over optimization.");
  } else if ((context.complianceRate ?? 100) < 70) {
    lines.push("COMPLIANCE NOTE: Athlete compliance is below target (<70%). Keep sessions accessible and manageable. Avoid overloading.");
  }

  // RPE modifiers
  const rpeTrend = (context.recentRPETrend as any[]) ?? [];
  const rpeValues = rpeTrend.map((r: any) => r.rpe).filter((r: any) => typeof r === "number");
  if (rpeValues.length > 0) {
    const avgRpe = rpeValues.reduce((a: number, b: number) => a + b, 0) / rpeValues.length;
    if (avgRpe >= 8.5) {
      lines.push(`RPE ALERT: Average RPE is ${avgRpe.toFixed(1)}/10 over the last 7 days. Include a deload or significantly reduce load next cycle.`);
    }
  }

  // Injury notes
  const injuries = (context.injuryNotes as any[]) ?? [];
  if (injuries.length > 0) {
    const recentAreas = injuries.flatMap((i: any) => i.areas ?? []).slice(0, 5);
    if (recentAreas.length > 0) {
      lines.push(`INJURY AWARENESS: Recent pain reports in: ${recentAreas.join(", ")}. Avoid or regress exercises targeting these areas.`);
    }
  }

  // Risk flags
  const flags = (context.riskFlags as any[]) ?? [];
  const highFlags = flags.filter((f: any) => f.severity === "high" || f.severity === "critical");
  if (highFlags.length > 0) {
    lines.push(`RISK FLAGS: ${highFlags.map((f: any) => f.title).join("; ")}`);
  }

  lines.push("=== END ATHLETE CONTEXT ===");

  return lines.join("\n");
}

// ─── Compute readiness modifiers for TrainChat payload ───────────────────────

export type TrainChatModifiers = {
  readinessAdjustmentApplied: boolean;
  complianceAdjustmentApplied: boolean;
  rpeAdjustmentApplied: boolean;
  modifiersApplied: string[];
  contextualInstructions: string;
};

export function computeTrainChatModifiers(context: AthleteContextObject): TrainChatModifiers {
  const modifiers: string[] = [];
  const instructions: string[] = [];

  let readinessAdjustmentApplied = false;
  let complianceAdjustmentApplied = false;
  let rpeAdjustmentApplied = false;

  if (context.readinessTrend === "low") {
    readinessAdjustmentApplied = true;
    modifiers.push("reduced_volume_readiness");
    instructions.push("Reduce total volume by 20-30%. Reduce intensity. Emphasize recovery and movement quality over load.");
  } else if (context.readinessTrend === "moderate") {
    readinessAdjustmentApplied = true;
    modifiers.push("conservative_progression_readiness");
    instructions.push("Apply conservative load progressions. Do not include aggressive intensity increases.");
  }

  if ((context.complianceRate ?? 100) < 50) {
    complianceAdjustmentApplied = true;
    modifiers.push("simplified_sessions_compliance");
    instructions.push("Generate shorter, simpler sessions with fewer exercises. Prioritize athlete adherence over programming complexity.");
  } else if ((context.complianceRate ?? 100) < 70) {
    complianceAdjustmentApplied = true;
    modifiers.push("moderate_simplification_compliance");
    instructions.push("Keep session complexity moderate. Avoid overly technical or time-intensive workouts.");
  }

  const rpeTrend = (context.recentRPETrend as any[]) ?? [];
  const rpeValues = rpeTrend.map((r: any) => r.rpe).filter((r: any) => typeof r === "number");
  if (rpeValues.length > 0) {
    const avgRpe = rpeValues.reduce((a: number, b: number) => a + b, 0) / rpeValues.length;
    if (avgRpe >= 8.5) {
      rpeAdjustmentApplied = true;
      modifiers.push("deload_rpe");
      instructions.push("Include a deload week at the start. Reduce loads to 60-70% of typical. Prioritize recovery.");
    }
  }

  const injuries = (context.injuryNotes as any[]) ?? [];
  if (injuries.length > 0) {
    const recentAreas = injuries.flatMap((i: any) => i.areas ?? []).slice(0, 5);
    if (recentAreas.length > 0) {
      modifiers.push("injury_awareness");
      instructions.push(`Avoid or provide regressions for exercises targeting: ${recentAreas.join(", ")}.`);
    }
  }

  return {
    readinessAdjustmentApplied,
    complianceAdjustmentApplied,
    rpeAdjustmentApplied,
    modifiersApplied: modifiers,
    contextualInstructions: instructions.join(" "),
  };
}

// ─── Daily bulk refresh for all active athletes in an org ────────────────────

export async function refreshAllActiveAthleteContexts(orgId: string): Promise<{ refreshed: number; errors: number }> {
  let refreshed = 0;
  let errors = 0;

  try {
    const assignments = await db.selectDistinct({ athleteUserId: workoutProgramAssignments.athleteUserId })
      .from(workoutProgramAssignments)
      .where(and(
        eq(workoutProgramAssignments.orgId, orgId),
        eq(workoutProgramAssignments.status, "active"),
      ))
      .limit(200);

    for (const { athleteUserId } of assignments) {
      try {
        await buildAthleteContextObject(athleteUserId, orgId, "daily_cron");
        refreshed++;
      } catch (err: any) {
        console.error(`[ContextBroker] Failed to refresh athleteUserId=${athleteUserId}:`, err.message);
        errors++;
      }
    }
  } catch (err: any) {
    console.error("[ContextBroker] refreshAllActiveAthleteContexts error:", err.message);
    errors++;
  }

  return { refreshed, errors };
}

// ─── Cross-org daily cron ─────────────────────────────────────────────────────

export async function runDailyAthleteContextRefreshCron(): Promise<void> {
  try {
    const orgs = await db.selectDistinct({ orgId: workoutProgramAssignments.orgId })
      .from(workoutProgramAssignments)
      .where(eq(workoutProgramAssignments.status, "active"))
      .limit(500);

    let totalRefreshed = 0;
    let totalErrors = 0;

    for (const { orgId } of orgs) {
      const { refreshed, errors } = await refreshAllActiveAthleteContexts(orgId);
      totalRefreshed += refreshed;
      totalErrors += errors;
    }

    console.log(`[ContextBroker] Daily cron complete — refreshed=${totalRefreshed} errors=${totalErrors}`);
  } catch (err: any) {
    console.error("[ContextBroker] Daily cron error:", err.message);
  }
}
