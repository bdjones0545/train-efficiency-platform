import { db } from "./db";
import { storage } from "./storage";
import {
  bookings,
  services,
  users,
  coachProfiles,
  availabilityBlocks,
  userSubscriptions,
  organizationSubscriptionPlans,
  teamTrainingProspects,
  teamTrainingOutreachDrafts,
} from "@shared/schema";
import { eq, and, inArray, gte, lte, desc, ne } from "drizzle-orm";
import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  addDays,
  format,
  getDaysInMonth,
  addMinutes,
  getDay,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { computeChurnRisks, computeSessionPackageAlerts } from "./revenue-intelligence";
import { buildScoredDailyActionQueue } from "./action-tracking";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenSlot {
  date: string;
  startTime: string;
  endTimeStr: string;
  startISO: string;
  endISO: string;
  estimatedValueCents: number;
  suggestedClientName: string | null;
  suggestedClientId: string | null;
  label: string;
}

export interface ClientOpportunity {
  clientId: string;
  clientName: string;
  email: string | null;
  type: "should_book" | "renewal_due" | "churn_risk" | "missed_session";
  urgency: "high" | "medium" | "low";
  detail: string;
  estimatedValueCents: number;
  suggestedAction: string;
}

export interface TeamPipelineEntry {
  id: string;
  prospectName: string;
  sport: string;
  city: string;
  state: string;
  outreachStatus: string;
  confidenceScore: number;
  contactEmail: string | null;
  lastContactedAt: string | null;
}

export interface PendingDraft {
  draftId: string;
  prospectId: string;
  prospectName: string;
  subject: string;
  bodyPreview: string;
  createdAt: string;
}

export interface BestAction {
  headline: string;
  detail: string;
  actionType: string;
  estimatedValueCents: number;
  clientId: string | null;
  clientName: string | null;
  relatedSlot: Record<string, unknown> | null;
  rank: number;
}

export interface CommandCenterData {
  generatedAt: string;
  timezone: string;

  todayRevenueCents: number;
  openSlotValueTodayCents: number;
  projectedMonthRevenueCents: number;
  monthRevenueCents: number;
  monthGoalCents: number | null;
  revenueGapCents: number | null;
  sessionsNeededToClose: number | null;
  avgSessionValueCents: number;
  daysRemainingInMonth: number;
  daysElapsedInMonth: number;

  todaySchedule: { time: string; clientName: string; service: string; status: string }[];
  openSlotsToday: OpenSlot[];
  openSlotsTomorrow: OpenSlot[];

  bestAction: BestAction | null;

  clientOpportunities: ClientOpportunity[];

