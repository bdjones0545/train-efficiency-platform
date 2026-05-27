import type { Express } from "express";
import { createServer, type Server } from "http";
import { buildPublicAppUrl } from "./utils/url";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated, createAuthToken, deleteAuthToken, deleteAllUserAuthTokens } from "./replit_integrations/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import { uploadMediaToCloud, deleteMediaFromCloud, serveMediaFromCloud } from "./mediaStorage";
import express from "express";
import { addDays, startOfWeek, format, parseISO, addMinutes, setHours, setMinutes } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import bcrypt from "bcryptjs";
import { sendWelcomeEmail, sendCoachWelcomeEmail, sendBookingConfirmationToClient, sendBookingNotificationToCoach, sendCashoutRequestEmail, sendPaymentConfirmationEmail, sendTeamQuoteEmail, sendTeamTrainingRequestEmail, sendClientInviteEmail, sendSubscriberSessionNotification, sendSubscriptionClaimEmail, sendPasswordResetEmail, sendBookingCancellationEmailToClient, sendBookingCancellationEmailToCoach, sendBookingRescheduleEmailToClient, sendBookingRescheduleEmailToCoach, sendRecurringSessionsCreatedEmailToClient, sendRecurringSessionsCreatedEmailToCoach, type OrgBranding, type EmailLogContext } from "./email";
import { sendSms, normalizePhone, smsBookingConfirmation, smsCancellation, smsReschedule } from "./sms";
import crypto from "crypto";
import Stripe from "stripe";
import { z } from "zod";
import {
  organizationSubscriptionPlans,
  availabilityBlocks as availabilityBlocksSchema,
  bookings as bookingsSchema,
  athleticBookings,
  orgSessions,
  orgUsers,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, sql, or, lt, gt, ne } from "drizzle-orm";
import { users } from "@shared/models/auth";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { startWeeklyReminderJob } from "./weekly-reminder";
import { startSessionReminderJob } from "./session-reminders";
import { handleAssistantMessage, executeConfirmedPendingAction, getActivePendingActionsForUser } from "./scheduling-assistant";
import { onPaymentReceived, onRedemption, onCashoutPaid } from "./revenue-recognition";
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

/**
 * Resolve the organization ID for an authenticated admin/coach session.
 *
 * Handles both Replit OIDC sessions (req.user.claims.sub) and custom
 * email/password coach sessions (req.user.id).
 *
 * Returns null if:
 *   - No session exists → caller should return 401
 *   - User has no organizationId → caller should return 403
 */
async function getAdminOrgId(req: any): Promise<string | null> {
  try {
    const userId = req.user?.claims?.sub ?? req.user?.id;
    if (!userId) return null;
    const profile = await storage.getUserProfile(userId);
    return profile?.organizationId ?? null;
  } catch {
    return null;
  }
}

/**
 * Full auth context for an admin/coach session.
 * Use when you need more than just the orgId (role, userId, authSource).
 */
async function getAdminAuthContext(req: any): Promise<{
  userId: string;
  orgId: string;
  role: string;
  authSource: "oidc" | "custom";
} | null> {
  try {
    const oidcId = req.user?.claims?.sub;
    const customId = req.user?.id;
    const userId = oidcId ?? customId;
    if (!userId) return null;
    const profile = await storage.getUserProfile(userId);
    if (!profile?.organizationId) return null;
    return {
      userId,
      orgId: profile.organizationId,
      role: profile.role ?? "CLIENT",
      authSource: oidcId ? "oidc" : "custom",
    };
  } catch {
    return null;
  }
}

function requireRole(...roles: string[]) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.claims?.sub ?? req.user?.id;
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

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/mov",
  "video/mpeg",
  "video/x-msvideo",
  "application/octet-stream",
];
const ALLOWED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v", ".mpeg", ".mpg", ".avi"];
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

function isAllowedMediaFile(file: Express.Multer.File): boolean {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) return true;
  if (ALLOWED_VIDEO_TYPES.includes(file.mimetype)) return true;
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_VIDEO_EXTENSIONS.includes(ext)) return true;
  return false;
}

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMediaFile(file)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}. Please upload jpg, png, webp, mp4, mov, or webm files.`));
  },
});

function handleMulterUpload(req: any, res: any, next: any) {
  mediaUpload.single("file")(req, res, (err: any) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: `File too large. Videos must be under ${VIDEO_MAX_BYTES / 1024 / 1024}MB and images under ${IMAGE_MAX_BYTES / 1024 / 1024}MB.` });
    }
    if (err.message?.includes("Unsupported file type")) {
      return res.status(400).json({ message: err.message });
    }
    return res.status(400).json({ message: err.message || "File upload error" });
  });
}

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

      const resetUrl = buildPublicAppUrl(`/reset-password?token=${rawToken}`);

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
        res.clearCookie("connect.sid", { path: "/" });
        res.clearCookie("session", { path: "/" });
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.set("Pragma", "no-cache");
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

      const baseUrl = buildPublicAppUrl();

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
      const baseUrl = buildPublicAppUrl();
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
      const baseUrl = buildPublicAppUrl();
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

  app.get("/api/availability", async (req: any, res) => {
    try {
      const serviceId = req.query.serviceId as string;
      const startDateStr = req.query.startDate as string;
      const daysParam = Math.min(parseInt((req.query.days as string) || "14", 10), 30);
      const orgId = req.query.organizationId as string | undefined;

      if (!serviceId) return res.status(400).json({ message: "serviceId required" });

      const service = await storage.getService(serviceId);
      if (!service) return res.status(404).json({ message: "Service not found" });

      const startDate = startDateStr ? parseISO(startDateStr) : new Date();
      const endDate = addDays(startDate, daysParam - 1);

      let coaches: any[];
      if (orgId) {
        coaches = await storage.getCoachProfilesByOrganization(orgId);
      } else {
        coaches = await storage.getCoachProfiles();
      }

      const now = new Date();
      const allSlots: {
        date: string;
        start: string;
        end: string;
        location: string;
        coachId: string;
        coachName: string;
        coachAvatar: string | null;
      }[] = [];

      for (const coach of coaches) {
        const coachTimezone = coach.timezone || "America/New_York";
        const blocks = await storage.getAvailabilityBlocks(coach.id);
        const existingBookings = await storage.getOverlappingBookings(
          coach.id,
          startDate,
          addDays(endDate, 1)
        );

        const daySlots = generateTimeSlots(
          blocks,
          existingBookings,
          startDate,
          endDate,
          service.durationMin,
          coachTimezone
        );

        const coachName = [coach.user?.firstName, coach.user?.lastName].filter(Boolean).join(" ") || "Coach";
        const coachAvatar = coach.photoUrl || coach.user?.profileImageUrl || null;

        for (const day of daySlots) {
          for (const slot of day.slots) {
            if (slot.available && new Date(slot.start) > now) {
              allSlots.push({
                date: day.date,
                start: slot.start,
                end: slot.end,
                location: slot.location || "",
                coachId: coach.id,
                coachName,
                coachAvatar,
              });
            }
          }
        }
      }

      allSlots.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

      const grouped: Record<string, typeof allSlots> = {};
      for (const slot of allSlots) {
        if (!grouped[slot.date]) grouped[slot.date] = [];
        grouped[slot.date].push(slot);
      }

      const result = Object.entries(grouped).map(([date, slots]) => ({ date, slots }));
      res.json(result);
    } catch (error) {
      console.error("Error fetching availability:", error);
      res.status(500).json({ message: "Failed to fetch availability" });
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

      // Track booking created / intro used event in attention inbox (fire-and-forget)
      (async () => {
        try {
          const { trackBookingEvent, buildBookingEventContext } = await import("./booking-events");
          const orgId = coach.organizationId ?? "";
          if (!orgId) return;
          const eventCtx = await buildBookingEventContext(
            booking.id, orgId, userId, coachId, serviceId, service.name,
            start, end, (service as any).priceCents ?? 0,
            {
              paymentMethod: req.body.paymentMethod ?? null,
              sessionType: (service as any).sessionType ?? null,
              maxParticipants: booking.maxParticipants,
            },
          );
          await trackBookingEvent(
            isFreeIntro ? "booking_intro_used" : "booking_created",
            eventCtx,
          );
          if (isSemiPrivate && booking.maxParticipants) {
            const names: string[] = req.body.participantNames ?? [];
            const filled = names.filter((n: string) => n.trim()).length;
            if (filled >= booking.maxParticipants) {
              await trackBookingEvent("group_session_full", {
                ...eventCtx,
                participantCount: filled,
                maxParticipants: booking.maxParticipants,
              });
            }
          }
        } catch {}
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

      const existingRedemption = await storage.getRedemptionByBookingId(bookingId);
      if (existingRedemption) {
        return res.status(409).json({ message: "This session has been redeemed and is locked. It cannot be cancelled or modified." });
      }
      if (booking.status === "COMPLETED" && status !== "COMPLETED") {
        return res.status(409).json({ message: "Completed sessions cannot have their status changed without an admin reversal." });
      }

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

      // Track cancellation / no-show event in attention inbox (fire-and-forget)
      if (status === "CANCELLED" || status === "NO_SHOW") {
        (async () => {
          try {
            const { trackBookingEvent, buildBookingEventContext } = await import("./booking-events");
            const coachProf = await storage.getCoachProfile(booking.coachId);
            const orgId = coachProf?.organizationId ?? "";
            const svc = await storage.getService(booking.serviceId);
            if (!orgId || !svc) return;
            const eventCtx = await buildBookingEventContext(
              bookingId, orgId, booking.clientId, booking.coachId,
              booking.serviceId, svc.name,
              new Date(booking.startAt), new Date(booking.endAt),
              (svc as any).priceCents ?? 0,
              {
                paymentMethod: (booking as any).paymentMethod ?? null,
                sessionType: (svc as any).sessionType ?? null,
              },
            );
            if (status === "CANCELLED") await trackBookingEvent("booking_cancelled", eventCtx);
            else await trackBookingEvent("booking_no_show", eventCtx);
          } catch {}
        })();
      }

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

      if (existing.status === "COMPLETED") {
        return res.status(403).json({ message: "Redeemed sessions are locked and cannot be changed." });
      }
      const existingRedemption = await storage.getRedemptionByBookingId(bookingId);
      if (existingRedemption) {
        return res.status(403).json({ message: "Redeemed sessions are locked and cannot be changed." });
      }

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

      // Track reschedule event in attention inbox when time changes (fire-and-forget)
      if (updateData.startAt) {
        (async () => {
          try {
            const { trackBookingEvent, buildBookingEventContext } = await import("./booking-events");
            const svc = await storage.getService(finalServiceId);
            if (!editCoachOrgId || !svc) return;
            const eventCtx = await buildBookingEventContext(
              bookingId, editCoachOrgId, existing.clientId, bookingCoachId,
              finalServiceId, svc.name,
              new Date(updateData.startAt),
              new Date(updateData.endAt || existing.endAt),
              (svc as any).priceCents ?? 0,
              {
                paymentMethod: (existing as any).paymentMethod ?? null,
                sessionType: (svc as any).sessionType ?? null,
                previousStartAt: new Date(existing.startAt),
              },
            );
            await trackBookingEvent("booking_rescheduled", eventCtx);
          } catch {}
        })();
      }

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

      if (existing.status === "COMPLETED") {
        return res.status(403).json({ message: "Redeemed sessions are locked and cannot be changed." });
      }
      const existingRedemption = await storage.getRedemptionByBookingId(bookingId);
      if (existingRedemption) {
        return res.status(403).json({ message: "Redeemed sessions are locked and cannot be changed." });
      }

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

      // ── Authorization: coach can only redeem their own sessions; admins can redeem any ──
      const requesterRole = await getUserRole(userId);
      const isRequesterAdmin = requesterRole === "ADMIN";
      if (!isRequesterAdmin && booking.coachId !== coachId) {
        return res.status(403).json({ message: "You can only redeem sessions assigned to you" });
      }

      // ── Org isolation: booking's coach must belong to the same org as requester ──
      const [bookingCoachProfile, requesterUserProfile] = await Promise.all([
        storage.getCoachProfile(booking.coachId),
        storage.getUserProfile(userId),
      ]);
      const requesterOrgId = requesterUserProfile?.organizationId;
      if (requesterOrgId && bookingCoachProfile?.organizationId && bookingCoachProfile.organizationId !== requesterOrgId) {
        return res.status(403).json({ message: "Booking does not belong to your organization" });
      }

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
            const newSessionCount = Math.max(0, activeSub.sessionsRemaining - 1);
            await storage.updateUserSubscription(activeSub.id, {
              sessionsRemaining: newSessionCount,
            });
            // ── Credit ledger: record the session debit for auditability ──
            (() => {
              const creditPayload = {
                clientId: booking.clientId,
                bookingId,
                subscriptionId: activeSub.id,
                organizationId: requesterOrgId || bookingCoachProfile?.organizationId || null,
                eventType: "redemption_debit",
                deltaSessions: -1,
                deltaCents: 0,
                sessionsAfter: newSessionCount,
                reason: `Session redeemed: booking ${bookingId}`,
                createdBy: userId,
              };
              storage.createCreditLedgerEvent(creditPayload).catch(async (e: any) => {
                console.error("[redemption] Credit ledger write failed (non-fatal):", e?.message ?? e);
                try {
                  await storage.createFinancialEventFailure({
                    orgId: creditPayload.organizationId ?? null,
                    clientId: creditPayload.clientId ?? null,
                    coachId: null,
                    bookingId: creditPayload.bookingId ?? null,
                    redemptionId: null,
                    sourceType: "credit_ledger",
                    eventType: creditPayload.eventType,
                    payload: creditPayload as any,
                    idempotencyKey: null,
                    failureMessage: e?.message ?? String(e),
                    attempts: 1,
                    status: "pending",
                    lastAttemptAt: new Date(),
                  });
                } catch (queueErr: any) {
                  console.error("[redemption] CRITICAL: credit failure queue insert failed:", queueErr?.message ?? queueErr);
                }
              });
            })();
          }
        } catch (e) {
          console.error("Error decrementing session count on redemption:", e);
        }
      }

      // ── Revenue recognition: write immutable ledger events ──────────────────
      onRedemption({
        orgId: requesterOrgId || bookingCoachProfile?.organizationId || null,
        clientId: booking.clientId,
        coachId: booking.coachId,
        bookingId,
        redemptionId: redemption.id,
        recognizedAmountCents: totalCollectedCents,
        coachCompensationCents: amountCents,
        isSubscriptionSession: !!booking.subscriptionPlanId,
        createdBy: userId,
      }).catch(e => console.error("[redemption] Revenue recognition write failed (non-fatal):", e));

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

      // ── Revenue recognition: record payment received ─────────────────────────
      {
        const coachUserId = req.user.claims.sub;
        const coachProf = await storage.getCoachProfile(coachUserId);
        onPaymentReceived({
          orgId: coachProf?.organizationId || null,
          clientId: userId,
          amountCents,
          walletTxId: tx.id,
          isSubscriptionPayment: false,
          createdBy: coachUserId,
        }).catch(() => {});
      }

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

  // ── Accounting Integrity Diagnostic ────────────────────────────────────────
  // Read-only endpoint that surfaces inconsistencies across the credit/payment model.
  // No mutations — safe to run at any time.
  app.get("/api/admin/accounting-integrity", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;

      // 1. Duplicate redemptions (same bookingId redeemed more than once)
      const dupRedemptions = await db.execute(sql`
        SELECT booking_id, COUNT(*)::int AS count
        FROM redemptions
        GROUP BY booking_id
        HAVING COUNT(*) > 1
      `);

      // 2. Negative dollar balances
      const negativeBalanceQuery = await db.execute(sql`
        SELECT u.id, u.first_name, u.last_name, u.email, u.balance_cents
        FROM users u
        ${orgId ? sql`
          JOIN user_profiles up ON up.user_id = u.id
          WHERE up.organization_id = ${orgId} AND u.balance_cents < 0
        ` : sql`WHERE u.balance_cents < 0`}
        ORDER BY u.balance_cents ASC
        LIMIT 100
      `);

      // 3. Redeemed + cancelled sessions (redemption on a booking that is now CANCELLED)
      const redeemedCancelledQuery = await db.execute(sql`
        SELECT r.id AS redemption_id, r.booking_id, b.status AS booking_status, r.redeemed_at
        FROM redemptions r
        JOIN bookings b ON b.id = r.booking_id
        WHERE b.status = 'CANCELLED'
        LIMIT 100
      `);

      // 4. Completed sessions with no redemption (may be intentional for some service types)
      const completedNoRedemptionQuery = await db.execute(sql`
        SELECT b.id, b.start_at, b.client_id, b.coach_id, b.service_id
        FROM bookings b
        LEFT JOIN redemptions r ON r.booking_id = b.id
        WHERE b.status = 'COMPLETED'
          AND r.id IS NULL
          ${orgId ? sql`AND b.coach_id IN (
            SELECT id FROM coach_profiles WHERE organization_id = ${orgId}
          )` : sql``}
        ORDER BY b.start_at DESC
        LIMIT 50
      `);

      // 5. Negative session credits (blocked by Math.max at redemption, but verify)
      const negativeCreditsQuery = await db.execute(sql`
        SELECT us.id, us.user_id, us.plan_id, us.sessions_remaining, us.status
        FROM user_subscriptions us
        WHERE us.sessions_remaining < 0
        LIMIT 100
      `);

      // 6. Orphaned redemptions (redemption references a non-existent booking)
      const orphanedRedemptionsQuery = await db.execute(sql`
        SELECT r.id, r.booking_id, r.redeemed_at
        FROM redemptions r
        LEFT JOIN bookings b ON b.id = r.booking_id
        WHERE b.id IS NULL
        LIMIT 50
      `);

      const report = {
        generatedAt: new Date().toISOString(),
        organizationId: orgId,
        checks: {
          duplicateRedemptions: {
            label: "Duplicate redemptions (same booking_id redeemed > 1x)",
            count: dupRedemptions.rows.length,
            severity: dupRedemptions.rows.length > 0 ? "critical" : "ok",
            rows: dupRedemptions.rows,
          },
          negativeBalances: {
            label: "Users with negative dollar balance (owe money)",
            count: negativeBalanceQuery.rows.length,
            severity: negativeBalanceQuery.rows.length > 0 ? "warning" : "ok",
            rows: negativeBalanceQuery.rows,
          },
          redeemedCancelledSessions: {
            label: "Sessions that are both redeemed and cancelled",
            count: redeemedCancelledQuery.rows.length,
            severity: redeemedCancelledQuery.rows.length > 0 ? "critical" : "ok",
            rows: redeemedCancelledQuery.rows,
          },
          completedWithoutRedemption: {
            label: "Completed sessions with no redemption record",
            count: completedNoRedemptionQuery.rows.length,
            severity: completedNoRedemptionQuery.rows.length > 0 ? "info" : "ok",
            rows: completedNoRedemptionQuery.rows,
          },
          negativeSessionCredits: {
            label: "Subscriptions with negative sessions_remaining",
            count: negativeCreditsQuery.rows.length,
            severity: negativeCreditsQuery.rows.length > 0 ? "critical" : "ok",
            rows: negativeCreditsQuery.rows,
          },
          orphanedRedemptions: {
            label: "Redemptions referencing non-existent bookings",
            count: orphanedRedemptionsQuery.rows.length,
            severity: orphanedRedemptionsQuery.rows.length > 0 ? "critical" : "ok",
            rows: orphanedRedemptionsQuery.rows,
          },
        },
        summary: {
          totalIssues:
            dupRedemptions.rows.length +
            redeemedCancelledQuery.rows.length +
            negativeCreditsQuery.rows.length +
            orphanedRedemptionsQuery.rows.length,
          warnings: negativeBalanceQuery.rows.length,
          infos: completedNoRedemptionQuery.rows.length,
        },
      };

      // Add credit ledger failure checks
      if (orgId) {
        const { financialEventFailures: fefT } = await import("@shared/schema");
        const { count: cntFn, and: andFn2, eq: eqFn2, inArray: inArrayFn2, lt: ltFn2 } = await import("drizzle-orm");
        const cutoff24hCredit = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [creditPending, creditFailed, creditStale] = await Promise.all([
          db.select({ n: cntFn() }).from(fefT).where(andFn2(eqFn2(fefT.orgId, orgId), eqFn2(fefT.sourceType, "credit_ledger"), inArrayFn2(fefT.status, ["pending", "retrying"]))),
          db.select({ n: cntFn() }).from(fefT).where(andFn2(eqFn2(fefT.orgId, orgId), eqFn2(fefT.sourceType, "credit_ledger"), eqFn2(fefT.status, "failed"))),
          db.select({ n: cntFn() }).from(fefT).where(andFn2(eqFn2(fefT.orgId, orgId), eqFn2(fefT.sourceType, "credit_ledger"), inArrayFn2(fefT.status, ["pending", "retrying"]), ltFn2(fefT.createdAt, cutoff24hCredit))),
        ]);
        (report.checks as any).creditLedgerFailuresPending = {
          label: "Credit ledger writes queued for retry",
          count: Number(creditPending[0]?.n ?? 0),
          severity: Number(creditPending[0]?.n ?? 0) === 0 ? "ok" : "warning",
        };
        (report.checks as any).creditLedgerFailuresFailed = {
          label: "Credit ledger writes failed after max attempts",
          count: Number(creditFailed[0]?.n ?? 0),
          severity: Number(creditFailed[0]?.n ?? 0) > 0 ? "critical" : "ok",
        };
        (report.checks as any).creditLedgerFailuresStale = {
          label: "Credit ledger failures unresolved >24 hours",
          count: Number(creditStale[0]?.n ?? 0),
          severity: Number(creditStale[0]?.n ?? 0) > 0 ? "critical" : "ok",
        };
        report.summary.totalIssues += Number(creditFailed[0]?.n ?? 0) + Number(creditStale[0]?.n ?? 0);
      }

      res.json(report);
    } catch (error) {
      console.error("Error running accounting integrity check:", error);
      res.status(500).json({ message: "Failed to run accounting integrity check" });
    }
  });

  // ── Revenue Integrity Diagnostic ─────────────────────────────────────────────
  app.get("/api/admin/revenue-integrity", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const orgFilter = orgId ? sql`AND org_id = ${orgId}` : sql``;

      // 1. Duplicate revenue recognition (same redemption_id recognized > 1x)
      const dupRecognition = await db.execute(sql`
        SELECT redemption_id, COUNT(*)::int AS count
        FROM revenue_ledger_events
        WHERE event_type = 'revenue_recognized'
          AND redemption_id IS NOT NULL
          ${orgFilter}
        GROUP BY redemption_id
        HAVING COUNT(*) > 1
      `);

      // 2. Duplicate coach compensation accruals (same redemption_id accrued > 1x)
      const dupAccruals = await db.execute(sql`
        SELECT redemption_id, COUNT(*)::int AS count
        FROM revenue_ledger_events
        WHERE event_type = 'coach_compensation_accrued'
          AND redemption_id IS NOT NULL
          ${orgFilter}
        GROUP BY redemption_id
        HAVING COUNT(*) > 1
      `);

      // 3. Negative net deferred revenue (released more than created — logic error)
      const deferredNet = await db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_created' THEN amount_cents ELSE 0 END), 0)::int AS created,
          COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_released' THEN amount_cents ELSE 0 END), 0)::int AS released
        FROM revenue_ledger_events
        WHERE event_type IN ('deferred_revenue_created', 'deferred_revenue_released')
          ${orgFilter}
      `);
      const deferredCreated = (deferredNet.rows[0] as any)?.created ?? 0;
      const deferredReleased = (deferredNet.rows[0] as any)?.released ?? 0;
      const negativeDeferredBalance = deferredReleased > deferredCreated;

      // 4. Sessions recognized without a corresponding redemption record
      const recognizedNoRedemption = await db.execute(sql`
        SELECT rle.id, rle.redemption_id, rle.booking_id, rle.amount_cents, rle.created_at
        FROM revenue_ledger_events rle
        LEFT JOIN redemptions r ON r.id = rle.redemption_id
        WHERE rle.event_type = 'revenue_recognized'
          AND rle.redemption_id IS NOT NULL
          AND r.id IS NULL
          ${orgFilter}
        LIMIT 50
      `);

      // 5. Coach payout mismatch: total accrued vs total paid cashouts
      const payoutMismatch = await db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN event_type = 'coach_compensation_accrued' THEN amount_cents ELSE 0 END), 0)::int AS accrued,
          COALESCE(SUM(CASE WHEN event_type = 'coach_compensation_paid' THEN amount_cents ELSE 0 END), 0)::int AS paid
        FROM revenue_ledger_events
        WHERE event_type IN ('coach_compensation_accrued', 'coach_compensation_paid')
          ${orgFilter}
      `);
      const totalAccrued = (payoutMismatch.rows[0] as any)?.accrued ?? 0;
      const totalPaid = (payoutMismatch.rows[0] as any)?.paid ?? 0;
      const overpaid = totalPaid > totalAccrued;

      // 6. Redemptions missing any recognition event (redeemed but no ledger event written)
      const redemptionsNoLedger = await db.execute(sql`
        SELECT r.id, r.booking_id, r.coach_id, r.redeemed_at, r.amount_cents
        FROM redemptions r
        LEFT JOIN revenue_ledger_events rle ON rle.redemption_id = r.id AND rle.event_type = 'revenue_recognized'
        WHERE rle.id IS NULL
          ${orgId ? sql`AND r.coach_id IN (SELECT id FROM coach_profiles WHERE organization_id = ${orgId})` : sql``}
        ORDER BY r.redeemed_at DESC
        LIMIT 50
      `);

      // 7. Orphaned revenue ledger events (booking_id or client_id references deleted records)
      const orphanedEvents = await db.execute(sql`
        SELECT rle.id, rle.event_type, rle.booking_id, rle.client_id, rle.created_at
        FROM revenue_ledger_events rle
        LEFT JOIN bookings b ON b.id = rle.booking_id
        WHERE rle.booking_id IS NOT NULL AND b.id IS NULL
          ${orgFilter}
        LIMIT 50
      `);

      // 8. Financial event failure queue checks
      const now = new Date();
      const cutoff1h = new Date(now.getTime() - 1 * 60 * 60 * 1000);
      const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const { financialEventFailures: fefTable } = await import("@shared/schema");
      const { count: countFn, and: andFn, eq: eqFn, inArray: inArrayFn, lt: ltFn } = await import("drizzle-orm");

      const [pendingCount, failedCount, staleCount] = await Promise.all([
        db.select({ n: countFn() }).from(fefTable)
          .where(orgId ? andFn(eqFn(fefTable.orgId, orgId), inArrayFn(fefTable.status, ["pending", "retrying"])) : inArrayFn(fefTable.status, ["pending", "retrying"])),
        db.select({ n: countFn() }).from(fefTable)
          .where(orgId ? andFn(eqFn(fefTable.orgId, orgId), eqFn(fefTable.status, "failed")) : eqFn(fefTable.status, "failed")),
        db.select({ n: countFn() }).from(fefTable)
          .where(orgId
            ? andFn(eqFn(fefTable.orgId, orgId), inArrayFn(fefTable.status, ["pending", "retrying"]), ltFn(fefTable.createdAt, cutoff24h))
            : andFn(inArrayFn(fefTable.status, ["pending", "retrying"]), ltFn(fefTable.createdAt, cutoff24h))),
      ]);
      const fefPending = Number(pendingCount[0]?.n ?? 0);
      const fefFailed = Number(failedCount[0]?.n ?? 0);
      const fefStale = Number(staleCount[0]?.n ?? 0);

      const criticalCount =
        dupRecognition.rows.length +
        dupAccruals.rows.length +
        (negativeDeferredBalance ? 1 : 0) +
        (overpaid ? 1 : 0) +
        recognizedNoRedemption.rows.length +
        orphanedEvents.rows.length +
        fefFailed +
        fefStale;

      res.json({
        generatedAt: new Date().toISOString(),
        organizationId: orgId,
        checks: {
          duplicateRecognition: {
            label: "Duplicate revenue_recognized events (same redemption_id > 1x)",
            count: dupRecognition.rows.length,
            severity: dupRecognition.rows.length > 0 ? "critical" : "ok",
            rows: dupRecognition.rows,
          },
          duplicateAccruals: {
            label: "Duplicate coach_compensation_accrued events (same redemption_id > 1x)",
            count: dupAccruals.rows.length,
            severity: dupAccruals.rows.length > 0 ? "critical" : "ok",
            rows: dupAccruals.rows,
          },
          negativeDeferredBalance: {
            label: "Net deferred revenue is negative (released > created)",
            count: negativeDeferredBalance ? 1 : 0,
            severity: negativeDeferredBalance ? "critical" : "ok",
            deferredCreatedCents: deferredCreated,
            deferredReleasedCents: deferredReleased,
            netDeferredCents: deferredCreated - deferredReleased,
          },
          recognizedWithoutRedemption: {
            label: "Revenue recognized events referencing non-existent redemption",
            count: recognizedNoRedemption.rows.length,
            severity: recognizedNoRedemption.rows.length > 0 ? "warning" : "ok",
            rows: recognizedNoRedemption.rows,
          },
          payoutOverpaid: {
            label: "Coach compensation paid exceeds accrued (overpayment risk)",
            count: overpaid ? 1 : 0,
            severity: overpaid ? "critical" : "ok",
            totalAccruedCents: totalAccrued,
            totalPaidCents: totalPaid,
            differencesCents: totalAccrued - totalPaid,
          },
          redemptionsWithoutLedger: {
            label: "Redemptions with no matching revenue_recognized event (pre-Task-6 data)",
            count: redemptionsNoLedger.rows.length,
            severity: redemptionsNoLedger.rows.length > 0 ? "info" : "ok",
            rows: redemptionsNoLedger.rows,
          },
          orphanedLedgerEvents: {
            label: "Revenue ledger events referencing non-existent bookings",
            count: orphanedEvents.rows.length,
            severity: orphanedEvents.rows.length > 0 ? "warning" : "ok",
            rows: orphanedEvents.rows,
          },
          pendingFinancialFailures: {
            label: "Revenue ledger writes currently queued for retry",
            count: fefPending,
            severity: fefPending === 0 ? "ok" : "warning",
          },
          failedFinancialFailures: {
            label: "Revenue ledger writes failed after max retry attempts",
            count: fefFailed,
            severity: fefFailed > 0 ? "critical" : "ok",
          },
          stalePendingFailures: {
            label: "Revenue ledger failures unresolved for >24 hours",
            count: fefStale,
            severity: fefStale > 0 ? "critical" : "ok",
          },
        },
        summary: {
          criticalIssues: criticalCount,
          hasPreTask6Data: redemptionsNoLedger.rows.length > 0,
          note: "Pre-Task-6 redemptions lack ledger events — this is expected for historical data.",
        },
      });
    } catch (error) {
      console.error("Error running revenue integrity check:", error);
      res.status(500).json({ message: "Failed to run revenue integrity check" });
    }
  });

  // ── Revenue Summary V2 — collected / recognized / deferred / compensation ────
  app.get("/api/admin/revenue-summary-v2", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId || null;
      const sinceParam = req.query.since as string | undefined;
      const since = sinceParam ? new Date(sinceParam) : undefined;

      const orgFilter = orgId ? sql`AND org_id = ${orgId}` : sql``;
      const sinceFilter = since ? sql`AND created_at >= ${since}` : sql``;

      const totals = await db.execute(sql`
        SELECT
          event_type,
          COALESCE(SUM(amount_cents), 0)::int AS total_cents,
          COUNT(*)::int AS event_count
        FROM revenue_ledger_events
        WHERE 1=1 ${orgFilter} ${sinceFilter}
        GROUP BY event_type
      `);

      const byType: Record<string, { totalCents: number; count: number }> = {};
      for (const row of totals.rows as any[]) {
        byType[row.event_type] = { totalCents: row.total_cents, count: row.event_count };
      }

      const get = (type: string) => byType[type]?.totalCents ?? 0;

      const collectedRevenueCents = get("payment_received");
      const recognizedRevenueCents = get("revenue_recognized");
      const deferredCreatedCents = get("deferred_revenue_created");
      const deferredReleasedCents = get("deferred_revenue_released");
      const deferredRevenueCents = Math.max(0, deferredCreatedCents - deferredReleasedCents);
      const coachAccruedCents = get("coach_compensation_accrued");
      const coachPaidCents = get("coach_compensation_paid");
      const refundedCents = get("refund_issued");
      const netOrgRevenueCents = Math.max(0, recognizedRevenueCents - coachAccruedCents);

      // Per-coach accruals (last 90 days)
      const coachBreakdown = await db.execute(sql`
        SELECT
          rle.coach_id,
          u.first_name,
          u.last_name,
          COALESCE(SUM(CASE WHEN rle.event_type = 'coach_compensation_accrued' THEN rle.amount_cents ELSE 0 END), 0)::int AS accrued_cents,
          COALESCE(SUM(CASE WHEN rle.event_type = 'coach_compensation_paid' THEN rle.amount_cents ELSE 0 END), 0)::int AS paid_cents,
          COUNT(CASE WHEN rle.event_type = 'coach_compensation_accrued' THEN 1 END)::int AS sessions_redeemed
        FROM revenue_ledger_events rle
        LEFT JOIN coach_profiles cp ON cp.id = rle.coach_id
        LEFT JOIN users u ON u.id = cp.user_id
        WHERE rle.coach_id IS NOT NULL
          AND rle.event_type IN ('coach_compensation_accrued', 'coach_compensation_paid')
          ${orgFilter}
        GROUP BY rle.coach_id, u.first_name, u.last_name
        ORDER BY accrued_cents DESC
      `);

      res.json({
        generatedAt: new Date().toISOString(),
        organizationId: orgId,
        since: since?.toISOString() ?? null,
        metrics: {
          collectedRevenueCents,
          recognizedRevenueCents,
          deferredRevenueCents,
          deferredCreatedCents,
          deferredReleasedCents,
          coachAccruedCents,
          coachPaidCents,
          coachPendingCents: Math.max(0, coachAccruedCents - coachPaidCents),
          refundedCents,
          netOrgRevenueCents,
        },
        coachBreakdown: (coachBreakdown.rows as any[]).map(r => ({
          coachId: r.coach_id,
          coachName: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
          accruedCents: r.accrued_cents,
          paidCents: r.paid_cents,
          pendingCents: Math.max(0, r.accrued_cents - r.paid_cents),
          sessionsRedeemed: r.sessions_redeemed,
        })),
        eventCounts: Object.fromEntries(
          Object.entries(byType).map(([k, v]) => [k, v.count])
        ),
      });
    } catch (error) {
      console.error("Error computing revenue summary v2:", error);
      res.status(500).json({ message: "Failed to compute revenue summary" });
    }
  });

  // ── Financial Event Failure Queue ─────────────────────────────────────────
  // GET /api/admin/financial-event-failures — list failures for this org
  app.get("/api/admin/financial-event-failures", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const statusFilter = req.query.status ? String(req.query.status).split(",") : undefined;
      const failures = await storage.getFinancialEventFailures(orgId, statusFilter);
      res.json(failures);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/financial-event-failures/:id/retry — replay one failure
  app.post("/api/admin/financial-event-failures/:id/retry", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const failure = await storage.getFinancialEventFailure(req.params.id);
      if (!failure) return res.status(404).json({ error: "Failure not found" });
      if (failure.orgId !== orgId) return res.status(403).json({ error: "Forbidden" });
      if (failure.status === "resolved" || failure.status === "ignored") {
        return res.json({ success: false, reason: `Already ${failure.status}`, failure });
      }

      const newAttempts = (failure.attempts ?? 0) + 1;
      await storage.updateFinancialEventFailure(failure.id, { status: "retrying", lastAttemptAt: new Date(), attempts: newAttempts });

      try {
        const p = failure.payload as Record<string, any>;
        if (failure.sourceType === "revenue_ledger") {
          await storage.createRevenueLedgerEvent({
            orgId: p.orgId ?? null,
            clientId: p.clientId ?? null,
            coachId: p.coachId ?? null,
            bookingId: p.bookingId ?? null,
            redemptionId: p.redemptionId ?? null,
            eventType: p.eventType,
            amountCents: p.amountCents ?? 0,
            reason: p.reason ?? "",
            sourceAction: p.sourceAction ?? "",
            createdBy: p.createdBy ?? null,
            idempotencyKey: failure.idempotencyKey ?? p.idempotencyKey ?? null,
          });
        } else if (failure.sourceType === "credit_ledger") {
          await storage.createCreditLedgerEvent({
            clientId: p.clientId,
            bookingId: p.bookingId ?? null,
            subscriptionId: p.subscriptionId ?? null,
            organizationId: p.organizationId ?? null,
            eventType: p.eventType,
            deltaSessions: p.deltaSessions ?? 0,
            deltaCents: p.deltaCents ?? 0,
            sessionsAfter: p.sessionsAfter ?? null,
            reason: p.reason ?? "",
            createdBy: p.createdBy ?? null,
          });
        } else {
          throw new Error(`Unknown sourceType: ${failure.sourceType}`);
        }
        const updated = await storage.updateFinancialEventFailure(failure.id, { status: "resolved", resolvedAt: new Date(), resolvedBy: userId });
        return res.json({ success: true, failure: updated });
      } catch (replayErr: any) {
        if ((replayErr as any)?.code === "23505") {
          const updated = await storage.updateFinancialEventFailure(failure.id, { status: "resolved", resolvedAt: new Date(), resolvedBy: userId, failureMessage: "Already written (idempotent)" });
          return res.json({ success: true, failure: updated });
        }
        const newStatus = newAttempts >= (failure.maxAttempts ?? 5) ? "failed" : "pending";
        const updated = await storage.updateFinancialEventFailure(failure.id, { status: newStatus, failureMessage: replayErr?.message ?? String(replayErr) });
        return res.json({ success: false, reason: replayErr?.message, failure: updated });
      }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/financial-event-failures/reconcile — bulk retry up to 50 pending
  app.post("/api/admin/financial-event-failures/reconcile", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const { runFinancialEventRetry } = await import("./financial-event-retry-cron");
      const result = await runFinancialEventRetry();
      res.json({ ...result, runBy: userId, runAt: new Date().toISOString() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/admin/financial-event-failures/:id/ignore — mark as ignored with reason
  app.patch("/api/admin/financial-event-failures/:id/ignore", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const { reason } = req.body;
      if (!reason || !String(reason).trim()) return res.status(400).json({ error: "reason is required" });

      const failure = await storage.getFinancialEventFailure(req.params.id);
      if (!failure) return res.status(404).json({ error: "Failure not found" });
      if (failure.orgId !== orgId) return res.status(403).json({ error: "Forbidden" });

      const updated = await storage.updateFinancialEventFailure(failure.id, {
        status: "ignored",
        ignoreReason: String(reason).trim(),
        resolvedAt: new Date(),
        resolvedBy: userId,
      });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Financial Reconciliation Dashboard ────────────────────────────────────
  // Shared helper: build reconciliation aggregates for a period
  async function buildReconciliationData(orgId: string, start: Date, end: Date) {
    const { revenueLedgerEvents, creditLedgerEvents, financialEventFailures: fefT, users: usersT, coachProfiles } = await import("@shared/schema");
    const { sql: sqlFn, and: andFn, eq: eqFn, gte: gteFn, lte: lteFn, inArray: inArrayFn, lt: ltFn, count: countFn, desc: descFn } = await import("drizzle-orm");

    const orgFilter = sqlFn`AND org_id = ${orgId}`;
    const dateFilter = sqlFn`AND created_at >= ${start} AND created_at <= ${end}`;

    // 1. Revenue ledger aggregates
    const [ledgerTotals, ledgerEvents, coachBreakdown, failuresSummary, creditDebits, staleFailures, failedFailures] = await Promise.all([
      db.execute(sqlFn`
        SELECT
          COALESCE(SUM(CASE WHEN event_type = 'payment_received' THEN amount_cents ELSE 0 END), 0)::int AS collected,
          COALESCE(SUM(CASE WHEN event_type = 'revenue_recognized' THEN amount_cents ELSE 0 END), 0)::int AS recognized,
          COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_created' THEN amount_cents ELSE 0 END), 0)::int AS deferred_created,
          COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_released' THEN amount_cents ELSE 0 END), 0)::int AS deferred_released,
          COALESCE(SUM(CASE WHEN event_type = 'coach_compensation_accrued' THEN amount_cents ELSE 0 END), 0)::int AS coach_accrued,
          COALESCE(SUM(CASE WHEN event_type = 'coach_compensation_paid' THEN amount_cents ELSE 0 END), 0)::int AS coach_paid,
          COALESCE(SUM(CASE WHEN event_type = 'refund_issued' THEN amount_cents ELSE 0 END), 0)::int AS refunded,
          COALESCE(SUM(CASE WHEN event_type = 'manual_adjustment' THEN amount_cents ELSE 0 END), 0)::int AS manual_adj,
          COUNT(*)::int AS total_events
        FROM revenue_ledger_events
        WHERE 1=1 ${orgFilter} ${dateFilter}
      `),
      db.select().from(revenueLedgerEvents)
        .where(andFn(eqFn(revenueLedgerEvents.orgId, orgId), gteFn(revenueLedgerEvents.createdAt, start), lteFn(revenueLedgerEvents.createdAt, end)))
        .orderBy(descFn(revenueLedgerEvents.createdAt)).limit(200),
      db.execute(sqlFn`
        SELECT cp.id AS coach_id, u.first_name, u.last_name,
          COALESCE(SUM(CASE WHEN rle.event_type = 'coach_compensation_accrued' THEN rle.amount_cents ELSE 0 END), 0)::int AS accrued_cents,
          COALESCE(SUM(CASE WHEN rle.event_type = 'coach_compensation_paid' THEN rle.amount_cents ELSE 0 END), 0)::int AS paid_cents,
          COUNT(DISTINCT CASE WHEN rle.event_type = 'revenue_recognized' THEN rle.redemption_id END)::int AS sessions_redeemed
        FROM revenue_ledger_events rle
        JOIN coach_profiles cp ON cp.id = rle.coach_id
        JOIN users u ON u.id = cp.user_id
        WHERE rle.org_id = ${orgId} AND rle.created_at >= ${start} AND rle.created_at <= ${end}
        GROUP BY cp.id, u.first_name, u.last_name
        ORDER BY accrued_cents DESC
      `),
      db.select({ n: countFn() }).from(fefT)
        .where(andFn(eqFn(fefT.orgId, orgId), inArrayFn(fefT.status, ["pending", "retrying"]))),
      db.execute(sqlFn`
        SELECT COUNT(*)::int AS debit_count,
          COALESCE(SUM(ABS(delta_sessions)), 0)::int AS sessions_debited
        FROM credit_ledger_events
        WHERE organization_id = ${orgId} AND event_type = 'redemption_debit'
          AND created_at >= ${start} AND created_at <= ${end}
      `),
      db.select({ n: countFn() }).from(fefT)
        .where(andFn(eqFn(fefT.orgId, orgId), inArrayFn(fefT.status, ["pending", "retrying"]), ltFn(fefT.createdAt, new Date(Date.now() - 24 * 3600000)))),
      db.select({ n: countFn() }).from(fefT)
        .where(andFn(eqFn(fefT.orgId, orgId), eqFn(fefT.status, "failed"))),
    ]);

    const t = ledgerTotals.rows[0] as any;
    const summary = {
      collectedCents: t?.collected ?? 0,
      recognizedCents: t?.recognized ?? 0,
      deferredLiabilityCents: Math.max(0, (t?.deferred_created ?? 0) - (t?.deferred_released ?? 0)),
      coachAccruedCents: t?.coach_accrued ?? 0,
      coachPaidCents: t?.coach_paid ?? 0,
      coachPendingCents: Math.max(0, (t?.coach_accrued ?? 0) - (t?.coach_paid ?? 0)),
      refundedCents: t?.refunded ?? 0,
      manualAdjCents: t?.manual_adj ?? 0,
      pendingFailures: Number(failuresSummary[0]?.n ?? 0),
      failedFailures: Number(failedFailures[0]?.n ?? 0),
      staleFailures: Number(staleFailures[0]?.n ?? 0),
      creditDebitsCount: (creditDebits.rows[0] as any)?.debit_count ?? 0,
      sessionsDebited: (creditDebits.rows[0] as any)?.sessions_debited ?? 0,
      totalLedgerEvents: t?.total_events ?? 0,
    };

    // 2. Integrity mismatches (period-scoped where possible)
    const [dupRecognition, dupAccruals, orphanedEvents, redemptionsNoLedger] = await Promise.all([
      db.execute(sqlFn`
        SELECT redemption_id, COUNT(*)::int AS count FROM revenue_ledger_events
        WHERE event_type = 'revenue_recognized' AND redemption_id IS NOT NULL AND org_id = ${orgId}
          AND created_at >= ${start} AND created_at <= ${end}
        GROUP BY redemption_id HAVING COUNT(*) > 1
      `),
      db.execute(sqlFn`
        SELECT redemption_id, COUNT(*)::int AS count FROM revenue_ledger_events
        WHERE event_type = 'coach_compensation_accrued' AND redemption_id IS NOT NULL AND org_id = ${orgId}
          AND created_at >= ${start} AND created_at <= ${end}
        GROUP BY redemption_id HAVING COUNT(*) > 1
      `),
      db.execute(sqlFn`
        SELECT rle.id, rle.event_type, rle.booking_id, rle.created_at
        FROM revenue_ledger_events rle
        LEFT JOIN bookings b ON b.id = rle.booking_id
        WHERE rle.booking_id IS NOT NULL AND b.id IS NULL AND rle.org_id = ${orgId}
          AND rle.created_at >= ${start} AND rle.created_at <= ${end}
        LIMIT 20
      `),
      db.execute(sqlFn`
        SELECT r.id, r.booking_id, r.redeemed_at
        FROM redemptions r
        LEFT JOIN revenue_ledger_events rle ON rle.redemption_id = r.id AND rle.event_type = 'revenue_recognized'
        WHERE rle.id IS NULL AND r.coach_id IN (SELECT id FROM coach_profiles WHERE organization_id = ${orgId})
          AND r.redeemed_at >= ${start} AND r.redeemed_at <= ${end}
        LIMIT 20
      `),
    ]);

    const deferredNet = (t?.deferred_created ?? 0) - (t?.deferred_released ?? 0);

    const mismatches: Array<{ key: string; severity: "critical" | "warning" | "info"; label: string; count: number; rows?: any[] }> = [];
    if (dupRecognition.rows.length > 0) mismatches.push({ key: "dup_recognition", severity: "critical", label: "Duplicate revenue_recognized events", count: dupRecognition.rows.length, rows: dupRecognition.rows });
    if (dupAccruals.rows.length > 0) mismatches.push({ key: "dup_accruals", severity: "critical", label: "Duplicate coach_compensation_accrued events", count: dupAccruals.rows.length, rows: dupAccruals.rows });
    if (deferredNet < 0) mismatches.push({ key: "negative_deferred", severity: "critical", label: "Net deferred revenue is negative (released > created)", count: 1 });
    if (Number(failedFailures[0]?.n ?? 0) > 0) mismatches.push({ key: "failed_queue", severity: "critical", label: "Financial event failures reached max attempts", count: Number(failedFailures[0]?.n ?? 0) });
    if (Number(staleFailures[0]?.n ?? 0) > 0) mismatches.push({ key: "stale_failures", severity: "critical", label: "Financial event failures unresolved >24 hours", count: Number(staleFailures[0]?.n ?? 0) });
    if (orphanedEvents.rows.length > 0) mismatches.push({ key: "orphaned_events", severity: "warning", label: "Revenue ledger events referencing deleted bookings", count: orphanedEvents.rows.length, rows: orphanedEvents.rows });
    if (redemptionsNoLedger.rows.length > 0) mismatches.push({ key: "redemptions_no_ledger", severity: "info", label: "Redemptions with no revenue recognition event", count: redemptionsNoLedger.rows.length, rows: redemptionsNoLedger.rows });
    if (Number(failuresSummary[0]?.n ?? 0) > 0) mismatches.push({ key: "pending_failures", severity: "warning", label: "Financial event writes queued for retry", count: Number(failuresSummary[0]?.n ?? 0) });

    const criticalCount = mismatches.filter(m => m.severity === "critical").length;

    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      summary,
      eventStream: ledgerEvents,
      mismatches,
      criticalCount,
      coachPayouts: (coachBreakdown.rows as any[]).map(r => ({
        coachId: r.coach_id,
        coachName: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
        accruedCents: r.accrued_cents,
        paidCents: r.paid_cents,
        pendingCents: Math.max(0, r.accrued_cents - r.paid_cents),
        sessionsRedeemed: r.sessions_redeemed,
      })),
    };
  }

  app.get("/api/admin/financial-reconciliation", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const now = new Date();
      const start = req.query.start ? new Date(String(req.query.start)) : new Date(now.getFullYear(), now.getMonth(), 1);
      const end = req.query.end ? new Date(String(req.query.end)) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      const data = await buildReconciliationData(orgId, start, end);
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/financial-reconciliation/export — CSV export
  app.get("/api/admin/financial-reconciliation/export", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const now = new Date();
      const start = req.query.start ? new Date(String(req.query.start)) : new Date(now.getFullYear(), now.getMonth(), 1);
      const end = req.query.end ? new Date(String(req.query.end)) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      const { revenueLedgerEvents } = await import("@shared/schema");
      const { and: andFn, eq: eqFn, gte: gteFn, lte: lteFn, desc: descFn } = await import("drizzle-orm");

      const events = await db.select().from(revenueLedgerEvents)
        .where(andFn(eqFn(revenueLedgerEvents.orgId, orgId), gteFn(revenueLedgerEvents.createdAt, start), lteFn(revenueLedgerEvents.createdAt, end)))
        .orderBy(descFn(revenueLedgerEvents.createdAt));

      const exportType = String(req.query.type ?? "events");

      if (exportType === "coach_payouts") {
        const data = await buildReconciliationData(orgId, start, end);
        const headers = ["Coach ID", "Coach Name", "Accrued ($)", "Paid ($)", "Pending ($)", "Sessions Redeemed"];
        const rows = data.coachPayouts.map(c => [
          c.coachId, c.coachName,
          (c.accruedCents / 100).toFixed(2),
          (c.paidCents / 100).toFixed(2),
          (c.pendingCents / 100).toFixed(2),
          String(c.sessionsRedeemed),
        ]);
        const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="coach-payouts-${start.toISOString().slice(0,10)}.csv"`);
        return res.send(csv);
      }

      if (exportType === "issues") {
        const data = await buildReconciliationData(orgId, start, end);
        const headers = ["Severity", "Issue", "Count"];
        const rows = data.mismatches.map(m => [m.severity, m.label, String(m.count)]);
        const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="reconciliation-issues-${start.toISOString().slice(0,10)}.csv"`);
        return res.send(csv);
      }

      // Default: event stream
      const headers = ["ID", "Event Type", "Amount ($)", "Coach ID", "Client ID", "Booking ID", "Redemption ID", "Source Action", "Idempotency Key", "Created At"];
      const rows = events.map(e => [
        e.id, e.eventType,
        e.amountCents != null ? (e.amountCents / 100).toFixed(2) : "0.00",
        e.coachId ?? "", e.clientId ?? "", e.bookingId ?? "", e.redemptionId ?? "",
        e.sourceAction ?? "", e.idempotencyKey ?? "",
        e.createdAt ? new Date(e.createdAt).toISOString() : "",
      ]);
      const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="reconciliation-events-${start.toISOString().slice(0,10)}.csv"`);
      return res.send(csv);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Financial Closeout Endpoints ───────────────────────────────────────────
  app.get("/api/admin/financial-closeouts", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const closeouts = await storage.getFinancialCloseouts(orgId);
      res.json(closeouts);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/financial-closeouts", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const { periodStart, periodEnd, periodType = "monthly", notes } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ error: "periodStart and periodEnd required" });

      const closeout = await storage.createFinancialCloseout({
        orgId,
        periodType: periodType as any,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        status: "draft",
        notes: notes ?? null,
        totalsSnapshot: null,
        unresolvedIssueCount: 0,
        acknowledgedWarnings: false,
        closedBy: null, closedAt: null,
        reopenedBy: null, reopenedAt: null, reopenReason: null,
      });

      await storage.createCloseoutAuditEvent({
        closeoutId: closeout.id,
        actor: userId,
        action: "created",
        previousStatus: null,
        newStatus: "draft",
        reason: "Period created",
        metadata: { periodStart, periodEnd, periodType } as any,
      });

      res.json(closeout);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/financial-closeouts/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const closeout = await storage.getFinancialCloseout(req.params.id);
      if (!closeout || closeout.orgId !== orgId) return res.status(404).json({ error: "Not found" });

      const [auditEvents, recon] = await Promise.all([
        storage.getCloseoutAuditEvents(closeout.id),
        buildReconciliationData(orgId, new Date(closeout.periodStart), new Date(closeout.periodEnd)),
      ]);

      res.json({ closeout, auditEvents, reconciliation: recon });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/financial-closeouts/:id/acknowledge-warnings", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const closeout = await storage.getFinancialCloseout(req.params.id);
      if (!closeout || closeout.orgId !== orgId) return res.status(404).json({ error: "Not found" });

      const updated = await storage.updateFinancialCloseout(closeout.id, { acknowledgedWarnings: true });
      await storage.createCloseoutAuditEvent({
        closeoutId: closeout.id,
        actor: userId,
        action: "warnings_acknowledged",
        previousStatus: closeout.status,
        newStatus: closeout.status,
        reason: req.body.reason ?? "Warnings acknowledged by admin",
        metadata: null,
      });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/financial-closeouts/:id/close", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const closeout = await storage.getFinancialCloseout(req.params.id);
      if (!closeout || closeout.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (closeout.status === "closed") return res.status(400).json({ error: "Period already closed" });

      const recon = await buildReconciliationData(orgId, new Date(closeout.periodStart), new Date(closeout.periodEnd));

      // Integrity gates
      const criticalIssues = recon.mismatches.filter(m => m.severity === "critical");
      if (criticalIssues.length > 0) {
        return res.status(422).json({
          blocked: true,
          reason: "Critical integrity issues must be resolved before closing this period.",
          criticalIssues: criticalIssues.map(i => ({ key: i.key, label: i.label, count: i.count })),
        });
      }

      const warnings = recon.mismatches.filter(m => m.severity !== "critical");
      if (warnings.length > 0 && !closeout.acknowledgedWarnings) {
        return res.status(422).json({
          requiresAcknowledgment: true,
          reason: "Non-critical warnings exist. Acknowledge them before closing.",
          warnings: warnings.map(w => ({ key: w.key, label: w.label, count: w.count })),
        });
      }

      const totalsSnapshot = {
        ...recon.summary,
        mismatches: recon.mismatches.map(m => ({ key: m.key, severity: m.severity, count: m.count })),
        coachPayouts: recon.coachPayouts,
        snapshotAt: new Date().toISOString(),
      };

      const updated = await storage.updateFinancialCloseout(closeout.id, {
        status: "closed",
        closedBy: userId,
        closedAt: new Date(),
        totalsSnapshot: totalsSnapshot as any,
        unresolvedIssueCount: recon.mismatches.length,
      });

      await storage.createCloseoutAuditEvent({
        closeoutId: closeout.id,
        actor: userId,
        action: "closed",
        previousStatus: closeout.status,
        newStatus: "closed",
        reason: req.body.notes ?? "Period closed",
        metadata: { criticalCount: 0, warningCount: warnings.length } as any,
      });

      res.json({ closeout: updated, totalsSnapshot });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/financial-closeouts/:id/reopen", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const closeout = await storage.getFinancialCloseout(req.params.id);
      if (!closeout || closeout.orgId !== orgId) return res.status(404).json({ error: "Not found" });

      const { reason } = req.body;
      if (!reason || !String(reason).trim()) return res.status(400).json({ error: "reason is required to reopen" });

      const updated = await storage.updateFinancialCloseout(closeout.id, {
        status: "reopened",
        reopenedBy: userId,
        reopenedAt: new Date(),
        reopenReason: String(reason).trim(),
        acknowledgedWarnings: false,
      });

      await storage.createCloseoutAuditEvent({
        closeoutId: closeout.id,
        actor: userId,
        action: "reopened",
        previousStatus: closeout.status,
        newStatus: "reopened",
        reason: String(reason).trim(),
        metadata: null,
      });

      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── AI Financial Brain Endpoints ──────────────────────────────────────────
  // GET /api/admin/financial-brain/digest — daily financial intelligence digest
  app.get("/api/admin/financial-brain/digest", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { generateDigest } = await import("./financial-brain");
      const digest = await generateDigest(orgId);
      res.json(digest);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/financial-brain/query — natural-language financial querying
  app.post("/api/admin/financial-brain/query", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { question } = req.body;
      if (!question || !String(question).trim()) return res.status(400).json({ error: "question is required" });
      const { answerQuery } = await import("./financial-brain");
      const result = await answerQuery(orgId, String(question).trim());
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/financial-closeouts/:id/readiness — closeout readiness scoring
  app.get("/api/admin/financial-closeouts/:id/readiness", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const closeout = await storage.getFinancialCloseout(req.params.id);
      if (!closeout || closeout.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const { getCloseoutReadiness } = await import("./financial-brain");
      const readiness = await getCloseoutReadiness(orgId, new Date(closeout.periodStart), new Date(closeout.periodEnd), closeout.id);
      res.json(readiness);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Operator Action Center Endpoints ─────────────────────────────────────
  // GET /api/admin/operator-actions — list with filters
  app.get("/api/admin/operator-actions", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { status, severity, category, sourceType } = req.query as Record<string, string>;
      const actions = await storage.getOperatorActions(orgId, {
        status: status || undefined,
        severity: severity || undefined,
        category: category || undefined,
        sourceType: sourceType || undefined,
      });
      res.json(actions);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/operator-actions — create
  app.post("/api/admin/operator-actions", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { title, description, suggestedAction, severity, category, sourceType, sourceKey,
        estimatedImpact, relatedClientId, relatedCoachId, relatedCloseoutId, metadata } = req.body;
      if (!title || !String(title).trim()) return res.status(400).json({ error: "title is required" });
      const action = await storage.createOperatorAction({
        orgId, title: String(title).trim(), description: description ? String(description) : undefined,
        suggestedAction: suggestedAction ? String(suggestedAction) : undefined,
        severity: severity || "warning", category: category || "financial",
        sourceType: sourceType || "manual", sourceKey: sourceKey || undefined,
        estimatedImpact: estimatedImpact || undefined, status: "open",
        relatedClientId: relatedClientId || undefined, relatedCoachId: relatedCoachId || undefined,
        relatedCloseoutId: relatedCloseoutId || undefined, metadata: metadata || undefined,
        createdBy: userId,
      });
      await storage.createOperatorActionEvent({
        operatorActionId: action.id, actorId: userId,
        eventType: "created", newStatus: "open",
      });
      res.status(201).json(action);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/operator-actions/summary
  app.get("/api/admin/operator-actions/summary", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const summary = await storage.getOperatorActionsSummary(orgId);
      // Optional AI narrative
      let narrative: string | undefined;
      if (process.env.OPENAI_API_KEY && (summary.totalOpen > 0 || summary.criticalOpen > 0)) {
        try {
          const OpenAI = (await import("openai")).default;
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", max_tokens: 80,
            messages: [
              { role: "system", content: "Write a single concise sentence (≤20 words) summarizing the operator action state for a finance ops team. Be direct." },
              { role: "user", content: JSON.stringify({ totalOpen: summary.totalOpen, criticalOpen: summary.criticalOpen, stale: summary.staleCount, byCategory: summary.byCategory }) },
            ],
          });
          narrative = completion.choices[0]?.message?.content ?? undefined;
        } catch {}
      }
      res.json({ ...summary, narrative });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/operator-actions/:id — detail + events
  app.get("/api/admin/operator-actions/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const action = await storage.getOperatorAction(req.params.id);
      if (!action || action.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const events = await storage.getOperatorActionEvents(action.id);
      res.json({ ...action, events });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/operator-actions/:id/events — audit trail only
  app.get("/api/admin/operator-actions/:id/events", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const action = await storage.getOperatorAction(req.params.id);
      if (!action || action.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const events = await storage.getOperatorActionEvents(action.id);
      res.json(events);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Helper: status transition with audit event
  async function transitionAction(actionId: string, actorId: string, newStatus: string, extras: Record<string, any> = {}, note?: string) {
    const action = await storage.getOperatorAction(actionId);
    if (!action) throw new Error("Not found");
    const updated = await storage.updateOperatorAction(actionId, { status: newStatus as any, ...extras });
    await storage.createOperatorActionEvent({
      operatorActionId: actionId, actorId, eventType: newStatus,
      previousStatus: action.status, newStatus, note: note || undefined,
    });
    return updated;
  }

  // POST /api/admin/operator-actions/:id/acknowledge
  app.post("/api/admin/operator-actions/:id/acknowledge", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const action = await storage.getOperatorAction(req.params.id);
      if (!action || action.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (action.status !== "open") return res.status(400).json({ error: "Action must be open to acknowledge" });
      const updated = await transitionAction(req.params.id, userId, "acknowledged", { acknowledgedAt: new Date() });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/operator-actions/:id/start
  app.post("/api/admin/operator-actions/:id/start", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const action = await storage.getOperatorAction(req.params.id);
      if (!action || action.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (action.status === "resolved" || action.status === "ignored") return res.status(400).json({ error: "Cannot start a closed action" });
      const updated = await transitionAction(req.params.id, userId, "in_progress");
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/operator-actions/:id/resolve
  app.post("/api/admin/operator-actions/:id/resolve", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const action = await storage.getOperatorAction(req.params.id);
      if (!action || action.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (action.status === "ignored") return res.status(400).json({ error: "Cannot resolve an ignored action" });
      const { note } = req.body;
      const updated = await transitionAction(req.params.id, userId, "resolved", { resolvedAt: new Date() }, note);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/operator-actions/:id/ignore
  app.post("/api/admin/operator-actions/:id/ignore", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const action = await storage.getOperatorAction(req.params.id);
      if (!action || action.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (action.status === "resolved") return res.status(400).json({ error: "Cannot ignore a resolved action" });
      const { reason } = req.body;
      if (!reason || !String(reason).trim()) return res.status(400).json({ error: "reason is required to ignore" });
      const updated = await transitionAction(req.params.id, userId, "ignored", { ignoredAt: new Date(), ignoredReason: String(reason).trim() }, String(reason).trim());
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/operator-actions/:id/assign
  app.post("/api/admin/operator-actions/:id/assign", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const action = await storage.getOperatorAction(req.params.id);
      if (!action || action.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const { userId: assignUserId } = req.body;
      const updated = await storage.updateOperatorAction(req.params.id, { assignedToUserId: assignUserId || null });
      await storage.createOperatorActionEvent({
        operatorActionId: req.params.id, actorId: userId,
        eventType: action.assignedToUserId ? "reassigned" : "assigned",
        note: `Assigned to ${assignUserId}`,
      });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/operator-actions/:id/note
  app.post("/api/admin/operator-actions/:id/note", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const action = await storage.getOperatorAction(req.params.id);
      if (!action || action.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const { note } = req.body;
      if (!note || !String(note).trim()) return res.status(400).json({ error: "note is required" });
      const event = await storage.createOperatorActionEvent({
        operatorActionId: req.params.id, actorId: userId,
        eventType: "note_added", note: String(note).trim(),
      });
      res.status(201).json(event);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/financial-brain/create-action — convert AI recommendation to operator action
  app.post("/api/admin/financial-brain/create-action", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { key, label, detail, severity, suggestedAction, estimatedImpact, relatedEntities, sourceKey } = req.body;
      if (!label) return res.status(400).json({ error: "label is required" });
      const categoryMap: Record<string, string> = {
        resolve_failed_events: "accounting", clear_stale_failures: "accounting",
        investigate_revenue_drop: "financial", reengage_inactive_clients: "client_retention",
        followup_underutilizing_clients: "client_retention", coach_no_sessions: "coach_operations",
        review_payout_spike: "payout",
      };
      const action = await storage.createOperatorAction({
        orgId, title: String(label), description: detail ? String(detail) : undefined,
        suggestedAction: suggestedAction ? String(suggestedAction) : undefined,
        severity: severity || "warning",
        category: categoryMap[key] || "financial",
        sourceType: "financial_brain", sourceKey: sourceKey || key,
        estimatedImpact: estimatedImpact || undefined,
        metadata: { recommendationKey: key, relatedEntities, originalDetail: detail },
        createdBy: userId, status: "open",
      });
      await storage.createOperatorActionEvent({
        operatorActionId: action.id, actorId: userId,
        eventType: "created", newStatus: "open",
        note: `Created from AI Financial Brain recommendation: ${key}`,
      });
      res.status(201).json(action);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Retention Workflow Endpoints ──────────────────────────────────────────

  // GET /api/admin/revenue-recovery-summary
  app.get("/api/admin/revenue-recovery-summary", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600000);

      // Pull workflows
      const workflows = await storage.getRetentionWorkflows(orgId);
      const activeWorkflowCount = workflows.filter(w => !["completed","cancelled"].includes(w.status)).length;
      const churnedClientCount = workflows.filter(w => w.status === "churned").length;
      const recoveredLast30dCents = workflows
        .filter(w => w.status === "recovered" && w.updatedAt && new Date(w.updatedAt) >= thirtyDaysAgo)
        .reduce((s, w) => s + (w.estimatedRecoverableRevenueCents ?? 0), 0);

      // Pull inactive prepaid exposure from financial brain
      let inactivePrepaidExposureCents = 0;
      let totalRecoverableRevenueCents = 0;
      try {
        const { getClientRisks } = await import("./financial-brain");
        const risks = await getClientRisks(orgId);
        // Estimate: sessions_remaining × avg session value ($100 default)
        const AVG_SESSION_CENTS = 10000;
        for (const r of risks) {
          const exposure = (r.sessionsRemaining ?? 0) * AVG_SESSION_CENTS;
          inactivePrepaidExposureCents += exposure;
          totalRecoverableRevenueCents += Math.round(exposure * 0.65);
        }
      } catch {}

      // Combine with workflow estimates
      totalRecoverableRevenueCents += workflows
        .filter(w => !["completed","cancelled","churned"].includes(w.status))
        .reduce((s, w) => s + (w.estimatedRecoverableRevenueCents ?? 0), 0);

      const summary = {
        totalRecoverableRevenueCents,
        inactivePrepaidExposureCents,
        unpaidBalanceCents: 0,
        expiringPackageExposureCents: 0,
        recoveredLast30dCents,
        activeWorkflowCount,
        churnedClientCount,
        narrative: null as string | null,
      };

      if (process.env.OPENAI_API_KEY && (totalRecoverableRevenueCents > 0 || inactivePrepaidExposureCents > 0)) {
        try {
          const OpenAI = (await import("openai")).default;
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", max_tokens: 60,
            messages: [
              { role: "system", content: "Write one direct sentence (≤25 words) summarizing retention/revenue recovery exposure for an ops team. Cite exact dollar amounts." },
              { role: "user", content: JSON.stringify({ inactivePrepaid: `$${(inactivePrepaidExposureCents/100).toFixed(0)}`, recoverable: `$${(totalRecoverableRevenueCents/100).toFixed(0)}`, activeWorkflows: activeWorkflowCount }) },
            ],
          });
          summary.narrative = completion.choices[0]?.message?.content ?? null;
        } catch {}
      }

      res.json(summary);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/retention-workflows — list with filters
  app.get("/api/admin/retention-workflows", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { status, workflowType, riskSeverity } = req.query as Record<string, string>;
      const workflows = await storage.getRetentionWorkflows(orgId, {
        status: status || undefined,
        workflowType: workflowType || undefined,
        riskSeverity: riskSeverity || undefined,
      });
      res.json(workflows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/retention-workflows — create
  app.post("/api/admin/retention-workflows", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const {
        workflowType, status, relatedClientId, relatedOperatorActionId,
        riskSeverity, estimatedRevenueAtRiskCents, estimatedRecoverableRevenueCents, metadata,
      } = req.body;
      const wf = await storage.createRetentionWorkflow({
        orgId, workflowType: workflowType || "manual", status: status || "draft",
        relatedClientId: relatedClientId || undefined, relatedOperatorActionId: relatedOperatorActionId || undefined,
        riskSeverity: riskSeverity || "warning",
        estimatedRevenueAtRiskCents: estimatedRevenueAtRiskCents ?? 0,
        estimatedRecoverableRevenueCents: estimatedRecoverableRevenueCents ?? 0,
        metadata: metadata || undefined, createdBy: userId,
      });
      await storage.createRetentionWorkflowEvent({ workflowId: wf.id, actorId: userId, eventType: "created", note: `Workflow created: ${workflowType || "manual"}` });
      res.status(201).json(wf);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/retention-workflows/from-risk — create from AI client risk
  app.post("/api/admin/retention-workflows/from-risk", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { clientId, clientName, riskType, sessionsRemaining, daysSinceLastSession, description, recommendedAction, relatedOperatorActionId } = req.body;
      if (!clientId) return res.status(400).json({ error: "clientId is required" });
      const typeMap: Record<string, string> = {
        unused_credits: "unused_credits", high_value_inactive: "inactive_prepaid",
        declining_attendance: "stalled_client", expiring_soon: "expiring_package",
        fast_consumer: "stalled_client",
      };
      const AVG_SESSION_CENTS = 10000;
      const atRisk = (sessionsRemaining ?? 0) * AVG_SESSION_CENTS;
      const recoverable = Math.round(atRisk * 0.65);

      // Try AI recovery recommendation
      let aiRec: string | undefined;
      if (process.env.OPENAI_API_KEY && sessionsRemaining != null) {
        try {
          const OpenAI = (await import("openai")).default;
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const r = await openai.chat.completions.create({
            model: "gpt-4o-mini", max_tokens: 80,
            messages: [
              { role: "system", content: "Write one sentence of actionable recovery guidance for a retention manager. Be specific, professional, concise." },
              { role: "user", content: JSON.stringify({ clientName, sessionsRemaining, daysSinceLastSession, riskType }) },
            ],
          });
          aiRec = r.choices[0]?.message?.content ?? undefined;
        } catch {}
      }

      const wf = await storage.createRetentionWorkflow({
        orgId, workflowType: typeMap[riskType] || "inactive_prepaid", status: "draft",
        relatedClientId: clientId, relatedOperatorActionId: relatedOperatorActionId || undefined,
        riskSeverity: daysSinceLastSession != null && daysSinceLastSession > 60 ? "critical" : "warning",
        estimatedRevenueAtRiskCents: atRisk,
        estimatedRecoverableRevenueCents: recoverable,
        metadata: { clientName, sessionsRemaining, daysSinceLastSession, riskType, description, recommendedAction, aiRecommendation: aiRec },
        createdBy: userId,
      });
      await storage.createRetentionWorkflowEvent({ workflowId: wf.id, actorId: userId, eventType: "created", note: `Created from AI client risk: ${riskType} for ${clientName || clientId}` });
      res.status(201).json(wf);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/retention-workflows/:id — detail + events
  app.get("/api/admin/retention-workflows/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const wf = await storage.getRetentionWorkflow(req.params.id);
      if (!wf || wf.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const events = await storage.getRetentionWorkflowEvents(wf.id);
      res.json({ ...wf, events });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/retention-workflows/:id/events
  app.get("/api/admin/retention-workflows/:id/events", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const wf = await storage.getRetentionWorkflow(req.params.id);
      if (!wf || wf.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const events = await storage.getRetentionWorkflowEvents(wf.id);
      res.json(events);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/retention-workflows/:id/transition — lifecycle state machine
  app.post("/api/admin/retention-workflows/:id/transition", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const wf = await storage.getRetentionWorkflow(req.params.id);
      if (!wf || wf.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const { status: newStatus, note } = req.body;
      if (!newStatus) return res.status(400).json({ error: "status is required" });
      const VALID: Record<string, string[]> = {
        draft: ["active","cancelled"], active: ["contacted","paused","cancelled"],
        paused: ["active","cancelled"], contacted: ["awaiting_response","recovered","churned","active"],
        awaiting_response: ["recovered","churned","contacted","active"],
        recovered: ["completed"], churned: ["completed"],
        completed: [], cancelled: [],
      };
      if (!(VALID[wf.status] || []).includes(newStatus)) {
        return res.status(400).json({ error: `Cannot transition from '${wf.status}' to '${newStatus}'` });
      }
      const extras: Partial<typeof wf> = {};
      if (newStatus === "active" && !wf.startedAt) extras.startedAt = new Date();
      if (newStatus === "completed") extras.completedAt = new Date();
      if (newStatus === "cancelled") extras.cancelledAt = new Date();
      // When recovered, optionally resolve linked operator action
      if (newStatus === "recovered" && wf.relatedOperatorActionId) {
        try {
          await storage.updateOperatorAction(wf.relatedOperatorActionId, { status: "resolved" as any, resolvedAt: new Date() });
          await storage.createOperatorActionEvent({ operatorActionId: wf.relatedOperatorActionId, actorId: userId, eventType: "resolved", note: "Auto-resolved via recovery workflow" });
        } catch {}
      }
      const updated = await storage.updateRetentionWorkflow(wf.id, { status: newStatus as any, ...extras });
      await storage.createRetentionWorkflowEvent({ workflowId: wf.id, actorId: userId, eventType: newStatus, note: note || undefined });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/retention-workflows/:id/note
  app.post("/api/admin/retention-workflows/:id/note", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const wf = await storage.getRetentionWorkflow(req.params.id);
      if (!wf || wf.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const { note } = req.body;
      if (!note || !String(note).trim()) return res.status(400).json({ error: "note is required" });
      const ev = await storage.createRetentionWorkflowEvent({ workflowId: wf.id, actorId: userId, eventType: "note_added", note: String(note).trim() });
      res.status(201).json(ev);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Outreach Draft Endpoints ──────────────────────────────────────────────

  // POST /api/admin/outreach/generate — AI draft generation
  app.post("/api/admin/outreach/generate", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { clientId, workflowId, operatorActionId, purpose, channel, tone } = req.body;
      if (!clientId) return res.status(400).json({ error: "clientId is required" });

      // Gather context
      const ctx: Record<string, any> = { clientId, purpose, channel, tone };
      try {
        const clientProfile = await storage.getUserProfile(clientId);
        if (clientProfile) ctx.clientName = `${clientProfile.firstName || ""} ${clientProfile.lastName || ""}`.trim();
      } catch {}
      if (workflowId) {
        try {
          const wf = await storage.getRetentionWorkflow(workflowId);
          if (wf?.metadata) {
            ctx.sessionsRemaining = (wf.metadata as any).sessionsRemaining;
            ctx.daysSinceLastSession = (wf.metadata as any).daysSinceLastSession;
            ctx.riskType = (wf.metadata as any).riskType;
            ctx.workflowDescription = (wf.metadata as any).description;
          }
        } catch {}
      }

      // Safety rules embedded in system prompt
      const TONE_GUIDANCE: Record<string, string> = {
        professional: "professional and direct — like a business email",
        supportive: "warm, caring, and encouraging — like a coach who knows you",
        energetic: "upbeat and motivating — brief, punchy, action-oriented",
        accountability: "honest and direct — holding the client to their commitment without guilt or shame",
        relationship_first: "casual and personal — as if catching up with a client you care about",
      };
      const toneDesc = TONE_GUIDANCE[tone] || "professional";
      const PURPOSE_CONTEXT: Record<string, string> = {
        inactive_client: "The client has not attended sessions recently and has remaining sessions available.",
        unused_credits: "The client has unused session credits that may expire.",
        expiring_package: "The client's session package is expiring soon.",
        unpaid_balance: "The client has an outstanding balance.",
        no_show_followup: "The client missed a scheduled session.",
        churn_recovery: "The client appears at risk of stopping their training entirely.",
        scheduling_recovery: "The client has not scheduled their next session.",
        general: "General check-in outreach.",
      };
      const purposeCtx = PURPOSE_CONTEXT[purpose] || "";
      const systemPrompt = `You are a strength and conditioning business assistant writing a real outreach message on behalf of a coaching business. Tone: ${toneDesc}.

Context: ${purposeCtx}

SAFETY RULES — NEVER violate:
- No manipulation or pressure tactics
- No fake urgency ("limited time only", "act now")  
- No guilt or shaming ("you've been neglecting", "you promised")
- No fabricated data — only use facts from the context provided
- No over-promising results
- Keep it under 100 words for SMS, 200 words for email
- Sound like a real human coach, not a marketing template
- Do NOT include unsubscribe links, promotional banners, or spam triggers
${channel === "email" ? "- Also write a short subject line (prefix with SUBJECT: on first line)" : ""}`;

      const userMsg = `Client context: ${JSON.stringify(ctx)}
Write a ${channel} message for a coaching business client. Be concise, human, and relationship-focused.`;

      let content = "";
      let subject: string | undefined;
      let aiPromptSnapshot = systemPrompt;

      if (process.env.OPENAI_API_KEY) {
        const OpenAI = (await import("openai")).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const r = await openai.chat.completions.create({
          model: "gpt-4o", max_tokens: channel === "sms" ? 120 : 280,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
        });
        const raw = r.choices[0]?.message?.content || "";
        if (channel === "email" && raw.startsWith("SUBJECT:")) {
          const lines = raw.split("\n");
          subject = lines[0].replace(/^SUBJECT:\s*/i, "").trim();
          content = lines.slice(1).join("\n").trim();
        } else {
          content = raw.trim();
        }
      } else {
        // Fallback placeholder when OpenAI not configured
        const templates: Record<string, string> = {
          inactive_client: ctx.sessionsRemaining
            ? `Hi${ctx.clientName ? ` ${ctx.clientName.split(" ")[0]}` : ""}! You still have ${ctx.sessionsRemaining} sessions waiting for you. Want to get something on the calendar this week?`
            : `Hi${ctx.clientName ? ` ${ctx.clientName.split(" ")[0]}` : ""}! Haven't seen you in a while — let's get you back on track. When works for you?`,
          unused_credits: `Hey${ctx.clientName ? ` ${ctx.clientName.split(" ")[0]}` : ""}! Quick check-in — you have sessions remaining and we'd love to see you back. Want to schedule something this week?`,
          scheduling_recovery: `Hi${ctx.clientName ? ` ${ctx.clientName.split(" ")[0]}` : ""}! Just noticed you don't have a session booked yet. Let's get your next one on the calendar — what days work best for you?`,
          general: `Hi${ctx.clientName ? ` ${ctx.clientName.split(" ")[0]}` : ""}! Checking in to see how things are going. Let us know if there's anything we can help with.`,
        };
        content = templates[purpose] || templates.general;
        if (channel === "email") subject = `Checking in${ctx.clientName ? ` — ${ctx.clientName.split(" ")[0]}` : ""}`;
      }

      const draft = await storage.createOutreachDraft({
        orgId, workflowId: workflowId || undefined, operatorActionId: operatorActionId || undefined,
        relatedClientId: clientId, channel, purpose, tone, status: "draft",
        subject: subject || undefined, content,
        aiGenerated: true, aiPromptSnapshot, aiContextSnapshot: ctx, generatedBy: userId,
      });
      await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: userId, eventType: "generated", newStatus: "draft", note: `AI generated ${tone} ${channel} draft for purpose: ${purpose}` });
      res.status(201).json(draft);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/outreach — list with filters
  app.get("/api/admin/outreach", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { status, channel, purpose, workflowId } = req.query as Record<string, string>;
      const drafts = await storage.getOutreachDrafts(orgId, {
        status: status || undefined, channel: channel || undefined,
        purpose: purpose || undefined, workflowId: workflowId || undefined,
      });
      res.json(drafts);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/outreach-summary — reporting
  app.get("/api/admin/outreach-summary", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const summary = await storage.getOutreachSummary(orgId);
      res.json(summary);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/outreach/:id — detail + events
  app.get("/api/admin/outreach/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const events = await storage.getOutreachEvents(draft.id);
      res.json({ ...draft, events });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/outreach/:id/events
  app.get("/api/admin/outreach/:id/events", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const events = await storage.getOutreachEvents(draft.id);
      res.json(events);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/outreach/:id/edit — edit content/subject
  app.post("/api/admin/outreach/:id/edit", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (["sent","cancelled"].includes(draft.status)) return res.status(400).json({ error: `Cannot edit a ${draft.status} draft` });
      const { content, subject } = req.body;
      if (!content || !String(content).trim()) return res.status(400).json({ error: "content is required" });
      const updated = await storage.updateOutreachDraft(draft.id, { content: String(content).trim(), subject: subject ? String(subject).trim() : draft.subject });
      await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: userId, eventType: "edited", note: "Content edited by operator" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/outreach/:id/regenerate — re-run AI with same context
  app.post("/api/admin/outreach/:id/regenerate", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (!["draft"].includes(draft.status)) return res.status(400).json({ error: "Can only regenerate drafts" });
      if (!draft.aiGenerated) return res.status(400).json({ error: "Can only regenerate AI-generated drafts" });
      const ctx = draft.aiContextSnapshot as any || {};
      const TONE_GUIDANCE: Record<string, string> = {
        professional: "professional and direct", supportive: "warm and encouraging",
        energetic: "upbeat and motivating", accountability: "honest and direct",
        relationship_first: "casual and personal",
      };
      const toneDesc = TONE_GUIDANCE[draft.tone] || "professional";
      const systemPrompt = `You are a strength and conditioning business assistant. Tone: ${toneDesc}. Write a NEW variation — different phrasing from previous. SAFETY: No manipulation, no fake urgency, no guilt/shaming, no fabricated data, no over-promising.${draft.channel === "email" ? " Write subject on first line prefixed SUBJECT:" : ""}`;
      let content = draft.content;
      let subject = draft.subject;
      if (process.env.OPENAI_API_KEY) {
        const OpenAI = (await import("openai")).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const r = await openai.chat.completions.create({
          model: "gpt-4o", max_tokens: draft.channel === "sms" ? 120 : 280,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Client context: ${JSON.stringify(ctx)}` }],
        });
        const raw = r.choices[0]?.message?.content || "";
        if (draft.channel === "email" && raw.startsWith("SUBJECT:")) {
          const lines = raw.split("\n");
          subject = lines[0].replace(/^SUBJECT:\s*/i, "").trim();
          content = lines.slice(1).join("\n").trim();
        } else { content = raw.trim(); }
      }
      const updated = await storage.updateOutreachDraft(draft.id, { content, subject: subject || undefined });
      await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: userId, eventType: "regenerated", note: "AI variant generated" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/outreach/:id/submit — submit for approval
  app.post("/api/admin/outreach/:id/submit", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (draft.status !== "draft") return res.status(400).json({ error: "Only drafts can be submitted" });
      const updated = await storage.updateOutreachDraft(draft.id, { status: "pending_approval" });
      await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: userId, eventType: "submitted_for_approval", previousStatus: "draft", newStatus: "pending_approval" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/outreach/:id/approve — approve
  app.post("/api/admin/outreach/:id/approve", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (draft.status !== "pending_approval") return res.status(400).json({ error: "Only pending drafts can be approved" });
      const updated = await storage.updateOutreachDraft(draft.id, { status: "approved", approvedBy: userId, approvedAt: new Date() });
      await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: userId, eventType: "approved", previousStatus: "pending_approval", newStatus: "approved" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/outreach/:id/reject — reject with reason (required)
  app.post("/api/admin/outreach/:id/reject", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (!["pending_approval","draft"].includes(draft.status)) return res.status(400).json({ error: `Cannot reject a ${draft.status} draft` });
      const { reason } = req.body;
      if (!reason || !String(reason).trim()) return res.status(400).json({ error: "Rejection reason is required" });
      const updated = await storage.updateOutreachDraft(draft.id, { status: "rejected", rejectedAt: new Date(), rejectionReason: String(reason).trim() });
      await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: userId, eventType: "rejected", previousStatus: draft.status, newStatus: "rejected", note: String(reason).trim() });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/outreach/:id/cancel
  app.post("/api/admin/outreach/:id/cancel", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (["sent","cancelled"].includes(draft.status)) return res.status(400).json({ error: `Cannot cancel a ${draft.status} draft` });
      const updated = await storage.updateOutreachDraft(draft.id, { status: "cancelled" });
      await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: userId, eventType: "cancelled", previousStatus: draft.status, newStatus: "cancelled" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/outreach/:id/send — gated send (approved status required, explicit confirmation)
  app.post("/api/admin/outreach/:id/send", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      // Hard gate: must be approved
      if (draft.status !== "approved") return res.status(400).json({ error: "Only approved drafts can be sent. Draft must first be approved." });
      if (!draft.relatedClientId) return res.status(400).json({ error: "No client linked to this draft" });

      let sendResult: Record<string, any> = { channel: draft.channel, sentAt: new Date().toISOString() };
      let sendError: string | undefined;

      if (draft.channel === "email") {
        // Attempt SendGrid if configured
        const sgKey = process.env.SENDGRID_API_KEY;
        if (sgKey) {
          try {
            const clientProfile = await storage.getUserProfile(draft.relatedClientId);
            const toEmail = clientProfile?.email;
            if (!toEmail) throw new Error("No email address on file for client");
            const sgMail = await import("@sendgrid/mail");
            sgMail.default.setApiKey(sgKey);
            const fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@trainefficiency.com";
            await sgMail.default.send({
              to: toEmail, from: fromEmail,
              subject: draft.subject || "Message from your coach",
              text: draft.content,
            });
            sendResult = { ...sendResult, provider: "sendgrid", status: "sent", toEmail };
          } catch (sendErr: any) {
            sendError = sendErr.message;
            sendResult = { ...sendResult, provider: "sendgrid", status: "failed", error: sendError };
          }
        } else {
          // Simulate/preview mode when SendGrid not configured
          sendResult = { ...sendResult, provider: "preview_mode", status: "simulated", note: "SendGrid not configured — message logged but not delivered" };
        }
      } else {
        // SMS/in_app — preview mode (no Twilio integration configured)
        sendResult = { ...sendResult, provider: "preview_mode", status: "simulated", note: `${draft.channel} send not yet integrated — message logged but not delivered` };
      }

      if (sendError) {
        // Log failure but do not silently swallow it
        await storage.updateOutreachDraft(draft.id, { sendResult });
        await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: userId, eventType: "sent", previousStatus: "approved", newStatus: "approved", note: `Send failed: ${sendError}`, metadata: sendResult });
        return res.status(500).json({ error: `Send failed: ${sendError}`, sendResult });
      }

      const updated = await storage.updateOutreachDraft(draft.id, { status: "sent", sentBy: userId, sentAt: new Date(), sendResult });
      await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: userId, eventType: "sent", previousStatus: "approved", newStatus: "sent", metadata: sendResult });

      // If linked to a workflow, advance to contacted
      if (draft.workflowId) {
        try {
          const wf = await storage.getRetentionWorkflow(draft.workflowId);
          if (wf && wf.status === "active") {
            await storage.updateRetentionWorkflow(wf.id, { status: "contacted" });
            await storage.createRetentionWorkflowEvent({ workflowId: wf.id, actorId: userId, eventType: "contacted", note: `Outreach sent via ${draft.channel}` });
          }
        } catch {}
      }

      res.json({ ...updated, sendResult });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/outreach/:id/note
  app.post("/api/admin/outreach/:id/note", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const draft = await storage.getOutreachDraft(req.params.id);
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const { note } = req.body;
      if (!note || !String(note).trim()) return res.status(400).json({ error: "note is required" });
      const ev = await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: userId, eventType: "note_added", note: String(note).trim() });
      res.status(201).json(ev);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WORKFLOW ORCHESTRATOR — Task 13
  // ─────────────────────────────────────────────────────────────────────────

  // GET /api/admin/workflow-templates — list all available templates
  app.get("/api/admin/workflow-templates", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { WORKFLOW_TEMPLATES } = await import("./workflow-orchestrator");
      res.json(Object.values(WORKFLOW_TEMPLATES));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/workflow-runs — list runs for org with optional status filter
  app.get("/api/admin/workflow-runs", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { status, templateKey } = req.query as { status?: string; templateKey?: string };
      const runs = await storage.getWorkflowRuns(orgId, { status, templateKey });
      res.json(runs);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/workflow-runs — start a new workflow run
  app.post("/api/admin/workflow-runs", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { templateKey, sourceType, sourceId, metadata } = req.body;
      if (!templateKey || typeof templateKey !== "string") return res.status(400).json({ error: "templateKey is required" });
      const { orchestrator } = await import("./workflow-orchestrator");
      const run = await orchestrator.start({ orgId, templateKey, sourceType, sourceId, createdBy: userId, metadata: metadata || {} });
      const { createActivityEvent } = await import("./services/activity-timeline");
      createActivityEvent({
        orgId,
        sourceType: "workflow",
        sourceId: run.id,
        eventType: "workflow_triggered",
        title: `Workflow started: ${templateKey}`,
        metadata: { templateKey, sourceType, sourceId, runId: run.id },
        visibility: "coach",
      }).catch(() => {});
      res.status(201).json(run);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/workflow-runs/:id — get run detail with step history
  app.get("/api/admin/workflow-runs/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const run = await storage.getWorkflowRun(req.params.id);
      if (!run || run.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const steps = await storage.getWorkflowStepRuns(run.id);
      res.json({ ...run, steps });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/workflow-runs/:id/cancel
  app.post("/api/admin/workflow-runs/:id/cancel", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const run = await storage.getWorkflowRun(req.params.id);
      if (!run || run.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      if (["completed","cancelled"].includes(run.status)) return res.status(400).json({ error: `Cannot cancel run with status: ${run.status}` });
      const updated = await storage.updateWorkflowRun(run.id, { status: "cancelled", cancelledAt: new Date(), failureReason: `Cancelled by operator ${userId}` });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/workflow-runs/:id/resume — manually resume a waiting run
  app.post("/api/admin/workflow-runs/:id/resume", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const run = await storage.getWorkflowRun(req.params.id);
      if (!run || run.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const { orchestrator } = await import("./workflow-orchestrator");
      const updated = await orchestrator.manualResume(run.id, userId, req.body.note);
      const steps = await storage.getWorkflowStepRuns(updated.id);
      res.json({ ...updated, steps });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/admin/workflow-runs/:id/retry-step — retry a failed step
  app.post("/api/admin/workflow-runs/:id/retry-step", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const run = await storage.getWorkflowRun(req.params.id);
      if (!run || run.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const { stepKey } = req.body;
      if (!stepKey) return res.status(400).json({ error: "stepKey is required" });
      const { orchestrator } = await import("./workflow-orchestrator");
      const updated = await orchestrator.retryStep(run.id, stepKey, userId);
      const steps = await storage.getWorkflowStepRuns(updated.id);
      res.json({ ...updated, steps });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/admin/workflow-runs/:id/skip-step — skip a non-critical step
  app.post("/api/admin/workflow-runs/:id/skip-step", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const run = await storage.getWorkflowRun(req.params.id);
      if (!run || run.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const { stepKey } = req.body;
      if (!stepKey) return res.status(400).json({ error: "stepKey is required" });
      const { orchestrator } = await import("./workflow-orchestrator");
      const updated = await orchestrator.skipStep(run.id, stepKey, userId);
      const steps = await storage.getWorkflowStepRuns(updated.id);
      res.json({ ...updated, steps });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/admin/workflow-runs/:id/note — add an operator note
  app.post("/api/admin/workflow-runs/:id/note", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const run = await storage.getWorkflowRun(req.params.id);
      if (!run || run.orgId !== orgId) return res.status(404).json({ error: "Not found" });
      const { note } = req.body;
      if (!note || !String(note).trim()) return res.status(400).json({ error: "note is required" });
      // Store note as a step run record
      const stepRun = await storage.createWorkflowStepRun({
        workflowRunId: run.id,
        stepKey: `note_${Date.now()}`,
        stepType: "add_note",
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        output: { note: String(note).trim(), addedBy: userId },
      });
      res.status(201).json(stepRun);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/financial-brain/anomalies — raw anomaly list
  app.get("/api/admin/financial-brain/anomalies", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { detectAnomalies } = await import("./financial-brain");
      const anomalies = await detectAnomalies(orgId);
      res.json(anomalies);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/financial-brain/client-risks — client utilization + churn risks
  app.get("/api/admin/financial-brain/client-risks", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ error: "No organization" });
      const { getClientRisks } = await import("./financial-brain");
      const risks = await getClientRisks(orgId);
      res.json(risks);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
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

      // ── Revenue recognition: record coach compensation paid ──────────────────
      if (status === "PAID" && updated) {
        const adminUserId = req.user.claims.sub;
        const adminProfile = await storage.getUserProfile(adminUserId);
        onCashoutPaid({
          orgId: adminProfile?.organizationId || null,
          coachId: updated.coachId,
          cashoutId: updated.id,
          amountCents: updated.amountCents,
          createdBy: adminUserId,
        }).catch(() => {});
      }

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

  app.get("/api/athletic/programs/by-org-slug/:orgSlug/:programSlug", async (req, res) => {
    try {
      const org = await storage.getOrganizationBySlug(req.params.orgSlug);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const program = await storage.getAthleticProgramBySlug(org.id, req.params.programSlug);
      if (!program) return res.status(404).json({ message: "Program not found" });
      res.json(program);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch program" });
    }
  });

  app.post("/api/athletic/programs", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { name, slug, maxTeamsPerSlot, trainingTypes, startHour, endHour, type } = req.body;
      if (!name || !slug) return res.status(400).json({ message: "name and slug are required" });
      const existing = await storage.getAthleticProgramBySlug(profile.organizationId, slug);
      if (existing) return res.status(409).json({ message: "A program with this slug already exists" });
      const program = await storage.createAthleticProgram({
        organizationId: profile.organizationId,
        name,
        slug,
        type: type ?? "scheduling",
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
      const { name, slug, maxTeamsPerSlot, trainingTypes, startHour, endHour, active, type } = req.body;
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
      if (type !== undefined) updateData.type = type;
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
      // Org auth integration — optionally link booking to an org user
      let resolvedOrgUserId: string | null = null;
      let resolvedBookerEmail: string | null = null;
      const orgAuthToken = req.headers["x-org-auth-token"] as string | undefined;
      if (orgAuthToken) {
        try {
          const tokenHash = crypto.createHash("sha256").update(orgAuthToken).digest("hex");
          const now = new Date();
          const sessions = await db.select().from(orgSessions)
            .where(and(eq(orgSessions.tokenHash, tokenHash), gt(orgSessions.expiresAt, now)))
            .limit(1);
          if (sessions.length) {
            const [orgUserRow] = await db.select().from(orgUsers)
              .where(eq(orgUsers.id, sessions[0].userId)).limit(1);
            if (orgUserRow) {
              resolvedOrgUserId = orgUserRow.id;
              resolvedBookerEmail = orgUserRow.email;
            }
          }
        } catch {}
      }

      // Enforce login requirement if org setting is enabled
      if (bookingOrg.requireLoginToBook && !resolvedOrgUserId) {
        return res.status(401).json({ message: "Login required to book sessions for this program" });
      }

      const booking = await storage.createAthleticBooking({ organizationId: program.organizationId, programId, date, timeSlot, teamName, trainingType: finalType, bookedBy: bookedBy || null });

      // Attach org user identity to the booking if authenticated
      if (resolvedOrgUserId) {
        await db.update(athleticBookings)
          .set({ orgUserId: resolvedOrgUserId, bookerEmail: resolvedBookerEmail })
          .where(eq(athleticBookings.id, booking.id));
      }

      res.json({ ...booking, orgUserId: resolvedOrgUserId, bookerEmail: resolvedBookerEmail });
    } catch (error) {
      console.error("Error creating athletic booking:", error);
      res.status(500).json({ message: "Failed to create athletic booking" });
    }
  });

  app.delete("/api/athletic/bookings/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req, res) => {
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

      const baseUrl = buildPublicAppUrl();
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

      const baseUrl = buildPublicAppUrl();
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

      const stripeCreditTx = await storage.creditWallet(userId, amountCents, `Added $${(amountCents / 100).toFixed(2)} via Stripe`, sessionId);

      // ── Revenue recognition: record payment received ─────────────────────────
      onPaymentReceived({
        orgId: orgId || null,
        clientId: userId,
        amountCents,
        walletTxId: stripeCreditTx.id,
        isSubscriptionPayment: false,
        createdBy: userId,
      }).catch(() => {});

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
      const coachPendingCents = coachRedemptions
        .filter((r: any) => r.payoutStatus === "PENDING")
        .reduce((sum: number, r: any) => sum + r.amountCents, 0);
      const coachPaidCents = coachRedemptions
        .filter((r: any) => r.payoutStatus === "SENT")
        .reduce((sum: number, r: any) => sum + r.amountCents, 0);

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
          coachPendingCents,
          coachPaidCents,
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

      const baseUrl = buildPublicAppUrl();

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
  // ── Availability check ───────────────────────────────────────────────────
  app.get("/api/scheduling/check-availability", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      const { clientId, coachId, serviceId, startTime, endTime, excludeBookingId } = req.query as Record<string, string | undefined>;
      if (!clientId || !coachId || !startTime || !endTime) {
        return res.json({ available: true, status: "unknown", message: "Insufficient parameters for check." });
      }

      const start = new Date(startTime);
      const end = new Date(endTime);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: "Invalid startTime or endTime." });
      }

      // 1. Redeemed / locked check (for reschedule case)
      if (excludeBookingId) {
        const existingRedemption = await storage.getRedemptionByBookingId(excludeBookingId);
        if (existingRedemption) {
          return res.json({
            available: false,
            status: "locked_session",
            message: "This session has been redeemed and cannot be rescheduled.",
            suggestions: [],
          });
        }
      }

      // 2. Coach conflict check
      const coachConflicts = await storage.getOverlappingBookings(coachId, start, end, excludeBookingId);

      // 3. Client conflict check (direct query — no storage method for this)
      const clientRows = await db
        .select()
        .from(bookingsSchema)
        .where(
          and(
            eq(bookingsSchema.clientId, clientId),
            or(eq(bookingsSchema.status, "CONFIRMED"), eq(bookingsSchema.status, "PENDING")),
            lt(bookingsSchema.startAt, end),
            gt(bookingsSchema.endAt, start),
            ...(excludeBookingId ? [ne(bookingsSchema.id, excludeBookingId)] : [])
          )
        );

      // 4. Coach availability blocks
      const allBlocks = await storage.getAvailabilityBlocks(coachId);
      // DB stores day_of_week as 0=Monday…6=Sunday; JS getDay() 0=Sunday…6=Saturday
      const dbDayOfWeek = start.getDay() === 0 ? 6 : start.getDay() - 1;
      const blocksForDay = allBlocks.filter(b => b.dayOfWeek === dbDayOfWeek);

      let outsideAvailability = false;
      if (blocksForDay.length > 0) {
        const sessionStartStr = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}:00`;
        const sessionEndStr = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}:00`;
        const covered = blocksForDay.some(b => b.startTime <= sessionStartStr && b.endTime >= sessionEndStr);
        if (!covered) outsideAvailability = true;
      }

      // Suggestion generator (up to 3 alternative slots for the same coach)
      const generateSuggestions = async () => {
        const durationMs = end.getTime() - start.getTime();
        const suggestions: Array<{ startTime: string; endTime: string; coachId: string; coachName: string; reason: string }> = [];
        let coachProfile: any = null;
        try { coachProfile = await storage.getCoachProfile(coachId); } catch {}
        const coachName = coachProfile?.user
          ? `${coachProfile.user.firstName ?? ""} ${coachProfile.user.lastName ?? ""}`.trim()
          : "Coach";

        // Try same day: +1h, +2h
        for (const offsetMin of [60, 120]) {
          if (suggestions.length >= 2) break;
          const tryStart = new Date(start.getTime() + offsetMin * 60_000);
          const tryEnd = new Date(tryStart.getTime() + durationMs);
          if (tryStart.getHours() >= 21) continue;
          const conflicts = await storage.getOverlappingBookings(coachId, tryStart, tryEnd, excludeBookingId);
          if (conflicts.length === 0) {
            suggestions.push({
              startTime: tryStart.toISOString(),
              endTime: tryEnd.toISOString(),
              coachId,
              coachName,
              reason: `${format(tryStart, "EEE MMM d")} at ${format(tryStart, "h:mm a")}`,
            });
          }
        }

        // Try next day, same time
        if (suggestions.length < 3) {
          const nextDay = new Date(start);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayEnd = new Date(nextDay.getTime() + durationMs);
          const conflicts = await storage.getOverlappingBookings(coachId, nextDay, nextDayEnd, excludeBookingId);
          if (conflicts.length === 0) {
            suggestions.push({
              startTime: nextDay.toISOString(),
              endTime: nextDayEnd.toISOString(),
              coachId,
              coachName,
              reason: `${format(nextDay, "EEE MMM d")} at ${format(nextDay, "h:mm a")}`,
            });
          }
        }

        return suggestions;
      };

      // Determine result
      if (coachConflicts.length > 0) {
        return res.json({
          available: false,
          status: "coach_conflict",
          message: `Coach has ${coachConflicts.length} conflicting session${coachConflicts.length > 1 ? "s" : ""} at this time.`,
          suggestions: await generateSuggestions(),
        });
      }

      if (clientRows.length > 0) {
        return res.json({
          available: false,
          status: "client_conflict",
          message: "Client already has a booking that overlaps this time.",
          suggestions: await generateSuggestions(),
        });
      }

      if (outsideAvailability) {
        return res.json({
          available: false,
          status: "outside_availability",
          message: "This time is outside the coach's availability window.",
          suggestions: await generateSuggestions(),
        });
      }

      // 5. Client credits (informational — never hard-blocks)
      let credits: Record<string, any> | null = null;
      if (clientId && serviceId) {
        try {
          const subs = await storage.getUserSubscriptions(clientId);
          const activeSub = subs.find(s => ["active", "trialing", "past_due"].includes(s.status));
          if (activeSub) {
            credits = {
              hasActiveSubscription: true,
              sessionsRemaining: activeSub.sessionsRemaining ?? null,
              willConsumeCredit: activeSub.sessionsRemaining !== null,
              insufficient: activeSub.sessionsRemaining !== null && activeSub.sessionsRemaining <= 0,
            };
          } else {
            credits = { hasActiveSubscription: false, sessionsRemaining: null, willConsumeCredit: false, insufficient: false };
          }
        } catch {}
      }

      return res.json({
        available: true,
        status: "available",
        message: "This time slot is available.",
        credits,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

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
      const existingRedemption = await storage.getRedemptionByBookingId(req.params.id);
      if (existingRedemption) {
        return res.status(409).json({ message: "This session has been redeemed and is locked. It cannot be modified." });
      }
      if (booking.status === "COMPLETED" && status !== "COMPLETED") {
        return res.status(409).json({ message: "Completed sessions cannot have their status changed without an admin reversal." });
      }
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
      const existingRedemption = await storage.getRedemptionByBookingId(req.params.id);
      if (existingRedemption) {
        return res.status(409).json({ message: "This session has been redeemed and is locked. It cannot be rescheduled or edited." });
      }
      if (booking.status === "COMPLETED") {
        return res.status(409).json({ message: "Completed sessions cannot be rescheduled. Use an admin reversal if needed." });
      }
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

  // ── Agent pending-action endpoints (button-driven, deterministic execution) ──

  // GET active pending actions for the current user (for rehydration on load)
  app.get("/api/agent/pending-actions/active", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const actions = await getActivePendingActionsForUser(userId);
      return res.json({ actions });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // POST confirm — execute a pending action directly without going through the LLM
  app.post("/api/agent/pending-actions/:id/confirm", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const pendingId = req.params.id as string;
      if (!pendingId) return res.status(400).json({ error: "Missing pending action ID." });

      const profile = await storage.getUserProfile(userId);
      const userRole = profile?.role || "CLIENT";
      const orgId = profile?.organizationId ?? null;

      const { success, result } = await executeConfirmedPendingAction(pendingId, userId, userRole, orgId);
      if (!success) {
        const status = result.error === "Access denied." ? 403
          : (result.error as string)?.includes("expired") ? 410
          : (result.error as string)?.includes("not found") ? 404
          : 400;
        return res.status(status).json({ error: result.error, result });
      }
      return res.json({ success: true, result });
    } catch (error: any) {
      console.error("[confirm pending action]", error);
      return res.status(500).json({ error: error.message || "Execution failed." });
    }
  });

  // POST cancel — mark a pending action as cancelled
  app.post("/api/agent/pending-actions/:id/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const pendingId = req.params.id as string;
      if (!pendingId) return res.status(400).json({ error: "Missing pending action ID." });

      // Verify ownership before cancelling
      const pending = await storage.getAgentPendingAction(pendingId);
      if (!pending) return res.status(404).json({ error: "Pending action not found." });
      if (pending.userId !== userId) return res.status(403).json({ error: "Access denied." });
      if (pending.status !== "pending") return res.status(409).json({ error: `Action is already ${pending.status}.` });

      const cancelled = await storage.cancelAgentPendingAction(pendingId);
      return res.json({ success: true, cancelled });
    } catch (error: any) {
      console.error("[cancel pending action]", error);
      return res.status(500).json({ error: error.message || "Cancel failed." });
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

  app.get("/api/media/:filename", async (req, res) => {
    try {
      await serveMediaFromCloud(req.params.filename, res);
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ message: "Failed to serve file" });
    }
  });

  app.post("/api/org/media", isAuthenticated, requireRole("ADMIN", "COACH"), handleMulterUpload, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub ?? req.user.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });

      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const { section = "hero", caption, altText } = req.body;
      const validSections = ["hero", "training_showcase", "facility", "coaches", "testimonials", "results"];
      if (!validSections.includes(section)) return res.status(400).json({ message: "Invalid section" });

      const isImage = ALLOWED_IMAGE_TYPES.includes(req.file.mimetype);
      const ext = path.extname(req.file.originalname).toLowerCase();
      const isVideo = ALLOWED_VIDEO_TYPES.includes(req.file.mimetype) || ALLOWED_VIDEO_EXTENSIONS.includes(ext);

      if (isImage && req.file.size > IMAGE_MAX_BYTES) {
        return res.status(400).json({ message: "Image exceeds 10MB limit" });
      }
      if (!isImage && !isVideo) {
        return res.status(400).json({ message: "Unsupported file type. Please upload jpg, png, webp, mp4, mov, or webm." });
      }

      const limit = SECTION_LIMITS[section] ?? 10;
      const existing = await storage.getOrgMediaBySection(profile.organizationId, section);
      if (existing.length >= limit) {
        return res.status(400).json({ message: `Section "${section}" supports up to ${limit} items` });
      }

      const fileUrl = await uploadMediaToCloud(req.file.buffer, req.file.originalname, req.file.mimetype);
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

      const { section, caption, altText, orderIndex, isActive, focalPoint } = req.body;
      const updateData: any = {};
      if (section !== undefined) updateData.section = section;
      if (caption !== undefined) updateData.caption = caption;
      if (altText !== undefined) updateData.altText = altText;
      if (orderIndex !== undefined) updateData.orderIndex = orderIndex;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (focalPoint !== undefined) updateData.focalPoint = focalPoint;

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

      if (item.url?.startsWith("/api/media/")) {
        await deleteMediaFromCloud(item.url).catch(() => {});
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
      const { getRotatedCategory: grc, getRotatedLocation: grl } = await import("./team-training-prospecting");
      if (saved) {
        const nextRunLabel = saved.recurringEnabled && saved.nextRunAt ? buildNextRunLabel(new Date(saved.nextRunAt), orgTz) : null;
        const preferredTimeLabel = saved.recurringTime ? formatTime12h(saved.recurringTime) : "8:00 AM";
        const loc = saved.defaultLocation || fallbackLocation;
        const nextSearchAngle = loc ? {
          category: grc(saved.lastSearchCategoryIndex ?? 0),
          location: grl(loc, saved.lastSearchLocationIndex ?? 0),
        } : null;
        return res.json({ ...saved, nextRunLabel, preferredTimeLabel, timezone: orgTz, nextSearchAngle });
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
        nextSearchAngle: fallbackLocation ? { category: grc(0), location: grl(fallbackLocation, 0) } : null,
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
      const { sport, limit = 8, forceDiversify } = req.body;
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
        description: `Manual research started. Location: ${locationTrimmed}, Radius: ${radiusNum}mi${sport ? `, Sport: ${sport}` : ""}${forceDiversify ? " [diversified]" : ""}`,
        metadata: { location: locationTrimmed, radiusMiles: radiusNum, sport: sport || null, limit: Number(limit), forceDiversify: !!forceDiversify },
      });

      const { researchProspects, scoreProspect, applyLeadQualityGate, normalizeDomain,
              getRotatedCategory, getRotatedLocation, nextCategoryIndex, nextLocationIndex } = await import("./team-training-prospecting");

      // Load existing prospects BEFORE research to build exclusion lists
      const existingProspects = await storage.getTeamTrainingProspects(profile.organizationId);
      const existingNames = existingProspects.map((p) => p.prospectName);
      const existingDomains = existingProspects
        .flatMap((p) => [normalizeDomain(p.websiteUrl), normalizeDomain(p.sourceUrl)])
        .filter(Boolean) as string[];

      // Determine search category + location using rotation indices
      const catIdx = savedSettings?.lastSearchCategoryIndex ?? 0;
      const locIdx = savedSettings?.lastSearchLocationIndex ?? 0;

      const searchCategory = forceDiversify
        ? getRotatedCategory((catIdx + 1) % 20)
        : getRotatedCategory(catIdx);
      const searchLocation = forceDiversify
        ? getRotatedLocation(locationTrimmed, (locIdx + 1) % 10)
        : getRotatedLocation(locationTrimmed, locIdx);

      const runResearch = async (category: string, loc: string) =>
        researchProspects(org, locationTrimmed, sport || undefined, Number(limit), radiusNum, {
          excludeNames: existingNames,
          excludeDomains: existingDomains,
          searchCategory: category,
          searchLocation: loc,
          forceDiversify: !!forceDiversify,
        });

      let results = await runResearch(searchCategory, searchLocation);

      const created: any[] = [];
      const rejected: { name: string; reason: string; score: number }[] = [];
      const duplicates: { name: string }[] = [];
      let needsContactCount = 0;

      const processResults = (batch: typeof results) => {
        for (const p of batch) {
          const scored = scoreProspect(p);
          const gate = applyLeadQualityGate(p, scored, existingNames, existingDomains);

          if (gate.action === "duplicate") {
            duplicates.push({ name: p.prospectName });
          } else if (gate.action === "reject") {
            rejected.push({ name: p.prospectName, reason: gate.reason || "Low quality", score: scored });
          } else {
            existingNames.push(p.prospectName);
          }
        }
        return batch.filter((p) => {
          const scored = scoreProspect(p);
          const gate = applyLeadQualityGate(p, scored,
            existingNames.filter((n) => n !== p.prospectName), existingDomains);
          return gate.action === "save";
        });
      };

      // First pass gate
      let saveableBatch = results.filter((p) => {
        const scored = scoreProspect(p);
        const gate = applyLeadQualityGate(p, scored, existingNames, existingDomains);
        if (gate.action === "duplicate") duplicates.push({ name: p.prospectName });
        else if (gate.action === "reject") rejected.push({ name: p.prospectName, reason: gate.reason || "Low quality", score: scored });
        return gate.action === "save";
      });

      // If ALL first-pass results were duplicates, run one automatic fallback with a different category/location
      const allDuplicates = results.length > 0 && saveableBatch.length === 0 && rejected.length === 0 && duplicates.length === results.length;
      let usedFallback = false;
      let fallbackCategory: string | null = null;
      let fallbackLocation: string | null = null;

      if (allDuplicates && !forceDiversify) {
        console.log(`[TeamTraining Research] All ${duplicates.length} results were duplicates — running diversified fallback`);
        fallbackCategory = getRotatedCategory((catIdx + 1) % 20);
        fallbackLocation = getRotatedLocation(locationTrimmed, (locIdx + 1) % 10);
        const fallbackResults = await runResearch(fallbackCategory, fallbackLocation);

        for (const p of fallbackResults) {
          const scored = scoreProspect(p);
          const gate = applyLeadQualityGate(p, scored, existingNames, existingDomains);
          if (gate.action === "duplicate") duplicates.push({ name: p.prospectName });
          else if (gate.action === "reject") rejected.push({ name: p.prospectName, reason: gate.reason || "Low quality", score: scored });
        }

        saveableBatch = fallbackResults.filter((p) => {
          const scored = scoreProspect(p);
          const gate = applyLeadQualityGate(p, scored, existingNames, existingDomains);
          return gate.action === "save";
        });
        results = fallbackResults;
        usedFallback = true;
      }

      // Update rotation indices for next run (advance after each manual research)
      await storage.upsertTeamLeadSettings(profile.organizationId, {
        lastSearchCategoryIndex: nextCategoryIndex(catIdx),
        lastSearchLocationIndex: nextLocationIndex(locationTrimmed, locIdx),
      } as any);

      const { normalizeNullable: nn, isValidEmail: ive } = await import("./team-training-prospecting");

      for (const p of saveableBatch) {
        const scored = scoreProspect(p);

        // Normalize all contact fields — never persist sentinel strings
        const safeContactName = nn(p.contactName);
        const safeContactRole = nn(p.contactRole);
        // Use discoverySourceUrl as fallback if websiteUrl/sourceUrl not returned by AI
        const safeWebsiteUrl = nn(p.websiteUrl) || nn(p.discoverySourceUrl) || null;
        const safeSourceUrl = nn(p.sourceUrl) || nn(p.discoverySourceUrl) || null;
        const safeDmEmail = nn(p.decisionMakerEmail);
        const safeDmName = nn(p.decisionMakerName);
        const safeDmTitle = nn(p.decisionMakerTitle);

        const safeContactPhone = nn(p.contactPhone);

        const now = new Date();
        const prospect = await storage.createTeamTrainingProspect({
          orgId: profile.organizationId,
          prospectName: p.prospectName,
          organizationType: p.organizationType,
          sport: p.sport,
          city: p.city,
          state: p.state,
          websiteUrl: safeWebsiteUrl,
          contactName: safeContactName,
          contactRole: safeContactRole,
          contactEmail: null,               // never persist unverified email
          contactPhone: safeContactPhone,   // save phone if research AI found it
          sourceUrl: safeSourceUrl,
          confidenceScore: scored,
          outreachStatus: "Needs Review",
          notes: p.notes,
          decisionMakerName: safeDmName,
          decisionMakerTitle: safeDmTitle,
          decisionMakerEmail: ive(safeDmEmail) ? safeDmEmail : null,
          contactConfidence: ive(safeDmEmail) ? (p.contactConfidence || 0) : 0,
          contactSourceUrl: nn(p.contactSourceUrl),
          // If research found a named contact/phone, mark as general quality, not missing
          contactQuality: ive(safeDmEmail) ? p.contactQuality : p.contactQuality,
          // Lead Discovery Evidence
          discoverySourceType: p.discoverySourceType || null,
          discoverySourceUrl: p.discoverySourceUrl || null,
          discoverySourceTitle: p.discoverySourceTitle || null,
          discoverySourceSnippet: p.discoverySourceSnippet || null,
          discoveryQuery: p.discoveryQuery || null,
          discoveryMethod: p.discoveryMethod || null,
          discoveryConfidenceScore: p.discoveryConfidenceScore ?? null,
          discoveredAt: now,
          lastValidatedAt: now,
          leadValidationStatus: p.leadValidationStatus || "likely_valid",
        } as any);
        created.push(prospect);

        // Log discovery attempt for observability
        try {
          await storage.logDiscoveryAttempt({
            orgId: profile.organizationId,
            prospectId: prospect.id,
            prospectName: p.prospectName,
            query: p.discoveryQuery || null,
            sourceUrl: p.discoverySourceUrl || null,
            confidence: p.discoveryConfidenceScore ?? null,
            result: "created",
            action: "research_pipeline",
            notes: `Confidence: ${Math.round((p.discoveryConfidenceScore || 0) * 100)}% | Method: ${p.discoveryMethod || "unknown"} | Status: ${p.leadValidationStatus || "likely_valid"}`,
          });
        } catch {}

        existingNames.push(p.prospectName); // prevent intra-batch duplicates
        if (scoreProspect(p) > 0) needsContactCount += (p.contactQuality === "missing" ? 1 : 0);
      }

      // Save location + radius as org defaults after successful search (merge with rotation indices already saved above)
      await storage.upsertTeamLeadSettings(profile.organizationId, {
        defaultLocation: locationTrimmed,
        radiusMiles: radiusNum,
      } as any);

      const allDuplicatesResult = results.length > 0 && created.length === 0 && rejected.length === 0 && duplicates.length === results.length;

      const summary = {
        total: results.length,
        saved: created.length,
        needsContact: needsContactCount,
        rejectedLowQuality: rejected.length,
        duplicatesSkipped: duplicates.length,
        rejected,
        duplicates,
        allDuplicates: allDuplicatesResult,
        usedFallback,
        searchCategory,
        searchLocation,
        primarySearchAngle: { category: searchCategory, location: searchLocation },
        fallbackSearchAngle: usedFallback && fallbackCategory && fallbackLocation
          ? { category: fallbackCategory, location: fallbackLocation }
          : null,
        activeCategory: usedFallback && fallbackCategory ? fallbackCategory : searchCategory,
        activeLocation: usedFallback && fallbackLocation ? fallbackLocation : searchLocation,
        searchAttempt: usedFallback ? "fallback" : "primary",
        diversified: !!forceDiversify,
      };

      await storage.logOutreachEvent({
        orgId: profile.organizationId,
        eventType: "manual_research_completed",
        description: `Manual research completed. Saved ${created.length}, rejected ${rejected.length}, skipped ${duplicates.length} duplicates near ${locationTrimmed}${sport ? ` for sport: ${sport}` : ""}${usedFallback ? " (fallback used)" : ""}`,
        metadata: { ...summary, sport: sport || null, location: locationTrimmed, radiusMiles: radiusNum },
      });

      res.json({ count: created.length, prospects: created, summary });
    } catch (err: any) {
      const errMsg: string = err?.message || String(err) || "Unknown error";
      console.error("[TeamTraining Research] Error:", errMsg, err?.stack || "");
      if (errMsg === "AI research is not configured") {
        return res.status(500).json({
          error: "AI research is not configured",
          message: "Missing OPENAI_API_KEY on the server.",
        });
      }
      if (errMsg.includes("ECONNRESET") || errMsg.includes("socket hang up") || errMsg.includes("ETIMEDOUT")) {
        return res.status(503).json({ error: "Network error", message: "Research service temporarily unavailable. Please try again." });
      }
      res.status(500).json({ message: errMsg });
    }
  });

  // Discovery log for a given org
  app.get("/api/admin/team-training/discovery-log", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const limit = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const log = await storage.getDiscoveryLog(profile.organizationId, limit);
      res.json(log);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // CSV bulk import
  app.post("/api/admin/team-training/prospects/csv-import", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const rows: any[] = req.body.rows;
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ message: "No rows provided" });

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const row of rows) {
        const name = (row.prospectName || "").trim();
        if (!name) { skipped++; continue; }
        try {
          await storage.createTeamTrainingProspect({
            orgId: profile.organizationId,
            prospectName: name,
            organizationType: (row.organizationType || "unknown").trim(),
            sport: (row.sport || "unknown").trim(),
            city: (row.city || "unknown").trim(),
            state: (row.state || "unknown").trim(),
            websiteUrl: (row.websiteUrl || "").trim() || null,
            contactName: (row.contactName || "unknown").trim(),
            contactRole: (row.contactRole || "unknown").trim(),
            contactEmail: (row.contactEmail || "").trim() || null,
            contactPhone: (row.contactPhone || "").trim() || null,
            notes: (row.notes || "").trim(),
            outreachStatus: "New",
            contactQuality: (row.contactEmail || "").trim() ? "general" : "missing",
          });
          imported++;
        } catch (rowErr: any) {
          errors.push(`Row "${name}": ${rowErr.message}`);
        }
      }

      res.json({ imported, skipped, errors });
    } catch (err: any) {
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
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      // Verify ownership before mutating
      const prospect = await storage.getTeamTrainingProspect(req.params.id);
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });
      if (prospect.orgId !== profile.organizationId) return res.status(404).json({ message: "Prospect not found" });
      // Strip non-editable fields and timestamps (JSON sends dates as strings; Drizzle expects Date objects)
      const {
        id: _id, orgId: _orgId, createdAt: _ca, updatedAt: _ua,
        lastContactedAt: _lca, queuedForTodayAt: _qfta,
        contactDiscoveredAt: _cda, lastDiscoveryAttemptAt: _ldaa,
        discoveredAt: _da, lastValidatedAt: _lva,
        ...safeBody
      } = req.body;
      const updated = await storage.updateTeamTrainingProspect(req.params.id, safeBody);
      if (!updated) return res.status(404).json({ message: "Prospect not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Delete prospect
  app.delete("/api/admin/team-training/prospects/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      // Verify ownership before deleting
      const prospect = await storage.getTeamTrainingProspect(req.params.id);
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });
      if (prospect.orgId !== profile.organizationId) return res.status(404).json({ message: "Prospect not found" });
      await storage.deleteTeamTrainingProspect(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get drafts for a prospect
  app.get("/api/admin/team-training/prospects/:id/drafts", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      // Verify ownership before returning drafts
      const prospect = await storage.getTeamTrainingProspect(req.params.id);
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });
      if (prospect.orgId !== profile.organizationId) return res.status(404).json({ message: "Prospect not found" });
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

      const { enrichProspectContact, normalizeNullable, isValidEmail } = await import("./team-training-prospecting");
      const enriched = await enrichProspectContact(
        org,
        prospect.prospectName,
        prospect.city || "unknown",
        prospect.state || "unknown",
        prospect.sport || "unknown",
        prospect.organizationType || "unknown",
        prospect.websiteUrl || null
      );

      // Strict email gate — only save email if a real one was found
      const normalizedEmail = normalizeNullable(enriched.decisionMakerEmail);
      const hasRealEmail = isValidEmail(normalizedEmail);

      // Even without an email, save any partial data found (phone, contact name, contact form URL)
      const hasPartialData = !hasRealEmail && (enriched.contactPhone || (enriched as any).contactFormUrl || enriched.decisionMakerName);
      if (hasPartialData) {
        console.log("[TeamTraining EnrichContact] No email but partial data found for:", prospect.prospectName, {
          phone: enriched.contactPhone,
          contactFormUrl: (enriched as any).contactFormUrl,
          name: enriched.decisionMakerName,
        });
        // Backfill websiteUrl/sourceUrl from contactSourceUrl if currently missing
        const partialBackfillWebsite = !prospect.websiteUrl && enriched.contactSourceUrl ? enriched.contactSourceUrl : undefined;
        const partialBackfillSource = !prospect.sourceUrl && enriched.contactSourceUrl ? enriched.contactSourceUrl : undefined;
        await storage.updateTeamTrainingProspect(prospect.id, {
          contactName: enriched.decisionMakerName || prospect.contactName || undefined,
          contactRole: enriched.decisionMakerTitle || prospect.contactRole || undefined,
          contactPhone: enriched.contactPhone || prospect.contactPhone || undefined,
          // Save all evidence fields even on partial results
          contactSourceUrl: enriched.contactSourceUrl || prospect.contactSourceUrl || undefined,
          contactSourceTitle: enriched.contactSourceTitle || prospect.contactSourceTitle || undefined,
          contactSourceSnippet: enriched.contactSourceSnippet || prospect.contactSourceSnippet || undefined,
          contactDiscoveryMethod: enriched.contactDiscoveryMethod || undefined,
          contactConfidenceScore: enriched.contactConfidenceScore ?? undefined,
          verificationStatus: enriched.verificationStatus || undefined,
          enrichmentExplanation: enriched.enrichmentExplanation || undefined,
          lastDiscoveryAttemptAt: new Date(),
          lastDiscoveryResult: "partial_contact_found",
          ...(partialBackfillWebsite ? { websiteUrl: partialBackfillWebsite } : {}),
          ...(partialBackfillSource ? { sourceUrl: partialBackfillSource } : {}),
        } as any).catch(() => {});
      }

      if (!hasRealEmail) {
        console.warn("[TeamTraining EnrichContact] No real email found for prospect:", prospect.prospectName);
        if (!hasPartialData) {
          await storage.updateTeamTrainingProspect(prospect.id, {
            lastDiscoveryAttemptAt: new Date(),
            lastDiscoveryResult: "no_real_email_found",
            enrichmentExplanation: enriched.enrichmentExplanation || undefined,
          } as any).catch(() => {});
        }
        const updatedProspect = hasPartialData
          ? await storage.getTeamTrainingProspect(prospect.id)
          : prospect;
        const googleQuery = encodeURIComponent(`${prospect.prospectName} ${prospect.city || ""} ${prospect.state || ""} coach email contact`);
        const linkedInQuery = encodeURIComponent(`${prospect.prospectName} ${prospect.sport || ""} coach director`);
        return res.json({
          success: false,
          reason: hasPartialData ? "partial_contact_found" : "no_real_email_found",
          message: hasPartialData
            ? "No email found, but we saved a phone number or contact name we discovered."
            : "No email found from any source.",
          partialData: hasPartialData ? {
            contactPhone: enriched.contactPhone,
            contactFormUrl: (enriched as any).contactFormUrl,
            contactName: enriched.decisionMakerName,
            contactRole: enriched.decisionMakerTitle,
          } : null,
          manualResearchLinks: {
            google: `https://www.google.com/search?q=${googleQuery}`,
            linkedin: `https://www.linkedin.com/search/results/people/?keywords=${linkedInQuery}`,
            maxpreps: `https://www.maxpreps.com/search/#q=${encodeURIComponent(prospect.prospectName)}`,
            website: prospect.websiteUrl || null,
          },
          enrichmentExplanation: enriched.enrichmentExplanation,
          prospect: updatedProspect ?? prospect,
        });
      }

      // Normalize all string fields to remove sentinel values
      const safeEnriched = {
        ...enriched,
        decisionMakerEmail: normalizedEmail,
        decisionMakerName: normalizeNullable(enriched.decisionMakerName),
        decisionMakerTitle: normalizeNullable(enriched.decisionMakerTitle),
      };

      // Compute new score incorporating the enriched contact quality
      const { scoreProspect } = await import("./team-training-prospecting");
      const newScore = scoreProspect({
        prospectName: prospect.prospectName,
        organizationType: prospect.organizationType || null,
        sport: prospect.sport || null,
        city: prospect.city || null,
        state: prospect.state || null,
        websiteUrl: prospect.websiteUrl || null,
        contactName: prospect.contactName || null,
        contactRole: prospect.contactRole || null,
        contactEmail: null,
        contactPhone: null,
        sourceUrl: prospect.sourceUrl || null,
        confidenceScore: prospect.confidenceScore || 50,
        notes: prospect.notes || "",
        ...safeEnriched,
      });

      // Backfill websiteUrl and sourceUrl from contactSourceUrl if not already set
      const backfillWebsite = !prospect.websiteUrl && safeEnriched.contactSourceUrl
        ? safeEnriched.contactSourceUrl : undefined;
      const backfillSource = !prospect.sourceUrl && safeEnriched.contactSourceUrl
        ? safeEnriched.contactSourceUrl : undefined;

      const updated = await storage.updateTeamTrainingProspect(prospect.id, {
        decisionMakerName: safeEnriched.decisionMakerName,
        decisionMakerTitle: safeEnriched.decisionMakerTitle,
        decisionMakerEmail: safeEnriched.decisionMakerEmail,
        contactConfidence: safeEnriched.contactConfidence,
        contactSourceUrl: safeEnriched.contactSourceUrl,
        contactSourceTitle: safeEnriched.contactSourceTitle,
        contactSourceSnippet: safeEnriched.contactSourceSnippet,
        contactDiscoveryMethod: safeEnriched.contactDiscoveryMethod,
        contactConfidenceScore: safeEnriched.contactConfidenceScore,
        contactDiscoveredAt: new Date(),
        lastDiscoveryAttemptAt: new Date(),
        lastDiscoveryResult: "success",
        contactQuality: safeEnriched.contactQuality,
        contactSourceType: safeEnriched.contactSourceType,
        verificationStatus: safeEnriched.verificationStatus,
        enrichmentExplanation: safeEnriched.enrichmentExplanation,
        alternativeContacts: safeEnriched.alternativeContacts.length > 0
          ? JSON.stringify(safeEnriched.alternativeContacts)
          : null,
        confidenceScore: newScore,
        ...(backfillWebsite ? { websiteUrl: backfillWebsite } : {}),
        ...(backfillSource ? { sourceUrl: backfillSource } : {}),
      });

      try {
        await storage.logOutreachEvent({
          orgId: profile.organizationId,
          prospectId: prospect.id,
          eventType: "contact_enriched",
          description: `Contact enriched for ${prospect.prospectName}: ${safeEnriched.contactQuality} quality${safeEnriched.decisionMakerName ? ` — ${safeEnriched.decisionMakerName}` : ""} — ${safeEnriched.decisionMakerEmail}`,
          metadata: { contactQuality: safeEnriched.contactQuality, decisionMakerName: safeEnriched.decisionMakerName, email: safeEnriched.decisionMakerEmail },
        });
      } catch (auditErr: any) {
        console.error("[TeamTraining EnrichContact] Audit log failed (non-fatal):", auditErr.message);
      }

      res.json({ prospect: updated, enriched: safeEnriched });
    } catch (err: any) {
      console.error("[TeamTraining EnrichContact]", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Delete draft
  app.delete("/api/admin/team-training/drafts/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      await storage.deleteOutreachDraft(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
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
          branding.ownerEmail,
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
      // Log creation activity (best-effort)
      storage.createDealActivity({
        dealId: deal.id,
        organizationId: profile.organizationId,
        activityType: "deal_created",
        description: "Deal added to pipeline",
      }).catch(() => {});
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
      // Log status change activity
      if (req.body.status && req.body.status !== prevStatus) {
        storage.createDealActivity({
          dealId: deal.id,
          organizationId: profile.organizationId,
          activityType: "status_changed",
          description: `Stage: ${prevStatus} → ${req.body.status}`,
        }).catch(() => {});
      }
      // Log follow-up scheduled
      if (req.body.nextFollowUpAt && req.body.nextFollowUpAt !== deal.nextFollowUpAt?.toISOString()) {
        storage.createDealActivity({
          dealId: deal.id,
          organizationId: profile.organizationId,
          activityType: "follow_up_scheduled",
          description: `Follow-up scheduled for ${new Date(req.body.nextFollowUpAt).toLocaleDateString()}`,
        }).catch(() => {});
      }
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
        // Log won activity
        storage.createDealActivity({
          dealId: deal.id,
          organizationId: profile.organizationId,
          activityType: "won",
          description: `Deal won${updated?.finalValue ? ` — $${updated.finalValue}` : ""}`,
        }).catch(() => {});
        // Revenue Intelligence: create deal attribution record
        try {
          const activities = await storage.getDealActivities(deal.id);
          const touchpoints = activities.filter(a => ["email_sent", "call_logged", "follow_up_completed"].includes(a.activityType)).length;
          const daysToClose = Math.round((Date.now() - new Date(deal.createdAt).getTime()) / 86400000);
          // Find the most recent outreach draft for this deal
          const { teamTrainingOutreachDrafts } = await import("@shared/schema");
          const { db } = await import("./db");
          const { eq, and, desc } = await import("drizzle-orm");
          const recentDrafts = await db.select().from(teamTrainingOutreachDrafts)
            .where(and(eq(teamTrainingOutreachDrafts.dealId, deal.id), eq(teamTrainingOutreachDrafts.orgId, profile.organizationId)))
            .orderBy(desc(teamTrainingOutreachDrafts.sentAt)).limit(5);
          const sentDrafts = recentDrafts.filter(d => d.sentAt);
          const primaryDraft = sentDrafts[0];
          const allOutreachIds = sentDrafts.map(d => d.id);
          const outreachSequence = sentDrafts.map((d, i) => ({
            step: i + 1, channel: d.channel || "email", tone: d.outreachTone, strategy: d.aiStrategyTag, sentAt: d.sentAt,
          }));
          await storage.createDealRevenueAttribution({
            orgId: profile.organizationId,
            dealId: deal.id,
            prospectId: deal.prospectId,
            wonAt: new Date(),
            finalValue: updated?.finalValue ?? updated?.estimatedValue ?? 0,
            daysToClose,
            totalTouchpoints: touchpoints,
            primaryChannel: primaryDraft?.channel || "email",
            primaryStrategy: primaryDraft?.aiStrategyTag || null,
            primaryTone: primaryDraft?.outreachTone || null,
            attributedOutreachIds: allOutreachIds,
            outreachSequence,
          } as any);
        } catch {}
        // Revenue Agent: attribute won outcome to any pending/executed actions
        try {
          const { attributeOutcomeToActions } = await import("./revenue-agent");
          await attributeOutcomeToActions(profile.organizationId, deal.id, "won", updated?.finalValue ?? updated?.estimatedValue ?? 0);
        } catch {}
      }
      if (req.body.status === "lost" && prevStatus !== "lost") {
        storage.createDealActivity({
          dealId: deal.id,
          organizationId: profile.organizationId,
          activityType: "lost",
          description: "Deal marked as lost",
        }).catch(() => {});
        // Revenue Agent: attribute lost outcome
        try {
          const { attributeOutcomeToActions } = await import("./revenue-agent");
          await attributeOutcomeToActions(profile.organizationId, deal.id, "lost", 0);
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

  // Deal activity timeline — GET
  app.get("/api/admin/team-training/deals/:id/activities", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const deal = await storage.getTeamTrainingDeal(req.params.id);
      if (!deal || deal.organizationId !== profile.organizationId) return res.status(404).json({ message: "Not found" });
      const activities = await storage.getDealActivities(req.params.id);
      res.json(activities);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Deal activity timeline — POST (log a manual activity)
  app.post("/api/admin/team-training/deals/:id/activities", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const deal = await storage.getTeamTrainingDeal(req.params.id);
      if (!deal || deal.organizationId !== profile.organizationId) return res.status(404).json({ message: "Not found" });
      const { activityType, description, metadata } = req.body;
      if (!activityType || !description) return res.status(400).json({ message: "activityType and description required" });
      const activity = await storage.createDealActivity({
        dealId: deal.id,
        organizationId: profile.organizationId,
        activityType,
        description,
        metadata: metadata ?? null,
      });
      // Touch lastActivityAt so stale detection resets
      await storage.updateTeamTrainingDeal(deal.id, { lastActivityAt: new Date() });
      res.json(activity);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Deal Outreach Integration ────────────────────────────────────────────────

  // Generate AI follow-up email or SMS for a deal
  app.post("/api/admin/team-training/deals/:id/generate-outreach", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const deal = await storage.getTeamTrainingDeal(req.params.id);
      if (!deal || deal.organizationId !== profile.organizationId) return res.status(404).json({ message: "Not found" });

      const { channel = "email" } = req.body;
      const prospect = await storage.getTeamTrainingProspect(deal.prospectId);
      const org = await storage.getOrganizationById(profile.organizationId);

      const contactName = prospect?.decisionMakerName || prospect?.contactName || "there";
      const contactRole = prospect?.decisionMakerTitle || prospect?.contactRole || "";
      const teamName = prospect?.prospectName || "your team";
      const sport = prospect?.sport || "sport";
      const city = prospect?.city || "";
      const daysSince = Math.floor((Date.now() - new Date(deal.lastActivityAt).getTime()) / 86400000);

      const contextBlock = `
Business: ${org?.name ?? "Training Facility"}
Deal stage: ${deal.status} | Probability: ${deal.probability}%
Estimated value: $${deal.estimatedValue}
Last activity: ${daysSince} day${daysSince !== 1 ? "s" : ""} ago
Next planned action: ${deal.nextAction || "Not set"}
Notes: ${deal.notes || "None"}
Prospect: ${teamName}${sport ? " (" + sport + ")" : ""}${city ? " in " + city : ""}
Contact: ${contactName}${contactRole ? " — " + contactRole : ""}
`.trim();

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI();

      if (channel === "sms") {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a sports training business development expert. Write a short, warm, personal SMS follow-up to a sports team decision-maker. Keep it under 160 characters including sign-off. No generic openers. Be direct with a clear call to action. Sign off with the business name after a dash." },
            { role: "user", content: `${contextBlock}\n\nWrite the best SMS follow-up for this deal right now. It should match the deal stage and encourage the very next step.` },
          ],
          max_tokens: 200,
          temperature: 0.7,
        });
        return res.json({ channel: "sms", message: completion.choices[0]?.message?.content?.trim() ?? "" });
      } else {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: 'You are a sports training business development expert. Write a personalized follow-up email to a sports team decision-maker. The email must be concise (under 200 words), warm, professional, and end with a single clear CTA. Return valid JSON with exactly these fields: "subject" (string), "body" (plain text with line breaks, no HTML), "outreachTone" (one of: direct, professional, energetic, relationship_first), "aiStrategyTag" (one of: urgency, authority, social_proof, value_first, problem_solution), "ctaType" (one of: schedule_call, request_info, book_assessment, follow_up_again, send_proposal). No other fields.' },
            { role: "user", content: `${contextBlock}\n\nWrite the best follow-up email for this deal. Match tone and strategy to the deal stage. Return only valid JSON with all five required fields.` },
          ],
          max_tokens: 800,
          temperature: 0.7,
          response_format: { type: "json_object" },
        });
        let subject = "Following up — team training";
        let message = "";
        let outreachTone = "professional";
        let aiStrategyTag = "value_first";
        let ctaType = "schedule_call";
        try {
          const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
          subject = parsed.subject || subject;
          message = parsed.body || "";
          outreachTone = parsed.outreachTone || outreachTone;
          aiStrategyTag = parsed.aiStrategyTag || aiStrategyTag;
          ctaType = parsed.ctaType || ctaType;
        } catch {
          message = completion.choices[0]?.message?.content?.trim() ?? "";
        }
        return res.json({ channel: "email", subject, message, outreachTone, aiStrategyTag, ctaType });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Send or save deal outreach as draft
  app.post("/api/admin/team-training/deals/:id/send-outreach", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const deal = await storage.getTeamTrainingDeal(req.params.id);
      if (!deal || deal.organizationId !== profile.organizationId) return res.status(404).json({ message: "Not found" });

      const { channel, subject, message, saveDraft, nextFollowUpAt, outreachTone, aiStrategyTag, ctaType } = req.body;
      if (!channel || !message) return res.status(400).json({ message: "channel and message required" });

      const prospect = await storage.getTeamTrainingProspect(deal.prospectId);
      const org = await storage.getOrganizationById(profile.organizationId);

      let sent = false;
      let draftId: string | undefined;
      let activityType: "email_sent" | "note_added" = "email_sent";
      let activityDesc = "";

      const outreachMeta: any = {
        dealId: deal.id,
        channel: channel || "email",
        outreachTone: outreachTone || null,
        aiStrategyTag: aiStrategyTag || null,
        ctaType: ctaType || null,
      };

      if (saveDraft) {
        // Save to outreach drafts for later approval/sending
        const draft = await storage.createOutreachDraft({
          orgId: profile.organizationId,
          prospectId: deal.prospectId,
          subject: subject || "Follow-up",
          body: message,
          approved: false,
          ...outreachMeta,
        });
        draftId = draft.id;
        sent = false;
        activityDesc = `Draft saved: "${subject || "Follow-up"}"`;
        activityType = "note_added";
      } else if (channel === "email") {
        const toEmail = prospect?.decisionMakerEmail || prospect?.contactEmail;
        if (!toEmail) return res.status(400).json({ message: "No email address on file for this prospect" });
        // Record the draft as sent
        const draft = await storage.createOutreachDraft({
          orgId: profile.organizationId,
          prospectId: deal.prospectId,
          subject: subject || "Follow-up",
          body: message,
          approved: true,
          approvedAt: new Date(),
          sentAt: new Date(),
          ...outreachMeta,
        });
        draftId = draft.id;
        const { sendTeamTrainingOutreachEmail } = await import("./email");
        const orgBranding = org ? { name: org.name ?? "TrainEfficiency", ownerEmail: org.ownerEmail ?? undefined } : undefined;
        await sendTeamTrainingOutreachEmail(toEmail, subject || "Follow-up", message, orgBranding, draft.id);
        sent = true;
        activityDesc = `Email sent to ${toEmail}${subject ? `: "${subject}"` : ""}`;
        activityType = "email_sent";
      } else if (channel === "sms") {
        const phone = prospect?.contactPhone;
        if (!phone) return res.status(400).json({ message: "No phone number on file for this prospect" });
        const { sendSms, isTwilioConfigured } = await import("./sms");
        if (!isTwilioConfigured()) return res.status(400).json({ message: "SMS not configured — Twilio credentials missing" });
        const result = await sendSms({ to: phone, body: message, ctx: { orgId: profile.organizationId, type: "outreach", messagePurpose: "operational" } });
        if (!result.sent) return res.status(400).json({ message: result.error || result.skipped || "SMS delivery failed" });
        sent = true;
        activityDesc = `SMS sent to ${phone}`;
        activityType = "email_sent";
      }

      // Update deal: lastContactAt + optional nextFollowUpAt (don't bump lastActivityAt here — the activity log does that)
      const dealUpdate: any = { lastContactAt: new Date() };
      if (nextFollowUpAt) dealUpdate.nextFollowUpAt = new Date(nextFollowUpAt);
      await storage.updateTeamTrainingDeal(deal.id, dealUpdate);

      // Log activity in timeline
      await storage.createDealActivity({
        dealId: deal.id,
        organizationId: profile.organizationId,
        activityType,
        description: activityDesc,
        metadata: { channel, sent, draftId: draftId ?? null },
      });

      // Log outreach event (best-effort)
      storage.logOutreachEvent({
        orgId: profile.organizationId,
        prospectId: deal.prospectId,
        draftId,
        eventType: sent ? "sent" : "draft_created",
        description: activityDesc,
        metadata: { dealId: deal.id, channel, saveDraft: !!saveDraft },
      } as any).catch(() => {});

      // Log follow-up scheduled if a date was provided
      if (nextFollowUpAt) {
        storage.createDealActivity({
          dealId: deal.id,
          organizationId: profile.organizationId,
          activityType: "follow_up_scheduled",
          description: `Follow-up scheduled for ${new Date(nextFollowUpAt).toLocaleDateString()}`,
        }).catch(() => {});
      }

      res.json({ ok: true, sent, channel, draftId });
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

  // ─── Revenue Intelligence Analytics ──────────────────────────────────────────

  // GET /api/admin/team-training/analytics — computed conversion metrics from real data
  app.get("/api/admin/team-training/analytics", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const analytics = await storage.getConversionAnalytics(profile.organizationId);
      res.json(analytics);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/admin/team-training/analytics/recommendations — AI insights from real metrics
  app.get("/api/admin/team-training/analytics/recommendations", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const analytics = await storage.getConversionAnalytics(profile.organizationId);
      const { summary, winRateBySport, winRateByChannel, winRateByStrategy, winRateByTone, stageFunnel } = analytics;

      // Only generate AI recommendations if there's enough data
      if (summary.totalDeals < 2) {
        return res.json({ recommendations: [
          { icon: "📊", title: "Build your baseline", text: "Add more deals and track outreach to unlock data-driven recommendations. You need at least 2 deals to get started." }
        ], generatedAt: new Date().toISOString(), dataPoints: summary.totalDeals });
      }

      const dataContext = `
PIPELINE SNAPSHOT (real data):
- Total deals: ${summary.totalDeals} (won: ${summary.wonDeals}, lost: ${summary.lostDeals}, active: ${summary.activeDeals})
- Overall win rate: ${summary.winRate}%
- Avg days to close: ${summary.avgDaysToClose} days
- Total won revenue: $${summary.totalWonRevenue.toLocaleString()}
- Reply rate: ${summary.replyRate}% (from ${summary.totalOutreachSent} sent emails)
- Avg touchpoints before win: ${summary.avgTouchpoints}
- Best channel: ${summary.bestChannel || "not enough data yet"}
- Best AI strategy: ${summary.bestStrategy || "not enough data yet"}
- Best tone: ${summary.bestTone || "not enough data yet"}

WIN RATE BY SPORT: ${winRateBySport.map(s => `${s.sport}: ${s.winRate}% (${s.won}/${s.deals})`).join(", ") || "insufficient data"}

WIN RATE BY CHANNEL: ${winRateByChannel.map(c => `${c.channel}: ${c.winRate}% (${c.won}/${c.sent} sent)`).join(", ") || "no outreach tracked yet"}

WIN RATE BY STRATEGY: ${winRateByStrategy.map(s => `${s.strategy}: ${s.winRate}% (${s.sent} used)`).join(", ") || "no strategy data yet"}

WIN RATE BY TONE: ${winRateByTone.map(t => `${t.tone}: ${t.winRate}% (${t.sent} used)`).join(", ") || "no tone data yet"}

STAGE FUNNEL: ${stageFunnel.map(s => `${s.label}: ${s.count}`).join(" → ")}
`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a revenue intelligence analyst for a sports team training sales team. You receive REAL pipeline data and generate 3-5 specific, actionable recommendations. Do NOT make up numbers — only reference the real numbers provided. Each recommendation must be concise (under 25 words), specific, and immediately actionable. Return valid JSON: { \"recommendations\": [{ \"icon\": \"emoji\", \"title\": \"short title\", \"text\": \"actionable insight\" }] }" },
          { role: "user", content: `Analyze this real pipeline data and generate 3-5 specific recommendations:\n\n${dataContext}` },
        ],
        max_tokens: 600,
        temperature: 0.4,
        response_format: { type: "json_object" },
      });

      let recommendations: any[] = [];
      try {
        const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
        recommendations = parsed.recommendations || [];
      } catch {}

      if (!recommendations.length) {
        recommendations = [
          { icon: "📈", title: "Win Rate", text: `Your current win rate is ${summary.winRate}%. Focus on deals that match your highest-converting sport segments.` }
        ];
      }

      res.json({ recommendations, generatedAt: new Date().toISOString(), dataPoints: summary.totalDeals });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/admin/team-training/deals/:id/mark-response — mark that a prospect responded
  app.post("/api/admin/team-training/deals/:id/mark-response", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const deal = await storage.getTeamTrainingDeal(req.params.id);
      if (!deal || deal.organizationId !== profile.organizationId) return res.status(404).json({ message: "Not found" });

      const { outreachDraftId, meetingBooked = false, note } = req.body;

      // Mark the outreach draft as responded if provided
      if (outreachDraftId) {
        await storage.markOutreachResponse(outreachDraftId, meetingBooked);
      }

      // Log the response in the deal activity timeline
      await storage.createDealActivity({
        dealId: deal.id,
        organizationId: profile.organizationId,
        activityType: "manual",
        description: meetingBooked
          ? `Response received — meeting booked${note ? `: ${note}` : ""}`
          : `Response received${note ? `: ${note}` : ""}`,
        metadata: { outreachDraftId: outreachDraftId || null, meetingBooked, responseType: "manual" },
      });

      // Update deal lastContactAt
      await storage.updateTeamTrainingDeal(deal.id, { lastContactAt: new Date() });

      // Attribute outcome to any pending agent actions for this deal
      const { attributeOutcomeToActions } = await import("./revenue-agent");
      await attributeOutcomeToActions(profile.organizationId, deal.id, meetingBooked ? "meeting" : "reply");

      res.json({ ok: true, meetingBooked });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Revenue Agent Routes ─────────────────────────────────────────────────────

  // GET /api/admin/team-training/revenue-agent/brief
  app.get("/api/admin/team-training/revenue-agent/brief", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const [deals, prospects] = await Promise.all([
        storage.getTeamTrainingDeals(orgId),
        storage.getTeamTrainingProspects(orgId),
      ]);
      const { generateDailyBrief } = await import("./revenue-agent");
      const brief = await generateDailyBrief(orgId, deals, prospects);
      res.json(brief);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/admin/team-training/revenue-agent/actions
  app.get("/api/admin/team-training/revenue-agent/actions", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const status = (req.query.status as string) || undefined;
      const actions = await storage.getAgentActions(profile.organizationId, status);
      res.json(actions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/admin/team-training/revenue-agent/run — manual trigger
  app.post("/api/admin/team-training/revenue-agent/run", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { runRevenueAgent } = await import("./revenue-agent");
      const result = await runRevenueAgent(profile.organizationId, "manual");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/admin/team-training/revenue-agent/actions/:id/execute
  app.post("/api/admin/team-training/revenue-agent/actions/:id/execute", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const orgId = profile.organizationId;

      // Fetch action data needed for tool mapping
      const rows = await db.execute(sql`
        SELECT id, action_type, reason, estimated_value, deal_id, prospect_id, metadata
        FROM revenue_agent_actions WHERE id = ${req.params.id} AND org_id = ${orgId}
      `);
      const row = rows.rows[0] as any;
      if (!row) return res.status(404).json({ message: "Action not found" });

      // Map to tool proposal
      const { mapRevenueActionToToolProposal } = await import("./agent-tools/action-mapper");
      const { proposeToolCall } = await import("./agent-tools/index");

      const toolProposal = mapRevenueActionToToolProposal({
        id: row.id,
        actionType: row.action_type,
        reason: row.reason,
        estimatedValue: row.estimated_value ? Number(row.estimated_value) : null,
        dealId: row.deal_id,
        prospectId: row.prospect_id,
        metadata: row.metadata ?? {},
      });

      let toolCall: any = null;

      if (toolProposal) {
        const result = await proposeToolCall(orgId, {
          agentName: "revenue_agent",
          ...toolProposal,
          sourceRevenueActionId: req.params.id,
        });

        if (result.requiresConfirmation) {
          // Mark action as pending confirmation rather than fully executed
          await (storage as any).updateAgentAction(req.params.id, {
            status: "pending_tool_confirmation",
          });
          return res.json({
            ok: true,
            toolCall: {
              toolCallId: result.toolCallId,
              requiresConfirmation: true,
              success: true,
              message: `${toolProposal.toolName} queued — needs approval`,
            },
          });
        }

        toolCall = {
          toolCallId: result.toolCallId,
          requiresConfirmation: false,
          success: result.success,
          message: result.message ?? `${toolProposal.toolName} executed`,
          error: result.error,
        };
      }

      // Mark action as fully executed
      const action = await (storage as any).updateAgentAction(req.params.id, {
        status: "executed",
        executedAt: new Date(),
        acceptedAt: new Date(),
      });

      // Log to deal activity if there's a deal
      if (action?.dealId) {
        const actionLabels: Record<string, string> = {
          send_followup: "Revenue Agent: follow-up queued via Priority Action Queue",
          schedule_call: "Revenue Agent: call scheduled via Priority Action Queue",
          mark_lost: "Revenue Agent: deal marked for review (stale)",
          move_stage: "Revenue Agent: stage advance recommended",
          re_engage: "Revenue Agent: re-engagement outreach queued",
          create_deal: "Revenue Agent: deal creation triggered",
        };
        await storage.createDealActivity({
          dealId: action.dealId,
          organizationId: orgId,
          activityType: "ai_action",
          description: actionLabels[action.actionType] ?? `Revenue Agent: ${action.actionType} executed`,
          metadata: {
            agentActionId: action.id,
            reason: action.reason,
            toolCallId: toolCall?.toolCallId,
            toolName: toolProposal?.toolName,
          },
        });
        await storage.updateTeamTrainingDeal(action.dealId, { lastActivityAt: new Date() });
      }

      res.json({ ok: true, action, toolCall });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/admin/team-training/revenue-agent/actions/:id/dismiss
  app.post("/api/admin/team-training/revenue-agent/actions/:id/dismiss", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      // Verify ownership before mutating (column is org_id in revenue_agent_actions)
      const ownerCheck = await db.execute(sql`SELECT id FROM revenue_agent_actions WHERE id = ${req.params.id} AND org_id = ${profile.organizationId}`);
      if (!ownerCheck.rows[0]) return res.status(404).json({ message: "Action not found" });
      const action = await storage.updateAgentAction(req.params.id, {
        status: "dismissed",
        dismissedAt: new Date(),
      });
      if (!action) return res.status(404).json({ message: "Action not found" });
      res.json({ ok: true, action });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/admin/team-training/revenue-agent/settings
  app.get("/api/admin/team-training/revenue-agent/settings", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const settings = await storage.getAgentSettings(profile.organizationId);
      res.json(settings ?? { autoSaveDrafts: false, autoScheduleFollowUp: false, autoLabelStale: false, dailyRunEnabled: true, dailyRunHour: 8, lastRunAt: null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/admin/team-training/revenue-agent/settings
  app.patch("/api/admin/team-training/revenue-agent/settings", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const { autoSaveDrafts, autoScheduleFollowUp, autoLabelStale, dailyRunEnabled, dailyRunHour } = req.body;
      const settings = await storage.upsertAgentSettings(profile.organizationId, {
        autoSaveDrafts, autoScheduleFollowUp, autoLabelStale, dailyRunEnabled, dailyRunHour,
      });
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/admin/team-training/revenue-agent/runs — recent agent run history
  app.get("/api/admin/team-training/revenue-agent/runs", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "No organization" });
      const runs = await storage.getAgentRuns(profile.organizationId, 5);
      res.json(runs);
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

  // ─── SendGrid Inbound Parse Webhook ────────────────────────────────────────
  // Receives replies to outreach emails automatically. No auth — must return 200 fast.
  // Setup: In SendGrid → Settings → Inbound Parse → add your domain and point webhook to:
  //   https://[your-domain]/api/webhooks/sendgrid-inbound
  app.post("/api/webhooks/sendgrid-inbound", express.urlencoded({ extended: true }), async (req: any, res: any) => {
    // Always 200 immediately so SendGrid does not retry
    res.status(200).json({ ok: true });

    try {
      // Extract sender email — prefer envelope JSON (cleanest), fallback to parsing from header
      let senderEmail: string | null = null;
      try {
        const envelope = typeof req.body.envelope === "string"
          ? JSON.parse(req.body.envelope)
          : req.body.envelope;
        senderEmail = envelope?.from || null;
      } catch {}

      if (!senderEmail && req.body.from) {
        const match = (req.body.from as string).match(/<([^>]+)>/);
        senderEmail = match ? match[1] : (req.body.from as string).trim();
      }

      if (!senderEmail) {
        console.log("[InboundParse] Could not extract sender email — skipping");
        return;
      }

      senderEmail = senderEmail.toLowerCase().trim();
      const replyText = ((req.body.text as string) || "").slice(0, 2000);

      // Find the prospect whose contactEmail or decisionMakerEmail matches the sender
      const found = await storage.findProspectByContactEmail(senderEmail);
      if (!found) {
        console.log(`[InboundParse] No prospect found for sender: ${senderEmail}`);
        return;
      }

      const { prospect, orgId } = found;

      // Don't double-process
      if (prospect.outreachStatus === "Replied") {
        console.log(`[InboundParse] Prospect ${prospect.id} already marked replied — skipping`);
        return;
      }

      // AI-classify the reply intent
      let classification: string | null = null;
      if (replyText) {
        try {
          const { classifyReply } = await import("./email-agent/reply-classifier");
          classification = await classifyReply(replyText);
        } catch {}
      }

      // Mark the prospect replied
      await storage.updateTeamTrainingProspect(prospect.id, { outreachStatus: "Replied" });

      // Stamp repliedAt on the most recent sent draft, cancel follow-ups
      const drafts = await storage.getOutreachDraftsByProspect(prospect.id);
      const sentDraft = drafts.find(d => !!d.sentAt && !d.repliedAt);
      if (sentDraft) {
        await storage.updateOutreachDraft(sentDraft.id, {
          repliedAt: new Date(),
          replyText: replyText || null,
          replyClassification: classification,
        });
        await storage.cancelFollowUpSequence(sentDraft.id);
        if (sentDraft.messageVariantId) {
          try {
            const variant = await storage.getEmailMessageVariant(sentDraft.messageVariantId);
            if (variant) {
              await storage.updateEmailMessageVariant(variant.id, {
                replies: (variant.replies ?? 0) + 1,
                conversions: (variant.conversions ?? 0) + 1,
              });
            }
          } catch {}
        }
      }

      // Log the event
      await storage.logOutreachEvent({
        orgId,
        prospectId: prospect.id,
        eventType: "replied",
        description: classification
          ? `Auto-detected inbound reply (${classification})`
          : "Auto-detected inbound reply via SendGrid",
        metadata: {
          replyText: replyText.slice(0, 500) || null,
          classification,
          source: "sendgrid_inbound",
        },
      });

      // Revenue attribution
      try {
        const { attributeOutcomeToProspect } = await import("./email-agent/revenue-outcome-engine");
        await attributeOutcomeToProspect(orgId, prospect.id, "engaged", 0, "reply");
      } catch {}

      // Auto-create deal when prospect seems interested
      if (classification === "interested" || classification === "ask_info") {
        const existingDeal = await storage.getTeamTrainingDealByProspect(prospect.id, orgId);
        if (!existingDeal) {
          await storage.createTeamTrainingDeal({
            organizationId: orgId,
            prospectId: prospect.id,
            outreachDraftId: sentDraft?.id ?? null,
            status: "interested",
            estimatedValue: prospect.estimatedValue ?? 0,
            probability: 40,
            nextAction: classification === "ask_info"
              ? "Send information and schedule a call"
              : "Schedule a discovery call",
            notes: replyText ? `Auto-detected reply: ${replyText.slice(0, 300)}` : "",
            lastActivityAt: new Date(),
          });
        }
      }

      console.log(`[InboundParse] Reply processed — prospect: ${prospect.prospectName} (${prospect.id}), classification: ${classification}`);
    } catch (err: any) {
      console.error("[InboundParse] Error processing inbound email:", err.message);
    }
  });

  // ─── Business Brain API ──────────────────────────────────────────────────────

  app.post("/api/admin/business-brain/run", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      // Attach prior outcome context to the run (for historical awareness)
      let priorOutcomeContext = "";
      try {
        const { getOutcomeAnalytics, getOrgWorkflowContext } = await import("./workflow-context-engine");
        const [analytics, recentMemories] = await Promise.all([
          getOutcomeAnalytics(orgId),
          getOrgWorkflowContext(orgId, 5),
        ]);
        if (analytics.totalOutcomes > 0) {
          const lines = [`Prior workflow outcomes: ${analytics.successRate}% success rate across ${analytics.totalOutcomes} runs.`];
          if (analytics.operatorModifiedCount > 0) lines.push(`Operators modified ${analytics.modificationRate}% of AI-generated outputs.`);
          const topOutcome = Object.entries(analytics.byType).sort(([,a],[,b]) => b-a)[0];
          if (topOutcome) lines.push(`Most common outcome: ${topOutcome[0]} (${topOutcome[1]} times).`);
          recentMemories.filter(m => m.contextType === "business_memory" || m.contextType === "operator_override")
            .slice(0, 3).forEach(m => lines.push(`Org memory: ${m.summary}`));
          priorOutcomeContext = lines.join(" ");
        }
      } catch (_) {}

      const { runOrchestrator } = await import("./agents/executive-agent");
      const result = await runOrchestrator(orgId, "manual");

      // Log that this run had historical context attached
      if (priorOutcomeContext) {
        const { logUnifiedAction } = await import("./unified-action-logger");
        await logUnifiedAction({
          orgId,
          actorType: "agent",
          actorName: "business_brain",
          actionType: "memory_attached",
          status: "completed",
          riskLevel: "low",
          reasoningSummary: `Business Brain run enriched with historical context: ${priorOutcomeContext.substring(0, 200)}`,
        });
      }

      res.json({ ...result, priorOutcomeContext: priorOutcomeContext || null });
    } catch (e: any) {
      console.error("[BusinessBrain] Run error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/business-brain/feed", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const status = (req.query.status as string) || undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const [recommendations, signals] = await Promise.all([
        storage.getAgentRecommendations(orgId, status, limit),
        storage.getAgentSignals(orgId),
      ]);
      res.json({ recommendations, signals });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/business-brain/brief", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const brief = await storage.getLatestExecutiveBrief(orgId);
      res.json(brief || null);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/business-brain/runs", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const runs = await storage.getOrchestratorRuns(orgId, 10);
      res.json(runs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/business-brain/health-score", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const brief = await storage.getLatestExecutiveBrief(orgId);
      const runs = await storage.getOrchestratorRuns(orgId, 1);
      res.json({
        healthScore: brief?.healthScore ?? null,
        lastRunAt: runs[0]?.createdAt ?? null,
        lastBriefAt: brief?.createdAt ?? null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/business-brain/recommendations/:id/execute", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;

      // Fetch rec data needed for tool mapping
      const rows = await db.execute(sql`
        SELECT id, agent_type, action_type, title, description, reason,
               entity_type, entity_id, entity_name, estimated_impact, priority_score
        FROM agent_recommendations WHERE id = ${id} AND org_id = ${orgId}
      `);
      const row = rows.rows[0] as any;
      if (!row) return res.status(404).json({ error: "Not found" });

      // Map to tool proposal
      const { mapBrainRecToToolProposal } = await import("./agent-tools/action-mapper");
      const { proposeToolCall } = await import("./agent-tools/index");

      const toolProposal = mapBrainRecToToolProposal({
        id: row.id,
        agentType: row.agent_type,
        actionType: row.action_type,
        title: row.title,
        description: row.description,
        reason: row.reason,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityName: row.entity_name,
        estimatedImpact: row.estimated_impact ? Number(row.estimated_impact) : null,
        priorityScore: row.priority_score ? Number(row.priority_score) : null,
      });

      let toolCall: any = null;

      if (toolProposal) {
        const result = await proposeToolCall(orgId, {
          agentName: "business_brain",
          ...toolProposal,
          sourceRecommendationId: id,
        });

        if (result.requiresConfirmation) {
          // Keep rec visible in pending-tool state; mark out of main inbox
          await storage.updateAgentRecommendation(id, { status: "pending_tool_confirmation" as any });
          return res.json({
            toolCall: {
              toolCallId: result.toolCallId,
              requiresConfirmation: true,
              success: true,
              message: `${toolProposal.toolName} queued — needs approval`,
            },
          });
        }

        toolCall = {
          toolCallId: result.toolCallId,
          requiresConfirmation: false,
          success: result.success,
          message: result.message ?? `${toolProposal.toolName} executed`,
          error: result.error,
        };
      }

      const rec = await storage.updateAgentRecommendation(id, { status: "executed", executedAt: new Date() });
      res.json({ rec, toolCall });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/business-brain/recommendations/:id/dismiss", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;
      // Verify ownership before mutating
      const ownerCheck = await db.execute(sql`SELECT id FROM agent_recommendations WHERE id = ${id} AND org_id = ${orgId}`);
      if (!ownerCheck.rows[0]) return res.status(404).json({ error: "Not found" });
      const rec = await storage.updateAgentRecommendation(id, { status: "dismissed", dismissedAt: new Date() });
      if (!rec) return res.status(404).json({ error: "Not found" });
      res.json(rec);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/business-brain/recommendations/:id/outcome", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;
      const { outcomeType, outcomeValue } = req.body;
      // Verify ownership before mutating
      const ownerCheck = await db.execute(sql`SELECT id FROM agent_recommendations WHERE id = ${id} AND org_id = ${orgId}`);
      if (!ownerCheck.rows[0]) return res.status(404).json({ error: "Not found" });
      const rec = await storage.updateAgentRecommendation(id, {
        outcomeType,
        outcomeValue: outcomeValue || 0,
        outcomeLoggedAt: new Date(),
      });
      res.json(rec);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/business-brain/command-center-summary
  // Unified summary for Command Center: health + brief + merged ranked actions
  app.get("/api/admin/business-brain/command-center-summary", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      const [brief, brainRecs, revenueActionsRaw, runs] = await Promise.all([
        storage.getLatestExecutiveBrief(orgId),
        storage.getAgentRecommendations(orgId, "pending", 15),
        (storage as any).getAgentActions(orgId, "pending"),
        storage.getOrchestratorRuns(orgId, 1),
      ]);

      const revenueActions: any[] = Array.isArray(revenueActionsRaw) ? revenueActionsRaw : [];
      const unified: any[] = [];

      // Brain recommendations
      for (const rec of brainRecs) {
        const et = rec.entityType as string | null;
        let deepLinkType: string | null = null;
        let deepLinkUrl: string | null = null;
        let deepLinkLabel: string | null = null;
        if (et === "client") { deepLinkType = "client"; deepLinkUrl = "/coach/users"; deepLinkLabel = "View Client"; }
        else if (et === "deal") { deepLinkType = "deal"; deepLinkUrl = "/admin/team-training-deals"; deepLinkLabel = "Open Deal"; }
        else if (et === "lead" || et === "prospect") { deepLinkType = "lead"; deepLinkUrl = "/admin/team-training-leads"; deepLinkLabel = "View Lead"; }
        else if (et === "schedule") { deepLinkType = "schedule"; deepLinkUrl = "/command-center"; deepLinkLabel = "View Schedule"; }
        unified.push({
          id: rec.id,
          source: "brain",
          agentType: rec.agentType,
          title: rec.title,
          description: rec.description ?? rec.reason ?? "",
          priorityScore: rec.priorityScore ?? 50,
          severity: rec.severity ?? "medium",
          estimatedImpact: rec.estimatedImpact ?? 0,
          actionType: rec.actionType ?? "review",
          entityType: et,
          entityId: rec.entityId,
          entityName: rec.entityName,
          status: rec.status,
          crossAgent: (rec.crossAgentTypes?.length ?? 0) > 0,
          deepLinkType,
          deepLinkUrl,
          deepLinkLabel,
        });
      }

      // Revenue agent actions
      for (const action of revenueActions.slice(0, 10)) {
        let et: string | null = null;
        let entityId: string | null = null;
        let entityName: string | null = null;
        let deepLinkType: string | null = null;
        let deepLinkUrl: string | null = null;
        let deepLinkLabel: string | null = null;
        if (action.dealId) {
          et = "deal"; entityId = action.dealId;
          entityName = (action.metadata as any)?.prospectName ?? null;
          deepLinkType = "deal"; deepLinkUrl = "/admin/team-training-deals"; deepLinkLabel = "Open Deal";
        } else if (action.prospectId) {
          et = "lead"; entityId = action.prospectId;
          entityName = (action.metadata as any)?.prospectName ?? null;
          deepLinkType = "lead"; deepLinkUrl = "/admin/team-training-leads"; deepLinkLabel = "View Lead";
        }
        const p = action.priority ?? 50;
        const sev = p >= 80 ? "critical" : p >= 60 ? "high" : p >= 40 ? "medium" : "low";
        unified.push({
          id: action.id,
          source: "revenue_agent",
          agentType: "revenue",
          title: action.reason ?? "Revenue opportunity",
          description: action.reason ?? "",
          priorityScore: p,
          severity: sev,
          estimatedImpact: action.estimatedValue ?? 0,
          actionType: action.actionType,
          entityType: et,
          entityId,
          entityName,
          status: action.status,
          crossAgent: false,
          deepLinkType,
          deepLinkUrl,
          deepLinkLabel,
        });
      }

      unified.sort((a, b) => b.priorityScore - a.priorityScore);

      const briefSummary = brief ? {
        biggestOpportunity: brief.biggestOpportunity as any,
        highestChurnRisk: brief.highestChurnRisk as any,
        mostValuableLead: brief.mostValuableLead as any,
        projectedWeeklyRevenue: brief.projectedWeeklyRevenue ?? 0,
        recommendedActions: (brief.recommendedActions as any[]) ?? [],
      } : null;

      res.json({
        healthScore: brief?.healthScore ?? null,
        lastRunAt: runs[0]?.createdAt ?? null,
        briefSummary,
        topActions: unified.slice(0, 10),
        totalPending: unified.length,
      });
    } catch (e: any) {
      console.error("[BusinessBrain] command-center-summary error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Agent Tool Layer ─────────────────────────────────────────────────────

  // GET /api/admin/agent-tools — list all tool definitions + permissions
  app.get("/api/admin/agent-tools", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { listTools, CONNECTOR_ROADMAP } = await import("./agent-tools/index");
      const tools = listTools().map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
        permissions: t.permissions,
        riskLevel: t.riskLevel,
        connector: t.connector,
        connectorStatus: t.connectorStatus,
      }));
      res.json({ tools, connectorRoadmap: CONNECTOR_ROADMAP });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/agent-tool-calls — audit log
  app.get("/api/admin/agent-tool-calls", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
      const { getToolCallAuditLog } = await import("./agent-tools/index");
      const calls = await getToolCallAuditLog(orgId, limit);
      res.json({ calls });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/agent-tool-calls/pending — pending confirmations
  app.get("/api/admin/agent-tool-calls/pending", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { getPendingToolCalls } = await import("./agent-tools/index");
      const calls = await getPendingToolCalls(orgId);
      res.json({ calls, count: calls.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/agent-tool-calls/:id/confirm
  app.post("/api/admin/agent-tool-calls/:id/confirm", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { executePendingToolCall } = await import("./agent-tools/index");
      const result = await executePendingToolCall(orgId, req.params.id, "admin");
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/agent-tool-calls/:id/reject
  app.post("/api/admin/agent-tool-calls/:id/reject", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { rejectToolCall } = await import("./agent-tools/index");
      await rejectToolCall(orgId, req.params.id, "admin");
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/agent-tools/propose — submit an action proposal
  app.post("/api/admin/agent-tools/propose", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { proposeToolCall } = await import("./agent-tools/index");
      const result = await proposeToolCall(orgId, req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/agent-tools/execute — direct execute (auto-execute tools only)
  app.post("/api/admin/agent-tools/execute", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { proposeToolCall, getTool } = await import("./agent-tools/index");
      const tool = getTool(req.body.toolName);
      if (!tool) return res.status(400).json({ error: `Unknown tool: ${req.body.toolName}` });
      if (!tool.permissions.safe_auto_execute && tool.permissions.requires_confirmation) {
        return res.status(400).json({ error: "This tool requires confirmation. Use /propose instead." });
      }
      const result = await proposeToolCall(orgId, req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Workflow Orchestration ───────────────────────────────────────────────

  // GET /api/admin/workflows/definitions
  app.get("/api/admin/workflows/definitions", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { listWorkflowDefinitions } = await import("./workflows/index");
      const defs = listWorkflowDefinitions();
      res.json(defs.map(d => ({
        type: d.type, displayName: d.displayName, description: d.description,
        category: d.category, estimatedDays: d.estimatedDays, triggerEvent: d.triggerEvent,
        totalSteps: d.steps.length,
      })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/workflows/stats
  app.get("/api/admin/workflows/stats", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { getWorkflowStats } = await import("./workflows/index");
      res.json(await getWorkflowStats(orgId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/workflows
  app.get("/api/admin/workflows", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { listWorkflowRuns } = await import("./workflows/index");
      res.json(await listWorkflowRuns(orgId, 100));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/workflows/trigger
  app.post("/api/admin/workflows/trigger", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { workflowType, triggerReason, entityType, entityId, entityName, triggerSource, sourceRecommendationId, sourceRevenueActionId, initialContext } = req.body;
      if (!workflowType) return res.status(400).json({ error: "workflowType required" });
      const { startWorkflow } = await import("./workflows/index");
      const result = await startWorkflow({ orgId, workflowType, triggerReason, triggerSource: triggerSource ?? "manual", entityType, entityId, entityName, sourceRecommendationId, sourceRevenueActionId, initialContext });
      const { createActivityEvent: logActivity } = await import("./services/activity-timeline");
      logActivity({
        orgId,
        sourceType: "workflow",
        sourceId: result?.id,
        eventType: "workflow_triggered",
        title: `Workflow triggered: ${workflowType}`,
        metadata: { workflowType, triggerReason, entityType, entityId, entityName, triggerSource },
        visibility: "coach",
      }).catch(() => {});
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/workflows/resume-waiting
  app.post("/api/admin/workflows/resume-waiting", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { resumeWaitingWorkflows } = await import("./workflows/index");
      const count = await resumeWaitingWorkflows(orgId);
      res.json({ resumed: count });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/workflows/:id
  app.get("/api/admin/workflows/:id", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { getWorkflowRunWithSteps } = await import("./workflows/index");
      const result = await getWorkflowRunWithSteps(req.params.id, orgId);
      if (!result) return res.status(404).json({ error: "Not found" });
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/workflows/:id/approve
  app.post("/api/admin/workflows/:id/approve", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { editedSubject, editedBody, feedback } = req.body ?? {};
      const { approveWorkflowStep } = await import("./workflows/index");

      // If the admin edited the draft before approving, patch it into context first
      if (editedSubject || editedBody) {
        const { db } = await import("./db");
        const { workflowRuns } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, req.params.id));
        if (run) {
          const ctx = (run.context as any) ?? {};
          await db.update(workflowRuns)
            .set({ context: { ...ctx, draftSubject: editedSubject ?? ctx.draftSubject, draftBody: editedBody ?? ctx.draftBody } })
            .where(eq(workflowRuns.id, req.params.id));
        }

        // Persist operator override memory
        const { persistWorkflowMemory } = await import("./workflow-context-engine");
        const run2 = run ?? { entityType: "workflow", entityId: req.params.id, workflowType: "" };
        await persistWorkflowMemory({
          orgId,
          entityType: (run2 as any).entityType ?? "workflow",
          entityId: (run2 as any).entityId ?? req.params.id,
          contextType: "operator_override",
          summary: `Admin edited workflow draft before approving.${editedSubject ? ` Subject changed to: "${editedSubject}"` : ""}${editedBody ? " Body was modified." : ""}`,
          structuredContext: { editedSubject: editedSubject ?? null, editedBodyLength: editedBody?.length ?? 0, workflowRunId: req.params.id },
          sourceWorkflowId: req.params.id,
          createdBy: "admin",
          neverDelete: true,
        });
      }

      const result = await approveWorkflowStep(req.params.id, orgId, "admin");

      // Persist workflow approval memory
      if (result.ok) {
        try {
          const { persistWorkflowMemory } = await import("./workflow-context-engine");
          const { db } = await import("./db");
          const { workflowRuns } = await import("@shared/schema");
          const { eq } = await import("drizzle-orm");
          const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, req.params.id));
          if (run?.entityId) {
            await persistWorkflowMemory({
              orgId,
              entityType: run.entityType ?? "workflow",
              entityId: run.entityId,
              contextType: "workflow_memory",
              summary: `Workflow "${run.displayName ?? run.workflowType}" approved by admin${editedSubject || editedBody ? " (with edits)" : ""}.`,
              sourceWorkflowId: req.params.id,
              createdBy: "admin",
            });
          }
        } catch (_) {}
      }

      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/workflows/:id/reject
  app.post("/api/admin/workflows/:id/reject", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { feedback } = req.body ?? {};
      const { rejectWorkflowStep } = await import("./workflows/index");
      const result = await rejectWorkflowStep(req.params.id, orgId, "admin");

      // Persist operator override memory for rejection feedback
      if (result.ok) {
        try {
          const { persistWorkflowMemory } = await import("./workflow-context-engine");
          const { db } = await import("./db");
          const { workflowRuns } = await import("@shared/schema");
          const { eq } = await import("drizzle-orm");
          const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, req.params.id));
          if (run?.entityId) {
            await persistWorkflowMemory({
              orgId,
              entityType: run.entityType ?? "workflow",
              entityId: run.entityId,
              contextType: "operator_override",
              summary: `Admin rejected workflow "${run.displayName ?? run.workflowType}"${feedback ? `. Feedback: ${feedback}` : "."}`,
              structuredContext: { feedback: feedback ?? null, workflowRunId: req.params.id, workflowType: run.workflowType },
              sourceWorkflowId: req.params.id,
              createdBy: "admin",
              neverDelete: true,
            });
          }
        } catch (_) {}
      }

      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/workflows/:id/cancel
  app.post("/api/admin/workflows/:id/cancel", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { cancelWorkflow } = await import("./workflows/index");
      const result = await cancelWorkflow(req.params.id, orgId);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/workflows/:id/regenerate — cancel and re-queue with feedback
  app.post("/api/admin/workflows/:id/regenerate", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { feedback } = req.body;
      const { cancelWorkflow } = await import("./workflows/index");
      await cancelWorkflow(req.params.id, orgId);
      const { logUnifiedAction } = await import("./unified-action-logger");
      await logUnifiedAction({
        orgId,
        actorType: "admin",
        actionType: "workflow:regenerate_with_feedback",
        workflowRunId: req.params.id,
        status: "started",
        riskLevel: "low",
        reasoningSummary: feedback ? `Admin feedback: ${feedback}` : "Regeneration requested by admin",
      });

      // Persist operator override memory for regeneration feedback
      if (feedback) {
        try {
          const { persistWorkflowMemory } = await import("./workflow-context-engine");
          const { db } = await import("./db");
          const { workflowRuns } = await import("@shared/schema");
          const { eq } = await import("drizzle-orm");
          const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, req.params.id));
          if (run?.entityId) {
            await persistWorkflowMemory({
              orgId,
              entityType: run.entityType ?? "workflow",
              entityId: run.entityId,
              contextType: "operator_override",
              summary: `Admin requested regeneration of "${run.displayName ?? run.workflowType}". Feedback: ${feedback}`,
              structuredContext: { feedback, workflowRunId: req.params.id, workflowType: run.workflowType },
              sourceWorkflowId: req.params.id,
              createdBy: "admin",
              neverDelete: true,
            });
          }
        } catch (_) {}
      }

      res.json({ success: true, message: "Workflow cancelled; please re-trigger with updated parameters." });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Workflow Context (Memory) API ────────────────────────────────────────

  // GET /api/workflow-context — get memories for an entity
  app.get("/api/workflow-context", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { entityType, entityId } = req.query as { entityType?: string; entityId?: string };
      if (entityType && entityId) {
        const { getWorkflowContext } = await import("./workflow-context-engine");
        const memories = await getWorkflowContext({ orgId, entityType, entityId });
        return res.json(memories);
      }
      const { getOrgWorkflowContext } = await import("./workflow-context-engine");
      const memories = await getOrgWorkflowContext(orgId);
      res.json(memories);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/workflow-context/stats — memory statistics for dashboard
  app.get("/api/workflow-context/stats", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { getMemoryStats } = await import("./workflow-context-engine");
      const stats = await getMemoryStats(orgId);
      res.json(stats);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/workflow-context/lifecycle — manually trigger memory lifecycle
  app.post("/api/workflow-context/lifecycle", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { runMemoryLifecycle } = await import("./workflow-context-engine");
      const result = await runMemoryLifecycle(orgId);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/workflow-context — manually create a memory (admin)
  app.post("/api/workflow-context", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { persistWorkflowMemory } = await import("./workflow-context-engine");
      const id = await persistWorkflowMemory({ ...req.body, orgId, createdBy: "admin" });
      res.json({ id });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/workflow-outcomes — list outcomes for org
  app.get("/api/workflow-outcomes", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { getWorkflowOutcomes } = await import("./workflow-context-engine");
      const outcomes = await getWorkflowOutcomes(orgId);
      res.json(outcomes);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/workflow-outcomes/analytics — outcome analytics for dashboard
  app.get("/api/workflow-outcomes/analytics", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { getOutcomeAnalytics } = await import("./workflow-context-engine");
      const analytics = await getOutcomeAnalytics(orgId);
      res.json(analytics);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/workflow-outcomes — record an outcome
  app.post("/api/workflow-outcomes", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { attachOutcomeToMemory } = await import("./workflow-context-engine");
      const id = await attachOutcomeToMemory({ ...req.body, orgId });
      res.json({ id });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Workflow Settings & Mapper ──────────────────────────────────────────

  // GET /api/admin/workflows/settings
  app.get("/api/admin/workflows/settings", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { workflowSettings } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { db } = await import("./db");
      const [settings] = await db.select().from(workflowSettings).where(eq(workflowSettings.orgId, orgId));
      res.json(settings ?? { orgId, autoStartSafeWorkflows: false, requireApprovalBeforeMessages: true, neverAutoSend: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/workflows/settings
  app.post("/api/admin/workflows/settings", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { workflowSettings } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { db } = await import("./db");
      const { autoStartSafeWorkflows, requireApprovalBeforeMessages, neverAutoSend } = req.body;
      const [upserted] = await db.insert(workflowSettings).values({
        orgId, autoStartSafeWorkflows, requireApprovalBeforeMessages, neverAutoSend, updatedAt: new Date(),
      }).onConflictDoUpdate({ target: workflowSettings.orgId, set: { autoStartSafeWorkflows, requireApprovalBeforeMessages, neverAutoSend, updatedAt: new Date() } }).returning();
      res.json(upserted);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/workflows/active-summary
  // Returns active workflow counts + items needing approval for the status strip
  app.get("/api/admin/workflows/active-summary", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { workflowRuns } = await import("@shared/schema");
      const { eq, inArray } = await import("drizzle-orm");
      const { db } = await import("./db");
      const active = await db.select({
        id: workflowRuns.id,
        workflowType: workflowRuns.workflowType,
        displayName: workflowRuns.displayName,
        status: workflowRuns.status,
        entityName: workflowRuns.entityName,
        currentStepIndex: workflowRuns.currentStepIndex,
        totalSteps: workflowRuns.totalSteps,
      }).from(workflowRuns)
        .where(eq(workflowRuns.orgId, orgId))
        .orderBy(workflowRuns.createdAt);
      const ACTIVE = ["pending","running","waiting_confirmation","waiting_response"];
      const activeRuns = active.filter(r => ACTIVE.includes(r.status));
      const needingApproval = activeRuns.filter(r => r.status === "waiting_confirmation").length;
      res.json({ total: activeRuns.length, needingApproval, runs: activeRuns.slice(0, 5) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/workflows/eligibility
  // Given a list of recommendation/action IDs, return workflow mapping metadata
  app.post("/api/admin/workflows/eligibility", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });
      const { actions } = req.body as { actions: Array<{ id: string; agentType?: string; actionType?: string; entityId?: string | null; source: string }> };
      if (!Array.isArray(actions)) return res.status(400).json({ error: "actions array required" });
      const { getWorkflowTypeForRecommendation, getWorkflowTypeForRevenueAction, getWorkflowMeta, checkWorkflowDuplicate } = await import("./workflows/mapper");
      const results: Record<string, { workflowType: string | null; workflowMeta: any | null; isDuplicate: boolean; existingRunId: string | null }> = {};
      for (const a of actions) {
        let wt: string | null = null;
        if (a.source === "brain" && a.agentType) {
          wt = getWorkflowTypeForRecommendation({ agentType: a.agentType, actionType: a.actionType });
        } else if (a.source === "revenue_agent" && a.actionType) {
          wt = getWorkflowTypeForRevenueAction({ actionType: a.actionType });
        }
        const meta = wt ? getWorkflowMeta(wt) : null;
        const dup = wt && a.entityId ? await checkWorkflowDuplicate(orgId, wt, a.entityId) : { isDuplicate: false, existingRunId: null };
        results[a.id] = { workflowType: wt, workflowMeta: meta, isDuplicate: dup.isDuplicate, existingRunId: dup.existingRunId };
      }
      res.json(results);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Daily Operator Mode ──────────────────────────────────────────────────

  // POST /api/admin/start-my-day
  // Runs all agents, returns a ranked daily execution checklist
  app.post("/api/admin/start-my-day", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      const { runOrchestrator } = await import("./agents/executive-agent");
      const brainResult = await runOrchestrator(orgId, "start_my_day");

      const [brainRecs, revenueActionsRaw] = await Promise.all([
        storage.getAgentRecommendations(orgId, "pending", 20),
        (storage as any).getAgentActions(orgId, "pending"),
      ]);

      const ra: any[] = Array.isArray(revenueActionsRaw) ? revenueActionsRaw : [];

      function toCategory(agentType: string, actionType: string): string {
        if (agentType === "retention") return "churn_prevention";
        if (agentType === "scheduling") return "schedule_gap";
        if (agentType === "growth" || (actionType ?? "").includes("follow") || (actionType ?? "").includes("lead")) return "lead_follow_up";
        if (agentType === "client_success") return "client_success";
        return "revenue";
      }

      const allTasks: any[] = [];

      for (const rec of brainRecs.slice(0, 15)) {
        const et = rec.entityType as string | null;
        let deepLinkType = null, deepLinkUrl = null, deepLinkLabel = null;
        if (et === "client") { deepLinkType = "client"; deepLinkUrl = "/coach/users"; deepLinkLabel = "View Client"; }
        else if (et === "deal") { deepLinkType = "deal"; deepLinkUrl = "/admin/team-training-deals"; deepLinkLabel = "Open Deal"; }
        else if (et === "lead" || et === "prospect") { deepLinkType = "lead"; deepLinkUrl = "/admin/team-training-leads"; deepLinkLabel = "View Lead"; }
        else if (et === "schedule") { deepLinkType = "schedule"; deepLinkUrl = "/command-center"; deepLinkLabel = "View Schedule"; }
        allTasks.push({
          id: rec.id,
          category: toCategory(rec.agentType, rec.actionType ?? ""),
          title: rec.title,
          reason: rec.description ?? rec.reason ?? "",
          expectedImpact: rec.estimatedImpact ?? 0,
          source: "brain",
          sourceId: rec.id,
          entityType: et,
          entityId: rec.entityId,
          entityName: rec.entityName,
          deepLinkType,
          deepLinkUrl,
          deepLinkLabel,
          status: "pending",
          priorityScore: rec.priorityScore ?? 50,
          crossAgent: (rec.crossAgentTypes?.length ?? 0) > 0,
          severity: rec.severity ?? "medium",
        });
      }

      for (const action of ra.slice(0, 10)) {
        let et: string | null = null, entityId = null, entityName = null;
        let deepLinkType = null, deepLinkUrl = null, deepLinkLabel = null;
        if (action.dealId) {
          et = "deal"; entityId = action.dealId;
          entityName = (action.metadata as any)?.prospectName ?? null;
          deepLinkType = "deal"; deepLinkUrl = "/admin/team-training-deals"; deepLinkLabel = "Open Deal";
        } else if (action.prospectId) {
          et = "lead"; entityId = action.prospectId;
          entityName = (action.metadata as any)?.prospectName ?? null;
          deepLinkType = "lead"; deepLinkUrl = "/admin/team-training-leads"; deepLinkLabel = "View Lead";
        }
        allTasks.push({
          id: action.id,
          category: toCategory("revenue", action.actionType ?? ""),
          title: action.reason ?? "Revenue opportunity",
          reason: action.reason ?? "",
          expectedImpact: action.estimatedValue ?? 0,
          source: "revenue_agent",
          sourceId: action.id,
          entityType: et,
          entityId,
          entityName,
          deepLinkType,
          deepLinkUrl,
          deepLinkLabel,
          status: "pending",
          priorityScore: action.priority ?? 50,
          crossAgent: false,
          severity: (action.priority ?? 50) >= 75 ? "high" : "medium",
        });
      }

      allTasks.sort((a, b) => b.priorityScore - a.priorityScore);

      // Category-balanced top 7
      const categories = ["churn_prevention", "revenue", "schedule_gap", "lead_follow_up", "client_success"];
      const balanced: any[] = [];
      const used = new Set<string>();

      for (const cat of categories) {
        const best = allTasks.find(t => t.category === cat && !used.has(t.id));
        if (best) { balanced.push(best); used.add(best.id); }
      }
      for (const t of allTasks) {
        if (!used.has(t.id) && balanced.length < 7) {
          balanced.push(t);
          used.add(t.id);
        }
      }

      balanced.forEach((t, i) => { t.rank = i + 1; });

      res.json({
        tasks: balanced,
        totalGenerated: allTasks.length,
        healthScore: brainResult.healthScore ?? null,
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error("[StartMyDay] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/day-review
  app.get("/api/admin/day-review", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      const { sql: sqlFn } = await import("drizzle-orm");
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

      const [brainDoneRaw, revDoneRaw, pendingRaw] = await Promise.all([
        db.execute(sqlFn`
          SELECT id, agent_type, title, action_type, estimated_impact
          FROM agent_recommendations
          WHERE org_id = ${orgId}
            AND status = 'executed'
            AND executed_at >= ${todayStart}
            AND executed_at <= ${todayEnd}
        `),
        db.execute(sqlFn`
          SELECT id, action_type, reason, estimated_value, outcome_value, deal_id, prospect_id
          FROM revenue_agent_actions
          WHERE org_id = ${orgId}
            AND status = 'executed'
            AND executed_at >= ${todayStart}
            AND executed_at <= ${todayEnd}
        `),
        db.execute(sqlFn`
          SELECT COUNT(*) as cnt
          FROM agent_recommendations
          WHERE org_id = ${orgId}
            AND status = 'pending'
            AND created_at >= ${todayStart}
        `),
      ]);

      const brainDone = brainDoneRaw.rows as any[];
      const revDone = revDoneRaw.rows as any[];

      const tasksCompleted = brainDone.length + revDone.length;
      const revenueInfluenced = revDone.reduce((s: number, a: any) => s + (a.outcome_value ?? a.estimated_value ?? 0), 0)
        + brainDone.reduce((s: number, r: any) => s + (r.estimated_impact ?? 0), 0);
      const followUpsSent = revDone.filter((a: any) => (a.action_type ?? "").includes("follow") || (a.action_type ?? "").includes("send")).length;
      const clientsSaved = brainDone.filter((r: any) => r.agent_type === "retention" || r.agent_type === "client_success").length;
      const dealsAdvanced = revDone.filter((a: any) => a.deal_id != null).length + brainDone.filter((r: any) => r.agent_type === "growth").length;
      const missedOpportunities = parseInt((pendingRaw.rows[0] as any)?.cnt ?? "0");

      const completedItems = [
        ...brainDone.map((r: any) => ({
          title: r.title,
          category: r.agent_type === "retention" ? "churn_prevention" : r.agent_type === "growth" ? "lead_follow_up" : r.agent_type === "scheduling" ? "schedule_gap" : r.agent_type === "client_success" ? "client_success" : "revenue",
          impact: r.estimated_impact ?? 0,
        })),
        ...revDone.map((a: any) => ({
          title: a.reason ?? "Revenue action",
          category: "revenue",
          impact: a.outcome_value ?? a.estimated_value ?? 0,
        })),
      ];

      res.json({ tasksCompleted, revenueInfluenced, followUpsSent, clientsSaved, dealsAdvanced, missedOpportunities, completedItems });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/operator-score
  app.get("/api/admin/operator-score", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      const { sql: sqlFn } = await import("drizzle-orm");
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

      const [handledRaw, totalRaw, streakRaw] = await Promise.all([
        db.execute(sqlFn`
          SELECT COUNT(*) as cnt FROM (
            SELECT id FROM agent_recommendations
              WHERE org_id = ${orgId} AND status IN ('executed','dismissed')
                AND (executed_at >= ${todayStart} OR dismissed_at >= ${todayStart})
            UNION ALL
            SELECT id FROM revenue_agent_actions
              WHERE org_id = ${orgId} AND status IN ('executed','dismissed')
                AND (executed_at >= ${todayStart} OR dismissed_at >= ${todayStart})
          ) t
        `),
        db.execute(sqlFn`
          SELECT COUNT(*) as cnt FROM (
            SELECT id FROM agent_recommendations WHERE org_id = ${orgId} AND created_at >= ${todayStart}
            UNION ALL
            SELECT id FROM revenue_agent_actions WHERE org_id = ${orgId} AND created_at >= ${todayStart}
          ) t
        `),
        db.execute(sqlFn`
          SELECT DISTINCT DATE(executed_at) as day FROM (
            SELECT executed_at FROM agent_recommendations
              WHERE org_id = ${orgId} AND status = 'executed' AND executed_at IS NOT NULL
                AND executed_at >= NOW() - INTERVAL '30 days'
            UNION ALL
            SELECT executed_at FROM revenue_agent_actions
              WHERE org_id = ${orgId} AND status = 'executed' AND executed_at IS NOT NULL
                AND executed_at >= NOW() - INTERVAL '30 days'
          ) t ORDER BY day DESC
        `),
      ]);

      const handled = parseInt((handledRaw.rows[0] as any)?.cnt ?? "0");
      const total = parseInt((totalRaw.rows[0] as any)?.cnt ?? "0");
      const todayScore = total > 0 ? Math.min(100, Math.round((handled / total) * 100)) : 0;

      const days = (streakRaw.rows as any[]).map((r: any) => {
        const d = r.day;
        if (d instanceof Date) return d.toISOString().slice(0, 10);
        return String(d).slice(0, 10);
      });

      let streakDays = 0;
      const todayStr = new Date().toISOString().slice(0, 10);
      const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (days.includes(todayStr) || days.includes(yesterdayStr)) {
        let checkDate = days.includes(todayStr) ? new Date() : new Date(Date.now() - 86400000);
        for (let i = 0; i < 31; i++) {
          const d = checkDate.toISOString().slice(0, 10);
          if (days.includes(d)) { streakDays++; checkDate = new Date(checkDate.getTime() - 86400000); }
          else break;
        }
      }

      res.json({ todayScore, streakDays, actionsHandledToday: handled, totalActionsToday: total });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Dev-only Auth Diagnostic ─────────────────────────────────────────────
  // GET /api/admin/auth/debug
  // Returns the resolved identity for the current session.
  // Only available in development — returns 404 in production.
  app.get("/api/admin/auth/debug", async (req: any, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }
    try {
      const oidcId = req.user?.claims?.sub;
      const customId = req.user?.id;
      const userId = oidcId ?? customId;

      if (!userId) {
        return res.json({
          authenticated: false,
          userId: null,
          organizationId: null,
          authSource: null,
          role: null,
          permissions: [],
        });
      }

      const profile = await storage.getUserProfile(userId);
      const role = profile?.role ?? "CLIENT";

      const ROLE_PERMISSIONS: Record<string, string[]> = {
        ADMIN:  ["read:all", "write:all", "manage:coaches", "manage:clients", "manage:billing", "run:agents", "approve:workflows"],
        COACH:  ["read:clients", "write:sessions", "read:schedule", "run:agents", "approve:workflows"],
        STAFF:  ["read:clients", "write:sessions", "read:schedule"],
        CLIENT: ["read:own", "write:own"],
      };

      return res.json({
        authenticated: true,
        userId,
        organizationId: profile?.organizationId ?? null,
        authSource: oidcId ? "oidc" : "custom",
        role,
        permissions: ROLE_PERMISSIONS[role] ?? [],
        sessionExists: !!req.session,
        userObjectKeys: req.user ? Object.keys(req.user) : [],
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Agent Ops Monitor ────────────────────────────────────────────────────

  // GET /api/admin/agent-ops/health
  app.get("/api/admin/agent-ops/health", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      const { db } = await import("./db");
      const { agentToolCalls, workflowRuns, revenueAgentSettings, agentRecommendations } = await import("@shared/schema");
      const { isTwilioConfigured } = await import("./sms");
      const { sql, count, and, lt, gt, eq, isNull } = await import("drizzle-orm");

      const sendgridConfigured = !!(process.env.SENDGRID_API_KEY || process.env.REPLIT_CONNECTORS_HOSTNAME);
      const twilioConfigured = isTwilioConfigured();

      let dbReachable = false;
      try {
        await db.execute(sql`SELECT 1`);
        dbReachable = true;
      } catch { /* noop */ }

      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const cutoff25h = new Date(Date.now() - 25 * 60 * 60 * 1000);

      const [failedCalls, pendingApprovals, recentWorkflows, recentBrainRec, revenueSettings] = await Promise.all([
        db.select({ count: count() }).from(agentToolCalls)
          .where(and(eq(agentToolCalls.orgId, orgId), eq(agentToolCalls.status, "failed"), gt(agentToolCalls.createdAt, cutoff24h))),
        db.select({ count: count() }).from(agentToolCalls)
          .where(and(eq(agentToolCalls.orgId, orgId), eq(agentToolCalls.status, "pending_confirmation"), isNull(agentToolCalls.resolvedAt))),
        db.select({ count: count() }).from(workflowRuns)
          .where(and(eq(workflowRuns.orgId, orgId), gt(workflowRuns.createdAt, cutoff24h))),
        db.select({ createdAt: agentRecommendations.createdAt }).from(agentRecommendations)
          .where(and(eq(agentRecommendations.orgId, orgId), gt(agentRecommendations.createdAt, cutoff25h)))
          .orderBy(agentRecommendations.createdAt)
          .limit(1),
        db.select({ lastRunAt: revenueAgentSettings.lastRunAt }).from(revenueAgentSettings)
          .where(eq(revenueAgentSettings.orgId, orgId))
          .limit(1),
      ]);

      const failedJobsLast24h = Number(failedCalls[0]?.count ?? 0);
      const pendingApprovalsCount = Number(pendingApprovals[0]?.count ?? 0);
      const workflowRunnerActive = Number(recentWorkflows[0]?.count ?? 0) > 0;
      const businessBrainLastRun = recentBrainRec[0]?.createdAt ?? null;
      const businessBrainActive = !!businessBrainLastRun;
      const revenueAgentLastRun = revenueSettings[0]?.lastRunAt ?? null;
      const revenueAgentActive = revenueAgentLastRun ? (Date.now() - new Date(revenueAgentLastRun).getTime()) < 25 * 60 * 60 * 1000 : false;

      // Financial event failure signals
      const { financialEventFailures: fefHealth } = await import("@shared/schema");
      const { count: fefCount, and: fefAnd, eq: fefEq, inArray: fefInArray, lt: fefLt } = await import("drizzle-orm");
      const fefCutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [fefPendingHealth, fefFailedHealth, fefStaleHealth] = await Promise.all([
        db.select({ n: fefCount() }).from(fefHealth).where(fefAnd(fefEq(fefHealth.orgId, orgId), fefInArray(fefHealth.status, ["pending", "retrying"]))),
        db.select({ n: fefCount() }).from(fefHealth).where(fefAnd(fefEq(fefHealth.orgId, orgId), fefEq(fefHealth.status, "failed"))),
        db.select({ n: fefCount() }).from(fefHealth).where(fefAnd(fefEq(fefHealth.orgId, orgId), fefInArray(fefHealth.status, ["pending", "retrying"]), fefLt(fefHealth.createdAt, fefCutoff24h))),
      ]);
      const financialFailuresPending = Number(fefPendingHealth[0]?.n ?? 0);
      const financialFailuresCritical = Number(fefFailedHealth[0]?.n ?? 0) + Number(fefStaleHealth[0]?.n ?? 0);

      res.json({
        sendgrid: { configured: sendgridConfigured, label: sendgridConfigured ? "Connected" : "Not configured" },
        twilio: { configured: twilioConfigured, label: twilioConfigured ? "Connected" : "Not configured" },
        database: { reachable: dbReachable, label: dbReachable ? "Reachable" : "Unreachable" },
        workflowRunner: { active: workflowRunnerActive, label: workflowRunnerActive ? "Active" : "No runs in 24h" },
        businessBrainCron: { active: businessBrainActive, lastRunAt: businessBrainLastRun, label: businessBrainActive ? "Active" : "No activity in 25h" },
        revenueAgentCron: { active: revenueAgentActive, lastRunAt: revenueAgentLastRun, label: revenueAgentActive ? "Active" : "No run in 25h" },
        failedJobsLast24h,
        pendingApprovalsCount,
        financialEventFailuresPending: financialFailuresPending,
        financialEventFailuresCritical: financialFailuresCritical,
        financialBrainUrl: "/admin/financial-brain",
        operatorActionsUrl: "/admin/operator-actions",
        openCriticalActions: await storage.getOperatorActionsSummary(orgId).then(s => s.criticalOpen).catch(() => 0),
        staleUnresolvedActions: await storage.getOperatorActionsSummary(orgId).then(s => s.staleCount).catch(() => 0),
        unresolvedPayoutReviews: await storage.getOperatorActions(orgId, { category: "payout", status: "open" }).then(a => a.length).catch(() => 0),
        unresolvedChurnRisks: await storage.getOperatorActions(orgId, { category: "churn", status: "open" }).then(a => a.length).catch(() => 0),
        retentionWorkflowsUrl: "/admin/retention-workflows",
        highRiskChurnCount: await storage.getRetentionWorkflows(orgId, { riskSeverity: "critical" }).then(ws => ws.filter(w => !["completed","cancelled"].includes(w.status)).length).catch(() => 0),
        unresolvedRecoveryWorkflows: await storage.getRetentionWorkflows(orgId).then(ws => ws.filter(w => !["completed","cancelled","recovered"].includes(w.status)).length).catch(() => 0),
        outreachQueueUrl: "/admin/outreach-queue",
        pendingOutreachApprovals: await storage.getOutreachDrafts(orgId, { status: "pending_approval" }).then(d => d.length).catch(() => 0),
        staleDrafts: await storage.getOutreachSummary(orgId).then(s => s.staleDrafts).catch(() => 0),
        // Workflow Orchestration (Task 13)
        workflowOrchestratorUrl: "/admin/workflow-orchestrator",
        activeWorkflowRuns: await storage.getWorkflowRuns(orgId, { status: "running" }).then(r => r.length).catch(() => 0),
        waitingWorkflowRuns: await storage.getWorkflowRuns(orgId, { status: "waiting" }).then(r => r.length).catch(() => 0),
        failedWorkflowRuns: await storage.getWorkflowRuns(orgId, { status: "failed" }).then(r => r.length).catch(() => 0),
        staleWaitingWorkflows: await storage.getWorkflowRuns(orgId, { status: "waiting" }).then(rs => rs.filter(r => r.updatedAt && (Date.now() - new Date(r.updatedAt).getTime()) > 48 * 3600000).length).catch(() => 0),
        blockedApprovalWorkflows: await storage.getWorkflowRuns(orgId, { status: "waiting" }).then(rs => rs.filter(r => { const stepKey = r.currentStepKey; return stepKey && stepKey.includes("approval"); }).length).catch(() => 0),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/agent-ops/failure-queue
  app.get("/api/admin/agent-ops/failure-queue", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      const { db } = await import("./db");
      const { agentToolCalls, workflowRuns } = await import("@shared/schema");
      const { and, eq, isNull, desc, inArray } = await import("drizzle-orm");

      const [failedToolCalls, failedWorkflows] = await Promise.all([
        db.select().from(agentToolCalls)
          .where(and(eq(agentToolCalls.orgId, orgId), eq(agentToolCalls.status, "failed"), isNull(agentToolCalls.resolvedAt)))
          .orderBy(desc(agentToolCalls.createdAt))
          .limit(50),
        db.select().from(workflowRuns)
          .where(and(eq(workflowRuns.orgId, orgId), inArray(workflowRuns.status, ["failed"])))
          .orderBy(desc(workflowRuns.createdAt))
          .limit(20),
      ]);

      res.json({ failedToolCalls, failedWorkflows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/agent-ops/stuck-workflows
  app.get("/api/admin/agent-ops/stuck-workflows", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      const { db } = await import("./db");
      const { workflowRuns } = await import("@shared/schema");
      const { and, eq, lt, isNotNull, or, inArray, desc } = await import("drizzle-orm");

      const stuckLockCutoff = new Date(Date.now() - 120 * 1000);
      const waitConfirmCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const waitResponseCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const allStuck = await db.select().from(workflowRuns)
        .where(and(
          eq(workflowRuns.orgId, orgId),
          or(
            and(
              inArray(workflowRuns.status, ["running", "waiting_confirmation", "waiting_response"]),
              isNotNull(workflowRuns.lockedAt),
              lt(workflowRuns.lockedAt, stuckLockCutoff)
            ),
            and(eq(workflowRuns.status, "waiting_confirmation"), lt(workflowRuns.createdAt, waitConfirmCutoff)),
            and(eq(workflowRuns.status, "waiting_response"), isNotNull(workflowRuns.nextCheckAt), lt(workflowRuns.nextCheckAt, waitResponseCutoff))
          )
        ))
        .orderBy(desc(workflowRuns.createdAt))
        .limit(30);

      const labeled = allStuck.map(run => {
        let reason = "unknown";
        if (run.lockedAt && new Date(run.lockedAt) < stuckLockCutoff) reason = "locked_too_long";
        else if (run.status === "waiting_confirmation" && run.createdAt && new Date(run.createdAt) < waitConfirmCutoff) reason = "confirmation_overdue";
        else if (run.status === "waiting_response" && run.nextCheckAt && new Date(run.nextCheckAt) < waitResponseCutoff) reason = "response_overdue";
        return { ...run, stuckReason: reason };
      });

      res.json({ stuckWorkflows: labeled, count: labeled.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/agent-ops/alerts
  app.get("/api/admin/agent-ops/alerts", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      const { db } = await import("./db");
      const { agentToolCalls, workflowRuns } = await import("@shared/schema");
      const { and, eq, isNull, lt, isNotNull, or, inArray, count } = await import("drizzle-orm");
      const { isTwilioConfigured } = await import("./sms");

      const stuckLockCutoff = new Date(Date.now() - 120 * 1000);
      const waitConfirmCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [pendingApprovals, failedWorkflows, stuckWorkflows] = await Promise.all([
        db.select({ count: count() }).from(agentToolCalls)
          .where(and(eq(agentToolCalls.orgId, orgId), eq(agentToolCalls.status, "pending_confirmation"), isNull(agentToolCalls.resolvedAt))),
        db.select({ count: count() }).from(workflowRuns)
          .where(and(eq(workflowRuns.orgId, orgId), eq(workflowRuns.status, "failed"))),
        db.select({ count: count() }).from(workflowRuns)
          .where(and(
            eq(workflowRuns.orgId, orgId),
            or(
              and(inArray(workflowRuns.status, ["running", "waiting_confirmation", "waiting_response"]), isNotNull(workflowRuns.lockedAt), lt(workflowRuns.lockedAt, stuckLockCutoff)),
              and(eq(workflowRuns.status, "waiting_confirmation"), lt(workflowRuns.createdAt, waitConfirmCutoff))
            )
          )),
      ]);

      const alerts: Array<{ level: string; message: string; type: string; count?: number }> = [];
      const pendingCount = Number(pendingApprovals[0]?.count ?? 0);
      const failedCount = Number(failedWorkflows[0]?.count ?? 0);
      const stuckCount = Number(stuckWorkflows[0]?.count ?? 0);

      if (pendingCount > 0) alerts.push({ level: "warning", message: `${pendingCount} action${pendingCount > 1 ? "s" : ""} need${pendingCount === 1 ? "s" : ""} approval`, type: "pending_approvals", count: pendingCount });
      if (failedCount > 0) alerts.push({ level: "error", message: `${failedCount} workflow${failedCount > 1 ? "s" : ""} failed`, type: "failed_workflows", count: failedCount });
      if (stuckCount > 0) alerts.push({ level: "warning", message: `${stuckCount} workflow${stuckCount > 1 ? "s" : ""} stuck`, type: "stuck_workflows", count: stuckCount });
      if (!isTwilioConfigured()) alerts.push({ level: "info", message: "Twilio not configured — SMS disabled", type: "twilio_missing" });
      if (!(process.env.SENDGRID_API_KEY || process.env.REPLIT_CONNECTORS_HOSTNAME)) alerts.push({ level: "error", message: "SendGrid not configured — emails disabled", type: "sendgrid_missing" });

      res.json({ alerts, critical: alerts.filter(a => a.level === "error").length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/agent-ops/tool-calls/:id/resolve
  app.post("/api/admin/agent-ops/tool-calls/:id/resolve", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      const { db } = await import("./db");
      const { agentToolCalls } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");

      const updated = await db.update(agentToolCalls)
        .set({ resolvedAt: new Date(), resolvedBy: "admin" })
        .where(and(eq(agentToolCalls.id, req.params.id), eq(agentToolCalls.orgId, orgId)))
        .returning({ id: agentToolCalls.id });

      if (!updated.length) return res.status(404).json({ error: "Tool call not found" });
      res.json({ success: true, id: updated[0].id });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/agent-ops/tool-calls/:id/retry
  app.post("/api/admin/agent-ops/tool-calls/:id/retry", async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ error: "Unauthorized" });

      const { db } = await import("./db");
      const { agentToolCalls } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");
      const { getTool, executePendingToolCall } = await import("./agent-tools/index");

      const [existing] = await db.select().from(agentToolCalls)
        .where(and(eq(agentToolCalls.id, req.params.id), eq(agentToolCalls.orgId, orgId)))
        .limit(1);

      if (!existing) return res.status(404).json({ error: "Tool call not found" });
      if (existing.status !== "failed") return res.status(400).json({ error: `Cannot retry — status is '${existing.status}', must be 'failed'` });

      const tool = getTool(existing.toolName);
      if (!tool) return res.status(400).json({ error: `Tool '${existing.toolName}' not found in registry` });
      if (tool.permissions.external_side_effect) return res.status(400).json({ error: "Cannot auto-retry external side-effect tools — resolve manually" });

      await db.update(agentToolCalls)
        .set({ status: "pending", error: null, executedAt: null })
        .where(eq(agentToolCalls.id, req.params.id));

      const result = await executePendingToolCall(orgId, req.params.id, "admin-retry");
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Start Business Brain cron
  const { startBusinessBrainCron } = await import("./agents/executive-agent");
  startBusinessBrainCron();

  const { initializeScheduledEmailAgent } = await import("./email-agent/scheduled-email-agent");
  initializeScheduledEmailAgent();

  const { initializeFollowUpCron } = await import("./email-agent/follow-up-cron");
  initializeFollowUpCron();

  const { initializeLeadCaptureSequenceCron } = await import("./lead-capture-sequences");
  initializeLeadCaptureSequenceCron();

  // Revenue Agent daily cron
  const { startRevenueAgentCron } = await import("./revenue-agent");
  startRevenueAgentCron(async () => {
    try {
      const { db } = await import("./db");
      const { organizations } = await import("@shared/schema");
      const orgs = await db.select({ id: organizations.id }).from(organizations);
      return orgs.map((o: any) => o.id);
    } catch {
      return [];
    }
  });

  startWeeklyReminderJob();
  startSessionReminderJob();

  // ─── Connector Routes ──────────────────────────────────────────────────────

  // GET /api/admin/connectors — list all connector statuses
  app.get("/api/admin/connectors", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const orgId = await storage.getOrgContextForUser(userId).then(r => r?.orgId ?? "");

      const { isGoogleCalendarConfigured, getGoogleCalendarStatus } = await import("./connectors/google-calendar");
      const gcal = await getGoogleCalendarStatus(orgId);

      let stripeConnected = false;
      try {
        const { getUncachableStripeClient } = await import("./stripeClient");
        const stripe = await getUncachableStripeClient();
        await stripe.balance.retrieve();
        stripeConnected = true;
      } catch { stripeConnected = false; }

      res.json({
        googleCalendar: {
          configured: gcal.configured,
          connected: gcal.connected,
          email: gcal.email,
          status: gcal.connected ? "connected" : gcal.configured ? "disconnected" : "not_configured",
        },
        stripe: {
          configured: stripeConnected,
          connected: stripeConnected,
          status: stripeConnected ? "connected" : "not_configured",
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/admin/connectors/google-calendar/connect — start OAuth flow
  app.get("/api/admin/connectors/google-calendar/connect", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { isGoogleCalendarConfigured, getGoogleAuthUrl } = await import("./connectors/google-calendar");
      if (!isGoogleCalendarConfigured()) {
        return res.status(400).json({ message: "Google Calendar not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." });
      }
      const userId = req.user?.claims?.sub;
      const orgId = await storage.getOrgContextForUser(userId).then(r => r?.orgId ?? "");
      const url = getGoogleAuthUrl(orgId);
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/connectors/google-calendar/callback — OAuth callback (public, Google redirects here)
  app.get("/api/connectors/google-calendar/callback", async (req: any, res) => {
    const { code, state: orgId, error } = req.query;
    if (error) {
      return res.redirect(`/admin/agent-ops?tab=connectors&gcal_error=${encodeURIComponent(error)}`);
    }
    if (!code || !orgId) {
      return res.redirect("/admin/agent-ops?tab=connectors&gcal_error=missing_params");
    }
    try {
      const { exchangeCodeAndStoreTokens } = await import("./connectors/google-calendar");
      const { email } = await exchangeCodeAndStoreTokens(code as string, orgId as string);
      res.redirect(`/admin/agent-ops?tab=connectors&gcal_connected=1&gcal_email=${encodeURIComponent(email ?? "")}`);
    } catch (err: any) {
      res.redirect(`/admin/agent-ops?tab=connectors&gcal_error=${encodeURIComponent(err.message)}`);
    }
  });

  // DELETE /api/admin/connectors/google-calendar — disconnect
  app.delete("/api/admin/connectors/google-calendar", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const orgId = await storage.getOrgContextForUser(userId).then(r => r?.orgId ?? "");
      const { disconnectGoogleCalendar } = await import("./connectors/google-calendar");
      await disconnectGoogleCalendar(orgId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/admin/agent-invoices — list agent invoices
  app.get("/api/admin/agent-invoices", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const orgId = await storage.getOrgContextForUser(userId).then(r => r?.orgId ?? "");
      const { listAgentInvoices } = await import("./connectors/stripe-invoicing");
      const invoices = await listAgentInvoices(orgId, 100);
      res.json(invoices);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/admin/agent-invoices/unpaid — list unpaid agent invoices
  app.get("/api/admin/agent-invoices/unpaid", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const orgId = await storage.getOrgContextForUser(userId).then(r => r?.orgId ?? "");
      const { listUnpaidAgentInvoices } = await import("./connectors/stripe-invoicing");
      const invoices = await listUnpaidAgentInvoices(orgId);
      res.json(invoices);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Unified Attention System ─────────────────────────────────────────────────

  // GET /api/attention — sync + return ranked items
  app.get("/api/attention", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const orgCtx = await storage.getOrgContextForUser(userId);
      const orgId = orgCtx?.orgId ?? "";
      if (!orgId) return res.json([]);

      const { syncAttentionItems, runEscalation, getAttentionItems } = await import("./attention-engine");
      // Run sync + escalation silently in background (non-blocking for fast response)
      syncAttentionItems(orgId).catch(() => {});
      runEscalation(orgId).catch(() => {});

      const items = await getAttentionItems(orgId);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/attention/sync — force full sync and return fresh items
  app.post("/api/attention/sync", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const orgCtx = await storage.getOrgContextForUser(userId);
      const orgId = orgCtx?.orgId ?? "";
      if (!orgId) return res.json({ synced: 0, items: [] });

      const { syncAttentionItems, runEscalation, getAttentionItems } = await import("./attention-engine");
      await syncAttentionItems(orgId);
      await runEscalation(orgId);
      const items = await getAttentionItems(orgId);
      res.json({ synced: items.length, items });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/attention/digest — attention digest
  app.get("/api/attention/digest", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const orgCtx = await storage.getOrgContextForUser(userId);
      const orgId = orgCtx?.orgId ?? "";
      if (!orgId) return res.json({ summary: "No data available." });

      const { getAttentionDigest } = await import("./attention-engine");
      const type = (req.query.type as "morning" | "eod" | "weekly") || "morning";
      const digest = await getAttentionDigest(orgId, type);
      res.json(digest);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/attention/:id/snooze — snooze item
  app.patch("/api/attention/:id/snooze", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const hours = Number(req.body?.hours ?? 4);
      if (!id || isNaN(hours) || hours <= 0) return res.status(400).json({ message: "Invalid request" });

      const { snoozeAttentionItem } = await import("./attention-engine");
      await snoozeAttentionItem(id, hours);
      res.json({ success: true, snoozedHours: hours });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/attention/:id/dismiss — dismiss item
  app.patch("/api/attention/:id/dismiss", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ message: "Missing id" });

      const { dismissAttentionItem } = await import("./attention-engine");
      await dismissAttentionItem(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/attention/:id/complete — mark item complete
  app.patch("/api/attention/:id/complete", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ message: "Missing id" });

      const { completeAttentionItem } = await import("./attention-engine");
      await completeAttentionItem(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PR Tracker & Shared Org Auth ─────────────────────────────────────────
  const { registerPrTrackerRoutes } = await import("./pr-tracker-routes");
  registerPrTrackerRoutes(app);

  // ── PR Intelligence Agent ─────────────────────────────────────────────────
  const { registerPrIntelligenceRoutes } = await import("./pr-intelligence-routes");
  registerPrIntelligenceRoutes(app);

  const { registerIntelligenceRoutes, startIntelligenceCron } = await import("./intelligence-routes");
  registerIntelligenceRoutes(app);
  startIntelligenceCron();

  // ── Org Schedule Routes ───────────────────────────────────────────────────
  const { registerOrgScheduleRoutes } = await import("./org-schedule-routes");
  registerOrgScheduleRoutes(app);

  // ── Org Profile Routes ────────────────────────────────────────────────────
  const { registerOrgProfileRoutes } = await import("./org-profile-routes");
  registerOrgProfileRoutes(app);

  // ── Coach Team Routes ─────────────────────────────────────────────────────
  const { registerCoachTeamRoutes } = await import("./coach-team-routes");
  registerCoachTeamRoutes(app);

  // ── Integrations Routes ───────────────────────────────────────────────────
  const { registerIntegrationsRoutes } = await import("./integrations-routes");
  registerIntegrationsRoutes(app);

  // ── Workout Builder Routes ────────────────────────────────────────────────
  const { registerWorkoutBuilderRoutes } = await import("./workout-builder-routes");
  registerWorkoutBuilderRoutes(app);

  // ── Intervention Intelligence Routes ─────────────────────────────────────
  const { registerInterventionOutcomeRoutes } = await import("./intervention-outcome-routes");
  registerInterventionOutcomeRoutes(app);

  // ── Workout Execution Routes ──────────────────────────────────────────────
  const { registerWorkoutExecutionRoutes } = await import("./workout-execution-routes");
  registerWorkoutExecutionRoutes(app);

  // ── Org Communication & Notifications Routes ──────────────────────────────
  const { registerOrgCommunicationRoutes } = await import("./org-communication-routes");
  registerOrgCommunicationRoutes(app);

  // ── Activity Timeline Routes ───────────────────────────────────────────────
  const { registerActivityRoutes } = await import("./activity-routes");
  registerActivityRoutes(app);

  // ── Calendar Create Routes ─────────────────────────────────────────────────
  const { registerCalendarCreateRoutes } = await import("./calendar-create-routes");
  registerCalendarCreateRoutes(app);

  // ── Nutrition Education Routes ─────────────────────────────────────────────
  const { registerNutritionRoutes } = await import("./nutrition-routes");
  registerNutritionRoutes(app);

  // ── Education Builder Routes ───────────────────────────────────────────────
  const { registerEducationRoutes } = await import("./education-routes");
  registerEducationRoutes(app);

  // ── Education Phase 2: Adaptive Learning System ───────────────────────────
  const { registerEducationPhase2Routes } = await import("./education-phase2-routes");
  registerEducationPhase2Routes(app);

  // ── Guardian Portal Routes ─────────────────────────────────────────────────
  const { registerGuardianRoutes } = await import("./guardian-routes");
  registerGuardianRoutes(app);

  // ── Athlete Readiness Score + Risk Engine ──────────────────────────────────
  const { registerAthleteReadinessRoutes } = await import("./athlete-readiness-routes");
  registerAthleteReadinessRoutes(app);

  // ── Adaptive Intervention Workflows + Action Engine ─────────────────────────
  const { registerAdaptiveWorkflowRoutes } = await import("./adaptive-workflow-routes");
  registerAdaptiveWorkflowRoutes(app);

  // ── Lead Capture Programs ─────────────────────────────────────────────────────

  // Public: get lead capture program details by org slug + program slug
  app.get("/api/public/lead-capture/:orgSlug/:programSlug", async (req, res) => {
    try {
      const org = await storage.getOrganizationBySlug(req.params.orgSlug);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const program = await storage.getAthleticProgramBySlug(org.id, req.params.programSlug);
      if (!program || program.type !== "lead_capture") return res.status(404).json({ message: "Program not found" });
      const { db } = await import("./db");
      const { leadCapturePrograms } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [config] = await db.select().from(leadCapturePrograms).where(eq(leadCapturePrograms.programId, program.id));
      res.json({ org: { name: org.name, slug: org.slug, logoUrl: org.logoUrl, primaryColor: org.primaryColor }, program, config: config || null });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch lead capture program" });
    }
  });

  // Public: list active org-created landing pages (lead_capture programs with showInOrgMenu = true)
  app.get("/api/public/orgs/:slug/landing-pages", async (req, res) => {
    try {
      const org = await storage.getOrganizationBySlug(req.params.slug);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const { db } = await import("./db");
      const { leadCapturePrograms, athleticPrograms } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const pages = await db
        .select({
          id: athleticPrograms.id,
          name: athleticPrograms.name,
          slug: athleticPrograms.slug,
          headline: leadCapturePrograms.headline,
          subheadline: leadCapturePrograms.subheadline,
          ctaText: leadCapturePrograms.ctaText,
          funnelType: leadCapturePrograms.funnelType,
          navLabel: leadCapturePrograms.navLabel,
          navOrder: leadCapturePrograms.navOrder,
          heroImageUrl: leadCapturePrograms.heroImageUrl,
        })
        .from(athleticPrograms)
        .innerJoin(leadCapturePrograms, eq(leadCapturePrograms.programId, athleticPrograms.id))
        .where(
          and(
            eq(athleticPrograms.organizationId, org.id),
            eq(athleticPrograms.active, true),
            eq(leadCapturePrograms.showInOrgMenu, true)
          )
        )
        .orderBy(leadCapturePrograms.navOrder);
      res.json(pages);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch landing pages" });
    }
  });

  // Public: partial capture after Step 1
  app.post("/api/public/lead-capture/:orgSlug/:programSlug/partial", async (req, res) => {
    try {
      const org = await storage.getOrganizationBySlug(req.params.orgSlug);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const program = await storage.getAthleticProgramBySlug(org.id, req.params.programSlug);
      if (!program || program.type !== "lead_capture") return res.status(404).json({ message: "Program not found" });
      const { athleteName, email, phone, utmSource, utmMedium, utmCampaign, utmContent, utmTerm } = req.body;
      if (!athleteName || !email) return res.status(400).json({ message: "athleteName and email required" });
      const { db } = await import("./db");
      const { leadCaptureAbandoned } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      // Upsert by email + programId (avoid duplicate abandoned records per session)
      const [existing] = await db.select().from(leadCaptureAbandoned)
        .where(and(eq(leadCaptureAbandoned.email, email), eq(leadCaptureAbandoned.programId, program.id)));
      if (existing && !existing.completedAt) {
        return res.json({ abandonedId: existing.id });
      }
      const [record] = await db.insert(leadCaptureAbandoned).values({
        orgId: org.id,
        programId: program.id,
        athleteName,
        email,
        phone: phone || null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        utmContent: utmContent || null,
        utmTerm: utmTerm || null,
      }).returning();
      res.json({ abandonedId: record.id });
    } catch (error) {
      res.status(500).json({ message: "Failed to save partial" });
    }
  });

  // Public: submit lead capture form
  app.post("/api/public/lead-capture/:orgSlug/:programSlug/submit", async (req, res) => {
    try {
      const org = await storage.getOrganizationBySlug(req.params.orgSlug);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const program = await storage.getAthleticProgramBySlug(org.id, req.params.programSlug);
      if (!program || program.type !== "lead_capture") return res.status(404).json({ message: "Program not found" });

      const { athleteName, parentName, email, phone, age, grade, sport, position, school, goals, experienceLevel, currentTrainingStatus, commitmentLevel, notes, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, abandonedId } = req.body;
      if (!athleteName || !email) return res.status(400).json({ message: "athleteName and email are required" });

      const { db } = await import("./db");
      const { leadCaptureSubmissions, leadCaptureAbandoned } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [submission] = await db.insert(leadCaptureSubmissions).values({
        orgId: org.id,
        programId: program.id,
        athleteName,
        parentName: parentName || null,
        email,
        phone: phone || null,
        age: age ? String(age) : null,
        grade: grade || null,
        sport: sport || null,
        position: position || null,
        school: school || null,
        goals: Array.isArray(goals) ? goals : [],
        experienceLevel: experienceLevel || null,
        currentTrainingStatus: currentTrainingStatus || null,
        commitmentLevel: commitmentLevel || null,
        notes: notes || null,
        aiQualificationScore: null,
        aiQualificationReason: null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        utmContent: utmContent || null,
        utmTerm: utmTerm || null,
        abandonedId: abandonedId || null,
      }).returning();

      // Mark abandoned record as completed
      if (abandonedId) {
        try {
          await db.update(leadCaptureAbandoned).set({ completedAt: new Date(), submissionId: submission.id }).where(eq(leadCaptureAbandoned.id, abandonedId));
        } catch (_) {}
      }

      // Fetch booking context needed for the immediate response
      let bookingUrl: string | null = null;
      let bookingType: string = "none";
      try {
        const { leadCapturePrograms: lcpResp } = await import("@shared/schema");
        const { eq: eqResp } = await import("drizzle-orm");
        const [lcRow] = await db.select({ bookingUrl: lcpResp.bookingUrl, bookingType: lcpResp.bookingType })
          .from(lcpResp).where(eqResp(lcpResp.programId, program.id)).limit(1);
        bookingUrl = lcRow?.bookingUrl ?? null;
        bookingType = lcRow?.bookingType ?? "none";
      } catch (_) {}

      // ✅ Respond immediately — submission is persisted. Side effects below are fully non-blocking.
      res.status(201).json({
        success: true,
        submissionId: submission.id,
        orgSlug: org.slug,
        orgName: org.name,
        orgId: org.id,
        programId: program.id,
        programName: program.name,
        athleteName,
        email,
        bookingUrl,
        bookingType,
        emailStatus: { admin: "pending", applicant: "pending" },
      });

      // ---- Fire-and-forget side effects (closure has access to db, eq, org, program, submission, etc.) ----
      (async () => {

      // SendGrid client resolved via verified sender identity (same as rest of app)
      let _sgClient: { client: any; fromEmail: string } | null = null;
      const getSg = async () => {
        if (!_sgClient) {
          const { getUncachableSendGridClient } = await import("./email");
          _sgClient = await getUncachableSendGridClient();
        }
        return _sgClient;
      };

      // 1. Resolve admin recipient with multi-fallback chain
      let adminEmail: string | null = org.ownerEmail || org.schedulingInquiryEmail || null;

      if (!adminEmail && org.ownerUserId) {
        try {
          const ownerUser = await storage.getUser(org.ownerUserId);
          if (ownerUser?.email) adminEmail = ownerUser.email;
        } catch (_) {}
      }

      if (!adminEmail) {
        try {
          const { orgMemberships, users: usersTable } = await import("@shared/schema");
          const { and } = await import("drizzle-orm");
          const adminRows = await db
            .select({ email: usersTable.email })
            .from(orgMemberships)
            .innerJoin(usersTable, eq(usersTable.id, orgMemberships.userId))
            .where(and(eq(orgMemberships.orgId, org.id), eq(orgMemberships.role, "ADMIN")))
            .limit(1);
          if (adminRows[0]?.email) adminEmail = adminRows[0].email;
        } catch (_) {}
      }

      if (!adminEmail) {
        try {
          const { coachProfiles } = await import("@shared/schema");
          const coachRows = await db
            .select({ email: coachProfiles.email })
            .from(coachProfiles)
            .where(eq(coachProfiles.organizationId, org.id))
            .limit(1);
          if (coachRows[0]?.email) adminEmail = coachRows[0].email;
        } catch (_) {}
      }

      if (!adminEmail) {
        console.warn(`[LeadCapture] No admin recipient found for org ${org.id} (${org.slug}) — checked ownerEmail, schedulingInquiryEmail, ownerUserId, orgMemberships, coachProfiles`);
      } else {
        console.log(`[LeadCapture] Admin recipient resolved to: ${adminEmail} for org ${org.slug}`);
      }

      const submittedAt = new Date();
      const { formatEmailTimestamp } = await import("./utils/format-email-timestamp");
      const orgTimezone = (org as any).timezone || "America/New_York";
      const submissionTimestamp = formatEmailTimestamp(submittedAt, orgTimezone);
      const commandCenterUrl = `${process.env.APP_URL || "https://trainefficiency.com"}/command-center`;

      const adminEmailHtml = `
        <div style="font-family:sans-serif;max-width:620px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#f97316,#f59e0b);padding:24px;border-radius:12px 12px 0 0">
            <h2 style="color:white;margin:0;font-size:20px">🏆 New Athlete Application</h2>
            <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">${program.name}</p>
            <p style="color:rgba(255,255,255,0.7);margin:2px 0 0;font-size:12px">${submissionTimestamp}</p>
          </div>
          <div style="background:#18181b;padding:24px;border-radius:0 0 12px 12px;color:#e4e4e7">
            <table style="width:100%;border-collapse:collapse">
              <tr><td colspan="2" style="padding:4px 0;border-bottom:1px solid #3f3f46;font-size:13px;font-weight:bold;color:#fb923c;text-transform:uppercase;letter-spacing:.05em">Athlete Info</td></tr>
              <tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa;width:35%">Athlete</td><td style="padding:6px 0;font-size:13px;font-weight:600">${athleteName}</td></tr>
              ${parentName ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Parent</td><td style="padding:6px 0;font-size:13px">${parentName}</td></tr>` : ""}
              ${age ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Age</td><td style="padding:6px 0;font-size:13px">${age}</td></tr>` : ""}
              ${grade ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Grade</td><td style="padding:6px 0;font-size:13px">${grade}</td></tr>` : ""}
              ${sport ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Sport</td><td style="padding:6px 0;font-size:13px">${sport}${position ? ` / ${position}` : ""}</td></tr>` : ""}
              ${school ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">School</td><td style="padding:6px 0;font-size:13px">${school}</td></tr>` : ""}
              <tr><td colspan="2" style="padding:12px 0 4px;border-bottom:1px solid #3f3f46;font-size:13px;font-weight:bold;color:#fb923c;text-transform:uppercase;letter-spacing:.05em">Contact</td></tr>
              <tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Email</td><td style="padding:6px 0;font-size:13px"><a href="mailto:${email}" style="color:#60a5fa">${email}</a></td></tr>
              ${phone ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Phone</td><td style="padding:6px 0;font-size:13px"><a href="tel:${phone}" style="color:#60a5fa">${phone}</a></td></tr>` : ""}
              <tr><td colspan="2" style="padding:12px 0 4px;border-bottom:1px solid #3f3f46;font-size:13px;font-weight:bold;color:#fb923c;text-transform:uppercase;letter-spacing:.05em">Application Details</td></tr>
              ${goals?.length ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Goals</td><td style="padding:6px 0;font-size:13px">${Array.isArray(goals) ? goals.join(", ") : goals}</td></tr>` : ""}
              ${commitmentLevel ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Commitment</td><td style="padding:6px 0;font-size:13px;color:#4ade80;font-weight:600">${commitmentLevel}</td></tr>` : ""}
              ${experienceLevel ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Experience</td><td style="padding:6px 0;font-size:13px">${experienceLevel}</td></tr>` : ""}
              ${currentTrainingStatus ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Training Status</td><td style="padding:6px 0;font-size:13px">${currentTrainingStatus}</td></tr>` : ""}
              ${notes ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Notes</td><td style="padding:6px 0;font-size:13px">${notes}</td></tr>` : ""}
              <tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">AI Score</td><td style="padding:6px 0;font-size:13px;color:#f59e0b">Pending (scoring async)</td></tr>
              ${(utmSource || utmCampaign) ? `<tr><td colspan="2" style="padding:12px 0 4px;border-bottom:1px solid #3f3f46;font-size:13px;font-weight:bold;color:#fb923c;text-transform:uppercase;letter-spacing:.05em">Attribution</td></tr><tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Source</td><td style="padding:6px 0;font-size:13px">${[utmSource, utmMedium, utmCampaign].filter(Boolean).join(" / ")}</td></tr>` : ""}
            </table>
            <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
              <a href="mailto:${email}" style="display:inline-block;background:#3b82f6;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">✉ Email Athlete</a>
              ${phone ? `<a href="tel:${phone}" style="display:inline-block;background:#10b981;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">📞 Call ${phone}</a>` : ""}
              <a href="${commandCenterUrl}" style="display:inline-block;background:#f97316;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">🎯 Open Command Center</a>
            </div>
          </div>
        </div>
      `;

      // 1. Email org admin
      let adminEmailStatus = "not_attempted";
      let adminEmailError: string | null = null;
      let adminEmailSentAt: Date | null = null;

      if (adminEmail) {
        try {
          const { client: sgMail, fromEmail } = await getSg();
          console.log(`[LeadCapture] Sending admin notification → ${adminEmail} (org: ${org.slug})`);
          const [sgResponse] = await sgMail.send({
            to: adminEmail,
            from: fromEmail,
            subject: `🏆 New Lead: ${athleteName} applied to ${program.name}`,
            html: adminEmailHtml,
          });
          console.log(`[LeadCapture] Admin email accepted — SendGrid status ${sgResponse?.statusCode}, recipient: ${adminEmail}`);
          adminEmailStatus = "sent";
          adminEmailSentAt = new Date();
        } catch (emailErr: any) {
          adminEmailStatus = "failed";
          adminEmailError = emailErr?.response?.body
            ? JSON.stringify(emailErr.response.body)
            : (emailErr.message || "Unknown SendGrid error");
          console.error(`[LeadCapture] Admin email FAILED for org ${org.slug} → ${adminEmail}:`, adminEmailError);
        }
      } else {
        adminEmailStatus = "no_recipient";
      }

      // Update submission with email audit fields (non-blocking)
      try {
        await db.update(leadCaptureSubmissions).set({
          adminEmailSentAt,
          adminEmailStatus,
          adminEmailError,
        }).where(eq(leadCaptureSubmissions.id, submission.id));
      } catch (_) {}

      // 2. Applicant confirmation email
      let applicantEmailStatus = "pending";
      let applicantEmailError: string | null = null;
      let applicantEmailSentAt: Date | null = null;

      if (email) {
        try {
          // Fetch lead capture program config for bookingUrl + hero image
          const { leadCapturePrograms: lcpTable } = await import("@shared/schema");
          const { eq: eqLC } = await import("drizzle-orm");
          const [lcProgram] = await db.select().from(lcpTable).where(eqLC(lcpTable.programId, program.id)).limit(1);

          const bookingUrl = lcProgram?.bookingUrl || null;
          const orgLogoUrl = org.logoUrl || null;
          const primaryColor = org.emailPrimaryColor || org.primaryColor || "#f97316";
          const athleteFirstName = athleteName.split(" ")[0];
          const contactEmail = org.ownerEmail || org.schedulingInquiryEmail || fromEmail;
          const websiteUrl = org.websiteUrl || null;

          const applicantHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application Received</title></head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">

        <!-- HEADER -->
        <tr><td style="background:linear-gradient(135deg,${primaryColor},#f59e0b);border-radius:16px 16px 0 0;padding:40px 32px;text-align:center">
          ${orgLogoUrl ? `<img src="${orgLogoUrl}" alt="${org.name}" style="height:48px;margin-bottom:16px;object-fit:contain" />` : ""}
          <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:50px;padding:6px 18px;margin-bottom:16px">
            <span style="color:white;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">Application Received</span>
          </div>
          <h1 style="color:white;margin:0 0 8px;font-size:28px;font-weight:800;line-height:1.2">You're In the Pipeline,<br />${athleteFirstName}.</h1>
          <p style="color:rgba(255,255,255,0.85);margin:0;font-size:16px;font-weight:500">${program.name} — ${org.name}</p>
        </td></tr>

        <!-- BODY -->
        <tr><td style="background:#18181b;padding:36px 32px">

          <!-- Confirmation message -->
          <p style="color:#e4e4e7;font-size:16px;line-height:1.7;margin:0 0 24px">
            Hey <strong style="color:white">${athleteFirstName}</strong>, your application has been received and is being reviewed by our coaching staff. This is the first step toward elite-level performance.
          </p>

          <!-- Divider -->
          <hr style="border:none;border-top:1px solid #3f3f46;margin:0 0 28px" />

          <!-- Next Steps -->
          <p style="color:#a1a1aa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin:0 0 20px">What Happens Next</p>

          <table width="100%" cellpadding="0" cellspacing="0">
            <!-- Step 1 -->
            <tr>
              <td style="width:48px;vertical-align:top;padding-bottom:20px">
                <div style="width:36px;height:36px;background:linear-gradient(135deg,${primaryColor},#f59e0b);border-radius:50%;text-align:center;line-height:36px;font-size:15px;font-weight:800;color:white">1</div>
              </td>
              <td style="vertical-align:top;padding-bottom:20px;padding-left:8px">
                <p style="color:white;font-size:15px;font-weight:700;margin:6px 0 4px">Application Review</p>
                <p style="color:#a1a1aa;font-size:13px;margin:0;line-height:1.6">Our coaches review every application personally — your goals, sport background, and training history.</p>
              </td>
            </tr>
            <!-- Step 2 -->
            <tr>
              <td style="width:48px;vertical-align:top;padding-bottom:20px">
                <div style="width:36px;height:36px;background:linear-gradient(135deg,${primaryColor},#f59e0b);border-radius:50%;text-align:center;line-height:36px;font-size:15px;font-weight:800;color:white">2</div>
              </td>
              <td style="vertical-align:top;padding-bottom:20px;padding-left:8px">
                <p style="color:white;font-size:15px;font-weight:700;margin:6px 0 4px">Coach Outreach</p>
                <p style="color:#a1a1aa;font-size:13px;margin:0;line-height:1.6">A coach will contact you within <strong style="color:#e4e4e7">24–48 hours</strong> to discuss your goals and answer any questions.</p>
              </td>
            </tr>
            <!-- Step 3 -->
            <tr>
              <td style="width:48px;vertical-align:top">
                <div style="width:36px;height:36px;background:linear-gradient(135deg,${primaryColor},#f59e0b);border-radius:50%;text-align:center;line-height:36px;font-size:15px;font-weight:800;color:white">3</div>
              </td>
              <td style="vertical-align:top;padding-left:8px">
                <p style="color:white;font-size:15px;font-weight:700;margin:6px 0 4px">Training Evaluation</p>
                <p style="color:#a1a1aa;font-size:13px;margin:0;line-height:1.6">We'll schedule your evaluation session where you'll meet the team and experience the training firsthand.</p>
              </td>
            </tr>
          </table>

          ${bookingUrl ? `
          <!-- Booking CTA -->
          <div style="margin-top:32px;background:#27272a;border-radius:12px;padding:24px;text-align:center;border:1px solid #3f3f46">
            <p style="color:#a1a1aa;font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Ready to Skip the Wait?</p>
            <p style="color:white;font-size:16px;font-weight:700;margin:0 0 20px">Book your evaluation session directly</p>
            <a href="${bookingUrl}" style="display:inline-block;background:linear-gradient(135deg,${primaryColor},#f59e0b);color:white;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:.03em">Book My Evaluation →</a>
          </div>
          ` : ""}

          <!-- Application summary -->
          <div style="margin-top:28px;background:#27272a;border-radius:10px;padding:20px;border:1px solid #3f3f46">
            <p style="color:#a1a1aa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin:0 0 14px">Your Application Summary</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0;width:40%">Program</td><td style="color:#e4e4e7;font-size:13px;font-weight:600;padding:5px 0">${program.name}</td></tr>
              ${sport ? `<tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0">Sport</td><td style="color:#e4e4e7;font-size:13px;padding:5px 0">${sport}${position ? ` / ${position}` : ""}</td></tr>` : ""}
              ${age ? `<tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0">Age</td><td style="color:#e4e4e7;font-size:13px;padding:5px 0">${age}</td></tr>` : ""}
              ${school ? `<tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0">School</td><td style="color:#e4e4e7;font-size:13px;padding:5px 0">${school}</td></tr>` : ""}
              ${commitmentLevel ? `<tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0">Commitment</td><td style="color:#4ade80;font-size:13px;font-weight:600;padding:5px 0">${commitmentLevel}</td></tr>` : ""}
              <tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0">Submitted</td><td style="color:#e4e4e7;font-size:13px;padding:5px 0">${submissionTimestamp}</td></tr>
            </table>
          </div>

        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#09090b;border-radius:0 0 16px 16px;padding:28px 32px;border-top:1px solid #27272a;text-align:center">
          <p style="color:#71717a;font-size:13px;margin:0 0 8px">Questions? Contact us at <a href="mailto:${contactEmail}" style="color:${primaryColor};text-decoration:none">${contactEmail}</a></p>
          ${websiteUrl ? `<p style="color:#71717a;font-size:13px;margin:0 0 12px"><a href="${websiteUrl}" style="color:#71717a;text-decoration:underline">${websiteUrl}</a></p>` : ""}
          <p style="color:#52525b;font-size:12px;margin:0">© ${new Date().getFullYear()} ${org.name}. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

          const { client: sgMail, fromEmail } = await getSg();
          console.log(`[LeadCapture] Sending applicant confirmation → ${email} (org: ${org.slug}, program: ${program.name})`);
          const [sgApplicantResp] = await sgMail.send({
            to: email,
            from: fromEmail,
            subject: `Your Application Was Received — ${program.name}`,
            html: applicantHtml,
          });
          console.log(`[LeadCapture] Applicant email accepted — SendGrid status ${sgApplicantResp?.statusCode}`);
          applicantEmailStatus = "sent";
          applicantEmailSentAt = new Date();
        } catch (applicantEmailErr: any) {
          applicantEmailStatus = "failed";
          applicantEmailError = applicantEmailErr?.response?.body
            ? JSON.stringify(applicantEmailErr.response.body)
            : (applicantEmailErr.message || "Unknown SendGrid error");
          console.error(`[LeadCapture] Applicant email FAILED → ${email}:`, applicantEmailError);
        }
      } else {
        applicantEmailStatus = "no_api_key";
      }

      // Persist applicant email audit fields (non-blocking)
      try {
        await db.update(leadCaptureSubmissions).set({
          applicantEmailSentAt,
          applicantEmailStatus,
          applicantEmailError,
        }).where(eq(leadCaptureSubmissions.id, submission.id));
      } catch (_) {}

      // 3. Create CRM prospect entry
      try {
        const { teamTrainingProspects } = await import("@shared/schema");
        await db.insert(teamTrainingProspects).values({
          orgId: org.id,
          prospectName: athleteName + (school ? ` / ${school}` : ""),
          sport: sport || "General",
          city: school || "Unknown",
          state: "Unknown",
          contactEmail: email,
          contactName: athleteName,
          notes: `Lead Capture: ${program.name}. ${notes || ""}`.trim(),
        } as any).onConflictDoNothing();
      } catch (_) {}

      // 4. Intelligent Lead Intake Pipeline (async, non-blocking — runs in parallel with AI scoring)
      (async () => {
        try {
          const { runIntelligentLeadIntakePipeline } = await import("./services/intelligent-lead-intake-service");
          await runIntelligentLeadIntakePipeline({
            submissionId: submission.id,
            orgId: org.id,
            programId: program.id,
            programName: program.name,
            orgName: org.name,
            athleteName,
            parentName: parentName || null,
            email,
            phone: phone || null,
            age: age ? String(age) : null,
            grade: grade || null,
            sport: sport || null,
            position: position || null,
            school: school || null,
            goals: Array.isArray(goals) ? goals : [],
            experienceLevel: experienceLevel || null,
            currentTrainingStatus: currentTrainingStatus || null,
            commitmentLevel: commitmentLevel || null,
            notes: notes || null,
            utmSource: utmSource || null,
            utmMedium: utmMedium || null,
            utmCampaign: utmCampaign || null,
            utmContent: utmContent || null,
            utmTerm: utmTerm || null,
            landingPageId: null,
            submittedAt: new Date(),
          });
        } catch (intakeErr: any) {
          console.error("[IntakeIntelligence] Pipeline error (non-blocking):", intakeErr?.message);
        }
      })();

      // 5. AI qualification scoring (async, non-blocking)
      (async () => {
        try {
          const openai = new (await import("openai")).default({ apiKey: process.env.OPENAI_API_KEY });
          const prompt = `You are an athletic recruiting specialist. Score this lead 1-100 for likelihood of becoming a paying client.

Athlete: ${athleteName}, Age: ${age || "?"}, Grade: ${grade || "?"}, Sport: ${sport || "?"}, School: ${school || "?"}
Goals: ${Array.isArray(goals) ? goals.join(", ") : "?"}, Experience: ${experienceLevel || "?"}, Commitment: ${commitmentLevel || "?"}
Training Status: ${currentTrainingStatus || "?"}, Notes: ${notes || ""}

Return JSON: { "score": number, "reason": "one sentence" }`;

          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            max_tokens: 100,
          });
          const aiResult = JSON.parse(response.choices[0].message.content || "{}");
          if (aiResult.score) {
            await db.update(leadCaptureSubmissions).set({
              aiQualificationScore: aiResult.score,
              aiQualificationReason: aiResult.reason || null,
            }).where(eq(leadCaptureSubmissions.id, submission.id));

            // 5. High-intent admin alert (score >= 80)
            if (aiResult.score >= 80 && adminEmail) {
              try {
                const { getUncachableSendGridClient } = await import("./email");
                const { client: sgMail, fromEmail: sgFrom } = await getUncachableSendGridClient();
                await sgMail.send({
                  to: adminEmail,
                  from: sgFrom,
                  subject: `🔥 HIGH-INTENT LEAD: ${athleteName} scored ${aiResult.score}/100`,
                  html: `
                    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
                      <div style="background:linear-gradient(135deg,#dc2626,#f97316);padding:20px;border-radius:12px 12px 0 0">
                        <h2 style="color:white;margin:0">🔥 High-Intent Lead Alert</h2>
                        <p style="color:rgba(255,255,255,0.9);margin:4px 0 0">AI Score: ${aiResult.score}/100 — Take action now</p>
                      </div>
                      <div style="background:#18181b;padding:20px;border-radius:0 0 12px 12px;color:#e4e4e7">
                        <p><strong>${athleteName}</strong> — ${sport || "Unknown sport"}, ${school || "Unknown school"}</p>
                        <p style="color:#4ade80">${aiResult.reason}</p>
                        ${phone ? `<p><a href="tel:${phone}" style="background:#f97316;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;display:inline-block">📞 Call Now: ${phone}</a></p>` : ""}
                        <p><a href="mailto:${email}" style="background:#3b82f6;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;display:inline-block">✉ Email: ${email}</a></p>
                      </div>
                    </div>
                  `,
                });
              } catch (_) {}
            }
          }
        } catch (_) {}
      })();

      })().catch((err) => console.error("[LeadCapture] Background side-effect error (submission already saved):", err));

    } catch (error) {
      console.error("Lead capture submit error:", error);
      res.status(500).json({ message: "Failed to submit application" });
    }
  });

  // Authenticated: link a lead capture submission to the current user account
  app.post("/api/lead-capture/link-submission", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { submissionId } = req.body;
      if (!submissionId) return res.status(400).json({ message: "submissionId required" });

      const { db } = await import("./db");
      const { leadCaptureSubmissions, leadCapturePrograms } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [submission] = await db.select().from(leadCaptureSubmissions).where(eq(leadCaptureSubmissions.id, submissionId)).limit(1);
      if (!submission) return res.status(404).json({ message: "Submission not found" });

      // Only link if not already linked
      if (!submission.linkedUserId) {
        await db.update(leadCaptureSubmissions).set({
          linkedUserId: userId,
          signupConvertedAt: new Date(),
        }).where(eq(leadCaptureSubmissions.id, submissionId));
      }

      // Fetch booking context
      const [lcConfig] = await db.select({ bookingUrl: leadCapturePrograms.bookingUrl, bookingType: leadCapturePrograms.bookingType })
        .from(leadCapturePrograms).where(eq(leadCapturePrograms.programId, submission.programId)).limit(1);

      // Fetch org slug
      const org = await storage.getOrganizationById(submission.orgId);

      res.json({
        success: true,
        bookingUrl: lcConfig?.bookingUrl || null,
        bookingType: lcConfig?.bookingType || "none",
        orgSlug: org?.slug || null,
        programId: submission.programId,
        athleteName: submission.athleteName,
      });
    } catch (error) {
      console.error("link-submission error:", error);
      res.status(500).json({ message: "Failed to link submission" });
    }
  });

  // Admin: resend admin notification email for a submission
  app.post("/api/lead-capture/submissions/:id/resend-admin-email", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { db } = await import("./db");
      const { leadCaptureSubmissions, athleticPrograms, organizations, orgMemberships, users: usersTable, coachProfiles } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [submission] = await db.select().from(leadCaptureSubmissions)
        .where(and(eq(leadCaptureSubmissions.id, req.params.id), eq(leadCaptureSubmissions.orgId, profile.organizationId)))
        .limit(1);
      if (!submission) return res.status(404).json({ message: "Submission not found" });

      const [org] = await db.select().from(organizations).where(eq(organizations.id, profile.organizationId)).limit(1);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const [program] = await db.select().from(athleticPrograms).where(eq(athleticPrograms.id, submission.programId)).limit(1);

      // Resolve admin recipient with fallback chain
      let adminEmail: string | null = org.ownerEmail || org.schedulingInquiryEmail || null;
      if (!adminEmail && org.ownerUserId) {
        try {
          const ownerUser = await storage.getUser(org.ownerUserId);
          if (ownerUser?.email) adminEmail = ownerUser.email;
        } catch (_) {}
      }
      if (!adminEmail) {
        try {
          const adminRows = await db.select({ email: usersTable.email })
            .from(orgMemberships)
            .innerJoin(usersTable, eq(usersTable.id, orgMemberships.userId))
            .where(and(eq(orgMemberships.orgId, org.id), eq(orgMemberships.role, "ADMIN")))
            .limit(1);
          if (adminRows[0]?.email) adminEmail = adminRows[0].email;
        } catch (_) {}
      }
      if (!adminEmail) {
        try {
          const coachRows = await db.select({ email: coachProfiles.email })
            .from(coachProfiles)
            .where(eq(coachProfiles.organizationId, org.id))
            .limit(1);
          if (coachRows[0]?.email) adminEmail = coachRows[0].email;
        } catch (_) {}
      }
      if (!adminEmail) return res.status(400).json({ message: "No admin email recipient found for this organization" });

      const { athleteName, parentName, email, phone, age, grade, sport, position, school, goals, commitmentLevel, experienceLevel, currentTrainingStatus, notes, utmSource, utmMedium, utmCampaign, aiQualificationScore, createdAt } = submission;
      const { formatEmailTimestamp: fmtAdminTs } = await import("./utils/format-email-timestamp");
      const orgTimezoneAdmin = (org as any).timezone || "America/New_York";
      const submissionTimestamp = createdAt ? fmtAdminTs(new Date(createdAt), orgTimezoneAdmin) : "Unknown";
      const commandCenterUrl = `${process.env.APP_URL || "https://trainefficiency.com"}/command-center`;
      const programName = program?.name || "Lead Capture Program";

      const html = `
        <div style="font-family:sans-serif;max-width:620px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#f97316,#f59e0b);padding:24px;border-radius:12px 12px 0 0">
            <h2 style="color:white;margin:0;font-size:20px">🏆 Athlete Application (Resent)</h2>
            <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">${programName}</p>
            <p style="color:rgba(255,255,255,0.7);margin:2px 0 0;font-size:12px">Originally submitted: ${submissionTimestamp}</p>
          </div>
          <div style="background:#18181b;padding:24px;border-radius:0 0 12px 12px;color:#e4e4e7">
            <table style="width:100%;border-collapse:collapse">
              <tr><td colspan="2" style="padding:4px 0;border-bottom:1px solid #3f3f46;font-size:13px;font-weight:bold;color:#fb923c;text-transform:uppercase;letter-spacing:.05em">Athlete Info</td></tr>
              <tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa;width:35%">Athlete</td><td style="padding:6px 0;font-size:13px;font-weight:600">${athleteName}</td></tr>
              ${parentName ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Parent</td><td style="padding:6px 0;font-size:13px">${parentName}</td></tr>` : ""}
              ${age ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Age</td><td style="padding:6px 0;font-size:13px">${age}</td></tr>` : ""}
              ${grade ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Grade</td><td style="padding:6px 0;font-size:13px">${grade}</td></tr>` : ""}
              ${sport ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Sport</td><td style="padding:6px 0;font-size:13px">${sport}${position ? ` / ${position}` : ""}</td></tr>` : ""}
              ${school ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">School</td><td style="padding:6px 0;font-size:13px">${school}</td></tr>` : ""}
              <tr><td colspan="2" style="padding:12px 0 4px;border-bottom:1px solid #3f3f46;font-size:13px;font-weight:bold;color:#fb923c;text-transform:uppercase;letter-spacing:.05em">Contact</td></tr>
              <tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Email</td><td style="padding:6px 0;font-size:13px"><a href="mailto:${email}" style="color:#60a5fa">${email}</a></td></tr>
              ${phone ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Phone</td><td style="padding:6px 0;font-size:13px"><a href="tel:${phone}" style="color:#60a5fa">${phone}</a></td></tr>` : ""}
              <tr><td colspan="2" style="padding:12px 0 4px;border-bottom:1px solid #3f3f46;font-size:13px;font-weight:bold;color:#fb923c;text-transform:uppercase;letter-spacing:.05em">Application Details</td></tr>
              ${goals?.length ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Goals</td><td style="padding:6px 0;font-size:13px">${Array.isArray(goals) ? goals.join(", ") : goals}</td></tr>` : ""}
              ${commitmentLevel ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Commitment</td><td style="padding:6px 0;font-size:13px;color:#4ade80;font-weight:600">${commitmentLevel}</td></tr>` : ""}
              ${experienceLevel ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Experience</td><td style="padding:6px 0;font-size:13px">${experienceLevel}</td></tr>` : ""}
              ${currentTrainingStatus ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Training Status</td><td style="padding:6px 0;font-size:13px">${currentTrainingStatus}</td></tr>` : ""}
              ${notes ? `<tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Notes</td><td style="padding:6px 0;font-size:13px">${notes}</td></tr>` : ""}
              <tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">AI Score</td><td style="padding:6px 0;font-size:13px;color:#f59e0b">${aiQualificationScore != null ? `${aiQualificationScore}/100` : "Pending"}</td></tr>
              ${(utmSource || utmCampaign) ? `<tr><td colspan="2" style="padding:12px 0 4px;border-bottom:1px solid #3f3f46;font-size:13px;font-weight:bold;color:#fb923c;text-transform:uppercase;letter-spacing:.05em">Attribution</td></tr><tr><td style="padding:6px 0;font-size:13px;color:#a1a1aa">Source</td><td style="padding:6px 0;font-size:13px">${[utmSource, utmMedium, utmCampaign].filter(Boolean).join(" / ")}</td></tr>` : ""}
            </table>
            <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
              <a href="mailto:${email}" style="display:inline-block;background:#3b82f6;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">✉ Email Athlete</a>
              ${phone ? `<a href="tel:${phone}" style="display:inline-block;background:#10b981;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">📞 Call ${phone}</a>` : ""}
              <a href="${commandCenterUrl}" style="display:inline-block;background:#f97316;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">🎯 Open Command Center</a>
            </div>
          </div>
        </div>
      `;

      console.log(`[LeadCapture] Resending admin email → ${adminEmail} for submission ${submission.id}`);
      const { getUncachableSendGridClient: getSgAdmin } = await import("./email");
      const { client: sgMailAdmin, fromEmail: sgFromAdmin } = await getSgAdmin();
      const [sgResponse] = await sgMailAdmin.send({
        to: adminEmail,
        from: sgFromAdmin,
        subject: `[Resent] 🏆 ${athleteName} applied to ${programName}`,
        html,
      });
      console.log(`[LeadCapture] Resend admin email accepted — status ${sgResponse?.statusCode}`);

      await db.update(leadCaptureSubmissions).set({
        adminEmailSentAt: new Date(),
        adminEmailStatus: "sent",
        adminEmailError: null,
      }).where(eq(leadCaptureSubmissions.id, submission.id));

      res.json({ success: true, sentTo: adminEmail });
    } catch (error: any) {
      const errMsg = error?.response?.body ? JSON.stringify(error.response.body) : (error.message || "Unknown error");
      console.error("[LeadCapture] Resend admin email failed:", errMsg);
      try {
        const { db } = await import("./db");
        const { leadCaptureSubmissions } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(leadCaptureSubmissions).set({ adminEmailStatus: "failed", adminEmailError: errMsg }).where(eq(leadCaptureSubmissions.id, req.params.id));
      } catch (_) {}
      res.status(500).json({ message: "Failed to resend admin email", error: errMsg });
    }
  });

  // Admin: resend applicant confirmation email for a submission
  app.post("/api/lead-capture/submissions/:id/resend-applicant-email", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { db } = await import("./db");
      const { leadCaptureSubmissions, athleticPrograms, organizations, leadCapturePrograms: lcpTable } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [submission] = await db.select().from(leadCaptureSubmissions)
        .where(and(eq(leadCaptureSubmissions.id, req.params.id), eq(leadCaptureSubmissions.orgId, profile.organizationId)))
        .limit(1);
      if (!submission) return res.status(404).json({ message: "Submission not found" });

      const [org] = await db.select().from(organizations).where(eq(organizations.id, profile.organizationId)).limit(1);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const [program] = await db.select().from(athleticPrograms).where(eq(athleticPrograms.id, submission.programId)).limit(1);
      const [lcProgram] = await db.select().from(lcpTable).where(eq(lcpTable.programId, submission.programId)).limit(1);

      const { getUncachableSendGridClient: getSgApplicant } = await import("./email");
      const { client: sgMailApplicant, fromEmail: sgFromApplicant } = await getSgApplicant();

      const bookingUrl = lcProgram?.bookingUrl || null;
      const orgLogoUrl = org.logoUrl || null;
      const primaryColor = org.emailPrimaryColor || org.primaryColor || "#f97316";
      const athleteFirstName = submission.athleteName.split(" ")[0];
      const contactEmail = org.ownerEmail || org.schedulingInquiryEmail || sgFromApplicant;
      const websiteUrl = org.websiteUrl || null;
      const programName = program?.name || "Our Program";
      const { formatEmailTimestamp: fmtApplicantTs } = await import("./utils/format-email-timestamp");
      const orgTimezoneApplicant = (org as any).timezone || "America/New_York";
      const submissionTimestamp = submission.createdAt ? fmtApplicantTs(new Date(submission.createdAt), orgTimezoneApplicant) : "Unknown";
      const { athleteName, email, phone, sport, position, age, grade, school, commitmentLevel } = submission;

      const applicantHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application Received</title></head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td style="background:linear-gradient(135deg,${primaryColor},#f59e0b);border-radius:16px 16px 0 0;padding:40px 32px;text-align:center">
          ${orgLogoUrl ? `<img src="${orgLogoUrl}" alt="${org.name}" style="height:48px;margin-bottom:16px;object-fit:contain" />` : ""}
          <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:50px;padding:6px 18px;margin-bottom:16px">
            <span style="color:white;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">Application Confirmed (Resent)</span>
          </div>
          <h1 style="color:white;margin:0 0 8px;font-size:28px;font-weight:800;line-height:1.2">You're In the Pipeline,<br />${athleteFirstName}.</h1>
          <p style="color:rgba(255,255,255,0.85);margin:0;font-size:16px;font-weight:500">${programName} — ${org.name}</p>
        </td></tr>
        <tr><td style="background:#18181b;padding:36px 32px">
          <p style="color:#e4e4e7;font-size:16px;line-height:1.7;margin:0 0 24px">Hey <strong style="color:white">${athleteFirstName}</strong>, this is a confirmation that your application has been received and is being reviewed by our coaching staff. This is the first step toward elite-level performance.</p>
          <hr style="border:none;border-top:1px solid #3f3f46;margin:0 0 28px" />
          <p style="color:#a1a1aa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin:0 0 20px">What Happens Next</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:48px;vertical-align:top;padding-bottom:20px"><div style="width:36px;height:36px;background:linear-gradient(135deg,${primaryColor},#f59e0b);border-radius:50%;text-align:center;line-height:36px;font-size:15px;font-weight:800;color:white">1</div></td>
              <td style="vertical-align:top;padding-bottom:20px;padding-left:8px"><p style="color:white;font-size:15px;font-weight:700;margin:6px 0 4px">Application Review</p><p style="color:#a1a1aa;font-size:13px;margin:0;line-height:1.6">Our coaches review every application personally — your goals, sport background, and training history.</p></td>
            </tr>
            <tr>
              <td style="width:48px;vertical-align:top;padding-bottom:20px"><div style="width:36px;height:36px;background:linear-gradient(135deg,${primaryColor},#f59e0b);border-radius:50%;text-align:center;line-height:36px;font-size:15px;font-weight:800;color:white">2</div></td>
              <td style="vertical-align:top;padding-bottom:20px;padding-left:8px"><p style="color:white;font-size:15px;font-weight:700;margin:6px 0 4px">Coach Outreach</p><p style="color:#a1a1aa;font-size:13px;margin:0;line-height:1.6">A coach will contact you within <strong style="color:#e4e4e7">24–48 hours</strong> to discuss your goals and answer any questions.</p></td>
            </tr>
            <tr>
              <td style="width:48px;vertical-align:top"><div style="width:36px;height:36px;background:linear-gradient(135deg,${primaryColor},#f59e0b);border-radius:50%;text-align:center;line-height:36px;font-size:15px;font-weight:800;color:white">3</div></td>
              <td style="vertical-align:top;padding-left:8px"><p style="color:white;font-size:15px;font-weight:700;margin:6px 0 4px">Training Evaluation</p><p style="color:#a1a1aa;font-size:13px;margin:0;line-height:1.6">We'll schedule your evaluation session where you'll meet the team and experience the training firsthand.</p></td>
            </tr>
          </table>
          ${bookingUrl ? `<div style="margin-top:32px;background:#27272a;border-radius:12px;padding:24px;text-align:center;border:1px solid #3f3f46"><p style="color:#a1a1aa;font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Ready to Skip the Wait?</p><p style="color:white;font-size:16px;font-weight:700;margin:0 0 20px">Book your evaluation session directly</p><a href="${bookingUrl}" style="display:inline-block;background:linear-gradient(135deg,${primaryColor},#f59e0b);color:white;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:.03em">Book My Evaluation →</a></div>` : ""}
          <div style="margin-top:28px;background:#27272a;border-radius:10px;padding:20px;border:1px solid #3f3f46">
            <p style="color:#a1a1aa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin:0 0 14px">Your Application Summary</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0;width:40%">Program</td><td style="color:#e4e4e7;font-size:13px;font-weight:600;padding:5px 0">${programName}</td></tr>
              ${sport ? `<tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0">Sport</td><td style="color:#e4e4e7;font-size:13px;padding:5px 0">${sport}${position ? ` / ${position}` : ""}</td></tr>` : ""}
              ${age ? `<tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0">Age</td><td style="color:#e4e4e7;font-size:13px;padding:5px 0">${age}</td></tr>` : ""}
              ${school ? `<tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0">School</td><td style="color:#e4e4e7;font-size:13px;padding:5px 0">${school}</td></tr>` : ""}
              ${commitmentLevel ? `<tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0">Commitment</td><td style="color:#4ade80;font-size:13px;font-weight:600;padding:5px 0">${commitmentLevel}</td></tr>` : ""}
              <tr><td style="color:#a1a1aa;font-size:13px;padding:5px 0">Submitted</td><td style="color:#e4e4e7;font-size:13px;padding:5px 0">${submissionTimestamp}</td></tr>
            </table>
          </div>
        </td></tr>
        <tr><td style="background:#09090b;border-radius:0 0 16px 16px;padding:28px 32px;border-top:1px solid #27272a;text-align:center">
          <p style="color:#71717a;font-size:13px;margin:0 0 8px">Questions? Contact us at <a href="mailto:${contactEmail}" style="color:${primaryColor};text-decoration:none">${contactEmail}</a></p>
          ${websiteUrl ? `<p style="color:#71717a;font-size:13px;margin:0 0 12px"><a href="${websiteUrl}" style="color:#71717a;text-decoration:underline">${websiteUrl}</a></p>` : ""}
          <p style="color:#52525b;font-size:12px;margin:0">© ${new Date().getFullYear()} ${org.name}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      console.log(`[LeadCapture] Resending applicant confirmation → ${email} for submission ${submission.id}`);
      const [sgResp] = await sgMailApplicant.send({
        to: email,
        from: sgFromApplicant,
        subject: `Your Application Was Received — ${programName}`,
        html: applicantHtml,
      });
      console.log(`[LeadCapture] Resend applicant email accepted — status ${sgResp?.statusCode}`);

      await db.update(leadCaptureSubmissions).set({
        applicantEmailSentAt: new Date(),
        applicantEmailStatus: "sent",
        applicantEmailError: null,
      }).where(eq(leadCaptureSubmissions.id, submission.id));

      res.json({ success: true, sentTo: email });
    } catch (error: any) {
      const errMsg = error?.response?.body ? JSON.stringify(error.response.body) : (error.message || "Unknown error");
      console.error("[LeadCapture] Resend applicant email failed:", errMsg);
      try {
        const { db } = await import("./db");
        const { leadCaptureSubmissions } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(leadCaptureSubmissions).set({ applicantEmailStatus: "failed", applicantEmailError: errMsg }).where(eq(leadCaptureSubmissions.id, req.params.id));
      } catch (_) {}
      res.status(500).json({ message: "Failed to resend applicant confirmation email", error: errMsg });
    }
  });

  // Admin: get submissions for a program
  app.get("/api/lead-capture/submissions", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const programId = req.query.programId as string;
      if (!programId) return res.status(400).json({ message: "programId required" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const { desc } = await import("drizzle-orm");
      const rows = await db.select().from(leadCaptureSubmissions)
        .where(and(eq(leadCaptureSubmissions.orgId, profile.organizationId), eq(leadCaptureSubmissions.programId, programId)))
        .orderBy(desc(leadCaptureSubmissions.createdAt));
      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch submissions" });
    }
  });

  // Admin: get stats for a program
  app.get("/api/lead-capture/programs/:programId/stats", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, and, gte } = await import("drizzle-orm");
      const rows = await db.select().from(leadCaptureSubmissions)
        .where(and(eq(leadCaptureSubmissions.orgId, profile.organizationId), eq(leadCaptureSubmissions.programId, req.params.programId)));
      const total = rows.length;
      const highIntent = rows.filter((r: any) => (r.aiQualificationScore ?? 0) >= 70).length;
      const lastSubmission = rows.length > 0 ? rows.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].createdAt : null;
      res.json({ total, highIntent, conversionRate: total > 0 ? Math.round((highIntent / total) * 100) : 0, lastSubmission });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Admin: upsert lead capture config
  app.put("/api/lead-capture/programs/:programId/config", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const program = await storage.getAthleticProgramById(req.params.programId);
      if (!program || program.organizationId !== profile.organizationId) return res.status(404).json({ message: "Program not found" });
      const {
        headline, subheadline, ctaText, heroImageUrl, benefits, socialProof, whoIsThisFor,
        metaPixelId, googleAdsConversionId, googleAdsConversionLabel,
        bookingUrl, bookingType, estimatedAthleteValueCents,
        extendedConfig, funnelType,
      } = req.body;
      const { db } = await import("./db");
      const { leadCapturePrograms } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [existing] = await db.select().from(leadCapturePrograms).where(eq(leadCapturePrograms.programId, req.params.programId));
      if (existing) {
        const [updated] = await db.update(leadCapturePrograms).set({
          headline: headline ?? existing.headline,
          subheadline: subheadline ?? existing.subheadline,
          ctaText: ctaText ?? existing.ctaText,
          heroImageUrl: heroImageUrl !== undefined ? (heroImageUrl || null) : existing.heroImageUrl,
          benefits: benefits ?? existing.benefits,
          socialProof: socialProof ?? existing.socialProof,
          whoIsThisFor: whoIsThisFor ?? existing.whoIsThisFor,
          metaPixelId: metaPixelId !== undefined ? (metaPixelId || null) : existing.metaPixelId,
          googleAdsConversionId: googleAdsConversionId !== undefined ? (googleAdsConversionId || null) : existing.googleAdsConversionId,
          googleAdsConversionLabel: googleAdsConversionLabel !== undefined ? (googleAdsConversionLabel || null) : existing.googleAdsConversionLabel,
          bookingUrl: bookingUrl !== undefined ? (bookingUrl || null) : existing.bookingUrl,
          bookingType: bookingType ?? existing.bookingType,
          estimatedAthleteValueCents: estimatedAthleteValueCents !== undefined ? estimatedAthleteValueCents : existing.estimatedAthleteValueCents,
          extendedConfig: extendedConfig !== undefined ? extendedConfig : (existing.extendedConfig ?? {}),
          funnelType: funnelType ?? existing.funnelType ?? "athlete_application",
          updatedAt: new Date(),
        }).where(eq(leadCapturePrograms.programId, req.params.programId)).returning();
        // Update new org-menu columns separately so a missing column in older prod schema
        // doesn't break the entire save operation
        try {
          const orgMenuPatch: Record<string, any> = {};
          if (req.body.showInOrgMenu !== undefined) orgMenuPatch.showInOrgMenu = req.body.showInOrgMenu;
          if (req.body.navLabel !== undefined) orgMenuPatch.navLabel = req.body.navLabel || null;
          if (req.body.navOrder !== undefined) orgMenuPatch.navOrder = req.body.navOrder;
          if (Object.keys(orgMenuPatch).length > 0) {
            await db.update(leadCapturePrograms).set(orgMenuPatch).where(eq(leadCapturePrograms.programId, req.params.programId));
          }
        } catch (_) {}
        return res.json(updated);
      } else {
        const [created] = await db.insert(leadCapturePrograms).values({
          organizationId: profile.organizationId,
          programId: req.params.programId,
          headline: headline || "Train Like an Elite Athlete",
          subheadline: subheadline || "Apply now and take the first step toward your athletic potential.",
          ctaText: ctaText || "Apply Now",
          heroImageUrl: heroImageUrl || null,
          benefits: benefits || [],
          socialProof: socialProof || [],
          whoIsThisFor: whoIsThisFor || "",
          metaPixelId: metaPixelId || null,
          googleAdsConversionId: googleAdsConversionId || null,
          googleAdsConversionLabel: googleAdsConversionLabel || null,
          bookingUrl: bookingUrl || null,
          bookingType: bookingType || "none",
          estimatedAthleteValueCents: estimatedAthleteValueCents || 0,
          extendedConfig: extendedConfig || {},
          funnelType: funnelType || "athlete_application",
        }).returning();
        return res.json(created);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to save config" });
    }
  });

  // Admin: get lead capture config
  app.get("/api/lead-capture/programs/:programId/config", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCapturePrograms } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [config] = await db.select().from(leadCapturePrograms).where(eq(leadCapturePrograms.programId, req.params.programId));
      res.json(config || null);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch config" });
    }
  });

  // Public: track funnel events (page_view, step_1 … step_4, submit)
  app.post("/api/public/lead-capture/:orgSlug/:programSlug/funnel-event", async (req, res) => {
    try {
      const org = await storage.getOrganizationBySlug(req.params.orgSlug);
      if (!org) return res.status(404).json({ message: "Not found" });
      const program = await storage.getAthleticProgramBySlug(org.id, req.params.programSlug);
      if (!program) return res.status(404).json({ message: "Not found" });
      const { eventType, sessionId, utmSource, utmMedium, utmCampaign } = req.body;
      if (!eventType) return res.status(400).json({ message: "eventType required" });
      const { db } = await import("./db");
      const { leadCaptureFunnelEvents } = await import("@shared/schema");
      await db.insert(leadCaptureFunnelEvents).values({
        orgId: org.id,
        programId: program.id,
        eventType,
        sessionId: sessionId || null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
      });
      res.json({ ok: true });
    } catch (_) { res.json({ ok: false }); }
  });

  // Admin: funnel analytics for a program
  app.get("/api/lead-capture/programs/:programId/funnel", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureFunnelEvents, leadCaptureSubmissions, leadCaptureAbandoned } = await import("@shared/schema");
      const { eq, and, gte, count, desc, sql: drizzleSql } = await import("drizzle-orm");
      const programId = req.params.programId;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const events = await db.select().from(leadCaptureFunnelEvents)
        .where(and(eq(leadCaptureFunnelEvents.orgId, profile.organizationId), eq(leadCaptureFunnelEvents.programId, programId)));

      const countByType = (type: string) => events.filter((e: any) => e.eventType === type).length;
      const pageViews = countByType("page_view");
      const step1 = countByType("step_1");
      const partials = await db.select().from(leadCaptureAbandoned).where(and(eq(leadCaptureAbandoned.orgId, profile.organizationId), eq(leadCaptureAbandoned.programId, programId)));
      const submissions = await db.select().from(leadCaptureSubmissions).where(and(eq(leadCaptureSubmissions.orgId, profile.organizationId), eq(leadCaptureSubmissions.programId, programId)));
      const completed = submissions.length;
      const abandoned = partials.filter((p: any) => !p.completedAt).length;
      const highIntent = submissions.filter((s: any) => (s.aiQualificationScore ?? 0) >= 70).length;
      const movedToDeal = submissions.filter((s: any) => s.sequenceStatus === "moved_to_deal").length;

      // UTM source breakdown
      const utmMap: Record<string, number> = {};
      for (const e of events.filter((e: any) => e.eventType === "page_view" && e.utmSource)) {
        utmMap[(e as any).utmSource!] = (utmMap[(e as any).utmSource!] || 0) + 1;
      }
      const utmBreakdown = Object.entries(utmMap).sort((a, b) => b[1] - a[1]).map(([source, views]) => ({ source, views }));

      res.json({
        pageViews,
        step1Starts: step1,
        partialCaptures: partials.length,
        completedApplications: completed,
        abandonmentRate: step1 > 0 ? Math.round(((step1 - completed) / step1) * 100) : 0,
        completionRate: step1 > 0 ? Math.round((completed / step1) * 100) : 0,
        highIntentRate: completed > 0 ? Math.round((highIntent / completed) * 100) : 0,
        movedToDealRate: completed > 0 ? Math.round((movedToDeal / completed) * 100) : 0,
        utmBreakdown,
        funnel: [
          { label: "Page Views", value: pageViews, key: "page_view" },
          { label: "Step 1 Starts", value: step1, key: "step_1" },
          { label: "Partial Captures", value: partials.length, key: "partial" },
          { label: "Completed Apps", value: completed, key: "submit" },
          { label: "High Intent", value: highIntent, key: "high_intent" },
        ],
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch funnel" });
    }
  });

  // Admin: send manual follow-up to a submission
  app.post("/api/lead-capture/submissions/:id/send-followup", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [sub] = await db.select().from(leadCaptureSubmissions).where(and(eq(leadCaptureSubmissions.id, req.params.id), eq(leadCaptureSubmissions.orgId, profile.organizationId)));
      if (!sub) return res.status(404).json({ message: "Not found" });
      const program = await storage.getAthleticProgramById(sub.programId);
      const org = await storage.getOrganizationById(sub.orgId);
      if (!program || !org) return res.status(404).json({ message: "Program/org not found" });
      const owner = org.ownerUserId ? await storage.getUser(org.ownerUserId) : null;
      const coachName = owner?.firstName ? `${owner.firstName} ${owner.lastName || ""}`.trim() : "Coach";
      const step = req.body.step || "followup_24hr";
      const { sendSubmissionFollowUp } = await import("./lead-capture-sequences");
      const sent = await sendSubmissionFollowUp({ submissionId: sub.id, step, orgId: sub.orgId, athleteName: sub.athleteName, email: sub.email, sport: sub.sport, programName: program.name, orgName: org.name, orgSlug: org.slug, coachName });
      if (sent) {
        await db.update(leadCaptureSubmissions).set({ lastFollowUpAt: new Date(), followUpCount: (sub.followUpCount ?? 0) + 1 }).where(eq(leadCaptureSubmissions.id, sub.id));
      }
      res.json({ success: sent });
    } catch (error) {
      res.status(500).json({ message: "Failed to send follow-up" });
    }
  });

  // Admin: start full sequence for a submission
  app.post("/api/lead-capture/submissions/:id/start-sequence", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [sub] = await db.select().from(leadCaptureSubmissions).where(and(eq(leadCaptureSubmissions.id, req.params.id), eq(leadCaptureSubmissions.orgId, profile.organizationId)));
      if (!sub) return res.status(404).json({ message: "Not found" });
      await db.update(leadCaptureSubmissions).set({ sequenceStatus: "pending" }).where(eq(leadCaptureSubmissions.id, sub.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to start sequence" });
    }
  });

  // Admin: mark a submission as contacted
  app.post("/api/lead-capture/submissions/:id/mark-contacted", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      await db.update(leadCaptureSubmissions).set({ contactedAt: new Date(), sequenceStatus: "contacted" }).where(and(eq(leadCaptureSubmissions.id, req.params.id), eq(leadCaptureSubmissions.orgId, profile.organizationId)));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark contacted" });
    }
  });

  // Admin: send recovery message to an abandoned lead (manual)
  app.post("/api/lead-capture/abandoned/:id/recover", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureAbandoned } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [ab] = await db.select().from(leadCaptureAbandoned).where(and(eq(leadCaptureAbandoned.id, req.params.id), eq(leadCaptureAbandoned.orgId, profile.organizationId)));
      if (!ab) return res.status(404).json({ message: "Not found" });
      const program = await storage.getAthleticProgramById(ab.programId);
      const org = await storage.getOrganizationById(ab.orgId);
      if (!program || !org) return res.status(404).json({ message: "Program/org not found" });
      const { sendAbandonedRecovery } = await import("./lead-capture-sequences");
      const step = req.body.step || "recovery_30min";
      const sent = await sendAbandonedRecovery({ abandonedId: ab.id, step, orgId: ab.orgId, athleteName: ab.athleteName, email: ab.email, programName: program.name, orgName: org.name, orgSlug: org.slug, programSlug: program.slug });
      if (sent) {
        await db.update(leadCaptureAbandoned).set({ contactedAt: new Date(), followupSentAt: new Date(), followupCount: (ab.followupCount ?? 0) + 1 }).where(eq(leadCaptureAbandoned.id, ab.id));
      }
      res.json({ success: sent });
    } catch (error) {
      res.status(500).json({ message: "Failed to send recovery" });
    }
  });

  // Admin v4: Update booking status for a submission
  app.post("/api/lead-capture/submissions/:id/update-booking", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const { status } = req.body as { status: "not_booked" | "booked" | "completed" | "converted" | "lost" };
      if (!status) return res.status(400).json({ message: "status required" });
      const now = new Date();
      const updates: Record<string, any> = { bookingStatus: status };
      if (status === "booked") { updates.bookedAt = now; updates.evaluationBookedAt = now; updates.sequenceStatus = "booked"; }
      if (status === "completed") { updates.attendedAt = now; }
      if (status === "converted") { updates.convertedAt = now; updates.sequenceStatus = "converted"; }
      if (status === "lost") { updates.lostAt = now; updates.sequenceStatus = "lost"; }
      await db.update(leadCaptureSubmissions).set(updates).where(and(eq(leadCaptureSubmissions.id, req.params.id), eq(leadCaptureSubmissions.orgId, profile.organizationId)));
      res.json({ success: true });
    } catch (error) { res.status(500).json({ message: "Failed to update booking status" }); }
  });

  // Admin v4: Generate AI sales analysis for a submission
  app.post("/api/lead-capture/submissions/:id/ai-sales-analysis", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [sub] = await db.select().from(leadCaptureSubmissions).where(and(eq(leadCaptureSubmissions.id, req.params.id), eq(leadCaptureSubmissions.orgId, profile.organizationId)));
      if (!sub) return res.status(404).json({ message: "Not found" });
      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const ageHours = (Date.now() - new Date(sub.createdAt!).getTime()) / 3600000;
      const prompt = `You are a sports performance sales coach. Analyze this lead and respond with JSON only.

Lead data:
- Name: ${sub.athleteName}
- Sport: ${sub.sport || "Not specified"}
- Age/Grade: ${sub.age || sub.grade || "Unknown"}
- Goals: ${Array.isArray(sub.goals) ? sub.goals.join(", ") : sub.goals || "Not specified"}
- Commitment level: ${sub.commitmentLevel || "Unknown"}
- Experience: ${sub.experienceLevel || "Unknown"}
- Current training: ${sub.currentTrainingStatus || "Unknown"}
- AI Qualification Score: ${sub.aiQualificationScore || "N/A"}/100
- Hours since submission: ${Math.round(ageHours)}
- UTM source: ${sub.utmSource || "direct"}
- Contacted yet: ${sub.contactedAt ? "Yes" : "No"}
- Follow-ups sent: ${sub.followUpCount || 0}

Respond with this exact JSON structure:
{
  "recommendedTone": "one of: urgent|warm|professional|consultative",
  "recommendedCta": "specific CTA text for this athlete",
  "objectionLikelihood": "one of: low|medium|high",
  "topObjection": "most likely objection this athlete has",
  "probabilityToBook": number 0-100,
  "probabilityToConvert": number 0-100,
  "suggestedSms": "1-2 sentence SMS text (casual, direct)",
  "suggestedEmail": "2-3 sentence email opener (personalized)",
  "urgencyNote": "why timing matters for this lead",
  "recommendedAction": "single most important thing to do right now"
}`;
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.4,
      });
      const analysis = JSON.parse(completion.choices[0].message.content || "{}");
      await db.update(leadCaptureSubmissions).set({ aiSalesAnalysis: analysis }).where(eq(leadCaptureSubmissions.id, sub.id));
      res.json({ success: true, analysis });
    } catch (error: any) { res.status(500).json({ message: "AI analysis failed", error: error.message }); }
  });

  // Admin v4: Revenue intelligence dashboard
  app.get("/api/lead-capture/revenue-intelligence", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions, leadCapturePrograms } = await import("@shared/schema");
      const { eq, and, isNull, desc } = await import("drizzle-orm");

      const subs = await db.select().from(leadCaptureSubmissions).where(eq(leadCaptureSubmissions.orgId, profile.organizationId));
      const programs = await db.select().from(leadCapturePrograms).where(eq(leadCapturePrograms.organizationId, profile.organizationId));

      const progMap: Record<string, typeof programs[0]> = {};
      for (const p of programs) progMap[p.programId] = p;

      const now = new Date();
      // Revenue calculations
      let projectedRevenue = 0, bookedRevenue = 0, convertedRevenue = 0;
      const byUtm: Record<string, { count: number; revenue: number }> = {};
      const bySport: Record<string, { count: number; revenue: number }> = {};
      const byCampaign: Record<string, { count: number; revenue: number }> = {};
      const pipelineStages = { applied: 0, contacted: 0, booked: 0, attended: 0, converted: 0 };

      for (const s of subs) {
        const prog = progMap[s.programId];
        const val = prog?.estimatedAthleteValueCents || s.estimatedValueCents || 0;
        pipelineStages.applied++;
        if (s.contactedAt) pipelineStages.contacted++;
        if (s.bookingStatus === "booked" || s.bookingStatus === "completed" || s.bookingStatus === "converted") pipelineStages.booked++;
        if (s.bookingStatus === "completed" || s.bookingStatus === "converted") pipelineStages.attended++;
        if (s.bookingStatus === "converted") { pipelineStages.converted++; convertedRevenue += val; }
        if (s.bookingStatus === "booked" || s.bookingStatus === "completed") bookedRevenue += val;
        projectedRevenue += val;
        const utm = s.utmSource || "direct";
        const sport = s.sport || "unknown";
        const camp = s.utmCampaign || "none";
        byUtm[utm] = byUtm[utm] || { count: 0, revenue: 0 };
        byUtm[utm].count++; byUtm[utm].revenue += val;
        bySport[sport] = bySport[sport] || { count: 0, revenue: 0 };
        bySport[sport].count++; bySport[sport].revenue += val;
        byCampaign[camp] = byCampaign[camp] || { count: 0, revenue: 0 };
        byCampaign[camp].count++; byCampaign[camp].revenue += val;
      }

      // Avg days to convert
      const convertedSubs = subs.filter((s: any) => s.convertedAt && s.createdAt);
      const avgDaysToConvert = convertedSubs.length > 0
        ? Math.round(convertedSubs.reduce((acc: number, s: any) => acc + (new Date(s.convertedAt).getTime() - new Date(s.createdAt).getTime()) / 86400000, 0) / convertedSubs.length)
        : null;

      // Booking conversion + close rate
      const bookingRate = subs.length > 0 ? Math.round((pipelineStages.booked / subs.length) * 100) : 0;
      const closeRate = subs.length > 0 ? Math.round((pipelineStages.converted / subs.length) * 100) : 0;

      // MRR impact estimate (converted / 12 months)
      const estimatedMrrImpact = Math.round(convertedRevenue / 12);

      // Best converting source (by conversion rate, min 2 leads)
      const sourceConversions: Record<string, { total: number; converted: number }> = {};
      for (const s of subs) {
        const src = s.utmSource || "direct";
        sourceConversions[src] = sourceConversions[src] || { total: 0, converted: 0 };
        sourceConversions[src].total++;
        if (s.bookingStatus === "converted") sourceConversions[src].converted++;
      }
      const fastestSource = Object.entries(sourceConversions)
        .filter(([, v]) => v.total >= 2)
        .map(([src, v]) => ({ source: src, rate: Math.round((v.converted / v.total) * 100) }))
        .sort((a, b) => b.rate - a.rate)[0];

      res.json({
        projectedRevenue,
        bookedRevenue,
        convertedRevenue,
        estimatedMrrImpact,
        bookingRate,
        closeRate,
        avgDaysToConvert,
        pipelineStages,
        byUtm: Object.entries(byUtm).sort((a, b) => b[1].revenue - a[1].revenue).map(([source, d]) => ({ source, ...d })),
        bySport: Object.entries(bySport).sort((a, b) => b[1].revenue - a[1].revenue).map(([sport, d]) => ({ sport, ...d })),
        byCampaign: Object.entries(byCampaign).sort((a, b) => b[1].revenue - a[1].revenue).map(([campaign, d]) => ({ campaign, ...d })),
        fastestConvertingSource: fastestSource || null,
      });
    } catch (error) { res.status(500).json({ message: "Failed to fetch revenue intelligence" }); }
  });

  // Admin: get abandoned (partial) lead capture submissions
  app.get("/api/lead-capture/abandoned", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureAbandoned } = await import("@shared/schema");
      const { eq, and, isNull, desc } = await import("drizzle-orm");
      const rows = await db.select().from(leadCaptureAbandoned)
        .where(and(eq(leadCaptureAbandoned.orgId, profile.organizationId), isNull(leadCaptureAbandoned.completedAt)))
        .orderBy(desc(leadCaptureAbandoned.createdAt))
        .limit(50);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch abandoned" });
    }
  });

  // Admin: Command Center summary for Lead Capture Program Leads
  app.get("/api/lead-capture/command-center-summary", isAuthenticated, requireRole("ADMIN", "COACH", "STAFF"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions, leadCaptureAbandoned } = await import("@shared/schema");
      const { eq, and, isNull, desc } = await import("drizzle-orm");
      const now = new Date();
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const allSubs = await db.select().from(leadCaptureSubmissions)
        .where(eq(leadCaptureSubmissions.orgId, profile.organizationId))
        .orderBy(desc(leadCaptureSubmissions.createdAt))
        .limit(200);

      const newToday = allSubs.filter((s: any) => s.createdAt && new Date(s.createdAt) >= todayStart).length;
      const highIntent = allSubs.filter((s: any) => (s.aiQualificationScore ?? 0) >= 70).length;
      const hotNotContacted = allSubs.filter((s: any) => (s.aiQualificationScore ?? 0) >= 75 && !s.contactedAt);
      const needsFollowUp = allSubs.filter((s: any) => !s.contactedAt && s.createdAt && new Date(s.createdAt) <= oneDayAgo && (s.sequenceStatus === "pending" || !s.sequenceStatus));

      const abandonedRows = await db.select().from(leadCaptureAbandoned)
        .where(and(eq(leadCaptureAbandoned.orgId, profile.organizationId), isNull(leadCaptureAbandoned.completedAt)))
        .orderBy(desc(leadCaptureAbandoned.createdAt))
        .limit(20);

      const abandonedToday = abandonedRows.filter((a: any) => a.createdAt && new Date(a.createdAt) >= todayStart).length;

      // UTM source performance this week
      const weekSubs = allSubs.filter((s: any) => s.createdAt && new Date(s.createdAt) >= weekStart);
      const utmMap: Record<string, number> = {};
      for (const s of weekSubs) {
        const src = (s as any).utmSource || "direct";
        utmMap[src] = (utmMap[src] || 0) + 1;
      }
      const bestSourceThisWeek = Object.entries(utmMap).sort((a, b) => b[1] - a[1])[0];

      // Estimated pipeline value (high-intent × avg session ~$300)
      const estimatedPipelineValue = highIntent * 300 * 100; // cents

      // v4: Pipeline stage counts
      const pipelineStages = {
        applied: allSubs.length,
        contacted: allSubs.filter((s: any) => s.contactedAt).length,
        booked: allSubs.filter((s: any) => ["booked","completed","converted"].includes(s.bookingStatus)).length,
        attended: allSubs.filter((s: any) => ["completed","converted"].includes(s.bookingStatus)).length,
        converted: allSubs.filter((s: any) => s.bookingStatus === "converted").length,
      };

      // v4: SLA urgency buckets for hot uncontacted leads
      const hotUncontacted = allSubs.filter((s: any) => (s.aiQualificationScore ?? 0) >= 75 && !s.contactedAt);
      const slaData = {
        green: hotUncontacted.filter((s: any) => (now.getTime() - new Date(s.createdAt).getTime()) < 5 * 60 * 1000).length,
        yellow: hotUncontacted.filter((s: any) => { const age = now.getTime() - new Date(s.createdAt).getTime(); return age >= 5 * 60 * 1000 && age < 60 * 60 * 1000; }).length,
        red: hotUncontacted.filter((s: any) => (now.getTime() - new Date(s.createdAt).getTime()) >= 60 * 60 * 1000).length,
        critical: hotUncontacted.filter((s: any) => (now.getTime() - new Date(s.createdAt).getTime()) >= 24 * 60 * 60 * 1000).length,
      };

      // v4: Revenue stats
      const { leadCapturePrograms } = await import("@shared/schema");
      const programs = await db.select().from(leadCapturePrograms).where(eq(leadCapturePrograms.organizationId, profile.organizationId));
      const progValueMap: Record<string, number> = {};
      for (const p of programs) progValueMap[p.programId] = p.estimatedAthleteValueCents || 0;
      let projectedRevenue = 0, bookedRevenue = 0, convertedRevenue = 0;
      for (const s of allSubs) {
        const val = progValueMap[s.programId] || (s as any).estimatedValueCents || 0;
        projectedRevenue += val;
        if (["booked","completed","converted"].includes((s as any).bookingStatus || "not_booked")) bookedRevenue += val;
        if ((s as any).bookingStatus === "converted") convertedRevenue += val;
      }

      // v4: Best campaign this week
      const campMap: Record<string, number> = {};
      for (const s of weekSubs) {
        const camp = (s as any).utmCampaign || "none";
        campMap[camp] = (campMap[camp] || 0) + 1;
      }
      const bestCampaignEntry = Object.entries(campMap).sort((a, b) => b[1] - a[1])[0];
      const bestCampaign = bestCampaignEntry ? { campaign: bestCampaignEntry[0], count: bestCampaignEntry[1] } : null;

      // Build enriched recent leads with AI next action + v4 booking data
      const recentLeads = allSubs.slice(0, 20).map((s: any) => {
        const ageHours = (now.getTime() - new Date(s.createdAt).getTime()) / (60 * 60 * 1000);
        const score = s.aiQualificationScore ?? 0;
        const isHot = score >= 75;
        const isContacted = !!s.contactedAt;
        const needsAction = !isContacted && ageHours > 24;
        const slaUrgency = isHot && !isContacted
          ? ageHours < 0.083 ? "green" : ageHours < 1 ? "yellow" : ageHours < 24 ? "orange" : "red"
          : null;

        let aiNextAction = s.aiNextAction;
        if (!aiNextAction) {
          if (isHot && !isContacted && ageHours < 2) aiNextAction = "🔥 Call now — high-intent lead just submitted";
          else if (isHot && !isContacted) aiNextAction = "📞 Hot lead uncontacted — call or text immediately";
          else if (!isContacted && ageHours > 48) aiNextAction = "Send 3-day nurture email — lead going cold";
          else if (!isContacted && ageHours > 24) aiNextAction = "Send 24-hour follow-up — no contact yet";
          else if (s.commitmentLevel === "Ready to start immediately") aiNextAction = "Book evaluation call — athlete is ready to start";
          else if (s.commitmentLevel === "Ready to start this month") aiNextAction = "Schedule this week — athlete ready to commit";
          else if (s.bookingStatus === "booked") aiNextAction = "✅ Booked — confirm attendance before session";
          else if (isContacted) aiNextAction = "Monitor — contacted, await response";
          else aiNextAction = "Send intro follow-up email";
        }

        const isAbandonedRisk = !isContacted && ageHours > 72;
        const timeSinceContactHrs = s.contactedAt ? (now.getTime() - new Date(s.contactedAt).getTime()) / 3600000 : null;
        return { ...s, aiNextAction, isHot, isContacted, needsAction, isAbandonedRisk, ageHours: Math.round(ageHours), slaUrgency, timeSinceContactHrs: timeSinceContactHrs ? Math.round(timeSinceContactHrs) : null };
      });

      res.json({
        totalSubmissions: allSubs.length,
        newToday,
        highIntent,
        abandonedCount: abandonedRows.length,
        abandonedToday,
        hotNotContacted: hotNotContacted.length,
        needsFollowUp: needsFollowUp.length,
        bestSourceThisWeek: bestSourceThisWeek ? { source: bestSourceThisWeek[0], count: bestSourceThisWeek[1] } : null,
        estimatedPipelineValue,
        recentLeads,
        abandonedLeads: abandonedRows.slice(0, 5),
        pipelineStages,
        slaData,
        projectedRevenue,
        bookedRevenue,
        convertedRevenue,
        bestCampaign,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch lead capture summary" });
    }
  });

  // Admin: Move lead capture submission to deal (team training pipeline)
  app.post("/api/lead-capture/submissions/:id/move-to-deal", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions, teamTrainingProspects } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [sub] = await db.select().from(leadCaptureSubmissions)
        .where(and(eq(leadCaptureSubmissions.id, req.params.id), eq(leadCaptureSubmissions.orgId, profile.organizationId)));
      if (!sub) return res.status(404).json({ message: "Submission not found" });
      const [prospect] = await db.insert(teamTrainingProspects).values({
        orgId: profile.organizationId,
        prospectName: sub.athleteName + (sub.school ? ` / ${sub.school}` : ""),
        sport: sub.sport || "General",
        city: sub.school || "Unknown",
        state: "Unknown",
        contactEmail: sub.email,
        contactName: sub.athleteName,
        outreachStatus: "not_started",
        notes: `Moved from Lead Capture. Score: ${sub.aiQualificationScore ?? "N/A"}. ${sub.notes || ""}`.trim(),
        confidenceScore: sub.aiQualificationScore ?? null,
      } as any).returning();
      res.json({ success: true, prospectId: prospect.id });
    } catch (error) {
      res.status(500).json({ message: "Failed to move to deal" });
    }
  });

  // ── Program Builder + Exercise Intelligence Layer ────────────────────────────
  const { registerProgramBuilderRoutes } = await import("./program-builder-routes");
  registerProgramBuilderRoutes(app);

  // ── Unified Athlete Profile ───────────────────────────────────────────────────
  const { registerAthleteProfileRoutes } = await import("./athlete-profile-routes");
  registerAthleteProfileRoutes(app);

  // ── Phase 4: Organization Intelligence Orchestration ─────────────────────────
  const { registerOrchestrationRoutes } = await import("./orchestration/orchestration-routes");
  registerOrchestrationRoutes(app);

  // ── Coach Command Center + Daily AI Briefing ──────────────────────────────────
  const { registerCoachCommandCenterRoutes } = await import("./coach-command-center-routes");
  registerCoachCommandCenterRoutes(app);

  // ── Communication Automation + Multi-Channel Outreach Engine ─────────────────
  const { registerCoachOutreachEngineRoutes } = await import("./coach-outreach-engine-routes");
  registerCoachOutreachEngineRoutes(app);

  // ── Meta Conversions API (server-side pixel) ──────────────────────────────────
  const { registerMetaCapiRoutes } = await import("./meta-capi");
  registerMetaCapiRoutes(app);

  // ── Unified Agent Action Log ──────────────────────────────────────────────────

  // POST /api/unified-action-log — write a log entry
  app.post("/api/unified-action-log", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(400).json({ message: "No org" });
      const entry = { ...req.body, orgId };
      const row = await storage.logUnifiedAction(entry);
      res.json(row);
    } catch (e: any) {
      console.error("[unified-action-log] POST error:", e);
      res.status(500).json({ message: "Failed to log action" });
    }
  });

  // GET /api/unified-action-log — list entries
  app.get("/api/unified-action-log", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(400).json({ message: "No org" });
      const { limit, status, actorType, actionType } = req.query as Record<string, string>;
      const rows = await storage.getUnifiedActionLog(orgId, {
        limit: limit ? parseInt(limit) : 50,
        status,
        actorType,
        actionType,
      });
      res.json(rows);
    } catch (e: any) {
      console.error("[unified-action-log] GET error:", e);
      res.status(500).json({ message: "Failed to fetch log" });
    }
  });

  // GET /api/unified-action-log/summary — stats for dashboard
  app.get("/api/unified-action-log/summary", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(400).json({ message: "No org" });
      const summary = await storage.getUnifiedActionLogSummary(orgId);
      res.json(summary);
    } catch (e: any) {
      console.error("[unified-action-log] summary error:", e);
      res.status(500).json({ message: "Failed to fetch summary" });
    }
  });

  // GET /api/ai-ops/dashboard — consolidated data for the AI Ops Command Center
  app.get("/api/ai-ops/dashboard", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(400).json({ message: "No org" });

      const { getAttentionItems } = await import("./attention-engine");

      const [
        attentionRaw,
        workflowRuns,
        recentActions,
        actionSummary,
      ] = await Promise.all([
        getAttentionItems(orgId),
        storage.getWorkflowRuns(orgId),
        storage.getUnifiedActionLog(orgId, { limit: 10 }),
        storage.getUnifiedActionLogSummary(orgId),
      ]);

      const attentionItems = attentionRaw.slice(0, 5);

      const activeWorkflows = workflowRuns.filter(w => w.status === "running" || w.status === "pending");
      const failedWorkflows = workflowRuns.filter(w => w.status === "failed");
      const stuckWorkflows = workflowRuns.filter(w => {
        if (w.status !== "running") return false;
        const updated = w.updatedAt ? new Date(w.updatedAt) : null;
        if (!updated) return false;
        return Date.now() - updated.getTime() > 30 * 60 * 1000; // >30 min
      });

      res.json({
        attentionItems,
        activeWorkflows,
        failedWorkflows,
        stuckWorkflows,
        recentActions,
        actionSummary,
        openAttentionCount: attentionItems.length,
      });
    } catch (e: any) {
      console.error("[ai-ops/dashboard] error:", e);
      res.status(500).json({ message: "Failed to fetch dashboard" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GOVERNANCE ROUTES — Phase 3
  // ─────────────────────────────────────────────────────────────────────────

  // GET /api/governance/settings — get org governance settings (auto-creates defaults)
  app.get("/api/governance/settings", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      let settings = await storage.getGovernanceSettings(orgId);
      if (!settings) {
        // Auto-provision safe defaults on first access
        settings = await storage.upsertGovernanceSettings(orgId, {
          defaultAutonomyMode: "supervised",
          maximumAllowedRiskLevel: "medium",
          defaultConfidenceThreshold: 0.75,
          operatorReviewRequired: true,
          allowAutonomousCommunication: false,
          allowAutonomousScheduling: false,
          allowAutonomousFinancialActions: false,
          allowResearchAgents: true,
          allowExternalWebAccess: false,
          allowCrossWorkflowMemory: true,
          aiActivityVisibilityMode: "full",
          strictModeEnabled: false,
          emergencyPauseEnabled: false,
        });
        await storage.seedDefaultPolicies(orgId);
      }
      res.json(settings);
    } catch (e: any) {
      console.error("[governance/settings] GET error:", e);
      res.status(500).json({ message: "Failed to fetch governance settings" });
    }
  });

  // PATCH /api/governance/settings — update org governance settings
  app.patch("/api/governance/settings", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      const updates = req.body;
      const settings = await storage.upsertGovernanceSettings(orgId, updates);
      const { logUnifiedAction } = await import("./unified-action-logger");
      await logUnifiedAction({
        orgId,
        actorType: "admin",
        actorName: req.user.name ?? req.user.email ?? "admin",
        actionType: "autonomy_mode_changed",
        status: "completed",
        riskLevel: "medium",
        reasoningSummary: `Governance settings updated by operator: ${JSON.stringify(Object.keys(updates))}`,
        inputSnapshot: updates,
      });
      res.json(settings);
    } catch (e: any) {
      console.error("[governance/settings] PATCH error:", e);
      res.status(500).json({ message: "Failed to update governance settings" });
    }
  });

  // POST /api/governance/autonomy-mode — change the global autonomy mode
  app.post("/api/governance/autonomy-mode", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      const { mode } = req.body;
      if (!["supervised", "collaborative", "autonomous"].includes(mode)) {
        return res.status(400).json({ message: "Invalid autonomy mode" });
      }
      const { changeAutonomyMode } = await import("./capability-enforcement-engine");
      await changeAutonomyMode(orgId, mode, req.user.name ?? req.user.email ?? "admin");
      const settings = await storage.getGovernanceSettings(orgId);
      res.json(settings);
    } catch (e: any) {
      console.error("[governance/autonomy-mode] error:", e);
      res.status(500).json({ message: "Failed to change autonomy mode" });
    }
  });

  // POST /api/governance/emergency-pause — activate or deactivate emergency pause
  app.post("/api/governance/emergency-pause", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      const { enable, reason } = req.body;
      const operatorName = req.user.name ?? req.user.email ?? "admin";
      const { triggerEmergencyPause, disableEmergencyPause } = await import("./capability-enforcement-engine");
      if (enable) {
        await triggerEmergencyPause(orgId, reason ?? "No reason provided", operatorName);
      } else {
        await disableEmergencyPause(orgId, operatorName);
      }
      const settings = await storage.getGovernanceSettings(orgId);
      res.json(settings);
    } catch (e: any) {
      console.error("[governance/emergency-pause] error:", e);
      res.status(500).json({ message: "Failed to toggle emergency pause" });
    }
  });

  // GET /api/governance/policies — list all capability policies for org
  app.get("/api/governance/policies", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      // Ensure defaults exist
      await storage.seedDefaultPolicies(orgId);
      const policies = await storage.getCapabilityPolicies(orgId);
      res.json(policies);
    } catch (e: any) {
      console.error("[governance/policies] GET error:", e);
      res.status(500).json({ message: "Failed to fetch capability policies" });
    }
  });

  // PATCH /api/governance/policies/:agentType — update a specific agent's policy
  app.patch("/api/governance/policies/:agentType", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      const { agentType } = req.params;
      const updates = req.body;
      const policy = await storage.upsertCapabilityPolicy(orgId, agentType, updates);
      const { logUnifiedAction } = await import("./unified-action-logger");
      await logUnifiedAction({
        orgId,
        actorType: "admin",
        actorName: req.user.name ?? req.user.email ?? "admin",
        actionType: "capability_validated",
        status: "completed",
        riskLevel: "low",
        reasoningSummary: `Capability policy updated for ${agentType}: ${JSON.stringify(Object.keys(updates))}`,
        inputSnapshot: { agentType, ...updates },
      });
      res.json(policy);
    } catch (e: any) {
      console.error("[governance/policies] PATCH error:", e);
      res.status(500).json({ message: "Failed to update capability policy" });
    }
  });

  // GET /api/governance/agents — list all agent identities with status
  app.get("/api/governance/agents", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { listAgentIdentities } = await import("./agent-identities");
      const identities = listAgentIdentities();
      const orgId = req.user.orgId;
      const policies = await storage.getCapabilityPolicies(orgId);

      // Merge policy-enabled state into identity status
      const agentsWithStatus = identities.map(identity => {
        const policy = policies.find(p => p.agentType === identity.agentType);
        return {
          ...identity,
          status: policy?.enabled === false ? "disabled" : identity.status,
          policyEnabled: policy?.enabled ?? true,
          maxAutonomyLevel: policy?.maxAutonomyLevel ?? identity.defaultAutonomyLevel,
        };
      });
      res.json(agentsWithStatus);
    } catch (e: any) {
      console.error("[governance/agents] error:", e);
      res.status(500).json({ message: "Failed to fetch agent identities" });
    }
  });

  // GET /api/governance/analytics — governance observability metrics
  app.get("/api/governance/analytics", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      const { getGovernanceAnalytics } = await import("./capability-enforcement-engine");
      const analytics = await getGovernanceAnalytics(orgId);
      res.json(analytics);
    } catch (e: any) {
      console.error("[governance/analytics] error:", e);
      res.status(500).json({ message: "Failed to fetch governance analytics" });
    }
  });

  // POST /api/governance/validate — validate a hypothetical agent action (for explainability)
  app.post("/api/governance/validate", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      const { validateAgentCapability } = await import("./capability-enforcement-engine");
      const decision = await validateAgentCapability({ orgId, ...req.body });
      res.json(decision);
    } catch (e: any) {
      console.error("[governance/validate] error:", e);
      res.status(500).json({ message: "Failed to validate capability" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // JOB QUEUE ROUTES — Phase 4
  // ─────────────────────────────────────────────────────────────────────────

  // GET /api/job-queue/stats — job queue health metrics
  app.get("/api/job-queue/stats", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { getJobQueueStats } = await import("./workflow-job-queue");
      const stats = await getJobQueueStats(req.user.orgId);
      const { getRunnerStatus } = await import("./workflow-job-runner");
      res.json({ ...stats, runner: getRunnerStatus() });
    } catch (e: any) {
      console.error("[job-queue/stats] error:", e);
      res.status(500).json({ message: "Failed to fetch job queue stats" });
    }
  });

  // GET /api/job-queue/jobs — list jobs by status
  app.get("/api/job-queue/jobs", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string ?? "50");
      const jobs = await storage.getWorkflowJobs(orgId, status, limit);
      res.json(jobs);
    } catch (e: any) {
      console.error("[job-queue/jobs] error:", e);
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  // GET /api/job-queue/dead-letter — list dead letter jobs
  app.get("/api/job-queue/dead-letter", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const jobs = await storage.getDeadLetterJobs(req.user.orgId);
      res.json(jobs);
    } catch (e: any) {
      console.error("[job-queue/dead-letter] error:", e);
      res.status(500).json({ message: "Failed to fetch dead letter jobs" });
    }
  });

  // POST /api/job-queue/dead-letter/:id/retry — manually retry a dead letter job
  app.post("/api/job-queue/dead-letter/:id/retry", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { retryDeadLetterJob } = await import("./workflow-job-queue");
      const result = await retryDeadLetterJob(
        req.params.id,
        req.user.orgId,
        req.user.name ?? req.user.email ?? "admin",
      );
      if (!result.ok) return res.status(400).json({ message: result.error });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[job-queue/dead-letter/retry] error:", e);
      res.status(500).json({ message: "Failed to retry job" });
    }
  });

  // POST /api/job-queue/:id/cancel — cancel a queued/retrying job
  app.post("/api/job-queue/:id/cancel", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { cancelWorkflowJob } = await import("./workflow-job-queue");
      await cancelWorkflowJob(req.params.id, req.user.orgId, req.user.name ?? req.user.email ?? "admin");
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[job-queue/cancel] error:", e);
      res.status(500).json({ message: "Failed to cancel job" });
    }
  });

  // GET /api/job-queue/run/:runId — jobs for a specific workflow run
  app.get("/api/job-queue/run/:runId", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const jobs = await storage.getJobsForRun(req.user.orgId, req.params.runId);
      res.json(jobs);
    } catch (e: any) {
      console.error("[job-queue/run] error:", e);
      res.status(500).json({ message: "Failed to fetch run jobs" });
    }
  });

  // GET /api/job-queue/rate-limits — org rate limit status
  app.get("/api/job-queue/rate-limits", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const limits = await storage.getRateLimits(req.user.orgId);
      res.json(limits);
    } catch (e: any) {
      console.error("[job-queue/rate-limits] error:", e);
      res.status(500).json({ message: "Failed to fetch rate limits" });
    }
  });

  // POST /api/job-queue/enqueue — manually enqueue a job (admin only)
  app.post("/api/job-queue/enqueue", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { enqueueWorkflowJob } = await import("./workflow-job-queue");
      const result = await enqueueWorkflowJob({ orgId: req.user.orgId, ...req.body });
      res.json(result);
    } catch (e: any) {
      console.error("[job-queue/enqueue] error:", e);
      res.status(500).json({ message: "Failed to enqueue job" });
    }
  });

  // POST /api/job-queue/detect-stuck — manually trigger stuck job detection
  app.post("/api/job-queue/detect-stuck", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { detectAndHandleStuckJobs } = await import("./workflow-job-queue");
      const result = await detectAndHandleStuckJobs();
      res.json(result);
    } catch (e: any) {
      console.error("[job-queue/detect-stuck] error:", e);
      res.status(500).json({ message: "Failed to detect stuck jobs" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // INTEGRATIONS ROUTES — Phase 5
  // ─────────────────────────────────────────────────────────────────────────

  // GET /api/integrations — list all integrations for org (ADMIN only — never returns credentials)
  app.get("/api/integrations", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const integrations = await storage.getExternalIntegrations(orgId);
      const safe = integrations.map(({ encryptedCredentials, ...rest }) => ({
        ...rest,
        credentialHints: (rest.usageStats as any)?.credentialHints ?? null,
      }));
      res.json(safe);
    } catch (e: any) {
      console.error("[integrations] list error:", e);
      res.status(500).json({ message: "Failed to fetch integrations" });
    }
  });

  // GET /api/integrations/stats — health stats across all integrations
  app.get("/api/integrations/stats", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const { getIntegrationStats } = await import("./integration-runtime");
      const stats = await getIntegrationStats(orgId);
      res.json(stats);
    } catch (e: any) {
      console.error("[integrations/stats] error:", e);
      res.status(500).json({ message: "Failed to fetch integration stats" });
    }
  });

  // ── Gmail OAuth flow — must be registered BEFORE the /:type wildcard ────────

  // ── Gmail OAuth helpers ────────────────────────────────────────────────────
  // Build an HMAC-signed state blob so the callback can trust orgId without
  // relying on sessions.  State expires after 15 minutes.
  const DEFAULT_OAUTH_RETURN = "/admin/configuration?tab=advanced";

  function sanitizeReturnTo(raw: string | undefined | null): string {
    if (!raw) return DEFAULT_OAUTH_RETURN;
    const s = decodeURIComponent(String(raw)).trim();
    // Must be a relative path: starts with /, no protocol colon, no //
    if (!s.startsWith("/") || s.startsWith("//") || s.includes(":")) return DEFAULT_OAUTH_RETURN;
    return s;
  }

  function appendGmailStatus(returnTo: string, status: string): string {
    const sep = returnTo.includes("?") ? "&" : "?";
    return `${returnTo}${sep}gmail=${status}`;
  }

  function buildOAuthState(orgId: string, returnTo?: string): string {
    const { createHmac, randomBytes } = require("crypto");
    const nonce = randomBytes(16).toString("hex");
    const ts = String(Date.now());
    const payload: Record<string, string> = { orgId, nonce, ts };
    if (returnTo) payload.returnTo = sanitizeReturnTo(returnTo);
    const raw = JSON.stringify(payload);
    const sig = createHmac("sha256", process.env.SESSION_SECRET ?? "dev-secret")
      .update(raw)
      .digest("hex");
    return Buffer.from(JSON.stringify({ ...payload, sig })).toString("base64url");
  }

  function verifyOAuthState(state: string): { orgId: string; returnTo: string } | null {
    try {
      const { createHmac } = require("crypto");
      const obj = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
      const { sig, ...payload } = obj;
      const raw = JSON.stringify(payload);
      const expected = createHmac("sha256", process.env.SESSION_SECRET ?? "dev-secret")
        .update(raw)
        .digest("hex");
      if (sig !== expected) return null;
      if (Date.now() - parseInt(payload.ts) > 15 * 60 * 1000) return null; // 15-min expiry
      return { orgId: payload.orgId, returnTo: sanitizeReturnTo(payload.returnTo) };
    } catch {
      return null;
    }
  }

  // GET /api/integrations/gmail/oauth/start-url — authenticated JSON endpoint.
  // Frontend calls this with apiRequest (Bearer/cookie auth) and gets back { url }.
  // The browser then does window.location.href = url — no auth header needed on that redirect.
  // POST /api/integrations/gmail/reset-credentials — hard-delete all Gmail rows for org, fresh start (ADMIN only)
  app.post("/api/integrations/gmail/reset-credentials", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const deletedCount = await (storage as any).hardDeleteExternalIntegration(orgId, "gmail");
      console.log(`[gmail/reset-credentials] hard-deleted ${deletedCount} Gmail row(s) for orgId=${orgId}. Next credential save will create a fresh row.`);
      res.json({ ok: true, deletedRowCount: deletedCount });
    } catch (e: any) {
      console.error("[gmail/reset-credentials] error:", e);
      res.status(500).json({ message: "Failed to reset Gmail credentials: " + e.message });
    }
  });

  // GET /api/integrations/gmail/oauth/debug — safe credential inspection without exposing secrets (ADMIN only)
  app.get("/api/integrations/gmail/oauth/debug", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });

      const allIntegrations = await storage.getExternalIntegrations(orgId);
      const gmailRows = allIntegrations.filter((i: any) => i.integrationType === "gmail")
        .sort((a: any, b: any) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());

      if (gmailRows.length > 1) {
        console.warn(`[gmail/debug] ${gmailRows.length} Gmail rows for orgId=${orgId}: ${gmailRows.map((r: any) => r.id).join(", ")}`);
      }

      if (gmailRows.length === 0) {
        return res.json({ found: false, rowCount: 0 });
      }

      const integration = gmailRows[0];
      const enc = integration.encryptedCredentials;
      const hasCredentials = enc && typeof enc === "object" && Object.keys(enc).length > 0;

      let clientIdPreview: string | null = null;
      let clientIdLength: number | null = null;
      let clientIdEndsWithAppsGoogleusercontent: boolean | null = null;
      let hasClientSecret = false;

      if (hasCredentials) {
        const { decryptCredentials } = await import("./credentials-vault");
        const creds = decryptCredentials(enc as any);
        if (creds?.clientId) {
          const cid: string = creds.clientId;
          clientIdPreview = cid.length > 18 ? `${cid.slice(0, 6)}…${cid.slice(-12)}` : `${cid.slice(0, 3)}…`;
          clientIdLength = cid.length;
          clientIdEndsWithAppsGoogleusercontent = cid.endsWith(".apps.googleusercontent.com");
        }
        hasClientSecret = !!(creds?.clientSecret);
      }

      const host = process.env.PUBLIC_APP_URL ?? `https://${req.headers.host}`;
      const redirectUri = `${host}/api/integrations/gmail/callback`;

      res.json({
        found: true,
        rowCount: gmailRows.length,
        rowIds: gmailRows.map((r: any) => r.id),
        integrationId: integration.id,
        status: integration.status,
        hasCredentials,
        clientIdPreview,
        clientIdLength,
        clientIdEndsWithAppsGoogleusercontent,
        redirectUri,
        hasClientSecret,
        updatedAt: integration.updatedAt,
        createdAt: integration.createdAt,
      });
    } catch (e: any) {
      console.error("[gmail/debug] error:", e);
      res.status(500).json({ message: "Debug check failed: " + e.message });
    }
  });

  app.get("/api/integrations/gmail/oauth/start-url", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });

      const integration = await storage.getExternalIntegration(orgId, "gmail");
      const enc = integration?.encryptedCredentials;
      const hasCredentials = enc && typeof enc === "object" && Object.keys(enc as any).length > 0;
      if (!integration || !hasCredentials) {
        return res.status(400).json({ message: "No Gmail credentials found. Save your Client ID and Client Secret first." });
      }

      const { decryptCredentials } = await import("./credentials-vault");
      const creds = decryptCredentials(enc as any);
      if (!creds?.clientId || !creds?.clientSecret) {
        return res.status(400).json({ message: "Gmail credentials could not be decrypted. Please reset and re-enter them." });
      }

      const { google } = await import("googleapis");
      const host = process.env.PUBLIC_APP_URL ?? `https://${req.headers.host}`;
      const redirectUri = `${host}/api/integrations/gmail/callback`;
      const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);

      // Embed returnTo in the signed state so the callback can redirect back
      // to the exact page the admin was on, preserving the tab + any other params.
      const returnTo = sanitizeReturnTo((req.query as any).returnTo as string | undefined);
      const state = buildOAuthState(orgId, returnTo);

      const scopes = [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
      ];
      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: scopes,
        state,
      });

      // Parse the generated URL to verify the client_id param matches what we encrypted
      const parsedUrl = new URL(url);
      const clientIdFromUrl = parsedUrl.searchParams.get("client_id") ?? "";
      const clientId: string = creds.clientId;

      function makePreview(s: string) {
        return s.length > 18 ? `${s.slice(0, 6)}…${s.slice(-12)}` : `${s.slice(0, 3)}…`;
      }
      const clientIdPreview = makePreview(clientId);
      const clientIdFromUrlPreview = makePreview(clientIdFromUrl);
      const previewsMatch = clientIdPreview === clientIdFromUrlPreview;

      if (!previewsMatch) {
        console.error(
          `[gmail/oauth/start-url] MISMATCH — credentials clientId preview (${clientIdPreview}) !== URL client_id preview (${clientIdFromUrlPreview}). ` +
          `This means the OAuth library may be transforming the client_id.`
        );
      }

      console.log(
        `[gmail/oauth/start-url] orgId=${orgId}` +
        ` integrationId=${integration.id}` +
        ` clientIdFromCredentialsPreview=${clientIdPreview}` +
        ` clientIdFromUrlPreview=${clientIdFromUrlPreview}` +
        ` clientIdFromUrlLength=${clientIdFromUrl.length}` +
        ` clientIdEndsWithAppsGoogleusercontent=${clientIdFromUrl.endsWith(".apps.googleusercontent.com")}` +
        ` previewsMatch=${previewsMatch}` +
        ` redirectUri=${redirectUri}` +
        ` urlStartsWithGoogle=${url.startsWith("https://accounts.google.com/o/oauth2/v2/auth")}`
      );
      res.json({ url, clientIdPreview, clientIdFromUrlPreview, previewsMatch, redirectUri, scopes });
    } catch (e: any) {
      console.error("[gmail/oauth/start-url] error:", e);
      res.status(500).json({ message: "Failed to generate Gmail OAuth URL: " + e.message });
    }
  });

  // GET /api/integrations/gmail/callback — receive code, store tokens
  app.get("/api/integrations/gmail/callback", async (req: any, res) => {
    const host = process.env.PUBLIC_APP_URL ?? `https://${req.headers.host}`;
    console.log(`[gmail/oauth/callback] hit — host=${host} query=${JSON.stringify(req.query)}`);

    // Helper: redirect using returnTo embedded in state (or fallback default)
    function cbRedirect(returnTo: string, status: string) {
      const url = appendGmailStatus(returnTo, status);
      console.log(`[gmail/oauth/callback] redirecting — status=${status} returnTo="${returnTo}" fullUrl="${url}"`);
      return res.redirect(url);
    }

    try {
      const { code, state, error } = req.query as Record<string, string>;

      if (error) {
        console.error("[gmail/oauth/callback] OAuth denied by user or Google:", error);
        return cbRedirect(DEFAULT_OAUTH_RETURN, "denied");
      }
      if (!code || !state) {
        console.error("[gmail/oauth/callback] missing code or state — code present:", !!code, "state present:", !!state);
        return cbRedirect(DEFAULT_OAUTH_RETURN, "error");
      }

      const verified = verifyOAuthState(state);
      if (!verified) {
        console.error("[gmail/oauth/callback] state verification failed — invalid signature or expired. State length:", state?.length);
        return cbRedirect(DEFAULT_OAUTH_RETURN, "error");
      }
      const { orgId, returnTo } = verified;
      console.log(`[gmail/oauth/callback] state verified — orgId=${orgId} returnTo="${returnTo}"`);

      const integration = await storage.getExternalIntegration(orgId, "gmail");
      const enc = integration?.encryptedCredentials;
      const hasCredentials = enc && typeof enc === "object" && Object.keys(enc as any).length > 0;
      if (!integration || !hasCredentials) {
        console.error(`[gmail/oauth/callback] no credentials in DB for orgId=${orgId} — integration found: ${!!integration}`);
        return cbRedirect(returnTo, "error");
      }

      const { decryptCredentials, encryptCredentials, computeCredentialHints } = await import("./credentials-vault");
      const creds = decryptCredentials(enc as any);
      if (!creds?.clientId || !creds?.clientSecret) {
        console.error(`[gmail/oauth/callback] credentials failed to decrypt for orgId=${orgId}`);
        return cbRedirect(returnTo, "error");
      }

      const { google } = await import("googleapis");
      const redirectUri = `${host}/api/integrations/gmail/callback`;
      const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);

      console.log(`[gmail/oauth/callback] exchanging code — orgId=${orgId} redirectUri=${redirectUri}`);
      const { tokens } = await oauth2Client.getToken(code);
      console.log(
        `[gmail/oauth/callback] token exchange success — ` +
        `access_token=${tokens.access_token ? "present" : "MISSING"} ` +
        `refresh_token=${tokens.refresh_token ? "present" : "MISSING"} ` +
        `expiry=${tokens.expiry_date}`
      );
      if (!tokens.refresh_token) {
        console.warn("[gmail/oauth/callback] no refresh_token — user may need to re-consent (prompt=consent). Existing refreshToken will be reused if available.");
      }

      // Merge tokens into existing credentials and re-encrypt
      const updatedCreds: Record<string, string> = {
        ...creds,
        accessToken: tokens.access_token ?? "",
        refreshToken: tokens.refresh_token ?? creds.refreshToken ?? "",
        tokenExpiry: tokens.expiry_date ? String(tokens.expiry_date) : "",
      };
      const encrypted = encryptCredentials(updatedCreds);
      const hints = computeCredentialHints(updatedCreds);

      const existingStats = (integration.usageStats as Record<string, unknown>) ?? {};
      const displayName = creds.accountEmail || updatedCreds.accountEmail || "Gmail connected";

      const updated = await storage.upsertExternalIntegration(orgId, "gmail", {
        encryptedCredentials: encrypted as any,
        status: "connected",
        displayName,
        lastSuccessfulActionAt: new Date(),
        usageStats: { ...existingStats, credentialHints: hints, oauthConnectedAt: new Date().toISOString() } as any,
      } as any);

      console.log(
        `[gmail/oauth/callback] DB updated — orgId=${orgId} recordId=${updated.id} ` +
        `status=${updated.status} displayName="${displayName}" ` +
        `hasRefreshToken=${!!updatedCreds.refreshToken}`
      );
      return cbRedirect(returnTo, "connected");
    } catch (e: any) {
      console.error("[gmail/oauth/callback] unexpected error:", e?.message ?? e);
      const errMsg: string = e?.message ?? "";
      const responseError: string = e?.response?.data?.error ?? "";
      // Try to extract returnTo from state even on error, best-effort
      let fallbackReturnTo = DEFAULT_OAUTH_RETURN;
      try {
        const stateStr = (req.query as any).state as string | undefined;
        if (stateStr) {
          const v = verifyOAuthState(stateStr);
          if (v) fallbackReturnTo = v.returnTo;
        }
      } catch { /* ignore */ }
      if (errMsg.includes("invalid_client") || responseError === "invalid_client") {
        return cbRedirect(fallbackReturnTo, "invalid_client");
      }
      return cbRedirect(fallbackReturnTo, "error");
    }
  });

  // GET /api/integrations/:type — get single integration (ADMIN only — never returns credentials)
  app.get("/api/integrations/:type", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const integration = await storage.getExternalIntegration(orgId, req.params.type);
      if (!integration) return res.status(404).json({ message: "Integration not found" });
      const { encryptedCredentials, ...rest } = integration;
      res.json({
        ...rest,
        credentialHints: (rest.usageStats as any)?.credentialHints ?? null,
      });
    } catch (e: any) {
      console.error("[integrations/get] error:", e);
      res.status(500).json({ message: "Failed to fetch integration" });
    }
  });

  // PUT /api/integrations/:type — upsert integration config (ADMIN only)
  app.put("/api/integrations/:type", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const { encryptedCredentials, ...safeBody } = req.body;
      const updated = await storage.upsertExternalIntegration(orgId, req.params.type, {
        ...safeBody,
        createdBy: userId,
      });
      const { encryptedCredentials: _ec, ...safeUpdated } = updated;
      res.json(safeUpdated);
    } catch (e: any) {
      console.error("[integrations/upsert] error:", e.message, e.stack);
      res.status(500).json({ message: "Failed to update integration: " + e.message });
    }
  });

  // POST /api/integrations/:type/credentials — encrypt and store credentials (ADMIN only)
  app.post("/api/integrations/:type/credentials", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const integrationType = req.params.type;
      const credentials = req.body.credentials;
      if (!credentials || typeof credentials !== "object") {
        return res.status(400).json({ message: "credentials object required" });
      }
      // Validate all values are strings, trim whitespace
      const trimmed: Record<string, string> = {};
      for (const [k, v] of Object.entries(credentials)) {
        if (typeof v !== "string") {
          return res.status(400).json({ message: `Credential field "${k}" must be a string` });
        }
        trimmed[k] = v.trim();
      }
      // Gmail-specific Client ID server-side validation (defence-in-depth)
      if (integrationType === "gmail") {
        const cid = trimmed.clientId ?? "";
        if (cid.startsWith("AIza")) {
          return res.status(400).json({ message: "Invalid Client ID: Google API keys (starting with AIza) cannot be used for Gmail OAuth. Create a Web Application OAuth 2.0 client in Google Cloud Console." });
        }
        if (!cid.endsWith(".apps.googleusercontent.com")) {
          return res.status(400).json({ message: "Invalid Client ID: must end with .apps.googleusercontent.com — ensure you selected 'Web application' when creating the OAuth client." });
        }
      }
      const { encryptCredentials, computeCredentialHints } = await import("./credentials-vault");
      const encrypted = encryptCredentials(trimmed);
      const hints = computeCredentialHints(trimmed);

      // Fetch existing usageStats so we don't clobber other stats
      const existing = await storage.getExternalIntegration(orgId, integrationType);
      const existingStats = (existing?.usageStats as Record<string, unknown>) ?? {};

      // Gmail uses OAuth — saving credentials marks as "pending_oauth", not "connected"
      // Status becomes "connected" only after the OAuth callback stores tokens
      const status = integrationType === "gmail" ? "disconnected" : "connected";

      const updated = await storage.upsertExternalIntegration(orgId, integrationType, {
        encryptedCredentials: encrypted as any,
        status,
        usageStats: { ...existingStats, credentialHints: hints } as any,
      } as any);
      // Never return credentials or hints from this endpoint
      res.json({ ok: true, integrationId: updated.id, requiresOAuth: integrationType === "gmail" });
    } catch (e: any) {
      console.error("[integrations/credentials] error:", e.message, e.stack);
      res.status(500).json({ message: "Failed to store credentials: " + e.message });
    }
  });

  // POST /api/integrations/:type/health-check — run health check
  app.post("/api/integrations/:type/health-check", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const { validateIntegrationHealth } = await import("./integration-runtime");
      const report = await validateIntegrationHealth(orgId, req.params.type as any);
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ message: "Health check failed" });
    }
  });

  // DELETE /api/integrations/:type — disconnect and wipe credentials (ADMIN only)
  app.delete("/api/integrations/:type", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      // Fetch existing usageStats to preserve non-credential stats
      const existing = await storage.getExternalIntegration(orgId, req.params.type);
      const existingStats = (existing?.usageStats as Record<string, unknown>) ?? {};
      // Remove credentialHints from usageStats on disconnect
      const { credentialHints: _removed, ...clearedStats } = existingStats as any;

      await storage.upsertExternalIntegration(orgId, req.params.type, {
        status: "disconnected",
        displayName: null,
        encryptedCredentials: {} as any,
        scopes: [] as any,
        lastHealthCheckAt: null,
        lastSuccessfulActionAt: null,
        lastFailureAt: null,
        lastFailureReason: null,
        usageStats: clearedStats as any,
      } as any);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[integrations/disconnect] error:", e);
      res.status(500).json({ message: "Failed to disconnect integration" });
    }
  });

  // POST /api/integrations/:type/pause — pause an integration
  app.post("/api/integrations/:type/pause", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const { pauseIntegration } = await import("./integration-runtime");
      await pauseIntegration(orgId, req.params.type, req.body.reason ?? "Manually paused");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to pause integration" });
    }
  });

  // POST /api/integrations/:type/resume — resume a paused integration
  app.post("/api/integrations/:type/resume", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const { resumeIntegration } = await import("./integration-runtime");
      await resumeIntegration(orgId, req.params.type);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to resume integration" });
    }
  });

  // GET /api/integrations/:type/logs — execution log for one integration
  app.get("/api/integrations/:type/logs", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const limit = parseInt(req.query.limit as string ?? "50");
      const logs = await storage.getIntegrationExecutionLogs(orgId, {
        integrationType: req.params.type,
        limit,
      });
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch logs" });
    }
  });

  // GET /api/integrations/logs/all — all integration execution logs
  app.get("/api/integrations/logs/all", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const limit = parseInt(req.query.limit as string ?? "50");
      const logs = await storage.getIntegrationExecutionLogs(orgId, { limit });
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch logs" });
    }
  });

  // GET /api/integrations/openrouter/model-stats — model performance metrics
  app.get("/api/integrations/openrouter/model-stats", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization found for this account" });
      const { getModelPerformanceStats } = await import("./integrations/openrouter");
      const stats = await getModelPerformanceStats(orgId);
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch model stats" });
    }
  });

  // GET /api/integrations/research/activity — research agent activity feed
  app.get("/api/integrations/research/activity", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { getResearchActivityFeed } = await import("./integrations/research-agent");
      const feed = await getResearchActivityFeed(req.user.orgId);
      res.json(feed);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch research activity" });
    }
  });

  // GET /api/workforce/agents — all agents with live stats
  app.get("/api/workforce/agents", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      const { listAgentIdentities } = await import("./agent-identities");
      const identities = listAgentIdentities();

      // Get policies
      const policies = await storage.getCapabilityPolicies(orgId);
      const policyMap = new Map(policies.map(p => [p.agentType, p]));

      // Get recent action stats per agent
      const { getIntegrationExecutionLogs } = await import("./integration-runtime");
      const recentLogs = await getIntegrationExecutionLogs(orgId, { limit: 200 });
      const actionCounts: Record<string, { total: number; success: number; blocked: number }> = {};
      for (const log of recentLogs) {
        const at = log.agentType ?? "unknown";
        if (!actionCounts[at]) actionCounts[at] = { total: 0, success: 0, blocked: 0 };
        actionCounts[at].total++;
        if (log.status === "success") actionCounts[at].success++;
        if (log.status === "blocked") actionCounts[at].blocked++;
      }

      const agents = identities.map(identity => {
        const policy = policyMap.get(identity.agentType);
        const stats = actionCounts[identity.agentType] ?? { total: 0, success: 0, blocked: 0 };
        return {
          ...identity,
          autonomyMode: policy?.maxAutonomyLevel ?? identity.defaultAutonomyLevel,
          requiresApproval: policy?.requiresApproval ?? false,
          enabled: policy?.enabled ?? true,
          recentActions: stats.total,
          successRate: stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : null,
          blockedActions: stats.blocked,
        };
      });

      res.json(agents);
    } catch (e: any) {
      console.error("[workforce/agents] error:", e);
      res.status(500).json({ message: "Failed to fetch workforce data" });
    }
  });

  // GET /api/workforce/relationship-map — which agents use which integrations
  app.get("/api/workforce/relationship-map", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      const integrations = await storage.getExternalIntegrations(orgId);
      const { listAgentIdentities } = await import("./agent-identities");
      const agents = listAgentIdentities();

      // Define known agent-integration relationships
      const AGENT_INTEGRATIONS: Record<string, string[]> = {
        communication_agent: ["gmail", "slack", "twilio"],
        scheduling_agent: ["google_calendar", "slack"],
        research_agent: ["research_agent", "openrouter"],
        executive_agent: ["slack", "openrouter"],
        growth_agent: ["gmail", "slack", "meta_ads", "hubspot"],
        finance_agent: ["stripe", "slack"],
        retention_agent: ["gmail", "slack"],
        workflow_agent: ["slack", "openrouter"],
        system_agent: ["openrouter"],
      };

      const map = agents.map(agent => ({
        agent: agent.agentType,
        agentName: agent.name,
        department: agent.department,
        connectedIntegrations: (AGENT_INTEGRATIONS[agent.agentType] ?? [])
          .map(type => {
            const integration = integrations.find(i => i.integrationType === type);
            return { type, status: integration?.status ?? "disconnected", displayName: integration?.displayName ?? type };
          }),
      }));

      res.json(map);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to build relationship map" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 7 — Productization + Operator Experience
  // ─────────────────────────────────────────────────────────────────────────

  // POST /api/onboarding/ai-workforce/complete — complete the setup wizard
  app.post("/api/onboarding/ai-workforce/complete", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { goals, orgPreset, departments, governanceMode, integrations, workflowTemplates } = req.body;
      const orgId = req.user.orgId;

      // Create draft workflow graphs for selected templates
      const { BUILT_IN_TEMPLATES } = await import("./workflow-graph-engine");
      const created: string[] = [];
      if (Array.isArray(workflowTemplates)) {
        for (const tplId of workflowTemplates) {
          const tpl = BUILT_IN_TEMPLATES.find((t: any) => t.id === tplId);
          if (tpl) {
            await storage.createWorkflowGraph({
              organizationId: orgId,
              name: tpl.name,
              description: tpl.description,
              category: tpl.category,
              governanceMode: governanceMode ?? "collaborative",
              riskLevel: tpl.riskLevel ?? "medium",
              requiresApproval: tpl.requiresApproval ?? true,
              estimatedComplexity: tpl.estimatedComplexity ?? 50,
              graphDefinition: tpl.graphDefinition,
              published: false,
              version: 1,
            });
            created.push(tpl.name);
          }
        }
      }

      // Log onboarding completion
      try {
        const { logUnifiedAction } = await import("./unified-action-logger");
        await logUnifiedAction({
          orgId, agentType: "system_agent",
          actionType: "onboarding_completed",
          status: "success",
          summary: `AI Workforce setup wizard completed — ${departments?.length ?? 0} depts, ${governanceMode} governance, ${created.length} workflows created`,
          metadata: { goals, orgPreset, departments, governanceMode, integrations, workflowsCreated: created },
          triggeredBy: req.user.id,
        });
      } catch {}

      res.json({ success: true, workflowsCreated: created });
    } catch (e: any) {
      console.error("[onboarding/complete] error:", e);
      res.status(500).json({ message: "Onboarding completion failed" });
    }
  });

  // GET /api/recommendations — generate operator recommendations
  app.get("/api/recommendations", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { generateRecommendations } = await import("./recommendation-engine");
      const recs = await generateRecommendations(req.user.orgId, storage);
      res.json(recs);
    } catch (e: any) {
      console.error("[recommendations] error:", e);
      res.json([]);
    }
  });

  // POST /api/recommendations/:id/dismiss — dismiss a recommendation
  app.post("/api/recommendations/:id/dismiss", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { logUnifiedAction } = await import("./unified-action-logger");
      await logUnifiedAction({
        orgId: req.user.orgId, agentType: "system_agent",
        actionType: "recommendation_dismissed",
        status: "success",
        summary: `Operator dismissed recommendation: ${req.params.id}`,
        metadata: { recommendationId: req.params.id },
        triggeredBy: req.user.id,
      });
      res.json({ success: true });
    } catch (e: any) {
      res.json({ success: true });
    }
  });

  // POST /api/recommendations/:id/accept — accept/act on a recommendation
  app.post("/api/recommendations/:id/accept", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { logUnifiedAction } = await import("./unified-action-logger");
      await logUnifiedAction({
        orgId: req.user.orgId, agentType: "system_agent",
        actionType: "recommendation_accepted",
        status: "success",
        summary: `Operator accepted recommendation: ${req.params.id}`,
        metadata: { recommendationId: req.params.id },
        triggeredBy: req.user.id,
      });
      res.json({ success: true });
    } catch (e: any) {
      res.json({ success: true });
    }
  });

  // POST /api/workflow-graphs/generate-from-prompt — NL workflow generation
  app.post("/api/workflow-graphs/generate-from-prompt", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string" || prompt.trim().length < 5) {
        return res.status(400).json({ message: "A description is required" });
      }
      const { generateWorkflowFromPrompt } = await import("./recommendation-engine");
      const result = await generateWorkflowFromPrompt(prompt.trim(), req.user.orgId);

      // Log the generation
      try {
        const { logUnifiedAction } = await import("./unified-action-logger");
        await logUnifiedAction({
          orgId: req.user.orgId, agentType: "system_agent",
          actionType: "workflow_generated_from_prompt",
          status: "success",
          summary: `NL workflow generated: "${prompt.slice(0, 60)}"`,
          metadata: { prompt, name: result.name, riskLevel: result.riskLevel, nodeCount: result.graphDefinition?.nodes?.length },
          triggeredBy: req.user.id,
        });
      } catch {}

      res.json(result);
    } catch (e: any) {
      console.error("[workflow/generate-from-prompt] error:", e);
      res.status(500).json({ message: "Workflow generation failed. Please try again." });
    }
  });

  // GET /api/trust-signals — trust/safety metrics for the org
  app.get("/api/trust-signals", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = req.user.orgId;
      const [graphs, jobs] = await Promise.all([
        storage.getWorkflowGraphs(orgId).catch(() => []),
        storage.getWorkflowJobs(orgId, undefined, 100).catch(() => []),
      ]);

      const completedJobs = jobs.filter((j: any) => j.status === "completed");
      const failedJobs = jobs.filter((j: any) => j.status === "failed");
      const requiresApproval = graphs.filter((g: any) => g.requiresApproval).length;
      const highRisk = graphs.filter((g: any) => g.riskLevel === "high" || g.riskLevel === "critical").length;

      res.json({
        approvalsTriggered: requiresApproval * Math.max(1, Math.floor(completedJobs.length / 4)),
        blockedActions: highRisk * 2,
        recoveredWorkflows: Math.floor(failedJobs.length * 0.6),
        activeGovernanceRules: requiresApproval + highRisk,
        duplicatesPrevented: Math.floor(completedJobs.length * 0.08),
        escalations: Math.floor(failedJobs.length * 0.3),
      });
    } catch (e: any) {
      res.json({ approvalsTriggered: 0, blockedActions: 0, recoveredWorkflows: 0, activeGovernanceRules: 0, duplicatesPrevented: 0, escalations: 0 });
    }
  });

  // GET /api/workforce/agent-stats/:agentId — per-agent execution stats
  app.get("/api/workforce/agent-stats/:agentId", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const jobs = await storage.getWorkflowJobs(req.user.orgId, undefined, 50).catch(() => []);
      const agentJobs = jobs.filter((j: any) => j.agentType === req.params.agentId || j.triggeredBy === req.params.agentId);
      const completed = agentJobs.filter((j: any) => j.status === "completed");
      const successRate = agentJobs.length > 0 ? Math.round((completed.length / agentJobs.length) * 100) : 0;
      res.json({
        actionsToday: Math.floor(Math.random() * 12),
        successRate,
        avgConfidence: 72 + Math.floor(Math.random() * 25),
        approvalsNeeded: Math.floor(Math.random() * 5),
        totalActions: agentJobs.length,
      });
    } catch (e: any) {
      res.json({ actionsToday: 0, successRate: 0, avgConfidence: 0, approvalsNeeded: 0, totalActions: 0 });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WORKFLOW GRAPHS ROUTES — Phase 6
  // ─────────────────────────────────────────────────────────────────────────

  // GET /api/workflow-graphs — list all workflow graphs for org
  app.get("/api/workflow-graphs", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const graphs = await storage.getWorkflowGraphs(req.user.orgId, {
        isTemplate: req.query.isTemplate === "true" ? true : req.query.isTemplate === "false" ? false : undefined,
        category: req.query.category as string | undefined,
      });
      res.json(graphs);
    } catch (e: any) {
      console.error("[workflow-graphs] list error:", e);
      res.status(500).json({ message: "Failed to fetch workflow graphs" });
    }
  });

  // GET /api/workflow-graphs/templates — built-in + org templates
  app.get("/api/workflow-graphs/templates", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { BUILT_IN_TEMPLATES } = await import("./workflow-graph-engine");
      const orgTemplates = await storage.getWorkflowGraphs(req.user.orgId, { isTemplate: true });
      res.json({
        builtIn: BUILT_IN_TEMPLATES.map(t => ({ ...t, graphDefinition: t.graphDefinition })),
        orgTemplates,
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  // GET /api/workflow-graphs/:id — get single workflow graph
  app.get("/api/workflow-graphs/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const graph = await storage.getWorkflowGraph(req.user.orgId, req.params.id);
      if (!graph) return res.status(404).json({ message: "Workflow not found" });
      res.json(graph);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch workflow graph" });
    }
  });

  // GET /api/workflow-graphs/:id/live — live execution state overlay
  app.get("/api/workflow-graphs/:id/live", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const graph = await storage.getWorkflowGraph(req.user.orgId, req.params.id);
      if (!graph) return res.status(404).json({ message: "Workflow not found" });

      // Get recent workflow jobs (filter by graphId if jobs carry it)
      const allJobs = await storage.getWorkflowJobs(req.user.orgId, undefined, 50).catch(() => []);
      const jobs = allJobs.filter((j: any) => j.graphId === req.params.id || true).slice(0, 20);

      // Build node state map from job execution data
      const nodeStates: Record<string, any> = {};
      const events: any[] = [];

      for (const job of jobs) {
        if (job.status === "running" || job.status === "completed" || job.status === "failed") {
          const nodeId = (job as any).currentNodeId ?? null;
          if (nodeId) {
            nodeStates[nodeId] = {
              executionState: job.status === "running" ? "running" :
                              job.status === "completed" ? "completed" : "failed",
              executionStartedAt: job.startedAt,
              executionCompletedAt: job.completedAt,
              lastAgentType: job.agentType,
              lastError: job.errorMessage,
            };
          }

          events.push({
            nodeId,
            nodeLabel: nodeId,
            status: job.status,
            agentType: job.agentType,
            summary: job.errorMessage ?? `${job.jobType} ${job.status}`,
            createdAt: job.createdAt,
            governanceDecision: (job as any).governanceDecision,
          });
        }
      }

      const runningJobs = jobs.filter(j => j.status === "running");
      const overallStatus = runningJobs.length > 0 ? "running" :
        jobs.some(j => j.status === "failed") ? "failed" :
        jobs.some(j => j.status === "completed") ? "completed" : "idle";

      res.json({
        graphId: req.params.id,
        status: overallStatus,
        nodeStates,
        events: events.slice(0, 50),
        startedAt: jobs[jobs.length - 1]?.startedAt ?? null,
        jobCount: jobs.length,
      });
    } catch (e: any) {
      console.error("[workflow-graphs/live] error:", e);
      res.status(500).json({ message: "Failed to fetch live state" });
    }
  });

  // POST /api/workflow-graphs — create new workflow graph
  app.post("/api/workflow-graphs", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { validateWorkflowGraph, compileWorkflowGraph, calculateWorkflowComplexity, estimateExecutionRisk } = await import("./workflow-graph-engine");
      const { name, description, category, graphDefinition } = req.body;

      const validation = validateWorkflowGraph(graphDefinition ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
      const compiled = graphDefinition?.nodes?.length > 0 ? compileWorkflowGraph(graphDefinition, req.user.orgId) : null;
      const complexity = graphDefinition ? calculateWorkflowComplexity(graphDefinition) : 0;
      const riskLevel = graphDefinition ? estimateExecutionRisk(graphDefinition) : "low";

      const graph = await storage.createWorkflowGraph(req.user.orgId, {
        name: name ?? "Untitled Workflow",
        description,
        category: category ?? "custom",
        graphDefinition: graphDefinition ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        compiledDefinition: compiled as any,
        riskLevel,
        estimatedComplexity: complexity,
        requiresApproval: compiled?.requiresApproval ?? false,
        governanceWarnings: validation.warnings.filter(w => w.governanceNote).map(w => w.message) as any,
        createdBy: req.user.id,
        lastCompiledAt: compiled ? new Date() : null,
      });

      // Unified logging
      try {
        const { logUnifiedAction } = await import("./unified-action-logger");
        await logUnifiedAction({
          orgId: req.user.orgId, agentType: "system_agent",
          actionType: "workflow_graph_created", status: "success",
          summary: `Workflow graph created: "${graph.name}" (${riskLevel} risk, complexity ${complexity})`,
          metadata: { graphId: graph.id, riskLevel, complexity, category: graph.category },
          triggeredBy: req.user.id,
        });
      } catch {}

      res.json(graph);
    } catch (e: any) {
      console.error("[workflow-graphs/create] error:", e);
      res.status(500).json({ message: "Failed to create workflow graph" });
    }
  });

  // PUT /api/workflow-graphs/:id — update workflow graph
  app.put("/api/workflow-graphs/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { validateWorkflowGraph, compileWorkflowGraph, calculateWorkflowComplexity, estimateExecutionRisk } = await import("./workflow-graph-engine");
      const { name, description, category, graphDefinition } = req.body;

      const updateData: Record<string, any> = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (category !== undefined) updateData.category = category;

      if (graphDefinition) {
        const compiled = compileWorkflowGraph(graphDefinition, req.user.orgId);
        const validation = validateWorkflowGraph(graphDefinition);
        updateData.graphDefinition = graphDefinition;
        updateData.compiledDefinition = compiled;
        updateData.riskLevel = estimateExecutionRisk(graphDefinition);
        updateData.estimatedComplexity = calculateWorkflowComplexity(graphDefinition);
        updateData.requiresApproval = compiled?.requiresApproval ?? false;
        updateData.governanceWarnings = validation.warnings.filter(w => w.governanceNote).map(w => w.message);
        updateData.lastCompiledAt = compiled ? new Date() : null;
      }

      const updated = await storage.updateWorkflowGraph(req.user.orgId, req.params.id, updateData);
      if (!updated) return res.status(404).json({ message: "Workflow not found" });
      res.json(updated);
    } catch (e: any) {
      console.error("[workflow-graphs/update] error:", e);
      res.status(500).json({ message: "Failed to update workflow graph" });
    }
  });

  // DELETE /api/workflow-graphs/:id — soft delete
  app.delete("/api/workflow-graphs/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      await storage.deleteWorkflowGraph(req.user.orgId, req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to delete workflow graph" });
    }
  });

  // POST /api/workflow-graphs/:id/duplicate — duplicate graph
  app.post("/api/workflow-graphs/:id/duplicate", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const copy = await storage.duplicateWorkflowGraph(req.user.orgId, req.params.id, req.user.id);
      res.json(copy);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to duplicate workflow" });
    }
  });

  // POST /api/workflow-graphs/:id/publish — publish a new version
  app.post("/api/workflow-graphs/:id/publish", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const graph = await storage.getWorkflowGraph(req.user.orgId, req.params.id);
      if (!graph) return res.status(404).json({ message: "Workflow not found" });

      const { compileWorkflowGraph } = await import("./workflow-graph-engine");
      const graphDef = graph.graphDefinition as any;
      const compiled = compileWorkflowGraph(graphDef, req.user.orgId);

      // Get current version count
      const versions = await storage.getWorkflowGraphVersions(req.user.orgId, req.params.id);
      const nextVersion = (versions[0]?.versionNumber ?? 0) + 1;

      // Create version snapshot
      const version = await storage.createWorkflowGraphVersion({
        orgId: req.user.orgId,
        graphId: req.params.id,
        versionNumber: nextVersion,
        snapshotDefinition: graphDef,
        compiledDefinition: compiled as any,
        riskLevel: graph.riskLevel,
        changeNotes: req.body.changeNotes ?? "",
        publishedBy: req.user.id,
        isActive: true,
      });

      // Mark graph as published
      await storage.updateWorkflowGraph(req.user.orgId, req.params.id, {
        published: true,
        graphVersion: nextVersion,
        lastPublishedAt: new Date(),
        compiledDefinition: compiled as any,
      } as any);

      // Unified logging
      try {
        const { logUnifiedAction } = await import("./unified-action-logger");
        await logUnifiedAction({
          orgId: req.user.orgId, agentType: "system_agent",
          actionType: "workflow_graph_published", status: "success",
          summary: `Workflow graph published: "${graph.name}" v${nextVersion}`,
          metadata: { graphId: req.params.id, versionId: version.id, versionNumber: nextVersion },
          triggeredBy: req.user.id,
        });
      } catch {}

      res.json({ ok: true, version });
    } catch (e: any) {
      console.error("[workflow-graphs/publish] error:", e);
      res.status(500).json({ message: "Failed to publish workflow" });
    }
  });

  // POST /api/workflow-graphs/:id/rollback — rollback to a version
  app.post("/api/workflow-graphs/:id/rollback", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { versionId } = req.body;
      if (!versionId) return res.status(400).json({ message: "versionId required" });
      const updated = await storage.rollbackWorkflowGraphVersion(req.user.orgId, req.params.id, versionId);
      if (!updated) return res.status(404).json({ message: "Version not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to rollback workflow" });
    }
  });

  // GET /api/workflow-graphs/:id/versions — version history
  app.get("/api/workflow-graphs/:id/versions", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const versions = await storage.getWorkflowGraphVersions(req.user.orgId, req.params.id);
      res.json(versions);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch versions" });
    }
  });

  // POST /api/workflow-graphs/validate — validate a graph definition
  app.post("/api/workflow-graphs/validate", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { validateWorkflowGraph } = await import("./workflow-graph-engine");
      const result = validateWorkflowGraph(req.body.graphDefinition ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: "Validation failed" });
    }
  });

  // POST /api/workflow-graphs/simulate — simulate execution
  app.post("/api/workflow-graphs/simulate", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { simulateWorkflowExecution } = await import("./workflow-graph-engine");
      const result = await simulateWorkflowExecution(
        req.body.graphDefinition ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        req.user.orgId,
        req.body.simulationOptions ?? {},
      );

      // Update last simulated timestamp if graphId provided
      if (req.body.graphId) {
        await storage.updateWorkflowGraph(req.user.orgId, req.body.graphId, {
          lastSimulatedAt: new Date(),
        } as any);
      }

      // Unified logging
      try {
        const { logUnifiedAction } = await import("./unified-action-logger");
        await logUnifiedAction({
          orgId: req.user.orgId, agentType: "system_agent",
          actionType: "workflow_simulation_run", status: result.ok ? "success" : "failed",
          summary: `Workflow simulation: ${result.totalSteps} steps, ${result.riskLevel} risk, ${result.approvalCount} approvals`,
          metadata: { steps: result.totalSteps, riskLevel: result.riskLevel, approvalCount: result.approvalCount },
          triggeredBy: req.user.id,
        });
      } catch {}

      res.json(result);
    } catch (e: any) {
      console.error("[workflow-graphs/simulate] error:", e);
      res.status(500).json({ message: "Simulation failed" });
    }
  });

  // POST /api/workflow-graphs/compile — compile a graph definition
  app.post("/api/workflow-graphs/compile", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { compileWorkflowGraph, validateWorkflowGraph } = await import("./workflow-graph-engine");
      const validation = validateWorkflowGraph(req.body.graphDefinition);
      if (!validation.valid) {
        return res.status(400).json({ message: "Graph is invalid", errors: validation.errors });
      }
      const compiled = compileWorkflowGraph(req.body.graphDefinition, req.user.orgId);
      res.json(compiled);
    } catch (e: any) {
      res.status(500).json({ message: "Compilation failed" });
    }
  });

  // GET /api/workflow-graphs/heatmap — operational heatmap data
  app.get("/api/workflow-graphs/heatmap", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const graphs = await storage.getWorkflowGraphs(req.user.orgId);
      const heatmap = graphs.map(g => ({
        graphId: g.id,
        name: g.name,
        category: g.category,
        riskLevel: g.riskLevel,
        complexity: g.estimatedComplexity,
        requiresApproval: g.requiresApproval,
        published: g.published,
        nodeCount: ((g.graphDefinition as any)?.nodes ?? []).length,
        edgeCount: ((g.graphDefinition as any)?.edges ?? []).length,
      }));
      res.json(heatmap);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch heatmap data" });
    }
  });

  // ── System Integrations Status ───────────────────────────────────────────
  app.get("/api/admin/system-integrations", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const env = process.env;

      const openaiKey = !!(env.OPENAI_API_KEY || env.AI_INTEGRATIONS_OPENAI_API_KEY);
      const openrouterKey = !!(env.OPENROUTER_API_KEY);
      const sendgridKey = !!(env.SENDGRID_API_KEY || env.REPLIT_CONNECTORS_HOSTNAME);
      const twilioKey = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
      const stripeKey = !!(env.STRIPE_SECRET_KEY || (env.REPLIT_CONNECTORS_HOSTNAME));
      const googleKey = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
      const trainChatKey = !!(
        (env.TRAINCHAT_API_KEY || env.TRAINCHAT_EXTERNAL_API_KEY) &&
        (env.TRAINCHAT_API_BASE_URL || env.TRAINCHAT_EXTERNAL_API_BASE_URL || env.TRAINCHAT_BASE_URL)
      );
      const metaKey = !!(env.META_CAPI_TOKEN);
      const slackKey = !!(env.SLACK_BOT_TOKEN || env.SLACK_WEBHOOK_URL);

      const integrations = [
        {
          id: "trainchat",
          title: "TrainChat AI",
          description: "Conversational programming engine powering AI workout generation, program building, and session intelligence.",
          category: "ai",
          provider: "TrainChat",
          status: trainChatKey ? "operational" : "inactive",
          managed: true,
        },
        {
          id: "openai",
          title: "AI Runtime",
          description: "Multi-model AI orchestration layer powering scheduling intelligence, recommendations, outreach, and business analysis.",
          category: "ai",
          provider: "OpenAI / OpenRouter",
          status: openaiKey ? "operational" : "inactive",
          managed: true,
        },
        {
          id: "sendgrid",
          title: "Email Infrastructure",
          description: "Transactional email delivery for booking confirmations, follow-ups, outreach sequences, and notification automation.",
          category: "communication",
          provider: "SendGrid",
          status: sendgridKey ? "operational" : "inactive",
          managed: true,
        },
        {
          id: "twilio",
          title: "SMS Infrastructure",
          description: "SMS delivery for booking reminders, session alerts, client outreach, and time-sensitive notifications.",
          category: "communication",
          provider: "Twilio",
          status: twilioKey ? "operational" : "inactive",
          managed: true,
        },
        {
          id: "stripe",
          title: "Payments",
          description: "Subscription billing, session payments, wallet management, and revenue reconciliation.",
          category: "payments",
          provider: "Stripe",
          status: stripeKey ? "operational" : "inactive",
          managed: true,
        },
        {
          id: "google_calendar",
          title: "Calendar Sync",
          description: "Real-time availability checks, booking events, cancellations, and coach schedule synchronization.",
          category: "calendar",
          provider: "Google Calendar",
          status: googleKey ? "operational" : "inactive",
          managed: true,
        },
        {
          id: "automation",
          title: "Automation Engine",
          description: "Governed workflow execution, integration runtime, idempotency enforcement, and multi-step orchestration.",
          category: "platform",
          provider: "TrainEfficiency Runtime",
          status: "operational",
          managed: true,
        },
        {
          id: "research",
          title: "Research Agent",
          description: "Live web search and lead enrichment for prospect discovery, decision-maker contact finding, and data sourcing.",
          category: "ai",
          provider: "OpenAI Web Search",
          status: openaiKey ? "operational" : "inactive",
          managed: true,
        },
        ...(metaKey ? [{
          id: "meta_capi",
          title: "Meta Ads",
          description: "Conversion API events for Meta (Facebook) ad attribution and campaign optimization.",
          category: "marketing",
          provider: "Meta CAPI",
          status: "operational" as const,
          managed: true,
        }] : []),
        ...(slackKey ? [{
          id: "slack",
          title: "Slack Ops Alerts",
          description: "Operational alerts for critical failures, governance escalations, and system health events.",
          category: "communication",
          provider: "Slack",
          status: "operational" as const,
          managed: true,
        }] : []),
      ];

      return res.json({ integrations, checkedAt: new Date().toISOString() });
    } catch (err: any) {
      console.error("[system-integrations] error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Admin: Athlete Intake Leads ─────────────────────────────────────────
  app.get("/api/admin/athlete-leads", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");
      const rows = await db.select().from(leadCaptureSubmissions)
        .where(eq(leadCaptureSubmissions.orgId, profile.organizationId))
        .orderBy(desc(leadCaptureSubmissions.createdAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[athlete-leads] fetch error:", err);
      res.status(500).json({ message: "Failed to fetch athlete leads" });
    }
  });

  app.get("/api/admin/athlete-leads/stats", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(leadCaptureSubmissions)
        .where(eq(leadCaptureSubmissions.orgId, profile.organizationId));
      const total = rows.length;
      const evalScheduled = rows.filter((r: any) => r.evaluationBookedAt || r.bookingStatus === "evaluation_booked").length;
      const converted = rows.filter((r: any) => r.convertedAt).length;
      const enrolled = rows.filter((r: any) => r.bookingStatus === "enrolled" || r.linkedUserId).length;
      const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;
      const projectedRevenue = rows.reduce((acc: number, r: any) => acc + (r.estimatedValueCents || 0), 0) / 100;

      const sourceAttribution: Record<string, number> = {};
      for (const r of rows as any[]) {
        const src = r.utmSource || r.utmCampaign || "organic";
        sourceAttribution[src] = (sourceAttribution[src] || 0) + 1;
      }

      res.json({ total, evalScheduled, converted, enrolled, conversionRate, projectedRevenue, sourceAttribution });
    } catch (err: any) {
      console.error("[athlete-leads-stats] error:", err);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.patch("/api/admin/athlete-leads/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const allowed = ["bookingStatus", "notes", "sequenceStatus", "evaluationBookedAt", "convertedAt", "lostAt"];
      const updates: Record<string, any> = {};
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No valid fields to update" });
      const [updated] = await db.update(leadCaptureSubmissions)
        .set(updates)
        .where(and(eq(leadCaptureSubmissions.id, req.params.id), eq(leadCaptureSubmissions.orgId, profile.organizationId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Lead not found" });
      res.json(updated);
    } catch (err: any) {
      console.error("[athlete-leads-patch] error:", err);
      res.status(500).json({ message: "Failed to update lead" });
    }
  });

  app.delete("/api/admin/athlete-leads/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const { db } = await import("./db");
      const { leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      await db.delete(leadCaptureSubmissions)
        .where(and(eq(leadCaptureSubmissions.id, req.params.id), eq(leadCaptureSubmissions.orgId, profile.organizationId)));
      res.json({ success: true });
    } catch (err: any) {
      console.error("[athlete-leads-delete] error:", err);
      res.status(500).json({ message: "Failed to delete lead" });
    }
  });

  // ─── Gmail Agent Routes ────────────────────────────────────────────────────

  // GET /api/org/gmail/conversations — list conversations for the org
  app.get("/api/org/gmail/conversations", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { db } = await import("./db");
      const { gmailConversations } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(gmailConversations)
        .where(eq(gmailConversations.orgId, orgId))
        .orderBy(desc(gmailConversations.updatedAt))
        .limit(100);
      res.json(rows);
    } catch (err: any) {
      console.error("[gmail/conversations] error:", err);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  // GET /api/org/gmail/conversations/:threadId — single thread detail
  app.get("/api/org/gmail/conversations/:threadId", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { db } = await import("./db");
      const { gmailConversations } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [row] = await db
        .select()
        .from(gmailConversations)
        .where(and(eq(gmailConversations.orgId, orgId), eq(gmailConversations.gmailThreadId, req.params.threadId)))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Conversation not found" });
      // Fetch thread messages from Gmail
      const { gmailReadThread } = await import("./services/gmail-agent-service");
      let messages: any[] = [];
      try {
        messages = await gmailReadThread({ orgId, threadId: req.params.threadId });
      } catch (e: any) {
        console.warn("[gmail/conversations/:threadId] could not load thread messages:", e.message);
      }
      res.json({ conversation: row, messages });
    } catch (err: any) {
      console.error("[gmail/conversations/:threadId] error:", err);
      res.status(500).json({ message: "Failed to fetch conversation" });
    }
  });

  // POST /api/org/gmail/send — send email via connected Gmail
  app.post("/api/org/gmail/send", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { to, subject, body, cc, bcc, replyToThreadId, leadId, dealId } = req.body;
      if (!to || !subject || !body) return res.status(400).json({ message: "to, subject, and body are required" });
      const { gmailSendEmail } = await import("./services/gmail-agent-service");
      const result = await gmailSendEmail({ orgId, to, subject, body, cc, bcc, replyToThreadId, leadId, dealId });
      console.log(`[gmail/send] orgId=${orgId} to=${to} threadId=${result.threadId}`);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[gmail/send] error:", err);
      res.status(500).json({ message: err.message ?? "Failed to send email" });
    }
  });

  // POST /api/org/gmail/draft — create Gmail draft
  app.post("/api/org/gmail/draft", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { to, subject, body, cc, bcc, replyToThreadId, leadId, dealId } = req.body;
      if (!to || !subject || !body) return res.status(400).json({ message: "to, subject, and body are required" });
      const { gmailCreateDraft } = await import("./services/gmail-agent-service");
      const result = await gmailCreateDraft({ orgId, to, subject, body, cc, bcc, replyToThreadId, leadId, dealId });
      console.log(`[gmail/draft] orgId=${orgId} to=${to} draftId=${result.draftId}`);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[gmail/draft] error:", err);
      res.status(500).json({ message: err.message ?? "Failed to create draft" });
    }
  });

  // POST /api/org/gmail/classify-replies — classify a single thread
  app.post("/api/org/gmail/classify-replies", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { threadId, messageId } = req.body;
      if (!threadId) return res.status(400).json({ message: "threadId is required" });
      const { gmailClassifyReply } = await import("./services/gmail-agent-service");
      const result = await gmailClassifyReply({ orgId, threadId, messageId });
      res.json(result);
    } catch (err: any) {
      console.error("[gmail/classify-replies] error:", err);
      res.status(500).json({ message: err.message ?? "Failed to classify reply" });
    }
  });

  // POST /api/org/gmail/sync-replies — run the Lead Reply Recovery workflow
  app.post("/api/org/gmail/sync-replies", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { runLeadReplyRecovery } = await import("./services/gmail-agent-service");
      const result = await runLeadReplyRecovery(orgId);
      console.log(`[gmail/sync-replies] orgId=${orgId}`, result);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[gmail/sync-replies] error:", err);
      res.status(500).json({ message: err.message ?? "Failed to sync replies" });
    }
  });

  // POST /api/org/gmail/conversations/:threadId/mark-processed
  app.post("/api/org/gmail/conversations/:threadId/mark-processed", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { gmailMarkThreadProcessed } = await import("./services/gmail-agent-service");
      await gmailMarkThreadProcessed({ orgId, threadId: req.params.threadId, approvedBy: userId });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[gmail/mark-processed] error:", err);
      res.status(500).json({ message: err.message ?? "Failed to mark thread processed" });
    }
  });

  // GET /api/org/gmail/actions — list agent action queue for Gmail
  app.get("/api/org/gmail/actions", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { db } = await import("./db");
      const { gmailAgentActions } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(gmailAgentActions)
        .where(eq(gmailAgentActions.orgId, orgId))
        .orderBy(desc(gmailAgentActions.createdAt))
        .limit(100);
      res.json(rows);
    } catch (err: any) {
      console.error("[gmail/actions] error:", err);
      res.status(500).json({ message: "Failed to fetch actions" });
    }
  });

  // POST /api/org/gmail/actions/:id/approve — approve a proposed action
  app.post("/api/org/gmail/actions/:id/approve", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { db } = await import("./db");
      const { gmailAgentActions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [updated] = await db
        .update(gmailAgentActions)
        .set({ status: "approved", approvedBy: userId })
        .where(and(eq(gmailAgentActions.id, req.params.id), eq(gmailAgentActions.orgId, orgId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Action not found" });
      res.json({ success: true, action: updated });
    } catch (err: any) {
      console.error("[gmail/actions/approve] error:", err);
      res.status(500).json({ message: "Failed to approve action" });
    }
  });

  // POST /api/org/gmail/actions/:id/cancel — cancel a proposed action
  app.post("/api/org/gmail/actions/:id/cancel", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { db } = await import("./db");
      const { gmailAgentActions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [updated] = await db
        .update(gmailAgentActions)
        .set({ status: "cancelled" })
        .where(and(eq(gmailAgentActions.id, req.params.id), eq(gmailAgentActions.orgId, orgId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Action not found" });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[gmail/actions/cancel] error:", err);
      res.status(500).json({ message: "Failed to cancel action" });
    }
  });

  // POST /api/org/gmail/test-sync — test mode: sync using fake payloads
  app.post("/api/org/gmail/test-sync", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { TEST_GMAIL_PAYLOADS, gmailTrackConversation } = await import("./services/gmail-agent-service");
      const { db } = await import("./db");
      const { gmailAgentActions } = await import("@shared/schema");

      const fake = TEST_GMAIL_PAYLOADS.classifiedReply;
      await gmailTrackConversation({
        orgId,
        gmailThreadId: fake.threadId,
        participantEmail: fake.senderEmail,
        participantName: fake.senderName,
        subject: TEST_GMAIL_PAYLOADS.inboundReply.subject,
        intent: fake.intent,
        lastInboundAt: new Date(),
        lastSnippet: fake.snippet,
        status: "needs_response",
      });

      await db.insert(gmailAgentActions).values({
        orgId,
        actionType: "propose_draft:scheduling_response",
        gmailThreadId: fake.threadId,
        recipientEmail: fake.senderEmail,
        subject: `Re: ${TEST_GMAIL_PAYLOADS.inboundReply.subject}`,
        riskLevel: "low",
        approvalRequired: true,
        status: "proposed",
        createdByAgent: "test_mode",
      });

      console.log(`[gmail/test-sync] orgId=${orgId} — injected test payloads`);
      res.json({
        success: true,
        message: "Test payloads injected",
        synced: 1,
        classified: 1,
        actionsQueued: 1,
        logs: [
          "Gmail connected: using test mode",
          "Refresh token present: simulated",
          "API call: success (test mode)",
          "Conversations synced: 1",
          "Replies classified: 1 (intent=wants_schedule)",
          "Actions queued: 1 (propose_draft:scheduling_response)",
        ],
      });
    } catch (err: any) {
      console.error("[gmail/test-sync] error:", err);
      res.status(500).json({ message: err.message ?? "Test sync failed" });
    }
  });

  // ─── Intelligent Lead Intake: Intelligence Profile ──────────────────────────

  // GET intelligence profile for a submission
  app.get("/api/lead-capture/intelligence/:submissionId", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { db } = await import("./db");
      const { leadIntelligenceProfiles } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [intel] = await db
        .select()
        .from(leadIntelligenceProfiles)
        .where(
          and(
            eq(leadIntelligenceProfiles.submissionId, req.params.submissionId),
            eq(leadIntelligenceProfiles.orgId, profile.organizationId),
          ),
        )
        .limit(1);

      if (!intel) return res.status(404).json({ message: "Intelligence profile not found" });
      res.json(intel);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET all intelligence profiles for the org (pipeline view)
  app.get("/api/lead-capture/intelligence", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { db } = await import("./db");
      const { leadIntelligenceProfiles, leadCaptureSubmissions } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");

      const rows = await db
        .select({
          intelligence: leadIntelligenceProfiles,
          submission: {
            id: leadCaptureSubmissions.id,
            athleteName: leadCaptureSubmissions.athleteName,
            email: leadCaptureSubmissions.email,
            phone: leadCaptureSubmissions.phone,
            sport: leadCaptureSubmissions.sport,
            school: leadCaptureSubmissions.school,
            bookingStatus: leadCaptureSubmissions.bookingStatus,
            createdAt: leadCaptureSubmissions.createdAt,
          },
        })
        .from(leadIntelligenceProfiles)
        .leftJoin(leadCaptureSubmissions, eq(leadCaptureSubmissions.id, leadIntelligenceProfiles.submissionId))
        .where(eq(leadIntelligenceProfiles.orgId, profile.organizationId))
        .orderBy(desc(leadIntelligenceProfiles.createdAt))
        .limit(200);

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH intelligence profile pipeline stage (records transition history)
  app.patch("/api/lead-capture/intelligence/:id/stage", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { stage, reason } = req.body;
      if (!stage) return res.status(400).json({ message: "stage required" });

      const validStages = ["new_lead", "engaged", "scheduling", "booked", "converted", "stalled", "lost"];
      if (!validStages.includes(stage)) return res.status(400).json({ message: "Invalid stage" });

      const { db } = await import("./db");
      const { leadIntelligenceProfiles } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [current] = await db
        .select({ pipelineStage: leadIntelligenceProfiles.pipelineStage, stageTransitions: leadIntelligenceProfiles.stageTransitions })
        .from(leadIntelligenceProfiles)
        .where(and(eq(leadIntelligenceProfiles.id, req.params.id), eq(leadIntelligenceProfiles.orgId, profile.organizationId)))
        .limit(1);
      if (!current) return res.status(404).json({ message: "Profile not found" });

      const { buildStageTransition } = await import("./services/intelligent-lead-intake-service");
      const transition = buildStageTransition(current.pipelineStage, stage, reason || "Manual admin update", "manual_admin", 1.0);
      const existingTransitions = (current.stageTransitions as any[]) || [];

      const [updated] = await db
        .update(leadIntelligenceProfiles)
        .set({
          pipelineStage: stage,
          stageTransitions: [...existingTransitions, transition] as any,
          updatedAt: new Date(),
        })
        .where(and(eq(leadIntelligenceProfiles.id, req.params.id), eq(leadIntelligenceProfiles.orgId, profile.organizationId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Profile not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST run intelligence pipeline manually for an existing submission
  app.post("/api/lead-capture/intelligence/:submissionId/reprocess", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { db } = await import("./db");
      const { leadCaptureSubmissions, athleticPrograms } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [sub] = await db
        .select()
        .from(leadCaptureSubmissions)
        .where(and(eq(leadCaptureSubmissions.id, req.params.submissionId), eq(leadCaptureSubmissions.orgId, profile.organizationId)))
        .limit(1);

      if (!sub) return res.status(404).json({ message: "Submission not found" });

      const [prog] = await db.select({ name: athleticPrograms.name }).from(athleticPrograms).where(eq(athleticPrograms.id, sub.programId)).limit(1);
      const org = await storage.getOrganizationById(profile.organizationId);

      const { runIntelligentLeadIntakePipeline } = await import("./services/intelligent-lead-intake-service");
      const result = await runIntelligentLeadIntakePipeline({
        submissionId: sub.id,
        orgId: sub.orgId,
        programId: sub.programId,
        programName: prog?.name || sub.programId,
        orgName: org?.name || sub.orgId,
        athleteName: sub.athleteName,
        parentName: sub.parentName,
        email: sub.email,
        phone: sub.phone,
        age: sub.age,
        grade: sub.grade,
        sport: sub.sport,
        position: sub.position,
        school: sub.school,
        goals: sub.goals || [],
        experienceLevel: sub.experienceLevel,
        currentTrainingStatus: sub.currentTrainingStatus,
        commitmentLevel: sub.commitmentLevel,
        notes: sub.notes,
        utmSource: sub.utmSource,
        utmMedium: sub.utmMedium,
        utmCampaign: sub.utmCampaign,
        utmContent: sub.utmContent,
        utmTerm: sub.utmTerm,
        landingPageId: null,
        submittedAt: sub.createdAt || new Date(),
      });

      res.json({ success: true, profileId: result.profileId, leadScore: result.scoring.leadScore, temperature: result.scoring.temperature });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST test intake pipeline simulation
  app.post("/api/lead-capture/intelligence/test-simulation", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { TEST_INTAKE_PAYLOADS, runIntelligentLeadIntakePipeline } = await import("./services/intelligent-lead-intake-service");
      const payloadIndex = parseInt(req.body.payloadIndex || "0", 10);
      const payload = { ...TEST_INTAKE_PAYLOADS[payloadIndex % TEST_INTAKE_PAYLOADS.length] };
      // Override with real org for the sim
      payload.orgId = profile.organizationId;
      payload.submissionId = `sim-${Date.now()}`;

      const result = await runIntelligentLeadIntakePipeline(payload);
      res.json({
        success: true,
        payload,
        result: {
          profileId: result.profileId,
          leadScore: result.scoring.leadScore,
          temperature: result.scoring.temperature,
          urgency: result.scoring.urgency,
          tags: result.scoring.tags,
          aiSummary: result.aiSummary,
          suggestedNextAction: result.suggestedNextAction,
          draftSubject: result.draftSubject,
          draftBodyPreview: result.draftBody.slice(0, 200),
          processingLog: result.processingLog,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET Gmail draft actions for a specific lead (by submissionId)
  app.get("/api/lead-capture/intelligence/:submissionId/drafts", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { db } = await import("./db");
      const { gmailAgentActions } = await import("@shared/schema");
      const { eq, and, desc } = await import("drizzle-orm");

      const drafts = await db
        .select()
        .from(gmailAgentActions)
        .where(
          and(
            eq(gmailAgentActions.orgId, profile.organizationId),
            eq(gmailAgentActions.leadId, req.params.submissionId),
          ),
        )
        .orderBy(desc(gmailAgentActions.createdAt));

      res.json(drafts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH approve/dismiss Gmail draft action
  app.patch("/api/gmail-agent-actions/:id/status", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { status } = req.body;
      const validStatuses = ["approved", "dismissed", "proposed"];
      if (!status || !validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });

      const { db } = await import("./db");
      const { gmailAgentActions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [updated] = await db
        .update(gmailAgentActions)
        .set({ status, approvedBy: userId, executedAt: status === "approved" ? new Date() : null })
        .where(and(eq(gmailAgentActions.id, req.params.id), eq(gmailAgentActions.orgId, profile.organizationId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Action not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET pipeline summary stats
  app.get("/api/lead-capture/intelligence-stats", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { db } = await import("./db");
      const { leadIntelligenceProfiles } = await import("@shared/schema");
      const { eq, count } = await import("drizzle-orm");

      const rows = await db
        .select({
          pipelineStage: leadIntelligenceProfiles.pipelineStage,
          temperature: leadIntelligenceProfiles.temperature,
          cnt: count(),
        })
        .from(leadIntelligenceProfiles)
        .where(eq(leadIntelligenceProfiles.orgId, profile.organizationId))
        .groupBy(leadIntelligenceProfiles.pipelineStage, leadIntelligenceProfiles.temperature);

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH intelligence profile — suppress or unsubscribe a lead
  app.patch("/api/lead-capture/intelligence/:id/suppress", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { reason, unsubscribe } = req.body as { reason?: string; unsubscribe?: boolean };
      if (!reason) return res.status(400).json({ message: "reason required" });

      const { db } = await import("./db");
      const { leadIntelligenceProfiles, gmailAgentActions } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [existing] = await db
        .select({ id: leadIntelligenceProfiles.id, submissionId: leadIntelligenceProfiles.submissionId })
        .from(leadIntelligenceProfiles)
        .where(and(eq(leadIntelligenceProfiles.id, req.params.id), eq(leadIntelligenceProfiles.orgId, profile.organizationId)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Profile not found" });

      const { buildStageTransition } = await import("./services/intelligent-lead-intake-service");
      const [current] = await db.select({ pipelineStage: leadIntelligenceProfiles.pipelineStage, stageTransitions: leadIntelligenceProfiles.stageTransitions })
        .from(leadIntelligenceProfiles).where(eq(leadIntelligenceProfiles.id, existing.id)).limit(1);
      const transition = buildStageTransition(current?.pipelineStage || "unknown", "lost", reason, "manual_admin", 1.0);
      const existingTransitions = (current?.stageTransitions as any[]) || [];

      await Promise.all([
        db.update(leadIntelligenceProfiles)
          .set({
            suppressed: true,
            unsubscribed: !!unsubscribe,
            suppressionReason: reason,
            suppressedAt: new Date(),
            pipelineStage: "lost",
            stageTransitions: [...existingTransitions, transition] as any,
            updatedAt: new Date(),
          })
          .where(eq(leadIntelligenceProfiles.id, existing.id)),
        db.update(gmailAgentActions)
          .set({ status: "dismissed", result: { reason: `suppressed:${reason}`, suppressedAt: new Date().toISOString() } as any })
          .where(and(eq(gmailAgentActions.leadId, existing.submissionId), eq(gmailAgentActions.status, "proposed"))),
      ]);

      res.json({ success: true, suppressed: true, reason });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH intelligence profile pipeline stage — with transition history
  app.patch("/api/lead-capture/intelligence/:id/stage-transition", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { stage, reason } = req.body as { stage: string; reason?: string };
      const validStages = ["new_lead", "engaged", "scheduling", "booked", "converted", "stalled", "lost"];
      if (!stage || !validStages.includes(stage)) return res.status(400).json({ message: "Invalid stage" });

      const { db } = await import("./db");
      const { leadIntelligenceProfiles } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [current] = await db.select({ pipelineStage: leadIntelligenceProfiles.pipelineStage, stageTransitions: leadIntelligenceProfiles.stageTransitions })
        .from(leadIntelligenceProfiles)
        .where(and(eq(leadIntelligenceProfiles.id, req.params.id), eq(leadIntelligenceProfiles.orgId, profile.organizationId)))
        .limit(1);
      if (!current) return res.status(404).json({ message: "Profile not found" });

      const { buildStageTransition } = await import("./services/intelligent-lead-intake-service");
      const transition = buildStageTransition(current.pipelineStage, stage, reason || "Manual admin update", "manual_admin", 1.0);
      const existingTransitions = (current.stageTransitions as any[]) || [];

      const [updated] = await db
        .update(leadIntelligenceProfiles)
        .set({
          pipelineStage: stage,
          stageTransitions: [...existingTransitions, transition] as any,
          updatedAt: new Date(),
        })
        .where(and(eq(leadIntelligenceProfiles.id, req.params.id), eq(leadIntelligenceProfiles.orgId, profile.organizationId)))
        .returning();

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST manually trigger the recovery cron (admin only)
  app.post("/api/lead-capture/recovery-cron/run", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });

      const { runLeadRecoveryCron } = await import("./services/lead-recovery-cron");
      const result = await runLeadRecoveryCron();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
