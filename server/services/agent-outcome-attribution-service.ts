/**
 * Agent Outcome Attribution Service — Phase 3
 * Tracks whether agent recommendations actually worked.
 * Powers agent performance scoring, decision effectiveness dashboards,
 * self-improving recommendations, CEO daily reviews, and playbook promotion.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import OpenAI from "openai";
import { processOutcomeEvent } from "./hermes-service";

const openai = new OpenAI();

// ─── Agent types ──────────────────────────────────────────────────────────────

export const AGENT_TYPES = [
  "executive_agent",
  "revenue_agent",
  "growth_agent",
  "scheduling_agent",
  "retention_agent",
  "hermes_learning_engine",
] as const;

export type AgentType = typeof AGENT_TYPES[number];

export const AGENT_LABELS: Record<AgentType, string> = {
  executive_agent:       "Executive Agent",
  revenue_agent:         "Revenue Agent",
  growth_agent:          "Growth Agent",
  scheduling_agent:      "Scheduling Agent",
  retention_agent:       "Retention Agent",
  hermes_learning_engine:"Hermes",
};

// ─── Log a new decision/recommendation ────────────────────────────────────────

export async function logDecisionOutcome(opts: {
  orgId: string;
  agentType: AgentType;
  recommendation: string;
  actionTaken?: string;
  expectedOutcome?: string;
  domain?: string;
  tags?: string[];
  revenueCents?: number;
}): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO agent_decision_outcomes
      (org_id, agent_type, recommendation, action_taken, expected_outcome, domain, tags, revenue_cents)
    VALUES
      (${opts.orgId}, ${opts.agentType}, ${opts.recommendation},
       ${opts.actionTaken ?? null}, ${opts.expectedOutcome ?? null},
       ${opts.domain ?? null}, ${JSON.stringify(opts.tags ?? [])},
       ${opts.revenueCents ?? 0})
    RETURNING id
  `);
  const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
  const id = rows[0]?.id;
  // Async perf recalc
  recalculatePerfScores(opts.orgId).catch(console.error);
  // Non-blocking: write a Hermes learning note for every logged decision.
  processOutcomeEvent("communication_outcome_recorded", {
    agentType: opts.agentType,
    domain: opts.domain ?? "general",
    outcomeStatus: "decision_logged",
    revenueCents: opts.revenueCents,
    decisionId: id,
    orgId: opts.orgId,
    tags: opts.tags,
  }).catch((e: any) =>
    console.error(`[Hermes] logDecisionOutcome write failed (id ${id}): ${e.message}`),
  );
  return id;
}

// ─── Update a decision with actual outcome ────────────────────────────────────

export async function updateDecisionOutcome(opts: {
  id: string;
  orgId: string;
  actualOutcome: string;
  successScore: number; // 0-100
  actionTaken?: string;
  revenueCents?: number;
  meetingsGenerated?: number;
}): Promise<void> {
  await db.execute(sql`
    UPDATE agent_decision_outcomes SET
      actual_outcome = ${opts.actualOutcome},
      success_score  = ${Math.max(0, Math.min(100, opts.successScore))},
      action_taken   = COALESCE(${opts.actionTaken ?? null}, action_taken),
      revenue_cents  = COALESCE(${opts.revenueCents ?? null}, revenue_cents),
      meetings_generated = COALESCE(${opts.meetingsGenerated ?? null}, meetings_generated),
      outcome_date   = NOW(),
      updated_at     = NOW()
    WHERE id = ${opts.id} AND org_id = ${opts.orgId}
  `);
  recalculatePerfScores(opts.orgId).catch(console.error);
  // Non-blocking: write a Hermes learning note when an outcome is resolved.
  processOutcomeEvent("communication_outcome_recorded", {
    agentType: "executive_agent",
    domain: "general",
    outcomeStatus: opts.actualOutcome,
    outcomeScore: opts.successScore,
    revenueCents: opts.revenueCents,
    decisionId: opts.id,
    orgId: opts.orgId,
  }).catch((e: any) =>
    console.error(`[Hermes] updateDecisionOutcome write failed (id ${opts.id}): ${e.message}`),
  );
}

// ─── Recalculate rolling performance scores ───────────────────────────────────

export async function recalculatePerfScores(orgId: string): Promise<void> {
  for (const agentType of AGENT_TYPES) {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*)                                           AS total,
        COUNT(outcome_date)                                AS executed,
        COALESCE(AVG(success_score) FILTER (WHERE success_score IS NOT NULL), 0) AS avg_score,
        COALESCE(SUM(revenue_cents), 0)                    AS revenue,
        COALESCE(SUM(meetings_generated), 0)               AS meetings
      FROM agent_decision_outcomes
      WHERE org_id = ${orgId} AND agent_type = ${agentType}
    `);
    const r = (Array.isArray(rows) ? rows : (rows as any).rows ?? [])[0] ?? {};
    const total     = parseInt(r.total    ?? "0");
    const executed  = parseInt(r.executed ?? "0");
    const avgScore  = parseFloat(r.avg_score ?? "0");
    const revenue   = parseInt(r.revenue  ?? "0");
    const meetings  = parseInt(r.meetings ?? "0");
    const successRate = executed > 0 ? Math.round(avgScore) : 0;

    await db.execute(sql`
      INSERT INTO agent_perf_scores
        (org_id, agent_type, recommendations_issued, recommendations_executed,
         success_rate, revenue_influenced, meetings_generated, last_calculated_at)
      VALUES
        (${orgId}, ${agentType}, ${total}, ${executed},
         ${successRate}, ${revenue}, ${meetings}, NOW())
      ON CONFLICT (org_id, agent_type)
      DO UPDATE SET
        recommendations_issued   = EXCLUDED.recommendations_issued,
        recommendations_executed = EXCLUDED.recommendations_executed,
        success_rate             = EXCLUDED.success_rate,
        revenue_influenced       = EXCLUDED.revenue_influenced,
        meetings_generated       = EXCLUDED.meetings_generated,
        last_calculated_at       = NOW()
    `);
  }
}

// ─── Get agent performance scorecards ─────────────────────────────────────────

export async function getAgentPerfScores(orgId: string) {
  const rows = await db.execute(sql`
    SELECT * FROM agent_perf_scores WHERE org_id = ${orgId}
    ORDER BY success_rate DESC
  `);
  return Array.isArray(rows) ? rows : (rows as any).rows ?? [];
}

// ─── Decision effectiveness analysis ──────────────────────────────────────────

export async function getDecisionEffectiveness(orgId: string) {
  const [topRows, worstRows, repeatedRows, roiRows] = await Promise.all([
    // Top performing (success_score desc, only where outcome recorded)
    db.execute(sql`
      SELECT id, agent_type, recommendation, expected_outcome, actual_outcome,
             success_score, revenue_cents, meetings_generated, outcome_date, domain
      FROM agent_decision_outcomes
      WHERE org_id = ${orgId} AND success_score IS NOT NULL
      ORDER BY success_score DESC LIMIT 10
    `),
    // Worst performing
    db.execute(sql`
      SELECT id, agent_type, recommendation, expected_outcome, actual_outcome,
             success_score, revenue_cents, outcome_date, domain
      FROM agent_decision_outcomes
      WHERE org_id = ${orgId} AND success_score IS NOT NULL AND success_score < 50
      ORDER BY success_score ASC LIMIT 10
    `),
    // Most repeated recommendations
    db.execute(sql`
      SELECT
        LOWER(TRIM(recommendation)) AS rec_key,
        MAX(recommendation)        AS recommendation,
        MAX(agent_type)            AS agent_type,
        COUNT(*)                   AS times_issued,
        AVG(success_score)         AS avg_success,
        SUM(revenue_cents)         AS total_revenue,
        MAX(domain)                AS domain
      FROM agent_decision_outcomes
      WHERE org_id = ${orgId}
      GROUP BY LOWER(TRIM(recommendation))
      HAVING COUNT(*) > 1
      ORDER BY times_issued DESC LIMIT 10
    `),
    // Highest ROI
    db.execute(sql`
      SELECT id, agent_type, recommendation, actual_outcome,
             success_score, revenue_cents, meetings_generated, outcome_date, domain
      FROM agent_decision_outcomes
      WHERE org_id = ${orgId} AND revenue_cents > 0
      ORDER BY revenue_cents DESC LIMIT 10
    `),
  ]);

  const toArr = (r: any) => Array.isArray(r) ? r : (r as any).rows ?? [];

  return {
    topPerforming:  toArr(topRows),
    worstPerforming: toArr(worstRows),
    mostRepeated:   toArr(repeatedRows),
    highestROI:     toArr(roiRows),
  };
}

// ─── Search similar past decisions ────────────────────────────────────────────

export async function searchSimilarDecisions(opts: {
  orgId: string;
  query: string;
  agentType?: string;
  limit?: number;
}) {
  const { orgId, query, agentType, limit = 5 } = opts;
  const searchTerm = `%${query.toLowerCase()}%`;

  const rows = await db.execute(sql`
    SELECT id, agent_type, recommendation, action_taken, expected_outcome,
           actual_outcome, success_score, domain, revenue_cents, meetings_generated, outcome_date
    FROM agent_decision_outcomes
    WHERE org_id = ${orgId}
      AND (
        LOWER(recommendation) LIKE ${searchTerm}
        OR LOWER(expected_outcome) LIKE ${searchTerm}
        OR LOWER(domain) LIKE ${searchTerm}
      )
      ${agentType ? sql`AND agent_type = ${agentType}` : sql``}
      AND success_score IS NOT NULL
    ORDER BY success_score DESC
    LIMIT ${limit}
  `);

  const results = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

  // Pull Obsidian vault results as supplemental context
  let obsidianContext: string[] = [];
  try {
    const { searchNotes } = await import("./obsidian-service");
    const obsResults = await searchNotes(query, { limit: 3 });
    obsidianContext = obsResults.map((r) =>
      `[${r.filename}] ${r.matches?.[0]?.context ?? ""}`.slice(0, 200),
    );
  } catch { /* non-blocking */ }

  return { results, obsidianContext };
}

