import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { addDays, startOfWeek, format, parseISO, addMinutes, setHours, setMinutes } from "date-fns";

async function getUserRole(userId: string): Promise<string> {
  const profile = await storage.getUserProfile(userId);
  return profile?.role || "CLIENT";
}

async function getCoachId(userId: string): Promise<string | null> {
  const profile = await storage.getCoachProfileByUserId(userId);
  return profile?.id || null;
}

function requireRole(...roles: string[]) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const role = await getUserRole(userId);
    if (!roles.includes(role)) return res.status(403).json({ message: "Forbidden" });
    next();
  };
}

function generateTimeSlots(
  availBlocks: any[],
  existingBookings: any[],
  startDate: Date,
  endDate: Date,
  durationMin: number
) {
  const days = [];
  let current = new Date(startDate);

  while (current <= endDate) {
    const dayOfWeek = (current.getDay() + 6) % 7;
    const dayBlocks = availBlocks.filter(b => b.dayOfWeek === dayOfWeek);
    const dayStr = format(current, "yyyy-MM-dd");
    const dayLabel = format(current, "EEE");
    const slots: { start: string; end: string; available: boolean }[] = [];

    for (const block of dayBlocks) {
      const [startH, startM] = block.startTime.split(":").map(Number);
      const [endH, endM] = block.endTime.split(":").map(Number);

      let slotStart = new Date(current);
      slotStart.setHours(startH, startM, 0, 0);

      const blockEnd = new Date(current);
      blockEnd.setHours(endH, endM, 0, 0);

      while (addMinutes(slotStart, durationMin) <= blockEnd) {
        const slotEnd = addMinutes(slotStart, durationMin);
        const startISO = slotStart.toISOString();
        const endISO = slotEnd.toISOString();

        const hasOverlap = existingBookings.some(b => {
          const bStart = new Date(b.startAt).getTime();
          const bEnd = new Date(b.endAt).getTime();
          return slotStart.getTime() < bEnd && slotEnd.getTime() > bStart;
        });

        slots.push({
          start: startISO,
          end: endISO,
          available: !hasOverlap,
        });

        slotStart = addMinutes(slotStart, 30);
      }
    }

    days.push({ date: dayStr, dayLabel, slots });
    current = addDays(current, 1);
  }

  return days;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  app.get("/api/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      let profile = await storage.getUserProfile(userId);
      if (!profile) {
        const allUsers = await storage.getAllUsersWithProfiles();
        const anyAdmin = allUsers.some(u => u.profile?.role === "ADMIN");
        const role = anyAdmin ? "CLIENT" : "ADMIN";
        profile = await storage.upsertUserProfile({ userId, role: role as any });
        if (role === "ADMIN") {
          console.log(`First user ${userId} auto-promoted to ADMIN`);
        }
      }
      res.json(profile);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.get("/api/coaches", async (_req, res) => {
    try {
      const coaches = await storage.getCoachProfiles();
      res.json(coaches);
    } catch (error) {
      console.error("Error fetching coaches:", error);
      res.status(500).json({ message: "Failed to fetch coaches" });
    }
  });

  app.get("/api/coaches/:id", async (req, res) => {
    try {
      const coach = await storage.getCoachProfile(req.params.id);
      if (!coach) return res.status(404).json({ message: "Coach not found" });
      res.json(coach);
    } catch (error) {
      console.error("Error fetching coach:", error);
      res.status(500).json({ message: "Failed to fetch coach" });
    }
  });

  app.get("/api/coaches/:id/slots", async (req, res) => {
    try {
      const coachId = req.params.id;
      const serviceId = req.query.serviceId as string;
      const weekStartStr = req.query.weekStart as string;

      if (!serviceId) return res.status(400).json({ message: "serviceId required" });

      const service = await storage.getService(serviceId);
      if (!service) return res.status(404).json({ message: "Service not found" });

      const weekStart = weekStartStr ? parseISO(weekStartStr) : startOfWeek(new Date(), { weekStartsOn: 1 });
      const weekEnd = addDays(weekStart, 6);

      const blocks = await storage.getAvailabilityBlocks(coachId);
      const existingBookings = await storage.getOverlappingBookings(
        coachId,
        weekStart,
        addDays(weekEnd, 1)
      );

      const slots = generateTimeSlots(blocks, existingBookings, weekStart, weekEnd, service.durationMin);
      res.json(slots);
    } catch (error) {
      console.error("Error generating slots:", error);
      res.status(500).json({ message: "Failed to generate slots" });
    }
  });

  app.get("/api/services", async (_req, res) => {
    try {
      const srvs = await storage.getServices();
      res.json(srvs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch services" });
    }
  });

  app.post("/api/bookings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { coachId, serviceId, startAt, endAt } = req.body;

      if (!coachId || !serviceId || !startAt || !endAt) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const service = await storage.getService(serviceId);
      if (!service) return res.status(404).json({ message: "Service not found" });

      const coach = await storage.getCoachProfile(coachId);
      if (!coach) return res.status(404).json({ message: "Coach not found" });

      const start = new Date(startAt);
      const end = new Date(endAt);

      const durationMs = end.getTime() - start.getTime();
      const expectedMs = service.durationMin * 60 * 1000;
      if (Math.abs(durationMs - expectedMs) > 60000) {
        return res.status(400).json({ message: "Booking duration does not match service duration" });
      }

      const blocks = await storage.getAvailabilityBlocks(coachId);
      const bookingDayOfWeek = (start.getDay() + 6) % 7;
      const bookingStartTime = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
      const bookingEndTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;

      const fitsAvailability = blocks.some(block => {
        return block.dayOfWeek === bookingDayOfWeek &&
               block.startTime <= bookingStartTime &&
               block.endTime >= bookingEndTime;
      });

      if (!fitsAvailability) {
        return res.status(400).json({ message: "Booking does not fit within coach's availability" });
      }

      const overlapping = await storage.getOverlappingBookings(coachId, start, end);
      if (overlapping.length > 0) {
        return res.status(409).json({ message: "This time slot is no longer available" });
      }

      const booking = await storage.createBooking({
        clientId: userId,
        coachId,
        serviceId,
        startAt: start,
        endAt: end,
        status: "CONFIRMED",
        notes: req.body.notes || "",
      });

      res.json(booking);
    } catch (error) {
      console.error("Error creating booking:", error);
      res.status(500).json({ message: "Failed to create booking" });
    }
  });

  app.get("/api/bookings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const bookingsList = await storage.getBookings(userId);
      res.json(bookingsList);
    } catch (error) {
      console.error("Error fetching bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  app.patch("/api/bookings/:id/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { status } = req.body;
      const bookingId = req.params.id;

      const booking = await storage.getBooking(bookingId);
      if (!booking) return res.status(404).json({ message: "Booking not found" });

      const role = await getUserRole(userId);
      const coachProfile = await storage.getCoachProfileByUserId(userId);

      const isOwner = booking.clientId === userId;
      const isCoach = coachProfile && booking.coachId === coachProfile.id;
      const isAdmin = role === "ADMIN";

      if (!isOwner && !isCoach && !isAdmin) {
        return res.status(403).json({ message: "Not authorized" });
      }

      if (isOwner && !isCoach && !isAdmin && status !== "CANCELLED") {
        return res.status(403).json({ message: "Clients can only cancel bookings" });
      }

      const updated = await storage.updateBookingStatus(bookingId, status);
      res.json(updated);
    } catch (error) {
      console.error("Error updating booking:", error);
      res.status(500).json({ message: "Failed to update booking" });
    }
  });

  app.get("/api/coach/bookings", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachId = await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });
      const bookingsList = await storage.getCoachBookings(coachId);
      res.json(bookingsList);
    } catch (error) {
      console.error("Error fetching coach bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  app.get("/api/coach/bookings/completed", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachId = await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });
      const bookingsList = await storage.getCoachCompletedBookings(coachId);
      res.json(bookingsList);
    } catch (error) {
      console.error("Error fetching completed bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  app.get("/api/coach/availability", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachId = await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });
      const blocks = await storage.getAvailabilityBlocks(coachId);
      res.json(blocks);
    } catch (error) {
      console.error("Error fetching availability:", error);
      res.status(500).json({ message: "Failed to fetch availability" });
    }
  });

  app.post("/api/coach/availability", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachId = await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });

      const { dayOfWeek, startTime, endTime } = req.body;
      if (dayOfWeek === undefined || !startTime || !endTime) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (dayOfWeek < 0 || dayOfWeek > 6) {
        return res.status(400).json({ message: "Invalid day of week" });
      }

      if (startTime >= endTime) {
        return res.status(400).json({ message: "End time must be after start time" });
      }

      const block = await storage.createAvailabilityBlock({
        coachId,
        dayOfWeek,
        startTime,
        endTime,
      });
      res.json(block);
    } catch (error) {
      console.error("Error creating availability:", error);
      res.status(500).json({ message: "Failed to create availability" });
    }
  });

  app.delete("/api/coach/availability/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      await storage.deleteAvailabilityBlock(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting availability:", error);
      res.status(500).json({ message: "Failed to delete availability" });
    }
  });

  app.get("/api/coach/redemptions", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachId = await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });
      const redemptionsList = await storage.getCoachRedemptions(coachId);
      res.json(redemptionsList);
    } catch (error) {
      console.error("Error fetching redemptions:", error);
      res.status(500).json({ message: "Failed to fetch redemptions" });
    }
  });

  app.post("/api/redemptions", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachId = await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });

      const { bookingId } = req.body;
      if (!bookingId) return res.status(400).json({ message: "bookingId required" });

      const booking = await storage.getBooking(bookingId);
      if (!booking) return res.status(404).json({ message: "Booking not found" });
      if (booking.coachId !== coachId) return res.status(403).json({ message: "Not your booking" });
      if (booking.status !== "COMPLETED") return res.status(400).json({ message: "Booking must be completed" });

      const existing = await storage.getRedemptionByBookingId(bookingId);
      if (existing) return res.status(409).json({ message: "Already redeemed" });

      const service = await storage.getService(booking.serviceId);
      const amountCents = service?.priceCents || 0;

      const redemption = await storage.createRedemption({
        bookingId,
        coachId,
        amountCents,
        payoutStatus: "PENDING",
      });

      res.json(redemption);
    } catch (error) {
      console.error("Error creating redemption:", error);
      res.status(500).json({ message: "Failed to create redemption" });
    }
  });

  app.get("/api/admin/users", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsersWithProfiles();
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/admin/set-role", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { userId, role } = req.body;
      if (!userId || !role) return res.status(400).json({ message: "userId and role required" });
      if (!["CLIENT", "COACH", "ADMIN"].includes(role)) return res.status(400).json({ message: "Invalid role" });

      const profile = await storage.upsertUserProfile({ userId, role: role as any });

      if (role === "COACH") {
        const existing = await storage.getCoachProfileByUserId(userId);
        if (!existing) {
          await storage.createCoachProfile({
            userId,
            bio: "",
            specialties: [],
            timezone: "America/New_York",
            isActive: true,
          });
        }
      }

      res.json(profile);
    } catch (error) {
      console.error("Error setting role:", error);
      res.status(500).json({ message: "Failed to set role" });
    }
  });

  app.post("/api/admin/services", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { name, description, durationMin, priceCents } = req.body;
      if (!name) return res.status(400).json({ message: "name required" });
      const service = await storage.createService({
        name,
        description: description || "",
        durationMin: durationMin || 60,
        priceCents: priceCents || 0,
        active: true,
      });
      res.json(service);
    } catch (error) {
      console.error("Error creating service:", error);
      res.status(500).json({ message: "Failed to create service" });
    }
  });

  app.get("/api/admin/bookings", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const bookingsList = await storage.getAllBookings();
      res.json(bookingsList);
    } catch (error) {
      console.error("Error fetching all bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  app.get("/api/admin/redemptions", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const redemptionsList = await storage.getAllRedemptions();
      res.json(redemptionsList);
    } catch (error) {
      console.error("Error fetching all redemptions:", error);
      res.status(500).json({ message: "Failed to fetch redemptions" });
    }
  });

  return httpServer;
}
