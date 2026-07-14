/**
 * Kevin Slack EOH — Scheduling Handler
 *
 * All scheduling writes go through the existing TrainEfficiency storage layer.
 * This handler NEVER writes directly to DB tables — it uses storage.* methods.
 *
 * Supported write actions (pilot):
 *   1. create_session
 *   2. reschedule_session
 *   3. cancel_session
 *
 * Deletion is separate from cancellation (handled by role check).
 *
 * Flow for every write action:
 *   1. Verify Slack signature (done upstream in middleware)
 *   2. Resolve verified identity mapping
 *   3. Resolve authorized organization
 *   4. Parse intent + entities
 *   5. Resolve entities (ambiguous → disambiguation message)
 *   6. Validate role and permissions
 *   7. Check feature flags
 *   8. Run conflict check via getOverlappingBookings
 *   9. Show confirmation preview (Block Kit)
 *  10. On confirm: execute through storage layer
 *  11. Record audit + outcome
 *  12. Send Slack confirmation
 */

import { storage } from "../storage";
import type { ConversationState } from "./conversation-state";
import type { ResolvedIdentity } from "./identity-service";
import {
  buildCreateSessionPreview,
  buildReschedulePreview,
  buildCancellationPreview,
  buildErrorMessage,
  buildDisambiguationMessage,
  type SlackBlock,
  type SessionSummary,
  buildScheduleView,
} from "./block-kit";
import { isSchedulingEnabled } from "./config";
import crypto from "crypto";

// ─── Role permission check ────────────────────────────────────────────────────

function canSchedule(role: string): boolean {
  return ["ADMIN", "COACH", "STAFF"].includes(role);
}

function canDelete(role: string): boolean {
  return role === "ADMIN";
}

// ─── Action token store (in-memory with expiry) ───────────────────────────────

interface ActionToken {
  token: string;
  intent: string;
  orgId: string;
  userId: string;
  payload: Record<string, unknown>;
  expiresAt: number;
}

const actionTokenStore = new Map<string, ActionToken>();

export function createActionToken(
  intent: string,
  orgId: string,
  userId: string,
  payload: Record<string, unknown>,
): string {
  const token = crypto.randomBytes(16).toString("hex");
  actionTokenStore.set(token, {
    token,
    intent,
    orgId,
    userId,
    payload,
    expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes
  });
  return token;
}

export function consumeActionToken(token: string): ActionToken | null {
  const entry = actionTokenStore.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    actionTokenStore.delete(token);
    return null;
  }
  // Do NOT delete — allow one confirmation + one abort (idempotent)
  return entry;
}

export function invalidateActionToken(token: string): void {
  actionTokenStore.delete(token);
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of actionTokenStore.entries()) {
    if (v.expiresAt < now) actionTokenStore.delete(k);
  }
}, 5 * 60 * 1000);

// ─── View today's schedule ────────────────────────────────────────────────────

