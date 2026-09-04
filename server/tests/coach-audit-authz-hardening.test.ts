import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { toPublicOrg, toDirectoryOrg } from "../lib/org-visibility";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(serverDir, name), "utf8");

function routeBlock(source: string, method: string, routePath: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.includes(`app.${method}("${routePath}"`));
  assert.ok(start >= 0, `${method.toUpperCase()} ${routePath} not found`);
  let block = lines[start];
  for (let i = start + 1; i < lines.length && !/app\.(get|post|put|patch|delete)\(/.test(lines[i]); i++) {
    block += `\n${lines[i]}`;
  }
  return block;
}

// ── Organization projections (behavioural) ───────────────────────────────────

/**
 * Mirrors the shape storage returns. Deliberately includes every sensitive
 * column so that adding one to the schema without updating the projection
 * fails here rather than in production.
 */
function organizationRow() {
  return {
    id: "org-1",
    name: "Efficiency Strength",
    slug: "efficiency",
    logoUrl: "https://example.test/logo.png",
    primaryColor: "#112233",
    secondaryColor: "#445566",
    tagline: "Train efficiently",
    athleticEnabled: true,
    coachTransactionsVisible: false,
    requireLoginToBook: true,
    timezone: "America/New_York",
    ownerEmail: "owner@example.test",
    ownerUserId: "user-owner",
    stripeSecretKey: "sk_live_secret",
    stripePublishableKey: "pk_live_publishable",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    subscriptionStatus: "active",
    subscriptionCurrentPeriodEnd: "2026-12-01",
    trialEndsAt: "2026-01-01",
    schedulingInquiryEmail: "inquiries@example.test",
    schedulingInquiryName: "Front Desk",
    automationLevel: "supervised",
  };
}

const SENSITIVE_FIELDS = [
  "ownerEmail",
  "ownerUserId",
  "stripeSecretKey",
  "stripePublishableKey",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "subscriptionStatus",
  "subscriptionCurrentPeriodEnd",
  "trialEndsAt",
  "schedulingInquiryEmail",
  "schedulingInquiryName",
  "automationLevel",
];

test("toPublicOrg removes owner identity, Stripe configuration and billing state", () => {
  const publicOrg = toPublicOrg(organizationRow()) as Record<string, unknown>;
  for (const field of SENSITIVE_FIELDS) {
    assert.ok(!(field in publicOrg), `${field} must not be exposed to non-members`);
  }
});

test("toPublicOrg keeps the branding and feature flags public org pages render", () => {
  const publicOrg = toPublicOrg(organizationRow()) as Record<string, unknown>;
  assert.equal(publicOrg.name, "Efficiency Strength");
  assert.equal(publicOrg.slug, "efficiency");
  assert.equal(publicOrg.logoUrl, "https://example.test/logo.png");
  assert.equal(publicOrg.primaryColor, "#112233");
  assert.equal(publicOrg.athleticEnabled, true);
  assert.equal(publicOrg.requireLoginToBook, true);
  assert.equal(publicOrg.timezone, "America/New_York");
});

test("toDirectoryOrg is an allowlist — an unknown column is never enumerated", () => {
  const withNewColumn = { ...organizationRow(), internalRiskScore: 97 };
  const entry = toDirectoryOrg(withNewColumn) as Record<string, unknown>;
  assert.deepEqual(Object.keys(entry).sort(), [
    "id",
    "logoUrl",
    "name",
    "primaryColor",
    "slug",
    "tagline",
  ]);
  assert.ok(!("internalRiskScore" in entry));
  for (const field of SENSITIVE_FIELDS) {
    assert.ok(!(field in entry), `${field} must not appear in the public directory`);
  }
});

// ── Route wiring ─────────────────────────────────────────────────────────────

test("the public organization directory returns only the directory projection", () => {
  const block = routeBlock(read("routes.ts"), "get", "/api/organizations");
  assert.match(block, /toDirectoryOrg/);
  assert.doesNotMatch(block, /\.\.\.rest/);
});

test("organization reads withhold member-only fields from non-members", () => {
  const routes = read("routes.ts");
  for (const routePath of ["/api/organizations/by-id/:id", "/api/organizations/:slug"]) {
    const block = routeBlock(routes, "get", routePath);
    assert.match(block, /isOrgMember\(req, org\.id\)/, `${routePath} must check membership`);
    assert.match(block, /toPublicOrg\(safeOrg\)/, `${routePath} must project for non-members`);
  }
});

test("by-id withholds owner name and Stripe connection state from non-members", () => {
  const block = routeBlock(read("routes.ts"), "get", "/api/organizations/by-id/:id");
  const memberGate = block.indexOf("isOrgMember");
  const ownerName = block.indexOf("stripeConnected");
  assert.ok(memberGate >= 0 && ownerName > memberGate,
    "stripeConnected/ownerName must be computed only after the membership gate");
});

test("athletic booking cancellation requires the booker or org staff", () => {
  const block = routeBlock(read("routes.ts"), "delete", "/api/athletic/bookings/:id");

  // Staff must belong to the booking's own organization.
  assert.match(block, /auth\.orgId === existing\.organizationId/);
  assert.match(block, /\["admin", "coach", "staff", "owner"\]\.includes\(auth\.role\)/);

  // The booker path must match the booking's stored org user, and the session
  // lookup must be scoped to the booking's organization.
  assert.match(block, /session\.userId === existing\.orgUserId/);
  assert.match(block, /eq\(orgSessions\.orgId, existing\.organizationId\)/);

  // Fail closed, and never again gate solely on requireLoginToBook.
  assert.match(block, /if \(!isOrgStaff && !isBooker\)/);
  assert.match(block, /ATHLETIC_CANCEL_FORBIDDEN/);
  assert.doesNotMatch(block, /requireLoginToBook/);
});

test("organization-wide revenue reads honour coachTransactionsVisible", () => {
  const routes = read("routes.ts");
  const gated = [
    ["get", "/api/coach/transactions"],
    ["get", "/api/coach/user-balances"],
    ["get", "/api/coach/stripe-subscription-transactions"],
    ["get", "/api/admin/revenue-summary-v2"],
  ] as const;
  for (const [method, routePath] of gated) {
    const block = routeBlock(routes, method, routePath);
    assert.match(block, /requireCoachRevenueAccess/, `${routePath} must enforce the org setting`);
  }
});

test("the public athletic page sends its org session token when cancelling", () => {
  const page = readFileSync(
    path.join(serverDir, "..", "client", "src", "pages", "athletic-scheduling.tsx"),
    "utf8",
  );
  const start = page.indexOf("const deleteMutation");
  assert.ok(start >= 0, "deleteMutation not found");
  const block = page.slice(start, page.indexOf("const getSlotBookings", start));

  // Without this header the server cannot identify the booker, so every
  // cancellation from the public program page would fail closed.
  assert.match(block, /headers\["X-Org-Auth-Token"\] = orgToken/);
  assert.match(block, /method: "DELETE",\n\s+headers,/);
});

test("the coach revenue guard blocks only COACH, and fails closed on the setting", () => {
  const guard = read("lib/require-coach-revenue-access.ts");
  assert.match(guard, /if \(role !== "COACH"\) return next\(\);/);
  assert.match(guard, /coachTransactionsVisible === false/);
  assert.match(guard, /COACH_TRANSACTIONS_HIDDEN/);
});
