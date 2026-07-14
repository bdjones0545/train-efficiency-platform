/**
 * KevinHermesClient — server-only HTTP client for Hermes API Server (profile kevin).
 *
 * Phase 0–1: health + capabilities
 * Phase 2: runs (create/status/stop) + SSE events proxy helper
 *
 * Browser must never import this module or hold KEVIN_HERMES_API_KEY.
 */

export type KevinConfigStatus = {
  integrationEnabled: boolean;
  configured: boolean;
  baseUrl: string | null;
  baseUrlRedacted: string | null;
};

function truthy(v: string | undefined | null): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function getKevinConfig(): KevinConfigStatus {
  const integrationEnabled = truthy(process.env.KEVIN_INTEGRATION_ENABLED);
  const baseUrlRaw = (process.env.KEVIN_HERMES_BASE_URL || "").trim().replace(/\/$/, "");
  const apiKey = (process.env.KEVIN_HERMES_API_KEY || "").trim();
  const configured = Boolean(baseUrlRaw && apiKey);

  let baseUrlRedacted: string | null = null;
  if (baseUrlRaw) {
    try {
      const u = new URL(baseUrlRaw);
      baseUrlRedacted = `${u.protocol}//${u.host}`;
    } catch {
      baseUrlRedacted = "[invalid-url]";
    }
  }

  return {
    integrationEnabled,
    configured,
    baseUrl: configured ? baseUrlRaw : null,
    baseUrlRedacted,
  };
}

export function isKevinIntegrationEnabled(): boolean {
  return getKevinConfig().integrationEnabled;
}

export function isKevinConfigured(): boolean {
  const c = getKevinConfig();
  return c.integrationEnabled && c.configured;
}

export class KevinHermesError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, opts?: { status?: number; code?: string }) {
    super(message);
    this.name = "KevinHermesError";
    this.status = opts?.status;
    this.code = opts?.code;
  }
}

const DEFAULT_TIMEOUT_MS = 8_000;
const RUN_CREATE_TIMEOUT_MS = 30_000;

function requireReadyConfig(): { baseUrl: string; apiKey: string } {
  const cfg = getKevinConfig();
  if (!cfg.integrationEnabled) {
    throw new KevinHermesError("Kevin integration disabled", { code: "KEVIN_DISABLED" });
  }
  if (!cfg.configured || !cfg.baseUrl) {
    throw new KevinHermesError("Kevin Hermes endpoint not configured", {
      code: "KEVIN_UNCONFIGURED",
    });
  }
  const apiKey = (process.env.KEVIN_HERMES_API_KEY || "").trim();
  return { baseUrl: cfg.baseUrl, apiKey };
}

async function kevinFetch(
  path: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ status: number; body: any; raw: string }> {
  const { baseUrl, apiKey } = requireReadyConfig();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": "TrainEfficiency-KevinHermesClient/0.2",
        ...(options.headers || {}),
      },
    });
  } catch (err: any) {
    const msg =
      err?.name === "TimeoutError"
        ? `Kevin Hermes timeout after ${timeoutMs}ms`
        : `Kevin Hermes unreachable: ${err?.message || String(err)}`;
    throw new KevinHermesError(msg, { code: "KEVIN_UNAVAILABLE" });
  }

  const raw = await res.text();
  let body: any = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw };
    }
  }

  if (!res.ok) {
    const message =
      body?.error?.message || body?.message || body?.error || `HTTP ${res.status}`;
    throw new KevinHermesError(String(message), {
      status: res.status,
      code: res.status === 401 ? "KEVIN_AUTH" : res.status === 429 ? "KEVIN_BUSY" : "KEVIN_HTTP",
    });
  }

  return { status: res.status, body, raw };
}

export async function fetchHermesHealth(): Promise<any> {
  const { body } = await kevinFetch("/health", { method: "GET" }, 5_000);
  return body;
}

