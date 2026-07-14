/**
 * Kevin Context Service — Phase 3
 *
 * Allows TrainEfficiency agents to request historical context, patterns,
 * prior decisions, and environmental state from Kevin/Hermes.
 *
 * Feature gates:
 *   KEVIN_INTEGRATION_ENABLED        — master kill switch
 *   KEVIN_CONTEXT_RETRIEVAL_ENABLED  — enables outbound context requests
 *
 * Hermes /v1/context/query endpoint must be available on the Kevin side.
 * If unavailable, returns a graceful empty context. All agents must continue
 * normally when Kevin context is empty or unavailable.
 *
 * Loop prevention: requests with depth > MAX_DEPTH are blocked.
 *
 * PII rules:
 * - NEVER send athlete names, email addresses, phone numbers
 * - NEVER send raw email content
 * - NEVER send payment records
 * - NEVER send credentials or secrets
 * - Send only counts, statuses, and high-level summaries
 */

import { db } from "../db";
import { kevinContextRequests } from "@shared/schema";
import { randomUUID } from "crypto";
import { isKevinConfigured, KevinHermesError } from "./kevin-hermes-client";
import { isKevinCapabilityEnabled } from "./kevin-capability-service";
import { getCircuitState, withCircuitBreaker, recordCircuitFailure } from "./kevin-circuit-breaker";
import type { KevinCapabilityName } from "./kevin-capability-service";

// ─── Config ───────────────────────────────────────────────────────────────────

const CONTEXT_TIMEOUT_MS = 8_000;
const MAX_DEPTH = 3;
const MAX_RESPONSE_MEMORIES = 20;

function isContextRetrievalEnabled(): boolean {
  const master = (process.env.KEVIN_INTEGRATION_ENABLED || "").trim().toLowerCase();
  const ctx = (process.env.KEVIN_CONTEXT_RETRIEVAL_ENABLED || "").trim().toLowerCase();
  const truthy = (v: string) => v === "1" || v === "true" || v === "yes";
  return truthy(master) && truthy(ctx);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type KevinContextRequest = {
  orgId: string;
  agentType: string;
  workflow: string;
  entityType?: string;
  entityId?: string;
  question: string;
  traceId?: string;
  depth?: number;
  requestedMemoryTypes?: string[];
  capability?: KevinCapabilityName;
};

export type KevinContextMemory = {
  id?: string;
  type: string;
  summary: string;
  confidence?: number;
  occurredAt?: string;
};

export type KevinContextResult = {
  available: boolean;
  status:
    | "success"
    | "empty"
    | "disabled"
    | "unavailable"
    | "timeout"
    | "failed"
    | "blocked_loop";
  summary: string;
  memories: KevinContextMemory[];
  patterns: string[];
  priorDecisions: string[];
  risks: string[];
  confidence?: number;
  durationMs: number;
  contextRequestId?: string;
  traceId: string;
  informedByKevin: boolean;
};

const EMPTY_CONTEXT = (
  traceId: string,
  status: KevinContextResult["status"],
  durationMs: number,
  contextRequestId?: string,
): KevinContextResult => ({
  available: false,
  status,
  summary: "",
  memories: [],
  patterns: [],
  priorDecisions: [],
  risks: [],
  durationMs,
  traceId,
  contextRequestId,
  informedByKevin: false,
});

// ─── Trace persistence ────────────────────────────────────────────────────────

async function writeContextTrace(opts: {
  id: string;
  orgId: string;
  agentType: string;
  workflow?: string;
  entityType?: string;
  question?: string;
  status: string;
  responseSummary?: string | null;
  confidence?: number | null;
  memoriesCount?: number;
  durationMs?: number;
  traceId?: string;
  depth?: number;
}): Promise<void> {
  try {
    await db.insert(kevinContextRequests).values({
      id: opts.id,
      orgId: opts.orgId,
      agentType: opts.agentType,
      workflow: opts.workflow ?? null,
      entityType: opts.entityType ?? null,
      question: opts.question ? opts.question.slice(0, 500) : null,
      status: opts.status as any,
      responseSummary: opts.responseSummary ? opts.responseSummary.slice(0, 1000) : null,
      confidence: opts.confidence ?? null,
      memoriesCount: opts.memoriesCount ?? 0,
      durationMs: opts.durationMs ?? null,
      originTraceId: opts.traceId ?? null,
      depth: opts.depth ?? 0,
    });
  } catch (e: any) {
    console.warn("[KevinContext] trace write failed:", e?.message);
  }
}

// ─── Response validation ──────────────────────────────────────────────────────

function validateAndParseContextResponse(raw: unknown): Partial<KevinContextResult> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const summary = typeof r.summary === "string" ? r.summary.slice(0, 2000) : "";

  const memories: KevinContextMemory[] = [];
  if (Array.isArray(r.memories)) {
    for (const m of r.memories.slice(0, MAX_RESPONSE_MEMORIES)) {
      if (typeof m === "object" && m !== null) {
        const mem = m as Record<string, unknown>;
        memories.push({
          id: typeof mem.id === "string" ? mem.id : undefined,
          type: typeof mem.type === "string" ? mem.type.slice(0, 100) : "memory",
          summary: typeof mem.summary === "string" ? mem.summary.slice(0, 500) : "",
          confidence: typeof mem.confidence === "number" ? Math.min(1, Math.max(0, mem.confidence)) : undefined,
          occurredAt: typeof mem.occurred_at === "string" ? mem.occurred_at : undefined,
        });
      }
    }
  }

  const patterns = Array.isArray(r.patterns)
    ? (r.patterns as unknown[]).filter((p) => typeof p === "string").map((p) => (p as string).slice(0, 300)).slice(0, 10)
    : [];

  const priorDecisions = Array.isArray(r.prior_decisions)
    ? (r.prior_decisions as unknown[]).filter((d) => typeof d === "string").map((d) => (d as string).slice(0, 300)).slice(0, 10)
    : [];

  const risks = Array.isArray(r.risks)
    ? (r.risks as unknown[]).filter((x) => typeof x === "string").map((x) => (x as string).slice(0, 300)).slice(0, 10)
    : [];

  const confidence = typeof r.confidence === "number"
    ? Math.min(1, Math.max(0, r.confidence))
    : undefined;

  return { summary, memories, patterns, priorDecisions, risks, confidence };
}

