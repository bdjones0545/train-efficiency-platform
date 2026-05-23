import type { Express } from "express";
import crypto from "crypto";
import { db } from "./db";
import {
  workoutPrograms,
  workoutProgramAssignments,
  workoutSessions,
  workoutCompletionLogs,
  workoutGenerationMetadata,
  athleteContextObjects,
  orgAiIntegrations,
  athleticPrograms,
  organizations,
  prTeams,
  prTeamMembers,
  prLiftEntries,
  prLiftTypes,
  orgSessions,
  orgUsers,
  orgMemberships,
  coachProfiles,
  userProfiles,
  users,
} from "@shared/schema";
import { eq, and, desc, asc, inArray, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { trainChatClient, getConnectionStatus } from "./services/trainchat-client";
import { triggerNotificationEvent } from "./services/notification-automation";
import { createActivityEvent } from "./services/activity-timeline";
import {
  getAthleteContextForAI,
  refreshAthleteContextObject,
  summarizeAthleteContextForPrompt,
  computeTrainChatModifiers,
} from "./services/athlete-context-broker";

// ── Shared helper: resolve org identity for a known main-app userId ───────────
// Mirrors resolveMainAppUser from PR Tracker for consistent auth bridging.
async function resolveWbMainUser(req: any, res: any, next: any, mainUserId: string): Promise<void> {
  const [coachRow] = await db.select().from(coachProfiles).where(eq(coachProfiles.userId, mainUserId)).limit(1);
  const [profileRow] = await db.select().from(userProfiles).where(eq(userProfiles.userId, mainUserId)).limit(1);

  const userOrgId: string | null = coachRow?.organizationId ?? profileRow?.organizationId ?? null;
  if (!userOrgId) {
    res.status(403).json({ message: "No organization associated with this account" });
    return;
  }

  const profileRole = profileRow?.role ?? null;
  const isAdminRole = ["ADMIN", "STAFF"].includes(profileRole ?? "");
  const isCoachRole = !isAdminRole && !!coachRow?.organizationId;
  const effectiveRole: string = isAdminRole ? "admin" : isCoachRole ? "coach" : "athlete";

  const [mainUser] = await db.select().from(users).where(eq(users.id, mainUserId)).limit(1);

  req.orgUser = {
    id: mainUserId,
    name: `${mainUser?.firstName ?? ""} ${mainUser?.lastName ?? ""}`.trim(),
    email: coachRow?.email ?? mainUser?.email ?? "",
  };
  req.orgSession = { orgId: userOrgId };
  req.orgMembership = { role: effectiveRole };
  req.authMode = "admin_session";
  next();
}

// ── 3-path auth middleware (mirrors requireOrgAuth from PR Tracker) ────────────
// Path 1 : Replit OIDC session cookie  (req.user set by passport)
// Path 1b: Authorization: Bearer token (email/password coach login)
// Path 2 : x-org-auth-token header     (athlete / org-member token)
async function acceptOrgOrMainAuth(req: any, res: any, next: any) {
  try {
    // Path 1: OIDC session cookie
    if (req.user) {
      const mainUserId: string = req.user?.claims?.sub ?? req.user?.id;
      await resolveWbMainUser(req, res, next, mainUserId);
      return;
    }

    // Path 1b: Bearer token (email/password login stored in localStorage)
    const authHeader = req.headers.authorization as string | undefined;
    if (authHeader?.startsWith("Bearer ")) {
      const bearerToken = authHeader.slice(7);
      try {
        const tokenResult = await db.execute(
          sql`SELECT user_id FROM auth_tokens WHERE token = ${bearerToken} AND expires_at > NOW() LIMIT 1`
        );
        if (tokenResult.rows.length) {
          const mainUserId = (tokenResult.rows[0] as any).user_id as string;
          await resolveWbMainUser(req, res, next, mainUserId);
          return;
        }
      } catch (err: any) {
        console.error("[workout-builder] Bearer token lookup error:", err.message);
      }
    }

    // Path 2: x-org-auth-token (athlete / org-member token from OrgAuthModal)
    const token = req.headers["x-org-auth-token"] as string | undefined;
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const now = new Date();

      const [session] = await db
        .select()
        .from(orgSessions)
        .where(and(eq(orgSessions.tokenHash, tokenHash), gt(orgSessions.expiresAt, now)))
        .limit(1);

      if (session) {
        await db.update(orgSessions).set({ lastUsedAt: now } as any).where(eq(orgSessions.id, session.id));

        const [orgUser] = await db.select().from(orgUsers).where(eq(orgUsers.id, session.userId)).limit(1);
        if (!orgUser) return res.status(401).json({ message: "User not found" });

        const [membership] = await db
          .select()
          .from(orgMemberships)
          .where(and(eq(orgMemberships.userId, session.userId), eq(orgMemberships.orgId, session.orgId)))
          .limit(1);

        req.orgUser = orgUser;
        req.orgSession = session;
        req.orgMembership = membership ?? null;
        req.authMode = "org_token";
        return next();
      }
    }

    return res.status(401).json({ message: "Not authenticated" });
  } catch (err) {
    console.error("[workout-builder] acceptOrgOrMainAuth error:", err);
    res.status(500).json({ message: "Auth error" });
  }
}