export async function fetchHermesHealthDetailed(): Promise<any> {
  const { body } = await kevinFetch("/health/detailed", { method: "GET" }, 8_000);
  return body;
}

export async function fetchHermesCapabilities(): Promise<any> {
  const { body } = await kevinFetch("/v1/capabilities", { method: "GET" }, 8_000);
  return body;
}

// ─── Phase 2: runs ────────────────────────────────────────────────────────────

export type HermesCreateRunInput = {
  input: string;
  instructions?: string;
  sessionId?: string;
  model?: string;
  conversationHistory?: { role: string; content: string }[];
};

export type HermesCreateRunResult = {
  runId: string;
  status: string;
  raw: any;
};

export async function hermesCreateRun(
  input: HermesCreateRunInput,
): Promise<HermesCreateRunResult> {
  const body: Record<string, unknown> = {
    input: input.input,
  };
  if (input.instructions) body.instructions = input.instructions;
  if (input.sessionId) body.session_id = input.sessionId;
  if (input.model) body.model = input.model;
  if (input.conversationHistory?.length) {
    body.conversation_history = input.conversationHistory;
  }

  const { body: resBody } = await kevinFetch(
    "/v1/runs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    RUN_CREATE_TIMEOUT_MS,
  );

  const runId = String(resBody?.run_id || "");
  if (!runId) {
    throw new KevinHermesError("Hermes create run missing run_id", {
      code: "KEVIN_BAD_RESPONSE",
    });
  }
  return {
    runId,
    status: String(resBody?.status || "started"),
    raw: resBody,
  };
}

export async function hermesGetRun(hermesRunId: string): Promise<any> {
  const { body } = await kevinFetch(`/v1/runs/${encodeURIComponent(hermesRunId)}`, {
    method: "GET",
  });
  return body;
}

export async function hermesStopRun(hermesRunId: string): Promise<any> {
  const { body } = await kevinFetch(
    `/v1/runs/${encodeURIComponent(hermesRunId)}/stop`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    15_000,
  );
  return body;
}

/**
 * Open Hermes run events SSE as a raw Response (stream body).
 * Caller must pipe/consume; does not buffer entire stream.
 */
export async function hermesOpenRunEvents(
  hermesRunId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const { baseUrl, apiKey } = requireReadyConfig();
  const url = `${baseUrl}/v1/runs/${encodeURIComponent(hermesRunId)}/events`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
        "User-Agent": "TrainEfficiency-KevinHermesClient/0.2",
      },
    });
  } catch (err: any) {
    throw new KevinHermesError(
      `Kevin Hermes events unreachable: ${err?.message || String(err)}`,
      { code: "KEVIN_UNAVAILABLE" },
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new KevinHermesError(text || `HTTP ${res.status}`, {
      status: res.status,
      code: res.status === 404 ? "KEVIN_RUN_NOT_FOUND" : "KEVIN_HTTP",
    });
  }
  return res;
}

export interface AggregatedKevinHealth {
  status: "healthy" | "degraded" | "down" | "unconfigured";
  hermesReachable: boolean;
  integrationEnabled: boolean;
  configured: boolean;
  gatewayState?: string | null;
  activeRuns?: number | null;
  modelConfigured?: boolean | null;
  features?: {
    runs: boolean;
    sse: boolean;
    approvals: boolean;
  } | null;
  lastError?: string | null;
  checkedAt: string;
  baseUrlRedacted?: string | null;
  hermesHealth?: any;
  hermesDetailed?: any;
}

