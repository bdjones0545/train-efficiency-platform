import { db } from "./db";
import { storage } from "./storage";
import { agentActions, bookings, services, users, userSubscriptions, organizationSubscriptionPlans } from "@shared/schema";
import { eq, and, gte, lte, desc, sql, ne } from "drizzle-orm";
import { subDays, subMonths, format, differenceInDays, differenceInMonths } from "date-fns";
import { getWeeklyProgress } from "./goal-tracking";

// ============================================================
// PHASE 1 — CLIENT RESPONSE PROFILE
// ============================================================

export interface ClientResponseProfile {
  clientId: string;
  clientName: string;
  preferredHour: number | null;
  preferredHourLabel: string | null;
  preferredMessageType: string | null;
  avgTouchesBeforeConversion: number | null;
  responseRate: number;
  responseRateLabel: string;
  conversionRate: number;
  conversionRateLabel: string;
  trend30d: "improving" | "declining" | "stable" | "insufficient_data";
  trendDetail: string;
  clientConversionModifier: number;
  totalOutreach: number;
  hasEnoughData: boolean;
  reasoning: string;
}

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export async function computeClientResponseProfile(
  clientId: string,
  orgId: string
): Promise<ClientResponseProfile> {
  const since90 = subDays(new Date(), 90);
  const since30 = subDays(new Date(), 30);
  const midpoint = subDays(new Date(), 15);

  const actions = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.organizationId, orgId),
        eq(agentActions.clientId, clientId),
        gte(agentActions.createdAt, since90),
        eq(agentActions.actionType, "outreach")
      )
    )
    .orderBy(desc(agentActions.createdAt));

  const clientName = actions[0]?.clientName ?? "Unknown";

  const sent = actions.filter(a =>
    ["sent", "responded", "booked", "ignored"].includes(a.status ?? "")
  );
  const responded = actions.filter(a => a.status === "responded" || a.status === "booked");
  const booked = actions.filter(a => a.status === "booked");

  const totalOutreach = sent.length;
  const responseRate = totalOutreach > 0 ? responded.length / totalOutreach : 0;
  const conversionRate = totalOutreach > 0 ? booked.length / totalOutreach : 0;

  // Preferred hour of day (highest response/booking rate)
  const hourMap: Record<number, { sent: number; booked: number }> = {};
  for (const a of sent) {
    if (!a.createdAt) continue;
    const hour = new Date(a.createdAt).getHours();
    if (!hourMap[hour]) hourMap[hour] = { sent: 0, booked: 0 };
    hourMap[hour].sent++;
    if (a.status === "booked") hourMap[hour].booked++;
  }

  let preferredHour: number | null = null;
  let bestHourRate = 0;
  for (const [h, data] of Object.entries(hourMap)) {
    if (data.sent >= 2) {
      const rate = data.booked / data.sent;
      if (rate > bestHourRate) {
        bestHourRate = rate;
        preferredHour = parseInt(h);
      }
    }
  }

  // Preferred message type
  const typeMap: Record<string, { sent: number; booked: number }> = {};
  for (const a of sent) {
    const key = a.actionSubType ?? a.variationType ?? "general";
    if (!typeMap[key]) typeMap[key] = { sent: 0, booked: 0 };
    typeMap[key].sent++;
    if (a.status === "booked") typeMap[key].booked++;
  }

  let preferredMessageType: string | null = null;
  let bestTypeRate = 0;
  for (const [type, data] of Object.entries(typeMap)) {
    if (data.sent >= 2) {
      const rate = data.booked / data.sent;
      if (rate > bestTypeRate) {
        bestTypeRate = rate;
        preferredMessageType = type;
      }
    }
  }

  // Average touches before conversion
  let avgTouchesBeforeConversion: number | null = null;
  if (booked.length > 0) {
    const clientCampaignGroups: Record<string, number> = {};
    for (const a of sent) {
      const gKey = a.campaignId ?? `solo_${a.id}`;
      if (!clientCampaignGroups[gKey]) clientCampaignGroups[gKey] = 0;
      clientCampaignGroups[gKey]++;
    }
    const conversionGroups = booked
      .map(b => b.campaignId ?? `solo_${b.id}`)
      .filter(k => clientCampaignGroups[k])
      .map(k => clientCampaignGroups[k]);
    if (conversionGroups.length > 0) {
      avgTouchesBeforeConversion = Math.round(
        conversionGroups.reduce((a, b) => a + b, 0) / conversionGroups.length
      );
    }
  }

  // 30-day trend
  const recent30 = sent.filter(a => a.createdAt && new Date(a.createdAt) >= since30);
  const recent30Booked = recent30.filter(a => a.status === "booked").length;
  const prior30 = sent.filter(a => a.createdAt && new Date(a.createdAt) < since30);
  const prior30Booked = prior30.filter(a => a.status === "booked").length;

  let trend30d: ClientResponseProfile["trend30d"] = "insufficient_data";
  let trendDetail = "Not enough data for trend analysis";

  if (recent30.length >= 2 && prior30.length >= 2) {
    const recentRate = recent30Booked / recent30.length;
    const priorRate = prior30Booked / prior30.length;
    const delta = recentRate - priorRate;
    if (delta > 0.05) {
      trend30d = "improving";
      trendDetail = `Conversion improved +${Math.round(delta * 100)}pp in last 30 days`;
    } else if (delta < -0.05) {
      trend30d = "declining";
      trendDetail = `Conversion dropped ${Math.abs(Math.round(delta * 100))}pp in last 30 days`;
    } else {
      trend30d = "stable";
      trendDetail = "Consistent conversion in last 30 days";
    }
  }

  // Client conversion modifier (relative to baseline assumption of 20%)
  const globalBaselineRate = 0.2;
  const clientConversionModifier = totalOutreach >= 3
    ? Math.max(0.1, conversionRate / globalBaselineRate)
    : 1.0;

  const hasEnoughData = totalOutreach >= 3;

  let reasoning = "";
  if (!hasEnoughData) {
    reasoning = `Only ${totalOutreach} outreach message${totalOutreach !== 1 ? "s" : ""} tracked for this client — need at least 3 for reliable personalization. Using global defaults.`;
  } else {
    const parts: string[] = [];
    if (preferredHour !== null) parts.push(`responds best around ${formatHour(preferredHour)}`);
    if (preferredMessageType) parts.push(`best message type: "${preferredMessageType}"`);
    parts.push(`${Math.round(conversionRate * 100)}% conversion rate`);
    parts.push(`modifier: ${clientConversionModifier.toFixed(2)}× vs average`);
    reasoning = `${clientName}: ${parts.join(", ")}.`;
  }

  return {
    clientId,
    clientName,
    preferredHour,
    preferredHourLabel: preferredHour !== null ? formatHour(preferredHour) : null,
    preferredMessageType,
    avgTouchesBeforeConversion,
    responseRate,
    responseRateLabel: totalOutreach > 0 ? `${Math.round(responseRate * 100)}%` : "N/A",
    conversionRate,
    conversionRateLabel: totalOutreach > 0 ? `${Math.round(conversionRate * 100)}%` : "N/A",
    trend30d,
    trendDetail,
    clientConversionModifier,
    totalOutreach,
    hasEnoughData,
    reasoning,
  };
}

