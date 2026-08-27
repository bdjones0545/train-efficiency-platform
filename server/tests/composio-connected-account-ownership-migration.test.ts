import assert from "node:assert/strict";
import test, { after } from "node:test";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
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
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const legacyDirectory = await mkdtemp(join(tmpdir(), "composio-ownership-legacy-"));
for (const file of (await readdir(migrationsDirectory)).filter(name => /^00(?:0\d|1[0-5])_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}
const migrations = await import("../application-migrations");
const validation = await import("../composio-connected-account-schema-validation");

async function poolFor(prefix: string): Promise<pg.Pool> {
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 12, options: `-c search_path=${schema}` });
}

async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations
    WHERE migration_id='0016_composio_connected_account_ownership.sql'`)).rows[0].n;
}

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("fresh, repeat, and three concurrent migrators converge on one 0016 ledger row", async () => {
  const pool = await poolFor("composio_fresh");
  await Promise.all([1, 2, 3].map(() => migrations.runApplicationMigrations(pool, { migrationsDirectory })));
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await validation.validateComposioConnectionSchema(drizzle(pool));
  await pool.end();
});

test("incompatible legacy ownership rolls back 0016 and explicit repair permits retry", async () => {
  const pool = await poolFor("composio_retry");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE composio_connected_account_ownership(connected_account_id integer PRIMARY KEY)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /column "active" does not exist|contract mismatch/);
  assert.equal(await ledgerCount(pool), 0);
  assert.equal((await pool.query(`SELECT to_regclass('composio_platform_account_authorizations') value`)).rows[0].value, null);
  await pool.query(`DROP TABLE composio_connected_account_ownership`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("database enforces ownership classes, canonical toolkits, tenant identity, and global account identity", async () => {
  const pool = await poolFor("composio_contract");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await pool.query(`INSERT INTO organizations(id,name,slug) VALUES('org-a','A','org-a'),('org-b','B','org-b')`);
  await assert.rejects(pool.query(`INSERT INTO composio_connected_account_ownership(connected_account_id,toolkit,ownership_class,org_id) VALUES('bad-tool','GMAIL','organization','org-a')`));
  await assert.rejects(pool.query(`INSERT INTO composio_connected_account_ownership(connected_account_id,toolkit,ownership_class,org_id) VALUES('blank-org','gmail','organization','')`));
  await assert.rejects(pool.query(`INSERT INTO composio_connected_account_ownership(connected_account_id,toolkit,ownership_class,org_id) VALUES('missing-org','gmail','organization','unknown')`));
  await assert.rejects(pool.query(`INSERT INTO composio_connected_account_ownership(connected_account_id,toolkit,ownership_class,org_id) VALUES('platform-org','gmail','platform','org-a')`));
  await assert.rejects(pool.query(`INSERT INTO composio_connected_account_ownership(connected_account_id,toolkit,ownership_class) VALUES('invalid-class','gmail','unowned')`));
  await pool.query(`INSERT INTO composio_connected_account_ownership(connected_account_id,toolkit,ownership_class,org_id) VALUES('account-1','gmail','organization','org-a')`);
  await assert.rejects(pool.query(`INSERT INTO composio_connected_account_ownership(connected_account_id,toolkit,ownership_class,org_id) VALUES('account-1','gmail','organization','org-b')`));
  await pool.end();
});

test("multiple organization accounts per toolkit remain valid and no accidental uniqueness exists", async () => {
  const pool = await poolFor("composio_multiple");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await pool.query(`INSERT INTO organizations(id,name,slug) VALUES('org-a','A','org-a')`);
  await pool.query(`INSERT INTO composio_connected_account_ownership(connected_account_id,toolkit,ownership_class,org_id)
    VALUES('account-1','gmail','organization','org-a'),('account-2','gmail','organization','org-a')`);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM composio_connected_account_ownership WHERE org_id='org-a' AND toolkit='gmail'`)).rows[0].n, 2);
  await pool.end();
});

test("platform ownership grants no tenant access without explicit organization authorization", async () => {
  const pool = await poolFor("composio_platform");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  await pool.query(`INSERT INTO organizations(id,name,slug) VALUES('org-a','A','org-a'),('org-b','B','org-b')`);
  await pool.query(`INSERT INTO composio_connected_account_ownership(connected_account_id,toolkit,ownership_class) VALUES('platform-1','slack','platform')`);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM composio_platform_account_authorizations WHERE org_id='org-a'`)).rows[0].n, 0);
  await pool.query(`INSERT INTO composio_platform_account_authorizations(org_id,connected_account_id) VALUES('org-a','platform-1')`);
  assert.deepEqual((await pool.query(`SELECT org_id,connected_account_id,active FROM composio_platform_account_authorizations`)).rows, [{ org_id: "org-a", connected_account_id: "platform-1", active: true }]);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM composio_platform_account_authorizations WHERE org_id='org-b'`)).rows[0].n, 0);
  await pool.end();
});

