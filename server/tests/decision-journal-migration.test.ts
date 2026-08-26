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
const { Pool } = pg;
const admin = new Pool({ connectionString });
const schemas: string[] = [];
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const legacyDirectory = await mkdtemp(join(tmpdir(), "decision-journal-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter(name => /^(?:000\d|001[01])_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}
const migrations = await import("../application-migrations");
let applicationPool: pg.Pool | undefined;

async function poolFor(): Promise<pg.Pool> {
  const schema = `decision_journal_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}

async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations
    WHERE migration_id='0012_decision_journal_schema.sql'`)).rows[0].n;
}

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await applicationPool?.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("fresh, repeated, and three concurrent migrators formally own Decision Journal", async () => {
  const pool = await poolFor();
  await Promise.all([1, 2, 3].map(() => migrations.runApplicationMigrations(pool, { migrationsDirectory })));
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await pool.query(`SELECT to_regclass('decision_journal_entries') relation`)).rows[0].relation, "decision_journal_entries");
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("compatible legacy table and ambiguous default rows are preserved without adoption", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE decision_journal_entries (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id text NOT NULL, agent text NOT NULL,
    source_type text NOT NULL, source text NOT NULL, decision text NOT NULL,
    reasoning text NOT NULL DEFAULT '', outcome text NOT NULL DEFAULT '', follow_up text NOT NULL DEFAULT '',
    confidence integer NOT NULL DEFAULT 75, decision_type text NOT NULL DEFAULT 'action',
    department text NOT NULL DEFAULT 'Operations', related_entity_type text, related_entity_id text,
    metadata jsonb DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  ); INSERT INTO decision_journal_entries(org_id,agent,source_type,source,decision)
    VALUES('default','legacy','human_admin','legacy','ambiguous');`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await pool.query(`SELECT count(*)::int n FROM decision_journal_entries WHERE org_id='default'`)).rows[0].n, 1);
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("incompatible legacy contracts fail transactionally and repair can retry", async (t) => {
  const cases = [
    ["partial table", `CREATE TABLE decision_journal_entries(id text PRIMARY KEY)`],
    ["wrong org type", `CREATE TABLE decision_journal_entries(id text PRIMARY KEY,org_id varchar NOT NULL)`],
  ] as const;
  for (const [name, setup] of cases) await t.test(name, async () => {
    const pool = await poolFor();
    await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
    await pool.query(setup);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }));
    assert.equal(await ledgerCount(pool), 0);
    await pool.end();
  });

  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE decision_journal_entries(id text PRIMARY KEY)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }));
  assert.equal(await ledgerCount(pool), 0);
  await pool.query(`DROP TABLE decision_journal_entries`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("runtime validator rejects column, default, PK, and index drift", async (t) => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const validation = await import("../decision-journal-schema-validation");
  const executor = drizzle(pool);
  await validation.validateDecisionJournalSchema(executor);
  const mutations = [
    ["missing table", `DROP TABLE decision_journal_entries`],
    ["missing column", `ALTER TABLE decision_journal_entries DROP COLUMN outcome`],
    ["wrong org type", `ALTER TABLE decision_journal_entries ALTER COLUMN org_id TYPE varchar`],
    ["wrong non-tenant type", `ALTER TABLE decision_journal_entries ALTER COLUMN confidence TYPE bigint`],
    ["required nullable", `ALTER TABLE decision_journal_entries ALTER COLUMN decision DROP NOT NULL`],
    ["optional not null", `ALTER TABLE decision_journal_entries ALTER COLUMN related_entity_id SET NOT NULL`],
    ["wrong default", `ALTER TABLE decision_journal_entries ALTER COLUMN confidence SET DEFAULT 50`],
    ["missing default", `ALTER TABLE decision_journal_entries ALTER COLUMN reasoning DROP DEFAULT`],
    ["missing PK", `ALTER TABLE decision_journal_entries DROP CONSTRAINT decision_journal_entries_pkey`],
    ["wrong PK", `ALTER TABLE decision_journal_entries DROP CONSTRAINT decision_journal_entries_pkey; ALTER TABLE decision_journal_entries ADD PRIMARY KEY(org_id,id)`],
    ["unique substitutes for PK", `ALTER TABLE decision_journal_entries DROP CONSTRAINT decision_journal_entries_pkey; CREATE UNIQUE INDEX decision_journal_entries_id_unique ON decision_journal_entries(id)`],
    ["missing index", `DROP INDEX idx_decision_journal_agent`],
    ["wrong index order", `DROP INDEX idx_decision_journal_created_at; CREATE INDEX idx_decision_journal_created_at ON decision_journal_entries(created_at ASC)`],
    ["same-name malformed index", `DROP INDEX idx_decision_journal_org_id; CREATE INDEX idx_decision_journal_org_id ON decision_journal_entries(agent,org_id)`],
    ["unique index mismatch", `DROP INDEX idx_decision_journal_source_type; CREATE UNIQUE INDEX idx_decision_journal_source_type ON decision_journal_entries(source_type)`],
  ] as const;
  for (const [name, mutation] of mutations) await t.test(name, async () => {
    await pool.query("BEGIN");
    await pool.query(mutation);
    await assert.rejects(validation.validateDecisionJournalSchema(executor), validation.DecisionJournalSchemaUnavailableError);
    await pool.query("ROLLBACK");
  });
  await pool.end();
});

test("tenant identity, empty history, and cross-tenant reads are explicit", async () => {
  const validation = await import("../decision-journal-schema-validation");
  assert.throws(() => validation.assertDecisionJournalTenant(undefined), validation.DecisionJournalTenantUnavailableError);
  assert.throws(() => validation.assertDecisionJournalTenant(""), validation.DecisionJournalTenantUnavailableError);
  assert.throws(() => validation.assertDecisionJournalTenant("default"), validation.DecisionJournalTenantUnavailableError);

  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await pool.query(`INSERT INTO decision_journal_entries(org_id,agent,source_type,source,decision,related_entity_id)
    VALUES('org-a','A','manual','test','A','shared-resource'),('org-b','B','manual','test','B','shared-resource')`);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM decision_journal_entries WHERE org_id='org-a'`)).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM decision_journal_entries WHERE org_id='org-c'`)).rows[0].n, 0);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM decision_journal_entries WHERE org_id='org-a' AND decision='B'`)).rows[0].n, 0);
  await pool.end();
});

