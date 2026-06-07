/**
 * Department OS v2 — Pipeline Health
 * Reusable health check rules that apply to any stage-based pipeline.
 * Departments configure thresholds; the engine runs the checks.
 */

import type { DepartmentHealthCheck } from "../department-health";

// ─── Stale record check ────────────────────────────────────────────────────────

/**
 * Creates a health check for records stalled in a stage past the threshold.
 */
export function staleStageCheck(opts: {
  department:     string;
  stage:          string;
  stageLabel:     string;
  count:          number;
  thresholdDays:  number;
}): DepartmentHealthCheck {
  const { department, stage, stageLabel, count, thresholdDays } = opts;
  const passed = count === 0;
  return {
    id:          `${department}-stale-${stage}`,
    department,
    severity:    count > 2 ? "high" : "medium",
    passed,
    title:       `Stale ${stageLabel} Records`,
    detail:      passed
      ? `No stale ${stageLabel.toLowerCase()} records.`
      : `${count} record${count > 1 ? "s" : ""} in "${stageLabel}" for ${thresholdDays}+ days with no update.`,
    recommendation: passed
      ? `${stageLabel} stage is current.`
      : `Follow up on stalled ${stageLabel.toLowerCase()} records or move them to the next stage.`,
    checkedAt: new Date(),
  };
}

// ─── Volume check ──────────────────────────────────────────────────────────────

export function pipelineVolumeCheck(opts: {
  department:    string;
  total:         number;
  minimumTarget: number;
  entityLabel:   string;
}): DepartmentHealthCheck {
  const { department, total, minimumTarget, entityLabel } = opts;
  const passed = total >= minimumTarget;
  return {
    id:          `${department}-pipeline-volume`,
    department,
    severity:    total === 0 ? "high" : "medium",
    passed,
    title:       `${entityLabel} Pipeline Volume`,
    detail:      `${total} ${entityLabel.toLowerCase()}${total !== 1 ? "s" : ""} in pipeline.`,
    recommendation: passed
      ? `Pipeline volume is healthy.`
      : `Add more ${entityLabel.toLowerCase()}s to maintain a healthy funnel (target: ${minimumTarget}+).`,
    checkedAt: new Date(),
  };
}

// ─── Terminal backlog check ────────────────────────────────────────────────────

export function terminalBacklogCheck(opts: {
  department:  string;
  stage:       string;
  stageLabel:  string;
  count:       number;
  maxAllowed:  number;
  urgencyDays: number;
}): DepartmentHealthCheck {
  const { department, stage, stageLabel, count, maxAllowed, urgencyDays } = opts;
  const passed = count <= maxAllowed;
  return {
    id:          `${department}-terminal-backlog-${stage}`,
    department,
    severity:    count > maxAllowed * 2 ? "critical" : count > 0 ? "high" : "low",
    passed,
    title:       `${stageLabel} Awaiting Decision`,
    detail:      count > 0
      ? `${count} record${count > 1 ? "s" : ""} in ${stageLabel} for ${urgencyDays}+ days.`
      : `No ${stageLabel.toLowerCase()} records backlogged.`,
    recommendation: passed
      ? `No ${stageLabel.toLowerCase()} backlogs.`
      : `Review and advance or close ${stageLabel.toLowerCase()} records immediately.`,
    checkedAt: new Date(),
  };
}

// ─── Zero activity check ───────────────────────────────────────────────────────

export function noWinsCheck(opts: {
  department: string;
  winsCount:  number;
  totalCount: number;
  entityLabel: string;
}): DepartmentHealthCheck {
  const { department, winsCount, totalCount, entityLabel } = opts;
  const hasEnoughData = totalCount >= 5;
  const passed = winsCount > 0 || !hasEnoughData;
  return {
    id:          `${department}-no-wins`,
    department,
    severity:    "medium",
    passed,
    title:       `No ${entityLabel} Outcomes`,
    detail:      `${winsCount} ${entityLabel.toLowerCase()} outcome${winsCount !== 1 ? "s" : ""} recorded. ${totalCount} total in pipeline.`,
    recommendation: passed
      ? `${entityLabel} outcomes are being recorded.`
      : `Pipeline is active but no ${entityLabel.toLowerCase()} outcomes recorded. Review the final stages.`,
    checkedAt: new Date(),
  };
}
