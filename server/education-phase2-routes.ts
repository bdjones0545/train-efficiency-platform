import type { Express } from "express";
import { db } from "./db";
import {
  educationRules, educationAssignmentPlans, educationBadges,
  educationAthleteBadges, educationAiRecommendations,
  educationPathways, educationModules, educationProgress,
  educationAssignments, educationQuizQuestions, orgUsers, userProfiles,
  orgNotifications, orgActivityEvents,
} from "@shared/schema";
import { eq, and, desc, asc, gte, lte, lt, inArray, sql as drizzleSql, count } from "drizzle-orm";
import OpenAI from "openai";
import { resolveOrgSession } from "./org-auth";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getUserId(req: any): string | null {
  if (req._orgAuth?.userId) return req._orgAuth.userId;
  return req.user?.claims?.sub ?? req.user?.id ?? null;
}

/**
 * requireCoach — coach, admin, staff, or owner role required.
 * Supports all three auth paths:
 *   A. X-Org-Auth-Token  B. OIDC session  C. Bearer token
 */
function requireCoach(req: any, res: any, next: any) {
  resolveOrgSession(req)
    .then((auth) => {
      if (!auth) return res.status(401).json({ error: "Unauthorized", message: "Sign in to access this resource." });
      if (!["admin", "coach", "staff", "owner"].includes(auth.role)) {
        return res.status(403).json({ error: "Forbidden", message: "Coach or admin access required." });
      }
      req._orgAuth = auth;
      req._profile = { organizationId: auth.orgId, userId: auth.userId, role: auth.role };
      next();
    })
    .catch(() => res.status(500).json({ error: "AuthError", message: "Authentication error. Please try again." }));
}

/**
 * requireOrgUser — any authenticated org member.
 * Supports all three auth paths.
 */
function requireOrgUser(req: any, res: any, next: any) {
  resolveOrgSession(req)
    .then((auth) => {
      if (!auth) return res.status(401).json({ error: "Unauthorized", message: "Sign in to access this resource." });
      req._orgAuth = auth;
      req._profile = { organizationId: auth.orgId, userId: auth.userId, role: auth.role };
      next();
    })
    .catch(() => res.status(500).json({ error: "AuthError", message: "Authentication error. Please try again." }));
}

// ─── Shared helper: award badge if not already earned ─────────────────────────

async function maybeAwardBadge(orgId: string, athleteUserId: string, pathwayId: string) {
  try {
    // Find a badge tied to this pathway
    const [badge] = await db.select().from(educationBadges)
      .where(and(
        eq(educationBadges.pathwayId, pathwayId),
        eq(educationBadges.isDefault, true),
      )).limit(1);
    if (!badge) return null;

    // Already earned?
    const [existing] = await db.select().from(educationAthleteBadges)
      .where(and(
        eq(educationAthleteBadges.athleteUserId, athleteUserId),
        eq(educationAthleteBadges.badgeId, badge.id),
      )).limit(1);
    if (existing) return null;

    const [awarded] = await db.insert(educationAthleteBadges).values({
      orgId,
      athleteUserId,
      badgeId: badge.id,
      pathwayId,
      metadata: { source: "auto_pathway_completion" },
    }).returning();

    // Notify athlete
    await db.insert(orgNotifications).values({
      orgId,
      userId: athleteUserId,
      type: "badge_earned",
      title: `🏅 Badge Earned: ${badge.name}`,
      message: badge.description ?? `You earned the ${badge.name} badge!`,
      actionUrl: null,
      metadata: { badgeId: badge.id, pathwayId },
    });

    // Log to activity timeline
    await db.insert(orgActivityEvents).values({
      orgId,
      userId: athleteUserId,
      sourceType: "education",
      sourceId: pathwayId,
      eventType: "badge_earned",
      title: `Badge Earned: ${badge.name}`,
      description: badge.description ?? "",
      eventDate: new Date(),
      metadata: { badgeId: badge.id, badgeName: badge.name, pathwayId },
      visibility: "athlete",
    });

    return awarded;
  } catch { return null; }
}

// ─── Rule evaluation helper ────────────────────────────────────────────────────

