/**
 * Security hotfix guard — POST /api/admin/setup.
 *
 * This endpoint previously minted and returned an ADMIN auth token to any
 * anonymous caller (and created an ADMIN user with a hardcoded password). These
 * static guards prove the vulnerability is closed:
 *   - the route requires isAuthenticated + requireRole("ADMIN") (anonymous → 401,
 *     so an anonymous caller can never reach the handler or receive a token);
 *   - the handler no longer mints an auth token (no createAuthToken);
 *   - the handler no longer creates a user / inserts a passwordHash;
 *   - the hardcoded admin password is gone from the whole server.
 *
 * Run with:
 *   npx tsx server/tests/hotfix-admin-setup.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routesSrc = readFileSync(path.join(serverDir, "routes.ts"), "utf8");

// Extract the /api/admin/setup route block (def line through the next app.<method>).
function setupBlock(): string {
  const lines = routesSrc.split("\n");
  const start = lines.findIndex((l) => /app\.post\(\s*["']\/api\/admin\/setup["']/.test(l));
  assert.ok(start >= 0, "POST /api/admin/setup route not found");
  let block = lines[start];
  for (let j = start + 1; j < lines.length && !/app\.(get|post|put|patch|delete)\(/.test(lines[j]); j++) {
    block += "\n" + lines[j];
  }
  return block;
}

test("POST /api/admin/setup requires isAuthenticated + requireRole(\"ADMIN\")", () => {
  const def = setupBlock().split("\n")[0];
  assert.ok(/isAuthenticated/.test(def), "must require isAuthenticated (anonymous → 401)");
  assert.ok(/requireRole\("ADMIN"\)/.test(def), "must require ADMIN role");
});

test("POST /api/admin/setup no longer mints an auth token", () => {
  const block = setupBlock();
  assert.ok(!/createAuthToken/.test(block), "handler must not call createAuthToken");
  assert.ok(!/token/i.test(block.replace(/\/\/.*$/gm, "")), "handler must not return a token");
});

test("POST /api/admin/setup no longer creates a user / password", () => {
  const block = setupBlock();
  assert.ok(!/insert\(\s*users\s*\)/.test(block), "handler must not insert a users row");
  assert.ok(!/passwordHash/.test(block), "handler must not set a passwordHash");
  assert.ok(!/bcrypt\.hash/.test(block), "handler must not hash a hardcoded password");
});

test("hardcoded admin password is gone from the server", () => {
  assert.ok(!/ESTadmin2025/.test(routesSrc), "hardcoded admin password must be removed");
});
