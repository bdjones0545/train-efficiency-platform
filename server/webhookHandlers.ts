import Stripe from 'stripe';
import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';
import { organizationSubscriptionPlans, financialEventFailures, stripeWebhookEvents, userSubscriptions } from '@shared/schema';
import { sendTeamQuoteEmail, sendSubscriptionExpiredEmail, type OrgBranding } from './email';
import { db } from './db';
import { eq, and } from 'drizzle-orm';

const LOG_PREFIX = '[Stripe Wallet Sync]';

// ── Structured webhook event logging ─────────────────────────────────────────
function logWebhookEvent(params: {
  eventId: string;
  eventType: string;
  livemode: boolean;
  orgId?: string | null;
  userId?: string | null;
  paymentIntentId?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
  amountCents?: number | null;
  credited?: boolean;
  error?: string | null;
}) {
  console.log(JSON.stringify({
    system: 'stripe_webhook',
    eventId: params.eventId,
    eventType: params.eventType,
    livemode: params.livemode,
    orgId: params.orgId ?? null,
    userId: params.userId ?? null,
    paymentIntentId: params.paymentIntentId ?? null,
    subscriptionId: params.subscriptionId ?? null,
    customerId: params.customerId ?? null,
    amount: params.amountCents ?? null,
    credited: params.credited ?? null,
    error: params.error ?? null,
    ts: new Date().toISOString(),
  }));
}

// ── Event-level idempotency: check and insert stripe_webhook_events ───────────
async function checkAndInsertWebhookEvent(params: {
  stripeEventId: string;
  eventType: string;
  livemode: boolean;
  customerId?: string | null;
  paymentIntentId?: string | null;
  subscriptionId?: string | null;
  orgId?: string | null;
  userId?: string | null;
  amountCents?: number | null;
  metadata?: Record<string, any> | null;
}): Promise<{ alreadyProcessed: boolean; rowId: string }> {
  const existing = await db
    .select()
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.stripeEventId, params.stripeEventId))
    .limit(1)
    .catch(() => []);

  if (existing.length > 0) {
    return { alreadyProcessed: true, rowId: existing[0].id };
  }

  const [inserted] = await db.insert(stripeWebhookEvents).values({
    stripeEventId: params.stripeEventId,
    eventType: params.eventType,
    livemode: params.livemode,
    processedStatus: 'processing',
    customerId: params.customerId ?? null,
    paymentIntentId: params.paymentIntentId ?? null,
    subscriptionId: params.subscriptionId ?? null,
    orgId: params.orgId ?? null,
    userId: params.userId ?? null,
    amountCents: params.amountCents ?? null,
    metadata: params.metadata ?? null,
  }).returning().catch(async () => {
    // Race condition: another request just inserted — treat as already processed
    const row = await db.select().from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.stripeEventId, params.stripeEventId))
      .limit(1).catch(() => []);
    return row.length > 0 ? row : [];
  });

  if (!inserted) {
    return { alreadyProcessed: true, rowId: '' };
  }

  return { alreadyProcessed: false, rowId: inserted.id };
}

async function markWebhookEventDone(rowId: string, status: 'succeeded' | 'failed', error?: string) {
  if (!rowId) return;
  await db.update(stripeWebhookEvents)
    .set({ processedStatus: status, processingError: error ?? null, processedAt: new Date() })
    .where(eq(stripeWebhookEvents.id, rowId))
    .catch(() => {});
}

// ── Write a dead-letter entry for a failed credit ────────────────────────────
async function writeDeadLetterForFailedCredit(params: {
  eventId: string;
  eventType: string;
  livemode: boolean;
  customerId?: string | null;
  paymentIntentId?: string | null;
  amountCents?: number;
  error: string;
}) {
  try {
    await db.insert(financialEventFailures).values({
      sourceType: 'stripe_webhook',
      eventType: params.eventType,
      payload: {
        stripeEventId: params.eventId,
        stripeCustomerId: params.customerId,
        paymentIntentId: params.paymentIntentId,
        amountCents: params.amountCents,
        livemode: params.livemode,
      },
      failureMessage: `[${params.eventId}] Credit failed: ${params.error}`,
      status: 'pending',
      maxAttempts: 3,
    });
    console.warn(`[Stripe Webhook] Dead-letter entry written for event ${params.eventId}: ${params.error}`);
  } catch (err) {
    console.error('[Stripe Webhook] Failed to write dead-letter entry:', err);
  }
}

async function getOrgStripeForQuote(organizationId: string | null): Promise<Stripe> {
  if (organizationId) {
    try {
      const org = await storage.getOrganizationById(organizationId);
      if (org?.stripeSecretKey) {
        return new Stripe(org.stripeSecretKey);
      }
    } catch {}
  }
  return getUncachableStripeClient();
}

async function matchUserToStripePayment(
  stripeCustomerId: string | null,
  customerEmail: string | null,
  customerName: string | null
): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string | null; balanceCents: number } | null> {
  if (stripeCustomerId) {
    const user = await storage.getUserByStripeCustomerId(stripeCustomerId);
    if (user) {
      console.log(`${LOG_PREFIX} matched customer by stripeCustomerId: ${stripeCustomerId} → userId: ${user.id}`);
      return user;
    }
  }

  if (customerEmail) {
    const user = await storage.getUserByEmail(customerEmail);
    if (user) {
      console.log(`${LOG_PREFIX} matched customer by email: ${customerEmail} → userId: ${user.id}`);
      if (stripeCustomerId) {
        await storage.updateUserStripeCustomerId(user.id, stripeCustomerId);
      }
      return user;
    }
  }

  if (customerName && !customerEmail) {
    const nameParts = customerName.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    if (firstName) {
      const results = await storage.searchUsers(customerName);
      if (results.length === 1) {
        const user = results[0];
        console.log(`${LOG_PREFIX} matched customer by name fallback: "${customerName}" → userId: ${user.id}`);
        return user;
      }
    }
  }

  console.warn(`${LOG_PREFIX} unmatched payment warning — could not find user for stripeCustomerId=${stripeCustomerId}, email=${customerEmail}, name=${customerName}`);

  try {
    await db.insert(financialEventFailures).values({
      sourceType: 'stripe_webhook',
      eventType: 'unmatched_payment',
      payload: { stripeCustomerId, customerEmail, customerName },
      failureMessage: `No matching user found — stripeCustomerId: ${stripeCustomerId}, email: ${customerEmail}, name: ${customerName}`,
      status: 'pending',
      maxAttempts: 1,
    });
  } catch (logErr) {
    console.error(`${LOG_PREFIX} failed to log unmatched payment:`, logErr);
  }

  return null;
}

