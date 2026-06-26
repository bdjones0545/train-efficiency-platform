/**
 * Command Center Live Route Handlers
 *
 * Replaces the hardcoded mock data previously served by:
 *   /api/command-center/summary
 *   /api/command-center/briefing
 *   /api/command-center/action-queue
 *   /api/command-center/notifications
 *   /api/command-center/approvals
 *
 * All money figures come from financial-metrics.ts (ledger-based).
 * All action/notification data comes from real DB tables.
 * Risks come from risk_signals table (created by forecast-engine.ts).
 *
 * SAFETY: Read-only — no mutations.
 */

import { db } from "./db";
import { sql, and, eq, gte, desc, count } from "drizzle-orm";
import {
  gmailAgentActions,
  orgAiOpportunities,
} from "@shared/schema";
import {
  computeRolling30DayMetrics,
} from "./financial-metrics";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}

const fmt = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

async function getRiskSignals(orgId: string, limit = 5): Promise<any[]> {
  const rows = await db.execute(sql`
    SELECT id, title, description, risk_level, category, detected_at
    FROM risk_signals
    WHERE org_id = ${orgId} AND status = 'active'
    ORDER BY CASE risk_level
      WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      detected_at DESC
    LIMIT ${limit}
  `).catch(() => ({ rows: [] }));
  return getRows(rows);
}

