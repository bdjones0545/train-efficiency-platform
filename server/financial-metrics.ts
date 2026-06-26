/**
 * Unified Financial Metrics Service
 *
 * Single source of truth for ALL financial aggregations in Train Efficiency.
 *
 * RULE: No dashboard, agent, command center, or heartbeat should compute revenue
 * directly from bookings.priceCents or query payment tables independently.
 * All financial metrics must flow through computeUnifiedFinancialMetrics().
 *
 * Payment sources aggregated:
 *   - revenue_ledger_events  (canonical double-entry ledger)
 *   - wallet_transactions    (Stripe-connected payments)
 *   - bookings.paymentMethod (offline cash/Venmo — for breakdown only)
 *
 * Service delivery sources aggregated:
 *   - redemptions            (sessions claimed by coaches)
 *   - bookings.status=COMPLETED
 *   - user_subscriptions.sessions_remaining
 *
 * SAFETY: This service is strictly READ-ONLY.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentBreakdown {
  stripe: number;
  wallet: number;
  cash: number;
  venmo: number;
  other: number;
}

export interface RevenueBySource {
  ledger: number;
  bookingEstimate: number;
}

export interface UnifiedFinancialMetrics {
  // ─── Cash collected (actual money in) ───────────────────────────────────────
  /** Sum of all payment_received events in revenue_ledger_events. Canonical total. */
  cashCollected: number;
  /** Wallet CREDIT transactions linked to a Stripe PaymentIntent (online payments). */
  stripeCollected: number;
  /** Wallet DEBIT transactions sourced from redemptions (sessions consumed from wallet). */
  walletDebited: number;
  /** COMPLETED bookings with paymentMethod=CASH — offline cash estimate. */
  cashCollectedOffline: number;
  /** COMPLETED bookings with paymentMethod=VENMO — offline Venmo estimate. */
  venmoCollected: number;
  /** stripeCollected + cashCollectedOffline + venmoCollected (canonical = cashCollected from ledger). */
  totalCollected: number;

  // ─── Revenue recognition (accrual accounting) ────────────────────────────────
  /** Sum of revenue_recognized events — service actually delivered. */
  recognizedRevenue: number;
  /** deferred_revenue_created minus deferred_revenue_released — prepaid undelivered liability. */
  deferredRevenue: number;

  // ─── Pipeline (booked but not yet delivered or paid) ─────────────────────────
  /** CONFIRMED future bookings × priceCents — scheduling pipeline, NOT earned revenue. */
  pipelineRevenue: number;

  // ─── Service delivery ─────────────────────────────────────────────────────────
  /** Count of bookings with status=COMPLETED in the period. */
  sessionsDelivered: number;
  /** Count of redemption rows created in the period (coach-claimed payouts). */
  sessionsRedeemed: number;
  /** Sum of sessions_remaining across all active subscriptions for this org. */
  sessionsRemaining: number;
  /** Number of active subscriptions carrying session credits. */
  activeSubscribersWithCredits: number;

  // ─── Outstanding liability ────────────────────────────────────────────────────
  /** Prepaid sessions not yet delivered (mirrors deferredRevenue). */
  outstandingPackageLiability: number;

  // ─── Refunds & adjustments ───────────────────────────────────────────────────
  /** Sum of refund_issued events. */
  refunds: number;
  /** Sum of manual_adjustment events. */
  manualAdjustments: number;

  // ─── Coach compensation ───────────────────────────────────────────────────────
  /** Sum of coach_compensation_accrued events. */
  coachCompAccrued: number;
  /** Sum of coach_compensation_paid events. */
  coachCompPaid: number;
  /** coachCompAccrued - coachCompPaid — owed to coaches. */
  coachCompPending: number;

  // ─── Net position ─────────────────────────────────────────────────────────────
  /** recognizedRevenue - refunds. */
  netRevenue: number;
  /** cashCollected - coachCompPaid - refunds. */
  outstandingBalance: number;

  // ─── Breakdowns ───────────────────────────────────────────────────────────────
  paymentBreakdown: PaymentBreakdown;
  revenueBySource: RevenueBySource;

  // ─── Period context ───────────────────────────────────────────────────────────
  periodStart: Date | null;
  periodEnd: Date | null;
  lastUpdated: Date;

  // ─── Data quality ─────────────────────────────────────────────────────────────
  /** true if revenue_ledger_events has any rows for this org/period. */
  hasLedgerData: boolean;
  /**
   * "full"    — ledger data covers the period and recognition events exist.
   * "partial" — some ledger data but recognition may be incomplete (pre-ledger bookings).
   * "none"    — no ledger data; all figures are booking-based estimates.
   */
  ledgerCoverage: "full" | "partial" | "none";
}

