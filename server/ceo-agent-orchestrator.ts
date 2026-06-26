/**
 * CEO Agent Orchestrator
 *
 * Classifies the user's intent, calls the appropriate read-only agent analysis
 * functions in parallel, synthesises a structured executive response, and
 * streams it back as SSE-compatible chunks.
 *
 * Safety contract
 * ───────────────
 * - All agent calls are read-only (or write only to internal agent tables).
 * - No emails, SMS, or external side-effects are triggered from here.
 * - Decision Journal writes happen ONLY when intent === "write_decision".
 * - orgId is never accepted from the client — it must be resolved server-side
 *   before calling this function.
 */

import OpenAI from "openai";
import { buildCommandCenterContextString } from "./business-command-center";
import { generateDigest, detectAnomalies, getClientRisks } from "./financial-brain";
import { runGrowthAgent } from "./agents/growth-agent";
import { runRetentionAgent } from "./agents/retention-agent";
import { runClientSuccessAgent } from "./agents/client-success-agent";
import { runSchedulingAgent } from "./agents/scheduling-agent";
import { runOrchestrator } from "./agents/executive-agent";
import { getRisks, getOpportunities, getForecasts } from "./services/forecast-engine";
import { buildLearningContextString } from "./services/hermes-learning-service";
import { recordDecision } from "./services/decision-journal-service";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ─── Intent types ─────────────────────────────────────────────────────────────

export type CeoIntent =
  | "direct_answer"
  | "revenue_analysis"
  | "growth_analysis"
  | "scheduling_analysis"
  | "retention_analysis"
  | "client_success_analysis"
  | "full_business_diagnosis"
  | "forecast_analysis"
  | "write_decision"
  | "action_request";

// ─── Timeout helper ───────────────────────────────────────────────────────────

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T | null> {
  return Promise.race([
    promise.catch((err) => {
      console.warn(`[CEO Orchestrator] ${label} failed: ${err?.message}`);
      return null;
    }),
    new Promise<null>((resolve) => setTimeout(() => {
      console.warn(`[CEO Orchestrator] ${label} timed out after ${ms}ms`);
      resolve(null);
    }, ms)),
  ]);
}

// ─── Intent classification ────────────────────────────────────────────────────

const INTENT_SYSTEM = `You are a routing classifier for a CEO business AI agent.
Classify the last user message into exactly one of these intent codes:
  direct_answer          — general question, status check, "what should I focus on", "what happened today"
  revenue_analysis       — revenue, income, money, financials, payments, collections, ARR, MRR
  growth_analysis        — leads, prospects, pipeline, conversions, deals, outreach, growth
  scheduling_analysis    — schedule, capacity, utilization, open slots, coach availability
  retention_analysis     — churn, inactive clients, cancellations, at-risk clients, retention
  client_success_analysis — completion rates, no-shows, adherence, session quality, client engagement
  full_business_diagnosis — "full diagnosis", "full report", "everything", "complete picture", "run all agents"
  forecast_analysis      — forecast, projection, risk signals, opportunities, future outlook
  write_decision         — "save", "log", "write", "record", "note", "add to journal", "document this"
  action_request         — "do X", "send", "email", "create", "book", "schedule for me" (proposed action)

Respond with ONLY the intent code — nothing else.`;

async function classifyIntent(
  messages: { role: string; content: string }[]
): Promise<CeoIntent> {
  try {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return "direct_answer";

    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 10,
      messages: [
        { role: "system", content: INTENT_SYSTEM },
        { role: "user", content: lastUser.content },
      ],
    });
    const raw = (resp.choices[0]?.message?.content ?? "").trim().toLowerCase();
    const valid: CeoIntent[] = [
      "direct_answer", "revenue_analysis", "growth_analysis", "scheduling_analysis",
      "retention_analysis", "client_success_analysis", "full_business_diagnosis",
      "forecast_analysis", "write_decision", "action_request",
    ];
    return valid.includes(raw as CeoIntent) ? (raw as CeoIntent) : "direct_answer";
  } catch {
    return "direct_answer";
  }
}

