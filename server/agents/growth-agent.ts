/**
 * Growth Agent — ADAPTER (v1 compatibility shim)
 *
 * This file is a thin adapter that delegates signal/recommendation logic to
 * Apex Agent (v2), the canonical Growth/Revenue intelligence engine.
 *
 * This adapter also owns the bestLeadSource computation, which is a separate
 * aggregate analytics concern not handled by Apex's per-signal engine.
 *
 * Preserved exports (GrowthSignal, GrowthRecommendation, GrowthAgentResult,
 * runGrowthAgent) allow Executive Agent (Atlas) to keep working without changes.
 *
 * DO NOT add per-signal business logic here — put it in apex-agent.ts.
 */

import { db } from "../db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { teamTrainingProspects, leadIntelligenceProfiles } from "@shared/schema";
import { runApexForOrg, type ApexSignal } from "./apex-agent";

// ─── Re-exported types (keep shape stable for Executive Agent) ────────────────

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

// ─── Lead source resolution ───────────────────────────────────────────────────

const ENGAGED_STATUSES = new Set(["Replied", "Approved", "Contacted", "Interested"]);

/**
 * Fallback hierarchy for resolving a human-readable source label per prospect:
 *   1. discoverySourceType   — explicit evidence field (web_scrape, directory, …)
 *   2. organizationType      — prospect category (High School, College, …)
 *   3. discoveryMethod       — how the lead was found (web_search, manual, …)
 * Returns null if none of these fields carry a meaningful value.
 */
function resolveProspectSourceLabel(p: {
  discoverySourceType: string | null;
  organizationType: string | null;
  discoveryMethod: string | null;
}): string | null {
  const clean = (v: string | null | undefined): string | null => {
    if (!v) return null;
    const t = v.trim().toLowerCase();
    if (t === "" || t === "unknown" || t === "null" || t === "n/a") return null;
    return v.trim();
  };
  return (
    clean(p.discoverySourceType) ??
    clean(p.organizationType) ??
    clean(p.discoveryMethod) ??
    null
  );
}

interface SourceStats {
  total: number;
  engaged: number;
  engagementRate: number;
}

/**
 * Compute the best performing lead source for an org.
 *
 * Fallback hierarchy:
 *   1. discoverySourceType (prospect evidence layer)
 *   2. organizationType    (prospect category)
 *   3. discoveryMethod     (how the lead was found)
 *   4. campaignSource      (inbound lead intelligence profiles)
 *   → null + telemetry log if nothing meaningful is found
 *
 * Requirements: ≥ 2 prospects in source, ≥ 20% engagement rate.
 * Org-scoped. Never fabricates sources.
 */
