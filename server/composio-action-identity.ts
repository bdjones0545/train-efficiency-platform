/**
 * Pure Composio provider-action identity and authority contract.
 *
 * This module deliberately performs no database, HTTP, provider, or runtime
 * service work. Future persistence and execution paths must implement these
 * rules without synthesizing caller-owned identity or authority.
 */

export type ProviderActionLifecycle =
  | "authorized"
  | "attempt_authorized"
  | "invocation_in_progress"
  | "provider_accepted"
  | "confirmed_success"
  | "confirmed_failure"
  | "uncertain"
  | "rejected"
  | "cancelled";

export type ConnectionOwnership = "organization" | "platform";

export const CANONICAL_COMPOSIO_TOOLKITS = [
  "gmail",
  "googlecalendar",
  "slack",
  "googlesheets",
  "github",
  "stripe",
] as const;

export type CanonicalComposioToolkit = typeof CANONICAL_COMPOSIO_TOOLKITS[number];

export const SPECIALIZED_COMPOSIO_TOOLKITS = {
  gmail_draft: "gmail",
  slack_alert: "slack",
  calendar: "googlecalendar",
  github_issue: "github",
} as const satisfies Record<string, CanonicalComposioToolkit>;

export interface ProviderActionIdentityInput {
  orgId: string;
  providerFamily: string;
  logicalProviderActionId: string;
  providerActionVersion: string;
}

export interface CanonicalProviderActionIdentity {
  orgId: string;
  providerFamily: CanonicalComposioToolkit;
  logicalProviderActionId: string;
  providerActionVersion: string;
}

export interface ProviderActionAuthority {
  identity: CanonicalProviderActionIdentity;
  tool: string;
  action: string;
  connectedAccountId: string;
  argumentsVersion: string;
  approvalId?: string;
  approvingPrincipalId?: string;
}

export interface AuthorizedConnection {
  id: string;
  providerFamily: string;
  ownership: ConnectionOwnership;
  orgId?: string;
  active: boolean;
  platformPolicyAllowsOrgIds?: readonly string[];
}

export interface SpecializedRequestIdentityAssessment {
  family: keyof typeof SPECIALIZED_COMPOSIO_TOOLKITS;
  providerFamily: CanonicalComposioToolkit;
  durableId: string;
  orgId: string;
  logicalProviderActionIdEligible: true;
  stableAcrossRetry: true;
  oneIdMayRepresentMultipleMutations: false;
  providerActionVersionAvailable: boolean;
  providerActionVersionSource?: string;
}

export class ComposioIdentityContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposioIdentityContractError";
  }
}

function required(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new ComposioIdentityContractError(`${field} is required`);
  return normalized;
}

export function normalizeProviderFamily(value: string): CanonicalComposioToolkit {
  const normalized = required(value, "providerFamily").toLowerCase();
  if (!CANONICAL_COMPOSIO_TOOLKITS.includes(normalized as CanonicalComposioToolkit)) {
    throw new ComposioIdentityContractError(
      `providerFamily must be a canonical Composio toolkit slug: ${CANONICAL_COMPOSIO_TOOLKITS.join(", ")}`,
    );
  }
  return normalized as CanonicalComposioToolkit;
}

export function deriveCanonicalProviderActionIdentity(
  input: ProviderActionIdentityInput,
): CanonicalProviderActionIdentity {
  return {
    orgId: required(input.orgId, "orgId"),
    providerFamily: normalizeProviderFamily(input.providerFamily),
    logicalProviderActionId: required(
      input.logicalProviderActionId,
      "logicalProviderActionId",
    ),
    providerActionVersion: required(
      input.providerActionVersion,
      "providerActionVersion",
    ),
  };
}

export function providerActionIdentityKey(
  identity: CanonicalProviderActionIdentity,
): string {
  return JSON.stringify([
    identity.orgId,
    identity.providerFamily,
    identity.logicalProviderActionId,
    identity.providerActionVersion,
  ]);
}

