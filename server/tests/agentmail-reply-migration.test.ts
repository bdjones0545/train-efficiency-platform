import assert from "node:assert/strict";
import test, { after } from "node:test";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg, { type PoolClient } from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const admin = new Pool({ connectionString });
const schemas: string[] = [];
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const migrations = await import("../application-migrations");
const legacyMigrationsDirectory = await mkdtemp(join(tmpdir(), "agentmail-reply-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter((name) => /^000[0-5]_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyMigrationsDirectory, file));
}

function schemaName(): string {
  const name = `agentmail_reply_migration_${randomUUID().replaceAll("-", "")}`;
  schemas.push(name);
  return name;
}

async function poolFor(schema = schemaName()): Promise<pg.Pool> {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}

async function createLegacyReplySchema(client: PoolClient, identitiesNotNull = true): Promise<void> {
  await client.query(`CREATE TABLE agent_mail_reply_queue (
    id text PRIMARY KEY,
    organization_id text ${identitiesNotNull ? "NOT NULL" : ""},
    inbound_message_id text ${identitiesNotNull ? "NOT NULL" : ""},
    inbox text NOT NULL, agent_name text NOT NULL, classification text NOT NULL,
    recipient_email text NOT NULL, recipient_name text, subject text NOT NULL,
    draft_body text NOT NULL, edited_body text, final_body text,
    status text NOT NULL DEFAULT 'drafted', approval_status text NOT NULL DEFAULT 'pending_review',
    approved_by text, approved_at timestamptz, sent_at timestamptz,
    provider_message_id text, thread_id text, delivery_status text, rejection_reason text,
    confidence double precision DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

async function createLegacyDependents(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE agent_mail_reply_outcomes (
    id text PRIMARY KEY, reply_queue_id text NOT NULL, organization_id text NOT NULL,
    agent_name text NOT NULL, inbox text NOT NULL, classification text NOT NULL,
    outcome_type text NOT NULL, response_time_minutes double precision, actor text,
    notes text, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE TABLE agent_mail_followups (
    id text PRIMARY KEY, source_reply_queue_id text
  )`);
}

async function insertReply(
  client: { query: (text: string, values?: any[]) => Promise<any> },
  id: string,
  organizationId: string | null,
  inboundMessageId: string | null,
  draftBody = "same draft",
): Promise<void> {
  await client.query(`INSERT INTO agent_mail_reply_queue(
    id,organization_id,inbound_message_id,inbox,agent_name,classification,
    recipient_email,subject,draft_body,status,approval_status,confidence,created_at,updated_at
  ) VALUES($1,$2,$3,'general','agent','general_question','person@example.com',
    'Re: subject',$4,'drafted','pending_review',0,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')`,
  [id, organizationId, inboundMessageId, draftBody]);
}

async function runWithSetup(pool: pg.Pool, setup: (client: PoolClient) => Promise<void>): Promise<void> {
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyMigrationsDirectory });
  const client = await pool.connect();
  try {
    await setup(client);
  } finally {
    client.release();
  }
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
}

async function ledger(pool: pg.Pool) {
  return (await pool.query(`SELECT migration_id,execution_kind FROM train_efficiency_migrations ORDER BY migration_id`)).rows;
}

async function hasTenantUniqueIndex(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query(`SELECT EXISTS (
    SELECT 1 FROM pg_index definition
    JOIN pg_class relation ON relation.oid=definition.indrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname=current_schema() AND relation.relname='agent_mail_reply_queue'
      AND definition.indisunique
      AND ARRAY(SELECT attribute.attname::text
        FROM unnest(definition.indkey) WITH ORDINALITY key(attnum,ord)
        JOIN pg_attribute attribute ON attribute.attrelid=definition.indrelid AND attribute.attnum=key.attnum
        ORDER BY key.ord) = ARRAY['organization_id','inbound_message_id']::text[]
  ) AS present`);
  return result.rows[0].present;
}

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await rm(legacyMigrationsDirectory, { recursive: true, force: true });
});

