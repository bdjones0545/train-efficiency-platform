/**
 * Department OS — Lifecycle
 * Reusable lifecycle stage definitions, transitions, and helpers.
 */

import { DepartmentStage } from "./department-types";

// ─── Stage metadata ────────────────────────────────────────────────────────────

export interface StageDefinition {
  stage:       DepartmentStage;
  label:       string;
  description: string;
  order:       number;
  terminal:    boolean;
}

export const STAGE_DEFINITIONS: Record<DepartmentStage, StageDefinition> = {
  [DepartmentStage.DISCOVERY]: {
    stage: DepartmentStage.DISCOVERY, label: "Discovery",
    description: "Find and surface new candidates or prospects.",
    order: 1, terminal: false,
  },
  [DepartmentStage.QUALIFICATION]: {
    stage: DepartmentStage.QUALIFICATION, label: "Qualification",
    description: "Evaluate and score candidates for fit and priority.",
    order: 2, terminal: false,
  },
  [DepartmentStage.OUTREACH]: {
    stage: DepartmentStage.OUTREACH, label: "Outreach",
    description: "Craft and manage first-touch communication.",
    order: 3, terminal: false,
  },
  [DepartmentStage.EXECUTION]: {
    stage: DepartmentStage.EXECUTION, label: "Execution",
    description: "Send outreach and track delivery.",
    order: 4, terminal: false,
  },
  [DepartmentStage.REPLIES]: {
    stage: DepartmentStage.REPLIES, label: "Replies",
    description: "Classify and process inbound responses.",
    order: 5, terminal: false,
  },
  [DepartmentStage.OUTCOMES]: {
    stage: DepartmentStage.OUTCOMES, label: "Outcomes",
    description: "Record wins, losses, and terminal results.",
    order: 6, terminal: true,
  },
  [DepartmentStage.LEARNING]: {
    stage: DepartmentStage.LEARNING, label: "Learning",
    description: "Synthesize performance data into actionable insights.",
    order: 7, terminal: false,
  },
  [DepartmentStage.EXECUTIVE]: {
    stage: DepartmentStage.EXECUTIVE, label: "Executive Intelligence",
    description: "Generate executive briefs and strategic recommendations.",
    order: 8, terminal: false,
  },
  [DepartmentStage.COORDINATION]: {
    stage: DepartmentStage.COORDINATION, label: "Coordination",
    description: "CEO Heartbeat integration and cross-system orchestration.",
    order: 9, terminal: false,
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function getStageOrder(stage: DepartmentStage): number {
  return STAGE_DEFINITIONS[stage]?.order ?? 99;
}

export function isTerminalStage(stage: DepartmentStage): boolean {
  return STAGE_DEFINITIONS[stage]?.terminal ?? false;
}

export function getActiveStages(opts: {
  discoveryEnabled:     boolean;
  qualificationEnabled: boolean;
  outreachEnabled:      boolean;
  executionEnabled:     boolean;
  learningEnabled:      boolean;
  executiveEnabled:     boolean;
}): DepartmentStage[] {
  const stages: DepartmentStage[] = [];
  if (opts.discoveryEnabled)     stages.push(DepartmentStage.DISCOVERY);
  if (opts.qualificationEnabled) stages.push(DepartmentStage.QUALIFICATION);
  if (opts.outreachEnabled)      stages.push(DepartmentStage.OUTREACH);
  if (opts.executionEnabled)     stages.push(DepartmentStage.EXECUTION);
  stages.push(DepartmentStage.REPLIES, DepartmentStage.OUTCOMES);
  if (opts.learningEnabled)      stages.push(DepartmentStage.LEARNING);
  if (opts.executiveEnabled)     stages.push(DepartmentStage.EXECUTIVE);
  stages.push(DepartmentStage.COORDINATION);
  return stages;
}