// ─── Main request ─────────────────────────────────────────────────────────────

/**
 * Request context from Kevin for a given agent and workflow.
 * Always returns a valid KevinContextResult — never throws.
 */
export async function requestKevinContext(
  input: KevinContextRequest,
): Promise<KevinContextResult> {
  const start = Date.now();
  const traceId = input.traceId ?? randomUUID();
  const reqId = randomUUID();
  const depth = input.depth ?? 0;

  // ── 1. Loop prevention ─────────────────────────────────────────────────────
  if (depth > MAX_DEPTH) {
    await writeContextTrace({
      id: reqId,
      orgId: input.orgId,
      agentType: input.agentType,
      workflow: input.workflow,
      question: input.question,
      status: "blocked_loop",
      durationMs: Date.now() - start,
      traceId,
      depth,
    });
    return EMPTY_CONTEXT(traceId, "blocked_loop", Date.now() - start, reqId);
  }

  // ── 2. Master feature flags ────────────────────────────────────────────────
  if (!isContextRetrievalEnabled() || !isKevinConfigured()) {
    await writeContextTrace({
      id: reqId,
      orgId: input.orgId,
      agentType: input.agentType,
      workflow: input.workflow,
      question: input.question,
      status: "disabled",
      durationMs: Date.now() - start,
      traceId,
      depth,
    });
    return EMPTY_CONTEXT(traceId, "disabled", Date.now() - start, reqId);
  }

  // ── 3. Capability check ────────────────────────────────────────────────────
  const cap = input.capability ?? "cross_application_context";
  const capEnabled = await isKevinCapabilityEnabled(input.orgId, cap, "observe");
  if (!capEnabled) {
    await writeContextTrace({
      id: reqId,
      orgId: input.orgId,
      agentType: input.agentType,
      workflow: input.workflow,
      status: "disabled",
      durationMs: Date.now() - start,
      traceId,
      depth,
    });
    return EMPTY_CONTEXT(traceId, "disabled", Date.now() - start, reqId);
  }

  // ── 4. Circuit breaker ─────────────────────────────────────────────────────
  if (getCircuitState() === "open") {
    await writeContextTrace({
      id: reqId,
      orgId: input.orgId,
      agentType: input.agentType,
      workflow: input.workflow,
      status: "unavailable",
      durationMs: Date.now() - start,
      traceId,
      depth,
    });
    return EMPTY_CONTEXT(traceId, "unavailable", Date.now() - start, reqId);
  }

  // ── 5. Call Hermes ─────────────────────────────────────────────────────────
  try {
    const result = await withCircuitBreaker(
      async () => {
        const { hermesContextQuery } = await import("./kevin-hermes-client");
        return hermesContextQuery({
          orgId: input.orgId,
          agentType: input.agentType,
          workflow: input.workflow,
          entityType: input.entityType,
          entityId: input.entityId,
          question: input.question.slice(0, 1000),
          traceId,
          depth,
          requestedMemoryTypes: input.requestedMemoryTypes,
          maxResults: 8,
          timeoutMs: CONTEXT_TIMEOUT_MS,
        });
      },
    );

    const durationMs = Date.now() - start;

    if (!result) {
      await writeContextTrace({
        id: reqId,
        orgId: input.orgId,
        agentType: input.agentType,
        workflow: input.workflow,
        status: "unavailable",
        durationMs,
        traceId,
        depth,
      });
      return EMPTY_CONTEXT(traceId, "unavailable", durationMs, reqId);
    }

    const parsed = validateAndParseContextResponse(result);
    if (!parsed) {
      await writeContextTrace({
        id: reqId,
        orgId: input.orgId,
        agentType: input.agentType,
        workflow: input.workflow,
        status: "failed",
        durationMs,
        traceId,
        depth,
      });
      return EMPTY_CONTEXT(traceId, "failed", durationMs, reqId);
    }

    const isEmpty =
      !parsed.summary &&
      (!parsed.memories || parsed.memories.length === 0) &&
      (!parsed.patterns || parsed.patterns.length === 0);

    const status: KevinContextResult["status"] = isEmpty ? "empty" : "success";

    await writeContextTrace({
      id: reqId,
      orgId: input.orgId,
      agentType: input.agentType,
      workflow: input.workflow,
      entityType: input.entityType,
      question: input.question,
      status,
      responseSummary: parsed.summary || null,
      confidence: parsed.confidence ?? null,
      memoriesCount: parsed.memories?.length ?? 0,
      durationMs,
      traceId,
      depth,
    });

    return {
      available: status === "success",
      status,
      summary: parsed.summary ?? "",
      memories: parsed.memories ?? [],
      patterns: parsed.patterns ?? [],
      priorDecisions: parsed.priorDecisions ?? [],
      risks: parsed.risks ?? [],
      confidence: parsed.confidence,
      durationMs,
      contextRequestId: reqId,
      traceId,
      informedByKevin: status === "success",
    };
  } catch (e: any) {
    const isTimeout =
      e?.name === "TimeoutError" || e?.code === "KEVIN_UNAVAILABLE";
    const status: KevinContextResult["status"] = isTimeout ? "timeout" : "failed";
    const durationMs = Date.now() - start;

    if (!isTimeout) {
      await recordCircuitFailure(e, false);
    }

    await writeContextTrace({
      id: reqId,
      orgId: input.orgId,
      agentType: input.agentType,
      workflow: input.workflow,
      status,
      durationMs,
      traceId,
      depth,
    });

    return EMPTY_CONTEXT(traceId, status, durationMs, reqId);
  }
}