export function sameProviderActionIdentity(
  left: CanonicalProviderActionIdentity,
  right: CanonicalProviderActionIdentity,
): boolean {
  return providerActionIdentityKey(left) === providerActionIdentityKey(right);
}

export function authorityMatches(
  approved: ProviderActionAuthority,
  requested: ProviderActionAuthority,
): boolean {
  return sameProviderActionIdentity(approved.identity, requested.identity)
    && approved.tool === requested.tool
    && approved.action === requested.action
    && approved.connectedAccountId === requested.connectedAccountId
    && approved.argumentsVersion === requested.argumentsVersion
    && approved.approvalId === requested.approvalId
    && approved.approvingPrincipalId === requested.approvingPrincipalId;
}

export function mayRetryProviderAction(status: ProviderActionLifecycle): boolean {
  return status === "authorized" || status === "confirmed_failure";
}

export function requiresReconciliation(status: ProviderActionLifecycle): boolean {
  return status === "invocation_in_progress"
    || status === "provider_accepted"
    || status === "uncertain";
}

export function isConnectionAuthorizedForOrg(
  connection: AuthorizedConnection,
  orgId: string,
  providerFamily: string,
): boolean {
  const tenant = required(orgId, "orgId");
  const family = normalizeProviderFamily(providerFamily);
  if (!connection.active || normalizeProviderFamily(connection.providerFamily) !== family) return false;
  if (connection.ownership === "organization") return connection.orgId === tenant;
  return connection.platformPolicyAllowsOrgIds?.includes(tenant) === true;
}

export function selectAuthorizedConnections(
  connections: readonly AuthorizedConnection[],
  orgId: string,
  providerFamily: string,
): AuthorizedConnection[] {
  return connections.filter(connection =>
    isConnectionAuthorizedForOrg(connection, orgId, providerFamily),
  );
}

export function requireRequestedConnection(
  connections: readonly AuthorizedConnection[],
  orgId: string,
  providerFamily: string,
  requestedConnectionId: string,
): AuthorizedConnection {
  const requestedId = required(requestedConnectionId, "requestedConnectionId");
  const match = connections.find(connection => connection.id === requestedId);
  if (!match || !isConnectionAuthorizedForOrg(match, orgId, providerFamily)) {
    throw new ComposioIdentityContractError(
      "requested connected account is not authorized for this organization and provider family",
    );
  }
  return match;
}

export function assessSpecializedRequestIdentity(input: {
  family: SpecializedRequestIdentityAssessment["family"];
  durableId: string;
  orgId: string;
  providerActionVersion?: string;
  providerActionVersionSource?: string;
}): SpecializedRequestIdentityAssessment {
  const version = input.providerActionVersion?.trim();
  return {
    family: input.family,
    providerFamily: normalizeProviderFamily(SPECIALIZED_COMPOSIO_TOOLKITS[input.family]),
    durableId: required(input.durableId, "durableId"),
    orgId: required(input.orgId, "orgId"),
    logicalProviderActionIdEligible: true,
    stableAcrossRetry: true,
    oneIdMayRepresentMultipleMutations: false,
    providerActionVersionAvailable: Boolean(version),
    ...(version
      ? { providerActionVersionSource: required(input.providerActionVersionSource, "providerActionVersionSource") }
      : {}),
  };
}

export function callbackDeduplicationKey(input: {
  canonicalIdentity: CanonicalProviderActionIdentity;
  attemptId: string;
  providerEventId: string;
}): string {
  return JSON.stringify([
    providerActionIdentityKey(input.canonicalIdentity),
    required(input.attemptId, "attemptId"),
    required(input.providerEventId, "providerEventId"),
  ]);
}

export function hermesTenantScope(resolvedOrgId: string | undefined): string | null {
  return resolvedOrgId?.trim() || null;
}
