/**
 * Opportunity Learning Agent (Hermes) — Phase 9
 * Analyzes historical acquisition data to generate performance metrics and insights.
 *
 * Safety: generates recommendations only — does NOT automatically
 * change discovery weights, qualification thresholds, or outreach messaging.
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
function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 1000) / 10;
}

async function logEvent(orgId: string, action: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
      VALUES (${orgId}, 'Hermes Learning Agent', ${action}, 'learning')
    `);
  } catch { /* non-fatal */ }
}

// ─── Table bootstrap ──────────────────────────────────────────────────────────

export async function ensureLearningTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_learning_signals (
      id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id           TEXT NOT NULL,
      opportunity_id   TEXT NOT NULL,
      source           TEXT NOT NULL DEFAULT '',
      industry         TEXT NOT NULL DEFAULT '',
      company_size     TEXT NOT NULL DEFAULT '',
      opportunity_type TEXT NOT NULL DEFAULT '',
      fit_score        INTEGER NOT NULL DEFAULT 0,
      positioning_angle TEXT NOT NULL DEFAULT '',
      outreach_subject TEXT NOT NULL DEFAULT '',
      reply_received   BOOLEAN NOT NULL DEFAULT FALSE,
      interested       BOOLEAN NOT NULL DEFAULT FALSE,
      meeting_requested BOOLEAN NOT NULL DEFAULT FALSE,
      referral_received BOOLEAN NOT NULL DEFAULT FALSE,
      won              BOOLEAN NOT NULL DEFAULT FALSE,
      lost             BOOLEAN NOT NULL DEFAULT FALSE,
      ghosted          BOOLEAN NOT NULL DEFAULT FALSE,
      final_outcome    TEXT NOT NULL DEFAULT 'in_progress',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_learning_insights (
      id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id           TEXT NOT NULL,
      insight          TEXT NOT NULL,
      category         TEXT NOT NULL DEFAULT 'general',
      confidence_score NUMERIC(4,3) NOT NULL DEFAULT 0.5,
      supporting_data  JSONB NOT NULL DEFAULT '{}',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Add outcome column to opportunities if missing
  await db.execute(sql`
    ALTER TABLE opportunity_acquisition_opportunities
      ADD COLUMN IF NOT EXISTS final_outcome TEXT NOT NULL DEFAULT 'in_progress'
  `).catch(() => {});
}

// ─── Core metrics calculation ─────────────────────────────────────────────────

export interface LearningMetrics {
  totalSent:      number;
  totalReplies:   number;
  totalInterested: number;
  totalMeetings:  number;
  totalWon:       number;
  totalLost:      number;
  totalGhosted:   number;
  replyRate:      number;
  interestedRate: number;
  meetingRate:    number;
  winRate:        number;
  lossRate:       number;
  ghostRate:      number;
}

async function computeMetrics(orgId: string): Promise<LearningMetrics> {
  const sent = rows(await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM opportunity_outreach_executions
    WHERE org_id = ${orgId} AND status IN ('sent','delivered','replied')
  `));
  const totalSent = n(sent[0]?.cnt ?? 0);

  const replies = rows(await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE TRUE)                                    AS total,
      COUNT(*) FILTER (WHERE classification IN ('interested','meeting_request','information_request','referral')) AS interested,
      COUNT(*) FILTER (WHERE classification = 'meeting_request')      AS meetings
    FROM opportunity_reply_events WHERE org_id = ${orgId}
  `));
  const totalReplies   = n(replies[0]?.total    ?? 0);
  const totalInterested = n(replies[0]?.interested ?? 0);
  const totalMeetings  = n(replies[0]?.meetings  ?? 0);

  const outcomes = rows(await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'won')    AS won,
      COUNT(*) FILTER (WHERE status = 'lost')   AS lost,
      COUNT(*) FILTER (WHERE status = 'ghosted') AS ghosted
    FROM opportunity_acquisition_opportunities WHERE org_id = ${orgId}
  `));
  const totalWon     = n(outcomes[0]?.won     ?? 0);
  const totalLost    = n(outcomes[0]?.lost    ?? 0);
  const totalGhosted = n(outcomes[0]?.ghosted ?? 0);

  return {
    totalSent, totalReplies, totalInterested, totalMeetings,
    totalWon, totalLost, totalGhosted,
    replyRate:      pct(totalReplies, totalSent),
    interestedRate: pct(totalInterested, totalSent),
    meetingRate:    pct(totalMeetings, totalSent),
    winRate:        pct(totalWon, totalSent),
    lossRate:       pct(totalLost, totalSent),
    ghostRate:      pct(totalGhosted, totalSent),
  };
}

// ─── Source performance ────────────────────────────────────────────────────────

export interface SourcePerformance {
  source: string; sent: number; replies: number; meetings: number;
  wins: number; replyRate: number; meetingRate: number; winRate: number;
}

async function computeSourcePerformance(orgId: string): Promise<SourcePerformance[]> {
  const data = rows(await db.execute(sql`
    SELECT
      o.source,
      COUNT(DISTINCT e.id)                                                   AS sent,
      COUNT(DISTINCT r.id)                                                   AS replies,
      COUNT(DISTINCT r.id) FILTER (WHERE r.classification = 'meeting_request') AS meetings,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'won')                  AS wins
    FROM   opportunity_acquisition_opportunities o
    LEFT JOIN opportunity_outreach_executions e ON e.opportunity_id = o.id AND e.org_id = ${orgId}
    LEFT JOIN opportunity_reply_events r ON r.opportunity_id = o.id AND r.org_id = ${orgId}
    WHERE  o.org_id = ${orgId} AND o.source IS NOT NULL AND o.source != ''
    GROUP  BY o.source
    ORDER  BY replies DESC, sent DESC
  `));

  return data.map((d: any) => {
    const sent = n(d.sent); const replies = n(d.replies);
    const meetings = n(d.meetings); const wins = n(d.wins);
    return {
      source: d.source, sent, replies, meetings, wins,
      replyRate:   pct(replies, sent),
      meetingRate: pct(meetings, sent),
      winRate:     pct(wins, sent),
    };
  });
}

// ─── Opportunity type performance ─────────────────────────────────────────────

export interface TypePerformance {
  type: string; sent: number; replies: number; meetings: number;
  wins: number; replyRate: number; meetingRate: number; winRate: number;
}

async function computeTypePerformance(orgId: string): Promise<TypePerformance[]> {
  const data = rows(await db.execute(sql`
    SELECT
      o.type,
      COUNT(DISTINCT e.id)                                                   AS sent,
      COUNT(DISTINCT r.id)                                                   AS replies,
      COUNT(DISTINCT r.id) FILTER (WHERE r.classification = 'meeting_request') AS meetings,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'won')                  AS wins
    FROM   opportunity_acquisition_opportunities o
    LEFT JOIN opportunity_outreach_executions e ON e.opportunity_id = o.id AND e.org_id = ${orgId}
    LEFT JOIN opportunity_reply_events r ON r.opportunity_id = o.id AND r.org_id = ${orgId}
    WHERE  o.org_id = ${orgId}
    GROUP  BY o.type
    ORDER  BY replies DESC
  `));

  return data.map((d: any) => {
    const sent = n(d.sent); const replies = n(d.replies);
    const meetings = n(d.meetings); const wins = n(d.wins);
    return {
      type: d.type, sent, replies, meetings, wins,
      replyRate:   pct(replies, sent),
      meetingRate: pct(meetings, sent),
      winRate:     pct(wins, sent),
    };
  });
}

// ─── Positioning performance ───────────────────────────────────────────────────

export interface PositioningPerformance {
  angle: string; sent: number; replies: number; meetings: number;
  wins: number; replyRate: number; meetingRate: number; winRate: number;
}

async function computePositioningPerformance(orgId: string): Promise<PositioningPerformance[]> {
  const data = rows(await db.execute(sql`
    SELECT
      d.positioning_angle                                                    AS angle,
      COUNT(DISTINCT e.id)                                                   AS sent,
      COUNT(DISTINCT r.id)                                                   AS replies,
      COUNT(DISTINCT r.id) FILTER (WHERE r.classification = 'meeting_request') AS meetings,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'won')                  AS wins
    FROM   opportunity_outreach_drafts d
    JOIN   opportunity_acquisition_opportunities o ON o.id = d.opportunity_id AND o.org_id = ${orgId}
    LEFT JOIN opportunity_outreach_executions e ON e.draft_id = d.id AND e.org_id = ${orgId}
    LEFT JOIN opportunity_reply_events r ON r.opportunity_id = o.id AND r.org_id = ${orgId}
    WHERE  d.org_id = ${orgId}
      AND  d.positioning_angle IS NOT NULL AND d.positioning_angle != ''
    GROUP  BY d.positioning_angle
    ORDER  BY replies DESC
  `));

  return data.map((d: any) => {
    const sent = n(d.sent); const replies = n(d.replies);
    const meetings = n(d.meetings); const wins = n(d.wins);
    return {
      angle: d.angle, sent, replies, meetings, wins,
      replyRate:   pct(replies, sent),
      meetingRate: pct(meetings, sent),
      winRate:     pct(wins, sent),
    };
  });
}

// ─── Subject line performance ──────────────────────────────────────────────────

export interface SubjectPerformance {
  subject: string; sent: number; replies: number;
  meetings: number; wins: number; replyRate: number; meetingRate: number;
}

async function computeSubjectPerformance(orgId: string): Promise<SubjectPerformance[]> {
  const data = rows(await db.execute(sql`
    SELECT
      e.subject,
      COUNT(DISTINCT e.id)                                                   AS sent,
      COUNT(DISTINCT r.id)                                                   AS replies,
      COUNT(DISTINCT r.id) FILTER (WHERE r.classification = 'meeting_request') AS meetings,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'won')                  AS wins
    FROM   opportunity_outreach_executions e
    JOIN   opportunity_acquisition_opportunities o ON o.id = e.opportunity_id AND o.org_id = ${orgId}
    LEFT JOIN opportunity_reply_events r ON r.execution_id = e.id AND r.org_id = ${orgId}
    WHERE  e.org_id = ${orgId}
    GROUP  BY e.subject
    ORDER  BY replies DESC, sent DESC
    LIMIT  30
  `));

  return data.map((d: any) => {
    const sent = n(d.sent); const replies = n(d.replies);
    const meetings = n(d.meetings); const wins = n(d.wins);
    return {
      subject: d.subject, sent, replies, meetings, wins,
      replyRate:   pct(replies, sent),
      meetingRate: pct(meetings, sent),
    };
  });
}

// ─── Hermes insight generation ────────────────────────────────────────────────

async function generateInsights(
  orgId: string,
  metrics: LearningMetrics,
  sources: SourcePerformance[],
  types: TypePerformance[],
  positioning: PositioningPerformance[],
  subjects: SubjectPerformance[],
): Promise<void> {
  if (metrics.totalSent < 3) return; // Not enough data

  const summary = `
