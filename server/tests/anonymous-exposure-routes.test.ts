/**
 * Anonymous-exposure regressions in server/routes.ts:
 *
 *   GET  /api/organizations/:slug/coaches  returned full coach_profiles rows
 *                                          (passwordHash, coachEmail) with the
 *                                          joined users row (passwordHash, email,
 *                                          phone, passwordResetToken, ...).
 *   GET  /api/sessions/open                with no resolvable org, queried with
 *                                          organizationId=undefined and returned
 *                                          EVERY tenant's sessions.
 *   POST /api/marketplace/e2e-test         wrote fixture rows into production
 *                                          tables with no authentication.
 *
 * routes.ts cannot be imported in a unit test (it wires the whole server), so
 * each route's registration block is cut out of the source, type-stripped with
 * esbuild and evaluated against a fake `app`, a fake `storage` and stub guards.
 * The captured handlers are then EXECUTED. The projection helper is imported
 * and executed directly.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { transformSync } from "esbuild";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routesSource = readFileSync(path.join(serverDir, "routes.ts"), "utf8");

const REGISTRATION = /^\s*app\.(get|post|put|patch|delete)\(/;

/**
 * Returns the source from `startLine` through the line before the next route
 * registration that follows the registration at or after `startLine`.
 */
function blockFrom(source: string, startPredicate: (line: string) => boolean): string {
  const lines = source.split("\n");
  const start = lines.findIndex(startPredicate);
  assert.ok(start >= 0, "block start not found");
  let registration = start;
  while (registration < lines.length && !REGISTRATION.test(lines[registration])) registration++;
  assert.ok(registration < lines.length, "no route registration after block start");
  let end = registration + 1;
  while (end < lines.length && !REGISTRATION.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
}

function routeBlock(method: string, routePath: string): string {
  return blockFrom(routesSource, (line) => line.includes(`app.${method}("${routePath}"`));
}

type Captured = { method: string; path: string; handlers: Function[] };

/** Type-strips a registration block and evaluates it with `scope` as its free variables. */
function register(block: string, scope: Record<string, unknown>): Captured[] {
  const captured: Captured[] = [];
  const app: Record<string, unknown> = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (routePath: string, ...handlers: Function[]) => captured.push({ method, path: routePath, handlers });
  }
  const { code } = transformSync(block, { loader: "ts", target: "es2022" });
  const names = ["app", ...Object.keys(scope)];
  new Function(...names, code)(app, ...Object.values(scope));
  return captured;
}

