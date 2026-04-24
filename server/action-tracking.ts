import { db } from "./db";
import { storage } from "./storage";
import { agentActions, bookings, services, users, coachProfiles } from "@shared/schema";
import type { AgentAction, InsertAgentAction } from "@shared/schema";
import { eq, and, inArray, gte, lte, lt, isNull, or, desc, sql, ne } from "drizzle-orm";
import { subHours, subDays, addHours, format, startOfDay, endOfDay, addDays } from "date-fns";
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
