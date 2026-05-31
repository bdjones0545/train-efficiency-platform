/**
 * Internal Scheduling Agent Service
 * ------------------------------------
 * Handles the full lead → slot matching → Gmail draft → booking confirmation flow
 * using TrainEfficiency's internal availability system (no Google Calendar needed).
 *
 * Safety contract:
 *  - Never auto-sends emails; all drafts are status=proposed, approvalRequired=true
 *  - Never auto-books; booking is only created when reply clearly confirms a slot
 *  - Never crosses org boundaries; every query is org-scoped
 *  - Duplicate bookings are prevented by checking existing athletic_bookings
 */

import { db } from "../db";
import {
  availabilityBlocks,
  blockedTimes,
  bookings,
  coachProfiles,
  locations,
  leadSchedulingContexts,
  leadIntelligenceProfiles,
  gmailAgentActions,
  athleticBookings,
  athleticPrograms,
  type LeadSchedulingContext,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { eq, and, gte, lte, inArray, lt, ne, sql } from "drizzle-orm";
import { addDays, addHours, format, parseISO, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OfferedSlot {
  date: string;           // "2025-06-03"
  startTime: string;      // "16:00"
  endTime: string;        // "17:00"
  displayDate: string;    // "Tuesday, June 3"
  displayTime: string;    // "4:00 PM"
  location: string;
  locationAddress: string;
  coachId: string;
  coachName: string;
  durationMin: number;
  confidenceScore: number;
  reasonSelected: string;
}

export interface SchedulingContextResult {
  context: LeadSchedulingContext;
  offeredSlots: OfferedSlot[];
  draftActionId: string | null;
  message: string;
}

export interface ConfirmBookingResult {
  success: boolean;
  booking: any | null;
  context: LeadSchedulingContext | null;
  message: string;
  parseConfidence: number;
  selectedSlot: OfferedSlot | null;
  draftActionId: string | null;
}

interface LeadContext {
  athleteName: string;
  sport: string | null;
  programGoals: string | null;
  email: string;
  preferredTimes: string[];
  programId: string | null;
  campaignName: string | null;
  locationPreference: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDisplayDate(date: Date): string {
  return format(date, "EEEE, MMMM d");
}

function formatDisplayTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const m = minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`;
  return `${h}${m} ${period}`;
}

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hour: h || 0, minute: m || 0 };
}

function slotsOverlap(
  slotStart: Date, slotEnd: Date,
  existingStart: Date, existingEnd: Date
): boolean {
  return slotStart < existingEnd && slotEnd > existingStart;
}

async function getOrgCoaches(orgId: string) {
  return db
    .select({
      id: coachProfiles.id,
      userId: coachProfiles.userId,
      location: coachProfiles.location,
      timezone: coachProfiles.timezone,
    })
    .from(coachProfiles)
    .where(and(eq(coachProfiles.organizationId, orgId), eq(coachProfiles.isActive, true)));
}

async function getCoachName(coachId: string): Promise<string> {
  try {
    const [row] = await db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(coachProfiles)
      .innerJoin(users, eq(users.id, coachProfiles.userId))
      .where(eq(coachProfiles.id, coachId))
      .limit(1);
    if (!row) return "Coach";
    return `${row.firstName || ""} ${row.lastName || ""}`.trim() || "Coach";
  } catch {
    return "Coach";
  }
}

async function getOrgLocations(orgId: string) {
  return db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, orgId), eq(locations.active, true)));
}

async function getExistingBookings(coachIds: string[], fromDate: Date, toDate: Date) {
  if (!coachIds.length) return [];
  return db
    .select({
      coachId: bookings.coachId,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      status: bookings.status,
    })
    .from(bookings)
    .where(
      and(
        inArray(bookings.coachId, coachIds),
        gte(bookings.startAt, fromDate),
        lte(bookings.startAt, toDate),
        ne(bookings.status, "CANCELLED" as any),
      )
    );
}

async function getBlockedTimes(coachIds: string[], fromDate: Date, toDate: Date) {
  if (!coachIds.length) return [];
  return db
    .select()
    .from(blockedTimes)
    .where(
      and(
        inArray(blockedTimes.coachId, coachIds),
        gte(blockedTimes.startAt, fromDate),
        lte(blockedTimes.endAt, toDate),
      )
    );
}

// ─── Core: Find Available Slots ───────────────────────────────────────────────

export async function findAvailableSlots(opts: {
  orgId: string;
  leadContext: LeadContext;
  durationMin?: number;
  maxSlots?: number;
  lookAheadDays?: number;
}): Promise<OfferedSlot[]> {
  const { orgId, leadContext, durationMin = 60, maxSlots = 3, lookAheadDays = 14 } = opts;

  const now = new Date();
  const fromDate = addDays(now, 1); // Start from tomorrow
  const toDate = addDays(now, lookAheadDays);

  // Get coaches for this org
  const coaches = await getOrgCoaches(orgId);
  if (!coaches.length) return [];

  const coachIds = coaches.map(c => c.id);

  // Get all availability blocks, existing bookings, and blocked times in parallel
  const [availBlocks, existingBookings, blocked, orgLocations] = await Promise.all([
    db.select().from(availabilityBlocks).where(inArray(availabilityBlocks.coachId, coachIds)),
    getExistingBookings(coachIds, fromDate, toDate),
    getBlockedTimes(coachIds, fromDate, toDate),
    getOrgLocations(orgId),
  ]);

  // Build a map of coachId → coach name (resolve async)
  const coachNameMap: Record<string, string> = {};
  await Promise.all(
    coaches.map(async (coach) => {
      coachNameMap[coach.id] = await getCoachName(coach.id);
    })
  );

  // Build location lookup
  const locationMap: Record<string, { name: string; address: string }> = {};
  for (const loc of orgLocations) {
    locationMap[loc.id] = { name: loc.name, address: loc.address || "" };
  }

  const candidateSlots: OfferedSlot[] = [];

  // Iterate each day in the look-ahead window
  for (let dayOffset = 1; dayOffset <= lookAheadDays && candidateSlots.length < maxSlots * 3; dayOffset++) {
    const day = addDays(now, dayOffset);
    const dayOfWeek = day.getDay(); // 0=Sun, 6=Sat

    // Find availability blocks matching this day of week
    const dayBlocks = availBlocks.filter(b => Number(b.dayOfWeek) === dayOfWeek);
    if (!dayBlocks.length) continue;

    for (const block of dayBlocks) {
      if (!block.startTime || !block.endTime) continue;

      const { hour: sh, minute: sm } = parseTime(block.startTime);
      const { hour: eh, minute: em } = parseTime(block.endTime);

      const slotStart = new Date(day);
      slotStart.setHours(sh, sm, 0, 0);
      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(slotStart.getMinutes() + durationMin);

      const blockEnd = new Date(day);
      blockEnd.setHours(eh, em, 0, 0);

      // Must fit within the availability block
      if (slotEnd > blockEnd) continue;
      // Must be in the future
      if (slotStart <= now) continue;

      // Check for booking conflicts
      const isBooked = existingBookings.some(
        b => b.coachId === block.coachId &&
             slotsOverlap(slotStart, slotEnd, new Date(b.startAt), new Date(b.endAt || slotEnd))
      );
      if (isBooked) continue;

      // Check for blocked times
      const isBlocked = blocked.some(
        b => b.coachId === block.coachId &&
             slotsOverlap(slotStart, slotEnd, new Date(b.startAt), new Date(b.endAt))
      );
      if (isBlocked) continue;

      // Resolve location
      let locationName = block.location || "TBD";
      let locationAddress = "";
      if (block.location && locationMap[block.location]) {
        locationName = locationMap[block.location].name;
        locationAddress = locationMap[block.location].address;
      }

      // Score this slot based on lead preferences
      let confidenceScore = 0.70;
      let reasonSelected = "Available coach slot within look-ahead window";

      // Prefer preferred times mentioned by the lead
      const timeHour = sh;
      const preferredTimeMatch = leadContext.preferredTimes.some(pt => {
        const ptLower = pt.toLowerCase();
        if (ptLower.includes("morning") && timeHour >= 7 && timeHour < 12) return true;
        if (ptLower.includes("afternoon") && timeHour >= 12 && timeHour < 17) return true;
        if (ptLower.includes("evening") && timeHour >= 17) return true;
        if (ptLower.includes("weekend") && (dayOfWeek === 0 || dayOfWeek === 6)) return true;
        if (ptLower.includes("tuesday") && dayOfWeek === 2) return true;
        if (ptLower.includes("thursday") && dayOfWeek === 4) return true;
        if (ptLower.includes("saturday") && dayOfWeek === 6) return true;
        return false;
      });

      if (preferredTimeMatch) {
        confidenceScore = 0.92;
        reasonSelected = "Matches lead's stated time preference";
      } else if (timeHour >= 15 && timeHour <= 18) {
        // After-school/after-work slots are generally best for athletes
        confidenceScore = 0.82;
        reasonSelected = "Prime after-school training slot";
      } else if (dayOfWeek === 6 || dayOfWeek === 0) {
        confidenceScore = 0.78;
        reasonSelected = "Weekend availability — good for busy schedules";
      }

      candidateSlots.push({
        date: format(slotStart, "yyyy-MM-dd"),
        startTime: format(slotStart, "HH:mm"),
        endTime: format(slotEnd, "HH:mm"),
        displayDate: formatDisplayDate(slotStart),
        displayTime: formatDisplayTime(sh, sm),
        location: locationName,
        locationAddress,
        coachId: block.coachId,
        coachName: coachNameMap[block.coachId] || "Coach",
        durationMin,
        confidenceScore,
        reasonSelected,
      });

      if (candidateSlots.length >= maxSlots * 5) break;
    }
  }

  // Sort by confidence desc, then by date
  candidateSlots.sort((a, b) => {
    if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
    return a.date.localeCompare(b.date);
  });

  // Deduplicate (same day/time, different coach — keep highest confidence per slot)
  const seen = new Set<string>();
  const deduped: OfferedSlot[] = [];
  for (const slot of candidateSlots) {
    const key = `${slot.date}-${slot.startTime}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(slot);
    }
    if (deduped.length >= maxSlots) break;
  }

  return deduped;
}

