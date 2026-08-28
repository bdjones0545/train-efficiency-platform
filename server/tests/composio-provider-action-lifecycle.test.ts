import assert from "node:assert/strict";
import test from "node:test";
import { deriveCanonicalProviderActionIdentity, type ProviderActionAuthority } from "../composio-action-identity";
import {
  BLOCKING_ATTEMPT_STATUSES,
  ComposioLifecycleContractError,
  assessCallerIdentityReadiness,
  assertAttemptTransition,
  assertAuthorityStillMatches,
  assertInvocationAuthority,
  callbackConvergenceKey,
  nextAttemptDirective,
  outcomeAfterPersistenceFailure,
} from "../composio-provider-action-lifecycle";

const identity = deriveCanonicalProviderActionIdentity({
  orgId: "org-a", providerFamily: "gmail", logicalProviderActionId: "request-1", providerActionVersion: "v1",
});
const authority = (overrides: Partial<ProviderActionAuthority> = {}): ProviderActionAuthority => ({
  identity, tool: "GMAIL", action: "GMAIL_CREATE_EMAIL_DRAFT", connectedAccountId: "acct-a",
  argumentsVersion: "approved-payload-v1", approvalId: "approval-1", approvingPrincipalId: "admin-1", ...overrides,
});

test("complete caller-owned identity is ready", () => {
  assert.equal(assessCallerIdentityReadiness({ logicalProviderActionId: "request-1", providerActionVersion: "v1" }), "ready");
});
test("specialized durable request without immutable version is blocked", () => {
  assert.equal(assessCallerIdentityReadiness({ logicalProviderActionId: "request-1" }), "version_missing");
});
test("generic mutation without either identity field is blocked", () => {
  assert.equal(assessCallerIdentityReadiness({}), "logical_id_and_version_missing");
});
test("version without logical action ID is blocked", () => {
  assert.equal(assessCallerIdentityReadiness({ providerActionVersion: "v1" }), "logical_id_missing");
});
test("unchanged authority may execute", () => assert.doesNotThrow(() => assertAuthorityStillMatches(authority(), authority())));
test("connected-account substitution is rejected", () => {
  assert.throws(() => assertAuthorityStillMatches(authority(), authority({ connectedAccountId: "acct-b" })), ComposioLifecycleContractError);
});
test("changed approved arguments are rejected", () => {
  assert.throws(() => assertAuthorityStillMatches(authority(), authority({ argumentsVersion: "approved-payload-v2" })), ComposioLifecycleContractError);
});
test("changed approval principal is rejected", () => {
  assert.throws(() => assertAuthorityStillMatches(authority(), authority({ approvingPrincipalId: "admin-2" })), ComposioLifecycleContractError);
});
test("authorized action claims its first attempt", () => {
  assert.equal(nextAttemptDirective({ actionStatus: "authorized" }), "authorize_first_attempt");
});
test("pre-invocation authorized attempt is resumed rather than duplicated", () => {
  assert.equal(nextAttemptDirective({ actionStatus: "authorized", latestAttemptStatus: "attempt_authorized" }), "resume_authorized_attempt");
});
test("retry-authorized attempt failure permits a new attempt while the action remains authorized", () => {
  assert.equal(nextAttemptDirective({
    actionStatus: "authorized",
    latestAttemptStatus: "confirmed_failure",
    confirmedFailureRetryDisposition: "retry_authorized",
  }), "authorize_retry_attempt");
});
test("attempt failure without explicit retry authority fails closed", () => {
  assert.throws(
    () => nextAttemptDirective({ actionStatus: "authorized", latestAttemptStatus: "confirmed_failure" }),
    ComposioLifecycleContractError,
  );
});
test("permanently failed logical action is terminal", () => {
  assert.equal(nextAttemptDirective({ actionStatus: "confirmed_failure" }), "terminal_do_not_retry");
});
for (const status of ["invocation_in_progress", "provider_accepted", "uncertain"] as const) {
  test(`${status} requires reconciliation and prohibits blind retry`, () => {
    assert.equal(nextAttemptDirective({ actionStatus: status === "invocation_in_progress" ? "authorized" : status, latestAttemptStatus: status }), "reconcile_do_not_retry");
  });
}
for (const status of ["confirmed_success", "rejected", "cancelled"] as const) {
  test(`${status} is terminal`, () => assert.equal(nextAttemptDirective({ actionStatus: status }), "terminal_do_not_retry"));
}
test("blocking attempt set includes uncertain crash windows", () => {
  assert.deepEqual(BLOCKING_ATTEMPT_STATUSES, ["attempt_authorized", "invocation_in_progress", "provider_accepted", "uncertain"]);
});
test("invocation begins only from a durable authorized attempt", () => {
  assert.doesNotThrow(() => assertAttemptTransition("attempt_authorized", "invocation_in_progress"));
  assert.throws(() => assertAttemptTransition("attempt_authorized", "confirmed_success"), ComposioLifecycleContractError);
});
test("synchronous provider result may terminally classify an invocation", () => {
  assert.doesNotThrow(() => assertAttemptTransition("invocation_in_progress", "confirmed_success"));
  assert.doesNotThrow(() => assertAttemptTransition("invocation_in_progress", "confirmed_failure"));
});
test("asynchronous acceptance remains nonterminal", () => {
  assert.doesNotThrow(() => assertAttemptTransition("invocation_in_progress", "provider_accepted"));
  assert.doesNotThrow(() => assertAttemptTransition("provider_accepted", "confirmed_success"));
});
test("terminal attempts cannot be reopened", () => {
  assert.throws(() => assertAttemptTransition("confirmed_success", "invocation_in_progress"), ComposioLifecycleContractError);
});
test("connection authority is revalidated immediately before invocation", () => {
  assert.throws(() => assertInvocationAuthority({ connectionAuthorityCurrent: false, approvalAuthorityCurrent: true }), ComposioLifecycleContractError);
});
test("approval authority is revalidated immediately before invocation", () => {
  assert.throws(() => assertInvocationAuthority({ connectionAuthorityCurrent: true, approvalAuthorityCurrent: false }), ComposioLifecycleContractError);
});
test("duplicate callbacks converge on persisted action, attempt, and provider event", () => {
  const callback = { actionId: "action-1", attemptId: "attempt-1", providerEventId: "event-1" };
  assert.equal(callbackConvergenceKey(callback), callbackConvergenceKey(callback));
  assert.notEqual(callbackConvergenceKey(callback), callbackConvergenceKey({ ...callback, attemptId: "attempt-2" }));
});
test("provider event ID alone is not callback authority", () => {
  assert.notEqual(
    callbackConvergenceKey({ actionId: "action-1", attemptId: "attempt-1", providerEventId: "same" }),
    callbackConvergenceKey({ actionId: "action-2", attemptId: "attempt-2", providerEventId: "same" }),
  );
});
test("possible provider success followed by persistence failure is uncertain", () => {
  assert.equal(outcomeAfterPersistenceFailure(true), "uncertain");
});
test("failure proven before invocation is confirmed failure", () => {
  assert.equal(outcomeAfterPersistenceFailure(false), "confirmed_failure");
});

test("negative control: current call-before-log shape duplicates provider side effects on retry", async () => {
  let providerCalls = 0;
  const legacyExecute = async (persist: () => Promise<void>) => {
    providerCalls += 1;
    await persist();
    return { success: true };
  };
  await assert.rejects(() => legacyExecute(async () => { throw new Error("database unavailable"); }));
  await legacyExecute(async () => undefined);
  assert.equal(providerCalls, 2);
});

test("negative control: best-effort post-provider logging can mask missing durable outcome", async () => {
  let durableRows = 0;
  const legacyWrite = async () => { try { throw new Error("database unavailable"); } catch { /* swallowed */ } };
  const legacyExecute = async () => { await legacyWrite(); return { success: true }; };
  assert.deepEqual(await legacyExecute(), { success: true });
  assert.equal(durableRows, 0);
});
