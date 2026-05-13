import { db } from "../db";
import { bookings, availabilityBlocks, services, coachProfiles } from "@shared/schema";
import { eq, and, gte, lte, lt, inArray, sql } from "drizzle-orm";
import { startOfWeek, endOfWeek, addDays, format, addMinutes, startOfDay, endOfDay } from "date-fns";

export interface SchedulingSignal {
  signalType: string;
  entityType: string;
  entityId: string;
  entityName: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  score: number;
  metadata: Record<string, unknown>;
}

export interface SchedulingRecommendation {
  title: string;
  description: string;
  reason: string;
  entityType: string;
  entityId: string;
  entityName: string;
  severity: "critical" | "high" | "medium" | "low";
  estimatedImpact: number;
  priorityScore: number;
  actionType: string;
  crossAgentTypes: string[];
  metadata: Record<string, unknown>;
}

export interface SchedulingAgentResult {
  signals: SchedulingSignal[];
  recommendations: SchedulingRecommendation[];
  summary: {
    revenueGapsCents: number;
    openSlotsThisWeek: number;
    underutilizedSlots: number;
    utilizationPct: number;
  };
}

export async function runSchedulingAgent(orgId: string): Promise<SchedulingAgentResult> {
  const signals: SchedulingSignal[] = [];
  const recommendations: SchedulingRecommendation[] = [];
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  // --- Get org coaches ---
  const coaches = await db
    .select({ id: coachProfiles.id, userId: coachProfiles.userId })
    .from(coachProfiles)
    .where(eq(coachProfiles.organizationId, orgId));

  const coachIds = coaches.map((c) => c.id);
  if (coachIds.length === 0) {
    return {
      signals,
      recommendations,
      summary: { revenueGapsCents: 0, openSlotsThisWeek: 0, underutilizedSlots: 0, utilizationPct: 0 },
    };
  }

  // --- Get this week's bookings ---
  const weekBookings = await db
    .select({ startAt: bookings.startAt, endAt: bookings.endAt, status: bookings.status, coachId: bookings.coachId })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        gte(bookings.startAt, weekStart),
        lte(bookings.startAt, weekEnd),
        inArray(bookings.coachId, coachIds)
      )
    );

  // --- Get availability blocks ---
  const blocks = await db
    .select()
    .from(availabilityBlocks)
    .where(inArray(availabilityBlocks.coachId, coachIds));

  // --- Get active services for value estimation ---
  const activeServices = await db
    .select({ priceCents: services.priceCents, durationMin: services.durationMin })
    .from(services)
    .where(and(eq(services.organizationId, orgId), eq(services.active, true)));

  const avgSessionValueCents =
    activeServices.length > 0
      ? Math.round(activeServices.reduce((s, svc) => s + (svc.priceCents || 0), 0) / activeServices.length)
      : 10000;

  // --- Compute open slots from availability blocks ---
  const confirmedBookings = weekBookings.filter((b) => b.status === "confirmed" || b.status === "completed");
  const cancelledBookings = weekBookings.filter((b) => b.status === "cancelled");

  // Build a set of booked time windows
  const bookedWindows = confirmedBookings.map((b) => ({
    start: b.startAt.getTime(),
    end: b.endAt?.getTime() || b.startAt.getTime() + 60 * 60 * 1000,
    coachId: b.coachId,
  }));

  // Estimate open slots from availability blocks
  let openSlotCount = 0;
  let openSlotValueCents = 0;
  const openSlotDetails: { day: string; time: string; coachId: string }[] = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const day = addDays(weekStart, dayOffset);
    const dayOfWeek = day.getDay();
    const dayBlocks = blocks.filter((b) => {
      const blockDay = parseInt(b.dayOfWeek?.toString() || "-1");
      return blockDay === dayOfWeek;
    });

    for (const block of dayBlocks) {
      if (!block.startTime || !block.endTime) continue;
      const [sh, sm] = block.startTime.split(":").map(Number);
      const [eh, em] = block.endTime.split(":").map(Number);
      const slotStart = new Date(day);
      slotStart.setHours(sh, sm, 0, 0);
      const slotEnd = new Date(day);
      slotEnd.setHours(eh, em, 0, 0);

      // Check if this slot is booked
      const isBooked = bookedWindows.some(
        (w) => w.coachId === block.coachId && w.start < slotEnd.getTime() && w.end > slotStart.getTime()
      );

      if (!isBooked && slotStart > now) {
        openSlotCount++;
        openSlotValueCents += avgSessionValueCents;
        openSlotDetails.push({
          day: format(day, "EEEE MMM d"),
          time: format(slotStart, "h:mm a"),
          coachId: block.coachId,
        });
      }
    }
  }

  // --- Revenue gap signal ---
  const totalAvailableSlots = blocks.length * 5;
  const utilizationPct =
    totalAvailableSlots > 0 ? Math.round((confirmedBookings.length / Math.max(totalAvailableSlots, 1)) * 100) : 0;

  if (openSlotCount >= 3 && openSlotValueCents > 0) {
    const severity: "critical" | "high" | "medium" | "low" =
      openSlotValueCents > 50000 ? "high" : openSlotValueCents > 20000 ? "medium" : "low";

    signals.push({
      signalType: "revenue_gap",
      entityType: "schedule",
      entityId: orgId,
      entityName: "This Week's Schedule",
      title: `${openSlotCount} open slots this week`,
      description: `$${(openSlotValueCents / 100).toFixed(0)} in potential revenue sitting unfilled`,
      severity,
      score: Math.min(90, openSlotCount * 10 + 30),
      metadata: { openSlotCount, openSlotValueCents, utilizationPct, topSlots: openSlotDetails.slice(0, 3) },
    });

    const bestSlot = openSlotDetails[0];
    recommendations.push({
      title: `Fill ${openSlotCount} open coaching slots`,
      description: `Your schedule has ${openSlotCount} unfilled slots this week worth $${(openSlotValueCents / 100).toFixed(0)}. Consider offering to waitlisted clients or posting a flash promo.${bestSlot ? ` Next opening: ${bestSlot.day} at ${bestSlot.time}.` : ""}`,
      reason: `${openSlotCount} open slots = $${(openSlotValueCents / 100).toFixed(0)} in unrealized revenue. Utilization is ${utilizationPct}%.`,
      entityType: "schedule",
      entityId: orgId,
      entityName: "Schedule",
      severity,
      estimatedImpact: openSlotValueCents,
      priorityScore: Math.min(88, openSlotCount * 8 + 30),
      actionType: "fill_schedule_gap",
      crossAgentTypes: ["growth"],
      metadata: { openSlotCount, openSlotValueCents, utilizationPct, topSlots: openSlotDetails.slice(0, 5) },
    });
  }

  // --- Low utilization signal ---
  if (utilizationPct < 50 && confirmedBookings.length > 0) {
    signals.push({
      signalType: "low_utilization",
      entityType: "schedule",
      entityId: orgId,
      entityName: "Utilization",
      title: `Schedule utilization at ${utilizationPct}%`,
      description: `Only ${confirmedBookings.length} confirmed sessions vs ${totalAvailableSlots} available slots`,
      severity: utilizationPct < 30 ? "high" : "medium",
      score: 50 + (50 - utilizationPct),
      metadata: { utilizationPct, confirmedCount: confirmedBookings.length, availableSlots: totalAvailableSlots },
    });
  }

  // --- Cancellation spike signal ---
  if (cancelledBookings.length >= 3) {
    signals.push({
      signalType: "cancellation_spike",
      entityType: "schedule",
      entityId: orgId,
      entityName: "Cancellations",
      title: `${cancelledBookings.length} cancellations this week`,
      description: "High cancellation rate may indicate client dissatisfaction or scheduling friction",
      severity: cancelledBookings.length >= 5 ? "high" : "medium",
      score: cancelledBookings.length * 10 + 30,
      metadata: { cancelCount: cancelledBookings.length },
    });
  }

  return {
    signals,
    recommendations,
    summary: {
      revenueGapsCents: openSlotValueCents,
      openSlotsThisWeek: openSlotCount,
      underutilizedSlots: Math.max(0, totalAvailableSlots - confirmedBookings.length),
      utilizationPct,
    },
  };
}