test("fresh database creates the formal reply schema and records migration", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await pool.query(`SELECT to_regclass('agent_mail_reply_queue') AS queue`)).rows[0].queue, "agent_mail_reply_queue");
  assert.equal((await pool.query(`SELECT to_regclass('agent_mail_reply_outcomes') AS outcomes`)).rows[0].outcomes, "agent_mail_reply_outcomes");
  assert.equal(await hasTenantUniqueIndex(pool), true);
  assert.ok((await ledger(pool)).some((row) => row.migration_id === "0006_agentmail_reply_uniqueness.sql"));
  await pool.end();
});

test("existing empty reply schema migrates without data fabrication", async () => {
  const pool = await poolFor();
  await runWithSetup(pool, createLegacyReplySchema);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM agent_mail_reply_queue`)).rows[0].n, 0);
  assert.equal(await hasTenantUniqueIndex(pool), true);
  await pool.end();
});

test("existing unique rows are preserved exactly", async () => {
  const pool = await poolFor();
  await runWithSetup(pool, async (client) => {
    await createLegacyReplySchema(client);
    await insertReply(client, "unique-a", "org-a", "inbound-a");
    await insertReply(client, "unique-b", "org-a", "inbound-b");
  });
  assert.deepEqual((await pool.query(`SELECT id FROM agent_mail_reply_queue ORDER BY id`)).rows, [{ id: "unique-a" }, { id: "unique-b" }]);
  await pool.end();
});

test("equivalent duplicates retain the deterministic oldest-id survivor and repoint known references", async () => {
  const pool = await poolFor();
  await runWithSetup(pool, async (client) => {
    await createLegacyReplySchema(client);
    await createLegacyDependents(client);
    await insertReply(client, "reply-b", "org-a", "inbound-a");
    await insertReply(client, "reply-a", "org-a", "inbound-a");
    await client.query(`INSERT INTO agent_mail_reply_outcomes
      (id,reply_queue_id,organization_id,agent_name,inbox,classification,outcome_type)
      VALUES('outcome-a','reply-b','org-a','agent','general','general_question','sent')`);
    await client.query(`INSERT INTO agent_mail_followups(id,source_reply_queue_id) VALUES('followup-a','reply-b')`);
  });
  assert.deepEqual((await pool.query(`SELECT id FROM agent_mail_reply_queue`)).rows, [{ id: "reply-a" }]);
  assert.equal((await pool.query(`SELECT reply_queue_id FROM agent_mail_reply_outcomes`)).rows[0].reply_queue_id, "reply-a");
  assert.equal((await pool.query(`SELECT source_reply_queue_id FROM agent_mail_followups`)).rows[0].source_reply_queue_id, "reply-a");
  await pool.end();
});

test("a large equivalent duplicate group converges without arbitrary survivor selection", async () => {
  const pool = await poolFor();
  await runWithSetup(pool, async (client) => {
    await createLegacyReplySchema(client);
    for (let index = 49; index >= 0; index--) await insertReply(client, `reply-${String(index).padStart(2, "0")}`, "org-a", "inbound-large");
  });
  assert.deepEqual((await pool.query(`SELECT id FROM agent_mail_reply_queue`)).rows, [{ id: "reply-00" }]);
  await pool.end();
});

test("divergent duplicates fail closed, preserve both rows, and do not advance the ledger", async () => {
  const pool = await poolFor();
  await assert.rejects(runWithSetup(pool, async (client) => {
    await createLegacyReplySchema(client);
    await insertReply(client, "reply-a", "org-a", "inbound-a", "first draft");
    await insertReply(client, "reply-b", "org-a", "inbound-a", "materially different draft");
  }), /divergent tenant-scoped duplicates/);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM agent_mail_reply_queue`)).rows[0].n, 2);
  assert.equal((await ledger(pool)).at(-1)?.migration_id, "0005_unsubscribe_token_scope.sql");
  assert.equal(await hasTenantUniqueIndex(pool), false);
  await pool.end();
});

