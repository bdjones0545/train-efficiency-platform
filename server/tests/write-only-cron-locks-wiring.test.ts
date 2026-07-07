/**
 * Write-Only Agent Cron Locks — Wiring Tests (PR 1b.1, DB-free)
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs without a database. Proves each of the four write-only agent crons
 * acquires its DB job lock and releases it in `finally`, so a future edit that
 * drops a lock is caught here. Live insert/skip/takeover behaviour is already
 * covered by cron-job-locks.test.ts (DB-integration).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";

// file → { lockName, scope, source }
const CASES = [
  { file: "server/agents/apex-agent.ts", lockName: "apex_daily_cron", scope: "org.id" },
  { file: "server/agents/pulse-agent.ts", lockName: "pulse_daily_cron", scope: "org.id" },
  { file: "server/revenue-agent.ts", lockName: "revenue_agent_cron", scope: "orgId" },
  { file: "server/intelligence-routes.ts", lockName: "intelligence_monitoring_cron", scope: "__global__" },
].map((c) => ({ ...c, src: readFileSync(c.file, "utf-8") }));

describe("write-only agent crons acquire + release a job lock", () => {
  for (const c of CASES) {
    describe(c.file, () => {
      it(`acquires the "${c.lockName}" lock`, () => {
        assert.ok(
          c.src.includes(`"${c.lockName}"`),
          `${c.file} should reference the ${c.lockName} lock name`,
        );
        assert.ok(
          c.src.includes("acquireJobLock("),
          `${c.file} should call acquireJobLock`,
        );
      });

      it(`locks on the expected scope (${c.scope})`, () => {
        // The acquireJobLock call for this cron must pass the expected scope arg.
        const re = new RegExp(`acquireJobLock\\(\\s*${c.scope === "__global__" ? '"__global__"' : c.scope}\\s*,\\s*"${c.lockName}"`);
        assert.ok(re.test(c.src), `${c.file} should lock ${c.lockName} on ${c.scope}`);
      });

      it("releases the lock in a finally block", () => {
        assert.ok(c.src.includes("releaseJobLock("), `${c.file} should call releaseJobLock`);
        assert.ok(/finally\s*{[^}]*releaseJobLock/s.test(c.src), `${c.file} should release in finally`);
      });

      it("skips + logs when the lock is held", () => {
        assert.ok(/if \(!acquired\)/.test(c.src), `${c.file} should skip when lock not acquired`);
      });
    });
  }
});
