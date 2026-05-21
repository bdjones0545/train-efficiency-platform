import type { Express } from "express";
import { db } from "./db";
import crypto from "crypto";
import {
  athleteStatusSnapshots, athleteRiskFlags, athleteInterventionRecommendations,
  workoutReadinessCheckins, workoutCompletionLogs,
  educationProgress, educationModules,
  prLiftEntries, orgMemberships, orgUsers, orgSessions,
  orgActivityEvents, orgNotifications,
} from "@shared/schema";
import { eq, and, desc, gte, gt, sql as drizzleSql } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Auth helpers (org session token pattern) ─────────────────────────────────
async function resolveOrgSession(req: any) {
  const token = req.headers["x-org-auth-token"] as string | undefined;
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const [session] = await db.select().from(orgSessions)
    .where(and(eq(orgSessions.tokenHash, tokenHash), gt(orgSessions.expiresAt, now)))
    .limit(1);
  if (!session) return null;
  const [membership] = await db.select().from(orgMemberships)
    .where(and(eq(orgMemberships.userId, session.userId), eq(orgMemberships.orgId, session.orgId)))
    .limit(1);
  if (!membership) return null;
  return { userId: session.userId, orgId: session.orgId, role: membership.role };
}

function requireCoach(req: any, res: any, next: any) {
  resolveOrgSession(req).then((auth) => {
    if (!auth) return res.status(401).json({ message: "Not authenticated" });
    if (!["admin", "coach", "staff"].includes(auth.role)) {
      return res.status(403).json({ message: "Coach access required" });
    }
    req._orgAuth = auth;
    next();
  }).catch(() => res.status(500).json({ message: "Auth error" }));
}

function requireOrgUser(req: any, res: any, next: any) {
  resolveOrgSession(req).then((auth) => {
    if (!auth) return res.status(401).json({ message: "Not authenticated" });
    req._orgAuth = auth;
    next();
  }).catch(() => res.status(500).json({ message: "Auth error" }));
}

// ─── Scoring Engine ───────────────────────────────────────────────────────────

async function computeReadinessScore(orgId: string, athleteUserId: string): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const checkins = await db.select().from(workoutReadinessCheckins)
    .where(and(
      eq(workoutReadinessCheckins.orgId, orgId),
      eq(workoutReadinessCheckins.athleteUserId, athleteUserId),
      gte(workoutReadinessCheckins.createdAt, since),
    )).orderBy(desc(workoutReadinessCheckins.createdAt));

  if (!checkins.length) return 50;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const pick = (arr: typeof checkins, key: keyof (typeof checkins)[0]) =>
    arr.filter((c) => c[key] != null).map((c) => c[key] as number);

  const readiness = avg(checkins.map((c) => c.readinessScore ?? 5));
  const sleepVals = pick(checkins, "sleepQuality");
  const fatigueVals = pick(checkins, "fatigueLevel");
  const sorenessVals = pick(checkins, "sorenessLevel");
  const motivVals = pick(checkins, "motivationLevel");

  const sleep = sleepVals.length ? avg(sleepVals) : 5;
  const fatigue = fatigueVals.length ? 10 - avg(fatigueVals) : 5;
  const soreness = sorenessVals.length ? 10 - avg(sorenessVals) : 5;
  const motivation = motivVals.length ? avg(motivVals) : 5;

  const weighted = readiness * 0.35 + sleep * 0.20 + fatigue * 0.20 + soreness * 0.15 + motivation * 0.10;
  return Math.round(Math.min(100, Math.max(0, weighted * 10)));
}

async function computeAdherenceScore(orgId: string, athleteUserId: string): Promise<number> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [result] = await db.select({ count: drizzleSql<number>`count(*)` })
    .from(workoutCompletionLogs)
    .where(and(
      eq(workoutCompletionLogs.orgId, orgId),
      eq(workoutCompletionLogs.athleteUserId, athleteUserId),
      gte(workoutCompletionLogs.completedAt, since),
    ));
  const cnt = Number(result?.count ?? 0);
  return Math.min(100, 10 + cnt * 15);
}

