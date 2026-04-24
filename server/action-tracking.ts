import { db } from "./db";
import { storage } from "./storage";
import { agentActions, bookings, services, users, coachProfiles, availabilityBlocks } from "@shared/schema";
import type { AgentAction, InsertAgentAction } from "@shared/schema";
import { eq, and, inArray, gte, lte, lt, isNull, or, desc, sql, ne } from "drizzle-orm";
import { subHours, subDays, addHours, format, startOfDay, endOfDay, addDays, differenceInDays } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import {
  computeChurnRisks,
  computeUpsellOpportunities,
  computeSessionPackageAlerts,
} from "./revenue-intelligence";

export type { AgentAction };

// ============================================================
// PHASE 1: Core CRUD for agent_actions
// ============================================================

export async function createAgentAction(entry: InsertAgentAction): Promise<AgentAction> {
  const [row] = await db.insert(agentActions).values(entry).returning();
  return row;
}

export async function updateAgentActionStatus(
  id: string,
  status: "pending" | "sent" | "responded" | "booked" | "ignored" | "failed",
  extra: { bookingId?: string; outcomeValueCents?: number } = {}
): Promise<void> {
  await db.update(agentActions).set({ status, ...extra }).where(eq(agentActions.id, id));
}

export async function getAgentActionsForOrg(
  orgId: string,
  opts: { status?: string; limit?: number; clientId?: string; sinceDays?: number } = {}
): Promise<AgentAction[]> {
  const conditions = [eq(agentActions.organizationId, orgId)];
  if (opts.status) conditions.push(eq(agentActions.status, opts.status as any));
  if (opts.clientId) conditions.push(eq(agentActions.clientId, opts.clientId));
  if (opts.sinceDays) conditions.push(gte(agentActions.createdAt, subDays(new Date(), opts.sinceDays)));
  return db
    .select()
    .from(agentActions)
    .where(and(...conditions))
    .orderBy(desc(agentActions.createdAt))
    .limit(opts.limit ?? 100);
}

// ============================================================
// PHASE 2: Outcome Detection
// ============================================================

export async function detectOutcomesForOrg(orgId: string): Promise<{ booked: number; ignored: number }> {
  const now = new Date();
  const cutoffBooked = subHours(now, 72);
  const cutoffIgnored = subHours(now, 48);

  const sentActions = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.organizationId, orgId),
        eq(agentActions.status, "sent"),
        isNull(agentActions.bookingId)
      )
    );

  let bookedCount = 0;
  let ignoredCount = 0;

  for (const action of sentActions) {
    if (!action.clientId || !action.createdAt) continue;
    const actionTime = new Date(action.createdAt);

    const clientBookings = await db
      .select({ id: bookings.id, startAt: bookings.startAt, serviceId: bookings.serviceId })
      .from(bookings)
      .where(
        and(
          eq(bookings.clientId, action.clientId),
          gte(bookings.createdAt, actionTime),
          ne(bookings.status, "CANCELLED")
        )
      )
      .limit(1);

    if (clientBookings.length > 0) {
      const b = clientBookings[0];
      let priceCents = 0;
      try {
        const [svc] = await db.select({ priceCents: services.priceCents }).from(services).where(eq(services.id, b.serviceId)).limit(1);
        priceCents = svc?.priceCents ?? 0;
      } catch (_) {}
      await updateAgentActionStatus(action.id, "booked", { bookingId: b.id, outcomeValueCents: priceCents });
      bookedCount++;
    } else if (actionTime < cutoffIgnored) {
      await updateAgentActionStatus(action.id, "ignored");
      ignoredCount++;
    }
  }

  return { booked: bookedCount, ignored: ignoredCount };
}

// ============================================================
// PHASE 3: Follow-Up Engine
// ============================================================

export interface FollowUpItem {
  actionId: string;
  clientId: string;
  clientName: string;
  actionType: string;
  actionSubType: string | null;
  originalCreatedAt: string;
  hoursSinceSent: number;
  followUpCount: number;
  urgencyLevel: "critical" | "high" | "medium";
  recommendedMessage: string;
  reason: string;
}

export async function generateFollowUpActions(orgId: string): Promise<FollowUpItem[]> {
  const now = new Date();
  const cutoff24h = subHours(now, 24);
  const cutoff7d = subDays(now, 7);

  const sentWithNoResponse = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.organizationId, orgId),
        eq(agentActions.status, "sent"),
        lt(agentActions.createdAt, cutoff24h)
      )
    )
    .orderBy(agentActions.createdAt);

  const items: FollowUpItem[] = [];

  for (const action of sentWithNoResponse) {
    const actionTime = new Date(action.createdAt!);
    const hoursSinceSent = Math.floor((now.getTime() - actionTime.getTime()) / 3600000);
    const followUpCount = action.followUpCount ?? 0;

    if (followUpCount >= 2) continue;

    let urgencyLevel: "critical" | "high" | "medium" = "medium";
    let reason = "No response after 24 hours";

    if (actionTime < cutoff7d) {
      urgencyLevel = "critical";
      reason = "No response after 7 days — escalate or close";
    } else if (hoursSinceSent > 48) {
      urgencyLevel = "high";
      reason = "No response after 48 hours";
    }

    const smsContent = (action.messageContent as any)?.sms ?? "";
    let recommendedMessage = followUpCount === 0
      ? `Hey ${action.clientName ?? "there"}, just following up — still have that spot available. Let me know!`
      : `Hi ${action.clientName ?? "there"}, last check-in from me. Happy to chat if timing isn't right.`;

    if (action.actionSubType === "backfill" && (action.relatedSlot as any)?.label) {
      recommendedMessage = `Hey ${action.clientName ?? "there"}, that ${(action.relatedSlot as any).label} slot is still open — want it?`;
    }

    items.push({
      actionId: action.id,
      clientId: action.clientId ?? "",
      clientName: action.clientName ?? "Unknown",
      actionType: action.actionType,
      actionSubType: action.actionSubType,
      originalCreatedAt: format(actionTime, "MMM d 'at' h:mm a"),
      hoursSinceSent,
      followUpCount,
      urgencyLevel,
      recommendedMessage,
      reason,
    });

    await db.update(agentActions)
      .set({ followUpCount: followUpCount + 1, followUpAt: addHours(now, 24) })
      .where(eq(agentActions.id, action.id));
  }

  return items.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2 };
    return order[a.urgencyLevel] - order[b.urgencyLevel];
  });
}

