import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
const { Pool } = pg;
const pool = new Pool({ connectionString });
const versions = await import("../services/durable-payload-versioning");
const deadLetters = await import("../services/agent-dead-letter-service");

before(async () => {
  await pool.query("DROP TABLE IF EXISTS agent_dead_letter_effects,agent_dead_letter_queue CASCADE");
  await deadLetters.ensureAgentDeadLetterSchema();
});
beforeEach(async () => { await pool.query("TRUNCATE agent_dead_letter_queue CASCADE"); });
after(async () => { await pool.end(); });

test("current workflow payload accepts additive metadata", () => {
  const result = versions.normalizeWorkflowPayload({ workType: "notification", version: 1,
    payload: { type: "alert", message: "safe", futureMetadata: true }, authoritativeOrgId: "org-a" });
  assert.equal(result.futureMetadata, true);
});

test("legacy notification migrates renamed field deterministically", () => {
  const result = versions.normalizeWorkflowPayload({ workType: "notification", version: 0,
    payload: { notificationType: "alert", message: "safe" }, authoritativeOrgId: "org-a" });
  assert.equal(result.type, "alert");
});

test("missing version is legacy v0", () => {
  const result = versions.normalizeWorkflowPayload({ workType: "approval_timeout", version: undefined,
    payload: { runId: "run-1" }, authoritativeOrgId: "org-a" });
  assert.equal(result.workflowRunId, "run-1");
});

test("unsupported future workflow version fails visibly", () => {
  assert.throws(() => versions.normalizeWorkflowPayload({ workType: "notification", version: 99,
    payload: { type: "alert", message: "x" }, authoritativeOrgId: "org-a" }), /unsupported version 99/);
});

test("malformed workflow payload fails before execution", () => {
  assert.throws(() => versions.normalizeWorkflowPayload({ workType: "notification", version: 1,
    payload: "bad", authoritativeOrgId: "org-a" }), /must be an object/);
});

test("missing required legacy field is not invented", () => {
  assert.throws(() => versions.normalizeWorkflowPayload({ workType: "notification", version: 0,
    payload: { message: "x" }, authoritativeOrgId: "org-a" }), /requires type and message/);
});

test("unknown workflow type never executes by guess", () => {
  assert.throws(() => versions.normalizeWorkflowPayload({ workType: "future_mutation", version: 1,
    payload: {}, authoritativeOrgId: "org-a" }), /unsupported work type/);
});

test("payload tenant cannot override durable workflow owner", () => {
  assert.throws(() => versions.normalizeWorkflowPayload({ workType: "workflow_step", version: 1,
    payload: { orgId: "org-b" }, authoritativeOrgId: "org-a" }), /does not match durable row owner/);
});

test("new dead-letter writes persist explicit current version", async () => {
  const id = await deadLetters.pushToDeadLetter({ jobName: "known", orgId: "org-a", error: "test", payload: {} });
  const row = (await pool.query("SELECT payload_version FROM agent_dead_letter_queue WHERE id=$1", [id])).rows[0];
  assert.equal(row.payload_version, 1);
});

test("dead-letter tenant spoof becomes visible terminal failure", async () => {
  let calls = 0;
  const unregister = deadLetters.registerDeadLetterReplayHandler("known", async () => { calls++; });
  await pool.query(`INSERT INTO agent_dead_letter_queue(id,job_name,org_id,error_message,next_retry_at,payload_version,payload)
    VALUES('spoof','known','org-a','old',NOW(),0,'{"orgId":"org-b"}')`);
  await deadLetters.processOneDeadLetterJob("worker");
  const row = (await pool.query("SELECT status,error_message FROM agent_dead_letter_queue WHERE id='spoof'")).rows[0];
  unregister();
  assert.equal(calls, 0); assert.equal(row.status, "final_failed");
  assert.match(row.error_message, /does not match durable row owner/);
});

test("mixed-version queue continues after malformed and future rows", async () => {
  const calls: string[] = [];
  const unregister = deadLetters.registerDeadLetterReplayHandler("known", async job => { calls.push(job.id); });
  await pool.query(`INSERT INTO agent_dead_letter_queue
    (id,job_name,org_id,error_message,next_retry_at,payload_version,payload,created_at) VALUES
    ('legacy','known','org-a','old',NOW(),0,'{}',NOW()-INTERVAL '5 seconds'),
    ('malformed','known','org-a','old',NOW(),1,'[]',NOW()-INTERVAL '4 seconds'),
    ('future','known','org-a','old',NOW(),99,'{}',NOW()-INTERVAL '3 seconds'),
    ('unknown','unknown_type','org-a','old',NOW(),1,'{}',NOW()-INTERVAL '2 seconds'),
    ('current','known','org-a','old',NOW(),1,'{"extra":true}',NOW()-INTERVAL '1 second')`);
  for (let index = 0; index < 5; index++) await deadLetters.processOneDeadLetterJob(`worker-${index}`);
  const rows = (await pool.query("SELECT id,status FROM agent_dead_letter_queue ORDER BY id")).rows;
  unregister();
  assert.deepEqual(calls, ["legacy", "current"]);
  assert.equal(rows.filter(row => row.status === "resolved").length, 2);
  assert.equal(rows.filter(row => row.status === "final_failed").length, 3);
});

test("unsupported rows remain terminal across worker restart", async () => {
  await pool.query(`INSERT INTO agent_dead_letter_queue(id,job_name,org_id,error_message,next_retry_at,payload_version,payload)
    VALUES('future','known','org-a','old',NOW(),99,'{}')`);
  const unregister = deadLetters.registerDeadLetterReplayHandler("known", async () => assert.fail("must not execute"));
  await deadLetters.processOneDeadLetterJob("old-process");
  assert.equal(await deadLetters.processOneDeadLetterJob("new-process"), false);
  unregister();
});

test("deploy-boundary legacy writer is migrated by current reader", async () => {
  let observed: unknown;
  const unregister = deadLetters.registerDeadLetterReplayHandler("known", async job => { observed = job.payload; });
  await pool.query(`INSERT INTO agent_dead_letter_queue(id,job_name,org_id,error_message,next_retry_at,payload)
    VALUES('old-writer','known','org-a','old',NOW(),'{"legacyField":"preserved"}')`);
  await deadLetters.processOneDeadLetterJob("new-reader");
  unregister();
  assert.deepEqual(observed, { legacyField: "preserved" });
});

test("legacy replay executes once per generation without rewriting payload", async () => {
  let calls = 0;
  const unregister = deadLetters.registerDeadLetterReplayHandler("known", async () => { calls++; });
  await pool.query(`INSERT INTO agent_dead_letter_queue(id,job_name,org_id,error_message,next_retry_at,payload,status)
    VALUES('replay','known','org-a','old',NOW(),'{"legacy":true}','pending')`);
  await deadLetters.processOneDeadLetterJob("first");
  await deadLetters.replayDeadLetterJob("replay", "org-a", "operator");
  await deadLetters.processOneDeadLetterJob("second");
  const row = (await pool.query("SELECT payload,payload_version,execution_generation FROM agent_dead_letter_queue WHERE id='replay'")).rows[0];
  unregister();
  assert.equal(calls, 2); assert.deepEqual(row.payload, { legacy: true });
  assert.equal(row.payload_version, 0); assert.equal(row.execution_generation, 1);
});
