import crypto from "node:crypto";
import express, { type Express, type RequestHandler } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  agentRevenueEvents,
  agentSubmissions,
  agentTemplates,
  developerAccounts,
  marketplaceStripeEvents,
  organizations,
  orgInstalledAgents,
  royaltyDistributions,
} from "@shared/schema";

type StripeWebhookClient = {
  webhooks: {
    constructEvent(payload: Buffer, signature: string, secret: string): any;
  };
};

type MarketplaceWebhookDependencies = {
  getStripeClient?: () => Promise<StripeWebhookClient>;
};

type MarketplaceAction = "revenue" | "royalty";

class MarketplaceWebhookError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "MarketplaceWebhookError";
  }
}

let marketplaceSchemaPromise: Promise<void> | undefined;

/**
 * Keep marketplace payment tables self-initializing for existing deployments.
 * Schema declarations remain in shared/schema.ts; this only applies additive DDL.
 */
export function ensureMarketplaceStripeWebhookSchema(): Promise<void> {
  if (!marketplaceSchemaPromise) {
    marketplaceSchemaPromise = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(71310042)`);
      await tx.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS marketplace_stripe_events (
          id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
          stripe_event_id text NOT NULL,
          event_type text NOT NULL,
          payload_hash text NOT NULL,
          processing_status text NOT NULL DEFAULT 'processing',
          financial_action text,
          organization_id text,
          agent_id text,
          developer_id text,
          amount_cents integer,
          currency text,
          failure_message text,
          attempt_count integer NOT NULL DEFAULT 1,
          claimed_at timestamp NOT NULL DEFAULT now(),
          completed_at timestamp,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `));
      await tx.execute(sql.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS marketplace_stripe_events_stripe_event_unique
        ON marketplace_stripe_events (stripe_event_id)
      `));
      await tx.execute(sql.raw(`
        CREATE INDEX IF NOT EXISTS marketplace_stripe_events_status_idx
        ON marketplace_stripe_events (processing_status)
      `));

      await tx.execute(sql.raw(`ALTER TABLE agent_revenue_events ADD COLUMN IF NOT EXISTS currency text`));
      await tx.execute(sql.raw(`ALTER TABLE agent_revenue_events ADD COLUMN IF NOT EXISTS stripe_event_id text`));
      await tx.execute(sql.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS agent_revenue_events_stripe_event_unique
        ON agent_revenue_events (stripe_event_id) WHERE stripe_event_id IS NOT NULL
      `));

      await tx.execute(sql.raw(`ALTER TABLE royalty_distributions ADD COLUMN IF NOT EXISTS stripe_event_id text`));
      // The legacy monthly aggregator has a broad unique index. Stripe receipts
      // need one distribution per provider event, while legacy rows (which have
      // no provider event ID) remain protected by their original period key.
      await tx.execute(sql.raw(`
        DROP INDEX IF EXISTS royalty_distributions_developer_id_agent_id_revenue_source__idx
      `));
      await tx.execute(sql.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS royalty_distributions_stripe_event_unique
        ON royalty_distributions (stripe_event_id) WHERE stripe_event_id IS NOT NULL
      `));
      await tx.execute(sql.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS royalty_distributions_legacy_period_unique
        ON royalty_distributions (developer_id, agent_id, revenue_source, period)
        WHERE stripe_event_id IS NULL
      `));
    }).catch((error) => {
      marketplaceSchemaPromise = undefined;
      throw error;
    });
  }
  return marketplaceSchemaPromise;
}

async function getDefaultStripeClient(): Promise<StripeWebhookClient> {
  const { getUncachableStripeClient } = await import("../stripeClient");
  return getUncachableStripeClient();
}

function asId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MarketplaceWebhookError(`Missing trusted ${field}`, 400);
  }
  return value;
}

function asPositiveAmountCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new MarketplaceWebhookError("Marketplace amount must be a positive integer in cents", 400);
  }
  return value;
}

function asCurrency(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z]{3}$/.test(value)) {
    throw new MarketplaceWebhookError("Marketplace currency must be a three-letter code", 400);
  }
  return value.toLowerCase();
}

