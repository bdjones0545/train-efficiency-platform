import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
const { Pool } = pg;
const pool = new Pool({ connectionString });
const queue = await import("../workflow-job-queue");

const input = (orgId: string, idempotencyKey?: string) => ({
  orgId, jobType: "workflow_step" as const, payload: { orgId }, idempotencyKey,
});
const count = async (where = "TRUE") => Number((await pool.query(
  `SELECT count(*)::int n FROM workflow_jobs WHERE ${where}`)).rows[0].n);
const job = async (id: string) => (await pool.query(`SELECT * FROM workflow_jobs WHERE id=$1`, [id])).rows[0];
const makeDue = async (id: string) => {
  await pool.query(`UPDATE workflow_jobs SET scheduled_for=NOW()-INTERVAL '1 second' WHERE id=$1`, [id]);
};

before(async () => {
  await pool.query(`DROP TABLE IF EXISTS workflow_job_effects,workflow_jobs,business_effects,agent_execution_locks,unified_agent_action_log CASCADE;
    CREATE TABLE workflow_jobs(
      id text primary key,org_id text not null,workflow_run_id text,workflow_step_id text,
      job_type text not null default 'workflow_step',status text not null default 'queued',
      priority text not null default 'normal',scheduled_for timestamp default now(),started_at timestamp,
      completed_at timestamp,failed_at timestamp,attempts int default 0,max_attempts int default 3,
      next_retry_at timestamp,retry_backoff_ms int default 5000,last_error text,error_type text,
      payload jsonb,result jsonb,idempotency_key text unique,locked_by text,locked_at timestamp,
      execution_generation int not null default 0,created_at timestamp default now(),updated_at timestamp default now());
    CREATE TABLE business_effects(id text primary key,org_id text not null,job_id text not null);
    CREATE TABLE agent_execution_locks(id text primary key,org_id text not null,lock_key text not null unique,
      entity_type text,entity_id text,workflow_run_id text,locked_by text not null,expires_at timestamp not null,created_at timestamp default now());
    CREATE TABLE unified_agent_action_log(id text primary key default gen_random_uuid()::text,org_id text not null,
      actor_type text not null default 'system',actor_name text,action_type text not null,entity_type text,entity_id text,
      workflow_run_id text,tool_name text,status text not null default 'completed',confidence_score double precision,
      risk_level text,input_snapshot jsonb,output_snapshot jsonb,reasoning_summary text,error_message text,
      rollback_available boolean default false,created_at timestamp default now());`);
  await queue.ensureWorkflowJobIdempotencySchema();
  await queue.ensureWorkflowJobReliabilitySchema();
});
beforeEach(async () => {
  await pool.query(`TRUNCATE workflow_job_effects,workflow_jobs,business_effects,unified_agent_action_log`);
});
after(async () => { await pool.end(); });

test("Org A first enqueue creates one tenant-owned job", async () => {
  const result = await queue.enqueueWorkflowJob(input("org-a", "same-business-action-123"));
  assert.equal(result.duplicate, undefined); const saved = await job(result.jobId);
  assert.equal(saved.org_id, "org-a"); assert.equal(saved.payload_version, 1);
  assert.equal(await count(), 1);
});

test("Org A sequential duplicate reuses its canonical job", async () => {
  const first = await queue.enqueueWorkflowJob(input("org-a", "same"));
  const second = await queue.enqueueWorkflowJob(input("org-a", "same"));
  assert.equal(second.duplicate, true); assert.equal(second.jobId, first.jobId); assert.equal(await count(), 1);
});

test("Org B may use Org A's raw key without collision", async () => {
  const a = await queue.enqueueWorkflowJob(input("org-a", "shared"));
  const b = await queue.enqueueWorkflowJob(input("org-b", "shared"));
  assert.notEqual(a.jobId, b.jobId); assert.equal(await count("idempotency_key='shared'"), 2);
});

test("concurrent Org A and Org B enqueues with one key create two jobs", async () => {
  const [a, b] = await Promise.all([
    queue.enqueueWorkflowJob(input("org-a", "cross-race")),
    queue.enqueueWorkflowJob(input("org-b", "cross-race")),
  ]);
  assert.notEqual(a.jobId, b.jobId); assert.equal(await count("idempotency_key='cross-race'"), 2);
  assert.equal(await count("org_id='org-a'"), 1); assert.equal(await count("org_id='org-b'"), 1);
});

