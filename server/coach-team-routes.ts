import type { Express, Response, NextFunction } from "express";
import { db } from "./db";
import crypto from "crypto";
import { z } from "zod";
import {
  orgUsers,
  orgMemberships,
  orgSessions,
  organizations,
  prTeams,
  prTeamMembers,
  prLiftTypes,
  prLiftEntries,
  athleticBookings,
} from "@shared/schema";
import { eq, and, gt, lte, desc, asc, inArray } from "drizzle-orm";
import { pgTable, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const coachAthleteNotes = pgTable("coach_athlete_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  teamId: varchar("team_id").notNull(),
  coachId: varchar("coach_id").notNull(),
  athleteId: varchar("athlete_id").notNull(),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

async function requireOrgAuth(req: any, res: Response, next: NextFunction) {
  const token = req.headers["x-org-auth-token"] as string;
  if (!token) return res.status(401).json({ message: "Not authenticated" });

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();

  const sessions = await db
    .select()
    .from(orgSessions)
    .where(and(eq(orgSessions.tokenHash, tokenHash), gt(orgSessions.expiresAt, now)))
    .limit(1);

  if (!sessions.length) return res.status(401).json({ message: "Session expired or invalid" });

  const session = sessions[0];
  await db.update(orgSessions).set({ lastUsedAt: now }).where(eq(orgSessions.id, session.id));

  const foundUsers = await db.select().from(orgUsers).where(eq(orgUsers.id, session.userId)).limit(1);
  if (!foundUsers.length) return res.status(401).json({ message: "User not found" });

  const memberships = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, session.userId), eq(orgMemberships.orgId, session.orgId)))
    .limit(1);

  if (!memberships.length) return res.status(401).json({ message: "Not a member of this organization" });

  req.orgAuth = { user: foundUsers[0], membership: memberships[0] };
  req.orgSession = session;
  next();
}

function requireCoachRole(req: any, res: Response, next: NextFunction) {
  const { membership } = req.orgAuth;
  if (membership.role !== "coach" && membership.role !== "owner") {
    return res.status(403).json({ message: "Coach access required" });
  }
  next();
}

