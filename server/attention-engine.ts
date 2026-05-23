/**
 * Unified Attention Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Single prioritization layer for all platform alerts, recommendations,
 * approvals, workflows, AI suggestions, and operational priorities.
 *
 * Levels:   critical → important → suggested → informational
 * Score:    (severity*0.30) + (urgency*0.40) + (businessImpact*0.20) + (confidence*100*0.10)
 * Lifecycle: active → snoozed | dismissed | completed | escalated
 */

import { db } from "./db";
import {
  attentionItems,
  agentToolCalls,
  workflowRuns,
  agentRecommendations,
  revenueAgentActions,
  teamTrainingDeals,
  bookings,
  userProfiles,
  coachProfiles,
  outreachDrafts,
  financialEventFailures,
  userSubscriptions,
  type AttentionItem,
  type InsertAttentionItem,
} from "@shared/schema";
import { eq, and, or, lt, gt, sql, inArray, isNotNull, ne, gte, lte } from "drizzle-orm";
import { computeTriggerAlerts } from "./email-agent/trigger-alerts";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scoring
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function computeScore(item: Pick<AttentionItem, "severity" | "urgency" | "businessImpact" | "confidence">): number {
  return Math.round(
    item.severity * 0.30 +
    item.urgency * 0.40 +
    item.businessImpact * 0.20 +
    item.confidence * 100 * 0.10
  );
}

const LEVEL_DEFAULTS: Record<string, { severity: number; urgency: number; businessImpact: number; confidence: number }> = {
  critical:      { severity: 90, urgency: 90, businessImpact: 85, confidence: 0.95 },
  important:     { severity: 65, urgency: 70, businessImpact: 65, confidence: 0.80 },
  suggested:     { severity: 35, urgency: 30, businessImpact: 50, confidence: 0.70 },
  informational: { severity: 15, urgency: 10, businessImpact: 25, confidence: 0.90 },
};

function defaults(level: string) {
  return LEVEL_DEFAULTS[level] ?? LEVEL_DEFAULTS.informational;
}

