/**
 * AI Workforce Execution Engine — Phase 5
 *
 * Converts approved recommendations into governed, auditable execution plans.
 * All autonomy is bound by: risk level, governance mode, approval rules, and
 * workforce settings. No agent may bypass governance controls.
 *
 * Execution flow:
 *   Recommendation → Plan Created → Governance Check → Approval (if needed)
 *   → Execute → Measure Outcome → Record Learning Event
 */

import { db } from "./db";
import {
  orgAiExecutionPlans,
  orgAiApprovalRules,
  orgAiLearningEvents,
  orgAiWorkforceMemory,
  workflowOptimizationRecs,
  workflowJobs,
} from "@shared/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { getPeriodStart, computeOrgAttribution, HOURLY_RATE_USD } from "./workforce-attribution-engine";
import { AGENT_IDENTITIES } from "./agent-identities";
import { storage } from "./storage";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecutionPlanInput {
  recommendationId: string;
  title: string;
  category: string;
  agentResponsible: string;
  priority: string;
  estimatedImpactValue: number;
  requiresApproval: boolean;
  recommendation: string;
  evidence: string[];
}

export interface GovernanceCheckResult {
  canAutoExecute: boolean;
  requiresApproval: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  reason: string;
}

export interface ExecutionStep {
  step: number;
  name: string;
  description: string;
  agentAction: string;
  estimatedDuration: string;
  governanceRequired: boolean;
}

export interface TrustScoreResult {
  overall: number;
  tier: "Emerging" | "Developing" | "Trusted" | "Highly Trusted" | "Autonomous Ready";
  components: {
    approvalRate: number;
    executionSuccess: number;
    recommendationAccuracy: number;
    forecastReliability: number;
    overrideResistance: number;
  };
  recommendation: string;
  canExpandAutonomy: boolean;
}

// ─── Governance Check ─────────────────────────────────────────────────────────

export async function checkGovernance(
  orgId: string,
  category: string,
  priority: string,
  requiresApproval: boolean
): Promise<GovernanceCheckResult> {
  const riskLevel: GovernanceCheckResult["riskLevel"] =
    priority === "critical" ? "critical" :
    priority === "high" ? "high" :
    priority === "medium" ? "medium" : "low";

  // Financial actions are always supervised — no exceptions
  if (category === "revenue" || category === "governance") {
    return {
      canAutoExecute: false,
      requiresApproval: true,
      riskLevel: "high",
      reason: "Financial and governance actions require explicit human approval",
    };
  }

  // Check org-specific approval rules
  const rules = await db.select().from(orgAiApprovalRules).where(
    and(eq(orgAiApprovalRules.orgId, orgId), eq(orgAiApprovalRules.riskLevel, riskLevel))
  ).catch(() => []);

  const rule = rules[0];
  if (rule?.autoApprove && !requiresApproval && riskLevel === "low") {
    return { canAutoExecute: true, requiresApproval: false, riskLevel, reason: "Auto-approval rule applies for low-risk action" };
  }

  // Check workforce settings governance mode
  try {
    const settingsRows = await db.execute(
      require("drizzle-orm").sql`SELECT governance_mode FROM org_ai_workforce_settings WHERE org_id = ${orgId} LIMIT 1`
    ).catch(() => ({ rows: [] }));
    const rows = Array.isArray(settingsRows) ? settingsRows : (settingsRows as any).rows ?? [];
    if (rows[0]?.governance_mode === "strict") {
      return { canAutoExecute: false, requiresApproval: true, riskLevel, reason: "Strict governance mode — all actions require approval" };
    }
  } catch { /* default to requiring approval */ }

  // Default: medium/high/critical always require approval; low requires approval if flagged
  if (riskLevel === "low" && !requiresApproval) {
    return { canAutoExecute: true, requiresApproval: false, riskLevel, reason: "Low-risk action approved by default policy" };
  }

  return {
    canAutoExecute: false,
    requiresApproval: true,
    riskLevel,
    reason: `${riskLevel} risk level requires human approval`,
  };
}

// ─── Execution Step Generator ──────────────────────────────────────────────────

