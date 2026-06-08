/**
 * Department Command Center Service — Executive Department OS
 * Queries every registered department dynamically.
 * No hardcoded departments — everything discovered from departmentRegistry.
 */

import { departmentRegistry } from "./department-registry";
import type { RegisteredDepartment } from "../frameworks/department-os/department-types";
import type { HeartbeatReviewResult, DepartmentSummaryResult } from "../frameworks/department-os/department-coordinator";
import type { BestAction, ActionPriority } from "../frameworks/department-os/executive-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DepartmentSnapshot {
  departmentId:    string;
  departmentName:  string;
  maturityLevel:   number;
  maturityLabel:   string;
  healthScore:     number;
  checksRun:       number;
  checksPassed:    number;
  checksFailed:    number;
  alertsCreated:   number;
  openAlerts:      number;
  bestAction:      BestAction | null;
  executiveSummary: string;
  healthChecks:    any[];
  metrics:         Record<string, any>;
  capabilities:    string[];
  status:          "healthy" | "warning" | "critical";
  error?:          string;
}

export interface OrganizationHealthSummary {
  score:        number;
  label:        string;
  color:        string;
  totalDepts:   number;
  healthyDepts: number;
  warningDepts: number;
  criticalDepts: number;
  totalAlerts:  number;
  criticalAlerts: number;
  highAlerts:   number;
}

export interface DepartmentCommandCenter {
  departments:          DepartmentSnapshot[];
  organizationHealth:   OrganizationHealthSummary;
  organizationBestAction: BestAction | null;
  allBestActions:       Array<BestAction & { departmentName: string }>;
  allAlerts:            any[];
  generatedAt:          string;
}

// ─── Maturity level helpers ───────────────────────────────────────────────────

function computeMaturity(dept: RegisteredDepartment): { level: number; label: string } {
  let pts = 1;
  if (dept.discoveryEnabled)  pts++;
  if (dept.outreachEnabled)   pts++;
  if (dept.executionEnabled)  pts++;
  if (dept.learningEnabled)   pts++;
  if (dept.executiveEnabled)  pts++;
  const level = Math.min(5, Math.ceil(pts / 1.2));
  const labels = ["", "Foundation", "Intelligence", "Operations", "Autonomy", "Self-Optimizing"];
  return { level, label: labels[Math.min(5, level)] };
}

function capabilitiesFromDept(dept: RegisteredDepartment): string[] {
  const caps: string[] = [];
  if (dept.discoveryEnabled)  caps.push("Discovery");
  if (dept.outreachEnabled)   caps.push("Outreach");
  if (dept.executionEnabled)  caps.push("Execution");
  if (dept.learningEnabled)   caps.push("Learning");
  if (dept.executiveEnabled)  caps.push("Executive Intelligence");
  return caps;
}

// ─── Health score from checks ─────────────────────────────────────────────────

function healthScoreFromReview(review: HeartbeatReviewResult): number {
  if (review.checksRun === 0) return 100;
  const failedChecks = review.healthChecks ?? [];
  let penalty = 0;
  for (const check of failedChecks) {
    if (check.passed) continue;
    const sev = check.severity ?? "low";
    if (sev === "high")   penalty += 25;
    else if (sev === "medium") penalty += 12;
    else                  penalty += 5;
  }
  return Math.max(0, 100 - penalty);
}

function statusFromScore(score: number): "healthy" | "warning" | "critical" {
  if (score >= 80) return "healthy";
  if (score >= 60) return "warning";
  return "critical";
}

// ─── Organization health score ────────────────────────────────────────────────

function calculateOrganizationHealth(snapshots: DepartmentSnapshot[]): OrganizationHealthSummary {
  const total     = snapshots.length;
  const healthy   = snapshots.filter(d => d.status === "healthy").length;
  const warning   = snapshots.filter(d => d.status === "warning").length;
  const critical  = snapshots.filter(d => d.status === "critical").length;
  const totalAlerts  = snapshots.reduce((s, d) => s + d.alertsCreated, 0);

  const allChecks    = snapshots.flatMap(d => d.healthChecks ?? []);
  const critAlerts   = allChecks.filter(c => !c.passed && c.severity === "high").length;
  const highAlerts   = allChecks.filter(c => !c.passed && c.severity === "medium").length;

  let score = 100;
  if (total === 0) return { score: 100, label: "No Departments", color: "gray", totalDepts: 0, healthyDepts: 0, warningDepts: 0, criticalDepts: 0, totalAlerts: 0, criticalAlerts: 0, highAlerts: 0 };

  score -= (critical * 20);
  score -= (warning  * 8);
  score -= (critAlerts * 5);
  score -= (highAlerts * 2);
  score = Math.max(0, Math.min(100, Math.round(score)));

  let label = "Excellent";
  let color = "green";
  if (score < 95) { label = "Healthy";          color = "blue"; }
  if (score < 80) { label = "Needs Attention";   color = "yellow"; }
  if (score < 60) { label = "At Risk";           color = "red"; }

  return { score, label, color, totalDepts: total, healthyDepts: healthy, warningDepts: warning, criticalDepts: critical, totalAlerts, criticalAlerts: critAlerts, highAlerts };
}

// ─── Rank organization best action ───────────────────────────────────────────

const PRIORITY_ORDER: Record<ActionPriority, number> = {
  critical: 4,
  high:     3,
  medium:   2,
  low:      1,
};

