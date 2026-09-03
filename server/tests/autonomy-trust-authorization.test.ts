import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

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

async function runGuards(req: any): Promise<{ reached: boolean; statusCode: number }> {
  const { autonomyAdminAuth } = await import("../autonomy-trust-routes");
  const res = responseRecorder();
  let reached = false;
  const [authenticate, authorize] = autonomyAdminAuth;
  await authenticate(req, res as any, async () => {
    await authorize(req, res as any, () => {
      reached = true;
    });
  });
  return { reached, statusCode: res.statusCode };
}

test("autonomy authorization denies unauthenticated callers", async () => {
  const result = await runGuards({
    headers: {},
    user: undefined,
    isAuthenticated: () => false,
  });
  assert.deepEqual(result, { reached: false, statusCode: 401 });
});

test("autonomy authorization denies non-admins and admits organization admins", async () => {
  const { storage } = await import("../storage");
  const original = storage.getUserProfile;
  try {
    storage.getUserProfile = (async (userId: string) => ({
      id: `profile-${userId}`,
      userId,
      organizationId: userId === "admin-a" ? "org-a" : "org-b",
      role: userId === "admin-a" ? "ADMIN" : "COACH",
    })) as typeof storage.getUserProfile;

    const coach = await runGuards({
      headers: {},
      user: { claims: { sub: "coach-b" }, expires_at: Number.MAX_SAFE_INTEGER },
      isAuthenticated: () => true,
    });
    assert.deepEqual(coach, { reached: false, statusCode: 403 });

    const admin = await runGuards({
      headers: { "x-organization-id": "org-b" },
      user: { claims: { sub: "admin-a" }, expires_at: Number.MAX_SAFE_INTEGER },
      isAuthenticated: () => true,
      query: { orgId: "org-b", organizationId: "org-b" },
      body: { orgId: "org-b", organizationId: "org-b" },
      params: { orgId: "org-b", organizationId: "org-b" },
    });
    assert.deepEqual(admin, { reached: true, statusCode: 200 });
  } finally {
    storage.getUserProfile = original;
  }
});

test("all autonomy routes use ADMIN authorization and trusted tenant resolution", async () => {
  const source = await readFile(new URL("../autonomy-trust-routes.ts", import.meta.url), "utf8");
  const registrations = source.match(/app\.(?:get|post|patch)\([^\n]+/g) ?? [];

  assert.equal(registrations.length, 15);
  for (const registration of registrations) {
    assert.match(registration, /\.\.\.autonomyAdminAuth/);
  }
  assert.equal((source.match(/resolveOrgIdOrThrow\(req\)/g) ?? []).length, 15);
  assert.equal((source.match(/handleOrgError\(e, res\)/g) ?? []).length, 15);
  assert.equal(/getAdminOrgId|user\?\.(?:organizationId|orgId)/.test(source), false);
  assert.equal(/req\.(?:query|body|params).*org(?:anization)?Id/.test(source), false);
});

test("execution-affecting routes require the same explicit ADMIN authority", async () => {
  const source = await readFile(new URL("../autonomy-trust-routes.ts", import.meta.url), "utf8");
  for (const path of [
    "/api/autonomy-trust/registry/:decisionType",
    "/api/autonomy-trust/queue/:id/approve",
    "/api/autonomy-trust/queue/:id/execute",
    "/api/autonomy-trust/queue/bulk-approve",
    "/api/autonomy-trust/pause-all",
  ]) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`app\\.(?:get|post|patch)\\("${escaped}", \\.\\.\\.autonomyAdminAuth`));
  }
});

test("queue path IDs cannot drive cross-tenant follow-up writes", async () => {
  const source = await readFile(new URL("../services/autonomy-scoring-service.ts", import.meta.url), "utf8");
  const scopedQueueReads = source.match(
    /SELECT \* FROM autonomous_action_queue\s+WHERE id = \$\{actionId\} AND org_id = \$\{orgId\}/g,
  ) ?? [];

  assert.equal(scopedQueueReads.length, 3);
  assert.match(source, /WHERE id = \$\{actionId\} AND org_id = \$\{orgId\} AND status = 'pending'/);
  assert.match(source, /WHERE org_id = \$\{orgId\} AND status = 'pending'/);
});

test("pause-all remains organization-local rather than platform-global", async () => {
  const source = await readFile(new URL("../autonomy-trust-routes.ts", import.meta.url), "utf8");
  assert.match(source, /WHERE org_id = \$\{orgId\} AND recommended_mode = 'execute'/);
});
