export const CURRENT_DURABLE_PAYLOAD_VERSION = 1;

export class DurablePayloadError extends Error {
  constructor(message: string) { super(`Invalid durable payload: ${message}`); }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DurablePayloadError(`${label} must be an object`);
  }
  return { ...(value as Record<string, unknown>) };
}

function assertTenant(data: Record<string, unknown>, authoritativeOrgId: string): void {
  if (data.orgId !== undefined && data.orgId !== authoritativeOrgId) {
    throw new DurablePayloadError("payload tenant does not match durable row owner");
  }
}

export function normalizeWorkflowPayload(input: {
  workType: string;
  version: number | null | undefined;
  payload: unknown;
  authoritativeOrgId: string;
}): Record<string, unknown> {
  const version = input.version ?? 0;
  if (version !== 0 && version !== CURRENT_DURABLE_PAYLOAD_VERSION) {
    throw new DurablePayloadError(`unsupported version ${version}; supported versions: 0,1`);
  }
  const supported = new Set(["workflow_step", "tool_execution", "scheduled_trigger", "retry",
    "approval_timeout", "memory_lifecycle", "business_brain_run", "notification"]);
  if (!supported.has(input.workType)) throw new DurablePayloadError(`unsupported work type ${input.workType}`);
  const data = record(input.payload, input.workType);
  assertTenant(data, input.authoritativeOrgId);

  // Explicit, pure v0 -> v1 aliases used by older durable writers.
  if (version === 0 && input.workType === "notification" && data.type === undefined && typeof data.notificationType === "string") {
    data.type = data.notificationType;
  }
  if (version === 0 && input.workType === "approval_timeout" && data.workflowRunId === undefined && typeof data.runId === "string") {
    data.workflowRunId = data.runId;
  }
  if (input.workType === "notification" && (typeof data.type !== "string" || typeof data.message !== "string")) {
    throw new DurablePayloadError("notification requires type and message");
  }
  if (input.workType === "approval_timeout" && typeof data.workflowRunId !== "string") {
    throw new DurablePayloadError("approval_timeout requires workflowRunId");
  }
  if (input.workType === "memory_lifecycle" && data.limit !== undefined && typeof data.limit !== "number") {
    throw new DurablePayloadError("memory_lifecycle limit must be numeric");
  }
  return data;
}

export function normalizeDeadLetterPayload(input: {
  workType: string;
  version: number | null | undefined;
  payload: unknown;
  authoritativeOrgId: string;
}): unknown {
  const version = input.version ?? 0;
  if (version !== 0 && version !== CURRENT_DURABLE_PAYLOAD_VERSION) {
    throw new DurablePayloadError(`unsupported version ${version}; supported versions: 0,1`);
  }
  if (input.payload === null || input.payload === undefined) return input.payload;
  const data = record(input.payload, input.workType);
  assertTenant(data, input.authoritativeOrgId);
  return data;
}
