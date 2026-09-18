/**
 * AUTOMATION_SENDS_ENABLED — coverage across EVERY automated sender.
 * ─────────────────────────────────────────────────────────────────────────────
 * The README calls AUTOMATION_SENDS_ENABLED "a global emergency off-switch for
 * automated outreach". Before this suite it was consulted in exactly one file,
 * server/services/guarded-outbound-email.ts, so three automated senders kept
 * sending with the switch off:
 *
 *   1. server/lead-capture-sequences.ts — 5-step nurture cron, raw sg.send()
 *   2. server/weekly-reminder.ts        — "we miss you" re-engagement sweep
 *   3. server/attendance-report-cron.ts — 17:00 ET report cron, own SG client
 *   4. nurture ENROLMENT from the two public intake endpoints
 *
 * These tests EXECUTE each sender with a stubbed SendGrid client and stubbed
 * storage and assert zero provider calls. They fail on main: on main the cron
 * functions are not even exported, and the senders that are exported call
 * sg.send() regardless of the switch.
 *
 * Transactional mail is deliberately NOT covered by the switch — see
 * automation-kill-switch.test.ts.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  AUTOMATION_KILL_SWITCH_REASON,
  automationRunBlocked,
  automationSendsDisabled,
  initialSequenceStatus,
  isAutomationSendsEnabled,
  resetAutomationSendsLog,
  SEQUENCE_STATUS_AUTOMATION_DISABLED,
} from "../lib/automation-sends.js";

let savedEnv: string | undefined;

function disable() {
  process.env.AUTOMATION_SENDS_ENABLED = "false";
  resetAutomationSendsLog();
}
function enable() {
  delete process.env.AUTOMATION_SENDS_ENABLED;
  resetAutomationSendsLog();
}

beforeEach(() => {
  savedEnv = process.env.AUTOMATION_SENDS_ENABLED;
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.AUTOMATION_SENDS_ENABLED;
  else process.env.AUTOMATION_SENDS_ENABLED = savedEnv;
  resetAutomationSendsLog();
});

/** A SendGrid stand-in that records every send instead of making one. */
function mailSpy() {
  const sent: any[] = [];
  return {
    sent,
    client: {
      send: async (msg: any) => {
        sent.push(msg);
        return [{ statusCode: 202, headers: {} }];
      },
    },
  };
}

// ── The switch itself ────────────────────────────────────────────────────────

describe("isAutomationSendsEnabled — semantics match the guarded chain", () => {
  it('"false" and "0" disable; unset and anything else enable', () => {
    for (const off of ["false", "0"]) {
      process.env.AUTOMATION_SENDS_ENABLED = off;
      assert.equal(isAutomationSendsEnabled(), false, `${off} must disable`);
      assert.equal(automationSendsDisabled(), true);
    }
    for (const on of ["true", "1", "yes", ""]) {
      process.env.AUTOMATION_SENDS_ENABLED = on;
      assert.equal(isAutomationSendsEnabled(), true, `${on} must not disable`);
    }
    delete process.env.AUTOMATION_SENDS_ENABLED;
    assert.equal(isAutomationSendsEnabled(), true, "unset must not disable");
  });

  it("reports the same reason string the guarded chain has always used", () => {
    assert.equal(
      AUTOMATION_KILL_SWITCH_REASON,
      "global kill-switch (AUTOMATION_SENDS_ENABLED=false)",
    );
  });

  it("logs once per run scope, not once per row", () => {
    disable();
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
    try {
      for (let i = 0; i < 25; i++) assert.equal(automationRunBlocked("test scope"), true);
    } finally {
      console.warn = realWarn;
    }
    assert.equal(warnings.length, 1, "a skipped sweep should say so once, not once per row");
    assert.match(warnings[0], /AUTOMATION_SENDS_ENABLED/);
  });
});

// ── 1. Lead-capture nurture sequences ────────────────────────────────────────

