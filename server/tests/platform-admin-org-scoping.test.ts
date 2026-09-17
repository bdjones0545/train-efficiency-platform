/**
 * Platform-admin vs organization-admin scoping.
 *
 * `requireRole("ADMIN")` is a per-organization role (POST /api/organizations/register
 * hands it to any registrant). These tests execute the real middleware and route
 * handlers with a fake app, stubbed storage and an injected org resolver to prove:
 *
 *   1. adminRepairAuth (platform-wide Stripe/balance repair) admits the shared
 *      ADMIN_REPAIR_KEY and ADMINs of the platform org only; an ADMIN of any other
 *      org is 403.
 *   2. /api/admin/coaches/:id (PATCH, DELETE, PATCH /payout) resolve the caller's
 *      org and reach storage only through the org-scoped methods; an org-B ADMIN
 *      targeting an org-A coach gets 404 and no write happens.
 *   3. POST /api/admin/coaches cannot re-home a user who belongs to another org.
 *   4. /api/coach/payout-redemptions: a COACH sees only their own coach profile's
 *      redemptions; an ADMIN sees the whole org.
 *   5. /api/admin/accounting-integrity puts `organization_id = ${orgId}` in every
 *      query and has no platform-wide fallback (source inspection, routes.ts).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { RequestHandler } from "express";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

type RegisteredRoute = { method: string; path: string; handlers: RequestHandler[] };

function responseRecorder() {
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

/** Run a full middleware chain (guards + final handler), awaiting the final handler. */
async function runChain(handlers: RequestHandler[], req: any, res: ReturnType<typeof responseRecorder>) {
  let reachedHandler = false;
  let index = 0;
  let finalPromise: Promise<unknown> | undefined;
  const next = async () => {
    const handler = handlers[index++];
    if (!handler) return;
    if (index === handlers.length) {
      reachedHandler = true;
      finalPromise = Promise.resolve((handler as any)(req, res, next));
      await finalPromise;
      return;
    }
    await (handler as any)(req, res, next);
  };
  await next();
  if (finalPromise) await finalPromise;
  return reachedHandler;
}

function sessionFor(userId: string, extra: Record<string, unknown> = {}) {
  return {
    headers: {},
    user: { claims: { sub: userId }, expires_at: Number.MAX_SAFE_INTEGER },
    isAuthenticated: () => true,
    params: {},
    body: {},
    query: {},
    path: "/test",
    ...extra,
  };
}

const PROFILES: Record<string, { organizationId: string; role: string }> = {
  "admin-platform": { organizationId: "org-est", role: "ADMIN" },
  "admin-a": { organizationId: "org-a", role: "ADMIN" },
  "admin-b": { organizationId: "org-b", role: "ADMIN" },
  "coach-platform": { organizationId: "org-est", role: "COACH" },
  "coach-a1": { organizationId: "org-a", role: "COACH" },
};

async function withProfiles<T>(fn: () => Promise<T>): Promise<T> {
  const { storage } = await import("../storage");
  const original = storage.getUserProfile;
  storage.getUserProfile = (async (userId: string) => {
    const p = PROFILES[userId];
    if (!p) return undefined;
    return { id: `profile-${userId}`, userId, ...p };
  }) as typeof storage.getUserProfile;
  try {
    return await fn();
  } finally {
    storage.getUserProfile = original;
  }
}

// ─── 1. adminRepairAuth ───────────────────────────────────────────────────────

async function runRepairAuth(req: any) {
  const { adminRepairAuth } = await import("../lib/platform-admin-auth");
  const res = responseRecorder();
  let reached = false;
  await adminRepairAuth(req, res, () => {
    reached = true;
  });
  return { reached, statusCode: res.statusCode, payload: res.payload };
}

test("adminRepairAuth: unauthenticated caller without the shared key is 401", async () => {
  delete process.env.ADMIN_REPAIR_KEY;
  const result = await runRepairAuth({ headers: {}, user: undefined, isAuthenticated: () => false });
  assert.equal(result.reached, false);
  assert.equal(result.statusCode, 401);
});

