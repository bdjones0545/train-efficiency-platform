/**
 * Scheduling Calendar Intelligence Service — Phase 3
 * ─────────────────────────────────────────────────────────────────────────────
 * Business logic layer that wraps Composio Google Calendar read operations with
 * scheduling intelligence: conflict detection, time ranking, and alert generation.
 *
 * READ ops call executeComposioAction directly (no approval gate).
 * WRITE ops return queued request IDs — they NEVER execute directly.
 *
 * Multi-org isolation: every function takes orgId and passes it to Composio
 * so each org only reads its own connected Google Calendar.
 */

import { executeComposioAction } from "./composio-service";
import { emitComposioHermesEvent } from "../composio-hermes-emitter";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  attendees: string[];
  status: string;
  htmlLink: string | null;
  durationMinutes: number;
}

export interface TimeSlot {
  start: string;
  end: string;
  durationMinutes: number;
  rank: "best" | "good" | "available";
  rankScore: number;
  rankReasons: string[];
}

export interface AvailabilitySummary {
  today: { openSlots: number; busySlots: number; freeBlocks: FreeBlock[] };
  tomorrow: { openSlots: number; busySlots: number; freeBlocks: FreeBlock[] };
  thisWeek: { openSlots: number; busySlots: number; freeBlocks: FreeBlock[] };
  durationMinutes: number;
}

export interface FreeBlock {
  start: string;
  end: string;
  durationMinutes: number;
}

export interface ConflictResult {
  hasConflict: boolean;
  conflicts: CalendarEvent[];
  bufferViolations: CalendarEvent[];
  message: string;
}

export interface SchedulingAlert {
  type: "back_to_back" | "long_gap" | "double_booking_risk" | "high_utilization_day" | "sparse_day";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  affectedEvents: string[];
  metadata: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEventDate(s: string): Date {
  if (!s) return new Date(0);
  return new Date(s);
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

function durationMin(start: string, end: string): number {
  if (!start || !end) return 0;
  return Math.max(0, minutesBetween(parseEventDate(start), parseEventDate(end)));
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function slotsOverlap(
  aStart: Date, aEnd: Date,
  bStart: Date, bEnd: Date,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function isoDate(d: Date): string {
  return d.toISOString();
}

// ─── Core: fetch upcoming events from Composio ────────────────────────────────

export async function fetchCalendarEvents(
  orgId: string,
  opts: {
    calendarId?: string;
    startDate?: string;
    endDate?: string;
    maxResults?: number;
  } = {},
): Promise<CalendarEvent[]> {
  const { calendarId = "primary", startDate, endDate, maxResults = 50 } = opts;

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
      metadata: { error: result.error },
    }).catch(() => {});
    return [];
  }

  const raw = result.data as any;
  const items: any[] = raw?.items ?? (Array.isArray(raw) ? raw : []);

  return items.map((e: any) => ({
    id:       e.id ?? "",
    title:    e.summary ?? e.title ?? "(no title)",
    start:    e.start?.dateTime ?? e.start?.date ?? "",
    end:      e.end?.dateTime   ?? e.end?.date   ?? "",
    location: e.location ?? null,
    attendees: (e.attendees ?? []).map((a: any) => a.email ?? a),
    status:   e.status ?? "confirmed",
    htmlLink: e.htmlLink ?? null,
    durationMinutes: durationMin(
      e.start?.dateTime ?? e.start?.date ?? "",
      e.end?.dateTime   ?? e.end?.date   ?? "",
    ),
  }));
}

// ─── Core: fetch free/busy from Composio ─────────────────────────────────────

export async function fetchFreeBusy(
  orgId: string,
  opts: {
    startDate: string;
    endDate: string;
    calendarIds?: string[];
    timezone?: string;
  },
): Promise<{ busy: { start: string; end: string }[]; free: { start: string; end: string }[] }> {
  const { startDate, endDate, calendarIds = ["primary"], timezone } = opts;

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
      metadata: { error: result.error },
    }).catch(() => {});
    return { busy: [], free: [] };
  }

  const raw = result.data as any;
  const dataObj = raw?.data ?? raw;
  const calendars = dataObj?.calendars ?? {};
  const allBusy: { start: string; end: string }[] = [];
  const allFree: { start: string; end: string }[] = [];

  for (const calData of Object.values(calendars) as any[]) {
    if (calData?.busy)  allBusy.push(...calData.busy);
    if (calData?.free)  allFree.push(...calData.free);
  }

  return { busy: allBusy, free: allFree };
}

