import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

function routeBlock(source: string, method: string, routePath: string): string {
  const start = source.indexOf(`app.${method}("${routePath}"`);
  assert.ok(start >= 0, `${method.toUpperCase()} ${routePath} not found`);
  const next = source.indexOf("app.", start + 10);
  return source.slice(start, next === -1 ? undefined : next);
}

/**
 * PR #11 wrote this fix in July and could never land it: its branch shares no
 * ancestor with main, which was re-rooted by a Replit publish on 2026-07-07.
 * The change is re-applied here.
 *
 * Its original test only exercised a running server with injected credentials,
 * so every case skipped in CI. These assertions run on every pull request.
 */

const ROUTE = "/api/lead-capture/submissions/:id/recover-pipeline";

test("recovering a submission requires an authenticated coach or admin", () => {
  const block = routeBlock(read("server", "routes.ts"), "post", ROUTE);
  assert.match(block, /isAuthenticated, requireRole\("COACH", "ADMIN"\)/);
  assert.doesNotMatch(block, /requireRole\([^)]*(STAFF|CLIENT)/);
});

test("the caller may only recover their own organization's submission", () => {
  const block = routeBlock(read("server", "routes.ts"), "post", ROUTE);
  assert.match(block, /resolveOrgIdOrThrow\(req\)/);
  assert.match(block, /submission\.orgId !== callerOrgId/);
  assert.match(block, /status\(403\)/);
});

test("ownership is checked before the pipeline is allowed to run", () => {
  // The pipeline makes two OpenAI completions. Ordering is the whole control:
  // a check after the call would still have been billed for.
  const block = routeBlock(read("server", "routes.ts"), "post", ROUTE);
  const ownership = block.indexOf("submission.orgId !== callerOrgId");
  const pipeline = block.indexOf("runIntelligentLeadIntakePipeline");
  assert.ok(ownership > 0, "ownership check missing");
  assert.ok(pipeline > 0, "pipeline call missing");
  assert.ok(pipeline > ownership, "the pipeline must not run before ownership is established");
});

test("a failure to resolve the caller's organization is not swallowed as a 500", () => {
  const block = routeBlock(read("server", "routes.ts"), "post", ROUTE);
  assert.match(block, /handleOrgError\(error, res\)/);
});

test("the route is no longer carried in the unguarded-route allowlist", () => {
  // Guarding it makes the allowlist entry stale; leaving the entry behind
  // would silently pre-approve the route losing its guard again.
  const allowlist = JSON.parse(read("config", "public-routes.json"));
  const stillListed = allowlist.routes.some((r: any) => r.path === ROUTE);
  assert.equal(stillListed, false, "remove the entry from config/public-routes.json");
});

// ── The two defects in the same family, one file away ────────────────────────

test("campaign insights uses a module that exists", () => {
  const source = read("server", "scheduling-intelligence-routes.ts");
  assert.doesNotMatch(
    source,
    /services\/openai-service/,
    "that module does not exist; the endpoint threw for every caller",
  );
  // The file builds one client at module scope; handlers should use it.
  assert.match(source, /^const openai = new OpenAI\(/m);
});

test("the worst-campaigns list actually excludes pending approval", () => {
  const source = read("server", "scheduling-intelligence-routes.ts");
  // Number(status) is a number and never equals a string, so the filter
  // excluded nothing at all.
  assert.doesNotMatch(source, /Number\(c\.status\) !== 'pending_approval'/);
  assert.match(source, /c\.status !== 'pending_approval'/);
});
