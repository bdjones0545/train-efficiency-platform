/**
 * OpenRouter Multi-Model Routing — Phase 5
 *
 * Routes AI tasks to the optimal model based on task complexity, cost targets,
 * and provider availability. Falls back automatically on outages.
 *
 * All invocations log cost + confidence + model used via integration runtime.
 */

import { executeIntegrationAction, getIntegration, classifyProviderError } from "../integration-runtime";
import { db } from "../db";
import { integrationExecutionLog } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export type ModelTier = "economy" | "balanced" | "premium" | "multimodal";
export type TaskClass = "summary" | "classification" | "draft" | "analysis" | "research" | "executive" | "code" | "vision";

// Model routing table — cost-optimized defaults with quality guardrails
export const MODEL_ROUTING: Record<TaskClass, { tier: ModelTier; primary: string; fallback: string; maxTokens: number }> = {
  summary: { tier: "economy", primary: "openai/gpt-4o-mini", fallback: "anthropic/claude-3-haiku", maxTokens: 500 },
  classification: { tier: "economy", primary: "openai/gpt-4o-mini", fallback: "anthropic/claude-3-haiku", maxTokens: 200 },
  draft: { tier: "balanced", primary: "openai/gpt-4o", fallback: "anthropic/claude-3-5-sonnet", maxTokens: 1000 },
  analysis: { tier: "balanced", primary: "openai/gpt-4o", fallback: "anthropic/claude-3-5-sonnet", maxTokens: 2000 },
  research: { tier: "balanced", primary: "openai/gpt-4o", fallback: "anthropic/claude-3-5-sonnet", maxTokens: 3000 },
  executive: { tier: "premium", primary: "anthropic/claude-opus-4", fallback: "openai/o1-mini", maxTokens: 2000 },
  code: { tier: "balanced", primary: "openai/gpt-4o", fallback: "anthropic/claude-3-5-sonnet", maxTokens: 2000 },
  vision: { tier: "multimodal", primary: "google/gemini-2.0-flash-001", fallback: "openai/gpt-4o", maxTokens: 1000 },
};

export interface RouterCompletionInput {
  orgId: string;
  agentType?: string;
  taskClass: TaskClass;
  systemPrompt?: string;
  userPrompt: string;
  imageUrl?: string;
  workflowJobId?: string;
  workflowRunId?: string;
  /** Override model selection */
  forceModel?: string;
  /** Max cost in cents */
  maxCostCents?: number;
}

export interface RouterCompletionResult {
  ok: boolean;
  content?: string;
  modelUsed?: string;
  tokensUsed?: number;
  costCents?: number;
  confidence?: number;
  fallbackUsed?: boolean;
  error?: string;
}

// ─── Route Completion ─────────────────────────────────────────────────────────

export async function routeCompletion(input: RouterCompletionInput): Promise<RouterCompletionResult> {
  const routing = MODEL_ROUTING[input.taskClass];
  const model = input.forceModel ?? routing.primary;

  const result = await executeIntegrationAction(
    {
      orgId: input.orgId,
      integrationType: "openrouter",
      actionType: `model_${input.taskClass}`,
      agentType: input.agentType,
      workflowJobId: input.workflowJobId,
      workflowRunId: input.workflowRunId,
      inputSummary: `${input.taskClass} via ${model}: ${input.userPrompt.slice(0, 100)}`,
      payload: { taskClass: input.taskClass, model },
    },
    async () => {
      const integration = await getIntegration(input.orgId, "openrouter");

      // Determine API key — org-level OpenRouter key or fall back to OpenAI
      let apiKey: string;
      let baseUrl: string;
      let useOpenRouter = false;

      if (integration?.status === "connected") {
        const creds = integration.encryptedCredentials as any ?? {};
        if (creds.apiKey) {
          apiKey = creds.apiKey;
          baseUrl = "https://openrouter.ai/api/v1";
          useOpenRouter = true;
        } else {
          apiKey = process.env.OPENAI_API_KEY ?? "";
          baseUrl = "https://api.openai.com/v1";
        }
      } else {
        apiKey = process.env.OPENAI_API_KEY ?? "";
        baseUrl = "https://api.openai.com/v1";
      }

      const actualModel = useOpenRouter ? model : mapToOpenAIModel(model);

      const messages: any[] = [];
      if (input.systemPrompt) messages.push({ role: "system", content: input.systemPrompt });

      // Handle vision
      if (input.imageUrl && routing.tier === "multimodal") {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: input.userPrompt },
            { type: "image_url", image_url: { url: input.imageUrl } },
          ],
        });
      } else {
        messages.push({ role: "user", content: input.userPrompt });
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
      if (useOpenRouter) {
        headers["HTTP-Referer"] = "https://trainefficiency.com";
        headers["X-Title"] = "TrainEfficiency AI";
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: actualModel,
          messages,
          max_tokens: routing.maxTokens,
          temperature: input.taskClass === "analysis" || input.taskClass === "executive" ? 0.3 : 0.7,
        }),
      });

      if (!response.ok) {
        const err = await response.json() as any;
        throw Object.assign(new Error(err?.error?.message ?? "Model API error"), { status: response.status });
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content ?? "";
      const tokensUsed = data.usage?.total_tokens ?? 0;
      const costCents = estimateCostCents(actualModel, tokensUsed);

      return {
        content,
        modelUsed: actualModel,
        tokensUsed,
        costCents,
        useOpenRouter,
        fallbackUsed: false,
      };
    },
  );

  if (!result.ok) {
    // Try fallback model
    const fallbackModel = routing.fallback;
    if (fallbackModel !== model) {
      console.warn(`[OpenRouter] Primary model failed, trying fallback: ${fallbackModel}`);
      const fallbackResult = await routeCompletion({ ...input, forceModel: fallbackModel });
      if (fallbackResult.ok) return { ...fallbackResult, fallbackUsed: true };
    }
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    content: result.data?.content as string,
    modelUsed: result.data?.modelUsed as string,
    tokensUsed: result.data?.tokensUsed as number,
    costCents: result.data?.costCents as number,
    fallbackUsed: false,
  };
}

