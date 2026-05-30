/**
 * AI Workforce Learning Engine — Phase 5
 *
 * Self-improvement loop. Analyzes execution outcomes, workflow performance,
 * recommendation quality, and forecast accuracy to generate improvement
 * opportunities and governance recommendations.
 *
 * No autonomous modifications — observations and recommendations only.
 */

import { db } from "./db";
import {
  orgAiExecutionPlans,
  orgAiLearningEvents,
  orgAiWorkforceMemory,
  workflowOptimizationRecs,
  orgAiExperiments,
  workflowJobs,
} from "@shared/schema";
import { eq, and, gte, desc, lt } from "drizzle-orm";
import { getPeriodStart } from "./workforce-attribution-engine";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImprovementOpportunity {
  id: string;
  type: "execution" | "workflow" | "recommendation" | "governance" | "agent";
  title: string;
  observation: string;
  suggestion: string;
  expectedLift: string;
  priority: "high" | "medium" | "low";
  evidence: string[];
}

export interface LearningInsight {
  period: string;
  totalLearningEvents: number;
  successRate: number;
  improvementTrend: "improving" | "stable" | "declining";
  topLesson: string;
  agentLessons: { agentId: string; lesson: string; score: number }[];
}

// ─── Analyze Execution History ────────────────────────────────────────────────

export async function analyzeExecutionHistory(orgId: string): Promise<ImprovementOpportunity[]> {
  const since30d = getPeriodStart("30d");
  const since7d = getPeriodStart("7d");
  const opportunities: ImprovementOpportunity[] = [];

  const [plans, events, memory] = await Promise.all([
    db.select().from(orgAiExecutionPlans).where(
      and(eq(orgAiExecutionPlans.orgId, orgId), gte(orgAiExecutionPlans.createdAt, since30d))
    ).catch(() => []),
    db.select().from(orgAiLearningEvents).where(
      and(eq(orgAiLearningEvents.orgId, orgId), gte(orgAiLearningEvents.createdAt, since30d))
    ).catch(() => []),
    db.select().from(orgAiWorkforceMemory).where(
      and(eq(orgAiWorkforceMemory.orgId, orgId), gte(orgAiWorkforceMemory.createdAt, since30d))
    ).catch(() => []),
  ]);

  // 1. Execution failure pattern
  const failed = plans.filter(p => p.executionStatus === "failed");
  const total = plans.length;
  if (total > 0 && failed.length / total > 0.15) {
    const failRate = Math.round((failed.length / total) * 100);
    const byType = new Map<string, number>();
    for (const p of failed) byType.set(p.executionType, (byType.get(p.executionType) ?? 0) + 1);
    const worstType = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
    opportunities.push({
      id: "exec_failure_rate",
      type: "execution",
      title: `Execution failure rate is ${failRate}%`,
      observation: `${failed.length} of ${total} execution plans failed in the last 30 days`,
      suggestion: `Review ${worstType?.[0] ?? "execution"} workflow configurations — most failures (${worstType?.[1] ?? 0}) occur in this category`,
      expectedLift: "Reduce failure rate by 60–80% with configuration review",
      priority: failRate > 30 ? "high" : "medium",
      evidence: [`${failed.length} failed plans recorded`, `Dominant failure type: ${worstType?.[0] ?? "unknown"}`],
    });
  }

  // 2. Approval queue bottleneck
  const awaitingApproval = plans.filter(p => p.executionStatus === "awaiting_approval");
  const staleApprovals = awaitingApproval.filter(p => {
    const ageHours = (Date.now() - new Date(p.createdAt).getTime()) / 3600000;
    return ageHours > 24;
  });
  if (staleApprovals.length >= 2) {
    opportunities.push({
      id: "approval_bottleneck",
      type: "governance",
      title: `${staleApprovals.length} execution plans stalled in approval queue`,
      observation: `${staleApprovals.length} plans have been awaiting approval for 24+ hours`,
      suggestion: "Consider enabling auto-approval for low-risk actions to reduce bottlenecks. Review approval rules configuration.",
      expectedLift: "30–50% reduction in execution latency",
      priority: staleApprovals.length >= 5 ? "high" : "medium",
      evidence: [
        `${staleApprovals.length} plans pending 24+ hours`,
        `Total blocked value: $${staleApprovals.reduce((s, p) => s + (p.estimatedValue ?? 0), 0).toFixed(0)}`,
      ],
    });
  }

  // 3. Recommendation rejection pattern
  const rejectedRecs = memory.filter(m => m.memoryType === "recommendation" && m.outcome === "rejected");
  const allRecs = memory.filter(m => m.memoryType === "recommendation");
  if (allRecs.length >= 3 && rejectedRecs.length / allRecs.length > 0.5) {
    opportunities.push({
      id: "recommendation_quality",
      type: "recommendation",
      title: "Recommendation acceptance rate is below 50%",
      observation: `${rejectedRecs.length} of ${allRecs.length} recommendations were rejected`,
      suggestion: "The intelligence engine should refine recommendation thresholds — increase confidence minimum and evidence requirements before surfacing",
      expectedLift: "Higher quality recommendations lead to 2x acceptance rates",
      priority: "medium",
      evidence: [
        `${rejectedRecs.length}/${allRecs.length} recommendations rejected`,
        "Rejected items are suppressed for 30 days per memory policy",
      ],
    });
  }

  // 4. Low learning event volume — agents not generating enough data
  const successEvents = events.filter(e => e.eventType === "success");
  const failureEvents = events.filter(e => e.eventType === "failure");
  if (events.length < 5) {
    opportunities.push({
      id: "low_learning_volume",
      type: "agent",
      title: "Learning signal volume is too low for reliable intelligence",
      observation: `Only ${events.length} learning events recorded in the last 30 days`,
      suggestion: "Activate more agents and enable execution plan creation to increase the data signal for the learning engine",
      expectedLift: "10x more data enables 3–5x better recommendation accuracy",
      priority: "medium",
      evidence: [
        `${successEvents.length} success events, ${failureEvents.length} failure events`,
        "Minimum threshold for reliable intelligence: 20+ events/month",
      ],
    });
  }

  // 5. Workflow optimization — generate recommendations for underperforming workflows
  const recentJobs = await db.select().from(workflowJobs).where(
    and(eq(workflowJobs.orgId, orgId), gte(workflowJobs.scheduledFor, since30d))
  ).catch(() => []);

  if (recentJobs.length > 5) {
    const failed30d = recentJobs.filter(j => j.status === "failed");
    if (failed30d.length > 0) {
      // Upsert a workflow optimization rec
      await db.insert(workflowOptimizationRecs).values({
        orgId,
        workflowName: "Overall Workflow Suite",
        currentConversion: Math.round(100 * (recentJobs.length - failed30d.length) / recentJobs.length),
        suggestedChange: "Review and fix failing workflow configurations",
        rationale: `${failed30d.length} job failures detected in the last 30 days`,
        expectedConversion: Math.min(100, Math.round(100 * (recentJobs.length - failed30d.length) / recentJobs.length) + 15),
        confidence: 0.80,
        estimatedLift: 0.15,
        status: "pending",
      }).catch(() => {});
    }
  }

  return opportunities.sort((a, b) => {
    const p = { high: 3, medium: 2, low: 1 };
    return p[b.priority] - p[a.priority];
  });
}

