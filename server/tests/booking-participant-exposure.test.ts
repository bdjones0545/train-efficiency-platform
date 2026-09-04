import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { toPublicParticipant, toPublicParticipants } from "../lib/participant-visibility";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

/**
 * Every column of the real `users` table, plus a fabricated future one.
 * If the projection ever becomes a denylist, the fabricated column leaks and
 * this test says so.
 */
function fullUserRow() {
  return {
    id: "user-1",
    email: "athlete@example.test",
    firstName: "Dana",
    lastName: "Fletcher",
    passwordHash: "$2b$10$notarealhash",
    profileImageUrl: "https://example.test/dana.png",
    phone: "+15555550100",
    notes: "knee rehab, mondays only",
    balanceCents: 4200,
    stripeCustomerId: "cus_123",
    lastSignInAt: new Date("2026-09-01"),
    weeklyReminderEnabled: true,
    lastReminderSentAt: null,
    passwordResetToken: "live-reset-token-abc123",
    passwordResetTokenExpires: new Date("2099-01-01"),
    unsubscribeToken: "unsub-xyz",
    notificationPreferences: { email: true },
    smsOptIn: true,
    smsOptInAt: null,
    smsOptOutAt: null,
    smsConsentSource: "signup",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    aFutureColumnNobodyThoughtAbout: "should never be serialized",
  };
}

function participantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "participant-1",
    bookingId: "booking-1",
    userId: "user-1",
    participantName: null,
    joinedAt: new Date("2026-09-02"),
    user: fullUserRow(),
    ...overrides,
  };
}

const MUST_NEVER_APPEAR = [
  "passwordHash",
  "passwordResetToken",
  "passwordResetTokenExpires",
  "email",
  "phone",
  "notes",
  "balanceCents",
  "stripeCustomerId",
  "unsubscribeToken",
  "notificationPreferences",
  "lastSignInAt",
  "aFutureColumnNobodyThoughtAbout",
];

test("the projected user is an allowlist of exactly four fields", () => {
  const projected = toPublicParticipant(participantRow());
  assert.deepEqual(Object.keys(projected.user!).sort(), [
    "firstName",
    "id",
    "lastName",
    "profileImageUrl",
  ]);
});

test("no credential or contact detail survives the projection", () => {
  const projected = toPublicParticipant(participantRow());
  const serialized = JSON.stringify(projected);

  for (const field of MUST_NEVER_APPEAR) {
    assert.ok(!(field in (projected.user as any)), `${field} must not be on the projected user`);
  }
  // Belt and braces: the values must not appear anywhere in the payload either.
  for (const value of ["notarealhash", "live-reset-token-abc123", "athlete@example.test", "+15555550100", "cus_123", "unsub-xyz", "knee rehab"]) {
    assert.ok(!serialized.includes(value), `payload still contains ${value}`);
  }
});

test("the roster keeps what the UI renders", () => {
  const projected = toPublicParticipant(participantRow());
  assert.equal(projected.user!.firstName, "Dana");
  assert.equal(projected.user!.lastName, "Fletcher");
  assert.equal(projected.user!.profileImageUrl, "https://example.test/dana.png");
  assert.equal(projected.id, "participant-1");
  assert.equal(projected.userId, "user-1");
});

test("a guest registered by name, with no user row, projects cleanly", () => {
  const projected = toPublicParticipant(
    participantRow({ participantName: "Younger sibling", user: null }),
  );
  assert.equal(projected.participantName, "Younger sibling");
  assert.equal(projected.user, null);
});

test("participant fields are themselves an allowlist", () => {
  const projected = toPublicParticipant(
    participantRow({ internalNote: "not for the wire" } as any),
  );
  assert.deepEqual(Object.keys(projected).sort(), [
    "bookingId",
    "id",
    "joinedAt",
    "participantName",
    "user",
    "userId",
  ]);
});

test("the list form projects every row and tolerates an empty roster", () => {
  const projected = toPublicParticipants([participantRow(), participantRow({ id: "participant-2" })]);
  assert.equal(projected.length, 2);
  for (const row of projected) {
    assert.ok(!("email" in (row.user as any)));
  }
  assert.deepEqual(toPublicParticipants([]), []);
  assert.deepEqual(toPublicParticipants(undefined as any), []);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

test("the participants route never serializes the raw join", () => {
  const routes = read("server", "routes.ts");
  const start = routes.indexOf('app.get("/api/bookings/:id/participants"');
  assert.ok(start >= 0, "route not found");
  const block = routes.slice(start, routes.indexOf("app.", start + 10));

  assert.match(block, /toPublicParticipants\(/);
  assert.doesNotMatch(
    block,
    /res\.json\(participants\)/,
    "returning the storage result verbatim ships password reset tokens",
  );
});

test("this is still the only route that serializes participant rows", () => {
  // If another route starts returning participants, it needs the projection
  // too — this fails so nobody has to notice on their own.
  const routes = read("server", "routes.ts");
  const raw = [...routes.matchAll(/res\.json\(\s*participants\s*\)/g)];
  assert.equal(raw.length, 0, "a route is serializing participants without projecting");
});
