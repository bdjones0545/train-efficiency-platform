import { storage } from "./storage";
import { subDays, startOfMonth, endOfMonth, startOfDay, format, differenceInDays, getDaysInMonth, startOfWeek, endOfWeek, differenceInMinutes } from "date-fns";
import { db } from "./db";
import {
  bookings,
  services,
  users,
  userProfiles,
  coachProfiles,
  userSubscriptions,
  organizationSubscriptionPlans,
} from "@shared/schema";
import { eq, and, inArray, gte, lte, sql, desc } from "drizzle-orm";

export interface ClientLTV {
  clientId: string;
  clientName: string;
  email: string | null;
  totalRevenueCents: number;
  sessionCount: number;
  avgRevenuePerSessionCents: number;
  firstSessionDate: string | null;
  lastSessionDate: string | null;
  retentionDays: number;
  monthlyAvgSpendCents: number;
  isSubscriber: boolean;
  subscriptionStatus: string | null;
  sessionsRemaining: number | null;
  churnRisk: "high" | "medium" | "low" | "none";
  churnSignals: string[];
}

export interface ChurnRisk {
  clientId: string;
  clientName: string;
  email: string | null;
  riskLevel: "high" | "medium";
  signals: string[];
  lastBookingDate: string | null;
  daysSinceLastBooking: number;
  recentSessionCount: number;
  priorSessionCount: number;
  sessionDropPct: number;
  suggestedAction: string;
}

export interface UpsellOpportunity {
  clientId: string;
  clientName: string;
  currentPattern: string;
  opportunity: string;
  estimatedRevenueLiftCents: number;
  reasoning: string;
  priority: "high" | "medium";
}

export interface TimeBlockRevenue {
  hour: number;
  label: string;
  totalRevenueCents: number;
  sessionCount: number;
  avgRevenueCents: number;
}

export interface CoachRevenue {
  coachId: string;
  coachName: string;
  totalRevenueCents: number;
  sessionCount: number;
  avgRevenuePerSessionCents: number;
  activeClients: number;
}

export interface SessionPackageAlert {
  clientId: string;
  clientName: string;
  email: string | null;
  planName: string;
  sessionsRemaining: number;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  urgency: "critical" | "warning";
}

export interface RevenueSummary {
  generatedAt: string;
  periodLabel: string;
  totalRevenueCents: number;
  last30dRevenueCents: number;
  prior30dRevenueCents: number;
  revenueGrowthPct: number;
  mrr: number;
  activeSubscribers: number;
  avgLtvCents: number;
  avgRevenuePerSessionCents: number;
  totalSessions: number;
  sessionsLast30d: number;
  churnRiskCount: number;
  sessionPackageAlertCount: number;
  upsellOpportunityCount: number;
  coachRevenues: CoachRevenue[];
  timeBlockRevenues: TimeBlockRevenue[];
  topClients: { clientId: string; clientName: string; totalRevenueCents: number; sessionCount: number }[];
}

async function getOrgCoachIds(orgId: string): Promise<string[]> {
  const coaches = await db.select({ id: coachProfiles.id })
    .from(coachProfiles)
    .where(eq(coachProfiles.organizationId, orgId));
  return coaches.map(c => c.id);
}

async function getOrgBookingsWithService(orgId: string, since?: Date) {
  const coachIds = await getOrgCoachIds(orgId);
  if (coachIds.length === 0) return [];

  const conditions = [
    inArray(bookings.coachId, coachIds),
    inArray(bookings.status as any, ["CONFIRMED", "COMPLETED"]),
  ];
  if (since) conditions.push(gte(bookings.startAt, since) as any);

  const rows = await db.select({
    id: bookings.id,
    clientId: bookings.clientId,
    coachId: bookings.coachId,
    serviceId: bookings.serviceId,
    startAt: bookings.startAt,
    endAt: bookings.endAt,
    status: bookings.status,
    priceCents: services.priceCents,
    serviceName: services.name,
    sessionType: services.sessionType,
    serviceCategory: services.category,
    countsTowardRevenue: services.countsTowardRevenue,
    revenueRecognition: services.revenueRecognition,
    payoutType: services.payoutType,
    payoutValueCents: services.payoutValueCents,
    payoutPercent: services.payoutPercent,
    countsTowardUtilization: services.countsTowardUtilization,
    countsTowardSessionCount: services.countsTowardSessionCount,
    requiresClient: services.requiresClient,
  })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .where(and(...conditions));

  return rows;
}