// ─── Agent result formatters ──────────────────────────────────────────────────

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtSignals(signals: Array<{ title: string; severity: string; description: string }>, max = 5): string {
  return signals
    .slice(0, max)
    .map((s) => `  [${s.severity.toUpperCase()}] ${s.title}: ${s.description}`)
    .join("\n");
}

function fmtRecommendations(recs: Array<{ title: string; description: string }>, max = 5): string {
  return recs
    .slice(0, max)
    .map((r, i) => `  ${i + 1}. ${r.title}: ${r.description}`)
    .join("\n");
}

// ─── Per-intent agent calls ───────────────────────────────────────────────────

interface AgentContext {
  intent: CeoIntent;
  agentsUsed: string[];
  agentsFailed: string[];
  dataBlocks: string[];
}

async function runAgentsForIntent(
  orgId: string,
  intent: CeoIntent
): Promise<AgentContext> {
  const ctx: AgentContext = { intent, agentsUsed: [], agentsFailed: [], dataBlocks: [] };
  const TIMEOUT = 15_000;

  if (intent === "revenue_analysis") {
    const [digest, anomalies] = await Promise.all([
      withTimeout(generateDigest(orgId), TIMEOUT, "FinancialBrain/generateDigest"),
      withTimeout(detectAnomalies(orgId), TIMEOUT, "FinancialBrain/detectAnomalies"),
    ]);
    if (digest) {
      ctx.agentsUsed.push("FinancialBrain");
      const r = digest.revenueSummary;
      ctx.dataBlocks.push(
        `REVENUE ANALYSIS (last 7 days):
  Collected: ${fmtMoney(r.collectedCents)}
  Recognized: ${fmtMoney(r.recognizedCents)}
  Deferred Liability: ${fmtMoney(r.deferredLiabilityCents)}
  WoW Collected Change: ${r.wowCollectedChange != null ? `${r.wowCollectedChange}%` : "N/A"}
  WoW Recognized Change: ${r.wowRecognizedChange != null ? `${r.wowRecognizedChange}%` : "N/A"}
  Payment Failures: ${digest.failures.pending} pending, ${digest.failures.failed} failed, ${digest.failures.stale} stale
  Coach Payout Pending: ${fmtMoney(digest.coachPayoutSummary.totalPendingCents)}
  Client Risks: ${digest.clientRisks.length}
${digest.recommendations.length > 0 ? `  Top Recommendations:\n${fmtRecommendations(digest.recommendations)}` : ""}
${digest.narrative ? `  Narrative: ${digest.narrative}` : ""}`
      );
    } else {
      ctx.agentsFailed.push("FinancialBrain");
    }
    if (anomalies?.length) {
      ctx.dataBlocks.push(
        `FINANCIAL ANOMALIES:\n${anomalies.slice(0, 6).map((a) =>
          `  [${a.severity?.toUpperCase()}] ${a.label}: ${a.detail}`
        ).join("\n")}`
      );
    }
  }

  if (intent === "growth_analysis") {
    const result = await withTimeout(runGrowthAgent(orgId), TIMEOUT, "GrowthAgent");
    if (result) {
      ctx.agentsUsed.push("GrowthAgent");
      const s = result.summary;
      ctx.dataBlocks.push(
        `GROWTH ANALYSIS:
  Total Prospects: ${s.totalProspects}
  Hot Leads: ${s.hotLeads}
  Stalled Deals: ${s.stalledDeals}
  Avg Deal Value: ${fmtMoney(s.avgDealValue)}
  Best Lead Source: ${s.bestLeadSource ?? "Unknown"}
  Signals (${result.signals.length}):\n${fmtSignals(result.signals)}
  Top Recommendations:\n${fmtRecommendations(result.recommendations)}`
      );
    } else {
      ctx.agentsFailed.push("GrowthAgent");
    }
  }

  if (intent === "scheduling_analysis") {
    const result = await withTimeout(runSchedulingAgent(orgId), TIMEOUT, "SchedulingAgent");
    if (result) {
      ctx.agentsUsed.push("SchedulingAgent");
      const s = result.summary;
      ctx.dataBlocks.push(
        `SCHEDULING ANALYSIS:
  Utilization: ${s.utilizationPct}%
  Open Slots This Week: ${s.openSlotsThisWeek}
  Underutilized Slots: ${s.underutilizedSlots}
  Revenue Gap (unfilled slots): ${fmtMoney(s.revenueGapsCents)}
  Signals (${result.signals.length}):\n${fmtSignals(result.signals)}
  Top Recommendations:\n${fmtRecommendations(result.recommendations)}`
      );
    } else {
      ctx.agentsFailed.push("SchedulingAgent");
    }
  }

  if (intent === "retention_analysis" || intent === "client_success_analysis") {
    const [retentionResult, csResult] = await Promise.all([
      withTimeout(runRetentionAgent(orgId), TIMEOUT, "RetentionAgent"),
      withTimeout(runClientSuccessAgent(orgId), TIMEOUT, "ClientSuccessAgent"),
    ]);
    if (retentionResult) {
      ctx.agentsUsed.push("RetentionAgent");
      const s = retentionResult.summary;
      ctx.dataBlocks.push(
        `RETENTION ANALYSIS:
  Inactive Clients: ${s.inactiveClients}
  Churn Risks: ${s.churnRisks}
  Expiring Subscriptions: ${s.expiringSubscriptions}
  Recently Cancelled: ${s.cancelledRecently}
  Signals (${retentionResult.signals.length}):\n${fmtSignals(retentionResult.signals)}
  Top Recommendations:\n${fmtRecommendations(retentionResult.recommendations)}`
      );
    } else {
      ctx.agentsFailed.push("RetentionAgent");
    }
    if (csResult) {
      ctx.agentsUsed.push("ClientSuccessAgent");
      const s = csResult.summary;
      ctx.dataBlocks.push(
        `CLIENT SUCCESS ANALYSIS:
  Clients Monitored: ${s.totalClientsMonitored}
  Avg Completion Rate: ${s.avgCompletionRate}%
  Low Adherence Clients: ${s.lowAdherenceClients}
  High No-Show Clients: ${s.highNoShowClients}
  Signals (${csResult.signals.length}):\n${fmtSignals(csResult.signals)}
  Top Recommendations:\n${fmtRecommendations(csResult.recommendations)}`
      );
    } else {
      ctx.agentsFailed.push("ClientSuccessAgent");
    }
  }

  if (intent === "full_business_diagnosis") {
    const result = await withTimeout(runOrchestrator(orgId, "manual"), 30_000, "ExecutiveAgent");
    if (result) {
      ctx.agentsUsed.push("ExecutiveAgent");
      const eb = result.executiveBrief;
      ctx.dataBlocks.push(
        `FULL BUSINESS DIAGNOSIS:
  Health Score: ${result.healthScore}/100
  Total Signals: ${result.totalSignals}
  Total Recommendations: ${result.totalRecommendations}
  Agents Run: ${Object.keys(result.agentSummary).join(", ")}
  Projected Weekly Revenue: ${fmtMoney(eb.projectedWeeklyRevenue)}
  Top Recommendations:\n${eb.recommendedActions.slice(0, 5).map((a, i) => `    ${i + 1}. ${a}`).join("\n")}
  Biggest Opportunity: ${JSON.stringify(eb.biggestOpportunity)}
  Highest Churn Risk: ${JSON.stringify(eb.highestChurnRisk)}
  Top 5 Cross-Agent Recommendations:\n${fmtRecommendations(result.topRecommendations.slice(0, 5).map((r) => ({ title: r.title, description: r.description })))}`
      );
    } else {
      ctx.agentsFailed.push("ExecutiveAgent");
      // Fallback: run the 4 core agents in parallel
      const [g, r, cs, sc] = await Promise.all([
        withTimeout(runGrowthAgent(orgId), TIMEOUT, "GrowthAgent-fallback"),
        withTimeout(runRetentionAgent(orgId), TIMEOUT, "RetentionAgent-fallback"),
        withTimeout(runClientSuccessAgent(orgId), TIMEOUT, "ClientSuccessAgent-fallback"),
        withTimeout(runSchedulingAgent(orgId), TIMEOUT, "SchedulingAgent-fallback"),
      ]);
      if (g) { ctx.agentsUsed.push("GrowthAgent"); ctx.dataBlocks.push(`GROWTH: ${g.summary.hotLeads} hot leads, ${g.summary.stalledDeals} stalled deals`); }
      if (r) { ctx.agentsUsed.push("RetentionAgent"); ctx.dataBlocks.push(`RETENTION: ${r.summary.churnRisks} churn risks, ${r.summary.inactiveClients} inactive clients`); }
      if (cs) { ctx.agentsUsed.push("ClientSuccessAgent"); ctx.dataBlocks.push(`CLIENT SUCCESS: ${cs.summary.totalClientsMonitored} monitored, ${cs.summary.lowAdherenceClients} low adherence`); }
      if (sc) { ctx.agentsUsed.push("SchedulingAgent"); ctx.dataBlocks.push(`SCHEDULING: ${sc.summary.utilizationPct}% utilization, ${sc.summary.openSlotsThisWeek} open slots`); }
    }
  }

  if (intent === "forecast_analysis") {
    const [risks, opps, forecasts] = await Promise.all([
      withTimeout(getRisks(orgId), TIMEOUT, "ForecastEngine/getRisks"),
      withTimeout(getOpportunities(orgId), TIMEOUT, "ForecastEngine/getOpportunities"),
      withTimeout(getForecasts(orgId), TIMEOUT, "ForecastEngine/getForecasts"),
    ]);
    ctx.agentsUsed.push("ForecastEngine");
    const riskLines = Array.isArray(risks) && risks.length
      ? risks.slice(0, 5).map((r: any) => `  [${r.severity ?? "?"}] ${r.title ?? r.riskType}: ${r.description ?? ""}`).join("\n")
      : "  No active risk signals.";
    const oppLines = Array.isArray(opps) && opps.length
      ? opps.slice(0, 5).map((o: any) => `  ${o.title ?? o.opportunityType}: ${o.description ?? ""} (est. ${fmtMoney((o.estimatedValue ?? 0))})`).join("\n")
      : "  No active opportunity signals.";
    const fcstLines = Array.isArray(forecasts) && forecasts.length
      ? forecasts.slice(0, 3).map((f: any) => `  ${f.metric ?? f.forecastType}: ${f.predictedValue ?? "?"} (${f.confidenceScore != null ? `${Math.round(f.confidenceScore * 100)}% confidence` : ""})`).join("\n")
      : "  No forecasts available.";
    ctx.dataBlocks.push(`FORECAST & RISK SIGNALS:\n  Risks:\n${riskLines}\n  Opportunities:\n${oppLines}\n  Forecasts:\n${fcstLines}`);
  }

  return ctx;
}

