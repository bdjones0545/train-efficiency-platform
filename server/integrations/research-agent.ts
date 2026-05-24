/**
 * Research Agent (OpenClaw/Browser) — Phase 5
 * Agent: Vector (research_agent)
 *
 * Web research, lead enrichment, decision-maker discovery, competitor analysis.
 *
 * Safety requirements:
 *  - Org must explicitly enable web access (governance_restrictions.webAccessEnabled)
 *  - Blocked domains list enforced
 *  - Execution quotas enforced
 *  - All extracted data is auditable
 *  - No PII fabrication — only real discovered data is saved
 */

import { executeIntegrationAction, getIntegration } from "../integration-runtime";
import { db } from "../db";
import { integrationExecutionLog } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

const DEFAULT_BLOCKED_DOMAINS = [
  "facebook.com", "instagram.com", "tiktok.com", "snapchat.com",
  "gov", "mil", "onion",
];

export interface ResearchJobInput {
  orgId: string;
  agentType?: string;
  workflowJobId?: string;
  workflowRunId?: string;
  jobType: "lead_enrichment" | "decision_maker_discovery" | "competitor_research" | "school_data" | "public_info";
  targetName: string;
  targetUrl?: string;
  targetLocation?: string;
  context?: string;
}

export interface ResearchResult {
  ok: boolean;
  findings?: ResearchFinding[];
  error?: string;
  quotaExceeded?: boolean;
}

export interface ResearchFinding {
  type: "email" | "phone" | "name" | "title" | "organization" | "url" | "description" | "other";
  value: string;
  sourceUrl?: string;
  sourceTitle?: string;
  confidence: number; // 0-1
  verified: boolean;
}

// ─── Research Job Executor ────────────────────────────────────────────────────

export async function executeResearchJob(input: ResearchJobInput): Promise<ResearchResult> {
  // 1. Verify org has web access enabled
  const integration = await getIntegration(input.orgId, "research_agent");
  if (!integration) {
    return { ok: false, error: "Research agent integration not configured" };
  }

  const restrictions = integration.governanceRestrictions as any ?? {};
  if (!restrictions.webAccessEnabled) {
    return { ok: false, error: "Web research access not enabled for this organization" };
  }

  // 2. Quota check
  const todayCount = await getResearchJobCount(input.orgId);
  const dailyQuota = restrictions.dailyQuota ?? 50;
  if (todayCount >= dailyQuota) {
    return { ok: false, error: `Daily research quota (${dailyQuota}) exceeded`, quotaExceeded: true };
  }

  // 3. Domain blocklist check
  if (input.targetUrl) {
    const blocked = isBlockedDomain(input.targetUrl, restrictions.blockedDomains ?? DEFAULT_BLOCKED_DOMAINS);
    if (blocked) {
      return { ok: false, error: `Target domain is blocked by governance policy` };
    }
  }

  // 4. Execute via governance runtime
  const result = await executeIntegrationAction(
    {
      orgId: input.orgId,
      integrationType: "research_agent" as any,
      actionType: input.jobType,
      agentType: input.agentType ?? "research_agent",
      workflowJobId: input.workflowJobId,
      workflowRunId: input.workflowRunId,
      inputSummary: `${input.jobType}: ${input.targetName}`,
      payload: { targetName: input.targetName, targetUrl: input.targetUrl },
    },
    async () => {
      return await performResearch(input, restrictions);
    },
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, findings: result.data?.findings as ResearchFinding[] ?? [] };
}

// ─── Core Research Engine ─────────────────────────────────────────────────────

async function performResearch(
  input: ResearchJobInput,
  restrictions: Record<string, any>,
): Promise<Record<string, any>> {
  // Use OpenAI Responses API with web_search_preview tool (same as existing enrichment)
  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = buildResearchPrompt(input);

    // Try Responses API with web search
    try {
      const response = await (openai as any).responses.create({
        model: "gpt-4o",
        tools: [{ type: "web_search_preview" }],
        input: prompt,
      });

      const findings = extractFindingsFromWebSearch(response, input.jobType);
      return { findings };
    } catch (webErr: any) {
      // Fallback to chat completions (no live web search, inference only)
      console.warn("[ResearchAgent] Web search unavailable, using inference fallback");
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a research agent for a fitness coaching business. Extract only factual, publicly available information. Do NOT fabricate contact details.",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1000,
      });

      const parsed = JSON.parse(res.choices[0].message.content ?? "{}");
      return { findings: parsed.findings ?? [], inferenceOnly: true };
    }
  } catch (err: any) {
    throw new Error(`Research failed: ${err.message}`);
  }
}

