/**
 * Opportunity Executive Intelligence Agent — Phase 10
 * Generates executive briefs, best actions, and prioritized recommendations.
 *
 * Safety: advisory only — does NOT send emails, change settings, approve drafts,
 * or modify any system behavior. Human approval required for every action.
 */

import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}
function n(v: unknown): number { return Number(v ?? 0); }
function pct(a: number, b: number) { return b === 0 ? 0 : Math.round((a / b) * 1000) / 10; }

async function logEvent(orgId: string, action: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
      VALUES (${orgId}, 'Executive Intelligence Agent', ${action}, 'executive')
    `);
  } catch { /* non-fatal */ }
}

// ─── Table bootstrap ──────────────────────────────────────────────────────────

export async function ensureExecutiveTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_executive_briefs (
      id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id             TEXT NOT NULL,
      summary            TEXT NOT NULL DEFAULT '',
      best_action_today  TEXT NOT NULL DEFAULT '',
      key_wins           JSONB NOT NULL DEFAULT '[]',
      key_risks          JSONB NOT NULL DEFAULT '[]',
      key_opportunities  JSONB NOT NULL DEFAULT '[]',
      supporting_metrics JSONB NOT NULL DEFAULT '{}',
      generated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_recommendations (
      id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id           TEXT NOT NULL,
      category         TEXT NOT NULL DEFAULT 'general',
      recommendation   TEXT NOT NULL,
      reasoning        TEXT NOT NULL DEFAULT '',
      confidence_score NUMERIC(5,2) NOT NULL DEFAULT 50,
      supporting_data  JSONB NOT NULL DEFAULT '{}',
      status           TEXT NOT NULL DEFAULT 'pending',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at      TIMESTAMPTZ
    )
  `);
}

// ─── Data gathering ───────────────────────────────────────────────────────────

async function gatherContext(orgId: string) {
  const [opps, execs, replies, drafts, insights] = await Promise.all([
    // Opportunities overview
    db.execute(sql`
      SELECT
        COUNT(*)                                    AS total,
        COUNT(*) FILTER (WHERE status='new')        AS new_count,
        COUNT(*) FILTER (WHERE status='qualified')  AS qualified,
        COUNT(*) FILTER (WHERE status='contacted')  AS contacted,
        COUNT(*) FILTER (WHERE status='interested') AS interested,
        COUNT(*) FILTER (WHERE status='demo')       AS demo,
        COUNT(*) FILTER (WHERE status='won')        AS won,
        COUNT(*) FILTER (WHERE status='lost')       AS lost
      FROM opportunity_acquisition_opportunities WHERE org_id = ${orgId}
    `),
    // Execution overview
    db.execute(sql`
      SELECT
        COUNT(*)                                          AS total_sent,
        COUNT(*) FILTER (WHERE status='approved')         AS awaiting_send
      FROM opportunity_outreach_drafts WHERE org_id = ${orgId}
    `),
    // Reply overview
    db.execute(sql`
      SELECT
        COUNT(*) AS total_replies,
        COUNT(*) FILTER (WHERE classification='meeting_request') AS meetings,
        COUNT(*) FILTER (WHERE classification='interested')      AS interested_replies
      FROM opportunity_reply_events WHERE org_id = ${orgId}
    `),
    // Recent sent executions
    db.execute(sql`
      SELECT COUNT(*) AS sent FROM opportunity_outreach_executions
      WHERE org_id = ${orgId} AND status IN ('sent','delivered','replied')
    `),
    // Latest Hermes insights
    db.execute(sql`
      SELECT insight, category, confidence_score FROM opportunity_learning_insights
      WHERE org_id = ${orgId} ORDER BY confidence_score DESC LIMIT 5
    `).catch(() => ({ rows: [] })),
  ]);

  return {
    opps:     rows(opps)[0]     ?? {},
    execs:    rows(execs)[0]    ?? {},
    replies:  rows(replies)[0]  ?? {},
    drafts:   rows(drafts)[0]   ?? {},
    sentCount: n(rows(drafts)[0]?.total_sent ?? 0),
    insights: rows(insights).map((i: any) => i.insight ?? ""),
  };
}

// ─── Executive brief generation ───────────────────────────────────────────────

export interface ExecutiveBrief {
  id: string;
  orgId: string;
  summary: string;
  bestActionToday: string;
  keyWins: string[];
  keyRisks: string[];
  keyOpportunities: string[];
  supportingMetrics: Record<string, unknown>;
  generatedAt: string;
  createdAt: string;
}

