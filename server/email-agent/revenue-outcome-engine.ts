import { storage } from "../storage";

export interface RevenueStatPeriod {
  revenue: number;
  actions: number;
  wonActions: number;
  engagedActions: number;
  avgPerAction: number;
}

export interface RevenueOutcomes {
  today: RevenueStatPeriod;
  week: RevenueStatPeriod;
  month: RevenueStatPeriod;
  autoVsManual: {
    autoCount: number;
    manualCount: number;
    autoRevenue: number;
    manualRevenue: number;
    autoMultiplier: number;
  };
  byActionType: { actionType: string; count: number; revenue: number; avgRevenue: number }[];
  impactFeed: ImpactFeedItem[];
}

export interface ImpactFeedItem {
  id: string;
  actionType: string;
  actionSource: string;
  prospectName: string;
  sport?: string | null;
  outcomeStatus: string;
  outcomeValue: number;
  outcomeTimestamp?: string | null;
  timeToOutcomeHours?: number | null;
  createdAt: string;
}

export async function logActionAsEvent(
  orgId: string,
  data: {
    actionType: string;
    actionSource: "auto_executed" | "manual";
    prospectId?: string;
    prospectName?: string;
    sport?: string;
    executionLogId?: string;
    outcomeSource?: string;
  }
): Promise<void> {
  try {
    await storage.createAiRevenueEvent({
      orgId,
      prospectId: data.prospectId,
      executionLogId: data.executionLogId,
      actionType: data.actionType,
      actionSource: data.actionSource,
      outcomeStatus: "pending",
      outcomeValue: 0,
      outcomeSource: data.outcomeSource ?? data.actionType,
      prospectName: data.prospectName,
      sport: data.sport,
    });
  } catch (err: any) {
    console.warn("[RevenueEngine] logActionAsEvent failed:", err.message);
  }
}

export async function attributeOutcomeToProspect(
  orgId: string,
  prospectId: string,
  status: "engaged" | "booked" | "won" | "lost",
  value: number,
  source: string
): Promise<void> {
  try {
    const event = await storage.findRecentAiEventForProspect(orgId, prospectId, 72);
    if (!event) return;

    const now = new Date();
    const createdAt = new Date(event.createdAt);
    const diffHours = Math.round((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60));

    await storage.updateAiRevenueEvent(event.id, {
      outcomeStatus: status,
      outcomeValue: value,
      outcomeSource: source,
      outcomeTimestamp: now,
      timeToOutcomeHours: diffHours,
    });
  } catch (err: any) {
    console.warn("[RevenueEngine] attributeOutcomeToProspect failed:", err.message);
  }
}

export async function getRevenueOutcomes(orgId: string): Promise<RevenueOutcomes> {
  const [stats, impactFeed] = await Promise.all([
    storage.getAiRevenueStats(orgId),
    storage.getAiImpactFeed(orgId, 20),
  ]);

  return {
    today: stats.today,
    week: stats.week,
    month: stats.month,
    autoVsManual: stats.autoVsManual,
    byActionType: stats.byActionType,
    impactFeed,
  };
}

export function buildRevenueContextString(outcomes: RevenueOutcomes): string {
  const { today, week, month, autoVsManual, byActionType } = outcomes;

  const bestType = byActionType.sort((a, b) => b.avgRevenue - a.avgRevenue)[0];
  const autoMultiplierText =
    autoVsManual.autoRevenue > 0 && autoVsManual.manualRevenue > 0
      ? `Auto-executed actions generate ${autoVsManual.autoMultiplier.toFixed(1)}x more revenue than manual.`
      : "";

  const lines: string[] = [
    `\nREVENUE OUTCOME CONTEXT (AI-generated revenue):`,
    `  MTD: $${month.revenue.toLocaleString()} from ${month.actions} actions (avg $${month.avgPerAction}/action)`,
    `  This week: $${week.revenue.toLocaleString()} from ${week.actions} actions`,
    `  Today: $${today.revenue.toLocaleString()} from ${today.actions} actions`,
  ];

  if (bestType) {
    lines.push(`  Best action type: ${bestType.actionType} (avg $${bestType.avgRevenue}/action)`);
  }
  if (autoMultiplierText) lines.push(`  ${autoMultiplierText}`);
  lines.push(
    `RULES: Prioritize action types with highest revenue yield. Adapt to proven outcome patterns.`
  );

  return lines.join("\n");
}
