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
const { handleOrgError, resolveOrgIdOrThrow } = await import("../lib/resolve-org-id");
const routesSource = await readFile(new URL("../routes.ts", import.meta.url), "utf8");

function cashoutStatusRoute(): string {
  const start = routesSource.indexOf('app.patch("/api/admin/cashouts/:id/status"');
  const end = routesSource.indexOf('app.get("/api/athletic/programs"', start);
  assert.ok(start >= 0 && end > start, "cashout status route must exist");
  return routesSource.slice(start, end);
}

async function cashoutState(id: string) {
  const [cashout, events] = await Promise.all([
    pool.query("SELECT status, processed_at FROM cashouts WHERE id=$1", [id]),
    pool.query("SELECT count(*)::int n FROM revenue_ledger_events WHERE idempotency_key=$1", [`coach_compensation_paid:${id}`]),
  ]);
  return {
    status: cashout.rows[0]?.status,
    processed: Boolean(cashout.rows[0]?.processed_at),
    events: events.rows[0].n,
  };
}

before(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS revenue_ledger_events,cashouts,coach_profiles,user_profiles,users CASCADE;
    DROP TYPE IF EXISTS revenue_ledger_event_type,cashout_status,user_role CASCADE;
    CREATE TYPE user_role AS ENUM ('CLIENT','COACH','ADMIN','STAFF');
    CREATE TYPE cashout_status AS ENUM ('REQUESTED','PAID','DENIED');
    CREATE TYPE revenue_ledger_event_type AS ENUM (
      'payment_received','revenue_recognized','deferred_revenue_created','deferred_revenue_released',
      'coach_compensation_accrued','coach_compensation_paid','refund_issued','cancellation_reversal','manual_adjustment'
    );
    CREATE TABLE users (id varchar PRIMARY KEY,email varchar,first_name varchar,last_name varchar);
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
    CREATE TABLE cashouts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,coach_id varchar NOT NULL REFERENCES coach_profiles(id),
      amount_cents integer NOT NULL,status cashout_status NOT NULL DEFAULT 'REQUESTED',
      requested_at timestamp DEFAULT now(),processed_at timestamp
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
  await pool.query("TRUNCATE revenue_ledger_events,cashouts,coach_profiles,user_profiles,users CASCADE");
  await pool.query(`INSERT INTO users(id,email,first_name) VALUES
    ('admin-a','admin-a@test.invalid','Admin A'),('admin-b','admin-b@test.invalid','Admin B'),
    ('admin-none','admin-none@test.invalid','No Org'),('coach-a','coach-a@test.invalid','Coach A'),
    ('coach-b','coach-b@test.invalid','Coach B'),('staff-a','staff-a@test.invalid','Staff A'),
    ('client-a','client-a@test.invalid','Client A')`);
  await pool.query(`INSERT INTO user_profiles(user_id,role,organization_id) VALUES
    ('admin-a','ADMIN','org-a'),('admin-b','ADMIN','org-b'),('admin-none','ADMIN',NULL),
    ('coach-a','COACH','org-a'),('coach-b','COACH','org-b'),('staff-a','STAFF','org-a'),
    ('client-a','CLIENT','org-a')`);
  await pool.query(`INSERT INTO coach_profiles(id,user_id,organization_id) VALUES
    ('coach-profile-a','coach-a','org-a'),('coach-profile-b','coach-b','org-b')`);
  await pool.query(`INSERT INTO cashouts(id,coach_id,amount_cents) VALUES
    ('cashout-a','coach-profile-a',1200),('cashout-b','coach-profile-b',2400),
    ('cashout-a-2','coach-profile-a',777)`);
});

after(async () => { await pool.end(); });

test("same-organization ADMIN can mark a cashout PAID with evidence", async () => {
  const result = await storage.updateCashoutStatusForOrganization("org-a", "cashout-a", "PAID", "admin-a");
  assert.equal(result?.status, "PAID");
  assert.deepEqual(await cashoutState("cashout-a"), { status: "PAID", processed: true, events: 1 });
});

test("same-organization DENIED transition writes no paid evidence", async () => {
  const result = await storage.updateCashoutStatusForOrganization("org-a", "cashout-a", "DENIED", "admin-a");
  assert.equal(result?.status, "DENIED");
  assert.deepEqual(await cashoutState("cashout-a"), { status: "DENIED", processed: true, events: 0 });
});

test("Org A ADMIN cannot mutate Org B cashout", async () => {
  assert.equal(await storage.updateCashoutStatusForOrganization("org-a", "cashout-b", "PAID", "admin-a"), undefined);
  assert.deepEqual(await cashoutState("cashout-b"), { status: "REQUESTED", processed: false, events: 0 });
});

test("Org B ADMIN can mutate Org B cashout", async () => {
  assert.equal((await storage.updateCashoutStatusForOrganization("org-b", "cashout-b", "PAID", "admin-b"))?.status, "PAID");
  assert.deepEqual(await cashoutState("cashout-b"), { status: "PAID", processed: true, events: 1 });
});

test("nonexistent cashout has no side effects", async () => {
  assert.equal(await storage.updateCashoutStatusForOrganization("org-a", "missing", "PAID", "admin-a"), undefined);
  assert.deepEqual(await cashoutState("missing"), { status: undefined, processed: false, events: 0 });
});

