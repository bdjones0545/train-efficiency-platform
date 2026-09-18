/**
 * Google Calendar token storage — live DB.
 *
 * Defects on main:
 *   - connector_tokens had only a primary key, so the connector's
 *     `INSERT ... ON CONFLICT (org_id, connector) DO UPDATE` raised 42P10 on
 *     EVERY token exchange: the connection could never complete.
 *   - access_token / refresh_token were stored in plaintext.
 *
 * Migration 0021 dedupes any existing duplicates (keeping the newest row) and
 * creates the (org_id, connector) unique index; the connector now encrypts
 * tokens with the credentials vault and still reads legacy plaintext rows.
 *
 * Runs against an isolated schema built by the real application migration
 * chain (never against a shared/public schema).
 */

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");

process.env.SESSION_SECRET ??= "token-storage-test-session-secret";
process.env.CREDENTIAL_ENCRYPTION_KEY ??= "token-storage-test-credential-encryption-key";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";

const admin = new pg.Pool({ connectionString });
const schemas: string[] = [];
const schema = `gcal_tokens_${randomUUID().replaceAll("-", "")}`;
schemas.push(schema);
await admin.query(`CREATE SCHEMA "${schema}"`);
const database = new pg.Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
const separator = connectionString.includes("?") ? "&" : "?";
// The connector's shared db client must resolve to the isolated schema.
process.env.DATABASE_URL = `${connectionString}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`;

const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const MIGRATION_0021 = "0021_connector_tokens_org_connector_unique.sql";
const UNIQUE_INDEX = "connector_tokens_org_connector_unique";

