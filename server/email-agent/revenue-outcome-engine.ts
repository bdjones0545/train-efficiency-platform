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
  attributionRole?: string | null;
  attributionChainId?: string | null;
  chainPosition?: number | null;
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
    attributionRole: (e as any).attributionRole ?? "primary",
    attributionChainId: (e as any).attributionChainId ?? null,
    chainPosition: (e as any).chainPosition ?? 0,
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
    attributionRole?: "primary" | "assist";
    attributionChainId?: string;
    chainPosition?: number;
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
      attributionRole: data.attributionRole ?? "primary",
      attributionChainId: data.attributionChainId,
      chainPosition: data.chainPosition ?? 0,
    });
  } catch (err: any) {
    console.warn("[RevenueEngine] logActionAsEvent failed:", err.message);
  }
}

/**
 * Phase 7: Log the full multi-touch attribution chain for a won deal.
 * One event gets "primary" role (most recent / highest-impact action),
 * prior actions get "assist" role. A shared attributionChainId ties them together.
 */
export async function logMultiTouchAttributionChain(
  orgId: string,
  prospectId: string,
  wonValue: number,
  source: string
): Promise<void> {
  try {
    const chainId = crypto.randomUUID();

    // Fetch all prior events for this prospect
    const allEvents = await storage.getAiImpactFeed(orgId, 100);
    const prospectEvents = allEvents
      .filter((e) => e.prospectId === prospectId && e.outcomeStatus === "pending")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (prospectEvents.length === 0) {
      // No prior events — just attribute a single primary win
      await logActionAsEvent(orgId, {
        actionType: "deal_won",
        actionSource: "manual",
        prospectId,
        outcomeSource: source,
        attributionRole: "primary",
        attributionChainId: chainId,
        chainPosition: 1,
      });
      return;
    }

    const primaryEvent = prospectEvents[prospectEvents.length - 1];
    const assistEvents = prospectEvents.slice(0, -1);

    const now = new Date();
    const createdAt = new Date(primaryEvent.createdAt);
    const diffHours = Math.round((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60));

    // Mark primary event as won
    await storage.updateAiRevenueEvent(primaryEvent.id, {
      outcomeStatus: "won",
      outcomeValue: wonValue,
      outcomeSource: source,
      outcomeTimestamp: now,
      timeToOutcomeHours: diffHours,
      attributionRole: "primary",
      attributionChainId: chainId,
      chainPosition: prospectEvents.length,
    });

    // Mark assist events
    for (let i = 0; i < assistEvents.length; i++) {
      await storage.updateAiRevenueEvent(assistEvents[i].id, {
        outcomeStatus: "won",
        outcomeValue: 0,
        outcomeSource: source,
        outcomeTimestamp: now,
        timeToOutcomeHours: null,
        attributionRole: "assist",
        attributionChainId: chainId,
        chainPosition: i + 1,
      });
    }
  } catch (err: any) {
    console.warn("[RevenueEngine] logMultiTouchAttributionChain failed:", err.message);
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
    // Phase 7: For "won" outcomes, use multi-touch attribution chain
    if (status === "won" && value > 0) {
      await logMultiTouchAttributionChain(orgId, prospectId, value, source);
      return;
    }

    // For non-won outcomes, use simple single-event attribution
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
