/**
 * Google Calendar Connector
 *
 * OAuth 2.0 flow using google-auth-library.
 * Calendar operations via direct REST API (no googleapis package needed).
 *
 * Scopes: calendar.events (create / update / delete events)
 *
 * Token storage: connector_tokens table, one row per (org_id, connector) —
 *   enforced by the connector_tokens_org_connector_unique index (migration 0021).
 *   access_token / refresh_token are stored as credentials-vault envelopes
 *   (AES-256-GCM, see server/credentials-vault.ts). Rows written before
 *   encryption existed hold plaintext; they are read as legacy values and
 *   re-encrypted on the next write.
 * Token refresh: automatic via OAuth2Client.getAccessToken().
 * OAuth state: HMAC-signed via server/lib/oauth-state.ts — the public callback
 *   only trusts an orgId that was signed by this server within 15 minutes.
 */

import { OAuth2Client } from "google-auth-library";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { encryptCredentials, decryptCredentials } from "../credentials-vault";
import { buildOAuthState, verifyOAuthState } from "../lib/oauth-state";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const CONNECTOR = "google_calendar";

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

// ─── Signed OAuth state ───────────────────────────────────────────────────────

export type GoogleCalendarOAuthState = { orgId: string; fromIntegration: boolean };

/**
 * `fromIntegration` marks the org-integration flow (credentials from
 * external_integrations, redirect back to Options → Advanced). It travels
 * INSIDE the signed payload so it cannot be toggled by the caller.
 */
export function buildGoogleCalendarOAuthState(orgId: string, fromIntegration: boolean): string {
  return buildOAuthState(orgId, fromIntegration ? { fromIntegration: true } : {});
}

/** Null when the state is unsigned, tampered with, malformed, or expired. */
export function verifyGoogleCalendarOAuthState(raw: unknown): GoogleCalendarOAuthState | null {
  const verified = verifyOAuthState(raw);
  if (!verified) return null;
  return { orgId: verified.orgId, fromIntegration: verified.extra.fromIntegration === true };
}

// ─── Auth URL ─────────────────────────────────────────────────────────────────

export function getGoogleAuthUrl(orgId: string): string {
  const client = buildOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: buildGoogleCalendarOAuthState(orgId, false),
  });
}

/**
 * Builds an OAuth URL using caller-supplied credentials (from external_integrations).
 * The signed state carries `fromIntegration` so the callback knows to update
 * external_integrations and redirect back to the configuration page.
 */
export function getGoogleAuthUrlFromCredentials(
  clientId: string,
  clientSecret: string,
  orgId: string
): string {
  const client = new OAuth2Client(clientId, clientSecret, getRedirectUri());
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: buildGoogleCalendarOAuthState(orgId, true),
  });
}

// ─── Token encryption ─────────────────────────────────────────────────────────
//
// The vault produces a JSON-serialisable envelope ({ _v: 1, _enc, _iv, _tag })
// meant for jsonb columns; connector_tokens.access_token/refresh_token are
// text, so the envelope is stored as its JSON string. A Google OAuth token is
// an opaque URL-safe string that never starts with "{", which is what makes
// legacy plaintext rows distinguishable from encrypted ones.

const ENVELOPE_FIELD = "token";

function encryptToken(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return JSON.stringify(encryptCredentials({ [ENVELOPE_FIELD]: value }));
}

/** True when a stored column value is a credentials-vault envelope. */
export function isEncryptedTokenEnvelope(stored: unknown): boolean {
  if (typeof stored !== "string" || !stored.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(stored);
    return !!parsed && typeof parsed === "object" && parsed._v === 1 && typeof parsed._enc === "string";
  } catch {
    return false;
  }
}

type DecryptedToken = { value: string | null; legacy: boolean };