test("service distinguishes durable success, valid empty history, insert failure, and unavailable schema", async () => {
  await migrations.runApplicationMigrations(undefined, { migrationsDirectory });
  const dbModule = await import("../db");
  applicationPool = dbModule.pool;
  const journal = await import("../services/decision-journal-service");
  const validation = await import("../decision-journal-schema-validation");
  await applicationPool.query(`DELETE FROM decision_journal_entries WHERE org_id IN ('dj-service-a','dj-service-b','dj-service-empty')`);

  const sharedResource = randomUUID();
  const idA = await journal.recordDecision({ orgId: "dj-service-a", agent: "A", sourceType: "manual", source: "test", decision: "A", relatedEntityId: sharedResource });
  const idB = await journal.recordDecision({ orgId: "dj-service-b", agent: "B", sourceType: "manual", source: "test", decision: "B", relatedEntityId: sharedResource });
  assert.ok(idA && idB && idA !== idB);
  assert.deepEqual((await journal.getDecisions({ orgId: "dj-service-a" })).map(row => row.decision), ["A"]);
  assert.deepEqual((await journal.getDecisions({ orgId: "dj-service-b" })).map(row => row.decision), ["B"]);
  assert.deepEqual(await journal.getDecisions({ orgId: "dj-service-empty" }), []);
  await assert.rejects(journal.recordDecision({ orgId: "default", agent: "X", sourceType: "manual", source: "test", decision: "X" }), validation.DecisionJournalTenantUnavailableError);

  await applicationPool.query(`ALTER TABLE decision_journal_entries ADD CONSTRAINT decision_journal_test_failure CHECK (decision <> 'reject-me')`);
  await assert.rejects(journal.recordDecision({ orgId: "dj-service-a", agent: "A", sourceType: "manual", source: "test", decision: "reject-me" }));
  assert.equal((await applicationPool.query(`SELECT count(*)::int n FROM decision_journal_entries WHERE decision='reject-me'`)).rows[0].n, 0);
  await applicationPool.query(`ALTER TABLE decision_journal_entries DROP CONSTRAINT decision_journal_test_failure`);

  await applicationPool.query(`ALTER TABLE decision_journal_entries RENAME TO decision_journal_entries_unavailable_test`);
  try {
    await assert.rejects(journal.getDecisions({ orgId: "dj-service-a" }), validation.DecisionJournalSchemaUnavailableError);
  } finally {
    await applicationPool.query(`ALTER TABLE decision_journal_entries_unavailable_test RENAME TO decision_journal_entries`);
  }
});

test("runtime paths contain no structural DDL and expose unavailable state", async () => {
  const service = await readFile(new URL("../services/decision-journal-service.ts", import.meta.url), "utf8");
  const validator = await readFile(new URL("../decision-journal-schema-validation.ts", import.meta.url), "utf8");
  const routes = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
  const forecast = await readFile(new URL("../services/forecast-engine.ts", import.meta.url), "utf8");
  const manualRoute = routes.slice(routes.indexOf("POST /api/organizational-memory/decisions/record"), routes.indexOf("// ── Software KB routes"));
  for (const source of [service, validator]) {
    assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i);
  }
  assert.doesNotMatch(service, /ensureDecisionJournalTable/);
  assert.match(service, /validateDecisionJournalSchema\(\)/);
  assert.match(service, /await db\.execute[\s\S]*void \(async \(\) =>/);
  assert.match(manualRoute, /profile\?\.organizationId;[\s\S]*No organization/);
  assert.doesNotMatch(manualRoute, /profile\?\.organizationId \?\? "default"/);
  assert.doesNotMatch(routes, /decision_description ILIKE/);
  assert.doesNotMatch(routes, /FROM decision_journal_entries[^;\n]*\.catch\(\(\) => \[\]\)/);
  assert.match(routes, /decision AS decision_description/);
  assert.match(forecast, /validateDecisionJournalSchema\(\)/);
  assert.match(forecast, /Decision Journal memory signal unavailable/);

  const { DecisionJournalSchemaUnavailableError, sendDecisionJournalUnavailable } = await import("../decision-journal-schema-validation");
  let code = 0; let body: any;
  const response = { status(value: number) { code = value; return this; }, json(value: any) { body = value; return this; } };
  assert.equal(sendDecisionJournalUnavailable(new DecisionJournalSchemaUnavailableError(["secret.detail"]), response as any), true);
  assert.equal(code, 503);
  assert.deepEqual(body, { message: "Decision Journal unavailable" });
  assert.equal(JSON.stringify(body).includes("secret"), false);
});
