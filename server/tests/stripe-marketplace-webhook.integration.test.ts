/**
 * Marketplace Stripe webhook payment-integrity regression suite.
 *
 * The suite creates a brand-new PostgreSQL schema, clones only the relevant
 * marketplace tables, and invokes the real raw-body Express route over HTTP.
 * Stripe signatures are generated locally; no Stripe API request is made.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { test, after } from "node:test";
import { Client } from "pg";
import Stripe from "stripe";

const originalDatabaseUrl = process.env.DATABASE_URL;
if (!originalDatabaseUrl) throw new Error("DATABASE_URL is required for marketplace Stripe integration tests");

const schemaName = `stripe_marketplace_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const safeSchemaName = `"${schemaName}"`;
const admin = new Client({ connectionString: originalDatabaseUrl });

await admin.connect();
await admin.query(`CREATE SCHEMA ${safeSchemaName}`);
for (const table of [
  "organizations",
  "agent_templates",
  "org_installed_agents",
  "developer_accounts",
  "agent_submissions",
  "agent_revenue_events",
  "royalty_distributions",
]) {
  await admin.query(`CREATE TABLE ${safeSchemaName}."${table}" (LIKE public."${table}" INCLUDING ALL)`);
}

const testDatabaseUrl = new URL(originalDatabaseUrl);
testDatabaseUrl.searchParams.set("options", `-c search_path=${schemaName},public`);
process.env.DATABASE_URL = testDatabaseUrl.toString();

const express = (await import("express")).default;
const {
  registerMarketplaceStripeWebhook,
  ensureMarketplaceStripeWebhookSchema,
} = await import("../services/marketplace-stripe-webhook");
const {
  db,
  pool,
} = await import("../db");
const {
  organizations,
  agentTemplates,
  orgInstalledAgents,
  developerAccounts,
  agentSubmissions,
  agentRevenueEvents,
  royaltyDistributions,
  marketplaceStripeEvents,
} = await import("@shared/schema");
const { and, eq, sql } = await import("drizzle-orm");

const signingSecret = "whsec_marketplace_integrity_test_secret";
const stripe = new Stripe("sk_test_marketplace_integrity_test");
process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET = signingSecret;

const app = express();
registerMarketplaceStripeWebhook(app, { getStripeClient: async () => stripe });
const server = http.createServer(app);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Test server did not provide a TCP address");
const baseUrl = `http://127.0.0.1:${address.port}`;

const orgA = { id: `org-a-${randomUUID()}`, customerId: `cus_a_${randomUUID()}` };
const orgB = { id: `org-b-${randomUUID()}`, customerId: `cus_b_${randomUUID()}` };
const devA = { id: `dev-a-${randomUUID()}` };
const devB = { id: `dev-b-${randomUUID()}` };
const agentA = `agent-a-${randomUUID()}`;
const agentB = `agent-b-${randomUUID()}`;

async function seedFixtures() {
  await db.insert(organizations).values([
    { id: orgA.id, name: "Marketplace Org A", slug: `marketplace-a-${randomUUID()}`, stripeCustomerId: orgA.customerId },
    { id: orgB.id, name: "Marketplace Org B", slug: `marketplace-b-${randomUUID()}`, stripeCustomerId: orgB.customerId },
  ]);
  await db.insert(developerAccounts).values([
    { id: devA.id, orgId: "developer-org-a", displayName: "Developer A", status: "active", revenueShareRate: 0.30 },
    { id: devB.id, orgId: "developer-org-b", displayName: "Developer B", status: "active", revenueShareRate: 0.25 },
  ]);
  const [templateA] = await db.insert(agentTemplates).values({
    agentId: agentA, agentName: "Agent A", maintainer: "developer-org-a", status: "active",
  }).returning();
  const [templateB] = await db.insert(agentTemplates).values({
    agentId: agentB, agentName: "Agent B", maintainer: "developer-org-b", status: "active",
  }).returning();
  await db.insert(agentSubmissions).values([
    { developerId: devA.id, agentTemplateId: templateA.id, submissionStatus: "published" },
    { developerId: devB.id, agentTemplateId: templateB.id, submissionStatus: "published" },
  ]);
  await db.insert(orgInstalledAgents).values([
    { orgId: orgA.id, agentId: agentA, agentTemplateId: templateA.id, status: "active" },
    { orgId: orgB.id, agentId: agentB, agentTemplateId: templateB.id, status: "active" },
  ]);
}

function checkoutEvent(overrides: Partial<any> = {}) {
  const { data: dataOverrides, ...eventOverrides } = overrides;
  const objectOverrides = dataOverrides?.object ?? {};
  return {
    id: `evt_checkout_${randomUUID()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${randomUUID()}`,
        customer: orgA.customerId,
        amount_total: 12_500,
        currency: "usd",
        metadata: { agentId: agentA, orgId: orgA.id, developerId: devA.id },
        ...objectOverrides,
      },
    },
    ...eventOverrides,
  };
}

function invoiceEvent(overrides: Partial<any> = {}) {
  const { data: dataOverrides, ...eventOverrides } = overrides;
  const objectOverrides = dataOverrides?.object ?? {};
  return {
    id: `evt_invoice_${randomUUID()}`,
    type: "invoice.paid",
    data: {
      object: {
        id: `in_${randomUUID()}`,
        customer: orgA.customerId,
        amount_paid: 5_000,
        currency: "usd",
        metadata: { agentId: agentA, orgId: orgA.id, developerId: devA.id },
        ...objectOverrides,
      },
    },
    ...eventOverrides,
  };
}

function signedBody(event: any, timestamp?: number) {
  const body = JSON.stringify(event);
  return {
    body,
    signature: stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: signingSecret,
      ...(timestamp ? { timestamp } : {}),
    }),
  };
}

async function post(body: string, signature?: string) {
  const response = await fetch(`${baseUrl}/api/stripe/marketplace-webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "stripe-signature": signature } : {}),
    },
    body,
  });
  return { status: response.status, body: await response.json() as any };
}

async function revenueRows(eventId?: string) {
  const condition = eventId ? eq(agentRevenueEvents.stripeEventId, eventId) : undefined;
  return condition
    ? db.select().from(agentRevenueEvents).where(condition)
    : db.select().from(agentRevenueEvents);
}

async function royaltyRows(eventId?: string) {
  const condition = eventId ? eq(royaltyDistributions.stripeEventId, eventId) : undefined;
  return condition
    ? db.select().from(royaltyDistributions).where(condition)
    : db.select().from(royaltyDistributions);
}

await seedFixtures();
await ensureMarketplaceStripeWebhookSchema();

test("marketplace webhook fails closed without required configuration or signature", async () => {
  const event = checkoutEvent();
  const { body, signature } = signedBody(event);

  delete process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET;
  assert.equal((await post(body, signature)).status, 503, "missing secret must fail closed");
  assert.equal((await post(body)).status, 503, "missing secret and signature must fail closed");
  process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET = signingSecret;

  assert.equal((await post(body)).status, 400, "missing signature must fail closed");
  assert.equal((await post(body, "t=1,v1=not-a-signature")).status, 400, "invalid signature must fail closed");
  assert.equal((await revenueRows(event.id)).length, 0);
});

test("verified raw payload succeeds and tampering or stale signatures fail", async () => {
  const event = checkoutEvent();
  const { body, signature } = signedBody(event);
  const accepted = await post(body, signature);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.duplicate, false);

  const rows = await revenueRows(event.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orgId, orgA.id);
  assert.equal(rows[0].developerId, devA.id);
  assert.equal(rows[0].amount, 125);
  assert.equal(rows[0].currency, "usd");
  assert.equal(rows[0].stripeEventId, event.id);

  assert.equal((await post(`${body} `, signature)).status, 400, "one-byte tamper must invalidate signature");
  const stale = signedBody(checkoutEvent(), Math.floor(Date.now() / 1000) - 3_600);
  assert.equal((await post(stale.body, stale.signature)).status, 400, "stale Stripe signature must be rejected");
});

test("unsafe marketplace amounts and currencies fail before financial mutation", async () => {
  const invalidCases = [
    checkoutEvent({ data: { object: { amount_total: 0 } } }),
    checkoutEvent({ data: { object: { amount_total: -1 } } }),
    checkoutEvent({ data: { object: { amount_total: "12500" } } }),
    checkoutEvent({ data: { object: { currency: "us" } } }),
  ];

  for (const event of invalidCases) {
    const signed = signedBody(event);
    assert.equal((await post(signed.body, signed.signature)).status, 400);
    assert.equal((await revenueRows(event.id)).length, 0);
  }
});

test("durable event ledger prevents serial, concurrent, and conflicting replays", async () => {
  const event = checkoutEvent();
  const signed = signedBody(event);
  assert.equal((await post(signed.body, signed.signature)).status, 200);
  const duplicate = await post(signed.body, signed.signature);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal((await revenueRows(event.id)).length, 1);

  const concurrent = checkoutEvent();
  const concurrentSigned = signedBody(concurrent);
  const results = await Promise.all([
    post(concurrentSigned.body, concurrentSigned.signature),
    post(concurrentSigned.body, concurrentSigned.signature),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 200]);
  assert.equal(results.filter((result) => result.body.duplicate === false).length, 1);
  assert.equal((await revenueRows(concurrent.id)).length, 1);
  const [completed] = await db.select().from(marketplaceStripeEvents)
    .where(eq(marketplaceStripeEvents.stripeEventId, concurrent.id));
  assert.equal(completed.processingStatus, "completed");

  const conflict = checkoutEvent({ id: event.id, data: { object: { amount_total: 99_999 } } });
  const conflictingSigned = signedBody(conflict);
  assert.equal((await post(conflictingSigned.body, conflictingSigned.signature)).status, 409);
  assert.equal((await revenueRows(event.id)).length, 1);
});

test("authoritative customer and installation ownership isolates tenants", async () => {
  const validOrgB = checkoutEvent({
    data: { object: { customer: orgB.customerId, metadata: { agentId: agentB, orgId: orgB.id, developerId: devB.id } } },
  });
  const validOrgBSigned = signedBody(validOrgB);
  assert.equal((await post(validOrgBSigned.body, validOrgBSigned.signature)).status, 200);
  const [orgBRevenue] = await revenueRows(validOrgB.id);
  assert.equal(orgBRevenue.orgId, orgB.id);
  assert.equal(orgBRevenue.agentId, agentB);

  const crossTenant = checkoutEvent({
    data: { object: { customer: orgA.customerId, metadata: { agentId: agentA, orgId: orgB.id, developerId: devA.id } } },
  });
  const crossTenantSigned = signedBody(crossTenant);
  assert.equal((await post(crossTenantSigned.body, crossTenantSigned.signature)).status, 400);
  assert.equal((await revenueRows(crossTenant.id)).length, 0);

  const unknownCustomer = checkoutEvent({ data: { object: { customer: `cus_unknown_${randomUUID()}` } } });
  const unknownCustomerSigned = signedBody(unknownCustomer);
  assert.equal((await post(unknownCustomerSigned.body, unknownCustomerSigned.signature)).status, 400);

  const wrongResource = checkoutEvent({
    data: { object: { customer: orgA.customerId, metadata: { agentId: agentB, orgId: orgA.id, developerId: devB.id } } },
  });
  const wrongResourceSigned = signedBody(wrongResource);
  assert.equal((await post(wrongResourceSigned.body, wrongResourceSigned.signature)).status, 400);
});

test("revenue failure is durable, retryable, and exactly once", async () => {
  await admin.query(`
    CREATE OR REPLACE FUNCTION ${safeSchemaName}.fail_marketplace_revenue()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced revenue failure'; END $$;
  `);
  await admin.query(`
    CREATE TRIGGER fail_marketplace_revenue
    BEFORE INSERT ON ${safeSchemaName}.agent_revenue_events
    FOR EACH ROW EXECUTE FUNCTION ${safeSchemaName}.fail_marketplace_revenue();
  `);

  const event = checkoutEvent();
  const signed = signedBody(event);
  assert.equal((await post(signed.body, signed.signature)).status, 500);
  assert.equal((await revenueRows(event.id)).length, 0);
  const [failed] = await db.select().from(marketplaceStripeEvents)
    .where(eq(marketplaceStripeEvents.stripeEventId, event.id));
  assert.equal(failed.processingStatus, "failed");
  assert.equal(failed.completedAt, null);

  await admin.query(`DROP TRIGGER fail_marketplace_revenue ON ${safeSchemaName}.agent_revenue_events`);
  assert.equal((await post(signed.body, signed.signature)).status, 200);
  assert.equal((await revenueRows(event.id)).length, 1);
  assert.equal((await post(signed.body, signed.signature)).status, 200);
  assert.equal((await revenueRows(event.id)).length, 1);
});

test("royalty values are persisted, linked, retryable, and deduplicated", async () => {
  const event = invoiceEvent();
  const signed = signedBody(event);
  assert.equal((await post(signed.body, signed.signature)).status, 200);
  const [royalty] = await royaltyRows(event.id);
  assert.equal(royalty.grossRevenue, 50);
  assert.equal(royalty.developerShareRate, 0.30);
  assert.equal(royalty.developerShare, 15);
  assert.equal(royalty.platformShare, 35);
  assert.equal(royalty.payoutStatus, "pending");
  assert.equal(royalty.stripeEventId, event.id);
  assert.equal((await post(signed.body, signed.signature)).body.duplicate, true);
  assert.equal((await royaltyRows(event.id)).length, 1);

  await admin.query(`
    CREATE OR REPLACE FUNCTION ${safeSchemaName}.fail_marketplace_royalty()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced royalty failure'; END $$;
  `);
  await admin.query(`
    CREATE TRIGGER fail_marketplace_royalty
    BEFORE INSERT ON ${safeSchemaName}.royalty_distributions
    FOR EACH ROW EXECUTE FUNCTION ${safeSchemaName}.fail_marketplace_royalty();
  `);
  const failing = invoiceEvent();
  const failingSigned = signedBody(failing);
  assert.equal((await post(failingSigned.body, failingSigned.signature)).status, 500);
  assert.equal((await royaltyRows(failing.id)).length, 0);
  const [failed] = await db.select().from(marketplaceStripeEvents)
    .where(eq(marketplaceStripeEvents.stripeEventId, failing.id));
  assert.equal(failed.processingStatus, "failed");

  await admin.query(`DROP TRIGGER fail_marketplace_royalty ON ${safeSchemaName}.royalty_distributions`);
  assert.equal((await post(failingSigned.body, failingSigned.signature)).status, 200);
  assert.equal((await royaltyRows(failing.id)).length, 1);
  assert.equal((await post(failingSigned.body, failingSigned.signature)).body.duplicate, true);
  assert.equal((await royaltyRows(failing.id)).length, 1);
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${safeSchemaName} CASCADE`);
  await admin.end();
  process.env.DATABASE_URL = originalDatabaseUrl;
});