export async function computeRevenueSummary(orgId: string): Promise<RevenueSummary> {
  const now = new Date();
  const thirtyDaysAgo = subDays(now, 30);
  const sixtyDaysAgo = subDays(now, 60);

  const [allBookings, coachRows, userSubs, subPlans] = await Promise.all([
    getOrgBookingsWithService(orgId),
    db.select({
      id: coachProfiles.id,
      orgId: coachProfiles.organizationId,
      firstName: users.firstName,
      lastName: users.lastName,
    })
      .from(coachProfiles)
      .leftJoin(users, eq(coachProfiles.userId, users.id))
      .where(eq(coachProfiles.organizationId, orgId)),
    db.select().from(userSubscriptions).where(
      and(eq(userSubscriptions.organizationId, orgId), eq(userSubscriptions.status, "active"))
    ),
    db.select().from(organizationSubscriptionPlans).where(
      and(eq(organizationSubscriptionPlans.organizationId, orgId), eq(organizationSubscriptionPlans.active, true))
    ),
  ]);

  const coachMap = new Map(coachRows.map(c => [c.id, `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()]));

  // Only include revenue-generating bookings in financial calculations
  const revenueBookings = allBookings.filter(b => b.countsTowardRevenue !== false && (b.priceCents ?? 0) > 0);
  const last30d = revenueBookings.filter(b => new Date(b.startAt) >= thirtyDaysAgo);
  const prior30d = revenueBookings.filter(b => new Date(b.startAt) >= sixtyDaysAgo && new Date(b.startAt) < thirtyDaysAgo);

  const totalRevenueCents = revenueBookings.reduce((s, b) => s + (b.priceCents ?? 0), 0);
  const last30dRevenueCents = last30d.reduce((s, b) => s + (b.priceCents ?? 0), 0);
  const prior30dRevenueCents = prior30d.reduce((s, b) => s + (b.priceCents ?? 0), 0);
  const revenueGrowthPct = prior30dRevenueCents > 0
    ? Math.round(((last30dRevenueCents - prior30dRevenueCents) / prior30dRevenueCents) * 100)
    : 0;

  // MRR from subscriptions
  const planMap = new Map(subPlans.map(p => [p.id, p]));
  let mrr = 0;
  for (const sub of userSubs) {
    const plan = planMap.get(sub.planId);
    if (plan) {
      const monthlyAmount = plan.interval === "year"
        ? Math.round(plan.amountCents / 12)
        : plan.interval === "week"
          ? plan.amountCents * 4
          : plan.amountCents;
      mrr += monthlyAmount;
    }
  }

  // Revenue by coach (only revenue-generating bookings)
  const coachRevenueMap = new Map<string, { revenue: number; sessions: number; clients: Set<string> }>();
  for (const b of revenueBookings) {
    if (!coachRevenueMap.has(b.coachId)) {
      coachRevenueMap.set(b.coachId, { revenue: 0, sessions: 0, clients: new Set() });
    }
    const entry = coachRevenueMap.get(b.coachId)!;
    entry.revenue += b.priceCents ?? 0;
    entry.sessions++;
    entry.clients.add(b.clientId);
  }

  const coachRevenues: CoachRevenue[] = Array.from(coachRevenueMap.entries())
    .map(([coachId, data]) => ({
      coachId,
      coachName: coachMap.get(coachId) ?? "Unknown",
      totalRevenueCents: data.revenue,
      sessionCount: data.sessions,
      avgRevenuePerSessionCents: data.sessions > 0 ? Math.round(data.revenue / data.sessions) : 0,
      activeClients: data.clients.size,
    }))
    .sort((a, b) => b.totalRevenueCents - a.totalRevenueCents);

  // Revenue by time block (hour of day)
  const hourMap = new Map<number, { revenue: number; sessions: number }>();
  for (const b of last30d) {
    const hour = new Date(b.startAt).getHours();
    if (!hourMap.has(hour)) hourMap.set(hour, { revenue: 0, sessions: 0 });
    hourMap.get(hour)!.revenue += b.priceCents ?? 0;
    hourMap.get(hour)!.sessions++;
  }

  const timeBlockRevenues: TimeBlockRevenue[] = Array.from(hourMap.entries())
    .map(([hour, data]) => ({
      hour,
      label: hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`,
      totalRevenueCents: data.revenue,
      sessionCount: data.sessions,
      avgRevenueCents: data.sessions > 0 ? Math.round(data.revenue / data.sessions) : 0,
    }))
    .sort((a, b) => a.hour - b.hour);

  // Top clients by revenue
  const clientRevenueMap = new Map<string, number>();
  const clientSessionMap = new Map<string, number>();
  for (const b of allBookings) {
    clientRevenueMap.set(b.clientId, (clientRevenueMap.get(b.clientId) ?? 0) + (b.priceCents ?? 0));
    clientSessionMap.set(b.clientId, (clientSessionMap.get(b.clientId) ?? 0) + 1);
  }

  const topClientIds = Array.from(clientRevenueMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  const topClientUsers = topClientIds.length > 0
    ? await db.select().from(users).where(inArray(users.id, topClientIds))
    : [];
  const topClientMap = new Map(topClientUsers.map(u => [u.id, u]));

  const topClients = topClientIds.map(id => {
    const u = topClientMap.get(id);
    return {
      clientId: id,
      clientName: u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : id,
      totalRevenueCents: clientRevenueMap.get(id) ?? 0,
      sessionCount: clientSessionMap.get(id) ?? 0,
    };
  });

  // Churn risk count and session package alerts
  const [churnRisks, packageAlerts] = await Promise.all([
    computeChurnRisks(orgId),
    computeSessionPackageAlerts(orgId),
  ]);

  const upsellOpportunities = await computeUpsellOpportunities(orgId);

  const totalSessions = allBookings.length;
  const revenueSessions = revenueBookings.length;
  const nonRevenueSessions = totalSessions - revenueSessions;
  const internalSessions = allBookings.filter(b =>
    b.serviceCategory === "internal" || b.serviceCategory === "meeting"
  ).length;
  const uniqueClients = new Set(revenueBookings.map(b => b.clientId)).size;
  const avgLtvCents = uniqueClients > 0 ? Math.round(totalRevenueCents / uniqueClients) : 0;

  return {
    generatedAt: now.toISOString(),
    periodLabel: "All time",
    totalRevenueCents,
    last30dRevenueCents,
    prior30dRevenueCents,
    revenueGrowthPct,
    mrr,
    activeSubscribers: userSubs.length,
    avgLtvCents,
    avgRevenuePerSessionCents: revenueSessions > 0 ? Math.round(totalRevenueCents / revenueSessions) : 0,
    totalSessions,
    sessionsLast30d: last30d.length,
    churnRiskCount: churnRisks.length,
    sessionPackageAlertCount: packageAlerts.length,
    upsellOpportunityCount: upsellOpportunities.length,
    coachRevenues,
    timeBlockRevenues,
    topClients,
  };
}

export async function computeChurnRisks(orgId: string): Promise<ChurnRisk[]> {
  const now = new Date();
  const last14d = subDays(now, 14);
  const prior14d = subDays(now, 28);

  const coachIds = await getOrgCoachIds(orgId);
  if (coachIds.length === 0) return [];

  // Get all bookings (including recent cancellations for context)
  const allRows = await db.select({
    clientId: bookings.clientId,
    startAt: bookings.startAt,
    status: bookings.status,
  })
    .from(bookings)
    .where(and(
      inArray(bookings.coachId, coachIds),
      gte(bookings.startAt, subDays(now, 60))
    ));

  // Active subscriptions for churn signal
  const activeSubs = await db.select().from(userSubscriptions).where(
    and(eq(userSubscriptions.organizationId, orgId))
  );
  const subByClient = new Map(activeSubs.map(s => [s.userId, s]));

  // Group by client
  const clientBookings = new Map<string, { date: Date; status: string }[]>();
  for (const row of allRows) {
    if (!clientBookings.has(row.clientId)) clientBookings.set(row.clientId, []);
    clientBookings.get(row.clientId)!.push({ date: new Date(row.startAt), status: row.status });
  }

  // Get client names
  const clientIds = Array.from(clientBookings.keys());
  const clientUsers = clientIds.length > 0
    ? await db.select().from(users).where(inArray(users.id, clientIds))
    : [];
  const clientMap = new Map(clientUsers.map(u => [u.id, u]));

  const risks: ChurnRisk[] = [];

  Array.from(clientBookings.entries()).forEach(([clientId, history]) => {
    const confirmed = history.filter((b: { date: Date; status: string }) => b.status === "CONFIRMED" || b.status === "COMPLETED");
    const recentConfirmed = confirmed.filter((b: { date: Date; status: string }) => b.date >= last14d);
    const priorConfirmed = confirmed.filter((b: { date: Date; status: string }) => b.date >= prior14d && b.date < last14d);

    const lastBooking = confirmed.sort((a: { date: Date }, b: { date: Date }) => b.date.getTime() - a.date.getTime())[0];
    const daysSinceLast = lastBooking ? differenceInDays(now, lastBooking.date) : 999;

    const signals: string[] = [];
    let riskLevel: "high" | "medium" | null = null;

    // No booking in 14+ days
    if (daysSinceLast >= 21) {
      signals.push(`No session in ${daysSinceLast} days`);
      riskLevel = "high";
    } else if (daysSinceLast >= 14) {
      signals.push(`No session in ${daysSinceLast} days`);
      riskLevel = riskLevel ?? "medium";
    }

    // Session frequency drop
    const sessionDropPct = priorConfirmed.length > 0
      ? Math.round(((priorConfirmed.length - recentConfirmed.length) / priorConfirmed.length) * 100)
      : 0;
    if (sessionDropPct >= 50 && priorConfirmed.length >= 2) {
      signals.push(`Session frequency dropped ${sessionDropPct}% (${priorConfirmed.length} \u2192 ${recentConfirmed.length} sessions/2wk)`);
      riskLevel = "high";
    } else if (sessionDropPct >= 25 && priorConfirmed.length >= 2) {
      signals.push(`Session frequency down ${sessionDropPct}%`);
      riskLevel = riskLevel ?? "medium";
    }

    // Subscription cancellation pending
    const sub = subByClient.get(clientId);
    if (sub?.cancelAtPeriodEnd) {
      signals.push("Subscription set to cancel at period end");
      riskLevel = "high";
    }

    // Low sessions remaining
    if (sub?.sessionsRemaining !== null && sub?.sessionsRemaining !== undefined && sub.sessionsRemaining <= 1) {
      signals.push(`Only ${sub.sessionsRemaining} session${sub.sessionsRemaining === 1 ? "" : "s"} remaining on plan`);
      riskLevel = riskLevel ?? "medium";
    }

    if (!riskLevel) return;

    const u = clientMap.get(clientId);
    const clientName = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "Unknown";

    let suggestedAction = "Schedule a check-in call";
    if (daysSinceLast >= 14) suggestedAction = `Reach out to ${clientName} — offer a session this week`;
    if (sub?.cancelAtPeriodEnd) suggestedAction = `Contact ${clientName} about renewing before subscription ends`;
    if (sessionDropPct >= 50) suggestedAction = `Suggest a new training focus for ${clientName} to re-engage`;

    risks.push({
      clientId,
      clientName,
      email: u?.email ?? null,
      riskLevel,
      signals,
      lastBookingDate: lastBooking ? format(lastBooking.date, "MMM d, yyyy") : null,
      daysSinceLastBooking: daysSinceLast,
      recentSessionCount: recentConfirmed.length,
      priorSessionCount: priorConfirmed.length,
      sessionDropPct,
      suggestedAction,
    });
  });

  return risks.sort((a, b) => {
    const lvl: Record<string, number> = { high: 0, medium: 1 };
    return lvl[a.riskLevel] - lvl[b.riskLevel] || b.daysSinceLastBooking - a.daysSinceLastBooking;
  });
}

export async function computeUpsellOpportunities(orgId: string): Promise<UpsellOpportunity[]> {
  const now = new Date();
  const last30d = subDays(now, 30);

  const coachIds = await getOrgCoachIds(orgId);
  if (coachIds.length === 0) return [];

  const recentBookings = await db.select({
    clientId: bookings.clientId,
    startAt: bookings.startAt,
    sessionType: services.sessionType,
    priceCents: services.priceCents,
    serviceName: services.name,
  })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .where(and(
      inArray(bookings.coachId, coachIds),
      inArray(bookings.status as any, ["CONFIRMED", "COMPLETED"]),
      gte(bookings.startAt, last30d)
    ));

  const clientIds = Array.from(new Set(recentBookings.map((b) => b.clientId)));
  const clientUsers = clientIds.length > 0
    ? await db.select().from(users).where(inArray(users.id, clientIds))
    : [];
  const clientMap = new Map(clientUsers.map(u => [u.id, u]));

  const opportunities: UpsellOpportunity[] = [];

  // Group by client
  const clientSessionsMap = new Map<string, typeof recentBookings>();
  for (const b of recentBookings) {
    if (!clientSessionsMap.has(b.clientId)) clientSessionsMap.set(b.clientId, []);
    clientSessionsMap.get(b.clientId)!.push(b);
  }

  Array.from(clientSessionsMap.entries()).forEach(([clientId, sessions]) => {
    const u = clientMap.get(clientId);
    const clientName = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "Unknown";

    const weeklyFreq = sessions.length / 4.3;
    const avgPrice = sessions.length > 0
      ? sessions.reduce((s: number, b) => s + (b.priceCents ?? 0), 0) / sessions.length
      : 0;

    // 1. Frequency upsell: booking ~1x/week → suggest 2x
    if (weeklyFreq >= 0.8 && weeklyFreq < 1.5 && sessions.length >= 3) {
      opportunities.push({
        clientId,
        clientName,
        currentPattern: `${Math.round(weeklyFreq * 10) / 10}x/week`,
        opportunity: "Add 2nd weekly session",
        estimatedRevenueLiftCents: Math.round(avgPrice * 4),
        reasoning: `${clientName} has been consistently booking ~${Math.round(weeklyFreq * 10) / 10}x/week. Adding a 2nd session per week could increase monthly revenue by ~$${Math.round(avgPrice * 4 / 100)}.`,
        priority: "high",
      });
    }

    // 2. Session type upsell: 1-on-1 → semi-private
    const has1on1 = sessions.some((s) => s.sessionType === "1_ON_1" || s.sessionType === null);
    if (has1on1 && weeklyFreq >= 1) {
      opportunities.push({
        clientId,
        clientName,
        currentPattern: "1-on-1 sessions",
        opportunity: "Introduce to semi-private group",
        estimatedRevenueLiftCents: Math.round(avgPrice * 0.2 * sessions.length),
        reasoning: `${clientName} consistently trains 1-on-1. A semi-private session could be a higher-value option for both client and business.`,
        priority: "medium",
      });
    }
  });

  return opportunities
    .sort((a, b) => {
      const p: Record<string, number> = { high: 0, medium: 1 };
      return p[a.priority] - p[b.priority] || b.estimatedRevenueLiftCents - a.estimatedRevenueLiftCents;
    })
    .slice(0, 10);
}

export async function computeSessionPackageAlerts(orgId: string): Promise<SessionPackageAlert[]> {
  const subs = await db.select({
    id: userSubscriptions.id,
    userId: userSubscriptions.userId,
    planId: userSubscriptions.planId,
    status: userSubscriptions.status,
    sessionsRemaining: userSubscriptions.sessionsRemaining,
    cancelAtPeriodEnd: userSubscriptions.cancelAtPeriodEnd,
  })
    .from(userSubscriptions)
    .where(and(
      eq(userSubscriptions.organizationId, orgId),
      inArray(userSubscriptions.status as any, ["active", "past_due"])
    ));

  if (subs.length === 0) return [];

  const planIds = Array.from(new Set(subs.map(s => s.planId)));
  const plans = planIds.length > 0
    ? await db.select().from(organizationSubscriptionPlans).where(inArray(organizationSubscriptionPlans.id, planIds))
    : [];
  const planMap = new Map(plans.map(p => [p.id, p]));

  const userIds = subs.map(s => s.userId);
  const subUsers = userIds.length > 0
    ? await db.select().from(users).where(inArray(users.id, userIds))
    : [];
  const userMap = new Map(subUsers.map(u => [u.id, u]));

  const alerts: SessionPackageAlert[] = [];

  for (const sub of subs) {
    const isLowBalance = sub.sessionsRemaining !== null && sub.sessionsRemaining <= 2;
    const isCancelling = sub.cancelAtPeriodEnd;
    const isPastDue = sub.status === "past_due";

    if (!isLowBalance && !isCancelling && !isPastDue) continue;

    const u = userMap.get(sub.userId);
    const plan = planMap.get(sub.planId);

    alerts.push({
      clientId: sub.userId,
      clientName: u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : sub.userId,
      email: u?.email ?? null,
      planName: plan?.name ?? "Subscription",
      sessionsRemaining: sub.sessionsRemaining ?? 0,
      subscriptionStatus: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
      urgency: (sub.sessionsRemaining !== null && sub.sessionsRemaining <= 0) || isPastDue ? "critical" : "warning",
    });
  }

  return alerts.sort((a, b) => {
    const u = { critical: 0, warning: 1 };
    return u[a.urgency] - u[b.urgency];
  });
}

export async function computeClientLTVs(orgId: string): Promise<ClientLTV[]> {
  const now = new Date();
  const coachIds = await getOrgCoachIds(orgId);
  if (coachIds.length === 0) return [];

  const allBookings = await db.select({
    clientId: bookings.clientId,
    startAt: bookings.startAt,
    status: bookings.status,
    priceCents: services.priceCents,
  })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .where(and(
      inArray(bookings.coachId, coachIds),
      inArray(bookings.status as any, ["CONFIRMED", "COMPLETED"])
    ));

  const userSubs = await db.select().from(userSubscriptions).where(eq(userSubscriptions.organizationId, orgId));
  const subByClient = new Map(userSubs.map(s => [s.userId, s]));

  // Group bookings by client
  const clientMap = new Map<string, { totalCents: number; count: number; dates: Date[] }>();
  for (const b of allBookings) {
    if (!clientMap.has(b.clientId)) clientMap.set(b.clientId, { totalCents: 0, count: 0, dates: [] });
    const entry = clientMap.get(b.clientId)!;
    entry.totalCents += b.priceCents ?? 0;
    entry.count++;
    entry.dates.push(new Date(b.startAt));
  }

  const clientIds = Array.from(clientMap.keys());
  const clientUsers = clientIds.length > 0
    ? await db.select().from(users).where(inArray(users.id, clientIds))
    : [];
  const userMap = new Map(clientUsers.map(u => [u.id, u]));

  // Also get churn risks for cross-reference
  const churnRisks = await computeChurnRisks(orgId);
  const churnMap = new Map(churnRisks.map(r => [r.clientId, r]));

  const ltvs: ClientLTV[] = [];

  Array.from(clientMap.entries()).forEach(([clientId, data]) => {
    const u = userMap.get(clientId);
    const sub = subByClient.get(clientId);
    const churn = churnMap.get(clientId);

    const sortedDates = data.dates.sort((a: Date, b: Date) => a.getTime() - b.getTime());
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];
    const retentionDays = firstDate ? differenceInDays(lastDate ?? now, firstDate) : 0;
    const monthlyAvg = retentionDays > 0
      ? Math.round(data.totalCents / (retentionDays / 30))
      : data.totalCents;

    ltvs.push({
      clientId,
      clientName: u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : clientId,
      email: u?.email ?? null,
      totalRevenueCents: data.totalCents,
      sessionCount: data.count,
      avgRevenuePerSessionCents: data.count > 0 ? Math.round(data.totalCents / data.count) : 0,
      firstSessionDate: firstDate ? format(firstDate, "MMM d, yyyy") : null,
      lastSessionDate: lastDate ? format(lastDate, "MMM d, yyyy") : null,
      retentionDays,
      monthlyAvgSpendCents: monthlyAvg,
      isSubscriber: !!sub,
      subscriptionStatus: sub?.status ?? null,
      sessionsRemaining: sub?.sessionsRemaining ?? null,
      churnRisk: churn?.riskLevel ?? "none",
      churnSignals: churn?.signals ?? [],
    });
  });

  return ltvs.sort((a, b) => b.totalRevenueCents - a.totalRevenueCents);
}

