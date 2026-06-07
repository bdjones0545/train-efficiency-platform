/**
 * Department OS v2 — Dashboard Framework (Shared Frontend Types)
 * Reusable UI types for all department dashboards.
 * Future departments render their dashboards using this schema.
 */

// ─── Metric card ───────────────────────────────────────────────────────────────

export interface DepartmentMetric {
  key:       string;
  label:     string;
  value:     number | string;
  unit?:     "pct" | "count" | "score" | "currency" | "days";
  trend?:    "up" | "down" | "flat";
  color?:    "green" | "yellow" | "red" | "blue" | "purple" | "default";
  icon?:     string;
}

// ─── Alert item ────────────────────────────────────────────────────────────────

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export interface DepartmentAlert {
  id:             string;
  severity:       AlertSeverity;
  title:          string;
  detail:         string;
  recommendation: string;
  department:     string;
  passed:         boolean;
}

// ─── Summary card ──────────────────────────────────────────────────────────────

export interface DepartmentSummaryCard {
  departmentId:    string;
  departmentName:  string;
  status:          "healthy" | "warning" | "critical" | "empty";
  totalEntities:   number;
  activeEntities:  number;
  winsThisPeriod:  number;
  averageScore:    number;
  alertCount:      number;
  bestAction:      string | null;
  route:           string;
  lastUpdated?:    string;
}

// ─── Dashboard card ────────────────────────────────────────────────────────────

export interface DepartmentDashboardCard {
  id:          string;
  title:       string;
  description: string;
  metrics:     DepartmentMetric[];
  alerts:      DepartmentAlert[];
  summary:     DepartmentSummaryCard;
}

// ─── Tab config ────────────────────────────────────────────────────────────────

export interface DashboardTab {
  id:    string;
  label: string;
  icon?: string;
}

export const STANDARD_TABS: DashboardTab[] = [
  { id: "overview",    label: "Overview" },
  { id: "pipeline",    label: "Pipeline" },
  { id: "assessment",  label: "Assessment" },
  { id: "outreach",    label: "Outreach" },
  { id: "learning",    label: "Learning" },
  { id: "executive",   label: "Executive Intelligence" },
];

// ─── Pipeline stage card ───────────────────────────────────────────────────────

export interface PipelineStageCard {
  stage:  string;
  label:  string;
  count:  number;
  color?: string;
  items:  Array<{
    id:    string;
    title: string;
    score?: number;
    tags?: string[];
  }>;
}

// ─── Learning insight card ─────────────────────────────────────────────────────

export interface LearningInsightCard {
  category:   string;
  insight:    string;
  confidence: number;
  impact:     "high" | "medium" | "low";
  actionable: boolean;
}

// ─── Recommendation card ───────────────────────────────────────────────────────

export interface RecommendationCard {
  id:             string;
  category:       string;
  recommendation: string;
  reasoning:      string;
  confidence:     number;
  status:         "pending" | "accepted" | "dismissed" | "implemented";
}

// ─── Framework feature flags ───────────────────────────────────────────────────

export interface DepartmentFeatureFlags {
  hasDiscovery:     boolean;
  hasAssessment:    boolean;
  hasOutreach:      boolean;
  hasPipeline:      boolean;
  hasLearning:      boolean;
  hasExecutive:     boolean;
  hasCoordination:  boolean;
}
