/**
 * Department OS — Learning Layer
 * Shared learning contracts. Every department that has a learning stage
 * emits LearningSignals and receives LearningInsights through this interface.
 */

// ─── Learning signal ───────────────────────────────────────────────────────────

export interface LearningSignal {
  id?:        string;
  department: string;
  orgId:      string;
  source:     string;
  category:   string;
  outcome:    string;
  score:      number;          // 0.0 – 1.0
  sampleSize: number;
  metadata?:  Record<string, unknown>;
  recordedAt: Date;
}

// ─── Learning insight ──────────────────────────────────────────────────────────

export interface LearningInsight {
  id?:          string;
  department:   string;
  orgId:        string;
  category:     string;
  insight:      string;
  confidence:   number;        // 0.0 – 1.0
  impact:       "high" | "medium" | "low";
  actionable:   boolean;
  generatedAt:  Date;
}

// ─── Learning metrics ──────────────────────────────────────────────────────────

export interface LearningMetrics {
  departmentId:       string;
  totalSignals:       number;
  uniqueCategories:   number;
  averageScore:       number;
  topPerformingSource?: string;
  lastRunAt?:         Date;
  insightsGenerated:  number;
}

// ─── Learning engine contract ──────────────────────────────────────────────────

export interface DepartmentLearningEngine {
  runLearning(orgId: string): Promise<{
    signalsAnalyzed: number;
    insightsGenerated: number;
    metrics: LearningMetrics;
  }>;

  getInsights(orgId: string): Promise<LearningInsight[]>;
  getMetrics(orgId: string): Promise<LearningMetrics>;
}
