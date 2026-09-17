/**
 * Athlete profile routes — role gate and note tenancy.
 *
 * `server/athlete-profile-routes.ts` guards all seven routes with one
 * middleware, `resolveCoachAuth`. It used to accept anyone who could be
 * associated with an organization at all, which every self-registered CLIENT
 * can (`POST /api/client/register` puts the caller in the org of their
 * choosing). These tests execute the middleware and the note handlers against
 * a recorded database rather than reading the source for a pattern.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/no_database_access";
process.env.OPENAI_API_KEY ??= "sk-test-sentinel-tests-must-not-call-openai";

type RegisteredRoute = { method: string; path: string; handlers: Function[] };

const dbModule = await import("../db");
const { storage } = await import("../storage");
const { registerAthleteProfileRoutes } = await import("../athlete-profile-routes");

function loadRoutes(): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const record = (method: string) => (path: string, ...handlers: Function[]) => {
    routes.push({ method, path, handlers });
  };
  registerAthleteProfileRoutes({
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

/** A drizzle-shaped builder that resolves to `rows` however it is chained. */
function queryChain(rows: any[]) {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    set: () => chain,
    values: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    returning: () => Promise.resolve(rows),
    then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

/**
 * Replaces every data-access method on the shared `db` with a counted stub, so
 * a test can tell "the guard rejected before touching anything" apart from
 * "the handler ran and read the athlete's record".
 */
function stubDatabase(options: { profileRow?: any } = {}) {
  const original = {
    select: dbModule.db.select,
    execute: dbModule.db.execute,
    insert: dbModule.db.insert,
    update: dbModule.db.update,
    delete: dbModule.db.delete,
  };
  const counts = { select: 0, execute: 0, insert: 0, update: 0, delete: 0 };
  const rows = options.profileRow ? [options.profileRow] : [];
  (dbModule.db as any).select = () => {
    counts.select += 1;
    return queryChain(rows);
  };
  (dbModule.db as any).execute = async () => {
    counts.execute += 1;
    return { rows: [] };
  };
  for (const op of ["insert", "update", "delete"] as const) {
    (dbModule.db as any)[op] = () => {
      counts[op] += 1;
      return queryChain([]);
    };
  }
  return {
    counts,
    restore() {
      Object.assign(dbModule.db as any, original);
    },
  };
}

function stubRole(role: string | null) {
  const original = storage.getUserProfile;
  storage.getUserProfile = (async (userId: string) =>
    role === null ? undefined : { id: `profile-${userId}`, userId, organizationId: "org-a", role }) as any;
  return () => {
    storage.getUserProfile = original;
  };
}

const sessionRequest = () => ({
  headers: {},
  params: { userId: "athlete-1", noteId: "note-1" },
  query: {},
  body: {},
  user: { claims: { sub: "caller-1" }, id: "caller-1", expires_at: Number.MAX_SAFE_INTEGER },
  isAuthenticated: () => true,
});

test("every athlete-profile route is registered behind the shared auth middleware", () => {
  const routes = loadRoutes();
  assert.deepEqual(
    routes.map((route) => `${route.method.toUpperCase()} ${route.path}`),
    [
      "GET /api/org/athlete-profile/:userId",
      "GET /api/org/athlete-profile/:userId/graphs",
      "GET /api/org/athlete-profile/:userId/timeline",
      "POST /api/org/athlete-profile/:userId/ai-summary",
      "POST /api/org/athlete-profile/:userId/notes",
      "PATCH /api/org/athlete-profile/:userId/notes/:noteId",
      "DELETE /api/org/athlete-profile/:userId/notes/:noteId",
    ],
  );
  for (const route of routes) assert.equal(route.handlers.length, 2, route.path);
  const guards = new Set(routes.map((route) => route.handlers[0]));
  assert.equal(guards.size, 1, "all routes share one guard");
});

test("a CLIENT in the organization is refused on every route and never reaches the handler", async () => {
  const routes = loadRoutes();
  const restoreRole = stubRole("CLIENT");
  try {
    for (const route of routes) {
      const stub = stubDatabase({ profileRow: { organizationId: "org-a", userId: "caller-1" } });
      try {
        const res = responseRecorder();
        let reached = false;
        await route.handlers[0](sessionRequest(), res as any, async () => {
          reached = true;
          await route.handlers[1](sessionRequest(), res as any);
        });
        assert.equal(reached, false, route.path);
        assert.equal(res.statusCode, 403, route.path);
        // Only the two identity lookups the guard itself makes.
        assert.equal(stub.counts.select, 2, route.path);
        assert.equal(stub.counts.insert, 0, route.path);
        assert.equal(stub.counts.update, 0, route.path);
        assert.equal(stub.counts.delete, 0, route.path);
      } finally {
        stub.restore();
      }
    }
  } finally {
    restoreRole();
  }
});

test("a user with no role at all is refused (least privilege default)", async () => {
  const [route] = loadRoutes();
  const restoreRole = stubRole(null);
  const stub = stubDatabase({ profileRow: { organizationId: "org-a", userId: "caller-1" } });
  try {
    const res = responseRecorder();
    let reached = false;
    await route.handlers[0](sessionRequest(), res as any, () => {
      reached = true;
    });
    assert.equal(reached, false);
    assert.equal(res.statusCode, 403);
  } finally {
    stub.restore();
    restoreRole();
  }
});

test("COACH and ADMIN pass the guard and receive their own organization scope", async () => {
  const routes = loadRoutes();
  for (const role of ["COACH", "ADMIN"]) {
    const restoreRole = stubRole(role);
    const stub = stubDatabase({ profileRow: { organizationId: "org-a", userId: "caller-1" } });
    try {
      for (const route of routes) {
        const res = responseRecorder();
        const req: any = sessionRequest();
        let reached = false;
        await route.handlers[0](req, res as any, () => {
          reached = true;
        });
        assert.equal(reached, true, `${role} ${route.path}`);
        assert.deepEqual(req._auth, { userId: "caller-1", orgId: "org-a" }, `${role} ${route.path}`);
      }
    } finally {
      stub.restore();
      restoreRole();
    }
  }
});

test("an unauthenticated caller is refused with 401", async () => {
  const [route] = loadRoutes();
  const stub = stubDatabase();
  try {
    const res = responseRecorder();
    let reached = false;
    await route.handlers[0]({ headers: {}, params: {}, query: {}, body: {} }, res as any, () => {
      reached = true;
    });
    assert.equal(reached, false);
    assert.equal(res.statusCode, 401);
  } finally {
    stub.restore();
  }
});

/**
 * The note handlers are keyed by a note id that is unique across the whole
 * table, so without an org predicate a coach in org A could edit or delete any
 * organization's coach notes. These two tests let drizzle build the real SQL
 * and intercept it at the connection, so the assertion is about the statement
 * that would reach PostgreSQL, not about the source text.
 */
function stubConnection() {
  const original = dbModule.pool.query;
  const statements: { text: string; params: any[] }[] = [];
  (dbModule.pool as any).query = async (config: any, params: any[]) => {
    statements.push({ text: typeof config === "string" ? config : config?.text ?? "", params: params ?? [] });
    return { rows: [], rowCount: 0, fields: [] };
  };
  return {
    statements,
    restore() {
      (dbModule.pool as any).query = original;
    },
  };
}

test("deleting a note that belongs to another organization matches no row and answers 404", async () => {
  const route = loadRoutes().find((r) => r.method === "delete")!;
  const connection = stubConnection();
  try {
    const res = responseRecorder();
    const req: any = sessionRequest();
    req._auth = { userId: "coach-a", orgId: "org-a" };
    await route.handlers[1](req, res as any);

    assert.equal(res.statusCode, 404);
    assert.equal(connection.statements.length, 1);
    const [statement] = connection.statements;
    assert.match(statement.text, /delete from "athlete_intervention_recommendations"/i);
    assert.match(statement.text, /"org_id"/);
    assert.ok(statement.params.includes("org-a"), "the caller's org is a bound parameter");
    assert.ok(statement.params.includes("note-1"), "the note id is a bound parameter");
  } finally {
    connection.restore();
  }
});

test("editing a note that belongs to another organization matches no row and answers 404", async () => {
  const route = loadRoutes().find((r) => r.method === "patch")!;
  const connection = stubConnection();
  try {
    const res = responseRecorder();
    const req: any = sessionRequest();
    req.body = { note: "rewritten by an outsider" };
    req._auth = { userId: "coach-a", orgId: "org-a" };
    await route.handlers[1](req, res as any);

    assert.equal(res.statusCode, 404);
    assert.equal(connection.statements.length, 1);
    const [statement] = connection.statements;
    assert.match(statement.text, /update "athlete_intervention_recommendations"/i);
    assert.match(statement.text, /"org_id"/);
    assert.ok(statement.params.includes("org-a"), "the caller's org is a bound parameter");
  } finally {
    connection.restore();
  }
});
