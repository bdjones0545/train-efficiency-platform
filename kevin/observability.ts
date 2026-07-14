/**
 * Kevin Observability — Step 17
 *
 * Sanitized operational logging. Correlation IDs thread through every operation.
 * NEVER logs: secrets, signatures, full Authorization headers, private message bodies.
 */

import { redactHeaders } from "./config";

export type ObsLevel = "info" | "warn" | "error" | "debug";

export interface ObsEvent {
  level: ObsLevel;
  step: string;
  message: string;
  correlationId?: string;
  intentId?: string;
  taskId?: string;
  approvalId?: string;
  orgId?: string;
  capabilityKey?: string;
  durationMs?: number;
  retryCount?: number;
  outcomeType?: string;
  emergencyControl?: string;
  errorCode?: string;
  policyDenialReason?: string;
  /** Safe-to-log metadata only — never include secret values */
  meta?: Record<string, unknown>;
}

const _log = (ev: ObsEvent) => {
  const prefix = `[Kevin:${ev.step}][${ev.level.toUpperCase()}]`;
  const ctx = [
    ev.correlationId ? `corr=${ev.correlationId.slice(0, 8)}` : null,
    ev.orgId         ? `org=${ev.orgId.slice(0, 8)}`         : null,
    ev.intentId      ? `intent=${ev.intentId.slice(0, 8)}`   : null,
    ev.capabilityKey ? `cap=${ev.capabilityKey}`              : null,
    ev.durationMs !== undefined ? `${ev.durationMs}ms`        : null,
    ev.retryCount   !== undefined ? `retry=${ev.retryCount}`  : null,
  ].filter(Boolean).join(" ");

  const logFn = ev.level === "error" ? console.error : ev.level === "warn" ? console.warn : console.log;
  logFn(`${prefix} ${ev.message}${ctx ? " | " + ctx : ""}`, ev.meta ?? "");
};

// ─── Typed log helpers per Step 17 ──────────────────────────────────────────

export const obsAuth = (args: { success: boolean; correlationId?: string; orgId?: string; reason?: string }) =>
  _log({ level: args.success ? "info" : "warn", step: "auth", message: args.success ? "Authentication succeeded" : `Authentication failed: ${args.reason}`, correlationId: args.correlationId, orgId: args.orgId });

export const obsCapabilityDiscovery = (args: { count: number; correlationId?: string; durationMs?: number }) =>
  _log({ level: "info", step: "capability_discovery", message: `Discovered ${args.count} capabilities`, correlationId: args.correlationId, durationMs: args.durationMs });

export const obsIntentSubmit = (args: { intentId?: string; capabilityKey: string; correlationId?: string; orgId?: string }) =>
  _log({ level: "info", step: "intent_submit", message: `Intent submitted for ${args.capabilityKey}`, intentId: args.intentId, capabilityKey: args.capabilityKey, correlationId: args.correlationId, orgId: args.orgId });

export const obsIntentStateChange = (args: { intentId: string; from?: string; to: string; correlationId?: string }) =>
  _log({ level: "info", step: "intent_state", message: `Intent state: ${args.from ?? "?"} → ${args.to}`, intentId: args.intentId, correlationId: args.correlationId });

export const obsTaskStateChange = (args: { taskId: string; from?: string; to: string; correlationId?: string }) =>
  _log({ level: "info", step: "task_state", message: `Task state: ${args.from ?? "?"} → ${args.to}`, correlationId: args.correlationId, meta: { taskId: args.taskId } });

export const obsApprovalStateChange = (args: { approvalId: string; state: string; correlationId?: string }) =>
  _log({ level: "info", step: "approval_state", message: `Approval ${args.approvalId.slice(0, 8)} → ${args.state}`, correlationId: args.correlationId, approvalId: args.approvalId });

export const obsOutcomeRetrieved = (args: { intentId: string; outcome: string; correlationId?: string }) =>
  _log({ level: "info", step: "outcome", message: `Outcome retrieved: ${args.outcome}`, intentId: args.intentId, correlationId: args.correlationId });

export const obsRetry = (args: { attempt: number; maxAttempts: number; reason: string; capabilityKey?: string; correlationId?: string }) =>
  _log({ level: "warn", step: "retry", message: `Retry ${args.attempt}/${args.maxAttempts}: ${args.reason}`, capabilityKey: args.capabilityKey, correlationId: args.correlationId, retryCount: args.attempt });

export const obsPolicyDenial = (args: { code?: string; reason?: string; capabilityKey?: string; correlationId?: string }) =>
  _log({ level: "warn", step: "policy_denial", message: `Policy denied: ${args.reason ?? args.code}`, capabilityKey: args.capabilityKey, correlationId: args.correlationId, policyDenialReason: args.reason });

export const obsVerificationFailed = (args: { intentId: string; deviation?: string; correlationId?: string }) =>
  _log({ level: "warn", step: "verification", message: `Verification failed${args.deviation ? ": " + args.deviation : ""}`, intentId: args.intentId, correlationId: args.correlationId });

export const obsEmergencyControl = (args: { control: string; orgId?: string; correlationId?: string }) =>
  _log({ level: "error", step: "emergency", message: `Emergency control active: ${args.control}`, orgId: args.orgId, correlationId: args.correlationId, emergencyControl: args.control, meta: { action: "halted_new_writes" } });

export const obsRequestSent = (args: { method: string; path: string; correlationId?: string; headers?: Record<string, string> }) =>
  _log({ level: "debug", step: "http", message: `${args.method} ${args.path}`, correlationId: args.correlationId, meta: args.headers ? { headers: redactHeaders(args.headers) } : undefined });

export const obsRequestError = (args: { method: string; path: string; statusCode?: number; errorCode?: string; correlationId?: string; durationMs?: number }) =>
  _log({ level: "error", step: "http", message: `${args.method} ${args.path} → ${args.statusCode ?? "network_error"} ${args.errorCode ?? ""}`, correlationId: args.correlationId, durationMs: args.durationMs, errorCode: args.errorCode });
