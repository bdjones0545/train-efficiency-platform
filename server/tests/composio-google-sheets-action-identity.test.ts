import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  GOOGLE_SHEETS_MUTATION_ACTIONS,
  GoogleSheetsIdentityContractError,
  assessCurrentGenericSheetsCaller,
  assertCurrentSheetsVersion,
  canonicalGoogleSheetsToolkit,
  classifyGoogleSheetsAction,
  requireGoogleSheetsMutationIdentity,
  requiredSheetsVersion,
  sheetsAuthorityMatches,
  sheetsRetryDirective,
  type SheetsMutationIdentityInput,
  type SheetsIdentityProvenance,
} from "../composio-google-sheets-action-identity";

const ready = (overrides: Partial<SheetsMutationIdentityInput> = {}) => requireGoogleSheetsMutationIdentity({
  orgId: "org-a",
  toolkit: "GOOGLESHEETS",
  action: "GOOGLESHEETS_UPDATE_SPREADSHEET_ROW",
  logicalProviderActionId: "request-1",
  logicalIdProvenance: "durable_business_object",
  providerActionVersion: 1,
  connectedAccountId: "acct-a",
  authorityDescriptorComplete: true,
  ...overrides,
});

test("toolkit canonicalizes to googlesheets", () => assert.equal(canonicalGoogleSheetsToolkit(" GOOGLESHEETS "), "googlesheets"));
test("friendly toolkit alias is rejected", () => assert.throws(() => canonicalGoogleSheetsToolkit("Google Sheets")));
test("missing logical ID is rejected", () => assert.throws(() => ready({ logicalProviderActionId: " " }), GoogleSheetsIdentityContractError));
test("missing version is rejected", () => assert.throws(() => ready({ providerActionVersion: undefined }), GoogleSheetsIdentityContractError));
test("zero and unsafe versions are rejected", () => {
  assert.throws(() => ready({ providerActionVersion: 0 }));
  assert.throws(() => ready({ providerActionVersion: Number.MAX_SAFE_INTEGER + 1 }));
});
test("retry retains logical ID and version", () => assert.deepEqual(ready(), ready()));
test("later independent mutation uses a new logical ID", () => assert.notEqual(ready().identity.logicalProviderActionId, ready({ logicalProviderActionId: "request-2" }).identity.logicalProviderActionId));
test("unchanged authority retains version", () => assert.equal(requiredSheetsVersion({ currentVersion: 1, materialAuthorityChanged: false }), 1));
test("material authority revision increments version", () => assert.equal(requiredSheetsVersion({ currentVersion: 1, materialAuthorityChanged: true }), 2));

for (const provenance of ["attempt_id", "provider_receipt", "argument_hash", "time_bucket", "resource_key", "arbitrary_entity_id"] as SheetsIdentityProvenance[]) {
  test(`${provenance} cannot substitute for caller-owned business identity`, () => {
    assert.throws(() => ready({ logicalIdProvenance: provenance }), GoogleSheetsIdentityContractError);
  });
}