function severityToLevel(severity: string): string {
  switch (severity) {
    case "critical": return "critical";
    case "high":     return "important";
    case "medium":   return "suggested";
    default:         return "informational";
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sync — pull from all sources and upsert into attention_items
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function syncAttentionItems(orgId: string): Promise<void> {
  const now = new Date();

  // Dismiss stale recurring alerts (scheduling + subscription source, older than 7 days)
  // so that fresh counts replace them rather than stacking up week-over-week.
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  try {
    await db
      .update(attentionItems)
      .set({ status: "dismissed", updatedAt: now })
      .where(
        and(
          eq(attentionItems.orgId, orgId),
          inArray(attentionItems.status, ["active"]),
          inArray(attentionItems.source, ["scheduling", "subscriptions"]),
          lt(attentionItems.createdAt, sevenDaysAgo)
        )
      );
  } catch {}

  // Load existing sourceIds for this org (skip dismissed/completed so they can't re-appear)
  const existing = await db
    .select({ sourceId: attentionItems.sourceId })
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.orgId, orgId),
        isNotNull(attentionItems.sourceId)
      )
    );
  const existingIds = new Set(existing.map((r) => r.sourceId).filter(Boolean) as string[]);

  const toInsert: InsertAttentionItem[] = [];

  const add = (item: InsertAttentionItem) => {
    if (item.sourceId && existingIds.has(item.sourceId)) return;
    toInsert.push(item);
  };

  // ── 1. Pending Approvals (agentToolCalls) ─────────────────────────────────
  try {
    const pendingCalls = await db
      .select()
      .from(agentToolCalls)
      .where(
        and(
          eq(agentToolCalls.orgId, orgId),
          eq(agentToolCalls.requiresConfirmation, true),
          or(
            eq(agentToolCalls.status, "pending"),
            eq(agentToolCalls.confirmationStatus, "pending")
          )
        )
      )
      .limit(20);

    for (const call of pendingCalls) {
      const level = (call.confidence ?? 0) >= 0.85 ? "important" : "suggested";
      const d = defaults(level);
      add({
        orgId,
        level,
        category: "approval",
        title: `Agent action pending approval: ${call.toolName}`,
        body: call.inputSummary || call.reason || `Tool call from ${call.agentName} awaiting your confirmation.`,
        source: "approval",
        sourceId: `tool-${call.id}`,
        actionUrl: "/admin/agent-tools",
        actionLabel: "Review & Approve",
        status: "active",
        ...d,
        urgency: 80,
      });
    }
  } catch {}

  // ── 2. Failed Workflows ───────────────────────────────────────────────────
  try {
    const failedWorkflows = await db
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.orgId, orgId),
          eq(workflowRuns.status, "failed")
        )
      )
      .limit(10);

    for (const wf of failedWorkflows) {
      const d = defaults("critical");
      add({
        orgId,
        level: "critical",
        category: "workflow",
        title: `Workflow failed: ${wf.displayName || wf.workflowType}`,
        body: wf.error || "A workflow has failed and requires your attention.",
        source: "workflow",
        sourceId: `wf-failed-${wf.id}`,
        actionUrl: "/admin/workflows",
        actionLabel: "View Workflow",
        status: "active",
        ...d,
      });
    }
  } catch {}

  // ── 3. Stuck Workflows (running > 2 hours) ────────────────────────────────
  try {
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const stuckWorkflows = await db
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.orgId, orgId),
          eq(workflowRuns.status, "running"),
          lt(workflowRuns.startedAt, twoHoursAgo)
        )
      )
      .limit(5);

    for (const wf of stuckWorkflows) {
      const d = defaults("critical");
      add({
        orgId,
        level: "critical",
        category: "workflow",
        title: `Workflow appears stuck: ${wf.displayName || wf.workflowType}`,
        body: "This workflow has been running for over 2 hours without completing. It may need manual intervention.",
        source: "workflow",
        sourceId: `wf-stuck-${wf.id}`,
        actionUrl: "/admin/workflows",
        actionLabel: "Investigate",
        status: "active",
        ...d,
        urgency: 75,
      });
    }
  } catch {}

  // ── 4. Agent Recommendations ──────────────────────────────────────────────
  try {
    const recs = await db
      .select()
      .from(agentRecommendations)
      .where(
        and(
          eq(agentRecommendations.orgId, orgId),
          eq(agentRecommendations.status, "pending")
        )
      )
      .limit(15);

    for (const rec of recs) {
      const level = severityToLevel(rec.severity);
      const d = defaults(level);
      const scoreOverride = rec.priorityScore ?? d.urgency;
      add({
        orgId,
        level,
        category: "brain",
        title: rec.title,
        body: rec.reason,
        source: "brain",
        sourceId: `rec-${rec.id}`,
        actionUrl: "/admin/business-brain",
        actionLabel: "View in Business Brain",
        status: "active",
        severity: d.severity,
        urgency: Math.min(100, scoreOverride),
        businessImpact: rec.estimatedImpact
          ? Math.min(100, Math.round(rec.estimatedImpact / 1000 * 10) + 50)
          : d.businessImpact,
        confidence: d.confidence,
      });
    }
  } catch {}

  // ── 5. Revenue Agent Actions ──────────────────────────────────────────────
  try {
    const revActions = await db
      .select()
      .from(revenueAgentActions)
      .where(
        and(
          eq(revenueAgentActions.orgId, orgId),
          eq(revenueAgentActions.status, "pending"),
          gte(revenueAgentActions.priority, 60)
        )
      )
      .limit(10);

    for (const action of revActions) {
      const priority = action.priority ?? 60;
      const level = priority >= 80 ? "important" : "suggested";
      const d = defaults(level);
      add({
        orgId,
        level,
        category: "deal",
        title: `Revenue action: ${action.actionType.replace(/_/g, " ")}`,
        body: action.reason,
        source: "revenue-agent",
        sourceId: `rev-${action.id}`,
        actionUrl: "/admin/team-training-deals",
        actionLabel: "View Deal Pipeline",
        status: "active",
        ...d,
        urgency: priority,
        businessImpact: action.estimatedValue
          ? Math.min(100, Math.round(action.estimatedValue / 1000 * 5) + 50)
          : d.businessImpact,
        confidence: (action.confidence ?? 80) / 100,
      });
    }
  } catch {}

  // ── 6. Stalled Deals ──────────────────────────────────────────────────────
  try {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const stalledDeals = await db
      .select()
      .from(teamTrainingDeals)
      .where(
        and(
          eq(teamTrainingDeals.organizationId, orgId),
          lt(teamTrainingDeals.lastActivityAt, sevenDaysAgo),
          ne(teamTrainingDeals.status, "won"),
          ne(teamTrainingDeals.status, "lost")
        )
      )
      .limit(10);

    for (const deal of stalledDeals) {
      const daysSince = Math.round((now.getTime() - new Date(deal.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24));
      const level = daysSince > 14 ? "important" : "suggested";
      const d = defaults(level);
      add({
        orgId,
        level,
        category: "deal",
        title: `Stalled deal — no activity for ${daysSince} days`,
        body: deal.nextAction
          ? `Next planned action: ${deal.nextAction}`
          : `This deal (status: ${deal.status}) has had no activity in ${daysSince} days and may need re-engagement.`,
        source: "deal",
        sourceId: `stalled-deal-${deal.id}`,
        actionUrl: "/admin/team-training-deals",
        actionLabel: "Open Pipeline",
        status: "active",
        ...d,
        urgency: Math.min(100, 40 + daysSince * 2),
        businessImpact: deal.estimatedValue
          ? Math.min(100, Math.round(deal.estimatedValue / 1000 * 5) + 40)
          : d.businessImpact,
      });
    }
  } catch {}

  // ── 7. Email Trigger Alerts ───────────────────────────────────────────────
  try {
    const alertResult = await computeTriggerAlerts(orgId);
    for (const alert of alertResult.alerts) {
      const level = alert.severity === "critical" ? "critical"
        : alert.severity === "warning" ? "important"
        : "informational";
      const d = defaults(level);
      const sourceId = `trigger-${alert.type}`;
      add({
        orgId,
        level,
        category: "trigger",
        title: `Email Agent: ${alert.type.replace(/_/g, " ").toLowerCase()}`,
        body: `${alert.message} — ${alert.suggestedAction}`,
        source: "trigger",
        sourceId,
        actionUrl: "/admin/trigger-audit",
        actionLabel: "Open Trigger Audit",
        status: "active",
        ...d,
        urgency: level === "critical" ? 85 : 60,
      });
    }
  } catch {}

  // ── 8. Pending Outreach Drafts (AI-generated, awaiting approval) ─────────
  try {
    const pendingDrafts = await db
      .select({ id: outreachDrafts.id })
      .from(outreachDrafts)
      .where(
        and(
          eq(outreachDrafts.orgId, orgId),
          eq(outreachDrafts.status, "draft"),
          eq(outreachDrafts.aiGenerated, true)
        )
      )
      .limit(100);

    if (pendingDrafts.length > 0) {
      const weekKey = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
      const level = pendingDrafts.length >= 5 ? "important" : "suggested";
      const d = defaults(level);
      add({
        orgId,
        level,
        category: "approval",
        title: `${pendingDrafts.length} outreach draft${pendingDrafts.length !== 1 ? "s" : ""} awaiting your approval`,
        body: "AI-generated outreach messages are ready for review and approval before sending.",
        source: "outreach",
        sourceId: `pending-outreach-drafts-w${weekKey}`,
        actionUrl: "/admin/outreach-queue",
        actionLabel: "Review Drafts",
        status: "active",
        ...d,
        urgency: 70,
      });
    }
  } catch {}

  // ── 9. Financial Event Failures ───────────────────────────────────────────
  try {
    const failures = await db
      .select()
      .from(financialEventFailures)
      .where(
        and(
          eq(financialEventFailures.orgId, orgId),
          eq(financialEventFailures.status, "pending")
        )
      )
      .limit(10);

    for (const failure of failures) {
      const d = defaults("critical");
      add({
        orgId,
        level: "critical",
        category: "payment",
        title: `Payment failure: ${failure.eventType.replace(/_/g, " ")}`,
        body: failure.failureMessage || `A ${failure.sourceType} financial event failed and requires investigation.`,
        source: "financial",
        sourceId: `fin-fail-${failure.id}`,
        actionUrl: "/admin/financial-reconciliation",
        actionLabel: "View Failures",
        status: "active",
        ...d,
        urgency: 90,
      });
    }
  } catch {}

  // ── 10. Expiring / Cancelled Subscriptions ────────────────────────────────
  try {
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const expiringSubs = await db
      .select({ id: userSubscriptions.id, userId: userSubscriptions.userId })
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.organizationId, orgId),
          eq(userSubscriptions.cancelAtPeriodEnd, true),
          lte(userSubscriptions.currentPeriodEnd, sevenDaysFromNow)
        )
      )
      .limit(20);

    if (expiringSubs.length > 0) {
      const weekKey = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
      const d = defaults("important");
      add({
        orgId,
        level: "important",
        category: "churn",
        title: `${expiringSubs.length} subscription${expiringSubs.length !== 1 ? "s" : ""} expiring within 7 days`,
        body: "These clients have cancelled and will lose access soon. Re-engagement now could prevent churn.",
        source: "subscriptions",
        sourceId: `expiring-subs-w${weekKey}`,
        actionUrl: "/admin/subscription",
        actionLabel: "View Subscriptions",
        status: "active",
        ...d,
        urgency: 80,
        businessImpact: Math.min(100, 50 + expiringSubs.length * 5),
      });
    }
  } catch {}

  // ── 11. Inactive Clients (30+ days no booking) ────────────────────────────
  try {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const weekKey = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));

    const clientProfileRows = await db
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.organizationId, orgId),
          eq(userProfiles.role, "CLIENT")
        )
      )
      .limit(300);

    if (clientProfileRows.length > 0) {
      const clientIds = clientProfileRows.map((c) => c.userId);

      const recentlyActive = await db
        .selectDistinct({ clientId: bookings.clientId })
        .from(bookings)
        .where(
          and(
            eq(bookings.organizationId, orgId),
            inArray(bookings.clientId, clientIds),
            gte(bookings.startAt, thirtyDaysAgo),
            inArray(bookings.status, ["CONFIRMED", "COMPLETED"])
          )
        );

      const activeClientIds = new Set(recentlyActive.map((b) => b.clientId));
      const inactiveCount = clientIds.filter((id) => !activeClientIds.has(id)).length;

      if (inactiveCount >= 2) {
        const level = inactiveCount >= 5 ? "important" : "suggested";
        const d = defaults(level);
        add({
          orgId,
          level,
          category: "churn",
          title: `${inactiveCount} client${inactiveCount !== 1 ? "s" : ""} inactive for 30+ days`,
          body: "These clients have had no sessions in over a month. Proactive re-engagement outreach could recover revenue.",
          source: "scheduling",
          sourceId: `inactive-clients-30d-w${weekKey}`,
          actionUrl: "/coach/users",
          actionLabel: "View Clients",
          status: "active",
          ...d,
          urgency: inactiveCount >= 5 ? 72 : 50,
          businessImpact: Math.min(100, 40 + inactiveCount * 5),
        });
      }
    }
  } catch {}

  // ── 12. Never-Booked Clients ──────────────────────────────────────────────
  try {
    const weekKey = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));

    const clientProfileRows = await db
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.organizationId, orgId),
          eq(userProfiles.role, "CLIENT")
        )
      )
      .limit(300);

    if (clientProfileRows.length > 0) {
      const clientIds = clientProfileRows.map((c) => c.userId);

      const everBooked = await db
        .selectDistinct({ clientId: bookings.clientId })
        .from(bookings)
        .where(
          and(
            eq(bookings.organizationId, orgId),
            inArray(bookings.clientId, clientIds)
          )
        );

      const bookedIds = new Set(everBooked.map((b) => b.clientId));
      const neverBookedCount = clientIds.filter((id) => !bookedIds.has(id)).length;

      if (neverBookedCount >= 1) {
        const level = neverBookedCount >= 3 ? "important" : "suggested";
        const d = defaults(level);
        add({
          orgId,
          level,
          category: "growth",
          title: `${neverBookedCount} registered client${neverBookedCount !== 1 ? "s" : ""} with no bookings yet`,
          body: "These clients created accounts but haven't scheduled their first session. A personal touch could convert them.",
          source: "scheduling",
          sourceId: `never-booked-w${weekKey}`,
          actionUrl: "/coach/users",
          actionLabel: "View Clients",
          status: "active",
          ...d,
          urgency: 55,
          businessImpact: Math.min(100, 40 + neverBookedCount * 8),
        });
      }
    }
  } catch {}

  // ── 13. Coach Schedule Overload (7+ sessions in next 7 days) ─────────────
  try {
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const dayKey = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));

    const upcomingBookings = await db
      .select({ coachId: bookings.coachId })
      .from(bookings)
      .where(
        and(
          eq(bookings.organizationId, orgId),
          eq(bookings.status, "CONFIRMED"),
          gte(bookings.startAt, now),
          lt(bookings.startAt, weekEnd)
        )
      )
      .limit(500);

    const coachCounts: Record<string, number> = {};
    for (const b of upcomingBookings) {
      coachCounts[b.coachId] = (coachCounts[b.coachId] ?? 0) + 1;
    }

    for (const [coachId, sessionCount] of Object.entries(coachCounts)) {
      if (sessionCount >= 7) {
        const level = sessionCount >= 12 ? "important" : "suggested";
        const d = defaults(level);
        add({
          orgId,
          level,
          category: "ops",
          title: `Coach overload: ${sessionCount} sessions scheduled in the next 7 days`,
          body: "A coach is nearing or exceeding healthy session capacity. Consider redistributing load or adding staff.",
          source: "scheduling",
          sourceId: `coach-overload-${coachId}-d${dayKey}`,
          actionUrl: "/scheduling",
          actionLabel: "View Schedule",
          status: "active",
          ...d,
          urgency: sessionCount >= 12 ? 70 : 50,
          businessImpact: 60,
        });
      }
    }
  } catch {}

  // ── 14. Low Coach Utilization (0 confirmed sessions next 7 days) ──────────
  try {
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekKey = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));

    const activeCoaches = await db
      .select({ id: coachProfiles.id })
      .from(coachProfiles)
      .where(
        and(
          eq(coachProfiles.organizationId, orgId),
          eq(coachProfiles.isActive, true)
        )
      )
      .limit(50);

    if (activeCoaches.length > 0) {
      const coachIds = activeCoaches.map((c) => c.id);

      const coachesWithBookings = await db
        .selectDistinct({ coachId: bookings.coachId })
        .from(bookings)
        .where(
          and(
            eq(bookings.organizationId, orgId),
            inArray(bookings.coachId, coachIds),
            eq(bookings.status, "CONFIRMED"),
            gte(bookings.startAt, now),
            lt(bookings.startAt, weekEnd)
          )
        );

      const scheduledCoachIds = new Set(coachesWithBookings.map((b) => b.coachId));
      const idleCoachCount = coachIds.filter((id) => !scheduledCoachIds.has(id)).length;

      if (idleCoachCount >= 1 && activeCoaches.length >= 2) {
        const d = defaults("suggested");
        add({
          orgId,
          level: "suggested",
          category: "ops",
          title: `${idleCoachCount} active coach${idleCoachCount !== 1 ? "es" : ""} with no sessions next 7 days`,
          body: "Idle coach capacity represents unrealized revenue. Consider promoting availability or reallocating bookings.",
          source: "scheduling",
          sourceId: `low-util-coaches-w${weekKey}`,
          actionUrl: "/scheduling",
          actionLabel: "View Schedule",
          status: "active",
          ...d,
          urgency: 45,
          businessImpact: Math.min(100, 40 + idleCoachCount * 10),
        });
      }
    }
  } catch {}

  // ── Batch insert new items ────────────────────────────────────────────────
  if (toInsert.length > 0) {
    // Deduplicate toInsert itself by sourceId
    const seen = new Set<string>();
    const deduped = toInsert.filter((item) => {
      if (!item.sourceId) return true;
      if (seen.has(item.sourceId)) return false;
      seen.add(item.sourceId);
      return true;
    });

    try {
      await db.insert(attentionItems).values(deduped).onConflictDoNothing();
    } catch {
      // Insert one by one if batch fails
      for (const item of deduped) {
        try {
          await db.insert(attentionItems).values(item).onConflictDoNothing();
        } catch {}
      }
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Escalation — Important items ignored 24h+ → Critical
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runEscalation(orgId: string): Promise<number> {
  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db
    .update(attentionItems)
    .set({
      level: "critical",
      status: "escalated",
      escalatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(attentionItems.orgId, orgId),
        eq(attentionItems.level, "important"),
        eq(attentionItems.status, "active"),
        lt(attentionItems.createdAt, threshold)
      )
    )
    .returning({ id: attentionItems.id });
  return result.length;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Query — get attention items (filtered + scored + sorted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type AttentionItemWithScore = AttentionItem & { score: number };

export async function getAttentionItems(
  orgId: string,
  opts: { includeStatus?: string[] } = {}
): Promise<AttentionItemWithScore[]> {
  const statuses = opts.includeStatus ?? ["active", "snoozed", "escalated"];
  const now = new Date();

  const rows = await db
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.orgId, orgId),
        inArray(attentionItems.status, statuses)
      )
    )
    .orderBy(attentionItems.createdAt);

  // Filter snoozed items where snoozedUntil has passed (treat as active)
  const visible = rows.filter((r) => {
    if (r.status === "snoozed" && r.snoozedUntil && r.snoozedUntil <= now) return false;
    if (r.expiresAt && r.expiresAt <= now) return false;
    return true;
  });

  const LEVEL_ORDER: Record<string, number> = {
    critical: 0, escalated: 0, important: 1, suggested: 2, informational: 3,
  };

  return visible
    .map((r) => ({ ...r, score: computeScore(r) }))
    .sort((a, b) => {
      const la = LEVEL_ORDER[a.level] ?? 3;
      const lb = LEVEL_ORDER[b.level] ?? 3;
      if (la !== lb) return la - lb;
      return b.score - a.score;
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Lifecycle actions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function snoozeAttentionItem(id: string, hours: number): Promise<void> {
  const until = new Date(Date.now() + hours * 60 * 60 * 1000);
  await db
    .update(attentionItems)
    .set({ status: "snoozed", snoozedUntil: until, updatedAt: new Date() })
    .where(eq(attentionItems.id, id));
}

export async function dismissAttentionItem(id: string): Promise<void> {
  await db
    .update(attentionItems)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(eq(attentionItems.id, id));
}

export async function completeAttentionItem(id: string): Promise<void> {
  await db
    .update(attentionItems)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(attentionItems.id, id));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Digest
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type AttentionDigest = {
  type: "morning" | "eod" | "weekly";
  generatedAt: Date;
  criticalCount: number;
  importantCount: number;
  suggestedCount: number;
  informationalCount: number;
  totalActive: number;
  topItems: AttentionItemWithScore[];
  recentlyResolved: number;
  summary: string;
};

export async function getAttentionDigest(
  orgId: string,
  type: "morning" | "eod" | "weekly" = "morning"
): Promise<AttentionDigest> {
  const active = await getAttentionItems(orgId);

  const criticalCount = active.filter((i) => i.level === "critical" || i.status === "escalated").length;
  const importantCount = active.filter((i) => i.level === "important" && i.status !== "escalated").length;
  const suggestedCount = active.filter((i) => i.level === "suggested").length;
  const informationalCount = active.filter((i) => i.level === "informational").length;

  // Count recently resolved
  const windowStart = type === "weekly"
    ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const resolved = await db
    .select({ id: attentionItems.id })
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.orgId, orgId),
        inArray(attentionItems.status, ["completed", "dismissed"]),
        gte(attentionItems.updatedAt, windowStart)
      )
    );

  const topItems = active.slice(0, 5);

  let summary = "";
  if (criticalCount > 0) {
    summary += `⚠️ ${criticalCount} critical item${criticalCount > 1 ? "s" : ""} require immediate action. `;
  }
  if (importantCount > 0) {
    summary += `${importantCount} important item${importantCount > 1 ? "s" : ""} need attention. `;
  }
  if (suggestedCount > 0) {
    summary += `${suggestedCount} AI suggestion${suggestedCount > 1 ? "s" : ""} available. `;
  }
  if (resolved.length > 0) {
    summary += `${resolved.length} item${resolved.length > 1 ? "s" : ""} resolved recently.`;
  }
  if (!summary) summary = "No active attention items. All systems operating normally.";

  return {
    type,
    generatedAt: new Date(),
    criticalCount,
    importantCount,
    suggestedCount,
    informationalCount,
    totalActive: active.length,
    topItems,
    recentlyResolved: resolved.length,
    summary: summary.trim(),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Count (fast, for bell badge)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function getAttentionCount(orgId: string): Promise<{ critical: number; important: number; total: number }> {
  const now = new Date();
  const rows = await db
    .select({ level: attentionItems.level, status: attentionItems.status, snoozedUntil: attentionItems.snoozedUntil })
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.orgId, orgId),
        inArray(attentionItems.status, ["active", "escalated"])
      )
    );

  const active = rows.filter((r) => !(r.status === "snoozed" && r.snoozedUntil && r.snoozedUntil <= now));
  const critical = active.filter((r) => r.level === "critical" || r.status === "escalated").length;
  const important = active.filter((r) => r.level === "important").length;
  return { critical, important, total: active.length };
}
