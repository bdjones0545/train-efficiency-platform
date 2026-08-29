import assert from "node:assert/strict";
import test, { after } from "node:test";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
const admin = new pg.Pool({ connectionString });
const schemas: string[] = [];
const schema = `followup_${randomUUID().replaceAll("-", "")}`;
schemas.push(schema);
await admin.query(`CREATE SCHEMA "${schema}"`);
const database = new pg.Pool({ connectionString, max: 20, options: `-c search_path=${schema}` });
const separator = connectionString.includes("?") ? "&" : "?";
process.env.DATABASE_URL = `${connectionString}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
const migrationSql = await readFile(new URL("../../migrations/0020_agentmail_followup_schema.sql", import.meta.url), "utf8");
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const legacyDirectory = await mkdtemp(join(tmpdir(), "agentmail-followup-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter(name => /^(?:000\d|001\d)_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}
await database.query(migrationSql);

const migrations = await import("../application-migrations");
const validation = await import("../agentmail-followup-schema-validation");
const service = await import("../services/agentmail-followup-service");

async function poolFor(): Promise<pg.Pool> {
  const isolatedSchema = `followup_migration_${randomUUID().replaceAll("-", "")}`;
  schemas.push(isolatedSchema);
  await admin.query(`CREATE SCHEMA "${isolatedSchema}"`);
  return new pg.Pool({ connectionString, max: 8, options: `-c search_path=${isolatedSchema}` });
}

async function createCompatibleLegacyTable(pool: pg.Pool, idConstraint = "PRIMARY KEY"): Promise<void> {
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE agent_mail_followups (
    id TEXT ${idConstraint} DEFAULT gen_random_uuid()::text, organization_id TEXT NOT NULL,
    source_inbound_message_id TEXT, source_reply_queue_id TEXT, inbox TEXT NOT NULL, agent_name TEXT NOT NULL,
    classification TEXT NOT NULL, recipient_email TEXT NOT NULL, recipient_name TEXT, subject TEXT NOT NULL,
    followup_body TEXT NOT NULL, edited_body TEXT, sequence_name TEXT NOT NULL, sequence_step INTEGER NOT NULL DEFAULT 1,
    scheduled_for TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', approval_status TEXT NOT NULL DEFAULT 'pending',
    approved_by TEXT, approved_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, provider_message_id TEXT, skipped_reason TEXT,
    error_message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  INSERT INTO agent_mail_followups
    (id,organization_id,inbox,agent_name,classification,recipient_email,subject,followup_body,sequence_name,scheduled_for)
    VALUES ('preserved','org-preserved','support','Support','general_question','lead@example.test','Hello','Body','Sequence',NOW());`);
}

async function migrationLedgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations
    WHERE migration_id='0020_agentmail_followup_schema.sql'`)).rows[0].n;
}

after(async () => {
  await database.end();
  for (const ownedSchema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${ownedSchema}" CASCADE`);
  await admin.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("0020 creates the formal schema and the read-only validator accepts it", async () => {
  assert.equal((await database.query(`SELECT to_regclass('agent_mail_followups') name`)).rows[0].name, "agent_mail_followups");
  await validation.validateAgentMailFollowupSchema();
});

test("fresh, repeated, and three concurrent application migrators converge on one 0020 ledger row", async () => {
  const pool = await poolFor();
  await Promise.all([1, 2, 3].map(() => migrations.runApplicationMigrations(pool, { migrationsDirectory })));
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await migrationLedgerCount(pool), 1);
  await validation.validateAgentMailFollowupSchema(drizzle(pool));
  await pool.end();
});

