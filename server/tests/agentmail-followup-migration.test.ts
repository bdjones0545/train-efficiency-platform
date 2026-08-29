import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
const admin = new pg.Pool({ connectionString });
const schema = `followup_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE SCHEMA "${schema}"`);
const database = new pg.Pool({ connectionString, max: 20, options: `-c search_path=${schema}` });
const separator = connectionString.includes("?") ? "&" : "?";
process.env.DATABASE_URL = `${connectionString}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
const migrationSql = await readFile(new URL("../../migrations/0020_agentmail_followup_schema.sql", import.meta.url), "utf8");
await database.query(migrationSql);

const validation = await import("../agentmail-followup-schema-validation");
const service = await import("../services/agentmail-followup-service");

after(async () => {
  await database.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

test("0020 creates the formal schema and the read-only validator accepts it", async () => {
  assert.equal((await database.query(`SELECT to_regclass('agent_mail_followups') name`)).rows[0].name, "agent_mail_followups");
  await validation.validateAgentMailFollowupSchema();
});

test("missing schema is typed unavailable while ordinary catalog failures preserve identity", async () => {
  await assert.rejects(validation.validateAgentMailFollowupSchema({ execute: async () => ({ rows: [] }) } as any),
    validation.AgentMailFollowupSchemaUnavailableError);
  const ordinary = new Error("catalog permission denied");
  await assert.rejects(validation.validateAgentMailFollowupSchema({ execute: async () => { throw ordinary; } } as any),
    error => error === ordinary);
});

test("runtime follow-up files contain no structural DDL or repair", async () => {
  for (const file of ["../agentmail-followup-routes.ts","../services/agentmail-followup-service.ts","../agentmail-followup-schema-validation.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)|ALTER\s+TABLE/i);
  }
});

async function approvedFollowup(id: string, org: string): Promise<void> {
  const row = { id, organization_id: org, recipient_email: "lead@example.test", subject: "Re: hello",
    followup_body: "Checking in", edited_body: null, inbox: "support", agent_name: "Support Agent" };
  const version = service.agentMailFollowupPayloadVersion(row);
  await database.query(`INSERT INTO agent_mail_followups
    (id,organization_id,inbox,agent_name,classification,recipient_email,subject,followup_body,sequence_name,sequence_step,
     scheduled_for,status,approval_status,approved_by,approved_at,approved_payload_version)
    VALUES($1,$2,'support','Support Agent','general_question','lead@example.test','Re: hello','Checking in','General Follow-Up',1,
      NOW()-interval '1 minute','pending_review','approved','reviewer',NOW(),$3)`, [id,org,version]);
}

test("ten concurrent sends obtain one durable claim and invoke provider once", async () => {
  const id = randomUUID(), org = `org-${randomUUID()}`;
  await approvedFollowup(id, org);
  let calls = 0;
  const invokeProvider = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return { ok: true, messageId: "provider-1" }; };
  const results = await Promise.all(Array.from({ length: 10 }, () => service.sendApprovedFollowup(
    { followupId: id, organizationId: org, actor: "reviewer" }, { invokeProvider: invokeProvider as any })));
  assert.equal(calls, 1);
  assert.equal(results.filter(result => result.ok).length, 1);
  const stored = (await database.query(`SELECT status,send_attempt_count,provider_message_id FROM agent_mail_followups WHERE id=$1`, [id])).rows[0];
  assert.deepEqual([stored.status,stored.send_attempt_count,stored.provider_message_id], ["sent",1,"provider-1"]);
});

test("tenant mismatch cannot claim or invoke provider", async () => {
  const id = randomUUID(), org = `org-${randomUUID()}`;
  await approvedFollowup(id, org);
  let calls = 0;
  const result = await service.sendApprovedFollowup({ followupId: id, organizationId: "other-org", actor: "reviewer" },
    { invokeProvider: (async () => { calls++; return { ok: true }; }) as any });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

test("provider uncertainty is terminal for automated retry", async () => {
  const id = randomUUID(), org = `org-${randomUUID()}`;
  await approvedFollowup(id, org);
  let calls = 0;
  const invokeProvider = async () => { calls++; throw new Error("timeout after acceptance"); };
  const first = await service.sendApprovedFollowup({ followupId: id, organizationId: org, actor: "reviewer" }, { invokeProvider: invokeProvider as any });
  const second = await service.sendApprovedFollowup({ followupId: id, organizationId: org, actor: "reviewer" }, { invokeProvider: invokeProvider as any });
  assert.equal(first.error, "Provider outcome uncertain");
  assert.equal(second.ok, false);
  assert.equal(calls, 1);
  assert.equal((await database.query(`SELECT status FROM agent_mail_followups WHERE id=$1`, [id])).rows[0].status, "uncertain_provider_outcome");
});

test("provider-confirmed failure is recorded and does not create a second business send", async () => {
  const id = randomUUID(), org = `org-${randomUUID()}`;
  await approvedFollowup(id, org);
  let calls = 0;
  const invokeProvider = async () => { calls++; return { ok: false, error: "rejected before delivery" }; };
  const first = await service.sendApprovedFollowup({ followupId: id, organizationId: org, actor: "reviewer" }, { invokeProvider: invokeProvider as any });
  const second = await service.sendApprovedFollowup({ followupId: id, organizationId: org, actor: "reviewer" }, { invokeProvider: invokeProvider as any });
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(calls, 1);
  assert.deepEqual(Object.values((await database.query(`SELECT status,send_attempt_count FROM agent_mail_followups WHERE id=$1`, [id])).rows[0]), ["failed",1]);
});

test("confirmed success remains terminal across later scans and calls", async () => {
  const id = randomUUID(), org = `org-${randomUUID()}`;
  await approvedFollowup(id, org);
  let calls = 0;
  const invokeProvider = async () => { calls++; return { ok: true, messageId: "terminal" }; };
  assert.equal((await service.sendApprovedFollowup({ followupId: id, organizationId: org, actor: "reviewer" }, { invokeProvider: invokeProvider as any })).ok, true);
  await service.processDueFollowups(org);
  await service.sendApprovedFollowup({ followupId: id, organizationId: org, actor: "reviewer" }, { invokeProvider: invokeProvider as any });
  assert.equal(calls, 1);
});
