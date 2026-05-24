/**
 * AI Model Runtime — governed wrapper for all AI model calls.
 *
 * Responsibilities:
 *  - Route AI calls through OpenRouter when available
 *  - Fall back safely to OpenAI if OpenRouter unavailable
 *  - Log model usage to integration_execution_log
 *  - Write to unified_agent_action_log
 *  - Respect emergency pause for org-scoped AI operations
 *  - Preserve existing response schemas unchanged
 */

import crypto from "crypto";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { orgAiGovernanceSettings, integrationExecutionLog } from "@shared/schema";
import { logUnifiedAction } from "./unified-action-logger";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AICompletionParams {
  orgId?: string;
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  responseFormat?: { type: "json_object" } | { type: "text" };
  maxTokens?: number;
  agentType?: string;
  purpose?: string;
  temperature?: number;
}

export interface AICompletionResult {
  content: string;
  model: string;
  provider: "openrouter" | "openai";
  tokensUsed?: number;
  costCents?: number;
}

// ── Emergency pause check ─────────────────────────────────────────────────

async function isAIPaused(orgId: string): Promise<boolean> {
  try {
    const [s] = await db
      .select({ paused: orgAiGovernanceSettings.emergencyPauseEnabled })
      .from(orgAiGovernanceSettings)
      .where(eq(orgAiGovernanceSettings.orgId, orgId));
    return s?.paused ?? false;
  } catch { return false; }
}

// ── Cost estimation ────────────────────────────────────────────────────────

const COST_PER_1K_TOKENS: Record<string, number> = {
  "gpt-4o": 5,        // $5 / 1M input tokens ≈ 0.5 cents / 1k
  "gpt-4o-mini": 1,
  "gpt-4-turbo": 10,
  "gpt-3.5-turbo": 1,
};

function estimateCostCents(model: string, tokens: number): number {
  const rate = COST_PER_1K_TOKENS[model] ?? 5;
  return Math.ceil((tokens / 1000) * rate);
}

// ── Integration log writer ─────────────────────────────────────────────────

async function writeAILog(params: {
  orgId: string;
  model: string;
  provider: string;
  status: string;
  latencyMs: number;
  tokensUsed?: number;
  costCents?: number;
  purpose?: string;
  errorMessage?: string;
  errorClass?: string;
  governanceDecision?: string;
}): Promise<void> {
  try {
    await db.insert(integrationExecutionLog).values({
      id: crypto.randomUUID(),
      orgId: params.orgId,
      integrationType: params.provider === "openrouter" ? "openrouter" : "openai",
      actionType: `ai_completion:${params.purpose ?? "inference"}`,
      status: params.status,
      inputSummary: JSON.stringify({ model: params.model, purpose: params.purpose }),
      latencyMs: params.latencyMs,
      tokensUsed: params.tokensUsed,
      costCents: params.costCents,
      modelUsed: params.model,
      errorMessage: params.errorMessage,
      errorClass: params.errorClass,
      governanceChecked: !!params.orgId,
      governanceDecision: params.governanceDecision ?? (params.orgId ? "allowed" : "skipped"),
    } as any);
  } catch (err) {
    console.error("[AIModelRuntime] Failed to write integration log:", err);
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function runAICompletion(params: AICompletionParams): Promise<AICompletionResult> {
  const model = params.model ?? "gpt-4o";
  const orgId = params.orgId ?? "system";

  // ── Emergency pause check for org-scoped calls ─────────────────────────
  if (params.orgId) {
    const paused = await isAIPaused(params.orgId);
    if (paused) {
      const reason = "Blocked: AI operations are paused for this organization.";
      await logUnifiedAction({
        orgId: params.orgId,
        actorType: "system",
        actorName: params.agentType ?? "atlas_agent",
        actionType: "governance_blocked",
        status: "blocked",
        riskLevel: "medium",
        reasoningSummary: `AI completion blocked by emergency pause (purpose=${params.purpose ?? "inference"})`,
      }).catch(() => {});
      await writeAILog({ orgId: params.orgId, model, provider: "openai", status: "blocked", latencyMs: 0, errorMessage: reason, errorClass: "governance", governanceDecision: "blocked" });
      throw new Error(reason);
    }
  }

  const sendStart = Date.now();

  // ── Try OpenRouter first ───────────────────────────────────────────────
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey: openrouterKey,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": "https://trainefficiency.com",
          "X-Title": "TrainEfficiency AI Operations",
        },
      });

      const response = await client.chat.completions.create({
        model,
        messages: params.messages,
        ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
        ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      });

      const latencyMs = Date.now() - sendStart;
      const content = response.choices[0]?.message?.content ?? "";
      const tokensUsed = response.usage?.total_tokens;
      const costCents = tokensUsed ? estimateCostCents(model, tokensUsed) : undefined;

      await writeAILog({ orgId, model, provider: "openrouter", status: "success", latencyMs, tokensUsed, costCents, purpose: params.purpose });
      await logUnifiedAction({ orgId, actorType: "system", actorName: params.agentType ?? "atlas_agent", actionType: `ai_completion:${params.purpose ?? "inference"}`, status: "completed", riskLevel: "low", reasoningSummary: `AI completion via OpenRouter (${model}, ${tokensUsed ?? "?"}t, ${latencyMs}ms)` }).catch(() => {});

      return { content, model, provider: "openrouter", tokensUsed, costCents };
    } catch (orErr: any) {
      console.warn("[AIModelRuntime] OpenRouter failed, falling back to OpenAI:", orErr.message);
    }
  }

  // ── Fall back to OpenAI ────────────────────────────────────────────────
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.chat.completions.create({
      model,
      messages: params.messages,
      ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    });

    const latencyMs = Date.now() - sendStart;
    const content = response.choices[0]?.message?.content ?? "";
    const tokensUsed = response.usage?.total_tokens;
    const costCents = tokensUsed ? estimateCostCents(model, tokensUsed) : undefined;

    await writeAILog({ orgId, model, provider: "openai", status: "success", latencyMs, tokensUsed, costCents, purpose: params.purpose });
    await logUnifiedAction({ orgId, actorType: "system", actorName: params.agentType ?? "atlas_agent", actionType: `ai_completion:${params.purpose ?? "inference"}`, status: "completed", riskLevel: "low", reasoningSummary: `AI completion via OpenAI (${model}, ${tokensUsed ?? "?"}t, ${latencyMs}ms)` }).catch(() => {});

    return { content, model, provider: "openai", tokensUsed, costCents };
  } catch (aiErr: any) {
    const latencyMs = Date.now() - sendStart;
    const errorMessage = aiErr?.message ?? "OpenAI error";
    await writeAILog({ orgId, model, provider: "openai", status: "failed", latencyMs, errorMessage, errorClass: "transient", purpose: params.purpose });
    throw aiErr;
  }
}
