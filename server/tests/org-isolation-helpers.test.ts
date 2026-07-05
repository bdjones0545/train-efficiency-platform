/**
 * Phase 1A — organization isolation regression guard.
 *
 * Asserts that the route files whose org resolution was hardened in Phase 1A do
 * NOT read organization scope from client-controlled input (query/body/params),
 * and instead delegate to the trusted resolver `resolveOrgIdOrThrow`.
 *
 * This is a static-source guard — no server or database required — so it runs in
 * CI and fails fast if the vulnerable `?? req.query.orgId` fallback is ever
 * reintroduced into these files.
 *
 * Run with:
 *   npx tsx server/tests/org-isolation-helpers.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HARDENED_FILES = [
  "agent-quality-routes.ts",
  "agentmail-followup-routes.ts",
  "software-improvement-routes.ts",
  "agentmail-reply-routes.ts",
  "hermes-routes.ts",
  "ceo-heartbeat-routes.ts",
  "hiring-routes.ts",
];

// Reading org scope for authorization from any of these is forbidden.
const FORBIDDEN_PATTERNS: RegExp[] = [
  /req\.query[.?]*\.?\borgId\b/,
  /req\.query[.?]*\.?\borganizationId\b/,
  /req\.body[.?]*\.?\borgId\b/,
  /req\.body[.?]*\.?\borganizationId\b/,
  /req\.params[.?]*\.?\borgId\b/,
  /req\.params[.?]*\.?\borganizationId\b/,
  /["']demo-org["']/,
  /claims\??\.org_id/,
];

for (const file of HARDENED_FILES) {
  test(`${file} resolves org from the trusted resolver, not client input`, () => {
    const src = readFileSync(path.join(serverDir, file), "utf8");

    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.ok(
        !pattern.test(src),
        `${file} must not read org scope via ${pattern} — use resolveOrgIdOrThrow(req)`,
      );
    }

    assert.ok(
      src.includes("resolveOrgIdOrThrow"),
      `${file} must delegate org resolution to resolveOrgIdOrThrow`,
    );
  });
}