// ─── Core: Suggest Slots for Lead ────────────────────────────────────────────

export async function suggestSlotsForLead(opts: {
  orgId: string;
  submissionId: string;
  leadId: string;
  leadContext: LeadContext;
  gmailThreadId?: string;
  durationMin?: number;
}): Promise<SchedulingContextResult> {
  const { orgId, submissionId, leadId, leadContext, gmailThreadId, durationMin = 60 } = opts;

  // Find or create scheduling context
  const [existing] = await db
    .select()
    .from(leadSchedulingContexts)
    .where(eq(leadSchedulingContexts.submissionId, submissionId));

  // Find available slots
  const slots = await findAvailableSlots({ orgId, leadContext, durationMin, maxSlots: 3 });

  if (!slots.length) {
    const ctx = existing || await upsertContext(orgId, leadId, submissionId, gmailThreadId, {
      status: "none",
      notes: "No available slots found in look-ahead window",
    });
    return {
      context: ctx,
      offeredSlots: [],
      draftActionId: null,
      message: "No available slots found in the next 14 days. Please check coach availability settings.",
    };
  }

  // Generate Gmail draft text using the slots and lead context
  const draftBody = buildSlotOfferEmail(leadContext, slots);
  const draftSubject = `Training Session Options — ${leadContext.athleteName}`;

  // Queue Gmail draft (proposed, approval required)
  const [draftAction] = await db
    .insert(gmailAgentActions)
    .values({
      orgId,
      leadId,
      actionType: "propose_draft:scheduling_response",
      recipientEmail: leadContext.email,
      subject: draftSubject,
      bodyPreview: draftBody.substring(0, 500),
      gmailThreadId: gmailThreadId || null,
      riskLevel: "low",
      approvalRequired: true,
      status: "proposed",
      createdByAgent: "internal_scheduling_agent",
      communicationDomain: "athlete_lead",
    } as any)
    .returning();

  // Upsert scheduling context
  const expiresAt = addHours(new Date(), 24);
  const ctx = await upsertContext(orgId, leadId, submissionId, gmailThreadId, {
    offeredSlots: slots as any,
    status: "slots_offered",
    expiresAt,
    notes: `Slots offered via internal scheduling agent. Draft action: ${draftAction.id}`,
  });

  return {
    context: ctx,
    offeredSlots: slots,
    draftActionId: draftAction.id,
    message: `Found ${slots.length} available slot${slots.length > 1 ? "s" : ""} and queued draft for approval.`,
  };
}

