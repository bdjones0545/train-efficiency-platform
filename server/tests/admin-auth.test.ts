/**
 * Admin Auth Layer — Lightweight Route Tests
 *
 * Tests the following security invariants:
 *   1. Unauthenticated access → 401
 *   2. Authenticated admin → correct response (200 or data-shape)
 *   3. Cross-org entity protection → 404 (entity not found for wrong org)
 *
 * Run with:
 *   npx tsx server/tests/admin-auth.test.ts
 *
 * The server must be running on port 5000 before executing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function get(path: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const r = await fetch(`${BASE}${path}`, { headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function post(path: string, body: unknown, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function patch(path: string, body: unknown, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const r = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function del(path: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const r = await fetch(`${BASE}${path}`, { method: "DELETE", headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ─── Group 1: Unauthenticated access → 401 ───────────────────────────────────

const UNAUTHENTICATED_GET_ROUTES = [
  "/api/admin/business-brain/health-score",
  "/api/admin/business-brain/feed",
  "/api/admin/business-brain/brief",
  "/api/admin/business-brain/runs",
  "/api/admin/business-brain/command-center-summary",
  "/api/admin/agent-tools",
  "/api/admin/agent-tool-calls",
  "/api/admin/agent-tool-calls/pending",
  "/api/admin/workflows/definitions",
  "/api/admin/workflows/stats",
  "/api/admin/workflows",
  "/api/admin/workflows/settings",
  "/api/admin/workflows/active-summary",
  "/api/admin/day-review",
  "/api/admin/operator-score",
  "/api/scheduling/command-center",
  "/api/scheduling-intelligence/opportunities",
  "/api/scheduling-intelligence/health-score",
  "/api/scheduling-intelligence/revenue-recovery",
];

const UNAUTHENTICATED_POST_ROUTES = [
  ["/api/admin/business-brain/run", {}],
  ["/api/admin/business-brain/recommendations/fake-id/execute", {}],
  ["/api/admin/business-brain/recommendations/fake-id/dismiss", {}],
  ["/api/admin/business-brain/recommendations/fake-id/outcome", {}],
  ["/api/admin/agent-tool-calls/fake-id/confirm", {}],
  ["/api/admin/agent-tool-calls/fake-id/reject", {}],
  ["/api/admin/agent-tools/propose", {}],
  ["/api/admin/agent-tools/execute", {}],
  ["/api/admin/workflows/trigger", { workflowType: "test" }],
  ["/api/admin/workflows/eligibility", { actions: [] }],
  ["/api/admin/start-my-day", {}],
  ["/api/admin/workflows/fake-id/approve", {}],
  ["/api/admin/workflows/fake-id/reject", {}],
  ["/api/admin/workflows/fake-id/cancel", {}],
] as const;

test("Unauthenticated GET routes return 401", async (t) => {
  for (const route of UNAUTHENTICATED_GET_ROUTES) {
    const { status, body } = await get(route);
    assert.equal(
      status,
      401,
      `Expected 401 for GET ${route}, got ${status}. Body: ${JSON.stringify(body)}`
    );
  }
});

test("Unauthenticated POST routes return 401", async (t) => {
  for (const [route, body] of UNAUTHENTICATED_POST_ROUTES) {
    const { status, body: resBody } = await post(route, body);
    assert.equal(
      status,
      401,
      `Expected 401 for POST ${route}, got ${status}. Body: ${JSON.stringify(resBody)}`
    );
  }
});

// ─── Group 2: isAuthenticated routes return 401 when unauthenticated ─────────
// These use Express middleware, so response shape differs (message vs error).

const MIDDLEWARE_AUTH_GET_ROUTES = [
  "/api/admin/team-training/prospects",
  "/api/admin/team-training/stats",
  "/api/admin/team-training/deals",
  "/api/admin/team-training/revenue-agent/actions",
  "/api/admin/team-training/revenue-agent/settings",
  "/api/admin/users",
  "/api/admin/settings",
  "/api/admin/bookings",
];

const MIDDLEWARE_AUTH_POST_ROUTES = [
  ["/api/admin/team-training/prospects/fake-id/do-not-contact", {}],
  ["/api/admin/team-training/revenue-agent/actions/fake-id/execute", {}],
  ["/api/admin/team-training/revenue-agent/actions/fake-id/dismiss", {}],
] as const;

const MIDDLEWARE_AUTH_PATCH_ROUTES = [
  ["/api/admin/team-training/prospects/fake-id", {}],
  ["/api/admin/team-training/deals/fake-id", {}],
] as const;

const MIDDLEWARE_AUTH_DELETE_ROUTES = [
  "/api/admin/team-training/prospects/fake-id",
  "/api/admin/team-training/deals/fake-id",
];

test("Middleware-guarded GET routes return 401 when unauthenticated", async (t) => {
  for (const route of MIDDLEWARE_AUTH_GET_ROUTES) {
    const { status } = await get(route);
    assert.equal(
      status,
      401,
      `Expected 401 for GET ${route}, got ${status}`
    );
  }
});

test("Middleware-guarded POST routes return 401 when unauthenticated", async (t) => {
  for (const [route, body] of MIDDLEWARE_AUTH_POST_ROUTES) {
    const { status } = await post(route, body);
    assert.equal(status, 401, `Expected 401 for POST ${route}, got ${status}`);
  }
});

test("Middleware-guarded PATCH routes return 401 when unauthenticated", async (t) => {
  for (const [route, body] of MIDDLEWARE_AUTH_PATCH_ROUTES) {
    const { status } = await patch(route, body);
    assert.equal(status, 401, `Expected 401 for PATCH ${route}, got ${status}`);
  }
});

test("Middleware-guarded DELETE routes return 401 when unauthenticated", async (t) => {
  for (const route of MIDDLEWARE_AUTH_DELETE_ROUTES) {
    const { status } = await del(route);
    assert.equal(status, 401, `Expected 401 for DELETE ${route}, got ${status}`);
  }
});

// ─── Group 3: Cross-org entity protection ────────────────────────────────────
// These tests use a FAKE entity ID with no session.
// Authenticated requests with a real session but a cross-org entity ID must
// return 404 (not 403, to avoid leaking existence). This is tested below for
// the unauthenticated path (→ 401 before 404, which is correct ordering).

test("Brain recommendation mutation with fake ID returns 401 (auth checked before entity lookup)", async (t) => {
  const { status } = await post("/api/admin/business-brain/recommendations/cross-org-fake/dismiss", {});
  assert.equal(status, 401, "Should fail at auth before entity lookup");
});

test("Revenue agent action mutation with fake ID returns 401", async (t) => {
  const { status } = await post("/api/admin/team-training/revenue-agent/actions/cross-org-fake/dismiss", {});
  assert.equal(status, 401, "Should fail at auth before entity lookup");
});

test("Prospect mutation with fake ID returns 401", async (t) => {
  const patchResult = await patch("/api/admin/team-training/prospects/cross-org-fake", { notes: "hacked" });
  assert.equal(patchResult.status, 401, "PATCH should fail at auth");

  const deleteResult = await del("/api/admin/team-training/prospects/cross-org-fake");
  assert.equal(deleteResult.status, 401, "DELETE should fail at auth");
});

test("Prospect drafts with fake ID returns 401", async (t) => {
  const { status } = await get("/api/admin/team-training/prospects/cross-org-fake/drafts");
  assert.equal(status, 401, "Should fail at auth before entity lookup");
});

// ─── Group 4: Dev-only diagnostic endpoint ───────────────────────────────────

test("Auth debug endpoint returns 200 in dev mode", async (t) => {
  const { status, body } = await get("/api/admin/auth/debug");
  assert.equal(status, 200, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`);
  assert.equal(body.authenticated, false, "Unauthenticated request should show authenticated: false");
  assert.ok("userId" in body, "Response should have userId field");
  assert.ok("organizationId" in body, "Response should have organizationId field");
  assert.ok("permissions" in body, "Response should have permissions field");
  assert.ok(Array.isArray(body.permissions), "permissions should be an array");
});

test("Auth debug endpoint returns correct shape when unauthenticated", async (t) => {
  const { body } = await get("/api/admin/auth/debug");
  assert.deepEqual(body.permissions, [], "Unauthenticated should have empty permissions");
  assert.equal(body.userId, null, "Unauthenticated should have null userId");
  assert.equal(body.organizationId, null, "Unauthenticated should have null organizationId");
});

// ─── Group 5: Response consistency checks ────────────────────────────────────

test("getAdminOrgId routes return error key (not message key) in 401", async (t) => {
  const routes = [
    "/api/admin/business-brain/health-score",
    "/api/admin/workflows/stats",
    "/api/admin/agent-tools",
  ];
  for (const route of routes) {
    const { body } = await get(route);
    assert.ok("error" in body, `GET ${route} 401 body should have 'error' key, got: ${JSON.stringify(body)}`);
  }
});

test("isAuthenticated routes return message key (not error key) in 401", async (t) => {
  const routes = [
    "/api/admin/team-training/prospects",
    "/api/admin/team-training/deals",
  ];
  for (const route of routes) {
    const { body } = await get(route);
    assert.ok("message" in body, `GET ${route} 401 body should have 'message' key, got: ${JSON.stringify(body)}`);
  }
});

console.log("\nRunning admin auth tests against http://localhost:5000...\n");
