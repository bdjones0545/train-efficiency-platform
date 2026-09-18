/**
 * POST /api/stripe/marketplace-webhook — four defects, all executed here.
 *
 *  1. `const stripe = getUncachableStripeClient()` was not awaited, so
 *     `stripe.webhooks` was undefined and every signed event threw → 400.
 *  2. The route is registered after express.json(), so req.body is the parsed
 *     object; signature verification needs the exact signed bytes, which
 *     server/index.ts captures into req.rawBody.
 *  3. With STRIPE_MARKETPLACE_WEBHOOK_SECRET unset the handler accepted
 *     `event = req.body` unsigned. It now fails CLOSED with 503.
 *  4. `stripeEventId` / `currency` / `metadata` named columns that did not
 *     exist in shared/schema.ts, so Drizzle silently dropped them: revenue was
 *     recorded with no Stripe event id and therefore no idempotency.
 *
 * The database is stubbed (db.insert is replaced), so nothing is written; the
 * stub emulates the partial unique index on stripe_event_id.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestHandler } from "express";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.STRIPE_SECRET_KEY ??= "sk_test_marketplace_webhook_unit";
process.env.STRIPE_PUBLISHABLE_KEY ??= "pk_test_marketplace_webhook_unit";

const WEBHOOK_SECRET = "whsec_marketplace_webhook_unit_test_secret";

const { db } = await import("../db");
const schema = await import("@shared/schema");
const StripeCtor = (await import("stripe")).default;
const signer = new StripeCtor(process.env.STRIPE_SECRET_KEY as string);

type InsertedRow = { table: unknown; row: Record<string, any> };

/** Stub for db.insert(...).values(...)[.onConflictDoNothing()][.returning()] */
function installDbStub() {
  const inserted: InsertedRow[] = [];
  const uniqueStripeEventIds = new Set<string>();
  const original = (db as any).insert;

  (db as any).insert = (table: unknown) => ({
    values(row: Record<string, any>) {
      let conflictGuarded = false;
      const commit = (): InsertedRow[] => {
        if (conflictGuarded && row.stripeEventId != null && uniqueStripeEventIds.has(row.stripeEventId)) {
          return []; // ON CONFLICT (stripe_event_id) DO NOTHING
        }
        if (row.stripeEventId != null) uniqueStripeEventIds.add(row.stripeEventId);
        const record = { table, row };
        inserted.push(record);
        return [record];
      };
      const api: any = {
        onConflictDoNothing(config: any) {
          assert.ok(config?.target, "onConflictDoNothing must name the conflict target");
          conflictGuarded = true;
          return api;
        },
        returning() {
          return Promise.resolve(commit().map((_r, i) => ({ id: `row-${i}` })));
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(commit()).then(resolve, reject);
        },
      };
      return api;
    },
  });

  return {
    inserted,
    rowsFor(table: unknown) {
      return inserted.filter((r) => r.table === table).map((r) => r.row);
    },
    restore() {
      (db as any).insert = original;
    },
  };
}

let handler: RequestHandler | null = null;

async function webhookHandler(): Promise<RequestHandler> {
  if (handler) return handler;
  const routes: Array<{ method: string; path: string; handlers: RequestHandler[] }> = [];
  const record = (method: string) =>
    (path: string, ...handlers: RequestHandler[]) => routes.push({ method, path, handlers });
  const app = {
    get: record("get"), post: record("post"), patch: record("patch"),
    put: record("put"), delete: record("delete"), use: () => {},
  };
  const { registerPhase10Routes } = await import("../phase10-routes");
  await registerPhase10Routes(app as any);
  const match = routes.filter((r) => r.method === "post" && r.path === "/api/stripe/marketplace-webhook");
  assert.equal(match.length, 1, "marketplace webhook is registered exactly once");
  assert.equal(match[0].handlers.length, 1, "marketplace webhook has a single handler");
  handler = match[0].handlers[0];
  return handler;
}

function responseRecorder() {
  return {
    statusCode: 200,
    payload: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.payload = payload; return this; },
  };
}

function checkoutEvent(eventId: string) {
  return {
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_marketplace_1",
        object: "checkout.session",
        amount_total: 4900,
        currency: "usd",
        customer: "cus_test_1",
        metadata: { agentId: "growth_agent", orgId: "org-a" },
      },
    },
  };
}

