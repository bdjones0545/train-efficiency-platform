import type { Express } from "express";
import { db } from "./db";
import {
  orgUsers, orgMemberships,
  workoutCompletionLogs, workoutReadinessCheckins, workoutSetLogs,
  athleteStreaks, educationProgress,
  athleteStatusSnapshots, athleteRiskFlags, athleteInterventionRecommendations,
  prLiftEntries, prLiftTypes,
} from "@shared/schema";
import { eq, and, desc, asc, gte, sql as drizzleSql } from "drizzle-orm";
import { hashAuthToken } from "./lib/auth-token";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Auth (reuse same 3-path pattern) ────────────────────────────────────────
import { coachProfiles, userProfiles } from "@shared/schema";

async function resolveCoachAuth(req: any, res: any, next: any) {
  try {
    if (req.user) {
      const uid: string = req.user?.claims?.sub ?? req.user?.id;
      const [coach] = await db.select().from(coachProfiles).where(eq(coachProfiles.userId, uid)).limit(1);
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, uid)).limit(1);
      const orgId = coach?.organizationId ?? profile?.organizationId ?? null;
      if (!orgId) return res.status(403).json({ message: "No organization" });
      req._auth = { userId: uid, orgId };
      return next();
    }
    const authHeader = req.headers.authorization as string | undefined;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const result = await db.execute(drizzleSql`SELECT user_id FROM auth_tokens WHERE token = ${hashAuthToken(authHeader.slice(7))} AND expires_at > NOW() LIMIT 1`);
        if (result.rows.length > 0) {
          const uid = (result.rows[0] as any).user_id as string;
          const [coach] = await db.select().from(coachProfiles).where(eq(coachProfiles.userId, uid)).limit(1);
          const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, uid)).limit(1);
          const orgId = coach?.organizationId ?? profile?.organizationId ?? null;
          if (orgId) { req._auth = { userId: uid, orgId }; return next(); }
        }
      } catch {}
    }
    const orgToken = req.headers["x-org-auth-token"] as string | undefined;
    if (orgToken) {
      try {
        const result = await db.execute(drizzleSql`SELECT user_id, org_id FROM org_sessions WHERE token_hash = ${orgToken} AND expires_at > NOW() LIMIT 1`);
        if (result.rows.length > 0) {
          const row = result.rows[0] as any;
          req._auth = { userId: row.user_id, orgId: row.org_id };
          return next();
        }
      } catch {}
    }
    return res.status(401).json({ message: "Not authenticated" });
  } catch (e) {
    return res.status(500).json({ message: "Auth error" });
  }
}

