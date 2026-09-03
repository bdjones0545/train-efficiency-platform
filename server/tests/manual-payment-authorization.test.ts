import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");

test("manual payments require a client in the authenticated organization", () => {
  const routes = read("routes.ts");
  const start = routes.indexOf('app.post("/api/coach/manual-payment"');
  const end = routes.indexOf("\n  app.", start + 10);
  const block = routes.slice(start, end);
  assert.match(block, /resolveOrgIdOrThrow\(req\)/);
  assert.match(block, /userProfile\.organizationId !== orgId/);
  assert.match(block, /userProfile\.role !== "CLIENT"/);
  assert.match(block, /creditManualPaymentForOrganization\(userId, orgId/);
  assert.doesNotMatch(block, /storage\.creditWallet\(/);
});

test("manual payment amount must be a positive safe integer", () => {
  const routes = read("routes.ts");
  assert.match(routes, /!Number\.isSafeInteger\(amountCents\) \|\| amountCents <= 0/);
});

test("manual wallet credit atomically locks membership and records its real source", () => {
  const storage = read("storage.ts");
  assert.match(storage, /creditManualPaymentForOrganization[\s\S]*?FOR UPDATE/);
  assert.match(storage, /organization_id = \$\{orgId\} AND role = 'CLIENT'/);
  assert.match(storage, /sourceType: `manual_\$\{method\}`/);
});

test("manual payment revenue and branding use the trusted organization", () => {
  const routes = read("routes.ts");
  const start = routes.indexOf('app.post("/api/coach/manual-payment"');
  const end = routes.indexOf("\n  app.", start + 10);
  const block = routes.slice(start, end);
  assert.match(block, /onPaymentReceived\(\{\s*orgId,/);
  assert.match(block, /getOrgBranding\(orgId\)/);
});
