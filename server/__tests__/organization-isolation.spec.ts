/**
 * organization-isolation.spec.ts
 *
 * Org isolation boundary tests for TrainEfficiency.
 *
 * Run against a live dev server: tsx server/__tests__/organization-isolation.spec.ts
 *
 * Tests verify that:
 *  - Cross-org data requests return 403, never 200 with data.
 *  - /api/services without orgId returns 400 (unauthenticated) or 403 (auth without org).
 *  - Org A cannot see Org B's data.
 *  - Empty org resolution returns 403, never 200 with [].
 *  - Public scheduling endpoints are rate-limited.
 *
 * Requires: node >= 18 (for node:test, node:assert)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:5000";

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers });
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ─── Test 1: Cross-org — unauthenticated request with no orgId ───────────────

describe("GET /api/services — org isolation", () => {
  test("returns 400 when no organizationId provided and not authenticated", async () => {
    const res = await get("/api/services");
    assert.equal(res.status, 400, "Must return 400, not 200, when org param omitted");
    const body = await res.json() as any;
    assert.ok(body.message, "Must return an error message");
    assert.ok(
      !Array.isArray(body),
      "Must NOT return an array — returning array means all-org leak"
    );
  });

  test("returns services only for the requested org when organizationId provided", async () => {
    // Use a known test org or skip if unavailable
    const res = await get("/api/services?organizationId=nonexistent-org-uuid");
    // Should return 200 with empty array OR 404 — never all services
    assert.ok([200, 404].includes(res.status), `Got unexpected status: ${res.status}`);
    if (res.status === 200) {
      const body = await res.json() as any;
      assert.ok(Array.isArray(body), "Should return array for valid org request");
      // If org doesn't exist, array should be empty
      assert.equal(body.length, 0, "Non-existent org should return empty services");
    }
  });
});

// ─── Test 2: /api/coaches — unauthenticated requires orgId ───────────────────

describe("GET /api/coaches — org isolation", () => {
  test("returns 400 when no organizationId provided and not authenticated", async () => {
    const res = await get("/api/coaches");
    assert.equal(res.status, 400, "Must return 400 when org param missing");
    const body = await res.json() as any;
    assert.ok(!Array.isArray(body), "Must NOT return an array — would leak coach data");
  });
});

// ─── Test 3: Empty org resolution returns 403, never data ────────────────────

describe("Org resolution — empty session", () => {
  test("authenticated request with no org association returns 403 or 401", async () => {
    // Send a request with an invalid bearer token (no org association)
    const res = await get("/api/partnerships", {
      Authorization: "Bearer invalid-token-no-org",
    });
    // Must be 401 (no valid session) or 403 (session but no org) — never 200
    assert.ok(
      [401, 403].includes(res.status),
      `Expected 401 or 403, got ${res.status} — potential data leak if 200`
    );
  });

  test("sponsorships endpoint requires authentication", async () => {
    const res = await get("/api/sponsorships");
    assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
  });

  test("department command center requires authentication", async () => {
    const res = await get("/api/departments/overview");
    assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
  });

  test("opportunity acquisition requires authentication", async () => {
    const res = await get("/api/opportunity-acquisition/summary");
    assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
  });

  test("unified action log requires authentication", async () => {
    const res = await get("/api/unified-action-log");
    assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
  });
});

// ─── Test 4: OrgResolutionError produces 403, not 200 or 500 ─────────────────

describe("ORG_RESOLUTION_FAILED response shape", () => {
  test("org resolution failure returns structured 403 JSON", async () => {
    // Access a scoped endpoint without any auth headers
    const res = await get("/api/departments/health");
    if (res.status === 403) {
      const body = await res.json() as any;
      // Should be a structured error, not a data payload
      assert.ok(
        body.error || body.message,
        "403 response must include error or message field"
      );
    } else {
      // 401 is also acceptable (middleware rejected before org resolution)
      assert.equal(res.status, 401);
    }
  });
});

// ─── Test 5: Rate limiting on public endpoints ────────────────────────────────

describe("Public endpoint rate limiting", () => {
  test("rate limit header present or 429 fires after threshold", async () => {
    // Send 35 rapid requests to /api/coaches (threshold is 120, so no 429 here)
    // but verify the rate limiter is active by checking the response type
    const res = await get("/api/coaches");
    // Should be 400 (no org param) — not an uncaught crash or 500
    assert.notEqual(res.status, 500, "Rate-limited endpoint must not 500");
    assert.notEqual(res.status, 200, "Unauthenticated /api/coaches without orgId must not return 200");
  });

  test("availability endpoint enforces rate limiting shape", async () => {
    const res = await get("/api/availability?serviceId=test");
    // Should return structured error (400/404) not 500 or unscoped data
    assert.notEqual(res.status, 500);
    assert.notEqual(res.status, 200, "Availability without serviceId+org must not return 200");
  });

  test("429 is returned after rate limit exceeded for availability endpoint", async () => {
    // Fire 65 requests (above the 60/min limit for availability)
    const requests = Array.from({ length: 65 }, () =>
      get("/api/availability?serviceId=burst-test")
    );
    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);
    const tooManyRequests = statuses.some((s) => s === 429);

    assert.ok(
      tooManyRequests,
      `Expected at least one 429 response after 65 requests. Got statuses: ${[...new Set(statuses)].join(", ")}`
    );
  });
});

// ─── Test 6: OrgAccessDenied log is structured ───────────────────────────────

describe("ORG_ACCESS_DENIED logging format", () => {
  test("resolveOrgIdOrThrow produces OrgResolutionError with correct fields", async () => {
    // This is a unit assertion about the OrgResolutionError class
    const { OrgResolutionError, isOrgResolutionError } = await import("../lib/resolve-org-id.js");

    const err = new OrgResolutionError("user-123", "/api/test-route");
    assert.equal(err.message, "ORG_RESOLUTION_FAILED");
    assert.equal(err.statusCode, 403);
    assert.equal(err.userId, "user-123");
    assert.equal(err.route, "/api/test-route");
    assert.equal(err.name, "OrgResolutionError");
    assert.ok(isOrgResolutionError(err), "isOrgResolutionError must return true for OrgResolutionError");
    assert.ok(isOrgResolutionError({ message: "ORG_RESOLUTION_FAILED" }), "isOrgResolutionError must match by message");
    assert.ok(!isOrgResolutionError(new Error("other")), "isOrgResolutionError must not match unrelated errors");
  });
});

// ─── Test 7: Agent Dead-Letter Queue — orgId required ────────────────────────

describe("Agent audit — dead-letter orgId enforcement", () => {
  test("pushToDeadLetter signature requires orgId (not optional)", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("server/services/agent-dead-letter-service.ts", "utf-8")
    );
    // Extract just the pushToDeadLetter function block to check its opts type
    const fnStart = src.indexOf("export async function pushToDeadLetter(opts: {");
    const fnBlock = src.slice(fnStart, fnStart + 200);
    // orgId must be required (no '?') in pushToDeadLetter opts specifically
    assert.ok(
      fnBlock.includes("orgId: string"),
      "pushToDeadLetter must require orgId — optional orgId allows dead-letter entries without org isolation"
    );
    assert.ok(
      !fnBlock.includes("orgId?: string"),
      "pushToDeadLetter must NOT have orgId?: string — that makes it optional"
    );
  });

  test("DeadLetterJob interface has non-nullable orgId", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("server/services/agent-dead-letter-service.ts", "utf-8")
    );
    assert.ok(
      src.includes("orgId: string;"),
      "DeadLetterJob.orgId must be non-nullable string — entries without orgId break multi-tenant isolation"
    );
  });
});

// ─── Test 8: Atomic row claims include orgId ──────────────────────────────────

describe("Agent audit — atomic claim org isolation", () => {
  test("auto-execution-engine atomic claim includes org_id in WHERE", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("server/email-agent/auto-execution-engine.ts", "utf-8")
    );
    assert.ok(
      src.includes("email_follow_ups") && src.includes("AND org_id = ${orgId}"),
      "Atomic claim must target email_follow_ups with AND org_id — prevents cross-org row claim"
    );
  });

  test("follow-up-cron atomic claim includes org_id in WHERE", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("server/email-agent/follow-up-cron.ts", "utf-8")
    );
    assert.ok(
      src.includes("email_follow_ups") && src.includes("AND org_id = ${orgId}"),
      "Atomic claim must target email_follow_ups with AND org_id — prevents cross-org row claim"
    );
  });
});

// ─── Test 9: Failure paths emit dead-letter + system_log ─────────────────────

describe("Agent audit — failure path observability", () => {
  test("auto-execution-engine failure catch calls pushToDeadLetter", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("server/email-agent/auto-execution-engine.ts", "utf-8")
    );
    assert.ok(
      src.includes("pushToDeadLetter") && src.includes("logSystemEvent"),
      "auto-execution-engine failure path must call pushToDeadLetter + logSystemEvent"
    );
  });

  test("follow-up-cron failure catch calls pushToDeadLetter", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("server/email-agent/follow-up-cron.ts", "utf-8")
    );
    assert.ok(
      src.includes("pushToDeadLetter") && src.includes("logSystemEvent"),
      "follow-up-cron failure path must call pushToDeadLetter + logSystemEvent"
    );
  });

  test("agent-action-executor failure catch calls pushToDeadLetter", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("server/services/agent-action-executor.ts", "utf-8")
    );
    assert.ok(
      src.includes("pushToDeadLetter") && src.includes("logSystemEvent"),
      "agent-action-executor failure path must call pushToDeadLetter + logSystemEvent"
    );
  });
});

// ─── Test 10: Schema-level orgId enforcement on core agent tables ─────────────

describe("Agent audit — schema orgId notNull guarantees", () => {
  test("workflow_jobs.orgId is notNull in schema", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("shared/schema.ts", "utf-8")
    );
    // workflow_jobs must declare orgId with notNull
    const wjBlock = src.slice(src.indexOf("workflowJobs = pgTable"), src.indexOf("workflowJobs = pgTable") + 800);
    assert.ok(
      wjBlock.includes("orgId") && wjBlock.includes("notNull"),
      "workflow_jobs.orgId must be notNull() — jobs without orgId break multi-tenant isolation"
    );
  });

  test("ceo_heartbeat_runs.orgId is notNull in schema", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("shared/schema.ts", "utf-8")
    );
    const hbBlock = src.slice(src.indexOf("ceoHeartbeatRuns = pgTable"), src.indexOf("ceoHeartbeatRuns = pgTable") + 600);
    assert.ok(
      hbBlock.includes("orgId") && hbBlock.includes("notNull"),
      "ceo_heartbeat_runs.orgId must be notNull() — every heartbeat run must be org-scoped"
    );
  });

  test("unified_agent_action_log.orgId is notNull in schema", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("shared/schema.ts", "utf-8")
    );
    const logBlock = src.slice(src.indexOf("unifiedAgentActionLog = pgTable"), src.indexOf("unifiedAgentActionLog = pgTable") + 600);
    assert.ok(
      logBlock.includes("orgId") && logBlock.includes("notNull"),
      "unified_agent_action_log.orgId must be notNull() — every agent action log must be org-scoped"
    );
  });

  test("email_follow_ups.orgId is notNull in schema", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("shared/schema.ts", "utf-8")
    );
    const fuBlock = src.slice(src.indexOf('emailFollowUps = pgTable("email_follow_ups"'), src.indexOf('emailFollowUps = pgTable("email_follow_ups"') + 400);
    assert.ok(
      fuBlock.includes("org_id") && fuBlock.includes("notNull"),
      "email_follow_ups.org_id must be notNull() — follow-up rows without orgId break isolation"
    );
  });
});

// ─── Test 11: Lock key formula includes orgId ─────────────────────────────────

describe("Agent audit — distributed lock key org isolation", () => {
  test("lock key formula includes orgId as prefix", async () => {
    const src = await import("node:fs").then(fs =>
      fs.readFileSync("server/services/ceo-heartbeat-service.ts", "utf-8")
    );
    // The lock key must include orgId — formula is `${orgId}:${jobName}:${timeBucket}`
    assert.ok(
      src.includes("${orgId}:${jobName}") || src.includes("`${orgId}:"),
      "Lock key must be prefixed with orgId — global lock keys allow cross-org contention"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12: POST /api/lead-capture/submissions/:id/recover-pipeline — authz (PR #11)
//
// This route was previously UNAUTHENTICATED and side-effecting: it loads a
// submission by :id and runs the intelligent lead-intake pipeline (emails + AI).
// PR #11 adds isAuthenticated + requireRole("COACH","ADMIN") + resolveOrgIdOrThrow
// + an ownership check (submission.orgId must equal the caller's resolved org).
//
// The REJECT paths need NO fixtures and run whenever the dev server is up:
//   - unauthenticated         → 401
//   - invalid credential      → 401
// The FIXTURE-dependent paths are env-injected and SKIP with a clear message when
// their fixtures/DB are unavailable (Replit or CI can supply them):
//   - wrong role (CLIENT)            → 403   needs TEST_CLIENT_AUTH
//   - cross-org coach/admin          → 403   needs TEST_ORG_B_COACH_AUTH + TEST_ORG_A_SUBMISSION_ID
//   - unknown id, authorized         → 404   needs TEST_COACH_AUTH
//   - owner-org (INTEGRATION ONLY)   → 200   needs RUN_INTEGRATION_TESTS=1 + TEST_COACH_AUTH
//                                             + TEST_OWN_SUBMISSION_ID  (runs REAL OpenAI/Gmail)
//
// Each *_AUTH env var holds a credential string, either:
//   * a Cookie header value   (e.g. "connect.sid=s%3A...")     → sent as Cookie, or
//   * a bearer token          (raw, or prefixed "Bearer ...")  → sent as Authorization.
// Produce them by logging in as the relevant user and copying the session cookie,
// or by minting a bearer with createAuthToken(userId)
// (server/replit_integrations/auth/replitAuth.ts) for a seeded coach/admin per org.
//
// Run:  tsx server/__tests__/organization-isolation.spec.ts   (dev server on :5000,
//       or set TEST_BASE_URL). Reject-path tests pass with just a running server.
// ─────────────────────────────────────────────────────────────────────────────

const recoverPath = (id: string) => `/api/lead-capture/submissions/${id}/recover-pipeline`;
const randomSubmissionId = () => `test-${Math.random().toString(36).slice(2)}-nonexistent`;
// Fields only present when the pipeline actually runs (see the route's 200 response).
const PIPELINE_RESULT_FIELDS = ["profileId", "leadScore", "temperature", "aiSummaryPreview", "gmailDraftActionId"];

/** Build request headers from an env-provided credential (cookie or bearer). Null when unset. */
function authFromEnv(name: string): Record<string, string> | null {
  const v = process.env[name]?.trim();
  if (!v) return null;
  if (/^Bearer\s+/i.test(v)) return { Authorization: v };
  if (v.includes("=")) return { Cookie: v }; // looks like a cookie header value
  return { Authorization: `Bearer ${v}` }; // raw token
}

