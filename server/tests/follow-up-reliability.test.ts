import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
const { Pool } = pg;
const pool = new Pool({ connectionString });
const lifecycle = await import("../email-agent/follow-up-reliability");
const retryReliability = await import("../services/retry-reliability");

async function insertFollowUp(id: string, orgId = "org-a", maxAttempts = 3) {
  await pool.query(`INSERT INTO email_follow_ups
    (id,org_id,outreach_draft_id,prospect_id,step_number,scheduled_for,status,max_attempts)
    VALUES($1,$2,'draft-1','prospect-1',1,NOW(),'pending',$3)`, [id, orgId, maxAttempts]);
}
async function makeRetryDue(id: string) {
  await pool.query(`UPDATE email_follow_ups SET next_retry_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [id]);
}

before(async () => {
  await pool.query(`DROP TABLE IF EXISTS follow_up_send_effects,gmail_agent_actions,email_follow_ups CASCADE;
    DROP TYPE IF EXISTS follow_up_status CASCADE;
    CREATE TYPE follow_up_status AS ENUM('pending','sent','cancelled','skipped');
    CREATE TABLE email_follow_ups(
      id text primary key,org_id text not null,outreach_draft_id text not null,prospect_id text not null,
      step_number int not null,scheduled_for timestamptz not null,sent_at timestamptz,
      status follow_up_status default 'pending',subject text,body text,created_at timestamptz default now(),updated_at timestamptz default now());
    CREATE TABLE gmail_agent_actions(
      id text primary key,org_id text not null,action_type text not null,recipient_email text,subject text,
      body_preview text,risk_level text,approval_required boolean,status text,communication_domain text,
      created_by_agent text,executed_at timestamptz,result jsonb);`);
  await lifecycle.ensureFollowUpReliabilitySchema(pool);
  await retryReliability.ensureProviderCircuitSchema(pool);
});
beforeEach(async () => {
  await pool.query(`TRUNCATE follow_up_send_effects,gmail_agent_actions,email_follow_ups,provider_circuit_breakers`);
});
after(async () => { await pool.end(); });

test("one worker atomically claims a due follow-up", async () => {
  await insertFollowUp("one");
  const claimed = await lifecycle.claimFollowUp("org-a", "one", pool);
  assert.equal(claimed.status, "processing"); assert.equal(claimed.attempt_count, 1);
});

test("three workers produce one claim winner", async () => {
  await insertFollowUp("race");
  const claims = await Promise.all([1,2,3].map(() => lifecycle.claimFollowUp("org-a", "race", pool)));
  assert.equal(claims.filter(Boolean).length, 1);
  let providerCalls=0;
  await Promise.all(claims.filter(Boolean).map(async()=>{
    await lifecycle.executeFollowUpProviderEffect("org-a","race",async()=>{providerCalls++;return{providerMessageId:"p-race"}},undefined,pool);
    await lifecycle.completeFollowUpSend({orgId:"org-a",followUpId:"race",prospectId:"p",recipientEmail:"a@test",subject:"s",body:"b"},pool);
  }));
  assert.equal(providerCalls,1);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM gmail_agent_actions WHERE status='auto_executed'`)).rows[0].n,1);
  assert.equal((await pool.query(`SELECT status FROM email_follow_ups WHERE id='race'`)).rows[0].status,"sent");
});

test("provider failure persists retry state and never becomes skipped", async () => {
  await insertFollowUp("retry"); await lifecycle.claimFollowUp("org-a", "retry", pool);
  await lifecycle.prepareFollowUpSend("org-a", "retry", pool);
  const failed = await lifecycle.recordFollowUpFailure("org-a", "retry", "provider timeout", pool);
  assert.equal(failed.state, "retrying"); assert.equal(failed.attemptCount, 1); assert.ok(failed.nextRetryAt);
  const row = await pool.query(`SELECT status,last_error FROM email_follow_ups WHERE id='retry'`);
  assert.equal(row.rows[0].status, "retrying"); assert.match(row.rows[0].last_error, /timeout/);
});

