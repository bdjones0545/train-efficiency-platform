/**
 * Organization Intelligence Orchestrator — Phase 4
 *
 * The central coordination layer for TrainEfficiency's event-driven intelligence network.
 * Listens to the event bus, determines downstream effects, and triggers appropriate
 * agents, drafts, notifications, and escalations across all systems.
 *
 * Design principles:
 *  - Explainable: every triggered action has a logged rationale
 *  - Human-in-the-loop: drafts, not autonomous execution
 *  - Idempotent: cooldown windows prevent duplicate interventions
 *  - Deterministic: rule-based routing, not black-box AI decisions
 *  - Auditable: all triggered actions persist to organization_event_log
 */

import { db } from "../db";
import {
  organizationEventLog,
  organizationIntelligenceState,
  programAdaptationDrafts,
  athleteContextObjects,
  orgUsers,
  type OrganizationIntelligenceState,
} from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { subscribeToEvent, publishEvent } from "../events/event-bus";
import type {
  AthleteReadinessUpdatedPayload,
  AthleteComplianceDeclinedPayload,
  AthleteRiskEscalatedPayload,
  AthleteSessionMissedPayload,
  AthletePainReportedPayload,
  AthleteInterventionApprovedPayload,
  AthleteEscalationTriggeredPayload,
  OrgRetentionRiskDetectedPayload,
  SystemEvent,
} from "../events/event-types";

// ─── Cooldown Registry ────────────────────────────────────────────────────────
// Prevents duplicate interventions from back-to-back events

interface CooldownEntry {
  expiresAt: number;
  actionType: string;
}

const cooldowns = new Map<string, CooldownEntry>();

function isOnCooldown(key: string): boolean {
  const entry = cooldowns.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    cooldowns.delete(key);
    return false;
  }
  return true;
}

function setCooldown(key: string, actionType: string, hoursMs: number = 24 * 60 * 60 * 1000): void {
  cooldowns.set(key, { expiresAt: Date.now() + hoursMs, actionType });
}

// ─── Event Log Persistence ────────────────────────────────────────────────────

async function persistEventLog(
  orgId: string,
  eventId: string,
  eventType: string,
  sourceSystem: string,
  payload: unknown,
  athleteUserId?: string,
  triggeredWorkflows?: string[],
  resultingActions?: string[],
  correlationId?: string
): Promise<void> {
  try {
    await db.insert(organizationEventLog).values({
      orgId,
      eventId,
      eventType,
      sourceSystem,
      payload: payload as any,
      athleteUserId,
      triggeredWorkflows: triggeredWorkflows as any,
      resultingActions: resultingActions as any,
      correlationId,
      resolutionState: "open",
    }).onConflictDoNothing();
  } catch (err: any) {
    console.error("[Orchestrator] Event log persist error:", err?.message);
  }
}

// ─── Org State Updater ────────────────────────────────────────────────────────

