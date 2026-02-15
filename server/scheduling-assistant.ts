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
      description: "Create a session for a client (coach/admin only). Can specify an existing client by ID or create a walk-in by name.",
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
];

async function executeTool(
  name: string,
  args: any,
  userId: string | null,
  userRole: string
): Promise<string> {
  try {
    switch (name) {
      case "list_coaches": {
        const coaches = await storage.getCoachProfiles();
        return JSON.stringify(coaches.map(c => ({
          id: c.id,
          name: `${c.user.firstName} ${c.user.lastName}`,
          specialties: c.specialties,
          bio: c.bio,
        })));
      }

      case "list_services": {
        const services = await storage.getServices();
        return JSON.stringify(services.filter(s => s.active).map(s => ({
          id: s.id,
          name: s.name,
          durationMin: s.durationMin,
          price: s.name.toLowerCase().includes("team training") ? "Quoted Price" : s.priceCents === 0 ? "FREE" : `$${(s.priceCents / 100).toFixed(2)}`,
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

      default:
        return JSON.stringify({ error: `Unknown function: ${name}` });
    }
  } catch (error: any) {
    return JSON.stringify({ error: error.message || "An error occurred" });
  }
}

function getSystemPrompt(userRole: string, userName: string | null, coachId: string | null): string {
  const today = format(new Date(), "EEEE, MMMM d, yyyy");
  let prompt = `You are the Efficiency Strength Training scheduling assistant. Today is ${today}.
You help users find available training sessions, book appointments, and manage their schedules.

Key information about EST:
- We offer 1:1 S&C Sessions (60 min - $70, 30 min - $40), Semi-Private Sessions ($35/person), Team Training (quoted price), and a Free Intro Session (30 min, one per new client)
- Sessions are with our coaches: Bryan Jones and Hunter Thaxton
- We are located in the Bluffton/Hilton Head Island area of South Carolina

When helping users:
- Be friendly, concise, and helpful
- When showing available times, present them in a clear, readable format
- Always confirm details before booking
- If showing multiple time slots, limit to the most relevant 5-10 options unless asked for more
- Use the user's timezone (Eastern Time) when displaying times
- If a user asks about "next available" sessions, check the next 7 days`;

  if (userName) {
    prompt += `\n\nThe user's name is ${userName}.`;
  }

  if (userRole === "COACH" || userRole === "ADMIN") {
    prompt += `\n\nThis user is a ${userRole}.`;
    if (coachId) {
      prompt += ` Their coach ID is "${coachId}". When they ask to manage "my" schedule, availability, sessions, etc., use this coach ID automatically — do NOT ask them for their coach ID.`;
    }
    prompt += `

As a coach/admin, they can do ALL of the following directly through this chat — act on their requests immediately without unnecessary confirmation:
- View their own schedule for any day: use get_coach_schedule with their coach ID
- Set their availability: use set_availability. When they say things like "open up Monday 9 to 5" or "I'm available Tuesday 2pm-6pm", just do it. Use 24-hour format internally (e.g. "9 AM to 5 PM" = startTime "09:00", endTime "17:00"). Days: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday.
- View their current availability blocks: use get_availability
- Remove availability blocks: use delete_availability
- Create sessions for clients: use coach_create_session (can specify client by name for walk-ins)
- View and manage any coach's schedule (not just their own)

Be proactive and efficient. If the coach says "open me up Monday through Friday 9-5", create 5 availability blocks (one for each day) without asking for confirmation for each one. Just do it and report what was done.`;
  } else {
    prompt += `\n\nThis user is a CLIENT. They can:
- Browse coaches and services
- View available time slots
- Book sessions for themselves
- View and cancel their own bookings`;
  }

  return prompt;
}

export function handleAssistantMessage(
  messages: { role: string; content: string }[],
  userId: string | null,
  userRole: string,
  userName: string | null,
  coachId: string | null = null
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
        const result = await executeTool(tc.name, parsedArgs, userId, userRole);
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
