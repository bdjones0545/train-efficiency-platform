import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(serverDir, name), "utf8");
function routeBlock(source: string, method: string, routePath: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.includes(`app.${method}("${routePath}"`));
  assert.ok(start >= 0);
  let block = lines[start];
  for (let i = start + 1; i < lines.length && !/app\.(get|post|put|patch|delete)\(/.test(lines[i]); i++) block += `\n${lines[i]}`;
  return block;
}

for (const method of ["patch", "delete"]) {
  test(`${method} coach booking verifies coach and organization ownership`, () => {
    const block = routeBlock(read("routes.ts"), method, "/api/coach/bookings/:id");
    assert.match(block, /bookingCoach\.organizationId !== orgId/);
    assert.match(block, /requesterRole !== "ADMIN" && existing\.coachId !== requesterCoachId/);
  });
}

test("booking edits cannot attach cross-organization services or clients", () => {
  const block = routeBlock(read("routes.ts"), "patch", "/api/coach/bookings/:id");
  assert.match(block, /service\.organizationId !== orgId/);
  assert.match(block, /clientProfile\.organizationId !== orgId/);
  assert.match(block, /updateBookingForCoach\(bookingId, bookingCoachId, updateData\)/);
});

test("recurring booking deletion is constrained to the authorized coach", () => {
  const block = routeBlock(read("routes.ts"), "delete", "/api/coach/bookings/:id");
  assert.match(block, /deleteBookingsByRecurringGroupForCoach\(existing\.recurringGroupId, existing\.coachId\)/);
  assert.match(block, /deleteBookingForCoach\(bookingId, existing\.coachId\)/);
});

test("scheduling assistant cancellation and rescheduling enforce ownership", () => {
  const assistant = read("scheduling-assistant.ts");
  assert.match(assistant, /bookingCoach\.organizationId !== organizationId/);
  assert.match(assistant, /bookingCoach\.userId !== userId/);
  assert.match(assistant, /updateBookingStatusForCoach/);
  assert.match(assistant, /updateBookingForCoach/);
});
