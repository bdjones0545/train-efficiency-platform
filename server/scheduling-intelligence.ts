import { storage } from "./storage";
import { addDays, startOfWeek, endOfWeek, format, differenceInMinutes, subDays, getDay } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { db } from "./db";
import { bookings, coachProfiles, users } from "@shared/schema";
import { eq, and, inArray, gte, lte, sql } from "drizzle-orm";

const TIMEZONE = "America/New_York";

export interface ScheduleInsight {
  type: "info" | "warning" | "opportunity" | "action";
  category: "utilization" | "gaps" | "clients" | "backfill" | "revenue" | "waitlist";
  title: string;
  description: string;
  metric?: string;
  priority: "high" | "medium" | "low";
  actionLabel?: string;
  actionPrompt?: string;
}

export type UtilizationStatus = "overloaded" | "high_load" | "healthy" | "underbooked" | "no_availability" | "active_no_schedule";

export interface CoachDigest {
  coachId: string;
  coachName: string;
  bookedMinutes: number;
  availableMinutes: number;
  utilizationPct: number;
  openSlots: number;
  todayBookings: number;
  weekSessionCount: number;
  statusLabel: UtilizationStatus;
  statusMessage: string;
  recommendation: string;
}

export function getUtilizationStatus(
  pct: number,
  availableMinutes: number,
  weekSessionCount: number = 0,
): {
  statusLabel: UtilizationStatus;
  statusMessage: string;
  recommendation: string;
} {
  if (availableMinutes === 0) {
    // Case 3: no availability blocks but coach is actively delivering sessions
    if (weekSessionCount > 0) {
      return {
        statusLabel: "active_no_schedule",
        statusMessage: `Active — ${weekSessionCount} session${weekSessionCount !== 1 ? "s" : ""} this week, no availability schedule configured`,
        recommendation: "Add availability blocks so the dashboard can calculate and track this coach's utilization.",
      };
    }
    // Case 4: no availability blocks and no sessions
    return {
      statusLabel: "no_availability",
      statusMessage: "No availability blocks set",
      recommendation: "Set availability blocks to start tracking utilization",
    };
  }
  if (pct > 90) {
    return {
      statusLabel: "overloaded",
      statusMessage: `At ${pct}% capacity — risk of burnout and client experience decline`,
      recommendation: "Consider moving lower-priority sessions or adding capacity. Do not accept new clients this week.",
    };
  }
  if (pct > 80) {
    return {
      statusLabel: "high_load",
      statusMessage: `At ${pct}% capacity — healthy but limited room for additions`,
      recommendation: "Accept new bookings with caution. Prioritize high-value clients for any remaining slots.",
    };
  }
  if (pct >= 45) {
    return {
      statusLabel: "healthy",
      statusMessage: `At ${pct}% — good balance of bookings and flexibility`,
      recommendation: "Room to add 1–2 new clients or fill gaps with semi-private sessions.",
    };
  }
  return {
    statusLabel: "underbooked",
    statusMessage: `At ${pct}% — significant capacity available`,
    recommendation: "Focus on reactivating inactive clients and filling open slots. Good time for outreach.",
  };
}

export interface OpsDigest {
  generatedAt: string;
  weekRange: string;
  totalBookingsThisWeek: number;
  openSlotsThisWeek: number;
  estimatedOpenRevenue: number;
  inactiveClientsCount: number;
  waitlistCount: number;
  coaches: CoachDigest[];
  insights: ScheduleInsight[];
  recentCancellations: {
    id: string;
    clientName: string;
    coachName: string;
    time: string;
    service: string;
  }[];
}

