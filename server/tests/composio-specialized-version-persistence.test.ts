import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
const { Pool } = pg;
const admin = new Pool({ connectionString });
const schemas: string[] = [];
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const migrations = await import("../application-migrations");
const { validateComposioSpecializedVersionSchema, ComposioSpecializedVersionSchemaUnavailableError } =
  await import("../composio-specialized-version-schema-validation");

async function fresh() {
  const schema = `specialized_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  return pool;
}

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

test("0017 formally owns all specialized version fields and validates cleanly", async () => {
  const pool = await fresh();
  await validateComposioSpecializedVersionSchema(drizzle(pool) as any);
  const applied = await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations WHERE migration_id='0017_composio_specialized_caller_versions.sql'`);
  assert.equal(applied.rows[0].n, 1);
  await pool.end();
});

test("Gmail and Slack require positive safe version 1 on new canonical rows", async () => {
  const pool = await fresh();
  await pool.query(`INSERT INTO composio_gmail_draft_requests(id,org_id,agent_id,recipient_email,subject,body,purpose,provider_action_version)
    VALUES('g','o','a','x@example.com','s','b','p',1)`);
  await pool.query(`INSERT INTO composio_slack_alert_requests(id,org_id,agent_id,channel,alert_type,message,purpose,provider_action_version)
    VALUES('s','o','a','#ops','critical_bug_detected','m','p',1)`);
  await assert.rejects(pool.query(`UPDATE composio_gmail_draft_requests SET provider_action_version=0 WHERE id='g'`));
  await assert.rejects(pool.query(`UPDATE composio_slack_alert_requests SET provider_action_version=9007199254740992 WHERE id='s'`));
  await pool.query(`UPDATE composio_gmail_draft_requests SET provider_action_version=9007199254740991 WHERE id='g'`);
  await assert.rejects(pool.query(`UPDATE composio_gmail_draft_requests SET provider_action_version=9007199254740992 WHERE id='g'`));
  await pool.end();
});

test("approval versions require exact current version and durable approver/account evidence", async () => {
  const pool = await fresh();
  await pool.query(`INSERT INTO composio_gmail_draft_requests(id,org_id,agent_id,recipient_email,subject,body,purpose,provider_action_version)
    VALUES('g','o','a','x@example.com','s','b','p',1)`);
  await assert.rejects(pool.query(`UPDATE composio_gmail_draft_requests SET approved_provider_action_version=1 WHERE id='g'`));
  await assert.rejects(pool.query(`UPDATE composio_gmail_draft_requests SET approved_provider_action_version=2,approved_by='u',approved_at=now(),approved_connected_account_id='acct' WHERE id='g'`));
  await pool.query(`UPDATE composio_gmail_draft_requests SET approved_provider_action_version=1,approved_by='u',approved_at=now(),approved_connected_account_id='acct' WHERE id='g'`);
  await pool.end();
});

test("Calendar and GitHub legacy eligibility remains nullable rather than fabricated", async () => {
  const pool = await fresh();
  await pool.query(`INSERT INTO composio_calendar_requests(id,org_id,agent_id,action_type,purpose,payload) VALUES('c','o','a','create_event','p',NULL)`);
  await pool.query(`INSERT INTO software_improvement_tasks(id,organization_id,source_agent,source_type,title,problem_summary,severity)
    VALUES('t','o','a','test','title','problem','high')`);
  const result = await pool.query(`SELECT
    (SELECT provider_action_version FROM composio_calendar_requests WHERE id='c') calendar_version,
    (SELECT github_provider_action_version FROM software_improvement_tasks WHERE id='t') github_version`);
  assert.equal(result.rows[0].calendar_version, null);
  assert.equal(result.rows[0].github_version, null);
  await pool.end();
});

test("runtime readiness on an empty catalog performs SELECT-only validation and no repair", async () => {
  let calls = 0;
  const executor = { execute: async () => { calls += 1; return { rows: [] }; } };
  await assert.rejects(validateComposioSpecializedVersionSchema(executor as any), ComposioSpecializedVersionSchemaUnavailableError);
  assert.ok(calls > 0);
  const source = await readFile(new URL("../composio-specialized-version-schema-validation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:create|alter|drop|truncate)\s+(?:table|type|index)\b/i);
});

test("runtime readiness rejects complete-contract drift without repairing it", async (t) => {
  const mutations = [
    [`ALTER TABLE composio_gmail_draft_requests DROP COLUMN recipient_email`, "missing legacy column"],
    [`ALTER TABLE composio_gmail_draft_requests ALTER COLUMN provider_action_version TYPE numeric`, "wrong version type"],
    [`ALTER TABLE composio_gmail_draft_requests ALTER COLUMN provider_action_version DROP NOT NULL`, "nullable canonical version"],
    [`ALTER TABLE composio_calendar_requests ALTER COLUMN payload TYPE text USING payload::text`, "calendar payload drift"],
    [`ALTER TABLE software_improvement_tasks ALTER COLUMN github_issue_draft TYPE text USING github_issue_draft::text`, "GitHub draft drift"],
    [`ALTER TABLE composio_slack_alert_requests DROP CONSTRAINT composio_slack_version_check`, "missing authority check"],
    [`DROP INDEX composio_calendar_requests_org_status_idx; CREATE INDEX composio_calendar_requests_org_status_idx ON composio_calendar_requests(status,org_id)`, "wrong index order"],
  ] as const;
  for (const [statement, name] of mutations) await t.test(name, async () => {
    const pool = await fresh();
    await pool.query(statement);
    await assert.rejects(validateComposioSpecializedVersionSchema(drizzle(pool) as any), ComposioSpecializedVersionSchemaUnavailableError);
    await assert.rejects(validateComposioSpecializedVersionSchema(drizzle(pool) as any), ComposioSpecializedVersionSchemaUnavailableError);
    await pool.end();
  });
});

test("0017 rejects an incompatible legacy table atomically and succeeds after explicit repair", async () => {
  const schema = `specialized_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await assert.rejects(migrations.runApplicationMigrations(pool, {
      migrationsDirectory,
      beforeMigration: async (id: string) => {
        if (id === "0017_composio_specialized_caller_versions.sql")
          await pool.query(`CREATE TABLE composio_gmail_draft_requests(id varchar(128) PRIMARY KEY)`);
    },
  }), /specialized Composio legacy contract mismatch/);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations WHERE migration_id='0017_composio_specialized_caller_versions.sql'`)).rows[0].n, 0);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='composio_gmail_draft_requests' AND column_name='provider_action_version'`)).rows[0].n, 0);
  await pool.query(`DROP TABLE composio_gmail_draft_requests`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations WHERE migration_id='0017_composio_specialized_caller_versions.sql'`)).rows[0].n, 1);
  await pool.end();
});
