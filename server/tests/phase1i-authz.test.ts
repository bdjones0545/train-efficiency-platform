/**
 * Phase 1I — lock down the remaining open /api/admin/* routes to ADMIN.
 *
 * Static guards (no server/DB) proving:
 *   - No /api/admin route in routes.ts is left unauthenticated (completeness:
 *     replicates the audit's "bare route" detection and asserts it is empty).
 *   - The previously-open privileged mutations (execute agent tools, trigger/
 *     approve/cancel workflows, execute business recommendations, retry/resolve
 *     tool-calls, start-my-day) require isAuthenticated + requireRole("ADMIN").
 *
 * Run with:
 *   npx tsx server/tests/phase1i-authz.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(serverDir, "routes.ts"), "utf8");
const lines = src.split("\n");

const DEF = /app\.(get|post|put|patch|delete)\(\s*"(\/api\/admin\/[^"]*)"/;
const GUARD = /\b(isAuthenticated|require[A-Z]\w*|adminRepairAuth)\b/;
const INH = /resolveOrgIdOrThrow|resolveOrgSession|isAdminRepairAuthorized|req\.user|_orgAuth|_profile/;

// ── Completeness: no bare /api/admin route remains ──────────────────────────
test("no /api/admin route in routes.ts is left unauthenticated", () => {
  const bare: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DEF.exec(lines[i]);
    if (!m) continue;
    const defRegion = lines[i];
    const body = lines.slice(i, i + 16).join("\n");
    if (!GUARD.test(defRegion) && !INH.test(body)) bare.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  assert.deepEqual(bare, [], `bare /api/admin routes remain:\n${bare.join("\n")}`);
});

// ── The formerly-open privileged mutations must be ADMIN ─────────────────────
const CRITICAL: Array<[string, string]> = [
  ["post", "/api/admin/agent-tools/execute"],
  ["post", "/api/admin/agent-tools/propose"],
  ["post", "/api/admin/agent-tool-calls/:id/confirm"],
  ["post", "/api/admin/agent-tool-calls/:id/reject"],
  ["post", "/api/admin/workflows/trigger"],
  ["post", "/api/admin/workflows/:id/approve"],
  ["post", "/api/admin/workflows/:id/reject"],
  ["post", "/api/admin/workflows/:id/cancel"],
  ["post", "/api/admin/workflows/:id/regenerate"],
  ["post", "/api/admin/business-brain/run"],
  ["post", "/api/admin/business-brain/recommendations/:id/execute"],
  ["post", "/api/admin/agent-ops/tool-calls/:id/resolve"],
  ["post", "/api/admin/agent-ops/tool-calls/:id/retry"],
  ["post", "/api/admin/start-my-day"],
];

for (const [method, rp] of CRITICAL) {
  test(`${method.toUpperCase()} ${rp} requires isAuthenticated + requireRole("ADMIN")`, () => {
    const re = new RegExp(`app\\.${method}\\(\\s*"${rp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"([^\\n]*)`);
    const line = lines.find((l) => re.test(l));
    assert.ok(line, `${method.toUpperCase()} ${rp} not found`);
    const rest = re.exec(line!)![1];
    assert.ok(/isAuthenticated/.test(rest), `${rp} must have isAuthenticated`);
    assert.ok(/requireRole\("ADMIN"\)/.test(rest), `${rp} must require ADMIN`);
  });
}

// ── Sample of the read routes are ADMIN too ─────────────────────────────────
for (const rp of [
  "/api/admin/business-brain/feed",
  "/api/admin/agent-ops/health",
  "/api/admin/workflows/stats",
  "/api/admin/operator-score",
]) {
  test(`GET ${rp} requires ADMIN`, () => {
    const re = new RegExp(`app\\.get\\(\\s*"${rp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"([^\\n]*)`);
    const line = lines.find((l) => re.test(l));
    assert.ok(line, `${rp} not found`);
    assert.ok(/isAuthenticated/.test(line!) && /requireRole\("ADMIN"\)/.test(line!), `${rp} must be ADMIN`);
  });
}
