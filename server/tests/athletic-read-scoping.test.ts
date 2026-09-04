import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { projectAthleticBooking, projectAthleticBookings, isAthleticStaff } from "../lib/athletic-visibility";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(serverDir, name), "utf8");

function routeBlock(source: string, method: string, routePath: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.includes(`app.${method}("${routePath}"`));
  assert.ok(start >= 0, `${method.toUpperCase()} ${routePath} not found`);
  let block = lines[start];
  for (let i = start + 1; i < lines.length && !/app\.(get|post|put|patch|delete)\(/.test(lines[i]); i++) {
    block += `\n${lines[i]}`;
  }
  return block;
}

const ORG = "org-1";
const OTHER_ORG = "org-2";

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    organizationId: ORG,
    programId: "program-1",
    date: "2026-09-10",
    timeSlot: "17:00",
    teamName: "Varsity Boys",
    trainingType: "Strength",
    bookedBy: "Dana Fletcher",
    orgUserId: "orguser-1",
    bookerEmail: "dana@example.test",
    recurrenceId: null,
    createdAt: null,
    ...overrides,
  };
}

const IDENTITY_FIELDS = ["bookedBy", "bookerEmail", "orgUserId"];

// ── Projection behaviour ─────────────────────────────────────────────────────

test("anonymous callers get slot occupancy without booker identity", () => {
  const projected = projectAthleticBooking(bookingRow(), null) as Record<string, unknown>;
  for (const field of IDENTITY_FIELDS) {
    assert.ok(!(field in projected), `${field} must not reach an anonymous caller`);
  }
  // Occupancy is still fully visible — the public calendar depends on it.
  assert.equal(projected.timeSlot, "17:00");
  assert.equal(projected.date, "2026-09-10");
  assert.equal(projected.teamName, "Varsity Boys");
  assert.equal(projected.hasAccount, true);
  assert.equal(projected.canCancel, false);
});

test("hasAccount is a boolean signal, never the account id", () => {
  const withAccount = projectAthleticBooking(bookingRow(), null) as Record<string, unknown>;
  const without = projectAthleticBooking(bookingRow({ orgUserId: null }), null) as Record<string, unknown>;
  assert.equal(withAccount.hasAccount, true);
  assert.equal(without.hasAccount, false);
  assert.notEqual(withAccount.hasAccount, "orguser-1");
});

test("staff of the owning organization see the whole row", () => {
  const auth = { userId: "u-coach", orgId: ORG, role: "coach" };
  const projected = projectAthleticBooking(bookingRow(), auth) as Record<string, unknown>;
  assert.equal(projected.bookerEmail, "dana@example.test");
  assert.equal(projected.bookedBy, "Dana Fletcher");
  assert.equal(projected.canCancel, true);
});

test("staff of a different organization are treated as the public", () => {
  const auth = { userId: "u-coach", orgId: OTHER_ORG, role: "coach" };
  const projected = projectAthleticBooking(bookingRow(), auth) as Record<string, unknown>;
  for (const field of IDENTITY_FIELDS) {
    assert.ok(!(field in projected), `${field} leaked across tenants`);
  }
  assert.equal(projected.canCancel, false);
});

test("a member who is not staff does not see identity, but can cancel their own", () => {
  const booker = { userId: "orguser-1", orgId: ORG, role: "athlete" };
  const mine = projectAthleticBooking(bookingRow(), booker) as Record<string, unknown>;
  assert.ok(!("bookerEmail" in mine));
  assert.equal(mine.canCancel, true);

  const someoneElses = projectAthleticBooking(
    bookingRow({ orgUserId: "orguser-2" }),
    booker,
  ) as Record<string, unknown>;
  assert.equal(someoneElses.canCancel, false);
});

test("an anonymous booking cannot be claimed by a same-id member of another org", () => {
  const impostor = { userId: "orguser-1", orgId: OTHER_ORG, role: "athlete" };
  const projected = projectAthleticBooking(bookingRow(), impostor) as Record<string, unknown>;
  assert.equal(projected.canCancel, false);
});

