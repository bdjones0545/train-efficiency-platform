import { db } from "../db";
import {
  eq, and, desc, lt, gte, sql, or, isNull
} from "drizzle-orm";
import {
  organizations,
  ceoHeartbeatRuns,
  jobExecutionLocks,
  agentOperatingTimeline,
  gmailAgentActions,
  agentCommunicationOutcomes,
  orgAutomationSettings,
  orgAiWorkforceSettings,
  teamTrainingProspects,
  teamTrainingDeals,
  agentAutonomyDecisions,
  workflowRuns,
  athleteMemoryProfiles,
  athleteRiskFlags,
  workoutCompletionLogs,
} from "@shared/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CeoPriority {
  id: string;
  priorityScore: number;
  category: string;
  action: string;
  reason: string;
  agentSource: string;
  requiresApproval: boolean;
  estimatedRevenueCents: number;
  entityType?: string;
  entityId?: string;
  urgency: "critical" | "high" | "medium" | "low";
  domain?: string;
}

export interface HeartbeatStatus {
  isRunning: boolean;
  isPaused: boolean;
  lastHeartbeatAt: Date | null;
  nextHeartbeatAt: Date | null;
  lastHeartbeatId: string | null;
  agentsCoordinated: number;
  errorsEncountered: number;
}

export interface ExecutionHealth {
  successfulActions: number;
  failedActions: number;
  skippedDuplicates: number;
  pendingApprovals: number;
  unresolvedErrors: number;
  autoExecuted: number;
}

// ─── In-memory heartbeat state ────────────────────────────────────────────────

let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let _lastRunAt: Date | null = null;
let _nextRunAt: Date | null = null;
let _currentRunId: string | null = null;
let _globalPaused = false;
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Timeline writer ─────────────────────────────────────────────────────────

export async function writeTimeline(entry: {
  orgId: string;
  heartbeatId?: string;
  agentName: string;
  systemName?: string;
  actionType: string;
  actionStatus?: string;
  priority?: number;
  communicationDomain?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  summary: string;
  decisionReason?: string;
  requiresApproval?: boolean;
  approvalStatus?: string;
  executedAt?: Date;
  outcomeStatus?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
}): Promise<string> {
  try {
    const [row] = await db.insert(agentOperatingTimeline).values({
      orgId: entry.orgId,
      heartbeatId: entry.heartbeatId ?? null,
      agentName: entry.agentName,
      systemName: entry.systemName ?? null,
      actionType: entry.actionType,
      actionStatus: entry.actionStatus ?? "completed",
      priority: entry.priority ?? 50,
      communicationDomain: entry.communicationDomain ?? null,
      relatedEntityType: entry.relatedEntityType ?? null,
      relatedEntityId: entry.relatedEntityId ?? null,
      summary: entry.summary,
      decisionReason: entry.decisionReason ?? null,
      requiresApproval: entry.requiresApproval ?? false,
      approvalStatus: entry.approvalStatus ?? null,
      executedAt: entry.executedAt ?? null,
      outcomeStatus: entry.outcomeStatus ?? null,
      errorMessage: entry.errorMessage ?? null,
      metadata: entry.metadata ?? null,
    }).returning();
    return row.id;
  } catch (err) {
    console.error("[Timeline] Failed to write entry:", err);
    return "";
  }
}

// ─── Job execution lock helpers ───────────────────────────────────────────────

export async function acquireJobLock(
  orgId: string,
  jobName: string,
  ttlMinutes = 60
): Promise<{ acquired: boolean; lockKey: string }> {
  const now = new Date();
  const lockKey = `${orgId}:${jobName}:${Math.floor(now.getTime() / (ttlMinutes * 60 * 1000))}`;
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  try {
    await db.insert(jobExecutionLocks).values({
      orgId,
      jobName,
      lockKey,
      expiresAt,
      status: "acquired",
    });
    return { acquired: true, lockKey };
  } catch {
    // Unique constraint violation = lock already held
    // Check if an existing lock has expired
    const expired = await db.select().from(jobExecutionLocks)
      .where(and(
        eq(jobExecutionLocks.lockKey, lockKey),
        lt(jobExecutionLocks.expiresAt, now),
      )).limit(1);

    if (expired.length > 0) {
      await db.update(jobExecutionLocks)
        .set({ status: "acquired", acquiredAt: now, expiresAt, releasedAt: null })
        .where(eq(jobExecutionLocks.lockKey, lockKey));
      return { acquired: true, lockKey };
    }
    return { acquired: false, lockKey };
  }
}

