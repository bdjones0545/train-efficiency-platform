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
  walletTransactions,
  users,
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
    // Atomic takeover — single UPDATE prevents TOCTOU race between two concurrent workers
    // both seeing the same expired lock and both trying to claim it.
    const [taken] = await db
      .update(jobExecutionLocks)
      .set({ status: "acquired", acquiredAt: now, expiresAt, releasedAt: null })
      .where(and(
        eq(jobExecutionLocks.lockKey, lockKey),
        lt(jobExecutionLocks.expiresAt, now),
      ))
      .returning({ id: jobExecutionLocks.id });

    if (taken) return { acquired: true, lockKey };
    return { acquired: false, lockKey };
  }
}

export async function releaseJobLock(lockKey: string): Promise<void> {
  // DELETE the row so the same lock key can be re-acquired later in the same
  // time-bucket window.  An UPDATE to "released" kept the row alive and caused
  // the UNIQUE constraint to fire on the next manual run, blocking it forever
  // within the same 28-minute window.
  await db.delete(jobExecutionLocks)
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

  // ── 7. Athlete Onboarding Alerts ──────────────────────────────────────────
  try {
    const { computeOnboardingAlertsForOrg } = await import("./athlete-onboarding-alerts");
    const onboardingAlerts = await computeOnboardingAlertsForOrg(orgId);

    const criticalAlerts = onboardingAlerts.filter(a => a.severity === "critical");
    const highAlerts = onboardingAlerts.filter(a => a.severity === "high");
    const stuckAlerts = onboardingAlerts.filter(a => a.type === "onboarding_stuck");
    const stuckAthletes = [...new Set(stuckAlerts.map(a => a.athleteUserId))];

    if (criticalAlerts.length > 0) {
      const topNames = [...new Set(criticalAlerts.map(a => a.athleteName))].slice(0, 3).join(", ");
      priorities.push({
        id: `${orgId}:onboarding-critical`,
        priorityScore: calcPriorityScore({ revenuePotential: 70, urgency: 90, risk: 60, confidence: 95, stageImportance: 80, safetyRisk: 20 }),
        category: "athlete_onboarding",
        action: `${criticalAlerts.length} critical onboarding alert${criticalAlerts.length > 1 ? "s" : ""} — ${topNames}`,
        reason: "Critical onboarding blockers detected — athletes risk dropping off before completing their first session",
        agentSource: "Athlete Onboarding Monitor",
        requiresApproval: false,
        estimatedRevenueCents: criticalAlerts.length * 200_00,
        entityType: "athlete_onboarding_checklist",
        urgency: "critical",
      });
    } else if (highAlerts.length > 0) {
      const topNames = [...new Set(highAlerts.map(a => a.athleteName))].slice(0, 3).join(", ");
      priorities.push({
        id: `${orgId}:onboarding-high`,
        priorityScore: calcPriorityScore({ revenuePotential: 60, urgency: 75, risk: 40, confidence: 95, stageImportance: 70, safetyRisk: 10 }),
        category: "athlete_onboarding",
        action: `${highAlerts.length} high-priority onboarding item${highAlerts.length > 1 ? "s" : ""} need attention — ${topNames}`,
        reason: "Athletes are missing key onboarding steps — first session scheduling and program assignment should not be delayed",
        agentSource: "Athlete Onboarding Monitor",
        requiresApproval: false,
        estimatedRevenueCents: highAlerts.length * 100_00,
        entityType: "athlete_onboarding_checklist",
        urgency: "high",
      });
    }

    if (stuckAthletes.length > 0 && criticalAlerts.length === 0) {
      priorities.push({
        id: `${orgId}:onboarding-stuck`,
        priorityScore: calcPriorityScore({ revenuePotential: 55, urgency: 70, risk: 45, confidence: 90, stageImportance: 75, safetyRisk: 15 }),
        category: "athlete_onboarding",
        action: `${stuckAthletes.length} athlete${stuckAthletes.length > 1 ? "s" : ""} stuck in onboarding for 3+ days — review action center`,
        reason: "Long onboarding time increases athlete drop-off risk before their first training session",
        agentSource: "Athlete Onboarding Monitor",
        requiresApproval: false,
        estimatedRevenueCents: stuckAthletes.length * 150_00,
        entityType: "athlete_onboarding_checklist",
        urgency: stuckAthletes.length >= 3 ? "high" : "medium",
      });
    }
  } catch (err: any) {
    console.warn("[CEO Heartbeat] Onboarding alerts error:", err.message);
  }

  // ── 8. Guardian & Parent Engagement ───────────────────────────────────────
  try {
    const { computeGuardianMetricsForOrg } = await import("./guardian-admin-service");
    const gm = await computeGuardianMetricsForOrg(orgId);

    // Stalled invites — guardian was invited but has not accepted
    if (gm.pendingInvites >= 2) {
      priorities.push({
        id: `${orgId}:guardian-invites-pending`,
        priorityScore: calcPriorityScore({ revenuePotential: 30, urgency: 60, risk: 25, confidence: 90, stageImportance: 50, safetyRisk: 5 }),
        category: "athlete_onboarding",
        action: `${gm.pendingInvites} guardian invite${gm.pendingInvites > 1 ? "s" : ""} pending acceptance — follow up to engage families`,
        reason: "Guardian involvement correlates with athlete retention — pending invites indicate unengaged families",
        agentSource: "Guardian Onboarding Monitor",
        requiresApproval: false,
        estimatedRevenueCents: gm.pendingInvites * 50_00,
        entityType: "athlete_guardian_link",
        urgency: gm.pendingInvites >= 5 ? "high" : "medium",
      });
    }

    // Guardians who joined but have never been contacted
    if (gm.neverContacted >= 2) {
      priorities.push({
        id: `${orgId}:guardian-never-contacted`,
        priorityScore: calcPriorityScore({ revenuePotential: 25, urgency: 50, risk: 20, confidence: 85, stageImportance: 45, safetyRisk: 0 }),
        category: "athlete_onboarding",
        action: `${gm.neverContacted} active guardian${gm.neverContacted > 1 ? "s" : ""} have never been contacted — queue welcome drafts`,
        reason: "Families who haven't been welcomed are significantly less likely to renew athlete memberships",
        agentSource: "Guardian Onboarding Monitor",
        requiresApproval: false,
        estimatedRevenueCents: gm.neverContacted * 75_00,
        entityType: "athlete_guardian_link",
        urgency: "medium",
      });
    }
  } catch (err: any) {
    console.warn("[CEO Heartbeat] Guardian metrics error:", err.message);
  }

  // ── 9. Billing & Waiver Readiness ─────────────────────────────────────────
  try {
    const { computeOrgReadinessSummary } = await import("./readiness-service");
    const rs = await computeOrgReadinessSummary(orgId);

    if (rs.needsBilling >= 3) {
      priorities.push({
        id: `${orgId}:readiness-billing-blocked`,
        priorityScore: calcPriorityScore({ revenuePotential: 80, urgency: 85, risk: 70, confidence: 95, stageImportance: 75, safetyRisk: 0 }),
        category: "athlete_onboarding",
        action: `${rs.needsBilling} athlete${rs.needsBilling > 1 ? "s are" : " is"} fully onboarded but cannot train — payment setup is missing`,
        reason: "Athletes blocked by missing billing represent direct revenue at risk. Each uncollected session is a potential loss.",
        agentSource: "Billing Readiness Monitor",
        requiresApproval: false,
        estimatedRevenueCents: rs.estimatedRevenueAtRiskCents,
        entityType: "athlete_onboarding_checklist",
        urgency: rs.needsBilling >= 7 ? "high" : "medium",
      });
    }

    if (rs.needsWaiver >= 2) {
      priorities.push({
        id: `${orgId}:readiness-waiver-blocked`,
        priorityScore: calcPriorityScore({ revenuePotential: 40, urgency: 75, risk: 80, confidence: 95, stageImportance: 60, safetyRisk: 30 }),
        category: "athlete_onboarding",
        action: `${rs.needsWaiver} athlete${rs.needsWaiver > 1 ? "s have" : " has"} incomplete waivers — legal requirements not yet satisfied`,
        reason: "Training athletes without signed waivers creates liability exposure. Resolve before first session.",
        agentSource: "Waiver Compliance Monitor",
        requiresApproval: false,
        estimatedRevenueCents: 0,
        entityType: "athlete_onboarding_checklist",
        urgency: "high",
      });
    }

    if (rs.averageReadinessScore < 55 && rs.totalAthletes >= 3) {
      priorities.push({
        id: `${orgId}:readiness-low-average`,
        priorityScore: calcPriorityScore({ revenuePotential: 50, urgency: 60, risk: 50, confidence: 85, stageImportance: 55, safetyRisk: 0 }),
        category: "athlete_onboarding",
        action: `Average onboarding readiness score is ${rs.averageReadinessScore}/100 across ${rs.totalAthletes} athletes — pipeline has blockers`,
        reason: "Low average readiness means most athletes are missing key steps. Review the onboarding dashboard to resolve blockers.",
        agentSource: "Operational Readiness Monitor",
        requiresApproval: false,
        estimatedRevenueCents: rs.operationallyBlocked * 100_00,
        entityType: "athlete_onboarding_checklist",
        urgency: "medium",
      });
    }
  } catch (err: any) {
    console.warn("[CEO Heartbeat] Readiness metrics error:", err.message);
  }

  // ── Inject top Hermes learnings as advisory priorities ────────────────────
  try {
    const { getTopLearningsForContext } = await import("./hermes-learning-service");
    const topLearnings = await getTopLearningsForContext(orgId, 5);
    const highValueLearnings = topLearnings.filter((l) => l.occurrenceCount >= 2 || l.confidenceScore >= 88);
    for (const learning of highValueLearnings.slice(0, 3)) {
      priorities.push({
        id: `hermes-learning-${learning.id}`,
        priorityScore: Math.min(75, 40 + learning.occurrenceCount * 5 + Math.floor(learning.confidenceScore / 10)),
        category: "hermes_insight",
        action: learning.learning.slice(0, 200),
        reason: `Hermes institutional memory (${learning.domain}) — observed ${learning.occurrenceCount}× with ${learning.confidenceScore}% confidence`,
        agentSource: "Hermes Learning Engine",
        requiresApproval: false,
        estimatedRevenueCents: 0,
        urgency: learning.confidenceScore >= 90 ? "medium" : "low",
        domain: learning.domain,
      });
    }
  } catch {}

  // ── AgentMail Performance Signal ──────────────────────────────────────────
  try {
    const { getAgentmailHeartbeatSignal, generateAgentmailAttentionItems } = await import("./agentmail-analytics-service");
    const signal = await getAgentmailHeartbeatSignal(orgId);
    if (signal) {
      const score = signal.hasIssues
        ? calcPriorityScore({ revenuePotential: 20, urgency: 50, risk: 30, confidence: 85, stageImportance: 40, safetyRisk: 0 })
        : calcPriorityScore({ revenuePotential: 10, urgency: 20, risk: 5, confidence: 85, stageImportance: 30, safetyRisk: 0 });
      priorities.push({
        id: `${orgId}:agentmail-performance`,
        priorityScore: score,
        category: "agentmail_performance",
        action: signal.summary,
        reason: signal.details.join(" | "),
        agentSource: "AgentMail Analytics",
        requiresApproval: false,
        estimatedRevenueCents: 0,
        urgency: signal.hasIssues ? "medium" : "low",
      });
    }
    // Generate attention items async — don't block heartbeat
    generateAgentmailAttentionItems(orgId).catch(() => {});
  } catch {}

  // ── AgentMail Outcome Correlation Signal ───────────────────────────────────
  try {
    const { getAgentmailOutcomeHeartbeatSignal } = await import("./agentmail-outcome-correlation-service");
    const outcomeSignal = await getAgentmailOutcomeHeartbeatSignal(orgId);
    if (outcomeSignal) {
      priorities.push({
        id: `${orgId}:agentmail-outcomes`,
        priorityScore: outcomeSignal.hasIssues
          ? calcPriorityScore({ revenuePotential: 50, urgency: 60, risk: 40, confidence: 90, stageImportance: 55, safetyRisk: 0 })
          : calcPriorityScore({ revenuePotential: 30, urgency: 25, risk: 5, confidence: 85, stageImportance: 35, safetyRisk: 0 }),
        category: "agentmail_outcomes",
        action: outcomeSignal.summary,
        reason: outcomeSignal.details.join(" | "),
        agentSource: "AgentMail Outcome Correlation",
        requiresApproval: false,
        estimatedRevenueCents: 0,
        urgency: outcomeSignal.hasIssues ? "medium" : "low",
      });
    }
  } catch {}

  // ── AgentMail Lead-Level Closed Loop Signal ────────────────────────────────
  try {
    const { getAgentmailLeadLevelSignal, getAgentmailPriorContextAnalytics } = await import("./agentmail-prior-contact-context-service");
    const [llSignal, analytics] = await Promise.all([
      getAgentmailLeadLevelSignal(orgId),
      getAgentmailPriorContextAnalytics(orgId).catch(() => null),
    ]);

    const issueCount = llSignal.noReplyAfter3Emails + llSignal.repliedButNoEval + llSignal.convertedStillReceivingLeadEmails;
    const details: string[] = [];
    if (llSignal.noReplyAfter3Emails > 0) details.push(`${llSignal.noReplyAfter3Emails} lead${llSignal.noReplyAfter3Emails === 1 ? "" : "s"} received 3+ emails without reply — consider changing follow-up strategy`);
    if (llSignal.repliedButNoEval > 0) details.push(`${llSignal.repliedButNoEval} lead${llSignal.repliedButNoEval === 1 ? "" : "s"} replied but still have no evaluation scheduled`);
    if (llSignal.convertedStillReceivingLeadEmails > 0) details.push(`${llSignal.convertedStillReceivingLeadEmails} converted athlete${llSignal.convertedStillReceivingLeadEmails === 1 ? "" : "s"} still receiving lead-style emails — review AgentMail domain routing`);

    // Phase H: add comparison data to signal
    if (analytics && analytics.totals.draftsWithPriorContext > 0) {
      const { totals } = analytics;
      const rWith = totals.replyRateWithContext;
      const rWithout = totals.replyRateWithoutContext;
      if (rWith !== null && rWithout !== null) {
        const diff = rWith - rWithout;
        if (Math.abs(diff) >= 5) {
          if (diff > 0) {
            details.push(`Prior-context drafts have a ${rWith}% associated reply rate vs ${rWithout}% baseline over tracked drafts`);
          } else {
            // underperforming — find which domains
            const underperformingDomains = analytics.byDomain
              .filter((d) => d.dataConfidence === "medium" || d.dataConfidence === "high")
              .filter((d) => d.replyRateWithContext !== null && d.replyRateWithoutContext !== null && (d.replyRateWithContext ?? 0) < (d.replyRateWithoutContext ?? 0) - 5)
              .map((d) => d.domain.replace(/_/g, " "));
            if (underperformingDomains.length > 0) {
              details.push(`Prior-context drafts still underperform baseline in: ${underperformingDomains.join(", ")} — review follow-up strategy`);
            } else {
              details.push(`Prior-context drafts show ${rWith}% reply rate vs ${rWithout}% baseline — monitoring`);
            }
          }
        }
      }
      if (totals.draftsWithPriorContext >= 10 && rWith === null) {
        details.push(`${totals.draftsWithPriorContext} prior-context drafts recorded but no outcome data yet — outcomes may not be flowing through correctly`);
      }
    }

    if (details.length > 0) {
      priorities.push({
        id: `${orgId}:agentmail-lead-loop`,
        priorityScore: calcPriorityScore({ revenuePotential: 50, urgency: issueCount > 0 ? 55 : 30, risk: 30, confidence: 80, stageImportance: 55, safetyRisk: 0 }),
        category: "agentmail_lead_loop",
        action: `AgentMail Lead Loop: ${details[0]}`,
        reason: details.join(" | "),
        agentSource: "AgentMail Relationship Engine",
        requiresApproval: false,
        estimatedRevenueCents: 0,
        urgency: issueCount > 0 ? "medium" : "low",
      });
    }

    // Attention inbox items (Phase H) — insert-or-skip pattern (source_id has no unique index)
    if (analytics) {
      // Item 1: underperforming domain with high-confidence data
      const underperformingDomain = analytics.byDomain.find(
        (d) => d.dataConfidence === "high" &&
               d.replyRateWithContext !== null && d.replyRateWithoutContext !== null &&
               (d.replyRateWithContext ?? 0) < (d.replyRateWithoutContext ?? 0) - 5
      );
      if (underperformingDomain) {
        try {
          const stableKey = `agentmail-ctx-underperform-${orgId}-${underperformingDomain.domain}`;
          const existing = await db.execute(sql`SELECT id FROM attention_items WHERE source_id = ${stableKey} LIMIT 1`);
          const rows = Array.isArray(existing) ? existing : (existing as any).rows ?? [];
          if (!rows.length) {
            await db.execute(sql`
              INSERT INTO attention_items (id, org_id, title, body, source, source_id, status, severity, urgency, business_impact, confidence, created_at, updated_at)
              VALUES (gen_random_uuid(), ${orgId},
                ${'Prior-context drafts underperform baseline in ' + underperformingDomain.domain.replace(/_/g, " ")},
                ${'Reply rate with prior context: ' + (underperformingDomain.replyRateWithContext ?? 0) + '% vs baseline ' + (underperformingDomain.replyRateWithoutContext ?? 0) + '% (' + underperformingDomain.withContextCount + ' drafts — high confidence). Review follow-up strategy for this domain.'},
                'agentmail_prior_context', ${stableKey}, 'active', 55, 55, 55, 0.8, NOW(), NOW())
            `).catch(() => {});
          }
        } catch {}
      }

      // Item 2: repeated no-reply at threshold
      if (llSignal.noReplyAfter3Emails >= 5) {
        try {
          const stableKey = `agentmail-lead-3plus-noreply-${orgId}`;
          const existing = await db.execute(sql`SELECT id FROM attention_items WHERE source_id = ${stableKey} AND status = 'active' LIMIT 1`);
          const rows = Array.isArray(existing) ? existing : (existing as any).rows ?? [];
          if (!rows.length) {
            await db.execute(sql`
              INSERT INTO attention_items (id, org_id, title, body, source, source_id, status, severity, urgency, business_impact, confidence, created_at, updated_at)
              VALUES (gen_random_uuid(), ${orgId},
                ${`${llSignal.noReplyAfter3Emails} leads contacted 3+ times with no reply`},
                'These leads have received multiple AgentMail outreach emails without responding. Consider pausing or changing the approach for these recipients.',
                'agentmail_prior_context', ${stableKey}, 'active', 55, 55, 50, 0.85, NOW(), NOW())
            `).catch(() => {});
          }
        } catch {}
      }
    }
  } catch {}

  // ── AgentMail Learning Performance Signal ──────────────────────────────────
  try {
    const { getAgentmailOutcomeLearningSignal } = await import("./agentmail-outcome-correlation-service");
    const learningSignal = await getAgentmailOutcomeLearningSignal(orgId);
    if (learningSignal) {
      priorities.push({
        id: `${orgId}:agentmail-learning-perf`,
        priorityScore: learningSignal.hasIssues
          ? calcPriorityScore({ revenuePotential: 40, urgency: 50, risk: 35, confidence: 85, stageImportance: 50, safetyRisk: 0 })
          : calcPriorityScore({ revenuePotential: 20, urgency: 20, risk: 5, confidence: 80, stageImportance: 30, safetyRisk: 0 }),
        category: "agentmail_learning",
        action: learningSignal.summary,
        reason: learningSignal.details.join(" | "),
        agentSource: "AgentMail Learning Engine",
        requiresApproval: false,
        estimatedRevenueCents: 0,
        urgency: learningSignal.hasIssues ? "medium" : "low",
      });
    }
  } catch {}

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

  // 6. Hermes Intelligence Engine — analyze signals and generate recommendations
  try {
    const { runHermesIntelligenceCycle } = await import("./hermes-recommendation-engine");
    const hermesResult = await runHermesIntelligenceCycle(orgId, heartbeatId);
    agentsCoordinated++;
    actionsEvaluated += hermesResult.recommendationsGenerated;
    await writeTimeline({
      orgId, heartbeatId, agentName: "hermes_recommendation_engine",
      systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
      actionStatus: "completed",
      summary: `Hermes: ${hermesResult.signalsProcessed} signals → ${hermesResult.recommendationsGenerated} recommendation(s) (${hermesResult.queuedForReview} queued, avg confidence ${Math.round(hermesResult.confidenceAverage * 100)}%)`,
      metadata: {
        runId: hermesResult.runId,
        signalsProcessed: hermesResult.signalsProcessed,
        recommendationsGenerated: hermesResult.recommendationsGenerated,
        queuedForReview: hermesResult.queuedForReview,
        confidenceAverage: hermesResult.confidenceAverage,
        executionTimeMs: hermesResult.executionTimeMs,
        byType: hermesResult.byType,
      },
    });
  } catch (err: any) {
    errors.push(`hermes_engine: ${err.message}`);
    await writeTimeline({
      orgId, heartbeatId, agentName: "hermes_recommendation_engine",
      systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
      actionStatus: "failed", summary: "Hermes Intelligence Engine failed",
      errorMessage: err.message,
    });
  }

  // 7. Department Registry — loop through all registered departments
  try {
    const { departmentRegistry } = await import("./department-registry");
    const deptResult = await departmentRegistry.runAllHeartbeatReviews(orgId);
    agentsCoordinated += deptResult.departmentsRun;
    actionsEvaluated  += deptResult.totalChecks;
    errors.push(...deptResult.errors);

    for (const result of deptResult.results) {
      await writeTimeline({
        orgId, heartbeatId,
        agentName: result.departmentId,
        systemName: "CEO Heartbeat",
        actionType: "heartbeat_cycle",
        actionStatus: result.error ? "failed" : "completed",
        summary: result.error
          ? `${result.departmentName}: coordinator failed — ${result.error}`
          : `${result.departmentName}: ${result.checksRun} checks (${result.checksPassed} passed), ${result.alertsCreated} alert(s)`,
        errorMessage: result.error,
        metadata: {
          checksRun:    result.checksRun,
          checksPassed: result.checksPassed,
          alertsCreated: result.alertsCreated,
          bestAction:   result.bestAction?.title ?? null,
          department:   result.departmentId,
        },
      });
    }
  } catch (err: any) {
    errors.push(`department_registry: ${err.message}`);
    await writeTimeline({
      orgId, heartbeatId, agentName: "department_registry",
      systemName: "CEO Heartbeat", actionType: "heartbeat_cycle",
      actionStatus: "failed", summary: "Department Registry loop failed",
      errorMessage: err.message,
    });
  }

  // 7. Software Improvement Agent — scan for engineering issues
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

  // 8. Gmail Sync — trigger if last sync is missing or older than 60 minutes
  try {
    const { runGmailSyncIfStale } = await import("./gmail-sync-state");
    const syncResult = await runGmailSyncIfStale(orgId, heartbeatId);
    agentsCoordinated++;
    await writeTimeline({
      orgId, heartbeatId, agentName: "gmail_sync_agent",
      systemName: "CEO Heartbeat", actionType: "gmail_sync_check",
      actionStatus: syncResult.triggered ? "completed" : "skipped",
      summary: syncResult.triggered
        ? `Gmail Sync (heartbeat): triggered — ${syncResult.reason}`
        : `Gmail Sync (heartbeat): skipped — ${syncResult.reason}`,
    });
  } catch (err: any) {
    errors.push(`gmail_sync: ${err.message}`);
  }

  // 9. Ledger Drift Check — validate wallet balance integrity every cycle
  try {
    const driftResult = await runLedgerDriftCheck(orgId);
    agentsCoordinated++;
    const driftOk = driftResult.drifters === 0;
    await writeTimeline({
      orgId, heartbeatId, agentName: "ledger_integrity_agent",
      systemName: "CEO Heartbeat", actionType: "ledger_drift_check",
      actionStatus: driftOk ? "completed" : "failed",
      priority: driftOk ? 20 : 95,
      summary: driftOk
        ? `Ledger integrity OK — ${driftResult.checked} wallet(s) checked, no drift`
        : `LEDGER DRIFT DETECTED: ${driftResult.drifters}/${driftResult.checked} wallet(s) mismatched (max drift ${driftResult.maxDriftCents}¢)`,
      metadata: { drifters: driftResult.drifters, checked: driftResult.checked, maxDriftCents: driftResult.maxDriftCents },
    });
    if (!driftOk) {
      errors.push(`ledger_drift: ${driftResult.drifters} user(s) have balance mismatch`);
    }
  } catch (err: any) {
    errors.push(`ledger_drift: ${err.message}`);
  }

  return { agentsCoordinated, actionsEvaluated, errors };
}

