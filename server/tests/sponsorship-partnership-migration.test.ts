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
const legacyDirectory = await mkdtemp(join(tmpdir(), "department-os-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter((name) => /^000[0-7]_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}
const migrations = await import("../application-migrations");

async function poolFor(): Promise<pg.Pool> {
  const schema = `department_os_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}

async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int AS n FROM train_efficiency_migrations
    WHERE migration_id='0008_sponsorship_partnership_schema.sql'`)).rows[0].n;
}

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("fresh migration owns all sponsorship and partnership durable tables", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  for (const prefix of ["sponsorship", "partnership"]) {
    for (const suffix of [
      "opportunities", "assessments", "outreach_drafts", "relationships",
      "learning_signals", "executive_briefs", "recommendations",
    ]) {
      const table = `${prefix}_${suffix}`;
      assert.equal((await pool.query(`SELECT to_regclass($1) AS relation`, [table])).rows[0].relation, table);
    }
  }
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("repeated and concurrent migration execution records 0008 exactly once", async () => {
  const pool = await poolFor();
  await Promise.all([
    migrations.runApplicationMigrations(pool, { migrationsDirectory }),
    migrations.runApplicationMigrations(pool, { migrationsDirectory }),
  ]);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("incompatible existing optional schema fails closed and rolls back 0008", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE sponsorship_opportunities(id uuid PRIMARY KEY, org_id text NOT NULL)`);
  await assert.rejects(
    migrations.runApplicationMigrations(pool, { migrationsDirectory }),
    /missing sponsorship_opportunities\.organization_name/,
  );
  assert.equal(await ledgerCount(pool), 0);
  assert.equal((await pool.query(`SELECT to_regclass('partnership_opportunities') AS relation`)).rows[0].relation, null);
  await pool.end();
});

test("partially present Partnership schema fails closed without ledger advancement", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE partnership_opportunities(
    id uuid PRIMARY KEY, org_id text NOT NULL, organization_name text NOT NULL,
    created_at timestamptz, updated_at timestamptz)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /partnership_opportunities\.status/);
  assert.equal(await ledgerCount(pool), 0);
  await pool.end();
});

test("missing, nullable, and incorrectly typed tenant identity each fail closed", async (t) => {
  for (const scenario of [
    { name: "missing", definition: "" },
    { name: "nullable", definition: "org_id text," },
    { name: "wrong type", definition: "org_id uuid NOT NULL," },
  ]) {
    await t.test(scenario.name, async () => {
      const pool = await poolFor();
      await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
      await pool.query(`CREATE TABLE partnership_opportunities(
        id uuid PRIMARY KEY, ${scenario.definition} organization_name text NOT NULL,
        status text, created_at timestamptz, updated_at timestamptz)`);
      await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /org_id/);
      assert.equal(await ledgerCount(pool), 0);
      await pool.end();
    });
  }
});

test("conflicting same-name tenant index cannot falsely satisfy migration readiness", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE sponsorship_opportunities(
    id uuid PRIMARY KEY, org_id text NOT NULL, organization_name text NOT NULL,
    status text, created_at timestamptz, updated_at timestamptz)`);
  await pool.query(`CREATE INDEX sponsorship_opportunities_org_created ON sponsorship_opportunities(status)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /invalid tenant index/);
  assert.equal(await ledgerCount(pool), 0);
  assert.equal((await pool.query(`SELECT to_regclass('partnership_opportunities') AS relation`)).rows[0].relation, null);
  await pool.end();
});

test("tenant identity is non-null across every migration-owned table", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const nullable = await pool.query(`SELECT table_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND column_name='org_id'
      AND table_name LIKE ANY(ARRAY['sponsorship_%','partnership_%']) AND is_nullable <> 'NO'`);
  assert.deepEqual(nullable.rows, []);
  await assert.rejects(
    pool.query(`INSERT INTO partnership_opportunities(org_id,organization_name) VALUES(NULL,'invalid')`),
    /null value/,
  );
  await pool.end();
});

function appRecorder() {
  const uses: any[][] = [];
  const routes: Array<{ method: string; args: any[] }> = [];
  const app: any = { use: (...args: any[]) => uses.push(args) };
  for (const method of ["get", "post", "patch", "delete"]) {
    app[method] = (...args: any[]) => routes.push({ method, args });
  }
  return { app, uses, routes };
}

test("route registration before migration installs authenticated 503 guards; migrated schema does not", async () => {
  const auth = (_req: unknown, _res: unknown, next: () => void) => next();
  const role = () => auth;
  const missingSponsorship = appRecorder();
  const missingPartnership = appRecorder();
  const { registerSponsorshipRoutes } = await import("../sponsorship-routes");
  const { registerPartnershipRoutes } = await import("../partnership-routes");
  await registerSponsorshipRoutes(missingSponsorship.app, auth, role);
  await registerPartnershipRoutes(missingPartnership.app, auth, role);
  for (const recording of [missingSponsorship, missingPartnership]) {
    assert.equal(recording.uses.length, 1);
    assert.equal(recording.uses[0][1], auth);
    const response: any = { statusCode: 200, body: null,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; } };
    recording.uses[0][2]({}, response);
    assert.equal(response.statusCode, 503);
    assert.ok(recording.routes.length > 0);
  }

  await migrations.runApplicationMigrations(admin, { migrationsDirectory });
  const readySponsorship = appRecorder();
  const readyPartnership = appRecorder();
  await registerSponsorshipRoutes(readySponsorship.app, auth, role);
  await registerPartnershipRoutes(readyPartnership.app, auth, role);
  assert.equal(readySponsorship.uses.length, 0);
  assert.equal(readyPartnership.uses.length, 0);
  assert.ok(readySponsorship.routes.some((route) => route.method === "get" && route.args[0] === "/api/sponsorships"));
  assert.ok(readyPartnership.routes.some((route) => route.method === "get" && route.args[0] === "/api/partnerships"));
});

test("runtime validators accept migrated schema and reject missing schema without repair", async () => {
  await migrations.runApplicationMigrations(admin, { migrationsDirectory });
  const { validateFeatureSchema } = await import("../feature-schema-validation");
  await validateFeatureSchema("sponsorship");
  await validateFeatureSchema("partnership");
  await admin.query(`DROP INDEX sponsorship_opportunities_org_created`);
  await admin.query(`CREATE INDEX sponsorship_opportunities_org_created ON sponsorship_opportunities(status)`);
  await assert.rejects(validateFeatureSchema("sponsorship"), /sponsorship_opportunities INDEX\(org_id,created_at\)/);
  const wrongIndex = await admin.query(`SELECT indexdef FROM pg_indexes
    WHERE schemaname=current_schema() AND indexname='sponsorship_opportunities_org_created'`);
  assert.match(wrongIndex.rows[0].indexdef, /\(status\)/);
  await admin.query(`DROP TABLE partnership_recommendations`);
  await assert.rejects(validateFeatureSchema("partnership"), /partnership_recommendations/);
  assert.equal((await admin.query(`SELECT to_regclass('partnership_recommendations') AS relation`)).rows[0].relation, null);
});

test("route registration contains validation and no structural DDL", async () => {
  for (const file of ["sponsorship-routes.ts", "partnership-routes.ts"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /validateFeatureSchema/);
    assert.match(source, /status\(503\)/);
    assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i);
  }
});

test("formal schema preparation is provider-independent", async () => {
  const source = await readFile(new URL("../../migrations/0008_sponsorship_partnership_schema.sql", import.meta.url), "utf8");
  assert.doesNotMatch(source, /OpenAI|fetch\(|axios|api[_-]?key|Stripe/i);
  assert.match(source, /sponsorship_opportunities/);
  assert.match(source, /partnership_opportunities/);
});
