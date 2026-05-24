/**
 * Google Calendar Integration — Phase 5
 * Agent: Tempo (scheduling_agent)
 *
 * All booking actions use idempotency + execution locks to prevent double-booking.
 */

import { executeIntegrationAction, getIntegration, normalizeProviderResponse } from "../integration-runtime";
import { acquireExecutionLock, releaseExecutionLock } from "../workflow-job-queue";

export interface CalendarSlot {
  start: string; // ISO
  end: string;   // ISO
  available: boolean;
  conflictReason?: string;
}

export interface BookingInput {
  orgId: string;
  agentType?: string;
  workflowJobId?: string;
  workflowRunId?: string;
  coachId: string;
  clientName: string;
  clientEmail: string;
  title: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  location?: string;
  description?: string;
  idempotencyKey: string;
}

export interface RescheduleInput extends Omit<BookingInput, "idempotencyKey"> {
  eventId: string;
  newStartTime: string;
  newEndTime: string;
  idempotencyKey: string;
}

// ─── Read Availability ────────────────────────────────────────────────────────

export async function calendarGetAvailability(
  orgId: string,
  coachId: string,
  startDate: string,
  endDate: string,
): Promise<CalendarSlot[]> {
  const result = await executeIntegrationAction(
    {
      orgId,
      integrationType: "google_calendar",
      actionType: "read_availability",
      agentType: "scheduling_agent",
      inputSummary: `Read availability for coach ${coachId} from ${startDate} to ${endDate}`,
      payload: { coachId, startDate, endDate },
    },
    async () => {
      const integration = await getIntegration(orgId, "google_calendar");
      if (!integration || integration.status !== "connected") {
        throw new Error("Google Calendar not connected");
      }
      const creds = integration.encryptedCredentials as any ?? {};
      const { google } = await import("googleapis");
      const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
      oauth2Client.setCredentials({ access_token: creds.accessToken, refresh_token: creds.refreshToken });
      const calendar = google.calendar({ version: "v3", auth: oauth2Client });

      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: startDate,
          timeMax: endDate,
          items: [{ id: creds.calendarId ?? "primary" }],
        },
      });

      const busySlots = response.data.calendars?.["primary"]?.busy ?? [];
      return { busySlots, calendarId: creds.calendarId ?? "primary" };
    },
  );

  if (!result.ok) return [];
  return buildAvailabilitySlots(startDate, endDate, result.data?.busySlots ?? []);
}

// ─── Create Booking ───────────────────────────────────────────────────────────

export async function calendarCreateBooking(input: BookingInput): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  // Acquire execution lock to prevent double-booking
  const lockKey = `calendar-booking-${input.orgId}-${input.coachId}-${input.startTime}`;
  const lock = await acquireExecutionLock(input.orgId, lockKey, "workflow", "", "scheduling_agent");

  if (!lock.acquired) {
    return { ok: false, error: "Booking conflict: another session is being scheduled at this time" };
  }

  try {
    const result = await executeIntegrationAction(
      {
        orgId: input.orgId,
        integrationType: "google_calendar",
        actionType: "create_booking",
        agentType: input.agentType ?? "scheduling_agent",
        workflowJobId: input.workflowJobId,
        workflowRunId: input.workflowRunId,
        idempotencyKey: input.idempotencyKey,
        inputSummary: `Book ${input.title} for ${input.clientName} at ${input.startTime}`,
        payload: { coachId: input.coachId, clientEmail: input.clientEmail, startTime: input.startTime },
      },
      async () => {
        const integration = await getIntegration(input.orgId, "google_calendar");
        if (!integration || integration.status !== "connected") {
          throw new Error("Google Calendar not connected");
        }
        const creds = integration.encryptedCredentials as any ?? {};
        const { google } = await import("googleapis");
        const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
        oauth2Client.setCredentials({ access_token: creds.accessToken, refresh_token: creds.refreshToken });
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });

        const event = await calendar.events.insert({
          calendarId: creds.calendarId ?? "primary",
          requestBody: {
            summary: input.title,
            description: input.description,
            location: input.location,
            start: { dateTime: input.startTime, timeZone: "UTC" },
            end: { dateTime: input.endTime, timeZone: "UTC" },
            attendees: [{ email: input.clientEmail, displayName: input.clientName }],
          },
        });

        return normalizeProviderResponse({ event_id: event.data.id, htmlLink: event.data.htmlLink });
      },
    );

    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, eventId: result.data?.id as string };
  } finally {
    await releaseExecutionLock(input.orgId, lockKey);
  }
}

