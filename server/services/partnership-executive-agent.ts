/**
 * Partnership Executive Agent — Department OS v2
 * Uses Executive Engine Framework: rankBestActions, composeBrief, prioritizeRecommendations.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import type { BestAction, ActionPriority, DepartmentRecommendation, ExecutiveBrief } from "../frameworks/department-os/executive-engine";
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
    FROM partnership_opportunities
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
    negotiation:   n(byStatus.negotiation),
    partnered:     n(byStatus.partnered),
    declined:      n(byStatus.declined),
  };
}

// ─── Best action ─────────────────────────────────────────────────────────────

export async function generatePartnershipsBestAction(orgId: string): Promise<BestAction | null> {
  const stats = await getPipelineStats(orgId);

  const pool = [
    candidate(
      stats.meeting > 0,
      {
        title:       `Follow Up on ${stats.meeting} Active Meeting${stats.meeting > 1 ? "s" : ""}`,
        description: "Partnership meetings in progress need timely follow-up to advance to negotiation.",
        priority:    "high" as ActionPriority,
        route:       "/admin/partnerships",
        estimatedImpact: "Moves meetings to negotiation stage",
      },
      85,
    ),
    candidate(
      stats.negotiation > 0,
      {
        title:       `Review ${stats.negotiation} Partnership Proposal${stats.negotiation > 1 ? "s" : ""} in Negotiation`,
        description: "Proposals in negotiation are high-value — delays can lose momentum.",
        priority:    "high" as ActionPriority,
        route:       "/admin/partnerships",
        estimatedImpact: "Closes active partnership negotiations",
      },
      92,
    ),
    candidate(
      stats.interested > 0,
      {
        title:       `Schedule Meetings with ${stats.interested} Interested Organization${stats.interested > 1 ? "s" : ""}`,
        description: "Interest signals decay — book meetings before momentum fades.",
        priority:    "medium" as ActionPriority,
        route:       "/admin/partnerships",
        estimatedImpact: "Advances interested prospects to meeting stage",
      },
      75,
    ),
    candidate(
      stats.outreachReady > 0,
      {
        title:       `Send Outreach to ${stats.outreachReady} Qualified Partner${stats.outreachReady > 1 ? "s" : ""}`,
        description: "Qualified organizations ready for outreach — contacting them is the highest-leverage prospecting action.",
        priority:    "medium" as ActionPriority,
        route:       "/admin/partnerships",
        estimatedImpact: "Fills the contacted pipeline",
      },
      70,
    ),
    candidate(
      stats.total < 5,
      {
        title:       "Expand Partnership Pipeline",
        description: "Fewer than 5 active opportunities. Add local sports clubs, schools, or clinics.",
        priority:    "low" as ActionPriority,
        route:       "/admin/partnerships",
        estimatedImpact: "Strengthens future partnership options",
      },
      55,
    ),
  ];

  return rankBestActions("partnerships", pool);
}

// ─── Recommendations ──────────────────────────────────────────────────────────

export async function generatePartnershipsRecommendations(orgId: string): Promise<DepartmentRecommendation[]> {
  const stats = await getPipelineStats(orgId);
  const now   = new Date();

  const recs: DepartmentRecommendation[] = [];

  if (stats.qualified > 3) {
    recs.push({
      department:      "partnerships",
      orgId,
      category:        "outreach",
      recommendation:  `${stats.qualified} qualified partners are awaiting outreach — begin contact this week`,
      reasoning:       "Qualified prospects without outreach represent pipeline stagnation",
      confidenceScore: 85,
      supportingData:  { qualifiedCount: stats.qualified },
      status:          "pending",
      createdAt:       now,
    });
  }

  if (stats.partnered > 0) {
    recs.push({
      department:      "partnerships",
      orgId,
      category:        "execution",
      recommendation:  "Schedule quarterly check-ins with active partners to maintain relationships",
      reasoning:       "Partner retention is 3× more cost-effective than acquiring new partners",
      confidenceScore: 78,
      supportingData:  { partneredCount: stats.partnered },
      status:          "pending",
      createdAt:       now,
    });
  }

  if (stats.declined > 0 && stats.partnered > 0 && stats.declined > stats.partnered * 2) {
    recs.push({
      department:      "partnerships",
      orgId,
      category:        "discovery",
      recommendation:  "Review partnership targeting criteria — high decline rate suggests prospect-fit misalignment",
      reasoning:       `${stats.declined} declines vs ${stats.partnered} partnerships signals targeting gaps`,
      confidenceScore: 72,
      supportingData:  { declinedCount: stats.declined, partneredCount: stats.partnered },
      status:          "pending",
      createdAt:       now,
    });
  }

  recs.push({
    department:      "partnerships",
    orgId,
    category:        "discovery",
    recommendation:  "Identify 3 new local sports clubs, schools, or clinics for pipeline development",
    reasoning:       "Consistent prospecting maintains a healthy partnership pipeline",
    confidenceScore: 70,
    supportingData:  {},
    status:          "pending",
    createdAt:       now,
  });

  if (stats.meeting > 2) {
    recs.push({
      department:      "partnerships",
      orgId,
      category:        "pipeline",
      recommendation:  "Prioritize meeting follow-ups — multiple active meetings may dilute focus",
      reasoning:       "More than 2 concurrent meetings can slow individual deal velocity",
      confidenceScore: 68,
      supportingData:  { meetingCount: stats.meeting },
      status:          "pending",
      createdAt:       now,
    });
  }

  return prioritizeRecommendations(recs);
}

// ─── Executive brief ──────────────────────────────────────────────────────────

export async function generatePartnershipsBrief(orgId: string): Promise<ExecutiveBrief> {
  const stats    = await getPipelineStats(orgId);
  const convRate = stats.total > 0 ? Math.round((stats.partnered / stats.total) * 100) : 0;

  const keyWins = buildWinsFromCounts(
    { partnered: stats.partnered, meeting: stats.meeting },
    [
      { key: "partnered", singular: "active partnership",         plural: "active partnerships",        threshold: 0 },
      { key: "meeting",   singular: "meeting in progress",        plural: "meetings in progress",       threshold: 0 },
    ],
  );

  const keyRisks = buildRisksFromChecks(
    { negotiation: stats.negotiation, outreachReady: stats.outreachReady },
    [
      { key: "negotiation",   singular: "proposal", plural: "proposals",             suffix: "stalled in negotiation", threshold: 0 },
      { key: "outreachReady", singular: "partner",  plural: "qualified partners",    suffix: "awaiting outreach",      threshold: 2 },
    ],
  );

  const keyOpportunities: string[] = [];
  if (stats.interested > 0) keyOpportunities.push(`${stats.interested} interested organization${stats.interested > 1 ? "s" : ""} ready to schedule a meeting`);
  if (stats.qualified > 0)  keyOpportunities.push(`${stats.qualified} qualified partner${stats.qualified > 1 ? "s" : ""} for targeted outreach`);
  if (convRate < 20 && stats.total > 5) keyOpportunities.push("Improving conversion rate by 5% would unlock significant partnership growth");

  const summary = formatPipelineSummary({
    entityLabel:   "Partner",
    total:         stats.total,
    qualified:     stats.qualified,
    active:        stats.meeting + stats.negotiation,
    won:           stats.partnered,
    winRate:       convRate,
  });

  const bestAction = await generatePartnershipsBestAction(orgId);

  return composeBrief({
    department:       "partnerships",
    orgId,
    summary,
    bestActionToday:  bestAction?.title ?? "Review partnership pipeline status",
    keyWins:          keyWins.length > 0 ? keyWins : ["No active wins recorded yet — build the pipeline"],
    keyRisks:         keyRisks.length > 0 ? keyRisks : ["No critical risks identified"],
    keyOpportunities: keyOpportunities.length > 0 ? keyOpportunities : ["Add partnership opportunities to unlock intelligence"],
    metrics:          {
      totalOpportunities: stats.total,
      partnered:          stats.partnered,
      activeMeetings:     stats.meeting,
      inNegotiation:      stats.negotiation,
      conversionRate:     `${convRate}%`,
    },
  });
}
