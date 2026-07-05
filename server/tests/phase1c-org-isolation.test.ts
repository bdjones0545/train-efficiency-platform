/**
 * Phase 1C — organization-isolation tail.
 *
 * Static source guards (no server/DB) proving:
 *   1. The last client-controllable org reads on authenticated routes are gone
 *      (GET /api/notification-preferences no longer honours ?orgId=; the
 *      athlete-intelligence admin helper no longer falls back to req.query.orgId).
 *   2. The phantom `req.user?.orgId` reads (always undefined) are replaced by the
 *      trusted resolver in the command-center/customer-success routes and in
 *      execution-routes.
 *   3. Legitimate public booking/landing/unsubscribe routes remain unauthenticated
 *      (we did not over-lock them).
 *
 * Run with:
 *   npx tsx server/tests/phase1c-org-isolation.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(serverDir, rel), "utf8");

// Extract a single route handler block: from its `app.<m>("<path>"` line up to
// the next `app.<method>(` definition.
function handlerBlock(src: string, method: string, routePath: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) =>
    new RegExp(`app\\.${method}\\(\\s*["']${routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(l),
  );
  assert.ok(start >= 0, `route ${method.toUpperCase()} ${routePath} not found`);
  let block = lines[start];
  for (let j = start + 1; j < lines.length && !/app\.(get|post|put|patch|delete)\(/.test(lines[j]); j++) {
    block += "\n" + lines[j];
  }
  return block;
}

// ── 1. No phantom req.user?.orgId reads remain ──────────────────────────────
for (const file of ["routes.ts", "execution-routes.ts"]) {
  test(`${file} has no phantom "req.user?.orgId as string" reads`, () => {
    assert.ok(!/req\.user\?\.orgId as string/.test(read(file)), `${file} still reads req.user?.orgId`);
  });
}

// ── 2. Client-controllable org reads on authed routes are gone ──────────────
test("GET /api/notification-preferences resolves org from profile, not ?orgId=", () => {
  const block = handlerBlock(read("routes.ts"), "get", "/api/notification-preferences");
  assert.ok(!/req\.query\.orgId/.test(block), "notification-preferences GET still reads req.query.orgId");
  assert.ok(/profile\?\.organizationId/.test(block), "should scope by profile.organizationId");
});

test("athlete-intelligence getAdminOrgId no longer falls back to req.query.orgId", () => {
  const src = read("athlete-intelligence-routes.ts");
  assert.ok(!/req\.query\.orgId/.test(src), "athlete-intelligence still reads req.query.orgId");
});

// ── 3. Command-center / customer-success now use the trusted resolver ───────
for (const rp of [
  "/api/command-center/summary",
  "/api/command-center/briefing",
  "/api/customer-success/activation",
]) {
  test(`${rp} resolves org via resolveOrgIdOrThrow`, () => {
    const block = handlerBlock(read("routes.ts"), "get", rp);
    assert.ok(/resolveOrgIdOrThrow\(req\)/.test(block), `${rp} should use resolveOrgIdOrThrow`);
    assert.ok(!/req\.user\?\.orgId/.test(block), `${rp} should not read req.user?.orgId`);
  });
}

test("execution-routes getOrgId delegates to the trusted resolver", () => {
  const src = read("execution-routes.ts");
  assert.ok(/resolveOrgIdOrThrow\(req\)/.test(src), "execution-routes should use resolveOrgIdOrThrow");
});

// ── 4. Public routes preserved (must stay unauthenticated) ──────────────────
const PUBLIC_ROUTES: Array<[string, string, string]> = [
  ["get", "routes.ts", "/api/coaches"],
  ["get", "routes.ts", "/api/availability"],
  ["get", "routes.ts", "/api/services"],
  ["get", "routes.ts", "/api/athletic/programs"],
  ["get", "routes.ts", "/api/unsubscribe/:token"],
  ["get", "org-schedule-routes.ts", "/api/org/booking-settings"],
];
for (const [method, file, rp] of PUBLIC_ROUTES) {
  test(`public route ${method.toUpperCase()} ${rp} stays unauthenticated`, () => {
    const lines = read(file).split("\n");
    const def = lines.find((l) =>
      new RegExp(`app\\.${method}\\(\\s*["']${rp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(l),
    );
    assert.ok(def, `${rp} not found`);
    assert.ok(!/isAuthenticated|requireRole|requireCoach|requireOrgUser/.test(def!), `${rp} must stay public`);
  });
}