test("adminRepairAuth: an ADMIN of a non-platform org is 403 without the shared key", async () => {
  delete process.env.ADMIN_REPAIR_KEY;
  await withProfiles(async () => {
    const result = await runRepairAuth(sessionFor("admin-b"));
    assert.equal(result.reached, false, "org-B ADMIN must not reach a platform-wide repair handler");
    assert.equal(result.statusCode, 403);
  });
});

test("adminRepairAuth: a non-ADMIN inside the platform org is still 403", async () => {
  delete process.env.ADMIN_REPAIR_KEY;
  await withProfiles(async () => {
    const result = await runRepairAuth(sessionFor("coach-platform"));
    assert.equal(result.reached, false);
    assert.equal(result.statusCode, 403);
  });
});

test("adminRepairAuth: an ADMIN of the platform org passes", async () => {
  delete process.env.ADMIN_REPAIR_KEY;
  await withProfiles(async () => {
    const result = await runRepairAuth(sessionFor("admin-platform"));
    assert.equal(result.reached, true);
    assert.equal(result.statusCode, 200);
  });
});

test("adminRepairAuth: the shared ADMIN_REPAIR_KEY passes without a session, a wrong key does not", async () => {
  process.env.ADMIN_REPAIR_KEY = "repair-secret-for-test";
  try {
    const ok = await runRepairAuth({ headers: { "x-admin-key": "repair-secret-for-test" }, user: undefined, isAuthenticated: () => false });
    assert.equal(ok.reached, true);
    const wrong = await runRepairAuth({ headers: { "x-admin-key": "nope" }, user: undefined, isAuthenticated: () => false });
    assert.equal(wrong.reached, false);
    assert.equal(wrong.statusCode, 401);
  } finally {
    delete process.env.ADMIN_REPAIR_KEY;
  }
});

test("requirePlatformAdminOrg keys on the platform org id, not the ADMIN role", async () => {
  const { requirePlatformAdminOrg, PLATFORM_ADMIN_ORG_ID, isPlatformAdminOrgId } = await import("../lib/platform-admin-auth");
  assert.equal(PLATFORM_ADMIN_ORG_ID, "org-est");
  assert.equal(isPlatformAdminOrgId("org-est"), true);
  assert.equal(isPlatformAdminOrgId("org-a"), false);
  assert.equal(isPlatformAdminOrgId(null), false);
  await withProfiles(async () => {
    for (const [userId, expectPass] of [["admin-a", false], ["admin-platform", true], ["coach-platform", true]] as const) {
      const res = responseRecorder();
      let reached = false;
      await requirePlatformAdminOrg(sessionFor(userId), res, () => {
        reached = true;
      });
      assert.equal(reached, expectPass, userId);
      assert.equal(res.statusCode, expectPass ? 200 : 403, userId);
    }
  });
});