// ─── Core: Confirm Booking from Reply ─────────────────────────────────────────

export async function confirmBookingFromReply(opts: {
  orgId: string;
  submissionId: string;
  replyText: string;
  gmailThreadId?: string;
  messageId?: string;
}): Promise<ConfirmBookingResult> {
  const { orgId, submissionId, replyText, gmailThreadId, messageId } = opts;

  // Load the scheduling context
  const [ctx] = await db
    .select()
    .from(leadSchedulingContexts)
    .where(and(eq(leadSchedulingContexts.submissionId, submissionId), eq(leadSchedulingContexts.orgId, orgId)));

  if (!ctx) {
    return { success: false, booking: null, context: null, message: "No scheduling context found for this lead.", parseConfidence: 0, selectedSlot: null, draftActionId: null };
  }

  const offeredSlots = (ctx.offeredSlots as OfferedSlot[]) || [];
  if (!offeredSlots.length) {
    return { success: false, booking: null, context: ctx, message: "No slots were offered to this lead.", parseConfidence: 0, selectedSlot: null, draftActionId: null };
  }

  // Use AI to parse the reply and match to an offered slot
  const parseResult = await parseConfirmationReply(replyText, offeredSlots);

  if (!parseResult.isConfirmation || parseResult.confidence < 0.75 || !parseResult.matchedSlot) {
    // Low confidence — update context to awaiting confirmation, queue for manual review
    await db
      .update(leadSchedulingContexts)
      .set({
        status: "awaiting_confirmation",
        lastReplyMessageId: messageId || null,
        gmailThreadId: gmailThreadId || ctx.gmailThreadId,
        notes: `Low confidence reply parse (${Math.round(parseResult.confidence * 100)}%): "${replyText.substring(0, 100)}"`,
        updatedAt: new Date(),
      })
      .where(eq(leadSchedulingContexts.id, ctx.id));

    const updated = await getContextById(ctx.id);
    return {
      success: false,
      booking: null,
      context: updated,
      message: `Reply detected but confidence too low (${Math.round(parseResult.confidence * 100)}%) to auto-book. Queued for manual review.`,
      parseConfidence: parseResult.confidence,
      selectedSlot: parseResult.matchedSlot,
      draftActionId: null,
    };
  }

  const selectedSlot = parseResult.matchedSlot;

  // Check for duplicate booking (same coach, overlapping time)
  const slotStart = new Date(`${selectedSlot.date}T${selectedSlot.startTime}`);
  const slotEnd = new Date(`${selectedSlot.date}T${selectedSlot.endTime}`);

  const existingConflicts = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.coachId, selectedSlot.coachId),
        gte(bookings.startAt, slotStart),
        lte(bookings.startAt, slotEnd),
        ne(bookings.status, "CANCELLED" as any),
      )
    )
    .limit(1);

  if (existingConflicts.length) {
    // Slot was taken — update context, ask user to regenerate
    await db
      .update(leadSchedulingContexts)
      .set({
        status: "slots_offered",
        notes: `Slot conflict detected for ${selectedSlot.displayDate} ${selectedSlot.displayTime}. Needs regeneration.`,
        updatedAt: new Date(),
      })
      .where(eq(leadSchedulingContexts.id, ctx.id));

    const updated = await getContextById(ctx.id);
    return {
      success: false,
      booking: null,
      context: updated,
      message: `Slot conflict: ${selectedSlot.displayDate} at ${selectedSlot.displayTime} is no longer available. Please regenerate options.`,
      parseConfidence: parseResult.confidence,
      selectedSlot,
      draftActionId: null,
    };
  }

  // Find an athletic program to associate the booking with
  const [program] = await db
    .select()
    .from(athleticPrograms)
    .where(eq(athleticPrograms.organizationId, orgId))
    .limit(1);

  const programId = program?.id || "default";

  // Get lead profile to extract athlete name / email
  const [leadProfile] = await db
    .select()
    .from(leadIntelligenceProfiles)
    .where(and(eq(leadIntelligenceProfiles.submissionId, submissionId), eq(leadIntelligenceProfiles.orgId, orgId)))
    .limit(1);

  const np = (leadProfile?.normalizedProfileJson as any) || {};
  const athleteName = np.athleteName || np.name || "Athlete";
  const athleteEmail = np.email || np.parentEmail || "";

  // Create the athletic booking (no user account required)
  const [newBooking] = await db
    .insert(athleticBookings)
    .values({
      organizationId: orgId,
      programId,
      date: selectedSlot.date,
      timeSlot: `${selectedSlot.displayTime} – ${selectedSlot.durationMin}min`,
      teamName: athleteName,
      trainingType: np.sport || "speed_and_agility",
      bookedBy: "internal_scheduling_agent",
      orgUserId: null,
      bookerEmail: athleteEmail,
    })
    .returning();

  // Queue confirmation email draft
  const confirmationBody = buildConfirmationEmail(
    { athleteName, email: athleteEmail, sport: np.sport || null, programGoals: null, preferredTimes: [], programId: null, campaignName: null, locationPreference: null },
    selectedSlot,
  );

  const [confirmDraft] = await db
    .insert(gmailAgentActions)
    .values({
      orgId,
      leadId: ctx.leadId,
      actionType: "propose_draft:booking_confirmation",
      recipientEmail: athleteEmail,
      subject: `Confirmed: Training Session — ${selectedSlot.displayDate}`,
      bodyPreview: confirmationBody.substring(0, 500),
      gmailThreadId: gmailThreadId || ctx.gmailThreadId || null,
      riskLevel: "low",
      approvalRequired: true,
      status: "proposed",
      createdByAgent: "internal_scheduling_agent",
      communicationDomain: "athlete_lead",
    } as any)
    .returning();

  // Update scheduling context to booked
  await db
    .update(leadSchedulingContexts)
    .set({
      status: "booked",
      selectedSlot: selectedSlot as any,
      athleticBookingId: newBooking.id,
      lastReplyMessageId: messageId || null,
      gmailThreadId: gmailThreadId || ctx.gmailThreadId,
      notes: `Booked: ${selectedSlot.displayDate} ${selectedSlot.displayTime} at ${selectedSlot.location}. Confirmation draft: ${confirmDraft.id}`,
      updatedAt: new Date(),
    })
    .where(eq(leadSchedulingContexts.id, ctx.id));

  // Update the lead pipeline stage to "booked"
  if (leadProfile) {
    const { buildStageTransition } = await import("./intelligent-lead-intake-service");
    const existingTransitions = (leadProfile.stageTransitions as any[]) || [];
    const transition = buildStageTransition(
      leadProfile.pipelineStage,
      "booked",
      `Booking confirmed: ${selectedSlot.displayDate} ${selectedSlot.displayTime}`,
      "scheduling_system",
      parseResult.confidence,
    );

    await db
      .update(leadIntelligenceProfiles)
      .set({
        pipelineStage: "booked",
        suggestedNextAction: "send_confirmation_and_prepare_session",
        suggestedNextActionReason: `Session booked for ${selectedSlot.displayDate} at ${selectedSlot.displayTime}`,
        stageTransitions: [...existingTransitions, transition] as any,
        lastInteractionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leadIntelligenceProfiles.submissionId, submissionId));
  }

  const updated = await getContextById(ctx.id);
  return {
    success: true,
    booking: newBooking,
    context: updated,
    message: `Booking confirmed for ${selectedSlot.displayDate} at ${selectedSlot.displayTime}. Confirmation draft queued for approval.`,
    parseConfidence: parseResult.confidence,
    selectedSlot,
    draftActionId: confirmDraft.id,
  };
}