// ─── Feature 1: Find Availability ────────────────────────────────────────────

export async function findCalendarAvailability(
  orgId: string,
  opts: {
    startDate: string;
    endDate: string;
    durationMinutes?: number;
    calendarIds?: string[];
    timezone?: string;
  },
): Promise<{
  freeBlocks: FreeBlock[];
  busyCount: number;
  durationMinutes: number;
  durationMs: number;
}> {
  const { startDate, endDate, durationMinutes = 60 } = opts;
  const t0 = Date.now();

  const { busy, free } = await fetchFreeBusy(orgId, opts);

  const freeBlocks: FreeBlock[] = free
    .map(f => ({
      start: f.start,
      end: f.end,
      durationMinutes: durationMin(f.start, f.end),
    }))
    .filter(b => b.durationMinutes >= durationMinutes);

  await emitComposioHermesEvent({
    source: "composio", orgId,
    agent: "scheduling_agent", tool: "GOOGLECALENDAR",
    action: "GOOGLECALENDAR_FIND_FREE_SLOTS",
    result: "success", outcome: "availability_checked",
    metadata: { startDate, endDate, durationMinutes, freeBlocks: freeBlocks.length },
  }).catch(() => {});

  return { freeBlocks, busyCount: busy.length, durationMinutes, durationMs: Date.now() - t0 };
}

// ─── Feature 2: Conflict Detection ───────────────────────────────────────────

export async function detectSchedulingConflicts(
  orgId: string,
  opts: {
    proposedStart: string;
    proposedEnd: string;
    bufferMinutes?: number;
    calendarId?: string;
  },
): Promise<ConflictResult> {
  const { proposedStart, proposedEnd, bufferMinutes = 15, calendarId = "primary" } = opts;

  const pStart = parseEventDate(proposedStart);
  const pEnd   = parseEventDate(proposedEnd);

  // Fetch events in a window around the proposed slot (with buffer)
  const windowStart = new Date(pStart.getTime() - bufferMinutes * 60000);
  const windowEnd   = new Date(pEnd.getTime()   + bufferMinutes * 60000);

  const events = await fetchCalendarEvents(orgId, {
    calendarId,
    startDate: isoDate(windowStart),
    endDate:   isoDate(windowEnd),
    maxResults: 25,
  });

  const conflicts: CalendarEvent[] = [];
  const bufferViolations: CalendarEvent[] = [];

  for (const ev of events) {
    if (!ev.start || !ev.end) continue;
    const evStart = parseEventDate(ev.start);
    const evEnd   = parseEventDate(ev.end);

    if (slotsOverlap(pStart, pEnd, evStart, evEnd)) {
      conflicts.push(ev);
    } else if (slotsOverlap(windowStart, windowEnd, evStart, evEnd)) {
      bufferViolations.push(ev);
    }
  }

  const hasConflict = conflicts.length > 0;

  let message: string;
  if (hasConflict) {
    message = `Conflict detected: ${conflicts.length} event(s) overlap with the proposed time (${conflicts.map(e => `"${e.title}"`).join(", ")}).`;
  } else if (bufferViolations.length > 0) {
    message = `No direct conflict, but ${bufferViolations.length} event(s) are within the ${bufferMinutes}-minute buffer window.`;
  } else {
    message = "No conflicts detected. The proposed time is clear.";
  }

  await emitComposioHermesEvent({
    source: "composio", orgId,
    agent: "scheduling_agent", tool: "GOOGLECALENDAR",
    action: "GOOGLECALENDAR_EVENTS_LIST",
    result: "success",
    outcome: hasConflict ? "conflict_detected" : "booking_requested",
    metadata: { proposedStart, proposedEnd, conflicts: conflicts.length, bufferViolations: bufferViolations.length },
  }).catch(() => {});

  return { hasConflict, conflicts, bufferViolations, message };
}