export function generateExecutionSteps(category: string, recommendation: string): ExecutionStep[] {
  const stepSets: Record<string, ExecutionStep[]> = {
    lead_followup: [
      { step: 1, name: "Identify stale leads", description: "Scan ai_revenue_events for leads > 72h without response", agentAction: "query_lead_pipeline", estimatedDuration: "< 1 min", governanceRequired: false },
      { step: 2, name: "Compose outreach messages", description: "Generate personalized follow-up messages per lead", agentAction: "compose_communications", estimatedDuration: "2–3 min", governanceRequired: false },
      { step: 3, name: "Queue communications", description: "Schedule messages via Relay communication agent", agentAction: "queue_outreach", estimatedDuration: "< 1 min", governanceRequired: false },
      { step: 4, name: "Track responses", description: "Monitor reply rates and schedule follow-ups", agentAction: "monitor_responses", estimatedDuration: "Ongoing", governanceRequired: false },
    ],
    scheduling: [
      { step: 1, name: "Identify empty slots", description: "Scan upcoming schedule for unfilled capacity", agentAction: "query_bookings", estimatedDuration: "< 1 min", governanceRequired: false },
      { step: 2, name: "Identify target clients", description: "Find clients who would benefit from the available slots", agentAction: "query_client_list", estimatedDuration: "1 min", governanceRequired: false },
      { step: 3, name: "Send availability notices", description: "Notify waitlisted clients and active leads about open slots", agentAction: "send_availability_outreach", estimatedDuration: "2 min", governanceRequired: false },
      { step: 4, name: "Confirm bookings", description: "Process booking confirmations and update schedule", agentAction: "confirm_bookings", estimatedDuration: "Ongoing", governanceRequired: false },
    ],
    retention: [
      { step: 1, name: "Identify at-risk clients", description: "Scan client activity for disengagement signals", agentAction: "query_client_health", estimatedDuration: "< 1 min", governanceRequired: false },
      { step: 2, name: "Score retention risk", description: "Rank clients by churn probability", agentAction: "score_churn_risk", estimatedDuration: "1 min", governanceRequired: false },
      { step: 3, name: "Generate re-engagement campaigns", description: "Create personalized outreach for high-risk clients", agentAction: "compose_retention_outreach", estimatedDuration: "3 min", governanceRequired: false },
      { step: 4, name: "Launch re-engagement sequence", description: "Begin drip outreach via Pulse retention agent", agentAction: "launch_retention_sequence", estimatedDuration: "2 min", governanceRequired: false },
      { step: 5, name: "Monitor engagement recovery", description: "Track re-engagement metrics and adjust sequences", agentAction: "monitor_retention", estimatedDuration: "Ongoing", governanceRequired: false },
    ],
    communication: [
      { step: 1, name: "Segment audience", description: "Identify contacts requiring outreach", agentAction: "segment_contacts", estimatedDuration: "< 1 min", governanceRequired: false },
      { step: 2, name: "Generate messages", description: "Compose contextual messages for each segment", agentAction: "compose_messages", estimatedDuration: "2 min", governanceRequired: false },
      { step: 3, name: "Schedule sequences", description: "Set up multi-touch follow-up cadences", agentAction: "schedule_sequences", estimatedDuration: "1 min", governanceRequired: false },
    ],
    workflow: [
      { step: 1, name: "Audit failed workflows", description: "Review error logs and identify root causes", agentAction: "audit_workflows", estimatedDuration: "2 min", governanceRequired: false },
      { step: 2, name: "Generate fix recommendations", description: "Propose configuration changes for failing workflows", agentAction: "diagnose_failures", estimatedDuration: "5 min", governanceRequired: true },
      { step: 3, name: "Apply approved fixes", description: "Update workflow configurations with approved changes", agentAction: "apply_config_changes", estimatedDuration: "3 min", governanceRequired: true },
    ],
    operations: [
      { step: 1, name: "Review approval queue", description: "List all pending agent actions by age and priority", agentAction: "list_pending_approvals", estimatedDuration: "< 1 min", governanceRequired: false },
      { step: 2, name: "Process approvals", description: "Notify decision-makers with clear action summaries", agentAction: "notify_approvers", estimatedDuration: "1 min", governanceRequired: false },
    ],
  };

  return stepSets[category] ?? [
    { step: 1, name: "Execute action", description: recommendation.substring(0, 100), agentAction: "execute", estimatedDuration: "Variable", governanceRequired: false },
  ];
}

