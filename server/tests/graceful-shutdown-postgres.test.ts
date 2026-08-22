import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { acquireJobLock, releaseJobLock } from "../services/ceo-heartbeat-service";
import { resetRuntimeShutdownForTests, shutdownRuntime } from "../services/runtime-shutdown";

before(async () => {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS job_execution_locks (
    id text PRIMARY KEY, org_id text NOT NULL, job_name text NOT NULL,
    lock_key text NOT NULL UNIQUE, acquired_at timestamp DEFAULT now(),
    expires_at timestamp NOT NULL, released_at timestamp,
    status text NOT NULL DEFAULT 'acquired')`);
});
beforeEach(async () => {
  resetRuntimeShutdownForTests();
  await db.execute(sql`TRUNCATE job_execution_locks`);
});
after(async () => { await pool.end(); });

test("shutdown blocks a queued scheduler callback before lock acquisition", async () => {
  await shutdownRuntime({ reason: "SIGTERM" });
  const lock = await acquireJobLock("org-a", "queued-cycle", 1);
  assert.equal(lock.acquired, false);
  const result: any = await db.execute(sql`SELECT count(*)::int count FROM job_execution_locks`);
  assert.equal(Number((result.rows ?? result)[0].count), 0);
});

test("shutdown waits for active scheduler ownership and owner release", async () => {
  const lock = await acquireJobLock("org-a", "active-cycle", 1);
  assert.equal(lock.acquired, true);
  const shutdown = shutdownRuntime({ reason: "SIGTERM", graceMs: 200 });
  setTimeout(() => { void releaseJobLock(lock.lockKey); }, 10);
  assert.deepEqual(await shutdown, { timedOut: false, remainingTasks: 0 });
  const result: any = await db.execute(sql`SELECT count(*)::int count FROM job_execution_locks`);
  assert.equal(Number((result.rows ?? result)[0].count), 0);
});

test("forced timeout leaves scheduler lease recoverable by expiry", async () => {
  const first = await acquireJobLock("org-a", "hanging-cycle", 1);
  const result = await shutdownRuntime({ reason: "SIGTERM", graceMs: 5 });
  assert.equal(result.timedOut, true);
  assert.equal(result.remainingTasks, 1);
  await db.execute(sql`UPDATE job_execution_locks SET expires_at=NOW()-INTERVAL '1 second'`);
  resetRuntimeShutdownForTests();
  const recovered = await acquireJobLock("org-a", "hanging-cycle", 1);
  assert.equal(recovered.acquired, true);
  await releaseJobLock(recovered.lockKey);
  await releaseJobLock(first.lockKey);
});
