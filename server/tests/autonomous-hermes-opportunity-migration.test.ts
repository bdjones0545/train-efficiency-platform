import assert from "node:assert/strict";
import test, { after } from "node:test";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const admin = new Pool({ connectionString });
const schemas: string[] = [];
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const legacyDirectory = await mkdtemp(join(tmpdir(), "aho-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter((name) => /^000[0-6]_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}
const migrations = await import("../application-migrations");

async function poolFor(): Promise<pg.Pool> {
  const schema = `aho_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}

async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int AS n FROM train_efficiency_migrations
    WHERE migration_id='0007_autonomous_hermes_opportunity_schema.sql'`)).rows[0].n;
}

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("fresh database creates all migration-owned subsystem schemas exactly once", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  for (const table of [
    "decision_trust_registry", "autonomous_action_queue", "execution_events",
    "composio_hermes_events", "hermes_auto_learnings", "hermes_recommendations",
    "opportunity_acquisition_opportunities", "opportunity_outreach_executions", "opportunity_reply_events",
  ]) {
    assert.equal((await pool.query(`SELECT to_regclass($1) AS relation`, [table])).rows[0].relation, table);
  }
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("repeated and concurrent migration execution converges on one ledger entry", async () => {
  const pool = await poolFor();
  await Promise.all([
    migrations.runApplicationMigrations(pool, { migrationsDirectory }),
    migrations.runApplicationMigrations(pool, { migrationsDirectory }),
  ]);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("safe legacy opportunity columns are added transactionally", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE opportunity_acquisition_opportunities(
    id text PRIMARY KEY, org_id text NOT NULL, title text NOT NULL, source text NOT NULL DEFAULT 'Manual',
    company text NOT NULL DEFAULT '', type text NOT NULL DEFAULT 'coaching', location text NOT NULL DEFAULT 'Remote',
    estimated_value integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'new', fit_score integer NOT NULL DEFAULT 0,
    notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const columns = (await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='opportunity_acquisition_opportunities'`)).rows.map((row) => row.column_name);
  assert.ok(columns.includes("fingerprint"));
  assert.ok(columns.includes("final_outcome"));
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("incompatible nullable tenant identity fails closed without ledger advancement", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE opportunity_acquisition_opportunities(
    id text PRIMARY KEY, org_id text, title text NOT NULL, status text NOT NULL DEFAULT 'new')`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /incompatible nullable or typed tenant identity/);
  assert.equal(await ledgerCount(pool), 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='opportunity_acquisition_opportunities' AND column_name='fingerprint'`)).rows[0].n, 0);
  await pool.end();
});

test("conflicting same-name index cannot falsely satisfy tenant uniqueness", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE decision_trust_registry(
    id text PRIMARY KEY, org_id text NOT NULL, decision_type text NOT NULL, label text NOT NULL,
    autonomy_score integer DEFAULT 0, risk_level text DEFAULT 'medium', recommended_mode text DEFAULT 'observe')`);
  await pool.query(`CREATE UNIQUE INDEX decision_trust_registry_org_id_decision_type_key ON decision_trust_registry(id)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /missing tenant-scoped decision trust uniqueness/);
  assert.equal(await ledgerCount(pool), 0);
  await pool.end();
});

test("opportunity identities are tenant-scoped and reusable across organizations", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await pool.query(`INSERT INTO opportunity_qualification_assessments(id,org_id,opportunity_id)
    VALUES ('assessment-a','org-a','provider-opportunity'),('assessment-b','org-b','provider-opportunity')`);
  await assert.rejects(pool.query(`INSERT INTO opportunity_qualification_assessments(id,org_id,opportunity_id)
    VALUES ('assessment-c','org-a','provider-opportunity')`), /duplicate key/);
  await pool.end();
});

test("runtime validators accept migrated schema and reject missing schema without repair", async () => {
  await migrations.runApplicationMigrations(admin, { migrationsDirectory });
  const { validateFeatureSchema } = await import("../feature-schema-validation");
  await validateFeatureSchema("autonomous");
  await validateFeatureSchema("hermes");
  await validateFeatureSchema("opportunity");
  await admin.query(`DROP TABLE opportunity_reply_events`);
  await assert.rejects(validateFeatureSchema("opportunity"), /opportunity_reply_events/);
  assert.equal((await admin.query(`SELECT to_regclass('opportunity_reply_events') AS relation`)).rows[0].relation, null);
});

test("runtime feature helpers contain validation only and no structural DDL", async () => {
  const files = [
    "server/autonomy-trust-routes.ts", "server/composio-hermes-emitter.ts", "server/opportunity-acquisition-routes.ts", "server/routes.ts",
    "server/services/autonomy-scoring-service.ts", "server/services/hermes-learning-service.ts",
    "server/services/hermes-recommendation-engine.ts", "server/services/unified-execution-engine.ts",
    "server/services/opportunity-acquisition-orchestrator.ts", "server/services/opportunity-discovery-agent.ts",
    "server/services/opportunity-executive-agent.ts", "server/services/opportunity-learning-agent.ts",
    "server/services/opportunity-outreach-agent.ts", "server/services/opportunity-outreach-execution-agent.ts",
    "server/services/opportunity-qualification-agent.ts", "server/services/opportunity-reply-intelligence-agent.ts",
  ];
  const ownedObjects = /(?:decision_trust_registry|autonomous_action_queue|autonomy_overrides|business_objectives|autonomous_initiatives|business_memory|autonomous_actions|recommendation_tracking|execution_events|composio_hermes_events|hermes_auto_learnings|hermes_recommendations|hermes_recommendation_feedback|opportunity_acquisition_opportunities|opportunity_agent_events|opportunity_qualification_assessments|opportunity_outreach_drafts|opportunity_source_settings|opportunity_discovery_runs|opportunity_acquisition_cycles|opportunity_outreach_executions|opportunity_reply_events|opportunity_learning_signals|opportunity_learning_insights|opportunity_executive_briefs|opportunity_recommendations)/i;
  for (const file of files) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    for (const statement of source.match(/\b(?:CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TYPE)|ALTER\s+(?:TABLE|TYPE)|DROP\s+(?:INDEX|CONSTRAINT))[^;`]+/gi) ?? []) {
      assert.doesNotMatch(statement, ownedObjects, file);
    }
  }
  const validator = await readFile(new URL("../feature-schema-validation.ts", import.meta.url), "utf8");
  assert.match(validator, /information_schema\.columns/);
  assert.match(validator, /pg_index/);
  assert.doesNotMatch(validator, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i);
});

test("schema preparation is provider-independent", async () => {
  const migration = await readFile(new URL("../../migrations/0007_autonomous_hermes_opportunity_schema.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /OpenAI|fetch\(|axios|api[_-]?key/i);
  assert.match(migration, /opportunity_outreach_executions/);
  assert.match(migration, /composio_hermes_events/);
});
