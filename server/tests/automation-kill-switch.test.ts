/**
 * Automation Kill-Switch — Safety Tests (PR-1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Proves the global AUTOMATION_SENDS_ENABLED emergency off-switch behaves exactly
 * as specified in the guarded outbound-email chain:
 *
 *   1. AUTOMATION_SENDS_ENABLED="false" blocks BOTH guardedSend* paths.
 *   2. AUTOMATION_SENDS_ENABLED="0"     blocks BOTH guardedSend* paths.
 *   3. Unset env does NOT trigger the kill-switch (sends proceed past step 0).
 *   4. The transactional send path (server/email.ts::sendEmail) is NOT affected
 *      by the switch — the flag lives only in the automated-outreach chain.
 *
 * These tests are infra-free: when the switch fires, guardedSend* returns before
 * any SendGrid/DB dependency (the block-path audit write is best-effort and
 * swallowed), so no DATABASE_URL or SENDGRID_API_KEY is required.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import {
  guardedSendTeamTrainingOutreachEmail,
  guardedSendAgentOutreachEmail,
  type GuardedSendOpts,
} from "../services/guarded-outbound-email.js";

const KILL_SWITCH_REASON = "global kill-switch (AUTOMATION_SENDS_ENABLED=false)";

const teamOpts: GuardedSendOpts = {
  orgId: "test-killswitch-org",
  recipientEmail: "recipient@example.com",
  subject: "Test subject",
  body: "Test body",
  sourceSystem: "kill-switch-test",
  triggeredBy: "cron",
  emailType: "initial_outreach",
};

const agentOpts = {
  orgId: "test-killswitch-org",
  clientEmail: "client@example.com",
  clientFirstName: "Test",
  emailSubject: "Test subject",
  emailBody: "Test body",
  sourceSystem: "kill-switch-test",
};

describe("AUTOMATION_SENDS_ENABLED kill-switch", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.AUTOMATION_SENDS_ENABLED;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AUTOMATION_SENDS_ENABLED;
    else process.env.AUTOMATION_SENDS_ENABLED = saved;
  });

  it('="false" blocks guardedSendTeamTrainingOutreachEmail', async () => {
    process.env.AUTOMATION_SENDS_ENABLED = "false";
    const r = await guardedSendTeamTrainingOutreachEmail(teamOpts);
    assert.equal(r.sent, false);
    assert.equal(r.blocked, true);
    assert.equal(r.blockType, "emergency_pause");
    assert.equal(r.blockReason, KILL_SWITCH_REASON);
  });

  it('="false" blocks guardedSendAgentOutreachEmail', async () => {
    process.env.AUTOMATION_SENDS_ENABLED = "false";
    const r = await guardedSendAgentOutreachEmail(agentOpts);
    assert.equal(r.sent, false);
    assert.equal(r.blocked, true);
    assert.equal(r.blockType, "emergency_pause");
    assert.equal(r.blockReason, KILL_SWITCH_REASON);
  });

  it('="0" blocks guardedSendTeamTrainingOutreachEmail', async () => {
    process.env.AUTOMATION_SENDS_ENABLED = "0";
    const r = await guardedSendTeamTrainingOutreachEmail(teamOpts);
    assert.equal(r.sent, false);
    assert.equal(r.blocked, true);
    assert.equal(r.blockType, "emergency_pause");
    assert.equal(r.blockReason, KILL_SWITCH_REASON);
  });

  it('="0" blocks guardedSendAgentOutreachEmail', async () => {
    process.env.AUTOMATION_SENDS_ENABLED = "0";
    const r = await guardedSendAgentOutreachEmail(agentOpts);
    assert.equal(r.sent, false);
    assert.equal(r.blocked, true);
    assert.equal(r.blockType, "emergency_pause");
    assert.equal(r.blockReason, KILL_SWITCH_REASON);
  });

  it("unset env does NOT trigger the kill-switch (proceeds past step 0)", async () => {
    delete process.env.AUTOMATION_SENDS_ENABLED;
    // With no DB/SendGrid infra the call will either throw downstream or return a
    // non-kill-switch result — in every case it must NOT short-circuit with the
    // kill-switch reason. That is the only outcome this test forbids.
    let threw = false;
    let reason: string | undefined;
    try {
      const r = await guardedSendTeamTrainingOutreachEmail(teamOpts);
      reason = r.blockReason;
    } catch {
      threw = true;
    }
    assert.ok(
      threw || reason !== KILL_SWITCH_REASON,
      "unset env must not produce the kill-switch block",
    );
  });

  it('any other value (e.g. "true") does NOT trigger the kill-switch', async () => {
    process.env.AUTOMATION_SENDS_ENABLED = "true";
    let threw = false;
    let reason: string | undefined;
    try {
      const r = await guardedSendTeamTrainingOutreachEmail(teamOpts);
      reason = r.blockReason;
    } catch {
      threw = true;
    }
    assert.ok(threw || reason !== KILL_SWITCH_REASON);
  });
});

describe("transactional send path is exempt from the kill-switch", () => {
  it("server/email.ts (sendEmail) does not reference AUTOMATION_SENDS_ENABLED", () => {
    const src = readFileSync("server/email.ts", "utf-8");
    assert.ok(
      !src.includes("AUTOMATION_SENDS_ENABLED"),
      "transactional email path must not consult the outreach kill-switch",
    );
  });

  it("the kill-switch is scoped to the guarded outbound-email chain", () => {
    const src = readFileSync("server/services/guarded-outbound-email.ts", "utf-8");
    assert.ok(
      src.includes("AUTOMATION_SENDS_ENABLED"),
      "kill-switch must live in the automated-outreach chain",
    );
  });
});
