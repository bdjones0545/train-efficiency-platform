import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
const { Pool } = pg;
const admin = new Pool({ connectionString });
const schemas: string[] = [];
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const legacyDirectory = await mkdtemp(join(tmpdir(), "coordination-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter(name => /^00(?:0\d|1[0-3])_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}
const migrations = await import("../application-migrations");
const dbModule = await import("../db");
const service = await import("../services/cross-agent-coordination-service");
const validation = await import("../cross-agent-coordination-schema-validation");

async function poolFor(prefix: string): Promise<pg.Pool> {
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 12, options: `-c search_path=${schema}` });
}

async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations
    WHERE migration_id='0014_cross_agent_coordination_schema.sql'`)).rows[0].n;
}

async function createLegacyTables(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE agent_action_registry (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id text NOT NULL,action_type text NOT NULL,
      gmail_thread_id text,source_conversation_id text,prospect_id text,lead_id text,
      status text NOT NULL DEFAULT 'active',support_score integer DEFAULT 1,source_agents text[] DEFAULT ARRAY[]::text[],
      last_agent text,source_action_id text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE coordination_decisions (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id text NOT NULL,action_type text NOT NULL,
      gmail_thread_id text,source_conversation_id text,prospect_id text,lead_id text,decision text NOT NULL,
      original_action_id text,merged_action_id text,support_score integer DEFAULT 1,requesting_agent text,
      metadata jsonb,created_at timestamptz DEFAULT now());
  `);
}

before(async () => {
  await migrations.runApplicationMigrations(dbModule.pool, { migrationsDirectory });
  await dbModule.pool.query(`DELETE FROM coordination_decisions; DELETE FROM agent_action_registry`);
});

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await dbModule.pool.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("fresh, repeat, and three concurrent migrators formally own Coordination", async () => {
  const pool = await poolFor("coord_fresh");
  await Promise.all([1, 2, 3].map(() => migrations.runApplicationMigrations(pool, { migrationsDirectory })));
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await validation.validateCrossAgentCoordinationSchema(drizzle(pool));
  await pool.end();
});

test("resolved legacy history is preserved without invented canonical identity", async () => {
  const pool = await poolFor("coord_resolved");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await createLegacyTables(pool);
  await pool.query(`INSERT INTO agent_action_registry(org_id,action_type,prospect_id,status,support_score,source_agents)
    VALUES('org-a','follow_up','P1','resolved',1,ARRAY['A'])`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const row = (await pool.query(`SELECT status,canonical_resource_type,coordination_generation FROM agent_action_registry`)).rows[0];
  assert.deepEqual(row, { status: "resolved", canonical_resource_type: null, coordination_generation: null });
  await pool.end();
});

test("unmapped active legacy states fail closed without ledger advancement", async t => {
  const cases = [
    ["single resource without generation", "'P1',NULL"],
    ["prospect and lead", "'P1','L1'"],
    ["no resource", "NULL,NULL"],
  ] as const;
  for (const [name, values] of cases) await t.test(name, async () => {
    const pool = await poolFor("coord_active");
    await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
    await createLegacyTables(pool);
    await pool.query(`INSERT INTO agent_action_registry(org_id,action_type,prospect_id,lead_id,status,support_score,source_agents)
      VALUES('org-a','follow_up',${values},'active',1,ARRAY['A'])`);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }));
    assert.equal(await ledgerCount(pool), 0);
    await pool.end();
  });
});

test("blank and default active tenants fail closed", async t => {
  for (const orgId of ["", "default"]) await t.test(orgId || "blank", async () => {
    const pool = await poolFor("coord_tenant");
    await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
    await createLegacyTables(pool);
    await pool.query(`ALTER TABLE agent_action_registry ADD COLUMN canonical_resource_type text;
      ALTER TABLE agent_action_registry ADD COLUMN canonical_resource_id text;
      ALTER TABLE agent_action_registry ADD COLUMN coordination_generation text`);
    await pool.query(`INSERT INTO agent_action_registry(org_id,action_type,prospect_id,canonical_resource_type,canonical_resource_id,coordination_generation,status,support_score,source_agents)
      VALUES($1,'follow_up','P1','prospect','P1','g1','active',1,ARRAY['A'])`, [orgId]);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }));
    assert.equal(await ledgerCount(pool), 0);
    await pool.end();
  });
});

test("duplicate active legacy supporters fail closed without ledger advancement", async () => {
  const pool = await poolFor("coord_duplicate_support");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await createLegacyTables(pool);
  await pool.query(`ALTER TABLE agent_action_registry ADD COLUMN canonical_resource_type text;
    ALTER TABLE agent_action_registry ADD COLUMN canonical_resource_id text;
    ALTER TABLE agent_action_registry ADD COLUMN coordination_generation text`);
  await pool.query(`INSERT INTO agent_action_registry(org_id,action_type,prospect_id,canonical_resource_type,canonical_resource_id,coordination_generation,status,support_score,source_agents)
    VALUES('org-a','follow_up','P1','prospect','P1','g1','active',2,ARRAY['A','A'])`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }));
  assert.equal(await ledgerCount(pool), 0);
  await pool.end();
});