// Every migration BEFORE 0021 — the state a production database is in today.
const legacyDirectory = await mkdtemp(join(tmpdir(), "gcal-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && name < MIGRATION_0021)) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}

const migrations = await import("../application-migrations");
await migrations.runApplicationMigrations(database, { migrationsDirectory });
const calendar = await import("../connectors/google-calendar");

async function isolatedPool(): Promise<pg.Pool> {
  const name = `gcal_migration_${randomUUID().replaceAll("-", "")}`;
  schemas.push(name);
  await admin.query(`CREATE SCHEMA "${name}"`);
  return new pg.Pool({ connectionString, max: 8, options: `-c search_path=${name}` });
}

async function rows(pool: pg.Pool, orgId: string) {
  return (await pool.query(
    `SELECT id, access_token, refresh_token, token_expiry, email, created_at, updated_at
     FROM connector_tokens WHERE org_id=$1 AND connector='google_calendar' ORDER BY updated_at DESC`,
    [orgId],
  )).rows;
}

async function uniqueIndexDef(pool: pg.Pool): Promise<string | undefined> {
  return (await pool.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='connector_tokens' AND indexname=$1`,
    [UNIQUE_INDEX],
  )).rows[0]?.indexdef;
}

after(async () => {
  await database.end();
  for (const owned of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${owned}" CASCADE`);
  await admin.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

// ─── Migration 0021 ─────────────────────────────────────────────────────────

test("0021 creates a unique index on connector_tokens (org_id, connector) and is ledgered once", async () => {
  const def = await uniqueIndexDef(database);
  assert.match(def ?? "", /CREATE UNIQUE INDEX connector_tokens_org_connector_unique ON \S+connector_tokens USING btree \(org_id, connector\)/);
  const ledger = await database.query(`SELECT count(*)::int n FROM train_efficiency_migrations WHERE migration_id=$1`, [MIGRATION_0021]);
  assert.equal(ledger.rows[0].n, 1);
});

test("0021 on a populated pre-0021 database keeps only the newest row per (org, connector), then re-runs as a no-op", async () => {
  const pool = await isolatedPool();
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  assert.equal(await uniqueIndexDef(pool), undefined, "pre-0021 databases have no unique index");

  // Three rows for the same org — the state main's failed retries could not
  // even produce, but which an older writer or manual repair may have left.
  await pool.query(`
    INSERT INTO connector_tokens (id, org_id, connector, access_token, refresh_token, email, created_at, updated_at) VALUES
      ('00000000-0000-0000-0000-000000000001', 'dup-org', 'google_calendar', 'oldest', 'r-oldest', 'old@example.test', NOW() - interval '3 days', NOW() - interval '3 days'),
      ('00000000-0000-0000-0000-000000000002', 'dup-org', 'google_calendar', 'newest', 'r-newest', 'new@example.test', NOW() - interval '2 days', NOW() - interval '1 hour'),
      ('00000000-0000-0000-0000-000000000003', 'dup-org', 'google_calendar', 'middle', 'r-middle', 'mid@example.test', NOW() - interval '1 day', NOW() - interval '1 day'),
      ('00000000-0000-0000-0000-000000000004', 'dup-org', 'other_connector', 'other', NULL, NULL, NOW(), NOW()),
      ('00000000-0000-0000-0000-000000000005', 'single-org', 'google_calendar', 'single', 'r-single', 's@example.test', NOW(), NOW())
  `);

  await migrations.runApplicationMigrations(pool, { migrationsDirectory });

  const kept = await pool.query(`SELECT id, org_id, connector, access_token FROM connector_tokens ORDER BY org_id, connector`);
  assert.deepEqual(kept.rows.map((r) => [r.org_id, r.connector, r.access_token]), [
    ["dup-org", "google_calendar", "newest"],
    ["dup-org", "other_connector", "other"],
    ["single-org", "google_calendar", "single"],
  ]);
  assert.ok(await uniqueIndexDef(pool));

  // Idempotent: a second boot is a checksum-verified no-op.
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await pool.query(`SELECT count(*)::int n FROM connector_tokens`)).rows[0].n, 3);
  await pool.end();
});

test("connector_tokens now rejects a second row for the same (org_id, connector)", async () => {
  await database.query(`INSERT INTO connector_tokens (org_id, connector, access_token) VALUES ('unique-org', 'google_calendar', 'a')`);
  await assert.rejects(
    database.query(`INSERT INTO connector_tokens (org_id, connector, access_token) VALUES ('unique-org', 'google_calendar', 'b')`),
    (err: any) => err.code === "23505",
  );
  // Other connectors for the same org are unaffected.
  await database.query(`INSERT INTO connector_tokens (org_id, connector, access_token) VALUES ('unique-org', 'other', 'c')`);
});

// ─── Upsert (defect 1 on main: 42P10) ───────────────────────────────────────

test("two storeGoogleCalendarTokens calls for the same org produce ONE row, updated in place", async () => {
  await calendar.storeGoogleCalendarTokens("upsert-org", {
    access_token: "access-1", refresh_token: "refresh-1", expiry_date: Date.now() + 3_600_000,
  }, "first@example.test");
  const first = await rows(database, "upsert-org");
  assert.equal(first.length, 1);

  await calendar.storeGoogleCalendarTokens("upsert-org", {
    access_token: "access-2", refresh_token: "refresh-2", expiry_date: Date.now() + 7_200_000,
  }, "second@example.test");
  const second = await rows(database, "upsert-org");
  assert.equal(second.length, 1, "the upsert must update, never insert a second row");
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].email, "second@example.test");
  assert.ok(new Date(second[0].updated_at) >= new Date(first[0].updated_at));
  assert.ok(new Date(second[0].token_expiry) > new Date(first[0].token_expiry));

  const status = await calendar.getGoogleCalendarStatus("upsert-org");
  assert.deepEqual(status, { connected: true, email: "second@example.test", configured: true });
});

// ─── Encryption at rest (defect 3 on main: plaintext) ───────────────────────

