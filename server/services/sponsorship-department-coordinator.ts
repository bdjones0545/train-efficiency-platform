/**
 * Sponsorship Department Coordinator — Department OS v2
 * Implements DepartmentCoordinator; registered with departmentRegistry.
 * Plugs automatically into CEO Heartbeat, Attention Inbox, and Best Action Today.
 *
 * GUARDRAILS:
 *  ✗ No autonomous sponsorship decisions
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

import { generateSponsorshipsBestAction } from "./sponsorship-executive-agent";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }
function n(v: any): number   { return Number(v ?? 0); }

// ─── Health check queries ─────────────────────────────────────────────────────

async function runHealthChecks(orgId: string): Promise<DepartmentHealthCheck[]> {
  const now = new Date();

  const [proposalPending, interestedAging, noNew, negotiationStalled] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM sponsorship_opportunities
      WHERE org_id = ${orgId} AND status = 'proposal'
        AND updated_at < NOW() - INTERVAL '14 days'
    `).then(rows),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM sponsorship_opportunities
      WHERE org_id = ${orgId} AND status = 'interested'
        AND updated_at < NOW() - INTERVAL '7 days'
    `).then(rows),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM sponsorship_opportunities
      WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '30 days'
    `).then(rows),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM sponsorship_opportunities
      WHERE org_id = ${orgId} AND status = 'negotiation'
        AND updated_at < NOW() - INTERVAL '21 days'
    `).then(rows),
  ]);

  const proposalCnt    = n(proposalPending[0]?.cnt);
  const interestedCnt  = n(interestedAging[0]?.cnt);
  const recentCnt      = n(noNew[0]?.cnt);
  const negotiationCnt = n(negotiationStalled[0]?.cnt);

  return [
    {
      id:         "proposal_pending",
      department: "sponsorships",
      severity:   "high",
      passed:     proposalCnt === 0,
      title:      "Proposal Pending Review",
      detail:     proposalCnt > 0
        ? `${proposalCnt} sponsorship proposal${proposalCnt > 1 ? "s" : ""} in proposal stage for 14+ days`
        : "All proposals have recent follow-up activity",
      recommendation: "Follow up on pending sponsorship proposals — budget cycles are time-sensitive",
      checkedAt:  now,
    },
    {
      id:         "interested_sponsor_aging",
      department: "sponsorships",
      severity:   "medium",
      passed:     interestedCnt === 0,
      title:      "Interested Sponsor Aging",
      detail:     interestedCnt > 0
        ? `${interestedCnt} interested sponsor${interestedCnt > 1 ? "s" : ""} without follow-up for 7+ days`
        : "All interested sponsors have recent activity",
      recommendation: "Schedule meetings with interested sponsors before their interest cools",
      checkedAt:  now,
    },
    {
      id:         "no_new_sponsors",
      department: "sponsorships",
      severity:   "low",
      passed:     recentCnt > 0,
      title:      "No New Sponsors",
      detail:     recentCnt === 0
        ? "No new sponsorship opportunities added in the last 30 days"
        : `${recentCnt} new sponsor${recentCnt > 1 ? "s" : ""} added in the last 30 days`,
      recommendation: "Research local businesses, equipment brands, and nutrition companies to expand the pipeline",
      checkedAt:  now,
    },
    {
      id:         "negotiation_stalled",
      department: "sponsorships",
      severity:   "high",
      passed:     negotiationCnt === 0,
      title:      "Negotiation Stalled",
      detail:     negotiationCnt > 0
        ? `${negotiationCnt} sponsorship negotiation${negotiationCnt > 1 ? "s" : ""} without update for 21+ days`
        : "All negotiations have recent activity",
      recommendation: "Re-engage stalled negotiations with updated value propositions or adjusted terms",
      checkedAt:  now,
    },
  ];
}

// ─── Coordinator implementation ───────────────────────────────────────────────

export function createSponsorshipsCoordinator(): DepartmentCoordinator {
  return {
    departmentId:   "sponsorships",
    departmentName: "Sponsorships",

    async runHeartbeatReview(orgId: string): Promise<HeartbeatReviewResult> {
      const healthChecks = await runHealthChecks(orgId);
      const passed       = healthChecks.filter(c => c.passed).length;
      const failed       = healthChecks.filter(c => !c.passed);
      const bestAction   = await generateSponsorshipsBestAction(orgId).catch((): BestAction | null => null);

      const alertsCreated = await departmentHealthEngine
        .createAttentionItemsFromFailed(orgId, "sponsorships-coordinator", "sponsorships", healthChecks)
        .catch(() => 0);

      const executiveSummary = failed.length === 0
        ? "Sponsorship pipeline is healthy — no issues detected."
        : `${failed.length} health check${failed.length > 1 ? "s" : ""} need attention in the Sponsorships department.`;

      return {
        departmentId:    "sponsorships",
        departmentName:  "Sponsorships",
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
        FROM sponsorship_opportunities
        WHERE org_id = ${orgId}
        GROUP BY status
      `).then(rows);

      const byStatus    = Object.fromEntries(countRows.map((r: any) => [r.status, n(r.cnt)]));
      const total       = Object.values(byStatus).reduce((s: any, v: any) => s + v, 0) as number;
      const sponsored   = n(byStatus.sponsored);
      const proposal    = n(byStatus.proposal);
      const negotiation = n(byStatus.negotiation);
      const convRate    = total > 0 ? Math.round((sponsored / total) * 100) : 0;

      const bestAction = await generateSponsorshipsBestAction(orgId).catch((): BestAction | null => null);

      const parts: string[] = [`${total} opportunities total.`];
      if (sponsored   > 0) parts.push(`${sponsored} active sponsor${sponsored > 1 ? "s" : ""}.`);
      if (proposal    > 0) parts.push(`${proposal} proposal${proposal > 1 ? "s" : ""} pending.`);
      if (negotiation > 0) parts.push(`${negotiation} negotiation${negotiation > 1 ? "s" : ""} in progress.`);

      return {
        departmentId:    "sponsorships",
        departmentName:  "Sponsorships",
        executiveSummary: parts.join(" "),
        metrics:         { total, sponsored, proposal, negotiation, convRate },
        bestAction,
        generatedAt:     new Date().toISOString(),
      };
    },

    async generateBestAction(orgId: string): Promise<BestAction | null> {
      return generateSponsorshipsBestAction(orgId).catch((): BestAction | null => null);
    },
  };
}
