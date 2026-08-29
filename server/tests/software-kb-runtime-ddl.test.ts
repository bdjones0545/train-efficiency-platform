import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const adminPool = new Pool({ connectionString });
const schemas: string[] = [];
const roles: string[] = [];
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const migrations = await import("../application-migrations");
const validation = await import("../software-kb-schema-validation");

async function ownerPool(): Promise<pg.Pool> {
  const schema = `software_kb_test_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  return pool;
}

async function createLegacySoftwareKbContract(pool: pg.Pool): Promise<void> {
  await pool.query(`CREATE TABLE software_kb_entries (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    org_id text NOT NULL,
    severity text NOT NULL DEFAULT 'medium',
    issue text NOT NULL,
    root_cause text NOT NULL DEFAULT '',
    fix_applied text NOT NULL DEFAULT '',
    files_modified text NOT NULL DEFAULT '',
    outcome text NOT NULL DEFAULT '',
    source text NOT NULL DEFAULT 'Manual Entry',
    source_type text NOT NULL DEFAULT 'human_admin',
    related_entity_type text DEFAULT NULL,
    related_entity_id text DEFAULT NULL,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX idx_software_kb_org_id ON software_kb_entries(org_id)`);
  await pool.query(`CREATE INDEX idx_software_kb_severity ON software_kb_entries(severity)`);
  await pool.query(`CREATE INDEX idx_software_kb_source_type ON software_kb_entries(source_type)`);
  await pool.query(`CREATE INDEX idx_software_kb_created_at ON software_kb_entries(created_at DESC)`);
}

after(async () => {
  for (const schema of schemas) await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  for (const role of roles) await adminPool.query(`DROP ROLE IF EXISTS "${role}"`);
  await adminPool.end();
});

test("production-reachable Software KB source contains no structural SQL", async () => {
  const service = await readFile(new URL("../services/software-kb-service.ts", import.meta.url), "utf8");
  const validator = await readFile(new URL("../software-kb-schema-validation.ts", import.meta.url), "utf8");
  const routes = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX)\b/i);
  assert.doesNotMatch(validator, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX)\b/i);
  assert.match(routes, /await seedHistoricalFixes\("default"\)/);
  assert.match(service, /await validateSoftwareKbSchema\(\)/);
});

test("fully migrated Release 1 schema classifies optional Software KB unavailable without repair", async () => {
  const pool = await ownerPool();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      validation.validateSoftwareKbSchema(drizzle(pool)),
      validation.SoftwareKbSchemaUnavailableError,
    );
  }
  const relation = await pool.query(`SELECT to_regclass('software_kb_entries') relation`);
  assert.equal(relation.rows[0].relation, null);
  await pool.end();
});

test("healthy legacy contract validates under a DDL-restricted runtime role", async () => {
  const pool = await ownerPool();
  await createLegacySoftwareKbContract(pool);
  const schema = (await pool.query(`SELECT current_schema() schema`)).rows[0].schema;
  const role = `software_kb_runtime_${randomUUID().replaceAll("-", "")}`;
  roles.push(role);
  await adminPool.query(`CREATE ROLE "${role}" LOGIN`);
  await adminPool.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
  await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`);
  assert.equal((await adminPool.query(
    `SELECT has_schema_privilege($1,$2,'CREATE') allowed`, [role, schema],
  )).rows[0].allowed, false);
  const runtime = new Pool({ connectionString, user: role, options: `-c search_path=${schema}` });
  await validation.validateSoftwareKbSchema(drizzle(runtime));
  await runtime.end();
  await pool.end();
});

test("drift is detected repeatedly and never repaired", async () => {
  const pool = await ownerPool();
  await createLegacySoftwareKbContract(pool);
  await pool.query(`DROP INDEX idx_software_kb_severity`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      validation.validateSoftwareKbSchema(drizzle(pool)),
      (error: unknown) => error instanceof validation.SoftwareKbSchemaUnavailableError
        && error.problems.some(problem => problem.includes("severity")),
    );
  }
  assert.equal((await pool.query(
    `SELECT to_regclass('idx_software_kb_severity') relation`,
  )).rows[0].relation, null);
  await pool.end();
});

test("schema-unavailable and ordinary database failures remain distinguishable", () => {
  let status = 0;
  let body: unknown;
  const response = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as any;
  assert.equal(validation.sendSoftwareKbUnavailable(
    new validation.SoftwareKbSchemaUnavailableError(["private catalog detail"]), response,
  ), true);
  assert.equal(status, 503);
  assert.deepEqual(body, { message: "Software KB unavailable" });
  assert.equal(JSON.stringify(body).includes("private catalog detail"), false);
  assert.equal(validation.sendSoftwareKbUnavailable(new Error("connection lost"), response), false);
});
