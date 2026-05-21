import type { Express } from "express";
import { db } from "./db";
import crypto from "crypto";
import {
  athleteStatusSnapshots,
  athleteRiskFlags,
  athleteInterventionRecommendations,
  workoutCompletionLogs,
  workoutReadinessCheckins,
  educationProgress,
  educationModules,
  prLiftEntries,
  orgMemberships,
  orgUsers,
  orgSessions,
  athleteStreaks,
  coachDailyBriefings,
} from "@shared/schema";
import { eq, and, desc, gte, sql as drizzleSql, lt, count } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function resolveOrgSession(req: any) {
  const token = req.headers["x-org-auth-token"] as string | undefined;
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const [session] = await db
    .select()
    .from(orgSessions)
    .where(and(eq(orgSessions.tokenHash, tokenHash), drizzleSql`${orgSessions.expiresAt} > ${now}`))
    .limit(1);
  if (!session) return null;
  const [membership] = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, session.userId), eq(orgMemberships.orgId, session.orgId)))
    .limit(1);
  if (!membership) return null;
  return { userId: session.userId, orgId: session.orgId, role: membership.role };
}

function requireCoach(req: any, res: any, next: any) {
  resolveOrgSession(req)
    .then((auth) => {
      if (!auth) return res.status(401).json({ message: "Not authenticated" });
      if (!["admin", "coach", "staff", "owner"].includes(auth.role)) {
        return res.status(403).json({ message: "Coach access required" });
      }
      req._orgAuth = auth;
      next();
    })
    .catch(() => res.status(500).json({ message: "Auth error" }));
}

// ─── Data Aggregation ─────────────────────────────────────────────────────────

