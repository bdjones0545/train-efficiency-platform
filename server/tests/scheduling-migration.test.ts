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
const legacyDirectory = await mkdtemp(join(tmpdir(), "scheduling-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter(name => /^(?:000\d)_.*\.sql$/.test(name)))
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
const migrations = await import("../application-migrations");

async function poolFor(): Promise<pg.Pool> {
  const schema = `scheduling_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}
async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations
    WHERE migration_id='0010_scheduling_schema.sql'`)).rows[0].n;
}
after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("fresh migration formally owns the fourteen Scheduling tables", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const expected = ["athlete_scheduling_profiles","session_recurrence_rules","waitlist_holds","session_waitlists",
    "scheduling_health_snapshots","session_performance_scores","scheduling_opportunities","retention_risk_scores",
    "fill_campaign_drafts","fill_campaign_submissions","fill_opportunity_scores","fill_revenue_policies",
    "fill_campaign_attributions","scheduling_recommendation_actions"];
  for (const table of expected) assert.equal((await pool.query("SELECT to_regclass($1) relation", [table])).rows[0].relation, table);
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("repeat and three concurrent migrators converge on one Scheduling ledger row", async () => {
  const pool = await poolFor();
  await Promise.all([1,2,3].map(() => migrations.runApplicationMigrations(pool, { migrationsDirectory })));
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("partial legacy schema fails transactionally and repair then retry succeeds", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE scheduling_health_snapshots(id text PRIMARY KEY,org_id text NOT NULL,score integer NOT NULL)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /missing column|does not exist/);
  assert.equal(await ledgerCount(pool), 0);
  await pool.query(`DROP TABLE scheduling_health_snapshots`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("tenant identity type and nullability drift fail closed", async (t) => {
  for (const [name, definition] of [["wrong type", "org_id uuid NOT NULL"], ["nullable", "org_id text"]]) await t.test(name, async () => {
    const pool = await poolFor();
    await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
    await pool.query(`CREATE TABLE scheduling_opportunities(id text PRIMARY KEY,${definition},type text NOT NULL,priority text NOT NULL,title text NOT NULL,description text,estimated_value_cents integer,action_label text,action_data jsonb,status text NOT NULL,created_at timestamptz)`);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /contract mismatch/);
    assert.equal(await ledgerCount(pool), 0);
    await pool.end();
  });
});

test("wrong non-tenant type and primary key fail closed", async (t) => {
  for (const [name, mutation] of [["type", `ALTER TABLE scheduling_health_snapshots ALTER COLUMN score TYPE bigint`], ["primary key", `ALTER TABLE scheduling_health_snapshots DROP CONSTRAINT scheduling_health_snapshots_pkey; ALTER TABLE scheduling_health_snapshots ADD PRIMARY KEY(org_id)`]]) await t.test(name, async () => {
    const pool = await poolFor();
    await migrations.runApplicationMigrations(pool, { migrationsDirectory });
    await pool.query(`DELETE FROM train_efficiency_migrations WHERE migration_id='0010_scheduling_schema.sql'`);
    await pool.query(mutation);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /contract mismatch|PRIMARY KEY/);
    assert.equal(await ledgerCount(pool), 0);
    await pool.end();
  });
});

test("representative type and nullability drift across every Scheduling family fails transactionally", async (t) => {
  const mutations = [
    ["profiles", `ALTER TABLE athlete_scheduling_profiles ALTER COLUMN sport TYPE text`],
    ["recurrence", `ALTER TABLE session_recurrence_rules ALTER COLUMN days_of_week TYPE text USING days_of_week::text`],
    ["holds", `ALTER TABLE waitlist_holds ALTER COLUMN hold_expires_at TYPE timestamptz`],
    ["waitlists", `ALTER TABLE session_waitlists ALTER COLUMN participant_name TYPE text`],
    ["health", `ALTER TABLE scheduling_health_snapshots ALTER COLUMN score TYPE bigint`],
    ["performance", `ALTER TABLE session_performance_scores ALTER COLUMN label DROP NOT NULL`],
    ["opportunities", `ALTER TABLE scheduling_opportunities ALTER COLUMN action_data TYPE text USING action_data::text`],
    ["retention", `ALTER TABLE retention_risk_scores ALTER COLUMN risk_level DROP NOT NULL`],
    ["drafts", `ALTER TABLE fill_campaign_drafts ALTER COLUMN subject SET NOT NULL`],
    ["submissions", `ALTER TABLE fill_campaign_submissions ALTER COLUMN recipients TYPE text USING recipients::text`],
    ["scores", `ALTER TABLE fill_opportunity_scores ALTER COLUMN fill_probability TYPE bigint`],
    ["policies", `ALTER TABLE fill_revenue_policies ALTER COLUMN enabled TYPE text USING enabled::text`],
    ["attributions", `ALTER TABLE fill_campaign_attributions ALTER COLUMN hours_since_send TYPE text USING hours_since_send::text`],
    ["actions", `ALTER TABLE scheduling_recommendation_actions ALTER COLUMN opportunity_title DROP NOT NULL`],
  ] as const;
  for (const [name, mutation] of mutations) await t.test(name, async () => {
    const pool = await poolFor();
    await migrations.runApplicationMigrations(pool, { migrationsDirectory });
    await pool.query(`DELETE FROM train_efficiency_migrations WHERE migration_id='0010_scheduling_schema.sql'`);
    await pool.query(mutation);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /contract mismatch/);
    assert.equal(await ledgerCount(pool), 0);
    await pool.end();
  });
});

test("foreign-key target and delete-action drift fail closed", async (t) => {
  for (const [name, mutation] of [
    ["missing reference", `ALTER TABLE session_waitlists DROP CONSTRAINT session_waitlists_booking_id_fkey`],
    ["wrong delete action", `ALTER TABLE waitlist_holds DROP CONSTRAINT waitlist_holds_booking_id_fkey; ALTER TABLE waitlist_holds ADD FOREIGN KEY (booking_id) REFERENCES bookings(id)`],
  ]) await t.test(name, async () => {
    const pool = await poolFor();
    await migrations.runApplicationMigrations(pool, { migrationsDirectory });
    await pool.query(`DELETE FROM train_efficiency_migrations WHERE migration_id='0010_scheduling_schema.sql'`);
    await pool.query(mutation);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /invalid foreign key/);
    assert.equal(await ledgerCount(pool), 0);
    await pool.end();
  });
});

