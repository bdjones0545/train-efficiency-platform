/**
 * Scheduling Calendar Intelligence Routes — Phase 3
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps the Composio Google Calendar integration with scheduling intelligence
 * business logic. All read ops execute immediately. All write ops are
 * approval-gated via the composio_calendar_requests table.
 *
 * Endpoints:
 *   GET  /api/scheduling-intelligence/calendar/availability      — find open slots
 *   GET  /api/scheduling-intelligence/calendar/events            — upcoming events
 *   POST /api/scheduling-intelligence/calendar/suggest-times     — ranked time suggestions
 *   POST /api/scheduling-intelligence/calendar/detect-conflict   — conflict check
 *   POST /api/scheduling-intelligence/calendar/book              — queue event creation
 *   POST /api/scheduling-intelligence/calendar/reschedule        — queue event update
 *   POST /api/scheduling-intelligence/calendar/cancel            — queue event deletion
 *   GET  /api/scheduling-intelligence/calendar/dashboard         — aggregated dashboard data
 *   GET  /api/scheduling-intelligence/calendar/alerts            — scheduling alerts
 */

import type { Express } from "express";
import { z } from "zod";
import { resolveOrgIdOrThrow } from "./lib/resolve-org-id";
import {
  findCalendarAvailability,
  fetchCalendarEvents,
  detectSchedulingConflicts,
  rankTimeSlots,
  buildAvailabilitySummary,
  generateSchedulingAlerts,
  queueEventCreation,
  queueEventUpdate,
  queueEventDeletion,
} from "./services/scheduling-calendar-service";

// ─── Validation schemas ───────────────────────────────────────────────────────

const suggestTimesSchema = z.object({
  startDate:       z.string().min(1, "startDate required"),
  endDate:         z.string().min(1, "endDate required"),
  durationMinutes: z.number().int().min(15).max(480).default(60),
  calendarIds:     z.array(z.string()).optional().default(["primary"]),
  timezone:        z.string().optional(),
  preferenceWindowStart: z.number().int().min(0).max(23).optional().default(9),
  preferenceWindowEnd:   z.number().int().min(0).max(23).optional().default(17),
});

const detectConflictSchema = z.object({
  proposedStart:  z.string().min(1, "proposedStart required"),
  proposedEnd:    z.string().min(1, "proposedEnd required"),
  bufferMinutes:  z.number().int().min(0).max(120).optional().default(15),
  calendarId:     z.string().optional().default("primary"),
});

const bookSchema = z.object({
  title:           z.string().min(1, "title required").max(500),
  start:           z.string().min(1, "start required"),
  end:             z.string().optional(),
  durationHours:   z.number().int().min(0).max(24).optional(),
  durationMinutes: z.number().int().min(1).max(480).optional(),
  attendees:       z.array(z.string().email()).optional().default([]),
  location:        z.string().max(1000).optional(),
  description:     z.string().max(5000).optional(),
  timezone:        z.string().optional(),
  purpose:         z.string().min(1, "purpose required").max(1000),
  riskLevel:       z.enum(["low", "medium", "high"]).optional().default("medium"),
  agentId:         z.string().optional().default("scheduling_agent"),
});

const rescheduleSchema = z.object({
  eventId:         z.string().min(1, "eventId required"),
  start:           z.string().min(1, "start required"),
  end:             z.string().optional(),
  durationHours:   z.number().int().min(0).max(24).optional(),
  durationMinutes: z.number().int().min(1).max(480).optional(),
  title:           z.string().max(500).optional(),
  attendees:       z.array(z.string().email()).optional(),
  location:        z.string().max(1000).optional(),
  description:     z.string().max(5000).optional(),
  timezone:        z.string().optional(),
  purpose:         z.string().min(1, "purpose required").max(1000),
  riskLevel:       z.enum(["low", "medium", "high"]).optional().default("medium"),
  agentId:         z.string().optional().default("scheduling_agent"),
});

