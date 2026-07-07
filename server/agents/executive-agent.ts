import { db } from "../db";
import { agentSignals, agentRecommendations, executiveBriefs, orchestratorRuns } from "@shared/schema";
import { eq, and, desc, gte, inArray } from "drizzle-orm";
import { subDays } from "date-fns";
import { runRetentionAgent } from "./retention-agent";
import { runSchedulingAgent } from "./scheduling-agent";
import { runGrowthAgent } from "./growth-agent";
import { runClientSuccessAgent } from "./client-success-agent";
import { runRevenueAgent } from "../revenue-agent";
import { logUnifiedAction } from "../unified-action-logger";

export interface OrchestratorResult {
  runId: string;
  healthScore: number;
  totalSignals: number;
  totalRecommendations: number;
  agentSummary: Record<string, { signals: number; recommendations: number }>;
  topRecommendations: Array<{
    id: string;
    title: string;
    description: string;
    agentType: string;
    severity: string;
    priorityScore: number;
    estimatedImpact: number;
    crossAgentTypes: string[];
    entityName: string | null;
    actionType: string | null;
  }>;
  executiveBrief: {
    biggestOpportunity: Record<string, unknown>;
    highestChurnRisk: Record<string, unknown>;
    schedulingInefficiency: Record<string, unknown>;
    mostValuableLead: Record<string, unknown>;
    projectedWeeklyRevenue: number;
    recommendedActions: string[];
  };
}

const AGENT_TYPES = ["retention", "scheduling", "growth", "client_success", "revenue"] as const;

