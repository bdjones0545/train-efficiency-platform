import { storage } from "./storage";
import { addDays, startOfWeek, endOfWeek, format, differenceInMinutes, subDays } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { db } from "./db";
import { bookings, coachProfiles, availabilityBlocks, users } from "@shared/schema";
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

export type UtilizationStatus = "overloaded" | "high_load" | "healthy" | "underbooked" | "no_availability";

export interface CoachDigest {
  coachId: string;
  coachName: string;
  bookedMinutes: number;
  availableMinutes: number;
  utilizationPct: number;
  openSlots: number;
  todayBookings: number;
  statusLabel: UtilizationStatus;
  statusMessage: string;
  recommendation: string;
}

export function getUtilizationStatus(pct: number, availableMinutes: number): {
  statusLabel: UtilizationStatus;
  statusMessage: string;
  recommendation: string;
} {
  if (availableMinutes === 0) {
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
    const coachBookingsThisWeek = activeBookings.filter(b => b.coachId === coach.id);
    const todayBookings = coachBookingsThisWeek.filter(b => {
      const d = new Date(b.startAt);
      return d >= todayStart && d <= todayEnd;
    });

    let availableMinutes = 0;
    let openSlots = 0;
    const daysInWeek = 7;

    for (let d = 0; d < daysInWeek; d++) {
      const dayBlocks = coachBlocks.filter(b => b.dayOfWeek === d);
      for (const block of dayBlocks) {
        const [sh, sm] = block.startTime.split(":").map(Number);
        const [eh, em] = block.endTime.split(":").map(Number);
        const blockMins = (eh * 60 + em) - (sh * 60 + sm);
        availableMinutes += blockMins;
        openSlots += Math.floor(blockMins / 60);
      }
    }

    const bookedMinutes = coachBookingsThisWeek.reduce((sum, b) => {
      return sum + differenceInMinutes(new Date(b.endAt), new Date(b.startAt));
    }, 0);

    const freeMinutes = Math.max(0, availableMinutes - bookedMinutes);
    const actualOpenSlots = Math.floor(freeMinutes / 60);
    totalOpenSlots += actualOpenSlots;

    const utilizationPct = availableMinutes > 0
      ? Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100))
      : 0;

    const coachName = coach.user ? `${coach.user.firstName} ${coach.user.lastName}` : "Unknown";
    const statusInfo = getUtilizationStatus(utilizationPct, availableMinutes);

    coachDigests.push({
      coachId: coach.id,
      coachName,
      bookedMinutes,
      availableMinutes,
      utilizationPct,
      openSlots: actualOpenSlots,
      todayBookings: todayBookings.length,
      ...statusInfo,
    });

    if (statusInfo.statusLabel === "overloaded") {
      insights.push({
        type: "warning",
        category: "utilization",
        title: `${coachName} is overloaded this week`,
        description: `At ${utilizationPct}% capacity — only ${actualOpenSlots} hour-slot${actualOpenSlots !== 1 ? "s" : ""} remaining. Risk of burnout and declining client experience.`,
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
        description: `At ${utilizationPct}% with ~${actualOpenSlots} open hour-slots. Strong opportunity to fill with new or reactivated clients.`,
        metric: `${utilizationPct}% booked`,
        priority: "high",
        actionLabel: "Find open slots",
        actionPrompt: `Show me open time slots for coach ${coachName} this week`,
      });
    } else if (statusInfo.statusLabel === "healthy" && availableMinutes > 0) {
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
// Checks availability blocks and booking history for each coach in the org.
// Call via GET /api/admin/coach-utilization-diagnostic

export interface CoachUtilizationDiagnosticEntry {
  coachId: string;
  coachName: string;
  userId: string;
  availabilityBlockCount: number;
  availableMinutesFuture30d: number;
  completedSessionsLast90d: number;
  confirmedSessionsFuture30d: number;
  utilizationPct: number;
  diagnosis: string;
}

export async function computeCoachUtilizationDiagnostic(
  orgId: string
): Promise<CoachUtilizationDiagnosticEntry[]> {
  const now = new Date();
  const future30d = addDays(now, 30);
  const past90d = subDays(now, 90);

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

  const [allAvailability, completedBookings, futureBookings] = await Promise.all([
    db
      .select({
        coachId: availabilityBlocks.coachId,
        startAt: availabilityBlocks.startAt,
        endAt: availabilityBlocks.endAt,
      })
      .from(availabilityBlocks)
      .where(
        and(
          inArray(availabilityBlocks.coachId, coachProfileIds),
          gte(availabilityBlocks.startAt, now),
          lte(availabilityBlocks.startAt, future30d)
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
    db
      .select({ coachId: bookings.coachId })
      .from(bookings)
      .where(
        and(
          inArray(bookings.coachId, coachProfileIds),
          inArray(bookings.status as any, ["CONFIRMED"]),
          gte(bookings.startAt, now),
          lte(bookings.startAt, future30d)
        )
      ),
  ]);

  const availByCoach = new Map<string, number>();
  const availBlockCount = new Map<string, number>();
  for (const block of allAvailability) {
    const mins = differenceInMinutes(new Date(block.endAt), new Date(block.startAt));
    availByCoach.set(block.coachId, (availByCoach.get(block.coachId) ?? 0) + mins);
    availBlockCount.set(block.coachId, (availBlockCount.get(block.coachId) ?? 0) + 1);
  }

  const completedByCoach = new Map<string, number>();
  for (const b of completedBookings) {
    completedByCoach.set(b.coachId, (completedByCoach.get(b.coachId) ?? 0) + 1);
  }

  const futureByCoach = new Map<string, number>();
  for (const b of futureBookings) {
    futureByCoach.set(b.coachId, (futureByCoach.get(b.coachId) ?? 0) + 1);
  }

  return coaches.map(coach => {
    const availMins = availByCoach.get(coach.id) ?? 0;
    const blockCount = availBlockCount.get(coach.id) ?? 0;
    const completed = completedByCoach.get(coach.id) ?? 0;
    const confirmed = futureByCoach.get(coach.id) ?? 0;
    const totalBookedMins = confirmed * 60;
    const utilizationPct = availMins > 0 ? Math.round((totalBookedMins / availMins) * 100) : 0;

    let diagnosis: string;
    if (blockCount === 0) {
      diagnosis = "NO_AVAILABILITY_BLOCKS — coach has not set any availability windows for the next 30 days; the dashboard cannot calculate utilization without these.";
    } else if (availMins === 0) {
      diagnosis = "ZERO_AVAILABLE_MINUTES — availability blocks exist but resolve to 0 minutes (possible data issue: endAt <= startAt).";
    } else if (confirmed === 0 && completed === 0) {
      diagnosis = "NO_BOOKINGS — availability is set but no completed or upcoming confirmed sessions found; coach may be newly onboarded or inactive.";
    } else if (confirmed === 0) {
      diagnosis = `LOW_FUTURE_BOOKINGS — has ${completed} completed sessions in last 90d but 0 confirmed upcoming; consider backfill outreach.`;
    } else {
      diagnosis = `OK — ${blockCount} availability blocks (${availMins}min open), ${confirmed} upcoming confirmed sessions, ${completed} completed in 90d. Utilization ${utilizationPct}%.`;
    }

    return {
      coachId: coach.id,
      coachName: `${coach.firstName ?? ""} ${coach.lastName ?? ""}`.trim() || coach.id,
      userId: coach.userId,
      availabilityBlockCount: blockCount,
      availableMinutesFuture30d: availMins,
      completedSessionsLast90d: completed,
      confirmedSessionsFuture30d: confirmed,
      utilizationPct,
      diagnosis,
    };
  });
}
