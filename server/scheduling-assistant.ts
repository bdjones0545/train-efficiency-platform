import OpenAI from "openai";
import { storage } from "./storage";
import { addDays, startOfWeek, format, addMinutes } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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
      description: "Book a session for the current user. Only use when the user has confirmed they want to book.",
      parameters: {
        type: "object",
        properties: {
          coachId: { type: "string", description: "The coach's ID" },
          serviceId: { type: "string", description: "The service ID" },
          startAt: { type: "string", description: "Session start time in ISO 8601 format" },
          endAt: { type: "string", description: "Session end time in ISO 8601 format" },
        },
        required: ["coachId", "serviceId", "startAt", "endAt"],
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
      description: "Cancel a specific booking by ID. Only use when the user has confirmed cancellation.",
      parameters: {
        type: "object",
        properties: {
          bookingId: { type: "string", description: "The booking ID to cancel" },
        },
        required: ["bookingId"],
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
      description: "Create a session for a client (coach/admin only). Can specify an existing client by ID or create a walk-in by name. Only use AFTER the user has confirmed a specific time.",
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
        },
        required: ["coachId", "serviceId", "startAt"],
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
      description: "Reschedule an existing booking to a new time (coach/admin only). Only call this after the user has explicitly confirmed the new time.",
      parameters: {
        type: "object",
        properties: {
          bookingId: { type: "string", description: "The ID of the booking to reschedule" },
          newStartAt: { type: "string", description: "New start time in ISO 8601 format" },
          newEndAt: { type: "string", description: "New end time in ISO 8601 format" },
        },
        required: ["bookingId", "newStartAt", "newEndAt"],
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
      name: "get_waitlist",
      description: "Get all clients currently on the scheduling waitlist for this organization (coach/admin only).",
      parameters: { type: "object", properties: {} },
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
        const booking = await storage.createBooking({
          clientId: userId,
          coachId,
          serviceId,
          startAt: new Date(startAt),
          endAt: new Date(endAt),
          status: "CONFIRMED",
          notes: "",
          location: "",
          maxParticipants: isSemiPrivate ? 6 : null,
          groupDescription: "",
        });

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

      case "cancel_booking": {
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

        return JSON.stringify({
          period: `${format(startDate, "MMM d")} – ${format(endDate, "MMM d, yyyy")}`,
          coaches: utilization.map(u => ({
            coachName: u.coachName,
            bookedMinutes: u.bookedMinutes,
            bookedHours: (u.bookedMinutes / 60).toFixed(1),
            availableMinutes: u.availableMinutes,
            availableHours: (u.availableMinutes / 60).toFixed(1),
            utilizationPct: u.utilizationPct,
            remainingMinutes: Math.max(0, u.availableMinutes - u.bookedMinutes),
          })),
        });
      }

      case "identify_schedule_gaps": {
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can view schedule gaps." });
        }
        const { coachId, numDays = 7 } = args;
        const timezone = "America/New_York";
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
        if (userRole !== "COACH" && userRole !== "ADMIN" && userRole !== "STAFF") {
          return JSON.stringify({ error: "Only coaches, admins, and staff can reschedule bookings." });
        }
        const { bookingId, newStartAt, newEndAt } = args;
        const booking = await storage.getBooking(bookingId);
        if (!booking) return JSON.stringify({ error: "Booking not found." });

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
        const results = await storage.searchUsers(args.query);
        if (results.length === 0) {
          return JSON.stringify({ message: `No client found matching "${args.query}".` });
        }
        return JSON.stringify(results.slice(0, 5).map(u => ({
          id: u.id,
          name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
          email: u.email,
        })));
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
- Run operations intelligence digests — open slots, revenue opportunity, inactive clients, waitlist
- Read and display organization schedules, bookings, and availability
- Find open time slots and surface scheduling gaps
- Identify clients who haven't booked recently
- Show coach utilization and capacity
- Manage the scheduling waitlist (add clients, view waitlist, suggest backfills for cancelled slots)
- Suggest smart scheduling actions and proactively surface opportunities
- Create, cancel, and reschedule bookings (with confirmation)

## Co-Pilot Mode (Critical Rules)
You are a SUGGESTION-FIRST assistant. Before executing any booking action:

1. **For new bookings**: Always check availability first (use get_available_slots or get_org_schedule), then present 2–3 specific time options clearly numbered. Ask the user to pick one. Only book AFTER they confirm a specific option.
   Example: "Here are 3 open times for Mike next week:
   1. Tuesday at 9:00 AM with Coach Bryan
   2. Wednesday at 2:00 PM with Coach Bryan  
   3. Friday at 10:00 AM with Coach Hunter
   Which works best? I'll get it booked."

2. **For rescheduling**: First show the current booking details, then offer 2–3 alternative slots. Only reschedule after confirmation.

3. **For cancellations**: Always confirm by restating what will be cancelled before doing it.

4. **For availability/schedule changes**: These can be executed immediately without preview.

5. **For insights (inactive clients, utilization, gaps)**: Execute immediately and present results clearly.

## Data Rules
- Always use the org-scoped tools (get_org_schedule, find_inactive_clients, get_coach_utilization) for org-wide data
- When a user mentions a client by name, use find_client first to get their ID
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
- **Find clients by name**: use find_client before booking if only a name is provided
- **Insights**: use find_inactive_clients, get_coach_utilization, identify_schedule_gaps — execute immediately

## Quick Action Handling
If the user sends one of these phrases, respond as follows:
- "Find openings" / "Find open slots" → Ask which coach and time frame, then call identify_schedule_gaps
- "Fill tomorrow" / "Fill this week" → Use identify_schedule_gaps to find gaps and summarize them
- "Who hasn't booked?" / "Missing clients" → Call find_inactive_clients with sinceDaysAgo=7
- "Show utilization" → Call get_coach_utilization for the current week
- "Show schedule" / "This week's schedule" → Call get_org_schedule for the current week
- "Operations summary" / "Ops digest" / "What needs attention?" → Call get_operations_digest and present results in a clear, prioritized format
- "Show waitlist" → Call get_waitlist
- "Backfill" / "Who can fill this slot?" → Use suggest_backfill to find waitlist matches

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
- View and cancel your own bookings (use get_my_bookings, cancel_booking)

Always show 2–3 time options before booking and confirm which one the client wants.`;
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

    while (maxIterations > 0) {
      maxIterations--;

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
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
      }

      fullContent = "";
    }
  }

  return generate();
}