// ─── Model Performance Stats ──────────────────────────────────────────────────

export async function getModelPerformanceStats(orgId: string): Promise<{
  totalInvocations: number;
  totalCostCents: number;
  averageLatencyMs: number;
  modelBreakdown: Record<string, { count: number; cost: number; avgLatency: number }>;
  fallbackRate: number;
}> {
  const logs = await db.select()
    .from(integrationExecutionLog)
    .where(and(
      eq(integrationExecutionLog.orgId, orgId),
      eq(integrationExecutionLog.integrationType, "openrouter"),
    ))
    .orderBy(desc(integrationExecutionLog.createdAt))
    .limit(200);

  const totalInvocations = logs.length;
  const totalCostCents = logs.reduce((s, l) => s + (l.costCents ?? 0), 0);
  const avgLatencyMs = totalInvocations
    ? Math.round(logs.reduce((s, l) => s + (l.latencyMs ?? 0), 0) / totalInvocations)
    : 0;

  const modelBreakdown: Record<string, { count: number; cost: number; avgLatency: number }> = {};
  for (const log of logs) {
    const m = log.modelUsed ?? "unknown";
    if (!modelBreakdown[m]) modelBreakdown[m] = { count: 0, cost: 0, avgLatency: 0 };
    modelBreakdown[m].count++;
    modelBreakdown[m].cost += log.costCents ?? 0;
    modelBreakdown[m].avgLatency = Math.round(
      (modelBreakdown[m].avgLatency * (modelBreakdown[m].count - 1) + (log.latencyMs ?? 0)) / modelBreakdown[m].count
    );
  }

  return { totalInvocations, totalCostCents, averageLatencyMs: avgLatencyMs, modelBreakdown, fallbackRate: 0 };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapToOpenAIModel(model: string): string {
  const mapping: Record<string, string> = {
    "openai/gpt-4o-mini": "gpt-4o-mini",
    "openai/gpt-4o": "gpt-4o",
    "openai/o1-mini": "o1-mini",
    "anthropic/claude-3-haiku": "gpt-4o-mini", // fallback to OpenAI
    "anthropic/claude-3-5-sonnet": "gpt-4o",
    "anthropic/claude-opus-4": "gpt-4o",
    "google/gemini-2.0-flash-001": "gpt-4o",
  };
  return mapping[model] ?? "gpt-4o-mini";
}

function estimateCostCents(model: string, tokens: number): number {
  // Approximate cost per 1K tokens in cents
  const costPer1k: Record<string, number> = {
    "gpt-4o-mini": 0.015,
    "gpt-4o": 0.25,
    "o1-mini": 0.11,
    "claude-3-haiku": 0.025,
    "claude-3-5-sonnet": 0.3,
    "claude-opus-4": 1.5,
    "gemini-2.0-flash-001": 0.0075,
  };
  const base = Object.entries(costPer1k).find(([k]) => model.includes(k))?.[1] ?? 0.1;
  return Math.round((tokens / 1000) * base);
}
