/**
 * Kevin Observability Service — Phase 17
 *
 * Structured logging and metrics for all Kevin Executive Control Plane operations.
 * Provides correlation ID tracking, redaction of sensitive fields, and alert thresholds.
 *
 * Design principles:
 * - Correlation IDs thread through: request → intent → task → executor → outcome
 * - Sensitive fields (credentials, tokens, email bodies) are NEVER logged
 * - Alerts fire on: repeated auth failures, replay attacks, cross-org attempts,
 *   unusual volume, dead-letter growth, verification failures, delegation loops
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventCategory =
  | "auth"
  | "replay"
  | "intent"
  | "task"
  | "capability"
  | "approval"
  | "verification"
  | "retry"
  | "dead_letter"
  | "policy_denial"
  | "delegation"
  | "email"
  | "provider"
  | "emergency"
  | "cross_org";

export type EventLevel = "info" | "warn" | "error" | "alert";

export interface KevinObsEvent {
  level: EventLevel;
  category: EventCategory;
  message: string;
  correlationId?: string;
  intentId?: string;
  taskId?: string;
  orgId?: string;
  capabilityKey?: string;
  agentId?: string;
  durationMs?: number;
  retryCount?: number;
  delegationDepth?: number;
  policyDenialReason?: string;
  errorCode?: string;
  meta?: Record<string, unknown>;
}

// ─── Alert thresholds ─────────────────────────────────────────────────────────

const ALERT_THRESHOLDS = {
  authFailuresPerMinute: 5,
  replayAttemptsPerMinute: 3,
  crossOrgAttemptsPerHour: 2,
  deadLetterGrowthPerHour: 10,
  verificationFailuresPerHour: 5,
  delegationLoopCount: 2,
  emailVolumePerHour: 50,
  duplicateSendsPerHour: 3,
};

// ─── In-memory rolling counters (non-durable, for fast alert evaluation) ──────

const _counters = new Map<string, { count: number; windowStart: number }>();

function _inc(key: string, windowMs = 60_000): number {
  const now = Date.now();
  const entry = _counters.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    _counters.set(key, { count: 1, windowStart: now });
    return 1;
  }
  entry.count++;
  return entry.count;
}

// ─── Sensitive field redaction ────────────────────────────────────────────────

const REDACT_KEYS = new Set([
  "credential", "credentials", "secret", "token", "signature", "nonce",
  "password", "privateKey", "apiKey", "api_key", "accessToken", "access_token",
  "refreshToken", "refresh_token", "sessionCookie", "session_cookie",
  "emailBody", "email_body", "bodyFull", "body_full",
]);

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k)) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Alert writer ─────────────────────────────────────────────────────────────

async function _writeAlert(event: KevinObsEvent, reason: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO kevin_audit_events (
        id, org_id, event_type, actor, payload, severity, created_at
      ) VALUES (
        gen_random_uuid(),
        ${event.orgId ?? "system"},
        ${"kevin.alert." + event.category},
        'kevin_observability',
        ${JSON.stringify({
          message: event.message,
          alertReason: reason,
          correlationId: event.correlationId,
          capabilityKey: event.capabilityKey,
          level: event.level,
        })}::jsonb,
        'critical',
        NOW()
      )
    `).catch(() => { /* non-fatal */ });
  } catch {
    /* non-fatal */
  }
}

// ─── Main logger ─────────────────────────────────────────────────────────────