// ─── Period Revenue & Forecasting ───────────────────────────────────────────

export interface PeriodRevenueSummary {
  periodLabel: string;
  startDate: string;
  endDate: string;
  totalRevenueCents: number;
  sessionCount: number;
  totalSessionCount?: number;
  nonRevenueSessions?: number;
  internalHours?: number;
  categoryBreakdown?: { category: string; sessions: number; revenueCents: number }[];
  coachBreakdown: { coachName: string; revenueCents: number; sessions: number }[];
  serviceBreakdown: { serviceName: string; revenueCents: number; sessions: number }[];
  comparison?: {
    priorPeriodLabel: string;
    priorRevenueCents: number;
    deltaCents: number;
    deltaPct: number;
    direction: "up" | "down" | "flat";
  };
}

export interface RevenueForecast {
  month: string;
  daysElapsed: number;
  daysRemaining: number;
  daysInMonth: number;
  revenueToDateCents: number;
  bookedFutureRevenueCents: number;
  mrrCents: number;
  projectedTotalCents: number;
  runRateCents: number;
  averageSessionValueCents: number;
  confidenceLevel: "low" | "medium" | "high";
  assumptions: string[];
  risks: string[];
  summary: string;
  targetCents?: number;
  revenueGapCents?: number;
  sessionsNeededToHitTarget?: number;
  sessionsPerDayNeeded?: number;
  targetSummary?: string;
}

