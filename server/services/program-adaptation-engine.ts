import { db } from "../db";
import {
  programAdaptationDrafts,
  workoutProgramAssignments,
  workoutPrograms,
  type AthleteContextObject,
  type ProgramAdaptationDraft,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { trainChatClient } from "./trainchat-client";
import { summarizeAthleteContextForPrompt } from "./athlete-context-broker";

// ─── Signal definitions ──────────────────────────────────────────────────────

export type AdaptationSignal = {
  signal: string;
  severity: "high" | "medium";
  description: string;
  adaptationType: string;
};

export type ContextChangeResult = {
  hasChanges: boolean;
  signals: AdaptationSignal[];
  recommendedAdaptationType: string;
  rationale: string;
};

// ─── Context change detection ────────────────────────────────────────────────

export function detectContextChanges(
  previousContext: AthleteContextObject | null,
  newContext: AthleteContextObject
): ContextChangeResult {
  const signals: AdaptationSignal[] = [];

  const prev = previousContext;
  const curr = newContext;

  // Signal 1: Readiness drops to "low" (from anything else)
  if (curr.readinessTrend === "low" && prev?.readinessTrend !== "low") {
    signals.push({
      signal: "readiness_dropped_to_low",
      severity: "high",
      description: "Athlete readiness trend has dropped to low. Sustained low readiness indicates systemic fatigue or overreaching.",
      adaptationType: "recovery_emphasis",
    });
  }

  // Signal 2: Compliance drops below 50% (from above 50%)
  const prevCompliance = prev?.complianceRate ?? 100;
  const currCompliance = curr.complianceRate ?? 100;
  if (currCompliance < 50 && prevCompliance >= 50) {
    signals.push({
      signal: "compliance_critical",
      severity: "high",
      description: `Session compliance dropped to ${currCompliance}% (was ${prevCompliance}%). Program complexity or volume may be a barrier.`,
      adaptationType: "program_simplification",
    });
  }

  // Signal 3: Compliance drops below 70% (from above 70%) — medium severity
  if (currCompliance < 70 && prevCompliance >= 70 && currCompliance >= 50) {
    signals.push({
      signal: "compliance_declining",
      severity: "medium",
      description: `Session compliance has declined to ${currCompliance}%. Early warning — may need load or complexity reduction.`,
      adaptationType: "load_reduction",
    });
  }

  // Signal 4: Risk level escalates to red (from not-red)
  if (curr.riskLevel === "red" && prev?.riskLevel !== "red") {
    signals.push({
      signal: "risk_escalated_to_red",
      severity: "high",
      description: "Athlete risk level has escalated to high. Multiple indicators suggest an intervention or program modification is needed.",
      adaptationType: "comprehensive_review",
    });
  }

  // Signal 5: New injury notes appeared
  const prevInjuries = (prev?.injuryNotes as any[]) ?? [];
  const currInjuries = (curr.injuryNotes as any[]) ?? [];
  if (currInjuries.length > prevInjuries.length) {
    const newInjuryCount = currInjuries.length - prevInjuries.length;
    const recentAreas = currInjuries.slice(0, newInjuryCount).flatMap((i: any) => i.areas ?? []);
    signals.push({
      signal: "new_pain_reported",
      severity: "high",
      description: `New pain/injury report detected${recentAreas.length > 0 ? `: ${recentAreas.join(", ")}` : ""}. Program should be modified to protect these areas.`,
      adaptationType: "injury_modification",
    });
  }

  // Signal 6: RPE trend spikes (infer from recentRPETrend data)
  const currRpeTrend = (curr.recentRPETrend as any[]) ?? [];
  const prevRpeTrend = (prev?.recentRPETrend as any[]) ?? [];
  const currRpeValues = currRpeTrend.map((r: any) => r.rpe).filter((r: any) => typeof r === "number");
  const prevRpeValues = prevRpeTrend.map((r: any) => r.rpe).filter((r: any) => typeof r === "number");
  const currRpeAvg = currRpeValues.length > 0 ? currRpeValues.reduce((a: number, b: number) => a + b, 0) / currRpeValues.length : null;
  const prevRpeAvg = prevRpeValues.length > 0 ? prevRpeValues.reduce((a: number, b: number) => a + b, 0) / prevRpeValues.length : null;

  if (currRpeAvg !== null && currRpeAvg >= 8.5 && (prevRpeAvg === null || prevRpeAvg < 8.5)) {
    signals.push({
      signal: "rpe_spiked_high",
      severity: "high",
      description: `Average RPE has spiked to ${currRpeAvg.toFixed(1)}/10. Athlete is working at near-maximal effort — deload or load reduction needed.`,
      adaptationType: "deload",
    });
  }

  if (signals.length === 0) {
    return { hasChanges: false, signals: [], recommendedAdaptationType: "", rationale: "" };
  }

  // Determine primary adaptation type (highest severity first, then specificity)
  const priorityOrder = ["deload", "injury_modification", "recovery_emphasis", "program_simplification", "comprehensive_review", "load_reduction"];
  const signalTypes = signals.map((s) => s.adaptationType);
  const recommendedAdaptationType = priorityOrder.find((t) => signalTypes.includes(t)) ?? signalTypes[0];

  const rationale = signals.map((s) => s.description).join(" ");

  return { hasChanges: true, signals, recommendedAdaptationType, rationale };
}

// ─── Adaptation type label map ────────────────────────────────────────────────

const ADAPTATION_LABELS: Record<string, string> = {
  deload: "Deload Week",
  injury_modification: "Injury Modification",
  recovery_emphasis: "Recovery Emphasis",
  program_simplification: "Program Simplification",
  comprehensive_review: "Comprehensive Program Review",
  load_reduction: "Load Reduction",
};

function buildAdaptationInstructions(adaptationType: string, signals: AdaptationSignal[]): string {
  const lines: string[] = [`Generate a program adaptation draft. Adaptation type: ${ADAPTATION_LABELS[adaptationType] ?? adaptationType}.`, ""];
  lines.push("Triggered by the following athlete signals:");
  for (const s of signals) {
    lines.push(`- ${s.description}`);
  }
  lines.push("");

  if (adaptationType === "deload") {
    lines.push("Instructions: Generate a 1-week deload program. Reduce all loads to 50-65% of normal. Keep movement patterns but eliminate high-intensity sets. Focus on recovery, technique, and movement quality.");
  } else if (adaptationType === "injury_modification") {
    const injurySignal = signals.find((s) => s.signal === "new_pain_reported");
    lines.push(`Instructions: Modify the program to remove or regress all exercises that stress the affected areas. Provide alternative movements that maintain training stimulus without aggravating the reported pain areas.`);
  } else if (adaptationType === "recovery_emphasis") {
    lines.push("Instructions: Rebuild the next training block with 25-35% reduced total volume. Emphasize tempo, controlled eccentrics, and movement quality over load. Limit intensity above 80% 1RM. Add additional recovery days if the schedule allows.");
  } else if (adaptationType === "program_simplification") {
    lines.push("Instructions: Simplify the program structure. Reduce the number of exercises per session to 4-5 key movements. Use straightforward set/rep schemes. Minimize technical complexity. Make each session completable in under 50 minutes.");
  } else if (adaptationType === "load_reduction") {
    lines.push("Instructions: Reduce overall training load by 15-20%. Maintain the program structure but decrease volume or intensity. Make sessions more approachable without sacrificing the training goal.");
  } else {
    lines.push("Instructions: Generate a comprehensive program review that addresses all flagged risk signals. Prioritize athlete safety and sustainable progression.");
  }

  lines.push("");
  lines.push("IMPORTANT: This is a DRAFT for coach review. Do not finalize. Generate the best possible adaptation based on available context.");

  return lines.join("\n");
}

// ─── Parse sessions from TrainChat response ───────────────────────────────────

function parseSessionsFromResponse(rawResponse: any): any[] {
  const weeks: any[] = rawResponse?.weeks ?? rawResponse?.program?.weeks ?? [];
  if (!Array.isArray(weeks) || weeks.length === 0) return [];
  const sessions: any[] = [];
  for (const week of weeks) {
    const weekNum = week.weekNumber ?? week.week ?? 0;
    const days: any[] = week.days ?? week.sessions ?? [];
    for (const day of days) {
      sessions.push({
        weekNumber: weekNum,
        dayNumber: day.dayNumber ?? day.day ?? 0,
        title: day.title ?? `Week ${weekNum} Day ${day.dayNumber ?? day.day ?? 0}`,
        focus: day.focus ?? day.theme ?? null,
        sessionData: day,
      });
    }
  }
  return sessions;
}

// ─── Check if a similar pending draft already exists ─────────────────────────

async function hasRecentPendingDraft(
  athleteUserId: string,
  orgId: string,
  adaptationType: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
  const [existing] = await db.select({ id: programAdaptationDrafts.id })
    .from(programAdaptationDrafts)
    .where(and(
      eq(programAdaptationDrafts.athleteUserId, athleteUserId),
      eq(programAdaptationDrafts.orgId, orgId),
      eq(programAdaptationDrafts.adaptationType, adaptationType),
      eq(programAdaptationDrafts.status, "pending_review"),
    ))
    .limit(1);
  return !!existing;
}

// ─── Core draft generator ────────────────────────────────────────────────────

export async function generateAdaptationDraft(
  athleteUserId: string,
  orgId: string,
  signals: AdaptationSignal[],
  adaptationType: string,
  rationale: string,
  newContext: AthleteContextObject,
  previousContext: AthleteContextObject | null
): Promise<ProgramAdaptationDraft> {

  // Find current active program for this athlete
  const [activeAssignment] = await db.select({
    programId: workoutProgramAssignments.workoutProgramId,
    programTitle: workoutPrograms.title,
    programGoal: workoutPrograms.goal,
    durationWeeks: workoutPrograms.durationWeeks,
    daysPerWeek: workoutPrograms.daysPerWeek,
    sport: workoutPrograms.sport,
  })
    .from(workoutProgramAssignments)
    .innerJoin(workoutPrograms, eq(workoutProgramAssignments.workoutProgramId, workoutPrograms.id))
    .where(and(
      eq(workoutProgramAssignments.orgId, orgId),
      eq(workoutProgramAssignments.athleteUserId, athleteUserId),
      eq(workoutProgramAssignments.status, "active"),
    ))
    .orderBy(desc(workoutProgramAssignments.assignedAt))
    .limit(1);

  // Build payload for TrainChat
  const athleteIntelligence = summarizeAthleteContextForPrompt(newContext);
  const adaptationInstructions = buildAdaptationInstructions(adaptationType, signals);

  const tcParams = {
    targetType: "athlete",
    athleteUserIds: [athleteUserId],
    goal: activeAssignment?.programGoal ?? "general_performance",
    sport: activeAssignment?.sport ?? undefined,
    durationWeeks: adaptationType === "deload" ? 1 : Math.min(activeAssignment?.durationWeeks ?? 4, 4),
    daysPerWeek: activeAssignment?.daysPerWeek ?? 3,
    athleteIntelligence,
    contextualInstructions: adaptationInstructions,
    adaptationDraftMode: true,
    adaptationType,
    triggerSignals: signals.map((s) => s.signal),
    readinessTrend: newContext.readinessTrend,
    complianceRate: newContext.complianceRate,
  };

  let rawResponse: any = null;
  let trainChatProgramId: string | null = null;
  let draftSessions: any[] = [];
  let generationError: string | null = null;

  try {
    const result = await trainChatClient.generateProgram(orgId, tcParams);
    rawResponse = result.data;
    if (rawResponse) {
      trainChatProgramId = rawResponse.id ?? rawResponse.programId ?? null;
      draftSessions = parseSessionsFromResponse(rawResponse);
    }
  } catch (err: any) {
    console.error("[AdaptationEngine] TrainChat draft generation failed:", err.message);
    generationError = err.message ?? "TrainChat generation failed";
  }

  // Store the draft — never publish, always pending_review
  const [draft] = await db.insert(programAdaptationDrafts).values({
    orgId,
    athleteUserId,
    workoutProgramId: activeAssignment?.programId ?? null,
    contextObjectId: newContext.id,
    triggerSignals: signals.map((s) => ({ signal: s.signal, severity: s.severity, description: s.description })),
    adaptationType,
    previousContextSnapshot: previousContext ? {
      readinessTrend: previousContext.readinessTrend,
      complianceRate: previousContext.complianceRate,
      riskLevel: previousContext.riskLevel,
      injuryNotesCount: (previousContext.injuryNotes as any[])?.length ?? 0,
    } : null,
    newContextSnapshot: {
      readinessTrend: newContext.readinessTrend,
      complianceRate: newContext.complianceRate,
      riskLevel: newContext.riskLevel,
      injuryNotesCount: (newContext.injuryNotes as any[])?.length ?? 0,
      aiSummary: newContext.aiSummary,
    },
    trainChatProgramId,
    trainChatRawResponse: rawResponse,
    draftSessions,
    adaptationRationale: rationale,
    status: "pending_review",
    generationError,
  }).returning();

  console.log(`[AdaptationEngine] Draft created id=${draft.id} type=${adaptationType} athlete=${athleteUserId} signals=${signals.map((s) => s.signal).join(",")}`);

  return draft;
}

// ─── Main entry point: check context and generate draft if needed ─────────────

export async function checkAndGenerateAdaptationDraft(
  previousContext: AthleteContextObject | null,
  newContext: AthleteContextObject
): Promise<ProgramAdaptationDraft | null> {
  const { hasChanges, signals, recommendedAdaptationType, rationale } = detectContextChanges(previousContext, newContext);

  if (!hasChanges) return null;

  // Only fire on high-severity signals (avoid noise)
  const highSignals = signals.filter((s) => s.severity === "high");
  if (highSignals.length === 0) return null;

  // De-duplicate: if a pending draft of the same type already exists from last 24h, skip
  const alreadyPending = await hasRecentPendingDraft(
    newContext.athleteUserId,
    newContext.orgId,
    recommendedAdaptationType
  );
  if (alreadyPending) {
    console.log(`[AdaptationEngine] Skipping — pending draft of type=${recommendedAdaptationType} already exists for athlete=${newContext.athleteUserId}`);
    return null;
  }

  return generateAdaptationDraft(
    newContext.athleteUserId,
    newContext.orgId,
    highSignals,
    recommendedAdaptationType,
    rationale,
    newContext,
    previousContext
  );
}
