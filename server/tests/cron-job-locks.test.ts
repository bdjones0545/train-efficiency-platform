/**
 * Cron Job Locks — DB-Integration Tests (PR-2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Exercises the live acquireJobLock()/releaseJobLock() behaviour against the
 * job_execution_locks table. REQUIRES a provisioned Postgres (DATABASE_URL) —
 * the same convention as the repo's other DB-integration suites
 * (organization-isolation, send-path-audit). Skipped naturally where no DB is
 * provisioned; the DB-free contract lives in cron-job-locks-wiring.test.ts.
 *
 * Covers:
 *   1. A second acquire skips while an active lock exists.
 *   2. An expired lock can be re-acquired (atomic takeover).
 *   3. "__global__" locks do not collide with a real org's lock.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db.js";
import { jobExecutionLocks } from "@shared/schema.js";
import { like } from "drizzle-orm";
import { acquireJobLock, releaseJobLock } from "../services/ceo-heartbeat-service.js";

const TS = Date.now();

after(async () => {
  // Best-effort cleanup of any locks this suite created.
  await db.delete(jobExecutionLocks).where(like(jobExecutionLocks.jobName, `test_lock_%_${TS}`)).catch(() => {});
});

describe("cron job locks (DB integration)", () => {
  it("1. a second acquire skips while an active lock exists", async () => {
    const orgId = `test-lock-org-${TS}`;
    const job = `test_lock_a_${TS}`;
    const first = await acquireJobLock(orgId, job, 60);
    assert.equal(first.acquired, true, "first acquire should succeed");
    const second = await acquireJobLock(orgId, job, 60);
    assert.equal(second.acquired, false, "second acquire (active lock) should skip");
    await releaseJobLock(first.lockKey);
  });

  it("2. an expired lock can be re-acquired (atomic takeover)", async () => {
    const orgId = `test-lock-org-exp-${TS}`;
    const job = `test_lock_b_${TS}`;
    const ttl = 60;
    const now = Date.now();
    // Pre-seed the exact key acquireJobLock() will compute, but already expired.
    const lockKey = `${orgId}:${job}:${Math.floor(now / (ttl * 60 * 1000))}`;
    await db.insert(jobExecutionLocks).values({
      orgId,
      jobName: job,
      lockKey,
      expiresAt: new Date(now - 1000),
      status: "acquired",
    });
    const res = await acquireJobLock(orgId, job, ttl);
    assert.equal(res.acquired, true, "expired lock should be taken over");
    await releaseJobLock(res.lockKey);
  });

  it('3. "__global__" locks do not collide with a real org lock', async () => {
    const job = `test_lock_c_${TS}`;
    const globalLock = await acquireJobLock("__global__", job, 60);
    const orgLock = await acquireJobLock(`test-lock-org-${TS}`, job, 60);
    assert.equal(globalLock.acquired, true, "global lock should acquire");
    assert.equal(orgLock.acquired, true, "org lock for same job should NOT be blocked by the global lock");
    await releaseJobLock(globalLock.lockKey);
    await releaseJobLock(orgLock.lockKey);
  });
});
