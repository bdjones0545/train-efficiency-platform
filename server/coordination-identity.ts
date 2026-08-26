/**
 * Pure Cross-Agent Coordination identity contract.
 *
 * This module intentionally has no database or runtime-service integration.
 * It encodes the approved product contract that a future migration and runtime
 * implementation must follow.
 */

export type CoordinationResourceType = "prospect" | "lead" | "gmail_thread";
export type CoordinationLifecycleStatus = "active" | "resolved";
export type CoordinationResultLabel = "created" | "deduplicated" | "merged";

export interface CoordinationIdentityInput {
  orgId: string;
  actionType: string;
  coordinationGeneration: string;
  prospectId?: string;
  leadId?: string;
  gmailThreadId?: string;
  sourceConversationId?: string;
  sourceConversationType?: "gmail";
  agentName?: string;
  sourceActionId?: string;
}

export interface CanonicalCoordinationIdentity {
  orgId: string;
  actionType: string;
  resourceType: CoordinationResourceType;
  resourceId: string;
  coordinationGeneration: string;
}

export class CoordinationIdentityContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoordinationIdentityContractError";
  }
}

function required(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new CoordinationIdentityContractError(`${field} is required`);
  return normalized;
}

export function deriveCanonicalCoordinationIdentity(
  input: CoordinationIdentityInput,
): CanonicalCoordinationIdentity {
  const orgId = required(input.orgId, "orgId");
  const actionType = required(input.actionType, "actionType");
  const coordinationGeneration = required(
    input.coordinationGeneration,
    "coordinationGeneration",
  );
  const prospectId = input.prospectId?.trim() || undefined;
  const leadId = input.leadId?.trim() || undefined;

  if (prospectId && leadId) {
    throw new CoordinationIdentityContractError(
      "prospectId and leadId are distinct resources; the caller must choose one canonical resource",
    );
  }

  let resourceType: CoordinationResourceType;
  let resourceId: string;
  if (prospectId) {
    resourceType = "prospect";
    resourceId = prospectId;
  } else if (leadId) {
    resourceType = "lead";
    resourceId = leadId;
  } else if (input.gmailThreadId?.trim()) {
    resourceType = "gmail_thread";
    resourceId = input.gmailThreadId.trim();
  } else if (
    input.sourceConversationType === "gmail" &&
    input.sourceConversationId?.trim()
  ) {
    resourceType = "gmail_thread";
    resourceId = input.sourceConversationId.trim();
  } else {
    throw new CoordinationIdentityContractError(
      "a typed canonical business resource or Gmail conversation is required",
    );
  }

  return { orgId, actionType, resourceType, resourceId, coordinationGeneration };
}

export function coordinationIdentityKey(identity: CanonicalCoordinationIdentity): string {
  return JSON.stringify([
    identity.orgId,
    identity.actionType,
    identity.resourceType,
    identity.resourceId,
    identity.coordinationGeneration,
  ]);
}

export function sameCoordinationIdentity(
  left: CanonicalCoordinationIdentity,
  right: CanonicalCoordinationIdentity,
): boolean {
  return coordinationIdentityKey(left) === coordinationIdentityKey(right);
}

export function isSameActiveCoordination(
  existing: { identity: CanonicalCoordinationIdentity; status: CoordinationLifecycleStatus },
  incoming: CanonicalCoordinationIdentity,
): boolean {
  return existing.status === "active" && sameCoordinationIdentity(existing.identity, incoming);
}

export function addDistinctSupportingAgent(
  sourceAgents: readonly string[],
  agentName: string,
): { sourceAgents: string[]; supportScore: number } {
  const agent = required(agentName, "agentName");
  const unique = new Set(sourceAgents.map(value => value.trim()).filter(Boolean));
  unique.add(agent);
  const result = [...unique];
  return { sourceAgents: result, supportScore: result.length };
}

export function coordinationResult(
  registryId: string,
  created: boolean,
  supportScore: number,
): { action: CoordinationResultLabel; actionId: string; supportScore: number } {
  const actionId = required(registryId, "registryId");
  if (!Number.isInteger(supportScore) || supportScore < 1) {
    throw new CoordinationIdentityContractError("supportScore must be a positive integer");
  }
  const action: CoordinationResultLabel = created
    ? "created"
    : supportScore > 2
      ? "merged"
      : "deduplicated";
  return { action, actionId, supportScore };
}