test("three concurrent same-tenant enqueues resolve to one canonical job", async () => {
  const results = await Promise.all([1, 2, 3].map(() => queue.enqueueWorkflowJob(input("org-a", "same-race"))));
  assert.equal(new Set(results.map(result => result.jobId)).size, 1);
  assert.equal(await count("org_id='org-a' AND idempotency_key='same-race'"), 1);
});

test("same-tenant existing-job lookup never returns another tenant's row", async () => {
  const b = await queue.enqueueWorkflowJob(input("org-b", "lookup"));
  const a1 = await queue.enqueueWorkflowJob(input("org-a", "lookup"));
  const a2 = await queue.enqueueWorkflowJob(input("org-a", "lookup"));
  assert.notEqual(a1.jobId, b.jobId); assert.equal(a2.jobId, a1.jobId);
  assert.equal((await job(a2.jobId)).org_id, "org-a");
});

test("different keys in one organization create separate jobs", async () => {
  const a = await queue.enqueueWorkflowJob(input("org-a", "key-a"));
  const b = await queue.enqueueWorkflowJob(input("org-a", "key-b"));
  assert.notEqual(a.jobId, b.jobId); assert.equal(await count("org_id='org-a'"), 2);
});

test("NULL idempotency keys preserve independent enqueue behavior", async () => {
  const a = await queue.enqueueWorkflowJob(input("org-a"));
  const b = await queue.enqueueWorkflowJob(input("org-a"));
  assert.notEqual(a.jobId, b.jobId); assert.equal(await count("idempotency_key IS NULL"), 2);
});

test("ordinary retry remains compatible with organization-scoped enqueue identity", async () => {
  const created = await queue.enqueueWorkflowJob({ ...input("org-a", "retry"), maxAttempts: 3 });
  await makeDue(created.jobId);
  const claimed = await queue.claimNextJob("org-a", "worker"); assert.equal(claimed?.id, created.jobId);
  assert.equal(await queue.failWorkflowJob(created.jobId, "temporary", "transient", "worker"), true);
  const saved = await job(created.jobId); assert.equal(saved.status, "retrying"); assert.equal(saved.attempts, 1);
});

test("dead-letter replay retains job identity and advances generation", async () => {
  const created = await queue.enqueueWorkflowJob({ ...input("org-a", "replay"), maxAttempts: 1 });
  await makeDue(created.jobId);
  const claimed = await queue.claimNextJob("org-a", "worker"); assert.ok(claimed);
  await queue.failWorkflowJob(created.jobId, "terminal", "transient", "worker");
  assert.equal((await queue.retryDeadLetterJob(created.jobId, "org-a", "admin")).ok, true);
  const saved = await job(created.jobId); assert.equal(saved.execution_generation, 1); assert.equal(saved.status, "queued");
});

test("effect identity remains organization and execution-generation scoped", async () => {
  const created = await queue.enqueueWorkflowJob(input("org-a", "effect"));
  await makeDue(created.jobId);
  const claimed = await queue.claimNextJob("org-a", "worker"); assert.ok(claimed);
  let calls = 0;
  const first = await queue.executeWorkflowJobEffect(claimed!, "execution", async () => { calls++; return { ok: true }; });
  const second = await queue.executeWorkflowJobEffect(claimed!, "execution", async () => { calls++; return { duplicate: true }; });
  assert.equal(first.executed, true); assert.equal(second.executed, false); assert.equal(calls, 1);
  const effect = (await pool.query(`SELECT org_id,workflow_job_id,execution_generation FROM workflow_job_effects`)).rows[0];
  assert.deepEqual(effect, { org_id: "org-a", workflow_job_id: created.jobId, execution_generation: 0 });
});

test("admin enqueue route gives authenticated organization precedence over body", () => {
  const source = fs.readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/job-queue/enqueue"');
  const route = source.slice(start, start + 900);
  assert.ok(start > 0); assert.match(route, /enqueueWorkflowJob\(\{ \.\.\.req\.body, orgId \}\)/);
  assert.doesNotMatch(route, /enqueueWorkflowJob\(\{ orgId: orgId, \.\.\.req\.body \}\)/);
});