// ============================================================
// PHASE 4: Daily Action Queue
// ============================================================

export interface ActionQueueItem {
  priority: "high" | "revenue" | "maintenance";
  category: string;
  clientId?: string;
  clientName: string;
  reason: string;
  suggestedAction: string;
  previewMessage?: string;
  expectedRevenueCents?: number;
  urgencyLabel: string;
}

export async function buildDailyActionQueue(orgId: string): Promise<{
  generatedAt: string;
  headline: string;
  high: ActionQueueItem[];
  revenue: ActionQueueItem[];
  maintenance: ActionQueueItem[];
  totalItems: number;
}> {
  const now = new Date();
  const tomorrow = addDays(startOfDay(now), 2);

  const [churnRisks, upsells, packageAlerts, followUps] = await Promise.all([
    computeChurnRisks(orgId),
    computeUpsellOpportunities(orgId),
    computeSessionPackageAlerts(orgId),
    generateFollowUpActions(orgId),
  ]);

  const high: ActionQueueItem[] = [];
  const revenue: ActionQueueItem[] = [];
  const maintenance: ActionQueueItem[] = [];

  for (const f of followUps.slice(0, 5)) {
    high.push({
      priority: "high",
      category: "Follow-Up Due",
      clientId: f.clientId,
      clientName: f.clientName,
      reason: f.reason,
      suggestedAction: "Send follow-up message",
      previewMessage: f.recommendedMessage,
      urgencyLabel: f.urgencyLevel === "critical" ? "🔴 Critical" : "🟠 High",
    });
  }

  for (const c of churnRisks.filter(r => r.riskLevel === "high").slice(0, 5)) {
    high.push({
      priority: "high",
      category: "Churn Risk",
      clientId: c.clientId,
      clientName: c.clientName,
      reason: c.signals.join("; "),
      suggestedAction: c.suggestedAction,
      urgencyLabel: "🔴 High Risk",
    });
  }

  try {
    const weekStart = startOfDay(now);
    const coaches = await storage.getCoachProfilesByOrganization(orgId);
    const coachIds = coaches.map((c: any) => c.id);

    if (coachIds.length > 0) {
      const todayBookings = await db
        .select({ coachId: bookings.coachId, startAt: bookings.startAt })
        .from(bookings)
        .where(
          and(
            eq(bookings.organizationId, orgId),
            gte(bookings.startAt, startOfDay(now)),
            lte(bookings.startAt, endOfDay(tomorrow)),
            ne(bookings.status, "CANCELLED")
          )
        );

      const availBlocks = await Promise.all(coachIds.map((id: string) => storage.getAvailabilityBlocks(id)));
      const totalAvailSlots = availBlocks.flat().length;
      const bookedSlots = todayBookings.length;
      const openSlots = Math.max(0, totalAvailSlots - bookedSlots);

      if (openSlots > 0) {
        high.push({
          priority: "high",
          category: "Open Slots",
          clientName: "All Coaches",
          reason: `${openSlots} open slot${openSlots !== 1 ? "s" : ""} available today/tomorrow`,
          suggestedAction: "Draft backfill outreach to waitlist or inactive clients",
          expectedRevenueCents: openSlots * 7000,
          urgencyLabel: "🟡 Fill Today",
        });
      }
    }
  } catch (_) {}

  for (const u of upsells.filter(u => u.priority === "high").slice(0, 3)) {
    revenue.push({
      priority: "revenue",
      category: "Upsell Opportunity",
      clientId: u.clientId,
      clientName: u.clientName,
      reason: u.reasoning,
      suggestedAction: `Offer ${u.opportunity}`,
      expectedRevenueCents: u.estimatedRevenueLiftCents,
      urgencyLabel: "💰 Revenue",
    });
  }

  for (const c of churnRisks.filter(r => r.riskLevel === "medium").slice(0, 3)) {
    revenue.push({
      priority: "revenue",
      category: "Churn Risk (Medium)",
      clientId: c.clientId,
      clientName: c.clientName,
      reason: c.signals.join("; "),
      suggestedAction: c.suggestedAction,
      urgencyLabel: "🟡 Watch",
    });
  }

  for (const p of packageAlerts.filter(a => a.urgency === "critical").slice(0, 4)) {
    maintenance.push({
      priority: "maintenance",
      category: p.urgency === "critical" ? "Package Expiring" : "Low Sessions",
      clientId: p.clientId,
      clientName: p.clientName,
      reason: `${p.sessionsRemaining} session${p.sessionsRemaining !== 1 ? "s" : ""} remaining on ${p.planName}`,
      suggestedAction: "Offer package renewal",
      urgencyLabel: p.urgency === "critical" ? "🔴 Expiring" : "🟡 Low",
    });
  }

  for (const p of packageAlerts.filter(a => a.urgency === "warning").slice(0, 3)) {
    maintenance.push({
      priority: "maintenance",
      category: "Low Sessions",
      clientId: p.clientId,
      clientName: p.clientName,
      reason: `${p.sessionsRemaining} session${p.sessionsRemaining !== 1 ? "s" : ""} remaining on ${p.planName}`,
      suggestedAction: "Offer package renewal",
      urgencyLabel: "🟡 Low",
    });
  }

  const totalItems = high.length + revenue.length + maintenance.length;
  const headline = totalItems === 0
    ? "No actions needed today — business looks healthy."
    : `${high.length} high-priority item${high.length !== 1 ? "s" : ""}, ${revenue.length} revenue opportunit${revenue.length !== 1 ? "ies" : "y"}, ${maintenance.length} maintenance task${maintenance.length !== 1 ? "s" : ""}.`;

  return {
    generatedAt: format(now, "EEEE, MMMM d 'at' h:mm a"),
    headline,
    high,
    revenue,
    maintenance,
    totalItems,
  };
}