test("a booking with no account holder is cancellable by nobody but staff", () => {
  const anonymousBooking = bookingRow({ orgUserId: null });
  const member = { userId: "orguser-1", orgId: ORG, role: "athlete" };
  assert.equal((projectAthleticBooking(anonymousBooking, member) as any).canCancel, false);
  assert.equal((projectAthleticBooking(anonymousBooking, null) as any).canCancel, false);
  const staff = { userId: "u-admin", orgId: ORG, role: "admin" };
  assert.equal((projectAthleticBooking(anonymousBooking, staff) as any).canCancel, true);
});

test("isAthleticStaff accepts the four staff roles and only the owning org", () => {
  for (const role of ["admin", "coach", "staff", "owner"]) {
    assert.equal(isAthleticStaff({ userId: "u", orgId: ORG, role }, ORG), true, role);
    assert.equal(isAthleticStaff({ userId: "u", orgId: OTHER_ORG, role }, ORG), false, `${role} cross-org`);
  }
  assert.equal(isAthleticStaff({ userId: "u", orgId: ORG, role: "athlete" }, ORG), false);
  assert.equal(isAthleticStaff(null, ORG), false);
});

test("projectAthleticBookings applies the same rule to every row", () => {
  const rows = [bookingRow(), bookingRow({ id: "booking-2", orgUserId: "orguser-9" })];
  const projected = projectAthleticBookings(rows, null) as Record<string, unknown>[];
  assert.equal(projected.length, 2);
  for (const row of projected) {
    for (const field of IDENTITY_FIELDS) assert.ok(!(field in row));
  }
});

// ── Route wiring ─────────────────────────────────────────────────────────────

test("both booking read routes project by viewer", () => {
  const routes = read("routes.ts");
  for (const routePath of ["/api/athletic/bookings", "/api/athletic/bookings/range"]) {
    const block = routeBlock(routes, "get", routePath);
    assert.match(block, /resolveOrgSession\(req\)/, `${routePath} must resolve the viewer`);
    assert.match(block, /projectAthleticBookings\(list as any, auth\)/, `${routePath} must project`);
    assert.doesNotMatch(block, /res\.json\(list\)/, `${routePath} must not return raw rows`);
  }
});

test("inactive programs are not publicly enumerable", () => {
  const routes = read("routes.ts");

  const list = routeBlock(routes, "get", "/api/athletic/programs");
  assert.match(list, /isOrgMember\(req, orgId\)/);
  assert.match(list, /programs\.filter\(\(program: any\) => program\.active\)/);

  for (const routePath of [
    "/api/athletic/programs/:id",
    "/api/athletic/programs/by-slug/:orgId/:slug",
    "/api/athletic/programs/by-org-slug/:orgSlug/:programSlug",
  ]) {
    const block = routeBlock(routes, "get", routePath);
    assert.match(block, /!program\.active && !\(await isOrgMember/, `${routePath} must hide inactive programs`);
    assert.match(block, /Program not found/);
  }
});

test("booking reads carry the credential that decides what comes back", () => {
  const clientDir = path.join(serverDir, "..", "client", "src", "pages");

  // Without the org token on the READ, a signed-in booker is projected as
  // anonymous and loses the cancel control for their own session.
  const publicPage = readFileSync(path.join(clientDir, "athletic-scheduling.tsx"), "utf8");
  const reads = [...publicPage.matchAll(/\/api\/athletic\/bookings[^`]*`, \{\s*headers: orgToken/g)];
  assert.equal(reads.length, 2, "both booking reads must send X-Org-Auth-Token when held");

  // The coach page reads with a bare fetch, which carries no bearer token —
  // without these the coach is projected as a member of the public.
  const coachPage = readFileSync(path.join(clientDir, "coach-athletic.tsx"), "utf8");
  assert.match(coachPage, /import \{ getAuthHeaders \} from "@\/lib\/authToken"/);
  const authed = [...coachPage.matchAll(/\/api\/athletic\/[^`]*`, \{ headers: getAuthHeaders\(\) \}/g)];
  assert.equal(authed.length, 3, "programs, config and bookings reads must be authenticated");
});

test("the public calendar hides a cancel control the server would refuse", () => {
  const page = readFileSync(
    path.join(serverDir, "..", "client", "src", "pages", "athletic-scheduling.tsx"),
    "utf8",
  );
  assert.match(page, /booking\.canCancel !== false && \(/);
  assert.match(page, /booking\.hasAccount &&/);

  // The page must no longer reach for the withheld account id.
  assert.doesNotMatch(page, /\(booking as any\)\.orgUserId/);
});
