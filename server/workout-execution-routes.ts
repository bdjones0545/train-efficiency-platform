import type { Express } from "express";
import { isAuthenticated } from "./replit_integrations/auth";
import { db } from "./db";
import {
  workoutReadinessCheckins,
  workoutSessionExerciseLogs,
  workoutAdaptationRecommendations,
  workoutSessions,
  workoutCompletionLogs,
  workoutProgramAssignments,
  workoutPrograms,
  orgMemberships,
  userProfiles,
} from "@shared/schema";
import { eq, and, desc, asc, inArray, gte } from "drizzle-orm";
import { z } from "zod";
import { trainChatClient } from "./services/trainchat-client";

function getUserId(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? null;
}

async function getOrgProfile(req: any) {
  const userId = getUserId(req);
  if (!userId) return null;
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return profile ?? null;
}

function requireAuth(req: any, res: any, next: any) {
  (async () => {
    const profile = await getOrgProfile(req);
    if (!profile) return res.status(401).json({ message: "Unauthorized" });
    (req as any)._profile = profile;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

function requireCoachOrAdmin(req: any, res: any, next: any) {
  (async () => {
    const profile = await getOrgProfile(req);
    if (!profile) return res.status(401).json({ message: "Unauthorized" });
    if (!["ADMIN", "COACH"].includes(profile.role ?? "")) return res.status(403).json({ message: "Coach or Admin required" });
    (req as any)._profile = profile;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

// ─── Adaptation Engine ────────────────────────────────────────────────────────

async function runAdaptationEngine(orgId: string, athleteUserId: string, programId: string, sessionId: string | null, checkin: any, exerciseLogs: any[]) {
  const recs: any[] = [];

  // Average RPE from exercise logs
  const rpeValues = exerciseLogs.map((l: any) => l.rpe).filter((r: any) => typeof r === "number" && r > 0);
  const avgRpe = rpeValues.length > 0 ? rpeValues.reduce((a: number, b: number) => a + b, 0) / rpeValues.length : null;

  // Pain areas present → coach review required
  const painAreas = checkin?.painAreas as any[];
  if (Array.isArray(painAreas) && painAreas.length > 0) {
    recs.push({
      recommendationType: "coach_review",
      severity: "important",
      reason: `Athlete reported pain in ${painAreas.join(", ")}. Coach review required before next session.`,
      suggestedChange: { flag: "pain_reported", areas: painAreas },
      source: "rules",
    });
  }

  // Low readiness → reduce volume
  if (checkin?.readinessScore <= 4) {
    recs.push({
      recommendationType: "reduce_volume",
      severity: "moderate",
      reason: `Readiness score is ${checkin.readinessScore}/10. Consider reducing session volume or intensity.`,
      suggestedChange: { volumeReduction: "20-30%", intensityModifier: "reduce" },
      source: "rules",
    });
  }

  // High soreness → increase recovery
  if (checkin?.sorenessLevel >= 8) {
    recs.push({
      recommendationType: "increase_recovery",
      severity: "important",
      reason: `Soreness level ${checkin.sorenessLevel}/10 is very high. Recommend additional recovery before next session.`,
      suggestedChange: { restDays: 1, mobilityWork: true },
      source: "rules",
    });
  }

  // High fatigue + high RPE → coach review
  if (checkin?.fatigueLevel >= 8 && avgRpe !== null && avgRpe > 7) {
    recs.push({
      recommendationType: "coach_review",
      severity: "important",
      reason: `High fatigue (${checkin.fatigueLevel}/10) combined with high avg RPE (${avgRpe.toFixed(1)}) suggests overreaching risk.`,
      suggestedChange: { flag: "overreaching_risk", fatigueLevel: checkin.fatigueLevel, avgRpe },
      source: "rules",
    });
  }

  // Consistently low RPE → suggest progression
  if (avgRpe !== null && avgRpe <= 4 && exerciseLogs.length >= 2) {
    recs.push({
      recommendationType: "progress_load",
      severity: "info",
      reason: `Average RPE of ${avgRpe.toFixed(1)} is very low. Athlete may be ready for progressive load increase.`,
      suggestedChange: { loadIncrease: "5-10%", note: "Verify form quality before increasing load" },
      source: "rules",
    });
  }

  // Insert only new non-duplicate recs (deduplicate by type within same session)
  for (const rec of recs) {
    const existing = await db.select().from(workoutAdaptationRecommendations).where(
      and(
        eq(workoutAdaptationRecommendations.orgId, orgId),
        eq(workoutAdaptationRecommendations.athleteUserId, athleteUserId),
        eq(workoutAdaptationRecommendations.workoutProgramId, programId),
        eq(workoutAdaptationRecommendations.recommendationType, rec.recommendationType),
        eq(workoutAdaptationRecommendations.status, "pending"),
      )
    ).limit(1);
    if (existing.length === 0) {
      await db.insert(workoutAdaptationRecommendations).values({
        orgId,
        athleteUserId,
        workoutProgramId: programId,
        workoutSessionId: sessionId,
        ...rec,
      });
    }
  }
}

// ─── Missed sessions check (run daily via monitor endpoint) ────────────────────

async function checkMissedSessions(orgId: string, athleteUserId: string, programId: string) {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const allSessions = await db.select().from(workoutSessions).where(
    and(eq(workoutSessions.workoutProgramId, programId), eq(workoutSessions.orgId, orgId))
  );
  const completions = await db.select().from(workoutCompletionLogs).where(
    and(eq(workoutCompletionLogs.workoutProgramId, programId), eq(workoutCompletionLogs.athleteUserId, athleteUserId))
  );
  const completedIds = new Set(completions.map((c) => c.workoutSessionId));
  const missedCount = allSessions.filter((s) => !completedIds.has(s.id)).length;

  if (missedCount >= 2) {
    const existing = await db.select().from(workoutAdaptationRecommendations).where(
      and(
        eq(workoutAdaptationRecommendations.orgId, orgId),
        eq(workoutAdaptationRecommendations.athleteUserId, athleteUserId),
        eq(workoutAdaptationRecommendations.workoutProgramId, programId),
        eq(workoutAdaptationRecommendations.recommendationType, "modify_session"),
        eq(workoutAdaptationRecommendations.status, "pending"),
      )
    ).limit(1);
    if (existing.length === 0) {
      await db.insert(workoutAdaptationRecommendations).values({
        orgId,
        athleteUserId,
        workoutProgramId: programId,
        recommendationType: "modify_session",
        severity: "moderate",
        reason: `Athlete has ${missedCount} incomplete sessions. Consider rescheduling or reducing program density.`,
        suggestedChange: { missedCount, flag: "missed_sessions" },
        source: "rules",
        status: "pending",
      });
    }
  }
}

// ─── Routes ────────────────────────────────────────────────────────────────────

export function registerWorkoutExecutionRoutes(app: Express) {

  // POST /api/org/workout-execution/readiness
  app.post("/api/org/workout-execution/readiness", isAuthenticated, requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const schema = z.object({
        workoutSessionId: z.string().optional(),
        readinessScore: z.number().int().min(1).max(10),
        sleepQuality: z.number().int().min(1).max(10).optional(),
        sorenessLevel: z.number().int().min(1).max(10).optional(),
        fatigueLevel: z.number().int().min(1).max(10).optional(),
        stressLevel: z.number().int().min(1).max(10).optional(),
        motivationLevel: z.number().int().min(1).max(10).optional(),
        painAreas: z.array(z.string()).optional(),
        notes: z.string().optional(),
      });
      const body = schema.parse(req.body);
      const [checkin] = await db.insert(workoutReadinessCheckins).values({
        orgId: profile.organizationId,
        athleteUserId: profile.userId,
        ...body,
      }).returning();
      res.json(checkin);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // GET /api/org/workout-execution/readiness/:athleteUserId
  app.get("/api/org/workout-execution/readiness/:athleteUserId", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { athleteUserId } = req.params;
      const checkins = await db.select().from(workoutReadinessCheckins).where(
        and(eq(workoutReadinessCheckins.orgId, profile.organizationId), eq(workoutReadinessCheckins.athleteUserId, athleteUserId))
      ).orderBy(desc(workoutReadinessCheckins.createdAt)).limit(30);
      res.json(checkins);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/org/workout-execution/exercise-logs
  app.post("/api/org/workout-execution/exercise-logs", isAuthenticated, requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const schema = z.object({
        workoutSessionId: z.string(),
        exerciseName: z.string(),
        prescribedData: z.record(z.any()).optional(),
        completedData: z.record(z.any()).optional(),
        rpe: z.number().int().min(1).max(10).optional(),
        notes: z.string().optional(),
      });
      const body = schema.parse(req.body);
      const [log] = await db.insert(workoutSessionExerciseLogs).values({
        orgId: profile.organizationId,
        athleteUserId: profile.userId,
        ...body,
      }).returning();
      res.json(log);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // GET /api/org/workout-execution/session/:sessionId/logs
  app.get("/api/org/workout-execution/session/:sessionId/logs", isAuthenticated, requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { sessionId } = req.params;
      const isCoach = ["ADMIN", "COACH"].includes(profile.role ?? "");
      const baseWhere = eq(workoutSessionExerciseLogs.workoutSessionId, sessionId);
      const orgWhere = and(baseWhere, eq(workoutSessionExerciseLogs.orgId, profile.organizationId));
      const finalWhere = isCoach ? orgWhere : and(orgWhere, eq(workoutSessionExerciseLogs.athleteUserId, profile.userId));
      const logs = await db.select().from(workoutSessionExerciseLogs).where(finalWhere).orderBy(asc(workoutSessionExerciseLogs.createdAt));
      const readiness = await db.select().from(workoutReadinessCheckins).where(
        and(
          eq(workoutReadinessCheckins.workoutSessionId, sessionId),
          eq(workoutReadinessCheckins.orgId, profile.organizationId),
          ...(isCoach ? [] : [eq(workoutReadinessCheckins.athleteUserId, profile.userId)])
        )
      ).orderBy(desc(workoutReadinessCheckins.createdAt)).limit(1);
      res.json({ exerciseLogs: logs, readiness: readiness[0] ?? null });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/org/workout-execution/session/:sessionId/finish
  app.post("/api/org/workout-execution/session/:sessionId/finish", isAuthenticated, requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { sessionId } = req.params;
      const schema = z.object({
        checkinData: z.object({
          readinessScore: z.number().int().min(1).max(10),
          sleepQuality: z.number().int().min(1).max(10).optional(),
          sorenessLevel: z.number().int().min(1).max(10).optional(),
          fatigueLevel: z.number().int().min(1).max(10).optional(),
          stressLevel: z.number().int().min(1).max(10).optional(),
          motivationLevel: z.number().int().min(1).max(10).optional(),
          painAreas: z.array(z.string()).optional(),
          notes: z.string().optional(),
        }),
        exerciseLogs: z.array(z.object({
          exerciseName: z.string(),
          prescribedData: z.record(z.any()).optional(),
          completedData: z.record(z.any()).optional(),
          rpe: z.number().int().min(1).max(10).optional(),
          notes: z.string().optional(),
        })),
        completionNotes: z.string().optional(),
        completionRating: z.number().int().min(1).max(5).optional(),
      });
      const body = schema.parse(req.body);

      // Fetch session to get programId
      const [session] = await db.select().from(workoutSessions).where(
        and(eq(workoutSessions.id, sessionId), eq(workoutSessions.orgId, profile.organizationId))
      ).limit(1);
      if (!session) return res.status(404).json({ message: "Session not found" });

      // Upsert readiness check-in
      const [checkin] = await db.insert(workoutReadinessCheckins).values({
        orgId: profile.organizationId,
        athleteUserId: profile.userId,
        workoutSessionId: sessionId,
        ...body.checkinData,
      }).returning();

      // Insert exercise logs (replace existing for this session/athlete)
      if (body.exerciseLogs.length > 0) {
        await db.delete(workoutSessionExerciseLogs).where(
          and(
            eq(workoutSessionExerciseLogs.workoutSessionId, sessionId),
            eq(workoutSessionExerciseLogs.athleteUserId, profile.userId)
          )
        );
        await db.insert(workoutSessionExerciseLogs).values(
          body.exerciseLogs.map((l) => ({
            orgId: profile.organizationId,
            workoutSessionId: sessionId,
            athleteUserId: profile.userId,
            ...l,
          }))
        );
      }

      // Mark session complete (upsert)
      const existing = await db.select().from(workoutCompletionLogs).where(
        and(
          eq(workoutCompletionLogs.workoutSessionId, sessionId),
          eq(workoutCompletionLogs.athleteUserId, profile.userId)
        )
      ).limit(1);
      if (existing.length === 0) {
        await db.insert(workoutCompletionLogs).values({
          orgId: profile.organizationId,
          workoutSessionId: sessionId,
          athleteUserId: profile.userId,
          workoutProgramId: session.workoutProgramId,
          notes: body.completionNotes,
          rating: body.completionRating,
          completedAt: new Date(),
        });
      }

      // Run adaptation engine
      await runAdaptationEngine(
        profile.organizationId,
        profile.userId,
        session.workoutProgramId,
        sessionId,
        checkin,
        body.exerciseLogs,
      );

      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // GET /api/org/workout-execution/coach-monitor
  app.get("/api/org/workout-execution/coach-monitor", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // All active assignments in this org
      const assignments = await db.select().from(workoutProgramAssignments).where(
        and(eq(workoutProgramAssignments.orgId, orgId), eq(workoutProgramAssignments.status, "active"))
      );
      const athleteIds = [...new Set(assignments.map((a) => a.athleteUserId).filter(Boolean) as string[])];
      const programIds = [...new Set(assignments.map((a) => a.workoutProgramId))];

      // Today's completions
      const todayCompletions = athleteIds.length > 0 ? await db.select().from(workoutCompletionLogs).where(
        and(
          eq(workoutCompletionLogs.orgId, orgId),
          gte(workoutCompletionLogs.completedAt as any, todayStart),
          inArray(workoutCompletionLogs.athleteUserId, athleteIds)
        )
      ) : [];

      // Recent readiness checkins (last 24h)
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentCheckins = athleteIds.length > 0 ? await db.select().from(workoutReadinessCheckins).where(
        and(
          eq(workoutReadinessCheckins.orgId, orgId),
          gte(workoutReadinessCheckins.createdAt as any, yesterday),
          inArray(workoutReadinessCheckins.athleteUserId, athleteIds)
        )
      ).orderBy(desc(workoutReadinessCheckins.createdAt)) : [];

      // Recent exercise logs (last 24h) for RPE analysis
      const recentExLogs = athleteIds.length > 0 ? await db.select().from(workoutSessionExerciseLogs).where(
        and(
          eq(workoutSessionExerciseLogs.orgId, orgId),
          gte(workoutSessionExerciseLogs.createdAt as any, yesterday),
          inArray(workoutSessionExerciseLogs.athleteUserId, athleteIds)
        )
      ) : [];

      // Athlete profiles
      const athleteProfiles = athleteIds.length > 0 ? await db.select().from(userProfiles).where(
        inArray(userProfiles.userId, athleteIds)
      ) : [];
      const profileMap = Object.fromEntries(athleteProfiles.map((p) => [p.userId, p]));

      // Build athlete status items
      const athleteStatuses = athleteIds.map((athleteId) => {
        const profile = profileMap[athleteId];
        const completedToday = todayCompletions.some((c) => c.athleteUserId === athleteId);
        const checkins = recentCheckins.filter((c) => c.athleteUserId === athleteId);
        const latestCheckin = checkins[0] ?? null;
        const exLogs = recentExLogs.filter((l) => l.athleteUserId === athleteId);
        const rpeValues = exLogs.map((l) => l.rpe).filter((r): r is number => r !== null && r !== undefined);
        const avgRpe = rpeValues.length > 0 ? rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length : null;
        const painAreas = latestCheckin?.painAreas as string[] | null;

        const flags: string[] = [];
        if (latestCheckin && latestCheckin.readinessScore <= 4) flags.push("low_readiness");
        if (latestCheckin && (latestCheckin.sorenessLevel ?? 0) >= 8) flags.push("high_soreness");
        if (latestCheckin && (latestCheckin.fatigueLevel ?? 0) >= 8) flags.push("high_fatigue");
        if (avgRpe !== null && avgRpe >= 8) flags.push("high_rpe");
        if (Array.isArray(painAreas) && painAreas.length > 0) flags.push("pain_reported");
        if (!completedToday && checkins.length > 0) flags.push("incomplete_today");

        return {
          athleteId,
          name: profile ? `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() : athleteId,
          completedToday,
          latestCheckin,
          avgRpe,
          flags,
          programIds: assignments.filter((a) => a.athleteUserId === athleteId).map((a) => a.workoutProgramId),
        };
      });

      // Check for missed sessions (async for all athletes)
      for (const assignment of assignments) {
        if (assignment.athleteUserId) {
          await checkMissedSessions(orgId, assignment.athleteUserId, assignment.workoutProgramId).catch(() => {});
        }
      }

      // Pending recommendations
      const pendingRecs = programIds.length > 0 ? await db.select().from(workoutAdaptationRecommendations).where(
        and(
          eq(workoutAdaptationRecommendations.orgId, orgId),
          eq(workoutAdaptationRecommendations.status, "pending"),
          inArray(workoutAdaptationRecommendations.workoutProgramId, programIds)
        )
      ).orderBy(desc(workoutAdaptationRecommendations.createdAt)).limit(50) : [];

      // Build summary counts
      const summary = {
        totalAthletes: athleteIds.length,
        completedToday: todayCompletions.length > 0 ? new Set(todayCompletions.map((c) => c.athleteUserId)).size : 0,
        lowReadiness: athleteStatuses.filter((a) => a.flags.includes("low_readiness")).length,
        highFatigue: athleteStatuses.filter((a) => a.flags.includes("high_fatigue")).length,
        highSoreness: athleteStatuses.filter((a) => a.flags.includes("high_soreness")).length,
        pendingRecommendations: pendingRecs.length,
        needsReview: pendingRecs.filter((r) => r.severity === "important").length,
      };

      res.json({ summary, athleteStatuses, pendingRecs, profileMap });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/org/workout-execution/recommendations
  app.get("/api/org/workout-execution/recommendations", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { status } = req.query as any;
      const whereClause = and(
        eq(workoutAdaptationRecommendations.orgId, profile.organizationId),
        status ? eq(workoutAdaptationRecommendations.status, status) : undefined
      );
      const recs = await db.select().from(workoutAdaptationRecommendations).where(whereClause)
        .orderBy(desc(workoutAdaptationRecommendations.createdAt)).limit(100);
      res.json(recs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // PATCH /api/org/workout-execution/recommendations/:id
  app.patch("/api/org/workout-execution/recommendations/:id", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { id } = req.params;
      const { status } = z.object({ status: z.enum(["accepted", "dismissed", "pending"]) }).parse(req.body);
      const [rec] = await db.update(workoutAdaptationRecommendations)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(workoutAdaptationRecommendations.id, id), eq(workoutAdaptationRecommendations.orgId, profile.organizationId)))
        .returning();
      if (!rec) return res.status(404).json({ message: "Recommendation not found" });
      res.json(rec);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // POST /api/org/workout-execution/recommendations/:id/trainchat-review
  app.post("/api/org/workout-execution/recommendations/:id/trainchat-review", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { id } = req.params;
      const { coachNotes } = z.object({ coachNotes: z.string().optional() }).parse(req.body);

      const [rec] = await db.select().from(workoutAdaptationRecommendations).where(
        and(eq(workoutAdaptationRecommendations.id, id), eq(workoutAdaptationRecommendations.orgId, profile.organizationId))
      ).limit(1);
      if (!rec) return res.status(404).json({ message: "Recommendation not found" });

      // Fetch session and program context
      const [program] = await db.select().from(workoutPrograms).where(eq(workoutPrograms.id, rec.workoutProgramId)).limit(1);
      let session: any = null;
      if (rec.workoutSessionId) {
        const [s] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, rec.workoutSessionId)).limit(1);
        session = s;
      }

      // Latest readiness
      const [latestCheckin] = await db.select().from(workoutReadinessCheckins).where(
        and(
          eq(workoutReadinessCheckins.orgId, profile.organizationId),
          eq(workoutReadinessCheckins.athleteUserId, rec.athleteUserId),
          ...(rec.workoutSessionId ? [eq(workoutReadinessCheckins.workoutSessionId, rec.workoutSessionId)] : [])
        )
      ).orderBy(desc(workoutReadinessCheckins.createdAt)).limit(1);

      // Recent exercise logs
      const exLogs = rec.workoutSessionId ? await db.select().from(workoutSessionExerciseLogs).where(
        and(
          eq(workoutSessionExerciseLogs.workoutSessionId, rec.workoutSessionId),
          eq(workoutSessionExerciseLogs.athleteUserId, rec.athleteUserId)
        )
      ).limit(20) : [];

      const instruction = [
        `Athlete adaptation review for program: "${program?.title ?? rec.workoutProgramId}".`,
        session ? `Session: ${session.title} (Week ${session.weekNumber}, Day ${session.dayNumber}).` : "",
        latestCheckin ? `Readiness: ${latestCheckin.readinessScore}/10, Sleep: ${latestCheckin.sleepQuality ?? "N/A"}/10, Soreness: ${latestCheckin.sorenessLevel ?? "N/A"}/10, Fatigue: ${latestCheckin.fatigueLevel ?? "N/A"}/10, Stress: ${latestCheckin.stressLevel ?? "N/A"}/10.` : "",
        latestCheckin?.painAreas && Array.isArray(latestCheckin.painAreas) && latestCheckin.painAreas.length > 0 ? `Pain reported in: ${(latestCheckin.painAreas as string[]).join(", ")}.` : "",
        exLogs.length > 0 ? `Exercise logs: ${exLogs.map((l) => `${l.exerciseName} RPE ${l.rpe ?? "N/A"}`).join(", ")}.` : "",
        `Flagged concern: ${rec.reason}`,
        coachNotes ? `Coach notes: ${coachNotes}` : "",
        "Please provide safe, specific modification suggestions for this athlete's next session. Include rationale and any safety considerations. Do not make medical diagnoses.",
      ].filter(Boolean).join(" ");

      const result = await trainChatClient.editProgram(profile.organizationId, rec.workoutProgramId, { instruction });
      res.json({ suggestion: result, context: { rec, latestCheckin, exLogs } });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
