/**
 * Booking Events → Attention Inbox
 *
 * Fires a durable attention item for every booking lifecycle event.
 * All writes are fire-and-forget: never throws, never blocks a response.
 */

import { db } from "./db";
import { attentionItems, bookings } from "@shared/schema";
import type { InsertAttentionItem } from "@shared/schema";
import { eq, and, gte, lt, inArray, ne, count } from "drizzle-orm";

// ─── Event types ──────────────────────────────────────────────────────────────

export type BookingEventType =
  | "booking_created"
  | "booking_cancelled"
  | "booking_rescheduled"
  | "booking_no_show"
  | "booking_payment_failed"
  | "booking_intro_used"
  | "group_session_full"
  | "group_session_below_minimum";

// ─── Context ─────────────────────────────────────────────────────────────────

export interface BookingEventContext {
  bookingId: string;
  orgId: string;
  clientId: string;
  coachId: string;
  serviceId: string;
  serviceName: string;
  startAt: Date;
  endAt: Date;
  priceCents: number;
  paymentMethod?: string | null;
  sessionType?: string | null;
  maxParticipants?: number | null;
  participantCount?: number;
  previousStartAt?: Date;
  isFirstTimeClient?: boolean;
  isIntroSession?: boolean;
  coachUpcomingCount?: number;
}

// ─── Main event tracker ───────────────────────────────────────────────────────