test("spreadsheet ID alone is insufficient", () => assert.throws(() => ready({ logicalProviderActionId: "spreadsheet-1", logicalIdProvenance: "resource_key" })));
test("spreadsheet and range are insufficient", () => assert.throws(() => ready({ logicalProviderActionId: "spreadsheet-1:A1:B2", logicalIdProvenance: "resource_key" })));
test("same identity and version cannot switch account", () => assert.equal(sheetsAuthorityMatches(ready(), ready({ connectedAccountId: "acct-b" })), false));
test("same identity and version cannot switch action", () => assert.equal(sheetsAuthorityMatches(ready(), ready({ action: "GOOGLESHEETS_CLEAR_VALUES" })), false));
test("target spreadsheet revision requires a new version", () => assert.equal(requiredSheetsVersion({ currentVersion: 4, materialAuthorityChanged: true }), 5));
test("worksheet revision requires a new version", () => assert.equal(requiredSheetsVersion({ currentVersion: 5, materialAuthorityChanged: true }), 6));
test("range revision requires a new version", () => assert.equal(requiredSheetsVersion({ currentVersion: 6, materialAuthorityChanged: true }), 7));
test("values revision requires a new version", () => assert.equal(requiredSheetsVersion({ currentVersion: 7, materialAuthorityChanged: true }), 8));
test("stale V1 cannot execute after authority advances to V2", () => {
  let providerCalls = 0;
  const invokeIfCurrent = (requestedVersion: number, currentVersion: number) => {
    assertCurrentSheetsVersion({ requestedVersion, currentVersion });
    providerCalls += 1;
  };
  assert.throws(() => invokeIfCurrent(1, 2), GoogleSheetsIdentityContractError);
  assert.equal(providerCalls, 0);
  invokeIfCurrent(2, 2);
  assert.equal(providerCalls, 1);
});
test("same logical ID and version remain tenant-distinct", () => assert.equal(sheetsAuthorityMatches(ready(), ready({ orgId: "org-b" })), false));
test("confirmed failure retry keeps canonical identity and authorizes a new attempt", () => {
  assert.equal(sheetsRetryDirective({ actionStatus: "authorized", latestAttemptStatus: "confirmed_failure", retryAuthorized: true }), "authorize_retry_attempt");
  assert.deepEqual(ready(), ready());
});
test("confirmed success is terminal", () => assert.equal(sheetsRetryDirective({ actionStatus: "confirmed_success" }), "terminal_do_not_retry"));
test("uncertainty blocks retry", () => assert.equal(sheetsRetryDirective({ actionStatus: "uncertain" }), "reconcile_do_not_retry"));
test("version bump cannot escape an uncertain attempt", () => {
  assert.equal(requiredSheetsVersion({ currentVersion: 1, materialAuthorityChanged: true }), 2);
  assert.equal(sheetsRetryDirective({ actionStatus: "authorized", latestAttemptStatus: "uncertain" }), "reconcile_do_not_retry");
});
test("append-style retry retains ID while independent append uses a new ID", () => {
  assert.deepEqual(ready({ action: "GOOGLESHEETS_SHEET_FROM_JSON" }), ready({ action: "GOOGLESHEETS_SHEET_FROM_JSON" }));
  assert.notEqual(ready({ action: "GOOGLESHEETS_SHEET_FROM_JSON" }).identity.logicalProviderActionId,
    ready({ action: "GOOGLESHEETS_SHEET_FROM_JSON", logicalProviderActionId: "append-2" }).identity.logicalProviderActionId);
});
test("create-spreadsheet success remains terminal", () => assert.equal(sheetsRetryDirective({ actionStatus: "confirmed_success" }), "terminal_do_not_retry"));
test("clear still requires canonical identity", () => assert.throws(() => ready({ action: "GOOGLESHEETS_CLEAR_VALUES", logicalProviderActionId: undefined })));
test("complete immutable authority descriptor is mandatory", () => assert.throws(() => ready({ authorityDescriptorComplete: false })));
test("server-side action classification is mandatory", () => assert.throws(() => ready({ action: "GOOGLESHEETS_ARBITRARY_WRITE" })));
test("registry mutation set is exact", () => assert.deepEqual(GOOGLE_SHEETS_MUTATION_ACTIONS, [
  "GOOGLESHEETS_SHEET_FROM_JSON", "GOOGLESHEETS_UPDATE_SPREADSHEET_ROW",
  "GOOGLESHEETS_CREATE_SPREADSHEET", "GOOGLESHEETS_CREATE_GOOGLE_SHEET", "GOOGLESHEETS_CLEAR_VALUES",
]));
test("read-only and unknown actions are not mutation-eligible", () => {
  assert.equal(classifyGoogleSheetsAction("GOOGLESHEETS_BATCH_GET"), "read_only");
  assert.equal(classifyGoogleSheetsAction("GOOGLESHEETS_NOT_REGISTERED"), "unknown");
});
test("current generic caller is BOTH_MISSING", () => assert.equal(assessCurrentGenericSheetsCaller({}), "missing"));

test("generic route source exposes no logical ID or version fields", async () => {
  const source = await readFile(new URL("../composio-routes.ts", import.meta.url), "utf8");
  const schema = source.slice(source.indexOf("const executeActionSchema"), source.indexOf("// ─── Route registration"));
  assert.doesNotMatch(schema, /logicalProviderActionId|providerActionVersion/);
  assert.match(source, /requestComposioAction\(\{\s*orgId,\s*\.\.\.parsed\.data/s);
});
test("adapter generated UUID is attempt/log identity, never caller business identity", async () => {
  const source = await readFile(new URL("../composio-action-adapter.ts", import.meta.url), "utf8");
  assert.match(source, /const logId = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(source, /logicalProviderActionId|providerActionVersion/);
});
test("shared executor calls provider before best-effort result logging", async () => {
  const source = await readFile(new URL("../services/composio-service.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("await composioFetch(`/tools/execute/") < source.indexOf("await writeComposioActionLog({", source.indexOf("export async function executeComposioAction")));
});
test("current duplicate retries have no pre-provider claim and can call a fake provider twice", async () => {
  let providerCalls = 0;
  const currentGenericMutation = async () => { providerCalls += 1; };
  await Promise.all([currentGenericMutation(), currentGenericMutation()]);
  assert.equal(providerCalls, 2);
  assert.equal(assessCurrentGenericSheetsCaller({}), "missing");
});