// ============================================================
// PHASE 5: Performance Analytics
// ============================================================

export interface OperatorPerformanceMetrics {
  period: string;
  outreach: {
    totalSent: number;
    responded: number;
    booked: number;
    ignored: number;
    failed: number;
    conversionRate: string;
    responseRate: string;
    revenueAttributedCents: number;
    revenueAttributedLabel: string;
    topConvertingAction: string | null;
  };
  bookings: {
    agentDriven: number;
    revenueFromAgentCents: number;
    revenueLabel: string;
  };
  followUps: {
    totalPending: number;
    averageHoursToFollowUp: number | null;
  };
  topClients: { clientName: string; revenue: string; bookings: number }[];
  insights: string[];
}

export async function getOperatorPerformanceMetrics(
  orgId: string,
  sinceDays: number = 30
): Promise<OperatorPerformanceMetrics> {
  const since = subDays(new Date(), sinceDays);
  const periodLabel = sinceDays === 7 ? "last 7 days" : sinceDays === 14 ? "last 2 weeks" : `last ${sinceDays} days`;

  const actions = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.organizationId, orgId),
        gte(agentActions.createdAt, since)
      )
    );

  const outreachActions = actions.filter(a => a.actionType === "outreach");
  const totalSent = outreachActions.filter(a => a.status === "sent" || a.status === "responded" || a.status === "booked" || a.status === "ignored").length;
  const responded = outreachActions.filter(a => a.status === "responded").length;
  const booked = outreachActions.filter(a => a.status === "booked").length;
  const ignored = outreachActions.filter(a => a.status === "ignored").length;
  const failed = outreachActions.filter(a => a.status === "failed").length;

  const outreachRevenue = outreachActions
    .filter(a => a.status === "booked")
    .reduce((sum, a) => sum + (a.outcomeValueCents ?? 0), 0);

  const allBookedRevenue = actions
    .filter(a => a.status === "booked")
    .reduce((sum, a) => sum + (a.outcomeValueCents ?? 0), 0);

  const agentBookings = actions.filter(a => a.actionType === "booking" || a.status === "booked");

  const conversionRate = totalSent > 0 ? `${Math.round((booked / totalSent) * 100)}%` : "N/A";
  const responseRate = totalSent > 0 ? `${Math.round(((responded + booked) / totalSent) * 100)}%` : "N/A";

  const subTypeCounts: Record<string, { booked: number; sent: number }> = {};
  for (const a of outreachActions) {
    const key = a.actionSubType ?? a.actionType;
    if (!subTypeCounts[key]) subTypeCounts[key] = { booked: 0, sent: 0 };
    if (a.status === "sent" || a.status === "booked" || a.status === "responded" || a.status === "ignored") subTypeCounts[key].sent++;
    if (a.status === "booked") subTypeCounts[key].booked++;
  }
  let topConvertingAction: string | null = null;
  let topRate = 0;
  for (const [key, val] of Object.entries(subTypeCounts)) {
    if (val.sent < 2) continue;
    const rate = val.booked / val.sent;
    if (rate > topRate) { topRate = rate; topConvertingAction = `${key} (${Math.round(rate * 100)}% conversion)`; }
  }

  const clientRevMap: Record<string, { name: string; cents: number; count: number }> = {};
  for (const a of actions.filter(a => a.status === "booked" && a.clientId)) {
    const k = a.clientId!;
    if (!clientRevMap[k]) clientRevMap[k] = { name: a.clientName ?? "Unknown", cents: 0, count: 0 };
    clientRevMap[k].cents += a.outcomeValueCents ?? 0;
    clientRevMap[k].count++;
  }
  const topClients = Object.values(clientRevMap)
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 3)
    .map(c => ({ clientName: c.name, revenue: `$${(c.cents / 100).toFixed(0)}`, bookings: c.count }));

  const pendingFollowUps = actions.filter(a => a.status === "sent" && a.followUpAt).length;

  const insights: string[] = [];
  if (totalSent === 0) {
    insights.push("No outreach has been tracked yet. Draft messages using the agent to start building your loop.");
  } else {
    if (booked > 0) insights.push(`Agent-driven outreach converted to ${booked} booking${booked !== 1 ? "s" : ""} worth $${(outreachRevenue / 100).toFixed(0)}.`);
    if (ignored > booked) insights.push(`${ignored} messages went unanswered — consider a different approach or timing.`);
    if (topConvertingAction) insights.push(`Best-converting outreach type: ${topConvertingAction}.`);
    if (pendingFollowUps > 0) insights.push(`${pendingFollowUps} sent message${pendingFollowUps !== 1 ? "s" : ""} still awaiting response — run follow-up check.`);
  }

  return {
    period: periodLabel,
    outreach: {
      totalSent,
      responded,
      booked,
      ignored,
      failed,
      conversionRate,
      responseRate,
      revenueAttributedCents: outreachRevenue,
      revenueAttributedLabel: `$${(outreachRevenue / 100).toFixed(0)}`,
      topConvertingAction,
    },
    bookings: {
      agentDriven: agentBookings.length,
      revenueFromAgentCents: allBookedRevenue,
      revenueLabel: `$${(allBookedRevenue / 100).toFixed(0)}`,
    },
    followUps: {
      totalPending: pendingFollowUps,
      averageHoursToFollowUp: null,
    },
    topClients,
    insights,
  };
}

