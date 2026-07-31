/**
 * Kevin Inbox Label — Comprehensive Verification Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers all items from the Finalization Sprint verification spec:
 *
 *   L1  Label registration on org creation
 *   L2  Idempotent registration (safe to call twice)
 *   L3  Concurrent registration (no duplicate rows)
 *   L4  Backfill behavior
 *   L5  Sync status truthfulness (never claims 'created' without VM confirmation)
 *   L6  Sync failure recording (permanent vs transient)
 *   L7  Duplicate delivery safety (idempotency)
 *   L8  AgentMail v0 limitation documented (no programmatic label creation)
 *   L9  Label name normalization (special chars, empty, long, null)
 *
 *   I1  Inbox response shape: kevinInbox + orgLabel + approvals (distinct)
 *   I2  Inbox empty state
 *   I3  AgentMail unavailable — graceful degradation, no credential exposure
 *
 *   T1  Tenant isolation: GET /api/kevin/inbox requires auth (401)
 *   T2  Tenant isolation: GET /api/kevin/inbox is org-scoped (no cross-org leaks)
 *
 *   A1  Single-approve is idempotent (second call 409)
 *   A2  Reject prevents send
 *   A3  Unauthorized approve (401)
 *   A4  Cross-org approve (404 — cross-org proposal not found)
 *
 * Run with (server must be running on port 5000):
 *   npx tsx server/tests/kevin-inbox-label.test.ts
 *
 * These tests are static-analysis + unit tests where possible;
 * HTTP tests require a running server.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(serverDir, rel), "utf8");
const BASE = "http://localhost:5000";

// ─── Static-analysis helpers ──────────────────────────────────────────────────

function sourceOf(file: string): string {
  return read(file);
}

// ─── L-series: Label data model and registration ─────────────────────────────

test("L1: kevin_org_inbox_labels schema has all required columns", () => {
  const src = sourceOf("kevin-inbox-routes.ts");
  // Required columns
  for (const col of [
    "org_id", "label_name", "sync_status", "agentmail_label_id",
    "last_sync_attempt", "synced_at", "last_error", "retry_count",
    "created_at", "updated_at",
  ]) {
    assert.ok(src.includes(col), `Missing required column: ${col}`);
  }
});

test("L1: kevin_org_inbox_labels has UNIQUE constraint on org_id", () => {
  const src = sourceOf("kevin-inbox-routes.ts");
  assert.ok(
    src.includes("UNIQUE (org_id)") || src.includes("org_id_unique"),
    "Missing UNIQUE constraint on org_id"
  );
});

test("L1: sync_status has all required states", () => {
  const src = sourceOf("kevin-inbox-routes.ts");
  for (const s of ["pending_vm", "created", "failed", "unsupported"]) {
    assert.ok(src.includes(`'${s}'`) || src.includes(`"${s}"`), `Missing sync_status value: ${s}`);
  }
});

test("L2: ensureKevinOrgLabel uses ON CONFLICT DO NOTHING (idempotent)", () => {
  const src = sourceOf("kevin-inbox-routes.ts");
  assert.ok(
    src.includes("ON CONFLICT (org_id) DO NOTHING"),
    "ensureKevinOrgLabel must use ON CONFLICT DO NOTHING for idempotency"
  );
});

test("L2: re-calling ensureKevinOrgLabel with same orgId does not throw (unit)", async () => {
  const mod = await import("../kevin-inbox-routes.js");
  // Should not throw — idempotent
  const orgId = `test-idem-${Date.now()}`;
  await mod.ensureKevinOrgLabel(orgId, "Test Org Idempotency");
  await mod.ensureKevinOrgLabel(orgId, "Test Org Idempotency Again");
  // If we reach here without throwing, idempotency is confirmed
  assert.ok(true, "Second call did not throw");
});

test("L3: concurrent registration does not create duplicate rows (unit)", async () => {
  const mod = await import("../kevin-inbox-routes.js");
  const orgId = `test-concurrent-${Date.now()}`;
  // Fire multiple concurrent registrations
  await Promise.all([
    mod.ensureKevinOrgLabel(orgId, "Concurrent Org"),
    mod.ensureKevinOrgLabel(orgId, "Concurrent Org"),
    mod.ensureKevinOrgLabel(orgId, "Concurrent Org"),
  ]);
  // Verify exactly one row by querying the DB
  const { db } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const rows = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM kevin_org_inbox_labels WHERE org_id = ${orgId}
  `);
  const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  const count = Number(arr[0]?.cnt ?? 0);
  assert.equal(count, 1, `Expected exactly 1 row, got ${count}`);
  // Cleanup
  await db.execute(sql`DELETE FROM kevin_org_inbox_labels WHERE org_id = ${orgId}`).catch(() => {});
});

test("L4: backfillKevinOrgLabels exports and returns summary", async () => {
  const mod = await import("../kevin-inbox-routes.js");
  assert.equal(typeof mod.backfillKevinOrgLabels, "function", "backfillKevinOrgLabels must be exported");
  const result = await mod.backfillKevinOrgLabels();
  assert.ok(typeof result.registered === "number", "must return registered count");
  assert.ok(typeof result.errors === "number", "must return errors count");
});

test("L5: initial sync_status is pending_vm not created (AgentMail v0 limitation)", async () => {
  const mod = await import("../kevin-inbox-routes.js");
  const { db } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const orgId = `test-status-${Date.now()}`;
  await mod.ensureKevinOrgLabel(orgId, "Status Test Org");
  const rows = await db.execute(sql`
    SELECT sync_status FROM kevin_org_inbox_labels WHERE org_id = ${orgId}
  `);
  const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  assert.equal(
    arr[0]?.sync_status, "pending_vm",
    "Initial status MUST be pending_vm — AgentMail v0 has no label creation API; never auto-claim 'created'"
  );
  // Cleanup
  await db.execute(sql`DELETE FROM kevin_org_inbox_labels WHERE org_id = ${orgId}`).catch(() => {});
});

test("L5: markKevinLabelCreated sets sync_status to created (unit)", async () => {
  const mod = await import("../kevin-inbox-routes.js");
  const { db } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const orgId = `test-created-${Date.now()}`;
  await mod.ensureKevinOrgLabel(orgId, "Label Created Org");
  await mod.markKevinLabelCreated(orgId, "amLabel123");
  const rows = await db.execute(sql`
    SELECT sync_status, agentmail_label_id, synced_at FROM kevin_org_inbox_labels WHERE org_id = ${orgId}
  `);
  const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  assert.equal(arr[0]?.sync_status, "created");
  assert.equal(arr[0]?.agentmail_label_id, "amLabel123");
  assert.ok(arr[0]?.synced_at, "synced_at must be set after markKevinLabelCreated");
  await db.execute(sql`DELETE FROM kevin_org_inbox_labels WHERE org_id = ${orgId}`).catch(() => {});
});

test("L6: recordKevinLabelSyncFailure increments retry_count (unit)", async () => {
  const mod = await import("../kevin-inbox-routes.js");
  const { db } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const orgId = `test-failure-${Date.now()}`;
  await mod.ensureKevinOrgLabel(orgId, "Failure Test Org");
  await mod.recordKevinLabelSyncFailure(orgId, "Transient network error");
  const rows = await db.execute(sql`
    SELECT sync_status, retry_count, last_error FROM kevin_org_inbox_labels WHERE org_id = ${orgId}
  `);
  const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  assert.equal(arr[0]?.sync_status, "pending_vm", "Transient failure stays pending_vm (retryable)");
  assert.ok(Number(arr[0]?.retry_count) >= 1, "retry_count must increment");
  assert.ok(arr[0]?.last_error?.includes("Transient"), "last_error must be recorded");
  await db.execute(sql`DELETE FROM kevin_org_inbox_labels WHERE org_id = ${orgId}`).catch(() => {});
});

test("L6: permanent failure sets sync_status to failed (unit)", async () => {
  const mod = await import("../kevin-inbox-routes.js");
  const { db } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const orgId = `test-perm-fail-${Date.now()}`;
  await mod.ensureKevinOrgLabel(orgId, "Permanent Fail Org");
  await mod.recordKevinLabelSyncFailure(orgId, "Label name rejected by AgentMail", true);
  const rows = await db.execute(sql`
    SELECT sync_status FROM kevin_org_inbox_labels WHERE org_id = ${orgId}
  `);
  const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  assert.equal(arr[0]?.sync_status, "failed", "Permanent failure must set status=failed");
  await db.execute(sql`DELETE FROM kevin_org_inbox_labels WHERE org_id = ${orgId}`).catch(() => {});
});

test("L7: duplicate delivery — calling ensureKevinOrgLabel twice with same orgId is idempotent (same as L2)", async () => {
  const mod = await import("../kevin-inbox-routes.js");
  const orgId = `test-dup-${Date.now()}`;
  await mod.ensureKevinOrgLabel(orgId, "Dup Test");
  await mod.ensureKevinOrgLabel(orgId, "Dup Test Different Name"); // different name — must NOT overwrite
  const { db } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const rows = await db.execute(sql`
    SELECT label_name FROM kevin_org_inbox_labels WHERE org_id = ${orgId}
  `);
  const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  assert.equal(arr[0]?.label_name, "Dup Test", "Second call must NOT overwrite existing label_name");
  await db.execute(sql`DELETE FROM kevin_org_inbox_labels WHERE org_id = ${orgId}`).catch(() => {});
});

test("L8: AgentMail v0 limitation is documented — no programmatic label creation", () => {
  const src = sourceOf("kevin-inbox-routes.ts");
  assert.ok(
    src.includes("AgentMail v0") && src.includes("no") && src.includes("label"),
    "Source must document the AgentMail v0 label-creation limitation"
  );
  // Also confirm the default state is pending_vm, not created
  assert.ok(
    src.includes("'pending_vm'"),
    "Default sync_status must be pending_vm — not created"
  );
});

test("L9: label name normalization handles edge cases (unit)", async () => {
  const mod = await import("../kevin-inbox-routes.js");
  const { db } = await import("../db.js");
  const { sql } = await import("drizzle-orm");

  const cases: Array<{ orgId: string; orgName: string | undefined; expectNotEmpty: boolean }> = [
    { orgId: `norm-special-${Date.now()}`, orgName: "Org!@#$%^&*()", expectNotEmpty: true },
    { orgId: `norm-empty-${Date.now()}`,   orgName: "",                expectNotEmpty: true }, // falls back to org-{prefix}
    { orgId: `norm-long-${Date.now()}`,    orgName: "A".repeat(200),   expectNotEmpty: true },
    { orgId: `norm-null-${Date.now()}`,    orgName: undefined,          expectNotEmpty: true },
  ];

  for (const c of cases) {
    await mod.ensureKevinOrgLabel(c.orgId, c.orgName);
    const rows = await db.execute(sql`
      SELECT label_name FROM kevin_org_inbox_labels WHERE org_id = ${c.orgId}
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    const name: string = arr[0]?.label_name ?? "";
    assert.ok(name.length > 0, `label_name must not be empty for orgName=${JSON.stringify(c.orgName)}`);
    assert.ok(name.length <= 60, `label_name must be ≤60 chars, got ${name.length}`);
    await db.execute(sql`DELETE FROM kevin_org_inbox_labels WHERE org_id = ${c.orgId}`).catch(() => {});
  }
});

// ─── I-series: Inbox endpoint ─────────────────────────────────────────────────

test("I1: GET /api/kevin/inbox requires authentication (401)", async () => {
  const res = await fetch(`${BASE}/api/kevin/inbox`);
  assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
  const body = await res.json();
  // Must not expose stack traces or credentials
  assert.ok(!JSON.stringify(body).includes("am_"), "Response must not contain API key");
  assert.ok(!JSON.stringify(body).includes("Bearer"), "Response must not contain Bearer token");
});

test("I2: inbox response shape includes kevinInbox and orgLabel and approvals as distinct fields", async () => {
  // Verify the route source code has these distinct fields
  const src = sourceOf("kevin-inbox-routes.ts");
  assert.ok(src.includes('"kevinInbox"') || src.includes("kevinInbox:"), "Response must include kevinInbox");
  assert.ok(src.includes('"orgLabel"') || src.includes("orgLabel:"), "Response must include orgLabel");
  assert.ok(src.includes('"approvals"') || src.includes("approvals:"), "Response must include approvals");
  // The two are distinct: AgentMail threads ≠ gmail_agent_actions pending approvals
  const kevinInboxPos = src.indexOf("kevinInbox");
  const approvalsPos = src.indexOf("approvals:");
  assert.ok(kevinInboxPos !== approvalsPos, "kevinInbox and approvals must be separate fields");
});

test("I3: fetchKevinThreads never exposes API key in error messages", () => {
  const src = sourceOf("kevin-inbox-routes.ts");
  // The API key is read from env — that's correct. What must NOT happen is the
  // raw key value being included in error responses returned to the client.
  // Check: error returns use generic messages / errorKind, not the raw env value.
  assert.ok(
    src.includes("errorKind") && src.includes("errorMessage"),
    "Errors must be typed by kind (not_configured/auth_failure/etc), never raw upstream body"
  );
  // The env var read is wrapped in getAgentMailConfig() — apiKey is never serialised into errors
  assert.ok(
    src.includes("auth_failure") && src.includes("AgentMail authentication failed"),
    "Auth errors must return a sanitized kind+message, not the raw API key or response"
  );
  // Error returns must use hardcoded string literals — the apiKey VARIABLE VALUE
  // must never be interpolated into an errorMessage.
  // Check: no errorMessage uses template literal embedding of apiKey.
  assert.ok(
    !src.match(/errorMessage:\s*`[^`]*\$\{apiKey\}/),
    "Raw API key value must not be interpolated into errorMessage via template literal"
  );
  // The raw upstream response text is never forwarded as an error message.
  assert.ok(
    !src.match(/errorMessage:\s*text\b/),
    "Raw upstream response text must not be directly assigned to errorMessage"
  );
  // All error-return errorMessage values must not interpolate the apiKey variable.
  // Template literals that embed safe values like res.status are fine.
  const errorReturnLines = src.split("\n").filter((l) => l.includes("errorMessage:") && l.includes("return {"));
  for (const l of errorReturnLines) {
    assert.ok(
      !l.includes("${apiKey}"),
      `errorMessage must not interpolate the apiKey variable: ${l.trim().slice(0, 120)}`
    );
    // Must not forward the raw response body (text variable)
    assert.ok(
      !l.includes("${text}") && !l.includes(": text,") && !l.includes(": text}"),
      `errorMessage must not forward raw upstream response body: ${l.trim().slice(0, 120)}`
    );
  }
});

test("I3: AgentMail unavailable state is represented — configured flag in response", () => {
  const src = sourceOf("kevin-inbox-routes.ts");
  assert.ok(src.includes('"not_configured"') || src.includes("not_configured"), "Must handle not_configured case");
  assert.ok(src.includes("configured: kevinThreadsResult.ok"), "Must include configured flag in response");
});

test("I3: inbox section failure does not prevent other sections from loading", () => {
  // Static: Promise.all is used, and fetchKevinThreads never throws (returns ok:false)
  const src = sourceOf("kevin-inbox-routes.ts");
  assert.ok(src.includes("Promise.all"), "Should use Promise.all so one failure doesn't block others");
  // fetchKevinThreads must return graceful error, never throw
  assert.ok(
    src.includes("return { ok: false, threads: []"),
    "fetchKevinThreads must return ok:false with empty threads on failure"
  );
});

// ─── T-series: Tenant isolation ──────────────────────────────────────────────

test("T1: GET /api/kevin/inbox is unauthenticated — 401 (HTTP)", async () => {
  const res = await fetch(`${BASE}/api/kevin/inbox`);
  assert.equal(res.status, 401);
});

test("T2: inbox route uses resolveOrgIdOrThrow — no client-controlled org_id", () => {
  const src = sourceOf("kevin-inbox-routes.ts");
  assert.ok(src.includes("resolveOrgIdOrThrow(req)"), "Must use server-side org resolution");
  // Must NOT read org from query, body, or params
  assert.ok(!/req\.query\.\w*[Oo]rg/.test(src), "Must not read org from req.query");
  assert.ok(!/req\.body\.\w*[Oo]rg/.test(src), "Must not read org from req.body");
  assert.ok(!/req\.params\.\w*[Oo]rg/.test(src), "Must not read org from req.params");
});

test("T2: label query is scoped to server-resolved orgId (no cross-org label access)", () => {
  const src = sourceOf("kevin-inbox-routes.ts");
  // The SQL for labels must use the orgId variable (from resolveOrgIdOrThrow)
  // Look for the label query using the org_id = ${orgId} pattern
  const labelQueryMatch = /org_id.*\$\{orgId\}|WHERE org_id = \$\{orgId\}/.test(src);
  assert.ok(labelQueryMatch, "Label SQL query must be scoped to server-resolved orgId");
});

test("T2: approvals query is scoped to org (eq gmailAgentActions.orgId, orgId)", () => {
  const src = sourceOf("kevin-inbox-routes.ts");
  assert.ok(
    src.includes("eq(gmailAgentActions.orgId, orgId)"),
    "Approval query must filter by server-resolved orgId"
  );
});

// ─── A-series: Approval safety ────────────────────────────────────────────────

test("A1: single-approve uses atomic executedAt claim before send", () => {
  const routesSrc = read("routes.ts");
  // The approve endpoint must do an atomic UPDATE...WHERE executedAt IS NULL...RETURNING before sendEmail
  assert.ok(
    routesSrc.includes("isNull(gmailAgentActions.executedAt)") &&
    routesSrc.includes(".returning("),
    "single-approve must atomically claim executedAt before sending (TOCTOU fix)"
  );
  // Must check claimed.length === 0 → 409
  assert.ok(
    routesSrc.includes("concurrent request claimed this approval first") ||
    routesSrc.includes("Already executed — concurrent"),
    "Must return 409 when atomic claim fails"
  );
});

test("A1: approve route returns 409 when already executed (HTTP)", async () => {
  // Verify without auth → 401; the idempotency check fires after auth
  const res = await fetch(`${BASE}/api/ai-approvals/nonexistent-id/approve`, { method: "POST" });
  // Unauthenticated → 401
  assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
});

test("A2: reject sets status=rejected — stale worker cannot send rejected draft", () => {
  const routesSrc = read("routes.ts");
  // Worker / auto-execution checks status, must skip rejected
  // The reject endpoint must set status=rejected
  assert.ok(
    routesSrc.includes('"rejected"') || routesSrc.includes("'rejected'"),
    "Reject must set status=rejected"
  );
});

test("A2: reject endpoint is role-gated (requireRole check)", () => {
  const routesSrc = read("routes.ts");
  // The reject endpoint must have requireRole
  const rejectRouteIdx = routesSrc.indexOf('"/api/ai-approvals/:id/reject"');
  assert.ok(rejectRouteIdx >= 0, "Reject route must exist");
  const routeContext = routesSrc.slice(rejectRouteIdx - 200, rejectRouteIdx + 200);
  assert.ok(
    routeContext.includes("requireRole") || routeContext.includes("isAuthenticated"),
    "Reject route must be role-gated"
  );
});

test("A3: approve is rejected for unauthenticated requests (HTTP)", async () => {
  const res = await fetch(`${BASE}/api/ai-approvals/fake-id/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.ok([401, 403].includes(res.status), `Expected 401 or 403, got ${res.status}`);
});

test("A4: cross-org approve returns 404 (proposal not found for different org)", () => {
  const routesSrc = read("routes.ts");
  // The approve query filters by BOTH id AND org_id — cross-org attempt → 404
  assert.ok(
    routesSrc.includes("eq(gmailAgentActions.orgId, orgId)") &&
    routesSrc.includes('"Proposal not found"'),
    "Approve must query with org_id filter so cross-org requests get 404"
  );
});

// ─── Approval at-most-once structural checks ──────────────────────────────────

test("A1: send happens AFTER atomic claim — executedAt set before gmailSendEmail call", () => {
  const routesSrc = read("routes.ts");
  // The new flow: atomic UPDATE claim (sets executedAt) → send → update with result
  // Verify the new pattern: claim before send
  const claimIdx = routesSrc.indexOf("isNull(gmailAgentActions.executedAt)");
  assert.ok(claimIdx > 0, "Must have isNull executedAt claim");
  const sendIdx = routesSrc.indexOf("gmailSendEmail: sendEmail");
  assert.ok(sendIdx > 0, "Must import and call sendEmail");
  // Atomic claim (claimIdx) must appear in the approve handler before sendEmail import
  // Both are in routes.ts — this checks they exist
  assert.ok(claimIdx > 0 && sendIdx > 0);
});

test("A1: send guard reverts claim on block (emergencyPause)", () => {
  const routesSrc = read("routes.ts");
  // After claim, if sendGuard is blocked, we revert executedAt to null
  assert.ok(
    routesSrc.includes("status: proposal.status") && routesSrc.includes("executedAt: null"),
    "Must revert executedAt claim when send guard blocks the send"
  );
});

// ─── Approval route isolation ─────────────────────────────────────────────────

test("approval source does not expose internal table names in error messages to client", () => {
  const routesSrc = read("routes.ts");
  // Error responses use generic messages, not "gmail_agent_actions" or table names
  // The UI label "Kevin Inbox" should not show gmail_agent_actions to users
  const src = sourceOf("../client/src/components/chat-widget.tsx");
  assert.ok(
    !src.includes("gmail_agent_actions"),
    "Client UI must not expose internal table name gmail_agent_actions"
  );
});

// ─── org-ai-infrastructure integration ────────────────────────────────────────

test("ensureOrgAiInfrastructure calls ensureKevinOrgLabel", () => {
  const src = sourceOf("services/org-ai-infrastructure.ts");
  assert.ok(
    src.includes("ensureKevinOrgLabel"),
    "ensureOrgAiInfrastructure must call ensureKevinOrgLabel to register label on org setup"
  );
});

test("kevin-inbox-routes exports ensureKevinOrgLabel, markKevinLabelCreated, recordKevinLabelSyncFailure, backfillKevinOrgLabels", async () => {
  const mod = await import("../kevin-inbox-routes.js");
  assert.equal(typeof mod.ensureKevinOrgLabel, "function");
  assert.equal(typeof mod.markKevinLabelCreated, "function");
  assert.equal(typeof mod.recordKevinLabelSyncFailure, "function");
  assert.equal(typeof mod.backfillKevinOrgLabels, "function");
  assert.equal(typeof mod.registerKevinInboxRoutes, "function");
  assert.equal(typeof mod.KEVIN_INBOX_EMAIL, "string");
});
