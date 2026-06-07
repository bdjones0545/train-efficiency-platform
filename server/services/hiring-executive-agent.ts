/**
 * Hiring Executive Agent
 * Generates best action, executive brief, and strategic recommendations.
 * Deterministic analysis — no autonomous decisions.
 *
 * GUARDRAILS:
 *  ✗ No autonomous hiring or rejection
 *  ✓ Recommend / Brief / Prioritize only
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { computeHiringLearningMetrics } from "./hiring-learning-agent";

function rows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}
function n(v: any): number { return Number(v ?? 0); }

// ─── Pipeline stats ────────────────────────────────────────────────────────────

async function getPipelineStats(orgId: string) {
  const [cands, interviews, drafts] = await Promise.all([
    db.execute(sql`
      SELECT status, COUNT(*) as cnt, AVG(fit_score)::int as avg_fit
      FROM hiring_candidates WHERE org_id = ${orgId}
      GROUP BY status
    `).then(rows),
    db.execute(sql`
      SELECT status, COUNT(*) as cnt FROM hiring_interviews
      WHERE org_id = ${orgId} GROUP BY status
    `).then(rows),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM hiring_outreach_drafts
      WHERE org_id = ${orgId} AND status = 'draft'
    `).then(r => n(rows(r)[0]?.cnt)),
  ]);

  const byStatus = Object.fromEntries(cands.map((r: any) => [r.status, n(r.cnt)]));
  const total    = Object.values(byStatus).reduce((s: any, v: any) => s + v, 0);

  return {
    total,
    new:           byStatus.new ?? 0,
    qualified:     byStatus.qualified ?? 0,
    outreachReady: byStatus.outreach_ready ?? 0,
    contacted:     byStatus.contacted ?? 0,
    interested:    byStatus.interested ?? 0,
    interview:     byStatus.interview ?? 0,
    offer:         byStatus.offer ?? 0,
    hired:         byStatus.hired ?? 0,
    rejected:      byStatus.rejected ?? 0,
    pendingDrafts: drafts,
    scheduledInterviews: n(interviews.find((i: any) => i.status === "scheduled")?.cnt),
    overdueInterviews:   n(interviews.find((i: any) => i.status === "overdue")?.cnt),
  };
}

// ─── Best action ───────────────────────────────────────────────────────────────

export async function generateHiringBestAction(orgId: string): Promise<{
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  route: string;
  estimatedImpact?: string;
} | null> {
  const stats = await getPipelineStats(orgId);

  if (stats.total === 0) {
    return {
      title: "Add Your First Candidates",
      description: "Start building your hiring pipeline by adding candidates manually or by position.",
      priority: "high",
      route: "/admin/hiring",
      estimatedImpact: "Enables all hiring intelligence",
    };
  }

  if (stats.overdueInterviews > 0) {
    return {
      title: `${stats.overdueInterviews} Overdue Interview${stats.overdueInterviews > 1 ? "s" : ""} Need Attention`,
      description: "Reschedule or complete overdue interviews to keep candidates engaged and prevent drop-off.",
      priority: "critical",
      route: "/admin/hiring",
      estimatedImpact: "Prevent candidate churn",
    };
  }

  if (stats.offer > 0) {
    return {
      title: `Review ${stats.offer} Pending Offer${stats.offer > 1 ? "s" : ""}`,
      description: "Candidates in offer stage are time-sensitive. Review and advance or close these quickly.",
      priority: "critical",
      route: "/admin/hiring",
      estimatedImpact: "Close top candidates before they accept elsewhere",
    };
  }

  if (stats.qualified > 0) {
    return {
      title: `Move ${stats.qualified} Qualified Candidate${stats.qualified > 1 ? "s" : ""} Forward`,
      description: "Qualified candidates are ready for outreach or interview scheduling. Take the next step.",
      priority: "high",
      route: "/admin/hiring",
      estimatedImpact: "Advance pipeline velocity",
    };
  }

  if (stats.pendingDrafts > 0) {
    return {
      title: `Send ${stats.pendingDrafts} Ready Outreach Draft${stats.pendingDrafts > 1 ? "s" : ""}`,
      description: "Review and send prepared outreach drafts to move candidates into the contacted stage.",
      priority: "medium",
      route: "/admin/hiring",
      estimatedImpact: "Grow active pipeline",
    };
  }

  return {
    title: "Run Assessments on New Candidates",
    description: `${stats.new} new candidate${stats.new !== 1 ? "s" : ""} waiting for assessment. Score them to prioritize outreach.`,
    priority: "medium",
    route: "/admin/hiring",
    estimatedImpact: "Identify top candidates faster",
  };
}

// ─── Executive brief ───────────────────────────────────────────────────────────

export async function generateHiringExecutiveBrief(orgId: string): Promise<any> {
  const [stats, metrics] = await Promise.all([
    getPipelineStats(orgId),
    computeHiringLearningMetrics(orgId),
  ]);

  const bestAction = await generateHiringBestAction(orgId);

  const keyWins: string[] = [];
  if (stats.hired > 0) keyWins.push(`${stats.hired} candidate${stats.hired > 1 ? "s" : ""} successfully hired`);
  if (stats.interview > 0) keyWins.push(`${stats.interview} active interview${stats.interview > 1 ? "s" : ""} in progress`);
  if (metrics.topSource) keyWins.push(`Top source: "${metrics.topSource}" with ${metrics.sourceBreakdown[metrics.topSource]?.hireRate ?? 0}% hire rate`);

  const keyRisks: string[] = [];
  if (stats.overdueInterviews > 0) keyRisks.push(`${stats.overdueInterviews} overdue interview${stats.overdueInterviews > 1 ? "s" : ""} — candidates may disengage`);
  if (stats.offer > 0) keyRisks.push(`${stats.offer} open offer${stats.offer > 1 ? "s" : ""} awaiting decision — competitor risk`);
  if (metrics.hireRate < 15 && metrics.totalSignals >= 5) keyRisks.push(`Low interview-to-hire rate (${metrics.hireRate}%)`);
  if (stats.total === 0) keyRisks.push("No candidates in pipeline — open positions may go unfilled");

  const keyOpportunities: string[] = [];
  if (stats.qualified > 0) keyOpportunities.push(`${stats.qualified} pre-qualified candidate${stats.qualified > 1 ? "s" : ""} ready for outreach`);
  if (metrics.interviewRate < 30) keyOpportunities.push("Improving outreach speed could unlock more interviews");

  const summary = stats.total === 0
    ? "Hiring pipeline is empty. Add candidates to activate the Hiring Department."
    : `${stats.total} total candidate${stats.total !== 1 ? "s" : ""} in pipeline. ` +
      `${stats.qualified} qualified, ${stats.interview} interviewing, ${stats.hired} hired. ` +
      `Average fit score: ${metrics.averageFitScore}/100. Hire rate: ${metrics.hireRate}%.`;

  const briefResult = await db.execute(sql`
    INSERT INTO hiring_executive_briefs
      (org_id, summary, best_action_today, key_wins, key_risks, key_opportunities, metrics)
    VALUES (
      ${orgId}, ${summary},
      ${bestAction?.title ?? "No action required"},
      ${JSON.stringify(keyWins)}::jsonb,
      ${JSON.stringify(keyRisks)}::jsonb,
      ${JSON.stringify(keyOpportunities)}::jsonb,
      ${JSON.stringify({
        totalCandidates:    stats.total,
        qualified:          stats.qualified,
        interviewing:       stats.interview,
        hired:              stats.hired,
        offers:             stats.offer,
        pendingDrafts:      stats.pendingDrafts,
        averageFitScore:    metrics.averageFitScore,
        hireRate:           metrics.hireRate,
      })}::jsonb
    )
    RETURNING *
  `);
  return rows(briefResult)[0] ?? null;
}

// ─── Recommendations ───────────────────────────────────────────────────────────

export async function generateHiringRecommendations(orgId: string): Promise<void> {
  const [stats, metrics] = await Promise.all([
    getPipelineStats(orgId),
    computeHiringLearningMetrics(orgId),
  ]);

  const recs: Array<{ category: string; recommendation: string; reasoning: string; confidenceScore: number; supportingData: any }> = [];

  if (stats.qualified >= 3) {
    recs.push({
      category: "outreach",
      recommendation: `Schedule interviews with ${stats.qualified} qualified candidates`,
      reasoning: `${stats.qualified} candidates have been assessed and are ready to advance. Delaying reduces offer acceptance probability.`,
      confidenceScore: 88,
      supportingData: { qualifiedCount: stats.qualified },
    });
  }

  if (stats.offer > 0) {
    recs.push({
      category: "pipeline",
      recommendation: `Review and close ${stats.offer} pending offer${stats.offer > 1 ? "s" : ""}`,
      reasoning: "Open offers represent high-fit candidates with competing timelines. Each day of delay reduces acceptance probability.",
      confidenceScore: 92,
      supportingData: { offerCount: stats.offer },
    });
  }

  if (metrics.topSource && metrics.totalSignals >= 5) {
    recs.push({
      category: "discovery",
      recommendation: `Increase sourcing through "${metrics.topSource}" — your highest-performing channel`,
      reasoning: `"${metrics.topSource}" produces the highest hire rate in your pipeline. Doubling down on this source improves hiring efficiency.`,
      confidenceScore: 82,
      supportingData: { source: metrics.topSource, hireRate: metrics.sourceBreakdown[metrics.topSource]?.hireRate ?? 0 },
    });
  }

  if (stats.total < 5) {
    recs.push({
      category: "discovery",
      recommendation: "Expand candidate pipeline — fewer than 5 candidates reduces selection quality",
      reasoning: "Best-in-class hiring pipelines maintain 10+ qualified candidates per open role. Add more candidates to improve offer acceptance rates.",
      confidenceScore: 75,
      supportingData: { currentTotal: stats.total },
    });
  }

  for (const rec of recs) {
    await db.execute(sql`
      INSERT INTO hiring_recommendations
        (org_id, category, recommendation, reasoning, confidence_score, supporting_data)
      VALUES
        (${orgId}, ${rec.category}, ${rec.recommendation}, ${rec.reasoning},
         ${rec.confidenceScore}, ${JSON.stringify(rec.supportingData)}::jsonb)
      ON CONFLICT DO NOTHING
    `).catch(() => {});
  }
}

// ─── Run full executive analysis ───────────────────────────────────────────────

export async function runHiringExecutiveAnalysis(orgId: string): Promise<{
  briefGenerated: boolean;
  recommendationsGenerated: number;
}> {
  await generateHiringExecutiveBrief(orgId);
  await generateHiringRecommendations(orgId);
  const recs = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM hiring_recommendations WHERE org_id = ${orgId}
  `).then(r => n(rows(r)[0]?.cnt));
  return { briefGenerated: true, recommendationsGenerated: recs };
}
