import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { registerAgentMailRoutes } from "../agentmail-routes";
import { requireRole as sharedRequireRole } from "../lib/require-role";
import { processInboundAgentMail, type InboundEmailPayload } from "../services/agentmail-inbound-router";
import { runAgentMailMigration } from "../services/agentmail-migration";
import { buildTestSvixSignature } from "../services/agentmail-svix";
import {
  activateOrgInboxes,
  buildOrgEmailAddress,
  buildOrgUsername,
  getAgentMailDomain,
  provisionOrgInboxes,
  type AgentMailRole,
} from "../services/agentmail-ownership-service";

const secret = "whsec_" + Buffer.from("agentmail-p0-closure-secret").toString("base64");
const previousSecret = process.env.AGENTMAIL_WEBHOOK_SECRET;
process.env.AGENTMAIL_WEBHOOK_SECRET = secret;

function rows(result: any): any[] { return Array.isArray(result) ? result : result?.rows ?? []; }
function response() {
  return { statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
}
function signed(body: any, id: string) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = Math.floor(Date.now() / 1000);
  return { rawBody, body, headers: {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": buildTestSvixSignature(secret, id, timestamp, rawBody.toString()),
  }};
}
async function seedOrg(orgId: string) {
  await db.execute(sql`INSERT INTO organizations (id, name, slug)
    VALUES (${orgId}, ${`AgentMail closure ${orgId}`}, ${`agentmail-${orgId}`}) ON CONFLICT (id) DO NOTHING`);
}
async function seedOwnership(orgId: string, role: AgentMailRole, state = "provisioning", providerId: string | null = `inbox-${randomUUID()}`) {
  const username = buildOrgUsername(role, orgId);
  const email = buildOrgEmailAddress(username, getAgentMailDomain());
  await db.execute(sql`INSERT INTO org_agentmail_inboxes
    (id, organization_id, role, username, email_address, provider_inbox_id, provider_domain, ownership_state, created_at, updated_at)
    VALUES (gen_random_uuid()::text, ${orgId}, ${role}, ${username}, ${email}, ${providerId}, ${getAgentMailDomain()}, ${state}, NOW(), NOW())
    ON CONFLICT (organization_id, role) DO UPDATE SET provider_inbox_id=EXCLUDED.provider_inbox_id, ownership_state=EXCLUDED.ownership_state, updated_at=NOW()`);
  return { email, providerId };
}

