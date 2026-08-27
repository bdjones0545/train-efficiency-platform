import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_COMPOSIO_TOOLKITS,
  SPECIALIZED_COMPOSIO_TOOLKITS,
  ComposioIdentityContractError,
  assessSpecializedRequestIdentity,
  authorityMatches,
  callbackDeduplicationKey,
  deriveCanonicalProviderActionIdentity,
  hermesTenantScope,
  mayRetryProviderAction,
  normalizeProviderFamily,
  providerActionIdentityKey,
  requireRequestedConnection,
  requiresReconciliation,
  sameProviderActionIdentity,
  selectAuthorizedConnections,
  type AuthorizedConnection,
  type ProviderActionAuthority,
} from "../composio-action-identity";

const base = {
  orgId: "org-a",
  providerFamily: "GMAIL",
  logicalProviderActionId: "draft-request-1",
  providerActionVersion: "v1",
};

const identity = () => deriveCanonicalProviderActionIdentity(base);

test("canonical identity normalizes toolkit as provider family", () => {
  assert.equal(identity().providerFamily, "gmail");
});

test("canonical toolkit namespace is the exact repository-evidenced set", () => {
  assert.deepEqual(CANONICAL_COMPOSIO_TOOLKITS, [
    "gmail", "googlecalendar", "slack", "googlesheets", "github", "stripe",
  ]);
});

for (const toolkit of CANONICAL_COMPOSIO_TOOLKITS) {
  test(`${toolkit} accepts lowercase, uppercase, and surrounding whitespace`, () => {
    assert.equal(normalizeProviderFamily(toolkit), toolkit);
    assert.equal(normalizeProviderFamily(toolkit.toUpperCase()), toolkit);
    assert.equal(normalizeProviderFamily(`  ${toolkit}  `), toolkit);
  });
}

test("friendly and separator aliases are rejected", () => {
  const aliases = [
    "Google Gmail", "google_gmail", "google-gmail",
    "google calendar", "google-calendar", "google_calendar",
    "Google Sheets", "google-sheets", "google_sheets",
    "Git Hub", "github.com",
  ];
  for (const alias of aliases) {
    assert.throws(() => normalizeProviderFamily(alias), ComposioIdentityContractError);
  }
});

test("unknown nonblank toolkits are rejected", () => {
  for (const unknown of ["notion", "salesforce", "unknown", "arbitrary-provider"]) {
    assert.throws(() => normalizeProviderFamily(unknown), ComposioIdentityContractError);
  }
});

test("empty and whitespace-only toolkit values are rejected", () => {
  assert.throws(() => normalizeProviderFamily(""), ComposioIdentityContractError);
  assert.throws(() => normalizeProviderFamily("   "), ComposioIdentityContractError);
});

test("GMAIL casing variants converge on the same identity", () => {
  const upper = deriveCanonicalProviderActionIdentity({ ...base, providerFamily: "GMAIL" });
  const lower = deriveCanonicalProviderActionIdentity({ ...base, providerFamily: "gmail" });
  assert.equal(sameProviderActionIdentity(upper, lower), true);
});

test("GoogleCalendar trim and casing variants converge on the same identity", () => {
  const mixed = deriveCanonicalProviderActionIdentity({ ...base, providerFamily: " GoogleCalendar " });
  const canonical = deriveCanonicalProviderActionIdentity({ ...base, providerFamily: "googlecalendar" });
  assert.equal(sameProviderActionIdentity(mixed, canonical), true);
});

test("an alias cannot construct a canonical provider-action identity", () => {
  assert.throws(
    () => deriveCanonicalProviderActionIdentity({ ...base, providerFamily: "google-calendar" }),
    ComposioIdentityContractError,
  );
});

test("tenant is part of canonical provider-action identity", () => {
  const other = deriveCanonicalProviderActionIdentity({ ...base, orgId: "org-b" });
  assert.equal(sameProviderActionIdentity(identity(), other), false);
});

test("logical action ID is stable across retries", () => {
  assert.equal(providerActionIdentityKey(identity()), providerActionIdentityKey(identity()));
});

test("different action version is a distinct canonical identity", () => {
  const v2 = deriveCanonicalProviderActionIdentity({ ...base, providerActionVersion: "v2" });
  assert.equal(sameProviderActionIdentity(identity(), v2), false);
});

test("different logical IDs remain distinct despite identical provider payload", () => {
  const later = deriveCanonicalProviderActionIdentity({ ...base, logicalProviderActionId: "draft-request-2" });
  assert.equal(sameProviderActionIdentity(identity(), later), false);
});

test("generic action identity fields are mandatory and never synthesized", () => {
  for (const field of ["orgId", "providerFamily", "logicalProviderActionId", "providerActionVersion"] as const) {
    assert.throws(
      () => deriveCanonicalProviderActionIdentity({ ...base, [field]: " " }),
      ComposioIdentityContractError,
    );
  }
});

const authority = (overrides: Partial<ProviderActionAuthority> = {}): ProviderActionAuthority => ({
  identity: identity(),
  tool: "GMAIL",
  action: "GMAIL_CREATE_EMAIL_DRAFT",
  connectedAccountId: "acct-a",
  argumentsVersion: "payload-v1",
  approvalId: "approval-1",
  approvingPrincipalId: "admin-1",
  ...overrides,
});

test("same identity, tool, account, arguments, and approval is the same authority", () => {
  assert.equal(authorityMatches(authority(), authority()), true);
});

test("changed connected account cannot reuse authority", () => {
  assert.equal(authorityMatches(authority(), authority({ connectedAccountId: "acct-b" })), false);
});