async function computeRecoveryScore(orgId: string, athleteUserId: string): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const checkins = await db.select().from(workoutReadinessCheckins)
    .where(and(
      eq(workoutReadinessCheckins.orgId, orgId),
      eq(workoutReadinessCheckins.athleteUserId, athleteUserId),
      gte(workoutReadinessCheckins.createdAt, since),
    ));

  if (!checkins.length) return 60;
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const sorenessVals = checkins.filter((c) => c.sorenessLevel != null).map((c) => c.sorenessLevel!);
  const fatigueVals = checkins.filter((c) => c.fatigueLevel != null).map((c) => c.fatigueLevel!);
  const sorenessScore = sorenessVals.length ? Math.max(0, 10 - avg(sorenessVals)) * 10 : 60;
  const fatigueScore = fatigueVals.length ? Math.max(0, 10 - avg(fatigueVals)) * 10 : 60;
  return Math.round(sorenessScore * 0.5 + fatigueScore * 0.5);
}

async function computeEducationScore(orgId: string, athleteUserId: string): Promise<number> {
  const [totalRow] = await db.select({ count: drizzleSql<number>`count(*)` })
    .from(educationModules).where(eq(educationModules.status, "published"));
  const totalModules = Number(totalRow?.count ?? 0);
  if (!totalModules) return 80;

  const [completedRow] = await db.select({ count: drizzleSql<number>`count(*)` })
    .from(educationProgress)
    .where(and(
      eq(educationProgress.orgId, orgId),
      eq(educationProgress.athleteUserId, athleteUserId),
      eq(educationProgress.status, "completed"),
    ));
  const [failedRow] = await db.select({ count: drizzleSql<number>`count(*)` })
    .from(educationProgress)
    .where(and(
      eq(educationProgress.orgId, orgId),
      eq(educationProgress.athleteUserId, athleteUserId),
      eq(educationProgress.status, "failed"),
    ));

  const completedCount = Number(completedRow?.count ?? 0);
  const failedCount = Number(failedRow?.count ?? 0);
  const base = Math.min(100, (completedCount / totalModules) * 100);
  return Math.round(Math.max(0, base - failedCount * 5));
}

async function computeEngagementScore(orgId: string, athleteUserId: string): Promise<number> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [result] = await db.select({ count: drizzleSql<number>`count(*)` })
    .from(orgActivityEvents)
    .where(and(
      eq(orgActivityEvents.orgId, orgId),
      eq(orgActivityEvents.userId, athleteUserId),
      gte(orgActivityEvents.createdAt, since),
    ));
  const eventCount = Number(result?.count ?? 0);
  return Math.min(100, eventCount * 5 + 30);
}

export async function generateAthleteStatus(orgId: string, athleteUserId: string) {
  const [readiness, adherence, recovery, education, engagement] = await Promise.all([
    computeReadinessScore(orgId, athleteUserId),
    computeAdherenceScore(orgId, athleteUserId),
    computeRecoveryScore(orgId, athleteUserId),
    computeEducationScore(orgId, athleteUserId),
    computeEngagementScore(orgId, athleteUserId),
  ]);

  const statusScore = Math.round(
    readiness * 0.30 + adherence * 0.25 + recovery * 0.20 + education * 0.15 + engagement * 0.10
  );
  const riskLevel = statusScore < 40 ? "red" : statusScore < 65 ? "yellow" : "green";

  const [snapshot] = await db.insert(athleteStatusSnapshots).values({
    orgId, athleteUserId, statusScore, riskLevel,
    readinessScore: readiness, adherenceScore: adherence,
    recoveryScore: recovery, educationScore: education, engagementScore: engagement,
    generatedAt: new Date(),
    metadata: { readiness, adherence, recovery, education, engagement },
  }).returning();

  return snapshot;
}

// ─── Rules Engine ─────────────────────────────────────────────────────────────

