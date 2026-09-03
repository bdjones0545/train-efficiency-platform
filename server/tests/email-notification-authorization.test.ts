import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../email-notification-routes.ts", import.meta.url), "utf8");

test("notification routes use the shared authentication and authorization stack", () => {
  assert.match(source, /import \{ isAuthenticated \} from "\.\/replit_integrations\/auth"/);
  assert.match(source, /import \{ requireRole \} from "\.\/lib\/require-role"/);
  assert.doesNotMatch(source, /function isAuthenticated\(/);
  assert.doesNotMatch(source, /function requireRole\(/);
});

test("all notification route handlers use trusted organization resolution", () => {
  assert.equal((source.match(/resolveOrgIdOrThrow\(req\)/g) ?? []).length, 3);
  assert.doesNotMatch(source, /getCoachProfileByUserId/);
  assert.doesNotMatch(source, /req\.(query|body|params)\.(orgId|organizationId)/);
});

test("all notification route failures preserve organization authorization errors", () => {
  assert.equal((source.match(/handleOrgError\(err, res\)/g) ?? []).length, 3);
});
