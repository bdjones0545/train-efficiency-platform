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
    console.warn(
      `[revenue-recognition] Failed to write ${data.eventType} event (key: ${data.idempotencyKey}):`,
      e?.message ?? e
    );
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
}

export async function getRevenueLedgerSummary(
  orgId: string | null,
  since?: Date
): Promise<RevenueLedgerSummary> {
  const events = await storage.getRevenueLedgerEvents(orgId ?? "", since);

  let collected = 0, recognized = 0, deferredCreated = 0, deferredReleased = 0;
  let accrued = 0, paid = 0, refunded = 0;

  for (const e of events) {
    switch (e.eventType) {
      case "payment_received":           collected += e.amountCents; break;
      case "revenue_recognized":         recognized += e.amountCents; break;
      case "deferred_revenue_created":   deferredCreated += e.amountCents; break;
      case "deferred_revenue_released":  deferredReleased += e.amountCents; break;
      case "coach_compensation_accrued": accrued += e.amountCents; break;
      case "coach_compensation_paid":    paid += e.amountCents; break;
      case "refund_issued":              refunded += e.amountCents; break;
    }
  }

  const deferred = Math.max(0, deferredCreated - deferredReleased);
  const pending = Math.max(0, accrued - paid);
  const net = Math.max(0, recognized - accrued);

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
  };
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