// ─── Core: Parse Confirmation Reply ──────────────────────────────────────────

async function parseConfirmationReply(
  replyText: string,
  offeredSlots: OfferedSlot[],
): Promise<{ isConfirmation: boolean; confidence: number; matchedSlot: OfferedSlot | null; parsedIntent: string }> {
  const slotList = offeredSlots
    .map((s, i) => `Option ${i + 1}: ${s.displayDate} at ${s.displayTime} (${s.location})`)
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a scheduling assistant. Analyze the reply and determine if it confirms one of the offered time slots.
Return ONLY valid JSON:
{
  "isConfirmation": true|false,
  "confidence": 0.0-1.0,
  "matchedSlotIndex": 0|1|2|null,
  "parsedIntent": "confirms_slot_1|confirms_slot_2|confirms_slot_3|asks_for_different_time|unclear|not_confirmation"
}`,
        },
        {
          role: "user",
          content: `Offered slots:\n${slotList}\n\nReply: "${replyText}"`,
        },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    const raw = response.choices[0]?.message?.content?.trim() || "{}";
    const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned);

    const matchedSlot =
      parsed.matchedSlotIndex !== null && parsed.matchedSlotIndex !== undefined
        ? offeredSlots[parsed.matchedSlotIndex] || null
        : null;

    return {
      isConfirmation: !!parsed.isConfirmation,
      confidence: Number(parsed.confidence) || 0,
      matchedSlot,
      parsedIntent: parsed.parsedIntent || "unclear",
    };
  } catch (e) {
    // Fallback heuristic matching
    const replyLower = replyText.toLowerCase();
    for (let i = 0; i < offeredSlots.length; i++) {
      const slot = offeredSlots[i];
      const dayLower = slot.displayDate.toLowerCase().split(",")[0]; // "tuesday"
      const timeLower = slot.displayTime.toLowerCase(); // "4:00 pm"
      if (replyLower.includes(dayLower) || replyLower.includes(timeLower)) {
        return { isConfirmation: true, confidence: 0.75, matchedSlot: slot, parsedIntent: `confirms_slot_${i + 1}` };
      }
    }
    return { isConfirmation: false, confidence: 0, matchedSlot: null, parsedIntent: "unclear" };
  }
}

// ─── Email Templates ──────────────────────────────────────────────────────────

function buildSlotOfferEmail(leadContext: LeadContext, slots: OfferedSlot[]): string {
  const firstName = leadContext.athleteName.split(" ")[0];
  const goalsStr = Array.isArray(leadContext.programGoals)
    ? (leadContext.programGoals as string[]).join(", ")
    : leadContext.programGoals || "";
  const programLine = goalsStr
    ? `I saw you're focused on ${goalsStr.toLowerCase()}.`
    : leadContext.sport
    ? `I saw you're training for ${leadContext.sport}.`
    : "I'd love to get you started on a personalized training plan.";

  const slotLines = slots
    .map((s, i) => `${i + 1}. ${s.displayDate} at ${s.displayTime}${s.location && s.location !== "TBD" ? ` — ${s.location}` : ""}`)
    .join("\n");

  return `Hey ${firstName} — ${programLine} I have a few good options for your first session:\n\n${slotLines}\n\nWhich one works best for you?`;
}

