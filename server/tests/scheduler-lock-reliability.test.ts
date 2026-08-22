import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { and, eq, like, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { jobExecutionLocks } from "@shared/schema";
import {
  acquireJobLock,
  releaseJobLock,
  renewJobLock,
  runWithJobLockLease,
  startJobLockHeartbeat,
} from "../services/ceo-heartbeat-service";

const prefix = `scheduler-lock-test-${process.pid}`;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(async () => {
  await db.delete(jobExecutionLocks).where(like(jobExecutionLocks.jobName, `${prefix}%`));
});
after(async () => { await pool.end(); });

test("normal acquisition and owner release", async () => {
  const lock = await acquireJobLock("org-a", `${prefix}-normal`, 1);
  assert.equal(lock.acquired, true);
  assert.equal(await releaseJobLock(lock.lockKey), true);
  assert.equal(await releaseJobLock(lock.lockKey), false);
});

test("three contenders produce one acquisition winner", async () => {
  const locks = await Promise.all([1, 2, 3].map(() => acquireJobLock("org-a", `${prefix}-three`, 1)));
  assert.equal(locks.filter(lock => lock.acquired).length, 1);
});

test("expired lock can be taken over", async () => {
  const first = await acquireJobLock("org-a", `${prefix}-expired`, 1);
  await db.update(jobExecutionLocks).set({ expiresAt: sql`NOW() - INTERVAL '1 second'` })
    .where(eq(jobExecutionLocks.id, first.ownerToken));
  const second = await acquireJobLock("org-a", `${prefix}-expired`, 1);
  assert.equal(second.acquired, true);
  assert.notEqual(second.ownerToken, first.ownerToken);
});

test("three expired-lock contenders produce one takeover winner", async () => {
  const first = await acquireJobLock("org-a", `${prefix}-takeover-three`, 1);
  await db.update(jobExecutionLocks).set({ expiresAt: sql`NOW() - INTERVAL '1 second'` })
    .where(eq(jobExecutionLocks.id, first.ownerToken));
  const locks = await Promise.all([1, 2, 3].map(() => acquireJobLock("org-a", `${prefix}-takeover-three`, 1)));
  assert.equal(locks.filter(lock => lock.acquired).length, 1);
});

test("only the current owner can renew", async () => {
  const lock = await acquireJobLock("org-a", `${prefix}-renew`, 1);
  assert.equal(await renewJobLock(lock.lockKey, 1), true);
  assert.equal(await renewJobLock(`org-a:${prefix}-renew#stale-owner`, 1), false);
});

test("heartbeat keeps a long-running lease from takeover", async () => {
  const first = await acquireJobLock("org-a", `${prefix}-heartbeat`, 0.02);
  const stop = startJobLockHeartbeat(first.lockKey, 0.02);
  await wait(1_300);
  const second = await acquireJobLock("org-a", `${prefix}-heartbeat`, 0.02);
  stop();
  assert.equal(second.acquired, false);
  await releaseJobLock(first.lockKey);
});

test("stopped heartbeat permits takeover after expiry", async () => {
  const first = await acquireJobLock("org-a", `${prefix}-crash`, 0.02);
  const stop = startJobLockHeartbeat(first.lockKey, 0.02);
  stop();
  await wait(1_200);
  const second = await acquireJobLock("org-a", `${prefix}-crash`, 0.02);
  assert.equal(second.acquired, true);
});

test("stale release cannot delete a newer owner", async () => {
  const first = await acquireJobLock("org-a", `${prefix}-stale-release`, 1);
  await db.update(jobExecutionLocks).set({ expiresAt: sql`NOW() - INTERVAL '1 second'` })
    .where(eq(jobExecutionLocks.id, first.ownerToken));
  const second = await acquireJobLock("org-a", `${prefix}-stale-release`, 1);
  assert.equal(await releaseJobLock(first.lockKey), false);
  const rows = await db.select().from(jobExecutionLocks).where(eq(jobExecutionLocks.id, second.ownerToken));
  assert.equal(rows.length, 1);
});

test("stale renewal cannot extend a newer owner", async () => {
  const first = await acquireJobLock("org-a", `${prefix}-stale-renew`, 1);
  await db.update(jobExecutionLocks).set({ expiresAt: sql`NOW() - INTERVAL '1 second'` })
    .where(eq(jobExecutionLocks.id, first.ownerToken));
  const second = await acquireJobLock("org-a", `${prefix}-stale-renew`, 1);
  assert.equal(await renewJobLock(first.lockKey, 1), false);
  assert.equal(await renewJobLock(second.lockKey, 1), true);
});

test("lock-service exception fails closed without invoking business work", async () => {
  let calls = 0;
  const result = await runWithJobLockLease("org-a", `${prefix}-failure`, 1, async () => { calls++; }, async () => {
    throw new Error("database unavailable");
  });
  assert.equal(result.reason, "lock_service_failure");
  assert.equal(calls, 0);
});

test("contention skips mocked customer side effect", async () => {
  const held = await acquireJobLock("org-a", `${prefix}-side-effect`, 1);
  let calls = 0;
  const result = await runWithJobLockLease("org-a", `${prefix}-side-effect`, 1, async () => { calls++; });
  assert.equal(result.reason, "contended");
  assert.equal(calls, 0);
  await releaseJobLock(held.lockKey);
});

test("valid ownership executes mocked customer side effect once", async () => {
  let calls = 0;
  const result = await runWithJobLockLease("org-a", `${prefix}-valid-side-effect`, 1, async () => { calls++; });
  assert.equal(result.reason, "completed");
  assert.equal(calls, 1);
  const remaining = await db.select().from(jobExecutionLocks).where(and(
    eq(jobExecutionLocks.orgId, "org-a"), eq(jobExecutionLocks.jobName, `${prefix}-valid-side-effect`),
  ));
  assert.equal(remaining.length, 0);
});
