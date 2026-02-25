import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated, createAuthToken, deleteAuthToken } from "./replit_integrations/auth";
import { addDays, startOfWeek, format, parseISO, addMinutes, setHours, setMinutes } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import bcrypt from "bcryptjs";
import { handleAssistantMessage } from "./scheduling-assistant";
import { sendWelcomeEmail, sendCoachWelcomeEmail, sendBookingConfirmationToClient, sendBookingNotificationToCoach, sendCashoutRequestEmail, sendPaymentConfirmationEmail, sendTeamQuoteEmail, sendTeamTrainingRequestEmail } from "./email";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { startWeeklyReminderJob } from "./weekly-reminder";

const OWNER_EMAIL = "bryan.jones@efficiencystrengthtraining.com";

async function getCoachPayoutRate(coachId: string): Promise<number> {
  const ownerCoach = await isOwner(coachId);
  if (ownerCoach) return 1.0;
  const profile = await storage.getCoachProfile(coachId);
  if (profile && profile.payoutPercentage !== null && profile.payoutPercentage !== undefined) {
    return profile.payoutPercentage / 100;
  }
  const pctStr = await storage.getSetting("coach_payout_percentage");
  const pct = parseInt(pctStr || "50");
  return (isNaN(pct) ? 50 : pct) / 100;
}

async function isOwner(coachId: string): Promise<boolean> {
  const profile = await storage.getCoachProfile(coachId);
  if (!profile) return false;
  const user = await storage.getUser(profile.userId);
  return user?.email === OWNER_EMAIL;
}

