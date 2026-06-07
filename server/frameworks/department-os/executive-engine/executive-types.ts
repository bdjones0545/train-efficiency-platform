/**
 * Department OS v2 — Executive Engine Types
 * Imports shared types from the v1 top-level framework files and adds
 * only the NEW types needed by the executive-engine (BestActionCandidate,
 * PRIORITY_ORDER). All consuming departments should import BestAction,
 * ExecutiveBrief, etc. from here (which re-exports them).
 */

export type {
  ActionPriority,
  BestAction,
  ExecutiveBrief,
  DepartmentRecommendation,
  RecommendationStatus,
  RecommendationCategory,
  DepartmentExecutiveEngine,
} from "../department-executive";

// ─── New in v2: priority ordering map ─────────────────────────────────────────

import type { ActionPriority } from "../department-executive";

export const PRIORITY_ORDER: Record<ActionPriority, number> = {
  critical: 4,
  high:     3,
  medium:   2,
  low:      1,
};

export function higherPriority(a: ActionPriority, b: ActionPriority): ActionPriority {
  return PRIORITY_ORDER[a] >= PRIORITY_ORDER[b] ? a : b;
}

// ─── New in v2: best-action candidate (for ranking logic) ─────────────────────

import type { BestAction } from "../department-executive";

export interface BestActionCandidate {
  action:        Omit<BestAction, "department">;
  condition:     boolean;   // true = this action is applicable right now
  priorityScore: number;    // 0–100 composite urgency
}
