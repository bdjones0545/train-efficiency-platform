/**
 * Department OS — Executive Layer
 * Shared executive intelligence interfaces. Every department with an executive
 * stage produces an ExecutiveBrief and a set of Recommendations.
 * The CEO Heartbeat surfaces these uniformly without department-specific knowledge.
 */

// ─── Executive brief ───────────────────────────────────────────────────────────

export interface ExecutiveBrief {
  id?:           string;
  department:    string;
  orgId:         string;
  summary:       string;
  bestActionToday:    string;
  keyWins:       string[];
  keyRisks:      string[];
  keyOpportunities: string[];
  metrics:       Record<string, number | string>;
  generatedAt:   Date;
}

// ─── Recommendation ────────────────────────────────────────────────────────────

export type RecommendationStatus = "pending" | "accepted" | "dismissed" | "implemented";
export type RecommendationCategory =
  | "discovery"
  | "outreach"
  | "pipeline"
  | "execution"
  | "learning"
  | "general";

export interface DepartmentRecommendation {
  id?:              string;
  department:       string;
  orgId:            string;
  category:         RecommendationCategory;
  recommendation:   string;
  reasoning:        string;
  confidenceScore:  number;    // 0–100
  supportingData:   unknown;
  status:           RecommendationStatus;
  reviewedAt?:      Date;
  createdAt:        Date;
}

// ─── Best action ───────────────────────────────────────────────────────────────

export type ActionPriority = "critical" | "high" | "medium" | "low";

export interface BestAction {
  department:   string;
  title:        string;
  description:  string;
  priority:     ActionPriority;
  route:        string;
  estimatedImpact?: string;
}

// ─── Executive engine contract ─────────────────────────────────────────────────

export interface DepartmentExecutiveEngine {
  runExecutiveAnalysis(orgId: string): Promise<{
    briefGenerated:          boolean;
    recommendationsGenerated: number;
  }>;

  getBrief(orgId: string):            Promise<ExecutiveBrief | null>;
  getRecommendations(orgId: string):  Promise<DepartmentRecommendation[]>;
  getBestAction(orgId: string):       Promise<BestAction | null>;
}
