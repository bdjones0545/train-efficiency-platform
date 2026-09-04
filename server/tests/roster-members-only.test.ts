import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

function routeBlock(source: string, method: string, routePath: string): string {
  const start = source.indexOf(`app.${method}("${routePath}"`);
  assert.ok(start >= 0, `${method.toUpperCase()} ${routePath} not found`);
  const next = source.indexOf("app.", start + 10);
  return source.slice(start, next === -1 ? undefined : next);
}

/**
 * The roster and the waitlist name registered athletes — in a youth sports
 * product, often minors. #31 stopped this endpoint serving credentials; this
 * decides the remaining question, which was never a security bug so much as a
 * product default nobody had chosen on purpose.
 *
 * Anonymous visitors keep everything the booking flow needs: the session, its
 * time, and how many places are left. They lose only the names.
 */

test("the roster refuses a caller who is not a member of the booking's organization", () => {
  const block = routeBlock(read("server", "routes.ts"), "get", "/api/bookings/:id/participants");

  assert.match(block, /storage\.getBooking\(req\.params\.id\)/, "must resolve the booking's own org");
  assert.match(block, /isOrgMember\(req, booking\.organizationId\)/);
  assert.match(block, /ROSTER_MEMBERS_ONLY/);
  assert.match(block, /status\(403\)/);

  // Fail closed when the booking carries no organization at all.
  assert.match(block, /!booking\.organizationId \|\| !\(await isOrgMember/);

  // The membership gate must come before the roster is fetched.
  const gate = block.indexOf("isOrgMember");
  const fetch = block.indexOf("getBookingParticipants");
  assert.ok(gate > 0 && fetch > gate, "membership must be checked before reading the roster");
});

test("the waitlist is gated the same way", () => {
  const block = routeBlock(read("server", "routes.ts"), "get", "/api/bookings/:id/waitlist");
  assert.match(block, /isOrgMember\(req, waitlistBooking\.organizationId\)/);
  assert.match(block, /ROSTER_MEMBERS_ONLY/);

  const gate = block.indexOf("isOrgMember");
  const query = block.indexOf("session_waitlists");
  assert.ok(gate > 0 && query > gate, "membership must be checked before querying the waitlist");
});

test("the projection is still applied, so a member never receives credentials", () => {
  // #31's guarantee must survive this change.
  const block = routeBlock(read("server", "routes.ts"), "get", "/api/bookings/:id/participants");
  assert.match(block, /toPublicParticipants\(/);
  assert.doesNotMatch(block, /res\.json\(participants\)/);
});

test("the page does not ask for what it will not be given", () => {
  const page = read("client", "src", "pages", "open-sessions.tsx");
  const participants = page.indexOf('queryKey: ["/api/bookings", session?.id, "participants"]');
  const waitlist = page.indexOf('queryKey: ["/api/bookings", session?.id, "waitlist"]');
  assert.ok(participants > 0 && waitlist > 0, "both queries must exist");

  for (const [name, at] of [["participants", participants], ["waitlist", waitlist]] as const) {
    const enabled = page.slice(at, at + 200);
    assert.match(enabled, /enabled: !!session && isAuthenticated/, `${name} must not query when signed out`);
  }
});

test("a signed-out visitor still learns whether the session is filling up", () => {
  const page = read("client", "src", "pages", "open-sessions.tsx");
  assert.match(page, /text-roster-members-only/);
  // The count comes from the session payload, which is public and carries no names.
  assert.match(page, /session\.participantCount \?\? 0/);
  assert.match(page, /Sign in to see who/);
});
