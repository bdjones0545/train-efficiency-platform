import type { Express } from "express";
import { db } from "./db";
import crypto from "crypto";
import {
  adaptiveWorkflows, adaptiveWorkflowSteps, adaptiveWorkflowRuns, adaptiveFollowups,
  athleteRiskFlags, athleteInterventionRecommendations, athleteStatusSnapshots,
  orgMemberships, orgSessions, orgUsers, orgNotifications,
  workoutReadinessCheckins, workoutCompletionLogs, educationProgress, educationModules,
  prLiftEntries, orgActivityEvents,
} from "@shared/schema";
import { eq, and, desc, gte, gt, lt, lte, sql as drizzleSql } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Auth (same session pattern as other org routes) ──────────────────────────
async function resolveOrgSession(req: any) {
  const token = req.headers["x-org-auth-token"] as string | undefined;
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const [session] = await db.select().from(orgSessions)
    .where(and(eq(orgSessions.tokenHash, tokenHash), gt(orgSessions.expiresAt, now))).limit(1);
  if (!session) return null;
  const [membership] = await db.select().from(orgMemberships)
    .where(and(eq(orgMemberships.userId, session.userId), eq(orgMemberships.orgId, session.orgId))).limit(1);
  if (!membership) return null;
  return { userId: session.userId, orgId: session.orgId, role: membership.role };
}

function requireCoach(req: any, res: any, next: any) {
  resolveOrgSession(req).then((auth) => {
    if (!auth) return res.status(401).json({ message: "Not authenticated" });
    if (!["admin", "coach", "staff"].includes(auth.role))
      return res.status(403).json({ message: "Coach access required" });
    req._orgAuth = auth;
    next();
  }).catch(() => res.status(500).json({ message: "Auth error" }));
}

