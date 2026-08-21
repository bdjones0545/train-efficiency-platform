import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { registerAgentMailRoutes } from "../agentmail-routes";
import { buildTestSvixSignature, verifyAgentMailWebhook } from "../services/agentmail-svix";
import { runAgentMailMigration } from "../services/agentmail-migration";
import { processInboundAgentMail } from "../services/agentmail-inbound-router";

const secret = "whsec_" + Buffer.from("agentmail-p0-surgical-secret").toString("base64");
const webhookSecretBefore = process.env.AGENTMAIL_WEBHOOK_SECRET;
process.env.AGENTMAIL_WEBHOOK_SECRET = secret;

let webhookHandler: (req: any, res: any) => Promise<any>;

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
  };
}

function signedRequest(body: Record<string, unknown>, svixId: string) {
  const raw = Buffer.from(JSON.stringify(body));
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    rawBody: raw,
    body,
    headers: {
      "svix-id": svixId,
      "svix-timestamp": String(timestamp),
      "svix-signature": buildTestSvixSignature(secret, svixId, timestamp, raw.toString("utf8")),
    },
  };
}

before(async () => {
  await runAgentMailMigration();
  const routes = new Map<string, Function[]>();
  const app = {
    get(path: string, ...handlers: Function[]) { routes.set(`GET ${path}`, handlers); },
    post(path: string, ...handlers: Function[]) { routes.set(`POST ${path}`, handlers); },
  } as any;
  const pass = () => (_req: any, _res: any, next: any) => next();
  await registerAgentMailRoutes(app, pass(), (..._roles: string[]) => pass());
  const handlers = routes.get("POST /api/agentmail/webhook");
  assert.ok(handlers?.length, "real AgentMail webhook route must be registered");
  webhookHandler = handlers![handlers!.length - 1] as any;
});

after(() => {
  if (webhookSecretBefore === undefined) delete process.env.AGENTMAIL_WEBHOOK_SECRET;
  else process.env.AGENTMAIL_WEBHOOK_SECRET = webhookSecretBefore;
});

test("Svix rejects noncanonical timestamps and unsupported signature versions", () => {
  const body = Buffer.from('{"event_type":"ping"}');
  const now = Math.floor(Date.now() / 1000);
  for (const timestamp of [`${now}junk`, `junk${now}`, `${now}.5`, "", "   "]) {
    const result = verifyAgentMailWebhook(body, {
      "svix-id": "msg-malformed",
      "svix-timestamp": timestamp,
      "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });
    assert.equal(result.ok, false, `timestamp '${timestamp}' must be rejected`);
  }
  const valid = buildTestSvixSignature(secret, "msg-version", now, body.toString());
  assert.equal(verifyAgentMailWebhook(body, {
    "svix-id": "msg-version",
    "svix-timestamp": String(now),
    "svix-signature": valid.replace(/^v1,/, "v2,"),
  }).ok, false);
});

test("real signed webhook durably deduplicates a completed Svix delivery", async () => {
  const svixId = `svix-replay-${randomUUID()}`;
  const messageId = `message-replay-${randomUUID()}`;
  const req = signedRequest({
    event_type: "message.received",
    event_id: `event-${randomUUID()}`,
    message: {
      inbox_id: `unknown-${randomUUID()}`,
      message_id: messageId,
      to: ["unknown@agentmail.to"],
      from: "sender@example.test",
      subject: "replay test",
      text: "sensitive-replay-body",
    },
  }, svixId);
  const first = responseRecorder();
  await webhookHandler(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.reason, "no_ownership_record");

  const replay = responseRecorder();
  await webhookHandler(req, replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.duplicate, true);

  const count = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM agent_mail_inbound_messages
    WHERE provider_message_id = ${messageId} AND routing_status = 'quarantine'
  `) as any;
  const rows = Array.isArray(count) ? count : count.rows;
  assert.equal(Number(rows[0].count), 1);
});

test("real signed webhook returns 503 when quarantine persistence fails without logging body", async () => {
  const marker = `secret-body-${randomUUID()}`;
  const req = signedRequest({
    event_type: "message.received",
    event_id: `event-${randomUUID()}`,
    message: {
      message_id: `message-${randomUUID()}`,
      to: ["unknown@agentmail.to"],
      from: "sender@example.test",
      subject: "forced quarantine failure",
      text: marker,
    },
  }, `svix-qfail-${randomUUID()}`);

  const logs: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: any[]) => logs.push(args.map(String).join(" "));
  console.warn = (...args: any[]) => logs.push(args.map(String).join(" "));
  await db.execute(sql`ALTER TABLE agent_mail_inbound_messages RENAME TO agent_mail_inbound_messages_qfail`);
  try {
    const res = responseRecorder();
    await webhookHandler(req, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /retry/i);
    assert.equal(logs.some((line) => line.includes(marker)), false, "message body must not be logged");
  } finally {
    await db.execute(sql`ALTER TABLE agent_mail_inbound_messages_qfail RENAME TO agent_mail_inbound_messages`);
    console.error = originalError;
    console.warn = originalWarn;
  }
});

test("failed attention effect rolls back completion and succeeds exactly once on retry", async () => {
  const providerMessageId = `effect-retry-${randomUUID()}`;
  const payload = {
    organizationId: `effect-org-${randomUUID()}`,
    inbox: "support",
    fromEmail: "effect@example.test",
    toEmail: "support@example.test",
    subject: "General support question",
    bodyText: "Please help with my account question",
    providerMessageId,
  };

  await db.execute(sql`ALTER TABLE attention_items RENAME TO attention_items_effect_failure`);
  let first: any;
  try {
    first = await processInboundAgentMail(payload);
    assert.equal(first.ok, false);
    const effect = await db.execute(sql`
      SELECT 1 FROM agentmail_effect_log WHERE inbound_id = ${first.inboundId} AND effect_type = 'attention_item'
    `) as any;
    assert.equal((Array.isArray(effect) ? effect : effect.rows).length, 0, "failed write must not be completed");
  } finally {
    await db.execute(sql`ALTER TABLE attention_items_effect_failure RENAME TO attention_items`);
  }

  const retry = await processInboundAgentMail(payload);
  assert.equal(retry.ok, true);
  const duplicate = await processInboundAgentMail(payload);
  assert.equal(duplicate.skipped, true);
  assert.equal(duplicate.skipReason, "already_completed");

  const rowsResult = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM attention_items WHERE source_id = ${first.inboundId}
  `) as any;
  const rows = Array.isArray(rowsResult) ? rowsResult : rowsResult.rows;
  assert.equal(Number(rows[0].count), 1);
});
