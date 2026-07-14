/**
 * Kevin → TrainEfficiency Control-Plane Client — Step 3
 *
 * Reusable signed HTTP client for all Kevin→TE communication.
 *
 * Supports:
 *   - Signed request generation (HMAC-SHA256 over canonical request)
 *   - Timestamp + nonce replay protection
 *   - Idempotency keys
 *   - Correlation IDs
 *   - Configurable timeout (AbortSignal)
 *   - Bounded retry with backoff (transient errors only)
 *   - Typed response/error parsing
 *   - Sensitive-field redaction in diagnostics
 *   - Health checks, capability discovery, intent/task/approval lifecycle
 *
 * DO NOT RETRY: policy denials, invalid signatures, revoked credentials,
 * cross-org denials, malformed payloads, disabled capabilities, emergency stops.
 */

import { createHmac, randomUUID, createHash } from "crypto";
import { loadTeConfig, redactHeaders, type TeConfig } from "./config";
import { isNonRetryable, isRetryable, detectEmergencyCondition, handleEmergency } from "./emergency-handler";
import {
  obsAuth, obsCapabilityDiscovery, obsIntentSubmit, obsIntentStateChange,
  obsTaskStateChange, obsApprovalStateChange, obsRetry, obsPolicyDenial,
  obsVerificationFailed, obsRequestSent, obsRequestError,
} from "./observability";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TeRequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  correlationId?: string;
  orgId?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface TeResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  correlationId?: string;
  requestId?: string;
}

export interface TeError {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
  emergency?: string;
}

export type IntentState =
  | "received" | "validating" | "planned" | "awaiting_approval"
  | "queued" | "executing" | "verifying" | "completed"
  | "partially_completed" | "failed" | "cancelled" | "dead_lettered";

export const TERMINAL_INTENT_STATES = new Set<IntentState>([
  "completed", "partially_completed", "failed", "cancelled", "dead_lettered",
]);

export type TaskState =
  | "created" | "blocked" | "queued" | "claimed" | "executing"
  | "awaiting_approval" | "awaiting_dependency" | "verifying"
  | "completed" | "failed" | "cancelled" | "dead_lettered";

export const TERMINAL_TASK_STATES = new Set<TaskState>([
  "completed", "failed", "cancelled", "dead_lettered",
]);

export type ApprovalState = "pending" | "approved" | "rejected" | "expired" | "cancelled";
export const TERMINAL_APPROVAL_STATES = new Set<ApprovalState>([
  "approved", "rejected", "expired", "cancelled",
]);

export interface IntentSubmitArgs {
  organizationId: string;
  initiatingUserId?: string;
  capabilityKey: string;
  capabilityVersion?: string;
  requestedMode?: string;
  goal: string;
  reason: string;
  confidence: number;
  structuredArgs?: Record<string, unknown>;
  sourceContext?: Record<string, unknown>;
  idempotencyKey?: string;
  correlationId?: string;
}

export interface IntentRecord {
  id: string;
  state: IntentState;
  capabilityKey: string;
  goal: string;
  organizationId: string;
  requestedMode?: string;
  createdAt?: string;
  updatedAt?: string;
  tasks?: TaskRecord[];
  approvals?: ApprovalRecord[];
  verificationResult?: unknown;
  outcome?: unknown;
}

export interface TaskRecord {
  id: string;
  intentId: string;
  state: TaskState;
  capabilityKey: string;
  assignedAgent?: string;
  output?: unknown;
  error?: string;
}

export interface ApprovalRecord {
  id: string;
  intentId: string;
  state: ApprovalState;
  capabilityKey: string;
  riskLevel?: string;
  summary?: string;
  createdAt?: string;
  expiresAt?: string;
}