test("same-name malformed index and wrong order fail closed", async (t) => {
  for (const columns of ["created_at", "created_at,org_id"]) await t.test(columns, async () => {
    const pool = await poolFor();
    await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
    await pool.query(`CREATE TABLE scheduling_health_snapshots(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id text NOT NULL,score integer NOT NULL,utilization_score integer NOT NULL DEFAULT 0,revenue_score integer NOT NULL DEFAULT 0,attendance_score integer NOT NULL DEFAULT 0,retention_score integer NOT NULL DEFAULT 0,waitlist_score integer NOT NULL DEFAULT 0,label text NOT NULL DEFAULT 'Moderate',summary text,created_at timestamptz DEFAULT now())`);
    await pool.query(`CREATE INDEX scheduling_health_snapshots_org_created ON scheduling_health_snapshots(${columns})`);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /invalid index/);
    assert.equal(await ledgerCount(pool), 0);
    await pool.end();
  });
});

test("tenant-owned Scheduling identities can coexist across organizations", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await pool.query(`INSERT INTO fill_opportunity_scores(org_id,booking_id) VALUES('org-a','booking-1'),('org-b','booking-1')`);
  await assert.rejects(pool.query(`INSERT INTO fill_opportunity_scores(org_id,booking_id) VALUES('org-a','booking-1')`), /duplicate key/);
  await pool.end();
});

test("Scheduling runtime paths validate and do not structurally own Scheduling objects", async () => {
  for (const file of ["server/scheduling-intelligence-routes.ts","server/scheduling-phase2-routes.ts","server/routes.ts"]) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    if (file !== "server/scheduling-phase2-routes.ts") assert.doesNotMatch(source, /CREATE TABLE IF NOT EXISTS session_waitlists/);
  }
  const phase2 = await readFile(new URL("../scheduling-phase2-routes.ts", import.meta.url), "utf8");
  assert.match(phase2, /validateSchedulingSchema/);
  assert.doesNotMatch(phase2, /CREATE TABLE IF NOT EXISTS (?:athlete_scheduling_profiles|session_recurrence_rules|waitlist_holds|session_waitlists)/);
  const intelligence = await readFile(new URL("../scheduling-intelligence-routes.ts", import.meta.url), "utf8");
  assert.match(intelligence, /validateSchedulingSchema/);
  assert.doesNotMatch(intelligence, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i);
  const migration = await readFile(new URL("../../migrations/0010_scheduling_schema.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /job_execution_locks|google|calendar|provider|api[_-]?key|Stripe/i);
});

test("waitlist routes preserve access policy and map only schema-readiness failures to a safe 503", async () => {
  const source = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
  assert.match(source, /app\.get\("\/api\/bookings\/:id\/waitlist", async/);
  assert.match(source, /app\.post\("\/api\/bookings\/:id\/waitlist", isAuthenticated/);
  assert.match(source, /app\.delete\("\/api\/bookings\/:id\/waitlist", isAuthenticated/);
  assert.equal((source.match(/sendSchedulingSchemaUnavailable\(error, res\)/g) ?? []).length, 3);
  const { SchedulingSchemaUnavailableError, sendSchedulingSchemaUnavailable } = await import("../scheduling-schema-validation");
  let statusCode = 0; let body: unknown;
  const response = { status(code: number) { statusCode = code; return this; }, json(value: unknown) { body = value; return this; } };
  assert.equal(sendSchedulingSchemaUnavailable(new SchedulingSchemaUnavailableError(["internal.table detail"]), response as unknown as import("express").Response), true);
  assert.equal(statusCode, 503);
  assert.deepEqual(body, { message: "Scheduling schema unavailable" });
  assert.equal(JSON.stringify(body).includes("internal.table"), false);
  assert.equal(sendSchedulingSchemaUnavailable(new Error("ordinary failure"), response as unknown as import("express").Response), false);
});
