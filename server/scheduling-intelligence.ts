import { storage } from "./storage";
import { addDays, startOfWeek, endOfWeek, format, differenceInMinutes } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

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

export interface CoachDigest {
  coachId: string;
  coachName: string;
  bookedMinutes: number;
  availableMinutes: number;
  utilizationPct: number;
  openSlots: number;
  todayBookings: number;
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

    coachDigests.push({
      coachId: coach.id,
      coachName,
      bookedMinutes,
      availableMinutes,
      utilizationPct,
      openSlots: actualOpenSlots,
      todayBookings: todayBookings.length,
    });

    if (utilizationPct < 40 && availableMinutes > 0) {
      insights.push({
        type: "opportunity",
        category: "utilization",
        title: `${coachName} has significant capacity this week`,
        description: `Currently at ${utilizationPct}% utilization with ~${actualOpenSlots} open hour-slots available. Great opportunity to fill with sessions or semi-private groups.`,
        metric: `${utilizationPct}% booked`,
        priority: "high",
        actionLabel: "Find open slots",
        actionPrompt: `Show me open time slots for coach ${coachName} this week`,
      });
    } else if (utilizationPct < 70 && availableMinutes > 0) {
      insights.push({
        type: "info",
        category: "utilization",
        title: `${coachName} has room to grow`,
        description: `At ${utilizationPct}% this week with ${actualOpenSlots} open hour-slots remaining. Consider adding semi-private or group sessions.`,
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