// ── Profile resolver (uses data already set by acceptOrgOrMainAuth) ───────────
function getOrgProfile(req: any) {
  if (!req.orgUser || !req.orgSession) return null;

  const ORG_ROLE_MAP: Record<string, string> = {
    coach: "COACH", admin: "ADMIN", owner: "ADMIN", staff: "STAFF",
    athlete: "CLIENT", guardian: "guardian", team_coach: "team_coach",
  };

  const memberRole = req.orgMembership?.role ?? "athlete";
  return {
    userId: req.orgUser.id,
    role: ORG_ROLE_MAP[memberRole] ?? memberRole,
    organizationId: req.orgSession.orgId,
  };
}

function requireCoachOrAdmin(req: any, res: any, next: any) {
  const profile = getOrgProfile(req);
  if (!profile) return res.status(401).json({ message: "Unauthorized" });
  if (!["ADMIN", "COACH"].includes(profile.role ?? "")) {
    return res.status(403).json({ message: "Coach or Admin required" });
  }
  (req as any)._profile = profile;
  next();
}

function requireAuth(req: any, res: any, next: any) {
  const profile = getOrgProfile(req);
  if (!profile) return res.status(401).json({ message: "Unauthorized" });
  (req as any)._profile = profile;
  next();
}

async function parseAndStoreSessions(orgId: string, programId: string, rawResponse: any): Promise<void> {
  const weeks: any[] = rawResponse?.weeks ?? rawResponse?.program?.weeks ?? [];
  if (!Array.isArray(weeks) || weeks.length === 0) return;
  const sessionRows: any[] = [];
  for (const week of weeks) {
    const weekNum = week.weekNumber ?? week.week ?? 0;
    const days: any[] = week.days ?? week.sessions ?? [];
    for (const day of days) {
      const dayNum = day.dayNumber ?? day.day ?? 0;
      sessionRows.push({
        orgId,
        workoutProgramId: programId,
        weekNumber: weekNum,
        dayNumber: dayNum,
        title: day.title ?? `Week ${weekNum} Day ${dayNum}`,
        focus: day.focus ?? day.theme ?? null,
        sessionData: day,
      });
    }
  }
  if (sessionRows.length > 0) {
    await db.insert(workoutSessions).values(sessionRows);
  }
}

async function getAthleteContextSummary(orgId: string, athleteUserIds: string[]): Promise<any[]> {
  if (athleteUserIds.length === 0) return [];
  try {
    const entries = await db
      .select({
        userId: prLiftEntries.userId,
        value: prLiftEntries.value,
        unit: prLiftEntries.unit,
        entryDate: prLiftEntries.entryDate,
        liftName: prLiftTypes.name,
        liftCategory: prLiftTypes.category,
      })
      .from(prLiftEntries)
      .innerJoin(prLiftTypes, eq(prLiftEntries.liftTypeId, prLiftTypes.id))
      .where(and(eq(prLiftEntries.orgId, orgId), inArray(prLiftEntries.userId, athleteUserIds)))
      .orderBy(desc(prLiftEntries.createdAt))
      .limit(100);

    const byAthlete: Record<string, any[]> = {};
    for (const e of entries) {
      if (!byAthlete[e.userId]) byAthlete[e.userId] = [];
      byAthlete[e.userId].push(e);
    }
    return Object.entries(byAthlete).map(([userId, lifts]) => ({ userId, recentLifts: lifts.slice(0, 10) }));
  } catch {
    return [];
  }
}

