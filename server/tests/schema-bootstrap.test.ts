import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const schemaName = "schema_bootstrap_test";
const adminPool = new Pool({ connectionString });
const testPool = new Pool({ connectionString, max: 10, options: `-c search_path=${schemaName}` });
const { getSchemaReadiness, initializeRequiredSchema, validateRequiredSchema } = await import("../schema-bootstrap");

const tables = ["system_alerts", "health_check_results", "query_failures", "client_errors", "system_logs", "train_efficiency_schema_bootstrap"];
async function resetSchema() {
  await testPool.query(`DROP TABLE IF EXISTS ${tables.join(", ")} CASCADE`);
}

before(async () => {
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await adminPool.query(`CREATE SCHEMA ${schemaName}`);
});
after(async () => {
  await testPool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await adminPool.end();
});

test("fresh startup creates and validates required schema", async () => {
  await initializeRequiredSchema(testPool);
  assert.equal(getSchemaReadiness().state, "ready");
  await validateRequiredSchema(testPool);
  const marker = await testPool.query("SELECT bootstrap_version FROM train_efficiency_schema_bootstrap");
  assert.deepEqual(marker.rows.map((row) => row.bootstrap_version), ["2026-08-22.1"]);
});

test("repeated startup is idempotent", async () => {
  await initializeRequiredSchema(testPool);
  await initializeRequiredSchema(testPool);
  assert.equal(getSchemaReadiness().state, "ready");
});

test("three concurrent startup initializers serialize and all succeed", async () => {
  await resetSchema();
  await Promise.all([
    initializeRequiredSchema(testPool),
    initializeRequiredSchema(testPool),
    initializeRequiredSchema(testPool),
  ]);
  await validateRequiredSchema(testPool);
  assert.equal(getSchemaReadiness().state, "ready");
});

test("DDL and fault hook stay on the advisory-locked transaction connection", async () => {
  await resetSchema();
  const backendPids = new Set<number>();
  await initializeRequiredSchema(testPool, {
    beforeStatement: async (_category, executor) => {
      const result = await executor.query("SELECT pg_backend_pid() AS pid");
      backendPids.add(result.rows[0].pid);
    },
  });
  assert.equal(backendPids.size, 1);
});

test("required DDL failure propagates, blocks readiness, and a retry succeeds", async () => {
  await resetSchema();
  await assert.rejects(
    initializeRequiredSchema(testPool, {
      beforeStatement: (category) => {
        if (category === "query_failures table") throw new Error("injected required DDL failure");
      },
    }),
    /injected required DDL failure/,
  );
  assert.equal(getSchemaReadiness().state, "failed");
  const rolledBack = await testPool.query("SELECT to_regclass('system_logs') AS table_name");
  assert.equal(rolledBack.rows[0].table_name, null);

  await initializeRequiredSchema(testPool);
  assert.equal(getSchemaReadiness().state, "ready");
  await validateRequiredSchema(testPool);
});

test("partial critical schema is detected non-destructively", async () => {
  await resetSchema();
  await testPool.query("CREATE TABLE system_logs (id UUID PRIMARY KEY)");
  await assert.rejects(validateRequiredSchema(testPool), /Required schema is incomplete.*system_logs\.created_at/);
  const stillPresent = await testPool.query("SELECT to_regclass('system_logs') AS table_name");
  assert.equal(stillPresent.rows[0].table_name, "system_logs");
});

test("current-main startup awaits required schema before seeds, routes, jobs, and listen", async () => {
  const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");
  const bootstrap = source.indexOf("await initializeRequiredSchema()");
  assert.ok(bootstrap > 0);
  for (const marker of ["await seedDatabase()", "await registerRoutes(httpServer, app)", "setInterval(", "httpServer.listen("]) {
    assert.ok(source.indexOf(marker) > bootstrap, `${marker} must remain after required schema bootstrap`);
  }
  assert.match(source, /process\.once\("SIGTERM"/);
  assert.match(source, /process\.once\("SIGINT"/);
});

test("reliability routes preserve current probe behavior and contain no lazy table DDL", async () => {
  const source = await readFile(new URL("../reliability-routes.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CREATE TABLE IF NOT EXISTS (?:system_logs|client_errors|query_failures|health_check_results|system_alerts)/);
  assert.match(source, /getSchemaReadiness\(\)/);
  assert.match(source, /dbStatus === "ok" && schema\.state === "ready"/);
  assert.match(source, /httpProbe\("http_open_sessions", "\/api\/sessions\/open"/);
});
