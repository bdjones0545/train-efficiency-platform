/**
 * Department OS v2 — Assessment Types
 * Generic assessment contract shared across Opportunity Qualification,
 * Hiring Assessment, and any future department scoring engines.
 */

// ─── Assessment input ──────────────────────────────────────────────────────────

export interface AssessmentInput {
  id?:        string;
  orgId:      string;
  entityId:   string;
  entityType: string;
  fields:     Record<string, string | number | boolean | null>;
  notes?:     string;
}

// ─── Scoring weight ────────────────────────────────────────────────────────────

export interface ScoringWeight {
  dimension: string;
  weight:    number;   // 0.0 – 1.0, sum should equal 1.0
}

// ─── Assessment result ─────────────────────────────────────────────────────────

export interface AssessmentResult {
  entityId:          string;
  entityType:        string;
  score:             number;           // 0–100 composite
  confidence:        number;           // 0–100
  reasoning:         string;
  strengths:         string[];
  concerns:          string[];
  recommendations:   string[];
  recommendedAction: string;
  dimensions:        Record<string, number>;
  metadata?:         Record<string, unknown>;
}

// ─── Score band ────────────────────────────────────────────────────────────────

export type ScoreBand = "excellent" | "strong" | "qualified" | "marginal" | "low";

export function getScoreBand(score: number): ScoreBand {
  if (score >= 85) return "excellent";
  if (score >= 72) return "strong";
  if (score >= 58) return "qualified";
  if (score >= 40) return "marginal";
  return "low";
}

// ─── Recommended action from score ────────────────────────────────────────────

export function actionFromScore(
  score: number,
  highAction = "advance_immediately",
  midAction  = "conduct_screening",
  lowAction  = "hold_for_review",
): string {
  if (score >= 75) return highAction;
  if (score >= 55) return midAction;
  return lowAction;
}

// ─── Keyword scorer ────────────────────────────────────────────────────────────

export interface KeywordRule {
  keywords:  string[];
  points:    number;
}

export function scoreKeywords(text: string, rules: KeywordRule[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const rule of rules) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      score += rule.points;
    }
  }
  return score;
}
