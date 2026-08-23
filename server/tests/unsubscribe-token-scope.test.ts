import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const pool = new Pool({ connectionString });
const { storage } = await import("../storage");
const routesSource = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
const emailSource = await readFile(new URL("../email.ts", import.meta.url), "utf8");

const emailPrefs = (marketing: boolean) => ({
  email: { bookingConfirmations: true, cancellations: true, reschedules: true, reminders: true, outreach: true, marketing },
  sms: { bookingConfirmations: false, cancellations: false, reschedules: false, reminders: false, outreach: false, marketing: false },
});

async function preference(userId: string, orgId: string) {
  const result = await pool.query(
    "SELECT id,notification_preferences,unsubscribe_token FROM user_org_preferences WHERE user_id=$1 AND org_id=$2",
    [userId, orgId],
  );
  return result.rows[0];
}

async function applyTokenPreferences(token: string, prefs: Record<string, any>) {
  const scope = await storage.getUnsubscribePreferenceScope(token);
  if (!scope) return false;
  if (scope.orgId) {
    await storage.upsertUserOrgPreferences(scope.user.id, scope.orgId, { notificationPreferences: prefs });
  } else {
    await storage.updateNotificationPreferences(scope.user.id, prefs);
  }
  return true;
}

before(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS user_org_preferences,user_profiles,users CASCADE;
    DROP TYPE IF EXISTS user_role CASCADE;
    CREATE TYPE user_role AS ENUM ('CLIENT','COACH','ADMIN','STAFF');
    CREATE TABLE users (
      id varchar PRIMARY KEY,email varchar UNIQUE,first_name varchar,last_name varchar,password_hash text,
      profile_image_url varchar,phone varchar,notes text,balance_cents integer NOT NULL DEFAULT 0,
      stripe_customer_id varchar,last_sign_in_at timestamp,weekly_reminder_enabled boolean NOT NULL DEFAULT true,
      last_reminder_sent_at timestamp,password_reset_token varchar,password_reset_token_expires timestamp,
      unsubscribe_token varchar UNIQUE,notification_preferences jsonb,sms_opt_in boolean NOT NULL DEFAULT false,
      sms_opt_in_at timestamp,sms_opt_out_at timestamp,sms_consent_source varchar,
      created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now()
    );
    CREATE TABLE user_profiles (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,user_id varchar NOT NULL REFERENCES users(id),
      role user_role NOT NULL DEFAULT 'CLIENT',organization_id varchar
    );
    CREATE TABLE user_org_preferences (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id varchar NOT NULL,sms_opt_in boolean NOT NULL DEFAULT false,sms_opt_in_at timestamp,sms_opt_out_at timestamp,
      notification_preferences jsonb,unsubscribe_token varchar UNIQUE,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now(),
      UNIQUE(user_id,org_id)
    );
  `);
});

beforeEach(async () => {
  await pool.query("TRUNCATE user_org_preferences,user_profiles,users CASCADE");
  await pool.query(`INSERT INTO users(id,email,unsubscribe_token,notification_preferences) VALUES
    ('user-a','a@test.invalid','legacy-user-a','{"email":{"marketing":true}}'),
    ('user-b','b@test.invalid','legacy-user-b','{"email":{"marketing":true}}')`);
  await pool.query(`INSERT INTO user_profiles(user_id,role,organization_id) VALUES
    ('user-a','CLIENT','org-a'),('user-b','CLIENT','org-b')`);
  await pool.query(`INSERT INTO user_org_preferences(id,user_id,org_id,notification_preferences) VALUES
    ('pref-a','user-a','org-a','{"email":{"marketing":true}}'),
    ('pref-b','user-b','org-b','{"email":{"marketing":true}}')`);
});

after(async () => { await pool.end(); });

test("organization token durably resolves exact user, org, and preference row", async () => {
  const token = await storage.ensureUnsubscribeToken("user-a", "org-a");
  const scope = await storage.getUnsubscribePreferenceScope(token);
  assert.equal(scope?.user.id, "user-a");
  assert.equal(scope?.orgId, "org-a");
  assert.equal(scope?.preferenceId, "pref-a");
});

test("valid Org A token updates only Org A intended preference", async () => {
  const token = await storage.ensureUnsubscribeToken("user-a", "org-a");
  assert.equal(await applyTokenPreferences(token, emailPrefs(false)), true);
  assert.equal((await preference("user-a", "org-a")).notification_preferences.email.marketing, false);
  assert.equal((await preference("user-b", "org-b")).notification_preferences.email.marketing, true);
});

test("Org A token plus Org B identifiers cannot mutate Org B", async () => {
  const token = await storage.ensureUnsubscribeToken("user-a", "org-a");
  const attackerInput = { orgId: "org-b", organizationId: "org-b", tenantId: "org-b", userId: "user-b", email: "b@test.invalid", preferenceId: "pref-b" };
  assert.ok(attackerInput.orgId);
  assert.equal(await applyTokenPreferences(token, emailPrefs(false)), true);
  assert.equal((await preference("user-b", "org-b")).notification_preferences.email.marketing, true);
});

test("token issuance rejects an organization not owned by the user", async () => {
  await assert.rejects(
    storage.ensureUnsubscribeToken("user-a", "org-b"),
    /outside the user's organization scope/,
  );
  assert.equal((await preference("user-b", "org-b")).unsubscribe_token, null);
});

test("Org A and Org B receive distinct opaque persisted tokens", async () => {
  const [a, b] = await Promise.all([
    storage.ensureUnsubscribeToken("user-a", "org-a"),
    storage.ensureUnsubscribeToken("user-b", "org-b"),
  ]);
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/i);
  assert.match(b, /^[0-9a-f-]{36}$/i);
});

test("legacy user token remains user-level and cannot select an organization", async () => {
  const scope = await storage.getUnsubscribePreferenceScope("legacy-user-a");
  assert.equal(scope?.user.id, "user-a");
  assert.equal(scope?.orgId, null);
  assert.equal(scope?.preferenceId, null);
  await applyTokenPreferences("legacy-user-a", emailPrefs(false));
  assert.equal((await preference("user-a", "org-a")).notification_preferences.email.marketing, true);
  assert.equal((await preference("user-b", "org-b")).notification_preferences.email.marketing, true);
});

test("malformed, unknown, and tampered tokens fail closed", async () => {
  const token = await storage.ensureUnsubscribeToken("user-a", "org-a");
  for (const invalid of ["", "not-a-token", `${token}x`, token.slice(0, -1)]) {
    assert.equal(await storage.getUnsubscribePreferenceScope(invalid), undefined);
    assert.equal(await applyTokenPreferences(invalid, emailPrefs(false)), false);
  }
  assert.equal((await preference("user-a", "org-a")).notification_preferences.email.marketing, true);
});

test("replay is idempotent and never widens scope", async () => {
  const token = await storage.ensureUnsubscribeToken("user-a", "org-a");
  assert.equal(await applyTokenPreferences(token, emailPrefs(false)), true);
  assert.equal(await applyTokenPreferences(token, emailPrefs(false)), true);
  assert.equal((await preference("user-a", "org-a")).notification_preferences.email.marketing, false);
  assert.equal((await preference("user-b", "org-b")).notification_preferences.email.marketing, true);
});

test("simultaneous token issuance returns one durable token", async () => {
  const tokens = await Promise.all(Array.from({ length: 8 }, () => storage.ensureUnsubscribeToken("user-a", "org-a")));
  assert.equal(new Set(tokens).size, 1);
  assert.equal((await preference("user-a", "org-a")).unsubscribe_token, tokens[0]);
});

test("concurrent valid replay and cross-tenant attack leave Org B unchanged", async () => {
  const token = await storage.ensureUnsubscribeToken("user-a", "org-a");
  const [valid, attack] = await Promise.all([
    applyTokenPreferences(token, emailPrefs(false)),
    applyTokenPreferences(`${token}-org-b`, emailPrefs(false)),
  ]);
  assert.equal(valid, true);
  assert.equal(attack, false);
  assert.equal((await preference("user-a", "org-a")).notification_preferences.email.marketing, false);
  assert.equal((await preference("user-b", "org-b")).notification_preferences.email.marketing, true);
});

test("injected DB failure cannot partially mutate another preference row", async () => {
  const token = await storage.ensureUnsubscribeToken("user-a", "org-a");
  await pool.query(`ALTER TABLE user_org_preferences ADD CONSTRAINT reject_a_update CHECK (
    NOT (user_id='user-a' AND notification_preferences->'email'->>'marketing'='false')
  )`);
  try {
    await assert.rejects(applyTokenPreferences(token, emailPrefs(false)));
    assert.equal((await preference("user-a", "org-a")).notification_preferences.email.marketing, true);
    assert.equal((await preference("user-b", "org-b")).notification_preferences.email.marketing, true);
  } finally {
    await pool.query("ALTER TABLE user_org_preferences DROP CONSTRAINT reject_a_update");
  }
});

test("unsubscribe routes ignore client organization, recipient, and preference identifiers", () => {
  const start = routesSource.indexOf('app.get("/api/unsubscribe/:token"');
  const end = routesSource.indexOf('app.get("/api/notification-preferences"', start);
  const routes = routesSource.slice(start, end);
  assert.doesNotMatch(routes, /req\.query\.(orgId|organizationId|tenantId|userId|email|preferenceId|category)/);
  assert.doesNotMatch(routes, /req\.body\.(orgId|organizationId|tenantId|userId|email|preferenceId|category)/);
  assert.match(routes, /getUnsubscribePreferenceScope\(req\.params\.token\)/);
});

test("preference input is limited to established email and SMS categories", () => {
  const start = routesSource.indexOf("const mergeUnsubscribePreferences");
  const end = routesSource.indexOf('app.get("/api/unsubscribe/:token"', start);
  const merger = routesSource.slice(start, end);
  assert.match(merger, /Object\.keys\(defaults\)/);
  assert.match(merger, /typeof updates\?\.\[key\] === "boolean"/);
  assert.doesNotMatch(merger, /\.\.\.incomingEmail|\.\.\.incomingSms/);
});

test("email links contain only the persisted scoped token", () => {
  assert.match(emailSource, /ensureUnsubscribeToken\(logCtx\.recipientUserId, logCtx\.orgId\)/);
  assert.match(emailSource, /unsubscribe\/\$\{token\}`/);
  assert.doesNotMatch(emailSource, /orgParam/);
});

test("no unsubscribe success audit exists, so rejected tokens create no false evidence", async () => {
  assert.doesNotMatch(routesSource.slice(
    routesSource.indexOf('app.get("/api/unsubscribe/:token"'),
    routesSource.indexOf('app.get("/api/notification-preferences"'),
  ), /createAudit|createCommunicationLog|audit/i);
  assert.equal(await applyTokenPreferences("unknown", emailPrefs(false)), false);
  assert.equal((await preference("user-b", "org-b")).notification_preferences.email.marketing, true);
});

test("token expiry is not part of the existing product contract", () => {
  assert.doesNotMatch(routesSource.slice(
    routesSource.indexOf('app.get("/api/unsubscribe/:token"'),
    routesSource.indexOf('app.get("/api/notification-preferences"'),
  ), /expiresAt|expiredAt|expiry/);
});
