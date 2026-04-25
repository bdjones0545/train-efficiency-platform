import OpenAI from "openai";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { addDays, startOfWeek, format, addMinutes, startOfMonth, endOfMonth } from "date-fns";
import {
  createAgentAction,
  generateFollowUpActions,
  buildDailyActionQueue,
  buildScoredDailyActionQueue,
  getOperatorPerformanceMetrics,
  computeActionPerformanceProfile,
  getAutoModeStatus,
  setAutoMode,
  computeRevenueOptimizationPlan,
  getWeeklyLearningInsights,
  computeTimePerformanceProfile,
  getMessageVariationProfile,
  startCampaign,
  getActiveCampaigns,
  getAutoPilotDashboard,
  CAMPAIGN_TEMPLATES,
} from "./action-tracking";
import {
  computeClientResponseProfile,
  computeClientSegments,
  computeClientLtvScore,
  getStrategicRecommendations,
} from "./client-intelligence";
import {
  setWeeklyTargets,
  getWeeklyProgress,
  getGoalPerformanceSummary,
} from "./goal-tracking";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import {
  sendBookingConfirmationToClient,
  sendBookingNotificationToCoach,
  sendSchedulingInquiryEmail,
  type OrgBranding,
} from "./email";

async function getOrgBranding(orgId: string | null | undefined): Promise<OrgBranding | undefined> {
  if (!orgId) return undefined;
  try {
    const org = await storage.getOrganizationById(orgId);
    if (!org) return undefined;
    return {
      name: org.name,
      emailPrimaryColor: org.emailPrimaryColor || undefined,
      emailSecondaryColor: org.emailSecondaryColor || undefined,
      ownerEmail: org.ownerEmail || undefined,
    };
  } catch {
    return undefined;
  }
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ─── Pending action store ─────────────────────────────────────────────────────
type GatedActionType =
  | "book_session"
  | "cancel_booking"
  | "reschedule_booking"
  | "coach_create_session"
  | "create_confirmed_recurring_sessions"
  | "send_scheduling_inquiry";

interface PendingAction {
  pendingActionId: string;
  userId: string | null;
  actionType: GatedActionType;
  normalizedArgs: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pendingActions = new Map<string, PendingAction>();

function purgeExpiredPending(): void {
  const now = new Date();
  pendingActions.forEach((a, id) => {
    if (a.expiresAt < now) pendingActions.delete(id);
  });
}

function createPendingAction(
  userId: string | null,
  actionType: GatedActionType,
  normalizedArgs: Record<string, unknown>
): PendingAction {
  purgeExpiredPending();
  const now = new Date();
  const argsKey = JSON.stringify(normalizedArgs);

  // Dedup: return existing non-expired action for same user + actionType + args
  let existingAction: PendingAction | undefined;
  pendingActions.forEach((a) => {
    if (
      !existingAction &&
      a.userId === userId &&
      a.actionType === actionType &&
      JSON.stringify(a.normalizedArgs) === argsKey &&
      a.expiresAt > now
    ) {
      existingAction = a;
    }
  });
  if (existingAction) return existingAction;

  // Max 5 active pending actions per user — delete oldest first
  const userEntries: [string, PendingAction][] = [];
  pendingActions.forEach((a, id) => {
    if (a.userId === userId) userEntries.push([id, a]);
  });
  userEntries.sort((x, y) => x[1].createdAt.getTime() - y[1].createdAt.getTime());
  while (userEntries.length >= 5) {
    const oldest = userEntries.shift()!;
    pendingActions.delete(oldest[0]);
  }

  const action: PendingAction = {
    pendingActionId: randomUUID(),
    userId,
    actionType,
    normalizedArgs,
    createdAt: now,
    expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
  };
  pendingActions.set(action.pendingActionId, action);
  return action;
}

function getPendingAction(id: string): PendingAction | undefined {
  const a = pendingActions.get(id);
  if (!a) return undefined;
  if (a.expiresAt < new Date()) { pendingActions.delete(id); return undefined; }
  return a;
}

function consumePendingAction(id: string): PendingAction | undefined {
  const a = getPendingAction(id);
  if (a) pendingActions.delete(id);
  return a;
}

function getPendingActionStatus(
  id: string
): { status: "found"; action: PendingAction } | { status: "expired" } | { status: "not_found" } {
  const a = pendingActions.get(id);
  if (!a) return { status: "not_found" };
  if (a.expiresAt < new Date()) {
    pendingActions.delete(id);
    return { status: "expired" };
  }
  return { status: "found", action: a };
}

function validatePendingAction(
  pending: PendingAction,
  userId: string | null,
  actionType: GatedActionType,
  args: Record<string, unknown>
): { valid: boolean; error?: string } {
  if (pending.actionType !== actionType)
    return { valid: false, error: "pendingActionId was created for a different action type. Preview the action again to generate a new one." };
  if (pending.userId !== userId)
    return { valid: false, error: "pendingActionId does not match the current user. Preview the action again." };
  const s = pending.normalizedArgs;
  if (actionType === "book_session") {
    if (s.coachId !== args.coachId || s.serviceId !== args.serviceId || s.startAt !== args.startAt)
      return { valid: false, error: "Booking details changed since preview. Preview the action again to generate a new pendingActionId." };
  } else if (actionType === "cancel_booking") {
    if (s.bookingId !== args.bookingId)
      return { valid: false, error: "Booking ID changed since preview. Preview the action again." };
  } else if (actionType === "reschedule_booking") {
    if (s.bookingId !== args.bookingId || s.newStartAt !== args.newStartAt)
      return { valid: false, error: "Reschedule details changed since preview. Preview the action again." };
  } else if (actionType === "coach_create_session") {
    if (s.coachId !== args.coachId || s.serviceId !== args.serviceId || s.startAt !== args.startAt)
      return { valid: false, error: "Session details changed since preview. Preview the action again." };
    if (s.clientId && s.clientId !== args.clientId)
      return { valid: false, error: "Client changed since preview. Preview the action again." };
  } else if (actionType === "create_confirmed_recurring_sessions") {
    if (s.clientId !== args.clientId || s.coachId !== args.coachId || s.serviceId !== args.serviceId)
      return { valid: false, error: "Recurring session details changed since preview. Preview the action again." };
    const sSlots = s.confirmedSlots as unknown[];
    const aSlots = args.confirmedSlots as unknown[];
    if (!sSlots || !aSlots || sSlots.length !== aSlots.length)
      return { valid: false, error: "Slot count changed since preview. Preview the action again." };
  } else if (actionType === "send_scheduling_inquiry") {
    if ((s.message as string)?.trim() !== (args.message as string)?.trim())
      return { valid: false, error: "Inquiry message changed since preview. Preview the action again." };
  }
  return { valid: true };
}
// ─────────────────────────────────────────────────────────────────────────────

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_coaches",
      description: "List all available coaches with their names, specialties, and IDs",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_services",
      description: "List all available services with pricing and duration",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_available_slots",
      description: "Get available time slots for a specific coach and service within a date range",
      parameters: {
        type: "object",
        properties: {
          coachId: { type: "string", description: "The coach's ID" },
          serviceId: { type: "string", description: "The service ID" },
          startDate: { type: "string", description: "Start date in YYYY-MM-DD format" },
          numDays: { type: "number", description: "Number of days to check (default 7, max 14)" },
        },
        required: ["coachId", "serviceId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_session",
      description: "Book a session for the current user. Use the two-call handshake: first call with confirmed: false to get a pendingActionId, present the summary to the user, then call again with confirmed: true and the pendingActionId after they confirm. Never invent a pendingActionId.",
      parameters: {
        type: "object",
        properties: {
          coachId: { type: "string", description: "The coach's ID" },
          serviceId: { type: "string", description: "The service ID" },
          startAt: { type: "string", description: "Session start time in ISO 8601 format" },
          endAt: { type: "string", description: "Session end time in ISO 8601 format" },
          confirmed: { type: "boolean", description: "Set to false on the first call to preview and get a pendingActionId. Set to true on the second call only after the user confirms." },
          pendingActionId: { type: "string", description: "Required when confirmed is true. Must be the exact pendingActionId returned by the previous call with confirmed: false. Never invent this value." },
        },
        required: ["coachId", "serviceId", "startAt", "endAt", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_bookings",
      description: "Get the current user's upcoming bookings",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description: "Cancel a specific booking by ID. Use the two-call handshake: first call with confirmed: false to get a pendingActionId, restate what will be cancelled to the user, then call again with confirmed: true and the pendingActionId after they confirm. Never invent a pendingActionId.",
      parameters: {
        type: "object",
        properties: {
          bookingId: { type: "string", description: "The booking ID to cancel" },
          confirmed: { type: "boolean", description: "Set to false on the first call to preview and get a pendingActionId. Set to true on the second call only after the user confirms." },
          pendingActionId: { type: "string", description: "Required when confirmed is true. Must be the exact pendingActionId returned by the previous call with confirmed: false. Never invent this value." },
        },
        required: ["bookingId", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_coach_schedule",
      description: "Get a coach's schedule/bookings for a date range (coach/admin only)",
      parameters: {
        type: "object",
        properties: {
          coachId: { type: "string", description: "The coach ID to view schedule for" },
          date: { type: "string", description: "Date in YYYY-MM-DD format (defaults to today)" },
        },
        required: ["coachId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_availability",
      description: "Set a recurring weekly availability block for a coach (coach/admin only)",
      parameters: {
        type: "object",
        properties: {
          coachId: { type: "string", description: "The coach ID" },
          dayOfWeek: { type: "number", description: "Day of week: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday" },
          startTime: { type: "string", description: "Start time in HH:MM format (24-hour)" },
          endTime: { type: "string", description: "End time in HH:MM format (24-hour)" },
        },
        required: ["coachId", "dayOfWeek", "startTime", "endTime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_availability",
      description: "Get a coach's current recurring availability blocks (coach/admin only)",
      parameters: {
        type: "object",
        properties: {
          coachId: { type: "string", description: "The coach ID" },
        },
        required: ["coachId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_availability",
      description: "Delete an availability block by ID (coach/admin only)",
      parameters: {
        type: "object",
        properties: {
          blockId: { type: "string", description: "The availability block ID to delete" },
        },
        required: ["blockId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "coach_create_session",
      description: "Create a session for a client (coach/admin only). Can specify an existing client by ID or create a walk-in by name. Use the two-call handshake: first call with confirmed: false to get a pendingActionId, restate all details to the coach, then call again with confirmed: true and the pendingActionId after they confirm. Never invent a pendingActionId.",
      parameters: {
        type: "object",
        properties: {
          coachId: { type: "string", description: "The coach ID" },
          serviceId: { type: "string", description: "The service ID" },
          startAt: { type: "string", description: "Session start time in ISO 8601 format" },
          clientId: { type: "string", description: "Existing client user ID (optional)" },
          clientFirstName: { type: "string", description: "Walk-in client first name (if no clientId)" },
          clientLastName: { type: "string", description: "Walk-in client last name (if no clientId)" },
          location: { type: "string", description: "Session location (optional)" },
          confirmed: { type: "boolean", description: "Set to false on the first call to preview and get a pendingActionId. Set to true on the second call only after the coach confirms." },
          pendingActionId: { type: "string", description: "Required when confirmed is true. Must be the exact pendingActionId returned by the previous call with confirmed: false. Never invent this value." },
        },
        required: ["coachId", "serviceId", "startAt", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_org_schedule",
      description: "Get all bookings for the organization within a date range (coach/admin only). Use to show the full schedule, check what's booked for a day or week, or understand overall capacity.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Start date in YYYY-MM-DD format (defaults to today)" },
          endDate: { type: "string", description: "End date in YYYY-MM-DD format (defaults to 7 days from start)" },
          coachId: { type: "string", description: "Optional: filter results to a specific coach ID" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_inactive_clients",
      description: "Find clients who have not had a confirmed/completed booking since a given date (coach/admin only). Use to identify who needs follow-up or re-engagement.",
      parameters: {
        type: "object",
        properties: {
          sinceDaysAgo: { type: "number", description: "How many days back to look. Clients with no booking in this window are returned. Defaults to 7." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_coach_utilization",
      description: "Get utilization metrics for all coaches in the organization: how many minutes are booked vs available (coach/admin only). Useful for identifying coaches with capacity.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Start date in YYYY-MM-DD format (defaults to Monday of the current week)" },
          endDate: { type: "string", description: "End date in YYYY-MM-DD format (defaults to Sunday of the current week)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "identify_schedule_gaps",
      description: "Find open time blocks where no session is booked for a given coach (coach/admin only). Helps identify where the schedule can be filled.",
      parameters: {
        type: "object",
        properties: {
          coachId: { type: "string", description: "The coach ID to analyze" },
          startDate: { type: "string", description: "Start date in YYYY-MM-DD format (defaults to today)" },
          numDays: { type: "number", description: "Number of days to scan (default 7, max 14)" },
        },
        required: ["coachId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_booking",
      description: "Reschedule an existing booking to a new time (coach/admin only). Use the two-call handshake: first call with confirmed: false to get a pendingActionId, show the user the current booking and new time, then call again with confirmed: true and the pendingActionId after they confirm. Never invent a pendingActionId.",
      parameters: {
        type: "object",
        properties: {
          bookingId: { type: "string", description: "The ID of the booking to reschedule" },
          newStartAt: { type: "string", description: "New start time in ISO 8601 format" },
          newEndAt: { type: "string", description: "New end time in ISO 8601 format" },
          confirmed: { type: "boolean", description: "Set to false on the first call to preview and get a pendingActionId. Set to true on the second call only after the user confirms." },
          pendingActionId: { type: "string", description: "Required when confirmed is true. Must be the exact pendingActionId returned by the previous call with confirmed: false. Never invent this value." },
        },
        required: ["bookingId", "newStartAt", "newEndAt", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_client",
      description: "Search for a client by name to get their user ID and details (coach/admin only). Use before booking or rescheduling when you only have a client's name.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name to search (first name, last name, or partial name)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_operations_digest",
      description: "Get a full operations intelligence digest for the organization: utilization metrics, open slots, inactive clients, waitlist count, revenue opportunity estimate, recent cancellations, and prioritized scheduling insights. Use this when the user asks for a summary, overview, or wants to see what needs attention.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_revenue_summary",
      description: "Get a comprehensive revenue summary for the organization: total revenue, last-30-day revenue, month-over-month growth, MRR from subscriptions, average client LTV, revenue by coach, and revenue by time block (best hours). Use for revenue questions, growth analysis, or when the user asks about money/earnings.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_churn_risks",
      description: "Identify clients at risk of churning based on signals: booking frequency drop, days since last session, subscription cancellation pending, or near-empty session balance. Returns a list of at-risk clients with signals and suggested actions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_upsell_opportunities",
      description: "Find clients who could be upgraded: clients booking 1x/week who could add a 2nd session, 1-on-1 clients who could join semi-private groups, etc. Returns actionable upsell opportunities with estimated revenue lift.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client_value",
      description: "Get detailed LTV, revenue, and engagement data for all clients in the organization. Includes total spend, session count, monthly average spend, subscription status, and churn risk level.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_session_packages",
      description: "Get alerts for clients with low session balances on their subscription plans (0–2 sessions remaining) or subscriptions set to cancel at period end. Useful for proactive renewal outreach.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_waitlist",
      description: "Get all clients currently on the scheduling waitlist for this organization (coach/admin only).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "send_scheduling_inquiry",
      description: "Send a scheduling inquiry email to the organization's configured scheduling contact on behalf of the current user. Only use this if the org has allowUserInquiryEmails enabled. Use the two-call handshake: first call with confirmed: false to get a pendingActionId, restate the recipient and message to the user, then call again with confirmed: true and the pendingActionId after they confirm. Never invent a pendingActionId.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The user's inquiry message to forward" },
          confirmed: { type: "boolean", description: "Set to false on the first call to preview and get a pendingActionId. Set to true on the second call only after the user confirms." },
          pendingActionId: { type: "string", description: "Required when confirmed is true. Must be the exact pendingActionId returned by the previous call with confirmed: false. Never invent this value." },
        },
        required: ["message", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_waitlist",
      description: "Add a client to the scheduling waitlist (coach/admin only). Use when a client wants to book but no time works for them.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "string", description: "The client's user ID" },
          coachId: { type: "string", description: "Preferred coach ID (optional)" },
          sessionType: { type: "string", description: "Type of session requested (optional)" },
          notes: { type: "string", description: "Any notes about preferences or constraints" },
        },
        required: ["clientId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_backfill",
      description: "Find the best waitlist candidates to fill a recently cancelled session slot. Provide the cancelled booking's coach, service, and time — the tool will match waitlist clients with compatible preferences.",
      parameters: {
        type: "object",
        properties: {
          coachId: { type: "string", description: "Coach ID of the cancelled session" },
          startAt: { type: "string", description: "Cancelled slot start time in ISO 8601 format" },
          sessionType: { type: "string", description: "Type/service of the cancelled session (optional)" },
        },
        required: ["coachId", "startAt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_revenue_by_period",
      description: "Get revenue for a specific time period: this_week, last_week, this_month, or last_month. Returns total revenue, session count, breakdown by coach and service, and comparison vs prior period. ALWAYS use this instead of get_revenue_summary when the user asks about a specific week or month.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["this_week", "last_week", "this_month", "last_month", "custom"],
            description: "The time period. Use 'custom' with startDate/endDate for a specific range.",
          },
          startDate: { type: "string", description: "Start date YYYY-MM-DD (required only for custom period)" },
          endDate: { type: "string", description: "End date YYYY-MM-DD (required only for custom period)" },
          compare: {
            type: "boolean",
            description: "If true, compare against the equivalent prior period (default: true).",
          },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_revenue_forecast",
      description: "Forecast projected end-of-month revenue based on: revenue already collected, future confirmed bookings, and subscription MRR. Use whenever the coach asks what they're projected to make, whether they're on track, or what they need to hit a revenue target. If a target dollar amount is provided, pass it as targetCents — the tool will compute exactly how many sessions are needed to close the gap. Never calculate this in response text.",
      parameters: {
        type: "object",
        properties: {
          targetCents: {
            type: "number",
            description: "Optional revenue target in cents (e.g. 1500000 for $15,000). When provided, the tool returns the gap and exact sessions needed. Do NOT compute this yourself — always pass it here.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "preview_recurring_sessions",
      description: "Preview a recurring session schedule without booking anything. Checks every date for conflicts and returns available vs conflicted dates. ALWAYS call this before create_confirmed_recurring_sessions. For multi-day recurring (e.g. 'Monday and Thursday'), use the recurrenceDays array — a single tool call handles all days at once. Do NOT make separate preview calls per day.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "string", description: "Client user ID" },
          coachId: { type: "string", description: "Coach ID" },
          serviceId: { type: "string", description: "Service ID" },
          startDate: { type: "string", description: "The week start date to begin scheduling from, in YYYY-MM-DD format. Occurrences are generated from the first matching day on or after this date." },
          startTime: { type: "string", description: "Session start time in HH:MM 24-hour format (e.g. '07:00')" },
          recurrencePattern: {
            type: "string",
            enum: ["weekly", "biweekly"],
            description: "How often sessions repeat. Use 'weekly' for Monday+Thursday patterns.",
          },
          occurrences: { type: "number", description: "Total number of sessions per recurrence day. E.g. 6 weeks × 2 days = pass occurrences: 6 (tool generates 6 per day)." },
          recurrenceDays: {
            type: "array",
            items: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
            description: "REQUIRED when booking multiple days per week (e.g. ['monday', 'thursday']). When provided, startDate/startTime is used as a reference week and occurrences are generated for each specified day. Omit for single-day recurring.",
          },
        },
        required: ["clientId", "coachId", "serviceId", "startDate", "startTime", "recurrencePattern", "occurrences"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_confirmed_recurring_sessions",
      description: "Create recurring sessions for confirmed available slots. Only call AFTER presenting the preview plan to the coach. Use the two-call handshake: first call with confirmed: false to get a pendingActionId, show the coach the full slot list, then call again with confirmed: true and the pendingActionId after they confirm. Never invent a pendingActionId.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "string", description: "Client user ID" },
          coachId: { type: "string", description: "Coach ID" },
          serviceId: { type: "string", description: "Service ID" },
          confirmedSlots: {
            type: "array",
            items: {
              type: "object",
              properties: {
                startAt: { type: "string", description: "ISO 8601 start time" },
                endAt: { type: "string", description: "ISO 8601 end time" },
              },
            },
            description: "Array of {startAt, endAt} pairs to book — taken from the preview_recurring_sessions output",
          },
          location: { type: "string", description: "Session location (optional)" },
          confirmed: { type: "boolean", description: "Set to false on the first call to preview and get a pendingActionId. Set to true on the second call only after the coach confirms all slots." },
          pendingActionId: { type: "string", description: "Required when confirmed is true. Must be the exact pendingActionId returned by the previous call with confirmed: false. Never invent this value." },
        },
        required: ["clientId", "coachId", "serviceId", "confirmedSlots", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_client_outreach",
      description: "Draft a personalized text message and email for a specific client. Use for re-engagement (churn/inactive), upsell, session package renewal, or backfill outreach. Returns an SMS draft and email draft ready to send.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "string", description: "Client user ID" },
          reason: {
            type: "string",
            enum: ["churn_risk", "inactive", "low_sessions", "upsell", "backfill", "general"],
            description: "Why you're reaching out",
          },
          goal: {
            type: "string",
            enum: ["rebook", "upsell", "renew_package", "fill_cancellation", "check_in"],
            description: "What you want to achieve with this message",
          },
          tone: {
            type: "string",
            enum: ["professional", "friendly", "direct"],
            description: "Tone of the message (default: friendly)",
          },
          context: {
            type: "string",
            description: "Additional context: cancelled slot time for backfill, package name for renewal, specific upsell offer, etc.",
          },
          targetSlot: {
            type: "string",
            description: "For backfill outreach: the specific open slot to fill, as a human-readable string (e.g. 'Tuesday at 7:00 AM'). When provided, the drafted messages reference this specific time.",
          },
        },
        required: ["clientId", "reason", "goal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client_bookings",
      description: "Get upcoming (and recent past) bookings for a specific client by their ID. Use any time a prompt references 'their session', 'next session', 'existing booking', or 'current schedule'. Never use get_org_schedule for client-specific queries.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "string", description: "The client's user ID" },
          lookAheadDays: { type: "number", description: "How many days ahead to look for upcoming sessions (default: 30)" },
          includePast: { type: "boolean", description: "If true, also include recent past sessions from the last 30 days (default: false)" },
        },
        required: ["clientId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weekly_business_recap",
      description: "Generate a complete weekly business recap: revenue this week vs last week, sessions completed and cancelled, current capacity risks, growth opportunities, and 3 top next actions. Use for 'weekly recap', 'how was my week', 'week in review', or any end-of-week summary request.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_daily_action_queue",
      description: "Return a prioritized list of actions for today, organized by priority tier: high-priority (churn risks, follow-ups due, unfilled slots), revenue opportunities (upsell targets, underbooked), and maintenance (low session packages, inactive clients). Use for 'what should I do today?', 'what's my priority this morning?', 'give me my to-do list', or any daily briefing request.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_follow_up_actions",
      description: "Return a list of clients who need follow-up on outreach messages that were sent but not responded to. Includes urgency level and recommended follow-up message. Use for 'who do I need to follow up with?', 'who hasn't responded?', 'who ignored my messages?', 'did my outreach work?'",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_operator_performance_metrics",
      description: "Return aggregate performance metrics for agent-driven outreach and bookings: messages sent, conversion rate, revenue attributed to outreach, best-converting message types, and top revenue-generating clients. Use for 'how effective is my outreach?', 'which messages converted?', 'how much revenue came from the agent?', 'what actions made me the most money?'",
      parameters: {
        type: "object",
        properties: {
          sinceDays: {
            type: "number",
            description: "Number of days to look back. Default 30. Use 7 for 'this week', 14 for 'last 2 weeks'.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_action_performance_profile",
      description: "Return performance data for each outreach action type: conversion rate, average revenue per booking, 30-day trend (improving/declining/stable), and ROI score. Use for 'what outreach works best?', 'why are you prioritizing X?', 'which message type converts best?', 'what should I stop doing?'",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_auto_mode_status",
      description: "Return the current autonomous mode level: what the agent is allowed to do automatically vs what requires manual coach input. Use for 'what will you do automatically?', 'what's auto mode?', 'what is the agent doing on its own?'",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "set_auto_mode",
      description: "Set the autonomous mode level for the agent. Level 0=Manual (suggest only), 1=Suggest (default), 2=Semi-Auto (auto-draft follow-ups + backfill), 3=Full Operator (daily queue auto-populated). Use when the coach says 'turn on auto mode', 'enable auto mode', 'go to full operator mode', or specifies a level.",
      parameters: {
        type: "object",
        properties: {
          level: { type: "number", description: "0=Manual, 1=Suggest, 2=Semi-Auto, 3=Full Operator" },
        },
        required: ["level"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_revenue_optimization_plan",
      description: "Build a prioritized 7-day revenue optimization plan: match open schedule slots to the highest-ROI client contacts based on historical conversion data. Returns slot-by-slot recommendations, client contact order, message types to use, and estimated achievable revenue. Use for 'how do I make the most money this week?', 'what's the best way to fill my schedule?', 'give me a revenue plan', 'maximize this week'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weekly_learning_insights",
      description: "Return what worked and what to improve based on this week's outreach data vs last week: best-performing action types, declining approaches, week-over-week conversion trend. Use for 'what worked best this week?', 'what should I stop doing?', 'what should I do more of?', 'how did I improve this week?'",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_time_performance_profile",
      description: "Return conversion rate by hour of day for each message type (backfill, churn_risk, upsell, etc.). Used to identify the best time window to send messages. Use when coach asks 'what's the best time to send messages?', 'when do my messages convert best?', 'what time should I reach out?', or when the agent needs to recommend an optimal send time.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "start_campaign",
      description: "Start a multi-step outreach campaign for a specific client. Creates the campaign record and drafts the first message. Campaign types: churn_recovery (3 steps, 0/24/72h), backfill_sequence (2 steps, 0/12h), upsell_sequence (3 steps, 0/48/96h), package_renewal (2 steps, 0/24h). Use when the coach says 'start a campaign for [client]', 'run a churn recovery campaign', 'start a backfill sequence', or 'send a multi-step outreach to [client]'.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "string", description: "Client user ID" },
          clientName: { type: "string", description: "Client full name" },
          campaignType: {
            type: "string",
            enum: ["churn_recovery", "backfill_sequence", "upsell_sequence", "package_renewal"],
            description: "Type of campaign to run",
          },
          coachId: { type: "string", description: "Optional: assign campaign to a specific coach" },
        },
        required: ["clientId", "clientName", "campaignType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_campaign_status",
      description: "Return all active and recently completed campaigns: current step, next scheduled action, client name, campaign type, status. Use for 'what campaigns are running?', 'what's the status of [client] campaign?', 'what's running in the background?', 'show me active campaigns'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_auto_dashboard",
      description: "Return a full autopilot dashboard: automation level, how many messages were auto-sent today, active campaigns, revenue attributed to auto actions, what the agent is currently doing automatically, top-performing message type and time window. Use for 'what did you do automatically today?', 'what's running in the background?', 'how much revenue did you generate without me?', 'show me the autopilot status'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_message_variation_profile",
      description: "Return A/B test performance data by message variation style (short_direct, friendly, urgency_based, standard). Shows conversion rate per variation type, trend, and recommendation for which style to use more. Use for 'which message style works best?', 'what tone converts most?', 'what should my messages sound like?', 'A/B test results'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_client_response_profile",
      description: "Compute a detailed response profile for a specific client: their preferred send hour, preferred message type, average touches before conversion, response rate, conversion rate, 30-day trend, and a client conversion modifier. Use when the coach asks 'What's the best way to reach [client]?', 'How does [client] respond to outreach?', 'Who responds best to messages?', 'Why are you prioritizing this client?', or before drafting personalized outreach.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "string", description: "The client's user ID" },
        },
        required: ["clientId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_client_segments",
      description: "Segment all clients into strategic groups: high value low frequency, high churn risk with high recovery probability, frequent responders, low responders, high lifetime value (active), and inactive but historically consistent. Each segment includes size, avg revenue, avg conversion rate, and recommended strategy. Use when the coach asks 'What types of clients do I have?', 'Who should I focus on this week?', 'How are my clients grouped?', 'Who are my best clients?'",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_client_ltv_score",
      description: "Compute lifetime value score for a specific client: total spend, session count, retention duration, avg monthly spend, projected annual value, LTV tier (platinum/gold/silver/at_risk/new), and churn risk. Use when the coach asks 'What is [client]'s lifetime value?', 'Is [client] worth prioritizing?', 'Why are you prioritizing [client]?', or for any LTV-related client question.",
      parameters: {
        type: "object",
        properties: {
          clientId: { type: "string", description: "The client's user ID" },
        },
        required: ["clientId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_strategic_recommendations",
      description: "Return a full strategic decision layer for the week: what to focus on (retention vs growth vs reactivation), which client segments to prioritize, what to reduce, where revenue is being lost, and the biggest upside opportunities. Also returns a ranked list of specific clients to contact today. Use when the coach asks 'What should I focus on this week?', 'Where am I losing money?', 'What's my biggest opportunity?', 'What should I stop doing long-term?', 'Give me a strategic plan', 'Where should I invest my time?'",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "set_weekly_targets",
      description: "Set or update weekly performance targets for the organization. Targets are used to prioritize the action queue — the agent automatically boosts actions that contribute to behind-target dimensions. Use when the coach says 'Set a revenue goal', 'I want to hit X sessions this week', 'Set a retention target', 'My goal this week is...', or 'Help me hit $X this week'.",
      parameters: {
        type: "object",
        properties: {
          revenueCents: {
            type: "number",
            description: "Target weekly revenue in cents (e.g. 500000 for $5,000). Omit if not setting a revenue target.",
          },
          sessions: {
            type: "number",
            description: "Target number of sessions booked this week. Omit if not setting a sessions target.",
          },
          retentionPct: {
            type: "number",
            description: "Target retention rate as a percentage (0-100). E.g. 80 means 80% of active clients should book this week. Omit if not setting a retention target.",
          },
          utilizationPct: {
            type: "number",
            description: "Target schedule utilization as a percentage (0-100). E.g. 75 means 75% of available slots should be filled. Omit if not setting a utilization target.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weekly_progress",
      description: "Get current progress toward this week's performance targets: revenue, sessions, retention, and utilization. Shows pct complete, gaps, on-track status, and projected end-of-week outcomes. Use when the coach asks 'How am I doing this week?', 'Am I on track?', 'What's my progress toward my goal?', 'How far behind am I?', 'Will I hit my target?'",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_goal_performance_summary",
      description: "Return a full performance summary for the current week: targets vs actual results, which targets were achieved, top contributing action types, best strategy, and what to change next week. Use when the coach asks 'How did I do this week?', 'Did I hit my goals?', 'What worked best this week?', 'What should I do differently next week?', 'Give me a weekly recap'.",
      parameters: { type: "object", properties: {} },
    },
  },
  // ── Phase 9: Revenue Optimization Engine ──
  {
    type: "function",
    function: {
      name: "get_revenue_quality",
      description: "Analyze revenue quality for a time period: how many hours were revenue-generating vs non-revenue (internal, meetings, intros, comp), the revenue quality score (0-1), and estimated revenue lost to non-revenue time. Use when coach asks 'How much revenue am I losing?', 'What's my revenue quality?', 'How much time am I wasting?', 'Am I spending too much time on non-billable work?', 'Why am I not making more money?'",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["this_week", "last_week", "this_month"],
            description: "Time period to analyze. Defaults to this_week.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_session_mix",
      description: "Analyze session category breakdown: percentage of paid vs intro vs internal vs meeting vs membership sessions. Shows whether non-revenue sessions are too high. Use for 'What's my session mix?', 'How many free sessions am I doing?', 'Are too many sessions non-revenue?', 'Why am I not hitting my goals?', 'What categories of sessions am I doing?'",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["this_week", "last_week", "this_month"],
            description: "Time period to analyze. Defaults to this_week.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_coach_profitability",
      description: "Return per-coach profitability: revenue generated, estimated payout, net margin, hours worked, and revenue per hour. Ranks coaches by margin. Use for 'Which coach is most profitable?', 'What's my margin per coach?', 'Which coach costs the most?', 'Show me coach profitability', 'Am I overpaying any coaches?'",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["this_week", "last_week", "this_month"],
            description: "Time period to analyze. Defaults to this_week.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_revenue_pressure",
      description: "Return current revenue pressure vs weekly target: how far behind the org is today, urgency level (low/medium/high/critical), required daily revenue to close the gap, and top 3 recovery actions. Use when coach opens the app, asks 'Am I behind target?', 'What should I do today?', 'How do I close the revenue gap?', 'How much do I need to make today?', 'What's my revenue pressure?'",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_lost_revenue",
      description: "Quantify total recoverable revenue: value of open calendar slots, inactive clients who could rebook, and unconverted intro sessions. Returns dollar estimates and top opportunities ranked by impact. Use for 'How much revenue am I losing?', 'What revenue opportunities am I missing?', 'How much could I recover?', 'What's sitting on the table?', 'How do I make more money this week?'",
      parameters: { type: "object", properties: {} },
    },
  },
];

async function executeTool(
  name: string,
  args: any,
  userId: string | null,
  userRole: string,
  organizationId: string | null = null
): Promise<string> {
  try {
    switch (name) {
      case "list_coaches": {
        const allCoaches = await storage.getCoachProfiles();
        const coaches = organizationId
          ? allCoaches.filter(c => c.organizationId === organizationId)
          : allCoaches;
        return JSON.stringify(coaches.map(c => ({
          id: c.id,
          name: `${c.user.firstName} ${c.user.lastName}`,
          specialties: c.specialties,
          bio: c.bio,
        })));
      }

      case "list_services": {
        const services = organizationId
          ? await storage.getServicesByOrganization(organizationId)
          : await storage.getServices();
        return JSON.stringify(services.filter(s => s.active).map(s => ({
          id: s.id,
          name: s.name,
          durationMin: s.durationMin,
          sessionType: s.sessionType,
          price: s.priceCents === 0 ? "FREE" : `$${(s.priceCents / 100).toFixed(2)}`,
        })));
      }

      case "get_available_slots": {
        const { coachId, serviceId, startDate, numDays = 7 } = args;
        const service = await storage.getService(serviceId);
        if (!service) return JSON.stringify({ error: "Service not found" });
        const coach = await storage.getCoachProfile(coachId);
        if (!coach) return JSON.stringify({ error: "Coach not found" });

        const timezone = coach.timezone || "America/New_York";
        const start = startDate ? new Date(startDate) : new Date();
        const end = addDays(start, Math.min(numDays, 14));

        const blocks = await storage.getAvailabilityBlocks(coachId);
        const bookings = await storage.getCoachBookings(coachId);
        const activeBookings = bookings.filter(b => b.status !== "CANCELLED");

        const now = new Date();
        const slots: { date: string; times: string[] }[] = [];
        let current = new Date(start);

        while (current <= end) {
          const zonedCurrent = toZonedTime(current, timezone);
          const dayOfWeek = (zonedCurrent.getDay() + 6) % 7;
          const dayBlocks = blocks.filter(b => b.dayOfWeek === dayOfWeek);
          const dayStr = format(zonedCurrent, "EEEE, MMM d");
          const dayTimes: string[] = [];

          for (const block of dayBlocks) {
            const [startH, startM] = block.startTime.split(":").map(Number);
            const [endH, endM] = block.endTime.split(":").map(Number);

            const localSlotStart = new Date(zonedCurrent);
            localSlotStart.setHours(startH, startM, 0, 0);
            let slotStart = fromZonedTime(localSlotStart, timezone);

            const localBlockEnd = new Date(zonedCurrent);
            localBlockEnd.setHours(endH, endM, 0, 0);
            const blockEnd = fromZonedTime(localBlockEnd, timezone);

            while (addMinutes(slotStart, service.durationMin) <= blockEnd) {
              const slotEnd = addMinutes(slotStart, service.durationMin);
              if (slotStart > now) {
                const hasOverlap = activeBookings.some(b => {
                  const bStart = new Date(b.startAt).getTime();
                  const bEnd = new Date(b.endAt).getTime();
                  return slotStart.getTime() < bEnd && slotEnd.getTime() > bStart;
                });
                if (!hasOverlap) {
                  const zonedSlot = toZonedTime(slotStart, timezone);
                  dayTimes.push(`${format(zonedSlot, "h:mm a")} (${slotStart.toISOString()} to ${slotEnd.toISOString()})`);
                }
              }
              slotStart = addMinutes(slotStart, 30);
            }
          }

          if (dayTimes.length > 0) {
            slots.push({ date: dayStr, times: dayTimes });
          }
          current = addDays(current, 1);
        }

        if (slots.length === 0) {
          return JSON.stringify({ message: "No available slots found in the requested date range." });
        }
        return JSON.stringify(slots);
      }

      case "book_session": {
        if (args.confirmed !== true) {
          const pending = createPendingAction(userId, "book_session", {
            coachId: args.coachId,
            serviceId: args.serviceId,
            startAt: args.startAt,
            endAt: args.endAt,
          });
          return JSON.stringify({
            requiresConfirmation: true,
            pendingActionId: pending.pendingActionId,
            actionType: "book_session",
            summary: `Book session: coach ${args.coachId}, service ${args.serviceId}, starting ${args.startAt}`,
            expiresAt: pending.expiresAt.toISOString(),
            message: "Restate the session details clearly to the user and ask them to confirm. Once they confirm, call book_session again with confirmed: true and the exact pendingActionId from this response.",
          });
        }
        const pendingActionId_book: string | undefined = args.pendingActionId;
        if (!pendingActionId_book) {
          return JSON.stringify({ error: "pendingActionId is required when confirmed is true. Call book_session with confirmed: false first to generate one." });
        }
        const statusBook = getPendingActionStatus(pendingActionId_book);
        if (statusBook.status === "expired") {
          return JSON.stringify({ error: "pending_action_expired", message: "This action has expired. Please review and confirm again." });
        }
        if (statusBook.status === "not_found") {
          return JSON.stringify({ error: "pendingActionId not found. Call book_session with confirmed: false first to generate one." });
        }
        const pendingBook = statusBook.action;
        const pvBook = validatePendingAction(pendingBook, userId, "book_session", args);
        if (!pvBook.valid) return JSON.stringify({ error: pvBook.error });
        consumePendingAction(pendingActionId_book);
        if (!userId) return JSON.stringify({ error: "You need to be logged in to book a session." });
        const { coachId, serviceId, startAt, endAt } = args;

        const service = await storage.getService(serviceId);
        if (!service) return JSON.stringify({ error: "Service not found" });

        const isFreeIntro = service.name.toLowerCase().includes("free intro");
        if (isFreeIntro) {
          const alreadyUsed = await storage.hasUsedFreeSession(userId);
          if (alreadyUsed) return JSON.stringify({ error: "You have already used your free intro session." });
        }

        const overlapping = await storage.getOverlappingBookings(coachId, new Date(startAt), new Date(endAt));
        if (overlapping.length > 0) {
          return JSON.stringify({ error: "This time slot is no longer available." });
        }

        const isSemiPrivate = service.name.toLowerCase().includes("semi-private");
        const start = new Date(startAt);
        const end = new Date(endAt);
        const booking = await storage.createBooking({
          clientId: userId,
          coachId,
          serviceId,
          startAt: start,
          endAt: end,
          status: "CONFIRMED",
          notes: "",
          location: "",
          maxParticipants: isSemiPrivate ? 6 : null,
          groupDescription: "",
        });

        // Send confirmation emails to client and coach (non-blocking)
        (async () => {
          try {
            const [clientUser, coachProfile, orgBranding] = await Promise.all([
              storage.getUser(userId),
              storage.getCoachProfile(coachId),
              getOrgBranding(organizationId),
            ]);
            const tz = (coachProfile as any)?.timezone || "America/New_York";
            const coachName = coachProfile?.user
              ? `${coachProfile.user.firstName ?? ""} ${coachProfile.user.lastName ?? ""}`.trim()
              : "Your Coach";
            const clientName = clientUser
              ? `${clientUser.firstName ?? ""} ${clientUser.lastName ?? ""}`.trim()
              : "A client";

            if (clientUser?.email) {
              sendBookingConfirmationToClient(
                clientUser.email,
                clientUser.firstName || "there",
                coachName,
                service.name,
                start,
                end,
                undefined,
                tz,
                orgBranding
              ).catch(() => {});
            }

            const coachEmail = (coachProfile as any)?.email || coachProfile?.user?.email;
            if (coachEmail) {
              sendBookingNotificationToCoach(
                coachEmail,
                coachProfile?.user?.firstName || "Coach",
                clientName,
                service.name,
                start,
                end,
                undefined,
                tz,
                orgBranding
              ).catch(() => {});
            }
          } catch (err) {
            console.error("[book_session] Email notification error:", err);
          }
        })();

        return JSON.stringify({ success: true, bookingId: booking.id, message: "Session booked successfully!" });
      }

      case "get_my_bookings": {
        if (!userId) return JSON.stringify({ error: "You need to be logged in to view bookings." });
        const bookings = await storage.getBookings(userId);
        const upcoming = bookings
          .filter(b => new Date(b.startAt) > new Date() && b.status !== "CANCELLED")
          .slice(0, 10);
        return JSON.stringify(upcoming.map(b => ({
          id: b.id,
          service: b.service?.name,
          coach: b.coach?.user ? `${b.coach.user.firstName} ${b.coach.user.lastName}` : "Unknown",
          date: format(new Date(b.startAt), "EEEE, MMM d 'at' h:mm a"),
          status: b.status,
          location: (b as any).location || "",
        })));
      }

      case "get_client_bookings": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view client bookings." });
        }
        const { clientId: lookupClientId, lookAheadDays = 30, includePast = false } = args;
        if (!lookupClientId) return JSON.stringify({ error: "clientId is required." });

        const allClientBookings = await storage.getBookings(lookupClientId);
        const now = new Date();
        const futureLimit = addDays(now, lookAheadDays);
        const pastLimit = addDays(now, -30);

        const upcoming = allClientBookings.filter(b => {
          const t = new Date(b.startAt);
          return t >= now && t <= futureLimit && b.status !== "CANCELLED";
        });

        const past = includePast
          ? allClientBookings.filter(b => {
              const t = new Date(b.startAt);
              return t >= pastLimit && t < now && b.status !== "CANCELLED";
            })
          : [];

        const fmt = (b: typeof allClientBookings[number]) => ({
          bookingId: b.id,
          service: b.service?.name ?? "Unknown Service",
          coach: b.coach?.user ? `${b.coach.user.firstName} ${b.coach.user.lastName}` : "Unknown Coach",
          coachId: b.coachId,
          serviceId: b.serviceId,
          date: format(new Date(b.startAt), "EEEE, MMM d"),
          startTime: format(new Date(b.startAt), "h:mm a"),
          endTime: format(new Date(b.endAt), "h:mm a"),
          startAt: new Date(b.startAt).toISOString(),
          endAt: new Date(b.endAt).toISOString(),
          status: b.status,
          location: (b as any).location || "",
        });

        if (upcoming.length === 0 && past.length === 0) {
          return JSON.stringify({ message: "No bookings found for this client in the specified range.", upcoming: [], past: [] });
        }

        return JSON.stringify({
          upcomingCount: upcoming.length,
          upcoming: upcoming.map(fmt),
          ...(includePast ? { pastCount: past.length, recentPast: past.map(fmt) } : {}),
        });
      }

      case "cancel_booking": {
        if (args.confirmed !== true) {
          const pending = createPendingAction(userId, "cancel_booking", { bookingId: args.bookingId });
          return JSON.stringify({
            requiresConfirmation: true,
            pendingActionId: pending.pendingActionId,
            actionType: "cancel_booking",
            summary: `Cancel booking ID: ${args.bookingId}`,
            expiresAt: pending.expiresAt.toISOString(),
            message: "Restate what will be cancelled (service, coach, date, time) to the user and ask them to confirm. Once they confirm, call cancel_booking again with confirmed: true and the exact pendingActionId from this response.",
          });
        }
        const pendingActionId_cancel: string | undefined = args.pendingActionId;
        if (!pendingActionId_cancel) {
          return JSON.stringify({ error: "pendingActionId is required when confirmed is true. Call cancel_booking with confirmed: false first to generate one." });
        }
        const statusCancel = getPendingActionStatus(pendingActionId_cancel);
        if (statusCancel.status === "expired") {
          return JSON.stringify({ error: "pending_action_expired", message: "This action has expired. Please review and confirm again." });
        }
        if (statusCancel.status === "not_found") {
          return JSON.stringify({ error: "pendingActionId not found. Call cancel_booking with confirmed: false first to generate one." });
        }
        const pendingCancel = statusCancel.action;
        const pvCancel = validatePendingAction(pendingCancel, userId, "cancel_booking", args);
        if (!pvCancel.valid) return JSON.stringify({ error: pvCancel.error });
        consumePendingAction(pendingActionId_cancel);
        if (!userId) return JSON.stringify({ error: "You need to be logged in." });
        const booking = await storage.getBooking(args.bookingId);
        if (!booking) return JSON.stringify({ error: "Booking not found." });
        if (booking.clientId !== userId && userRole !== "COACH" && userRole !== "ADMIN") {
          return JSON.stringify({ error: "You can only cancel your own bookings." });
        }
        await storage.updateBookingStatus(args.bookingId, "CANCELLED");
        return JSON.stringify({ success: true, message: "Booking has been cancelled." });
      }

      case "get_coach_schedule": {
        if (userRole !== "COACH" && userRole !== "ADMIN") {
          return JSON.stringify({ error: "Only coaches and admins can view the coach schedule." });
        }
        const { coachId, date } = args;
        const bookings = await storage.getCoachBookings(coachId);
        const targetDate = date ? new Date(date) : new Date();
        const dayBookings = bookings.filter(b => {
          const bDate = new Date(b.startAt);
          return bDate.toDateString() === targetDate.toDateString() && b.status !== "CANCELLED";
        });
        return JSON.stringify(dayBookings.map(b => ({
          id: b.id,
          service: b.service?.name,
          client: b.client ? `${b.client.firstName} ${b.client.lastName}` : "Unknown",
          time: `${format(new Date(b.startAt), "h:mm a")} - ${format(new Date(b.endAt), "h:mm a")}`,
          status: b.status,
        })));
      }

      case "set_availability": {
        if (userRole !== "COACH" && userRole !== "ADMIN") {
          return JSON.stringify({ error: "Only coaches and admins can set availability." });
        }
        const { coachId, dayOfWeek, startTime, endTime } = args;
        const block = await storage.createAvailabilityBlock({
          coachId,
          dayOfWeek,
          startTime,
          endTime,
        });
        const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        return JSON.stringify({
          success: true,
          message: `Availability set for ${dayNames[dayOfWeek]} from ${startTime} to ${endTime}.`,
          blockId: block.id,
        });
      }

      case "get_availability": {
        if (userRole !== "COACH" && userRole !== "ADMIN") {
          return JSON.stringify({ error: "Only coaches and admins can view availability settings." });
        }
        const blocks = await storage.getAvailabilityBlocks(args.coachId);
        const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        return JSON.stringify(blocks.map(b => ({
          id: b.id,
          day: dayNames[b.dayOfWeek],
          startTime: b.startTime,
          endTime: b.endTime,
        })));
      }

      case "delete_availability": {
        if (userRole !== "COACH" && userRole !== "ADMIN") {
          return JSON.stringify({ error: "Only coaches and admins can delete availability." });
        }
        await storage.deleteAvailabilityBlock(args.blockId);
        return JSON.stringify({ success: true, message: "Availability block deleted." });
      }

      case "coach_create_session": {
        if (args.confirmed !== true) {
          const pending = createPendingAction(userId, "coach_create_session", {
            coachId: args.coachId,
            serviceId: args.serviceId,
            startAt: args.startAt,
            clientId: args.clientId,
            clientFirstName: args.clientFirstName,
            clientLastName: args.clientLastName,
          });
          return JSON.stringify({
            requiresConfirmation: true,
            pendingActionId: pending.pendingActionId,
            actionType: "coach_create_session",
            summary: `Create session: coach ${args.coachId}, service ${args.serviceId}, client ${args.clientId || `${args.clientFirstName} ${args.clientLastName}`}, starting ${args.startAt}`,
            expiresAt: pending.expiresAt.toISOString(),
            message: "Restate the client, coach, service, and time to the coach and ask them to confirm. Once confirmed, call coach_create_session again with confirmed: true and the exact pendingActionId from this response.",
          });
        }
        const pendingActionId_create: string | undefined = args.pendingActionId;
        if (!pendingActionId_create) {
          return JSON.stringify({ error: "pendingActionId is required when confirmed is true. Call coach_create_session with confirmed: false first to generate one." });
        }
        const statusCreate = getPendingActionStatus(pendingActionId_create);
        if (statusCreate.status === "expired") {
          return JSON.stringify({ error: "pending_action_expired", message: "This action has expired. Please review and confirm again." });
        }
        if (statusCreate.status === "not_found") {
          return JSON.stringify({ error: "pendingActionId not found. Call coach_create_session with confirmed: false first to generate one." });
        }
        const pendingCreate = statusCreate.action;
        const pvCreate = validatePendingAction(pendingCreate, userId, "coach_create_session", args);
        if (!pvCreate.valid) return JSON.stringify({ error: pvCreate.error });
        consumePendingAction(pendingActionId_create);
        if (userRole !== "COACH" && userRole !== "ADMIN") {
          return JSON.stringify({ error: "Only coaches and admins can create sessions for clients." });
        }
        const { coachId, serviceId, startAt, clientId, clientFirstName, clientLastName, location } = args;
        const service = await storage.getService(serviceId);
        if (!service) return JSON.stringify({ error: "Service not found" });

        let resolvedClientId = clientId;
        if (!resolvedClientId && clientFirstName && clientLastName) {
          const user = await storage.findOrCreateUserByName(clientFirstName, clientLastName);
          resolvedClientId = user.id;
        }
        if (!resolvedClientId) {
          return JSON.stringify({ error: "Please provide either a client ID or client first and last name." });
        }

        const start = new Date(startAt);
        const end = addMinutes(start, service.durationMin);
        const overlapping = await storage.getOverlappingBookings(coachId, start, end);
        if (overlapping.length > 0) {
          return JSON.stringify({ error: "This time slot overlaps with an existing booking." });
        }

        const isSemiPrivate = service.name.toLowerCase().includes("semi-private");
        const booking = await storage.createBooking({
          clientId: resolvedClientId,
          coachId,
          serviceId,
          startAt: start,
          endAt: end,
          status: "CONFIRMED",
          notes: "",
          location: location || "",
          maxParticipants: isSemiPrivate ? 6 : null,
          groupDescription: "",
        });

        // Send confirmation emails to client and coach (non-blocking)
        (async () => {
          try {
            const [clientUser, coachProfile, orgBranding] = await Promise.all([
              storage.getUser(resolvedClientId),
              storage.getCoachProfile(coachId),
              getOrgBranding(organizationId),
            ]);
            const tz = (coachProfile as any)?.timezone || "America/New_York";
            const coachName = coachProfile?.user
              ? `${coachProfile.user.firstName ?? ""} ${coachProfile.user.lastName ?? ""}`.trim()
              : "Your Coach";
            const clientName = clientUser
              ? `${clientUser.firstName ?? ""} ${clientUser.lastName ?? ""}`.trim()
              : "A client";

            if (clientUser?.email) {
              sendBookingConfirmationToClient(
                clientUser.email,
                clientUser.firstName || "there",
                coachName,
                service.name,
                start,
                end,
                location || undefined,
                tz,
                orgBranding
              ).catch(() => {});
            }

            const coachEmail = (coachProfile as any)?.email || coachProfile?.user?.email;
            if (coachEmail) {
              sendBookingNotificationToCoach(
                coachEmail,
                coachProfile?.user?.firstName || "Coach",
                clientName,
                service.name,
                start,
                end,
                location || undefined,
                tz,
                orgBranding
              ).catch(() => {});
            }
          } catch (err) {
            console.error("[coach_create_session] Email notification error:", err);
          }
        })();

        return JSON.stringify({ success: true, bookingId: booking.id, message: "Session created successfully!" });
      }

      case "get_org_schedule": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view the org schedule." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context available." });

        const startDate = args.startDate ? new Date(args.startDate) : new Date();
        startDate.setHours(0, 0, 0, 0);
        const endDate = args.endDate ? new Date(args.endDate) : addDays(startDate, 7);
        endDate.setHours(23, 59, 59, 999);

        const orgBookings = await storage.getBookingsByDateRangeForOrg(organizationId, startDate, endDate);
        const filtered = args.coachId
          ? orgBookings.filter(b => b.coachId === args.coachId)
          : orgBookings;

        if (filtered.length === 0) {
          return JSON.stringify({ message: "No bookings found in that date range.", count: 0 });
        }

        return JSON.stringify({
          count: filtered.length,
          bookings: filtered.map(b => ({
            id: b.id,
            client: b.client ? `${b.client.firstName} ${b.client.lastName}` : "Walk-in",
            coach: b.coach?.user ? `${b.coach.user.firstName} ${b.coach.user.lastName}` : "Unknown Coach",
            service: b.service?.name ?? "Unknown Service",
            date: format(new Date(b.startAt), "EEEE, MMM d"),
            time: `${format(new Date(b.startAt), "h:mm a")} - ${format(new Date(b.endAt), "h:mm a")}`,
            status: b.status,
          })),
        });
      }

      case "find_inactive_clients": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view client activity." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context available." });

        const sinceDaysAgo = args.sinceDaysAgo ?? 7;
        const since = new Date();
        since.setDate(since.getDate() - sinceDaysAgo);
        since.setHours(0, 0, 0, 0);

        const inactive = await storage.findClientsWithNoBookingsSince(organizationId, since);
        if (inactive.length === 0) {
          return JSON.stringify({ message: `All clients have had a booking in the last ${sinceDaysAgo} days.`, count: 0 });
        }

        return JSON.stringify({
          count: inactive.length,
          sinceDaysAgo,
          clients: inactive.map(c => ({
            id: c.id,
            name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unknown",
            email: c.email,
            lastBookingDate: c.lastBookingDate,
          })),
        });
      }

      case "get_coach_utilization": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view utilization data." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context available." });

        const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
        const startDate = args.startDate ? new Date(args.startDate) : weekStart;
        const endDate = args.endDate ? new Date(args.endDate) : addDays(weekStart, 6);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        const utilization = await storage.getCoachUtilizationForOrg(organizationId, startDate, endDate);
        if (utilization.length === 0) {
          return JSON.stringify({ message: "No coaches found for this organization." });
        }

        const { getUtilizationStatus } = await import("./scheduling-intelligence");
        const { differenceInMinutes: diffMins } = await import("date-fns");
        const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

        const coachesWithDays = await Promise.all(utilization.map(async u => {
          const statusInfo = getUtilizationStatus(u.utilizationPct, u.availableMinutes);
          const blocks = await storage.getAvailabilityBlocks(u.coachId);
          const coachAllBookings = await storage.getCoachBookings(u.coachId);
          const weekBookings = coachAllBookings.filter(b => {
            const t = new Date(b.startAt);
            return t >= startDate && t <= endDate && b.status !== "CANCELLED";
          });

          // Separate bookings by category for accurate utilization
          const clientBookings = weekBookings.filter(b => {
            const cat = (b.service as any)?.category;
            return !cat || cat === "paid" || cat === "intro" || cat === "membership" || cat === "package_redemption" || cat === "comp";
          });
          const internalBookings = weekBookings.filter(b => (b.service as any)?.category === "internal");
          const meetingBookings = weekBookings.filter(b => (b.service as any)?.category === "meeting");
          // Utilization bookings: those where countsTowardUtilization is true (or unset, defaulting to true)
          const utilizationBookings = weekBookings.filter(b => (b.service as any)?.countsTowardUtilization !== false);

          const clientSessionHours = clientBookings.reduce((s, b) => s + diffMins(new Date(b.endAt), new Date(b.startAt)) / 60, 0);
          const internalHours = internalBookings.reduce((s, b) => s + diffMins(new Date(b.endAt), new Date(b.startAt)) / 60, 0);
          const meetingHours = meetingBookings.reduce((s, b) => s + diffMins(new Date(b.endAt), new Date(b.startAt)) / 60, 0);
          const totalBlockedHours = weekBookings.reduce((s, b) => s + diffMins(new Date(b.endAt), new Date(b.startAt)) / 60, 0);
          const utilizationMins = utilizationBookings.reduce((sum, b) => sum + diffMins(new Date(b.endAt), new Date(b.startAt)), 0);

          const dailyBreakdown: {
            date: string;
            dayOfWeek: string;
            availableHours: string;
            bookedHours: string;
            openHours: string;
            utilizationPct: number;
            statusLabel: string;
          }[] = [];

          let cursor = new Date(startDate);
          while (cursor <= endDate) {
            const dayOfWeek = (cursor.getDay() + 6) % 7;
            const dateStr = format(cursor, "yyyy-MM-dd");
            const dayBlocks = blocks.filter(b => b.dayOfWeek === dayOfWeek);

            let availMins = 0;
            for (const blk of dayBlocks) {
              const [sh, sm] = blk.startTime.split(":").map(Number);
              const [eh, em] = blk.endTime.split(":").map(Number);
              availMins += (eh * 60 + em) - (sh * 60 + sm);
            }

            const dayBookings = utilizationBookings.filter(b => format(new Date(b.startAt), "yyyy-MM-dd") === dateStr);
            const bookedMins = dayBookings.reduce((sum, b) => sum + diffMins(new Date(b.endAt), new Date(b.startAt)), 0);
            const pct = availMins > 0 ? Math.min(100, Math.round((bookedMins / availMins) * 100)) : 0;
            const dayStatus = getUtilizationStatus(pct, availMins);

            dailyBreakdown.push({
              date: format(cursor, "EEE, MMM d"),
              dayOfWeek: DAY_NAMES[dayOfWeek],
              availableHours: (availMins / 60).toFixed(1),
              bookedHours: (bookedMins / 60).toFixed(1),
              openHours: (Math.max(0, availMins - bookedMins) / 60).toFixed(1),
              utilizationPct: pct,
              statusLabel: dayStatus.statusLabel,
            });

            cursor = addDays(cursor, 1);
          }

          const adjustedUtilizationPct = u.availableMinutes > 0
            ? Math.min(100, Math.round((utilizationMins / u.availableMinutes) * 100))
            : u.utilizationPct;
          const adjustedStatusInfo = getUtilizationStatus(adjustedUtilizationPct, u.availableMinutes);

          const overloadedDays = dailyBreakdown.filter(d => d.statusLabel === "overloaded" || d.statusLabel === "high_load");
          const underbookedDays = dailyBreakdown.filter(d => d.statusLabel === "underbooked" && parseFloat(d.availableHours) > 0);

          return {
            coachName: u.coachName,
            coachId: u.coachId,
            bookedHours: (utilizationMins / 60).toFixed(1),
            availableHours: (u.availableMinutes / 60).toFixed(1),
            utilizationPct: adjustedUtilizationPct,
            openHours: (Math.max(0, u.availableMinutes - utilizationMins) / 60).toFixed(1),
            statusLabel: adjustedStatusInfo.statusLabel,
            statusMessage: adjustedStatusInfo.statusMessage,
            recommendation: adjustedStatusInfo.recommendation,
            sessionBreakdown: {
              clientSessionHours: clientSessionHours.toFixed(1),
              internalHours: internalHours.toFixed(1),
              meetingHours: meetingHours.toFixed(1),
              totalBlockedHours: totalBlockedHours.toFixed(1),
              paidSessionCount: clientBookings.filter(b => (b.service as any)?.category === "paid").length,
              introSessionCount: clientBookings.filter(b => (b.service as any)?.category === "intro").length,
              internalSessionCount: internalBookings.length,
              meetingSessionCount: meetingBookings.length,
            },
            dailyBreakdown,
            topOverloadedDays: overloadedDays.slice(0, 2).map(d => `${d.dayOfWeek} (${d.utilizationPct}%)`),
            topUnderbookedDays: underbookedDays.slice(0, 2).map(d => `${d.dayOfWeek} (${d.openHours}h open)`),
          };
        }));

        return JSON.stringify({
          period: `${format(startDate, "MMM d")} – ${format(endDate, "MMM d, yyyy")}`,
          coaches: coachesWithDays,
        });
      }

      case "identify_schedule_gaps": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view schedule gaps." });
        }
        const { coachId, numDays = 7 } = args;
        const coachProfileForTz = await storage.getCoachProfile(coachId);
        const timezone = coachProfileForTz?.timezone || "America/New_York";
        const start = args.startDate ? new Date(args.startDate) : new Date();
        const end = addDays(start, Math.min(numDays, 14));

        const blocks = await storage.getAvailabilityBlocks(coachId);
        const coachBookings = await storage.getCoachBookings(coachId);
        const activeBookings = coachBookings.filter(b => b.status !== "CANCELLED");

        const now = new Date();
        const gaps: { date: string; openBlocks: string[] }[] = [];
        let current = new Date(start);

        while (current <= end) {
          const zonedCurrent = toZonedTime(current, timezone);
          const dayOfWeek = (zonedCurrent.getDay() + 6) % 7;
          const dayBlocks = blocks.filter(b => b.dayOfWeek === dayOfWeek);
          const dayStr = format(zonedCurrent, "EEEE, MMM d");
          const openBlocks: string[] = [];

          for (const block of dayBlocks) {
            const [startH, startM] = block.startTime.split(":").map(Number);
            const [endH, endM] = block.endTime.split(":").map(Number);

            const localStart = new Date(zonedCurrent);
            localStart.setHours(startH, startM, 0, 0);
            const localEnd = new Date(zonedCurrent);
            localEnd.setHours(endH, endM, 0, 0);

            const blockStartUTC = fromZonedTime(localStart, timezone);
            const blockEndUTC = fromZonedTime(localEnd, timezone);
            if (blockEndUTC <= now) continue;

            const bookedInBlock = activeBookings.filter(b => {
              const bStart = new Date(b.startAt).getTime();
              const bEnd = new Date(b.endAt).getTime();
              return bStart < blockEndUTC.getTime() && bEnd > blockStartUTC.getTime();
            });

            const totalMins = (blockEndUTC.getTime() - blockStartUTC.getTime()) / 60000;
            const bookedMins = bookedInBlock.reduce((sum, b) => {
              return sum + (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60000;
            }, 0);
            const freeMins = totalMins - bookedMins;

            if (freeMins >= 30) {
              const localStartZoned = toZonedTime(blockStartUTC, timezone);
              const localEndZoned = toZonedTime(blockEndUTC, timezone);
              openBlocks.push(
                `${format(localStartZoned, "h:mm a")}–${format(localEndZoned, "h:mm a")} (~${Math.round(freeMins)} min free)`
              );
            }
          }

          if (openBlocks.length > 0) {
            gaps.push({ date: dayStr, openBlocks });
          }
          current = addDays(current, 1);
        }

        if (gaps.length === 0) {
          return JSON.stringify({ message: "No significant open blocks found in that range." });
        }
        return JSON.stringify({ gaps });
      }

      case "reschedule_booking": {
        if (args.confirmed !== true) {
          const pending = createPendingAction(userId, "reschedule_booking", {
            bookingId: args.bookingId,
            newStartAt: args.newStartAt,
            newEndAt: args.newEndAt,
          });
          return JSON.stringify({
            requiresConfirmation: true,
            pendingActionId: pending.pendingActionId,
            actionType: "reschedule_booking",
            summary: `Reschedule booking ${args.bookingId} to ${args.newStartAt}`,
            expiresAt: pending.expiresAt.toISOString(),
            message: "Show the user the current booking and the proposed new time. Once they confirm, call reschedule_booking again with confirmed: true and the exact pendingActionId from this response.",
          });
        }
        const pendingActionId_reschedule: string | undefined = args.pendingActionId;
        if (!pendingActionId_reschedule) {
          return JSON.stringify({ error: "pendingActionId is required when confirmed is true. Call reschedule_booking with confirmed: false first to generate one." });
        }
        const statusReschedule = getPendingActionStatus(pendingActionId_reschedule);
        if (statusReschedule.status === "expired") {
          return JSON.stringify({ error: "pending_action_expired", message: "This action has expired. Please review and confirm again." });
        }
        if (statusReschedule.status === "not_found") {
          return JSON.stringify({ error: "pendingActionId not found. Call reschedule_booking with confirmed: false first to generate one." });
        }
        const pendingReschedule = statusReschedule.action;
        const pvReschedule = validatePendingAction(pendingReschedule, userId, "reschedule_booking", args);
        if (!pvReschedule.valid) return JSON.stringify({ error: pvReschedule.error });
        consumePendingAction(pendingActionId_reschedule);
        const { bookingId, newStartAt, newEndAt } = args;
        const booking = await storage.getBooking(bookingId);
        if (!booking) return JSON.stringify({ error: "Booking not found." });
        const isBookingOwner = userId != null && booking.clientId === userId;
        if (!isBookingOwner && userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "You can only reschedule your own bookings." });
        }

        const newStart = new Date(newStartAt);
        const newEnd = new Date(newEndAt);
        const overlapping = await storage.getOverlappingBookings(booking.coachId, newStart, newEnd, bookingId);
        if (overlapping.length > 0) {
          return JSON.stringify({ error: "That time slot overlaps with an existing booking. Please choose a different time." });
        }

        await storage.updateBooking(bookingId, { startAt: newStart, endAt: newEnd });
        await storage.updateBookingStatus(bookingId, "RESCHEDULED");
        return JSON.stringify({
          success: true,
          message: `Booking rescheduled to ${format(newStart, "EEEE, MMM d 'at' h:mm a")}.`,
        });
      }

      case "find_client": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can search clients." });
        }

        const clientQuery = (args.query ?? "").trim();
        console.log(`[find_client] query="${clientQuery}" organizationId=${organizationId}`);

        if (!organizationId) {
          return JSON.stringify({ error: "No organization context. Cannot search clients." });
        }

        // Primary: org-scoped search (joins userProfiles, filters by org, word-level ilike)
        let results = await storage.searchClientsByOrg(clientQuery, organizationId);

        console.log(`[find_client] org-scoped results count=${results.length}`, results.map(u => `${u.firstName} ${u.lastName}`));

        // Fallback: if org-scoped returns nothing, try the unscoped search
        if (results.length === 0) {
          results = await storage.searchUsers(clientQuery);
          console.log(`[find_client] fallback unscoped results count=${results.length}`);
        }

        if (results.length === 0) {
          return JSON.stringify({
            found: false,
            message: `No client found matching "${clientQuery}". They may not be registered in this organization.`,
          });
        }

        // Similarity scoring: rank results by how well they match the query
        const queryLower = clientQuery.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter((w: string) => w.length > 0);

        const scored = results.map(u => {
          const fullName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim().toLowerCase();
          const firstName = (u.firstName ?? "").toLowerCase();
          const lastName = (u.lastName ?? "").toLowerCase();
          const email = (u.email ?? "").toLowerCase();

          let score = 0;

          // Exact full name match
          if (fullName === queryLower) score += 100;
          // Full name contains query
          else if (fullName.includes(queryLower)) score += 60;
          // Query contains full name
          else if (queryLower.includes(fullName) && fullName.length > 0) score += 50;

          // Per-word scoring
          for (const word of queryWords) {
            if (firstName === word) score += 30;
            else if (firstName.includes(word)) score += 15;
            if (lastName === word) score += 30;
            else if (lastName.includes(word)) score += 15;
            if (email.includes(word)) score += 5;
          }

          return { user: u, score };
        });

        scored.sort((a, b) => b.score - a.score);

        const top = scored.slice(0, 5);
        const best = top[0];
        const highConfidence = best.score >= 60;

        const mapped = top.map(({ user: u, score }) => ({
          id: u.id,
          name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
          email: u.email,
          score,
        }));

        console.log(`[find_client] top matches:`, mapped);

        return JSON.stringify({
          found: true,
          highConfidence,
          matches: mapped,
          message: highConfidence
            ? `Found client: ${mapped[0].name}.`
            : `Found ${mapped.length} possible match(es) for "${clientQuery}". Please confirm which client to use.`,
        });
      }

      case "get_revenue_summary": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view revenue data." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeRevenueSummary } = await import("./revenue-intelligence");
        const summary = await computeRevenueSummary(organizationId);
        return JSON.stringify({
          totalRevenue: `$${(summary.totalRevenueCents / 100).toFixed(2)}`,
          last30dRevenue: `$${(summary.last30dRevenueCents / 100).toFixed(2)}`,
          revenueGrowthPct: summary.revenueGrowthPct,
          mrr: `$${(summary.mrr / 100).toFixed(2)}`,
          activeSubscribers: summary.activeSubscribers,
          avgLtv: `$${(summary.avgLtvCents / 100).toFixed(2)}`,
          avgRevenuePerSession: `$${(summary.avgRevenuePerSessionCents / 100).toFixed(2)}`,
          totalSessions: summary.totalSessions,
          sessionsLast30d: summary.sessionsLast30d,
          churnRiskCount: summary.churnRiskCount,
          upsellOpportunityCount: summary.upsellOpportunityCount,
          sessionPackageAlertCount: summary.sessionPackageAlertCount,
          topCoaches: summary.coachRevenues.slice(0, 3).map(c => ({
            name: c.coachName,
            revenue: `$${(c.totalRevenueCents / 100).toFixed(2)}`,
            sessions: c.sessionCount,
          })),
          topClients: summary.topClients.slice(0, 3).map(c => ({
            name: c.clientName,
            revenue: `$${(c.totalRevenueCents / 100).toFixed(2)}`,
            sessions: c.sessionCount,
          })),
          bestTimeBlocks: summary.timeBlockRevenues
            .sort((a, b) => b.totalRevenueCents - a.totalRevenueCents)
            .slice(0, 3)
            .map(tb => ({ hour: tb.label, revenue: `$${(tb.totalRevenueCents / 100).toFixed(2)}`, sessions: tb.sessionCount })),
          timezone: summary.timezone,
          timezoneLabel: `Times shown in org timezone: ${summary.timezone}`,
        });
      }

      case "get_churn_risks": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view churn risks." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeChurnRisks } = await import("./revenue-intelligence");
        const risks = await computeChurnRisks(organizationId);
        if (risks.length === 0) return JSON.stringify({ message: "No clients currently flagged as churn risks. Great retention!" });
        return JSON.stringify({
          total: risks.length,
          highRisk: risks.filter(r => r.riskLevel === "high").length,
          clients: risks.slice(0, 8).map(r => ({
            name: r.clientName,
            riskLevel: r.riskLevel,
            signals: r.signals,
            daysSinceLastBooking: r.daysSinceLastBooking,
            suggestedAction: r.suggestedAction,
          })),
        });
      }

      case "get_upsell_opportunities": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view upsell opportunities." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeUpsellOpportunities } = await import("./revenue-intelligence");
        const opps = await computeUpsellOpportunities(organizationId);
        if (opps.length === 0) return JSON.stringify({ message: "No upsell opportunities detected based on current booking patterns." });
        const totalLift = opps.reduce((s, o) => s + o.estimatedRevenueLiftCents, 0);
        return JSON.stringify({
          total: opps.length,
          estimatedTotalMonthlyLift: `$${(totalLift / 100).toFixed(2)}`,
          opportunities: opps.slice(0, 6).map(o => ({
            client: o.clientName,
            currentPattern: o.currentPattern,
            opportunity: o.opportunity,
            estimatedLift: `$${(o.estimatedRevenueLiftCents / 100).toFixed(2)}/mo`,
            reasoning: o.reasoning,
            priority: o.priority,
          })),
        });
      }

      case "get_client_value": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view client LTV data." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeClientLTVs } = await import("./revenue-intelligence");
        const ltvs = await computeClientLTVs(organizationId);
        if (ltvs.length === 0) return JSON.stringify({ message: "No client revenue data found." });
        const avgLtv = ltvs.reduce((s, c) => s + c.totalRevenueCents, 0) / ltvs.length;
        return JSON.stringify({
          totalClients: ltvs.length,
          avgLtv: `$${(avgLtv / 100).toFixed(2)}`,
          topClients: ltvs.slice(0, 5).map(c => ({
            name: c.clientName,
            totalRevenue: `$${(c.totalRevenueCents / 100).toFixed(2)}`,
            sessions: c.sessionCount,
            monthlyAvg: `$${(c.monthlyAvgSpendCents / 100).toFixed(2)}/mo`,
            retention: `${c.retentionDays} days`,
            churnRisk: c.churnRisk,
            isSubscriber: c.isSubscriber,
          })),
          atRisk: ltvs.filter(c => c.churnRisk !== "none").map(c => ({
            name: c.clientName,
            totalRevenue: `$${(c.totalRevenueCents / 100).toFixed(2)}`,
            churnRisk: c.churnRisk,
            signals: c.churnSignals,
          })).slice(0, 5),
        });
      }

      case "get_session_packages": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view session package alerts." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeSessionPackageAlerts } = await import("./revenue-intelligence");
        const alerts = await computeSessionPackageAlerts(organizationId);
        if (alerts.length === 0) return JSON.stringify({ message: "All clients have healthy session balances — no package alerts at this time." });
        return JSON.stringify({
          total: alerts.length,
          critical: alerts.filter(a => a.urgency === "critical").length,
          alerts: alerts.slice(0, 8).map(a => ({
            client: a.clientName,
            plan: a.planName,
            sessionsRemaining: a.sessionsRemaining,
            cancelAtPeriodEnd: a.cancelAtPeriodEnd,
            status: a.subscriptionStatus,
            urgency: a.urgency,
            action: a.cancelAtPeriodEnd
              ? `Contact ${a.clientName} about renewing before subscription cancels`
              : a.sessionsRemaining <= 0
                ? `${a.clientName} has 0 sessions left — prompt renewal now`
                : `${a.clientName} has ${a.sessionsRemaining} session${a.sessionsRemaining === 1 ? "" : "s"} remaining — send renewal reminder`,
          })),
        });
      }

      case "get_operations_digest": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view the operations digest." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeOrgDigest } = await import("./scheduling-intelligence");
        const digest = await computeOrgDigest(organizationId);
        return JSON.stringify(digest);
      }

      case "get_weekly_business_recap": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view the business recap." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });

        const now = new Date();
        const wkStart = startOfWeek(now, { weekStartsOn: 1 });
        const wkEnd = addDays(wkStart, 6);
        wkEnd.setHours(23, 59, 59, 999);
        const lwStart = addDays(wkStart, -7);
        const lwEnd = addDays(wkStart, -1);
        lwEnd.setHours(23, 59, 59, 999);

        const { computeRevenueByPeriod, computeRevenueForecast, computeChurnRisks, computeUpsellOpportunities } = await import("./revenue-intelligence");
        const { computeOrgDigest } = await import("./scheduling-intelligence");

        const [revenueThisWeek, digest, churnRisks, upsellOps] = await Promise.all([
          computeRevenueByPeriod(organizationId, wkStart, wkEnd, "Last week", lwStart, lwEnd),
          computeOrgDigest(organizationId),
          computeChurnRisks(organizationId),
          computeUpsellOpportunities(organizationId),
        ]);

        const weekBookings = await storage.getBookingsByDateRangeForOrg(organizationId, wkStart, wkEnd);
        const completed = weekBookings.filter(b => b.status === "COMPLETED").length;
        const cancelled = weekBookings.filter(b => b.status === "CANCELLED").length;
        const confirmed = weekBookings.filter(b => b.status === "CONFIRMED").length;

        const overloadedCoaches = digest.coaches.filter(c => c.statusLabel === "overloaded" || c.statusLabel === "high_load");
        const underbookedCoaches = digest.coaches.filter(c => c.statusLabel === "underbooked");
        const highRiskClients = churnRisks.filter(c => c.riskLevel === "high");
        const topUpsells = upsellOps.filter(u => u.priority === "high").slice(0, 3);

        const revenueDir = revenueThisWeek.comparison?.direction ?? "flat";
        const revenueDelta = revenueThisWeek.comparison
          ? `${revenueDir === "up" ? "+" : ""}$${Math.abs(revenueThisWeek.comparison.deltaCents / 100).toFixed(0)} vs last week`
          : "No prior week data";
        const weekRevFmt = `$${(revenueThisWeek.totalRevenueCents / 100).toFixed(0)}`;

        const nextActions: string[] = [];
        if (highRiskClients.length > 0) nextActions.push(`Reach out to ${highRiskClients.length} high-risk client${highRiskClients.length !== 1 ? "s" : ""}: ${highRiskClients.slice(0, 2).map(c => c.clientName).join(", ")}`);
        if (digest.openSlotsThisWeek > 0) nextActions.push(`Fill ${digest.openSlotsThisWeek} open slot${digest.openSlotsThisWeek !== 1 ? "s" : ""} (~$${digest.estimatedOpenRevenue.toLocaleString()} potential)`);
        if (topUpsells.length > 0) nextActions.push(`Upsell ${topUpsells[0].clientName}: ${topUpsells[0].opportunity}`);
        if (overloadedCoaches.length > 0 && nextActions.length < 3) nextActions.push(`Review ${overloadedCoaches[0].coachName}'s schedule — at or near overload capacity`);

        return JSON.stringify({
          weekOf: `${format(wkStart, "MMM d")} – ${format(wkEnd, "MMM d, yyyy")}`,
          headline: {
            revenueThisWeek: weekRevFmt,
            vsLastWeek: revenueDelta,
            direction: revenueDir,
          },
          whatHappened: {
            sessionsCompleted: completed,
            sessionsConfirmedUpcoming: confirmed,
            cancellations: cancelled,
            openSlots: digest.openSlotsThisWeek,
            estimatedMissedRevenue: `$${digest.estimatedOpenRevenue.toLocaleString()}`,
          },
          risks: {
            highRiskClients: highRiskClients.slice(0, 3).map(c => ({ name: c.clientName, signal: c.signals[0] ?? "", daysSince: c.daysSinceLastBooking })),
            overloadedCoaches: overloadedCoaches.map(c => ({ name: c.coachName, pct: `${c.utilizationPct}%`, status: c.statusLabel })),
          },
          opportunities: {
            upsellTargets: topUpsells.map(u => ({ client: u.clientName, opportunity: u.opportunity, estimatedLift: `$${(u.estimatedRevenueLiftCents / 100).toFixed(0)}/mo` })),
            underbookedCoaches: underbookedCoaches.map(c => ({ name: c.coachName, openSlots: c.openSlots })),
            waitlistCount: digest.waitlistCount,
          },
          nextActions: nextActions.slice(0, 3),
          generatedAt: now.toISOString(),
        });
      }

      case "get_waitlist": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view the waitlist." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const entries = await storage.getWaitlistByOrganization(organizationId);
        if (entries.length === 0) return JSON.stringify({ message: "The waitlist is empty." });
        return JSON.stringify(entries.map(e => ({
          id: e.id,
          client: e.client ? `${e.client.firstName ?? ""} ${e.client.lastName ?? ""}`.trim() : "Unknown",
          clientId: e.clientId,
          sessionType: e.sessionType,
          notes: e.notes,
          addedAt: e.createdAt,
        })));
      }

      case "add_to_waitlist": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can add to the waitlist." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const entry = await storage.addToWaitlist({
          organizationId,
          clientId: args.clientId,
          coachId: args.coachId ?? null,
          sessionType: args.sessionType ?? null,
          preferredDays: null,
          preferredTimeStart: null,
          preferredTimeEnd: null,
          notes: args.notes ?? "",
        });
        await storage.logAgentAction({
          organizationId,
          actionType: "add_to_waitlist",
          description: `Added client ${args.clientId} to waitlist${args.sessionType ? ` for ${args.sessionType}` : ""}`,
          payload: args,
          undone: false,
        });
        return JSON.stringify({ success: true, id: entry.id, message: "Client added to the waitlist." });
      }

      case "suggest_backfill": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can suggest backfill." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const slotTime = new Date(args.startAt);
        const dayOfWeek = slotTime.getDay();
        const hour = slotTime.getHours();
        const waitlistClients = await storage.getWaitlistByOrganization(organizationId);
        if (waitlistClients.length === 0) {
          return JSON.stringify({ message: "No clients on the waitlist to suggest for backfill.", suggestions: [] });
        }
        const matches = waitlistClients.filter(e => {
          if (args.coachId && e.coachId && e.coachId !== args.coachId) return false;
          if (args.sessionType && e.sessionType && !e.sessionType.toLowerCase().includes(args.sessionType.toLowerCase())) return false;
          if (e.preferredDays && !e.preferredDays.includes(dayOfWeek)) return false;
          if (e.preferredTimeStart) {
            const [ph, pm] = e.preferredTimeStart.split(":").map(Number);
            if (hour < ph) return false;
          }
          if (e.preferredTimeEnd) {
            const [eh, em] = e.preferredTimeEnd.split(":").map(Number);
            if (hour >= eh) return false;
          }
          return true;
        });
        const suggestions = (matches.length > 0 ? matches : waitlistClients).slice(0, 3).map(e => ({
          waitlistId: e.id,
          client: e.client ? `${e.client.firstName ?? ""} ${e.client.lastName ?? ""}`.trim() : "Unknown",
          clientId: e.clientId,
          sessionType: e.sessionType,
          notes: e.notes,
          matchReason: matches.includes(e) ? "Preferences matched slot" : "No preference match — waitlist order",
        }));
        return JSON.stringify({
          slot: format(slotTime, "EEEE, MMM d 'at' h:mm a"),
          suggestions,
          message: `Found ${suggestions.length} waitlist candidate${suggestions.length !== 1 ? "s" : ""} for this slot.`,
        });
      }

      case "send_scheduling_inquiry": {
        if (args.confirmed !== true) {
          const pending = createPendingAction(userId, "send_scheduling_inquiry", { message: args.message });
          return JSON.stringify({
            requiresConfirmation: true,
            pendingActionId: pending.pendingActionId,
            actionType: "send_scheduling_inquiry",
            summary: `Send scheduling inquiry: "${String(args.message).slice(0, 80)}${String(args.message).length > 80 ? "…" : ""}"`,
            expiresAt: pending.expiresAt.toISOString(),
            message: "Restate the recipient and message content to the user and ask them to confirm. Once confirmed, call send_scheduling_inquiry again with confirmed: true and the exact pendingActionId from this response.",
          });
        }
        const pendingActionId_inquiry: string | undefined = args.pendingActionId;
        if (!pendingActionId_inquiry) {
          return JSON.stringify({ error: "pendingActionId is required when confirmed is true. Call send_scheduling_inquiry with confirmed: false first to generate one." });
        }
        const statusInquiry = getPendingActionStatus(pendingActionId_inquiry);
        if (statusInquiry.status === "expired") {
          return JSON.stringify({ error: "pending_action_expired", message: "This action has expired. Please review and confirm again." });
        }
        if (statusInquiry.status === "not_found") {
          return JSON.stringify({ error: "pendingActionId not found. Call send_scheduling_inquiry with confirmed: false first to generate one." });
        }
        const pendingInquiry = statusInquiry.action;
        const pvInquiry = validatePendingAction(pendingInquiry, userId, "send_scheduling_inquiry", args);
        if (!pvInquiry.valid) return JSON.stringify({ error: pvInquiry.error });
        consumePendingAction(pendingActionId_inquiry);
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const org = await storage.getOrganizationById(organizationId);
        if (!org) return JSON.stringify({ error: "Organization not found." });

        if (!org.allowUserInquiryEmails) {
          return JSON.stringify({ error: "Scheduling inquiries are not enabled for this organization." });
        }
        if (!org.schedulingInquiryEmail) {
          return JSON.stringify({ error: "No scheduling contact email configured for this organization." });
        }

        const contactName = org.schedulingInquiryName || "the scheduling team";
        const contactEmail = org.schedulingInquiryEmail;
        const orgBranding = await getOrgBranding(organizationId);

        let senderName: string | undefined;
        let senderEmail: string | undefined;
        if (userId) {
          const senderUser = await storage.getUser(userId);
          if (senderUser) {
            senderName = `${senderUser.firstName ?? ""} ${senderUser.lastName ?? ""}`.trim() || undefined;
            senderEmail = senderUser.email || undefined;
          }
        }

        await sendSchedulingInquiryEmail(
          contactEmail,
          org.schedulingInquiryName || "Scheduling Team",
          args.message,
          senderName,
          senderEmail,
          orgBranding
        );

        console.log(`[send_scheduling_inquiry] Sent inquiry to ${contactEmail} from user ${userId}`);
        return JSON.stringify({
          success: true,
          message: `Your inquiry has been sent to ${contactName}. They'll follow up with you soon.`,
        });
      }

      case "get_revenue_by_period": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view revenue data." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeRevenueByPeriod } = await import("./revenue-intelligence");

        const now = new Date();
        const period = args.period ?? "this_week";
        const shouldCompare = args.compare !== false;

        let startDate: Date;
        let endDate: Date;
        let periodLabel: string;
        let compareStart: Date | undefined;
        let compareEnd: Date | undefined;
        let comparePeriodLabel: string | undefined;

        if (period === "this_week") {
          const ws = startOfWeek(now, { weekStartsOn: 1 });
          startDate = new Date(ws); startDate.setHours(0, 0, 0, 0);
          endDate = addDays(ws, 6); endDate.setHours(23, 59, 59, 999);
          periodLabel = `This week (${format(startDate, "MMM d")} – ${format(endDate, "MMM d")})`;
          if (shouldCompare) {
            compareStart = addDays(ws, -7); compareStart.setHours(0, 0, 0, 0);
            compareEnd = addDays(ws, -1); compareEnd.setHours(23, 59, 59, 999);
            comparePeriodLabel = `Last week (${format(compareStart, "MMM d")} – ${format(compareEnd, "MMM d")})`;
          }
        } else if (period === "last_week") {
          const thisWs = startOfWeek(now, { weekStartsOn: 1 });
          startDate = addDays(thisWs, -7); startDate.setHours(0, 0, 0, 0);
          endDate = addDays(thisWs, -1); endDate.setHours(23, 59, 59, 999);
          periodLabel = `Last week (${format(startDate, "MMM d")} – ${format(endDate, "MMM d")})`;
          if (shouldCompare) {
            compareStart = addDays(startDate, -7); compareStart.setHours(0, 0, 0, 0);
            compareEnd = addDays(endDate, -7); compareEnd.setHours(23, 59, 59, 999);
            comparePeriodLabel = `Two weeks ago`;
          }
        } else if (period === "this_month") {
          startDate = startOfMonth(now);
          endDate = endOfMonth(now);
          periodLabel = format(now, "MMMM yyyy");
          if (shouldCompare) {
            const lmDay = addDays(startDate, -1);
            compareStart = startOfMonth(lmDay);
            compareEnd = endOfMonth(lmDay);
            comparePeriodLabel = format(compareStart, "MMMM yyyy");
          }
        } else if (period === "last_month") {
          const lmDay = addDays(startOfMonth(now), -1);
          startDate = startOfMonth(lmDay);
          endDate = endOfMonth(lmDay);
          periodLabel = format(startDate, "MMMM yyyy");
          if (shouldCompare) {
            const tmDay = addDays(startDate, -1);
            compareStart = startOfMonth(tmDay);
            compareEnd = endOfMonth(tmDay);
            comparePeriodLabel = format(compareStart, "MMMM yyyy");
          }
        } else {
          if (!args.startDate || !args.endDate) {
            return JSON.stringify({ error: "startDate and endDate are required for a custom period." });
          }
          startDate = new Date(args.startDate);
          endDate = new Date(args.endDate);
          periodLabel = `${format(startDate, "MMM d")} – ${format(endDate, "MMM d, yyyy")}`;
        }

        const summary = await computeRevenueByPeriod(
          organizationId, startDate, endDate, comparePeriodLabel, compareStart, compareEnd
        );

        return JSON.stringify({
          period: periodLabel,
          totalRevenue: `$${(summary.totalRevenueCents / 100).toFixed(2)}`,
          paidSessionRevenue: `$${(summary.totalRevenueCents / 100).toFixed(2)}`,
          sessions: summary.sessionCount,
          totalSessions: summary.totalSessionCount ?? summary.sessionCount,
          nonRevenueSessions: summary.nonRevenueSessions ?? 0,
          internalHours: summary.internalHours ?? 0,
          categoryBreakdown: (summary.categoryBreakdown ?? []).map(c => ({
            category: c.category,
            sessions: c.sessions,
            revenue: c.revenueCents > 0 ? `$${(c.revenueCents / 100).toFixed(2)}` : "$0",
          })),
          byCoach: summary.coachBreakdown.map(c => ({
            coach: c.coachName,
            revenue: `$${(c.revenueCents / 100).toFixed(2)}`,
            sessions: c.sessions,
          })),
          byService: summary.serviceBreakdown.map(s => ({
            service: s.serviceName,
            revenue: `$${(s.revenueCents / 100).toFixed(2)}`,
            sessions: s.sessions,
          })),
          comparison: summary.comparison ? {
            vs: summary.comparison.priorPeriodLabel,
            priorRevenue: `$${(summary.comparison.priorRevenueCents / 100).toFixed(2)}`,
            change: `${summary.comparison.direction === "up" ? "+" : ""}$${(summary.comparison.deltaCents / 100).toFixed(2)}`,
            changePct: `${summary.comparison.direction === "up" ? "+" : ""}${summary.comparison.deltaPct}%`,
            direction: summary.comparison.direction,
          } : null,
          note: "Revenue totals exclude internal sessions, floor hours, meetings, and $0 non-revenue categories. Payout is calculated separately per coach and service payout settings.",
        });
      }

      case "get_revenue_forecast": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view revenue forecasts." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeRevenueForecast } = await import("./revenue-intelligence");
        const targetCents = typeof args.targetCents === "number" ? args.targetCents : undefined;
        const forecast = await computeRevenueForecast(organizationId, targetCents);
        return JSON.stringify({
          month: forecast.month,
          summary: forecast.summary,
          revenueToDate: `$${(forecast.revenueToDateCents / 100).toFixed(0)}`,
          bookedFutureRevenue: `$${(forecast.bookedFutureRevenueCents / 100).toFixed(0)}`,
          subscriptionRevenue: `$${(forecast.mrrCents / 100).toFixed(0)}`,
          projectedTotal: `$${(forecast.projectedTotalCents / 100).toFixed(0)}`,
          averageSessionValue: `$${(forecast.averageSessionValueCents / 100).toFixed(0)}`,
          runRateProjection: `$${(forecast.runRateCents / 100).toFixed(0)} (based on daily run rate)`,
          daysElapsed: forecast.daysElapsed,
          daysRemaining: forecast.daysRemaining,
          confidence: forecast.confidenceLevel,
          assumptions: forecast.assumptions,
          risks: forecast.risks.length > 0 ? forecast.risks : undefined,
          ...(targetCents !== undefined ? {
            target: `$${(targetCents / 100).toFixed(0)}`,
            revenueGap: `$${((forecast.revenueGapCents ?? 0) / 100).toFixed(0)}`,
            sessionsNeeded: forecast.sessionsNeededToHitTarget ?? 0,
            sessionsPerDayNeeded: forecast.sessionsPerDayNeeded ?? 0,
            targetSummary: forecast.targetSummary,
          } : {}),
        });
      }

      case "preview_recurring_sessions": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can preview recurring sessions." });
        }
        const { clientId, coachId, serviceId, startDate, startTime, recurrencePattern, occurrences, recurrenceDays } = args;

        const service = await storage.getService(serviceId);
        if (!service) return JSON.stringify({ error: "Service not found." });

        const coach = await storage.getCoachProfile(coachId);
        if (!coach) return JSON.stringify({ error: "Coach not found." });

        const [startHour, startMinute] = (startTime as string).split(":").map(Number);
        const step = recurrencePattern === "biweekly" ? 14 : 7;

        const DAY_JS_MAP: Record<string, number> = {
          sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
          thursday: 4, friday: 5, saturday: 6,
        };

        // Helper: generate `occurrences` dates starting from the first matching weekday on or after `baseDate`
        const generateDatesForDay = (dayName: string, baseDate: Date): Date[] => {
          const targetDay = DAY_JS_MAP[dayName.toLowerCase()];
          if (targetDay === undefined) return [];
          const base = new Date(baseDate);
          base.setHours(startHour, startMinute, 0, 0);
          const currentDay = base.getDay();
          const daysUntil = (targetDay - currentDay + 7) % 7;
          let first = addDays(base, daysUntil);
          first.setHours(startHour, startMinute, 0, 0);
          const result: Date[] = [];
          let cur = new Date(first);
          for (let i = 0; i < occurrences; i++) {
            result.push(new Date(cur));
            cur = addDays(cur, step);
          }
          return result;
        };

        // Determine which days to schedule
        const daysToSchedule: string[] = Array.isArray(recurrenceDays) && recurrenceDays.length > 0
          ? (recurrenceDays as string[]).map((d: string) => d.toLowerCase())
          : [];  // single-day mode uses startDate directly

        const refDate = new Date(startDate);

        type SlotResult = { startAt: string; endAt: string; dateLabel: string };
        type ConflictResult = { dateLabel: string; reason: string };

        if (daysToSchedule.length > 0) {
          // Multi-day mode: generate and check per-day groups
          const groupedAvailable: Record<string, SlotResult[]> = {};
          const groupedConflicts: Record<string, ConflictResult[]> = {};
          let totalDates = 0;
          let totalAvailable = 0;
          let totalConflicts = 0;

          for (const dayName of daysToSchedule) {
            const dates = generateDatesForDay(dayName, refDate);
            const dayAvailable: SlotResult[] = [];
            const dayConflicts: ConflictResult[] = [];

            for (const date of dates) {
              totalDates++;
              const endAt = addMinutes(date, service.durationMin);
              const dateLabel = format(date, "EEEE, MMM d 'at' h:mm a");
              const overlapping = await storage.getOverlappingBookings(coachId, date, endAt);
              if (overlapping.length > 0) {
                dayConflicts.push({ dateLabel, reason: "Overlaps with an existing booking" });
                totalConflicts++;
              } else {
                dayAvailable.push({ startAt: date.toISOString(), endAt: endAt.toISOString(), dateLabel });
                totalAvailable++;
              }
            }
            groupedAvailable[dayName] = dayAvailable;
            groupedConflicts[dayName] = dayConflicts;
          }

          const allAvailableSlots: SlotResult[] = Object.values(groupedAvailable).flat();

          return JSON.stringify({
            service: service.name,
            durationMin: service.durationMin,
            pattern: `${recurrencePattern}, ${occurrences} sessions per day (${daysToSchedule.join(" + ")})`,
            totalDates,
            byDay: daysToSchedule.map(day => ({
              day: day.charAt(0).toUpperCase() + day.slice(1),
              available: groupedAvailable[day] ?? [],
              conflicts: groupedConflicts[day] ?? [],
            })),
            allAvailableSlots,
            summary: `${totalAvailable} of ${totalDates} dates are open${totalConflicts > 0 ? `, ${totalConflicts} conflict${totalConflicts !== 1 ? "s" : ""} found` : " with no conflicts"}.`,
            instruction: "Present this multi-day plan to the coach. List available dates per day and flag conflicts. Ask them to confirm before booking. Pass allAvailableSlots to create_confirmed_recurring_sessions as confirmedSlots.",
          });
        }

        // Single-day mode (original behavior)
        const base = new Date(refDate);
        base.setHours(startHour, startMinute, 0, 0);

        const dates: Date[] = [];
        let cur = new Date(base);
        for (let i = 0; i < occurrences; i++) {
          dates.push(new Date(cur));
          cur = addDays(cur, step);
        }

        const available: SlotResult[] = [];
        const conflicts: ConflictResult[] = [];

        for (const date of dates) {
          const endAt = addMinutes(date, service.durationMin);
          const dateLabel = format(date, "EEEE, MMM d 'at' h:mm a");
          const overlapping = await storage.getOverlappingBookings(coachId, date, endAt);
          if (overlapping.length > 0) {
            conflicts.push({ dateLabel, reason: "Overlaps with an existing booking" });
          } else {
            available.push({ startAt: date.toISOString(), endAt: endAt.toISOString(), dateLabel });
          }
        }

        return JSON.stringify({
          service: service.name,
          durationMin: service.durationMin,
          pattern: `${recurrencePattern}, ${occurrences} sessions`,
          totalDates: dates.length,
          available,
          conflicts,
          summary: `${available.length} of ${dates.length} dates are open${conflicts.length > 0 ? `, ${conflicts.length} conflict${conflicts.length !== 1 ? "s" : ""} found` : " with no conflicts"}.`,
          instruction: "Present this plan to the coach clearly. List available dates and note any conflicts. Ask them to confirm before booking.",
        });
      }

      case "create_confirmed_recurring_sessions": {
        if (args.confirmed !== true) {
          const slots = Array.isArray(args.confirmedSlots) ? args.confirmedSlots : [];
          const pending = createPendingAction(userId, "create_confirmed_recurring_sessions", {
            clientId: args.clientId,
            coachId: args.coachId,
            serviceId: args.serviceId,
            slotCount: slots.length,
          });
          return JSON.stringify({
            requiresConfirmation: true,
            pendingActionId: pending.pendingActionId,
            actionType: "create_confirmed_recurring_sessions",
            summary: `Create ${slots.length} recurring session(s) for client ${args.clientId}, service ${args.serviceId}`,
            expiresAt: pending.expiresAt.toISOString(),
            message: "Show the coach the full list of slots to be created and ask them to confirm. Once confirmed, call create_confirmed_recurring_sessions again with confirmed: true and the exact pendingActionId from this response.",
          });
        }
        const pendingActionId_recurring: string | undefined = args.pendingActionId;
        if (!pendingActionId_recurring) {
          return JSON.stringify({ error: "pendingActionId is required when confirmed is true. Call create_confirmed_recurring_sessions with confirmed: false first to generate one." });
        }
        const statusRecurring = getPendingActionStatus(pendingActionId_recurring);
        if (statusRecurring.status === "expired") {
          return JSON.stringify({ error: "pending_action_expired", message: "This action has expired. Please review and confirm again." });
        }
        if (statusRecurring.status === "not_found") {
          return JSON.stringify({ error: "pendingActionId not found. Call create_confirmed_recurring_sessions with confirmed: false first to generate one." });
        }
        const pendingRecurring = statusRecurring.action;
        const pvRecurring = validatePendingAction(pendingRecurring, userId, "create_confirmed_recurring_sessions", args);
        if (!pvRecurring.valid) return JSON.stringify({ error: pvRecurring.error });
        consumePendingAction(pendingActionId_recurring);
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can create sessions." });
        }
        const { clientId, coachId, serviceId, confirmedSlots, location } = args;

        const service = await storage.getService(serviceId);
        if (!service) return JSON.stringify({ error: "Service not found." });

        const isSemiPrivate = service.name.toLowerCase().includes("semi-private");
        const created: string[] = [];
        const failedDates: { dateLabel: string; reason: string }[] = [];

        for (const slot of (confirmedSlots as { startAt: string; endAt: string }[])) {
          const start = new Date(slot.startAt);
          const end = new Date(slot.endAt);
          const dateLabel = format(start, "EEEE, MMM d 'at' h:mm a");
          try {
            const overlapping = await storage.getOverlappingBookings(coachId, start, end);
            if (overlapping.length > 0) {
              failedDates.push({ dateLabel, reason: "Conflict detected — slot now taken" });
              continue;
            }
            const booking = await storage.createBooking({
              clientId,
              coachId,
              serviceId,
              startAt: start,
              endAt: end,
              status: "CONFIRMED",
              notes: "",
              location: location || "",
              maxParticipants: isSemiPrivate ? 6 : null,
              groupDescription: "",
            });
            created.push(dateLabel);
          } catch (err: any) {
            failedDates.push({ dateLabel, reason: err.message || "Unknown error" });
          }
        }

        if (organizationId) {
          await storage.logAgentAction({
            organizationId,
            actionType: "create_recurring_sessions",
            description: `Created ${created.length} recurring sessions for client ${clientId} with coach ${coachId}`,
            payload: { clientId, coachId, serviceId, created: created.length, failed: failedDates.length },
            undone: false,
          }).catch(() => {});
        }

        return JSON.stringify({
          success: true,
          created: created.length,
          failed: failedDates.length,
          sessions: created,
          failedDates: failedDates.length > 0 ? failedDates : undefined,
          message: `${created.length} session${created.length !== 1 ? "s" : ""} booked successfully${failedDates.length > 0 ? `. ${failedDates.length} date${failedDates.length !== 1 ? "s" : ""} had conflicts and were skipped.` : "."}`,
        });
      }

      case "draft_client_outreach": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can draft outreach messages." });
        }
        const { clientId, reason, goal, tone = "friendly", context = "", targetSlot } = args;

        const clientUser = await storage.getUser(clientId);
        if (!clientUser) return JSON.stringify({ error: "Client not found." });

        const clientName = `${clientUser.firstName ?? ""} ${clientUser.lastName ?? ""}`.trim();
        const email = clientUser.email;

        let sessionContext = "";
        let lastSessionInfo = "";
        try {
          if (organizationId) {
            const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
            const orgBookings = await storage.getBookingsByDateRangeForOrg(organizationId, since, new Date());
            const clientBookings = orgBookings
              .filter(b => b.clientId === clientId && b.status !== "CANCELLED")
              .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
            if (clientBookings.length > 0) {
              const last = clientBookings[0];
              const daysSince = Math.floor((Date.now() - new Date(last.startAt).getTime()) / 86400000);
              lastSessionInfo = `Last session: ${format(new Date(last.startAt), "MMM d")} (${daysSince} days ago)`;
              sessionContext = `${clientBookings.length} sessions in last 90 days. Last session was ${daysSince} days ago.`;
            }
          }
        } catch (_) {}

        const reasonLabels: Record<string, string> = {
          churn_risk: "this client is at risk of churning based on inactivity or frequency drop",
          inactive: "this client hasn't booked recently",
          low_sessions: "this client's session package is running low or expiring",
          upsell: "this client is a strong candidate for more sessions or an upgraded plan",
          backfill: "there is a recently cancelled slot this client might want to fill",
          general: "general relationship outreach",
        };

        const goalLabels: Record<string, string> = {
          rebook: "get them back on the schedule",
          upsell: "offer them more sessions or an upgraded package",
          renew_package: "renew their session package before it expires",
          fill_cancellation: "fill a recently cancelled time slot",
          check_in: "check in and reinforce the coaching relationship",
        };

        const systemMsg = `You are a coaching business assistant. Write personalized, human-sounding outreach messages for a fitness coach reaching out to a client. Keep messages concise, warm, and direct. Do not use emojis. Do not be salesy. Keep the SMS under 155 characters — count carefully, this is a hard limit. Return valid JSON only.`;

        const slotLine = targetSlot ? `Open slot to fill: ${targetSlot} — the message must reference this specific time.` : "";

        const userMsg = `Draft an outreach message to a client named ${clientName}.
Reason: ${reasonLabels[reason] || reason}
Goal: ${goalLabels[goal] || goal}
Tone: ${tone}
${sessionContext ? `Client session history: ${sessionContext}` : ""}
${slotLine}
${context ? `Additional context: ${context}` : ""}

Return a JSON object with exactly these keys:
- "sms": short text message (under 155 chars, no emoji, first-person coach voice${targetSlot ? `, must reference '${targetSlot}'` : ""})
- "email_subject": clear, specific subject line
- "email_body": 3-4 sentences, personal and direct
- "reasoning": one sentence explaining the message approach`;

        const completion = await openai.chat.completions.create({
          model: "gpt-5.1",
          messages: [
            { role: "system", content: systemMsg },
            { role: "user", content: userMsg },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 600,
        });

        let drafts: any = {};
        try {
          drafts = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
        } catch (_) {}

        const outreachResult = {
          client: clientName,
          email: email || "No email on file",
          lastSession: lastSessionInfo || "No session history found",
          outreachReason: reasonLabels[reason] || reason,
          outreachGoal: goalLabels[goal] || goal,
          sms: drafts.sms || "(SMS draft unavailable)",
          emailSubject: drafts.email_subject || `Checking in — ${clientName}`,
          emailBody: drafts.email_body || "(Email draft unavailable)",
          reasoning: drafts.reasoning || "",
        };

        if (organizationId) {
          createAgentAction({
            organizationId,
            clientId,
            actionType: "outreach",
            actionSubType: reason,
            status: "pending",
            clientName,
            relatedSlot: targetSlot ? { label: targetSlot } : null,
            messageContent: {
              sms: outreachResult.sms,
              emailSubject: outreachResult.emailSubject,
              emailBody: outreachResult.emailBody,
            },
            followUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }).catch(() => {});
        }

        return JSON.stringify(outreachResult);
      }

      case "get_daily_action_queue": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access the action queue." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const queue = await buildScoredDailyActionQueue(organizationId);
        return JSON.stringify(queue);
      }

      case "get_follow_up_actions": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access follow-up actions." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const followUps = await generateFollowUpActions(organizationId);
        if (followUps.length === 0) {
          return JSON.stringify({ message: "No follow-ups needed right now. All outreach has received a response or is within the 24-hour window.", items: [] });
        }
        return JSON.stringify({ count: followUps.length, items: followUps });
      }

      case "get_operator_performance_metrics": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access performance metrics." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const sinceDays = args.sinceDays ?? 30;
        const metrics = await getOperatorPerformanceMetrics(organizationId, sinceDays);
        return JSON.stringify(metrics);
      }

      case "get_action_performance_profile": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access the performance profile." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const profile = await computeActionPerformanceProfile(organizationId);
        if (profile.length === 0) {
          return JSON.stringify({ message: "No outreach data yet. Start drafting messages through the agent to build your performance profile.", profiles: [] });
        }
        return JSON.stringify({ profiles: profile, topPerformer: profile[0]?.subType ?? null, lowestPerformer: profile[profile.length - 1]?.subType ?? null });
      }

      case "get_auto_mode_status": {
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const status = await getAutoModeStatus(organizationId);
        return JSON.stringify(status);
      }

      case "set_auto_mode": {
        if (userRole !== "COACH" && userRole !== "ADMIN") {
          return JSON.stringify({ error: "Only coaches and admins can change the auto mode setting." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const level = typeof args.level === "number" ? args.level : 1;
        const newStatus = await setAutoMode(organizationId, level);
        return JSON.stringify({ success: true, newMode: newStatus, message: `Auto mode set to ${newStatus.label}. ${newStatus.description}` });
      }

      case "compute_revenue_optimization_plan": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access the revenue optimization plan." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const plan = await computeRevenueOptimizationPlan(organizationId);
        return JSON.stringify(plan);
      }

      case "get_weekly_learning_insights": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access learning insights." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const insights = await getWeeklyLearningInsights(organizationId);
        return JSON.stringify(insights);
      }

      case "get_time_performance_profile": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access time performance data." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const timeProfile = await computeTimePerformanceProfile(organizationId);
        return JSON.stringify(timeProfile);
      }

      case "get_message_variation_profile": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access message variation data." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const variationProfile = await getMessageVariationProfile(organizationId);
        return JSON.stringify(variationProfile);
      }

      case "start_campaign": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can start campaigns." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { clientId: campClientId, clientName: campClientName, campaignType, coachId: campCoachId } = args;
        if (!campClientId || !campClientName || !campaignType) {
          return JSON.stringify({ error: "clientId, clientName, and campaignType are required." });
        }
        const templateNames = Object.keys(CAMPAIGN_TEMPLATES);
        if (!templateNames.includes(campaignType)) {
          return JSON.stringify({ error: `Invalid campaignType. Choose from: ${templateNames.join(", ")}` });
        }
        const campaignResult = await startCampaign(organizationId, campClientId, campClientName, campaignType, campCoachId);
        return JSON.stringify({
          ...campaignResult,
          campaignTemplateInfo: CAMPAIGN_TEMPLATES[campaignType]
            ? `${CAMPAIGN_TEMPLATES[campaignType].totalSteps}-step campaign (${CAMPAIGN_TEMPLATES[campaignType].steps.map((s, i) => i === 0 ? "now" : `+${s.delayHours}h`).join(", ")})`
            : undefined,
        });
      }

      case "get_campaign_status": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view campaign status." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const campaignStatus = await getActiveCampaigns(organizationId);
        return JSON.stringify({
          summary: campaignStatus.summary,
          active: campaignStatus.active.map(c => ({
            campaignId: c.id,
            clientName: c.clientName,
            campaignType: c.campaignType,
            currentStep: c.currentStep,
            totalSteps: c.totalSteps,
            status: c.status,
            startedAt: c.startedAt ? format(new Date(c.startedAt), "MMM d 'at' h:mm a") : null,
            nextActionAt: c.nextActionAt ? format(new Date(c.nextActionAt), "EEEE, MMM d 'at' h:mm a") : "No further steps",
          })),
          recentlyCompleted: campaignStatus.completed.slice(0, 5).map(c => ({
            campaignId: c.id,
            clientName: c.clientName,
            campaignType: c.campaignType,
            status: c.status,
            stoppedReason: c.stoppedReason,
            completedAt: c.completedAt ? format(new Date(c.completedAt), "MMM d 'at' h:mm a") : null,
          })),
          availableCampaignTypes: Object.entries(CAMPAIGN_TEMPLATES).map(([type, t]) => ({
            type,
            steps: t.totalSteps,
            schedule: t.steps.map((s, i) => i === 0 ? "Step 1 now" : `Step ${s.step} +${s.delayHours}h`).join(", "),
          })),
        });
      }

      case "get_auto_dashboard": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view the autopilot dashboard." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const dashboard = await getAutoPilotDashboard(organizationId);
        return JSON.stringify(dashboard);
      }

      case "compute_client_response_profile": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access client response profiles." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { clientId: crpClientId } = args;
        if (!crpClientId) return JSON.stringify({ error: "clientId is required." });
        const responseProfile = await computeClientResponseProfile(crpClientId, organizationId);
        return JSON.stringify(responseProfile);
      }

      case "compute_client_segments": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access client segmentation." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const segmentation = await computeClientSegments(organizationId);
        return JSON.stringify(segmentation);
      }

      case "compute_client_ltv_score": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access client LTV data." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { clientId: ltvClientId } = args;
        if (!ltvClientId) return JSON.stringify({ error: "clientId is required." });
        const ltvScore = await computeClientLtvScore(ltvClientId, organizationId);
        return JSON.stringify(ltvScore);
      }

      case "get_strategic_recommendations": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access strategic recommendations." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const strategic = await getStrategicRecommendations(organizationId);
        return JSON.stringify(strategic);
      }

      case "set_weekly_targets": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can set weekly targets." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { revenueCents, sessions, retentionPct, utilizationPct } = args;
        if (!revenueCents && !sessions && !retentionPct && !utilizationPct) {
          return JSON.stringify({ error: "Please specify at least one target (revenueCents, sessions, retentionPct, or utilizationPct)." });
        }
        const saved = await setWeeklyTargets(organizationId, {
          ...(revenueCents ? { revenueCents: Number(revenueCents) } : {}),
          ...(sessions ? { sessions: Number(sessions) } : {}),
          ...(retentionPct ? { retentionPct: Number(retentionPct) } : {}),
          ...(utilizationPct ? { utilizationPct: Number(utilizationPct) } : {}),
        });
        return JSON.stringify({
          success: true,
          message: "Weekly targets saved. The action queue will now prioritize actions that help you hit these targets.",
          targets: saved,
          note: "These targets will automatically boost the scoring of actions that contribute to behind-target dimensions.",
        });
      }

      case "get_weekly_progress": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access weekly progress." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const progress = await getWeeklyProgress(organizationId);
        return JSON.stringify(progress);
      }

      case "get_goal_performance_summary": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can access goal performance summaries." });
        }
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const summary = await getGoalPerformanceSummary(organizationId);
        return JSON.stringify(summary);
      }

      // ── Phase 9: Revenue Optimization Engine ──
      case "get_revenue_quality": {
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeRevenueQuality } = await import("./revenue-intelligence");
        const { startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks } = await import("date-fns");
        const p9period = args.period ?? "this_week";
        const now9 = new Date();
        let rqStart: Date, rqEnd: Date;
        if (p9period === "last_week") {
          rqStart = startOfWeek(subWeeks(now9, 1), { weekStartsOn: 1 });
          rqEnd = endOfWeek(subWeeks(now9, 1), { weekStartsOn: 1 });
        } else if (p9period === "this_month") {
          rqStart = startOfMonth(now9);
          rqEnd = endOfMonth(now9);
        } else {
          rqStart = startOfWeek(now9, { weekStartsOn: 1 });
          rqEnd = endOfWeek(now9, { weekStartsOn: 1 });
        }
        const rq = await computeRevenueQuality(organizationId, rqStart, rqEnd);
        return JSON.stringify(rq);
      }

      case "get_session_mix": {
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeSessionMix } = await import("./revenue-intelligence");
        const { startOfWeek: soW, endOfWeek: eoW, startOfMonth: soM, endOfMonth: eoM, subWeeks: sw } = await import("date-fns");
        const smPeriod = args.period ?? "this_week";
        const smNow = new Date();
        let smStart: Date, smEnd: Date;
        if (smPeriod === "last_week") {
          smStart = soW(sw(smNow, 1), { weekStartsOn: 1 });
          smEnd = eoW(sw(smNow, 1), { weekStartsOn: 1 });
        } else if (smPeriod === "this_month") {
          smStart = soM(smNow);
          smEnd = eoM(smNow);
        } else {
          smStart = soW(smNow, { weekStartsOn: 1 });
          smEnd = eoW(smNow, { weekStartsOn: 1 });
        }
        const mix = await computeSessionMix(organizationId, smStart, smEnd);
        return JSON.stringify(mix);
      }

      case "get_coach_profitability": {
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeCoachProfitability } = await import("./revenue-intelligence");
        const { startOfWeek: soW2, endOfWeek: eoW2, startOfMonth: soM2, endOfMonth: eoM2, subWeeks: sw2 } = await import("date-fns");
        const cpPeriod = args.period ?? "this_week";
        const cpNow = new Date();
        let cpStart: Date, cpEnd: Date;
        if (cpPeriod === "last_week") {
          cpStart = soW2(sw2(cpNow, 1), { weekStartsOn: 1 });
          cpEnd = eoW2(sw2(cpNow, 1), { weekStartsOn: 1 });
        } else if (cpPeriod === "this_month") {
          cpStart = soM2(cpNow);
          cpEnd = eoM2(cpNow);
        } else {
          cpStart = soW2(cpNow, { weekStartsOn: 1 });
          cpEnd = eoW2(cpNow, { weekStartsOn: 1 });
        }
        const profitability = await computeCoachProfitability(organizationId, cpStart, cpEnd);
        return JSON.stringify(profitability);
      }

      case "get_revenue_pressure": {
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeDailyRevenuePressure } = await import("./revenue-intelligence");
        const pressure = await computeDailyRevenuePressure(organizationId);
        return JSON.stringify(pressure);
      }

      case "get_lost_revenue": {
        if (!organizationId) return JSON.stringify({ error: "No organization context." });
        const { computeLostRevenueOpportunities } = await import("./revenue-intelligence");
        const lost = await computeLostRevenueOpportunities(organizationId);
        return JSON.stringify(lost);
      }

      default:
        return JSON.stringify({ error: `Unknown function: ${name}` });
    }
  } catch (error: any) {
    return JSON.stringify({ error: error.message || "An error occurred" });
  }
}