// ============================================================
// PHASE 1 (Adaptive): Action Performance Profile
// ============================================================

export interface ActionSubTypeProfile {
  subType: string;
  totalSent: number;
  totalBooked: number;
  conversionRate: number;
  conversionRateLabel: string;
  avgRevenuePerBookingCents: number;
  avgRevenueLabel: string;
  roiScore: number;
  trend: "improving" | "declining" | "stable" | "insufficient_data";
  trendDetail: string;
  reasoning: string;
}

export async function computeActionPerformanceProfile(orgId: string): Promise<ActionSubTypeProfile[]> {
  const since30 = subDays(new Date(), 30);
  const midpoint = subDays(new Date(), 15);

  const recent = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.organizationId, orgId),
        gte(agentActions.createdAt, since30),
        eq(agentActions.actionType, "outreach")
      )
    );

  const profileMap: Record<string, {
    sent: number; booked: number; revenueCents: number;
    sentRecent: number; bookedRecent: number;
    sentPrior: number; bookedPrior: number;
  }> = {};

  for (const a of recent) {
    const key = a.actionSubType ?? "general";
    if (!profileMap[key]) profileMap[key] = { sent: 0, booked: 0, revenueCents: 0, sentRecent: 0, bookedRecent: 0, sentPrior: 0, bookedPrior: 0 };
    const p = profileMap[key];
    const isActive = a.status === "sent" || a.status === "booked" || a.status === "responded" || a.status === "ignored";
    const isBooked = a.status === "booked";
    if (isActive) { p.sent++; new Date(a.createdAt!) >= midpoint ? p.sentRecent++ : p.sentPrior++; }
    if (isBooked) { p.booked++; p.revenueCents += a.outcomeValueCents ?? 0; new Date(a.createdAt!) >= midpoint ? p.bookedRecent++ : p.bookedPrior++; }
  }

  const profiles: ActionSubTypeProfile[] = [];

  for (const [subType, p] of Object.entries(profileMap)) {
    const conversionRate = p.sent > 0 ? p.booked / p.sent : 0;
    const avgRevenueCents = p.booked > 0 ? Math.round(p.revenueCents / p.booked) : 0;
    const roiScore = Math.round(conversionRate * (avgRevenueCents / 100) * 100);

    let trend: ActionSubTypeProfile["trend"] = "insufficient_data";
    let trendDetail = "Not enough data to determine trend";
    if (p.sentPrior >= 2 && p.sentRecent >= 2) {
      const priorRate = p.bookedPrior / p.sentPrior;
      const recentRate = p.bookedRecent / p.sentRecent;
      const delta = recentRate - priorRate;
      if (delta > 0.05) { trend = "improving"; trendDetail = `+${Math.round(delta * 100)}pp in last 15 days`; }
      else if (delta < -0.05) { trend = "declining"; trendDetail = `${Math.round(delta * 100)}pp in last 15 days`; }
      else { trend = "stable"; trendDetail = "Consistent performance"; }
    }

    const subTypeLabels: Record<string, string> = {
      backfill: "Backfill outreach",
      churn_risk: "Churn recovery",
      inactive: "Re-engagement",
      upsell: "Upsell offer",
      low_sessions: "Package renewal",
      general: "General outreach",
    };

    profiles.push({
      subType,
      totalSent: p.sent,
      totalBooked: p.booked,
      conversionRate,
      conversionRateLabel: p.sent > 0 ? `${Math.round(conversionRate * 100)}%` : "N/A",
      avgRevenuePerBookingCents: avgRevenueCents,
      avgRevenueLabel: avgRevenueCents > 0 ? `$${(avgRevenueCents / 100).toFixed(0)}` : "N/A",
      roiScore,
      trend,
      trendDetail,
      reasoning: p.sent < 3
        ? `Only ${p.sent} message${p.sent !== 1 ? "s" : ""} sent — more data needed for reliable profile.`
        : `${subTypeLabels[subType] ?? subType}: ${Math.round(conversionRate * 100)}% conversion, avg $${(avgRevenueCents / 100).toFixed(0)}/booking. ${trendDetail}.`,
    });
  }

  return profiles.sort((a, b) => b.roiScore - a.roiScore);
}