export async function releaseJobLock(lockKey: string): Promise<void> {
  await db.update(jobExecutionLocks)
    .set({ status: "released", releasedAt: new Date() })
    .where(eq(jobExecutionLocks.lockKey, lockKey))
    .catch(() => {});
}

// ─── Idempotency key helpers ──────────────────────────────────────────────────

export function buildIdempotencyKey(opts: {
  orgId: string;
  agentName: string;
  actionType: string;
  entityId: string;
  messageType?: string;
  dateBucket?: string;
}): string {
  const bucket = opts.dateBucket ?? new Date().toISOString().slice(0, 10);
  return `${opts.orgId}:${opts.agentName}:${opts.actionType}:${opts.entityId}:${opts.messageType ?? "default"}:${bucket}`;
}

export async function checkIdempotency(idempotencyKey: string): Promise<boolean> {
  const existing = await db.select({ id: agentOperatingTimeline.id })
    .from(agentOperatingTimeline)
    .where(sql`metadata->>'idempotencyKey' = ${idempotencyKey}`)
    .limit(1)
    .catch(() => []);
  return existing.length > 0;
}

// ─── Priority calculator ──────────────────────────────────────────────────────

function calcPriorityScore(opts: {
  revenuePotential: number; // 0-100
  urgency: number;          // 0-100
  risk: number;             // 0-100
  confidence: number;       // 0-100
  stageImportance: number;  // 0-100
  safetyRisk: number;       // 0-100 (higher = deprioritized)
}): number {
  return Math.round(
    (opts.revenuePotential * 0.35) +
    (opts.urgency * 0.25) +
    (opts.risk * 0.15) +
    (opts.confidence * 0.15) +
    (opts.stageImportance * 0.10) -
    (opts.safetyRisk * 0.20)
  );
}

// ─── Build priority list ──────────────────────────────────────────────────────

