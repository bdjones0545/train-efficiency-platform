/**
 * Phase 1G — lock down /api/community/* content routes.
 *
 * Static guards (no server/DB) proving:
 *   - GET community reads  → COACH+ADMIN.
 *   - POST community writes → ADMIN.
 *   - No /api/community route is left unauthenticated.
 *
 * Run with:
 *   npx tsx server/tests/phase1g-authz.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["beta-wave2-routes.ts", "beta-wave5-routes.ts", "beta-wave6-routes.ts"];
const DEF = /app\.(get|post|put|patch|delete)\(\s*"(\/api\/community\/[^"]*)"\s*,\s*([^\n]*)/g;

function routes() {
  const out: { method: string; p: string; def: string }[] = [];
  for (const f of FILES) {
    const src = readFileSync(path.join(serverDir, f), "utf8");
    for (const m of src.matchAll(DEF)) out.push({ method: m[1].toUpperCase(), p: m[2], def: m[0] });
  }
  return out;
}

test("no /api/community route is left unauthenticated", () => {
  const open = routes().filter((r) => !/isAuthenticated/.test(r.def) || !/requireRole/.test(r.def));
  assert.deepEqual(open.map((r) => `${r.method} ${r.p}`), [], "open community routes remain");
});

test("GET community reads require COACH+ADMIN", () => {
  const gets = routes().filter((r) => r.method === "GET");
  assert.ok(gets.length >= 5, `expected >=5 community GET routes, found ${gets.length}`);
  for (const r of gets) {
    assert.ok(/requireRole\("COACH", "ADMIN"\)/.test(r.def), `${r.p} (GET) must be COACH+ADMIN`);
  }
});

test("POST community writes require ADMIN (not COACH)", () => {
  const posts = routes().filter((r) => r.method === "POST");
  assert.ok(posts.length >= 3, `expected >=3 community POST routes, found ${posts.length}`);
  for (const r of posts) {
    assert.ok(/requireRole\("ADMIN"\)/.test(r.def), `${r.p} (POST) must be ADMIN`);
    assert.ok(!/requireRole\("COACH"/.test(r.def), `${r.p} (POST) must NOT allow COACH`);
  }
});