// ============================================================
// PHASE 2 — CLIENT SEGMENTATION
// ============================================================

export type ClientSegmentType =
  | "high_value_low_frequency"
  | "high_churn_risk_high_recovery"
  | "frequent_responders"
  | "low_responders"
  | "high_lifetime_value"
  | "inactive_historically_consistent";

export interface ClientSegmentMember {
  clientId: string;
  clientName: string;
  totalSpendCents: number;
  sessionCount: number;
  conversionRate: number;
  daysSinceLastSession: number | null;
}

export interface ClientSegment {
  segmentType: ClientSegmentType;
  label: string;
  description: string;
  size: number;
  avgRevenueCents: number;
  avgRevenueLabel: string;
  avgConversionRate: number;
  avgConversionRateLabel: string;
  recommendedStrategy: string;
  members: ClientSegmentMember[];
}

export interface ClientSegmentationResult {
  segments: ClientSegment[];
  totalClientsAnalyzed: number;
  generatedAt: string;
  summary: string;
  topFocusSegment: string;
  topFocusReason: string;
}

export async function computeClientSegments(orgId: string): Promise<ClientSegmentationResult> {
  const since180 = subDays(new Date(), 180);
  const since30 = subDays(new Date(), 30);
  const since90 = subDays(new Date(), 90);

  // Fetch all bookings in last 180 days
  const allBookings = await db
    .select({
      clientId: bookings.clientId,
      startAt: bookings.startAt,
      serviceId: bookings.serviceId,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        ne(bookings.status, "CANCELLED")
      )
    )
    .orderBy(desc(bookings.startAt));

  // Fetch all services for pricing
  const allServices = await db.select().from(services).where(eq(services.organizationId, orgId));
  const servicePriceMap: Record<string, number> = {};
  for (const s of allServices) servicePriceMap[s.id] = s.priceCents;

  // Fetch all outreach actions
  const allActions = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.organizationId, orgId),
        gte(agentActions.createdAt, since180),
        eq(agentActions.actionType, "outreach")
      )
    );

  // Build per-client maps
  const clientBookingMap: Record<string, { sessions: Date[]; spendCents: number }> = {};
  for (const b of allBookings) {
    if (!clientBookingMap[b.clientId]) clientBookingMap[b.clientId] = { sessions: [], spendCents: 0 };
    clientBookingMap[b.clientId].sessions.push(new Date(b.startAt));
    clientBookingMap[b.clientId].spendCents += servicePriceMap[b.serviceId] ?? 0;
  }

  const clientActionMap: Record<string, { sent: number; booked: number; name: string }> = {};
  for (const a of allActions) {
    if (!a.clientId) continue;
    if (!clientActionMap[a.clientId]) clientActionMap[a.clientId] = { sent: 0, booked: 0, name: a.clientName ?? "Unknown" };
    if (["sent", "responded", "booked", "ignored"].includes(a.status ?? "")) clientActionMap[a.clientId].sent++;
    if (a.status === "booked") clientActionMap[a.clientId].booked++;
  }

  const now = new Date();
  const allClientIds = new Set([
    ...Object.keys(clientBookingMap),
    ...Object.keys(clientActionMap),
  ]);

  // Build client profiles for segmentation
  interface ClientProfile {
    clientId: string;
    clientName: string;
    totalSpendCents: number;
    sessionCount: number;
    recentSessionCount: number; // last 30 days
    daysSinceLastSession: number | null;
    conversionRate: number;
    outreachCount: number;
    avgSessionsPerMonth: number;
  }

  const clientProfiles: ClientProfile[] = [];
  for (const clientId of allClientIds) {
    const bData = clientBookingMap[clientId];
    const aData = clientActionMap[clientId];

    const sessions = bData?.sessions ?? [];
    const sortedSessions = sessions.sort((a, b) => b.getTime() - a.getTime());
    const lastSession = sortedSessions[0] ?? null;
    const daysSinceLastSession = lastSession ? differenceInDays(now, lastSession) : null;

    const recentSessionCount = sessions.filter(s => s >= since30).length;
    const totalSessions = sessions.length;
    const totalSpendCents = bData?.spendCents ?? 0;

    // Months active = from first to last session
    const firstSession = sortedSessions[sortedSessions.length - 1] ?? null;
    const monthsActive = firstSession ? Math.max(1, differenceInMonths(now, firstSession)) : 1;
    const avgSessionsPerMonth = totalSessions / monthsActive;

    const sent = aData?.sent ?? 0;
    const booked = aData?.booked ?? 0;
    const conversionRate = sent > 0 ? booked / sent : 0;
    const clientName = aData?.name ?? `Client ${clientId.slice(0, 6)}`;

    clientProfiles.push({
      clientId,
      clientName,
      totalSpendCents,
      sessionCount: totalSessions,
      recentSessionCount,
      daysSinceLastSession,
      conversionRate,
      outreachCount: sent,
      avgSessionsPerMonth,
    });
  }

  const totalClientsAnalyzed = clientProfiles.length;

  // Compute percentiles for thresholds
  const spends = clientProfiles.map(c => c.totalSpendCents).sort((a, b) => a - b);
  const highSpendThreshold = spends[Math.floor(spends.length * 0.75)] ?? 0;

  // Segment definitions
  const segments: ClientSegment[] = [];

  // 1. High Value, Low Frequency
  const hvlf = clientProfiles.filter(c =>
    c.totalSpendCents >= highSpendThreshold &&
    c.avgSessionsPerMonth < 2 &&
    c.sessionCount > 0
  );
  if (hvlf.length > 0) {
    segments.push(makeSegment(
      "high_value_low_frequency",
      "High Value, Low Frequency",
      "High-spending clients who book infrequently — strong upsell potential",
      hvlf,
      "Offer premium packages or semi-private upgrades. Check in monthly. These clients can significantly increase spend with the right offer."
    ));
  }

  // 2. High Churn Risk, High Recovery Probability (responded to outreach in past)
  const hchr = clientProfiles.filter(c =>
    (c.daysSinceLastSession ?? 999) > 30 &&
    (c.daysSinceLastSession ?? 999) < 90 &&
    c.conversionRate > 0.2 &&
    c.sessionCount >= 3
  );
  if (hchr.length > 0) {
    segments.push(makeSegment(
      "high_churn_risk_high_recovery",
      "High Churn Risk, High Recovery Probability",
      "Clients who have gone quiet but respond well to outreach and have history",
      hchr,
      "Run churn recovery campaign now. They've responded before — a timely, personal message has high ROI. Do NOT use generic outreach."
    ));
  }

  // 3. Frequent Responders
  const fr = clientProfiles.filter(c =>
    c.outreachCount >= 2 &&
    c.conversionRate > 0.35
  );
  if (fr.length > 0) {
    segments.push(makeSegment(
      "frequent_responders",
      "Frequent Responders",
      "Clients who consistently respond to outreach and convert",
      fr,
      "Prioritize these clients for all outreach. High confidence that messages will convert. Start upsell or backfill conversations here first."
    ));
  }

  // 4. Low Responders
  const lr = clientProfiles.filter(c =>
    c.outreachCount >= 3 &&
    c.conversionRate < 0.1
  );
  if (lr.length > 0) {
    segments.push(makeSegment(
      "low_responders",
      "Low Responders",
      "Clients who receive many messages but rarely convert",
      lr,
      "Reduce message frequency. Try a completely different approach — change the offer, tone, or timing. Consider pausing outreach after 3 no-responses."
    ));
  }

  // 5. High Lifetime Value (still active)
  const hlv = clientProfiles.filter(c =>
    c.totalSpendCents >= highSpendThreshold &&
    (c.daysSinceLastSession ?? 999) < 30
  );
  if (hlv.length > 0) {
    segments.push(makeSegment(
      "high_lifetime_value",
      "High Lifetime Value (Active)",
      "Your most valuable active clients — protect retention at all costs",
      hlv,
      "Prioritize retention: proactive check-ins, early renewal offers, VIP treatment. Never let these go quiet. Small retention investments here = large revenue protection."
    ));
  }

  // 6. Inactive But Historically Consistent
  const ihc = clientProfiles.filter(c =>
    (c.daysSinceLastSession ?? 999) > 45 &&
    c.sessionCount >= 5 &&
    c.avgSessionsPerMonth >= 1.5
  );
  if (ihc.length > 0) {
    segments.push(makeSegment(
      "inactive_historically_consistent",
      "Inactive but Historically Consistent",
      "Went quiet recently but were regular clients — high-value re-engagement targets",
      ihc,
      "Start re-engagement campaign with personal, low-pressure message. Reference their history: 'You used to come every week — everything okay?' High recovery probability."
    ));
  }

  // Top focus segment
  let topFocusSegment = segments[0]?.label ?? "None";
  let topFocusReason = "No segments identified yet.";

  const highRecovery = segments.find(s => s.segmentType === "high_churn_risk_high_recovery");
  const highLtv = segments.find(s => s.segmentType === "high_lifetime_value");

  if (highLtv && highLtv.size > 0) {
    topFocusSegment = highLtv.label;
    topFocusReason = `${highLtv.size} high-LTV active clients generating avg $${(highLtv.avgRevenueCents / 100).toFixed(0)} each — protect retention first.`;
  } else if (highRecovery && highRecovery.size > 0) {
    topFocusSegment = highRecovery.label;
    topFocusReason = `${highRecovery.size} clients at churn risk with high recovery probability — act now before they're lost.`;
  }

  const segmentSummary = segments.length === 0
    ? "Not enough data to segment clients yet. Track more outreach outcomes to unlock segmentation."
    : `${totalClientsAnalyzed} clients segmented into ${segments.length} group${segments.length !== 1 ? "s" : ""}. Focus: ${topFocusSegment}.`;

  return {
    segments,
    totalClientsAnalyzed,
    generatedAt: format(now, "EEEE, MMMM d 'at' h:mm a"),
    summary: segmentSummary,
    topFocusSegment,
    topFocusReason,
  };
}

