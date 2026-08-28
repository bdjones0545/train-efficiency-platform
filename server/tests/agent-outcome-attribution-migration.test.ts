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
process.env.DATABASE_URL = connectionString;
const { Pool } = pg;
const admin = new Pool({ connectionString });
const schemas: string[] = [];
const roles: string[] = [];
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const legacyDirectory = await mkdtemp(join(tmpdir(), "outcome-attribution-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter(name => /^(?:000\d|001[0-8])_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}
const migrations = await import("../application-migrations");
const validation = await import("../agent-outcome-attribution-schema-validation");

async function poolFor(): Promise<pg.Pool> {
  const schema = `outcome_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}
async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations
    WHERE migration_id='0019_agent_outcome_attribution_schema.sql'`)).rows[0].n;
}
async function legacy(pool: pg.Pool): Promise<void> {
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`
    CREATE TABLE agent_decision_outcomes(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id text NOT NULL,
      agent_type text NOT NULL,recommendation text NOT NULL,action_taken text,expected_outcome text,actual_outcome text,
      success_score integer,domain text,tags jsonb DEFAULT '[]'::jsonb,revenue_cents integer DEFAULT 0,
      meetings_generated integer DEFAULT 0,outcome_date timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE agent_perf_scores(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id text NOT NULL,agent_type text NOT NULL,
      recommendations_issued integer DEFAULT 0,recommendations_executed integer DEFAULT 0,success_rate integer DEFAULT 0,
      revenue_influenced integer DEFAULT 0,meetings_generated integer DEFAULT 0,retention_impact integer DEFAULT 0,
      last_calculated_at timestamptz DEFAULT now(),UNIQUE(org_id,agent_type));
    CREATE TABLE ceo_daily_reviews(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id text NOT NULL,review_date date NOT NULL,
      what_worked text NOT NULL,what_failed text NOT NULL,what_repeat text NOT NULL,what_stop text NOT NULL,
      outcomes_analyzed integer DEFAULT 0,ai_generated boolean DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
      UNIQUE(org_id,review_date));
    CREATE TABLE org_playbooks(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id text NOT NULL,title text NOT NULL,
      description text,source_learning text,pattern_type text,success_rate integer DEFAULT 0,evidence_count integer DEFAULT 0,
      trigger_condition text,actions text,expected_outcome text,status text DEFAULT 'active',promoted_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now());
  `);
}

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  for (const role of roles) await admin.query(`DROP ROLE IF EXISTS "${role}"`);
  await admin.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("fresh, repeated, and three concurrent migrators formally own Agent Outcome Attribution", async () => {
  const pool = await poolFor();
  await Promise.all([1, 2, 3].map(() => migrations.runApplicationMigrations(pool, { migrationsDirectory })));
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await validation.validateAgentOutcomeAttributionSchema(drizzle(pool));
  await pool.end();
});

