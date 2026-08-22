import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
const { Pool } = pg;
const pool = new Pool({ connectionString });
const queue = await import("../workflow-job-queue");

async function insertJob(id: string, orgId = "org-a", status = "queued", maxAttempts = 3) {
  await pool.query(`INSERT INTO workflow_jobs
    (id,org_id,job_type,status,priority,scheduled_for,attempts,max_attempts,payload,execution_generation)
    VALUES($1,$2,'workflow_step',$3,'normal',NOW(),0,$4,'{}',0)`, [id, orgId, status, maxAttempts]);
}
async function row(id: string) {
  return (await pool.query(`SELECT * FROM workflow_jobs WHERE id=$1`, [id])).rows[0];
}
async function expire(id: string) {
  await pool.query(`UPDATE workflow_jobs SET locked_at=NOW()-INTERVAL '6 minutes' WHERE id=$1`, [id]);
}

before(async () => {
  await pool.query(`DROP TABLE IF EXISTS workflow_job_effects,workflow_jobs,business_effects,agent_execution_locks,unified_agent_action_log CASCADE;
    CREATE TABLE workflow_jobs(
      id text primary key,org_id text not null,workflow_run_id text,workflow_step_id text,
      job_type text not null default 'workflow_step',status text not null default 'queued',
      priority text not null default 'normal',scheduled_for timestamp default now(),started_at timestamp,
      completed_at timestamp,failed_at timestamp,attempts int default 0,max_attempts int default 3,
      next_retry_at timestamp,retry_backoff_ms int default 5000,last_error text,error_type text,
      payload jsonb,result jsonb,idempotency_key text unique,locked_by text,locked_at timestamp,
      created_at timestamp default now(),updated_at timestamp default now());
    CREATE TABLE business_effects(id text primary key,org_id text not null,job_id text not null);
    CREATE TABLE agent_execution_locks(id text primary key,org_id text not null,lock_key text not null unique,
      entity_type text,entity_id text,workflow_run_id text,locked_by text not null,expires_at timestamp not null,created_at timestamp default now());
    CREATE TABLE unified_agent_action_log(id text primary key,org_id text not null,actor_type text not null default 'system',
      actor_name text,action_type text not null,entity_type text,entity_id text,workflow_run_id text,tool_name text,
      status text not null default 'completed',confidence_score double precision,risk_level text,input_snapshot jsonb,
      output_snapshot jsonb,reasoning_summary text,error_message text,rollback_available boolean default false,created_at timestamp default now());`);
  await queue.ensureWorkflowJobReliabilitySchema();
});
beforeEach(async () => {
  await pool.query(`TRUNCATE workflow_job_effects,workflow_jobs,business_effects`);
});
after(async () => { await pool.end(); });

