import type { Express } from "express";
import { db } from "./db";
import { eq, desc, and, gte } from "drizzle-orm";
import { orgEmailNotificationSettings, communicationLogs } from "@shared/schema";
import crypto from "crypto";
import { isAuthenticated } from "./replit_integrations/auth";
import { requireRole } from "./lib/require-role";
import { handleOrgError, resolveOrgIdOrThrow } from "./lib/resolve-org-id";

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
      const orgId = await resolveOrgIdOrThrow(req);

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
      if (handleOrgError(err, res)) return;
      console.error("[GET /api/admin/email-notification-settings]", err);
      res.status(500).json({ message: "Failed to fetch notification settings" });
    }
  });

  // PUT (upsert) notification settings
  app.put("/api/admin/email-notification-settings", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);

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
      if (handleOrgError(err, res)) return;
      console.error("[PUT /api/admin/email-notification-settings]", err);
      res.status(500).json({ message: "Failed to save notification settings" });
    }
  });

  // GET notification audit log (recent communication_logs with status breakdown)
  app.get("/api/admin/notification-audit", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);

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
      if (handleOrgError(err, res)) return;
      console.error("[GET /api/admin/notification-audit]", err);
      res.status(500).json({ message: "Failed to fetch notification audit" });
    }
  });
}
