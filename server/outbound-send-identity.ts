/**
 * Pure outbound communication identity and lifecycle contract.
 *
 * This module deliberately performs no database or provider I/O. Production
 * send paths are not wired to it during the contract phase.
 */

export const OUTBOUND_SEND_CLASSES = [
  "transactional",
  "human_approved",
  "automated_outreach",
  "direct_agent",
] as const;

export type OutboundSendClass = (typeof OUTBOUND_SEND_CLASSES)[number];
export type HumanApprovalAuthorityType = "agentmail_reply_queue" | "gmail_action" | (string & {});

export interface LogicalSendIdentityInput {
  orgId: string;
  sendClass: OutboundSendClass;
  logicalSendId: string;
}

export interface LogicalSendIdentity {
  orgId: string;
  sendClass: OutboundSendClass;
  logicalSendId: string;
}

export interface HumanApprovedSendIdentityInput extends LogicalSendIdentityInput {
  sendClass: "human_approved";
  authorityType: HumanApprovalAuthorityType;
  authorityId: string;
  approvedPayloadVersion: string;
}

export interface HumanApprovedSendIdentity extends LogicalSendIdentity {
  sendClass: "human_approved";
  authorityType: HumanApprovalAuthorityType;
  authorityId: string;
  approvedPayloadVersion: string;
}

export type ProviderAttemptOutcome =
  | "not_started"
  | "in_progress"
  | "confirmed_failure"
  | "confirmed_success"
  | "unknown";

export type LogicalSendDisposition =
  | "claimed"
  | "suppressed"
  | "provider_confirmed_success"
  | "provider_confirmed_failure"
  | "uncertain_provider_outcome";

export class OutboundSendContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundSendContractError";
  }
}

const SYNTHETIC_TENANTS = new Set(["default", "global", "unknown", "unscoped"]);

function required(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new OutboundSendContractError(`${field} is required`);
  return normalized;
}

function tenant(value: string): string {
  const normalized = required(value, "orgId");
  if (SYNTHETIC_TENANTS.has(normalized.toLowerCase())) {
    throw new OutboundSendContractError("orgId must identify a real tenant");
  }
  return normalized;
}

export function deriveLogicalSendIdentity(input: LogicalSendIdentityInput): LogicalSendIdentity {
  if (!OUTBOUND_SEND_CLASSES.includes(input.sendClass)) {
    throw new OutboundSendContractError("sendClass is not supported");
  }
  return {
    orgId: tenant(input.orgId),
    sendClass: input.sendClass,
    logicalSendId: required(input.logicalSendId, "logicalSendId"),
  };
}

export function logicalSendIdentityKey(identity: LogicalSendIdentity): string {
  return JSON.stringify([identity.orgId, identity.sendClass, identity.logicalSendId]);
}

export function sameLogicalSend(left: LogicalSendIdentity, right: LogicalSendIdentity): boolean {
  return logicalSendIdentityKey(left) === logicalSendIdentityKey(right);
}

export function deriveHumanApprovedSendIdentity(
  input: HumanApprovedSendIdentityInput,
): HumanApprovedSendIdentity {
  const logical = deriveLogicalSendIdentity(input);
  return {
    ...logical,
    sendClass: "human_approved",
    authorityType: required(input.authorityType, "authorityType"),
    authorityId: required(input.authorityId, "authorityId"),
    approvedPayloadVersion: required(input.approvedPayloadVersion, "approvedPayloadVersion"),
  };
}

export function humanApprovedIdentityKey(identity: HumanApprovedSendIdentity): string {
  return JSON.stringify([
    identity.orgId,
    identity.authorityType,
    identity.authorityId,
    identity.logicalSendId,
    identity.approvedPayloadVersion,
  ]);
}

export function sameHumanApprovedSend(
  left: HumanApprovedSendIdentity,
  right: HumanApprovedSendIdentity,
): boolean {
  return humanApprovedIdentityKey(left) === humanApprovedIdentityKey(right);
}

export function mayAttemptProvider(
  outcome: ProviderAttemptOutcome,
  retryPermitted: boolean,
): boolean {
  switch (outcome) {
    case "not_started":
      return true;
    case "confirmed_failure":
      return retryPermitted;
    case "in_progress":
    case "confirmed_success":
    case "unknown":
      return false;
  }
}

export function dispositionForProviderOutcome(
  outcome: ProviderAttemptOutcome,
): LogicalSendDisposition {
  switch (outcome) {
    case "not_started":
    case "in_progress":
      return "claimed";
    case "confirmed_failure":
      return "provider_confirmed_failure";
    case "confirmed_success":
      return "provider_confirmed_success";
    case "unknown":
      return "uncertain_provider_outcome";
  }
}
