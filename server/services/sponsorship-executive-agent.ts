/**
 * Sponsorship Executive Agent — Department OS v2
 * Uses Executive Engine Framework: rankBestActions, composeBrief, prioritizeRecommendations.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import type {
  BestAction,
  ActionPriority,
  DepartmentRecommendation,
  ExecutiveBrief,
} from "../frameworks/department-os/executive-engine";
import {
  rankBestActions,
  candidate,
  composeBrief,
  prioritizeRecommendations,
  buildWinsFromCounts,
  buildRisksFromChecks,
  formatPipelineSummary,
} from "../frameworks/department-os/executive-engine";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }
function n(v: any): number   { return Number(v ?? 0); }

// ─── Pipeline stats ───────────────────────────────────────────────────────────

async function getPipelineStats(orgId: string) {
  const stageRows = await db.execute(sql`
    SELECT status, COUNT(*) as cnt
    FROM sponsorship_opportunities
    WHERE org_id = ${orgId}
    GROUP BY status
  `).then(rows);

  const byStatus = Object.fromEntries(stageRows.map((r: any) => [r.status, n(r.cnt)]));
  const total    = Object.values(byStatus).reduce((s: any, v: any) => s + v, 0) as number;

  return {
    total,
    new:           n(byStatus.new),
    qualified:     n(byStatus.qualified),
    outreachReady: n(byStatus.outreach_ready),
    contacted:     n(byStatus.contacted),
    interested:    n(byStatus.interested),
    meeting:       n(byStatus.meeting),
    proposal:      n(byStatus.proposal),
    negotiation:   n(byStatus.negotiation),
    sponsored:     n(byStatus.sponsored),
    declined:      n(byStatus.declined),
  };
}

// ─── Best action ──────────────────────────────────────────────────────────────

export async function generateSponsorshipsBestAction(orgId: string): Promise<BestAction | null> {
  const stats = await getPipelineStats(orgId);

  const pool = [
    candidate(
      stats.negotiation > 0,
      {
        title:       `Review ${stats.negotiation} Active Sponsorship Negotiation${stats.negotiation > 1 ? "s" : ""}`,
        description: "Sponsorships in negotiation are high-value — delays can lose momentum and budget cycles.",
        priority:    "high" as ActionPriority,
        route:       "/admin/sponsorships",
        estimatedImpact: "Closes active sponsorship deals",
      },
      92,
    ),
    candidate(
      stats.interested > 0,
      {
        title:       `Follow Up with ${stats.interested} Interested Sponsor${stats.interested > 1 ? "s" : ""}`,
        description: "Sponsor interest signals decay — schedule follow-up meetings before momentum fades.",
        priority:    "high" as ActionPriority,
        route:       "/admin/sponsorships",
        estimatedImpact: "Advances interest to formal meetings",
      },
      85,
    ),
    candidate(
      stats.proposal > 0,
      {
        title:       `Advance ${stats.proposal} Pending Proposal${stats.proposal > 1 ? "s" : ""}`,
        description: "Proposals awaiting sponsor review — follow up to avoid budget cycle misses.",
        priority:    "high" as ActionPriority,
        route:       "/admin/sponsorships",
        estimatedImpact: "Moves proposals into negotiation stage",
      },
      80,
    ),
    candidate(
      stats.meeting > 0,
      {
        title:       `Prepare for ${stats.meeting} Upcoming Sponsor Meeting${stats.meeting > 1 ? "s" : ""}`,
        description: "Active sponsor meetings need preparation — build value cases and sponsorship decks.",
        priority:    "medium" as ActionPriority,
        route:       "/admin/sponsorships",
        estimatedImpact: "Converts meetings into formal proposals",
      },
      75,
    ),
    candidate(
      stats.outreachReady > 0,
      {
        title:       `Send Outreach to ${stats.outreachReady} Qualified Sponsor${stats.outreachReady > 1 ? "s" : ""}`,
        description: "Qualified sponsors ready for first contact — reaching out now fills the proposal pipeline.",
        priority:    "medium" as ActionPriority,
        route:       "/admin/sponsorships",
        estimatedImpact: "Fills the contacted pipeline",
      },
      70,
    ),
    candidate(
      stats.total < 5,
      {
        title:       "Expand Sponsorship Pipeline",
        description: "Fewer than 5 active opportunities. Target local businesses, equipment brands, or nutrition companies.",
        priority:    "low" as ActionPriority,
        route:       "/admin/sponsorships",
        estimatedImpact: "Builds sustainable sponsorship revenue base",
      },
      55,
    ),
  ];

  return rankBestActions("sponsorships", pool);
}

// ─── Recommendations ──────────────────────────────────────────────────────────

export async function generateSponsorshipsRecommendations(orgId: string): Promise<DepartmentRecommendation[]> {
  const stats = await getPipelineStats(orgId);
  const now   = new Date();
  const recs:  DepartmentRecommendation[] = [];

  if (stats.qualified > 3) {
    recs.push({
      department:      "sponsorships",
      orgId,
      category:        "outreach",
      recommendation:  `${stats.qualified} qualified sponsors awaiting outreach — begin contact this week`,
      reasoning:       "Qualified prospects without outreach represent pipeline stagnation",
      confidenceScore: 85,
      supportingData:  { qualifiedCount: stats.qualified },
      status:          "pending",
      createdAt:       now,
    });
  }

  if (stats.sponsored > 0) {
    recs.push({
      department:      "sponsorships",
      orgId,
      category:        "execution",
      recommendation:  "Schedule quarterly reviews with active sponsors to demonstrate ROI and secure renewals",
      reasoning:       "Sponsor retention is more cost-effective than acquiring new sponsors",
      confidenceScore: 80,
      supportingData:  { sponsoredCount: stats.sponsored },
      status:          "pending",
      createdAt:       now,
    });
  }

  if (stats.declined > 0 && stats.sponsored > 0 && stats.declined > stats.sponsored * 2) {
    recs.push({
      department:      "sponsorships",
      orgId,
      category:        "discovery",
      recommendation:  "Review sponsorship targeting criteria — high decline rate suggests brand-fit misalignment",
      reasoning:       `${stats.declined} declines vs ${stats.sponsored} active sponsors signals targeting gaps`,
      confidenceScore: 72,
      supportingData:  { declinedCount: stats.declined, sponsoredCount: stats.sponsored },
      status:          "pending",
      createdAt:       now,
    });
  }

  if (stats.proposal > 2) {
    recs.push({
      department:      "sponsorships",
      orgId,
      category:        "pipeline",
      recommendation:  "Multiple proposals outstanding — prioritize follow-ups to avoid budget cycle misses",
      reasoning:       "Corporate sponsorship budgets are time-sensitive; stale proposals lose budget allocation",
      confidenceScore: 78,
      supportingData:  { proposalCount: stats.proposal },
      status:          "pending",
      createdAt:       now,
    });
  }

  recs.push({
    department:      "sponsorships",
    orgId,
    category:        "discovery",
    recommendation:  "Identify 3 local businesses, equipment brands, or nutrition companies for pipeline development",
    reasoning:       "Consistent prospecting maintains a healthy sponsorship pipeline",
    confidenceScore: 70,
    supportingData:  {},
    status:          "pending",
    createdAt:       now,
  });

  return prioritizeRecommendations(recs);
}

// ─── Executive brief ──────────────────────────────────────────────────────────

export async function generateSponsorshipsBrief(orgId: string): Promise<ExecutiveBrief> {
  const stats    = await getPipelineStats(orgId);
  const convRate = stats.total > 0 ? Math.round((stats.sponsored / stats.total) * 100) : 0;

  const keyWins = buildWinsFromCounts(
    { sponsored: stats.sponsored, meeting: stats.meeting },
    [
      { key: "sponsored", singular: "active sponsor",     plural: "active sponsors",     threshold: 0 },
      { key: "meeting",   singular: "meeting scheduled",  plural: "meetings scheduled",  threshold: 0 },
    ],
  );

  const keyRisks = buildRisksFromChecks(
    { negotiation: stats.negotiation, proposal: stats.proposal },
    [
      { key: "negotiation", singular: "negotiation", plural: "negotiations", suffix: "stalled without update",    threshold: 0 },
      { key: "proposal",    singular: "proposal",    plural: "proposals",    suffix: "awaiting sponsor response", threshold: 1 },
    ],
  );

  const keyOpportunities: string[] = [];
  if (stats.interested > 0) keyOpportunities.push(`${stats.interested} interested sponsor${stats.interested > 1 ? "s" : ""} ready for follow-up meetings`);
  if (stats.qualified > 0)  keyOpportunities.push(`${stats.qualified} qualified sponsor${stats.qualified > 1 ? "s" : ""} ready for first outreach`);
  if (convRate < 20 && stats.total > 5) keyOpportunities.push("Improving sponsor conversion by 5% would meaningfully grow sponsorship revenue");

  const summary = formatPipelineSummary({
    entityLabel: "Sponsor",
    total:       stats.total,
    qualified:   stats.qualified,
    active:      stats.meeting + stats.proposal + stats.negotiation,
    won:         stats.sponsored,
    winRate:     convRate,
  });

  const bestAction = await generateSponsorshipsBestAction(orgId);

  return composeBrief({
    department:       "sponsorships",
    orgId,
    summary,
    bestActionToday:  bestAction?.title ?? "Review sponsorship pipeline status",
    keyWins:          keyWins.length > 0 ? keyWins : ["No active sponsors recorded yet — build the pipeline"],
    keyRisks:         keyRisks.length > 0 ? keyRisks : ["No critical risks identified"],
    keyOpportunities: keyOpportunities.length > 0 ? keyOpportunities : ["Add sponsorship opportunities to unlock intelligence"],
    metrics:          {
      totalOpportunities: stats.total,
      activeSponsors:     stats.sponsored,
      activeMeetings:     stats.meeting,
      proposalsPending:   stats.proposal,
      inNegotiation:      stats.negotiation,
      conversionRate:     `${convRate}%`,
    },
  });
}