// ─── Built-in Workflow Templates ──────────────────────────────────────────────
const WORKFLOW_TEMPLATES = [
  {
    templateKey: "low_readiness_recovery",
    title: "Low Readiness Recovery",
    description: "Triggers when an athlete records 3+ low readiness scores in 7 days. Creates a recovery plan, assigns education, and schedules a follow-up.",
    triggerType: "low_readiness",
    triggerConfig: { threshold: 4, count: 3, windowDays: 7 },
    steps: [
      { stepOrder: 1, actionType: "notify", config: { target: "coach", message: "Athlete is showing consistent low readiness. Review and support recommended." } },
      { stepOrder: 2, actionType: "create_intervention", config: { recommendationType: "recovery", title: "Recovery Support", summary: "3+ low readiness scores detected this week.", suggestedAction: "Schedule a recovery day and reduce training intensity.", severity: "important" } },
      { stepOrder: 3, actionType: "assign_education", config: { category: "recovery", message: "Recovery techniques assigned to support your training." } },
      { stepOrder: 4, actionType: "notify", config: { target: "athlete", message: "Your coach has set up a recovery plan for you. Check your education and upcoming sessions." } },
      { stepOrder: 5, actionType: "schedule_followup", config: { daysFromNow: 5, notes: "Check if readiness scores have improved." } },
    ],
  },
  {
    templateKey: "missed_workout_intervention",
    title: "Missed Workout Intervention",
    description: "Triggers when an athlete has no workout completions in 14 days. Sends reminders, assigns accountability education, and notifies coach.",
    triggerType: "missed_workouts",
    triggerConfig: { missingDays: 14 },
    steps: [
      { stepOrder: 1, actionType: "notify", config: { target: "athlete", message: "We noticed you haven't logged a workout in a while. Let's get back on track!" } },
      { stepOrder: 2, actionType: "assign_education", config: { category: "training_habits", message: "A module on building consistent training habits has been assigned for you." } },
      { stepOrder: 3, actionType: "schedule_followup", config: { daysFromNow: 3, notes: "Check if athlete has resumed training." } },
      { stepOrder: 4, actionType: "notify", config: { target: "coach", message: "Athlete has missed workouts for 14+ days. Consider a direct check-in." } },
    ],
  },
  {
    templateKey: "hydration_concern",
    title: "Hydration Concern",
    description: "Triggers on high fatigue + low readiness patterns often linked to hydration. Adds reminders and education.",
    triggerType: "fatigue",
    triggerConfig: { threshold: 7, count: 3, windowDays: 7 },
    steps: [
      { stepOrder: 1, actionType: "notify", config: { target: "athlete", message: "Reminder: Staying hydrated improves performance and recovery. Track your water intake today!" } },
      { stepOrder: 2, actionType: "assign_education", config: { category: "hydration", message: "A hydration & performance module has been added to your education queue." } },
      { stepOrder: 3, actionType: "create_intervention", config: { recommendationType: "hydration", title: "Hydration Check", summary: "High fatigue trend may be linked to hydration.", suggestedAction: "Review daily water intake with the athlete.", severity: "moderate" } },
    ],
  },
  {
    templateKey: "education_noncompliance",
    title: "Education Noncompliance",
    description: "Triggers when education completion drops below 40%. Assigns a catch-up plan and notifies coach.",
    triggerType: "education_noncompliance",
    triggerConfig: { scoreThreshold: 40 },
    steps: [
      { stepOrder: 1, actionType: "notify", config: { target: "athlete", message: "You have some education modules waiting! Complete them to keep your program on track." } },
      { stepOrder: 2, actionType: "notify", config: { target: "coach", message: "Athlete's education completion is below 40%. Consider assigning key pathways." } },
      { stepOrder: 3, actionType: "schedule_followup", config: { daysFromNow: 7, notes: "Check if education compliance has improved." } },
    ],
  },
  {
    templateKey: "pr_plateau_review",
    title: "PR Plateau Review",
    description: "Triggers when no new PR is logged for 45 days. Recommends a program review and coach session.",
    triggerType: "pr_stagnation",
    triggerConfig: { stallDays: 45 },
    steps: [
      { stepOrder: 1, actionType: "coach_review", config: { topic: "Program Review", notes: "Athlete may benefit from programming changes to break through plateau." } },
      { stepOrder: 2, actionType: "create_intervention", config: { recommendationType: "workout_adjustment", title: "Program Review Suggested", summary: "No new PRs in 45+ days.", suggestedAction: "Schedule a coach review session and evaluate current programming.", severity: "moderate" } },
      { stepOrder: 3, actionType: "notify", config: { target: "coach", message: "This athlete hasn't logged a new PR in 45 days. A program review is recommended." } },
    ],
  },
  {
    templateKey: "athlete_disengagement",
    title: "Athlete Disengagement",
    description: "Triggers when portal engagement is critically low. Sends encouraging messages and assigns motivational content.",
    triggerType: "low_engagement",
    triggerConfig: { scoreThreshold: 35 },
    steps: [
      { stepOrder: 1, actionType: "notify", config: { target: "athlete", message: "We miss seeing you! Your coach has some great resources to help you stay on track." } },
      { stepOrder: 2, actionType: "assign_education", config: { category: "motivation", message: "A motivational module has been assigned to help you build momentum." } },
      { stepOrder: 3, actionType: "schedule_followup", config: { daysFromNow: 7, notes: "Check if athlete re-engagement has improved." } },
      { stepOrder: 4, actionType: "notify", config: { target: "coach", message: "Athlete engagement has been critically low. Consider a personal outreach." } },
    ],
  },
  {
    templateKey: "high_fatigue_deload",
    title: "High Fatigue Deload Recommendation",
    description: "Triggers on sustained high fatigue readings. Recommends a deload week and notifies coach.",
    triggerType: "fatigue",
    triggerConfig: { threshold: 8, count: 4, windowDays: 7 },
    steps: [
      { stepOrder: 1, actionType: "create_intervention", config: { recommendationType: "deload", title: "Deload Week Recommended", summary: "Consistently high fatigue detected over the past week.", suggestedAction: "Consider a structured deload week with reduced volume and intensity.", severity: "important" } },
      { stepOrder: 2, actionType: "notify", config: { target: "coach", message: "Athlete is showing critical fatigue levels. A deload week is recommended." } },
      { stepOrder: 3, actionType: "notify", config: { target: "athlete", message: "Your training load has been high. Your coach may adjust your program this week to support recovery." } },
      { stepOrder: 4, actionType: "schedule_followup", config: { daysFromNow: 7, notes: "Re-evaluate fatigue levels after deload week." } },
    ],
  },
];