async function buildPriorityList(orgId: string, heartbeatId: string): Promise<CeoPriority[]> {
  const priorities: CeoPriority[] = [];

  try {
    // 1. Pending approvals in gmail_agent_actions
    const pendingApprovals = await db.select({
      id: gmailAgentActions.id,
      actionType: gmailAgentActions.actionType,
      riskLevel: gmailAgentActions.riskLevel,
      communicationDomain: gmailAgentActions.communicationDomain,
      createdAt: gmailAgentActions.createdAt,
    })
      .from(gmailAgentActions)
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        eq(gmailAgentActions.status, "proposed"),
      ))
      .limit(200)
      .catch(() => []);

    const lowRiskPending = pendingApprovals.filter(a => a.riskLevel === "low");
    const highRiskPending = pendingApprovals.filter(a => a.riskLevel === "high");

    if (lowRiskPending.length > 0) {
      const ageHours = lowRiskPending.reduce((max, a) => {
        const h = (Date.now() - new Date(a.createdAt!).getTime()) / 3600000;
        return Math.max(max, h);
      }, 0);
      priorities.push({
        id: `${orgId}:pending-low-risk-approvals`,
        priorityScore: calcPriorityScore({ revenuePotential: 60, urgency: 70, risk: 20, confidence: 85, stageImportance: 60, safetyRisk: 10 }),
        category: "approval_queue",
        action: `Approve ${lowRiskPending.length} low-risk follow-up email${lowRiskPending.length > 1 ? "s" : ""}`,
        reason: `${lowRiskPending.length} drafts waiting — oldest is ${Math.round(ageHours)}h ago`,
        agentSource: "Auto-Execution Engine",
        requiresApproval: false,
        estimatedRevenueCents: lowRiskPending.length * 250_00,
        entityType: "gmail_action",
        urgency: ageHours > 24 ? "high" : "medium",
      });
    }

    if (highRiskPending.length > 0) {
      priorities.push({
        id: `${orgId}:pending-high-risk-approvals`,
        priorityScore: calcPriorityScore({ revenuePotential: 70, urgency: 80, risk: 60, confidence: 70, stageImportance: 75, safetyRisk: 40 }),
        category: "approval_queue",
        action: `Review ${highRiskPending.length} high-risk pending action${highRiskPending.length > 1 ? "s" : ""}`,
        reason: "High-risk actions require manual review before execution",
        agentSource: "Autonomy Policy Engine",
        requiresApproval: true,
        estimatedRevenueCents: highRiskPending.length * 500_00,
        entityType: "gmail_action",
        urgency: "high",
      });
    }

    // 2. Stale leads (no contact in 48h)
    const cutoff48h = new Date(Date.now() - 48 * 3600 * 1000);
    const staleProspects = await db.select({ id: teamTrainingProspects.id, prospectName: teamTrainingProspects.prospectName })
      .from(teamTrainingProspects)
      .where(and(
        eq(teamTrainingProspects.orgId, orgId),
        or(
          isNull(teamTrainingProspects.lastContactedAt),
          lt(teamTrainingProspects.lastContactedAt, cutoff48h),
        ),
        eq(teamTrainingProspects.outreachStatus, "Needs Review"),
      ))
      .limit(100)
      .catch(() => []);

    if (staleProspects.length > 0) {
      priorities.push({
        id: `${orgId}:stale-leads`,
        priorityScore: calcPriorityScore({ revenuePotential: 75, urgency: 65, risk: 15, confidence: 70, stageImportance: 70, safetyRisk: 5 }),
        category: "lead_outreach",
        action: `Follow up with ${staleProspects.length} leads older than 24 hours`,
        reason: `${staleProspects.length} prospects have had no contact activity recently`,
        agentSource: "Domain Outreach Service",
        requiresApproval: true,
        estimatedRevenueCents: staleProspects.length * 1000_00,
        entityType: "prospect",
        urgency: staleProspects.length > 20 ? "high" : "medium",
      });
    }

    // 3. Failed automations in timeline
    const failedRecent = await db.select({ id: agentOperatingTimeline.id, agentName: agentOperatingTimeline.agentName, errorMessage: agentOperatingTimeline.errorMessage })
      .from(agentOperatingTimeline)
      .where(and(
        eq(agentOperatingTimeline.orgId, orgId),
        eq(agentOperatingTimeline.actionStatus, "failed"),
        gte(agentOperatingTimeline.createdAt, new Date(Date.now() - 6 * 3600 * 1000)),
      ))
      .limit(50)
      .catch(() => []);

    if (failedRecent.length > 0) {
      priorities.push({
        id: `${orgId}:failed-automations`,
        priorityScore: calcPriorityScore({ revenuePotential: 50, urgency: 85, risk: 70, confidence: 90, stageImportance: 80, safetyRisk: 0 }),
        category: "system_health",
        action: `Review ${failedRecent.length} failed automation${failedRecent.length > 1 ? "s" : ""} in the last 6 hours`,
        reason: `${failedRecent.length} agent actions failed and may need manual retry`,
        agentSource: "CEO Heartbeat",
        requiresApproval: false,
        estimatedRevenueCents: 0,
        entityType: "timeline_entry",
        urgency: failedRecent.length > 5 ? "critical" : "high",
      });
    }

    // 4. Deals needing follow-up (stuck in same stage > 7 days)
    const staleDeals = await db.select({ id: teamTrainingDeals.id, status: teamTrainingDeals.status, updatedAt: teamTrainingDeals.updatedAt })
      .from(teamTrainingDeals)
      .where(and(
        eq(teamTrainingDeals.organizationId, orgId),
        lt(teamTrainingDeals.updatedAt, new Date(Date.now() - 7 * 24 * 3600 * 1000)),
      ))
      .limit(50)
      .catch(() => []);

    if (staleDeals.length > 0) {
      priorities.push({
        id: `${orgId}:stale-deals`,
        priorityScore: calcPriorityScore({ revenuePotential: 90, urgency: 75, risk: 30, confidence: 80, stageImportance: 90, safetyRisk: 5 }),
        category: "revenue_pipeline",
        action: `Follow up on ${staleDeals.length} deal${staleDeals.length > 1 ? "s" : ""} stuck for 7+ days`,
        reason: `${staleDeals.length} active deal${staleDeals.length > 1 ? "s" : ""} with no stage movement in a week`,
        agentSource: "Revenue Agent",
        requiresApproval: false,
        estimatedRevenueCents: staleDeals.length * 5000_00,
        entityType: "deal",
        urgency: "high",
      });
    }

    // 5. Outcomes with no reply after 72h (need re-engagement)
    const noReplyOutcomes = await db.select({ id: agentCommunicationOutcomes.id, communicationDomain: agentCommunicationOutcomes.communicationDomain })
      .from(agentCommunicationOutcomes)
      .where(and(
        eq(agentCommunicationOutcomes.orgId, orgId),
        eq(agentCommunicationOutcomes.outcomeStatus, "sent"),
        lt(agentCommunicationOutcomes.sentAt, new Date(Date.now() - 72 * 3600 * 1000)),
      ))
      .limit(100)
      .catch(() => []);

    if (noReplyOutcomes.length > 0) {
      priorities.push({
        id: `${orgId}:no-reply-reengagement`,
        priorityScore: calcPriorityScore({ revenuePotential: 65, urgency: 55, risk: 10, confidence: 75, stageImportance: 60, safetyRisk: 5 }),
        category: "re_engagement",
        action: `Generate re-engagement for ${noReplyOutcomes.length} contacts with no reply after 72h`,
        reason: `${noReplyOutcomes.length} sent messages have received no reply in 3+ days`,
        agentSource: "Email Agent",
        requiresApproval: true,
        estimatedRevenueCents: noReplyOutcomes.length * 500_00,
        entityType: "outcome",
        urgency: "medium",
      });
    }

    // 6. PAIL — Athlete risk intelligence
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);

      // Athletes with recent high-severity risk flags
      const highRiskFlags = await db.select({
        athleteUserId: athleteRiskFlags.athleteUserId,
        severity: athleteRiskFlags.severity,
        title: athleteRiskFlags.title,
      })
        .from(athleteRiskFlags)
        .where(and(
          eq(athleteRiskFlags.orgId, orgId),
          gte(athleteRiskFlags.createdAt, sevenDaysAgo),
        ))
        .orderBy(desc(athleteRiskFlags.createdAt))
        .limit(50)
        .catch(() => []);

      const criticalRisk = highRiskFlags.filter(f => f.severity === "critical" || f.severity === "high");
      if (criticalRisk.length > 0) {
        const uniqueAthletes = new Set(criticalRisk.map(f => f.athleteUserId)).size;
        priorities.push({
          id: `${orgId}:athlete-risk-flags`,
          priorityScore: calcPriorityScore({ revenuePotential: 30, urgency: 90, risk: 80, confidence: 85, stageImportance: 95, safetyRisk: 85 }),
          category: "athlete_safety",
          action: `Review ${criticalRisk.length} high-severity athlete risk flag(s) across ${uniqueAthletes} athlete(s)`,
          reason: `${criticalRisk.length} critical/high risk flags raised in the last 7 days — immediate coach review needed`,
          agentSource: "PAIL Athlete Intelligence",
          requiresApproval: true,
          estimatedRevenueCents: 0,
          entityType: "athlete_risk_flag",
          urgency: "critical",
        });
      }

      // Athletes with stalled progress (no synthesis in 14+ days but active training)
      const staleMemoryProfiles = await db.select({
        athleteUserId: athleteMemoryProfiles.athleteUserId,
        sessionsAnalyzed: athleteMemoryProfiles.sessionsAnalyzed,
        lastSynthesizedAt: athleteMemoryProfiles.lastSynthesizedAt,
        exercisesThatStall: athleteMemoryProfiles.exercisesThatStall,
        recurringPainAreas: athleteMemoryProfiles.recurringPainAreas,
      })
        .from(athleteMemoryProfiles)
        .where(eq(athleteMemoryProfiles.orgId, orgId))
        .limit(100)
        .catch(() => []);

      const painAthletes = staleMemoryProfiles.filter(p =>
        (p.recurringPainAreas as string[] ?? []).length >= 2
      );

      if (painAthletes.length > 0) {
        priorities.push({
          id: `${orgId}:athlete-pain-risk`,
          priorityScore: calcPriorityScore({ revenuePotential: 20, urgency: 80, risk: 75, confidence: 70, stageImportance: 85, safetyRisk: 80 }),
          category: "athlete_safety",
          action: `${painAthletes.length} athlete(s) have 2+ recurring pain areas — review and adapt programs`,
          reason: `Persistent pain patterns detected in athlete memory profiles — programming adaptations recommended`,
          agentSource: "PAIL Athlete Intelligence",
          requiresApproval: true,
          estimatedRevenueCents: 0,
          entityType: "athlete_memory_profile",
          urgency: "high",
        });
      }

      const stallAthletes = staleMemoryProfiles.filter(p =>
        (p.exercisesThatStall as string[] ?? []).length >= 2
      );

      if (stallAthletes.length > 0) {
        priorities.push({
          id: `${orgId}:athlete-stalled-progress`,
          priorityScore: calcPriorityScore({ revenuePotential: 45, urgency: 50, risk: 30, confidence: 65, stageImportance: 70, safetyRisk: 10 }),
          category: "athlete_development",
          action: `${stallAthletes.length} athlete(s) have 2+ exercises with stalled progress — consider program variation`,
          reason: `Memory profiles show repeated exercise plateau patterns — programming diversity may improve outcomes`,
          agentSource: "PAIL Athlete Intelligence",
          requiresApproval: false,
          estimatedRevenueCents: 0,
          entityType: "athlete_memory_profile",
          urgency: "medium",
        });
      }

      // Stale memory profiles (no synthesis in 14+ days but session data exists)
      const needsResynthesis = staleMemoryProfiles.filter(p => {
        if (!p.lastSynthesizedAt) return false;
        return new Date(p.lastSynthesizedAt) < fourteenDaysAgo && (p.sessionsAnalyzed ?? 0) > 3;
      });

      if (needsResynthesis.length > 0) {
        priorities.push({
          id: `${orgId}:athlete-memory-stale`,
          priorityScore: calcPriorityScore({ revenuePotential: 15, urgency: 35, risk: 10, confidence: 90, stageImportance: 50, safetyRisk: 5 }),
          category: "athlete_development",
          action: `Refresh athlete intelligence for ${needsResynthesis.length} athlete(s) (memory >14 days stale)`,
          reason: `${needsResynthesis.length} athlete memory profiles have not been synthesized in 14+ days — run synthesis to keep intelligence current`,
          agentSource: "PAIL Athlete Intelligence",
          requiresApproval: false,
          estimatedRevenueCents: 0,
          entityType: "athlete_memory_profile",
          urgency: "low",
        });
      }
    } catch (err: any) {
      console.warn("[CEO Heartbeat] PAIL athlete priorities error:", err.message);
    }

  } catch (err) {
    console.error("[CEO Heartbeat] Priority build error:", err);
  }

  // Sort by priority score descending
  priorities.sort((a, b) => b.priorityScore - a.priorityScore);

  // Write priorities to timeline
  for (const p of priorities.slice(0, 10)) {
    await writeTimeline({
      orgId,
      heartbeatId,
      agentName: p.agentSource,
      systemName: "CEO Heartbeat",
      actionType: "recommendation",
      actionStatus: "pending",
      priority: p.priorityScore,
      communicationDomain: p.domain,
      relatedEntityType: p.entityType,
      summary: p.action,
      decisionReason: p.reason,
      requiresApproval: p.requiresApproval,
      metadata: {
        priorityScore: p.priorityScore,
        category: p.category,
        estimatedRevenueCents: p.estimatedRevenueCents,
        urgency: p.urgency,
      },
    }).catch(() => {});
  }

  return priorities;
}