// ─── Feature 3: Intelligent Time Ranking ─────────────────────────────────────

export async function rankTimeSlots(
  orgId: string,
  opts: {
    freeBlocks: FreeBlock[];
    durationMinutes: number;
    existingEvents?: CalendarEvent[];
    preferenceWindowHours?: [number, number];
  },
): Promise<TimeSlot[]> {
  const {
    freeBlocks,
    durationMinutes,
    existingEvents = [],
    preferenceWindowHours = [9, 17],
  } = opts;

  const [prefStart, prefEnd] = preferenceWindowHours;
  const ranked: TimeSlot[] = [];

  for (const block of freeBlocks) {
    if (block.durationMinutes < durationMinutes) continue;

    const blockStart = parseEventDate(block.start);
    const slotEnd   = new Date(blockStart.getTime() + durationMinutes * 60000);

    const slotStartH = blockStart.getHours();
    const reasons: string[] = [];
    let score = 50;

    // Factor 1: Preferred hours
    if (slotStartH >= prefStart && slotStartH < prefEnd) {
      score += 20;
      reasons.push("within preferred hours");
    } else {
      score -= 10;
      reasons.push("outside preferred hours");
    }

    // Factor 2: Gap minimization — prefer slots that cluster with existing events
    const gapsToExisting = existingEvents
      .filter(e => e.start)
      .map(e => Math.abs(minutesBetween(parseEventDate(e.start), blockStart)));
    if (gapsToExisting.length > 0) {
      const minGap = Math.min(...gapsToExisting);
      if (minGap < 60) {
        score += 15;
        reasons.push("clusters with existing schedule");
      } else if (minGap > 240) {
        score -= 5;
        reasons.push("large gap from existing events");
      }
    }

    // Factor 3: Morning preference (before noon scores slightly higher)
    if (slotStartH >= 8 && slotStartH < 12) {
      score += 10;
      reasons.push("morning slot");
    } else if (slotStartH >= 12 && slotStartH < 15) {
      score += 5;
      reasons.push("early afternoon");
    }

    // Factor 4: Back-to-back detection (penalize)
    const isBackToBack = existingEvents.some(e => {
      if (!e.start || !e.end) return false;
      const evEnd = parseEventDate(e.end);
      return Math.abs(minutesBetween(evEnd, blockStart)) < 5;
    });
    if (isBackToBack) {
      score -= 20;
      reasons.push("back-to-back warning");
    }

    // Factor 5: Buffer adequacy (penalize tiny blocks)
    if (block.durationMinutes > durationMinutes + 30) {
      score += 10;
      reasons.push("good buffer time");
    }

    const rank: TimeSlot["rank"] =
      score >= 75 ? "best" :
      score >= 55 ? "good" :
      "available";

    ranked.push({
      start: block.start,
      end:   isoDate(slotEnd),
      durationMinutes,
      rank,
      rankScore: Math.max(0, Math.min(100, score)),
      rankReasons: reasons,
    });
  }

  return ranked.sort((a, b) => b.rankScore - a.rankScore);
}

// ─── Feature 7: Availability Summary (for dashboard) ─────────────────────────