export async function refreshOrgIntelligenceState(orgId: string): Promise<void> {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Pull current athlete contexts
    const contexts = await db.select().from(athleteContextObjects)
      .where(eq(athleteContextObjects.orgId, orgId));

    if (contexts.length === 0) return;

    let greenCount = 0, yellowCount = 0, redCount = 0;
    let totalReadiness = 0, readinessCount = 0;
    let totalCompliance = 0, complianceCount = 0;
    const criticalAthletes: string[] = [];

    for (const ctx of contexts) {
      const data = ctx.contextData as any;
      const riskLevel = data?.riskLevel ?? "green";
      if (riskLevel === "green") greenCount++;
      else if (riskLevel === "yellow") yellowCount++;
      else if (riskLevel === "red") {
        redCount++;
        criticalAthletes.push(ctx.athleteUserId);
      }

      if (data?.readinessTrend?.avg7d != null) {
        totalReadiness += data.readinessTrend.avg7d;
        readinessCount++;
      }
      if (data?.complianceRate != null) {
        totalCompliance += data.complianceRate;
        complianceCount++;
      }
    }

    const avgReadiness = readinessCount > 0 ? totalReadiness / readinessCount : 5;
    const avgCompliance = complianceCount > 0 ? totalCompliance / complianceCount : 100;

    // Open interventions
    const openInterventions = await db.select({ count: sql<number>`count(*)` })
      .from(programAdaptationDrafts)
      .where(and(
        eq(programAdaptationDrafts.orgId, orgId),
        eq(programAdaptationDrafts.status, "pending")
      ));
    const openCount = Number(openInterventions[0]?.count ?? 0);

    // Overall health score heuristic (0–100)
    let healthScore = 100;
    healthScore -= redCount * 15;
    healthScore -= yellowCount * 5;
    if (avgReadiness < 4) healthScore -= 20;
    else if (avgReadiness < 5.5) healthScore -= 10;
    if (avgCompliance < 50) healthScore -= 25;
    else if (avgCompliance < 70) healthScore -= 10;
    healthScore -= Math.min(openCount * 2, 20);
    healthScore = Math.max(0, Math.min(100, healthScore));

    // Fatigue risk heuristic
    let fatigueRisk = "low";
    if (redCount > 0 && avgReadiness < 4.5) fatigueRisk = "critical";
    else if (redCount > 0 || avgReadiness < 5) fatigueRisk = "high";
    else if (yellowCount > 0 || avgReadiness < 6) fatigueRisk = "medium";

    // Engagement trend
    let engagementTrend = "stable";
    if (avgCompliance >= 80) engagementTrend = "improving";
    else if (avgCompliance < 60) engagementTrend = "declining";

    await db.insert(organizationIntelligenceState).values({
      orgId,
      overallHealthScore: healthScore,
      interventionLoad: openCount,
      criticalAthleteCount: redCount,
      unresolvedCriticalAthletes: criticalAthletes as any,
      complianceHealthScore: Math.round(avgCompliance),
      engagementTrendDirection: engagementTrend,
      fatigueRiskLevel: fatigueRisk,
      readinessDistribution: { green: greenCount, yellow: yellowCount, red: redCount } as any,
      unresolvedInterventions: openCount,
      lastUpdatedAt: now,
    }).onConflictDoUpdate({
      target: organizationIntelligenceState.orgId,
      set: {
        overallHealthScore: healthScore,
        interventionLoad: openCount,
        criticalAthleteCount: redCount,
        unresolvedCriticalAthletes: criticalAthletes as any,
        complianceHealthScore: Math.round(avgCompliance),
        engagementTrendDirection: engagementTrend,
        fatigueRiskLevel: fatigueRisk,
        readinessDistribution: { green: greenCount, yellow: yellowCount, red: redCount } as any,
        unresolvedInterventions: openCount,
        lastUpdatedAt: now,
        updatedAt: now,
      },
    });

    // Publish state updated event
    publishEvent("org.intelligence.state.updated", {
      orgId,
      overallHealthScore: healthScore,
      criticalAthleteCount: redCount,
      unresolvedInterventions: openCount,
    }, { orgId, sourceSystem: "org-intelligence-orchestrator" });

  } catch (err: any) {
    console.error(`[Orchestrator] refreshOrgIntelligenceState error (org=${orgId}):`, err?.message);
  }
}

// ─── Escalation Chain Logic ───────────────────────────────────────────────────
// Reviews event history depth to determine escalation level for an athlete.
// Level 1: monitor (day 1)  Level 2: adaptation draft (day 3+)
// Level 3: outreach + coach (day 5+)  Level 4: critical queue (day 7+)

