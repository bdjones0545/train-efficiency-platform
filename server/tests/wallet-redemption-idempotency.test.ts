import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";

// Live-DB proof that the money-moving paths are idempotent under concurrency:
//   (1) creditWallet     — N concurrent credits for one Stripe payment → one CREDIT row
//   (2) executeRedemption — concurrent redemptions of one booking → one redemption,
//                          one DEBIT, one balance decrement, one session decrement
//   (3) cashouts          — one atomic request per coach; REQUESTED→PAID/DENIED only
// The tables below are deliberately built WITHOUT the 0022 unique indexes: the
// advisory-lock transactions must hold on their own, because production may hold
// duplicate rows that make the index unbuildable. A later test adds the indexes
// (the belt) and re-runs, and the migration itself is exercised against duplicates.

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const pool = new Pool({ connectionString });
const { storage, CashoutTransitionError } = await import("../storage");

const CLIENT = "client-a";
const COACH_USER = "coach-a";
const COACH_PROFILE = "coach-profile-a";
const OTHER_COACH_PROFILE = "coach-profile-b";

async function walletState(userId: string) {
  const [user, rows] = await Promise.all([
    pool.query("SELECT balance_cents FROM users WHERE id=$1", [userId]),
    pool.query("SELECT type, count(*)::int n FROM wallet_transactions WHERE user_id=$1 GROUP BY type ORDER BY type", [userId]),
  ]);
  const byType = Object.fromEntries(rows.rows.map((row) => [row.type, row.n]));
  return { balance: Number(user.rows[0]?.balance_cents ?? 0), credits: byType.CREDIT ?? 0, debits: byType.DEBIT ?? 0 };
}

async function redemptionRows(bookingId: string) {
  return (await pool.query("SELECT id, coach_id, amount_cents, payout_status FROM redemptions WHERE booking_id=$1", [bookingId])).rows;
}

async function createIndexes() {
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_stripe_payment_intent_id_unique
      ON wallet_transactions (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_stripe_session_id_unique
      ON wallet_transactions (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS redemptions_booking_id_unique ON redemptions (booking_id);
  `);
}

async function dropIndexes() {
  await pool.query(`
    DROP INDEX IF EXISTS wallet_transactions_stripe_payment_intent_id_unique;
    DROP INDEX IF EXISTS wallet_transactions_stripe_session_id_unique;
    DROP INDEX IF EXISTS redemptions_booking_id_unique;
  `);
}

before(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS revenue_ledger_events,user_subscriptions,cashouts,redemptions,wallet_transactions,coach_profiles,user_profiles,users CASCADE;
    DROP TYPE IF EXISTS revenue_ledger_event_type,cashout_status,payout_status,wallet_tx_type,user_role CASCADE;
    CREATE TYPE user_role AS ENUM ('CLIENT','COACH','ADMIN','STAFF');
    CREATE TYPE wallet_tx_type AS ENUM ('CREDIT','DEBIT');
    CREATE TYPE payout_status AS ENUM ('PENDING','SENT','FAILED');
    CREATE TYPE cashout_status AS ENUM ('REQUESTED','PAID','DENIED');
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
    CREATE TABLE coach_profiles (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,user_id varchar NOT NULL UNIQUE REFERENCES users(id),
      coach_email varchar UNIQUE,password_hash text,bio text DEFAULT '',specialties text[] DEFAULT '{}',photo_url text,
      timezone varchar DEFAULT 'America/New_York',location text DEFAULT '',is_active boolean DEFAULT true,
      payout_percentage integer,organization_id varchar
    );
    CREATE TABLE wallet_transactions (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,user_id varchar NOT NULL REFERENCES users(id),
      type wallet_tx_type NOT NULL,amount_cents integer NOT NULL,description text,source_type varchar,source_id varchar,
      stripe_session_id varchar,stripe_payment_intent_id varchar,stripe_charge_id varchar,currency varchar DEFAULT 'usd',
      payment_status varchar,livemode boolean NOT NULL DEFAULT false,created_at timestamp DEFAULT now()
    );
    CREATE TABLE redemptions (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,booking_id varchar NOT NULL,
      coach_id varchar NOT NULL REFERENCES coach_profiles(id),redeemed_at timestamp DEFAULT now(),
      payout_status payout_status NOT NULL DEFAULT 'PENDING',amount_cents integer NOT NULL DEFAULT 0
    );
    CREATE TABLE cashouts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,coach_id varchar NOT NULL REFERENCES coach_profiles(id),
      amount_cents integer NOT NULL,status cashout_status NOT NULL DEFAULT 'REQUESTED',
      requested_at timestamp DEFAULT now(),processed_at timestamp
    );
    CREATE TABLE user_subscriptions (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,organization_id varchar NOT NULL,
      user_id varchar NOT NULL REFERENCES users(id),plan_id varchar NOT NULL,stripe_subscription_id varchar,
      stripe_checkout_session_id varchar,status varchar NOT NULL DEFAULT 'active',current_period_start timestamp,
      current_period_end timestamp,sessions_remaining integer,cancel_at_period_end boolean DEFAULT false,
      created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now()
    );
    CREATE TABLE revenue_ledger_events (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id varchar,client_id varchar,
      coach_id varchar,booking_id varchar,redemption_id varchar,event_type revenue_ledger_event_type NOT NULL,
      amount_cents integer NOT NULL DEFAULT 0,reason text,source_action varchar,created_by varchar,
      idempotency_key varchar UNIQUE,created_at timestamp DEFAULT now()
    );
  `);
});