  teamPipeline: {
    totalProspects: number;
    highConfidenceLeads: number;
    draftsAwaitingApproval: number;
    repliesNeedingFollowUp: number;
    estimatedPipelineValueCents: number;
    activeLeads: TeamPipelineEntry[];
    pendingDrafts: PendingDraft[];
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrgCoachIds(orgId: string): Promise<string[]> {
  const coaches = await db
    .select({ id: coachProfiles.id })
    .from(coachProfiles)
    .where(eq(coachProfiles.organizationId, orgId));
  return coaches.map((c) => c.id);
}

async function getAvgSessionValueCents(coachIds: string[]): Promise<number> {
  if (coachIds.length === 0) return 10000;
  const activeServices = await db
    .select({ priceCents: services.priceCents })
    .from(services)
    .where(
      and(
        inArray(services.organizationId as any, coachIds.slice(0, 1)),
        eq(services.active, true),
        ne(services.priceCents, 0)
      )
    );

  if (activeServices.length === 0) return 10000;
  const avg = activeServices.reduce((s, sv) => s + sv.priceCents, 0) / activeServices.length;
  return Math.round(avg);
}

async function getOrgAvgSessionValue(orgId: string): Promise<number> {
  const orgServices = await db
    .select({ priceCents: services.priceCents })
    .from(services)
    .where(
      and(
        eq(services.organizationId as any, orgId),
        eq(services.active, true),
        ne(services.priceCents, 0)
      )
    );

  if (orgServices.length === 0) return 10000;
  const avg = orgServices.reduce((s, sv) => s + sv.priceCents, 0) / orgServices.length;
  return Math.round(avg);
}

function generateOpenSlots(
  availBlocks: { dayOfWeek: number; startTime: string; endTime: string }[],
  existingBookings: { startAt: Date; endAt: Date }[],
  targetDate: Date,
  durationMin: number,
  timezone: string,
  avgValueCents: number,
  suggestedClient: { name: string; id: string } | null
): OpenSlot[] {
  const zonedDate = toZonedTime(targetDate, timezone);
  const dayOfWeek = (zonedDate.getDay() + 6) % 7;
  const dayBlocks = availBlocks.filter((b) => b.dayOfWeek === dayOfWeek);
  const dateLabel = format(zonedDate, "MMM d (EEE)");
  const slots: OpenSlot[] = [];
  const now = new Date();

  for (const block of dayBlocks) {
    const [startH, startM] = block.startTime.split(":").map(Number);
    const [endH, endM] = block.endTime.split(":").map(Number);

    const localSlotStart = new Date(zonedDate);
    localSlotStart.setHours(startH, startM, 0, 0);
    let slotStart = fromZonedTime(localSlotStart, timezone);

    const localBlockEnd = new Date(zonedDate);
    localBlockEnd.setHours(endH, endM, 0, 0);
    const blockEnd = fromZonedTime(localBlockEnd, timezone);

    while (addMinutes(slotStart, durationMin) <= blockEnd) {
      const slotEnd = addMinutes(slotStart, durationMin);

      if (slotStart > now) {
        const hasOverlap = existingBookings.some((b) => {
          const bStart = new Date(b.startAt).getTime();
          const bEnd = new Date(b.endAt).getTime();
          return slotStart.getTime() < bEnd && slotEnd.getTime() > bStart;
        });

        if (!hasOverlap) {
          const zonedSlot = toZonedTime(slotStart, timezone);
          const zonedEnd = toZonedTime(slotEnd, timezone);
          slots.push({
            date: dateLabel,
            startTime: format(zonedSlot, "h:mm a"),
            endTimeStr: format(zonedEnd, "h:mm a"),
            startISO: slotStart.toISOString(),
            endISO: slotEnd.toISOString(),
            estimatedValueCents: avgValueCents,
            suggestedClientName: suggestedClient?.name ?? null,
            suggestedClientId: suggestedClient?.id ?? null,
            label: `${dateLabel} at ${format(zonedSlot, "h:mm a")}`,
          });
        }
      }
      slotStart = addMinutes(slotStart, 30);
    }
  }
  return slots;
}

// ─── Main compute function ─────────────────────────────────────────────────────

export async function computeCommandCenter(orgId: string): Promise<CommandCenterData> {
  const org = await storage.getOrganizationById(orgId);
  const timezone = org?.timezone || "America/New_York";

  const now = new Date();
  const zonedNow = toZonedTime(now, timezone);

  const todayStart = startOfDay(fromZonedTime(toZonedTime(now, timezone), timezone));
  const todayEnd = endOfDay(fromZonedTime(toZonedTime(now, timezone), timezone));
  const tomorrowStart = startOfDay(addDays(fromZonedTime(toZonedTime(now, timezone), timezone), 1));
  const tomorrowEnd = endOfDay(addDays(fromZonedTime(toZonedTime(now, timezone), timezone), 1));
  const monthStart = startOfMonth(zonedNow);
  const monthEnd = endOfMonth(zonedNow);
  const daysInMonth = getDaysInMonth(zonedNow);
  const dayOfMonth = zonedNow.getDate();
  const daysElapsed = dayOfMonth;
  const daysRemaining = daysInMonth - dayOfMonth;

  const coachIds = await getOrgCoachIds(orgId);
  const avgSessionValueCents = await getOrgAvgSessionValue(orgId);

  // ─── Today's bookings ─────────────────────────────────────────────────────
  let todayBookingsRaw: any[] = [];
  if (coachIds.length > 0) {
    todayBookingsRaw = await db
      .select({
        id: bookings.id,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        status: bookings.status,
        clientId: bookings.clientId,
        serviceId: bookings.serviceId,
        coachId: bookings.coachId,
        serviceName: services.name,
        servicePriceCents: services.priceCents,
        serviceCountsRevenue: services.countsTowardRevenue,
        clientFirstName: users.firstName,
        clientLastName: users.lastName,
      })
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(users, eq(bookings.clientId, users.id))
      .where(
        and(
          inArray(bookings.coachId, coachIds),
          gte(bookings.startAt, todayStart),
          lte(bookings.startAt, todayEnd),
          ne(bookings.status, "CANCELLED")
        )
      )
      .orderBy(bookings.startAt);
  }

  const todayRevenueCents = todayBookingsRaw
    .filter((b) => b.serviceCountsRevenue !== false)
    .reduce((sum, b) => sum + (b.servicePriceCents || 0), 0);

  const todaySchedule = todayBookingsRaw.map((b) => ({
    time: format(toZonedTime(new Date(b.startAt), timezone), "h:mm a"),
    clientName: `${b.clientFirstName || ""} ${b.clientLastName || ""}`.trim() || "Unknown",
    service: b.serviceName || "Session",
    status: b.status,
  }));

  // ─── Month revenue ──────────────────────────────────────────────────────────
  let monthBookingsRaw: any[] = [];
  if (coachIds.length > 0) {
    monthBookingsRaw = await db
      .select({
        servicePriceCents: services.priceCents,
        serviceCountsRevenue: services.countsTowardRevenue,
      })
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          inArray(bookings.coachId, coachIds),
          gte(bookings.startAt, fromZonedTime(monthStart, timezone)),
          lte(bookings.startAt, fromZonedTime(monthEnd, timezone)),
          ne(bookings.status, "CANCELLED")
        )
      );
  }
  const monthRevenueCents = monthBookingsRaw
    .filter((b) => b.serviceCountsRevenue !== false)
    .reduce((sum, b) => sum + (b.servicePriceCents || 0), 0);

