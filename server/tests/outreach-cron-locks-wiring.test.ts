/**
 * Automated-Outreach Cron Locks — Wiring Tests (PR 1b.3, DB-free)
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs without a database. Proves the three automated-outreach sender crons
 * acquire their DB job lock and release it in `finally`, without altering send
 * code, the kill-switch, or approval/policy guards. Live insert/skip/takeover
 * behaviour is covered by cron-job-locks.test.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";

const CASES = [
  {
    file: "server/email-agent/scheduled-email-agent.ts",
    lockName: "scheduled_email_agent",
    scopeArg: "org.id",
    ttl: 1440,
    sweepCall: "runEmailAgentForOrg(org.id",
  },
  {
    file: "server/lead-capture-sequences.ts",
    lockName: "lead_capture_sequences",
    scopeArg: '"__global__"',
    ttl: 30,
    sweepCall: "runLeadCaptureSequenceCron()",
  },
  {
    file: "server/agentmail-followup-routes.ts",
    lockName: "agentmail_followup",
    scopeArg: '"__global__"',
    ttl: 20,
    sweepCall: "processDueFollowups()",
  },
].map((c) => ({ ...c, src: readFileSync(c.file, "utf-8") }));

describe("automated-outreach crons acquire + release a job lock", () => {
  for (const c of CASES) {
    describe(c.file, () => {
      it(`acquires "${c.lockName}" on ${c.scopeArg} with TTL ${c.ttl}`, () => {
        const scope = c.scopeArg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`acquireJobLock\\(\\s*${scope}\\s*,\\s*"${c.lockName}"\\s*,\\s*${c.ttl}\\)`);
        assert.ok(re.test(c.src), `${c.file} should acquire ${c.lockName} on ${c.scopeArg} TTL ${c.ttl}`);
      });

      it("skips + logs when the lock is held", () => {
        assert.ok(/if \(!acquired\)/.test(c.src), `${c.file} should skip when lock not acquired`);
      });

      it("releases the lock in a finally block", () => {
        assert.ok(/finally\s*{[^}]*releaseJobLock/s.test(c.src), `${c.file} should release in finally`);
      });

      it("uses the fail-open lock-error pattern", () => {
        assert.ok(
          c.src.includes('acquired: true, lockKey: ""'),
          `${c.file} should fail open on lock-system error`,
        );
      });

      it("still invokes the unchanged send sweep", () => {
        assert.ok(c.src.includes(c.sweepCall), `${c.file} should still call ${c.sweepCall}`);
      });
    });
  }
});

describe("send behavior + kill-switch preserved", () => {
  it("scheduled-email still routes through the guarded (kill-switch) send", () => {
    const src = readFileSync("server/email-agent/scheduled-email-agent.ts", "utf-8");
    assert.ok(
      src.includes("guardedSendTeamTrainingOutreachEmail"),
      "scheduled-email-agent must keep routing sends through the guarded chain",
    );
  });

  it("the global AUTOMATION_SENDS_ENABLED kill-switch is untouched", () => {
    const guard = readFileSync("server/services/guarded-outbound-email.ts", "utf-8");
    assert.ok(guard.includes("AUTOMATION_SENDS_ENABLED"), "kill-switch must remain in the guard chain");
  });
});
