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
  users,
  type AttentionItem,
  type InsertAttentionItem,
} from "@shared/schema";
import { eq, and, or, lt, gt, sql, inArray, isNotNull, ne, gte, lte } from "drizzle-orm";
import { computeTriggerAlerts } from "./email-agent/trigger-alerts";
import { CLIENT_ELIGIBILITY_SQL } from "./client-eligibility";

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

  // Dismiss stale revenue signals older than 3 days — lead signals use daily keys so old
  // ones accumulate; clear them so only today's are visible.
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  try {
    await db
      .update(attentionItems)
      .set({ status: "dismissed", updatedAt: now })
      .where(
        and(
          eq(attentionItems.orgId, orgId),
          eq(attentionItems.status, "active"),
          eq(attentionItems.source, "revenue"),
          lt(attentionItems.createdAt, threeDaysAgo)
        )
      );
  } catch {}

  // Purge stale agent_recommendations that were generated from bad booking data
  // (aggregate re-engage / churn-risk / no-bookings signals pre-backfill).
  try {
    await purgeStaleClientRecommendations(orgId);
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

  // ── 11. Inactive Clients — per-client, 14+ days since last session ────────
  // Generates one actionable item per real client who had prior sessions but has
  // gone quiet. Excludes walk-ins, test/dev accounts, and clients with upcoming
  // confirmed bookings. Does NOT flag brand-new never-booked users (Signal 12).
  try {
    const weekKey = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));

    // Data quality gate — require ≥80% of org-client bookings to carry organization_id
    const [coverageRow11] = await db.execute(
      sql`SELECT COUNT(*) AS total, COUNT(organization_id) AS with_org
          FROM bookings
          WHERE client_id IN (SELECT user_id FROM user_profiles WHERE organization_id = ${orgId})`
    ) as any;
    const cov11Total = Number(coverageRow11?.total ?? 0);
    const cov11WithOrg = Number(coverageRow11?.with_org ?? 0);
    if (cov11Total > 0 && (cov11WithOrg / cov11Total) < 0.80) {
      console.warn(`[AttentionEngine] Signal 11 skipped for org ${orgId}: booking org_id coverage ${cov11WithOrg}/${cov11Total}`);
    } else {
      // Dismiss old aggregate-count "X clients inactive" items — replaced by per-client rows
      try {
        await db.update(attentionItems).set({ status: "dismissed", updatedAt: now })
          .where(and(
            eq(attentionItems.orgId, orgId),
            sql`source_id LIKE 'inactive-clients-30d-%'`
          ));
      } catch {}

      const inactiveRows = await db.execute(sql`
        SELECT
          up.user_id,
          u.first_name,
          u.last_name,
          u.email,
          u.phone,
          COUNT(b.id) FILTER (WHERE b.status IN ('CONFIRMED','COMPLETED') AND b.start_at < NOW())::int AS past_session_count,
          MAX(b.start_at) FILTER (WHERE b.status IN ('CONFIRMED','COMPLETED') AND b.start_at < NOW()) AS last_session_at,
          COUNT(b.id) FILTER (WHERE b.status = 'CONFIRMED' AND b.start_at >= NOW())::int AS upcoming_count
        FROM user_profiles up
        JOIN users u ON u.id = up.user_id
        LEFT JOIN bookings b ON b.client_id = up.user_id AND b.organization_id = ${orgId}
        WHERE up.organization_id = ${orgId}
          AND up.role = 'CLIENT'
          ${sql.raw(CLIENT_ELIGIBILITY_SQL(orgId))}
        GROUP BY up.user_id, u.first_name, u.last_name, u.email, u.phone
        HAVING
          COUNT(b.id) FILTER (WHERE b.status IN ('CONFIRMED','COMPLETED') AND b.start_at < NOW()) >= 1
          AND COUNT(b.id) FILTER (WHERE b.status = 'CONFIRMED' AND b.start_at >= NOW()) = 0
          AND MAX(b.start_at) FILTER (WHERE b.status IN ('CONFIRMED','COMPLETED') AND b.start_at < NOW()) < NOW() - INTERVAL '14 days'
        ORDER BY last_session_at ASC
        LIMIT 50
      `) as any[];

      for (const row of inactiveRows) {
        const clientName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.email || row.user_id;
        const lastSessionAt = row.last_session_at ? new Date(row.last_session_at) : null;
        const daysSince = lastSessionAt
          ? Math.floor((now.getTime() - lastSessionAt.getTime()) / (1000 * 60 * 60 * 24))
          : 999;
        const pastCount = Number(row.past_session_count ?? 0);
        const upcomingCount = Number(row.upcoming_count ?? 0);

        let level: string;
        let urgency: number;
        let bodyNote: string;
        if (daysSince >= 45 && pastCount >= 3) {
          level = "critical";
          urgency = 88;
          bodyNote = "High churn risk — urgent outreach recommended.";
        } else if (daysSince >= 30) {
          level = "important";
          urgency = 72;
          bodyNote = "Proactive re-engagement could recover this client.";
        } else {
          level = "suggested";
          urgency = 50;
          bodyNote = "A brief check-in message could re-activate this client.";
        }

        const lastDateStr = lastSessionAt
          ? lastSessionAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : "unknown";
        const d = defaults(level);

        add({
          orgId,
          level,
          category: "churn",
          title: `${clientName} has not trained in ${daysSince} day${daysSince !== 1 ? "s" : ""}`,
          body: `Last session: ${lastDateStr} (${pastCount} total). No upcoming bookings. ${bodyNote}`,
          source: "scheduling",
          sourceId: `inactive-client-${row.user_id}-w${weekKey}`,
          actionUrl: `/coach/users`,
          actionLabel: "View Client",
          status: "active",
          ...d,
          urgency,
          businessImpact: Math.min(100, 40 + pastCount * 6),
          metadata: {
            clientId: row.user_id,
            clientName,
            clientEmail: row.email ?? null,
            clientPhone: row.phone ?? null,
            lastSessionAt: lastSessionAt?.toISOString() ?? null,
            lastSessionDate: lastDateStr,
            daysSinceLast: daysSince,
            pastSessionCount: pastCount,
            upcomingCount,
            recommendedAction: daysSince >= 45 ? "urgent-re-engage" : daysSince >= 30 ? "re-engage" : "check-in",
            ctaOptions: ["send-email", "send-sms", "schedule-session"],
            signalVersion: "v2-per-client",
          },
        });
      }
    }
  } catch {}

  // ── 12. New Client Needs Activation — per-client, 1–30 days old, zero bookings
  // Generates one actionable item per real registered client who signed up but
  // has never booked. Excludes walk-ins, test/dev accounts, accounts > 30 days
  // old (those go to dormant/reactivation), and clients with no contact path.
  // Never overlaps with Signal 11: Signal 11 requires ≥1 past booking.
  try {
    const dayKey = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));

    // Data quality gate
    const [cov12Row] = await db.execute(
      sql`SELECT COUNT(*) AS total, COUNT(organization_id) AS with_org
          FROM bookings WHERE client_id IN (SELECT user_id FROM user_profiles WHERE organization_id = ${orgId})`
    ) as any;
    const cov12Total = Number(cov12Row?.total ?? 0);
    const cov12WithOrg = Number(cov12Row?.with_org ?? 0);
    if (cov12Total > 0 && (cov12WithOrg / cov12Total) < 0.80) {
      console.warn(`[AttentionEngine] Signal 12 skipped for org ${orgId}: coverage ${cov12WithOrg}/${cov12Total}`);
    } else {
      // Dismiss old aggregate "X clients never booked" items — replaced by per-client rows
      try {
        await db.update(attentionItems).set({ status: "dismissed", updatedAt: now })
          .where(and(
            eq(attentionItems.orgId, orgId),
            sql`source_id LIKE 'never-booked-%'`
          ));
      } catch {}

      const activationRows = await db.execute(sql`
        SELECT
          up.user_id,
          u.first_name,
          u.last_name,
          u.email,
          u.phone,
          u.created_at,
          EXTRACT(EPOCH FROM (NOW() - u.created_at)) / 86400 AS account_age_days
        FROM user_profiles up
        JOIN users u ON u.id = up.user_id
        WHERE up.organization_id = ${orgId}
          AND up.role = 'CLIENT'
          ${sql.raw(CLIENT_ELIGIBILITY_SQL(orgId))}
          AND (u.email IS NOT NULL OR u.phone IS NOT NULL)
          AND u.created_at > NOW() - INTERVAL '30 days'
          AND u.created_at < NOW() - INTERVAL '24 hours'
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.client_id = up.user_id AND b.organization_id = ${orgId}
          )
        ORDER BY u.created_at ASC
        LIMIT 50
      `) as any[];

      for (const row of activationRows) {
        const clientName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.email || row.user_id;
        const ageDays = Math.floor(Number(row.account_age_days ?? 0));

        let level: string;
        let urgency: number;
        let ctaMessage: string;
        if (ageDays <= 3) {
          level = "suggested";
          urgency = 55;
          ctaMessage = "Send a welcome message and offer to help schedule their first session.";
        } else if (ageDays <= 7) {
          level = "important";
          urgency = 68;
          ctaMessage = "Follow up — offer a free intro call or help scheduling their first session.";
        } else {
          level = "important";
          urgency = 72;
          ctaMessage = "Interest may be fading. Send a personalized activation message or schedule offer.";
        }

        const signedUpStr = ageDays === 1 ? "1 day ago" : `${ageDays} days ago`;
        const d = defaults(level);

        add({
          orgId,
          level,
          category: "growth",
          title: `${clientName} signed up ${signedUpStr} but hasn't booked yet`,
          body: ctaMessage,
          source: "scheduling",
          sourceId: `activation-client-${row.user_id}-d${dayKey}`,
          actionUrl: `/coach/users`,
          actionLabel: "View Client",
          status: "active",
          ...d,
          urgency,
          businessImpact: Math.min(100, 50 + ageDays * 2),
          metadata: {
            clientId: row.user_id,
            clientName,
            clientEmail: row.email ?? null,
            clientPhone: row.phone ?? null,
            accountCreatedAt: row.created_at,
            accountAgeDays: ageDays,
            recommendedAction: "activate",
            ctaOptions: ["send-email", "send-sms", "schedule-session", "offer-intro"],
            signalVersion: "v2-per-client",
          },
        });
      }
    }
  } catch {}

  // ── 13. Coach Schedule Overload (7+ sessions in next 7 days) ─────────────
  // Guard: skip when all upcoming bookings for this org are missing organization_id
  // (indicates the bookings table has not been backfilled yet).
  try {
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const dayKey = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));

    // Data quality gate — check that at least one upcoming booking for the org has org_id set
    const [cov13Row] = await db.execute<{ total: number; with_org: number }>(
      sql`SELECT COUNT(*) AS total,
               COUNT(organization_id) AS with_org
          FROM bookings
          WHERE organization_id = ${orgId}
             OR coach_id IN (
               SELECT id FROM coach_profiles WHERE organization_id = ${orgId}
             )`
    ) as any;
    const cov13Total = Number(cov13Row?.total ?? 0);
    const cov13WithOrg = Number(cov13Row?.with_org ?? 0);
    if (cov13Total > 0 && (cov13WithOrg / cov13Total) < 0.80) {
      console.warn(`[AttentionEngine] Signal 13 skipped for org ${orgId}: booking org_id coverage ${cov13WithOrg}/${cov13Total}`);
    } else {

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
    } // end else (coverage ok — signal 13)
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

  // ── R1. New Lead Submitted — Never Contacted (Critical Revenue) ───────────
  // Fires once per day per lead until the lead is contacted.
  try {
    const dayKey = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
    const newLeads = await db.execute(sql`
      SELECT id, athlete_name, parent_name, email, phone,
        estimated_value_cents, ai_qualification_score,
        EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS hours_waiting
      FROM lead_capture_submissions
      WHERE org_id = ${orgId}
        AND contacted_at IS NULL
        AND sequence_status NOT IN ('converted', 'closed', 'lost')
        AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY created_at ASC
      LIMIT 20
    `) as any[];

    for (const lead of newLeads) {
      const name = (lead.athlete_name || lead.parent_name || lead.email || "Unknown lead").trim();
      const hoursWaiting = Math.floor(Number(lead.hours_waiting ?? 0));
      const estValue = Number(lead.estimated_value_cents ?? 0) / 100;
      const level = hoursWaiting >= 2 ? "critical" : "important";
      const urgency = hoursWaiting >= 4 ? 95 : hoursWaiting >= 2 ? 88 : 72;
      const d = defaults(level);
      const waitStr = hoursWaiting < 1 ? "less than an hour" : hoursWaiting === 1 ? "1 hour" : `${hoursWaiting} hours`;
      add({
        orgId,
        level,
        category: "lead",
        title: `New lead awaiting first contact`,
        body: `${name} submitted ${waitStr} ago — no contact has been made yet.${estValue > 0 ? ` Estimated value: $${Math.round(estValue)}.` : ""}`,
        source: "revenue",
        sourceId: `revenue-lead-new-${lead.id}-d${dayKey}`,
        actionUrl: "/admin/leads",
        actionLabel: "View Lead",
        status: "active",
        ...d,
        urgency,
        businessImpact: 92,
        metadata: {
          leadId: lead.id,
          leadName: name,
          leadEmail: lead.email ?? null,
          leadPhone: lead.phone ?? null,
          estimatedValue: estValue,
          hoursWaiting,
          aiQualificationScore: lead.ai_qualification_score ?? null,
          ctaOptions: ["send-email", "send-sms", "schedule-call"],
          signalType: "new-lead-uncontacted",
        },
      });
    }
  } catch {}

  // ── R2. Lead Awaiting Follow-Up 72h+ (Important → Critical) ──────────────
  try {
    const dayKey = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
    const staleLeads = await db.execute(sql`
      SELECT id, athlete_name, parent_name, email, phone,
        estimated_value_cents, follow_up_count, ai_qualification_score,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(last_follow_up_at, contacted_at))) / 3600 AS hours_since_contact
      FROM lead_capture_submissions
      WHERE org_id = ${orgId}
        AND contacted_at IS NOT NULL
        AND converted_at IS NULL
        AND sequence_status NOT IN ('converted', 'closed', 'lost')
        AND COALESCE(last_follow_up_at, contacted_at) < NOW() - INTERVAL '72 hours'
      ORDER BY last_follow_up_at ASC NULLS FIRST
      LIMIT 20
    `) as any[];

    for (const lead of staleLeads) {
      const name = (lead.athlete_name || lead.parent_name || lead.email || "Lead").trim();
      const hoursSince = Math.floor(Number(lead.hours_since_contact ?? 0));
      const daysSince = Math.floor(hoursSince / 24);
      const estValue = Number(lead.estimated_value_cents ?? 0) / 100;
      const followUpCount = Number(lead.follow_up_count ?? 0);
      const level = daysSince >= 7 ? "critical" : "important";
      const urgency = daysSince >= 7 ? 87 : daysSince >= 5 ? 78 : 70;
      const d = defaults(level);
      add({
        orgId,
        level,
        category: "lead",
        title: `Lead awaiting follow-up`,
        body: `${name} has not been contacted in ${daysSince >= 1 ? `${daysSince} day${daysSince !== 1 ? "s" : ""}` : `${hoursSince} hours`}. ${followUpCount} prior contact${followUpCount !== 1 ? "s" : ""} made.`,
        source: "revenue",
        sourceId: `revenue-lead-followup-${lead.id}-d${dayKey}`,
        actionUrl: "/admin/leads",
        actionLabel: "Follow Up Now",
        status: "active",
        ...d,
        urgency,
        businessImpact: 82,
        metadata: {
          leadId: lead.id,
          leadName: name,
          leadEmail: lead.email ?? null,
          leadPhone: lead.phone ?? null,
          estimatedValue: estValue,
          daysWaiting: daysSince,
          hoursWaiting: hoursSince,
          followUpCount,
          aiQualificationScore: Number(lead.ai_qualification_score ?? 0),
          ctaOptions: ["send-follow-up-email", "send-sms", "schedule-consultation"],
          signalType: "lead-followup-overdue",
        },
      });
    }
  } catch {}

  // ── R3. Free Intro Completed — No Paid Conversion (Critical Revenue) ──────
  // Highest-intent conversion window: client attended a free session but hasn't bought.
  try {
    const weekKey = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
    const noConvRows = await db.execute(sql`
      SELECT b.id AS booking_id, b.client_id, b.start_at,
        u.first_name, u.last_name, u.email,
        s.name AS service_name,
        EXTRACT(EPOCH FROM (NOW() - b.start_at)) / 86400 AS days_since
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      JOIN users u ON u.id = b.client_id
      WHERE b.organization_id = ${orgId}
        AND b.status = 'COMPLETED'
        AND (s.price_cents = 0 OR s.counts_toward_revenue = false)
        AND b.start_at < NOW() - INTERVAL '48 hours'
        AND b.start_at > NOW() - INTERVAL '60 days'
        AND NOT EXISTS (
          SELECT 1 FROM bookings b2
          JOIN services s2 ON s2.id = b2.service_id
          WHERE b2.client_id = b.client_id
            AND b2.organization_id = ${orgId}
            AND b2.created_at > b.start_at
            AND s2.price_cents > 0
            AND s2.counts_toward_revenue = true
        )
      ORDER BY b.start_at DESC
      LIMIT 15
    `) as any[];

    for (const row of noConvRows) {
      const clientName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.email || "Client";
      const daysSince = Math.floor(Number(row.days_since ?? 0));
      const level = daysSince > 14 ? "important" : "critical";
      const urgency = daysSince > 14 ? 65 : daysSince > 7 ? 78 : 88;
      const d = defaults(level);
      add({
        orgId,
        level,
        category: "revenue",
        title: `Free intro completed — no paid booking yet`,
        body: `${clientName} completed a ${row.service_name || "free session"} ${daysSince} day${daysSince !== 1 ? "s" : ""} ago and has not purchased training.`,
        source: "revenue",
        sourceId: `revenue-intro-noconv-${row.booking_id}-w${weekKey}`,
        actionUrl: "/coach/users",
        actionLabel: "Send Program Offer",
        status: "active",
        ...d,
        urgency,
        businessImpact: 87,
        metadata: {
          clientId: row.client_id,
          clientName,
          clientEmail: row.email ?? null,
          bookingId: row.booking_id,
          assessmentDate: new Date(row.start_at).toISOString(),
          daysSinceAssessment: daysSince,
          serviceName: row.service_name,
          estimatedValue: 840,
          estimatedAnnualValue: 840,
          ctaOptions: ["send-program-offer", "schedule-followup-call", "generate-recommendation"],
          signalType: "intro-no-conversion",
        },
      });
    }
  } catch {}

  // ── R4. Zero Upcoming Bookings This Week (Critical Revenue) ───────────────
  // Org-level signal — empty schedule = zero revenue for the week.
  try {
    const weekKey = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [upcomingRow] = await db.execute(sql`
      SELECT COUNT(*) AS confirmed_count
      FROM bookings
      WHERE organization_id = ${orgId}
        AND status = 'CONFIRMED'
        AND start_at >= NOW()
        AND start_at < ${weekEnd}
    `) as any;
    const confirmedCount = Number(upcomingRow?.confirmed_count ?? 0);
    if (confirmedCount === 0) {
      const d = defaults("critical");
      add({
        orgId,
        level: "critical",
        category: "revenue",
        title: "No bookings scheduled this week",
        body: "Your schedule has no confirmed sessions over the next 7 days. Reach out to leads or promote your availability to fill the gap.",
        source: "revenue",
        sourceId: `revenue-empty-schedule-w${weekKey}`,
        actionUrl: "/scheduling",
        actionLabel: "Promote Availability",
        status: "active",
        ...d,
        urgency: 92,
        businessImpact: 96,
        metadata: {
          confirmedCount: 0,
          weekEnd: weekEnd.toISOString(),
          estimatedValue: 280,
          ctaOptions: ["promote-availability", "contact-leads", "launch-followup-campaign"],
          signalType: "empty-schedule",
        },
      });
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Purge stale client recommendations
// ─────────────────────────────────────────────────────────────────────────────
// Marks agent_recommendations that were generated from polluted booking data
// (aggregate re-engage / churn-risk / never-booked signals) as "stale".
// Called automatically at the start of each syncAttentionItems run and also
// available as a standalone export for one-off cleanup operations.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function purgeStaleClientRecommendations(
  orgId: string
): Promise<{ purged: number }> {
  const now = new Date();
  const INVALIDATION_REASON =
    "Invalidated by booking organization_id backfill and client-signal correction. " +
    "Generated from incomplete booking data where organization_id was NULL on all bookings. " +
    "Per-client signals v2 will regenerate accurate recommendations on next sync.";

  const result = await db
    .update(agentRecommendations)
    .set({ status: "stale", reason: INVALIDATION_REASON, updatedAt: now })
    .where(
      and(
        eq(agentRecommendations.orgId, orgId),
        inArray(agentRecommendations.status, ["pending", "active"]),
        sql`(
          LOWER(title) LIKE '%re-engage%' OR
          LOWER(title) LIKE '%no bookings%' OR
          LOWER(title) LIKE '%churn risk%' OR
          LOWER(description) LIKE '%inactive%' OR
          LOWER(description) LIKE '%no bookings%' OR
          LOWER(description) LIKE '%re-engage%'
        )`
      )
    )
    .returning({ id: agentRecommendations.id });

  if (result.length > 0) {
    console.log(`[AttentionEngine] purgeStaleClientRecommendations: marked ${result.length} stale recommendations for org ${orgId}`);
  }

  return { purged: result.length };
}
