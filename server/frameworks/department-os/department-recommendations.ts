/**
 * Department OS — Recommendation Engine Models
 * Shared types and helpers for generating, scoring, and managing
 * department recommendations consistently across the platform.
 */

import type { DepartmentRecommendation, RecommendationCategory, RecommendationStatus } from "./department-executive";

// ─── Re-export core types for convenience ──────────────────────────────────────

export type { DepartmentRecommendation, RecommendationCategory, RecommendationStatus };

// ─── Confidence band ───────────────────────────────────────────────────────────

export type ConfidenceBand = "high" | "medium" | "low";

export function getConfidenceBand(score: number): ConfidenceBand {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export function confidenceColor(score: number): string {
  if (score >= 75) return "emerald";
  if (score >= 50) return "amber";
  return "gray";
}

// ─── Priority scoring ──────────────────────────────────────────────────────────

export interface RecommendationPriority {
  score:           number;   // 0–100 composite
  confidenceBand:  ConfidenceBand;
  shouldSurface:   boolean;  // false = too low confidence to show
}

export function scoreRecommendation(
  confidenceScore: number,
  category: RecommendationCategory,
  status: RecommendationStatus,
): RecommendationPriority {
  const categoryWeight: Record<RecommendationCategory, number> = {
    discovery:  60,
    outreach:   75,
    pipeline:   85,
    execution:  80,
    learning:   55,
    general:    50,
  };

  const base = categoryWeight[category] ?? 50;
  const score = Math.round((base * 0.5) + (confidenceScore * 0.5));

  return {
    score,
    confidenceBand: getConfidenceBand(confidenceScore),
    shouldSurface: confidenceScore >= 40 && status === "pending",
  };
}

// ─── Grouping helper ───────────────────────────────────────────────────────────

export function groupRecommendationsByStatus(
  recs: DepartmentRecommendation[],
): Record<RecommendationStatus, DepartmentRecommendation[]> {
  return {
    pending:     recs.filter(r => r.status === "pending"),
    accepted:    recs.filter(r => r.status === "accepted"),
    dismissed:   recs.filter(r => r.status === "dismissed"),
    implemented: recs.filter(r => r.status === "implemented"),
  };
}

// ─── Recommendation factory ────────────────────────────────────────────────────

export function createRecommendation(opts: Omit<DepartmentRecommendation, "createdAt" | "status">): DepartmentRecommendation {
  return { ...opts, status: "pending", createdAt: new Date() };
}