// ─── Coordinate agent systems ─────────────────────────────────────────────────

async function coordinateAgents(orgId: string, heartbeatId: string): Promise<{
  agentsCoordinated: number;
  actionsEvaluated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let agentsCoordinated = 0;
  let actionsEvaluated = 0;

  // 1. Executive Agent — business intelligence
  try {
    const { runOrchestrator } = await import("../agents/executive-agent");
    await runOrchestrator(orgId);
    agentsCoordinated++;
    actionsEvaluated++;
    await writeTimeline({
      orgId, heartbeatId, agentName: "executive_agent",
      systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
      actionStatus: "completed", summary: "Executive Agent coordination complete",
    });
  } catch (err: any) {
    errors.push(`executive_agent: ${err.message}`);
    await writeTimeline({
      orgId, heartbeatId, agentName: "executive_agent",
      systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
      actionStatus: "failed", summary: "Executive Agent failed",
      errorMessage: err.message,
    });
  }

  // 2. Daily Operations Engine — operational brief
  try {
    const { generateDailyOperationsBrief } = await import("./daily-operations-engine");
    await generateDailyOperationsBrief(orgId);
    agentsCoordinated++;
    actionsEvaluated++;
    await writeTimeline({
      orgId, heartbeatId, agentName: "daily_operations_engine",
      systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
      actionStatus: "completed", summary: "Daily Operations brief refreshed",
    });
  } catch (err: any) {
    errors.push(`daily_ops: ${err.message}`);
  }

  // 3. Outcome Intelligence — recalculate rule effectiveness
  try {
    const { recalculateRuleEffectivenessForOrg } = await import("./outcome-intelligence-service");
    await recalculateRuleEffectivenessForOrg(orgId);
    agentsCoordinated++;
    actionsEvaluated++;
    await writeTimeline({
      orgId, heartbeatId, agentName: "outcome_intelligence_service",
      systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
      actionStatus: "completed", summary: "Outcome intelligence recalculated",
    });
  } catch (err: any) {
    errors.push(`outcome_intelligence: ${err.message}`);
  }

  // 4. Pending actions count
  try {
    const pending = await db.select({ id: gmailAgentActions.id })
      .from(gmailAgentActions)
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        eq(gmailAgentActions.status, "proposed"),
      ))
      .limit(500)
      .catch(() => []);
    actionsEvaluated += pending.length;
    agentsCoordinated++;
    await writeTimeline({
      orgId, heartbeatId, agentName: "gmail_agent",
      systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
      actionStatus: "completed",
      summary: `Gmail Agent: ${pending.length} actions in approval queue`,
      metadata: { pendingCount: pending.length },
    });
  } catch (err: any) {
    errors.push(`gmail_agent: ${err.message}`);
  }

  // 5. Workflow orchestrator status
  try {
    const activeWorkflows = await db.select({ id: workflowRuns.id, status: workflowRuns.status })
      .from(workflowRuns)
      .where(and(
        eq(workflowRuns.orgId, orgId),
        eq(workflowRuns.status, "running"),
      ))
      .limit(50)
      .catch(() => []);
    actionsEvaluated += activeWorkflows.length;
    agentsCoordinated++;
    await writeTimeline({
      orgId, heartbeatId, agentName: "workflow_orchestrator",
      systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
      actionStatus: "completed",
      summary: `Workflow Orchestrator: ${activeWorkflows.length} active workflow(s)`,
      metadata: { activeCount: activeWorkflows.length },
    });
  } catch (err: any) {
    errors.push(`workflow_orchestrator: ${err.message}`);
  }

  // 6. Software Improvement Agent — scan for engineering issues
  try {
    const { runSoftwareImprovementAgent, canRunSoftwareImprovementAgent } = await import("./software-improvement-agent");
    if (canRunSoftwareImprovementAgent(orgId)) {
      const result = await runSoftwareImprovementAgent(orgId);
      agentsCoordinated++;
      actionsEvaluated += result.tasksCreated;
      await writeTimeline({
        orgId, heartbeatId, agentName: "software_improvement_agent",
        systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
        actionStatus: "completed",
        summary: `Software Improvement Agent: ${result.tasksCreated} new task(s) created, ${result.tasksSkipped} skipped`,
        metadata: { tasksCreated: result.tasksCreated, tasksSkipped: result.tasksSkipped, errors: result.errors },
      });
    } else {
      await writeTimeline({
        orgId, heartbeatId, agentName: "software_improvement_agent",
        systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
        actionStatus: "skipped",
        summary: "Software Improvement Agent: cooldown active, skipped",
      });
    }
  } catch (err: any) {
    errors.push(`software_improvement_agent: ${err.message}`);
  }

  return { agentsCoordinated, actionsEvaluated, errors };
}

