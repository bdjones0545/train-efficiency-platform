import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const adminPool = new Pool({ connectionString });
const schemas: string[] = [];
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const migrations = await import("../application-migrations");
const bootstrap = await import("../schema-bootstrap");

function newSchema(): string {
  const name = `migration_test_${randomUUID().replaceAll("-", "")}`;
  schemas.push(name);
  return name;
}

async function poolFor(schema: string): Promise<pg.Pool> {
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 10, options: `-c search_path=${schema}` });
}

async function ledger(pool: pg.Pool) {
  return (await pool.query(`SELECT migration_id,execution_kind FROM train_efficiency_migrations ORDER BY migration_id`)).rows;
}

async function populatedExistingPool(): Promise<pg.Pool> {
  const pool = await poolFor(newSchema());
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await pool.query(`DROP TABLE train_efficiency_migrations`);
  return pool;
}

async function rejectsAdoption(pool: pg.Pool, pattern: RegExp): Promise<void> {
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), pattern);
  assert.deepEqual(await ledger(pool), []);
  assert.equal(migrations.getApplicationMigrationReadiness().state, "failed");
}

after(async () => {
  for (const schema of schemas) await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await adminPool.end();
});

test("empty database reaches the complete ordered formal schema and ledger", async () => {
  const pool = await poolFor(newSchema());
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const rows = await ledger(pool);
  assert.deepEqual(rows.map((row) => row.migration_id), [
    "0000_application_baseline.sql",
    "0001_kevin_tables.sql",
    "0002_kevin_slack_tables.sql",
    "0003_kevin_intent_tables.sql",
    "0004_kevin_org_settings.sql",
    "0005_unsubscribe_token_scope.sql",
    "0006_agentmail_reply_uniqueness.sql",
    "0007_autonomous_hermes_opportunity_schema.sql",
    "0008_sponsorship_partnership_schema.sql",
    "0009_forecasting_schema.sql",
    "0010_scheduling_schema.sql",
    "0011_attendance_schema.sql",
    "0012_decision_journal_schema.sql",
    "0013_conflict_review_schema.sql",
    "0014_cross_agent_coordination_schema.sql",
  ]);
  assert.equal(rows[0].execution_kind, "executed");
  const column = await pool.query(`SELECT is_nullable FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='user_org_preferences' AND column_name='unsubscribe_token'`);
  assert.equal(column.rows[0]?.is_nullable, "YES");
  const index = await pool.query(`SELECT indexdef FROM pg_indexes
    WHERE schemaname=current_schema() AND indexname='user_org_preferences_unsubscribe_token_unique'`);
  assert.match(index.rows[0]?.indexdef ?? "", /WHERE \(unsubscribe_token IS NOT NULL\)/);
  await pool.end();
});

test("repeat migration is a checksum-verified no-op and bootstrap remains compatible", async () => {
  const pool = await poolFor(newSchema());
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const before = await ledger(pool);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.deepEqual(await ledger(pool), before);
  await bootstrap.initializeRequiredSchema(pool);
  assert.equal(bootstrap.getSchemaReadiness().state, "ready");
  await pool.end();
});

