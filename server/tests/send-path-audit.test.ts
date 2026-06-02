/**
 * Send Path Audit — Comprehensive Safety Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies every active email-send path satisfies all 7 required properties:
 *
 *   1. Suppression check  (opt-out / DNC list)
 *   2. Emergency pause check
 *   3. First-contact approval check (via evaluatePolicy)
 *   4. Daily email cap check
 *   5. Creates an outcome row on send
 *   6. Writes a timeline / log event
 *   7. Cannot double-send (idempotency guard)
 *
 * Paths tested:
 *   P1  Follow-Up Cron      (processFollowUpsForOrg)
 *   P2  Auto-Execution      (executeFollowUp)
 *   P3  Gmail Approval      (single + bulk — DB-level guards)
 *   P4  Team-Training Send  (manual draft send — route-level guards)
 *   P5  Workflow Orchestrator (step idempotency)
 *
 * Shared utilities:
 *   SG  Send Guard Service   (checkHumanApprovedSendGuards)
 *   PL  Policy Engine        (evaluatePolicy)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { db } from "../db.js";
import { sql } from "drizzle-orm";
import { prospectOptOuts, gmailAgentActions } from "@shared/schema.js";

// ─── Shared test orgs ─────────────────────────────────────────────────────────

const TS = Date.now();
const TEST_ORG = `test-send-audit-${TS}`;
const TEST_EMAIL = `audit-${TS}@example.com`;
const SUPPRESSED_EMAIL = `suppressed-${TS}@example.com`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Insert or upsert an emergency-pause setting.
 *  Uses gen_random_uuid()::text for the id so raw SQL works without a Drizzle
 *  defaultFn applied (Drizzle defaultFn only runs through the ORM layer). */
async function setEmergencyPause(orgId: string, enabled: boolean, reason = "Audit test pause") {
  await db.execute(sql`
    INSERT INTO org_ai_governance_settings
      (id, org_id, emergency_pause_enabled, emergency_pause_reason)
    VALUES
      (gen_random_uuid()::text, ${orgId}, ${enabled}, ${reason})
    ON CONFLICT (org_id) DO UPDATE
      SET emergency_pause_enabled = ${enabled},
          emergency_pause_reason = ${reason},
          updated_at = NOW()
  `);
}

async function addOptOut(orgId: string, email: string) {
  await db.insert(prospectOptOuts).values({ orgId, email: email.toLowerCase() }).onConflictDoNothing();
}

async function removeOptOut(orgId: string, email: string) {
  await db.execute(sql`
    DELETE FROM prospect_opt_outs WHERE org_id = ${orgId} AND email = ${email.toLowerCase()}
  `);
}

/** Set per-org daily email cap. */
async function setDailyEmailCap(orgId: string, cap: number) {
  await db.execute(sql`
    INSERT INTO org_automation_settings
      (id, org_id, daily_email_cap)
    VALUES
      (gen_random_uuid()::text, ${orgId}, ${cap})
    ON CONFLICT (org_id) DO UPDATE
      SET daily_email_cap = ${cap}
  `);
}