// ─── Seed templates for an org ────────────────────────────────────────────────
async function seedTemplatesForOrg(orgId: string) {
  const existing = await db.select({ templateKey: adaptiveWorkflows.templateKey })
    .from(adaptiveWorkflows)
    .where(and(eq(adaptiveWorkflows.orgId, orgId), eq(adaptiveWorkflows.isTemplate, true)));
  const existingKeys = new Set(existing.map((e) => e.templateKey));

  for (const tmpl of WORKFLOW_TEMPLATES) {
    if (existingKeys.has(tmpl.templateKey)) continue;
    const [wf] = await db.insert(adaptiveWorkflows).values({
      orgId,
      title: tmpl.title,
      description: tmpl.description,
      triggerType: tmpl.triggerType,
      triggerConfig: tmpl.triggerConfig,
      status: "active",
      isTemplate: true,
      templateKey: tmpl.templateKey,
    }).returning();

    if (tmpl.steps.length > 0) {
      await db.insert(adaptiveWorkflowSteps).values(
        tmpl.steps.map((s) => ({ workflowId: wf.id, ...s }))
      );
    }
  }
}

// ─── Workflow Execution Engine ────────────────────────────────────────────────
async function executeWorkflowStep(
  step: any,
  orgId: string,
  athleteUserId: string,
  runId: string
) {
  const { actionType, config } = step;

  switch (actionType) {
    case "notify": {
      const target = config.target ?? "coach";
      const targetFilter = target === "athlete" ? athleteUserId : undefined;
      const members = targetFilter
        ? [{ userId: targetFilter }]
        : await db.select({ userId: orgMemberships.userId }).from(orgMemberships)
            .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "coach")));
      await db.insert(orgNotifications).values(
        members.map((m) => ({
          orgId,
          userId: m.userId,
          type: "workflow_action",
          title: "Coaching Workflow",
          message: config.message ?? "A workflow action has been triggered.",
          metadata: { runId, actionType, target },
        }))
      );
      break;
    }
    case "create_intervention": {
      await db.insert(athleteInterventionRecommendations).values({
        orgId,
        athleteUserId,
        recommendationType: config.recommendationType ?? "coach_review",
        generatedBy: "workflow",
        title: config.title ?? "Workflow Intervention",
        summary: config.summary ?? "",
        suggestedAction: config.suggestedAction ?? "",
        severity: config.severity ?? "moderate",
        status: "pending",
      });
      break;
    }
    case "assign_education": {
      await db.insert(orgNotifications).values({
        orgId,
        userId: athleteUserId,
        type: "education_assigned",
        title: "New Learning Module",
        message: config.message ?? "A new education module has been assigned to you.",
        metadata: { category: config.category, runId },
      });
      break;
    }
    case "schedule_followup": {
      const days = config.daysFromNow ?? 5;
      const followupDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      await db.insert(adaptiveFollowups).values({
        orgId,
        athleteUserId,
        workflowRunId: runId,
        followupDate,
        status: "pending",
        notes: config.notes ?? "",
      });
      break;
    }
    case "coach_review": {
      await db.insert(athleteInterventionRecommendations).values({
        orgId,
        athleteUserId,
        recommendationType: "coach_review",
        generatedBy: "workflow",
        title: config.topic ?? "Coach Review Requested",
        summary: config.notes ?? "A workflow has flagged this athlete for a coach review.",
        suggestedAction: "Schedule a 1:1 coach review session.",
        severity: "moderate",
        status: "pending",
      });
      break;
    }
    case "ai_recommendation": {
      // Fire-and-forget AI recommendation (logs it without waiting)
      await db.insert(athleteInterventionRecommendations).values({
        orgId,
        athleteUserId,
        recommendationType: "coach_review",
        generatedBy: "workflow",
        title: "AI Review Requested",
        summary: "A workflow step requested an AI coaching recommendation.",
        suggestedAction: "Review AI-generated suggestion in the Intervention Queue.",
        severity: "info",
        status: "pending",
      });
      break;
    }
    default:
      break;
  }
}

