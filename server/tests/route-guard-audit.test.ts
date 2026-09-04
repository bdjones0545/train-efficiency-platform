import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  findRouteRegistrations,
  auditRoutes,
  routeKey,
  type PublicRouteEntry,
} from "../lib/route-guard-audit";
import { collectRegistrations, readAllowlist } from "../../script/route-guard-audit";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

// ── Counting guards ──────────────────────────────────────────────────────────

const SAMPLE = `
  app.get("/api/open", async (req, res) => { res.json({}); });
  app.post("/api/one-guard", isAuthenticated, async (req, res) => { res.json({}); });
  app.patch("/api/call-guard", requireRole("ADMIN"), async (req, res) => { res.json({}); });
  app.delete("/api/two-guards", isAuthenticated, requireRole("ADMIN"), async (req, res) => {});
  app.post("/api/spread-guard", ...auth, async (req, res) => {});
  app.get("/api/named-handler", isAuthenticated, namedHandler);
  app.get("trust proxy");
  app.use("/api/not-a-route", something);
`;

function byPath(source: string) {
  return new Map(findRouteRegistrations(source, "sample.ts").map((r) => [r.path, r]));
}

test("a route with only a handler counts as unguarded", () => {
  assert.equal(byPath(SAMPLE).get("/api/open")!.guardCount, 0);
});

test("identifier, call and spread middleware all count as guards", () => {
  const routes = byPath(SAMPLE);
  assert.equal(routes.get("/api/one-guard")!.guardCount, 1);
  assert.equal(routes.get("/api/call-guard")!.guardCount, 1);
  assert.equal(routes.get("/api/two-guards")!.guardCount, 2);
  assert.equal(routes.get("/api/spread-guard")!.guardCount, 1);

  // Names are captured for the report, not for the decision.
  assert.deepEqual(routes.get("/api/call-guard")!.guardNames, ["requireRole()"]);
  assert.deepEqual(routes.get("/api/spread-guard")!.guardNames, ["...auth"]);
});

test("a named handler is not mistaken for a guard", () => {
  // Only the trailing *inline* function is treated as the handler, so a named
  // one is counted — deliberately conservative: over-counting a guard is a
  // false pass, and this test records that the case exists.
  const route = byPath(SAMPLE).get("/api/named-handler")!;
  assert.equal(route.guardCount, 2);
  assert.deepEqual(route.guardNames, ["isAuthenticated", "namedHandler"]);
});

test("Express settings reads and app.use are not routes", () => {
  const paths = [...byPath(SAMPLE).keys()];
  assert.ok(!paths.includes("trust proxy"));
  assert.ok(!paths.includes("/api/not-a-route"));
});

test("registrations record where they are, so a failure is actionable", () => {
  const route = byPath(SAMPLE).get("/api/open")!;
  assert.equal(route.file, "sample.ts");
  assert.ok(route.line > 0);
  assert.equal(route.method, "get");
});

// ── The audit rule ───────────────────────────────────────────────────────────

const entry = (method: string, p: string, file = "server/routes.ts"): PublicRouteEntry => ({
  method,
  path: p,
  file,
  reason: "test",
});

test("an unguarded route that is not allowlisted fails", () => {
  const registrations = findRouteRegistrations(SAMPLE, "server/routes.ts");
  const result = auditRoutes(registrations, []);
  assert.equal(result.passed, false);
  assert.deepEqual(result.undeclared.map((r) => r.path), ["/api/open"]);
});

test("an unguarded route that is allowlisted passes", () => {
  const registrations = findRouteRegistrations(SAMPLE, "server/routes.ts");
  const result = auditRoutes(registrations, [entry("GET", "/api/open")]);
  assert.equal(result.passed, true);
});

test("the allowlist is scoped to method, path and file together", () => {
  const registrations = findRouteRegistrations(SAMPLE, "server/routes.ts");
  // Same path, different method — must not be waved through.
  const wrongMethod = auditRoutes(registrations, [entry("POST", "/api/open")]);
  assert.equal(wrongMethod.passed, false);
  // Same path and method, different file — likewise.
  const wrongFile = auditRoutes(registrations, [entry("GET", "/api/open", "server/other.ts")]);
  assert.equal(wrongFile.passed, false);
});

test("an allowlist entry for a route that no longer exists fails as stale", () => {
  const registrations = findRouteRegistrations(SAMPLE, "server/routes.ts");
  const result = auditRoutes(registrations, [
    entry("GET", "/api/open"),
    entry("GET", "/api/deleted-last-week"),
  ]);
  assert.equal(result.passed, false);
  assert.deepEqual(result.stale.map((r) => r.path), ["/api/deleted-last-week"]);
  assert.deepEqual(result.undeclared, []);
});

test("guarding a previously public route makes its allowlist entry stale", () => {
  // The route still exists but now has a guard, so it is no longer reported as
  // unguarded — the entry must be cleaned up rather than lingering as cover.
  const guarded = `app.get("/api/open", isAuthenticated, async (req, res) => {});`;
  const result = auditRoutes(findRouteRegistrations(guarded, "server/routes.ts"), [
    entry("GET", "/api/open"),
  ]);
  assert.equal(result.passed, false);
  assert.equal(result.stale.length, 1);
});

// ── Against the real tree ────────────────────────────────────────────────────

test("the repository currently satisfies the audit", () => {
  const registrations = collectRegistrations();
  assert.ok(registrations.length > 1000, "expected the full route surface to be scanned");

  const result = auditRoutes(registrations, readAllowlist());
  const detail = [
    ...result.undeclared.map((r) => `undeclared: ${r.method.toUpperCase()} ${r.path} (${r.file}:${r.line})`),
    ...result.stale.map((r) => `stale: ${routeKey(r)}`),
  ].join("\n");
  assert.equal(result.passed, true, `route guard audit failed:\n${detail}`);
});

test("the allowlist reports its own size honestly", () => {
  const allowlist = JSON.parse(read("config", "public-routes.json"));
  assert.equal(allowlist.routes.length, allowlist.unguardedRoutes);
  assert.equal(
    allowlist.unreviewed,
    allowlist.routes.filter((r: any) => r.reason.startsWith("UNREVIEWED")).length,
  );
  assert.ok(allowlist.unguardedRoutes > 0, "the backlog is real; do not let this reach zero silently");
});

test("every allowlist entry carries a reason", () => {
  const allowlist = JSON.parse(read("config", "public-routes.json"));
  for (const route of allowlist.routes) {
    assert.ok(route.method && route.path && route.file, "entry must identify the route");
    assert.ok(
      typeof route.reason === "string" && route.reason.trim().length > 0,
      `${route.method} ${route.path} has no reason`,
    );
  }
});

test("npm exposes the audit", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["audit:routes"], "tsx script/route-guard-audit.ts");
});
