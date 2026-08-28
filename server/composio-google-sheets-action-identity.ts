/** Pure contract for future Google Sheets mutation authority. No DB or provider I/O. */
import {
  deriveCanonicalProviderActionIdentity,
  normalizeProviderFamily,
  sameProviderActionIdentity,
  type CanonicalProviderActionIdentity,
} from "./composio-action-identity";
import {
  nextAttemptDirective,
  type ProviderActionStatus,
  type ProviderAttemptStatus,
} from "./composio-provider-action-lifecycle";

export const GOOGLE_SHEETS_READ_ACTIONS = [
  "GOOGLESHEETS_BATCH_GET",
  "GOOGLESHEETS_GET_SPREADSHEET",
  "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW",
] as const;

export const GOOGLE_SHEETS_MUTATION_ACTIONS = [
  "GOOGLESHEETS_SHEET_FROM_JSON",
  "GOOGLESHEETS_UPDATE_SPREADSHEET_ROW",
  "GOOGLESHEETS_CREATE_SPREADSHEET",
  "GOOGLESHEETS_CREATE_GOOGLE_SHEET",
  "GOOGLESHEETS_CLEAR_VALUES",
] as const;

export type GoogleSheetsMutationAction = typeof GOOGLE_SHEETS_MUTATION_ACTIONS[number];
export type SheetsActionClass = "read_only" | "mutation" | "unknown";
export type SheetsIdentityProvenance =
  | "durable_business_object"
  | "attempt_id"
  | "provider_receipt"
  | "argument_hash"
  | "time_bucket"
  | "resource_key"
  | "arbitrary_entity_id";

export interface SheetsMutationIdentityInput {
  orgId: string;
  toolkit: string;
  action: string;
  logicalProviderActionId?: string;
  logicalIdProvenance?: SheetsIdentityProvenance;
  providerActionVersion?: number;
  connectedAccountId?: string;
  authorityDescriptorComplete: boolean;
}

export interface SheetsMutationIdentity {
  identity: CanonicalProviderActionIdentity;
  action: GoogleSheetsMutationAction;
  connectedAccountId: string;
}

export class GoogleSheetsIdentityContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleSheetsIdentityContractError";
  }
}

const required = (value: string | undefined, field: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) throw new GoogleSheetsIdentityContractError(`${field} is required`);
  return trimmed;
};

export function canonicalGoogleSheetsToolkit(value: string): "googlesheets" {
  const toolkit = normalizeProviderFamily(value);
  if (toolkit !== "googlesheets") throw new GoogleSheetsIdentityContractError("toolkit must be googlesheets");
  return toolkit;
}

export function classifyGoogleSheetsAction(action: string): SheetsActionClass {
  const canonical = action.trim().toUpperCase();
  if ((GOOGLE_SHEETS_READ_ACTIONS as readonly string[]).includes(canonical)) return "read_only";
  if ((GOOGLE_SHEETS_MUTATION_ACTIONS as readonly string[]).includes(canonical)) return "mutation";
  return "unknown";
}

export function requireGoogleSheetsMutationIdentity(input: SheetsMutationIdentityInput): SheetsMutationIdentity {
  canonicalGoogleSheetsToolkit(input.toolkit);
  const action = input.action.trim().toUpperCase();
  if (classifyGoogleSheetsAction(action) !== "mutation") {
    throw new GoogleSheetsIdentityContractError("a known server-side Google Sheets mutation action is required");
  }
  if (input.logicalIdProvenance !== "durable_business_object") {
    throw new GoogleSheetsIdentityContractError("logical ID must come from a durable caller-owned business object");
  }
  const version = input.providerActionVersion;
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    throw new GoogleSheetsIdentityContractError("providerActionVersion must be a positive safe integer");
  }
  if (!input.authorityDescriptorComplete) {
    throw new GoogleSheetsIdentityContractError("complete immutable authority descriptor is required");
  }
  return {
    identity: deriveCanonicalProviderActionIdentity({
      orgId: input.orgId,
      providerFamily: "googlesheets",
      logicalProviderActionId: required(input.logicalProviderActionId, "logicalProviderActionId"),
      providerActionVersion: String(version),
    }),
    action: action as GoogleSheetsMutationAction,
    connectedAccountId: required(input.connectedAccountId, "connectedAccountId"),
  };
}

export function sheetsAuthorityMatches(left: SheetsMutationIdentity, right: SheetsMutationIdentity): boolean {
  return sameProviderActionIdentity(left.identity, right.identity)
    && left.action === right.action
    && left.connectedAccountId === right.connectedAccountId;
}

/** A material payload or target change revises one action; a retry does not. */
export function requiredSheetsVersion(input: {
  currentVersion: number;
  materialAuthorityChanged: boolean;
}): number {
  if (!Number.isSafeInteger(input.currentVersion) || input.currentVersion < 1) {
    throw new GoogleSheetsIdentityContractError("currentVersion must be a positive safe integer");
  }
  if (!input.materialAuthorityChanged) return input.currentVersion;
  const next = input.currentVersion + 1;
  if (!Number.isSafeInteger(next)) throw new GoogleSheetsIdentityContractError("provider action version overflow");
  return next;
}

/** Reject stale execution authority before any provider attempt is authorized. */
export function assertCurrentSheetsVersion(input: {
  requestedVersion: number;
  currentVersion: number;
}): void {
  if (!Number.isSafeInteger(input.requestedVersion) || input.requestedVersion < 1 ||
      !Number.isSafeInteger(input.currentVersion) || input.currentVersion < 1 ||
      input.requestedVersion !== input.currentVersion) {
    throw new GoogleSheetsIdentityContractError("requested provider-action version is stale or invalid");
  }
}

export function sheetsRetryDirective(input: {
  actionStatus: ProviderActionStatus;
  latestAttemptStatus?: ProviderAttemptStatus;
  retryAuthorized?: boolean;
}) {
  return nextAttemptDirective({
    actionStatus: input.actionStatus,
    latestAttemptStatus: input.latestAttemptStatus,
    ...(input.latestAttemptStatus === "confirmed_failure"
      ? { confirmedFailureRetryDisposition: input.retryAuthorized ? "retry_authorized" as const : "retry_not_authorized" as const }
      : {}),
  });
}

/** The current generic route supplies neither caller identity field. */
export function assessCurrentGenericSheetsCaller(input: {
  logicalProviderActionId?: string;
  providerActionVersion?: number;
}): "missing" | "partial" | "ready" {
  const hasId = Boolean(input.logicalProviderActionId?.trim());
  const hasVersion = Number.isSafeInteger(input.providerActionVersion) && (input.providerActionVersion as number) > 0;
  return hasId && hasVersion ? "ready" : hasId || hasVersion ? "partial" : "missing";
}