export function logKevinEvent(event: KevinObsEvent): void {
  const payload = event.meta ? redact(event.meta) : {};
  const prefix = `[Kevin:${event.category}][${event.level.toUpperCase()}]`;
  const ctx = [
    event.correlationId ? `corr=${event.correlationId.slice(0, 8)}` : null,
    event.orgId ? `org=${event.orgId.slice(0, 8)}` : null,
    event.intentId ? `intent=${event.intentId.slice(0, 8)}` : null,
    event.capabilityKey ? `cap=${event.capabilityKey}` : null,
    event.durationMs !== undefined ? `${event.durationMs}ms` : null,
    event.retryCount !== undefined ? `retry=${event.retryCount}` : null,
    event.delegationDepth !== undefined ? `depth=${event.delegationDepth}` : null,
  ].filter(Boolean).join(" ");

  const logFn = event.level === "error" || event.level === "alert" ? console.error : event.level === "warn" ? console.warn : console.log;
  logFn(`${prefix} ${event.message}${ctx ? " | " + ctx : ""}`, Object.keys(payload).length ? payload : "");

  // Alert threshold evaluation (async, non-blocking)
  void _checkAlertThresholds(event);
}

async function _checkAlertThresholds(event: KevinObsEvent): Promise<void> {
  try {
    const { category, orgId } = event;

    if (category === "auth" && event.level !== "info") {
      const count = _inc(`auth_fail:${orgId ?? "global"}`, 60_000);
      if (count >= ALERT_THRESHOLDS.authFailuresPerMinute) {
        await _writeAlert(event, `Auth failures: ${count}/min (threshold=${ALERT_THRESHOLDS.authFailuresPerMinute})`);
      }
    }

    if (category === "replay") {
      const count = _inc(`replay:${orgId ?? "global"}`, 60_000);
      if (count >= ALERT_THRESHOLDS.replayAttemptsPerMinute) {
        await _writeAlert(event, `Replay attempts: ${count}/min`);
      }
    }

    if (category === "cross_org") {
      const count = _inc(`cross_org:${orgId ?? "global"}`, 3_600_000);
      if (count >= ALERT_THRESHOLDS.crossOrgAttemptsPerHour) {
        await _writeAlert(event, `Cross-org access attempts: ${count}/hour — SECURITY ALERT`);
      }
    }

    if (category === "dead_letter") {
      const count = _inc("dead_letter:global", 3_600_000);
      if (count >= ALERT_THRESHOLDS.deadLetterGrowthPerHour) {
        await _writeAlert(event, `Dead-letter growth: ${count}/hour`);
      }
    }

    if (category === "verification" && event.level !== "info") {
      const count = _inc(`verify_fail:${orgId ?? "global"}`, 3_600_000);
      if (count >= ALERT_THRESHOLDS.verificationFailuresPerHour) {
        await _writeAlert(event, `Verification failures: ${count}/hour`);
      }
    }

    if (category === "delegation") {
      const depth = event.delegationDepth ?? 0;
      if (depth >= 3) {
        const count = _inc(`delegation_loop:${orgId ?? "global"}`, 3_600_000);
        if (count >= ALERT_THRESHOLDS.delegationLoopCount) {
          await _writeAlert(event, `Delegation depth ${depth} — loop risk`);
        }
      }
    }

    if (category === "email") {
      const count = _inc(`email_volume:${orgId ?? "global"}`, 3_600_000);
      if (count >= ALERT_THRESHOLDS.emailVolumePerHour) {
        await _writeAlert(event, `Unusual email volume: ${count}/hour`);
      }
    }

    if (category === "emergency") {
      await _writeAlert(event, "Emergency control activated");
    }
  } catch {
    /* non-fatal */
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

export const logKevinAuth = (args: { success: boolean; orgId?: string; correlationId?: string; reason?: string }) =>
  logKevinEvent({
    level: args.success ? "info" : "warn",
    category: "auth",
    message: args.success ? "Authentication successful" : `Authentication failed: ${args.reason}`,
    orgId: args.orgId,
    correlationId: args.correlationId,
  });

export const logKevinReplay = (args: { orgId?: string; correlationId?: string; nonce?: string }) =>
  logKevinEvent({
    level: "warn",
    category: "replay",
    message: "Replay attempt detected",
    orgId: args.orgId,
    correlationId: args.correlationId,
    meta: { nonce: args.nonce ? args.nonce.slice(0, 8) + "…" : undefined },
  });

export const logKevinIntent = (args: { action: "created" | "completed" | "failed" | "cancelled"; intentId: string; capabilityKey: string; orgId: string; correlationId?: string; durationMs?: number }) =>
  logKevinEvent({
    level: args.action === "completed" ? "info" : args.action === "failed" ? "warn" : "info",
    category: "intent",
    message: `Intent ${args.action}: ${args.capabilityKey}`,
    intentId: args.intentId,
    capabilityKey: args.capabilityKey,
    orgId: args.orgId,
    correlationId: args.correlationId,
    durationMs: args.durationMs,
  });

export const logKevinTask = (args: { action: "created" | "completed" | "failed"; taskId: string; intentId: string; capabilityKey: string; orgId: string; assignedAgent?: string; correlationId?: string }) =>
  logKevinEvent({
    level: args.action === "failed" ? "warn" : "info",
    category: "task",
    message: `Task ${args.action}: ${args.capabilityKey} → ${args.assignedAgent ?? "?"}`,
    taskId: args.taskId,
    intentId: args.intentId,
    capabilityKey: args.capabilityKey,
    orgId: args.orgId,
    correlationId: args.correlationId,
    agentId: args.assignedAgent,
  });

export const logKevinPolicyDenial = (args: { reason: string; capabilityKey: string; orgId: string; correlationId?: string }) =>
  logKevinEvent({
    level: "warn",
    category: "policy_denial",
    message: `Policy denied: ${args.reason}`,
    capabilityKey: args.capabilityKey,
    orgId: args.orgId,
    correlationId: args.correlationId,
    policyDenialReason: args.reason,
  });

export const logKevinVerification = (args: { status: string; capabilityKey: string; intentId: string; orgId: string; correlationId?: string; deviation?: string }) =>
  logKevinEvent({
    level: args.status === "passed" ? "info" : "warn",
    category: "verification",
    message: `Verification ${args.status}: ${args.capabilityKey}${args.deviation ? " — " + args.deviation : ""}`,
    intentId: args.intentId,
    capabilityKey: args.capabilityKey,
    orgId: args.orgId,
    correlationId: args.correlationId,
  });

export const logKevinEmergency = (args: { action: string; orgId?: string; capabilityKey?: string; activatedBy?: string }) =>
  logKevinEvent({
    level: "alert",
    category: "emergency",
    message: `Emergency: ${args.action}`,
    orgId: args.orgId,
    capabilityKey: args.capabilityKey,
    meta: { activatedBy: args.activatedBy },
  });

export const logKevinDelegation = (args: { depth: number; fromAgent: string; toAgent: string; capabilityKey: string; orgId: string; intentId: string }) =>
  logKevinEvent({
    level: args.depth >= 3 ? "warn" : "info",
    category: "delegation",
    message: `Delegation depth ${args.depth}: ${args.fromAgent} → ${args.toAgent}`,
    capabilityKey: args.capabilityKey,
    orgId: args.orgId,
    intentId: args.intentId,
    delegationDepth: args.depth,
    agentId: args.toAgent,
  });

export const logKevinEmail = (args: { action: "draft_created" | "send_attempted" | "send_confirmed" | "send_failed" | "duplicate_blocked"; orgId: string; recipientHash?: string; correlationId?: string }) =>
  logKevinEvent({
    level: args.action.includes("failed") || args.action === "duplicate_blocked" ? "warn" : "info",
    category: "email",
    message: `Email ${args.action}`,
    orgId: args.orgId,
    correlationId: args.correlationId,
    meta: { recipientHash: args.recipientHash },
  });

// ─── Metrics snapshot (for admin console) ─────────────────────────────────────

export function getObservabilitySnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const [key, val] of _counters.entries()) {
    snapshot[key] = val.count;
  }
  return snapshot;
}

export function getAlertThresholds(): typeof ALERT_THRESHOLDS {
  return { ...ALERT_THRESHOLDS };
}
