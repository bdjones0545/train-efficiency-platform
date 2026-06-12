import type { Express } from "express";
import { db } from "./db";
import { eq, desc, and, gte } from "drizzle-orm";
import { orgEmailNotificationSettings, communicationLogs } from "@shared/schema";
import crypto from "crypto";

function isAuthenticated(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
}

function requireRole(...roles: string[]) {
  return (req: any, res: any, next: any) => {
    const userRole = req.user?.claims?.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}

export async function registerEmailNotificationRoutes(app: Express) {
  // Ensure table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS org_email_notification_settings (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL UNIQUE,
      athlete_booking_confirmation boolean NOT NULL DEFAULT true,
      athlete_recurring_confirmation boolean NOT NULL DEFAULT true,
      athlete_reschedule boolean NOT NULL DEFAULT true,
      athlete_cancellation boolean NOT NULL DEFAULT true,
      athlete_reminder boolean NOT NULL DEFAULT true,
      admin_new_booking boolean NOT NULL DEFAULT true,
      admin_recurring_booking boolean NOT NULL DEFAULT false,
      admin_reschedule boolean NOT NULL DEFAULT true,
      admin_cancellation boolean NOT NULL DEFAULT true,
      dedup_window_minutes integer NOT NULL DEFAULT 15,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `).catch(() => {});

  // GET notification settings for the org
  app.get("/api/admin/email-notification-settings", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { storage } = await import("./storage");
      const profile = await storage.getCoachProfileByUserId(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(403).json({ message: "Organization not found for session" });

      const [existing] = await db
        .select()
        .from(orgEmailNotificationSettings)
        .where(eq(orgEmailNotificationSettings.orgId, orgId));

      if (existing) return res.json(existing);

      // Return defaults if not set
      res.json({
        orgId,
        athleteBookingConfirmation: true,
        athleteRecurringConfirmation: true,
        athleteReschedule: true,
        athleteCancellation: true,
        athleteReminder: true,
        adminNewBooking: true,
        adminRecurringBooking: false,
        adminReschedule: true,
        adminCancellation: true,
        dedupWindowMinutes: 15,
      });
    } catch (err) {
      console.error("[GET /api/admin/email-notification-settings]", err);
      res.status(500).json({ message: "Failed to fetch notification settings" });
    }
  });

  // PUT (upsert) notification settings
  app.put("/api/admin/email-notification-settings", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { storage } = await import("./storage");
      const profile = await storage.getCoachProfileByUserId(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization found" });

      const {
        athleteBookingConfirmation,
        athleteRecurringConfirmation,
        athleteReschedule,
        athleteCancellation,
        athleteReminder,
        adminNewBooking,
        adminRecurringBooking,
        adminReschedule,
        adminCancellation,
        dedupWindowMinutes,
      } = req.body;

      const [existing] = await db
        .select({ id: orgEmailNotificationSettings.id })
        .from(orgEmailNotificationSettings)
        .where(eq(orgEmailNotificationSettings.orgId, orgId));

      const data: any = {
        orgId,
        athleteBookingConfirmation: athleteBookingConfirmation ?? true,
        athleteRecurringConfirmation: athleteRecurringConfirmation ?? true,
        athleteReschedule: athleteReschedule ?? true,
        athleteCancellation: athleteCancellation ?? true,
        athleteReminder: athleteReminder ?? true,
        adminNewBooking: adminNewBooking ?? true,
        adminRecurringBooking: adminRecurringBooking ?? false,
        adminReschedule: adminReschedule ?? true,
        adminCancellation: adminCancellation ?? true,
        dedupWindowMinutes: dedupWindowMinutes ?? 15,
        updatedAt: new Date(),
      };

      let result;
      if (existing) {
        const [updated] = await db
          .update(orgEmailNotificationSettings)
          .set(data)
          .where(eq(orgEmailNotificationSettings.orgId, orgId))
          .returning();
        result = updated;
      } else {
        const [inserted] = await db
          .insert(orgEmailNotificationSettings)
          .values({ id: crypto.randomUUID(), ...data })
          .returning();
        result = inserted;
      }

      res.json(result);
    } catch (err) {
      console.error("[PUT /api/admin/email-notification-settings]", err);
      res.status(500).json({ message: "Failed to save notification settings" });
    }
  });

  // GET notification audit log (recent communication_logs with status breakdown)
  app.get("/api/admin/notification-audit", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { storage } = await import("./storage");
      const profile = await storage.getCoachProfileByUserId(userId);
      const orgId = profile?.organizationId;
      if (!orgId) return res.status(400).json({ message: "No organization found" });

      const limit = Math.min(parseInt(req.query.limit as string || "100"), 500);
      const since = req.query.since
        ? new Date(req.query.since as string)
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const logs = await db
        .select()
        .from(communicationLogs)
        .where(
          and(
            eq(communicationLogs.orgId, orgId),
            gte(communicationLogs.createdAt, since)
          )
        )
        .orderBy(desc(communicationLogs.createdAt))
        .limit(limit);

      // Aggregate counts by type and status
      const summary: Record<string, { sent: number; skipped: number; deduped: number; failed: number }> = {};
      for (const log of logs) {
        const key = log.type || "unknown";
        if (!summary[key]) summary[key] = { sent: 0, skipped: 0, deduped: 0, failed: 0 };
        const status = log.status as string;
        if (status === "sent") summary[key].sent++;
        else if (status === "skipped") summary[key].skipped++;
        else if (status === "deduped") summary[key].deduped++;
        else if (status === "failed") summary[key].failed++;
      }

      res.json({ logs, summary });
    } catch (err) {
      console.error("[GET /api/admin/notification-audit]", err);
      res.status(500).json({ message: "Failed to fetch notification audit" });
    }
  });
}