test("three queued workers produce one claim, effect, completion, and terminal job", async () => {
  await insertJob("queued-race");
  const claims = await Promise.all(["a", "b", "c"].map(w => queue.claimNextJob("org-a", w)));
  const winners = claims.filter(Boolean);
  assert.equal(winners.length, 1);
  let effects = 0;
  const winner = winners[0]!;
  const effect = await queue.executeWorkflowJobEffect(winner, "execution", async () => { effects++; return { ok: true }; });
  assert.equal(await queue.completeWorkflowJob(winner.id, effect.result, winner.lockedBy!), true);
  assert.equal(effects, 1);
  assert.equal((await row(winner.id)).status, "completed");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM workflow_job_effects WHERE state='completed'`)).rows[0].n, 1);
});

test("stale candidate cannot revive a completed job", async () => {
  await insertJob("stale-candidate");
  const a = await queue.claimNextJob("org-a", "worker-a"); assert.ok(a);
  await queue.executeWorkflowJobEffect(a!, "execution", async () => ({ ok: true }));
  assert.equal(await queue.completeWorkflowJob(a!.id, { ok: true }, "worker-a"), true);
  assert.equal(await queue.claimNextJob("org-a", "worker-b"), null);
  assert.equal((await row(a!.id)).status, "completed");
});

test("stale worker completion is rejected after reclaim", async () => {
  await insertJob("stale-complete");
  const a = await queue.claimNextJob("org-a", "worker-a"); assert.ok(a); await expire(a!.id);
  const b = await queue.claimNextJob("org-a", "worker-b"); assert.ok(b);
  assert.equal(await queue.completeWorkflowJob(a!.id, { stale: true }, "worker-a"), false);
  assert.equal((await row(a!.id)).locked_by, "worker-b");
  await queue.executeWorkflowJobEffect(b!, "execution", async () => ({ owner: "b" }));
  assert.equal(await queue.completeWorkflowJob(b!.id, { owner: "b" }, "worker-b"), true);
});

test("stale worker failure is rejected after reclaim", async () => {
  await insertJob("stale-fail");
  const a = await queue.claimNextJob("org-a", "worker-a"); assert.ok(a); await expire(a!.id);
  const b = await queue.claimNextJob("org-a", "worker-b"); assert.ok(b);
  assert.equal(await queue.failWorkflowJob(a!.id, "stale", "transient", "worker-a"), false);
  const current = await row(a!.id); assert.equal(current.status, "running"); assert.equal(current.locked_by, "worker-b");
});

test("crash after claim recovers after the five-minute lease", async () => {
  await insertJob("claim-crash");
  const a = await queue.claimNextJob("org-a", "worker-a"); assert.ok(a); await expire(a!.id);
  const b = await queue.claimNextJob("org-a", "worker-b"); assert.ok(b);
  let effects = 0;
  const effect = await queue.executeWorkflowJobEffect(b!, "execution", async () => { effects++; return { recovered: true }; });
  await queue.completeWorkflowJob(b!.id, effect.result, "worker-b");
  assert.equal(effects, 1); assert.equal((await row(b!.id)).status, "completed");
  assert.equal(await queue.completeWorkflowJob(a!.id, { stale: true }, "worker-a"), false);
});

test("three workers contending for an expired lease have one reclaim winner", async () => {
  await insertJob("lease-race");
  const first = await queue.claimNextJob("org-a", "old"); assert.ok(first); await expire(first!.id);
  const claims = await Promise.all(["a", "b", "c"].map(w => queue.claimNextJob("org-a", w)));
  assert.equal(claims.filter(Boolean).length, 1);
});

test("crash after transactional DB effect recovers without duplicating mutation", async () => {
  await insertJob("db-effect");
  const a = await queue.claimNextJob("org-a", "worker-a"); assert.ok(a);
  await queue.executeTransactionalWorkflowJobEffect(a!, "db-write", async client => {
    await client.query(`INSERT INTO business_effects(id,org_id,job_id) VALUES('effect-1','org-a',$1)`, [a!.id]);
    return { inserted: true };
  });
  await expire(a!.id);
  const b = await queue.claimNextJob("org-a", "worker-b"); assert.ok(b);
  let repeated = 0;
  const recovered = await queue.executeTransactionalWorkflowJobEffect(b!, "db-write", async () => { repeated++; return {}; });
  assert.equal(recovered.executed, false); assert.equal(repeated, 0);
  await queue.completeWorkflowJob(b!.id, recovered.result, "worker-b");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM business_effects`)).rows[0].n, 1);
});

test("durable generic effect suppresses recovery invocation after recorded success", async () => {
  await insertJob("generic-effect");
  const a = await queue.claimNextJob("org-a", "worker-a"); assert.ok(a);
  let calls = 0;
  await assert.rejects(queue.executeWorkflowJobEffect(a!, "execution", async () => { calls++; return { ok: true }; }, async () => { throw new Error("crash"); }), /crash/);
  await expire(a!.id);
  const b = await queue.claimNextJob("org-a", "worker-b"); assert.ok(b);
  const recovered = await queue.executeWorkflowJobEffect(b!, "execution", async () => { calls++; return {}; });
  await queue.completeWorkflowJob(b!.id, recovered.result, "worker-b");
  assert.equal(calls, 1); assert.equal(recovered.executed, false);
});

test("completed and cancelled jobs remain immutable to ordinary claims", async () => {
  await insertJob("done", "org-a", "completed"); await insertJob("cancelled", "org-a", "cancelled");
  assert.equal(await queue.claimNextJob("org-a", "worker"), null);
  assert.equal((await row("done")).status, "completed"); assert.equal((await row("cancelled")).status, "cancelled");
});