test("failed divergent migration can be repaired explicitly and rerun", async () => {
  const pool = await poolFor();
  await assert.rejects(runWithSetup(pool, async (client) => {
    await createLegacyReplySchema(client);
    await insertReply(client, "reply-a", "org-a", "inbound-a", "first draft");
    await insertReply(client, "reply-b", "org-a", "inbound-a", "different draft");
  }), /divergent/);
  await pool.query(`DELETE FROM agent_mail_reply_queue WHERE id='reply-b'`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.ok((await ledger(pool)).some((row) => row.migration_id === "0006_agentmail_reply_uniqueness.sql"));
  assert.equal(await hasTenantUniqueIndex(pool), true);
  await pool.end();
});

test("null tenant or inbound identity fails closed without deleting malformed rows", async () => {
  const pool = await poolFor();
  await assert.rejects(runWithSetup(pool, async (client) => {
    await createLegacyReplySchema(client, false);
    await insertReply(client, "null-tenant", null, "inbound-a");
    await insertReply(client, "null-inbound", "org-a", null);
  }), /null tenant or inbound identity/);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM agent_mail_reply_queue`)).rows[0].n, 2);
  assert.equal((await ledger(pool)).at(-1)?.migration_id, "0005_unsubscribe_token_scope.sql");
  await pool.end();
});

test("incompatible tenant identity column types fail closed", async () => {
  const pool = await poolFor();
  await assert.rejects(runWithSetup(pool, async (client) => {
    await createLegacyReplySchema(client);
    await client.query(`ALTER TABLE agent_mail_reply_queue
      ALTER COLUMN organization_id TYPE integer USING NULL`);
  }), /incompatible tenant or inbound identity schema/);
  assert.equal((await ledger(pool)).at(-1)?.migration_id, "0005_unsubscribe_token_scope.sql");
  await pool.end();
});

test("a conflicting pre-existing index name cannot produce false migration success", async () => {
  const pool = await poolFor();
  await assert.rejects(runWithSetup(pool, async (client) => {
    await createLegacyReplySchema(client);
    await client.query(`CREATE UNIQUE INDEX idx_reply_queue_inbound_unique
      ON agent_mail_reply_queue(inbound_message_id)`);
  }), /tenant-scoped uniqueness was not established/);
  assert.equal((await ledger(pool)).at(-1)?.migration_id, "0005_unsubscribe_token_scope.sql");
  assert.equal(await hasTenantUniqueIndex(pool), false);
  await pool.end();
});

test("the same inbound identity remains valid across organizations", async () => {
  const pool = await poolFor();
  await runWithSetup(pool, async (client) => {
    await createLegacyReplySchema(client);
    await insertReply(client, "org-a-reply", "org-a", "provider-message");
    await insertReply(client, "org-b-reply", "org-b", "provider-message");
  });
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM agent_mail_reply_queue`)).rows[0].n, 2);
  await pool.end();
});

test("post-migration same-tenant duplicates are rejected while cross-tenant rows are accepted", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await insertReply(pool, "reply-a", "org-a", "inbound-a");
  await assert.rejects(insertReply(pool, "reply-b", "org-a", "inbound-a"), /duplicate key/);
  await insertReply(pool, "reply-c", "org-b", "inbound-a");
  await pool.end();
});

test("repeated and concurrent migration attempts converge on one ledger entry", async () => {
  const schema = schemaName();
  const first = await poolFor(schema);
  const pools = [first,
    new Pool({ connectionString, max: 3, options: `-c search_path=${schema}` }),
    new Pool({ connectionString, max: 3, options: `-c search_path=${schema}` })];
  await Promise.all(pools.map((pool) => migrations.runApplicationMigrations(pool, { migrationsDirectory })));
  await migrations.runApplicationMigrations(first, { migrationsDirectory });
  assert.equal((await first.query(`SELECT count(*)::int AS n FROM train_efficiency_migrations
    WHERE migration_id='0006_agentmail_reply_uniqueness.sql'`)).rows[0].n, 1);
  await Promise.all(pools.map((pool) => pool.end()));
});

test("runtime reply registration validates schema and owns no structural or destructive transition", async () => {
  const source = await readFile(new URL("../agentmail-reply-routes.ts", import.meta.url), "utf8");
  assert.match(source, /validateAgentMailReplySchema/);
  assert.doesNotMatch(source, /CREATE TABLE IF NOT EXISTS agent_mail_reply_queue/);
  assert.doesNotMatch(source, /CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_queue_inbound_unique/);
  assert.doesNotMatch(source, /DELETE FROM agent_mail_reply_queue/);
  assert.doesNotMatch(source, /ALTER TABLE agent_mail_reply_queue/);
});
