/**
 * Kevin Emergency Handler — Step 16
 *
 * Kevin responds correctly to all 8 emergency conditions returned by TE.
 * When an emergency condition is active:
 *   - Stop all new writes
 *   - Do not bypass the restriction
 *   - Do not retry
 *   - Clearly report the control
 *   - Preserve safe read-only functionality when permitted
 */

import { obsEmergencyControl } from "./observability";

export type EmergencyCondition =
  | "global_kill"
  | "org_kill"
  | "capability_kill"
  | "read_only_mode"
  | "circuit_breaker_open"
  | "credentials_revoked"
  | "email_auto_disabled"
  | "agent_delegation_paused";

export interface EmergencyResponse {
  condition: EmergencyCondition;
  description: string;
  halted: boolean;
  readOnlyAllowed: boolean;
  retryAllowed: boolean;
  userMessage: string;
  actionBlock: {
    type: "warning" | "policy_denial" | "failure";
    title: string;
    summary: string;
    severity?: "high";
  };
}

const EMERGENCY_POLICIES: Record<EmergencyCondition, Omit<EmergencyResponse, "condition">> = {
  global_kill: {
    description: "Global kill switch is active — all Kevin operations are halted.",
    halted: true,
    readOnlyAllowed: false,
    retryAllowed: false,
    userMessage: "TrainEfficiency has activated a global emergency stop. All Kevin operations are paused until the administrator clears the stop.",
    actionBlock: { type: "warning", title: "Global Emergency Stop Active", summary: "All Kevin operations are paused. No new writes, reads, or delegations may proceed.", severity: "high" },
  },
  org_kill: {
    description: "Organization-level kill switch is active for this org.",
    halted: true,
    readOnlyAllowed: false,
    retryAllowed: false,
    userMessage: "Your organization's Kevin access has been paused. Contact your administrator.",
    actionBlock: { type: "warning", title: "Org Emergency Stop Active", summary: "Kevin operations for this organization are paused.", severity: "high" },
  },
  capability_kill: {
    description: "A specific capability has been disabled by an emergency kill switch.",
    halted: true,
    readOnlyAllowed: true,
    retryAllowed: false,
    userMessage: "This specific action is temporarily disabled. Other read-only operations remain available.",
    actionBlock: { type: "policy_denial", title: "Capability Disabled", summary: "This capability is temporarily disabled by an emergency control. Kevin will not retry.", severity: "high" },
  },
  read_only_mode: {
    description: "TrainEfficiency is in read-only mode. Write operations are blocked.",
    halted: false,
    readOnlyAllowed: true,
    retryAllowed: false,
    userMessage: "TrainEfficiency is in read-only mode. Retrieval and analysis actions are available, but no changes can be made.",
    actionBlock: { type: "warning", title: "Read-Only Mode Active", summary: "No write operations are permitted. Kevin can still retrieve information and provide analysis." },
  },
  circuit_breaker_open: {
    description: "The circuit breaker is open due to repeated failures.",
    halted: true,
    readOnlyAllowed: false,
    retryAllowed: false,
    userMessage: "The connection to TrainEfficiency is temporarily paused due to repeated errors. Kevin will not retry.",
    actionBlock: { type: "failure", title: "Circuit Breaker Open", summary: "Too many recent failures have tripped the circuit breaker. Kevin will not retry until it resets." },
  },
  credentials_revoked: {
    description: "Kevin's service credentials have been revoked.",
    halted: true,
    readOnlyAllowed: false,
    retryAllowed: false,
    userMessage: "Kevin's access credentials have been revoked. Contact your administrator to restore access.",
    actionBlock: { type: "failure", title: "Credentials Revoked", summary: "Kevin cannot authenticate to TrainEfficiency. Do not retry — contact the administrator.", severity: "high" },
  },
  email_auto_disabled: {
    description: "Autonomous email sending is disabled. Drafts can still be created.",
    halted: false,
    readOnlyAllowed: true,
    retryAllowed: false,
    userMessage: "Automatic email sending is currently disabled. Kevin can create drafts for human review, but cannot send directly.",
    actionBlock: { type: "warning", title: "Auto-Send Disabled", summary: "Email sends require explicit human approval. Drafts can still be created and queued." },
  },
  agent_delegation_paused: {
    description: "Agent delegation (task bus) is paused. Kevin cannot delegate tasks.",
    halted: false,
    readOnlyAllowed: true,
    retryAllowed: false,
    userMessage: "Agent delegation is temporarily paused. Kevin can perform analysis and retrieval but cannot dispatch tasks to platform agents.",
    actionBlock: { type: "warning", title: "Agent Delegation Paused", summary: "Kevin cannot delegate tasks right now. Analysis and retrieval remain available." },
  },
};

/**
 * Determine if an HTTP response or error code indicates an emergency condition.
 */
export function detectEmergencyCondition(errorCode: string, statusCode?: number, responseBody?: Record<string, unknown>): EmergencyCondition | null {
  if (errorCode === "EMERGENCY_STOP_ACTIVE" || responseBody?.emergency_active) return "global_kill";
  if (errorCode === "ORG_KILL_ACTIVE") return "org_kill";
  if (errorCode === "CAPABILITY_DISABLED" && responseBody?.emergency) return "capability_kill";
  if (errorCode === "READ_ONLY_MODE") return "read_only_mode";
  if (errorCode === "CIRCUIT_BREAKER_OPEN") return "circuit_breaker_open";
  if (errorCode === "AUTHENTICATION_FAILED" && responseBody?.revoked) return "credentials_revoked";
  if (statusCode === 503 && responseBody?.code === "EMERGENCY_STOP_ACTIVE") return "global_kill";
  return null;
}

/**
 * Handle an emergency condition. Logs the event and returns the full response policy.
 */
export function handleEmergency(condition: EmergencyCondition, context: { orgId?: string; capabilityKey?: string; correlationId?: string }): EmergencyResponse {
  obsEmergencyControl({ control: condition, orgId: context.orgId, correlationId: context.correlationId });

  return {
    condition,
    ...EMERGENCY_POLICIES[condition],
  };
}

/**
 * Check if an error code should NEVER be retried.
 */
export function isNonRetryable(errorCode: string): boolean {
  const nonRetryable = new Set([
    "POLICY_DENIED",
    "AUTHENTICATION_FAILED",
    "INVALID_SIGNATURE",
    "CREDENTIALS_REVOKED",
    "ORG_MISMATCH",
    "MALFORMED_PAYLOAD",
    "VALIDATION_ERROR",
    "CAPABILITY_DISABLED",
    "EMERGENCY_STOP_ACTIVE",
    "ORG_KILL_ACTIVE",
    "CAPABILITY_KILL_ACTIVE",
    "DUPLICATE_REQUEST",
    "REPLAY_REJECTED",
    "CAPABILITY_UNKNOWN",
  ]);
  return nonRetryable.has(errorCode);
}

/** True if the error code represents a transient failure safe to retry. */
export function isRetryable(errorCode: string, statusCode?: number): boolean {
  if (isNonRetryable(errorCode)) return false;
  if (statusCode && [500, 502, 503, 504].includes(statusCode)) return true;
  if (errorCode === "RATE_LIMITED") return true;
  if (errorCode === "EXECUTOR_UNAVAILABLE") return true;
  if (errorCode === "TIMEOUT") return true;
  return false;
}
