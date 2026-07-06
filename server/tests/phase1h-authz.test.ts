/**
 * Phase 1H — lock down attendance + conversations routes.
 *
 * Static guards (no server/DB) proving:
 *   - Public athlete check-in (GET/POST /api/attendance/checkin/:slug) stays PUBLIC.
 *   - Every other /api/attendance* route requires isAuthenticated + COACH/ADMIN.
 *   - The org-scoped attendance dashboards no longer read org from the client
 *     (req.query.orgId) and instead resolve it via resolveOrgIdOrThrow.
 *   - The (currently unregistered / dead) /api/conversations routes are guarded
 *     with isAuthenticated + requireRole("ADMIN") as defense-in-depth.
 *
 * Run with:
 *   npx tsx server/tests/phase1h-authz.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(serverDir, rel), "utf8");

const ATT = read("attendance-routes.ts");
const ATT_DEF = /app\.(get|post|put|patch|delete)\(\s*"(\/api\/attendance[^"]*)"([^\n]*)/g;

// ── Public check-in stays public; everything else is COACH+ADMIN ────────────
test("attendance: check-in is public, all other routes require COACH+ADMIN", () => {
  const publicRoutes: string[] = [];
  const unguarded: string[] = [];
  for (const m of ATT.matchAll(ATT_DEF)) {
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    const rest = m[3];
    if (m[2].includes("/checkin/")) {
      // must remain public (no auth middleware)
      if (/isAuthenticated|requireRole/.test(rest)) publicRoutes.push(`${key} (should be public)`);
      continue;
    }
    if (!/isAuthenticated/.test(rest) || !/requireRole\("COACH", "ADMIN"\)/.test(rest)) unguarded.push(key);
  }
  assert.deepEqual(publicRoutes, [], "check-in routes must stay public");
  assert.deepEqual(unguarded, [], `attendance routes missing COACH+ADMIN:\n${unguarded.join("\n")}`);
});

// ── Dashboards resolve org from the session, not the client ─────────────────
test("attendance dashboards resolve org via resolveOrgIdOrThrow, not req.query.orgId", () => {
  // No client org reads anywhere in the routes. (A helper that destructures
  // `orgId` from its own `params` argument is fine — only client sources are
  // forbidden: req.query / req.body / req.params.)
  assert.ok(!/req\.query[^;]*\borgId\b/.test(ATT), "attendance must not read orgId from req.query");
  // Bound to a single destructure pattern (no inner braces) so it can't span
  // across statements like `const orgId = await resolveOrgIdOrThrow(req)`.
  assert.ok(!/const\s*\{[^{}]*\borgId\b[^{}]*\}\s*=\s*req\.(query|body|params)/.test(ATT),
    "attendance must not destructure orgId from req.query/body/params");
  for (const rp of [
    "/api/attendance/dashboard",
    "/api/attendance/analytics",
    "/api/attendance/athlete-history",
    "/api/attendance/programs",
  ]) {
    const i = ATT.indexOf(`"${rp}"`);
    assert.ok(i >= 0, `${rp} not found`);
    const block = ATT.slice(i, i + 600);
    assert.ok(/resolveOrgIdOrThrow\(req\)/.test(block), `${rp} must resolve org via resolveOrgIdOrThrow`);
  }
});

// ── Conversations (dead routes) guarded defensively with ADMIN ──────────────
for (const file of ["replit_integrations/chat/routes.ts", "replit_integrations/audio/routes.ts"]) {
  test(`${file}: all /api/conversations routes require isAuthenticated + ADMIN`, () => {
    const src = read(file);
    const re = /app\.(get|post|put|patch|delete)\(\s*"(\/api\/conversations[^"]*)"([^\n]*)/g;
    const unguarded: string[] = [];
    let count = 0;
    for (const m of src.matchAll(re)) {
      count++;
      if (!/isAuthenticated/.test(m[3]) || !/requireRole\("ADMIN"\)/.test(m[3])) unguarded.push(`${m[1].toUpperCase()} ${m[2]}`);
    }
    assert.ok(count >= 5, `expected >=5 conversation routes in ${file}, found ${count}`);
    assert.deepEqual(unguarded, [], `unguarded conversation routes in ${file}:\n${unguarded.join("\n")}`);
  });
}