export interface UnifiedFinancialOptions {
  /** Start of the reporting period. Defaults to all-time (no lower bound). */
  periodStart?: Date;
  /** End of the reporting period. Defaults to now. */
  periodEnd?: Date;
}

// ─── Zero value (safe default) ───────────────────────────────────────────────

export function zeroMetrics(orgId?: string): UnifiedFinancialMetrics {
  return {
    cashCollected: 0,
    stripeCollected: 0,
    walletDebited: 0,
    cashCollectedOffline: 0,
    venmoCollected: 0,
    totalCollected: 0,
    recognizedRevenue: 0,
    deferredRevenue: 0,
    pipelineRevenue: 0,
    sessionsDelivered: 0,
    sessionsRedeemed: 0,
    sessionsRemaining: 0,
    activeSubscribersWithCredits: 0,
    outstandingPackageLiability: 0,
    refunds: 0,
    manualAdjustments: 0,
    coachCompAccrued: 0,
    coachCompPaid: 0,
    coachCompPending: 0,
    netRevenue: 0,
    outstandingBalance: 0,
    paymentBreakdown: { stripe: 0, wallet: 0, cash: 0, venmo: 0, other: 0 },
    revenueBySource: { ledger: 0, bookingEstimate: 0 },
    periodStart: null,
    periodEnd: null,
    lastUpdated: new Date(),
    hasLedgerData: false,
    ledgerCoverage: "none",
  };
}

// ─── Main aggregation function ────────────────────────────────────────────────

/**
 * Compute unified financial metrics for an organization.
 *
 * This is the ONLY function that should be used to compute revenue, session
 * delivery, and payment breakdown metrics. All dashboards, agents, and
 * heartbeat services must call this instead of querying bookings or payment
 * tables directly.
 */
