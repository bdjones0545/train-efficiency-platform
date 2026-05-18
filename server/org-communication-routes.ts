import type { Express } from "express";
import { db } from "./db";
import {
  orgMessages,
  orgMessageReads,
  orgNotifications,
  notificationAutomationLogs,
  userProfiles,
  prTeamMembers,
} from "@shared/schema";
import { eq, and, desc, inArray, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { triggerNotificationEvent, type NotificationEventType } from "./services/notification-automation";

function getUserId(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? null;
}

async function getOrgProfile(req: any) {
  const userId = getUserId(req);
  if (!userId) return null;
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return profile ?? null;
}

function requireAuth(req: any, res: any, next: any) {
  (async () => {
    const profile = await getOrgProfile(req);
    if (!profile) return res.status(401).json({ message: "Unauthorized" });
    (req as any)._profile = profile;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

function requireCoachOrAdmin(req: any, res: any, next: any) {
  (async () => {
    const profile = await getOrgProfile(req);
    if (!profile) return res.status(401).json({ message: "Unauthorized" });
    if (!["ADMIN", "COACH"].includes(profile.role ?? "")) return res.status(403).json({ message: "Coach or Admin required" });
    (req as any)._profile = profile;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

// ─── Helper: create notification ─────────────────────────────────────────────

export async function createNotification(data: {
  orgId: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
}) {
  const [n] = await db.insert(orgNotifications).values(data).returning();
  return n;
}

// ─── Routes ────────────────────────────────────────────────────────────────────

export function registerOrgCommunicationRoutes(app: Express) {

  // GET /api/org/messages — inbox for current user (direct + team announcements they belong to)
  app.get("/api/org/messages", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;
      const userId = profile.userId;

      // Get team memberships
      const teamMemberships = await db.select().from(prTeamMembers).where(eq(prTeamMembers.userId, userId));
      const teamIds = teamMemberships.map((m) => m.teamId);

      // Fetch direct messages and team announcements
      const msgs = await db.select().from(orgMessages).where(
        and(
          eq(orgMessages.orgId, orgId),
          or(
            eq(orgMessages.recipientUserId, userId),
            eq(orgMessages.messageType, "system"),
            ...(teamIds.length > 0 ? [inArray(orgMessages.teamId, teamIds)] : [])
          )
        )
      ).orderBy(desc(orgMessages.createdAt)).limit(50);

      // Fetch read receipts for this user
      const msgIds = msgs.map((m) => m.id);
      const reads = msgIds.length > 0
        ? await db.select().from(orgMessageReads).where(
            and(eq(orgMessageReads.userId, userId), inArray(orgMessageReads.messageId, msgIds))
          )
        : [];
      const readSet = new Set(reads.filter((r) => r.readAt).map((r) => r.messageId));

      // Fetch sender profiles
      const senderIds = [...new Set(msgs.map((m) => m.senderUserId))];
      const senderProfiles = senderIds.length > 0
        ? await db.select().from(userProfiles).where(inArray(userProfiles.userId, senderIds))
        : [];
      const senderMap = Object.fromEntries(senderProfiles.map((p) => [p.userId, p]));

      const result = msgs.map((m) => ({
        ...m,
        isRead: readSet.has(m.id),
        sender: senderMap[m.senderUserId] ?? null,
      }));

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/org/messages/sent — sent messages (coach only)
  app.get("/api/org/messages/sent", requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const msgs = await db.select().from(orgMessages).where(
        and(eq(orgMessages.orgId, profile.organizationId), eq(orgMessages.senderUserId, profile.userId))
      ).orderBy(desc(orgMessages.createdAt)).limit(50);
      res.json(msgs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/org/messages — send message (coach/admin only)
  app.post("/api/org/messages", requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const schema = z.object({
        recipientUserId: z.string().optional(),
        teamId: z.string().optional(),
        messageType: z.enum(["direct", "team_announcement", "system"]).default("direct"),
        subject: z.string().optional(),
        body: z.string().min(1),
      });
      const body = schema.parse(req.body);

      if (body.messageType === "direct" && !body.recipientUserId) {
        return res.status(400).json({ message: "recipientUserId required for direct messages" });
      }
      if (body.messageType === "team_announcement" && !body.teamId) {
        return res.status(400).json({ message: "teamId required for team announcements" });
      }

      const [msg] = await db.insert(orgMessages).values({
        orgId: profile.organizationId,
        senderUserId: profile.userId,
        ...body,
      }).returning();

      // Auto-create notification(s) for recipients
      if (body.messageType === "direct" && body.recipientUserId) {
        await createNotification({
          orgId: profile.organizationId,
          userId: body.recipientUserId,
          type: "coach_message",
          title: body.subject ?? "New message from coach",
          message: body.body.slice(0, 200),
          actionUrl: `/notifications`,
          metadata: { messageId: msg.id, senderUserId: profile.userId },
        });
      } else if (body.messageType === "team_announcement" && body.teamId) {
        // Notify all team members
        const members = await db.select().from(prTeamMembers).where(eq(prTeamMembers.teamId, body.teamId));
        for (const member of members) {
          if (member.userId === profile.userId) continue;
          await createNotification({
            orgId: profile.organizationId,
            userId: member.userId,
            type: "team_announcement",
            title: body.subject ?? "Team announcement",
            message: body.body.slice(0, 200),
            actionUrl: `/notifications`,
            metadata: { messageId: msg.id, teamId: body.teamId },
          });
        }
      }

      res.json(msg);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // PATCH /api/org/messages/:id/read
  app.patch("/api/org/messages/:id/read", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { id } = req.params;

      // Upsert read receipt
      const existing = await db.select().from(orgMessageReads).where(
        and(eq(orgMessageReads.messageId, id), eq(orgMessageReads.userId, profile.userId))
      ).limit(1);

      if (existing.length === 0) {
        await db.insert(orgMessageReads).values({
          orgId: profile.organizationId,
          messageId: id,
          userId: profile.userId,
          readAt: new Date(),
        });
      } else if (!existing[0].readAt) {
        await db.update(orgMessageReads)
          .set({ readAt: new Date() })
          .where(eq(orgMessageReads.id, existing[0].id));
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/org/notifications
  app.get("/api/org/notifications", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { type, unreadOnly } = req.query as any;
      const conditions = [
        eq(orgNotifications.orgId, profile.organizationId),
        eq(orgNotifications.userId, profile.userId),
      ];
      if (type) conditions.push(eq(orgNotifications.type, type));
      if (unreadOnly === "true") conditions.push(eq(orgNotifications.isRead, false));

      const notifications = await db.select().from(orgNotifications)
        .where(and(...conditions))
        .orderBy(desc(orgNotifications.createdAt))
        .limit(100);

      const unreadCount = notifications.filter((n) => !n.isRead).length;
      res.json({ notifications, unreadCount });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // PATCH /api/org/notifications/:id/read
  app.patch("/api/org/notifications/:id/read", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { id } = req.params;
      const [n] = await db.update(orgNotifications)
        .set({ isRead: true })
        .where(and(eq(orgNotifications.id, id), eq(orgNotifications.userId, profile.userId), eq(orgNotifications.orgId, profile.organizationId)))
        .returning();
      if (!n) return res.status(404).json({ message: "Not found" });
      res.json(n);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/org/notifications/mark-all-read
  app.post("/api/org/notifications/mark-all-read", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      await db.update(orgNotifications)
        .set({ isRead: true })
        .where(and(eq(orgNotifications.userId, profile.userId), eq(orgNotifications.orgId, profile.organizationId), eq(orgNotifications.isRead, false)));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/org/notifications/system-event — internal use: create notification from any system
  app.post("/api/org/notifications/system-event", requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const schema = z.object({
        userId: z.string(),
        type: z.string(),
        title: z.string(),
        message: z.string(),
        actionUrl: z.string().optional(),
        metadata: z.record(z.any()).optional(),
      });
      const body = schema.parse(req.body);
      const n = await createNotification({
        orgId: profile.organizationId,
        ...body,
      });
      res.json(n);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // POST /api/org/notifications/trigger-event — trigger automation event (admin)
  app.post("/api/org/notifications/trigger-event", requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const schema = z.object({
        eventType: z.string(),
        userId: z.string().optional(),
        coachUserId: z.string().optional(),
        teamId: z.string().optional(),
        programId: z.string().optional(),
        programName: z.string().optional(),
        athleteName: z.string().optional(),
        readinessScore: z.number().optional(),
        fatigueLevel: z.number().optional(),
        liftName: z.string().optional(),
        liftValue: z.number().optional(),
        liftUnit: z.string().optional(),
        previousBest: z.number().optional(),
        improvementPct: z.number().optional(),
        highlightTitle: z.string().optional(),
        metadata: z.record(z.any()).optional(),
      });
      const body = schema.parse(req.body);
      const result = await triggerNotificationEvent(body.eventType as NotificationEventType, {
        orgId: profile.organizationId,
        ...body,
      });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // GET /api/org/notifications/automation-logs — debugging + event trace
  app.get("/api/org/notifications/automation-logs", requireCoachOrAdmin, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { eventType, limit: limitQ } = req.query as any;
      const limitN = Math.min(parseInt(limitQ ?? "50"), 200);

      const conds: any[] = [eq(notificationAutomationLogs.orgId, profile.organizationId)];
      if (eventType) conds.push(eq(notificationAutomationLogs.eventType, eventType));

      const logs = await db.select().from(notificationAutomationLogs)
        .where(and(...conds))
        .orderBy(desc(notificationAutomationLogs.createdAt))
        .limit(limitN);

      res.json({ logs, total: logs.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