  const dailyRunRate = daysElapsed > 0 ? monthRevenueCents / daysElapsed : 0;
  const projectedMonthRevenueCents = Math.round(dailyRunRate * daysInMonth);

  // ─── Monthly goal ──────────────────────────────────────────────────────────
  const goalRaw = await storage.getSetting(`monthly_revenue_goal_${orgId}`);
  const monthGoalCents = goalRaw ? parseInt(goalRaw, 10) : null;
  const revenueGapCents =
    monthGoalCents != null ? Math.max(0, monthGoalCents - projectedMonthRevenueCents) : null;
  const sessionsNeededToClose =
    revenueGapCents != null && avgSessionValueCents > 0
      ? Math.ceil(revenueGapCents / avgSessionValueCents)
      : null;

  // ─── Open slots ─────────────────────────────────────────────────────────────
  let allAvailBlocks: typeof availabilityBlocks.$inferSelect[] = [];
  let allActiveBookings: { startAt: Date; endAt: Date }[] = [];
  if (coachIds.length > 0) {
    allAvailBlocks = await db
      .select()
      .from(availabilityBlocks)
      .where(inArray(availabilityBlocks.coachId, coachIds));
    const rawBookings = await db
      .select({ startAt: bookings.startAt, endAt: bookings.endAt })
      .from(bookings)
      .where(and(inArray(bookings.coachId, coachIds), ne(bookings.status, "CANCELLED")));
    allActiveBookings = rawBookings.map((b) => ({
      startAt: new Date(b.startAt),
      endAt: new Date(b.endAt),
    }));
  }