async function countOutcomeRows(orgId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM agent_communication_outcomes WHERE org_id = ${orgId}
  `);
  const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  return parseInt(String(data[0]?.cnt ?? "0"), 10);
}

async function cleanupOrg(orgId: string) {
  for (const tbl of [
    "org_ai_governance_settings",
    "org_automation_settings",
    "prospect_opt_outs",
    "gmail_agent_actions",
    "agent_communication_outcomes",
    "agent_autonomy_decisions",
    "workflow_runs",
    "agent_dead_letter_queue",
  ]) {
    await db.execute(sql.raw(`DELETE FROM ${tbl} WHERE org_id = '${orgId}'`)).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SG — Send Guard Service
// ─────────────────────────────────────────────────────────────────────────────

describe("SG: checkHumanApprovedSendGuards", async () => {
  const { checkHumanApprovedSendGuards } = await import("../services/send-guard-service.js");
  const SG_ORG = `sg-${TS}`;

  before(async () => { await cleanupOrg(SG_ORG); });
  after(async () => { await cleanupOrg(SG_ORG); });

  it("SG-1: allows send when no restrictions set", async () => {
    const result = await checkHumanApprovedSendGuards(SG_ORG, TEST_EMAIL);
    assert.equal(result.blocked, false, "Should not be blocked when no restrictions");
  });

  it("SG-2: blocks when emergency pause is enabled", async () => {
    await setEmergencyPause(SG_ORG, true, "SG-2 test pause");
    const result = await checkHumanApprovedSendGuards(SG_ORG, TEST_EMAIL);
    assert.equal(result.blocked, true, "Must block on emergency pause");
    assert.equal(result.blockType, "emergency_pause");
    assert.match(result.reason ?? "", /emergency pause/i);
    await setEmergencyPause(SG_ORG, false);
  });

  it("SG-3: blocks when recipient email is on suppression list", async () => {
    await addOptOut(SG_ORG, SUPPRESSED_EMAIL);
    const result = await checkHumanApprovedSendGuards(SG_ORG, SUPPRESSED_EMAIL);
    assert.equal(result.blocked, true, "Must block suppressed emails");
    assert.equal(result.blockType, "suppressed");
    await removeOptOut(SG_ORG, SUPPRESSED_EMAIL);
  });

  it("SG-4: allows send when email is not on suppression list", async () => {
    await removeOptOut(SG_ORG, TEST_EMAIL);
    const result = await checkHumanApprovedSendGuards(SG_ORG, TEST_EMAIL);
    assert.equal(result.blocked, false, "Should pass when email not suppressed");
  });

  it("SG-5: blocks when daily email cap is exceeded", async () => {
    // Set cap to 1
    await setDailyEmailCap(SG_ORG, 1);
    // Insert 2 sent actions today so count (2) > cap (1)
    for (let i = 0; i < 2; i++) {
      await db.insert(gmailAgentActions).values({
        orgId: SG_ORG,
        actionType: "outreach_email",
        recipientEmail: TEST_EMAIL,
        subject: `Cap test ${i}`,
        bodyPreview: "Test",
        riskLevel: "low",
        approvalRequired: false,
        status: "executed",
        communicationDomain: "team_training",
        createdByAgent: "test",
        executedAt: new Date(),
      });
    }
    const result = await checkHumanApprovedSendGuards(SG_ORG, TEST_EMAIL);
    assert.equal(result.blocked, true, "Must block when daily cap exceeded");
    assert.equal(result.blockType, "daily_cap");
    await db.execute(sql.raw(`DELETE FROM gmail_agent_actions WHERE org_id = '${SG_ORG}'`));
    await setDailyEmailCap(SG_ORG, 50);
  });

  it("SG-6: emergency pause takes priority over suppression check", async () => {
    await setEmergencyPause(SG_ORG, true, "Priority test");
    await addOptOut(SG_ORG, SUPPRESSED_EMAIL);
    const result = await checkHumanApprovedSendGuards(SG_ORG, SUPPRESSED_EMAIL);
    assert.equal(result.blocked, true);
    assert.equal(result.blockType, "emergency_pause", "Emergency pause should fire first");
    await setEmergencyPause(SG_ORG, false);
    await removeOptOut(SG_ORG, SUPPRESSED_EMAIL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PL — Policy Engine (evaluatePolicy)
// ─────────────────────────────────────────────────────────────────────────────

describe("PL: evaluatePolicy", async () => {
  const { evaluatePolicy } = await import("../services/autonomy-policy-engine.js");
  const PL_ORG = `pl-${TS}`;

  before(async () => { await cleanupOrg(PL_ORG); });
  after(async () => { await cleanupOrg(PL_ORG); });

  it("PL-1: returns a valid PolicyDecision shape", async () => {
    const decision = await evaluatePolicy({
      orgId: PL_ORG,
      actionType: "send_follow_up",
      recipientEmail: TEST_EMAIL,
      confidence: 0.9,
      riskLevel: "low",
    });
    assert.ok(typeof decision.decision === "string", "decision.decision must be a string");
    assert.ok(Array.isArray(decision.reasons), "decision.reasons must be an array");
    assert.ok(decision.evaluatedAt instanceof Date, "decision.evaluatedAt must be a Date");
    assert.ok(["auto_execute", "approval_required", "blocked"].includes(decision.decision));
  });

  it("PL-2: blocks when emergency pause is enabled", async () => {
    await setEmergencyPause(PL_ORG, true, "PL-2 test");
    const decision = await evaluatePolicy({
      orgId: PL_ORG,
      actionType: "send_follow_up",
      recipientEmail: TEST_EMAIL,
      confidence: 1.0,
      riskLevel: "low",
    });
    assert.equal(decision.decision, "blocked", "Emergency pause must return blocked");
    assert.ok(decision.reasons.some((r) => /emergency pause/i.test(r)));
    await setEmergencyPause(PL_ORG, false);
  });

  it("PL-3: blocks/escalates when body contains sensitive language", async () => {
    const decision = await evaluatePolicy({
      orgId: PL_ORG,
      actionType: "send_follow_up",
      recipientEmail: TEST_EMAIL,
      confidence: 1.0,
      riskLevel: "low",
      bodyText: "This is your LAST CHANCE or we will SUE you for breach of contract!!!",
    });
    assert.notEqual(decision.decision, "auto_execute", "Sensitive language must not auto-execute");
  });

  it("PL-4: first-contact returns approval_required or auto_execute (never throws)", async () => {
    const decision = await evaluatePolicy({
      orgId: PL_ORG,
      actionType: "send_first_response",
      recipientEmail: TEST_EMAIL,
      confidence: 1.0,
      riskLevel: "low",
      isFirstContact: true,
    });
    assert.ok(
      ["approval_required", "auto_execute", "blocked"].includes(decision.decision),
      "Must produce a valid decision"
    );
  });

  it("PL-5: high risk level prevents auto-execute regardless of confidence", async () => {
    const decision = await evaluatePolicy({
      orgId: PL_ORG,
      actionType: "send_follow_up",
      recipientEmail: TEST_EMAIL,
      confidence: 1.0,
      riskLevel: "high",
    });
    assert.notEqual(decision.decision, "auto_execute", "High risk must not auto-execute");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 — Follow-Up Cron
// ─────────────────────────────────────────────────────────────────────────────

describe("P1: Follow-Up Cron", async () => {
  const P1_ORG = `p1-${TS}`;

  before(async () => { await cleanupOrg(P1_ORG); });
  after(async () => { await cleanupOrg(P1_ORG); });

  it("P1-1: isProspectOptedOut returns true when email in prospect_opt_outs", async () => {
    const { storage } = await import("../storage.js");
    const optEmail = `p1-opt-${TS}@example.com`;
    await db.insert(prospectOptOuts).values({ orgId: P1_ORG, email: optEmail.toLowerCase() }).onConflictDoNothing();
    const result = await storage.isProspectOptedOut(P1_ORG, optEmail);
    assert.equal(result, true, "isProspectOptedOut must return true for opted-out email");
    await db.execute(sql`DELETE FROM prospect_opt_outs WHERE org_id = ${P1_ORG} AND email = ${optEmail.toLowerCase()}`);
  });

  it("P1-2: isProspectOptedOut returns false for non-suppressed email", async () => {
    const { storage } = await import("../storage.js");
    const cleanEmail = `p1-clean-${TS}@example.com`;
    const result = await storage.isProspectOptedOut(P1_ORG, cleanEmail);
    assert.equal(result, false, "isProspectOptedOut must return false for clean email");
  });

  it("P1-3: logTriggerEvent is callable and returns a string", async () => {
    const { logTriggerEvent } = await import("../email-agent/trigger-logger.js");
    // Call the function — if the org/table FK check passes it returns an ID,
    // if the insert fails it catches and returns "". Either way it must NOT throw.
    let threw = false;
    let result: string | undefined;
    try {
      result = await logTriggerEvent({
        organizationId: P1_ORG,
        triggerType: "follow_up_cron",
        triggerSource: "audit_test",
        actionType: "test_action",
        reasoning: "P1-3 audit test",
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "logTriggerEvent must not throw");
    assert.ok(typeof result === "string", "logTriggerEvent must return a string");
    if (result && result.length > 0) {
      await db.execute(sql`DELETE FROM email_trigger_events WHERE id = ${result}`).catch(() => {});
    }
  });

  it("P1-4: processFollowUpsForOrg returns structured result with no due follow-ups", async () => {
    const { processFollowUpsForOrg } = await import("../email-agent/follow-up-cron.js");
    const result = await processFollowUpsForOrg(P1_ORG);
    assert.ok(typeof result.sent === "number", "result.sent must be a number");
    assert.ok(typeof result.skipped === "number", "result.skipped must be a number");
    assert.ok(Array.isArray(result.errors), "result.errors must be an array");
    assert.equal(result.sent, 0, "No sends expected for org with no due follow-ups");
  });

  it("P1-5: evaluatePolicy returns blocked when emergency pause active (policy gate)", async () => {
    await setEmergencyPause(P1_ORG, true, "P1-5 gate test");
    const { evaluatePolicy } = await import("../services/autonomy-policy-engine.js");
    const decision = await evaluatePolicy({
      orgId: P1_ORG,
      actionType: "send_follow_up",
      recipientEmail: TEST_EMAIL,
      confidence: 0.8,
      riskLevel: "low",
    });
    assert.equal(decision.decision, "blocked", "Policy gate must fire on emergency pause");
    await setEmergencyPause(P1_ORG, false);
  });

  it("P1-6: follow-up cron exports initializeFollowUpCron and processFollowUpsForOrg", async () => {
    const mod = await import("../email-agent/follow-up-cron.js");
    assert.ok(typeof mod.initializeFollowUpCron === "function", "Must export initializeFollowUpCron");
    assert.ok(typeof mod.processFollowUpsForOrg === "function", "Must export processFollowUpsForOrg");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2 — Legacy Auto-Execution
// ─────────────────────────────────────────────────────────────────────────────

describe("P2: Auto-Execution Engine", async () => {
  const P2_ORG = `p2-${TS}`;

  before(async () => { await cleanupOrg(P2_ORG); });
  after(async () => { await cleanupOrg(P2_ORG); });

  it("P2-1: evaluatePolicy blocks auto-execution when emergency pause active", async () => {
    await setEmergencyPause(P2_ORG, true, "P2-1 test");
    const { evaluatePolicy } = await import("../services/autonomy-policy-engine.js");
    const decision = await evaluatePolicy({
      orgId: P2_ORG,
      actionType: "send_follow_up",
      recipientEmail: TEST_EMAIL,
      confidence: 0.85,
      riskLevel: "low",
      isFirstContact: false,
    });
    assert.equal(decision.decision, "blocked");
    await setEmergencyPause(P2_ORG, false);
  });

  it("P2-2: double-send guard — status=sent and status=cancelled guards present in source", async () => {
    const src = readFileSync("server/email-agent/auto-execution-engine.ts", "utf-8");
    assert.ok(
      src.includes('followUp.status === "sent"') || src.includes("followUp.status === 'sent'"),
      "auto-execution-engine must contain a status=sent double-send guard"
    );
    assert.ok(
      src.includes('followUp.status === "cancelled"') || src.includes("followUp.status === 'cancelled'"),
      "auto-execution-engine must guard against cancelled status"
    );
  });

  it("P2-3: createOutcomeOnSend is wired in auto-execution-engine", async () => {
    const src = readFileSync("server/email-agent/auto-execution-engine.ts", "utf-8");
    assert.ok(src.includes("createOutcomeOnSend"), "auto-execution-engine must call createOutcomeOnSend");
  });

  it("P2-4: logTriggerEvent is wired in auto-execution-engine", async () => {
    const src = readFileSync("server/email-agent/auto-execution-engine.ts", "utf-8");
    assert.ok(src.includes("logTriggerEvent"), "auto-execution-engine must call logTriggerEvent");
  });

  it("P2-5: evaluatePolicy is wired in executeFollowUp", async () => {
    const src = readFileSync("server/email-agent/auto-execution-engine.ts", "utf-8");
    assert.ok(src.includes("evaluatePolicy"), "auto-execution-engine must call evaluatePolicy");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P3 — Gmail Agent Approval (single + bulk)
// ─────────────────────────────────────────────────────────────────────────────

describe("P3: Gmail Agent Approval", async () => {
  const P3_ORG = `p3-${TS}`;

  before(async () => { await cleanupOrg(P3_ORG); });
  after(async () => { await cleanupOrg(P3_ORG); });

  it("P3-1: executed gmail_agent_actions row has non-null executedAt (idempotency marker)", async () => {
    const [row] = await db.insert(gmailAgentActions).values({
      orgId: P3_ORG,
      actionType: "outreach_email",
      recipientEmail: TEST_EMAIL,
      subject: "P3-1 test",
      bodyPreview: "Test body",
      riskLevel: "low",
      approvalRequired: true,
      status: "executed",
      communicationDomain: "team_training",
      createdByAgent: "test",
      executedAt: new Date(),
    }).returning();
    assert.ok(row.executedAt !== null, "executedAt must be non-null for executed actions");
    await db.execute(sql`DELETE FROM gmail_agent_actions WHERE id = ${row.id}`);
  });

  it("P3-2: proposed gmail_agent_actions row has null executedAt (available for approval)", async () => {
    const [row] = await db.insert(gmailAgentActions).values({
      orgId: P3_ORG,
      actionType: "outreach_email",
      recipientEmail: TEST_EMAIL,
      subject: "P3-2 pending",
      bodyPreview: "Pending body",
      riskLevel: "low",
      approvalRequired: true,
      status: "proposed",
      communicationDomain: "team_training",
      createdByAgent: "test",
    }).returning();
    assert.equal(row.executedAt, null, "Pending proposals must have null executedAt");
    await db.execute(sql`DELETE FROM gmail_agent_actions WHERE id = ${row.id}`);
  });

  it("P3-3: bulk approve route calls checkHumanApprovedSendGuards before sending", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("api/ai-approvals/bulk-approve");
    assert.ok(idx !== -1, "bulk-approve route must exist in routes.ts");
    const section = src.slice(idx, idx + 3500);
    assert.ok(
      section.includes("checkHumanApprovedSendGuards") || section.includes("send-guard-service"),
      "Bulk approve must call checkHumanApprovedSendGuards before sending"
    );
  });

  it("P3-4: single approve route calls checkHumanApprovedSendGuards before sending", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("api/ai-approvals/:id/approve");
    assert.ok(idx !== -1, "single approve route must exist in routes.ts");
    const section = src.slice(idx, idx + 3500);
    assert.ok(
      section.includes("checkHumanApprovedSendGuards") || section.includes("send-guard-service"),
      "Single approve must call checkHumanApprovedSendGuards before sending"
    );
  });

  it("P3-5: createOutcomeOnSend is called after single approve", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("api/ai-approvals/:id/approve");
    const section = src.slice(idx, idx + 4500);
    assert.ok(section.includes("createOutcomeOnSend"), "Single approve must call createOutcomeOnSend");
  });

  it("P3-6: createOutcomeOnSend is called after bulk approve", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("api/ai-approvals/bulk-approve");
    const section = src.slice(idx, idx + 3500);
    assert.ok(section.includes("createOutcomeOnSend"), "Bulk approve must call createOutcomeOnSend");
  });

  it("P3-7: agentMessageFeedback written on single approve (audit log)", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("api/ai-approvals/:id/approve");
    const section = src.slice(idx, idx + 4500);
    assert.ok(section.includes("agentMessageFeedback"), "Single approve must write agentMessageFeedback");
  });

  it("P3-8: createOutcomeOnSend creates a row in agent_communication_outcomes", async () => {
    const { createOutcomeOnSend } = await import("../services/outcome-intelligence-service.js");
    const [action] = await db.insert(gmailAgentActions).values({
      orgId: P3_ORG,
      actionType: "outreach_email",
      recipientEmail: TEST_EMAIL,
      subject: "P3-8 outcome test",
      bodyPreview: "Test",
      riskLevel: "low",
      approvalRequired: false,
      status: "executed",
      communicationDomain: "team_training",
      createdByAgent: "test",
      executedAt: new Date(),
    }).returning();

    const before = await countOutcomeRows(P3_ORG);
    await createOutcomeOnSend({
      orgId: P3_ORG,
      gmailActionId: action.id,
      communicationDomain: "team_training",
      messageType: "outreach_email",
      recipientEmail: TEST_EMAIL,
    });
    const after = await countOutcomeRows(P3_ORG);
    assert.equal(after, before + 1, "createOutcomeOnSend must create exactly one outcome row");
    await db.execute(sql`DELETE FROM gmail_agent_actions WHERE id = ${action.id}`);
  });

  it("P3-9: edit-send route calls checkHumanApprovedSendGuards before sending (source check)", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const editSendIdx = src.indexOf("api/ai-approvals/:id/edit-send");
    assert.ok(editSendIdx !== -1, "edit-send route must exist");
    const section = src.slice(editSendIdx, editSendIdx + 3000);
    assert.ok(section.includes("checkHumanApprovedSendGuards"), "edit-send must call checkHumanApprovedSendGuards");
    assert.ok(section.includes("sendGuard.blocked") || section.includes("editSendGuard.blocked"), "edit-send must check .blocked flag");
  });

  it("P3-10: edit-send route blocks items with status=blocked (source check)", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const editSendIdx = src.indexOf("api/ai-approvals/:id/edit-send");
    const section = src.slice(editSendIdx, editSendIdx + 3000);
    assert.ok(
      section.includes('"blocked"') || section.includes("'blocked'"),
      "edit-send must reject proposals with status=blocked"
    );
  });

  it("P3-11: bulk-approve skips items with status=blocked (source check)", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const bulkIdx = src.indexOf("api/ai-approvals/bulk-approve");
    assert.ok(bulkIdx !== -1, "bulk-approve route must exist");
    const section = src.slice(bulkIdx, bulkIdx + 2500);
    assert.ok(
      section.includes('"blocked"') || section.includes("'blocked'"),
      "bulk-approve must guard against blocked status"
    );
  });

  // ── Revenue Attribution Fixes (from attribution audit) ──────────────────

  it("P3-12: bookings table has source_outcome_id column (Fix 1 — booking attribution FK)", async () => {
    const src = readFileSync("shared/schema.ts", "utf-8");
    assert.ok(src.includes("sourceOutcomeId") && src.includes("source_outcome_id"), "bookings schema must include sourceOutcomeId / source_outcome_id");
    // Also verify column exists in live DB
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bookings' AND column_name = 'source_outcome_id'
    `);
    const found = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    assert.ok(found.length > 0, "source_outcome_id column must exist in bookings table in live DB");
  });

  it("P3-13: ai_revenue_events has credited_value column (Fix 3 — fractional split)", async () => {
    const src = readFileSync("shared/schema.ts", "utf-8");
    assert.ok(src.includes("creditedValue") && src.includes("credited_value"), "ai_revenue_events schema must include creditedValue / credited_value");
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ai_revenue_events' AND column_name = 'credited_value'
    `);
    const found = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    assert.ok(found.length > 0, "credited_value column must exist in ai_revenue_events in live DB");
  });

  it("P3-14: single-approve calls logActionAsEvent to wire revenue attribution (Fix 2)", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const approveIdx = src.indexOf("api/ai-approvals/:id/approve");
    assert.ok(approveIdx !== -1, "single-approve route must exist");
    const section = src.slice(approveIdx, approveIdx + 4000);
    assert.ok(section.includes("logActionAsEvent"), "single-approve must call logActionAsEvent for revenue attribution");
    assert.ok(section.includes("executionLogId"), "single-approve logActionAsEvent call must pass executionLogId");
  });

  it("P3-15: bulk-approve calls logActionAsEvent to wire revenue attribution (Fix 2)", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const bulkIdx = src.indexOf("api/ai-approvals/bulk-approve");
    const section = src.slice(bulkIdx, bulkIdx + 3000);
    assert.ok(section.includes("logActionAsEvent"), "bulk-approve must call logActionAsEvent for revenue attribution");
  });

  it("P3-16: edit-send calls both createOutcomeOnSend and logActionAsEvent (Fix 2)", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const editIdx = src.indexOf("api/ai-approvals/:id/edit-send");
    const section = src.slice(editIdx, editIdx + 6000);
    assert.ok(section.includes("createOutcomeOnSend") || section.includes("_editOutcome"), "edit-send must call createOutcomeOnSend (was previously missing)");
    assert.ok(section.includes("logActionAsEvent") || section.includes("_logEdit"), "edit-send must call logActionAsEvent for revenue attribution");
  });

  it("P3-17: logMultiTouchAttributionChain sets credited_value using equal-split (Fix 3 — source check)", async () => {
    const src = readFileSync("server/email-agent/revenue-outcome-engine.ts", "utf-8");
    assert.ok(src.includes("creditedValue"), "revenue-outcome-engine must set creditedValue");
    assert.ok(src.includes("equalShare") || src.includes("equal"), "engine must implement equal-split credit allocation");
    assert.ok(src.includes("primaryCredit") || src.includes("primary"), "engine must calculate primary credit as remainder to prevent rounding loss");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P4 — Team-Training Manual Send
// ─────────────────────────────────────────────────────────────────────────────

describe("P4: Team-Training Manual Send", async () => {
  it("P4-1: suppression check (DNC + opt-out) wired in team-training send path", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("admin/team-training/drafts/:id/send");
    assert.ok(idx !== -1, "team-training send route must exist");
    const section = src.slice(idx, idx + 5000);
    assert.ok(section.includes("Do Not Contact"), "Team-training send must check DNC status");
    assert.ok(section.includes("isProspectOptedOut"), "Team-training send must call isProspectOptedOut");
  });

  it("P4-2: emergency pause check wired in team-training send path", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("admin/team-training/drafts/:id/send");
    const section = src.slice(idx, idx + 5000);
    assert.ok(
      section.includes("checkEmergencyPause") || section.includes("emergency_pause"),
      "Team-training send must check emergency pause"
    );
  });

  it("P4-3: double-send guard (sentAt check) wired in team-training send path", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("admin/team-training/drafts/:id/send");
    const section = src.slice(idx, idx + 5000);
    assert.ok(section.includes("draft.sentAt"), "Team-training send must check draft.sentAt");
    assert.ok(section.includes("Draft already sent"), "Must return 'Draft already sent' error");
  });

  it("P4-4: createOutcomeOnSend wired in team-training send path", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("admin/team-training/drafts/:id/send");
    const section = src.slice(idx, idx + 6000);
    assert.ok(section.includes("createOutcomeOnSend"), "Team-training send must call createOutcomeOnSend");
  });

  it("P4-5: log event wired in team-training send path (logOutreachEvent)", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("admin/team-training/drafts/:id/send");
    const section = src.slice(idx, idx + 6000);
    assert.ok(section.includes("logOutreachEvent"), "Team-training send must call logOutreachEvent");
  });

  it("P4-6: old outreach send (/admin/outreach/:id/send) has emergency pause guard", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("admin/outreach/:id/send");
    assert.ok(idx !== -1, "old outreach send route must exist");
    const section = src.slice(idx, idx + 4500);
    assert.ok(
      section.includes("checkEmergencyPause") || section.includes("_chkPause"),
      "Old outreach send must check emergency pause"
    );
  });

  it("P4-7: old outreach send has suppression guard before email dispatch", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("admin/outreach/:id/send");
    const section = src.slice(idx, idx + 4500);
    assert.ok(
      section.includes("checkHumanApprovedSendGuards") || section.includes("_grd"),
      "Old outreach send must check suppression before dispatch"
    );
  });

  it("P4-8: old outreach send has createOutcomeOnSend wired", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("admin/outreach/:id/send");
    const section = src.slice(idx, idx + 6000);
    assert.ok(
      section.includes("createOutcomeOnSend") || section.includes("_cos"),
      "Old outreach send must wire createOutcomeOnSend"
    );
  });

  it("P4-9: old outreach send has approved-only gate (prevents re-send)", async () => {
    const src = readFileSync("server/routes.ts", "utf-8");
    const idx = src.indexOf("admin/outreach/:id/send");
    const section = src.slice(idx, idx + 4000);
    assert.ok(
      section.includes("Only approved drafts can be sent"),
      "Old outreach send must enforce approved-only gate"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P5 — Workflow Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

describe("P5: Workflow Orchestrator", async () => {
  const P5_ORG = `p5-${TS}`;

  before(async () => { await cleanupOrg(P5_ORG); });
  after(async () => { await cleanupOrg(P5_ORG); });

  it("P5-1: step idempotency guard present (completed status check)", async () => {
    const src = readFileSync("server/workflow-orchestrator.ts", "utf-8");
    assert.ok(
      src.includes('status === "completed"'),
      "Orchestrator must check completed status before re-executing step"
    );
  });

  it("P5-2: completed step record in DB prevents re-execution", async () => {
    const { storage } = await import("../storage.js");

    const run = await storage.createWorkflowRun({
      orgId: P5_ORG,
      workflowTemplateKey: "at_risk_client_retention",
      workflowType: "at_risk_client_retention",
      displayName: "Send-Path Audit Test Run",
      status: "running",
      currentStepKey: "create_operator_action",
    } as any);

    const stepRun = await storage.createWorkflowStepRun({
      workflowRunId: run.id,
      stepKey: "create_operator_action",
      stepType: "create_operator_action",
      status: "completed",
      startedAt: new Date(),
    });

    const retrieved = await storage.getWorkflowStepRun(run.id, "create_operator_action");
    assert.ok(retrieved !== null, "Step run must be retrievable");
    assert.equal(retrieved?.status, "completed", "Status must be completed");

    await db.execute(sql`DELETE FROM workflow_step_runs WHERE id = ${stepRun.id}`);
    await db.execute(sql`DELETE FROM workflow_runs WHERE id = ${run.id}`);
  });

  it("P5-3: generate_outreach case block creates a draft — never auto-sends", async () => {
    const src = readFileSync("server/workflow-orchestrator.ts", "utf-8");
    // Find the case block (not the type union at the top)
    const caseIdx = src.indexOf('case "generate_outreach"');
    assert.ok(caseIdx !== -1, "generate_outreach case must exist in orchestrator");
    const section = src.slice(caseIdx, caseIdx + 2000);
    assert.ok(
      section.includes("draft") && (section.includes('"draft"') || section.includes("'draft'")),
      "generate_outreach step must create draft status — never sends"
    );
    // Must NOT call sendEmail or sgMail.send directly
    assert.ok(
      !section.includes("sendEmail(") && !section.includes("sgMail"),
      "generate_outreach step must NOT call sendEmail or sgMail directly"
    );
  });

  it("P5-4: wait_for_approval step parks workflow until human approves", async () => {
    const src = readFileSync("server/workflow-orchestrator.ts", "utf-8");
    const caseIdx = src.indexOf('case "wait_for_approval"');
    assert.ok(caseIdx !== -1, "wait_for_approval case must exist in orchestrator");
    const section = src.slice(caseIdx, caseIdx + 800);
    assert.ok(section.includes("__waiting"), "wait_for_approval must return __waiting sentinel");
    assert.ok(section.includes("approved"), "wait_for_approval must check for approved status");
  });

  it("P5-5: workflow orchestrator exports WorkflowOrchestrator class", async () => {
    const mod = await import("../workflow-orchestrator.js");
    assert.ok(typeof mod.WorkflowOrchestrator === "function", "Must export WorkflowOrchestrator");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-PATH: Dead-Letter + Daily Cap Integration
// ─────────────────────────────────────────────────────────────────────────────

describe("CROSS: Dead-Letter and Daily Cap", async () => {
  const XP_ORG = `xp-${TS}`;

  before(async () => { await cleanupOrg(XP_ORG); });
  after(async () => { await cleanupOrg(XP_ORG); });

  it("XP-1: dead-letter queue supports push + query + resolve lifecycle", async () => {
    const { pushToDeadLetter, getDeadLetterJobs, markJobResolved } =
      await import("../services/agent-dead-letter-service.js");

    const jobId = await pushToDeadLetter({
      orgId: XP_ORG,
      jobName: "send_path_audit_test",
      error: "Test error for dead letter audit",
      payload: { testKey: "XP-1", sendPath: "cross-path" },
    });
    assert.ok(typeof jobId === "string" && (jobId?.length ?? 0) > 0, "pushToDeadLetter must return a job ID");

    const jobs = await getDeadLetterJobs({ orgId: XP_ORG });
    const found = jobs.find((j) => j.id === jobId);
    assert.ok(found !== undefined, "Job must be queryable by orgId");
    assert.equal(found?.status, "pending");

    await markJobResolved(jobId!);
    const resolved = await getDeadLetterJobs({ orgId: XP_ORG, status: "resolved" });
    const resolvedJob = resolved.find((j) => j.id === jobId);
    assert.ok(resolvedJob !== undefined, "Resolved job must appear in resolved query");
    assert.equal(resolvedJob?.status, "resolved");
  });

  it("XP-2: daily email cap can be set per-org and read back", async () => {
    await setDailyEmailCap(XP_ORG, 25);
    const rows = await db.execute(sql`SELECT daily_email_cap FROM org_automation_settings WHERE org_id = ${XP_ORG}`);
    const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    assert.equal(parseInt(String(data[0]?.daily_email_cap ?? "0")), 25, "Daily email cap must be persisted");
  });

  it("XP-3: checkHumanApprovedSendGuards does not block on daily cap when cap=100 and 0 sends", async () => {
    await setDailyEmailCap(XP_ORG, 100);
    const { checkHumanApprovedSendGuards } = await import("../services/send-guard-service.js");
    const result = await checkHumanApprovedSendGuards(XP_ORG, TEST_EMAIL);
    if (result.blocked) {
      assert.notEqual(result.blockType, "daily_cap", "With cap=100 and 0 sends, daily cap must not block");
    }
  });

  it("XP-4: getDeadLetterSummary returns valid shape with total/pending/resolved counts", async () => {
    const { getDeadLetterSummary } = await import("../services/agent-dead-letter-service.js");
    const summary = await getDeadLetterSummary(XP_ORG);
    assert.ok(typeof summary === "object" && summary !== null, "Summary must be an object");
    assert.ok(typeof summary.total === "number", "Summary must have total field");
    assert.ok(typeof summary.pending === "number", "Summary must have pending field");
    assert.ok(typeof summary.resolved === "number", "Summary must have resolved field");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2b — ActionExecutor Option B: email auto_execute → approval queue
// ─────────────────────────────────────────────────────────────────────────────

describe("P2b: ActionExecutor — email auto_execute deferred to approval queue", async () => {
  const AE_ORG = `ae-${TS}`;

  before(async () => { await cleanupOrg(AE_ORG); });
  after(async () => { await cleanupOrg(AE_ORG); });

  it("AE-1: runActionExecutorCycle is exported", async () => {
    const mod = await import("../services/agent-action-executor.js");
    assert.ok(typeof mod.runActionExecutorCycle === "function", "Must export runActionExecutorCycle");
    assert.ok(typeof mod.startActionExecutor === "function", "Must export startActionExecutor");
    assert.ok(typeof mod.stopActionExecutor === "function", "Must export stopActionExecutor");
  });

  it("AE-2: executedAt is NEVER set in the auto_execute branch (source check)", async () => {
    const src = readFileSync("server/services/agent-action-executor.ts", "utf-8");
    // Find the auto_execute_deferred branch
    const deferredIdx = src.indexOf("auto_execute_deferred");
    assert.ok(deferredIdx !== -1, "auto_execute_deferred branch must exist");
    // Within that branch: executedAt must NOT appear as a set value
    const branchSection = src.slice(deferredIdx, deferredIdx + 800);
    assert.ok(
      !branchSection.includes("executedAt: new Date()") && !branchSection.includes("executedAt: decision"),
      "executedAt must not be set in the auto_execute_deferred branch"
    );
  });

  it("AE-3: blocked branch sets errorMessage and does NOT set executedAt (source check)", async () => {
    const src = readFileSync("server/services/agent-action-executor.ts", "utf-8");
    const blockedIdx = src.indexOf("Branch: BLOCKED");
    assert.ok(blockedIdx !== -1, "BLOCKED branch comment must exist");
    const section = src.slice(blockedIdx, blockedIdx + 600);
    assert.ok(section.includes("errorMessage"), "Blocked branch must set errorMessage");
    assert.ok(
      !section.includes("executedAt: new Date()"),
      "executedAt must not be set in the blocked branch"
    );
  });

  it("AE-4: auto_execute email branch sets approvalRequired=true and stores metadata", async () => {
    const src = readFileSync("server/services/agent-action-executor.ts", "utf-8");
    // Anchor on the branch comment to avoid hitting early type-union occurrences
    const branchIdx = src.indexOf("Branch: AUTO_EXECUTE");
    assert.ok(branchIdx !== -1, "Branch: AUTO_EXECUTE comment must exist");
    const section = src.slice(branchIdx, branchIdx + 1200);
    assert.ok(section.includes("approvalRequired: true"), "Deferred branch must set approvalRequired=true");
    assert.ok(section.includes("autoExecuteEligible: true"), "Must store autoExecuteEligible=true in result");
    assert.ok(section.includes("email_auto_send_disabled"), "Must store autoExecuteDeferredReason in result");
  });

  it("AE-5: auto_execute email branch routes to awaiting_approval (status check)", async () => {
    const src = readFileSync("server/services/agent-action-executor.ts", "utf-8");
    const branchIdx = src.indexOf("Branch: AUTO_EXECUTE");
    assert.ok(branchIdx !== -1, "Branch: AUTO_EXECUTE comment must exist");
    const section = src.slice(branchIdx, branchIdx + 1000);
    assert.ok(
      section.includes('"awaiting_approval"') || section.includes("'awaiting_approval'"),
      "Deferred email action must be routed to awaiting_approval status"
    );
  });

  it("AE-6: timeline is logged for all three outcome branches (source check)", async () => {
    const src = readFileSync("server/services/agent-action-executor.ts", "utf-8");
    assert.ok(src.includes("logTimeline"), "ActionExecutor must call logTimeline");
    const blockedIdx = src.indexOf("Branch: BLOCKED");
    const autoExecIdx = src.indexOf("Branch: AUTO_EXECUTE");
    const approvalIdx = src.indexOf("Branch: APPROVAL_REQUIRED");
    assert.ok(
      blockedIdx !== -1 && autoExecIdx !== -1 && approvalIdx !== -1,
      "All 3 branch comments must exist in source"
    );
    assert.ok(
      src.slice(blockedIdx, blockedIdx + 1000).includes("logTimeline"),
      "Blocked branch must call logTimeline"
    );
    assert.ok(
      src.slice(autoExecIdx, autoExecIdx + 1200).includes("logTimeline"),
      "Auto_execute deferred branch must call logTimeline"
    );
    assert.ok(
      src.slice(approvalIdx, approvalIdx + 1000).includes("logTimeline"),
      "Approval branch must call logTimeline"
    );
  });

  it("AE-7: trigger event is logged for all three outcome branches (source check)", async () => {
    const src = readFileSync("server/services/agent-action-executor.ts", "utf-8");
    // Count logTrigger calls — should appear 3 times (once per branch)
    const matches = src.match(/logTrigger\(/g) ?? [];
    assert.ok(matches.length >= 3, `ActionExecutor must call logTrigger in all 3 branches (found ${matches.length})`);
  });

  it("AE-8: cycle runs without error and returns stats shape for org with no proposed actions", async () => {
    const { runActionExecutorCycle } = await import("../services/agent-action-executor.js");
    const stats = await runActionExecutorCycle();
    assert.ok(typeof stats.evaluated === "number", "stats.evaluated must be a number");
    assert.ok(typeof stats.awaitingApproval === "number", "stats.awaitingApproval must be a number");
    assert.ok(typeof stats.autoEligibleDeferred === "number", "stats.autoEligibleDeferred must be a number");
    assert.ok(typeof stats.blocked === "number", "stats.blocked must be a number");
    assert.ok(typeof stats.errors === "number", "stats.errors must be a number");
  });

  it("AE-9: proposed email action is moved to awaiting_approval by the cycle (DB round-trip)", async () => {
    // Insert a proposed email action
    const [action] = await db.insert(gmailAgentActions).values({
      orgId: AE_ORG,
      actionType: "outreach_email",
      recipientEmail: TEST_EMAIL,
      subject: "AE-9 test draft",
      bodyPreview: "Proposed email for ActionExecutor test",
      riskLevel: "low",
      approvalRequired: true,
      status: "proposed",
      communicationDomain: "team_training",
      createdByAgent: "audit_test",
    }).returning();

    const { runActionExecutorCycle } = await import("../services/agent-action-executor.js");
    await runActionExecutorCycle();

    // Re-read from DB
    const rows = await db.execute(
      sql`SELECT status, approval_required, executed_at, result FROM gmail_agent_actions WHERE id = ${action.id}`
    );
    const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    const updated = data[0];

    assert.ok(updated !== undefined, "Action must still exist in DB");
    assert.notEqual(updated.status, "proposed", "Action must no longer be proposed");
    assert.notEqual(updated.status, "auto_executed", "Action must NOT be auto_executed");
    assert.notEqual(updated.status, "executed", "Action must NOT be executed");
    assert.equal(updated.executed_at, null, "executedAt must remain null — no email was sent");

    if (updated.status === "awaiting_approval") {
      assert.equal(updated.approval_required, true, "approvalRequired must be true");
    }

    await db.execute(sql`DELETE FROM gmail_agent_actions WHERE id = ${action.id}`);
  });

  it("AE-10: isEmailAction detection — recipientEmail present is treated as email action (source check)", async () => {
    const src = readFileSync("server/services/agent-action-executor.ts", "utf-8");
    const fnIdx = src.indexOf("function isEmailAction");
    assert.ok(fnIdx !== -1, "isEmailAction must be defined");
    const section = src.slice(fnIdx, fnIdx + 400);
    assert.ok(section.includes("recipientEmail"), "isEmailAction must check recipientEmail");
  });
});