export function registerWorkoutBuilderRoutes(app: Express) {
  // GET /api/org/workout-builder/bootstrap
  app.get("/api/org/workout-builder/bootstrap", acceptOrgOrMainAuth, requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const memberRole = req.orgMembership?.role ?? "";
      const isFullCoach = ["coach", "admin", "owner"].includes(memberRole);
      const isTeamCoach = memberRole === "team_coach";
      const isAthlete = memberRole === "athlete";
      const isGuardian = memberRole === "guardian";

      const canManagePrograms = isFullCoach;
      const canGeneratePrograms = isFullCoach;
      const canAssignPrograms = isFullCoach;
      const canViewAssignedWorkouts = isAthlete || isGuardian || isFullCoach || isTeamCoach;
      const canCreatePersonalWorkout = isAthlete;

      // Fetch org, teams, athletes (via orgUsers — athletes sign up through OrgAuthModal),
      // and TrainChat integration status in parallel.
      // NOTE: orgUsers has `name`; the main-app `users` table uses firstName/lastName only.
      const [[org], teams, athletes, tcStatus] = await Promise.all([
        db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
          .from(organizations).where(eq(organizations.id, orgId)).limit(1)
          .catch(() => [] as any[]),
        db.select().from(prTeams).where(eq(prTeams.orgId, orgId)).orderBy(asc(prTeams.name))
          .catch(() => [] as any[]),
        db.select({
          userId: orgMemberships.userId,
          name: orgUsers.name,
          email: orgUsers.email,
        })
          .from(orgMemberships)
          .innerJoin(orgUsers, eq(orgMemberships.userId, orgUsers.id))
          .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "athlete")))
          .orderBy(asc(orgUsers.name))
          .catch(() => [] as any[]),
        getConnectionStatus(orgId).catch((err: any) => ({
          trainChatConnected: false,
          connectionMode: "none" as const,
          lastError: `Connection status check threw: ${err?.message ?? "unknown"}`,
        })),
      ]);

      // ── TrainChat diagnostic log (never logs raw keys) ────────────────────
      console.log("[workout-builder] TrainChat env check:", {
        TRAINCHAT_API_KEY_exists: !!process.env.TRAINCHAT_API_KEY,
        TRAINCHAT_EXTERNAL_API_KEY_exists: !!process.env.TRAINCHAT_EXTERNAL_API_KEY,
        TRAINCHAT_API_BASE_URL: process.env.TRAINCHAT_API_BASE_URL ?? "(not set)",
        TRAINCHAT_EXTERNAL_API_BASE_URL: process.env.TRAINCHAT_EXTERNAL_API_BASE_URL ?? "(not set)",
        TRAINCHAT_BASE_URL: process.env.TRAINCHAT_BASE_URL ?? "(not set)",
      });
      console.log("[workout-builder] getConnectionStatus result:", {
        trainChatConnected: tcStatus.trainChatConnected,
        connectionMode: tcStatus.connectionMode,
        maskedKeyPreview: tcStatus.maskedKeyPreview ?? null,
        baseUrl: tcStatus.baseUrl ?? null,
        lastError: tcStatus.lastError ?? null,
      });
      // ─────────────────────────────────────────────────────────────────────

      // Coaches see all programs; athletes/guardians only see their own
      const programs = canManagePrograms
        ? await db.select().from(workoutPrograms)
            .where(eq(workoutPrograms.orgId, orgId))
            .orderBy(desc(workoutPrograms.createdAt))
            .catch(() => [] as any[])
        : [];

      return res.json({
        org: org ?? null,
        authMode: req.authMode ?? "org_token",
        effectiveRole: memberRole,
        currentUser: { id: profile.userId, role: profile.role },
        canManagePrograms,
        canGeneratePrograms,
        canAssignPrograms,
        canViewAssignedWorkouts,
        canCreatePersonalWorkout,
        teams: teams ?? [],
        athletes: athletes ?? [],
        programs: programs ?? [],
        trainChatConnected: tcStatus.trainChatConnected,
        connectionMode: tcStatus.connectionMode,
        maskedKeyPreview: tcStatus.maskedKeyPreview ?? null,
        trainChatBaseUrl: tcStatus.baseUrl ?? null,
        trainChatLastError: tcStatus.lastError ?? null,
      });
    } catch (err: any) {
      console.error("[workout-builder] bootstrap error:", err);
      return res.status(500).json({ message: err?.message ?? "Bootstrap failed" });
    }
  });

  // POST /api/org/workout-builder/generate
  app.post("/api/org/workout-builder/generate", acceptOrgOrMainAuth, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const bodySchema = z.object({
        programToolId: z.string().min(1),
        targetType: z.enum(["team", "athlete"]),
        athleteUserIds: z.array(z.string()).default([]),
        teamId: z.string().optional(),
        goal: z.string().min(1),
        sport: z.string().optional(),
        durationWeeks: z.number().int().min(1).max(52),
        daysPerWeek: z.number().int().min(1).max(7),
        equipment: z.string().optional(),
        constraints: z.string().optional(),
        coachNotes: z.string().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });

      const { programToolId, targetType, athleteUserIds, teamId, goal, sport, durationWeeks, daysPerWeek, equipment, constraints, coachNotes } = parsed.data;

      // Verify program tool belongs to org
      const [programTool] = await db.select().from(athleticPrograms)
        .where(and(eq(athleticPrograms.id, programToolId), eq(athleticPrograms.organizationId, orgId))).limit(1);
      if (!programTool) return res.status(404).json({ message: "Program tool not found" });

      // Check TrainChat integration
      const [tcIntegration] = await db.select().from(orgAiIntegrations)
        .where(and(eq(orgAiIntegrations.orgId, orgId), eq(orgAiIntegrations.provider, "trainchat"), eq(orgAiIntegrations.isActive, true))).limit(1);
      if (!tcIntegration) return res.status(400).json({ message: "TrainChat integration is not connected. Set it up in Options → Advanced → Integrations." });

      // Gather athlete context (legacy PR summary + new context objects)
      const athleteContext = await getAthleteContextSummary(orgId, athleteUserIds);

      // ── Athlete Context Object injection ────────────────────────────────────
      // For single-athlete programs, fetch the full living context object
      let contextObject: any = null;
      let contextSummary = "";
      let modifiers: any = { readinessAdjustmentApplied: false, complianceAdjustmentApplied: false, rpeAdjustmentApplied: false, modifiersApplied: [], contextualInstructions: "" };

      if (athleteUserIds.length === 1) {
        try {
          contextObject = await getAthleteContextForAI(athleteUserIds[0], orgId);
          contextSummary = summarizeAthleteContextForPrompt(contextObject);
          modifiers = computeTrainChatModifiers(contextObject);
        } catch (err: any) {
          console.warn("[workout-builder] Context object fetch failed (non-blocking):", err.message);
        }
      }

      // Package context for TrainChat — now includes living athlete intelligence
      const tcParams = {
        targetType,
        athleteUserIds,
        teamId,
        goal,
        sport,
        durationWeeks,
        daysPerWeek,
        equipment,
        constraints,
        coachNotes,
        athleteContext,
        // Living context injection
        athleteIntelligence: contextSummary || undefined,
        contextualInstructions: modifiers.contextualInstructions || undefined,
        programPhase: contextObject?.currentProgramPhase ?? undefined,
        readinessTrend: contextObject?.readinessTrend ?? undefined,
        complianceRate: contextObject?.complianceRate ?? undefined,
      };

      let rawResponse: any = null;
      let trainChatProgramId: string | null = null;
      let generatedSummary: string | null = null;
      let title = `${goal.charAt(0).toUpperCase() + goal.slice(1)} Program – ${durationWeeks}wk/${daysPerWeek}x`;
      let generationError: string | null = null;

      try {
        const result = await trainChatClient.generateProgram(orgId, tcParams);
        rawResponse = result.data;
        if (rawResponse) {
          trainChatProgramId = rawResponse.id ?? rawResponse.programId ?? null;
          generatedSummary = rawResponse.summary ?? rawResponse.rationale ?? null;
          if (rawResponse.title) title = rawResponse.title;
        }
      } catch (err: any) {
        console.error("[workout-builder] TrainChat generation error:", err);
        generationError = err?.message ?? "TrainChat generation failed";
        rawResponse = { error: generationError };
      }

      // Store program regardless of TrainChat success
      const [program] = await db.insert(workoutPrograms).values({
        orgId,
        programToolId,
        createdByUserId: profile.userId,
        trainChatProgramId,
        title,
        goal,
        sport: sport ?? null,
        durationWeeks,
        daysPerWeek,
        status: "draft",
        source: "trainchat_api",
        trainChatRawResponse: rawResponse,
        generatedSummary,
      }).returning();

      // Store generation metadata (context snapshot at time of generation)
      if (athleteUserIds.length === 1) {
        db.insert(workoutGenerationMetadata).values({
          orgId,
          workoutProgramId: program.id,
          athleteUserId: athleteUserIds[0],
          contextObjectId: contextObject?.id ?? null,
          readinessAdjustmentApplied: modifiers.readinessAdjustmentApplied,
          complianceAdjustmentApplied: modifiers.complianceAdjustmentApplied,
          rpeAdjustmentApplied: modifiers.rpeAdjustmentApplied,
          readinessTrendAtGeneration: contextObject?.readinessTrend ?? null,
          complianceRateAtGeneration: contextObject?.complianceRate ?? null,
          aiRationale: modifiers.contextualInstructions || null,
          modifiersApplied: modifiers.modifiersApplied,
        }).catch((err: any) => {
          console.warn("[workout-builder] Generation metadata save failed (non-blocking):", err.message);
        });
      }

      // Parse and store sessions from raw response
      if (rawResponse && !generationError) {
        await parseAndStoreSessions(orgId, program.id, rawResponse).catch((err) => {
          console.error("[workout-builder] session parsing error:", err);
        });
      }

      const sessions = await db.select().from(workoutSessions)
        .where(eq(workoutSessions.workoutProgramId, program.id))
        .orderBy(asc(workoutSessions.weekNumber), asc(workoutSessions.dayNumber));

      return res.json({ program, sessions, generationError, contextApplied: !!contextObject, modifiersApplied: modifiers.modifiersApplied });
    } catch (err: any) {
      console.error("[workout-builder] generate error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/org/workout-builder/:programId/assign
  app.post("/api/org/workout-builder/:programId/assign", acceptOrgOrMainAuth, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const [program] = await db.select().from(workoutPrograms)
        .where(and(eq(workoutPrograms.id, req.params.programId), eq(workoutPrograms.orgId, orgId))).limit(1);
      if (!program) return res.status(404).json({ message: "Program not found" });

      const bodySchema = z.object({
        assignedToType: z.enum(["athlete", "team"]),
        athleteUserId: z.string().optional(),
        teamId: z.string().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

      const { assignedToType, athleteUserId, teamId } = parsed.data;
      if (assignedToType === "athlete" && !athleteUserId) return res.status(400).json({ message: "athleteUserId required" });
      if (assignedToType === "team" && !teamId) return res.status(400).json({ message: "teamId required" });

      const [assignment] = await db.insert(workoutProgramAssignments).values({
        orgId,
        workoutProgramId: program.id,
        assignedToType,
        athleteUserId: athleteUserId ?? null,
        teamId: teamId ?? null,
        assignedByUserId: profile.userId,
        status: "active",
      }).returning();

      // Mark program as assigned
      await db.update(workoutPrograms).set({ status: "assigned", updatedAt: new Date() })
        .where(eq(workoutPrograms.id, program.id));

      // Fire automation event
      if (assignedToType === "athlete" && athleteUserId) {
        triggerNotificationEvent("workout_assigned", {
          orgId,
          userId: athleteUserId,
          coachUserId: profile.userId,
          programId: program.id,
          programName: program.name,
        }).catch(() => {});
        createActivityEvent({
          orgId,
          userId: athleteUserId,
          sourceType: "workout",
          sourceId: program.id,
          eventType: "workout_assigned",
          title: `Workout assigned: ${program.name}`,
          description: "A new workout program was assigned to you.",
          metadata: { programId: program.id, programName: program.name, assignedBy: profile.userId },
          visibility: "athlete",
        }).catch(() => {});
      } else if (assignedToType === "team" && teamId) {
        // Notify each team member
        const members = await db.select().from(prTeamMembers).where(eq(prTeamMembers.teamId, teamId));
        for (const member of members) {
          if (member.userId === profile.userId) continue;
          triggerNotificationEvent("workout_assigned", {
            orgId,
            userId: member.userId,
            coachUserId: profile.userId,
            programId: program.id,
            programName: program.name,
          }).catch(() => {});
          createActivityEvent({
            orgId,
            userId: member.userId,
            teamId,
            sourceType: "workout",
            sourceId: program.id,
            eventType: "workout_assigned",
            title: `Team workout assigned: ${program.name}`,
            description: "A new workout program was assigned to your team.",
            metadata: { programId: program.id, programName: program.name, teamId },
            visibility: "athlete",
          }).catch(() => {});
        }
      }

      return res.json({ assignment });
    } catch (err: any) {
      console.error("[workout-builder] assign error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/org/workout-builder/programs/:programId
  app.get("/api/org/workout-builder/programs/:programId", acceptOrgOrMainAuth, requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const [program] = await db.select().from(workoutPrograms)
        .where(and(eq(workoutPrograms.id, req.params.programId), eq(workoutPrograms.orgId, orgId))).limit(1);
      if (!program) return res.status(404).json({ message: "Program not found" });

      const [sessions, assignments] = await Promise.all([
        db.select().from(workoutSessions)
          .where(eq(workoutSessions.workoutProgramId, program.id))
          .orderBy(asc(workoutSessions.weekNumber), asc(workoutSessions.dayNumber)),
        db.select().from(workoutProgramAssignments)
          .where(eq(workoutProgramAssignments.workoutProgramId, program.id))
          .orderBy(desc(workoutProgramAssignments.assignedAt)),
      ]);

      return res.json({ program, sessions, assignments });
    } catch (err: any) {
      console.error("[workout-builder] get program error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // PATCH /api/org/workout-builder/programs/:programId
  app.patch("/api/org/workout-builder/programs/:programId", acceptOrgOrMainAuth, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const [program] = await db.select().from(workoutPrograms)
        .where(and(eq(workoutPrograms.id, req.params.programId), eq(workoutPrograms.orgId, orgId))).limit(1);
      if (!program) return res.status(404).json({ message: "Program not found" });

      const bodySchema = z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["draft", "assigned", "archived"]).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

      const updateData: any = { updatedAt: new Date() };
      if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
      if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
      if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

      const [updated] = await db.update(workoutPrograms).set(updateData)
        .where(eq(workoutPrograms.id, program.id)).returning();

      return res.json({ program: updated });
    } catch (err: any) {
      console.error("[workout-builder] patch program error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/org/workout-builder/programs/:programId/edit
  app.post("/api/org/workout-builder/programs/:programId/edit", acceptOrgOrMainAuth, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const [program] = await db.select().from(workoutPrograms)
        .where(and(eq(workoutPrograms.id, req.params.programId), eq(workoutPrograms.orgId, orgId))).limit(1);
      if (!program) return res.status(404).json({ message: "Program not found" });

      const bodySchema = z.object({ instruction: z.string().min(1) });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "instruction is required" });

      if (!program.trainChatProgramId) {
        return res.status(400).json({ message: "No TrainChat program ID stored. Cannot refine this program." });
      }

      let rawResponse: any = null;
      let editError: string | null = null;

      try {
        const result = await trainChatClient.editProgram(orgId, program.trainChatProgramId, {
          instruction: parsed.data.instruction,
          currentProgram: program.trainChatRawResponse,
        });
        rawResponse = result.data;
      } catch (err: any) {
        editError = err?.message ?? "TrainChat edit failed";
      }

      if (rawResponse) {
        // Re-parse sessions
        await db.delete(workoutSessions).where(eq(workoutSessions.workoutProgramId, program.id));
        await parseAndStoreSessions(orgId, program.id, rawResponse).catch(() => {});

        const updateData: any = {
          trainChatRawResponse: rawResponse,
          updatedAt: new Date(),
        };
        if (rawResponse.title) updateData.title = rawResponse.title;
        if (rawResponse.summary) updateData.generatedSummary = rawResponse.summary;
        if (rawResponse.id) updateData.trainChatProgramId = rawResponse.id;

        const [updated] = await db.update(workoutPrograms).set(updateData)
          .where(eq(workoutPrograms.id, program.id)).returning();

        const sessions = await db.select().from(workoutSessions)
          .where(eq(workoutSessions.workoutProgramId, program.id))
          .orderBy(asc(workoutSessions.weekNumber), asc(workoutSessions.dayNumber));

        return res.json({ program: updated, sessions, editError });
      }

      return res.json({ program, sessions: [], editError });
    } catch (err: any) {
      console.error("[workout-builder] edit program error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/org/workout-builder/sessions/:sessionId/complete
  app.post("/api/org/workout-builder/sessions/:sessionId/complete", acceptOrgOrMainAuth, requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const [session] = await db.select().from(workoutSessions)
        .where(and(eq(workoutSessions.id, req.params.sessionId), eq(workoutSessions.orgId, orgId))).limit(1);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const bodySchema = z.object({
        notes: z.string().optional(),
        rating: z.number().int().min(1).max(5).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

      const [log] = await db.insert(workoutCompletionLogs).values({
        orgId,
        workoutSessionId: session.id,
        athleteUserId: profile.userId,
        notes: parsed.data.notes ?? null,
        rating: parsed.data.rating ?? null,
      }).returning();

      // Trigger async context refresh after session completion
      refreshAthleteContextObject(profile.userId, orgId, "session_completion").catch(() => {});

      return res.json({ log });
    } catch (err: any) {
      console.error("[workout-builder] complete session error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Athlete Context Broker Routes ───────────────────────────────────────────

  // GET /api/org/workout-builder/athletes/:athleteUserId/context
  app.get("/api/org/workout-builder/athletes/:athleteUserId/context", acceptOrgOrMainAuth, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const { athleteUserId } = req.params;

      const [context] = await db.select()
        .from(athleteContextObjects)
        .where(and(
          eq(athleteContextObjects.athleteUserId, athleteUserId),
          eq(athleteContextObjects.orgId, orgId),
        ))
        .limit(1);

      if (!context) {
        return res.json({ context: null, message: "No context object yet. Use refresh to build one." });
      }

      return res.json({ context });
    } catch (err: any) {
      console.error("[workout-builder] get context error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/org/workout-builder/athletes/:athleteUserId/context/refresh
  app.post("/api/org/workout-builder/athletes/:athleteUserId/context/refresh", acceptOrgOrMainAuth, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const { athleteUserId } = req.params;

      const context = await refreshAthleteContextObject(athleteUserId, orgId, "manual_coach_refresh");

      return res.json({ context, refreshed: true });
    } catch (err: any) {
      console.error("[workout-builder] context refresh error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/org/workout-builder/my-workouts  (athlete view)
  app.get("/api/org/workout-builder/my-workouts", acceptOrgOrMainAuth, requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const userId = profile.userId;

      // Get coach-assigned programs for this athlete
      const assignments = await db.select()
        .from(workoutProgramAssignments)
        .where(and(
          eq(workoutProgramAssignments.orgId, orgId),
          eq(workoutProgramAssignments.athleteUserId, userId),
          eq(workoutProgramAssignments.status, "active"),
        ));

      const assignedProgramIds = assignments.length > 0
        ? [...new Set(assignments.map((a) => a.workoutProgramId))]
        : [];

      const assignedPrograms = assignedProgramIds.length > 0
        ? await db.select().from(workoutPrograms)
            .where(and(eq(workoutPrograms.orgId, orgId), inArray(workoutPrograms.id, assignedProgramIds)))
        : [];

      // Get self-created personal programs
      const personalPrograms = await db.select()
        .from(workoutPrograms)
        .where(and(
          eq(workoutPrograms.orgId, orgId),
          eq(workoutPrograms.createdByUserId, userId),
          eq(workoutPrograms.source, "athlete_self"),
        ))
        .orderBy(desc(workoutPrograms.createdAt));

      const allProgramIds = [
        ...new Set([...assignedProgramIds, ...personalPrograms.map((p) => p.id)]),
      ];

      const sessions = allProgramIds.length > 0
        ? await db.select().from(workoutSessions)
            .where(and(eq(workoutSessions.orgId, orgId), inArray(workoutSessions.workoutProgramId, allProgramIds)))
            .orderBy(asc(workoutSessions.weekNumber), asc(workoutSessions.dayNumber))
        : [];

      const completions = await db.select().from(workoutCompletionLogs)
        .where(and(eq(workoutCompletionLogs.orgId, orgId), eq(workoutCompletionLogs.athleteUserId, userId)));

      return res.json({ assignments, programs: assignedPrograms, personalPrograms, sessions, completions });
    } catch (err: any) {
      console.error("[workout-builder] my-workouts error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/org/workout-builder/athlete/generate  (athlete self-service)
  app.post("/api/org/workout-builder/athlete/generate", acceptOrgOrMainAuth, requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      const userId = profile.userId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      const bodySchema = z.object({
        programToolId: z.string().min(1),
        goal: z.string().min(1),
        sport: z.string().optional(),
        durationWeeks: z.number().int().min(1).max(52),
        daysPerWeek: z.number().int().min(1).max(7),
        equipment: z.string().optional(),
        limitations: z.string().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });

      const { programToolId, goal, sport, durationWeeks, daysPerWeek, equipment, limitations } = parsed.data;

      // Verify program tool belongs to org
      const [programTool] = await db.select().from(athleticPrograms)
        .where(and(eq(athleticPrograms.id, programToolId), eq(athleticPrograms.organizationId, orgId))).limit(1);
      if (!programTool) return res.status(404).json({ message: "Program tool not found" });

      // Check TrainChat integration
      const [tcIntegration] = await db.select().from(orgAiIntegrations)
        .where(and(eq(orgAiIntegrations.orgId, orgId), eq(orgAiIntegrations.provider, "trainchat"), eq(orgAiIntegrations.isActive, true))).limit(1);
      if (!tcIntegration) return res.status(400).json({ message: "TrainChat is not connected for this organization." });

      // Gather athlete's own PR context for personalization
      const athleteContext = await getAthleteContextSummary(orgId, [userId]);

      // ── Athlete Context Object injection (athlete self-service) ─────────────
      let contextObject: any = null;
      let contextSummary = "";
      let modifiers: any = { readinessAdjustmentApplied: false, complianceAdjustmentApplied: false, rpeAdjustmentApplied: false, modifiersApplied: [], contextualInstructions: "" };
      try {
        contextObject = await getAthleteContextForAI(userId, orgId);
        contextSummary = summarizeAthleteContextForPrompt(contextObject);
        modifiers = computeTrainChatModifiers(contextObject);
      } catch (err: any) {
        console.warn("[workout-builder] Athlete self-gen context fetch failed (non-blocking):", err.message);
      }

      const tcParams = {
        targetType: "athlete",
        athleteUserIds: [userId],
        goal,
        sport,
        durationWeeks,
        daysPerWeek,
        equipment,
        constraints: limitations,
        athleteContext,
        athleteIntelligence: contextSummary || undefined,
        contextualInstructions: modifiers.contextualInstructions || undefined,
        readinessTrend: contextObject?.readinessTrend ?? undefined,
        complianceRate: contextObject?.complianceRate ?? undefined,
      };

      let rawResponse: any = null;
      let trainChatProgramId: string | null = null;
      let generatedSummary: string | null = null;
      let title = `${goal.charAt(0).toUpperCase() + goal.slice(1)} Program – ${durationWeeks}wk/${daysPerWeek}x`;
      let generationError: string | null = null;

      try {
        const result = await trainChatClient.generateProgram(orgId, tcParams);
        rawResponse = result.data;
        if (rawResponse) {
          trainChatProgramId = rawResponse.id ?? rawResponse.programId ?? null;
          generatedSummary = rawResponse.summary ?? rawResponse.rationale ?? null;
          if (rawResponse.title) title = rawResponse.title;
        }
      } catch (err: any) {
        generationError = err?.message ?? "TrainChat generation failed";
        rawResponse = { error: generationError };
      }

      // Store the program with athlete_self source
      const [program] = await db.insert(workoutPrograms).values({
        orgId,
        programToolId,
        createdByUserId: userId,
        trainChatProgramId,
        title,
        goal,
        sport: sport ?? null,
        durationWeeks,
        daysPerWeek,
        status: "personal",
        source: "athlete_self",
        trainChatRawResponse: rawResponse,
        generatedSummary,
      }).returning();

      // Parse and store sessions
      if (rawResponse && !generationError) {
        await parseAndStoreSessions(orgId, program.id, rawResponse).catch(() => {});
      }

      const sessions = await db.select().from(workoutSessions)
        .where(eq(workoutSessions.workoutProgramId, program.id))
        .orderBy(asc(workoutSessions.weekNumber), asc(workoutSessions.dayNumber));

      return res.json({ program, sessions, generationError });
    } catch (err: any) {
      console.error("[workout-builder] athlete generate error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
}