function rankOrganizationActions(snapshots: DepartmentSnapshot[]): {
  best: BestAction | null;
  all:  Array<BestAction & { departmentName: string }>;
} {
  const all: Array<BestAction & { departmentName: string }> = [];

  for (const snap of snapshots) {
    if (snap.bestAction) {
      all.push({ ...snap.bestAction, departmentName: snap.departmentName });
    }
  }

  all.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 0;
    const pb = PRIORITY_ORDER[b.priority] ?? 0;
    return pb - pa;
  });

  return { best: all[0] ?? null, all };
}

// ─── Unified alert feed ───────────────────────────────────────────────────────

function buildUnifiedAlerts(snapshots: DepartmentSnapshot[]): any[] {
  const alerts: any[] = [];
  for (const snap of snapshots) {
    for (const check of snap.healthChecks ?? []) {
      if (!check.passed) {
        alerts.push({
          departmentId:   snap.departmentId,
          departmentName: snap.departmentName,
          severity:       check.severity ?? "low",
          title:          check.title ?? "Health Check Failed",
          detail:         check.detail ?? "",
          recommendation: check.recommendation ?? "",
          checkedAt:      check.checkedAt,
        });
      }
    }
  }
  // Sort: high → medium → low
  const sevOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
  alerts.sort((a, b) => (sevOrder[b.severity] ?? 0) - (sevOrder[a.severity] ?? 0));
  return alerts;
}

// ─── Main generator ───────────────────────────────────────────────────────────

export async function generateDepartmentCommandCenter(orgId: string): Promise<DepartmentCommandCenter> {
  const enabled = departmentRegistry.getEnabledDepartments();

  const snapshots = await Promise.all(
    enabled.map(async ({ department, coordinator }) => {
      try {
        const { level, label } = computeMaturity(department);
        const capabilities     = capabilitiesFromDept(department);

        const [review, summary, bestAction] = await Promise.all([
          coordinator.runHeartbeatReview(orgId).catch(err => ({
            departmentId:    department.id,
            departmentName:  department.name,
            checksRun:       0,
            checksPassed:    0,
            alertsCreated:   0,
            bestAction:      null,
            executiveSummary: `Review failed: ${err.message}`,
            healthChecks:    [],
            error:           err.message,
          } as HeartbeatReviewResult)),
          coordinator.generateSummary(orgId).catch(() => ({
            departmentId:    department.id,
            departmentName:  department.name,
            executiveSummary: "Summary unavailable",
            metrics:         {},
            bestAction:      null,
            generatedAt:     new Date().toISOString(),
          } as DepartmentSummaryResult)),
          coordinator.generateBestAction(orgId).catch(() => null),
        ]);

        const healthScore = healthScoreFromReview(review);

        const snap: DepartmentSnapshot = {
          departmentId:    department.id,
          departmentName:  department.name,
          maturityLevel:   level,
          maturityLabel:   label,
          healthScore,
          checksRun:       review.checksRun,
          checksPassed:    review.checksPassed,
          checksFailed:    review.checksRun - review.checksPassed,
          alertsCreated:   review.alertsCreated,
          openAlerts:      (review.healthChecks ?? []).filter(c => !c.passed).length,
          bestAction:      bestAction ?? review.bestAction,
          executiveSummary: summary.executiveSummary ?? review.executiveSummary,
          healthChecks:    review.healthChecks ?? [],
          metrics:         summary.metrics ?? {},
          capabilities,
          status:          statusFromScore(healthScore),
          error:           review.error,
        };
        return snap;
      } catch (err: any) {
        const { level, label } = computeMaturity(department);
        return {
          departmentId:    department.id,
          departmentName:  department.name,
          maturityLevel:   level,
          maturityLabel:   label,
          healthScore:     0,
          checksRun:       0,
          checksPassed:    0,
          checksFailed:    0,
          alertsCreated:   0,
          openAlerts:      0,
          bestAction:      null,
          executiveSummary: `Error: ${err.message}`,
          healthChecks:    [],
          metrics:         {},
          capabilities:    capabilitiesFromDept(department),
          status:          "critical" as const,
          error:           err.message,
        } satisfies DepartmentSnapshot;
      }
    }),
  );

  const organizationHealth      = calculateOrganizationHealth(snapshots);
  const { best, all }           = rankOrganizationActions(snapshots);
  const allAlerts               = buildUnifiedAlerts(snapshots);

  return {
    departments:           snapshots,
    organizationHealth,
    organizationBestAction: best,
    allBestActions:        all,
    allAlerts,
    generatedAt:           new Date().toISOString(),
  };
}

// ─── CEO Heartbeat helper (non-breaking, future use) ─────────────────────────

export async function generateOrganizationDepartmentSummary(orgId: string): Promise<{
  organizationHealth: OrganizationHealthSummary;
  topRisks:           string[];
  topOpportunities:   string[];
  highestPriorityAction: BestAction | null;
}> {
  const center = await generateDepartmentCommandCenter(orgId);
  const topRisks = center.allAlerts
    .filter(a => ["high", "medium"].includes(a.severity))
    .slice(0, 3)
    .map(a => `[${a.departmentName}] ${a.title}`);
  const topOpps  = center.allBestActions
    .slice(0, 3)
    .map(a => `[${a.departmentName}] ${a.title}`);
  return {
    organizationHealth:    center.organizationHealth,
    topRisks,
    topOpportunities:      topOpps,
    highestPriorityAction: center.organizationBestAction,
  };
}