  const durationMin = 60;
  const openSlotsToday = generateOpenSlots(
    allAvailBlocks,
    allActiveBookings,
    todayStart,
    durationMin,
    timezone,
    avgSessionValueCents,
    null
  );
  const openSlotsTomorrow = generateOpenSlots(
    allAvailBlocks,
    allActiveBookings,
    tomorrowStart,
    durationMin,
    timezone,
    avgSessionValueCents,
    null
  );
  const openSlotValueTodayCents = openSlotsToday.reduce(
    (s, slot) => s + slot.estimatedValueCents,
    0
  );

  // ─── Best action ───────────────────────────────────────────────────────────
  let bestAction: BestAction | null = null;
  try {
    const queue = await buildScoredDailyActionQueue(orgId);
    const top = queue.ranked?.[0];
    if (top) {
      const clientName = top.clientName || "a client";
      const estValue = top.expectedRevenueCents || avgSessionValueCents;
      const category = top.category || "outreach";

      let headline = top.suggestedAction || `Reach out to ${clientName}`;
      let detail = top.reason || `Contact ${clientName} to book a session — estimated $${(estValue / 100).toFixed(0)}.`;

      if (category === "backfill") {
        headline = top.suggestedAction || `Fill an open slot with ${clientName}`;
        detail = top.reason || `Estimated $${(estValue / 100).toFixed(0)} revenue opportunity.`;
      } else if (category === "churn_risk" || top.priority === "high") {
        headline = top.suggestedAction || `Re-engage ${clientName} — at risk`;
        detail = top.reason || `${clientName} may be at churn risk. Reaching out now could recover ~$${(estValue / 100).toFixed(0)}.`;
      } else if (category === "upsell" || category === "revenue") {
        headline = top.suggestedAction || `Upsell ${clientName}`;
        detail = top.reason || `Estimated $${(estValue / 100).toFixed(0)} additional revenue.`;
      }

      bestAction = {
        headline,
        detail,
        actionType: category,
        estimatedValueCents: estValue,
        clientId: top.clientId || null,
        clientName,
        relatedSlot: null,
        rank: top.rank,
      };
    }
  } catch {
    bestAction = null;
  }

  // If no queue action, suggest filling first open slot
  if (!bestAction && openSlotsToday.length > 0) {
    const slot = openSlotsToday[0];
    bestAction = {
      headline: `Fill the ${slot.startTime} opening today`,
      detail: `You have an open slot at ${slot.startTime} — estimated $${(slot.estimatedValueCents / 100).toFixed(0)} revenue.`,
      actionType: "backfill",
      estimatedValueCents: slot.estimatedValueCents,
      clientId: null,
      clientName: null,
      relatedSlot: { start: slot.startISO, end: slot.endISO },
      rank: 1,
    };
  }

  // ─── Client opportunities ─────────────────────────────────────────────────
  const clientOpportunities: ClientOpportunity[] = [];
  try {
    const churnRisks = await computeChurnRisks(orgId);
    for (const risk of churnRisks.slice(0, 5)) {
      clientOpportunities.push({
        clientId: risk.clientId,
        clientName: risk.clientName,
        email: risk.email,
        type: "churn_risk",
        urgency: risk.riskLevel === "high" ? "high" : "medium",
        detail: risk.signals.join(". "),
        estimatedValueCents: avgSessionValueCents,
        suggestedAction: risk.suggestedAction,
      });
    }
  } catch {}

  try {
    const packageAlerts = await computeSessionPackageAlerts(orgId);
    for (const alert of packageAlerts.slice(0, 4)) {
      clientOpportunities.push({
        clientId: alert.clientId,
        clientName: alert.clientName,
        email: alert.email,
        type: "renewal_due",
        urgency: alert.urgency === "critical" ? "high" : "medium",
        detail: `${alert.sessionsRemaining} session${alert.sessionsRemaining === 1 ? "" : "s"} remaining on ${alert.planName}.`,
        estimatedValueCents: avgSessionValueCents * 4,
        suggestedAction: `Contact ${alert.clientName} about renewing their ${alert.planName}`,
      });
    }
  } catch {}

