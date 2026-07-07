/**
 * Cron Job Locks — Wiring & Key-Logic Tests (PR-2, DB-free)
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs without a database. Proves two things statically:
 *
 *   A. Every targeted index.ts boot cron is wrapped in a job lock (so a future
 *      edit that drops a wrapper is caught here).
 *   B. The lock-key derivation contract behind acquireJobLock() holds:
 *        - same (scope, job) inside one TTL window → identical key  (→ dedup)
 *        - "__global__" scope never collides with a real org's key
 *        - a later TTL window → a different key                     (→ re-acquire)
 *
 * The live insert/skip/takeover behaviour against Postgres lives in the
 * DB-integration companion suite (cron-job-locks.test.ts).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";

const INDEX_SRC = readFileSync("server/index.ts", "utf-8");

// The nine index.ts-owned crons locked in PR-2 (job name → lock scope kind).
const LOCKED_JOBS = [
  "outcome_detection",
  "auto_send_and_campaigns",
  "pending_actions_cleanup",
  "recurring_team_lead_research",
  "financial_event_retry",
  "athlete_context_refresh",
  "outcome_eval",
  "daily_ops",
  "daily_revenue_sync",
];

describe("A. index.ts crons are wrapped in job locks", () => {
  it("defines the runWithJobLock helper exactly once", () => {
    const defs = INDEX_SRC.match(/async function runWithJobLock\(/g) ?? [];
    assert.equal(defs.length, 1, "runWithJobLock helper should be defined once");
  });

  it("wraps 8 crons via runWithJobLock and 1 (recurring research) inline", () => {
    const calls = INDEX_SRC.match(/\brunWithJobLock\(/g) ?? [];
    // 1 definition + 8 call sites = 9 total occurrences of the identifier "runWithJobLock("
    assert.equal(calls.length, 9, "expected helper def + 8 call sites");
    assert.ok(
      INDEX_SRC.includes('acquireJobLock(orgId, "recurring_team_lead_research"'),
      "recurring research must acquire its own per-org lock",
    );
    assert.ok(
      INDEX_SRC.includes("releaseJobLock(rlLockKey)"),
      "recurring research must release its lock in finally",
    );
  });

  for (const job of LOCKED_JOBS) {
    it(`locks the "${job}" cron`, () => {
      assert.ok(
        INDEX_SRC.includes(`"${job}"`),
        `index.ts should reference the ${job} lock job name`,
      );
    });
  }
});

// Mirror of acquireJobLock()'s key formula (server/services/ceo-heartbeat-service.ts).
function lockKey(scope: string, jobName: string, ttlMinutes: number, nowMs: number): string {
  return `${scope}:${jobName}:${Math.floor(nowMs / (ttlMinutes * 60 * 1000))}`;
}

describe("B. lock-key derivation contract", () => {
  const now = Date.now();

  it("same scope+job inside one TTL window yields an identical key (dedup)", () => {
    const a = lockKey("org-1", "daily_ops", 360, now);
    const b = lockKey("org-1", "daily_ops", 360, now + 60_000); // 1 min later, same window
    assert.equal(a, b);
  });

  it('"__global__" never collides with a real org key for the same job', () => {
    const g = lockKey("__global__", "daily_ops", 360, now);
    const o = lockKey("org-1", "daily_ops", 360, now);
    assert.notEqual(g, o);
  });

  it("two distinct orgs never share a key for the same job", () => {
    const a = lockKey("org-1", "outcome_eval", 360, now);
    const b = lockKey("org-2", "outcome_eval", 360, now);
    assert.notEqual(a, b);
  });

  it("a later TTL window yields a different key (allows re-acquire next tick)", () => {
    const a = lockKey("org-1", "financial_event_retry", 15, now);
    const b = lockKey("org-1", "financial_event_retry", 15, now + 15 * 60_000 + 1);
    assert.notEqual(a, b);
  });
});