describe("bypass 1 — lead-capture nurture sequences (server/lead-capture-sequences.ts)", () => {
  it("the cron run makes zero provider calls and never touches the database", async () => {
    disable();
    const mail = mailSpy();
    let dbLoaded = false;
    const { runLeadCaptureSequenceCron } = await import("../lead-capture-sequences.js");

    await runLeadCaptureSequenceCron({
      mail: mail.client,
      loadDb: async () => { dbLoaded = true; throw new Error("the cron must not reach the database when the switch is off"); },
    });

    assert.equal(mail.sent.length, 0, "kill-switch must stop every nurture send");
    assert.equal(dbLoaded, false, "the run must short-circuit before any DB read or state write");
  });

  it("sendSubmissionFollowUp skips instead of sending", async () => {
    disable();
    const mail = mailSpy();
    const { sendSubmissionFollowUp } = await import("../lead-capture-sequences.js");
    const outcome = await sendSubmissionFollowUp({
      submissionId: "sub-1", step: "high_intent_1hr", orgId: "org-1",
      athleteName: "Test Athlete", email: "athlete@example.com",
      programName: "Program", orgName: "Org", orgSlug: "org",
    }, { mail: mail.client, isOptedOut: async () => false, log: async () => {} });

    assert.equal(outcome, "skipped");
    assert.equal(mail.sent.length, 0);
  });

  it("sendAbandonedRecovery skips instead of sending", async () => {
    disable();
    const mail = mailSpy();
    const { sendAbandonedRecovery } = await import("../lead-capture-sequences.js");
    const outcome = await sendAbandonedRecovery({
      abandonedId: "ab-1", step: "recovery_30min", orgId: "org-1",
      athleteName: "Test Athlete", email: "athlete@example.com",
      programName: "Program", orgName: "Org", orgSlug: "org", programSlug: "prog",
    }, { mail: mail.client, isOptedOut: async () => false, log: async () => {} });

    assert.equal(outcome, "skipped");
    assert.equal(mail.sent.length, 0);
  });

  it("an opted-out recipient is skipped even with the switch on", async () => {
    enable();
    const mail = mailSpy();
    const { sendSubmissionFollowUp } = await import("../lead-capture-sequences.js");
    const outcome = await sendSubmissionFollowUp({
      submissionId: "sub-1", step: "high_intent_1hr", orgId: "org-1",
      athleteName: "Test Athlete", email: "athlete@example.com",
      programName: "Program", orgName: "Org", orgSlug: "org",
    }, { mail: mail.client, isOptedOut: async () => true, log: async () => {} });

    assert.equal(outcome, "skipped");
    assert.equal(mail.sent.length, 0, "opt-out must be checked before each step");
  });

  it("an opt-out lookup that fails is treated as opted out (fails closed)", async () => {
    enable();
    const mail = mailSpy();
    const { sendSubmissionFollowUp } = await import("../lead-capture-sequences.js");
    const outcome = await sendSubmissionFollowUp({
      submissionId: "sub-1", step: "high_intent_1hr", orgId: "org-1",
      athleteName: "Test Athlete", email: "athlete@example.com",
      programName: "Program", orgName: "Org", orgSlug: "org",
    }, { mail: mail.client, isOptedOut: async () => { throw new Error("db down"); }, log: async () => {} });

    assert.equal(outcome, "skipped");
    assert.equal(mail.sent.length, 0);
  });
});

// ── 2. Weekly re-engagement ──────────────────────────────────────────────────

