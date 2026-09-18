/**
 * /api/org/intelligence/* — org resolution must be trusted, and event
 * resolution must be tenant-scoped.
 *
 * The routes' original helper returned the raw `X-Org-Auth-Token` header
 * VALUE as the organization id without any lookup, so an anonymous caller
 * could read any tenant's intelligence state, event timeline, daily brief and
 * escalations — and resolve any tenant's events — by sending that tenant's id
 * as the "token". `resolveEventLog` also updated by event id alone.
 *
 * These tests register the real routes against a fake Express app and execute
 * the captured handlers with `db` stubbed, so they prove behavior rather than
 * spelling. The last test is a secondary wiring check on the source.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { RequestHandler } from "express";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/no_database_access";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Route = { method: string; path: string; handlers: RequestHandler[] };

async function load() {
  const [{ registerOrchestrationRoutes }, { db }, orchestrator] = await Promise.all([
    import("../orchestration/orchestration-routes"),
    import("../db"),
    import("../orchestration/organization-intelligence-orchestrator"),
  ]);
  const routes: Route[] = [];
  const app: Record<string, unknown> = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (routePath: string, ...handlers: RequestHandler[]) => {
      routes.push({ method, path: routePath, handlers });
    };
  }
  registerOrchestrationRoutes(app as any);
  return { routes, db: db as any, orchestrator };
}

/** A thenable query-builder stand-in: every chained call returns itself, awaiting it yields `rows`. */
function chain(rows: unknown[]) {
  const c: any = {};
  for (const m of [
    "from", "where", "limit", "offset", "orderBy", "groupBy", "innerJoin", "leftJoin",
    "set", "values", "returning", "onConflictDoNothing", "onConflictDoUpdate",
  ]) {
    c[m] = () => c;
  }
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return c;
}

/**
 * Replaces the drizzle entry points on the shared `db` instance. Every SELECT
 * resolves `selectRows`; every UPDATE records the `where` expression it was
 * given so the test can render and inspect it.
 */
function stubDb(db: any, selectRows: unknown[]) {
  const original = { select: db.select, update: db.update, insert: db.insert, execute: db.execute };
  const updates: { where?: unknown }[] = [];
  db.select = () => chain(selectRows);
  db.insert = () => chain([]);
  db.execute = async () => ({ rows: [] });
  db.update = () => {
    const record: { where?: unknown } = {};
    updates.push(record);
    const c = chain([]);
    c.where = (expression: unknown) => {
      record.where = expression;
      return c;
    };
    return c;
  };
  return {
    updates,
    restore() {
      Object.assign(db, original);
    },
  };
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

function request(overrides: Record<string, unknown>) {
  return { headers: {}, query: {}, params: {}, body: {}, path: "/api/org/intelligence/test", ...overrides };
}

async function run(route: Route, req: Record<string, unknown>) {
  const res = recorder();
  const handler = route.handlers[route.handlers.length - 1];
  await handler(req as any, res as any, () => {});
  return res;
}

function renderWhere(expression: unknown) {
  return new PgDialect().sqlToQuery(expression as any);
}

test("registers every org-intelligence route", async () => {
  const { routes } = await load();
  assert.deepEqual(
    routes.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort(),
    [
      "GET /api/org/intelligence/athletes/:athleteUserId/timeline",
      "GET /api/org/intelligence/daily-ops",
      "GET /api/org/intelligence/escalation-summary",
      "GET /api/org/intelligence/event-log",
      "GET /api/org/intelligence/event-stream",
      "GET /api/org/intelligence/state",
      "PATCH /api/org/intelligence/event-log/:id/resolve",
      "POST /api/org/intelligence/daily-ops/regenerate",
      "POST /api/org/intelligence/state/refresh",
    ],
  );
});

test("an X-Org-Auth-Token that matches no org session is rejected, not used as the org id", async () => {
  const { routes, db } = await load();
  // No org_sessions row matches the token, no OIDC session, no Bearer token.
  const stub = stubDb(db, []);
  try {
    for (const route of routes) {
      const res = await run(route, request({
        headers: { "x-org-auth-token": "victim-org-id" },
        params: { id: "evt-1", athleteUserId: "athlete-1" },
      }));
      assert.equal(res.statusCode, 401, `${route.method.toUpperCase()} ${route.path}`);
      assert.notEqual(res.payload?.orgId, "victim-org-id", `${route.method.toUpperCase()} ${route.path}`);
    }
    // Nothing was resolved, so nothing was written.
    assert.equal(stub.updates.length, 0);
  } finally {
    stub.restore();
  }
});

test("anonymous callers with no credentials at all are rejected", async () => {
  const { routes, db } = await load();
  const stub = stubDb(db, []);
  try {
    for (const route of routes) {
      const res = await run(route, request({ params: { id: "evt-1", athleteUserId: "athlete-1" } }));
      assert.equal(res.statusCode, 401, `${route.method.toUpperCase()} ${route.path}`);
    }
  } finally {
    stub.restore();
  }
});

test("a session whose profile resolves to an org is served that org, and event resolution is scoped to it", async () => {
  const { routes, db } = await load();
  const route = routes.find((r) => r.method === "patch" && r.path === "/api/org/intelligence/event-log/:id/resolve")!;
  // The caller's profile row belongs to org-a. The event id in the URL is attacker-chosen.
  const stub = stubDb(db, [{ organizationId: "org-a" }]);
  try {
    const res = await run(route, request({
      user: { claims: { sub: "admin-a" } },
      params: { id: "evt-belonging-to-org-b" },
    }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { success: true });
    assert.equal(stub.updates.length, 1, "exactly one UPDATE was issued");

    const { sql, params } = renderWhere(stub.updates[0].where);
    assert.match(sql, /"organization_event_log"\."id" = \$\d/);
    assert.match(sql, /"organization_event_log"\."org_id" = \$\d/, "UPDATE must be constrained by the caller's org");
    assert.deepEqual(params, ["evt-belonging-to-org-b", "org-a"]);
  } finally {
    stub.restore();
  }
});

test("resolveEventLog constrains the UPDATE by both event id and org id", async () => {
  const { db, orchestrator } = await load();
  const stub = stubDb(db, []);
  try {
    await (orchestrator.resolveEventLog as (id: string, orgId: string) => Promise<void>)("evt-1", "org-a");
    assert.equal(stub.updates.length, 1);
    const { sql, params } = renderWhere(stub.updates[0].where);
    assert.match(sql, /"organization_event_log"\."org_id" = \$\d/);
    assert.deepEqual(params, ["evt-1", "org-a"]);
  } finally {
    stub.restore();
  }
});

test("wiring: the routes delegate to resolveOrgIdOrThrow and never read the org token as an id", () => {
  const source = readFileSync(path.join(serverDir, "orchestration", "orchestration-routes.ts"), "utf8");
  assert.ok(source.includes("resolveOrgIdOrThrow"), "must use the trusted resolver");
  assert.doesNotMatch(source, /req\.headers\["x-org-auth-token"\]/, "must not read the org token directly");
  assert.match(source, /resolveEventLog\(id, orgId\)/, "PATCH resolve must pass the resolved org");
});
