/**
 * Athlete Learning Engine (Phase 2 of PAIL)
 *
 * Continuously learns from athlete behavior and synthesizes persistent memory.
 * Inputs: workout execution, readiness logs, compliance, PRs, coach notes, pain, substitutions.
 * Outputs: updates to athlete_memory_profiles and exercise_effectiveness_scores.
 */

import OpenAI from "openai";
import { db } from "../db";
import {
  eq, and, desc, gte, sql, inArray
} from "drizzle-orm";
import {
  athleteMemoryProfiles,
  exerciseEffectivenessScores,
  workoutCompletionLogs,
  workoutSessionExerciseLogs,
  workoutSetLogs,
  workoutReadinessCheckins,
  workoutSessions,
  prLiftEntries,
  athleteContextObjects,
  athleteRiskFlags,
  orgUsers,
  organizations,
} from "@shared/schema";

const openai = new OpenAI();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LearningResult {
  athleteUserId: string;
  orgId: string;
  sessionsAnalyzed: number;
  exercisesAnalyzed: number;
  patternsFound: string[];
  memoryConfidence: number;
  effectivenessScoresUpdated: number;
}

// ─── Exercise Effectiveness Calculation ──────────────────────────────────────

export async function recalculateExerciseEffectiveness(
  athleteUserId: string,
  orgId: string
): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000);

  // Load exercise logs
  const exerciseLogs = await db.select()
    .from(workoutSessionExerciseLogs)
    .where(and(
      eq(workoutSessionExerciseLogs.orgId, orgId),
      eq(workoutSessionExerciseLogs.athleteUserId, athleteUserId),
      gte(workoutSessionExerciseLogs.createdAt, ninetyDaysAgo),
    ))
    .limit(500)
    .catch(() => []);

  // Load set logs for progression tracking
  const setLogs = await db.select()
    .from(workoutSetLogs)
    .where(and(
      eq(workoutSetLogs.orgId, orgId),
      eq(workoutSetLogs.athleteUserId, athleteUserId),
      gte(workoutSetLogs.loggedAt, ninetyDaysAgo),
    ))
    .limit(1000)
    .catch(() => []);

  // Load readiness check-ins for soreness/pain context
  const readiness = await db.select()
    .from(workoutReadinessCheckins)
    .where(and(
      eq(workoutReadinessCheckins.orgId, orgId),
      eq(workoutReadinessCheckins.athleteUserId, athleteUserId),
      gte(workoutReadinessCheckins.createdAt, ninetyDaysAgo),
    ))
    .limit(120)
    .catch(() => []);

  // Load PRs achieved per exercise (uses userId field, not athleteUserId)
  const prEntries = await db.select()
    .from(prLiftEntries)
    .where(and(
      eq(prLiftEntries.orgId, orgId),
      eq(prLiftEntries.userId, athleteUserId),
    ))
    .limit(200)
    .catch(() => []);

  // Group by exercise name
  const exerciseMap = new Map<string, {
    timesUsed: number;
    timesCompleted: number;
    sessions: Array<{ rpe?: number | null; notes?: string | null }>;
    hasPR: boolean;
    progressionCount: number;
  }>();

  for (const log of exerciseLogs) {
    const name = log.exerciseName;
    if (!name) continue;
    if (!exerciseMap.has(name)) {
      exerciseMap.set(name, { timesUsed: 0, timesCompleted: 0, sessions: [], hasPR: false, progressionCount: 0 });
    }
    const entry = exerciseMap.get(name)!;
    entry.timesUsed++;
    if ((log.completedData as any)?.completed !== false) {
      entry.timesCompleted++;
    }
    entry.sessions.push({ rpe: log.rpe, notes: log.notes });
  }

  // Mark exercises with PRs
  for (const pr of prEntries) {
    const liftType = (pr as any).liftType ?? (pr as any).exerciseName ?? "";
    for (const [name, entry] of exerciseMap.entries()) {
      if (name.toLowerCase().includes(liftType.toLowerCase())) {
        entry.hasPR = true;
      }
    }
  }

  // Simple progression check from set logs
  for (const log of setLogs) {
    const name = log.exerciseName;
    if (!name || !exerciseMap.has(name)) continue;
    const actualLoad = parseFloat(log.actualLoad ?? "0") || 0;
    const prescribedLoad = parseFloat(log.prescribedLoad ?? "0") || 0;
    if (actualLoad > prescribedLoad && prescribedLoad > 0) {
      exerciseMap.get(name)!.progressionCount++;
    }
  }

  let updated = 0;

  for (const [exerciseName, data] of exerciseMap.entries()) {
    if (data.timesUsed < 2) continue; // not enough data

    const completionRate = data.timesUsed > 0
      ? Math.round((data.timesCompleted / data.timesUsed) * 100)
      : 0;

    const prRate = data.hasPR ? 100 : 0;
    const progressionRate = data.timesUsed > 0
      ? Math.round((data.progressionCount / data.timesUsed) * 100)
      : 0;

    // Note counts from notes fields
    const sorenessCount = data.sessions.filter(s =>
      s.notes?.toLowerCase().includes("sore") || s.notes?.toLowerCase().includes("tight")
    ).length;
    const painCount = data.sessions.filter(s =>
      s.notes?.toLowerCase().includes("pain") || s.notes?.toLowerCase().includes("hurt")
    ).length;

    const sorenessRate = data.timesUsed > 0
      ? Math.round((sorenessCount / data.timesUsed) * 100)
      : 0;
    const painRate = data.timesUsed > 0
      ? Math.round((painCount / data.timesUsed) * 100)
      : 0;

    // Effectiveness score formula
    const effectivenessScore = Math.max(0, Math.min(100,
      completionRate * 0.35
      + progressionRate * 0.25
      + prRate * 0.10
      - sorenessRate * 0.10
      - painRate * 0.30
      + 10 // baseline
    ));

    // Upsert effectiveness score
    const [existing] = await db.select({ id: exerciseEffectivenessScores.id })
      .from(exerciseEffectivenessScores)
      .where(and(
        eq(exerciseEffectivenessScores.orgId, orgId),
        eq(exerciseEffectivenessScores.athleteUserId, athleteUserId),
        eq(exerciseEffectivenessScores.exerciseName, exerciseName),
      ))
      .limit(1)
      .catch(() => []);

    if (existing) {
      await db.update(exerciseEffectivenessScores)
        .set({
          timesUsed: data.timesUsed,
          timesCompleted: data.timesCompleted,
          completionRate,
          progressionRate,
          prRate,
          sorenessRate,
          painRate,
          effectivenessScore: Math.round(effectivenessScore),
          lastCalculatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(exerciseEffectivenessScores.id, existing.id))
        .catch(() => {});
    } else {
      await db.insert(exerciseEffectivenessScores)
        .values({
          orgId,
          athleteUserId,
          exerciseName,
          timesUsed: data.timesUsed,
          timesCompleted: data.timesCompleted,
          completionRate,
          progressionRate,
          prRate,
          sorenessRate,
          painRate,
          effectivenessScore: Math.round(effectivenessScore),
        })
        .catch(() => {});
    }

    updated++;
  }

  return updated;
}

