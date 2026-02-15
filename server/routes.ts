import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated, createAuthToken, deleteAuthToken } from "./replit_integrations/auth";
import { addDays, startOfWeek, format, parseISO, addMinutes, setHours, setMinutes } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import bcrypt from "bcryptjs";
import { handleAssistantMessage } from "./scheduling-assistant";
import { sendWelcomeEmail, sendBookingConfirmationToClient, sendBookingNotificationToCoach } from "./email";

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
  durationMin: number,
  timezone: string = "America/New_York"
) {
  const days = [];
  let current = new Date(startDate);

  while (current <= endDate) {
    const zonedCurrent = toZonedTime(current, timezone);
    const dayOfWeek = (zonedCurrent.getDay() + 6) % 7;
    const dayBlocks = availBlocks.filter(b => b.dayOfWeek === dayOfWeek);
    const dayStr = format(zonedCurrent, "yyyy-MM-dd");
    const dayLabel = format(zonedCurrent, "EEE");
    const slots: { start: string; end: string; available: boolean; location?: string }[] = [];

    for (const block of dayBlocks) {
      const [startH, startM] = block.startTime.split(":").map(Number);
      const [endH, endM] = block.endTime.split(":").map(Number);

      const localSlotStart = new Date(zonedCurrent);
      localSlotStart.setHours(startH, startM, 0, 0);
      let slotStart = fromZonedTime(localSlotStart, timezone);

      const localBlockEnd = new Date(zonedCurrent);
      localBlockEnd.setHours(endH, endM, 0, 0);
      const blockEnd = fromZonedTime(localBlockEnd, timezone);

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
          location: block.location || "",
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

  app.post("/api/coach/login", async (req: any, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const coachProfile = await storage.getCoachProfileByEmail(email.toLowerCase());
      if (!coachProfile || !coachProfile.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(password, coachProfile.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const userId = coachProfile.userId;
      const token = await createAuthToken(userId);
      res.json({ success: true, redirect: "/coach", token });
    } catch (error) {
      console.error("Coach login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/client/register", async (req: any, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: "All fields are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const existing = await storage.getUserByEmail(email.toLowerCase());
      if (existing) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }

      const hash = await bcrypt.hash(password, 10);

      const { db: dbRef } = await import("./db");
      const { users } = await import("@shared/models/auth");
      const [created] = await dbRef.insert(users).values({
        email: email.toLowerCase().trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        passwordHash: hash,
      }).returning();
      const user = created;
      const { userProfiles } = await import("@shared/schema");
      await dbRef.insert(userProfiles).values({ userId: user.id, role: "CLIENT" as any });

      const token = await createAuthToken(user.id);

      sendWelcomeEmail(email.toLowerCase().trim(), firstName.trim()).catch(() => {});

      res.json({ success: true, redirect: "/", token });
    } catch (error) {
      console.error("Client register error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/client/login", async (req: any, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const user = await storage.getUserByEmail(email.toLowerCase());
      if (!user || !user.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const token = await createAuthToken(user.id);
      res.json({ success: true, redirect: "/", token });
    } catch (error) {
      console.error("Client login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/client/logout", async (req: any, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      await deleteAuthToken(authHeader.slice(7));
    }
    req.logout(() => {
      req.session?.destroy(() => {
        res.json({ success: true });
      });
    });
  });

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
      const safe = coaches.map(({ passwordHash, email, ...rest }) => rest);
      res.json(safe);
    } catch (error) {
      console.error("Error fetching coaches:", error);
      res.status(500).json({ message: "Failed to fetch coaches" });
    }
  });

  app.get("/api/coaches/:id", async (req, res) => {
    try {
      const coach = await storage.getCoachProfile(req.params.id);
      if (!coach) return res.status(404).json({ message: "Coach not found" });
      const { passwordHash, email, ...safe } = coach;
      res.json(safe);
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

      const coach = await storage.getCoachProfile(coachId);
      const coachTimezone = coach?.timezone || "America/New_York";

      const blocks = await storage.getAvailabilityBlocks(coachId);
      const existingBookings = await storage.getOverlappingBookings(
        coachId,
        weekStart,
        addDays(weekEnd, 1)
      );

      const slots = generateTimeSlots(blocks, existingBookings, weekStart, weekEnd, service.durationMin, coachTimezone);
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

      const coachTimezone = coach.timezone || "America/New_York";
      const blocks = await storage.getAvailabilityBlocks(coachId);
      const zonedStart = toZonedTime(start, coachTimezone);
      const zonedEnd = toZonedTime(end, coachTimezone);
      const bookingDayOfWeek = (zonedStart.getDay() + 6) % 7;
      const bookingStartTime = `${String(zonedStart.getHours()).padStart(2, "0")}:${String(zonedStart.getMinutes()).padStart(2, "0")}`;
      const bookingEndTime = `${String(zonedEnd.getHours()).padStart(2, "0")}:${String(zonedEnd.getMinutes()).padStart(2, "0")}`;

      const fitsAvailability = blocks.some(block => {
        const blockStart = block.startTime.substring(0, 5);
        const blockEnd = block.endTime.substring(0, 5);
        return block.dayOfWeek === bookingDayOfWeek &&
               blockStart <= bookingStartTime &&
               blockEnd >= bookingEndTime;
      });

      if (!fitsAvailability) {
        return res.status(400).json({ message: "Booking does not fit within coach's availability" });
      }

      const overlapping = await storage.getOverlappingBookings(coachId, start, end);
      if (overlapping.length > 0) {
        return res.status(409).json({ message: "This time slot is no longer available" });
      }

      const isFreeIntro = service.name.toLowerCase().includes("free intro");
      if (isFreeIntro) {
        const alreadyUsed = await storage.hasUsedFreeSession(userId);
        if (alreadyUsed) {
          return res.status(400).json({ message: "You have already used your free intro session" });
        }
      }

      const isSemiPrivate = service.name.toLowerCase().includes("semi-private");

      const booking = await storage.createBooking({
        clientId: userId,
        coachId,
        serviceId,
        startAt: start,
        endAt: end,
        status: "CONFIRMED",
        notes: req.body.notes || "",
        location: req.body.location || "",
        maxParticipants: isSemiPrivate ? 6 : null,
        groupDescription: isSemiPrivate ? (req.body.groupDescription || "") : "",
      });

      if (isSemiPrivate) {
        const participantNames: string[] = req.body.participantNames || [];
        const filledNames = participantNames.filter((n: string) => n.trim());
        const count = filledNames.length > 0 ? filledNames.length : 1;

        if (count > 6) {
          return res.status(400).json({ message: "Maximum 6 participants per session" });
        }

        if (filledNames.length > 0) {
          for (const name of filledNames) {
            await storage.addBookingParticipant({
              bookingId: booking.id,
              userId,
              participantName: name.trim(),
            });
          }
        } else {
          await storage.addBookingParticipant({
            bookingId: booking.id,
            userId,
          });
        }
      }

      (async () => {
        try {
          const clientUser = await storage.getUser(userId);
          const coachProfile = await storage.getCoachProfile(coachId);
          if (clientUser?.email) {
            sendBookingConfirmationToClient(
              clientUser.email,
              clientUser.firstName || "there",
              coachProfile?.user ? `${coachProfile.user.firstName} ${coachProfile.user.lastName}` : "your coach",
              service.name,
              start,
              end,
              req.body.location || undefined
            ).catch(() => {});
          }
          const coachEmail = coachProfile?.email || coachProfile?.user?.email;
          if (coachEmail) {
            sendBookingNotificationToCoach(
              coachEmail,
              coachProfile?.user?.firstName || "Coach",
              clientUser ? `${clientUser.firstName} ${clientUser.lastName}` : "A client",
              service.name,
              start,
              end,
              req.body.location || undefined
            ).catch(() => {});
          }
        } catch (e) { console.error("Booking email error:", e); }
      })();

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

  app.get("/api/free-session-status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const used = await storage.hasUsedFreeSession(userId);
      res.json({ hasUsedFreeSession: used });
    } catch (error) {
      console.error("Error checking free session status:", error);
      res.status(500).json({ message: "Failed to check free session status" });
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

  app.get("/api/coach/profile", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachProfile = await storage.getCoachProfileByUserId(userId);
      if (!coachProfile) return res.status(404).json({ message: "Coach profile not found" });
      const { passwordHash: _ph, ...safeProfile } = coachProfile;
      res.json(safeProfile);
    } catch (error) {
      console.error("Error fetching coach profile:", error);
      res.status(500).json({ message: "Failed to fetch coach profile" });
    }
  });

  app.patch("/api/coach/profile", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachProfile = await storage.getCoachProfileByUserId(userId);
      if (!coachProfile) return res.status(404).json({ message: "Coach profile not found" });

      const { bio, specialties, photoUrl, timezone } = req.body;
      const updateData: Record<string, any> = {};
      if (bio !== undefined) updateData.bio = bio;
      if (specialties !== undefined) {
        if (!Array.isArray(specialties)) {
          return res.status(400).json({ message: "Specialties must be an array" });
        }
        updateData.specialties = specialties;
      }
      if (photoUrl !== undefined) updateData.photoUrl = photoUrl;
      if (timezone !== undefined) updateData.timezone = timezone;

      const updated = await storage.updateCoachProfile(coachProfile.id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating coach profile:", error);
      res.status(500).json({ message: "Failed to update coach profile" });
    }
  });

  app.get("/api/coach/bookings", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const targetCoachId = req.query.coachId as string | undefined;
      const coachId = targetCoachId || await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });
      const bookingsList = await storage.getCoachBookings(coachId);
      res.json(bookingsList);
    } catch (error) {
      console.error("Error fetching coach bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  app.get("/api/coach/clients/search", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const q = req.query.q as string;
      if (!q || q.trim().length < 1) return res.json([]);
      const results = await storage.searchUsers(q);
      res.json(results.map(({ id, firstName, lastName, email }) => ({ id, firstName, lastName, email })));
    } catch (error) {
      console.error("Error searching clients:", error);
      res.status(500).json({ message: "Failed to search clients" });
    }
  });

  app.post("/api/coach/bookings", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const targetCoachId = req.body.coachId as string | undefined;
      const coachId = targetCoachId || await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });

      const { clientId, clientFirstName, clientLastName, serviceId, startAt, notes, maxParticipants, groupDescription } = req.body;

      if (!serviceId || !startAt) {
        return res.status(400).json({ message: "serviceId and startAt are required" });
      }

      const service = await storage.getService(serviceId);
      if (!service) return res.status(404).json({ message: "Service not found" });

      const isSemiPrivate = service.name.toLowerCase().includes("semi-private");

      if (!isSemiPrivate && !clientId && (!clientFirstName || !clientLastName)) {
        return res.status(400).json({ message: "Provide clientId or clientFirstName and clientLastName" });
      }

      let resolvedClientId = clientId;
      if (!resolvedClientId && !isSemiPrivate) {
        const user = await storage.findOrCreateUserByName(clientFirstName, clientLastName);
        resolvedClientId = user.id;
      } else if (!resolvedClientId && isSemiPrivate) {
        if (clientFirstName && clientLastName) {
          const user = await storage.findOrCreateUserByName(clientFirstName, clientLastName);
          resolvedClientId = user.id;
        } else {
          resolvedClientId = userId;
        }
      }

      const isFreeIntro = service.name.toLowerCase().includes("free intro");
      if (isFreeIntro) {
        const alreadyUsed = await storage.hasUsedFreeSession(resolvedClientId);
        if (alreadyUsed) {
          return res.status(400).json({ message: "This client has already used their free intro session" });
        }
      }

      const start = new Date(startAt);
      const end = addMinutes(start, service.durationMin);

      const overlapping = await storage.getOverlappingBookings(coachId, start, end);
      if (overlapping.length > 0) {
        return res.status(409).json({ message: "This time slot overlaps with an existing booking" });
      }

      const booking = await storage.createBooking({
        clientId: resolvedClientId,
        coachId,
        serviceId,
        startAt: start,
        endAt: end,
        status: "CONFIRMED",
        notes: notes || "",
        location: req.body.location || "",
        maxParticipants: isSemiPrivate ? (maxParticipants || 6) : null,
        groupDescription: groupDescription || "",
      });

      (async () => {
        try {
          const clientUser = await storage.getUser(resolvedClientId);
          const coachProfile = await storage.getCoachProfile(coachId);
          if (clientUser?.email) {
            sendBookingConfirmationToClient(
              clientUser.email,
              clientUser.firstName || "there",
              coachProfile?.user ? `${coachProfile.user.firstName} ${coachProfile.user.lastName}` : "your coach",
              service.name,
              start,
              end,
              req.body.location || undefined
            ).catch(() => {});
          }
          const coachEmail = coachProfile?.email || coachProfile?.user?.email;
          if (coachEmail) {
            sendBookingNotificationToCoach(
              coachEmail,
              coachProfile?.user?.firstName || "Coach",
              clientUser ? `${clientUser.firstName} ${clientUser.lastName}` : "A client",
              service.name,
              start,
              end,
              req.body.location || undefined
            ).catch(() => {});
          }
        } catch (e) { console.error("Coach booking email error:", e); }
      })();

      res.json(booking);
    } catch (error) {
      console.error("Error creating coach booking:", error);
      res.status(500).json({ message: "Failed to create session" });
    }
  });

  app.patch("/api/coach/bookings/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachId = await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });

      const bookingId = req.params.id;
      const existing = await storage.getBooking(bookingId);
      if (!existing) return res.status(404).json({ message: "Booking not found" });
      const bookingCoachId = existing.coachId;

      const { serviceId, startAt, notes, groupDescription, clientId, clientFirstName, clientLastName } = req.body;

      const updateData: any = {};
      if (notes !== undefined) updateData.notes = notes;
      if (req.body.location !== undefined) updateData.location = req.body.location;
      if (groupDescription !== undefined) updateData.groupDescription = groupDescription;

      if (serviceId && serviceId !== existing.serviceId) {
        const service = await storage.getService(serviceId);
        if (!service) return res.status(404).json({ message: "Service not found" });
        updateData.serviceId = serviceId;

        const isSemiPrivate = service.name.toLowerCase().includes("semi-private");
        updateData.maxParticipants = isSemiPrivate ? 6 : null;

        if (startAt) {
          const start = new Date(startAt);
          const end = addMinutes(start, service.durationMin);
          updateData.startAt = start;
          updateData.endAt = end;
        } else {
          const start = existing.startAt;
          const end = addMinutes(start, service.durationMin);
          updateData.endAt = end;
        }
      } else if (startAt) {
        const service = await storage.getService(existing.serviceId);
        if (!service) return res.status(404).json({ message: "Service not found" });
        const start = new Date(startAt);
        const end = addMinutes(start, service.durationMin);
        updateData.startAt = start;
        updateData.endAt = end;
      }

      if (clientId) {
        updateData.clientId = clientId;
      } else if (clientFirstName && clientLastName) {
        const user = await storage.findOrCreateUserByName(clientFirstName.trim(), clientLastName.trim());
        updateData.clientId = user.id;
      }

      const finalServiceId = updateData.serviceId || existing.serviceId;
      const finalService = await storage.getService(finalServiceId);
      const finalIsSemiPrivate = finalService?.name.toLowerCase().includes("semi-private") || false;
      if (!finalIsSemiPrivate && !updateData.clientId && existing.clientId === userId) {
        return res.status(400).json({ message: "A client is required for non-group sessions. Please select or enter a client." });
      }

      if (updateData.startAt || updateData.endAt) {
        const checkStart = updateData.startAt || existing.startAt;
        const checkEnd = updateData.endAt || existing.endAt;
        const overlapping = await storage.getOverlappingBookings(bookingCoachId, checkStart, checkEnd, bookingId);
        if (overlapping.length > 0) {
          return res.status(409).json({ message: "This time slot overlaps with an existing booking" });
        }
      }

      const updated = await storage.updateBooking(bookingId, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating booking:", error);
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  app.delete("/api/coach/bookings/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachId = await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });

      const bookingId = req.params.id;
      const existing = await storage.getBooking(bookingId);
      if (!existing) return res.status(404).json({ message: "Booking not found" });

      const deleted = await storage.deleteBooking(bookingId);
      if (!deleted) return res.status(500).json({ message: "Failed to delete session" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting booking:", error);
      res.status(500).json({ message: "Failed to delete session" });
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
      const targetCoachId = req.query.coachId as string | undefined;
      const coachId = targetCoachId || await getCoachId(userId);
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
      const targetCoachId = req.body.coachId as string | undefined;
      const coachId = targetCoachId || await getCoachId(userId);
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
        location: req.body.location || "",
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
      const targetCoachId = req.query.coachId as string | undefined;
      const coachId = targetCoachId || await getCoachId(userId);
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

  app.get("/api/sessions/open", async (_req, res) => {
    try {
      const sessions = await storage.getOpenSemiPrivateSessions();
      const safe = sessions.map(s => {
        const { coach, ...rest } = s;
        if (coach) {
          const { passwordHash, email, ...safeCoach } = coach;
          return { ...rest, coach: safeCoach };
        }
        return rest;
      });
      res.json(safe);
    } catch (error) {
      console.error("Error fetching open sessions:", error);
      res.status(500).json({ message: "Failed to fetch open sessions" });
    }
  });

  app.get("/api/bookings/:id/participants", async (req, res) => {
    try {
      const participants = await storage.getBookingParticipants(req.params.id);
      res.json(participants);
    } catch (error) {
      console.error("Error fetching participants:", error);
      res.status(500).json({ message: "Failed to fetch participants" });
    }
  });

  app.post("/api/bookings/:id/join", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const bookingId = req.params.id;

      const booking = await storage.getBooking(bookingId);
      if (!booking) return res.status(404).json({ message: "Session not found" });
      if (!booking.maxParticipants) return res.status(400).json({ message: "This is not a group session" });
      if (!["CONFIRMED", "PENDING"].includes(booking.status)) {
        return res.status(400).json({ message: "This session is no longer available" });
      }

      const participants = await storage.getBookingParticipants(bookingId);
      if (participants.length >= booking.maxParticipants) {
        return res.status(409).json({ message: "This session is full" });
      }

      const alreadyJoined = participants.some(p => p.userId === userId && !p.participantName);
      const participantNames: string[] = req.body.participantNames || [];

      const namesToAdd = participantNames.length > 0
        ? participantNames.filter(n => n.trim())
        : [null];

      const totalAfterJoin = participants.length + namesToAdd.length;
      if (totalAfterJoin > booking.maxParticipants) {
        return res.status(409).json({ message: `Only ${booking.maxParticipants - participants.length} spots remaining` });
      }

      if (participantNames.length === 0 && alreadyJoined) {
        return res.status(409).json({ message: "You have already joined this session" });
      }

      const added = [];
      for (const name of namesToAdd) {
        const p = await storage.addBookingParticipant({
          bookingId,
          userId,
          ...(name ? { participantName: name.trim() } : {}),
        });
        added.push(p);
      }
      res.json(added.length === 1 ? added[0] : added);
    } catch (error) {
      console.error("Error joining session:", error);
      res.status(500).json({ message: "Failed to join session" });
    }
  });

  app.delete("/api/bookings/:id/leave", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const bookingId = req.params.id;

      await storage.removeBookingParticipant(bookingId, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error leaving session:", error);
      res.status(500).json({ message: "Failed to leave session" });
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

  app.get("/api/athletic/bookings", async (req, res) => {
    try {
      const date = req.query.date as string;
      if (!date) return res.status(400).json({ message: "date query param required" });
      const list = await storage.getAthleticBookings(date);
      res.json(list);
    } catch (error) {
      console.error("Error fetching athletic bookings:", error);
      res.status(500).json({ message: "Failed to fetch athletic bookings" });
    }
  });

  app.post("/api/athletic/bookings", async (req: any, res) => {
    try {
      const { insertAthleticBookingSchema } = await import("@shared/schema");
      const parsed = insertAthleticBookingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten().fieldErrors });
      }
      const { date, timeSlot, teamName, trainingType, bookedBy } = parsed.data;
      const validSlots = ["16:00", "17:00", "18:00", "19:00"];
      if (!validSlots.includes(timeSlot)) {
        return res.status(400).json({ message: "Invalid time slot. Must be between 4 PM and 8 PM." });
      }
      const count = await storage.countAthleticBookingsForSlot(date, timeSlot);
      if (count >= 2) {
        return res.status(409).json({ message: "This time slot is full (max 2 teams per hour)" });
      }
      const booking = await storage.createAthleticBooking({ date, timeSlot, teamName, trainingType: trainingType || "strength", bookedBy: bookedBy || null });
      res.json(booking);
    } catch (error) {
      console.error("Error creating athletic booking:", error);
      res.status(500).json({ message: "Failed to create athletic booking" });
    }
  });

  app.delete("/api/athletic/bookings/:id", async (req, res) => {
    try {
      await storage.deleteAthleticBooking(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting athletic booking:", error);
      res.status(500).json({ message: "Failed to delete athletic booking" });
    }
  });

  app.post("/api/chat", async (req: any, res) => {
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ message: "Messages array required" });
      }

      const userId = req.user?.claims?.sub || null;
      let userRole = "CLIENT";
      let userName: string | null = null;
      let coachId: string | null = null;

      if (userId) {
        userRole = await getUserRole(userId);
        const user = await storage.getUser(userId);
        if (user) {
          userName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || null;
        }
        if (userRole === "COACH" || userRole === "ADMIN") {
          const coachProfile = await storage.getCoachProfileByUserId(userId);
          if (coachProfile) {
            coachId = coachProfile.id;
          }
        }
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let clientDisconnected = false;
      req.on("close", () => { clientDisconnected = true; });

      const generator = handleAssistantMessage(messages, userId, userRole, userName, coachId);
      for await (const chunk of generator) {
        if (clientDisconnected) break;
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }
      if (!clientDisconnected) {
        res.write("data: [DONE]\n\n");
      }
      res.end();
    } catch (error: any) {
      console.error("Chat error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Chat error: " + (error.message || "Unknown error") });
      } else {
        res.write(`data: ${JSON.stringify({ error: error.message || "Unknown error" })}\n\n`);
        res.end();
      }
    }
  });

  return httpServer;
}