async function flagAlreadyActive(orgId: string, athleteUserId: string, flagType: string): Promise<boolean> {
  const [existing] = await db.select().from(athleteRiskFlags)
    .where(and(
      eq(athleteRiskFlags.orgId, orgId),
      eq(athleteRiskFlags.athleteUserId, athleteUserId),
      eq(athleteRiskFlags.flagType, flagType),
      eq(athleteRiskFlags.status, "active"),
    )).limit(1);
  return !!existing;
}

export async function runRulesEngine(orgId: string, athleteUserId: string) {
  const flags: any[] = [];
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const since45 = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

  const recentCheckins = await db.select().from(workoutReadinessCheckins)
    .where(and(
      eq(workoutReadinessCheckins.orgId, orgId),
      eq(workoutReadinessCheckins.athleteUserId, athleteUserId),
      gte(workoutReadinessCheckins.createdAt, since7),
    )).orderBy(desc(workoutReadinessCheckins.createdAt));

  // Rule: low_readiness — readiness <= 4 three times in 7 days
  const lowReadiness = recentCheckins.filter((c) => c.readinessScore <= 4);
  if (lowReadiness.length >= 3 && !(await flagAlreadyActive(orgId, athleteUserId, "low_readiness"))) {
    flags.push({
      orgId, athleteUserId, flagType: "low_readiness", severity: "important",
      title: "Consistently Low Readiness",
      summary: `${lowReadiness.length} check-ins in the past 7 days showed readiness ≤ 4/10.`,
      recommendation: "Consider scheduling a recovery day or reducing training intensity.",
      sourceData: { count: lowReadiness.length, scores: lowReadiness.map((c) => c.readinessScore) },
    });
  }

  // Rule: fatigue trend
  const highFatigue = recentCheckins.filter((c) => (c.fatigueLevel ?? 0) >= 7);
  if (highFatigue.length >= 3 && !(await flagAlreadyActive(orgId, athleteUserId, "fatigue"))) {
    flags.push({
      orgId, athleteUserId, flagType: "fatigue", severity: "important",
      title: "High Fatigue Trend",
      summary: `${highFatigue.length} check-ins this week showed high fatigue (7+/10).`,
      recommendation: "Review recent training load and consider a deload or rest day.",
      sourceData: { count: highFatigue.length },
    });
  }

  // Rule: recovery_risk — soreness >= 8 repeatedly
  const highSoreness = recentCheckins.filter((c) => (c.sorenessLevel ?? 0) >= 8);
  if (highSoreness.length >= 2 && !(await flagAlreadyActive(orgId, athleteUserId, "recovery_risk"))) {
    flags.push({
      orgId, athleteUserId, flagType: "recovery_risk", severity: "moderate",
      title: "Elevated Soreness",
      summary: `${highSoreness.length} check-ins reported soreness 8+/10 this week.`,
      recommendation: "Encourage recovery education and reduce high-impact training.",
      sourceData: { count: highSoreness.length },
    });
  }

  // Rule: no workouts in 14 days
  const [completedIn14] = await db.select({ count: drizzleSql<number>`count(*)` })
    .from(workoutCompletionLogs)
    .where(and(
      eq(workoutCompletionLogs.orgId, orgId),
      eq(workoutCompletionLogs.athleteUserId, athleteUserId),
      gte(workoutCompletionLogs.completedAt, since14),
    ));
  if (Number(completedIn14?.count ?? 0) === 0 && !(await flagAlreadyActive(orgId, athleteUserId, "missed_workouts"))) {
    const [anyCompletion] = await db.select().from(workoutCompletionLogs)
      .where(and(eq(workoutCompletionLogs.orgId, orgId), eq(workoutCompletionLogs.athleteUserId, athleteUserId))).limit(1);
    if (anyCompletion) {
      flags.push({
        orgId, athleteUserId, flagType: "missed_workouts", severity: "moderate",
        title: "No Workouts Logged",
        summary: "No workout completions recorded in the past 14 days.",
        recommendation: "Check in with the athlete to understand barriers to attendance.",
        sourceData: { completedIn14Days: 0 },
      });
    }
  }

  // Rule: education_noncompliance
  const eduScore = await computeEducationScore(orgId, athleteUserId);
  if (eduScore < 40 && !(await flagAlreadyActive(orgId, athleteUserId, "education_noncompliance"))) {
    flags.push({
      orgId, athleteUserId, flagType: "education_noncompliance", severity: "info",
      title: "Education Behind",
      summary: `Education completion score is ${eduScore}%.`,
      recommendation: "Assign key pathways and check in on education progress.",
      sourceData: { educationScore: eduScore },
    });
  }

  // Rule: low_engagement
  const engScore = await computeEngagementScore(orgId, athleteUserId);
  if (engScore < 35 && !(await flagAlreadyActive(orgId, athleteUserId, "low_engagement"))) {
    flags.push({
      orgId, athleteUserId, flagType: "low_engagement", severity: "info",
      title: "Low Portal Engagement",
      summary: "Athlete has had minimal recent portal activity.",
      recommendation: "Send a check-in message or assign engaging education content.",
      sourceData: { engagementScore: engScore },
    });
  }

  // Rule: pr_stagnation
  const [recentPR] = await db.select().from(prLiftEntries)
    .where(and(
      eq(prLiftEntries.orgId, orgId),
      eq(prLiftEntries.userId, athleteUserId),
      gte(prLiftEntries.createdAt, since45),
    )).limit(1);
  const [anyPR] = await db.select().from(prLiftEntries)
    .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, athleteUserId))).limit(1);
  if (!recentPR && anyPR && !(await flagAlreadyActive(orgId, athleteUserId, "pr_stagnation"))) {
    flags.push({
      orgId, athleteUserId, flagType: "pr_stagnation", severity: "info",
      title: "PR Plateau",
      summary: "No new PR logged in the past 45 days.",
      recommendation: "Review programming and consider a coach review session.",
      sourceData: { daysSinceLastPR: 45 },
    });
  }

  if (flags.length > 0) {
    await db.insert(athleteRiskFlags).values(flags);
    try {
      await db.insert(orgNotifications).values(flags.map((f) => ({
        orgId, userId: athleteUserId, type: "risk_flag",
        title: f.title, message: f.summary,
        metadata: { flagType: f.flagType, severity: f.severity },
      })));
    } catch {}
  }

  return flags;
}

