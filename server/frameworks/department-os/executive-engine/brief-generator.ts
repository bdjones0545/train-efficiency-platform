/**
 * Department OS v2 — Brief Generator
 * Reusable helpers for constructing executive brief sections.
 */

import type { ExecutiveBrief } from "./executive-types";

// ─── Brief section ─────────────────────────────────────────────────────────────

export interface BriefSection {
  type:  "wins" | "risks" | "opportunities" | "summary";
  items: string[];
}

// ─── Win builders ──────────────────────────────────────────────────────────────

export function buildWinsFromCounts(
  metrics: Record<string, number>,
  labels: Array<{ key: string; singular: string; plural: string; threshold?: number }>,
): string[] {
  return labels
    .filter(l => (metrics[l.key] ?? 0) > (l.threshold ?? 0))
    .map(l => {
      const count = metrics[l.key];
      return `${count} ${count === 1 ? l.singular : l.plural}`;
    });
}

// ─── Risk builders ─────────────────────────────────────────────────────────────

export function buildRisksFromChecks(
  counts: Record<string, number>,
  rules: Array<{
    key:      string;
    singular: string;
    plural:   string;
    suffix:   string;
    threshold?: number;
  }>,
): string[] {
  return rules
    .filter(r => (counts[r.key] ?? 0) > (r.threshold ?? 0))
    .map(r => {
      const c = counts[r.key];
      return `${c} ${c === 1 ? r.singular : r.plural} ${r.suffix}`;
    });
}

// ─── Summary formatter ─────────────────────────────────────────────────────────

export function formatPipelineSummary(opts: {
  entityLabel:      string;
  total:            number;
  qualified?:       number;
  active?:          number;
  won?:             number;
  averageScore?:    number;
  winRate?:         number;
}): string {
  const { entityLabel, total, won, averageScore, winRate } = opts;
  if (total === 0) return `No ${entityLabel.toLowerCase()}s in pipeline.`;
  const parts: string[] = [`${total} ${entityLabel.toLowerCase()}${total !== 1 ? "s" : ""} in pipeline.`];
  if (opts.qualified) parts.push(`${opts.qualified} qualified.`);
  if (opts.active)    parts.push(`${opts.active} active.`);
  if (won !== undefined)          parts.push(`${won} won/hired.`);
  if (averageScore !== undefined) parts.push(`Avg score: ${averageScore}/100.`);
  if (winRate !== undefined)      parts.push(`Win rate: ${winRate}%.`);
  return parts.join(" ");
}

// ─── Compose brief ─────────────────────────────────────────────────────────────

export function composeBrief(opts: {
  department:      string;
  orgId:           string;
  summary:         string;
  bestActionToday: string;
  keyWins:         string[];
  keyRisks:        string[];
  keyOpportunities: string[];
  metrics:         Record<string, number | string>;
}): ExecutiveBrief {
  return {
    ...opts,
    generatedAt: new Date(),
  };
}
