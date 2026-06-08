/**
 * Partnership Department Coordinator — Department OS v2
 * Implements DepartmentCoordinator; registered with departmentRegistry.
 * Plugs automatically into CEO Heartbeat, Attention Inbox, and Best Action Today.
 *
 * GUARDRAILS:
 *  ✗ No autonomous partnership decisions
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
import { departmentHealthEngine }     from "../frameworks/department-os/health-engine";

import { generatePartnershipsBestAction } from "./partnership-executive-agent";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }
function n(v: any): number   { return Number(v ?? 0); }

// ─── Health check queries ─────────────────────────────────────────────────────

async function runHealthChecks(orgId: string): Promise<DepartmentHealthCheck[]> {
  const now = new Date();

  const [staleQualified, meetingFollowup, proposals, noNew] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM partnership_opportunities
      WHERE org_id = ${orgId} AND status = 'qualified'
        AND created_at < NOW() - INTERVAL '14 days'
    `).then(rows),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM partnership_opportunities
      WHERE org_id = ${orgId} AND status = 'meeting'
        AND updated_at < NOW() - INTERVAL '7 days'
    `).then(rows),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM partnership_opportunities
      WHERE org_id = ${orgId} AND status = 'negotiation'
        AND updated_at < NOW() - INTERVAL '14 days'
    `).then(rows),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM partnership_opportunities
      WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '30 days'
    `).then(rows),
  ]);

  const staleQualCnt  = n(staleQualified[0]?.cnt);
  const meetingCnt    = n(meetingFollowup[0]?.cnt);
  const proposalCnt   = n(proposals[0]?.cnt);
  const recentCnt     = n(noNew[0]?.cnt);

  return [
    {
      id:         "stale_qualified",
      department: "partnerships",
      severity:   "medium",
      passed:     staleQualCnt === 0,
      title:      "Stale Qualified Opportunity",
      detail:     staleQualCnt > 0
        ? `${staleQualCnt} qualified partner${staleQualCnt > 1 ? "s" : ""} with no outreach for 14+ days`
        : "All qualified partners have recent outreach",
      recommendation: "Draft outreach emails for stale qualified opportunities",
      checkedAt:  now,
    },
    {
      id:         "meeting_followup_needed",
      department: "partnerships",
      severity:   "high",
      passed:     meetingCnt === 0,
      title:      "Meeting Follow-Up Needed",
      detail:     meetingCnt > 0
        ? `${meetingCnt} partnership meeting${meetingCnt > 1 ? "s" : ""} without update for 7+ days`
        : "All meetings have recent follow-up activity",
      recommendation: "Follow up on pending partnership meetings immediately",
      checkedAt:  now,
    },
    {
      id:         "proposal_pending",
      department: "partnerships",
      severity:   "medium",
      passed:     proposalCnt === 0,
      title:      "Partnership Proposal Pending",
      detail:     proposalCnt > 0
        ? `${proposalCnt} proposal${proposalCnt > 1 ? "s" : ""} in negotiation for 14+ days`
        : "All proposals are progressing on schedule",
      recommendation: "Review and advance stalled negotiation proposals",
      checkedAt:  now,
    },
    {
      id:         "no_new_opportunities",
      department: "partnerships",
      severity:   "low",
      passed:     recentCnt > 0,
      title:      "No New Opportunities",
      detail:     recentCnt === 0
        ? "No new partnership opportunities added in the last 30 days"
        : `${recentCnt} new partner${recentCnt > 1 ? "s" : ""} added in the last 30 days`,
      recommendation: "Research local organizations and add 3+ new partnership opportunities",
      checkedAt:  now,
    },
  ];
}

// ─── Coordinator implementation ───────────────────────────────────────────────

export function createPartnershipsCoordinator(): DepartmentCoordinator {
  return {
    departmentId:   "partnerships",
    departmentName: "Partnerships",

    async runHeartbeatReview(orgId: string): Promise<HeartbeatReviewResult> {
      const healthChecks = await runHealthChecks(orgId);
      const passed       = healthChecks.filter(c => c.passed).length;
      const failed       = healthChecks.filter(c => !c.passed);
      const bestAction   = await generatePartnershipsBestAction(orgId).catch((): BestAction | null => null);

      const alertsCreated = await departmentHealthEngine
        .createAttentionItemsFromFailed(orgId, "partnerships-coordinator", "partnerships", healthChecks)
        .catch(() => 0);

      const executiveSummary = failed.length === 0
        ? "Partnerships pipeline is healthy — no issues detected."
        : `${failed.length} health check${failed.length > 1 ? "s" : ""} need attention in the Partnerships department.`;

      return {
        departmentId:    "partnerships",
        departmentName:  "Partnerships",
        checksRun:       healthChecks.length,
        checksPassed:    passed,
        alertsCreated,
        bestAction,
        executiveSummary,
        healthChecks,
      };
    },

    async generateSummary(orgId: string): Promise<DepartmentSummaryResult> {
      const countRows = await db.execute(sql`
        SELECT status, COUNT(*) as cnt
        FROM partnership_opportunities
        WHERE org_id = ${orgId}
        GROUP BY status
      `).then(rows);

      const byStatus   = Object.fromEntries(countRows.map((r: any) => [r.status, n(r.cnt)]));
      const total      = Object.values(byStatus).reduce((s: any, v: any) => s + v, 0) as number;
      const partnered  = n(byStatus.partnered);
      const meeting    = n(byStatus.meeting);
      const negotiation = n(byStatus.negotiation);
      const convRate   = total > 0 ? Math.round((partnered / total) * 100) : 0;

      const bestAction = await generatePartnershipsBestAction(orgId).catch((): BestAction | null => null);

      const parts: string[] = [`${total} opportunities total.`];
      if (partnered > 0)   parts.push(`${partnered} active partnership${partnered > 1 ? "s" : ""}.`);
      if (meeting > 0)     parts.push(`${meeting} meeting${meeting > 1 ? "s" : ""} in progress.`);
      if (negotiation > 0) parts.push(`${negotiation} proposal${negotiation > 1 ? "s" : ""} in negotiation.`);

      return {
        departmentId:    "partnerships",
        departmentName:  "Partnerships",
        executiveSummary: parts.join(" "),
        metrics:         { total, partnered, meeting, negotiation, convRate },
        bestAction,
        generatedAt:     new Date().toISOString(),
      };
    },

    async generateBestAction(orgId: string): Promise<BestAction | null> {
      return generatePartnershipsBestAction(orgId).catch((): BestAction | null => null);
    },
  };
}
