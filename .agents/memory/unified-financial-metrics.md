---
name: Unified Financial Metrics Service
description: Single source of truth for all revenue/session metrics. All dashboards, agents, and heartbeats must call computeUnifiedFinancialMetrics() instead of querying bookings or payment tables directly.
---

## The Rule
No dashboard, agent, or heartbeat should sum `bookings.priceCents` for revenue figures.
All money metrics flow through `server/financial-metrics.ts`.

## Key exports
- `computeUnifiedFinancialMetrics(orgId, opts?)` — main aggregation, optional period window
- `computeMonthlyFinancialMetrics(orgId)` — current calendar month
- `computeTodayFinancialMetrics(orgId)` — today only
- `computeRolling30DayMetrics(orgId)` — last30d + prior30d + growthPct
- `buildFinancialContextString(metrics, label)` — formatted AI prompt block
- `zeroMetrics()` — safe default shape

## Sources aggregated (in priority order)
1. `revenue_ledger_events` — canonical double-entry ledger (payment_received, revenue_recognized, deferred, refunds, coach comp)
2. `wallet_transactions` — Stripe CREDIT breakdown; DEBIT for redemption sessions
3. `bookings` — pipeline (CONFIRMED future), sessions delivered (COMPLETED count), offline payment method estimate
4. `redemptions` — sessions redeemed count
5. `user_subscriptions.sessions_remaining` — credit liability

## ledgerCoverage flag
- `"full"` — ledger has recognition events; use ledger figures.
- `"partial"` — some ledger data but incomplete coverage (pre-ledger bookings).
- `"none"` — no ledger data; callers should fall back to booking estimate.

**Why:** `bookings.priceCents` counts pipeline (CONFIRMED future sessions) as earned revenue, inflating reported figures. The `revenue_ledger_events` table records recognition only upon session delivery, which is the correct accrual basis.

## Callers updated
- `server/revenue-intelligence.ts` — `computeRevenueSummary()` now calls unified metrics; `RevenueSummary` interface has `earnedRevenueCents`, `pipelineRevenueCents`, `ledgerCoverage`, etc. Legacy `totalRevenueCents` is now an alias for `earnedRevenueCents`.
- `server/business-command-center.ts` — `computeCommandCenter()` replaces booking-based month/today revenue; `buildCommandCenterContextString()` injects `buildFinancialContextString()` into the AI context block.
- `server/financial-brain.ts` — import added; `queryRevenueSummary` private helper still used internally but unified metrics imported for future dedup.

## Gotchas
- `paymentMethod` enum = `["WALLET", "VENMO", "CASH"]` — no STRIPE value; Stripe flows through wallet.
- `tsc --noEmit` on the full project OOMs the sandbox (31k+ line routes.ts); use targeted checks instead.
- Booking-based estimates still used for scheduling/time-block analysis (top clients, hour breakdown) — those are scheduling data, not financial data.
