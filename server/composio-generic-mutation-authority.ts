/** Pure future generic Composio mutation-authority contract. */
import {
  deriveCanonicalProviderActionIdentity,
  normalizeProviderFamily,
  sameProviderActionIdentity,
  type CanonicalComposioToolkit,
  type CanonicalProviderActionIdentity,
} from "./composio-action-identity";
import {
  nextAttemptDirective,
  type ProviderActionStatus,
  type ProviderAttemptStatus,
} from "./composio-provider-action-lifecycle";

const READ_ACTIONS = new Set([
  "GMAIL_FETCH_EMAILS", "GMAIL_GET_PROFILE", "GMAIL_LIST_THREADS", "GMAIL_GET_THREAD",
  "GOOGLECALENDAR_LIST_CALENDARS", "GOOGLECALENDAR_EVENTS_LIST", "GOOGLECALENDAR_EVENTS_GET",
  "GOOGLECALENDAR_FIND_FREE_SLOTS", "GOOGLECALENDAR_FIND_EVENT",
  "SLACK_LIST_CHANNELS", "SLACK_LIST_MEMBERS_IN_CHANNEL", "SLACK_GET_CHANNEL_INFO", "SLACK_FETCH_CONVERSATION_HISTORY",
  "GOOGLESHEETS_BATCH_GET", "GOOGLESHEETS_GET_SPREADSHEET", "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW",
  "GITHUB_LIST_REPOSITORIES", "GITHUB_GET_A_REPOSITORY", "GITHUB_LIST_REPOSITORY_ISSUES", "GITHUB_GET_AN_ISSUE",
  "GITHUB_LIST_PULL_REQUESTS", "GITHUB_GET_A_PULL_REQUEST", "GITHUB_LIST_COMMITS", "GITHUB_GET_A_COMMIT",
  "GITHUB_SEARCH_CODE", "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
  "STRIPE_LIST_CUSTOMERS", "STRIPE_RETRIEVE_CUSTOMER", "STRIPE_LIST_SUBSCRIPTIONS", "STRIPE_RETRIEVE_SUBSCRIPTION",
  "STRIPE_LIST_INVOICES", "STRIPE_RETRIEVE_INVOICE", "STRIPE_LIST_CHARGES", "STRIPE_RETRIEVE_CHARGE",
  "STRIPE_LIST_PAYMENT_INTENTS",
]);

export const GENERIC_COMPOSIO_MUTATION_ACTIONS = [
  "GMAIL_CREATE_EMAIL_DRAFT", "GMAIL_REPLY_TO_THREAD",
  "GOOGLECALENDAR_CREATE_EVENT", "GOOGLECALENDAR_UPDATE_EVENT", "GOOGLECALENDAR_DELETE_EVENT",
  "SLACK_SEND_MESSAGE", "SLACK_CREATE_CHANNEL", "SLACK_INVITE_USER_TO_CHANNEL",
  "GOOGLESHEETS_SHEET_FROM_JSON", "GOOGLESHEETS_UPDATE_SPREADSHEET_ROW", "GOOGLESHEETS_CREATE_SPREADSHEET",
  "GOOGLESHEETS_CREATE_GOOGLE_SHEET", "GOOGLESHEETS_CLEAR_VALUES",
  "GITHUB_CREATE_AN_ISSUE",
] as const;

const MUTATION_ACTIONS = new Set<string>(GENERIC_COMPOSIO_MUTATION_ACTIONS);
const ACTION_TOOLKITS: Readonly<Record<GenericMutationAction, CanonicalComposioToolkit>> = {
  GMAIL_CREATE_EMAIL_DRAFT: "gmail", GMAIL_REPLY_TO_THREAD: "gmail",
  GOOGLECALENDAR_CREATE_EVENT: "googlecalendar", GOOGLECALENDAR_UPDATE_EVENT: "googlecalendar",
  GOOGLECALENDAR_DELETE_EVENT: "googlecalendar",
  SLACK_SEND_MESSAGE: "slack", SLACK_CREATE_CHANNEL: "slack", SLACK_INVITE_USER_TO_CHANNEL: "slack",
  GOOGLESHEETS_SHEET_FROM_JSON: "googlesheets", GOOGLESHEETS_UPDATE_SPREADSHEET_ROW: "googlesheets",
  GOOGLESHEETS_CREATE_SPREADSHEET: "googlesheets", GOOGLESHEETS_CREATE_GOOGLE_SHEET: "googlesheets",
  GOOGLESHEETS_CLEAR_VALUES: "googlesheets", GITHUB_CREATE_AN_ISSUE: "github",
};
export type GenericMutationAction = typeof GENERIC_COMPOSIO_MUTATION_ACTIONS[number];
export type GenericActionClass = "read_only" | "mutation" | "unknown_unsafe";
export type GenericIdentityProvenance = "durable_business_object" | "attempt_uuid" | "approval_id" |
  "provider_receipt" | "entity_id" | "argument_hash" | "timestamp" | "resource_key" | "executor_generated";