function decryptToken(stored: unknown): DecryptedToken {
  if (stored == null || stored === "") return { value: null, legacy: false };
  if (typeof stored !== "string") return { value: null, legacy: false };
  if (!isEncryptedTokenEnvelope(stored)) {
    // Row written before token encryption existed: plaintext.
    return { value: stored, legacy: true };
  }
  const decrypted = decryptCredentials(JSON.parse(stored));
  const value = decrypted?.[ENVELOPE_FIELD];
  if (typeof value !== "string" || value.length === 0) {
    // Undecryptable envelope (e.g. rotated CREDENTIAL_ENCRYPTION_KEY): treat
    // as absent rather than handing an envelope to Google as a bearer token.
    console.warn("[google-calendar] stored token envelope could not be decrypted; treating as disconnected");
    return { value: null, legacy: false };
  }
  return { value, legacy: false };
}

// ─── Token exchange + storage ─────────────────────────────────────────────────

export type GoogleTokenSet = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
};

/**
 * Upserts the org's Google Calendar tokens (one row per org, enforced by the
 * (org_id, connector) unique index). Both tokens are written encrypted; when
 * Google omits refresh_token (re-consent without `prompt=consent`), the
 * existing refresh token is preserved — and re-encrypted if it was legacy
 * plaintext.
 */
export async function storeGoogleCalendarTokens(
  orgId: string,
  tokens: GoogleTokenSet,
  email: string | null
): Promise<void> {
  let refreshToken = tokens.refresh_token ?? null;
  if (!refreshToken) {
    const existing = await getStoredToken(orgId);
    refreshToken = existing?.refreshToken ?? null;
  }
  await db.execute(sql`
    INSERT INTO connector_tokens (id, org_id, connector, access_token, refresh_token, token_expiry, scope, email, created_at, updated_at)
    VALUES (gen_random_uuid(), ${orgId}, ${CONNECTOR},
            ${encryptToken(tokens.access_token)},
            ${encryptToken(refreshToken)},
            ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null}::timestamptz,
            ${SCOPES.join(" ")},
            ${email},
            NOW(), NOW())
    ON CONFLICT (org_id, connector)
    DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expiry = EXCLUDED.token_expiry,
      scope = EXCLUDED.scope,
      email = EXCLUDED.email,
      updated_at = NOW()
  `);
}

export async function exchangeCodeAndStoreTokens(
  code: string,
  orgId: string
): Promise<{ email: string | null }> {
  const client = buildOAuth2Client();
  const { tokens } = await client.getToken(code);
  const email = await resolveConnectedEmail(tokens.access_token ?? null);
  await storeGoogleCalendarTokens(orgId, tokens, email);
  return { email };
}

/**
 * Same as exchangeCodeAndStoreTokens but uses caller-supplied credentials
 * (from external_integrations) instead of env vars. Used by the org
 * integration OAuth flow triggered from Options → Advanced.
 */