// ============================================================
// PHASE 2 (Adaptive): Scored + Ranked Daily Action Queue
// ============================================================

export interface ScoredActionQueueItem extends ActionQueueItem {
  actionScore: number;
  scoreBreakdown: string;
  profileReasoning: string;
  rank: number;
}

export async function buildScoredDailyActionQueue(orgId: string): Promise<{
  generatedAt: string;
  headline: string;
  ranked: ScoredActionQueueItem[];
  topROI: ScoredActionQueueItem[];
  totalItems: number;
  profileUsed: boolean;
  performanceNote: string;
}> {
  const [rawQueue, profile] = await Promise.all([
    buildDailyActionQueue(orgId),
    computeActionPerformanceProfile(orgId),
  ]);

  const profileMap: Record<string, ActionSubTypeProfile> = {};
  for (const p of profile) profileMap[p.subType] = p;

  const urgencyWeights: Record<string, number> = {
    "🔴 Critical": 4,
    "🔴 High Risk": 3,
    "🟠 High": 2.5,
    "🟡 Fill Today": 2,
    "💰 Revenue": 1.5,
    "🟡 Watch": 1.2,
    "🔴 Expiring": 1.8,
    "🟡 Low": 1,
  };

  const categorySubTypeMap: Record<string, string> = {
    "Follow-Up Due": "backfill",
    "Churn Risk": "churn_risk",
    "Churn Risk (Medium)": "churn_risk",
    "Open Slots": "backfill",
    "Upsell Opportunity": "upsell",
    "Package Expiring": "low_sessions",
    "Low Sessions": "low_sessions",
  };

  const allItems = [...rawQueue.high, ...rawQueue.revenue, ...rawQueue.maintenance];
  const scored: ScoredActionQueueItem[] = allItems.map((item, i) => {
    const subType = categorySubTypeMap[item.category] ?? "general";
    const perf = profileMap[subType];
    const conversionRate = perf && perf.totalSent >= 3 ? perf.conversionRate : 0.25;
    const expectedRevenue = item.expectedRevenueCents ?? 7000;
    const urgencyWeight = urgencyWeights[item.urgencyLabel] ?? 1;
    const actionScore = Math.round(conversionRate * (expectedRevenue / 100) * urgencyWeight);

    let profileReasoning = "";
    if (perf && perf.totalSent >= 3) {
      profileReasoning = `${perf.conversionRateLabel} historical conversion on ${subType} outreach`;
      if (perf.trend === "improving") profileReasoning += ` (trending up)`;
      else if (perf.trend === "declining") profileReasoning += ` (trending down — monitor)`;
    } else {
      profileReasoning = "No profile data yet — using 25% baseline";
    }

    return {
      ...item,
      actionScore,
      scoreBreakdown: `${Math.round(conversionRate * 100)}% conv × $${(expectedRevenue / 100).toFixed(0)} × ${urgencyWeight}x urgency`,
      profileReasoning,
      rank: 0,
    };
  });

  scored.sort((a, b) => b.actionScore - a.actionScore);
  scored.forEach((item, i) => { item.rank = i + 1; });

  const topROI = scored.slice(0, 3);
  const profileUsed = profile.some(p => p.totalSent >= 3);
  const performanceNote = profileUsed
    ? `Priorities set using your last 30 days of tracked outreach (${profile.filter(p => p.totalSent >= 3).length} action type${profile.filter(p => p.totalSent >= 3).length !== 1 ? "s" : ""} with reliable data).`
    : "No reliable outreach history yet — using urgency-only ranking. Scores will improve as you track more actions.";

  return {
    generatedAt: rawQueue.generatedAt,
    headline: rawQueue.headline,
    ranked: scored,
    topROI,
    totalItems: rawQueue.totalItems,
    profileUsed,
    performanceNote,
  };
}

// ============================================================
// PHASE 3: Autonomous Mode
// ============================================================

export interface AutoModeStatus {
  level: number;
  label: string;
  description: string;
  allowedActions: string[];
  blockedActions: string[];
  isActive: boolean;
}

const AUTO_MODE_LEVELS: Record<number, Omit<AutoModeStatus, "level" | "isActive">> = {
  0: {
    label: "Manual",
    description: "All actions require explicit coach input. The agent only suggests.",
    allowedActions: [],
    blockedActions: ["All auto-drafts", "Auto follow-ups", "Auto backfill"],
  },
  1: {
    label: "Suggest",
    description: "Agent proactively surfaces recommendations and pre-drafts messages for review. Coach sends everything manually. (Default)",
    allowedActions: ["Show action queue proactively", "Pre-draft follow-up messages", "Surface backfill opportunities"],
    blockedActions: ["Auto-send any message", "Auto-book sessions"],
  },
  2: {
    label: "Semi-Auto",
    description: "Agent auto-creates draft follow-ups for messages sent 24+ hours ago with no response, and auto-drafts backfill outreach for slots opening within 24 hours. Coach reviews and sends.",
    allowedActions: ["Auto-draft follow-ups", "Auto-draft backfill outreach", "Package renewal reminders"],
    blockedActions: ["First-touch churn outreach", "Auto-book sessions", "Auto-send without review"],
  },
  3: {
    label: "Full Operator",
    description: "Agent pre-populates the daily queue every morning with ready-to-review drafts for all action types. Coach approves, agent tracks outcomes.",
    allowedActions: ["All level-2 actions", "Daily queue auto-population", "Weekly recap auto-generation"],
    blockedActions: ["Auto-book sessions", "First-touch churn outreach without coach flag"],
  },
};

