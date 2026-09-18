/**
 * Google Calendar OAuth state — signed, verified, and enforced by the callback.
 *
 * Defect on main: getGoogleAuthUrl() sent `state: orgId` (or `orgId|fromIntegration`)
 * unsigned, and the public callback derived the org from that string, so anyone
 * could bind their Google account to any organisation. The Gmail flow already
 * signed its state; the helpers now live in server/lib/oauth-state.ts and are
 * shared by both flows.
 *
 * No server or database required (the connector imports server/db, which only
 * needs DATABASE_URL to be *set*; the sentinel below never receives a query).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/no_database_access";
process.env.SESSION_SECRET ??= "oauth-state-test-session-secret";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";

const { buildOAuthState, verifyOAuthState, OAUTH_STATE_MAX_AGE_MS } = await import("../lib/oauth-state");
const calendar = await import("../connectors/google-calendar");

const routesSource = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
const oauthStateSource = await readFile(new URL("../lib/oauth-state.ts", import.meta.url), "utf8");

function decode(state: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
}

function encode(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function fakeDeps(overrides: Partial<calendar.GoogleCalendarCallbackDeps> = {}) {
  const calls: string[] = [];
  const deps: calendar.GoogleCalendarCallbackDeps = {
    exchange: async (code, orgId) => { calls.push(`exchange:${code}:${orgId}`); return { email: "coach@example.test" }; },
    exchangeWithCredentials: async (code, orgId) => { calls.push(`exchangeWithCredentials:${code}:${orgId}`); return { email: "ops@example.test" }; },
    getIntegrationCredentials: async (orgId) => { calls.push(`creds:${orgId}`); return { clientId: "cid", clientSecret: "csecret" }; },
    markIntegrationConnected: async (orgId) => { calls.push(`connected:${orgId}`); },
    ...overrides,
  };
  return { deps, calls };
}

// ─── Shared helper: server/lib/oauth-state.ts ───────────────────────────────

test("signed state round-trips orgId, nonce, timestamp and extra fields", () => {
  const state = buildOAuthState("org-123", { returnTo: "/admin/configuration?tab=advanced", fromIntegration: true });
  const verified = verifyOAuthState(state);
  assert.ok(verified, "freshly built state must verify");
  assert.equal(verified.orgId, "org-123");
  assert.match(verified.nonce, /^[0-9a-f]{32}$/);
  assert.ok(Math.abs(Date.now() - verified.ts) < 5_000);
  assert.deepEqual(verified.extra, { returnTo: "/admin/configuration?tab=advanced", fromIntegration: true });
});

test("two states for the same org differ (nonce) and each verifies independently", () => {
  const a = buildOAuthState("org-123");
  const b = buildOAuthState("org-123");
  assert.notEqual(a, b);
  assert.equal(verifyOAuthState(a)?.orgId, "org-123");
  assert.equal(verifyOAuthState(b)?.orgId, "org-123");
});

test("unsigned state — a bare orgId, the legacy 'orgId|fromIntegration', or a payload without sig — is rejected", () => {
  assert.equal(verifyOAuthState("org-123"), null);
  assert.equal(verifyOAuthState("org-123|fromIntegration"), null);
  assert.equal(verifyOAuthState(encode({ orgId: "org-123", nonce: "n", ts: String(Date.now()) })), null);
  assert.equal(verifyOAuthState(""), null);
  assert.equal(verifyOAuthState(undefined), null);
  assert.equal(verifyOAuthState(["org-123"]), null);
  assert.equal(verifyOAuthState(encode([1, 2, 3])), null);
});

test("tampered orgId is rejected even though the signature is otherwise intact", () => {
  const state = buildOAuthState("victim-org");
  const decoded = decode(state);
  const forged = encode({ ...decoded, orgId: "attacker-org" });
  assert.equal(verifyOAuthState(forged), null);
  // Adding a field is also tampering.
  assert.equal(verifyOAuthState(encode({ ...decoded, fromIntegration: true })), null);
  // A signature of the wrong length or wrong value is rejected.
  assert.equal(verifyOAuthState(encode({ ...decoded, sig: "00" })), null);
  assert.equal(verifyOAuthState(encode({ ...decoded, sig: String(decoded.sig).replace(/^./, (c) => (c === "0" ? "1" : "0")) })), null);
});

test("expired state is rejected; a state within the window is accepted", () => {
  const state = buildOAuthState("org-123");
  const issuedAt = Number(decode(state).ts);
  assert.ok(verifyOAuthState(state, issuedAt + OAUTH_STATE_MAX_AGE_MS - 1_000));
  assert.equal(verifyOAuthState(state, issuedAt + OAUTH_STATE_MAX_AGE_MS + 1_000), null);
  // A state whose timestamp is far in the future cannot be used as a never-expiring token.
  assert.equal(verifyOAuthState(state, issuedAt - 10 * 60 * 1000), null);
});

test("state signed with a different session secret is rejected", () => {
  const saved = process.env.SESSION_SECRET;
  const state = buildOAuthState("org-123");
  process.env.SESSION_SECRET = "a-different-secret";
  try {
    assert.equal(verifyOAuthState(state), null);
  } finally {
    process.env.SESSION_SECRET = saved;
  }
  assert.ok(verifyOAuthState(state));
});

test("signature comparison is timing-safe (no !== on the HMAC)", () => {
  assert.match(oauthStateSource, /timingSafeEqual\(/);
  assert.doesNotMatch(oauthStateSource, /sig\s*!==\s*expected|expected\s*!==\s*sig/);
});

test("reserved payload keys cannot be overridden through extra fields", () => {
  assert.throws(() => buildOAuthState("org-123", { orgId: "other" } as any), /reserved/);
  assert.throws(() => buildOAuthState("org-123", { sig: "x" } as any), /reserved/);
  assert.throws(() => buildOAuthState("", {}), /orgId/);
});

// ─── Calendar flow uses the shared helper ───────────────────────────────────

test("getGoogleAuthUrl embeds a signed state that verifies back to the same org (not the bare orgId)", () => {
  const url = new URL(calendar.getGoogleAuthUrl("org-abc"));
  const state = url.searchParams.get("state");
  assert.ok(state);
  assert.notEqual(state, "org-abc");
  assert.deepEqual(calendar.verifyGoogleCalendarOAuthState(state), { orgId: "org-abc", fromIntegration: false });
});

test("getGoogleAuthUrlFromCredentials carries fromIntegration inside the signed payload", () => {
  const url = new URL(calendar.getGoogleAuthUrlFromCredentials("cid", "csecret", "org-abc"));
  const state = url.searchParams.get("state");
  assert.ok(state);
  assert.ok(!state.includes("|fromIntegration"));
  assert.deepEqual(calendar.verifyGoogleCalendarOAuthState(state), { orgId: "org-abc", fromIntegration: true });
  // The flag cannot be flipped without the secret.
  const decoded = decode(state);
  delete decoded.fromIntegration;
  assert.equal(calendar.verifyGoogleCalendarOAuthState(encode(decoded)), null);
});

// ─── Callback enforcement ───────────────────────────────────────────────────

test("callback rejects an unsigned orgId state with gcal_error=invalid_state and never exchanges the code", async () => {
  const { deps, calls } = fakeDeps();
  const redirect = await calendar.handleGoogleCalendarOAuthCallback({ code: "4/auth-code", state: "victim-org" }, deps);
  assert.equal(redirect, "/admin/agent-ops?tab=connectors&gcal_error=invalid_state");
  assert.deepEqual(calls, []);
});

test("callback rejects the legacy 'orgId|fromIntegration' state and a tampered signed state", async () => {
  const { deps, calls } = fakeDeps();
  assert.equal(
    await calendar.handleGoogleCalendarOAuthCallback({ code: "4/auth-code", state: "victim-org|fromIntegration" }, deps),
    "/admin/agent-ops?tab=connectors&gcal_error=invalid_state",
  );
  const forged = encode({ ...decode(calendar.buildGoogleCalendarOAuthState("attacker-org", false)), orgId: "victim-org" });
  assert.equal(
    await calendar.handleGoogleCalendarOAuthCallback({ code: "4/auth-code", state: forged }, deps),
    "/admin/agent-ops?tab=connectors&gcal_error=invalid_state",
  );
  assert.deepEqual(calls, []);
});

test("callback rejects an expired signed state", async () => {
  const { deps, calls } = fakeDeps();
  const decoded = decode(calendar.buildGoogleCalendarOAuthState("org-abc", false));
  const oldTs = String(Number(decoded.ts) - OAUTH_STATE_MAX_AGE_MS - 60_000);
  // Re-sign with the old timestamp using the real helper so only expiry differs.
  const { createHmac } = await import("node:crypto");
  const payload = { orgId: "org-abc", nonce: decoded.nonce, ts: oldTs };
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(JSON.stringify(payload)).digest("hex");
  const expired = encode({ ...payload, sig });
  assert.equal(
    await calendar.handleGoogleCalendarOAuthCallback({ code: "4/auth-code", state: expired }, deps),
    "/admin/agent-ops?tab=connectors&gcal_error=invalid_state",
  );
  assert.deepEqual(calls, []);
});

test("callback with a valid signed state exchanges the code for the SIGNED org only", async () => {
  const { deps, calls } = fakeDeps();
  const state = calendar.buildGoogleCalendarOAuthState("org-abc", false);
  const redirect = await calendar.handleGoogleCalendarOAuthCallback({ code: "4/auth-code", state }, deps);
  assert.equal(redirect, "/admin/agent-ops?tab=connectors&gcal_connected=1&gcal_email=coach%40example.test");
  assert.deepEqual(calls, ["exchange:4/auth-code:org-abc"]);
});

test("callback with fromIntegration in the signed payload uses stored credentials and marks the integration connected", async () => {
  const { deps, calls } = fakeDeps();
  const state = calendar.buildGoogleCalendarOAuthState("org-abc", true);
  const redirect = await calendar.handleGoogleCalendarOAuthCallback({ code: "4/auth-code", state }, deps);
  assert.equal(redirect, "/admin/configuration?tab=advanced&gcal=connected&gcal_email=ops%40example.test");
  assert.deepEqual(calls, ["creds:org-abc", "exchangeWithCredentials:4/auth-code:org-abc", "connected:org-abc"]);
});

test("callback surfaces provider errors and missing code only AFTER the state verified", async () => {
  const { deps, calls } = fakeDeps();
  const state = calendar.buildGoogleCalendarOAuthState("org-abc", false);
  assert.equal(
    await calendar.handleGoogleCalendarOAuthCallback({ state, error: "access_denied" }, deps),
    "/admin/agent-ops?tab=connectors&gcal_error=access_denied",
  );
  assert.equal(
    await calendar.handleGoogleCalendarOAuthCallback({ state }, deps),
    "/admin/agent-ops?tab=connectors&gcal_error=missing_params",
  );
  // Without a valid state, even a provider error does not reveal which flow was in use.
  assert.equal(
    await calendar.handleGoogleCalendarOAuthCallback({ error: "access_denied" }, deps),
    "/admin/agent-ops?tab=connectors&gcal_error=invalid_state",
  );
  assert.deepEqual(calls, []);
});

test("callback reports an exchange failure without leaking the org into an unsigned redirect", async () => {
  const { deps } = fakeDeps({ exchange: async () => { throw new Error("invalid_grant"); } });
  const state = calendar.buildGoogleCalendarOAuthState("org-abc", false);
  assert.equal(
    await calendar.handleGoogleCalendarOAuthCallback({ code: "4/bad", state }, deps),
    "/admin/agent-ops?tab=connectors&gcal_error=invalid_grant",
  );
});

// ─── Route wiring (source inspection of server/routes.ts) ───────────────────

function routeBlock(startMarker: string, endMarker: string): string {
  const start = routesSource.indexOf(startMarker);
  assert.ok(start >= 0, `route not found: ${startMarker}`);
  const end = routesSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `route end not found after: ${startMarker}`);
  return routesSource.slice(start, end);
}

test("the public calendar callback delegates to the verified handler and never derives orgId from raw state", () => {
  const block = routeBlock('app.get("/api/connectors/google-calendar/callback"', 'app.delete("/api/admin/connectors/google-calendar"');
  assert.match(block, /handleGoogleCalendarOAuthCallback\(req\.query/);
  assert.doesNotMatch(block, /rawState|\.replace\("\|fromIntegration"|includes\("\|fromIntegration"\)/);
  assert.doesNotMatch(block, /exchangeCodeAndStoreTokens\(code/);
});

test("both routes that START the calendar flow require an authenticated ADMIN whose org comes from their own session", () => {
  const connect = routeBlock('app.get("/api/admin/connectors/google-calendar/connect"', 'app.get("/api/integrations/google_calendar/oauth/start-url"');
  assert.match(connect, /isAuthenticated, requireRole\("ADMIN"\)/);
  assert.match(connect, /resolveOrgIdOrThrow\(req\)/);
  assert.doesNotMatch(connect, /req\.(query|body|params)\.(orgId|organizationId)/);

  const startUrl = routeBlock('app.get("/api/integrations/google_calendar/oauth/start-url"', 'app.get("/api/connectors/google-calendar/callback"');
  assert.match(startUrl, /isAuthenticated, requireRole\("ADMIN"\)/);
  assert.match(startUrl, /getAdminOrgId\(req\)/);
  assert.doesNotMatch(startUrl, /req\.(query|body|params)\.(orgId|organizationId)/);
});

test("Gmail's flow uses the shared helper — no second HMAC implementation in routes.ts", () => {
  assert.match(routesSource, /import \{ buildOAuthState, verifyOAuthState \} from "\.\/lib\/oauth-state"/);
  assert.match(routesSource, /buildGmailOAuthState\(orgId, returnTo\)/);
  assert.match(routesSource, /verifyGmailOAuthState\(state\)/);
  assert.doesNotMatch(routesSource, /createHmac\("sha256", getSessionSecret\(\)\)/);
  assert.doesNotMatch(routesSource, /require\("crypto"\)/);
});
