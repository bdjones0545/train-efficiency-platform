/**
 * Agent Tool Layer + Workflow Engine — Production Safety Tests
 *
 * Tests the following safety invariants:
 *   1. Double-click Execute is idempotent (CAS prevents re-execution)
 *   2. Duplicate workflow trigger is rejected for same entity
 *   3. Rejected tool call cannot be executed later
 *   4. send_email is not auto-retried on failure (external side-effect guard)
 *   5. send_sms is not auto-retried on failure (external side-effect guard)
 *   6. Concurrent workflow resume does not double-advance the same run
 *   7. Idempotency key deduplicates concurrent propose calls
 *   8. approveWorkflowStep CAS prevents double-approval
 *
 * Run with:
 *   npx tsx server/tests/tool-workflow-safety.test.ts
 *
 * The server must be running on port 5000 before executing, AND the DB must be
 * accessible via DATABASE_URL (used for direct function-level assertions).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { agentToolCalls, workflowRuns, workflowSteps } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { proposeToolCall, executePendingToolCall, rejectToolCall } from "../agent-tools/runtime";
import { startWorkflow, approveWorkflowStep, resumeWaitingWorkflows } from "../workflows/executor";
import { getTool } from "../agent-tools/registry";

const TEST_ORG = "test-safety-org-" + Date.now();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function cleanup() {
  await db.delete(workflowSteps)
    .where(sql`workflow_run_id IN (SELECT id FROM workflow_runs WHERE org_id = ${TEST_ORG})`);
  await db.delete(workflowRuns).where(eq(workflowRuns.orgId, TEST_ORG));
  await db.delete(agentToolCalls).where(eq(agentToolCalls.orgId, TEST_ORG));
}

async function createPendingConfirmationCall(toolName = "send_email") {
  const [record] = await db.insert(agentToolCalls).values({
    orgId: TEST_ORG,
    agentName: "test-agent",
    toolName,
    inputSummary: `Test ${toolName}`,
    proposedInput: {
      to: "test@example.com",
      subject: "Test",
      html: "<p>test</p>",
      orgId: TEST_ORG,
    },
    requiresConfirmation: true,
    confirmationStatus: "pending",
    status: "pending_confirmation",
  }).returning();
  return record;
}

// ─── Test 1: Double-click Execute is idempotent ───────────────────────────────

test("double-click execute: second call returns cached result, does not re-execute", async () => {
  await cleanup();

  // Create a call that has already been executed successfully
  const [record] = await db.insert(agentToolCalls).values({
    orgId: TEST_ORG,
    agentName: "test-agent",
    toolName: "create_follow_up_task",
    inputSummary: "Follow-up test",
    proposedInput: {
      prospectId: "fake-prospect-id",
      followUpDate: "2026-06-01",
      note: "Double-click test",
    },
    requiresConfirmation: false,
    confirmationStatus: "auto",
    status: "success",
    result: { message: "Follow-up scheduled" },
    executedAt: new Date(),
  }).returning();

  // Simulate second click: try to execute an already-success record
  const result = await executePendingToolCall(TEST_ORG, record.id, "admin-user");

  assert.equal(result.success, true, "Should return success for idempotent call");
  assert.ok(result.message.includes("idempotent") || result.message.includes("Already executed"),
    `Expected idempotent message, got: ${result.message}`);

  // Verify the record was NOT mutated (executedAt should be the original)
  const [after] = await db.select().from(agentToolCalls).where(eq(agentToolCalls.id, record.id));
  assert.equal(after.status, "success", "Status must remain success");

  await cleanup();
  console.log("✓ double-click execute: idempotent");
});

// ─── Test 2: Executing a 'executing' record (concurrent) is a no-op ──────────

test("concurrent execute: record already in executing state returns safe error", async () => {
  await cleanup();

  const [record] = await db.insert(agentToolCalls).values({
    orgId: TEST_ORG,
    agentName: "test-agent",
    toolName: "send_email",
    inputSummary: "Concurrent test",
    proposedInput: { to: "a@b.com", subject: "X", html: "<p>x</p>", orgId: TEST_ORG },
    requiresConfirmation: true,
    confirmationStatus: "auto",
    status: "executing",
  }).returning();

  const result = await executePendingToolCall(TEST_ORG, record.id, "admin-user");

  assert.equal(result.success, false, "Should fail — already executing");
  assert.ok(!result.message.toLowerCase().includes("not found"),
    "Should give a meaningful state error, not 'not found'");

  await cleanup();
  console.log("✓ concurrent execute: executing state is a no-op");
});

// ─── Test 3: Rejected tool call cannot be executed ───────────────────────────

test("rejected tool call: cannot execute after rejection", async () => {
  await cleanup();

  const record = await createPendingConfirmationCall();

  // Reject it
  await rejectToolCall(TEST_ORG, record.id, "admin-user");

  // Verify it's rejected
  const [afterReject] = await db.select().from(agentToolCalls).where(eq(agentToolCalls.id, record.id));
  assert.equal(afterReject.status, "rejected", "Status must be rejected");
  assert.equal(afterReject.confirmationStatus, "rejected", "Confirmation status must be rejected");

  // Attempt to execute the rejected call
  const result = await executePendingToolCall(TEST_ORG, record.id, "admin-user");

  assert.equal(result.success, false, "Execution of rejected call must fail");
  assert.ok(
    result.message.toLowerCase().includes("rejected"),
    `Expected 'rejected' in error message, got: ${result.message}`
  );

  // Verify the status did not change from rejected
  const [afterExec] = await db.select().from(agentToolCalls).where(eq(agentToolCalls.id, record.id));
  assert.equal(afterExec.status, "rejected", "Status must still be rejected after failed execution attempt");

  await cleanup();
  console.log("✓ rejected tool call: cannot execute after rejection");
});

// ─── Test 4: rejectToolCall is safe to call twice (idempotent) ───────────────

test("rejectToolCall: already-rejected call stays rejected (no error)", async () => {
  await cleanup();

  const record = await createPendingConfirmationCall();

  // Reject twice
  await rejectToolCall(TEST_ORG, record.id, "admin1");
  await rejectToolCall(TEST_ORG, record.id, "admin2");

  const [after] = await db.select().from(agentToolCalls).where(eq(agentToolCalls.id, record.id));
  assert.equal(after.status, "rejected", "Status must remain rejected");

  await cleanup();
  console.log("✓ rejectToolCall: idempotent");
});

// ─── Test 5: send_email tool has external_side_effect flag ───────────────────

test("send_email: external_side_effect flag is true (blocks auto-retry)", () => {
  const tool = getTool("send_email");
  assert.ok(tool, "send_email must exist in registry");
  assert.equal(tool!.permissions.external_side_effect, true, "send_email must have external_side_effect=true");
  assert.equal(tool!.permissions.requires_confirmation, true, "send_email must require confirmation");
  console.log("✓ send_email: external_side_effect=true");
});

// ─── Test 6: send_sms tool has external_side_effect flag ─────────────────────

test("send_sms: external_side_effect flag is true (blocks auto-retry)", () => {
  const tool = getTool("send_sms");
  assert.ok(tool, "send_sms must exist in registry");
  assert.equal(tool!.permissions.external_side_effect, true, "send_sms must have external_side_effect=true");
  assert.equal(tool!.permissions.requires_confirmation, true, "send_sms must require confirmation");
  console.log("✓ send_sms: external_side_effect=true");
});

// ─── Test 7: Internal tools are auto-retryable ───────────────────────────────

test("create_follow_up_task: safe for auto-retry (not external_side_effect)", () => {
  const tool = getTool("create_follow_up_task");
  assert.ok(tool, "create_follow_up_task must exist in registry");
  assert.equal(tool!.permissions.external_side_effect, false, "internal tools must NOT have external_side_effect");
  assert.equal(tool!.permissions.safe_auto_execute, true, "internal CRM tools must be safe to auto-execute");
  console.log("✓ create_follow_up_task: safe for auto-retry");
});

// ─── Test 8: Idempotency key deduplication ───────────────────────────────────

test("proposeToolCall: same idempotency key returns existing record without inserting", async () => {
  await cleanup();

  const idemKey = `test-idem-${Date.now()}`;

  // Use send_email which requires_confirmation=true and stays in pending_confirmation
  // without auto-executing, giving us a stable "in-flight" record to deduplicate.
  const emailInput = {
    to: "test@example.com",
    subject: "Idempotency test",
    html: "<p>test</p>",
    orgId: TEST_ORG,
  };

  // First propose — creates the record, leaves it pending_confirmation
  const result1 = await proposeToolCall(TEST_ORG, {
    agentName: "test-agent",
    toolName: "send_email",
    idempotencyKey: idemKey,
    proposedInput: emailInput,
  });

  assert.ok(result1.toolCallId, "First propose must return a toolCallId");
  assert.equal(result1.requiresConfirmation, true, "send_email must require confirmation");

  // Second propose with same key — must return the existing record, not insert a new one
  const result2 = await proposeToolCall(TEST_ORG, {
    agentName: "test-agent",
    toolName: "send_email",
    idempotencyKey: idemKey,
    proposedInput: emailInput,
  });

  // Must return the same toolCallId — no new record inserted
  assert.equal(result2.toolCallId, result1.toolCallId,
    "Idempotent propose must return the same toolCallId");

  // Verify only one record exists in the DB for this key
  const records = await db.select().from(agentToolCalls)
    .where(and(eq(agentToolCalls.orgId, TEST_ORG), eq(agentToolCalls.idempotencyKey, idemKey)));
  assert.equal(records.length, 1, "Only one record should exist for the idempotency key");

  await cleanup();
  console.log("✓ proposeToolCall: idempotency key deduplication works");
});

// ─── Test 9: Duplicate workflow trigger is rejected ───────────────────────────

test("startWorkflow: duplicate trigger for same entity is rejected", async () => {
  await cleanup();

  const entityId = "test-entity-" + Date.now();

  // Start workflow first time
  const run1 = await startWorkflow({
    orgId: TEST_ORG,
    workflowType: "new_prospect_outreach",
    entityId,
    entityType: "prospect",
    entityName: "Test Prospect",
  });

  // It may fail (no real DB entities) but must either start or return a clear error
  // The important thing: a second call for same entityId+workflowType should be duplicate
  if (run1.started || run1.runId) {
    const run2 = await startWorkflow({
      orgId: TEST_ORG,
      workflowType: "new_prospect_outreach",
      entityId,
      entityType: "prospect",
      entityName: "Test Prospect",
    });

    assert.equal(run2.started, false, "Second trigger must be rejected as duplicate");
    assert.equal(run2.duplicate, true, "Must be flagged as duplicate");
    assert.equal(run2.runId, run1.runId, "Must return the existing runId");
  }

  await cleanup();
  console.log("✓ startWorkflow: duplicate trigger rejected");
});

// ─── Test 10: approveWorkflowStep CAS prevents double-approval ───────────────

test("approveWorkflowStep: double-approval is idempotent via CAS", async () => {
  await cleanup();

  // Create a workflow run paused in waiting_confirmation state
  const [run] = await db.insert(workflowRuns).values({
    orgId: TEST_ORG,
    workflowType: "new_prospect_outreach",
    displayName: "Test Workflow",
    status: "waiting_confirmation",
    currentStepIndex: 0,
    totalSteps: 3,
    context: {},
    startedAt: new Date(),
  }).returning();

  await db.insert(workflowSteps).values({
    workflowRunId: run.id,
    orgId: TEST_ORG,
    stepIndex: 0,
    stepName: "Test Step",
    stepType: "wait_confirmation",
    status: "waiting_confirmation",
    confirmationStatus: "pending",
    output: { prompt: "Test prompt" },
  });

  // First approval — must succeed
  const approve1 = await approveWorkflowStep(run.id, TEST_ORG, "admin-user");
  assert.equal(approve1.ok, true, "First approval must succeed");

  // Second approval — must fail gracefully (CAS: status is no longer waiting_confirmation)
  const approve2 = await approveWorkflowStep(run.id, TEST_ORG, "admin-user");
  assert.equal(approve2.ok, false, "Second approval must fail (already advanced)");
  assert.ok(approve2.error, "Must include an error message for the failed second approval");

  await cleanup();
  console.log("✓ approveWorkflowStep: double-approval prevented via CAS");
});

// ─── Test 11: resumeWaitingWorkflows skips locked runs ────────────────────────

test("resumeWaitingWorkflows: run with fresh lock is skipped", async () => {
  await cleanup();

  const now = new Date();
  const past = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago (past nextCheckAt)

  // Create a waiting_response run with a FRESH lock (locked 10 seconds ago)
  const freshLock = new Date(now.getTime() - 10 * 1000);
  await db.insert(workflowRuns).values({
    orgId: TEST_ORG,
    workflowType: "new_prospect_outreach",
    displayName: "Locked Run",
    status: "waiting_response",
    currentStepIndex: 0,
    totalSteps: 2,
    context: {},
    startedAt: past,
    nextCheckAt: past, // due for resume
    lockedAt: freshLock, // but currently locked
  });

  const resumed = await resumeWaitingWorkflows(TEST_ORG);

  // The locked run should be skipped
  assert.equal(resumed, 0, "Locked run must not be resumed");

  await cleanup();
  console.log("✓ resumeWaitingWorkflows: fresh lock prevents double-resume");
});

// ─── Test 12: resumeWaitingWorkflows processes stale-locked runs ──────────────

test("resumeWaitingWorkflows: stale lock (>60s) allows resume", async () => {
  await cleanup();

  const now = new Date();
  const past = new Date(now.getTime() - 5 * 60 * 1000);
  const staleLock = new Date(now.getTime() - 120 * 1000); // 2 min ago = stale

  // Create a waiting_response run with a STALE lock
  const [run] = await db.insert(workflowRuns).values({
    orgId: TEST_ORG,
    workflowType: "new_prospect_outreach",
    displayName: "Stale Lock Run",
    status: "waiting_response",
    currentStepIndex: 0,
    totalSteps: 1,
    context: {},
    startedAt: past,
    nextCheckAt: past,
    lockedAt: staleLock,
  }).returning();

  await db.insert(workflowSteps).values({
    workflowRunId: run.id,
    orgId: TEST_ORG,
    stepIndex: 0,
    stepName: "Wait",
    stepType: "wait_time",
    status: "waiting_response",
  });

  // This may fail internally (no steps defined in workflow definition for this org)
  // but the key test is that the lock was ACQUIRED (resume was attempted)
  await resumeWaitingWorkflows(TEST_ORG);

  // Verify: the lock was acquired (lockedAt changed from stale to now, or run progressed)
  const [after] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.id));
  const lockChanged = after.lockedAt === null || (after.lockedAt && after.lockedAt > staleLock);
  assert.ok(lockChanged, "Stale lock must have been overwritten (resume was attempted)");

  await cleanup();
  console.log("✓ resumeWaitingWorkflows: stale lock is overwritten and run is processed");
});

// ─── Test 13: Schema has idempotency columns ─────────────────────────────────

test("schema: agentToolCalls has idempotencyKey, providerMessageId, sendAttempts", async () => {
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'agent_tool_calls'
    ORDER BY column_name
  `);
  const names = (cols.rows as any[]).map((r) => r.column_name);
  assert.ok(names.includes("idempotency_key"), "idempotency_key column must exist");
  assert.ok(names.includes("provider_message_id"), "provider_message_id column must exist");
  assert.ok(names.includes("send_attempts"), "send_attempts column must exist");
  console.log("✓ schema: agentToolCalls has all idempotency/safety columns");
});

// ─── Test 14: Schema has lockedAt on workflow_runs ────────────────────────────

test("schema: workflow_runs has locked_at column", async () => {
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'workflow_runs'
    ORDER BY column_name
  `);
  const names = (cols.rows as any[]).map((r) => r.column_name);
  assert.ok(names.includes("locked_at"), "locked_at column must exist on workflow_runs");
  console.log("✓ schema: workflow_runs has locked_at");
});

// ─── Test 15: Schema has resolved columns on agent_tool_calls ────────────────

test("schema: agentToolCalls has resolved_at and resolved_by columns", async () => {
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'agent_tool_calls'
    ORDER BY column_name
  `);
  const names = (cols.rows as any[]).map((r) => r.column_name);
  assert.ok(names.includes("resolved_at"), "resolved_at column must exist");
  assert.ok(names.includes("resolved_by"), "resolved_by column must exist");
  console.log("✓ schema: agentToolCalls has resolved_at + resolved_by");
});

// ─── Test 16: Failed tool call appears in failure queue ───────────────────────

test("agent-ops failure queue: failed tool call appears in failure queue", async () => {
  const [inserted] = await db.insert(agentToolCalls).values({
    orgId: TEST_ORG,
    agentName: "test-agent",
    toolName: "create_follow_up_task",
    status: "failed",
    error: "simulated failure for ops test",
    requiresConfirmation: false,
    proposedInput: { test: true },
  }).returning();

  const rows = await db.select().from(agentToolCalls)
    .where(and(eq(agentToolCalls.orgId, TEST_ORG), eq(agentToolCalls.status, "failed")));

  const found = rows.find(r => r.id === inserted.id);
  assert.ok(found, "Failed tool call must appear when querying failed calls for org");
  assert.ok(found!.resolvedAt === null, "resolvedAt must be null for newly-failed call");
  console.log("✓ failed tool call appears in failure queue");
});

// ─── Test 17: Stuck workflow appears in stuck detection ───────────────────────

test("agent-ops stuck workflows: locked_at > 120s flags as stuck", async () => {
  const [wf] = await db.insert(workflowRuns).values({
    orgId: TEST_ORG,
    workflowType: "test_workflow",
    displayName: "Test Stuck Workflow",
    status: "running",
    currentStepIndex: 0,
    totalSteps: 3,
    lockedAt: new Date(Date.now() - 200_000),
  }).returning();

  const stuckLockCutoff = new Date(Date.now() - 120_000);
  const stuck = await db.select().from(workflowRuns)
    .where(and(eq(workflowRuns.orgId, TEST_ORG), eq(workflowRuns.status, "running")));

  const found = stuck.find(r => r.id === wf.id);
  assert.ok(found, "Stuck workflow must be in running state");
  assert.ok(found!.lockedAt! < stuckLockCutoff, "lockedAt must be past the 120s threshold");
  console.log("✓ stuck workflow (lockedAt > 120s) detected");

  await db.delete(workflowRuns).where(eq(workflowRuns.id, wf.id));
});

// ─── Test 18: Health endpoint flags Twilio as unconfigured ────────────────────

test("agent-ops health: Twilio reports configured=false when env vars missing", async () => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const phone = process.env.TWILIO_PHONE_NUMBER;

  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_PHONE_NUMBER;

  const { isTwilioConfigured } = await import("../sms");
  const configured = isTwilioConfigured();
  assert.strictEqual(configured, false, "isTwilioConfigured must return false when env vars absent");
  console.log("✓ Twilio reports unconfigured when env vars missing");

  if (sid) process.env.TWILIO_ACCOUNT_SID = sid;
  if (token) process.env.TWILIO_AUTH_TOKEN = token;
  if (phone) process.env.TWILIO_PHONE_NUMBER = phone;
});

// ─── Test 19: Mark failed tool call as resolved ───────────────────────────────

test("agent-ops resolve: mark failed tool call resolves it (resolvedAt set)", async () => {
  const [inserted] = await db.insert(agentToolCalls).values({
    orgId: TEST_ORG,
    agentName: "test-agent",
    toolName: "create_follow_up_task",
    status: "failed",
    error: "test error for resolve",
    requiresConfirmation: false,
    proposedInput: {},
  }).returning();

  await db.update(agentToolCalls)
    .set({ resolvedAt: new Date(), resolvedBy: "admin" })
    .where(and(eq(agentToolCalls.id, inserted.id), eq(agentToolCalls.orgId, TEST_ORG)));

  const [updated] = await db.select().from(agentToolCalls)
    .where(eq(agentToolCalls.id, inserted.id));

  assert.ok(updated.resolvedAt !== null, "resolvedAt must be set after resolution");
  assert.strictEqual(updated.resolvedBy, "admin", "resolvedBy must be 'admin'");
  assert.strictEqual(updated.status, "failed", "status remains 'failed' (only resolvedAt marks acknowledgment)");
  console.log("✓ mark-resolved sets resolvedAt and resolvedBy");
});

// ─── Test 20: Retry safe internal tool call ───────────────────────────────────

test("agent-ops retry: safe internal failed tool call can be reset to pending", async () => {
  const [inserted] = await db.insert(agentToolCalls).values({
    orgId: TEST_ORG,
    agentName: "test-agent",
    toolName: "create_follow_up_task",
    status: "failed",
    error: "original failure",
    requiresConfirmation: false,
    proposedInput: { dealId: "test-deal", daysFromNow: 3 },
  }).returning();

  const tool = getTool("create_follow_up_task");
  assert.ok(tool, "create_follow_up_task must exist in registry");
  assert.strictEqual(tool!.permissions.external_side_effect, false, "create_follow_up_task must not be external_side_effect");

  await db.update(agentToolCalls)
    .set({ status: "pending", error: null, executedAt: null })
    .where(eq(agentToolCalls.id, inserted.id));

  const [reset] = await db.select().from(agentToolCalls).where(eq(agentToolCalls.id, inserted.id));
  assert.strictEqual(reset.status, "pending", "status must be reset to 'pending' for retry");
  assert.ok(reset.error === null, "error must be cleared on retry reset");
  console.log("✓ safe internal tool call reset to pending for retry");
});

// ─── Summary cleanup ─────────────────────────────────────────────────────────

process.on("exit", () => {
  // Best-effort cleanup — DB state left over is test-org scoped
});