export async function exchangeCodeAndStoreTokensWithCredentials(
  code: string,
  orgId: string,
  clientId: string,
  clientSecret: string
): Promise<{ email: string | null }> {
  const client = new OAuth2Client(clientId, clientSecret, getRedirectUri());
  const { tokens } = await client.getToken(code);
  const email = await resolveConnectedEmail(tokens.access_token ?? null);
  await storeGoogleCalendarTokens(orgId, tokens, email);
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

// ─── OAuth callback ───────────────────────────────────────────────────────────

const CONNECTOR_RETURN = "/admin/agent-ops?tab=connectors";
const INTEGRATION_RETURN = "/admin/configuration?tab=advanced";

export type GoogleCalendarCallbackQuery = {
  code?: unknown;
  state?: unknown;
  error?: unknown;
};

/** Persistence the callback needs; injected so the handler is testable without a DB. */
export type GoogleCalendarCallbackDeps = {
  exchange: (code: string, orgId: string) => Promise<{ email: string | null }>;
  exchangeWithCredentials: (code: string, orgId: string, clientId: string, clientSecret: string) => Promise<{ email: string | null }>;
  getIntegrationCredentials: (orgId: string) => Promise<{ clientId?: string; clientSecret?: string } | null>;
  markIntegrationConnected: (orgId: string) => Promise<void>;
};

/**
 * Handles GET /api/connectors/google-calendar/callback and returns the path
 * to redirect the browser to. The org to bind tokens to comes ONLY from the
 * verified signed state; an unsigned, tampered, or expired state is rejected
 * before any code exchange with `gcal_error=invalid_state`.
 */
export async function handleGoogleCalendarOAuthCallback(
  query: GoogleCalendarCallbackQuery,
  deps: GoogleCalendarCallbackDeps
): Promise<string> {
  const { code, state, error } = query;

  const verified = verifyGoogleCalendarOAuthState(state);
  if (!verified) {
    console.warn("[google-calendar/callback] rejected: state missing, unsigned, tampered, or expired");
    return `${CONNECTOR_RETURN}&gcal_error=invalid_state`;
  }
  const { orgId, fromIntegration } = verified;
  const returnBase = fromIntegration ? INTEGRATION_RETURN : CONNECTOR_RETURN;

  if (error) {
    return `${returnBase}&gcal_error=${encodeURIComponent(String(error))}`;
  }
  if (typeof code !== "string" || code.length === 0) {
    return `${returnBase}&gcal_error=missing_params`;
  }

  try {
    if (fromIntegration) {
      // Use the credentials stored in external_integrations for this org
      const creds = await deps.getIntegrationCredentials(orgId);
      if (!creds?.clientId || !creds?.clientSecret) {
        return `${returnBase}&gcal_error=${encodeURIComponent("Stored credentials missing — please re-enter them")}`;
      }
      const result = await deps.exchangeWithCredentials(code, orgId, creds.clientId, creds.clientSecret);
      // Mark external_integrations row as connected now that OAuth is complete
      await deps.markIntegrationConnected(orgId);
      return `${returnBase}&gcal=connected&gcal_email=${encodeURIComponent(result.email ?? "")}`;
    }
    const result = await deps.exchange(code, orgId);
    return `${returnBase}&gcal_connected=1&gcal_email=${encodeURIComponent(result.email ?? "")}`;
  } catch (err: any) {
    return `${returnBase}&gcal_error=${encodeURIComponent(err?.message ?? "unknown_error")}`;
  }
}

// ─── Token retrieval + refresh ────────────────────────────────────────────────

type StoredToken = {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  email: string | null;
  /** True when either token was stored as legacy plaintext. */
  legacy: boolean;
};

async function getStoredToken(orgId: string): Promise<StoredToken | null> {
  const rows = await db.execute(sql`
    SELECT access_token, refresh_token, token_expiry, email
    FROM connector_tokens
    WHERE org_id = ${orgId} AND connector = ${CONNECTOR}
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1
  `);
  const row = (rows as any).rows?.[0] ?? (rows as any)[0];
  if (!row) return null;
  const access = decryptToken(row.access_token);
  const refresh = decryptToken(row.refresh_token);
  return {
    accessToken: access.value,
    refreshToken: refresh.value,
    tokenExpiry: row.token_expiry ? new Date(row.token_expiry) : null,
    email: row.email ?? null,
    legacy: access.legacy || refresh.legacy,
  };
}

export async function getFreshAccessToken(orgId: string): Promise<string> {
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

  const refreshed = res?.data?.access_token && res.data.access_token !== stored.accessToken;
  if (refreshed) {
    // Persist the refreshed access token encrypted; a legacy plaintext refresh
    // token is re-encrypted on this same write.
    await db.execute(sql`
      UPDATE connector_tokens
      SET access_token = ${encryptToken(res!.data.access_token)},
          refresh_token = ${encryptToken(stored.refreshToken)},
          token_expiry = ${res!.data.expiry_date ? new Date(res!.data.expiry_date).toISOString() : null}::timestamptz,
          updated_at = NOW()
      WHERE org_id = ${orgId} AND connector = ${CONNECTOR}
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
    DELETE FROM connector_tokens WHERE org_id = ${orgId} AND connector = ${CONNECTOR}
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
    signal: AbortSignal.timeout(10_000),
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
