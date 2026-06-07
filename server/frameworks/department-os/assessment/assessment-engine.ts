/**
 * Department OS v2 — Assessment Engine
 * Shared composite scoring logic. Departments provide dimension scores
 * and weights; this engine normalizes and combines them.
 */

import type { ScoringWeight, AssessmentResult } from "./assessment-types";
import { getScoreBand, actionFromScore } from "./assessment-types";

// ─── Composite score ───────────────────────────────────────────────────────────

/**
 * Compute a weighted composite score from dimension sub-scores.
 *
 * @param dimensions  Record of dimension name → raw score (0–100)
 * @param weights     Array of { dimension, weight } — should sum to 1.0
 */
export function compositeScore(
  dimensions: Record<string, number>,
  weights: ScoringWeight[],
): number {
  let score = 0;
  let totalWeight = 0;
  for (const { dimension, weight } of weights) {
    const raw = dimensions[dimension] ?? 0;
    score += raw * weight;
    totalWeight += weight;
  }
  // Normalize if weights don't sum to 1.0
  return Math.min(100, Math.round(totalWeight > 0 ? score / totalWeight : score));
}

// ─── Confidence from data completeness ────────────────────────────────────────

/**
 * Estimate confidence as a function of how many fields are populated.
 *
 * @param fields     All possible field values for the entity
 * @param required   Field keys that are considered "high-signal"
 */
export function confidenceFromCompleteness(
  fields: Record<string, unknown>,
  required: string[],
): number {
  const present  = required.filter(k => fields[k] != null && fields[k] !== "");
  const baseConf = Math.round((present.length / Math.max(required.length, 1)) * 100);
  // Notes or free-text fields boost confidence by ~10 pts
  const hasNotes = Object.values(fields).some(v => typeof v === "string" && (v as string).length > 30);
  return Math.min(100, baseConf + (hasNotes ? 10 : 0));
}

// ─── Strength/concern builders ────────────────────────────────────────────────

export function strengthsFromDimensions(
  dimensions: Record<string, number>,
  labels: Record<string, string>,
  threshold = 70,
): string[] {
  return Object.entries(dimensions)
    .filter(([, v]) => v >= threshold)
    .map(([k]) => labels[k] ?? k)
    .slice(0, 4);
}

export function concernsFromDimensions(
  dimensions: Record<string, number>,
  labels: Record<string, string>,
  threshold = 50,
): string[] {
  return Object.entries(dimensions)
    .filter(([, v]) => v < threshold)
    .map(([k]) => `Low ${(labels[k] ?? k).toLowerCase()} score`)
    .slice(0, 4);
}

// ─── Abstract base scoring engine ─────────────────────────────────────────────

export abstract class BaseScoringEngine {
  abstract readonly departmentId: string;
  abstract readonly weights: ScoringWeight[];
  abstract readonly dimensionLabels: Record<string, string>;

  protected clamp(v: number, min = 0, max = 100): number {
    return Math.max(min, Math.min(max, Math.round(v)));
  }

  protected buildResult(opts: {
    entityId:        string;
    entityType:      string;
    dimensions:      Record<string, number>;
    confidence:      number;
    reasoning:       string;
    extraStrengths?: string[];
    extraConcerns?:  string[];
    recommendations: string[];
  }): AssessmentResult {
    const score = compositeScore(opts.dimensions, this.weights);
    const strengths  = [...strengthsFromDimensions(opts.dimensions, this.dimensionLabels), ...(opts.extraStrengths ?? [])];
    const concerns   = [...concernsFromDimensions(opts.dimensions, this.dimensionLabels), ...(opts.extraConcerns ?? [])];

    return {
      entityId:          opts.entityId,
      entityType:        opts.entityType,
      score,
      confidence:        opts.confidence,
      reasoning:         opts.reasoning,
      strengths:         strengths.slice(0, 4),
      concerns:          concerns.slice(0, 4),
      recommendations:   opts.recommendations.slice(0, 4),
      recommendedAction: actionFromScore(score),
      dimensions:        opts.dimensions,
    };
  }
}