test("same-name malformed indexes fail transactionally, remain untouched, and permit repaired retry", async t => {
  const cases = [
    ["active index is non-unique", `CREATE INDEX agent_mail_followups_sequence_step_unique
      ON agent_mail_followups(organization_id,source_reply_queue_id,sequence_step)
      WHERE source_reply_queue_id IS NOT NULL AND status IN ('scheduled','pending_review','sending','uncertain_provider_outcome')`],
    ["active index has wrong columns", `CREATE UNIQUE INDEX agent_mail_followups_sequence_step_unique
      ON agent_mail_followups(organization_id,source_reply_queue_id,status)
      WHERE source_reply_queue_id IS NOT NULL AND status IN ('scheduled','pending_review','sending','uncertain_provider_outcome')`],
    ["active index has wrong order", `CREATE UNIQUE INDEX agent_mail_followups_sequence_step_unique
      ON agent_mail_followups(source_reply_queue_id,organization_id,sequence_step)
      WHERE source_reply_queue_id IS NOT NULL AND status IN ('scheduled','pending_review','sending','uncertain_provider_outcome')`],
    ["active index has wrong predicate", `CREATE UNIQUE INDEX agent_mail_followups_sequence_step_unique
      ON agent_mail_followups(organization_id,source_reply_queue_id,sequence_step)
      WHERE source_reply_queue_id IS NOT NULL AND status IN ('scheduled','pending_review','sending')`],
    ["status scheduling index has wrong order", `CREATE INDEX idx_followup_org_status_scheduled
      ON agent_mail_followups(status,organization_id,scheduled_for)`],
    ["inbox index has wrong columns", `CREATE INDEX idx_followup_inbox ON agent_mail_followups(inbox)`],
  ] as const;
  for (const [name, malformedDdl] of cases) await t.test(name, async () => {
    const pool = await poolFor();
    await createCompatibleLegacyTable(pool);
    await pool.query(malformedDdl);
    const indexName = malformedDdl.match(/(?:INDEX)\s+(\w+)/i)?.[1];
    assert.ok(indexName);
    const before = (await pool.query(`SELECT pg_get_indexdef($1::regclass) definition`, [indexName])).rows[0].definition;
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /index .* contract mismatch/);
    assert.equal(await migrationLedgerCount(pool), 0);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM agent_mail_followups WHERE id='preserved'`)).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT to_regclass('agent_mail_followups') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='agent_mail_followups'::regclass
        AND attname='approved_payload_version' AND attnum>0 AND NOT attisdropped) rolled_back`)).rows[0].rolled_back, true);
    assert.equal((await pool.query(`SELECT pg_get_indexdef($1::regclass) definition`, [indexName])).rows[0].definition, before);
    await pool.query(`DROP INDEX "${indexName}"`);
    await migrations.runApplicationMigrations(pool, { migrationsDirectory });
    assert.equal(await migrationLedgerCount(pool), 1);
    await validation.validateAgentMailFollowupSchema(drizzle(pool));
    await pool.end();
  });
});

