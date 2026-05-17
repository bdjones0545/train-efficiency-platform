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
import { eq, and, gt, desc, asc, inArray } from "drizzle-orm";
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