Acquisition Performance Summary:
- Sent: ${metrics.totalSent} outreach emails
- Replies: ${metrics.totalReplies} (${metrics.replyRate}% reply rate)
- Interested: ${metrics.totalInterested} (${metrics.interestedRate}%)
- Meetings: ${metrics.totalMeetings} (${metrics.meetingRate}%)
- Won: ${metrics.totalWon} (${metrics.winRate}%)
- Lost: ${metrics.totalLost} (${metrics.lossRate}%)

Top Sources (by reply rate): ${sources.slice(0,3).map(s => `${s.source}: ${s.replyRate}% reply rate`).join(", ") || "none yet"}
Top Opportunity Types (by reply rate): ${types.slice(0,3).map(t => `${t.type}: ${t.replyRate}%`).join(", ") || "none yet"}
Top Positioning (by reply rate): ${positioning.slice(0,3).map(p => `"${p.angle}": ${p.replyRate}%`).join(", ") || "none yet"}
`;

  const prompt = `You are Hermes, a business intelligence agent for a strength & conditioning coaching platform.

Based on this acquisition performance data:
${summary}

Generate 3-5 specific, actionable insights. Each insight should:
1. Identify a pattern, opportunity, or concern
2. Be concrete and data-specific
3. Suggest one action to improve results

