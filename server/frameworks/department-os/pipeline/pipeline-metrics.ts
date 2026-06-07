/**
 * Department OS v2 — Pipeline Metrics
 * Velocity and trend calculations for pipeline reporting.
 */

import type { PipelineMetrics } from "./pipeline-types";

// ─── Velocity ─────────────────────────────────────────────────────────────────

export interface PipelineVelocity {
  avgDaysInStage:      Record<string, number>;
  estimatedTimeToClose: number; // days
  bottleneckStage:      string | null;
}

/**
 * Identify the stage with the worst conversion rate as the bottleneck.
 */
export function identifyBottleneck(metrics: PipelineMetrics): string | null {
  if (metrics.conversionRates.length === 0) return null;
  return metrics.conversionRates
    .reduce((worst, c) => c.conversionPct < worst.conversionPct ? c : worst)
    .fromStage;
}

// ─── Health labels ─────────────────────────────────────────────────────────────

export type PipelineHealth = "healthy" | "growing" | "stalled" | "empty" | "critical";

export function assessPipelineHealth(metrics: PipelineMetrics): PipelineHealth {
  if (metrics.total === 0) return "empty";
  if (metrics.overallWinRate === 0 && metrics.total < 3) return "critical";
  const bottleneck = identifyBottleneck(metrics);
  if (bottleneck) {
    const worstConv = metrics.conversionRates.find(c => c.fromStage === bottleneck);
    if (worstConv && worstConv.conversionPct < 10) return "stalled";
  }
  if (metrics.overallWinRate >= 20) return "healthy";
  return "growing";
}

// ─── Summary string ────────────────────────────────────────────────────────────

export function pipelineSummaryString(metrics: PipelineMetrics): string {
  const { total, terminalCounts, overallWinRate, averageScore } = metrics;
  if (total === 0) return "Pipeline is empty.";
  return `${total} total records. ${terminalCounts.won} wins, ${terminalCounts.lost} lost. ` +
    `Win rate: ${overallWinRate}%. Avg score: ${averageScore}/100.`;
}

// ─── Stage summary ─────────────────────────────────────────────────────────────

export function topStagesByVolume(
  metrics: PipelineMetrics,
  limit = 3,
): Array<{ stage: string; count: number; pct: number }> {
  return Object.entries(metrics.stageCounts)
    .map(([stage, count]) => ({ stage, count, pct: metrics.stagePercents[stage] ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