/**
 * Quick helper for CEO Heartbeat and Executive Agent.
 * Returns a formatted string for inclusion in agent prompts.
 */
export function formatKevinContextForPrompt(ctx: KevinContextResult): string {
  if (!ctx.available || ctx.status !== "success") return "";

  const lines: string[] = [
    "=== Kevin Intelligence Context ===",
  ];
  if (ctx.summary) lines.push(`Summary: ${ctx.summary}`);
  if (ctx.memories.length > 0) {
    lines.push(`Historical patterns (${ctx.memories.length}):`);
    for (const m of ctx.memories.slice(0, 5)) {
      lines.push(`  • [${m.type}] ${m.summary}`);
    }
  }
  if (ctx.priorDecisions.length > 0) {
    lines.push(`Prior decisions:`);
    for (const d of ctx.priorDecisions.slice(0, 3)) {
      lines.push(`  • ${d}`);
    }
  }
  if (ctx.risks.length > 0) {
    lines.push(`Risks to consider:`);
    for (const r of ctx.risks.slice(0, 3)) {
      lines.push(`  • ${r}`);
    }
  }
  if (ctx.confidence !== undefined) {
    lines.push(`Context confidence: ${(ctx.confidence * 100).toFixed(0)}%`);
  }
  lines.push("=== End Kevin Context ===");
  return lines.join("\n");
}