export interface GenericMutationAuthorityInput {
  orgId: string;
  toolkit: string;
  action: string;
  logicalProviderActionId?: string;
  logicalIdProvenance?: GenericIdentityProvenance;
  providerActionVersion?: number;
  connectedAccountId?: string;
  authorityDescriptorComplete: boolean;
  currentVersion: number;
}

export interface GenericMutationAuthority {
  identity: CanonicalProviderActionIdentity;
  action: GenericMutationAction;
  connectedAccountId: string;
}

export class GenericMutationAuthorityError extends Error {
  constructor(message: string) { super(message); this.name = "GenericMutationAuthorityError"; }
}

const required = (value: string | undefined, field: string) => {
  const normalized = value?.trim();
  if (!normalized) throw new GenericMutationAuthorityError(`${field} is required`);
  return normalized;
};

export function classifyGenericComposioAction(action: string): GenericActionClass {
  const canonical = action.trim().toUpperCase();
  if (MUTATION_ACTIONS.has(canonical)) return "mutation";
  if (READ_ACTIONS.has(canonical)) return "read_only";
  return "unknown_unsafe";
}

export function requireGenericMutationAuthority(input: GenericMutationAuthorityInput): GenericMutationAuthority {
  const toolkit: CanonicalComposioToolkit = normalizeProviderFamily(input.toolkit);
  const action = input.action.trim().toUpperCase();
  if (classifyGenericComposioAction(action) !== "mutation") {
    throw new GenericMutationAuthorityError("server-known mutation action is required");
  }
  if (ACTION_TOOLKITS[action as GenericMutationAction] !== toolkit) {
    throw new GenericMutationAuthorityError("mutation action does not belong to the canonical toolkit");
  }
  if (input.logicalIdProvenance !== "durable_business_object") {
    throw new GenericMutationAuthorityError("logical ID must be caller-owned durable business authority");
  }
  const version = input.providerActionVersion;
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    throw new GenericMutationAuthorityError("providerActionVersion must be a positive safe integer");
  }
  if (!Number.isSafeInteger(input.currentVersion) || input.currentVersion < 1 || input.currentVersion !== version) {
    throw new GenericMutationAuthorityError("requested provider-action version is stale");
  }
  if (!input.authorityDescriptorComplete) {
    throw new GenericMutationAuthorityError("complete immutable action-specific authority descriptor is required");
  }
  return {
    identity: deriveCanonicalProviderActionIdentity({
      orgId: input.orgId,
      providerFamily: toolkit,
      logicalProviderActionId: required(input.logicalProviderActionId, "logicalProviderActionId"),
      providerActionVersion: String(version),
    }),
    action: action as GenericMutationAction,
    connectedAccountId: required(input.connectedAccountId, "connectedAccountId"),
  };
}

export function genericMutationAuthorityMatches(left: GenericMutationAuthority, right: GenericMutationAuthority): boolean {
  return sameProviderActionIdentity(left.identity, right.identity)
    && left.action === right.action
    && left.connectedAccountId === right.connectedAccountId;
}

export function revisedGenericMutationVersion(currentVersion: number, materialAuthorityChanged: boolean): number {
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) throw new GenericMutationAuthorityError("invalid current version");
  if (!materialAuthorityChanged) return currentVersion;
  const next = currentVersion + 1;
  if (!Number.isSafeInteger(next)) throw new GenericMutationAuthorityError("provider action version overflow");
  return next;
}

export function genericMutationRetryDirective(input: {
  actionStatus: ProviderActionStatus;
  latestAttemptStatus?: ProviderAttemptStatus;
  retryAuthorized?: boolean;
}) {
  return nextAttemptDirective({
    actionStatus: input.actionStatus,
    latestAttemptStatus: input.latestAttemptStatus,
    ...(input.latestAttemptStatus === "confirmed_failure" ? {
      confirmedFailureRetryDisposition: input.retryAuthorized ? "retry_authorized" as const : "retry_not_authorized" as const,
    } : {}),
  });
}

export function genericDirectMutationReadiness(input: { logicalProviderActionId?: string; providerActionVersion?: number }) {
  const id = Boolean(input.logicalProviderActionId?.trim());
  const version = Number.isSafeInteger(input.providerActionVersion) && (input.providerActionVersion as number) > 0;
  return id && version ? "ready" as const : id || version ? "partial" as const : "missing" as const;
}
