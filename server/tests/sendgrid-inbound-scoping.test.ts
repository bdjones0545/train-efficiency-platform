/**
 * SendGrid Inbound Parse — authentication and cross-tenant attribution.
 *
 * These tests execute the real handler with an injected fake storage and a
 * fake req/res, so they fail if the behaviour regresses rather than if the
 * source text changes.
 *
 * What they pin down:
 *   - Production with no SENDGRID_INBOUND_SECRET refuses the request (503) and
 *     touches no storage at all. On main the guard was skipped entirely when
 *     the secret was unset, and the payload was processed.
 *   - A wrong token is rejected 401.
 *   - A sender prospected by two organizations updates BOTH, each against its
 *     own prospect/draft/deal. On main a global `rows[0]` lookup gave the reply
 *     to an arbitrary single organization.
 *   - A sender nobody has emailed mutates nothing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authorizeInboundParseRequest,
  createSendGridInboundHandler,
  extractRecipientEmails,
  extractSenderEmail,
  type InboundReplyStorage,
} from "../email-agent/inbound-reply";

const SENDER = "ad@centralhigh.example";

type Call = { method: string; args: any[] };

interface FakeOrg {
  id: string;
  ownerEmail?: string | null;
  schedulingInquiryEmail?: string | null;
}

interface FakeProspect {
  id: string;
  orgId: string;
  prospectName: string;
  contactEmail: string;
  outreachStatus: string;
  estimatedValue?: number;
}

interface FakeDraft {
  id: string;
  orgId: string;
  prospectId: string;
  sentAt: Date | null;
  repliedAt: Date | null;
  messageVariantId?: string | null;
}

function fakeStorage(seed: {
  orgs?: FakeOrg[];
  prospects?: FakeProspect[];
  drafts?: FakeDraft[];
}) {
  const orgs = seed.orgs ?? [];
  const prospects = seed.prospects ?? [];
  const drafts = seed.drafts ?? [];
  const calls: Call[] = [];
  const record = (method: string, ...args: any[]) => calls.push({ method, args });
  const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");

  const storage: InboundReplyStorage = {
    async findOrganizationIdsWithSentOutreachToEmail(email) {
      record("findOrganizationIdsWithSentOutreachToEmail", email);
      const matching = prospects.filter((p) => lower(p.contactEmail) === lower(email));
      const orgIds = new Set<string>();
      for (const p of matching) {
        if (drafts.some((d) => d.prospectId === p.id && d.orgId === p.orgId && d.sentAt)) {
          orgIds.add(p.orgId);
        }
      }
      return [...orgIds];
    },
    async findProspectByContactEmailForOrganization(orgId, email) {
      record("findProspectByContactEmailForOrganization", orgId, email);
      return prospects.find((p) => p.orgId === orgId && lower(p.contactEmail) === lower(email));
    },
    async getOrganizationById(id) {
      record("getOrganizationById", id);
      return orgs.find((o) => o.id === id);
    },
    async getOutreachDraftsByProspect(prospectId) {
      record("getOutreachDraftsByProspect", prospectId);
      return drafts.filter((d) => d.prospectId === prospectId);
    },
    async updateTeamTrainingProspect(id, data) {
      record("updateTeamTrainingProspect", id, data);
      const p = prospects.find((row) => row.id === id);
      if (p) Object.assign(p, data);
      return p;
    },
    async updateTeamTrainingOutreachDraft(id, data) {
      record("updateTeamTrainingOutreachDraft", id, data);
      const d = drafts.find((row) => row.id === id);
      if (d) Object.assign(d, data);
      return d;
    },
    async cancelFollowUpSequence(draftId) {
      record("cancelFollowUpSequence", draftId);
    },
    async getEmailMessageVariant(id) {
      record("getEmailMessageVariant", id);
      return undefined;
    },
    async updateEmailMessageVariant(id, data) {
      record("updateEmailMessageVariant", id, data);
      return undefined;
    },
    async logOutreachEvent(data) {
      record("logOutreachEvent", data);
      return data;
    },
    async getTeamTrainingDealByProspect(prospectId, orgId) {
      record("getTeamTrainingDealByProspect", prospectId, orgId);
      return undefined;
    },
    async createTeamTrainingDeal(data) {
      record("createTeamTrainingDeal", data);
      return data;
    },
  };

  return { storage, calls, prospects, drafts };
}

function fakeRes() {
  return {
    statusCode: 0,
    payload: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

const silentLogger = { log() {}, warn() {}, error() {} };

function inboundBody(overrides: Record<string, unknown> = {}) {
  return {
    envelope: JSON.stringify({ from: SENDER, to: ["parse@trainefficiency.com"] }),
    from: `Athletic Director <${SENDER}>`,
    to: "parse@trainefficiency.com",
    text: "Yes, we are interested — send info.",
    ...overrides,
  };
}

async function invoke(
  handlerDeps: Parameters<typeof createSendGridInboundHandler>[0],
  req: any,
) {
  const res = fakeRes();
  await createSendGridInboundHandler(handlerDeps)(req, res);
  return res;
}

// ─── Authentication ─────────────────────────────────────────────────────────

test("production with no inbound secret returns 503 and touches no storage", async () => {
  const { storage, calls } = fakeStorage({
    orgs: [{ id: "org-a" }],
    prospects: [{ id: "p-a", orgId: "org-a", prospectName: "Central High", contactEmail: SENDER, outreachStatus: "Contacted" }],
    drafts: [{ id: "d-a", orgId: "org-a", prospectId: "p-a", sentAt: new Date(), repliedAt: null }],
  });

  const res = await invoke(
    {
      storage,
      env: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
      logger: silentLogger,
      classifyReply: async () => "interested",
    },
    { query: {}, body: inboundBody() },
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.code, "INBOUND_SECRET_NOT_CONFIGURED");
  assert.deepEqual(calls, [], "no storage call may happen when the secret is unconfigured");
});

test("a wrong or missing token is rejected 401 when a secret is configured", async () => {
  const { storage, calls } = fakeStorage({ prospects: [], drafts: [] });
  const env = { NODE_ENV: "production", SENDGRID_INBOUND_SECRET: "s".repeat(32) } as NodeJS.ProcessEnv;

  for (const query of [{}, { token: "wrong" }, { token: "s".repeat(31) }, { token: ["s".repeat(32)] }]) {
    const res = await invoke({ storage, env, logger: silentLogger }, { query, body: inboundBody() });
    assert.equal(res.statusCode, 401, JSON.stringify(query));
    assert.equal(res.payload.code, "UNAUTHORIZED");
  }
  assert.deepEqual(calls, []);
});

test("token comparison is timing-safe and exact", () => {
  const env = { NODE_ENV: "production", SENDGRID_INBOUND_SECRET: "abc123abc123abc123abc123abc123ab" } as NodeJS.ProcessEnv;
  assert.equal(authorizeInboundParseRequest("abc123abc123abc123abc123abc123ab", env, silentLogger).ok, true);
  assert.equal(authorizeInboundParseRequest("abc123abc123abc123abc123abc123aB", env, silentLogger).ok, false);
  assert.equal(authorizeInboundParseRequest(undefined, env, silentLogger).ok, false);
});

test("outside production a missing secret stays lenient but is logged", () => {
  const warnings: string[] = [];
  const decision = authorizeInboundParseRequest(
    undefined,
    { NODE_ENV: "development" } as NodeJS.ProcessEnv,
    { log() {}, error() {}, warn: (m) => warnings.push(m) },
  );
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.enforced, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /SENDGRID_INBOUND_SECRET is not set/);
});

// ─── Attribution ────────────────────────────────────────────────────────────

test("a correct token processes the reply for the sending organization", async () => {
  const secret = "t".repeat(32);
  const { storage, calls, prospects, drafts } = fakeStorage({
    orgs: [{ id: "org-a", ownerEmail: "coach-a@orga.example" }],
    prospects: [{ id: "p-a", orgId: "org-a", prospectName: "Central High", contactEmail: SENDER, outreachStatus: "Contacted", estimatedValue: 5000 }],
    drafts: [{ id: "d-a", orgId: "org-a", prospectId: "p-a", sentAt: new Date("2026-01-01"), repliedAt: null }],
  });

  const res = await invoke(
    {
      storage,
      env: { NODE_ENV: "production", SENDGRID_INBOUND_SECRET: secret } as NodeJS.ProcessEnv,
      logger: silentLogger,
      classifyReply: async () => "interested",
      attributeOutcome: async () => {},
    },
    { query: { token: secret }, body: inboundBody() },
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true });
  assert.equal(prospects[0].outreachStatus, "Replied");
  assert.ok(drafts[0].repliedAt instanceof Date);
  const deal = calls.find((c) => c.method === "createTeamTrainingDeal");
  assert.equal(deal?.args[0].organizationId, "org-a");
  assert.equal(deal?.args[0].prospectId, "p-a");
});

test("a sender prospected by two organizations updates both, each with its own records", async () => {
  const secret = "t".repeat(32);
  const { storage, calls, prospects, drafts } = fakeStorage({
    orgs: [
      { id: "org-a", ownerEmail: "coach-a@orga.example" },
      { id: "org-b", ownerEmail: "coach-b@orgb.example" },
    ],
    prospects: [
      { id: "p-a", orgId: "org-a", prospectName: "Central High (A)", contactEmail: SENDER, outreachStatus: "Contacted", estimatedValue: 1000 },
      { id: "p-b", orgId: "org-b", prospectName: "Central High (B)", contactEmail: SENDER, outreachStatus: "Contacted", estimatedValue: 2000 },
    ],
    drafts: [
      { id: "d-a", orgId: "org-a", prospectId: "p-a", sentAt: new Date("2026-01-01"), repliedAt: null },
      { id: "d-b", orgId: "org-b", prospectId: "p-b", sentAt: new Date("2026-01-02"), repliedAt: null },
    ],
  });

  const res = await invoke(
    {
      storage,
      env: { NODE_ENV: "production", SENDGRID_INBOUND_SECRET: secret } as NodeJS.ProcessEnv,
      logger: silentLogger,
      classifyReply: async () => "interested",
      attributeOutcome: async () => {},
    },
    { query: { token: secret }, body: inboundBody() },
  );

  assert.equal(res.statusCode, 200);

  // Both tenants saw the reply.
  assert.equal(prospects.find((p) => p.id === "p-a")!.outreachStatus, "Replied");
  assert.equal(prospects.find((p) => p.id === "p-b")!.outreachStatus, "Replied");
  assert.ok(drafts.find((d) => d.id === "d-a")!.repliedAt instanceof Date);
  assert.ok(drafts.find((d) => d.id === "d-b")!.repliedAt instanceof Date);

  // Nothing is cross-wired: every org-scoped write names its own org.
  const events = calls.filter((c) => c.method === "logOutreachEvent").map((c) => c.args[0]);
  assert.deepEqual(
    events.map((e) => `${e.orgId}:${e.prospectId}`).sort(),
    ["org-a:p-a", "org-b:p-b"],
  );
  const deals = calls.filter((c) => c.method === "createTeamTrainingDeal").map((c) => c.args[0]);
  assert.deepEqual(
    deals.map((d) => `${d.organizationId}:${d.prospectId}:${d.outreachDraftId}`).sort(),
    ["org-a:p-a:d-a", "org-b:p-b:d-b"],
  );
  assert.deepEqual(
    calls.filter((c) => c.method === "cancelFollowUpSequence").map((c) => c.args[0]).sort(),
    ["d-a", "d-b"],
  );
  // Every prospect lookup was org-scoped.
  for (const call of calls.filter((c) => c.method === "findProspectByContactEmailForOrganization")) {
    assert.ok(["org-a", "org-b"].includes(call.args[0]));
  }
});

test("a per-org reply-to recipient narrows attribution to that organization", async () => {
  const secret = "t".repeat(32);
  const { storage, prospects } = fakeStorage({
    orgs: [
      { id: "org-a", ownerEmail: "coach-a@orga.example" },
      { id: "org-b", ownerEmail: "coach-b@orgb.example" },
    ],
    prospects: [
      { id: "p-a", orgId: "org-a", prospectName: "Central High (A)", contactEmail: SENDER, outreachStatus: "Contacted" },
      { id: "p-b", orgId: "org-b", prospectName: "Central High (B)", contactEmail: SENDER, outreachStatus: "Contacted" },
    ],
    drafts: [
      { id: "d-a", orgId: "org-a", prospectId: "p-a", sentAt: new Date("2026-01-01"), repliedAt: null },
      { id: "d-b", orgId: "org-b", prospectId: "p-b", sentAt: new Date("2026-01-02"), repliedAt: null },
    ],
  });

  await invoke(
    {
      storage,
      env: { NODE_ENV: "production", SENDGRID_INBOUND_SECRET: secret } as NodeJS.ProcessEnv,
      logger: silentLogger,
      classifyReply: async () => "unknown",
      attributeOutcome: async () => {},
    },
    {
      query: { token: secret },
      body: inboundBody({
        envelope: JSON.stringify({ from: SENDER, to: ["coach-b@orgb.example"] }),
        to: "Coach B <coach-b@orgb.example>",
      }),
    },
  );

  assert.equal(prospects.find((p) => p.id === "p-b")!.outreachStatus, "Replied");
  assert.equal(prospects.find((p) => p.id === "p-a")!.outreachStatus, "Contacted");
});

test("a sender with no sent outreach anywhere returns 200 and mutates nothing", async () => {
  const secret = "t".repeat(32);
  const { storage, calls, prospects } = fakeStorage({
    orgs: [{ id: "org-a", ownerEmail: "coach-a@orga.example" }],
    // The prospect exists, but the org never sent to it.
    prospects: [{ id: "p-a", orgId: "org-a", prospectName: "Central High", contactEmail: SENDER, outreachStatus: "New" }],
    drafts: [{ id: "d-a", orgId: "org-a", prospectId: "p-a", sentAt: null, repliedAt: null }],
  });

  const res = await invoke(
    {
      storage,
      env: { NODE_ENV: "production", SENDGRID_INBOUND_SECRET: secret } as NodeJS.ProcessEnv,
      logger: silentLogger,
      classifyReply: async () => "interested",
      attributeOutcome: async () => {},
    },
    { query: { token: secret }, body: inboundBody() },
  );

  assert.equal(res.statusCode, 200);
  assert.equal(prospects[0].outreachStatus, "New");
  const mutations = calls.filter((c) =>
    [
      "updateTeamTrainingProspect",
      "updateTeamTrainingOutreachDraft",
      "cancelFollowUpSequence",
      "logOutreachEvent",
      "createTeamTrainingDeal",
    ].includes(c.method),
  );
  assert.deepEqual(mutations, []);
});

test("address extraction reads the envelope first and tolerates header forms", () => {
  assert.equal(
    extractSenderEmail({ envelope: JSON.stringify({ from: "A.D@Central.Example" }), from: "other@x.example" }),
    "a.d@central.example",
  );
  assert.equal(extractSenderEmail({ from: "Athletic Director <AD@central.example>" }), "ad@central.example");
  assert.equal(extractSenderEmail({ from: "ad@central.example" }), "ad@central.example");
  assert.equal(extractSenderEmail({}), null);

  assert.deepEqual(
    extractRecipientEmails({
      envelope: JSON.stringify({ to: ["Parse@TrainEfficiency.com"] }),
      to: "Coach <coach@orgb.example>, parse@trainefficiency.com",
    }).sort(),
    ["coach@orgb.example", "parse@trainefficiency.com"],
  );
});
