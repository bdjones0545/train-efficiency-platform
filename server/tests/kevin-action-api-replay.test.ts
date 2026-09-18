/**
 * Kevin Action API — replay, org-scoping and token-rotation regressions.
 *
 * These are EXECUTING tests: the real middleware chain that
 * server/kevin-action-api-routes.ts registers is captured through a stub Express
 * app and invoked with fake req/res objects. The final layer (the route handler)
 * is never called — reaching it is what the replay tests assert must not happen.
 *
 * Defects covered (all traced on main @ f370f74):
 *   1. kevin-action-api-routes.ts:~104 — replayGuard called next() whenever the
 *      caller omitted X-Kevin-Timestamp, so a captured production request could
 *      be replayed forever.
 *   2. kevin-action-api-routes.ts:~69 — nonces lived in a per-process Map, so on
 *      Replit autoscale the same nonce replayed to a second instance was fresh.
 *      "A second instance" is simulated here by importing the route module a
 *      second time with a cache-busting query: a new module instance gets a new
 *      Map, exactly like a new process, while anything it imports (the shared
 *      nonce store) stays shared, exactly like the database.
 *   3. kevin-action-api-routes.ts:~142 — org_id is taken from the request with no
 *      restriction on which orgs the one global token may act on.
 *   4. require-internal-service-token.ts — TE_INTERNAL_SERVICE_TOKEN_NEW was
 *      documented (docs/kevin-integration.md §2) but never read.
 *
 * Run with:
 *   node --import tsx --test server/tests/kevin-action-api-replay.test.ts
 */

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  requireInternalServiceToken,
  isInternalServiceTokenConfigured,
} from "../middleware/require-internal-service-token";
import type {
  ActionNonceStore,
  NonceClaim,
} from "../middleware/kevin-action-api-guards";

/**
 * The guards module is imported lazily (and type-only above, which erases at
 * runtime) so that this exact file also runs against the pre-fix tree, where the
 * module does not exist: the replay tests then fail on their assertions — the
 * behaviour — rather than on a missing import.
 */
async function guards(): Promise<any | null> {
  try {
    return await import("../middleware/kevin-action-api-guards");
  } catch {
    return null;
  }
}

const TOKEN = "kevin-action-test-token-000000000000";
const NEW_TOKEN = "kevin-action-rotated-token-1111111111";
const ORG_ALLOWED = "11111111-1111-1111-1111-111111111111";
const ORG_FOREIGN = "22222222-2222-2222-2222-222222222222";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─── Stub express app + fake req/res ─────────────────────────────────────────

type Layer = (req: any, res: any, next: any) => any;

function makeStubApp() {
  const routes = new Map<string, Layer[]>();
  const record = (method: string) => (routePath: string, ...handlers: Layer[]) => {
    routes.set(`${method} ${routePath}`, handlers);
  };
  const app = {
    get: record("GET"),
    post: record("POST"),
    put: record("PUT"),
    patch: record("PATCH"),
    delete: record("DELETE"),
    use: () => {},
  };
  return { app, routes };
}

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    headers: {} as Record<string, string>,
    ended: false,
    set(key: string, value: string) {
      this.headers[key] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      this.ended = true;
      return this;
    },
    send(body: any) {
      this.body = body;
      this.ended = true;
      return this;
    },
  };
  return res;
}

interface ChainResult {
  reachedHandler: boolean;
  res: any;
}

/**
 * Runs every middleware in the chain except the final route handler.
 * `reachedHandler` is true when all middleware called next() — i.e. the real
 * handler would have executed.
 */
async function runGuardChain(layers: Layer[], req: any): Promise<ChainResult> {
  const middleware = layers.slice(0, -1);
  const res = makeRes();
  let index = 0;
  let reachedHandler = false;

  async function step(): Promise<void> {
    if (index >= middleware.length) {
      reachedHandler = true;
      return;
    }
    const layer = middleware[index++];
    let advanced = false;
    await layer(req, res, () => {
      advanced = true;
    });
    if (advanced) await step();
  }

  await step();
  return { reachedHandler, res };
}

function makeReq(overrides: Record<string, any> = {}) {
  return {
    method: "POST",
    path: "/api/internal/kevin/v1/intents",
    headers: { authorization: `Bearer ${TOKEN}`, ...(overrides.headers ?? {}) },
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "headers")),
  };
}

/** Shared (cross-instance) nonce store stub — stands in for the database. */
function makeMemoryNonceStore(): ActionNonceStore & { seen: Set<string> } {
  const seen = new Set<string>();
  return {
    seen,
    async claim(nonce: string): Promise<NonceClaim> {
      if (seen.has(nonce)) return "duplicate";
      seen.add(nonce);
      return "fresh";
    },
  };
}