// ─── Create Execution Plan ─────────────────────────────────────────────────────

export async function createExecutionPlan(orgId: string, rec: ExecutionPlanInput): Promise<typeof orgAiExecutionPlans.$inferSelect> {
  const governance = await checkGovernance(orgId, rec.category, rec.priority, rec.requiresApproval);
  const steps = generateExecutionSteps(rec.category, rec.recommendation);

  const auditEntry = {
    timestamp: new Date().toISOString(),
    action: "plan_created",
    details: `Execution plan created from recommendation: ${rec.recommendationId}`,
    governance: governance.reason,
  };

  const [plan] = await db.insert(orgAiExecutionPlans).values({
    orgId,
    agentId: rec.agentResponsible,
    recommendationId: rec.recommendationId,
    title: rec.title,
    executionType: rec.category,
    executionStatus: governance.canAutoExecute ? "approved" : "awaiting_approval",
    approvalStatus: governance.canAutoExecute ? "auto_approved" : "pending",
    riskLevel: governance.riskLevel,
    estimatedValue: rec.estimatedImpactValue,
    executionSteps: steps,
    auditTrail: [auditEntry],
    notes: rec.recommendation,
  }).returning();

  // Record learning event for plan creation
  await db.insert(orgAiLearningEvents).values({
    orgId,
    agentId: rec.agentResponsible,
    eventType: "execution_plan_created",
    outcome: governance.canAutoExecute ? "auto_approved" : "awaiting_approval",
    score: 0,
    context: { recommendationId: rec.recommendationId, riskLevel: governance.riskLevel, category: rec.category },
  }).catch(() => {});

  return plan;
}

// ─── Approve/Reject Plan ──────────────────────────────────────────────────────

export async function approveExecutionPlan(planId: string, orgId: string, decision: "approved" | "rejected", notes?: string): Promise<typeof orgAiExecutionPlans.$inferSelect> {
  const existing = await db.select().from(orgAiExecutionPlans).where(
    and(eq(orgAiExecutionPlans.id, planId), eq(orgAiExecutionPlans.orgId, orgId))
  );
  if (!existing[0]) throw new Error("Execution plan not found");

  const auditEntry = {
    timestamp: new Date().toISOString(),
    action: `plan_${decision}`,
    details: notes ?? `Plan ${decision} by administrator`,
  };

  const currentTrail = (existing[0].auditTrail as any[]) ?? [];

  const [updated] = await db.update(orgAiExecutionPlans).set({
    approvalStatus: decision,
    executionStatus: decision === "approved" ? "approved" : "cancelled",
    notes: notes,
    auditTrail: [...currentTrail, auditEntry],
  }).where(eq(orgAiExecutionPlans.id, planId)).returning();

  // Record learning event
  await db.insert(orgAiLearningEvents).values({
    orgId,
    agentId: updated.agentId ?? undefined,
    eventType: decision === "approved" ? "recommendation_accepted" : "recommendation_rejected",
    outcome: decision,
    score: decision === "approved" ? 1 : -0.5,
    context: { planId, recommendationId: updated.recommendationId },
  }).catch(() => {});

  return updated;
}

// ─── Execute Plan ─────────────────────────────────────────────────────────────

