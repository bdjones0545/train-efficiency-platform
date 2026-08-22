import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
const { Pool } = pg;
const pool = new Pool({ connectionString });
const reliability = await import("../services/retry-reliability");
const deadLetters = await import("../services/agent-dead-letter-service");

before(async () => {
  await pool.query(`DROP TABLE IF EXISTS agent_dead_letter_effects,agent_dead_letter_queue,provider_circuit_breakers CASCADE`);
  await reliability.ensureProviderCircuitSchema(pool);
  await deadLetters.ensureAgentDeadLetterSchema();
});
beforeEach(async () => {
  await pool.query(`TRUNCATE provider_circuit_breakers,agent_dead_letter_queue CASCADE`);
});
after(async () => { await pool.end(); });

test("jitter preserves base floor, maximum bound, and deterministic RNG seam", () => {
  assert.equal(reliability.jitteredDelayMs(1000, () => 0), 1000);
  assert.equal(reliability.jitteredDelayMs(1000, () => 1), 1200);
  assert.equal(reliability.jitteredDelayMs(1000, () => 0.5), 1100);
});

test("twenty independent retry delays are distributed and bounded", () => {
  const delays = Array.from({ length: 20 }, (_, index) =>
    reliability.jitteredDelayMs(300_000, () => index / 19));
  assert.equal(new Set(delays).size, 20);
  assert.ok(Math.min(...delays) >= 300_000);
  assert.ok(Math.max(...delays) <= 360_000);
});

test("twenty jittered due times are persisted with restart-safe distribution", async () => {
  let index = 0;
  const random = () => index++ / 19;
  await Promise.all(Array.from({ length: 20 }, (_, item) => deadLetters.pushToDeadLetter({
    jobName: "distribution", orgId: "org-a", error: "outage", payload: { item }, retryRandom: random,
  })));
  const result = await pool.query(`SELECT count(DISTINCT next_retry_at)::int distinct_due,
    EXTRACT(EPOCH FROM (MAX(next_retry_at)-MIN(next_retry_at)))::float8 spread_seconds
    FROM agent_dead_letter_queue`);
  assert.equal(result.rows[0].distinct_due, 20);
  assert.ok(Number(result.rows[0].spread_seconds) >= 59);
});

test("breaker starts closed", async () => {
  assert.deepEqual(await reliability.acquireCircuitPermit("provider:closed", pool), { allowed: true, state: "closed" });
});

test("three concurrent systemic failures converge to OPEN", async () => {
  const key = "provider:threshold";
  const permits = await Promise.all([1,2,3].map(() => reliability.acquireCircuitPermit(key, pool)));
  await Promise.all(permits.map(permit => reliability.recordCircuitFailure(key, Object.assign(new Error("unavailable"), { status: 503 }), permit, pool)));
  const blocked = await reliability.acquireCircuitPermit(key, pool);
  assert.equal(blocked.allowed, false); assert.equal(blocked.state, "open");
});

test("OPEN suppresses provider calls", async () => {
  const key = "provider:suppress";
  for (let index=0; index<3; index++) {
    const permit = await reliability.acquireCircuitPermit(key, pool);
    await reliability.recordCircuitFailure(key, Object.assign(new Error("timeout"), { status: 503 }), permit, pool);
  }
  let calls = 0;
  await assert.rejects(reliability.executeWithCircuitBreaker(key, async () => { calls++; }, pool), reliability.CircuitOpenError);
  assert.equal(calls, 0);
});

test("twenty outage jobs make only threshold-bounded provider calls", async () => {
  const key = "provider:herd"; let calls = 0;
  for (let index=0; index<20; index++) {
    await reliability.executeWithCircuitBreaker(key, async () => {
      calls++;
      throw Object.assign(new Error("provider unavailable"), { status: 503 });
    }, pool).catch(() => undefined);
  }
  assert.equal(calls, 3);
});

test("cooldown permits exactly one HALF_OPEN probe across three workers", async () => {
  const key = "provider:probe";
  await pool.query(`INSERT INTO provider_circuit_breakers(dependency_key,state,failure_count,opened_at)
    VALUES($1,'open',3,NOW()-INTERVAL '2 minutes')`, [key]);
  const permits = await Promise.all([1,2,3].map(() => reliability.acquireCircuitPermit(key, pool, { cooldownMs: 60_000 })));
  assert.equal(permits.filter(permit => permit.allowed).length, 1);
  assert.equal(permits.find(permit => permit.allowed)?.state, "half_open");
});

