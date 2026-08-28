import assert from "node:assert/strict";
import test from "node:test";
import { assertSpecializedExecutionAuthority, ComposioSpecializedAuthorityError } from "../composio-specialized-version-authority";

const authority = (overrides: Record<string, unknown> = {}) => ({
  currentVersion: 1, approvedVersion: 1,
  approvedConnectedAccountId: "acct-a", resolvedConnectedAccountId: "acct-a",
  executionClaimed: true, alreadySucceeded: false, ...overrides,
});

test("matching approval/version/account claim permits exactly one provider call", () => {
  let providerCalls = 0;
  assertSpecializedExecutionAuthority(authority());
  providerCalls += 1;
  assert.equal(providerCalls, 1);
});

for (const [name, changed] of [
  ["stale approval V1 against V2", { currentVersion: 2 }],
  ["missing approval", { approvedVersion: null }],
  ["revoked/unclaimed approval", { executionClaimed: false }],
  ["same-version account substitution", { resolvedConnectedAccountId: "acct-b" }],
  ["confirmed success", { alreadySucceeded: true }],
  ["ineligible legacy version", { currentVersion: null, approvedVersion: null }],
] as const) {
  test(`${name} fails closed with provider-call count 0`, () => {
    let providerCalls = 0;
    assert.throws(() => {
      assertSpecializedExecutionAuthority(authority(changed));
      providerCalls += 1;
    }, ComposioSpecializedAuthorityError);
    assert.equal(providerCalls, 0);
  });
}
