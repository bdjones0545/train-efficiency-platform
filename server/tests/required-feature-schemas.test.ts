import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const admin = new Pool({ connectionString });
const schemas: string[] = [];
const migrations = await import("../application-migrations");
const bootstrap = await import("../schema-bootstrap");
const features = await import("../required-feature-schemas");
const readiness = await import("../required-feature-readiness-state");

function schemaName(): string {
  const name = `required_features_${randomUUID().replaceAll("-", "")}`;
  schemas.push(name);
  return name;
}

async function poolFor(schema: string): Promise<pg.Pool> {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}

async function preparedPool(): Promise<pg.Pool> {
  const pool = await poolFor(schemaName());
  await migrations.runApplicationMigrations(pool);
  await bootstrap.initializeRequiredSchema(pool);
  return pool;
}

async function readyPool(): Promise<pg.Pool> {
  const pool = await preparedPool();
  await features.initializeRequiredFeatureSchemas(pool);
  return pool;
}

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

test("required subsystem inventory is explicit and stable", () => {
  assert.deepEqual([...features.REQUIRED_FEATURE_SUBSYSTEMS], [
    "workflow", "agent_dead_letter", "provider_circuit_breaker", "follow_up_reliability", "scheduler_locks",
  ]);
});

test("clean initialization reaches ready with every subsystem ready", async () => {
  const pool = await preparedPool();
  await features.initializeRequiredFeatureSchemas(pool);
  const state = features.getRequiredFeatureSchemaReadiness();
  assert.equal(state.state, "ready");
  assert.ok(Object.values(state.subsystems).every((value) => value === "ready"));
  await features.validateRequiredFeatureSchemas(pool as any);
  await pool.end();
});

test("repeated initialization is safe", async () => {
  const pool = await preparedPool();
  await features.initializeRequiredFeatureSchemas(pool);
  await features.initializeRequiredFeatureSchemas(pool);
  assert.equal(features.getRequiredFeatureSchemaReadiness().state, "ready");
  await pool.end();
});

test("missing additive feature objects and columns are repaired before readiness", async () => {
  const pool = await readyPool();
  await pool.query(`DROP TABLE workflow_job_effects`);
  await pool.query(`DROP TABLE follow_up_send_effects`);
  await pool.query(`DROP TABLE provider_circuit_breakers`);
  await pool.query(`ALTER TABLE agent_dead_letter_queue DROP COLUMN locked_by`);
  await features.initializeRequiredFeatureSchemas(pool);
  await features.validateRequiredFeatureSchemas(pool as any);
  assert.equal(features.getRequiredFeatureSchemaReadiness().state, "ready");
  await pool.end();
});

test("incompatible partial workflow schema fails closed", async () => {
  const pool = await preparedPool();
  await pool.query(`ALTER TABLE workflow_jobs ALTER COLUMN execution_generation DROP NOT NULL`);
  await assert.rejects(features.initializeRequiredFeatureSchemas(pool), /nullable workflow_jobs\.execution_generation/);
  assert.equal(features.getRequiredFeatureSchemaReadiness().state, "failed");
  await pool.end();
});

test("incorrect workflow uniqueness scope fails closed", async () => {
  const pool = await preparedPool();
  await pool.query(`DROP INDEX workflow_jobs_org_idempotency_key_unique`);
  await pool.query(`CREATE UNIQUE INDEX workflow_jobs_org_idempotency_key_unique ON workflow_jobs(idempotency_key)`);
  await assert.rejects(features.initializeRequiredFeatureSchemas(pool), /unique index workflow_jobs\(org_id,idempotency_key\)/);
  assert.equal(features.getRequiredFeatureSchemaReadiness().state, "failed");
  await pool.end();
});