function makeSegment(
  segmentType: ClientSegmentType,
  label: string,
  description: string,
  members: { clientId: string; clientName: string; totalSpendCents: number; sessionCount: number; conversionRate: number; daysSinceLastSession: number | null }[],
  recommendedStrategy: string
): ClientSegment {
  const totalRevenue = members.reduce((s, m) => s + m.totalSpendCents, 0);
  const avgRevenueCents = members.length > 0 ? Math.round(totalRevenue / members.length) : 0;
  const avgConversionRate = members.length > 0
    ? members.reduce((s, m) => s + m.conversionRate, 0) / members.length
    : 0;

  return {
    segmentType,
    label,
    description,
    size: members.length,
    avgRevenueCents,
    avgRevenueLabel: `$${(avgRevenueCents / 100).toFixed(0)}`,
    avgConversionRate,
    avgConversionRateLabel: `${Math.round(avgConversionRate * 100)}%`,
    recommendedStrategy,
    members: members.map(m => ({
      clientId: m.clientId,
      clientName: m.clientName,
      totalSpendCents: m.totalSpendCents,
      sessionCount: m.sessionCount,
      conversionRate: m.conversionRate,
      daysSinceLastSession: m.daysSinceLastSession,
    })),
  };
}

// ============================================================
// PHASE 4 — CLIENT LIFETIME VALUE SCORE
// ============================================================

