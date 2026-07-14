/**
 * Kevin Integration — Phase 3 smoke tests
 *
 * Tests service exports, circuit breaker logic, and loop prevention.
 *
 * Run with (server must be running on port 5000):
 *   npx tsx server/tests/kevin-integration.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";

// ─── Circuit breaker ──────────────────────────────────────────────────────────

test("kevin-circuit-breaker: getCircuitStatus returns expected shape", async () => {
  const mod = await import("../services/kevin-circuit-breaker.js");
  const status = mod.getCircuitStatus();
  assert.ok(typeof status.state === "string", "state must be string");
  assert.ok(typeof status.failures === "number", "failures must be number");
  assert.ok(["closed", "open", "half_open"].includes(status.state), `unexpected state: ${status.state}`);
});

test("kevin-circuit-breaker: exports expected functions", async () => {
  const mod = await import("../services/kevin-circuit-breaker.js");
  assert.equal(typeof mod.getCircuitStatus, "function");
  assert.equal(typeof mod.getCircuitState, "function");
  assert.equal(typeof mod.isCallAllowed, "function");
  assert.equal(typeof mod.recordCircuitFailure, "function");
  assert.equal(typeof mod.recordCircuitSuccess, "function");
  assert.equal(typeof mod.withCircuitBreaker, "function");
});

test("kevin-circuit-breaker: getCircuitState returns a valid state", async () => {
  const mod = await import("../services/kevin-circuit-breaker.js");
  const state = mod.getCircuitState();
  assert.ok(["closed", "open", "half_open"].includes(state), `unexpected state: ${state}`);
});

// ─── Navigation registry ──────────────────────────────────────────────────────

test("kevin-navigation-registry: listNavEntriesForRole returns array", async () => {
  const mod = await import("../services/kevin-navigation-registry.js");
  const entries = mod.listNavEntriesForRole("ADMIN");
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length > 0);
  for (const e of entries) {
    assert.ok(typeof e.route === "string", `route must be string, got ${typeof e.route}`);
    assert.ok(typeof e.label === "string", `label must be string, got ${typeof e.label}`);
  }
});

test("kevin-navigation-registry: NAV_REGISTRY is non-empty", async () => {
  const mod = await import("../services/kevin-navigation-registry.js");
  const reg = mod.NAV_REGISTRY;
  assert.ok(reg && typeof reg === "object");
  const keys = Object.keys(reg);
  assert.ok(keys.length > 0, "Expected at least one navigation entry");
});

test("kevin-navigation-registry: isAllowedIntent returns boolean", async () => {
  const mod = await import("../services/kevin-navigation-registry.js");
  const allowed = mod.isAllowedIntent("ceo_heartbeat");
  const blocked = mod.isAllowedIntent("zzz_nonexistent_xyz");
  assert.ok(typeof allowed === "boolean");
  assert.ok(typeof blocked === "boolean");
});

test("kevin-navigation-registry: resolveNavSuggestion exports as function", async () => {
  const mod = await import("../services/kevin-navigation-registry.js");
  assert.equal(typeof mod.resolveNavSuggestion, "function");
});

// ─── Capability service ───────────────────────────────────────────────────────

test("kevin-capability-service: KEVIN_CAPABILITIES is non-empty array", async () => {
  const mod = await import("../services/kevin-capability-service.js");
  assert.ok(Array.isArray(mod.KEVIN_CAPABILITIES));
  assert.ok(mod.KEVIN_CAPABILITIES.length > 0);
});

test("kevin-capability-service: APPROVAL_MODE_ORDER has observe and auto", async () => {
  const mod = await import("../services/kevin-capability-service.js");
  const modes = mod.APPROVAL_MODE_ORDER;
  assert.ok(modes.includes("observe"), "missing observe");
  assert.ok(modes.includes("auto"), "missing auto");
  assert.ok(modes.includes("disabled"), "missing disabled");
});

test("kevin-capability-service: CAPABILITY_DESCRIPTIONS covers all capabilities", async () => {
  const mod = await import("../services/kevin-capability-service.js");
  for (const cap of mod.KEVIN_CAPABILITIES) {
    assert.ok(
      mod.CAPABILITY_DESCRIPTIONS[cap],
      `Missing description for capability: ${cap}`,
    );
  }
});

// ─── Signal router (loop prevention) ─────────────────────────────────────────

test("kevin-signal-router: exports routeKevinSignal", async () => {
  const mod = await import("../services/kevin-signal-router.js");
  assert.equal(typeof mod.routeKevinSignal, "function");
});

test("kevin-signal-router: rejects signal with depth > 3", async () => {
  const mod = await import("../services/kevin-signal-router.js");
  const result = await mod.routeKevinSignal({
    orgId: "test-org",
    signalType: "test.signal",
    payload: {},
    sourceAgent: "test",
    depth: 4,
  });
  assert.equal(result.ok, false, "Expected ok=false for depth > 3");
  assert.ok(
    result.status === "rejected_loop" || result.error?.toLowerCase().includes("depth"),
    `Expected rejected_loop status or depth in error, got: status=${result.status} error=${result.error}`,
  );
});

// ─── Context service ──────────────────────────────────────────────────────────

test("kevin-context-service: exports expected functions", async () => {
  const mod = await import("../services/kevin-context-service.js");
  assert.equal(typeof mod.requestKevinContext, "function");
  assert.equal(typeof mod.formatKevinContextForPrompt, "function");
});

test("kevin-context-service: formatKevinContextForPrompt returns string for empty", async () => {
  const mod = await import("../services/kevin-context-service.js");
  const result = mod.formatKevinContextForPrompt({
    available: false,
    status: "disabled",
    summary: "",
    memories: [],
    confidence: null,
    contextRequestId: null,
  });
  assert.ok(typeof result === "string");
});

test("kevin-context-service: requestKevinContext returns disabled when flag off", async () => {
  process.env.KEVIN_CONTEXT_RETRIEVAL_ENABLED = "false";
  try {
    const mod = await import("../services/kevin-context-service.js");
    const ctx = await mod.requestKevinContext({
      orgId: "test-org-smoke",
      agentType: "test_agent",
      workflow: "smoke_test",
      question: "smoke test question",
      capability: "test_cap",
      traceId: "trace-smoke",
      depth: 0,
    });
    assert.equal(ctx.available, false);
    assert.ok(
      ctx.status === "disabled" || ctx.status === "unavailable" || ctx.status === "failed",
      `Expected disabled/unavailable/failed, got: ${ctx.status}`,
    );
  } finally {
    delete process.env.KEVIN_CONTEXT_RETRIEVAL_ENABLED;
  }
});

// ─── Outcome service ──────────────────────────────────────────────────────────

test("kevin-outcome-service: exports expected functions", async () => {
  const mod = await import("../services/kevin-outcome-service.js");
  assert.equal(typeof mod.recordAgentMailApproved, "function");
  assert.equal(typeof mod.recordAgentMailRejected, "function");
  assert.equal(typeof mod.recordKevinOutcome, "function");
  assert.equal(typeof mod.flushPendingKevinOutcomes, "function");
});

// ─── Internal service token middleware ────────────────────────────────────────

test("require-internal-service-token: exports expected functions", async () => {
  const mod = await import("../middleware/require-internal-service-token.js");
  assert.equal(typeof mod.requireInternalServiceToken, "function");
  assert.equal(typeof mod.isInternalServiceTokenConfigured, "function");
});

// ─── HTTP: Phase 3 admin routes require auth (unauthenticated → 401) ─────────

test("HTTP: GET /api/admin/kevin/circuit-breaker is 401 unauthenticated", async () => {
  const res = await fetch(`${BASE}/api/admin/kevin/circuit-breaker`);
  assert.ok(res.status === 401, `Expected 401, got ${res.status}`);
});

test("HTTP: GET /api/admin/kevin/capabilities is 401 unauthenticated", async () => {
  const res = await fetch(`${BASE}/api/admin/kevin/capabilities`);
  assert.ok(res.status === 401, `Expected 401, got ${res.status}`);
});

test("HTTP: GET /api/admin/kevin/events is 401 unauthenticated", async () => {
  const res = await fetch(`${BASE}/api/admin/kevin/events`);
  assert.ok(res.status === 401, `Expected 401, got ${res.status}`);
});

test("HTTP: GET /api/admin/kevin/outcomes is 401 unauthenticated", async () => {
  const res = await fetch(`${BASE}/api/admin/kevin/outcomes`);
  assert.ok(res.status === 401, `Expected 401, got ${res.status}`);
});

test("HTTP: GET /api/admin/kevin/context-requests is 401 unauthenticated", async () => {
  const res = await fetch(`${BASE}/api/admin/kevin/context-requests`);
  assert.ok(res.status === 401, `Expected 401, got ${res.status}`);
});

test("HTTP: POST /api/internal/kevin/signals is protected (401, 403, or 503 when token not configured)", async () => {
  const res = await fetch(`${BASE}/api/internal/kevin/signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orgId: "test-org",
      signalType: "te.test",
      payload: {},
      source: "test",
    }),
  });
  assert.ok(
    res.status === 401 || res.status === 403 || res.status === 503,
    `Expected 401, 403, or 503 (token not configured), got ${res.status}`,
  );
});
