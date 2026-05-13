/**
 * Google Calendar Connector
 *
 * OAuth 2.0 flow using google-auth-library.
 * Calendar operations via direct REST API (no googleapis package needed).
 *
 * Scopes: calendar.events (create / update / delete events)
 *
 * Token storage: connector_tokens table, one row per org.
 * Token refresh: automatic via OAuth2Client.getAccessToken().
 */

import { OAuth2Client } from "google-auth-library";
import { db } from "../db";
import { sql } from "drizzle-orm";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// ─── Config ───────────────────────────────────────────────────────────────────

export function isGoogleCalendarConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getRedirectUri(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost:5000";
  return `https://${domain}/api/connectors/google-calendar/callback`;
}

function buildOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google Calendar not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables."
    );
  }
  return new OAuth2Client(clientId, clientSecret, getRedirectUri());
}

// ─── Auth URL ─────────────────────────────────────────────────────────────────

export function getGoogleAuthUrl(orgId: string): string {
  const client = buildOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: orgId,
  });
}

// ─── Token exchange + storage ─────────────────────────────────────────────────

export async function exchangeCodeAndStoreTokens(
  code: string,
  orgId: string
): Promise<{ email: string | null }> {
  const client = buildOAuth2Client();
  const { tokens } = await client.getToken(code);

  const email = await resolveConnectedEmail(tokens.access_token ?? null);

  await db.execute(sql`
    INSERT INTO connector_tokens (id, org_id, connector, access_token, refresh_token, token_expiry, scope, email, created_at, updated_at)
    VALUES (gen_random_uuid(), ${orgId}, 'google_calendar',
            ${tokens.access_token ?? null},
            ${tokens.refresh_token ?? null},
            ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null}::timestamptz,
            ${SCOPES.join(" ")},
            ${email},
            NOW(), NOW())
    ON CONFLICT (org_id, connector)
    DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, connector_tokens.refresh_token),
      token_expiry = EXCLUDED.token_expiry,
      scope = EXCLUDED.scope,
      email = EXCLUDED.email,
      updated_at = NOW()
  `);

  return { email };
}

async function resolveConnectedEmail(accessToken: string | null): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const r = await fetch(
      `https://www.googleapis.com/oauth2/v1/userinfo?alt=json`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) return null;
    const data = await r.json() as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

// ─── Token retrieval + refresh ────────────────────────────────────────────────

type StoredToken = {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  email: string | null;
};

async function getStoredToken(orgId: string): Promise<StoredToken | null> {
  const rows = await db.execute(sql`
    SELECT access_token, refresh_token, token_expiry, email
    FROM connector_tokens
    WHERE org_id = ${orgId} AND connector = 'google_calendar'
    LIMIT 1
  `);
  const row = (rows as any).rows?.[0] ?? rows[0];
  if (!row) return null;
  return {
    accessToken: row.access_token ?? null,
    refreshToken: row.refresh_token ?? null,
    tokenExpiry: row.token_expiry ? new Date(row.token_expiry) : null,
    email: row.email ?? null,
  };
}

async function getFreshAccessToken(orgId: string): Promise<string> {
  const stored = await getStoredToken(orgId);
  if (!stored) throw new Error("Google Calendar not connected for this organisation.");

  const client = buildOAuth2Client();
  client.setCredentials({
    access_token: stored.accessToken ?? undefined,
    refresh_token: stored.refreshToken ?? undefined,
    expiry_date: stored.tokenExpiry?.getTime(),
  });

  const { token, res } = await client.getAccessToken();
  if (!token) throw new Error("Could not obtain Google access token.");

  if (res?.data?.access_token && res.data.access_token !== stored.accessToken) {
    await db.execute(sql`
      UPDATE connector_tokens
      SET access_token = ${res.data.access_token},
          token_expiry = ${res.data.expiry_date ? new Date(res.data.expiry_date).toISOString() : null}::timestamptz,
          updated_at = NOW()
      WHERE org_id = ${orgId} AND connector = 'google_calendar'
    `);
  }

  return token;
}

// ─── Connection status ────────────────────────────────────────────────────────

