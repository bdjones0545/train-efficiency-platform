/**
 * Pure contract for the future Composio provider-action/attempt ledger.
 *
 * This module intentionally performs no database or provider work. In
 * particular, it does not manufacture caller-owned identity, payload versions,
 * provider receipts, or reconciliation guarantees.
 */

import {
  authorityMatches,
  type ProviderActionAuthority,
} from "./composio-action-identity";

export type ProviderActionStatus =
  | "authorized"
  | "provider_accepted"
  | "confirmed_success"
  | "confirmed_failure"
  | "uncertain"
  | "rejected"
  | "cancelled";

export type ProviderAttemptStatus =
  | "attempt_authorized"
  | "invocation_in_progress"
  | "provider_accepted"
  | "confirmed_success"
  | "confirmed_failure"
  | "uncertain";

export type ProviderActionClass =
  | "read_only"
  | "synchronous_mutation"
  | "asynchronous_mutation"
  | "communication_side_effect"
  | "unknown_provider_semantics";

export type CallerIdentityReadiness =
  | "ready"
  | "logical_id_missing"
  | "version_missing"
  | "logical_id_and_version_missing";

export type AttemptDirective =
  | "authorize_first_attempt"
  | "resume_authorized_attempt"
  | "authorize_retry_attempt"
  | "reconcile_do_not_retry"
  | "terminal_do_not_retry";

export type ConfirmedFailureRetryDisposition = "retry_authorized" | "retry_not_authorized";

export class ComposioLifecycleContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposioLifecycleContractError";
  }
}

const ATTEMPT_TRANSITIONS: Readonly<Record<ProviderAttemptStatus, readonly ProviderAttemptStatus[]>> = {
  attempt_authorized: ["invocation_in_progress"],
  invocation_in_progress: ["provider_accepted", "confirmed_success", "confirmed_failure", "uncertain"],
  provider_accepted: ["confirmed_success", "confirmed_failure", "uncertain"],
  confirmed_success: [],
  confirmed_failure: [],
  uncertain: [],
};

export const BLOCKING_ATTEMPT_STATUSES: readonly ProviderAttemptStatus[] = [
  "attempt_authorized",
  "invocation_in_progress",
  "provider_accepted",
  "uncertain",
];

export function assessCallerIdentityReadiness(input: {
  logicalProviderActionId?: string;
  providerActionVersion?: string;
}): CallerIdentityReadiness {
  const hasId = Boolean(input.logicalProviderActionId?.trim());
  const hasVersion = Boolean(input.providerActionVersion?.trim());
  if (hasId && hasVersion) return "ready";
  if (!hasId && !hasVersion) return "logical_id_and_version_missing";
  return hasId ? "version_missing" : "logical_id_missing";
}

export function assertAuthorityStillMatches(
  persisted: ProviderActionAuthority,
  requested: ProviderActionAuthority,
): void {
  if (!authorityMatches(persisted, requested)) {
    throw new ComposioLifecycleContractError(
      "tool, action, connection, arguments version, or approval authority changed",
    );
  }
}

export function nextAttemptDirective(input: {
  actionStatus: ProviderActionStatus;
  latestAttemptStatus?: ProviderAttemptStatus;
  confirmedFailureRetryDisposition?: ConfirmedFailureRetryDisposition;
}): AttemptDirective {
  const { actionStatus, latestAttemptStatus, confirmedFailureRetryDisposition } = input;
  if (latestAttemptStatus === "attempt_authorized") return "resume_authorized_attempt";
  if (latestAttemptStatus && BLOCKING_ATTEMPT_STATUSES.includes(latestAttemptStatus)) {
    return "reconcile_do_not_retry";
  }
  if (actionStatus === "uncertain" || actionStatus === "provider_accepted") {
    return "reconcile_do_not_retry";
  }
  if (["confirmed_success", "confirmed_failure", "rejected", "cancelled"].includes(actionStatus)) {
    return "terminal_do_not_retry";
  }
  if (latestAttemptStatus === "confirmed_failure") {
    if (!confirmedFailureRetryDisposition) {
      throw new ComposioLifecycleContractError(
        "confirmed attempt failure requires an explicit retry disposition",
      );
    }
    return confirmedFailureRetryDisposition === "retry_authorized"
      ? "authorize_retry_attempt"
      : "terminal_do_not_retry";
  }
  return "authorize_first_attempt";
}

export function assertAttemptTransition(
  from: ProviderAttemptStatus,
  to: ProviderAttemptStatus,
): void {
  if (!ATTEMPT_TRANSITIONS[from].includes(to)) {
    throw new ComposioLifecycleContractError(`invalid attempt transition: ${from} -> ${to}`);
  }
}

export function assertInvocationAuthority(input: {
  connectionAuthorityCurrent: boolean;
  approvalAuthorityCurrent: boolean;
}): void {
  if (!input.connectionAuthorityCurrent || !input.approvalAuthorityCurrent) {
    throw new ComposioLifecycleContractError(
      "connection and approval authority must be revalidated immediately before invocation",
    );
  }
}

export function callbackConvergenceKey(input: {
  actionId: string;
  attemptId: string;
  providerEventId: string;
}): string {
  const required = (value: string, field: string) => {
    const normalized = value.trim();
    if (!normalized) throw new ComposioLifecycleContractError(`${field} is required`);
    return normalized;
  };
  return JSON.stringify([
    required(input.actionId, "actionId"),
    required(input.attemptId, "attemptId"),
    required(input.providerEventId, "providerEventId"),
  ]);
}

export function outcomeAfterPersistenceFailure(providerMayHaveSucceeded: boolean): ProviderActionStatus {
  return providerMayHaveSucceeded ? "uncertain" : "confirmed_failure";
}
