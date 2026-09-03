import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { summarizeRevenueRows } from "../revenue-recognition";

test("ledger summary preserves negative margins instead of hiding them", () => {
  const summary = summarizeRevenueRows([
    { event_type: "revenue_recognized", total_cents: 10_103_00, event_count: 147 },
    { event_type: "coach_compensation_accrued", total_cents: 10_113_00, event_count: 147 },
  ]);

  assert.equal(summary.netOrgRevenueCents, -1_000);
  assert.equal(summary.dataQuality.hasNegativeNetRevenue, true);
});

test("ledger summary preserves overpayment and negative deferred balances", () => {
  const summary = summarizeRevenueRows([
    { event_type: "deferred_revenue_created", total_cents: 5_000, event_count: 1 },
    { event_type: "deferred_revenue_released", total_cents: 7_000, event_count: 2 },
    { event_type: "coach_compensation_accrued", total_cents: 8_000, event_count: 2 },
    { event_type: "coach_compensation_paid", total_cents: 9_000, event_count: 2 },
  ]);

  assert.equal(summary.deferredRevenueCents, -2_000);
  assert.equal(summary.coachPendingCents, -1_000);
  assert.equal(summary.dataQuality.hasNegativeDeferredRevenue, true);
  assert.equal(summary.dataQuality.hasCoachOverpayment, true);
});

test("revenue summary route cannot fall back to a cross-organization aggregate", () => {
  const source = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/admin/revenue-summary-v2"');
  const end = source.indexOf("// ── Financial Event Failure Queue", start);
  const block = source.slice(start, end);

  assert.match(block, /resolveOrgIdOrThrow\(req\)/);
  assert.match(block, /getRevenueLedgerSummary\(orgId, since\)/);
  assert.match(block, /AND rle\.org_id = \$\{orgId\}/);
  assert.doesNotMatch(block, /orgId \? sql|orgId \|\| null|WHERE 1=1/);
  assert.match(block, /handleOrgError\(error, res\)/);
});

test("redemptions clearly distinguish gross history from authoritative ledger revenue", () => {
  const source = readFileSync(new URL("../../client/src/pages/redemptions.tsx", import.meta.url), "utf8");
  assert.match(source, /Gross Redeemed Session Value/);
  assert.match(source, /Transactions for authoritative ledger revenue/);
});
