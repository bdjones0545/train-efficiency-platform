import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
const { Pool } = pg;
const pool = new Pool({ connectionString });
const queue = await import("../services/agent-dead-letter-service");

async function push(id: string, orgId = "org-a", maxRetries = 3, jobName = "test_work") {
  await pool.query(`INSERT INTO agent_dead_letter_queue
    (id,job_name,org_id,error_message,max_retries,next_retry_at,status,payload)
    VALUES($1,$2,$3,'failed',$4,NOW(),'pending',$5)`, [id, jobName, orgId, maxRetries, { identity: id }]);
}
async function row(id: string) {
  return (await pool.query(`SELECT * FROM agent_dead_letter_queue WHERE id=$1`, [id])).rows[0];
}
async function expire(id: string) {
  await pool.query(`UPDATE agent_dead_letter_queue SET locked_at=NOW()-INTERVAL '6 minutes' WHERE id=$1`, [id]);
}
async function retryDelaySeconds(id: string): Promise<number | null> {
  const result = await pool.query(`SELECT EXTRACT(EPOCH FROM (next_retry_at-NOW()))::float8 AS seconds
    FROM agent_dead_letter_queue WHERE id=$1`, [id]);
  return result.rows[0].seconds === null ? null : Number(result.rows[0].seconds);
}
function assertDelay(actual: number | null, expected: number) {
  assert.ok(actual !== null && actual >= expected - 5 && actual <= expected + 1,
    `expected persisted retry delay near ${expected}s, got ${actual}`);
}

before(async () => {
  await pool.query(`DROP TABLE IF EXISTS agent_dead_letter_effects,agent_dead_letter_queue,test_effects,gmail_agent_actions CASCADE`);
  await queue.ensureAgentDeadLetterSchema();
  await pool.query(`CREATE TABLE test_effects(id text primary key, org_id text not null, calls int not null default 1);
    CREATE TABLE gmail_agent_actions(id text primary key,org_id text not null,status text not null)`);
});
beforeEach(async () => {
  await pool.query(`TRUNCATE agent_dead_letter_effects,agent_dead_letter_queue,test_effects,gmail_agent_actions`);
  queue.registerDeadLetterReplayHandler("test_work", async job => {
    await pool.query(`INSERT INTO test_effects(id,org_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING`,
      [`${job.id}:${job.executionGeneration}`, job.orgId]);
  });
});
after(async () => { await pool.end(); });

test("real production writer creates tenant-owned retryable work", async () => {
  const id = await queue.pushToDeadLetter({ jobName: "test_work", orgId: "org-a", error: "boom", payload: { identity: "x" } });
  assert.ok(id); const saved = await row(id!); assert.equal(saved.org_id, "org-a"); assert.equal(saved.status, "pending");
});

test("atomic claim has one winner", async () => {
  await push("one"); assert.ok(await queue.claimDeadLetterJob("a")); assert.equal(await queue.claimDeadLetterJob("b"), null);
});

test("three-worker contention has one winner", async () => {
  await push("race"); const claims = await Promise.all(["a","b","c"].map(w => queue.claimDeadLetterJob(w)));
  assert.equal(claims.filter(Boolean).length, 1);
});

test("lease is not reclaimed before expiry", async () => {
  await push("fresh"); await queue.claimDeadLetterJob("a"); assert.equal(await queue.claimDeadLetterJob("b"), null);
});

test("crash before work is reclaimed after lease expiry", async () => {
  await push("before"); assert.ok(await queue.claimDeadLetterJob("old")); await expire("before");
  assert.equal(await queue.processOneDeadLetterJob("new"), true); assert.equal((await row("before")).status, "resolved");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM test_effects`)).rows[0].n, 1);
});

test("three workers reclaim one expired lease once", async () => {
  await push("expired-race"); await queue.claimDeadLetterJob("old"); await expire("expired-race");
  const claims = await Promise.all(["a","b","c"].map(w => queue.claimDeadLetterJob(w)));
  assert.equal(claims.filter(Boolean).length, 1);
});

test("successful replay resolves and clears ownership", async () => {
  await push("success"); await queue.processOneDeadLetterJob("worker"); const saved = await row("success");
  assert.equal(saved.status, "resolved"); assert.equal(saved.locked_by, null); assert.ok(saved.completed_at);
});

test("crash after idempotent business success does not duplicate effect", async () => {
  await push("after"); const claimed = await queue.claimDeadLetterJob("old"); assert.ok(claimed);
  await pool.query(`INSERT INTO test_effects(id,org_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING`, ["after:0", "org-a"]);
  await expire("after"); await queue.processOneDeadLetterJob("new");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM test_effects WHERE id='after:0'`)).rows[0].n, 1);
  assert.equal((await row("after")).status, "resolved");
});

