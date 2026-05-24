import type { Express } from "express";
import { db } from "./db";
import crypto from "crypto";
import { createActivityEvent } from "./services/activity-timeline";
import {
  communicationCampaigns,
  communicationMessages,
  communicationPreferences,
  communicationTemplates,
  orgMemberships,
  orgUsers,
  orgSessions,
  athleteStatusSnapshots,
  athleteRiskFlags,
  athleteStreaks,
  workoutCompletionLogs,
  educationProgress,
} from "@shared/schema";
import { eq, and, desc, gte, or, isNull } from "drizzle-orm";
import { z } from "zod";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Auth ─────────────────────────────────────────────────────────────────────
import { requireCoach, requireOrgUser } from "./org-auth";

// ─── Default Templates Seed ───────────────────────────────────────────────────

const DEFAULT_TEMPLATES = [
  {
    templateType: "missed_workout",
    title: "Missed Workout Reminder",
    subject: "We missed you today, {{athleteName}}!",
    body: "Hey {{athleteName}}, looks like you missed your workout today. No worries — getting back on track is what matters. Your next session is ready when you are. Keep pushing forward!",
    variables: ["athleteName"],
    isDefault: true,
  },
  {
    templateType: "low_readiness",
    title: "Low Readiness Encouragement",
    subject: "Recovery check-in for {{athleteName}}",
    body: "Hey {{athleteName}}, your readiness score is showing you might need some extra recovery today. Listen to your body — taking care of yourself is part of the process. Reach out if you need a modified session.",
    variables: ["athleteName", "readinessScore"],
    isDefault: true,
  },
  {
    templateType: "hydration_reminder",
    title: "Hydration Reminder",
    subject: "Stay hydrated, {{athleteName}}!",
    body: "Quick reminder, {{athleteName}} — hydration directly impacts your performance and recovery. Make sure you're hitting your daily water goals. Your body and your numbers will thank you.",
    variables: ["athleteName"],
    isDefault: true,
  },
  {
    templateType: "education_overdue",
    title: "Education Module Overdue",
    subject: "Complete your learning pathway, {{athleteName}}",
    body: "Hey {{athleteName}}, you have a learning module waiting for you: '{{moduleName}}'. Athletes who complete their education pathways consistently see better results. Take 5 minutes today to check it off!",
    variables: ["athleteName", "moduleName"],
    isDefault: true,
  },
  {
    templateType: "pr_celebration",
    title: "PR Celebration",
    subject: "New PR alert — crushing it, {{athleteName}}!",
    body: "🎉 Big shoutout to {{athleteName}} for hitting a new personal record on {{liftName}}: {{prValue}}{{unit}}! This is what the work is for. Keep that momentum going!",
    variables: ["athleteName", "liftName", "prValue", "unit"],
    isDefault: true,
  },
  {
    templateType: "streak_milestone",
    title: "Streak Milestone",
    subject: "{{streakDays}}-day streak — incredible work, {{athleteName}}!",
    body: "{{athleteName}}, you've hit a {{streakDays}}-day training streak! That kind of consistency is what separates good athletes from great ones. We're proud of your dedication — keep it going!",
    variables: ["athleteName", "streakDays"],
    isDefault: true,
  },
  {
    templateType: "coach_followup",
    title: "Coach Follow-Up Request",
    subject: "Quick check-in from your coach",
    body: "Hey {{athleteName}}, your coach wanted to touch base with you. How are you feeling about your training lately? Reply with any questions, feedback, or anything you'd like to work on. We're here for you.",
    variables: ["athleteName", "coachName"],
    isDefault: true,
  },
  {
    templateType: "intervention_reminder",
    title: "Intervention Follow-Up",
    subject: "Follow-up on your recent check-in, {{athleteName}}",
    body: "Hi {{athleteName}}, following up on our recent conversation. We want to make sure you're feeling supported in your training. Don't hesitate to reach out — your progress matters to us.",
    variables: ["athleteName"],
    isDefault: true,
  },
  {
    templateType: "upcoming_session",
    title: "Upcoming Session Reminder",
    subject: "Your session is tomorrow, {{athleteName}}!",
    body: "Hey {{athleteName}}, just a reminder that you have a training session coming up tomorrow. Make sure you're getting good sleep tonight, eating well, and staying hydrated. See you there!",
    variables: ["athleteName", "sessionTime"],
    isDefault: true,
  },
  {
    templateType: "recovery_encouragement",
    title: "Recovery Encouragement",
    subject: "Rest day reminder — recovery is training too",
    body: "Hey {{athleteName}}, today is your designated recovery day. Recovery is where the adaptation happens — prioritize sleep, nutrition, and light movement. You're doing great work. See you next session!",
    variables: ["athleteName"],
    isDefault: true,
  },
];