test("timeout, 5xx, and rate limit retry while permanent provider rejection fails", async () => {
  const cases = [
    {id:"timeout", error:Object.assign(new Error("provider timeout"),{status:408}), expected:"retrying"},
    {id:"five", error:Object.assign(new Error("provider 503"),{status:503}), expected:"retrying"},
    {id:"rate", error:Object.assign(new Error("provider 429"),{status:429}), expected:"retrying"},
    {id:"permanent", error:Object.assign(new Error("invalid recipient"),{status:400}), expected:"failed"},
  ];
  let providerCalls=0;
  for(const c of cases){
    await pool.query(`TRUNCATE provider_circuit_breakers`);
    await insertFollowUp(c.id);await lifecycle.claimFollowUp("org-a",c.id,pool);
    try{await lifecycle.executeFollowUpProviderEffect("org-a",c.id,async()=>{providerCalls++;throw c.error},undefined,pool)}catch(error){
      await lifecycle.recordFollowUpFailure("org-a",c.id,c.error.message,pool,lifecycle.isPermanentFollowUpFailure(error));
    }
    assert.equal((await pool.query(`SELECT status FROM email_follow_ups WHERE id=$1`,[c.id])).rows[0].status,c.expected);
  }
  assert.equal(providerCalls,4);
});

test("retry survives restart and later succeeds", async () => {
  await insertFollowUp("restart"); await lifecycle.claimFollowUp("org-a", "restart", pool);
  await lifecycle.prepareFollowUpSend("org-a", "restart", pool);
  await lifecycle.recordFollowUpFailure("org-a", "restart", "503", pool); await makeRetryDue("restart");
  assert.ok(await lifecycle.claimFollowUp("org-a", "restart", pool));
  const effect = await lifecycle.prepareFollowUpSend("org-a", "restart", pool); assert.equal(effect.shouldSend, true);
  await lifecycle.recordFollowUpProviderSuccess("org-a", "restart", "provider-1", pool);
  await lifecycle.completeFollowUpSend({orgId:"org-a",followUpId:"restart",prospectId:"p",recipientEmail:"a@test",subject:"s",body:"b"}, pool);
  assert.equal((await pool.query(`SELECT status FROM email_follow_ups WHERE id='restart'`)).rows[0].status, "sent");
});

test("crash before provider send is reclaimed and sends once", async () => {
  await insertFollowUp("before"); await lifecycle.claimFollowUp("org-a", "before", pool);
  await lifecycle.prepareFollowUpSend("org-a", "before", pool);
  await pool.query(`UPDATE email_follow_ups SET processing_started_at=NOW()-INTERVAL '6 minutes' WHERE id='before'`);
  assert.ok(await lifecycle.claimFollowUp("org-a", "before", pool));
  let providerCalls=0; await lifecycle.executeFollowUpProviderEffect("org-a","before",async()=>{providerCalls++;return{providerMessageId:"p-before"}},undefined,pool);
  await lifecycle.completeFollowUpSend({orgId:"org-a",followUpId:"before",prospectId:"p",recipientEmail:"a@test",subject:"s",body:"b"},pool);
  assert.equal(providerCalls,1);
});

test("crash after provider success recovers without a second send", async () => {
  await insertFollowUp("after"); await lifecycle.claimFollowUp("org-a", "after", pool);
  let providerCalls=0;
  await assert.rejects(lifecycle.executeFollowUpProviderEffect("org-a","after",async()=>{providerCalls++;return{providerMessageId:"p-after"}},async()=>{throw new Error("simulated crash")},pool),/simulated crash/);
  await pool.query(`UPDATE email_follow_ups SET processing_started_at=NOW()-INTERVAL '6 minutes' WHERE id='after'`);
  assert.ok(await lifecycle.claimFollowUp("org-a", "after", pool));
  await lifecycle.executeFollowUpProviderEffect("org-a","after",async()=>{providerCalls++},undefined,pool);
  await lifecycle.completeFollowUpSend({orgId:"org-a",followUpId:"after",prospectId:"p",recipientEmail:"a@test",subject:"s",body:"b"},pool);
  assert.equal(providerCalls,1); assert.equal((await pool.query(`SELECT status FROM email_follow_ups WHERE id='after'`)).rows[0].status,"sent");
});