beforeEach(async () => {
  await dropIndexes();
  await pool.query("TRUNCATE revenue_ledger_events,user_subscriptions,cashouts,redemptions,wallet_transactions,coach_profiles,user_profiles,users CASCADE");
  await pool.query(`INSERT INTO users(id,email,first_name,balance_cents) VALUES
    ('${CLIENT}','client-a@test.invalid','Client A',10000),('client-b','client-b@test.invalid','Client B',10000),
    ('${COACH_USER}','coach-a@test.invalid','Coach A',0),('coach-b','coach-b@test.invalid','Coach B',0)`);
  await pool.query(`INSERT INTO user_profiles(user_id,role,organization_id) VALUES
    ('${CLIENT}','CLIENT','org-a'),('client-b','CLIENT','org-a'),('${COACH_USER}','COACH','org-a'),('coach-b','COACH','org-b')`);
  await pool.query(`INSERT INTO coach_profiles(id,user_id,organization_id) VALUES
    ('${COACH_PROFILE}','${COACH_USER}','org-a'),('${OTHER_COACH_PROFILE}','coach-b','org-b')`);
});

after(async () => { await pool.end(); });

// ── (1) creditWallet ────────────────────────────────────────────────────────

test("10 concurrent creditWallet calls for one Stripe payment credit exactly once (no unique index)", async () => {
  const sessionId = `cs_test_${randomUUID()}`;
  const piId = `pi_test_${randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    storage.creditWallet(CLIENT, 4200, "Added $42.00 via Stripe", sessionId, piId)));

  assert.deepEqual(await walletState(CLIENT), { balance: 10000 + 4200, credits: 1, debits: 0 });
  const rows = await pool.query("SELECT count(*)::int n FROM wallet_transactions WHERE stripe_payment_intent_id=$1", [piId]);
  assert.equal(rows.rows[0].n, 1);
  const created = results.filter((r) => !r.alreadyCredited);
  assert.equal(created.length, 1, "exactly one caller performs the credit");
  assert.ok(results.every((r) => r.transaction.id === created[0].transaction.id), "every caller receives the same row");
});

test("callers that know only one of the two Stripe ids still serialize with callers that know both", async () => {
  // verify-session and the webhook know (session, pi); the repair endpoints know only pi;
  // a retry replay may know only the session. Every pair that shares at least one id
  // shares a lock. (A pi-only and a session-only caller share nothing — no lock or index
  // can link them — and no production path pairs those two for one payment.)
  const first = { sessionId: `cs_test_${randomUUID()}`, piId: `pi_test_${randomUUID()}` };
  await Promise.all([
    storage.creditWallet(CLIENT, 1500, "verify-session", first.sessionId, first.piId),
    storage.creditWallet(CLIENT, 1500, "webhook", first.sessionId, first.piId),
    storage.creditWallet(CLIENT, 1500, "repair (pi only)", undefined, first.piId),
  ]);
  assert.deepEqual(await walletState(CLIENT), { balance: 11500, credits: 1, debits: 0 });

  const second = { sessionId: `cs_test_${randomUUID()}`, piId: `pi_test_${randomUUID()}` };
  await Promise.all([
    storage.creditWallet(CLIENT, 2500, "verify-session", second.sessionId, second.piId),
    storage.creditWallet(CLIENT, 2500, "webhook", second.sessionId, second.piId),
    storage.creditWallet(CLIENT, 2500, "retry (session only)", second.sessionId, undefined),
  ]);
  assert.deepEqual(await walletState(CLIENT), { balance: 14000, credits: 2, debits: 0 });
});

test("a credit that already exists (written outside the lock) is reported as alreadyCredited and not re-applied", async () => {
  const piId = `pi_test_${randomUUID()}`;
  await pool.query(`INSERT INTO wallet_transactions(id,user_id,type,amount_cents,stripe_payment_intent_id)
    VALUES('legacy-tx','${CLIENT}','CREDIT',999,$1)`, [piId]);
  const result = await storage.creditWallet(CLIENT, 999, "replay", undefined, piId);
  assert.equal(result.alreadyCredited, true);
  assert.equal(result.transaction.id, "legacy-tx");
  assert.deepEqual(await walletState(CLIENT), { balance: 10000, credits: 1, debits: 0 });
});

test("with the 0022 belt indexes present, 10 concurrent credits still produce one row", async () => {
  await createIndexes();
  const sessionId = `cs_test_${randomUUID()}`;
  const piId = `pi_test_${randomUUID()}`;
  await Promise.all(Array.from({ length: 10 }, () =>
    storage.creditWallet(CLIENT, 700, "Added $7.00 via Stripe", sessionId, piId)));
  assert.deepEqual(await walletState(CLIENT), { balance: 10700, credits: 1, debits: 0 });
});

test("credits for different payments are not serialized against each other", async () => {
  await Promise.all(Array.from({ length: 5 }, (_, i) =>
    storage.creditWallet(CLIENT, 100, `deposit ${i}`, `cs_${randomUUID()}`, `pi_${randomUUID()}`)));
  assert.deepEqual(await walletState(CLIENT), { balance: 10500, credits: 5, debits: 0 });
});

// ── (2) executeRedemption ───────────────────────────────────────────────────

test("two concurrent redemptions of one booking: one redemption row, one DEBIT, one balance decrement", async () => {
  const bookingId = `booking-${randomUUID()}`;
  const input = {
    bookingId,
    coachId: COACH_PROFILE,
    amountCents: 3000,
    walletDebits: [{ userId: CLIENT, amountCents: 6000, description: "Session: Training - Redeemed" }],
  };
  const [a, b] = await Promise.all([storage.executeRedemption(input), storage.executeRedemption(input)]);

  const rows = await redemptionRows(bookingId);
  assert.equal(rows.length, 1, "exactly one redemption row");
  assert.equal(rows[0].amount_cents, 3000);
  assert.deepEqual(await walletState(CLIENT), { balance: 4000, credits: 0, debits: 1 });
  assert.equal([a, b].filter((r) => r.created).length, 1, "exactly one caller creates");
  assert.equal(a.redemption.id, b.redemption.id, "the loser receives the winner's row");
});

test("semi-private redemption debits every participant once even under concurrent submits", async () => {
  const bookingId = `booking-${randomUUID()}`;
  const input = {
    bookingId,
    coachId: COACH_PROFILE,
    amountCents: 5000,
    walletDebits: [
      { userId: CLIENT, amountCents: 2500, description: "Semi-Private (1 spot) - Redeemed" },
      { userId: "client-b", amountCents: 5000, description: "Semi-Private (2 spots) - Redeemed" },
    ],
  };
  await Promise.all(Array.from({ length: 4 }, () => storage.executeRedemption(input)));
  assert.equal((await redemptionRows(bookingId)).length, 1);
  assert.deepEqual(await walletState(CLIENT), { balance: 7500, credits: 0, debits: 1 });
  assert.deepEqual(await walletState("client-b"), { balance: 5000, credits: 0, debits: 1 });
});

test("subscription redemption decrements sessionsRemaining exactly once under concurrent submits", async () => {
  const bookingId = `booking-${randomUUID()}`;
  await pool.query(`INSERT INTO user_subscriptions(id,organization_id,user_id,plan_id,status,sessions_remaining)
    VALUES('sub-a','org-a','${CLIENT}','plan-a','active',4)`);
  const input = {
    bookingId,
    coachId: COACH_PROFILE,
    amountCents: 2000,
    walletDebits: [],
    subscriptionDecrement: { clientId: CLIENT, planId: "plan-a" },
  };
  const results = await Promise.all([storage.executeRedemption(input), storage.executeRedemption(input)]);
  const winner = results.find((r) => r.created);
  assert.ok(winner && winner.created);
  assert.deepEqual(winner.subscription, { id: "sub-a", sessionsAfter: 3 });
  assert.equal((await pool.query("SELECT sessions_remaining FROM user_subscriptions WHERE id='sub-a'")).rows[0].sessions_remaining, 3);
  assert.equal((await redemptionRows(bookingId)).length, 1);
  assert.deepEqual(await walletState(CLIENT), { balance: 10000, credits: 0, debits: 0 }, "subscription path never debits the wallet");
});

test("a redemption whose debit fails leaves no redemption row and no balance change", async () => {
  const bookingId = `booking-${randomUUID()}`;
  await pool.query("ALTER TABLE wallet_transactions ADD CONSTRAINT injected_failure CHECK (amount_cents <> 777)");
  try {
    await assert.rejects(storage.executeRedemption({
      bookingId,
      coachId: COACH_PROFILE,
      amountCents: 100,
      walletDebits: [{ userId: CLIENT, amountCents: 777, description: "boom" }],
    }), /injected_failure/);
    assert.equal((await redemptionRows(bookingId)).length, 0);
    assert.deepEqual(await walletState(CLIENT), { balance: 10000, credits: 0, debits: 0 });
  } finally {
    await pool.query("ALTER TABLE wallet_transactions DROP CONSTRAINT injected_failure");
  }
});

test("debitWallet is atomic: a failed balance update leaves no DEBIT row", async () => {
  await pool.query("ALTER TABLE users ADD CONSTRAINT injected_balance_floor CHECK (balance_cents >= 0)");
  try {
    await assert.rejects(storage.debitWallet(CLIENT, 50000, "overdraw", "redemption", "booking-x"), /injected_balance_floor/);
    assert.deepEqual(await walletState(CLIENT), { balance: 10000, credits: 0, debits: 0 });
  } finally {
    await pool.query("ALTER TABLE users DROP CONSTRAINT injected_balance_floor");
  }
});

// ── (3) cashouts ────────────────────────────────────────────────────────────

async function seedPendingRedemptions() {
  await pool.query(`INSERT INTO redemptions(id,booking_id,coach_id,amount_cents,payout_status) VALUES
    ('red-1','b-1','${COACH_PROFILE}',1200,'PENDING'),('red-2','b-2','${COACH_PROFILE}',800,'PENDING'),
    ('red-sent','b-3','${COACH_PROFILE}',5000,'SENT'),('red-other','b-4','${OTHER_COACH_PROFILE}',900,'PENDING')`);
}

async function cashoutState(id: string) {
  const [cashout, events] = await Promise.all([
    pool.query("SELECT status, processed_at FROM cashouts WHERE id=$1", [id]),
    pool.query("SELECT count(*)::int n FROM revenue_ledger_events WHERE idempotency_key=$1", [`coach_compensation_paid:${id}`]),
  ]);
  return { status: cashout.rows[0]?.status, processed: Boolean(cashout.rows[0]?.processed_at), events: events.rows[0].n };
}

test("concurrent cashout requests for one coach create one cashout covering exactly the pending redemptions", async () => {
  await seedPendingRedemptions();
  const results = await Promise.all([storage.requestCashout(COACH_PROFILE), storage.requestCashout(COACH_PROFILE), storage.requestCashout(COACH_PROFILE)]);
  const created = results.filter((r) => r !== undefined);
  assert.equal(created.length, 1, "only one request finds a pending balance");
  assert.equal(created[0]?.amountCents, 2000);
  assert.equal(created[0]?.status, "REQUESTED");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM cashouts WHERE coach_id='${COACH_PROFILE}'`)).rows[0].n, 1);
  const statuses = (await pool.query("SELECT id, payout_status FROM redemptions ORDER BY id")).rows;
  assert.deepEqual(statuses, [
    { id: "red-1", payout_status: "SENT" },
    { id: "red-2", payout_status: "SENT" },
    { id: "red-other", payout_status: "PENDING" },
    { id: "red-sent", payout_status: "SENT" },
  ]);
});