test("runtime validator detects structural drift and performs no repair", async t => {
  const pool = await poolFor("composio_drift");
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const executor = drizzle(pool);
  const mutations = [
    ["missing ownership table", `DROP TABLE composio_connected_account_ownership CASCADE`],
    ["missing platform authorization table", `DROP TABLE composio_platform_account_authorizations`],
    ["missing org_id", `ALTER TABLE composio_connected_account_ownership DROP COLUMN org_id CASCADE`],
    ["wrong org_id type", `ALTER TABLE composio_connected_account_ownership ALTER COLUMN org_id TYPE text`],
    ["nullable platform tenant", `ALTER TABLE composio_platform_account_authorizations DROP CONSTRAINT composio_platform_account_authorizations_pkey; ALTER TABLE composio_platform_account_authorizations ALTER COLUMN org_id DROP NOT NULL`],
    ["wrong toolkit type", `ALTER TABLE composio_connected_account_ownership ALTER COLUMN toolkit TYPE varchar`],
    ["wrong account type", `ALTER TABLE composio_platform_account_authorizations DROP CONSTRAINT composio_platform_account_authorizations_account_fk; ALTER TABLE composio_platform_account_authorizations ALTER COLUMN connected_account_id TYPE varchar; ALTER TABLE composio_connected_account_ownership ALTER COLUMN connected_account_id TYPE varchar`],
    ["nullable account identity", `ALTER TABLE composio_platform_account_authorizations DROP CONSTRAINT composio_platform_account_authorizations_account_fk; ALTER TABLE composio_connected_account_ownership DROP CONSTRAINT composio_connected_account_ownership_pkey; ALTER TABLE composio_connected_account_ownership ALTER COLUMN connected_account_id DROP NOT NULL`],
    ["wrong active default", `ALTER TABLE composio_connected_account_ownership ALTER COLUMN active SET DEFAULT false`],
    ["missing primary key", `ALTER TABLE composio_platform_account_authorizations DROP CONSTRAINT composio_platform_account_authorizations_account_fk; ALTER TABLE composio_connected_account_ownership DROP CONSTRAINT composio_connected_account_ownership_pkey`],
    ["wrong composite primary key", `ALTER TABLE composio_platform_account_authorizations DROP CONSTRAINT composio_platform_account_authorizations_account_fk; ALTER TABLE composio_connected_account_ownership DROP CONSTRAINT composio_connected_account_ownership_pkey; ALTER TABLE composio_connected_account_ownership ADD PRIMARY KEY(connected_account_id,toolkit)`],
    ["missing contract check", `ALTER TABLE composio_connected_account_ownership DROP CONSTRAINT composio_connected_account_ownership_contract_check`],
    ["broken platform relationship", `ALTER TABLE composio_platform_account_authorizations DROP CONSTRAINT composio_platform_account_authorizations_account_fk`],
    ["malformed same-name index", `DROP INDEX composio_connected_account_ownership_org_toolkit_idx; CREATE INDEX composio_connected_account_ownership_org_toolkit_idx ON composio_connected_account_ownership(toolkit,org_id) WHERE active`],
    ["extra expression index key", `DROP INDEX composio_connected_account_ownership_org_toolkit_idx; CREATE INDEX composio_connected_account_ownership_org_toolkit_idx ON composio_connected_account_ownership(org_id,toolkit,(1)) WHERE active AND ownership_class='organization'`],
    ["extra included index key", `DROP INDEX composio_connected_account_ownership_org_toolkit_idx; CREATE INDEX composio_connected_account_ownership_org_toolkit_idx ON composio_connected_account_ownership(org_id,toolkit) INCLUDE(active) WHERE active AND ownership_class='organization'`],
    ["wrong index predicate", `DROP INDEX composio_connected_account_ownership_org_toolkit_idx; CREATE INDEX composio_connected_account_ownership_org_toolkit_idx ON composio_connected_account_ownership(org_id,toolkit) WHERE active`],
    ["overrestricted index predicate", `DROP INDEX composio_connected_account_ownership_org_toolkit_idx; CREATE INDEX composio_connected_account_ownership_org_toolkit_idx ON composio_connected_account_ownership(org_id,toolkit) WHERE active AND ownership_class='organization' AND false`],
    ["weakened same-name ownership check", `ALTER TABLE composio_connected_account_ownership DROP CONSTRAINT composio_connected_account_ownership_contract_check; ALTER TABLE composio_connected_account_ownership ADD CONSTRAINT composio_connected_account_ownership_contract_check CHECK (btrim(connected_account_id)<>'' AND toolkit IN ('gmail','googlecalendar','slack','googlesheets','github','stripe') AND ownership_class IN ('organization','platform') AND (((ownership_class='organization' AND org_id IS NOT NULL AND btrim(org_id)<>'') OR (ownership_class='platform' AND org_id IS NULL)) OR true))`],
    ["unexpected optional-column default", `ALTER TABLE composio_connected_account_ownership ALTER COLUMN authorized_by SET DEFAULT 'system'`],
    ["accidental unique org toolkit", `CREATE UNIQUE INDEX accidental_org_toolkit ON composio_connected_account_ownership(org_id,toolkit)`],
  ] as const;
  for (const [name, mutation] of mutations) await t.test(name, async () => {
    await pool.query("BEGIN");
    await pool.query(mutation);
    await assert.rejects(validation.validateComposioConnectionSchema(executor), validation.ComposioConnectionSchemaUnavailableError);
    await pool.query("ROLLBACK");
  });
  await pool.end();
});

test("first use on an empty schema fails closed and performs no DDL repair", async () => {
  const pool = await poolFor("composio_empty");
  await assert.rejects(validation.validateComposioConnectionSchema(drizzle(pool)), validation.ComposioConnectionSchemaUnavailableError);
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()
    AND table_name LIKE 'composio_%'`);
  assert.deepEqual(tables.rows, []);
  await pool.end();
});