test("non-due retry cannot be claimed and due retry can", async () => {
  await insertJob("retry", "org-a", "retrying");
  await pool.query(`UPDATE workflow_jobs SET scheduled_for=NOW()+INTERVAL '1 hour' WHERE id='retry'`);
  assert.equal(await queue.claimNextJob("org-a", "worker"), null);
  await pool.query(`UPDATE workflow_jobs SET scheduled_for=NOW()-INTERVAL '1 second' WHERE id='retry'`);
  assert.ok(await queue.claimNextJob("org-a", "worker"));
});

test("retry attempts exhaust into terminal dead letter", async () => {
  await insertJob("dead", "org-a", "queued", 1);
  const job = await queue.claimNextJob("org-a", "worker"); assert.ok(job);
  assert.equal(await queue.failWorkflowJob(job!.id, "fatal", "transient", "worker"), true);
  const dead = await row(job!.id); assert.equal(dead.status, "dead_letter"); assert.equal(dead.last_error, "fatal");
  assert.equal(await queue.claimNextJob("org-a", "other"), null);
});

test("manual replay is tenant scoped, clears ownership, and advances effect generation", async () => {
  await insertJob("tenant-replay", "org-b", "queued", 1);
  const failed = await queue.claimNextJob("org-b", "failed-worker"); assert.ok(failed);
  await assert.rejects(queue.executeWorkflowJobEffect(failed!, "execution", async () => { throw new Error("retained failure"); }), /retained failure/);
  await queue.failWorkflowJob(failed!.id, "retained failure", "transient", "failed-worker");
  assert.equal((await queue.retryDeadLetterJob("tenant-replay", "org-a", "admin-a")).ok, false);
  assert.equal((await queue.retryDeadLetterJob("tenant-replay", "org-b", "admin-b")).ok, true);
  const replayed = await row("tenant-replay");
  assert.equal(replayed.status, "queued"); assert.equal(replayed.locked_by, null); assert.equal(replayed.execution_generation, 1);
  const history = (await pool.query(`SELECT state,attempt_count,last_error FROM workflow_job_effects
    WHERE workflow_job_id='tenant-replay' AND execution_generation=0`)).rows[0];
  assert.equal(history.state, "failed"); assert.equal(history.attempt_count, 1); assert.equal(history.last_error, "retained failure");
});

test("explicit replay generation permits an intentional new effect without confusing recovery", async () => {
  await insertJob("generation");
  const first = await queue.claimNextJob("org-a", "worker-a"); assert.ok(first);
  let effects = 0; await queue.executeWorkflowJobEffect(first!, "execution", async () => { effects++; return {}; });
  await queue.failWorkflowJob(first!.id, "operator replay", "fatal", "worker-a");
  await queue.retryDeadLetterJob(first!.id, "org-a", "admin");
  const second = await queue.claimNextJob("org-a", "worker-b"); assert.ok(second);
  await queue.executeWorkflowJobEffect(second!, "execution", async () => { effects++; return {}; });
  assert.equal(effects, 2);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM workflow_job_effects WHERE workflow_job_id='generation'`)).rows[0].n, 2);
});

test("tenant-scoped claim cannot use an Org B job ID under Org A", async () => {
  await insertJob("org-b-job", "org-b");
  assert.equal(await queue.claimNextJob("org-a", "worker-a"), null);
  const b = await queue.claimNextJob("org-b", "worker-b"); assert.ok(b); assert.equal(b!.orgId, "org-b");
});

test("stuck sweep cannot overwrite a newer reclaim owner", async () => {
  await insertJob("sweep-race");
  const old = await queue.claimNextJob("org-a", "old"); assert.ok(old); await expire(old!.id);
  const newer = await queue.claimNextJob("org-a", "new"); assert.ok(newer);
  const sweep = await queue.detectAndHandleStuckJobs();
  assert.equal(sweep.fixedCount, 0);
  const current = await row(old!.id); assert.equal(current.status, "running"); assert.equal(current.locked_by, "new");
});