test("successful HALF_OPEN probe closes the breaker", async () => {
  const key = "provider:recover";
  await pool.query(`INSERT INTO provider_circuit_breakers(dependency_key,state,failure_count,opened_at)
    VALUES($1,'open',3,NOW()-INTERVAL '2 minutes')`, [key]);
  const permit = await reliability.acquireCircuitPermit(key, pool);
  await reliability.recordCircuitSuccess(key, permit, pool);
  assert.equal((await pool.query(`SELECT state,failure_count FROM provider_circuit_breakers WHERE dependency_key=$1`, [key])).rows[0].state, "closed");
});

test("failed HALF_OPEN probe reopens and resets cooldown", async () => {
  const key = "provider:reopen";
  await pool.query(`INSERT INTO provider_circuit_breakers(dependency_key,state,failure_count,opened_at)
    VALUES($1,'open',3,NOW()-INTERVAL '2 minutes')`, [key]);
  const permit = await reliability.acquireCircuitPermit(key, pool);
  await reliability.recordCircuitFailure(key, Object.assign(new Error("timeout"), { status: 504 }), permit, pool);
  const row = (await pool.query(`SELECT state,opened_at FROM provider_circuit_breakers WHERE dependency_key=$1`, [key])).rows[0];
  assert.equal(row.state, "open"); assert.ok(new Date(row.opened_at).getTime() > Date.now()-5000);
});

test("permanent request failures do not trip a shared breaker", async () => {
  const key = "provider:permanent";
  for (let index=0; index<5; index++) {
    const permit = await reliability.acquireCircuitPermit(key, pool);
    await reliability.recordCircuitFailure(key, Object.assign(new Error("invalid recipient"), { status: 422 }), permit, pool);
  }
  assert.equal((await reliability.acquireCircuitPermit(key, pool)).state, "closed");
});

test("OPEN state is durable and shared by independent pool instances", async () => {
  const key = "provider:shared";
  await pool.query(`INSERT INTO provider_circuit_breakers(dependency_key,state,failure_count,opened_at) VALUES($1,'open',3,NOW())`, [key]);
  const pools = [new Pool({ connectionString }),new Pool({ connectionString }),new Pool({ connectionString })];
  const permits = await Promise.all(pools.map(db => reliability.acquireCircuitPermit(key, db)));
  assert.equal(permits.every(permit => !permit.allowed && permit.state === "open"), true);
  await Promise.all(pools.map(db => db.end()));
});

test("OPEN dead-letter dependency defers work without provider call or attempt consumption", async () => {
  const key = "provider:agent_model";
  await pool.query(`INSERT INTO provider_circuit_breakers(dependency_key,state,failure_count,opened_at) VALUES($1,'open',3,NOW())`, [key]);
  let calls = 0;
  const unregister = deadLetters.registerDeadLetterReplayHandler("model_work", async () => { calls++; }, { dependencyKey: key });
  const id = await deadLetters.pushToDeadLetter({ jobName: "model_work", orgId: "org-a", error: "queued" });
  await pool.query(`UPDATE agent_dead_letter_queue SET next_retry_at=NOW() WHERE id=$1`, [id]);
  assert.equal(await deadLetters.processOneDeadLetterJob("worker"), true);
  const row = (await pool.query(`SELECT status,retry_count,next_retry_at FROM agent_dead_letter_queue WHERE id=$1`, [id])).rows[0];
  assert.equal(calls, 0); assert.equal(row.status, "retrying"); assert.equal(row.retry_count, 0); assert.ok(row.next_retry_at);
  unregister();
});

test("one successful probe closes breaker and deferred queue work resumes", async () => {
  const key = "provider:resume"; let calls = 0;
  await pool.query(`INSERT INTO provider_circuit_breakers(dependency_key,state,failure_count,opened_at) VALUES($1,'open',3,NOW()-INTERVAL '2 minutes')`, [key]);
  const unregister = deadLetters.registerDeadLetterReplayHandler("resume_work", async () => { calls++; }, { dependencyKey: key });
  const id = await deadLetters.pushToDeadLetter({ jobName: "resume_work", orgId: "org-a", error: "queued" });
  await pool.query(`UPDATE agent_dead_letter_queue SET next_retry_at=NOW() WHERE id=$1`, [id]);
  await deadLetters.processOneDeadLetterJob("worker");
  assert.equal(calls, 1);
  assert.equal((await pool.query(`SELECT status FROM agent_dead_letter_queue WHERE id=$1`, [id])).rows[0].status, "resolved");
  assert.equal((await pool.query(`SELECT state FROM provider_circuit_breakers WHERE dependency_key=$1`, [key])).rows[0].state, "closed");
  unregister();
});
