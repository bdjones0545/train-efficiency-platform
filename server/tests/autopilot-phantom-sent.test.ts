/**
 * The level-3 auto-pilot ("Full Operator") used to record messages as sent that
 * no provider ever saw: executeAutoActions and runCampaignEngine both wrote
 * agent_actions rows with status='sent' and auto_sent=true without calling
 * sendSms/sendEmail, and no downstream job delivers such rows. The human send
 * path only accepts status='pending', so a phantom row could never be sent by a
 * coach either — it just sat in the dashboard as a message the client "got".
 *
 * These tests execute both engines against a stubbed database and assert that
 * every row they write is an honest draft, that a campaign step is not consumed
 * by a draft, and that the follow-up selector only considers messages carrying
 * the delivery marker (agent_actions.sent_at).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { agentActions, campaigns } from "@shared/schema";

import {
  AUTOMATION_QUEUED_REASON,
  executeAutoActions,
  runCampaignEngine,
} from "../action-tracking";

type Write = { kind: "insert" | "update"; table: unknown; values: Record<string, any> };
type SelectCall = { table: unknown; where: unknown };

const dialect = new PgDialect();
const sqlTextOf = (condition: unknown): string =>
  dialect.sqlToQuery(condition as any).sql.toLowerCase();

/**
 * A stand-in for the drizzle handle. Select results are served in call order;
 * every insert and update is recorded so a test can assert on what the engine
 * tried to persist. Nothing here touches a database.
 */
function makeDbStub(selectResults: any[][]) {
  const selects: SelectCall[] = [];
  const writes: Write[] = [];
  let selectIndex = 0;

  const db = {
    select() {
      const result = selectResults[selectIndex++] ?? [];
      const chain: any = {
        _table: undefined as unknown,
        from(table: unknown) { chain._table = table; return chain; },
        where(condition: unknown) { selects.push({ table: chain._table, where: condition }); return chain; },
        orderBy() { return chain; },
        limit() { return chain; },
        then(resolve: any, reject: any) { return Promise.resolve(result).then(resolve, reject); },
      };
      return chain;
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, any>) {
          writes.push({ kind: "insert", table, values });
          const rows = [{ id: `inserted-${writes.length}` }];
          return {
            returning: () => Promise.resolve(rows),
            then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, any>) {
          writes.push({ kind: "update", table, values });
          return { where: () => Promise.resolve(undefined) };
        },
      };
    },
  };

  return { db: db as any, selects, writes, selectCount: () => selectIndex };
}

const storageStub = (automationLevel: number) =>
  ({ getOrganizationById: async () => ({ id: "org-1", automationLevel }) }) as any;

const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000);

const agentActionWrites = (writes: Write[]) =>
  writes.filter((w) => w.table === agentActions);

// ── executeAutoActions ───────────────────────────────────────────────────────

test("level-3 auto follow-up is queued for review, never recorded as sent", async () => {
  const stub = makeDbStub([
    // eligible follow-ups: one delivered message with no response
    [{
      id: "delivered-1",
      clientId: "client-1",
      clientName: "Jane Doe",
      coachId: "coach-1",
      createdAt: hoursAgo(30),
      sentAt: hoursAgo(30),
      followUpCount: 0,
    }],
    [], // throttle: nothing sent in the last 24h
    [], // throttle: nothing in the last 7 days
  ]);

  const result = await executeAutoActions("org-1", { db: stub.db, storage: storageStub(3) });

  const inserted = agentActionWrites(stub.writes).filter((w) => w.kind === "insert");
  assert.equal(inserted.length, 1, "expected exactly one drafted follow-up");

  const row = inserted[0].values;
  assert.equal(row.status, "pending", "an undelivered message must land in the human send queue");
  assert.equal(row.autoSent, false, "nothing was auto-sent: no provider was called");
  assert.match(String(row.autoReason), new RegExp(AUTOMATION_QUEUED_REASON));

  assert.equal(result.queued.length, 1);
  assert.equal((result as any).sent, undefined, "the result must not claim anything was sent");

  // No write anywhere in this engine may assert delivery.
  for (const write of stub.writes) {
    assert.notEqual(write.values.status, "sent", "the auto-pilot delivers nothing, so it may not write 'sent'");
    assert.notEqual(write.values.autoSent, true);
    assert.equal(write.values.sentAt, undefined, "only a real provider send may stamp sentAt");
  }
});