export async function buildAvailabilitySummary(
  orgId: string,
  opts: { durationMinutes?: number; timezone?: string } = {},
): Promise<AvailabilitySummary> {
  const { durationMinutes = 60, timezone } = opts;
  const now = new Date();

  async function summarizeDay(dayStart: Date): Promise<{ openSlots: number; busySlots: number; freeBlocks: FreeBlock[] }> {
    const dayEnd = endOfDay(dayStart);
    const { busy, free } = await fetchFreeBusy(orgId, {
      startDate: isoDate(dayStart),
      endDate:   isoDate(dayEnd),
      timezone,
    });

    const freeBlocks: FreeBlock[] = free
      .map(f => ({ start: f.start, end: f.end, durationMinutes: durationMin(f.start, f.end) }))
      .filter(b => b.durationMinutes >= durationMinutes);

    return {
      openSlots: freeBlocks.length,
      busySlots: busy.length,
      freeBlocks,
    };
  }

  const weekStart = startOfDay(now);
  const weekEnd   = endOfDay(addDays(now, 6));

  const [today, tomorrow, weekRaw] = await Promise.all([
    summarizeDay(startOfDay(now)),
    summarizeDay(startOfDay(addDays(now, 1))),
    fetchFreeBusy(orgId, { startDate: isoDate(weekStart), endDate: isoDate(weekEnd), timezone }),
  ]);

  const weekFreeBlocks = (weekRaw.free ?? [])
    .map(f => ({ start: f.start, end: f.end, durationMinutes: durationMin(f.start, f.end) }))
    .filter(b => b.durationMinutes >= durationMinutes);

  return {
    today,
    tomorrow,
    thisWeek: {
      openSlots: weekFreeBlocks.length,
      busySlots: weekRaw.busy.length,
      freeBlocks: weekFreeBlocks,
    },
    durationMinutes,
  };
}

// ─── Feature 7: Scheduling Alerts ────────────────────────────────────────────

export function generateSchedulingAlerts(events: CalendarEvent[]): SchedulingAlert[] {
  const alerts: SchedulingAlert[] = [];
  if (!events.length) return alerts;

  // Sort by start time
  const sorted = [...events].filter(e => e.start).sort(
    (a, b) => parseEventDate(a.start).getTime() - parseEventDate(b.start).getTime(),
  );

  // Group events by day
  const byDay = new Map<string, CalendarEvent[]>();
  for (const ev of sorted) {
    const day = ev.start.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(ev);
  }

  // Back-to-back detection (< 5 min buffer)
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    if (!curr.end || !next.start) continue;
    const gap = minutesBetween(parseEventDate(curr.end), parseEventDate(next.start));
    if (gap >= 0 && gap < 5) {
      alerts.push({
        type: "back_to_back",
        severity: "high",
        title: "Back-to-back sessions detected",
        description: `"${curr.title}" ends and "${next.title}" starts with only ${gap} minute(s) between them.`,
        affectedEvents: [curr.id, next.id],
        metadata: { gap, currEnd: curr.end, nextStart: next.start },
      });
    }
  }

  // Long gap detection (> 3 hours between same-day events)
  for (const [day, dayEvents] of byDay) {
    for (let i = 0; i < dayEvents.length - 1; i++) {
      const curr = dayEvents[i];
      const next = dayEvents[i + 1];
      if (!curr.end || !next.start) continue;
      const gap = minutesBetween(parseEventDate(curr.end), parseEventDate(next.start));
      if (gap > 180) {
        alerts.push({
          type: "long_gap",
          severity: "low",
          title: "Long gap in schedule",
          description: `${Math.round(gap / 60)}h gap between "${curr.title}" and "${next.title}" on ${day}.`,
          affectedEvents: [curr.id, next.id],
          metadata: { gap, day },
        });
      }
    }
  }

  // High utilization day (≥ 5 events in one day)
  for (const [day, dayEvents] of byDay) {
    if (dayEvents.length >= 5) {
      alerts.push({
        type: "high_utilization_day",
        severity: "medium",
        title: "High-utilization day",
        description: `${dayEvents.length} events scheduled on ${day}. Consider blocking recovery time.`,
        affectedEvents: dayEvents.map(e => e.id),
        metadata: { day, eventCount: dayEvents.length },
      });
    }
  }

  // Double booking risk — events that overlap
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    if (!curr.start || !curr.end || !next.start || !next.end) continue;
    const currStart = parseEventDate(curr.start);
    const currEnd   = parseEventDate(curr.end);
    const nextStart = parseEventDate(next.start);
    const nextEnd   = parseEventDate(next.end);
    if (slotsOverlap(currStart, currEnd, nextStart, nextEnd)) {
      alerts.push({
        type: "double_booking_risk",
        severity: "high",
        title: "Double-booking risk",
        description: `"${curr.title}" and "${next.title}" overlap in time.`,
        affectedEvents: [curr.id, next.id],
        metadata: { currStart: curr.start, currEnd: curr.end, nextStart: next.start, nextEnd: next.end },
      });
    }
  }

  return alerts;
}

