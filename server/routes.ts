import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated, createAuthToken, deleteAuthToken } from "./replit_integrations/auth";
import { addDays, startOfWeek, format, parseISO, addMinutes, setHours, setMinutes } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import bcrypt from "bcryptjs";
import { sendWelcomeEmail, sendCoachWelcomeEmail, sendBookingConfirmationToClient, sendBookingNotificationToCoach, sendCashoutRequestEmail, sendPaymentConfirmationEmail, sendTeamQuoteEmail, sendTeamTrainingRequestEmail, sendClientInviteEmail, sendSubscriberSessionNotification, type OrgBranding } from "./email";
import crypto from "crypto";
import Stripe from "stripe";
import { z } from "zod";
import { organizationSubscriptionPlans } from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { startWeeklyReminderJob } from "./weekly-reminder";

const OWNER_EMAIL = "bryan.jones@efficiencystrengthtraining.com";

async function getOrgBranding(orgId: string | null | undefined): Promise<OrgBranding | undefined> {
  if (!orgId) return undefined;
  try {
    const org = await storage.getOrganizationById(orgId);
    if (!org) return undefined;
    const owner = org.ownerUserId ? await storage.getUser(org.ownerUserId) : null;
    return {
      name: org.name,
      accentColor: org.primaryColor || undefined,
      emailPrimaryColor: org.emailPrimaryColor || undefined,
      emailSecondaryColor: org.emailSecondaryColor || undefined,
      ownerName: owner ? `${owner.firstName} ${owner.lastName}`.trim() : undefined,
      ownerEmail: org.ownerEmail || undefined,
    };
  } catch {
    return undefined;
  }
}