test("cashout request with no pending balance creates nothing", async () => {
  assert.equal(await storage.requestCashout(COACH_PROFILE), undefined);
  assert.equal((await pool.query("SELECT count(*)::int n FROM cashouts")).rows[0].n, 0);
});

test("cashout state machine: REQUESTED→PAID and REQUESTED→DENIED only; decided cashouts are immutable", async () => {
  await pool.query(`INSERT INTO cashouts(id,coach_id,amount_cents) VALUES
    ('co-paid','${COACH_PROFILE}',1200),('co-denied','${COACH_PROFILE}',800),('co-other','${OTHER_COACH_PROFILE}',900)`);

  assert.equal((await storage.updateCashoutStatusForOrganization("org-a", "co-paid", "PAID", "admin-a"))?.status, "PAID");
  assert.deepEqual(await cashoutState("co-paid"), { status: "PAID", processed: true, events: 1 });
  assert.equal((await storage.updateCashoutStatusForOrganization("org-a", "co-denied", "DENIED", "admin-a"))?.status, "DENIED");
  assert.deepEqual(await cashoutState("co-denied"), { status: "DENIED", processed: true, events: 0 });

  for (const [id, next] of [["co-paid", "DENIED"], ["co-paid", "PAID"], ["co-denied", "PAID"], ["co-denied", "DENIED"]] as const) {
    await assert.rejects(
      storage.updateCashoutStatusForOrganization("org-a", id, next, "admin-a"),
      (error: any) => error instanceof CashoutTransitionError && error.cashoutId === id && error.requestedStatus === next,
    );
  }
  assert.deepEqual(await cashoutState("co-paid"), { status: "PAID", processed: true, events: 1 });
  assert.deepEqual(await cashoutState("co-denied"), { status: "DENIED", processed: true, events: 0 });

  // Tenant isolation unchanged: another org's cashout is "not found", never a transition error.
  assert.equal(await storage.updateCashoutStatusForOrganization("org-a", "co-other", "PAID", "admin-a"), undefined);
  assert.equal(await storage.updateCashoutStatusForOrganization("org-a", "missing", "PAID", "admin-a"), undefined);
  assert.deepEqual(await cashoutState("co-other"), { status: "REQUESTED", processed: false, events: 0 });
});

