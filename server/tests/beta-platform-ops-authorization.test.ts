/**
 * Beta / marketplace-operations surfaces are platform administration, not
 * tenant features. Every one of them used to be registered with NO middleware
 * at all: anonymous callers could list, create, edit and delete rows holding
 * participant names, e-mail addresses, organizations, notes and per-developer
 * balances, with the row ids handed out by the same anonymous GET lists.
 *
 * These tests execute the registered middleware chain (they never run the
 * handler bodies, so no database is touched) and assert the chain denies
 * anonymous and non-ADMIN callers and admits ADMIN.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestHandler } from "express";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

type RegisteredRoute = { method: string; path: string; handlers: RequestHandler[] };

/** Every route this PR moved off the anonymous surface, by module. */
const GATED_ROUTES: Record<string, Array<[string, string]>> = {
  "../beta-wave6-routes": [
    ["get", "/api/developer-pipeline"],
    ["post", "/api/developer-pipeline"],
    ["patch", "/api/developer-pipeline/:id"],
    ["delete", "/api/developer-pipeline/:id"],
    ["get", "/api/marketplace-ambassadors"],
    ["post", "/api/marketplace-ambassadors"],
    ["patch", "/api/marketplace-ambassadors/:id"],
  ],
  "../beta-wave-x-routes": [
    ["get", "/api/validation-participants"],
    ["post", "/api/validation-participants"],
    ["patch", "/api/validation-participants/:id"],
    ["delete", "/api/validation-participants/:id"],
    ["get", "/api/participant-feedback"],
    ["post", "/api/participant-feedback"],
  ],
  "../beta-wave1-routes": [
    ["get", "/api/developer/economics"],
    ["get", "/api/onboarding/developer"],
    ["post", "/api/onboarding/developer"],
    ["patch", "/api/onboarding/developer/:id"],
    ["get", "/api/onboarding/org"],
    ["post", "/api/onboarding/org"],
  ],
  "../beta-wave2-routes": [
    ["get", "/api/marketplace/launch-programs"],
    ["post", "/api/marketplace/launch-programs"],
    ["patch", "/api/marketplace/launch-programs/:id"],
    ["get", "/api/referrals/developer"],
    ["post", "/api/referrals/developer"],
    ["get", "/api/referrals/org"],
    ["post", "/api/referrals/org"],
  ],
  "../beta-wave4-routes": [
    ["get", "/api/campaigns/developer"],
    ["post", "/api/campaigns/developer"],
    ["patch", "/api/campaigns/developer/:id"],
    ["get", "/api/campaigns/org"],
    ["post", "/api/campaigns/org"],
    ["patch", "/api/campaigns/org/:id"],
    ["get", "/api/publisher-rewards"],
    ["post", "/api/publisher-rewards"],
    ["patch", "/api/publisher-rewards/:id/reach"],
  ],
  "../beta-wave5-routes": [
    ["get", "/api/developer-streaks"],
    ["post", "/api/developer-streaks"],
    ["get", "/api/org-streaks"],
    ["post", "/api/org-streaks"],
    ["post", "/api/streaks/sync"],
  ],
  "../beta-phase-y-routes": [
    ["get", "/api/first10-playbooks"],
    ["get", "/api/first10-playbooks/templates"],
    ["post", "/api/first10-playbooks"],
    ["patch", "/api/first10-playbooks/:id"],
  ],
  "../phase10-routes": [
    ["get", "/api/feedback"],
  ],
};

const REGISTER_FN: Record<string, string> = {
  "../beta-wave6-routes": "registerBetaWave6Routes",
  "../beta-wave-x-routes": "registerBetaWaveXRoutes",
  "../beta-wave1-routes": "registerBetaWave1Routes",
  "../beta-wave2-routes": "registerBetaWave2Routes",
  "../beta-wave4-routes": "registerBetaWave4Routes",
  "../beta-wave5-routes": "registerBetaWave5Routes",
  "../beta-phase-y-routes": "registerBetaPhaseYRoutes",
  "../phase10-routes": "registerPhase10Routes",
};

function collectorApp(routes: RegisteredRoute[]) {
  const record = (method: string) =>
    (path: string, ...handlers: RequestHandler[]) => {
      routes.push({ method, path, handlers });
    };
  return {
    get: record("get"),
    post: record("post"),
    patch: record("patch"),
    put: record("put"),
    delete: record("delete"),
    use: () => {},
  };
}

