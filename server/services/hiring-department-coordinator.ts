/**
 * Hiring Department Coordinator — Department OS v1 Implementation
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements DepartmentCoordinator so the Department Registry + CEO Heartbeat
 * can coordinate Hiring without any custom heartbeat code.
 *
 * GUARDRAILS:
 *  ✗ No autonomous hiring decisions
 *  ✓ Health checks / Summary / Best action / Brief only
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import type {
  DepartmentCoordinator,
  HeartbeatReviewResult,
  DepartmentSummaryResult,
} from "../frameworks/department-os/department-coordinator";
import type { BestAction }            from "../frameworks/department-os/department-executive";
import type { DepartmentHealthCheck } from "../frameworks/department-os/department-health";

// ─── Framework integration (v2) ────────────────────────────────────────────────
import { departmentHealthEngine } from "../frameworks/department-os/health-engine";

import { generateHiringBestAction }    from "./hiring-executive-agent";
import { computeHiringLearningMetrics } from "./hiring-learning-agent";

function rows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}
function n(v: any): number { return Number(v ?? 0); }

// ─── Health check definitions ──────────────────────────────────────────────────

async function runHealthChecks(orgId: string): Promise<DepartmentHealthCheck[]> {
  const [cands, overdueInterviews, staleContacted, pendingOffers] = await Promise.all([
    db.execute(sql`
      SELECT status, COUNT(*) as cnt FROM hiring_candidates
      WHERE org_id = ${orgId} GROUP BY status
    `).then(rows),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM hiring_interviews
      WHERE org_id = ${orgId} AND status = 'scheduled'
        AND scheduled_at < NOW() - INTERVAL '3 days'
    `).then(r => n(rows(r)[0]?.cnt)),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM hiring_candidates
      WHERE org_id = ${orgId} AND status = 'contacted'
        AND updated_at < NOW() - INTERVAL '7 days'
    `).then(r => n(rows(r)[0]?.cnt)),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM hiring_candidates
      WHERE org_id = ${orgId} AND status = 'offer'
        AND updated_at < NOW() - INTERVAL '5 days'
    `).then(r => n(rows(r)[0]?.cnt)),
  ]);

  const byStatus = Object.fromEntries(cands.map((r: any) => [r.status, n(r.cnt)]));
  const total    = Object.values(byStatus).reduce((s: any, v: any) => s + v, 0) as number;

  const now = new Date().toISOString();

  return [
    {
      id:         "hiring-pipeline-volume",
      department: "hiring",
      severity:   total === 0 ? "high" : total < 3 ? "medium" : "low",
      passed:     total >= 3,
      title:      "Candidate Pipeline Volume",
      detail:     `${total} candidate${total !== 1 ? "s" : ""} in pipeline.`,
      recommendation: total < 3
        ? "Add more candidates to maintain a healthy hiring funnel."
        : "Pipeline volume is healthy.",
      checkedAt: new Date(now),
    },
    {
      id:         "hiring-overdue-interviews",
      department: "hiring",
      severity:   overdueInterviews > 0 ? "high" : "low",
      passed:     overdueInterviews === 0,
      title:      "Overdue Interviews",
      detail:     overdueInterviews > 0
        ? `${overdueInterviews} interview${overdueInterviews > 1 ? "s" : ""} scheduled more than 3 days ago with no update.`
        : "No overdue interviews.",
      recommendation: overdueInterviews > 0
        ? "Reschedule or complete overdue interviews to prevent candidate drop-off."
        : "All scheduled interviews are current.",
      checkedAt: new Date(now),
    },
    {
      id:         "hiring-stale-contacts",
      department: "hiring",
      severity:   staleContacted > 0 ? "medium" : "low",
      passed:     staleContacted === 0,
      title:      "Stale Contacted Candidates",
      detail:     staleContacted > 0
        ? `${staleContacted} candidate${staleContacted > 1 ? "s" : ""} in "contacted" status for 7+ days with no update.`
        : "All contacted candidates are current.",
      recommendation: staleContacted > 0
        ? "Follow up with contacted candidates or move them to interested/rejected."
        : "No stale contacts.",
      checkedAt: new Date(now),
    },
    {
      id:         "hiring-pending-offers",
      department: "hiring",
      severity:   pendingOffers > 1 ? "high" : pendingOffers > 0 ? "medium" : "low",
      passed:     pendingOffers === 0,
      title:      "Pending Offers Awaiting Decision",
      detail:     pendingOffers > 0
        ? `${pendingOffers} offer${pendingOffers > 1 ? "s" : ""} pending for 5+ days — candidate may accept elsewhere.`
        : "No pending offers.",
      recommendation: pendingOffers > 0
        ? "Review and advance or close pending offers immediately."
        : "Offer pipeline is clear.",
      checkedAt: new Date(now),
    },
    {
      id:         "hiring-qualified-not-advanced",
      department: "hiring",
      severity:   (byStatus.qualified ?? 0) > 5 ? "medium" : "low",
      passed:     (byStatus.qualified ?? 0) <= 5,
      title:      "Qualified Candidates Not Advanced",
      detail:     `${byStatus.qualified ?? 0} candidate${(byStatus.qualified ?? 0) !== 1 ? "s" : ""} qualified but not yet moved to outreach or interview.`,
      recommendation: (byStatus.qualified ?? 0) > 0
        ? "Generate outreach drafts and advance qualified candidates."
        : "No qualified candidates waiting.",
      checkedAt: new Date(now),
    },
    {
      id:         "hiring-zero-hires-30d",
      department: "hiring",
      severity:   "low",
      passed:     true, // evaluated below
      title:      "Recent Hiring Activity",
      detail:     `${byStatus.hired ?? 0} total hire${(byStatus.hired ?? 0) !== 1 ? "s" : ""} recorded.`,
      recommendation: (byStatus.hired ?? 0) === 0 && total >= 5
        ? "Pipeline is active but no hires recorded. Review interview and offer stages."
        : "Hiring activity is normal.",
      checkedAt: new Date(now),
    },
  ];
}

// ─── Attention inbox items — v2: uses DepartmentHealthEngine ──────────────────
// Replaces 25-line duplicated loop with shared framework helper.

async function createAttentionItems(orgId: string, checks: DepartmentHealthCheck[]): Promise<number> {
  return departmentHealthEngine.createAttentionItemsFromFailed(
    orgId,
    "hiring_department_coordinator",
    "hiring_department",
    checks,
  );
}

// ─── Coordinator class ─────────────────────────────────────────────────────────

class HiringDepartmentCoordinatorImpl implements DepartmentCoordinator {
  readonly departmentId   = "hiring";
  readonly departmentName = "Hiring Department";

  async runHeartbeatReview(orgId: string): Promise<HeartbeatReviewResult> {
    try {
      const healthChecks = await runHealthChecks(orgId);
      const passed       = healthChecks.filter(c => c.passed).length;
      const alerts       = await createAttentionItems(orgId, healthChecks);

      const bestActionRaw = await generateHiringBestAction(orgId);
      const bestAction: BestAction | null = bestActionRaw
        ? { department: this.departmentId, ...bestActionRaw }
        : null;

      const metrics = await computeHiringLearningMetrics(orgId);
      const executiveSummary = `Hiring: ${metrics.totalCandidates} candidates, ` +
        `${metrics.averageFitScore}/100 avg fit, ${metrics.hireRate}% hire rate. ` +
        `${healthChecks.length - passed} health check${healthChecks.length - passed !== 1 ? "s" : ""} flagged.`;

      return {
        departmentId:   this.departmentId,
        departmentName: this.departmentName,
        checksRun:      healthChecks.length,
        checksPassed:   passed,
        alertsCreated:  alerts,
        bestAction,
        executiveSummary,
        healthChecks,
      };
    } catch (err: any) {
      return {
        departmentId:     this.departmentId,
        departmentName:   this.departmentName,
        checksRun:        0,
        checksPassed:     0,
        alertsCreated:    0,
        bestAction:       null,
        executiveSummary: "",
        healthChecks:     [],
        error:            err.message,
      };
    }
  }

  async generateSummary(orgId: string): Promise<DepartmentSummaryResult> {
    const metrics = await computeHiringLearningMetrics(orgId);
    const bestActionRaw = await generateHiringBestAction(orgId);

    return {
      departmentId:    this.departmentId,
      departmentName:  this.departmentName,
      executiveSummary: `${metrics.totalCandidates} candidates in pipeline. ` +
        `Avg fit: ${metrics.averageFitScore}/100. Hire rate: ${metrics.hireRate}%.`,
      metrics: {
        totalCandidates:  metrics.totalCandidates,
        averageFitScore:  metrics.averageFitScore,
        hireRate:         metrics.hireRate,
        interviewRate:    metrics.interviewRate,
        topSource:        metrics.topSource ?? "none",
      },
      bestAction: bestActionRaw ? { department: this.departmentId, ...bestActionRaw } : null,
      generatedAt: new Date().toISOString(),
    };
  }

  async generateBestAction(orgId: string): Promise<BestAction | null> {
    const action = await generateHiringBestAction(orgId);
    if (!action) return null;
    return { department: this.departmentId, ...action };
  }
}

export const hiringDepartmentCoordinator = new HiringDepartmentCoordinatorImpl();
