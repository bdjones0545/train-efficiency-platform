/**
 * Growth Agent — ADAPTER (v1 compatibility shim)
 *
 * This file is a thin adapter that delegates all logic to Apex Agent (v2).
 * Apex is the canonical Growth/Revenue intelligence engine.
 *
 * Preserved exports (GrowthSignal, GrowthRecommendation, GrowthAgentResult, runGrowthAgent)
 * allow Executive Agent (Atlas) to keep working without changes.
 *
 * DO NOT add business logic here — put it in apex-agent.ts.
 */

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

// ─── Public adapter function ──────────────────────────────────────────────────

export async function runGrowthAgent(orgId: string): Promise<GrowthAgentResult> {
  const result = await runApexForOrg(orgId, "manual");

  const signals: GrowthSignal[] = result.signals.map(apexSignalToGrowthSignal);
  const recommendations: GrowthRecommendation[] = result.signals.map(apexSignalToGrowthRecommendation);

  const hotLeadTypes = new Set([
    "hot_lead_cooling",
    "uncontacted_high_value_prospect",
    "new_lead_no_action",
  ]);
  const dealTypes = new Set([
    "stale_active_deal",
    "high_value_stale_deal",
    "abandoned_deal",
    "overdue_followup",
  ]);

  const hotLeads = result.signals.filter((s) => hotLeadTypes.has(s.signalType)).length;
  const stalledDeals = result.signals.filter((s) => dealTypes.has(s.signalType)).length;

  const avgDealValue =
    result.signals.length > 0
      ? Math.round(
          result.signals.reduce((sum, s) => sum + s.estimatedValueCents, 0) /
            result.signals.length
        )
      : 0;

  return {
    signals,
    recommendations,
    summary: {
      totalProspects: result.prospectsEvaluated,
      hotLeads,
      stalledDeals,
      avgDealValue,
      bestLeadSource: null,
    },
  };
}