async function getOrgBookingsForRange(orgId: string, startDate: Date, endDate: Date) {
  const coachIds = await getOrgCoachIds(orgId);
  if (coachIds.length === 0) return [];

  const rows = await db.select({
    id: bookings.id,
    clientId: bookings.clientId,
    coachId: bookings.coachId,
    serviceId: bookings.serviceId,
    startAt: bookings.startAt,
    endAt: bookings.endAt,
    status: bookings.status,
    priceCents: services.priceCents,
    serviceName: services.name,
    serviceCategory: services.category,
    countsTowardRevenue: services.countsTowardRevenue,
    countsTowardUtilization: services.countsTowardUtilization,
    payoutType: services.payoutType,
    payoutValueCents: services.payoutValueCents,
    payoutPercent: services.payoutPercent,
    coachFirstName: users.firstName,
    coachLastName: users.lastName,
  })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .leftJoin(coachProfiles, eq(bookings.coachId, coachProfiles.id))
    .leftJoin(users, eq(coachProfiles.userId, users.id))
    .where(and(
      inArray(bookings.coachId, coachIds),
      inArray(bookings.status as any, ["CONFIRMED", "COMPLETED"]),
      gte(bookings.startAt, startDate),
      lte(bookings.startAt, endDate)
    ));

  return rows;
}

