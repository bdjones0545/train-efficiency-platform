import Stripe from 'stripe';
import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';
import { sendTeamQuoteEmail, sendSubscriptionExpiredEmail, type OrgBranding } from './email';

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
}