export async function getGoogleCalendarStatus(orgId: string): Promise<{
  connected: boolean;
  email: string | null;
  configured: boolean;
}> {
  const configured = isGoogleCalendarConfigured();
  if (!configured) return { connected: false, email: null, configured: false };

  const stored = await getStoredToken(orgId);
  return {
    connected: !!(stored?.accessToken || stored?.refreshToken),
    email: stored?.email ?? null,
    configured: true,
  };
}

export async function disconnectGoogleCalendar(orgId: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM connector_tokens WHERE org_id = ${orgId} AND connector = 'google_calendar'
  `);
}

// ─── Calendar API helpers ─────────────────────────────────────────────────────

async function calendarFetch(
  orgId: string,
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: Record<string, any>
): Promise<{ ok: boolean; status: number; data: any }> {
  const token = await getFreshAccessToken(orgId);
  const url = `${CALENDAR_API}${path}`;

  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };

  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  return { ok: res.ok, status: res.status, data };
}

// ─── Calendar event CRUD ──────────────────────────────────────────────────────

export type CalendarEventInput = {
  title: string;
  startIso: string;
  endIso: string;
  description?: string;
  attendeeEmails?: string[];
  location?: string;
};

export async function createCalendarEvent(
  orgId: string,
  input: CalendarEventInput
): Promise<{ eventId: string; htmlLink: string }> {
  const body = {
    summary: input.title,
    description: input.description ?? "",
    location: input.location ?? "",
    start: { dateTime: input.startIso, timeZone: "UTC" },
    end: { dateTime: input.endIso, timeZone: "UTC" },
    attendees: (input.attendeeEmails ?? []).map((email) => ({ email })),
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 60 * 24 },
        { method: "popup", minutes: 30 },
      ],
    },
  };

  const result = await calendarFetch(orgId, "/calendars/primary/events", "POST", body);
  if (!result.ok) {
    throw new Error(`Google Calendar API error (${result.status}): ${JSON.stringify(result.data?.error ?? result.data)}`);
  }
  return { eventId: result.data.id, htmlLink: result.data.htmlLink ?? "" };
}

export async function updateCalendarEvent(
  orgId: string,
  eventId: string,
  updates: Partial<CalendarEventInput>
): Promise<void> {
  const patch: Record<string, any> = {};
  if (updates.title) patch.summary = updates.title;
  if (updates.description !== undefined) patch.description = updates.description;
  if (updates.location !== undefined) patch.location = updates.location;
  if (updates.startIso) patch.start = { dateTime: updates.startIso, timeZone: "UTC" };
  if (updates.endIso) patch.end = { dateTime: updates.endIso, timeZone: "UTC" };
  if (updates.attendeeEmails) patch.attendees = updates.attendeeEmails.map((email) => ({ email }));

  const result = await calendarFetch(
    orgId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    "PATCH",
    patch
  );
  if (!result.ok) {
    throw new Error(`Google Calendar PATCH error (${result.status}): ${JSON.stringify(result.data?.error ?? result.data)}`);
  }
}

export async function deleteCalendarEvent(orgId: string, eventId: string): Promise<void> {
  const result = await calendarFetch(
    orgId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    "DELETE"
  );
  if (!result.ok && result.status !== 410) {
    throw new Error(`Google Calendar DELETE error (${result.status}): ${JSON.stringify(result.data?.error ?? result.data)}`);
  }
}

// ─── Conflict detection ───────────────────────────────────────────────────────

export type ConflictEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
};

export async function checkConflicts(
  orgId: string,
  startIso: string,
  endIso: string
): Promise<ConflictEvent[]> {
  const params = new URLSearchParams({
    timeMin: startIso,
    timeMax: endIso,
    singleEvents: "true",
    orderBy: "startTime",
  });

  const result = await calendarFetch(
    orgId,
    `/calendars/primary/events?${params}`,
    "GET"
  );
  if (!result.ok) return [];

  const items: any[] = result.data.items ?? [];
  return items.map((item: any) => ({
    id: item.id,
    summary: item.summary ?? "(no title)",
    start: item.start?.dateTime ?? item.start?.date ?? "",
    end: item.end?.dateTime ?? item.end?.date ?? "",
  }));
}
