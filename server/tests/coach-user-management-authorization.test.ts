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

test("coach user edits are limited to client profiles in the organization", () => {
  const block = routeBlock(read("routes.ts"), "patch", "/api/coach/users/:id");
  assert.match(block, /resolveOrgIdOrThrow\(req\)/);
  assert.match(block, /updateClientForOrganization\(userId, orgId/);
});

test("coach user deletion uses a tenant-scoped transactional operation", () => {
  const block = routeBlock(read("routes.ts"), "delete", "/api/coach/users/:id");
  const storage = read("storage.ts");
  assert.match(block, /deleteClientForOrganization\(userId, orgId\)/);
  assert.match(storage, /WHERE user_id = \$\{id\} AND organization_id = \$\{orgId\} AND role = 'CLIENT'/);
  assert.match(storage, /FOR UPDATE/);
});

test("client booking history is scoped by target role and organization", () => {
  const block = routeBlock(read("routes.ts"), "get", "/api/coach/users/:id/bookings");
  assert.match(block, /targetProfile\.organizationId !== orgId/);
  assert.match(block, /targetProfile\.role !== "CLIENT"/);
  assert.match(block, /getBookingsForUserInOrganization\(userId, orgId\)/);
});

test("tenant-scoped client updates enforce membership and CLIENT role in SQL", () => {
  const storage = read("storage.ts");
  assert.match(storage, /updateClientForOrganization[\s\S]*?up\.organization_id = \$\{orgId\}/);
  assert.match(storage, /updateClientForOrganization[\s\S]*?up\.role = 'CLIENT'/);
});