// ─── Feature 4-6: Queue write operations (approval-gated) ────────────────────
// These helpers POST to the composio-calendar-routes internally.
// They return the requestId and approvalQueueId — not the final event.
// The actual Google Calendar mutation only happens after ADMIN approves.

export interface QueueResult {
  success: boolean;
  requestId?: string;
  approvalQueueId?: string;
  message: string;
}

export async function queueEventCreation(
  orgId: string,
  agentId: string,
  opts: {
    title: string;
    start: string;
    end?: string;
    durationHours?: number;
    durationMinutes?: number;
    attendees?: string[];
    location?: string;
    description?: string;
    timezone?: string;
    purpose: string;
    riskLevel?: "low" | "medium" | "high";
  },
): Promise<QueueResult> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");

  const { requestComposioAction } = await import("../composio-action-adapter");
  const { agentOperatingTimeline } = await import("@shared/schema");

  const requestId = crypto.randomUUID();
  const riskLevel = opts.riskLevel ?? "medium";

  const composioParams: Record<string, unknown> = {
    summary: opts.title,
    start_datetime: opts.start,
    calendar_id: "primary",
    create_meeting_room: false,
  };
  if (opts.end)              composioParams.end_datetime          = opts.end;
  if (opts.durationHours)    composioParams.event_duration_hour   = opts.durationHours;
  if (opts.durationMinutes)  composioParams.event_duration_minutes = opts.durationMinutes;
  if (opts.attendees?.length) composioParams.attendees            = opts.attendees;
  if (opts.location)         composioParams.location              = opts.location;
  if (opts.description)      composioParams.description           = opts.description;
  if (opts.timezone)         composioParams.timezone              = opts.timezone;

  await db.execute(sql`
    INSERT INTO composio_calendar_requests (
      id, org_id, agent_id, action_type,
      title, description, location,
      start_datetime, end_datetime, timezone,
      attendees, calendar_id, purpose, risk_level, status,
      payload, metadata, created_at, updated_at
    ) VALUES (
      ${requestId}, ${orgId}, ${agentId}, ${'create_event'},
      ${opts.title}, ${opts.description ?? null}, ${opts.location ?? null},
      ${opts.start}, ${opts.end ?? null}, ${opts.timezone ?? null},
      ${opts.attendees ? JSON.stringify(opts.attendees) : null}::jsonb,
      ${'primary'}, ${opts.purpose}, ${riskLevel}, ${'pending_request'},
      ${JSON.stringify(composioParams)}::jsonb,
      ${JSON.stringify({ source: "scheduling_intelligence_service" })}::jsonb,
      NOW(), NOW()
    )
  `);

  const adapterResult = await requestComposioAction({
    orgId, agentId,
    tool: "GOOGLECALENDAR", action: "GOOGLECALENDAR_CREATE_EVENT",
    inputParams: composioParams,
    confidence: 0.85, riskLevel,
    notes: `[create_event] ${opts.purpose} (${agentId})`,
  });

  if (adapterResult.outcome !== "queued_for_approval") {
    await db.execute(sql`DELETE FROM composio_calendar_requests WHERE id = ${requestId}`).catch(() => {});
    return {
      success: false,
      message: adapterResult.message ?? `Adapter rejected: ${adapterResult.outcome}`,
    };
  }

  await db.execute(sql`
    UPDATE composio_calendar_requests
    SET status = ${'event_queued'}, approval_queue_id = ${adapterResult.approvalQueueId ?? null}, updated_at = NOW()
    WHERE id = ${requestId}
  `);

  await db.insert(agentOperatingTimeline).values({
    orgId, agentName: agentId, systemName: "scheduling_calendar",
    actionType: "approval_required", actionStatus: "requires_approval",
    communicationDomain: "calendar",
    summary: `Calendar event queued for approval: "${opts.title}" at ${opts.start}`,
    requiresApproval: true, approvalStatus: "pending",
    relatedEntityType: "composio_calendar_request", relatedEntityId: requestId,
    metadata: { requestId, title: opts.title, start: opts.start, purpose: opts.purpose },
  }).catch(() => {});

  await emitComposioHermesEvent({
    source: "composio", orgId, agent: agentId, tool: "GOOGLECALENDAR",
    action: "GOOGLECALENDAR_CREATE_EVENT",
    result: "queued_for_approval", outcome: "booking_requested",
    metadata: { requestId, title: opts.title, start: opts.start },
  }).catch(() => {});

  return {
    success: true,
    requestId,
    approvalQueueId: adapterResult.approvalQueueId,
    message: `Calendar event creation queued for admin approval (ID: ${requestId}).`,
  };
}

