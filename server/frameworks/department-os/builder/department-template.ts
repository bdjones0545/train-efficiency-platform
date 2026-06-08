/**
 * Department OS v2 — Department Template
 * Defines what every department is made of and how mature it is.
 * Used by the Department Factory dashboard and scaffold generator.
 */

import type { RegisteredDepartment } from "../department-types";

// ─── Maturity levels ───────────────────────────────────────────────────────────

export type MaturityLevelNumber = 1 | 2 | 3 | 4 | 5;

export interface MaturityLevelDefinition {
  level:        MaturityLevelNumber;
  name:         string;
  description:  string;
  required:     string[];
  optional:     string[];
  badge:        string;   // short label for UI badges
}

export const MATURITY_LEVELS: MaturityLevelDefinition[] = [
  {
    level:       1,
    name:        "Foundation",
    description: "Core department infrastructure — assessment, coordinator, and CEO Heartbeat integration.",
    required:    ["Assessment Agent", "DepartmentCoordinator", "Health Checks", "CEO Heartbeat Integration"],
    optional:    [],
    badge:       "L1 Foundation",
  },
  {
    level:       2,
    name:        "Intelligence",
    description: "Learning and executive layers — the department understands its own performance and surfaces insights.",
    required:    ["Learning Agent", "Executive Agent", "Executive Brief", "Recommendations"],
    optional:    ["Learning Signals Table"],
    badge:       "L2 Intelligence",
  },
  {
    level:       3,
    name:        "Operations",
    description: "Full outreach and execution pipeline — the department can take actions on entities.",
    required:    ["Outreach Agent", "Route Endpoints (14+)", "Admin UI (6+ tabs)", "Pipeline Tables"],
    optional:    ["Reply Intelligence", "Deal Tracking"],
    badge:       "L3 Operations",
  },
  {
    level:       4,
    name:        "Autonomy",
    description: "Autonomous recommendations — the department proposes and queues actions without manual triggering.",
    required:    ["Autonomy Policy Integration", "Action Queue", "Confidence Scoring"],
    optional:    ["Approval Inbox", "Auto-Execute on High Confidence"],
    badge:       "L4 Autonomy",
  },
  {
    level:       5,
    name:        "Self-Optimization",
    description: "The department learns from every outcome and updates its own rules without human intervention.",
    required:    ["Feedback Loop", "Rule Evolution Engine", "Outcome Attribution"],
    optional:    ["A/B Outreach Testing", "Adaptive Scoring"],
    badge:       "L5 Self-Optimizing",
  },
];

// ─── Maturity computation ─────────────────────────────────────────────────────

export function computeMaturityLevel(dept: RegisteredDepartment): MaturityLevelNumber {
  const { learningEnabled, executiveEnabled, outreachEnabled, executionEnabled } = dept;
  if (outreachEnabled && executionEnabled && learningEnabled && executiveEnabled) return 3;
  if (learningEnabled && executiveEnabled) return 2;
  return 1;
}

export function getMaturityDefinition(level: MaturityLevelNumber): MaturityLevelDefinition {
  return MATURITY_LEVELS.find(m => m.level === level) ?? MATURITY_LEVELS[0];
}

// ─── Department template shape ─────────────────────────────────────────────────
// This is the contract every department must satisfy.
// The scaffold generator uses this to produce boilerplate.

export interface DepartmentComponentSpec {
  name:        string;
  filename:    string;
  required:    boolean;
  description: string;
  maturityMin: MaturityLevelNumber;
}

export const DEPARTMENT_COMPONENTS: DepartmentComponentSpec[] = [
  {
    name:        "Assessment Agent",
    filename:    "{name}-assessment-agent.ts",
    required:    true,
    description: "Scores and qualifies entities using scoreKeywords() + compositeScore()",
    maturityMin: 1,
  },
  {
    name:        "Department Coordinator",
    filename:    "{name}-department-coordinator.ts",
    required:    true,
    description: "Implements DepartmentCoordinator — runHeartbeatReview, generateSummary, generateBestAction",
    maturityMin: 1,
  },
  {
    name:        "Learning Agent",
    filename:    "{name}-learning-agent.ts",
    required:    true,
    description: "Maps domain signals → Signal type → buildLearningReport + generateStandardInsights",
    maturityMin: 2,
  },
  {
    name:        "Executive Agent",
    filename:    "{name}-executive-agent.ts",
    required:    true,
    description: "Generates BestAction, ExecutiveBrief, and DepartmentRecommendations",
    maturityMin: 2,
  },
  {
    name:        "Outreach Agent",
    filename:    "{name}-outreach-agent.ts",
    required:    false,
    description: "Generates outreach drafts via OpenAI for qualified entities",
    maturityMin: 3,
  },
  {
    name:        "Routes",
    filename:    "{name}-routes.ts",
    required:    true,
    description: "14+ REST endpoints + table creation + coordinator registration",
    maturityMin: 1,
  },
  {
    name:        "Admin UI Page",
    filename:    "admin-{name}.tsx",
    required:    true,
    description: "6-tab React page: Pipeline / Outreach / Assessment / Learning / Executive / Health",
    maturityMin: 1,
  },
];

export const DepartmentTemplate = {
  components:    DEPARTMENT_COMPONENTS,
  maturityLevels: MATURITY_LEVELS,
  computeMaturityLevel,
  getMaturityDefinition,
};
