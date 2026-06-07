/**
 * Department OS v2 — Assessment Results
 * Helpers for presenting and summarizing assessment outputs.
 */

import type { AssessmentResult } from "./assessment-types";
import { getScoreBand } from "./assessment-types";

// ─── Assessment summary ────────────────────────────────────────────────────────

export interface AssessmentSummary {
  entityId:    string;
  score:       number;
  band:        string;
  confidence:  number;
  topStrength: string | null;
  topConcern:  string | null;
  action:      string;
}

export function summarizeAssessment(result: AssessmentResult): AssessmentSummary {
  return {
    entityId:    result.entityId,
    score:       result.score,
    band:        getScoreBand(result.score),
    confidence:  result.confidence,
    topStrength: result.strengths[0] ?? null,
    topConcern:  result.concerns[0] ?? null,
    action:      result.recommendedAction,
  };
}

// ─── Score color ───────────────────────────────────────────────────────────────

export function scoreColor(score: number): string {
  if (score >= 80) return "green";
  if (score >= 60) return "yellow";
  return "red";
}

// ─── Confidence band ───────────────────────────────────────────────────────────

export function confidenceBand(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 75) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

// ─── Dimension breakdown ───────────────────────────────────────────────────────

export function dimensionBreakdown(
  dimensions: Record<string, number>,
  labels: Record<string, string>,
): Array<{ label: string; score: number; color: string }> {
  return Object.entries(dimensions).map(([key, score]) => ({
    label: labels[key] ?? key,
    score,
    color: scoreColor(score),
  }));
}
