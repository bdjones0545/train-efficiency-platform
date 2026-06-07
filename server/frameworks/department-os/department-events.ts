/**
 * Department OS — Event System
 * Generic department event contract. Each department emits DepartmentEvents
 * so the platform can consume them without department-specific knowledge.
 */

import { DepartmentStage } from "./department-types";

// ─── Event severity ────────────────────────────────────────────────────────────

export type EventSeverity = "critical" | "high" | "medium" | "low" | "info";

// ─── Core event interface ──────────────────────────────────────────────────────

export interface DepartmentEvent {
  id?:         string;
  department:  string;
  orgId:       string;
  stage?:      DepartmentStage;
  eventType:   string;
  severity:    EventSeverity;
  title:       string;
  description: string;
  entityId?:   string;
  entityType?: string;
  metadata?:   Record<string, unknown>;
  createdAt:   Date;
}

// ─── Event factory ─────────────────────────────────────────────────────────────

export function createDepartmentEvent(opts: Omit<DepartmentEvent, "createdAt">): DepartmentEvent {
  return { ...opts, createdAt: new Date() };
}

// ─── Standard event types (shared vocabulary across departments) ───────────────

export const DEPT_EVENT_TYPES = {
  REVIEW_STARTED:      "review_started",
  REVIEW_COMPLETED:    "review_completed",
  HEALTH_CHECK_FAILED: "health_check_failed",
  ATTENTION_CREATED:   "attention_created",
  BEST_ACTION:         "best_action_generated",
  SUMMARY_GENERATED:   "summary_generated",
  CYCLE_STARTED:       "cycle_started",
  CYCLE_COMPLETED:     "cycle_completed",
  LEARNING_RUN:        "learning_run",
  EXECUTIVE_RUN:       "executive_run",
  ERROR:               "error",
} as const;

export type DeptEventType = typeof DEPT_EVENT_TYPES[keyof typeof DEPT_EVENT_TYPES];