test("local completion failure cannot erase durable provider success", async () => {
  await insertFollowUp("local-failure"); await lifecycle.claimFollowUp("org-a", "local-failure", pool);
  await lifecycle.prepareFollowUpSend("org-a", "local-failure", pool);
  await lifecycle.recordFollowUpProviderSuccess("org-a", "local-failure", "p-local", pool);
  await lifecycle.recordFollowUpFailure("org-a", "local-failure", "local completion unavailable", pool);
  const effect = await lifecycle.prepareFollowUpSend("org-a", "local-failure", pool);
  assert.equal(effect.shouldSend, false); assert.equal(effect.effect.state, "provider_succeeded");
});

test("successful audit evidence appears only after durable provider success", async () => {
  await insertFollowUp("audit"); await lifecycle.claimFollowUp("org-a","audit",pool); await lifecycle.prepareFollowUpSend("org-a","audit",pool);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM gmail_agent_actions`)).rows[0].n,0);
  await lifecycle.recordFollowUpProviderSuccess("org-a","audit","p-audit",pool);
  await lifecycle.completeFollowUpSend({orgId:"org-a",followUpId:"audit",prospectId:"p",recipientEmail:"a@test",subject:"s",body:"b"},pool);
  const action=await pool.query(`SELECT status,executed_at FROM gmail_agent_actions`);
  assert.equal(action.rows[0].status,"auto_executed"); assert.ok(action.rows[0].executed_at);
});

test("maximum attempts transitions to terminal failed", async () => {
  await insertFollowUp("dead","org-a",2);
  for(let i=0;i<2;i++){await lifecycle.claimFollowUp("org-a","dead",pool);await lifecycle.prepareFollowUpSend("org-a","dead",pool);await lifecycle.recordFollowUpFailure("org-a","dead",`failure-${i}`,pool);if(i===0)await makeRetryDue("dead")}
  const row=await pool.query(`SELECT status,attempt_count,last_error,failed_at FROM email_follow_ups WHERE id='dead'`);
  assert.equal(row.rows[0].status,"failed");assert.equal(row.rows[0].attempt_count,2);assert.ok(row.rows[0].failed_at);
});

test("dead-letter replay is tenant scoped and preserves attempt history", async () => {
  await insertFollowUp("tenant","org-b",1);await lifecycle.claimFollowUp("org-b","tenant",pool);await lifecycle.prepareFollowUpSend("org-b","tenant",pool);await lifecycle.recordFollowUpFailure("org-b","tenant","permanent",pool);
  assert.equal(await lifecycle.replayFailedFollowUp("org-a","tenant",pool),false);
  assert.equal(await lifecycle.replayFailedFollowUp("org-b","tenant",pool),true);
  const row=await pool.query(`SELECT status,attempt_count,last_error FROM email_follow_ups WHERE id='tenant'`);
  assert.equal(row.rows[0].status,"retrying");assert.equal(row.rows[0].attempt_count,1);assert.equal(row.rows[0].last_error,"permanent");
});

test("replay after recorded provider success cannot duplicate send", async () => {
  await insertFollowUp("replay","org-b",1);await lifecycle.claimFollowUp("org-b","replay",pool);await lifecycle.prepareFollowUpSend("org-b","replay",pool);await lifecycle.recordFollowUpProviderSuccess("org-b","replay","p-replay",pool);
  await pool.query(`UPDATE email_follow_ups SET status='failed' WHERE id='replay'`);await lifecycle.replayFailedFollowUp("org-b","replay",pool);await lifecycle.claimFollowUp("org-b","replay",pool);
  assert.equal((await lifecycle.prepareFollowUpSend("org-b","replay",pool)).shouldSend,false);
});

test("valid business skip remains distinct from provider failure", async () => {
  await insertFollowUp("skip");await lifecycle.claimFollowUp("org-a","skip",pool);await lifecycle.prepareFollowUpSend("org-a","skip",pool);await lifecycle.markFollowUpSendSkipped("org-a","skip",pool);await pool.query(`UPDATE email_follow_ups SET status='skipped' WHERE id='skip'`);
  assert.equal((await pool.query(`SELECT status FROM email_follow_ups WHERE id='skip'`)).rows[0].status,"skipped");
  assert.equal((await pool.query(`SELECT state FROM follow_up_send_effects WHERE follow_up_id='skip'`)).rows[0].state,"skipped");
});