// ─── Generate CEO daily review (AI) ──────────────────────────────────────────

export async function generateCEOReview(orgId: string): Promise<{
  whatWorked: string;
  whatFailed: string;
  whatRepeat: string;
  whatStop: string;
  outcomesAnalyzed: number;
}> {
  const sinceRows = await db.execute(sql`
    SELECT agent_type, recommendation, actual_outcome, success_score, revenue_cents, domain
    FROM agent_decision_outcomes
    WHERE org_id = ${orgId}
      AND created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY success_score DESC NULLS LAST
  `);
  const outcomes = Array.isArray(sinceRows) ? sinceRows : (sinceRows as any).rows ?? [];

  if (outcomes.length === 0) {
    // Fall back to last 7 days if no data today
    const weekRows = await db.execute(sql`
      SELECT agent_type, recommendation, actual_outcome, success_score, revenue_cents, domain
      FROM agent_decision_outcomes
      WHERE org_id = ${orgId}
        AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY success_score DESC NULLS LAST
      LIMIT 30
    `);
    outcomes.push(...(Array.isArray(weekRows) ? weekRows : (weekRows as any).rows ?? []));
  }

  const outcomesText = outcomes.length > 0
    ? outcomes.map((o: any) =>
        `• [${o.agent_type}] ${o.recommendation} → ${o.actual_outcome ?? "no outcome recorded"} (score: ${o.success_score ?? "pending"})`,
      ).join("\n")
    : "No decisions recorded yet.";

  let whatWorked = "No outcomes recorded yet.";
  let whatFailed = "No failures recorded yet.";
  let whatRepeat = "Await more data to identify repeatable patterns.";
  let whatStop = "No patterns flagged for elimination yet.";

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are the CEO of a strength & conditioning coaching business. Analyze agent decision outcomes and produce a concise daily review. Be specific and actionable. Each section should be 2-4 bullet points. Use plain text, no markdown headers.`,
        },
        {
          role: "user",
          content: `Agent decisions from the past 24 hours:\n\n${outcomesText}\n\nProvide exactly 4 sections separated by "|||":
1. What Worked (specific wins, high-score recommendations)
2. What Failed (low scores, missed expectations)
3. What To Repeat (patterns worth repeating)
4. What To Stop (patterns to eliminate)`,
        },
      ],
      max_tokens: 600,
    }, { timeout: 60_000 });

    const text = response.choices[0]?.message?.content ?? "";
    const parts = text.split("|||").map((s) => s.trim());
    whatWorked = parts[0] || whatWorked;
    whatFailed = parts[1] || whatFailed;
    whatRepeat = parts[2] || whatRepeat;
    whatStop   = parts[3] || whatStop;
  } catch (e: any) {
    console.warn("[CEO Review] OpenAI error:", e.message);
  }

  return { whatWorked, whatFailed, whatRepeat, whatStop, outcomesAnalyzed: outcomes.length };
}

// ─── Save CEO review to DB + Obsidian ─────────────────────────────────────────

export async function saveCEOReview(orgId: string, review: {
  whatWorked: string;
  whatFailed: string;
  whatRepeat: string;
  whatStop: string;
  outcomesAnalyzed: number;
}): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  await db.execute(sql`
    INSERT INTO ceo_daily_reviews
      (org_id, review_date, what_worked, what_failed, what_repeat, what_stop, outcomes_analyzed, ai_generated)
    VALUES
      (${orgId}, ${today}, ${review.whatWorked}, ${review.whatFailed},
       ${review.whatRepeat}, ${review.whatStop}, ${review.outcomesAnalyzed}, true)
    ON CONFLICT (org_id, review_date)
    DO UPDATE SET
      what_worked       = EXCLUDED.what_worked,
      what_failed       = EXCLUDED.what_failed,
      what_repeat       = EXCLUDED.what_repeat,
      what_stop         = EXCLUDED.what_stop,
      outcomes_analyzed = EXCLUDED.outcomes_analyzed,
      updated_at        = NOW()
  `);

  // Write to Obsidian
  try {
    const { writeCEOReview } = await import("./obsidian-service");
    await writeCEOReview({ ...review, orgId });
  } catch { /* non-blocking */ }
}

// ─── Get past CEO reviews ─────────────────────────────────────────────────────

export async function getCEOReviews(orgId: string, limit = 30) {
  const rows = await db.execute(sql`
    SELECT * FROM ceo_daily_reviews
    WHERE org_id = ${orgId}
    ORDER BY review_date DESC
    LIMIT ${limit}
  `);
  return Array.isArray(rows) ? rows : (rows as any).rows ?? [];
}

// ─── Find playbook promotion candidates ───────────────────────────────────────

export async function getPlaybookCandidates(orgId: string) {
  const rows = await db.execute(sql`
    SELECT
      LOWER(TRIM(recommendation))  AS rec_key,
      MAX(recommendation)          AS recommendation,
      MAX(agent_type)              AS agent_type,
      MAX(domain)                  AS domain,
      COUNT(*)                     AS occurrences,
      ROUND(AVG(success_score))    AS avg_success_score,
      SUM(revenue_cents)           AS total_revenue,
      SUM(meetings_generated)      AS total_meetings
    FROM agent_decision_outcomes
    WHERE org_id = ${orgId}
      AND success_score IS NOT NULL
    GROUP BY LOWER(TRIM(recommendation))
    HAVING COUNT(*) >= 2 AND AVG(success_score) >= 70
    ORDER BY AVG(success_score) DESC, COUNT(*) DESC
    LIMIT 20
  `);
  return Array.isArray(rows) ? rows : (rows as any).rows ?? [];
}

// ─── Promote pattern to playbook ──────────────────────────────────────────────

export async function promoteToPlaybook(orgId: string, opts: {
  title: string;
  description: string;
  sourceLearning: string;
  patternType: string;
  successRate: number;
  evidenceCount: number;
  triggerCondition?: string;
  actions?: string;
  expectedOutcome?: string;
}): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO org_playbooks
      (org_id, title, description, source_learning, pattern_type, success_rate,
       evidence_count, trigger_condition, actions, expected_outcome, status, promoted_at)
    VALUES
      (${orgId}, ${opts.title}, ${opts.description}, ${opts.sourceLearning},
       ${opts.patternType}, ${opts.successRate}, ${opts.evidenceCount},
       ${opts.triggerCondition ?? null}, ${opts.actions ?? null},
       ${opts.expectedOutcome ?? null}, 'active', NOW())
    RETURNING id
  `);
  const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
  const id = rows[0]?.id;

  // Write to Obsidian
  try {
    const { writePlaybook } = await import("./obsidian-service");
    await writePlaybook({ orgId, ...opts });
  } catch { /* non-blocking */ }

  return id;
}