// ─── Date helpers ──────────────────────────────────────────────────────────────
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function dateKey(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

// ─── Register routes ──────────────────────────────────────────────────────────
export function registerAthleteProfileRoutes(app: Express) {

  // ── GET /api/org/athlete-profile/:userId ─────────────────────────────────────
  app.get("/api/org/athlete-profile/:userId", resolveCoachAuth, async (req: any, res) => {
    const { orgId } = req._auth;
    const { userId } = req.params;

    // Athlete user record
    const [user] = await db.select().from(orgUsers).where(eq(orgUsers.id, userId)).limit(1);
    const [membership] = await db.select().from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId))).limit(1);

    // Status snapshot (latest)
    const [snapshot] = await db.select().from(athleteStatusSnapshots)
      .where(and(eq(athleteStatusSnapshots.orgId, orgId), eq(athleteStatusSnapshots.athleteUserId, userId)))
      .orderBy(desc(athleteStatusSnapshots.generatedAt)).limit(1);

    // Streak
    const [streak] = await db.select().from(athleteStreaks)
      .where(and(eq(athleteStreaks.orgId, orgId), eq(athleteStreaks.athleteUserId, userId))).limit(1);

    // Readiness last 30 days
    const readinessCheckins = await db.select().from(workoutReadinessCheckins)
      .where(and(
        eq(workoutReadinessCheckins.orgId, orgId),
        eq(workoutReadinessCheckins.athleteUserId, userId),
        gte(workoutReadinessCheckins.createdAt, daysAgo(30)),
      ))
      .orderBy(desc(workoutReadinessCheckins.createdAt)).limit(30);

    // Workout completions last 60 days
    const completions = await db.select().from(workoutCompletionLogs)
      .where(and(
        eq(workoutCompletionLogs.orgId, orgId),
        eq(workoutCompletionLogs.athleteUserId, userId),
        gte(workoutCompletionLogs.completedAt, daysAgo(60)),
      ))
      .orderBy(desc(workoutCompletionLogs.completedAt)).limit(60);

    // Education progress
    const eduProgress = await db.select().from(educationProgress)
      .where(and(eq(educationProgress.orgId, orgId), eq(educationProgress.athleteUserId, userId)))
      .orderBy(desc(educationProgress.updatedAt)).limit(50);

    // Risk flags (active)
    const riskFlags = await db.select().from(athleteRiskFlags)
      .where(and(
        eq(athleteRiskFlags.orgId, orgId),
        eq(athleteRiskFlags.athleteUserId, userId),
        eq(athleteRiskFlags.status, "active"),
      ))
      .orderBy(desc(athleteRiskFlags.createdAt)).limit(10);

    // Interventions / Coach notes
    const interventions = await db.select().from(athleteInterventionRecommendations)
      .where(and(
        eq(athleteInterventionRecommendations.orgId, orgId),
        eq(athleteInterventionRecommendations.athleteUserId, userId),
      ))
      .orderBy(desc(athleteInterventionRecommendations.createdAt)).limit(20);

    // PR entries (latest per lift type)
    const prEntries = await db.select({
      entry: prLiftEntries,
      liftName: prLiftTypes.name,
      unit: prLiftTypes.unit,
    })
      .from(prLiftEntries)
      .leftJoin(prLiftTypes, eq(prLiftEntries.liftTypeId, prLiftTypes.id))
      .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, userId)))
      .orderBy(desc(prLiftEntries.createdAt)).limit(50);

    // Set logs (for RPE trends)
    const setLogs = await db.select().from(workoutSetLogs)
      .where(and(
        eq(workoutSetLogs.orgId, orgId),
        eq(workoutSetLogs.athleteUserId, userId),
        gte(workoutSetLogs.createdAt, daysAgo(30)),
      ))
      .orderBy(desc(workoutSetLogs.createdAt)).limit(100);

    // ── Compute health snapshot ──
    const avgReadiness = readinessCheckins.length > 0
      ? Math.round(readinessCheckins.reduce((s, r) => s + r.readinessScore, 0) / readinessCheckins.length)
      : null;
    const avgFatigue = readinessCheckins.filter(r => r.fatigueLevel != null).length > 0
      ? Math.round(readinessCheckins.filter(r => r.fatigueLevel != null).reduce((s, r) => s + (r.fatigueLevel ?? 0), 0) / readinessCheckins.filter(r => r.fatigueLevel != null).length)
      : null;
    const avgSoreness = readinessCheckins.filter(r => r.sorenessLevel != null).length > 0
      ? Math.round(readinessCheckins.filter(r => r.sorenessLevel != null).reduce((s, r) => s + (r.sorenessLevel ?? 0), 0) / readinessCheckins.filter(r => r.sorenessLevel != null).length)
      : null;
    const totalEdu = eduProgress.length;
    const completedEdu = eduProgress.filter(e => e.status === "completed").length;
    const educationPct = totalEdu > 0 ? Math.round((completedEdu / totalEdu) * 100) : null;
    const avgQuiz = eduProgress.filter(e => e.quizScore != null).length > 0
      ? Math.round(eduProgress.filter(e => e.quizScore != null).reduce((s, e) => s + (e.quizScore ?? 0), 0) / eduProgress.filter(e => e.quizScore != null).length)
      : null;
    const adherencePct = completions.length > 0 ? snapshot?.adherenceScore ?? null : null;

    // ── Group PRs by lift type ──
    const prsByLift: Record<string, { liftName: string; unit: string; best: number; entries: any[] }> = {};
    for (const { entry, liftName, unit } of prEntries) {
      const name = liftName ?? entry.liftTypeId;
      if (!prsByLift[name]) prsByLift[name] = { liftName: name, unit: unit ?? "lbs", best: 0, entries: [] };
      prsByLift[name].entries.push({ value: entry.value, date: entry.entryDate, notes: entry.notes });
      if (entry.value > prsByLift[name].best) prsByLift[name].best = entry.value;
    }

    res.json({
      user: user ?? { id: userId, name: "Unknown Athlete", email: "" },
      membership: membership ?? null,
      snapshot: snapshot ?? null,
      streak: streak ?? { currentStreak: 0, longestStreak: 0, totalSessionsCompleted: 0 },
      healthSnapshot: {
        avgReadiness, avgFatigue, avgSoreness, adherencePct,
        educationPct, avgQuiz, recentCheckins: readinessCheckins.length,
      },
      recentCompletions: completions.slice(0, 10),
      eduProgress: { total: totalEdu, completed: completedEdu, pct: educationPct, items: eduProgress.slice(0, 10) },
      riskFlags,
      interventions: interventions.filter(i => i.recommendationType !== "coach_note"),
      coachNotes: interventions.filter(i => i.recommendationType === "coach_note"),
      prs: Object.values(prsByLift),
      setLogCount: setLogs.length,
    });
  });

  // ── GET /api/org/athlete-profile/:userId/graphs ───────────────────────────────
  app.get("/api/org/athlete-profile/:userId/graphs", resolveCoachAuth, async (req: any, res) => {
    const { orgId } = req._auth;
    const { userId } = req.params;
    const range = parseInt(req.query.range as string) || 30;

    // Readiness trend
    const readinessCheckins = await db.select().from(workoutReadinessCheckins)
      .where(and(
        eq(workoutReadinessCheckins.orgId, orgId),
        eq(workoutReadinessCheckins.athleteUserId, userId),
        gte(workoutReadinessCheckins.createdAt, daysAgo(range)),
      ))
      .orderBy(asc(workoutReadinessCheckins.createdAt));

    const readinessSeries = readinessCheckins.map(r => ({
      date: dateKey(r.createdAt),
      readiness: r.readinessScore,
      fatigue: r.fatigueLevel,
      soreness: r.sorenessLevel,
      sleep: r.sleepQuality,
      motivation: r.motivationLevel,
    }));

    // Workout completions per week
    const completions = await db.select().from(workoutCompletionLogs)
      .where(and(
        eq(workoutCompletionLogs.orgId, orgId),
        eq(workoutCompletionLogs.athleteUserId, userId),
        gte(workoutCompletionLogs.completedAt, daysAgo(range)),
      ))
      .orderBy(asc(workoutCompletionLogs.completedAt));

    const adherenceSeries = completions.map(c => ({
      date: dateKey(c.completedAt),
      rating: c.rating,
      completed: 1,
    }));

    // RPE trend from set logs
    const setLogs = await db.select().from(workoutSetLogs)
      .where(and(
        eq(workoutSetLogs.orgId, orgId),
        eq(workoutSetLogs.athleteUserId, userId),
        gte(workoutSetLogs.createdAt, daysAgo(range)),
      ))
      .orderBy(asc(workoutSetLogs.createdAt));

    const rpeSeries = setLogs
      .filter(s => s.rpe != null)
      .map(s => ({ date: dateKey(s.createdAt), rpe: s.rpe, exercise: s.exerciseName }));

    // PR progression by lift type
    const prEntries = await db.select({
      entry: prLiftEntries,
      liftName: prLiftTypes.name,
      unit: prLiftTypes.unit,
    })
      .from(prLiftEntries)
      .leftJoin(prLiftTypes, eq(prLiftEntries.liftTypeId, prLiftTypes.id))
      .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, userId)))
      .orderBy(asc(prLiftEntries.entryDate));

    const prByLift: Record<string, any[]> = {};
    for (const { entry, liftName } of prEntries) {
      const k = liftName ?? entry.liftTypeId;
      if (!prByLift[k]) prByLift[k] = [];
      prByLift[k].push({ date: entry.entryDate, value: entry.value, unit: entry.unit });
    }

    // Education completion over time
    const eduCompleted = await db.select().from(educationProgress)
      .where(and(
        eq(educationProgress.orgId, orgId),
        eq(educationProgress.athleteUserId, userId),
        gte(educationProgress.updatedAt, daysAgo(range)),
      ))
      .orderBy(asc(educationProgress.updatedAt));

    const eduSeries = eduCompleted.filter(e => e.completedAt).map(e => ({
      date: dateKey(e.completedAt),
      status: e.status,
      quizScore: e.quizScore,
    }));

    res.json({ readinessSeries, adherenceSeries, rpeSeries, prByLift, eduSeries });
  });

  // ── GET /api/org/athlete-profile/:userId/timeline ─────────────────────────────
  app.get("/api/org/athlete-profile/:userId/timeline", resolveCoachAuth, async (req: any, res) => {
    const { orgId } = req._auth;
    const { userId } = req.params;
    const { type } = req.query; // "all" | "workout" | "pr" | "education" | "readiness" | "intervention"

    const events: any[] = [];

    // Workout completions
    if (!type || type === "all" || type === "workout") {
      const completions = await db.select().from(workoutCompletionLogs)
        .where(and(eq(workoutCompletionLogs.orgId, orgId), eq(workoutCompletionLogs.athleteUserId, userId)))
        .orderBy(desc(workoutCompletionLogs.completedAt)).limit(30);
      for (const c of completions) {
        events.push({ type: "workout", icon: "🏋️", date: c.completedAt, title: "Workout Completed", detail: c.notes, rating: c.rating, id: c.id });
      }
    }

    // PR entries
    if (!type || type === "all" || type === "pr") {
      const prs = await db.select({ entry: prLiftEntries, liftName: prLiftTypes.name })
        .from(prLiftEntries)
        .leftJoin(prLiftTypes, eq(prLiftEntries.liftTypeId, prLiftTypes.id))
        .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, userId)))
        .orderBy(desc(prLiftEntries.createdAt)).limit(20);
      for (const { entry, liftName } of prs) {
        events.push({ type: "pr", icon: "🏆", date: entry.createdAt, title: `PR: ${liftName ?? "Lift"}`, detail: `${entry.value} ${entry.unit}`, notes: entry.notes, id: entry.id });
      }
    }

    // Readiness check-ins
    if (!type || type === "all" || type === "readiness") {
      const checkins = await db.select().from(workoutReadinessCheckins)
        .where(and(eq(workoutReadinessCheckins.orgId, orgId), eq(workoutReadinessCheckins.athleteUserId, userId)))
        .orderBy(desc(workoutReadinessCheckins.createdAt)).limit(20);
      for (const c of checkins) {
        const score = c.readinessScore;
        const icon = score >= 7 ? "🟢" : score >= 4 ? "🟡" : "🔴";
        events.push({ type: "readiness", icon, date: c.createdAt, title: `Readiness Check-in`, detail: `Score: ${score}/10`, id: c.id });
      }
    }

    // Education completions
    if (!type || type === "all" || type === "education") {
      const edu = await db.select().from(educationProgress)
        .where(and(eq(educationProgress.orgId, orgId), eq(educationProgress.athleteUserId, userId), eq(educationProgress.status, "completed")))
        .orderBy(desc(educationProgress.completedAt)).limit(15);
      for (const e of edu) {
        events.push({ type: "education", icon: "📚", date: e.completedAt, title: "Module Completed", detail: e.quizScore ? `Quiz: ${e.quizScore}%` : undefined, id: e.id });
      }
    }

    // Interventions
    if (!type || type === "all" || type === "intervention") {
      const interventions = await db.select().from(athleteInterventionRecommendations)
        .where(and(eq(athleteInterventionRecommendations.orgId, orgId), eq(athleteInterventionRecommendations.athleteUserId, userId)))
        .orderBy(desc(athleteInterventionRecommendations.createdAt)).limit(15);
      for (const i of interventions) {
        const icon = i.severity === "critical" ? "🚨" : i.severity === "warning" ? "⚠️" : "💡";
        events.push({ type: i.recommendationType === "coach_note" ? "note" : "intervention", icon, date: i.createdAt, title: i.title, detail: i.summary, id: i.id });
      }
    }

    // Sort by date desc
    events.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db_ = b.date ? new Date(b.date).getTime() : 0;
      return db_ - da;
    });

    res.json({ events: events.slice(0, 60) });
  });

  // ── POST /api/org/athlete-profile/:userId/ai-summary ──────────────────────────
  app.post("/api/org/athlete-profile/:userId/ai-summary", resolveCoachAuth, async (req: any, res) => {
    const { orgId } = req._auth;
    const { userId } = req.params;

    // Fetch key data to give AI context
    const [user] = await db.select().from(orgUsers).where(eq(orgUsers.id, userId)).limit(1);
    const [snapshot] = await db.select().from(athleteStatusSnapshots)
      .where(and(eq(athleteStatusSnapshots.orgId, orgId), eq(athleteStatusSnapshots.athleteUserId, userId)))
      .orderBy(desc(athleteStatusSnapshots.generatedAt)).limit(1);
    const [streak] = await db.select().from(athleteStreaks)
      .where(and(eq(athleteStreaks.orgId, orgId), eq(athleteStreaks.athleteUserId, userId))).limit(1);
    const readiness = await db.select().from(workoutReadinessCheckins)
      .where(and(eq(workoutReadinessCheckins.orgId, orgId), eq(workoutReadinessCheckins.athleteUserId, userId), gte(workoutReadinessCheckins.createdAt, daysAgo(30))))
      .orderBy(desc(workoutReadinessCheckins.createdAt)).limit(14);
    const completions = await db.select().from(workoutCompletionLogs)
      .where(and(eq(workoutCompletionLogs.orgId, orgId), eq(workoutCompletionLogs.athleteUserId, userId), gte(workoutCompletionLogs.completedAt, daysAgo(30))))
      .limit(20);
    const prs = await db.select({ entry: prLiftEntries, liftName: prLiftTypes.name })
      .from(prLiftEntries).leftJoin(prLiftTypes, eq(prLiftEntries.liftTypeId, prLiftTypes.id))
      .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, userId)))
      .orderBy(desc(prLiftEntries.createdAt)).limit(10);
    const riskFlags = await db.select().from(athleteRiskFlags)
      .where(and(eq(athleteRiskFlags.orgId, orgId), eq(athleteRiskFlags.athleteUserId, userId), eq(athleteRiskFlags.status, "active"))).limit(5);
    const eduProgress = await db.select().from(educationProgress)
      .where(and(eq(educationProgress.orgId, orgId), eq(educationProgress.athleteUserId, userId))).limit(20);

    const avgReadiness = readiness.length > 0
      ? Math.round(readiness.reduce((s, r) => s + r.readinessScore, 0) / readiness.length)
      : null;
    const eduCompleted = eduProgress.filter(e => e.status === "completed").length;
    const prSummary = prs.slice(0, 4).map(p => `${p.liftName}: ${p.entry.value} ${p.entry.unit}`).join(", ");

    const prompt = `You are an S&C coach assistant. Write a concise, insightful 3-4 sentence athlete development summary for coaching purposes.

Athlete: ${user?.name ?? "Athlete"}
Status Score: ${snapshot?.statusScore ?? "N/A"}/100
Risk Level: ${snapshot?.riskLevel ?? "N/A"}
Current Streak: ${streak?.currentStreak ?? 0} days
Avg Readiness (30d): ${avgReadiness ?? "No data"}/10
Workout Completions (30d): ${completions.length}
Education: ${eduCompleted}/${eduProgress.length} modules complete
Recent PRs: ${prSummary || "No recent PRs"}
Active Risk Flags: ${riskFlags.map(f => f.title).join(", ") || "None"}

Guidelines:
- Be factual, specific, and actionable
- Note any positive trends or concerns
- Mention PRs if relevant
- Keep it professional — this is a coaching tool, not medical advice
- No diagnoses or injury predictions
- Write in third person using the athlete's first name`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
      });
      const summary = completion.choices[0].message.content ?? "";
      res.json({ summary, generatedAt: new Date().toISOString() });
    } catch {
      res.status(500).json({ error: "AI summary unavailable" });
    }
  });

  // ── POST /api/org/athlete-profile/:userId/notes ───────────────────────────────
  app.post("/api/org/athlete-profile/:userId/notes", resolveCoachAuth, async (req: any, res) => {
    const { orgId, userId: coachUserId } = req._auth;
    const { userId } = req.params;
    const { title, note, pinned } = req.body;
    if (!note) return res.status(400).json({ error: "note required" });

    const [created] = await db.insert(athleteInterventionRecommendations).values({
      orgId, athleteUserId: userId,
      recommendationType: "coach_note",
      generatedBy: coachUserId,
      title: title || "Coach Note",
      summary: note,
      severity: "info",
      status: pinned ? "pinned" : "pending",
    }).returning();

    res.json({ note: created });
  });

  // ── PATCH /api/org/athlete-profile/:userId/notes/:noteId ──────────────────────
  app.patch("/api/org/athlete-profile/:userId/notes/:noteId", resolveCoachAuth, async (req: any, res) => {
    const { noteId } = req.params;
    const { title, note, status } = req.body;
    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (note !== undefined) updates.summary = note;
    if (status !== undefined) updates.status = status;

    const [updated] = await db.update(athleteInterventionRecommendations)
      .set(updates).where(eq(athleteInterventionRecommendations.id, noteId)).returning();
    res.json({ note: updated });
  });

  // ── DELETE /api/org/athlete-profile/:userId/notes/:noteId ─────────────────────
  app.delete("/api/org/athlete-profile/:userId/notes/:noteId", resolveCoachAuth, async (req: any, res) => {
    const { noteId } = req.params;
    await db.delete(athleteInterventionRecommendations).where(eq(athleteInterventionRecommendations.id, noteId));
    res.json({ ok: true });
  });
}