export async function getKevinHealth(): Promise<AggregatedKevinHealth> {
  const checkedAt = new Date().toISOString();
  const cfg = getKevinConfig();

  if (!cfg.integrationEnabled || !cfg.configured) {
    return {
      status: "unconfigured",
      hermesReachable: false,
      integrationEnabled: cfg.integrationEnabled,
      configured: cfg.configured,
      lastError: !cfg.integrationEnabled
        ? "KEVIN_INTEGRATION_ENABLED is not true"
        : "KEVIN_HERMES_BASE_URL and/or KEVIN_HERMES_API_KEY missing",
      checkedAt,
      baseUrlRedacted: cfg.baseUrlRedacted,
      features: null,
    };
  }

  try {
    const detailed = await fetchHermesHealthDetailed();
    const readinessStatus = String(
      detailed?.status || detailed?.readiness?.status || "unknown",
    ).toLowerCase();
    const gatewayState = detailed?.gateway_state ?? null;
    const activeRuns =
      detailed?.readiness?.active_api_runs ?? detailed?.active_agents ?? null;

    let status: AggregatedKevinHealth["status"] = "healthy";
    if (
      readinessStatus.includes("degrad") ||
      readinessStatus === "busy" ||
      (typeof activeRuns === "number" && activeRuns > 8)
    ) {
      status = "degraded";
    }
    if (
      readinessStatus === "down" ||
      readinessStatus === "unhealthy" ||
      readinessStatus === "error"
    ) {
      status = "down";
    }

    let features: AggregatedKevinHealth["features"] = {
      runs: true,
      sse: true,
      approvals: true,
    };
    try {
      const caps = await fetchHermesCapabilities();
      const f = caps?.features || {};
      features = {
        runs: Boolean(f.run_submission ?? f.runs ?? true),
        sse: Boolean(f.run_events_sse ?? f.chat_completions_streaming ?? true),
        approvals: Boolean(f.run_approval_response ?? f.approval_events ?? true),
      };
    } catch {
      // keep defaults
    }

    return {
      status,
      hermesReachable: true,
      integrationEnabled: true,
      configured: true,
      gatewayState,
      activeRuns: typeof activeRuns === "number" ? activeRuns : null,
      modelConfigured: Boolean(detailed?.readiness?.model || detailed?.model),
      features,
      lastError: null,
      checkedAt,
      baseUrlRedacted: cfg.baseUrlRedacted,
      hermesDetailed: detailed,
    };
  } catch (err: any) {
    try {
      const basic = await fetchHermesHealth();
      return {
        status: "degraded",
        hermesReachable: true,
        integrationEnabled: true,
        configured: true,
        lastError: `detailed health failed: ${err?.message || err}; basic ok`,
        checkedAt,
        baseUrlRedacted: cfg.baseUrlRedacted,
        hermesHealth: basic,
        features: { runs: true, sse: true, approvals: true },
      };
    } catch (err2: any) {
      return {
        status: "down",
        hermesReachable: false,
        integrationEnabled: true,
        configured: true,
        lastError: err2?.message || err?.message || String(err2 || err),
        checkedAt,
        baseUrlRedacted: cfg.baseUrlRedacted,
        features: null,
      };
    }
  }
}

export async function getKevinCapabilitiesView(): Promise<{
  status: AggregatedKevinHealth["status"];
  hermes: any | null;
  teFeatureFlags: {
    integrationEnabled: boolean;
    coachAccess: "none";
    phase: "2";
  };
  checkedAt: string;
  error?: string | null;
}> {
  const checkedAt = new Date().toISOString();
  const cfg = getKevinConfig();
  const teFeatureFlags = {
    integrationEnabled: cfg.integrationEnabled,
    coachAccess: "none" as const,
    phase: "2" as const,
  };

  if (!cfg.integrationEnabled || !cfg.configured) {
    return {
      status: "unconfigured",
      hermes: null,
      teFeatureFlags,
      checkedAt,
      error: !cfg.integrationEnabled
        ? "KEVIN_INTEGRATION_ENABLED is not true"
        : "Missing KEVIN_HERMES_BASE_URL or KEVIN_HERMES_API_KEY",
    };
  }

  try {
    const hermes = await fetchHermesCapabilities();
    return {
      status: "healthy",
      hermes,
      teFeatureFlags,
      checkedAt,
      error: null,
    };
  } catch (err: any) {
    return {
      status: "down",
      hermes: null,
      teFeatureFlags,
      checkedAt,
      error: err?.message || String(err),
    };
  }
}