export interface CapabilityRecord {
  key: string;
  displayName: string;
  description: string;
  category: string;
  riskLevel: string;
  permittedRoles: string[];
  supportedModes: string[];
  defaultMode: string;
  requiresApprovalAt?: string;
  executorService: string;
  verificationStrategy: string;
  isReversible: boolean;
  timeoutSeconds: number;
  idempotent: boolean;
  auditRequired: boolean;
  availability?: "available" | "disabled" | "unknown";
}

// ─── Signing ──────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure nonce.
 */
export function generateNonce(): string {
  return randomUUID();
}

/**
 * Generate a current Unix millisecond timestamp.
 */
export function generateTimestamp(): number {
  return Date.now();
}

/**
 * Generate an idempotency key from a stable operation signature.
 */
export function generateIdempotencyKey(prefix: string, ...parts: string[]): string {
  const hash = createHash("sha256").update([prefix, ...parts].join(":")).digest("hex").slice(0, 16);
  return `${prefix}-${hash}`;
}

/**
 * Build the canonical request string for HMAC signing.
 * Format: METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body)
 */
function buildCanonicalRequest(method: string, path: string, timestamp: number, nonce: string, body: string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return [method.toUpperCase(), path, String(timestamp), nonce, bodyHash].join("\n");
}

/**
 * Sign the canonical request with HMAC-SHA256.
 * Returns the hex digest — safe to send as X-Kevin-Signature header.
 */
function signRequest(signingSecret: string, canonical: string): string {
  return createHmac("sha256", signingSecret).update(canonical).digest("hex");
}

// ─── HTTP Client ──────────────────────────────────────────────────────────────

export class TrainEfficiencyClient {
  private cfg: TeConfig;

  constructor(cfg?: TeConfig) {
    this.cfg = cfg ?? loadTeConfig();
  }