test("every adminRepairAuth route in routes.ts uses the shared platform guard (no local copy)", async () => {
  const source = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ requirePlatformAdminOrg, adminRepairAuth \} from "\.\/lib\/platform-admin-auth";/);
  assert.equal(/function adminRepairAuth\(/.test(source), false, "routes.ts must not define its own adminRepairAuth");
  assert.equal(/function requirePlatformAdminOrg\(/.test(source), false, "routes.ts must not define its own requirePlatformAdminOrg");
  const guarded = source.match(/app\.(?:get|post)\("\/api\/admin\/[^"]+", adminRepairAuth,/g) ?? [];
  assert.equal(guarded.length, 8, "the eight platform-wide billing routes keep the adminRepairAuth guard");
  assert.match(source, /app\.use\("\/api\/customer-success", requirePlatformAdminOrg\);/);
});

// ─── 2/3/4. Coach admin routes ────────────────────────────────────────────────

const COACHES: Record<string, { id: string; organizationId: string; userId: string; user: { email: string } }> = {
  "coach-a": { id: "coach-a", organizationId: "org-a", userId: "coach-a1", user: { email: "a1@org-a.test" } },
  "coach-a2": { id: "coach-a2", organizationId: "org-a", userId: "coach-a2", user: { email: "a2@org-a.test" } },
  "coach-b": { id: "coach-b", organizationId: "org-b", userId: "coach-b1", user: { email: "b1@org-b.test" } },
};

type Calls = { unscoped: string[]; scoped: Array<{ method: string; id: string; orgId: string }> };

async function loadCoachRoutes(resolveOrgId: (req: any) => Promise<string>) {
  const [{ registerAdminCoachRoutes }, { storage }] = await Promise.all([
    import("../admin-coach-routes"),
    import("../storage"),
  ]);
  const routes: RegisteredRoute[] = [];
  const app: any = {};
  for (const method of ["get", "post", "patch", "delete", "put"]) {
    app[method] = (path: string, ...handlers: RequestHandler[]) => {
      routes.push({ method, path, handlers });
    };
  }
  registerAdminCoachRoutes(app, { getOrgBranding: async () => undefined, resolveOrgId });
  return { routes, storage };
}

function route(routes: RegisteredRoute[], method: string, path: string) {
  const found = routes.find((r) => r.method === method && r.path === path);
  assert.ok(found, `${method.toUpperCase()} ${path} registered`);
  return found;
}

async function withCoachStorage<T>(fn: (calls: Calls) => Promise<T>): Promise<T> {
  const { storage } = await import("../storage");
  const calls: Calls = { unscoped: [], scoped: [] };
  const originals = {
    updateCoachProfile: storage.updateCoachProfile,
    deleteCoachProfile: storage.deleteCoachProfile,
    updateCoachProfileForOrganization: storage.updateCoachProfileForOrganization,
    deleteCoachProfileForOrganization: storage.deleteCoachProfileForOrganization,
    getCoachProfilesByOrganization: storage.getCoachProfilesByOrganization,
    getCoachProfileByUserId: storage.getCoachProfileByUserId,
    getRedemptionsByOrganization: storage.getRedemptionsByOrganization,
    getUserByEmail: storage.getUserByEmail,
    upsertUserProfile: storage.upsertUserProfile,
    createCoachProfile: storage.createCoachProfile,
  };
  storage.updateCoachProfile = (async (id: string) => {
    calls.unscoped.push(`updateCoachProfile:${id}`);
    return COACHES[id] as any;
  }) as any;
  storage.deleteCoachProfile = (async (id: string) => {
    calls.unscoped.push(`deleteCoachProfile:${id}`);
    return true;
  }) as any;
  storage.updateCoachProfileForOrganization = (async (id: string, orgId: string, data: any) => {
    calls.scoped.push({ method: "update", id, orgId });
    const coach = COACHES[id];
    if (!coach || coach.organizationId !== orgId) return undefined;
    return { ...coach, ...data } as any;
  }) as any;
  storage.deleteCoachProfileForOrganization = (async (id: string, orgId: string) => {
    calls.scoped.push({ method: "delete", id, orgId });
    const coach = COACHES[id];
    return !!coach && coach.organizationId === orgId;
  }) as any;
  storage.getCoachProfilesByOrganization = (async (orgId: string) =>
    Object.values(COACHES).filter((c) => c.organizationId === orgId) as any) as any;
  storage.getCoachProfileByUserId = (async (userId: string) =>
    Object.values(COACHES).find((c) => c.userId === userId) as any) as any;
  storage.getRedemptionsByOrganization = (async (orgId: string) =>
    [
      { id: "r-a1", coachId: "coach-a", amountCents: 5000, redeemedAt: new Date(0), payoutStatus: "PENDING" },
      { id: "r-a2", coachId: "coach-a2", amountCents: 7000, redeemedAt: new Date(0), payoutStatus: "PENDING" },
      { id: "r-b1", coachId: "coach-b", amountCents: 9000, redeemedAt: new Date(0), payoutStatus: "PENDING" },
    ].filter((r) => COACHES[r.coachId].organizationId === orgId) as any) as any;
  storage.getUserByEmail = (async (email: string) =>
    email === "a1@org-a.test" ? ({ id: "client-a1", email } as any) : undefined) as any;
  storage.upsertUserProfile = (async (profile: any) => {
    calls.unscoped.push(`upsertUserProfile:${profile.userId}:${profile.organizationId}`);
    return profile;
  }) as any;
  storage.createCoachProfile = (async (profile: any) => {
    calls.unscoped.push(`createCoachProfile:${profile.userId}:${profile.organizationId}`);
    return { id: "new-coach", ...profile };
  }) as any;
  try {
    return await fn(calls);
  } finally {
    Object.assign(storage, originals);
  }
}

const resolveFromProfile = async (req: any) => {
  const userId = req.user?.claims?.sub ?? req.user?.id;
  const orgId = PROFILES[userId]?.organizationId;
  if (!orgId) {
    const { OrgResolutionError } = await import("../lib/resolve-org-id");
    throw new OrgResolutionError(userId ?? null, req.path);
  }
  return orgId;
};

test("coach admin routes are registered with authentication + ADMIN role + handler", async () => {
  const { routes } = await loadCoachRoutes(resolveFromProfile);
  assert.deepEqual(
    routes.map((r) => `${r.method.toUpperCase()} ${r.path}`),
    [
      "POST /api/admin/coaches",
      "PATCH /api/admin/coaches/:id",
      "DELETE /api/admin/coaches/:id",
      "PATCH /api/admin/coaches/:id/payout",
      "GET /api/coach/payout-redemptions",
    ],
  );
  for (const r of routes) assert.equal(r.handlers.length, 3, r.path);
});

test("an org-B ADMIN cannot update, delete or re-price an org-A coach (404, no write)", async () => {
  const { routes } = await loadCoachRoutes(resolveFromProfile);
  await withProfiles(() => withCoachStorage(async (calls) => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["patch", "/api/admin/coaches/:id", { bio: "hijacked", isActive: false }],
      ["delete", "/api/admin/coaches/:id", {}],
      ["patch", "/api/admin/coaches/:id/payout", { payoutPercentage: 100 }],
    ];
    for (const [method, path, body] of cases) {
      const res = responseRecorder();
      const reached = await runChain(
        route(routes, method, path).handlers,
        sessionFor("admin-b", { params: { id: "coach-a" }, body }),
        res,
      );
      assert.equal(reached, true, `${method} ${path}: guards admit an ADMIN`);
      assert.equal(res.statusCode, 404, `${method} ${path}: cross-org coach id must be Not Found`);
    }
    assert.deepEqual(calls.unscoped, [], "no id-only storage write may be issued");
    assert.deepEqual(calls.scoped, [
      { method: "update", id: "coach-a", orgId: "org-b" },
      { method: "delete", id: "coach-a", orgId: "org-b" },
      { method: "update", id: "coach-a", orgId: "org-b" },
    ], "every write carries the caller's resolved org, never one from the request");
  }));
});