// ─── Main heartbeat cycle ─────────────────────────────────────────────────────

export async function runHeartbeatCycle(opts: {
  orgId: string;
  triggeredBy?: string;
}): Promise<{ success: boolean; runId: string; priorities: CeoPriority[]; errors: string[] }> {
  const { orgId, triggeredBy = "cron" } = opts;
  const startTime = Date.now();

  // Acquire lock (prevent duplicate runs within same 30-minute window)
  const { acquired, lockKey } = await acquireJobLock(orgId, "ceo_heartbeat", 28);
  if (!acquired && triggeredBy === "cron") {
    return { success: false, runId: "", priorities: [], errors: ["Lock already held — skipping duplicate run"] };
  }

  // Check global pause
  if (_globalPaused && triggeredBy === "cron") {
    await releaseJobLock(lockKey);
    return { success: false, runId: "", priorities: [], errors: ["CEO Heartbeat is paused"] };
  }

  // Check org-level emergency pause
  try {
    const settings = await db.select().from(orgAiWorkforceSettings)
      .where(eq(orgAiWorkforceSettings.orgId, orgId))
      .limit(1)
      .catch(() => []);
    if (settings[0]?.emergencyPauseEnabled) {
      await releaseJobLock(lockKey);
      return { success: false, runId: "", priorities: [], errors: ["Emergency pause is active for this org"] };
    }
  } catch {}

  // Create heartbeat run record
  const [run] = await db.insert(ceoHeartbeatRuns).values({
    orgId,
    triggeredBy,
    status: "running",
  }).returning();

  const heartbeatId = run.id;
  _currentRunId = heartbeatId;

  await writeTimeline({
    orgId, heartbeatId,
    agentName: "ceo_heartbeat",
    systemName: "CEO Heartbeat",
    actionType: "heartbeat_cycle",
    actionStatus: "completed",
    priority: 100,
    summary: `CEO Heartbeat cycle started (${triggeredBy})`,
    metadata: { triggeredBy },
  });

  const allErrors: string[] = [];
  let priorities: CeoPriority[] = [];
  let agentsCoordinated = 0;
  let actionsEvaluated = 0;
  let actionsAutoExecuted = 0;
  let actionsPendingApproval = 0;
  let prioritiesGenerated = 0;

  // Fire-and-forget: retrieve institutional memory before coordinating agents
  import("./obsidian-service").then(({ retrieveAgentContext, appendToNote, OBSIDIAN_FOLDERS }) => {
    retrieveAgentContext(`CEO Heartbeat priorities business performance org ${orgId}`, { orgId, limit: 10 })
      .then(ctx => {
        if (ctx.retrieved > 0) {
          console.log(`[CEO Heartbeat] Retrieved ${ctx.retrieved} Obsidian memory items for context`);
          const dateStr = new Date().toISOString().split("T")[0];
          appendToNote(
            OBSIDIAN_FOLDERS.dailyReports,
            dateStr,
            `\n## Memory Context Retrieved — CEO Heartbeat\n\n_${ctx.retrieved} items retrieved from vault_\n\n${ctx.contextString.slice(0, 600)}\n`,
          ).catch(() => {});
        }
      }).catch(() => {});
  }).catch(() => {});

  try {
    // Coordinate all agents
    const coordResult = await coordinateAgents(orgId, heartbeatId);
    agentsCoordinated = coordResult.agentsCoordinated;
    actionsEvaluated = coordResult.actionsEvaluated;
    allErrors.push(...coordResult.errors);

    // Build priority list
    priorities = await buildPriorityList(orgId, heartbeatId);
    prioritiesGenerated = priorities.length;

    // Count pending approvals
    const pendingCount = await db.select({ id: gmailAgentActions.id })
      .from(gmailAgentActions)
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        eq(gmailAgentActions.status, "proposed"),
      ))
      .limit(500)
      .catch(() => []);
    actionsPendingApproval = pendingCount.length;

    const durationMs = Date.now() - startTime;

    // Complete the run record
    await db.update(ceoHeartbeatRuns).set({
      status: "completed",
      agentsCoordinated,
      actionsEvaluated,
      actionsAutoExecuted,
      actionsPendingApproval,
      prioritiesGenerated,
      errorsEncountered: allErrors.length,
      durationMs,
      completedAt: new Date(),
      summaryJson: {
        topPriorities: priorities.slice(0, 5).map(p => ({ action: p.action, score: p.priorityScore })),
        agentsCoordinated,
        errors: allErrors,
      },
    }).where(eq(ceoHeartbeatRuns.id, heartbeatId));

    await writeTimeline({
      orgId, heartbeatId,
      agentName: "ceo_heartbeat",
      systemName: "CEO Heartbeat",
      actionType: "heartbeat_cycle",
      actionStatus: "completed",
      priority: 100,
      summary: `CEO Heartbeat cycle completed in ${durationMs}ms — ${agentsCoordinated} agents coordinated, ${prioritiesGenerated} priorities`,
      metadata: { durationMs, agentsCoordinated, prioritiesGenerated, errors: allErrors.length },
    });

    _lastRunAt = new Date();
    _nextRunAt = new Date(_lastRunAt.getTime() + HEARTBEAT_INTERVAL_MS);
  } catch (err: any) {
    allErrors.push(`heartbeat_main: ${err.message}`);
    await db.update(ceoHeartbeatRuns).set({
      status: "failed",
      errorsEncountered: allErrors.length,
      errorMessage: err.message,
      durationMs: Date.now() - startTime,
      completedAt: new Date(),
    }).where(eq(ceoHeartbeatRuns.id, heartbeatId)).catch(() => {});
  } finally {
    _currentRunId = null;
    await releaseJobLock(lockKey);
  }

  // Fire-and-forget: write heartbeat report to Obsidian organizational memory
  import("./obsidian-service").then(({ writeHeartbeatReport }) => {
    writeHeartbeatReport({
      orgId,
      runId: heartbeatId,
      priorities,
      agentsCoordinated,
      prioritiesGenerated,
      errors: allErrors,
      durationMs: Date.now() - startTime,
    }).catch(() => {});
  }).catch(() => {});

  return { success: allErrors.length === 0, runId: heartbeatId, priorities, errors: allErrors };
}

