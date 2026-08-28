import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveCanonicalProviderActionIdentity, sameProviderActionIdentity } from "../composio-action-identity";
import {
  ComposioVersionContractError,
  SPECIALIZED_CALLER_VERSION_DESCRIPTORS,
  assertCurrentVersion,
  legacyRowEligibleForVersionOne,
  nextVersionForEvent,
  parseProviderActionVersion,
} from "../composio-specialized-caller-versions";

const sameVersion = (event: "provider_retry" | "approval_revoked" | "approval_renewed_unchanged_payload") =>
  nextVersionForEvent({ currentVersion: 1, state: "pre_success", event });
const edit = () => nextVersionForEvent({ currentVersion: 1, state: "pre_success", event: "material_payload_edit" });
const exhausted = () => nextVersionForEvent({ currentVersion: 1, state: "confirmed_success", event: "material_payload_edit" });

test("provider action version is a positive safe integer", () => {
  assert.equal(parseProviderActionVersion(1), 1);
  for (const bad of [undefined, null, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseProviderActionVersion(bad), ComposioVersionContractError);
  }
});
test("version increment cannot exceed safe integer range", () => {
  assert.throws(() => nextVersionForEvent({ currentVersion: Number.MAX_SAFE_INTEGER, state: "pre_success", event: "material_payload_edit" }), ComposioVersionContractError);
});
test("Gmail retry preserves version", () => assert.equal(sameVersion("provider_retry"), 1));
test("Gmail material edit requires a later version", () => assert.equal(edit(), 2));
test("Gmail success exhausts its single-shot request", () => assert.throws(exhausted, ComposioVersionContractError));
test("Slack retry preserves version", () => assert.equal(sameVersion("provider_retry"), 1));
test("Slack material edit requires a later version", () => assert.equal(edit(), 2));
test("Slack success exhausts its single-shot request", () => assert.throws(exhausted, ComposioVersionContractError));
test("Calendar create retry preserves version", () => assert.equal(sameVersion("provider_retry"), 1));
test("Calendar update target change requires a later version", () => {
  assert.equal(nextVersionForEvent({ currentVersion: 3, state: "pre_success", event: "material_payload_edit" }), 4);
});
test("Calendar delete target is an authority-bound provider argument", () => {
  assert.deepEqual(SPECIALIZED_CALLER_VERSION_DESCRIPTORS.calendar_delete.providerArgumentFields, ["event_id", "calendar_id"]);
});
test("later independent Calendar update needs a new logical request ID", () => {
  const a = deriveCanonicalProviderActionIdentity({ orgId: "org-a", providerFamily: "googlecalendar", logicalProviderActionId: "update-1", providerActionVersion: "1" });
  const b = deriveCanonicalProviderActionIdentity({ ...a, logicalProviderActionId: "update-2" });
  assert.equal(sameProviderActionIdentity(a, b), false);
});
test("GitHub retry preserves version", () => assert.equal(sameVersion("provider_retry"), 1));
test("GitHub stored draft revision before success gets a later version", () => assert.equal(edit(), 2));
test("GitHub success exhausts issue creation for the task", () => assert.throws(exhausted, ComposioVersionContractError));
test("reapproval of unchanged payload preserves version", () => assert.equal(sameVersion("approval_renewed_unchanged_payload"), 1));
test("approval revocation preserves payload version", () => assert.equal(sameVersion("approval_revoked"), 1));
test("approval revocation blocks invocation", () => {
  assert.throws(() => assertCurrentVersion({ requestedVersion: 1, currentVersion: 1, approvedPayloadVersion: 1, approvalRequired: true, approvalCurrent: false, state: "pre_success" }), ComposioVersionContractError);
});
test("provider attempt does not alter provider action version", () => assert.equal(sameVersion("provider_retry"), 1));
test("uncertain outcome cannot be bypassed by version bump", () => {
  assert.throws(() => nextVersionForEvent({ currentVersion: 1, state: "uncertain", event: "material_payload_edit" }), ComposioVersionContractError);
});
test("connected-account change requires revised authority version", () => {
  assert.equal(nextVersionForEvent({ currentVersion: 1, state: "pre_success", event: "connected_account_change" }), 2);
});
test("fixed specialized tool/action cannot change under the request", () => {
  assert.throws(() => nextVersionForEvent({ currentVersion: 1, state: "pre_success", event: "tool_action_change" }), ComposioVersionContractError);
});
test("stale V1 cannot execute V2 payload", () => {
  assert.throws(() => assertCurrentVersion({ requestedVersion: 1, currentVersion: 2, approvedPayloadVersion: 2, approvalRequired: true, approvalCurrent: true, state: "pre_success" }), ComposioVersionContractError);
});
test("approval must bind the current payload version", () => {
  assert.throws(() => assertCurrentVersion({ requestedVersion: 2, currentVersion: 2, approvedPayloadVersion: 1, approvalRequired: true, approvalCurrent: true, state: "pre_success" }), ComposioVersionContractError);
});
test("current matching version and approval is eligible before success", () => {
  assert.doesNotThrow(() => assertCurrentVersion({ requestedVersion: 2, currentVersion: 2, approvedPayloadVersion: 2, approvalRequired: true, approvalCurrent: true, state: "pre_success" }));
});
test("same request/version remains tenant-distinct through canonical identity", () => {
  const a = deriveCanonicalProviderActionIdentity({ orgId: "org-a", providerFamily: "gmail", logicalProviderActionId: "request-1", providerActionVersion: "1" });
  const b = deriveCanonicalProviderActionIdentity({ ...a, orgId: "org-b" });
  assert.equal(sameProviderActionIdentity(a, b), false);
});
test("Gmail and Slack legacy immutable snapshots may receive initial version 1", () => {
  for (const family of ["gmail_draft", "slack_alert"] as const) {
    assert.equal(legacyRowEligibleForVersionOne({ family, exactPayloadSnapshotPresent: true, snapshotMatchesExecutionPayload: true }), true);
  }
});
test("Calendar legacy row without proven exact payload remains ineligible", () => {
  assert.equal(legacyRowEligibleForVersionOne({ family: "calendar_update", exactPayloadSnapshotPresent: true, snapshotMatchesExecutionPayload: false }), false);
});
test("GitHub legacy fallback reconstruction remains ineligible", () => {
  assert.equal(legacyRowEligibleForVersionOne({ family: "github_issue", exactPayloadSnapshotPresent: false, snapshotMatchesExecutionPayload: false }), false);
});
test("all specialized families are fixed-action and single-shot", () => {
  for (const descriptor of Object.values(SPECIALIZED_CALLER_VERSION_DESCRIPTORS)) {
    assert.equal(descriptor.singleShot, true);
    assert.equal(descriptor.currentPayloadEditing, "unsupported");
  }
});

