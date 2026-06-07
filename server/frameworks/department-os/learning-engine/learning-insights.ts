/**
 * Department OS v2 — Learning Insights
 * Deterministic insight generators from signal data.
 * Departments call these helpers instead of repeating the pattern logic.
 */

import type { Signal, Insight, SourcePerformance } from "./learning-types";
import { calculateSourcePerformance, topByWinRate, calculateWinRate, averageScore } from "./learning-metrics";

// ─── Generic insight factories ─────────────────────────────────────────────────

export function emptyPipelineInsight(department: string, orgId: string, entityLabel: string): Insight {
  return {
    department, orgId,
    category:   "pipeline",
    insight:    `No ${entityLabel.toLowerCase()}s in pipeline yet. Add ${entityLabel.toLowerCase()}s to start building learning data.`,
    confidence: 100,
    impact:     "high",
    actionable: true,
  };
}

export function topSourceInsight(
  department: string, orgId: string,
  source: string, winRate: number,
): Insight {
  return {
    department, orgId,
    category:   "sourcing",
    insight:    `"${source}" produces the highest win rate (${winRate}%). Prioritize this channel.`,
    confidence: 85,
    impact:     "high",
    actionable: true,
    source,
  };
}

export function lowConversionInsight(
  department: string, orgId: string,
  conversionRate: number, stageName: string,
): Insight {
  return {
    department, orgId,
    category:   "conversion",
    insight:    `${stageName} conversion rate is ${conversionRate}%. Review process at this stage to improve throughput.`,
    confidence: 75,
    impact:     "medium",
    actionable: true,
  };
}

export function highScorePipelineInsight(
  department: string, orgId: string, avgScore: number,
): Insight {
  return {
    department, orgId,
    category:   "quality",
    insight:    `Average score is ${avgScore}/100 — high-quality pipeline. Accelerate outreach to move fast on top candidates/prospects.`,
    confidence: 80,
    impact:     "high",
    actionable: true,
  };
}

export function highRejectionInsight(
  department: string, orgId: string, rejectionRate: number,
): Insight {
  return {
    department, orgId,
    category:   "sourcing",
    insight:    `${rejectionRate}% rejection/loss rate. Review sourcing criteria — pipeline may be too broad.`,
    confidence: 72,
    impact:     "medium",
    actionable: true,
  };
}

export function lowVolumeInsight(
  department: string, orgId: string, total: number, entityLabel: string,
): Insight {
  return {
    department, orgId,
    category:   "pipeline",
    insight:    `Only ${total} ${entityLabel.toLowerCase()}${total !== 1 ? "s" : ""} in pipeline. Expand sourcing for better selection quality.`,
    confidence: 78,
    impact:     "medium",
    actionable: true,
  };
}

// ─── Standard insight generator ────────────────────────────────────────────────

export interface InsightGeneratorConfig {
  department:      string;
  orgId:           string;
  entityLabel:     string;
  signals:         Signal[];
  totalEntities:   number;
  rejectionRate?:  number;
  winRate?:        number;
  avgScore?:       number;
  conversionRates?: Array<{ stage: string; rate: number }>;
  minVolumeTarget?: number;
}

export function generateStandardInsights(cfg: InsightGeneratorConfig): Insight[] {
  const { department, orgId, entityLabel, signals, totalEntities } = cfg;
  const insights: Insight[] = [];

  if (totalEntities === 0) {
    insights.push(emptyPipelineInsight(department, orgId, entityLabel));
    return insights;
  }

  const sources = calculateSourcePerformance(signals);
  const top = topByWinRate(sources);
  if (top && signals.length >= 5) {
    const topSrc = sources.find(s => s.source === top);
    if (topSrc) insights.push(topSourceInsight(department, orgId, top, topSrc.winRate));
  }

  const avg = cfg.avgScore ?? averageScore(signals);
  if (avg >= 75 && signals.length >= 3) {
    insights.push(highScorePipelineInsight(department, orgId, avg));
  }

  const win = cfg.winRate ?? calculateWinRate(signals);
  if (win < 15 && signals.length >= 5) {
    insights.push(lowConversionInsight(department, orgId, win, "pipeline"));
  }

  const rejection = cfg.rejectionRate ?? 0;
  if (rejection > 60 && signals.length >= 5) {
    insights.push(highRejectionInsight(department, orgId, rejection));
  }

  const minVol = cfg.minVolumeTarget ?? 5;
  if (totalEntities < minVol) {
    insights.push(lowVolumeInsight(department, orgId, totalEntities, entityLabel));
  }

  return insights;
}