/** Map Hermes run event → TE KevinSseEvent shape */
export function mapHermesEventToKevinSse(
  hermesEvent: any,
  teRunId: string,
): Record<string, unknown> | null {
  if (!hermesEvent || typeof hermesEvent !== "object") return null;
  const ev = String(hermesEvent.event || hermesEvent.type || "");
  const at = new Date(
    typeof hermesEvent.timestamp === "number"
      ? hermesEvent.timestamp * 1000
      : Date.now(),
  ).toISOString();

  if (ev === "message.delta" || hermesEvent.delta) {
    return {
      type: "message.delta",
      runId: teRunId,
      delta: String(hermesEvent.delta ?? hermesEvent.content ?? ""),
      at,
    };
  }
  if (ev.includes("approval") && (ev.includes("request") || hermesEvent.approval)) {
    return {
      type: "approval.requested",
      runId: teRunId,
      approvalId: String(hermesEvent.approval_id || hermesEvent.id || teRunId),
      summary: String(
        hermesEvent.summary || hermesEvent.command || hermesEvent.message || "Host approval required",
      ),
      riskClass: hermesEvent.risk_class || "high",
      details: hermesEvent,
      at,
    };
  }
  if (ev === "approval.responded") {
    return {
      type: "approval.responded",
      runId: teRunId,
      choice: hermesEvent.choice,
      at,
    };
  }
  if (
    ev.includes("tool") ||
    ev === "tool.progress" ||
    hermesEvent.tool ||
    hermesEvent.tool_name
  ) {
    return {
      type: "tool.progress",
      runId: teRunId,
      tool: hermesEvent.tool || hermesEvent.tool_name,
      message: hermesEvent.message || hermesEvent.status,
      data: hermesEvent,
      at,
    };
  }
  if (
    ev.includes("complete") ||
    ev === "run.completed" ||
    hermesEvent.status === "completed"
  ) {
    return {
      type: "run.completed",
      runId: teRunId,
      summary: hermesEvent.summary || hermesEvent.output || hermesEvent.message,
      at,
    };
  }
  if (ev.includes("fail") || hermesEvent.status === "failed" || ev === "error") {
    return {
      type: "run.failed",
      runId: teRunId,
      message: String(hermesEvent.message || hermesEvent.error || "Run failed"),
      code: hermesEvent.code,
      at,
    };
  }
  if (ev.includes("status") || hermesEvent.status) {
    return {
      type: "run.status",
      runId: teRunId,
      status: String(hermesEvent.status || ev),
      at,
    };
  }
  // passthrough unknown as tool.progress-ish envelope
  return {
    type: "tool.progress",
    runId: teRunId,
    message: ev || "event",
    data: hermesEvent,
    at,
  };
}

// ─── Phase 3: Event submission ────────────────────────────────────────────────

export type HermesEventInput = {
  eventId: string;
  orgId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  traceId?: string;
};

/**
 * Submit a TE event to Hermes for Kevin's learning pipeline.
 *
 * NOTE: Hermes /v1/events endpoint is not yet available.
 * This function is implemented and ready; dispatch is gated behind
 * KEVIN_EVENT_DISPATCH_ENABLED. When Hermes provides the endpoint,
 * enable dispatch and this queue will drain automatically.
 *
 * Required Hermes endpoint:
 *   POST /v1/events
 *   Body: { event_id, org_id, event_type, entity_type, entity_id,
 *           payload, occurred_at, trace_id }
 *   Response: { ok: true, event_id: string }
 */