export async function computeRevenueByPeriod(
  orgId: string,
  startDate: Date,
  endDate: Date,
  comparePeriodLabel?: string,
  compareStart?: Date,
  compareEnd?: Date
): Promise<PeriodRevenueSummary> {
  const [periodBookings, compareBookings] = await Promise.all([
    getOrgBookingsForRange(orgId, startDate, endDate),
    (compareStart && compareEnd)
      ? getOrgBookingsForRange(orgId, compareStart, compareEnd)
      : Promise.resolve([]),
  ]);

  // Only count revenue-generating bookings for financial totals
  const revPeriodBookings = periodBookings.filter(b => b.countsTowardRevenue !== false && (b.priceCents ?? 0) > 0);
  const revCompareBookings = compareBookings.filter(b => b.countsTowardRevenue !== false && (b.priceCents ?? 0) > 0);

  const totalRevenueCents = revPeriodBookings.reduce((s, b) => s + (b.priceCents ?? 0), 0);

  const coachMap = new Map<string, { name: string; revenue: number; sessions: number }>();
  for (const b of revPeriodBookings) {
    const name = `${b.coachFirstName ?? ""} ${b.coachLastName ?? ""}`.trim() || "Unknown";
    if (!coachMap.has(b.coachId)) coachMap.set(b.coachId, { name, revenue: 0, sessions: 0 });
    const e = coachMap.get(b.coachId)!;
    e.revenue += b.priceCents ?? 0;
    e.sessions++;
  }
  const coachBreakdown = Array.from(coachMap.values())
    .map(c => ({ coachName: c.name, revenueCents: c.revenue, sessions: c.sessions }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  const serviceMap = new Map<string, { revenue: number; sessions: number }>();
  for (const b of revPeriodBookings) {
    const key = b.serviceName ?? "Unknown";
    if (!serviceMap.has(key)) serviceMap.set(key, { revenue: 0, sessions: 0 });
    serviceMap.get(key)!.revenue += b.priceCents ?? 0;
    serviceMap.get(key)!.sessions++;
  }
  const serviceBreakdown = Array.from(serviceMap.entries())
    .map(([name, d]) => ({ serviceName: name, revenueCents: d.revenue, sessions: d.sessions }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  // Category breakdown (all sessions, not just revenue)
  const categoryCount = new Map<string, { sessions: number; revenueCents: number }>();
  for (const b of periodBookings) {
    const cat = b.serviceCategory ?? "paid";
    if (!categoryCount.has(cat)) categoryCount.set(cat, { sessions: 0, revenueCents: 0 });
    const e = categoryCount.get(cat)!;
    e.sessions++;
    if (b.countsTowardRevenue !== false) e.revenueCents += b.priceCents ?? 0;
  }
  const categoryBreakdown = Array.from(categoryCount.entries()).map(([category, d]) => ({ category, ...d }));

  const nonRevenueSessions = periodBookings.filter(b => !b.countsTowardRevenue || (b.priceCents ?? 0) === 0).length;
  const internalHours = periodBookings
    .filter(b => b.serviceCategory === "internal" || b.serviceCategory === "meeting")
    .reduce((s, b) => s + (b.endAt ? (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 3600000 : 0), 0);

  let comparison: PeriodRevenueSummary["comparison"] | undefined;
  if (compareStart && compareEnd && comparePeriodLabel) {
    const priorRevenueCents = revCompareBookings.reduce((s, b) => s + (b.priceCents ?? 0), 0);
    const deltaCents = totalRevenueCents - priorRevenueCents;
    const deltaPct = priorRevenueCents > 0
      ? Math.round((deltaCents / priorRevenueCents) * 100)
      : totalRevenueCents > 0 ? 100 : 0;
    comparison = {
      priorPeriodLabel: comparePeriodLabel,
      priorRevenueCents,
      deltaCents,
      deltaPct,
      direction: deltaCents > 0 ? "up" : deltaCents < 0 ? "down" : "flat",
    };
  }

  return {
    periodLabel: `${format(startDate, "MMM d")} – ${format(endDate, "MMM d, yyyy")}`,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    totalRevenueCents,
    sessionCount: revPeriodBookings.length,
    totalSessionCount: periodBookings.length,
    nonRevenueSessions,
    internalHours: Math.round(internalHours * 10) / 10,
    categoryBreakdown,
    coachBreakdown,
    serviceBreakdown,
    comparison,
  };
}

export async function computeRevenueForecast(orgId: string, targetCents?: number): Promise<RevenueForecast> {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const totalDaysInMonth = getDaysInMonth(now);
  const daysElapsed = Math.max(1, differenceInDays(now, monthStart) + 1);
  const daysRemaining = totalDaysInMonth - daysElapsed;
  const month = format(now, "MMMM yyyy");

  const coachIds = await getOrgCoachIds(orgId);

  const assumptions: string[] = [];
  const risks: string[] = [];

  if (coachIds.length === 0) {
    return {
      month,
      daysElapsed,
      daysRemaining,
      daysInMonth: totalDaysInMonth,
      revenueToDateCents: 0,
      bookedFutureRevenueCents: 0,
      mrrCents: 0,
      projectedTotalCents: 0,
      runRateCents: 0,
      averageSessionValueCents: 0,
      confidenceLevel: "low",
      assumptions: ["No coaches found in organization"],
      risks: ["No data available for forecast"],
      summary: "No revenue data available for this month.",
    };
  }

  const [pastRows, futureRows, userSubs, subPlans] = await Promise.all([
    db.select({ priceCents: services.priceCents })
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .where(and(
        inArray(bookings.coachId, coachIds),
        inArray(bookings.status as any, ["CONFIRMED", "COMPLETED"]),
        gte(bookings.startAt, monthStart),
        lte(bookings.startAt, now)
      )),
    db.select({ priceCents: services.priceCents })
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .where(and(
        inArray(bookings.coachId, coachIds),
        inArray(bookings.status as any, ["CONFIRMED"]),
        gte(bookings.startAt, now),
        lte(bookings.startAt, monthEnd)
      )),
    db.select().from(userSubscriptions).where(
      and(eq(userSubscriptions.organizationId, orgId), eq(userSubscriptions.status, "active"))
    ),
    db.select().from(organizationSubscriptionPlans).where(
      and(eq(organizationSubscriptionPlans.organizationId, orgId), eq(organizationSubscriptionPlans.active, true))
    ),
  ]);

  const revenueToDateCents = pastRows.reduce((s, b) => s + (b.priceCents ?? 0), 0);
  const bookedFutureRevenueCents = futureRows.reduce((s, b) => s + (b.priceCents ?? 0), 0);

  const planMap = new Map(subPlans.map(p => [p.id, p]));
  let mrr = 0;
  for (const sub of userSubs) {
    const plan = planMap.get(sub.planId);
    if (plan) {
      const monthly = plan.interval === "year"
        ? Math.round(plan.amountCents / 12)
        : plan.interval === "week"
          ? plan.amountCents * 4
          : plan.amountCents;
      mrr += monthly;
    }
  }

  const projectedTotalCents = revenueToDateCents + bookedFutureRevenueCents + mrr;
  const runRateCents = daysElapsed > 0
    ? Math.round((revenueToDateCents / daysElapsed) * totalDaysInMonth)
    : 0;

  let confidenceLevel: "low" | "medium" | "high" = "low";
  if (daysElapsed >= 14 && pastRows.length >= 10) confidenceLevel = "high";
  else if (daysElapsed >= 7 && pastRows.length >= 3) confidenceLevel = "medium";

  if (pastRows.length > 0) {
    assumptions.push(`${pastRows.length} sessions completed so far this month`);
  }
  if (futureRows.length > 0) {
    assumptions.push(`${futureRows.length} future sessions already booked through month-end`);
  }
  if (mrr > 0) {
    assumptions.push(`$${(mrr / 100).toFixed(0)}/mo MRR from ${userSubs.length} active subscriptions`);
  }
  if (daysElapsed > 0 && revenueToDateCents > 0) {
    const dailyRate = (revenueToDateCents / 100 / daysElapsed).toFixed(0);
    assumptions.push(`Daily session run rate: $${dailyRate}/day over ${daysElapsed} days elapsed`);
  }

  if (futureRows.length === 0) {
    risks.push("No future sessions booked this month — forecast excludes unbooked session revenue");
  }
  if (mrr === 0 && pastRows.length < 5) {
    risks.push("Limited session history and no subscriptions — low confidence");
  }
  if (daysElapsed < 7) {
    risks.push("Early in month — fewer days elapsed reduces forecast accuracy");
  }

  const averageSessionValueCents = pastRows.length > 0
    ? Math.round(pastRows.reduce((s, b) => s + (b.priceCents ?? 0), 0) / pastRows.length)
    : 0;

  const projFmt = `$${(projectedTotalCents / 100).toFixed(0)}`;
  const toDateFmt = `$${(revenueToDateCents / 100).toFixed(0)}`;
  const futureFmt = `$${(bookedFutureRevenueCents / 100).toFixed(0)}`;
  const summary = `${month}: ${toDateFmt} collected, ${futureFmt} in confirmed future bookings — projected total ${projFmt} by month-end (${confidenceLevel} confidence).`;

  let revenueGapCents: number | undefined;
  let sessionsNeededToHitTarget: number | undefined;
  let sessionsPerDayNeeded: number | undefined;
  let targetSummary: string | undefined;

  if (targetCents !== undefined && targetCents > 0) {
    revenueGapCents = Math.max(0, targetCents - projectedTotalCents);
    if (revenueGapCents > 0 && averageSessionValueCents > 0) {
      sessionsNeededToHitTarget = Math.ceil(revenueGapCents / averageSessionValueCents);
      sessionsPerDayNeeded = daysRemaining > 0 ? Math.ceil(sessionsNeededToHitTarget / daysRemaining) : sessionsNeededToHitTarget;
      targetSummary = `To reach $${(targetCents / 100).toFixed(0)}, you need $${(revenueGapCents / 100).toFixed(0)} more — that's ${sessionsNeededToHitTarget} additional session${sessionsNeededToHitTarget !== 1 ? "s" : ""} at your $${(averageSessionValueCents / 100).toFixed(0)} average rate (${sessionsPerDayNeeded}/day over ${daysRemaining} days remaining).`;
    } else {
      revenueGapCents = 0;
      targetSummary = `You are already on track to reach $${(targetCents / 100).toFixed(0)} this month — projected at ${projFmt}.`;
    }
  }

  return {
    month,
    daysElapsed,
    daysRemaining,
    daysInMonth: totalDaysInMonth,
    revenueToDateCents,
    bookedFutureRevenueCents,
    mrrCents: mrr,
    projectedTotalCents,
    runRateCents,
    averageSessionValueCents,
    confidenceLevel,
    assumptions,
    risks,
    summary,
    ...(targetCents !== undefined ? {
      targetCents,
      revenueGapCents,
      sessionsNeededToHitTarget,
      sessionsPerDayNeeded,
      targetSummary,
    } : {}),
  };
}

// ============================================================
// PHASE 9A — REVENUE QUALITY ENGINE
// ============================================================

export interface RevenueQuality {
  period: string;
  totalHours: number;
  revenueHours: number;
  nonRevenueHours: number;
  revenueQualityScore: number;
  breakdown: {
    paidHours: number;
    introHours: number;
    internalHours: number;
    meetingHours: number;
    membershipHours: number;
    compHours: number;
  };
  estimatedRevenueLostCents: number;
  avgRevenuePerHourCents: number;
  insight: string;
}

export async function computeRevenueQuality(
  orgId: string,
  startDate?: Date,
  endDate?: Date
): Promise<RevenueQuality> {
  const now = new Date();
  const start = startDate ?? startOfWeek(now, { weekStartsOn: 1 });
  const end = endDate ?? endOfWeek(now, { weekStartsOn: 1 });
  const periodLabel = `${format(start, "MMM d")} – ${format(end, "MMM d")}`;

  const bkgs = await getOrgBookingsForRange(orgId, start, end);

  const catHours: Record<string, number> = {
    paid: 0, intro: 0, internal: 0, meeting: 0, membership: 0, package_redemption: 0, comp: 0,
  };

  let totalRevenueCents = 0;
  let revenueSessionCount = 0;

  for (const b of bkgs) {
    const cat = (b.serviceCategory ?? "paid") as string;
    const mins = b.endAt && b.startAt
      ? differenceInMinutes(new Date(b.endAt), new Date(b.startAt))
      : 60;
    const hrs = mins / 60;
    if (cat in catHours) catHours[cat] += hrs;
    else catHours["paid"] += hrs;

    if (b.countsTowardRevenue !== false && (b.priceCents ?? 0) > 0) {
      totalRevenueCents += b.priceCents ?? 0;
      revenueSessionCount++;
    }
  }

  const paidHours = catHours["paid"];
  const introHours = catHours["intro"];
  const internalHours = catHours["internal"];
  const meetingHours = catHours["meeting"];
  const membershipHours = (catHours["membership"] ?? 0) + (catHours["package_redemption"] ?? 0);
  const compHours = catHours["comp"] ?? 0;

  const totalHours = Object.values(catHours).reduce((s, v) => s + v, 0);
  const revenueHours = paidHours + membershipHours;
  const nonRevenueHours = totalHours - revenueHours;

  // Weighted quality score
  const weightedHours =
    paidHours * 1.0 +
    membershipHours * 0.7 +
    introHours * 0.3 +
    internalHours * 0.0 +
    meetingHours * 0.0 +
    compHours * 0.0;

  const revenueQualityScore = totalHours > 0 ? Math.round((weightedHours / totalHours) * 100) / 100 : 0;

  const avgRevenuePerHourCents = revenueHours > 0 ? Math.round(totalRevenueCents / revenueHours) : 0;
  const estimatedRevenueLostCents = Math.round(nonRevenueHours * avgRevenuePerHourCents);

  let insight = "";
  if (totalHours === 0) {
    insight = "No sessions tracked in this period.";
  } else {
    const pct = Math.round(revenueQualityScore * 100);
    const lost = (estimatedRevenueLostCents / 100).toFixed(0);
    if (pct >= 80) {
      insight = `Strong revenue quality at ${pct}%. Most time is being invested in revenue-generating sessions.`;
    } else if (pct >= 50) {
      insight = `Revenue quality is ${pct}%. You worked ${totalHours.toFixed(1)} hours but only ${revenueHours.toFixed(1)} were revenue-generating — ~$${lost} in estimated lost opportunity.`;
    } else {
      insight = `Low revenue quality at ${pct}%. ${nonRevenueHours.toFixed(1)} non-revenue hours represent ~$${lost} in lost opportunity this period. Consider converting internal/meeting time to paid sessions where possible.`;
    }
  }

  return {
    period: periodLabel,
    totalHours: Math.round(totalHours * 10) / 10,
    revenueHours: Math.round(revenueHours * 10) / 10,
    nonRevenueHours: Math.round(nonRevenueHours * 10) / 10,
    revenueQualityScore,
    breakdown: {
      paidHours: Math.round(paidHours * 10) / 10,
      introHours: Math.round(introHours * 10) / 10,
      internalHours: Math.round(internalHours * 10) / 10,
      meetingHours: Math.round(meetingHours * 10) / 10,
      membershipHours: Math.round(membershipHours * 10) / 10,
      compHours: Math.round(compHours * 10) / 10,
    },
    estimatedRevenueLostCents,
    avgRevenuePerHourCents,
    insight,
  };
}

// ============================================================
// PHASE 9B — SESSION MIX ANALYSIS
// ============================================================

export interface SessionMix {
  period: string;
  totalSessions: number;
  categoryBreakdown: Record<string, number>;
  percentageBreakdown: Record<string, number>;
  revenueRatio: number;
  nonRevenueRatio: number;
  insight: string;
}

export async function computeSessionMix(
  orgId: string,
  startDate?: Date,
  endDate?: Date
): Promise<SessionMix> {
  const now = new Date();
  const start = startDate ?? startOfWeek(now, { weekStartsOn: 1 });
  const end = endDate ?? endOfWeek(now, { weekStartsOn: 1 });
  const periodLabel = `${format(start, "MMM d")} – ${format(end, "MMM d")}`;

  const bkgs = await getOrgBookingsForRange(orgId, start, end);

  const cats: Record<string, number> = {};
  for (const b of bkgs) {
    const cat = (b.serviceCategory ?? "paid") as string;
    cats[cat] = (cats[cat] ?? 0) + 1;
  }

  const total = bkgs.length;
  const pctBreakdown: Record<string, number> = {};
  for (const [cat, count] of Object.entries(cats)) {
    pctBreakdown[cat] = total > 0 ? Math.round((count / total) * 100) : 0;
  }

  const revenueCategories = ["paid", "membership", "package_redemption"];
  const revenueSessions = bkgs.filter(b => revenueCategories.includes((b.serviceCategory ?? "paid") as string)).length;
  const revenueRatio = total > 0 ? revenueSessions / total : 0;
  const nonRevenueRatio = 1 - revenueRatio;

  let insight = "";
  if (total === 0) {
    insight = "No sessions recorded in this period.";
  } else {
    const nonRevPct = Math.round(nonRevenueRatio * 100);
    const introPct = pctBreakdown["intro"] ?? 0;
    const internalPct = pctBreakdown["internal"] ?? 0;
    if (nonRevPct > 50) {
      insight = `${nonRevPct}% of your sessions this period were non-revenue — significantly reducing your earning potential.`;
      if (introPct > 20) insight += ` ${introPct}% were intros — consider following up to convert them to paid clients.`;
      if (internalPct > 20) insight += ` ${internalPct}% were internal hours — consider reducing or shifting to client sessions.`;
    } else if (nonRevPct > 25) {
      insight = `${nonRevPct}% non-revenue sessions this period. Review intro conversion rates and internal time allocation.`;
    } else {
      insight = `Good session mix — ${Math.round(revenueRatio * 100)}% of sessions are revenue-generating.`;
    }
  }

  return {
    period: periodLabel,
    totalSessions: total,
    categoryBreakdown: cats,
    percentageBreakdown: pctBreakdown,
    revenueRatio: Math.round(revenueRatio * 100) / 100,
    nonRevenueRatio: Math.round(nonRevenueRatio * 100) / 100,
    insight,
  };
}

// ============================================================
// PHASE 9C — COACH PROFITABILITY ENGINE
// ============================================================

export interface CoachProfitabilityEntry {
  coachId: string;
  coachName: string;
  revenueCents: number;
  payoutCents: number;
  netCents: number;
  marginPercent: number;
  sessionCount: number;
  hoursWorked: number;
  revenuePerHourCents: number;
  payoutPerHourCents: number;
}

export interface CoachProfitabilityReport {
  period: string;
  coaches: CoachProfitabilityEntry[];
  topMarginCoach: CoachProfitabilityEntry | null;
  lowestMarginCoach: CoachProfitabilityEntry | null;
  totalRevenueCents: number;
  totalPayoutCents: number;
  totalNetCents: number;
  orgMarginPercent: number;
  insight: string;
}

export async function computeCoachProfitability(
  orgId: string,
  startDate?: Date,
  endDate?: Date
): Promise<CoachProfitabilityReport> {
  const now = new Date();
  const start = startDate ?? startOfWeek(now, { weekStartsOn: 1 });
  const end = endDate ?? endOfWeek(now, { weekStartsOn: 1 });
  const periodLabel = `${format(start, "MMM d")} – ${format(end, "MMM d")}`;

  const bkgs = await getOrgBookingsForRange(orgId, start, end);

  const coachMap = new Map<string, {
    name: string;
    revenueCents: number;
    payoutCents: number;
    sessions: number;
    hours: number;
  }>();

  for (const b of bkgs) {
    const name = `${b.coachFirstName ?? ""} ${b.coachLastName ?? ""}`.trim() || "Unknown";
    if (!coachMap.has(b.coachId)) {
      coachMap.set(b.coachId, { name, revenueCents: 0, payoutCents: 0, sessions: 0, hours: 0 });
    }
    const entry = coachMap.get(b.coachId)!;
    entry.sessions++;

    const durationMins = b.endAt && b.startAt
      ? differenceInMinutes(new Date(b.endAt), new Date(b.startAt))
      : 60;
    entry.hours += durationMins / 60;

    if (b.countsTowardRevenue !== false && (b.priceCents ?? 0) > 0) {
      entry.revenueCents += b.priceCents ?? 0;
    }

    // Estimate payout
    const payoutType = b.payoutType ?? "percentage";
    if (payoutType === "none") {
      // no payout
    } else if (payoutType === "fixed") {
      entry.payoutCents += b.payoutValueCents ?? 0;
    } else if (payoutType === "hourly") {
      const hourlyRate = b.payoutValueCents ?? 0;
      entry.payoutCents += Math.round(hourlyRate * (durationMins / 60));
    } else {
      // percentage
      const pct = (b.payoutPercent ?? 50) / 100;
      entry.payoutCents += Math.round((b.priceCents ?? 0) * pct);
    }
  }

  const coaches: CoachProfitabilityEntry[] = Array.from(coachMap.entries()).map(([coachId, d]) => {
    const netCents = d.revenueCents - d.payoutCents;
    const marginPercent = d.revenueCents > 0 ? Math.round((netCents / d.revenueCents) * 100) : 0;
    return {
      coachId,
      coachName: d.name,
      revenueCents: d.revenueCents,
      payoutCents: d.payoutCents,
      netCents,
      marginPercent,
      sessionCount: d.sessions,
      hoursWorked: Math.round(d.hours * 10) / 10,
      revenuePerHourCents: d.hours > 0 ? Math.round(d.revenueCents / d.hours) : 0,
      payoutPerHourCents: d.hours > 0 ? Math.round(d.payoutCents / d.hours) : 0,
    };
  }).sort((a, b) => b.revenueCents - a.revenueCents);

  const totalRevenueCents = coaches.reduce((s, c) => s + c.revenueCents, 0);
  const totalPayoutCents = coaches.reduce((s, c) => s + c.payoutCents, 0);
  const totalNetCents = totalRevenueCents - totalPayoutCents;
  const orgMarginPercent = totalRevenueCents > 0 ? Math.round((totalNetCents / totalRevenueCents) * 100) : 0;

  const sorted = [...coaches].sort((a, b) => b.marginPercent - a.marginPercent);
  const topMarginCoach = sorted[0] ?? null;
  const lowestMarginCoach = sorted[sorted.length - 1] ?? null;

  let insight = "";
  if (coaches.length === 0) {
    insight = "No coaching sessions in this period.";
  } else if (coaches.length === 1) {
    const c = coaches[0];
    insight = `${c.coachName} generated $${(c.revenueCents / 100).toFixed(0)} with a ${c.marginPercent}% margin ($${(c.netCents / 100).toFixed(0)} net).`;
  } else {
    insight = `Org margin is ${orgMarginPercent}% ($${(totalNetCents / 100).toFixed(0)} net on $${(totalRevenueCents / 100).toFixed(0)} revenue). Highest margin: ${topMarginCoach?.coachName} at ${topMarginCoach?.marginPercent}%. Lowest: ${lowestMarginCoach?.coachName} at ${lowestMarginCoach?.marginPercent}%.`;
  }

  return {
    period: periodLabel,
    coaches,
    topMarginCoach,
    lowestMarginCoach,
    totalRevenueCents,
    totalPayoutCents,
    totalNetCents,
    orgMarginPercent,
    insight,
  };
}

// ============================================================
// PHASE 9D — DAILY REVENUE PRESSURE
// ============================================================

export interface DailyRevenuePressure {
  hasTargets: boolean;
  targetCents: number;
  currentCents: number;
  projectedCents: number;
  gapCents: number;
  progressPct: number;
  urgencyLevel: "none" | "low" | "medium" | "high" | "critical";
  daysRemaining: number;
  daysElapsed: number;
  requiredDailyRevenueCents: number;
  currentDailyPaceCents: number;
  topRecoveryActions: { action: string; estimatedImpactCents: number; priority: number }[];
  insight: string;
}

export async function computeDailyRevenuePressure(orgId: string): Promise<DailyRevenuePressure> {
  const { getWeeklyTargets, getWeeklyProgress } = await import("./goal-tracking");

  const [targets, progress] = await Promise.all([
    getWeeklyTargets(orgId),
    getWeeklyProgress(orgId),
  ]);

  if (!targets || !targets.revenueCents) {
    return {
      hasTargets: false,
      targetCents: 0,
      currentCents: 0,
      projectedCents: 0,
      gapCents: 0,
      progressPct: 0,
      urgencyLevel: "none",
      daysRemaining: progress.daysRemaining,
      daysElapsed: progress.daysElapsed,
      requiredDailyRevenueCents: 0,
      currentDailyPaceCents: 0,
      topRecoveryActions: [],
      insight: "No weekly revenue target set. Ask the agent to set a target — e.g. 'Set a $5,000 revenue goal this week'.",
    };
  }

  const revenueGoal = progress.progress.find(p => p.dimension === "revenue");
  const currentCents = revenueGoal?.current ?? 0;
  const projectedCents = revenueGoal?.projected ?? 0;
  const targetCents = targets.revenueCents;
  const gapCents = Math.max(0, targetCents - projectedCents);
  const progressPct = Math.round((currentCents / targetCents) * 100);
  const daysElapsed = progress.daysElapsed;
  const daysRemaining = progress.daysRemaining;

  const currentDailyPaceCents = daysElapsed > 0 ? Math.round(currentCents / daysElapsed) : 0;
  const requiredDailyRevenueCents = daysRemaining > 0 ? Math.round(gapCents / daysRemaining) : gapCents;

  let urgencyLevel: DailyRevenuePressure["urgencyLevel"] = "low";
  if (gapCents <= 0) {
    urgencyLevel = "none";
  } else if (progressPct >= 80) {
    urgencyLevel = "low";
  } else if (progressPct >= 60) {
    urgencyLevel = "medium";
  } else if (progressPct >= 40) {
    urgencyLevel = "high";
  } else {
    urgencyLevel = "critical";
  }

  const topRecoveryActions: DailyRevenuePressure["topRecoveryActions"] = [
    { action: "Fill open calendar slots with paid sessions", estimatedImpactCents: Math.round(requiredDailyRevenueCents * 0.6), priority: 1 },
    { action: "Upsell existing clients to additional sessions", estimatedImpactCents: Math.round(requiredDailyRevenueCents * 0.25), priority: 2 },
    { action: "Reach out to inactive clients for reactivation", estimatedImpactCents: Math.round(requiredDailyRevenueCents * 0.15), priority: 3 },
  ];

  let insight = "";
  if (urgencyLevel === "none") {
    insight = `On track! Projected to hit $${(projectedCents / 100).toFixed(0)} vs $${(targetCents / 100).toFixed(0)} target.`;
  } else {
    const gapLabel = `$${(gapCents / 100).toFixed(0)}`;
    const dailyLabel = `$${(requiredDailyRevenueCents / 100).toFixed(0)}`;
    insight = `You are behind target by ${gapLabel}. Need ${dailyLabel}/day over the next ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} to recover.`;
  }

  return {
    hasTargets: true,
    targetCents,
    currentCents,
    projectedCents,
    gapCents,
    progressPct,
    urgencyLevel,
    daysRemaining,
    daysElapsed,
    requiredDailyRevenueCents,
    currentDailyPaceCents,
    topRecoveryActions,
    insight,
  };
}

// ============================================================
// PHASE 9E — LOST REVENUE OPPORTUNITIES
// ============================================================

export interface LostRevenueOpportunities {
  openSlotsValueCents: number;
  inactiveClientValueCents: number;
  unconvertedIntrosValueCents: number;
  totalRecoverableCents: number;
  openSlotsCount: number;
  inactiveClientCount: number;
  unconvertedIntrosCount: number;
  avgSessionValueCents: number;
  topOpportunities: { type: string; valueCents: number; description: string; priority: "high" | "medium" }[];
  insight: string;
}

export async function computeLostRevenueOpportunities(orgId: string): Promise<LostRevenueOpportunities> {
  const now = new Date();
  const thirtyDaysAgo = subDays(now, 30);
  const sixtyDaysAgo = subDays(now, 60);
  const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const thisWeekEnd = endOfWeek(now, { weekStartsOn: 1 });

  const [allBookings, { computeOrgDigest }] = await Promise.all([
    getOrgBookingsWithService(orgId, sixtyDaysAgo),
    import("./scheduling-intelligence"),
  ]);

  // Average session value from revenue-generating bookings in last 30 days
  const recentRevBookings = allBookings.filter(
    b => b.countsTowardRevenue !== false && (b.priceCents ?? 0) > 0 && new Date(b.startAt) >= thirtyDaysAgo
  );
  const avgSessionValueCents = recentRevBookings.length > 0
    ? Math.round(recentRevBookings.reduce((s, b) => s + (b.priceCents ?? 0), 0) / recentRevBookings.length)
    : 7000; // fallback $70

  // Open slots value — from ops digest
  let openSlotsCount = 0;
  let openSlotsValueCents = 0;
  try {
    const digest = await computeOrgDigest(orgId);
    openSlotsCount = digest.openSlotsThisWeek;
    openSlotsValueCents = Math.round(openSlotsCount * avgSessionValueCents);
  } catch { /* use zeros */ }

  // Inactive clients (no booking in 30 days) value
  const clientIds = new Set(allBookings.map(b => b.clientId).filter(Boolean));
  const recentClientIds = new Set(
    allBookings.filter(b => new Date(b.startAt) >= thirtyDaysAgo && b.clientId).map(b => b.clientId)
  );
  const inactiveClientIds = [...clientIds].filter(id => !recentClientIds.has(id));
  const inactiveClientCount = inactiveClientIds.length;
  const avgConversionRate = 0.35; // industry average for inactive re-engagement
  const inactiveClientValueCents = Math.round(inactiveClientCount * avgSessionValueCents * avgConversionRate);

  // Unconverted intros — intro sessions where client never had a paid session after
  const introBookings = allBookings.filter(
    b => (b.serviceCategory ?? "paid") === "intro" && new Date(b.startAt) >= sixtyDaysAgo
  );
  const paidClientIds = new Set(
    allBookings.filter(b => b.countsTowardRevenue !== false && (b.priceCents ?? 0) > 0).map(b => b.clientId)
  );
  const unconvertedIntros = introBookings.filter(b => !paidClientIds.has(b.clientId));
  const unconvertedIntrosCount = unconvertedIntros.length;
  const introConversionRate = 0.4; // estimated
  const unconvertedIntrosValueCents = Math.round(unconvertedIntrosCount * avgSessionValueCents * introConversionRate);

  const totalRecoverableCents = openSlotsValueCents + inactiveClientValueCents + unconvertedIntrosValueCents;

  const topOpportunities: LostRevenueOpportunities["topOpportunities"] = [];
  if (openSlotsCount > 0) {
    topOpportunities.push({
      type: "open_slots",
      valueCents: openSlotsValueCents,
      description: `${openSlotsCount} open slot${openSlotsCount !== 1 ? "s" : ""} this week (~$${(openSlotsValueCents / 100).toFixed(0)} if filled)`,
      priority: "high",
    });
  }
  if (unconvertedIntrosCount > 0) {
    topOpportunities.push({
      type: "unconverted_intros",
      valueCents: unconvertedIntrosValueCents,
      description: `${unconvertedIntrosCount} intro session${unconvertedIntrosCount !== 1 ? "s" : ""} never converted to paid (~$${(unconvertedIntrosValueCents / 100).toFixed(0)} potential)`,
      priority: "high",
    });
  }
  if (inactiveClientCount > 0) {
    topOpportunities.push({
      type: "inactive_clients",
      valueCents: inactiveClientValueCents,
      description: `${inactiveClientCount} inactive client${inactiveClientCount !== 1 ? "s" : ""} (~$${(inactiveClientValueCents / 100).toFixed(0)} re-engagement potential)`,
      priority: "medium",
    });
  }

  const totalLabel = `$${(totalRecoverableCents / 100).toFixed(0)}`;
  let insight = "";
  if (totalRecoverableCents === 0) {
    insight = "No significant revenue recovery opportunities detected right now.";
  } else {
    const parts: string[] = [];
    if (openSlotsCount > 0) parts.push(`${openSlotsCount} open slot${openSlotsCount !== 1 ? "s" : ""}`);
    if (unconvertedIntrosCount > 0) parts.push(`${unconvertedIntrosCount} unconverted intro${unconvertedIntrosCount !== 1 ? "s" : ""}`);
    if (inactiveClientCount > 0) parts.push(`${inactiveClientCount} inactive client${inactiveClientCount !== 1 ? "s" : ""}`);
    insight = `You have ${totalLabel} in recoverable revenue sitting in ${parts.join(", ")}.`;
  }

  return {
    openSlotsValueCents,
    inactiveClientValueCents,
    unconvertedIntrosValueCents,
    totalRecoverableCents,
    openSlotsCount,
    inactiveClientCount,
    unconvertedIntrosCount,
    avgSessionValueCents,
    topOpportunities,
    insight,
  };
}
