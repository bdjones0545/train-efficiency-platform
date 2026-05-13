/**
 * Stripe Invoicing Connector
 *
 * Agent-level invoice creation and payment recording.
 * All operations require confirmation (enforced by registry / runtime).
 *
 * Stored in: agent_invoices table (one row per AI-created invoice).
 * Attribution: workflow_run_id links back to workflow for resumption after payment.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { getUncachableStripeClient } from "../stripeClient";
import { storage } from "../storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreateInvoiceInput = {
  orgId: string;
  clientId: string;
  amountCents: number;
  description: string;
  dueDate?: string;
  toolCallId?: string;
  workflowRunId?: string;
};

export type AgentInvoiceRecord = {
  id: string;
  orgId: string;
  stripeInvoiceId: string | null;
  stripeCustomerId: string | null;
  clientId: string | null;
  amountCents: number | null;
  description: string | null;
  status: string | null;
  stripeInvoiceUrl: string | null;
  paidAt: Date | null;
  workflowRunId: string | null;
  toolCallId: string | null;
  createdAt: Date | null;
};

// ─── Customer management ──────────────────────────────────────────────────────

export async function getOrCreateStripeCustomer(
  clientId: string,
  orgId: string
): Promise<{ customerId: string; email: string | null }> {
  const stripe = await getUncachableStripeClient();
  const user = await storage.getUserByEmail(clientId).catch(() => null);

  let email: string | null = null;
  let name: string | null = null;
  let existingCustomerId: string | null = null;

  const rows = await db.execute(sql`
    SELECT id, email, first_name, last_name, stripe_customer_id
    FROM users WHERE id = ${clientId} LIMIT 1
  `);
  const row = (rows as any).rows?.[0] ?? rows[0];
  if (row) {
    email = row.email ?? null;
    name = [row.first_name, row.last_name].filter(Boolean).join(" ") || null;
    existingCustomerId = row.stripe_customer_id ?? null;
  }

  if (existingCustomerId) {
    try {
      await stripe.customers.retrieve(existingCustomerId);
      return { customerId: existingCustomerId, email };
    } catch {
      // Customer no longer exists on Stripe — fall through to create
    }
  }

  const customer = await stripe.customers.create({
    email: email ?? undefined,
    name: name ?? undefined,
    metadata: { userId: clientId, orgId },
  });

  await db.execute(sql`
    UPDATE users SET stripe_customer_id = ${customer.id} WHERE id = ${clientId}
  `);

  return { customerId: customer.id, email };
}

// ─── Invoice creation ─────────────────────────────────────────────────────────

export async function createAgentInvoice(
  input: CreateInvoiceInput
): Promise<{
  agentInvoiceId: string;
  stripeInvoiceId: string;
  stripeCustomerId: string;
  invoiceUrl: string;
  amountCents: number;
}> {
  const stripe = await getUncachableStripeClient();

  const { customerId } = await getOrCreateStripeCustomer(input.clientId, input.orgId);

  await stripe.invoiceItems.create({
    customer: customerId,
    amount: input.amountCents,
    currency: "usd",
    description: input.description,
  });

  const dueDateUnix = input.dueDate
    ? Math.floor(new Date(input.dueDate).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: "send_invoice",
    due_date: dueDateUnix,
    metadata: {
      orgId: input.orgId,
      clientId: input.clientId,
      agentCreated: "true",
      toolCallId: input.toolCallId ?? "",
      workflowRunId: input.workflowRunId ?? "",
    },
  });

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(finalized.id).catch(() => null);

  const invoiceUrl = finalized.hosted_invoice_url ?? "";

  const insertResult = await db.execute(sql`
    INSERT INTO agent_invoices
      (id, org_id, stripe_invoice_id, stripe_customer_id, tool_call_id, workflow_run_id,
       client_id, amount_cents, description, status, due_date, stripe_invoice_url, created_at, updated_at)
    VALUES
      (gen_random_uuid(), ${input.orgId}, ${finalized.id}, ${customerId},
       ${input.toolCallId ?? null}, ${input.workflowRunId ?? null},
       ${input.clientId}, ${input.amountCents}, ${input.description},
       'open',
       ${input.dueDate ? new Date(input.dueDate).toISOString() : null}::timestamptz,
       ${invoiceUrl},
       NOW(), NOW())
    RETURNING id
  `);
  const agentInvoiceId = ((insertResult as any).rows?.[0] ?? (insertResult as any)[0])?.id ?? "";

  return {
    agentInvoiceId,
    stripeInvoiceId: finalized.id,
    stripeCustomerId: customerId,
    invoiceUrl,
    amountCents: input.amountCents,
  };
}

// ─── Payment recording ────────────────────────────────────────────────────────

export async function recordManualPayment(
  orgId: string,
  clientId: string,
  amountCents: number,
  description: string,
  toolCallId?: string
): Promise<{ paymentIntentId: string; agentInvoiceId: string }> {
  const stripe = await getUncachableStripeClient();
  const { customerId } = await getOrCreateStripeCustomer(clientId, orgId);

  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: customerId,
    payment_method_types: ["card"],
    description,
    metadata: {
      orgId,
      clientId,
      agentCreated: "true",
      toolCallId: toolCallId ?? "",
      type: "manual_payment_record",
    },
  });

  const insertResult = await db.execute(sql`
    INSERT INTO agent_invoices
      (id, org_id, stripe_invoice_id, stripe_customer_id, tool_call_id,
       client_id, amount_cents, description, status, created_at, updated_at)
    VALUES
      (gen_random_uuid(), ${orgId}, ${pi.id}, ${customerId}, ${toolCallId ?? null},
       ${clientId}, ${amountCents}, ${description}, 'open', NOW(), NOW())
    RETURNING id
  `);
  const agentInvoiceId = ((insertResult as any).rows?.[0] ?? (insertResult as any)[0])?.id ?? "";

  return { paymentIntentId: pi.id, agentInvoiceId };
}

// ─── Invoice status & listing ─────────────────────────────────────────────────

export async function markAgentInvoicePaid(
  stripeInvoiceId: string
): Promise<{ workflowRunId: string | null; agentInvoiceId: string | null }> {
  const result = await db.execute(sql`
    UPDATE agent_invoices
    SET status = 'paid', paid_at = NOW(), updated_at = NOW()
    WHERE stripe_invoice_id = ${stripeInvoiceId}
      AND status != 'paid'
    RETURNING id, workflow_run_id
  `);
  const row = (result as any).rows?.[0] ?? (result as any)[0];
  return {
    agentInvoiceId: row?.id ?? null,
    workflowRunId: row?.workflow_run_id ?? null,
  };
}

export async function linkInvoiceToWorkflow(
  agentInvoiceId: string,
  workflowRunId: string
): Promise<void> {
  await db.execute(sql`
    UPDATE agent_invoices
    SET workflow_run_id = ${workflowRunId}, updated_at = NOW()
    WHERE id = ${agentInvoiceId}
  `);
}

export async function listAgentInvoices(orgId: string, limit = 50): Promise<AgentInvoiceRecord[]> {
  const rows = await db.execute(sql`
    SELECT id, org_id, stripe_invoice_id, stripe_customer_id, client_id,
           amount_cents, description, status, stripe_invoice_url,
           paid_at, workflow_run_id, tool_call_id, created_at
    FROM agent_invoices
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return ((rows as any).rows ?? rows) as AgentInvoiceRecord[];
}

export async function listUnpaidAgentInvoices(orgId: string): Promise<AgentInvoiceRecord[]> {
  const rows = await db.execute(sql`
    SELECT id, org_id, stripe_invoice_id, stripe_customer_id, client_id,
           amount_cents, description, status, stripe_invoice_url,
           paid_at, workflow_run_id, tool_call_id, created_at
    FROM agent_invoices
    WHERE org_id = ${orgId} AND status NOT IN ('paid', 'void')
    ORDER BY created_at DESC
  `);
  return ((rows as any).rows ?? rows) as AgentInvoiceRecord[];
}