export async function handleViewSchedule(
  identity: ResolvedIdentity,
  targetDate?: Date,
): Promise<{ blocks: SlackBlock[]; ephemeral: boolean }> {
  try {
    const date = targetDate ?? new Date();
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const bookings = await storage.getBookingsByDateRangeForOrg(identity.orgId, start, end);

    const sessions: SessionSummary[] = bookings.map((b) => ({
      id: b.id,
      time: b.startAt
        ? new Date(b.startAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
        : "TBD",
      sessionType: (b as any).service?.name ?? "Session",
      coachName:
        (b as any).coach?.user
          ? `${(b as any).coach.user.firstName ?? ""} ${(b as any).coach.user.lastName ?? ""}`.trim()
          : "Unassigned",
      participantCount: 1,
      status: b.status ?? "CONFIRMED",
    }));

    const dateLabel = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const blocks = buildScheduleView(`📅 Schedule — ${dateLabel}`, sessions);
    return { blocks, ephemeral: true };
  } catch (err: any) {
    return {
      blocks: buildErrorMessage(`Unable to load schedule: ${err?.message ?? "Unknown error"}`),
      ephemeral: true,
    };
  }
}

// ─── Create session preview ───────────────────────────────────────────────────

export interface CreateSessionParams {
  coachId?: string;
  startAt?: Date;
  durationMinutes?: number;
  sessionType?: string;
  location?: string;
  athleteIds?: string[];
  notes?: string;
}

export async function buildCreateSessionPreviewBlocks(
  identity: ResolvedIdentity,
  params: CreateSessionParams,
): Promise<{ blocks: SlackBlock[]; ephemeral: boolean; actionToken?: string }> {
  if (!isSchedulingEnabled()) {
    return { blocks: buildErrorMessage("Scheduling via Slack is not enabled."), ephemeral: true };
  }
  if (!canSchedule(identity.role)) {
    return {
      blocks: buildErrorMessage("Your role does not have permission to create sessions."),
      ephemeral: true,
    };
  }

  const missing: string[] = [];
  if (!params.startAt) missing.push("date and time");
  if (!params.coachId) missing.push("coach");

  if (missing.length > 0) {
    return {
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `I need a bit more info. Please provide: *${missing.join(", ")}*` },
        },
      ],
      ephemeral: true,
    };
  }

  // Conflict check
  let conflictStatus: "none" | "warning" | "blocked" = "none";
  if (params.coachId && params.startAt && params.durationMinutes) {
    const endAt = new Date(params.startAt.getTime() + params.durationMinutes * 60 * 1000);
    try {
      const conflicts = await storage.getOverlappingBookings(params.coachId, params.startAt, endAt);
      if (conflicts.length > 0) conflictStatus = "warning";
    } catch {
      conflictStatus = "warning";
    }
  }

  const actionToken = createActionToken("create_session", identity.orgId, identity.userId, params as any);

  const blocks = buildCreateSessionPreview({
    sessionType: params.sessionType ?? "Session",
    date: params.startAt!.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    time: params.startAt!.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    timezone: "Local",
    coachName: params.coachId ?? "Selected Coach",
    athleteCount: params.athleteIds?.length ?? 0,
    location: params.location,
    conflictStatus,
    requiresApproval: false,
    actionToken,
  });

  return { blocks, ephemeral: true, actionToken };
}

// ─── Execute session creation ─────────────────────────────────────────────────

