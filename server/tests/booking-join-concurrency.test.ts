/**
 * POST /api/bookings/:id/join — concurrent joiners cannot overbook a group
 * session. Runs the real handler (lifted from server/routes.ts) against a
 * disposable PostgreSQL: twelve members join a 3-spot session at once and
 * exactly three rows may exist afterwards. Before the advisory-lock fix the
 * read-then-insert capacity check let every joiner see an empty session.
 */

import assert from "node:assert/strict";
import { test, after } from "node:test";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
process.env.OPENAI_API_KEY ??= "sk-test-sentinel-tests-must-not-call-openai";

const { sql } = await import("drizzle-orm");
const { db, pool } = await import("../db");
const { storage } = await import("../storage");
const { bookingParticipants } = await import("@shared/schema");
const { loadRoute, dispatch, asUser, isAuthenticated } = await import("./helpers/route-handler-harness");

const RUN = `join-race-${Date.now()}`;
const ORG = `${RUN}-org`;
const COACH_USER = `${RUN}-coach-user`;
const COACH = `${RUN}-coach`;
const SERVICE = `${RUN}-service`;
const BOOKING = `${RUN}-booking`;
const MAX = 3;
const JOINERS = Array.from({ length: 12 }, (_, i) => `${RUN}-member-${i}`);

async function seed() {
  for (const id of [COACH_USER, ...JOINERS]) {
    await db.execute(sql`INSERT INTO users (id, email, first_name, last_name) VALUES (${id}, ${`${id}@example.test`}, ${"Test"}, ${id})`);
  }
  await db.execute(sql`INSERT INTO coach_profiles (id, user_id, organization_id) VALUES (${COACH}, ${COACH_USER}, ${ORG})`);
  await db.execute(sql`INSERT INTO services (id, name, duration_min, session_type, organization_id) VALUES (${SERVICE}, ${"Group Session"}, ${60}, ${"GROUP"}::session_type, ${ORG})`);
  await db.execute(sql`
    INSERT INTO bookings (id, organization_id, client_id, coach_id, service_id, start_at, end_at, status, max_participants)
    VALUES (${BOOKING}, ${ORG}, ${COACH_USER}, ${COACH}, ${SERVICE}, ${new Date("2026-11-02T15:00:00Z")}, ${new Date("2026-11-02T16:00:00Z")}, ${"CONFIRMED"}::booking_status, ${MAX})
  `);
}

async function cleanup() {
  await db.execute(sql`DELETE FROM booking_participants WHERE booking_id = ${BOOKING}`);
  await db.execute(sql`DELETE FROM bookings WHERE id = ${BOOKING}`);
  await db.execute(sql`DELETE FROM services WHERE id = ${SERVICE}`);
  await db.execute(sql`DELETE FROM coach_profiles WHERE id = ${COACH}`);
  await db.execute(sql`DELETE FROM users WHERE id LIKE ${`${RUN}-%`}`);
}

after(async () => {
  await cleanup();
  await pool.end();
});

test("twelve simultaneous joins to a 3-spot session leave exactly 3 participants", async () => {
  await seed();
  const route = loadRoute("post", "/api/bookings/:id/join", {
    isAuthenticated,
    storage,
    db,
    sql,
    bookingParticipants,
    // Membership is proven by the unit suite; here every joiner is a member.
    isOrgMember: async () => true,
    getOrgBranding: async () => undefined,
  });

  const responses = await Promise.all(
    JOINERS.map((userId) => dispatch(route, asUser(userId, { params: { id: BOOKING }, body: {} }))),
  );

  const statuses = responses.map((r) => r.statusCode).sort((a, b) => a - b);
  const countRes: any = await db.execute(sql`SELECT count(*)::int AS cnt FROM booking_participants WHERE booking_id = ${BOOKING}`);
  const rows = Array.isArray(countRes) ? countRes : countRes?.rows ?? [];
  const stored = Number(rows[0]?.cnt);

  assert.equal(stored, MAX, `expected ${MAX} participants, found ${stored} (statuses: ${statuses.join(",")})`);
  assert.equal(statuses.filter((s) => s === 200).length, MAX, `exactly ${MAX} joiners may succeed`);
  assert.equal(statuses.filter((s) => s === 409).length, JOINERS.length - MAX, "everyone else is told the session is full");
});
