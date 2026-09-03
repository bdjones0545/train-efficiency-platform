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
  for (let i = start + 1; i < lines.length && !/app\.(get|post|put|patch|delete)\(/.test(lines[i]); i++) {
    block += `\n${lines[i]}`;
  }
  return block;
}

test("admin redemption reads are organization-scoped at the database boundary", () => {
  const block = routeBlock(read("routes.ts"), "get", "/api/admin/redemptions");
  assert.match(block, /resolveOrgIdOrThrow\(req\)/);
  assert.match(block, /getRedemptionsByOrganization\(orgId\)/);
  assert.doesNotMatch(block, /getAllRedemptions/);
});

test("redemption amount changes require admin and enforce organization ownership", () => {
  const block = routeBlock(read("routes.ts"), "patch", "/api/admin/redemptions/:id/amount");
  assert.match(block, /requireRole\("ADMIN"\)/);
  assert.match(block, /resolveOrgIdOrThrow\(req\)/);
  assert.match(block, /updateRedemptionAmountForOrganization\(id, orgId, amountCents\)/);
});

test("coach redemption reads cannot target another coach", () => {
  const block = routeBlock(read("routes.ts"), "get", "/api/coach/redemptions");
  assert.match(block, /requesterRole !== "ADMIN" && targetCoachId !== requesterCoachId/);
  assert.match(block, /getCoachProfilesByOrganization\(orgId\)/);
});

test("cashout reads and status changes are organization-scoped", () => {
  const routes = read("routes.ts");
  const getBlock = routeBlock(routes, "get", "/api/admin/cashouts");
  const patchBlock = routeBlock(routes, "patch", "/api/admin/cashouts/:id/status");
  assert.match(getBlock, /getCashoutsByOrganization\(orgId\)/);
  assert.match(patchBlock, /updateCashoutStatusForOrganization\(orgId, id, status, adminUserId\)/);
});

test("scoped financial mutations enforce ownership in SQL", () => {
  const storage = read("storage.ts");
  assert.match(storage, /updateRedemptionAmountForOrganization[\s\S]*?cp\.organization_id = \$\{orgId\}/);
  assert.match(storage, /updateCashoutStatusForOrganization[\s\S]*?eq\(coachProfiles\.organizationId, orgId\)/);
});