export interface ClientLtvScore {
  clientId: string;
  clientName: string;
  totalSpendCents: number;
  totalSpendLabel: string;
  sessionCount: number;
  retentionDays: number | null;
  avgMonthlySpendCents: number;
  avgMonthlySpendLabel: string;
  projectedAnnualValueCents: number;
  projectedAnnualValueLabel: string;
  ltvScore: number;
  ltvTier: "platinum" | "gold" | "silver" | "at_risk" | "new";
  ltvTierLabel: string;
  churnRisk: "high" | "medium" | "low";
  daysSinceLastSession: number | null;
  reasoning: string;
}

export async function computeClientLtvScore(
  clientId: string,
  orgId: string
): Promise<ClientLtvScore> {
  const now = new Date();

  // All bookings for this client
  const clientBookings = await db
    .select({
      startAt: bookings.startAt,
      serviceId: bookings.serviceId,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        eq(bookings.clientId, clientId),
        ne(bookings.status, "CANCELLED")
      )
    )
    .orderBy(desc(bookings.startAt));

  // Service prices
  const allServices = await db.select().from(services).where(eq(services.organizationId, orgId));
  const servicePriceMap: Record<string, number> = {};
  for (const s of allServices) servicePriceMap[s.id] = s.priceCents;

  // Get client name from actions
  const latestAction = await db
    .select({ clientName: agentActions.clientName })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.organizationId, orgId),
        eq(agentActions.clientId, clientId)
      )
    )
    .limit(1);

  const clientName = latestAction[0]?.clientName ?? `Client ${clientId.slice(0, 6)}`;

  const totalSpendCents = clientBookings.reduce((s, b) => s + (servicePriceMap[b.serviceId] ?? 0), 0);
  const sessionCount = clientBookings.length;

  const sortedSessions = clientBookings.map(b => new Date(b.startAt)).sort((a, b) => a.getTime() - b.getTime());
  const firstSession = sortedSessions[0] ?? null;
  const lastSession = sortedSessions[sortedSessions.length - 1] ?? null;

  const retentionDays = firstSession ? differenceInDays(now, firstSession) : null;
  const daysSinceLastSession = lastSession ? differenceInDays(now, lastSession) : null;
  const monthsActive = firstSession ? Math.max(1, differenceInMonths(now, firstSession)) : 1;

  const avgMonthlySpendCents = Math.round(totalSpendCents / monthsActive);

  // Projected annual = avg monthly × 12, adjusted for churn signals
  let churnRisk: ClientLtvScore["churnRisk"] = "low";
  if (daysSinceLastSession !== null) {
    if (daysSinceLastSession > 60) churnRisk = "high";
    else if (daysSinceLastSession > 30) churnRisk = "medium";
  }

  const churnAdjustment = churnRisk === "high" ? 0.3 : churnRisk === "medium" ? 0.7 : 1.0;
  const projectedAnnualValueCents = Math.round(avgMonthlySpendCents * 12 * churnAdjustment);

  // LTV score (0–100)
  const spendScore = Math.min(40, (totalSpendCents / 100) / 50); // $5000 = 40pts
  const frequencyScore = Math.min(30, (sessionCount / 50) * 30); // 50 sessions = 30pts
  const retentionScore = Math.min(30, ((retentionDays ?? 0) / 365) * 30); // 1 year = 30pts
  const ltvScore = Math.round((spendScore + frequencyScore + retentionScore) * (churnRisk === "high" ? 0.5 : churnRisk === "medium" ? 0.75 : 1.0));

  let ltvTier: ClientLtvScore["ltvTier"];
  let ltvTierLabel: string;
  if (ltvScore >= 70) { ltvTier = "platinum"; ltvTierLabel = "Platinum (Top Client)"; }
  else if (ltvScore >= 45) { ltvTier = "gold"; ltvTierLabel = "Gold (High Value)"; }
  else if (ltvScore >= 20) { ltvTier = "silver"; ltvTierLabel = "Silver (Mid Value)"; }
  else if (sessionCount === 0) { ltvTier = "new"; ltvTierLabel = "New (No sessions yet)"; }
  else { ltvTier = "at_risk"; ltvTierLabel = "At Risk (Low Engagement)"; }

  const reasoning = sessionCount === 0
    ? `${clientName} has no completed sessions yet — LTV is projected from subscription or waitlist data.`
    : `${clientName}: $${(totalSpendCents / 100).toFixed(0)} total spend across ${sessionCount} sessions over ${retentionDays ?? 0} days. Avg $${(avgMonthlySpendCents / 100).toFixed(0)}/mo. Churn risk: ${churnRisk}. Projected annual value: $${(projectedAnnualValueCents / 100).toFixed(0)}.`;

  return {
    clientId,
    clientName,
    totalSpendCents,
    totalSpendLabel: `$${(totalSpendCents / 100).toFixed(0)}`,
    sessionCount,
    retentionDays,
    avgMonthlySpendCents,
    avgMonthlySpendLabel: `$${(avgMonthlySpendCents / 100).toFixed(0)}/mo`,
    projectedAnnualValueCents,
    projectedAnnualValueLabel: `$${(projectedAnnualValueCents / 100).toFixed(0)}/yr`,
    ltvScore,
    ltvTier,
    ltvTierLabel,
    churnRisk,
    daysSinceLastSession,
    reasoning,
  };
}