export async function runOrchestrator(orgId: string, triggeredBy = "manual"): Promise<OrchestratorResult> {
  // Create run record
  const [run] = await db
    .insert(orchestratorRuns)
    .values({ orgId, triggeredBy, agentsRun: [], status: "running" })
    .returning();

  try {
    let totalSignals = 0;
    let totalRecommendations = 0;
    const agentSummary: Record<string, { signals: number; recommendations: number }> = {};
    const allSignalInserts: (typeof agentSignals.$inferInsert)[] = [];
    const allRecommendationInserts: (typeof agentRecommendations.$inferInsert)[] = [];

    // --- Run all specialized agents in parallel ---
    const [retentionResult, schedulingResult, growthResult, clientSuccessResult] = await Promise.all([
      runRetentionAgent(orgId).catch((e) => { console.error("[RetentionAgent]", e.message); return null; }),
      runSchedulingAgent(orgId).catch((e) => { console.error("[SchedulingAgent]", e.message); return null; }),
      runGrowthAgent(orgId).catch((e) => { console.error("[GrowthAgent]", e.message); return null; }),
      runClientSuccessAgent(orgId).catch((e) => { console.error("[ClientSuccessAgent]", e.message); return null; }),
    ]);

    // Also run revenue agent (existing) — get its actions as signals
    let revenueActions: Array<{ estimatedValue: number; reason: string; actionType: string; dealId: string | null; priority: number; status: string }> = [];
    try {
      await runRevenueAgent(orgId);
      const { getAgentActions } = await import("../storage").then((m) => m.storage);
      const actions = await (await import("../storage")).storage.getRevenueAgentActions(orgId, "pending");
      revenueActions = actions.map((a) => ({
        estimatedValue: a.estimatedValue || 0,
        reason: a.reason,
        actionType: a.actionType,
        dealId: a.dealId,
        priority: a.priority || 50,
        status: a.status,
      }));
    } catch (e: any) {
      console.error("[RevenueAgent]", e.message);
    }

    // --- Collect retention signals ---
    if (retentionResult) {
      for (const s of retentionResult.signals) {
        allSignalInserts.push({ orgId, agentType: "retention", orchestratorRunId: run.id, ...s });
      }
      for (const r of retentionResult.recommendations) {
        allRecommendationInserts.push({ orgId, agentType: "retention", orchestratorRunId: run.id, status: "pending", ...r });
      }
      agentSummary["retention"] = { signals: retentionResult.signals.length, recommendations: retentionResult.recommendations.length };
    }

    // --- Collect scheduling signals ---
    if (schedulingResult) {
      for (const s of schedulingResult.signals) {
        allSignalInserts.push({ orgId, agentType: "scheduling", orchestratorRunId: run.id, ...s });
      }
      for (const r of schedulingResult.recommendations) {
        allRecommendationInserts.push({ orgId, agentType: "scheduling", orchestratorRunId: run.id, status: "pending", ...r });
      }
      agentSummary["scheduling"] = { signals: schedulingResult.signals.length, recommendations: schedulingResult.recommendations.length };
    }

    // --- Collect growth signals ---
    if (growthResult) {
      for (const s of growthResult.signals) {
        allSignalInserts.push({ orgId, agentType: "growth", orchestratorRunId: run.id, ...s });
      }
      for (const r of growthResult.recommendations) {
        allRecommendationInserts.push({ orgId, agentType: "growth", orchestratorRunId: run.id, status: "pending", ...r });
      }
      agentSummary["growth"] = { signals: growthResult.signals.length, recommendations: growthResult.recommendations.length };
    }

    // --- Collect client success signals ---
    if (clientSuccessResult) {
      for (const s of clientSuccessResult.signals) {
        allSignalInserts.push({ orgId, agentType: "client_success", orchestratorRunId: run.id, ...s });
      }
      for (const r of clientSuccessResult.recommendations) {
        allRecommendationInserts.push({ orgId, agentType: "client_success", orchestratorRunId: run.id, status: "pending", ...r });
      }
      agentSummary["client_success"] = { signals: clientSuccessResult.signals.length, recommendations: clientSuccessResult.recommendations.length };
    }

    // --- Revenue agent summary ---
    agentSummary["revenue"] = { signals: revenueActions.length, recommendations: revenueActions.length };

    // --- Cross-agent insight synthesis ---
    // Detect clients at churn risk AND scheduling issues
    const retentionEntityIds = new Set(retentionResult?.signals.map((s) => s.entityId) || []);
    const clientSuccessEntityIds = new Set(clientSuccessResult?.signals.map((s) => s.entityId) || []);
    const crossChurnClients = [...retentionEntityIds].filter((id) => clientSuccessEntityIds.has(id));

    if (crossChurnClients.length > 0) {
      allSignalInserts.push({
        orgId,
        agentType: "executive",
        orchestratorRunId: run.id,
        signalType: "cross_agent_churn_risk",
        entityType: "client",
        entityId: crossChurnClients[0],
        entityName: "Multiple Clients",
        title: `${crossChurnClients.length} client(s) flagged by both Retention AND Client Success`,
        description: "These clients have low adherence AND inactivity — highest churn risk in your organization.",
        severity: "critical",
        score: 95,
        metadata: { clientIds: crossChurnClients, agentsAgreeing: ["retention", "client_success"] },
      });

      allRecommendationInserts.push({
        orgId,
        agentType: "executive",
        orchestratorRunId: run.id,
        crossAgentTypes: ["retention", "client_success"],
        title: `URGENT: ${crossChurnClients.length} high-risk client(s) need immediate attention`,
        description: `${crossChurnClients.length} client(s) are flagged by both Retention and Client Success agents. These are your highest churn risks right now.`,
        reason: "Cross-agent signal: inactive + low session completion = imminent churn. Act within 24 hours.",
        entityType: "client",
        entityId: crossChurnClients[0],
        entityName: "Multiple Clients",
        severity: "critical",
        estimatedImpact: crossChurnClients.length * 15000,
        priorityScore: 95,
        status: "pending",
        actionType: "urgent_client_outreach",
        metadata: { clientIds: crossChurnClients },
      });
    }

    // --- Revenue gap + growth cross-insight ---
    const hasRevenueGap = schedulingResult?.signals.some((s) => s.signalType === "revenue_gap");
    const hasHotLeads = growthResult?.signals.some((s) => s.signalType === "hot_leads");
    if (hasRevenueGap && hasHotLeads) {
      allRecommendationInserts.push({
        orgId,
        agentType: "executive",
        orchestratorRunId: run.id,
        crossAgentTypes: ["scheduling", "growth"],
        title: "Match open schedule slots to warm leads",
        description: `Your schedule has open slots this week AND you have warm leads ready to close. Offer a specific time slot to your hottest lead now.`,
        reason: "Cross-agent insight: schedule gap + hot leads = ideal moment to convert a prospect into a client.",
        entityType: "org",
        entityId: orgId,
        entityName: "Business Opportunity",
        severity: "high",
        estimatedImpact: schedulingResult?.summary.revenueGapsCents || 0,
        priorityScore: 88,
        status: "pending",
        actionType: "match_slot_to_lead",
        metadata: { revenueGap: schedulingResult?.summary, hotLeads: growthResult?.summary.hotLeads },
      });
    }

    // --- Write all signals and recommendations ---
    if (allSignalInserts.length > 0) {
      try {
        await db.insert(agentSignals).values(allSignalInserts);
      } catch (insertErr: any) {
        console.error("[Atlas] agentSignals insert failed — table=agent_signals payload_sample=%j error=%s",
          allSignalInserts[0], insertErr.message);
        throw insertErr;
      }
    }

    let insertedRecs: (typeof agentRecommendations.$inferSelect)[] = [];
    if (allRecommendationInserts.length > 0) {
      try {
        insertedRecs = await db
          .insert(agentRecommendations)
          .values(allRecommendationInserts)
          .returning();
      } catch (insertErr: any) {
        console.error("[Atlas] agentRecommendations insert failed — table=agent_recommendations payload_sample=%j error=%s",
          allRecommendationInserts[0], insertErr.message);
        throw insertErr;
      }
    }

    totalSignals = allSignalInserts.length;
    totalRecommendations = insertedRecs.length;

    // --- Compute health score ---
    const criticalCount = allSignalInserts.filter((s) => s.severity === "critical").length;
    const highCount = allSignalInserts.filter((s) => s.severity === "high").length;
    const mediumCount = allSignalInserts.filter((s) => s.severity === "medium").length;
    const rawScore = 100 - criticalCount * 15 - highCount * 8 - mediumCount * 3;
    const healthScore = Math.max(10, Math.min(100, rawScore));

    // --- Build executive brief components ---
    const biggestOpportunity = schedulingResult?.recommendations[0]
      ? {
          title: schedulingResult.recommendations[0].title,
          value: schedulingResult.summary.revenueGapsCents,
          action: schedulingResult.recommendations[0].actionType,
        }
      : growthResult?.recommendations[0]
      ? {
          title: growthResult.recommendations[0].title,
          value: growthResult.recommendations[0].estimatedImpact,
          action: growthResult.recommendations[0].actionType,
        }
      : {};

    const highestChurnRisk = retentionResult?.recommendations[0]
      ? {
          title: retentionResult.recommendations[0].title,
          clientName: retentionResult.recommendations[0].entityName,
          severity: retentionResult.recommendations[0].severity,
        }
      : clientSuccessResult?.recommendations[0]
      ? {
          title: clientSuccessResult.recommendations[0].title,
          clientName: clientSuccessResult.recommendations[0].entityName,
          severity: clientSuccessResult.recommendations[0].severity,
        }
      : {};

    const schedulingInefficiency = schedulingResult?.summary.openSlotsThisWeek
      ? {
          openSlots: schedulingResult.summary.openSlotsThisWeek,
          lostRevenue: schedulingResult.summary.revenueGapsCents,
          utilizationPct: schedulingResult.summary.utilizationPct,
        }
      : {};

    const mostValuableLead = growthResult?.signals.find((s) => s.signalType === "hot_leads")
      ? {
          title: growthResult.signals.find((s) => s.signalType === "hot_leads")?.title,
          prospectName: growthResult.signals.find((s) => s.signalType === "hot_leads")?.entityName,
          value: growthResult.signals.find((s) => s.signalType === "hot_leads")?.metadata?.topLeadValue,
        }
      : {};

    const projectedWeeklyRevenue = (schedulingResult?.summary.utilizationPct || 0) > 0
      ? Math.round(((schedulingResult?.summary.utilizationPct || 50) / 100) * 5 * 10000)
      : 0;

    // Enrich topActions with Hermes institutional learnings
    let hermesLearningActions: string[] = [];
    try {
      const { getTopLearningsForContext } = await import("../services/hermes-learning-service");
      const topLearnings = await getTopLearningsForContext(orgId, 4);
      hermesLearningActions = topLearnings
        .filter((l) => l.occurrenceCount >= 2)
        .slice(0, 2)
        .map((l) => `[Hermes] ${l.learning.slice(0, 120)}`);
    } catch {}

    const topActions = [
      ...insertedRecs
        .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
        .slice(0, 5)
        .map((r) => r.title),
      ...hermesLearningActions,
    ];

    // --- Store executive brief ---
    await db.insert(executiveBriefs).values({
      orgId,
      biggestOpportunity,
      highestChurnRisk,
      schedulingInefficiency,
      mostValuableLead,
      projectedWeeklyRevenue,
      healthScore,
      recommendedActions: topActions,
      agentSummary,
      rawSignals: allSignalInserts.slice(0, 20),
    });

    // --- Update orchestrator run ---
    await db
      .update(orchestratorRuns)
      .set({ status: "completed", agentsRun: Object.keys(agentSummary), signalsCreated: totalSignals, recommendationsCreated: totalRecommendations, completedAt: new Date() })
      .where(eq(orchestratorRuns.id, run.id));

    // --- Build top recommendations for response ---
    const topRecommendations = insertedRecs
      .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        agentType: r.agentType,
        severity: r.severity,
        priorityScore: r.priorityScore || 50,
        estimatedImpact: r.estimatedImpact || 0,
        crossAgentTypes: r.crossAgentTypes || [],
        entityName: r.entityName || null,
        actionType: r.actionType || null,
      }));

    // --- Write run summary to unified_agent_action_log (workforce dashboard counter) ---
    await logUnifiedAction({
      orgId,
      actorType: "executive_agent",
      actorName: "Atlas",
      actionType: "atlas:orchestrator_run",
      workflowRunId: run.id,
      status: "completed",
      riskLevel: "low",
      reasoningSummary: `Atlas orchestrated ${Object.keys(agentSummary).length} agents — ${totalSignals} signals, ${totalRecommendations} recommendations, health score ${healthScore}`,
      inputSnapshot: { triggeredBy, orgId },
      outputSnapshot: {
        healthScore,
        totalSignals,
        totalRecommendations,
        agentSummary,
        criticalCount: allSignalInserts.filter((s) => s.severity === "critical").length,
      },
      rollbackAvailable: false,
    }).catch((err) => console.error("[Atlas] Failed to write telemetry:", err));

    return {
      runId: run.id,
      healthScore,
      totalSignals,
      totalRecommendations,
      agentSummary,
      topRecommendations,
      executiveBrief: {
        biggestOpportunity,
        highestChurnRisk,
        schedulingInefficiency,
        mostValuableLead,
        projectedWeeklyRevenue,
        recommendedActions: topActions,
      },
    };
  } catch (error: any) {
    await db
      .update(orchestratorRuns)
      .set({ status: "failed", errorMessage: error.message, completedAt: new Date() })
      .where(eq(orchestratorRuns.id, run.id));
    throw error;
  }
}