// ─── Reschedule ───────────────────────────────────────────────────────────────

export async function calendarReschedule(input: RescheduleInput): Promise<{ ok: boolean; error?: string }> {
  const result = await executeIntegrationAction(
    {
      orgId: input.orgId,
      integrationType: "google_calendar",
      actionType: "reschedule",
      agentType: input.agentType ?? "scheduling_agent",
      idempotencyKey: input.idempotencyKey,
      inputSummary: `Reschedule event ${input.eventId} to ${input.newStartTime}`,
      payload: { eventId: input.eventId, newStartTime: input.newStartTime },
    },
    async () => {
      const integration = await getIntegration(input.orgId, "google_calendar");
      if (!integration || integration.status !== "connected") throw new Error("Google Calendar not connected");
      const creds = integration.encryptedCredentials as any ?? {};
      const { google } = await import("googleapis");
      const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
      oauth2Client.setCredentials({ access_token: creds.accessToken, refresh_token: creds.refreshToken });
      const calendar = google.calendar({ version: "v3", auth: oauth2Client });

      await calendar.events.patch({
        calendarId: creds.calendarId ?? "primary",
        eventId: input.eventId,
        requestBody: {
          start: { dateTime: input.newStartTime, timeZone: "UTC" },
          end: { dateTime: input.newEndTime, timeZone: "UTC" },
        },
      });
      return { rescheduled: true };
    },
  );

  return { ok: result.ok, error: result.error };
}

// ─── Cancel Event ─────────────────────────────────────────────────────────────

export async function calendarCancelEvent(
  orgId: string,
  eventId: string,
  agentType?: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await executeIntegrationAction(
    {
      orgId,
      integrationType: "google_calendar",
      actionType: "cancel_event",
      agentType: agentType ?? "scheduling_agent",
      inputSummary: `Cancel event ${eventId}`,
      payload: { eventId },
    },
    async () => {
      const integration = await getIntegration(orgId, "google_calendar");
      if (!integration || integration.status !== "connected") throw new Error("Google Calendar not connected");
      const creds = integration.encryptedCredentials as any ?? {};
      const { google } = await import("googleapis");
      const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
      oauth2Client.setCredentials({ access_token: creds.accessToken, refresh_token: creds.refreshToken });
      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      await calendar.events.delete({ calendarId: creds.calendarId ?? "primary", eventId });
      return { cancelled: true };
    },
  );

  return { ok: result.ok, error: result.error };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildAvailabilitySlots(
  startDate: string,
  endDate: string,
  busySlots: Array<{ start?: string | null; end?: string | null }>,
): CalendarSlot[] {
  const slots: CalendarSlot[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);

  while (current < end) {
    const slotEnd = new Date(current.getTime() + 60 * 60 * 1000); // 1-hour slots
    const isBusy = busySlots.some(b => {
      const bStart = b.start ? new Date(b.start) : null;
      const bEnd = b.end ? new Date(b.end) : null;
      if (!bStart || !bEnd) return false;
      return current < bEnd && slotEnd > bStart;
    });

    slots.push({
      start: current.toISOString(),
      end: slotEnd.toISOString(),
      available: !isBusy,
      conflictReason: isBusy ? "Blocked by existing event" : undefined,
    });

    current.setTime(current.getTime() + 60 * 60 * 1000);
  }

  return slots;
}
