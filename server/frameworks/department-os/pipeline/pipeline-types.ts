/**
 * Department OS v2 — Pipeline Types
 * Generic stage-based pipeline model shared across all departments.
 */

// ─── Stage definition ──────────────────────────────────────────────────────────

export interface PipelineStage {
  id:       string;
  name:     string;
  order:    number;
  terminal: boolean;
  color?:   string;
}

// ─── Pipeline definition ───────────────────────────────────────────────────────

export interface DepartmentPipeline {
  departmentId: string;
  stages:       PipelineStage[];
}

// ─── Pipeline record (a single item flowing through stages) ───────────────────

export interface PipelineRecord {
  id:         string;
  orgId:      string;
  department: string;
  stage:      string;
  score?:     number;
  createdAt:  Date;
  updatedAt?: Date;
  [key: string]: unknown;
}

// ─── Conversion entry ─────────────────────────────────────────────────────────

export interface StageConversion {
  fromStage:    string;
  toStage:      string;
  count:        number;
  conversionPct: number;
}

// ─── Stage snapshot ───────────────────────────────────────────────────────────

export interface StageCount {
  stage: string;
  count: number;
  pct:   number;
}

// ─── Pipeline metrics ─────────────────────────────────────────────────────────

export interface PipelineMetrics {
  departmentId:    string;
  total:           number;
  stageCounts:     Record<string, number>;
  stagePercents:   Record<string, number>;
  conversionRates: StageConversion[];
  terminalCounts:  { won: number; lost: number };
  overallWinRate:  number;
  averageScore:    number;
}

// ─── Stale record detection ───────────────────────────────────────────────────

export interface StaleCheck {
  stage:       string;
  count:       number;
  thresholdDays: number;
}