export async function computeUnifiedFinancialMetrics(
  orgId: string,
  opts: UnifiedFinancialOptions = {}
): Promise<UnifiedFinancialMetrics> {
  const now = new Date();
  const periodEnd = opts.periodEnd ?? now;
  const periodStart = opts.periodStart ?? null;

  try {
    // ── 1. Revenue Ledger — canonical financial source ──────────────────────
    const ledgerResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN event_type = 'payment_received'          THEN amount_cents ELSE 0 END), 0)::int AS cash_collected,
        COALESCE(SUM(CASE WHEN event_type = 'revenue_recognized'        THEN amount_cents ELSE 0 END), 0)::int AS recognized,
        COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_created'  THEN amount_cents ELSE 0 END), 0)::int AS deferred_created,
        COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_released' THEN amount_cents ELSE 0 END), 0)::int AS deferred_released,
        COALESCE(SUM(CASE WHEN event_type = 'refund_issued'             THEN amount_cents ELSE 0 END), 0)::int AS refunded,
        COALESCE(SUM(CASE WHEN event_type = 'manual_adjustment'         THEN amount_cents ELSE 0 END), 0)::int AS manual_adj,
        COALESCE(SUM(CASE WHEN event_type = 'coach_compensation_accrued' THEN amount_cents ELSE 0 END), 0)::int AS coach_accrued,
        COALESCE(SUM(CASE WHEN event_type = 'coach_compensation_paid'   THEN amount_cents ELSE 0 END), 0)::int AS coach_paid,
        COUNT(*)::int AS total_events,
        COUNT(CASE WHEN event_type = 'revenue_recognized' THEN 1 END)::int AS recognition_count
      FROM revenue_ledger_events
      WHERE org_id = ${orgId}
        ${periodStart ? sql`AND created_at >= ${periodStart}` : sql``}
        AND created_at <= ${periodEnd}
    `);

    const lr = (ledgerResult.rows[0] ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" ? v : parseInt(String(v ?? "0"), 10) || 0);

    const cashCollected      = n(lr.cash_collected);
    const recognizedRevenue  = n(lr.recognized);
    const deferredCreated    = n(lr.deferred_created);
    const deferredReleased   = n(lr.deferred_released);
    const refunds            = n(lr.refunded);
    const manualAdjustments  = n(lr.manual_adj);
    const coachCompAccrued   = n(lr.coach_accrued);
    const coachCompPaid      = n(lr.coach_paid);
    const totalLedgerEvents  = n(lr.total_events);
    const recognitionCount   = n(lr.recognition_count);

    const deferredRevenue = Math.max(0, deferredCreated - deferredReleased);

    // ── 2. Stripe payments — via wallet_transactions CREDIT rows ─────────────
    const stripeResult = await db.execute(sql`
      SELECT COALESCE(SUM(wt.amount_cents), 0)::int AS stripe_collected,
             COALESCE(SUM(CASE WHEN wt.source_type = 'redemption' THEN wt.amount_cents ELSE 0 END), 0)::int AS wallet_debited
      FROM wallet_transactions wt
      JOIN user_profiles up ON up.user_id = wt.user_id
      WHERE up.organization_id = ${orgId}
        AND wt.type = 'CREDIT'
        AND wt.stripe_payment_intent_id IS NOT NULL
        ${periodStart ? sql`AND wt.created_at >= ${periodStart}` : sql``}
        AND wt.created_at <= ${periodEnd}
    `);

    const stripeRow = (stripeResult.rows[0] ?? {}) as Record<string, unknown>;
    const stripeCollected = n(stripeRow.stripe_collected);

    // Wallet debits for redemptions (sessions consumed from wallet balance)
    const walletDebitResult = await db.execute(sql`
      SELECT COALESCE(SUM(wt.amount_cents), 0)::int AS wallet_debited
      FROM wallet_transactions wt
      JOIN user_profiles up ON up.user_id = wt.user_id
      WHERE up.organization_id = ${orgId}
        AND wt.type = 'DEBIT'
        AND wt.source_type = 'redemption'
        ${periodStart ? sql`AND wt.created_at >= ${periodStart}` : sql``}
        AND wt.created_at <= ${periodEnd}
    `);
    const walletDebitRow = (walletDebitResult.rows[0] ?? {}) as Record<string, unknown>;
    const walletDebited = n(walletDebitRow.wallet_debited);

    // ── 3. Offline payments — from bookings.payment_method (estimate) ─────────
    const offlineResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN b.payment_method = 'CASH'  THEN COALESCE(s.price_cents, 0) ELSE 0 END), 0)::int AS cash_offline,
        COALESCE(SUM(CASE WHEN b.payment_method = 'VENMO' THEN COALESCE(s.price_cents, 0) ELSE 0 END), 0)::int AS venmo_offline
      FROM bookings b
      JOIN coach_profiles cp ON cp.id = b.coach_id
      LEFT JOIN services s ON s.id = b.service_id
      WHERE cp.organization_id = ${orgId}
        AND b.status = 'COMPLETED'
        AND b.payment_method IN ('CASH', 'VENMO')
        ${periodStart ? sql`AND b.start_at >= ${periodStart}` : sql``}
        AND b.start_at <= ${periodEnd}
    `);
    const offlineRow = (offlineResult.rows[0] ?? {}) as Record<string, unknown>;
    const cashCollectedOffline = n(offlineRow.cash_offline);
    const venmoCollected       = n(offlineRow.venmo_offline);

    // ── 4. Sessions delivered and pipeline ────────────────────────────────────
    const sessionResult = await db.execute(sql`
      SELECT
        COUNT(CASE WHEN b.status = 'COMPLETED' THEN 1 END)::int AS sessions_delivered,
        COALESCE(SUM(CASE
          WHEN b.status = 'CONFIRMED'
           AND b.start_at > ${now}
           AND COALESCE(s.counts_toward_revenue, true) = true
          THEN COALESCE(s.price_cents, 0) ELSE 0
        END), 0)::int AS pipeline_revenue
      FROM bookings b
      JOIN coach_profiles cp ON cp.id = b.coach_id
      LEFT JOIN services s ON s.id = b.service_id
      WHERE cp.organization_id = ${orgId}
        ${periodStart ? sql`AND b.start_at >= ${periodStart}` : sql``}
        AND b.start_at <= ${periodEnd}
    `);
    const sessRow = (sessionResult.rows[0] ?? {}) as Record<string, unknown>;
    const sessionsDelivered = n(sessRow.sessions_delivered);
    const pipelineRevenue   = n(sessRow.pipeline_revenue);

    // ── 5. Redemptions count ──────────────────────────────────────────────────
    const redemptionResult = await db.execute(sql`
      SELECT COUNT(r.id)::int AS sessions_redeemed
      FROM redemptions r
      JOIN coach_profiles cp ON cp.id = r.coach_id
      WHERE cp.organization_id = ${orgId}
        ${periodStart ? sql`AND r.redeemed_at >= ${periodStart}` : sql``}
        AND r.redeemed_at <= ${periodEnd}
    `);
    const redemRow = (redemptionResult.rows[0] ?? {}) as Record<string, unknown>;
    const sessionsRedeemed = n(redemRow.sessions_redeemed);

    // ── 6. Session credits remaining ──────────────────────────────────────────
    const creditsResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN sessions_remaining > 0 THEN sessions_remaining ELSE 0 END), 0)::int AS sessions_remaining,
        COUNT(CASE WHEN sessions_remaining > 0 THEN 1 END)::int AS subscribers_with_credits
      FROM user_subscriptions
      WHERE organization_id = ${orgId}
        AND status = 'active'
    `);
    const credRow = (creditsResult.rows[0] ?? {}) as Record<string, unknown>;
    const sessionsRemaining          = n(credRow.sessions_remaining);
    const activeSubscribersWithCredits = n(credRow.subscribers_with_credits);

    // ── 7. Derived aggregates ─────────────────────────────────────────────────
    const coachCompPending       = Math.max(0, coachCompAccrued - coachCompPaid);
    const netRevenue             = Math.max(0, recognizedRevenue - refunds);
    const outstandingBalance     = cashCollected - coachCompPaid - refunds;
    const outstandingPackageLiability = deferredRevenue;

    // Use ledger as canonical total; fall back to stripe + offline estimate
    const totalCollected = cashCollected > 0
      ? cashCollected
      : stripeCollected + cashCollectedOffline + venmoCollected;

    // ── 8. Payment breakdown ──────────────────────────────────────────────────
    // Stripe: from wallet CREDIT with stripe reference
    // Wallet: debited at redemption time (already paid via stripe or manual credit)
    // Cash/Venmo: offline estimate from bookings
    // Other: remainder (totalCollected - stripe - offline)
    const knownBreakdown = stripeCollected + cashCollectedOffline + venmoCollected;
    const other = Math.max(0, totalCollected - knownBreakdown);

    const paymentBreakdown: PaymentBreakdown = {
      stripe: stripeCollected,
      wallet: walletDebited,
      cash: cashCollectedOffline,
      venmo: venmoCollected,
      other,
    };

    // ── 9. Data quality ───────────────────────────────────────────────────────
    const hasLedgerData = totalLedgerEvents > 0;
    let ledgerCoverage: "full" | "partial" | "none" = "none";
    if (hasLedgerData && recognitionCount > 0) {
      ledgerCoverage = recognitionCount >= sessionsRedeemed * 0.8 ? "full" : "partial";
    } else if (hasLedgerData) {
      ledgerCoverage = "partial";
    }

    return {
      cashCollected,
      stripeCollected,
      walletDebited,
      cashCollectedOffline,
      venmoCollected,
      totalCollected,
      recognizedRevenue,
      deferredRevenue,
      pipelineRevenue,
      sessionsDelivered,
      sessionsRedeemed,
      sessionsRemaining,
      activeSubscribersWithCredits,
      outstandingPackageLiability,
      refunds,
      manualAdjustments,
      coachCompAccrued,
      coachCompPaid,
      coachCompPending,
      netRevenue,
      outstandingBalance,
      paymentBreakdown,
      revenueBySource: {
        ledger: recognizedRevenue,
        bookingEstimate: pipelineRevenue + sessionsDelivered * 0, // pipeline only; delivered is in ledger
      },
      periodStart: periodStart ?? null,
      periodEnd,
      lastUpdated: new Date(),
      hasLedgerData,
      ledgerCoverage,
    };
  } catch (err: any) {
    console.error(`[financial-metrics] computeUnifiedFinancialMetrics failed for org ${orgId}:`, err?.message ?? err);
    return {
      ...zeroMetrics(orgId),
      periodStart: opts.periodStart ?? null,
      periodEnd,
    };
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Get current-month metrics for an org.
 * Used by command centers and monthly goal tracking.
 */
export async function computeMonthlyFinancialMetrics(orgId: string): Promise<UnifiedFinancialMetrics> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return computeUnifiedFinancialMetrics(orgId, { periodStart, periodEnd });
}

/**
 * Get today's metrics for an org.
 * Used by daily command center revenue figures.
 */
export async function computeTodayFinancialMetrics(orgId: string): Promise<UnifiedFinancialMetrics> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return computeUnifiedFinancialMetrics(orgId, { periodStart, periodEnd });
}

/**
 * Get last-30-day and prior-30-day metrics for growth calculations.
 */
export async function computeRolling30DayMetrics(orgId: string): Promise<{
  last30d: UnifiedFinancialMetrics;
  prior30d: UnifiedFinancialMetrics;
  growthPct: number;
}> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo  = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [last30d, prior30d] = await Promise.all([
    computeUnifiedFinancialMetrics(orgId, { periodStart: thirtyDaysAgo, periodEnd: now }),
    computeUnifiedFinancialMetrics(orgId, { periodStart: sixtyDaysAgo, periodEnd: thirtyDaysAgo }),
  ]);

  const growthPct = prior30d.recognizedRevenue > 0
    ? Math.round(((last30d.recognizedRevenue - prior30d.recognizedRevenue) / prior30d.recognizedRevenue) * 100)
    : 0;

  return { last30d, prior30d, growthPct };
}

// ─── Formatted summary string (for AI agent context) ─────────────────────────

/**
 * Build a compact financial context string for injection into AI agent prompts.
 * This replaces the booking-priceCents-based revenue lines in buildCommandCenterContextString.
 */
export function buildFinancialContextString(
  metrics: UnifiedFinancialMetrics,
  label = "Current period"
): string {
  const fmt = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const coverageNote = metrics.ledgerCoverage === "none"
    ? " [estimate — ledger not yet populated]"
    : metrics.ledgerCoverage === "partial"
      ? " [partial ledger coverage]"
      : "";

  const lines: string[] = [
    `FINANCIAL SUMMARY (${label}${coverageNote}):`,
    `  Cash collected: ${fmt(metrics.cashCollected)} | Recognized revenue: ${fmt(metrics.recognizedRevenue)}${coverageNote}`,
    `  Deferred liability: ${fmt(metrics.deferredRevenue)} | Pipeline (booked, not earned): ${fmt(metrics.pipelineRevenue)}`,
    `  Sessions delivered: ${metrics.sessionsDelivered} | Sessions redeemed: ${metrics.sessionsRedeemed} | Sessions remaining (credits): ${metrics.sessionsRemaining}`,
    `  Refunds: ${fmt(metrics.refunds)} | Net revenue: ${fmt(metrics.netRevenue)}`,
    `  Coach comp pending: ${fmt(metrics.coachCompPending)}`,
  ];

  if (metrics.paymentBreakdown.stripe > 0 || metrics.paymentBreakdown.cash > 0 || metrics.paymentBreakdown.venmo > 0) {
    lines.push(
      `  Payment sources: Stripe ${fmt(metrics.paymentBreakdown.stripe)} | Cash ${fmt(metrics.paymentBreakdown.cash)} | Venmo ${fmt(metrics.paymentBreakdown.venmo)}`
    );
  }

  return lines.join("\n");
}