async function post(body: unknown, opts: { secret?: string | null; signature?: string | "valid" | null } = {}) {
  const fn = await webhookHandler();
  const payload = Buffer.from(JSON.stringify(body), "utf8");

  const previous = process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET;
  if (opts.secret === null) delete process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET;
  else process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET = opts.secret ?? WEBHOOK_SECRET;

  let signature: string | undefined;
  if (opts.signature === "valid") {
    signature = signer.webhooks.generateTestHeaderString({
      payload: payload.toString("utf8"),
      secret: process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET as string,
    });
  } else if (typeof opts.signature === "string") {
    signature = opts.signature;
  }

  const res = responseRecorder();
  try {
    await fn(
      { headers: signature ? { "stripe-signature": signature } : {}, rawBody: payload, body } as any,
      res as any,
      (() => {}) as any,
    );
  } finally {
    if (previous === undefined) delete process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET;
    else process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET = previous;
  }
  return res;
}

test("no STRIPE_MARKETPLACE_WEBHOOK_SECRET configured — fails closed with 503, never accepts the unsigned body", async () => {
  const stub = installDbStub();
  try {
    const res = await post(checkoutEvent("evt_unsigned_1"), { secret: null, signature: null });
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload?.code, "WEBHOOK_SECRET_NOT_CONFIGURED");
    assert.equal(stub.inserted.length, 0, "an unsigned event must not be persisted");
  } finally {
    stub.restore();
  }
});

test("a missing signature header is rejected with 400", async () => {
  const stub = installDbStub();
  try {
    const res = await post(checkoutEvent("evt_nosig_1"), { signature: null });
    assert.equal(res.statusCode, 400);
    assert.equal(stub.inserted.length, 0);
  } finally {
    stub.restore();
  }
});

test("a bad signature over the raw body is rejected with 400", async () => {
  const stub = installDbStub();
  try {
    const res = await post(checkoutEvent("evt_badsig_1"), { signature: "t=1,v1=deadbeef" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload?.message, "Webhook signature invalid");
    assert.equal(stub.inserted.length, 0);
  } finally {
    stub.restore();
  }
});

test("a signature valid for a DIFFERENT secret is rejected with 400", async () => {
  const stub = installDbStub();
  try {
    const payload = JSON.stringify(checkoutEvent("evt_wrongsecret_1"));
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret: "whsec_some_other_secret" });
    const res = await post(checkoutEvent("evt_wrongsecret_1"), { signature });
    assert.equal(res.statusCode, 400);
    assert.equal(stub.inserted.length, 0);
  } finally {
    stub.restore();
  }
});

test("a correctly signed event is accepted and the revenue row persists its stripe_event_id", async () => {
  const stub = installDbStub();
  try {
    const res = await post(checkoutEvent("evt_signed_1"), { signature: "valid" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.received, true);
    assert.equal(res.payload?.type, "checkout.session.completed");

    const rows = stub.rowsFor(schema.agentRevenueEvents);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stripeEventId, "evt_signed_1");
    assert.equal(rows[0].currency, "usd");
    assert.equal(rows[0].agentId, "growth_agent");
    assert.equal(rows[0].orgId, "org-a");
    assert.equal(rows[0].amount, 49);
    assert.deepEqual(rows[0].metadata, {
      sessionId: "cs_test_marketplace_1",
      customerId: "cus_test_1",
      stripeEventType: "checkout.session.completed",
    });
  } finally {
    stub.restore();
  }
});

test("the same signed event delivered twice produces exactly one revenue row", async () => {
  const stub = installDbStub();
  try {
    const first = await post(checkoutEvent("evt_replayed_1"), { signature: "valid" });
    const second = await post(checkoutEvent("evt_replayed_1"), { signature: "valid" });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(stub.rowsFor(schema.agentRevenueEvents).length, 1);
  } finally {
    stub.restore();
  }
});

test("invoice.paid records the royalty rate and amount that used to be dropped", async () => {
  const stub = installDbStub();
  try {
    const event = {
      id: "evt_invoice_1",
      object: "event",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_test_1",
          object: "invoice",
          amount_paid: 10000,
          metadata: { agentId: "growth_agent", orgId: "org-a", developerId: "dev-1" },
        },
      },
    };
    const res = await post(event, { signature: "valid" });
    assert.equal(res.statusCode, 200);

    const rows = stub.rowsFor(schema.royaltyDistributions);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].developerId, "dev-1");
    assert.equal(rows[0].grossRevenue, 100);
    assert.equal(rows[0].royaltyRate, 0.3);
    assert.equal(rows[0].royaltyAmountCents, 3000);
    assert.equal(rows[0].status, "pending");
  } finally {
    stub.restore();
  }
});

test("the schema declares every column the webhook writes", () => {
  const revenue = Object.keys(schema.agentRevenueEvents);
  for (const column of ["stripeEventId", "currency", "metadata"]) {
    assert.ok(revenue.includes(column), `agent_revenue_events.${column}`);
  }
  const royalty = Object.keys(schema.royaltyDistributions);
  for (const column of ["royaltyRate", "royaltyAmountCents", "status"]) {
    assert.ok(royalty.includes(column), `royalty_distributions.${column}`);
  }
});
