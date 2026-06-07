/**
 * Department OS — Coordinator Contract
 * Every department coordinator must satisfy this interface so the
 * CEO Heartbeat can call it without department-specific knowledge.
 */

import type { BestAction } from "./department-executive";
import type { DepartmentHealthCheck } from "./department-health";

// ─── Heartbeat review result ───────────────────────────────────────────────────

export interface HeartbeatReviewResult {
  departmentId:   string;
  departmentName: string;
  checksRun:      number;
  checksPassed:   number;
  alertsCreated:  number;
  bestAction:     BestAction | null;
  executiveSummary: string;
  healthChecks:   DepartmentHealthCheck[];
  error?:         string;
}

// ─── Summary result ────────────────────────────────────────────────────────────

export interface DepartmentSummaryResult {
  departmentId:    string;
  departmentName:  string;
  executiveSummary: string;
  metrics:         Record<string, number | string>;
  bestAction:      BestAction | null;
  generatedAt:     string;
}

// ─── Core coordinator interface ────────────────────────────────────────────────

export interface DepartmentCoordinator {
  departmentId:   string;
  departmentName: string;

  runHeartbeatReview(orgId: string): Promise<HeartbeatReviewResult>;
  generateSummary(orgId: string):   Promise<DepartmentSummaryResult>;
  generateBestAction(orgId: string): Promise<BestAction | null>;
}

// ─── Abstract base class (optional convenience) ────────────────────────────────

export abstract class BaseDepartmentCoordinator implements DepartmentCoordinator {
  abstract departmentId:   string;
  abstract departmentName: string;

  abstract runHeartbeatReview(orgId: string): Promise<HeartbeatReviewResult>;
  abstract generateSummary(orgId: string):   Promise<DepartmentSummaryResult>;
  abstract generateBestAction(orgId: string): Promise<BestAction | null>;
}