export async function hermesSubmitEvent(input: HermesEventInput): Promise<void> {
  const { baseUrl, apiKey } = requireReadyConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(`${baseUrl}/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-TE-Version": "3",
      },
      body: JSON.stringify({
        event_id: input.eventId,
        org_id: input.orgId,
        event_type: input.eventType,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        payload: input.payload,
        occurred_at: input.occurredAt,
        trace_id: input.traceId ?? input.eventId,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new KevinHermesError(`Hermes /v1/events ${resp.status}: ${text.slice(0, 200)}`, {
        status: resp.status,
        code: "HERMES_EVENT_ERROR",
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Phase 3: Outcome submission ──────────────────────────────────────────────

export type HermesOutcomeInput = {
  outcomeId: string;
  orgId: string;
  outcomeType: string;
  signalId?: string;
  contextRequestId?: string;
  entityType?: string;
  entityId?: string;
  wasUseful?: boolean;
  wasModified?: boolean;
  summary?: string;
  occurredAt: string;
};

/**
 * Forward a TE outcome to Hermes for closed-loop learning.
 *
 * NOTE: Hermes /v1/outcomes endpoint is not yet available.
 * Gated behind KEVIN_OUTCOME_FORWARDING_ENABLED.
 *
 * Required Hermes endpoint:
 *   POST /v1/outcomes
 *   Body: { outcome_id, org_id, outcome_type, signal_id, context_request_id,
 *           entity_type, entity_id, was_useful, was_modified, summary, occurred_at }
 *   Response: { ok: true, outcome_id: string }
 */
export async function hermesSubmitOutcome(input: HermesOutcomeInput): Promise<void> {
  const { baseUrl, apiKey } = requireReadyConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(`${baseUrl}/v1/outcomes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-TE-Version": "3",
      },
      body: JSON.stringify({
        outcome_id: input.outcomeId,
        org_id: input.orgId,
        outcome_type: input.outcomeType,
        signal_id: input.signalId ?? null,
        context_request_id: input.contextRequestId ?? null,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        was_useful: input.wasUseful ?? null,
        was_modified: input.wasModified ?? null,
        summary: input.summary ?? null,
        occurred_at: input.occurredAt,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new KevinHermesError(`Hermes /v1/outcomes ${resp.status}: ${text.slice(0, 200)}`, {
        status: resp.status,
        code: "HERMES_OUTCOME_ERROR",
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Phase 3: Context query ───────────────────────────────────────────────────

export type HermesContextQueryInput = {
  orgId: string;
  agentType: string;
  workflow: string;
  entityType?: string;
  entityId?: string;
  question: string;
  traceId: string;
  depth: number;
  requestedMemoryTypes?: string[];
  maxResults?: number;
  timeoutMs?: number;
};

/**
 * Query Kevin/Hermes for historical context relevant to an agent's current task.
 *
 * Required Hermes endpoint:
 *   POST /v1/context/query
 *   Body: { org_id, agent_type, workflow, entity_type, entity_id,
 *           question, trace_id, depth, requested_memory_types, max_results }
 *   Response: { summary, memories: [{id, type, summary, confidence, occurred_at}],
 *               patterns, prior_decisions, risks, confidence }
 *
 * PII rules (enforced by caller, reiterated here):
 * - Never send athlete names, emails, phone numbers
 * - Never send raw email content
 * - Never send payment details or credentials
 * - Send only aggregated counts, statuses, and high-level summaries
 */
export async function hermesContextQuery(
  input: HermesContextQueryInput,
): Promise<Record<string, unknown>> {
  const { baseUrl, apiKey } = requireReadyConfig();
  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 10_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/v1/context/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-TE-Version": "3",
      },
      body: JSON.stringify({
        org_id: input.orgId,
        agent_type: input.agentType,
        workflow: input.workflow,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        question: input.question,
        trace_id: input.traceId,
        depth: input.depth,
        requested_memory_types: input.requestedMemoryTypes ?? null,
        max_results: input.maxResults ?? 8,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new KevinHermesError(
        `Hermes /v1/context/query ${resp.status}: ${text.slice(0, 200)}`,
        { status: resp.status, code: "HERMES_CONTEXT_ERROR" },
      );
    }
    return (await resp.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}