test("explicit active-row repair permits migration retry", async () => {
  const pool = await poolFor("coord_repair");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await createLegacyTables(pool);
  await pool.query(`INSERT INTO agent_action_registry(org_id,action_type,prospect_id,status,support_score,source_agents)
    VALUES('org-a','follow_up','P1','active',1,ARRAY['A'])`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }));
  await pool.query(`ALTER TABLE agent_action_registry ADD COLUMN canonical_resource_type text;
    ALTER TABLE agent_action_registry ADD COLUMN canonical_resource_id text;
    ALTER TABLE agent_action_registry ADD COLUMN coordination_generation text;
    UPDATE agent_action_registry SET canonical_resource_type='prospect',canonical_resource_id='P1',coordination_generation='approved-generation'`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("legacy check-then-insert negative control permits two active rows", async () => {
  const pool = await poolFor("coord_race");
  await createLegacyTables(pool);
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await Promise.all([a.query("BEGIN"), b.query("BEGIN")]);
    const checked = await Promise.all([a, b].map(client => client.query(`SELECT count(*)::int n FROM agent_action_registry
      WHERE org_id='org-a' AND action_type='follow_up' AND prospect_id='P1' AND status='active'`)));
    assert.deepEqual(checked.map(result => result.rows[0].n), [0, 0]);
    await Promise.all([
      a.query(`INSERT INTO agent_action_registry(id,org_id,action_type,prospect_id) VALUES('A','org-a','follow_up','P1')`),
      b.query(`INSERT INTO agent_action_registry(id,org_id,action_type,prospect_id) VALUES('B','org-a','follow_up','P1')`),
    ]);
    await Promise.all([a.query("COMMIT"), b.query("COMMIT")]);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM agent_action_registry`)).rows[0].n, 2);
  } finally {
    a.release(); b.release(); await pool.end();
  }
});

test("ten concurrent same-agent attempts converge on one canonical ID and support unit", async () => {
  const orgId = `same-agent-${randomUUID()}`;
  const request = { orgId, actionType: "follow_up", coordinationGeneration: "run-1", prospectId: "P1", agentName: "A" };
  const results = await Promise.all(Array.from({ length: 10 }, () => service.checkCoordination(request)));
  assert.equal(new Set(results.map(result => result.actionId)).size, 1);
  assert.equal(results.filter(result => result.action === "created").length, 1);
  assert.ok(results.every(result => result.supportScore === 1));
  const row = (await dbModule.pool.query(`SELECT support_score,source_agents FROM agent_action_registry WHERE org_id=$1`, [orgId])).rows[0];
  assert.deepEqual(row, { support_score: 1, source_agents: ["A"] });
});

test("concurrent distinct agents preserve all supporters and merged result", async () => {
  const orgId = `agents-${randomUUID()}`;
  const base = { orgId, actionType: "follow_up", coordinationGeneration: "run-1", prospectId: "P1" };
  const results = await Promise.all(["A", "B", "C"].map(agentName => service.checkCoordination({ ...base, agentName })));
  assert.equal(new Set(results.map(result => result.actionId)).size, 1);
  const row = (await dbModule.pool.query(`SELECT support_score,source_agents FROM agent_action_registry WHERE org_id=$1`, [orgId])).rows[0];
  assert.equal(row.support_score, 3);
  assert.deepEqual([...row.source_agents].sort(), ["A", "B", "C"]);
  assert.ok(results.some(result => result.action === "merged"));
});

test("tenant, generation, resource type, and action type independently scope identity", async () => {
  const marker = randomUUID();
  const requests = [
    { orgId: `a-${marker}`, actionType: "follow_up", coordinationGeneration: "g1", prospectId: "shared", agentName: "A" },
    { orgId: `b-${marker}`, actionType: "follow_up", coordinationGeneration: "g1", prospectId: "shared", agentName: "A" },
    { orgId: `a-${marker}`, actionType: "follow_up", coordinationGeneration: "g2", prospectId: "shared", agentName: "A" },
    { orgId: `a-${marker}`, actionType: "follow_up", coordinationGeneration: "g1", leadId: "shared", agentName: "A" },
    { orgId: `a-${marker}`, actionType: "schedule", coordinationGeneration: "g1", prospectId: "shared", agentName: "A" },
  ];
  const results = await Promise.all(requests.map(request => service.checkCoordination(request)));
  assert.equal(new Set(results.map(result => result.actionId)).size, 5);
});

test("resolution targets exact tenant, action, resource, and generation", async () => {
  const orgId = `resolve-${randomUUID()}`;
  const first = { orgId, actionType: "follow_up", coordinationGeneration: "g1", prospectId: "P1", agentName: "A" };
  const second = { ...first, coordinationGeneration: "g2" };
  const [a, b] = await Promise.all([service.checkCoordination(first), service.checkCoordination(second)]);
  assert.equal(await service.resolveCoordinationEntry(first), a.actionId);
  assert.equal((await dbModule.pool.query(`SELECT status FROM agent_action_registry WHERE id=$1`, [b.actionId])).rows[0].status, "active");
  await assert.rejects(service.resolveCoordinationEntry(first), service.CoordinationEntryNotFoundError);
});

test("decision history remains append-only and stats remain tenant scoped", async () => {
  const orgId = `stats-${randomUUID()}`;
  const request = { orgId, actionType: "follow_up", coordinationGeneration: "g1", prospectId: "P1" };
  const results = await Promise.all(["A", "B", "C"].map(agentName => service.checkCoordination({ ...request, agentName })));
  const history = await dbModule.pool.query(`SELECT registry_id,decision FROM coordination_decisions WHERE org_id=$1`, [orgId]);
  assert.equal(history.rowCount, 3);
  assert.ok(history.rows.every(row => row.registry_id === results[0].actionId));
  const stats = await service.getCoordinationStats(orgId);
  assert.deepEqual({ total: stats.totalDecisions, active: stats.activeInRegistry }, { total: 3, active: 1 });
});

test("runtime validator rejects structural drift and performs no repair", async t => {
  const pool = await poolFor("coord_drift");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const executor = drizzle(pool);
  const mutations = [
    ["missing table", `DROP TABLE coordination_decisions`],
    ["missing column", `ALTER TABLE agent_action_registry DROP COLUMN canonical_resource_id`],
    ["wrong resource type", `ALTER TABLE agent_action_registry ALTER COLUMN canonical_resource_type TYPE varchar`],
    ["wrong generation type", `ALTER TABLE agent_action_registry ALTER COLUMN coordination_generation TYPE varchar`],
    ["wrong default", `ALTER TABLE agent_action_registry ALTER COLUMN support_score SET DEFAULT 1`],
    ["missing PK", `ALTER TABLE agent_action_registry DROP CONSTRAINT agent_action_registry_pkey`],
    ["wrong PK", `ALTER TABLE agent_action_registry DROP CONSTRAINT agent_action_registry_pkey; ALTER TABLE agent_action_registry ADD PRIMARY KEY(org_id,id)`],
    ["missing active unique", `DROP INDEX idx_aar_active_canonical_identity`],
    ["nonpartial unique", `DROP INDEX idx_aar_active_canonical_identity; CREATE UNIQUE INDEX idx_aar_active_canonical_identity ON agent_action_registry(org_id,action_type,canonical_resource_type,canonical_resource_id,coordination_generation)`],
    ["wrong partial predicate", `DROP INDEX idx_aar_active_canonical_identity; CREATE UNIQUE INDEX idx_aar_active_canonical_identity ON agent_action_registry(org_id,action_type,canonical_resource_type,canonical_resource_id,coordination_generation) WHERE status='resolved'`],
    ["malformed same-name index", `DROP INDEX idx_aar_active_canonical_identity; CREATE UNIQUE INDEX idx_aar_active_canonical_identity ON agent_action_registry(action_type,org_id,canonical_resource_type,canonical_resource_id,coordination_generation) WHERE status='active'`],
    ["wrong distinct-agent function", `CREATE OR REPLACE FUNCTION cross_agent_coordination_has_distinct_agents(agents text[]) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS 'SELECT true'`],
  ] as const;
  for (const [name, mutation] of mutations) await t.test(name, async () => {
    await pool.query("BEGIN");
    await pool.query(mutation);
    await assert.rejects(validation.validateCrossAgentCoordinationSchema(executor), validation.CrossAgentCoordinationSchemaUnavailableError);
    await pool.query("ROLLBACK");
  });
  await pool.end();
});

test("database check rejects incomplete active identity and zero support", async () => {
  const pool = await poolFor("coord_active_check");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await assert.rejects(pool.query(`INSERT INTO agent_action_registry(org_id,action_type,status)
    VALUES('org-a','follow_up','active')`));
  await assert.rejects(pool.query(`INSERT INTO agent_action_registry(org_id,action_type,canonical_resource_type,canonical_resource_id,coordination_generation,status)
    VALUES('org-a','follow_up','prospect','P1','g1','active')`));
  await assert.rejects(pool.query(`INSERT INTO agent_action_registry(org_id,action_type,canonical_resource_type,canonical_resource_id,coordination_generation,status,support_score,source_agents)
    VALUES('default','follow_up','prospect','P1','g1','active',1,ARRAY['A'])`));
  await assert.rejects(pool.query(`INSERT INTO agent_action_registry(org_id,action_type,canonical_resource_type,canonical_resource_id,coordination_generation,status,support_score,source_agents)
    VALUES('org-a','follow_up','prospect','P1','g1','active',2,ARRAY['A','A'])`));
  await pool.end();
});

test("runtime service and validator contain no structural DDL", async () => {
  for (const file of ["../services/cross-agent-coordination-service.ts", "../cross-agent-coordination-schema-validation.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|CONSTRAINT)\b/i);
  }
});