// ─── Fixture: the real registered chain ──────────────────────────────────────

let primaryRoutes: Map<string, Layer[]>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

before(async () => {
  process.env.TE_INTERNAL_SERVICE_TOKEN = TOKEN;
  const { app, routes } = makeStubApp();
  const mod = await import("../kevin-action-api-routes");
  await mod.registerKevinActionApiRoutes(app as any);
  primaryRoutes = routes;
  assert.ok(
    primaryRoutes.get("POST /api/internal/kevin/v1/intents"),
    "POST /api/internal/kevin/v1/intents must be registered",
  );
});

beforeEach(async () => {
  process.env.TE_INTERNAL_SERVICE_TOKEN = TOKEN;
  delete process.env.TE_INTERNAL_SERVICE_TOKEN_NEW;
  delete process.env.KEVIN_ALLOWED_ORG_IDS;
  const g = await guards();
  g?.__resetKevinActionRateLimiterForTests();
  g?.__setActionNonceStoreForTests(makeMemoryNonceStore());
});

after(async () => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  (await guards())?.__setActionNonceStoreForTests(null);
});

function intentsChain(): Layer[] {
  return primaryRoutes.get("POST /api/internal/kevin/v1/intents")!;
}

// ─── Defect 1: replay headers are mandatory in production ────────────────────

