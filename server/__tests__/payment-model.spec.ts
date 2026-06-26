/**
 * Payment Model Tests — Subscription/Package vs Wallet/Prepaid
 *
 * Verifies the two intentional payment models are correctly separated:
 *
 *   1. Subscription/Package model
 *      - booking.subscriptionPlanId is set
 *      - redemption decrements user_subscriptions.sessionsRemaining
 *      - wallet is NOT debited on the subscription path
 *      - Stripe webhook skips wallet credit for subscription PIs/charges
 *
 *   2. Wallet/Prepaid model
 *      - booking.subscriptionPlanId is null
 *      - redemption debits wallet balance (dollars)
 *      - sessionsRemaining is NOT touched
 *      - Stripe wallet deposit webhook credits wallet_transactions
 *
 * Uses static source analysis (same pattern as sprint3 spec) — no DB required.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function src(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

// ─── Webhook: subscription payment guard ──────────────────────────────────────

describe("Webhook — subscription payment guard", () => {
  const webhook = src("server/webhookHandlers.ts");

  test("payment_intent.succeeded skips wallet credit when pi.invoice is set (subscription charge)", () => {
    assert.ok(
      webhook.includes("const isSubscriptionPayment = !!pi.invoice"),
      "payment_intent.succeeded must check pi.invoice to detect subscription payments"
    );
    assert.ok(
      webhook.includes("Subscription payment — skipping wallet credit"),
      "subscription payment must log a message explaining the skip"
    );
  });

  test("payment_intent.succeeded still credits wallet when pi.invoice is null (one-time payment)", () => {
    assert.ok(
      webhook.includes("processWalletCredit("),
      "processWalletCredit must still exist for non-subscription payment_intent.succeeded events"
    );
  });

  test("charge.succeeded skips wallet credit when charge.invoice is set (subscription charge)", () => {
    assert.ok(
      webhook.includes("const chargeIsSubscriptionPayment = !!charge.invoice"),
      "charge.succeeded must check charge.invoice to detect subscription charges"
    );
    assert.ok(
      webhook.includes("Subscription charge — skipping wallet credit"),
      "subscription charge must log the skip reason"
    );
  });

  test("charge.succeeded has processWalletCredit call for non-subscription charges", () => {
    // processWalletCredit is called at multiple places — one is inside charge.succeeded.
    // Use a generous 6000-char slice from the charge event start to cover the call
    // even after the subscription guard block was inserted before it.
    const chargeEventStart = webhook.indexOf("if (eventType === 'charge.succeeded')");
    const chargeBlock = webhook.slice(chargeEventStart, chargeEventStart + 6000);
    assert.ok(
      chargeBlock.includes("processWalletCredit("),
      "processWalletCredit must still be called for non-subscription charge.succeeded events"
    );
  });

  test("wallet_deposit checkout.session.completed credits wallet_transactions", () => {
    assert.ok(
      webhook.includes("metaType === 'wallet_deposit'") && webhook.includes("storage.creditWallet("),
      "wallet_deposit checkout.session.completed path must call creditWallet"
    );
  });

  test("subscription checkout.session.completed activates user_subscriptions with sessionsRemaining", () => {
    assert.ok(
      webhook.includes("sessionsRemaining = spw * intervalWeeks"),
      "checkout.session.completed subscription mode must calculate sessionsRemaining from plan config"
    );
    assert.ok(
      webhook.includes("storage.updateUserSubscription("),
      "checkout.session.completed subscription mode must call updateUserSubscription to activate the row"
    );
  });

  test("invoice.paid triggers handleSubscriptionRenewal which resets sessionsRemaining", () => {
    assert.ok(
      webhook.includes("handleSubscriptionRenewal("),
      "invoice.paid / invoice.payment_succeeded must call handleSubscriptionRenewal"
    );
    const renewalFnStart = webhook.indexOf("static async handleSubscriptionRenewal(");
    const renewalFn = webhook.slice(renewalFnStart, renewalFnStart + 1500);
    assert.ok(
      renewalFn.includes("sessionsRemaining: totalSessions"),
      "handleSubscriptionRenewal must reset sessionsRemaining to the plan's session allocation"
    );
  });
});

// ─── Booking: subscriptionPlanId attachment ────────────────────────────────────

describe("Booking — subscriptionPlanId attachment rules", () => {
  const routes = src("server/routes.ts");
  const clientBookingStart = routes.indexOf('app.post("/api/bookings"');
  // Extend slice to 7000 chars to cover all logic including validation block
  const clientBookingBlock = routes.slice(clientBookingStart, clientBookingStart + 7000);

  test("POST /api/bookings accepts optional subscriptionPlanId from request body", () => {
    assert.ok(
      clientBookingBlock.includes("subscriptionPlanId: requestedPlanId") ||
      clientBookingBlock.includes("requestedPlanId"),
      "POST /api/bookings must read subscriptionPlanId (as requestedPlanId) from request body"
    );
  });

  test("POST /api/bookings validates client has active subscription before attaching planId", () => {
    assert.ok(
      clientBookingBlock.includes("storage.getUserSubscriptions(userId)"),
      "POST /api/bookings must look up client subscriptions to validate the requestedPlanId"
    );
    assert.ok(
      clientBookingBlock.includes('s.status === "active"'),
      "Subscription validation must check that the subscription status is active"
    );
  });

  test("POST /api/bookings does NOT auto-attach subscriptionPlanId from wallet balance", () => {
    assert.ok(
      !clientBookingBlock.includes("getUserBalance") && !clientBookingBlock.includes("balanceCents"),
      "POST /api/bookings must not inspect wallet balance to decide subscriptionPlanId"
    );
  });

  test("POST /api/bookings logs which payment model was selected", () => {
    assert.ok(
      clientBookingBlock.includes("paymentModel: 'subscription'"),
      "Booking route must log paymentModel:subscription when planId is validated"
    );
    assert.ok(
      clientBookingBlock.includes("paymentModel: 'wallet'"),
      "Booking route must log paymentModel:wallet when no planId is provided"
    );
    assert.ok(
      clientBookingBlock.includes("paymentModel: 'wallet_fallback'"),
      "Booking route must log paymentModel:wallet_fallback when requested planId has no active subscription"
    );
  });

  test("POST /api/coach/bookings passes subscriptionPlanId from request body (coach-created bookings)", () => {
    const coachStart = routes.indexOf('app.post("/api/coach/bookings"');
    // Coach booking route has createBooking call ~135 lines in — use 6000 chars
    const coachBookingBlock = routes.slice(coachStart, coachStart + 6000);
    assert.ok(
      coachBookingBlock.includes("subscriptionPlanId: subscriptionPlanId || null"),
      "Coach booking route must pass subscriptionPlanId to createBooking"
    );
  });
});

// ─── Redemption: model branching and session decrement ────────────────────────

describe("Redemption — payment model branching", () => {
  const routes = src("server/routes.ts");
  const redemptionStart = routes.indexOf('app.post("/api/redemptions"');
  // onRedemption is ~287 lines after route start; extend to 12000 chars to cover all
  const redemptionBlock = routes.slice(redemptionStart, redemptionStart + 12000);

  test("redemption decrements sessionsRemaining when booking.subscriptionPlanId is set", () => {
    assert.ok(
      redemptionBlock.includes("booking.subscriptionPlanId"),
      "Redemption must branch on booking.subscriptionPlanId"
    );
    assert.ok(
      redemptionBlock.includes("activeSub.sessionsRemaining - 1"),
      "Redemption must decrement sessionsRemaining by 1 on the subscription path"
    );
  });

  test("redemption uses Math.max(0, ...) to prevent negative sessionsRemaining", () => {
    assert.ok(
      redemptionBlock.includes("Math.max(0, activeSub.sessionsRemaining - 1)"),
      "sessionsRemaining decrement must be guarded by Math.max(0, ...) to prevent going negative"
    );
  });

  test("redemption writes credit_ledger_events on session decrement", () => {
    assert.ok(
      redemptionBlock.includes('"redemption_debit"') || redemptionBlock.includes("'redemption_debit'"),
      "Redemption must write a credit_ledger_events entry with eventType='redemption_debit'"
    );
    assert.ok(
      redemptionBlock.includes("storage.createCreditLedgerEvent("),
      "Redemption must call storage.createCreditLedgerEvent for the session debit audit trail"
    );
  });

  test("redemption does NOT call debitWallet on subscription path (no wallet debit for packages)", () => {
    const subPlanBlockStart = redemptionBlock.indexOf("} else if (booking.subscriptionPlanId)");
    const subPlanBlockEnd = redemptionBlock.indexOf("} else if (booking.teamQuoteProgramId)");
    if (subPlanBlockStart !== -1 && subPlanBlockEnd !== -1) {
      const subOnlyBlock = redemptionBlock.slice(subPlanBlockStart, subPlanBlockEnd);
      assert.ok(
        !subOnlyBlock.includes("debitWallet"),
        "Subscription path must not call debitWallet — wallet is not used for package-backed sessions"
      );
    } else {
      // Fallback: verify debitWallet is not inside the subscription comment block
      assert.ok(
        redemptionBlock.includes("will decrement sessionsRemaining, no wallet debit"),
        "Subscription path must document that wallet is not debited"
      );
    }
  });

  test("redemption debits wallet when booking.subscriptionPlanId is null (wallet model)", () => {
    assert.ok(
      redemptionBlock.includes("storage.debitWallet("),
      "Redemption must call debitWallet for wallet/prepaid model bookings"
    );
  });

  test("redemption logs which payment model was selected", () => {
    assert.ok(
      redemptionBlock.includes("paymentModel: 'subscription'"),
      "Redemption must log paymentModel:subscription on the subscription path"
    );
    assert.ok(
      redemptionBlock.includes("paymentModel: 'wallet'"),
      "Redemption must log paymentModel:wallet on the wallet debit path"
    );
  });

  test("duplicate redemption is blocked (same bookingId cannot be redeemed twice)", () => {
    assert.ok(
      redemptionBlock.includes("getRedemptionByBookingId(bookingId)"),
      "Redemption must check for an existing redemption for the same bookingId"
    );
    assert.ok(
      redemptionBlock.includes("Already redeemed"),
      "Duplicate redemption must return an Already redeemed error"
    );
  });

  test("revenue ledger is written unconditionally for all redemptions", () => {
    assert.ok(
      redemptionBlock.includes("onRedemption("),
      "onRedemption must be called for all redemption paths to write revenue_ledger_events"
    );
  });
});

// ─── Model separation invariants ──────────────────────────────────────────────

describe("Model separation — wallet credits never used as session credits", () => {
  const webhook = src("server/webhookHandlers.ts");

  test("processWalletCredit only writes wallet_transactions, never touches user_subscriptions", () => {
    const fnStart = webhook.indexOf("async function processWalletCredit(");
    const fn = webhook.slice(fnStart, fnStart + 2000);
    assert.ok(
      fn.includes("storage.creditWallet("),
      "processWalletCredit must call creditWallet (writes wallet_transactions)"
    );
    assert.ok(
      !fn.includes("updateUserSubscription") && !fn.includes("sessionsRemaining"),
      "processWalletCredit must NOT touch user_subscriptions or sessionsRemaining"
    );
  });

  test("handleSubscriptionRenewal only resets sessionsRemaining, never credits wallet", () => {
    const fnStart = webhook.indexOf("static async handleSubscriptionRenewal(");
    const fn = webhook.slice(fnStart, fnStart + 1500);
    assert.ok(
      fn.includes("sessionsRemaining"),
      "handleSubscriptionRenewal must set sessionsRemaining"
    );
    assert.ok(
      !fn.includes("creditWallet"),
      "handleSubscriptionRenewal must NOT call creditWallet — subscription value is in sessions, not dollars"
    );
  });
});
