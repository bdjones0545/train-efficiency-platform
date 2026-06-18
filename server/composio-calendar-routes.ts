/**
 * Composio Google Calendar Routes — Phase 2D
 * ─────────────────────────────────────────────────────────────────────────────
 * Follows the exact approval-gated architecture from Gmail Drafts (Phase 2B)
 * and Slack Alerts (Phase 2C).
 *
 * READ endpoints (no approval, execute immediately via Composio):
 *   GET  /api/composio/calendar/calendars       — list connected calendars
 *   GET  /api/composio/calendar/events          — list upcoming events
 *   POST /api/composio/calendar/availability    — find free slots
 *
 * WRITE endpoints (approval flow):
 *   POST /api/composio/calendar/create          — queue event creation
 *   POST /api/composio/calendar/update          — queue event update
 *   POST /api/composio/calendar/delete          — queue event deletion
 *   GET  /api/composio/calendar/pending         — list pending actions (ADMIN)
 *   GET  /api/composio/calendar/all             — full history (ADMIN)
 *   POST /api/composio/calendar/approve/:id     — approve → Composio executes
 *   POST /api/composio/calendar/reject/:id      — reject with reason + learning signal
 *
 * Approval flow (writes):
 *   request → adapter → event_queued → ADMIN approve
 *           → executeComposioAction → Google event confirmed
 *           → status = event_created | event_updated | event_deleted
 *
 * On Composio failure: status stays event_queued (retryable via approve again).
 *
 * Composio actions used:
 *   GOOGLECALENDAR_LIST_CALENDARS
 *   GOOGLECALENDAR_EVENTS_LIST
 *   GOOGLECALENDAR_FIND_FREE_SLOTS
 *   GOOGLECALENDAR_CREATE_EVENT
 *   GOOGLECALENDAR_UPDATE_EVENT
 *   GOOGLECALENDAR_DELETE_EVENT
 */

import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { agentOperatingTimeline } from "@shared/schema";
import { requestComposioAction } from "./composio-action-adapter";
import { executeComposioAction } from "./services/composio-service";
import { emitComposioHermesEvent } from "./composio-hermes-emitter";
import { resolveOrgIdOrThrow } from "./lib/resolve-org-id";
import { z } from "zod";

// ─── Permitted agents ─────────────────────────────────────────────────────────

export const CALENDAR_PERMITTED_AGENTS = [
  "scheduling_agent",
  "ceo_heartbeat",
  "executive_agent",
  "revenue_agent",
] as const;

export type CalendarPermittedAgent = typeof CALENDAR_PERMITTED_AGENTS[number];

// ─── Action type → Composio action mapping ───────────────────────────────────

const ACTION_MAP = {
  create_event:  "GOOGLECALENDAR_CREATE_EVENT",
  update_event:  "GOOGLECALENDAR_UPDATE_EVENT",
  delete_event:  "GOOGLECALENDAR_DELETE_EVENT",
} as const;

type CalendarActionType = keyof typeof ACTION_MAP;

// ─── Completed status per action type ────────────────────────────────────────

const COMPLETED_STATUS: Record<CalendarActionType, string> = {
  create_event: "event_created",
  update_event: "event_updated",
  delete_event: "event_deleted",
};

// ─── Table setup ──────────────────────────────────────────────────────────────