async function generateBrief(orgId: string, ctx: ReturnType<typeof gatherContext> extends Promise<infer T> ? T : never): Promise<void> {
  const sent       = n(ctx.execs.total_sent ?? 0);
  const awaitSend  = n(ctx.execs.awaiting_send ?? 0);
  const totalOpps  = n(ctx.opps.total ?? 0);
  const interested = n(ctx.opps.interested ?? 0);
  const won        = n(ctx.opps.won ?? 0);
  const totalReply = n(ctx.replies.total_replies ?? 0);
  const meetings   = n(ctx.replies.meetings ?? 0);
  const replyRate  = pct(totalReply, sent);
  const meetRate   = pct(meetings, sent);
  const winRate    = pct(won, sent);

  const insightsSummary = ctx.insights.length
    ? `\nLatest Hermes insights:\n${ctx.insights.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  const prompt = `You are the Executive Intelligence Agent for a strength & conditioning coaching business development platform.

Pipeline snapshot:
- Total opportunities: ${totalOpps}
- Qualified: ${ctx.opps.qualified ?? 0} | Contacted: ${ctx.opps.contacted ?? 0} | Interested: ${interested}
- Won: ${won} | Lost: ${ctx.opps.lost ?? 0}
- Sent outreach: ${sent} | Replies: ${totalReply} (${replyRate}% reply rate) | Meetings: ${meetings} (${meetRate}% meeting rate)
- Awaiting send (approved drafts): ${awaitSend}
- Win rate: ${winRate}%
${insightsSummary}

Generate an executive brief. Be specific. Reference actual numbers. Avoid generic language.

Respond with JSON:
{
  "summary": "2-3 sentence narrative summary of acquisition performance",
  "bestActionToday": "One specific action leadership should prioritize today",
  "keyWins": ["win 1", "win 2", "win 3"],
  "keyRisks": ["risk 1", "risk 2"],
  "keyOpportunities": ["opportunity 1", "opportunity 2"],
  "supportingMetrics": {
    "replyRate": ${replyRate},
    "meetingRate": ${meetRate},
    "winRate": ${winRate},
    "totalSent": ${sent},
    "awaitingSend": ${awaitSend},
    "totalOpportunities": ${totalOpps}
  }
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 700,
  });

  const raw = JSON.parse(completion.choices[0].message.content ?? "{}");

  // Delete previous brief for this org
  await db.execute(sql`DELETE FROM opportunity_executive_briefs WHERE org_id = ${orgId}`).catch(() => {});

  await db.execute(sql`
    INSERT INTO opportunity_executive_briefs
      (org_id, summary, best_action_today, key_wins, key_risks, key_opportunities, supporting_metrics)
    VALUES (
      ${orgId},
      ${raw.summary ?? ""},
      ${raw.bestActionToday ?? ""},
      ${JSON.stringify(Array.isArray(raw.keyWins) ? raw.keyWins : [])}::jsonb,
      ${JSON.stringify(Array.isArray(raw.keyRisks) ? raw.keyRisks : [])}::jsonb,
      ${JSON.stringify(Array.isArray(raw.keyOpportunities) ? raw.keyOpportunities : [])}::jsonb,
      ${JSON.stringify(raw.supportingMetrics ?? {})}::jsonb
    )
  `);

  await logEvent(orgId, "Executive Brief Generated");
}

// ─── Recommendation engine ────────────────────────────────────────────────────

export interface Recommendation {
  id: string;
  orgId: string;
  category: string;
  recommendation: string;
  reasoning: string;
  confidenceScore: number;
  supportingData: Record<string, unknown>;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
}

async function generateRecommendations(
  orgId: string,
  ctx: ReturnType<typeof gatherContext> extends Promise<infer T> ? T : never,
): Promise<number> {
  const sent       = n(ctx.execs.total_sent ?? 0);
  const awaitSend  = n(ctx.execs.awaiting_send ?? 0);
  const interested = n(ctx.opps.interested ?? 0);
  const totalReply = n(ctx.replies.total_replies ?? 0);
  const meetings   = n(ctx.replies.meetings ?? 0);
  const replyRate  = pct(totalReply, sent);

  const prompt = `You are the Recommendation Engine for a business development platform serving strength & conditioning coaches.

Pipeline data:
- ${ctx.opps.total ?? 0} total opportunities, ${ctx.opps.new_count ?? 0} new
- ${sent} sent outreach, ${awaitSend} approved but not yet sent
- ${totalReply} replies (${replyRate}% rate), ${meetings} meeting requests
- ${interested} interested opportunities
${ctx.insights.length ? `\nInsights from learning:\n${ctx.insights.join("\n")}` : ""}

Generate 4-6 specific, actionable recommendations across these categories:
- discovery (where to find more/better opportunities)
- outreach (how to improve messaging or timing)
- pipeline (which specific opportunities to act on)
- execution (operational gaps to address)
- learning (what patterns to track or act on)

Each recommendation must be specific to the data — no generic advice.

Respond with JSON:
{
  "recommendations": [
    {
      "category": "discovery|outreach|pipeline|execution|learning",
      "recommendation": "The specific action to take",
      "reasoning": "Why this action matters, referencing data",
      "confidenceScore": 0-100,
      "supportingData": { "key": "value" }
    }
  ]
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 900,
  });

  const raw = JSON.parse(completion.choices[0].message.content ?? "{}");
  const recs: any[] = Array.isArray(raw.recommendations) ? raw.recommendations : [];

  // Clear old pending recommendations for this org
  await db.execute(sql`
    DELETE FROM opportunity_recommendations WHERE org_id = ${orgId} AND status = 'pending'
  `).catch(() => {});

  let count = 0;
  for (const rec of recs.slice(0, 8)) {
    await db.execute(sql`
      INSERT INTO opportunity_recommendations
        (org_id, category, recommendation, reasoning, confidence_score, supporting_data)
      VALUES (
        ${orgId},
        ${rec.category ?? "general"},
        ${rec.recommendation ?? ""},
        ${rec.reasoning ?? ""},
        ${Math.min(100, Math.max(0, Number(rec.confidenceScore ?? 50)))},
        ${JSON.stringify(rec.supportingData ?? {})}::jsonb
      )
    `);
    await logEvent(orgId, `Recommendation Generated — ${(rec.recommendation ?? "").slice(0, 80)}`);
    count++;
  }

  return count;
}

// ─── Main executive analysis ──────────────────────────────────────────────────

export async function runOpportunityExecutiveAnalysis(orgId: string): Promise<{
  briefGenerated: boolean;
  recommendationsGenerated: number;
}> {
  await ensureExecutiveTables();
  await logEvent(orgId, "Executive Analysis Started");

  const ctx = await gatherContext(orgId);

  const [, recCount] = await Promise.all([
    generateBrief(orgId, ctx),
    generateRecommendations(orgId, ctx),
  ]);

  await logEvent(orgId, `Executive Analysis Completed — ${recCount} recommendations generated`);

  return { briefGenerated: true, recommendationsGenerated: recCount };
}