async function ensureDefaultTemplates() {
  const existing = await db
    .select()
    .from(communicationTemplates)
    .where(and(isNull(communicationTemplates.orgId), eq(communicationTemplates.isDefault, true)))
    .limit(1);
  if (existing.length > 0) return;

  for (const tmpl of DEFAULT_TEMPLATES) {
    await db.insert(communicationTemplates).values(tmpl as any).onConflictDoNothing();
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function registerCoachOutreachEngineRoutes(app: Express) {
  // Seed templates on startup
  ensureDefaultTemplates().catch(console.error);

  // GET /api/org/communications — message history
  app.get("/api/org/communications", requireCoach, async (req: any, res) => {
    try {
      const { orgId } = req._orgAuth;
      const { status, messageType, limit: limitQ } = req.query as any;
      const limitN = Math.min(parseInt(limitQ ?? "50"), 200);

      const conds: any[] = [eq(communicationMessages.orgId, orgId)];
      if (status) conds.push(eq(communicationMessages.status, status));
      if (messageType) conds.push(eq(communicationMessages.messageType, messageType));

      const msgs = await db
        .select()
        .from(communicationMessages)
        .where(and(...conds))
        .orderBy(desc(communicationMessages.createdAt))
        .limit(limitN);

      // Enrich with recipient names
      const enriched = await Promise.all(
        msgs.map(async (m) => {
          if (!m.recipientUserId) return { ...m, recipientName: null };
          const [user] = await db.select().from(orgUsers).where(eq(orgUsers.id, m.recipientUserId)).limit(1);
          return { ...m, recipientName: user?.name ?? null };
        })
      );

      // Delivery analytics
      const total = enriched.length;
      const sent = enriched.filter((m) => m.status === "sent").length;
      const read = enriched.filter((m) => m.readAt != null).length;

      res.json({
        messages: enriched,
        analytics: {
          total,
          sent,
          read,
          openRate: sent > 0 ? Math.round((read / sent) * 100) : 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/org/communications/send — send a message
  app.post("/api/org/communications/send", requireCoach, async (req: any, res) => {
    try {
      const { orgId, userId } = req._orgAuth;

      const schema = z.object({
        recipientUserId: z.string().optional(),
        recipientType: z.enum(["athlete", "team", "guardian", "coach"]).default("athlete"),
        channel: z.enum(["in_app", "email", "sms"]).default("in_app"),
        messageType: z.string().default("manual"),
        subject: z.string().optional(),
        body: z.string().min(1),
        campaignId: z.string().optional(),
        aiGenerated: z.boolean().default(false),
        scheduledAt: z.string().optional(),
        actionSource: z.string().optional(),
      });

      const body = schema.parse(req.body);

      const [msg] = await db
        .insert(communicationMessages)
        .values({
          orgId,
          ...body,
          sentBy: userId,
          status: body.scheduledAt ? "scheduled" : "sent",
          sentAt: body.scheduledAt ? undefined : new Date(),
        })
        .returning();

      // Create in-app notification if channel is in_app and we have a recipient
      if (body.channel === "in_app" && body.recipientUserId) {
        const { sql: drizzleSql } = await import("drizzle-orm");
        await db.execute(
          drizzleSql`
            INSERT INTO org_notifications (org_id, user_id, type, title, message, action_url, metadata)
            SELECT ${orgId}, ${body.recipientUserId}, 'coach_message',
                   ${body.subject ?? "New message from coach"}, ${body.body.slice(0, 300)},
                   '/notifications', ${{ messageId: msg.id }}::jsonb
          `
        );
      }

      createActivityEvent({
        orgId,
        userId: body.recipientUserId,
        sourceType: "message",
        sourceId: msg.id,
        eventType: "message_sent",
        title: body.subject ? `Message sent: ${body.subject}` : "Direct message sent",
        description: body.body.slice(0, 200),
        metadata: {
          messageId: msg.id,
          channel: body.channel,
          messageType: body.messageType,
          actionSource: body.actionSource,
        },
        visibility: "coach",
      }).catch(() => {});

      res.json({ message: msg });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // POST /api/org/communications/ai-generate — AI message generation
  app.post("/api/org/communications/ai-generate", requireCoach, async (req: any, res) => {
    try {
      const { orgId, userId } = req._orgAuth;

      const schema = z.object({
        athleteUserId: z.string(),
        messageType: z.string(),
        context: z.record(z.any()).optional(),
        generateGuardianSummary: z.boolean().default(false),
      });

      const body = schema.parse(req.body);

      // Gather athlete context
      const [athlete] = await db.select().from(orgUsers).where(eq(orgUsers.id, body.athleteUserId)).limit(1);
      const athleteName = athlete?.name ?? "the athlete";

      const [snapshot] = await db
        .select()
        .from(athleteStatusSnapshots)
        .where(and(eq(athleteStatusSnapshots.orgId, orgId), eq(athleteStatusSnapshots.athleteUserId, body.athleteUserId)))
        .orderBy(desc(athleteStatusSnapshots.generatedAt))
        .limit(1);

      const activeFlags = await db
        .select()
        .from(athleteRiskFlags)
        .where(and(eq(athleteRiskFlags.orgId, orgId), eq(athleteRiskFlags.athleteUserId, body.athleteUserId), eq(athleteRiskFlags.status, "active")))
        .limit(5);

      const [streak] = await db
        .select()
        .from(athleteStreaks)
        .where(and(eq(athleteStreaks.orgId, orgId), eq(athleteStreaks.athleteUserId, body.athleteUserId)))
        .limit(1);

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentWorkouts = await db
        .select()
        .from(workoutCompletionLogs)
        .where(and(eq(workoutCompletionLogs.orgId, orgId), eq(workoutCompletionLogs.athleteUserId, body.athleteUserId), gte(workoutCompletionLogs.completedAt, sevenDaysAgo)));

      const prompt = `You are an AI coaching assistant for a strength and conditioning platform.

Generate a personalized, supportive message for the following athlete situation.

ATHLETE: ${athleteName}
MESSAGE TYPE: ${body.messageType}
STATUS SCORE: ${snapshot?.statusScore ?? "N/A"}
RISK LEVEL: ${snapshot?.riskLevel ?? "N/A"}
READINESS SCORE: ${snapshot?.readinessScore ?? "N/A"}
CURRENT STREAK: ${streak?.currentStreak ?? 0} days
WORKOUTS (7 days): ${recentWorkouts.length}
ACTIVE FLAGS: ${activeFlags.map((f) => f.title).join(", ") || "None"}
ADDITIONAL CONTEXT: ${JSON.stringify(body.context ?? {})}

Return a JSON object with:
{
  "athleteMessage": {
    "subject": "string",
    "body": "string"
  },
  "coachSummary": "string",
  ${body.generateGuardianSummary ? '"guardianSummary": "string",' : ""}
  "tone": "string",
  "urgency": "low|medium|high"
}

Rules:
- Encouraging, supportive tone for athlete messages
- No medical claims or alarming language
- Focus on performance and development
- Keep athlete message concise (2-3 sentences)
- Coach summary: 1 sentence operational context`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 600,
      });

      const result = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
      res.json({ generated: result, athleteName });
    } catch (err: any) {
      console.error("AI generate error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/org/communications/templates — get all templates (default + org-specific)
  app.get("/api/org/communications/templates", requireCoach, async (req: any, res) => {
    try {
      const { orgId } = req._orgAuth;

      const templates = await db
        .select()
        .from(communicationTemplates)
        .where(or(isNull(communicationTemplates.orgId), eq(communicationTemplates.orgId, orgId)))
        .orderBy(desc(communicationTemplates.isDefault), desc(communicationTemplates.createdAt));

      res.json({ templates });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/org/communications/templates — create org template
  app.post("/api/org/communications/templates", requireCoach, async (req: any, res) => {
    try {
      const { orgId } = req._orgAuth;
      const schema = z.object({
        templateType: z.string(),
        title: z.string().min(1),
        subject: z.string().optional(),
        body: z.string().min(1),
        variables: z.array(z.string()).optional(),
      });
      const body = schema.parse(req.body);
      const [tmpl] = await db
        .insert(communicationTemplates)
        .values({ ...body, orgId, variables: body.variables ?? [], isDefault: false })
        .returning();
      res.json({ template: tmpl });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // PATCH /api/org/communications/preferences — update delivery preferences
  app.patch("/api/org/communications/preferences", requireOrgUser, async (req: any, res) => {
    try {
      const { orgId, userId } = req._orgAuth;
      const schema = z.object({
        emailEnabled: z.boolean().optional(),
        smsEnabled: z.boolean().optional(),
        inAppEnabled: z.boolean().optional(),
        guardianEnabled: z.boolean().optional(),
        quietHoursStart: z.number().optional(),
        quietHoursEnd: z.number().optional(),
      });
      const body = schema.parse(req.body);

      // Upsert preferences
      const existing = await db
        .select()
        .from(communicationPreferences)
        .where(and(eq(communicationPreferences.orgId, orgId), eq(communicationPreferences.userId, userId)))
        .limit(1);

      let prefs;
      if (existing.length === 0) {
        [prefs] = await db.insert(communicationPreferences).values({ orgId, userId, ...body }).returning();
      } else {
        [prefs] = await db
          .update(communicationPreferences)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(communicationPreferences.id, existing[0].id))
          .returning();
      }

      res.json({ preferences: prefs });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // GET /api/org/communications/preferences — get own preferences
  app.get("/api/org/communications/preferences", requireOrgUser, async (req: any, res) => {
    try {
      const { orgId, userId } = req._orgAuth;
      const [prefs] = await db
        .select()
        .from(communicationPreferences)
        .where(and(eq(communicationPreferences.orgId, orgId), eq(communicationPreferences.userId, userId)))
        .limit(1);
      res.json({ preferences: prefs ?? null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/org/communications/campaigns — list campaigns
  app.get("/api/org/communications/campaigns", requireCoach, async (req: any, res) => {
    try {
      const { orgId } = req._orgAuth;
      const campaigns = await db
        .select()
        .from(communicationCampaigns)
        .where(eq(communicationCampaigns.orgId, orgId))
        .orderBy(desc(communicationCampaigns.createdAt))
        .limit(50);
      res.json({ campaigns });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/org/communications/campaigns — create campaign
  app.post("/api/org/communications/campaigns", requireCoach, async (req: any, res) => {
    try {
      const { orgId, userId } = req._orgAuth;
      const schema = z.object({
        title: z.string().min(1),
        type: z.string().default("manual"),
        audienceFilter: z.record(z.any()).optional(),
        scheduledAt: z.string().optional(),
      });
      const body = schema.parse(req.body);
      const [campaign] = await db
        .insert(communicationCampaigns)
        .values({
          orgId,
          createdBy: userId,
          ...body,
          audienceFilter: body.audienceFilter ?? {},
        })
        .returning();
      res.json({ campaign });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // GET /api/org/communications/inbox — athlete's incoming messages
  app.get("/api/org/communications/inbox", requireOrgUser, async (req: any, res) => {
    try {
      const { orgId, userId } = req._orgAuth;
      const msgs = await db
        .select()
        .from(communicationMessages)
        .where(
          and(
            eq(communicationMessages.orgId, orgId),
            eq(communicationMessages.recipientUserId, userId),
            eq(communicationMessages.status, "sent"),
          )
        )
        .orderBy(desc(communicationMessages.createdAt))
        .limit(50);

      const unreadCount = msgs.filter((m) => !m.readAt).length;
      res.json({ messages: msgs, unreadCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/org/communications/:id/read — mark as read
  app.patch("/api/org/communications/:id/read", requireOrgUser, async (req: any, res) => {
    try {
      const { orgId, userId } = req._orgAuth;
      const { id } = req.params;
      const [msg] = await db
        .update(communicationMessages)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(communicationMessages.id, id),
            eq(communicationMessages.orgId, orgId),
            eq(communicationMessages.recipientUserId, userId),
          )
        )
        .returning();
      if (!msg) return res.status(404).json({ message: "Not found" });
      res.json({ message: msg });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