test("compatible populated database adopts baseline without rewriting rows", async () => {
  const pool = await poolFor(newSchema());
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await pool.query(`INSERT INTO organizations(id,name,slug) VALUES('existing-org','Existing','existing')`);
  await pool.query(`INSERT INTO users(id,email) VALUES('existing-user','existing@example.com')`);
  await pool.query(`INSERT INTO user_org_preferences(id,user_id,org_id)
    VALUES('existing-pref','existing-user','existing-org')`);
  await pool.query(`DROP TABLE train_efficiency_migrations`);

  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const rows = await ledger(pool);
  assert.equal(rows[0].execution_kind, "adopted");
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM user_org_preferences WHERE id='existing-pref'`)).rows[0].n, 1);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await ledger(pool)).length, 15);
  await pool.end();
});

test("incompatible populated database fails visibly and baseline is not adopted", async () => {
  const pool = await poolFor(newSchema());
  await pool.query(`CREATE TABLE users(id varchar PRIMARY KEY)`);
  await assert.rejects(
    migrations.runApplicationMigrations(pool, { migrationsDirectory }),
    /incompatible with application baseline/,
  );
  assert.equal((await ledger(pool)).length, 0);
  await pool.end();
});

test("adoption rejects a missing required primary key before writing the ledger", async () => {
  const pool = await populatedExistingPool();
  await pool.query(`ALTER TABLE organizations DROP CONSTRAINT organizations_pkey`);
  await rejectsAdoption(pool, /primary key organizations expected \(id\)/);
  await pool.end();
});

test("adoption rejects the wrong uniqueness scope before writing the ledger", async () => {
  const pool = await populatedExistingPool();
  await pool.query(`DROP INDEX user_org_prefs_unique`);
  await pool.query(`CREATE UNIQUE INDEX wrong_user_org_prefs_unique ON user_org_preferences(user_id)`);
  await rejectsAdoption(pool, /unique user_org_preferences\.user_org_prefs_unique expected \(user_id,org_id\)/);
  await pool.end();
});

test("adoption rejects a materially wrong default", async () => {
  const pool = await populatedExistingPool();
  await pool.query(`ALTER TABLE user_org_preferences ALTER COLUMN sms_opt_in SET DEFAULT true`);
  await rejectsAdoption(pool, /default user_org_preferences\.sms_opt_in expected false got true/);
  await pool.end();
});

test("adoption rejects a missing database-owned serial default", async () => {
  const pool = await populatedExistingPool();
  await pool.query(`ALTER TABLE conversations ALTER COLUMN id DROP DEFAULT`);
  await rejectsAdoption(pool, /default conversations\.id expected sequence nextval got none/);
  await pool.end();
});

test("adoption accepts a semantically equivalent rendered default", async () => {
  const pool = await populatedExistingPool();
  await pool.query(`ALTER TABLE user_org_preferences ALTER COLUMN sms_opt_in SET DEFAULT 'false'::boolean`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await ledger(pool))[0].execution_kind, "adopted");
  await pool.end();
});

test("adoption rejects a missing required foreign key", async () => {
  const pool = await populatedExistingPool();
  await pool.query(`ALTER TABLE user_org_preferences DROP CONSTRAINT user_org_preferences_user_id_users_id_fk`);
  await rejectsAdoption(pool, /foreign key user_org_preferences\.user_org_preferences_user_id_users_id_fk/);
  await pool.end();
});

test("adoption rejects a foreign key with the wrong target", async () => {
  const pool = await populatedExistingPool();
  await pool.query(`ALTER TABLE user_org_preferences DROP CONSTRAINT user_org_preferences_user_id_users_id_fk`);
  await pool.query(`ALTER TABLE user_org_preferences ADD CONSTRAINT wrong_preference_owner
    FOREIGN KEY(user_id) REFERENCES organizations(id) ON DELETE CASCADE`);
  await rejectsAdoption(pool, /foreign key user_org_preferences\.user_org_preferences_user_id_users_id_fk/);
  await pool.end();
});

test("adoption rejects a foreign key with the wrong delete action", async () => {
  const pool = await populatedExistingPool();
  await pool.query(`ALTER TABLE user_org_preferences DROP CONSTRAINT user_org_preferences_user_id_users_id_fk`);
  await pool.query(`ALTER TABLE user_org_preferences ADD CONSTRAINT wrong_preference_delete_action
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE NO ACTION`);
  await rejectsAdoption(pool, /foreign key user_org_preferences\.user_org_preferences_user_id_users_id_fk/);
  await pool.end();
});

test("adoption rejects an enum missing a required label", async () => {
  const pool = await populatedExistingPool();
  await pool.query(`ALTER TYPE agent_action_status RENAME VALUE 'failed' TO 'invalid_replacement'`);
  await rejectsAdoption(pool, /enum agent_action_status missing label failed/);
  await pool.end();
});

test("adoption permits an extra enum label while preserving required label order", async () => {
  const pool = await populatedExistingPool();
  await pool.query(`ALTER TYPE agent_action_status ADD VALUE 'future_compatible'`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await ledger(pool))[0].execution_kind, "adopted");
  await pool.end();
});

test("failed middle migration is not recorded, blocks later files, and retry converges", async () => {
  const pool = await poolFor(newSchema());
  await assert.rejects(
    migrations.runApplicationMigrations(pool, {
      migrationsDirectory,
      beforeMigration: (id) => {
        if (id === "0003_kevin_intent_tables.sql") throw new Error("injected migration failure");
      },
    }),
    /injected migration failure/,
  );
  assert.deepEqual((await ledger(pool)).map((row) => row.migration_id), [
    "0000_application_baseline.sql",
    "0001_kevin_tables.sql",
    "0002_kevin_slack_tables.sql",
  ]);
  assert.equal(migrations.getApplicationMigrationReadiness().state, "failed");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await ledger(pool)).length, 15);
  assert.equal(migrations.getApplicationMigrationReadiness().state, "ready");
  await pool.end();
});

test("three independent migrators serialize and converge on one ledger", async () => {
  const schema = newSchema();
  const pools = await Promise.all([poolFor(schema), Promise.resolve(null), Promise.resolve(null)]).then(async ([first]) => [
    first!,
    new Pool({ connectionString, max: 3, options: `-c search_path=${schema}` }),
    new Pool({ connectionString, max: 3, options: `-c search_path=${schema}` }),
  ]);
  await Promise.all(pools.map((pool) => migrations.runApplicationMigrations(pool, { migrationsDirectory })));
  const rows = await ledger(pools[0]);
  assert.equal(rows.length, 15);
  assert.equal(new Set(rows.map((row) => row.migration_id)).size, 15);
  assert.ok(rows.every((row) => row.execution_kind === "executed"));
  await Promise.all(pools.map((pool) => pool.end()));
});

test("startup orders formal migrations before bootstrap, workers, routes, and listen", async () => {
  const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");
  const migration = source.indexOf("await runApplicationMigrations()");
  const required = source.indexOf("await initializeRequiredSchema()");
  const worker = source.indexOf("await startAgentDeadLetterWorker()");
  const routes = source.indexOf("await registerRoutes(httpServer, app)");
  const listen = source.indexOf("httpServer.listen(");
  assert.ok(migration >= 0 && migration < required && required < worker && worker < routes && routes < listen);
});

test("migration readiness exposes only expected/applied identifiers and state", async () => {
  const state = migrations.getApplicationMigrationReadiness();
  assert.equal(state.state, "ready");
  assert.equal(state.latestExpected, "0014_cross_agent_coordination_schema.sql");
  assert.equal(state.latestApplied, "0014_cross_agent_coordination_schema.sql");
  assert.equal("databaseUrl" in state, false);
});
