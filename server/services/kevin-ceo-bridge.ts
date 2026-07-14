/**
 * Kevin ↔ CEO Agent Bridge — Phase 7
 *
 * Defines the structured relationship between Kevin and the TE-native CEO Agent.
 *
 * Kevin is the persistent external executive orchestrator.
 * The CEO Agent is the TrainEfficiency-native executive interface and analysis layer.
 *
 * Kevin may ask the CEO Agent for:
 *  - Analysis (ceo.request_analysis, agent.request_analysis)
 *  - Briefings (ceo.ask_question)
 *  - Decisions (ceo.request_decision)
 *  - Escalations (ceo.escalate_issue)
 *
 * The CEO Agent may escalate events or recommendations to Kevin.
 *
 * Safety:
 * - All communication goes through structured tasks and outcomes
 * - No hidden prompt injection or direct memory edits
 * - Circular call prevention: CEO Agent must not delegate back to Kevin
 * - Only CEO Agent's existing analysis paths are used (no new analysis engine)
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { recordKevinAuditEvent } from "./kevin-audit-service";
import { enqueueKevinEvent } from "./kevin-event-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CeoAnalysisRequest {
  orgId: string;
  intentId: string;
  question: string;
  domain?: string;  // e.g. "revenue", "retention", "scheduling"
  contextHints?: Record<string, unknown>;
  requestedBy?: string;
}

export interface CeoAnalysisResult {
  ok: boolean;
  requestId: string;
  summary: string | null;
  data: unknown | null;
  recommendations: string[];
  error?: string;
}

export interface CeoEscalationInput {
  orgId: string;
  intentId: string;
  riskTitle: string;
  riskDescription: string;
  severity: "low" | "medium" | "high" | "critical";
  affectedDomain?: string;
  contextData?: Record<string, unknown>;
}

// ─── Analysis delegation ───────────────────────────────────────────────────────

/**
 * Ask the CEO Agent for an analysis on behalf of Kevin.
 * Uses the existing CEO Heartbeat context / recommendation infrastructure.
 * Returns a structured result — never requires Kevin to parse raw text.
 *
 * Circular call prevention: this function must not be called from within
 * the CEO Agent's own execution path.
 */
export async function requestCeoAnalysis(
  input: CeoAnalysisRequest,
): Promise<CeoAnalysisResult> {
  const requestId = randomUUID();

  void recordKevinAuditEvent({
    orgId: input.orgId,
    eventType: "ceo_bridge.analysis_requested",
    payload: {
      requestId,
      intentId: input.intentId,
      question: input.question.slice(0, 200),
      domain: input.domain ?? null,
    },
  });

  try {
    // Use the existing recommendation system as the analysis backend
    const recResult = await db.execute(sql`
      SELECT id, title, description, priority, confidence, category, action_items
      FROM ai_recommendations
      WHERE org_id = ${input.orgId}
        AND status = 'active'
        ${input.domain ? sql`AND category ILIKE ${`%${input.domain}%`}` : sql``}
      ORDER BY priority DESC, confidence DESC
      LIMIT 5
    `);

    const rows = Array.isArray((recResult as any)?.rows)
      ? (recResult as any).rows
      : Array.isArray(recResult)
        ? recResult
        : [];

    const recommendations = rows.map((r: any) =>
      `[${r.category ?? "general"}] ${r.title}: ${r.description ?? ""}`.slice(0, 300),
    );

    // Also pull latest CEO Heartbeat summary if available
    let heartbeatSummary: string | null = null;
    try {
      const hbResult = await db.execute(sql`
        SELECT summary, health_score, created_at
        FROM ceo_heartbeat_runs
        WHERE org_id = ${input.orgId}
        ORDER BY created_at DESC LIMIT 1
      `);
      const hbRows = Array.isArray((hbResult as any)?.rows)
        ? (hbResult as any).rows
        : Array.isArray(hbResult)
          ? hbResult
          : [];
      if (hbRows[0]) {
        heartbeatSummary = `Health score: ${hbRows[0].health_score ?? "N/A"}. ${hbRows[0].summary ?? ""}`;
      }
    } catch {}

    const summary =
      `Analysis for: "${input.question.slice(0, 200)}"\n` +
      (heartbeatSummary ? `System health: ${heartbeatSummary}\n` : "") +
      `Found ${recommendations.length} relevant recommendations.`;

    // Enqueue a Kevin event so this analysis is forwarded to Hermes for learning
    void enqueueKevinEvent({
      orgId: input.orgId,
      eventType: "ceo_bridge.analysis_completed",
      entityType: "ceo_analysis",
      entityId: requestId,
      idempotencyKey: `ceo_analysis:${requestId}`,
      payload: {
        intentId: input.intentId,
        question: input.question.slice(0, 200),
        recommendationCount: recommendations.length,
        hasHeartbeat: Boolean(heartbeatSummary),
      },
    });

    return {
      ok: true,
      requestId,
      summary,
      data: {
        recommendations: rows,
        heartbeatSummary,
        domain: input.domain ?? null,
      },
      recommendations,
    };
  } catch (e: any) {
    console.warn("[KevinCeoBridge] requestCeoAnalysis error:", e?.message);
    return {
      ok: false,
      requestId,
      summary: null,
      data: null,
      recommendations: [],
      error: e?.message ?? "Analysis failed",
    };
  }
}