async function getOrgStripeClient(orgId: string): Promise<{ stripe: Stripe; publishableKey: string; orgName: string }> {
  const org = await storage.getOrganizationById(orgId);
  if (!org?.stripeSecretKey || !org?.stripePublishableKey) {
    throw new Error("This organization has not connected a Stripe account. Please ask your admin to set up Stripe.");
  }
  return {
    stripe: new Stripe(org.stripeSecretKey),
    publishableKey: org.stripePublishableKey,
    orgName: org.name,
  };
}

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
      const { email, password, firstName, lastName, organizationId } = req.body;
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
      await dbRef.insert(userProfiles).values({
        userId: user.id,
        role: "CLIENT" as any,
        organizationId: organizationId || null,
      });

      const token = await createAuthToken(user.id);

      getOrgBranding(organizationId).then(orgB => {
        sendWelcomeEmail(email.toLowerCase().trim(), firstName.trim(), orgB).catch(() => {});
      });

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

  app.post("/api/admin/import-csv", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No data provided" });
      }

      const adminUserId = req.user.claims.sub;
      const adminProfile = await storage.getUserProfile(adminUserId);
      const adminOrgId = adminProfile?.organizationId || null;
      const orgBranding = await getOrgBranding(adminOrgId);

      const { db: dbRef } = await import("./db");
      const { users: usersTable } = await import("@shared/models/auth");
      const { userProfiles: userProfilesTable } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const protocol = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers["x-forwarded-host"] || req.get("host");
      const baseUrl = `${protocol}://${host}`;

      const results: { email: string; status: string; name?: string }[] = [];

      for (const row of rows) {
        const email = (row.email || "").toLowerCase().trim();
        const firstName = (row.firstName || "").trim();
        const lastName = (row.lastName || "").trim();
        const phone = (row.phone || "").trim() || null;
        const notes = (row.notes || "").trim() || null;

        if (!email || !email.includes("@")) {
          results.push({ email: email || "(empty)", status: "skipped_invalid_email" });
          continue;
        }

        if (!firstName) {
          results.push({ email, status: "skipped_missing_name" });
          continue;
        }

        try {
          const existing = await storage.getUserByEmail(email);
          if (existing) {
            const updateData: any = {};
            if (phone && !existing.phone) updateData.phone = phone;
            if (notes && !existing.notes) updateData.notes = notes;
            if (Object.keys(updateData).length > 0) {
              await dbRef.update(usersTable).set(updateData).where(eq(usersTable.id, existing.id));
            }
            results.push({ email, status: "already_exists", name: `${firstName} ${lastName}` });
            continue;
          }

          const token = crypto.randomBytes(32).toString("hex");
          const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

          const [newUser] = await dbRef.insert(usersTable).values({
            email,
            firstName,
            lastName: lastName || null,
            phone,
            notes,
            passwordResetToken: token,
            passwordResetTokenExpires: tokenExpires,
          }).returning();

          await dbRef.insert(userProfilesTable).values({
            userId: newUser.id,
            role: "CLIENT" as any,
            organizationId: adminOrgId,
          });

          const resetLink = `${baseUrl}/create-password?token=${token}`;
          sendClientInviteEmail(email, firstName, resetLink, orgBranding).catch((err: any) => {
            console.error(`Failed to send invite email to ${email}:`, err);
          });

          results.push({ email, status: "created", name: `${firstName} ${lastName}` });
        } catch (err: any) {
          console.error(`Error importing user ${email}:`, err);
          if (err?.code === "23505") {
            results.push({ email, status: "already_exists", name: `${firstName} ${lastName}` });
          } else {
            results.push({ email, status: "error", name: `${firstName} ${lastName}` });
          }
        }
      }

      const created = results.filter(r => r.status === "created").length;
      const skipped = results.filter(r => r.status.startsWith("skipped") || r.status === "already_exists").length;
      const errors = results.filter(r => r.status === "error").length;

      res.json({ success: true, summary: { total: rows.length, created, skipped, errors }, results });
    } catch (error: any) {
      console.error("CSV import error:", error);
      res.status(500).json({ message: "Import failed" });
    }
  });

  app.post("/api/create-password", async (req: any, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ message: "Token and password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const { db: dbRef } = await import("./db");
      const { users: usersTable } = await import("@shared/models/auth");
      const { eq, and, gt } = await import("drizzle-orm");

      const [user] = await dbRef.select().from(usersTable)
        .where(and(
          eq(usersTable.passwordResetToken, token),
          gt(usersTable.passwordResetTokenExpires, new Date())
        ));

      if (!user) {
        return res.status(400).json({ message: "Invalid or expired token. Please contact your coach for a new invite." });
      }

      const hash = await bcrypt.hash(password, 10);
      await dbRef.update(usersTable).set({
        passwordHash: hash,
        passwordResetToken: null,
        passwordResetTokenExpires: null,
        lastSignInAt: new Date(),
      }).where(eq(usersTable.id, user.id));

      const authToken = await createAuthToken(user.id);

      res.json({ success: true, token: authToken });
    } catch (error: any) {
      console.error("Create password error:", error);
      res.status(500).json({ message: "Failed to create password" });
    }
  });

  app.get("/api/organizations/by-id/:id", async (req: any, res) => {
    try {
      const org = await storage.getOrganizationById(req.params.id);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      const { stripeSecretKey, ...safeOrg } = org;
      let ownerName: string | null = null;
      if (org.ownerUserId) {
        const owner = await storage.getUser(org.ownerUserId);
        if (owner) ownerName = `${owner.firstName || ""} ${owner.lastName || ""}`.trim() || null;
      }
      res.json({
        ...safeOrg,
        stripeConnected: !!stripeSecretKey,
        ownerName,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch organization" });
    }
  });

  app.patch("/api/organizations/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (profile?.organizationId !== req.params.id) {
        return res.status(403).json({ message: "You can only update your own organization" });
      }
      const { locations, tagline, tagline2, primaryColor, secondaryColor, logoUrl, slug, name, stripeSecretKey, stripePublishableKey, websiteUrl, instagramUrl, facebookUrl, subscriptionsEnabled, athleticStartHour, athleticEndHour } = req.body;
      const updateData: any = {};
      if (locations !== undefined) updateData.locations = locations;
      if (tagline !== undefined) updateData.tagline = tagline;
      if (tagline2 !== undefined) updateData.tagline2 = tagline2;
      if (primaryColor !== undefined) updateData.primaryColor = primaryColor;
      if (secondaryColor !== undefined) updateData.secondaryColor = secondaryColor;
      if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
      if (name !== undefined) updateData.name = name;
      if (slug !== undefined) {
        const existing = await storage.getOrganizationBySlug(slug);
        if (existing && existing.id !== req.params.id) {
          return res.status(400).json({ message: "That URL extension is already taken" });
        }
        updateData.slug = slug;
      }
      if (websiteUrl !== undefined) updateData.websiteUrl = websiteUrl || null;
      if (instagramUrl !== undefined) updateData.instagramUrl = instagramUrl || null;
      if (facebookUrl !== undefined) updateData.facebookUrl = facebookUrl || null;
      if (stripeSecretKey !== undefined) updateData.stripeSecretKey = stripeSecretKey || null;
      if (stripePublishableKey !== undefined) updateData.stripePublishableKey = stripePublishableKey || null;
      if (subscriptionsEnabled !== undefined) updateData.subscriptionsEnabled = subscriptionsEnabled;
      if (athleticStartHour !== undefined || athleticEndHour !== undefined) {
        const start = athleticStartHour !== undefined ? athleticStartHour : undefined;
        const end = athleticEndHour !== undefined ? athleticEndHour : undefined;
        if (start !== undefined && (typeof start !== "number" || start < 0 || start > 23)) {
          return res.status(400).json({ message: "Start hour must be between 0 and 23" });
        }
        if (end !== undefined && (typeof end !== "number" || end < 1 || end > 24)) {
          return res.status(400).json({ message: "End hour must be between 1 and 24" });
        }
        if (start !== undefined && end !== undefined && start >= end) {
          return res.status(400).json({ message: "Start hour must be before end hour" });
        }
        if (start !== undefined) updateData.athleticStartHour = start;
        if (end !== undefined) updateData.athleticEndHour = end;
      }

      if (stripeSecretKey && (stripeSecretKey.startsWith("sk_") || stripeSecretKey.startsWith("rk_"))) {
        try {
          const testStripe = new Stripe(stripeSecretKey);
          await testStripe.balance.retrieve();
        } catch (stripeErr: any) {
          if (stripeErr.type === "StripeAuthenticationError") {
            return res.status(400).json({ message: "Invalid Stripe key. Please check your key and try again." });
          }
          if (stripeErr.code === "restricted_key_permission_denied") {
            return res.status(400).json({ message: "This restricted key is missing required permissions. Please ensure it has access to Charges, Customers, Checkout Sessions, Invoices, and Payment Intents." });
          }
        }
      }

      const updated = await storage.updateOrganization(req.params.id, updateData);
      if (!updated) return res.status(404).json({ message: "Organization not found" });
      const { stripeSecretKey: sk, ...safeUpdated } = updated;
      res.json({ ...safeUpdated, stripeConnected: !!sk });
    } catch (error) {
      console.error("Error updating organization:", error);
      res.status(500).json({ message: "Failed to update organization" });
    }
  });

  app.get("/api/organizations/:id/stripe-products", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (profile?.organizationId !== req.params.id) {
        return res.status(403).json({ message: "You can only access your own organization" });
      }
      let stripe: Stripe;
      try {
        const orgClient = await getOrgStripeClient(req.params.id);
        stripe = orgClient.stripe;
      } catch {
        stripe = await getUncachableStripeClient();
      }
      const products = await stripe.products.list({ active: true, limit: 100, expand: ['data.default_price'] });
      const subscriptionProducts: any[] = [];
      for (const product of products.data) {
        const prices = await stripe.prices.list({ product: product.id, active: true, type: 'recurring', limit: 100 });
        if (prices.data.length > 0) {
          for (const price of prices.data) {
            subscriptionProducts.push({
              productId: product.id,
              productName: product.name,
              productDescription: product.description || "",
              priceId: price.id,
              amountCents: price.unit_amount || 0,
              currency: price.currency,
              interval: price.recurring?.interval || "month",
              intervalCount: price.recurring?.interval_count || 1,
            });
          }
        }
      }
      res.json(subscriptionProducts);
    } catch (error: any) {
      console.error("Error fetching Stripe products:", error);
      if (error.message?.includes("not connected")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to fetch Stripe subscription products" });
    }
  });

  app.get("/api/organizations/:id/subscription-plans", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (profile?.organizationId !== req.params.id) {
        return res.status(403).json({ message: "You can only access your own organization" });
      }
      const plans = await storage.getOrganizationSubscriptionPlans(req.params.id);
      res.json(plans);
    } catch (error) {
      console.error("Error fetching subscription plans:", error);
      res.status(500).json({ message: "Failed to fetch subscription plans" });
    }
  });

  app.post("/api/organizations/:id/subscription-plans", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (profile?.organizationId !== req.params.id) {
        return res.status(403).json({ message: "You can only manage your own organization" });
      }
      const { plans } = req.body;
      if (!Array.isArray(plans)) {
        return res.status(400).json({ message: "Plans must be an array" });
      }
      const planSchema = z.object({
        stripeProductId: z.string().min(1),
        stripePriceId: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional().default(""),
        amountCents: z.number().int().min(0),
        interval: z.string().min(1),
        intervalCount: z.number().int().min(1).optional().default(1),
        cancellationPolicy: z.string().optional().default("end_of_period"),
        coachPayPerSessionCents: z.number().int().min(0).optional(),
        sessionType: z.enum(["personal", "group"]).optional().default("personal"),
      });
      const validatedPlans = [];
      for (const plan of plans) {
        const parsed = planSchema.safeParse(plan);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid plan data", errors: parsed.error.errors });
        }
        validatedPlans.push(parsed.data);
      }
      await storage.deleteOrganizationSubscriptionPlansByOrg(req.params.id);
      const created: any[] = [];
      for (const plan of validatedPlans) {
        const newPlan = await storage.createOrganizationSubscriptionPlan({
          organizationId: req.params.id,
          stripeProductId: plan.stripeProductId,
          stripePriceId: plan.stripePriceId,
          name: plan.name,
          description: plan.description,
          amountCents: plan.amountCents,
          interval: plan.interval,
          intervalCount: plan.intervalCount,
          cancellationPolicy: plan.cancellationPolicy,
          coachPayPerSessionCents: plan.coachPayPerSessionCents ?? null,
          sessionType: plan.sessionType,
          active: true,
        });
        created.push(newPlan);
      }
      res.json(created);
    } catch (error) {
      console.error("Error saving subscription plans:", error);
      res.status(500).json({ message: "Failed to save subscription plans" });
    }
  });

  app.patch("/api/organizations/:id/subscription-plans/:planId", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (profile?.organizationId !== req.params.id) {
        return res.status(403).json({ message: "You can only manage your own organization" });
      }
      const { cancellationPolicy, coachPayPerSessionCents, sessionType, sessionsPerWeek } = req.body;
      const updateData: any = {};
      if (cancellationPolicy) {
        if (!["end_of_period", "immediate"].includes(cancellationPolicy)) {
          return res.status(400).json({ message: "cancellationPolicy must be 'end_of_period' or 'immediate'" });
        }
        updateData.cancellationPolicy = cancellationPolicy;
      }
      if (coachPayPerSessionCents !== undefined) {
        updateData.coachPayPerSessionCents = coachPayPerSessionCents === null ? null : Math.max(0, Math.round(coachPayPerSessionCents));
      }
      if (sessionType !== undefined) {
        if (!["personal", "group"].includes(sessionType)) {
          return res.status(400).json({ message: "sessionType must be 'personal' or 'group'" });
        }
        updateData.sessionType = sessionType;
      }
      if (sessionsPerWeek !== undefined) {
        const spw = parseInt(sessionsPerWeek);
        if (isNaN(spw) || spw < 1 || spw > 7) {
          return res.status(400).json({ message: "sessionsPerWeek must be between 1 and 7" });
        }
        updateData.sessionsPerWeek = spw;
      }
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      const [updated] = await db.update(organizationSubscriptionPlans)
        .set(updateData)
        .where(and(
          eq(organizationSubscriptionPlans.id, req.params.planId),
          eq(organizationSubscriptionPlans.organizationId, req.params.id)
        ))
        .returning();
      if (!updated) return res.status(404).json({ message: "Plan not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating subscription plan:", error);
      res.status(500).json({ message: "Failed to update subscription plan" });
    }
  });

  app.delete("/api/organizations/:id/subscription-plans/:planId", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (profile?.organizationId !== req.params.id) {
        return res.status(403).json({ message: "You can only manage your own organization" });
      }
      const deleted = await storage.deleteOrganizationSubscriptionPlan(req.params.planId);
      if (!deleted) return res.status(404).json({ message: "Plan not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting subscription plan:", error);
      res.status(500).json({ message: "Failed to delete subscription plan" });
    }
  });

  app.get("/api/organizations", async (_req: any, res) => {
    try {
      const orgs = await storage.getAllOrganizations();
      const safeOrgs = orgs.map(({ stripeSecretKey, stripePublishableKey, ...rest }) => rest);
      res.json(safeOrgs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch organizations" });
    }
  });

  app.get("/api/organizations/:slug", async (req: any, res) => {
    try {
      const org = await storage.getOrganizationBySlug(req.params.slug);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      const { stripeSecretKey, ...safeOrg } = org;
      res.json(safeOrg);
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

      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 3);

      const [org] = await dbRef.insert(organizations).values({
        name: businessName.trim(),
        slug: slugClean,
        ownerUserId: user.id,
        ownerEmail: email.toLowerCase().trim(),
        subscriptionStatus: "trialing" as any,
        trialEndsAt: trialEnd,
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

      const orgBranding: OrgBranding = { name: org.name, ownerName: firstName.trim(), ownerEmail: email.toLowerCase().trim() };
      sendCoachWelcomeEmail(email.toLowerCase().trim(), firstName.trim(), undefined, orgBranding).catch(() => {});

      res.json({ success: true, organization: org, token, redirect: "/coach" });
    } catch (error) {
      console.error("Organization register error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.delete("/api/organizations/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (profile?.organizationId !== req.params.id) {
        return res.status(403).json({ message: "You can only delete your own organization" });
      }

      const org = await storage.getOrganizationById(req.params.id);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      if (org.stripeSubscriptionId && !org.stripeSubscriptionId.startsWith("promo_")) {
        try {
          const stripe = await getUncachableStripeClient();
          await stripe.subscriptions.cancel(org.stripeSubscriptionId);
        } catch (stripeErr: any) {
          console.error("Failed to cancel Stripe subscription during org delete:", stripeErr.message);
        }
      }

      await storage.deleteOrganization(req.params.id);
      await deleteAuthToken(userId);

      res.json({ success: true, message: "Organization deleted successfully" });
    } catch (error: any) {
      console.error("Delete organization error:", error);
      res.status(500).json({ message: "Failed to delete organization" });
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
      const user = await storage.getUser(userId);
      if (profile.role !== "ADMIN") {
        if (user && user.email === OWNER_EMAIL) {
          profile = await storage.upsertUserProfile({ userId, role: "ADMIN" as any });
          console.log(`Owner ${userId} (${user.email}) promoted to ADMIN`);
        }
      }

      if (!profile.organizationId) {
        let orgId: string | null = null;
        const coachProfile = await storage.getCoachProfileByUserId(userId);
        if (coachProfile?.organizationId) {
          orgId = coachProfile.organizationId;
        } else if (user?.email === OWNER_EMAIL) {
          orgId = "org-est";
        }
        if (orgId) {
          profile = await storage.upsertUserProfile({ userId, organizationId: orgId });
          console.log(`User ${userId} assigned to organization ${orgId}`);
        }
      }

      res.json(profile);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.get("/api/coaches", async (req: any, res) => {
    try {
      const orgId = req.query.organizationId as string | undefined;
      let coaches;
      if (orgId) {
        coaches = await storage.getCoachProfilesByOrganization(orgId);
      } else {
        coaches = await storage.getCoachProfiles();
      }
      const safe = coaches.map(({ passwordHash, email, ...rest }: any) => rest);
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

  app.get("/api/services", async (req: any, res) => {
    try {
      const orgId = req.query.organizationId as string | undefined;
      if (orgId) {
        const srvs = await storage.getServicesByOrganization(orgId);
        res.json(srvs);
      } else {
        const srvs = await storage.getServices();
        res.json(srvs);
      }
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

      const isSemiPrivate = service.sessionType === "GROUP";

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
        const maxP = booking.maxParticipants || 6;
        if (filledNames.length > maxP) {
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
        }
      }

      (async () => {
        try {
          const clientUser = await storage.getUser(userId);
          const coachProfile = await storage.getCoachProfile(coachId);
          const tz = coachProfile?.timezone || coach?.timezone || "America/New_York";
          const orgB = await getOrgBranding(coachProfile?.organizationId);
          if (clientUser?.email) {
            sendBookingConfirmationToClient(
              clientUser.email,
              clientUser.firstName || "there",
              coachProfile?.user ? `${coachProfile.user.firstName} ${coachProfile.user.lastName}` : "your coach",
              service.name,
              start,
              end,
              req.body.location || undefined,
              tz,
              orgB
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
              tz,
              orgB
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

      const { bio, specialties, photoUrl, timezone, location } = req.body;
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
      if (location !== undefined) updateData.location = location;

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
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const results = await storage.searchUsers(q);
      let filtered = results;
      if (orgId) {
        const orgUserIds = await storage.getUserIdsByOrganization(orgId);
        const orgSet = new Set(orgUserIds);
        filtered = results.filter(u => orgSet.has(u.id));
      }
      res.json(filtered.map(({ id, firstName, lastName, email }) => ({ id, firstName, lastName, email })));
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

      const { clientId, clientFirstName, clientLastName, serviceId: providedServiceId, startAt, notes, maxParticipants, groupDescription, ageRange, skillLevel, sport, subscriptionPlanId } = req.body;

      if (!startAt) {
        return res.status(400).json({ message: "startAt is required" });
      }
      if (!providedServiceId && !subscriptionPlanId) {
        return res.status(400).json({ message: "serviceId or subscriptionPlanId is required" });
      }

      const coachProfile = await storage.getUserProfile(userId);
      const coachOrgId = coachProfile?.organizationId || null;

      let serviceId = providedServiceId;
      if (!serviceId && subscriptionPlanId && coachOrgId) {
        const plans = await storage.getOrganizationSubscriptionPlans(coachOrgId);
        const plan = plans.find(p => p.id === subscriptionPlanId);
        const orgServices = await storage.getServicesByOrganization(coachOrgId);
        const activeServices = orgServices.filter(s => s.active);
        const isGroupPlan = plan?.sessionType === "group";
        const matchingService = activeServices.find(s => {
          if (isGroupPlan) {
            return s.sessionType === "GROUP" || s.name.toLowerCase().includes("semi-private") || s.name.toLowerCase().includes("group");
          }
          return s.sessionType === "1_ON_1" && !s.name.toLowerCase().includes("semi-private") && !s.name.toLowerCase().includes("group") && !s.name.toLowerCase().includes("team training");
        });
        serviceId = matchingService?.id || activeServices[0]?.id;
      }

      if (!serviceId) {
        return res.status(400).json({ message: "No matching service found" });
      }

      const service = await storage.getService(serviceId);
      if (!service) return res.status(404).json({ message: "Service not found" });

      const isSemiPrivate = service.sessionType === "GROUP" || !!maxParticipants;

      if (!isSemiPrivate && !clientId && (!clientFirstName || !clientLastName)) {
        return res.status(400).json({ message: "Provide clientId or clientFirstName and clientLastName" });
      }

      let resolvedClientId = clientId;
      if (!resolvedClientId && !isSemiPrivate) {
        const user = await storage.findOrCreateUserByName(clientFirstName, clientLastName, coachOrgId);
        resolvedClientId = user.id;
      } else if (!resolvedClientId && isSemiPrivate) {
        if (clientFirstName && clientLastName) {
          const user = await storage.findOrCreateUserByName(clientFirstName, clientLastName, coachOrgId);
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
        sport: isSemiPrivate ? (sport || "") : "",
        teamQuoteProgramId: req.body.teamQuoteProgramId || null,
        subscriptionPlanId: subscriptionPlanId || null,
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
        }
      }

      (async () => {
        try {
          const clientUser = await storage.getUser(resolvedClientId);
          const coachProfile = await storage.getCoachProfile(coachId);
          const tz = coachProfile?.timezone || "America/New_York";
          const orgB = await getOrgBranding(coachProfile?.organizationId);
          const coachDisplayName = coachProfile?.user ? `${coachProfile.user.firstName} ${coachProfile.user.lastName}` : "your coach";

          if (clientUser?.email) {
            const hasAccount = !!clientUser.passwordHash;

            if (subscriptionPlanId && !hasAccount) {
              const org = coachOrgId ? await storage.getOrganization(coachOrgId) : null;
              const signUpUrl = org?.websiteUrl || "https://trainefficiency.com";
              sendSubscriberSessionNotification(
                clientUser.email,
                clientUser.firstName || "there",
                coachDisplayName,
                service.name,
                start,
                end,
                req.body.location || undefined,
                signUpUrl,
                tz,
                orgB
              ).catch(() => {});
            } else {
              sendBookingConfirmationToClient(
                clientUser.email,
                clientUser.firstName || "there",
                coachDisplayName,
                service.name,
                start,
                end,
                req.body.location || undefined,
                tz,
                orgB
              ).catch(() => {});
            }
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
              tz,
              orgB
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
              maxParticipants: (service.sessionType === "GROUP" || sourceBooking.maxParticipants) ? (sourceBooking.maxParticipants || 6) : null,
              groupDescription: sourceBooking.groupDescription || "",
              ageRange: sourceBooking.ageRange || "",
              skillLevel: sourceBooking.skillLevel || "",
              sport: sourceBooking.sport || "",
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

      const { serviceId, startAt, notes, groupDescription, clientId, clientFirstName, clientLastName, paymentMethod, ageRange, skillLevel, sport, maxParticipants } = req.body;

      const updateData: any = {};
      if (notes !== undefined) updateData.notes = notes;
      if (req.body.location !== undefined) updateData.location = req.body.location;
      if (groupDescription !== undefined) updateData.groupDescription = groupDescription;
      if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
      if (ageRange !== undefined) updateData.ageRange = ageRange;
      if (skillLevel !== undefined) updateData.skillLevel = skillLevel;
      if (sport !== undefined) updateData.sport = sport;
      if (maxParticipants !== undefined) updateData.maxParticipants = maxParticipants;

      if (serviceId && serviceId !== existing.serviceId) {
        const service = await storage.getService(serviceId);
        if (!service) return res.status(404).json({ message: "Service not found" });
        updateData.serviceId = serviceId;

        const isSemiPrivate = service.sessionType === "GROUP";
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

      const editCoachProfile = await storage.getUserProfile(userId);
      const editCoachOrgId = editCoachProfile?.organizationId || null;

      if (clientId) {
        updateData.clientId = clientId;
      } else if (clientFirstName && clientLastName) {
        const user = await storage.findOrCreateUserByName(clientFirstName.trim(), clientLastName.trim(), editCoachOrgId);
        updateData.clientId = user.id;
      }

      const finalServiceId = updateData.serviceId || existing.serviceId;
      const finalService = await storage.getService(finalServiceId);
      const finalIsSemiPrivate = finalService?.sessionType === "GROUP" || false;
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
      } else if (booking.subscriptionPlanId) {
        const plans = booking.coachId ? await (async () => {
          const coachProfile = await storage.getCoachProfile(booking.coachId);
          if (coachProfile?.organizationId) {
            return storage.getOrganizationSubscriptionPlans(coachProfile.organizationId);
          }
          return [];
        })() : [];
        const subPlan = plans.find(p => p.id === booking.subscriptionPlanId);
        if (subPlan?.coachPayPerSessionCents !== null && subPlan?.coachPayPerSessionCents !== undefined) {
          amountCents = subPlan.coachPayPerSessionCents;
        } else {
          const payoutRate = await getCoachPayoutRate(booking.coachId);
          amountCents = Math.round((perPersonCents || 0) * payoutRate);
        }
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

      if (booking.subscriptionPlanId) {
        try {
          const clientSubs = await storage.getUserSubscriptions(booking.clientId);
          const activeSub = clientSubs.find(s => s.planId === booking.subscriptionPlanId && (s.status === "active" || s.status === "past_due"));
          if (activeSub && activeSub.sessionsRemaining !== null && activeSub.sessionsRemaining !== undefined) {
            await storage.updateUserSubscription(activeSub.id, {
              sessionsRemaining: Math.max(0, activeSub.sessionsRemaining - 1),
            });
          }
        } catch (e) {
          console.error("Error decrementing session count on redemption:", e);
        }
      }

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
      const orgB = await getOrgBranding(coachProfile.organizationId);
      const ownerEmail = orgB?.ownerEmail || "bryan.jones@efficiencystrengthtraining.com";
      sendCashoutRequestEmail(ownerEmail, coachName, pendingAmount, cashout.id, orgB).catch(console.error);

      res.json(cashout);
    } catch (error) {
      console.error("Error creating cashout:", error);
      res.status(500).json({ message: "Failed to create cashout request" });
    }
  });

  app.get("/api/coach/payout-redemptions", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const allRedemptions = await storage.getAllRedemptions();
      const coaches = await storage.getCoachProfiles();

      let orgCoachIdSet: Set<string> | null = null;
      if (orgId) {
        const orgCoaches = await storage.getCoachProfilesByOrganization(orgId);
        orgCoachIdSet = new Set(orgCoaches.map(c => c.id));
      }

      const result = allRedemptions
        .filter((r: any) => !orgCoachIdSet || orgCoachIdSet.has(r.coachId))
        .map((r: any) => {
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

  app.get("/api/sessions/open", async (req: any, res) => {
    try {
      let orgId: string | undefined;
      try {
        let userId: string | undefined;
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          const { db: dbRef } = await import("./db");
          const { sql: sqlRef } = await import("drizzle-orm");
          const tokenResult = await dbRef.execute(sqlRef`SELECT user_id FROM auth_tokens WHERE token = ${token} AND expires_at > NOW()`);
          if (tokenResult.rows.length > 0) {
            userId = (tokenResult.rows[0] as any).user_id;
          }
        } else if (req.isAuthenticated?.() && req.user?.claims?.sub) {
          userId = req.user.claims.sub;
        }
        if (userId) {
          const profile = await storage.getUserProfile(userId);
          orgId = profile?.organizationId || undefined;
        }
      } catch {}
      const sessions = await storage.getOpenSemiPrivateSessions(orgId);
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
          const grpOrgB = await getOrgBranding(coachProfile.organizationId);
          if (coachProfile.user?.email) {
            sendGroupSessionJoinNotification(
              coachProfile.user.email,
              coachProfile.user.firstName || "Coach",
              participantName || "A user",
              sessionName,
              booking.startAt,
              booking.endAt,
              booking.location || undefined,
              tz,
              grpOrgB
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
              tz,
              grpOrgB
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

  app.get("/api/coach/users", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const allUsers = await storage.getAllUsersWithProfiles();
      if (orgId) {
        const orgUserIds = await storage.getUserIdsByOrganization(orgId);
        const orgSet = new Set(orgUserIds);
        res.json(allUsers.filter(u => orgSet.has(u.id)));
      } else {
        res.json(allUsers);
      }
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
        const coachUserId = req.user.claims.sub;
        const coachProf = await storage.getCoachProfile(coachUserId);
        const orgB = await getOrgBranding(coachProf?.organizationId);
        sendPaymentConfirmationEmail(user.email, user.firstName || "Client", amountCents, description, newBalance, orgB).catch(() => {});
      }

      res.json(tx);
    } catch (error) {
      console.error("Error recording manual payment:", error);
      res.status(500).json({ message: "Failed to record payment" });
    }
  });

  app.get("/api/coach/transactions", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const transactions = await storage.getAllWalletTransactions();
      if (orgId) {
        const orgUserIds = await storage.getUserIdsByOrganization(orgId);
        const orgSet = new Set(orgUserIds);
        res.json(transactions.filter(tx => orgSet.has(tx.userId)));
      } else {
        res.json(transactions);
      }
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  app.get("/api/coach/stripe-subscription-transactions", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) {
        return res.status(400).json({ message: "No organization found" });
      }
      const org = await storage.getOrganizationById(orgId);
      if (!org?.subscriptionsEnabled) {
        return res.json([]);
      }
      let stripe: Stripe;
      try {
        const orgStripe = await getOrgStripeClient(orgId);
        stripe = orgStripe.stripe;
      } catch {
        stripe = await getUncachableStripeClient();
      }
      const invoices = await stripe.invoices.list({
        limit: 100,
        status: 'paid',
        expand: ['data.subscription', 'data.customer'],
      });
      const subscriptionInvoices = invoices.data
        .filter(inv => inv.subscription)
        .map(inv => {
          const customer = inv.customer as Stripe.Customer | null;
          const customerName = customer && typeof customer !== 'string' ? (customer.name || customer.email || 'Unknown') : 'Unknown';
          const customerEmail = customer && typeof customer !== 'string' ? (customer.email || '') : '';
          return {
            id: inv.id,
            amountCents: inv.amount_paid || 0,
            currency: inv.currency,
            status: inv.status,
            customerName,
            customerEmail,
            description: inv.lines?.data?.[0]?.description || 'Subscription Payment',
            periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
            periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
            createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : null,
            invoiceUrl: inv.hosted_invoice_url || null,
            subscriptionId: typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id || null,
          };
        });
      res.json(subscriptionInvoices);
    } catch (error: any) {
      console.error("Error fetching Stripe subscription transactions:", error);
      res.status(500).json({ message: "Failed to fetch subscription transactions" });
    }
  });

  app.get("/api/coach/user-balances", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      if (orgId) {
        const balances = await storage.getUserBalancesByOrganization(orgId);
        res.json(balances);
      } else {
        const balances = await storage.getAllUserBalances();
        res.json(balances);
      }
    } catch (error) {
      console.error("Error fetching user balances:", error);
      res.status(500).json({ message: "Failed to fetch user balances" });
    }
  });

  app.get("/api/admin/users", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const allUsers = await storage.getAllUsersWithProfiles();
      if (orgId) {
        const orgUserIds = await storage.getUserIdsByOrganization(orgId);
        const orgSet = new Set(orgUserIds);
        res.json(allUsers.filter(u => orgSet.has(u.id)));
      } else {
        res.json(allUsers);
      }
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

      const adminUserId = req.user.claims.sub;
      const adminProfile = await storage.getUserProfile(adminUserId);
      const adminOrgId = adminProfile?.organizationId || null;

      await storage.upsertUserProfile({ userId, role: "COACH", organizationId: adminOrgId });

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
        organizationId: adminOrgId,
      });

      getOrgBranding(adminOrgId).then(orgB => {
        sendCoachWelcomeEmail(normalizedEmail, firstName.trim(), password, orgB).catch((err: any) => {
          console.error("Failed to send coach welcome email:", err);
        });
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
      const { name, description, durationMin, priceCents, sessionType } = req.body;
      if (!name) return res.status(400).json({ message: "name required" });
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const service = await storage.createService({
        name,
        description: description || "",
        durationMin: durationMin || 60,
        priceCents: priceCents || 0,
        active: true,
        sessionType: sessionType || "1_ON_1",
        organizationId: orgId,
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
      const { name, description, durationMin, priceCents, active, sessionType } = req.body;
      const existing = await storage.getService(id);
      if (!existing) return res.status(404).json({ message: "Service not found" });

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (durationMin !== undefined) updateData.durationMin = durationMin;
      if (active !== undefined) updateData.active = active;
      if (sessionType !== undefined) updateData.sessionType = sessionType;

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

  app.get("/api/admin/bookings", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const bookingsList = await storage.getAllBookings();
      if (orgId) {
        const orgCoaches = await storage.getCoachProfilesByOrganization(orgId);
        const coachIdSet = new Set(orgCoaches.map(c => c.id));
        res.json(bookingsList.filter((b: any) => coachIdSet.has(b.coachId)));
      } else {
        res.json(bookingsList);
      }
    } catch (error) {
      console.error("Error fetching all bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  app.get("/api/admin/redemptions", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const redemptionsList = await storage.getAllRedemptions();
      const coaches = await storage.getCoachProfiles();
      const allBookings = await storage.getAllBookings();
      const servicesList = await storage.getServices();

      let orgCoachIdSet: Set<string> | null = null;
      if (orgId) {
        const orgCoaches = await storage.getCoachProfilesByOrganization(orgId);
        orgCoachIdSet = new Set(orgCoaches.map(c => c.id));
      }

      const enriched = redemptionsList
        .filter((r: any) => !orgCoachIdSet || orgCoachIdSet.has(r.coachId))
        .map((r: any) => {
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

  app.get("/api/admin/cashouts", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const cashoutsList = await storage.getAllCashouts();
      const coaches = orgId
        ? await storage.getCoachProfilesByOrganization(orgId)
        : await storage.getCoachProfiles();
      const coachIdSet = new Set(coaches.map((c: any) => c.id));
      const enriched = cashoutsList
        .filter((c: any) => !orgId || coachIdSet.has(c.coachId))
        .map((c: any) => {
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

  app.get("/api/athletic/config", async (_req: any, res) => {
    try {
      const org = await storage.getOrganizationById("org-est");
      const startHour = org?.athleticStartHour ?? 16;
      const endHour = org?.athleticEndHour ?? 20;
      res.json({ startHour, endHour });
    } catch (error) {
      console.error("Error fetching athletic config:", error);
      res.status(500).json({ message: "Failed to fetch athletic config" });
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

      const org = await storage.getOrganizationById("org-est");
      const startHour = org?.athleticStartHour ?? 16;
      const endHour = org?.athleticEndHour ?? 20;
      const validSlots: string[] = [];
      for (let h = startHour; h < endHour; h++) {
        validSlots.push(`${h.toString().padStart(2, "0")}:00`);
      }
      if (!validSlots.includes(timeSlot)) {
        return res.status(400).json({ message: `Invalid time slot. Must be within the configured hours.` });
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

  app.get("/api/wallet/subscription-plans", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.json([]);
      const org = await storage.getOrganizationById(orgId);
      if (!org?.subscriptionsEnabled) return res.json([]);
      const plans = await storage.getOrganizationSubscriptionPlans(orgId);
      res.json(plans.filter(p => p.active));
    } catch (error) {
      console.error("Error fetching wallet subscription plans:", error);
      res.status(500).json({ message: "Failed to fetch subscription plans" });
    }
  });

  app.post("/api/wallet/subscribe", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { planId } = req.body;
      if (!planId) return res.status(400).json({ message: "planId is required" });

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization found" });

      const org = await storage.getOrganizationById(orgId);
      if (!org?.subscriptionsEnabled) return res.status(400).json({ message: "Subscriptions are not enabled" });

      const plans = await storage.getOrganizationSubscriptionPlans(orgId);
      const plan = plans.find(p => p.id === planId && p.active);
      if (!plan) return res.status(404).json({ message: "Subscription plan not found" });

      const existingSub = await storage.getUserSubscriptionByPlan(userId, planId);
      if (existingSub) return res.status(400).json({ message: "You are already subscribed to this plan" });

      let stripe: Stripe;
      try {
        const orgStripe = await getOrgStripeClient(orgId);
        stripe = orgStripe.stripe;
      } catch {
        stripe = await getUncachableStripeClient();
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: user.email || undefined,
        line_items: [{
          price: plan.stripePriceId,
          quantity: 1,
        }],
        mode: "subscription",
        success_url: `${baseUrl}/wallet?subscription_success=true&sub_session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/wallet?canceled=true`,
        metadata: {
          userId,
          planId: plan.id,
          organizationId: orgId,
          type: "client_subscription",
        },
      });

      await storage.createUserSubscription({
        organizationId: orgId,
        userId,
        planId,
        stripeCheckoutSessionId: session.id,
        status: "pending",
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Error creating subscription checkout:", error);
      res.status(500).json({ message: "Failed to create subscription checkout" });
    }
  });

  app.get("/api/wallet/my-subscriptions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.json([]);

      const subs = await storage.getUserSubscriptions(userId);
      const plans = await storage.getOrganizationSubscriptionPlans(orgId);
      const planMap = new Map(plans.map(p => [p.id, p]));

      let stripe: Stripe | null = null;
      try {
        const orgStripe = await getOrgStripeClient(orgId);
        stripe = orgStripe.stripe;
      } catch {
        try { stripe = await getUncachableStripeClient(); } catch {}
      }

      const enriched = [];
      for (const sub of subs) {
        const plan = planMap.get(sub.planId);
        if (!plan) continue;

        if (stripe && sub.stripeSubscriptionId && sub.status !== "pending") {
          try {
            const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
            if (stripeSub.status !== sub.status || stripeSub.cancel_at_period_end !== sub.cancelAtPeriodEnd) {
              await storage.updateUserSubscription(sub.id, {
                status: stripeSub.status,
                cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
                currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
              });
              sub.status = stripeSub.status;
              sub.cancelAtPeriodEnd = stripeSub.cancel_at_period_end;
              sub.currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
            }
          } catch {}
        }

        enriched.push({
          ...sub,
          plan: {
            name: plan.name,
            description: plan.description,
            amountCents: plan.amountCents,
            interval: plan.interval,
            intervalCount: plan.intervalCount,
            cancellationPolicy: plan.cancellationPolicy,
            sessionsPerWeek: plan.sessionsPerWeek,
          },
        });
      }

      res.json(enriched.filter(s => s.status !== "pending"));
    } catch (error) {
      console.error("Error fetching user subscriptions:", error);
      res.status(500).json({ message: "Failed to fetch subscriptions" });
    }
  });

  app.post("/api/wallet/verify-subscription", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ message: "sessionId is required" });

      const existing = await storage.getUserSubscriptionByCheckoutSession(sessionId);
      if (!existing) return res.status(404).json({ message: "Subscription not found" });
      if (existing.userId !== userId) return res.status(403).json({ message: "Forbidden" });
      if (existing.status !== "pending") return res.json({ subscription: existing });

      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      let stripe: Stripe;
      try {
        const orgStripe = await getOrgStripeClient(orgId);
        stripe = orgStripe.stripe;
      } catch {
        stripe = await getUncachableStripeClient();
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== "paid" && session.status !== "complete") {
        return res.json({ subscription: existing });
      }

      const stripeSubscriptionId = session.subscription as string;
      let currentPeriodEnd: Date | null = null;
      let status = "active";

      if (stripeSubscriptionId) {
        try {
          const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
          currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
          status = stripeSub.status;
        } catch {}
      }

      const updated = await storage.updateUserSubscription(existing.id, {
        stripeSubscriptionId,
        status,
        currentPeriodEnd,
      });

      res.json({ subscription: updated });
    } catch (error) {
      console.error("Error verifying subscription:", error);
      res.status(500).json({ message: "Failed to verify subscription" });
    }
  });

  app.post("/api/wallet/subscriptions/:id/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sub = await storage.getUserSubscriptions(userId);
      const subscription = sub.find(s => s.id === req.params.id);
      if (!subscription) return res.status(404).json({ message: "Subscription not found" });
      if (subscription.userId !== userId) return res.status(403).json({ message: "Forbidden" });

      if (!subscription.stripeSubscriptionId) {
        await storage.updateUserSubscription(subscription.id, { status: "canceled" });
        return res.json({ message: "Subscription canceled" });
      }

      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization" });

      let stripe: Stripe;
      try {
        const orgStripe = await getOrgStripeClient(orgId);
        stripe = orgStripe.stripe;
      } catch {
        stripe = await getUncachableStripeClient();
      }

      const plans = await storage.getOrganizationSubscriptionPlans(orgId);
      const plan = plans.find(p => p.id === subscription.planId);
      const policy = plan?.cancellationPolicy || "end_of_period";

      if (policy === "immediate") {
        await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
        await storage.updateUserSubscription(subscription.id, { status: "canceled" });
      } else {
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
        await storage.updateUserSubscription(subscription.id, { cancelAtPeriodEnd: true });
      }

      res.json({ message: "Subscription canceled", policy });
    } catch (error) {
      console.error("Error canceling subscription:", error);
      res.status(500).json({ message: "Failed to cancel subscription" });
    }
  });

  app.get("/api/coach/client-subscriptions", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const subs = await storage.getOrganizationUserSubscriptions(profile.organizationId);
      const plans = await storage.getOrganizationSubscriptionPlans(profile.organizationId);
      const planMap = new Map(plans.map(p => [p.id, p]));

      const userIds = [...new Set(subs.map(s => s.userId))];
      const usersData: { [key: string]: any } = {};
      for (const uid of userIds) {
        const user = await storage.getUser(uid);
        if (user) usersData[uid] = { firstName: user.firstName, lastName: user.lastName, email: user.email };
      }

      const enriched = subs
        .filter(s => s.status !== "pending")
        .map(s => {
          const plan = planMap.get(s.planId);
          return {
            ...s,
            plan: plan ? { name: plan.name, amountCents: plan.amountCents, interval: plan.interval, sessionsPerWeek: plan.sessionsPerWeek } : null,
            user: usersData[s.userId] || null,
          };
        });

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching client subscriptions:", error);
      res.status(500).json({ message: "Failed to fetch client subscriptions" });
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

      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;

      let stripe: Stripe;
      let orgName = "your account";
      if (orgId) {
        try {
          const orgStripe = await getOrgStripeClient(orgId);
          stripe = orgStripe.stripe;
          orgName = orgStripe.orgName;
        } catch {
          stripe = await getUncachableStripeClient();
          const org = await storage.getOrganizationById(orgId);
          if (org) orgName = org.name;
        }
      } else {
        stripe = await getUncachableStripeClient();
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        payment_method_types: ["card"],
        customer_email: user.email || undefined,
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: `Add Funds — ${orgName}`,
              description: `Add $${(amountCents / 100).toFixed(2)} to your ${orgName} account balance`,
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
          organizationId: orgId || "",
        },
      };

      if (!orgId) {
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
        sessionParams.customer = customerId;
        delete sessionParams.customer_email;
      }

      const session = await stripe.checkout.sessions.create(sessionParams);
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

      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;

      let stripe: Stripe;
      if (orgId) {
        try {
          const orgStripe = await getOrgStripeClient(orgId);
          stripe = orgStripe.stripe;
        } catch {
          stripe = await getUncachableStripeClient();
        }
      } else {
        stripe = await getUncachableStripeClient();
      }

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
        const userProf = await storage.getUserProfile(userId);
        const orgB = await getOrgBranding(userProf?.organizationId);
        sendPaymentConfirmationEmail(stripeUser.email, stripeUser.firstName || "Client", amountCents, `Wallet deposit — $${(amountCents / 100).toFixed(2)} via Stripe`, newBal, orgB).catch(() => {});
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

      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const daysInMonth = monthEnd.getDate();
      const dayOfMonth = now.getDate();
      const monthProgress = Math.max(dayOfMonth / daysInMonth, 0.01);

      let currentMonthRevenue = 0;
      for (const client of Array.from(clientMap.values())) {
        const thisMonthSessions = client.sessions.filter(
          (s: { date: string; status: string }) => {
            const d = new Date(s.date);
            return d >= monthStart && d <= now && s.status === "COMPLETED";
          }
        );
        currentMonthRevenue += thisMonthSessions.reduce((sum: number, s: { priceCents: number }) => sum + s.priceCents, 0);
      }
      predictedMonthlyRevenueCents = Math.round(currentMonthRevenue / monthProgress);

      const totalSessions = allBookings.length;
      const completedSessions = allBookings.filter(b => b.status === "COMPLETED").length;
      const freeSessionsPerformed = allBookings.filter(b => {
        const s = serviceMap.get(b.serviceId);
        return s?.name.toLowerCase().includes("free intro") && b.status === "COMPLETED";
      }).length;
      const redeemedBookingIds = new Set(coachRedemptions.map(r => r.bookingId));
      const totalRevenueCents = allBookings
        .filter(b => redeemedBookingIds.has(b.id))
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

      let subscriptionRevenueCents = 0;
      const coachOrg = coach.organizationId ? await storage.getOrganizationById(coach.organizationId) : null;
      const subscriptionsEnabled = !!(coachOrg?.subscriptionsEnabled);
      let subscriberUsage: { userId: string; firstName: string; lastName: string; email: string | null; planName: string; sessionsPerWeek: number; sessionsRemaining: number | null; totalAllocated: number; currentPeriodStart: string | null; currentPeriodEnd: string | null; status: string }[] = [];

      if (subscriptionsEnabled && coach.organizationId) {
        try {
          let subStripe: Stripe;
          try {
            const orgStripe = await getOrgStripeClient(coach.organizationId);
            subStripe = orgStripe.stripe;
          } catch {
            subStripe = await getUncachableStripeClient();
          }
          const allInvoices: Stripe.Invoice[] = [];
          for await (const inv of subStripe.invoices.list({
            limit: 100,
            status: 'paid',
            expand: ['data.subscription'],
          })) {
            allInvoices.push(inv);
          }
          subscriptionRevenueCents = allInvoices
            .filter(inv => inv.subscription)
            .reduce((sum, inv) => sum + (inv.amount_paid || 0), 0);
        } catch {
          subscriptionRevenueCents = 0;
        }

        try {
          const orgSubs = await storage.getOrganizationUserSubscriptions(coach.organizationId);
          const plans = await storage.getOrganizationSubscriptionPlans(coach.organizationId);
          const planMap = new Map(plans.map(p => [p.id, p]));

          for (const sub of orgSubs) {
            if (sub.status === "pending") continue;
            const plan = planMap.get(sub.planId);
            if (!plan) continue;
            const user = await storage.getUser(sub.userId);
            const spw = plan.sessionsPerWeek || 1;
            const intervalWeeks = plan.interval === "year" ? 52 * (plan.intervalCount || 1)
              : plan.interval === "month" ? 4 * (plan.intervalCount || 1)
              : (plan.intervalCount || 1);
            const totalAllocated = spw * intervalWeeks;

            subscriberUsage.push({
              userId: sub.userId,
              firstName: user?.firstName || "",
              lastName: user?.lastName || "",
              email: user?.email || null,
              planName: plan.name,
              sessionsPerWeek: spw,
              sessionsRemaining: sub.sessionsRemaining,
              totalAllocated,
              currentPeriodStart: sub.currentPeriodStart?.toISOString() || null,
              currentPeriodEnd: sub.currentPeriodEnd?.toISOString() || null,
              status: sub.status,
            });
          }
        } catch (e) {
          console.error("Error fetching subscriber usage:", e);
        }
      }

      res.json({
        coach: {
          id: coach.id,
          name: `${coach.user?.firstName || ""} ${coach.user?.lastName || ""}`.trim(),
          photoUrl: coach.photoUrl,
          specialties: coach.specialties,
        },
        clients: clientsWithActual,
        subscriptionsEnabled,
        subscriberUsage,
        stats: {
          totalClients: clients.length,
          totalSessions,
          completedSessions,
          redeemedSessions: coachRedemptions.length,
          freeSessionsPerformed,
          totalRevenueCents: totalRevenueCents + subscriptionRevenueCents,
          coachEarningsCents,
          predictedMonthlyRevenueCents,
          subscriptionRevenueCents,
        },
        revenueHistory,
        actualRevenue: {
          walletCents: clientWalletCharges,
          venmoCents: venmoTotal,
          cashCents: cashTotal,
          subscriptionCents: subscriptionRevenueCents,
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

      const coachProf = await storage.getCoachProfile(createdByCoachId);
      const orgId = coachProf?.organizationId || null;

      let stripe: Stripe;
      if (orgId) {
        try {
          const orgStripe = await getOrgStripeClient(orgId);
          stripe = orgStripe.stripe;
        } catch {
          stripe = await getUncachableStripeClient();
        }
      } else {
        stripe = await getUncachableStripeClient();
      }

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
        organizationId: orgId,
      });

      const orgB = await getOrgBranding(orgId || adminProfile?.organizationId);
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
        totalMonths,
        orgB
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
        const profile = await storage.getUserProfile(userId);
        const orgId = profile?.organizationId;
        if (orgId) {
          const orgCoaches = await storage.getCoachProfilesByOrganization(orgId);
          const orgCoachIds = new Set(orgCoaches.map(c => c.id));
          const allQuotes = await storage.getAllTeamQuotes();
          return res.json(allQuotes.filter(q => orgCoachIds.has(q.createdByCoachId)));
        }
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
        const profile = await storage.getUserProfile(userId);
        const orgId = profile?.organizationId;
        if (orgId) {
          const orgCoaches = await storage.getCoachProfilesByOrganization(orgId);
          const orgCoachIds = new Set(orgCoaches.map(c => c.id));
          const allContracts = await storage.getActiveTeamContracts();
          return res.json(allContracts.filter(c => orgCoachIds.has(c.createdByCoachId)));
        }
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

      const reqUserId = req.user.claims.sub;
      const reqProfile = await storage.getUserProfile(reqUserId);
      const reqOrgB = await getOrgBranding(reqProfile?.organizationId);
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
      }, reqOrgB?.ownerEmail, reqOrgB);

      res.json({ success: true, message: "Your team training request has been submitted! We'll be in touch soon." });
    } catch (error: any) {
      console.error("Error sending team training request:", error);
      res.status(500).json({ message: "Failed to submit request. Please try again." });
    }
  });


  const PLATFORM_ORG_ID = "org-est";
  const PROMO_CODES: Record<string, { type: "lifetime_free" }> = {
    "SpeedSystem2026!": { type: "lifetime_free" },
  };

  app.post("/api/subscription/redeem-promo", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile || profile.role !== "ADMIN") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization found" });

      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ message: "Promo code is required" });
      }

      const promo = PROMO_CODES[code.trim()];
      if (!promo) {
        return res.status(400).json({ message: "Invalid promo code" });
      }

      if (promo.type === "lifetime_free") {
        await storage.updateOrganization(orgId, {
          subscriptionStatus: "active" as any,
          trialEndsAt: null,
          subscriptionCurrentPeriodEnd: null,
          stripeSubscriptionId: `promo_${code.trim()}`,
        });

        const org = await storage.getOrganizationById(orgId);
        console.log(`Promo code "${code}" redeemed by org ${orgId} (${org?.name}) — lifetime free access`);

        return res.json({ success: true, message: "Promo code applied! You now have lifetime free access." });
      }

      res.status(400).json({ message: "Invalid promo code type" });
    } catch (error: any) {
      console.error("Promo code error:", error);
      res.status(500).json({ message: "Failed to apply promo code" });
    }
  });

  app.post("/api/subscription/create-checkout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile || profile.role !== "ADMIN") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization found" });
      if (orgId === PLATFORM_ORG_ID) return res.status(400).json({ message: "Platform org does not need a subscription" });

      const org = await storage.getOrganizationById(orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      if (org.subscriptionStatus === "active" || org.subscriptionStatus === "trialing") {
        return res.status(400).json({ message: "You already have an active subscription" });
      }

      const stripe = await getUncachableStripeClient();

      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: org.ownerEmail || undefined,
          name: org.name,
          metadata: { orgId: org.id, orgSlug: org.slug },
        });
        customerId = customer.id;
        await storage.updateOrganization(org.id, { stripeCustomerId: customerId });
      }

      const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0] || req.get("host")}`;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "Train Efficiency Platform - Organization Subscription",
                description: "Full access to the scheduling platform for your coaching business",
              },
              unit_amount: 4999,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ],
        subscription_data: {
          trial_period_days: 3,
          metadata: { orgId: org.id },
        },
        success_url: `${baseUrl}/admin/subscription?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/admin/subscription`,
        metadata: { orgId: org.id },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Subscription checkout error:", error);
      res.status(500).json({ message: error.message || "Failed to create checkout session" });
    }
  });

  app.get("/api/subscription/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile) return res.status(400).json({ message: "No profile found" });

      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization found" });

      if (orgId === PLATFORM_ORG_ID) {
        return res.json({
          status: "active",
          isPlatformOrg: true,
          trialEndsAt: null,
          currentPeriodEnd: null,
          isActive: true,
        });
      }

      const org = await storage.getOrganizationById(orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      let currentStatus = org.subscriptionStatus || "none";

      if (currentStatus === "trialing" && org.trialEndsAt && new Date(org.trialEndsAt) < new Date()) {
        currentStatus = "none";
        await storage.updateOrganization(org.id, { subscriptionStatus: "none" as any });

        if (org.ownerEmail) {
          const { sendSubscriptionExpiredEmail } = await import("./email");
          sendSubscriptionExpiredEmail(org.ownerEmail, org.name, "trial_ended")
            .catch(err => console.error(`Failed to send trial expired email:`, err));
        }
      }

      const isActive = currentStatus === "active" || currentStatus === "trialing";

      res.json({
        status: currentStatus,
        isPlatformOrg: false,
        trialEndsAt: org.trialEndsAt,
        currentPeriodEnd: org.subscriptionCurrentPeriodEnd,
        isActive,
        stripeSubscriptionId: org.stripeSubscriptionId,
      });
    } catch (error: any) {
      console.error("Subscription status error:", error);
      res.status(500).json({ message: "Failed to get subscription status" });
    }
  });

  app.post("/api/subscription/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile || profile.role !== "ADMIN") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization found" });
      if (orgId === PLATFORM_ORG_ID) return res.status(400).json({ message: "Platform org does not need subscription management" });

      const org = await storage.getOrganizationById(orgId);
      if (!org?.stripeSubscriptionId) {
        return res.status(400).json({ message: "No active subscription found" });
      }
      if (org.stripeSubscriptionId.startsWith("promo_")) {
        return res.status(400).json({ message: "Promo subscriptions cannot be canceled" });
      }

      const stripe = await getUncachableStripeClient();
      const updated = await stripe.subscriptions.update(org.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      await storage.updateOrganization(org.id, {
        subscriptionStatus: updated.status as any,
      });

      res.json({ message: "Subscription will be canceled at the end of the current period" });
    } catch (error: any) {
      console.error("Subscription cancel error:", error);
      res.status(500).json({ message: error.message || "Failed to cancel subscription" });
    }
  });

  app.post("/api/subscription/reactivate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile || profile.role !== "ADMIN") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const orgId = profile.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization found" });
      if (orgId === PLATFORM_ORG_ID) return res.status(400).json({ message: "Platform org does not need subscription management" });

      const org = await storage.getOrganizationById(orgId);
      if (!org?.stripeSubscriptionId) {
        return res.status(400).json({ message: "No subscription found" });
      }

      const stripe = await getUncachableStripeClient();
      const updated = await stripe.subscriptions.update(org.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      await storage.updateOrganization(org.id, {
        subscriptionStatus: updated.status as any,
      });

      res.json({ message: "Subscription reactivated" });
    } catch (error: any) {
      console.error("Subscription reactivate error:", error);
      res.status(500).json({ message: error.message || "Failed to reactivate subscription" });
    }
  });

  app.get("/api/subscription/verify-session", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile || profile.role !== "ADMIN") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const callerOrgId = profile.organizationId;
      if (!callerOrgId) return res.status(400).json({ message: "No organization found" });

      const sessionId = req.query.session_id as string;
      if (!sessionId) return res.status(400).json({ message: "Missing session_id" });

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription"],
      });

      const sessionOrgId = session.metadata?.orgId;
      if (sessionOrgId !== callerOrgId) {
        return res.status(403).json({ message: "Session does not belong to your organization" });
      }

      if (session.status === "complete" && session.subscription) {
        const subscription = session.subscription as Stripe.Subscription;
        await storage.updateOrganization(callerOrgId, {
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status as any,
          trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
          subscriptionCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
        });
        res.json({ success: true, status: subscription.status });
      } else {
        res.json({ success: false, status: session.status });
      }
    } catch (error: any) {
      console.error("Verify session error:", error);
      res.status(500).json({ message: "Failed to verify session" });
    }
  });

  app.get("/api/coach/subscription-schedules", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const schedules = await storage.getSubscriptionSchedules(profile.organizationId);
      res.json(schedules);
    } catch (error: any) {
      console.error("Get subscription schedules error:", error);
      res.status(500).json({ message: "Failed to fetch subscription schedules" });
    }
  });

  app.post("/api/coach/subscription-schedules", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const coachId = req.body.coachId || await getCoachId(userId);
      if (!coachId) return res.status(404).json({ message: "Coach profile not found" });

      const schema = z.object({
        subscriptionPlanId: z.string(),
        clientId: z.string(),
        serviceId: z.string().optional(),
        daysOfWeek: z.array(z.number().min(0).max(6)).min(1),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        location: z.string().optional(),
        notes: z.string().optional(),
        weeksToGenerate: z.number().min(1).max(52).default(8),
        coachId: z.string().optional(),
        maxParticipants: z.number().min(2).max(50).optional(),
        groupDescription: z.string().optional(),
        ageRange: z.string().optional(),
        skillLevel: z.string().optional(),
        sport: z.string().optional(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });

      const { subscriptionPlanId, clientId, serviceId: providedServiceId, daysOfWeek, startTime, location, notes, weeksToGenerate, maxParticipants, groupDescription, ageRange, skillLevel, sport } = parsed.data;

      const plans = await storage.getOrganizationSubscriptionPlans(profile.organizationId);
      const plan = plans.find(p => p.id === subscriptionPlanId);
      if (!plan) return res.status(404).json({ message: "Subscription plan not found" });

      let serviceId = providedServiceId;
      if (!serviceId) {
        const orgServices = await storage.getServicesByOrganization(profile.organizationId);
        const activeServices = orgServices.filter(s => s.active);
        const isGroupPlan = plan.sessionType === "group";
        const matchingService = activeServices.find(s => {
          if (isGroupPlan) {
            return s.sessionType === "GROUP" || s.name.toLowerCase().includes("semi-private") || s.name.toLowerCase().includes("group");
          }
          return s.sessionType === "1_ON_1" && !s.name.toLowerCase().includes("semi-private") && !s.name.toLowerCase().includes("group") && !s.name.toLowerCase().includes("team training");
        });
        if (matchingService) {
          serviceId = matchingService.id;
        } else if (activeServices.length > 0) {
          serviceId = activeServices[0].id;
        } else {
          return res.status(400).json({ message: "No active services available. Please create a service first." });
        }
      }

      const service = await storage.getService(serviceId);
      if (!service) return res.status(404).json({ message: "Service not found" });
      if (service.organizationId && service.organizationId !== profile.organizationId) {
        return res.status(403).json({ message: "Service does not belong to your organization" });
      }

      const client = await storage.getUser(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });
      const clientProfile = await storage.getUserProfile(clientId);
      if (clientProfile && clientProfile.organizationId && clientProfile.organizationId !== profile.organizationId) {
        return res.status(403).json({ message: "Client does not belong to your organization" });
      }

      const coachProfile = await storage.getCoachProfile(coachId);
      if (!coachProfile || coachProfile.organizationId !== profile.organizationId) {
        return res.status(403).json({ message: "Coach does not belong to your organization" });
      }

      const isSemiPrivate = plan.sessionType === "group" || service.sessionType === "GROUP";
      const effectiveMaxParticipants = isSemiPrivate ? (maxParticipants || 6) : null;

      const schedule = await storage.createSubscriptionSchedule({
        organizationId: profile.organizationId,
        subscriptionPlanId,
        clientId,
        coachId,
        serviceId,
        daysOfWeek,
        startTime,
        location: location || "",
        notes: notes || "",
        maxParticipants: effectiveMaxParticipants,
        groupDescription: isSemiPrivate ? (groupDescription || "") : "",
        ageRange: isSemiPrivate ? (ageRange || "") : "",
        skillLevel: isSemiPrivate ? (skillLevel || "") : "",
        sport: isSemiPrivate ? (sport || "") : "",
      });

      let created = 0;
      let skipped = 0;
      const today = new Date();

      for (let week = 0; week < weeksToGenerate; week++) {
        for (const dayOfWeek of daysOfWeek) {
          const currentDay = today.getDay();
          let daysUntil = dayOfWeek - currentDay + (week * 7);
          if (week === 0 && daysUntil <= 0) daysUntil += 7;

          const sessionDate = addDays(today, daysUntil);
          const [hours, minutes] = startTime.split(":").map(Number);
          const startAt = new Date(sessionDate);
          startAt.setHours(hours, minutes, 0, 0);
          const endAt = addMinutes(startAt, service.durationMin);

          const overlapping = await storage.getOverlappingBookings(coachId, startAt, endAt);
          if (overlapping.length > 0) {
            skipped++;
            continue;
          }

          await storage.createBooking({
            clientId,
            coachId,
            serviceId,
            startAt,
            endAt,
            status: "CONFIRMED",
            notes: notes || "",
            location: location || "",
            maxParticipants: effectiveMaxParticipants,
            groupDescription: isSemiPrivate ? (groupDescription || "") : "",
            ageRange: isSemiPrivate ? (ageRange || "") : "",
            skillLevel: isSemiPrivate ? (skillLevel || "") : "",
            sport: isSemiPrivate ? (sport || "") : "",
            teamQuoteProgramId: null,
            subscriptionPlanId,
          });
          created++;
        }
      }

      res.json({ schedule, sessionsCreated: created, sessionsSkipped: skipped });
    } catch (error: any) {
      console.error("Create subscription schedule error:", error);
      res.status(500).json({ message: "Failed to create subscription schedule" });
    }
  });

  app.delete("/api/coach/subscription-schedules/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const schedule = await storage.getSubscriptionSchedule(req.params.id);
      if (!schedule || schedule.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Schedule not found" });
      }

      await storage.deleteSubscriptionSchedule(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete subscription schedule error:", error);
      res.status(500).json({ message: "Failed to delete subscription schedule" });
    }
  });

  app.post("/api/coach/subscription-schedules/:id/generate-sessions", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const schedule = await storage.getSubscriptionSchedule(req.params.id);
      if (!schedule || schedule.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Schedule not found" });
      }

      const weeksSchema = z.object({ weeks: z.number().min(1).max(52).default(4) });
      const parsed = weeksSchema.safeParse(req.body);
      const weeks = parsed.success ? parsed.data.weeks : 4;

      const service = await storage.getService(schedule.serviceId);
      if (!service) return res.status(404).json({ message: "Service not found" });

      let created = 0;
      let skipped = 0;
      const today = new Date();

      for (let week = 0; week < weeks; week++) {
        for (const dayOfWeek of schedule.daysOfWeek) {
          const currentDay = today.getDay();
          let daysUntil = dayOfWeek - currentDay + (week * 7);
          if (week === 0 && daysUntil <= 0) daysUntil += 7;

          const sessionDate = addDays(today, daysUntil);
          const [hours, minutes] = schedule.startTime.split(":").map(Number);
          const startAt = new Date(sessionDate);
          startAt.setHours(hours, minutes, 0, 0);
          const endAt = addMinutes(startAt, service.durationMin);

          const overlapping = await storage.getOverlappingBookings(schedule.coachId, startAt, endAt);
          if (overlapping.length > 0) {
            skipped++;
            continue;
          }

          await storage.createBooking({
            clientId: schedule.clientId,
            coachId: schedule.coachId,
            serviceId: schedule.serviceId,
            startAt,
            endAt,
            status: "CONFIRMED",
            notes: schedule.notes || "",
            location: schedule.location || "",
            maxParticipants: schedule.maxParticipants || (service.sessionType === "GROUP" ? 6 : null),
            groupDescription: schedule.groupDescription || "",
            ageRange: schedule.ageRange || "",
            skillLevel: schedule.skillLevel || "",
            sport: schedule.sport || "",
            teamQuoteProgramId: null,
            subscriptionPlanId: schedule.subscriptionPlanId,
          });
          created++;
        }
      }

      res.json({ created, skipped });
    } catch (error: any) {
      console.error("Generate sessions error:", error);
      res.status(500).json({ message: "Failed to generate sessions" });
    }
  });

  startWeeklyReminderJob();

  return httpServer;
}