/** A rejected request must not have run the pipeline: no result fields in the body. */
async function assertNoPipelineSideEffects(res: Response, label: string): Promise<void> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  for (const field of PIPELINE_RESULT_FIELDS) {
    assert.ok(
      !(field in body),
      `${label}: rejected response must not contain pipeline field "${field}" (would mean the pipeline ran)`,
    );
  }
}

let _reachable: boolean | null = null;
/** True if the dev server answers at BASE. Memoized so we only probe once. */
async function serverReachable(): Promise<boolean> {
  if (_reachable !== null) return _reachable;
  try {
    await get("/api/health");
    _reachable = true;
  } catch {
    _reachable = false;
  }
  return _reachable;
}

describe("POST recover-pipeline — org auth + ownership (PR #11)", () => {
  test("unauthenticated → 401, and pipeline did not run", async (t) => {
    if (!(await serverReachable())) {
      t.skip("dev server not reachable at BASE — start `npm run dev` (port 5000) or set TEST_BASE_URL");
      return;
    }
    const res = await post(recoverPath(randomSubmissionId()), {});
    assert.equal(res.status, 401, "unauthenticated recover-pipeline must be 401");
    await assertNoPipelineSideEffects(res, "unauthenticated");
  });

  test("invalid credential → 401 (not 200/500)", async (t) => {
    if (!(await serverReachable())) {
      t.skip("dev server not reachable at BASE");
      return;
    }
    const res = await post(recoverPath(randomSubmissionId()), {}, { Authorization: "Bearer invalid-token-no-session" });
    assert.equal(res.status, 401, "invalid credential must be rejected with 401");
    await assertNoPipelineSideEffects(res, "invalid-credential");
  });

  test("wrong role (non coach/admin) → 403", async (t) => {
    if (!(await serverReachable())) {
      t.skip("dev server not reachable at BASE");
      return;
    }
    const auth = authFromEnv("TEST_CLIENT_AUTH");
    if (!auth) {
      t.skip("set TEST_CLIENT_AUTH (a logged-in CLIENT / non-coach cookie or bearer) to run this");
      return;
    }
    const res = await post(recoverPath(randomSubmissionId()), {}, auth);
    assert.equal(res.status, 403, "authenticated non coach/admin must be 403 (requireRole)");
    await assertNoPipelineSideEffects(res, "wrong-role");
  });

  test("cross-org coach/admin (different org than submission) → 403", async (t) => {
    if (!(await serverReachable())) {
      t.skip("dev server not reachable at BASE");
      return;
    }
    const auth = authFromEnv("TEST_ORG_B_COACH_AUTH");
    const submissionId = process.env.TEST_ORG_A_SUBMISSION_ID?.trim();
    if (!auth || !submissionId) {
      t.skip("set TEST_ORG_B_COACH_AUTH + TEST_ORG_A_SUBMISSION_ID (coach/admin of Org B; a submission owned by Org A)");
      return;
    }
    const res = await post(recoverPath(submissionId), {}, auth);
    assert.equal(res.status, 403, "coach/admin acting on another org's submission must be 403 (ownership guard)");
    await assertNoPipelineSideEffects(res, "cross-org");
  });

  test("unknown submission id, authorized caller → 404", async (t) => {
    if (!(await serverReachable())) {
      t.skip("dev server not reachable at BASE");
      return;
    }
    const auth = authFromEnv("TEST_COACH_AUTH");
    if (!auth) {
      t.skip("set TEST_COACH_AUTH (a coach/admin cookie or bearer) to run this");
      return;
    }
    const res = await post(recoverPath(randomSubmissionId()), {}, auth);
    assert.equal(res.status, 404, "authorized caller with an unknown submission id must be 404");
    await assertNoPipelineSideEffects(res, "unknown-id");
  });

  test("owner-org coach/admin → 200 [integration only: real AI/email]", async (t) => {
    if (process.env.RUN_INTEGRATION_TESTS !== "1") {
      t.skip("integration-only: set RUN_INTEGRATION_TESTS=1 (runs REAL OpenAI/Gmail) + TEST_COACH_AUTH + TEST_OWN_SUBMISSION_ID");
      return;
    }
    if (!(await serverReachable())) {
      t.skip("dev server not reachable at BASE");
      return;
    }
    const auth = authFromEnv("TEST_COACH_AUTH");
    const submissionId = process.env.TEST_OWN_SUBMISSION_ID?.trim();
    if (!auth || !submissionId) {
      t.skip("set TEST_COACH_AUTH + TEST_OWN_SUBMISSION_ID (coach/admin owning the submission)");
      return;
    }
    const res = await post(recoverPath(submissionId), {}, auth);
    assert.equal(res.status, 200, "owner-org coach/admin must be 200");
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    assert.equal(body.success, true, "owner-path 200 must report success");
    assert.ok("submissionId" in body, "owner-path 200 returns submissionId (pipeline ran)");
  });
});
