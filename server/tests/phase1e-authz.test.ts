/**
 * Phase 1E — lock down /api/platform/* and /api/beta/* per the bucket model.
 *
 * Static guards (no server/DB) proving:
 *   A/C. Founder-internal platform BI + founder beta management → ADMIN only.
 *   B.   Community/leaderboard-facing platform endpoints → COACH+ADMIN.
 *   D.   Participant-facing beta writes (POST feedback, POST participants) are
 *        intentionally left as-is (not ADMIN-gated) — documented exception.
 *   - No /api/platform route in the beta/phase10 files is left fully open.
 *   - /api/community/* routes are NOT modified by this PR.
 *
 * Run with:
 *   npx tsx server/tests/phase1e-authz.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  ...readdirSync(serverDir).filter((f) => /^beta-.*-routes\.ts$/.test(f)),
  "phase10-routes.ts",
];
const src = (f: string) => readFileSync(path.join(serverDir, f), "utf8");

const BUCKET_B = new Set([
  "/api/platform/agent-economy-leaderboard", "/api/platform/referral-growth",
  "/api/platform/participant-success", "/api/platform/activation-score",
  "/api/platform/velocity", "/api/platform/cohorts",
  "/api/platform/momentum", "/api/platform/marketplace-stage",
]);
const BUCKET_D = new Set(["POST /api/beta/feedback", "POST /api/beta/participants"]);

const DEF = /app\.(get|post|put|patch|delete)\(\s*"(\/api\/(platform|beta)\/[^"]*)"\s*,\s*([^\n]*)/g;

type Row = { file: string; method: string; p: string; def: string };
function rows(): Row[] {
  const out: Row[] = [];
  for (const f of FILES) {
    for (const m of src(f).matchAll(DEF)) {
      out.push({ file: f, method: m[1].toUpperCase(), p: m[2], def: m[0] });
    }
  }
  return out;
}

// ── B: community endpoints are COACH+ADMIN (not ADMIN-only) ─────────────────
test("Bucket B community/leaderboard endpoints require COACH+ADMIN", () => {
  const found = new Set<string>();
  for (const r of rows()) {
    if (!BUCKET_B.has(r.p)) continue;
    found.add(r.p);
    assert.ok(/requireRole\("COACH", "ADMIN"\)/.test(r.def), `${r.p} must be COACH+ADMIN, got: ${r.def.slice(0, 90)}`);
    assert.ok(/isAuthenticated/.test(r.def), `${r.p} must have isAuthenticated`);
  }
  assert.equal(found.size, BUCKET_B.size, `expected all ${BUCKET_B.size} community endpoints present, found ${found.size}`);
});

// ── A/C: everything else in-scope is ADMIN-only ─────────────────────────────
test("Bucket A/C founder platform + beta management require ADMIN", () => {
  for (const r of rows()) {
    const key = `${r.method} ${r.p}`;
    if (BUCKET_B.has(r.p) || BUCKET_D.has(key)) continue;
    assert.ok(/isAuthenticated/.test(r.def) && /requireRole\("ADMIN"\)/.test(r.def),
      `${key} must be ADMIN-guarded, got: ${r.def.slice(0, 90)}`);
  }
});

// ── D: participant-facing beta writes deliberately left as-is ───────────────
test("Bucket D participant writes are NOT ADMIN-gated (documented exception)", () => {
  for (const r of rows()) {
    const key = `${r.method} ${r.p}`;
    if (!BUCKET_D.has(key)) continue;
    assert.ok(!/requireRole/.test(r.def), `${key} should remain un-role-gated (deferred), got: ${r.def.slice(0, 90)}`);
  }
});

// ── No /api/platform route left fully open ──────────────────────────────────
test("no /api/platform/* route in these files is left unauthenticated", () => {
  const open = rows().filter((r) => r.p.startsWith("/api/platform/") && !/isAuthenticated/.test(r.def));
  assert.deepEqual(open.map((r) => `${r.method} ${r.p}`), [], "open platform routes remain");
});

// NOTE: /api/community/* was out of scope for Phase 1E and is now guarded by
// Phase 1G (see phase1g-authz.test.ts). The former "not modified" assertion was
// intentionally removed here when Phase 1G superseded it.