  // Clients with no upcoming bookings (should book)
  try {
    if (coachIds.length > 0) {
      const nextWeekEnd = addDays(now, 7);
      const allBookingsNext = await db
        .select({ clientId: bookings.clientId })
        .from(bookings)
        .where(
          and(
            inArray(bookings.coachId, coachIds),
            gte(bookings.startAt, now),
            lte(bookings.startAt, nextWeekEnd),
            ne(bookings.status, "CANCELLED")
          )
        );
      const bookedClientIds = new Set(allBookingsNext.map((b) => b.clientId));

      const recentActive = await db
        .select({
          clientId: bookings.clientId,
          clientFirst: users.firstName,
          clientLast: users.lastName,
          clientEmail: users.email,
          lastStart: bookings.startAt,
        })
        .from(bookings)
        .leftJoin(users, eq(bookings.clientId, users.id))
        .where(
          and(
            inArray(bookings.coachId, coachIds),
            gte(bookings.startAt, addDays(now, -21)),
            lte(bookings.startAt, now),
            ne(bookings.status, "CANCELLED")
          )
        )
        .orderBy(desc(bookings.startAt))
        .limit(30);

      const seen = new Set<string>();
      for (const b of recentActive) {
        if (!b.clientId || seen.has(b.clientId) || bookedClientIds.has(b.clientId)) continue;
        seen.add(b.clientId);
        const name = `${b.clientFirst || ""} ${b.clientLast || ""}`.trim() || "Client";
        clientOpportunities.push({
          clientId: b.clientId,
          clientName: name,
          email: b.clientEmail || null,
          type: "should_book",
          urgency: "medium",
          detail: "Active client with no upcoming sessions in the next 7 days.",
          estimatedValueCents: avgSessionValueCents,
          suggestedAction: `Reach out to ${name} to schedule their next session`,
        });
        if (seen.size >= 4) break;
      }
    }
  } catch {}

  // ─── Team pipeline ─────────────────────────────────────────────────────────
  let teamPipelineData = {
    totalProspects: 0,
    highConfidenceLeads: 0,
    draftsAwaitingApproval: 0,
    repliesNeedingFollowUp: 0,
    estimatedPipelineValueCents: 0,
    activeLeads: [] as TeamPipelineEntry[],
    pendingDrafts: [] as PendingDraft[],
  };
  try {
    const prospects = await storage.getTeamTrainingProspects(orgId);
    const activeProspects = prospects.filter(
      (p) => p.outreachStatus !== "Do Not Contact" && p.outreachStatus !== "Not Interested"
    );
    const highConf = activeProspects.filter((p) => (p.confidenceScore || 0) >= 70);
    const replies = prospects.filter((p) => p.outreachStatus === "Replied");

    const drafts = await storage.getOutreachDraftsByOrg(orgId);
    const pendingDrafts = drafts.filter((d) => !d.approved && !d.sentAt);

    teamPipelineData = {
      totalProspects: prospects.length,
      highConfidenceLeads: highConf.length,
      draftsAwaitingApproval: pendingDrafts.length,
      repliesNeedingFollowUp: replies.length,
      estimatedPipelineValueCents: activeProspects.length * 75000,
      activeLeads: activeProspects.slice(0, 5).map((p) => ({
        id: p.id,
        prospectName: p.prospectName,
        sport: p.sport || "Unknown",
        city: p.city || "",
        state: p.state || "",
        outreachStatus: p.outreachStatus || "New",
        confidenceScore: p.confidenceScore || 0,
        contactEmail: p.contactEmail || null,
        lastContactedAt: p.lastContactedAt ? p.lastContactedAt.toISOString() : null,
      })),
      pendingDrafts: pendingDrafts.slice(0, 5).map((d) => ({
        draftId: d.id,
        prospectId: d.prospectId,
        prospectName: (d as any).prospect?.prospectName || "Unknown Prospect",
        subject: d.subject,
        bodyPreview: d.body.slice(0, 150) + (d.body.length > 150 ? "..." : ""),
        createdAt: d.createdAt ? d.createdAt.toISOString() : new Date().toISOString(),
      })),
    };
  } catch {}