test("compatible runtime-created legacy rows and nullable source learning are preserved", async () => {
  const pool = await poolFor();
  await legacy(pool);
  await pool.query(`INSERT INTO agent_decision_outcomes(id,org_id,agent_type,recommendation) VALUES('decision-a','org-a','hermes','Do it')`);
  await pool.query(`INSERT INTO org_playbooks(id,org_id,title,source_learning) VALUES('playbook-a','org-a','Play',NULL)`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await pool.query(`SELECT count(*)::int n FROM agent_decision_outcomes`)).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT source_learning FROM org_playbooks WHERE id='playbook-a'`)).rows[0].source_learning, null);
  assert.equal(await ledgerCount(pool), 1);
  await validation.validateAgentOutcomeAttributionSchema(drizzle(pool));
  await pool.end();
});

test("incompatible legacy structure fails transactionally without changing rows or ledger", async () => {
  const pool = await poolFor();
  await legacy(pool);
  await pool.query(`INSERT INTO agent_decision_outcomes(id,org_id,agent_type,recommendation) VALUES('kept','org-a','hermes','Keep')`);
  await pool.query(`ALTER TABLE agent_decision_outcomes ALTER COLUMN recommendation TYPE varchar(40)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /column contract mismatch/);
  assert.equal(await ledgerCount(pool), 0);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM agent_decision_outcomes WHERE id='kept'`)).rows[0].n, 1);
  await pool.end();
});

test("exact default containment rejects lookalike text and timestamp expressions", async t => {
  const drifts = [
    `ALTER TABLE org_playbooks ALTER COLUMN status SET DEFAULT 'active_later'`,
    `ALTER TABLE agent_decision_outcomes ALTER COLUMN created_at SET DEFAULT (now() + interval '1 day')`,
  ];
  for (const drift of drifts) await t.test(drift, async () => {
    const pool = await poolFor();
    await legacy(pool);
    await pool.query(drift);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /column contract mismatch/);
    assert.equal(await ledgerCount(pool), 0);
    await pool.end();
  });
});

test("runtime validator rejects structural drift twice and never repairs it", async t => {
  const mutations = [
    `DROP TABLE org_playbooks`,
    `ALTER TABLE agent_decision_outcomes DROP COLUMN domain`,
    `ALTER TABLE agent_perf_scores ALTER COLUMN success_rate TYPE bigint`,
    `ALTER TABLE ceo_daily_reviews ALTER COLUMN what_worked DROP NOT NULL`,
    `ALTER TABLE org_playbooks ALTER COLUMN status SET DEFAULT 'active_later'`,
    `ALTER TABLE agent_decision_outcomes DROP CONSTRAINT agent_decision_outcomes_pkey; ALTER TABLE agent_decision_outcomes ADD PRIMARY KEY(id,org_id)`,
    `ALTER TABLE agent_perf_scores DROP CONSTRAINT agent_perf_scores_org_id_agent_type_key`,
    `ALTER TABLE ceo_daily_reviews DROP CONSTRAINT ceo_daily_reviews_org_id_review_date_key; ALTER TABLE ceo_daily_reviews ADD UNIQUE(review_date,org_id)`,
    `CREATE UNIQUE INDEX org_playbooks_title_unique ON org_playbooks(title)`,
  ];
  for (const mutation of mutations) await t.test(mutation.slice(0, 56), async () => {
    const pool = await poolFor();
    await migrations.runApplicationMigrations(pool, { migrationsDirectory });
    await pool.query(mutation);
    await assert.rejects(validation.validateAgentOutcomeAttributionSchema(drizzle(pool)), validation.AgentOutcomeAttributionSchemaUnavailableError);
    await assert.rejects(validation.validateAgentOutcomeAttributionSchema(drizzle(pool)), validation.AgentOutcomeAttributionSchemaUnavailableError);
    await pool.end();
  });
});

test("empty-schema validation fails closed and creates nothing", async () => {
  const pool = await poolFor();
  await assert.rejects(validation.validateAgentOutcomeAttributionSchema(drizzle(pool)), validation.AgentOutcomeAttributionSchemaUnavailableError);
  for (const table of ["agent_decision_outcomes", "agent_perf_scores", "ceo_daily_reviews", "org_playbooks"]) {
    assert.equal((await pool.query(`SELECT to_regclass($1) relation`, [table])).rows[0].relation, null);
  }
  await pool.end();
});

test("runtime validator preserves ordinary database failures for callers", async () => {
  const ordinaryFailure = new Error("ordinary database failure");
  const executor = { execute: async () => { throw ordinaryFailure; } } as any;
  await assert.rejects(
    validation.validateAgentOutcomeAttributionSchema(executor),
    error => error === ordinaryFailure,
  );
});

test("DDL-restricted runtime role can validate formal schema but cannot create structures", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const schema = (await pool.query(`SELECT current_schema() schema`)).rows[0].schema as string;
  const role = `outcome_reader_${randomUUID().replaceAll("-", "")}`;
  roles.push(role);
  await admin.query(`CREATE ROLE "${role}" LOGIN`);
  await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
  const restrictedUrl = new URL(connectionString);
  restrictedUrl.username = role;
  const restricted = new Pool({ connectionString: restrictedUrl.toString(), options: `-c search_path=${schema}` });
  assert.equal((await restricted.query(`SELECT current_user role`)).rows[0].role, role);
  await validation.validateAgentOutcomeAttributionSchema(drizzle(restricted));
  await assert.rejects(restricted.query(`CREATE TABLE runtime_ddl_must_fail(id integer)`), /permission denied/);
  assert.equal((await pool.query(`SELECT to_regclass('runtime_ddl_must_fail') relation`)).rows[0].relation, null);
  await restricted.end();
  await pool.end();
});

test("runtime has no structural DDL and all fourteen routes authenticate before readiness", async () => {
  const routeSource = await readFile(new URL("../agent-outcome-attribution-routes.ts", import.meta.url), "utf8");
  const validatorSource = await readFile(new URL("../agent-outcome-attribution-schema-validation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(routeSource, /CREATE TABLE|CREATE INDEX|ALTER TABLE|DROP TABLE|ADD COLUMN/i);
  assert.doesNotMatch(validatorSource, /CREATE TABLE|CREATE INDEX|ALTER TABLE|DROP TABLE|ADD COLUMN/i);
  const registrations = routeSource.match(/app\.(?:get|post|patch)\("\/api\/agent-outcomes[^\n]+/g) ?? [];
  assert.equal(registrations.length, 14);
  for (const registration of registrations) assert.match(registration, /isAuthenticated, requireAgentOutcomeAttributionSchema,/);
  assert.match(validatorSource, /status\(503\)\.json\(\{ message: "Agent Outcome Attribution unavailable" \}\)/);
});

test("tenant-scoped mutation contracts cannot update another organization", async () => {
  const routeSource = await readFile(new URL("../agent-outcome-attribution-routes.ts", import.meta.url), "utf8");
  const serviceSource = await readFile(new URL("../services/agent-outcome-attribution-service.ts", import.meta.url), "utf8");
  assert.match(serviceSource, /WHERE id = \$\{opts\.id\} AND org_id = \$\{opts\.orgId\}[\s\S]*RETURNING id/);
  assert.match(routeSource, /WHERE id = \$\{id\} AND org_id = \$\{orgId\}[\s\S]*RETURNING id/);
  assert.match(routeSource, /if \(!updated\) return res\.status\(404\)/);
  assert.match(routeSource, /result\.rows\.length === 0\) return res\.status\(404\)/);
});

test("forecast and autonomy consumers expose unavailable attribution instead of false scores", async () => {
  const forecast = await readFile(new URL("../services/forecast-engine.ts", import.meta.url), "utf8");
  const autonomy = await readFile(new URL("../services/autonomy-scoring-service.ts", import.meta.url), "utf8");
  assert.match(forecast, /attributionAvailable: outcomeRows\.available/);
  assert.doesNotMatch(forecast, /oa\.avg_score \?\? "60"/);
  assert.match(autonomy, /betterOutcomes:\s+outcomes\.available \?[^:]+: null/);
  assert.match(autonomy, /attributionAvailable: outcomes\.available/);
});