async function evaluateEscalationChain(
  orgId: string,
  athleteUserId: string,
  athleteName: string,
  currentEventType: string,
  signals: string[],
  correlationId?: string
): Promise<void> {
  const cooldownKey = `escalation:${orgId}:${athleteUserId}`;
  if (isOnCooldown(cooldownKey)) return;

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // How many distinct days have had events for this athlete?
    const recentEvents = await db.select()
      .from(organizationEventLog)
      .where(and(
        eq(organizationEventLog.orgId, orgId),
        eq(organizationEventLog.athleteUserId, athleteUserId),
        gte(organizationEventLog.createdAt, sevenDaysAgo)
      ))
      .orderBy(desc(organizationEventLog.createdAt))
      .limit(30);

    // Count distinct calendar days with events
    const daySet = new Set(
      recentEvents.map(e => new Date(e.createdAt!).toDateString())
    );
    const daysWithSignals = daySet.size;

    // Determine escalation level
    let escalationLevel: 1 | 2 | 3 | 4 = 1;
    if (daysWithSignals >= 7) escalationLevel = 4;
    else if (daysWithSignals >= 5) escalationLevel = 3;
    else if (daysWithSignals >= 3) escalationLevel = 2;

    // Find previous actions taken
    const previousActions = recentEvents
      .flatMap(e => (e.resultingActions as string[] | null) ?? [])
      .filter(Boolean);

    if (escalationLevel >= 2) {
      publishEvent("athlete.escalation.triggered", {
        athleteUserId,
        athleteName,
        escalationLevel,
        escalationReason: getEscalationReason(escalationLevel),
        daysSinceFirstSignal: daysWithSignals,
        unresolvedSignals: signals,
        previousActions: [...new Set(previousActions)],
      }, {
        orgId,
        sourceSystem: "escalation-chain",
        athleteUserId,
        idempotencyKey: `esc:${orgId}:${athleteUserId}:level${escalationLevel}:day${daysWithSignals}`,
        correlationId,
      });

      setCooldown(cooldownKey, "escalation", 12 * 60 * 60 * 1000);
    }
  } catch (err: any) {
    console.error(`[Orchestrator] Escalation chain error:`, err?.message);
  }
}