test("concurrent PAID and DENIED decisions on one REQUESTED cashout: exactly one wins", async () => {
  await pool.query(`INSERT INTO cashouts(id,coach_id,amount_cents) VALUES ('co-race','${COACH_PROFILE}',1200)`);
  const outcomes = await Promise.allSettled([
    storage.updateCashoutStatusForOrganization("org-a", "co-race", "PAID", "admin-a"),
    storage.updateCashoutStatusForOrganization("org-a", "co-race", "DENIED", "admin-a"),
  ]);
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const rejected = outcomes.filter((o) => o.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof CashoutTransitionError);
  const state = await cashoutState("co-race");
  assert.ok(state.status === "PAID" || state.status === "DENIED");
  assert.equal(state.events, state.status === "PAID" ? 1 : 0);
});

// ── migration 0022: duplicate-tolerant belt ────────────────────────────────

test("migration 0022 skips an index whose table holds duplicates, creates the others, and is idempotent", async () => {
  const migrationSql = await readFile(new URL("../../migrations/0022_wallet_redemption_idempotency_indexes.sql", import.meta.url), "utf8");
  const schema = `wallet_idem_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const notices: string[] = [];
  const scoped = new Pool({ connectionString, max: 1, options: `-c search_path=${schema}` });
  scoped.on("connect", (client) => client.on("notice", (notice) => notices.push(notice.message ?? "")));
  const indexes = async () => (await scoped.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname", [schema])).rows.map((row) => row.indexname);
  try {
    await scoped.query(`
      CREATE TABLE wallet_transactions (id serial PRIMARY KEY, stripe_payment_intent_id varchar, stripe_session_id varchar);
      CREATE TABLE redemptions (id serial PRIMARY KEY, booking_id varchar NOT NULL);
      INSERT INTO wallet_transactions(stripe_payment_intent_id, stripe_session_id) VALUES
        ('pi_dup','cs_1'),('pi_dup','cs_2'),(NULL,NULL),(NULL,NULL);
      INSERT INTO redemptions(booking_id) VALUES ('b1'),('b2');
    `);

    // Duplicated payment intent: that index is skipped with a NOTICE; the migration does not fail.
    await scoped.query(migrationSql);
    assert.deepEqual(await indexes(), ["redemptions_booking_id_unique", "redemptions_pkey", "wallet_transactions_pkey", "wallet_transactions_stripe_session_id_unique"]);
    assert.equal(notices.filter((n) => n.includes("skipping wallet_transactions_stripe_payment_intent_id_unique")).length, 1);
    assert.equal((await scoped.query("SELECT count(*)::int n FROM wallet_transactions")).rows[0].n, 4, "money rows are never deleted or merged");

    // Re-running with duplicates still present is a no-op that still does not fail.
    await scoped.query(migrationSql);
    assert.equal(notices.filter((n) => n.includes("skipping wallet_transactions_stripe_payment_intent_id_unique")).length, 2);

    // Once a human reconciles the duplicates, the next run creates the remaining index.
    await scoped.query("DELETE FROM wallet_transactions WHERE id = (SELECT max(id) FROM wallet_transactions WHERE stripe_payment_intent_id='pi_dup')");
    await scoped.query(migrationSql);
    assert.deepEqual(await indexes(), [
      "redemptions_booking_id_unique", "redemptions_pkey", "wallet_transactions_pkey",
      "wallet_transactions_stripe_payment_intent_id_unique", "wallet_transactions_stripe_session_id_unique",
    ]);
    await scoped.query(migrationSql);
    assert.equal(notices.filter((n) => n.includes("[0022] skipping")).length, 2, "fully-indexed run emits no [0022] skip notice");
  } finally {
    await scoped.end();
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
});