let cached: RegisteredRoute[] | null = null;

async function loadAllRoutes(): Promise<RegisteredRoute[]> {
  if (cached) return cached;
  const routes: RegisteredRoute[] = [];
  const app = collectorApp(routes);
  for (const moduleName of Object.keys(GATED_ROUTES)) {
    const mod: any = await import(moduleName);
    const register = mod[REGISTER_FN[moduleName]];
    assert.equal(typeof register, "function", `${moduleName} exports ${REGISTER_FN[moduleName]}`);
    await register(app as any);
  }
  cached = routes;
  return routes;
}

function find(routes: RegisteredRoute[], method: string, path: string): RegisteredRoute {
  const matches = routes.filter((r) => r.method === method && r.path === path);
  assert.equal(matches.length, 1, `exactly one ${method.toUpperCase()} ${path}`);
  return matches[0];
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

/** Runs the two guards only; the route handler body is never invoked. */
async function runGuards(
  route: RegisteredRoute,
  req: any,
  res: ReturnType<typeof responseRecorder>,
): Promise<boolean> {
  let reachedHandler = false;
  const [authenticate, authorize] = route.handlers;
  await authenticate(req, res as any, async () => {
    await authorize(req, res as any, () => {
      reachedHandler = true;
    });
  });
  return reachedHandler;
}

function baseReq(extra: Record<string, unknown> = {}) {
  return {
    headers: {},
    query: {},
    body: {},
    params: {},
    ...extra,
  };
}

const ALL: Array<[string, string]> = Object.values(GATED_ROUTES).flat();

test("every beta / marketplace-ops route is registered with an auth guard, a role guard and a handler", async () => {
  const routes = await loadAllRoutes();
  for (const [method, path] of ALL) {
    const route = find(routes, method, path);
    assert.equal(route.handlers.length, 3, `${method.toUpperCase()} ${path}`);
  }
});

test("anonymous callers are denied before the handler on every beta / marketplace-ops route", async () => {
  const routes = await loadAllRoutes();
  for (const [method, path] of ALL) {
    const route = find(routes, method, path);
    const res = responseRecorder();
    const reached = await runGuards(
      route,
      baseReq({ user: undefined, isAuthenticated: () => false }),
      res,
    );
    assert.equal(reached, false, `${method.toUpperCase()} ${path} reached handler anonymously`);
    assert.equal(res.statusCode, 401, `${method.toUpperCase()} ${path}`);
  }
});

test("non-admin sessions get 403 and ADMIN sessions reach the handler", async () => {
  const routes = await loadAllRoutes();
  const { storage } = await import("../storage");
  const original = storage.getUserProfile;
  try {
    storage.getUserProfile = (async (userId: string) => ({
      id: `profile-${userId}`,
      userId,
      organizationId: "org-a",
      role: userId === "admin-a" ? "ADMIN" : userId === "coach-b" ? "COACH" : "CLIENT",
    })) as typeof storage.getUserProfile;

    for (const [method, path] of ALL) {
      const route = find(routes, method, path);

      for (const denied of ["coach-b", "client-c"]) {
        const res = responseRecorder();
        const reached = await runGuards(
          route,
          baseReq({
            user: { claims: { sub: denied }, expires_at: Number.MAX_SAFE_INTEGER },
            isAuthenticated: () => true,
          }),
          res,
        );
        assert.equal(reached, false, `${method.toUpperCase()} ${path} admitted ${denied}`);
        assert.equal(res.statusCode, 403, `${method.toUpperCase()} ${path} for ${denied}`);
      }

      const adminRes = responseRecorder();
      const adminReached = await runGuards(
        route,
        baseReq({
          user: { claims: { sub: "admin-a" }, expires_at: Number.MAX_SAFE_INTEGER },
          isAuthenticated: () => true,
        }),
        adminRes,
      );
      assert.equal(adminReached, true, `${method.toUpperCase()} ${path} denied ADMIN`);
      assert.equal(adminRes.statusCode, 200, `${method.toUpperCase()} ${path}`);
    }
  } finally {
    storage.getUserProfile = original;
  }
});
