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
const { resolveOrgIdOrThrow } = await import("../lib/resolve-org-id");
const { requireRole } = await import("../lib/require-role");
const routesSource = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
const storageSource = await readFile(new URL("../storage.ts", import.meta.url), "utf8");

before(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS wallet_transactions,user_profiles,users CASCADE;
    DROP TYPE IF EXISTS wallet_tx_type,user_role CASCADE;
    CREATE TYPE user_role AS ENUM ('CLIENT','COACH','ADMIN','STAFF');
    CREATE TYPE wallet_tx_type AS ENUM ('CREDIT','DEBIT');
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
    CREATE TABLE wallet_transactions (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,user_id varchar NOT NULL REFERENCES users(id),
      type wallet_tx_type NOT NULL,amount_cents integer NOT NULL,description text DEFAULT '',source_type varchar,
      source_id varchar,stripe_session_id varchar,stripe_payment_intent_id varchar,stripe_charge_id varchar,
      currency varchar DEFAULT 'usd',payment_status varchar,livemode boolean NOT NULL DEFAULT false,
      created_at timestamp DEFAULT now()
    );
  `);
});

beforeEach(async () => {
  await pool.query("TRUNCATE wallet_transactions,user_profiles,users CASCADE");
  await pool.query(`INSERT INTO users(id,email,first_name,balance_cents) VALUES
    ('admin-a','admin-a@test.invalid','Admin A',0),('coach-a','coach-a@test.invalid','Coach A',0),
    ('staff-a','staff-a@test.invalid','Staff A',0),('client-a','client-a@test.invalid','Client A',1100),
    ('admin-b','admin-b@test.invalid','Admin B',0),('client-b','client-b@test.invalid','Client B',9200),
    ('admin-none','admin-none@test.invalid','No Org',0)`);
  await pool.query(`INSERT INTO user_profiles(user_id,role,organization_id) VALUES
    ('admin-a','ADMIN','org-a'),('coach-a','COACH','org-a'),('staff-a','STAFF','org-a'),
    ('client-a','CLIENT','org-a'),('admin-b','ADMIN','org-b'),('client-b','CLIENT','org-b'),
    ('admin-none','ADMIN',NULL)`);
  await pool.query(`INSERT INTO wallet_transactions(id,user_id,type,amount_cents,description,created_at) VALUES
    ('tx-a-credit','client-a','CREDIT',1500,'Org A credit',now()-interval '2 hours'),
    ('tx-a-debit','client-a','DEBIT',400,'Org A debit',now()-interval '1 hour'),
    ('tx-b-credit','client-b','CREDIT',9200,'Org B secret credit',now())`);
});

after(async () => { await pool.end(); });

test("self wallet balance is bound to authoritative organization and user", async () => {
  assert.equal(await storage.getUserBalanceForOrganization("org-a", "client-a"), 1100);
  assert.equal(await storage.getUserBalanceForOrganization("org-a", "client-b"), undefined);
});

test("Org B can read its own wallet balance through the scoped boundary", async () => {
  assert.equal(await storage.getUserBalanceForOrganization("org-b", "client-b"), 9200);
});

test("organization transaction history excludes every Org B row", async () => {
  const rows = await storage.getWalletTransactionsForOrganization("org-a");
  assert.deepEqual(rows.map(row => row.id), ["tx-a-debit", "tx-a-credit"]);
  assert.equal(rows.some(row => row.userId === "client-b"), false);
});

test("self transaction history cannot substitute an Org B user ID", async () => {
  assert.deepEqual(await storage.getWalletTransactionsForOrganization("org-a", "client-b"), []);
});

test("valid Org B transaction ID is not returned to Org A", async () => {
  const rows = await storage.getWalletTransactionsForOrganization("org-a");
  assert.equal(rows.some(row => row.id === "tx-b-credit"), false);
});

test("unknown target returns no balance or history", async () => {
  assert.equal(await storage.getUserBalanceForOrganization("org-a", "missing"), undefined);
  assert.deepEqual(await storage.getWalletTransactionsForOrganization("org-a", "missing"), []);
});

test("organization balance list is scoped in SQL", async () => {
  const balances = await storage.getUserBalancesByOrganization("org-a");
  assert.equal(balances.some(row => row.id === "client-b"), false);
  assert.equal(balances.find(row => row.id === "client-a")?.balanceCents, 1100);
});

test("aggregate totals contain no Org B value", async () => {
  const rows = await storage.getWalletTransactionsForOrganization("org-a");
  const net = rows.reduce((total, row) => total + (row.type === "CREDIT" ? row.amountCents : -row.amountCents), 0);
  assert.equal(net, 1100);
  assert.notEqual(net, 10300);
});

test("concurrent organization reads remain isolated and request-local", async () => {
  const [a, b, cross] = await Promise.all([
    storage.getWalletTransactionsForOrganization("org-a"),
    storage.getWalletTransactionsForOrganization("org-b"),
    storage.getWalletTransactionsForOrganization("org-a", "client-b"),
  ]);
  assert.deepEqual(a.map(row => row.userId), ["client-a", "client-a"]);
  assert.deepEqual(b.map(row => row.userId), ["client-b"]);
  assert.deepEqual(cross, []);
});

test("missing actor organization fails through the trusted resolver", async () => {
  await assert.rejects(
    resolveOrgIdOrThrow({ user: { id: "admin-none" }, path: "/api/coach/transactions" }),
    (error: any) => error?.statusCode === 403,
  );
  assert.equal((await storage.getWalletTransactionsForOrganization("missing")).length, 0);
});

test("wallet routes use trusted organization resolution and scoped reads", () => {
  for (const marker of [
    'app.get("/api/coach/transactions"',
    'app.get("/api/coach/user-balances"',
    'app.get("/api/wallet"',
  ]) {
    const start = routesSource.indexOf(marker);
    const end = routesSource.indexOf("\n  });", start);
    const route = routesSource.slice(start, end);
    assert.match(route, /resolveOrgIdOrThrow\(req\)/);
    assert.doesNotMatch(route, /getAllWalletTransactions|getAllUserBalances|getWalletTransactions\(|getUserBalance\(/);
  }
});

test("coach transaction and balance routes preserve COACH and ADMIN policy", () => {
  for (const marker of [
    'app.get("/api/coach/transactions"',
    'app.get("/api/coach/user-balances"',
    'app.get("/api/coach/business-plan/:coachId"',
  ]) {
    const start = routesSource.indexOf(marker);
    const end = routesSource.indexOf("\n  });", start);
    const route = routesSource.slice(start, end);
    assert.match(route, /isAuthenticated/);
    assert.match(route, /requireRole\("COACH", "ADMIN"\)/);
  }
});

test("business-plan wallet aggregation uses the same authoritative organization", () => {
  const start = routesSource.indexOf('app.get("/api/coach/business-plan/:coachId"');
  const end = routesSource.indexOf('app.delete("/api/coach/business-plan/:coachId/clients/:clientId"', start);
  const route = routesSource.slice(start, end);
  assert.match(route, /const sessionOrgId = await resolveOrgIdOrThrow\(req\)/);
  assert.match(route, /getWalletTransactionsForOrganization\(sessionOrgId\)/);
  assert.doesNotMatch(route, /getAllWalletTransactions\(/);
});

test("actual role middleware allows ADMIN/COACH and denies STAFF/CLIENT/unauthenticated", async () => {
  const original = storage.getUserProfile.bind(storage);
  const invoke = async (role: "ADMIN" | "COACH" | "STAFF" | "CLIENT" | null) => {
    (storage as any).getUserProfile = async () => role ? ({ role } as any) : undefined;
    let status = 200;
    let nextCalls = 0;
    const req = role === null ? {} : { user: { id: `${role.toLowerCase()}-a` } };
    const res = { status(code: number) { status = code; return this; }, json() { return this; } };
    await requireRole("COACH", "ADMIN")(req, res, () => { nextCalls++; });
    return { status, nextCalls };
  };
  try {
    assert.deepEqual(await invoke("ADMIN"), { status: 200, nextCalls: 1 });
    assert.deepEqual(await invoke("COACH"), { status: 200, nextCalls: 1 });
    assert.deepEqual(await invoke("STAFF"), { status: 403, nextCalls: 0 });
    assert.deepEqual(await invoke("CLIENT"), { status: 403, nextCalls: 0 });
    assert.deepEqual(await invoke(null), { status: 401, nextCalls: 0 });
  } finally {
    (storage as any).getUserProfile = original;
  }
});

test("client tenant and object identifiers are never wallet-read authority", () => {
  for (const [marker, nextMarker] of [
    ['app.get("/api/coach/transactions"', 'app.get("/api/coach/stripe-subscription-transactions"'],
    ['app.get("/api/coach/user-balances"', 'app.get("/api/admin/users"'],
    ['app.get("/api/wallet"', 'app.get("/api/wallet/subscription-plans"'],
  ]) {
    const start = routesSource.indexOf(marker);
    const end = routesSource.indexOf(nextMarker, start);
    const walletRead = routesSource.slice(start, end);
    assert.doesNotMatch(walletRead, /req\.(body|query)\.(orgId|organizationId|tenantId|userId|walletId|transactionId|ledgerId)/);
    assert.doesNotMatch(walletRead, /req\.params\.(userId|walletId|transactionId|ledgerId)/);
  }
});

test("organization wallet storage predicates are enforced by SQL joins", () => {
  const start = storageSource.indexOf("async getUserBalanceForOrganization(");
  const end = storageSource.indexOf("async createCreditLedgerEvent(", start);
  const methods = storageSource.slice(start, end);
  assert.match(methods, /innerJoin\(userProfiles/);
  assert.match(methods, /eq\(userProfiles\.organizationId, orgId\)/);
  assert.match(methods, /eq\(walletTransactions\.userId, userId\)/);
});

test("wallet reads have no cache and therefore no cross-tenant cache key", () => {
  const start = storageSource.indexOf("async getUserBalanceForOrganization(");
  const end = storageSource.indexOf("async createCreditLedgerEvent(", start);
  assert.doesNotMatch(storageSource.slice(start, end), /cache|redis|memo/i);
});