test("a same-name lifecycle constraint lookalike fails without ledger advancement and retries after explicit repair", async () => {
  const pool = await poolFor();
  await createCompatibleLegacyTable(pool);
  await pool.query(`ALTER TABLE agent_mail_followups ADD CONSTRAINT agent_mail_followups_contract_check
    CHECK (organization_id <> '')`);
  const before = (await pool.query(`SELECT pg_get_constraintdef(oid,false) definition FROM pg_constraint
    WHERE conrelid='agent_mail_followups'::regclass AND conname='agent_mail_followups_contract_check'`)).rows[0].definition;
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /lifecycle constraint mismatch/);
  assert.equal(await migrationLedgerCount(pool), 0);
  assert.equal((await pool.query(`SELECT pg_get_constraintdef(oid,false) definition FROM pg_constraint
    WHERE conrelid='agent_mail_followups'::regclass AND conname='agent_mail_followups_contract_check'`)).rows[0].definition, before);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM agent_mail_followups WHERE id='preserved'`)).rows[0].n, 1);
  await pool.query(`ALTER TABLE agent_mail_followups DROP CONSTRAINT agent_mail_followups_contract_check`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await migrationLedgerCount(pool), 1);
  await validation.validateAgentMailFollowupSchema(drizzle(pool));
  await pool.end();
});

test("only a real canonical primary key satisfies migration and runtime ownership", async t => {
  const cases = [
    ["same-name standalone unique index", `CREATE UNIQUE INDEX agent_mail_followups_pkey ON agent_mail_followups(id)`, "index"],
    ["UNIQUE(id) constraint substitute", `ALTER TABLE agent_mail_followups ADD UNIQUE(id)`, "unique"],
    ["composite primary key", `ALTER TABLE agent_mail_followups ADD CONSTRAINT agent_mail_followups_pkey PRIMARY KEY(id,organization_id)`, "primary"],
    ["wrong-key primary key", `ALTER TABLE agent_mail_followups ADD CONSTRAINT agent_mail_followups_pkey PRIMARY KEY(organization_id)`, "primary"],
  ] as const;
  for (const [name, substituteDdl, kind] of cases) await t.test(name, async () => {
    const pool = await poolFor();
    await createCompatibleLegacyTable(pool, "NOT NULL");
    await pool.query(substituteDdl);
    const before = kind === "index"
      ? (await pool.query(`SELECT pg_get_indexdef('agent_mail_followups_pkey'::regclass) definition`)).rows[0].definition
      : (await pool.query(`SELECT pg_get_constraintdef(oid,false) definition FROM pg_constraint
          WHERE conrelid='agent_mail_followups'::regclass AND contype=${kind === "unique" ? "'u'" : "'p'"}`)).rows[0].definition;
    await assert.rejects(validation.validateAgentMailFollowupSchema(drizzle(pool)), validation.AgentMailFollowupSchemaUnavailableError);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /primary key|agent_mail_followups_pkey|contract mismatch|already exists/i);
    assert.equal(await migrationLedgerCount(pool), 0);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM agent_mail_followups WHERE id='preserved'`)).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_attribute WHERE attrelid='agent_mail_followups'::regclass
      AND attname IN ('approved_payload_version','send_attempt_count','send_claimed_at') AND attnum>0 AND NOT attisdropped`)).rows[0].n, 0);
    const afterDefinition = kind === "index"
      ? (await pool.query(`SELECT pg_get_indexdef('agent_mail_followups_pkey'::regclass) definition`)).rows[0].definition
      : (await pool.query(`SELECT pg_get_constraintdef(oid,false) definition FROM pg_constraint
          WHERE conrelid='agent_mail_followups'::regclass AND contype=${kind === "unique" ? "'u'" : "'p'"}`)).rows[0].definition;
    assert.equal(afterDefinition, before);
    if (kind === "index") await pool.query(`DROP INDEX agent_mail_followups_pkey`);
    else if (kind === "unique") await pool.query(`ALTER TABLE agent_mail_followups DROP CONSTRAINT agent_mail_followups_id_key`);
    else await pool.query(`ALTER TABLE agent_mail_followups DROP CONSTRAINT agent_mail_followups_pkey`);
    await pool.query(`ALTER TABLE agent_mail_followups ADD CONSTRAINT agent_mail_followups_pkey PRIMARY KEY(id)`);
    await migrations.runApplicationMigrations(pool, { migrationsDirectory });
    assert.equal(await migrationLedgerCount(pool), 1);
    await validation.validateAgentMailFollowupSchema(drizzle(pool));
    const canonical = (await pool.query(`SELECT i.indisprimary,i.indisunique,c.contype,c.convalidated,
      array_agg(a.attname ORDER BY k.ordinality)::text[] columns
      FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid JOIN pg_class t ON t.oid=c.conrelid
      JOIN unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) ON true
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
      WHERE c.conrelid='agent_mail_followups'::regclass AND c.contype='p'
      GROUP BY i.indisprimary,i.indisunique,c.contype,c.convalidated`)).rows[0];
    assert.deepEqual(canonical, { indisprimary: true, indisunique: true, contype: "p", convalidated: true, columns: ["id"] });
    await pool.end();
  });
});

test("runtime rejects a unique-index PK substitute repeatedly without repairing it", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await pool.query(`ALTER TABLE agent_mail_followups DROP CONSTRAINT agent_mail_followups_pkey;
    CREATE UNIQUE INDEX agent_mail_followups_pkey ON agent_mail_followups(id)`);
  const before = (await pool.query(`SELECT pg_get_indexdef('agent_mail_followups_pkey'::regclass) definition`)).rows[0].definition;
  await assert.rejects(validation.validateAgentMailFollowupSchema(drizzle(pool)), validation.AgentMailFollowupSchemaUnavailableError);
  await assert.rejects(validation.validateAgentMailFollowupSchema(drizzle(pool)), validation.AgentMailFollowupSchemaUnavailableError);
  assert.equal((await pool.query(`SELECT pg_get_indexdef('agent_mail_followups_pkey'::regclass) definition`)).rows[0].definition, before);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_constraint
    WHERE conrelid='agent_mail_followups'::regclass AND contype='p'`)).rows[0].n, 0);
  await pool.query(`DROP INDEX agent_mail_followups_pkey;
    ALTER TABLE agent_mail_followups ADD CONSTRAINT agent_mail_followups_pkey PRIMARY KEY(id)`);
  await validation.validateAgentMailFollowupSchema(drizzle(pool));
  await pool.end();
});

