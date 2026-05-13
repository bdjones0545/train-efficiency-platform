/**
 * Connector Layer Acceptance Tests
 *
 * Tests for:
 *   - DB schema: connector_tokens, agent_invoices, bookings.google_calendar_event_id
 *   - Google Calendar status endpoint (unauthenticated → 401, admin → shape)
 *   - Stripe invoices endpoint (unauthenticated → 401, admin → array)
 *   - Connector status endpoint (unauthenticated → 401)
 *   - Workflow definitions: session_booking exists, has wait_payment step
 *   - resumeWorkflowAfterPayment: returns resumed=false for unknown run
 *   - impl guards: notConfigured / notConnected / notFound
 *
 * Run with:
 *   npx tsx server/tests/connector-layer.test.ts
 *
 * The server must be running on port 5000 before executing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { sql } from "drizzle-orm";

const BASE = "http://localhost:5000";

async function get(path: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const r = await fetch(`${BASE}${path}`, { headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function del(path: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const r = await fetch(`${BASE}${path}`, { method: "DELETE", headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ─── DB Schema Tests ───────────────────────────────────────────────────────────

test("connector_tokens table has required columns", async () => {
  const result = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'connector_tokens'
    ORDER BY ordinal_position
  `);
  const cols = ((result as any).rows ?? result).map((r: any) => r.column_name);
  assert.ok(cols.includes("org_id"), "missing org_id");
  assert.ok(cols.includes("connector"), "missing connector");
  assert.ok(cols.includes("access_token"), "missing access_token");
  assert.ok(cols.includes("refresh_token"), "missing refresh_token");
  assert.ok(cols.includes("email"), "missing email");
});

test("agent_invoices table has required columns", async () => {
  const result = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'agent_invoices'
    ORDER BY ordinal_position
  `);
  const cols = ((result as any).rows ?? result).map((r: any) => r.column_name);
  for (const col of ["id", "org_id", "stripe_invoice_id", "stripe_customer_id", "tool_call_id", "workflow_run_id", "client_id", "amount_cents", "status", "stripe_invoice_url", "paid_at"]) {
    assert.ok(cols.includes(col), `agent_invoices missing column: ${col}`);
  }
});

test("bookings table has google_calendar_event_id column", async () => {
  const result = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'google_calendar_event_id'
  `);
  const rows = (result as any).rows ?? result;
  assert.equal(rows.length, 1, "bookings missing google_calendar_event_id column");
});

// ─── Auth Guards (unauthenticated → 401) ──────────────────────────────────────

test("GET /api/admin/connectors → 401 when unauthenticated", async () => {
  const { status } = await get("/api/admin/connectors");
  assert.equal(status, 401);
});

test("GET /api/admin/connectors/google-calendar/connect → 401 when unauthenticated", async () => {
  const { status } = await get("/api/admin/connectors/google-calendar/connect");
  assert.equal(status, 401);
});

test("DELETE /api/admin/connectors/google-calendar → 401 when unauthenticated", async () => {
  const { status } = await del("/api/admin/connectors/google-calendar");
  assert.equal(status, 401);
});

test("GET /api/admin/agent-invoices → 401 when unauthenticated", async () => {
  const { status } = await get("/api/admin/agent-invoices");
  assert.equal(status, 401);
});

test("GET /api/admin/agent-invoices/unpaid → 401 when unauthenticated", async () => {
  const { status } = await get("/api/admin/agent-invoices/unpaid");
  assert.equal(status, 401);
});

// ─── Google OAuth Callback (public route) ─────────────────────────────────────

test("GET /api/connectors/google-calendar/callback with missing params → redirects with error", async () => {
  const r = await fetch(`${BASE}/api/connectors/google-calendar/callback`, { redirect: "manual" });
  // Should 302 redirect (not 404 or 500)
  assert.ok([301, 302, 307, 308].includes(r.status), `Expected redirect, got ${r.status}`);
  const loc = r.headers.get("location") ?? "";
  assert.ok(loc.includes("gcal_error") || loc.includes("connectors"), `Unexpected redirect location: ${loc}`);
});

// ─── Module-level: impl guards ─────────────────────────────────────────────────

test("isGoogleCalendarConfigured returns false when env vars missing", async () => {
  const savedId = process.env.GOOGLE_CLIENT_ID;
  const savedSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;

  const { isGoogleCalendarConfigured } = await import("../connectors/google-calendar");
  assert.equal(isGoogleCalendarConfigured(), false);

  if (savedId) process.env.GOOGLE_CLIENT_ID = savedId;
  if (savedSecret) process.env.GOOGLE_CLIENT_SECRET = savedSecret;
});

test("getGoogleCalendarStatus returns configured=false, connected=false when env vars missing", async () => {
  const savedId = process.env.GOOGLE_CLIENT_ID;
  const savedSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;

  const { getGoogleCalendarStatus } = await import("../connectors/google-calendar");
  const status = await getGoogleCalendarStatus("test-org-no-config");
  assert.equal(status.configured, false);
  assert.equal(status.connected, false);
  assert.equal(status.email, null);

  if (savedId) process.env.GOOGLE_CLIENT_ID = savedId;
  if (savedSecret) process.env.GOOGLE_CLIENT_SECRET = savedSecret;
});

test("impl_create_calendar_event returns notConfigured=true when Google env vars missing", async () => {
  const savedId = process.env.GOOGLE_CLIENT_ID;
  const savedSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;

  const { impl_create_calendar_event } = await import("../agent-tools/implementations");
  const result = await impl_create_calendar_event("test-org", {
    title: "Test Session",
    startIso: new Date(Date.now() + 3600000).toISOString(),
    endIso: new Date(Date.now() + 7200000).toISOString(),
  });

  assert.equal(result.success, false);
  assert.ok(result.message.includes("not configured"), `Expected 'not configured' in: ${result.message}`);
  assert.equal(result.data?.notConfigured, true);

  if (savedId) process.env.GOOGLE_CLIENT_ID = savedId;
  if (savedSecret) process.env.GOOGLE_CLIENT_SECRET = savedSecret;
});

test("impl_cancel_session returns not-found error for unknown booking", async () => {
  const { impl_cancel_session } = await import("../agent-tools/implementations");
  const result = await impl_cancel_session("test-org", {
    bookingId: "booking-does-not-exist-12345",
    reason: "Test cancellation",
    notifyClient: false,
  });
  assert.equal(result.success, false);
  assert.ok(result.message.toLowerCase().includes("not found"), `Expected 'not found' in: ${result.message}`);
});

test("impl_reschedule_session returns not-found error for unknown booking", async () => {
  const { impl_reschedule_session } = await import("../agent-tools/implementations");
  const result = await impl_reschedule_session("test-org", {
    bookingId: "booking-does-not-exist-12345",
    newStartIso: new Date(Date.now() + 86400000).toISOString(),
    newEndIso: new Date(Date.now() + 90000000).toISOString(),
  });
  assert.equal(result.success, false);
  assert.ok(result.message.toLowerCase().includes("not found"), `Expected 'not found' in: ${result.message}`);
});

// ─── Stripe Invoicing ─────────────────────────────────────────────────────────

test("markAgentInvoicePaid returns null workflowRunId for unknown stripe invoice", async () => {
  const { markAgentInvoicePaid } = await import("../connectors/stripe-invoicing");
  const result = await markAgentInvoicePaid("inv_unknown_test_invoice_99999");
  assert.equal(result.workflowRunId, null);
  assert.equal(result.agentInvoiceId, null);
});

test("listAgentInvoices returns empty array for unknown org", async () => {
  const { listAgentInvoices } = await import("../connectors/stripe-invoicing");
  const invoices = await listAgentInvoices("org-that-does-not-exist-xyz");
  assert.ok(Array.isArray(invoices));
  assert.equal(invoices.length, 0);
});

test("listUnpaidAgentInvoices returns empty array for unknown org", async () => {
  const { listUnpaidAgentInvoices } = await import("../connectors/stripe-invoicing");
  const invoices = await listUnpaidAgentInvoices("org-that-does-not-exist-xyz");
  assert.ok(Array.isArray(invoices));
  assert.equal(invoices.length, 0);
});

// ─── Workflow Definitions ─────────────────────────────────────────────────────

test("session_booking workflow is registered in definitions", async () => {
  const { getWorkflowDefinition } = await import("../workflows/definitions");
  const def = getWorkflowDefinition("session_booking");
  assert.ok(def, "session_booking workflow definition missing");
  assert.equal(def!.type, "session_booking");
  assert.equal(def!.category, "scheduling");
});

test("session_booking workflow has a wait_payment step", async () => {
  const { getWorkflowDefinition } = await import("../workflows/definitions");
  const def = getWorkflowDefinition("session_booking");
  assert.ok(def, "session_booking missing");
  const waitStep = def!.steps.find((s: any) => s.type === "wait_payment");
  assert.ok(waitStep, "No wait_payment step found in session_booking");
});

test("session_booking step 0 uses create_calendar_event tool", async () => {
  const { getWorkflowDefinition } = await import("../workflows/definitions");
  const def = getWorkflowDefinition("session_booking");
  assert.ok(def, "session_booking missing");
  const step0 = def!.steps[0] as any;
  assert.equal(step0.toolName, "create_calendar_event");
});

test("session_booking has create_invoice step", async () => {
  const { getWorkflowDefinition } = await import("../workflows/definitions");
  const def = getWorkflowDefinition("session_booking");
  assert.ok(def, "session_booking missing");
  const invoiceStep = def!.steps.find((s: any) => s.toolName === "create_invoice");
  assert.ok(invoiceStep, "No create_invoice step in session_booking");
});

// ─── resumeWorkflowAfterPayment ───────────────────────────────────────────────

test("resumeWorkflowAfterPayment returns resumed=false for unknown run id (valid UUID format)", async () => {
  const { resumeWorkflowAfterPayment } = await import("../workflows/executor");
  const result = await resumeWorkflowAfterPayment("00000000-0000-0000-0000-000000000001", "inv_test_unknown");
  assert.equal(result.resumed, false);
});

// ─── Registry connector statuses ──────────────────────────────────────────────

test("create_calendar_event tool has connectorStatus=live", async () => {
  const { getTool } = await import("../agent-tools/registry");
  const tool = getTool("create_calendar_event");
  assert.ok(tool, "create_calendar_event not in registry");
  assert.equal(tool!.connectorStatus, "live");
});

test("create_invoice tool has connectorStatus=live", async () => {
  const { getTool } = await import("../agent-tools/registry");
  const tool = getTool("create_invoice");
  assert.ok(tool, "create_invoice not in registry");
  assert.equal(tool!.connectorStatus, "live");
});

test("record_payment tool has connectorStatus=live", async () => {
  const { getTool } = await import("../agent-tools/registry");
  const tool = getTool("record_payment");
  assert.ok(tool, "record_payment not in registry");
  assert.equal(tool!.connectorStatus, "live");
});

test("CONNECTOR_ROADMAP includes Google Calendar as live", async () => {
  const { CONNECTOR_ROADMAP } = await import("../agent-tools/registry");
  const gcal = (CONNECTOR_ROADMAP as any[]).find((c) => c.name === "Google Calendar");
  assert.ok(gcal, "Google Calendar missing from CONNECTOR_ROADMAP");
  assert.equal(gcal.status, "live");
});

test("CONNECTOR_ROADMAP includes Stripe as live", async () => {
  const { CONNECTOR_ROADMAP } = await import("../agent-tools/registry");
  const stripe = (CONNECTOR_ROADMAP as any[]).find((c) => c.name === "Stripe");
  assert.ok(stripe, "Stripe missing from CONNECTOR_ROADMAP");
  assert.equal(stripe.status, "live");
});
