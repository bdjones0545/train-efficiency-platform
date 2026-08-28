/**
 * Pure version-source contract for the four specialized Composio mutation
 * callers. No database, provider, approval, or runtime execution occurs here.
 */

import { normalizeProviderFamily, type CanonicalComposioToolkit } from "./composio-action-identity";

export type SpecializedCallerFamily =
  | "gmail_draft"
  | "slack_alert"
  | "calendar_create"
  | "calendar_update"
  | "calendar_delete"
  | "github_issue";

export type LegacyVersionPolicy = "safe_initial_version_1" | "requires_data_policy";
export type VersionedRequestState = "pre_success" | "confirmed_success" | "uncertain";
export type VersionEvent =
  | "provider_retry"
  | "approval_revoked"
  | "approval_renewed_unchanged_payload"
  | "material_payload_edit"
  | "connected_account_change"
  | "tool_action_change";

export interface SpecializedCallerVersionDescriptor {
  family: SpecializedCallerFamily;
  toolkit: CanonicalComposioToolkit;
  logicalIdSource: string;
  toolAction: string;
  providerArgumentFields: readonly string[];
  singleShot: true;
  currentPayloadEditing: "unsupported";
  legacyPolicy: LegacyVersionPolicy;
  legacyQualification?: string;
}

export class ComposioVersionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposioVersionContractError";
  }
}

export const SPECIALIZED_CALLER_VERSION_DESCRIPTORS: Readonly<Record<SpecializedCallerFamily, SpecializedCallerVersionDescriptor>> = {
  gmail_draft: {
    family: "gmail_draft",
    toolkit: normalizeProviderFamily("gmail"),
    logicalIdSource: "composio_gmail_draft_requests.id",
    toolAction: "GMAIL_CREATE_EMAIL_DRAFT",
    providerArgumentFields: ["to", "subject", "body"],
    singleShot: true,
    currentPayloadEditing: "unsupported",
    legacyPolicy: "safe_initial_version_1",
  },
  slack_alert: {
    family: "slack_alert",
    toolkit: normalizeProviderFamily("slack"),
    logicalIdSource: "composio_slack_alert_requests.id",
    toolAction: "SLACK_SEND_MESSAGE",
    providerArgumentFields: ["channel", "markdown_text"],
    singleShot: true,
    currentPayloadEditing: "unsupported",
    legacyPolicy: "safe_initial_version_1",
  },
  calendar_create: {
    family: "calendar_create",
    toolkit: normalizeProviderFamily("googlecalendar"),
    logicalIdSource: "composio_calendar_requests.id",
    toolAction: "GOOGLECALENDAR_CREATE_EVENT",
    providerArgumentFields: [
      "summary", "start_datetime", "calendar_id", "end_datetime",
      "event_duration_hour", "event_duration_minutes", "attendees", "location",
      "description", "timezone", "create_meeting_room",
    ],
    singleShot: true,
    currentPayloadEditing: "unsupported",
    legacyPolicy: "requires_data_policy",
    legacyQualification: "payload must be nonnull and proven equal to the execution payload",
  },
  calendar_update: {
    family: "calendar_update",
    toolkit: normalizeProviderFamily("googlecalendar"),
    logicalIdSource: "composio_calendar_requests.id",
    toolAction: "GOOGLECALENDAR_UPDATE_EVENT",
    providerArgumentFields: [
      "event_id", "start_datetime", "calendar_id", "summary", "end_datetime",
      "event_duration_hour", "event_duration_minutes", "attendees", "location",
      "description", "timezone",
    ],
    singleShot: true,
    currentPayloadEditing: "unsupported",
    legacyPolicy: "requires_data_policy",
    legacyQualification: "payload must be nonnull and proven equal to the execution payload",
  },
  calendar_delete: {
    family: "calendar_delete",
    toolkit: normalizeProviderFamily("googlecalendar"),
    logicalIdSource: "composio_calendar_requests.id",
    toolAction: "GOOGLECALENDAR_DELETE_EVENT",
    providerArgumentFields: ["event_id", "calendar_id"],
    singleShot: true,
    currentPayloadEditing: "unsupported",
    legacyPolicy: "requires_data_policy",
    legacyQualification: "payload must be nonnull and proven equal to the execution payload",
  },
  github_issue: {
    family: "github_issue",
    toolkit: normalizeProviderFamily("github"),
    logicalIdSource: "software_improvement_tasks.id",
    toolAction: "GITHUB_CREATE_AN_ISSUE",
    providerArgumentFields: ["title", "body", "labels"],
    singleShot: true,
    currentPayloadEditing: "unsupported",
    legacyPolicy: "requires_data_policy",
    legacyQualification: "github_issue_draft must be nonnull; fallback reconstruction is ineligible",
  },
};

export function parseProviderActionVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ComposioVersionContractError("providerActionVersion must be a positive safe integer");
  }
  return value;
}

export function nextVersionForEvent(input: {
  currentVersion: number;
  state: VersionedRequestState;
  event: VersionEvent;
}): number {
  const version = parseProviderActionVersion(input.currentVersion);
  if (input.state === "confirmed_success") {
    throw new ComposioVersionContractError("single-shot request is exhausted after confirmed success");
  }
  if (input.state === "uncertain") {
    throw new ComposioVersionContractError("version change cannot bypass an uncertain provider outcome");
  }
  if (input.event === "provider_retry"
      || input.event === "approval_revoked"
      || input.event === "approval_renewed_unchanged_payload") {
    return version;
  }
  if (input.event === "tool_action_change") {
    throw new ComposioVersionContractError("specialized request cannot change its fixed provider action");
  }
  return parseProviderActionVersion(version + 1);
}

export function assertCurrentVersion(input: {
  requestedVersion: number;
  currentVersion: number;
  approvedPayloadVersion?: number;
  approvalRequired: boolean;
  approvalCurrent: boolean;
  state: VersionedRequestState;
}): void {
  const requested = parseProviderActionVersion(input.requestedVersion);
  const current = parseProviderActionVersion(input.currentVersion);
  if (requested !== current) throw new ComposioVersionContractError("stale provider action version");
  if (input.state !== "pre_success") {
    throw new ComposioVersionContractError(
      input.state === "uncertain" ? "uncertain outcome requires reconciliation" : "single-shot request is exhausted",
    );
  }
  if (input.approvalRequired) {
    if (!input.approvalCurrent) throw new ComposioVersionContractError("approval authority is not current");
    if (parseProviderActionVersion(input.approvedPayloadVersion) !== current) {
      throw new ComposioVersionContractError("approval does not bind the current payload version");
    }
  }
}

export function legacyRowEligibleForVersionOne(input: {
  family: SpecializedCallerFamily;
  exactPayloadSnapshotPresent: boolean;
  snapshotMatchesExecutionPayload: boolean;
}): boolean {
  const descriptor = SPECIALIZED_CALLER_VERSION_DESCRIPTORS[input.family];
  if (descriptor.legacyPolicy === "safe_initial_version_1") return true;
  return input.exactPayloadSnapshotPresent && input.snapshotMatchesExecutionPayload;
}