function getSystemPrompt(userRole: string, userName: string | null, coachId: string | null): string {
  const today = format(new Date(), "EEEE, MMMM d, yyyy");
  const isStaff = userRole === "COACH" || userRole === "ADMIN" || userRole === "STAFF";

  let prompt = `You are the TrainEfficiency Scheduling Agent — an intelligent scheduling co-pilot for a strength & conditioning coaching business. Today is ${today}. All times are Eastern Time.

## Your Personality
You are professional, concise, and operationally sharp. You feel like a knowledgeable assistant who knows the business inside and out — not a chatbot. Avoid robotic filler phrases. Get to the point. Be helpful and direct.

Good: "I found 3 openings for next week. Want me to book one?"
Avoid: "Query complete. Here are the available time slots as requested."

## Your Core Capabilities
- **Revenue Intelligence**: Analyze total revenue, MRR, per-client LTV, revenue by coach and time block, growth trends
- **Retention & Churn**: Detect at-risk clients, flag booking frequency drops, surface subscription cancellation signals
- **Growth & Upsell**: Identify clients ready for more sessions, semi-private upgrades, and session package renewals
- **Session Packages**: Alert on clients with low or empty session balances and prompt renewal
- **Operations**: Run ops intelligence digests — open slots, utilization, inactive clients, waitlist
- **Schedule Management**: Read and display organization schedules, bookings, and availability
- **Booking Actions**: Find open slots, create, cancel, and reschedule bookings (with confirmation)

## Co-Pilot Mode (Critical Rules)
You are a SUGGESTION-FIRST assistant. All mutating actions (book_session, cancel_booking, reschedule_booking, coach_create_session, send_scheduling_inquiry, create_confirmed_recurring_sessions) use a mandatory two-call handshake:

### Two-Call Handshake Protocol
**Call 1 — Preview (confirmed: false):** Call the tool with confirmed: false and all required args. The tool returns {requiresConfirmation: true, pendingActionId, summary, message}. Present the summary clearly to the user in natural language and ask them to confirm.

**Call 2 — Execute (confirmed: true):** Only after the user explicitly says yes, call the tool again with confirmed: true AND the exact pendingActionId from Call 1. pendingActionIds expire after 10 minutes — if expired, restart from Call 1.

**Never invent a pendingActionId.** Only use the exact value returned by Call 1. Never skip Call 1 and go directly to confirmed: true.

**If a tool returns {error: "pending_action_expired"}: tell the user "That confirmation window expired — let me start fresh." Then immediately restart from Call 1 (confirmed: false) to generate a new pendingActionId and re-present the summary.**

1. **For new bookings**: Check availability first (get_available_slots or get_org_schedule), present 2–3 numbered options, then do the two-call handshake once the user picks one.
   Example: "Here are 3 open times for Mike next week:
   1. Tuesday at 9:00 AM with Coach Bryan
   2. Wednesday at 2:00 PM with Coach Bryan  
   3. Friday at 10:00 AM with Coach Hunter
   Which works best? I'll get it booked."
   User says "Option 1" → Call 1 (confirmed:false) → present summary → user confirms → Call 2 (confirmed:true + pendingActionId).

2. **For rescheduling**: Show current booking and proposed new time. Use the two-call handshake once the user agrees to the new time.

3. **For cancellations**: Restate what will be cancelled (service, coach, date, time). Use the two-call handshake once the user confirms.

4. **For availability/schedule changes**: These can be executed immediately without preview.

5. **For insights (inactive clients, utilization, gaps)**: Execute immediately and present results clearly.

## Data Rules
- Always use the org-scoped tools (get_org_schedule, find_inactive_clients, get_coach_utilization) for org-wide data
- When a user mentions a client by name, use find_client first to get their ID
- find_client returns: { found, highConfidence, matches: [{id, name, email, score}], message }
  - If found=true and highConfidence=true: auto-select the first match and proceed (say "I found [name] in your client list")
  - If found=true and highConfidence=false: show the top matches and ask which client to use
  - If found=false: tell the user no client was found with that name
- All data is scoped to this organization only`;

  if (userName) {
    prompt += `\n\n## Current User\nName: ${userName}`;
  }

  if (isStaff) {
    prompt += `\nRole: ${userRole}`;
    if (coachId) {
      prompt += `\nCoach ID: ${coachId} — When they refer to "my" schedule, availability, or sessions, use this ID automatically without asking.`;
    }
    prompt += `

## Staff Capabilities (Full Access)
- **View schedule**: use get_org_schedule for full org view, get_coach_schedule for a specific coach's day
- **Availability management**: set_availability, get_availability, delete_availability — execute immediately when requested
  - Days: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday
  - Times in 24hr format: "9am–5pm" = startTime "09:00", endTime "17:00"
  - If asked to set availability for multiple days (e.g. "Mon–Fri 9–5"), create all blocks at once
- **Book sessions**: use coach_create_session — but ONLY after presenting options and getting confirmation
- **Reschedule bookings**: use reschedule_booking — ONLY after confirming new time with user
- **Cancel bookings**: use cancel_booking — ONLY after restating what will be cancelled
- **Find clients by name**: always use find_client before booking if only a name is provided. It searches within this org. If highConfidence=true, auto-select the top match. If highConfidence=false, present top matches and ask the user to confirm. Only say "not found" if found=false.
- **Insights**: use find_inactive_clients, get_coach_utilization, identify_schedule_gaps — execute immediately

## Revenue Intelligence — Routing Rules (CRITICAL)
You have TWO revenue tools. Use the right one:

- **get_revenue_by_period** → Use for ANY question with a specific time window:
  - "What did I make this week?" → period: "this_week"
  - "How was last week?" → period: "last_week"
  - "Compare this week vs last week" → period: "this_week", compare: true
  - "What did we make this month?" → period: "this_month"
  - "How was last month?" → period: "last_month"
  - NEVER answer week-specific or month-specific revenue questions with get_revenue_summary

- **get_revenue_summary** → Use for all-time/aggregate revenue, LTV, overall business health questions (not time-specific)

- **get_revenue_forecast** → Use for forward-looking questions:
  - "What am I projected to make this month?" → call with no targetCents
  - "Am I on track?" → call with no targetCents
  - "What do I need to hit $15,000 this month?" → call with targetCents: 1500000 (NEVER compute the gap yourself — always pass it to the tool)
  - The tool returns: projectedTotal, revenueGap, sessionsNeeded, sessionsPerDayNeeded, targetSummary — present these directly

## Session Category System (CRITICAL — Revenue vs Payout Separation)
Each training option (service) has a **category** that determines how it affects revenue, utilization, and coach compensation independently:

| Category | Revenue? | Utilization? | Coach Paid? | Notes |
|---|---|---|---|---|
| **paid** | ✅ Yes | ✅ Yes | ✅ Yes (% or fixed) | Standard paid 1:1 or group session |
| **intro** | ❌ No | ✅ Yes | ⚠️ Sometimes | Free intro — counts utilization, may still pay coach |
| **internal** | ❌ No | ✅ Yes | ✅ Yes (hourly) | Floor hours, open gym supervision — pays coach by hour |
| **meeting** | ❌ No | ❌ No | ❌ No | Admin meetings — no utilization, no payout |
| **membership** | ❌ No (at booking) | ✅ Yes | ✅ Sometimes | Revenue recognized at purchase, coach paid when redeemed |
| **package_redemption** | ❌ No (at booking) | ✅ Yes | ✅ Sometimes | Pre-purchased package — same as membership |
| **comp** | ❌ No | ✅ Yes | ❌ No | Complimentary session — no revenue, no payout |

**Key rules:**
- Revenue figures ONLY count sessions where countsTowardRevenue=true (paid, membership/package at purchase)
- Coach payout is SEPARATE from client revenue — a $0 comp session can still pay the coach
- Internal (floor hours) sessions DO count toward utilization even though they generate no revenue
- When reporting revenue: never include internal/meeting/comp/intro in revenue totals unless asked specifically
- When reporting utilization: count ALL sessions (paid + internal + meeting + intro) unless told otherwise
- When a coach asks "how many hours did I work?" count ALL client-facing + internal hours separately
- get_revenue_by_period now returns categoryBreakdown — use it to distinguish revenue from non-revenue sessions
- get_coach_utilization now returns sessionBreakdown with clientSessionHours/internalHours/meetingHours

## Client Booking Lookup (CRITICAL)
Use **get_client_bookings** whenever a prompt references a client's existing session:
- "When is Sarah's next session?" → find_client → get_client_bookings(clientId, lookAheadDays: 30)
- "Make David's current session recurring" → find_client → get_client_bookings(includePast: true) → identify session → run preview
- "Reschedule John's next booking" → find_client → get_client_bookings → show the upcoming session → present alternatives
- NEVER use get_org_schedule for client-specific session lookups

## Recurring Session Booking (CRITICAL — Two-Step Process)
When a coach wants to book recurring sessions:
1. Use find_client to resolve client name → get clientId
2. Identify the service (ask if unclear)
3. Call **preview_recurring_sessions** — this checks all dates for conflicts WITHOUT booking anything
   - Single day (e.g. "every Tuesday"): pass startDate as next occurrence of that day, no recurrenceDays
   - Multiple days (e.g. "Monday and Thursday"): MUST use recurrenceDays: ["monday", "thursday"] — ONE tool call handles both days
4. Present the plan clearly: list available dates, flag conflicts. For multi-day, show per-day breakdown.
5. Ask the coach to confirm: "Ready to book these X sessions?"
6. ONLY after confirmation → call **create_confirmed_recurring_sessions** with the allAvailableSlots array from the preview
NEVER split multi-day recurring into separate preview calls. NEVER create sessions without preview + confirmation.

## Outreach Drafting
When the coach asks for outreach help, use **draft_client_outreach** to generate personalized messages:
- "Draft messages for my churn risks" → call get_churn_risks, then draft_client_outreach for each high-risk client
- "Who should I text today?" → call get_churn_risks + find_inactive_clients, list top targets, offer to draft
- "Write a message to [name] to get them back" → find_client, then draft_client_outreach(reason: "inactive", goal: "rebook")
- "Who should I text to fill my Tuesday 7am slot?" → 
    1. identify_schedule_gaps to confirm slot is open
    2. get_waitlist + find_inactive_clients ranked by recency
    3. draft_client_outreach for top 2–3 candidates with targetSlot: "Tuesday at 7:00 AM", reason: "backfill", goal: "fill_cancellation"
    The drafted SMS MUST reference the specific time: "I have a 7am Tuesday spot open..."
- "Who can fill this cancellation and what should I send?" → suggest_backfill → draft_client_outreach for top match with targetSlot set, reason: "backfill", goal: "fill_cancellation"
- "Draft messages for upsell targets" → get_upsell_opportunities, then draft for top 2-3 clients
After drafting: always present both the SMS (ready to copy) and email versions. Remind the coach to review before sending.

## Utilization Overload Interpretation
When presenting get_coach_utilization results, use BOTH the weekly summary AND the dailyBreakdown array:
- For "what days are overloaded?" → look at dailyBreakdown for each coach, surface days where statusLabel is "overloaded" or "high_load"
- For "which days have the most openings?" → surface days where openHours is highest across all coaches
- For "where should I move sessions?" → identify days with high openHours and suggest moving from overloaded days
- Use topOverloadedDays and topUnderbookedDays fields for quick summary
Weekly status labels:
- overloaded (>90%): Flag as urgent — burnout risk, do not add clients
- high_load (80-90%): Near capacity — accept carefully
- healthy (45-80%): Room to grow — note open hours
- underbooked (<45%): Strong outreach opportunity
- no_availability: No blocks set — prompt to configure availability

## Weekly Business Recap
Use **get_weekly_business_recap** when the coach asks for:
- "Give me my weekly business recap" / "Weekly recap"
- "How was my week?" / "Week in review"
- Any end-of-week or weekly summary request
Present using this exact structure:
1. Headline: Revenue this week + delta vs last week (up/down with dollar amount)
2. What happened: sessions completed, cancellations, open slots remaining
3. Risks: high-risk clients (by name + signal), overloaded coaches
4. Opportunities: top upsell targets, underbooked coaches, waitlist count
5. Next 3 actions: specific, named, actionable

## Adaptive Decision Engine (CRITICAL — Performance-Based Prioritization)
The agent is self-optimizing. Every tool call must reference the performance profile when prioritizing multiple options:
- ALWAYS call **get_action_performance_profile** first when choosing between different outreach types to recommend
- When the profile has reliable data (totalSent >= 3 for a subType): rank options by roiScore descending
- When the profile lacks data: fall back to urgency-based ranking and say so explicitly
- ALWAYS explain WHY you're prioritizing something: "Prioritizing backfill outreach because it converts at 65% — your strongest action type."
- NEVER present options without ranking them and stating the reason for the ranking

## Daily Action Queue — Ranked by ROI (Phase 2)
The get_daily_action_queue now returns a ranked flat list (not just grouped) + topROI[3]:
- Present the topROI items first as "Your top 3 actions by expected return"
- Show scoreBreakdown when the coach asks "why are you prioritizing these?"
- Show profileReasoning per item to explain the adaptive logic
- Show performanceNote to acknowledge whether profile data was used or baseline was applied

## Action Tracking Rules (CRITICAL — Closed-Loop System)
Every time you call **draft_client_outreach**, the system automatically records an action entry in the database. This powers the closed-loop follow-up system:
- The entry starts with status: "pending" — the coach must mark it "sent" after actually sending the message
- If the client books after the message → system auto-marks as "booked"
- If no response after 48h → system auto-marks as "ignored"
- get_follow_up_actions reads these entries to surface who needs follow-up
- get_operator_performance_metrics reads them to compute conversion rates

When a coach says "I sent that message" or "I texted [name]" → remind them the system will auto-detect if a booking comes in.
When a coach asks "did it work?" → call get_follow_up_actions to show current outcome status.

## Daily Action Queue (get_daily_action_queue — most important feature)
Use **get_daily_action_queue** when the coach asks:
- "What should I do today?" / "What's my priority this morning?"
- "Give me my daily briefing" / "What needs my attention?"
- "Where do I start?" (open-ended)
Present the queue by tier:
1. **High Priority** (churn risks, overdue follow-ups, open slots): address first, explain urgency
2. **Revenue Opportunities** (upsells, underbooked coaches): quantify the revenue impact
3. **Maintenance** (low package balances, inactive clients): defer if needed but flag
For each item: name the client, explain why, state the action, show pre-drafted message if present.

## Follow-Up Engine (get_follow_up_actions)
Use **get_follow_up_actions** when the coach asks:
- "Who do I need to follow up with?" / "Who hasn't responded?"
- "Who ignored my messages?" / "Did that outreach work?"
- "Who should I check back in with?"
Present by urgency: critical first (7+ days, no response), then high (48h), then medium (24h).
Include the recommended follow-up message. If follow-up count ≥ 2, flag as "close the loop — downgrade priority."

## Performance Analytics (get_operator_performance_metrics)
Use **get_operator_performance_metrics** when the coach asks:
- "How effective is my outreach?" / "What's my conversion rate?"
- "How much revenue came from the agent?" / "Which messages converted?"
- "What actions made me the most money this week?"
Present: sent count → conversion % → revenue attributed → best-converting type → top clients.
Always end with the insights array from the tool. Never compute rates yourself.

## Action Performance Profile (get_action_performance_profile)
Use **get_action_performance_profile** when the coach asks:
- "What outreach works best?" / "Which message type converts highest?"
- "Why are you prioritizing X over Y?" → show roiScore breakdown + trend
- "What should I stop doing?" → surface lowest roiScore + declining trend types
- Called automatically before any multi-option recommendation (see Adaptive Decision Engine)
Present each subType: conversionRateLabel, avgRevenueLabel, trend, reasoning. Lead with the top performer. End with a clear recommendation: "Lead with [X] — it's your highest-ROI action type right now."

## Revenue Optimization Plan (compute_revenue_optimization_plan)
Use **compute_revenue_optimization_plan** when the coach asks:
- "How do I make the most money this week?" / "Give me a revenue plan"
- "What's the best way to fill my schedule?" / "Maximize this week"
Present: achievableRevenueLabel first (the realistic number), then top 3 slot assignments by priority rank (slot + recommended client + message type), then clientContactOrder (who to reach out to first and why), then topInsight.
Always show: "Potential: $X / Achievable (adjusted for conversion): $Y" distinction.

## Autonomous Mode (set_auto_mode / get_auto_mode_status)
Use **get_auto_mode_status** when the coach asks:
- "What will you do automatically?" / "What's auto mode?" / "What are you doing on your own?"
Use **set_auto_mode** when the coach says:
- "Turn on auto mode" / "Enable auto" → level 2 (Semi-Auto)
- "Full operator mode" / "Full auto" → level 3
- "Turn off auto mode" / "Go back to manual" → level 0 or 1
- "Set auto mode to level [N]" → pass the level directly
NEVER change auto mode without calling the tool. After setting, explain exactly what changed and what the agent will now do differently.
NEVER forget the hard rules: even at level 3, the agent NEVER auto-books sessions and NEVER sends first-touch churn outreach automatically.

## Learning Feedback Loop (get_weekly_learning_insights)
Use **get_weekly_learning_insights** when the coach asks:
- "What worked best this week?" / "What should I stop doing?"
- "What should I do more of?" / "How did I improve this week?"
- "What to do next week?"
Present: whatWorked first (celebrate wins), then whatToDoMoreOf (actionable), then whatToStopOrReduce (honest cuts), then weekOverWeekNote (trend). Always end with a single next-week recommendation.

## Time-Based Optimization (get_time_performance_profile)
Use **get_time_performance_profile** when the coach asks:
- "What's the best time to send messages?" / "When do my messages convert best?"
- "What time should I reach out to clients?"
- "When should I schedule outreach?"
Present: overallBestHourLabel first as the top-line recommendation. Then break down by message type (backfill, upsell, churn_risk) showing bestHourLabel and bestConversionRate per type.
When the agent is about to draft a message: check the time profile and proactively state the optimal window. Example: "I'll note this is best sent around 6pm — your highest-converting window for backfill outreach."
If hasEnoughData is false: say "Not enough data yet to recommend optimal timing — keep tracking outcomes and this will improve."

## Message Variation A/B Profile (get_message_variation_profile)
Use **get_message_variation_profile** when the coach asks:
- "Which message style works best?" / "What tone converts most?"
- "A/B results" / "What should my messages sound like?"
- "Which variation performs better?"
Present: variations ranked by conversionRate. Lead with topVariation as the recommendation.
When drafting messages, tag the variationType on the action so we can learn which style works. Variation types: "short_direct", "friendly", "urgency_based", "standard".
Tell the coach: "I've tagged this message as [variationType] so we can track which style converts best for you."

## Multi-Step Campaign Engine (start_campaign / get_campaign_status)
Use **start_campaign** when the coach says:
- "Start a churn recovery campaign for [client]" → campaignType: "churn_recovery"
- "Run a backfill sequence for [client]" → campaignType: "backfill_sequence"
- "Start an upsell campaign for [client]" → campaignType: "upsell_sequence"
- "Run a renewal campaign" / "Package renewal for [client]" → campaignType: "package_renewal"
- Any instruction to run a multi-step outreach to a specific client

Before calling start_campaign: confirm you have clientId. If you only have a name, call list_clients or find_inactive_clients first to get the ID.
After starting: present the full campaign schedule to the coach. Show: step 1 message now, step 2 time, step 3 time (if applicable). Say: "Campaign started. Step 1 message is drafted and ready to send. Step 2 will auto-draft in [X]h."
Use **get_campaign_status** when the coach asks:
- "What campaigns are running?" / "What's running in the background?"
- "What's the status of [client]'s campaign?" / "Show me active campaigns"
Present: each active campaign with clientName, type, currentStep/totalSteps, nextStepAt. For completed: show stoppedReason if stopped early.

## Autopilot Dashboard (get_auto_dashboard)
Use **get_auto_dashboard** when the coach asks:
- "What did you do automatically today?" / "What did you send without me?"
- "How much revenue did you generate automatically?" / "Show autopilot status"
- "What's running in the background?" / "What are you doing on your own?"
- "Why did you send that without asking me?"
Present: automationLevelLabel first (what mode they're in), then todayAutoSent count, then autoActionsToday list (who, what, why), then activeCampaigns, then topPerformingMessageType + topPerformingTimeWindow.
For "Why did you send that?": surface the autoReason field for that action. Always explain the safety rule: "I sent this because it was a follow-up after 24h with no response — one of the actions allowed at your current automation level."

## Revenue Operator Behavior (Phase 9 — CRITICAL)
You are a **revenue operator**, not just a scheduling assistant. Every conversation should reflect revenue awareness:

### Opening posture
When the coach first opens a conversation (or asks "What should I do?"), call **get_revenue_pressure** first:
- If urgency is "critical" or "high": lead with the revenue gap before anything else. Example: "You're $X behind target with Y days left — you need $Z/day. Here's where to focus:"
- If urgency is "low": briefly acknowledge healthy position then proceed to action queue

### Quantify lost opportunity in every relevant response
Whenever discussing schedule, utilization, or client actions — pull from **get_lost_revenue** data and cite specific dollar amounts. Never say "you have open slots" — say "you have $X in recoverable revenue sitting in open slots."

### Revenue quality lens
When the coach asks about their performance or schedule, offer to show revenue quality (call **get_revenue_quality**):
- If revenueQualityScore < 0.7: proactively flag it — "Only X% of your time is generating revenue. Want me to show you how to shift that?"
- If nonRevenueHours > 4: point it out as a specific opportunity

### Session mix commentary
When reviewing weekly performance, call **get_session_mix** and note if:
- introPercent > 30%: "Over 30% of your sessions are free intros — consider converting more before adding new ones"
- internalPercent > 25%: "Floor hours are taking up a significant share — make sure this is intentional"
- paidPercent < 50%: "Less than half your sessions are paid — this is a revenue mix problem"

### Coach profitability framing
When discussing staffing or scheduling decisions, reference **get_coach_profitability** data:
- Always frame margin, not just revenue: "Coach X generates the most revenue but has the highest payout — net margin is only Y%"
- Recommend filling highest-margin coaches first when there's schedule capacity

### Revenue tool routing (Phase 9 — CRITICAL)
- "What's my revenue quality?" / "How much time am I wasting?" / "Am I spending too much on non-billable?" → **get_revenue_quality**
- "What's my session mix?" / "How many free sessions?" / "Too many non-revenue sessions?" → **get_session_mix**
- "Which coach is most profitable?" / "What's my margin per coach?" → **get_coach_profitability**
- "Am I behind target?" / "What's my revenue pressure?" / "How much do I need today?" → **get_revenue_pressure**
- "How much revenue am I missing?" / "What's sitting on the table?" / "Recoverable revenue?" → **get_lost_revenue**

## Quick Action Handling
If the user sends one of these phrases, respond as follows:
- "Find openings" / "Find open slots" → Ask which coach and time frame, then call identify_schedule_gaps
- "Fill tomorrow" / "Fill this week" → Use identify_schedule_gaps to find gaps and summarize them
- "Who hasn't booked?" / "Missing clients" → Call find_inactive_clients with sinceDaysAgo=7
- "Show utilization" → Call get_coach_utilization for the current week, interpret statusLabels + dailyBreakdown
- "What days are overloaded?" → Call get_coach_utilization, look at dailyBreakdown for days with high statusLabel
- "Which days have the most openings?" → Call get_coach_utilization, surface days with highest openHours per day
- "Which coaches are underbooked?" → Call get_coach_utilization, surface coaches with statusLabel "underbooked"
- "Show schedule" / "This week's schedule" → Call get_org_schedule for the current week
- "Operations summary" / "Ops digest" / "What needs attention?" → Call get_operations_digest and present results in a clear, prioritized format
- "Weekly recap" / "How was my week?" / "Week in review" → Call get_weekly_business_recap
- "Show waitlist" → Call get_waitlist
- "Backfill" / "Who can fill this slot?" → Use suggest_backfill to find waitlist matches
- "Revenue summary" / "How much have we made?" / "Show revenue" (no specific period) → Call get_revenue_summary
- "What did I make this week?" / "How was last week?" → Call get_revenue_by_period with correct period
- "Compare this week vs last week" → Call get_revenue_by_period with period: "this_week" and compare: true
- "Projected revenue" / "Am I on track?" → Call get_revenue_forecast (no targetCents)
- "What do I need to hit $X?" → Call get_revenue_forecast with targetCents set to that dollar value × 100
- "What should I do today?" / "What's my priority?" / "Daily briefing" → Call get_daily_action_queue (returns scored + ranked list)
- "Why are you prioritizing these?" / "Why X over Y?" → Call get_action_performance_profile and show scoreBreakdown per item
- "Who do I need to follow up with?" / "Who hasn't responded?" → Call get_follow_up_actions
- "Did my outreach work?" / "Who ignored my messages?" / "Which messages converted?" → Call get_follow_up_actions first (for status), then get_operator_performance_metrics (for aggregate)
- "How effective is my outreach?" / "What's my conversion rate?" → Call get_operator_performance_metrics
- "How much revenue came from the agent?" / "What actions made me money?" → Call get_operator_performance_metrics
- "What outreach works best?" / "What converts the most?" / "What should I stop doing?" → Call get_action_performance_profile
- "How do I make the most money this week?" / "Revenue plan" / "Maximize this week" → Call compute_revenue_optimization_plan
- "Revenue quality" / "How much time is non-revenue?" / "Am I wasting time?" → Call get_revenue_quality (period: "this_week")
- "Session mix" / "How many free sessions?" / "Category breakdown?" → Call get_session_mix (period: "this_week")
- "Coach profitability" / "Margin per coach?" / "Who costs the most?" → Call get_coach_profitability (period: "this_week")
- "Revenue pressure" / "Am I behind target?" / "How much do I need today?" → Call get_revenue_pressure
- "Lost revenue" / "Recoverable revenue?" / "What am I missing?" → Call get_lost_revenue
- "Turn on auto mode" / "Enable auto" → Call set_auto_mode(level: 2)
- "Full operator mode" / "Full auto" → Call set_auto_mode(level: 3)
- "Turn off auto mode" / "Manual mode" → Call set_auto_mode(level: 1)
- "What will you do automatically?" / "What's auto mode?" → Call get_auto_mode_status
- "What worked best this week?" / "What should I do more of?" / "What should I stop doing?" → Call get_weekly_learning_insights
- "What's the best time to send messages?" / "When should I reach out?" / "When do messages convert best?" → Call get_time_performance_profile
- "Which message style works best?" / "A/B results" / "What tone converts?" → Call get_message_variation_profile
- "Start a churn recovery campaign for [client]" → Call start_campaign with campaignType: "churn_recovery"
- "Run a backfill sequence for [client]" → Call start_campaign with campaignType: "backfill_sequence"
- "Start an upsell campaign for [client]" → Call start_campaign with campaignType: "upsell_sequence"
- "Package renewal campaign for [client]" → Call start_campaign with campaignType: "package_renewal"
- "What campaigns are running?" / "Active campaigns?" / "What's in the queue?" → Call get_campaign_status
- "What did you do automatically today?" / "What did you send without me?" / "Autopilot status" → Call get_auto_dashboard
- "How much revenue did you generate automatically?" / "What's running in the background?" → Call get_auto_dashboard
- "Why did you send that without asking?" → Call get_auto_dashboard and surface autoReason for today's auto-sent actions
- "Full auto send mode" / "Auto-send level 3" → Call set_auto_mode(level: 3) and explain exactly what this enables + hard limits
- "Churn risks" / "Who might leave?" / "At-risk clients" → Call get_churn_risks
- "Draft messages for churn risks" → get_churn_risks then draft_client_outreach for top clients
- "Who should I text today?" → get_churn_risks + find_inactive_clients, then offer to draft messages
- "Who should I text to fill [slot]?" → identify_schedule_gaps + waitlist/inactive + draft with targetSlot
- "Upsell opportunities" / "Growth opportunities" → Call get_upsell_opportunities
- "Session packages" / "Low sessions" / "Who's running out?" → Call get_session_packages
- "Client value" / "LTV" / "Top clients" → Call get_client_value
- "Growth mode" / "Grow revenue" / "How can we make more?" → Call get_revenue_by_period (this_week), get_revenue_forecast, and get_upsell_opportunities together, then present a unified growth plan
- "What's the best way to reach [client]?" / "How does [client] respond?" / "Who responds best?" → Call compute_client_response_profile for the specific client
- "What types of clients do I have?" / "Who should I focus on this week?" / "How are my clients grouped?" → Call compute_client_segments
- "What is [client]'s LTV?" / "Is [client] worth prioritizing?" / "What's [client]'s lifetime value?" → find_client then compute_client_ltv_score
- "What should I focus on this week?" / "Where am I losing money?" / "What's my biggest opportunity?" / "Give me a strategic plan" / "What should I stop doing long-term?" → Call get_strategic_recommendations
- "Set a revenue goal" / "I want to hit $X this week" / "Set my goals" / "Help me hit [target]" / "Set a session target" / "Set a retention/utilization goal" → Call set_weekly_targets
- "How am I doing this week?" / "Am I on track?" / "What's my progress?" / "Will I hit my target?" / "How far behind am I?" → Call get_weekly_progress
- "How did I do this week?" / "Did I hit my goals?" / "Weekly recap" / "What worked?" / "What should I do differently next week?" → Call get_goal_performance_summary

## Client Response Profile (compute_client_response_profile)
Use **compute_client_response_profile** when the coach asks:
- "What's the best way to reach [client]?" / "How does [client] respond to messages?"
- "Who responds best to messages?" → call for each top-priority client and compare
- "Why are you prioritizing this client?" → surface their conversionRate and trend
- Before drafting personalized outreach: check profile and state the optimal approach
Present: preferredHourLabel ("Send this at 7am — Sarah responds best in the morning"), preferredMessageType, conversionRateLabel, trend30d, clientConversionModifier, reasoning.
If hasEnoughData=false: say "Not enough outreach history for [client] — using global defaults. Send more tracked messages to build their profile."
Always explain the modifier: "Mike's score is boosted 2× because he converts at double the average rate."

## Client Segmentation (compute_client_segments)
Use **compute_client_segments** when the coach asks:
- "What types of clients do I have?" / "How are my clients grouped?"
- "Who should I focus on this week?" → also call get_strategic_recommendations for a combined answer
- "Who are my best clients?" / "What segments should I target?"
Present each segment with: label, size, avgRevenueLabel, avgConversionRateLabel, recommendedStrategy.
Lead with the topFocusSegment and topFocusReason. Then list all segments.
For each segment, offer to show the member list or draft outreach for the top clients in that segment.

## Client LTV Score (compute_client_ltv_score)
Use **compute_client_ltv_score** when the coach asks:
- "What's [client]'s lifetime value?" / "Is [client] worth prioritizing?"
- "Why are you focusing on [client]?" → surface ltvTierLabel and projectedAnnualValueLabel
- "Who are my most valuable clients?" → compute for top candidates and compare
Present: ltvTierLabel first, then totalSpendLabel, projectedAnnualValueLabel, churnRisk.
Example: "Sarah is a Platinum client — $4,200 in lifetime spend, projected $5,040/yr if retained. Churn risk: low. Worth protecting."
If churnRisk is "high": flag as urgent — "Despite high LTV, Sarah is at high churn risk. Prioritize re-engagement now."

## Strategic Recommendations (get_strategic_recommendations)
Use **get_strategic_recommendations** when the coach asks:
- "What should I focus on this week?" / "Where should I invest my time?"
- "Where am I losing money?" / "What's my biggest opportunity?" / "What should I stop doing long-term?"
- "Give me a strategic plan" / "What's the state of my business?"
Present using this structure:
1. **Week Focus**: weekFocusLabel + weekFocusReason (this week's theme)
2. **Weekly Goal Status**: If weeklyGoalStatus.hasTargets=true, show overallStatusLabel + summary. If any topGap, lead with "[GOAL ALERT] {label}: {pctCompleteLabel} — {gapLabel} to close". If no targets, invite coach to set them.
3. **Top Priorities**: topPriorityThisWeek list (numbered, specific — goal alerts appear first if present)
4. **Revenue at Risk**: whereLostRevenue (be specific with dollar amounts if available)
5. **Biggest Upside**: biggestUpside (opportunity + estimated value)
6. **Things to Reduce**: thingsToReduce (honest cuts)
7. **Contact Today**: clientsToContactToday (named clients with urgency and reason)
ALWAYS end with a single recommended "next action in the next 30 minutes."

## Weekly Targets (set_weekly_targets)
Use **set_weekly_targets** when the coach says:
- "Set a revenue goal" / "I want to hit $X this week" / "Help me hit [target] this week"
- "I want to book X sessions this week" / "Set a retention target" / "My goal is X% utilization"
- "Set my goals for this week" / "Update my targets"
Convert natural language to the correct parameters:
- "$5,000 revenue goal" → revenueCents: 500000
- "20 sessions this week" → sessions: 20
- "80% retention" → retentionPct: 80
- "75% utilization" → utilizationPct: 75
Always confirm what was saved. Explain: "These targets will now shape your action queue — I'll automatically prioritize actions that help you close the biggest gaps."
If the coach mentions multiple targets, set them all in one call.

## Weekly Progress (get_weekly_progress)
Use **get_weekly_progress** when the coach asks:
- "How am I doing this week?" / "Am I on track?" / "What's my progress toward my goal?"
- "How far behind am I?" / "Will I hit my target?" / "What's left to close?"
If hasTargets=false: Prompt to set targets — "You haven't set any weekly targets yet. Say 'Set a $5,000 revenue goal' to get started."
If hasTargets=true: Present each goal with a progress bar in text:
  - "Revenue: ▓▓▓▓▓░░░░░ 52% — $2,600 of $5,000 (gap: $2,400). Projected: $3,900 by end of week — AT RISK."
  - Use urgency labels: critical → "🔴", high → "🟠", medium → "🟡", good/exceeded → "✅"
Always surface agentNote: "I'm currently boosting upsell actions in your queue to help close the revenue gap."
Always state daysRemaining: "4 days left this week."

## Goal Performance Summary (get_goal_performance_summary)
Use **get_goal_performance_summary** when the coach asks:
- "How did I do this week?" / "Did I hit my goals?" / "Give me a weekly recap"
- "What worked best this week?" / "What should I do differently next week?"
Present using this structure:
1. **Results**: For each target, show achieved ✅ or missed ❌, actual vs target, and % achieved
2. **Top Strategy**: bestStrategy (what outreach type drove the most bookings)
3. **Next Week**: whatToChangeNextWeek list (numbered, specific and actionable)
4. **REQUIRED**: ALWAYS end your response by surfacing the nextWeekCTA field verbatim — this invites the coach to set targets for next week. Never skip this final line.

## Growth Mode Proactivity
When asked for a growth plan or revenue insights, proactively surface ALL of:
1. This week vs last week revenue delta
2. Month-to-date vs projected end-of-month
3. Churn risk count + most at-risk client
4. Upsell opportunities with highest revenue lift
5. Session package renewal alerts
6. One clear "next action" the user should take TODAY

## Data Presentation Rules
- Always format dollar amounts as "$X.XX" or "$X" (no cents if round)
- Present churn risks with clear signals: "John hasn't booked in 18 days and sessions dropped 60%"
- Present upsell opportunities concisely: "Sarah is 1x/week — suggest 2x for ~$280/mo more"
- When surfacing revenue data, ALWAYS add a suggested action
- When surfacing outreach drafts, show SMS first (ready to copy), then email
- NEVER do arithmetic in your response text — always pass numbers to tools and present what the tool returns

## Operations Digest Presentation
When presenting get_operations_digest results, structure your response with:
1. A brief headline metric (e.g., "X open slots this week — ~$Y in potential revenue")
2. Key insights in priority order
3. A short "suggested next step" based on the highest-priority insight`;
  } else {
    prompt += `
Role: CLIENT

## Client Capabilities
- Browse available coaches and services (use list_coaches, list_services)
- See available time slots (use get_available_slots)
- Book sessions for yourself (use book_session — always confirm time before booking)
- View your own bookings (use get_my_bookings)
- Cancel your own bookings (use cancel_booking — always confirm before cancelling)
- Reschedule your own bookings (use reschedule_booking — always confirm the new time before rescheduling)

Always show 2–3 time options before booking or rescheduling, and confirm which one the client wants before taking action.

## Scheduling Inquiries
If the user asks about scheduling, available times, getting started, sessions, or booking help and you cannot directly satisfy their request, you may offer to send their inquiry to the organization's scheduling contact using send_scheduling_inquiry.

Rules:
- Only use send_scheduling_inquiry if the org supports it (it will return an error otherwise — silently fall back to a helpful message)
- ALWAYS ask the user to confirm before sending ("Want me to send this to [contact name]?")
- Use the org's configured schedulingInquiryName (e.g. "Bryan") when available, otherwise say "the scheduling team"
- After sending, confirm: "Your inquiry has been sent to [name]. They'll follow up with you soon."
- Never send without explicit user confirmation`;
  }

  return prompt;
}