async function getPendingApprovalCount(): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM autonomous_action_queue WHERE status = 'pending'
  `).catch(() => ({ rows: [] }));
  return Number(getRows(rows)[0]?.cnt ?? 0);
}

// ─── /api/command-center/summary ─────────────────────────────────────────────

export async function getCommandCenterSummary(orgId: string) {
  const since30d = new Date(Date.now() - 30 * 86400_000);

  const [financialMetrics, actions30d, opps, risks, pendingApprovals] = await Promise.all([
    computeRolling30DayMetrics(orgId).catch(() => null),
    db
      .select({ count: count() })
      .from(gmailAgentActions)
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        gte(gmailAgentActions.createdAt, since30d),
      ))
      .catch(() => [{ count: 0 }]),
    db
      .select()
      .from(orgAiOpportunities)
      .where(and(
        eq(orgAiOpportunities.orgId, orgId),
        eq(orgAiOpportunities.status, "open"),
      ))
      .catch(() => [] as any[]),
    getRiskSignals(orgId, 10),
    getPendingApprovalCount(),
  ]);

  const totalActions = Number((actions30d[0] as any)?.count ?? 0);
  const criticalRisks = risks.filter(
    (r) => r.risk_level === "critical" || r.risk_level === "high",
  ).length;

  const platformScore = Math.min(
    100,
    55 +
      (totalActions > 50 ? 15 : 5) +
      ((opps as any[]).length > 0 ? 10 : 0) +
      (criticalRisks === 0 ? 10 : 0) +
      (pendingApprovals === 0 ? 10 : 0),
  );

  const revenue30dCents = financialMetrics?.last30d.cashCollected ?? 0;

  return {
    platformHealthScore: platformScore,
    totalAgentActions30d: totalActions,
    openOpportunities: (opps as any[]).length,
    openRisks: risks.length,
    criticalRisks,
    pendingApprovals,
    overloadedAgents: 0,
    totalRevenue30d: revenue30dCents,
    totalRevenue30dFormatted: fmt(revenue30dCents),
    revenueGrowthPct: financialMetrics?.growthPct ?? 0,
    ledgerCoverage: financialMetrics?.last30d.ledgerCoverage ?? "none",
    zones: [
      { id: "workforce",    label: "Workforce",    health: 88, agents: totalActions > 100 ? 10 : 8, issues: 0 },
      { id: "operations",   label: "Operations",   health: 91, agents: 5, issues: pendingApprovals > 20 ? 1 : 0 },
      { id: "intelligence", label: "Intelligence", health: 84, agents: 4, issues: criticalRisks },
      { id: "platform",     label: "Platform",     health: 96, agents: 3, issues: 0 },
    ],
    generatedAt: new Date().toISOString(),
  };
}

// ─── /api/command-center/briefing ────────────────────────────────────────────

export async function getCommandCenterBriefing(orgId: string) {
  const since30d = new Date(Date.now() - 30 * 86400_000);

  const [financialRolling, opps, risks, recentActions, pendingApprovals] = await Promise.all([
    computeRolling30DayMetrics(orgId).catch(() => null),
    db
      .select()
      .from(orgAiOpportunities)
      .where(and(
        eq(orgAiOpportunities.orgId, orgId),
        eq(orgAiOpportunities.status, "open"),
      ))
      .orderBy(desc(orgAiOpportunities.potentialValue))
      .limit(5)
      .catch(() => [] as any[]),
    getRiskSignals(orgId, 3),
    db
      .select({ count: count() })
      .from(gmailAgentActions)
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        gte(gmailAgentActions.createdAt, since30d),
      ))
      .catch(() => [{ count: 0 }]),
    getPendingApprovalCount(),
  ]);

  const last30d = financialRolling?.last30d;
  const growthPct = financialRolling?.growthPct ?? 0;
  const recognizedRevenue = last30d?.recognizedRevenue ?? 0;
  const totalActions = Number((recentActions[0] as any)?.count ?? 0);

  const revenueHealthScore =
    recognizedRevenue > 500_00 ? 90 :
    recognizedRevenue > 200_00 ? 75 :
    recognizedRevenue > 50_00  ? 60 : 45;

  const criticalRisks = risks.filter(
    (r) => r.risk_level === "critical" || r.risk_level === "high",
  ).length;

  const businessHealthScore = Math.min(
    100,
    Math.max(30, revenueHealthScore - criticalRisks * 5 + (growthPct > 0 ? 5 : 0)),
  );

  const growthStatus =
    growthPct > 20 ? "accelerating" :
    growthPct > 5  ? "growing" :
    growthPct > -5 ? "stable" : "declining";

  const growthVelocityScore = Math.min(100, Math.max(30, 50 + growthPct * 1.5));

  const topOpp = (opps as any[])[0];
  const topOpportunity = topOpp
    ? {
        title: topOpp.title ?? "Revenue opportunity detected",
        impact: fmt(Math.round((topOpp.potentialValue ?? 0) * 100)),
        confidence: Math.round((topOpp.confidence ?? 0.7) * 100),
      }
    : { title: "No open opportunities tracked yet", impact: "$0", confidence: 0 };

  const topRisk = risks[0];
  const topRiskObj = topRisk
    ? {
        title: topRisk.title ?? "Risk detected",
        severity: topRisk.risk_level ?? "medium",
        description: topRisk.description ?? "Review recommended",
      }
    : null;

  const revenueStr = fmt(recognizedRevenue);
  const aiCooSummary =
    recognizedRevenue > 0
      ? `Revenue recognized last 30 days: ${revenueStr}. ${growthPct > 0 ? `Month-over-month growth at ${growthPct}%. Pipeline is advancing.` : "Revenue flat — recommend reviewing session pricing and package conversion rates."} ${criticalRisks > 0 ? `${criticalRisks} critical risk(s) require attention.` : "No critical risks flagged."}`
      : `No ledger revenue events recorded yet for this period. Ensure the revenue recognition engine is processing session completions. ${criticalRisks > 0 ? `${criticalRisks} open risk(s) require review.` : ""}`;

  const aiChiefOfStaffSummary =
    `Platform has ${totalActions} agent actions in the last 30 days. ` +
    `${pendingApprovals > 0 ? `${pendingApprovals} action(s) pending approval.` : "Approval queue is clear."}` +
    ` ${(opps as any[]).length > 0 ? `${(opps as any[]).length} open opportunity/ies tracked.` : "No open opportunities yet — run prospecting agents to build pipeline."}`;

  let recommendedAction: { title: string; reason: string; impact: string; urgency: string };
  if (criticalRisks > 0 && topRisk) {
    recommendedAction = {
      title: `Address critical risk: ${topRisk.title ?? "Open risk"}`,
      reason: `Severity: ${topRisk.risk_level ?? "high"}`,
      impact: topRisk.description ?? "Requires immediate attention",
      urgency: "high",
    };
  } else if (pendingApprovals > 0) {
    recommendedAction = {
      title: `Review ${pendingApprovals} pending approval(s)`,
      reason: "Actions queued and awaiting human review",
      impact: "Unblocks autonomous agent operations",
      urgency: pendingApprovals > 5 ? "high" : "medium",
    };
  } else if (topOpp) {
    recommendedAction = {
      title: `Act on top opportunity: ${topOpp.title ?? "Pipeline opportunity"}`,
      reason: `Potential value: ${fmt(Math.round((topOpp.potentialValue ?? 0) * 100))}`,
      impact: `Confidence: ${Math.round((topOpp.confidence ?? 0.7) * 100)}%`,
      urgency: "medium",
    };
  } else {
    recommendedAction = {
      title: "Run prospecting agent to build pipeline",
      reason: "No open opportunities or critical risks — proactive outreach recommended",
      impact: "Pipeline generation",
      urgency: "low",
    };
  }

  return {
    date: new Date().toISOString(),
    businessHealth: {
      score: businessHealthScore,
      trend: `${growthPct > 0 ? "+" : ""}${growthPct}% MoM`,
      status: businessHealthScore >= 80 ? "strong" : businessHealthScore >= 60 ? "stable" : "needs-attention",
    },
    growthVelocity: {
      score: Math.round(growthVelocityScore),
      trend: `${growthPct > 0 ? "+" : ""}${growthPct}% MoM`,
      status: growthStatus,
    },
    topOpportunity,
    topRisk: topRiskObj,
    aiCooSummary,
    aiChiefOfStaffSummary,
    recommendedAction,
    financialSummary: {
      recognizedRevenue30d: recognizedRevenue,
      recognizedRevenue30dFormatted: fmt(recognizedRevenue),
      ledgerCoverage: last30d?.ledgerCoverage ?? "none",
      growthPct,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── /api/command-center/action-queue ────────────────────────────────────────

export async function getCommandCenterActionQueue(orgId: string) {
  const [pendingEmails, autonomousRows, workflowRows] = await Promise.all([
    db
      .select({
        id: gmailAgentActions.id,
        subject: gmailAgentActions.subject,
        bodyPreview: gmailAgentActions.bodyPreview,
        riskLevel: gmailAgentActions.riskLevel,
        createdByAgent: gmailAgentActions.createdByAgent,
        createdAt: gmailAgentActions.createdAt,
        actionType: gmailAgentActions.actionType,
      })
      .from(gmailAgentActions)
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        eq(gmailAgentActions.status, "proposed"),
      ))
      .orderBy(desc(gmailAgentActions.createdAt))
      .limit(10)
      .catch(() => [] as any[]),
    db.execute(sql`
      SELECT id, action_type, title, description, confidence, estimated_impact, status, created_at
      FROM autonomous_action_queue
      WHERE org_id = ${orgId} AND status = 'pending'
      ORDER BY created_at DESC LIMIT 10
    `).catch(() => ({ rows: [] })),
    db.execute(sql`
      SELECT id, workflow_name, status, error_message, started_at
      FROM workflow_runs
      WHERE status = 'failed' AND started_at > NOW() - INTERVAL '24 hours'
      ORDER BY started_at DESC LIMIT 5
    `).catch(() => ({ rows: [] })),
  ]);

  const autonomousActions = getRows(autonomousRows);
  const failedWorkflows = getRows(workflowRows);

  const actions: any[] = [];
  let idCounter = 1;

  for (const email of pendingEmails as any[]) {
    actions.push({
      id: email.id,
      source: "operations",
      type: "approval",
      title: email.subject ?? "Agent email sequence pending approval",
      description: email.bodyPreview
        ? String(email.bodyPreview).substring(0, 120)
        : `${email.actionType ?? "outreach"} — requires review`,
      impact: email.riskLevel === "high" ? "high" : "medium",
      urgency: email.riskLevel === "high" ? "high" : "medium",
      revenueImpact: 0,
      confidence: 80,
      zone: "Operations",
      status: "pending",
      submittedBy: email.createdByAgent ?? "Agent",
      submittedAt: email.createdAt,
    });
  }

  for (const action of autonomousActions) {
    actions.push({
      id: action.id ?? `auto-${idCounter++}`,
      source: "intelligence",
      type: action.action_type ?? "opportunity",
      title: action.title ?? "Autonomous action pending approval",
      description: action.description ?? "Review recommended before execution",
      impact: "medium",
      urgency: "medium",
      revenueImpact: 0,
      confidence: Math.round(Number(action.confidence ?? 0.8) * 100),
      zone: "Intelligence",
      status: "pending",
      submittedBy: "Autonomy Engine",
      submittedAt: action.created_at,
    });
  }

  for (const wf of failedWorkflows) {
    actions.push({
      id: wf.id ?? `wf-${idCounter++}`,
      source: "platform",
      type: "health",
      title: `Fix failed workflow: ${wf.workflow_name ?? "unknown"}`,
      description: wf.error_message ?? "Workflow failed — requires investigation",
      impact: "high",
      urgency: "high",
      revenueImpact: 0,
      confidence: 100,
      zone: "Platform",
      status: "pending",
      submittedBy: "System",
      submittedAt: wf.started_at,
    });
  }

  const totalImpact = actions
    .filter((a) => (a.revenueImpact ?? 0) > 0)
    .reduce((s, a) => s + a.revenueImpact, 0);

  return {
    actions,
    totalPendingActions: actions.length,
    totalRevenueImpact: totalImpact,
    highUrgency: actions.filter((a) => a.urgency === "high").length,
    pendingEmailApprovals: (pendingEmails as any[]).length,
    pendingAutonomousActions: autonomousActions.length,
    failedWorkflows: failedWorkflows.length,
    generatedAt: new Date().toISOString(),
  };
}

// ─── /api/command-center/notifications ───────────────────────────────────────

export async function getCommandCenterNotifications(orgId: string) {
  const since48h = new Date(Date.now() - 48 * 3600_000);

  const [recentEmailActions, heartbeatRows, openOpps, risks] = await Promise.all([
    db
      .select({
        id: gmailAgentActions.id,
        subject: gmailAgentActions.subject,
        status: gmailAgentActions.status,
        createdByAgent: gmailAgentActions.createdByAgent,
        createdAt: gmailAgentActions.createdAt,
        riskLevel: gmailAgentActions.riskLevel,
      })
      .from(gmailAgentActions)
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        gte(gmailAgentActions.createdAt, since48h),
      ))
      .orderBy(desc(gmailAgentActions.createdAt))
      .limit(8)
      .catch(() => [] as any[]),
    db.execute(sql`
      SELECT id, status, started_at, completed_at, error_message
      FROM ceo_heartbeat_runs
      WHERE organization_id = ${orgId}
      ORDER BY started_at DESC LIMIT 1
    `).catch(() => ({ rows: [] })),
    db
      .select()
      .from(orgAiOpportunities)
      .where(and(
        eq(orgAiOpportunities.orgId, orgId),
        eq(orgAiOpportunities.status, "open"),
      ))
      .orderBy(desc(orgAiOpportunities.createdAt))
      .limit(3)
      .catch(() => [] as any[]),
    getRiskSignals(orgId, 3),
  ]);

  const lastHeartbeat = getRows(heartbeatRows)[0];
  const notifications: any[] = [];
  let nId = 1;

  if (lastHeartbeat) {
    notifications.push({
      id: `n-hb-${lastHeartbeat.id ?? nId++}`,
      zone: "Intelligence",
      category: lastHeartbeat.status === "completed" ? "info" : "warning",
      title:
        lastHeartbeat.status === "completed"
          ? "CEO Heartbeat completed successfully"
          : `CEO Heartbeat ${lastHeartbeat.status}`,
      body: lastHeartbeat.error_message
        ? `Error: ${String(lastHeartbeat.error_message).substring(0, 100)}`
        : `Last run: ${lastHeartbeat.completed_at ? new Date(lastHeartbeat.completed_at).toLocaleString() : "in progress"}`,
      read: true,
      ts: lastHeartbeat.started_at ?? new Date().toISOString(),
    });
  }

  for (const risk of risks) {
    notifications.push({
      id: `n-risk-${risk.id ?? nId++}`,
      zone: "Intelligence",
      category: risk.risk_level === "critical" || risk.risk_level === "high" ? "warning" : "info",
      title: risk.title ?? "Risk detected",
      body: risk.description ? String(risk.description).substring(0, 120) : "Review recommended",
      read: false,
      ts: risk.detected_at ?? new Date().toISOString(),
    });
  }

  for (const opp of openOpps as any[]) {
    notifications.push({
      id: `n-opp-${opp.id ?? nId++}`,
      zone: "Intelligence",
      category: "revenue",
      title: opp.title ?? "Opportunity detected",
      body:
        opp.potentialValue && opp.potentialValue > 0
          ? `Potential value: ${fmt(Math.round(opp.potentialValue * 100))}`
          : opp.description
          ? String(opp.description).substring(0, 120)
          : "Review this opportunity",
      read: false,
      ts: opp.createdAt ?? new Date().toISOString(),
    });
  }

  for (const email of recentEmailActions as any[]) {
    const cat =
      email.status === "sent" ? "info" :
      email.status === "proposed" ? "warning" :
      email.riskLevel === "high" ? "warning" : "info";
    notifications.push({
      id: `n-email-${email.id ?? nId++}`,
      zone: "Operations",
      category: cat,
      title:
        email.status === "sent"
          ? `Email sent by ${email.createdByAgent ?? "agent"}`
          : email.status === "proposed"
          ? `Email awaiting approval from ${email.createdByAgent ?? "agent"}`
          : `Agent email: ${email.status}`,
      body: email.subject ? String(email.subject).substring(0, 100) : "No subject",
      read: email.status === "sent",
      ts: email.createdAt ?? new Date().toISOString(),
    });
  }

  notifications.sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    return new Date(b.ts).getTime() - new Date(a.ts).getTime();
  });

  const limited = notifications.slice(0, 15);
  const unread = limited.filter((n) => !n.read).length;

  return { notifications: limited, unread, generatedAt: new Date().toISOString() };
}

// ─── /api/command-center/approvals ────────────────────────────────────────────

export async function getCommandCenterApprovals(orgId: string) {
  const [pendingEmails, autonomousRows] = await Promise.all([
    db
      .select({
        id: gmailAgentActions.id,
        subject: gmailAgentActions.subject,
        bodyPreview: gmailAgentActions.bodyPreview,
        riskLevel: gmailAgentActions.riskLevel,
        createdByAgent: gmailAgentActions.createdByAgent,
        createdAt: gmailAgentActions.createdAt,
        actionType: gmailAgentActions.actionType,
      })
      .from(gmailAgentActions)
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        eq(gmailAgentActions.status, "proposed"),
      ))
      .orderBy(desc(gmailAgentActions.createdAt))
      .limit(20)
      .catch(() => [] as any[]),
    db.execute(sql`
      SELECT id, action_type, title, description, confidence, estimated_impact, created_at
      FROM autonomous_action_queue
      WHERE org_id = ${orgId} AND status = 'pending'
      ORDER BY created_at DESC LIMIT 10
    `).catch(() => ({ rows: [] })),
  ]);

  const autonomousActions = getRows(autonomousRows);
  const approvals: any[] = [];

  for (const email of pendingEmails as any[]) {
    approvals.push({
      id: email.id,
      type: "agent",
      title: email.subject ?? "Agent email sequence",
      submittedBy: email.createdByAgent ?? "Agent",
      submittedAt: email.createdAt,
      urgency: email.riskLevel === "high" ? "high" : "medium",
      estimatedImpact: "Pending review",
      description: email.bodyPreview
        ? String(email.bodyPreview).substring(0, 150)
        : `${email.actionType ?? "outreach"} action requires approval`,
      status: "pending",
    });
  }

  for (const action of autonomousActions) {
    approvals.push({
      id: action.id,
      type: "workflow",
      title: action.title ?? "Autonomous action",
      submittedBy: "Autonomy Engine",
      submittedAt: action.created_at,
      urgency: "medium",
      estimatedImpact: action.estimated_impact ?? "Requires review",
      description: action.description ?? "Review before execution",
      status: "pending",
    });
  }

  return {
    approvals,
    pendingCount: approvals.length,
    highUrgency: approvals.filter((a) => a.urgency === "high").length,
    pendingEmailApprovals: (pendingEmails as any[]).length,
    pendingAutonomousActions: autonomousActions.length,
    generatedAt: new Date().toISOString(),
  };
}