export async function getAutoModeStatus(orgId: string): Promise<AutoModeStatus> {
  const level = await storage.getOrgAutomationLevel(orgId);
  const info = AUTO_MODE_LEVELS[level] ?? AUTO_MODE_LEVELS[1];
  return { level, ...info, isActive: level >= 2 };
}

export async function setAutoMode(orgId: string, level: number): Promise<AutoModeStatus> {
  const clamped = Math.max(0, Math.min(3, level));
  await storage.setOrgAutomationLevel(orgId, clamped);
  return getAutoModeStatus(orgId);
}

export async function runAutoModeJobs(orgId: string): Promise<{ drafted: number; actions: string[] }> {
  const mode = await getAutoModeStatus(orgId);
  if (mode.level < 2) return { drafted: 0, actions: [] };

  const drafted: string[] = [];
  const followUps = await generateFollowUpActions(orgId);

  for (const f of followUps.slice(0, 3)) {
    if (f.followUpCount === 0) {
      await createAgentAction({
        organizationId: orgId,
        clientId: f.clientId,
        clientName: f.clientName,
        actionType: "outreach",
        actionSubType: "follow_up",
        status: "pending",
        notes: "auto_generated",
        messageContent: { sms: f.recommendedMessage },
        followUpAt: addHours(new Date(), 24),
      }).catch(() => {});
      drafted.push(`Follow-up draft created for ${f.clientName}`);
    }
  }

  return { drafted: drafted.length, actions: drafted };
}

// ============================================================
// PHASE 4: Revenue Optimization Plan
// ============================================================

export interface RevenueOptimizationSlot {
  date: string;
  timeRange: string;
  coachName: string;
  coachId: string;
  estimatedRevenueCents: number;
  recommendedClient: string | null;
  recommendedClientId: string | null;
  messageType: string;
  messageTypeReasoning: string;
  fillProbability: number;
  fillProbabilityLabel: string;
  priorityRank: number;
}

export interface RevenueOptimizationPlan {
  generatedAt: string;
  weekOf: string;
  totalOpenSlots: number;
  estimatedMaxRevenueCents: number;
  estimatedMaxRevenueLabel: string;
  achievableRevenueCents: number;
  achievableRevenueLabel: string;
  slots: RevenueOptimizationSlot[];
  clientContactOrder: { rank: number; clientName: string; clientId: string; reason: string; messageType: string; estimatedRevenueCents: number }[];
  summary: string;
  topInsight: string;
}