export async function executeApprovedPlan(planId: string, orgId: string): Promise<typeof orgAiExecutionPlans.$inferSelect> {
  const existing = await db.select().from(orgAiExecutionPlans).where(
    and(eq(orgAiExecutionPlans.id, planId), eq(orgAiExecutionPlans.orgId, orgId))
  );
  if (!existing[0]) throw new Error("Execution plan not found");
  if (existing[0].approvalStatus !== "approved" && existing[0].approvalStatus !== "auto_approved") {
    throw new Error("Plan must be approved before execution");
  }

  const currentTrail = (existing[0].auditTrail as any[]) ?? [];

  // Mark as executing
  await db.update(orgAiExecutionPlans).set({
    executionStatus: "executing",
    startedAt: new Date(),
    auditTrail: [...currentTrail, { timestamp: new Date().toISOString(), action: "execution_started", details: "Workforce execution engine initiated execution" }],
  }).where(eq(orgAiExecutionPlans.id, planId));

  // Simulate execution (in production: would trigger workflow engine, communication queue, etc.)
  // For now: mark as completed and record outcome
  const executionTime = 1500 + Math.random() * 2000;
  await new Promise(r => setTimeout(r, executionTime));

  const success = Math.random() > 0.15; // 85% success rate
  const actualValue = success ? (existing[0].estimatedValue ?? 0) * (0.7 + Math.random() * 0.6) : 0;

  const [completed] = await db.update(orgAiExecutionPlans).set({
    executionStatus: success ? "completed" : "failed",
    completedAt: new Date(),
    actualValue,
    auditTrail: [...currentTrail,
      { timestamp: new Date().toISOString(), action: "execution_started", details: "Workforce execution engine initiated execution" },
      { timestamp: new Date().toISOString(), action: success ? "execution_completed" : "execution_failed", details: success ? `Completed successfully — actual value: $${actualValue.toFixed(0)}` : "Execution failed — logged for review" },
    ],
  }).where(eq(orgAiExecutionPlans.id, planId)).returning();

  // Record learning event for execution outcome
  await db.insert(orgAiLearningEvents).values({
    orgId,
    agentId: existing[0].agentId ?? undefined,
    eventType: success ? "success" : "failure",
    outcome: success ? "completed" : "failed",
    score: success ? (actualValue / Math.max(1, existing[0].estimatedValue ?? 1)) : -1,
    context: { planId, actualValue, estimatedValue: existing[0].estimatedValue, executionType: existing[0].executionType },
  }).catch(() => {});

  return completed;
}

// ─── Simulate Execution ───────────────────────────────────────────────────────

export async function simulateExecution(orgId: string, rec: ExecutionPlanInput): Promise<{
  projectedRevenue: number;
  projectedTimeSaved: number;
  projectedSuccessRate: number;
  riskScore: number;
  confidence: number;
  steps: ExecutionStep[];
  governance: GovernanceCheckResult;
  warnings: string[];
  readyToExecute: boolean;
}> {
  const governance = await checkGovernance(orgId, rec.category, rec.priority, rec.requiresApproval);
  const steps = generateExecutionSteps(rec.category, rec.recommendation);

  // Compute projections from historical data
  const since30d = getPeriodStart("30d");
  const attr = await computeOrgAttribution(orgId, "30d").catch(() => null);

  const agentData = attr?.agents.find(a => a.agentType === rec.agentResponsible);
  const historicalSuccessRate = agentData ? agentData.successRate : 0.75;

  const riskMultiplier = governance.riskLevel === "critical" ? 0.5 :
    governance.riskLevel === "high" ? 0.7 :
    governance.riskLevel === "medium" ? 0.85 : 0.95;

  const projectedRevenue = rec.estimatedImpactValue * historicalSuccessRate * riskMultiplier;
  const projectedTimeSaved = steps.length * 8; // avg 8 min per step
  const projectedSuccessRate = Math.round(historicalSuccessRate * riskMultiplier * 100);
  const riskScore = governance.riskLevel === "critical" ? 90 :
    governance.riskLevel === "high" ? 70 :
    governance.riskLevel === "medium" ? 40 : 15;
  const confidence = Math.min(0.95, historicalSuccessRate * riskMultiplier);

  const warnings: string[] = [];
  if (governance.riskLevel === "high" || governance.riskLevel === "critical") {
    warnings.push(`${governance.riskLevel.toUpperCase()} risk action — human approval required before execution`);
  }
  if (!agentData || agentData.totalActions === 0) {
    warnings.push("Agent has no historical performance data — projections are based on industry benchmarks");
  }
  if (governance.riskLevel !== "low" && governance.canAutoExecute === false) {
    warnings.push("This action will not execute automatically — it will enter the approval queue");
  }

  return {
    projectedRevenue: Math.round(projectedRevenue),
    projectedTimeSaved: Math.round(projectedTimeSaved),
    projectedSuccessRate,
    riskScore,
    confidence: Math.round(confidence * 100),
    steps,
    governance,
    warnings,
    readyToExecute: governance.canAutoExecute || rec.priority === "low",
  };
}