// ─── Register routes ──────────────────────────────────────────────────────────

export function registerAthleteReadinessRoutes(app: Express) {

  // GET /api/org/athlete-status — athlete status grid (coach)
  app.get("/api/org/athlete-status", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;

    const athletes = await db.select().from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "athlete"), eq(orgMemberships.status, "active")));

    const results = await Promise.all(athletes.map(async (m) => {
      const [latest] = await db.select().from(athleteStatusSnapshots)
        .where(and(eq(athleteStatusSnapshots.orgId, orgId), eq(athleteStatusSnapshots.athleteUserId, m.userId)))
        .orderBy(desc(athleteStatusSnapshots.generatedAt)).limit(1);

      const [activeFlags, pendingInterventions] = await Promise.all([
        db.select().from(athleteRiskFlags)
          .where(and(eq(athleteRiskFlags.orgId, orgId), eq(athleteRiskFlags.athleteUserId, m.userId), eq(athleteRiskFlags.status, "active"))),
        db.select().from(athleteInterventionRecommendations)
          .where(and(eq(athleteInterventionRecommendations.orgId, orgId), eq(athleteInterventionRecommendations.athleteUserId, m.userId), eq(athleteInterventionRecommendations.status, "pending"))),
      ]);

      return { userId: m.userId, snapshot: latest ?? null, activeFlags, pendingInterventions, flagCount: activeFlags.length };
    }));

    res.json({ athletes: results });
  });

  // GET /api/org/athlete-status/:userId — single athlete detail
  app.get("/api/org/athlete-status/:userId", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const { userId } = req.params;

    const [snapshots, flags, interventions, checkins] = await Promise.all([
      db.select().from(athleteStatusSnapshots)
        .where(and(eq(athleteStatusSnapshots.orgId, orgId), eq(athleteStatusSnapshots.athleteUserId, userId)))
        .orderBy(desc(athleteStatusSnapshots.generatedAt)).limit(10),
      db.select().from(athleteRiskFlags)
        .where(and(eq(athleteRiskFlags.orgId, orgId), eq(athleteRiskFlags.athleteUserId, userId)))
        .orderBy(desc(athleteRiskFlags.createdAt)),
      db.select().from(athleteInterventionRecommendations)
        .where(and(eq(athleteInterventionRecommendations.orgId, orgId), eq(athleteInterventionRecommendations.athleteUserId, userId)))
        .orderBy(desc(athleteInterventionRecommendations.createdAt)),
      db.select().from(workoutReadinessCheckins)
        .where(and(eq(workoutReadinessCheckins.orgId, orgId), eq(workoutReadinessCheckins.athleteUserId, userId)))
        .orderBy(desc(workoutReadinessCheckins.createdAt)).limit(14),
    ]);

    res.json({ snapshots, flags, interventions, checkins });
  });

  // POST /api/org/athlete-status/refresh-all — MUST come before :userId
  app.post("/api/org/athlete-status/refresh-all", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const athletes = await db.select().from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "athlete"), eq(orgMemberships.status, "active")));
    const results = await Promise.all(athletes.map((m) => generateAthleteStatus(orgId, m.userId).catch(() => null)));
    res.json({ refreshed: results.filter(Boolean).length, total: athletes.length });
  });

  // POST /api/org/athlete-status/:userId/refresh
  app.post("/api/org/athlete-status/:userId/refresh", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const { userId } = req.params;
    const [snapshot, newFlags] = await Promise.all([
      generateAthleteStatus(orgId, userId),
      runRulesEngine(orgId, userId),
    ]);
    res.json({ snapshot, newFlags });
  });

  // GET /api/org/athlete-risk-flags
  app.get("/api/org/athlete-risk-flags", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const flags = await db.select().from(athleteRiskFlags)
      .where(and(eq(athleteRiskFlags.orgId, orgId), eq(athleteRiskFlags.status, "active")))
      .orderBy(desc(athleteRiskFlags.createdAt));
    res.json({ flags });
  });

  // PATCH /api/org/athlete-risk-flags/:id
  app.patch("/api/org/athlete-risk-flags/:id", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const { id } = req.params;
    const { status } = req.body;
    const [flag] = await db.update(athleteRiskFlags)
      .set({ status, resolvedAt: status === "resolved" ? new Date() : null })
      .where(and(eq(athleteRiskFlags.id, id), eq(athleteRiskFlags.orgId, orgId)))
      .returning();
    res.json({ flag });
  });

  // GET /api/org/interventions
  app.get("/api/org/interventions", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const interventions = await db.select().from(athleteInterventionRecommendations)
      .where(and(eq(athleteInterventionRecommendations.orgId, orgId), eq(athleteInterventionRecommendations.status, "pending")))
      .orderBy(desc(athleteInterventionRecommendations.createdAt));
    res.json({ interventions });
  });

  // PATCH /api/org/interventions/:id
  app.patch("/api/org/interventions/:id", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const { id } = req.params;
    const { status, coachNotes } = req.body;
    const [intervention] = await db.update(athleteInterventionRecommendations)
      .set({ status, coachNotes })
      .where(and(eq(athleteInterventionRecommendations.id, id), eq(athleteInterventionRecommendations.orgId, orgId)))
      .returning();
    res.json({ intervention });
  });

  // POST /api/org/athlete-intelligence/recommend — AI suggestions
  app.post("/api/org/athlete-intelligence/recommend", requireCoach, async (req: any, res) => {
    const { orgId } = req._orgAuth;
    const { athleteUserId } = req.body;
    if (!athleteUserId) return res.status(400).json({ error: "athleteUserId required" });

    const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const [checkins, completions, snapshots, flags] = await Promise.all([
      db.select().from(workoutReadinessCheckins)
        .where(and(eq(workoutReadinessCheckins.orgId, orgId), eq(workoutReadinessCheckins.athleteUserId, athleteUserId), gte(workoutReadinessCheckins.createdAt, since14)))
        .orderBy(desc(workoutReadinessCheckins.createdAt)).limit(14),
      db.select().from(workoutCompletionLogs)
        .where(and(eq(workoutCompletionLogs.orgId, orgId), eq(workoutCompletionLogs.athleteUserId, athleteUserId), gte(workoutCompletionLogs.completedAt, since14)))
        .limit(20),
      db.select().from(athleteStatusSnapshots)
        .where(and(eq(athleteStatusSnapshots.orgId, orgId), eq(athleteStatusSnapshots.athleteUserId, athleteUserId)))
        .orderBy(desc(athleteStatusSnapshots.generatedAt)).limit(5),
      db.select().from(athleteRiskFlags)
        .where(and(eq(athleteRiskFlags.orgId, orgId), eq(athleteRiskFlags.athleteUserId, athleteUserId), eq(athleteRiskFlags.status, "active"))),
    ]);

    const context = {
      checkins: checkins.map((c) => ({ readiness: c.readinessScore, fatigue: c.fatigueLevel, soreness: c.sorenessLevel, sleep: c.sleepQuality, motivation: c.motivationLevel })),
      recentCompletions: completions.length,
      latestSnapshot: snapshots[0] ?? null,
      activeFlags: flags.map((f) => ({ type: f.flagType, severity: f.severity, title: f.title })),
    };

    const prompt = `You are a performance coaching assistant. Generate 1-3 specific, actionable coaching interventions based on this athlete data:
${JSON.stringify(context, null, 2)}

Focus: recovery, education, workout adjustment, hydration, deload, or coach review.
Tone: supportive and performance-focused. No medical language.

Return JSON: { "recommendations": [{ "recommendationType": "recovery|education|workout_adjustment|coach_review|hydration|deload", "title": "...", "summary": "...", "suggestedAction": "...", "severity": "info|moderate|important|critical" }] }`;

    let recommendations: any[] = [];
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 700,
      });
      const parsed = JSON.parse(completion.choices[0].message.content ?? "{}");
      recommendations = parsed.recommendations ?? (Array.isArray(parsed) ? parsed : []);
    } catch {
      return res.status(500).json({ error: "AI generation failed" });
    }

    const inserted = await db.insert(athleteInterventionRecommendations).values(
      recommendations.map((r: any) => ({
        orgId, athleteUserId,
        recommendationType: r.recommendationType ?? "coach_review",
        generatedBy: "ai", title: r.title, summary: r.summary,
        suggestedAction: r.suggestedAction, severity: r.severity ?? "info", status: "pending",
      }))
    ).returning();

    res.json({ recommendations: inserted });
  });

  // GET /api/org/my-athlete-status — athlete's own view
  app.get("/api/org/my-athlete-status", requireOrgUser, async (req: any, res) => {
    const { orgId, userId } = req._orgAuth;
    const [latest, checkins, completions] = await Promise.all([
      db.select().from(athleteStatusSnapshots)
        .where(and(eq(athleteStatusSnapshots.orgId, orgId), eq(athleteStatusSnapshots.athleteUserId, userId)))
        .orderBy(desc(athleteStatusSnapshots.generatedAt)).limit(1),
      db.select().from(workoutReadinessCheckins)
        .where(and(eq(workoutReadinessCheckins.orgId, orgId), eq(workoutReadinessCheckins.athleteUserId, userId)))
        .orderBy(desc(workoutReadinessCheckins.createdAt)).limit(7),
      db.select().from(workoutCompletionLogs)
        .where(and(eq(workoutCompletionLogs.orgId, orgId), eq(workoutCompletionLogs.athleteUserId, userId)))
        .orderBy(desc(workoutCompletionLogs.completedAt)).limit(14),
    ]);
    res.json({ snapshot: latest[0] ?? null, recentCheckins: checkins, recentCompletions: completions });
  });
}