export async function computeOrgDigest(orgId: string): Promise<OpsDigest> {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const insights: ScheduleInsight[] = [];

  const [orgCoaches, weekBookings, inactiveClients, waitlistEntries] = await Promise.all([
    storage.getCoachProfiles().then(all => all.filter(c => c.organizationId === orgId)),
    storage.getBookingsByDateRangeForOrg(orgId, weekStart, weekEnd),
    storage.findClientsWithNoBookingsSince(orgId, addDays(now, -7)),
    storage.getWaitlistByOrganization(orgId),
  ]);

  const activeBookings = weekBookings.filter(b => b.status !== "CANCELLED" && b.status !== "NO_SHOW");
  const cancelledThisWeek = weekBookings.filter(b => b.status === "CANCELLED");
  const totalBookedMinutes = activeBookings.reduce((sum, b) => {
    return sum + differenceInMinutes(new Date(b.endAt), new Date(b.startAt));
  }, 0);

  const services = await storage.getServicesByOrganization(orgId);
  const avgServicePrice = services.length > 0
    ? services.filter(s => s.active && s.priceCents > 0).reduce((sum, s) => sum + s.priceCents, 0) / Math.max(services.filter(s => s.active && s.priceCents > 0).length, 1)
    : 7000;

  const coachDigests: CoachDigest[] = [];
  let totalOpenSlots = 0;

  for (const coach of orgCoaches) {
    const coachBlocks = await storage.getAvailabilityBlocks(coach.id);

    // Only CONFIRMED and COMPLETED count toward utilization (exclude DRAFT, CANCELLED, NO_SHOW)
    const coachBookingsThisWeek = weekBookings.filter(b =>
      b.coachId === coach.id &&
      (b.status === "CONFIRMED" || b.status === "COMPLETED")
    );
    const todayBookings = coachBookingsThisWeek.filter(b => {
      const d = new Date(b.startAt);
      return d >= todayStart && d <= todayEnd;
    });
    // Future confirmed bookings (from now to end of week) for open-slots calc
    const futureConfirmedBookings = weekBookings.filter(b =>
      b.coachId === coach.id &&
      b.status === "CONFIRMED" &&
      new Date(b.startAt) > now
    );

    // ── Availability: recurring weekly template mapped to this week ──────────
    // availableMinutesThisWeek = full Mon–Sun template → utilization % denominator
    // futureAvailableMinutes   = blocks whose wall-clock start is still in the future
    //                            → open-slots numerator
    let availableMinutesThisWeek = 0;
    let futureAvailableMinutes = 0;

    for (let d = 0; d < 7; d++) {
      const dayDate = addDays(weekStart, d);
      const dow = getDay(dayDate); // 0=Sun, 1=Mon … matches dayOfWeek column
      const dayBlocks = coachBlocks.filter(b => b.dayOfWeek === dow);
      for (const block of dayBlocks) {
        const [sh, sm] = block.startTime.split(":").map(Number);
        const [eh, em] = block.endTime.split(":").map(Number);
        const blockMins = (eh * 60 + em) - (sh * 60 + sm);
        if (blockMins <= 0) continue;
        availableMinutesThisWeek += blockMins;

        // Only count this block toward open-slots if it hasn't passed yet
        const blockStart = new Date(dayDate);
        blockStart.setHours(sh, sm, 0, 0);
        if (blockStart > now) {
          futureAvailableMinutes += blockMins;
        }
      }
    }

    // Utilization = booked this week ÷ available this week (full week denominator)
    const bookedMinutesThisWeek = coachBookingsThisWeek.reduce((sum, b) =>
      sum + differenceInMinutes(new Date(b.endAt), new Date(b.startAt)), 0);

    // Open slots = future available capacity − future confirmed bookings
    const futureBookedMinutes = futureConfirmedBookings.reduce((sum, b) =>
      sum + differenceInMinutes(new Date(b.endAt), new Date(b.startAt)), 0);

    const freeMinutes = Math.max(0, futureAvailableMinutes - futureBookedMinutes);
    const actualOpenSlots = Math.floor(freeMinutes / 60);
    totalOpenSlots += actualOpenSlots;

    const utilizationPct = availableMinutesThisWeek > 0
      ? Math.min(100, Math.round((bookedMinutesThisWeek / availableMinutesThisWeek) * 100))
      : 0;

    const coachName = coach.user ? `${coach.user.firstName} ${coach.user.lastName}` : "Unknown";
    const weekSessionCount = coachBookingsThisWeek.length;
    const statusInfo = getUtilizationStatus(utilizationPct, availableMinutesThisWeek, weekSessionCount);

    coachDigests.push({
      coachId: coach.id,
      coachName,
      bookedMinutes: bookedMinutesThisWeek,
      availableMinutes: availableMinutesThisWeek,
      utilizationPct,
      openSlots: actualOpenSlots,
      todayBookings: todayBookings.length,
      weekSessionCount,
      ...statusInfo,
    });

    if (statusInfo.statusLabel === "active_no_schedule") {
      insights.push({
        type: "warning",
        category: "utilization",
        title: `${coachName} has no availability schedule`,
        description: `Actively coaching ${weekSessionCount} session${weekSessionCount !== 1 ? "s" : ""} this week but has no availability blocks — utilization cannot be calculated.`,
        metric: `${weekSessionCount} sessions`,
        priority: "medium",
        actionLabel: "Configure availability",
        actionPrompt: `Help me set up availability blocks for coach ${coachName}`,
      });
    } else if (statusInfo.statusLabel === "overloaded") {
      insights.push({
        type: "warning",
        category: "utilization",
        title: `${coachName} is overloaded this week`,
        description: `At ${utilizationPct}% capacity — only ${actualOpenSlots} open slot${actualOpenSlots !== 1 ? "s" : ""} remaining. Risk of burnout and declining client experience.`,
        metric: `${utilizationPct}% booked`,
        priority: "high",
        actionLabel: "Review schedule",
        actionPrompt: `Show me ${coachName}'s schedule this week`,
      });
    } else if (statusInfo.statusLabel === "high_load") {
      insights.push({
        type: "info",
        category: "utilization",
        title: `${coachName} is near capacity`,
        description: `At ${utilizationPct}% with ${actualOpenSlots} slot${actualOpenSlots !== 1 ? "s" : ""} remaining. Accept new bookings carefully.`,
        metric: `${utilizationPct}% booked`,
        priority: "medium",
        actionLabel: "View availability",
        actionPrompt: `Find schedule gaps for coach ${coachName}`,
      });
    } else if (statusInfo.statusLabel === "underbooked") {
      insights.push({
        type: "opportunity",
        category: "utilization",
        title: `${coachName} has significant capacity this week`,
        description: `At ${utilizationPct}% with ${actualOpenSlots} open slot${actualOpenSlots !== 1 ? "s" : ""}. Strong opportunity to fill with new or reactivated clients.`,
        metric: `${utilizationPct}% booked`,
        priority: "high",
        actionLabel: "Find open slots",
        actionPrompt: `Show me open time slots for coach ${coachName} this week`,
      });
    } else if (statusInfo.statusLabel === "healthy" && availableMinutesThisWeek > 0) {
      insights.push({
        type: "info",
        category: "utilization",
        title: `${coachName} has room to grow`,
        description: `At ${utilizationPct}% with ${actualOpenSlots} slot${actualOpenSlots !== 1 ? "s" : ""} remaining. Consider adding semi-private or group sessions.`,
        metric: `${utilizationPct}% booked`,
        priority: "medium",
        actionLabel: "Check availability",
        actionPrompt: `Find schedule gaps for coach ${coachName}`,
      });
    }
  }

  if (inactiveClients.length > 0) {
    const plural = inactiveClients.length === 1 ? "client hasn't" : "clients haven't";
    insights.push({
      type: "warning",
      category: "clients",
      title: `${inactiveClients.length} ${plural} booked this week`,
      description: `${inactiveClients.map(c => `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()).slice(0, 3).join(", ")}${inactiveClients.length > 3 ? ` and ${inactiveClients.length - 3} more` : ""} — consider a follow-up or booking offer.`,
      metric: `${inactiveClients.length} inactive`,
      priority: inactiveClients.length >= 5 ? "high" : "medium",
      actionLabel: "See inactive clients",
      actionPrompt: "Who hasn't booked this week?",
    });
  }

  const estimatedOpenRevenue = totalOpenSlots * (avgServicePrice / 100);
  if (totalOpenSlots > 0) {
    insights.push({
      type: "opportunity",
      category: "revenue",
      title: `~$${Math.round(estimatedOpenRevenue).toLocaleString()} in potential revenue this week`,
      description: `${totalOpenSlots} unfilled hour-slots across all coaches. Filling these at average session rate could add significant revenue.`,
      metric: `${totalOpenSlots} open slots`,
      priority: totalOpenSlots > 10 ? "high" : "medium",
      actionLabel: "Fill open slots",
      actionPrompt: "Help me fill open time slots this week",
    });
  }

  if (cancelledThisWeek.length > 0) {
    insights.push({
      type: "action",
      category: "backfill",
      title: `${cancelledThisWeek.length} cancellation${cancelledThisWeek.length > 1 ? "s" : ""} this week to backfill`,
      description: `These slots are now open. ${waitlistEntries.length > 0 ? `${waitlistEntries.length} client${waitlistEntries.length > 1 ? "s are" : " is"} on the waitlist and may be a match.` : "Check your inactive clients — they may be interested."}`,
      metric: `${cancelledThisWeek.length} open slots`,
      priority: "high",
      actionLabel: "Find replacements",
      actionPrompt: "Help me backfill cancelled sessions this week",
    });
  }

  if (waitlistEntries.length > 0) {
    insights.push({
      type: "action",
      category: "waitlist",
      title: `${waitlistEntries.length} client${waitlistEntries.length > 1 ? "s" : ""} on the waitlist`,
      description: `These clients are waiting for a session. ${totalOpenSlots > 0 ? "You have open slots that could match." : "Check upcoming availability."}`,
      metric: `${waitlistEntries.length} waiting`,
      priority: "medium",
      actionLabel: "View waitlist",
      actionPrompt: "Show me the waitlist",
    });
  }

  const recentCancellations = cancelledThisWeek.slice(0, 5).map(b => ({
    id: b.id,
    clientName: b.client ? `${b.client.firstName} ${b.client.lastName}` : "Unknown",
    coachName: b.coach?.user ? `${b.coach.user.firstName} ${b.coach.user.lastName}` : "Unknown",
    time: format(toZonedTime(new Date(b.startAt), TIMEZONE), "EEE MMM d 'at' h:mm a"),
    service: b.service?.name ?? "Unknown Service",
  }));

  insights.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  return {
    generatedAt: now.toISOString(),
    weekRange: `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`,
    totalBookingsThisWeek: activeBookings.length,
    openSlotsThisWeek: totalOpenSlots,
    estimatedOpenRevenue: Math.round(estimatedOpenRevenue),
    inactiveClientsCount: inactiveClients.length,
    waitlistCount: waitlistEntries.length,
    coaches: coachDigests,
    insights,
    recentCancellations,
  };
}

// ── Coach Utilization Diagnostic ──────────────────────────────────────────────
// Identifies the root cause when a coach shows 0% utilization on the dashboard.
// Returns the exact same metrics used by computeOrgDigest() so you can verify
// what Bryan Jones, Hunter Thaxton, or any coach actually shows and why.
// Call via GET /api/admin/coach-utilization-diagnostic

export interface CoachUtilizationDiagnosticEntry {
  coachId: string;
  coachName: string;
  userId: string;
  availabilityBlocksCount: number;
  availableMinutesThisWeek: number;
  futureAvailableMinutes: number;
  bookedMinutesThisWeek: number;
  futureBookedMinutes: number;
  utilizationPct: number;
  openSlots: number;
  statusLabel: UtilizationStatus;
  diagnosis: string;
}

export async function computeCoachUtilizationDiagnostic(
  orgId: string
): Promise<CoachUtilizationDiagnosticEntry[]> {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const past90d = subDays(now, 90);

  // Load all coaches for the org (with user names)
  const coaches = await db
    .select({
      id: coachProfiles.id,
      userId: coachProfiles.userId,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(coachProfiles)
    .leftJoin(users, eq(coachProfiles.userId, users.id))
    .where(eq(coachProfiles.organizationId, orgId));

  if (coaches.length === 0) return [];

  const coachProfileIds = coaches.map(c => c.id);

  // Week bookings (confirmed + completed) and past-90d completed for history context
  const [weekBookingsRaw, completedLast90d] = await Promise.all([
    db
      .select({
        coachId: bookings.coachId,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        status: bookings.status,
      })
      .from(bookings)
      .where(
        and(
          inArray(bookings.coachId, coachProfileIds),
          gte(bookings.startAt, weekStart),
          lte(bookings.startAt, weekEnd),
          inArray(bookings.status as any, ["CONFIRMED", "COMPLETED"])
        )
      ),
    db
      .select({ coachId: bookings.coachId })
      .from(bookings)
      .where(
        and(
          inArray(bookings.coachId, coachProfileIds),
          inArray(bookings.status as any, ["COMPLETED"]),
          gte(bookings.startAt, past90d)
        )
      ),
  ]);

  const completedByCoach = new Map<string, number>();
  for (const b of completedLast90d) {
    completedByCoach.set(b.coachId, (completedByCoach.get(b.coachId) ?? 0) + 1);
  }

  const results: CoachUtilizationDiagnosticEntry[] = [];

  for (const coach of coaches) {
    // Availability blocks are recurring weekly templates — use storage helper (same as computeOrgDigest)
    const coachBlocks = await storage.getAvailabilityBlocks(coach.id);

    let availableMinutesThisWeek = 0;
    let futureAvailableMinutes = 0;

    for (let d = 0; d < 7; d++) {
      const dayDate = addDays(weekStart, d);
      const dow = getDay(dayDate);
      const dayBlocks = coachBlocks.filter(b => b.dayOfWeek === dow);
      for (const block of dayBlocks) {
        const [sh, sm] = block.startTime.split(":").map(Number);
        const [eh, em] = block.endTime.split(":").map(Number);
        const blockMins = (eh * 60 + em) - (sh * 60 + sm);
        if (blockMins <= 0) continue;
        availableMinutesThisWeek += blockMins;
        const blockStart = new Date(dayDate);
        blockStart.setHours(sh, sm, 0, 0);
        if (blockStart > now) futureAvailableMinutes += blockMins;
      }
    }

    const coachWeekBookings = weekBookingsRaw.filter(b => b.coachId === coach.id);
    const futureFirmedBookings = coachWeekBookings.filter(b =>
      b.status === "CONFIRMED" && new Date(b.startAt) > now
    );

    const bookedMinutesThisWeek = coachWeekBookings.reduce((sum, b) =>
      sum + differenceInMinutes(new Date(b.endAt), new Date(b.startAt)), 0);
    const futureBookedMinutes = futureFirmedBookings.reduce((sum, b) =>
      sum + differenceInMinutes(new Date(b.endAt), new Date(b.startAt)), 0);

    const freeMinutes = Math.max(0, futureAvailableMinutes - futureBookedMinutes);
    const openSlots = Math.floor(freeMinutes / 60);

    const utilizationPct = availableMinutesThisWeek > 0
      ? Math.min(100, Math.round((bookedMinutesThisWeek / availableMinutesThisWeek) * 100))
      : 0;

    const weekSessionCount = coachWeekBookings.length;
    const { statusLabel } = getUtilizationStatus(utilizationPct, availableMinutesThisWeek, weekSessionCount);

    let diagnosis: string;
    if (coachBlocks.length === 0) {
      diagnosis = weekSessionCount > 0
        ? `ACTIVE_NO_SCHEDULE — ${weekSessionCount} session(s) this week but 0 availability blocks configured. Dashboard shows "Active" instead of %. Add availability blocks to enable utilization tracking.`
        : `NO_AVAILABILITY_BLOCKS — 0 blocks configured, 0 bookings this week. Set dayOfWeek+startTime+endTime blocks in Availability settings.`;
    } else if (availableMinutesThisWeek === 0) {
      diagnosis = `ZERO_AVAILABLE_MINUTES — ${coachBlocks.length} block(s) exist but resolve to 0 minutes (check endTime > startTime for each block).`;
    } else if (weekSessionCount === 0) {
      const completed90 = completedByCoach.get(coach.id) ?? 0;
      diagnosis = `NO_BOOKINGS_THIS_WEEK — ${availableMinutesThisWeek}min available, 0 confirmed/completed sessions. ${completed90} completed sessions in last 90d. ${completed90 === 0 ? "Coach may be newly onboarded." : "Consider backfill outreach."}`;
    } else {
      diagnosis = `OK — ${coachBlocks.length} blocks, ${availableMinutesThisWeek}min available this week, ${bookedMinutesThisWeek}min booked (${utilizationPct}%), ${futureAvailableMinutes}min future available, ${openSlots} open slot(s).`;
    }

    results.push({
      coachId: coach.id,
      coachName: `${coach.firstName ?? ""} ${coach.lastName ?? ""}`.trim() || coach.id,
      userId: coach.userId,
      availabilityBlocksCount: coachBlocks.length,
      availableMinutesThisWeek,
      futureAvailableMinutes,
      bookedMinutesThisWeek,
      futureBookedMinutes,
      utilizationPct,
      openSlots,
      statusLabel,
      diagnosis,
    });
  }

  return results;
}