// Batch LTV for all clients in the org
export async function computeAllClientLtvScores(orgId: string): Promise<ClientLtvScore[]> {
  const allBookings = await db
    .select({ clientId: bookings.clientId })
    .from(bookings)
    .where(eq(bookings.organizationId, orgId));

  const allActions = await db
    .select({ clientId: agentActions.clientId })
    .from(agentActions)
    .where(eq(agentActions.organizationId, orgId));

  const clientIds = new Set([
    ...allBookings.map(b => b.clientId),
    ...allActions.filter(a => a.clientId).map(a => a.clientId!),
  ]);

  const results = await Promise.all(
    [...clientIds].map(id => computeClientLtvScore(id, orgId))
  );

  return results.sort((a, b) => b.ltvScore - a.ltvScore);
}

// ============================================================
// PHASE 3 — CLIENT CONVERSION MODIFIER (utility)
// ============================================================

export async function getClientConversionModifier(clientId: string, orgId: string): Promise<number> {
  try {
    const profile = await computeClientResponseProfile(clientId, orgId);
    return profile.clientConversionModifier;
  } catch {
    return 1.0;
  }
}

// ============================================================
// PHASE 5 — STRATEGIC DECISION LAYER
// ============================================================

export interface StrategicRecommendations {
  generatedAt: string;
  weekFocus: "retention" | "growth" | "reactivation" | "balanced";
  weekFocusLabel: string;
  weekFocusReason: string;
  topPriorityThisWeek: string[];
  thingsToReduce: string[];
  whereLostRevenue: string[];
  biggestUpside: string[];
  segmentFocus: string;
  segmentFocusReason: string;
  clientsToContactToday: { clientId: string; clientName: string; reason: string; urgency: "critical" | "high" | "medium" }[];
  weeklyGoalStatus: {
    overallStatus: string;
    overallStatusLabel: string;
    hasTargets: boolean;
    summary: string;
    agentNote: string;
    topGap: { dimension: string; label: string; gapLabel: string; pctCompleteLabel: string; urgency: string } | null;
  } | null;
  summary: string;
}