export async function runWorkflowForAthlete(orgId: string, athleteUserId: string, triggerType: string) {
  const workflows = await db.select().from(adaptiveWorkflows)
    .where(and(
      eq(adaptiveWorkflows.orgId, orgId),
      eq(adaptiveWorkflows.triggerType, triggerType),
      eq(adaptiveWorkflows.status, "active"),
    ));

  for (const wf of workflows) {
    const [run] = await db.insert(adaptiveWorkflowRuns).values({
      workflowId: wf.id,
      orgId,
      athleteUserId,
      triggerEvent: triggerType,
      status: "running",
    }).returning();

    const steps = await db.select().from(adaptiveWorkflowSteps)
      .where(eq(adaptiveWorkflowSteps.workflowId, wf.id))
      .orderBy(adaptiveWorkflowSteps.stepOrder);

    try {
      for (const step of steps) {
        await executeWorkflowStep(step, orgId, athleteUserId, run.id);
      }
      await db.update(adaptiveWorkflowRuns)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(adaptiveWorkflowRuns.id, run.id));
    } catch {
      await db.update(adaptiveWorkflowRuns)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(adaptiveWorkflowRuns.id, run.id));
    }
  }

  return workflows.length;
}

// ─── Register Routes ──────────────────────────────────────────────────────────
export function registerAdaptiveWorkflowRoutes(app: Express) {

  // GET /api/org/adaptive-workflows — list all workflows for org
  app.get("/api/org/adaptive-workflows", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    await seedTemplatesForOrg(orgId);

    const workflows = await db.select().from(adaptiveWorkflows)
      .where(eq(adaptiveWorkflows.orgId, orgId))
      .orderBy(desc(adaptiveWorkflows.createdAt));

    const withSteps = await Promise.all(workflows.map(async (wf) => {
      const steps = await db.select().from(adaptiveWorkflowSteps)
        .where(eq(adaptiveWorkflowSteps.workflowId, wf.id))
        .orderBy(adaptiveWorkflowSteps.stepOrder);
      const [runsResult] = await db.select({ count: drizzleSql<number>`count(*)` })
        .from(adaptiveWorkflowRuns).where(eq(adaptiveWorkflowRuns.workflowId, wf.id));
      return { ...wf, steps, runCount: Number(runsResult?.count ?? 0) };
    }));

    res.json({ workflows: withSteps });
  });

  // GET /api/org/adaptive-workflows/:id — single workflow detail
  app.get("/api/org/adaptive-workflows/:id", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const { id } = req.params;
    const [wf] = await db.select().from(adaptiveWorkflows)
      .where(and(eq(adaptiveWorkflows.id, id), eq(adaptiveWorkflows.orgId, orgId))).limit(1);
    if (!wf) return res.status(404).json({ message: "Workflow not found" });

    const [steps, runs] = await Promise.all([
      db.select().from(adaptiveWorkflowSteps).where(eq(adaptiveWorkflowSteps.workflowId, id)).orderBy(adaptiveWorkflowSteps.stepOrder),
      db.select().from(adaptiveWorkflowRuns).where(eq(adaptiveWorkflowRuns.workflowId, id)).orderBy(desc(adaptiveWorkflowRuns.startedAt)).limit(50),
    ]);

    res.json({ workflow: wf, steps, runs });
  });

  // POST /api/org/adaptive-workflows — create custom workflow
  app.post("/api/org/adaptive-workflows", requireCoach, async (req: any, res) => {
    const { orgId, userId } = req._orgAuth;
    const { title, description, triggerType, triggerConfig, steps = [] } = req.body;
    if (!title || !triggerType) return res.status(400).json({ error: "title and triggerType required" });

    const [wf] = await db.insert(adaptiveWorkflows).values({
      orgId, title, description, triggerType,
      triggerConfig: triggerConfig ?? {},
      status: "active",
      isTemplate: false,
      createdByUserId: userId,
    }).returning();

    if (steps.length > 0) {
      await db.insert(adaptiveWorkflowSteps).values(
        steps.map((s: any, i: number) => ({
          workflowId: wf.id,
          stepOrder: s.stepOrder ?? i + 1,
          actionType: s.actionType,
          config: s.config ?? {},
        }))
      );
    }

    const stepsInserted = await db.select().from(adaptiveWorkflowSteps)
      .where(eq(adaptiveWorkflowSteps.workflowId, wf.id)).orderBy(adaptiveWorkflowSteps.stepOrder);
    res.json({ workflow: wf, steps: stepsInserted });
  });

  // PATCH /api/org/adaptive-workflows/:id — update status/title/etc
  app.patch("/api/org/adaptive-workflows/:id", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const { id } = req.params;
    const { status, title, description, triggerType, triggerConfig } = req.body;
    const [updated] = await db.update(adaptiveWorkflows)
      .set({ ...(status ? { status } : {}), ...(title ? { title } : {}), ...(description !== undefined ? { description } : {}), ...(triggerType ? { triggerType } : {}), ...(triggerConfig ? { triggerConfig } : {}), updatedAt: new Date() })
      .where(and(eq(adaptiveWorkflows.id, id), eq(adaptiveWorkflows.orgId, orgId)))
      .returning();
    res.json({ workflow: updated });
  });

  // POST /api/org/adaptive-workflows/:id/steps — replace all steps
  app.post("/api/org/adaptive-workflows/:id/steps", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const { id } = req.params;
    const { steps = [] } = req.body;
    const [wf] = await db.select().from(adaptiveWorkflows)
      .where(and(eq(adaptiveWorkflows.id, id), eq(adaptiveWorkflows.orgId, orgId))).limit(1);
    if (!wf) return res.status(404).json({ message: "Not found" });

    await db.delete(adaptiveWorkflowSteps).where(eq(adaptiveWorkflowSteps.workflowId, id));
    if (steps.length > 0) {
      await db.insert(adaptiveWorkflowSteps).values(
        steps.map((s: any, i: number) => ({
          workflowId: id,
          stepOrder: s.stepOrder ?? i + 1,
          actionType: s.actionType,
          config: s.config ?? {},
        }))
      );
    }
    const result = await db.select().from(adaptiveWorkflowSteps)
      .where(eq(adaptiveWorkflowSteps.workflowId, id)).orderBy(adaptiveWorkflowSteps.stepOrder);
    res.json({ steps: result });
  });

  // POST /api/org/adaptive-workflows/:id/trigger — manually trigger for an athlete
  app.post("/api/org/adaptive-workflows/:id/trigger", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const { id } = req.params;
    const { athleteUserId } = req.body;
    if (!athleteUserId) return res.status(400).json({ error: "athleteUserId required" });

    const [wf] = await db.select().from(adaptiveWorkflows)
      .where(and(eq(adaptiveWorkflows.id, id), eq(adaptiveWorkflows.orgId, orgId))).limit(1);
    if (!wf) return res.status(404).json({ message: "Not found" });

    const [run] = await db.insert(adaptiveWorkflowRuns).values({
      workflowId: wf.id, orgId, athleteUserId, triggerEvent: "manual", status: "running",
    }).returning();

    const steps = await db.select().from(adaptiveWorkflowSteps)
      .where(eq(adaptiveWorkflowSteps.workflowId, wf.id)).orderBy(adaptiveWorkflowSteps.stepOrder);

    try {
      for (const step of steps) await executeWorkflowStep(step, orgId, athleteUserId, run.id);
      const [updated] = await db.update(adaptiveWorkflowRuns)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(adaptiveWorkflowRuns.id, run.id)).returning();
      res.json({ run: updated, stepsExecuted: steps.length });
    } catch (err: any) {
      await db.update(adaptiveWorkflowRuns).set({ status: "failed", completedAt: new Date() }).where(eq(adaptiveWorkflowRuns.id, run.id));
      res.status(500).json({ error: "Workflow execution failed", details: err.message });
    }
  });

  // GET /api/org/adaptive-workflows/runs/recent
  app.get("/api/org/adaptive-workflows/runs/recent", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const runs = await db.select().from(adaptiveWorkflowRuns)
      .where(eq(adaptiveWorkflowRuns.orgId, orgId))
      .orderBy(desc(adaptiveWorkflowRuns.startedAt)).limit(50);
    res.json({ runs });
  });

  // GET /api/org/adaptive-followups — all pending follow-ups
  app.get("/api/org/adaptive-followups", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const followups = await db.select().from(adaptiveFollowups)
      .where(and(eq(adaptiveFollowups.orgId, orgId), eq(adaptiveFollowups.status, "pending")))
      .orderBy(adaptiveFollowups.followupDate);
    res.json({ followups });
  });

  // PATCH /api/org/adaptive-followups/:id — update follow-up status
  app.patch("/api/org/adaptive-followups/:id", requireCoach, async (req: any, res) => {
    const { orgId, userId } = req._orgAuth;
    const { id } = req.params;
    const { status, notes } = req.body;
    const [updated] = await db.update(adaptiveFollowups)
      .set({ status, notes, coachUserId: userId })
      .where(and(eq(adaptiveFollowups.id, id), eq(adaptiveFollowups.orgId, orgId)))
      .returning();
    res.json({ followup: updated });
  });

  // GET /api/org/adaptive-workflows/stats — dashboard stats
  app.get("/api/org/adaptive-workflows/stats", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const [activeWf, allRuns, pendingFu, pendingInterventions] = await Promise.all([
      db.select({ count: drizzleSql<number>`count(*)` }).from(adaptiveWorkflows)
        .where(and(eq(adaptiveWorkflows.orgId, orgId), eq(adaptiveWorkflows.status, "active"))),
      db.select().from(adaptiveWorkflowRuns)
        .where(eq(adaptiveWorkflowRuns.orgId, orgId)).limit(200),
      db.select({ count: drizzleSql<number>`count(*)` }).from(adaptiveFollowups)
        .where(and(eq(adaptiveFollowups.orgId, orgId), eq(adaptiveFollowups.status, "pending"))),
      db.select({ count: drizzleSql<number>`count(*)` }).from(athleteInterventionRecommendations)
        .where(and(eq(athleteInterventionRecommendations.orgId, orgId), eq(athleteInterventionRecommendations.status, "pending"))),
    ]);

    const completed = allRuns.filter((r) => r.status === "completed").length;
    const failed = allRuns.filter((r) => r.status === "failed").length;
    const total = allRuns.length;
    const resolutionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    res.json({
      activeWorkflows: Number(activeWf[0]?.count ?? 0),
      totalRuns: total,
      completedRuns: completed,
      failedRuns: failed,
      resolutionRate,
      pendingFollowups: Number(pendingFu[0]?.count ?? 0),
      pendingInterventions: Number(pendingInterventions[0]?.count ?? 0),
    });
  });

  // POST /api/org/adaptive-workflows/ai-recommend — AI full analysis
  app.post("/api/org/adaptive-workflows/ai-recommend", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const { athleteUserId } = req.body;
    if (!athleteUserId) return res.status(400).json({ error: "athleteUserId required" });

    const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const since45 = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

    const [checkins, completions, snapshots, flags, prs, eduProgress] = await Promise.all([
      db.select().from(workoutReadinessCheckins)
        .where(and(eq(workoutReadinessCheckins.orgId, orgId), eq(workoutReadinessCheckins.athleteUserId, athleteUserId), gte(workoutReadinessCheckins.createdAt, since14)))
        .orderBy(desc(workoutReadinessCheckins.createdAt)).limit(14),
      db.select().from(workoutCompletionLogs)
        .where(and(eq(workoutCompletionLogs.orgId, orgId), eq(workoutCompletionLogs.athleteUserId, athleteUserId), gte(workoutCompletionLogs.completedAt, since14))).limit(20),
      db.select().from(athleteStatusSnapshots)
        .where(and(eq(athleteStatusSnapshots.orgId, orgId), eq(athleteStatusSnapshots.athleteUserId, athleteUserId)))
        .orderBy(desc(athleteStatusSnapshots.generatedAt)).limit(5),
      db.select().from(athleteRiskFlags)
        .where(and(eq(athleteRiskFlags.orgId, orgId), eq(athleteRiskFlags.athleteUserId, athleteUserId), eq(athleteRiskFlags.status, "active"))),
      db.select().from(prLiftEntries)
        .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, athleteUserId), gte(prLiftEntries.createdAt, since45))).limit(10),
      db.select().from(educationProgress)
        .where(and(eq(educationProgress.orgId, orgId), eq(educationProgress.athleteUserId, athleteUserId))).limit(20),
    ]);

    const context = {
      recentCheckins: checkins.map((c) => ({ date: c.createdAt, readiness: c.readinessScore, fatigue: c.fatigueLevel, soreness: c.sorenessLevel, sleep: c.sleepQuality, motivation: c.motivationLevel })),
      recentWorkouts: completions.length,
      latestScores: snapshots[0] ?? null,
      activeRiskFlags: flags.map((f) => ({ type: f.flagType, severity: f.severity, title: f.title })),
      recentPRs: prs.length,
      educationModulesCompleted: eduProgress.filter((e) => e.status === "completed").length,
      educationModulesTotal: eduProgress.length,
    };

    const prompt = `You are an expert sports performance coach AI. Analyze this athlete's data and generate an adaptive intervention plan.

DATA:
${JSON.stringify(context, null, 2)}

RULES:
- No medical advice or diagnoses
- No alarming language ("high risk", "injury prediction")  
- Focus: recovery, accountability, education, motivation, program support
- Supportive, professional tone

RETURN JSON:
{
  "summary": "2-3 sentence analysis of athlete status",
  "urgency": "low|medium|high",
  "suggestedWorkflows": ["workflow_key1", "workflow_key2"],
  "recommendations": [
    {
      "recommendationType": "recovery|education|workout_adjustment|coach_review|hydration|deload",
      "title": "...",
      "summary": "...",
      "suggestedAction": "...",
      "severity": "info|moderate|important"
    }
  ],
  "followupTiming": { "days": 5, "reason": "..." },
  "coachTips": ["tip1", "tip2"],
  "athleteMessage": "Supportive message to show the athlete (no alarming language)"
}`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 900,
      });
      const result = JSON.parse(completion.choices[0].message.content ?? "{}");

      if (Array.isArray(result.recommendations) && result.recommendations.length > 0) {
        await db.insert(athleteInterventionRecommendations).values(
          result.recommendations.map((r: any) => ({
            orgId, athleteUserId,
            recommendationType: r.recommendationType ?? "coach_review",
            generatedBy: "ai",
            title: r.title,
            summary: r.summary,
            suggestedAction: r.suggestedAction,
            severity: r.severity ?? "info",
            status: "pending",
          }))
        );
      }

      res.json({ analysis: result });
    } catch {
      res.status(500).json({ error: "AI analysis failed" });
    }
  });

  // GET /api/org/interventions/full — enhanced intervention queue
  app.get("/api/org/interventions/full", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const interventions = await db.select().from(athleteInterventionRecommendations)
      .where(eq(athleteInterventionRecommendations.orgId, orgId))
      .orderBy(desc(athleteInterventionRecommendations.createdAt)).limit(100);

    const withContext = await Promise.all(interventions.map(async (inv) => {
      const [latestSnapshot] = await db.select().from(athleteStatusSnapshots)
        .where(and(eq(athleteStatusSnapshots.orgId, orgId), eq(athleteStatusSnapshots.athleteUserId, inv.athleteUserId)))
        .orderBy(desc(athleteStatusSnapshots.generatedAt)).limit(1);
      const followups = await db.select().from(adaptiveFollowups)
        .where(and(eq(adaptiveFollowups.orgId, orgId), eq(adaptiveFollowups.interventionId, inv.id)));
      return { ...inv, latestSnapshot: latestSnapshot ?? null, followups };
    }));

    res.json({ interventions: withContext });
  });

  // PATCH /api/org/interventions/full/:id — accept/dismiss/complete/escalate
  app.patch("/api/org/interventions/full/:id", requireCoach, async (req: any, res) => {
    const { orgId, userId } = req._orgAuth;
    const { id } = req.params;
    const { status, coachNotes } = req.body;
    const [updated] = await db.update(athleteInterventionRecommendations)
      .set({ status, coachNotes })
      .where(and(eq(athleteInterventionRecommendations.id, id), eq(athleteInterventionRecommendations.orgId, orgId)))
      .returning();
    res.json({ intervention: updated });
  });
}