export async function queueEventUpdate(
  orgId: string,
  agentId: string,
  opts: {
    eventId: string;
    title?: string;
    start: string;
    end?: string;
    durationHours?: number;
    durationMinutes?: number;
    attendees?: string[];
    location?: string;
    description?: string;
    timezone?: string;
    purpose: string;
    riskLevel?: "low" | "medium" | "high";
  },
): Promise<QueueResult> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const { requestComposioAction } = await import("../composio-action-adapter");
  const { agentOperatingTimeline } = await import("@shared/schema");

  const requestId  = crypto.randomUUID();
  const riskLevel  = opts.riskLevel ?? "medium";

  const composioParams: Record<string, unknown> = {
    event_id: opts.eventId,
    start_datetime: opts.start,
    calendar_id: "primary",
  };
  if (opts.title)              composioParams.summary               = opts.title;
  if (opts.end)                composioParams.end_datetime          = opts.end;
  if (opts.durationHours)      composioParams.event_duration_hour   = opts.durationHours;
  if (opts.durationMinutes)    composioParams.event_duration_minutes = opts.durationMinutes;
  if (opts.attendees?.length)  composioParams.attendees             = opts.attendees;
  if (opts.location)           composioParams.location              = opts.location;
  if (opts.description)        composioParams.description           = opts.description;
  if (opts.timezone)           composioParams.timezone              = opts.timezone;

  await db.execute(sql`
    INSERT INTO composio_calendar_requests (
      id, org_id, agent_id, action_type,
      title, start_datetime, end_datetime, timezone,
      attendees, calendar_id, event_id, purpose, risk_level, status,
      payload, metadata, created_at, updated_at
    ) VALUES (
      ${requestId}, ${orgId}, ${agentId}, ${'update_event'},
      ${opts.title ?? null}, ${opts.start}, ${opts.end ?? null}, ${opts.timezone ?? null},
      ${opts.attendees ? JSON.stringify(opts.attendees) : null}::jsonb,
      ${'primary'}, ${opts.eventId}, ${opts.purpose}, ${riskLevel}, ${'pending_request'},
      ${JSON.stringify(composioParams)}::jsonb,
      ${JSON.stringify({ source: "scheduling_intelligence_service" })}::jsonb,
      NOW(), NOW()
    )
  `);

  const adapterResult = await requestComposioAction({
    orgId, agentId,
    tool: "GOOGLECALENDAR", action: "GOOGLECALENDAR_UPDATE_EVENT",
    inputParams: composioParams,
    confidence: 0.85, riskLevel,
    notes: `[update_event] ${opts.purpose} (${agentId})`,
  });

  if (adapterResult.outcome !== "queued_for_approval") {
    await db.execute(sql`DELETE FROM composio_calendar_requests WHERE id = ${requestId}`).catch(() => {});
    return { success: false, message: adapterResult.message ?? `Adapter rejected: ${adapterResult.outcome}` };
  }

  await db.execute(sql`
    UPDATE composio_calendar_requests
    SET status = ${'event_queued'}, approval_queue_id = ${adapterResult.approvalQueueId ?? null}, updated_at = NOW()
    WHERE id = ${requestId}
  `);

  await db.insert(agentOperatingTimeline).values({
    orgId, agentName: agentId, systemName: "scheduling_calendar",
    actionType: "approval_required", actionStatus: "requires_approval",
    communicationDomain: "calendar",
    summary: `Calendar event update queued: event ${opts.eventId}`,
    requiresApproval: true, approvalStatus: "pending",
    relatedEntityType: "composio_calendar_request", relatedEntityId: requestId,
    metadata: { requestId, eventId: opts.eventId, purpose: opts.purpose },
  }).catch(() => {});

  await emitComposioHermesEvent({
    source: "composio", orgId, agent: agentId, tool: "GOOGLECALENDAR",
    action: "GOOGLECALENDAR_UPDATE_EVENT",
    result: "queued_for_approval", outcome: "booking_requested",
    metadata: { requestId, eventId: opts.eventId },
  }).catch(() => {});

  return {
    success: true, requestId,
    approvalQueueId: adapterResult.approvalQueueId,
    message: `Calendar event update queued for admin approval (ID: ${requestId}).`,
  };
}

