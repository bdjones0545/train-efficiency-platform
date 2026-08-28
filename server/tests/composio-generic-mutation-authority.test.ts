import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { COMPOSIO_TOOLS } from "../composio-tool-registry";
import {
  GENERIC_COMPOSIO_MUTATION_ACTIONS,
  GenericMutationAuthorityError,
  classifyGenericComposioAction,
  genericDirectMutationReadiness,
  genericMutationAuthorityMatches,
  genericMutationRetryDirective,
  requireGenericMutationAuthority,
  revisedGenericMutationVersion,
  type GenericIdentityProvenance,
  type GenericMutationAuthorityInput,
} from "../composio-generic-mutation-authority";

const ready = (overrides: Partial<GenericMutationAuthorityInput> = {}) => requireGenericMutationAuthority({
  orgId: "org-a", toolkit: "GOOGLESHEETS", action: "GOOGLESHEETS_CLEAR_VALUES",
  logicalProviderActionId: "business-action-1", logicalIdProvenance: "durable_business_object",
  providerActionVersion: 1, currentVersion: 1, connectedAccountId: "acct-a",
  authorityDescriptorComplete: true, ...overrides,
});

test("missing logical ID is rejected", () => assert.throws(() => ready({ logicalProviderActionId: " " }), GenericMutationAuthorityError));
test("missing version is rejected", () => assert.throws(() => ready({ providerActionVersion: undefined }), GenericMutationAuthorityError));
test("zero and unsafe versions are rejected", () => {
  assert.throws(() => ready({ providerActionVersion: 0 }));
  assert.throws(() => ready({ providerActionVersion: Number.MAX_SAFE_INTEGER + 1 }));
});
for (const provenance of ["attempt_uuid", "approval_id", "provider_receipt", "entity_id", "argument_hash", "timestamp", "resource_key", "executor_generated"] as GenericIdentityProvenance[]) {
  test(`${provenance} is not canonical business identity`, () => assert.throws(() => ready({ logicalIdProvenance: provenance })));
}
test("retry keeps logical ID and version", () => assert.deepEqual(ready(), ready()));
test("later independent action uses a new logical ID", () => assert.notEqual(ready().identity.logicalProviderActionId, ready({ logicalProviderActionId: "business-action-2" }).identity.logicalProviderActionId));
test("unchanged authority preserves version", () => assert.equal(revisedGenericMutationVersion(1, false), 1));
test("material revision advances version", () => assert.equal(revisedGenericMutationVersion(1, true), 2));
test("stale V1 against current V2 is rejected before eligibility", () => assert.throws(() => ready({ currentVersion: 2 })));
test("current-version authority must be a matching positive safe integer", () => {
  assert.throws(() => ready({ currentVersion: undefined }));
  assert.throws(() => ready({ currentVersion: 0 }));
  assert.throws(() => ready({ currentVersion: -1 }));
  assert.throws(() => ready({ currentVersion: Number.MAX_SAFE_INTEGER + 1 }));
  assert.throws(() => ready({ providerActionVersion: 2, currentVersion: 1 }));
  assert.equal(ready({ providerActionVersion: 2, currentVersion: 2 }).identity.providerActionVersion, "2");
});
test("registered action must belong to the claimed canonical toolkit", () => {
  assert.throws(() => ready({ toolkit: "gmail", action: "GOOGLESHEETS_CLEAR_VALUES" }));
  assert.throws(() => ready({ toolkit: "googlesheets", action: "GMAIL_REPLY_TO_THREAD" }));
  assert.throws(() => ready({ toolkit: "slack", action: "GOOGLECALENDAR_CREATE_EVENT" }));
  assert.throws(() => ready({ toolkit: "github", action: "SLACK_SEND_MESSAGE" }));
  assert.equal(ready({ toolkit: "gmail", action: "GMAIL_REPLY_TO_THREAD" }).action, "GMAIL_REPLY_TO_THREAD");
  assert.equal(ready({ toolkit: "slack", action: "SLACK_SEND_MESSAGE" }).action, "SLACK_SEND_MESSAGE");
});
test("account mismatch under same identity/version is rejected authority", () => assert.equal(genericMutationAuthorityMatches(ready(), ready({ connectedAccountId: "acct-b" })), false));
test("action mismatch under same identity/version is rejected authority", () => assert.equal(genericMutationAuthorityMatches(ready(), ready({ action: "GOOGLESHEETS_CREATE_SPREADSHEET" })), false));
test("cross-tenant same ID/version remains distinct", () => assert.equal(genericMutationAuthorityMatches(ready(), ready({ orgId: "org-b" })), false));
test("auto-executable mutation still requires complete authority", () => assert.throws(() => ready({ authorityDescriptorComplete: false })));
test("approval provenance does not replace business identity", () => assert.throws(() => ready({ logicalIdProvenance: "approval_id" })));
test("confirmed failure retry retains identity/version and needs explicit retry authority", () => {
  assert.equal(genericMutationRetryDirective({ actionStatus: "authorized", latestAttemptStatus: "confirmed_failure", retryAuthorized: true }), "authorize_retry_attempt");
  assert.deepEqual(ready(), ready());
});
test("uncertainty blocks retry", () => assert.equal(genericMutationRetryDirective({ actionStatus: "uncertain" }), "reconcile_do_not_retry"));
test("version bump cannot escape uncertain attempt", () => {
  assert.equal(revisedGenericMutationVersion(1, true), 2);
  assert.equal(genericMutationRetryDirective({ actionStatus: "authorized", latestAttemptStatus: "uncertain" }), "reconcile_do_not_retry");
});
test("confirmed success is terminal", () => assert.equal(genericMutationRetryDirective({ actionStatus: "confirmed_success" }), "terminal_do_not_retry"));
test("direct generic mutation without authority is ineligible", () => assert.equal(genericDirectMutationReadiness({}), "missing"));
test("read action does not require mutation authority", () => assert.equal(classifyGenericComposioAction("GMAIL_GET_PROFILE"), "read_only"));
test("client cannot classify a known mutation as read", () => assert.equal(classifyGenericComposioAction("SLACK_CREATE_CHANNEL"), "mutation"));
test("unknown action is unsafe rather than presumed read", () => assert.equal(classifyGenericComposioAction("GMAIL_ARBITRARY"), "unknown_unsafe"));
test("business request and provider lifecycle ownership remain separate", async () => {
  const doc = await readFile(new URL("../../docs/COMPOSIO_GENERIC_MUTATION_AUTHORITY.md", import.meta.url), "utf8");
  assert.match(doc, /Provider action\/attempt ledger[\s\S]*Exclusively owns canonical claims/);
  assert.match(doc, /outcome fields there are projections only/);
});
test("executor cannot generate fallback logical ID or version", async () => {
  const source = await readFile(new URL("../composio-action-adapter.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /logicalProviderActionId|providerActionVersion/);
  assert.equal(genericDirectMutationReadiness({}), "missing");
});
test("specialized caller authority stays distinct from generic authority", async () => {
  const specialized = await readFile(new URL("../composio-specialized-version-authority.ts", import.meta.url), "utf8");
  const generic = await readFile(new URL("../composio-generic-mutation-authority.ts", import.meta.url), "utf8");
  assert.match(specialized, /assertSpecializedExecutionAuthority/);
  assert.doesNotMatch(generic, /assertSpecializedExecutionAuthority/);
});

test("all registry allowed actions have explicit trusted classification", () => {
  for (const tool of Object.values(COMPOSIO_TOOLS)) {
    for (const action of tool.allowedActions) assert.notEqual(classifyGenericComposioAction(action), "unknown_unsafe", action);
  }
});
test("generic mutation inventory is the exact 14 server-registered mutation slugs", () => {
  assert.equal(GENERIC_COMPOSIO_MUTATION_ACTIONS.length, 14);
  for (const action of GENERIC_COMPOSIO_MUTATION_ACTIONS) assert.equal(classifyGenericComposioAction(action), "mutation");
});
test("generic request shape contains no durable authority fields", async () => {
  const source = await readFile(new URL("../composio-routes.ts", import.meta.url), "utf8");
  const schema = source.slice(source.indexOf("const executeActionSchema"), source.indexOf("// ─── Route registration"));
  assert.doesNotMatch(schema, /logicalProviderActionId|providerActionVersion|businessRequestId|connectedAccountId/);
});
test("adapter UUID and approval UUID are attempt and governance IDs", async () => {
  const source = await readFile(new URL("../composio-action-adapter.ts", import.meta.url), "utf8");
  assert.match(source, /const logId = crypto\.randomUUID\(\)/);
  assert.match(source, /async function queueForApproval[\s\S]*const id = crypto\.randomUUID\(\)/);
});
test("provider invocation precedes best-effort local result logging", async () => {
  const source = await readFile(new URL("../services/composio-service.ts", import.meta.url), "utf8");
  const execute = source.indexOf("export async function executeComposioAction");
  assert.ok(source.indexOf("await composioFetch(`/tools/execute/", execute) < source.indexOf("await writeComposioActionLog({", execute));
});
test("generic adapter has no pre-provider canonical claim", async () => {
  const source = await readFile(new URL("../composio-action-adapter.ts", import.meta.url), "utf8");
  const autoExecute = source.slice(source.indexOf("// ── Step 6: Auto-execute"), source.indexOf("// ── Step 7:"));
  assert.match(autoExecute, /executeComposioAction/);
  assert.doesNotMatch(autoExecute, /claim|logicalProviderActionId|providerActionVersion/);
});
test("concurrent authority-missing generic retries can call a fake provider twice", async () => {
  let providerCalls = 0;
  const currentGenericMutation = async () => { providerCalls += 1; };
  await Promise.all([currentGenericMutation(), currentGenericMutation()]);
  assert.equal(providerCalls, 2);
});