Respond with JSON:
{
  "insights": [
    {
      "insight": "The insight in 1-2 sentences",
      "category": "source|type|positioning|subject|conversion|general",
      "confidenceScore": 0.0-1.0,
      "supportingData": { "key": "value pairs supporting the insight" }
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 800,
    });

    const raw = JSON.parse(completion.choices[0].message.content ?? "{}");
    const insights: any[] = Array.isArray(raw.insights) ? raw.insights : [];

    // Clear old insights for this org (keep fresh)
    await db.execute(sql`
      DELETE FROM opportunity_learning_insights WHERE org_id = ${orgId}
    `).catch(() => {});

    for (const ins of insights.slice(0, 6)) {
      const supportingData = typeof ins.supportingData === "object"
        ? JSON.stringify(ins.supportingData)
        : "{}";

      await db.execute(sql`
        INSERT INTO opportunity_learning_insights
          (org_id, insight, category, confidence_score, supporting_data)
        VALUES (
          ${orgId},
          ${ins.insight ?? ""},
          ${ins.category ?? "general"},
          ${Math.min(1, Math.max(0, Number(ins.confidenceScore ?? 0.5)))},
          ${supportingData}::jsonb
        )
      `);

      await logEvent(orgId, `New Insight Generated — "${(ins.insight ?? "").slice(0, 80)}…"`);
    }
  } catch { /* non-fatal — insights are best-effort */ }
}

