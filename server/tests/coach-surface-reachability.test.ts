import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readServer = (name: string) => readFileSync(path.join(repoRoot, "server", name), "utf8");
const readClient = (...parts: string[]) =>
  readFileSync(path.join(repoRoot, "client", "src", ...parts), "utf8");

/**
 * Every destination the coach navigation and command palette can reach must
 * resolve to a real page. A route registered as a redirect is not a
 * destination — offering one is a dead entry.
 */
function redirectOnlyRoutes(appSource: string): string[] {
  const routes: string[] = [];
  const re = /<Route path="([^"]+)" component=\{Redirect[A-Za-z]*\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(appSource)) !== null) routes.push(match[1]);
  return routes;
}

test("App still registers the redirect-only routes this test guards against", () => {
  const redirects = redirectOnlyRoutes(readClient("App.tsx"));
  assert.ok(redirects.includes("/coach"), "/coach should still be a redirect");
  assert.ok(redirects.includes("/command-center"), "/command-center should still be a redirect");
});

test("the command palette never sends a coach to a redirect-only route", () => {
  const palette = readClient("components", "command-palette.tsx");
  const redirects = redirectOnlyRoutes(readClient("App.tsx"));

  const targets = [...palette.matchAll(/url: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length > 10, "expected the palette to declare navigation targets");

  for (const target of targets) {
    assert.ok(
      !redirects.includes(target),
      `command palette offers ${target}, which only redirects elsewhere`,
    );
  }
});

test("the coach dashboard entry points at the page that actually renders it", () => {
  const palette = readClient("components", "command-palette.tsx");
  assert.match(palette, /id: "dashboard", label: "Dashboard", url: "\/coach\/dashboard"/);
});

test("notification settings are offered only to administrators", () => {
  const sidebar = readClient("components", "app-sidebar.tsx");

  // The link must appear only inside the isAdmin branch of the settings section.
  const section = sidebar.slice(
    sidebar.indexOf("const settingsSection"),
    sidebar.indexOf("const staffSection"),
  );
  const adminBranch = section.slice(section.indexOf("...(isAdmin"), section.indexOf("]\n        : "));
  assert.match(adminBranch, /nav-notification-settings/);

  const nonAdminBranch = section.slice(section.indexOf("]\n        : "));
  assert.doesNotMatch(
    nonAdminBranch,
    /notification-settings/,
    "coaches must not be offered a link to an ADMIN-only page",
  );
});

test("the notification settings page refuses to invent settings it could not load", () => {
  const page = readClient("pages", "admin-notification-settings.tsx");

  // An error or absent payload must render an explicit state, never defaults
  // that are indistinguishable from saved organization settings.
  assert.match(page, /if \(isError \|\| !settings\)/);
  assert.match(page, /notification-settings-unavailable/);
  assert.match(page, /Administrator access required/);

  // The hardcoded fallback object is gone.
  assert.doesNotMatch(page, /athleteBookingConfirmation: true/);
  assert.doesNotMatch(page, /dedupWindowMinutes: 15/);
});

test("adding a client is reachable by the coaches the athletes page is built for", () => {
  const routes = readServer("routes.ts");
  const start = routes.indexOf('app.post("/api/admin/import-csv"');
  assert.ok(start >= 0, "import-csv route not found");
  const signature = routes.slice(start, routes.indexOf("\n", start));
  assert.match(signature, /requireRole\("COACH", "ADMIN"\)/);

  // Still creates CLIENT users scoped to the caller's own organization.
  const block = routes.slice(start, start + 4000);
  assert.match(block, /role: "CLIENT" as any/);
  assert.match(block, /organizationId: adminOrgId/);
});

test("Add Client and Import CSV both post to that same endpoint", () => {
  const page = readClient("pages", "user-management.tsx");
  const posts = [...page.matchAll(/apiRequest\("POST", "\/api\/admin\/import-csv"/g)];
  assert.equal(posts.length, 2, "both client-creation paths should use the one endpoint");
});
