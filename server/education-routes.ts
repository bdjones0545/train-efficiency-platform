import type { Express } from "express";
import { db } from "./db";
import {
  educationPathways, educationModules, educationQuizQuestions,
  educationProgress, educationAssignments, educationAiGenerations,
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

// ─── AI Safety System Prompt ──────────────────────────────────────────────────

const AI_SAFETY_SYSTEM = `You are a sports education content creator for strength and conditioning coaches.

STRICT RULES — NEVER violate these:
- Do NOT give medical advice, diagnoses, or treatment recommendations
- Do NOT prescribe specific calorie or macronutrient amounts for individuals
- Do NOT recommend specific supplements or doses
- Do NOT use eating disorder language or body-shaming
- Do NOT make extreme dieting or weight-loss claims
- For nutrition content: focus on performance fueling, hydration, recovery — education only
- Always suggest athletes consult qualified sports dietitians for individual plans
- Keep language athlete-friendly, practical, and evidence-based

OUTPUT FORMAT: Always respond with valid JSON only. No markdown, no extra text.`;

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

      const [created] = await db.insert(educationModules).values({
        orgId: profile.organizationId,
        pathwayId,
        moduleNumber: nextNum,
        title,
        description: description ?? "",
        content: content ?? { sections: [] },
        keyTakeaways: keyTakeaways ?? [],
        estimatedMinutes: estimatedMinutes ?? 10,
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
      const { title, description, content, keyTakeaways, estimatedMinutes, status } = req.body;

      const updates: any = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (content !== undefined) updates.content = content;
      if (keyTakeaways !== undefined) updates.keyTakeaways = keyTakeaways;
      if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;
      if (status !== undefined) updates.status = status;

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
      const { topic, moduleTitle, pathwayContext, ageGroup, tone, pathwayId, moduleId } = req.body;

      const prompt = `Create detailed lesson content for a module in an athlete education program.

Module Title: ${moduleTitle}
Topic: ${topic ?? moduleTitle}
Pathway Context: ${pathwayContext ?? "general athletic performance"}
Age Group: ${ageGroup ?? "high school / college athletes"}
Tone: ${tone ?? "athlete-friendly, practical, conversational"}

Return a JSON object:
{
  "description": "1-2 sentence module description",
  "estimatedMinutes": 12,
  "sections": [
    {
      "heading": "Section Heading",
      "body": "2-4 sentences of clear, educational content. Use simple language. Include practical examples."
    }
  ],
  "keyTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "summary": "1-2 sentence summary of the module"
}

Aim for 3-5 sections. Keep each section focused and practical.`;

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
      const { moduleTitle, moduleContent, numQuestions, pathwayId, moduleId } = req.body;

      const prompt = `Create quiz questions for an athlete education module.

Module Title: ${moduleTitle}
Module Summary: ${moduleContent ?? "See module title for context"}
Number of Questions: ${numQuestions ?? 4}

Return a JSON object:
{
  "questions": [
    {
      "question": "Question text?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 1,
      "explanation": "Clear explanation of why this answer is correct and what the athlete should understand."
    }
  ]
}

Rules for questions:
- Test practical understanding, not just memorization
- 4 options per question (0-indexed correct answer)
- Clear, unambiguous correct answer
- Helpful explanation that reinforces learning
- Avoid trick questions`;

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