async function aggregateCommandCenterData(orgId: string) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get all athletes in org
  const athletes = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "athlete"), eq(orgMemberships.status, "active")));

  const athleteIds = athletes.map((a) => a.userId);
  const totalAthletes = athleteIds.length;

  // Latest status snapshots per athlete
  const snapshots: any[] = [];
  for (const aid of athleteIds) {
    const [snap] = await db
      .select()
      .from(athleteStatusSnapshots)
      .where(and(eq(athleteStatusSnapshots.orgId, orgId), eq(athleteStatusSnapshots.athleteUserId, aid)))
      .orderBy(desc(athleteStatusSnapshots.generatedAt))
      .limit(1);
    if (snap) snapshots.push(snap);
  }

  const greenCount = snapshots.filter((s) => s.riskLevel === "green").length;
  const yellowCount = snapshots.filter((s) => s.riskLevel === "yellow").length;
  const redCount = snapshots.filter((s) => s.riskLevel === "red").length;

  const avgStatusScore =
    snapshots.length > 0
      ? Math.round(snapshots.reduce((acc, s) => acc + (s.statusScore ?? 0), 0) / snapshots.length)
      : 0;

  // Active risk flags
  const riskFlags = await db
    .select()
    .from(athleteRiskFlags)
    .where(and(eq(athleteRiskFlags.orgId, orgId), eq(athleteRiskFlags.status, "active")))
    .orderBy(desc(athleteRiskFlags.createdAt))
    .limit(50);

  // Pending interventions
  const interventions = await db
    .select()
    .from(athleteInterventionRecommendations)
    .where(and(eq(athleteInterventionRecommendations.orgId, orgId), eq(athleteInterventionRecommendations.status, "pending")))
    .orderBy(desc(athleteInterventionRecommendations.createdAt))
    .limit(20);

  // Recent workout completions (last 7 days)
  const recentCompletions = await db
    .select()
    .from(workoutCompletionLogs)
    .where(and(eq(workoutCompletionLogs.orgId, orgId), gte(workoutCompletionLogs.completedAt, sevenDaysAgo)))
    .orderBy(desc(workoutCompletionLogs.completedAt));

  // Recent readiness checkins (last 7 days)
  const recentCheckins = await db
    .select()
    .from(workoutReadinessCheckins)
    .where(and(eq(workoutReadinessCheckins.orgId, orgId), gte(workoutReadinessCheckins.createdAt, sevenDaysAgo)));

  const avgReadiness =
    recentCheckins.length > 0
      ? Math.round(recentCheckins.reduce((acc, c) => acc + c.readinessScore, 0) / recentCheckins.length)
      : 0;

  // PR entries (last 7 days = "this week PRs")
  const weekPRs = await db
    .select()
    .from(prLiftEntries)
    .where(and(eq(prLiftEntries.orgId, orgId), gte(prLiftEntries.createdAt, sevenDaysAgo)))
    .orderBy(desc(prLiftEntries.createdAt))
    .limit(30);

  // Education compliance
  const educationProgressData = await db
    .select()
    .from(educationProgress)
    .where(and(eq(educationProgress.orgId, orgId), gte(educationProgress.updatedAt, thirtyDaysAgo)));

  const completedModules = educationProgressData.filter((e) => e.status === "completed").length;
  const totalModuleEnrollments = educationProgressData.length;
  const educationComplianceRate =
    totalModuleEnrollments > 0 ? Math.round((completedModules / totalModuleEnrollments) * 100) : 0;

  // Athlete streaks — top performers
  const streaks = await db
    .select()
    .from(athleteStreaks)
    .where(eq(athleteStreaks.orgId, orgId))
    .orderBy(desc(athleteStreaks.currentStreak))
    .limit(10);

  // Enrich snapshots with names
  const snapshotsWithNames: any[] = [];
  for (const snap of snapshots) {
    const [user] = await db.select().from(orgUsers).where(eq(orgUsers.id, snap.athleteUserId)).limit(1);
    snapshotsWithNames.push({ ...snap, athleteName: user?.name ?? "Unknown" });
  }

  // Build athlete risk overview (highest-risk first)
  const highestRisk = snapshotsWithNames
    .filter((s) => s.riskLevel !== "green")
    .sort((a, b) => (a.statusScore ?? 0) - (b.statusScore ?? 0))
    .slice(0, 5);

  // Determine missed workouts (athletes with no completions in 7 days but who have snapshots)
  const athletesWithCompletions = new Set(recentCompletions.map((c) => c.athleteUserId));
  const inactiveAthletes = athleteIds.filter((id) => !athletesWithCompletions.has(id));

  // Low readiness alerts (readiness < 50)
  const lowReadinessCheckins = recentCheckins.filter((c) => c.readinessScore < 50);
  const lowReadinessAthletes = [...new Set(lowReadinessCheckins.map((c) => c.athleteUserId))];

  return {
    totalAthletes,
    riskOverview: { green: greenCount, yellow: yellowCount, red: redCount },
    avgStatusScore,
    avgReadiness,
    highestRiskAthletes: highestRisk,
    allSnapshots: snapshotsWithNames,
    riskFlags: riskFlags.slice(0, 10),
    interventions: interventions.slice(0, 10),
    recentCompletions: recentCompletions.length,
    weekPRs: weekPRs.length,
    topStreaks: streaks.slice(0, 5),
    educationComplianceRate,
    completedModules,
    totalModuleEnrollments,
    lowReadinessAthleteCount: lowReadinessAthletes.length,
    inactiveAthleteCount: inactiveAthletes.length,
    recentPREntries: weekPRs.slice(0, 5),
    activeRiskFlagCount: riskFlags.length,
    pendingInterventionCount: interventions.length,
  };
}

// ─── AI Briefing Generator ────────────────────────────────────────────────────

