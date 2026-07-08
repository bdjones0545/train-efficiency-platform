/**
 * Athlete Handoff Service — Phase 7
 * ──────────────────────────────────
 * Detects real program assignment and session booking/completion for onboarding athletes.
 * Used by: GET /api/admin/athlete-onboarding (batch sync), POST /sync, CEO Heartbeat.
 *
 * Tables used:
 *   workout_program_assignments  — programAssigned
 *   bookings                     — firstSessionScheduled + firstSessionCompleted
 *   workout_completion_logs      — firstSessionCompleted (alternate signal)
 *   session_attendance (raw SQL) — Phase 2 scheduling attendance
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReadinessState =
  | "needs_program"
  | "needs_first_session"
  | "ready_to_train"
  | "actively_training";

export interface RealDataState {
  programAssigned: boolean;
  firstSessionScheduled: boolean;
  firstSessionCompleted: boolean;
}

export interface OrgProgram {
  id: string;
  title: string;
  goal: string;
  sport: string | null;
}

export interface ProgramRecommendation {
  recommendedProgramId?: string;
  recommendedProgramName?: string;
  reason: string;
  confidence: number;
  actionUrl: string;
  actionLabel: string;
}

// ─── Readiness state ──────────────────────────────────────────────────────────

export function calcReadinessState(
  programAssigned: boolean,
  firstSessionScheduled: boolean,
  firstSessionCompleted: boolean
): ReadinessState {
  if (firstSessionCompleted) return "actively_training";
  if (programAssigned && firstSessionScheduled) return "ready_to_train";
  if (programAssigned && !firstSessionScheduled) return "needs_first_session";
  return "needs_program";
}

// ─── Batch sync from real data ────────────────────────────────────────────────

/**
 * One org, N athletes — returns real program/session states.
 * Uses batch queries (not N+1). Fails open on any table.
 */
export async function batchSyncFromRealData(
  orgId: string,
  athleteUserIds: string[]
): Promise<Map<string, RealDataState>> {
  const result = new Map<string, RealDataState>();
  const validIds = athleteUserIds.filter(Boolean);
  if (validIds.length === 0) return result;

  for (const id of validIds) {
    result.set(id, { programAssigned: false, firstSessionScheduled: false, firstSessionCompleted: false });
  }

  try {
    const { db } = await import("../db");
    const { workoutProgramAssignments, bookings, workoutCompletionLogs } = await import("@shared/schema");
    const { eq, and, sql } = await import("drizzle-orm");

    const idArraySql = sql.join(validIds.map(id => sql`${id}`), sql`, `);

    // 1 — Active program assignments
    try {
      const rows = await db.select({ athleteUserId: workoutProgramAssignments.athleteUserId })
        .from(workoutProgramAssignments)
        .where(and(
          eq(workoutProgramAssignments.orgId, orgId),
          sql`${workoutProgramAssignments.athleteUserId} = ANY(ARRAY[${idArraySql}]::text[])`,
          eq(workoutProgramAssignments.status, "active")
        ));
      for (const r of rows) {
        if (r.athleteUserId && result.has(r.athleteUserId)) {
          result.get(r.athleteUserId)!.programAssigned = true;
        }
      }
    } catch {}

    // 2 — Scheduled sessions (any non-cancelled booking where athlete is client)
    try {
      const rows = await db.select({ clientId: bookings.clientId })
        .from(bookings)
        .where(and(
          eq(bookings.organizationId, orgId),
          sql`${bookings.clientId} = ANY(ARRAY[${idArraySql}]::text[])`,
          sql`${bookings.status} != 'CANCELLED'`
        ));
      for (const r of rows) {
        if (r.clientId && result.has(r.clientId)) {
          result.get(r.clientId)!.firstSessionScheduled = true;
        }
      }
    } catch {}

    // 3 — Completed bookings
    try {
      const rows = await db.select({ clientId: bookings.clientId })
        .from(bookings)
        .where(and(
          eq(bookings.organizationId, orgId),
          sql`${bookings.clientId} = ANY(ARRAY[${idArraySql}]::text[])`,
          sql`${bookings.status} = 'COMPLETED'`
        ));
      for (const r of rows) {
        if (r.clientId && result.has(r.clientId)) {
          result.get(r.clientId)!.firstSessionCompleted = true;
          result.get(r.clientId)!.firstSessionScheduled = true;
        }
      }
    } catch {}

    // 4 — Workout completion logs (athlete used the TrainChat workout system)
    try {
      const rows = await db.select({ athleteUserId: workoutCompletionLogs.athleteUserId })
        .from(workoutCompletionLogs)
        .where(and(
          eq(workoutCompletionLogs.orgId, orgId),
          sql`${workoutCompletionLogs.athleteUserId} = ANY(ARRAY[${idArraySql}]::text[])`
        ));
      for (const r of rows) {
        if (r.athleteUserId && result.has(r.athleteUserId)) {
          result.get(r.athleteUserId)!.firstSessionCompleted = true;
          result.get(r.athleteUserId)!.firstSessionScheduled = true;
        }
      }
    } catch {}

    // 5 — Phase 2 session_attendance (raw SQL — table may not exist yet)
    try {
      const { db: rawDb } = await import("../db");
      const attendanceRows = await rawDb.execute(sql`
        SELECT user_id, status
        FROM session_attendance
        WHERE organization_id = ${orgId}
          AND user_id = ANY(ARRAY[${idArraySql}]::text[])
      `);
      const rows = Array.isArray(attendanceRows) ? attendanceRows : (attendanceRows as any).rows ?? [];
      for (const row of rows) {
        const uid = (row as any).user_id;
        if (uid && result.has(uid)) {
          result.get(uid)!.firstSessionScheduled = true;
          const st = ((row as any).status || "").toLowerCase();
          if (st === "attended" || st === "present" || st === "completed") {
            result.get(uid)!.firstSessionCompleted = true;
          }
        }
      }
    } catch {}
  } catch (err: any) {
    console.warn("[HandoffService] batchSyncFromRealData error:", err.message);
  }

  return result;
}