  return {
    generatedAt: now.toISOString(),
    timezone,

    todayRevenueCents,
    openSlotValueTodayCents,
    projectedMonthRevenueCents,
    monthRevenueCents,
    monthGoalCents,
    revenueGapCents,
    sessionsNeededToClose,
    avgSessionValueCents,
    daysRemainingInMonth: daysRemaining,
    daysElapsedInMonth: daysElapsed,

    todaySchedule,
    openSlotsToday,
    openSlotsTomorrow,

    bestAction,

    clientOpportunities,

    teamPipeline: teamPipelineData,
  };
}

export async function getMonthlyGoal(orgId: string): Promise<number | null> {
  const raw = await storage.getSetting(`monthly_revenue_goal_${orgId}`);
  return raw ? parseInt(raw, 10) : null;
}

export async function setMonthlyGoal(orgId: string, goalCents: number): Promise<void> {
  await storage.setSetting(`monthly_revenue_goal_${orgId}`, String(goalCents));
}

export async function buildCommandCenterContextString(orgId: string): Promise<string> {
  try {
    const data = await computeCommandCenter(orgId);

    const goalLine =
      data.monthGoalCents != null
        ? `Monthly goal: $${(data.monthGoalCents / 100).toFixed(0)} | Revenue gap: $${((data.revenueGapCents || 0) / 100).toFixed(0)} | Sessions needed to close gap: ${data.sessionsNeededToClose ?? 0}`
        : "No monthly goal set.";

    const slotsLine =
      data.openSlotsToday.length > 0
        ? `Open slots today: ${data.openSlotsToday.length} (value: $${(data.openSlotValueTodayCents / 100).toFixed(0)}). First open: ${data.openSlotsToday[0]?.startTime}.`
        : "No open slots today.";

    const bestLine = data.bestAction
      ? `Top recommendation: "${data.bestAction.headline}" — ${data.bestAction.detail}`
      : "No top recommendation available.";

    const churnCount = data.clientOpportunities.filter((o) => o.type === "churn_risk").length;
    const renewalCount = data.clientOpportunities.filter((o) => o.type === "renewal_due").length;
    const shouldBookCount = data.clientOpportunities.filter((o) => o.type === "should_book").length;

    const teamLine =
      data.teamPipeline.totalProspects > 0
        ? `Team pipeline: ${data.teamPipeline.totalProspects} prospects, ${data.teamPipeline.draftsAwaitingApproval} drafts pending approval, ${data.teamPipeline.repliesNeedingFollowUp} replies needing follow-up. Estimated pipeline: $${(data.teamPipeline.estimatedPipelineValueCents / 100).toFixed(0)} (potential only, not booked revenue).`
        : "No team training prospects yet.";

    return `
## Today's Business Command Center Context (as of ${format(new Date(), "MMM d, yyyy h:mm a")})

Revenue today: $${(data.todayRevenueCents / 100).toFixed(0)} booked | Month to date: $${(data.monthRevenueCents / 100).toFixed(0)} | Projected month-end: $${(data.projectedMonthRevenueCents / 100).toFixed(0)}
${goalLine}
${slotsLine}
${bestLine}

Client opportunities: ${churnCount} churn risks, ${renewalCount} renewals due, ${shouldBookCount} clients who should book.
${teamLine}

When the coach asks "What should I do today?" or similar, lead with this context and give a prioritized action list.
`.trim();
  } catch {
    return "";
  }
}
