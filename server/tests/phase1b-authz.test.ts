/**
 * Phase 1B — authenticate & authorize previously-open org/platform routes.
 *
 * Static source guards (no server/DB needed) proving the two security
 * properties for the /api/workforce, /api/marketplace and /api/developer
 * route families:
 *
 *   1. Unauthenticated private access is denied — every org-scoped route in
 *      these families (one whose handler resolves org via resolveOrgIdOrThrow)
 *      carries `isAuthenticated` middleware on its route definition.
 *   2. Cross-org query-param access is ignored — the client-controlled
 *      `?? req.query.orgId` fallback no longer exists in these files, and the
 *      trusted resolver itself never reads req.query / req.body / req.params.
 *
 * Run with:
 *   npx tsx server/tests/phase1b-authz.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(serverDir, rel), "utf8");

const FALLBACK = /\.user\?\.orgId\s*\?\?\s*req\.query\.orgId/;
const FAMILY_DEF = /app\.(get|post|put|patch|delete)\(\s*["']\/api\/(workforce|marketplace|developer)\//;
const ROUTE_DEF = /app\.(get|post|put|patch|delete)\(/;

// ── 1. No client-controlled org fallback remains ────────────────────────────
for (const file of ["routes.ts", "phase10-routes.ts"]) {
  test(`${file} no longer reads org scope from req.query.orgId`, () => {
    assert.ok(!FALLBACK.test(read(file)), `${file} still contains the ?? req.query.orgId fallback`);
  });
}

// ── 2. Every org-scoped family route is authenticated ───────────────────────
function orgScopedFamilyRoutesAreGuarded(file: string) {
  const lines = read(file).split("\n");
  const unguarded: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!FAMILY_DEF.test(lines[i])) continue;

    // Collect this route's handler body up to the next route definition.
    let body = lines[i];
    for (let j = i + 1; j < lines.length && !ROUTE_DEF.test(lines[j]); j++) body += "\n" + lines[j];

    // Only org-scoped routes (those that resolve an org) require auth here.
    if (!body.includes("resolveOrgIdOrThrow")) continue;

    if (!lines[i].includes("isAuthenticated")) {
      unguarded.push(lines[i].trim());
    }
  }
  return unguarded;
}

for (const file of ["routes.ts", "phase10-routes.ts"]) {
  test(`${file}: every org-scoped workforce/marketplace/developer route has isAuthenticated`, () => {
    const unguarded = orgScopedFamilyRoutesAreGuarded(file);
    assert.deepEqual(
      unguarded,
      [],
      `Unauthenticated org-scoped routes found in ${file}:\n${unguarded.join("\n")}`,
    );
  });
}

// ── 3. The trusted resolver never reads client-controlled input ─────────────
test("resolve-org-id.ts resolves org only from the session, never from client input", () => {
  // Strip comments first — the resolver's docblock lists these patterns as
  // examples of what NOT to do, which would otherwise false-positive.
  const src = read("lib/resolve-org-id.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  for (const forbidden of [/req\.query/, /req\.body/, /req\.params/]) {
    assert.ok(!forbidden.test(src), `resolve-org-id.ts must not read ${forbidden}`);
  }
});

// ── 4. Sanity: the known public catalog route stays public ──────────────────
test("GET /api/marketplace/case-studies remains a public (org-agnostic) route", () => {
  const lines = read("routes.ts").split("\n");
  const idx = lines.findIndex((l) => /app\.get\(\s*["']\/api\/marketplace\/case-studies["']/.test(l));
  assert.ok(idx >= 0, "case-studies GET route not found");
  // It must not have been forced org-scoped (no resolver, no auth added).
  assert.ok(!lines[idx].includes("isAuthenticated"), "public case-studies GET should stay unauthenticated");
});
