import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");
function block(source: string, route: string): string {
  const start = source.indexOf(`app.get("${route}"`);
  assert.ok(start >= 0);
  const end = source.indexOf("\n  app.", start + 10);
  return source.slice(start, end);
}

test("wallet transaction history has no global fallback", () => {
  const route = block(read("routes.ts"), "/api/coach/transactions");
  assert.match(route, /resolveOrgIdOrThrow\(req\)/);
  assert.match(route, /getWalletTransactionsByOrganization\(orgId\)/);
  assert.doesNotMatch(route, /getAllWalletTransactions/);
});

test("wallet balances have no global fallback", () => {
  const route = block(read("routes.ts"), "/api/coach/user-balances");
  assert.match(route, /resolveOrgIdOrThrow\(req\)/);
  assert.match(route, /getUserBalancesByOrganization\(orgId\)/);
  assert.doesNotMatch(route, /getAllUserBalances/);
});

test("organization wallet queries filter at the database boundary", () => {
  const storage = read("storage.ts");
  assert.match(storage, /getWalletTransactionsByOrganization[\s\S]*?eq\(userProfiles\.organizationId, orgId\)/);
  assert.match(storage, /getUserBalancesByOrganization[\s\S]*?eq\(userProfiles\.organizationId, orgId\)/);
});