export async function evaluateRulesForEvent(
  orgId: string,
  triggerType: string,
  context: Record<string, any>
) {
  try {
    const rules = await db.select().from(educationRules)
      .where(and(
        eq(educationRules.orgId, orgId),
        eq(educationRules.triggerType, triggerType),
        eq(educationRules.isActive, true),
      ));

    for (const rule of rules) {
      const cfg = (rule.triggerConfig ?? {}) as any;
      const action = (rule.actionConfig ?? {}) as any;
      let triggered = false;

      // Evaluate trigger conditions
      if (triggerType === "quiz_failed") {
        const failCount = context.failCount ?? 1;
        const threshold = cfg.threshold ?? 1;
        triggered = failCount >= threshold;
      } else if (triggerType === "readiness_low") {
        const score = context.readinessScore ?? 10;
        const threshold = cfg.threshold ?? 5;
        triggered = score <= threshold;
      } else if (triggerType === "athlete_joined") {
        triggered = true;
      } else if (triggerType === "pathway_completed") {
        triggered = !cfg.pathwayId || cfg.pathwayId === context.pathwayId;
      } else if (triggerType === "module_overdue") {
        triggered = true;
      }

      if (!triggered) continue;

      // Execute action
      if (rule.actionType === "assign_pathway" && action.pathwayId && context.athleteUserId) {
        if (rule.requiresApproval) {
          // Create AI recommendation (pending coach approval)
          await db.insert(educationAiRecommendations).values({
            orgId,
            athleteUserId: context.athleteUserId,
            pathwayId: action.pathwayId,
            reasoning: `Rule "${rule.name}" triggered: ${triggerType}`,
            triggerContext: context,
            status: "pending",
          });
        } else {
          // Auto-assign
          const [existing] = await db.select().from(educationAssignments)
            .where(and(
              eq(educationAssignments.orgId, orgId),
              eq(educationAssignments.pathwayId, action.pathwayId),
              eq(educationAssignments.athleteUserId, context.athleteUserId),
            )).limit(1);
          if (!existing) {
            await db.insert(educationAssignments).values({
              orgId,
              pathwayId: action.pathwayId,
              assignedToType: "individual",
              athleteUserId: context.athleteUserId,
              assignedByUserId: rule.createdByUserId,
            });
          }
        }
      }

      if (rule.actionType === "notify_coach") {
        // Find coaches in org
        const coaches = await db.select().from(orgUsers)
          .where(and(
            eq(orgUsers.organizationId, orgId),
            inArray(orgUsers.role, ["admin", "coach"]),
          ));
        for (const coach of coaches) {
          await db.insert(orgNotifications).values({
            orgId,
            userId: coach.userId!,
            type: "education_rule_triggered",
            title: `Rule: ${rule.name}`,
            message: action.message ?? `Rule "${rule.name}" was triggered for an athlete.`,
            metadata: { ruleId: rule.id, triggerType, context },
          });
        }
      }

      if (rule.actionType === "award_badge" && action.pathwayId && context.athleteUserId) {
        await maybeAwardBadge(orgId, context.athleteUserId, action.pathwayId);
      }
    }
  } catch (err) {
    console.error("[EducationRules] Error evaluating rules:", err);
  }
}

// ─── Route Registration ────────────────────────────────────────────────────────