// ─── Core Synthesis ───────────────────────────────────────────────────────────

export async function synthesizeAthleteIntelligence(
  athleteUserId: string,
  orgId: string
): Promise<LearningResult> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const patterns: string[] = [];

  // ── Load all athlete data in parallel ─────────────────────────────────────
  const [
    completionLogs,
    readinessLogs,
    exerciseLogs,
    prEntries,
    riskFlags,
    contextObj,
  ] = await Promise.all([
    db.select().from(workoutCompletionLogs)
      .where(and(eq(workoutCompletionLogs.orgId, orgId), eq(workoutCompletionLogs.athleteUserId, athleteUserId), gte(workoutCompletionLogs.createdAt, ninetyDaysAgo)))
      .orderBy(desc(workoutCompletionLogs.createdAt)).limit(90).catch(() => []),
    db.select().from(workoutReadinessCheckins)
      .where(and(eq(workoutReadinessCheckins.orgId, orgId), eq(workoutReadinessCheckins.athleteUserId, athleteUserId), gte(workoutReadinessCheckins.createdAt, ninetyDaysAgo)))
      .orderBy(desc(workoutReadinessCheckins.createdAt)).limit(90).catch(() => []),
    db.select().from(workoutSessionExerciseLogs)
      .where(and(eq(workoutSessionExerciseLogs.orgId, orgId), eq(workoutSessionExerciseLogs.athleteUserId, athleteUserId), gte(workoutSessionExerciseLogs.createdAt, ninetyDaysAgo)))
      .orderBy(desc(workoutSessionExerciseLogs.createdAt)).limit(300).catch(() => []),
    db.select().from(prLiftEntries)
      .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, athleteUserId)))
      .orderBy(desc(prLiftEntries.createdAt)).limit(50).catch(() => []),
    db.select().from(athleteRiskFlags)
      .where(and(eq(athleteRiskFlags.orgId, orgId), eq(athleteRiskFlags.athleteUserId, athleteUserId)))
      .orderBy(desc(athleteRiskFlags.createdAt)).limit(20).catch(() => []),
    db.select().from(athleteContextObjects)
      .where(and(eq(athleteContextObjects.orgId, orgId), eq(athleteContextObjects.athleteUserId, athleteUserId)))
      .limit(1).catch(() => []).then(r => r[0] ?? null),
  ]);

  // Recalculate exercise effectiveness first
  const effectivenessCount = await recalculateExerciseEffectiveness(athleteUserId, orgId);

  // Load top/bottom effectiveness scores
  const topEffective = await db.select()
    .from(exerciseEffectivenessScores)
    .where(and(eq(exerciseEffectivenessScores.orgId, orgId), eq(exerciseEffectivenessScores.athleteUserId, athleteUserId)))
    .orderBy(desc(exerciseEffectivenessScores.effectivenessScore))
    .limit(10)
    .catch(() => []);

  const bottomEffective = await db.select()
    .from(exerciseEffectivenessScores)
    .where(and(eq(exerciseEffectivenessScores.orgId, orgId), eq(exerciseEffectivenessScores.athleteUserId, athleteUserId)))
    .orderBy(exerciseEffectivenessScores.effectivenessScore)
    .limit(10)
    .catch(() => []);

  // ── Rule-based pattern detection ──────────────────────────────────────────

  // Compliance pattern
  const totalSessions = completionLogs.length;
  const recentCompliance = totalSessions > 0
    ? Math.round((completionLogs.filter(l => (l as any).completed !== false).length / totalSessions) * 100)
    : 0;

  if (recentCompliance < 60) {
    patterns.push(`Low compliance: ${recentCompliance}% over last 90 days — program volume or scheduling may be a barrier`);
  }

  // Readiness patterns
  const readinessScores = readinessLogs
    .map(r => (r as any).readinessScore ?? (r as any).score ?? null)
    .filter((s): s is number => typeof s === "number");

  const avgReadiness = readinessScores.length > 0
    ? readinessScores.reduce((a, b) => a + b, 0) / readinessScores.length
    : null;

  // Coach notes from context
  const coachNotesArr = (contextObj?.coachNotes as any[]) ?? [];
  const coachNotesText = coachNotesArr.map((n: any) => n.note ?? n.text ?? n).join("\n");

  // Recurring pain areas from risk flags
  const painFlags = riskFlags.filter(f => (f as any).flagType?.includes("pain") || (f.title ?? "").toLowerCase().includes("pain"));
  const painAreas = painFlags.flatMap(f => (f as any).areas ?? [(f as any).flagType]);

  // ── AI Synthesis via OpenAI ───────────────────────────────────────────────
  let aiSynthesis: any = null;
  try {
    const prompt = `You are an elite strength and conditioning sports scientist analyzing an athlete's training data. 
    
Synthesize persistent athlete intelligence from the following data.

COMPLIANCE: ${totalSessions} sessions tracked, ${recentCompliance}% completion rate (last 90 days)
AVG READINESS: ${avgReadiness?.toFixed(1) ?? "unknown"}/10
RECENT PRs: ${prEntries.length} PRs achieved
RECENT PAIN FLAGS: ${painAreas.length > 0 ? painAreas.join(", ") : "none recorded"}
COACH NOTES: ${coachNotesText || "none"}
RISK FLAGS: ${riskFlags.length > 0 ? riskFlags.map(f => f.title).join("; ") : "none"}
TOP PERFORMING EXERCISES: ${topEffective.slice(0, 5).map(e => `${e.exerciseName} (${e.effectivenessScore}/100)`).join(", ") || "insufficient data"}
LOWEST PERFORMING EXERCISES: ${bottomEffective.slice(0, 5).map(e => `${e.exerciseName} (${e.effectivenessScore}/100)`).join(", ") || "insufficient data"}

Return ONLY a valid JSON object with these exact fields (use null for insufficient data):
{
  "primarySport": string | null,
  "preferredExercises": string[],
  "dislikedExercises": string[],
  "movementRestrictions": string[],
  "recurringCompensations": string[],
  "technicalFocusAreas": string[],
  "coachingCuesThatWork": string[],
  "fatiguePatterns": string | null,
  "recoveryPatterns": string | null,
  "exercisesThatProgressWell": string[],
  "exercisesThatStall": string[],
  "highResponseStimuli": string[],
  "lowResponseStimuli": string[],
  "recurringPainAreas": string[],
  "movementRedFlags": string[],
  "coachNotesSummary": string | null,
  "coachingHistorySummary": string | null,
  "patternsFound": string[]
}`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 1200,
    });

    aiSynthesis = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
    if (Array.isArray(aiSynthesis.patternsFound)) {
      patterns.push(...aiSynthesis.patternsFound);
    }
  } catch (err: any) {
    console.warn("[Athlete Learning] OpenAI synthesis skipped:", err.message);
  }

  // ── Calculate confidence ───────────────────────────────────────────────────
  const memoryConfidence = Math.min(100,
    (totalSessions > 0 ? 20 : 0) +
    (readinessScores.length > 5 ? 15 : 0) +
    (prEntries.length > 0 ? 15 : 0) +
    (effectivenessCount > 2 ? 20 : effectivenessCount > 0 ? 10 : 0) +
    (coachNotesArr.length > 0 ? 15 : 0) +
    (aiSynthesis !== null ? 15 : 0)
  );

  // ── Upsert memory profile ─────────────────────────────────────────────────
  const [existing] = await db.select({ id: athleteMemoryProfiles.id })
    .from(athleteMemoryProfiles)
    .where(and(
      eq(athleteMemoryProfiles.orgId, orgId),
      eq(athleteMemoryProfiles.athleteUserId, athleteUserId),
    ))
    .limit(1)
    .catch(() => []);

  const profileData: Partial<any> = {
    orgId,
    athleteUserId,
    sessionsAnalyzed: totalSessions,
    memoryConfidence,
    lastSynthesizedAt: new Date(),
    updatedAt: new Date(),
    ...(aiSynthesis && {
      primarySport: aiSynthesis.primarySport ?? undefined,
      preferredExercises: aiSynthesis.preferredExercises ?? [],
      dislikedExercises: aiSynthesis.dislikedExercises ?? [],
      movementRestrictions: aiSynthesis.movementRestrictions ?? [],
      recurringCompensations: aiSynthesis.recurringCompensations ?? [],
      technicalFocusAreas: aiSynthesis.technicalFocusAreas ?? [],
      coachingCuesThatWork: aiSynthesis.coachingCuesThatWork ?? [],
      fatiguePatterns: aiSynthesis.fatiguePatterns ?? undefined,
      recoveryPatterns: aiSynthesis.recoveryPatterns ?? undefined,
      exercisesThatProgressWell: aiSynthesis.exercisesThatProgressWell ?? [],
      exercisesThatStall: aiSynthesis.exercisesThatStall ?? [],
      highResponseStimuli: aiSynthesis.highResponseStimuli ?? [],
      lowResponseStimuli: aiSynthesis.lowResponseStimuli ?? [],
      recurringPainAreas: aiSynthesis.recurringPainAreas ?? painAreas,
      movementRedFlags: aiSynthesis.movementRedFlags ?? [],
      coachNotesSummary: aiSynthesis.coachNotesSummary ?? undefined,
      coachingHistorySummary: aiSynthesis.coachingHistorySummary ?? undefined,
    }),
  };

  if (existing) {
    await db.update(athleteMemoryProfiles).set(profileData).where(eq(athleteMemoryProfiles.id, existing.id)).catch(() => {});
  } else {
    await db.insert(athleteMemoryProfiles).values(profileData as any).catch(() => {});
  }

  return {
    athleteUserId,
    orgId,
    sessionsAnalyzed: totalSessions,
    exercisesAnalyzed: effectivenessCount,
    patternsFound: patterns,
    memoryConfidence,
    effectivenessScoresUpdated: effectivenessCount,
  };
}

// ─── Org-level cron ───────────────────────────────────────────────────────────

export async function runAthleteLearningSynthesisForOrg(orgId: string): Promise<{ athletes: number; errors: number }> {
  // Get all athletes with recent activity
  const recentUsers = await db.select({ athleteUserId: workoutCompletionLogs.athleteUserId })
    .from(workoutCompletionLogs)
    .where(and(
      eq(workoutCompletionLogs.orgId, orgId),
      gte(workoutCompletionLogs.createdAt, new Date(Date.now() - 90 * 24 * 3600 * 1000)),
    ))
    .groupBy(workoutCompletionLogs.athleteUserId)
    .limit(50)
    .catch(() => []);

  let athletes = 0, errors = 0;
  for (const { athleteUserId } of recentUsers) {
    try {
      await synthesizeAthleteIntelligence(athleteUserId, orgId);
      athletes++;
    } catch {
      errors++;
    }
  }
  return { athletes, errors };
}