export function registerCoachTeamRoutes(app: Express) {
  // ── GET /api/org/coach/teams ────────────────────────────────────────────
  app.get("/api/org/coach/teams", requireOrgAuth, requireCoachRole, async (req: any, res: Response) => {
    try {
      const { user, membership } = req.orgAuth;
      const orgId = membership.orgId;

      const teams = await db
        .select()
        .from(prTeams)
        .where(and(eq(prTeams.orgId, orgId), eq(prTeams.coachUserId, user.id)))
        .orderBy(desc(prTeams.createdAt));

      const teamIds = teams.map((t) => t.id);
      const memberCounts: Record<string, number> = {};

      if (teamIds.length > 0) {
        const allMembers = await db
          .select({ teamId: prTeamMembers.teamId, userId: prTeamMembers.userId })
          .from(prTeamMembers)
          .where(and(eq(prTeamMembers.orgId, orgId), inArray(prTeamMembers.teamId, teamIds)));

        for (const m of allMembers) {
          memberCounts[m.teamId] = (memberCounts[m.teamId] || 0) + 1;
        }
      }

      const result = teams.map((t) => ({
        ...t,
        memberCount: memberCounts[t.id] || 0,
      }));

      res.json({ teams: result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/org/coach/teams/:teamId ────────────────────────────────────
  app.get("/api/org/coach/teams/:teamId", requireOrgAuth, requireCoachRole, async (req: any, res: Response) => {
    try {
      const { user, membership } = req.orgAuth;
      const orgId = membership.orgId;
      const { teamId } = req.params;

      const [team] = await db
        .select()
        .from(prTeams)
        .where(and(eq(prTeams.id, teamId), eq(prTeams.orgId, orgId), eq(prTeams.coachUserId, user.id)))
        .limit(1);

      if (!team) return res.status(404).json({ message: "Team not found or not yours" });

      const members = await db
        .select({
          id: prTeamMembers.id,
          userId: prTeamMembers.userId,
          role: prTeamMembers.role,
          joinedAt: prTeamMembers.createdAt,
          name: orgUsers.name,
          email: orgUsers.email,
        })
        .from(prTeamMembers)
        .innerJoin(orgUsers, eq(prTeamMembers.userId, orgUsers.id))
        .where(and(eq(prTeamMembers.teamId, teamId), eq(prTeamMembers.orgId, orgId)))
        .orderBy(asc(orgUsers.name));

      const memberUserIds = members.map((m) => m.userId);
      const entryCounts: Record<string, number> = {};
      const bestPrByUser: Record<string, { liftName: string; value: number; unit: string }> = {};

      if (memberUserIds.length > 0) {
        const allEntries = await db
          .select({
            userId: prLiftEntries.userId,
            value: prLiftEntries.value,
            unit: prLiftEntries.unit,
            liftName: prLiftTypes.name,
          })
          .from(prLiftEntries)
          .innerJoin(prLiftTypes, eq(prLiftEntries.liftTypeId, prLiftTypes.id))
          .where(and(eq(prLiftEntries.orgId, orgId), inArray(prLiftEntries.userId, memberUserIds)));

        for (const e of allEntries) {
          entryCounts[e.userId] = (entryCounts[e.userId] || 0) + 1;
          if (!bestPrByUser[e.userId] || e.value > bestPrByUser[e.userId].value) {
            bestPrByUser[e.userId] = { liftName: e.liftName, value: e.value, unit: e.unit };
          }
        }
      }

      const enrichedMembers = members.map((m) => ({
        ...m,
        entryCount: entryCounts[m.userId] || 0,
        bestPr: bestPrByUser[m.userId] || null,
      }));

      res.json({ team, members: enrichedMembers });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/org/coach/teams/:teamId/athletes/:userId ──────────────────
  app.get(
    "/api/org/coach/teams/:teamId/athletes/:userId",
    requireOrgAuth,
    requireCoachRole,
    async (req: any, res: Response) => {
      try {
        const { user, membership } = req.orgAuth;
        const orgId = membership.orgId;
        const { teamId, userId: athleteId } = req.params;

        const [team] = await db
          .select()
          .from(prTeams)
          .where(and(eq(prTeams.id, teamId), eq(prTeams.orgId, orgId), eq(prTeams.coachUserId, user.id)))
          .limit(1);

        if (!team) return res.status(403).json({ message: "Not your team" });

        const [athlete] = await db
          .select({ id: orgUsers.id, name: orgUsers.name, email: orgUsers.email, createdAt: orgUsers.createdAt })
          .from(orgUsers)
          .where(eq(orgUsers.id, athleteId))
          .limit(1);

        if (!athlete) return res.status(404).json({ message: "Athlete not found" });

        const allEntries = await db
          .select({
            id: prLiftEntries.id,
            liftTypeId: prLiftEntries.liftTypeId,
            value: prLiftEntries.value,
            unit: prLiftEntries.unit,
            entryDate: prLiftEntries.entryDate,
            notes: prLiftEntries.notes,
            liftName: prLiftTypes.name,
            liftUnit: prLiftTypes.unit,
          })
          .from(prLiftEntries)
          .innerJoin(prLiftTypes, eq(prLiftEntries.liftTypeId, prLiftTypes.id))
          .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, athleteId)))
          .orderBy(desc(prLiftEntries.entryDate));

        const bestMap: Record<string, any> = {};
        for (const e of allEntries) {
          if (!bestMap[e.liftTypeId] || e.value > bestMap[e.liftTypeId].value) {
            bestMap[e.liftTypeId] = {
              liftTypeId: e.liftTypeId,
              liftName: e.liftName,
              unit: e.liftUnit || e.unit,
              value: e.value,
              entryDate: e.entryDate,
            };
          }
        }

        const bestPrs = Object.values(bestMap).sort((a: any, b: any) =>
          a.liftName.localeCompare(b.liftName)
        );

        const today = new Date().toISOString().split("T")[0];

        const upcomingBookings = await db
          .select({
            id: athleticBookings.id,
            date: athleticBookings.date,
            timeSlot: athleticBookings.timeSlot,
            teamName: athleticBookings.teamName,
            trainingType: athleticBookings.trainingType,
          })
          .from(athleticBookings)
          .where(
            and(
              eq(athleticBookings.organizationId, orgId),
              eq(athleticBookings.orgUserId, athleteId),
              gt(athleticBookings.date, today)
            )
          )
          .orderBy(asc(athleticBookings.date))
          .limit(10);

        const [notesRow] = await db
          .select()
          .from(coachAthleteNotes)
          .where(
            and(
              eq(coachAthleteNotes.orgId, orgId),
              eq(coachAthleteNotes.teamId, teamId),
              eq(coachAthleteNotes.athleteId, athleteId)
            )
          )
          .limit(1);

        const recentEntries = allEntries.slice(0, 10);

        const memberSince = await db
          .select({ createdAt: orgMemberships.createdAt })
          .from(orgMemberships)
          .where(and(eq(orgMemberships.userId, athleteId), eq(orgMemberships.orgId, orgId)))
          .limit(1);

        res.json({
          athlete: { ...athlete, memberSince: memberSince[0]?.createdAt || null },
          team,
          bestPrs,
          recentEntries,
          upcomingBookings,
          notes: notesRow?.notes || "",
          stats: {
            totalEntries: allEntries.length,
            liftTypes: Object.keys(bestMap).length,
            upcomingSessions: upcomingBookings.length,
          },
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── GET /api/org/coach/athletes/:userId ────────────────────────────────
  app.get("/api/org/coach/athletes/:userId", requireOrgAuth, requireCoachRole, async (req: any, res: Response) => {
    try {
      const { user, membership } = req.orgAuth;
      const orgId = membership.orgId;
      const { userId: athleteId } = req.params;

      // Security: owner can see all; coach can only view athletes on their teams
      let hasAccess = membership.role === "owner";
      if (!hasAccess) {
        const coachTeams = await db.select({ id: prTeams.id }).from(prTeams).where(and(eq(prTeams.orgId, orgId), eq(prTeams.coachUserId, user.id)));
        const coachTeamIds = coachTeams.map((t) => t.id);
        if (coachTeamIds.length > 0) {
          const athleteMem = await db.select({ id: prTeamMembers.id }).from(prTeamMembers)
            .where(and(eq(prTeamMembers.orgId, orgId), eq(prTeamMembers.userId, athleteId), inArray(prTeamMembers.teamId, coachTeamIds)))
            .limit(1);
          hasAccess = athleteMem.length > 0;
        }
      }
      if (!hasAccess) return res.status(403).json({ message: "Not authorized to view this athlete" });

      const [athlete] = await db.select({ id: orgUsers.id, name: orgUsers.name, email: orgUsers.email, createdAt: orgUsers.createdAt })
        .from(orgUsers).where(eq(orgUsers.id, athleteId)).limit(1);
      if (!athlete) return res.status(404).json({ message: "Athlete not found" });

      const [orgMembership] = await db.select({ role: orgMemberships.role, createdAt: orgMemberships.createdAt })
        .from(orgMemberships).where(and(eq(orgMemberships.userId, athleteId), eq(orgMemberships.orgId, orgId))).limit(1);

      // Teams this athlete is in
      const athleteTeams = await db.select({
        id: prTeams.id,
        name: prTeams.name,
        sport: prTeams.sport,
        season: prTeams.season,
        coachUserId: prTeams.coachUserId,
        memberRole: prTeamMembers.role,
        joinedAt: prTeamMembers.createdAt,
      })
        .from(prTeamMembers)
        .innerJoin(prTeams, eq(prTeamMembers.teamId, prTeams.id))
        .where(and(eq(prTeamMembers.userId, athleteId), eq(prTeamMembers.orgId, orgId)))
        .orderBy(asc(prTeams.name));

      // All PR entries
      const allEntries = await db.select({
        id: prLiftEntries.id,
        liftTypeId: prLiftEntries.liftTypeId,
        value: prLiftEntries.value,
        unit: prLiftEntries.unit,
        entryDate: prLiftEntries.entryDate,
        notes: prLiftEntries.notes,
        liftName: prLiftTypes.name,
        liftUnit: prLiftTypes.unit,
      })
        .from(prLiftEntries)
        .innerJoin(prLiftTypes, eq(prLiftEntries.liftTypeId, prLiftTypes.id))
        .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, athleteId)))
        .orderBy(desc(prLiftEntries.entryDate));

      const bestMap: Record<string, any> = {};
      const historyMap: Record<string, any[]> = {};
      for (const e of allEntries) {
        if (!historyMap[e.liftTypeId]) historyMap[e.liftTypeId] = [];
        historyMap[e.liftTypeId].push({ id: e.id, liftName: e.liftName, value: e.value, unit: e.liftUnit || e.unit, entryDate: e.entryDate, notes: e.notes });
        if (!bestMap[e.liftTypeId] || e.value > bestMap[e.liftTypeId].bestValue) {
          bestMap[e.liftTypeId] = {
            liftTypeId: e.liftTypeId,
            liftName: e.liftName,
            unit: e.liftUnit || e.unit,
            bestValue: e.value,
            lastDate: e.entryDate,
          };
        }
        bestMap[e.liftTypeId].entryCount = (bestMap[e.liftTypeId].entryCount || 0) + 1;
      }

      const today = new Date().toISOString().split("T")[0];
      const upcomingBookings = await db.select({
        id: athleticBookings.id,
        date: athleticBookings.date,
        timeSlot: athleticBookings.timeSlot,
        teamName: athleticBookings.teamName,
        trainingType: athleticBookings.trainingType,
      })
        .from(athleticBookings)
        .where(and(eq(athleticBookings.organizationId, orgId), eq(athleticBookings.orgUserId, athleteId), gt(athleticBookings.date, today)))
        .orderBy(asc(athleticBookings.date))
        .limit(20);

      const pastBookings = await db.select({
        id: athleticBookings.id,
        date: athleticBookings.date,
        timeSlot: athleticBookings.timeSlot,
        teamName: athleticBookings.teamName,
        trainingType: athleticBookings.trainingType,
      })
        .from(athleticBookings)
        .where(and(eq(athleticBookings.organizationId, orgId), eq(athleticBookings.orgUserId, athleteId), lte(athleticBookings.date, today)))
        .orderBy(desc(athleticBookings.date))
        .limit(20);

      const notesRows = await db.select().from(coachAthleteNotes)
        .where(and(eq(coachAthleteNotes.orgId, orgId), eq(coachAthleteNotes.athleteId, athleteId)))
        .orderBy(desc(coachAthleteNotes.updatedAt));
      const generalNote = notesRows.find((n) => n.teamId === "__general__") || notesRows[0] || null;

      const bestPrs = Object.values(bestMap).sort((a: any, b: any) => a.liftName.localeCompare(b.liftName));

      res.json({
        athlete,
        orgMembership: orgMembership || null,
        teams: athleteTeams,
        bestPrs,
        prHistory: historyMap,
        recentEntries: allEntries.slice(0, 20).map((e) => ({ id: e.id, liftName: e.liftName, value: e.value, unit: e.liftUnit || e.unit, entryDate: e.entryDate, notes: e.notes })),
        upcomingBookings,
        pastBookings,
        notes: generalNote?.notes || "",
        notesUpdatedAt: generalNote?.updatedAt || null,
        stats: {
          totalEntries: allEntries.length,
          liftTypes: Object.keys(bestMap).length,
          upcomingSessions: upcomingBookings.length,
          pastSessions: pastBookings.length,
          teamsCount: athleteTeams.length,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PATCH /api/org/coach/athletes/:userId/notes ─────────────────────────
  app.patch("/api/org/coach/athletes/:userId/notes", requireOrgAuth, requireCoachRole, async (req: any, res: Response) => {
    try {
      const { user, membership } = req.orgAuth;
      const orgId = membership.orgId;
      const { userId: athleteId } = req.params;
      const { notes } = z.object({ notes: z.string().max(5000) }).parse(req.body);

      const [existing] = await db.select().from(coachAthleteNotes)
        .where(and(eq(coachAthleteNotes.orgId, orgId), eq(coachAthleteNotes.teamId, "__general__"), eq(coachAthleteNotes.athleteId, athleteId)))
        .limit(1);

      if (existing) {
        await db.update(coachAthleteNotes).set({ notes, updatedAt: new Date() }).where(eq(coachAthleteNotes.id, existing.id));
      } else {
        await db.insert(coachAthleteNotes).values({ orgId, teamId: "__general__", coachId: user.id, athleteId, notes });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PATCH /api/org/coach/teams/:teamId/athletes/:userId/notes ──────────
  app.patch(
    "/api/org/coach/teams/:teamId/athletes/:userId/notes",
    requireOrgAuth,
    requireCoachRole,
    async (req: any, res: Response) => {
      try {
        const { user, membership } = req.orgAuth;
        const orgId = membership.orgId;
        const { teamId, userId: athleteId } = req.params;
        const { notes } = z.object({ notes: z.string().max(5000) }).parse(req.body);

        const [team] = await db
          .select({ id: prTeams.id })
          .from(prTeams)
          .where(and(eq(prTeams.id, teamId), eq(prTeams.orgId, orgId), eq(prTeams.coachUserId, user.id)))
          .limit(1);

        if (!team) return res.status(403).json({ message: "Not your team" });

        const [existing] = await db
          .select()
          .from(coachAthleteNotes)
          .where(
            and(
              eq(coachAthleteNotes.orgId, orgId),
              eq(coachAthleteNotes.teamId, teamId),
              eq(coachAthleteNotes.athleteId, athleteId)
            )
          )
          .limit(1);

        if (existing) {
          await db
            .update(coachAthleteNotes)
            .set({ notes, updatedAt: new Date() })
            .where(eq(coachAthleteNotes.id, existing.id));
        } else {
          await db.insert(coachAthleteNotes).values({
            orgId,
            teamId,
            coachId: user.id,
            athleteId,
            notes,
          });
        }

        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );
}