before(async () => {
  await runAgentMailMigration();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS agent_mail_reply_queue (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, organization_id TEXT NOT NULL,
    inbound_message_id TEXT NOT NULL, inbox TEXT NOT NULL, agent_name TEXT NOT NULL,
    classification TEXT NOT NULL, recipient_email TEXT NOT NULL, recipient_name TEXT,
    subject TEXT NOT NULL, draft_body TEXT NOT NULL, status TEXT NOT NULL,
    approval_status TEXT NOT NULL, confidence DOUBLE PRECISION, thread_id TEXT,
    provider_inbound_message_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_queue_inbound_unique ON agent_mail_reply_queue (organization_id, inbound_message_id)`);
});
after(() => {
  if (previousSecret === undefined) delete process.env.AGENTMAIL_WEBHOOK_SECRET;
  else process.env.AGENTMAIL_WEBHOOK_SECRET = previousSecret;
});

test("simultaneous signed webhook duplicates process once and conflicting payload fails closed", async () => {
  const orgId = randomUUID(); await seedOrg(orgId);
  const ownership = await seedOwnership(orgId, "support", "active");
  const routeMap = new Map<string, Function[]>();
  const app = { get(p: string, ...h: Function[]) { routeMap.set(`GET ${p}`, h); }, post(p: string, ...h: Function[]) { routeMap.set(`POST ${p}`, h); } } as any;
  const pass = (_req: any, _res: any, next: any) => next();
  await registerAgentMailRoutes(app, pass, () => pass);
  const handler = routeMap.get("POST /api/agentmail/webhook")!.at(-1) as any;
  const deliveryId = `delivery-${randomUUID()}`;
  const messageId = `message-${randomUUID()}`;
  const body = { event_type: "message.received", event_id: randomUUID(), organization_id: randomUUID(), message: {
    inbox_id: ownership.providerId, message_id: messageId, to: [ownership.email], from: "closure@example.test",
    subject: "support question", text: "Please help with this question",
  }};
  const req = signed(body, deliveryId); const a = response(); const b = response();
  await Promise.all([handler(req, a), handler(req, b)]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
  const inbound = rows(await db.execute(sql`SELECT id FROM agent_mail_inbound_messages WHERE provider_message_id=${messageId}`));
  assert.equal(inbound.length, 1);
  assert.equal(Number(rows(await db.execute(sql`SELECT COUNT(*)::int n FROM agentmail_effect_log WHERE inbound_id=${inbound[0].id}`))[0].n), 2);
  assert.equal(Number(rows(await db.execute(sql`SELECT COUNT(*)::int n FROM attention_items WHERE source_id=${inbound[0].id}`))[0].n), 1);
  assert.equal(Number(rows(await db.execute(sql`SELECT COUNT(*)::int n FROM agent_operating_timeline WHERE related_entity_id=${inbound[0].id}`))[0].n), 1);
  assert.equal(rows(await db.execute(sql`SELECT status FROM agentmail_webhook_deliveries WHERE svix_id=${deliveryId}`))[0].status, "completed");
  const conflict = response();
  await handler(signed({ ...body, message: { ...body.message, subject: "different payload" } }, deliveryId), conflict);
  assert.equal(conflict.statusCode, 401);
});

const effects = {
  prospect: { inbox: "revenue", subject: "Pricing information", body: "Please send pricing", table: "team_training_prospects" },
  applicant: { inbox: "hiring", subject: "Job application", body: "My resume and application", table: "employment_applicants" },
  software_task: { inbox: "support", subject: "Software bug", body: "The software is broken with an error", table: "software_improvement_tasks" },
  attention_item: { inbox: "scheduling", subject: "Schedule session", body: "Please book a session", table: "attention_items" },
  reply_queue: { inbox: "scheduling", subject: "Schedule with reply", body: "Please book an appointment", table: "agent_mail_reply_queue", suggested: true },
  ceo_timeline: { inbox: "operations", subject: "Operations update", body: "Operational question", table: "agent_operating_timeline" },
} as const;

function effectPayload(orgId: string, effect: keyof typeof effects, marker: string): InboundEmailPayload {
  const c = effects[effect];
  return { organizationId: orgId, inbox: c.inbox, fromEmail: `${marker}@example.test`, toEmail: `${c.inbox}@example.test`,
    subject: `${c.subject} ${marker}`, bodyText: c.body, providerMessageId: `provider-${marker}`, providerThreadId: `thread-${marker}` };
}
const suggested = async (base: any) => ({ ...base, suggestedReply: "Deterministic provider-mocked reply" });
async function businessCount(effect: keyof typeof effects, inboundId: string, marker: string, orgId?: string) {
  const orgClause = orgId ? sql` AND ${sql.raw(effect === "software_task" || effect === "reply_queue" ? "organization_id" : "org_id")} = ${orgId}` : sql``;
  let query;
  if (effect === "prospect") query = sql`SELECT COUNT(*)::int n FROM team_training_prospects WHERE contact_email=${`${marker}@example.test`}${orgClause}`;
  else if (effect === "applicant") query = sql`SELECT COUNT(*)::int n FROM employment_applicants WHERE email=${`${marker}@example.test`}${orgClause}`;
  else if (effect === "software_task") query = sql`SELECT COUNT(*)::int n FROM software_improvement_tasks WHERE title LIKE ${`%${marker}%`}${orgClause}`;
  else if (effect === "attention_item") query = sql`SELECT COUNT(*)::int n FROM attention_items WHERE source_id=${inboundId}${orgClause}`;
  else if (effect === "reply_queue") query = sql`SELECT COUNT(*)::int n FROM agent_mail_reply_queue WHERE inbound_message_id=${inboundId}${orgClause}`;
  else query = sql`SELECT COUNT(*)::int n FROM agent_operating_timeline WHERE related_entity_id=${inboundId}${orgClause}`;
  return Number(rows(await db.execute(query))[0].n);
}

test("all six effects rollback forced business failures, recover, and deduplicate concurrent retries", async () => {
  for (const effect of Object.keys(effects) as Array<keyof typeof effects>) {
    const orgId = randomUUID(); await seedOrg(orgId); const marker = `${effect}-${randomUUID()}`;
    const payload = effectPayload(orgId, effect, marker); const enhancer = effects[effect].suggested ? suggested : undefined;
    const table = effects[effect].table; const failedTable = `${table}_forced_failure`;
    await db.execute(sql.raw(`ALTER TABLE ${table} RENAME TO ${failedTable}`));
    let failed: any;
    try {
      failed = await processInboundAgentMail(payload, enhancer);
      assert.equal(failed.ok, false, `${effect}: forced business failure must propagate`);
      assert.equal(Number(rows(await db.execute(sql`SELECT COUNT(*)::int n FROM agentmail_effect_log WHERE inbound_id=${failed.inboundId} AND effect_type=${effect}`))[0].n), 0, `${effect}: failed effect ledger must roll back`);
    } finally {
      await db.execute(sql.raw(`ALTER TABLE ${failedTable} RENAME TO ${table}`));
    }
    const retry = await processInboundAgentMail(payload, enhancer);
    assert.equal(retry.ok, true, `${effect}: retry must succeed`);
    assert.equal(await businessCount(effect, retry.inboundId!, marker), 1, `${effect}: exactly one business row`);
    assert.equal(Number(rows(await db.execute(sql`SELECT COUNT(*)::int n FROM agentmail_effect_log WHERE inbound_id=${retry.inboundId} AND effect_type=${effect}`))[0].n), 1);
    const [dupA, dupB] = await Promise.all([processInboundAgentMail(payload, enhancer), processInboundAgentMail(payload, enhancer)]);
    assert.equal(dupA.skipped && dupB.skipped, true, `${effect}: concurrent completed retries must skip`);
    assert.equal(await businessCount(effect, retry.inboundId!, marker), 1, `${effect}: concurrent retry must not duplicate`);
  }
});

test("all six effects remain isolated across two tenants", async () => {
  const orgA = randomUUID(), orgB = randomUUID(); await seedOrg(orgA); await seedOrg(orgB);
  for (const effect of Object.keys(effects) as Array<keyof typeof effects>) {
    const markerA = `orga-${effect}-${randomUUID()}`, markerB = `orgb-${effect}-${randomUUID()}`;
    const enhancer = effects[effect].suggested ? suggested : undefined;
    const [a, b] = await Promise.all([
      processInboundAgentMail(effectPayload(orgA, effect, markerA), enhancer),
      processInboundAgentMail(effectPayload(orgB, effect, markerB), enhancer),
    ]);
    assert.equal(a.ok && b.ok, true, effect);
    assert.equal(await businessCount(effect, a.inboundId!, markerA, orgA), 1, `${effect}: Org A row`);
    assert.equal(await businessCount(effect, b.inboundId!, markerB, orgB), 1, `${effect}: Org B row`);
    assert.equal(await businessCount(effect, a.inboundId!, markerA, orgB), 0, `${effect}: Org A cannot write Org B`);
    assert.equal(await businessCount(effect, b.inboundId!, markerB, orgA), 0, `${effect}: Org B cannot write Org A`);
    const ledgers = rows(await db.execute(sql`SELECT m.organization_id, e.effect_type FROM agentmail_effect_log e
      JOIN agent_mail_inbound_messages m ON m.id=e.inbound_id WHERE e.inbound_id IN (${a.inboundId}, ${b.inboundId}) AND e.effect_type=${effect}`));
    assert.deepEqual(new Set(ledgers.map((r: any) => r.organization_id)), new Set([orgA, orgB]));
  }
});

test("provisioning concurrency and recovery converge using deterministic provider identity", async () => {
  const orgId = randomUUID(); await seedOrg(orgId);
  const resources = new Map<string, any>(); let calls = 0; let transient = true;
  const provider = { createOrVerifyInbox: async (username: string, clientId: string) => {
    calls++;
    if (transient) { transient = false; return { ok: false, error: "transient" }; }
    let inbox = resources.get(clientId);
    if (!inbox) { inbox = { inbox_id: `provider-${randomUUID()}`, username, domain: getAgentMailDomain() }; resources.set(clientId, inbox); }
    return { ok: true, inbox };
  }};
  const failed = await provisionOrgInboxes(orgId, ["revenue"], provider);
  assert.equal(failed.allProvisioned, false);
  assert.equal(rows(await db.execute(sql`SELECT * FROM org_agentmail_inboxes WHERE organization_id=${orgId}`)).length, 0);
  const [one, two] = await Promise.all([provisionOrgInboxes(orgId, ["revenue"], provider), provisionOrgInboxes(orgId, ["revenue"], provider)]);
  assert.equal(one.allProvisioned && two.allProvisioned, true);
  const local = rows(await db.execute(sql`SELECT provider_inbox_id FROM org_agentmail_inboxes WHERE organization_id=${orgId} AND role='revenue'`));
  assert.equal(local.length, 1); assert.equal(local[0].provider_inbox_id, resources.get(`te-${orgId}-revenue`).inbox_id);
  assert.equal(resources.size, 1, "deterministic client_id must produce one provider resource");

  const orgFailure = randomUUID(); await seedOrg(orgFailure); let failLocal = true;
  const recoveryProvider = { ...provider, afterProviderProvision: async () => { if (failLocal) { failLocal = false; throw new Error("forced local persistence failure"); } } };
  const localFailure = await provisionOrgInboxes(orgFailure, ["support"], recoveryProvider);
  assert.equal(localFailure.allProvisioned, false);
  assert.equal(rows(await db.execute(sql`SELECT * FROM org_agentmail_inboxes WHERE organization_id=${orgFailure}`)).length, 0);
  const recovered = await provisionOrgInboxes(orgFailure, ["support"], recoveryProvider);
  assert.equal(recovered.allProvisioned, true);
  assert.equal(resources.has(`te-${orgFailure}-support`), true);

  const orgMissing = randomUUID(); await seedOrg(orgMissing); await seedOwnership(orgMissing, "hiring", "provisioning", null);
  const reconciled = await provisionOrgInboxes(orgMissing, ["hiring"], provider);
  assert.equal(reconciled.roles[0].status, "reconciled");
  assert.ok(reconciled.roles[0].providerInboxId);
  const ownerOrg = randomUUID(), conflictOrg = randomUUID(); await seedOrg(ownerOrg); await seedOrg(conflictOrg);
  const conflictId = `provider-conflict-${randomUUID()}`; await seedOwnership(ownerOrg, "ceo", "provisioning", conflictId);
  const conflict = await provisionOrgInboxes(conflictOrg, ["ceo"], { createOrVerifyInbox: async () => ({ ok: true, inbox: { inbox_id: conflictId, domain: getAgentMailDomain() } }) });
  assert.equal(conflict.allProvisioned, false, "provider identity already owned by another tenant must fail closed");
  assert.equal(rows(await db.execute(sql`SELECT * FROM org_agentmail_inboxes WHERE organization_id=${conflictOrg}`)).length, 0);
  assert.ok(calls >= 1);
});

test("activation behavior rejects every incomplete identity gate and accepts exact corroboration", async () => {
  const cases: Array<[string, any]> = [
    ["missing provider resource", { exists: false }],
    ["missing provider email", { exists: true, inboxId: "USE_STORED" }],
    ["mismatched provider email", { exists: true, inboxId: "USE_STORED", email: "wrong@example.test" }],
    ["missing provider inbox ID", { exists: true, email: "USE_LOCAL" }],
    ["mismatched provider inbox ID", { exists: true, inboxId: "wrong", email: "USE_LOCAL" }],
  ];
  for (const [label, verification] of cases) {
    const orgId = randomUUID(); await seedOrg(orgId); const storedId = `stored-${randomUUID()}`; const own = await seedOwnership(orgId, "support", "provisioning", storedId);
    const v = { ...verification,
      inboxId: verification.inboxId === "USE_STORED" ? storedId : verification.inboxId,
      email: verification.email === "USE_LOCAL" ? own.email : verification.email };
    const result = await activateOrgInboxes(orgId, ["support"], { verifyInboxExists: async () => v });
    assert.equal(result.allActivated, false, label);
    assert.equal(rows(await db.execute(sql`SELECT ownership_state FROM org_agentmail_inboxes WHERE organization_id=${orgId}`))[0].ownership_state, "provisioning");
  }
  const missingIdOrg = randomUUID(); await seedOrg(missingIdOrg); await seedOwnership(missingIdOrg, "support", "provisioning", null);
  assert.equal((await activateOrgInboxes(missingIdOrg, ["support"], { verifyInboxExists: async () => { throw new Error("must not call"); } })).allActivated, false);
  const ineligibleOrg = randomUUID(); await seedOrg(ineligibleOrg); await seedOwnership(ineligibleOrg, "support", "disabled", `stored-${randomUUID()}`);
  assert.equal((await activateOrgInboxes(ineligibleOrg, ["support"], { verifyInboxExists: async () => ({ exists: true }) })).roles[0].status, "skipped_not_found");
  const wrongOwner = randomUUID(), wrongCaller = randomUUID(); await seedOrg(wrongOwner); await seedOrg(wrongCaller);
  const wrongId = `stored-${randomUUID()}`; await seedOwnership(wrongOwner, "support", "provisioning", wrongId);
  const wrongOrgResult = await activateOrgInboxes(wrongCaller, ["support"], { verifyInboxExists: async () => { throw new Error("must not inspect another org provider"); } });
  assert.equal(wrongOrgResult.roles[0].status, "skipped_not_found");
  assert.equal(rows(await db.execute(sql`SELECT ownership_state FROM org_agentmail_inboxes WHERE organization_id=${wrongOwner}`))[0].ownership_state, "provisioning");
  const validOrg = randomUUID(); await seedOrg(validOrg); const validId = `stored-${randomUUID()}`; const valid = await seedOwnership(validOrg, "support", "provisioning", validId);
  assert.equal((await activateOrgInboxes(validOrg, ["support"], { verifyInboxExists: async () => ({ exists: true, inboxId: validId, email: valid.email }) })).allActivated, true);
});

test("lifecycle routes enforce ADMIN and server-derived tenant for every mutation", async () => {
  const orgA = randomUUID(), orgB = randomUUID(); await seedOrg(orgA); await seedOrg(orgB);
  const users: Record<string, string> = {};
  for (const role of ["ADMIN", "COACH", "STAFF", "CLIENT"]) {
    const userId = randomUUID(); users[role] = userId;
    await db.execute(sql`INSERT INTO users (id, email, created_at, updated_at) VALUES (${userId}, ${`${userId}@test.invalid`}, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO user_profiles (id, user_id, role, organization_id) VALUES (gen_random_uuid()::text, ${userId}, ${role}, ${orgA})`);
  }
  const calls: any[] = [];
  const overrides: any = {};
  for (const name of ["provisionOrgInboxes", "activateOrgInboxes", "disableOrgInbox", "retireOrgInbox", "retireAllOrgInboxes"]) overrides[name] = async (...args: any[]) => { calls.push([name, ...args]); return { ok: true }; };
  const map = new Map<string, Function[]>();
  const app = { get(p: string, ...h: Function[]) { map.set(`GET ${p}`, h); }, post(p: string, ...h: Function[]) { map.set(`POST ${p}`, h); } } as any;
  const auth = (req: any, res: any, next: any) => req.user ? next() : res.status(401).json({ error: "unauthenticated" });
  await registerAgentMailRoutes(app, auth, sharedRequireRole, overrides);
  const routes = [
    ["/api/agentmail/ownership/provision", {}], ["/api/agentmail/ownership/activate", {}],
    ["/api/agentmail/ownership/disable/:role", { role: "support" }], ["/api/agentmail/ownership/retire/:role", { role: "support" }],
    ["/api/agentmail/ownership/retire-all", {}],
  ] as const;
  async function invoke(path: string, role?: string, body: any = { organizationId: orgB }) {
    const res = response(); const req: any = { path, url: path, headers: {}, body, params: path.includes(":role") ? { role: "support" } : {} };
    if (role) req.user = { id: users[role], role };
    const handlers = map.get(`POST ${path}`)!; let index = 0;
    const next = async () => { const h = handlers[index++]; if (h) await h(req, res, next); };
    await next();
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    return res;
  }
  for (const [path] of routes) {
    assert.equal((await invoke(path)).statusCode, 401);
    for (const role of ["COACH", "STAFF", "CLIENT"]) assert.equal((await invoke(path, role)).statusCode, 403);
    const before = calls.length; assert.equal((await invoke(path, "ADMIN")).statusCode, 200);
    assert.equal(calls.length, before + 1); assert.equal(calls.at(-1)[1], orgA, "body organizationId must not override authenticated org");
  }
});

test("invalid provisioning role is rejected before provider mutation", async () => {
  const orgId = randomUUID(); await seedOrg(orgId); let providerCalls = 0;
  await assert.rejects(() => provisionOrgInboxes(orgId, ["general" as AgentMailRole], { createOrVerifyInbox: async () => { providerCalls++; return { ok: true }; } }), /Unknown AgentMail roles/);
  assert.equal(providerCalls, 0);
  assert.equal(rows(await db.execute(sql`SELECT * FROM org_agentmail_inboxes WHERE organization_id=${orgId}`)).length, 0);
});
