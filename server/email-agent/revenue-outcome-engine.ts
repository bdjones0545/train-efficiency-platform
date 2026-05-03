import { storage } from "../storage";
import type { AiRevenueEvent } from "@shared/schema";

export interface RevenueStatPeriod {
  revenue: number;
  actions: number;
  wonActions: number;
  engagedActions: number;
  avgPerAction: number;
}

export interface RevenueStreaks {
  daysStreak: number;
  weeklyWins: number;
}

export interface ImpactFeedItem {
  id: string;
  actionType: string;
  actionSource: string;
  prospectName: string | null;
  sport?: string | null;
  outcomeStatus: string;
  outcomeValue: number;
  outcomeTimestamp?: string | null;
  timeToOutcomeHours?: number | null;
  createdAt: string;
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
  streaks: RevenueStreaks;
  recentlyAttributed: ImpactFeedItem[];
}

function toFeedItem(e: AiRevenueEvent): ImpactFeedItem {
  return {
    id: e.id,
    actionType: e.actionType,
    actionSource: e.actionSource,
    prospectName: e.prospectName ?? null,
    sport: e.sport ?? null,
    outcomeStatus: e.outcomeStatus,
    outcomeValue: e.outcomeValue ?? 0,
    outcomeTimestamp: e.outcomeTimestamp ? new Date(e.outcomeTimestamp).toISOString() : null,
    timeToOutcomeHours: e.timeToOutcomeHours ?? null,
    createdAt: new Date(e.createdAt).toISOString(),
  };
}

function computeStreaks(events: AiRevenueEvent[]): RevenueStreaks {
  const won = events.filter(e => e.outcomeStatus === "won");

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weeklyWins = won.filter(e => {
    const d = new Date((e.outcomeTimestamp as any) ?? e.createdAt);
    return d >= weekAgo;
  }).length;

  const wonDays = new Set<string>();
  won.forEach(e => {
    const d = new Date((e.outcomeTimestamp as any) ?? e.createdAt);
    wonDays.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  });

  let daysStreak = 0;
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    if (wonDays.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)) daysStreak++;
    else break;
  }

  return { daysStreak, weeklyWins };
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
  const [stats, rawFeed] = await Promise.all([
    storage.getAiRevenueStats(orgId),
    storage.getAiImpactFeed(orgId, 50),
  ]);

  const impactFeed = rawFeed.slice(0, 20).map(toFeedItem);
  const streaks = computeStreaks(rawFeed);

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const recentlyAttributed = rawFeed
    .filter(e =>
      e.outcomeStatus !== "pending" &&
      e.outcomeTimestamp != null &&
      new Date(e.outcomeTimestamp as any) >= twoHoursAgo
    )
    .map(toFeedItem);

  return {
    today: stats.today,
    week: stats.week,
    month: stats.month,
    autoVsManual: stats.autoVsManual,
    byActionType: stats.byActionType,
    impactFeed,
    streaks,
    recentlyAttributed,
  };
}

export function buildRevenueContextString(outcomes: RevenueOutcomes): string {
  const { today, week, month, autoVsManual, byActionType, streaks, recentlyAttributed } = outcomes;

  const bestType = [...byActionType].sort((a, b) => b.avgRevenue - a.avgRevenue)[0];
  const autoMultiplierText =
    autoVsManual.autoRevenue > 0 && autoVsManual.manualRevenue > 0
      ? `Auto-executed actions generate ${autoVsManual.autoMultiplier.toFixed(1)}x more revenue than manual.`
      : "";

  const lines: string[] = [
    `\nREVENUE OUTCOME CONTEXT (AI-generated revenue):`,
    `  MTD: $${month.revenue.toLocaleString()} from ${month.wonActions} wins (avg $${month.avgPerAction}/win)`,
    `  This week: $${week.revenue.toLocaleString()} · ${streaks.weeklyWins} wins`,
    `  Today: $${today.revenue.toLocaleString()} from ${today.actions} actions`,
  ];

  if (streaks.daysStreak >= 2) {
    lines.push(`  Revenue streak: ${streaks.daysStreak} consecutive days with AI-generated wins`);
  }
  if (bestType) {
    lines.push(`  Best action type: ${bestType.actionType} (avg $${bestType.avgRevenue}/win)`);
  }
  if (autoMultiplierText) lines.push(`  ${autoMultiplierText}`);

  const recentWin = recentlyAttributed.find(e => e.outcomeStatus === "won");
  if (recentWin) {
    lines.push(
      `\nRECENT WIN ALERT: Just closed ${recentWin.prospectName ?? "a prospect"} for $${recentWin.outcomeValue} via ${recentWin.actionType.replace(/_/g, " ")}. ` +
      `When the coach opens chat, open by celebrating this win and immediately offer to find the next prospect.`
    );
  }

  lines.push(
    `RULES: Prioritize action types with highest revenue yield. Adapt to proven outcome patterns.`
  );

  return lines.join("\n");
}
