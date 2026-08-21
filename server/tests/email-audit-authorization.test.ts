import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestHandler } from "express";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

type RegisteredRoute = { path: string; handlers: RequestHandler[] };

async function loadRoutes() {
  const [{ registerEmailAuditRoutes }, { storage }] = await Promise.all([
    import("../email-audit-routes"),
    import("../storage"),
  ]);
  const routes: RegisteredRoute[] = [];
  const app = {
    get(path: string, ...handlers: RequestHandler[]) {
      routes.push({ path, handlers });
    },
  };
  registerEmailAuditRoutes(app as any);
  return { routes, storage };
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

test("all email-audit routes use authentication, ADMIN authorization, and a final handler", async () => {
  const { routes } = await loadRoutes();
  assert.deepEqual(routes.map((route) => route.path), [
    "/api/email-audit",
    "/api/email-audit/stats",
    "/api/email-audit/blocked",
  ]);
  for (const route of routes) assert.equal(route.handlers.length, 3, route.path);
});

test("unauthenticated users are denied before the route handler", async () => {
  const { routes } = await loadRoutes();
  for (const route of routes) {
    const res = responseRecorder();
    const reached = await runGuards(route, {
      headers: {},
      user: undefined,
      isAuthenticated: () => false,
    }, res);
    assert.equal(reached, false, route.path);
    assert.equal(res.statusCode, 401, route.path);
  }
});

test("authenticated non-admin users are denied and admins reach the own-org handler", async () => {
  const { routes, storage } = await loadRoutes();
  const original = storage.getUserProfile;
  try {
    storage.getUserProfile = (async (userId: string) => ({
      id: `profile-${userId}`,
      userId,
      organizationId: userId === "admin-a" ? "org-a" : "org-b",
      role: userId === "admin-a" ? "ADMIN" : "COACH",
    })) as typeof storage.getUserProfile;

    for (const route of routes) {
      const coachRes = responseRecorder();
      const coachReached = await runGuards(route, {
        headers: {},
        user: { claims: { sub: "coach-b" }, expires_at: Number.MAX_SAFE_INTEGER },
        isAuthenticated: () => true,
      }, coachRes);
      assert.equal(coachReached, false, route.path);
      assert.equal(coachRes.statusCode, 403, route.path);

      const adminRes = responseRecorder();
      const adminReached = await runGuards(route, {
        headers: {},
        user: { claims: { sub: "admin-a" }, expires_at: Number.MAX_SAFE_INTEGER },
        isAuthenticated: () => true,
        query: { orgId: "org-b", organizationId: "org-b" },
        body: { orgId: "org-b", organizationId: "org-b" },
        params: { orgId: "org-b", organizationId: "org-b" },
      }, adminRes);
      assert.equal(adminReached, true, route.path);
      assert.equal(adminRes.statusCode, 200, route.path);
    }
  } finally {
    storage.getUserProfile = original;
  }
});

test("email-audit handlers derive organization scope only from the trusted resolver", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../email-audit-routes.ts", import.meta.url), "utf8");

  assert.equal((source.match(/resolveOrgIdOrThrow\(req\)/g) ?? []).length, 3);
  assert.equal(/req\.(query|body|params).*org(anization)?Id/.test(source), false);
  assert.equal(/user\?\.(organizationId|orgId)/.test(source), false);
  assert.equal(/function requireAdmin/.test(source), false);
});