function getEscalationReason(level: 1 | 2 | 3 | 4): string {
  const reasons: Record<number, string> = {
    1: "Early signal detected — monitoring period begins",
    2: "Signal persisted 3+ days — adaptation draft recommended",
    3: "5+ days unresolved, sessions missed — outreach and coach notification required",
    4: "7+ days unresolved — escalated to critical intervention queue",
  };
  return reasons[level];
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

async function handleReadinessUpdated(
  event: SystemEvent<AthleteReadinessUpdatedPayload>
): Promise<void> {
  const { meta, payload } = event;
  if (payload.trend !== "declining") return;

  await persistEventLog(
    meta.orgId, meta.eventId, event.type, meta.sourceSystem, payload,
    payload.athleteUserId,
    [],
    ["readiness_decline_monitored"]
  );

  if (payload.readinessScore < 5) {
    await evaluateEscalationChain(
      meta.orgId, payload.athleteUserId, payload.athleteName,
      event.type, ["readiness_low"], meta.correlationId
    );
  }

  // Trigger org state refresh (debounced via cooldown)
  const refreshKey = `state-refresh:${meta.orgId}`;
  if (!isOnCooldown(refreshKey)) {
    setCooldown(refreshKey, "state_refresh", 30 * 60 * 1000);
    setImmediate(() => refreshOrgIntelligenceState(meta.orgId).catch(() => {}));
  }
}

async function handleComplianceDeclined(
  event: SystemEvent<AthleteComplianceDeclinedPayload>
): Promise<void> {
  const { meta, payload } = event;

  await persistEventLog(
    meta.orgId, meta.eventId, event.type, meta.sourceSystem, payload,
    payload.athleteUserId,
    [],
    ["compliance_decline_flagged"]
  );

  // Below 60%: trigger escalation evaluation
  if (payload.complianceRate < 60) {
    await evaluateEscalationChain(
      meta.orgId, payload.athleteUserId, payload.athleteName,
      event.type, ["compliance_critical"], meta.correlationId
    );
  }
}

async function handleRiskEscalated(
  event: SystemEvent<AthleteRiskEscalatedPayload>
): Promise<void> {
  const { meta, payload } = event;

  await persistEventLog(
    meta.orgId, meta.eventId, event.type, meta.sourceSystem, payload,
    payload.athleteUserId,
    [],
    [`risk_level_${payload.riskLevel}_recorded`]
  );

  if (payload.riskLevel === "red") {
    await evaluateEscalationChain(
      meta.orgId, payload.athleteUserId, payload.athleteName,
      event.type, payload.triggerSignals, meta.correlationId
    );

    // Emit coach notification
    publishEvent("coach.followup.required", {
      coachUserId: "",
      athleteUserId: payload.athleteUserId,
      athleteName: payload.athleteName,
      followupReason: `Risk escalated to RED — ${payload.triggerSignals.join(", ")}`,
      urgency: "critical",
      suggestedActions: ["Review athlete context", "Approve pending intervention draft", "Schedule check-in"],
    }, {
      orgId: meta.orgId,
      sourceSystem: "org-intelligence-orchestrator",
      athleteUserId: payload.athleteUserId,
      idempotencyKey: `coachfollowup:${meta.orgId}:${payload.athleteUserId}:red`,
    });
  }

  setImmediate(() => refreshOrgIntelligenceState(meta.orgId).catch(() => {}));
}

async function handleSessionMissed(
  event: SystemEvent<AthleteSessionMissedPayload>
): Promise<void> {
  const { meta, payload } = event;

  await persistEventLog(
    meta.orgId, meta.eventId, event.type, meta.sourceSystem, payload,
    payload.athleteUserId,
    [],
    ["missed_session_logged"]
  );

  if ((payload.consecutiveMissed ?? 1) >= 2) {
    await evaluateEscalationChain(
      meta.orgId, payload.athleteUserId, payload.athleteName,
      event.type, ["missed_sessions"], meta.correlationId
    );
  }
}

async function handlePainReported(
  event: SystemEvent<AthletePainReportedPayload>
): Promise<void> {
  const { meta, payload } = event;

  // Pain always gets logged and always triggers escalation check
  await persistEventLog(
    meta.orgId, meta.eventId, event.type, meta.sourceSystem, payload,
    payload.athleteUserId,
    [],
    ["pain_report_logged", "immediate_escalation_review"]
  );

  // Pain bypasses day-count threshold — goes straight to escalation evaluation
  publishEvent("athlete.escalation.triggered", {
    athleteUserId: payload.athleteUserId,
    athleteName: payload.athleteName,
    escalationLevel: 3,
    escalationReason: "Pain reported — immediate review recommended regardless of prior signal history",
    daysSinceFirstSignal: 0,
    unresolvedSignals: ["new_pain_reported"],
    previousActions: [],
  }, {
    orgId: meta.orgId,
    sourceSystem: "org-intelligence-orchestrator",
    athleteUserId: payload.athleteUserId,
    idempotencyKey: `painesc:${meta.orgId}:${payload.athleteUserId}:${payload.reportedAt.slice(0, 10)}`,
  });
}

async function handleInterventionApproved(
  event: SystemEvent<AthleteInterventionApprovedPayload>
): Promise<void> {
  const { meta, payload } = event;

  // Resolve open events for this athlete now that an intervention is underway
  await db.update(organizationEventLog)
    .set({ resolutionState: "resolved", resolvedAt: new Date() })
    .where(and(
      eq(organizationEventLog.orgId, meta.orgId),
      eq(organizationEventLog.athleteUserId, payload.athleteUserId),
      eq(organizationEventLog.resolutionState, "open")
    ))
    .catch(() => {});

  await persistEventLog(
    meta.orgId, meta.eventId, event.type, meta.sourceSystem, payload,
    payload.athleteUserId,
    [],
    [`intervention_approved_${payload.interventionType}`, "prior_events_resolved"]
  );

  setImmediate(() => refreshOrgIntelligenceState(meta.orgId).catch(() => {}));
}

async function handleEscalationTriggered(
  event: SystemEvent<AthleteEscalationTriggeredPayload>
): Promise<void> {
  const { meta, payload } = event;

  const resultingActions: string[] = [];

  if (payload.escalationLevel >= 2) resultingActions.push("adaptation_draft_recommended");
  if (payload.escalationLevel >= 3) resultingActions.push("coach_followup_required", "outreach_suggested");
  if (payload.escalationLevel >= 4) resultingActions.push("critical_intervention_queue_elevated");

  await persistEventLog(
    meta.orgId, meta.eventId, event.type, meta.sourceSystem, payload,
    payload.athleteUserId,
    [],
    resultingActions,
    meta.correlationId
  );

  // Level 4: trigger coach overload check
  if (payload.escalationLevel === 4) {
    publishEvent("coach.intervention.pending", {
      coachUserId: "",
      athleteUserId: payload.athleteUserId,
      athleteName: payload.athleteName,
      interventionType: "critical_escalation",
      priorityScore: 100,
      draftId: "",
      daysWaiting: payload.daysSinceFirstSignal,
    }, {
      orgId: meta.orgId,
      sourceSystem: "org-intelligence-orchestrator",
      athleteUserId: payload.athleteUserId,
      idempotencyKey: `critpending:${meta.orgId}:${payload.athleteUserId}:l4`,
    });
  }
}

async function handleRetentionRisk(
  event: SystemEvent<OrgRetentionRiskDetectedPayload>
): Promise<void> {
  const { meta, payload } = event;

  await persistEventLog(
    meta.orgId, meta.eventId, event.type, meta.sourceSystem, payload,
    undefined,
    [],
    [`retention_risk_flagged_${payload.atRiskCount}_athletes`]
  );

  setImmediate(() => refreshOrgIntelligenceState(meta.orgId).catch(() => {}));
}

// ─── Orchestrator Bootstrap ───────────────────────────────────────────────────

let _initialized = false;

export function initializeOrchestrator(): void {
  if (_initialized) return;
  _initialized = true;

  subscribeToEvent("athlete.readiness.updated", handleReadinessUpdated, "org-intelligence-orchestrator");
  subscribeToEvent("athlete.compliance.declined", handleComplianceDeclined, "org-intelligence-orchestrator");
  subscribeToEvent("athlete.risk.escalated", handleRiskEscalated, "org-intelligence-orchestrator");
  subscribeToEvent("athlete.session.missed", handleSessionMissed, "org-intelligence-orchestrator");
  subscribeToEvent("athlete.pain.reported", handlePainReported, "org-intelligence-orchestrator");
  subscribeToEvent("athlete.intervention.approved", handleInterventionApproved, "org-intelligence-orchestrator");
  subscribeToEvent("athlete.escalation.triggered", handleEscalationTriggered, "org-intelligence-orchestrator");
  subscribeToEvent("org.retention.risk.detected", handleRetentionRisk, "org-intelligence-orchestrator");

  console.log("[Orchestrator] Organization Intelligence Orchestrator initialized — 8 event subscriptions active");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getOrgEventTimeline(
  orgId: string,
  athleteUserId?: string,
  limit = 50
): Promise<OrganizationEventLog[]> {
  const conditions = athleteUserId
    ? and(eq(organizationEventLog.orgId, orgId), eq(organizationEventLog.athleteUserId, athleteUserId))
    : eq(organizationEventLog.orgId, orgId);

  return db.select()
    .from(organizationEventLog)
    .where(conditions)
    .orderBy(desc(organizationEventLog.createdAt))
    .limit(limit);
}

export async function getOrgIntelligenceState(orgId: string): Promise<OrganizationIntelligenceState | null> {
  const rows = await db.select()
    .from(organizationIntelligenceState)
    .where(eq(organizationIntelligenceState.orgId, orgId))
    .limit(1);
  return rows[0] ?? null;
}

export async function resolveEventLog(eventLogId: string): Promise<void> {
  await db.update(organizationEventLog)
    .set({ resolutionState: "resolved", resolvedAt: new Date() })
    .where(eq(organizationEventLog.id, eventLogId));
}
