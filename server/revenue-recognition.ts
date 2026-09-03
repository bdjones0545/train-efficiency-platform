/**
 * Revenue Recognition Engine
 *
 * Writes immutable ledger events to revenue_ledger_events.
 * All functions are fire-and-forget safe — a write failure logs a warning
 * but never breaks the calling request.
 *
 * Core principle:
 *   payment collected ≠ revenue earned
 *   Revenue is recognized only when a session is completed AND redeemed.
 */

import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";

async function writeRevenueEvent(data: {
  orgId?: string | null;
  clientId?: string | null;
  coachId?: string | null;
  bookingId?: string | null;
  redemptionId?: string | null;
  eventType:
    | "payment_received"
    | "revenue_recognized"
    | "deferred_revenue_created"
    | "deferred_revenue_released"
    | "coach_compensation_accrued"
    | "coach_compensation_paid"
    | "refund_issued"
    | "cancellation_reversal"
    | "manual_adjustment";
  amountCents: number;
  reason: string;
  sourceAction: string;
  createdBy?: string | null;
  idempotencyKey: string;
}): Promise<void> {
  try {
    await storage.createRevenueLedgerEvent({
      orgId: data.orgId ?? null,
      clientId: data.clientId ?? null,
      coachId: data.coachId ?? null,
      bookingId: data.bookingId ?? null,
      redemptionId: data.redemptionId ?? null,
      eventType: data.eventType,
      amountCents: data.amountCents,
      reason: data.reason,
      sourceAction: data.sourceAction,
      createdBy: data.createdBy ?? null,
      idempotencyKey: data.idempotencyKey,
    });
  } catch (e: any) {
    // Unique constraint violation = idempotent duplicate — safe to ignore
    if (e?.code === "23505") return;
    const msg = e?.message ?? String(e);
    console.warn(
      `[revenue-recognition] Failed to write ${data.eventType} event (key: ${data.idempotencyKey}): ${msg}`
    );
    // Capture into durable failure queue
    try {
      await storage.createFinancialEventFailure({
        orgId: data.orgId ?? null,
        clientId: data.clientId ?? null,
        coachId: data.coachId ?? null,
        bookingId: data.bookingId ?? null,
        redemptionId: data.redemptionId ?? null,
        sourceType: "revenue_ledger",
        eventType: data.eventType,
        payload: { ...data } as any,
        idempotencyKey: data.idempotencyKey ?? null,
        failureMessage: msg,
        attempts: 1,
        status: "pending",
        lastAttemptAt: new Date(),
      });
    } catch (queueErr: any) {
      console.error("[revenue-recognition] CRITICAL: failure queue insert failed:", queueErr?.message ?? queueErr);
    }
  }
}

// ── Payment Received ──────────────────────────────────────────────────────────
// Called whenever a client pays money into their wallet (Stripe deposit, cash,
// Venmo). For subscription invoices, also creates a deferred revenue event.

export async function onPaymentReceived(opts: {
  orgId: string | null;
  clientId: string;
  amountCents: number;
  walletTxId: string;
  isSubscriptionPayment?: boolean;
  createdBy?: string | null;
}): Promise<void> {
  const { orgId, clientId, amountCents, walletTxId, isSubscriptionPayment, createdBy } = opts;

  await writeRevenueEvent({
    orgId,
    clientId,
    eventType: "payment_received",
    amountCents,
    reason: isSubscriptionPayment
      ? "Subscription invoice payment received"
      : "Client payment received",
    sourceAction: isSubscriptionPayment ? "stripe_subscription" : "wallet_deposit",
    createdBy,
    idempotencyKey: `payment_received:${walletTxId}`,
  });

  if (isSubscriptionPayment) {
    await writeRevenueEvent({
      orgId,
      clientId,
      eventType: "deferred_revenue_created",
      amountCents,
      reason: "Deferred revenue created: subscription payment funds future sessions",
      sourceAction: "stripe_subscription",
      createdBy,
      idempotencyKey: `deferred_revenue_created:${walletTxId}`,
    });
  }
}

// ── Session Redemption (main recognition event) ───────────────────────────────
// Called in POST /api/redemptions after the redemption record is created.
// Writes revenue_recognized + coach_compensation_accrued.
// For subscription sessions also writes deferred_revenue_released.

