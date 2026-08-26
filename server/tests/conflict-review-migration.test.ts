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
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const legacyDirectory = await mkdtemp(join(tmpdir(), "conflict-review-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter(name => /^(?:000\d|001[0-2])_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}
const migrations = await import("../application-migrations");
let applicationPool: pg.Pool | undefined;

async function poolFor(): Promise<pg.Pool> {
  const schema = `conflict_review_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}

async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations
    WHERE migration_id='0013_conflict_review_schema.sql'`)).rows[0].n;
}

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await applicationPool?.end();
  await admin.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("fresh, repeated, and three concurrent migrators formally own Conflict Review", async () => {
  const pool = await poolFor();
  await Promise.all([1, 2, 3].map(() => migrations.runApplicationMigrations(pool, { migrationsDirectory })));
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await pool.query(`SELECT to_regclass('conflict_alerts') relation`)).rows[0].relation, "conflict_alerts");
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("compatible legacy structure and ambiguous tenant rows are preserved without legitimization", async () => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE conflict_alerts (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id text NOT NULL, conflict_type text NOT NULL,
    severity text NOT NULL DEFAULT 'medium', entities text[] DEFAULT ARRAY[]::text[], agent_actions jsonb DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'open', resolution text, resolved_by text, resolved_at timestamptz,
    created_at timestamptz DEFAULT now()
  ); INSERT INTO conflict_alerts(org_id,conflict_type) VALUES('default','legacy'),('','legacy-blank');`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await pool.query(`SELECT count(*)::int n FROM conflict_alerts WHERE org_id IN ('default','')`)).rows[0].n, 2);
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("incompatible legacy contracts roll back and repair can retry", async (t) => {
  for (const [name, setup] of [
    ["partial table", `CREATE TABLE conflict_alerts(id text PRIMARY KEY)`],
    ["wrong tenant type", `CREATE TABLE conflict_alerts(id text PRIMARY KEY,org_id varchar NOT NULL)`],
  ] as const) await t.test(name, async () => {
    const pool = await poolFor();
    await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
    await pool.query(setup);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }));
    assert.equal(await ledgerCount(pool), 0);
    await pool.end();
  });

  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`CREATE TABLE conflict_alerts(id text PRIMARY KEY)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }));
  assert.equal(await ledgerCount(pool), 0);
  await pool.query(`DROP TABLE conflict_alerts`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("runtime validator rejects column, default, PK, and index drift without repair", async (t) => {
  const pool = await poolFor();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  const validation = await import("../conflict-review-schema-validation");
  const executor = drizzle(pool);
  await validation.validateConflictReviewSchema(executor);
  const mutations = [
    ["missing table", `DROP TABLE conflict_alerts`],
    ["missing column", `ALTER TABLE conflict_alerts DROP COLUMN resolution`],
    ["wrong org type", `ALTER TABLE conflict_alerts ALTER COLUMN org_id TYPE varchar`],
    ["wrong non-tenant type", `ALTER TABLE conflict_alerts ALTER COLUMN severity TYPE varchar`],
    ["required nullable", `ALTER TABLE conflict_alerts ALTER COLUMN conflict_type DROP NOT NULL`],
    ["optional not null", `ALTER TABLE conflict_alerts ALTER COLUMN resolved_by SET NOT NULL`],
    ["wrong default", `ALTER TABLE conflict_alerts ALTER COLUMN status SET DEFAULT 'pending'`],
    ["missing default", `ALTER TABLE conflict_alerts ALTER COLUMN severity DROP DEFAULT`],
    ["unexpected default", `ALTER TABLE conflict_alerts ALTER COLUMN org_id SET DEFAULT current_user`],
    ["missing PK", `ALTER TABLE conflict_alerts DROP CONSTRAINT conflict_alerts_pkey`],
    ["wrong composite PK", `ALTER TABLE conflict_alerts DROP CONSTRAINT conflict_alerts_pkey; ALTER TABLE conflict_alerts ADD PRIMARY KEY(org_id,id)`],
    ["unique substitutes for PK", `ALTER TABLE conflict_alerts DROP CONSTRAINT conflict_alerts_pkey; CREATE UNIQUE INDEX conflict_alerts_id_unique ON conflict_alerts(id)`],
    ["missing index", `DROP INDEX idx_conflict_status`],
    ["wrong index key", `DROP INDEX idx_conflict_type; CREATE INDEX idx_conflict_type ON conflict_alerts(status,conflict_type)`],
    ["same-name malformed index", `DROP INDEX idx_conflict_org; CREATE INDEX idx_conflict_org ON conflict_alerts(org_id DESC)`],
    ["unique index mismatch", `DROP INDEX idx_conflict_status; CREATE UNIQUE INDEX idx_conflict_status ON conflict_alerts(status)`],
  ] as const;
  for (const [name, mutation] of mutations) await t.test(name, async () => {
    await pool.query("BEGIN");
    await pool.query(mutation);
    await assert.rejects(validation.validateConflictReviewSchema(executor), validation.ConflictReviewSchemaUnavailableError);
    await pool.query("ROLLBACK");
  });
  await pool.end();
});

test("tenant-bound reads and resolution prevent cross-tenant mutation", async () => {
  await migrations.runApplicationMigrations(undefined, { migrationsDirectory });
  const dbModule = await import("../db");
  applicationPool = dbModule.pool;
  const engine = await import("../services/action-resolution-engine");
  const validation = await import("../conflict-review-schema-validation");
  const suffix = randomUUID();
  const orgA = `conflict-a-${suffix}`;
  const orgB = `conflict-b-${suffix}`;
  const idA = `conflict-a-${suffix}`;
  const idB = `conflict-b-${suffix}`;
  await applicationPool.query(`INSERT INTO conflict_alerts(id,org_id,conflict_type,entities,agent_actions)
    VALUES($1,$2,'send_vs_hold',ARRAY['lead:shared'], '[{"agent":"A"}]'),
          ($3,$4,'send_vs_hold',ARRAY['lead:shared'], '[{"agent":"B"}]')`, [idA, orgA, idB, orgB]);

  assert.deepEqual((await engine.getOpenConflicts(orgA)).map(row => row.id), [idA]);
  assert.deepEqual((await engine.getOpenConflicts(orgB)).map(row => row.id), [idB]);
  await assert.rejects(engine.resolveConflict(orgA, idB, "attack-a", "actor-a"), validation.ConflictReviewNotFoundError);
  await assert.rejects(engine.resolveConflict(orgB, idA, "attack-b", "actor-b"), validation.ConflictReviewNotFoundError);
  const denied = await applicationPool.query(`SELECT id,status,resolution,resolved_by,resolved_at FROM conflict_alerts WHERE id=ANY($1) ORDER BY id`, [[idA, idB]]);
  assert.ok(denied.rows.every(row => row.status === "open" && row.resolution === null && row.resolved_by === null && row.resolved_at === null));

  const resolved = await engine.resolveConflict(orgA, idA, "human override", "actor-a");
  assert.equal(resolved.status, "overridden");
  assert.equal(resolved.resolution, "human override");
  assert.equal(resolved.resolvedBy, "actor-a");
  assert.ok(resolved.resolvedAt);
  assert.deepEqual(await engine.getOpenConflicts(orgA), []);
  await applicationPool.query(`DELETE FROM conflict_alerts WHERE id=ANY($1)`, [[idA, idB]]);
});

test("tenant and resolving actor identity are mandatory", async () => {
  const validation = await import("../conflict-review-schema-validation");
  for (const value of [undefined, "", "   ", "default", "DEFAULT", " Default "]) {
    assert.throws(() => validation.assertConflictReviewTenant(value), validation.ConflictReviewTenantUnavailableError);
  }
  const engine = await import("../services/action-resolution-engine");
  await assert.rejects(engine.resolveConflict("default", "x", "x", "actor"), validation.ConflictReviewTenantUnavailableError);
  await assert.rejects(engine.resolveConflict("valid-org", "x", "x", ""), /resolving actor is required/);
});

test("conflict detection persists tenant evidence and first use never repairs missing schema", async () => {
  const engine = await import("../services/action-resolution-engine");
  const validation = await import("../conflict-review-schema-validation");
  const suffix = randomUUID();
  const orgId = `conflict-detect-${suffix}`;
  const shared = { gmailThreadId: `thread-${suffix}`, orgId };
  const alert = await engine.checkAndRecordConflict(orgId, [
    { id: `send-${suffix}`, agentName: "Sender", actionType: "email", intent: "send", ...shared },
    { id: `hold-${suffix}`, agentName: "Reviewer", actionType: "email", intent: "hold", ...shared },
  ]);
  assert.ok(alert?.id);
  assert.equal(alert?.orgId, orgId);
  assert.deepEqual(alert?.entities, [`thread:${shared.gmailThreadId}`]);
  await assert.rejects(engine.checkAndRecordConflict(orgId, [
    { id: "a", agentName: "A", actionType: "email", intent: "send", orgId },
    { id: "b", agentName: "B", actionType: "email", intent: "hold", orgId: `other-${suffix}` },
  ]), validation.ConflictReviewTenantUnavailableError);
  await applicationPool!.query(`DELETE FROM conflict_alerts WHERE id=$1`, [alert!.id]);

  await applicationPool!.query(`ALTER TABLE conflict_alerts RENAME TO conflict_alerts_unavailable_test`);
  try {
    await assert.rejects(engine.getOpenConflicts(orgId), validation.ConflictReviewSchemaUnavailableError);
    assert.equal((await applicationPool!.query(`SELECT to_regclass('conflict_alerts') relation`)).rows[0].relation, null);
  } finally {
    await applicationPool!.query(`ALTER TABLE conflict_alerts_unavailable_test RENAME TO conflict_alerts`);
  }
});

test("concurrent resolutions remain atomic and cannot cross tenants", async () => {
  const engine = await import("../services/action-resolution-engine");
  const validation = await import("../conflict-review-schema-validation");
  const suffix = randomUUID();
  const orgId = `conflict-concurrent-${suffix}`;
  const id = `conflict-concurrent-${suffix}`;
  await applicationPool!.query(`INSERT INTO conflict_alerts(id,org_id,conflict_type) VALUES($1,$2,'send_vs_hold')`, [id, orgId]);
  const attempts = await Promise.allSettled([
    engine.resolveConflict(orgId, id, "resolution-one", "actor-one"),
    engine.resolveConflict(orgId, id, "resolution-two", "actor-two"),
    engine.resolveConflict(`other-${suffix}`, id, "cross-tenant", "attacker"),
  ]);
  assert.equal(attempts[0].status, "fulfilled");
  assert.equal(attempts[1].status, "fulfilled");
  assert.equal(attempts[2].status, "rejected");
  assert.ok(attempts[2].status === "rejected" && attempts[2].reason instanceof validation.ConflictReviewNotFoundError);
  const row = (await applicationPool!.query(`SELECT status,resolution,resolved_by,resolved_at FROM conflict_alerts WHERE id=$1`, [id])).rows[0];
  assert.equal(row.status, "overridden");
  assert.ok(row.resolved_at);
  assert.ok((row.resolution === "resolution-one" && row.resolved_by === "actor-one")
    || (row.resolution === "resolution-two" && row.resolved_by === "actor-two"));
  await applicationPool!.query(`DELETE FROM conflict_alerts WHERE id=$1`, [id]);
});

test("runtime paths contain no structural DDL and expose safe degraded behavior", async () => {
  const service = await readFile(new URL("../services/action-resolution-engine.ts", import.meta.url), "utf8");
  const validator = await readFile(new URL("../conflict-review-schema-validation.ts", import.meta.url), "utf8");
  const routes = await readFile(new URL("../execution-routes.ts", import.meta.url), "utf8");
  for (const source of [service, validator]) {
    assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i);
  }
  assert.doesNotMatch(service, /ensureConflictTables/);
  assert.match(service, /WHERE id = \$\{conflictId\} AND org_id = \$\{orgId\}/);
  assert.match(service, /RETURNING id, status, resolution, resolved_by, resolved_at/);
  const resolveRoute = routes.slice(routes.indexOf("POST /api/conflicts/:id/resolve"), routes.indexOf("GET /api/action-center/summary"));
  assert.match(resolveRoute, /getOrgId\(req\)[\s\S]*resolveConflict\(orgId/);
  assert.match(routes, /sendConflictReviewUnavailable/);

  const { ConflictReviewSchemaUnavailableError, sendConflictReviewUnavailable } = await import("../conflict-review-schema-validation");
  let code = 0; let body: any;
  const response = { status(value: number) { code = value; return this; }, json(value: any) { body = value; return this; } };
  assert.equal(sendConflictReviewUnavailable(new ConflictReviewSchemaUnavailableError(["secret.detail"]), response as any), true);
  assert.equal(code, 503);
  assert.deepEqual(body, { message: "Conflict Review unavailable" });
  assert.equal(JSON.stringify(body).includes("secret"), false);
});
