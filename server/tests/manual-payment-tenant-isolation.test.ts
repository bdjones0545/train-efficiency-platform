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
const { requireRole } = await import("../lib/require-role");
const { executeManualPaymentForOrganization } = await import("../services/manual-payment-service");
const routesSource = await readFile(new URL("../routes.ts", import.meta.url), "utf8");

function manualPaymentRoute(): string {
  const start = routesSource.indexOf('app.post("/api/coach/manual-payment"');
  const end = routesSource.indexOf('app.get("/api/coach/transactions"', start);
  assert.ok(start >= 0 && end > start, "manual-payment route must exist");
  return routesSource.slice(start, end);
}

async function counts(userId: string) {
  const [user, transactions, events] = await Promise.all([
    pool.query("SELECT balance_cents FROM users WHERE id=$1", [userId]),
    pool.query("SELECT count(*)::int n FROM wallet_transactions WHERE user_id=$1", [userId]),
    pool.query("SELECT count(*)::int n FROM revenue_ledger_events WHERE client_id=$1", [userId]),
  ]);
  return {
    balance: Number(user.rows[0]?.balance_cents ?? 0),
    transactions: transactions.rows[0].n,
    events: events.rows[0].n,
  };
}

before(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS revenue_ledger_events,wallet_transactions,user_profiles,users CASCADE;
    DROP TYPE IF EXISTS revenue_ledger_event_type,wallet_tx_type,user_role CASCADE;
    CREATE TYPE user_role AS ENUM ('CLIENT','COACH','ADMIN','STAFF');
    CREATE TYPE wallet_tx_type AS ENUM ('CREDIT','DEBIT');
    CREATE TYPE revenue_ledger_event_type AS ENUM (
      'payment_received','revenue_recognized','deferred_revenue_created','deferred_revenue_released',
      'coach_compensation_accrued','coach_compensation_paid','refund_issued','cancellation_reversal','manual_adjustment'
    );
    CREATE TABLE users (
      id varchar PRIMARY KEY,email varchar,first_name varchar,last_name varchar,balance_cents integer NOT NULL DEFAULT 0
    );
    CREATE TABLE user_profiles (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,user_id varchar NOT NULL REFERENCES users(id),
      role user_role NOT NULL DEFAULT 'CLIENT',organization_id varchar
    );
    CREATE TABLE wallet_transactions (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,user_id varchar NOT NULL REFERENCES users(id),
      type wallet_tx_type NOT NULL,amount_cents integer NOT NULL,description text,source_type varchar,source_id varchar,
      stripe_session_id varchar,stripe_payment_intent_id varchar,stripe_charge_id varchar,currency varchar DEFAULT 'usd',
      payment_status varchar,livemode boolean NOT NULL DEFAULT false,created_at timestamp DEFAULT now()
    );
    CREATE TABLE revenue_ledger_events (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id varchar,client_id varchar REFERENCES users(id),
      coach_id varchar,booking_id varchar,redemption_id varchar,event_type revenue_ledger_event_type NOT NULL,
      amount_cents integer NOT NULL DEFAULT 0,reason text,source_action varchar,created_by varchar,
      idempotency_key varchar UNIQUE,created_at timestamp DEFAULT now()
    );
  `);
});

beforeEach(async () => {
  await pool.query("TRUNCATE revenue_ledger_events,wallet_transactions,user_profiles,users CASCADE");
  await pool.query(`INSERT INTO users(id,email,first_name,balance_cents) VALUES
    ('admin-a','admin-a@test.invalid','Admin A',0),
    ('coach-a','coach-a@test.invalid','Coach A',0),
    ('user-a','user-a@test.invalid','User A',0),
    ('user-b','user-b@test.invalid','User B',0),
    ('client-a','client-a@test.invalid','Client A',0),
    ('staff-a','staff-a@test.invalid','Staff A',0)`);
  await pool.query(`INSERT INTO user_profiles(user_id,role,organization_id) VALUES
    ('admin-a','ADMIN','org-a'),('coach-a','COACH','org-a'),('user-a','CLIENT','org-a'),
    ('user-b','CLIENT','org-b'),('client-a','CLIENT','org-a'),('staff-a','STAFF','org-a')`);
});

after(async () => { await pool.end(); });

test("same-organization ADMIN credit changes wallet and evidence atomically", async () => {
  const tx = await storage.creditWalletForOrganization("org-a", "user-a", 2500, "Manual payment (Cash)", "admin-a");
  assert.ok(tx);
  assert.deepEqual(await counts("user-a"), { balance: 2500, transactions: 1, events: 1 });
});

test("same-organization COACH credit remains allowed", async () => {
  const tx = await storage.creditWalletForOrganization("org-a", "user-a", 1500, "Manual payment (Venmo)", "coach-a");
  assert.ok(tx);
  assert.deepEqual(await counts("user-a"), { balance: 1500, transactions: 1, events: 1 });
});

test("Org A ADMIN cannot credit Org B user", async () => {
  assert.equal(await storage.creditWalletForOrganization("org-a", "user-b", 2500, "Manual payment", "admin-a"), undefined);
  assert.deepEqual(await counts("user-b"), { balance: 0, transactions: 0, events: 0 });
});

test("Org A COACH cannot credit Org B user", async () => {
  assert.equal(await storage.creditWalletForOrganization("org-a", "user-b", 2500, "Manual payment", "coach-a"), undefined);
  assert.deepEqual(await counts("user-b"), { balance: 0, transactions: 0, events: 0 });
});

test("nonexistent target has no side effects", async () => {
  assert.equal(await storage.creditWalletForOrganization("org-a", "missing", 2500, "Manual payment", "admin-a"), undefined);
  assert.deepEqual(await counts("missing"), { balance: 0, transactions: 0, events: 0 });
});

test("concurrent cross-tenant attempts cannot bypass membership", async () => {
  const results = await Promise.all([
    storage.creditWalletForOrganization("org-a", "user-b", 1000, "Manual payment", "admin-a"),
    storage.creditWalletForOrganization("org-a", "user-b", 1000, "Manual payment", "coach-a"),
  ]);
  assert.deepEqual(results, [undefined, undefined]);
  assert.deepEqual(await counts("user-b"), { balance: 0, transactions: 0, events: 0 });
});

test("concurrent same-organization credits preserve both wallet and evidence writes", async () => {
  const results = await Promise.all([
    storage.creditWalletForOrganization("org-a", "user-a", 1000, "Manual payment", "admin-a"),
    storage.creditWalletForOrganization("org-a", "user-a", 1500, "Manual payment", "coach-a"),
  ]);
  assert.ok(results.every(Boolean));
  assert.deepEqual(await counts("user-a"), { balance: 2500, transactions: 2, events: 2 });
});

test("financial evidence failure rolls back wallet transaction and balance", async () => {
  await pool.query("ALTER TABLE revenue_ledger_events ADD CONSTRAINT injected_failure CHECK (amount_cents <> 777)");
  try {
    await assert.rejects(
      storage.creditWalletForOrganization("org-a", "user-a", 777, "Manual payment", "admin-a"),
      /injected_failure/,
    );
    assert.deepEqual(await counts("user-a"), { balance: 0, transactions: 0, events: 0 });
  } finally {
    await pool.query("ALTER TABLE revenue_ledger_events DROP CONSTRAINT injected_failure");
  }
});

test("actual route keeps existing ADMIN and COACH policy only", () => {
  const route = manualPaymentRoute();
  assert.match(route, /isAuthenticated, requireRole\("COACH", "ADMIN"\)/);
  assert.doesNotMatch(route, /requireRole\([^)]*STAFF/);
  assert.doesNotMatch(route, /requireRole\([^)]*CLIENT/);
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

test("actual route resolves actor organization before scoped mutation", () => {
  const route = manualPaymentRoute();
  const resolve = route.indexOf("resolveOrgIdOrThrow(req)");
  const mutate = route.indexOf("creditWalletForOrganization(");
  assert.ok(resolve > 0 && mutate > resolve);
  assert.doesNotMatch(route, /creditWallet\(userId/);
});

test("client-supplied organization fields cannot redirect the route", () => {
  const route = manualPaymentRoute();
  assert.doesNotMatch(route, /req\.(body|query)\.(orgId|organizationId|tenantId)/);
  assert.doesNotMatch(route, /\{[^}]*\b(orgId|organizationId|tenantId)\b[^}]*\}\s*=\s*req\.body/);
});

test("email invocation remains after successful scoped mutation", () => {
  const route = manualPaymentRoute();
  const mutate = route.indexOf("executeManualPaymentForOrganization(");
  const notFound = route.indexOf("if (!tx)");
  const email = route.indexOf("sendPaymentConfirmationEmail(");
  assert.ok(mutate > 0 && email > mutate && notFound > email);
});

test("successful scoped payment invokes the email dependency once", async () => {
  let emailCalls = 0;
  const tx = { id: "tx-1" } as any;
  assert.equal(await executeManualPaymentForOrganization({ amountCents: 1000, description: "Manual" }, {
    credit: async () => tx,
    getUser: async () => ({ id: "user-a", email: "user-a@test.invalid", firstName: "User" } as any),
    getBalance: async () => 1000,
    getBranding: async () => undefined,
    sendConfirmation: async () => { emailCalls++; },
  }), tx);
  assert.equal(emailCalls, 1);
});

test("tenant denial invokes no email dependency", async () => {
  let emailCalls = 0;
  assert.equal(await executeManualPaymentForOrganization({ amountCents: 1000, description: "Manual" }, {
    credit: async () => undefined,
    getUser: async () => assert.fail("user lookup must not follow tenant denial"),
    getBalance: async () => assert.fail("balance lookup must not follow tenant denial"),
    getBranding: async () => assert.fail("branding lookup must not follow tenant denial"),
    sendConfirmation: async () => { emailCalls++; },
  }), undefined);
  assert.equal(emailCalls, 0);
});

test("financial DB failure invokes no email dependency", async () => {
  let emailCalls = 0;
  await assert.rejects(executeManualPaymentForOrganization({ amountCents: 1000, description: "Manual" }, {
    credit: async () => { throw new Error("injected financial failure"); },
    getUser: async () => assert.fail("user lookup must not follow DB failure"),
    getBalance: async () => assert.fail("balance lookup must not follow DB failure"),
    getBranding: async () => assert.fail("branding lookup must not follow DB failure"),
    sendConfirmation: async () => { emailCalls++; },
  }), /injected financial failure/);
  assert.equal(emailCalls, 0);
});

test("missing actor organization is handled as a fail-closed org error", () => {
  const route = manualPaymentRoute();
  assert.match(route, /resolveOrgIdOrThrow\(req\)/);
  assert.match(route, /handleOrgError\(error, res\)/);
});