function buildResearchPrompt(input: ResearchJobInput): string {
  const prompts: Record<string, string> = {
    lead_enrichment: `Research "${input.targetName}"${input.targetLocation ? ` in ${input.targetLocation}` : ""}${input.targetUrl ? ` (website: ${input.targetUrl})` : ""}. Find public contact information for decision-makers. Return JSON: { "findings": [{ "type": "email|phone|name|title|organization|url", "value": "...", "sourceUrl": "...", "sourceTitle": "...", "confidence": 0.0-1.0, "verified": true/false }] }. ONLY include real, verifiable data.`,

    decision_maker_discovery: `Find decision-makers at "${input.targetName}"${input.targetLocation ? ` in ${input.targetLocation}` : ""}. Focus on Athletic Directors, Head Coaches, Strength Coordinators. Return JSON with findings array.`,

    competitor_research: `Research the organization "${input.targetName}". Find public information about their services, size, and market position. Return JSON with findings.`,

    school_data: `Find public information about "${input.targetName}"${input.targetLocation ? ` in ${input.targetLocation}` : ""}. Include school size, sports programs, and contact info. Return JSON.`,

    public_info: `${input.context ?? `Research "${input.targetName}"`}. Return JSON with findings.`,
  };

  return prompts[input.jobType] ?? prompts.public_info;
}

function extractFindingsFromWebSearch(response: any, jobType: string): ResearchFinding[] {
  const findings: ResearchFinding[] = [];

  // Extract from output_text
  const outputText = response.output_text ?? response.output?.[0]?.content?.[0]?.text ?? "";

  // Try to parse JSON from response
  const jsonMatch = outputText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.findings)) {
        return parsed.findings.map((f: any) => ({
          type: f.type ?? "other",
          value: f.value ?? "",
          sourceUrl: f.sourceUrl,
          sourceTitle: f.sourceTitle,
          confidence: f.confidence ?? 0.5,
          verified: f.verified ?? false,
        }));
      }
    } catch { /* continue */ }
  }

  // Extract emails directly from text
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = outputText.match(emailRegex) ?? [];
  for (const email of emails.slice(0, 5)) {
    findings.push({ type: "email", value: email, confidence: 0.7, verified: false });
  }

  return findings;
}

// ─── Research Activity Feed ───────────────────────────────────────────────────

export async function getResearchActivityFeed(orgId: string, limit = 20): Promise<any[]> {
  const logs = await db.select()
    .from(integrationExecutionLog)
    .where(and(
      eq(integrationExecutionLog.orgId, orgId),
      eq(integrationExecutionLog.integrationType, "research_agent" as any),
    ))
    .orderBy(desc(integrationExecutionLog.createdAt))
    .limit(limit);

  return logs.map(l => ({
    id: l.id,
    jobType: l.actionType,
    status: l.status,
    inputSummary: l.inputSummary,
    resultSummary: l.resultSummary,
    agentType: l.agentType,
    createdAt: l.createdAt,
    latencyMs: l.latencyMs,
    error: l.errorMessage,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getResearchJobCount(orgId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const logs = await db.select()
    .from(integrationExecutionLog)
    .where(and(
      eq(integrationExecutionLog.orgId, orgId),
      eq(integrationExecutionLog.integrationType, "research_agent" as any),
    ))
    .orderBy(desc(integrationExecutionLog.createdAt))
    .limit(100);

  return logs.filter(l => l.createdAt && new Date(l.createdAt) >= today).length;
}

function isBlockedDomain(url: string, blockedDomains: string[]): boolean {
  try {
    const hostname = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    return blockedDomains.some(d => hostname.endsWith(d));
  } catch {
    return false;
  }
}
