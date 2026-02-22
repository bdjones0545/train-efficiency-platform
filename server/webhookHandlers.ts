import { getStripeSync } from './stripeClient';
import { storage } from './storage';

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

    if (quote && quote.status !== 'PAID') {
      await storage.updateTeamQuote(quote.id, { status: 'PAID' });
      console.log(`Team quote ${quote.id} for "${quote.teamName}" marked as PAID (invoice: ${stripeInvoiceId})`);
    }
  }
}