async function processWalletCredit(params: {
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeCustomerId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  amountCents: number;
  currency: string;
  description: string;
  eventType: string;
}): Promise<void> {
  const {
    stripePaymentIntentId,
    stripeChargeId,
    stripeCustomerId,
    customerEmail,
    customerName,
    amountCents,
    currency,
    description,
    eventType,
  } = params;

  console.log(`${LOG_PREFIX} payment received — event: ${eventType}, paymentIntentId: ${stripePaymentIntentId}, chargeId: ${stripeChargeId}, amount: ${amountCents} ${currency}`);

  if (stripePaymentIntentId) {
    const existing = await storage.getWalletTransactionByStripePaymentIntentId(stripePaymentIntentId);
    if (existing) {
      console.log(`${LOG_PREFIX} skipped duplicate — paymentIntentId ${stripePaymentIntentId} already credited (txId: ${existing.id})`);
      return;
    }
  }

  const user = await matchUserToStripePayment(stripeCustomerId, customerEmail, customerName);
  if (!user) return;

  const priorBalance = await storage.getUserBalance(user.id);

  await storage.creditWallet(
    user.id,
    amountCents,
    description,
    undefined,
    stripePaymentIntentId || undefined,
    stripeChargeId || undefined,
    currency || 'usd',
    'succeeded'
  );

  const newBalance = await storage.getUserBalance(user.id);

  console.log(`${LOG_PREFIX} amount credited — userId: ${user.id} (${user.email}), amount: $${(amountCents / 100).toFixed(2)}, prior balance: $${(priorBalance / 100).toFixed(2)}, new balance: $${(newBalance / 100).toFixed(2)}`);
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    let event: any;
    try {
      event = JSON.parse(payload.toString());
    } catch (parseErr) {
      console.error('[Stripe Webhook] Failed to parse event payload:', parseErr);
      return;
    }

    const eventId: string = event.id || 'unknown';
    const eventType: string = event.type || 'unknown';
    const livemode: boolean = event.livemode === true;
    const obj = event.data?.object;

    // ── Live/test mode mismatch detection ────────────────────────────────────
    const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
    if (isProduction && !livemode) {
      console.warn(`[Stripe Webhook] LIVE/TEST MISMATCH — received test event ${eventId} (${eventType}) in production environment. Ignoring.`);
      logWebhookEvent({ eventId, eventType, livemode, error: 'live/test mode mismatch — test event in production' });
      return;
    }

    // ── Event-level idempotency ───────────────────────────────────────────────
    const customerId = typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id || null;
    const paymentIntentId = typeof obj?.payment_intent === 'string' ? obj.payment_intent : obj?.payment_intent?.id || obj?.id && eventType.startsWith('payment_intent') ? obj.id : null;
    const subscriptionId = typeof obj?.subscription === 'string' ? obj.subscription : obj?.subscription?.id || eventType.startsWith('customer.subscription') ? obj?.id : null;
    const orgIdFromMeta = obj?.metadata?.orgId || obj?.metadata?.organizationId || null;
    const userIdFromMeta = obj?.metadata?.userId || null;
    const amountCentsFromObj = obj?.amount_received || obj?.amount_paid || obj?.amount || null;

    const { alreadyProcessed, rowId } = await checkAndInsertWebhookEvent({
      stripeEventId: eventId,
      eventType,
      livemode,
      customerId,
      paymentIntentId,
      subscriptionId,
      orgId: orgIdFromMeta,
      userId: userIdFromMeta,
      amountCents: amountCentsFromObj,
      metadata: event.data?.object?.metadata || null,
    });

    if (alreadyProcessed) {
      console.log(`[Stripe Webhook] Duplicate event skipped — eventId: ${eventId}, type: ${eventType}`);
      return;
    }

    try {
      if (eventType === 'invoice.paid') {
        const invoice = obj;
        if (invoice?.id) {
          await WebhookHandlers.handleInvoicePaid(invoice.id);
        }
        if (invoice?.subscription) {
          await WebhookHandlers.handleSubscriptionRenewal(invoice.subscription, invoice.period_start, invoice.period_end);
        }
        logWebhookEvent({ eventId, eventType, livemode, subscriptionId: invoice?.subscription, customerId, credited: true });
      }

      if (eventType === 'invoice.payment_succeeded') {
        const invoice = obj;
        if (invoice?.id) {
          await WebhookHandlers.handleInvoicePaid(invoice.id);
        }
        if (invoice?.subscription) {
          await WebhookHandlers.handleSubscriptionRenewal(invoice.subscription, invoice.period_start, invoice.period_end);
        }
        logWebhookEvent({ eventId, eventType, livemode, subscriptionId: invoice?.subscription, customerId, credited: true });
      }

      if (eventType === 'customer.subscription.created' ||
          eventType === 'customer.subscription.updated' ||
          eventType === 'customer.subscription.deleted') {
        await WebhookHandlers.handleSubscriptionEvent(obj);
        logWebhookEvent({ eventId, eventType, livemode, subscriptionId: obj?.id, customerId, orgId: orgIdFromMeta, credited: true });
      }

      if (eventType === 'checkout.session.completed') {
        const session = obj;

        // ── Subscription checkout ─────────────────────────────────────────────
        if (session?.mode === 'subscription' && session?.subscription) {
          const orgId = session.metadata?.orgId || session.metadata?.organizationId;
          const sessionUserId = session.metadata?.userId;
          const sessionPlanId = session.metadata?.planId;
          const stripeSubId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

          let subStatus = 'active';
          let periodStart: Date | null = null;
          let periodEnd: Date | null = null;
          let sessionsRemaining: number | null = null;

          try {
            const stripe = await getUncachableStripeClient();
            const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);
            subStatus = stripeSub.status;
            periodStart = new Date(stripeSub.current_period_start * 1000);
            periodEnd = new Date(stripeSub.current_period_end * 1000);

            // Update org-level subscription record
            if (orgId) {
              await storage.updateOrganization(orgId, {
                stripeSubscriptionId: stripeSub.id,
                subscriptionStatus: stripeSub.status as any,
                trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
                subscriptionCurrentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
              });
              console.log(`[Stripe Webhook] Subscription ${stripeSub.id} linked to org ${orgId} (status: ${stripeSub.status})`);
            }

            // ── FIX: Activate the user subscription record ──────────────────
            // The /api/wallet/subscribe route creates a userSubscription with status:'pending'.
            // Without this, subscriptions stay pending forever unless client hits verify-subscription.
            if (sessionUserId && sessionPlanId) {
              const userSub = await storage.getUserSubscriptionByCheckoutSession(session.id).catch(() => undefined);
              if (userSub && userSub.status === 'pending') {
                // Calculate sessions to allocate
                const plan = await storage.getOrganizationSubscriptionPlan(sessionPlanId).catch(() => null);
                if (plan) {
                  const spw = plan.sessionsPerWeek || 1;
                  const intervalWeeks = plan.interval === 'year' ? 52 * (plan.intervalCount || 1)
                    : plan.interval === 'month' ? 4 * (plan.intervalCount || 1)
                    : (plan.intervalCount || 1);
                  sessionsRemaining = spw * intervalWeeks;
                }
                await storage.updateUserSubscription(userSub.id, {
                  stripeSubscriptionId: stripeSubId,
                  status: subStatus,
                  currentPeriodStart: periodStart,
                  currentPeriodEnd: periodEnd,
                  ...(sessionsRemaining !== null ? { sessionsRemaining } : {}),
                });
                console.log(`[Stripe Webhook] User subscription ${userSub.id} activated (${subStatus}) for userId ${sessionUserId} via checkout.session.completed`);
              }
            }
          } catch (subErr: any) {
            console.error('[Stripe Webhook] Error processing subscription checkout:', subErr.message);
            await writeDeadLetterForFailedCredit({ eventId, eventType, livemode, customerId, error: subErr.message });
            await markWebhookEventDone(rowId, 'failed', subErr.message);
            logWebhookEvent({ eventId, eventType, livemode, subscriptionId: stripeSubId, orgId, userId: sessionUserId, credited: false, error: subErr.message });
            return;
          }

          logWebhookEvent({ eventId, eventType, livemode, subscriptionId: stripeSubId, orgId, userId: sessionUserId, credited: true });
        }

        // ── One-time wallet deposit ───────────────────────────────────────────
        if (session?.mode === 'payment' && session?.payment_status === 'paid') {
          const metaType = session.metadata?.type;
          const metaUserId = session.metadata?.userId;
          const amountCents = parseInt(session.metadata?.amountCents || '0', 10);
          const sessionId = session.id;
          const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;

          if (metaType === 'wallet_deposit' && metaUserId && amountCents > 0) {
            const existingBySession = await storage.getWalletTransactionByStripeSessionId(sessionId);
            if (existingBySession) {
              console.log(`${LOG_PREFIX} skipped duplicate — checkoutSessionId ${sessionId} already credited`);
              logWebhookEvent({ eventId, eventType, livemode, userId: metaUserId, paymentIntentId: piId, amountCents, credited: true });
            } else {
              const existingByPI = piId ? await storage.getWalletTransactionByStripePaymentIntentId(piId) : null;
              if (existingByPI) {
                console.log(`${LOG_PREFIX} skipped duplicate — paymentIntentId ${piId} already credited`);
                logWebhookEvent({ eventId, eventType, livemode, userId: metaUserId, paymentIntentId: piId, amountCents, credited: true });
              } else {
                try {
                  const priorBalance = await storage.getUserBalance(metaUserId);
                  await storage.creditWallet(
                    metaUserId,
                    amountCents,
                    `Added $${(amountCents / 100).toFixed(2)} via Stripe (webhook)`,
                    sessionId,
                    piId || undefined,
                    undefined,
                    session.currency || 'usd',
                    'succeeded'
                  );
                  const newBalance = await storage.getUserBalance(metaUserId);
                  console.log(`${LOG_PREFIX} wallet deposit credited — userId: ${metaUserId}, amount: $${(amountCents / 100).toFixed(2)}, prior: $${(priorBalance / 100).toFixed(2)}, new: $${(newBalance / 100).toFixed(2)}`);
                  logWebhookEvent({ eventId, eventType, livemode, userId: metaUserId, paymentIntentId: piId, amountCents, credited: true });
                } catch (creditErr: any) {
                  console.error(`${LOG_PREFIX} wallet credit failed:`, creditErr.message);
                  await writeDeadLetterForFailedCredit({ eventId, eventType, livemode, customerId, paymentIntentId: piId, amountCents, error: creditErr.message });
                  logWebhookEvent({ eventId, eventType, livemode, userId: metaUserId, paymentIntentId: piId, amountCents, credited: false, error: creditErr.message });
                  await markWebhookEventDone(rowId, 'failed', creditErr.message);
                  return;
                }
              }
            }
          }
        }
      }

      if (eventType === 'payment_intent.succeeded') {
        const pi = obj;
        if (!pi?.id) {
          await markWebhookEventDone(rowId, 'succeeded');
          return;
        }

        const isWalletDeposit = pi.metadata?.type === 'wallet_deposit';
        if (isWalletDeposit) {
          console.log(`${LOG_PREFIX} payment_intent.succeeded for wallet_deposit — skipping direct credit (handled via checkout.session.completed)`);
          logWebhookEvent({ eventId, eventType, livemode, paymentIntentId: pi.id, credited: null as any });
          await markWebhookEventDone(rowId, 'succeeded');
          return;
        }

        const piAmountCents = pi.amount_received || pi.amount || 0;
        const currency = pi.currency || 'usd';
        const piCustomerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null;
        const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id || null;

        let customerEmail: string | null = null;
        let customerName: string | null = null;

        if (piCustomerId) {
          try {
            const stripe = await getUncachableStripeClient();
            const customer = await stripe.customers.retrieve(piCustomerId);
            if (customer && !('deleted' in customer)) {
              customerEmail = customer.email || null;
              customerName = customer.name || null;
            }
          } catch {}
        }

        if (!customerEmail && pi.receipt_email) {
          customerEmail = pi.receipt_email;
        }

        try {
          await processWalletCredit({
            stripePaymentIntentId: pi.id,
            stripeChargeId: chargeId,
            stripeCustomerId: piCustomerId,
            customerEmail,
            customerName,
            amountCents: piAmountCents,
            currency,
            description: `Stripe payment $${(piAmountCents / 100).toFixed(2)} (paymentIntent: ${pi.id})`,
            eventType,
          });
          logWebhookEvent({ eventId, eventType, livemode, paymentIntentId: pi.id, customerId: piCustomerId, amountCents: piAmountCents, credited: true });
        } catch (creditErr: any) {
          await writeDeadLetterForFailedCredit({ eventId, eventType, livemode, customerId: piCustomerId, paymentIntentId: pi.id, amountCents: piAmountCents, error: creditErr.message });
          logWebhookEvent({ eventId, eventType, livemode, paymentIntentId: pi.id, customerId: piCustomerId, amountCents: piAmountCents, credited: false, error: creditErr.message });
          await markWebhookEventDone(rowId, 'failed', creditErr.message);
          return;
        }
      }

      if (eventType === 'charge.succeeded') {
        const charge = obj;
        if (!charge?.id) {
          await markWebhookEventDone(rowId, 'succeeded');
          return;
        }

        const isWalletDeposit = charge.metadata?.type === 'wallet_deposit';
        if (isWalletDeposit) {
          console.log(`${LOG_PREFIX} charge.succeeded for wallet_deposit — skipping direct credit (handled via checkout.session.completed)`);
          logWebhookEvent({ eventId, eventType, livemode, credited: null as any });
          await markWebhookEventDone(rowId, 'succeeded');
          return;
        }

        const chargePiId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id || null;

        if (chargePiId) {
          const existing = await storage.getWalletTransactionByStripePaymentIntentId(chargePiId);
          if (existing) {
            console.log(`${LOG_PREFIX} skipped duplicate charge.succeeded — paymentIntentId ${chargePiId} already credited`);
            logWebhookEvent({ eventId, eventType, livemode, paymentIntentId: chargePiId, credited: true });
            await markWebhookEventDone(rowId, 'succeeded');
            return;
          }
        }

        const chargeAmountCents = charge.amount || 0;
        const chargeCurrency = charge.currency || 'usd';
        const chargeCustomerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id || null;

        let chargeCustomerEmail: string | null = charge.billing_details?.email || charge.receipt_email || null;
        let chargeCustomerName: string | null = charge.billing_details?.name || null;

        if (!chargeCustomerEmail && chargeCustomerId) {
          try {
            const stripe = await getUncachableStripeClient();
            const customer = await stripe.customers.retrieve(chargeCustomerId);
            if (customer && !('deleted' in customer)) {
              chargeCustomerEmail = (customer as Stripe.Customer).email || null;
              chargeCustomerName = chargeCustomerName || (customer as Stripe.Customer).name || null;
            }
          } catch {}
        }

        try {
          await processWalletCredit({
            stripePaymentIntentId: chargePiId,
            stripeChargeId: charge.id,
            stripeCustomerId: chargeCustomerId,
            customerEmail: chargeCustomerEmail,
            customerName: chargeCustomerName,
            amountCents: chargeAmountCents,
            currency: chargeCurrency,
            description: `Stripe charge $${(chargeAmountCents / 100).toFixed(2)} (chargeId: ${charge.id})`,
            eventType,
          });
          logWebhookEvent({ eventId, eventType, livemode, paymentIntentId: chargePiId, customerId: chargeCustomerId, amountCents: chargeAmountCents, credited: true });
        } catch (creditErr: any) {
          await writeDeadLetterForFailedCredit({ eventId, eventType, livemode, customerId: chargeCustomerId, paymentIntentId: chargePiId, amountCents: chargeAmountCents, error: creditErr.message });
          logWebhookEvent({ eventId, eventType, livemode, paymentIntentId: chargePiId, customerId: chargeCustomerId, amountCents: chargeAmountCents, credited: false, error: creditErr.message });
          await markWebhookEventDone(rowId, 'failed', creditErr.message);
          return;
        }
      }

      await markWebhookEventDone(rowId, 'succeeded');
    } catch (err: any) {
      console.error('[Stripe Webhook] Error processing custom webhook logic:', err);
      await markWebhookEventDone(rowId, 'failed', err.message || String(err));
      logWebhookEvent({ eventId, eventType, livemode, error: err.message || String(err) });
    }
  }

  static async handleSubscriptionEvent(subscription: any): Promise<void> {
    if (!subscription?.id) return;

    try {
      const orgId = subscription.metadata?.orgId;
      let org;

      if (orgId) {
        org = await storage.getOrganizationById(orgId);
      }
      if (!org) {
        org = await storage.getOrganizationByStripeSubscriptionId(subscription.id);
      }
      if (!org && subscription.customer) {
        org = await storage.getOrganizationByStripeCustomerId(
          typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
        );
      }

      if (!org) {
        console.log(`No org found for subscription ${subscription.id}, skipping`);
        return;
      }

      const previousStatus = org.subscriptionStatus;

      await storage.updateOrganization(org.id, {
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status as any,
        trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        subscriptionCurrentPeriodEnd: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null,
      });

      console.log(`Org ${org.id} (${org.name}) subscription updated: ${previousStatus} → ${subscription.status}`);

      const wasActive = previousStatus === 'active' || previousStatus === 'trialing';
      const isNowInactive = subscription.status === 'canceled' || subscription.status === 'past_due' || subscription.status === 'incomplete';
      const trialJustEnded = previousStatus === 'trialing' && subscription.status !== 'trialing' && subscription.status !== 'active';

      if (org.ownerEmail && ((wasActive && isNowInactive) || trialJustEnded)) {
        let reason: "trial_ended" | "canceled" | "past_due" = "canceled";
        if (trialJustEnded || (previousStatus === 'trialing' && subscription.status === 'past_due')) {
          reason = "trial_ended";
        } else if (subscription.status === 'past_due') {
          reason = "past_due";
        }

        sendSubscriptionExpiredEmail(org.ownerEmail, org.name, reason)
          .catch(err => console.error(`Failed to send subscription email to ${org.ownerEmail}:`, err));
        console.log(`Subscription notification email queued for ${org.ownerEmail} (reason: ${reason})`);
      }
    } catch (err) {
      console.error('Error handling subscription event:', err);
    }
  }

  static async handleSubscriptionRenewal(stripeSubscriptionId: string, periodStart?: number, periodEnd?: number): Promise<void> {
    try {
      const userSub = await storage.getUserSubscriptionByStripeId(stripeSubscriptionId);
      if (!userSub) return;

      const plan = await storage.getOrganizationSubscriptionPlan(userSub.planId);
      if (!plan) return;

      const sessionsPerWeek = plan.sessionsPerWeek || 1;
      const intervalWeeks = plan.interval === "year" ? 52 * (plan.intervalCount || 1)
        : plan.interval === "month" ? 4 * (plan.intervalCount || 1)
        : (plan.intervalCount || 1);
      const totalSessions = sessionsPerWeek * intervalWeeks;

      const updateData: any = {
        sessionsRemaining: totalSessions,
        status: "active",
      };
      if (periodStart) {
        updateData.currentPeriodStart = new Date(periodStart * 1000);
      }
      if (periodEnd) {
        updateData.currentPeriodEnd = new Date(periodEnd * 1000);
      }

      await storage.updateUserSubscription(userSub.id, updateData);
      console.log(`Subscription ${stripeSubscriptionId} renewed: ${totalSessions} sessions allocated (${sessionsPerWeek}x/week)`);
    } catch (err) {
      console.error('Error handling subscription renewal:', err);
    }
  }

  static async handleInvoicePaid(stripeInvoiceId: string): Promise<void> {
    // ── Agent invoice attribution (payment → workflow resumption) ──────────────
    try {
      const { markAgentInvoicePaid } = await import("./connectors/stripe-invoicing");
      const { workflowRunId } = await markAgentInvoicePaid(stripeInvoiceId);
      if (workflowRunId) {
        const { resumeWorkflowAfterPayment } = await import("./workflows/executor");
        const { resumed } = await resumeWorkflowAfterPayment(workflowRunId, stripeInvoiceId);
        console.log(`[Stripe Webhook] Agent invoice ${stripeInvoiceId} paid — workflow ${workflowRunId} resumed: ${resumed}`);
      }
    } catch (err) {
      console.warn(`[Stripe Webhook] Agent invoice lookup failed for ${stripeInvoiceId}:`, err);
    }

    // ── Team quote payment handling ────────────────────────────────────────────
    const quote = await storage.getTeamQuoteByStripeInvoiceId(stripeInvoiceId);

    if (!quote || quote.status === 'PAID') return;

    await storage.updateTeamQuote(quote.id, { status: 'PAID' });
    console.log(`Team quote ${quote.id} for "${quote.teamName}" Month ${quote.currentMonth}/${quote.totalMonths} marked as PAID (invoice: ${stripeInvoiceId})`);

    if (quote.currentMonth === 1) {
      try {
        const teamUser = await storage.findOrCreateTeamUser(
          quote.teamName,
          quote.coachEmail,
          quote.programId || quote.id
        );
        console.log(`Team user created/found for "${quote.teamName}": ${teamUser.id} (email: ${quote.coachEmail})`);
      } catch (err) {
        console.error(`Failed to create team user for "${quote.teamName}":`, err);
      }
    }

    if (quote.currentMonth < quote.totalMonths) {
      await WebhookHandlers.generateNextMonthInvoice(quote);
    }
  }

  static async generateNextMonthInvoice(paidQuote: typeof import('@shared/schema').teamQuotes.$inferSelect): Promise<void> {
    try {
      const nextMonth = paidQuote.currentMonth + 1;
      const monthlyCents = paidQuote.totalCents;

      console.log(`Generating month ${nextMonth}/${paidQuote.totalMonths} invoice for "${paidQuote.teamName}"...`);

      const stripe = await getOrgStripeForQuote(paidQuote.organizationId);

      const customer = await stripe.customers.create({
        email: paidQuote.coachEmail,
        name: paidQuote.teamName,
        metadata: { teamName: paidQuote.teamName, trainingType: paidQuote.trainingType },
      });

      const invoice = await stripe.invoices.create({
        customer: customer.id,
        collection_method: "send_invoice",
        days_until_due: 30,
        metadata: {
          teamName: paidQuote.teamName,
          trainingType: paidQuote.trainingType,
          frequency: paidQuote.frequency,
          totalMonths: paidQuote.totalMonths.toString(),
          currentMonth: nextMonth.toString(),
          numberOfAthletes: paidQuote.numberOfAthletes.toString(),
        },
      });

      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        amount: monthlyCents,
        currency: "usd",
        description: `Team Training — ${paidQuote.teamName} | Month ${nextMonth} of ${paidQuote.totalMonths} | ${paidQuote.numberOfAthletes} athletes × $${(paidQuote.costPerAthleteCents / 100).toFixed(2)}/session | ${paidQuote.trainingType} | ${paidQuote.frequency}`,
      });

      const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
      await stripe.invoices.sendInvoice(invoice.id);

      const invoiceUrl = finalizedInvoice.hosted_invoice_url || "";

      const newQuote = await storage.createTeamQuote({
        teamName: paidQuote.teamName,
        numberOfAthletes: paidQuote.numberOfAthletes,
        costPerAthleteCents: paidQuote.costPerAthleteCents,
        trainingType: paidQuote.trainingType as "STRENGTH" | "SPEED",
        frequency: paidQuote.frequency,
        durationWeeks: paidQuote.durationWeeks,
        coachEmail: paidQuote.coachEmail,
        totalCents: monthlyCents,
        status: "SENT",
        stripeInvoiceId: invoice.id,
        stripeInvoiceUrl: invoiceUrl,
        createdByCoachId: paidQuote.createdByCoachId,
        programId: paidQuote.programId,
        currentMonth: nextMonth,
        totalMonths: paidQuote.totalMonths,
        organizationId: paidQuote.organizationId,
      });

      let orgB: OrgBranding | undefined;
      try {
        const orgId = paidQuote.organizationId;
        if (orgId) {
          const org = await storage.getOrganizationById(orgId);
          if (org) orgB = { name: org.name, accentColor: org.primaryColor || undefined, emailPrimaryColor: org.emailPrimaryColor || undefined, emailSecondaryColor: org.emailSecondaryColor || undefined, ownerEmail: org.ownerEmail || undefined };
        } else {
          const coachProf = await storage.getCoachProfileByEmail(paidQuote.coachEmail);
          if (coachProf?.organizationId) {
            const org = await storage.getOrganizationById(coachProf.organizationId);
            if (org) orgB = { name: org.name, accentColor: org.primaryColor || undefined, emailPrimaryColor: org.emailPrimaryColor || undefined, emailSecondaryColor: org.emailSecondaryColor || undefined, ownerEmail: org.ownerEmail || undefined };
          }
        }
      } catch {}
      sendTeamQuoteEmail(
        paidQuote.coachEmail,
        paidQuote.teamName,
        paidQuote.numberOfAthletes,
        paidQuote.costPerAthleteCents,
        paidQuote.trainingType,
        paidQuote.frequency,
        paidQuote.totalMonths,
        monthlyCents,
        invoiceUrl,
        nextMonth,
        paidQuote.totalMonths,
        orgB
      ).catch(err => console.error("Failed to send next month team quote email:", err));

      console.log(`Month ${nextMonth}/${paidQuote.totalMonths} invoice created for "${paidQuote.teamName}" (quote: ${newQuote.id})`);
    } catch (error) {
      console.error(`Failed to generate month ${paidQuote.currentMonth + 1} invoice for "${paidQuote.teamName}":`, error);
    }
  }

  static async stripeWalletSyncAudit(lookbackDays = 30): Promise<{
    payments: Array<{
      stripePaymentIntentId: string;
      chargeId: string | null;
      customerEmail: string | null;
      customerName: string | null;
      stripeCustomerId: string | null;
      amountCents: number;
      currency: string;
      createdAt: number;
      matchedUserId: string | null;
      matchedUserEmail: string | null;
      hasLedgerEntry: boolean;
      ledgerTxId: string | null;
    }>;
    summary: { total: number; matched: number; credited: number; missing: number };
  }> {
    const stripe = await getUncachableStripeClient();
    const since = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

    const payments: Stripe.PaymentIntent[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const page = await stripe.paymentIntents.list({
        limit: 100,
        created: { gte: since },
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      payments.push(...page.data.filter(pi => pi.status === 'succeeded'));
      hasMore = page.has_more;
      if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
    }

    const results = [];
    let matched = 0;
    let credited = 0;
    let missing = 0;

    for (const pi of payments) {
      const stripeCustomerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null;
      const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge as any)?.id || null;

      let customerEmail: string | null = null;
      let customerName: string | null = null;

      if (stripeCustomerId) {
        try {
          const customer = await stripe.customers.retrieve(stripeCustomerId);
          if (customer && !('deleted' in customer)) {
            customerEmail = (customer as Stripe.Customer).email || null;
            customerName = (customer as Stripe.Customer).name || null;
          }
        } catch {}
      }

      const user = await matchUserToStripePayment(stripeCustomerId, customerEmail, customerName);
      const existing = await storage.getWalletTransactionByStripePaymentIntentId(pi.id);

      const hasLedger = !!existing;
      if (user) matched++;
      if (hasLedger) credited++;
      else missing++;

      results.push({
        stripePaymentIntentId: pi.id,
        chargeId,
        customerEmail,
        customerName,
        stripeCustomerId,
        amountCents: pi.amount_received || pi.amount,
        currency: pi.currency,
        createdAt: pi.created,
        matchedUserId: user?.id || null,
        matchedUserEmail: user?.email || null,
        hasLedgerEntry: hasLedger,
        ledgerTxId: existing?.id || null,
      });
    }

    return {
      payments: results,
      summary: { total: payments.length, matched, credited, missing },
    };
  }

  static async stripeWalletSyncRepair(dryRun = true): Promise<{
    dryRun: boolean;
    repaired: Array<{
      stripePaymentIntentId: string;
      userId: string;
      userEmail: string | null;
      amountCents: number;
      currency: string;
      action: 'credited' | 'skipped' | 'no_user_match';
    }>;
    summary: { total: number; credited: number; skipped: number; noMatch: number };
  }> {
    const stripe = await getUncachableStripeClient();
    const since = Math.floor(Date.now() / 1000) - 90 * 86400;

    const payments: Stripe.PaymentIntent[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const page = await stripe.paymentIntents.list({
        limit: 100,
        created: { gte: since },
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      payments.push(...page.data.filter(pi => pi.status === 'succeeded'));
      hasMore = page.has_more;
      if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
    }

    const repaired = [];
    let creditedCount = 0;
    let skippedCount = 0;
    let noMatchCount = 0;

    for (const pi of payments) {
      const existing = await storage.getWalletTransactionByStripePaymentIntentId(pi.id);
      if (existing) {
        skippedCount++;
        repaired.push({
          stripePaymentIntentId: pi.id,
          userId: existing.userId,
          userEmail: null,
          amountCents: pi.amount_received || pi.amount,
          currency: pi.currency,
          action: 'skipped' as const,
        });
        continue;
      }

      const stripeCustomerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null;
      const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge as any)?.id || null;

      let customerEmail: string | null = null;
      let customerName: string | null = null;

      if (stripeCustomerId) {
        try {
          const customer = await stripe.customers.retrieve(stripeCustomerId);
          if (customer && !('deleted' in customer)) {
            customerEmail = (customer as Stripe.Customer).email || null;
            customerName = (customer as Stripe.Customer).name || null;
          }
        } catch {}
      }

      if (!customerEmail && pi.receipt_email) customerEmail = pi.receipt_email;

      const user = await matchUserToStripePayment(stripeCustomerId, customerEmail, customerName);
      if (!user) {
        noMatchCount++;
        repaired.push({
          stripePaymentIntentId: pi.id,
          userId: '',
          userEmail: customerEmail,
          amountCents: pi.amount_received || pi.amount,
          currency: pi.currency,
          action: 'no_user_match' as const,
        });
        continue;
      }

      const amountCents = pi.amount_received || pi.amount;

      if (!dryRun) {
        const priorBalance = await storage.getUserBalance(user.id);
        await storage.creditWallet(
          user.id,
          amountCents,
          `Stripe backfill — $${(amountCents / 100).toFixed(2)} (paymentIntent: ${pi.id})`,
          undefined,
          pi.id,
          chargeId || undefined,
          pi.currency || 'usd',
          'succeeded'
        );
        const newBalance = await storage.getUserBalance(user.id);
        console.log(`${LOG_PREFIX} backfill credited — userId: ${user.id} (${user.email}), amount: $${(amountCents / 100).toFixed(2)}, prior: $${(priorBalance / 100).toFixed(2)}, new: $${(newBalance / 100).toFixed(2)}`);
      } else {
        console.log(`${LOG_PREFIX} [DRY RUN] would credit userId: ${user.id} (${user.email}), amount: $${(amountCents / 100).toFixed(2)}, paymentIntent: ${pi.id}`);
      }

      creditedCount++;
      repaired.push({
        stripePaymentIntentId: pi.id,
        userId: user.id,
        userEmail: user.email,
        amountCents,
        currency: pi.currency,
        action: 'credited' as const,
      });
    }

    return {
      dryRun,
      repaired,
      summary: { total: payments.length, credited: creditedCount, skipped: skippedCount, noMatch: noMatchCount },
    };
  }

  static async platformStripeWalletSyncAudit(days = 90): Promise<{
    orgs: Array<{
      orgId: string | null;
      orgName: string;
      stripeAccountType: 'platform' | 'org';
      totalPayments: number;
      creditedPayments: number;
      missingCredits: number;
      unmatchedPayments: number;
      totalMissingCents: number;
      payments: Array<{
        stripePaymentIntentId: string;
        chargeId: string | null;
        customerEmail: string | null;
        customerName: string | null;
        stripeCustomerId: string | null;
        amountCents: number;
        currency: string;
        createdAt: number;
        matchedUserId: string | null;
        matchedUserEmail: string | null;
        hasLedgerEntry: boolean;
        ledgerTxId: string | null;
      }>;
    }>;
    summary: {
      totalOrgs: number;
      healthyOrgs: number;
      orgsWithMissingCredits: number;
      totalPayments: number;
      totalCredited: number;
      totalMissing: number;
      totalMissingCents: number;
      totalUnmatched: number;
    };
  }> {
    const PLATFORM_LOG = '[Platform Stripe Wallet Sync]';
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const orgs = await storage.getAllOrganizations();
    const results = [];

    type OrgContext = {
      orgId: string | null;
      orgName: string;
      stripeAccountType: 'platform' | 'org';
      stripe: Stripe;
      orgUsers: Array<{ id: string; email: string | null; firstName: string | null; lastName: string | null; stripeCustomerId: string | null; balanceCents: number }> | null;
    };

    const contexts: OrgContext[] = [];

    for (const org of orgs) {
      if (org.stripeSecretKey) {
        const orgUsers = await storage.getUsersInOrgWithStripeInfo(org.id);
        contexts.push({
          orgId: org.id,
          orgName: org.name,
          stripeAccountType: 'org',
          stripe: new Stripe(org.stripeSecretKey),
          orgUsers,
        });
      }
    }

    try {
      const platformStripe = await getUncachableStripeClient();
      contexts.push({
        orgId: null,
        orgName: 'Platform (default Stripe)',
        stripeAccountType: 'platform',
        stripe: platformStripe,
        orgUsers: null,
      });
    } catch {}

    for (const ctx of contexts) {
      const payments: Stripe.PaymentIntent[] = [];
      let hasMore = true;
      let startingAfter: string | undefined;
      try {
        while (hasMore) {
          const page = await ctx.stripe.paymentIntents.list({
            limit: 100,
            created: { gte: since },
            ...(startingAfter ? { starting_after: startingAfter } : {}),
          });
          payments.push(...page.data.filter(pi => pi.status === 'succeeded'));
          hasMore = page.has_more;
          if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
        }
      } catch (err: any) {
        console.error(`${PLATFORM_LOG} failed to list payments for ${ctx.orgName}:`, err.message);
        continue;
      }

      const emailMap = new Map<string, typeof ctx.orgUsers extends null ? never : NonNullable<typeof ctx.orgUsers>[number]>();
      const stripeIdMap = new Map<string, NonNullable<typeof ctx.orgUsers>[number]>();

      if (ctx.orgUsers) {
        for (const u of ctx.orgUsers) {
          if (u.email) emailMap.set(u.email.toLowerCase(), u);
          if (u.stripeCustomerId) stripeIdMap.set(u.stripeCustomerId, u);
        }
      }

      const orgPayments = [];
      let credited = 0;
      let missing = 0;
      let unmatched = 0;
      let missingCents = 0;

      for (const pi of payments) {
        const stripeCustomerId = typeof pi.customer === 'string' ? pi.customer : (pi.customer as any)?.id || null;
        const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge as any)?.id || null;

        let customerEmail: string | null = null;
        let customerName: string | null = null;

        if (stripeCustomerId) {
          try {
            const customer = await ctx.stripe.customers.retrieve(stripeCustomerId);
            if (customer && !('deleted' in customer)) {
              customerEmail = (customer as Stripe.Customer).email || null;
              customerName = (customer as Stripe.Customer).name || null;
            }
          } catch {}
        }
        if (!customerEmail && pi.receipt_email) customerEmail = pi.receipt_email;

        let matchedUser: { id: string; email: string | null } | null = null;

        if (ctx.orgUsers) {
          if (stripeCustomerId && stripeIdMap.has(stripeCustomerId)) {
            matchedUser = stripeIdMap.get(stripeCustomerId)!;
          } else if (customerEmail && emailMap.has(customerEmail.toLowerCase())) {
            matchedUser = emailMap.get(customerEmail.toLowerCase())!;
          }
        } else {
          matchedUser = await matchUserToStripePayment(stripeCustomerId, customerEmail, customerName);
        }

        const existing = await storage.getWalletTransactionByStripePaymentIntentId(pi.id);
        const hasLedger = !!existing;
        const amountCents = pi.amount_received || pi.amount;

        if (hasLedger) credited++;
        else if (!matchedUser) unmatched++;
        else { missing++; missingCents += amountCents; }

        orgPayments.push({
          stripePaymentIntentId: pi.id,
          chargeId,
          customerEmail,
          customerName,
          stripeCustomerId,
          amountCents,
          currency: pi.currency,
          createdAt: pi.created,
          matchedUserId: matchedUser?.id || null,
          matchedUserEmail: matchedUser?.email || null,
          hasLedgerEntry: hasLedger,
          ledgerTxId: existing?.id || null,
        });
      }

      console.log(`${PLATFORM_LOG} audit — ${ctx.orgName}: ${payments.length} payments, ${credited} credited, ${missing} missing, ${unmatched} unmatched`);

      results.push({
        orgId: ctx.orgId,
        orgName: ctx.orgName,
        stripeAccountType: ctx.stripeAccountType,
        totalPayments: payments.length,
        creditedPayments: credited,
        missingCredits: missing,
        unmatchedPayments: unmatched,
        totalMissingCents: missingCents,
        payments: orgPayments,
      });
    }

    const healthyOrgs = results.filter(r => r.missingCredits === 0).length;
    const totalPayments = results.reduce((s, r) => s + r.totalPayments, 0);
    const totalCredited = results.reduce((s, r) => s + r.creditedPayments, 0);
    const totalMissing = results.reduce((s, r) => s + r.missingCredits, 0);
    const totalMissingCents = results.reduce((s, r) => s + r.totalMissingCents, 0);
    const totalUnmatched = results.reduce((s, r) => s + r.unmatchedPayments, 0);

    return {
      orgs: results,
      summary: {
        totalOrgs: results.length,
        healthyOrgs,
        orgsWithMissingCredits: results.length - healthyOrgs,
        totalPayments,
        totalCredited,
        totalMissing,
        totalMissingCents,
        totalUnmatched,
      },
    };
  }

  static async platformStripeWalletSyncRepair(dryRun = true, organizationId?: string, days = 90): Promise<{
    dryRun: boolean;
    repaired: Array<{
      orgId: string | null;
      orgName: string;
      stripePaymentIntentId: string;
      userId: string;
      userEmail: string | null;
      amountCents: number;
      currency: string;
      action: 'credited' | 'skipped' | 'no_user_match';
    }>;
    summary: { total: number; credited: number; skipped: number; noMatch: number };
  }> {
    const PLATFORM_LOG = '[Platform Stripe Wallet Sync]';
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const allOrgs = await storage.getAllOrganizations();
    const repaired: any[] = [];
    let totalCount = 0;
    let creditedCount = 0;
    let skippedCount = 0;
    let noMatchCount = 0;

    type RepairContext = {
      orgId: string | null;
      orgName: string;
      stripe: Stripe;
      orgUsers: Array<{ id: string; email: string | null; firstName: string | null; lastName: string | null; stripeCustomerId: string | null }> | null;
    };

    const contexts: RepairContext[] = [];

    for (const org of allOrgs) {
      if (organizationId && org.id !== organizationId) continue;
      if (org.stripeSecretKey) {
        const orgUsers = await storage.getUsersInOrgWithStripeInfo(org.id);
        contexts.push({ orgId: org.id, orgName: org.name, stripe: new Stripe(org.stripeSecretKey), orgUsers });
      }
    }

    if (!organizationId) {
      try {
        const platformStripe = await getUncachableStripeClient();
        contexts.push({ orgId: null, orgName: 'Platform (default Stripe)', stripe: platformStripe, orgUsers: null });
      } catch {}
    }

    for (const ctx of contexts) {
      const payments: Stripe.PaymentIntent[] = [];
      let hasMore = true;
      let startingAfter: string | undefined;
      try {
        while (hasMore) {
          const page = await ctx.stripe.paymentIntents.list({
            limit: 100,
            created: { gte: since },
            ...(startingAfter ? { starting_after: startingAfter } : {}),
          });
          payments.push(...page.data.filter(pi => pi.status === 'succeeded'));
          hasMore = page.has_more;
          if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
        }
      } catch (err: any) {
        console.error(`${PLATFORM_LOG} failed to list payments for ${ctx.orgName}:`, err.message);
        continue;
      }

      totalCount += payments.length;

      const emailMap = new Map<string, NonNullable<typeof ctx.orgUsers>[number]>();
      const stripeIdMap = new Map<string, NonNullable<typeof ctx.orgUsers>[number]>();
      if (ctx.orgUsers) {
        for (const u of ctx.orgUsers) {
          if (u.email) emailMap.set(u.email.toLowerCase(), u);
          if (u.stripeCustomerId) stripeIdMap.set(u.stripeCustomerId, u);
        }
      }

      for (const pi of payments) {
        const existing = await storage.getWalletTransactionByStripePaymentIntentId(pi.id);
        if (existing) {
          skippedCount++;
          repaired.push({ orgId: ctx.orgId, orgName: ctx.orgName, stripePaymentIntentId: pi.id, userId: existing.userId, userEmail: null, amountCents: pi.amount_received || pi.amount, currency: pi.currency, action: 'skipped' });
          continue;
        }

        const stripeCustomerId = typeof pi.customer === 'string' ? pi.customer : (pi.customer as any)?.id || null;
        const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge as any)?.id || null;
        let customerEmail: string | null = null;
        let customerName: string | null = null;

        if (stripeCustomerId) {
          try {
            const customer = await ctx.stripe.customers.retrieve(stripeCustomerId);
            if (customer && !('deleted' in customer)) {
              customerEmail = (customer as Stripe.Customer).email || null;
              customerName = (customer as Stripe.Customer).name || null;
            }
          } catch {}
        }
        if (!customerEmail && pi.receipt_email) customerEmail = pi.receipt_email;

        let matchedUser: { id: string; email: string | null } | null = null;
        if (ctx.orgUsers) {
          if (stripeCustomerId && stripeIdMap.has(stripeCustomerId)) matchedUser = stripeIdMap.get(stripeCustomerId)!;
          else if (customerEmail && emailMap.has(customerEmail.toLowerCase())) matchedUser = emailMap.get(customerEmail.toLowerCase())!;
        } else {
          matchedUser = await matchUserToStripePayment(stripeCustomerId, customerEmail, customerName);
        }

        if (!matchedUser) {
          noMatchCount++;
          repaired.push({ orgId: ctx.orgId, orgName: ctx.orgName, stripePaymentIntentId: pi.id, userId: '', userEmail: customerEmail, amountCents: pi.amount_received || pi.amount, currency: pi.currency, action: 'no_user_match' });
          continue;
        }

        const amountCents = pi.amount_received || pi.amount;

        if (!dryRun) {
          const prior = await storage.getUserBalance(matchedUser.id);
          await storage.creditWallet(matchedUser.id, amountCents, `Platform repair — $${(amountCents / 100).toFixed(2)} (${ctx.orgName}, pi: ${pi.id})`, undefined, pi.id, chargeId || undefined, pi.currency || 'usd', 'succeeded');
          const next = await storage.getUserBalance(matchedUser.id);
          console.log(`${PLATFORM_LOG} credited — org: ${ctx.orgName}, userId: ${matchedUser.id} (${matchedUser.email}), $${(amountCents / 100).toFixed(2)}, prior: $${(prior / 100).toFixed(2)}, new: $${(next / 100).toFixed(2)}`);
        } else {
          console.log(`${PLATFORM_LOG} [DRY RUN] would credit — org: ${ctx.orgName}, userId: ${matchedUser.id} (${matchedUser.email}), $${(amountCents / 100).toFixed(2)}, pi: ${pi.id}`);
        }

        creditedCount++;
        repaired.push({ orgId: ctx.orgId, orgName: ctx.orgName, stripePaymentIntentId: pi.id, userId: matchedUser.id, userEmail: matchedUser.email, amountCents, currency: pi.currency, action: 'credited' });
      }
    }

    return {
      dryRun,
      repaired,
      summary: { total: totalCount, credited: creditedCount, skipped: skippedCount, noMatch: noMatchCount },
    };
  }
}
