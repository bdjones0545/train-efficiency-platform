/**
 * Cross-organization booking authorization — executing tests.
 *
 * Each route handler under test is lifted verbatim out of server/routes.ts
 * (see helpers/route-handler-harness.ts) and run with its dependencies
 * (storage, org resolver, db) injected, so the assertions are about what the
 * handler DOES with a fake request — not about how its source is spelled.
 *
 * Defects covered (all traced on main @ f370f74):
 *   1. PATCH /api/scheduling/bookings/:id(/status) and POST /api/scheduling/bookings
 *      never compared the booking / client to the caller's organization and
 *      POST had no double-booking check.
 *   2. PATCH /api/bookings/:id/status let any platform ADMIN cancel any org's booking.
 *   3. POST /api/bookings/:id/join had no org-membership check and a
 *      read-then-insert capacity check.
 *   4. POST /api/bookings accepted a coach from org A with a service from org B.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { toZonedTime } from "date-fns-tz";
import { format } from "date-fns";
import { loadRoute, dispatch, asUser, isAuthenticated, stubStorage as shadowStorage } from "./helpers/route-handler-harness";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/no_database_access";

const { storage } = await import("../storage");
const { requireRole, getUserRole } = await import("../lib/require-role");
const { bookingParticipants } = await import("@shared/schema");

const stubStorage = (overrides: Record<string, unknown>) => shadowStorage(storage, overrides);
const toQuery = (q: any) => new PgDialect().sqlToQuery(q);

// ── Fixtures: two organizations ──────────────────────────────────────────────

const ORG_A = "org-a";
const ORG_B = "org-b";

const profiles: Record<string, { userId: string; role: string; organizationId: string | null }> = {
  "staff-a": { userId: "staff-a", role: "STAFF", organizationId: ORG_A },
  "staff-b": { userId: "staff-b", role: "STAFF", organizationId: ORG_B },
  "admin-a": { userId: "admin-a", role: "ADMIN", organizationId: ORG_A },
  "admin-b": { userId: "admin-b", role: "ADMIN", organizationId: ORG_B },
  "client-a": { userId: "client-a", role: "CLIENT", organizationId: ORG_A },
  "client-b": { userId: "client-b", role: "CLIENT", organizationId: ORG_B },
  "client-new": { userId: "client-new", role: "CLIENT", organizationId: null },
};

const coaches: Record<string, any> = {
  "coach-a": { id: "coach-a", userId: "coach-user-a", organizationId: ORG_A, timezone: "America/New_York", user: { firstName: "A", lastName: "Coach", email: "a@example.test" } },
  "coach-b": { id: "coach-b", userId: "coach-user-b", organizationId: ORG_B, timezone: "America/New_York", user: { firstName: "B", lastName: "Coach", email: "b@example.test" } },
};

const services: Record<string, any> = {
  "svc-a": { id: "svc-a", organizationId: ORG_A, name: "Strength Session", durationMin: 60, sessionType: "ONE_ON_ONE", isBookableByClient: true },
  "svc-b": { id: "svc-b", organizationId: ORG_B, name: "Speed Session", durationMin: 60, sessionType: "ONE_ON_ONE", isBookableByClient: true },
};

const START = new Date("2026-10-05T14:00:00.000Z");
const END = new Date("2026-10-05T15:00:00.000Z");

function bookingA(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-a", organizationId: ORG_A, clientId: "client-a", coachId: "coach-a", serviceId: "svc-a",
    startAt: START, endAt: END, status: "CONFIRMED", maxParticipants: null, notes: "", location: "",
    ...overrides,
  };
}

const resolveOrgIdOrNull = async (req: any) => profiles[req.user?.claims?.sub]?.organizationId ?? null;
const isOrgMember = async (req: any, orgId: string) => (await resolveOrgIdOrNull(req)) === orgId;

function baseStorage(booking: any, calls: Record<string, any[]>) {
  const record = (name: string) => (...args: any[]) => { (calls[name] ??= []).push(args); return Promise.resolve({ ...booking, ...(args[args.length - 1] ?? {}) }); };
  return {
    getUserProfile: async (userId: string) => profiles[userId],
    getCoachProfile: async (id: string) => coaches[id],
    getCoachProfileByUserId: async (userId: string) => Object.values(coaches).find((c) => c.userId === userId),
    getService: async (id: string) => services[id],
    getBooking: async (id: string) => (id === booking.id ? booking : undefined),
    getRedemptionByBookingId: async () => undefined,
    getOverlappingBookings: async () => [],
    getBookingParticipants: async () => [],
    getUser: async (id: string) => ({ id, firstName: "Test", lastName: "User", email: `${id}@example.test` }),
    updateBookingStatus: record("updateBookingStatus"),
    updateBookingStatusForCoach: record("updateBookingStatusForCoach"),
    updateBooking: record("updateBooking"),
    updateBookingForCoach: record("updateBookingForCoach"),
    createBooking: (data: any) => { (calls.createBooking ??= []).push([data]); return Promise.resolve({ id: "booking-new", ...data }); },
    addBookingParticipant: (p: any) => { (calls.addBookingParticipant ??= []).push([p]); return Promise.resolve({ id: "p-new", ...p }); },
  };
}

const updateCalls = (calls: Record<string, any[]>) =>
  ["updateBookingStatus", "updateBookingStatusForCoach", "updateBooking", "updateBookingForCoach"].flatMap((k) => calls[k] ?? []);

// Fire-and-forget notifications after a successful write: swallowed no-ops here.
const quiet = async () => undefined;
const notifiers = {
  getOrgBranding: quiet,
  sendBookingCancellationEmailToClient: quiet,
  sendBookingCancellationEmailToCoach: quiet,
  sendBookingConfirmationToClient: quiet,
  sendBookingNotificationToCoach: quiet,
  sendSms: quiet,
  smsBookingConfirmation: () => "",
  smsCancellation: () => "",
};

const schedulingScope = { isAuthenticated, requireRole, storage };

// ── Defect 1: /api/scheduling/bookings ───────────────────────────────────────

test("PATCH /api/scheduling/bookings/:id/status: staff of another organization get 404 and nothing is updated", async () => {
  const calls: Record<string, any[]> = {};
  const restore = stubStorage(baseStorage(bookingA(), calls));
  try {
    const route = loadRoute("patch", "/api/scheduling/bookings/:id/status", schedulingScope);
    const res = await dispatch(route, asUser("staff-b", { params: { id: "booking-a" }, body: { status: "CANCELLED" } }));
    assert.equal(res.statusCode, 404);
    assert.deepEqual(updateCalls(calls), [], "an org-B staff member must not update an org-A booking");
  } finally { restore(); }
});

test("PATCH /api/scheduling/bookings/:id/status: a legacy booking with no organizationId is owned by its coach's org", async () => {
  const calls: Record<string, any[]> = {};
  const restore = stubStorage(baseStorage(bookingA({ organizationId: null }), calls));
  try {
    const route = loadRoute("patch", "/api/scheduling/bookings/:id/status", schedulingScope);
    const foreign = await dispatch(route, asUser("staff-b", { params: { id: "booking-a" }, body: { status: "CANCELLED" } }));
    assert.equal(foreign.statusCode, 404);
    assert.deepEqual(updateCalls(calls), []);
    const own = await dispatch(route, asUser("staff-a", { params: { id: "booking-a" }, body: { status: "CANCELLED" } }));
    assert.equal(own.statusCode, 200);
    assert.equal(updateCalls(calls).length, 1);
  } finally { restore(); }
});

test("PATCH /api/scheduling/bookings/:id/status: same-organization staff still update, scoped to the booking's coach", async () => {
  const calls: Record<string, any[]> = {};
  const restore = stubStorage(baseStorage(bookingA(), calls));
  try {
    const route = loadRoute("patch", "/api/scheduling/bookings/:id/status", schedulingScope);
    const res = await dispatch(route, asUser("staff-a", { params: { id: "booking-a" }, body: { status: "CANCELLED" } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.updateBookingStatusForCoach, [["booking-a", "coach-a", "CANCELLED"]]);
    assert.equal(calls.updateBookingStatus, undefined, "the unscoped update must no longer be used");
  } finally { restore(); }
});

test("PATCH /api/scheduling/bookings/:id: staff of another organization get 404 and nothing is updated", async () => {
  const calls: Record<string, any[]> = {};
  const restore = stubStorage(baseStorage(bookingA(), calls));
  try {
    const route = loadRoute("patch", "/api/scheduling/bookings/:id", schedulingScope);
    const res = await dispatch(route, asUser("staff-b", { params: { id: "booking-a" }, body: { notes: "hijacked", clientId: "client-b" } }));
    assert.equal(res.statusCode, 404);
    assert.deepEqual(updateCalls(calls), [], "an org-B staff member must not edit an org-A booking");
  } finally { restore(); }
});

test("PATCH /api/scheduling/bookings/:id: a booking cannot be re-pointed at another organization's service or client", async () => {
  const calls: Record<string, any[]> = {};
  const restore = stubStorage(baseStorage(bookingA(), calls));
  try {
    const route = loadRoute("patch", "/api/scheduling/bookings/:id", schedulingScope);
    const foreignClient = await dispatch(route, asUser("staff-a", { params: { id: "booking-a" }, body: { clientId: "client-b" } }));
    assert.equal(foreignClient.statusCode, 404);
    const foreignService = await dispatch(route, asUser("staff-a", { params: { id: "booking-a" }, body: { serviceId: "svc-b" } }));
    assert.equal(foreignService.statusCode, 404);
    const unknownClient = await dispatch(route, asUser("staff-a", { params: { id: "booking-a" }, body: { clientId: "nobody" } }));
    assert.equal(unknownClient.statusCode, 404);
    assert.deepEqual(updateCalls(calls), []);
  } finally { restore(); }
});

test("PATCH /api/scheduling/bookings/:id: same-organization edits go through, scoped to the booking's coach, with an overlap check", async () => {
  const calls: Record<string, any[]> = {};
  const overlapArgs: any[] = [];
  const restore = stubStorage({
    ...baseStorage(bookingA(), calls),
    getOverlappingBookings: async (...args: any[]) => { overlapArgs.push(args); return overlapArgs.length > 1 ? [bookingA({ id: "other" })] : []; },
  });
  try {
    const route = loadRoute("patch", "/api/scheduling/bookings/:id", schedulingScope);
    const newStart = "2026-10-06T14:00:00.000Z";
    const newEnd = "2026-10-06T15:00:00.000Z";
    const ok = await dispatch(route, asUser("staff-a", { params: { id: "booking-a" }, body: { startAt: newStart, endAt: newEnd, clientId: "client-a", serviceId: "svc-a", notes: "moved" } }));
    assert.equal(ok.statusCode, 200);
    assert.equal(calls.updateBookingForCoach?.length, 1);
    const [id, coachId, data] = calls.updateBookingForCoach[0];
    assert.equal(id, "booking-a");
    assert.equal(coachId, "coach-a");
    assert.deepEqual(data, { startAt: new Date(newStart), endAt: new Date(newEnd), notes: "moved", serviceId: "svc-a", clientId: "client-a" });
    assert.deepEqual(overlapArgs[0], ["coach-a", new Date(newStart), new Date(newEnd), "booking-a"]);

    const clash = await dispatch(route, asUser("staff-a", { params: { id: "booking-a" }, body: { startAt: newStart, endAt: newEnd } }));
    assert.equal(clash.statusCode, 409);
    assert.equal(calls.updateBookingForCoach.length, 1, "an overlapping reschedule must not be written");
  } finally { restore(); }
});

test("POST /api/scheduling/bookings: rejects a client of another organization and an overlapping slot", async () => {
  const calls: Record<string, any[]> = {};
  let overlap: any[] = [];
  const restore = stubStorage({ ...baseStorage(bookingA(), calls), getOverlappingBookings: async () => overlap });
  try {
    const route = loadRoute("post", "/api/scheduling/bookings", schedulingScope);
    const body = { coachId: "coach-a", serviceId: "svc-a", startAt: START.toISOString(), endAt: END.toISOString() };

    const foreignClient = await dispatch(route, asUser("staff-a", { body: { ...body, clientId: "client-b" } }));
    assert.equal(foreignClient.statusCode, 400);
    assert.equal(calls.createBooking, undefined, "a client of org B must not be booked into org A");

    overlap = [bookingA({ id: "other" })];
    const clash = await dispatch(route, asUser("staff-a", { body: { ...body, clientId: "client-a" } }));
    assert.equal(clash.statusCode, 409);
    assert.equal(calls.createBooking, undefined, "a double booking must not be created");

    overlap = [];
    const ok = await dispatch(route, asUser("staff-a", { body: { ...body, clientId: "client-a" } }));
    assert.equal(ok.statusCode, 200);
    assert.equal(calls.createBooking?.length, 1);
    assert.equal(calls.createBooking[0][0].organizationId, ORG_A);
  } finally { restore(); }
});

// ── Defect 2: PATCH /api/bookings/:id/status ─────────────────────────────────

test("PATCH /api/bookings/:id/status: an ADMIN of another organization cannot cancel; the owning org's admin can", async () => {
  const calls: Record<string, any[]> = {};
  const restore = stubStorage(baseStorage(bookingA(), calls));
  try {
    const route = loadRoute("patch", "/api/bookings/:id/status", { isAuthenticated, storage, getUserRole, resolveOrgIdOrNull, ...notifiers });
    const foreign = await dispatch(route, asUser("admin-b", { params: { id: "booking-a" }, body: { status: "CANCELLED" } }));
    assert.equal(foreign.statusCode, 403);
    assert.deepEqual(updateCalls(calls), [], "an org-B admin must not cancel an org-A booking");

    const own = await dispatch(route, asUser("admin-a", { params: { id: "booking-a" }, body: { status: "CANCELLED" } }));
    assert.equal(own.statusCode, 200);
    assert.deepEqual(calls.updateBookingStatus, [["booking-a", "CANCELLED"]]);

    const owner = await dispatch(route, asUser("client-a", { params: { id: "booking-a" }, body: { status: "CANCELLED" } }));
    assert.equal(owner.statusCode, 200, "the booking's own client can still cancel");
  } finally { restore(); }
});

// ── Defect 3: POST /api/bookings/:id/join ────────────────────────────────────

function fakeDb(existing: Array<{ userId: string; participantName: string | null }>, log: { executed: any[]; inserted: any[]; transactions: number }) {
  return {
    transaction: async (fn: (tx: any) => Promise<any>) => {
      log.transactions += 1;
      const tx = {
        execute: async (q: any) => {
          const { sql: text, params } = toQuery(q);
          log.executed.push({ text: text.replace(/\s+/g, " ").trim(), params });
          return { rows: /pg_advisory_xact_lock/.test(text) ? [] : existing };
        },
        insert: () => ({ values: (rows: any[]) => ({ returning: async () => { log.inserted.push(...rows); return rows.map((r, i) => ({ id: `p-${i}`, ...r })); } }) }),
      };
      return fn(tx);
    },
  };
}

const joinScope = (db: any) => ({ isAuthenticated, storage, isOrgMember, db, sql, bookingParticipants, ...notifiers });

test("POST /api/bookings/:id/join: a member of another organization is refused before any write", async () => {
  const calls: Record<string, any[]> = {};
  const log = { executed: [] as any[], inserted: [] as any[], transactions: 0 };
  const restore = stubStorage(baseStorage(bookingA({ maxParticipants: 4 }), calls));
  try {
    const route = loadRoute("post", "/api/bookings/:id/join", joinScope(fakeDb([], log)));
    const res = await dispatch(route, asUser("client-b", { params: { id: "booking-a" }, body: {} }));
    assert.equal(res.statusCode, 403);
    assert.equal(log.transactions, 0);
    assert.deepEqual(log.inserted, []);
    assert.equal(calls.addBookingParticipant, undefined, "org-B client must not be added to an org-A session");
  } finally { restore(); }
});

test("POST /api/bookings/:id/join: a booking with no organization is joinable by nobody", async () => {
  const calls: Record<string, any[]> = {};
  const log = { executed: [] as any[], inserted: [] as any[], transactions: 0 };
  const restore = stubStorage(baseStorage(bookingA({ organizationId: null, maxParticipants: 4 }), calls));
  try {
    const route = loadRoute("post", "/api/bookings/:id/join", joinScope(fakeDb([], log)));
    const res = await dispatch(route, asUser("client-a", { params: { id: "booking-a" }, body: {} }));
    assert.equal(res.statusCode, 403);
    assert.equal(log.transactions, 0);
    assert.equal(calls.addBookingParticipant, undefined);
  } finally { restore(); }
});

test("POST /api/bookings/:id/join: capacity is checked and the row inserted under an advisory lock in one transaction", async () => {
  const calls: Record<string, any[]> = {};
  const log = { executed: [] as any[], inserted: [] as any[], transactions: 0 };
  const restore = stubStorage(baseStorage(bookingA({ maxParticipants: 2 }), calls));
  try {
    const route = loadRoute("post", "/api/bookings/:id/join", joinScope(fakeDb([{ userId: "someone", participantName: null }], log)));
    const res = await dispatch(route, asUser("client-a", { params: { id: "booking-a" }, body: {} }));
    assert.equal(res.statusCode, 200);
    assert.equal(log.transactions, 1);
    assert.match(log.executed[0].text, /^SELECT pg_advisory_xact_lock\(hashtext\(\$1\)\)$/);
    assert.deepEqual(log.executed[0].params, ["booking-join:booking-a"]);
    assert.match(log.executed[1].text, /FROM booking_participants WHERE booking_id = \$1/);
    assert.deepEqual(log.inserted, [{ bookingId: "booking-a", userId: "client-a" }]);
    assert.equal(calls.addBookingParticipant, undefined, "the insert must happen inside the locked transaction, not through the unlocked storage call");
  } finally { restore(); }
});

test("POST /api/bookings/:id/join: a session that is full inside the lock is rejected without an insert", async () => {
  const calls: Record<string, any[]> = {};
  const log = { executed: [] as any[], inserted: [] as any[], transactions: 0 };
  const restore = stubStorage({ ...baseStorage(bookingA({ maxParticipants: 2 }), calls), getBookingParticipants: async () => [] });
  try {
    const full = [{ userId: "u1", participantName: null }, { userId: "u2", participantName: null }];
    const route = loadRoute("post", "/api/bookings/:id/join", joinScope(fakeDb(full, log)));
    const res = await dispatch(route, asUser("client-a", { params: { id: "booking-a" }, body: {} }));
    assert.equal(res.statusCode, 409);
    assert.deepEqual(log.inserted, []);
    assert.equal(calls.addBookingParticipant, undefined);
  } finally { restore(); }
});

// ── Defect 4: POST /api/bookings (client self-booking) ───────────────────────

const allDayBlocks = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: "00:00:00", endTime: "23:59:00" }));

function clientBookingStorage(calls: Record<string, any[]>) {
  return {
    ...baseStorage(bookingA(), calls),
    getAvailabilityBlocks: async () => allDayBlocks,
    hasUsedFreeSession: async () => false,
    getUserSubscriptions: async () => [],
    ensureUserOrgPreferences: async () => ({}),
  };
}

const clientBookingScope = { isAuthenticated, storage, resolveOrgIdOrNull, toZonedTime, format, ...notifiers };

test("POST /api/bookings: a coach and a service from different organizations cannot be combined", async () => {
  const calls: Record<string, any[]> = {};
  const restore = stubStorage(clientBookingStorage(calls));
  try {
    const route = loadRoute("post", "/api/bookings", clientBookingScope);
    const res = await dispatch(route, asUser("client-new", { body: { coachId: "coach-a", serviceId: "svc-b", startAt: START.toISOString(), endAt: END.toISOString() } }));
    assert.equal(res.statusCode, 400);
    assert.equal(calls.createBooking, undefined, "no booking may pair org A's coach with org B's service");
  } finally { restore(); }
});

test("POST /api/bookings: a caller who already belongs to an organization cannot book a coach outside it", async () => {
  const calls: Record<string, any[]> = {};
  const restore = stubStorage(clientBookingStorage(calls));
  try {
    const route = loadRoute("post", "/api/bookings", clientBookingScope);
    const body = { coachId: "coach-a", serviceId: "svc-a", startAt: START.toISOString(), endAt: END.toISOString() };
    const foreign = await dispatch(route, asUser("client-b", { body }));
    assert.equal(foreign.statusCode, 404);
    assert.equal(calls.createBooking, undefined);

    const own = await dispatch(route, asUser("client-a", { body }));
    assert.equal(own.statusCode, 200);
    const fresh = await dispatch(route, asUser("client-new", { body }));
    assert.equal(fresh.statusCode, 200, "a client with no organization yet can still book");
    assert.equal(calls.createBooking?.length, 2);
    for (const [data] of calls.createBooking) assert.equal(data.organizationId, ORG_A);
  } finally { restore(); }
});
