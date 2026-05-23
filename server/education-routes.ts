import type { Express } from "express";
import { db } from "./db";
import {
  educationPathways, educationModules, educationQuizQuestions,
  educationProgress, educationAssignments, educationAiGenerations,
  educationBadges, educationAthleteBadges,
  orgNotifications, orgActivityEvents,
  userProfiles, orgUsers,
} from "@shared/schema";
import { eq, and, inArray, desc, asc, sql as drizzleSql } from "drizzle-orm";
import { z } from "zod";
import { triggerNotificationEvent } from "./services/notification-automation";
import { createActivityEvent } from "./services/activity-timeline";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getUserId(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? null;
}

async function getOrgProfile(req: any) {
  const userId = getUserId(req);
  if (!userId) return null;
  const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return p ?? null;
}

function requireAuth(req: any, res: any, next: any) {
  (async () => {
    const p = await getOrgProfile(req);
    if (!p) return res.status(401).json({ message: "Unauthorized" });
    (req as any)._profile = p;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

function requireCoach(req: any, res: any, next: any) {
  (async () => {
    const p = await getOrgProfile(req);
    if (!p) return res.status(401).json({ message: "Unauthorized" });
    if (!["ADMIN", "COACH"].includes(p.role ?? "")) return res.status(403).json({ message: "Forbidden" });
    (req as any)._profile = p;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

// ─── Education AI System Prompt Builder ───────────────────────────────────────

interface EducationPromptOptions {
  ageGroup?: string;
  sport?: string;
  coachPhilosophy?: string;
  teachingStyle?: string;
  bannedTerms?: string;
  emphasisAreas?: string;
}

function readingLevelGuidance(ageGroup: string): string {
  const ag = ageGroup.toLowerCase();
  if (ag.includes("middle") || ag.includes("12") || ag.includes("13") || ag.includes("14")) {
    return `READING LEVEL — MIDDLE SCHOOL:
- Short sentences (max 15 words each)
- Zero jargon. Define any technical term immediately after using it
- One idea per section max
- Use simple, familiar words over advanced vocabulary
- Examples must reference familiar youth sports situations
- Quiz questions: straightforward scenarios, no complex multi-step reasoning`;
  }
  if (ag.includes("college") || ag.includes("pro") || ag.includes("professional") || ag.includes("adult")) {
    return `READING LEVEL — COLLEGE/PROFESSIONAL:
- Can handle scientific terminology with brief explanation
- Include deeper physiology where relevant (cellular energy systems, hormonal responses, etc.)
- Advanced recovery and periodization concepts are appropriate
- Examples may reference elite performance demands, sport science research
- Quiz questions: complex multi-factor scenarios requiring systems-level thinking`;
  }
  // Default: high school
  return `READING LEVEL — HIGH SCHOOL:
- Moderate complexity. Short to medium sentences. Clear paragraph structure
- Define jargon on first use, but can use it thereafter
- Examples must tie directly to practice, game day, and sport performance
- Connect concepts to things athletes encounter daily (soreness, energy, focus)
- Quiz questions: realistic game/practice scenarios that test practical judgment`;
}

function buildEducationSystemPrompt(options: EducationPromptOptions = {}): string {
  const { ageGroup = "high school athletes", sport = "athletes", coachPhilosophy, teachingStyle, bannedTerms, emphasisAreas } = options;

  const coachProfile = coachPhilosophy || teachingStyle
    ? `\nCOACH PHILOSOPHY & PREFERENCES:
${coachPhilosophy ? `- Philosophy: ${coachPhilosophy}` : ""}
${teachingStyle ? `- Teaching style: ${teachingStyle}` : ""}
${bannedTerms ? `- NEVER use these terms: ${bannedTerms}` : ""}
${emphasisAreas ? `- Emphasize: ${emphasisAreas}` : ""}
Apply these preferences throughout all generated content.`
    : "";

  return `You are an elite strength and conditioning coach writing education programs for ${sport}.

YOUR VOICE — teach like a high-level performance coach, not a textbook:
- Direct, confident, and actionable. No academic hedging
- Connect every concept immediately to on-field/court performance
- Use real sport examples: "After a two-hour practice in the heat...", "In the third quarter when your legs feel heavy..."
- Short, punchy sentences. Athletes stop reading long paragraphs
- Practical over theoretical. Teach the WHY, then tell them exactly WHAT TO DO
- Encouraging but professional. No empty hype or cheesy motivation

ANTI-SLOP RULES — never violate these:
- BANNED opener phrases: "In today's world...", "It's important to understand...", "The importance of...", "As an athlete...", "Did you know..."
- No filler sentences that restate what was just said
- No textbook definitions without immediate application
- No generic wellness language ("overall health and wellness", "holistic approach")
- No paragraphs longer than 4 sentences
- Each section must teach ONE concept with ONE practical application

${readingLevelGuidance(ageGroup)}
${coachProfile}

CONTENT SAFETY — NEVER violate:
- No medical diagnoses or treatment recommendations
- No specific calorie or macronutrient targets for individuals
- No supplement doses or specific product recommendations
- No body-shaming, weight-loss framing, or eating disorder adjacent language
- No extreme or unsafe recommendations
- Youth athletes (under 18): no supplement recommendations beyond hydration/food timing
- Always note when individual consultation with a sports dietitian is appropriate

OUTPUT FORMAT: Valid JSON only. No markdown fences, no extra text, no explanation outside the JSON.`;
}

// Legacy constant for any remaining endpoints that haven't been upgraded
const AI_SAFETY_SYSTEM = buildEducationSystemPrompt();

// ─── Slugify helper ───────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Get org athletes ─────────────────────────────────────────────────────────

async function getOrgAthletes(orgId: string): Promise<string[]> {
  const members = await db.select({ userId: orgUsers.userId })
    .from(orgUsers)
    .where(eq(orgUsers.organizationId, orgId));
  return members.map((m: any) => m.userId);
}

// ─── Register routes ──────────────────────────────────────────────────────────

export function registerEducationRoutes(app: Express) {

  // ── GET /api/org/education/pathways ─────────────────────────────────────────
  // Returns all pathways visible to this org (org-specific + default)
  app.get("/api/org/education/pathways", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;

      const rows = await db.select().from(educationPathways)
        .where(
          drizzleSql`(${educationPathways.orgId} = ${orgId} OR ${educationPathways.isDefault} = true)`
        )
        .orderBy(desc(educationPathways.isDefault), asc(educationPathways.createdAt));

      // For athletes: only published + assigned
      const userId = getUserId(req);
      const isCoach = ["ADMIN", "COACH"].includes(profile.role ?? "");

      let visible = rows;
      if (!isCoach) {
        // Get assignments for this athlete
        const assignments = await db.select().from(educationAssignments)
          .where(and(
            eq(educationAssignments.orgId, orgId),
          ));
        const assignedPathwayIds = new Set(assignments.map((a: any) => a.pathwayId));
        visible = rows.filter((p: any) =>
          (p.status === "published" && (p.isDefault || assignedPathwayIds.has(p.id)))
        );
      }

      // Attach module counts
      const pathwayIds = visible.map((p: any) => p.id);
      let moduleCountMap: Record<string, number> = {};
      if (pathwayIds.length > 0) {
        const moduleCounts = await db.select({
          pathwayId: educationModules.pathwayId,
          count: drizzleSql<number>`count(*)::int`,
        }).from(educationModules)
          .where(inArray(educationModules.pathwayId, pathwayIds))
          .groupBy(educationModules.pathwayId);
        moduleCounts.forEach((r: any) => { moduleCountMap[r.pathwayId] = r.count; });
      }

      // Attach athlete progress stats if athlete
      let progressMap: Record<string, any> = {};
      if (!isCoach && userId && pathwayIds.length > 0) {
        const progRows = await db.select().from(educationProgress)
          .where(and(
            eq(educationProgress.orgId, orgId),
            eq(educationProgress.athleteUserId, userId),
            inArray(educationProgress.pathwayId, pathwayIds),
          ));
        pathwayIds.forEach((pid) => {
          const pRows = progRows.filter((r: any) => r.pathwayId === pid);
          const total = moduleCountMap[pid] ?? 0;
          const completed = pRows.filter((r: any) => r.status === "completed").length;
          progressMap[pid] = { completed, total, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
        });
      }

      res.json({
        pathways: visible.map((p: any) => ({
          ...p,
          moduleCount: moduleCountMap[p.id] ?? 0,
          progress: progressMap[p.id] ?? null,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/pathways ────────────────────────────────────────
  app.post("/api/org/education/pathways", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { title, category, description } = req.body;
      if (!title) return res.status(400).json({ message: "title required" });

      const slug = slugify(title) + "-" + Date.now().toString(36);
      const [created] = await db.insert(educationPathways).values({
        orgId: profile.organizationId,
        createdByUserId: getUserId(req) ?? "",
        title,
        slug,
        category: category ?? "custom",
        description: description ?? "",
        status: "draft",
        isDefault: false,
      }).returning();

      res.json({ pathway: created });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH /api/org/education/pathways/:id ───────────────────────────────────
  app.patch("/api/org/education/pathways/:id", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { id } = req.params;
      const { title, description, category, status } = req.body;

      const updates: any = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (category !== undefined) updates.category = category;
      if (status !== undefined) updates.status = status;

      const [updated] = await db.update(educationPathways)
        .set(updates)
        .where(and(eq(educationPathways.id, id), eq(educationPathways.orgId, profile.organizationId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json({ pathway: updated });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/pathways/:id/publish ────────────────────────────
  app.post("/api/org/education/pathways/:id/publish", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { id } = req.params;
      const { action } = req.body; // "publish" | "unpublish" | "archive"

      const newStatus = action === "publish" ? "published"
        : action === "archive" ? "archived"
        : "draft";

      const [updated] = await db.update(educationPathways)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(and(eq(educationPathways.id, id), eq(educationPathways.orgId, profile.organizationId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json({ pathway: updated });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/pathways/:id/assign ─────────────────────────────
  app.post("/api/org/education/pathways/:id/assign", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { id } = req.params;
      const { assignedToType, athleteUserId, teamId, dueDate } = req.body;

      const userId = getUserId(req);
      const [assignment] = await db.insert(educationAssignments).values({
        orgId: profile.organizationId,
        pathwayId: id,
        assignedToType: assignedToType ?? "all_athletes",
        athleteUserId: athleteUserId ?? null,
        teamId: teamId ?? null,
        assignedByUserId: userId ?? "",
        dueDate: dueDate ? new Date(dueDate) : null,
      }).returning();

      // Notification hook
      try {
        const athleteIds = assignedToType === "all_athletes"
          ? await getOrgAthletes(profile.organizationId)
          : athleteUserId ? [athleteUserId] : [];
        for (const aid of athleteIds.slice(0, 20)) {
          await triggerNotificationEvent("education_pathway_assigned" as any, {
            organizationId: profile.organizationId,
            userId: aid,
            metadata: { pathwayId: id },
          });
        }
      } catch {}

      res.json({ assignment });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/education/pathways/:slug/modules ───────────────────────────
  app.get("/api/org/education/pathways/:slug/modules", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { slug } = req.params;
      const userId = getUserId(req);

      const [pathway] = await db.select().from(educationPathways)
        .where(eq(educationPathways.slug, slug))
        .limit(1);

      if (!pathway) return res.status(404).json({ message: "Pathway not found" });

      const isCoach = ["ADMIN", "COACH"].includes(profile.role ?? "");
      const modules = await db.select().from(educationModules)
        .where(
          isCoach
            ? eq(educationModules.pathwayId, pathway.id)
            : and(eq(educationModules.pathwayId, pathway.id), eq(educationModules.status, "published"))
        )
        .orderBy(asc(educationModules.moduleNumber));

      // Attach progress for athletes
      let progressMap: Record<string, any> = {};
      if (userId) {
        const progRows = await db.select().from(educationProgress)
          .where(and(
            eq(educationProgress.orgId, profile.organizationId),
            eq(educationProgress.athleteUserId, userId),
            eq(educationProgress.pathwayId, pathway.id),
          ));
        progRows.forEach((r: any) => { progressMap[r.moduleId] = r; });
      }

      // Attach quiz question counts
      const moduleIds = modules.map((m: any) => m.id);
      let quizCountMap: Record<string, number> = {};
      if (moduleIds.length > 0) {
        const qCounts = await db.select({
          moduleId: educationQuizQuestions.moduleId,
          count: drizzleSql<number>`count(*)::int`,
        }).from(educationQuizQuestions)
          .where(inArray(educationQuizQuestions.moduleId, moduleIds))
          .groupBy(educationQuizQuestions.moduleId);
        qCounts.forEach((r: any) => { quizCountMap[r.moduleId] = r.count; });
      }

      const total = modules.length;
      const completed = Object.values(progressMap).filter((p: any) => p.status === "completed").length;

      res.json({
        pathway,
        modules: modules.map((m: any) => ({
          ...m,
          progress: progressMap[m.id] ?? { status: "not_started", quizScore: null },
          quizCount: quizCountMap[m.id] ?? 0,
        })),
        stats: {
          total,
          completed,
          percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/education/modules/:moduleId/questions ───────────────────────
  app.get("/api/org/education/modules/:moduleId/questions", requireAuth, async (req: any, res) => {
    try {
      const { moduleId } = req.params;
      const isCoach = ["ADMIN", "COACH"].includes((req._profile.role ?? ""));

      const questions = await db.select().from(educationQuizQuestions)
        .where(eq(educationQuizQuestions.moduleId, moduleId))
        .orderBy(asc(educationQuizQuestions.createdAt));

      // Strip correct answers for athletes
      const sanitized = isCoach ? questions : questions.map((q: any) => ({
        id: q.id, question: q.question, options: q.options,
      }));

      res.json({ questions: sanitized });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/modules ─────────────────────────────────────────
  app.post("/api/org/education/modules", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { pathwayId, title, description, content, keyTakeaways, estimatedMinutes, status } = req.body;
      if (!pathwayId || !title) return res.status(400).json({ message: "pathwayId and title required" });

      // Get next module number
      const existing = await db.select({ n: educationModules.moduleNumber })
        .from(educationModules)
        .where(eq(educationModules.pathwayId, pathwayId))
        .orderBy(desc(educationModules.moduleNumber))
        .limit(1);
      const nextNum = (existing[0]?.n ?? 0) + 1;

      const { videoUrl, videoSearchQuery } = req.body;
      const [created] = await db.insert(educationModules).values({
        orgId: profile.organizationId,
        pathwayId,
        moduleNumber: nextNum,
        title,
        description: description ?? "",
        content: content ?? { sections: [] },
        keyTakeaways: keyTakeaways ?? [],
        estimatedMinutes: estimatedMinutes ?? 10,
        videoUrl: videoUrl ?? null,
        videoSearchQuery: videoSearchQuery ?? null,
        status: status ?? "draft",
      }).returning();

      res.json({ module: created });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH /api/org/education/modules/:id ────────────────────────────────────
  app.patch("/api/org/education/modules/:id", requireCoach, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { title, description, content, keyTakeaways, estimatedMinutes, status, videoUrl, videoSearchQuery, performanceConnection, coachReinforcementNotes } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (content !== undefined) updates.content = content;
      if (keyTakeaways !== undefined) updates.keyTakeaways = keyTakeaways;
      if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;
      if (status !== undefined) updates.status = status;
      if (videoUrl !== undefined) updates.videoUrl = videoUrl || null;
      if (videoSearchQuery !== undefined) updates.videoSearchQuery = videoSearchQuery || null;
      if (performanceConnection !== undefined) updates.performanceConnection = performanceConnection || null;
      if (coachReinforcementNotes !== undefined) updates.coachReinforcementNotes = coachReinforcementNotes;

      const [updated] = await db.update(educationModules)
        .set(updates)
        .where(eq(educationModules.id, id))
        .returning();

      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json({ module: updated });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/modules/:moduleId/start ─────────────────────────
  app.post("/api/org/education/modules/:moduleId/start", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { moduleId } = req.params;
      const { pathwayId } = req.body;
      const userId = getUserId(req)!;

      const existing = await db.select().from(educationProgress)
        .where(and(
          eq(educationProgress.orgId, profile.organizationId),
          eq(educationProgress.athleteUserId, userId),
          eq(educationProgress.moduleId, moduleId),
        )).limit(1);

      if (existing.length === 0) {
        await db.insert(educationProgress).values({
          orgId: profile.organizationId,
          pathwayId: pathwayId ?? "",
          moduleId,
          athleteUserId: userId,
          status: "in_progress",
        }).onConflictDoNothing();
      }

      res.json({ status: "in_progress" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/modules/:moduleId/quiz ──────────────────────────
  app.post("/api/org/education/modules/:moduleId/quiz", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { moduleId } = req.params;
      const { answers, pathwayId } = req.body; // answers: { [questionId]: selectedIndex }
      const userId = getUserId(req)!;

      // Fetch questions with correct answers
      const questions = await db.select().from(educationQuizQuestions)
        .where(eq(educationQuizQuestions.moduleId, moduleId));

      if (questions.length === 0) return res.status(400).json({ message: "No quiz questions found" });

      let correct = 0;
      const results = questions.map((q: any) => {
        const submitted = answers?.[q.id] ?? -1;
        const isCorrect = submitted === q.correctAnswer;
        if (isCorrect) correct++;
        return {
          questionId: q.id,
          question: q.question,
          submittedIndex: submitted,
          correctIndex: q.correctAnswer,
          isCorrect,
          explanation: q.explanation,
          options: q.options,
        };
      });

      const score = Math.round((correct / questions.length) * 100);
      const passed = score >= 80;
      const status = passed ? "completed" : "in_progress";

      // Upsert progress
      const existingRows = await db.select().from(educationProgress)
        .where(and(
          eq(educationProgress.orgId, profile.organizationId),
          eq(educationProgress.athleteUserId, userId),
          eq(educationProgress.moduleId, moduleId),
        )).limit(1);

      const shouldUpdate = passed || (existingRows[0]?.status !== "completed");
      if (shouldUpdate) {
        if (existingRows.length > 0) {
          await db.update(educationProgress)
            .set({
              status,
              quizScore: score,
              completedAt: passed ? new Date() : null,
              updatedAt: new Date(),
            })
            .where(eq(educationProgress.id, existingRows[0].id));
        } else {
          await db.insert(educationProgress).values({
            orgId: profile.organizationId,
            pathwayId: pathwayId ?? "",
            moduleId,
            athleteUserId: userId,
            status,
            quizScore: score,
            completedAt: passed ? new Date() : null,
          }).onConflictDoNothing();
        }
      }

      // Notification hooks
      if (passed) {
        try {
          await triggerNotificationEvent("education_module_completed" as any, {
            organizationId: profile.organizationId,
            userId,
            metadata: { moduleId, score, pathwayId },
          });
          await createActivityEvent({
            orgId: profile.organizationId,
            userId,
            eventType: "education_module_completed",
            eventDate: new Date(),
            metadata: { moduleId, score, pathwayId },
            visibility: "coach",
          });

          // Check if pathway is complete
          if (pathwayId) {
            const allModules = await db.select().from(educationModules)
              .where(and(eq(educationModules.pathwayId, pathwayId), eq(educationModules.status, "published")));
            const allProgress = await db.select().from(educationProgress)
              .where(and(
                eq(educationProgress.orgId, profile.organizationId),
                eq(educationProgress.athleteUserId, userId),
                eq(educationProgress.pathwayId, pathwayId),
              ));
            const completedIds = new Set(allProgress.filter((p: any) => p.status === "completed").map((p: any) => p.moduleId));
            const allDone = allModules.every((m: any) => completedIds.has(m.id));
            if (allDone) {
              await triggerNotificationEvent("education_pathway_completed" as any, {
                organizationId: profile.organizationId,
                userId,
                metadata: { pathwayId },
              });

              // Auto-award badge if one exists for this pathway
              try {
                const [badge] = await db.select().from(educationBadges)
                  .where(and(
                    eq(educationBadges.pathwayId, pathwayId),
                    eq(educationBadges.isDefault, true),
                  )).limit(1);
                if (badge) {
                  const [alreadyEarned] = await db.select().from(educationAthleteBadges)
                    .where(and(
                      eq(educationAthleteBadges.athleteUserId, userId),
                      eq(educationAthleteBadges.badgeId, badge.id),
                    )).limit(1);
                  if (!alreadyEarned) {
                    await db.insert(educationAthleteBadges).values({
                      orgId: profile.organizationId,
                      athleteUserId: userId,
                      badgeId: badge.id,
                      pathwayId,
                      metadata: { source: "pathway_completion" },
                    });
                    await db.insert(orgNotifications).values({
                      orgId: profile.organizationId,
                      userId,
                      type: "badge_earned",
                      title: `🏅 Badge Earned: ${badge.name}`,
                      message: badge.description ?? `You earned the ${badge.name} badge!`,
                      metadata: { badgeId: badge.id, pathwayId },
                    });
                  }
                }
              } catch {}
            }
          }
        } catch {}
      } else {
        try {
          await triggerNotificationEvent("quiz_failed_multiple_times" as any, {
            organizationId: profile.organizationId,
            userId,
            metadata: { moduleId, score },
          });
        } catch {}
      }

      res.json({ score, passed, results, totalQuestions: questions.length, correct });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/quiz-questions ──────────────────────────────────
  // Coach: add/replace quiz questions for a module
  app.post("/api/org/education/quiz-questions", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { moduleId, pathwayId, questions } = req.body;
      if (!moduleId || !Array.isArray(questions)) return res.status(400).json({ message: "moduleId and questions required" });

      // Delete existing, then insert new
      await db.delete(educationQuizQuestions).where(eq(educationQuizQuestions.moduleId, moduleId));

      const inserted = await db.insert(educationQuizQuestions).values(
        questions.map((q: any) => ({
          orgId: profile.organizationId,
          pathwayId: pathwayId ?? "",
          moduleId,
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation ?? "",
        }))
      ).returning();

      res.json({ questions: inserted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/ai/generate-full-pathway ────────────────────────
  // One-shot: generates complete pathway with module content, quizzes, video search queries
  app.post("/api/org/education/ai/generate-full-pathway", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const { prompt, ageGroup, sport, numModules, difficulty, coachPhilosophy, teachingStyle, bannedTerms, emphasisAreas } = req.body;
      if (!prompt) return res.status(400).json({ message: "prompt required" });

      const resolvedAge = ageGroup ?? "high school athletes";
      const resolvedSport = sport ?? "athletes";
      const resolvedModules = numModules ?? 4;
      const resolvedDifficulty = difficulty ?? "beginner to intermediate";

      const systemPrompt = buildEducationSystemPrompt({ ageGroup: resolvedAge, sport: resolvedSport, coachPhilosophy, teachingStyle, bannedTerms, emphasisAreas });

      const userPrompt = `Create a COMPLETE, publish-ready athlete education program.

COACH REQUEST: "${prompt}"

PROGRAM PARAMETERS:
- Age Group: ${resolvedAge}
- Sport / Team: ${resolvedSport}
- Modules: ${resolvedModules}
- Difficulty: ${resolvedDifficulty}

Return a JSON object with this EXACT structure. Every field is required:
{
  "pathway": {
    "title": "Short, direct program title (max 6 words)",
    "description": "2 sentences. Sentence 1: what athletes will learn. Sentence 2: how it connects to performance.",
    "category": "one of: nutrition, recovery, hydration, sleep, mindset, team_standards, injury_prevention, custom"
  },
  "modules": [
    {
      "moduleNumber": 1,
      "title": "Direct, action-oriented module title",
      "description": "1-2 sentences. Name the concept and its direct performance impact.",
      "estimatedMinutes": 12,
      "videoSearchQuery": "Specific YouTube search string (e.g. 'pre-game meal timing athlete performance Dr Andy Galpin')",
      "performanceConnection": "2-3 sentences explaining EXACTLY how this concept affects game/practice performance, recovery, or readiness. Be specific. Use sport-relevant examples.",
      "sections": [
        {
          "title": "Direct section heading (not 'Introduction' — name the concept)",
          "body": "3-4 punchy sentences. Teach one idea. Include one sport-specific example. End with a practical action or implication."
        }
      ],
      "keyTakeaways": [
        "Concise, actionable statement an athlete can remember and act on",
        "Another specific takeaway connected to performance",
        "A third takeaway that reinforces behavior change"
      ],
      "coachReinforcementNotes": [
        "Discussion prompt or question to ask athletes at practice",
        "Observable behavior coaches should look for",
        "Reinforcement idea to connect this module to training"
      ],
      "quiz": [
        {
          "question": "Scenario-based question: 'An athlete [realistic situation]. What should they do?' — not a definition question",
          "options": ["Specific, realistic option A", "Specific, realistic option B", "Specific, realistic option C", "Specific, realistic option D"],
          "correctAnswer": 0,
          "explanation": "2-3 sentences: why this answer is correct, what would happen with the wrong choices, and the underlying principle."
        }
      ]
    }
  ],
  "finalTest": [
    {
      "question": "Scenario-based question testing application of knowledge from across multiple modules",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "Explanation that connects back to a specific concept taught in the program."
    }
  ]
}

GENERATION RULES:
- Each module: 3-5 sections, 3 keyTakeaways, 3 coachReinforcementNotes, 3-4 quiz questions
- Final test: ${Math.max(8, resolvedModules * 2)} scenario-based questions covering all modules proportionally
- Quiz questions must be scenario-based (athlete in a real situation), NEVER simple factual recall
- Every section body must include at least one sport-specific example
- performanceConnection must be specific — name specific performance outcomes (speed, focus, recovery rate, injury risk, etc.)
- coachReinforcementNotes are coach-facing only — practical coaching tools, not more content
- videoSearchQuery: use specific terms that would find a high-quality educational video (include relevant expert names, sport science terms when appropriate)`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.65,
      });

      const result = JSON.parse(completion.choices[0].message.content ?? "{}");

      const [gen] = await db.insert(educationAiGenerations).values({
        orgId: profile.organizationId,
        coachUserId: userId,
        generationType: "full_pathway",
        prompt,
        result,
        status: "draft",
      }).returning();

      res.json({ generation: gen, result });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/ai/accept-full-pathway ───────────────────────────
  // Accepts a full AI-generated pathway draft, creates pathway + modules + quizzes in DB
  app.post("/api/org/education/ai/accept-full-pathway", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const { draft } = req.body;
      if (!draft?.pathway) return res.status(400).json({ message: "draft required" });

      const orgId = profile.organizationId;
      const baseSlug = slugify(draft.pathway.title);
      const existingSlugs = await db.select({ slug: educationPathways.slug })
        .from(educationPathways)
        .where(drizzleSql`${educationPathways.slug} LIKE ${baseSlug + "%"}`);
      const slug = existingSlugs.length === 0 ? baseSlug : `${baseSlug}-${Date.now()}`;

      const [pathway] = await db.insert(educationPathways).values({
        orgId,
        createdByUserId: userId,
        title: draft.pathway.title,
        slug,
        category: draft.pathway.category ?? "custom",
        description: draft.pathway.description ?? "",
        status: "draft",
        isDefault: false,
      }).returning();

      const createdModules: any[] = [];
      for (const mod of (draft.modules ?? [])) {
        const [createdMod] = await db.insert(educationModules).values({
          orgId,
          pathwayId: pathway.id,
          moduleNumber: mod.moduleNumber,
          title: mod.title,
          description: mod.description ?? "",
          content: { sections: mod.sections ?? [] },
          keyTakeaways: mod.keyTakeaways ?? [],
          estimatedMinutes: mod.estimatedMinutes ?? 10,
          videoSearchQuery: mod.videoSearchQuery ?? null,
          performanceConnection: mod.performanceConnection ?? null,
          coachReinforcementNotes: mod.coachReinforcementNotes ?? [],
          status: "draft",
        }).returning();

        if (mod.quiz?.length > 0) {
          await db.insert(educationQuizQuestions).values(
            mod.quiz.map((q: any) => ({
              orgId,
              pathwayId: pathway.id,
              moduleId: createdMod.id,
              question: q.question,
              options: q.options,
              correctAnswer: q.correctAnswer,
              explanation: q.explanation ?? "",
              questionType: "module",
            }))
          );
        }
        createdModules.push(createdMod);
      }

      if (draft.finalTest?.length > 0) {
        const finalModuleId = createdModules[createdModules.length - 1]?.id ?? "final";
        await db.insert(educationQuizQuestions).values(
          draft.finalTest.map((q: any) => ({
            orgId,
            pathwayId: pathway.id,
            moduleId: finalModuleId,
            question: q.question,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation ?? "",
            questionType: "pathway_final",
          }))
        );
      }

      res.json({ pathway, modulesCount: createdModules.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/education/pathways/:id/final-test ───────────────────────────
  app.get("/api/org/education/pathways/:id/final-test", requireAuth, async (req: any, res) => {
    try {
      const { id } = req.params;
      const questions = await db.select().from(educationQuizQuestions)
        .where(and(
          eq(educationQuizQuestions.pathwayId, id),
          eq(educationQuizQuestions.questionType, "pathway_final"),
        ));
      res.json({ questions });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/pathways/:id/final-test/submit ───────────────────
  app.post("/api/org/education/pathways/:id/final-test/submit", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const { id } = req.params;
      const { answers } = req.body;

      const questions = await db.select().from(educationQuizQuestions)
        .where(and(
          eq(educationQuizQuestions.pathwayId, id),
          eq(educationQuizQuestions.questionType, "pathway_final"),
        ));

      if (!questions.length) return res.status(404).json({ message: "No final test found" });

      let correct = 0;
      const results = questions.map((q: any) => {
        const submitted = answers[q.id] ?? -1;
        const isCorrect = submitted === q.correctAnswer;
        if (isCorrect) correct++;
        return {
          question: q.question,
          options: q.options,
          submittedIndex: submitted,
          correctIndex: q.correctAnswer,
          isCorrect,
          explanation: q.explanation,
        };
      });

      const score = Math.round((correct / questions.length) * 100);
      const passed = score >= 80;

      if (passed) {
        const [pathway] = await db.select().from(educationPathways).where(eq(educationPathways.id, id)).limit(1);
        if (pathway) {
          const existingBadge = await db.select().from(educationBadges)
            .where(and(eq(educationBadges.pathwayId, id), eq(educationBadges.criteria, "pathway_completed")))
            .limit(1);
          if (existingBadge.length > 0) {
            const alreadyEarned = await db.select().from(educationAthleteBadges)
              .where(and(
                eq(educationAthleteBadges.athleteUserId, userId),
                eq(educationAthleteBadges.badgeId, existingBadge[0].id),
              )).limit(1);
            if (!alreadyEarned.length) {
              await db.insert(educationAthleteBadges).values({
                orgId: profile.organizationId,
                athleteUserId: userId,
                badgeId: existingBadge[0].id,
                pathwayId: id,
                metadata: { source: "final_test", score },
              });
            }
          }
        }
      }

      res.json({ score, passed, correct, totalQuestions: questions.length, results });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/ai/generate-pathway ─────────────────────────────
  app.post("/api/org/education/ai/generate-pathway", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const { topic, ageGroup, sport, tone, numModules, difficulty, goal } = req.body;

      const prompt = `Create an education pathway for strength and conditioning athletes.
Topic: ${topic}
Age Group: ${ageGroup ?? "high school / college athletes"}
Sport / Team: ${sport ?? "general athletes"}
Tone: ${tone ?? "athlete-friendly, practical"}
Number of Modules: ${numModules ?? 6}
Difficulty: ${difficulty ?? "intermediate"}
Goal: ${goal ?? "improve performance through education"}

Return a JSON object with this exact structure:
{
  "title": "pathway title",
  "description": "2-3 sentence pathway description",
  "category": "one of: nutrition, recovery, mindset, sleep, hydration, team_standards, custom",
  "modules": [
    {
      "moduleNumber": 1,
      "title": "module title",
      "description": "1-2 sentence description",
      "estimatedMinutes": 10,
      "learningGoal": "what athletes will understand after this module",
      "keyConcepts": ["concept 1", "concept 2", "concept 3"]
    }
  ],
  "learningGoals": ["overall goal 1", "overall goal 2"],
  "quizStructure": "brief note on quiz approach"
}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: AI_SAFETY_SYSTEM },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const result = JSON.parse(completion.choices[0].message.content ?? "{}");

      // Store generation
      const [gen] = await db.insert(educationAiGenerations).values({
        orgId: profile.organizationId,
        coachUserId: userId,
        generationType: "pathway_outline",
        prompt: topic,
        result,
        status: "draft",
      }).returning();

      res.json({ generation: gen, result });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/ai/generate-module ──────────────────────────────
  app.post("/api/org/education/ai/generate-module", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const { topic, moduleTitle, pathwayContext, ageGroup, sport, tone, pathwayId, moduleId, coachPhilosophy, teachingStyle, bannedTerms, emphasisAreas } = req.body;

      const resolvedAge = ageGroup ?? "high school athletes";
      const systemPrompt = buildEducationSystemPrompt({ ageGroup: resolvedAge, sport: sport ?? "athletes", coachPhilosophy, teachingStyle, bannedTerms, emphasisAreas });

      const prompt = `Create complete, publish-ready lesson content for this module.

Module Title: ${moduleTitle}
Topic: ${topic ?? moduleTitle}
Program Context: ${pathwayContext ?? "general athletic performance"}
Age Group: ${resolvedAge}

Return a JSON object with EXACTLY this structure:
{
  "description": "1-2 sentences: name the concept and its direct performance impact",
  "estimatedMinutes": 12,
  "performanceConnection": "2-3 sentences: specific performance impacts — name outcomes like speed, fatigue, focus, recovery, injury risk. Include a sport-specific example.",
  "sections": [
    {
      "title": "Direct section heading — name the concept, not 'Introduction'",
      "body": "3-4 punchy sentences. One idea. One sport example. Practical implication."
    }
  ],
  "keyTakeaways": [
    "Actionable statement athletes can remember and act on",
    "Specific takeaway connected to a performance outcome",
    "Behavior-change statement reinforcing the concept"
  ],
  "coachReinforcementNotes": [
    "Discussion question to use at practice",
    "Observable behavior or sign to watch for in training",
    "Drill or reinforcement idea connecting this concept to physical work"
  ]
}

Generate 3-5 sections. Every section body must include at least one specific sport example.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.65,
      });

      const result = JSON.parse(completion.choices[0].message.content ?? "{}");

      const [gen] = await db.insert(educationAiGenerations).values({
        orgId: profile.organizationId,
        pathwayId: pathwayId ?? null,
        moduleId: moduleId ?? null,
        coachUserId: userId,
        generationType: "module_content",
        prompt: moduleTitle,
        result,
        status: "draft",
      }).returning();

      res.json({ generation: gen, result });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/ai/generate-quiz ────────────────────────────────
  app.post("/api/org/education/ai/generate-quiz", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const { moduleTitle, moduleContent, numQuestions, pathwayId, moduleId, ageGroup, sport } = req.body;

      const resolvedAge = ageGroup ?? "high school athletes";
      const systemPrompt = buildEducationSystemPrompt({ ageGroup: resolvedAge, sport: sport ?? "athletes" });

      const prompt = `Create scenario-based quiz questions for this athlete education module.

Module: ${moduleTitle}
Content Summary: ${moduleContent ?? "Use module title as context"}
Number of Questions: ${numQuestions ?? 4}
Age Group: ${resolvedAge}

Return a JSON object:
{
  "questions": [
    {
      "question": "SCENARIO: Describe a realistic situation an athlete might face (e.g. 'An athlete wakes up on game day feeling sluggish after only 5 hours of sleep and skips breakfast. During warm-up, what is most likely to happen?'). The question must describe a real situation, not ask for a definition.",
      "options": [
        "Specific, realistic outcome or action A",
        "Specific, realistic outcome or action B",
        "Specific, realistic outcome or action C",
        "Specific, realistic outcome or action D"
      ],
      "correctAnswer": 0,
      "explanation": "2-3 sentences: why this answer is correct, what the performance science says, and what the athlete should do instead or remember."
    }
  ]
}

QUIZ GENERATION RULES:
- Every question MUST be scenario-based — place the athlete in a real situation
- NEVER ask bare-facts questions like "What does glycogen do?" or "How much water should athletes drink?"
- Frame all questions as: athlete behavior + context + outcome (or decision required)
- Wrong answer options must be plausible — not obviously wrong
- Explanations must teach, not just state the correct answer
- Questions must test decision-making and application, not recall`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: AI_SAFETY_SYSTEM },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.6,
      });

      const result = JSON.parse(completion.choices[0].message.content ?? "{}");

      const [gen] = await db.insert(educationAiGenerations).values({
        orgId: profile.organizationId,
        pathwayId: pathwayId ?? null,
        moduleId: moduleId ?? null,
        coachUserId: userId,
        generationType: "quiz_questions",
        prompt: moduleTitle,
        result,
        status: "draft",
      }).returning();

      res.json({ generation: gen, result });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/ai/rewrite ──────────────────────────────────────
  app.post("/api/org/education/ai/rewrite", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const { content, rewriteType, pathwayId, moduleId } = req.body;
      // rewriteType: simpler | athlete_friendly | shorter | professional | add_examples | bullet_points

      const instructions: Record<string, string> = {
        simpler: "Rewrite this content using simpler language. Avoid jargon. Write at a 8th grade reading level.",
        athlete_friendly: "Rewrite this content in a tone that resonates with athletes. Make it motivating, practical, and relatable.",
        shorter: "Condense this content significantly. Keep only the most important points. Remove filler.",
        professional: "Rewrite this content in a more professional, formal educational tone while keeping it accessible.",
        add_examples: "Rewrite this content with practical real-world examples added. Examples should be sport/training specific.",
        bullet_points: "Convert this content into clear bullet points. Each bullet should be one concise idea.",
      };

      const instruction = instructions[rewriteType] ?? "Improve this content.";

      const prompt = `${instruction}

Original content:
${typeof content === "string" ? content : JSON.stringify(content)}

Return a JSON object:
{
  "rewritten": "the rewritten content as a string or structured object matching the input format"
}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: AI_SAFETY_SYSTEM },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const result = JSON.parse(completion.choices[0].message.content ?? "{}");

      await db.insert(educationAiGenerations).values({
        orgId: profile.organizationId,
        pathwayId: pathwayId ?? null,
        moduleId: moduleId ?? null,
        coachUserId: userId,
        generationType: "rewrite",
        prompt: rewriteType,
        result,
        status: "draft",
      });

      res.json({ result });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/education/analytics ────────────────────────────────────────
  app.get("/api/org/education/analytics", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const orgId = profile.organizationId;

      const pathways = await db.select().from(educationPathways)
        .where(drizzleSql`(${educationPathways.orgId} = ${orgId} OR ${educationPathways.isDefault} = true)`)
        .orderBy(desc(educationPathways.isDefault), asc(educationPathways.createdAt));

      const athletes = await getOrgAthletes(orgId);
      const totalAthletes = athletes.length;

      const allProgress = await db.select().from(educationProgress)
        .where(eq(educationProgress.orgId, orgId));

      const pathwayStats = await Promise.all(pathways.map(async (p: any) => {
        const modules = await db.select().from(educationModules)
          .where(and(eq(educationModules.pathwayId, p.id), eq(educationModules.status, "published")));

        const progForPathway = allProgress.filter((r: any) => r.pathwayId === p.id);
        const completedModules = progForPathway.filter((r: any) => r.status === "completed");
        const scores = completedModules.map((r: any) => r.quizScore).filter((s: any) => s !== null);
        const avgScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null;

        // Athletes who completed all modules
        const moduleCount = modules.length;
        let pathwayCompleted = 0;
        if (moduleCount > 0) {
          const completedByAthlete: Record<string, number> = {};
          completedModules.forEach((r: any) => {
            completedByAthlete[r.athleteUserId] = (completedByAthlete[r.athleteUserId] ?? 0) + 1;
          });
          pathwayCompleted = Object.values(completedByAthlete).filter((c) => c >= moduleCount).length;
        }

        return {
          pathway: p,
          moduleCount,
          totalAthletes,
          pathwayCompleted,
          inProgress: new Set(progForPathway.map((r: any) => r.athleteUserId)).size - pathwayCompleted,
          avgScore,
          completionRate: totalAthletes > 0 ? Math.round((pathwayCompleted / totalAthletes) * 100) : 0,
          moduleStats: modules.map((m: any) => {
            const mProg = progForPathway.filter((r: any) => r.moduleId === m.id);
            const mCompleted = mProg.filter((r: any) => r.status === "completed");
            const mScores = mCompleted.map((r: any) => r.quizScore).filter((s: any) => s !== null);
            return {
              module: m,
              completed: mCompleted.length,
              avgScore: mScores.length > 0 ? Math.round(mScores.reduce((a: number, b: number) => a + b, 0) / mScores.length) : null,
            };
          }),
        };
      }));

      res.json({ pathwayStats, totalAthletes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/education/progress ─────────────────────────────────────────
  // Athlete's progress summary across all pathways
  app.get("/api/org/education/progress", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;

      const progRows = await db.select().from(educationProgress)
        .where(and(
          eq(educationProgress.orgId, profile.organizationId),
          eq(educationProgress.athleteUserId, userId),
        ));

      res.json({ progress: progRows });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/education/assignments ──────────────────────────────────────
  app.get("/api/org/education/assignments", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const rows = await db.select().from(educationAssignments)
        .where(eq(educationAssignments.orgId, profile.organizationId))
        .orderBy(desc(educationAssignments.createdAt));
      res.json({ assignments: rows });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE /api/org/education/pathways/:id ───────────────────────────────────
  app.delete("/api/org/education/pathways/:id", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { id } = req.params;
      await db.update(educationPathways)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(eq(educationPathways.id, id), eq(educationPathways.orgId, profile.organizationId)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/education/pathways/:id/copy ────────────────────────────────
  // Coach: fork a default (or any) pathway into the org's own library for customization
  app.post("/api/org/education/pathways/:id/copy", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const { id } = req.params;
      const orgId = profile.organizationId;

      // Fetch source pathway
      const [source] = await db.select().from(educationPathways)
        .where(eq(educationPathways.id, id))
        .limit(1);
      if (!source) return res.status(404).json({ message: "Pathway not found" });

      // Build a unique slug for the org copy
      const baseSlug = `${source.slug}-copy`;
      const existingSlugs = await db.select({ slug: educationPathways.slug })
        .from(educationPathways)
        .where(drizzleSql`${educationPathways.slug} LIKE ${baseSlug + "%"}`);
      const slug = existingSlugs.length === 0 ? baseSlug : `${baseSlug}-${existingSlugs.length + 1}`;

      // Create org-owned copy
      const [newPathway] = await db.insert(educationPathways).values({
        orgId,
        createdByUserId: userId,
        title: `${source.title} (Custom)`,
        slug,
        category: source.category,
        description: source.description ?? "",
        status: "draft",
        isDefault: false,
      }).returning();

      // Fetch source modules
      const sourceModules = await db.select().from(educationModules)
        .where(and(eq(educationModules.pathwayId, id), eq(educationModules.status, "published")))
        .orderBy(asc(educationModules.moduleNumber));

      // Copy each module and its quiz questions
      for (const mod of sourceModules) {
        const [newMod] = await db.insert(educationModules).values({
          orgId,
          pathwayId: newPathway.id,
          moduleNumber: mod.moduleNumber,
          title: mod.title,
          description: mod.description ?? "",
          content: mod.content ?? {},
          keyTakeaways: mod.keyTakeaways ?? [],
          estimatedMinutes: mod.estimatedMinutes ?? 10,
          status: "draft",
        }).returning();

        // Copy quiz questions
        const sourceQuestions = await db.select().from(educationQuizQuestions)
          .where(eq(educationQuizQuestions.moduleId, mod.id));

        if (sourceQuestions.length > 0) {
          await db.insert(educationQuizQuestions).values(
            sourceQuestions.map((q: any) => ({
              orgId,
              pathwayId: newPathway.id,
              moduleId: newMod.id,
              question: q.question,
              options: q.options,
              correctAnswer: q.correctAnswer,
              explanation: q.explanation ?? "",
            }))
          );
        }
      }

      res.json({ pathway: newPathway, modulesCount: sourceModules.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