export async function ensureCalendarTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS composio_calendar_requests (
      id                VARCHAR(128)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id            VARCHAR(256)  NOT NULL,
      agent_id          VARCHAR(128)  NOT NULL,
      action_type       VARCHAR(64)   NOT NULL,
      title             TEXT,
      description       TEXT,
      location          TEXT,
      start_datetime    TEXT,
      end_datetime      TEXT,
      timezone          VARCHAR(128),
      attendees         JSONB,
      calendar_id       VARCHAR(256)  DEFAULT 'primary',
      event_id          TEXT,
      google_event_id   TEXT,
      purpose           TEXT          NOT NULL,
      risk_level        VARCHAR(32)   NOT NULL DEFAULT 'medium',
      approval_queue_id VARCHAR(128),
      status            VARCHAR(64)   NOT NULL DEFAULT 'event_queued',
      approved_by       TEXT,
      approved_at       TIMESTAMP,
      executed_at       TIMESTAMP,
      rejected_reason   TEXT,
      error_message     TEXT,
      payload           JSONB,
      metadata          JSONB,
      created_at        TIMESTAMP     DEFAULT NOW(),
      updated_at        TIMESTAMP     DEFAULT NOW()
    )
  `);
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const agentIdSchema = z.enum(CALENDAR_PERMITTED_AGENTS, {
  errorMap: () => ({
    message: `agentId must be one of: ${CALENDAR_PERMITTED_AGENTS.join(", ")}`,
  }),
});

const createEventSchema = z.object({
  agentId: agentIdSchema,
  title:          z.string().min(1, "title is required").max(500),
  start:          z.string().min(1, "start datetime is required"),
  end:            z.string().optional(),
  durationHours:  z.number().int().min(0).max(24).optional(),
  durationMinutes: z.number().int().min(0).max(59).optional(),
  attendees:      z.array(z.string().email()).optional().default([]),
  location:       z.string().max(1000).optional(),
  description:    z.string().max(5000).optional(),
  calendarId:     z.string().default("primary"),
  timezone:       z.string().optional(),
  purpose:        z.string().min(1, "purpose is required").max(1000),
  riskLevel:      z.enum(["low", "medium", "high"]).default("medium"),
});

const updateEventSchema = z.object({
  agentId:        agentIdSchema,
  eventId:        z.string().min(1, "eventId is required"),
  title:          z.string().max(500).optional(),
  start:          z.string().min(1, "start datetime is required"),
  end:            z.string().optional(),
  durationHours:  z.number().int().min(0).max(24).optional(),
  durationMinutes: z.number().int().min(0).max(59).optional(),
  attendees:      z.array(z.string().email()).optional(),
  location:       z.string().max(1000).optional(),
  description:    z.string().max(5000).optional(),
  calendarId:     z.string().default("primary"),
  timezone:       z.string().optional(),
  purpose:        z.string().min(1, "purpose is required").max(1000),
  riskLevel:      z.enum(["low", "medium", "high"]).default("medium"),
});

const deleteEventSchema = z.object({
  agentId:      agentIdSchema,
  eventId:      z.string().min(1, "eventId is required"),
  calendarId:   z.string().default("primary"),
  purpose:      z.string().min(1, "purpose is required").max(1000),
  riskLevel:    z.enum(["low", "medium", "high"]).default("high"),
});

const availabilitySchema = z.object({
  startDate:        z.string().min(1, "startDate is required"),
  endDate:          z.string().min(1, "endDate is required"),
  durationMinutes:  z.number().int().min(15).max(480).default(60),
  calendarIds:      z.array(z.string()).optional().default(["primary"]),
  timezone:         z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractGoogleEventId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as any;
  return (
    d?.id ??
    d?.eventId ??
    d?.event_id ??
    d?.data?.id ??
    d?.result?.id ??
    d?.data?.eventId ??
    null
  );
}

function buildCreateParams(data: z.infer<typeof createEventSchema>) {
  const p: Record<string, unknown> = {
    summary: data.title,
    start_datetime: data.start,
    calendar_id: data.calendarId,
  };
  if (data.end) p.end_datetime = data.end;
  if (data.durationHours !== undefined) p.event_duration_hour = data.durationHours;
  if (data.durationMinutes !== undefined) p.event_duration_minutes = data.durationMinutes;
  if (data.attendees?.length) p.attendees = data.attendees;
  if (data.location) p.location = data.location;
  if (data.description) p.description = data.description;
  if (data.timezone) p.timezone = data.timezone;
  p.create_meeting_room = false;
  return p;
}

function buildUpdateParams(data: z.infer<typeof updateEventSchema>) {
  const p: Record<string, unknown> = {
    event_id: data.eventId,
    start_datetime: data.start,
    calendar_id: data.calendarId,
  };
  if (data.title) p.summary = data.title;
  if (data.end) p.end_datetime = data.end;
  if (data.durationHours !== undefined) p.event_duration_hour = data.durationHours;
  if (data.durationMinutes !== undefined) p.event_duration_minutes = data.durationMinutes;
  if (data.attendees?.length) p.attendees = data.attendees;
  if (data.location) p.location = data.location;
  if (data.description) p.description = data.description;
  if (data.timezone) p.timezone = data.timezone;
  return p;
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerComposioCalendarRoutes(
  app: Express,
  isAuthenticated: any,
  requireRole: any,
): Promise<void> {
  await ensureCalendarTable();
  console.log("[ComposioCalendar] Table ready");

  // ════════════════════════════════════════════════════════════════════════════
  // READ OPERATIONS — no approval, execute directly through Composio
  // ════════════════════════════════════════════════════════════════════════════

  // ── GET /api/composio/calendar/calendars ──────────────────────────────────
  app.get(
    "/api/composio/calendar/calendars",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);

        const result = await executeComposioAction({
          orgId,
          agentId: "scheduling_agent",
          tool: "GOOGLECALENDAR",
          action: "GOOGLECALENDAR_LIST_CALENDARS",
          inputParams: { max_results: 50 },
        });

        if (!result.success) {
          await emitComposioHermesEvent({
            source: "composio", orgId,
            agent: "scheduling_agent", tool: "GOOGLECALENDAR",
            action: "GOOGLECALENDAR_LIST_CALENDARS",
            result: "failure", outcome: "list_calendars_failed",
            metadata: { error: result.error, durationMs: result.durationMs },
          });
          return res.status(502).json({
            success: false,
            message: `Failed to list calendars: ${result.error}`,
            durationMs: result.durationMs,
          });
        }

        await emitComposioHermesEvent({
          source: "composio", orgId,
          agent: "scheduling_agent", tool: "GOOGLECALENDAR",
          action: "GOOGLECALENDAR_LIST_CALENDARS",
          result: "success", outcome: "calendar_availability_checked",
          metadata: { durationMs: result.durationMs },
        });

        const raw = result.data as any;
        const items: any[] = raw?.items ?? raw?.calendars ?? (Array.isArray(raw) ? raw : []);
        const calendars = items.map((c: any) => ({
          id: c.id ?? c.calendar_id ?? "",
          name: c.summary ?? c.name ?? c.id ?? "",
          primary: c.primary ?? false,
          timezone: c.timeZone ?? c.timezone ?? "",
          accessRole: c.accessRole ?? "",
        }));

        res.json({ success: true, calendars, count: calendars.length, durationMs: result.durationMs });
      } catch (e: any) {
        console.error("[ComposioCalendar] list calendars failed:", e.message);
        res.status(500).json({ message: "Failed to list calendars", error: e.message });
      }
    },
  );

  // ── GET /api/composio/calendar/events ─────────────────────────────────────
  // Query params: calendarId, startDate, endDate, maxResults
  app.get(
    "/api/composio/calendar/events",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);

        const calendarId  = (req.query.calendarId  as string) || "primary";
        const startDate   = req.query.startDate as string | undefined;
        const endDate     = req.query.endDate   as string | undefined;
        const maxResults  = Math.min(parseInt(String(req.query.maxResults ?? "50"), 10), 250);

        const inputParams: Record<string, unknown> = {
          calendarId,
          maxResults,
          singleEvents: true,
          orderBy: "startTime",
        };
        if (startDate) inputParams.timeMin = startDate;
        if (endDate)   inputParams.timeMax = endDate;

        const result = await executeComposioAction({
          orgId,
          agentId: "scheduling_agent",
          tool: "GOOGLECALENDAR",
          action: "GOOGLECALENDAR_EVENTS_LIST",
          inputParams,
        });

        if (!result.success) {
          await emitComposioHermesEvent({
            source: "composio", orgId,
            agent: "scheduling_agent", tool: "GOOGLECALENDAR",
            action: "GOOGLECALENDAR_EVENTS_LIST",
            result: "failure", outcome: "list_events_failed",
            metadata: { error: result.error, durationMs: result.durationMs },
          });
          return res.status(502).json({
            success: false,
            message: `Failed to list events: ${result.error}`,
            durationMs: result.durationMs,
          });
        }

        await emitComposioHermesEvent({
          source: "composio", orgId,
          agent: "scheduling_agent", tool: "GOOGLECALENDAR",
          action: "GOOGLECALENDAR_EVENTS_LIST",
          result: "success", outcome: "calendar_availability_checked",
          metadata: { calendarId, startDate, endDate, durationMs: result.durationMs },
        });

        const raw = result.data as any;
        const items: any[] = raw?.items ?? (Array.isArray(raw) ? raw : []);
        const events = items.map((e: any) => ({
          id:        e.id ?? "",
          title:     e.summary ?? e.title ?? "(no title)",
          start:     e.start?.dateTime ?? e.start?.date ?? "",
          end:       e.end?.dateTime   ?? e.end?.date   ?? "",
          location:  e.location ?? null,
          attendees: (e.attendees ?? []).map((a: any) => a.email ?? a),
          status:    e.status ?? "",
          htmlLink:  e.htmlLink ?? null,
        }));

        res.json({ success: true, events, count: events.length, calendarId, durationMs: result.durationMs });
      } catch (e: any) {
        console.error("[ComposioCalendar] list events failed:", e.message);
        res.status(500).json({ message: "Failed to list events", error: e.message });
      }
    },
  );

  // ── POST /api/composio/calendar/availability ──────────────────────────────
  // Finds free/available time blocks for scheduling.
  // Powers the Scheduling Agent and booking assistant.
  app.post(
    "/api/composio/calendar/availability",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);

        const parsed = availabilitySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.flatten().fieldErrors,
          });
        }
        const { startDate, endDate, durationMinutes, calendarIds, timezone } = parsed.data;

        const inputParams: Record<string, unknown> = {
          time_min: startDate,
          time_max: endDate,
          items: calendarIds,
        };
        if (timezone) inputParams.timezone = timezone;

        const result = await executeComposioAction({
          orgId,
          agentId: "scheduling_agent",
          tool: "GOOGLECALENDAR",
          action: "GOOGLECALENDAR_FIND_FREE_SLOTS",
          inputParams,
        });

        if (!result.success) {
          await emitComposioHermesEvent({
            source: "composio", orgId,
            agent: "scheduling_agent", tool: "GOOGLECALENDAR",
            action: "GOOGLECALENDAR_FIND_FREE_SLOTS",
            result: "failure", outcome: "availability_check_failed",
            metadata: { error: result.error, durationMs: result.durationMs },
          });
          return res.status(502).json({
            success: false,
            message: `Failed to find availability: ${result.error}`,
            durationMs: result.durationMs,
          });
        }

        await emitComposioHermesEvent({
          source: "composio", orgId,
          agent: "scheduling_agent", tool: "GOOGLECALENDAR",
          action: "GOOGLECALENDAR_FIND_FREE_SLOTS",
          result: "success", outcome: "calendar_availability_checked",
          metadata: { startDate, endDate, durationMinutes, durationMs: result.durationMs },
        });

        const raw = result.data as any;
        const busySlots: any[] = raw?.calendars
          ? Object.values(raw.calendars).flatMap((c: any) => c?.busy ?? [])
          : raw?.busy ?? [];

        res.json({
          success: true,
          busySlots,
          freeSlotCount: raw?.freeSlots?.length ?? 0,
          rawAvailability: raw,
          query: { startDate, endDate, durationMinutes, calendarIds },
          durationMs: result.durationMs,
        });
      } catch (e: any) {
        console.error("[ComposioCalendar] availability failed:", e.message);
        res.status(500).json({ message: "Failed to check availability", error: e.message });
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════════════
  // WRITE OPERATIONS — approval-gated
  // ════════════════════════════════════════════════════════════════════════════

  // ── Shared approval-queue writer ─────────────────────────────────────────
  // Called by create / update / delete request endpoints.
  // Returns { requestId, approvalQueueId } on success or throws.
  async function enqueueCalendarAction(
    orgId: string,
    agentId: string,
    actionType: CalendarActionType,
    purpose: string,
    riskLevel: string,
    payload: Record<string, unknown>,
    extraCols: Record<string, unknown>,
    composioAction: string,
    composioParams: Record<string, unknown>,
    requestedBy: string | null,
  ): Promise<{ requestId: string; approvalQueueId: string | undefined }> {
    const requestId = crypto.randomUUID();

    // Insert pending row first (gives us an ID for adapter metadata)
    await db.execute(sql`
      INSERT INTO composio_calendar_requests (
        id, org_id, agent_id, action_type,
        title, description, location,
        start_datetime, end_datetime, timezone,
        attendees, calendar_id, event_id,
        purpose, risk_level, status,
        payload, metadata, created_at, updated_at
      ) VALUES (
        ${requestId}, ${orgId}, ${agentId}, ${actionType},
        ${(extraCols.title as string) ?? null},
        ${(extraCols.description as string) ?? null},
        ${(extraCols.location as string) ?? null},
        ${(extraCols.start_datetime as string) ?? null},
        ${(extraCols.end_datetime as string) ?? null},
        ${(extraCols.timezone as string) ?? null},
        ${extraCols.attendees ? JSON.stringify(extraCols.attendees) : null}::jsonb,
        ${(extraCols.calendar_id as string) ?? 'primary'},
        ${(extraCols.event_id as string) ?? null},
        ${purpose}, ${riskLevel}, ${'pending_request'},
        ${JSON.stringify(payload)}::jsonb,
        ${JSON.stringify({ requestedBy })}::jsonb,
        NOW(), NOW()
      )
    `);

    const adapterResult = await requestComposioAction({
      orgId,
      agentId,
      tool: "GOOGLECALENDAR",
      action: composioAction,
      inputParams: composioParams,
      confidence: 0.85,
      riskLevel: riskLevel as "low" | "medium" | "high",
      notes: `[${actionType}] ${purpose} (${agentId})`,
    });

    if (adapterResult.outcome !== "queued_for_approval") {
      await db.execute(sql`
        DELETE FROM composio_calendar_requests WHERE id = ${requestId}
      `).catch(() => {});
      throw Object.assign(new Error(adapterResult.message ?? `Adapter rejected: ${adapterResult.outcome}`), {
        outcome: adapterResult.outcome,
        deniedReason: adapterResult.deniedReason,
        httpStatus:
          adapterResult.outcome === "blocked_no_permission"      ? 403 :
          adapterResult.outcome === "blocked_by_policy"          ? 403 :
          adapterResult.outcome === "blocked_action_not_allowed" ? 403 : 400,
      });
    }

    await db.execute(sql`
      UPDATE composio_calendar_requests
      SET
        status             = ${'event_queued'},
        approval_queue_id  = ${adapterResult.approvalQueueId ?? null},
        updated_at         = NOW()
      WHERE id = ${requestId}
    `);

    await db.insert(agentOperatingTimeline).values({
      orgId,
      agentName: agentId,
      systemName: "composio_calendar",
      actionType: "approval_required",
      actionStatus: "requires_approval",
      communicationDomain: "calendar",
      summary: `Calendar ${actionType} queued for approval — ${purpose}`,
      requiresApproval: true,
      approvalStatus: "pending",
      relatedEntityType: "composio_calendar_request",
      relatedEntityId: requestId,
      metadata: { requestId, agentId, actionType, purpose, riskLevel, approvalQueueId: adapterResult.approvalQueueId },
    }).catch(() => {});

    await emitComposioHermesEvent({
      source: "composio", orgId,
      agent: agentId, tool: "GOOGLECALENDAR",
      action: composioAction,
      result: "queued_for_approval", outcome: "pending_approval",
      metadata: { requestId, actionType, purpose, approvalQueueId: adapterResult.approvalQueueId },
    });

    return { requestId, approvalQueueId: adapterResult.approvalQueueId };
  }

  // ── POST /api/composio/calendar/create ────────────────────────────────────
  app.post(
    "/api/composio/calendar/create",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);
        const parsed = createEventSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
        }

        const d = parsed.data;
        const composioParams = buildCreateParams(d);
        const { requestId, approvalQueueId } = await enqueueCalendarAction(
          orgId, d.agentId, "create_event", d.purpose, d.riskLevel,
          composioParams,
          {
            title: d.title, description: d.description ?? null, location: d.location ?? null,
            start_datetime: d.start, end_datetime: d.end ?? null, timezone: d.timezone ?? null,
            attendees: d.attendees, calendar_id: d.calendarId,
          },
          "GOOGLECALENDAR_CREATE_EVENT",
          composioParams,
          req.user?.id ?? null,
        );

        return res.status(202).json({
          success: true,
          message: "Calendar event creation queued for approval.",
          requestId,
          approvalQueueId,
          status: "event_queued",
          preview: { agentId: d.agentId, title: d.title, start: d.start, purpose: d.purpose },
        });
      } catch (e: any) {
        const status = (e as any).httpStatus ?? 500;
        res.status(status).json({
          success: false,
          message: e.message,
          outcome: (e as any).outcome ?? null,
          deniedReason: (e as any).deniedReason ?? null,
        });
      }
    },
  );

  // ── POST /api/composio/calendar/update ────────────────────────────────────
  app.post(
    "/api/composio/calendar/update",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);
        const parsed = updateEventSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
        }

        const d = parsed.data;
        const composioParams = buildUpdateParams(d);
        const { requestId, approvalQueueId } = await enqueueCalendarAction(
          orgId, d.agentId, "update_event", d.purpose, d.riskLevel,
          composioParams,
          {
            title: d.title ?? null, description: d.description ?? null, location: d.location ?? null,
            start_datetime: d.start, end_datetime: d.end ?? null, timezone: d.timezone ?? null,
            attendees: d.attendees ?? null, calendar_id: d.calendarId, event_id: d.eventId,
          },
          "GOOGLECALENDAR_UPDATE_EVENT",
          composioParams,
          req.user?.id ?? null,
        );

        return res.status(202).json({
          success: true,
          message: "Calendar event update queued for approval.",
          requestId,
          approvalQueueId,
          status: "event_queued",
          preview: { agentId: d.agentId, eventId: d.eventId, title: d.title, start: d.start, purpose: d.purpose },
        });
      } catch (e: any) {
        const status = (e as any).httpStatus ?? 500;
        res.status(status).json({
          success: false,
          message: e.message,
          outcome: (e as any).outcome ?? null,
          deniedReason: (e as any).deniedReason ?? null,
        });
      }
    },
  );

  // ── POST /api/composio/calendar/delete ────────────────────────────────────
  app.post(
    "/api/composio/calendar/delete",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);
        const parsed = deleteEventSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
        }

        const d = parsed.data;
        const composioParams: Record<string, unknown> = {
          event_id: d.eventId,
          calendar_id: d.calendarId,
        };
        const { requestId, approvalQueueId } = await enqueueCalendarAction(
          orgId, d.agentId, "delete_event", d.purpose, d.riskLevel,
          composioParams,
          { calendar_id: d.calendarId, event_id: d.eventId },
          "GOOGLECALENDAR_DELETE_EVENT",
          composioParams,
          req.user?.id ?? null,
        );

        return res.status(202).json({
          success: true,
          message: "Calendar event deletion queued for approval.",
          requestId,
          approvalQueueId,
          status: "event_queued",
          preview: { agentId: d.agentId, eventId: d.eventId, purpose: d.purpose },
        });
      } catch (e: any) {
        const status = (e as any).httpStatus ?? 500;
        res.status(status).json({
          success: false,
          message: e.message,
          outcome: (e as any).outcome ?? null,
          deniedReason: (e as any).deniedReason ?? null,
        });
      }
    },
  );

  // ── GET /api/composio/calendar/pending ────────────────────────────────────
  app.get(
    "/api/composio/calendar/pending",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);
        const actionType = req.query.actionType as string | undefined;

        const rows = actionType
          ? await db.execute(sql`
              SELECT * FROM composio_calendar_requests
              WHERE org_id = ${orgId} AND status = 'event_queued' AND action_type = ${actionType}
              ORDER BY created_at DESC
            `)
          : await db.execute(sql`
              SELECT * FROM composio_calendar_requests
              WHERE org_id = ${orgId} AND status = 'event_queued'
              ORDER BY created_at DESC
            `);

        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        res.json({ success: true, requests: items, count: items.length });
      } catch (e: any) {
        console.error("[ComposioCalendar] pending list failed:", e.message);
        res.status(500).json({ message: "Failed to fetch pending calendar requests", error: e.message });
      }
    },
  );

  // ── GET /api/composio/calendar/all ────────────────────────────────────────
  app.get(
    "/api/composio/calendar/all",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);
        const limit  = Math.min(parseInt(String(req.query.limit  ?? "50"),  10), 200);
        const offset = parseInt(String(req.query.offset ?? "0"),  10);
        const statusFilter     = req.query.status     as string | undefined;
        const actionTypeFilter = req.query.actionType as string | undefined;

        let rows;
        if (statusFilter && actionTypeFilter) {
          rows = await db.execute(sql`
            SELECT * FROM composio_calendar_requests
            WHERE org_id = ${orgId} AND status = ${statusFilter} AND action_type = ${actionTypeFilter}
            ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
          `);
        } else if (statusFilter) {
          rows = await db.execute(sql`
            SELECT * FROM composio_calendar_requests
            WHERE org_id = ${orgId} AND status = ${statusFilter}
            ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
          `);
        } else if (actionTypeFilter) {
          rows = await db.execute(sql`
            SELECT * FROM composio_calendar_requests
            WHERE org_id = ${orgId} AND action_type = ${actionTypeFilter}
            ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
          `);
        } else {
          rows = await db.execute(sql`
            SELECT * FROM composio_calendar_requests
            WHERE org_id = ${orgId}
            ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
          `);
        }

        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        res.json({ success: true, requests: items, count: items.length, limit, offset });
      } catch (e: any) {
        console.error("[ComposioCalendar] all list failed:", e.message);
        res.status(500).json({ message: "Failed to fetch calendar requests", error: e.message });
      }
    },
  );

  // ── POST /api/composio/calendar/approve/:id ───────────────────────────────
  // Human gate: ADMIN has reviewed and approves Composio to write to Google Calendar.
  // On Composio failure: status stays event_queued (retryable). No false success.
  app.post(
    "/api/composio/calendar/approve/:id",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);

        const rows = await db.execute(sql`
          SELECT * FROM composio_calendar_requests
          WHERE id = ${req.params.id} AND org_id = ${orgId}
          LIMIT 1
        `);
        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        const request: any = items[0];

        if (!request) return res.status(404).json({ message: "Calendar request not found" });

        if (request.status !== "event_queued") {
          return res.status(400).json({
            message: `Expected status "event_queued", got "${request.status}". Cannot approve.`,
            status: request.status,
          });
        }

        const actionType = request.action_type as CalendarActionType;
        const composioAction = ACTION_MAP[actionType];
        if (!composioAction) {
          return res.status(400).json({ message: `Unknown action_type: ${actionType}` });
        }

        // Rebuild the Composio params from stored columns
        let inputParams: Record<string, unknown>;
        if (actionType === "create_event") {
          inputParams = {
            summary: request.title,
            start_datetime: request.start_datetime,
            calendar_id: request.calendar_id ?? "primary",
            create_meeting_room: false,
          };
          if (request.end_datetime)  inputParams.end_datetime = request.end_datetime;
          if (request.location)      inputParams.location     = request.location;
          if (request.description)   inputParams.description  = request.description;
          if (request.timezone)      inputParams.timezone     = request.timezone;
          if (request.attendees)     inputParams.attendees    = request.attendees;
        } else if (actionType === "update_event") {
          inputParams = {
            event_id: request.event_id,
            start_datetime: request.start_datetime,
            calendar_id: request.calendar_id ?? "primary",
          };
          if (request.title)         inputParams.summary      = request.title;
          if (request.end_datetime)  inputParams.end_datetime = request.end_datetime;
          if (request.location)      inputParams.location     = request.location;
          if (request.description)   inputParams.description  = request.description;
          if (request.timezone)      inputParams.timezone     = request.timezone;
          if (request.attendees)     inputParams.attendees    = request.attendees;
        } else {
          // delete_event
          inputParams = {
            event_id: request.event_id,
            calendar_id: request.calendar_id ?? "primary",
          };
        }

        const execResult = await executeComposioAction({
          orgId,
          agentId: request.agent_id,
          tool: "GOOGLECALENDAR",
          action: composioAction,
          inputParams,
        });

        const googleEventId = execResult.success ? extractGoogleEventId(execResult.data) : null;

        if (!execResult.success) {
          await db.execute(sql`
            UPDATE composio_calendar_requests
            SET error_message = ${execResult.error ?? "Composio execution failed"}, updated_at = NOW()
            WHERE id = ${request.id}
          `).catch(() => {});

          await db.insert(agentOperatingTimeline).values({
            orgId,
            agentName: request.agent_id,
            systemName: "composio_calendar",
            actionType: "error",
            actionStatus: "failed",
            communicationDomain: "calendar",
            summary: `Calendar ${actionType} failed (retryable): ${execResult.error}`,
            requiresApproval: false,
            approvalStatus: "approved",
            relatedEntityType: "composio_calendar_request",
            relatedEntityId: request.id,
            executedAt: new Date(),
            outcomeStatus: "failure",
            errorMessage: execResult.error,
            metadata: { durationMs: execResult.durationMs },
          }).catch(() => {});

          await emitComposioHermesEvent({
            source: "composio", orgId,
            agent: request.agent_id, tool: "GOOGLECALENDAR",
            action: composioAction,
            result: "failure", outcome: "failed_execution",
            metadata: {
              requestId: request.id, actionType,
              durationMs: execResult.durationMs, error: execResult.error,
            },
          });

          return res.status(502).json({
            success: false,
            message: `Composio execution failed: ${execResult.error}`,
            status: "event_queued",
            composioResult: { error: execResult.error, durationMs: execResult.durationMs },
          });
        }

        // Success path
        const completedStatus = COMPLETED_STATUS[actionType];
        await db.execute(sql`
          UPDATE composio_calendar_requests
          SET
            status          = ${completedStatus},
            google_event_id = ${googleEventId},
            approved_by     = ${req.user?.id ?? null},
            approved_at     = NOW(),
            executed_at     = NOW(),
            error_message   = NULL,
            updated_at      = NOW()
          WHERE id = ${request.id}
        `);

        await db.insert(agentOperatingTimeline).values({
          orgId,
          agentName: request.agent_id,
          systemName: "composio_calendar",
          actionType: "workflow_executed",
          actionStatus: "completed",
          communicationDomain: "calendar",
          summary: `Calendar ${actionType} succeeded${googleEventId ? ` (Event ID: ${googleEventId})` : ""}`,
          requiresApproval: false,
          approvalStatus: "approved",
          relatedEntityType: "composio_calendar_request",
          relatedEntityId: request.id,
          executedAt: new Date(),
          outcomeStatus: "success",
          metadata: { googleEventId, durationMs: execResult.durationMs },
        }).catch(() => {});

        const hermesOutcome =
          actionType === "create_event" ? "calendar_event_created" :
          actionType === "update_event" ? "calendar_event_updated" :
          "calendar_event_deleted";

        await emitComposioHermesEvent({
          source: "composio", orgId,
          agent: request.agent_id, tool: "GOOGLECALENDAR",
          action: composioAction,
          result: "success", outcome: hermesOutcome,
          metadata: {
            requestId: request.id, actionType, googleEventId,
            title: request.title, durationMs: execResult.durationMs,
          },
        });

        return res.json({
          success: true,
          message: `Google Calendar ${actionType.replace("_", " ")} completed successfully.`,
          googleEventId,
          status: completedStatus,
          composioResult: { durationMs: execResult.durationMs },
        });
      } catch (e: any) {
        console.error("[ComposioCalendar] approve failed:", e.message);
        res.status(500).json({ message: "Failed to execute calendar action", error: e.message });
      }
    },
  );

  // ── POST /api/composio/calendar/reject/:id ────────────────────────────────
  // Stores rejection reason as a learning signal. Immutable after rejection.
  app.post(
    "/api/composio/calendar/reject/:id",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);
        const reason = String(req.body?.reason ?? "").trim() || "No reason provided";

        const rows = await db.execute(sql`
          SELECT id, status, agent_id, action_type, title FROM composio_calendar_requests
          WHERE id = ${req.params.id} AND org_id = ${orgId}
          LIMIT 1
        `);
        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        const request: any = items[0];

        if (!request) return res.status(404).json({ message: "Calendar request not found" });

        if (request.status !== "event_queued") {
          return res.status(400).json({
            message: `Expected status "event_queued", got "${request.status}". Cannot reject.`,
            status: request.status,
          });
        }

        await db.execute(sql`
          UPDATE composio_calendar_requests
          SET
            status          = ${'rejected'},
            rejected_reason = ${reason},
            updated_at      = NOW()
          WHERE id = ${request.id}
        `);

        await db.insert(agentOperatingTimeline).values({
          orgId,
          agentName: request.agent_id,
          systemName: "composio_calendar",
          actionType: "cancelled",
          actionStatus: "completed",
          communicationDomain: "calendar",
          summary: `Calendar ${request.action_type} rejected by admin: ${reason}`,
          requiresApproval: false,
          approvalStatus: "rejected",
          relatedEntityType: "composio_calendar_request",
          relatedEntityId: request.id,
          metadata: { rejectedBy: req.user?.id ?? null, reason },
        }).catch(() => {});

        // Emit Hermes learning signal
        await emitComposioHermesEvent({
          source: "composio", orgId,
          agent: request.agent_id, tool: "GOOGLECALENDAR",
          action: ACTION_MAP[request.action_type as CalendarActionType] ?? request.action_type,
          result: "blocked", outcome: "human_rejected",
          metadata: {
            requestId: request.id, actionType: request.action_type,
            reason, rejectedBy: req.user?.id ?? null,
          },
        });

        res.json({
          success: true,
          message: "Calendar request rejected.",
          status: "rejected",
          reason,
        });
      } catch (e: any) {
        console.error("[ComposioCalendar] reject failed:", e.message);
        res.status(500).json({ message: "Failed to reject calendar request", error: e.message });
      }
    },
  );

  console.log("[ComposioCalendar] Routes registered");
}