function metadataString(metadata: unknown, field: string): string | undefined {
  const value = (metadata as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function periodForNow(): string {
  return new Date().toISOString().slice(0, 7);
}

async function resolveTrustedMarketplaceOwnership(
  tx: any,
  object: any,
): Promise<{ organizationId: string; agentId: string; developerId: string }> {
  const customerId = asId(
    typeof object?.customer === "string" ? object.customer : object?.customer?.id,
    "Stripe customer ID",
  );
  const agentId = asId(metadataString(object?.metadata, "agentId"), "marketplace agent ID");

  const matchingOrganizations = await tx.select().from(organizations)
    .where(eq(organizations.stripeCustomerId, customerId));
  if (matchingOrganizations.length !== 1) {
    throw new MarketplaceWebhookError("Stripe customer does not map to exactly one organization", 400);
  }
  const organization = matchingOrganizations[0];

  const metadataOrgId = metadataString(object?.metadata, "orgId");
  if (metadataOrgId && metadataOrgId !== organization.id) {
    throw new MarketplaceWebhookError("Marketplace metadata organization conflicts with Stripe customer ownership", 400);
  }

  const installations = await tx.select().from(orgInstalledAgents).where(and(
    eq(orgInstalledAgents.orgId, organization.id),
    eq(orgInstalledAgents.agentId, agentId),
    eq(orgInstalledAgents.status, "active"),
  ));
  if (installations.length !== 1) {
    throw new MarketplaceWebhookError("Active installed marketplace agent was not found for Stripe customer organization", 400);
  }

  const templates = await tx.select().from(agentTemplates).where(eq(agentTemplates.agentId, agentId));
  if (templates.length !== 1) {
    throw new MarketplaceWebhookError("Marketplace agent template is unknown or ambiguous", 400);
  }

  const submissions = await tx.select().from(agentSubmissions).where(and(
    eq(agentSubmissions.agentTemplateId, templates[0].id),
    eq(agentSubmissions.submissionStatus, "published"),
  ));
  if (submissions.length !== 1) {
    throw new MarketplaceWebhookError("Marketplace developer ownership is unknown or ambiguous", 400);
  }
  const developerId = submissions[0].developerId;

  const developers = await tx.select().from(developerAccounts)
    .where(eq(developerAccounts.id, developerId));
  if (developers.length !== 1 || developers[0].status !== "active") {
    throw new MarketplaceWebhookError("Marketplace developer account is unavailable", 400);
  }

  const metadataDeveloperId = metadataString(object?.metadata, "developerId");
  if (metadataDeveloperId && metadataDeveloperId !== developerId) {
    throw new MarketplaceWebhookError("Marketplace metadata developer conflicts with persisted ownership", 400);
  }

  return { organizationId: organization.id, agentId, developerId };
}

async function claimMarketplaceEvent(
  tx: any,
  event: any,
  payloadHash: string,
): Promise<{ kind: "claimed" } | { kind: "duplicate" }> {
  const eventId = asId(event?.id, "Stripe event ID");
  const eventType = asId(event?.type, "Stripe event type");
  const [inserted] = await tx.insert(marketplaceStripeEvents).values({
    stripeEventId: eventId,
    eventType,
    payloadHash,
    processingStatus: "processing",
    attemptCount: 1,
    claimedAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing().returning();
  if (inserted) return { kind: "claimed" };

  const existing = await tx.select().from(marketplaceStripeEvents)
    .where(eq(marketplaceStripeEvents.stripeEventId, eventId));
  if (existing.length !== 1) {
    throw new MarketplaceWebhookError("Marketplace event claim could not be resolved", 500);
  }
  const row = existing[0];
  if (row.payloadHash !== payloadHash) {
    throw new MarketplaceWebhookError("Stripe event ID was reused with conflicting payload content", 409);
  }
  if (row.processingStatus === "completed") return { kind: "duplicate" };
  if (row.processingStatus !== "failed") {
    throw new MarketplaceWebhookError("Marketplace event is already being processed", 409);
  }

  const [reclaimed] = await tx.update(marketplaceStripeEvents).set({
    processingStatus: "processing",
    failureMessage: null,
    attemptCount: (row.attemptCount ?? 1) + 1,
    claimedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(marketplaceStripeEvents.id, row.id),
    eq(marketplaceStripeEvents.processingStatus, "failed"),
  )).returning();
  if (!reclaimed) {
    throw new MarketplaceWebhookError("Marketplace event is already being processed", 409);
  }
  return { kind: "claimed" };
}

async function processVerifiedMarketplaceEvent(event: any, payloadHash: string) {
  const outcome = await db.transaction(async (tx) => {
    const claim = await claimMarketplaceEvent(tx, event, payloadHash);
    if (claim.kind === "duplicate") return { kind: "duplicate" as const };

    await tx.execute(sql.raw("SAVEPOINT marketplace_financial_work"));
    try {
      const object = event?.data?.object;
      const ownership = await resolveTrustedMarketplaceOwnership(tx, object);
      const eventType = asId(event?.type, "Stripe event type");
      const amountCents = asPositiveAmountCents(
        eventType === "checkout.session.completed" ? object?.amount_total : object?.amount_paid,
      );
      const currency = asCurrency(object?.currency);
      const amount = amountCents / 100;
      const ledgerValues = {
        organizationId: ownership.organizationId,
        agentId: ownership.agentId,
        developerId: ownership.developerId,
        amountCents,
        currency,
        updatedAt: new Date(),
      };

      if (eventType === "checkout.session.completed") {
        const developer = await tx.select().from(developerAccounts)
          .where(eq(developerAccounts.id, ownership.developerId));
        const royaltyRate = developer[0]?.revenueShareRate ?? 0.30;
        await tx.insert(agentRevenueEvents).values({
          developerId: ownership.developerId,
          agentId: ownership.agentId,
          orgId: ownership.organizationId,
          eventType: "install",
          amount,
          royaltyAmount: amount * royaltyRate,
          currency,
          stripeEventId: event.id,
          attribution: {
            checkoutSessionId: object.id,
            stripeCustomerId: object.customer,
            marketplaceEventId: event.id,
          },
          period: periodForNow(),
        });
        await tx.update(marketplaceStripeEvents).set({
          ...ledgerValues,
          financialAction: "revenue",
          processingStatus: "completed",
          completedAt: new Date(),
        }).where(eq(marketplaceStripeEvents.stripeEventId, event.id));
      } else if (eventType === "invoice.paid") {
        const developer = await tx.select().from(developerAccounts)
          .where(eq(developerAccounts.id, ownership.developerId));
        const developerShareRate = developer[0]?.revenueShareRate ?? 0.30;
        const developerShare = amount * developerShareRate;
        await tx.insert(royaltyDistributions).values({
          developerId: ownership.developerId,
          agentId: ownership.agentId,
          revenueSource: "subscription",
          stripeEventId: event.id,
          grossRevenue: amount,
          platformShare: amount - developerShare,
          developerShare,
          platformShareRate: 1 - developerShareRate,
          developerShareRate,
          payoutStatus: "pending",
          period: periodForNow(),
        });
        await tx.update(marketplaceStripeEvents).set({
          ...ledgerValues,
          financialAction: "royalty",
          processingStatus: "completed",
          completedAt: new Date(),
        }).where(eq(marketplaceStripeEvents.stripeEventId, event.id));
      } else {
        throw new MarketplaceWebhookError(`Unsupported marketplace Stripe event type: ${eventType}`, 400);
      }

      await tx.execute(sql.raw("RELEASE SAVEPOINT marketplace_financial_work"));
      return { kind: "completed" as const, eventType };
    } catch (error: any) {
      await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT marketplace_financial_work"));
      await tx.update(marketplaceStripeEvents).set({
        processingStatus: "failed",
        failureMessage: error?.message?.slice(0, 2000) ?? "Marketplace financial processing failed",
        updatedAt: new Date(),
      }).where(eq(marketplaceStripeEvents.stripeEventId, event.id));
      await tx.execute(sql.raw("RELEASE SAVEPOINT marketplace_financial_work"));
      return { kind: "failed" as const, error };
    }
  });

  if (outcome.kind === "failed") {
    throw outcome.error;
  }
  return outcome;
}

export function createMarketplaceStripeWebhookHandler(
  dependencies: MarketplaceWebhookDependencies = {},
): RequestHandler {
  const getStripeClient = dependencies.getStripeClient ?? getDefaultStripeClient;

  return async (req, res) => {
    const webhookSecret = process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(503).json({ message: "Marketplace webhook is not configured" });
    }

    const signatureHeader = req.headers["stripe-signature"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!signature) {
      return res.status(400).json({ message: "Missing stripe-signature" });
    }
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ message: "Marketplace webhook requires raw request bytes" });
    }

    let event: any;
    try {
      const stripe = await getStripeClient();
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch {
      return res.status(400).json({ message: "Webhook signature invalid" });
    }

    try {
      await ensureMarketplaceStripeWebhookSchema();
      const payloadHash = crypto.createHash("sha256").update(req.body).digest("hex");
      const outcome = await processVerifiedMarketplaceEvent(event, payloadHash);
      return res.status(200).json({
        received: true,
        type: event.type,
        duplicate: outcome.kind === "duplicate",
      });
    } catch (error: any) {
      const statusCode = error instanceof MarketplaceWebhookError ? error.statusCode : 500;
      console.error("[marketplace-webhook] processing failed:", error?.message ?? error);
      return res.status(statusCode).json({
        message: statusCode >= 500 ? "Marketplace webhook processing failed" : error.message,
      });
    }
  };
}

export function registerMarketplaceStripeWebhook(
  app: Express,
  dependencies?: MarketplaceWebhookDependencies,
): void {
  app.post(
    "/api/stripe/marketplace-webhook",
    express.raw({ type: "application/json" }),
    createMarketplaceStripeWebhookHandler(dependencies),
  );
}