// ─── Ledger drift check ───────────────────────────────────────────────────────

export async function runLedgerDriftCheck(orgId: string): Promise<{
  drifters: number;
  checked: number;
  maxDriftCents: number;
  drifterDetails: { userId: string; storedCents: number; computedCents: number; driftCents: number }[];
}> {
  const result = await db.execute(sql`
    SELECT u.id, u.balance_cents, COALESCE(SUM(wt.amount_cents), 0)::bigint AS computed
    FROM users u
    JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN wallet_transactions wt ON wt.user_id = u.id
    WHERE up.organization_id = ${orgId}
    GROUP BY u.id, u.balance_cents
  `);
  const rows: any[] = Array.isArray(result) ? result : (result as any).rows ?? [];
  const drifterDetails = rows
    .filter(r => Number(r.balance_cents ?? 0) !== Number(r.computed ?? 0))
    .map(r => ({
      userId: r.id,
      storedCents: Number(r.balance_cents ?? 0),
      computedCents: Number(r.computed ?? 0),
      driftCents: Number(r.balance_cents ?? 0) - Number(r.computed ?? 0),
    }));
  const maxDriftCents = drifterDetails.reduce((max, d) => Math.max(max, Math.abs(d.driftCents)), 0);

  // Write each new drifter to financial_event_failures (skip if already pending for this user)
  for (const d of drifterDetails) {
    await db.execute(sql`
      INSERT INTO financial_event_failures (source_type, payload, status, failure_message)
      SELECT
        'ledger_drift',
        ${JSON.stringify({ userId: d.userId, storedCents: d.storedCents, computedCents: d.computedCents, driftCents: d.driftCents })}::jsonb,
        'pending',
        ${'Ledger drift: stored=' + d.storedCents + '¢ computed=' + d.computedCents + '¢ delta=' + d.driftCents + '¢'}
      WHERE NOT EXISTS (
        SELECT 1 FROM financial_event_failures
        WHERE source_type = 'ledger_drift'
          AND (payload->>'userId') = ${d.userId}
          AND status = 'pending'
      )
    `).catch(() => {});
  }

  return { drifters: drifterDetails.length, checked: rows.length, maxDriftCents, drifterDetails };
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
  if (!acquired) {
    // Block ALL concurrent runs — cron, manual, and startup — to prevent duplicate AI actions,
    // priority spam, and recommendation duplication.
    const trigger = triggeredBy ?? "cron";
    // Surface lock contention as an operational signal in the timeline
    writeTimeline({
      orgId,
      agentName: "ceo_heartbeat",
      systemName: "CEO Heartbeat",
      actionType: "lock_contention",
      actionStatus: "blocked",
      priority: 75,
      summary: `Heartbeat blocked — lock already held (trigger: ${trigger})`,
      metadata: { triggeredBy: trigger, lockKey },
    }).catch(() => {});
    return { success: false, runId: "", priorities: [], errors: [`Lock already held — skipping duplicate ${trigger} run`] };
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
  import("./obsidian-service").then(({ retrieveAgentContext, OBSIDIAN_FOLDERS }) => {
    retrieveAgentContext(`CEO Heartbeat priorities business performance org ${orgId}`, { orgId, limit: 10 })
      .then(async ctx => {
        if (ctx.retrieved > 0) {
          console.log(`[CEO Heartbeat] Retrieved ${ctx.retrieved} Obsidian memory items for context`);
          const dateStr = new Date().toISOString().split("T")[0];
          const { trySyncNow } = await import("./obsidian-sync-service");
          await trySyncNow({
            idempotencyKey: `heartbeat-ctx-${orgId.slice(0, 8)}-${dateStr}`,
            noteAction: "append",
            folder: OBSIDIAN_FOLDERS.dailyReports,
            title: dateStr,
            content: `\n## Memory Context Retrieved — CEO Heartbeat\n\n_${ctx.retrieved} items retrieved from vault_\n\n${ctx.contextString.slice(0, 600)}\n`,
            contextLabel: `CEO Heartbeat memory context ${dateStr}`,
          });
        }
      }).catch(() => {});
  }).catch(() => {});

  // Kevin context enrichment (Phase 3) — non-blocking, fail-open
  void (async () => {
    try {
      const { requestKevinContext, formatKevinContextForPrompt } = await import("./kevin-context-service");
      const ctx = await requestKevinContext({
        orgId,
        agentType: "ceo_heartbeat",
        workflow: "heartbeat_cycle",
        question: "What historical patterns, prior incidents, or architectural context should inform this heartbeat cycle?",
        capability: "ceo_heartbeat_enrichment",
        traceId: heartbeatId,
        depth: 0,
      });
      if (ctx.available && ctx.status === "success") {
        await db.execute(sql`
          UPDATE ceo_heartbeat_runs
          SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{kevin_context}',
            ${JSON.stringify({
              available: true,
              summary: ctx.summary.slice(0, 500),
              memoriesCount: ctx.memories.length,
              confidence: ctx.confidence ?? null,
              contextRequestId: ctx.contextRequestId,
            })}::jsonb
          )
          WHERE id = ${heartbeatId}
        `).catch(() => {});
      }
    } catch {}
  })();

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

  // Fire-and-forget: capture structured learning for Organizational Memory
  import("./hermes-learning-service").then(({ recordHeartbeatLearning }) => {
    recordHeartbeatLearning({
      orgId,
      agentsCoordinated,
      prioritiesGenerated,
      errors: allErrors,
      durationMs: Date.now() - startTime,
      runId: heartbeatId,
    }).catch(() => {});
  }).catch(() => {});

  // Fire-and-forget: capture decision journal entry for this heartbeat cycle
  import("./decision-journal-service").then(({ recordHeartbeatDecision }) => {
    const topPriority = priorities?.[0]?.title ?? priorities?.[0]?.action ?? undefined;
    recordHeartbeatDecision({
      orgId,
      agentsCoordinated,
      prioritiesGenerated,
      errors: allErrors,
      durationMs: Date.now() - startTime,
      runId: heartbeatId,
      topPriority,
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

// ─── Global-pause sentinel ────────────────────────────────────────────────────
// Stored in job_execution_locks so it survives server restarts/deploys.
// orgId="system", lockKey is fixed — never expires (year 2099).
const GLOBAL_PAUSE_LOCK_KEY = "system:heartbeat_global_pause:v1";

async function _persistGlobalPause(): Promise<void> {
  try {
    await db.insert(jobExecutionLocks).values({
      orgId: "system",
      jobName: "heartbeat_global_pause",
      lockKey: GLOBAL_PAUSE_LOCK_KEY,
      expiresAt: new Date("2099-12-31T00:00:00Z"),
      status: "acquired",
    });
  } catch {
    // Unique constraint = row already exists — that's fine
  }
}

async function _clearGlobalPause(): Promise<void> {
  await db.delete(jobExecutionLocks)
    .where(eq(jobExecutionLocks.lockKey, GLOBAL_PAUSE_LOCK_KEY))
    .catch(() => {});
}

export function startCeoHeartbeat(): void {
  if (_heartbeatInterval) return;

  // One-time cleanup: delete any lingering "released" lock rows left over from
  // the old UPDATE-to-released strategy (before the fix to DELETE on release).
  // These rows blocked manual runs within the same 28-minute time window.
  db.execute(sql`DELETE FROM job_execution_locks WHERE status = 'released'`).catch(() => {});

  // ── Async init: restore persisted state from DB without blocking startup ──
  (async () => {
    try {
      // 1. Restore global-pause state from DB sentinel row
      const [pauseRow] = await db.select({ id: jobExecutionLocks.id })
        .from(jobExecutionLocks)
        .where(eq(jobExecutionLocks.lockKey, GLOBAL_PAUSE_LOCK_KEY))
        .limit(1)
        .catch(() => [] as any[]);
      if (pauseRow) {
        _globalPaused = true;
        console.log("[CEO Heartbeat] Restored paused state from DB");
      }

      // 2. Seed _nextRunAt from latest DB heartbeat run so the UI shows an
      //    accurate "Next Heartbeat" time instead of "now + 30 min" on every
      //    deploy/restart.
      const [latestRun] = await db.select({ startedAt: ceoHeartbeatRuns.startedAt })
        .from(ceoHeartbeatRuns)
        .orderBy(desc(ceoHeartbeatRuns.startedAt))
        .limit(1)
        .catch(() => [] as any[]);
      if (latestRun?.startedAt) {
        const lastTime = new Date(latestRun.startedAt).getTime();
        const proposedNext = lastTime + HEARTBEAT_INTERVAL_MS;
        if (proposedNext > Date.now()) {
          _nextRunAt = new Date(proposedNext);
          console.log(`[CEO Heartbeat] Seeded nextRunAt from DB: ${_nextRunAt.toISOString()}`);
        }
      }
    } catch {
      // Non-fatal — in-memory defaults are safe fallbacks
    }
  })();

  _nextRunAt = _nextRunAt ?? new Date(Date.now() + HEARTBEAT_INTERVAL_MS);
  _heartbeatInterval = setInterval(async () => {
    if (_globalPaused) return;
    await runHeartbeatForAllOrgs("cron");
  }, HEARTBEAT_INTERVAL_MS);
  console.log("[CEO Heartbeat] Started — running every 30 minutes");
}

export function pauseCeoHeartbeat(): void {
  _globalPaused = true;
  console.log("[CEO Heartbeat] Paused");
  // Persist to DB so restart/deploy doesn't clear the paused state
  _persistGlobalPause().catch(() => {});
}

export function resumeCeoHeartbeat(): void {
  _globalPaused = false;
  console.log("[CEO Heartbeat] Resumed");
  // Remove the DB sentinel so restart sees it as unpaused
  _clearGlobalPause().catch(() => {});
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
