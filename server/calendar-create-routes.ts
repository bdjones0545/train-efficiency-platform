import type { Express, Response } from "express";
import { db } from "./db";
import {
  orgUsers,
  orgMemberships,
  prTeams,
  prTeamMembers,
  athleticBookings,
} from "@shared/schema";
import { eq, and, isNull, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { resolveOrgSession } from "./org-auth";
import { createActivityEvent } from "./services/activity-timeline";

async function requireOrgSession(req: any, res: Response, next: any) {
  try {
    const session = await resolveOrgSession(req);
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    req._calAuth = session;
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
  }
}

export function registerCalendarCreateRoutes(app: Express) {

  // ── GET /api/org/calendar/targets ──────────────────────────────────────────
  // Returns permission-scoped athletes, teams, and coaches the caller can target.
  app.get("/api/org/calendar/targets", requireOrgSession, async (req: any, res: Response) => {
    try {
      const { user, membership } = req._calAuth;
      const orgId = membership.orgId;
      const role = membership.role;
      const isAdmin = ["admin", "owner"].includes(role);
      const isCoach = role === "coach";

      let athletes: { id: string; name: string; email: string }[] = [];
      let teams: { id: string; name: string; sport: string | null }[] = [];
      let coaches: { id: string; name: string }[] = [];

      if (isAdmin) {
        const memberRows = await db
          .select({ id: orgUsers.id, name: orgUsers.name, email: orgUsers.email, memberRole: orgMemberships.role })
          .from(orgMemberships)
          .innerJoin(orgUsers, eq(orgMemberships.userId, orgUsers.id))
          .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.status, "active")));

        athletes = memberRows
          .filter((m) => !["coach", "admin", "owner", "staff"].includes(m.memberRole ?? ""))
          .map((m) => ({ id: m.id, name: m.name ?? "Unknown", email: m.email ?? "" }));

        coaches = memberRows
          .filter((m) => ["coach", "admin", "owner"].includes(m.memberRole ?? ""))
          .map((m) => ({ id: m.id, name: m.name ?? "Unknown" }));

        teams = await db
          .select({ id: prTeams.id, name: prTeams.name, sport: prTeams.sport })
          .from(prTeams)
          .where(and(eq(prTeams.orgId, orgId), isNull(prTeams.archivedAt)));

      } else if (isCoach) {
        const coachTeams = await db
          .select({ id: prTeams.id, name: prTeams.name, sport: prTeams.sport })
          .from(prTeams)
          .where(and(eq(prTeams.orgId, orgId), eq(prTeams.coachUserId, user.id), isNull(prTeams.archivedAt)));

        teams = coachTeams;

        if (coachTeams.length > 0) {
          const teamIds = coachTeams.map((t) => t.id);
          const memberRows = await db
            .select({ id: orgUsers.id, name: orgUsers.name, email: orgUsers.email })
            .from(prTeamMembers)
            .innerJoin(orgUsers, eq(prTeamMembers.userId, orgUsers.id))
            .where(inArray(prTeamMembers.teamId, teamIds));

          const seen = new Set<string>();
          athletes = memberRows.filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          }).map((m) => ({ id: m.id, name: m.name ?? "Unknown", email: m.email ?? "" }));
        }
      } else {
        athletes = [{ id: user.id, name: "Myself", email: "" }];
      }

      res.json({ athletes, teams, coaches, isAdmin, isCoach, role });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/calendar/events — custom note / calendar event ────────────
  app.post("/api/org/calendar/events", requireOrgSession, async (req: any, res: Response) => {
    try {
      const { user, membership } = req._calAuth;
      const orgId = membership.orgId;
      const isCoachOrAdmin = ["admin", "owner", "coach"].includes(membership.role);

      const body = z.object({
        title:       z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        eventDate:   z.string(),
        athleteId:   z.string().optional(),
        teamId:      z.string().optional(),
        orgWide:     z.boolean().optional(),
      }).parse(req.body);

      const id = await createActivityEvent({
        orgId,
        userId:      body.orgWide ? undefined : (body.athleteId || user.id),
        teamId:      body.teamId,
        sourceType:  "system",
        eventType:   "calendar_event_created",
        title:       body.title,
        description: body.description,
        eventDate:   new Date(body.eventDate),
        metadata:    { createdBy: user.id, orgWide: body.orgWide },
        visibility:  isCoachOrAdmin ? "coach" : "athlete",
      });

      res.json({ success: true, id });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ── POST /api/org/calendar/bookings — session booking ──────────────────────
  app.post("/api/org/calendar/bookings", requireOrgSession, async (req: any, res: Response) => {
    try {
      const { user, membership } = req._calAuth;
      const orgId = membership.orgId;

      const isCoachOrAdmin = ["admin", "owner", "coach"].includes(membership.role);
      const body = z.object({
        title:        z.string().max(200).optional(),
        athleteId:    z.string().optional(),
        teamId:       z.string().optional(),
        teamName:     z.string().optional(),
        date:         z.string(),
        timeSlot:     z.string(),
        trainingType: z.string().default("strength"),
        notes:        z.string().max(1000).optional(),
      }).parse(req.body);

      if (body.athleteId && body.athleteId !== user.id && !isCoachOrAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const [booking] = await db.insert(athleticBookings).values({
        organizationId: orgId,
        programId:      orgId,
        date:           body.date,
        timeSlot:       body.timeSlot,
        teamName:       body.teamName || "General",
        trainingType:   body.trainingType,
        bookedBy:       user.id,
        orgUserId:      body.athleteId || user.id,
      }).returning();

      const titleText = body.title || `${body.trainingType.charAt(0).toUpperCase() + body.trainingType.slice(1)} Session — ${body.date} at ${body.timeSlot}`;

      const timePart = body.timeSlot.includes(":")
        ? body.timeSlot.replace(/[^0-9:]/g, "").substring(0, 5)
        : "08:00";

      const id = await createActivityEvent({
        orgId,
        userId:      body.athleteId || user.id,
        teamId:      body.teamId,
        sourceType:  "booking",
        sourceId:    booking.id,
        eventType:   "booking_created",
        title:       titleText,
        description: body.notes,
        eventDate:   new Date(`${body.date}T${timePart}:00`),
        metadata:    { bookingId: booking.id, trainingType: body.trainingType, timeSlot: body.timeSlot, createdBy: user.id },
        visibility:  "athlete",
      });

      res.json({ success: true, bookingId: booking.id, activityId: id });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ── POST /api/org/calendar/messages — scheduled message ────────────────────
  app.post("/api/org/calendar/messages", requireOrgSession, async (req: any, res: Response) => {
    try {
      const { user, membership } = req._calAuth;
      const orgId = membership.orgId;

      if (!["admin", "owner", "coach"].includes(membership.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const body = z.object({
        title:       z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        eventDate:   z.string(),
        athleteId:   z.string().optional(),
        teamId:      z.string().optional(),
        orgWide:     z.boolean().optional(),
      }).parse(req.body);

      const id = await createActivityEvent({
        orgId,
        userId:      body.athleteId,
        teamId:      body.teamId,
        sourceType:  "message",
        eventType:   "message_scheduled",
        title:       body.title,
        description: body.description,
        eventDate:   new Date(body.eventDate),
        metadata:    { createdBy: user.id, orgWide: body.orgWide },
        visibility:  "coach",
      });

      res.json({ success: true, id });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ── POST /api/org/calendar/readiness-reminders ─────────────────────────────
  app.post("/api/org/calendar/readiness-reminders", requireOrgSession, async (req: any, res: Response) => {
    try {
      const { user, membership } = req._calAuth;
      const orgId = membership.orgId;

      if (!["admin", "owner", "coach"].includes(membership.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const body = z.object({
        title:       z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        eventDate:   z.string(),
        athleteId:   z.string().optional(),
        teamId:      z.string().optional(),
        orgWide:     z.boolean().optional(),
      }).parse(req.body);

      const id = await createActivityEvent({
        orgId,
        userId:      body.athleteId,
        teamId:      body.teamId,
        sourceType:  "readiness",
        eventType:   "readiness_reminder_scheduled",
        title:       body.title,
        description: body.description,
        eventDate:   new Date(body.eventDate),
        metadata:    { createdBy: user.id, orgWide: body.orgWide },
        visibility:  "coach",
      });

      res.json({ success: true, id });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ── POST /api/org/calendar/workouts — workout assignment ───────────────────
  app.post("/api/org/calendar/workouts", requireOrgSession, async (req: any, res: Response) => {
    try {
      const { user, membership } = req._calAuth;
      const orgId = membership.orgId;

      if (!["admin", "owner", "coach"].includes(membership.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const body = z.object({
        title:       z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        eventDate:   z.string(),
        athleteId:   z.string().optional(),
        teamId:      z.string().optional(),
        orgWide:     z.boolean().optional(),
      }).parse(req.body);

      const id = await createActivityEvent({
        orgId,
        userId:      body.athleteId,
        teamId:      body.teamId,
        sourceType:  "workout",
        eventType:   "workout_scheduled",
        title:       body.title,
        description: body.description,
        eventDate:   new Date(body.eventDate),
        metadata:    { createdBy: user.id, orgWide: body.orgWide },
        visibility:  "athlete",
      });

      res.json({ success: true, id });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });
}