export async function queueEventDeletion(
  orgId: string,
  agentId: string,
  opts: {
    eventId: string;
    calendarId?: string;
    purpose: string;
    riskLevel?: "low" | "medium" | "high";
  },
): Promise<QueueResult> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const { requestComposioAction } = await import("../composio-action-adapter");
  const { agentOperatingTimeline } = await import("@shared/schema");

  const requestId  = crypto.randomUUID();
  const riskLevel  = opts.riskLevel ?? "high";
  const calendarId = opts.calendarId ?? "primary";

  const composioParams: Record<string, unknown> = { event_id: opts.eventId, calendar_id: calendarId };

  await db.execute(sql`
    INSERT INTO composio_calendar_requests (
      id, org_id, agent_id, action_type, calendar_id, event_id,
      purpose, risk_level, status, payload, metadata, created_at, updated_at
    ) VALUES (
      ${requestId}, ${orgId}, ${agentId}, ${'delete_event'}, ${calendarId}, ${opts.eventId},
      ${opts.purpose}, ${riskLevel}, ${'pending_request'},
      ${JSON.stringify(composioParams)}::jsonb,
      ${JSON.stringify({ source: "scheduling_intelligence_service" })}::jsonb,
      NOW(), NOW()
    )
  `);

  const adapterResult = await requestComposioAction({
    orgId, agentId,
    tool: "GOOGLECALENDAR", action: "GOOGLECALENDAR_DELETE_EVENT",
    inputParams: composioParams,
    confidence: 0.85, riskLevel,
    notes: `[delete_event] ${opts.purpose} (${agentId})`,
  });

  if (adapterResult.outcome !== "queued_for_approval") {
    await db.execute(sql`DELETE FROM composio_calendar_requests WHERE id = ${requestId}`).catch(() => {});
    return { success: false, message: adapterResult.message ?? `Adapter rejected: ${adapterResult.outcome}` };
  }

  await db.execute(sql`
    UPDATE composio_calendar_requests
    SET status = ${'event_queued'}, approval_queue_id = ${adapterResult.approvalQueueId ?? null}, updated_at = NOW()
    WHERE id = ${requestId}
  `);

  await db.insert(agentOperatingTimeline).values({
    orgId, agentName: agentId, systemName: "scheduling_calendar",
    actionType: "approval_required", actionStatus: "requires_approval",
    communicationDomain: "calendar",
    summary: `Calendar event deletion queued: event ${opts.eventId}`,
    requiresApproval: true, approvalStatus: "pending",
    relatedEntityType: "composio_calendar_request", relatedEntityId: requestId,
    metadata: { requestId, eventId: opts.eventId, purpose: opts.purpose },
  }).catch(() => {});

  await emitComposioHermesEvent({
    source: "composio", orgId, agent: agentId, tool: "GOOGLECALENDAR",
    action: "GOOGLECALENDAR_DELETE_EVENT",
    result: "queued_for_approval", outcome: "booking_cancelled",
    metadata: { requestId, eventId: opts.eventId },
  }).catch(() => {});

  return {
    success: true, requestId,
    approvalQueueId: adapterResult.approvalQueueId,
    message: `Calendar event deletion queued for admin approval (ID: ${requestId}).`,
  };
}