// ─── Main orchestration entry point ───────────────────────────────────────────

const CEO_SYSTEM_PROMPT = `You are the CEO Agent for a strength and conditioning coaching platform.
You have just run real-time analysis of the business using specialized AI agents.
Your job is to synthesize those findings into an executive-level response.

Response format:
1. **Direct Answer** — 1-2 sentences answering the question first
2. **What I Checked** — brief list of agents/data sources used
3. **Key Findings** — bullet points, numbers-first, be specific
4. **Recommended Next Actions** — ranked 1-3 concrete steps
5. (optional) **I can run X next** — only if a clear follow-up analysis would add value

Rules:
- Lead with the most important finding
- Use real numbers from the data — never fabricate
- Be concise, executive-level, no fluff
- If agents returned no data, say so explicitly
- For action requests: describe the proposed action and ask for confirmation before proceeding
- For write_decision intent: confirm what will be saved before saving
- Never send emails, SMS, or external messages from this chat`;

export function runCeoAgentOrchestration(opts: {
  orgId: string;
  userId: string;
  role: string;
  messages: { role: string; content: string }[];
  userName: string | null;
}): AsyncGenerator<string> {
  return _orchestrate(opts);
}

async function* _orchestrate(opts: {
  orgId: string;
  userId: string;
  role: string;
  messages: { role: string; content: string }[];
  userName: string | null;
}): AsyncGenerator<string> {
  const { orgId, userId, messages, userName } = opts;
  const startMs = Date.now();
  const label = "[CEO Orchestrator]";

  // ── Step 1: Classify intent ────────────────────────────────────────────────
  const intent = await classifyIntent(messages);
  console.log(`${label} intent=${intent} orgId=${orgId}`);

  // ── Step 2: Always get baseline business context + Hermes learnings ────────
  const [baseContext, hermesContext] = await Promise.all([
    buildCommandCenterContextString(orgId).catch((e) => {
      console.warn(`${label} base context failed: ${e?.message}`);
      return null;
    }),
    buildLearningContextString(orgId, 6).catch(() => null),
  ]);

  // ── Step 3: Run agents for this specific intent ────────────────────────────
  let agentCtx: AgentContext = { intent, agentsUsed: [], agentsFailed: [], dataBlocks: [] };

  // Direct answers and action requests use only the base context (fast path)
  if (intent !== "direct_answer" && intent !== "action_request" && intent !== "write_decision") {
    agentCtx = await runAgentsForIntent(orgId, intent);
  }

  console.log(
    `${label} agents used=[${agentCtx.agentsUsed.join(",")}] ` +
    `failed=[${agentCtx.agentsFailed.join(",")}] ` +
    `elapsed=${Date.now() - startMs}ms`
  );

  // ── Step 4: Handle write_decision intent ──────────────────────────────────
  // Only write to Decision Journal when user explicitly says save/log/write/record
  let decisionWriteNote = "";
  if (intent === "write_decision") {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      const saved = await recordDecision({
        orgId,
        agent: userName ?? userId,
        sourceType: "human_admin",
        source: "CEO Agent Chat",
        decision: lastUser.content.slice(0, 500),
        reasoning: "Manually logged via CEO Agent chat",
        decisionType: "manual",
        department: "Operations",
      }).catch((e) => {
        console.warn(`${label} Decision Journal write failed: ${e?.message}`);
        return null;
      });
      decisionWriteNote = saved
        ? "\n\n_This decision has been saved to your Decision Journal._"
        : "\n\n_Note: Decision Journal save failed — please check your Obsidian/Journal setup._";
      console.log(`${label} Decision Journal write ${saved ? "succeeded" : "failed"}`);
    }
  }

  // ── Step 5: Build synthesis prompt ────────────────────────────────────────
  const contextSections: string[] = [];
  if (baseContext) contextSections.push(`BUSINESS CONTEXT:\n${baseContext}`);
  if (hermesContext) contextSections.push(`HISTORICAL LEARNINGS:\n${hermesContext}`);
  if (agentCtx.dataBlocks.length > 0) {
    contextSections.push(`AGENT ANALYSIS RESULTS:\n${agentCtx.dataBlocks.join("\n\n")}`);
  }
  if (agentCtx.agentsFailed.length > 0) {
    contextSections.push(`AGENTS UNAVAILABLE: ${agentCtx.agentsFailed.join(", ")} (results may be partial)`);
  }

  const systemPrompt = [
    CEO_SYSTEM_PROMPT,
    contextSections.join("\n\n---\n\n"),
    agentCtx.agentsUsed.length > 0
      ? `Agents executed for this request: ${agentCtx.agentsUsed.join(", ")}`
      : "No specialized agents were called for this request — answering from business context.",
  ].filter(Boolean).join("\n\n");

  const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  // ── Step 6: Stream synthesis response ─────────────────────────────────────
  console.log(`${label} starting synthesis stream intent=${intent}`);

  const stream = await openai.chat.completions.create({
    model: "gpt-5.1",
    messages: chatMessages,
    stream: true,
    max_completion_tokens: 2048,
  });

  let chunkCount = 0;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      chunkCount++;
      yield delta;
    }
  }

  if (decisionWriteNote) yield decisionWriteNote;

  console.log(
    `${label} synthesis complete chunks=${chunkCount} ` +
    `totalMs=${Date.now() - startMs} intent=${intent} status=200`
  );
}
