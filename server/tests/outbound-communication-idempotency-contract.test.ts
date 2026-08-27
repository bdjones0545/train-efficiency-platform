import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTBOUND_SEND_CLASSES,
  OutboundSendContractError,
  deriveHumanApprovedSendIdentity,
  deriveLogicalSendIdentity,
  dispositionForProviderOutcome,
  humanApprovedIdentityKey,
  mayAttemptProvider,
  sameHumanApprovedSend,
  sameLogicalSend,
} from "../outbound-send-identity";

const logical = (overrides: Partial<Parameters<typeof deriveLogicalSendIdentity>[0]> = {}) =>
  deriveLogicalSendIdentity({
    orgId: "org-a",
    sendClass: "transactional",
    logicalSendId: "invoice-ready-42",
    ...overrides,
  });

const approved = (overrides: Partial<Parameters<typeof deriveHumanApprovedSendIdentity>[0]> = {}) =>
  deriveHumanApprovedSendIdentity({
    orgId: "org-a",
    sendClass: "human_approved",
    logicalSendId: "reply-send-42",
    authorityType: "agentmail_reply_queue",
    authorityId: "reply-42",
    approvedPayloadVersion: "approval-v1",
    ...overrides,
  });

test("the four approved send classes are exhaustive and stable", () => {
  assert.deepEqual(OUTBOUND_SEND_CLASSES, ["transactional", "human_approved", "automated_outreach", "direct_agent"]);
});

test("same tenant, class, and logical ID is the same logical send on retry", () => {
  assert.equal(sameLogicalSend(logical(), logical()), true);
});

test("a different logical ID is a distinct intended communication", () => {
  assert.equal(sameLogicalSend(logical(), logical({ logicalSendId: "invoice-ready-43" })), false);
});

test("the same logical ID in another tenant is distinct", () => {
  assert.equal(sameLogicalSend(logical(), logical({ orgId: "org-b" })), false);
});

test("send class participates in logical identity", () => {
  assert.equal(sameLogicalSend(logical(), logical({ sendClass: "direct_agent" })), false);
});

test("provider receipt does not define logical identity", () => {
  const beforeProvider = logical();
  const afterProvider = { ...logical(), providerMessageId: "provider-999" };
  assert.equal(sameLogicalSend(beforeProvider, afterProvider), true);
});

test("timestamp does not define logical identity", () => {
  const first = { ...logical(), attemptedAt: "2026-01-01T00:00:00Z" };
  const retry = { ...logical(), attemptedAt: "2026-01-02T00:00:00Z" };
  assert.equal(sameLogicalSend(first, retry), true);
});

test("recipient and time bucket do not define logical identity", () => {
  const first = { ...logical(), recipient: "person@example.com", bucket: "2026-01-01T10" };
  const retry = { ...logical(), recipient: "other@example.com", bucket: "2026-01-01T11" };
  assert.equal(sameLogicalSend(first, retry), true);
});

test("missing and blank logical IDs are rejected", () => {
  assert.throws(() => logical({ logicalSendId: undefined as unknown as string }), OutboundSendContractError);
  assert.throws(() => logical({ logicalSendId: "   " }), OutboundSendContractError);
});

test("missing, blank, and synthetic tenant identities are rejected", () => {
  assert.throws(() => logical({ orgId: "" }), OutboundSendContractError);
  for (const orgId of ["default", "GLOBAL", "unknown", "unscoped"]) {
    assert.throws(() => logical({ orgId }), OutboundSendContractError);
  }
});

test("human-approved identity includes authority type to prevent ID-domain collisions", () => {
  assert.equal(sameHumanApprovedSend(approved(), approved({ authorityType: "gmail_action" })), false);
});

test("human-approved identity requires authority and payload version", () => {
  assert.throws(() => approved({ authorityId: "" }), OutboundSendContractError);
  assert.throws(() => approved({ authorityType: "" }), OutboundSendContractError);
  assert.throws(() => approved({ approvedPayloadVersion: "" }), OutboundSendContractError);
});

test("same approved payload retry retains the same authority identity", () => {
  assert.equal(sameHumanApprovedSend(approved(), approved()), true);
});

test("payload modification invalidates the old approval identity", () => {
  assert.equal(sameHumanApprovedSend(approved(), approved({ approvedPayloadVersion: "approval-v2" })), false);
});

test("reapproval can authorize a new version under the logical-send contract", () => {
  const v1 = approved();
  const v2 = approved({ approvedPayloadVersion: "approval-v2" });
  assert.equal(sameLogicalSend(v1, v2), true);
  assert.notEqual(humanApprovedIdentityKey(v1), humanApprovedIdentityKey(v2));
});

test("same authority and logical ID in different tenants remains distinct", () => {
  assert.equal(sameHumanApprovedSend(approved(), approved({ orgId: "org-b" })), false);
});

test("authority from tenant A cannot authorize tenant B", () => {
  const tenantA = approved();
  const tenantB = approved({ orgId: "org-b" });
  assert.notEqual(humanApprovedIdentityKey(tenantA), humanApprovedIdentityKey(tenantB));
});

test("provider receipt cannot bridge approval authority across tenants", () => {
  const tenantA = { ...approved(), providerMessageId: "shared-receipt" };
  const tenantB = { ...approved({ orgId: "org-b" }), providerMessageId: "shared-receipt" };
  assert.equal(sameHumanApprovedSend(tenantA, tenantB), false);
});

test("logical send exists before any provider attempt", () => {
  assert.equal(mayAttemptProvider("not_started", false), true);
  assert.equal(dispositionForProviderOutcome("not_started"), "claimed");
});

test("an in-progress provider attempt blocks a concurrent blind attempt", () => {
  assert.equal(mayAttemptProvider("in_progress", true), false);
});

test("confirmed provider failure permits only a policy-authorized retry", () => {
  assert.equal(mayAttemptProvider("confirmed_failure", true), true);
  assert.equal(mayAttemptProvider("confirmed_failure", false), false);
  assert.equal(dispositionForProviderOutcome("confirmed_failure"), "provider_confirmed_failure");
});

test("confirmed provider success suppresses retry", () => {
  assert.equal(mayAttemptProvider("confirmed_success", true), false);
  assert.equal(dispositionForProviderOutcome("confirmed_success"), "provider_confirmed_success");
});

test("unknown provider outcome blocks blind retry and becomes uncertain", () => {
  assert.equal(mayAttemptProvider("unknown", true), false);
  assert.equal(dispositionForProviderOutcome("unknown"), "uncertain_provider_outcome");
});

test("a failed attempt does not create a new logical send", () => {
  const original = logical();
  const retry = logical();
  assert.equal(sameLogicalSend(original, retry), true);
});

test("legacy recipient/type/time-bucket material is excluded from canonical identity", () => {
  const legacyA = { ...logical(), recipient: "a@example.com", emailType: "notice", bucket: "10" };
  const legacyB = { ...logical(), recipient: "b@example.com", emailType: "other", bucket: "11" };
  assert.equal(sameLogicalSend(legacyA, legacyB), true);
});
