/**
 * Shared Department Framework — Frontend + Backend
 * Reusable types for UI components consuming department data.
 * Import from here on the frontend; server code imports from
 * server/frameworks/department-os for the full interface set.
 */

// ─── Stage enum (mirrors server) ───────────────────────────────────────────────

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

// ─── Health check ──────────────────────────────────────────────────────────────

export type HealthSeverity = "critical" | "high" | "medium" | "low";

export interface DepartmentHealthCheck {
  id:             string;
  department:     string;
  severity:       HealthSeverity;
  passed:         boolean;
  title:          string;
  detail:         string;
  recommendation: string;
}

// ─── Best action ───────────────────────────────────────────────────────────────

export type ActionPriority = "critical" | "high" | "medium" | "low";

export interface BestAction {
  department:      string;
  title:           string;
  description:     string;
  priority:        ActionPriority;
  route:           string;
  estimatedImpact?: string;
}

// ─── Executive brief ───────────────────────────────────────────────────────────

export interface ExecutiveBrief {
  id?:                 string;
  department:          string;
  orgId:               string;
  summary:             string;
  bestActionToday:     string;
  keyWins:             string[];
  keyRisks:            string[];
  keyOpportunities:    string[];
  metrics:             Record<string, number | string>;
  generatedAt:         string;
}

// ─── Recommendation ────────────────────────────────────────────────────────────

export type RecommendationStatus = "pending" | "accepted" | "dismissed" | "implemented";

export interface DepartmentRecommendation {
  id?:             string;
  department:      string;
  orgId:           string;
  category:        string;
  recommendation:  string;
  reasoning:       string;
  confidenceScore: number;
  supportingData:  unknown;
  status:          RecommendationStatus;
  reviewedAt?:     string;
  createdAt:       string;
}

// ─── Department summary ────────────────────────────────────────────────────────

export interface DepartmentSummary {
  departmentId:     string;
  departmentName:   string;
  executiveSummary: string;
  checksRun:        number;
  checksPassed:     number;
  alertsCreated:    number;
  bestAction:       BestAction | null;
  metrics:          Record<string, number | string>;
  generatedAt:      string;
}

// ─── Learning types ────────────────────────────────────────────────────────────

export interface LearningSignal {
  department:  string;
  source:      string;
  category:    string;
  outcome:     string;
  score:       number;
  sampleSize:  number;
}

export interface LearningInsight {
  department:  string;
  category:    string;
  insight:     string;
  confidence:  number;
  impact:      "high" | "medium" | "low";
  actionable:  boolean;
}