export async function trackBookingEvent(
  eventType: BookingEventType,
  ctx: BookingEventContext,
): Promise<void> {
  try {
    const now = new Date();
    const isSameDay =
      ctx.startAt.toDateString() === now.toDateString();
    const hoursUntil =
      (ctx.startAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    // ── Escalation conditions ────────────────────────────────────────────────
    const escalationReasons: string[] = [];
    if (ctx.isFirstTimeClient) escalationReasons.push("first-time client");
    if (isSameDay) escalationReasons.push("same-day");
    if (
      ctx.priceCents > 0 &&
      (ctx.paymentMethod === "STRIPE" ||
        ctx.paymentMethod === "CARD" ||
        ctx.paymentMethod === "ONLINE")
    )
      escalationReasons.push("payment required");
    if ((ctx.coachUpcomingCount ?? 0) >= 7)
      escalationReasons.push("coach near capacity");

    const escalated = escalationReasons.length > 0;

    // ── Per-event configuration ──────────────────────────────────────────────
    let level: string;
    let severity: number;
    let urgency: number;
    let businessImpact: number;
    let confidence: number = 0.95;
    let title: string;
    let body: string;
    let actionUrl: string = "/schedule";
    let actionLabel: string = "View Schedule";
    let expiresAt: Date | undefined;

    const priceLabel =
      ctx.priceCents > 0
        ? `$${(ctx.priceCents / 100).toFixed(0)}`
        : "Free";

    const dateLabel = isSameDay
      ? `today at ${ctx.startAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : ctx.startAt.toLocaleDateString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
        }) +
        " at " +
        ctx.startAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

    switch (eventType) {
      // ── booking_created ────────────────────────────────────────────────────
      case "booking_created": {
        level = escalated
          ? ctx.isFirstTimeClient
            ? "important"
            : "suggested"
          : "informational";
        urgency = escalated ? (isSameDay ? 75 : 55) : 25;
        severity = escalated ? 55 : 20;
        businessImpact =
          ctx.priceCents > 0
            ? Math.min(100, 40 + Math.round(ctx.priceCents / 100))
            : 30;

        title = `New booking confirmed: ${ctx.serviceName}`;
        body = `${dateLabel} — ${priceLabel}${
          escalationReasons.length > 0
            ? " · " + escalationReasons.join(", ")
            : ""
        }`;
        // Informational creates expire after 72 h — they're just FYIs
        if (!escalated) {
          expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
        }
        break;
      }

      // ── booking_intro_used ─────────────────────────────────────────────────
      case "booking_intro_used": {
        level = "suggested";
        urgency = 65;
        severity = 35;
        businessImpact = 75;
        title = `Intro session scheduled: ${ctx.serviceName}`;
        body = `First-time client booked ${dateLabel}. This is a high-conversion touchpoint — prepare a follow-up offer for after the session.`;
        actionUrl = "/admin/clients";
        actionLabel = "View Client";
        // Expires 48 h after session ends
        expiresAt = new Date(
          ctx.endAt.getTime() + 48 * 60 * 60 * 1000,
        );
        break;
      }

      // ── booking_cancelled ─────────────────────────────────────────────────
      case "booking_cancelled": {
        level = "important";
        urgency = isSameDay ? 85 : 60;
        severity = isSameDay ? 70 : 60;
        businessImpact =
          ctx.priceCents > 0
            ? Math.min(100, 50 + Math.round(ctx.priceCents / 100))
            : 45;
        title = `Booking cancelled: ${ctx.serviceName}`;
        body = `Session on ${dateLabel} was cancelled${
          isSameDay ? " — same-day cancellation" : ""
        }${
          ctx.priceCents > 0
            ? `. Revenue at risk: ${priceLabel}`
            : ""
        }${
          ctx.isFirstTimeClient
            ? ". This was a first-time client — consider outreach to re-engage."
            : ""
        }`;
        actionUrl = "/schedule";
        actionLabel = "View Schedule";
        break;
      }

      // ── booking_rescheduled ───────────────────────────────────────────────
      case "booking_rescheduled": {
        level = "suggested";
        urgency = 45;
        severity = 35;
        businessImpact = 40;
        const prevLabel = ctx.previousStartAt
          ? ctx.previousStartAt.toLocaleDateString([], {
              month: "short",
              day: "numeric",
            })
          : null;
        title = `Booking rescheduled: ${ctx.serviceName}`;
        body = `Session moved to ${dateLabel}${
          prevLabel ? ` from ${prevLabel}` : ""
        }.`;
        expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
        break;
      }

      // ── booking_no_show ───────────────────────────────────────────────────
      case "booking_no_show": {
        level = "important";
        urgency = 75;
        severity = 65;
        businessImpact =
          ctx.priceCents > 0
            ? Math.min(100, 55 + Math.round(ctx.priceCents / 100))
            : 50;
        confidence = 1.0;
        title = `No-show: ${ctx.serviceName}`;
        body = `Client did not attend their session on ${dateLabel}${
          ctx.priceCents > 0 ? ` (${priceLabel})` : ""
        }. Consider follow-up outreach to reschedule.`;
        actionUrl = "/admin/clients";
        actionLabel = "View Client";
        break;
      }

      // ── booking_payment_failed ────────────────────────────────────────────
      case "booking_payment_failed": {
        level = "critical";
        urgency = 92;
        severity = 90;
        businessImpact =
          ctx.priceCents > 0
            ? Math.min(100, 70 + Math.round(ctx.priceCents / 100))
            : 65;
        confidence = 1.0;
        title = `Payment failed: ${ctx.serviceName}`;
        body = `Payment of ${priceLabel} failed for session on ${dateLabel}. Requires immediate follow-up.`;
        actionUrl = "/admin/financial-reconciliation";
        actionLabel = "View Payments";
        break;
      }

      // ── group_session_full ────────────────────────────────────────────────
      case "group_session_full": {
        const filled = ctx.participantCount ?? ctx.maxParticipants ?? 0;
        level = "suggested";
        urgency = 55;
        severity = 35;
        businessImpact = 65;
        title = `Group session full: ${ctx.serviceName}`;
        body = `All ${filled} spots filled for ${dateLabel}. Consider opening a waitlist or scheduling a second session.`;
        expiresAt = new Date(ctx.startAt.getTime() + 2 * 60 * 60 * 1000);
        break;
      }

      // ── group_session_below_minimum ───────────────────────────────────────
      case "group_session_below_minimum": {
        const count = ctx.participantCount ?? 0;
        level = "important";
        urgency = isSameDay ? 85 : 65;
        severity = 65;
        businessImpact = 60;
        title = `Group session under-enrolled: ${ctx.serviceName}`;
        body = `Only ${count} participant${count !== 1 ? "s" : ""} registered for ${dateLabel}. ${
          isSameDay
            ? "Decide now whether to run or cancel."
            : "Reach out to fill spots before the session."
        }`;
        break;
      }

      default:
        return;
    }

    const item: InsertAttentionItem = {
      orgId: ctx.orgId,
      level,
      category: "scheduling",
      title,
      body,
      source: "scheduling-agent",
      sourceId: `booking-${eventType}-${ctx.bookingId}`,
      severity,
      urgency,
      businessImpact,
      confidence,
      actionUrl,
      actionLabel,
      status: "active",
      ...(expiresAt ? { expiresAt } : {}),
      metadata: {
        bookingId: ctx.bookingId,
        clientId: ctx.clientId,
        coachId: ctx.coachId,
        serviceId: ctx.serviceId,
        serviceName: ctx.serviceName,
        startAt: ctx.startAt.toISOString(),
        endAt: ctx.endAt.toISOString(),
        priceCents: ctx.priceCents,
        paymentMethod: ctx.paymentMethod ?? null,
        sessionType: ctx.sessionType ?? null,
        isSameDay,
        hoursUntil: Math.round(hoursUntil),
        isFirstTimeClient: ctx.isFirstTimeClient ?? false,
        escalationReasons,
        coachUpcomingCount: ctx.coachUpcomingCount ?? 0,
        ...(ctx.participantCount !== undefined
          ? { participantCount: ctx.participantCount }
          : {}),
        ...(ctx.maxParticipants !== undefined
          ? { maxParticipants: ctx.maxParticipants }
          : {}),
        ...(ctx.previousStartAt
          ? { previousStartAt: ctx.previousStartAt.toISOString() }
          : {}),
      },
    };

    await db
      .insert(attentionItems)
      .values(item)
      .onConflictDoUpdate({
        target: attentionItems.sourceId,
        set: {
          title: item.title,
          body: item.body,
          level: item.level,
          severity: item.severity,
          urgency: item.urgency,
          businessImpact: item.businessImpact,
          status: "active",
          metadata: item.metadata,
          ...(expiresAt ? { expiresAt } : {}),
        },
      });
  } catch (err) {
    console.error("[BookingEvents] Failed to track event:", err);
  }
}

// ─── Context builder ─────────────────────────────────────────────────────────
// Enriches a booking with escalation-relevant data without blocking the request.

export async function buildBookingEventContext(
  bookingId: string,
  orgId: string,
  clientId: string,
  coachId: string,
  serviceId: string,
  serviceName: string,
  startAt: Date,
  endAt: Date,
  priceCents: number,
  opts: {
    paymentMethod?: string | null;
    sessionType?: string | null;
    maxParticipants?: number | null;
    participantCount?: number;
    previousStartAt?: Date;
  } = {},
): Promise<BookingEventContext> {
  let isFirstTimeClient = false;
  let coachUpcomingCount = 0;

  // Is this the first confirmed/completed booking for this client in this org?
  try {
    const prior = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.organizationId, orgId),
          eq(bookings.clientId, clientId),
          inArray(bookings.status, ["CONFIRMED", "COMPLETED"]),
          ne(bookings.id, bookingId),
        ),
      )
      .limit(1);
    isFirstTimeClient = prior.length === 0;
  } catch {}

  // How many confirmed sessions does this coach have in the next 7 days?
  try {
    const weekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.organizationId, orgId),
          eq(bookings.coachId, coachId),
          eq(bookings.status, "CONFIRMED"),
          gte(bookings.startAt, new Date()),
          lt(bookings.startAt, weekAhead),
        ),
      )
      .limit(20);
    coachUpcomingCount = rows.length;
  } catch {}

  const isIntroSession =
    serviceName.toLowerCase().includes("intro") ||
    serviceName.toLowerCase().includes("free");

  return {
    bookingId,
    orgId,
    clientId,
    coachId,
    serviceId,
    serviceName,
    startAt,
    endAt,
    priceCents,
    isFirstTimeClient,
    isIntroSession,
    coachUpcomingCount,
    ...opts,
  };
}