async function generateAIBriefing(data: any): Promise<any> {
  const prompt = `You are a professional coaching operations AI assistant for a strength and conditioning platform.

Based on the following athlete data for today, generate a concise daily coaching briefing.

DATA:
- Total Athletes: ${data.totalAthletes}
- Risk Distribution: ${data.riskOverview.green} green, ${data.riskOverview.yellow} yellow, ${data.riskOverview.red} red
- Average Status Score: ${data.avgStatusScore}/100
- Average Readiness (7-day): ${data.avgReadiness}/100
- Active Risk Flags: ${data.activeRiskFlagCount}
- Pending Interventions: ${data.pendingInterventionCount}
- Workouts Completed (7 days): ${data.recentCompletions}
- PRs Set This Week: ${data.weekPRs}
- Education Compliance: ${data.educationComplianceRate}%
- Low Readiness Athletes: ${data.lowReadinessAthleteCount}
- Inactive Athletes (7 days): ${data.inactiveAthleteCount}
- Highest Risk Athletes: ${data.highestRiskAthletes.map((a: any) => `${a.athleteName} (score: ${a.statusScore}, ${a.riskLevel})`).join(", ") || "None"}
- Top Streak Leaders: ${data.topStreaks.map((s: any) => `${s.currentStreak}-day streak`).join(", ") || "None"}

Return a JSON object with this exact structure:
{
  "topPriorities": ["string", "string", "string"],
  "positiveWins": ["string", "string"],
  "recommendedActions": [
    { "action": "string", "urgency": "high|medium|low", "athleteContext": "string" }
  ],
  "insightCards": [
    { "insight": "string", "type": "performance|compliance|readiness|engagement" }
  ],
  "followUpPriority": [
    { "reason": "string", "severity": "high|medium|low", "athleteCount": number }
  ],
  "coachTasks": [
    { "task": "string", "type": "review|approve|assign|follow_up|adjust", "priority": "high|medium|low" }
  ],
  "summary": "string"
}

Rules:
- topPriorities: 3 most important operational items right now
- positiveWins: 2 genuine positive outcomes or trends
- recommendedActions: 3-4 specific coaching actions to take today
- insightCards: 2-3 concise AI-generated insights about patterns (non-medical)
- followUpPriority: ordered list of who needs follow-up and why
- coachTasks: 4-5 auto-generated tasks for today
- summary: 1-2 sentence executive summary of today's operations
- Tone: professional coaching operations assistant, non-medical, action-oriented
- Focus on operational coaching intelligence, not medical advice`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No AI response");
  return JSON.parse(content);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function registerCoachCommandCenterRoutes(app: Express) {
  // GET /api/org/command-center — get latest briefing + command center data
  app.get("/api/org/command-center", requireCoach, async (req: any, res) => {
    try {
      const { orgId } = req._orgAuth;

      // Gather operational data
      const data = await aggregateCommandCenterData(orgId);

      // Get latest briefing for today (if any)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [latestBriefing] = await db
        .select()
        .from(coachDailyBriefings)
        .where(and(eq(coachDailyBriefings.orgId, orgId), gte(coachDailyBriefings.generatedAt, todayStart)))
        .orderBy(desc(coachDailyBriefings.generatedAt))
        .limit(1);

      res.json({
        commandCenter: data,
        briefing: latestBriefing ?? null,
        briefingGeneratedAt: latestBriefing?.generatedAt ?? null,
      });
    } catch (err: any) {
      console.error("Command center error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/org/command-center/regenerate-briefing — generate new AI briefing
  app.post("/api/org/command-center/regenerate-briefing", requireCoach, async (req: any, res) => {
    try {
      const { orgId, userId } = req._orgAuth;

      const data = await aggregateCommandCenterData(orgId);
      const briefingContent = await generateAIBriefing(data);

      const [inserted] = await db
        .insert(coachDailyBriefings)
        .values({
          orgId,
          briefing: briefingContent,
          generatedBy: userId,
          summary: briefingContent.summary ?? "",
        })
        .returning();

      res.json({ briefing: inserted, commandCenter: data });
    } catch (err: any) {
      console.error("Regenerate briefing error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/org/command-center/history — get briefing history
  app.get("/api/org/command-center/history", requireCoach, async (req: any, res) => {
    try {
      const { orgId } = req._orgAuth;

      const history = await db
        .select()
        .from(coachDailyBriefings)
        .where(eq(coachDailyBriefings.orgId, orgId))
        .orderBy(desc(coachDailyBriefings.generatedAt))
        .limit(30);

      res.json({ history });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
