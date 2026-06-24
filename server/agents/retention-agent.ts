/**
 * Retention Agent — ADAPTER (v1 compatibility shim)
 *
 * This file is a thin adapter that delegates all logic to Pulse Agent (v2).
 * Pulse is the canonical Client Retention/Churn intelligence engine.
 *
 * Preserved exports (RetentionSignal, RetentionRecommendation, RetentionAgentResult,
 * runRetentionAgent) allow Executive Agent (Atlas) to keep working without changes.
 *
 * DO NOT add business logic here — put it in pulse-agent.ts.
 */

import { runPulseForOrg, type PulseSignal } from "./pulse-agent";

// ─── Re-exported types (keep shape stable for Executive Agent) ────────────────

export interface RetentionSignal {
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

export interface RetentionRecommendation {
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

export interface RetentionAgentResult {
  signals: RetentionSignal[];
  recommendations: RetentionRecommendation[];
  summary: {
    inactiveClients: number;
    churnRisks: number;
    expiringSubscriptions: number;
    cancelledRecently: number;
  };
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function pulseSignalToRetentionSignal(s: PulseSignal): RetentionSignal {
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

function pulseSignalToRetentionRecommendation(s: PulseSignal): RetentionRecommendation {
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
    crossAgentTypes: [],
    metadata: {
      staleDays: s.staleDays,
      sourceUrl: s.sourceUrl,
    },
  };
}

// ─── Public adapter function ──────────────────────────────────────────────────

const INACTIVE_TYPES = new Set([
  "inactive_client",
  "lapsed_client",
  "declining_frequency",
  "no_show_pattern",
]);

const SUBSCRIPTION_TYPES = new Set([
  "expiring_subscription",
  "low_session_remaining",
]);

const CANCELLED_TYPES = new Set([
  "cancelled_subscription",
]);

export async function runRetentionAgent(orgId: string): Promise<RetentionAgentResult> {
  const result = await runPulseForOrg(orgId, "manual");

  const signals: RetentionSignal[] = result.signals.map(pulseSignalToRetentionSignal);
  const recommendations: RetentionRecommendation[] = result.signals
    .filter((s) => s.urgency === "critical" || s.urgency === "high" || s.urgency === "medium")
    .map(pulseSignalToRetentionRecommendation);

  const inactiveClients = result.signals.filter((s) => INACTIVE_TYPES.has(s.signalType)).length;
  const churnRisks = result.signals.filter(
    (s) => s.urgency === "critical" || s.urgency === "high"
  ).length;
  const expiringSubscriptions = result.signals.filter((s) => SUBSCRIPTION_TYPES.has(s.signalType)).length;
  const cancelledRecently = result.signals.filter((s) => CANCELLED_TYPES.has(s.signalType)).length;

  return {
    signals,
    recommendations,
    summary: {
      inactiveClients,
      churnRisks,
      expiringSubscriptions,
      cancelledRecently,
    },
  };
}