describe("bypass 2 — weekly re-engagement sweep (server/weekly-reminder.ts)", () => {
  it("makes zero provider calls and never reads the inactive-user list", async () => {
    disable();
    let sends = 0;
    let lookups = 0;
    let marks = 0;
    const { sendWeeklyReminders } = await import("../weekly-reminder.js");

    await sendWeeklyReminders({
      sendReminder: (async () => { sends++; }) as any,
      getInactiveUsers: async () => { lookups++; return [{ id: "u1", email: "u@example.com", firstName: "U" }]; },
      markSent: async (userId: string) => { marks++; return userId; },
    });

    assert.equal(sends, 0, "kill-switch must stop the re-engagement send");
    assert.equal(lookups, 0, "the run must short-circuit before reading users");
    assert.equal(marks, 0, "no reminder state may advance on a skipped run");
  });

  it("with the switch on it sends, and carries a marketing logCtx", async () => {
    enable();
    const calls: any[] = [];
    const { sendWeeklyReminders } = await import("../weekly-reminder.js");

    await sendWeeklyReminders({
      sendReminder: (async (...args: any[]) => { calls.push(args); }) as any,
      getInactiveUsers: async () => [{ id: "u1", email: "u@example.com", firstName: "U" }],
      markSent: async () => undefined,
    });

    assert.equal(calls.length, 1, "the sweep must still send when the switch is on");
    const logCtx = calls[0][3];
    assert.ok(logCtx, "the re-engagement send must carry a logCtx — without one sendEmail() skips the preference check, the unsubscribe token and the emergency pause");
    assert.equal(logCtx.type, "marketing", "re-engagement is marketing, not transactional");
    assert.equal(logCtx.recipientUserId, "u1");
  });
});

// ── 3. Attendance report cron ────────────────────────────────────────────────

describe("bypass 3 — attendance report cron (server/attendance-report-cron.ts)", () => {
  it("daily reports make zero provider calls and never resolve SendGrid", async () => {
    disable();
    let sendGridResolved = 0;
    const { sendDailyReports } = await import("../attendance-report-cron.js");

    await sendDailyReports("2026-09-17", {
      getSendGrid: async () => { sendGridResolved++; throw new Error("must not resolve SendGrid when the switch is off"); },
    });

    assert.equal(sendGridResolved, 0, "the run must short-circuit before the provider and the schema probe");
  });

  it("weekly reports make zero provider calls", async () => {
    disable();
    let sendGridResolved = 0;
    const { sendWeeklyReports } = await import("../attendance-report-cron.js");

    await sendWeeklyReports("2026-09-18", {
      getSendGrid: async () => { sendGridResolved++; throw new Error("must not resolve SendGrid when the switch is off"); },
    });

    assert.equal(sendGridResolved, 0);
  });
});

// ── 4. Nurture enrolment from the public intake endpoints ────────────────────

describe("bypass 4 — nurture enrolment from the public intake endpoints", () => {
  it("enrols new leads in a state the sequence cron never selects", () => {
    disable();
    assert.equal(initialSequenceStatus(), SEQUENCE_STATUS_AUTOMATION_DISABLED);
    enable();
    assert.equal(initialSequenceStatus(), "pending");
  });

  it("the disabled state is not one the cron sweep selects", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/lead-capture-sequences.ts", "utf-8"),
    );
    // The sweep selects exactly these three statuses.
    for (const selected of ['"pending"', '"high_intent_sent"', '"followup_24hr_sent"']) {
      assert.ok(src.includes(`leadCaptureSubmissions.sequenceStatus, ${selected}`), `sweep should select ${selected}`);
    }
    assert.ok(
      !src.includes(`sequenceStatus, "${SEQUENCE_STATUS_AUTOMATION_DISABLED}"`),
      "the withheld state must never be selected by the sweep",
    );
  });

  it("the org-admin confirmation is NOT gated — it is transactional", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/routes.ts", "utf-8"),
    );
    const submitStart = src.indexOf('"/api/public/lead-capture/:orgSlug/:programSlug/submit"');
    assert.ok(submitStart > 0, "the public submit route must still exist");
    const section = src.slice(submitStart, submitStart + 24_000);
    assert.ok(section.includes("initialSequenceStatus()"), "enrolment must consult the kill-switch");
    assert.ok(
      section.includes("New Athlete Application"),
      "the admin notification must still be sent — it is the reply to a human action, not automation",
    );
  });
});
