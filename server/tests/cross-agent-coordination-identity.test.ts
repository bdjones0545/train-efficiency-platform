import assert from "node:assert/strict";
import test from "node:test";
import {
  CoordinationIdentityContractError,
  addDistinctSupportingAgent,
  coordinationResult,
  deriveCanonicalCoordinationIdentity,
  isSameActiveCoordination,
  sameCoordinationIdentity,
} from "../coordination-identity";

const base = {
  orgId: "org-a",
  actionType: "follow_up",
  coordinationGeneration: "workflow-run-1",
};

test("prospect is canonical over Gmail conversation context", () => {
  assert.deepEqual(deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1", gmailThreadId: "T1" }), {
    ...base, resourceType: "prospect", resourceId: "P1",
  });
});

test("lead is canonical over Gmail conversation context", () => {
  assert.equal(deriveCanonicalCoordinationIdentity({ ...base, leadId: "L1", gmailThreadId: "T1" }).resourceType, "lead");
});

test("prospect and lead together are rejected as ambiguous", () => {
  assert.throws(() => deriveCanonicalCoordinationIdentity({ ...base, prospectId: "X", leadId: "X" }), CoordinationIdentityContractError);
});

test("provider Gmail thread is preferred over matching internal conversation", () => {
  const identity = deriveCanonicalCoordinationIdentity({
    ...base, gmailThreadId: "provider-thread", sourceConversationId: "internal-row", sourceConversationType: "gmail",
  });
  assert.deepEqual({ type: identity.resourceType, id: identity.resourceId }, { type: "gmail_thread", id: "provider-thread" });
});

test("typed Gmail source conversation is a valid fallback", () => {
  const identity = deriveCanonicalCoordinationIdentity({ ...base, sourceConversationId: "internal-row", sourceConversationType: "gmail" });
  assert.deepEqual({ type: identity.resourceType, id: identity.resourceId }, { type: "gmail_thread", id: "internal-row" });
});

test("untyped source conversation is insufficient", () => {
  assert.throws(() => deriveCanonicalCoordinationIdentity({ ...base, sourceConversationId: "generic" }), CoordinationIdentityContractError);
});

test("lead and prospect with the same textual ID remain distinct", () => {
  const lead = deriveCanonicalCoordinationIdentity({ ...base, leadId: "shared" });
  const prospect = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "shared" });
  assert.equal(sameCoordinationIdentity(lead, prospect), false);
});

test("tenant is part of canonical identity", () => {
  const a = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1" });
  const b = deriveCanonicalCoordinationIdentity({ ...base, orgId: "org-b", prospectId: "P1" });
  assert.equal(sameCoordinationIdentity(a, b), false);
});

test("action type is part of canonical identity", () => {
  const a = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1" });
  const b = deriveCanonicalCoordinationIdentity({ ...base, actionType: "schedule", prospectId: "P1" });
  assert.equal(sameCoordinationIdentity(a, b), false);
});

test("same generation produces the same canonical identity", () => {
  const a = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1" });
  const b = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1" });
  assert.equal(sameCoordinationIdentity(a, b), true);
});

test("a later generation produces a distinct canonical identity", () => {
  const a = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1" });
  const b = deriveCanonicalCoordinationIdentity({ ...base, coordinationGeneration: "campaign-2", prospectId: "P1" });
  assert.equal(sameCoordinationIdentity(a, b), false);
});

test("missing and blank generation values are rejected", () => {
  assert.throws(() => deriveCanonicalCoordinationIdentity({ ...base, coordinationGeneration: "", prospectId: "P1" }), CoordinationIdentityContractError);
  assert.throws(() => deriveCanonicalCoordinationIdentity({ ...base, coordinationGeneration: "   ", prospectId: "P1" }), CoordinationIdentityContractError);
});

test("agent is excluded from canonical identity", () => {
  const a = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1", agentName: "A" });
  const b = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1", agentName: "B" });
  assert.equal(sameCoordinationIdentity(a, b), true);
});

test("source action ID is trace-only and excluded from canonical identity", () => {
  const a = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1", sourceActionId: "upstream-a" });
  const b = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1", sourceActionId: "upstream-b" });
  assert.equal(sameCoordinationIdentity(a, b), true);
});

test("support counts distinct agents and same-agent retry adds no support", () => {
  const first = addDistinctSupportingAgent([], "Agent A");
  const retry = addDistinctSupportingAgent(first.sourceAgents, "Agent A");
  const second = addDistinctSupportingAgent(retry.sourceAgents, "Agent B");
  assert.deepEqual([first.supportScore, retry.supportScore, second.supportScore], [1, 1, 2]);
});

test("third distinct supporter reaches merged threshold without changing identity", () => {
  const supporters = addDistinctSupportingAgent(["Agent A", "Agent B"], "Agent C");
  assert.equal(supporters.supportScore, 3);
  assert.deepEqual(coordinationResult("registry-1", false, supporters.supportScore), {
    action: "merged", actionId: "registry-1", supportScore: 3,
  });
});

test("created and deduplicated results always return the canonical registry ID", () => {
  assert.deepEqual(coordinationResult("registry-1", true, 1), { action: "created", actionId: "registry-1", supportScore: 1 });
  assert.deepEqual(coordinationResult("registry-1", false, 2), { action: "deduplicated", actionId: "registry-1", supportScore: 2 });
  assert.throws(() => coordinationResult("", true, 1), CoordinationIdentityContractError);
});

test("only an active row participates in same-generation deduplication", () => {
  const identity = deriveCanonicalCoordinationIdentity({ ...base, prospectId: "P1" });
  assert.equal(isSameActiveCoordination({ identity, status: "active" }, identity), true);
  assert.equal(isSameActiveCoordination({ identity, status: "resolved" }, identity), false);
  const later = deriveCanonicalCoordinationIdentity({ ...base, coordinationGeneration: "workflow-run-2", prospectId: "P1" });
  assert.equal(isSameActiveCoordination({ identity, status: "active" }, later), false);
});