export async function computeRevenueOptimizationPlan(orgId: string): Promise<RevenueOptimizationPlan> {
  const now = new Date();
  const weekEnd = addDays(startOfDay(now), 7);
  const timezone = "America/New_York";

  const [coaches, churnRisks, upsells, profile] = await Promise.all([
    storage.getCoachProfilesByOrganization(orgId),
    computeChurnRisks(orgId),
    computeUpsellOpportunities(orgId),
    computeActionPerformanceProfile(orgId),
  ]);

  const profileMap: Record<string, ActionSubTypeProfile> = {};
  for (const p of profile) profileMap[p.subType] = p;

  const bestMessageType = profile[0]?.subType ?? "backfill";
  const bestConvRate = profile[0]?.conversionRate ?? 0.25;

  const slots: RevenueOptimizationSlot[] = [];

  for (const coach of coaches) {
    const coachName = `${(coach as any).user?.firstName ?? ""} ${(coach as any).user?.lastName ?? ""}`.trim() || "Coach";
    const blocks = await storage.getAvailabilityBlocks(coach.id).catch(() => [] as any[]);
    const coachBookings = await storage.getCoachBookings(coach.id).catch(() => [] as any[]);
    const activeBookings = coachBookings.filter((b: any) => b.status !== "CANCELLED");

    let current = new Date(now);
    while (current <= weekEnd) {
      const zonedCurrent = toZonedTime(current, timezone);
      const dayOfWeek = (zonedCurrent.getDay() + 6) % 7;
      const dayBlocks = blocks.filter((b: any) => b.dayOfWeek === dayOfWeek);

      for (const block of dayBlocks) {
        const [startH, startM] = block.startTime.split(":").map(Number);
        const [endH, endM] = block.endTime.split(":").map(Number);
        const localStart = new Date(zonedCurrent); localStart.setHours(startH, startM, 0, 0);
        const localEnd = new Date(zonedCurrent); localEnd.setHours(endH, endM, 0, 0);
        const blockStartUTC = fromZonedTime(localStart, timezone);
        const blockEndUTC = fromZonedTime(localEnd, timezone);
        if (blockEndUTC <= now) continue;

        const bookedInBlock = activeBookings.filter((b: any) => {
          const bStart = new Date(b.startAt).getTime();
          const bEnd = new Date(b.endAt).getTime();
          return bStart < blockEndUTC.getTime() && bEnd > blockStartUTC.getTime();
        });

        const totalMins = (blockEndUTC.getTime() - blockStartUTC.getTime()) / 60000;
        const bookedMins = bookedInBlock.reduce((sum: number, b: any) => sum + (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60000, 0);
        const freeMins = totalMins - bookedMins;

        if (freeMins >= 45) {
          slots.push({
            date: format(toZonedTime(blockStartUTC, timezone), "EEEE, MMM d"),
            timeRange: `${format(toZonedTime(blockStartUTC, timezone), "h:mm a")}–${format(toZonedTime(blockEndUTC, timezone), "h:mm a")}`,
            coachName,
            coachId: coach.id,
            estimatedRevenueCents: 7000,
            recommendedClient: null,
            recommendedClientId: null,
            messageType: bestMessageType,
            messageTypeReasoning: "",
            fillProbability: bestConvRate,
            fillProbabilityLabel: `${Math.round(bestConvRate * 100)}%`,
            priorityRank: 0,
          });
        }
      }

      current = addDays(current, 1);
    }
  }

  const clientPool: { clientId: string; clientName: string; reason: string; messageType: string; roiScore: number; estimatedRevenueCents: number }[] = [];

  for (const c of churnRisks.filter(r => r.riskLevel === "high").slice(0, 5)) {
    const perf = profileMap["churn_risk"];
    const convRate = perf && perf.totalSent >= 2 ? perf.conversionRate : 0.2;
    clientPool.push({ clientId: c.clientId, clientName: c.clientName, reason: c.signals[0], messageType: "churn_risk", roiScore: Math.round(convRate * 70), estimatedRevenueCents: Math.round(convRate * 7000) });
  }

  for (const u of upsells.filter(u => u.priority === "high").slice(0, 5)) {
    const perf = profileMap["upsell"];
    const convRate = perf && perf.totalSent >= 2 ? perf.conversionRate : 0.3;
    clientPool.push({ clientId: u.clientId, clientName: u.clientName, reason: u.opportunity, messageType: "upsell", roiScore: Math.round(convRate * (u.estimatedRevenueLiftCents / 100)), estimatedRevenueCents: Math.round(convRate * u.estimatedRevenueLiftCents) });
  }

  clientPool.sort((a, b) => b.roiScore - a.roiScore);

  slots.forEach((slot, i) => {
    const client = clientPool[i];
    if (client) {
      slot.recommendedClient = client.clientName;
      slot.recommendedClientId = client.clientId;
      slot.messageType = client.messageType;
      slot.fillProbability = client.roiScore / 100;
      slot.fillProbabilityLabel = `${Math.min(99, client.roiScore)}%`;
      const perfForType = profileMap[client.messageType];
      slot.messageTypeReasoning = perfForType && perfForType.totalSent >= 3
        ? `${perfForType.conversionRateLabel} historical conversion for ${client.messageType} messages`
        : `Recommended based on client priority`;
    } else {
      slot.messageTypeReasoning = `Use backfill or waitlist outreach to fill`;
    }
    slot.priorityRank = i + 1;
  });

  slots.sort((a, b) => {
    const fillA = parseFloat(a.fillProbabilityLabel);
    const fillB = parseFloat(b.fillProbabilityLabel);
    return (fillB * b.estimatedRevenueCents) - (fillA * a.estimatedRevenueCents);
  });
  slots.forEach((s, i) => s.priorityRank = i + 1);

  const totalEstimatedRevenueCents = slots.reduce((s, sl) => s + sl.estimatedRevenueCents, 0);
  const achievableRevenueCents = slots.reduce((s, sl) => s + Math.round(sl.estimatedRevenueCents * sl.fillProbability), 0);

  const clientContactOrder = clientPool.slice(0, 7).map((c, i) => ({
    rank: i + 1,
    clientName: c.clientName,
    clientId: c.clientId,
    reason: c.reason,
    messageType: c.messageType,
    estimatedRevenueCents: c.estimatedRevenueCents,
  }));

  const topInsight = profile.length > 0 && profile[0].totalSent >= 3
    ? `Your best-converting outreach type is "${profile[0].subType}" at ${profile[0].conversionRateLabel}. Lead with that this week.`
    : "No reliable outreach history yet — prioritize by urgency. Start tracking outcomes to unlock adaptive prioritization.";

  return {
    generatedAt: format(now, "EEEE, MMMM d 'at' h:mm a"),
    weekOf: `${format(now, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`,
    totalOpenSlots: slots.length,
    estimatedMaxRevenueCents: totalEstimatedRevenueCents,
    estimatedMaxRevenueLabel: `$${(totalEstimatedRevenueCents / 100).toFixed(0)}`,
    achievableRevenueCents,
    achievableRevenueLabel: `$${(achievableRevenueCents / 100).toFixed(0)}`,
    slots: slots.slice(0, 10),
    clientContactOrder,
    summary: slots.length === 0
      ? "No open slots found for the next 7 days — schedule looks full."
      : `${slots.length} open slot${slots.length !== 1 ? "s" : ""} found. Potential revenue: $${(totalEstimatedRevenueCents / 100).toFixed(0)}. Achievable (adjusted for conversion): $${(achievableRevenueCents / 100).toFixed(0)}.`,
    topInsight,
  };
}

// ============================================================
// PHASE 5: Weekly Learning Feedback Loop
// ============================================================

export interface WeeklyLearningInsights {
  weekOf: string;
  whatWorked: string[];
  whatToDoMoreOf: string[];
  whatToStopOrReduce: string[];
  improvements: string[];
  bestActionType: string | null;
  worstActionType: string | null;
  conversionTrend: "improving" | "declining" | "stable" | "insufficient_data";
  weekOverWeekNote: string;
}

export async function getWeeklyLearningInsights(orgId: string): Promise<WeeklyLearningInsights> {
  const now = new Date();
  const thisWeekStart = subDays(now, 7);
  const lastWeekStart = subDays(now, 14);

  const [thisWeekActions, lastWeekActions, profile] = await Promise.all([
    db.select().from(agentActions).where(and(eq(agentActions.organizationId, orgId), gte(agentActions.createdAt, thisWeekStart))),
    db.select().from(agentActions).where(and(eq(agentActions.organizationId, orgId), gte(agentActions.createdAt, lastWeekStart), lt(agentActions.createdAt, thisWeekStart))),
    computeActionPerformanceProfile(orgId),
  ]);

  const calcStats = (actions: AgentAction[]) => {
    const outreach = actions.filter(a => a.actionType === "outreach");
    const sent = outreach.filter(a => ["sent", "responded", "booked", "ignored"].includes(a.status ?? "")).length;
    const booked = outreach.filter(a => a.status === "booked").length;
    const revenue = outreach.filter(a => a.status === "booked").reduce((s, a) => s + (a.outcomeValueCents ?? 0), 0);
    return { sent, booked, revenue, convRate: sent > 0 ? booked / sent : 0 };
  };

  const thisWeek = calcStats(thisWeekActions);
  const lastWeek = calcStats(lastWeekActions);

  const whatWorked: string[] = [];
  const whatToDoMoreOf: string[] = [];
  const whatToStopOrReduce: string[] = [];
  const improvements: string[] = [];

  const bestProfile = profile.find(p => p.totalSent >= 3 && p.conversionRate > 0);
  const worstProfile = profile.filter(p => p.totalSent >= 3).sort((a, b) => a.conversionRate - b.conversionRate)[0];

  if (bestProfile) {
    whatWorked.push(`${bestProfile.subType} outreach converted at ${bestProfile.conversionRateLabel} — your strongest action type.`);
    whatToDoMoreOf.push(`More ${bestProfile.subType} outreach. At ${bestProfile.conversionRateLabel}, it generates $${(bestProfile.avgRevenuePerBookingCents / 100).toFixed(0)} avg per booking.`);
    if (bestProfile.trend === "improving") whatToDoMoreOf.push(`${bestProfile.subType} is trending up — ${bestProfile.trendDetail}.`);
  }

  if (worstProfile && worstProfile !== bestProfile) {
    whatToStopOrReduce.push(`${worstProfile.subType} outreach is your lowest converter at ${worstProfile.conversionRateLabel}. Consider reducing frequency or changing the message approach.`);
    if (worstProfile.trend === "declining") whatToStopOrReduce.push(`${worstProfile.subType} is trending down — ${worstProfile.trendDetail}.`);
  }

  if (thisWeek.convRate > lastWeek.convRate + 0.05) {
    whatWorked.push(`Overall conversion improved from ${Math.round(lastWeek.convRate * 100)}% to ${Math.round(thisWeek.convRate * 100)}% week-over-week.`);
  }
  if (thisWeek.revenue > lastWeek.revenue) {
    whatWorked.push(`Revenue from agent outreach up $${((thisWeek.revenue - lastWeek.revenue) / 100).toFixed(0)} vs last week.`);
  }

  if (thisWeek.booked === 0 && thisWeek.sent > 0) {
    improvements.push("No conversions this week despite outreach — try different message timing or lead with the open slot specifically.");
  }
  if (thisWeek.sent === 0) {
    improvements.push("No outreach was tracked this week. Use draft_client_outreach to start building the feedback loop.");
  }

  let conversionTrend: WeeklyLearningInsights["conversionTrend"] = "insufficient_data";
  let weekOverWeekNote = "Not enough data for week-over-week comparison.";
  if (lastWeek.sent >= 2 && thisWeek.sent >= 2) {
    const delta = thisWeek.convRate - lastWeek.convRate;
    if (delta > 0.05) { conversionTrend = "improving"; weekOverWeekNote = `Conversion improved by ${Math.round(delta * 100)}pp this week vs last week.`; }
    else if (delta < -0.05) { conversionTrend = "declining"; weekOverWeekNote = `Conversion dropped ${Math.abs(Math.round(delta * 100))}pp this week vs last week — review what changed.`; }
    else { conversionTrend = "stable"; weekOverWeekNote = `Conversion rate stable at ~${Math.round(thisWeek.convRate * 100)}% week-over-week.`; }
  }

  return {
    weekOf: `${format(thisWeekStart, "MMM d")} – ${format(now, "MMM d, yyyy")}`,
    whatWorked,
    whatToDoMoreOf,
    whatToStopOrReduce,
    improvements,
    bestActionType: bestProfile?.subType ?? null,
    worstActionType: worstProfile !== bestProfile ? worstProfile?.subType ?? null : null,
    conversionTrend,
    weekOverWeekNote,
  };
}