test("an org-A ADMIN can update, delete and re-price an org-A coach", async () => {
  const { routes } = await loadCoachRoutes(resolveFromProfile);
  await withProfiles(() => withCoachStorage(async (calls) => {
    const patchRes = responseRecorder();
    await runChain(route(routes, "patch", "/api/admin/coaches/:id").handlers,
      sessionFor("admin-a", { params: { id: "coach-a" }, body: { bio: "updated", payoutPercentage: "60" } }), patchRes);
    assert.equal(patchRes.statusCode, 200);
    assert.equal(patchRes.payload.bio, "updated");
    assert.equal(patchRes.payload.payoutPercentage, 60);

    const payoutRes = responseRecorder();
    await runChain(route(routes, "patch", "/api/admin/coaches/:id/payout").handlers,
      sessionFor("admin-a", { params: { id: "coach-a" }, body: { payoutPercentage: 45 } }), payoutRes);
    assert.equal(payoutRes.statusCode, 200);
    assert.equal(payoutRes.payload.payoutPercentage, 45);

    const deleteRes = responseRecorder();
    await runChain(route(routes, "delete", "/api/admin/coaches/:id").handlers,
      sessionFor("admin-a", { params: { id: "coach-a" } }), deleteRes);
    assert.equal(deleteRes.statusCode, 200);
    assert.deepEqual(deleteRes.payload, { success: true });

    assert.deepEqual(calls.unscoped, []);
    assert.ok(calls.scoped.every((c) => c.orgId === "org-a"));
  }));
});

