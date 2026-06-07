/**
 * Department OS — Core Types
 * Defines the fundamental contracts every TrainEfficiency department must satisfy.
 */

import type { DepartmentCoordinator } from "./department-coordinator";

// ─── Lifecycle stages (ordered) ────────────────────────────────────────────────

export enum DepartmentStage {
  DISCOVERY     = "discovery",
  QUALIFICATION = "qualification",
  OUTREACH      = "outreach",
  EXECUTION     = "execution",
  REPLIES       = "replies",
  OUTCOMES      = "outcomes",
  LEARNING      = "learning",
  EXECUTIVE     = "executive",
  COORDINATION  = "coordination",
}

// ─── Department definition ─────────────────────────────────────────────────────

export interface DepartmentDefinition {
  id: string;
  name: string;
  description: string;
  version: string;

  discoveryEnabled:      boolean;
  qualificationEnabled:  boolean;
  outreachEnabled:       boolean;
  executionEnabled:      boolean;
  learningEnabled:       boolean;
  executiveEnabled:      boolean;

  coordinator: DepartmentCoordinator;
}

// ─── Registered department (runtime) ──────────────────────────────────────────

export interface RegisteredDepartment extends DepartmentDefinition {
  enabled:         boolean;
  registeredAt:    Date;
  lastReviewedAt?: Date;
}

// ─── Department summary (returned from heartbeat review) ──────────────────────

export interface DepartmentSummary {
  departmentId:   string;
  departmentName: string;
  executiveSummary:      string;
  checksRun:             number;
  checksPassed:          number;
  alertsCreated:         number;
  bestAction:            import("./department-executive").BestAction | null;
  generatedAt:           string;
}
