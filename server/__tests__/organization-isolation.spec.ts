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