export async function computeBestLeadSource(orgId: string): Promise<string | null> {
  try {
    // Step 1: Pull all prospects with source fields
    const prospects = await db
      .select({
        id: teamTrainingProspects.id,
        outreachStatus: teamTrainingProspects.outreachStatus,
        discoverySourceType: teamTrainingProspects.discoverySourceType,
        organizationType: teamTrainingProspects.organizationType,
        discoveryMethod: teamTrainingProspects.discoveryMethod,
      })
      .from(teamTrainingProspects)
      .where(eq(teamTrainingProspects.orgId, orgId));

    // Step 2: Group by resolved source label
    const sourceCounts = new Map<string, SourceStats>();

    for (const p of prospects) {
      const label = resolveProspectSourceLabel(p);
      if (!label) continue;

      const existing = sourceCounts.get(label) ?? { total: 0, engaged: 0, engagementRate: 0 };
      existing.total++;
      if (ENGAGED_STATUSES.has(p.outreachStatus ?? "")) {
        existing.engaged++;
      }
      sourceCounts.set(label, existing);
    }

    // Step 3: Compute engagement rates
    for (const [label, stats] of sourceCounts) {
      stats.engagementRate = stats.total > 0 ? stats.engaged / stats.total : 0;
      sourceCounts.set(label, stats);
    }

    // Step 4: Find best source (≥ 2 prospects, ≥ 20% engagement rate)
    let bestSource: string | null = null;
    let bestRate = 0;

    for (const [label, stats] of sourceCounts) {
      if (stats.total >= 2 && stats.engagementRate > bestRate && stats.engagementRate >= 0.2) {
        bestRate = stats.engagementRate;
        bestSource = label;
      }
    }

    if (bestSource) {
      return bestSource;
    }

    // Step 5: Fallback — check inbound lead intelligence profiles for campaignSource
    const campaignRows = await db
      .select({ campaignSource: leadIntelligenceProfiles.campaignSource })
      .from(leadIntelligenceProfiles)
      .where(
        and(
          eq(leadIntelligenceProfiles.orgId, orgId),
          sql`${leadIntelligenceProfiles.campaignSource} IS NOT NULL`
        )
      )
      .limit(100);

    const campaignCounts = new Map<string, number>();
    for (const row of campaignRows) {
      const src = row.campaignSource?.trim();
      if (!src || src.toLowerCase() === "unknown") continue;
      campaignCounts.set(src, (campaignCounts.get(src) ?? 0) + 1);
    }

    if (campaignCounts.size > 0) {
      const topCampaign = [...campaignCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topCampaign[1] >= 1) {
        return topCampaign[0];
      }
    }

    // Step 6: Log telemetry and return null — do NOT fabricate a source
    if (prospects.length > 0) {
      console.log(
        `[GrowthAgent][${orgId}] bestLeadSource unresolved — ${prospects.length} prospect(s) but no source ` +
        `with ≥2 entries and ≥20% engagement. discoverySourceType populated: ` +
        `${prospects.filter((p) => p.discoverySourceType && p.discoverySourceType !== "unknown").length}, ` +
        `organizationType populated: ` +
        `${prospects.filter((p) => p.organizationType && p.organizationType !== "unknown").length}`
      );
    }

    return null;
  } catch (err: any) {
    console.warn(`[GrowthAgent][${orgId}] computeBestLeadSource error — ${err.message}`);
    return null;
  }
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function apexSignalToGrowthSignal(s: ApexSignal): GrowthSignal {
  return {
    signalType: s.signalType,
    entityType: s.entityType,
    entityId: s.entityId,
    entityName: s.entityName,
    title: s.recommendedAction,
    description: s.reasonText,
    severity: s.urgency,
    score: Math.round(s.confidenceScore * 100),
    metadata: {
      staleDays: s.staleDays,
      estimatedValueCents: s.estimatedValueCents,
      sourceUrl: s.sourceUrl,
    },
  };
}

function apexSignalToGrowthRecommendation(s: ApexSignal): GrowthRecommendation {
  return {
    title: s.recommendedAction,
    description: s.reasonText,
    reason: s.reasonText,
    entityType: s.entityType,
    entityId: s.entityId,
    entityName: s.entityName,
    severity: s.urgency,
    estimatedImpact: s.estimatedValueCents,
    priorityScore: Math.round(s.confidenceScore * 100),
    actionType: s.signalType,
    crossAgentTypes: ["revenue"],
    metadata: {
      staleDays: s.staleDays,
      sourceUrl: s.sourceUrl,
    },
  };
}

const HOT_LEAD_TYPES = new Set([
  "hot_lead_cooling",
  "uncontacted_high_value_prospect",
  "new_lead_no_action",
]);

const DEAL_SIGNAL_TYPES = new Set([
  "stale_active_deal",
  "high_value_stale_deal",
  "abandoned_deal",
  "overdue_followup",
]);

// ─── Public adapter function ──────────────────────────────────────────────────

export async function runGrowthAgent(orgId: string): Promise<GrowthAgentResult> {
  // Run Apex engine and lead source analysis in parallel
  const [apexResult, bestLeadSource] = await Promise.all([
    runApexForOrg(orgId, "manual"),
    computeBestLeadSource(orgId),
  ]);

  const signals: GrowthSignal[] = apexResult.signals.map(apexSignalToGrowthSignal);
  const recommendations: GrowthRecommendation[] = apexResult.signals.map(apexSignalToGrowthRecommendation);

  // Synthesize high_converting_source signal when a best source is identified
  // (mirrors the v1 behavior that was lost in the adapter conversion)
  if (bestLeadSource) {
    signals.push({
      signalType: "high_converting_source",
      entityType: "lead_source",
      entityId: orgId,
      entityName: bestLeadSource,
      title: `${bestLeadSource} is your best lead source`,
      description: `${bestLeadSource} is outperforming other sources by engagement rate. Prioritize this segment in your next outreach batch.`,
      severity: "low",
      score: 45,
      metadata: { source: bestLeadSource },
    });

    recommendations.push({
      title: `Double down on ${bestLeadSource} outreach`,
      description: `${bestLeadSource} leads are engaging at a higher rate than other sources. Prioritize this segment in your next outreach batch.`,
      reason: `Best-performing lead source identified via engagement rate analysis across all org prospects.`,
      entityType: "lead_source",
      entityId: orgId,
      entityName: bestLeadSource,
      severity: "low",
      estimatedImpact: 0,
      priorityScore: 45,
      actionType: "expand_lead_source",
      crossAgentTypes: [],
      metadata: { source: bestLeadSource },
    });
  }

  const hotLeads = apexResult.signals.filter((s) => HOT_LEAD_TYPES.has(s.signalType)).length;
  const stalledDeals = apexResult.signals.filter((s) => DEAL_SIGNAL_TYPES.has(s.signalType)).length;

  const avgDealValue =
    apexResult.signals.length > 0
      ? Math.round(
          apexResult.signals.reduce((sum, s) => sum + s.estimatedValueCents, 0) /
            apexResult.signals.length
        )
      : 0;

  return {
    signals,
    recommendations,
    summary: {
      totalProspects: apexResult.prospectsEvaluated,
      hotLeads,
      stalledDeals,
      avgDealValue,
      bestLeadSource,
    },
  };
}