/**
 * Ask the CEO Agent to evaluate options and produce a decision recommendation.
 */
export async function requestCeoDecision(
  orgId: string,
  intentId: string,
  question: string,
  options: string[],
): Promise<{ ok: boolean; recommendation: string | null; confidence: number; error?: string }> {
  void recordKevinAuditEvent({
    orgId,
    eventType: "ceo_bridge.decision_requested",
    payload: {
      intentId,
      question: question.slice(0, 200),
      optionCount: options.length,
    },
  });

  try {
    // For structured decision requests, use OpenAI if available, else return placeholder
    const { OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt =
      `You are the CEO executive AI for a coaching business. ` +
      `Kevin (the external AI orchestrator) needs a decision recommendation.\n\n` +
      `Question: ${question}\n` +
      `Options:\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}\n\n` +
      `Provide a concise recommendation (1-2 sentences) and a confidence score (0.0-1.0).`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
    });

    const content = resp.choices[0]?.message?.content ?? "";
    const confidenceMatch = content.match(/\b(0\.\d+|1\.0)\b/);
    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7;

    return { ok: true, recommendation: content.slice(0, 500), confidence };
  } catch (e: any) {
    console.warn("[KevinCeoBridge] requestCeoDecision error:", e?.message);
    return { ok: false, recommendation: null, confidence: 0, error: e?.message };
  }
}

/**
 * Escalate a risk or critical situation from Kevin to the CEO Agent's attention.
 * Creates an Attention Inbox item for immediate review.
 */
export async function escalateToAttentionInbox(input: CeoEscalationInput): Promise<string | null> {
  try {
    const id = randomUUID();
    const severityScore = {
      low: 30,
      medium: 55,
      high: 75,
      critical: 95,
    }[input.severity] ?? 55;

    await db.execute(sql`
      INSERT INTO attention_items (
        id, org_id, level, category, title, body, source, source_id,
        severity, urgency, business_impact, confidence, status
      ) VALUES (
        ${id},
        ${input.orgId},
        'action_required',
        'operations',
        ${`Kevin Escalation: ${input.riskTitle}`},
        ${input.riskDescription},
        'kevin_ceo_bridge',
        ${input.intentId},
        ${severityScore},
        ${severityScore},
        ${severityScore - 10},
        0.9,
        'active'
      )
      ON CONFLICT DO NOTHING
    `);

    void recordKevinAuditEvent({
      orgId: input.orgId,
      eventType: "ceo_bridge.escalation_created",
      payload: {
        attentionItemId: id,
        intentId: input.intentId,
        riskTitle: input.riskTitle.slice(0, 200),
        severity: input.severity,
      },
    });

    return id;
  } catch (e: any) {
    console.warn("[KevinCeoBridge] escalateToAttentionInbox error:", e?.message);
    return null;
  }
}

/**
 * Submit a CEO Agent recommendation back to Kevin as an outcome event.
 * Call this from the CEO Agent side when it has a recommendation Kevin should learn from.
 */
export async function submitCeoRecommendationToKevin(
  orgId: string,
  recommendation: {
    title: string;
    description: string;
    category: string;
    priority: number;
    confidence: number;
    sourceAgent: string;
  },
): Promise<void> {
  void enqueueKevinEvent({
    orgId,
    eventType: "ceo_bridge.recommendation_forwarded",
    entityType: "ceo_recommendation",
    entityId: randomUUID(),
    idempotencyKey: `ceo_rec:${orgId}:${Date.now()}`,
    payload: {
      title: recommendation.title.slice(0, 200),
      category: recommendation.category,
      priority: recommendation.priority,
      confidence: recommendation.confidence,
      sourceAgent: recommendation.sourceAgent,
    },
  });
}