export async function getStrategicRecommendations(orgId: string): Promise<StrategicRecommendations> {
  const now = new Date();
  const since30 = subDays(now, 30);

  const [segmentation, allLtv, weeklyProgress] = await Promise.all([
    computeClientSegments(orgId),
    computeAllClientLtvScores(orgId),
    getWeeklyProgress(orgId).catch(() => null),
  ]);

  // Pull recent outreach performance
  const recentActions = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.organizationId, orgId),
        gte(agentActions.createdAt, since30),
        eq(agentActions.actionType, "outreach")
      )
    );

  const totalSent = recentActions.filter(a => ["sent", "responded", "booked", "ignored"].includes(a.status ?? "")).length;
  const totalBooked = recentActions.filter(a => a.status === "booked").length;
  const totalIgnored = recentActions.filter(a => a.status === "ignored").length;
  const revenueFromOutreach = recentActions
    .filter(a => a.status === "booked")
    .reduce((s, a) => s + (a.outcomeValueCents ?? 0), 0);

  // Detect week focus
  const highChurnSeg = segmentation.segments.find(s => s.segmentType === "high_churn_risk_high_recovery");
  const highLtvSeg = segmentation.segments.find(s => s.segmentType === "high_lifetime_value");
  const inactiveSeg = segmentation.segments.find(s => s.segmentType === "inactive_historically_consistent");
  const hvlfSeg = segmentation.segments.find(s => s.segmentType === "high_value_low_frequency");

  let weekFocus: StrategicRecommendations["weekFocus"] = "balanced";
  let weekFocusLabel = "Balanced (Retention + Growth)";
  let weekFocusReason = "No dominant priority signal — balance retention and growth this week.";

  if (highChurnSeg && highChurnSeg.size >= 3) {
    weekFocus = "retention";
    weekFocusLabel = "Retention Focus";
    weekFocusReason = `${highChurnSeg.size} clients are at high churn risk with strong recovery probability — prioritize re-engagement before focusing on new growth.`;
  } else if (inactiveSeg && inactiveSeg.size >= 5) {
    weekFocus = "reactivation";
    weekFocusLabel = "Reactivation Focus";
    weekFocusReason = `${inactiveSeg.size} historically consistent clients have gone quiet — run reactivation campaigns this week for quick revenue recovery.`;
  } else if (hvlfSeg && hvlfSeg.size >= 2) {
    weekFocus = "growth";
    weekFocusLabel = "Growth / Upsell Focus";
    weekFocusReason = `${hvlfSeg.size} high-value clients are booking below capacity — upsell opportunity this week.`;
  }

  // Top priorities
  const topPriorityThisWeek: string[] = [];
  if (highLtvSeg && highLtvSeg.size > 0) {
    topPriorityThisWeek.push(`Protect ${highLtvSeg.size} high-LTV active client${highLtvSeg.size !== 1 ? "s" : ""} — proactive check-in this week`);
  }
  if (highChurnSeg && highChurnSeg.size > 0) {
    topPriorityThisWeek.push(`Re-engage ${highChurnSeg.size} at-risk client${highChurnSeg.size !== 1 ? "s" : ""} with high recovery probability`);
  }
  if (hvlfSeg && hvlfSeg.size > 0) {
    topPriorityThisWeek.push(`Upsell ${hvlfSeg.size} high-value, low-frequency client${hvlfSeg.size !== 1 ? "s" : ""} — avg $${(hvlfSeg.avgRevenueCents / 100).toFixed(0)} each`);
  }
  // Goal-based priorities (prepend if behind targets)
  if (weeklyProgress && weeklyProgress.hasTargets) {
    const behindGoals = weeklyProgress.progress.filter(p => p.status === "behind");
    for (const g of behindGoals.slice(0, 2)) {
      topPriorityThisWeek.unshift(`[GOAL ALERT] ${g.label}: ${g.pctCompleteLabel} of target — gap of ${g.gapLabel} with ${weeklyProgress.daysRemaining} day${weeklyProgress.daysRemaining !== 1 ? "s" : ""} left`);
    }
    if (weeklyProgress.overallStatus === "exceeded") {
      topPriorityThisWeek.push(`All weekly targets exceeded — consider raising targets for next week`);
    }
  }

  if (topPriorityThisWeek.length === 0) {
    topPriorityThisWeek.push("Continue tracking outreach outcomes to unlock strategic recommendations");
  }

  // Things to reduce
  const thingsToReduce: string[] = [];
  const lowResponderSeg = segmentation.segments.find(s => s.segmentType === "low_responders");
  if (lowResponderSeg && lowResponderSeg.size > 0) {
    thingsToReduce.push(`Reduce outreach frequency to ${lowResponderSeg.size} low-responder client${lowResponderSeg.size !== 1 ? "s" : ""} — high ignore rate is wasting effort`);
  }
  if (totalIgnored > totalBooked * 2 && totalSent > 5) {
    thingsToReduce.push("Current message strategy has high ignore rate — test different tone or timing before sending more of the same style");
  }
  if (thingsToReduce.length === 0) {
    thingsToReduce.push("No obvious waste signals this week — maintain current approach and track outcomes");
  }

  // Where revenue is lost
  const whereLostRevenue: string[] = [];
  const highRiskClients = allLtv.filter(c => c.churnRisk === "high" && c.ltvScore > 20);
  if (highRiskClients.length > 0) {
    const lostValue = highRiskClients.reduce((s, c) => s + c.projectedAnnualValueCents, 0);
    whereLostRevenue.push(`${highRiskClients.length} high-value client${highRiskClients.length !== 1 ? "s" : ""} at high churn risk — at-risk projected annual value: $${(lostValue / 100).toFixed(0)}`);
  }
  if (totalIgnored > 3) {
    whereLostRevenue.push(`${totalIgnored} outreach messages ignored in last 30 days — missed booking opportunities`);
  }
  if (whereLostRevenue.length === 0) {
    whereLostRevenue.push("No major revenue loss signals detected — focus on growth opportunities");
  }

  // Biggest upside
  const biggestUpside: string[] = [];
  if (hvlfSeg && hvlfSeg.size > 0) {
    const uplift = hvlfSeg.members.reduce((s, m) => s + m.totalSpendCents * 0.5, 0);
    biggestUpside.push(`Upselling ${hvlfSeg.size} high-value, low-frequency clients could add ~$${(uplift / 100).toFixed(0)} in annual revenue`);
  }
  const frequentResponderSeg = segmentation.segments.find(s => s.segmentType === "frequent_responders");
  if (frequentResponderSeg && frequentResponderSeg.size > 0) {
    biggestUpside.push(`${frequentResponderSeg.size} frequent responders are primed for upsell — they convert at ${frequentResponderSeg.avgConversionRateLabel} from outreach`);
  }
  if (revenueFromOutreach > 0) {
    biggestUpside.push(`Agent-driven outreach generated $${(revenueFromOutreach / 100).toFixed(0)} in last 30 days — increasing outreach volume could multiply this`);
  }
  if (biggestUpside.length === 0) {
    biggestUpside.push("Build more outreach history to unlock upside analysis");
  }

  // Clients to contact today (top 5 by urgency)
  const clientsToContactToday: StrategicRecommendations["clientsToContactToday"] = [];

  // High churn recovery clients
  if (highChurnSeg) {
    for (const m of highChurnSeg.members.slice(0, 2)) {
      clientsToContactToday.push({
        clientId: m.clientId,
        clientName: m.clientName,
        reason: `High churn risk — ${m.daysSinceLastSession ?? "?"} days since last session, historically converts from outreach`,
        urgency: "critical",
      });
    }
  }

  // High LTV active clients needing check-in
  if (highLtvSeg) {
    for (const m of highLtvSeg.members.slice(0, 2)) {
      clientsToContactToday.push({
        clientId: m.clientId,
        clientName: m.clientName,
        reason: `High-LTV active client ($${(m.totalSpendCents / 100).toFixed(0)} lifetime) — proactive retention check-in`,
        urgency: "high",
      });
    }
  }

  // Inactive historically consistent
  if (inactiveSeg) {
    for (const m of inactiveSeg.members.slice(0, 1)) {
      clientsToContactToday.push({
        clientId: m.clientId,
        clientName: m.clientName,
        reason: `Was a consistent client, now ${m.daysSinceLastSession ?? "?"} days inactive — re-engagement window`,
        urgency: "high",
      });
    }
  }

  const goalStatusNote = weeklyProgress && weeklyProgress.hasTargets
    ? ` Weekly goal status: ${weeklyProgress.overallStatusLabel}.`
    : " No weekly targets set.";
  const summary = `${weekFocusLabel} week. ${topPriorityThisWeek.length} top priorities identified. ${highRiskClients.length} high-LTV clients at churn risk. Biggest upside: ${biggestUpside[0] ?? "build more data"}.${goalStatusNote}`;

  return {
    generatedAt: format(now, "EEEE, MMMM d 'at' h:mm a"),
    weekFocus,
    weekFocusLabel,
    weekFocusReason,
    topPriorityThisWeek,
    thingsToReduce,
    whereLostRevenue,
    biggestUpside,
    segmentFocus: segmentation.topFocusSegment,
    segmentFocusReason: segmentation.topFocusReason,
    clientsToContactToday: clientsToContactToday.slice(0, 5),
    weeklyGoalStatus: weeklyProgress ? {
      overallStatus: weeklyProgress.overallStatus,
      overallStatusLabel: weeklyProgress.overallStatusLabel,
      hasTargets: weeklyProgress.hasTargets,
      summary: weeklyProgress.summary,
      agentNote: weeklyProgress.agentNote,
      topGap: weeklyProgress.topGap ? {
        dimension: weeklyProgress.topGap.dimension,
        label: weeklyProgress.topGap.label,
        gapLabel: weeklyProgress.topGap.gapLabel,
        pctCompleteLabel: weeklyProgress.topGap.pctCompleteLabel,
        urgency: weeklyProgress.topGap.urgency,
      } : null,
    } : null,
    summary,
  };
}
