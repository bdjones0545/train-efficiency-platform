/**
 * Primary Stripe webhook retry-state regression.
 *
 * This isolates the durable stripe_webhook_events state machine in a fresh
 * PostgreSQL schema. It models the point immediately after signature
 * verification: the provider event has been claimed, its financial work fails,
 * and Stripe redelivers the exact same event ID.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { Client } from "pg";
import { after, test } from "node:test";

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) throw new Error("DATABASE_URL is required for primary webhook retry tests");

const schemaName = `stripe_primary_retry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const quotedSchema = `"${schemaName}"`;
const admin = new Client({ connectionString: baseDatabaseUrl });
await admin.connect();
await admin.query(`CREATE SCHEMA ${quotedSchema}`);
await admin.query(`CREATE TABLE ${quotedSchema}.stripe_webhook_events (LIKE public.stripe_webhook_events INCLUDING ALL)`);

const isolatedUrl = new URL(baseDatabaseUrl);
isolatedUrl.searchParams.set("options", `-c search_path=${schemaName},public`);
process.env.DATABASE_URL = isolatedUrl.toString();

const { db, pool } = await import("../db");
const { stripeWebhookEvents } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const {
  checkAndInsertWebhookEvent,
  markWebhookEventDone,
} = await import("../webhookHandlers");

test("failed primary webhook event is reclaimed once; completed retry remains deduplicated", async () => {
  const eventId = `evt_primary_retry_${Date.now()}`;
  const claim = await checkAndInsertWebhookEvent({
    stripeEventId: eventId,
    eventType: "checkout.session.completed",
    livemode: false,
    customerId: "cus_primary_retry",
    amountCents: 5000,
  });
  assert.equal(claim.alreadyProcessed, false);

  // Simulates a real post-claim financial failure path in WebhookHandlers.
  await markWebhookEventDone(claim.rowId, "failed", "forced financial write failure");
  const [failed] = await db.select().from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.stripeEventId, eventId));
  assert.equal(failed.processedStatus, "failed");

  const retry = await checkAndInsertWebhookEvent({
    stripeEventId: eventId,
    eventType: "checkout.session.completed",
    livemode: false,
    customerId: "cus_primary_retry",
    amountCents: 5000,
  });
  assert.equal(retry.alreadyProcessed, false, "a failed provider event must be reclaimed for retry");
  assert.equal(retry.rowId, claim.rowId);

  await markWebhookEventDone(retry.rowId, "succeeded");
  const completedRetry = await checkAndInsertWebhookEvent({
    stripeEventId: eventId,
    eventType: "checkout.session.completed",
    livemode: false,
  });
  assert.equal(completedRetry.alreadyProcessed, true, "completed event must remain deduplicated");
});

after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await admin.end();
  process.env.DATABASE_URL = baseDatabaseUrl;
});