// ─── Signal capture ────────────────────────────────────────────────────────────

export async function recordOutcomeLearningSignal(
  orgId: string,
  opportunityId: string,
  outcome: string,
): Promise<void> {
  await ensureLearningTables();

  // Fetch opportunity and related data
  const opp = rows(await db.execute(sql`
    SELECT o.*,
           d.positioning_angle,
           d.subject AS outreach_subject,
           e.id AS exec_id
    FROM   opportunity_acquisition_opportunities o
    LEFT JOIN opportunity_outreach_drafts d ON d.opportunity_id = o.id AND d.status = 'sent'
    LEFT JOIN opportunity_outreach_executions e ON e.opportunity_id = o.id
    WHERE  o.id = ${opportunityId} AND o.org_id = ${orgId}
    LIMIT  1
  `));

  if (!opp.length) return;
  const o = opp[0];

  // Fetch replies for this opportunity
  const replyData = rows(await db.execute(sql`
    SELECT classification FROM opportunity_reply_events
    WHERE org_id = ${orgId} AND opportunity_id = ${opportunityId}
  `));

  const hasReply     = replyData.length > 0;
  const interested   = replyData.some((r: any) => ["interested", "information_request"].includes(r.classification));
  const meetingReq   = replyData.some((r: any) => r.classification === "meeting_request");
  const referral     = replyData.some((r: any) => r.classification === "referral");

  // Upsert learning signal
  await db.execute(sql`
    INSERT INTO opportunity_learning_signals (
      org_id, opportunity_id, source, industry, company_size,
      opportunity_type, fit_score, positioning_angle, outreach_subject,
      reply_received, interested, meeting_requested, referral_received,
      won, lost, ghosted, final_outcome
    ) VALUES (
      ${orgId}, ${opportunityId},
      ${o.source ?? ""},
      ${o.industry ?? ""},
      ${o.company_size ?? ""},
      ${o.type ?? ""},
      ${n(o.fit_score)},
      ${o.positioning_angle ?? ""},
      ${o.outreach_subject ?? ""},
      ${hasReply}, ${interested}, ${meetingReq}, ${referral},
      ${outcome === "won"}, ${outcome === "lost"}, ${outcome === "ghosted"},
      ${outcome}
    )
    ON CONFLICT DO NOTHING
  `).catch(() => {});

  await logEvent(orgId, `Outcome Recorded — ${outcome} for opportunity ${o.title ?? opportunityId} at ${o.company ?? ""}`);
}

// ─── Main learning analysis ────────────────────────────────────────────────────

export async function runOpportunityLearningAnalysis(orgId: string): Promise<{
  metrics:     LearningMetrics;
  sources:     SourcePerformance[];
  types:       TypePerformance[];
  positioning: PositioningPerformance[];
  subjects:    SubjectPerformance[];
  insightsGenerated: number;
}> {
  await ensureLearningTables();
  await logEvent(orgId, "Learning Analysis Started");

  const [metrics, sources, types, positioning, subjects] = await Promise.all([
    computeMetrics(orgId),
    computeSourcePerformance(orgId),
    computeTypePerformance(orgId),
    computePositioningPerformance(orgId),
    computeSubjectPerformance(orgId),
  ]);

  await generateInsights(orgId, metrics, sources, types, positioning, subjects);

  const insightCount = rows(await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM opportunity_learning_insights WHERE org_id = ${orgId}
  `));

  await logEvent(orgId, `Learning Analysis Completed — ${metrics.totalSent} sent, ${metrics.replyRate}% reply rate, ${insightCount[0]?.cnt ?? 0} insights`);

  return {
    metrics, sources, types, positioning, subjects,
    insightsGenerated: n(insightCount[0]?.cnt ?? 0),
  };
}
