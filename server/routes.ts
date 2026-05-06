import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated, createAuthToken, deleteAuthToken, deleteAllUserAuthTokens } from "./replit_integrations/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import { addDays, startOfWeek, format, parseISO, addMinutes, setHours, setMinutes } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import bcrypt from "bcryptjs";
import { sendWelcomeEmail, sendCoachWelcomeEmail, sendBookingConfirmationToClient, sendBookingNotificationToCoach, sendCashoutRequestEmail, sendPaymentConfirmationEmail, sendTeamQuoteEmail, sendTeamTrainingRequestEmail, sendClientInviteEmail, sendSubscriberSessionNotification, sendSubscriptionClaimEmail, sendPasswordResetEmail, sendBookingCancellationEmailToClient, sendBookingCancellationEmailToCoach, sendBookingRescheduleEmailToClient, sendBookingRescheduleEmailToCoach, sendRecurringSessionsCreatedEmailToClient, sendRecurringSessionsCreatedEmailToCoach, type OrgBranding, type EmailLogContext } from "./email";
import { sendSms, normalizePhone, smsBookingConfirmation, smsCancellation, smsReschedule } from "./sms";
import crypto from "crypto";
import Stripe from "stripe";
import { z } from "zod";
import { organizationSubscriptionPlans } from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { users } from "@shared/models/auth";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { startWeeklyReminderJob } from "./weekly-reminder";
import { startSessionReminderJob } from "./session-reminders";
import { handleAssistantMessage } from "./scheduling-assistant";
import { computeCommandCenter, setMonthlyGoal, buildCommandCenterContextString } from "./business-command-center";

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

const UPLOADS_DIR = path.resolve(process.cwd(), "public/uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const mediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}${ext}`);
  },
});

const mediaUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: VIDEO_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