export async function onRedemption(opts: {
  orgId: string | null;
  clientId: string;
  coachId: string;
  bookingId: string;
  redemptionId: string;
  recognizedAmountCents: number;
  coachCompensationCents: number;
  isSubscriptionSession: boolean;
  createdBy?: string | null;
}): Promise<void> {
  const {
    orgId,
    clientId,
    coachId,
    bookingId,
    redemptionId,
    recognizedAmountCents,
    coachCompensationCents,
    isSubscriptionSession,
    createdBy,
  } = opts;

  // 1. Revenue recognized
  await writeRevenueEvent({
    orgId,
    clientId,
    coachId,
    bookingId,
    redemptionId,
    eventType: "revenue_recognized",
    amountCents: recognizedAmountCents,
    reason: "Revenue recognized: session completed and redeemed",
    sourceAction: "redemption",
    createdBy,
    idempotencyKey: `revenue_recognized:${redemptionId}`,
  });

  // 2. For subscription sessions: release deferred revenue
  if (isSubscriptionSession && recognizedAmountCents > 0) {
    await writeRevenueEvent({
      orgId,
      clientId,
      coachId,
      bookingId,
      redemptionId,
      eventType: "deferred_revenue_released",
      amountCents: recognizedAmountCents,
      reason: "Deferred revenue released: subscription session delivered",
      sourceAction: "redemption",
      createdBy,
      idempotencyKey: `deferred_revenue_released:${redemptionId}`,
    });
  }

  // 3. Coach compensation accrued
  if (coachCompensationCents > 0) {
    await writeRevenueEvent({
      orgId,
      clientId,
      coachId,
      bookingId,
      redemptionId,
      eventType: "coach_compensation_accrued",
      amountCents: coachCompensationCents,
      reason: "Coach compensation accrued: session redeemed",
      sourceAction: "redemption",
      createdBy,
      idempotencyKey: `coach_compensation_accrued:${redemptionId}`,
    });
  }
}

// ── Cashout Paid ──────────────────────────────────────────────────────────────
// Called when admin marks a cashout as PAID.

export async function onCashoutPaid(opts: {
  orgId: string | null;
  coachId: string;
  cashoutId: string;
  amountCents: number;
  createdBy?: string | null;
}): Promise<void> {
  const { orgId, coachId, cashoutId, amountCents, createdBy } = opts;
  await writeRevenueEvent({
    orgId,
    coachId,
    eventType: "coach_compensation_paid",
    amountCents,
    reason: "Coach compensation paid via cashout",
    sourceAction: "cashout_paid",
    createdBy,
    idempotencyKey: `coach_compensation_paid:${cashoutId}`,
  });
}

// ── Revenue Ledger Summary ────────────────────────────────────────────────────
// Used by GET /api/admin/revenue-summary-v2 — can also be called from any
// reporting context that needs the structured financial breakdown.

export interface RevenueLedgerSummary {
  collectedRevenueCents: number;
  recognizedRevenueCents: number;
  deferredRevenueCents: number;
  deferredCreatedCents: number;
  deferredReleasedCents: number;
  coachAccruedCents: number;
  coachPaidCents: number;
  coachPendingCents: number;
  refundedCents: number;
  netOrgRevenueCents: number;
  eventCounts: Record<string, number>;
  dataQuality: {
    hasNegativeDeferredRevenue: boolean;
    hasCoachOverpayment: boolean;
    hasNegativeNetRevenue: boolean;
  };
}

type RevenueAggregateRow = { event_type: string; total_cents: number; event_count: number };

export function summarizeRevenueRows(rows: RevenueAggregateRow[]): RevenueLedgerSummary {
  const totals = new Map(rows.map((row) => [row.event_type, Number(row.total_cents)]));
  const amount = (eventType: string) => totals.get(eventType) ?? 0;

  const collected = amount("payment_received");
  const recognized = amount("revenue_recognized");
  const deferredCreated = amount("deferred_revenue_created");
  const deferredReleased = amount("deferred_revenue_released");
  const accrued = amount("coach_compensation_accrued");
  const paid = amount("coach_compensation_paid");
  const refunded = amount("refund_issued");
  const deferred = deferredCreated - deferredReleased;
  const pending = accrued - paid;
  const net = recognized - accrued;

  return {
    collectedRevenueCents: collected,
    recognizedRevenueCents: recognized,
    deferredRevenueCents: deferred,
    deferredCreatedCents: deferredCreated,
    deferredReleasedCents: deferredReleased,
    coachAccruedCents: accrued,
    coachPaidCents: paid,
    coachPendingCents: pending,
    refundedCents: refunded,
    netOrgRevenueCents: net,
    eventCounts: Object.fromEntries(rows.map((row) => [row.event_type, Number(row.event_count)])),
    dataQuality: {
      hasNegativeDeferredRevenue: deferred < 0,
      hasCoachOverpayment: pending < 0,
      hasNegativeNetRevenue: net < 0,
    },
  };
}

export async function getRevenueLedgerSummary(
  orgId: string,
  since?: Date
): Promise<RevenueLedgerSummary> {
  const sinceFilter = since ? sql`AND created_at >= ${since}` : sql``;
  const result = await db.execute(sql`
    SELECT event_type,
           COALESCE(SUM(amount_cents), 0)::int AS total_cents,
           COUNT(*)::int AS event_count
      FROM revenue_ledger_events
     WHERE org_id = ${orgId} ${sinceFilter}
     GROUP BY event_type
  `);
  return summarizeRevenueRows((result.rows ?? []) as RevenueAggregateRow[]);
}

export async function onRefundIssued(opts: {
  orgId: string | null;
  clientId: string;
  amountCents: number;
  walletTxId: string;
  reason: string;
  createdBy?: string | null;
}): Promise<void> {
  const { orgId, clientId, amountCents, walletTxId, reason, createdBy } = opts;
  await writeRevenueEvent({
    orgId,
    clientId,
    eventType: "refund_issued",
    amountCents,
    reason,
    sourceAction: "refund",
    createdBy,
    idempotencyKey: `refund_issued:${walletTxId}`,
  });
}