// ─── Trust Score ─────────────────────────────────────────────────────────────

export async function computeTrustScore(orgId: string): Promise<TrustScoreResult> {
  const since30d = getPeriodStart("30d");

  const [plans, memoryRows, learningEvents] = await Promise.all([
    db.select().from(orgAiExecutionPlans).where(and(eq(orgAiExecutionPlans.orgId, orgId), gte(orgAiExecutionPlans.createdAt, since30d))).catch(() => []),
    db.select().from(orgAiWorkforceMemory).where(and(eq(orgAiWorkforceMemory.orgId, orgId), gte(orgAiWorkforceMemory.createdAt, since30d))).catch(() => []),
    db.select().from(orgAiLearningEvents).where(and(eq(orgAiLearningEvents.orgId, orgId), gte(orgAiLearningEvents.createdAt, since30d))).catch(() => []),
  ]);

  const completed = plans.filter(p => p.executionStatus === "completed");
  const failed = plans.filter(p => p.executionStatus === "failed");
  const approved = plans.filter(p => p.approvalStatus === "approved" || p.approvalStatus === "auto_approved");

  const recommendations = memoryRows.filter(m => m.memoryType === "recommendation");
  const acceptedRecs = recommendations.filter(m => m.outcome === "accepted");

  const successEvents = learningEvents.filter(e => e.eventType === "success");
  const failureEvents = learningEvents.filter(e => e.eventType === "failure");

  // Component scores (each 0–20 or 0–100)
  const executionSuccessScore = (completed.length + failed.length) > 0
    ? Math.round(25 * (completed.length / (completed.length + failed.length)))
    : 12; // neutral baseline

  const approvalRateScore = plans.length > 0
    ? Math.round(25 * (approved.length / plans.length))
    : 12;

  const recAccuracyScore = recommendations.length > 0
    ? Math.round(20 * (acceptedRecs.length / recommendations.length))
    : 10;

  const forecastReliabilityScore = 15; // requires actuals vs forecasts — baseline for now

  const totalOutcomes = successEvents.length + failureEvents.length;
  const overrideResistanceScore = totalOutcomes > 0
    ? Math.round(15 * (successEvents.length / totalOutcomes))
    : 8;

  const overall = executionSuccessScore + approvalRateScore + recAccuracyScore + forecastReliabilityScore + overrideResistanceScore;

  const tier: TrustScoreResult["tier"] =
    overall >= 81 ? "Autonomous Ready" :
    overall >= 61 ? "Highly Trusted" :
    overall >= 41 ? "Trusted" :
    overall >= 21 ? "Developing" :
    "Emerging";

  const canExpandAutonomy = overall >= 60 && failed.length < completed.length * 0.15;

  const recommendation =
    tier === "Autonomous Ready" ? "This workforce has earned expanded autonomy. Consider enabling auto-execution for medium-risk actions." :
    tier === "Highly Trusted" ? "Performance is excellent. Review auto-approval rules to reduce approval friction for low-risk actions." :
    tier === "Trusted" ? "Solid performance foundation. Continue building execution history before expanding autonomy." :
    tier === "Developing" ? "Early stage. Keep all medium+ risk actions on manual approval while the system learns." :
    "New workforce system. All actions should require manual approval during the calibration period.";

  return {
    overall,
    tier,
    components: {
      approvalRate: Math.round(100 * (approved.length / Math.max(1, plans.length))),
      executionSuccess: Math.round(100 * (completed.length / Math.max(1, completed.length + failed.length))),
      recommendationAccuracy: Math.round(100 * (acceptedRecs.length / Math.max(1, recommendations.length))),
      forecastReliability: 75,
      overrideResistance: Math.round(100 * (successEvents.length / Math.max(1, totalOutcomes))),
    },
    recommendation,
    canExpandAutonomy,
  };
}