async function getOwnerUserId(): Promise<string | null> {
  const user = await storage.getUserByEmail(OWNER_EMAIL);
  return user?.id || null;
}

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
      storage.updateLastSignIn(userId).catch(() => {});
      res.json({ success: true, redirect: "/coach", token });
    } catch (error) {
      console.error("Coach login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/admin/setup", async (req: any, res) => {
    try {
      const { db: dbRef } = await import("./db");
      const { users } = await import("@shared/models/auth");
      const { userProfiles } = await import("@shared/schema");

      const adminEmail = "admin@efficiencystrengthtraining.com";
      const existing = await storage.getUserByEmail(adminEmail);
      if (existing) {
        const token = await createAuthToken(existing.id);
        return res.json({ success: true, message: "Admin already exists, token refreshed", token });
      }

      const hash = await bcrypt.hash("ESTadmin2025!", 10);
      const [created] = await dbRef.insert(users).values({
        email: adminEmail,
        firstName: "EST",
        lastName: "Admin",
        passwordHash: hash,
      }).returning();

      await dbRef.insert(userProfiles).values({ userId: created.id, role: "ADMIN" as any });
      const token = await createAuthToken(created.id);
      res.json({ success: true, message: "Admin created", token });
    } catch (error) {
      console.error("Admin setup error:", error);
      res.status(500).json({ message: "Setup failed" });
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
        lastSignInAt: new Date(),
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
      storage.updateLastSignIn(user.id).catch(() => {});
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

  app.get("/api/organizations/:slug", async (req: any, res) => {
    try {
      const org = await storage.getOrganizationBySlug(req.params.slug);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      res.json(org);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch organization" });
    }
  });

  app.get("/api/organizations/:slug/coaches", async (req: any, res) => {
    try {
      const org = await storage.getOrganizationBySlug(req.params.slug);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      const coaches = await storage.getCoachProfilesByOrganization(org.id);
      res.json(coaches);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch coaches" });
    }
  });

  app.post("/api/organizations/register", async (req: any, res) => {
    try {
      const { businessName, slug, email, password, firstName, lastName } = req.body;
      if (!businessName || !slug || !email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: "All fields are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").trim();
      if (!slugClean || slugClean.length < 3) {
        return res.status(400).json({ message: "URL slug must be at least 3 characters (letters, numbers, hyphens)" });
      }

      const reservedSlugs = ["api", "admin", "coach", "sessions", "athletic", "bookings", "wallet", "efficiencystrength", "team-training"];
      if (reservedSlugs.includes(slugClean)) {
        return res.status(400).json({ message: "This URL is reserved. Please choose a different one." });
      }

      const existingOrg = await storage.getOrganizationBySlug(slugClean);
      if (existingOrg) {
        return res.status(409).json({ message: "This URL is already taken. Please choose a different one." });
      }

      const existingUser = await storage.getUserByEmail(email.toLowerCase());
      if (existingUser) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }

      const hash = await bcrypt.hash(password, 10);

      const { db: dbRef } = await import("./db");
      const { users } = await import("@shared/models/auth");
      const { userProfiles, organizations, coachProfiles } = await import("@shared/schema");

      const [user] = await dbRef.insert(users).values({
        email: email.toLowerCase().trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        passwordHash: hash,
        lastSignInAt: new Date(),
      }).returning();

      const [org] = await dbRef.insert(organizations).values({
        name: businessName.trim(),
        slug: slugClean,
        ownerUserId: user.id,
        ownerEmail: email.toLowerCase().trim(),
      }).returning();

      await dbRef.insert(userProfiles).values({ userId: user.id, role: "ADMIN" as any, organizationId: org.id });

      await dbRef.insert(coachProfiles).values({
        userId: user.id,
        email: email.toLowerCase().trim(),
        passwordHash: hash,
        bio: "",
        specialties: [],
        isActive: true,
        organizationId: org.id,
      });

      const token = await createAuthToken(user.id);

      sendCoachWelcomeEmail(email.toLowerCase().trim(), firstName.trim()).catch(() => {});

      res.json({ success: true, organization: org, token, redirect: "/coach" });
    } catch (error) {
      console.error("Organization register error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
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

      const OWNER_EMAIL = "bryan.jones@efficiencystrengthtraining.com";
      if (profile.role !== "ADMIN") {
        const user = await storage.getUser(userId);
        if (user && user.email === OWNER_EMAIL) {
          profile = await storage.upsertUserProfile({ userId, role: "ADMIN" as any });
          console.log(`Owner ${userId} (${user.email}) promoted to ADMIN`);
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
        ageRange: isSemiPrivate ? (req.body.ageRange || "") : "",
        skillLevel: isSemiPrivate ? (req.body.skillLevel || "") : "",
      });

      if (isSemiPrivate) {
        const participantNames: string[] = req.body.participantNames || [];
        const filledNames = participantNames.filter((n: string) => n.trim());
        const count = filledNames.length > 0 ? filledNames.length : 1;

        const maxP = booking.maxParticipants || 6;
        if (count > maxP) {
          return res.status(400).json({ message: `Maximum ${maxP} participants per session` });
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
          const tz = coachProfile?.timezone || coach?.timezone || "America/New_York";
          if (clientUser?.email) {
            sendBookingConfirmationToClient(
              clientUser.email,
              clientUser.firstName || "there",
              coachProfile?.user ? `${coachProfile.user.firstName} ${coachProfile.user.lastName}` : "your coach",
              service.name,
              start,
              end,
              req.body.location || undefined,
              tz
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
              req.body.location || undefined,
              tz
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

      const { clientId, clientFirstName, clientLastName, serviceId, startAt, notes, maxParticipants, groupDescription, ageRange, skillLevel } = req.body;

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
        ageRange: isSemiPrivate ? (ageRange || "") : "",
        skillLevel: isSemiPrivate ? (skillLevel || "") : "",
        teamQuoteProgramId: req.body.teamQuoteProgramId || null,
      });

      if (isSemiPrivate) {
        const participantsArr: Array<{ type: string; userId?: string; displayName: string }> = req.body.participants || [];
        const participantNames: string[] = req.body.participantNames || [];
        const filledNames = participantNames.filter((n: string) => n.trim());

        if (participantsArr.length > 0) {
          const validParticipants = participantsArr.filter((p: any) => p.displayName?.trim());
          const maxPCoach = booking.maxParticipants || 6;
          if (validParticipants.length > maxPCoach) {
            return res.status(400).json({ message: `Maximum ${maxPCoach} participants per session` });
          }
          const seen = new Set<string>();
          for (const p of validParticipants) {
            const key = p.userId ? `user:${p.userId}` : `name:${p.displayName.trim().toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            await storage.addBookingParticipant({
              bookingId: booking.id,
              userId: p.userId || resolvedClientId,
              participantName: p.displayName.trim(),
            });
          }
        } else if (filledNames.length > 0) {
          const maxPNames = booking.maxParticipants || 6;
          if (filledNames.length > maxPNames) {
            return res.status(400).json({ message: `Maximum ${maxPNames} participants per session` });
          }
          for (const name of filledNames) {
            await storage.addBookingParticipant({
              bookingId: booking.id,
              userId: resolvedClientId,
              participantName: name.trim(),
            });
          }
        } else {
          await storage.addBookingParticipant({
            bookingId: booking.id,
            userId: resolvedClientId,
          });
        }
      }

      (async () => {
        try {
          const clientUser = await storage.getUser(resolvedClientId);
          const coachProfile = await storage.getCoachProfile(coachId);
          const tz = coachProfile?.timezone || "America/New_York";
          if (clientUser?.email) {
            sendBookingConfirmationToClient(
              clientUser.email,
              clientUser.firstName || "there",
              coachProfile?.user ? `${coachProfile.user.firstName} ${coachProfile.user.lastName}` : "your coach",
              service.name,
              start,
              end,
              req.body.location || undefined,
              tz
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
              req.body.location || undefined,
              tz
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

  app.post("/api/coach/bookings/clone", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { bookingId, intervalDays, endDate, daysOfWeek } = req.body;
      if (!bookingId || !endDate) {
        return res.status(400).json({ message: "bookingId and endDate are required" });
      }
      if (!intervalDays && (!daysOfWeek || !Array.isArray(daysOfWeek) || daysOfWeek.length === 0)) {
        return res.status(400).json({ message: "Either intervalDays or daysOfWeek must be provided" });
      }

      const sourceBooking = await storage.getBooking(bookingId);
      if (!sourceBooking) return res.status(404).json({ message: "Source booking not found" });

      const targetCoachId = sourceBooking.coachId;
      const service = await storage.getService(sourceBooking.serviceId);
      if (!service) return res.status(404).json({ message: "Service not found" });

      const sourceStart = new Date(sourceBooking.startAt);
      const sourceEnd = new Date(sourceBooking.endAt);
      const durationMs = sourceEnd.getTime() - sourceStart.getTime();
      const endDateObj = new Date(endDate + "T23:59:59");

      const groupId = sourceBooking.recurringGroupId || `rg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (!sourceBooking.recurringGroupId) {
        await storage.updateBooking(bookingId, { recurringGroupId: groupId } as any);
      }

      const created: any[] = [];
      const skipped: string[] = [];
      const useCustomDays = daysOfWeek && Array.isArray(daysOfWeek) && daysOfWeek.length > 0;
      const dayStep = useCustomDays ? 1 : intervalDays;
      let currentStart = new Date(sourceStart.getTime() + dayStep * 24 * 60 * 60 * 1000);

      while (currentStart <= endDateObj) {
        const shouldCreate = useCustomDays ? daysOfWeek.includes(currentStart.getDay()) : true;

        if (shouldCreate) {
          const currentEnd = new Date(currentStart.getTime() + durationMs);
          const overlapping = await storage.getOverlappingBookings(targetCoachId, currentStart, currentEnd);
          if (overlapping.length > 0) {
            skipped.push(currentStart.toISOString());
          } else {
            const booking = await storage.createBooking({
              clientId: sourceBooking.clientId,
              coachId: targetCoachId,
              serviceId: sourceBooking.serviceId,
              startAt: currentStart,
              endAt: currentEnd,
              status: "CONFIRMED",
              notes: sourceBooking.notes || "",
              location: sourceBooking.location || "",
              maxParticipants: sourceBooking.maxParticipants,
              groupDescription: sourceBooking.groupDescription || "",
              ageRange: sourceBooking.ageRange || "",
              skillLevel: sourceBooking.skillLevel || "",
              recurringGroupId: groupId,
            });
            created.push(booking);
          }
        }

        currentStart = new Date(currentStart.getTime() + dayStep * 24 * 60 * 60 * 1000);
      }

      res.json({ created: created.length, skipped: skipped.length, skippedDates: skipped, recurringGroupId: groupId });
    } catch (error) {
      console.error("Error cloning bookings:", error);
      res.status(500).json({ message: "Failed to clone sessions" });
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

      const { serviceId, startAt, notes, groupDescription, clientId, clientFirstName, clientLastName, paymentMethod, ageRange, skillLevel, maxParticipants } = req.body;

      const updateData: any = {};
      if (notes !== undefined) updateData.notes = notes;
      if (req.body.location !== undefined) updateData.location = req.body.location;
      if (groupDescription !== undefined) updateData.groupDescription = groupDescription;
      if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
      if (ageRange !== undefined) updateData.ageRange = ageRange;
      if (skillLevel !== undefined) updateData.skillLevel = skillLevel;
      if (maxParticipants !== undefined) updateData.maxParticipants = maxParticipants;

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
      const deleteGroup = req.query.deleteGroup === "true";
      const existing = await storage.getBooking(bookingId);
      if (!existing) return res.status(404).json({ message: "Booking not found" });

      if (deleteGroup && existing.recurringGroupId) {
        const count = await storage.deleteBookingsByRecurringGroup(existing.recurringGroupId);
        res.json({ success: true, deletedCount: count });
      } else {
        const deleted = await storage.deleteBooking(bookingId);
        if (!deleted) return res.status(500).json({ message: "Failed to delete session" });
        res.json({ success: true, deletedCount: 1 });
      }
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
      const allBookings = await storage.getAllBookings();
      const servicesList = await storage.getServices();
      const enriched = redemptionsList.map((r: any) => {
        const booking = allBookings.find((b: any) => b.id === r.bookingId);
        const service = booking ? servicesList.find((s: any) => s.id === booking.serviceId) : undefined;
        return {
          ...r,
          sessionPriceCents: service?.priceCents || 0,
          serviceName: service?.name || "Session",
        };
      });
      res.json(enriched);
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
      let perPersonCents = service?.priceCents || 0;

      const isFreeIntro = service?.name.toLowerCase().includes("free intro") || false;
      const isTeamTraining = service?.name.toLowerCase().includes("team training") || false;
      const isBlufftonHS = booking.location?.toLowerCase().includes("bluffton high") || false;
      const isTeamContract = isTeamTraining && isBlufftonHS;

      const isSpringIsland = booking.location?.toLowerCase().includes("spring island");
      if (isSpringIsland && service && !isTeamContract) {
        if (service.durationMin <= 30) {
          perPersonCents = 6200;
        } else {
          perPersonCents = 9500;
        }
      }

      const isSemiPrivate = booking.maxParticipants !== null && booking.maxParticipants > 1;

      let totalCollectedCents = 0;
      let amountCents = 0;

      if (isFreeIntro) {
        amountCents = 2000;
      } else if (booking.teamQuoteProgramId) {
        const allQuotes = await storage.getAllTeamQuotes();
        const contractQuotes = allQuotes.filter(q => q.programId === booking.teamQuoteProgramId);
        if (contractQuotes.length > 0) {
          const contract = contractQuotes[0];
          const freqMatch = contract.frequency.match(/(\d+)/);
          const freqNum = freqMatch ? parseInt(freqMatch[1]) : 1;
          const sessionsPerMonth = freqNum * 4.33;
          const perSessionCents = Math.round(contract.totalCents / sessionsPerMonth);
          const payoutRate = await getCoachPayoutRate(booking.coachId);
          amountCents = Math.round(perSessionCents * payoutRate);
        } else {
          amountCents = (service?.durationMin || 60) <= 30 ? 1000 : 2000;
        }
      } else if (isTeamContract) {
        amountCents = (service?.durationMin || 60) <= 30 ? 1000 : 2000;
      } else {
        if (isSemiPrivate) {
          const participants = await storage.getBookingParticipants(bookingId);

          const chargeableMap = new Map<string, { userId: string; name: string; count: number }>();
          let walkInCount = 0;

          for (const p of participants) {
            const isWalkIn = p.userId.startsWith("walk-in-");
            if (isWalkIn) {
              walkInCount++;
            } else {
              const existing = chargeableMap.get(p.userId);
              if (existing) {
                existing.count++;
              } else {
                const name = p.user ? `${p.user.firstName || ""} ${p.user.lastName || ""}`.trim() : "Participant";
                chargeableMap.set(p.userId, { userId: p.userId, name, count: 1 });
              }
            }
          }

          if (perPersonCents > 0) {
            for (const entry of Array.from(chargeableMap.values())) {
              const totalForUser = perPersonCents * entry.count;
              await storage.debitWallet(
                entry.userId,
                totalForUser,
                `Semi-Private Session: ${service?.name || "Training"} (${entry.count} spot${entry.count > 1 ? "s" : ""}) - Redeemed`,
                "redemption",
                bookingId
              );
              totalCollectedCents += totalForUser;
            }
          }

          if (walkInCount > 0) {
            totalCollectedCents += walkInCount * perPersonCents;
          }

          const totalParticipantCount = chargeableMap.size + walkInCount;
          if (totalParticipantCount === 1) {
            amountCents = 3000;
          } else {
            const payoutRate = await getCoachPayoutRate(booking.coachId);
            amountCents = Math.round(totalCollectedCents * payoutRate);
          }
        } else {
          if (perPersonCents > 0) {
            await storage.debitWallet(
              booking.clientId,
              perPersonCents,
              `Session: ${service?.name || "Training"} - Redeemed`,
              "redemption",
              bookingId
            );
            totalCollectedCents = perPersonCents;
          }

          const payoutRate = await getCoachPayoutRate(booking.coachId);
          amountCents = Math.round(totalCollectedCents * payoutRate);
        }
      }

      const redemption = await storage.createRedemption({
        bookingId,
        coachId: booking.coachId,
        amountCents,
        payoutStatus: "PENDING",
      });

      res.json(redemption);
    } catch (error) {
      console.error("Error creating redemption:", error);
      res.status(500).json({ message: "Failed to create redemption" });
    }
  });

  app.get("/api/coach/cashouts", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachId = await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });
      const cashoutsList = await storage.getCoachCashouts(coachId);
      res.json(cashoutsList);
    } catch (error) {
      console.error("Error fetching cashouts:", error);
      res.status(500).json({ message: "Failed to fetch cashouts" });
    }
  });

  app.post("/api/cashouts", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const coachId = await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });

      const coachProfile = await storage.getCoachProfile(coachId);
      if (!coachProfile) return res.status(404).json({ message: "Coach profile not found" });

      const ownerUserId = await getOwnerUserId();
      if (ownerUserId && coachProfile.userId === ownerUserId) return res.status(403).json({ message: "Owner does not need to cash out" });

      const redemptionsList = await storage.getCoachRedemptions(coachId);
      const pendingAmount = redemptionsList
        .filter((r) => r.payoutStatus === "PENDING")
        .reduce((sum, r) => sum + r.amountCents, 0);

      if (pendingAmount <= 0) return res.status(400).json({ message: "No pending balance to cash out" });

      const cashout = await storage.createCashout({
        coachId,
        amountCents: pendingAmount,
        status: "REQUESTED",
      });

      await storage.markRedemptionsSent(coachId);

      const coachName = `${coachProfile.user?.firstName} ${coachProfile.user?.lastName}`;
      const bryanEmail = "bryan.jones@efficiencystrengthtraining.com";
      sendCashoutRequestEmail(bryanEmail, coachName, pendingAmount, cashout.id).catch(console.error);

      res.json(cashout);
    } catch (error) {
      console.error("Error creating cashout:", error);
      res.status(500).json({ message: "Failed to create cashout request" });
    }
  });

  app.get("/api/coach/payout-redemptions", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const allRedemptions = await storage.getAllRedemptions();
      const coaches = await storage.getCoachProfiles();
      const result = allRedemptions.map((r: any) => {
        const coach = coaches.find((cp: any) => cp.id === r.coachId);
        return {
          id: r.id,
          coachId: r.coachId,
          coachEmail: coach?.user?.email || null,
          amountCents: r.amountCents,
          redeemedAt: r.redeemedAt,
          payoutStatus: r.payoutStatus,
        };
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching payout redemptions:", error);
      res.status(500).json({ message: "Failed to fetch payout redemptions" });
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

      try {
        const coachProfile = await storage.getCoachProfile(booking.coachId);
        const service = await storage.getService(booking.serviceId);
        const joiningUser = await storage.getUser(userId);
        if (coachProfile && joiningUser) {
          const participantName = namesToAdd.filter(Boolean).length > 0
            ? namesToAdd.filter(Boolean).join(", ")
            : `${joiningUser.firstName || ""} ${joiningUser.lastName || ""}`.trim();
          const coachName = `${coachProfile.user?.firstName || ""} ${coachProfile.user?.lastName || ""}`.trim();
          const tz = coachProfile.timezone || "America/New_York";
          const sessionName = service?.name || "Group Session";
          const { sendGroupSessionJoinNotification, sendGroupSessionJoinConfirmation } = await import("./email");
          if (coachProfile.user?.email) {
            sendGroupSessionJoinNotification(
              coachProfile.user.email,
              coachProfile.user.firstName || "Coach",
              participantName || "A user",
              sessionName,
              booking.startAt,
              booking.endAt,
              booking.location || undefined,
              tz
            ).catch(() => {});
          }
          if (joiningUser.email) {
            sendGroupSessionJoinConfirmation(
              joiningUser.email,
              joiningUser.firstName || "there",
              coachName || "Your Coach",
              sessionName,
              booking.startAt,
              booking.endAt,
              booking.location || undefined,
              tz
            ).catch(() => {});
          }
        }
      } catch (emailErr) {
        console.error("Error sending group join notification:", emailErr);
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

  app.get("/api/coach/users", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsersWithProfiles();
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/coach/users/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.params.id;
      const { firstName, lastName, email } = req.body;
      const updated = await storage.updateUser(userId, { firstName, lastName, email });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/coach/users/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.params.id;
      const deleted = await storage.deleteUser(userId);
      if (!deleted) return res.status(404).json({ message: "User not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  app.get("/api/coach/users/:id/bookings", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.params.id;
      const userBookings = await storage.getBookingsForUser(userId);
      res.json(userBookings);
    } catch (error) {
      console.error("Error fetching user bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  app.post("/api/coach/bookings/:id/add-participant", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const bookingId = req.params.id;
      const { userId, participantName } = req.body;

      const booking = await storage.getBooking(bookingId);
      if (!booking) return res.status(404).json({ message: "Session not found" });
      if (!booking.maxParticipants) return res.status(400).json({ message: "This is not a group session" });

      const participants = await storage.getBookingParticipants(bookingId);
      if (participants.length >= booking.maxParticipants) {
        return res.status(409).json({ message: "This session is full" });
      }

      const targetUserId = userId || (participantName ? booking.clientId : req.user.claims.sub);

      const alreadyJoined = participants.some(p => p.userId === targetUserId && (!participantName || p.participantName === participantName?.trim()));
      if (alreadyJoined) {
        return res.status(409).json({ message: "This user is already a participant in this session" });
      }

      const p = await storage.addBookingParticipant({
        bookingId,
        userId: targetUserId,
        ...(participantName ? { participantName: participantName.trim() } : {}),
      });
      res.json(p);
    } catch (error) {
      console.error("Error adding participant:", error);
      res.status(500).json({ message: "Failed to add participant" });
    }
  });

  app.delete("/api/coach/bookings/:id/participants/:participantId", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const bookingId = req.params.id;
      const participantId = req.params.participantId;

      const booking = await storage.getBooking(bookingId);
      if (!booking) return res.status(404).json({ message: "Session not found" });

      const participants = await storage.getBookingParticipants(bookingId);
      const target = participants.find(p => p.id === participantId);
      if (!target) return res.status(404).json({ message: "Participant not found in this session" });

      await storage.removeBookingParticipantById(participantId);
      res.json({ message: "Participant removed" });
    } catch (error) {
      console.error("Error removing participant:", error);
      res.status(500).json({ message: "Failed to remove participant" });
    }
  });

  app.post("/api/coach/manual-payment", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { userId, amountCents, method } = req.body;
      if (!userId || !amountCents || !method) {
        return res.status(400).json({ message: "userId, amountCents, and method are required" });
      }
      if (amountCents <= 0) {
        return res.status(400).json({ message: "Amount must be greater than zero" });
      }
      if (!["cash", "venmo"].includes(method)) {
        return res.status(400).json({ message: "Method must be cash or venmo" });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const description = `Manual payment (${method === "cash" ? "Cash" : "Venmo"})`;
      const tx = await storage.creditWallet(userId, amountCents, description);

      if (user.email) {
        const newBalance = await storage.getUserBalance(userId);
        sendPaymentConfirmationEmail(user.email, user.firstName || "Client", amountCents, description, newBalance).catch(() => {});
      }

      res.json(tx);
    } catch (error) {
      console.error("Error recording manual payment:", error);
      res.status(500).json({ message: "Failed to record payment" });
    }
  });

  app.get("/api/coach/transactions", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const transactions = await storage.getAllWalletTransactions();
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  app.get("/api/coach/user-balances", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const balances = await storage.getAllUserBalances();
      res.json(balances);
    } catch (error) {
      console.error("Error fetching user balances:", error);
      res.status(500).json({ message: "Failed to fetch user balances" });
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

  app.post("/api/admin/coaches", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { firstName, lastName, email, password, bio, specialties } = req.body;
      if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ message: "First name, last name, email, and password are required" });
      }
      if (typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ message: "Please provide a valid email address" });
      }
      if (typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      if (existingUser) {
        const existingCoach = await storage.getCoachProfileByUserId(existingUser.id);
        if (existingCoach) {
          return res.status(400).json({ message: "A coach with this email already exists" });
        }
        const existingProfile = await storage.getUserProfile(existingUser.id);
        if (existingProfile?.role === "ADMIN") {
          return res.status(400).json({ message: "This user is an admin and cannot be added as a coach" });
        }
      }

      const { db: dbRef } = await import("./db");
      const { users: usersTable } = await import("@shared/models/auth");

      let userId: string;
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const [newUser] = await dbRef.insert(usersTable).values({
          email: normalizedEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          profileImageUrl: null,
          lastSignInAt: new Date(),
        }).returning();
        userId = newUser.id;
      }

      await storage.upsertUserProfile({ userId, role: "COACH" });

      const passwordHash = await bcrypt.hash(password, 10);
      const parsedSpecialties = Array.isArray(specialties)
        ? specialties.filter((s: any) => typeof s === "string" && s.trim())
        : [];
      const coachProfile = await storage.createCoachProfile({
        userId,
        email: normalizedEmail,
        passwordHash,
        bio: typeof bio === "string" ? bio.trim() : "",
        specialties: parsedSpecialties,
        timezone: "America/New_York",
        isActive: true,
      });

      sendCoachWelcomeEmail(normalizedEmail, firstName.trim(), password).catch((err: any) => {
        console.error("Failed to send coach welcome email:", err);
      });

      res.json({ success: true, coachProfile });
    } catch (error: any) {
      console.error("Error creating coach:", error);
      if (error?.message?.includes("unique") || error?.code === "23505") {
        return res.status(400).json({ message: "A coach with this email already exists" });
      }
      res.status(500).json({ message: "Failed to create coach" });
    }
  });

  app.patch("/api/admin/coaches/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { bio, specialties, isActive, payoutPercentage } = req.body;
      const updateData: Record<string, any> = {};
      if (bio !== undefined) updateData.bio = bio;
      if (specialties !== undefined) updateData.specialties = Array.isArray(specialties) ? specialties : [];
      if (isActive !== undefined) updateData.isActive = isActive;
      if (payoutPercentage !== undefined) {
        const pct = parseInt(payoutPercentage);
        if (isNaN(pct) || pct < 0 || pct > 100) {
          return res.status(400).json({ message: "Percentage must be between 0 and 100" });
        }
        updateData.payoutPercentage = pct;
      }
      const updated = await storage.updateCoachProfile(id, updateData);
      if (!updated) return res.status(404).json({ message: "Coach not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating coach:", error);
      res.status(500).json({ message: "Failed to update coach" });
    }
  });

  app.delete("/api/admin/coaches/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteCoachProfile(id);
      if (!deleted) return res.status(404).json({ message: "Coach not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting coach:", error);
      res.status(500).json({ message: "Failed to delete coach" });
    }
  });

  app.patch("/api/admin/coaches/:id/payout", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { payoutPercentage } = req.body;
      if (payoutPercentage === undefined || payoutPercentage === null) {
        return res.status(400).json({ message: "payoutPercentage required" });
      }
      const pct = parseInt(payoutPercentage);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ message: "Percentage must be between 0 and 100" });
      }
      const updated = await storage.updateCoachProfile(id, { payoutPercentage: pct });
      if (!updated) return res.status(404).json({ message: "Coach not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating coach payout:", error);
      res.status(500).json({ message: "Failed to update coach payout" });
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

  app.patch("/api/admin/services/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { name, description, durationMin, priceCents, active } = req.body;
      const existing = await storage.getService(id);
      if (!existing) return res.status(404).json({ message: "Service not found" });

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (durationMin !== undefined) updateData.durationMin = durationMin;
      if (active !== undefined) updateData.active = active;

      const priceChanged = priceCents !== undefined && priceCents !== existing.priceCents;
      if (priceCents !== undefined) updateData.priceCents = priceCents;

      try {
        const stripe = await getUncachableStripeClient();
        let stripeProductId = existing.stripeProductId;

        if (!stripeProductId) {
          const product = await stripe.products.create({
            name: updateData.name || existing.name,
            description: updateData.description || existing.description || undefined,
          });
          stripeProductId = product.id;
          updateData.stripeProductId = product.id;
        } else {
          await stripe.products.update(stripeProductId, {
            name: updateData.name || existing.name,
            description: updateData.description || existing.description || undefined,
          });
        }

        if (priceChanged && stripeProductId) {
          if (existing.stripePriceId) {
            await stripe.prices.update(existing.stripePriceId, { active: false });
          }
          const newPrice = await stripe.prices.create({
            product: stripeProductId,
            unit_amount: priceCents,
            currency: "usd",
          });
          updateData.stripePriceId = newPrice.id;
        }
      } catch (stripeErr) {
        console.error("Stripe sync error (continuing with local update):", stripeErr);
      }

      const updated = await storage.updateService(id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating service:", error);
      res.status(500).json({ message: "Failed to update service" });
    }
  });

  app.delete("/api/admin/services/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getService(id);
      if (!existing) return res.status(404).json({ message: "Training option not found" });

      try {
        const stripe = await getUncachableStripeClient();
        if (existing.stripeProductId) {
          await stripe.products.update(existing.stripeProductId, { active: false });
        }
        if (existing.stripePriceId) {
          await stripe.prices.update(existing.stripePriceId, { active: false });
        }
      } catch (stripeErr) {
        console.error("Stripe archive error (continuing with local delete):", stripeErr);
      }

      await storage.deleteService(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting service:", error);
      res.status(400).json({ message: error.message || "Failed to delete training option" });
    }
  });

  app.get("/api/admin/settings", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const settings = await storage.getAllSettings();
      const settingsObj: Record<string, string> = {};
      for (const s of settings) settingsObj[s.key] = s.value;
      if (!settingsObj.coach_payout_percentage) settingsObj.coach_payout_percentage = "50";
      res.json(settingsObj);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/admin/settings", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) return res.status(400).json({ message: "key and value required" });
      const allowedKeys = ["coach_payout_percentage"];
      if (!allowedKeys.includes(key)) return res.status(400).json({ message: "Invalid setting key" });

      if (key === "coach_payout_percentage") {
        const num = parseInt(value);
        if (isNaN(num) || num < 0 || num > 100) {
          return res.status(400).json({ message: "Percentage must be between 0 and 100" });
        }
      }

      await storage.setSetting(key, String(value));
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating setting:", error);
      res.status(500).json({ message: "Failed to update setting" });
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
      const coaches = await storage.getCoachProfiles();
      const allBookings = await storage.getAllBookings();
      const servicesList = await storage.getServices();
      const enriched = redemptionsList.map((r: any) => {
        const coach = coaches.find((cp: any) => cp.id === r.coachId);
        const booking = allBookings.find((b: any) => b.id === r.bookingId);
        const service = booking ? servicesList.find((s: any) => s.id === booking.serviceId) : undefined;
        let clientName = "Unknown";
        if (booking?.client) {
          clientName = `${booking.client.firstName} ${booking.client.lastName}`;
        }
        return {
          ...r,
          coachName: coach?.user ? `${coach.user.firstName} ${coach.user.lastName}` : "Unknown",
          coachUserId: coach?.userId || null,
          coachEmail: coach?.user?.email || null,
          serviceName: service?.name || "Session",
          clientName,
          sessionPriceCents: service?.priceCents || 0,
        };
      });
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching all redemptions:", error);
      res.status(500).json({ message: "Failed to fetch redemptions" });
    }
  });

  app.patch("/api/admin/redemptions/:id/amount", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { amountCents } = req.body;
      if (typeof amountCents !== "number" || amountCents < 0) {
        return res.status(400).json({ message: "Valid amountCents required" });
      }
      const updated = await storage.updateRedemptionAmount(id, amountCents);
      if (!updated) return res.status(404).json({ message: "Redemption not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating redemption amount:", error);
      res.status(500).json({ message: "Failed to update redemption" });
    }
  });

  app.get("/api/admin/cashouts", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const cashoutsList = await storage.getAllCashouts();
      const coaches = await storage.getCoachProfiles();
      const enriched = cashoutsList.map((c: any) => {
        const coach = coaches.find((cp: any) => cp.id === c.coachId);
        return {
          ...c,
          coachName: coach?.user ? `${coach.user.firstName} ${coach.user.lastName}` : "Unknown",
        };
      });
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching all cashouts:", error);
      res.status(500).json({ message: "Failed to fetch cashouts" });
    }
  });

  app.patch("/api/admin/cashouts/:id/status", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!["PAID", "DENIED"].includes(status)) {
        return res.status(400).json({ message: "Status must be PAID or DENIED" });
      }
      const updated = await storage.updateCashoutStatus(id, status);
      if (!updated) return res.status(404).json({ message: "Cashout not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating cashout status:", error);
      res.status(500).json({ message: "Failed to update cashout status" });
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

  app.get("/api/wallet", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const balance = await storage.getUserBalance(userId);
      const transactions = await storage.getWalletTransactions(userId);
      res.json({ balanceCents: balance, transactions });
    } catch (error) {
      console.error("Error fetching wallet:", error);
      res.status(500).json({ message: "Failed to fetch wallet" });
    }
  });

  app.post("/api/wallet/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { amountCents } = req.body;

      if (!amountCents || amountCents < 100) {
        return res.status(400).json({ message: "Minimum deposit is $1.00" });
      }
      if (amountCents > 100000) {
        return res.status(400).json({ message: "Maximum deposit is $1,000.00" });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const stripe = await getUncachableStripeClient();

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || undefined,
          metadata: { userId },
        });
        customerId = customer.id;
        await storage.updateUserStripeCustomerId(userId, customerId);
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: "Add Funds to EST Account",
              description: `Add $${(amountCents / 100).toFixed(2)} to your Efficiency Strength Training account balance`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${baseUrl}/wallet?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/wallet?canceled=true`,
        metadata: {
          userId,
          amountCents: amountCents.toString(),
          type: "wallet_deposit",
        },
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  app.get("/api/wallet/verify-session", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sessionId = req.query.sessionId as string;
      if (!sessionId) return res.status(400).json({ message: "sessionId required" });

      const existing = await storage.getWalletTransactionByStripeSessionId(sessionId);
      if (existing) {
        return res.json({ credited: true, alreadyProcessed: true });
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid") {
        return res.json({ credited: false, status: session.payment_status });
      }

      const metaUserId = session.metadata?.userId;
      const amountCents = parseInt(session.metadata?.amountCents || "0", 10);

      if (metaUserId !== userId || amountCents <= 0) {
        return res.status(400).json({ message: "Invalid session" });
      }

      await storage.creditWallet(userId, amountCents, `Added $${(amountCents / 100).toFixed(2)} via Stripe`, sessionId);

      const stripeUser = await storage.getUser(userId);
      if (stripeUser?.email) {
        const newBal = await storage.getUserBalance(userId);
        sendPaymentConfirmationEmail(stripeUser.email, stripeUser.firstName || "Client", amountCents, `Wallet deposit — $${(amountCents / 100).toFixed(2)} via Stripe`, newBal).catch(() => {});
      }

      res.json({ credited: true, amountCents });
    } catch (error) {
      console.error("Error verifying checkout session:", error);
      res.status(500).json({ message: "Failed to verify session" });
    }
  });

  app.get("/api/stripe/publishable-key", async (_req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (error) {
      console.error("Error getting publishable key:", error);
      res.status(500).json({ message: "Failed to get Stripe key" });
    }
  });

  app.get("/api/coach/business-plan/:coachId", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { coachId } = req.params;
      const coach = await storage.getCoachProfile(coachId);
      if (!coach) return res.status(404).json({ message: "Coach not found" });

      const allBookings = await storage.getCoachBookings(coachId);
      const services = await storage.getServices();
      const serviceMap = new Map(services.map(s => [s.id, s]));

      const coachProfiles = await storage.getCoachProfiles();
      const coachUserIds = new Set(coachProfiles.map(cp => cp.userId));
      const thisCoachUserId = coach.userId;

      const allWalletTx = await storage.getAllWalletTransactions();
      const bookingChargeMap = new Map<string, number>();
      for (const tx of allWalletTx) {
        if (tx.type === "DEBIT" && tx.sourceType === "redemption" && tx.sourceId) {
          bookingChargeMap.set(tx.sourceId, (bookingChargeMap.get(tx.sourceId) || 0) + tx.amountCents);
        }
      }

      const coachRedemptions = await storage.getCoachRedemptions(coach.id);
      const redemptionByBooking = new Map<string, number>();
      for (const r of coachRedemptions) {
        redemptionByBooking.set(r.bookingId, r.amountCents);
      }
      const ownerCoach = await isOwner(coachId);
      const coachPayoutRate = await getCoachPayoutRate(coachId);

      const allTeamQuotes = await storage.getAllTeamQuotes();
      const contractPerSessionMap = new Map<string, number>();
      const programQuoteGroups = new Map<string, typeof allTeamQuotes>();
      for (const q of allTeamQuotes) {
        const key = q.programId || q.id;
        if (!programQuoteGroups.has(key)) programQuoteGroups.set(key, []);
        programQuoteGroups.get(key)!.push(q);
      }
      programQuoteGroups.forEach((quotes, programId) => {
        const representative = quotes[0];
        const freqMatch = representative.frequency.match(/(\d+)/);
        const freqNum = freqMatch ? parseInt(freqMatch[1]) : 1;
        const sessionsPerMonth = freqNum * 4.33;
        const perSessionCents = Math.round(representative.totalCents / sessionsPerMonth);
        contractPerSessionMap.set(programId, perSessionCents);
      });

      const bookingContractMap = new Map<string, string>();
      for (const b of allBookings) {
        if (b.teamQuoteProgramId) {
          bookingContractMap.set(b.id, b.teamQuoteProgramId);
        }
      }

      const bookingLocationMap = new Map<string, string | null>();
      for (const b of allBookings) {
        bookingLocationMap.set(b.id, b.location || null);
      }

      const getBookingRevenue = (bookingId: string, serviceId: string): number => {
        const contractProgramId = bookingContractMap.get(bookingId);
        if (contractProgramId) {
          const perSession = contractPerSessionMap.get(contractProgramId);
          if (perSession && perSession > 0) return perSession;
        }
        const service = serviceMap.get(serviceId);
        const isFreeService = service && service.priceCents === 0;
        if (isFreeService) return 0;
        const walletCharge = bookingChargeMap.get(bookingId);
        if (walletCharge !== undefined && walletCharge > 0) return walletCharge;
        const redemptionAmount = redemptionByBooking.get(bookingId);
        if (redemptionAmount !== undefined && redemptionAmount > 0) {
          return ownerCoach ? redemptionAmount : Math.round(redemptionAmount / coachPayoutRate);
        }
        const location = bookingLocationMap.get(bookingId);
        const isSpringIsland = location?.toLowerCase().includes("spring island");
        if (isSpringIsland && service) {
          const isTeamTraining = service.name.toLowerCase().includes("team training");
          const isBlufftonHS = location?.toLowerCase().includes("bluffton high");
          if (!(isTeamTraining && isBlufftonHS)) {
            if (service.durationMin <= 30) {
              return 6200;
            } else {
              return 9500;
            }
          }
        }
        return service?.priceCents || 0;
      };

      const getPerPersonRevenue = (booking: typeof allBookings[0]): number => {
        const service = serviceMap.get(booking.serviceId);
        if (!service) return 0;
        const isFreeService = service.priceCents === 0;
        if (isFreeService) return 0;
        const location = booking.location || null;
        const isSpringIsland = location?.toLowerCase().includes("spring island");
        if (isSpringIsland) {
          const isTeamTraining = service.name.toLowerCase().includes("team training");
          const isBlufftonHS = location?.toLowerCase().includes("bluffton high");
          if (!(isTeamTraining && isBlufftonHS)) {
            return service.durationMin <= 30 ? 6200 : 9500;
          }
        }
        return service.priceCents;
      };

      const clientMap = new Map<string, { id: string; firstName: string; lastName: string; email: string | null; profileImageUrl: string | null; sessions: { date: string; status: string; serviceName: string; priceCents: number; paymentMethod: string | null }[] }>();

      for (const b of allBookings) {
        if (!b.client) continue;
        const clientId = b.clientId;
        if (coachUserIds.has(clientId)) continue;
        if (!clientMap.has(clientId)) {
          clientMap.set(clientId, {
            id: b.client.id,
            firstName: b.client.firstName || "",
            lastName: b.client.lastName || "",
            email: b.client.email || null,
            profileImageUrl: b.client.profileImageUrl || null,
            sessions: [],
          });
        }
        const service = serviceMap.get(b.serviceId);
        const isSemiPrivate = b.maxParticipants !== null && b.maxParticipants > 1;
        const actualRevenue = isSemiPrivate ? getPerPersonRevenue(b) : getBookingRevenue(b.id, b.serviceId);
        clientMap.get(clientId)!.sessions.push({
          date: b.startAt.toISOString(),
          status: b.status,
          serviceName: service?.name || "Unknown",
          priceCents: actualRevenue,
          paymentMethod: b.paymentMethod || null,
        });
      }

      const walkInUserIdMap = new Map<string, string>();

      for (const b of allBookings) {
        const participants = await storage.getBookingParticipants(b.id);
        const service = serviceMap.get(b.serviceId);
        const isSemiPrivate = b.maxParticipants !== null && b.maxParticipants > 1;
        const perPersonRev = isSemiPrivate ? getPerPersonRevenue(b) : getBookingRevenue(b.id, b.serviceId);
        for (const p of participants) {
          if (p.participantName) {
            const walkInKey = `walkin_${p.participantName.toLowerCase().trim()}`;
            if (!clientMap.has(walkInKey)) {
              const nameParts = p.participantName.trim().split(/\s+/);
              clientMap.set(walkInKey, {
                id: walkInKey,
                firstName: nameParts[0] || "",
                lastName: nameParts.slice(1).join(" ") || "",
                email: null,
                profileImageUrl: null,
                sessions: [],
              });
            }
            if (p.userId && !walkInUserIdMap.has(walkInKey)) {
              walkInUserIdMap.set(walkInKey, p.userId);
            }
            clientMap.get(walkInKey)!.sessions.push({
              date: b.startAt.toISOString(),
              status: b.status,
              serviceName: service?.name || "Unknown",
              priceCents: perPersonRev,
              paymentMethod: b.paymentMethod || null,
            });
          } else if (p.userId && p.userId !== b.clientId && !coachUserIds.has(p.userId)) {
            const participantUserId = p.userId;
            if (!clientMap.has(participantUserId)) {
              clientMap.set(participantUserId, {
                id: participantUserId,
                firstName: p.user.firstName || "",
                lastName: p.user.lastName || "",
                email: p.user.email || null,
                profileImageUrl: p.user.profileImageUrl || null,
                sessions: [],
              });
            }
            clientMap.get(participantUserId)!.sessions.push({
              date: b.startAt.toISOString(),
              status: b.status,
              serviceName: service?.name || "Unknown",
              priceCents: perPersonRev,
              paymentMethod: b.paymentMethod || null,
            });
          }
        }
      }

      const clients = Array.from(clientMap.values()).map(client => {
        client.sessions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        return client;
      });

      const now = new Date();
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const monthlyRevByMonth = new Map<string, number>();
      for (const b of allBookings) {
        if (b.status === "CANCELLED" || b.status === "NO_SHOW") continue;
        const d = new Date(b.startAt);
        if (d >= sixMonthsAgo) {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const rev = getBookingRevenue(b.id, b.serviceId);
          monthlyRevByMonth.set(key, (monthlyRevByMonth.get(key) || 0) + rev);
        }
      }

      const sortedMonths = Array.from(monthlyRevByMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const revenueHistory = sortedMonths.map(([month, cents]) => ({ month, revenueCents: cents }));

      let predictedMonthlyRevenueCents = 0;

      const oneWeekAgo = new Date(now);
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      let totalPredicted = 0;
      for (const client of Array.from(clientMap.values())) {
        const hadSessionLastWeek = client.sessions.some(
          (s: { date: string; status: string }) => new Date(s.date) >= oneWeekAgo && (s.status === "COMPLETED" || s.status === "CONFIRMED")
        );
        if (!hadSessionLastWeek) continue;

        const recentClientSessions = client.sessions.filter(
          (s: { date: string; status: string }) => new Date(s.date) >= threeMonthsAgo && (s.status === "COMPLETED" || s.status === "CONFIRMED")
        );
        if (recentClientSessions.length === 0) continue;

        const earliestSession = recentClientSessions.reduce((earliest: Date, s: { date: string }) => {
          const d = new Date(s.date);
          return d < earliest ? d : earliest;
        }, now);
        const msActive = now.getTime() - earliestSession.getTime();
        const monthsActive = Math.max(msActive / (30.44 * 24 * 60 * 60 * 1000), 1);
        const activeMonths = Math.min(monthsActive, 3);
        const sessionsPerMonth = recentClientSessions.length / activeMonths;
        const avgPriceCents = recentClientSessions.reduce((sum: number, s: { priceCents: number }) => sum + s.priceCents, 0) / recentClientSessions.length;
        totalPredicted += sessionsPerMonth * avgPriceCents;
      }
      predictedMonthlyRevenueCents = Math.round(totalPredicted);

      const totalSessions = allBookings.length;
      const completedSessions = allBookings.filter(b => b.status === "COMPLETED").length;
      const freeSessionsPerformed = allBookings.filter(b => {
        const s = serviceMap.get(b.serviceId);
        return s?.name.toLowerCase().includes("free intro") && b.status === "COMPLETED";
      }).length;
      const totalRevenueCents = allBookings
        .filter(b => b.status !== "CANCELLED" && b.status !== "NO_SHOW")
        .reduce((sum, b) => sum + getBookingRevenue(b.id, b.serviceId), 0);

      const coachEarningsCents = coachRedemptions
        .reduce((sum, r) => sum + r.amountCents, 0);

      const clientIds = new Set(clients.map(c => c.id));
      const clientWalletCharges = allWalletTx
        .filter(tx => tx.type === "DEBIT" && tx.sourceType === "redemption" && clientIds.has(tx.userId))
        .reduce((sum, tx) => sum + tx.amountCents, 0);

      const perClientWallet = new Map<string, number>();
      for (const tx of allWalletTx) {
        if (tx.type === "DEBIT" && tx.sourceType === "redemption" && clientIds.has(tx.userId)) {
          perClientWallet.set(tx.userId, (perClientWallet.get(tx.userId) || 0) + tx.amountCents);
        }
      }

      const venmoTotal = allBookings
        .filter(b => b.paymentMethod === "VENMO" && b.status !== "CANCELLED" && b.status !== "NO_SHOW" && b.clientId !== thisCoachUserId)
        .reduce((sum, b) => sum + getBookingRevenue(b.id, b.serviceId), 0);
      const cashTotal = allBookings
        .filter(b => b.paymentMethod === "CASH" && b.status !== "CANCELLED" && b.status !== "NO_SHOW" && b.clientId !== thisCoachUserId)
        .reduce((sum, b) => sum + getBookingRevenue(b.id, b.serviceId), 0);

      const walletShareCount = new Map<string, number>();
      for (const c of clients) {
        if (c.id.startsWith("walkin_")) {
          const parentId = walkInUserIdMap.get(c.id);
          if (parentId) {
            walletShareCount.set(parentId, (walletShareCount.get(parentId) || 0) + 1);
          }
        }
      }
      for (const c of clients) {
        if (!c.id.startsWith("walkin_") && perClientWallet.has(c.id)) {
          walletShareCount.set(c.id, (walletShareCount.get(c.id) || 0) + 1);
        }
      }

      const perClientWalletBalance = new Map<string, number>();
      for (const tx of allWalletTx) {
        if (clientIds.has(tx.userId)) {
          const current = perClientWalletBalance.get(tx.userId) || 0;
          if (tx.type === "CREDIT") {
            perClientWalletBalance.set(tx.userId, current + tx.amountCents);
          } else if (tx.type === "DEBIT") {
            perClientWalletBalance.set(tx.userId, current - tx.amountCents);
          }
        }
      }

      const clientsWithActual = clients.map(c => {
        const lookupId = c.id.startsWith("walkin_") ? (walkInUserIdMap.get(c.id) || c.id) : c.id;
        const totalWalletCharged = perClientWallet.get(lookupId) || 0;
        const shareCount = walletShareCount.get(lookupId) || 1;
        const walletChargedCents = Math.round(totalWalletCharged / shareCount);
        const venmoCents = c.sessions
          .filter((s: any) => s.paymentMethod === "VENMO" && s.status !== "CANCELLED" && s.status !== "NO_SHOW")
          .reduce((sum: number, s: any) => sum + s.priceCents, 0);
        const cashCents = c.sessions
          .filter((s: any) => s.paymentMethod === "CASH" && s.status !== "CANCELLED" && s.status !== "NO_SHOW")
          .reduce((sum: number, s: any) => sum + s.priceCents, 0);
        const completedCount = c.sessions.filter((s: any) => s.status === "COMPLETED").length;
        const scheduledCount = c.sessions.filter((s: any) => s.status === "CONFIRMED").length;
        const totalSessions = completedCount + scheduledCount;
        const revenueCents = c.sessions
          .filter((s: any) => s.status === "COMPLETED")
          .reduce((sum: number, s: any) => sum + s.priceCents, 0);
        const walletBalanceCents = perClientWalletBalance.get(lookupId) || 0;
        return { ...c, actualRevenue: { walletCents: walletChargedCents, venmoCents, cashCents }, clientStats: { totalSessions, completedCount, scheduledCount, revenueCents, walletBalanceCents } };
      });

      res.json({
        coach: {
          id: coach.id,
          name: `${coach.user?.firstName || ""} ${coach.user?.lastName || ""}`.trim(),
          photoUrl: coach.photoUrl,
          specialties: coach.specialties,
        },
        clients: clientsWithActual,
        stats: {
          totalClients: clients.length,
          totalSessions,
          completedSessions,
          freeSessionsPerformed,
          totalRevenueCents,
          coachEarningsCents,
          predictedMonthlyRevenueCents,
        },
        revenueHistory,
        actualRevenue: {
          walletCents: clientWalletCharges,
          venmoCents: venmoTotal,
          cashCents: cashTotal,
        },
      });
    } catch (error: any) {
      console.error("Business plan error:", error);
      res.status(500).json({ message: "Failed to load business plan" });
    }
  });

  app.delete("/api/coach/business-plan/:coachId/clients/:clientId", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { coachId, clientId } = req.params;
      const count = await storage.deleteBookingsByClientAndCoach(clientId, coachId);
      res.json({ success: true, deletedBookings: count });
    } catch (error) {
      console.error("Error removing client from coach:", error);
      res.status(500).json({ message: "Failed to remove client" });
    }
  });

  app.post("/api/coach/team-quotes", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const role = await getUserRole(userId);
      let createdByCoachId: string;

      const coachProfile = await storage.getCoachProfileByUserId(userId);
      if (coachProfile) {
        createdByCoachId = coachProfile.id;
      } else if (role === "ADMIN") {
        const coaches = await storage.getCoachProfiles();
        if (coaches.length === 0) return res.status(400).json({ message: "No coaches available" });
        createdByCoachId = coaches[0].id;
      } else {
        return res.status(403).json({ message: "Coach profile not found" });
      }

      const { teamName, numberOfAthletes, costPerAthleteCents, trainingType, frequency, durationMonths, coachEmail } = req.body;

      if (teamName == null || numberOfAthletes == null || costPerAthleteCents == null || trainingType == null || frequency == null || durationMonths == null || coachEmail == null ||
          teamName === "" || trainingType === "" || frequency === "" || coachEmail === "") {
        console.log("Team quote missing fields:", JSON.stringify(req.body));
        return res.status(400).json({ message: "All fields are required" });
      }

      if (numberOfAthletes < 1 || costPerAthleteCents < 1) {
        return res.status(400).json({ message: "Athletes and cost must be positive" });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(coachEmail)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      const totalMonths = parseInt(durationMonths);
      if (totalMonths < 1) {
        return res.status(400).json({ message: "Duration must be at least 1 month" });
      }

      const freqMatch = frequency.match(/(\d+)/);
      const sessionsPerWeek = freqMatch ? parseInt(freqMatch[1]) : 1;
      const sessionsPerMonth = Math.round(sessionsPerWeek * 4.33);
      const monthlyCents = numberOfAthletes * costPerAthleteCents * sessionsPerMonth;

      const stripe = await getUncachableStripeClient();

      const customer = await stripe.customers.create({
        email: coachEmail,
        name: teamName,
        metadata: { teamName, trainingType },
      });

      const invoice = await stripe.invoices.create({
        customer: customer.id,
        collection_method: "send_invoice",
        days_until_due: 30,
        metadata: {
          teamName,
          trainingType,
          frequency,
          totalMonths: totalMonths.toString(),
          currentMonth: "1",
          numberOfAthletes: numberOfAthletes.toString(),
        },
      });

      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        amount: monthlyCents,
        currency: "usd",
        description: `Team Training — ${teamName} | Month 1 of ${totalMonths} | ${numberOfAthletes} athletes × $${(costPerAthleteCents / 100).toFixed(2)}/session × ${sessionsPerMonth} sessions/mo | ${trainingType} | ${frequency}`,
      });

      const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
      await stripe.invoices.sendInvoice(invoice.id);

      const invoiceUrl = finalizedInvoice.hosted_invoice_url || "";

      const quote = await storage.createTeamQuote({
        teamName,
        numberOfAthletes,
        costPerAthleteCents,
        trainingType,
        frequency,
        durationWeeks: totalMonths,
        coachEmail,
        totalCents: monthlyCents,
        status: "SENT",
        stripeInvoiceId: invoice.id,
        stripeInvoiceUrl: invoiceUrl,
        createdByCoachId,
        currentMonth: 1,
        totalMonths,
      });

      sendTeamQuoteEmail(
        coachEmail,
        teamName,
        numberOfAthletes,
        costPerAthleteCents,
        trainingType,
        frequency,
        totalMonths,
        monthlyCents,
        invoiceUrl,
        1,
        totalMonths
      ).catch(err => console.error("Failed to send team quote email:", err));

      res.json(quote);
    } catch (error: any) {
      console.error("Error creating team quote:", error);
      res.status(500).json({ message: "Failed to create team quote: " + (error.message || "Unknown error") });
    }
  });

  app.get("/api/coach/team-quotes", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const role = await getUserRole(userId);
      
      if (role === "ADMIN") {
        const quotes = await storage.getAllTeamQuotes();
        return res.json(quotes);
      }

      const coachProfile = await storage.getCoachProfileByUserId(userId);
      if (!coachProfile) return res.status(403).json({ message: "Coach profile not found" });

      const quotes = await storage.getTeamQuotes(coachProfile.id);
      res.json(quotes);
    } catch (error) {
      console.error("Error fetching team quotes:", error);
      res.status(500).json({ message: "Failed to fetch team quotes" });
    }
  });

  app.delete("/api/coach/team-quotes/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const deleted = await storage.deleteTeamQuote(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Quote not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting team quote:", error);
      res.status(500).json({ message: "Failed to delete quote" });
    }
  });

  app.get("/api/coach/team-contracts", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const role = await getUserRole(userId);

      if (role === "ADMIN") {
        const contracts = await storage.getActiveTeamContracts();
        return res.json(contracts);
      }

      const coachProfile = await storage.getCoachProfileByUserId(userId);
      if (!coachProfile) return res.status(403).json({ message: "Coach profile not found" });

      const contracts = await storage.getActiveTeamContracts(coachProfile.id);
      res.json(contracts);
    } catch (error) {
      console.error("Error fetching team contracts:", error);
      res.status(500).json({ message: "Failed to fetch team contracts" });
    }
  });

  app.post("/api/team-training-request", isAuthenticated, async (req: any, res) => {
    try {
      const { teamName, contactName, contactEmail, contactPhone, location, sport, numberOfAthletes, goals, preferredSchedule, additionalNotes } = req.body;

      if (!teamName || !contactName || !contactEmail || !sport || !numberOfAthletes || !goals || !location) {
        return res.status(400).json({ message: "Please fill in all required fields" });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactEmail)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      const athleteCount = parseInt(numberOfAthletes);
      if (!isFinite(athleteCount) || athleteCount < 1) {
        return res.status(400).json({ message: "Number of athletes must be a positive number" });
      }

      await sendTeamTrainingRequestEmail({
        teamName,
        contactName,
        contactEmail,
        contactPhone: contactPhone || "",
        location,
        sport,
        numberOfAthletes: athleteCount,
        goals,
        preferredSchedule: preferredSchedule || "",
        additionalNotes: additionalNotes || "",
      });

      res.json({ success: true, message: "Your team training request has been submitted! We'll be in touch soon." });
    } catch (error: any) {
      console.error("Error sending team training request:", error);
      res.status(500).json({ message: "Failed to submit request. Please try again." });
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

  startWeeklyReminderJob();

  return httpServer;
}