let _businessBrainTimer: ReturnType<typeof setInterval> | null = null;

export function startBusinessBrainCron() {
  if (_businessBrainTimer) return;

  const INTERVAL_MS = 60 * 60 * 1000;

  const tick = async () => {
    try {
      const { organizations } = await import("@shared/schema");
      const { acquireJobLock, releaseJobLock } = await import(
        "../services/ceo-heartbeat-service"
      );
      const orgs = await db.select({ id: organizations.id }).from(organizations);

      for (const org of orgs) {
        // Per-org lock (Priority 3): prevents re-entry on server restart within the same hour
        const { acquired, lockKey } = await acquireJobLock(
          org.id,
          "business_brain_cron",
          55 // 55-minute TTL — matches the hourly interval with a small buffer
        ).catch(() => ({ acquired: true, lockKey: "" }));

        if (!acquired) {
          console.log(`[BusinessBrain] Lock held for org ${org.id} — skipping duplicate run`);
          continue;
        }

        try {
          const lastBrief = await db
            .select({ createdAt: executiveBriefs.createdAt })
            .from(executiveBriefs)
            .where(eq(executiveBriefs.orgId, org.id))
            .orderBy(desc(executiveBriefs.createdAt))
            .limit(1);
          const lastRun = lastBrief[0]?.createdAt;
          const hoursAgo = lastRun
            ? (Date.now() - lastRun.getTime()) / (1000 * 60 * 60)
            : 999;
          if (hoursAgo >= 20) {
            await runOrchestrator(org.id, "cron");
          }
        } catch (e: any) {
          console.error(`[BusinessBrain] Error for org ${org.id}:`, e.message);
        } finally {
          if (lockKey) await releaseJobLock(lockKey).catch(() => {});
        }
      }
    } catch (e: any) {
      console.error("[BusinessBrain] Cron tick error:", e.message);
    }
  };

  _businessBrainTimer = setInterval(tick, INTERVAL_MS);
  console.log("[BusinessBrain] Orchestrator cron started (checks every hour)");
}