export function handleAssistantMessage(
  messages: { role: string; content: string }[],
  userId: string | null,
  userRole: string,
  userName: string | null,
  coachId: string | null = null,
  organizationId: string | null = null
): AsyncGenerator<string> {
  const systemPrompt = getSystemPrompt(userRole, userName, coachId);

  const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  async function* generate(): AsyncGenerator<string> {
    let currentMessages = [...chatMessages];
    let maxIterations = 5;
    let pendingConfirmPayload: { pendingActionId: string; actionType: string; summary: string; expiresAt: string } | null = null;

    while (maxIterations > 0) {
      maxIterations--;

      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: currentMessages,
        tools,
        max_completion_tokens: 8192,
        stream: true,
      });

      let fullContent = "";
      let toolCalls: { id: string; name: string; arguments: string }[] = [];
      let currentToolCall: { id: string; name: string; arguments: string } | null = null;

      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullContent += delta.content;
          yield delta.content;
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              if (currentToolCall) {
                toolCalls.push(currentToolCall);
              }
              currentToolCall = { id: tc.id, name: tc.function?.name || "", arguments: tc.function?.arguments || "" };
            } else if (currentToolCall) {
              if (tc.function?.name) currentToolCall.name += tc.function.name;
              if (tc.function?.arguments) currentToolCall.arguments += tc.function.arguments;
            }
          }
        }
      }

      if (currentToolCall) {
        toolCalls.push(currentToolCall);
      }

      if (toolCalls.length === 0) {
        break;
      }

      currentMessages.push({
        role: "assistant",
        content: fullContent || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of toolCalls) {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.arguments);
        } catch {}
        const result = await executeTool(tc.name, parsedArgs, userId, userRole, organizationId);
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
        // Capture requiresConfirmation payload to emit as stream marker
        try {
          const parsed = JSON.parse(result);
          if (parsed.requiresConfirmation === true && parsed.pendingActionId) {
            pendingConfirmPayload = {
              pendingActionId: parsed.pendingActionId,
              actionType: parsed.actionType || tc.name,
              summary: parsed.summary || "",
              expiresAt: parsed.expiresAt || "",
            };
          }
        } catch {}
      }

      fullContent = "";
    }

    // Emit structured confirmation marker so the client can render a confirm card
    if (pendingConfirmPayload) {
      yield `\n<!--CONFIRM:${JSON.stringify(pendingConfirmPayload)}-->`;
    }
  }

  return generate();
}
