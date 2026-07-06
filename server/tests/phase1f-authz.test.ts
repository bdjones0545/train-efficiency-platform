/**
 * Phase 1F — lock down /api/obsidian/* with the sensitivity split.
 *
 * Static guards (no server/DB) proving:
 *   - COACH+ADMIN for read/status/search/context routes.
 *   - ADMIN for write/decision/software-KB mutations/connect/probe/sync-ops.
 *   - /api/obsidian/status stays COACH-accessible (coach chat widget depends on it).
 *   - The existing /api/obsidian/learn COACH+ADMIN precedent is preserved.
 *   - No /api/obsidian route is left unauthenticated.
 *
 * Run with:
 *   npx tsx server/tests/phase1f-authz.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(serverDir, "obsidian-routes.ts"), "utf8");

const COACH = new Set([
  "GET /api/obsidian/status", "GET /api/obsidian/stats", "GET /api/obsidian/folders",
  "GET /api/obsidian/read", "GET /api/obsidian/vault", "GET /api/obsidian/software-kb/search",
  "GET /api/obsidian/sync-queue/stats", "GET /api/obsidian/sync-queue/items",
  "POST /api/obsidian/search", "POST /api/obsidian/similar", "POST /api/obsidian/context",
  "POST /api/obsidian/learn", // existing precedent, preserved
]);
const ADMIN = new Set([
  "POST /api/obsidian/write", "POST /api/obsidian/decision", "POST /api/obsidian/software-kb",
  "POST /api/obsidian/sync-queue/retry-failed", "POST /api/obsidian/sync-queue/process-now",
  "PATCH /api/obsidian/decision/outcome", "GET /api/obsidian/connect", "GET /api/obsidian/probe",
]);

const DEF = /app\.(get|post|put|patch|delete)\(\s*"(\/api\/obsidian\/[^"]*)"\s*,\s*([^\n]*)/g;

function routes() {
  const out: { key: string; def: string }[] = [];
  for (const m of src.matchAll(DEF)) out.push({ key: `${m[1].toUpperCase()} ${m[2]}`, def: m[0] });
  return out;
}

test("every /api/obsidian route is authenticated and role-gated", () => {
  const open = routes().filter((r) => !/isAuthenticated/.test(r.def) || !/requireRole/.test(r.def));
  assert.deepEqual(open.map((r) => r.key), [], "open obsidian routes remain");
});

test("COACH+ADMIN routes carry requireRole(\"COACH\",\"ADMIN\")", () => {
  const found = new Set<string>();
  for (const r of routes()) {
    if (!COACH.has(r.key)) continue;
    found.add(r.key);
    assert.ok(/requireRole\("COACH", "ADMIN"\)/.test(r.def), `${r.key} must be COACH+ADMIN`);
  }
  assert.equal(found.size, COACH.size, `expected ${COACH.size} COACH routes, found ${found.size}`);
});

test("ADMIN routes carry requireRole(\"ADMIN\") and are not COACH-accessible", () => {
  const found = new Set<string>();
  for (const r of routes()) {
    if (!ADMIN.has(r.key)) continue;
    found.add(r.key);
    assert.ok(/requireRole\("ADMIN"\)/.test(r.def), `${r.key} must be ADMIN`);
    assert.ok(!/requireRole\("COACH"/.test(r.def), `${r.key} must NOT allow COACH`);
  }
  assert.equal(found.size, ADMIN.size, `expected ${ADMIN.size} ADMIN routes, found ${found.size}`);
});

test("hard requirement: /api/obsidian/status remains COACH-accessible", () => {
  const status = routes().find((r) => r.key === "GET /api/obsidian/status");
  assert.ok(status, "status route not found");
  assert.ok(/requireRole\("COACH", "ADMIN"\)/.test(status!.def), "status must include COACH");
});

test("existing /api/obsidian/learn COACH+ADMIN precedent preserved", () => {
  const learn = routes().find((r) => r.key === "POST /api/obsidian/learn");
  assert.ok(learn && /requireRole\("COACH", "ADMIN"\)/.test(learn.def), "learn must stay COACH+ADMIN");
});
