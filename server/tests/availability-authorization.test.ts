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
  assert.ok(start >= 0, `${method.toUpperCase()} ${routePath} not found`);
  let block = lines[start];
  for (let i = start + 1; i < lines.length && !/app\.(get|post|put|patch|delete)\(/.test(lines[i]); i++) block += `\n${lines[i]}`;
  return block;
}

test("coaches cannot read or create availability for another coach", () => {
  const routes = read("routes.ts");
  for (const method of ["get", "post"]) {
    const block = routeBlock(routes, method, "/api/coach/availability");
    assert.match(block, /requesterRole !== "ADMIN" && targetCoachId !== requesterCoachId/);
    assert.match(block, /getCoachProfilesByOrganization\(orgId\)/);
  }
});

test("availability updates load ownership before validating and mutating", () => {
  const block = routeBlock(read("routes.ts"), "patch", "/api/coach/availability/:id");
  assert.match(block, /getAvailabilityBlockForOrganization\(req\.params\.id, orgId\)/);
  assert.match(block, /getAvailabilityBlockForCoach\(req\.params\.id, requesterCoachId\)/);
  assert.match(block, /nextStartTime = startTime \?\? existing\.startTime/);
  assert.match(block, /updateAvailabilityBlockForOrganization/);
  assert.match(block, /updateAvailabilityBlockForCoach/);
});

test("availability deletes are scoped for both admins and coaches", () => {
  const block = routeBlock(read("routes.ts"), "delete", "/api/coach/availability/:id");
  assert.match(block, /deleteAvailabilityBlockForOrganization\(req\.params\.id, orgId\)/);
  assert.match(block, /deleteAvailabilityBlockForCoach\(req\.params\.id, requesterCoachId\)/);
  assert.match(block, /if \(!deleted\).*404/);
});

test("scheduling assistant availability tools enforce the same ownership rules", () => {
  const assistant = read("scheduling-assistant.ts");
  assert.match(assistant, /targetCoach\.organizationId !== organizationId/);
  assert.match(assistant, /targetCoach\.userId !== userId/);
  assert.match(assistant, /deleteAvailabilityBlockForOrganization\(args\.blockId, organizationId\)/);
  assert.doesNotMatch(assistant, /storage\.deleteAvailabilityBlock\(/);
});
