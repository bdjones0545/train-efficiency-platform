/**
 * Department OS v2 — Pipeline Engine
 * Shared helpers for counting stages, calculating conversions, and
 * grouping records into pipeline columns.
 * NOTE: rows(), n(), pct() are exported for department use but are prefixed
 * to avoid ambiguity with other module-level helpers.
 */

import type { StageConversion, PipelineMetrics, PipelineStage } from "./pipeline-types";

// ─── Low-level helpers (exported for direct department use) ───────────────────

export function dbRows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

export function toNum(v: unknown): number {
  return Number(v ?? 0);
}

export function pctOf(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

// ─── Stage counts ─────────────────────────────────────────────────────────────

export function calculateStageCounts(
  records: Array<{ stage?: string; status?: string }>,
  stages: PipelineStage[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of stages) counts[s.id] = 0;
  for (const r of records) {
    const key = r.stage ?? r.status ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function stageCountsFromRows(
  dbRows: Array<{ status?: string; stage?: string; cnt?: unknown }>,
): Record<string, number> {
  return Object.fromEntries(
    dbRows.map(r => [r.status ?? r.stage ?? "unknown", toNum(r.cnt)]),
  );
}

// ─── Stage percents ───────────────────────────────────────────────────────────

export function stagePercents(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (total === 0) return Object.fromEntries(Object.keys(counts).map(k => [k, 0]));
  return Object.fromEntries(
    Object.entries(counts).map(([k, v]) => [k, pctOf(v, total)]),
  );
}

// ─── Conversion rates ─────────────────────────────────────────────────────────

export function calculateConversionRates(
  counts: Record<string, number>,
  stages: PipelineStage[],
): StageConversion[] {
  const ordered = [...stages].sort((a, b) => a.order - b.order).filter(s => !s.terminal);
  const conversions: StageConversion[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i];
    const to   = ordered[i + 1];
    const fromCount = counts[from.id] ?? 0;
    const toCount   = counts[to.id] ?? 0;
    conversions.push({
      fromStage:     from.name,
      toStage:       to.name,
      count:         toCount,
      conversionPct: pctOf(toCount, fromCount),
    });
  }
  return conversions;
}

// ─── Group records by stage ────────────────────────────────────────────────────

export function groupByStage<T extends { stage?: string; status?: string }>(
  records: T[],
  stages: PipelineStage[],
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const s of stages) result[s.id] = [];
  for (const r of records) {
    const key = r.stage ?? r.status ?? "unknown";
    if (result[key]) result[key].push(r);
    else if (result["new"]) result["new"].push(r);
  }
  return result;
}

// ─── Full pipeline metrics ─────────────────────────────────────────────────────

export function calculatePipelineMetrics(
  departmentId: string,
  records: Array<{ stage?: string; status?: string; score?: number; fit_score?: number }>,
  stages: PipelineStage[],
): PipelineMetrics {
  const counts   = calculateStageCounts(records, stages);
  const total    = records.length;
  const percents = stagePercents(counts);
  const conversions = calculateConversionRates(counts, stages);

  const terminalStages = stages.filter(s => s.terminal).map(s => s.id);
  const wonStages      = terminalStages.filter(id => ["won", "hired", "closed_won"].includes(id));
  const lostStages     = terminalStages.filter(id => !wonStages.includes(id));
  const won  = wonStages.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const lost = lostStages.reduce((s, k) => s + (counts[k] ?? 0), 0);

  const scored = records.filter(r => (r.score ?? r.fit_score) != null);
  const avgScore = scored.length > 0
    ? Math.round(scored.reduce((s, r) => s + toNum(r.score ?? r.fit_score), 0) / scored.length)
    : 0;

  return {
    departmentId,
    total,
    stageCounts:     counts,
    stagePercents:   percents,
    conversionRates: conversions,
    terminalCounts:  { won, lost },
    overallWinRate:  pctOf(won, won + lost),
    averageScore:    avgScore,
  };
}