  /**
   * Execute a signed request to the TE control plane.
   * Handles retries for transient failures only.
   * Never retries non-retryable error codes.
   */
  async request<T = unknown>(opts: TeRequestOptions): Promise<TeResponse<T>> {
    const correlationId = opts.correlationId ?? randomUUID();
    const timeoutMs = opts.timeoutMs ?? this.cfg.requestTimeoutMs;
    const maxRetries = opts.maxRetries ?? 2;
    const bodyStr = opts.body ? JSON.stringify(opts.body) : "";
    const url = `${this.cfg.baseUrl}${opts.path}`;

    let lastError: TeError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const timestamp = generateTimestamp();
      const nonce = generateNonce();
      const canonical = buildCanonicalRequest(opts.method, opts.path, timestamp, nonce, bodyStr);
      const signature = signRequest(this.cfg.signingSecret, canonical);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.cfg.bearerToken}`,
        "X-Kevin-Timestamp": String(timestamp),
        "X-Kevin-Nonce": nonce,
        "X-Kevin-Signature": signature,
        "X-Kevin-Service-ID": this.cfg.serviceId,
        "X-Kevin-Key-ID": this.cfg.keyId,
        "X-Correlation-ID": correlationId,
      };
      if (opts.idempotencyKey) headers["X-Idempotency-Key"] = opts.idempotencyKey;
      if (opts.orgId) headers["X-Org-ID"] = opts.orgId;

      if (attempt > 0) {
        obsRetry({ attempt, maxAttempts: maxRetries, reason: lastError?.message ?? "transient", capabilityKey: undefined, correlationId });
        await _sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }

      obsRequestSent({ method: opts.method, path: opts.path, correlationId, headers });

      const startMs = Date.now();
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: opts.method,
          headers,
          body: opts.body ? bodyStr : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeoutHandle);
        const durationMs = Date.now() - startMs;

        let parsed: unknown;
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          parsed = await res.json();
        } else {
          parsed = { raw: await res.text() };
        }

        if (res.ok) {
          if (attempt === 0) obsAuth({ success: true, correlationId });
          return {
            ok: true,
            status: res.status,
            data: parsed as T,
            correlationId,
            requestId: res.headers.get("x-request-id") ?? undefined,
          };
        }

        // Parse error
        const errBody = (parsed ?? {}) as Record<string, unknown>;
        const errorCode = (errBody.code ?? errBody.error ?? "UNKNOWN_ERROR") as string;
        const errorMsg  = (errBody.message ?? errBody.error ?? String(parsed)) as string;

        obsRequestError({ method: opts.method, path: opts.path, statusCode: res.status, errorCode, correlationId, durationMs });

        // Check for auth failure
        if (res.status === 401 || res.status === 403) {
          obsAuth({ success: false, correlationId, reason: errorMsg });
        }

        // Check for policy denial
        if (errorCode === "POLICY_DENIED") {
          obsPolicyDenial({ code: errorCode, reason: errorMsg, correlationId });
        }

        // Check for emergency condition
        const emergency = detectEmergencyCondition(errorCode, res.status, errBody);
        if (emergency) {
          handleEmergency(emergency, { correlationId });
        }

        lastError = {
          code: errorCode,
          message: errorMsg,
          status: res.status,
          retryable: isRetryable(errorCode, res.status),
          emergency: emergency ?? undefined,
        };

        if (!lastError.retryable || attempt >= maxRetries) break;

      } catch (err: unknown) {
        clearTimeout(timeoutHandle);
        const isAbort = (err as Error)?.name === "AbortError";
        lastError = {
          code: isAbort ? "TIMEOUT" : "NETWORK_ERROR",
          message: isAbort ? "Request timed out" : String((err as Error)?.message),
          status: 0,
          retryable: isRetryable(isAbort ? "TIMEOUT" : "NETWORK_ERROR"),
        };
        obsRequestError({ method: opts.method, path: opts.path, errorCode: lastError.code, correlationId });
        if (!lastError.retryable || attempt >= maxRetries) break;
      }
    }

    throw lastError ?? { code: "UNKNOWN_ERROR", message: "Request failed", status: 0, retryable: false };
  }

  // ─── Health & Discovery ─────────────────────────────────────────────────────

  async health(correlationId?: string): Promise<{ status: string; version: string; capabilities: number; timestamp: string }> {
    const res = await this.request({ method: "GET", path: "/api/internal/kevin/v1/health", correlationId, maxRetries: 1 });
    return res.data as any;
  }

  async getDocs(correlationId?: string): Promise<Record<string, unknown>> {
    const res = await this.request({ method: "GET", path: "/api/internal/kevin/v1/docs", correlationId, maxRetries: 1 });
    return res.data as any;
  }

  async listCapabilities(orgId: string, correlationId?: string): Promise<{ capabilities: CapabilityRecord[] }> {
    const startMs = Date.now();
    const res = await this.request<{ capabilities: CapabilityRecord[] }>({
      method: "GET",
      path: "/api/internal/kevin/v1/capabilities",
      orgId,
      correlationId,
    });
    obsCapabilityDiscovery({ count: res.data.capabilities?.length ?? 0, correlationId, durationMs: Date.now() - startMs });
    return res.data;
  }

  async getCapability(key: string, orgId: string, correlationId?: string): Promise<{ capability: CapabilityRecord }> {
    const res = await this.request<{ capability: CapabilityRecord }>({
      method: "GET",
      path: `/api/internal/kevin/v1/capabilities/${encodeURIComponent(key)}`,
      orgId,
      correlationId,
    });
    return res.data;
  }

  // ─── Intent Lifecycle ───────────────────────────────────────────────────────

  async submitIntent(args: IntentSubmitArgs): Promise<{ intent: IntentRecord }> {
    const correlationId = args.correlationId ?? randomUUID();
    const idempotencyKey = args.idempotencyKey ?? generateIdempotencyKey("intent", args.capabilityKey, args.goal.slice(0, 32), args.organizationId);

    const res = await this.request<{ intent: IntentRecord }>({
      method: "POST",
      path: "/api/internal/kevin/v1/intents",
      body: {
        requestId: randomUUID(),
        idempotencyKey,
        correlationId,
        organizationId: args.organizationId,
        initiatingUserId: args.initiatingUserId,
        capabilityKey: args.capabilityKey,
        capabilityVersion: args.capabilityVersion ?? "1",
        requestedMode: args.requestedMode,
        goal: args.goal,
        reason: args.reason,
        confidence: args.confidence,
        structuredArgs: args.structuredArgs ?? {},
        sourceContext: args.sourceContext ?? { channel: "kevin_executive_agent" },
      },
      idempotencyKey,
      correlationId,
      orgId: args.organizationId,
      maxRetries: 1, // single retry on intent submission
    });

    obsIntentSubmit({ intentId: res.data.intent?.id, capabilityKey: args.capabilityKey, correlationId, orgId: args.organizationId });
    return res.data;
  }

  async getIntent(intentId: string, orgId: string, correlationId?: string): Promise<{ intent: IntentRecord }> {
    const res = await this.request<{ intent: IntentRecord }>({
      method: "GET",
      path: `/api/internal/kevin/v1/intents/${intentId}`,
      orgId,
      correlationId,
    });
    return res.data;
  }

  async listIntents(orgId: string, correlationId?: string): Promise<{ intents: IntentRecord[] }> {
    const res = await this.request<{ intents: IntentRecord[] }>({
      method: "GET",
      path: "/api/internal/kevin/v1/intents",
      orgId,
      correlationId,
    });
    return res.data;
  }

  async cancelIntent(intentId: string, orgId: string, reason: string, correlationId?: string): Promise<{ intent: IntentRecord }> {
    const res = await this.request<{ intent: IntentRecord }>({
      method: "POST",
      path: `/api/internal/kevin/v1/intents/${intentId}/cancel`,
      body: { reason },
      orgId,
      correlationId,
    });
    return res.data;
  }

  // ─── Task Lifecycle ─────────────────────────────────────────────────────────

  async getTask(taskId: string, orgId: string, correlationId?: string): Promise<{ task: TaskRecord }> {
    const res = await this.request<{ task: TaskRecord }>({
      method: "GET",
      path: `/api/internal/kevin/v1/tasks/${taskId}`,
      orgId,
      correlationId,
    });
    return res.data;
  }

  async submitTaskOutput(taskId: string, orgId: string, output: unknown, status: "completed" | "failed", correlationId?: string): Promise<void> {
    await this.request({
      method: "POST",
      path: `/api/internal/kevin/v1/tasks/${taskId}/output`,
      body: { output, status },
      orgId,
      correlationId,
    });
  }

  // ─── Approval Lifecycle ─────────────────────────────────────────────────────

  async getApproval(approvalId: string, orgId: string, correlationId?: string): Promise<{ approval: ApprovalRecord }> {
    const res = await this.request<{ approval: ApprovalRecord }>({
      method: "GET",
      path: `/api/internal/kevin/v1/approvals/${approvalId}`,
      orgId,
      correlationId,
    });
    return res.data;
  }

  async createApproval(args: { intentId: string; capabilityKey: string; riskLevel: string; summary: string; payload: unknown; orgId: string; correlationId?: string }): Promise<{ approval: ApprovalRecord }> {
    const res = await this.request<{ approval: ApprovalRecord }>({
      method: "POST",
      path: "/api/internal/kevin/v1/approvals",
      body: { intentId: args.intentId, capabilityKey: args.capabilityKey, riskLevel: args.riskLevel, summary: args.summary, payload: args.payload },
      orgId: args.orgId,
      correlationId: args.correlationId,
    });
    return res.data;
  }

  // ─── AgentMail Bridge ───────────────────────────────────────────────────────

  async createEmailDraft(args: { intentId: string; recipient: string; subject: string; body: string; orgId: string; correlationId?: string }): Promise<{ draft: Record<string, unknown> }> {
    const res = await this.request<{ draft: Record<string, unknown> }>({
      method: "POST",
      path: "/api/internal/kevin/v1/agentmail/draft",
      body: { intentId: args.intentId, recipient: args.recipient, subject: args.subject, body: args.body },
      orgId: args.orgId,
      idempotencyKey: generateIdempotencyKey("draft", args.intentId, args.recipient),
      correlationId: args.correlationId,
      maxRetries: 0, // email drafts are not retried
    });
    return res.data;
  }

  // ─── CEO Bridge ─────────────────────────────────────────────────────────────

  async requestCeoAnalysis(args: { question: string; context?: string; intentId?: string; orgId: string; correlationId?: string }): Promise<{ analysis: string; recommendations: string[] }> {
    const res = await this.request<{ analysis: string; recommendations: string[] }>({
      method: "POST",
      path: "/api/internal/kevin/v1/ceo/analyze",
      body: { question: args.question, context: args.context, intentId: args.intentId },
      orgId: args.orgId,
      correlationId: args.correlationId,
    });
    return res.data;
  }

  async escalateRisk(args: { summary: string; riskLevel: string; intentId?: string; orgId: string; correlationId?: string }): Promise<{ escalated: boolean }> {
    const res = await this.request<{ escalated: boolean }>({
      method: "POST",
      path: "/api/internal/kevin/v1/ceo/escalate",
      body: { summary: args.summary, riskLevel: args.riskLevel, intentId: args.intentId },
      orgId: args.orgId,
      correlationId: args.correlationId,
    });
    return res.data;
  }

  // ─── Verification & Outcomes ────────────────────────────────────────────────

  async submitVerification(args: { intentId: string; capabilityKey: string; resourceId: string; taskId?: string; additionalArgs?: Record<string, unknown>; orgId: string; correlationId?: string }): Promise<{ verification: Record<string, unknown> }> {
    const res = await this.request<{ verification: Record<string, unknown> }>({
      method: "POST",
      path: "/api/internal/kevin/v1/verify",
      body: { intent_id: args.intentId, capability_key: args.capabilityKey, resource_id: args.resourceId, task_id: args.taskId, additional_args: args.additionalArgs },
      orgId: args.orgId,
      correlationId: args.correlationId,
    });
    return res.data;
  }

  async recordOutcome(args: { intentId: string; capabilityKey: string; outcome: string; downstreamBusinessOutcome?: string; humanFeedback?: string; kevinConfidence?: number; shouldRepeat?: boolean; orgId: string; correlationId?: string }): Promise<void> {
    await this.request({
      method: "POST",
      path: "/api/internal/kevin/v1/outcomes",
      body: {
        intent_id: args.intentId,
        capability_key: args.capabilityKey,
        outcome: args.outcome,
        downstream_business_outcome: args.downstreamBusinessOutcome,
        human_feedback: args.humanFeedback,
        kevin_confidence: args.kevinConfidence,
        should_repeat: args.shouldRepeat,
      },
      orgId: args.orgId,
      correlationId: args.correlationId,
    });
  }

  // ─── Navigation ─────────────────────────────────────────────────────────────

  async navigate(intent: string, orgId: string, correlationId?: string): Promise<{ path?: string; label?: string; reason?: string }> {
    const res = await this.request<{ path?: string; label?: string; reason?: string }>({
      method: "GET",
      path: `/api/internal/kevin/v1/navigate/${encodeURIComponent(intent)}`,
      orgId,
      correlationId,
    });
    return res.data;
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────

  async getStats(orgId: string, correlationId?: string): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>({
      method: "GET",
      path: "/api/internal/kevin/v1/stats",
      orgId,
      correlationId,
    });
    return res.data;
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _client: TrainEfficiencyClient | null = null;

export function getTeClient(): TrainEfficiencyClient {
  if (!_client) _client = new TrainEfficiencyClient();
  return _client;
}

export function resetTeClient(): void {
  _client = null;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function _sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
