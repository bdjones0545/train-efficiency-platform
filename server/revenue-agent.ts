import { db } from "./db";
import { eq, and, inArray } from "drizzle-orm";
import { storage } from "./storage";
import {
  revenueAgentActions,
  revenueAgentSettings,
  revenueAgentRuns,
} from "@shared/schema";

export type AgentActionType =
  | "send_followup"
  | "schedule_call"
  | "mark_lost"
  | "move_stage"
  | "re_engage"
  | "create_deal";

export interface AgentAction {
  dealId?: string | null;
  prospectId?: string | null;
  actionType: AgentActionType;
  reason: string;
  estimatedValue: number;
  confidence: number;
  priority: number;
  metadata?: Record<string, any>;
}

function daysSince(date: string | Date | null): number {
  if (!date) return 999;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function daysUntil(date: string | Date | null): number {
  if (!date) return 999;
  return Math.floor((new Date(date).getTime() - Date.now()) / 86400000);
}

export async function runRevenueAgent(
  orgId: string,
  triggeredBy: "manual" | "scheduled" = "manual"
): Promise<{
  runId: string;
  actionsCreated: number;
  staleLabeled: number;
  summary: string;
}> {
  const [runRow] = await db
    .insert(revenueAgentRuns)
    .values({ orgId, triggeredBy, status: "running" })
    .returning();
  const runId = runRow.id;

  try {
    const [deals, prospects, settings] = await Promise.all([
      storage.getTeamTrainingDeals(orgId),
      storage.getTeamTrainingProspects(orgId),
      storage.getAgentSettings(orgId),
    ]);

    const activeDeals = deals.filter(
      (d) => !["won", "lost"].includes(d.status)
    );
    const now = new Date();
    const actions: AgentAction[] = [];

    for (const deal of activeDeals) {
      const inactiveDays = daysSince(deal.lastActivityAt);
      const followUpOverdue =
        deal.nextFollowUpAt && new Date(deal.nextFollowUpAt) <= now;
      const lastContactDays = daysSince(deal.lastContactAt);
      const value = deal.estimatedValue ?? 0;

      if (followUpOverdue) {
        const overdueDays = Math.abs(daysUntil(deal.nextFollowUpAt));
        actions.push({
          dealId: deal.id,
          prospectId: deal.prospectId,
          actionType: "send_followup",
          reason: `Follow-up was due ${overdueDays > 0 ? `${overdueDays}d ago` : "today"} — send it now while still relevant`,
          estimatedValue: value,
          confidence: 85,
          priority: 92,
          metadata: { dealStatus: deal.status, overdueDays },
        });
        continue;
      }

      if (deal.status === "proposal_sent" && lastContactDays >= 3) {
        actions.push({
          dealId: deal.id,
          prospectId: deal.prospectId,
          actionType: "schedule_call",
          reason: `Proposal has been sitting for ${lastContactDays}d with no response — a quick call closes faster than email`,
          estimatedValue: value,
          confidence: 78,
          priority: 84,
          metadata: { dealStatus: deal.status, lastContactDays },
        });
        continue;
      }

      if (deal.status === "negotiating" && deal.probability >= 60 && lastContactDays >= 2) {
        actions.push({
          dealId: deal.id,
          prospectId: deal.prospectId,
          actionType: "send_followup",
          reason: `${deal.probability}% probability deal hasn't been touched in ${lastContactDays}d — push to close`,
          estimatedValue: value,
          confidence: 82,
          priority: 86,
          metadata: { dealStatus: deal.status, probability: deal.probability },
        });
        continue;
      }

      if (inactiveDays >= 21) {
        actions.push({
          dealId: deal.id,
          prospectId: deal.prospectId,
          actionType: deal.status === "proposal_sent" ? "re_engage" : "mark_lost",
          reason: `No activity in ${inactiveDays}d — this deal is likely dead. ${deal.status === "proposal_sent" ? "Make one last attempt or mark it lost." : "Mark it lost to keep your pipeline accurate."}`,
          estimatedValue: value,
          confidence: 70,
          priority: 62,
          metadata: { dealStatus: deal.status, inactiveDays },
        });
      } else if (inactiveDays >= 7) {
        actions.push({
          dealId: deal.id,
          prospectId: deal.prospectId,
          actionType: "send_followup",
          reason: `${inactiveDays}d since last activity on a ${deal.status === "interested" ? "warm" : "cold"} deal — re-engage before they forget`,
          estimatedValue: value,
          confidence: 68,
          priority: 74,
          metadata: { dealStatus: deal.status, inactiveDays },
        });
      }
    }

    const dealsProspectIds = new Set(activeDeals.map((d) => d.prospectId).filter(Boolean));
    const hotLeads = prospects.filter(
      (p) =>
        !dealsProspectIds.has(p.id) &&
        p.outreachStatus === "Replied" &&
        (p.confidenceScore ?? 0) >= 65
    );

    for (const lead of hotLeads.slice(0, 3)) {
      actions.push({
        dealId: null,
        prospectId: lead.id,
        actionType: "create_deal",
        reason: `${lead.prospectName} replied to outreach (${lead.confidenceScore ?? 0}% confidence) — no deal exists yet. Create one now.`,
        estimatedValue: lead.estimatedValue ?? 5000,
        confidence: 80,
        priority: 88,
        metadata: { prospectName: lead.prospectName, sport: lead.sport, outreachStatus: lead.outreachStatus },
      });
    }

    actions.sort((a, b) => b.priority - a.priority);

    let actionsCreated = 0;
    let staleLabeled = 0;

    for (const action of actions) {
      await db.insert(revenueAgentActions).values({
        orgId,
        dealId: action.dealId ?? null,
        prospectId: action.prospectId ?? null,
        actionType: action.actionType,
        reason: action.reason,
        estimatedValue: action.estimatedValue,
        confidence: action.confidence,
        priority: action.priority,
        status: "pending",
        metadata: action.metadata ?? {},
        agentRunId: runId,
      });
      actionsCreated++;
    }

    if (settings?.autoLabelStale) {
      const staleDeals = activeDeals.filter((d) => daysSince(d.lastActivityAt) >= 14);
      for (const deal of staleDeals) {
        await storage.updateTeamTrainingDeal(deal.id, {
          notes: `[Auto-labeled stale ${new Date().toLocaleDateString()}] ${deal.notes ?? ""}`.trim(),
        });
        await storage.createDealActivity({
          dealId: deal.id,
          activityType: "ai_action",
          description: "Revenue Agent: auto-labeled deal as stale (14+ days inactive)",
          metadata: { agentRunId: runId },
        });
        staleLabeled++;
      }
    }

    await db
      .update(revenueAgentRuns)
      .set({ status: "completed", actionsCreated, staleLabeled, completedAt: new Date() })
      .where(eq(revenueAgentRuns.id, runId));

    await db
      .insert(revenueAgentSettings)
      .values({ orgId, lastRunAt: new Date() })
      .onConflictDoUpdate({ target: revenueAgentSettings.orgId, set: { lastRunAt: new Date(), updatedAt: new Date() } });

    return {
      runId,
      actionsCreated,
      staleLabeled,
      summary: `Agent scanned ${activeDeals.length} active deals, ${hotLeads.length} hot leads. Created ${actionsCreated} actions.${staleLabeled > 0 ? ` Auto-labeled ${staleLabeled} stale deals.` : ""}`,
    };
  } catch (err: any) {
    await db
      .update(revenueAgentRuns)
      .set({ status: "failed", errorMessage: err.message, completedAt: new Date() })
      .where(eq(revenueAgentRuns.id, runId));
    throw err;
  }
}

export async function generateDailyBrief(orgId: string, deals: any[], prospects: any[]) {
  const now = new Date();
  const activeDeals = deals.filter((d) => !["won", "lost"].includes(d.status));

  const followUpDueToday = activeDeals.filter(
    (d) => d.nextFollowUpAt && new Date(d.nextFollowUpAt) <= now
  );

  const hotDeal = activeDeals
    .filter((d) => d.probability >= 60)
    .sort((a, b) => b.estimatedValue * b.probability - a.estimatedValue * a.probability)[0] ?? null;

  const atRiskDeal = activeDeals
    .filter((d) => daysSince(d.lastActivityAt) >= 7)
    .sort((a, b) => b.estimatedValue - a.estimatedValue)[0] ?? null;

  const projectedRevenue = activeDeals
    .filter((d) => d.probability >= 40 && daysSince(d.lastActivityAt) < 21)
    .reduce((s, d) => s + Math.round((d.estimatedValue * d.probability) / 100), 0);

  const wonThisMonth = deals
    .filter((d) => {
      if (d.status !== "won") return false;
      const wonAt = d.updatedAt ? new Date(d.updatedAt) : null;
      if (!wonAt) return false;
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return wonAt >= startOfMonth;
    })
    .reduce((s, d) => s + (d.estimatedValue ?? 0), 0);

  const hotLeadsCount = prospects.filter(
    (p) => p.outreachStatus === "Replied" && !activeDeals.find((d) => d.prospectId === p.id)
  ).length;

  let bestNextAction = "Review your pipeline and identify the highest-value deal to push this week.";
  if (followUpDueToday.length > 0) {
    const top = followUpDueToday[0];
    bestNextAction = `Send overdue follow-up to ${top.prospect?.prospectName ?? "your top deal"} — it was due ${Math.abs(daysUntil(top.nextFollowUpAt))}d ago.`;
  } else if (hotLeadsCount > 0) {
    bestNextAction = `${hotLeadsCount} prospect${hotLeadsCount > 1 ? "s have" : " has"} replied to outreach with no deal created — convert them now.`;
  } else if (hotDeal) {
    bestNextAction = `Push ${hotDeal.prospect?.prospectName ?? "your hottest deal"} to close — ${hotDeal.probability}% probability, $${hotDeal.estimatedValue.toLocaleString()} at stake.`;
  }

  return {
    followUpDueToday: followUpDueToday.map((d) => ({
      id: d.id,
      name: d.prospect?.prospectName ?? "Unknown",
      status: d.status,
      value: d.estimatedValue,
      dueAt: d.nextFollowUpAt,
    })),
    hotDeal: hotDeal
      ? {
          id: hotDeal.id,
          name: hotDeal.prospect?.prospectName ?? "Unknown",
          value: hotDeal.estimatedValue,
          probability: hotDeal.probability,
          status: hotDeal.status,
        }
      : null,
    atRiskDeal: atRiskDeal
      ? {
          id: atRiskDeal.id,
          name: atRiskDeal.prospect?.prospectName ?? "Unknown",
          value: atRiskDeal.estimatedValue,
          inactiveDays: daysSince(atRiskDeal.lastActivityAt),
          status: atRiskDeal.status,
        }
      : null,
    bestNextAction,
    projectedRevenue,
    wonThisMonth,
    hotLeadsCount,
    totalActive: activeDeals.length,
  };
}

export async function attributeOutcomeToActions(
  orgId: string,
  dealId: string,
  outcomeType: "reply" | "meeting" | "won" | "lost",
  outcomeValue = 0
) {
  await db
    .update(revenueAgentActions)
    .set({
      outcomeType,
      outcomeValue,
      outcomeLoggedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(revenueAgentActions.orgId, orgId),
        eq(revenueAgentActions.dealId, dealId),
        inArray(revenueAgentActions.status, ["executed", "accepted", "pending"])
      )
    );
}

export function startRevenueAgentCron(getOrgIds: () => Promise<string[]>) {
  const INTERVAL_MS = 60 * 60 * 1000;

  const tick = async () => {
    const hour = new Date().getHours();
    try {
      const orgIds = await getOrgIds();
      for (const orgId of orgIds) {
        const settings = await storage.getAgentSettings(orgId);
        if (settings?.dailyRunEnabled === false) continue;
        const runHour = settings?.dailyRunHour ?? 8;
        if (hour === runHour) {
          const lastRun = settings?.lastRunAt ? new Date(settings.lastRunAt) : null;
          const hoursSinceRun = lastRun ? (Date.now() - lastRun.getTime()) / 3600000 : 999;
          if (hoursSinceRun >= 20) {
            // Per-org lock: prevents duplicate scheduled runs across instances (autoscale).
            const { acquireJobLock, releaseJobLock } = await import("./services/ceo-heartbeat-service");
            const { acquired, lockKey } = await acquireJobLock(orgId, "revenue_agent_cron", 60).catch(
              () => ({ acquired: true, lockKey: "" })
            );
            if (!acquired) {
              console.log(`[RevenueAgent] Lock held for org ${orgId} — skipping duplicate run`);
              continue;
            }
            try {
              console.log(`[RevenueAgent] Running scheduled scan for org ${orgId}`);
              await runRevenueAgent(orgId, "scheduled").catch((e: any) =>
                console.error(`[RevenueAgent] Scheduled run failed for ${orgId}:`, e.message)
              );
            } finally {
              if (lockKey) await releaseJobLock(lockKey).catch(() => {});
            }
          }
        }
      }
    } catch (e: any) {
      console.error("[RevenueAgent] Cron tick error:", e.message);
    }
  };

  setInterval(tick, INTERVAL_MS);
  console.log("[RevenueAgent] Daily cron started (checks every hour)");
}