const SECTION_LIMITS: Record<string, number> = {
  hero: 5,
  training_showcase: 20,
  facility: 20,
  coaches: 10,
  testimonials: 10,
  results: 10,
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  app.use("/uploads", express.static(UPLOADS_DIR));

  const RESET_NEUTRAL_MSG = "If an account exists for that email, a password reset link has been sent.";
  const RESET_RATE_WINDOW_MS = 15 * 60 * 1000;
  const resetRateLimitByIp = new Map<string, { count: number; resetAt: number }>();
  const resetRateLimitByEmail = new Map<string, { count: number; resetAt: number }>();

  function incrementRateLimit(map: Map<string, { count: number; resetAt: number }>, key: string, max: number): boolean {
    const now = Date.now();
    const entry = map.get(key);
    if (!entry || now > entry.resetAt) {
      map.set(key, { count: 1, resetAt: now + RESET_RATE_WINDOW_MS });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const MAX_TOKEN_LEN = 200;

  storage.cleanupExpiredResetTokens().catch(() => {});

  app.post("/api/auth/forgot-password", async (req: any, res) => {
    const NEUTRAL = { message: RESET_NEUTRAL_MSG };
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
        return res.status(400).json({ message: "A valid email address is required." });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

      const ipOk = incrementRateLimit(resetRateLimitByIp, ip, 10);
      const emailOk = incrementRateLimit(resetRateLimitByEmail, normalizedEmail, 5);
      if (!ipOk || !emailOk) {
        return res.json(NEUTRAL);
      }

      const coachProfile = await storage.getCoachProfileByEmail(normalizedEmail);
      const user = !coachProfile ? await storage.getUserByEmail(normalizedEmail) : null;

      if (!coachProfile && !user) {
        return res.json(NEUTRAL);
      }

      await storage.invalidatePriorResetTokens(normalizedEmail);

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await storage.createPasswordResetToken({
        email: normalizedEmail,
        userId: coachProfile ? coachProfile.userId : user?.id,
        coachProfileId: coachProfile?.id,
        tokenHash,
        expiresAt,
      });

      const baseUrl = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

      sendPasswordResetEmail(normalizedEmail, resetUrl).catch((err) => {
        console.error("Password reset email send failure:", err);
      });

      return res.json(NEUTRAL);
    } catch (error) {
      console.error("Forgot password error:", error);
      return res.json({ message: RESET_NEUTRAL_MSG });
    }
  });

  app.get("/api/auth/validate-reset-token", async (req: any, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string" || token.length > MAX_TOKEN_LEN) {
        return res.json({ valid: false });
      }
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const record = await storage.findValidResetToken(tokenHash);
      return res.json({ valid: !!record });
    } catch (error) {
      console.error("Validate reset token error:", error);
      return res.json({ valid: false });
    }
  });

  app.post("/api/auth/reset-password", async (req: any, res) => {
    try {
      const { token, password } = req.body;
      if (!token || typeof token !== "string" || token.length > MAX_TOKEN_LEN) {
        return res.status(400).json({ message: "Invalid request." });
      }
      if (!password || typeof password !== "string") {
        return res.status(400).json({ message: "Password is required." });
      }

      const passwordSchema = z.string()
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[a-z]/, "Password must contain at least one lowercase letter")
        .regex(/[0-9]/, "Password must contain at least one number")
        .max(128, "Password must not exceed 128 characters");

      const validation = passwordSchema.safeParse(password);
      if (!validation.success) {
        return res.status(400).json({ message: validation.error.errors[0].message });
      }

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const record = await storage.findValidResetToken(tokenHash);
      if (!record) {
        return res.status(400).json({ message: "This reset link is invalid or has expired." });
      }

      const newHash = await bcrypt.hash(password, 10);

      if (record.coachProfileId) {
        await storage.updateCoachProfilePassword(record.coachProfileId, newHash);
        if (record.userId) {
          const existingUser = await storage.getUser(record.userId);
          if (existingUser?.passwordHash) {
            await storage.updateUserPassword(record.userId, newHash);
          }
        }
      } else if (record.userId) {
        await storage.updateUserPassword(record.userId, newHash);
      }

      await storage.markResetTokenUsed(record.id);

      if (record.userId) {
        deleteAllUserAuthTokens(record.userId).catch(() => {});
      }

      return res.json({ success: true, message: "Your password has been reset successfully. Please sign in." });
    } catch (error) {
      console.error("Reset password error:", error);
      return res.status(500).json({ message: "Server error. Please try again." });
    }
  });

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
      const { email, password, firstName, lastName, organizationId, phone, smsOptIn } = req.body;
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

      const { normalizePhone } = await import('./sms');
      const normalizedPhone = phone ? (normalizePhone(phone.trim()) ?? null) : null;

      const hash = await bcrypt.hash(password, 10);

      const { db: dbRef } = await import("./db");
      const { users } = await import("@shared/models/auth");
      const [created] = await dbRef.insert(users).values({
        email: email.toLowerCase().trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        passwordHash: hash,
        phone: normalizedPhone,
        smsOptIn: smsOptIn === true,
        smsOptInAt: smsOptIn === true ? new Date() : null,
        smsConsentSource: smsOptIn === true ? 'signup' : null,
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

  function isAdminRepairAuthorized(req: any, res: any): boolean {
    const headerKey = req.headers["x-admin-key"];
    const envKey = process.env.ADMIN_REPAIR_KEY;
    if (envKey && headerKey === envKey) return true;
    return false;
  }

  async function adminRepairAuth(req: any, res: any, next: any) {
    if (isAdminRepairAuthorized(req, res)) return next();
    return isAuthenticated(req, res, async () => {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const role = await getUserRole(userId);
      if (role !== "ADMIN") return res.status(403).json({ message: "Forbidden" });
      next();
    });
  }

  app.get("/api/admin/stripe-wallet-sync-audit", adminRepairAuth, async (req: any, res) => {
    try {
      const lookbackDays = parseInt((req.query.days as string) || "30", 10);
      const { WebhookHandlers } = await import("./webhookHandlers");
      const result = await WebhookHandlers.stripeWalletSyncAudit(lookbackDays);
      res.json(result);
    } catch (err: any) {
      console.error("Stripe wallet sync audit error:", err);
      res.status(500).json({ message: err.message || "Audit failed" });
    }
  });

  app.post("/api/admin/stripe-wallet-sync-repair", adminRepairAuth, async (req: any, res) => {
    try {
      const dryRun = req.body?.dryRun !== false;
      const { WebhookHandlers } = await import("./webhookHandlers");
      const result = await WebhookHandlers.stripeWalletSyncRepair(dryRun);
      res.json(result);
    } catch (err: any) {
      console.error("Stripe wallet sync repair error:", err);
      res.status(500).json({ message: err.message || "Repair failed" });
    }
  });

  app.get("/api/admin/platform-stripe-wallet-sync-audit", adminRepairAuth, async (req: any, res) => {
    try {
      const days = parseInt((req.query.days as string) || "90", 10);
      const { WebhookHandlers } = await import("./webhookHandlers");
      const result = await WebhookHandlers.platformStripeWalletSyncAudit(days);
      res.json(result);
    } catch (err: any) {
      console.error("Platform stripe wallet sync audit error:", err);
      res.status(500).json({ message: err.message || "Platform audit failed" });
    }
  });

  app.post("/api/admin/platform-stripe-wallet-sync-repair", adminRepairAuth, async (req: any, res) => {
    try {
      const dryRun = req.body?.dryRun !== false;
      const organizationId = req.body?.organizationId as string | undefined;
      const days = parseInt(req.body?.days || "90", 10);
      const { WebhookHandlers } = await import("./webhookHandlers");
      const result = await WebhookHandlers.platformStripeWalletSyncRepair(dryRun, organizationId, days);
      res.json(result);
    } catch (err: any) {
      console.error("Platform stripe wallet sync repair error:", err);
      res.status(500).json({ message: err.message || "Platform repair failed" });
    }
  });

  app.post("/api/admin/backfill-org-prefs", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const result = await storage.backfillUserOrgPreferences();
      return res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("Backfill org prefs error:", err);
      return res.status(500).json({ message: err.message || "Backfill failed" });
    }
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
      const { locations, tagline, tagline2, primaryColor, secondaryColor, logoUrl, slug, name, stripeSecretKey, stripePublishableKey, websiteUrl, instagramUrl, facebookUrl, youtubeUrl, tiktokUrl, linktreeUrl, subscriptionsEnabled, athleticStartHour, athleticEndHour, athleticEnabled, athleticProgramName, coachTransactionsVisible, schedulingInquiryEmail, schedulingInquiryName, allowUserInquiryEmails, socialPreviewImageUrl } = req.body;
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
      if (youtubeUrl !== undefined) updateData.youtubeUrl = youtubeUrl || null;
      if (tiktokUrl !== undefined) updateData.tiktokUrl = tiktokUrl || null;
      if (linktreeUrl !== undefined) updateData.linktreeUrl = linktreeUrl || null;
      if (stripeSecretKey !== undefined) updateData.stripeSecretKey = stripeSecretKey || null;
      if (stripePublishableKey !== undefined) updateData.stripePublishableKey = stripePublishableKey || null;
      if (subscriptionsEnabled !== undefined) updateData.subscriptionsEnabled = subscriptionsEnabled;
      if (coachTransactionsVisible !== undefined) updateData.coachTransactionsVisible = coachTransactionsVisible;
      if (athleticEnabled !== undefined) updateData.athleticEnabled = athleticEnabled;
      if (schedulingInquiryEmail !== undefined) updateData.schedulingInquiryEmail = schedulingInquiryEmail || null;
      if (schedulingInquiryName !== undefined) updateData.schedulingInquiryName = schedulingInquiryName || null;
      if (allowUserInquiryEmails !== undefined) updateData.allowUserInquiryEmails = allowUserInquiryEmails;
      if (athleticProgramName !== undefined) updateData.athleticProgramName = athleticProgramName;
      if (socialPreviewImageUrl !== undefined) updateData.socialPreviewImageUrl = socialPreviewImageUrl || null;
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

  app.post("/api/organizations/:id/subscription-plans/:planId/send-signup-emails", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (profile?.organizationId !== req.params.id) {
        return res.status(403).json({ message: "You can only manage your own organization" });
      }
      const [plan] = await db.select().from(organizationSubscriptionPlans)
        .where(and(
          eq(organizationSubscriptionPlans.id, req.params.planId),
          eq(organizationSubscriptionPlans.organizationId, req.params.id)
        ));
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      if (!plan.stripePriceId) return res.status(400).json({ message: "This plan has no Stripe price ID configured" });

      let stripe: Stripe;
      try {
        const orgStripe = await getOrgStripeClient(req.params.id);
        stripe = orgStripe.stripe;
      } catch {
        return res.status(400).json({ message: "Stripe is not connected for this organization. Add your Stripe keys in settings." });
      }

      const orgBranding = await getOrgBranding(req.params.id);
      const baseUrl = req.headers.origin || `${req.protocol}://${req.headers.host}`;
      const intervalLabel = plan.intervalCount && plan.intervalCount > 1
        ? `every ${plan.intervalCount} ${plan.interval}s`
        : `per ${plan.interval}`;
      const planPrice = `$${(plan.amountCents / 100).toFixed(2)} ${intervalLabel}`;

      // Fetch all active Stripe subscriptions for this price
      const stripeSubscriptions: Stripe.Subscription[] = [];
      let startingAfter: string | undefined;
      while (true) {
        const page = await stripe.subscriptions.list({
          price: plan.stripePriceId,
          status: "active",
          limit: 100,
          expand: ["data.customer"],
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        stripeSubscriptions.push(...page.data);
        if (!page.has_more) break;
        startingAfter = page.data[page.data.length - 1].id;
      }

      if (stripeSubscriptions.length === 0) {
        return res.json({ sent: 0, total: 0, message: "No active Stripe subscribers found for this plan" });
      }

      let sent = 0;
      let skipped = 0;
      for (const sub of stripeSubscriptions) {
        try {
          // Check if this Stripe subscription is already linked on the platform
          const existing = await storage.getUserSubscriptionByStripeId(sub.id);
          if (existing) { skipped++; continue; }

          const customer = sub.customer as Stripe.Customer;
          if (!customer.email || customer.deleted) { skipped++; continue; }

          const firstName = (customer.name || "").split(" ")[0] || "there";
          const claimUrl = `${baseUrl}/claim-subscription?sub=${sub.id}&planId=${plan.id}`;

          await sendSubscriptionClaimEmail(
            customer.email,
            firstName,
            plan.name,
            planPrice,
            claimUrl,
            orgBranding
          );
          sent++;
        } catch (err) {
          console.error(`Failed to send claim email for Stripe sub ${sub.id}:`, err);
        }
      }

      res.json({ sent, total: stripeSubscriptions.length, skipped, message: `Sent ${sent} of ${stripeSubscriptions.length} emails (${skipped} already connected)` });
    } catch (error) {
      console.error("Error sending subscription signup emails:", error);
      res.status(500).json({ message: "Failed to send subscription signup emails" });
    }
  });

  // Public: look up claim info for a Stripe subscription + plan
  app.get("/api/public/claim-subscription-info", async (req: any, res) => {
    try {
      const { sub: stripeSubId, planId } = req.query as { sub?: string; planId?: string };
      if (!stripeSubId || !planId) return res.status(400).json({ message: "Missing sub or planId" });

      const [plan] = await db.select().from(organizationSubscriptionPlans)
        .where(eq(organizationSubscriptionPlans.id, planId));
      if (!plan) return res.status(404).json({ message: "Plan not found" });

      let stripe: Stripe;
      try {
        const orgStripe = await getOrgStripeClient(plan.organizationId);
        stripe = orgStripe.stripe;
      } catch {
        return res.status(400).json({ message: "Stripe not connected for this organization" });
      }

      const stripeSub = await stripe.subscriptions.retrieve(stripeSubId, { expand: ["customer"] });
      if (stripeSub.status !== "active" && stripeSub.status !== "trialing") {
        return res.status(400).json({ message: "This subscription is not active" });
      }

      const customer = stripeSub.customer as Stripe.Customer;
      const email = customer.email || "";
      const maskedEmail = email.length > 3
        ? email[0] + "*".repeat(email.indexOf("@") - 1) + email.slice(email.indexOf("@"))
        : email;

      const org = await storage.getOrganizationById(plan.organizationId);
      const alreadyLinked = !!(await storage.getUserSubscriptionByStripeId(stripeSubId));

      res.json({
        planId: plan.id,
        planName: plan.name,
        orgName: org?.name || "Unknown",
        orgPrimaryColor: org?.primaryColor || null,
        maskedEmail,
        alreadyLinked,
      });
    } catch (error: any) {
      if (error?.type === "StripeInvalidRequestError") {
        return res.status(404).json({ message: "Stripe subscription not found" });
      }
      console.error("Error fetching claim info:", error);
      res.status(500).json({ message: "Failed to fetch subscription info" });
    }
  });

  // Authenticated: link existing platform account to a Stripe subscription
  app.post("/api/wallet/claim-subscription", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { stripeSubscriptionId, planId } = req.body;
      if (!stripeSubscriptionId || !planId) return res.status(400).json({ message: "Missing stripeSubscriptionId or planId" });

      const [plan] = await db.select().from(organizationSubscriptionPlans)
        .where(eq(organizationSubscriptionPlans.id, planId));
      if (!plan) return res.status(404).json({ message: "Plan not found" });

      const existing = await storage.getUserSubscriptionByStripeId(stripeSubscriptionId);
      if (existing) {
        if (existing.userId === userId) return res.json({ success: true, message: "Already connected" });
        return res.status(409).json({ message: "This subscription is already linked to another account" });
      }

      const alreadyOnPlan = await storage.getUserSubscriptionByPlan(userId, planId);
      if (alreadyOnPlan) return res.status(409).json({ message: "You already have an active subscription for this plan" });

      let stripe: Stripe;
      try {
        const orgStripe = await getOrgStripeClient(plan.organizationId);
        stripe = orgStripe.stripe;
      } catch {
        return res.status(400).json({ message: "Stripe not connected for this organization" });
      }

      const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
      if (stripeSub.status !== "active" && stripeSub.status !== "trialing") {
        return res.status(400).json({ message: "This Stripe subscription is not active" });
      }

      const sessionsPerWeek = plan.sessionsPerWeek || 1;
      const intervalWeeks = plan.interval === "month"
        ? 4 * (plan.intervalCount || 1)
        : (plan.interval === "week" ? (plan.intervalCount || 1) : (plan.intervalCount || 1));
      const totalAllocated = sessionsPerWeek * intervalWeeks;

      await storage.createUserSubscription({
        organizationId: plan.organizationId,
        userId,
        planId,
        stripeSubscriptionId,
        status: stripeSub.status,
        currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
        sessionsRemaining: totalAllocated,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error claiming subscription:", error);
      res.status(500).json({ message: "Failed to link subscription" });
    }
  });

  // Public: register a new account and immediately claim a Stripe subscription
  app.post("/api/public/register-and-claim", async (req: any, res) => {
    try {
      const { email, password, firstName, lastName, stripeSubscriptionId, planId } = req.body;
      if (!email || !password || !firstName || !lastName || !stripeSubscriptionId || !planId) {
        return res.status(400).json({ message: "All fields are required" });
      }
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

      const [plan] = await db.select().from(organizationSubscriptionPlans)
        .where(eq(organizationSubscriptionPlans.id, planId));
      if (!plan) return res.status(404).json({ message: "Plan not found" });

      const existing = await storage.getUserSubscriptionByStripeId(stripeSubscriptionId);
      if (existing) return res.status(409).json({ message: "This subscription is already linked to an account" });

      let stripe: Stripe;
      try {
        const orgStripe = await getOrgStripeClient(plan.organizationId);
        stripe = orgStripe.stripe;
      } catch {
        return res.status(400).json({ message: "Stripe not connected for this organization" });
      }

      const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
      if (stripeSub.status !== "active" && stripeSub.status !== "trialing") {
        return res.status(400).json({ message: "This Stripe subscription is not active" });
      }

      const existingUser = await storage.getUserByEmail(email.toLowerCase());
      if (existingUser) return res.status(409).json({ message: "An account with this email already exists. Please log in instead." });

      const { normalizePhone: normPhone } = await import('./sms');
      const { phone: regPhone, smsOptIn: regSmsOptIn } = req.body;
      const normalizedRegPhone = regPhone ? (normPhone(regPhone.trim()) ?? null) : null;

      const hash = await bcrypt.hash(password, 10);
      const { db: dbRef } = await import("./db");
      const { users } = await import("@shared/models/auth");
      const { userProfiles } = await import("@shared/schema");

      const [created] = await dbRef.insert(users).values({
        email: email.toLowerCase().trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        passwordHash: hash,
        phone: normalizedRegPhone,
        smsOptIn: regSmsOptIn === true,
        smsOptInAt: regSmsOptIn === true ? new Date() : null,
        smsConsentSource: regSmsOptIn === true ? 'signup' : null,
        lastSignInAt: new Date(),
      }).returning();

      await dbRef.insert(userProfiles).values({
        userId: created.id,
        role: "CLIENT" as any,
        organizationId: plan.organizationId,
      });

      const sessionsPerWeek = plan.sessionsPerWeek || 1;
      const intervalWeeks = plan.interval === "month"
        ? 4 * (plan.intervalCount || 1)
        : (plan.intervalCount || 1);
      const totalAllocated = sessionsPerWeek * intervalWeeks;

      await storage.createUserSubscription({
        organizationId: plan.organizationId,
        userId: created.id,
        planId,
        stripeSubscriptionId,
        status: stripeSub.status,
        currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
        sessionsRemaining: totalAllocated,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      });

      const token = await createAuthToken(created.id);
      getOrgBranding(plan.organizationId).then(orgB => {
        sendWelcomeEmail(email.toLowerCase().trim(), firstName.trim(), orgB).catch(() => {});
      });

      res.json({ success: true, token });
    } catch (error) {
      console.error("Error in register-and-claim:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.get("/api/public/subscription-plans/:planId", async (req: any, res) => {
    try {
      const [plan] = await db.select().from(organizationSubscriptionPlans)
        .where(eq(organizationSubscriptionPlans.id, req.params.planId));
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      const org = await storage.getOrganizationById(plan.organizationId);
      res.json({
        id: plan.id,
        name: plan.name,
        description: plan.description,
        amountCents: plan.amountCents,
        interval: plan.interval,
        intervalCount: plan.intervalCount,
        organizationId: plan.organizationId,
        organizationName: org?.name || "Unknown",
        orgPrimaryColor: org?.primaryColor || null,
      });
    } catch (error) {
      console.error("Error fetching public subscription plan:", error);
      res.status(500).json({ message: "Failed to fetch plan" });
    }
  });

  app.post("/api/public/subscription-plans/:planId/checkout", async (req: any, res) => {
    try {
      const [plan] = await db.select().from(organizationSubscriptionPlans)
        .where(eq(organizationSubscriptionPlans.id, req.params.planId));
      if (!plan) return res.status(404).json({ message: "Plan not found" });

      const { stripe } = await getOrgStripeClient(plan.organizationId);
      const baseUrl = req.headers.origin || `${req.protocol}://${req.headers.host}`;
      const { customerEmail } = req.body;

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        line_items: [{ price: plan.stripePriceId, quantity: 1 }],
        success_url: `${baseUrl}/subscribe/${plan.id}?status=success`,
        cancel_url: `${baseUrl}/subscribe/${plan.id}?status=canceled`,
        metadata: {
          planId: plan.id,
          organizationId: plan.organizationId,
        },
      };
      if (customerEmail) {
        sessionParams.customer_email = customerEmail;
      }

      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Error creating subscription checkout:", error);
      if (error.message?.includes("not connected")) {
        return res.status(400).json({ message: "This organization has not connected a Stripe account" });
      }
      res.status(500).json({ message: "Failed to create checkout session" });
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

  app.get("/api/me/org-context", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const context = await storage.getOrgContextForUser(userId);
      if (!context) {
        return res.json({ orgId: null, source: null });
      }
      res.json(context);
    } catch (err: any) {
      console.error("[OrgContext] Error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/me/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const { firstName, lastName, phone } = req.body;

      const updateData: { firstName?: string; lastName?: string; phone?: string | null } = {};
      if (firstName !== undefined && typeof firstName === "string") updateData.firstName = firstName.trim();
      if (lastName !== undefined && typeof lastName === "string") updateData.lastName = lastName.trim() || null as any;
      if (phone !== undefined) {
        const { normalizePhone } = await import('./sms');
        if (phone === null || phone === "") {
          updateData.phone = null;
        } else {
          const normalized = normalizePhone(phone.trim());
          if (!normalized) return res.status(400).json({ message: "Invalid phone number. Please enter a 10-digit US number or include country code." });
          updateData.phone = normalized;
        }
      }

      await storage.updateUser(userId, updateData);
      const user = await storage.getUser(userId);
      res.json({ success: true, phone: user?.phone ?? null, firstName: user?.firstName, lastName: user?.lastName });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to update profile" });
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

      // Validate client-facing bookability
      if ((service as any).isBookableByClient === false) {
        return res.status(403).json({ message: "This service is not available for client booking" });
      }

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

      if (coach.organizationId) {
        storage.ensureUserOrgPreferences(userId, coach.organizationId).catch(() => {});
      }

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
          const bookingOrgId = coachProfile?.organizationId;
          const bookingLogCtx: EmailLogContext | undefined = bookingOrgId ? {
            orgId: bookingOrgId,
            type: "booking_confirmation",
            userId: userId,
            bookingId: booking.id,
            recipientUserId: userId,
          } : undefined;
          const coachName = coachProfile?.user ? `${coachProfile.user.firstName} ${coachProfile.user.lastName}` : "your coach";
          if (clientUser?.email) {
            sendBookingConfirmationToClient(
              clientUser.email,
              clientUser.firstName || "there",
              coachName,
              service.name,
              start,
              end,
              req.body.location || undefined,
              tz,
              orgB,
              bookingLogCtx
            ).catch(() => {});
          }
          // SMS booking confirmation
          if (clientUser?.phone && bookingOrgId) {
            const startZoned = toZonedTime(start, tz);
            const smsBody = smsBookingConfirmation({
              clientFirstName: clientUser.firstName || "there",
              serviceName: service.name,
              coachFirstName: coachProfile?.user?.firstName || "your coach",
              dateStr: format(startZoned, "EEE MMM d"),
              timeStr: format(startZoned, "h:mm a"),
              orgName: orgB?.name || "TrainEfficiency",
            });
            sendSms({ to: clientUser.phone, body: smsBody, ctx: { orgId: bookingOrgId, type: 'booking_confirmation', userId, bookingId: booking.id, recipientUserId: userId } }).catch(() => {});
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

      // Send cancellation emails non-blocking when a booking is cancelled via this route
      if (status === "CANCELLED") {
        (async () => {
          try {
            const coachProfile = await storage.getCoachProfile(booking.coachId);
            const [clientUser, service] = await Promise.all([
              storage.getUser(booking.clientId),
              storage.getService(booking.serviceId),
            ]);
            const userProfile = clientUser ? await storage.getUserProfile(clientUser.id) : null;
            const orgId = userProfile?.organizationId || null;
            const orgBranding = await getOrgBranding(orgId);
            const tz = (coachProfile as any)?.timezone || "America/New_York";
            const coachName = coachProfile?.user
              ? `${coachProfile.user.firstName ?? ""} ${coachProfile.user.lastName ?? ""}`.trim()
              : "Your Coach";
            const clientName = clientUser
              ? `${clientUser.firstName ?? ""} ${clientUser.lastName ?? ""}`.trim()
              : "A client";
            const serviceName = service?.name || "Training Session";
            const startAt = new Date(booking.startAt);
            const endAt = new Date(booking.endAt);
            const location = (booking as any).location || undefined;

            const cancelLogCtx: EmailLogContext | undefined = orgId ? {
                orgId,
                type: "cancellation",
                userId: clientUser?.id,
                bookingId: booking.id,
                recipientUserId: clientUser?.id,
              } : undefined;
            if (clientUser?.email) {
              sendBookingCancellationEmailToClient(
                clientUser.email,
                clientUser.firstName || "there",
                coachName,
                serviceName,
                startAt,
                endAt,
                location,
                tz,
                orgBranding,
                cancelLogCtx
              ).catch(() => {});
            } else {
              console.log("[PATCH /api/bookings/:id/status] Skipping client cancellation email — no email on file");
            }
            // SMS cancellation
            if (clientUser?.phone && orgId) {
              const startZoned = toZonedTime(startAt, tz);
              const smsCancelBody = smsCancellation({
                clientFirstName: clientUser.firstName || "there",
                serviceName,
                dateStr: format(startZoned, "EEE MMM d"),
                timeStr: format(startZoned, "h:mm a"),
                orgName: orgBranding?.name || "TrainEfficiency",
              });
              sendSms({ to: clientUser.phone, body: smsCancelBody, ctx: { orgId, type: 'cancellation', userId: clientUser.id, bookingId: booking.id, recipientUserId: clientUser.id } }).catch(() => {});
            }

            const coachEmail = (coachProfile as any)?.email || coachProfile?.user?.email;
            if (coachEmail) {
              sendBookingCancellationEmailToCoach(
                coachEmail,
                coachProfile?.user?.firstName || "Coach",
                clientName,
                serviceName,
                startAt,
                endAt,
                location,
                tz,
                orgBranding
              ).catch(() => {});
            } else {
              console.log("[PATCH /api/bookings/:id/status] Skipping coach cancellation email — no email on file");
            }
          } catch (err) {
            console.error("[PATCH /api/bookings/:id/status] Cancellation email error:", err);
          }
        })();
      }

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

      if (resolvedClientId && coachOrgId) {
        storage.ensureUserOrgPreferences(resolvedClientId, coachOrgId).catch(() => {});
      }

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
              const coachBookingOrgId = coachProfile?.organizationId;
              sendBookingConfirmationToClient(
                clientUser.email,
                clientUser.firstName || "there",
                coachDisplayName,
                service.name,
                start,
                end,
                req.body.location || undefined,
                tz,
                orgB,
                coachBookingOrgId ? { orgId: coachBookingOrgId, type: "booking_confirmation", userId: resolvedClientId, bookingId: booking.id, recipientUserId: resolvedClientId } : undefined
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

      // Send recurring session creation emails non-blocking
      if (created.length > 0) {
        (async () => {
          try {
            const coachProfile = await storage.getCoachProfile(targetCoachId);
            const clientUser = await storage.getUser(sourceBooking.clientId);
            const userProfile = clientUser ? await storage.getUserProfile(clientUser.id) : null;
            const orgId = userProfile?.organizationId || null;
            const orgBranding = await getOrgBranding(orgId);
            const tz = (coachProfile as any)?.timezone || "America/New_York";
            const coachName = coachProfile?.user
              ? `${coachProfile.user.firstName ?? ""} ${coachProfile.user.lastName ?? ""}`.trim()
              : "Your Coach";
            const clientName = clientUser
              ? `${clientUser.firstName ?? ""} ${clientUser.lastName ?? ""}`.trim()
              : "A client";
            const serviceName = service?.name || "Training Session";
            const sortedCreated = [...created].sort((a, b) =>
              new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
            );
            const firstSessionAt = new Date(sortedCreated[0].startAt);
            const lastSessionAt = new Date(sortedCreated[sortedCreated.length - 1].startAt);
            const location = (sourceBooking as any).location || undefined;

            const recurringLogCtx: EmailLogContext | undefined = orgId ? {
                orgId,
                type: "recurring",
                userId: clientUser?.id,
                recipientUserId: clientUser?.id,
              } : undefined;
            if (clientUser?.email) {
              sendRecurringSessionsCreatedEmailToClient(
                clientUser.email,
                clientUser.firstName || "there",
                coachName,
                serviceName,
                created.length,
                firstSessionAt,
                lastSessionAt,
                location,
                tz,
                orgBranding,
                recurringLogCtx
              ).catch(() => {});
            } else {
              console.log("[POST /api/coach/bookings/clone] Skipping client recurring email — no email on file");
            }

            const coachEmail = (coachProfile as any)?.email || coachProfile?.user?.email;
            if (coachEmail) {
              sendRecurringSessionsCreatedEmailToCoach(
                coachEmail,
                coachProfile?.user?.firstName || "Coach",
                clientName,
                serviceName,
                created.length,
                firstSessionAt,
                lastSessionAt,
                location,
                tz,
                orgBranding
              ).catch(() => {});
            } else {
              console.log("[POST /api/coach/bookings/clone] Skipping coach recurring email — no email on file");
            }
          } catch (err) {
            console.error("[POST /api/coach/bookings/clone] Recurring email error:", err);
          }
        })();
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

      // Send reschedule emails non-blocking when start time changes via this route
      if (updateData.startAt) {
        (async () => {
          try {
            const coachProfile = await storage.getCoachProfile(bookingCoachId);
            const clientUser = await storage.getUser(existing.clientId);
            const svc = await storage.getService(existing.serviceId);
            const userProfile = clientUser ? await storage.getUserProfile(clientUser.id) : null;
            const orgId = userProfile?.organizationId || null;
            const orgBranding = await getOrgBranding(orgId);
            const tz = (coachProfile as any)?.timezone || "America/New_York";
            const coachName = coachProfile?.user
              ? `${coachProfile.user.firstName ?? ""} ${coachProfile.user.lastName ?? ""}`.trim()
              : "Your Coach";
            const clientName = clientUser
              ? `${clientUser.firstName ?? ""} ${clientUser.lastName ?? ""}`.trim()
              : "A client";
            const serviceName = svc?.name || "Training Session";
            const oldStartAt = new Date(existing.startAt);
            const oldEndAt = new Date(existing.endAt);
            const newStartAt = new Date(updateData.startAt);
            const newEndAt = new Date(updateData.endAt || existing.endAt);
            const location = (updateData.location ?? (existing as any).location) || undefined;

            const rescheduleLogCtx: EmailLogContext | undefined = orgId ? {
                orgId,
                type: "reschedule",
                userId: clientUser?.id,
                bookingId: bookingId,
                recipientUserId: clientUser?.id,
              } : undefined;
            if (clientUser?.email) {
              sendBookingRescheduleEmailToClient(
                clientUser.email,
                clientUser.firstName || "there",
                coachName,
                serviceName,
                oldStartAt,
                oldEndAt,
                newStartAt,
                newEndAt,
                location,
                tz,
                orgBranding,
                rescheduleLogCtx
              ).catch(() => {});
            } else {
              console.log("[PATCH /api/coach/bookings/:id] Skipping client reschedule email — no email on file");
            }
            // SMS reschedule
            if (clientUser?.phone && orgId) {
              const newStartZoned = toZonedTime(newStartAt, tz);
              const smsRescheduleBody = smsReschedule({
                clientFirstName: clientUser.firstName || "there",
                serviceName,
                newDateStr: format(newStartZoned, "EEE MMM d"),
                newTimeStr: format(newStartZoned, "h:mm a"),
                orgName: orgBranding?.name || "TrainEfficiency",
              });
              sendSms({ to: clientUser.phone, body: smsRescheduleBody, ctx: { orgId, type: 'reschedule', userId: clientUser.id, bookingId: bookingId, recipientUserId: clientUser.id } }).catch(() => {});
            }

            const coachEmail = (coachProfile as any)?.email || coachProfile?.user?.email;
            if (coachEmail) {
              sendBookingRescheduleEmailToCoach(
                coachEmail,
                coachProfile?.user?.firstName || "Coach",
                clientName,
                serviceName,
                oldStartAt,
                oldEndAt,
                newStartAt,
                newEndAt,
                location,
                tz,
                orgBranding
              ).catch(() => {});
            } else {
              console.log("[PATCH /api/coach/bookings/:id] Skipping coach reschedule email — no email on file");
            }
          } catch (err) {
            console.error("[PATCH /api/coach/bookings/:id] Reschedule email error:", err);
          }
        })();
      }

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
      const {
        name, description, durationMin, priceCents, sessionType,
        category, countsTowardRevenue, revenueRecognition,
        payoutType, payoutValueCents, payoutPercent, coachPayWhenRedeemed,
        countsTowardUtilization, blocksAvailability, countsTowardSessionCount,
        requiresClient, isBookableByClient, isBookableByCoach,
      } = req.body;
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
        category: category || "paid",
        countsTowardRevenue: countsTowardRevenue !== undefined ? countsTowardRevenue : true,
        revenueRecognition: revenueRecognition || "at_booking",
        payoutType: payoutType || "percentage",
        payoutValueCents: payoutValueCents ?? null,
        payoutPercent: payoutPercent ?? null,
        coachPayWhenRedeemed: coachPayWhenRedeemed || false,
        countsTowardUtilization: countsTowardUtilization !== undefined ? countsTowardUtilization : true,
        blocksAvailability: blocksAvailability !== undefined ? blocksAvailability : true,
        countsTowardSessionCount: countsTowardSessionCount !== undefined ? countsTowardSessionCount : true,
        requiresClient: requiresClient !== undefined ? requiresClient : true,
        isBookableByClient: isBookableByClient !== undefined ? isBookableByClient : true,
        isBookableByCoach: isBookableByCoach !== undefined ? isBookableByCoach : true,
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
      const {
        name, description, durationMin, priceCents, active, sessionType,
        category, countsTowardRevenue, revenueRecognition,
        payoutType, payoutValueCents, payoutPercent, coachPayWhenRedeemed,
        countsTowardUtilization, blocksAvailability, countsTowardSessionCount,
        requiresClient, isBookableByClient, isBookableByCoach,
      } = req.body;
      const existing = await storage.getService(id);
      if (!existing) return res.status(404).json({ message: "Service not found" });

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (durationMin !== undefined) updateData.durationMin = durationMin;
      if (active !== undefined) updateData.active = active;
      if (sessionType !== undefined) updateData.sessionType = sessionType;
      if (category !== undefined) updateData.category = category;
      if (countsTowardRevenue !== undefined) updateData.countsTowardRevenue = countsTowardRevenue;
      if (revenueRecognition !== undefined) updateData.revenueRecognition = revenueRecognition;
      if (payoutType !== undefined) updateData.payoutType = payoutType;
      if (payoutValueCents !== undefined) updateData.payoutValueCents = payoutValueCents;
      if (payoutPercent !== undefined) updateData.payoutPercent = payoutPercent;
      if (coachPayWhenRedeemed !== undefined) updateData.coachPayWhenRedeemed = coachPayWhenRedeemed;
      if (countsTowardUtilization !== undefined) updateData.countsTowardUtilization = countsTowardUtilization;
      if (blocksAvailability !== undefined) updateData.blocksAvailability = blocksAvailability;
      if (countsTowardSessionCount !== undefined) updateData.countsTowardSessionCount = countsTowardSessionCount;
      if (requiresClient !== undefined) updateData.requiresClient = requiresClient;
      if (isBookableByClient !== undefined) updateData.isBookableByClient = isBookableByClient;
      if (isBookableByCoach !== undefined) updateData.isBookableByCoach = isBookableByCoach;

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

  app.get("/api/athletic/programs", async (req, res) => {
    try {
      const orgId = req.query.orgId as string;
      if (!orgId) return res.status(400).json({ message: "orgId query param required" });
      const programs = await storage.getAthleticPrograms(orgId);
      res.json(programs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch athletic programs" });
    }
  });

  app.get("/api/athletic/programs/:id", async (req, res) => {
    try {
      const program = await storage.getAthleticProgramById(req.params.id);
      if (!program) return res.status(404).json({ message: "Program not found" });
      res.json(program);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch athletic program" });
    }
  });

  app.get("/api/athletic/programs/by-slug/:orgId/:slug", async (req, res) => {
    try {
      const program = await storage.getAthleticProgramBySlug(req.params.orgId, req.params.slug);
      if (!program) return res.status(404).json({ message: "Program not found" });
      res.json(program);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch athletic program" });
    }
  });

  app.post("/api/athletic/programs", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { name, slug, maxTeamsPerSlot, trainingTypes, startHour, endHour } = req.body;
      if (!name || !slug) return res.status(400).json({ message: "name and slug are required" });
      const existing = await storage.getAthleticProgramBySlug(profile.organizationId, slug);
      if (existing) return res.status(409).json({ message: "A program with this slug already exists" });
      const program = await storage.createAthleticProgram({
        organizationId: profile.organizationId,
        name,
        slug,
        maxTeamsPerSlot: maxTeamsPerSlot ?? 2,
        trainingTypes: trainingTypes ?? ["Strength", "Speed"],
        startHour: startHour ?? 16,
        endHour: endHour ?? 20,
        active: true,
      });
      res.json(program);
    } catch (error) {
      res.status(500).json({ message: "Failed to create athletic program" });
    }
  });

  app.patch("/api/athletic/programs/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const program = await storage.getAthleticProgramById(req.params.id);
      if (!program || program.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Program not found" });
      }
      const { name, slug, maxTeamsPerSlot, trainingTypes, startHour, endHour, active } = req.body;
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (slug !== undefined) {
        const existingSlug = await storage.getAthleticProgramBySlug(profile.organizationId, slug);
        if (existingSlug && existingSlug.id !== program.id) {
          return res.status(409).json({ message: "A program with this slug already exists" });
        }
        updateData.slug = slug;
      }
      if (maxTeamsPerSlot !== undefined) updateData.maxTeamsPerSlot = maxTeamsPerSlot;
      if (trainingTypes !== undefined) updateData.trainingTypes = trainingTypes;
      if (startHour !== undefined) updateData.startHour = startHour;
      if (endHour !== undefined) updateData.endHour = endHour;
      if (active !== undefined) updateData.active = active;
      const updated = await storage.updateAthleticProgram(req.params.id, updateData);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update athletic program" });
    }
  });

  app.delete("/api/athletic/programs/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const program = await storage.getAthleticProgramById(req.params.id);
      if (!program || program.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Program not found" });
      }
      await storage.deleteAthleticProgram(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete athletic program" });
    }
  });

  app.get("/api/athletic/bookings", async (req, res) => {
    try {
      const date = req.query.date as string;
      const programId = req.query.programId as string;
      if (!date) return res.status(400).json({ message: "date query param required" });
      if (!programId) return res.status(400).json({ message: "programId query param required" });
      const list = await storage.getAthleticBookings(date, programId);
      res.json(list);
    } catch (error) {
      console.error("Error fetching athletic bookings:", error);
      res.status(500).json({ message: "Failed to fetch athletic bookings" });
    }
  });

  async function getAthleticHoursForDate(date: string, programId: string): Promise<{ startHour: number; endHour: number }> {
    const schedules = await storage.getAthleticHourSchedules(programId);
    for (const s of schedules) {
      if (date >= s.startDate && date <= s.endDate) {
        return { startHour: s.startHour, endHour: s.endHour };
      }
    }
    const program = await storage.getAthleticProgramById(programId);
    return { startHour: program?.startHour ?? 16, endHour: program?.endHour ?? 20 };
  }

  app.get("/api/athletic/config", async (req: any, res) => {
    try {
      const date = req.query.date as string | undefined;
      const programId = req.query.programId as string;
      if (!programId) return res.status(400).json({ message: "programId query param required" });
      const { startHour, endHour } = await getAthleticHoursForDate(date || new Date().toISOString().slice(0, 10), programId);
      const schedules = await storage.getAthleticHourSchedules(programId);
      const program = await storage.getAthleticProgramById(programId);
      res.json({ startHour, endHour, schedules, maxTeamsPerSlot: program?.maxTeamsPerSlot ?? 2, trainingTypes: program?.trainingTypes ?? ["Strength", "Speed"] });
    } catch (error) {
      console.error("Error fetching athletic config:", error);
      res.status(500).json({ message: "Failed to fetch athletic config" });
    }
  });

  app.get("/api/athletic/schedules", async (req: any, res) => {
    try {
      const programId = req.query.programId as string;
      if (!programId) return res.status(400).json({ message: "programId query param required" });
      const schedules = await storage.getAthleticHourSchedules(programId);
      res.json(schedules);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch athletic schedules" });
    }
  });

  app.post("/api/athletic/schedules", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { label, startDate, endDate, startHour, endHour, programId } = req.body;
      if (!programId) return res.status(400).json({ message: "programId is required" });
      const program = await storage.getAthleticProgramById(programId);
      if (!program || program.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Program not found" });
      }
      if (!label || !startDate || !endDate || startHour === undefined || endHour === undefined) {
        return res.status(400).json({ message: "label, startDate, endDate, startHour, endHour are required" });
      }
      if (startHour >= endHour || startHour < 0 || endHour > 24) {
        return res.status(400).json({ message: "Start hour must be before end hour (0-24)" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }
      const schedule = await storage.createAthleticHourSchedule({ organizationId: profile.organizationId, programId, label, startDate, endDate, startHour, endHour });
      res.json(schedule);
    } catch (error) {
      res.status(500).json({ message: "Failed to create athletic schedule" });
    }
  });

  app.patch("/api/athletic/schedules/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const existing = await storage.getAthleticHourScheduleById(req.params.id);
      if (!existing || existing.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Schedule not found" });
      }

      const { label, startDate, endDate, startHour, endHour } = req.body;
      const data: any = {};
      if (label !== undefined) data.label = label;
      if (startDate !== undefined) data.startDate = startDate;
      if (endDate !== undefined) data.endDate = endDate;
      if (startHour !== undefined) data.startHour = startHour;
      if (endHour !== undefined) data.endHour = endHour;
      if (data.startHour !== undefined && data.endHour !== undefined && data.startHour >= data.endHour) {
        return res.status(400).json({ message: "Start hour must be before end hour" });
      }
      const updated = await storage.updateAthleticHourSchedule(req.params.id, data);
      if (!updated) return res.status(404).json({ message: "Schedule not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update athletic schedule" });
    }
  });

  app.delete("/api/athletic/schedules/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const existing = await storage.getAthleticHourScheduleById(req.params.id);
      if (!existing || existing.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Schedule not found" });
      }

      await storage.deleteAthleticHourSchedule(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete athletic schedule" });
    }
  });

  app.post("/api/athletic/bookings", async (req: any, res) => {
    try {
      const { date, timeSlot, teamName, trainingType, bookedBy, programId } = req.body;
      if (!programId) return res.status(400).json({ message: "programId is required" });
      if (!date || !timeSlot || !teamName) return res.status(400).json({ message: "date, timeSlot, teamName are required" });

      const program = await storage.getAthleticProgramById(programId);
      if (!program) return res.status(404).json({ message: "Program not found" });
      if (!program.active) return res.status(400).json({ message: "This program is not currently active" });

      const bookingOrg = await storage.getOrganizationById(program.organizationId);
      if (!bookingOrg) return res.status(404).json({ message: "Organization not found" });
      if (!bookingOrg.athleticEnabled) return res.status(400).json({ message: "Athletic scheduling is not enabled for this organization" });

      const { startHour, endHour } = await getAthleticHoursForDate(date, programId);
      const validSlots: string[] = [];
      for (let h = startHour; h < endHour; h++) {
        validSlots.push(`${h.toString().padStart(2, "0")}:00`);
      }
      if (!validSlots.includes(timeSlot)) {
        return res.status(400).json({ message: `Invalid time slot. Must be within the configured hours.` });
      }
      const count = await storage.countAthleticBookingsForSlot(date, timeSlot, programId);
      if (count >= program.maxTeamsPerSlot) {
        return res.status(409).json({ message: `This time slot is full (max ${program.maxTeamsPerSlot} teams per hour)` });
      }
      const validTypes = program.trainingTypes || ["Strength", "Speed"];
      const finalType = trainingType || validTypes[0] || "Strength";
      const booking = await storage.createAthleticBooking({ organizationId: program.organizationId, programId, date, timeSlot, teamName, trainingType: finalType, bookedBy: bookedBy || null });
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
      let currentPeriodStart: Date | null = null;
      let status = "active";
      let sessionsRemaining: number | null = null;

      if (stripeSubscriptionId) {
        try {
          const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
          currentPeriodStart = new Date(stripeSub.current_period_start * 1000);
          currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
          status = stripeSub.status;

          // Initialize sessions remaining from the plan config
          const plan = await storage.getOrganizationSubscriptionPlan(existing.planId);
          if (plan) {
            const spw = plan.sessionsPerWeek || 1;
            const intervalWeeks = plan.interval === "year"
              ? 52 * (plan.intervalCount || 1)
              : plan.interval === "month"
              ? 4 * (plan.intervalCount || 1)
              : (plan.intervalCount || 1);
            sessionsRemaining = spw * intervalWeeks;
          }
        } catch {}
      }

      const updated = await storage.updateUserSubscription(existing.id, {
        stripeSubscriptionId,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        ...(sessionsRemaining !== null ? { sessionsRemaining } : {}),
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

  app.post("/api/wallet/subscriptions/:id/reactivate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const subs = await storage.getUserSubscriptions(userId);
      const subscription = subs.find(s => s.id === req.params.id);
      if (!subscription) return res.status(404).json({ message: "Subscription not found" });
      if (subscription.userId !== userId) return res.status(403).json({ message: "Forbidden" });
      if (!subscription.cancelAtPeriodEnd) return res.status(400).json({ message: "Subscription is not scheduled for cancellation" });
      if (!subscription.stripeSubscriptionId) return res.status(400).json({ message: "No Stripe subscription linked" });

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

      await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: false });
      await storage.updateUserSubscription(subscription.id, { cancelAtPeriodEnd: false });

      res.json({ message: "Subscription reactivated" });
    } catch (error) {
      console.error("Error reactivating subscription:", error);
      res.status(500).json({ message: "Failed to reactivate subscription" });
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
      const coachTz = coachProfile?.timezone || "America/New_York";

      for (let week = 0; week < weeksToGenerate; week++) {
        for (const dayOfWeek of daysOfWeek) {
          const currentDay = today.getDay();
          let daysUntil = dayOfWeek - currentDay + (week * 7);
          if (week === 0 && daysUntil <= 0) daysUntil += 7;

          const sessionDate = addDays(today, daysUntil);
          const [hours, minutes] = startTime.split(":").map(Number);
          const localDate = new Date(sessionDate);
          localDate.setHours(hours, minutes, 0, 0);
          const startAt = fromZonedTime(localDate, coachTz);
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
      const coachProfile = await storage.getCoachProfile(schedule.coachId);
      const coachTz = coachProfile?.timezone || "America/New_York";

      for (let week = 0; week < weeks; week++) {
        for (const dayOfWeek of schedule.daysOfWeek) {
          const currentDay = today.getDay();
          let daysUntil = dayOfWeek - currentDay + (week * 7);
          if (week === 0 && daysUntil <= 0) daysUntil += 7;

          const sessionDate = addDays(today, daysUntil);
          const [hours, minutes] = schedule.startTime.split(":").map(Number);
          const localDate = new Date(sessionDate);
          localDate.setHours(hours, minutes, 0, 0);
          const startAt = fromZonedTime(localDate, coachTz);
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

  // ===== LOCATIONS (org-scoped) =====
  app.get("/api/locations", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getUserProfile(req.user.id);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const locs = await storage.getLocationsByOrganization(profile.organizationId);
      res.json(locs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/locations", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const profile = await storage.getUserProfile(req.user.id);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { name, description, address, capacity } = req.body;
      if (!name) return res.status(400).json({ message: "Name is required" });
      const loc = await storage.createLocation({ organizationId: profile.organizationId, name, description: description || "", address: address || "", capacity: capacity || null, active: true });
      res.json(loc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/locations/:id", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const profile = await storage.getUserProfile(req.user.id);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const existing = await storage.getLocation(req.params.id);
      if (!existing || existing.organizationId !== profile.organizationId) return res.status(404).json({ message: "Location not found" });
      const updated = await storage.updateLocation(req.params.id, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/locations/:id", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const profile = await storage.getUserProfile(req.user.id);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const existing = await storage.getLocation(req.params.id);
      if (!existing || existing.organizationId !== profile.organizationId) return res.status(404).json({ message: "Location not found" });
      await storage.deleteLocation(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== BLOCKED TIMES (org-scoped) =====
  app.get("/api/blocked-times", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getUserProfile(req.user.id);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const coachProfile = await storage.getCoachProfileByUserId(req.user.id);
      let bts;
      if (coachProfile && profile.role === "COACH") {
        bts = await storage.getBlockedTimesByCoach(coachProfile.id);
      } else {
        bts = await storage.getBlockedTimesByOrganization(profile.organizationId);
      }
      res.json(bts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/blocked-times", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const profile = await storage.getUserProfile(req.user.id);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { coachId, startAt, endAt, reason, isAllDay } = req.body;
      if (!coachId || !startAt || !endAt) return res.status(400).json({ message: "coachId, startAt, endAt required" });
      const bt = await storage.createBlockedTime({ coachId, organizationId: profile.organizationId, startAt: new Date(startAt), endAt: new Date(endAt), reason: reason || "", isAllDay: isAllDay || false });
      res.json(bt);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/blocked-times/:id", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const profile = await storage.getUserProfile(req.user.id);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      await storage.deleteBlockedTime(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== ORG-SCOPED SCHEDULING BOOKINGS =====
  app.get("/api/scheduling/bookings", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const orgBookings = await storage.getBookingsByOrganization(profile.organizationId);
      res.json(orgBookings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/scheduling/bookings", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { clientId, coachId, serviceId, startAt, endAt, notes, location, locationId, maxParticipants } = req.body;
      if (!clientId || !coachId || !serviceId || !startAt || !endAt) {
        return res.status(400).json({ message: "clientId, coachId, serviceId, startAt, endAt are required" });
      }
      const coachProfile = await storage.getCoachProfile(coachId);
      if (!coachProfile || coachProfile.organizationId !== profile.organizationId) {
        return res.status(400).json({ message: "Coach does not belong to this organization" });
      }
      const service = await storage.getService(serviceId);
      if (!service || service.organizationId !== profile.organizationId) {
        return res.status(400).json({ message: "Service does not belong to this organization" });
      }
      const booking = await storage.createBooking({
        organizationId: profile.organizationId,
        clientId,
        coachId,
        serviceId,
        locationId: locationId || null,
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        status: "CONFIRMED",
        notes: notes || "",
        location: location || "",
        maxParticipants: maxParticipants || null,
        groupDescription: "",
      });
      res.json(booking);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/scheduling/bookings/:id/status", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { status } = req.body;
      const booking = await storage.getBooking(req.params.id);
      if (!booking) return res.status(404).json({ message: "Booking not found" });
      const updated = await storage.updateBookingStatus(req.params.id, status);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/scheduling/bookings/:id", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const booking = await storage.getBooking(req.params.id);
      if (!booking) return res.status(404).json({ message: "Booking not found" });
      const { startAt, endAt, notes, location, serviceId, clientId } = req.body;
      const updated = await storage.updateBooking(req.params.id, {
        ...(startAt && { startAt: new Date(startAt) }),
        ...(endAt && { endAt: new Date(endAt) }),
        ...(notes !== undefined && { notes }),
        ...(location !== undefined && { location }),
        ...(serviceId && { serviceId }),
        ...(clientId && { clientId }),
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== OPERATIONS DIGEST =====
  app.get("/api/scheduling/operations-digest", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeOrgDigest } = await import("./scheduling-intelligence");
      const digest = await computeOrgDigest(profile.organizationId);
      res.json(digest);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== WAITLIST =====
  app.get("/api/scheduling/waitlist", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const entries = await storage.getWaitlistByOrganization(profile.organizationId);
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/scheduling/waitlist", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { clientId, coachId, sessionType, preferredDays, preferredTimeStart, preferredTimeEnd, notes } = req.body;
      if (!clientId) return res.status(400).json({ message: "clientId is required" });
      const entry = await storage.addToWaitlist({
        organizationId: profile.organizationId,
        clientId,
        coachId: coachId || null,
        sessionType: sessionType || null,
        preferredDays: preferredDays || null,
        preferredTimeStart: preferredTimeStart || null,
        preferredTimeEnd: preferredTimeEnd || null,
        notes: notes || "",
      });
      res.json(entry);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/scheduling/waitlist/:id", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const removed = await storage.removeFromWaitlist(req.params.id);
      if (!removed) return res.status(404).json({ message: "Not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== AGENT ACTION LOG =====
  app.get("/api/scheduling/agent-action-log", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const log = await storage.getAgentActionLog(profile.organizationId, limit);
      res.json(log);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== AUTOMATION LEVEL =====
  app.get("/api/scheduling/automation-level", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const level = await storage.getOrgAutomationLevel(profile.organizationId);
      res.json({ level });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/scheduling/automation-level", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { level } = req.body;
      if (typeof level !== "number" || level < 1 || level > 3) {
        return res.status(400).json({ message: "level must be 1, 2, or 3" });
      }
      await storage.setOrgAutomationLevel(profile.organizationId, level);
      res.json({ level });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== REVENUE INTELLIGENCE =====
  app.get("/api/scheduling/revenue-summary", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeRevenueSummary } = await import("./revenue-intelligence");
      const summary = await computeRevenueSummary(profile.organizationId);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Phase 9: Revenue Optimization Engine API routes
  app.get("/api/scheduling/revenue-quality", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeRevenueQuality } = await import("./revenue-intelligence");
      const { startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks } = await import("date-fns");
      const period = (req.query.period as string) ?? "this_week";
      const now = new Date();
      let start: Date, end: Date;
      if (period === "last_week") {
        start = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
        end = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      } else if (period === "this_month") {
        start = startOfMonth(now); end = endOfMonth(now);
      } else {
        start = startOfWeek(now, { weekStartsOn: 1 });
        end = endOfWeek(now, { weekStartsOn: 1 });
      }
      res.json(await computeRevenueQuality(profile.organizationId, start, end));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/scheduling/session-mix", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeSessionMix } = await import("./revenue-intelligence");
      const { startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks } = await import("date-fns");
      const period = (req.query.period as string) ?? "this_week";
      const now = new Date();
      let start: Date, end: Date;
      if (period === "last_week") {
        start = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
        end = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      } else if (period === "this_month") {
        start = startOfMonth(now); end = endOfMonth(now);
      } else {
        start = startOfWeek(now, { weekStartsOn: 1 });
        end = endOfWeek(now, { weekStartsOn: 1 });
      }
      res.json(await computeSessionMix(profile.organizationId, start, end));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/scheduling/coach-profitability", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeCoachProfitability } = await import("./revenue-intelligence");
      const { startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks } = await import("date-fns");
      const period = (req.query.period as string) ?? "this_week";
      const now = new Date();
      let start: Date, end: Date;
      if (period === "last_week") {
        start = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
        end = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      } else if (period === "this_month") {
        start = startOfMonth(now); end = endOfMonth(now);
      } else {
        start = startOfWeek(now, { weekStartsOn: 1 });
        end = endOfWeek(now, { weekStartsOn: 1 });
      }
      res.json(await computeCoachProfitability(profile.organizationId, start, end));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/scheduling/revenue-pressure", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeDailyRevenuePressure } = await import("./revenue-intelligence");
      res.json(await computeDailyRevenuePressure(profile.organizationId));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/scheduling/lost-revenue", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeLostRevenueOpportunities } = await import("./revenue-intelligence");
      res.json(await computeLostRevenueOpportunities(profile.organizationId));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/scheduling/churn-risks", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeChurnRisks } = await import("./revenue-intelligence");
      const risks = await computeChurnRisks(profile.organizationId);
      res.json(risks);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/scheduling/upsell-opportunities", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeUpsellOpportunities } = await import("./revenue-intelligence");
      const opps = await computeUpsellOpportunities(profile.organizationId);
      res.json(opps);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/scheduling/client-ltv", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeClientLTVs } = await import("./revenue-intelligence");
      const ltvs = await computeClientLTVs(profile.organizationId);
      res.json(ltvs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/scheduling/session-packages", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeSessionPackageAlerts } = await import("./revenue-intelligence");
      const alerts = await computeSessionPackageAlerts(profile.organizationId);
      res.json(alerts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== BUSINESS COMMAND CENTER =====

  app.get("/api/business-command-center", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const data = await computeCommandCenter(profile.organizationId);
      res.json(data);
    } catch (err: any) {
      console.error("Business command center error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/business-command-center/monthly-goal", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { goalCents } = req.body;
      if (typeof goalCents !== "number" || goalCents < 0) {
        return res.status(400).json({ message: "goalCents must be a non-negative number" });
      }
      await setMonthlyGoal(profile.organizationId, goalCents);
      res.json({ ok: true, goalCents });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ===== SCHEDULING AGENT =====
  app.post("/api/scheduling-agent/chat", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages)) return res.status(400).json({ message: "messages array required" });

      const user = await storage.getUser(userId);
      const coachProfile = await storage.getCoachProfileByUserId(userId);
      const userName = user ? `${user.firstName} ${user.lastName}`.trim() : null;

      let businessContext: string | null = null;
      if ((profile.role === "ADMIN" || profile.role === "COACH") && profile.organizationId) {
        try {
          businessContext = await buildCommandCenterContextString(profile.organizationId);
          // Inject email performance + follow-up context
          try {
            const [perfStats, followUpStats] = await Promise.all([
              storage.getEmailPerformanceStats(profile.organizationId),
              storage.getFollowUpStats(profile.organizationId),
            ]);
            const bestVariantName = perfStats.bestVariant?.name ?? "none";
            const emailCtx = `\n\nEMAIL PERFORMANCE CONTEXT:\n- open rate: ${perfStats.openRate}%\n- reply rate: ${perfStats.replyRate}%\n- conversion rate: ${perfStats.conversionRate}%\n- best performing variant: ${bestVariantName}\n\nFOLLOW-UP CONTEXT:\n- active follow-up sequences: ${followUpStats.activeSequences}\n- replies pending review: ${followUpStats.pendingReplies}\n- interested leads: ${followUpStats.interestedLeads}\n\nRules:\n- if interested leads > 0, prioritize converting them before new outreach\n- if active sequences > 0, avoid sending duplicate outreach to prospects already in a follow-up sequence\n- prefer high-performing variants when suggesting outreach strategies\n- if reply rate is low (<5%), recommend adapting tone or shortening messages\n- if open rate is high but replies low, suggest more direct calls to action`;
            businessContext = (businessContext || "") + emailCtx;
          } catch {}
        } catch {}
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");

      const stream = handleAssistantMessage(messages, userId, profile.role, userName, coachProfile?.id || null, profile.organizationId || null, businessContext);
      for await (const chunk of stream) {
        res.write(chunk);
      }
      res.end();
    } catch (error: any) {
      console.error("Scheduling agent error:", error);
      if (!res.headersSent) res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/scheduling-agent/context", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const orgCoaches = (await storage.getCoachProfiles()).filter(c => c.organizationId === profile.organizationId);
      const orgServices = await storage.getServicesByOrganization(profile.organizationId);
      const orgLocations = await storage.getLocationsByOrganization(profile.organizationId);
      res.json({ coaches: orgCoaches, services: orgServices, locations: orgLocations });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== ORGANIZATION MEDIA =====

  app.get("/api/org/media", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const media = await storage.getOrgMedia(profile.organizationId);
      const grouped: Record<string, typeof media> = {};
      for (const item of media) {
        if (!grouped[item.section]) grouped[item.section] = [];
        grouped[item.section].push(item);
      }
      res.json({ media, grouped });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/org/media", isAuthenticated, requireRole("ADMIN", "COACH"), mediaUpload.single("file"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const { section = "hero", caption, altText } = req.body;
      const validSections = ["hero", "training_showcase", "facility", "coaches", "testimonials", "results"];
      if (!validSections.includes(section)) return res.status(400).json({ message: "Invalid section" });

      const isImage = ALLOWED_IMAGE_TYPES.includes(req.file.mimetype);
      const isVideo = ALLOWED_VIDEO_TYPES.includes(req.file.mimetype);
      if (isImage && req.file.size > IMAGE_MAX_BYTES) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: "Image exceeds 10MB limit" });
      }
      if (!isImage && !isVideo) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: "Unsupported file type" });
      }

      const limit = SECTION_LIMITS[section] ?? 10;
      const existing = await storage.getOrgMediaBySection(profile.organizationId, section);
      if (existing.length >= limit) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: `Section "${section}" supports up to ${limit} items` });
      }

      const fileUrl = `/uploads/${req.file.filename}`;
      const mediaType = isImage ? "image" : "video";
      const maxOrder = existing.reduce((m, i) => Math.max(m, i.orderIndex), -1);

      const created = await storage.createOrgMedia({
        organizationId: profile.organizationId,
        mediaType: mediaType as any,
        section: section as any,
        url: fileUrl,
        thumbnailUrl: null,
        caption: caption || null,
        altText: altText || null,
        orderIndex: maxOrder + 1,
        isActive: true,
        uploadedBy: userId,
      });

      res.status(201).json(created);
    } catch (err: any) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/org/media/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const item = await storage.getOrgMediaById(req.params.id);
      if (!item) return res.status(404).json({ message: "Not found" });
      if (item.organizationId !== profile.organizationId) return res.status(403).json({ message: "Forbidden" });

      const { section, caption, altText, orderIndex, isActive } = req.body;
      const updateData: any = {};
      if (section !== undefined) updateData.section = section;
      if (caption !== undefined) updateData.caption = caption;
      if (altText !== undefined) updateData.altText = altText;
      if (orderIndex !== undefined) updateData.orderIndex = orderIndex;
      if (isActive !== undefined) updateData.isActive = isActive;

      const updated = await storage.updateOrgMedia(req.params.id, updateData);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/org/media/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const item = await storage.getOrgMediaById(req.params.id);
      if (!item) return res.status(404).json({ message: "Not found" });
      if (item.organizationId !== profile.organizationId) return res.status(403).json({ message: "Forbidden" });

      await storage.deleteOrgMedia(req.params.id);

      if (item.url?.startsWith("/uploads/")) {
        const filePath = path.join(UPLOADS_DIR, path.basename(item.url));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/org/media/reorder", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const { updates } = req.body;
      if (!Array.isArray(updates)) return res.status(400).json({ message: "updates array required" });

      for (const u of updates) {
        const item = await storage.getOrgMediaById(u.id);
        if (!item || item.organizationId !== profile.organizationId) return res.status(403).json({ message: "Forbidden" });
      }

      await storage.reorderOrgMedia(updates);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/public/org/:slug/media", async (req, res) => {
    try {
      const org = await storage.getOrganizationBySlug(req.params.slug);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const media = await storage.getPublicOrgMedia(org.id);
      const grouped: Record<string, typeof media> = {};
      for (const item of media) {
        if (!grouped[item.section]) grouped[item.section] = [];
        grouped[item.section].push(item);
      }
      res.json({ media, grouped });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/org/info", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(404).json({ message: "No organization" });
      const org = await storage.getOrganizationById(profile.organizationId);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      res.json({ id: org.id, name: org.name, slug: org.slug });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const DEFAULT_NOTIFICATION_PREFS = {
    bookingConfirmations: true,
    cancellations: true,
    reschedules: true,
    reminders: true,
    outreach: true,
    marketing: false,
  };

  const DEFAULT_SMS_PREFS_ROUTE = {
    bookingConfirmations: false,
    cancellations: false,
    reschedules: false,
    reminders: false,
    outreach: false,
    marketing: false,
  };

  app.get("/api/unsubscribe/:token", async (req: any, res) => {
    try {
      const user = await storage.getUserByUnsubscribeToken(req.params.token);
      if (!user) return res.status(404).json({ message: "Invalid or expired unsubscribe link" });
      const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;

      // Phase 7: Read org-level prefs if orgId provided, fallback to user-level
      let rawPrefs = user.notificationPreferences as any;
      let smsOptIn = user.smsOptIn;
      if (orgId) {
        try {
          const orgPrefs = await storage.getUserOrgPreferences(user.id, orgId);
          if (orgPrefs) {
            if (orgPrefs.notificationPreferences) rawPrefs = orgPrefs.notificationPreferences;
            smsOptIn = orgPrefs.smsOptIn;
          }
        } catch (err) {
          console.error('[Unsubscribe] Failed to load org prefs:', err);
        }
      }

      let emailPrefs: Record<string, boolean>;
      let smsPrefs: Record<string, boolean>;
      if (rawPrefs?.email || rawPrefs?.sms) {
        emailPrefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(rawPrefs.email || {}) };
        smsPrefs = { ...DEFAULT_SMS_PREFS_ROUTE, ...(rawPrefs.sms || {}) };
      } else {
        emailPrefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(rawPrefs || {}) };
        smsPrefs = { ...DEFAULT_SMS_PREFS_ROUTE };
      }
      res.json({ email: user.email, preferences: { email: emailPrefs, sms: smsPrefs }, phone: user.phone, smsOptIn, orgId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/unsubscribe/:token", async (req: any, res) => {
    try {
      const user = await storage.getUserByUnsubscribeToken(req.params.token);
      if (!user) return res.status(404).json({ message: "Invalid or expired unsubscribe link" });
      const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
      const incoming = req.body.preferences;
      if (!incoming || typeof incoming !== "object") return res.status(400).json({ message: "preferences object required" });
      const rawPrefs = user.notificationPreferences as any;
      let existingEmail: Record<string, boolean>;
      let existingSms: Record<string, boolean>;
      if (rawPrefs?.email || rawPrefs?.sms) {
        existingEmail = rawPrefs.email || {};
        existingSms = rawPrefs.sms || {};
      } else {
        existingEmail = rawPrefs || {};
        existingSms = {};
      }
      const mergedEmail = { ...DEFAULT_NOTIFICATION_PREFS, ...existingEmail, ...(incoming.email || incoming) };
      const mergedSms = { ...DEFAULT_SMS_PREFS_ROUTE, ...existingSms, ...(incoming.sms || {}) };
      const merged = { email: mergedEmail, sms: mergedSms };

      // Phase 7: Write to org-level if orgId present, also write to user-level (backward compat)
      await storage.updateNotificationPreferences(user.id, merged);
      if (orgId) {
        try {
          await storage.upsertUserOrgPreferences(user.id, orgId, { notificationPreferences: merged });
        } catch (err) {
          console.error('[Unsubscribe] Failed to write org prefs:', err);
        }
      }
      res.json({ success: true, preferences: merged });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/notification-preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      console.log(`[Preferences] userId=${userId}`);

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const profile = await storage.getUserProfile(userId);
      // Accept explicit orgId from query param; fall back to profile's org
      const orgId = (req.query.orgId as string | undefined) || profile?.organizationId || null;
      console.log(`[Preferences] orgId=${orgId ?? 'none'}`);

      const token = await storage.ensureUnsubscribeToken(userId);

      // Org-level prefs: auto-create row if missing, then read
      let rawPrefs = user.notificationPreferences as any;
      let effectiveSmsOptIn = user.smsOptIn;
      let effectiveSmsOptInAt = user.smsOptInAt;

      if (orgId) {
        try {
          const orgPrefs = await storage.ensureUserOrgPreferences(userId, orgId);
          console.log(`[Preferences] createdOrLoaded row userId=${userId} orgId=${orgId} smsOptIn=${orgPrefs.smsOptIn}`);
          if (orgPrefs.notificationPreferences) rawPrefs = orgPrefs.notificationPreferences;
          effectiveSmsOptIn = orgPrefs.smsOptIn;
          effectiveSmsOptInAt = orgPrefs.smsOptInAt ?? null;
        } catch (err: any) {
          console.error('[Preferences] Failed to load/create org prefs:', err?.stack ?? err);
        }
      }

      // Normalize: handle both nested { email, sms } and legacy flat shapes
      let emailPrefs: Record<string, boolean>;
      let smsPrefs: Record<string, boolean>;
      if (rawPrefs && (rawPrefs.email || rawPrefs.sms)) {
        emailPrefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(rawPrefs.email || {}) };
        smsPrefs = { ...DEFAULT_SMS_PREFS_ROUTE, ...(rawPrefs.sms || {}) };
      } else if (rawPrefs && typeof rawPrefs === 'object') {
        // Legacy flat shape — treat all keys as email prefs
        emailPrefs = { ...DEFAULT_NOTIFICATION_PREFS, ...rawPrefs };
        smsPrefs = { ...DEFAULT_SMS_PREFS_ROUTE };
      } else {
        emailPrefs = { ...DEFAULT_NOTIFICATION_PREFS };
        smsPrefs = { ...DEFAULT_SMS_PREFS_ROUTE };
      }

      res.json({
        preferences: { email: emailPrefs, sms: smsPrefs },
        unsubscribeToken: token,
        phone: user.phone ?? null,
        smsOptIn: effectiveSmsOptIn ?? false,
        smsOptInAt: effectiveSmsOptInAt ?? null,
        orgId,
      });
    } catch (err: any) {
      console.error('[Preferences] Unexpected error:', err?.stack ?? err);
      res.status(500).json({ message: err.message ?? "Failed to load preferences" });
    }
  });

  app.patch("/api/notification-preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      const { preferences, phone, smsOptIn } = req.body;
      if (!preferences || typeof preferences !== "object") return res.status(400).json({ message: "preferences object required" });

      // Handle phone update
      if (phone !== undefined) {
        const { normalizePhone } = await import('./sms');
        if (phone && phone.trim()) {
          const normalized = normalizePhone(phone.trim());
          if (!normalized) {
            return res.status(400).json({ message: "Invalid phone number. Please enter a 10-digit US number or include a country code (e.g. +1 555 000 0000)." });
          }
          await storage.updateUser(userId, { phone: normalized });
        } else {
          await storage.updateUser(userId, { phone: null });
        }
      }

      // Handle SMS opt-in change — write to user-level (backward compat) AND org-level
      const smsOptInChanged = smsOptIn !== undefined && typeof smsOptIn === "boolean";
      if (smsOptInChanged && smsOptIn !== user.smsOptIn) {
        await storage.updateUserSmsOptIn(userId, smsOptIn, 'notification_preferences');
      }

      // Save preferences in nested shape — write to user-level (backward compat) AND org-level
      const rawPrefs = user.notificationPreferences as any;
      let existingEmail: Record<string, boolean>;
      let existingSms: Record<string, boolean>;
      if (rawPrefs?.email || rawPrefs?.sms) {
        existingEmail = rawPrefs.email || {};
        existingSms = rawPrefs.sms || {};
      } else {
        existingEmail = rawPrefs || {};
        existingSms = {};
      }
      const mergedEmail = { ...DEFAULT_NOTIFICATION_PREFS, ...existingEmail, ...(preferences.email || {}) };
      const mergedSms = { ...DEFAULT_SMS_PREFS_ROUTE, ...existingSms, ...(preferences.sms || {}) };
      const merged = { email: mergedEmail, sms: mergedSms };
      await storage.updateNotificationPreferences(userId, merged);

      // Phase 4: Also write to org-level preferences
      if (orgId) {
        try {
          const orgUpdate: Record<string, any> = { notificationPreferences: merged };
          if (smsOptInChanged) {
            orgUpdate.smsOptIn = smsOptIn;
            orgUpdate.smsOptInAt = smsOptIn ? new Date() : null;
            orgUpdate.smsOptOutAt = smsOptIn ? null : new Date();
          }
          await storage.upsertUserOrgPreferences(userId, orgId, orgUpdate);
        } catch (err) {
          console.error('[NotifPrefs] Failed to write org prefs:', err);
        }
      }

      res.json({ preferences: merged });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/communication-logs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const limit = parseInt(req.query.limit as string) || 200;
      const logs = await storage.getCommunicationsByOrg(profile.organizationId, limit);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/communication-logs/booking/:bookingId", isAuthenticated, async (req: any, res) => {
    try {
      const logs = await storage.getCommunicationsByBooking(req.params.bookingId);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Twilio STOP/START webhook for SMS opt-out/opt-in
  app.post("/api/twilio/sms/incoming", express.urlencoded({ extended: false }), async (req: any, res) => {
    try {
      const from: string = (req.body?.From || "").trim();
      const body: string = (req.body?.Body || "").trim().toUpperCase();
      if (!from) return res.status(200).send("<?xml version='1.0'?><Response/>");

      // Normalize phone to find user
      const { normalizePhone } = await import('./sms');
      const normalized = normalizePhone(from);
      if (!normalized) return res.status(200).send("<?xml version='1.0'?><Response/>");

      if (body === "STOP" || body === "STOPALL" || body === "UNSUBSCRIBE" || body === "CANCEL" || body === "END" || body === "QUIT") {
        // Find user by phone and opt them out
        const allUsers = await db.select().from(users).where(eq(users.phone, normalized));
        for (const u of allUsers) {
          await storage.updateUserSmsOptIn(u.id, false, 'twilio_stop');
          console.log(`[SMS STOP] Opted out user ${u.id} (${normalized})`);
        }
      } else if (body === "START" || body === "YES" || body === "UNSTOP") {
        const allUsers = await db.select().from(users).where(eq(users.phone, normalized));
        for (const u of allUsers) {
          await storage.updateUserSmsOptIn(u.id, true, 'twilio_start');
          console.log(`[SMS START] Opted in user ${u.id} (${normalized})`);
        }
      }

      res.status(200).send("<?xml version='1.0'?><Response/>");
    } catch (err) {
      console.error("[Twilio webhook] Error:", err);
      res.status(200).send("<?xml version='1.0'?><Response/>");
    }
  });

  // ─── Team Training Prospecting Routes ─────────────────────────────────────

  /** Compute the next scheduled run timestamp based on preferred time and frequency. */
  const FALLBACK_TZ = "America/New_York";

  function resolveOrgTimezone(org: any): string {
    return org?.timezone || FALLBACK_TZ;
  }

  /**
   * Compute the next UTC timestamp at which recurring research should fire.
   * All wall-clock arithmetic is done in the org's timezone so "8:00 AM"
   * always means 8:00 AM local time, regardless of server timezone.
   */
  function computeNextRunAt(preferredTime: string, frequency: string, timezone: string): Date {
    const [hStr, mStr] = (preferredTime || "08:00").split(":");
    const h = parseInt(hStr, 10) || 8;
    const m = parseInt(mStr, 10) || 0;

    const nowUtc = new Date();
    // Represent "now" as a Date whose .getHours()/.getDate() etc. reflect local org time
    const nowLocal = toZonedTime(nowUtc, timezone);

    const candidateLocal = new Date(nowLocal);
    candidateLocal.setHours(h, m, 0, 0);

    // If that local time has already passed today, advance by one period
    if (candidateLocal <= nowLocal) {
      if (frequency === "daily") candidateLocal.setDate(candidateLocal.getDate() + 1);
      else if (frequency === "monthly") candidateLocal.setMonth(candidateLocal.getMonth() + 1);
      else candidateLocal.setDate(candidateLocal.getDate() + 7);
    }

    // Convert the local candidate back to a real UTC instant
    return fromZonedTime(candidateLocal, timezone);
  }

  /**
   * Build a human-readable label ("Today at 8:00 AM", "Tomorrow at 8:00 AM", …)
   * relative to the org's local timezone so it matches the stored nextRunAt.
   */
  function buildNextRunLabel(nextRunAtUtc: Date, timezone: string): string {
    const nowLocal = toZonedTime(new Date(), timezone);
    const nextLocal = toZonedTime(nextRunAtUtc, timezone);

    const todayMidnight = new Date(nowLocal); todayMidnight.setHours(0, 0, 0, 0);
    const tomorrowMidnight = new Date(todayMidnight); tomorrowMidnight.setDate(todayMidnight.getDate() + 1);
    const nextMidnight = new Date(nextLocal); nextMidnight.setHours(0, 0, 0, 0);

    const timeStr = nextLocal.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    if (nextMidnight.getTime() === todayMidnight.getTime()) return `Today at ${timeStr}`;
    if (nextMidnight.getTime() === tomorrowMidnight.getTime()) return `Tomorrow at ${timeStr}`;
    return nextLocal.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) + ` at ${timeStr}`;
  }

  /** Format an HH:MM string as 12-hour time (e.g. "08:00" → "8:00 AM"). */
  function formatTime12h(time: string): string {
    const [hStr, mStr] = (time || "08:00").split(":");
    const h = parseInt(hStr, 10) || 8;
    const m = parseInt(mStr, 10) || 0;
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
  }

  // Get lead research settings
  app.get("/api/team-training-leads/settings", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const org = await storage.getOrganizationById(profile.organizationId);
      const saved = await storage.getTeamLeadSettings(profile.organizationId);
      const orgCity = (org as any)?.city || "";
      const orgState = (org as any)?.state || "";
      const fallbackLocation = [orgCity, orgState].filter(Boolean).join(", ");
      const orgTz = resolveOrgTimezone(org);
      if (saved) {
        const nextRunLabel = saved.recurringEnabled && saved.nextRunAt ? buildNextRunLabel(new Date(saved.nextRunAt), orgTz) : null;
        const preferredTimeLabel = saved.recurringTime ? formatTime12h(saved.recurringTime) : "8:00 AM";
        return res.json({ ...saved, nextRunLabel, preferredTimeLabel, timezone: orgTz });
      }
      return res.json({
        organizationId: profile.organizationId,
        defaultLocation: fallbackLocation,
        radiusMiles: 25,
        recurringEnabled: false,
        recurringFrequency: "weekly",
        recurringDayOfWeek: null,
        recurringTime: "08:00",
        recurringLimit: 8,
        recurringSport: "all",
        lastRunAt: null,
        nextRunAt: null,
        nextRunLabel: null,
        preferredTimeLabel: "8:00 AM",
        timezone: orgTz,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update lead research settings
  app.patch("/api/team-training-leads/settings", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const { defaultLocation, radiusMiles, recurringEnabled, recurringFrequency, recurringDayOfWeek, recurringTime, recurringLimit, recurringSport } = req.body;

      if (recurringEnabled && (!defaultLocation || !defaultLocation.trim())) {
        return res.status(400).json({ error: "Location required", message: "A default location is required to enable recurring research." });
      }
      if (radiusMiles !== undefined && (radiusMiles < 5 || radiusMiles > 100)) {
        return res.status(400).json({ error: "Invalid radius", message: "Radius must be between 5 and 100 miles." });
      }
      if (recurringLimit !== undefined && (recurringLimit < 1 || recurringLimit > 25)) {
        return res.status(400).json({ error: "Invalid limit", message: "Leads per run must be between 1 and 25." });
      }
      const validFrequencies = ["daily", "weekly", "monthly"];
      if (recurringFrequency && !validFrequencies.includes(recurringFrequency)) {
        return res.status(400).json({ error: "Invalid frequency", message: "Frequency must be daily, weekly, or monthly." });
      }

      // Fetch org to get its timezone for accurate scheduling
      const org = await storage.getOrganizationById(profile.organizationId);
      const orgTz = resolveOrgTimezone(org);

      // Compute nextRunAt in org's local timezone so "8:00 AM" means 8:00 AM there
      const effectiveTime = recurringTime ?? "08:00";
      const effectiveFreq = recurringFrequency ?? "weekly";
      let nextRunAt: Date | null = null;
      if (recurringEnabled) {
        nextRunAt = computeNextRunAt(effectiveTime, effectiveFreq, orgTz);
      }

      const updated = await storage.upsertTeamLeadSettings(profile.organizationId, {
        defaultLocation: defaultLocation ?? "",
        radiusMiles: radiusMiles ?? 25,
        recurringEnabled: recurringEnabled ?? false,
        recurringFrequency: effectiveFreq,
        recurringDayOfWeek: recurringDayOfWeek ?? null,
        recurringTime: effectiveTime,
        recurringLimit: recurringLimit ?? 8,
        recurringSport: recurringSport ?? "all",
        nextRunAt: recurringEnabled ? nextRunAt : null,
      });

      await storage.logOutreachEvent({
        orgId: profile.organizationId,
        eventType: "settings_updated",
        description: `Lead research settings updated. Location: ${defaultLocation || "—"}, Radius: ${radiusMiles || 25}mi, Recurring: ${recurringEnabled ? `${effectiveFreq} at ${effectiveTime}` : "off"}`,
        metadata: { defaultLocation, radiusMiles, recurringEnabled, recurringFrequency, recurringLimit, recurringSport },
      });

      const nextRunLabel = recurringEnabled && nextRunAt ? buildNextRunLabel(nextRunAt, orgTz) : null;
      const preferredTimeLabel = formatTime12h(effectiveTime);
      res.json({ ...updated, nextRunLabel, preferredTimeLabel, timezone: orgTz });
    } catch (err: any) {
      console.error("[TeamTraining Settings]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get all prospects for org
  app.get("/api/admin/team-training/prospects", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { sport, outreachStatus, city } = req.query as any;
      const prospects = await storage.getTeamTrainingProspects(profile.organizationId, {
        sport: sport || undefined,
        outreachStatus: outreachStatus || undefined,
        city: city || undefined,
      });
      res.json(prospects);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Dashboard stats
  app.get("/api/admin/team-training/stats", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const stats = await storage.getProspectDashboardStats(profile.organizationId);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Run AI research
  app.post("/api/admin/team-training/research", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const org = await storage.getOrganizationById(profile.organizationId);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const savedSettings = await storage.getTeamLeadSettings(profile.organizationId);
      const { sport, limit = 8 } = req.body;
      let { location, radiusMiles } = req.body;

      // Fall back to saved defaults
      if (!location || !location.trim()) location = savedSettings?.defaultLocation || "";
      if (!radiusMiles) radiusMiles = savedSettings?.radiusMiles || 25;

      if (!location || !location.trim()) {
        return res.status(400).json({
          error: "Location required",
          message: "Enter a city and state to research local team training leads.",
        });
      }

      if (!process.env.OPENAI_API_KEY) {
        console.error("[Team Leads Research] Missing OPENAI_API_KEY");
        return res.status(500).json({
          error: "AI research is not configured",
          message: "Missing OPENAI_API_KEY on the server.",
        });
      }

      const locationTrimmed = location.trim();
      const radiusNum = Math.max(5, Math.min(100, Number(radiusMiles) || 25));

      await storage.logOutreachEvent({
        orgId: profile.organizationId,
        eventType: "manual_research_started",
        description: `Manual research started. Location: ${locationTrimmed}, Radius: ${radiusNum}mi${sport ? `, Sport: ${sport}` : ""}`,
        metadata: { location: locationTrimmed, radiusMiles: radiusNum, sport: sport || null, limit: Number(limit) },
      });

      const { researchProspects, scoreProspect, applyLeadQualityGate } = await import("./team-training-prospecting");
      const results = await researchProspects(org, locationTrimmed, sport || undefined, Number(limit), radiusNum);

      // Load existing prospect names for duplicate detection
      const existingProspects = await storage.getTeamTrainingProspects(profile.organizationId);
      const existingNames = existingProspects.map((p) => p.prospectName);

      const created: any[] = [];
      const rejected: { name: string; reason: string; score: number }[] = [];
      const duplicates: { name: string }[] = [];
      let needsContactCount = 0;

      for (const p of results) {
        const scored = scoreProspect(p);
        const gate = applyLeadQualityGate(p, scored, existingNames);

        if (gate.action === "duplicate") {
          duplicates.push({ name: p.prospectName });
          continue;
        }

        if (gate.action === "reject") {
          rejected.push({ name: p.prospectName, reason: gate.reason || "Low quality", score: scored });
          continue;
        }

        // gate.action === "save"
        const prospect = await storage.createTeamTrainingProspect({
          orgId: profile.organizationId,
          prospectName: p.prospectName,
          organizationType: p.organizationType,
          sport: p.sport,
          city: p.city,
          state: p.state,
          websiteUrl: p.websiteUrl,
          contactName: p.contactName,
          contactRole: p.contactRole,
          contactEmail: p.contactEmail,
          contactPhone: p.contactPhone,
          sourceUrl: p.sourceUrl,
          confidenceScore: scored,
          outreachStatus: "Needs Review",
          notes: p.notes,
          decisionMakerName: p.decisionMakerName,
          decisionMakerTitle: p.decisionMakerTitle,
          decisionMakerEmail: p.decisionMakerEmail,
          contactConfidence: p.contactConfidence,
          contactSourceUrl: p.contactSourceUrl,
          contactQuality: p.contactQuality,
        });
        created.push(prospect);
        existingNames.push(p.prospectName); // prevent intra-batch duplicates
        if (gate.needsContact) needsContactCount++;
      }

      // Save location + radius as org defaults after successful search
      await storage.upsertTeamLeadSettings(profile.organizationId, {
        defaultLocation: locationTrimmed,
        radiusMiles: radiusNum,
      });

      const summary = {
        total: results.length,
        saved: created.length,
        needsContact: needsContactCount,
        rejectedLowQuality: rejected.length,
        duplicatesSkipped: duplicates.length,
        rejected,
        duplicates,
      };

      await storage.logOutreachEvent({
        orgId: profile.organizationId,
        eventType: "manual_research_completed",
        description: `Manual research completed. Saved ${created.length}, rejected ${rejected.length}, skipped ${duplicates.length} duplicates near ${locationTrimmed}${sport ? ` for sport: ${sport}` : ""}`,
        metadata: { ...summary, sport: sport || null, location: locationTrimmed, radiusMiles: radiusNum },
      });

      res.json({ count: created.length, prospects: created, summary });
    } catch (err: any) {
      console.error("[TeamTraining Research]", err);
      if (err.message === "AI research is not configured") {
        return res.status(500).json({
          error: "AI research is not configured",
          message: "Missing OPENAI_API_KEY on the server.",
        });
      }
      res.status(500).json({ message: err.message });
    }
  });

  // Create prospect manually
  app.post("/api/admin/team-training/prospects", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const prospect = await storage.createTeamTrainingProspect({
        ...req.body,
        orgId: profile.organizationId,
      });
      res.json(prospect);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update prospect
  app.patch("/api/admin/team-training/prospects/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const updated = await storage.updateTeamTrainingProspect(req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Prospect not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Delete prospect
  app.delete("/api/admin/team-training/prospects/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      await storage.deleteTeamTrainingProspect(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get drafts for a prospect
  app.get("/api/admin/team-training/prospects/:id/drafts", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const drafts = await storage.getOutreachDraftsByProspect(req.params.id);
      res.json(drafts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get all drafts for org
  app.get("/api/admin/team-training/drafts", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const drafts = await storage.getOutreachDraftsByOrg(profile.organizationId);
      res.json(drafts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Generate email draft (AI)
  app.post("/api/admin/team-training/prospects/:id/generate-email", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const prospect = await storage.getTeamTrainingProspect(req.params.id);
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });

      const org = await storage.getOrganizationById(profile.organizationId);
      const owner = org?.ownerUserId ? await storage.getUser(org.ownerUserId) : null;
      const ownerCoach = org?.ownerEmail ? await storage.getCoachProfileByEmail(org.ownerEmail) : null;
      const coachUser = ownerCoach ? await storage.getUser(ownerCoach.userId) : null;
      const coachName = coachUser ? `${coachUser.firstName} ${coachUser.lastName}`.trim() : (owner ? `${owner.firstName} ${owner.lastName}`.trim() : "Coach");

      const { generateOutreachEmail } = await import("./team-training-prospecting");
      const draft = await generateOutreachEmail({
        businessName: org?.name || "Our Training Facility",
        coachName,
        prospectName: prospect.prospectName,
        sport: prospect.sport || "your sport",
        city: prospect.city || "your area",
        contactName: prospect.contactName || "unknown",
        services: req.body?.services,
      });

      const saved = await storage.createOutreachDraft({
        orgId: profile.organizationId,
        prospectId: prospect.id,
        subject: draft.subject,
        body: draft.body,
        approved: false,
      });

      await storage.logOutreachEvent({
        orgId: profile.organizationId,
        prospectId: prospect.id,
        draftId: saved.id,
        eventType: "draft_created",
        description: `Email draft generated for ${prospect.prospectName}`,
      });

      res.json(saved);
    } catch (err: any) {
      console.error("[TeamTraining GenerateEmail]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Enrich a lead's contact info via AI
  app.post("/api/team-training-leads/:id/enrich-contact", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const org = await storage.getOrganizationById(profile.organizationId);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const prospect = await storage.getTeamTrainingProspect(req.params.id);
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: "AI research is not configured", message: "Missing OPENAI_API_KEY on the server." });
      }

      const { enrichProspectContact } = await import("./team-training-prospecting");
      const enriched = await enrichProspectContact(
        org,
        prospect.prospectName,
        prospect.city || "unknown",
        prospect.state || "unknown",
        prospect.sport || "unknown",
        prospect.organizationType || "unknown"
      );

      // Compute new score incorporating the enriched contact quality
      const { scoreProspect } = await import("./team-training-prospecting");
      const newScore = scoreProspect({
        prospectName: prospect.prospectName,
        organizationType: prospect.organizationType || "unknown",
        sport: prospect.sport || "unknown",
        city: prospect.city || "unknown",
        state: prospect.state || "unknown",
        websiteUrl: prospect.websiteUrl || null,
        contactName: prospect.contactName || "unknown",
        contactRole: prospect.contactRole || "unknown",
        contactEmail: null,
        contactPhone: null,
        sourceUrl: prospect.sourceUrl || null,
        confidenceScore: prospect.confidenceScore || 50,
        notes: prospect.notes || "",
        ...enriched,
      });

      const updated = await storage.updateTeamTrainingProspect(prospect.id, {
        decisionMakerName: enriched.decisionMakerName,
        decisionMakerTitle: enriched.decisionMakerTitle,
        decisionMakerEmail: enriched.decisionMakerEmail,
        contactConfidence: enriched.contactConfidence,
        contactSourceUrl: enriched.contactSourceUrl,
        contactQuality: enriched.contactQuality,
        confidenceScore: newScore,
      });

      try {
        await storage.logOutreachEvent({
          orgId: profile.organizationId,
          prospectId: prospect.id,
          eventType: "contact_enriched",
          description: `Contact enriched for ${prospect.prospectName}: ${enriched.contactQuality} quality${enriched.decisionMakerName ? ` — ${enriched.decisionMakerName}` : ""}`,
          metadata: { contactQuality: enriched.contactQuality, decisionMakerName: enriched.decisionMakerName },
        });
      } catch (auditErr: any) {
        console.error("[TeamTraining EnrichContact] Audit log failed (non-fatal):", auditErr.message);
      }

      res.json({ prospect: updated, enriched });
    } catch (err: any) {
      console.error("[TeamTraining EnrichContact]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // AI Refine Draft
  app.post("/api/admin/team-training/drafts/:id/refine", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "AI is not configured — missing OPENAI_API_KEY" });
      }

      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft) return res.status(404).json({ message: "Draft not found" });

      const prospect = await storage.getTeamTrainingProspect(draft.prospectId);
      const org = await storage.getOrganizationById(profile.organizationId);

      const { instructions, currentSubject, currentBody } = req.body;
      if (!instructions?.trim()) return res.status(400).json({ message: "Instructions are required" });

      const contactQualityLabel =
        prospect?.contactQuality === "decision_maker" ? "Decision Maker" :
        prospect?.contactQuality === "role_based" ? "Role-Based Email" :
        prospect?.contactQuality === "general" ? "General Email" : "Unknown";

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const systemPrompt = `You are a professional outreach specialist for ${org?.name || "Efficiency Strength Training"}, a strength and conditioning business. You help refine outreach emails for team training partnerships with local schools, clubs, and athletic programs.

QUALITY RULES:
- Do NOT sound spammy or salesy
- Do NOT overpromise results
- Do NOT use fake urgency ("Act now!", "Limited time!")
- Do NOT make exaggerated performance claims
- Do NOT use generic "Dear Sir/Madam" if a real contact name is known
- DO use a confident, coach-to-coach, human tone
- DO be concise and locally-aware
- DO write professionally but conversationally

LEAD CONTEXT:
- Your business: ${org?.name || "Efficiency Strength Training"}
- Prospect organization: ${prospect?.prospectName || "Unknown"}
- Sport: ${prospect?.sport || "Unknown"}
- Location: ${prospect?.city || ""}${prospect?.state ? ", " + prospect.state : ""}
- Contact quality: ${contactQualityLabel}
- Contact name: ${prospect?.decisionMakerName || prospect?.contactName || "unknown"}
- Contact title: ${prospect?.decisionMakerTitle || prospect?.contactRole || "unknown"}

FREE DEMO INTELLIGENCE — if the user requests a free demo offer, choose what fits the sport naturally:
- Football / Basketball / Soccer: "free speed and agility assessment"
- Baseball / Softball: "free combine prep evaluation"
- Wrestling / Martial Arts: "free movement screening"
- Swimming / Track & Field / Cross Country: "free performance evaluation"
- Volleyball / Lacrosse / Cheer: "complimentary team session"
- General / Unknown: "introductory performance session"

Return ONLY valid JSON with this exact shape:
{
  "subject": "updated subject line",
  "body": "updated email body with proper line breaks",
  "explanation": "1-2 sentences describing what you changed and why"
}`;

      const userPrompt = `Here is the current email draft:

SUBJECT: ${currentSubject || draft.subject}

BODY:
${currentBody || draft.body}

---
USER INSTRUCTION: ${instructions}

Refine this email following the instruction above. Preserve the core message and meaning. Make it feel natural and human. Return the result as JSON.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 1200,
      });

      const raw = response.choices[0]?.message?.content || "{}";
      const result = JSON.parse(raw);

      if (!result.subject || !result.body) {
        return res.status(500).json({ message: "AI returned an incomplete response" });
      }

      res.json({
        subject: result.subject,
        body: result.body,
        explanation: result.explanation || "Email refined based on your instructions.",
      });
    } catch (err: any) {
      console.error("[TeamTraining RefineDraft]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Update draft (edit body/subject)
  app.patch("/api/admin/team-training/drafts/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const updated = await storage.updateOutreachDraft(req.params.id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Approve draft
  app.post("/api/admin/team-training/drafts/:id/approve", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft) return res.status(404).json({ message: "Draft not found" });

      const updated = await storage.updateOutreachDraft(req.params.id, {
        approved: true,
        approvedAt: new Date(),
      });

      await storage.logOutreachEvent({
        orgId: profile.organizationId,
        prospectId: draft.prospectId,
        draftId: draft.id,
        eventType: "approved",
        description: "Draft approved by admin",
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Send draft (after approval)
  app.post("/api/admin/team-training/drafts/:id/send", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft) return res.status(404).json({ message: "Draft not found" });
      if (!draft.approved) return res.status(400).json({ message: "Draft must be approved before sending" });
      if (draft.sentAt) return res.status(400).json({ message: "Draft already sent" });

      const prospect = await storage.getTeamTrainingProspect(draft.prospectId);
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });

      // Safety checks
      if (!prospect.contactEmail) {
        return res.status(400).json({ message: "Prospect has no email address. Please add one before sending." });
      }
      if (prospect.outreachStatus === "Do Not Contact") {
        return res.status(400).json({ message: "This prospect is marked Do Not Contact." });
      }
      const optedOut = await storage.isProspectOptedOut(profile.organizationId, prospect.contactEmail);
      if (optedOut) {
        return res.status(400).json({ message: "This prospect has opted out." });
      }
      if (!draft.body || draft.body.trim().length === 0) {
        return res.status(400).json({ message: "Email body is empty." });
      }

      // Cooldown check (7 days)
      if (prospect.lastContactedAt) {
        const cooldownDays = 7;
        const daysSince = (Date.now() - new Date(prospect.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < cooldownDays) {
          return res.status(400).json({ message: `Cooldown: last contacted ${Math.round(daysSince)} days ago (minimum ${cooldownDays} days).` });
        }
      }

      // Send via SendGrid (using the email module helper)
      const org = await storage.getOrganizationById(profile.organizationId);
      const branding = await getOrgBranding(profile.organizationId);
      const { sendTeamTrainingOutreachEmail } = await import("./email");

      try {
        await sendTeamTrainingOutreachEmail(
          prospect.contactEmail,
          draft.subject,
          draft.body,
          branding,
          draft.id,
        );
      } catch (sendErr: any) {
        console.error("[TeamTraining Send]", sendErr);
        await storage.logOutreachEvent({
          orgId: profile.organizationId,
          prospectId: prospect.id,
          draftId: draft.id,
          eventType: "failed",
          description: `Failed to send email: ${sendErr.message}`,
        });
        return res.status(500).json({ message: `Failed to send email: ${sendErr.message}` });
      }

      // Mark sent
      const manualSentAt = new Date();
      await storage.updateOutreachDraft(draft.id, { sentAt: manualSentAt });
      await storage.updateTeamTrainingProspect(prospect.id, {
        outreachStatus: "Contacted",
        lastContactedAt: manualSentAt,
      });
      await storage.logOutreachEvent({
        orgId: profile.organizationId,
        prospectId: prospect.id,
        draftId: draft.id,
        eventType: "sent",
        description: `Outreach email sent to ${prospect.contactEmail}`,
      });

      // Schedule follow-up sequence
      try {
        const { scheduleFollowUpsForDraft } = await import("./email-agent/follow-up-cron");
        await scheduleFollowUpsForDraft(profile.organizationId, draft.id, prospect.id, manualSentAt);
      } catch (fuErr: any) {
        console.warn("[ManualSend] follow-up scheduling error:", fuErr.message);
      }

      res.json({ ok: true, sentTo: prospect.contactEmail });
    } catch (err: any) {
      console.error("[TeamTraining Send]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Mark replied — accepts optional replyText + replyClassification (or auto-classify)
  app.post("/api/admin/team-training/prospects/:id/mark-replied", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const { replyText, replyClassification: manualClassification } = req.body ?? {};

      // AI-classify if text provided but no manual classification
      let classification = manualClassification ?? null;
      if (replyText && !classification) {
        try {
          const { classifyReply } = await import("./email-agent/reply-classifier");
          classification = await classifyReply(replyText);
        } catch {}
      }

      await storage.updateTeamTrainingProspect(req.params.id, { outreachStatus: "Replied" });

      // Set repliedAt + reply fields on the most recently sent draft
      const drafts = await storage.getOutreachDraftsByProspect(req.params.id);
      const sentDraft = drafts.find(d => !!d.sentAt && !d.repliedAt);
      if (sentDraft) {
        await storage.updateOutreachDraft(sentDraft.id, {
          repliedAt: new Date(),
          replyText: replyText ?? null,
          replyClassification: classification,
        });
        // Cancel pending follow-ups for this draft (prospect replied — stop sequence)
        await storage.cancelFollowUpSequence(sentDraft.id);
        // Update variant conversion stats
        if (sentDraft.messageVariantId) {
          const variant = await storage.getEmailMessageVariant(sentDraft.messageVariantId);
          if (variant) {
            await storage.updateEmailMessageVariant(variant.id, {
              replies: (variant.replies ?? 0) + 1,
              conversions: (variant.conversions ?? 0) + 1,
            });
          }
        }
      }

      await storage.logOutreachEvent({
        orgId: profile.organizationId,
        prospectId: req.params.id,
        eventType: "replied",
        description: classification
          ? `Marked as replied (${classification})${replyText ? " with reply text" : ""}`
          : "Marked as replied by admin",
        metadata: replyText ? { replyText: replyText.slice(0, 500), classification } : undefined,
      });
      // Revenue attribution: mark most recent AI action as "engaged"
      try {
        const { attributeOutcomeToProspect } = await import("./email-agent/revenue-outcome-engine");
        await attributeOutcomeToProspect(profile.organizationId, req.params.id, "engaged", 0, "reply");
      } catch {}

      // Phase 2: Auto-create deal when classification is interested or ask_info
      let dealCreated = false;
      if (classification === "interested" || classification === "ask_info") {
        const existingDeal = await storage.getTeamTrainingDealByProspect(req.params.id, profile.organizationId);
        if (!existingDeal) {
          const prospect = await storage.getTeamTrainingProspect(req.params.id);
          await storage.createTeamTrainingDeal({
            organizationId: profile.organizationId,
            prospectId: req.params.id,
            outreachDraftId: sentDraft?.id ?? null,
            status: "interested",
            estimatedValue: prospect?.estimatedValue ?? 0,
            probability: 40,
            nextAction: classification === "ask_info" ? "Send information and schedule a call" : "Schedule a discovery call",
            notes: replyText ? `Initial reply: ${replyText.slice(0, 300)}` : "",
            lastActivityAt: new Date(),
          });
          dealCreated = true;
        }
      }

      res.json({ ok: true, classification, dealCreated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Mark do not contact
  app.post("/api/admin/team-training/prospects/:id/do-not-contact", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const prospect = await storage.getTeamTrainingProspect(req.params.id);
      if (!prospect) return res.status(404).json({ message: "Not found" });
      await storage.updateTeamTrainingProspect(req.params.id, { outreachStatus: "Do Not Contact" });
      if (prospect.contactEmail) {
        await storage.addProspectOptOut(profile.organizationId, prospect.contactEmail, "Marked Do Not Contact by admin");
      }
      await storage.logOutreachEvent({
        orgId: profile.organizationId,
        prospectId: req.params.id,
        eventType: "marked_do_not_contact",
        description: "Marked as Do Not Contact by admin",
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Team Training Deals ──────────────────────────────────────────────────────

  app.get("/api/admin/team-training/deals", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const deals = await storage.getTeamTrainingDeals(profile.organizationId);
      res.json(deals);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/team-training/deals", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { prospectId, outreachDraftId, status, estimatedValue, probability, nextAction, notes } = req.body;
      if (!prospectId) return res.status(400).json({ message: "prospectId required" });
      // No duplicate deals per prospect
      const existing = await storage.getTeamTrainingDealByProspect(prospectId, profile.organizationId);
      if (existing) return res.status(409).json({ message: "Deal already exists for this prospect", deal: existing });
      const deal = await storage.createTeamTrainingDeal({
        organizationId: profile.organizationId,
        prospectId,
        outreachDraftId: outreachDraftId ?? null,
        status: status ?? "new",
        estimatedValue: estimatedValue ?? 0,
        probability: probability ?? 40,
        nextAction: nextAction ?? "",
        notes: notes ?? "",
        lastActivityAt: new Date(),
      });
      res.json(deal);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/team-training/deals/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const deal = await storage.getTeamTrainingDeal(req.params.id);
      if (!deal || deal.organizationId !== profile.organizationId) return res.status(404).json({ message: "Not found" });
      const prevStatus = deal.status;
      const updated = await storage.updateTeamTrainingDeal(req.params.id, req.body);
      // Phase 6: When deal marked "won", log outreach event and link to dashboard
      if (req.body.status === "won" && prevStatus !== "won") {
        await storage.logOutreachEvent({
          orgId: profile.organizationId,
          prospectId: deal.prospectId,
          draftId: deal.outreachDraftId ?? undefined,
          eventType: "replied",
          description: `Deal WON — ${updated?.finalValue ? `$${updated.finalValue}` : "value TBD"}`,
          metadata: { dealId: deal.id, finalValue: updated?.finalValue, source: "deal_pipeline" },
        });
        // Update prospect status
        await storage.updateTeamTrainingProspect(deal.prospectId, { outreachStatus: "Replied" });
        // Revenue attribution: link most recent AI action to this win
        try {
          const { attributeOutcomeToProspect } = await import("./email-agent/revenue-outcome-engine");
          const winValue = updated?.finalValue ?? updated?.estimatedValue ?? 0;
          await attributeOutcomeToProspect(profile.organizationId, deal.prospectId, "won", winValue, "deal_pipeline");
        } catch {}
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/team-training/deals/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const deal = await storage.getTeamTrainingDeal(req.params.id);
      if (!deal || deal.organizationId !== profile.organizationId) return res.status(404).json({ message: "Not found" });
      await storage.deleteTeamTrainingDeal(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // AI Close Assistant
  app.post("/api/admin/team-training/deals/:id/ai-action", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const deal = await storage.getTeamTrainingDeal(req.params.id);
      if (!deal || deal.organizationId !== profile.organizationId) return res.status(404).json({ message: "Not found" });
      const { action } = req.body;
      if (!["generate_response", "suggest_next_step", "create_proposal"].includes(action)) {
        return res.status(400).json({ message: "Invalid action" });
      }
      const prospect = await storage.getTeamTrainingProspect(deal.prospectId);
      const org = await storage.getOrganizationById(profile.organizationId);
      // Fetch latest reply text from drafts
      const drafts = await storage.getOutreachDraftsByProspect(deal.prospectId);
      const latestReply = drafts.find(d => !!d.replyText)?.replyText ?? null;
      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI();
      const contextBlock = `
Deal context:
- Team: ${prospect?.prospectName ?? "Unknown"}
- Sport: ${prospect?.sport ?? "Unknown"}
- Contact: ${prospect?.contactName ?? "Unknown"} (${prospect?.contactRole ?? "Unknown"})
- Email: ${prospect?.contactEmail ?? "N/A"}
- Deal status: ${deal.status}
- Estimated value: $${deal.estimatedValue}
- Probability: ${deal.probability}%
- Notes: ${deal.notes || "None"}
- Latest reply text: ${latestReply ?? "No reply yet"}
- Next action: ${deal.nextAction || "Not set"}
Business: ${org?.name ?? "Training Facility"}
`.trim();

      let systemPrompt = "";
      let userPrompt = "";

      if (action === "generate_response") {
        systemPrompt = "You are a sports business development expert helping a training facility respond to a prospect. Write a concise, warm, professional email response that moves the deal forward. Suggest pricing if relevant. Recommend call vs email clearly.";
        userPrompt = `${contextBlock}\n\nWrite the best email response to send right now. Be direct and compelling. Include a clear call to action. Keep it under 200 words.`;
      } else if (action === "suggest_next_step") {
        systemPrompt = "You are a sales coach specializing in sports training deals. Analyze the deal and provide a clear, actionable next step recommendation.";
        userPrompt = `${contextBlock}\n\nWhat is the single best next action for this deal right now? Should we call or email? What should we say? Be specific and concise (2-3 sentences max).`;
      } else if (action === "create_proposal") {
        systemPrompt = "You are a sports training business expert. Create a compelling, professional training proposal outline for a team training partnership.";
        userPrompt = `${contextBlock}\n\nCreate a concise team training proposal. Include: (1) Program overview, (2) Suggested pricing based on estimated value of $${deal.estimatedValue}, (3) What's included, (4) Call to action. Keep it professional and under 300 words.`;
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const result = completion.choices[0]?.message?.content?.trim() ?? "";
      res.json({ result, action });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Deal pipeline stats for agent context
  app.get("/api/admin/team-training/deals/pipeline-stats", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const stats = await storage.getDealPipelineStats(profile.organizationId);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get outreach events/audit log
  app.get("/api/admin/team-training/events", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const events = await storage.getOutreachEvents(profile.organizationId, req.query.prospectId as string | undefined);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Team pipeline summary for the scheduling agent dashboard
  app.get("/api/scheduling/team-pipeline-summary", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const orgId = profile.organizationId;

      const [allProspects, allDrafts] = await Promise.all([
        storage.getTeamTrainingProspects(orgId),
        storage.getOutreachDraftsByOrg(orgId),
      ]);

      const newLeads = allProspects.filter(p => p.outreachStatus === "New").length;
      const highConfidenceLeads = allProspects.filter(p =>
        (p.confidenceScore || 0) >= 75 &&
        p.outreachStatus !== "Do Not Contact" &&
        p.outreachStatus !== "Not Interested"
      ).length;
      const draftsAwaitingApproval = allDrafts.filter(d => !d.approved && !d.sentAt).length;
      const repliesNeedingFollowUp = allProspects.filter(p => p.outreachStatus === "Replied").length;
      const activePipelineCount = allProspects.filter(p =>
        p.outreachStatus !== "Do Not Contact" &&
        p.outreachStatus !== "Not Interested"
      ).length;
      const estimatedValuePerProspectCents = 75000;
      const estimatedPipelineValueCents = activePipelineCount * estimatedValuePerProspectCents;

      res.json({
        totalProspects: allProspects.length,
        newLeads,
        highConfidenceLeads,
        draftsAwaitingApproval,
        repliesNeedingFollowUp,
        activePipelineCount,
        estimatedPipelineValueCents,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Email Agent Tracking Routes (public, no auth) ─────────────────────────

  app.get("/api/email-agent/track-open/:emailId", async (req: any, res) => {
    try {
      const { emailId } = req.params;
      const draft = await storage.getOutreachDraft(emailId);
      if (draft && !draft.openedAt) {
        await storage.updateOutreachDraft(emailId, { openedAt: new Date() });
      }
    } catch (_) {}
    // Return 1x1 transparent GIF
    const pixel = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64"
    );
    res.set("Content-Type", "image/gif");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.end(pixel);
  });

  app.get("/api/email-agent/track-click/:emailId", async (req: any, res) => {
    try {
      const { emailId } = req.params;
      const { url } = req.query as { url?: string };
      const draft = await storage.getOutreachDraft(emailId);
      if (draft && !draft.clickedAt) {
        await storage.updateOutreachDraft(emailId, { clickedAt: new Date() });
        // Also update variant stats if linked
        if (draft.messageVariantId) {
          const variant = await storage.getEmailMessageVariant(draft.messageVariantId);
          if (variant) {
            await storage.updateEmailMessageVariant(variant.id, { timesUsed: (variant.timesUsed ?? 0) });
          }
        }
      }
      if (url) {
        return res.redirect(decodeURIComponent(url));
      }
      res.status(200).send("OK");
    } catch (_) {
      res.status(200).send("OK");
    }
  });

  // ─── Email Agent Routes ────────────────────────────────────────────────────

  app.get("/api/email-agent/settings", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const settings = await storage.getEmailAgentSettings(profile.organizationId);
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-agent/settings", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      await storage.saveEmailAgentSettings(profile.organizationId, req.body);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/email-agent/overview", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const overview = await storage.getEmailAgentOverview(profile.organizationId);
      res.json(overview);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/email-agent/queue", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const queue = await storage.getDailyQueueProspects(profile.organizationId);
      res.json(queue);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-agent/queue/build", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const settings = await storage.getEmailAgentSettings(profile.organizationId);
      const limit = settings.dailyLimit ?? 10;
      const queue = await storage.buildDailyOutreachQueue(profile.organizationId, limit);
      res.json({ count: queue.length, queue });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-agent/run-daily-job", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { runEmailAgentForOrg } = await import("./email-agent/scheduled-email-agent");
      const result = await runEmailAgentForOrg(profile.organizationId, "user_click");
      res.json(result);
    } catch (err: any) {
      console.error("[Email Agent Manual Run]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Email Agent Performance ───────────────────────────────────────────────

  app.get("/api/email-agent/performance", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const stats = await storage.getEmailPerformanceStats(profile.organizationId);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Email Message Variants CRUD ──────────────────────────────────────────

  app.get("/api/email-agent/variants", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const variants = await storage.getEmailMessageVariants(profile.organizationId);
      res.json(variants);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-agent/variants", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { name, subjectTemplate, bodyTemplate } = req.body;
      if (!name || !subjectTemplate || !bodyTemplate) return res.status(400).json({ message: "name, subjectTemplate, bodyTemplate required" });
      const variant = await storage.createEmailMessageVariant({ orgId: profile.organizationId, name, subjectTemplate, bodyTemplate });
      res.json(variant);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/email-agent/variants/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const variant = await storage.updateEmailMessageVariant(req.params.id, req.body);
      if (!variant) return res.status(404).json({ message: "Not found" });
      res.json(variant);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/email-agent/variants/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      await storage.deleteEmailMessageVariant(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-agent/variants/optimize", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      await storage.runVariantOptimization(profile.organizationId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Follow-Up Routes ──────────────────────────────────────────────────────

  app.get("/api/email-agent/follow-ups", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const followUps = await storage.getFollowUpsByOrg(profile.organizationId);
      res.json(followUps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/email-agent/follow-up-stats", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const stats = await storage.getFollowUpStats(profile.organizationId);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-agent/follow-ups/:id/cancel", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const followUp = await storage.getFollowUp(req.params.id);
      if (!followUp || followUp.orgId !== profile.organizationId) return res.status(404).json({ message: "Not found" });
      await storage.updateFollowUp(req.params.id, { status: "cancelled" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Cancel entire sequence for a draft
  app.post("/api/email-agent/follow-ups/cancel-sequence/:draftId", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      await storage.cancelFollowUpSequence(req.params.draftId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Manually run follow-up processing for this org
  app.post("/api/email-agent/follow-ups/run", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { processFollowUpsForOrg } = await import("./email-agent/follow-up-cron");
      const result = await processFollowUpsForOrg(profile.organizationId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Contextual Intelligence Routes ─────────────────────────────────────────

  // GET /api/email-agent/intelligence/overview — top signals across all prospects
  app.get("/api/email-agent/intelligence/overview", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { getIntelligenceOverview } = await import("./email-agent/contextual-intelligence");
      const overview = await getIntelligenceOverview(profile.organizationId);
      res.json(overview);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/email-agent/prospects/:id/intelligence — full context + NBA for one prospect
  app.get("/api/email-agent/prospects/:id/intelligence", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { buildProspectContext } = await import("./email-agent/contextual-intelligence");
      const ctx = await buildProspectContext(req.params.id, profile.organizationId);
      if (!ctx) return res.status(404).json({ message: "Prospect not found" });
      res.json(ctx);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/email-agent/auto-execute/run — trigger auto-execution of top eligible action
  app.post("/api/email-agent/auto-execute/run", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { runAutoExecution } = await import("./email-agent/auto-execution-engine");
      const result = await runAutoExecution(profile.organizationId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/email-agent/auto-execute/undo/:executionId — undo an auto-execution
  app.post("/api/email-agent/auto-execute/undo/:executionId", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { undoAutoExecution } = await import("./email-agent/auto-execution-engine");
      const result = await undoAutoExecution(profile.organizationId, req.params.executionId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/email-agent/auto-execute/log — get execution log + performance metrics (Phase 6)
  app.get("/api/email-agent/auto-execute/log", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { getExecutionLog, getAutoExecPerformanceMetrics } = await import("./email-agent/auto-execution-engine");
      const log = await getExecutionLog(profile.organizationId);
      const settings = await storage.getEmailAgentSettings(profile.organizationId);
      const metrics = getAutoExecPerformanceMetrics(log, settings);
      res.json({
        log: log.slice(-20).reverse(),
        todayCount: metrics.todayCount,
        maxPerDay: metrics.maxPerDay,
        successRate: metrics.successRate,
        engagementRate: metrics.engagementRate,
        revenuePerAction: metrics.revenuePerAction,
        totalExecuted: metrics.totalExecuted,
        totalSucceeded: metrics.totalSucceeded,
        enabled: settings.autoExecuteEnabled === true,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/email-agent/revenue-outcomes — AI-generated revenue stats + impact feed
  app.get("/api/email-agent/revenue-outcomes", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { getRevenueOutcomes } = await import("./email-agent/revenue-outcome-engine");
      const outcomes = await getRevenueOutcomes(profile.organizationId);
      res.json(outcomes);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/email-agent/audit — Phase 1 full health audit
  app.get("/api/email-agent/audit", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { runEmailAgentAudit } = await import("./email-agent/audit-engine");
      const report = await runEmailAgentAudit(profile.organizationId);
      res.json(report);
    } catch (err: any) {
      console.error("[Email Agent Audit]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/email-agent/trigger-audit — Trigger audit summary
  app.get("/api/email-agent/trigger-audit", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const windowHours = req.query.window ? parseInt(req.query.window as string, 10) : 24;
      const triggerType = req.query.trigger_type as string | undefined;
      const actionType = req.query.action_type as string | undefined;

      let summary;
      if (triggerType || actionType) {
        // Filtered events
        const events = await storage.getEmailTriggerEvents(profile.organizationId, {
          sinceHours: windowHours,
          triggerType,
          actionType,
          limit: 500,
        });
        summary = await storage.getTriggerAuditSummary(profile.organizationId, windowHours);
        // Override events with filtered version
        summary.events = events;
      } else {
        summary = await storage.getTriggerAuditSummary(profile.organizationId, windowHours);
      }

      res.json(summary);
    } catch (err: any) {
      console.error("[Trigger Audit]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/email-agent/trigger-alerts — proactive system warnings
  app.get("/api/email-agent/trigger-alerts", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { computeTriggerAlerts } = await import("./email-agent/trigger-alerts");
      const result = await computeTriggerAlerts(profile.organizationId);
      res.json(result);
    } catch (err: any) {
      console.error("[Trigger Alerts]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/email-agent/trigger-audit/prospect/:prospectId — trace for a specific prospect
  app.get("/api/email-agent/trigger-audit/prospect/:prospectId", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const events = await storage.getEmailTriggerEvents(profile.organizationId, {
        prospectId: req.params.prospectId,
        limit: 100,
      });

      const executed = events.filter((e) => e.wasExecuted);
      const blocked = events.filter((e) => e.executionBlocked);
      const blockReasonCounts: Record<string, number> = {};
      for (const e of blocked) {
        if (e.blockReason) blockReasonCounts[e.blockReason] = (blockReasonCounts[e.blockReason] || 0) + 1;
      }

      res.json({
        prospectId: req.params.prospectId,
        totalEvaluated: events.length,
        totalExecuted: executed.length,
        totalBlocked: blocked.length,
        blockReasons: Object.entries(blockReasonCounts).map(([r, c]) => ({ reason: r, count: c })),
        events,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/email-agent/intelligence/global-priority — unified priority engine
  app.get("/api/email-agent/intelligence/global-priority", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { buildGlobalActionQueue } = await import("./email-agent/global-priority-engine");
      const queue = await buildGlobalActionQueue(profile.organizationId);
      res.json(queue);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/email-agent/deals/:id/intelligence — deal-specific intelligence
  app.get("/api/email-agent/deals/:id/intelligence", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const deal = await storage.getTeamTrainingDeal(req.params.id);
      if (!deal || deal.organizationId !== profile.organizationId) return res.status(404).json({ message: "Deal not found" });
      const prospect = await storage.getTeamTrainingProspect(deal.prospectId);
      const { getDealIntelligence } = await import("./email-agent/contextual-intelligence");
      const intel = getDealIntelligence(deal, prospect);
      res.json({ deal, prospect, intelligence: intel });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const { initializeScheduledEmailAgent } = await import("./email-agent/scheduled-email-agent");
  initializeScheduledEmailAgent();

  const { initializeFollowUpCron } = await import("./email-agent/follow-up-cron");
  initializeFollowUpCron();

  startWeeklyReminderJob();
  startSessionReminderJob();

  return httpServer;
}
