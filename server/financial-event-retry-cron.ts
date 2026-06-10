/**
 * Financial Event Retry Cron
 *
 * Runs every 15 minutes. Retries up to 10 pending financial_event_failures
 * per cycle. Never retries ignored/resolved/failed rows.
 * Max 5 attempts per failure — after that, status transitions to "failed".
 */

import { db } from "./db";
import { financialEventFailures } from "@shared/schema";
import { eq, and, inArray, lt } from "drizzle-orm";
import { storage } from "./storage";

const MAX_PER_RUN = 10;
const MAX_ATTEMPTS = 5;

async function replayFinancialEvent(failure: {
  id: string;
  sourceType: string;
  payload: unknown;
  idempotencyKey: string | null;
}): Promise<void> {
  const p = failure.payload as Record<string, any>;

  if (failure.sourceType === "revenue_ledger") {
    await storage.createRevenueLedgerEvent({
      orgId: p.orgId ?? null,
      clientId: p.clientId ?? null,
      coachId: p.coachId ?? null,
      bookingId: p.bookingId ?? null,
      redemptionId: p.redemptionId ?? null,
      eventType: p.eventType,
      amountCents: p.amountCents ?? 0,
      reason: p.reason ?? "",
      sourceAction: p.sourceAction ?? "",
      createdBy: p.createdBy ?? null,
      idempotencyKey: failure.idempotencyKey ?? p.idempotencyKey ?? null,
    });
  } else if (failure.sourceType === "credit_ledger") {
    await storage.createCreditLedgerEvent({
      clientId: p.clientId,
      bookingId: p.bookingId ?? null,
      subscriptionId: p.subscriptionId ?? null,
      organizationId: p.organizationId ?? null,
      eventType: p.eventType,
      deltaSessions: p.deltaSessions ?? 0,
      deltaCents: p.deltaCents ?? 0,
      sessionsAfter: p.sessionsAfter ?? null,
      reason: p.reason ?? "",
      createdBy: p.createdBy ?? null,
    });
  } else if (failure.sourceType === "stripe_webhook") {
    // Replay a failed wallet credit from a Stripe webhook event
    const userId: string | undefined = p.userId;
    const amountCents: number | undefined = p.amountCents;
    const paymentIntentId: string | undefined = p.paymentIntentId;
    const sessionId: string | undefined = p.sessionId;
    const currency: string = p.currency ?? "usd";
    const livemode: boolean = p.livemode ?? false;

    if (!userId || !amountCents || amountCents <= 0) {
      throw new Error(
        `stripe_webhook replay: missing userId (${userId}) or invalid amountCents (${amountCents}). Manual repair required.`
      );
    }

    // Check if already credited to prevent double-credit on retry
    if (paymentIntentId) {
      const existing = await storage.getWalletTransactionByStripePaymentIntentId(paymentIntentId);
      if (existing) {
        // Already credited — resolve without re-crediting
        return;
      }
    } else if (sessionId) {
      const existing = await storage.getWalletTransactionByStripeSessionId(sessionId);
      if (existing) {
        return;
      }
    }

    await storage.creditWallet(
      userId,
      amountCents,
      `Retry credit — $${(amountCents / 100).toFixed(2)} (event: ${p.stripeEventId ?? "unknown"})`,
      sessionId,
      paymentIntentId,
      undefined,
      currency,
      "succeeded",
      livemode
    );
  } else {
    throw new Error(`Unknown sourceType: ${failure.sourceType}`);
  }
}

export async function runFinancialEventRetry(): Promise<{
  attempted: number;
  resolved: number;
  stillFailed: number;
}> {
  let attempted = 0;
  let resolved = 0;
  let stillFailed = 0;

  try {
    const pending = await db
      .select()
      .from(financialEventFailures)
      .where(
        and(
          inArray(financialEventFailures.status, ["pending", "retrying"]),
          lt(financialEventFailures.attempts, MAX_ATTEMPTS)
        )
      )
      .limit(MAX_PER_RUN);

    for (const failure of pending) {
      attempted++;
      const newAttempts = (failure.attempts ?? 0) + 1;

      // Mark as retrying
      await db
        .update(financialEventFailures)
        .set({ status: "retrying", lastAttemptAt: new Date(), attempts: newAttempts, updatedAt: new Date() })
        .where(eq(financialEventFailures.id, failure.id));

      try {
        await replayFinancialEvent(failure);
        // Success
        await db
          .update(financialEventFailures)
          .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
          .where(eq(financialEventFailures.id, failure.id));
        resolved++;
      } catch (e: any) {
        // Idempotency key collision = already written, treat as resolved
        if (e?.code === "23505") {
          await db
            .update(financialEventFailures)
            .set({ status: "resolved", resolvedAt: new Date(), failureMessage: "Already written (idempotent)", updatedAt: new Date() })
            .where(eq(financialEventFailures.id, failure.id));
          resolved++;
          continue;
        }

        const newStatus = newAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
        await db
          .update(financialEventFailures)
          .set({
            status: newStatus,
            failureMessage: e?.message ?? String(e),
            updatedAt: new Date(),
          })
          .where(eq(financialEventFailures.id, failure.id));
        stillFailed++;
      }
    }
  } catch (err: any) {
    console.error("[FinancialEventRetry] Cron error:", err?.message ?? err);
  }

  if (attempted > 0) {
    console.log(`[FinancialEventRetry] attempted=${attempted} resolved=${resolved} stillFailed=${stillFailed}`);
  }

  return { attempted, resolved, stillFailed };
}