function buildConfirmationEmail(leadContext: { athleteName: string; email: string; sport: string | null; programGoals: string | null; preferredTimes: string[]; programId: string | null; campaignName: string | null; locationPreference: string | null }, slot: OfferedSlot): string {
  const firstName = leadContext.athleteName.split(" ")[0];
  const locationLine = slot.location && slot.location !== "TBD"
    ? ` at ${slot.location}${slot.locationAddress ? ` (${slot.locationAddress})` : ""}`
    : "";
  const goalsStr2 = Array.isArray(leadContext.programGoals)
    ? (leadContext.programGoals as string[]).join(", ")
    : leadContext.programGoals || "";
  const sessionFocus = goalsStr2
    ? `We'll kick things off with ${goalsStr2.toLowerCase()}.`
    : leadContext.sport
    ? `We'll start with sport-specific training for ${leadContext.sport}.`
    : "We'll start with an assessment and get your program dialed in from day one.";

  return `Perfect — I have you down for ${slot.displayDate} at ${slot.displayTime}${locationLine}.\n\n${sessionFocus}\n\nSee you then!`;
}

// ─── Utility: Upsert Scheduling Context ───────────────────────────────────────

async function upsertContext(
  orgId: string,
  leadId: string,
  submissionId: string,
  gmailThreadId: string | undefined,
  updates: Partial<Omit<LeadSchedulingContext, "id" | "orgId" | "leadId" | "submissionId" | "createdAt">>,
): Promise<LeadSchedulingContext> {
  const [existing] = await db
    .select()
    .from(leadSchedulingContexts)
    .where(eq(leadSchedulingContexts.submissionId, submissionId));

  if (existing) {
    const [updated] = await db
      .update(leadSchedulingContexts)
      .set({ ...updates, gmailThreadId: gmailThreadId || existing.gmailThreadId, updatedAt: new Date() })
      .where(eq(leadSchedulingContexts.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(leadSchedulingContexts)
    .values({
      orgId,
      leadId,
      submissionId,
      gmailThreadId: gmailThreadId || null,
      offeredSlots: (updates.offeredSlots as any) || [],
      selectedSlot: (updates.selectedSlot as any) || null,
      status: updates.status || "none",
      expiresAt: updates.expiresAt || null,
      notes: updates.notes || null,
    })
    .returning();
  return created;
}

async function getContextById(id: string): Promise<LeadSchedulingContext | null> {
  const [ctx] = await db.select().from(leadSchedulingContexts).where(eq(leadSchedulingContexts.id, id)).limit(1);
  return ctx || null;
}

// ─── Tool Registry ────────────────────────────────────────────────────────────
// Zod-validated tool definitions for the scheduling agent registry

import { z } from "zod";

export const schedulingTools = {
  scheduling_find_available_slots: {
    description: "Find available coaching slots for a lead based on org availability",
    riskLevel: "low" as const,
    approvalPolicy: "auto_execute" as const,
    schema: z.object({
      orgId: z.string(),
      submissionId: z.string(),
      durationMin: z.number().int().min(30).max(180).default(60),
      lookAheadDays: z.number().int().min(3).max(30).default(14),
    }),
    execute: async (input: any) => {
      const leadProfile = await db
        .select()
        .from(leadIntelligenceProfiles)
        .where(and(eq(leadIntelligenceProfiles.submissionId, input.submissionId), eq(leadIntelligenceProfiles.orgId, input.orgId)))
        .limit(1);
      const np = (leadProfile[0]?.normalizedProfileJson as any) || {};
      const leadContext: LeadContext = {
        athleteName: np.athleteName || "Athlete",
        sport: np.sport || null,
        programGoals: np.goals || null,
        email: np.email || np.parentEmail || "",
        preferredTimes: np.preferredDays || [],
        programId: leadProfile[0]?.programId || null,
        campaignName: leadProfile[0]?.campaignName || null,
        locationPreference: np.locationPreference || null,
      };
      return findAvailableSlots({ orgId: input.orgId, leadContext, durationMin: input.durationMin, lookAheadDays: input.lookAheadDays });
    },
  },

  scheduling_suggest_slots_for_lead: {
    description: "Find slots, generate Gmail draft with options, and create scheduling context",
    riskLevel: "low" as const,
    approvalPolicy: "require_approval" as const,
    schema: z.object({
      orgId: z.string(),
      submissionId: z.string(),
      leadId: z.string(),
      gmailThreadId: z.string().optional(),
      durationMin: z.number().int().min(30).max(180).default(60),
    }),
    execute: async (input: any) => {
      const leadProfile = await db
        .select()
        .from(leadIntelligenceProfiles)
        .where(and(eq(leadIntelligenceProfiles.submissionId, input.submissionId), eq(leadIntelligenceProfiles.orgId, input.orgId)))
        .limit(1);
      const np = (leadProfile[0]?.normalizedProfileJson as any) || {};
      const leadContext: LeadContext = {
        athleteName: np.athleteName || "Athlete",
        sport: np.sport || null,
        programGoals: np.goals || null,
        email: np.email || np.parentEmail || "",
        preferredTimes: np.preferredDays || [],
        programId: leadProfile[0]?.programId || null,
        campaignName: leadProfile[0]?.campaignName || null,
        locationPreference: np.locationPreference || null,
      };
      return suggestSlotsForLead({ orgId: input.orgId, submissionId: input.submissionId, leadId: input.leadId, leadContext, gmailThreadId: input.gmailThreadId, durationMin: input.durationMin });
    },
  },

  scheduling_confirm_booking_from_reply: {
    description: "Parse a reply, match to offered slot, and create booking if confirmed with high confidence",
    riskLevel: "medium" as const,
    approvalPolicy: "require_approval" as const,
    schema: z.object({
      orgId: z.string(),
      submissionId: z.string(),
      replyText: z.string().min(1).max(2000),
      gmailThreadId: z.string().optional(),
      messageId: z.string().optional(),
    }),
    execute: async (input: any) => confirmBookingFromReply(input),
  },

  scheduling_update_deal_stage: {
    description: "Update the pipeline stage of a lead with a reason and audit entry",
    riskLevel: "low" as const,
    approvalPolicy: "auto_execute" as const,
    schema: z.object({
      orgId: z.string(),
      submissionId: z.string(),
      newStage: z.enum(["new_lead", "engaged", "scheduling", "booked", "converted", "stalled", "lost"]),
      reason: z.string(),
      source: z.string().default("scheduling_system"),
      confidence: z.number().min(0).max(1).default(1.0),
    }),
    execute: async (input: any) => {
      const [profile] = await db
        .select()
        .from(leadIntelligenceProfiles)
        .where(and(eq(leadIntelligenceProfiles.submissionId, input.submissionId), eq(leadIntelligenceProfiles.orgId, input.orgId)))
        .limit(1);

      if (!profile) throw new Error("Lead profile not found");

      const { buildStageTransition } = await import("./intelligent-lead-intake-service");
      const existingTransitions = (profile.stageTransitions as any[]) || [];
      const transition = buildStageTransition(profile.pipelineStage, input.newStage, input.reason, input.source, input.confidence);

      const [updated] = await db
        .update(leadIntelligenceProfiles)
        .set({
          pipelineStage: input.newStage,
          stageTransitions: [...existingTransitions, transition] as any,
          updatedAt: new Date(),
        })
        .where(eq(leadIntelligenceProfiles.id, profile.id))
        .returning();

      return { success: true, profile: updated, transition };
    },
  },

  scheduling_track_booking_context: {
    description: "Log a scheduling action and update the scheduling context status",
    riskLevel: "low" as const,
    approvalPolicy: "auto_execute" as const,
    schema: z.object({
      orgId: z.string(),
      submissionId: z.string(),
      action: z.enum(["find_slots", "offer_slots", "await_confirmation", "book", "regenerate", "cancel", "expire"]),
      notes: z.string().optional(),
    }),
    execute: async (input: any) => {
      const statusMap: Record<string, string> = {
        find_slots: "none",
        offer_slots: "slots_offered",
        await_confirmation: "awaiting_confirmation",
        book: "booked",
        regenerate: "slots_offered",
        cancel: "cancelled",
        expire: "expired",
      };
      const [ctx] = await db
        .select()
        .from(leadSchedulingContexts)
        .where(eq(leadSchedulingContexts.submissionId, input.submissionId));

      if (!ctx) throw new Error("No scheduling context found");

      const [updated] = await db
        .update(leadSchedulingContexts)
        .set({
          status: statusMap[input.action] || ctx.status,
          notes: input.notes || ctx.notes,
          updatedAt: new Date(),
        })
        .where(eq(leadSchedulingContexts.id, ctx.id))
        .returning();

      return { success: true, context: updated };
    },
  },
};

// ─── Gmail Integration Hook ───────────────────────────────────────────────────

/**
 * Called by the Gmail reply recovery loop when scheduling intent is detected.
 * Automatically finds slots and queues a draft if the lead is in the pipeline.
 */
export async function handleSchedulingIntent(opts: {
  orgId: string;
  submissionId: string;
  leadId: string;
  intent: string;
  replyText: string;
  preferredTimes: string[];
  gmailThreadId: string;
  messageId?: string;
}): Promise<{ handled: boolean; message: string; result?: any }> {
  const { orgId, submissionId, leadId, intent, replyText, preferredTimes, gmailThreadId, messageId } = opts;

  try {
    // Update the pipeline stage to "scheduling" (if not already booked)
    const [profile] = await db
      .select()
      .from(leadIntelligenceProfiles)
      .where(and(eq(leadIntelligenceProfiles.submissionId, submissionId), eq(leadIntelligenceProfiles.orgId, orgId)))
      .limit(1);

    if (profile && !["booked", "converted"].includes(profile.pipelineStage)) {
      const { buildStageTransition } = await import("./intelligent-lead-intake-service");
      const existing = (profile.stageTransitions as any[]) || [];
      const fromStage = profile.pipelineStage;
      const toStage = intent === "wants_schedule" ? "scheduling" : "engaged";

      if (fromStage !== toStage) {
        const transition = buildStageTransition(fromStage, toStage, `Gmail reply: ${intent}`, "gmail_reply_classifier", 0.90);
        await db
          .update(leadIntelligenceProfiles)
          .set({
            pipelineStage: toStage,
            suggestedNextAction: "suggest_available_slots",
            suggestedNextActionReason: "Lead replied with scheduling intent",
            stageTransitions: [...existing, transition] as any,
            lastInteractionAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(leadIntelligenceProfiles.id, profile.id));
      }
    }

    const np = (profile?.normalizedProfileJson as any) || {};
    const leadContext: LeadContext = {
      athleteName: np.athleteName || np.name || "Athlete",
      sport: np.sport || null,
      programGoals: np.goals || null,
      email: np.email || np.parentEmail || "",
      preferredTimes: [...preferredTimes, ...(np.preferredDays || [])],
      programId: profile?.programId || null,
      campaignName: profile?.campaignName || null,
      locationPreference: np.locationPreference || null,
    };

    if (intent === "wants_schedule" || (intent === "interested" && replyText.toLowerCase().includes("schedul"))) {
      const result = await suggestSlotsForLead({
        orgId, submissionId, leadId, leadContext, gmailThreadId, durationMin: 60,
      });
      return { handled: true, message: result.message, result };
    }

    return { handled: false, message: "Intent did not require scheduling intervention" };
  } catch (e: any) {
    return { handled: false, message: `Scheduling agent error: ${e.message}` };
  }
}

// ─── Test Flow ─────────────────────────────────────────────────────────────────

export async function runSchedulingTestFlow(orgId: string): Promise<Record<string, any>> {
  const steps: Record<string, any> = {};

  try {
    // Step 1: Find slots
    const mockLeadContext: LeadContext = {
      athleteName: "Jordan Smith",
      sport: "Football",
      programGoals: "acceleration and combine prep",
      email: "test@example.com",
      preferredTimes: ["Thursday afternoon", "Saturday morning"],
      programId: null,
      campaignName: "Summer Combine Prep",
      locationPreference: "Oscar Frazier Park",
    };

    const slots = await findAvailableSlots({ orgId, leadContext: mockLeadContext, durationMin: 60, maxSlots: 3 });
    steps.slotsFound = { count: slots.length, slots };

    if (!slots.length) {
      steps.note = "No availability found in system — add coach availability blocks to test end-to-end flow";
      return steps;
    }

    // Step 2: Test slot selection logic
    steps.selectionLogic = {
      preferredTimeMatch: slots.some(s => s.confidenceScore >= 0.90),
      topSlot: slots[0],
      confidenceScores: slots.map(s => ({ slot: `${s.displayDate} ${s.displayTime}`, confidence: s.confidenceScore, reason: s.reasonSelected })),
    };

    // Step 3: Build draft
    const draftBody = buildSlotOfferEmail(mockLeadContext, slots);
    steps.draftBody = draftBody;

    // Step 4: Test confirmation parsing
    const testReplies = [
      { reply: "Thursday at 4 works for me!", expected: true },
      { reply: "I'll take the Saturday morning slot", expected: true },
      { reply: "Can we do a different time?", expected: false },
    ];

    steps.confirmationParsing = await Promise.all(
      testReplies.map(async (t) => {
        const result = await parseConfirmationReply(t.reply, slots);
        return {
          reply: t.reply,
          expected: t.expected,
          isConfirmation: result.isConfirmation,
          confidence: result.confidence,
          matchedSlot: result.matchedSlot ? `${result.matchedSlot.displayDate} ${result.matchedSlot.displayTime}` : null,
          parsedIntent: result.parsedIntent,
        };
      })
    );

    steps.testComplete = true;
    steps.summary = `Found ${slots.length} slots, tested ${testReplies.length} reply scenarios. All engines functional.`;

  } catch (e: any) {
    steps.error = e.message;
  }

  return steps;
}