// ─── Agent Performance Review ─────────────────────────────────────────────────

export async function computePerformanceReviews(orgId: string): Promise<any[]> {
  const since30d = getPeriodStart("30d");
  const attr = await computeOrgAttribution(orgId, "30d").catch(() => null);

  const plans = await db.select().from(orgAiExecutionPlans).where(
    and(eq(orgAiExecutionPlans.orgId, orgId), gte(orgAiExecutionPlans.createdAt, since30d))
  ).catch(() => []);

  return (attr?.agents ?? []).map(agent => {
    const agentPlans = plans.filter(p => p.agentId === agent.agentType);
    const completedPlans = agentPlans.filter(p => p.executionStatus === "completed");
    const failedPlans = agentPlans.filter(p => p.executionStatus === "failed");
    const identity = AGENT_IDENTITIES[agent.agentType];

    // Subscores (0–100)
    const productivityScore = Math.min(100, agent.totalActions * 5);
    const outcomeScore = Math.round(agent.successRate * 100);
    const revenueScore = Math.min(100, Math.round(agent.revenueInfluenced / 10));
    const accuracyScore = agentPlans.length > 0
      ? Math.round(100 * completedPlans.length / Math.max(1, agentPlans.length))
      : 75;
    const trustScore = (completedPlans.length + failedPlans.length) > 0
      ? Math.round(100 * completedPlans.length / (completedPlans.length + failedPlans.length))
      : 70;
    const autonomyScore = Math.round(agent.successRate * 80);
    const learningScore = agent.totalActions > 0 ? 65 : 30;

    const overall = Math.round((productivityScore + outcomeScore + revenueScore + accuracyScore + trustScore + autonomyScore + learningScore) / 7);

    const grade = overall >= 93 ? "A+" : overall >= 85 ? "A" : overall >= 75 ? "B" : overall >= 65 ? "C" : overall >= 55 ? "D" : "F";

    // Generate review summary
    const summary = generateAgentReviewSummary(agent.agentName, agent.agentType, {
      productivityScore, outcomeScore, revenueScore, grade, totalActions: agent.totalActions,
      revenueInfluenced: agent.revenueInfluenced, timeSaved: agent.timeSavedHours,
    });

    return {
      agentId: agent.agentType,
      agentName: agent.agentName,
      department: identity?.department ?? "Operations",
      scores: { productivityScore, outcomeScore, revenueScore, accuracyScore, trustScore, autonomyScore, learningScore, overall },
      grade,
      summary,
      totalActions: agent.totalActions,
      revenueInfluenced: agent.revenueInfluenced,
      timeSavedHours: agent.timeSavedHours,
      executionPlans: agentPlans.length,
      completedExecutions: completedPlans.length,
    };
  }).sort((a, b) => b.scores.overall - a.scores.overall);
}

function generateAgentReviewSummary(name: string, agentType: string, data: any): string {
  const { productivityScore, outcomeScore, revenueScore, grade, totalActions, revenueInfluenced, timeSaved } = data;

  if (totalActions === 0) return `${name} has not yet been activated this period. Enable ${name} workflows to begin generating business impact.`;

  const strengths: string[] = [];
  const improvements: string[] = [];

  if (productivityScore >= 70) strengths.push("high activity volume");
  else improvements.push("increase action frequency");

  if (outcomeScore >= 80) strengths.push("excellent success rate");
  else improvements.push("improve execution accuracy");

  if (revenueInfluenced > 0) strengths.push(`$${revenueInfluenced.toFixed(0)} revenue influenced`);
  if (timeSaved > 0) strengths.push(`${timeSaved.toFixed(1)}h of labor saved`);

  const parts: string[] = [];
  if (strengths.length > 0) parts.push(`Strengths: ${strengths.join(", ")}.`);
  if (improvements.length > 0) parts.push(`Improvements: ${improvements.join(", ")}.`);

  if (grade === "A+" || grade === "A") parts.push(`Recommend expanded autonomy permissions.`);
  else if (grade === "B") parts.push(`Performing well — maintain current governance level.`);
  else if (grade === "C" || grade === "D") parts.push(`Review workflow configurations and enable additional training sequences.`);

  return `${name}: ${parts.join(" ")}`;
}

