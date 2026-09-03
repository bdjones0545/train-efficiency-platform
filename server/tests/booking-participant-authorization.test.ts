import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");
function routeBlock(source: string, method: string, routePath: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.includes(`app.${method}("${routePath}"`));
  assert.ok(start >= 0);
  let block = lines[start];
  for (let i = start + 1; i < lines.length && !/app\.(get|post|put|patch|delete)\(/.test(lines[i]); i++) block += `\n${lines[i]}`;
  return block;
}

for (const [method, route] of [
  ["post", "/api/coach/bookings/:id/add-participant"],
  ["delete", "/api/coach/bookings/:id/participants/:participantId"],
] as const) {
  test(`${method} participant verifies booking ownership and organization`, () => {
    const block = routeBlock(read("routes.ts"), method, route);
    assert.match(block, /bookingCoach\.organizationId !== orgId/);
    assert.match(block, /requesterRole !== "ADMIN" && booking\.coachId !== requesterCoachId/);
    assert.match(block, /getRedemptionByBookingId\(bookingId\)/);
  });
}

test("added participants must belong to the authenticated organization", () => {
  const block = routeBlock(read("routes.ts"), "post", "/api/coach/bookings/:id/add-participant");
  assert.match(block, /targetProfile\.organizationId !== orgId/);
});

test("participant deletion includes both participant and booking IDs", () => {
  const routes = routeBlock(read("routes.ts"), "delete", "/api/coach/bookings/:id/participants/:participantId");
  const storage = read("storage.ts");
  assert.match(routes, /removeBookingParticipantByIdForBooking\(participantId, bookingId\)/);
  assert.match(storage, /eq\(bookingParticipants\.id, participantId\)/);
  assert.match(storage, /eq\(bookingParticipants\.bookingId, bookingId\)/);
});
