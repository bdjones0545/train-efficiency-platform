import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const admin = new Pool({ connectionString });
const schema = `agentmail_approved_${randomUUID().replaceAll("-", "")}`;
let database: pg.Pool;

const migrations = await import("../application-migrations");
const applicationDb = await import("../db");
const {
  AgentMailApprovedSendAuthorityError,
  agentMailApprovedPayloadDigest,
  approveAgentMailReplyAuthority,
  canonicalAgentMailApprovedPayload,
  editAgentMailReplyAuthority,
  executeAgentMailApprovedReply,
} = await import("../services/agentmail-approved-send-service");
const {
  AgentMailApprovedSendSchemaUnavailableError,
  validateAgentMailApprovedSendSchema,
} = await import("../agentmail-approved-send-schema-validation");

before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  database = new Pool({ connectionString, max: 20, options: `-c search_path=${schema}` });
  await migrations.runApplicationMigrations(database, {
    migrationsDirectory: new URL("../../migrations", import.meta.url).pathname,
  });
});

after(async () => {
  await database?.end();
  await applicationDb.pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

async function createReply(options: { orgId?: string; id?: string; logicalSendId?: string; body?: string } = {}) {
  const id = options.id ?? randomUUID();
  const orgId = options.orgId ?? `org-${randomUUID()}`;
  const logicalSendId = options.logicalSendId ?? id;
  await database.query(
    `INSERT INTO agent_mail_reply_queue
      (id,logical_send_id,organization_id,inbound_message_id,inbox,agent_name,classification,
       recipient_email,subject,draft_body,status,approval_status,provider_inbound_message_id,thread_id)
     VALUES($1,$2,$3,$4,'support','Support Agent','support_issue','person@example.com','Re: Help',$5,
       'pending_review','pending_review','provider-inbound','thread-1')`,
    [id, logicalSendId, orgId, `inbound-${randomUUID()}`, options.body ?? "Approved body"],
  );
  return { id, orgId, logicalSendId };
}

const allow = async () => ({ allowed: true });

test("fresh formal migration creates the two canonical tables and 0015 ledger entry", async () => {
  const tables = await database.query(`SELECT to_regclass('agentmail_approved_logical_sends') logical,to_regclass('agentmail_approved_send_attempts') attempts`);
  assert.equal(tables.rows[0].logical, "agentmail_approved_logical_sends");
  assert.equal(tables.rows[0].attempts, "agentmail_approved_send_attempts");
  const ledger = await database.query(`SELECT migration_id FROM train_efficiency_migrations WHERE migration_id='0015_agentmail_approved_send_idempotency.sql'`);
  assert.equal(ledger.rows[0].migration_id, "0015_agentmail_approved_send_idempotency.sql");
});

test("repeat migration is checksum-verified and does not rewrite data", async () => {
  const beforeRows = await database.query(`SELECT count(*)::int n FROM train_efficiency_migrations`);
  await migrations.runApplicationMigrations(database, { migrationsDirectory: new URL("../../migrations", import.meta.url).pathname });
  const afterRows = await database.query(`SELECT count(*)::int n FROM train_efficiency_migrations`);
  assert.equal(afterRows.rows[0].n, beforeRows.rows[0].n);
});

test("read-only validator accepts the exact formal structure", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  await validateAgentMailApprovedSendSchema(drizzle(database));
});

test("canonical payload serialization binds every supported approval-controlled field", () => {
  const serialized = canonicalAgentMailApprovedPayload({
    recipientEmail: "person@example.com", subject: "Subject", body: "Body", inbox: "support",
    agentName: "Support Agent", providerInboundMessageId: "message-1", threadId: "thread-1",
  });
  assert.deepEqual(JSON.parse(serialized), [
    "agentmail-approved-payload-v1", "person@example.com", "Subject", "Body", "support",
    "Support Agent", "message-1", "thread-1",
  ]);
  assert.equal(agentMailApprovedPayloadDigest(JSON.parse("{}") as any).length, 64);
});

test("approval persists a stable logical ID and explicit versioned digest", async () => {
  const reply = await createReply();
  const authority = await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach@example.com", database);
  assert.equal(authority.logicalSendId, reply.logicalSendId);
  assert.match(authority.approvedPayloadVersion, /^v1:[a-f0-9]{64}$/);
  const stored = await database.query(`SELECT approval_version,approved_payload_version,approved_by FROM agent_mail_reply_queue WHERE id=$1`, [reply.id]);
  assert.deepEqual(stored.rows[0], { approval_version: 1, approved_payload_version: authority.approvedPayloadVersion, approved_by: "coach@example.com" });
});

test("post-approval edit revokes stale approval and requires reapproval V2", async () => {
  const reply = await createReply();
  const v1 = await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  assert.equal(await editAgentMailReplyAuthority(reply.orgId, reply.id, "Edited body", database), true);
  await assert.rejects(
    executeAgentMailApprovedReply({ orgId: reply.orgId, replyQueueId: reply.id, preflight: allow, invokeProvider: async () => ({ ok: true }), database, validateSchema: async () => undefined }),
    (error: unknown) => error instanceof AgentMailApprovedSendAuthorityError && error.code === "not_approved",
  );
  const v2 = await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  assert.equal(v2.logicalSendId, v1.logicalSendId);
  assert.notEqual(v2.approvedPayloadVersion, v1.approvedPayloadVersion);
  assert.match(v2.approvedPayloadVersion, /^v2:/);
});

test("preflight suppression fails closed before provider and before claim", async () => {
  const reply = await createReply();
  await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  let calls = 0;
  const result = await executeAgentMailApprovedReply({
    orgId: reply.orgId, replyQueueId: reply.id, database, validateSchema: async () => undefined,
    preflight: async () => ({ allowed: false, error: "paused" }),
    invokeProvider: async () => { calls++; return { ok: true }; },
  });
  assert.deepEqual([result.state, calls], ["suppressed", 0]);
  assert.equal((await database.query(`SELECT count(*)::int n FROM agentmail_approved_logical_sends WHERE org_id=$1`, [reply.orgId])).rows[0].n, 0);
});

test("schema unavailability fails closed before claim and provider", async () => {
  const reply = await createReply();
  await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  let calls = 0;
  await assert.rejects(executeAgentMailApprovedReply({
    orgId: reply.orgId, replyQueueId: reply.id, database, preflight: allow,
    validateSchema: async () => { throw new AgentMailApprovedSendSchemaUnavailableError(["missing table"]); },
    invokeProvider: async () => { calls++; return { ok: true }; },
  }), AgentMailApprovedSendSchemaUnavailableError);
  assert.equal(calls, 0);
});

test("negative control records the legacy fail-open audit path while candidate gates before provider", async () => {
  const legacyAudit = await readFile(new URL("../services/outbound-audit-log.ts", import.meta.url), "utf8");
  const legacyProvider = await readFile(new URL("../services/agentmail-service.ts", import.meta.url), "utf8");
  assert.match(legacyAudit, /Returns the new row ID, or undefined on error \(never throws\)/);
  assert.match(legacyAudit, /catch \(e: any\)[\s\S]*return undefined/);
  assert.ok(legacyProvider.indexOf("agentMailRequest(\n    \"POST\"") < legacyProvider.indexOf("writeOutboundAuditLog({", legacyProvider.indexOf("export async function sendAgentEmail")));
  // Candidate provider=0 behavior on schema failure is asserted immediately above.
});

test("approved-send runtime and validator contain no structural DDL or repair", async () => {
  for (const file of ["../services/agentmail-approved-send-service.ts", "../agentmail-approved-send-schema-validation.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX)/i);
  }
});

test("ten concurrent identical callers authorize exactly one provider invocation", async () => {
  const reply = await createReply();
  await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const invokeProvider = async () => { calls++; await gate; return { ok: true, messageId: "receipt-one", outcomeCertain: true }; };
  const requests = Array.from({ length: 10 }, () => executeAgentMailApprovedReply({
    orgId: reply.orgId, replyQueueId: reply.id, preflight: allow, invokeProvider, database, validateSchema: async () => undefined,
  }));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls, 1);
  assert.equal(await editAgentMailReplyAuthority(reply.orgId, reply.id, "racing edit", database), false);
  release();
  const results = await Promise.all(requests);
  assert.equal(calls, 1);
  assert.equal(new Set(results.map(result => result.logicalSendRowId)).size, 1);
  assert.equal((await database.query(`SELECT count(*)::int n FROM agentmail_approved_send_attempts
    WHERE logical_send_row_id=$1`, [results[0].logicalSendRowId])).rows[0].n, 1);
});

test("confirmed success is canonical and suppresses a later provider call", async () => {
  const reply = await createReply();
  await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  let calls = 0;
  const execute = () => executeAgentMailApprovedReply({
    orgId: reply.orgId, replyQueueId: reply.id, preflight: allow, database, validateSchema: async () => undefined,
    invokeProvider: async () => { calls++; return { ok: true, messageId: "receipt-success", outcomeCertain: true }; },
  });
  assert.equal((await execute()).state, "confirmed_success");
  const duplicate = await execute();
  assert.deepEqual([duplicate.state, duplicate.duplicate, calls, duplicate.messageId], ["confirmed_success", true, 1, "receipt-success"]);
});

test("confirmed failure permits one later attempt under the same logical send", async () => {
  const reply = await createReply();
  await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  let calls = 0;
  const execute = () => executeAgentMailApprovedReply({
    orgId: reply.orgId, replyQueueId: reply.id, preflight: allow, database, validateSchema: async () => undefined,
    invokeProvider: async () => ++calls === 1
      ? { ok: false, error: "HTTP 503", outcomeCertain: true }
      : { ok: true, messageId: "retry-success", outcomeCertain: true },
  });
  assert.equal((await execute()).state, "confirmed_failure");
  assert.equal((await execute()).state, "confirmed_success");
  assert.equal(calls, 2);
});

test("unknown provider outcome blocks blind retry", async () => {
  const reply = await createReply();
  await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  let calls = 0;
  const execute = () => executeAgentMailApprovedReply({
    orgId: reply.orgId, replyQueueId: reply.id, preflight: allow, database, validateSchema: async () => undefined,
    invokeProvider: async () => { calls++; return { ok: false, error: "timeout", outcomeCertain: false }; },
  });
  assert.equal((await execute()).state, "uncertain_provider_outcome");
  const duplicate = await execute();
  assert.deepEqual([duplicate.state, duplicate.duplicate, calls], ["uncertain_provider_outcome", true, 1]);
});

test("result persistence failure never returns false confirmed success and leaves a blocking in-progress attempt", async () => {
  const reply = await createReply();
  await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  let connects = 0;
  const failingDatabase = {
    query: database.query.bind(database),
    connect: async () => {
      const client = await database.connect();
      connects++;
      if (connects === 3) {
        const original = client.query.bind(client);
        return {
          query: (text: any, values?: any[]) => String(text).startsWith("UPDATE agentmail_approved_send_attempts")
            ? Promise.reject(new Error("injected result persistence failure")) : original(text, values),
          release: () => client.release(),
        } as any;
      }
      return client;
    },
  } as any;
  const result = await executeAgentMailApprovedReply({
    orgId: reply.orgId, replyQueueId: reply.id, preflight: allow, database: failingDatabase,
    validateSchema: async () => undefined, invokeProvider: async () => ({ ok: true, messageId: "possibly-sent" }),
  });
  assert.deepEqual([result.ok, result.state, result.providerInvoked], [false, "uncertain_provider_outcome", true]);
  const stored = await database.query(`SELECT status FROM agentmail_approved_logical_sends WHERE id=$1`, [result.logicalSendRowId]);
  assert.equal(stored.rows[0].status, "attempt_in_progress");
});

test("a crash after authorization but before provider start resumes the same durable attempt", async () => {
  const reply = await createReply();
  const authority = await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  const logicalSendRowId = randomUUID();
  const attemptId = randomUUID();
  await database.query(`INSERT INTO agentmail_approved_logical_sends
    (id,org_id,logical_send_id,authority_id,approved_payload_version,status)
    VALUES($1,$2,$3,$4,$5,'claimed')`,
    [logicalSendRowId, reply.orgId, reply.logicalSendId, reply.id, authority.approvedPayloadVersion]);
  await database.query(`INSERT INTO agentmail_approved_send_attempts
    (id,logical_send_row_id,attempt_number,approved_payload_version,status)
    VALUES($1,$2,1,$3,'authorized')`, [attemptId, logicalSendRowId, authority.approvedPayloadVersion]);
  await database.query(`UPDATE agent_mail_reply_queue SET status='send_in_progress' WHERE id=$1`, [reply.id]);
  let calls = 0;
  const result = await executeAgentMailApprovedReply({ orgId: reply.orgId, replyQueueId: reply.id,
    preflight: allow, database, validateSchema: async () => undefined,
    invokeProvider: async () => { calls++; return { ok: true, messageId: "resumed" }; } });
  assert.deepEqual([result.state, result.attemptId, calls], ["confirmed_success", attemptId, 1]);
  assert.equal((await database.query(`SELECT count(*)::int n FROM agentmail_approved_send_attempts
    WHERE logical_send_row_id=$1`, [logicalSendRowId])).rows[0].n, 1);
});

test("tenant A cannot claim tenant B reply authority", async () => {
  const reply = await createReply({ orgId: "tenant-b" });
  await approveAgentMailReplyAuthority(reply.orgId, reply.id, "coach", database);
  await assert.rejects(
    executeAgentMailApprovedReply({ orgId: "tenant-a", replyQueueId: reply.id, preflight: allow,
      invokeProvider: async () => ({ ok: true }), database, validateSchema: async () => undefined }),
    (error: unknown) => error instanceof AgentMailApprovedSendAuthorityError && error.code === "not_found",
  );
});

test("same logical-send string is isolated across tenants", async () => {
  const logicalSendId = `shared-${randomUUID()}`;
  const a = await createReply({ orgId: `tenant-a-${randomUUID()}`, logicalSendId });
  const b = await createReply({ orgId: `tenant-b-${randomUUID()}`, logicalSendId });
  await approveAgentMailReplyAuthority(a.orgId, a.id, "coach-a", database);
  await approveAgentMailReplyAuthority(b.orgId, b.id, "coach-b", database);
  let calls = 0;
  for (const reply of [a, b]) {
    const result = await executeAgentMailApprovedReply({ orgId: reply.orgId, replyQueueId: reply.id, preflight: allow,
      invokeProvider: async () => ({ ok: true, messageId: `receipt-${++calls}` }), database, validateSchema: async () => undefined });
    assert.equal(result.state, "confirmed_success");
  }
  assert.equal(calls, 2);
});

test("provider receipts remain subordinate and tenant-bound through logical sends", async () => {
  const rows = await database.query(`SELECT l.org_id,a.provider_message_id FROM agentmail_approved_send_attempts a
    JOIN agentmail_approved_logical_sends l ON l.id=a.logical_send_row_id WHERE a.provider_message_id IS NOT NULL`);
  assert.equal(rows.rows.every(row => typeof row.org_id === "string" && row.org_id.length > 0), true);
});

test("malformed global identity uniqueness is rejected without repair", async () => {
  const driftSchema = `${schema}_drift`;
  await admin.query(`CREATE SCHEMA "${driftSchema}"`);
  const driftPool = new Pool({ connectionString, options: `-c search_path=${driftSchema}` });
  try {
    await migrations.runApplicationMigrations(driftPool, { migrationsDirectory: new URL("../../migrations", import.meta.url).pathname });
    await driftPool.query(`DROP INDEX agentmail_approved_logical_sends_identity_unique`);
    await driftPool.query(`CREATE UNIQUE INDEX wrong_global_identity ON agentmail_approved_logical_sends(logical_send_id)`);
    const { drizzle } = await import("drizzle-orm/node-postgres");
    await assert.rejects(validateAgentMailApprovedSendSchema(drizzle(driftPool)), AgentMailApprovedSendSchemaUnavailableError);
    assert.equal((await driftPool.query(`SELECT indexdef FROM pg_indexes WHERE indexname='wrong_global_identity'`)).rowCount, 1);
  } finally {
    await driftPool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${driftSchema}" CASCADE`);
  }
});

test("validator rejects a matching identity prefix with an extra expression key", async () => {
  await rejectsTransactionalDrift(`DROP INDEX agentmail_approved_logical_sends_identity_unique;
    CREATE UNIQUE INDEX malformed_identity ON agentmail_approved_logical_sends
      (org_id,send_class,logical_send_id,(lower(authority_id)))`, /logical_sends UNIQUE/);
});

async function rejectsTransactionalDrift(statement: string, pattern?: RegExp) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(statement);
    const { drizzle } = await import("drizzle-orm/node-postgres");
    await assert.rejects(validateAgentMailApprovedSendSchema(drizzle(client)), error => {
      assert.equal(error instanceof AgentMailApprovedSendSchemaUnavailableError, true);
      if (pattern) assert.match((error as Error).message, pattern);
      return true;
    });
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

test("validator rejects a missing logical-send table without repairing it", async () => {
  await rejectsTransactionalDrift(`DROP TABLE agentmail_approved_logical_sends CASCADE`, /agentmail_approved_logical_sends/);
});

test("validator rejects a missing attempt table", async () => {
  await rejectsTransactionalDrift(`DROP TABLE agentmail_approved_send_attempts`, /agentmail_approved_send_attempts/);
});

test("validator rejects wrong tenant and logical-ID types", async () => {
  await rejectsTransactionalDrift(`ALTER TABLE agentmail_approved_logical_sends DROP CONSTRAINT agentmail_approved_logical_sends_authority_fk;
    ALTER TABLE agentmail_approved_logical_sends ALTER COLUMN org_id TYPE varchar;
    ALTER TABLE agentmail_approved_logical_sends ALTER COLUMN logical_send_id TYPE varchar`, /contract mismatch/);
});

test("validator rejects nullability drift", async () => {
  await rejectsTransactionalDrift(`ALTER TABLE agentmail_approved_logical_sends ALTER COLUMN approved_payload_version DROP NOT NULL`, /approved_payload_version contract mismatch/);
});

test("validator rejects a wrong default", async () => {
  await rejectsTransactionalDrift(`ALTER TABLE agentmail_approved_logical_sends ALTER COLUMN send_class SET DEFAULT 'direct_agent'`, /send_class contract mismatch/);
});

test("validator rejects a missing primary key", async () => {
  await rejectsTransactionalDrift(`ALTER TABLE agentmail_approved_send_attempts DROP CONSTRAINT agentmail_approved_send_attempts_pkey`, /PRIMARY KEY/);
});

test("validator rejects a broken authority foreign key", async () => {
  await rejectsTransactionalDrift(`ALTER TABLE agentmail_approved_logical_sends DROP CONSTRAINT agentmail_approved_logical_sends_authority_fk`, /tenant authority FK/);
});

test("validator rejects the wrong foreign-key delete action", async () => {
  await rejectsTransactionalDrift(`ALTER TABLE agentmail_approved_send_attempts DROP CONSTRAINT agentmail_approved_send_attempts_logical_fk;
    ALTER TABLE agentmail_approved_send_attempts ADD CONSTRAINT wrong_attempt_fk FOREIGN KEY(logical_send_row_id)
      REFERENCES agentmail_approved_logical_sends(id) ON DELETE CASCADE`, /attempt logical send FK/);
});

test("validator rejects missing lifecycle and approval checks", async () => {
  await rejectsTransactionalDrift(`ALTER TABLE agent_mail_reply_queue DROP CONSTRAINT agent_mail_reply_queue_approved_payload_check;
    ALTER TABLE agentmail_approved_logical_sends DROP CONSTRAINT agentmail_approved_logical_sends_identity_check`, /approved_payload_check/);
});

test("legacy approved row without canonical identity fails closed rather than being fabricated", async () => {
  const legacySchema = `${schema}_legacy`;
  await admin.query(`CREATE SCHEMA "${legacySchema}"`);
  const legacyPool = new Pool({ connectionString, options: `-c search_path=${legacySchema}` });
  try {
    await assert.rejects(migrations.runApplicationMigrations(legacyPool, {
      migrationsDirectory: new URL("../../migrations", import.meta.url).pathname,
      beforeMigration: id => { if (id.startsWith("0015_")) throw new Error("stop before 0015"); },
    }), /stop before 0015/);
    const id = randomUUID();
    const orgId = `legacy-${randomUUID()}`;
    await legacyPool.query(`INSERT INTO agent_mail_reply_queue
      (id,organization_id,inbound_message_id,inbox,agent_name,classification,recipient_email,subject,draft_body,status,approval_status)
      VALUES($1,$2,$3,'support','Support Agent','support_issue','person@example.com','Legacy','Body','approved','approved')`,
      [id, orgId, randomUUID()]);
    await migrations.runApplicationMigrations(legacyPool, { migrationsDirectory: new URL("../../migrations", import.meta.url).pathname });
    const preserved = await legacyPool.query(`SELECT logical_send_id,approved_payload_version,approval_version FROM agent_mail_reply_queue WHERE id=$1`, [id]);
    assert.deepEqual(preserved.rows[0], { logical_send_id: null, approved_payload_version: null, approval_version: 0 });
    await assert.rejects(
      executeAgentMailApprovedReply({ orgId, replyQueueId: id, preflight: allow, invokeProvider: async () => ({ ok: true }), database: legacyPool, validateSchema: async () => undefined }),
      AgentMailApprovedSendAuthorityError,
    );
  } finally {
    await legacyPool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${legacySchema}" CASCADE`);
  }
});
