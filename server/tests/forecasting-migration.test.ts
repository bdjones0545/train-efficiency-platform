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
const legacyDirectory = await mkdtemp(join(tmpdir(), "forecasting-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter((name) => /^000[0-8]_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}
const migrations = await import("../application-migrations");

async function poolFor(): Promise<pg.Pool> {
  const schema = `forecasting_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}

async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int AS n FROM train_efficiency_migrations
    WHERE migration_id='0009_forecasting_schema.sql'`)).rows[0].n;
}

async function createLegacyOpportunitySignals(pool: pg.Pool, orgDefinition: string): Promise<void> {
  await pool.query(`CREATE TABLE opportunity_signals(
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text, ${orgDefinition}, category text NOT NULL,
    title text NOT NULL, description text, impact_level text, metric_name text,
    metric_value numeric(14,2), trend_pct numeric(8,2), recommended_action text,
    status text, detected_at timestamptz)`);
}

async function createLegacyBusinessForecasts(pool: pg.Pool): Promise<void> {
  await pool.query(`CREATE TABLE business_forecasts(
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id text NOT NULL,
    horizon_days integer NOT NULL, metric text NOT NULL, current_value numeric(14,2),
    projected_value numeric(14,2), change_pct numeric(8,2), confidence integer,
    variance_low numeric(14,2), variance_high numeric(14,2), supporting_factors jsonb,
    generated_at timestamptz)`);
}

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("fresh migration formally owns all seven Forecasting tables", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  for (const table of ["business_forecasts", "risk_signals", "opportunity_signals", "scenario_simulations",
    "strategic_plans", "forecast_accuracy", "business_twin_state"]) {
    assert.equal((await pool.query(`SELECT to_regclass($1) AS relation`, [table])).rows[0].relation, table);
    assert.deepEqual((await pool.query(`SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] AS columns
      FROM pg_constraint c JOIN unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) ON true
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.conrelid=$1::regclass AND c.contype='p' GROUP BY c.oid`, [table])).rows[0].columns, ["id"]);
  }
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("already-migrated, repeated, and three concurrent migrators converge on one ledger row", async () => {
  const pool = await poolFor();
  await Promise.all([
    migrations.runApplicationMigrations(pool, { migrationsDirectory }),
    migrations.runApplicationMigrations(pool, { migrationsDirectory }),
    migrations.runApplicationMigrations(pool, { migrationsDirectory }),
  ]);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("safe additive legacy forecast_date transition preserves existing rows", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await createLegacyBusinessForecasts(pool);
  await pool.query(`INSERT INTO business_forecasts(org_id,horizon_days,metric,generated_at)
    VALUES('org-a',30,'revenue','2026-08-01T12:00:00Z')`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const row = (await pool.query(`SELECT org_id,forecast_date::text AS forecast_date FROM business_forecasts`)).rows[0];
  assert.deepEqual(row, { org_id: "org-a", forecast_date: "2026-08-01" });
  await pool.end();
});

test("ambiguous legacy forecast duplicates roll back, do not record, and retry after explicit repair succeeds", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await createLegacyBusinessForecasts(pool);
  await pool.query(`INSERT INTO business_forecasts(org_id,horizon_days,metric,generated_at) VALUES
    ('org-a',30,'revenue','2026-08-01T10:00:00Z'),('org-a',30,'revenue','2026-08-01T12:00:00Z')`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /duplicate tenant forecast identity/);
  assert.equal(await ledgerCount(pool), 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='business_forecasts' AND column_name='forecast_date'`)).rows[0].n, 0);
  await pool.query(`DELETE FROM business_forecasts WHERE generated_at='2026-08-01T12:00:00Z'`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("partially present Forecasting schema and missing required persisted field fail closed", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE risk_signals(id text PRIMARY KEY, org_id text NOT NULL, category text NOT NULL)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }));
  assert.equal(await ledgerCount(pool), 0);
  await pool.end();
});

test("missing, nullable, and incorrectly typed tenant identity each fail closed", async (t) => {
  for (const scenario of [
    { name: "missing", definition: "org_missing text" },
    { name: "nullable", definition: "org_id text" },
    { name: "wrong type", definition: "org_id uuid NOT NULL" },
  ]) {
    await t.test(scenario.name, async () => {
      const pool = await poolFor();
      await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
      await createLegacyOpportunitySignals(pool, scenario.definition);
      await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /org_id/);
      assert.equal(await ledgerCount(pool), 0);
      await pool.end();
    });
  }
});

test("wrong non-tenant canonical types fail transactionally without recording 0009", async (t) => {
  const scenarios = [
    ["forecast integer", `ALTER TABLE business_forecasts ALTER COLUMN horizon_days TYPE text USING horizon_days::text`],
    ["forecast text", `ALTER TABLE business_forecasts ALTER COLUMN metric TYPE integer USING 0`],
    ["forecast numeric precision", `ALTER TABLE business_forecasts ALTER COLUMN current_value TYPE numeric(10,2)`],
    ["forecast jsonb", `ALTER TABLE business_forecasts ALTER COLUMN supporting_factors TYPE text USING supporting_factors::text`],
    ["forecast timestamp", `ALTER TABLE business_forecasts ALTER COLUMN generated_at TYPE timestamp USING generated_at::timestamp`],
    ["forecast date", `ALTER TABLE business_forecasts ALTER COLUMN forecast_date DROP DEFAULT; ALTER TABLE business_forecasts ALTER COLUMN forecast_date TYPE text USING forecast_date::text`],
    ["signal text", `ALTER TABLE risk_signals ALTER COLUMN title TYPE integer USING 0`],
    ["scenario jsonb", `ALTER TABLE scenario_simulations ALTER COLUMN parameters TYPE text USING parameters::text`],
    ["plan integer", `ALTER TABLE strategic_plans ALTER COLUMN horizon_days TYPE bigint`],
    ["accuracy timestamp", `ALTER TABLE forecast_accuracy ALTER COLUMN recorded_at TYPE timestamp USING recorded_at::timestamp`],
    ["business twin integer", `ALTER TABLE business_twin_state ALTER COLUMN active_clients TYPE bigint`],
  ] as const;
  for (const [name, mutation] of scenarios) {
    await t.test(name, async () => {
      const pool = await poolFor();
      await migrations.runApplicationMigrations(pool, { migrationsDirectory });
      await pool.query(`DELETE FROM train_efficiency_migrations WHERE migration_id='0009_forecasting_schema.sql'`);
      await pool.query(mutation);
      await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }));
      assert.equal(await ledgerCount(pool), 0);
      await pool.end();
    });
  }
});

test("nullable required non-tenant columns fail transactionally across Forecasting tables", async (t) => {
  const scenarios = [
    ["forecast metric", `ALTER TABLE business_forecasts ALTER COLUMN metric DROP NOT NULL`],
    ["risk category", `ALTER TABLE risk_signals ALTER COLUMN category DROP NOT NULL`],
    ["opportunity title", `ALTER TABLE opportunity_signals ALTER COLUMN title DROP NOT NULL`],
    ["scenario name", `ALTER TABLE scenario_simulations ALTER COLUMN name DROP NOT NULL`],
    ["plan title", `ALTER TABLE strategic_plans ALTER COLUMN title DROP NOT NULL`],
    ["accuracy metric", `ALTER TABLE forecast_accuracy ALTER COLUMN metric DROP NOT NULL`],
    ["business twin id", `ALTER TABLE business_twin_state DROP CONSTRAINT business_twin_state_pkey; ALTER TABLE business_twin_state ALTER COLUMN id DROP NOT NULL`],
  ] as const;
  for (const [name, mutation] of scenarios) {
    await t.test(name, async () => {
      const pool = await poolFor();
      await migrations.runApplicationMigrations(pool, { migrationsDirectory });
      await pool.query(`DELETE FROM train_efficiency_migrations WHERE migration_id='0009_forecasting_schema.sql'`);
      await pool.query(mutation);
      await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /NOT NULL|global business uniqueness/);
      assert.equal(await ledgerCount(pool), 0);
      await pool.end();
    });
  }
});

test("unexpected NOT NULL on intentionally nullable columns fails transactionally", async (t) => {
  const scenarios = [
    ["forecast numeric", `ALTER TABLE business_forecasts ALTER COLUMN current_value SET NOT NULL`],
    ["forecast jsonb", `ALTER TABLE business_forecasts ALTER COLUMN supporting_factors SET NOT NULL`],
    ["forecast timestamp", `ALTER TABLE business_forecasts ALTER COLUMN generated_at SET NOT NULL`],
    ["signal text", `ALTER TABLE risk_signals ALTER COLUMN description SET NOT NULL`],
    ["opportunity numeric", `ALTER TABLE opportunity_signals ALTER COLUMN metric_value SET NOT NULL`],
  ] as const;
  for (const [name, mutation] of scenarios) {
    await t.test(name, async () => {
      const pool = await poolFor();
      await migrations.runApplicationMigrations(pool, { migrationsDirectory });
      await pool.query(`DELETE FROM train_efficiency_migrations WHERE migration_id='0009_forecasting_schema.sql'`);
      await pool.query(mutation);
      await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /expected nullability NULLABLE, got NOT NULL/);
      assert.equal(await ledgerCount(pool), 0);
      await pool.end();
    });
  }
});

test("missing, wrong, composite, and unique-only primary keys fail transactionally", async (t) => {
  const scenarios = [
    ["missing", `ALTER TABLE risk_signals DROP CONSTRAINT risk_signals_pkey`],
    ["wrong column", `ALTER TABLE opportunity_signals DROP CONSTRAINT opportunity_signals_pkey;
      ALTER TABLE opportunity_signals ADD PRIMARY KEY (org_id)`],
    ["composite", `ALTER TABLE scenario_simulations DROP CONSTRAINT scenario_simulations_pkey;
      ALTER TABLE scenario_simulations ADD PRIMARY KEY (id,org_id)`],
    ["unique index only", `ALTER TABLE strategic_plans DROP CONSTRAINT strategic_plans_pkey;
      CREATE UNIQUE INDEX strategic_plans_id_unique ON strategic_plans(id)`],
  ] as const;
  for (const [name, mutation] of scenarios) {
    await t.test(name, async () => {
      const pool = await poolFor();
      await migrations.runApplicationMigrations(pool, { migrationsDirectory });
      await pool.query(`DELETE FROM train_efficiency_migrations WHERE migration_id='0009_forecasting_schema.sql'`);
      await pool.query(mutation);
      await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /PRIMARY KEY expected \(id\)/);
      assert.equal(await ledgerCount(pool), 0);
      await pool.end();
    });
  }
});

test("same-name wrong-order indexes cannot satisfy Forecasting readiness", async (t) => {
  for (const scenario of [
    { name: "wrong keys", columns: "status" },
    { name: "wrong order", columns: "detected_at,status,org_id" },
  ]) {
    await t.test(scenario.name, async () => {
      const pool = await poolFor();
      await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
      await createLegacyOpportunitySignals(pool, "org_id text NOT NULL");
      await pool.query(`CREATE INDEX opportunity_signals_org_status_detected ON opportunity_signals(${scenario.columns})`);
      await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /invalid index/);
      assert.equal(await ledgerCount(pool), 0);
      await pool.end();
    });
  }
});

test("same-name non-unique forecast index cannot satisfy required tenant identity", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await createLegacyBusinessForecasts(pool);
  await pool.query(`ALTER TABLE business_forecasts ADD COLUMN forecast_date date NOT NULL DEFAULT CURRENT_DATE`);
  await pool.query(`CREATE INDEX business_forecasts_tenant_day_unique
    ON business_forecasts(org_id,horizon_days,metric,forecast_date)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /invalid index/);
  assert.equal(await ledgerCount(pool), 0);
  await pool.end();
});

test("incompatible global business uniqueness fails closed", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await createLegacyOpportunitySignals(pool, "org_id text NOT NULL");
  await pool.query(`CREATE UNIQUE INDEX opportunity_signals_global_title_unique ON opportunity_signals(title)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /global business uniqueness/);
  assert.equal(await ledgerCount(pool), 0);
  await pool.end();
});

test("forecast identity is tenant scoped and permits cross-tenant reuse", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await pool.query(`INSERT INTO business_forecasts(org_id,horizon_days,metric,forecast_date) VALUES
    ('org-a',30,'revenue','2026-08-01'),('org-b',30,'revenue','2026-08-01')`);
  await assert.rejects(pool.query(`INSERT INTO business_forecasts(org_id,horizon_days,metric,forecast_date)
    VALUES('org-a',30,'revenue','2026-08-01')`), /duplicate key/);
  await pool.query(`INSERT INTO business_twin_state(org_id) VALUES('org-a'),('org-b')`);
  await assert.rejects(pool.query(`INSERT INTO business_twin_state(org_id) VALUES('org-a')`), /duplicate key/);
  await pool.end();
});

function appRecorder() {
  const uses: any[][] = [];
  const routes: Array<{ method: string; args: any[] }> = [];
  const app: any = { use: (...args: any[]) => uses.push(args) };
  for (const method of ["get", "post"]) app[method] = (...args: any[]) => routes.push({ method, args });
  return { app, uses, routes };
}

test("route registration degrades auth-first before migration and is healthy after migration", async () => {
  const recording = appRecorder();
  const { registerForecastRoutes } = await import("../forecast-routes");
  await registerForecastRoutes(recording.app);
  assert.equal(recording.uses.length, 1);
  assert.equal(recording.uses[0][0], "/api/forecast");
  const response: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json() { return this; } };
  recording.uses[0][2]({}, response);
  assert.equal(response.statusCode, 503);

  await migrations.runApplicationMigrations(admin, { migrationsDirectory });
  const ready = appRecorder();
  await registerForecastRoutes(ready.app);
  assert.equal(ready.uses.length, 0);
  assert.ok(ready.routes.some((route) => route.args[0] === "/api/forecast/dashboard"));
});

test("runtime validator detects drift without repairing it", async () => {
  await migrations.runApplicationMigrations(admin, { migrationsDirectory });
  const { validateForecastSchema } = await import("../services/forecast-engine");
  await validateForecastSchema();
  await admin.query(`ALTER TABLE business_forecasts ALTER COLUMN current_value TYPE double precision`);
  await assert.rejects(validateForecastSchema(), /business_forecasts.current_value numeric\(14,2\)/);
  assert.equal((await admin.query(`SELECT format_type(a.atttypid,a.atttypmod) AS type
    FROM pg_attribute a WHERE a.attrelid='business_forecasts'::regclass AND a.attname='current_value'`)).rows[0].type,
  "double precision");
  await admin.query(`ALTER TABLE business_forecasts ALTER COLUMN current_value TYPE numeric(14,2)`);
  await admin.query(`ALTER TABLE risk_signals ALTER COLUMN category DROP NOT NULL`);
  await assert.rejects(validateForecastSchema(), /risk_signals.category text NOT NULL/);
  assert.equal((await admin.query(`SELECT attnotnull FROM pg_attribute
    WHERE attrelid='risk_signals'::regclass AND attname='category'`)).rows[0].attnotnull, false);
  await admin.query(`ALTER TABLE risk_signals ALTER COLUMN category SET NOT NULL`);
  await admin.query(`ALTER TABLE business_forecasts ALTER COLUMN current_value SET NOT NULL`);
  await assert.rejects(validateForecastSchema(), /business_forecasts.current_value numeric\(14,2\) NULLABLE/);
  assert.equal((await admin.query(`SELECT attnotnull FROM pg_attribute
    WHERE attrelid='business_forecasts'::regclass AND attname='current_value'`)).rows[0].attnotnull, true);
  await admin.query(`ALTER TABLE business_forecasts ALTER COLUMN current_value DROP NOT NULL`);
  await admin.query(`ALTER TABLE risk_signals DROP CONSTRAINT risk_signals_pkey`);
  await assert.rejects(validateForecastSchema(), /risk_signals PRIMARY KEY\(id\)/);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM pg_constraint
    WHERE conrelid='risk_signals'::regclass AND contype='p'`)).rows[0].n, 0);
  await admin.query(`ALTER TABLE risk_signals ADD PRIMARY KEY (id)`);
  await admin.query(`DROP INDEX opportunity_signals_org_status_detected`);
  await admin.query(`CREATE INDEX opportunity_signals_org_status_detected ON opportunity_signals(status)`);
  await assert.rejects(validateForecastSchema(), /opportunity_signals INDEX\(org_id,status,detected_at\)/);
  const index = await admin.query(`SELECT indexdef FROM pg_indexes
    WHERE schemaname=current_schema() AND indexname='opportunity_signals_org_status_detected'`);
  assert.match(index.rows[0].indexdef, /\(status\)/);
  await admin.query(`DROP INDEX opportunity_signals_org_status_detected`);
  await admin.query(`CREATE UNIQUE INDEX opportunity_signals_org_status_detected
    ON opportunity_signals(org_id,status,detected_at)`);
  await assert.rejects(validateForecastSchema(), /opportunity_signals INDEX\(org_id,status,detected_at\)/);
});

test("Forecasting runtime paths contain validation only and no structural DDL", async () => {
  for (const file of ["server/forecast-routes.ts", "server/services/forecast-engine.ts"]) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.match(source, /validateForecastSchema|validateFeatureSchema/);
    assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i);
  }
});

test("opportunity_signals and schema preparation are Forecasting-owned and provider-independent", async () => {
  const migration = await readFile(new URL("../../migrations/0009_forecasting_schema.sql", import.meta.url), "utf8");
  const engine = await readFile(new URL("../services/forecast-engine.ts", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS opportunity_signals/);
  assert.match(engine, /INSERT INTO opportunity_signals/);
  assert.doesNotMatch(migration, /OpenAI|fetch\(|axios|api[_-]?key|Stripe/i);
});