test("paid evidence failure rolls back cashout status", async () => {
  await pool.query("ALTER TABLE revenue_ledger_events ADD CONSTRAINT injected_failure CHECK (amount_cents <> 777)");
  try {
    await assert.rejects(
      storage.updateCashoutStatusForOrganization("org-a", "cashout-a-2", "PAID", "admin-a"),
      /injected_failure/,
    );
    assert.deepEqual(await cashoutState("cashout-a-2"), { status: "REQUESTED", processed: false, events: 0 });
  } finally {
    await pool.query("ALTER TABLE revenue_ledger_events DROP CONSTRAINT injected_failure");
  }
});

test("repeated PAID transition preserves idempotent evidence semantics", async () => {
  await storage.updateCashoutStatusForOrganization("org-a", "cashout-a", "PAID", "admin-a");
  await storage.updateCashoutStatusForOrganization("org-a", "cashout-a", "PAID", "admin-a");
  assert.deepEqual(await cashoutState("cashout-a"), { status: "PAID", processed: true, events: 1 });
});

test("concurrent cross-tenant attempts cannot bypass ownership", async () => {
  const results = await Promise.all([
    storage.updateCashoutStatusForOrganization("org-a", "cashout-b", "PAID", "admin-a"),
    storage.updateCashoutStatusForOrganization("org-a", "cashout-b", "DENIED", "admin-a"),
  ]);
  assert.deepEqual(results, [undefined, undefined]);
  assert.deepEqual(await cashoutState("cashout-b"), { status: "REQUESTED", processed: false, events: 0 });
});

test("concurrent owners can update only their own organization rows", async () => {
  const [a, b] = await Promise.all([
    storage.updateCashoutStatusForOrganization("org-a", "cashout-a", "PAID", "admin-a"),
    storage.updateCashoutStatusForOrganization("org-b", "cashout-b", "PAID", "admin-b"),
  ]);
  assert.equal(a?.status, "PAID");
  assert.equal(b?.status, "PAID");
  assert.equal((await cashoutState("cashout-a")).events, 1);
  assert.equal((await cashoutState("cashout-b")).events, 1);
});

test("actual route requires authentication and ADMIN only", () => {
  const route = cashoutStatusRoute();
  assert.match(route, /isAuthenticated, requireRole\("ADMIN"\)/);
  assert.doesNotMatch(route, /requireRole\([^)]*(COACH|STAFF|CLIENT)/);
});

test("actual role middleware allows ADMIN and denies COACH/STAFF/CLIENT/unauthenticated", async () => {
  const original = storage.getUserProfile.bind(storage);
  const invoke = async (role: "ADMIN" | "COACH" | "STAFF" | "CLIENT" | null) => {
    (storage as any).getUserProfile = async () => role ? ({ role } as any) : undefined;
    let status = 200;
    let nextCalls = 0;
    const req = role === null ? {} : { user: { id: `${role.toLowerCase()}-a` } };
    const res = { status(code: number) { status = code; return this; }, json() { return this; } };
    await requireRole("ADMIN")(req, res, () => { nextCalls++; });
    return { status, nextCalls };
  };
  try {
    assert.deepEqual(await invoke("ADMIN"), { status: 200, nextCalls: 1 });
    assert.deepEqual(await invoke("COACH"), { status: 403, nextCalls: 0 });
    assert.deepEqual(await invoke("STAFF"), { status: 403, nextCalls: 0 });
    assert.deepEqual(await invoke("CLIENT"), { status: 403, nextCalls: 0 });
    assert.deepEqual(await invoke(null), { status: 401, nextCalls: 0 });
  } finally {
    (storage as any).getUserProfile = original;
  }
});

test("missing actor organization fails closed through the trusted resolver", async () => {
  await assert.rejects(
    resolveOrgIdOrThrow({ user: { id: "admin-none" }, path: "/api/admin/cashouts/cashout-b/status" }),
    /ORG_RESOLUTION_FAILED/,
  );
  assert.deepEqual(await cashoutState("cashout-b"), { status: "REQUESTED", processed: false, events: 0 });
});

test("route maps missing organization to the established 403 response", () => {
  let status = 200;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } };
  assert.equal(handleOrgError(new Error("ORG_RESOLUTION_FAILED"), res), true);
  assert.equal(status, 403);
});

test("route resolves trusted organization before scoped mutation", () => {
  const route = cashoutStatusRoute();
  const resolve = route.indexOf("resolveOrgIdOrThrow(req)");
  const mutate = route.indexOf("updateCashoutStatusForOrganization(");
  assert.ok(resolve > 0 && mutate > resolve);
  assert.doesNotMatch(route, /storage\.updateCashoutStatus\(/);
});

test("client tenant and identity fields cannot redirect cashout authority", () => {
  const route = cashoutStatusRoute();
  assert.doesNotMatch(route, /req\.(body|query)\.(orgId|organizationId|tenantId|userId|coachId)/);
  assert.doesNotMatch(route, /\{[^}]*\b(orgId|organizationId|tenantId|userId|coachId)\b[^}]*\}\s*=\s*req\.body/);
});

test("route preserves PAID and DENIED as the only accepted target statuses", () => {
  const route = cashoutStatusRoute();
  assert.match(route, /\["PAID", "DENIED"\]\.includes\(status\)/);
});

test("route has no provider or notification call after cashout mutation", () => {
  const route = cashoutStatusRoute();
  assert.doesNotMatch(route, /send[A-Z]|notify|onCashoutPaid|stripe|slack/i);
});
