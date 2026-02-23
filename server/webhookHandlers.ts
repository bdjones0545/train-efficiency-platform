import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';
import { sendTeamQuoteEmail } from './email';

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
    } catch (err) {
      console.error('Error processing custom webhook logic:', err);
    }
  }

  static async handleInvoicePaid(stripeInvoiceId: string): Promise<void> {
    const quote = await storage.getTeamQuoteByStripeInvoiceId(stripeInvoiceId);

    if (!quote || quote.status === 'PAID') return;

    await storage.updateTeamQuote(quote.id, { status: 'PAID' });
    console.log(`Team quote ${quote.id} for "${quote.teamName}" Month ${quote.currentMonth}/${quote.totalMonths} marked as PAID (invoice: ${stripeInvoiceId})`);

    if (quote.currentMonth < quote.totalMonths) {
      await WebhookHandlers.generateNextMonthInvoice(quote);
    }
  }

  static async generateNextMonthInvoice(paidQuote: typeof import('@shared/schema').teamQuotes.$inferSelect): Promise<void> {
    try {
      const nextMonth = paidQuote.currentMonth + 1;
      const monthlyCents = paidQuote.totalCents;

      console.log(`Generating month ${nextMonth}/${paidQuote.totalMonths} invoice for "${paidQuote.teamName}"...`);

      const stripe = await getUncachableStripeClient();

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
        description: `Team Training — ${paidQuote.teamName} | Month ${nextMonth} of ${paidQuote.totalMonths} | ${paidQuote.numberOfAthletes} athletes × $${(paidQuote.costPerAthleteCents / 100).toFixed(2)} | ${paidQuote.trainingType} | ${paidQuote.frequency}`,
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
      });

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
        paidQuote.totalMonths
      ).catch(err => console.error("Failed to send next month team quote email:", err));

      console.log(`Month ${nextMonth}/${paidQuote.totalMonths} invoice created for "${paidQuote.teamName}" (quote: ${newQuote.id})`);
    } catch (error) {
      console.error(`Failed to generate month ${paidQuote.currentMonth + 1} invoice for "${paidQuote.teamName}":`, error);
    }
  }
}