export async function executeCreateSession(
  actionToken: string,
  identity: ResolvedIdentity,
): Promise<{ ok: boolean; bookingId?: string; error?: string }> {
  if (!isSchedulingEnabled()) return { ok: false, error: "Scheduling disabled" };
  if (!canSchedule(identity.role)) return { ok: false, error: "Insufficient permissions" };

  const token = consumeActionToken(actionToken);
  if (!token) return { ok: false, error: "Action token expired or invalid" };
  if (token.intent !== "create_session") return { ok: false, error: "Token intent mismatch" };
  if (token.orgId !== identity.orgId) return { ok: false, error: "Organization mismatch" };
  if (token.userId !== identity.userId) return { ok: false, error: "User mismatch" };

  const params = token.payload as CreateSessionParams;

  try {
    const booking = await storage.createBooking({
      clientId: identity.userId,
      coachId: params.coachId!,
      serviceId: undefined as any,
      startAt: params.startAt!,
      endAt: new Date(params.startAt!.getTime() + (params.durationMinutes ?? 60) * 60 * 1000),
      status: "CONFIRMED",
      notes: params.notes ?? null,
      organizationId: identity.orgId,
      paymentMethod: null,
      priceCents: 0,
    } as any);

    invalidateActionToken(actionToken);
    return { ok: true, bookingId: booking.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Failed to create booking" };
  }
}

// ─── Reschedule preview ───────────────────────────────────────────────────────

export async function buildReschedulePreviewBlocks(
  identity: ResolvedIdentity,
  bookingId: string,
  newStartAt: Date,
  durationMinutes = 60,
): Promise<{ blocks: SlackBlock[]; ephemeral: boolean; actionToken?: string }> {
  if (!isSchedulingEnabled()) {
    return { blocks: buildErrorMessage("Scheduling via Slack is not enabled."), ephemeral: true };
  }
  if (!canSchedule(identity.role)) {
    return {
      blocks: buildErrorMessage("Your role does not have permission to reschedule sessions."),
      ephemeral: true,
    };
  }

  const booking = await storage.getBooking(bookingId);
  if (!booking) {
    return { blocks: buildErrorMessage("Session not found."), ephemeral: true };
  }

  // Org isolation — booking must belong to same org
  if ((booking as any).organizationId && (booking as any).organizationId !== identity.orgId) {
    return { blocks: buildErrorMessage("You do not have permission to modify this session."), ephemeral: true };
  }

  const newEnd = new Date(newStartAt.getTime() + durationMinutes * 60 * 1000);
  let conflictStatus: "none" | "warning" | "blocked" = "none";
  let coachAvailable = true;

  if (booking.coachId) {
    try {
      const conflicts = await storage.getOverlappingBookings(booking.coachId, newStartAt, newEnd, bookingId);
      if (conflicts.length > 0) {
        conflictStatus = "warning";
        coachAvailable = false;
      }
    } catch {
      conflictStatus = "warning";
    }
  }

  const actionToken = createActionToken("reschedule_session", identity.orgId, identity.userId, {
    bookingId,
    newStartAt: newStartAt.toISOString(),
    newEndAt: newEnd.toISOString(),
  });

  const participants = await storage.getBookingParticipants(bookingId);

  const blocks = buildReschedulePreview({
    bookingId,
    sessionType: "Session",
    currentDate: booking.startAt
      ? new Date(booking.startAt).toLocaleDateString("en-US")
      : "Unknown",
    currentTime: booking.startAt
      ? new Date(booking.startAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : "Unknown",
    proposedDate: newStartAt.toLocaleDateString("en-US"),
    proposedTime: newStartAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    timezone: "Local",
    coachAvailable,
    conflictStatus,
    affectedParticipants: participants.length,
    actionToken,
  });

  return { blocks, ephemeral: true, actionToken };
}

export async function executeReschedule(
  actionToken: string,
  identity: ResolvedIdentity,
): Promise<{ ok: boolean; bookingId?: string; error?: string }> {
  if (!isSchedulingEnabled()) return { ok: false, error: "Scheduling disabled" };
  if (!canSchedule(identity.role)) return { ok: false, error: "Insufficient permissions" };

  const token = consumeActionToken(actionToken);
  if (!token) return { ok: false, error: "Action token expired or invalid" };
  if (token.intent !== "reschedule_session") return { ok: false, error: "Token intent mismatch" };
  if (token.orgId !== identity.orgId) return { ok: false, error: "Organization mismatch" };
  if (token.userId !== identity.userId) return { ok: false, error: "User mismatch" };

  const { bookingId, newStartAt, newEndAt } = token.payload as {
    bookingId: string;
    newStartAt: string;
    newEndAt: string;
  };

  try {
    await storage.updateBooking(bookingId, {
      startAt: new Date(newStartAt),
      endAt: new Date(newEndAt),
    });
    await storage.updateBookingStatus(bookingId, "RESCHEDULED");

    invalidateActionToken(actionToken);
    return { ok: true, bookingId };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Failed to reschedule" };
  }
}

// ─── Cancel session preview ───────────────────────────────────────────────────

export async function buildCancelSessionPreviewBlocks(
  identity: ResolvedIdentity,
  bookingId: string,
  reasonCategory = "Operational change",
): Promise<{ blocks: SlackBlock[]; ephemeral: boolean; actionToken?: string }> {
  if (!isSchedulingEnabled()) {
    return { blocks: buildErrorMessage("Scheduling via Slack is not enabled."), ephemeral: true };
  }
  if (!canSchedule(identity.role)) {
    return {
      blocks: buildErrorMessage("Your role does not have permission to cancel sessions."),
      ephemeral: true,
    };
  }

  const booking = await storage.getBooking(bookingId);
  if (!booking) {
    return { blocks: buildErrorMessage("Session not found."), ephemeral: true };
  }

  if ((booking as any).organizationId && (booking as any).organizationId !== identity.orgId) {
    return { blocks: buildErrorMessage("You do not have permission to cancel this session."), ephemeral: true };
  }

  if (booking.status === "CANCELLED") {
    return { blocks: buildErrorMessage("This session is already cancelled."), ephemeral: true };
  }

  const participants = await storage.getBookingParticipants(bookingId);

  const coachName =
    (booking as any).coach?.user
      ? `${(booking as any).coach.user.firstName ?? ""} ${(booking as any).coach.user.lastName ?? ""}`.trim()
      : "Assigned Coach";

  const actionToken = createActionToken("cancel_session", identity.orgId, identity.userId, {
    bookingId,
    reasonCategory,
  });

  const blocks = buildCancellationPreview({
    bookingId,
    sessionType: "Session",
    date: booking.startAt
      ? new Date(booking.startAt).toLocaleDateString("en-US")
      : "Unknown",
    time: booking.startAt
      ? new Date(booking.startAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : "Unknown",
    coachName,
    participantCount: participants.length,
    reasonCategory,
    actionToken,
  });

  return { blocks, ephemeral: true, actionToken };
}

export async function executeCancelSession(
  actionToken: string,
  identity: ResolvedIdentity,
): Promise<{ ok: boolean; bookingId?: string; error?: string }> {
  if (!isSchedulingEnabled()) return { ok: false, error: "Scheduling disabled" };
  if (!canSchedule(identity.role)) return { ok: false, error: "Insufficient permissions" };

  const token = consumeActionToken(actionToken);
  if (!token) return { ok: false, error: "Action token expired or invalid" };
  if (token.intent !== "cancel_session") return { ok: false, error: "Token intent mismatch" };
  if (token.orgId !== identity.orgId) return { ok: false, error: "Organization mismatch" };
  if (token.userId !== identity.userId) return { ok: false, error: "User mismatch" };

  const { bookingId } = token.payload as { bookingId: string };

  try {
    const updated = await storage.updateBookingStatus(bookingId, "CANCELLED");
    if (!updated) return { ok: false, error: "Session not found" };
    invalidateActionToken(actionToken);
    return { ok: true, bookingId };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Failed to cancel session" };
  }
}

// ─── Find upcoming sessions (for disambiguation) ──────────────────────────────

export async function findSessionsForUser(
  orgId: string,
  searchText: string,
  limit = 5,
): Promise<{ id: string; label: string }[]> {
  try {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const bookings = await storage.getBookingsByDateRangeForOrg(orgId, now, nextWeek);

    const lower = searchText.toLowerCase();
    const matches = bookings
      .filter((b) => {
        const coachName = (b as any).coach?.user
          ? `${(b as any).coach.user.firstName ?? ""} ${(b as any).coach.user.lastName ?? ""}`.toLowerCase()
          : "";
        const clientName = (b as any).client
          ? `${(b as any).client.firstName ?? ""} ${(b as any).client.lastName ?? ""}`.toLowerCase()
          : "";
        return coachName.includes(lower) || clientName.includes(lower);
      })
      .slice(0, limit);

    return matches.map((b) => ({
      id: b.id,
      label: `${(b as any).service?.name ?? "Session"} — ${
        b.startAt
          ? new Date(b.startAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
          : "Unknown date"
      }`,
    }));
  } catch {
    return [];
  }
}
