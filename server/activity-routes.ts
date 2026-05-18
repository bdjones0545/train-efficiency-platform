import type { Express } from "express";
import { db } from "./db";
import {
  orgActivityEvents,
  userProfiles,
  prLiftEntries,
  prLiftTypes,
  workoutCompletionLogs,
  workoutReadinessCheckins,
  orgMessages,
  orgNotifications,
} from "@shared/schema";
import { eq, and, gte, lte, desc, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  createActivityEvent,
  queryActivityEvents,
  groupEventsByDate,
  type ActivitySourceType,
} from "./services/activity-timeline";

// ─── Auth helpers (same pattern as org-communication-routes) ──────────────────

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
    if (!["ADMIN", "COACH"].includes(profile.role ?? "")) return res.status(403).json({ message: "Forbidden" });
    (req as any)._profile = profile;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function registerActivityRoutes(app: Express) {

  // GET /api/org/activity/events — filterable event feed
  app.get("/api/org/activity/events", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const isCoach = ["ADMIN", "COACH"].includes(profile.role ?? "");
      const {
        userId: qUser, teamId: qTeam, sourceType: qSource,
        startDate: qStart, endDate: qEnd,
        limit: qLimit, offset: qOffset,
      } = req.query as any;

      const opts: any = {
        orgId: profile.organizationId,
        limit: Math.min(parseInt(qLimit ?? "100"), 200),
        offset: parseInt(qOffset ?? "0"),
      };

      // Athlete can only see their own events
      if (!isCoach) {
        opts.userId = profile.userId;
        opts.visibility = ["athlete"];
      } else {
        if (qUser) opts.userId = qUser;
        if (qTeam) opts.teamId = qTeam;
        opts.visibility = ["athlete", "coach", "owner"];
      }

      if (qSource) {
        opts.sourceType = qSource.includes(",") ? qSource.split(",") : qSource;
      }
      if (qStart) opts.startDate = new Date(qStart);
      if (qEnd)   opts.endDate   = new Date(qEnd);

      const events = await queryActivityEvents(opts);
      const grouped = groupEventsByDate(events);
      res.json({ events, grouped, total: events.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/org/activity/calendar — calendar view (today/week/month)
  app.get("/api/org/activity/calendar", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const isCoach = ["ADMIN", "COACH"].includes(profile.role ?? "");
      const { view = "week", userId: qUser } = req.query as any;

      const now = new Date();
      let start: Date, end: Date;

      if (view === "today") {
        start = new Date(now); start.setHours(0, 0, 0, 0);
        end   = new Date(now); end.setHours(23, 59, 59, 999);
      } else if (view === "month") {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      } else {
        // week — Mon–Sun of current week
        const dow = now.getDay();
        const diff = dow === 0 ? -6 : 1 - dow;
        start = new Date(now); start.setDate(now.getDate() + diff); start.setHours(0, 0, 0, 0);
        end   = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
      }

      const opts: any = { orgId: profile.organizationId, startDate: start, endDate: end, limit: 500 };
      if (!isCoach) {
        opts.userId = profile.userId;
        opts.visibility = ["athlete"];
      } else {
        if (qUser) opts.userId = qUser;
        opts.visibility = ["athlete", "coach", "owner"];
      }

      const events = await queryActivityEvents(opts);
      const grouped = groupEventsByDate(events);

      res.json({
        events,
        grouped,
        view,
        periodStart: start.toISOString(),
        periodEnd:   end.toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/org/activity/athlete/:userId — full athlete performance story (coach only)
  app.get("/api/org/activity/athlete/:userId", requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { userId } = req.params;
      const { sourceType: qSource, limit: qLimit } = req.query as any;

      const opts: any = {
        orgId: profile.organizationId,
        userId,
        visibility: ["athlete", "coach", "owner"],
        limit: Math.min(parseInt(qLimit ?? "200"), 500),
      };
      if (qSource) opts.sourceType = qSource.includes(",") ? qSource.split(",") : qSource;

      const events = await queryActivityEvents(opts);
      const grouped = groupEventsByDate(events);

      // Aggregate stats
      const prEvents  = events.filter((e) => e.sourceType === "pr");
      const wkEvents  = events.filter((e) => e.sourceType === "workout" && e.eventType === "workout_completed");
      const rdEvents  = events.filter((e) => e.sourceType === "readiness");
      const avgReadiness = rdEvents.length > 0
        ? (rdEvents.reduce((sum, e) => sum + ((e.metadata as any)?.readinessScore ?? 5), 0) / rdEvents.length).toFixed(1)
        : null;

      res.json({
        events,
        grouped,
        stats: {
          totalEvents:      events.length,
          totalPrs:         prEvents.length,
          totalCompletions: wkEvents.length,
          totalCheckins:    rdEvents.length,
          avgReadiness,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/org/activity/events — manually log an activity event (coach/admin)
  app.post("/api/org/activity/events", requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const schema = z.object({
        userId:      z.string().optional(),
        teamId:      z.string().optional(),
        sourceType:  z.string(),
        sourceId:    z.string().optional(),
        eventType:   z.string(),
        title:       z.string().min(1),
        description: z.string().optional(),
        eventDate:   z.string().optional(),
        metadata:    z.record(z.any()).optional(),
        visibility:  z.enum(["athlete", "coach", "owner"]).optional(),
      });
      const body = schema.parse(req.body);
      const id = await createActivityEvent({
        orgId: profile.organizationId,
        ...body,
        sourceType: body.sourceType as ActivitySourceType,
        eventDate: body.eventDate ? new Date(body.eventDate) : undefined,
      });
      res.json({ id });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // GET /api/org/activity/coach/timeline — coach org-wide chronological feed
  app.get("/api/org/activity/coach/timeline", requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { sourceType: qSource, limit: qLimit, days: qDays } = req.query as any;
      const days = parseInt(qDays ?? "14");
      const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const opts: any = {
        orgId: profile.organizationId,
        startDate: start,
        visibility: ["athlete", "coach", "owner"],
        limit: Math.min(parseInt(qLimit ?? "150"), 300),
      };
      if (qSource) opts.sourceType = qSource.includes(",") ? qSource.split(",") : qSource;

      const events = await queryActivityEvents(opts);
      const grouped = groupEventsByDate(events);

      // Quick stats for the period
      const byType: Record<string, number> = {};
      for (const ev of events) byType[ev.sourceType] = (byType[ev.sourceType] ?? 0) + 1;

      res.json({ events, grouped, byType, days, total: events.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