export function registerEducationPhase2Routes(app: Express) {

  // ── RULES ENGINE ──────────────────────────────────────────────────────────────

  app.get("/api/org/education/rules", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      const rules = await db.select().from(educationRules)
        .where(eq(educationRules.orgId, organizationId))
        .orderBy(desc(educationRules.createdAt));
      res.json({ rules });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/org/education/rules", requireCoach, async (req: any, res) => {
    try {
      const { organizationId, userId } = req._profile;
      const { name, triggerType, triggerConfig, actionType, actionConfig, requiresApproval } = req.body;
      if (!name || !triggerType || !actionType) {
        return res.status(400).json({ message: "name, triggerType, and actionType are required" });
      }
      const [rule] = await db.insert(educationRules).values({
        orgId: organizationId,
        createdByUserId: userId ?? getUserId(req) ?? "",
        name, triggerType,
        triggerConfig: triggerConfig ?? {},
        actionType,
        actionConfig: actionConfig ?? {},
        requiresApproval: requiresApproval ?? true,
        isActive: true,
      }).returning();
      res.json({ rule });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/org/education/rules/:id", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      const { id } = req.params;
      const updates: any = {};
      const allowed = ["name", "triggerType", "triggerConfig", "actionType", "actionConfig", "isActive", "requiresApproval"];
      for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
      updates.updatedAt = new Date();
      const [rule] = await db.update(educationRules).set(updates)
        .where(and(eq(educationRules.id, id), eq(educationRules.orgId, organizationId)))
        .returning();
      res.json({ rule });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/org/education/rules/:id", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      await db.delete(educationRules)
        .where(and(eq(educationRules.id, req.params.id), eq(educationRules.orgId, organizationId)));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── ASSIGNMENT PLANS ──────────────────────────────────────────────────────────

  app.get("/api/org/education/plans", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      const plans = await db.select().from(educationAssignmentPlans)
        .where(eq(educationAssignmentPlans.orgId, organizationId))
        .orderBy(desc(educationAssignmentPlans.createdAt));
      res.json({ plans });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/org/education/plans", requireCoach, async (req: any, res) => {
    try {
      const { organizationId, userId } = req._profile;
      const { name, description, weeks, assignedToType, athleteUserId, teamId, startDate } = req.body;
      if (!name) return res.status(400).json({ message: "name is required" });
      const [plan] = await db.insert(educationAssignmentPlans).values({
        orgId: organizationId,
        createdByUserId: userId ?? getUserId(req) ?? "",
        name, description: description ?? "",
        weeks: weeks ?? [],
        assignedToType: assignedToType ?? "all_athletes",
        athleteUserId: athleteUserId ?? null,
        teamId: teamId ?? null,
        status: "draft",
        startDate: startDate ? new Date(startDate) : null,
      }).returning();
      res.json({ plan });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/org/education/plans/:id", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      const { id } = req.params;
      const updates: any = {};
      const allowed = ["name", "description", "weeks", "assignedToType", "athleteUserId", "teamId", "status", "startDate"];
      for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
      if (updates.startDate) updates.startDate = new Date(updates.startDate);
      updates.updatedAt = new Date();
      const [plan] = await db.update(educationAssignmentPlans).set(updates)
        .where(and(eq(educationAssignmentPlans.id, id), eq(educationAssignmentPlans.orgId, organizationId)))
        .returning();
      res.json({ plan });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Activate a plan: assign all week-1 pathways now
  app.post("/api/org/education/plans/:id/activate", requireCoach, async (req: any, res) => {
    try {
      const { organizationId, userId } = req._profile;
      const [plan] = await db.select().from(educationAssignmentPlans)
        .where(and(eq(educationAssignmentPlans.id, req.params.id), eq(educationAssignmentPlans.orgId, organizationId)))
        .limit(1);
      if (!plan) return res.status(404).json({ message: "Plan not found" });

      const weeks = (plan.weeks as any[]) ?? [];
      const week1 = weeks.filter((w: any) => w.week === 1);
      let assigned = 0;
      for (const w of week1) {
        if (!w.pathwayId) continue;
        const [existing] = await db.select().from(educationAssignments)
          .where(and(
            eq(educationAssignments.orgId, organizationId),
            eq(educationAssignments.pathwayId, w.pathwayId),
            eq(educationAssignments.assignedToType, plan.assignedToType),
          )).limit(1);
        if (!existing) {
          await db.insert(educationAssignments).values({
            orgId: organizationId,
            pathwayId: w.pathwayId,
            assignedToType: plan.assignedToType,
            athleteUserId: plan.athleteUserId ?? null,
            teamId: plan.teamId ?? null,
            assignedByUserId: userId ?? "",
          });
          assigned++;
        }
      }

      await db.update(educationAssignmentPlans).set({ status: "active", startDate: new Date(), updatedAt: new Date() })
        .where(eq(educationAssignmentPlans.id, plan.id));

      res.json({ ok: true, assigned });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/org/education/plans/:id", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      await db.delete(educationAssignmentPlans)
        .where(and(eq(educationAssignmentPlans.id, req.params.id), eq(educationAssignmentPlans.orgId, organizationId)));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── BADGES ────────────────────────────────────────────────────────────────────

  // List badges available to this org (system defaults + org custom)
  app.get("/api/org/education/badges", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      const badges = await db.select().from(educationBadges)
        .where(drizzleSql`${educationBadges.orgId} IS NULL OR ${educationBadges.orgId} = ${organizationId}`)
        .orderBy(asc(educationBadges.createdAt));
      res.json({ badges });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Athlete: get my earned badges
  app.get("/api/org/education/my-badges", requireOrgUser, async (req: any, res) => {
    try {
      const { organizationId, userId } = req._profile;
      const earned = await db.select({
        badge: educationBadges,
        earned: educationAthleteBadges,
      })
        .from(educationAthleteBadges)
        .innerJoin(educationBadges, eq(educationAthleteBadges.badgeId, educationBadges.id))
        .where(and(
          eq(educationAthleteBadges.orgId, organizationId),
          eq(educationAthleteBadges.athleteUserId, userId!),
        ))
        .orderBy(desc(educationAthleteBadges.earnedAt));
      res.json({ badges: earned });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Coach: create custom badge
  app.post("/api/org/education/badges", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      const { name, description, icon, color, pathwayId, criteria } = req.body;
      if (!name) return res.status(400).json({ message: "name required" });
      const [badge] = await db.insert(educationBadges).values({
        orgId: organizationId,
        pathwayId: pathwayId ?? null,
        name, description: description ?? "",
        icon: icon ?? "trophy",
        color: color ?? "amber",
        criteria: criteria ?? "pathway_completed",
        isDefault: false,
      }).returning();
      res.json({ badge });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Coach: manually award badge to athlete
  app.post("/api/org/education/badges/:id/award", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      const { athleteUserId, pathwayId } = req.body;
      if (!athleteUserId) return res.status(400).json({ message: "athleteUserId required" });

      const [existing] = await db.select().from(educationAthleteBadges)
        .where(and(
          eq(educationAthleteBadges.athleteUserId, athleteUserId),
          eq(educationAthleteBadges.badgeId, req.params.id),
        )).limit(1);
      if (existing) return res.json({ ok: true, alreadyEarned: true });

      const [awarded] = await db.insert(educationAthleteBadges).values({
        orgId: organizationId,
        athleteUserId,
        badgeId: req.params.id,
        pathwayId: pathwayId ?? null,
        metadata: { source: "manual_award" },
      }).returning();

      res.json({ ok: true, awarded });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // All badges earned by all athletes (coach view)
  app.get("/api/org/education/badges/earned", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      const earned = await db.select({
        badge: educationBadges,
        earned: educationAthleteBadges,
        profile: userProfiles,
      })
        .from(educationAthleteBadges)
        .innerJoin(educationBadges, eq(educationAthleteBadges.badgeId, educationBadges.id))
        .leftJoin(userProfiles, eq(educationAthleteBadges.athleteUserId, userProfiles.userId))
        .where(eq(educationAthleteBadges.orgId, organizationId))
        .orderBy(desc(educationAthleteBadges.earnedAt));
      res.json({ earned });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── AI RECOMMENDATIONS ────────────────────────────────────────────────────────

  // Coach: list pending AI recommendations
  app.get("/api/org/education/ai-recommendations", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      const recs = await db.select({
        rec: educationAiRecommendations,
        pathway: educationPathways,
        profile: userProfiles,
      })
        .from(educationAiRecommendations)
        .leftJoin(educationPathways, eq(educationAiRecommendations.pathwayId, educationPathways.id))
        .leftJoin(userProfiles, eq(educationAiRecommendations.athleteUserId, userProfiles.userId))
        .where(and(
          eq(educationAiRecommendations.orgId, organizationId),
          eq(educationAiRecommendations.status, "pending"),
        ))
        .orderBy(desc(educationAiRecommendations.createdAt));
      res.json({ recommendations: recs });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Coach: approve recommendation → auto-assign the pathway
  app.post("/api/org/education/ai-recommendations/:id/approve", requireCoach, async (req: any, res) => {
    try {
      const { organizationId, userId } = req._profile;
      const [rec] = await db.select().from(educationAiRecommendations)
        .where(and(eq(educationAiRecommendations.id, req.params.id), eq(educationAiRecommendations.orgId, organizationId)))
        .limit(1);
      if (!rec) return res.status(404).json({ message: "Recommendation not found" });

      // Create assignment
      const [existing] = await db.select().from(educationAssignments)
        .where(and(
          eq(educationAssignments.orgId, organizationId),
          eq(educationAssignments.pathwayId, rec.pathwayId),
          eq(educationAssignments.athleteUserId, rec.athleteUserId),
        )).limit(1);
      if (!existing) {
        await db.insert(educationAssignments).values({
          orgId: organizationId,
          pathwayId: rec.pathwayId,
          assignedToType: "individual",
          athleteUserId: rec.athleteUserId,
          assignedByUserId: userId ?? "",
        });
      }

      await db.update(educationAiRecommendations).set({
        status: "approved",
        reviewedByUserId: userId ?? null,
        reviewedAt: new Date(),
      }).where(eq(educationAiRecommendations.id, req.params.id));

      // Notify athlete
      await db.insert(orgNotifications).values({
        orgId: organizationId,
        userId: rec.athleteUserId,
        type: "pathway_assigned",
        title: "New Pathway Assigned",
        message: `Your coach has assigned you a new learning pathway.`,
        metadata: { pathwayId: rec.pathwayId, source: "ai_recommendation" },
      });

      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Coach: reject recommendation
  app.post("/api/org/education/ai-recommendations/:id/reject", requireCoach, async (req: any, res) => {
    try {
      const { organizationId, userId } = req._profile;
      await db.update(educationAiRecommendations).set({
        status: "rejected",
        reviewedByUserId: userId ?? null,
        reviewedAt: new Date(),
      }).where(and(eq(educationAiRecommendations.id, req.params.id), eq(educationAiRecommendations.orgId, organizationId)));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Coach: generate AI recommendations for all athletes
  app.post("/api/org/education/ai-recommendations/generate", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;

      // Get all athletes, pathways, and progress data
      const athletes = await db.select().from(orgUsers)
        .where(and(eq(orgUsers.organizationId, organizationId), eq(orgUsers.role, "client")));
      const pathways = await db.select().from(educationPathways)
        .where(and(eq(educationPathways.orgId, organizationId), eq(educationPathways.status, "published")));
      const allProgress = await db.select().from(educationProgress)
        .where(eq(educationProgress.orgId, organizationId));
      const allAssignments = await db.select().from(educationAssignments)
        .where(eq(educationAssignments.orgId, organizationId));

      if (pathways.length === 0 || athletes.length === 0) {
        return res.json({ recommendations: [], message: "No published pathways or athletes found" });
      }

      const recommendations: any[] = [];

      // Analyze each athlete
      for (const athlete of athletes.slice(0, 10)) { // Limit to prevent timeout
        const athleteProgress = allProgress.filter((p: any) => p.athleteUserId === athlete.userId);
        const athleteAssignments = allAssignments.filter((a: any) =>
          a.athleteUserId === athlete.userId || a.assignedToType === "all_athletes"
        );
        const assignedPathwayIds = new Set(athleteAssignments.map((a: any) => a.pathwayId));
        const completedPathwayIds = new Set(
          athleteProgress.filter((p: any) => p.status === "completed").map((p: any) => p.pathwayId)
        );
        const failedQuizzes = athleteProgress.filter((p: any) =>
          p.quizScore !== null && p.quizScore < 80
        );

        // Find unassigned, uncompleted pathways
        const unassigned = pathways.filter((p: any) =>
          !assignedPathwayIds.has(p.id) && !completedPathwayIds.has(p.id)
        );

        if (unassigned.length === 0) continue;

        // Build context for AI
        const context = {
          athleteName: athlete.displayName ?? "Athlete",
          completedPathways: athleteProgress.filter((p: any) => p.status === "completed").length,
          inProgressPathways: athleteProgress.filter((p: any) => p.status === "in_progress").length,
          failedQuizCount: failedQuizzes.length,
          availablePathways: unassigned.map((p: any) => ({ id: p.id, title: p.title, category: p.category })),
        };

        try {
          const aiResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are an education coach AI. Given athlete progress data, recommend ONE pathway from the available list. Respond with JSON: { pathwayId: string, reasoning: string }.`,
              },
              {
                role: "user",
                content: JSON.stringify(context),
              },
            ],
            response_format: { type: "json_object" },
            max_tokens: 200,
          });

          const result = JSON.parse(aiResponse.choices[0].message.content ?? "{}");
          if (result.pathwayId && unassigned.find((p: any) => p.id === result.pathwayId)) {
            // Avoid duplicate pending recs
            const [existingRec] = await db.select().from(educationAiRecommendations)
              .where(and(
                eq(educationAiRecommendations.athleteUserId, athlete.userId!),
                eq(educationAiRecommendations.pathwayId, result.pathwayId),
                eq(educationAiRecommendations.status, "pending"),
              )).limit(1);
            if (!existingRec) {
              const [rec] = await db.insert(educationAiRecommendations).values({
                orgId: organizationId,
                athleteUserId: athlete.userId!,
                pathwayId: result.pathwayId,
                reasoning: result.reasoning ?? "AI-recommended based on athlete progress.",
                triggerContext: context,
                status: "pending",
              }).returning();
              recommendations.push(rec);
            }
          }
        } catch { /* skip this athlete on AI error */ }
      }

      res.json({ recommendations, generated: recommendations.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── ENHANCED ANALYTICS ─────────────────────────────────────────────────────

  app.get("/api/org/education/analytics/v2", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;

      // All athletes
      const athletes = await db.select().from(orgUsers)
        .where(and(eq(orgUsers.organizationId, organizationId), eq(orgUsers.role, "client")));

      // All published pathways
      const pathways = await db.select().from(educationPathways)
        .where(and(eq(educationPathways.orgId, organizationId), eq(educationPathways.status, "published")));

      // All modules
      const allModules = await db.select().from(educationModules)
        .where(eq(educationModules.orgId, organizationId));

      // All progress
      const allProgress = await db.select().from(educationProgress)
        .where(eq(educationProgress.orgId, organizationId));

      // All assignments
      const allAssignments = await db.select().from(educationAssignments)
        .where(eq(educationAssignments.orgId, organizationId));

      // All badges earned
      const allBadges = await db.select({
        earned: educationAthleteBadges,
        badge: educationBadges,
        profile: userProfiles,
      })
        .from(educationAthleteBadges)
        .innerJoin(educationBadges, eq(educationAthleteBadges.badgeId, educationBadges.id))
        .leftJoin(userProfiles, eq(educationAthleteBadges.athleteUserId, userProfiles.userId))
        .where(eq(educationAthleteBadges.orgId, organizationId))
        .orderBy(desc(educationAthleteBadges.earnedAt));

      // Athletes behind = assigned but no started progress
      const athletesBehind: any[] = [];
      for (const athlete of athletes) {
        const assigned = allAssignments.filter((a: any) =>
          a.athleteUserId === athlete.userId || a.assignedToType === "all_athletes"
        );
        for (const assignment of assigned) {
          const pathway = pathways.find((p: any) => p.id === assignment.pathwayId);
          if (!pathway) continue;
          const pathwayModules = allModules.filter((m: any) => m.pathwayId === pathway.id && m.status === "published");
          if (pathwayModules.length === 0) continue;
          const started = allProgress.some((p: any) =>
            p.athleteUserId === athlete.userId && p.pathwayId === pathway.id
          );
          if (!started) {
            athletesBehind.push({
              athlete: { id: athlete.userId, name: athlete.displayName ?? "Athlete" },
              pathway: { id: pathway.id, title: pathway.title },
              assignedAt: assignment.createdAt,
            });
          }
        }
      }

      // Failed quizzes (score < 80) — recent 50
      const failedQuizzes = allProgress
        .filter((p: any) => p.quizScore !== null && p.quizScore < 80)
        .slice(0, 50)
        .map((p: any) => {
          const mod = allModules.find((m: any) => m.id === p.moduleId);
          const pathway = pathways.find((pw: any) => pw.id === p.pathwayId);
          const athlete = athletes.find((a: any) => a.userId === p.athleteUserId);
          return {
            progress: p,
            module: mod ? { id: mod.id, title: mod.title } : null,
            pathway: pathway ? { id: pathway.id, title: pathway.title } : null,
            athlete: athlete ? { id: athlete.userId, name: athlete.displayName ?? "Athlete" } : null,
          };
        });

      // Compliance score = (athletes with ≥1 completed module / total athletes) * 100
      const athletesWithProgress = new Set(allProgress.filter((p: any) => p.status === "completed").map((p: any) => p.athleteUserId));
      const complianceScore = athletes.length > 0
        ? Math.round((athletesWithProgress.size / athletes.length) * 100)
        : 0;

      // Overdue assignments = assigned > 14 days ago, pathway not completed
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const overdueModules: any[] = [];
      for (const assignment of allAssignments) {
        if (!assignment.createdAt || new Date(assignment.createdAt) > twoWeeksAgo) continue;
        const pathway = pathways.find((p: any) => p.id === assignment.pathwayId);
        if (!pathway) continue;
        const pathwayModules = allModules.filter((m: any) => m.pathwayId === pathway.id && m.status === "published");
        const targetAthletes = assignment.assignedToType === "all_athletes"
          ? athletes
          : athletes.filter((a: any) => a.userId === assignment.athleteUserId);
        for (const athlete of targetAthletes) {
          const completed = allProgress.filter((p: any) =>
            p.athleteUserId === athlete.userId &&
            p.pathwayId === pathway.id &&
            p.status === "completed"
          ).length;
          if (completed < pathwayModules.length) {
            overdueModules.push({
              athlete: { id: athlete.userId, name: athlete.displayName ?? "Athlete" },
              pathway: { id: pathway.id, title: pathway.title },
              completed,
              total: pathwayModules.length,
              assignedAt: assignment.createdAt,
            });
          }
        }
      }

      // Pending AI recommendations count
      const [{ value: pendingRecs }] = await db.select({ value: count() }).from(educationAiRecommendations)
        .where(and(eq(educationAiRecommendations.orgId, organizationId), eq(educationAiRecommendations.status, "pending")));

      res.json({
        totalAthletes: athletes.length,
        complianceScore,
        athletesBehind: athletesBehind.slice(0, 20),
        failedQuizzes,
        overdueModules: overdueModules.slice(0, 20),
        recentBadges: allBadges.slice(0, 10),
        pendingRecommendations: pendingRecs,
        totalBadgesEarned: allBadges.length,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── INDIVIDUAL ATHLETE ASSIGNMENT ─────────────────────────────────────────────
  // Assign a pathway to a specific athlete (not already in phase 1)
  app.post("/api/org/education/pathways/:id/assign-athlete", requireCoach, async (req: any, res) => {
    try {
      const { organizationId, userId } = req._profile;
      const { athleteUserId, dueDate } = req.body;
      if (!athleteUserId) return res.status(400).json({ message: "athleteUserId required" });

      const [existing] = await db.select().from(educationAssignments)
        .where(and(
          eq(educationAssignments.orgId, organizationId),
          eq(educationAssignments.pathwayId, req.params.id),
          eq(educationAssignments.athleteUserId, athleteUserId),
        )).limit(1);
      if (existing) return res.json({ ok: true, alreadyAssigned: true });

      const [assignment] = await db.insert(educationAssignments).values({
        orgId: organizationId,
        pathwayId: req.params.id,
        assignedToType: "individual",
        athleteUserId,
        assignedByUserId: userId ?? "",
        dueDate: dueDate ? new Date(dueDate) : null,
      }).returning();

      // Notify athlete
      await db.insert(orgNotifications).values({
        orgId: organizationId,
        userId: athleteUserId,
        type: "pathway_assigned",
        title: "New Learning Pathway Assigned",
        message: "Your coach has assigned you a new education pathway. Check your Education hub to get started.",
        metadata: { pathwayId: req.params.id },
      });

      res.json({ ok: true, assignment });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // List athletes for assignment picker
  app.get("/api/org/education/athletes", requireCoach, async (req: any, res) => {
    try {
      const { organizationId } = req._profile;
      const athletes = await db.select({
        user: orgUsers,
        profile: userProfiles,
      })
        .from(orgUsers)
        .leftJoin(userProfiles, eq(orgUsers.userId, userProfiles.userId))
        .where(and(eq(orgUsers.organizationId, organizationId), eq(orgUsers.role, "client")));
      res.json({ athletes });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
