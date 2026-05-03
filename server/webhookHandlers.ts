import Stripe from 'stripe';
import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';
import { organizationSubscriptionPlans } from '@shared/schema';
import { sendTeamQuoteEmail, sendSubscriptionExpiredEmail, type OrgBranding } from './email';

const LOG_PREFIX = '[Stripe Wallet Sync]';

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

    try {
      const event = JSON.parse(payload.toString());

      if (event.type === 'invoice.paid') {
        const invoice = event.data?.object;
        if (invoice?.id) {
          await WebhookHandlers.handleInvoicePaid(invoice.id);
        }
        if (invoice?.subscription) {
          await WebhookHandlers.handleSubscriptionRenewal(invoice.subscription, invoice.period_start, invoice.period_end);
        }
      }

      if (event.type === 'invoice.payment_succeeded') {
        const invoice = event.data?.object;
        if (invoice?.id) {
          await WebhookHandlers.handleInvoicePaid(invoice.id);
        }
        if (invoice?.subscription) {
          await WebhookHandlers.handleSubscriptionRenewal(invoice.subscription, invoice.period_start, invoice.period_end);
        }
      }

      if (event.type === 'customer.subscription.created' ||
          event.type === 'customer.subscription.updated' ||
          event.type === 'customer.subscription.deleted') {
        await WebhookHandlers.handleSubscriptionEvent(event.data?.object);
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data?.object;

        if (session?.mode === 'subscription' && session?.subscription) {
          const orgId = session.metadata?.orgId;
          if (orgId) {
            const stripe = await getUncachableStripeClient();
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
            await storage.updateOrganization(orgId, {
              stripeSubscriptionId: subscription.id,
              subscriptionStatus: subscription.status as any,
              trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
              subscriptionCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
            });
            console.log(`Subscription ${subscription.id} linked to org ${orgId} (status: ${subscription.status})`);
          }
        }

        if (session?.mode === 'payment' && session?.payment_status === 'paid') {
          const metaType = session.metadata?.type;
          const metaUserId = session.metadata?.userId;
          const amountCents = parseInt(session.metadata?.amountCents || '0', 10);
          const sessionId = session.id;

          if (metaType === 'wallet_deposit' && metaUserId && amountCents > 0) {
            const existingBySession = await storage.getWalletTransactionByStripeSessionId(sessionId);
            if (existingBySession) {
              console.log(`${LOG_PREFIX} skipped duplicate — checkoutSessionId ${sessionId} already credited`);
            } else {
              const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
              if (paymentIntentId) {
                const existingByPI = await storage.getWalletTransactionByStripePaymentIntentId(paymentIntentId);
                if (existingByPI) {
                  console.log(`${LOG_PREFIX} skipped duplicate — paymentIntentId ${paymentIntentId} already credited`);
                } else {
                  const priorBalance = await storage.getUserBalance(metaUserId);
                  await storage.creditWallet(
                    metaUserId,
                    amountCents,
                    `Added $${(amountCents / 100).toFixed(2)} via Stripe (webhook)`,
                    sessionId,
                    paymentIntentId,
                    undefined,
                    session.currency || 'usd',
                    'succeeded'
                  );
                  const newBalance = await storage.getUserBalance(metaUserId);
                  console.log(`${LOG_PREFIX} wallet deposit credited via checkout.session.completed — userId: ${metaUserId}, amount: $${(amountCents / 100).toFixed(2)}, prior balance: $${(priorBalance / 100).toFixed(2)}, new balance: $${(newBalance / 100).toFixed(2)}`);
                }
              }
            }
          }
        }
      }

      if (event.type === 'payment_intent.succeeded') {
        const pi = event.data?.object;
        if (!pi?.id) return;

        const isWalletDeposit = pi.metadata?.type === 'wallet_deposit';
        if (isWalletDeposit) {
          console.log(`${LOG_PREFIX} payment_intent.succeeded for wallet_deposit — skipping direct credit (handled via checkout.session.completed)`);
          return;
        }

        const amountCents = pi.amount_received || pi.amount || 0;
        const currency = pi.currency || 'usd';
        const stripeCustomerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null;
        const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id || null;

        let customerEmail: string | null = null;
        let customerName: string | null = null;

        if (stripeCustomerId) {
          try {
            const stripe = await getUncachableStripeClient();
            const customer = await stripe.customers.retrieve(stripeCustomerId);
            if (customer && !('deleted' in customer)) {
              customerEmail = customer.email || null;
              customerName = customer.name || null;
            }
          } catch {}
        }

        if (!customerEmail && pi.receipt_email) {
          customerEmail = pi.receipt_email;
        }

        await processWalletCredit({
          stripePaymentIntentId: pi.id,
          stripeChargeId: chargeId,
          stripeCustomerId,
          customerEmail,
          customerName,
          amountCents,
          currency,
          description: `Stripe payment $${(amountCents / 100).toFixed(2)} (paymentIntent: ${pi.id})`,
          eventType: event.type,
        });
      }

      if (event.type === 'charge.succeeded') {
        const charge = event.data?.object;
        if (!charge?.id) return;

        const isWalletDeposit = charge.metadata?.type === 'wallet_deposit';
        if (isWalletDeposit) {
          console.log(`${LOG_PREFIX} charge.succeeded for wallet_deposit — skipping direct credit (handled via checkout.session.completed)`);
          return;
        }

        const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id || null;

        if (paymentIntentId) {
          const existing = await storage.getWalletTransactionByStripePaymentIntentId(paymentIntentId);
          if (existing) {
            console.log(`${LOG_PREFIX} skipped duplicate charge.succeeded — paymentIntentId ${paymentIntentId} already credited`);
            return;
          }
        }

        const amountCents = charge.amount || 0;
        const currency = charge.currency || 'usd';
        const stripeCustomerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id || null;

        let customerEmail: string | null = charge.billing_details?.email || charge.receipt_email || null;
        let customerName: string | null = charge.billing_details?.name || null;

        if (!customerEmail && stripeCustomerId) {
          try {
            const stripe = await getUncachableStripeClient();
            const customer = await stripe.customers.retrieve(stripeCustomerId);
            if (customer && !('deleted' in customer)) {
              customerEmail = (customer as Stripe.Customer).email || null;
              customerName = customerName || (customer as Stripe.Customer).name || null;
            }
          } catch {}
        }

        await processWalletCredit({
          stripePaymentIntentId: paymentIntentId,
          stripeChargeId: charge.id,
          stripeCustomerId,
          customerEmail,
          customerName,
          amountCents,
          currency,
          description: `Stripe charge $${(amountCents / 100).toFixed(2)} (chargeId: ${charge.id})`,
          eventType: event.type,
        });
      }

    } catch (err) {
      console.error('Error processing custom webhook logic:', err);
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
}