test("changed tool or action cannot reuse authority", () => {
  assert.equal(authorityMatches(authority(), authority({ tool: "SLACK" })), false);
  assert.equal(authorityMatches(authority(), authority({ action: "GMAIL_REPLY_TO_THREAD" })), false);
});

test("changed arguments version cannot reuse approval", () => {
  assert.equal(authorityMatches(authority(), authority({ argumentsVersion: "payload-v2" })), false);
});

test("attempt identity does not enter canonical logical identity", () => {
  const firstAttempt = callbackDeduplicationKey({ canonicalIdentity: identity(), attemptId: "attempt-1", providerEventId: "event-1" });
  const retryAttempt = callbackDeduplicationKey({ canonicalIdentity: identity(), attemptId: "attempt-2", providerEventId: "event-2" });
  assert.notEqual(firstAttempt, retryAttempt);
  assert.equal(providerActionIdentityKey(identity()), providerActionIdentityKey(identity()));
});

test("confirmed failure may retry under the same identity", () => {
  assert.equal(mayRetryProviderAction("confirmed_failure"), true);
  assert.equal(mayRetryProviderAction("authorized"), true);
});

test("uncertain outcome prohibits blind retry and requires reconciliation", () => {
  assert.equal(mayRetryProviderAction("uncertain"), false);
  assert.equal(requiresReconciliation("uncertain"), true);
  assert.equal(requiresReconciliation("invocation_in_progress"), true);
  assert.equal(requiresReconciliation("provider_accepted"), true);
});

test("confirmed success, rejection, and cancellation are not retryable", () => {
  assert.equal(mayRetryProviderAction("confirmed_success"), false);
  assert.equal(mayRetryProviderAction("rejected"), false);
  assert.equal(mayRetryProviderAction("cancelled"), false);
});

for (const family of ["gmail_draft", "slack_alert", "calendar", "github_issue"] as const) {
  test(`${family} durable request ID is logical-ID eligible but current version is missing`, () => {
    const result = assessSpecializedRequestIdentity({ family, durableId: `${family}-1`, orgId: "org-a" });
    assert.equal(result.logicalProviderActionIdEligible, true);
    assert.equal(result.stableAcrossRetry, true);
    assert.equal(result.oneIdMayRepresentMultipleMutations, false);
    assert.equal(result.providerActionVersionAvailable, false);
  });
}

test("specialized mapping becomes complete only with explicit version and source", () => {
  const result = assessSpecializedRequestIdentity({
    family: "gmail_draft", durableId: "request-1", orgId: "org-a",
    providerActionVersion: "v1", providerActionVersionSource: "immutable approved payload revision",
  });
  assert.equal(result.providerActionVersionAvailable, true);
  assert.equal(result.providerActionVersionSource, "immutable approved payload revision");
});

test("specialized request families map only to canonical repository toolkit slugs", () => {
  assert.deepEqual(SPECIALIZED_COMPOSIO_TOOLKITS, {
    gmail_draft: "gmail",
    slack_alert: "slack",
    calendar: "googlecalendar",
    github_issue: "github",
  });
  for (const [family, providerFamily] of Object.entries(SPECIALIZED_COMPOSIO_TOOLKITS)) {
    const result = assessSpecializedRequestIdentity({
      family: family as keyof typeof SPECIALIZED_COMPOSIO_TOOLKITS,
      durableId: `${family}-1`,
      orgId: "org-a",
    });
    assert.equal(result.providerFamily, normalizeProviderFamily(providerFamily));
  }
});

const connections: AuthorizedConnection[] = [
  { id: "acct-a", providerFamily: "gmail", ownership: "organization", orgId: "org-a", active: true },
  { id: "acct-b", providerFamily: "gmail", ownership: "organization", orgId: "org-b", active: true },
  { id: "inactive", providerFamily: "gmail", ownership: "organization", orgId: "org-a", active: false },
  { id: "shared", providerFamily: "gmail", ownership: "platform", active: true, platformPolicyAllowsOrgIds: ["org-a"] },
  { id: "implicit-global", providerFamily: "gmail", ownership: "platform", active: true },
];

test("organization sees only its active connection and explicitly allowed platform connection", () => {
  assert.deepEqual(selectAuthorizedConnections(connections, "org-a", "GMAIL").map(c => c.id), ["acct-a", "shared"]);
});

test("cross-tenant requested connection substitution fails", () => {
  assert.throws(() => requireRequestedConnection(connections, "org-a", "gmail", "acct-b"), ComposioIdentityContractError);
});

test("first global active connection is never implicit authority", () => {
  assert.equal(selectAuthorizedConnections(connections, "org-b", "gmail").some(c => c.id === "implicit-global"), false);
});

test("connection toolkit must match the provider family", () => {
  assert.throws(() => requireRequestedConnection(connections, "org-a", "slack", "acct-a"), ComposioIdentityContractError);
});

test("status visibility uses the same tenant-authorized connection selection", () => {
  const visible = selectAuthorizedConnections(connections, "org-b", "gmail");
  assert.deepEqual(visible.map(c => c.id), ["acct-b"]);
});

test("Hermes unresolved organization fails closed to no scope", () => {
  assert.equal(hermesTenantScope(undefined), null);
  assert.equal(hermesTenantScope("  "), null);
  assert.equal(hermesTenantScope("org-a"), "org-a");
});

test("duplicate callback identity converges on canonical action, attempt, and event", () => {
  const callback = { canonicalIdentity: identity(), attemptId: "attempt-1", providerEventId: "event-1" };
  assert.equal(callbackDeduplicationKey(callback), callbackDeduplicationKey(callback));
  assert.notEqual(callbackDeduplicationKey(callback), callbackDeduplicationKey({ ...callback, providerEventId: "event-2" }));
});
