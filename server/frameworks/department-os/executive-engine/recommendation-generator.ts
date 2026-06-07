/**
 * Department OS v2 — Recommendation Generator
 * Imports existing scoring helpers from v1 department-recommendations.ts
 * and adds prioritizeRecommendations() as the new v2 contribution.
 */

export {
  getConfidenceBand,
  confidenceColor,
  scoreRecommendation,
  createRecommendation,
  groupRecommendationsByStatus,
} from "../department-recommendations";

export type {
  ConfidenceBand,
  RecommendationPriority,
} from "../department-recommendations";

import type { DepartmentRecommendation } from "../department-executive";
import { scoreRecommendation } from "../department-recommendations";

// ─── New in v2: sort recommendations by composite priority score ───────────────

export function prioritizeRecommendations(
  recs: DepartmentRecommendation[],
): DepartmentRecommendation[] {
  return [...recs].sort((a, b) => {
    const as = scoreRecommendation(a.confidenceScore, a.category, a.status).score;
    const bs = scoreRecommendation(b.confidenceScore, b.category, b.status).score;
    return bs - as;
  });
}