// ─── Run heartbeat for all orgs ───────────────────────────────────────────────

export async function runHeartbeatForAllOrgs(triggeredBy = "cron"): Promise<void> {
  try {
    const orgs = await db.select({ id: organizations.id }).from(organizations).limit(100);
    for (const org of orgs) {
      await runHeartbeatCycle({ orgId: org.id, triggeredBy }).catch((err) => {
        console.error(`[CEO Heartbeat] Error for org ${org.id}:`, err.message);
      });
    }
  } catch (err: any) {
    console.error("[CEO Heartbeat] Failed to load orgs:", err.message);
  }
}

// ─── Start / Stop heartbeat ───────────────────────────────────────────────────

export function startCeoHeartbeat(): void {
  if (_heartbeatInterval) return;
  _nextRunAt = new Date(Date.now() + HEARTBEAT_INTERVAL_MS);
  _heartbeatInterval = setInterval(async () => {
    if (_globalPaused) return;
    await runHeartbeatForAllOrgs("cron");
  }, HEARTBEAT_INTERVAL_MS);
  console.log("[CEO Heartbeat] Started — running every 30 minutes");
}

export function pauseCeoHeartbeat(): void {
  _globalPaused = true;
  console.log("[CEO Heartbeat] Paused");
}

export function resumeCeoHeartbeat(): void {
  _globalPaused = false;
  console.log("[CEO Heartbeat] Resumed");
}