test("follow-up eligibility requires the delivery marker, not just status='sent'", async () => {
  const stub = makeDbStub([[]]);

  await executeAutoActions("org-1", { db: stub.db, storage: storageStub(3) });

  assert.equal(stub.selects.length, 1, "expected the eligibility query to have run");
  const where = sqlTextOf(stub.selects[0].where);
  assert.match(where, /"sent_at"\s+is not null/, "a row with no delivery marker was never sent and cannot be followed up on");
  assert.doesNotMatch(
    where,
    /"created_at"\s*</,
    "the 24h window must be measured from delivery, not from when the draft was created",
  );
});

test("automation below level 3 queues nothing", async () => {
  const stub = makeDbStub([]);
  const result = await executeAutoActions("org-1", { db: stub.db, storage: storageStub(2) });
  assert.deepEqual(result, { queued: [], skipped: 0, skipReasons: [] });
  assert.equal(stub.writes.length, 0);
});

// ── runCampaignEngine ────────────────────────────────────────────────────────

const dueCampaign = {
  id: "campaign-1",
  organizationId: "org-1",
  clientId: "client-1",
  clientName: "Jane Doe",
  coachId: "coach-1",
  campaignType: "backfill_sequence",
  status: "active",
  currentStep: 1,
  totalSteps: 2,
  nextActionAt: hoursAgo(1),
  startedAt: hoursAgo(48),
};

function campaignSelects(overrides: { delivered?: any[]; queuedDraft?: any[] } = {}) {
  return [
    [dueCampaign],                    // due campaigns
    overrides.delivered ?? [],        // latest delivered step for this campaign
    [],                               // throttle: last 24h
    [],                               // throttle: last 7 days
    [],                               // throttle: campaign attempts
    [],                               // recent booked/responded
    overrides.queuedDraft ?? [],      // draft already waiting in the queue
  ];
}

test("level-3 campaign step is drafted, not sent, and does not consume the step", async () => {
  const stub = makeDbStub(campaignSelects());

  const result = await runCampaignEngine("org-1", { db: stub.db, storage: storageStub(3) });

  const inserted = agentActionWrites(stub.writes).filter((w) => w.kind === "insert");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].values.status, "pending");
  assert.equal(inserted[0].values.autoSent, false);
  assert.equal(inserted[0].values.campaignStep, 2);
  assert.match(String(inserted[0].values.autoReason), new RegExp(AUTOMATION_QUEUED_REASON));

  const campaignUpdates = stub.writes.filter((w) => w.table === campaigns);
  assert.equal(campaignUpdates.length, 1);
  assert.equal(
    "currentStep" in campaignUpdates[0].values,
    false,
    "a draft nobody sent must not advance the campaign — the sequence would be consumed with no message",
  );
  assert.ok(campaignUpdates[0].values.nextActionAt instanceof Date, "the campaign timer is still re-armed");
  assert.notEqual(campaignUpdates[0].values.status, "completed");

  assert.equal(result.executed, 0, "nothing is executed while automated delivery is not implemented");
  assert.equal(result.drafted, 1);
});

test("a campaign step is consumed only by a delivered message", async () => {
  const stub = makeDbStub(campaignSelects({ delivered: [{ step: 2 }] }));

  // currentStep is still 1 in the row, but step 2 was really delivered, so the
  // engine works on step 3 — which is past the end of this 2-step template.
  const result = await runCampaignEngine("org-1", { db: stub.db, storage: storageStub(3) });

  assert.equal(agentActionWrites(stub.writes).length, 0, "no further step exists to draft");
  assert.equal(result.completed, 1);
});

test("a draft already waiting for the coach is not re-drafted every run", async () => {
  const stub = makeDbStub(campaignSelects({ queuedDraft: [{ id: "pending-1" }] }));

  const result = await runCampaignEngine("org-1", { db: stub.db, storage: storageStub(3) });

  assert.equal(agentActionWrites(stub.writes).length, 0, "the queue must not fill with duplicates of an unsent step");
  assert.equal(result.drafted, 0);
  const campaignUpdates = stub.writes.filter((w) => w.table === campaigns);
  assert.equal(campaignUpdates.length, 1);
  assert.ok(campaignUpdates[0].values.nextActionAt instanceof Date);
});
