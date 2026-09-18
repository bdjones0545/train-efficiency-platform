/**
 * Execution routes — approval authority and tenancy.
 *
 * `server/execution-routes.ts` registered every approve / execute / escalate /
 * reject / resolve endpoint with no middleware and a helper named
 * `requireAdmin` that only asked whether `req.user` existed. Any authenticated
 * CLIENT could therefore approve and execute agent actions. These tests execute
 * the registered middleware chain for every route in the module. The two SQL
 * tenancy hops below them cannot be executed without a live database (both go
 * through a schema validator first), so those are asserted on the statements.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/no_database_access";
process.env.OPENAI_API_KEY ??= "sk-test-sentinel-tests-must-not-call-openai";

type RegisteredRoute = { method: string; path: string; handlers: Function[] };

await import("../db");
const { storage } = await import("../storage");
const { registerExecutionRoutes } = await import("../execution-routes");

function loadRoutes(): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const record = (method: string) => (path: string, ...handlers: Function[]) => {
    routes.push({ method, path, handlers });
  };
  registerExecutionRoutes({
    get: record("get"),
    post: record("post"),
    patch: record("patch"),
    delete: record("delete"),
  } as any);
  return routes;
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

function stubRole(role: string) {
  const original = storage.getUserProfile;
  storage.getUserProfile = (async (userId: string) => ({
    id: `profile-${userId}`,
    userId,
    organizationId: "org-a",
    role,
  })) as any;
  return () => {
    storage.getUserProfile = original;
  };
}

function sessionRequest() {
  return {
    headers: {},
    params: { id: "action-1" },
    query: {},
    body: { actionId: "action-1", sourceSystem: "gmail_agent" },
    user: { claims: { sub: "caller-1" }, id: "caller-1", expires_at: Number.MAX_SAFE_INTEGER },
    isAuthenticated: () => true,
  };
}

/** Runs [isAuthenticated, requireRole] and reports whether the handler was reached. */
async function runGuards(route: RegisteredRoute, req: any, res: ReturnType<typeof responseRecorder>) {
  let reached = false;
  const [authenticate, authorize] = route.handlers;
  await authenticate(req, res as any, async () => {
    await authorize(req, res as any, () => {
      reached = true;
    });
  });
  return reached;
}

const MUTATING_PATHS = [
  "/api/actions/approve",
  "/api/actions/reject",
  "/api/actions/escalate",
  "/api/actions/execute",
  "/api/conflicts/:id/resolve",
];

test("every execution route is registered with authentication and a role check", () => {
  const routes = loadRoutes();
  assert.ok(routes.length >= 11, `expected the full execution surface, saw ${routes.length}`);
  for (const route of routes) {
    assert.equal(route.handlers.length, 3, `${route.method.toUpperCase()} ${route.path}`);
  }
  for (const path of MUTATING_PATHS) {
    assert.ok(routes.some((route) => route.path === path), `${path} must be registered`);
  }
});

test("an authenticated CLIENT cannot approve, execute, escalate, reject or resolve", async () => {
  const routes = loadRoutes();
  const restore = stubRole("CLIENT");
  try {
    for (const route of routes) {
      const res = responseRecorder();
      const reached = await runGuards(route, sessionRequest(), res);
      assert.equal(reached, false, `${route.method.toUpperCase()} ${route.path}`);
      assert.equal(res.statusCode, 403, `${route.method.toUpperCase()} ${route.path}`);
    }
  } finally {
    restore();
  }
});

test("an unauthenticated caller is refused with 401 before the role lookup", async () => {
  const routes = loadRoutes();
  for (const route of routes) {
    const res = responseRecorder();
    const reached = await runGuards(route, { headers: {}, params: {}, query: {}, body: {}, isAuthenticated: () => false }, res);
    assert.equal(reached, false, route.path);
    assert.equal(res.statusCode, 401, route.path);
  }
});

test("COACH and ADMIN reach the handler", async () => {
  const routes = loadRoutes();
  for (const role of ["COACH", "ADMIN"]) {
    const restore = stubRole(role);
    try {
      for (const route of routes) {
        const res = responseRecorder();
        const reached = await runGuards(route, sessionRequest(), res);
        assert.equal(reached, true, `${role} ${route.method.toUpperCase()} ${route.path}`);
      }
    } finally {
      restore();
    }
  }
});

test("the in-handler requireAdmin shim is gone", async () => {
  const source = await readFile(new URL("../execution-routes.ts", import.meta.url), "utf8");
  assert.equal(/function requireAdmin/.test(source), false);
  assert.equal(/requireAdmin\(req, res\)/.test(source), false);
});

test("every reject statement carries the caller's organization", async () => {
  const source = await readFile(new URL("../execution-routes.ts", import.meta.url), "utf8");
  const rejectBody = source.slice(
    source.indexOf("async function rejectAction("),
    source.indexOf("export function registerExecutionRoutes"),
  );
  const updates = rejectBody.match(/UPDATE [a-z_]+/g) ?? [];
  assert.equal(updates.length, 4, "hermes, autonomous_queue, agentmail and gmail_agent");
  // Each UPDATE ends its WHERE clause with an organization predicate.
  const scoped = rejectBody.match(/AND (org_id|organization_id) = \$\{orgId\}/g) ?? [];
  assert.equal(scoped.length, 4, "every reject UPDATE is org-scoped");
  assert.equal(/UPDATE gmail_agent_actions SET status = 'rejected' WHERE id = \$\{actionId\}\s*`/.test(source), false);
});

/**
 * `getExecutionEvent` calls `ensureExecutionTables()` first, which validates the
 * autonomous feature schema against a live database, so this one hop cannot be
 * executed without infrastructure. Assert the statement and its call site
 * instead — the compiler enforces the rest, because the org parameter is
 * required rather than optional.
 */
test("reading one execution event by id is scoped to the caller's organization", async () => {
  const engine = await readFile(new URL("../services/unified-execution-engine.ts", import.meta.url), "utf8");
  assert.match(engine, /export async function getExecutionEvent\(executionId: string, orgId: string\)/);
  assert.match(engine, /SELECT \* FROM execution_events WHERE id = \$\{executionId\} AND org_id = \$\{orgId\}/);

  const routes = await readFile(new URL("../execution-routes.ts", import.meta.url), "utf8");
  assert.match(routes, /const orgId = await getOrgId\(req\);\n\s*const event = await getExecutionEvent\(req\.params\.id, orgId\);/);
});