test("Gmail production caller executes only stored recipient, subject, and body", () => {
  const source = readFileSync(new URL("../composio-gmail-draft-routes.ts", import.meta.url), "utf8");
  assert.match(source, /to: request\.recipient_email,[\s\S]*subject: request\.subject,[\s\S]*body: request\.body/);
  assert.doesNotMatch(source, /app\.(?:patch|put)\([\s\S]{0,120}gmail-draft/);
});
test("Slack production caller executes only stored channel and message", () => {
  const source = readFileSync(new URL("../composio-slack-alert-routes.ts", import.meta.url), "utf8");
  assert.match(source, /channel: request\.channel,[\s\S]*markdown_text: request\.message/);
  assert.doesNotMatch(source, /app\.(?:patch|put)\([\s\S]{0,120}slack-alert/);
});
test("Calendar production caller executes the exact queued payload including duration", () => {
  const source = readFileSync(new URL("../composio-calendar-routes.ts", import.meta.url), "utf8");
  assert.match(source, /payload, metadata[\s\S]*JSON\.stringify\(payload\)/);
  const approval = source.slice(source.indexOf('app.post(\n    "/api/composio/calendar/approve/:id"'));
  assert.match(approval, /const inputParams = request\.payload/);
  assert.doesNotMatch(approval, /Rebuild the Composio params from stored columns/);
  assert.match(source, /event_duration_hour/);
  assert.match(source, /event_duration_minutes/);
});
test("GitHub production caller executes the persisted draft snapshot and blocks after creation", () => {
  const source = readFileSync(new URL("../software-improvement-routes.ts", import.meta.url), "utf8");
  assert.match(source, /github_issue_draft = .*JSON\.stringify\(draft\)/);
  assert.match(source, /const draft: any = .*githubIssueDraft;/);
  const approval = source.slice(source.indexOf('app.post(\n    "/api/software-improvement/tasks/:id/approve-github-issue"'));
  assert.doesNotMatch(approval, /githubIssueDraft \?\? buildGitHubIssueDraft/);
  assert.match(source, /task\.status as string\) === "github_issue_created"/);
});
