/**
 * Phase 1D — lock down internal system-observability / ops endpoints to ADMIN.
 *
 * Static guards (no server/DB) proving:
 *   1. Every /api/reliability, /api/security and /api/performance route in the
 *      two ops files is guarded with `isAuthenticated` + `requireRole("ADMIN")`.
 *   2. None of those routes is left unauthenticated.
 *   3. requireRole was extracted to a shared module and routes.ts imports it
 *      (no duplicate inline definition).
 * Plus a DB-free unit check that the extracted middleware denies unauthenticated
 * callers with 401.
 *
 * Run with:
 *   npx tsx server/tests/phase1d-authz.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(serverDir, rel), "utf8");

const OPS = /app\.(get|post|put|patch|delete)\(\s*["'](\/api\/(reliability|security|performance)\/[^"']*)["']([^\n]*)/g;

// ── 1 & 2. Every ops route is ADMIN-guarded, none left open ─────────────────
for (const [file, expected] of [
  ["reliability-routes.ts", 14],
  ["phase10-routes.ts", 4],
] as const) {
  test(`${file}: all reliability/security/performance routes require ADMIN`, () => {
    const src = read(file);
    const unguarded: string[] = [];
    let guarded = 0;
    for (const m of src.matchAll(OPS)) {
      const defLine = m[0];
      if (/isAuthenticated/.test(defLine) && /requireRole\("ADMIN"\)/.test(defLine)) guarded++;
      else unguarded.push(m[2]);
    }
    assert.deepEqual(unguarded, [], `unguarded ops routes in ${file}:\n${unguarded.join("\n")}`);
    assert.equal(guarded, expected, `${file}: expected ${expected} ADMIN-guarded routes, found ${guarded}`);
  });
}

// ── 3. requireRole extracted & deduped ──────────────────────────────────────
test("requireRole lives in the shared module and routes.ts imports it (no dup)", () => {
  const routes = read("routes.ts");
  assert.ok(/from "\.\/lib\/require-role"/.test(routes), "routes.ts should import from ./lib/require-role");
  assert.ok(!/function requireRole\(/.test(routes), "routes.ts must not redefine requireRole inline");
  assert.ok(!/function getUserRole\(/.test(routes), "routes.ts must not redefine getUserRole inline");
});

// ── 4. Extracted middleware denies unauthenticated callers (no DB) ──────────
test('requireRole("ADMIN") returns 401 when there is no authenticated user', async () => {
  // Deferred import: require-role → storage → db throws at load without a URL.
  // The 401 path returns before any query, so this dummy URL is never connected.
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  const { requireRole } = await import("../lib/require-role");
  const mw = requireRole("ADMIN");
  let statusCode = 0;
  let nextCalled = false;
  const res: any = {
    status(c: number) { statusCode = c; return this; },
    json() { return this; },
  };
  await mw({ headers: {}, user: undefined }, res, () => { nextCalled = true; });
  assert.equal(statusCode, 401, "unauthenticated caller must get 401");
  assert.equal(nextCalled, false, "must not call next() for unauthenticated caller");
});
