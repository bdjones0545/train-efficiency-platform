/**
 * Department OS v2 — Learning Types
 * Generic signal / insight / metric types shared across all department
 * learning agents. Replaces HiringLearningMetrics, HiringLearningInsight,
 * and the equivalent Opportunity Learning types.
 */

// ─── Signal ───────────────────────────────────────────────────────────────────

export interface Signal {
  id?:        string;
  orgId:      string;
  department: string;
  entityId?:  string;
  source:     string;
  category:   string;
  score:      number;          // 0–100 quality/fit score
  contacted:  boolean;
  responded:  boolean;
  converted:  boolean;
  terminal:   boolean;         // reached a win or loss state
  won:        boolean;
  metadata?:  Record<string, string | number | boolean>;
  recordedAt: Date;
}

// ─── Insight ──────────────────────────────────────────────────────────────────

export interface Insight {
  id?:        string;
  department: string;
  orgId:      string;
  category:   string;
  insight:    string;
  confidence: number;          // 0–100
  impact:     "high" | "medium" | "low";
  actionable: boolean;
  source?:    string;          // what data drove this insight
}

// ─── Performance metric ────────────────────────────────────────────────────────

export interface PerformanceMetric {
  key:        string;
  label:      string;
  value:      number;
  unit:       "pct" | "count" | "score" | "days";
  trend?:     "up" | "down" | "flat";
  benchmark?: number;
}

// ─── Source performance ────────────────────────────────────────────────────────

export interface SourcePerformance {
  source:      string;
  count:       number;
  avgScore:    number;
  contactRate: number;
  replyRate:   number;
  winRate:     number;
}

// ─── Learning report ──────────────────────────────────────────────────────────

export interface LearningReport {
  departmentId:       string;
  orgId:              string;
  totalSignals:       number;
  totalEntities:      number;
  averageScore:       number;
  contactRate:        number;
  replyRate:          number;
  conversionRate:     number;
  winRate:            number;
  topSource:          string | null;
  topCategory:        string | null;
  sourcePerformance:  SourcePerformance[];
  insights:           Insight[];
  generatedAt:        string;
}