test("runtime validator rejects exact index, predicate, and constraint drift twice without repair", async t => {
  const mutations = [
    `DROP INDEX agent_mail_followups_sequence_step_unique; CREATE UNIQUE INDEX agent_mail_followups_sequence_step_unique
      ON agent_mail_followups(organization_id,source_reply_queue_id,sequence_step)
      WHERE source_reply_queue_id IS NOT NULL AND status IN ('scheduled','pending_review','sending')`,
    `DROP INDEX idx_followup_inbox; CREATE INDEX idx_followup_inbox ON agent_mail_followups(inbox,organization_id)`,
    `ALTER TABLE agent_mail_followups DROP CONSTRAINT agent_mail_followups_contract_check;
      ALTER TABLE agent_mail_followups ADD CONSTRAINT agent_mail_followups_contract_check CHECK (organization_id <> '')`,
  ];
  for (const mutation of mutations) await t.test(mutation.slice(0, 54), async () => {
    const pool = await poolFor();
    await migrations.runApplicationMigrations(pool, { migrationsDirectory });
    await pool.query(mutation);
    const before = (await pool.query(`SELECT array_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid) indexes,
      array_agg(pg_get_constraintdef(oid,false) ORDER BY oid) constraints FROM pg_index
      RIGHT JOIN pg_constraint ON conrelid='agent_mail_followups'::regclass
      WHERE indrelid='agent_mail_followups'::regclass OR indrelid IS NULL`)).rows[0];
    await assert.rejects(validation.validateAgentMailFollowupSchema(drizzle(pool)), validation.AgentMailFollowupSchemaUnavailableError);
    await assert.rejects(validation.validateAgentMailFollowupSchema(drizzle(pool)), validation.AgentMailFollowupSchemaUnavailableError);
    const afterState = (await pool.query(`SELECT array_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid) indexes,
      array_agg(pg_get_constraintdef(oid,false) ORDER BY oid) constraints FROM pg_index
      RIGHT JOIN pg_constraint ON conrelid='agent_mail_followups'::regclass
      WHERE indrelid='agent_mail_followups'::regclass OR indrelid IS NULL`)).rows[0];
    assert.deepEqual(afterState, before);
    await pool.end();
  });
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

test("provider success followed by persistence failure stays claimed and suppresses a second send", async () => {
  const id = randomUUID(), org = `org-${randomUUID()}`;
  await approvedFollowup(id, org);
  await database.query(`CREATE FUNCTION reject_followup_sent_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status='sent' THEN RAISE EXCEPTION 'injected persistence failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_followup_sent BEFORE UPDATE ON agent_mail_followups
      FOR EACH ROW EXECUTE FUNCTION reject_followup_sent_update()`);
  let calls = 0;
  const invokeProvider = async () => { calls++; return { ok: true, messageId: "accepted-once" }; };
  const first = await service.sendApprovedFollowup(
    { followupId: id, organizationId: org, actor: "reviewer" }, { invokeProvider: invokeProvider as any });
  const second = await service.sendApprovedFollowup(
    { followupId: id, organizationId: org, actor: "reviewer" }, { invokeProvider: invokeProvider as any });
  assert.deepEqual(first, { ok: false, error: "Provider result could not be durably recorded" });
  assert.equal(second.ok, false);
  assert.equal(calls, 1);
  assert.deepEqual(Object.values((await database.query(`SELECT status,send_attempt_count,provider_message_id
    FROM agent_mail_followups WHERE id=$1`, [id])).rows[0]), ["sending",1,null]);
  await database.query(`DROP TRIGGER reject_followup_sent ON agent_mail_followups; DROP FUNCTION reject_followup_sent_update()`);
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
