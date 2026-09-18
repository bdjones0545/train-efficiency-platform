/**
 * Admin intelligence routes must resolve the caller's org through the shared,
 * trusted resolver.
 *
 * Five route modules each rolled their own org lookup against a column that does
 * not exist:
 *
 *   forecast-routes / outcome-intelligence-routes / agent-outcome-attribution-routes
 *       storage.getUser(userId).orgId       — `users` has no orgId column
 *   communication-intelligence-routes
 *       req.user.organizationId ?? .orgId   — req.user carries OIDC claims only
 *   athlete-intelligence-routes
 *       select orgUsers.orgId               — `org_users` has no such column, so
 *                                             the query threw and was swallowed
 *
 * Each therefore resolved to null for every caller, and every route answered 403
 * / 400 / 401. The pages read the failures as `?? 0` and `?? []` and rendered a
 * confident dashboard of zeros, so four sidebar journeys looked alive and were
 * dead. The fix routes all five through resolveOrgIdOrNull (server/lib/org-visibility).
 *
 * The athlete-intelligence routes also write athlete memory profiles and autonomy
 * trust levels while guarded by `isAuthenticated` alone; they now require
 * COACH or ADMIN.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { findRouteRegistrations } from "../lib/route-guard-audit";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/no_database_access";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf8");

const RESOLVER_ROUTE_FILES = [
  "server/agent-outcome-attribution-routes.ts",
  "server/athlete-intelligence-routes.ts",
  "server/communication-intelligence-routes.ts",
  "server/forecast-routes.ts",
  "server/outcome-intelligence-routes.ts",
];

// ── Source contract ──────────────────────────────────────────────────────────

test("every admin intelligence route module resolves the org through the shared resolver", () => {
  for (const file of RESOLVER_ROUTE_FILES) {
    const source = read(file);
    assert.match(
      source,
      /resolveOrgIdOrNull|resolveOrgIdOrThrow/,
      `${file} must resolve the caller's org with the shared resolver`,
    );
  }
});

test("no admin intelligence route reads an organization from a column that does not exist", () => {
  const offenders: string[] = [];
  for (const file of RESOLVER_ROUTE_FILES) {
    const source = read(file);
    // `users` has no orgId; `org_users` has no org_id/user_id; req.user has neither.
    for (const [pattern, why] of [
      [/user\?\.orgId/, "users table has no orgId column"],
      [/orgUsers\.orgId/, "org_users table has no orgId column"],
      [/user\?\.organizationId\s*\?\?\s*user\?\.orgId/, "req.user carries OIDC claims only"],
    ] as const) {
      if (pattern.test(source)) offenders.push(`${file}: ${why}`);
    }
  }
  assert.deepEqual(offenders, [], `phantom-column org lookups resolve to null for every caller:\n  ${offenders.join("\n  ")}`);
});

test("athlete intelligence routes require a coach or admin, not merely a session", () => {
  const source = read("server/athlete-intelligence-routes.ts");
  assert.match(
    source,
    /requireRole\("COACH",\s*"ADMIN"\)/,
    "athlete-intelligence-routes must import a COACH/ADMIN role gate",
  );

  const registrations = findRouteRegistrations(source, "server/athlete-intelligence-routes.ts");
  assert.ok(registrations.length >= 11, `expected the athlete-intelligence routes, found ${registrations.length}`);

  const unguarded = registrations
    .filter((r) => !r.guardNames.some((g) => /coachOrAdmin|requireRole/.test(g)))
    .map((r) => `${r.method.toUpperCase()} ${r.path}  (guards: ${r.guardNames.join(", ") || "none"})`);
  assert.deepEqual(
    unguarded,
    [],
    `these routes read and overwrite athlete profiles and trust levels with only a session:\n  ${unguarded.join("\n  ")}`,
  );
});

// ── Executing behaviour ──────────────────────────────────────────────────────

interface Registered {
  method: string;
  route: string;
  handler: (req: any, res: any) => any;
}

/** Records what registerForecastRoutes registers, without an HTTP server. */
function recordingApp() {
  const registered: Registered[] = [];
  const record = (method: string) => (route: string, ...rest: any[]) => {
    const handler = rest[rest.length - 1];
    if (typeof handler === "function") registered.push({ method, route, handler });
  };
  return {
    registered,
    get: record("get"),
    post: record("post"),
    put: record("put"),
    patch: record("patch"),
    delete: record("delete"),
    use: () => {},
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
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

/**
 * Minimal drizzle `select()` stub: `.from(table).where(...).limit(n)` resolves to
 * whatever rows the caller registered for that table. Enough for the profile
 * lookup the org resolver performs, and it touches no database.
 */
function stubSelect(rowsByTable: Map<unknown, unknown[]>) {
  return () => ({
    from(table: unknown) {
      const rows = rowsByTable.get(table) ?? [];
      const chain: any = {
        where: () => chain,
        limit: async () => rows,
        then: (onOk: any, onErr: any) => Promise.resolve(rows).then(onOk, onErr),
      };
      return chain;
    },
  });
}

async function forecastDashboardHandler() {
  const { registerForecastRoutes } = await import("../forecast-routes");
  const app = recordingApp();
  await registerForecastRoutes(app as any);
  const route = app.registered.find(
    (r) => r.method === "get" && r.route === "/api/forecast/dashboard",
  );
  assert.ok(route, "GET /api/forecast/dashboard should be registered");
  return route.handler;
}

test("a caller with no resolvable organization is refused, not served zeros", async () => {
  const handler = await forecastDashboardHandler();
  const res = responseRecorder();

  await handler({ headers: {}, user: undefined, path: "/api/forecast/dashboard" }, res as any);

  assert.equal(res.statusCode, 403, "an unresolvable org must be a refusal the page can show");
  assert.deepEqual(res.payload, { message: "Not authorized" });
});

test("the shared resolver supplies the org, so an org admin is no longer refused", async (t) => {
  const { db } = await import("../db");
  const { userProfiles, coachProfiles, orgMemberships } = await import("@shared/schema");
  const { resolveOrgIdOrNull } = await import("../lib/org-visibility");

  const original = db.select;
  t.after(() => {
    (db as any).select = original;
  });
  (db as any).select = stubSelect(
    new Map<unknown, unknown[]>([
      [userProfiles, [{ organizationId: "org-forecast", role: "ADMIN" }]],
      [coachProfiles, []],
      [orgMemberships, []],
    ]),
  );

  const req = { headers: {}, user: { claims: { sub: "admin-1" } }, path: "/api/forecast/dashboard" };

  // The resolver itself: the org comes from the caller's profile, never the request.
  assert.equal(await resolveOrgIdOrNull(req), "org-forecast");

  // And the route no longer stops at its authorization gate.
  const handler = await forecastDashboardHandler();
  const res = responseRecorder();
  await handler(req, res as any);
  assert.notEqual(res.statusCode, 403, "a resolvable org must get past the forecast authorization gate");
});