const cancelSchema = z.object({
  eventId:     z.string().min(1, "eventId required"),
  calendarId:  z.string().optional().default("primary"),
  purpose:     z.string().min(1, "purpose required").max(1000),
  riskLevel:   z.enum(["low", "medium", "high"]).optional().default("high"),
  agentId:     z.string().optional().default("scheduling_agent"),
});

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerSchedulingCalendarRoutes(
  app: Express,
  isAuthenticated: any,
  requireRole: any,
): Promise<void> {
  const guard = [isAuthenticated, requireRole("COACH", "ADMIN")];
  const adminOnly = [isAuthenticated, requireRole("ADMIN")];

  // ── GET /api/scheduling-intelligence/calendar/availability ────────────────
  // Finds open time blocks in the connected Google Calendar.
  app.get(
    "/api/scheduling-intelligence/calendar/availability",
    ...guard,
    async (req: any, res) => {
      try {
        const orgId         = await resolveOrgIdOrThrow(req);
        const startDate     = (req.query.startDate as string) || new Date().toISOString();
        const endDate       = (req.query.endDate   as string) || new Date(Date.now() + 7 * 86400000).toISOString();
        const durMins       = parseInt(String(req.query.durationMinutes ?? "60"), 10);
        const calendarIds   = req.query.calendarIds ? String(req.query.calendarIds).split(",") : ["primary"];
        const timezone      = req.query.timezone as string | undefined;

        const result = await findCalendarAvailability(orgId, {
          startDate, endDate,
          durationMinutes: durMins,
          calendarIds,
          timezone,
        });

        res.json({
          success: true,
          ...result,
          query: { startDate, endDate, durationMinutes: durMins, calendarIds },
        });
      } catch (e: any) {
        console.error("[SchedCal] availability:", e.message);
        res.status(500).json({ message: "Failed to find availability", error: e.message });
      }
    },
  );

  // ── GET /api/scheduling-intelligence/calendar/events ─────────────────────
  // Lists upcoming events from the connected Google Calendar.
  app.get(
    "/api/scheduling-intelligence/calendar/events",
    ...guard,
    async (req: any, res) => {
      try {
        const orgId       = await resolveOrgIdOrThrow(req);
        const calendarId  = (req.query.calendarId as string) || "primary";
        const days        = Math.min(parseInt(String(req.query.days ?? "7"), 10), 30);
        const maxResults  = Math.min(parseInt(String(req.query.maxResults ?? "30"), 10), 100);
        const now         = new Date();
        const startDate   = now.toISOString();
        const endDate     = new Date(now.getTime() + days * 86400000).toISOString();

        const events = await fetchCalendarEvents(orgId, { calendarId, startDate, endDate, maxResults });

        res.json({
          success: true,
          events,
          count: events.length,
          query: { calendarId, days, maxResults },
        });
      } catch (e: any) {
        console.error("[SchedCal] events:", e.message);
        res.status(500).json({ message: "Failed to fetch events", error: e.message });
      }
    },
  );

  // ── POST /api/scheduling-intelligence/calendar/suggest-times ─────────────
  // Returns ranked time suggestions with Best / Good / Available classifications.
  app.post(
    "/api/scheduling-intelligence/calendar/suggest-times",
    ...guard,
    async (req: any, res) => {
      try {
        const orgId  = await resolveOrgIdOrThrow(req);
        const parsed = suggestTimesSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
        }
        const d = parsed.data;

        // Fetch availability and existing events in parallel
        const [availResult, existingEvents] = await Promise.all([
          findCalendarAvailability(orgId, {
            startDate: d.startDate, endDate: d.endDate,
            durationMinutes: d.durationMinutes,
            calendarIds: d.calendarIds, timezone: d.timezone,
          }),
          fetchCalendarEvents(orgId, {
            calendarId: d.calendarIds[0] ?? "primary",
            startDate: d.startDate, endDate: d.endDate,
            maxResults: 50,
          }),
        ]);

        const ranked = await rankTimeSlots(orgId, {
          freeBlocks: availResult.freeBlocks,
          durationMinutes: d.durationMinutes,
          existingEvents,
          preferenceWindowHours: [d.preferenceWindowStart ?? 9, d.preferenceWindowEnd ?? 17],
        });

        const best      = ranked.filter(s => s.rank === "best");
        const good      = ranked.filter(s => s.rank === "good");
        const available = ranked.filter(s => s.rank === "available");

        res.json({
          success: true,
          suggestions: {
            best:      best.slice(0, 3),
            good:      good.slice(0, 5),
            available: available.slice(0, 10),
          },
          totalSuggestions: ranked.length,
          durationMinutes: d.durationMinutes,
          summary: `Found ${ranked.length} possible slots: ${best.length} best, ${good.length} good, ${available.length} available.`,
          durationMs: availResult.durationMs,
        });
      } catch (e: any) {
        console.error("[SchedCal] suggest-times:", e.message);
        res.status(500).json({ message: "Failed to suggest times", error: e.message });
      }
    },
  );

  // ── POST /api/scheduling-intelligence/calendar/detect-conflict ────────────
  // Checks a proposed time slot against existing Google Calendar events.
  app.post(
    "/api/scheduling-intelligence/calendar/detect-conflict",
    ...guard,
    async (req: any, res) => {
      try {
        const orgId  = await resolveOrgIdOrThrow(req);
        const parsed = detectConflictSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
        }

        const result = await detectSchedulingConflicts(orgId, parsed.data);

        res.json({
          success: true,
          ...result,
          safe: !result.hasConflict && result.bufferViolations.length === 0,
        });
      } catch (e: any) {
        console.error("[SchedCal] detect-conflict:", e.message);
        res.status(500).json({ message: "Failed to check conflicts", error: e.message });
      }
    },
  );

  // ── POST /api/scheduling-intelligence/calendar/book ───────────────────────
  // Queues a Google Calendar event creation. Does NOT create immediately.
  // Returns requestId — admin must approve at /api/composio/calendar/approve/:id
  app.post(
    "/api/scheduling-intelligence/calendar/book",
    ...guard,
    async (req: any, res) => {
      try {
        const orgId  = await resolveOrgIdOrThrow(req);
        const parsed = bookSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
        }
        const d = parsed.data;

        // Auto-conflict check before queuing
        if (d.end || d.durationHours || d.durationMinutes) {
          const proposedEnd = d.end ?? (() => {
            const s = new Date(d.start);
            s.setMinutes(s.getMinutes() + (d.durationHours ?? 0) * 60 + (d.durationMinutes ?? 60));
            return s.toISOString();
          })();
          const conflict = await detectSchedulingConflicts(orgId, {
            proposedStart: d.start, proposedEnd, bufferMinutes: 0,
          });
          if (conflict.hasConflict) {
            return res.status(409).json({
              success: false,
              message: conflict.message,
              conflicts: conflict.conflicts.map(c => ({ id: c.id, title: c.title, start: c.start, end: c.end })),
            });
          }
        }

        const result = await queueEventCreation(orgId, d.agentId, {
          title:           d.title,
          start:           d.start,
          end:             d.end,
          durationHours:   d.durationHours,
          durationMinutes: d.durationMinutes,
          attendees:       d.attendees,
          location:        d.location,
          description:     d.description,
          timezone:        d.timezone,
          purpose:         d.purpose,
          riskLevel:       d.riskLevel,
        });

        if (!result.success) {
          return res.status(403).json({ success: false, message: result.message });
        }

        res.status(202).json({
          success: true,
          message: result.message,
          requestId: result.requestId,
          approvalQueueId: result.approvalQueueId,
          status: "event_queued",
          approvalRequired: true,
          approvalUrl: `/api/composio/calendar/approve/${result.requestId}`,
          preview: { title: d.title, start: d.start, attendees: d.attendees, purpose: d.purpose },
        });
      } catch (e: any) {
        console.error("[SchedCal] book:", e.message);
        res.status(500).json({ message: "Failed to queue booking", error: e.message });
      }
    },
  );

  // ── POST /api/scheduling-intelligence/calendar/reschedule ────────────────
  // Queues a Google Calendar event update. Admin approval required.
  app.post(
    "/api/scheduling-intelligence/calendar/reschedule",
    ...guard,
    async (req: any, res) => {
      try {
        const orgId  = await resolveOrgIdOrThrow(req);
        const parsed = rescheduleSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
        }
        const d = parsed.data;

        const result = await queueEventUpdate(orgId, d.agentId, {
          eventId:         d.eventId,
          start:           d.start,
          end:             d.end,
          durationHours:   d.durationHours,
          durationMinutes: d.durationMinutes,
          title:           d.title,
          attendees:       d.attendees,
          location:        d.location,
          description:     d.description,
          timezone:        d.timezone,
          purpose:         d.purpose,
          riskLevel:       d.riskLevel,
        });

        if (!result.success) {
          return res.status(403).json({ success: false, message: result.message });
        }

        res.status(202).json({
          success: true,
          message: result.message,
          requestId: result.requestId,
          approvalQueueId: result.approvalQueueId,
          status: "event_queued",
          approvalRequired: true,
          approvalUrl: `/api/composio/calendar/approve/${result.requestId}`,
          preview: { eventId: d.eventId, newStart: d.start, purpose: d.purpose },
        });
      } catch (e: any) {
        console.error("[SchedCal] reschedule:", e.message);
        res.status(500).json({ message: "Failed to queue reschedule", error: e.message });
      }
    },
  );

  // ── POST /api/scheduling-intelligence/calendar/cancel ────────────────────
  // Queues a Google Calendar event deletion. Admin approval required.
  app.post(
    "/api/scheduling-intelligence/calendar/cancel",
    ...guard,
    async (req: any, res) => {
      try {
        const orgId  = await resolveOrgIdOrThrow(req);
        const parsed = cancelSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
        }
        const d = parsed.data;

        const result = await queueEventDeletion(orgId, d.agentId, {
          eventId:    d.eventId,
          calendarId: d.calendarId,
          purpose:    d.purpose,
          riskLevel:  d.riskLevel,
        });

        if (!result.success) {
          return res.status(403).json({ success: false, message: result.message });
        }

        res.status(202).json({
          success: true,
          message: result.message,
          requestId: result.requestId,
          approvalQueueId: result.approvalQueueId,
          status: "event_queued",
          approvalRequired: true,
          approvalUrl: `/api/composio/calendar/approve/${result.requestId}`,
          preview: { eventId: d.eventId, purpose: d.purpose },
        });
      } catch (e: any) {
        console.error("[SchedCal] cancel:", e.message);
        res.status(500).json({ message: "Failed to queue cancellation", error: e.message });
      }
    },
  );

  // ── GET /api/scheduling-intelligence/calendar/dashboard ───────────────────
  // Aggregated dashboard data: events + availability summary + alerts.
  // Called by the Scheduling Command Center Calendar Intelligence panel.
  app.get(
    "/api/scheduling-intelligence/calendar/dashboard",
    ...guard,
    async (req: any, res) => {
      try {
        const orgId          = await resolveOrgIdOrThrow(req);
        const durationMinutes = parseInt(String(req.query.durationMinutes ?? "60"), 10);
        const days            = Math.min(parseInt(String(req.query.days ?? "7"), 10), 14);
        const timezone        = req.query.timezone as string | undefined;

        const now      = new Date();
        const endDate  = new Date(now.getTime() + days * 86400000).toISOString();

        const [events, availSummary] = await Promise.all([
          fetchCalendarEvents(orgId, {
            startDate: now.toISOString(),
            endDate,
            maxResults: 50,
          }),
          buildAvailabilitySummary(orgId, { durationMinutes, timezone }).catch(() => null),
        ]);

        const alerts = generateSchedulingAlerts(events);

        res.json({
          success: true,
          events: events.slice(0, 20),
          eventCount: events.length,
          availabilitySummary: availSummary,
          alerts,
          alertCount: alerts.length,
          criticalAlerts: alerts.filter(a => a.severity === "high").length,
          query: { days, durationMinutes, timezone },
          generatedAt: now.toISOString(),
        });
      } catch (e: any) {
        console.error("[SchedCal] dashboard:", e.message);
        res.status(500).json({ message: "Failed to build calendar dashboard", error: e.message });
      }
    },
  );

  // ── GET /api/scheduling-intelligence/calendar/alerts ─────────────────────
  // Scheduling alerts: back-to-back, long gap, double-booking risk, high utilization.
  app.get(
    "/api/scheduling-intelligence/calendar/alerts",
    ...guard,
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);
        const days  = Math.min(parseInt(String(req.query.days ?? "7"), 10), 14);
        const now   = new Date();

        const events = await fetchCalendarEvents(orgId, {
          startDate: now.toISOString(),
          endDate: new Date(now.getTime() + days * 86400000).toISOString(),
          maxResults: 50,
        });

        const alerts = generateSchedulingAlerts(events);

        res.json({
          success: true,
          alerts,
          count: alerts.length,
          critical: alerts.filter(a => a.severity === "high").length,
          medium:   alerts.filter(a => a.severity === "medium").length,
          low:      alerts.filter(a => a.severity === "low").length,
          eventsAnalyzed: events.length,
        });
      } catch (e: any) {
        console.error("[SchedCal] alerts:", e.message);
        res.status(500).json({ message: "Failed to generate alerts", error: e.message });
      }
    },
  );

  console.log("[SchedulingCalendar] Routes registered");
}