// ─── Org program library ──────────────────────────────────────────────────────

export async function getOrgPrograms(orgId: string): Promise<OrgProgram[]> {
  try {
    const { db } = await import("../db");
    const { workoutPrograms } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");

    return await db.select({
      id: workoutPrograms.id,
      title: workoutPrograms.title,
      goal: workoutPrograms.goal,
      sport: workoutPrograms.sport,
    })
    .from(workoutPrograms)
    .where(and(
      eq(workoutPrograms.orgId, orgId),
      eq(workoutPrograms.status, "active")
    ))
    .limit(30);
  } catch {
    return [];
  }
}

// ─── Deterministic program recommendation ─────────────────────────────────────

export function recommendFirstProgramFromIntake(
  sport: string | null,
  goals: string[],
  experienceLevel: string | null,
  currentTrainingStatus: string | null,
  grade: string | null,
  orgPrograms: OrgProgram[]
): ProgramRecommendation {
  const sportL = (sport || "").toLowerCase().trim();
  const goalsText = (Array.isArray(goals) ? goals : []).map(g => g.toLowerCase()).join(" ");
  const expL = (experienceLevel || "").toLowerCase();
  const statusL = (currentTrainingStatus || "").toLowerCase();

  // Classify the athlete
  const isBeginner = expL.includes("beginner") || expL.includes("novice") || expL.includes("new") ||
    statusL.includes("not currently") || statusL.includes("first time");
  const isAdvanced = expL.includes("advanced") || expL.includes("elite") || expL.includes("varsity") ||
    expL.includes("college") || expL.includes("d1") || expL.includes("division");

  const isSpeedFocus = goalsText.includes("speed") || goalsText.includes("agility") ||
    goalsText.includes("quick") || goalsText.includes("explosive") ||
    goalsText.includes("vertical") || goalsText.includes("sprint");
  const isStrengthFocus = goalsText.includes("strength") || goalsText.includes("power") ||
    goalsText.includes("muscle") || goalsText.includes("lift") ||
    goalsText.includes("squat") || goalsText.includes("bench");

  const isTeamSport = ["football", "basketball", "baseball", "softball", "hockey",
    "lacrosse", "soccer", "volleyball", "rugby", "wrestling", "tennis",
    "swim", "track", "field"].some(s => sportL.includes(s));

  // Try to match against org program library
  if (orgPrograms.length > 0) {
    let bestId = "";
    let bestTitle = "";
    let bestScore = 0;
    let bestReasons: string[] = [];

    for (const p of orgPrograms) {
      const pSport = (p.sport || "").toLowerCase();
      const pGoal = (p.goal || "").toLowerCase();
      const pTitle = (p.title || "").toLowerCase();
      let score = 0;
      const reasons: string[] = [];

      // Sport match: exact = 40, partial = 20
      if (sportL && pSport && pSport === sportL) {
        score += 40; reasons.push(`${sport} match`);
      } else if (sportL && (pTitle.includes(sportL) || pGoal.includes(sportL))) {
        score += 20; reasons.push(`${sport} related`);
      }

      // Goal focus matches
      if (isSpeedFocus && (pGoal.includes("speed") || pGoal.includes("agility") ||
          pTitle.includes("speed") || pTitle.includes("agility"))) {
        score += 30; reasons.push("speed/agility");
      }
      if (isStrengthFocus && (pGoal.includes("strength") || pGoal.includes("power") ||
          pTitle.includes("strength") || pTitle.includes("power"))) {
        score += 30; reasons.push("strength/power");
      }

      // Experience level match
      if (isBeginner && (pTitle.includes("beginner") || pTitle.includes("foundation") ||
          pTitle.includes("introduct") || pGoal.includes("foundation"))) {
        score += 20; reasons.push("beginner");
      }
      if (isAdvanced && (pTitle.includes("advanced") || pTitle.includes("elite") ||
          pTitle.includes("performance") || pGoal.includes("performance"))) {
        score += 20; reasons.push("advanced");
      }

      if (score > bestScore) {
        bestScore = score;
        bestId = p.id;
        bestTitle = p.title;
        bestReasons = reasons;
      }
    }

    if (bestScore >= 20) {
      const confidence = Math.min(92, Math.round((bestScore / 80) * 100));
      const reasonParts = [sport, ...bestReasons].filter(Boolean).join(" · ");
      return {
        recommendedProgramId: bestId,
        recommendedProgramName: bestTitle,
        reason: `Best program match${reasonParts ? ` — ${reasonParts}` : ""}`,
        confidence,
        actionUrl: "/admin/athlete-intelligence",
        actionLabel: "Assign Program",
      };
    }

    // Library has programs but no clear match
    return {
      recommendedProgramId: orgPrograms[0].id,
      recommendedProgramName: orgPrograms[0].title,
      reason: "No exact match — review available programs and assign best fit",
      confidence: 30,
      actionUrl: "/admin/athlete-intelligence",
      actionLabel: "Review & Assign",
    };
  }

  // No programs in library — generate a descriptive profile recommendation
  const typeLabel = isSpeedFocus ? "Speed & Agility"
    : isStrengthFocus ? "Strength & Power"
    : isTeamSport ? "Sport Performance"
    : "General Athletic Development";

  const levelLabel = isBeginner ? "Foundation"
    : isAdvanced ? "Advanced"
    : "Intermediate";

  const sportLabel = sport ? ` — ${sport}` : "";
  const confidence = (isBeginner || isAdvanced || isSpeedFocus || isStrengthFocus) ? 68 : 48;

  return {
    reason: `${levelLabel} ${typeLabel} program recommended${sportLabel}`,
    confidence,
    actionUrl: "/admin/athlete-intelligence",
    actionLabel: "Build Program",
  };
}

// ─── Single-athlete helpers (used in alerts service + tests) ──────────────────

export async function hasAssignedProgram(orgId: string, athleteUserId: string): Promise<boolean> {
  const map = await batchSyncFromRealData(orgId, [athleteUserId]);
  return map.get(athleteUserId)?.programAssigned ?? false;
}

export async function hasFirstSessionScheduled(orgId: string, athleteUserId: string): Promise<boolean> {
  const map = await batchSyncFromRealData(orgId, [athleteUserId]);
  return map.get(athleteUserId)?.firstSessionScheduled ?? false;
}

export async function hasFirstSessionCompleted(orgId: string, athleteUserId: string): Promise<boolean> {
  const map = await batchSyncFromRealData(orgId, [athleteUserId]);
  return map.get(athleteUserId)?.firstSessionCompleted ?? false;
}