// ─── Get playbooks ────────────────────────────────────────────────────────────

export async function getPlaybooks(orgId: string) {
  const rows = await db.execute(sql`
    SELECT * FROM org_playbooks WHERE org_id = ${orgId}
    ORDER BY promoted_at DESC
  `);
  return Array.isArray(rows) ? rows : (rows as any).rows ?? [];
}

// ─── Get recent attribution records ──────────────────────────────────────────

export async function getRecentOutcomes(orgId: string, limit = 50) {
  const rows = await db.execute(sql`
    SELECT * FROM agent_decision_outcomes
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return Array.isArray(rows) ? rows : (rows as any).rows ?? [];
}

// ─── Business Flywheel Metrics ────────────────────────────────────────────────

export async function getBusinessFlywheel(orgId: string) {
  const [outcomeRows, playbookRows, reviewRows] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*)                                              AS total_decisions,
        COUNT(outcome_date)                                   AS decisions_with_outcomes,
        COUNT(*) FILTER (WHERE success_score >= 80)           AS high_score_outcomes,
        COUNT(*) FILTER (WHERE success_score < 40 AND success_score IS NOT NULL) AS low_score_outcomes,
        COALESCE(SUM(revenue_cents), 0)                       AS total_revenue_cents,
        COALESCE(SUM(meetings_generated), 0)                  AS total_meetings,
        COALESCE(AVG(success_score) FILTER (WHERE success_score IS NOT NULL), 0) AS avg_success
      FROM agent_decision_outcomes
      WHERE org_id = ${orgId}
    `),
    db.execute(sql`
      SELECT COUNT(*) AS total FROM org_playbooks WHERE org_id = ${orgId} AND status = 'active'
    `),
    db.execute(sql`
      SELECT COUNT(*) AS total FROM ceo_daily_reviews WHERE org_id = ${orgId}
    `),
  ]);

  const toArr = (r: any) => Array.isArray(r) ? r : (r as any).rows ?? [];
  const o  = toArr(outcomeRows)[0] ?? {};
  const p  = toArr(playbookRows)[0] ?? {};
  const rv = toArr(reviewRows)[0] ?? {};

  // Obsidian vault stats
  let vaultTotal = 0;
  try {
    const { getVaultStats } = await import("./obsidian-service");
    const stats = await getVaultStats();
    vaultTotal = stats.totalNotes;
  } catch { /* non-blocking */ }

  const totalDecisions       = parseInt(o.total_decisions ?? "0");
  const decisionsWithOutcomes= parseInt(o.decisions_with_outcomes ?? "0");
  const highScoreOutcomes    = parseInt(o.high_score_outcomes ?? "0");
  const lowScoreOutcomes     = parseInt(o.low_score_outcomes ?? "0");
  const totalRevenueCents    = parseInt(o.total_revenue_cents ?? "0");
  const totalMeetings        = parseInt(o.total_meetings ?? "0");
  const avgSuccess           = parseFloat(o.avg_success ?? "0");
  const activePlaybooks      = parseInt(p.total ?? "0");
  const ceoReviews           = parseInt(rv.total ?? "0");

  // Flywheel stages
  const memoryCreated   = vaultTotal;
  const decisionsImproved = decisionsWithOutcomes > 0
    ? Math.round((highScoreOutcomes / decisionsWithOutcomes) * 100)
    : 0;
  const outcomesImproved = highScoreOutcomes;
  const revenueGenerated = Math.round(totalRevenueCents / 100);

  // Flywheel health score (0-100)
  const flywheelScore = Math.min(100, Math.round(
    (Math.min(memoryCreated, 50) / 50) * 25 +
    (Math.min(decisionsImproved, 100) / 100) * 25 +
    (Math.min(outcomesImproved, 20) / 20) * 25 +
    (Math.min(revenueGenerated, 10000) / 10000) * 25,
  ));

  return {
    flywheel: { memoryCreated, decisionsImproved, outcomesImproved, revenueGenerated, flywheelScore },
    summary: {
      totalDecisions, decisionsWithOutcomes, highScoreOutcomes, lowScoreOutcomes,
      avgSuccess: Math.round(avgSuccess), totalRevenueCents, totalMeetings,
      activePlaybooks, ceoReviews, vaultNotes: vaultTotal,
    },
    trend: {
      pendingOutcomes: totalDecisions - decisionsWithOutcomes,
      completionRate: totalDecisions > 0
        ? Math.round((decisionsWithOutcomes / totalDecisions) * 100) : 0,
    },
  };
}
