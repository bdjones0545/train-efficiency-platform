/**
 * Reminder Cron Locks — Wiring Tests (PR 1b.2, DB-free)
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs without a database. Proves both reminder sweeps acquire a global DB job
 * lock before running and release it in `finally`, without altering send code.
 * Live insert/skip/takeover behaviour is covered by cron-job-locks.test.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";

const CASES = [
  {
    file: "server/weekly-reminder.ts",
    lockName: "weekly_reminder",
    ttl: 120,
    sweepCall: "sendWeeklyReminders()",
  },
  {
    file: "server/session-reminders.ts",
    lockName: "session_reminders",
    ttl: 60,
    sweepCall: "sendSessionReminders()",
  },
].map((c) => ({ ...c, src: readFileSync(c.file, "utf-8") }));

describe("reminder crons acquire + release a global job lock", () => {
  for (const c of CASES) {
    describe(c.file, () => {
      it(`acquires "${c.lockName}" on "__global__" with TTL ${c.ttl}`, () => {
        const re = new RegExp(`acquireJobLock\\(\\s*"__global__"\\s*,\\s*"${c.lockName}"\\s*,\\s*${c.ttl}\\)`);
        assert.ok(re.test(c.src), `${c.file} should acquire ${c.lockName} on __global__ TTL ${c.ttl}`);
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

      it("still invokes the unchanged sweep function", () => {
        assert.ok(c.src.includes(c.sweepCall), `${c.file} should still call ${c.sweepCall}`);
      });
    });
  }
});
