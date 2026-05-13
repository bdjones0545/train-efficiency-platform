import { db } from "../db";
import { teamTrainingProspects, teamTrainingDeals } from "@shared/schema";
import { eq, and, gte, desc, sql, inArray } from "drizzle-orm";
import { subDays, subMonths } from "date-fns";

export interface GrowthSignal {
  signalType: string;
  entityType: string;
  entityId: string;
  entityName: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  score: number;
  metadata: Record<string, unknown>;
}

export interface GrowthRecommendation {
  title: string;
  description: string;
  reason: string;
  entityType: string;
  entityId: string;
  entityName: string;
  severity: "critical" | "high" | "medium" | "low";
  estimatedImpact: number;
  priorityScore: number;
  actionType: string;
  crossAgentTypes: string[];
  metadata: Record<string, unknown>;
}

export interface GrowthAgentResult {
  signals: GrowthSignal[];
  recommendations: GrowthRecommendation[];
  summary: {
    totalProspects: number;
    hotLeads: number;
    stalledDeals: number;
    avgDealValue: number;
    bestLeadSource: string | null;
  };
}

export async function runGrowthAgent(orgId: string): Promise<GrowthAgentResult> {
  const signals: GrowthSignal[] = [];
  const recommendations: GrowthRecommendation[] = [];
  const now = new Date();
  const thirtyDays = subDays(now, 30);
  const fourteenDays = subDays(now, 14);

  // --- Get all prospects ---
  const prospects = await db
    .select()
    .from(teamTrainingProspects)
    .where(eq(teamTrainingProspects.orgId, orgId))
    .orderBy(desc(teamTrainingProspects.createdAt));

  // --- Get all deals ---
  const deals = await db
    .select()
    .from(teamTrainingDeals)
    .where(eq(teamTrainingDeals.organizationId, orgId));

  const totalProspects = prospects.length;
  const hotLeads = prospects.filter((p) =>
    ["Replied", "Approved", "Contacted"].includes(p.outreachStatus || "")
  );
  const stalledDeals = deals.filter((d) => {
    const isStalled =
      d.lastActivityAt && d.lastActivityAt < fourteenDays &&
      !["won", "lost"].includes(d.status || "");
    return isStalled;
  });

  const avgDealValue =
    deals.length > 0
      ? Math.round(deals.reduce((s, d) => s + (d.estimatedValue || 0), 0) / deals.length)
      : 0;

  // --- Analyze lead sources ---
  const sourceCounts: Record<string, { total: number; converted: number; replied: number }> = {};
  for (const p of prospects) {
    const source = p.organizationType || "Unknown";
    if (!sourceCounts[source]) sourceCounts[source] = { total: 0, converted: 0, replied: 0 };
    sourceCounts[source].total++;
    if (["Replied", "Approved", "Contacted"].includes(p.outreachStatus || "")) {
      sourceCounts[source].replied++;
    }
    if (p.outreachStatus === "Replied") sourceCounts[source].converted++;
  }

  // Find best-performing source
  let bestSource: string | null = null;
  let bestConversionRate = 0;
  for (const [source, data] of Object.entries(sourceCounts)) {
    if (data.total < 2) continue;
    const rate = data.replied / data.total;
    if (rate > bestConversionRate) {
      bestConversionRate = rate;
      bestSource = source;
    }
  }

  // --- Hot lead signal ---
  if (hotLeads.length > 0) {
    const topLead = hotLeads.sort((a, b) => (b.estimatedValue || 0) - (a.estimatedValue || 0))[0];
    signals.push({
      signalType: "hot_leads",
      entityType: "prospect",
      entityId: topLead.id,
      entityName: topLead.prospectName,
      title: `${hotLeads.length} hot lead${hotLeads.length > 1 ? "s" : ""} need attention`,
      description: `Top: ${topLead.prospectName} (${topLead.outreachStatus}) — estimated $${((topLead.estimatedValue || 0) / 100).toFixed(0)}/yr`,
      severity: "high",
      score: 78,
      metadata: { count: hotLeads.length, topLeadId: topLead.id, topLeadValue: topLead.estimatedValue },
    });

    recommendations.push({
      title: `Follow up on ${hotLeads.length} warm lead${hotLeads.length > 1 ? "s" : ""}`,
      description: `${hotLeads.length} prospects have shown interest but haven't converted yet. ${topLead.prospectName} is the highest-value at $${((topLead.estimatedValue || 0) / 100).toFixed(0)}/yr.`,
      reason: `Hot leads in "Replied" or "Interested" status have 3x higher close rate if contacted within 48 hours.`,
      entityType: "prospect",
      entityId: topLead.id,
      entityName: topLead.prospectName,
      severity: "high",
      estimatedImpact: hotLeads.reduce((s, l) => s + (l.estimatedValue || 0), 0),
      priorityScore: 78,
      actionType: "followup_hot_lead",
      crossAgentTypes: ["revenue"],
      metadata: { leadIds: hotLeads.map((l) => l.id).slice(0, 5), count: hotLeads.length },
    });
  }

  // --- Stalled deals signal ---
  for (const deal of stalledDeals.slice(0, 3)) {
    const prospect = prospects.find((p) => p.id === deal.prospectId);
    const name = prospect?.prospectName || "Unknown Deal";
    const daysSinceActivity = deal.lastActivityAt
      ? Math.floor((now.getTime() - deal.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    signals.push({
      signalType: "stalled_deal",
      entityType: "deal",
      entityId: deal.id,
      entityName: name,
      title: `Deal with ${name} stalled ${daysSinceActivity}d`,
      description: `No activity in ${daysSinceActivity} days. Deal worth $${((deal.estimatedValue || 0) / 100).toFixed(0)} at risk.`,
      severity: daysSinceActivity > 21 ? "high" : "medium",
      score: Math.min(85, daysSinceActivity * 2 + 30),
      metadata: { daysSinceActivity, estimatedValue: deal.estimatedValue, status: deal.status },
    });

    recommendations.push({
      title: `Revive stalled deal with ${name}`,
      description: `This deal has had no activity in ${daysSinceActivity} days and is worth $${((deal.estimatedValue || 0) / 100).toFixed(0)}. Send a re-engagement message.`,
      reason: `Deals stalled 14+ days have significantly lower close rates. Act now before it goes cold.`,
      entityType: "deal",
      entityId: deal.id,
      entityName: name,
      severity: daysSinceActivity > 21 ? "high" : "medium",
      estimatedImpact: deal.estimatedValue || 0,
      priorityScore: Math.min(82, daysSinceActivity * 2 + 30),
      actionType: "revive_stalled_deal",
      crossAgentTypes: ["revenue"],
      metadata: { daysSinceActivity, prospectId: deal.prospectId },
    });
  }

  // --- Best lead source signal ---
  if (bestSource && bestConversionRate > 0.3) {
    signals.push({
      signalType: "high_converting_source",
      entityType: "lead_source",
      entityId: orgId,
      entityName: bestSource,
      title: `${bestSource} converts at ${(bestConversionRate * 100).toFixed(0)}%`,
      description: `Your top-performing lead source. Double down on this segment.`,
      severity: "low",
      score: 45,
      metadata: { source: bestSource, conversionRate: bestConversionRate, data: sourceCounts[bestSource] },
    });

    recommendations.push({
      title: `Double down on ${bestSource} outreach`,
      description: `${bestSource} leads convert at ${(bestConversionRate * 100).toFixed(0)}% — significantly above average. Prioritize this segment in your next outreach batch.`,
      reason: `High-converting source identified via analysis of ${sourceCounts[bestSource]?.total} prospects.`,
      entityType: "lead_source",
      entityId: orgId,
      entityName: bestSource,
      severity: "low",
      estimatedImpact: Math.round(avgDealValue * bestConversionRate * 3),
      priorityScore: 45,
      actionType: "expand_lead_source",
      crossAgentTypes: [],
      metadata: { source: bestSource, conversionRate: bestConversionRate },
    });
  }

  return {
    signals,
    recommendations,
    summary: {
      totalProspects,
      hotLeads: hotLeads.length,
      stalledDeals: stalledDeals.length,
      avgDealValue,
      bestLeadSource: bestSource,
    },
  };
}
