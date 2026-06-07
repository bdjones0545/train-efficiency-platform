/**
 * Department OS v2 — Best Action Engine
 * Selects the single highest-priority action from a list of candidates.
 * Departments define candidates (condition + score); this picks the winner.
 */

import type { BestAction, ActionPriority } from "../department-executive";
import type { BestActionCandidate } from "./executive-types";
import { PRIORITY_ORDER } from "./executive-types";

// ─── Rank candidates and return winner ────────────────────────────────────────

export function rankBestActions(
  department: string,
  candidates: BestActionCandidate[],
): BestAction | null {
  const applicable = candidates.filter(c => c.condition);
  if (applicable.length === 0) return null;

  const best = applicable.reduce((winner, c) => {
    const wScore = winner.priorityScore * PRIORITY_ORDER[winner.action.priority as ActionPriority];
    const cScore = c.priorityScore     * PRIORITY_ORDER[c.action.priority as ActionPriority];
    return cScore > wScore ? c : winner;
  });

  return { department, ...best.action };
}

// ─── Candidate factory helper ──────────────────────────────────────────────────

export function candidate(
  condition: boolean,
  action: Omit<BestAction, "department">,
  priorityScore = 50,
): BestActionCandidate {
  return { condition, action, priorityScore };
}

// ─── Default fallback when pipeline is empty ──────────────────────────────────

export function defaultAction(
  department: string,
  route: string,
  entityLabel: string,
): BestAction {
  return {
    department,
    title:            `Add Your First ${entityLabel}s`,
    description:      `Start building the ${department.replace(/-/g, " ")} pipeline.`,
    priority:         "high",
    route,
    estimatedImpact:  `Enables all ${department.replace(/-/g, " ")} intelligence`,
  };
}

// ─── Priority label ────────────────────────────────────────────────────────────

export function priorityLabel(p: ActionPriority): string {
  return {
    critical: "Critical — action required now",
    high:     "High priority",
    medium:   "Medium priority",
    low:      "Low priority",
  }[p];
}
