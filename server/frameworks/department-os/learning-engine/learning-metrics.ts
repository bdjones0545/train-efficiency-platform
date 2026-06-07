/**
 * Department OS v2 — Learning Metrics
 * Shared rate calculation helpers used by every department learning agent.
 * Uses `pct` internally but does NOT export it — use pipeline/pipeline-engine
 * for the shared pct() if needed, or call this module's named helpers directly.
 */

import type { Signal, SourcePerformance, LearningReport, Insight } from "./learning-types";

// ─── Internal percentage helper ────────────────────────────────────────────────

function pct(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

// ─── Named rate helpers ────────────────────────────────────────────────────────

export function calculateContactRate(signals: Signal[]): number {
  return pct(signals.filter(s => s.contacted).length, signals.length);
}

export function calculateReplyRate(signals: Signal[]): number {
  const contacted = signals.filter(s => s.contacted);
  return pct(contacted.filter(s => s.responded).length, contacted.length);
}

export function calculateConversionRate(signals: Signal[]): number {
  const responded = signals.filter(s => s.responded);
  return pct(responded.filter(s => s.converted).length, responded.length);
}

export function calculateOutcomeRate(signals: Signal[]): number {
  const terminal = signals.filter(s => s.terminal);
  return pct(terminal.filter(s => s.won).length, terminal.length);
}

export function calculateWinRate(signals: Signal[]): number {
  return pct(signals.filter(s => s.won).length, signals.length);
}

export function averageScore(signals: Signal[]): number {
  if (signals.length === 0) return 0;
  return Math.round(signals.reduce((sum, s) => sum + s.score, 0) / signals.length);
}

// ─── Source performance ────────────────────────────────────────────────────────

export function calculateSourcePerformance(signals: Signal[]): SourcePerformance[] {
  const bySource: Record<string, Signal[]> = {};
  for (const s of signals) {
    const src = (s.source || "unknown").toLowerCase();
    if (!bySource[src]) bySource[src] = [];
    bySource[src].push(s);
  }

  return Object.entries(bySource).map(([source, sigs]) => ({
    source,
    count:       sigs.length,
    avgScore:    averageScore(sigs),
    contactRate: calculateContactRate(sigs),
    replyRate:   calculateReplyRate(sigs),
    winRate:     calculateWinRate(sigs),
  }));
}

export function topByWinRate(sources: SourcePerformance[]): string | null {
  if (sources.length === 0) return null;
  return sources.reduce((best, s) => s.winRate > best.winRate ? s : best).source;
}

// ─── Build learning report skeleton ───────────────────────────────────────────

export function buildLearningReport(
  departmentId: string,
  orgId: string,
  signals: Signal[],
  totalEntities: number,
  insights: Insight[],
): LearningReport {
  const sources = calculateSourcePerformance(signals);
  return {
    departmentId,
    orgId,
    totalSignals:      signals.length,
    totalEntities,
    averageScore:      averageScore(signals),
    contactRate:       calculateContactRate(signals),
    replyRate:         calculateReplyRate(signals),
    conversionRate:    calculateConversionRate(signals),
    winRate:           calculateWinRate(signals),
    topSource:         topByWinRate(sources),
    topCategory:       null,
    sourcePerformance: sources,
    insights,
    generatedAt:       new Date().toISOString(),
  };
}