test("production POST without X-Kevin-Timestamp/X-Kevin-Nonce is rejected 400 and never reaches the handler", async () => {
  process.env.NODE_ENV = "production";
  try {
    const { reachedHandler, res } = await runGuardChain(
      intentsChain(),
      makeReq({ body: { org_id: ORG_ALLOWED, capability_key: "x", goal: "y" } }),
    );
    assert.equal(reachedHandler, false, "handler must not run without replay headers");
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.code, "REPLAY_HEADERS_REQUIRED");
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

test("production POST with a timestamp but no nonce is rejected 400", async () => {
  process.env.NODE_ENV = "production";
  try {
    const { reachedHandler, res } = await runGuardChain(
      intentsChain(),
      makeReq({ headers: { "x-kevin-timestamp": String(Date.now()) } }),
    );
    assert.equal(reachedHandler, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.code, "REPLAY_HEADERS_REQUIRED");
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

test("a stale timestamp is rejected 400 REPLAY_REJECTED", async () => {
  const { reachedHandler, res } = await runGuardChain(
    intentsChain(),
    makeReq({
      headers: {
        "x-kevin-timestamp": String(Date.now() - 60 * 60 * 1000),
        "x-kevin-nonce": "nonce-stale",
      },
    }),
  );
  assert.equal(reachedHandler, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.code, "REPLAY_REJECTED");
});

test("a fresh timestamp + nonce passes the guards", async () => {
  process.env.NODE_ENV = "production";
  try {
    const { reachedHandler, res } = await runGuardChain(
      intentsChain(),
      makeReq({
        headers: { "x-kevin-timestamp": String(Date.now()), "x-kevin-nonce": "nonce-fresh" },
      }),
    );
    assert.equal(reachedHandler, true, `guards rejected a valid request: ${JSON.stringify(res.body)}`);
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

test("outside production, missing replay headers stay lenient", async () => {
  process.env.NODE_ENV = "development";
  try {
    const { reachedHandler } = await runGuardChain(intentsChain(), makeReq());
    assert.equal(reachedHandler, true, "development must keep working without replay headers");
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

// ─── Defect 2: the nonce store must be shared across instances ───────────────

test("a nonce replayed to a SECOND instance is rejected 409 and never reaches the handler", async () => {
  process.env.NODE_ENV = "production";
  const store = makeMemoryNonceStore();
  try {
    // The shared store stands in for PostgreSQL. On the pre-fix tree this module
    // does not exist and the per-process Map is used instead — which is the defect.
    (await guards())?.__setActionNonceStoreForTests(store);

    const nonce = "nonce-cross-instance";
    const headers = { "x-kevin-timestamp": String(Date.now()), "x-kevin-nonce": nonce };

    const first = await runGuardChain(intentsChain(), makeReq({ headers }));
    assert.equal(first.reachedHandler, true, "the first use of a nonce must be accepted");

    // Second autoscale instance: a fresh module instance, fresh process-local state.
    const { app, routes } = makeStubApp();
    const secondInstance = await import("../kevin-action-api-routes.ts?instance=2");
    await (secondInstance as any).registerKevinActionApiRoutes(app as any);
    const replayLayers = routes.get("POST /api/internal/kevin/v1/intents")!;

    const replay = await runGuardChain(replayLayers, makeReq({ headers }));
    assert.equal(
      replay.reachedHandler,
      false,
      "a replayed nonce reached the handler on a second instance — the nonce store is not shared",
    );
    assert.equal(replay.res.statusCode, 409);
    assert.equal(replay.res.body?.code, "REPLAY_REJECTED");
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

test("the nonce store fails CLOSED: a store error returns 503, not a pass-through", async () => {
  process.env.NODE_ENV = "production";
  try {
    const g = await guards();
    assert.ok(g, "the shared nonce store module must exist");
    g.__setActionNonceStoreForTests({
      async claim() {
        throw new Error("connection terminated");
      },
    } satisfies ActionNonceStore);
    const { reachedHandler, res } = await runGuardChain(
      intentsChain(),
      makeReq({
        headers: { "x-kevin-timestamp": String(Date.now()), "x-kevin-nonce": "nonce-db-down" },
      }),
    );
    assert.equal(reachedHandler, false, "a nonce that could not be recorded must not be trusted");
    assert.equal(res.statusCode, 503);
    assert.equal(res.body?.code, "REPLAY_STORE_UNAVAILABLE");
  } finally {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

test("the nonce store claims through the shared kevin_callback_nonces table", async () => {
  const src = readFileSync(
    path.join(serverDir, "middleware", "kevin-action-api-guards.ts"),
    "utf8",
  );
  assert.match(src, /kevin_callback_nonces/, "must reuse the existing nonce table");
  assert.match(src, /ON CONFLICT \(id\) DO NOTHING\s*\n?\s*RETURNING id/, "claim must be atomic");
});

// ─── Defect 3a: organization allowlist ───────────────────────────────────────

for (const [label, req] of [
  ["body", makeReq({ body: { org_id: ORG_FOREIGN } })],
  ["query", makeReq({ query: { org_id: ORG_FOREIGN } })],
  ["header", makeReq({ headers: { "x-org-id": ORG_FOREIGN } })],
] as Array<[string, any]>) {
  test(`allowlist set: a foreign org_id in the ${label} is rejected 403`, async () => {
    process.env.KEVIN_ALLOWED_ORG_IDS = ORG_ALLOWED;
    const { reachedHandler, res } = await runGuardChain(intentsChain(), req);
    assert.equal(reachedHandler, false, "handler must not run for a non-allowlisted org");
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.code, "ORG_NOT_ALLOWED");
  });
}

test("allowlist set: an allowlisted org_id passes", async () => {
  process.env.KEVIN_ALLOWED_ORG_IDS = ` ${ORG_FOREIGN} , ${ORG_ALLOWED} `;
  const { reachedHandler } = await runGuardChain(
    intentsChain(),
    makeReq({ body: { org_id: ORG_ALLOWED } }),
  );
  assert.equal(reachedHandler, true);
});

test("allowlist unset: behaviour is unchanged (the live integration keeps working)", async () => {
  delete process.env.KEVIN_ALLOWED_ORG_IDS;
  const { reachedHandler } = await runGuardChain(
    intentsChain(),
    makeReq({ body: { org_id: ORG_FOREIGN } }),
  );
  assert.equal(reachedHandler, true);
});

// ─── Defect 3b: per-token rate limiting ──────────────────────────────────────

test("the action API rate-limits per token with 429", async () => {
  const { KEVIN_ACTION_RATE_LIMIT } = await import("../middleware/kevin-action-api-guards");
  let last: ChainResult | null = null;
  for (let i = 0; i <= KEVIN_ACTION_RATE_LIMIT; i++) {
    last = await runGuardChain(
      intentsChain(),
      makeReq({ headers: { "x-kevin-timestamp": String(Date.now()), "x-kevin-nonce": `rl-${i}` } }),
    );
  }
  assert.equal(last!.reachedHandler, false, "request beyond the limit must be blocked");
  assert.equal(last!.res.statusCode, 429);
  assert.equal(last!.res.body?.code, "RATE_LIMIT_EXCEEDED");
  assert.ok(last!.res.headers["Retry-After"], "429 must carry Retry-After");

  // A different token has its own bucket.
  process.env.TE_INTERNAL_SERVICE_TOKEN_NEW = NEW_TOKEN;
  const other = await runGuardChain(
    intentsChain(),
    makeReq({ headers: { authorization: `Bearer ${NEW_TOKEN}` } }),
  );
  assert.equal(other.reachedHandler, true, "the limiter must be keyed per token");
});

// ─── Defect 4: TE_INTERNAL_SERVICE_TOKEN_NEW rotation ────────────────────────

function callTokenMiddleware(authHeader: string | undefined) {
  const req: any = { headers: authHeader ? { authorization: authHeader } : {} };
  const res = makeRes();
  let advanced = false;
  requireInternalServiceToken(req, res, () => {
    advanced = true;
  });
  return { advanced, res };
}

test("rotation: both TE_INTERNAL_SERVICE_TOKEN and TE_INTERNAL_SERVICE_TOKEN_NEW are accepted", () => {
  process.env.TE_INTERNAL_SERVICE_TOKEN = TOKEN;
  process.env.TE_INTERNAL_SERVICE_TOKEN_NEW = NEW_TOKEN;
  assert.equal(callTokenMiddleware(`Bearer ${TOKEN}`).advanced, true, "current token must work");
  assert.equal(callTokenMiddleware(`Bearer ${NEW_TOKEN}`).advanced, true, "_NEW token must work");
});

test("rotation: the _NEW token alone is enough once the old one is removed", () => {
  delete process.env.TE_INTERNAL_SERVICE_TOKEN;
  process.env.TE_INTERNAL_SERVICE_TOKEN_NEW = NEW_TOKEN;
  assert.equal(isInternalServiceTokenConfigured(), true);
  assert.equal(callTokenMiddleware(`Bearer ${NEW_TOKEN}`).advanced, true);
  assert.equal(callTokenMiddleware(`Bearer ${TOKEN}`).advanced, false);
});

test("a wrong token is rejected 401 whether or not a rotation is in progress", () => {
  process.env.TE_INTERNAL_SERVICE_TOKEN = TOKEN;
  const withoutRotation = callTokenMiddleware("Bearer wrong-token-wrong-token-wrong-token");
  assert.equal(withoutRotation.advanced, false);
  assert.equal(withoutRotation.res.statusCode, 401);
  assert.equal(withoutRotation.res.body?.code, "UNAUTHORIZED");

  process.env.TE_INTERNAL_SERVICE_TOKEN_NEW = NEW_TOKEN;
  const withRotation = callTokenMiddleware("Bearer wrong-token-wrong-token-wrong-token");
  assert.equal(withRotation.advanced, false);
  assert.equal(withRotation.res.statusCode, 401);
});

test("no token configured fails closed with 503", () => {
  delete process.env.TE_INTERNAL_SERVICE_TOKEN;
  delete process.env.TE_INTERNAL_SERVICE_TOKEN_NEW;
  const { advanced, res } = callTokenMiddleware(`Bearer ${TOKEN}`);
  assert.equal(advanced, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body?.code, "INTERNAL_TOKEN_NOT_CONFIGURED");
});

test("comparison is timing-safe for both tokens: differing lengths never throw", () => {
  process.env.TE_INTERNAL_SERVICE_TOKEN = TOKEN;
  process.env.TE_INTERNAL_SERVICE_TOKEN_NEW = NEW_TOKEN;
  // crypto.timingSafeEqual throws on unequal buffer lengths. Only a comparison
  // that hashes to a fixed width first survives these.
  for (const attempt of ["Bearer a", `Bearer ${"z".repeat(4096)}`, `Bearer ${TOKEN}x`]) {
    const { advanced, res } = callTokenMiddleware(attempt);
    assert.equal(advanced, false);
    assert.equal(res.statusCode, 401);
  }
  const src = readFileSync(
    path.join(serverDir, "middleware", "require-internal-service-token.ts"),
    "utf8",
  );
  assert.match(src, /timingSafeEqual/, "token comparison must use timingSafeEqual");
  assert.equal(
    /raw\s*===|provided\s*===\s*expected/.test(src),
    false,
    "no plain string comparison of the token",
  );
});

// ─── Circuit-breaker admin route stays ADMIN-only ────────────────────────────

test("GET /api/admin/kevin/circuit-breaker is registered behind isAuthenticated + requireKevinAccess", async () => {
  const src = readFileSync(path.join(serverDir, "kevin-routes.ts"), "utf8");
  const idx = src.indexOf('"/api/admin/kevin/circuit-breaker"');
  assert.notEqual(idx, -1, "the documented circuit-breaker route must exist");
  const region = src.slice(idx, idx + 220);
  assert.match(region, /isAuthenticated/);
  assert.match(region, /requireKevinAccess/);

  const breaker = await import("../services/kevin-circuit-breaker");
  const status = breaker.getCircuitStatus();
  assert.ok(["closed", "open", "half_open"].includes(status.state));
});

test("the circuit-breaker route is not reachable through the unauthenticated internal API", () => {
  for (const key of primaryRoutes.keys()) {
    assert.equal(key.includes("circuit-breaker"), false);
  }
});