function recorder() {
  return {
    statusCode: 200,
    payload: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

async function invoke(handler: Function, req: Record<string, unknown>) {
  const res = recorder();
  let nextCalled = false;
  await handler(
    { headers: {}, query: {}, params: {}, body: {}, isAuthenticated: () => false, ...req },
    res,
    () => { nextCalled = true; },
  );
  return { res, nextCalled };
}

/** Every column of the real `users` table plus a fabricated future one. */
function fullUserRow() {
  return {
    id: "user-1",
    email: "coach@example.test",
    firstName: "Dana",
    lastName: "Fletcher",
    passwordHash: "$2b$10$notarealhash",
    profileImageUrl: "https://example.test/dana.png",
    phone: "+15555550100",
    notes: "private admin notes",
    balanceCents: 4200,
    stripeCustomerId: "cus_123",
    lastSignInAt: new Date("2026-09-01"),
    weeklyReminderEnabled: true,
    lastReminderSentAt: null,
    passwordResetToken: "live-reset-token-abc123",
    passwordResetTokenExpires: new Date("2099-01-01"),
    unsubscribeToken: "unsub-xyz",
    notificationPreferences: { email: true },
    smsOptIn: true,
    smsOptInAt: null,
    smsOptOutAt: null,
    smsConsentSource: "signup",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    aFutureColumnNobodyThoughtAbout: "should never be serialized",
  };
}

/** Every column of coach_profiles, as `storage.getCoachProfilesByOrganization` returns it. */
function fullCoachRow() {
  return {
    id: "coach-1",
    userId: "user-1",
    email: "coach@example.test",
    passwordHash: "$2b$10$coachhash",
    bio: "Strength coach",
    specialties: ["Speed", "Power"],
    photoUrl: "https://example.test/coach.png",
    timezone: "America/New_York",
    location: "Main gym",
    isActive: true,
    payoutPercentage: 60,
    organizationId: "org-est",
    user: fullUserRow(),
  };
}

const USER_MUST_NEVER_APPEAR = [
  "passwordHash", "passwordResetToken", "passwordResetTokenExpires", "email", "phone", "notes",
  "balanceCents", "stripeCustomerId", "unsubscribeToken", "notificationPreferences", "lastSignInAt",
  "aFutureColumnNobodyThoughtAbout",
];

async function loadCoachVisibility() {
  return import("../lib/coach-visibility");
}

// ─── toPublicCoach ────────────────────────────────────────────────────────────

test("toPublicCoach removes the coach credentials and reduces the user to name and photo", async () => {
  const { toPublicCoach } = await loadCoachVisibility();
  const projected = toPublicCoach(fullCoachRow()) as any;

  assert.equal("passwordHash" in projected, false);
  assert.equal("email" in projected, false);
  assert.deepEqual(Object.keys(projected.user).sort(), ["firstName", "lastName", "profileImageUrl"]);
  for (const field of USER_MUST_NEVER_APPEAR) {
    assert.equal(field in projected.user, false, `user.${field} must not be serialized`);
  }
  assert.equal(JSON.stringify(projected).includes("notarealhash"), false);
  assert.equal(JSON.stringify(projected).includes("live-reset-token"), false);
});

test("toPublicCoach keeps every field the org landing and EST pages render", async () => {
  const { toPublicCoach } = await loadCoachVisibility();
  const projected = toPublicCoach(fullCoachRow()) as any;
  assert.equal(projected.id, "coach-1");
  assert.equal(projected.bio, "Strength coach");
  assert.deepEqual(projected.specialties, ["Speed", "Power"]);
  assert.equal(projected.photoUrl, "https://example.test/coach.png");
  assert.equal(projected.user.firstName, "Dana");
  assert.equal(projected.user.lastName, "Fletcher");
  assert.equal(projected.user.profileImageUrl, "https://example.test/dana.png");
});

test("toPublicCoach tolerates a coach with no joined user and toPublicCoaches maps a list", async () => {
  const { toPublicCoach, toPublicCoaches } = await loadCoachVisibility();
  const { user: _user, ...withoutUser } = fullCoachRow();
  assert.equal((toPublicCoach(withoutUser) as any).user, null);
  const list = toPublicCoaches([fullCoachRow(), fullCoachRow()]) as any[];
  assert.equal(list.length, 2);
  for (const coach of list) assert.equal("passwordHash" in coach, false);
  assert.deepEqual(toPublicCoaches(undefined as any), []);
});

// ─── GET /api/organizations/:slug/coaches ─────────────────────────────────────

test("GET /api/organizations/:slug/coaches serves the projected shape, not the raw join", async () => {
  const { toPublicCoaches } = await loadCoachVisibility();
  const storage = {
    getOrganizationBySlug: async (slug: string) => (slug === "est" ? { id: "org-est", slug } : undefined),
    getCoachProfilesByOrganization: async (orgId: string) => (orgId === "org-est" ? [fullCoachRow()] : []),
  };
  const [route] = register(routeBlock("get", "/api/organizations/:slug/coaches"), { storage, toPublicCoaches });
  assert.equal(route.path, "/api/organizations/:slug/coaches");

  const { res } = await invoke(route.handlers[route.handlers.length - 1], { params: { slug: "est" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.length, 1);
  const [coach] = res.payload;
  assert.equal("passwordHash" in coach, false, "coach.passwordHash leaked");
  assert.equal("email" in coach, false, "coach.email leaked");
  assert.deepEqual(Object.keys(coach.user).sort(), ["firstName", "lastName", "profileImageUrl"]);
  assert.equal(coach.id, "coach-1");
  assert.equal(coach.bio, "Strength coach");

  const missing = await invoke(route.handlers[route.handlers.length - 1], { params: { slug: "nope" } });
  assert.equal(missing.res.statusCode, 404);
});

// ─── GET /api/sessions/open ───────────────────────────────────────────────────

function sessionsFixture() {
  const calls = { open: [] as unknown[], bySlug: [] as string[], byId: [] as string[] };
  const storage = {
    getUserProfile: async (userId: string) => (userId === "athlete-a" ? { organizationId: "org-a" } : undefined),
    getOrganizationBySlug: async (slug: string) => {
      calls.bySlug.push(slug);
      return slug === "est" ? { id: "org-est", slug } : undefined;
    },
    getOrganizationById: async (id: string) => {
      calls.byId.push(id);
      return id === "org-est" ? { id, slug: "est" } : undefined;
    },
    getOpenSemiPrivateSessions: async (orgId: unknown) => {
      calls.open.push(orgId);
      return [{ id: "session-1", coach: { id: "coach-1", passwordHash: "hash", email: "c@x", user: fullUserRow() }, participantCount: 0 }];
    },
  };
  const [route] = register(routeBlock("get", "/api/sessions/open"), { storage, hashAuthToken: () => "unused" });
  assert.equal(route.path, "/api/sessions/open");
  const handler = route.handlers[route.handlers.length - 1];
  return { calls, handler };
}

test("GET /api/sessions/open refuses an anonymous caller that names no organization", async () => {
  const { calls, handler } = sessionsFixture();
  const { res } = await invoke(handler, {});
  assert.equal(res.statusCode, 400);
  assert.deepEqual(calls.open, [], "the unscoped query must never run");
});

test("GET /api/sessions/open scopes an anonymous caller to a validated slug", async () => {
  const { calls, handler } = sessionsFixture();
  const { res } = await invoke(handler, { query: { slug: "est" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.bySlug, ["est"]);
  assert.deepEqual(calls.open, ["org-est"]);

  const unknown = await invoke(handler, { query: { slug: "not-a-tenant" } });
  assert.equal(unknown.res.statusCode, 404);
  assert.deepEqual(calls.open, ["org-est"], "an unknown slug must not reach the query");
});

test("GET /api/sessions/open scopes an anonymous caller to a validated organizationId", async () => {
  const { calls, handler } = sessionsFixture();
  const { res } = await invoke(handler, { query: { organizationId: "org-est" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.byId, ["org-est"]);
  assert.deepEqual(calls.open, ["org-est"]);

  const unknown = await invoke(handler, { query: { organizationId: "org-that-does-not-exist" } });
  assert.equal(unknown.res.statusCode, 404);
  assert.deepEqual(calls.open, ["org-est"], "an unvalidated id must not be passed through to the query");
});

test("GET /api/sessions/open keeps an authenticated caller on their own org, ignoring the query", async () => {
  const { calls, handler } = sessionsFixture();
  const { res } = await invoke(handler, {
    isAuthenticated: () => true,
    user: { claims: { sub: "athlete-a" } },
    query: { slug: "est", organizationId: "org-est" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.open, ["org-a"]);
  assert.deepEqual(calls.bySlug, []);
});

test("GET /api/sessions/open still strips the coach credentials from each session", async () => {
  const { handler } = sessionsFixture();
  const { res } = await invoke(handler, { query: { slug: "est" } });
  const [session] = res.payload;
  assert.equal("passwordHash" in session.coach, false);
  assert.equal("email" in session.coach, false);
});

// ─── POST /api/marketplace/e2e-test ───────────────────────────────────────────

test("POST /api/marketplace/e2e-test is 404 in production and ADMIN-only elsewhere", async () => {
  const isAuthenticated = () => {};
  const roleGuard = () => {};
  const requireRoleCalls: string[][] = [];
  const requireRole = (...roles: string[]) => {
    requireRoleCalls.push(roles);
    return roleGuard;
  };
  const block = blockFrom(routesSource, (line) => line.includes("// End-to-end lifecycle flow test (Part 1)"));
  const [route] = register(block, { isAuthenticated, requireRole });
  assert.equal(route.path, "/api/marketplace/e2e-test");
  assert.equal(route.handlers.length, 4, "production gate, isAuthenticated, requireRole(ADMIN), handler");
  assert.equal(route.handlers[1], isAuthenticated);
  assert.equal(route.handlers[2], roleGuard);
  assert.deepEqual(requireRoleCalls, [["ADMIN"]]);

  const gate = route.handlers[0];
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const prod = await invoke(gate, {});
    assert.equal(prod.res.statusCode, 404);
    assert.equal(prod.nextCalled, false);

    process.env.NODE_ENV = "development";
    const dev = await invoke(gate, {});
    assert.equal(dev.nextCalled, true);
    assert.equal(dev.res.statusCode, 200);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
