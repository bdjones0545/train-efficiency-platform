import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";

/**
 * server/booking-events.ts upserts one attention item per booking lifecycle
 * event with `.onConflictDoUpdate(...)`. The only unique index on
 * attention_items is the PARTIAL index
 *
 *   attention_items_active_source_unique (org_id, source_id)
 *     WHERE source_id IS NOT NULL AND status IN ('active','snoozed','escalated')
 *
 * (shared/schema.ts, and created at runtime by attention-engine.ts). A conflict
 * target of `source_id` alone matches no unique index, so Postgres raises
 * 42P10 ("there is no unique or exclusion constraint matching the ON CONFLICT
 * specification") on EVERY call — including the very first insert — and
 * trackBookingEvent swallows it. Nothing was ever written.
 *
 * These tests call the real function against the push-built schema.
 */

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const pool = new Pool({ connectionString });
const { trackBookingEvent } = await import("../booking-events");
const { initializeAttentionInfrastructure } = await import("../attention-engine");
const { pool: appPool } = await import("../db");

const orgId = `org-booking-events-${randomUUID()}`;
const captured: string[] = [];
const originalError = console.error;

async function items(sourceId: string) {
  const result = await pool.query(
    `SELECT org_id, source_id, title, body, status, metadata FROM attention_items
      WHERE org_id = $1 AND source_id = $2 ORDER BY created_at`,
    [orgId, sourceId],
  );
  return result.rows;
}

function context(bookingId: string, overrides: Record<string, unknown> = {}) {
  const startAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  return {
    bookingId,
    orgId,
    clientId: "client-1",
    coachId: "coach-1",
    serviceId: "service-1",
    serviceName: "Strength Session",
    startAt,
    endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
    priceCents: 0,
    paymentMethod: null,
    ...overrides,
  };
}

before(async () => {
  // attention_items' partial unique index is created at RUNTIME by
  // server/attention-engine.ts, not by drizzle-kit push, so the test must run
  // the same initializer the server runs at startup before exercising the
  // upsert. (On a push-built database push happens to create it too; calling
  // the initializer makes the test independent of that.)
  await initializeAttentionInfrastructure();

  const index = await pool.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'
      AND tablename = 'attention_items'
      AND indexname = 'attention_items_active_source_unique'`,
  );
  assert.equal(index.rows.length, 1, "the partial unique index the upsert targets must exist");
  assert.match(index.rows[0].indexdef, /\(org_id, source_id\) WHERE/);
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
    originalError(...args);
  };
});

after(async () => {
  console.error = originalError;
  await pool.query(`DELETE FROM attention_items WHERE org_id = $1`, [orgId]);
  await pool.end();
  await appPool.end();
});

test("a booking event persists an attention item (the upsert no longer raises 42P10)", async () => {
  const bookingId = `booking-${randomUUID()}`;
  await trackBookingEvent("booking_created", context(bookingId));

  const rows = await items(`booking-booking_created-${bookingId}`);
  assert.equal(rows.length, 1, `expected one persisted attention item; errors: ${captured.join(" | ")}`);
  assert.equal(rows[0].status, "active");
  assert.match(rows[0].title, /New booking confirmed: Strength Session/);
  assert.deepEqual(captured.filter((line) => line.includes("[BookingEvents]")), []);
});

test("the same event fired twice updates the one row instead of erroring or duplicating", async () => {
  const bookingId = `booking-${randomUUID()}`;
  const sourceId = `booking-booking_rescheduled-${bookingId}`;
  await trackBookingEvent("booking_rescheduled", context(bookingId, { serviceName: "Mobility" }));
  await trackBookingEvent("booking_rescheduled", context(bookingId, { serviceName: "Power Clean Clinic" }));

  const rows = await items(sourceId);
  assert.equal(rows.length, 1, "the partial unique index must dedupe the live item");
  assert.match(rows[0].title, /Power Clean Clinic/, "second call must update the existing row");
  assert.equal(rows[0].metadata.serviceName, "Power Clean Clinic");
  assert.deepEqual(captured.filter((line) => line.includes("[BookingEvents]")), []);
});

test("a dismissed item is outside the partial index, so a new event creates a fresh live item", async () => {
  const bookingId = `booking-${randomUUID()}`;
  const sourceId = `booking-booking_cancelled-${bookingId}`;
  await trackBookingEvent("booking_cancelled", context(bookingId));
  await pool.query(
    `UPDATE attention_items SET status = 'dismissed' WHERE org_id = $1 AND source_id = $2`,
    [orgId, sourceId],
  );
  await trackBookingEvent("booking_cancelled", context(bookingId));

  const rows = await items(sourceId);
  assert.deepEqual(rows.map((row) => row.status).sort(), ["active", "dismissed"]);
});

test("the conflict target is scoped by org: two orgs can hold the same source_id", async () => {
  const bookingId = `booking-${randomUUID()}`;
  const sourceId = `booking-booking_no_show-${bookingId}`;
  const otherOrg = `${orgId}-other`;
  await trackBookingEvent("booking_no_show", context(bookingId));
  await trackBookingEvent("booking_no_show", context(bookingId, { orgId: otherOrg }));

  const result = await pool.query(
    `SELECT org_id FROM attention_items WHERE source_id = $1 ORDER BY org_id`,
    [sourceId],
  );
  assert.deepEqual(result.rows.map((row) => row.org_id), [orgId, otherOrg].sort());
  await pool.query(`DELETE FROM attention_items WHERE org_id = $1`, [otherOrg]);
});
