import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import crypto from "crypto";
import { z } from "zod";
import {
  orgUsers,
  orgMemberships,
  orgSessions,
  athleticBookings,
  organizations,
  athleticPrograms,
  prTeams,
  prTeamMembers,
  prLiftEntries,
  prLiftTypes,
} from "@shared/schema";
import { eq, and, desc, gt, asc } from "drizzle-orm";

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

  req.orgUser = foundUsers[0];
  req.orgSession = session;
  req.orgMembership = memberships[0] || null;
  next();
}

export function registerOrgScheduleRoutes(app: Express) {
  app.get("/api/org/booking-settings", async (req: any, res) => {
    try {
      const orgId = req.query.orgId as string;
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const [org] = await db
        .select({
          allowGuestBooking: organizations.allowGuestBooking,
          requireLoginToBook: organizations.requireLoginToBook,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      if (!org) return res.status(404).json({ message: "Organization not found" });
      res.json(org);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/org/booking-settings", requireOrgAuth, async (req: any, res) => {
    try {
      if (req.orgMembership?.role !== "coach") {
        return res.status(403).json({ message: "Coach access required to update booking settings" });
      }

      const schema = z.object({
        allowGuestBooking: z.boolean().optional(),
        requireLoginToBook: z.boolean().optional(),
      });
      const body = schema.parse(req.body);

      const updates: Record<string, boolean> = {};
      if (body.allowGuestBooking !== undefined) updates.allowGuestBooking = body.allowGuestBooking;
      if (body.requireLoginToBook !== undefined) updates.requireLoginToBook = body.requireLoginToBook;

      if (!Object.keys(updates).length) {
        return res.status(400).json({ message: "No settings provided to update" });
      }

      await db
        .update(organizations)
        .set(updates)
        .where(eq(organizations.id, req.orgSession.orgId));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/org/my-schedule", requireOrgAuth, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId as string;
      const userId = req.orgUser.id as string;

      const myBookings = await db
        .select()
        .from(athleticBookings)
        .where(
          and(
            eq(athleticBookings.organizationId, orgId),
            eq(athleticBookings.orgUserId, userId)
          )
        )
        .orderBy(desc(athleticBookings.date));

      const today = new Date().toISOString().split("T")[0];
      const upcoming = myBookings.filter((b) => b.date >= today);
      const past = myBookings.filter((b) => b.date < today);

      res.json({
        upcoming,
        past,
        user: {
          id: req.orgUser.id,
          name: req.orgUser.name,
          email: req.orgUser.email,
        },
        membership: req.orgMembership,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/org/coach-schedule", requireOrgAuth, async (req: any, res) => {
    try {
      if (req.orgMembership?.role !== "coach") {
        return res.status(403).json({ message: "Coach access required" });
      }

      const orgId = req.orgSession.orgId as string;
      const programId = req.query.programId as string | undefined;

      const conditions: any[] = [eq(athleticBookings.organizationId, orgId)];
      if (programId) conditions.push(eq(athleticBookings.programId, programId));

      const allBookings = await db
        .select()
        .from(athleticBookings)
        .where(and(...conditions))
        .orderBy(desc(athleticBookings.date));

      const today = new Date().toISOString().split("T")[0];

      const enriched = await Promise.all(
        allBookings.map(async (b) => {
          if (!b.orgUserId) return { ...b, bookerName: b.bookedBy || null, isTracked: false };
          const [user] = await db
            .select({ name: orgUsers.name, email: orgUsers.email })
            .from(orgUsers)
            .where(eq(orgUsers.id, b.orgUserId))
            .limit(1);
          return { ...b, bookerName: user?.name || b.bookedBy || null, isTracked: true };
        })
      );

      const upcoming = enriched.filter((b) => b.date >= today);
      const past = enriched.filter((b) => b.date < today);

      res.json({ upcoming, past, total: allBookings.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Portal Bootstrap ──────────────────────────────────────────────────────
  app.get("/api/org/portal/bootstrap", requireOrgAuth, async (req: any, res: Response) => {
    try {
      const { user, membership } = req.orgAuth;
      const orgId = membership.orgId;
      const userId = user.id;
      const isCoach = membership.role === "coach" || membership.role === "owner";

      // Org info
      const [org] = await db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          logoUrl: organizations.logoUrl,
          tagline: organizations.tagline,
          primaryColor: organizations.primaryColor,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      // All active programs
      const programs = await db
        .select()
        .from(athleticPrograms)
        .where(and(eq(athleticPrograms.organizationId, orgId), eq(athleticPrograms.active, true)))
        .orderBy(asc(athleticPrograms.name));

      const schedulingPrograms = programs.filter((p) => p.type === "scheduling" || !p.type);
      const prTrackerPrograms = programs.filter((p) => p.type === "pr_tracker");
      const workoutBuilderPrograms = programs.filter((p) => p.type === "workout_builder");
      const hasPrTracker = prTrackerPrograms.length > 0;

      // Bookings
      const today = new Date().toISOString().split("T")[0];
      const allBookings = await db
        .select({
          id: athleticBookings.id,
          date: athleticBookings.date,
          timeSlot: athleticBookings.timeSlot,
          teamName: athleticBookings.teamName,
          trainingType: athleticBookings.trainingType,
          programId: athleticBookings.programId,
        })
        .from(athleticBookings)
        .where(and(eq(athleticBookings.organizationId, orgId), eq(athleticBookings.orgUserId, userId)))
        .orderBy(asc(athleticBookings.date));

      const upcomingBookings = allBookings.filter((b) => b.date >= today);
      const pastBookingCount = allBookings.filter((b) => b.date < today).length;

      // User teams (join pr_team_members + pr_teams)
      const teamMemberships = await db
        .select({
          teamId: prTeams.id,
          teamName: prTeams.name,
          sport: prTeams.sport,
          season: prTeams.season,
          memberRole: prTeamMembers.role,
        })
        .from(prTeamMembers)
        .innerJoin(prTeams, eq(prTeamMembers.teamId, prTeams.id))
        .where(and(eq(prTeamMembers.userId, userId), eq(prTeamMembers.orgId, orgId)));

      // Recent PR entries + best PRs (if hasPrTracker)
      let recentPrEntries: any[] = [];
      let bestPrs: any[] = [];

      if (hasPrTracker) {
        const allEntries = await db
          .select({
            id: prLiftEntries.id,
            liftTypeId: prLiftEntries.liftTypeId,
            value: prLiftEntries.value,
            unit: prLiftEntries.unit,
            entryDate: prLiftEntries.entryDate,
            liftTypeName: prLiftTypes.name,
            liftTypeCategory: prLiftTypes.category,
          })
          .from(prLiftEntries)
          .innerJoin(prLiftTypes, eq(prLiftEntries.liftTypeId, prLiftTypes.id))
          .where(and(eq(prLiftEntries.userId, userId), eq(prLiftEntries.orgId, orgId)))
          .orderBy(desc(prLiftEntries.createdAt));

        recentPrEntries = allEntries.slice(0, 5);

        // Best per lift type (max value)
        const byLiftType: Record<string, any> = {};
        for (const e of allEntries) {
          if (!byLiftType[e.liftTypeId] || e.value > byLiftType[e.liftTypeId].value) {
            byLiftType[e.liftTypeId] = e;
          }
        }
        bestPrs = Object.values(byLiftType).map((e) => ({
          liftTypeId: e.liftTypeId,
          liftTypeName: e.liftTypeName,
          value: e.value,
          unit: e.unit,
          category: e.liftTypeCategory,
        }));
      }

      // Coach aggregates
      let coachExtras: any = {};
      if (isCoach) {
        const [athleteRows, teamRows, bookingRows] = await Promise.all([
          db
            .select({ id: orgMemberships.id })
            .from(orgMemberships)
            .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "athlete"))),
          db
            .select({ id: prTeams.id })
            .from(prTeams)
            .where(eq(prTeams.orgId, orgId)),
          db
            .select({ id: athleticBookings.id })
            .from(athleticBookings)
            .where(eq(athleticBookings.organizationId, orgId)),
        ]);
        coachExtras = {
          totalAthletes: athleteRows.length,
          totalTeams: teamRows.length,
          totalBookings: bookingRows.length,
        };
      }

      res.json({
        org,
        user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
        membership: {
          role: membership.role,
          status: membership.status,
          orgId: membership.orgId,
          createdAt: membership.createdAt,
        },
        upcomingBookings,
        pastBookingCount,
        schedulingPrograms,
        prTrackerPrograms,
        workoutBuilderPrograms,
        hasPrTracker,
        userTeams: teamMemberships,
        recentPrEntries,
        bestPrs,
        ...coachExtras,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