test("coach admin writes are 403 when the caller's org cannot be resolved (no fallback)", async () => {
  const { routes } = await loadCoachRoutes(resolveFromProfile);
  PROFILES["admin-orphan"] = { organizationId: "", role: "ADMIN" };
  try {
    await withProfiles(() => withCoachStorage(async (calls) => {
      const res = responseRecorder();
      await runChain(route(routes, "delete", "/api/admin/coaches/:id").handlers,
        sessionFor("admin-orphan", { params: { id: "coach-a" } }), res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.payload.error, "ORG_RESOLUTION_FAILED");
      assert.deepEqual(calls.scoped, []);
      assert.deepEqual(calls.unscoped, []);
    }));
  } finally {
    delete PROFILES["admin-orphan"];
  }
});

test("POST /api/admin/coaches cannot re-home a user who belongs to another organization", async () => {
  const { routes } = await loadCoachRoutes(resolveFromProfile);
  PROFILES["client-a1"] = { organizationId: "org-a", role: "CLIENT" };
  try {
    await withProfiles(() => withCoachStorage(async (calls) => {
      const res = responseRecorder();
      await runChain(route(routes, "post", "/api/admin/coaches").handlers,
        sessionFor("admin-b", { body: { firstName: "A", lastName: "One", email: "a1@org-a.test", password: "secret123" } }), res);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(calls.unscoped, [], "no profile upsert or coach insert for a foreign-org user");
    }));
  } finally {
    delete PROFILES["client-a1"];
  }
});

test("payout-redemptions: a COACH sees only their own redemptions, an ADMIN sees the org", async () => {
  const { routes } = await loadCoachRoutes(resolveFromProfile);
  await withProfiles(() => withCoachStorage(async () => {
    const handlers = route(routes, "get", "/api/coach/payout-redemptions").handlers;

    const coachRes = responseRecorder();
    await runChain(handlers, sessionFor("coach-a1"), coachRes);
    assert.equal(coachRes.statusCode, 200);
    assert.deepEqual(coachRes.payload.map((r: any) => r.id), ["r-a1"]);
    assert.deepEqual(coachRes.payload.map((r: any) => r.coachEmail), ["a1@org-a.test"]);

    const adminRes = responseRecorder();
    await runChain(handlers, sessionFor("admin-a"), adminRes);
    assert.equal(adminRes.statusCode, 200);
    assert.deepEqual(adminRes.payload.map((r: any) => r.id).sort(), ["r-a1", "r-a2"]);
    assert.ok(adminRes.payload.every((r: any) => r.coachId !== "coach-b"), "no other org's redemptions");
  }));
});

// ─── 5. accounting-integrity (source inspection: handler still lives in routes.ts) ──

test("accounting-integrity scopes every query to the resolved org with no platform-wide fallback", async () => {
  const source = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/admin/accounting-integrity"');
  assert.ok(start > 0);
  const end = source.indexOf('app.get("/api/admin/revenue-integrity"', start);
  const handler = source.slice(start, end);

  assert.match(handler, /const orgId = await resolveOrgIdOrThrow\(req\);/);
  assert.equal(/profile\?\.organizationId \|\| null/.test(handler), false, "org must not come from a nullable profile lookup");
  assert.equal(/orgId \?/.test(handler), false, "no conditional (platform-wide) SQL branches");
  assert.equal(/if \(orgId\)/.test(handler), false, "no org-conditional report sections");
  const scopedQueries = handler.match(/organization_id = \$\{orgId\}/g) ?? [];
  assert.equal(scopedQueries.length, 6, "all six integrity queries carry organization_id = ${orgId}");
  assert.match(handler, /if \(handleOrgError\(error, res\)\) return;/);
});