test("incompatible dead-letter schema fails closed", async () => {
  const pool = await readyPool();
  await pool.query(`ALTER TABLE agent_dead_letter_queue ALTER COLUMN execution_generation DROP NOT NULL`);
  await assert.rejects(features.initializeRequiredFeatureSchemas(pool), /nullable agent_dead_letter_queue\.execution_generation/);
  assert.equal(features.getRequiredFeatureSchemaReadiness().state, "failed");
  await pool.end();
});

test("incompatible breaker schema fails closed", async () => {
  const pool = await readyPool();
  await pool.query(`ALTER TABLE provider_circuit_breakers ALTER COLUMN state DROP NOT NULL`);
  await assert.rejects(features.initializeRequiredFeatureSchemas(pool), /nullable provider_circuit_breakers\.state/);
  assert.equal(features.getRequiredFeatureSchemaReadiness().state, "failed");
  await pool.end();
});

test("three concurrent initializers serialize and converge", async () => {
  const schema = schemaName();
  const first = await poolFor(schema);
  await migrations.runApplicationMigrations(first);
  await bootstrap.initializeRequiredSchema(first);
  const pools = [first,
    new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` }),
    new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` })];
  await Promise.all(pools.map((pool) => features.initializeRequiredFeatureSchemas(pool)));
  await features.validateRequiredFeatureSchemas(first as any);
  assert.equal(features.getRequiredFeatureSchemaReadiness().state, "ready");
  await Promise.all(pools.map((pool) => pool.end()));
});

for (const failedSubsystem of ["workflow", "agent_dead_letter", "follow_up_reliability"] as const) {
  test(`${failedSubsystem} failure blocks readiness and dependent startup`, async () => {
    const pool = await preparedPool();
    let workerStarts = 0;
    await assert.rejects((async () => {
      await features.initializeRequiredFeatureSchemas(pool, {
        beforeSubsystem: (name) => { if (name === failedSubsystem) throw new Error(`injected ${name}`); },
      });
      workerStarts++;
    })(), new RegExp(`injected ${failedSubsystem}`));
    assert.equal(workerStarts, 0);
    assert.equal(readiness.getRequiredFeatureSchemaReadiness().state, "failed");
    await pool.end();
  });
}

test("retry after a deterministic initialization failure succeeds", async () => {
  const pool = await preparedPool();
  await assert.rejects(features.initializeRequiredFeatureSchemas(pool, {
    beforeSubsystem: (name) => { if (name === "workflow") throw new Error("one shot"); },
  }), /one shot/);
  await features.initializeRequiredFeatureSchemas(pool);
  assert.equal(features.getRequiredFeatureSchemaReadiness().state, "ready");
  await pool.end();
});

test("startup and health source gate workers, routes, and listen on feature readiness", async () => {
  const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");
  const reliabilitySource = await readFile(new URL("../reliability-routes.ts", import.meta.url), "utf8");
  const migration = source.indexOf("await verifyApplicationMigrationReadiness()");
  const core = source.indexOf("await verifyRequiredSchemaReadiness()");
  const feature = source.indexOf("await verifyRequiredFeatureSchemaReadiness()");
  const deadLetter = source.indexOf("await startAgentDeadLetterWorker()");
  const workflow = source.indexOf("startWorkflowJobRunner()");
  const routes = source.indexOf("await registerRoutes(httpServer, app)");
  const listen = source.indexOf("httpServer.listen(");
  assert.ok(migration >= 0 && migration < core && core < feature && feature < deadLetter && deadLetter < workflow && workflow < routes && routes < listen);
  assert.match(reliabilitySource, /featureSchema\.state === "ready"/);
  assert.match(reliabilitySource, /requiredFeatureSchema: featureSchema\.state/);
});

test("required lazy schema guards defer to the coordinator after readiness", async () => {
  const files = [
    "../workflow-job-queue.ts",
    "../services/agent-dead-letter-service.ts",
    "../services/retry-reliability.ts",
    "../email-agent/follow-up-reliability.ts",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /isRequiredFeatureSchemaReady\(\)/, file);
  }
});
