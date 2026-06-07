/**
 * Hiring Learning Agent
 * Synthesizes hiring signal data into actionable insights.
 * No AI inference — deterministic pattern analysis.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}
function n(v: any): number { return Number(v ?? 0); }

export interface HiringLearningMetrics {
  totalSignals:        number;
  totalCandidates:     number;
  averageFitScore:     number;
  interviewRate:       number;
  hireRate:            number;
  rejectionRate:       number;
  topSource:           string | null;
  topPosition:         string | null;
  sourceBreakdown:     Record<string, { count: number; avgFit: number; hireRate: number }>;
  positionBreakdown:   Record<string, { count: number; avgFit: number; hireRate: number }>;
}

export interface HiringLearningInsight {
  category:   string;
  insight:    string;
  confidence: number;
  impact:     "high" | "medium" | "low";
  actionable: boolean;
}

// ─── Compute metrics ───────────────────────────────────────────────────────────

export async function computeHiringLearningMetrics(orgId: string): Promise<HiringLearningMetrics> {
  const [signalRows, candidateRows] = await Promise.all([
    db.execute(sql`
      SELECT source, position, fit_score, interviewed, hired, rejected
      FROM hiring_learning_signals
      WHERE org_id = ${orgId}
    `).then(rows),
    db.execute(sql`
      SELECT status, COUNT(*) as cnt FROM hiring_candidates
      WHERE org_id = ${orgId}
      GROUP BY status
    `).then(rows),
  ]);

  const total         = signalRows.length;
  const interviewed   = signalRows.filter((s: any) => s.interviewed).length;
  const hired         = signalRows.filter((s: any) => s.hired).length;
  const rejected      = signalRows.filter((s: any) => s.rejected).length;
  const avgFit        = total > 0 ? Math.round(signalRows.reduce((sum: number, s: any) => sum + n(s.fit_score), 0) / total) : 0;
  const interviewRate = total > 0 ? Math.round((interviewed / total) * 100) : 0;
  const hireRate      = interviewed > 0 ? Math.round((hired / interviewed) * 100) : 0;
  const rejectionRate = total > 0 ? Math.round((rejected / total) * 100) : 0;

  const sourceBreakdown: Record<string, { count: number; avgFit: number; hireRate: number }> = {};
  const positionBreakdown: Record<string, { count: number; avgFit: number; hireRate: number }> = {};

  for (const s of signalRows as any[]) {
    const src = (s.source ?? "unknown").toLowerCase();
    const pos = (s.position ?? "unknown").toLowerCase();

    if (!sourceBreakdown[src]) sourceBreakdown[src] = { count: 0, avgFit: 0, hireRate: 0 };
    sourceBreakdown[src].count++;
    sourceBreakdown[src].avgFit += n(s.fit_score);
    if (s.hired) sourceBreakdown[src].hireRate++;

    if (!positionBreakdown[pos]) positionBreakdown[pos] = { count: 0, avgFit: 0, hireRate: 0 };
    positionBreakdown[pos].count++;
    positionBreakdown[pos].avgFit += n(s.fit_score);
    if (s.hired) positionBreakdown[pos].hireRate++;
  }

  // Normalize averages
  for (const k of Object.keys(sourceBreakdown)) {
    const bd = sourceBreakdown[k];
    bd.avgFit   = bd.count > 0 ? Math.round(bd.avgFit / bd.count) : 0;
    bd.hireRate = bd.count > 0 ? Math.round((bd.hireRate / bd.count) * 100) : 0;
  }
  for (const k of Object.keys(positionBreakdown)) {
    const bd = positionBreakdown[k];
    bd.avgFit   = bd.count > 0 ? Math.round(bd.avgFit / bd.count) : 0;
    bd.hireRate = bd.count > 0 ? Math.round((bd.hireRate / bd.count) * 100) : 0;
  }

  const topSource = Object.entries(sourceBreakdown)
    .sort((a, b) => b[1].hireRate - a[1].hireRate)[0]?.[0] ?? null;
  const topPosition = Object.entries(positionBreakdown)
    .sort((a, b) => b[1].count - a[1].count)[0]?.[0] ?? null;

  const totalCandidates = candidateRows.reduce((sum: number, r: any) => sum + n(r.cnt), 0);

  return {
    totalSignals: total, totalCandidates, averageFitScore: avgFit,
    interviewRate, hireRate, rejectionRate, topSource, topPosition,
    sourceBreakdown, positionBreakdown,
  };
}

// ─── Generate insights ─────────────────────────────────────────────────────────

export async function generateHiringInsights(orgId: string): Promise<HiringLearningInsight[]> {
  const metrics = await computeHiringLearningMetrics(orgId);
  const insights: HiringLearningInsight[] = [];

  if (metrics.totalCandidates === 0) {
    insights.push({
      category: "pipeline",
      insight: "No candidates in pipeline yet. Add candidates to start building hiring data.",
      confidence: 100,
      impact: "high",
      actionable: true,
    });
    return insights;
  }

  if (metrics.topSource) {
    insights.push({
      category: "sourcing",
      insight: `"${metrics.topSource}" produces the highest hire rate (${metrics.sourceBreakdown[metrics.topSource]?.hireRate ?? 0}%). Prioritize this channel.`,
      confidence: 85,
      impact: "high",
      actionable: true,
    });
  }

  if (metrics.hireRate < 20 && metrics.totalSignals >= 5) {
    insights.push({
      category: "conversion",
      insight: `Interview-to-hire rate is ${metrics.hireRate}%. Review candidate quality criteria and interview process.`,
      confidence: 75,
      impact: "medium",
      actionable: true,
    });
  }

  if (metrics.interviewRate < 30 && metrics.totalSignals >= 5) {
    insights.push({
      category: "pipeline",
      insight: `Only ${metrics.interviewRate}% of sourced candidates reach interviews. Consider faster outreach or lower qualification threshold.`,
      confidence: 70,
      impact: "medium",
      actionable: true,
    });
  }

  if (metrics.averageFitScore >= 75) {
    insights.push({
      category: "quality",
      insight: `Average candidate fit score is ${metrics.averageFitScore}/100 — high-quality pipeline. Accelerate outreach to move fast on top candidates.`,
      confidence: 80,
      impact: "high",
      actionable: true,
    });
  }

  if (metrics.rejectionRate > 60) {
    insights.push({
      category: "sourcing",
      insight: `${metrics.rejectionRate}% rejection rate. Review sourcing criteria — pipeline may be too broad.`,
      confidence: 72,
      impact: "medium",
      actionable: true,
    });
  }

  return insights;
}

// ─── Run full learning cycle ───────────────────────────────────────────────────

export async function runHiringLearning(orgId: string): Promise<{
  metricsComputed: boolean;
  insightsGenerated: number;
}> {
  const insights = await generateHiringInsights(orgId);
  return { metricsComputed: true, insightsGenerated: insights.length };
}