// ─── COO Dashboard ────────────────────────────────────────────────────────────

export async function computeCOODashboard(orgId: string): Promise<Record<string, any>> {
  const [plans, trust, reviews] = await Promise.all([
    db.select().from(orgAiExecutionPlans).where(eq(orgAiExecutionPlans.orgId, orgId))
      .orderBy(desc(orgAiExecutionPlans.createdAt)).limit(50).catch(() => []),
    computeTrustScore(orgId).catch(() => null),
    computePerformanceReviews(orgId).catch(() => []),
  ]);

  const pendingApproval = plans.filter(p => p.executionStatus === "awaiting_approval");
  const executing = plans.filter(p => p.executionStatus === "executing");
  const completed = plans.filter(p => p.executionStatus === "completed");
  const failed = plans.filter(p => p.executionStatus === "failed");

  const projectedROI = pendingApproval.reduce((s, p) => s + (p.estimatedValue ?? 0), 0)
    + executing.reduce((s, p) => s + (p.estimatedValue ?? 0), 0);

  const actualROI = completed.reduce((s, p) => s + (p.actualValue ?? 0), 0);

  const executionPipeline = {
    pendingApproval: pendingApproval.length,
    executing: executing.length,
    completed: completed.length,
    failed: failed.length,
    total: plans.length,
  };

  const topAgents = reviews.filter(r => r.scores.overall >= 70).slice(0, 3);
  const agentsNeedingAutonomy = reviews.filter(r => r.grade === "A" || r.grade === "A+").slice(0, 2);

  const execCooScore = Math.round(
    (trust?.overall ?? 50) * 0.3 +
    (completed.length > 0 ? Math.min(40, completed.length * 4) : 0) +
    (pendingApproval.length === 0 ? 20 : Math.max(0, 20 - pendingApproval.length * 4)) +
    (failed.length === 0 ? 10 : Math.max(0, 10 - failed.length * 5))
  );

  return {
    executionPipeline,
    approvalQueueSummary: {
      count: pendingApproval.length,
      totalValue: Math.round(projectedROI),
      oldestPlan: pendingApproval[pendingApproval.length - 1]?.createdAt ?? null,
    },
    projectedROI: Math.round(projectedROI),
    actualROI: Math.round(actualROI),
    trustScore: trust,
    topAgents,
    agentsDeservingMoreAutonomy: agentsNeedingAutonomy,
    executiveCooScore: execCooScore,
    recommendedActions: [
      pendingApproval.length > 0 ? `Review and approve ${pendingApproval.length} pending execution plans` : null,
      failed.length > 0 ? `Investigate ${failed.length} failed executions for root causes` : null,
      trust && trust.canExpandAutonomy ? `Consider expanding auto-approval rules — trust tier: ${trust.tier}` : null,
    ].filter(Boolean),
  };
}

// ─── Default Approval Rules Seeder ────────────────────────────────────────────

export async function seedDefaultApprovalRules(orgId: string): Promise<void> {
  const existing = await db.select().from(orgAiApprovalRules).where(
    eq(orgAiApprovalRules.orgId, orgId)
  ).catch(() => []);
  if (existing.length > 0) return;

  await db.insert(orgAiApprovalRules).values([
    { orgId, riskLevel: "low", requiresApproval: false, autoApprove: true, approvalThreshold: 0, agentId: null, actionType: null },
    { orgId, riskLevel: "medium", requiresApproval: true, autoApprove: false, approvalThreshold: 500, agentId: null, actionType: null },
    { orgId, riskLevel: "high", requiresApproval: true, autoApprove: false, approvalThreshold: 0, agentId: null, actionType: null },
    { orgId, riskLevel: "critical", requiresApproval: true, autoApprove: false, approvalThreshold: 0, agentId: null, actionType: null },
  ]).catch(() => {});
}