test("tokens are stored as vault envelopes, not plaintext, and getFreshAccessToken decrypts them", async () => {
  await calendar.storeGoogleCalendarTokens("enc-org", {
    access_token: "ya29.plaintext-access", refresh_token: "1//plaintext-refresh", expiry_date: Date.now() + 3_600_000,
  }, "enc@example.test");
  const [row] = await rows(database, "enc-org");
  assert.notEqual(row.access_token, "ya29.plaintext-access");
  assert.notEqual(row.refresh_token, "1//plaintext-refresh");
  assert.ok(!String(row.access_token).includes("plaintext-access"));
  assert.ok(!String(row.refresh_token).includes("plaintext-refresh"));
  assert.ok(calendar.isEncryptedTokenEnvelope(row.access_token));
  assert.ok(calendar.isEncryptedTokenEnvelope(row.refresh_token));

  // A non-expired access token is returned as-is (no refresh round-trip to Google).
  assert.equal(await calendar.getFreshAccessToken("enc-org"), "ya29.plaintext-access");
});

test("a legacy plaintext row still works and is re-encrypted on the next write (refresh token preserved)", async () => {
  await database.query(
    `INSERT INTO connector_tokens (org_id, connector, access_token, refresh_token, token_expiry, email)
     VALUES ('legacy-org', 'google_calendar', 'legacy-access', 'legacy-refresh', $1, 'legacy@example.test')`,
    [new Date(Date.now() + 3_600_000).toISOString()],
  );
  assert.equal(calendar.isEncryptedTokenEnvelope("legacy-access"), false);
  assert.equal(await calendar.getFreshAccessToken("legacy-org"), "legacy-access");
  assert.equal((await calendar.getGoogleCalendarStatus("legacy-org")).connected, true);

  // Next write: Google re-issues an access token without a refresh token
  // (the common re-consent case). The legacy refresh token must survive AND
  // become encrypted; the new access token is encrypted.
  await calendar.storeGoogleCalendarTokens("legacy-org", {
    access_token: "new-access", refresh_token: null, expiry_date: Date.now() + 3_600_000,
  }, "legacy@example.test");
  const after = await rows(database, "legacy-org");
  assert.equal(after.length, 1);
  assert.ok(calendar.isEncryptedTokenEnvelope(after[0].access_token));
  assert.ok(calendar.isEncryptedTokenEnvelope(after[0].refresh_token));
  assert.ok(!String(after[0].refresh_token).includes("legacy-refresh"));
  assert.equal(await calendar.getFreshAccessToken("legacy-org"), "new-access");

  const { decryptCredentials } = await import("../credentials-vault");
  assert.equal(decryptCredentials(JSON.parse(after[0].refresh_token))?.token, "legacy-refresh");
});

test("an envelope that cannot be decrypted is treated as disconnected rather than sent to Google", async () => {
  await database.query(
    `INSERT INTO connector_tokens (org_id, connector, access_token, refresh_token, token_expiry)
     VALUES ('bad-key-org', 'google_calendar', $1, NULL, $2)`,
    [JSON.stringify({ _v: 1, _enc: "AAAA", _iv: "AAAAAAAAAAAAAAAA", _tag: "AAAAAAAAAAAAAAAAAAAAAA==" }), new Date(Date.now() + 3_600_000).toISOString()],
  );
  assert.equal((await calendar.getGoogleCalendarStatus("bad-key-org")).connected, false);
  await assert.rejects(calendar.getFreshAccessToken("bad-key-org"));
});

test("disconnect removes the org's row and leaves other orgs untouched", async () => {
  await calendar.storeGoogleCalendarTokens("disc-a", { access_token: "a", refresh_token: "ra", expiry_date: Date.now() + 3_600_000 }, null);
  await calendar.storeGoogleCalendarTokens("disc-b", { access_token: "b", refresh_token: "rb", expiry_date: Date.now() + 3_600_000 }, null);
  await calendar.disconnectGoogleCalendar("disc-a");
  assert.equal((await rows(database, "disc-a")).length, 0);
  assert.equal((await rows(database, "disc-b")).length, 1);
});