export function getHeartbeatStatus(): HeartbeatStatus {
  return {
    isRunning: _currentRunId !== null,
    isPaused: _globalPaused,
    lastHeartbeatAt: _lastRunAt,
    nextHeartbeatAt: _nextRunAt,
    lastHeartbeatId: _currentRunId,
    agentsCoordinated: 0,
    errorsEncountered: 0,
  };
}

// ─── Get execution health for an org ─────────────────────────────────────────

export async function getExecutionHealth(orgId: string): Promise<ExecutionHealth> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  try {
    const entries = await db.select({
      actionStatus: agentOperatingTimeline.actionStatus,
      actionType: agentOperatingTimeline.actionType,
      requiresApproval: agentOperatingTimeline.requiresApproval,
      approvalStatus: agentOperatingTimeline.approvalStatus,
    })
      .from(agentOperatingTimeline)
      .where(and(
        eq(agentOperatingTimeline.orgId, orgId),
        gte(agentOperatingTimeline.createdAt, since),
      ))
      .limit(2000)
      .catch(() => []);

    return {
      successfulActions: entries.filter(e => e.actionStatus === "completed").length,
      failedActions: entries.filter(e => e.actionStatus === "failed").length,
      skippedDuplicates: entries.filter(e => e.actionType === "skipped_duplicate").length,
      pendingApprovals: entries.filter(e => e.approvalStatus === "pending" && e.requiresApproval).length,
      unresolvedErrors: entries.filter(e => e.actionStatus === "failed").length,
      autoExecuted: entries.filter(e => e.actionType === "auto_executed").length,
    };
  } catch {
    return { successfulActions: 0, failedActions: 0, skippedDuplicates: 0, pendingApprovals: 0, unresolvedErrors: 0, autoExecuted: 0 };
  }
}