test("production action requeue and effect marker are atomic and recovery-safe", async () => {
  await pool.query(`INSERT INTO gmail_agent_actions VALUES('action-a','org-a','awaiting_approval')`);
  await pool.query(`INSERT INTO agent_dead_letter_queue(id,job_name,org_id,error_message,next_retry_at,payload)
    VALUES('production','agent_action_executor','org-a','x',NOW(),'{"actionId":"action-a","orgId":"org-a"}')`);
  const old = await queue.claimDeadLetterJob("old"); assert.ok(old);
  await queue.requeueAgentActionDeadLetter(old!); // crash before queue completion
  await pool.query(`UPDATE gmail_agent_actions SET status='awaiting_approval' WHERE id='action-a'`); // normal executor completed
  await expire("production"); const recovered = await queue.claimDeadLetterJob("new"); assert.ok(recovered);
  await queue.requeueAgentActionDeadLetter(recovered!); await queue.completeDeadLetterJob(recovered!);
  assert.equal((await pool.query(`SELECT status FROM gmail_agent_actions WHERE id='action-a'`)).rows[0].status, "awaiting_approval");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM agent_dead_letter_effects WHERE dead_letter_id='production'`)).rows[0].n, 1);
  assert.equal((await row("production")).status, "resolved");
});

test("transient failure persists attempt and future retry", async () => {
  await push("transient"); queue.registerDeadLetterReplayHandler("test_work", async () => { throw new Error("temporary"); });
  await queue.processOneDeadLetterJob("worker"); const saved = await row("transient");
  assert.equal(saved.status, "retrying"); assert.equal(saved.retry_count, 1); assert.ok(saved.next_retry_at); assert.equal(saved.error_message, "temporary");
});

test("default retry schedule persists 5m, 15m, 60m, then exhausts across restarts", async () => {
  const id = await queue.pushToDeadLetter({ jobName: "schedule", orgId: "org-a", error: "initial", payload: {} });
  assert.ok(id); assertDelay(await retryDelaySeconds(id!), 300);
  let rediscovered = (await queue.getDeadLetterJobs({ orgId: "org-a" })).find(job => job.id === id);
  assert.equal(rediscovered?.status, "pending"); assert.ok(rediscovered?.nextRetryAt);
  assert.equal(await queue.claimDeadLetterJob("restart-5m", "org-a"), null);

  await pool.query(`UPDATE agent_dead_letter_queue SET next_retry_at=NOW() WHERE id=$1`, [id]);
  let claimed = await queue.claimDeadLetterJob("failure-1", "org-a"); assert.ok(claimed);
  await queue.failDeadLetterJob(claimed!, "failure one"); assertDelay(await retryDelaySeconds(id!), 900);
  rediscovered = (await queue.getDeadLetterJobs({ orgId: "org-a" })).find(job => job.id === id);
  assert.equal(rediscovered?.retryCount, 1); assert.equal(rediscovered?.status, "retrying");
  assert.equal(await queue.claimDeadLetterJob("restart-15m", "org-a"), null);

  await pool.query(`UPDATE agent_dead_letter_queue SET next_retry_at=NOW() WHERE id=$1`, [id]);
  claimed = await queue.claimDeadLetterJob("failure-2", "org-a"); assert.ok(claimed);
  await queue.failDeadLetterJob(claimed!, "failure two"); assertDelay(await retryDelaySeconds(id!), 3600);
  rediscovered = (await queue.getDeadLetterJobs({ orgId: "org-a" })).find(job => job.id === id);
  assert.equal(rediscovered?.retryCount, 2); assert.equal(rediscovered?.status, "retrying");
  assert.equal(await queue.claimDeadLetterJob("restart-60m", "org-a"), null);

  await pool.query(`UPDATE agent_dead_letter_queue SET next_retry_at=NOW() WHERE id=$1`, [id]);
  claimed = await queue.claimDeadLetterJob("failure-3", "org-a"); assert.ok(claimed);
  await queue.failDeadLetterJob(claimed!, "failure three");
  const exhausted = await row(id!); assert.equal(exhausted.retry_count, 3);
  assert.equal(exhausted.status, "final_failed"); assert.equal(exhausted.next_retry_at, null);
  assert.equal(exhausted.error_message, "failure three");
});

test("bounded attempts exhaust visibly", async () => {
  await push("exhaust", "org-a", 1); queue.registerDeadLetterReplayHandler("test_work", async () => { throw new Error("still broken"); });
  await queue.processOneDeadLetterJob("worker"); const saved = await row("exhaust");
  assert.equal(saved.status, "final_failed"); assert.equal(saved.retry_count, 1); assert.equal(saved.next_retry_at, null); assert.ok(saved.final_failed_at);
});

test("operator replay is tenant-scoped and advances generation", async () => {
  await push("replay", "org-b", 1); await pool.query(`UPDATE agent_dead_letter_queue SET status='final_failed' WHERE id='replay'`);
  assert.equal(await queue.replayDeadLetterJob("replay", "org-a", "admin-a"), false);
  assert.equal(await queue.replayDeadLetterJob("replay", "org-b", "admin-b"), true);
  const saved = await row("replay"); assert.equal(saved.execution_generation, 1); assert.equal(saved.status, "pending"); assert.equal(saved.org_id, "org-b");
});

test("operator replay route derives tenant from authenticated request", () => {
  const source = fs.readFileSync(new URL("../ceo-heartbeat-routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/admin/ceo-heartbeat/dead-letter/:id/replay"');
  const route = source.slice(start, start + 1000);
  assert.ok(start > 0); assert.match(route, /isAuthenticated, requireAdminOrCoach/);
  assert.match(route, /const orgId = await getOrgId\(req\)/); assert.match(route, /replayDeadLetterJob\(req.params.id, orgId/);
});

test("tenant-scoped worker cannot claim another organization", async () => {
  await push("tenant", "org-b"); assert.equal(await queue.claimDeadLetterJob("a", "org-a"), null);
  const claimed = await queue.claimDeadLetterJob("b", "org-b"); assert.equal(claimed?.orgId, "org-b");
});

test("payload tenant identity cannot override durable ownership", async () => {
  await pool.query(`INSERT INTO agent_dead_letter_queue(id,job_name,org_id,error_message,next_retry_at,payload)
    VALUES('spoof','test_work','org-a','x',NOW(),'{"orgId":"org-b"}')`);
  await queue.processOneDeadLetterJob("worker", "org-a");
  assert.equal((await pool.query(`SELECT org_id FROM test_effects`)).rows[0].org_id, "org-a");
});

test("unknown work type becomes terminal without a crash loop", async () => {
  await push("unknown", "org-a", 3, "historical_unknown"); await queue.processOneDeadLetterJob("worker");
  const saved = await row("unknown"); assert.equal(saved.status, "final_failed"); assert.match(saved.error_message, /Unsupported/);
});

test("unsupported auto-execution work becomes terminal without guessed execution", async () => {
  await push("unsupported-auto", "org-a", 3, "auto_execution_engine");
  await queue.processOneDeadLetterJob("worker"); const saved = await row("unsupported-auto");
  assert.equal(saved.status, "final_failed"); assert.match(saved.error_message, /Unsupported/);
  assert.equal(saved.next_retry_at, null);
});

test("malformed handler payload is bounded and remains visible", async () => {
  await push("malformed", "org-a", 1, "strict");
  queue.registerDeadLetterReplayHandler("strict", async job => { if (!(job.payload as any)?.required) throw new Error("Malformed payload"); });
  await queue.processOneDeadLetterJob("worker"); const saved = await row("malformed");
  assert.equal(saved.status, "final_failed"); assert.equal(saved.error_message, "Malformed payload");
});

test("retry timing survives a worker restart", async () => {
  await push("restart"); await pool.query(`UPDATE agent_dead_letter_queue SET status='retrying',next_retry_at=NOW()+INTERVAL '1 hour' WHERE id='restart'`);
  assert.equal(await queue.claimDeadLetterJob("first"), null);
  await pool.query(`UPDATE agent_dead_letter_queue SET next_retry_at=NOW()-INTERVAL '1 second' WHERE id='restart'`);
  assert.ok(await queue.claimDeadLetterJob("restarted"));
});

test("stale worker cannot complete after another worker reclaims", async () => {
  await push("stale"); const old = await queue.claimDeadLetterJob("old"); assert.ok(old); await expire("stale");
  const current = await queue.claimDeadLetterJob("current"); assert.ok(current);
  assert.equal(await queue.completeDeadLetterJob(old!), false); assert.equal((await row("stale")).locked_by, "current");
});
