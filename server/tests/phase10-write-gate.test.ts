/**
 * The Phase-10 broad write gate used to accept ANY authenticated session for
 * platform-operations writes that carry no role guard of their own:
 *
 *   PATCH /api/developer/submissions/:id   sets approval / publish status
 *   POST  /api/marketplace/verification/:agentId  writes a hard-coded pass
 *                                          review that can reach platform_approved
 *   POST  /api/marketplace/telemetry       creates runtimes for any orgId
 *   POST  /api/marketplace/{benchmarks,ecosystem,reputation}/refresh
 *                                          unbounded recompute
 *
 * The gate now requires ADMIN for those paths, while remaining an
 * authentication floor for writes whose handlers already enforce
 * requireRole("COACH", "ADMIN") themselves.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

// Imported after DATABASE_URL is set: the module graph reaches server/db.ts,
// which throws at import time when the variable is absent.
const {
  phase10Tier,
  phase10WriteGate,
  PHASE10_ADMIN_WRITE_PATHS,
  PHASE10_AUTHENTICATED_WRITE_PATHS,
} = await import("../lib/phase10-write-gate");

const ADMIN_WRITES: Array<[string, string]> = [
  ["PATCH", "/api/developer/submissions/sub_1"],
  ["POST", "/api/marketplace/verification/growth_agent"],
  ["POST", "/api/marketplace/telemetry"],
  ["POST", "/api/marketplace/benchmarks/refresh"],
  ["POST", "/api/marketplace/ecosystem/refresh"],
  ["POST", "/api/marketplace/reputation/refresh"],
  ["POST", "/api/marketplace/runtimes/bootstrap"],
  ["POST", "/api/marketplace/trials/start"],
  ["POST", "/api/developer/validate"],
  ["POST", "/api/beta/participants"],
];

const AUTHENTICATED_WRITES: Array<[string, string]> = [
  ["POST", "/api/workforce/executions"],
  ["POST", "/api/developer/register"],
  ["POST", "/api/developer/submit"],
  ["POST", "/api/marketplace/case-studies"],
  ["POST", "/api/feedback"],
];

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

async function runGate(method: string, path: string, user: any) {
  const gate = phase10WriteGate();
  const res = responseRecorder();
  let passed = false;
  await gate({ method, path, user }, res, () => {
    passed = true;
  });
  return { passed, status: res.statusCode };
}

async function withRole(role: string, fn: () => Promise<void>) {
  const { storage } = await import("../storage");
  const original = storage.getUserProfile;
  storage.getUserProfile = (async (userId: string) => ({
    id: `profile-${userId}`,
    userId,
    organizationId: "org-a",
    role,
  })) as typeof storage.getUserProfile;
  try {
    await fn();
  } finally {
    storage.getUserProfile = original;
  }
}

const session = { claims: { sub: "user-1" } };

test("/api/developer/submissions is classified ADMIN, not swallowed by the /api/developer/submit prefix", () => {
  assert.equal(phase10Tier("PATCH", "/api/developer/submissions/sub_1"), "admin");
  assert.equal(phase10Tier("POST", "/api/developer/submit"), "authenticated");
  // the two lists must stay disjoint in intent
  for (const p of PHASE10_ADMIN_WRITE_PATHS) {
    assert.ok(!PHASE10_AUTHENTICATED_WRITE_PATHS.includes(p), p);
  }
});

test("reads are never gated", () => {
  assert.equal(phase10Tier("GET", "/api/marketplace/telemetry"), "none");
  assert.equal(phase10Tier("GET", "/api/beta/programs"), "none");
});

test("anonymous writes are rejected with 401 on both tiers", async () => {
  for (const [method, path] of [...ADMIN_WRITES, ...AUTHENTICATED_WRITES]) {
    const { passed, status } = await runGate(method, path, undefined);
    assert.equal(passed, false, `${method} ${path}`);
    assert.equal(status, 401, `${method} ${path}`);
  }
});

test("a CLIENT session is rejected with 403 on every platform-operations write", async () => {
  await withRole("CLIENT", async () => {
    for (const [method, path] of ADMIN_WRITES) {
      const { passed, status } = await runGate(method, path, session);
      assert.equal(passed, false, `${method} ${path} admitted a CLIENT`);
      assert.equal(status, 403, `${method} ${path}`);
    }
  });
});

test("a COACH session is rejected with 403 on every platform-operations write", async () => {
  await withRole("COACH", async () => {
    for (const [method, path] of ADMIN_WRITES) {
      const { passed, status } = await runGate(method, path, session);
      assert.equal(passed, false, `${method} ${path} admitted a COACH`);
      assert.equal(status, 403, `${method} ${path}`);
    }
  });
});

test("an ADMIN session passes every platform-operations write", async () => {
  await withRole("ADMIN", async () => {
    for (const [method, path] of ADMIN_WRITES) {
      const { passed, status } = await runGate(method, path, session);
      assert.equal(passed, true, `${method} ${path} denied an ADMIN`);
      assert.equal(status, 200, `${method} ${path}`);
    }
  });
});

test("coach-facing and developer self-service writes keep their authentication-only floor", async () => {
  await withRole("COACH", async () => {
    for (const [method, path] of AUTHENTICATED_WRITES) {
      const { passed } = await runGate(method, path, session);
      assert.equal(passed, true, `${method} ${path} regressed to ADMIN-only`);
    }
  });
});