// ─── Learning Insights ────────────────────────────────────────────────────────

export async function computeLearningInsights(orgId: string): Promise<LearningInsight> {
  const since30d = getPeriodStart("30d");
  const since60d = new Date(Date.now() - 60 * 86400000);

  const [recent, older] = await Promise.all([
    db.select().from(orgAiLearningEvents).where(
      and(eq(orgAiLearningEvents.orgId, orgId), gte(orgAiLearningEvents.createdAt, since30d))
    ).catch(() => []),
    db.select().from(orgAiLearningEvents).where(
      and(eq(orgAiLearningEvents.orgId, orgId), gte(orgAiLearningEvents.createdAt, since60d), lt(orgAiLearningEvents.createdAt, since30d))
    ).catch(() => []),
  ]);

  const success = recent.filter(e => e.eventType === "success");
  const failure = recent.filter(e => e.eventType === "failure");
  const total = recent.length;
  const successRate = total > 0 ? Math.round((success.length / total) * 100) : 0;

  const prevSuccess = older.filter(e => e.eventType === "success").length;
  const prevTotal = older.length;
  const prevRate = prevTotal > 0 ? prevSuccess / prevTotal : 0.5;

  const improvementTrend: LearningInsight["improvementTrend"] =
    successRate / 100 > prevRate + 0.05 ? "improving" :
    successRate / 100 < prevRate - 0.05 ? "declining" : "stable";

  const topLesson = success.length > failure.length
    ? "Agent execution success rate is above baseline — current configurations are working well"
    : failure.length > 0
    ? "Execution failures are generating learning data — review failure contexts to identify patterns"
    : "Insufficient execution data for pattern analysis — activate more agents to build learning signal";

  // Per-agent lessons
  const agentMap = new Map<string, { success: number; total: number }>();
  for (const e of recent) {
    const aid = e.agentId ?? "unknown";
    if (!agentMap.has(aid)) agentMap.set(aid, { success: 0, total: 0 });
    const entry = agentMap.get(aid)!;
    entry.total++;
    if (e.eventType === "success") entry.success++;
  }

  const agentLessons = [...agentMap.entries()].map(([agentId, data]) => ({
    agentId,
    lesson: data.success / Math.max(1, data.total) >= 0.8
      ? "High success rate — candidate for expanded autonomy"
      : data.total === 0
      ? "No data this period — activate to generate learning signal"
      : "Below optimal — review configuration and governance settings",
    score: Math.round((data.success / Math.max(1, data.total)) * 100),
  }));

  return {
    period: "30d",
    totalLearningEvents: total,
    successRate,
    improvementTrend,
    topLesson,
    agentLessons,
  };
}

// ─── Generate Governance Recommendations ─────────────────────────────────────

export async function generateGovernanceRecommendations(orgId: string, trustScore: number, tier: string): Promise<string[]> {
  const recommendations: string[] = [];

  if (tier === "Autonomous Ready") {
    recommendations.push("Expand auto-approval to medium-risk actions — trust score qualifies for reduced oversight");
    recommendations.push("Enable background execution for routine lead follow-up and scheduling campaigns");
  } else if (tier === "Highly Trusted") {
    recommendations.push("Expand auto-approval rules to include low-risk communication actions");
    recommendations.push("Consider moving from \"balanced\" to \"balanced+\" governance mode");
  } else if (tier === "Trusted") {
    recommendations.push("Current governance level is appropriate — build more execution history before expanding autonomy");
    recommendations.push("Enable auto-approval for schedule reminders and low-stakes notifications only");
  } else if (tier === "Developing") {
    recommendations.push("Keep strict manual approval for all medium+ risk actions");
    recommendations.push("Focus on increasing execution success rate before considering autonomy expansion");
  } else {
    recommendations.push("Maintain strict governance mode — all actions require human review");
    recommendations.push("Run at least 20 successful executions before reviewing autonomy settings");
  }

  return recommendations;
}
