import type { Express } from "express";
import { db } from "./db";
import {
  interventionOutcomes,
  programAdaptationDrafts,
  athleteContextObjects,
  orgUsers,
} from "@shared/schema";
import { eq, and, desc, gte, isNotNull } from "drizzle-orm";
import { buildOrgLearningInsights, buildAthleteResponseProfile, runOutcomeEvaluationCron } from "./services/intervention-learning-engine";
import { buildPrioritizedInterventionQueue } from "./services/intervention-priority-engine";

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function resolveOrgAuth(req: any): Promise<{ orgId: string; userId: string } | null> {
  const orgAuthToken = req.headers["x-org-auth-token"] as string | undefined;
  if (orgAuthToken) {
    const { db: dbInst } = await import("./db");
    const { orgAuthSessions, orgUsers: orgUsersTable } = await import("@shared/schema");
    const { eq: eqFn, and: andFn, gt } = await import("drizzle-orm");
    const [session] = await dbInst.select()
      .from(orgAuthSessions)
      .where(andFn(eqFn(orgAuthSessions.token, orgAuthToken), gt(orgAuthSessions.expiresAt, new Date())))
      .limit(1)
      .catch(() => []);
    if (session?.userId) {
      const [user] = await dbInst.select().from(orgUsersTable).where(eqFn(orgUsersTable.id, session.userId)).limit(1).catch(() => []);
      if (user?.organizationId) return { orgId: user.organizationId, userId: user.id };
    }
  }
  if (req._orgAuth?.orgId) return req._orgAuth;
  if (req._profile?.organizationId) return { orgId: req._profile.organizationId, userId: req._profile.id };
  return null;
}

function requireOrgAuth(req: any, res: any, next: () => void) {
  const orgAuthToken = req.headers["x-org-auth-token"];
  const hasBearerInProfile = req._profile?.organizationId;
  if (!orgAuthToken && !hasBearerInProfile && !req._orgAuth) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

export function registerInterventionOutcomeRoutes(app: Express) {

  // ── Priority Queue ──────────────────────────────────────────────────────────

  // GET /api/org/intelligence/priority-queue
  // Returns all pending interventions scored and ranked by priority
  app.get("/api/org/intelligence/priority-queue", async (req: any, res) => {
    try {
      const auth = await resolveOrgAuth(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });

      const result = await buildPrioritizedInterventionQueue(auth.orgId);
      return res.json(result);
    } catch (err: any) {
      console.error("[PriorityQueue] error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Learning Insights ────────────────────────────────────────────────────────

  // GET /api/org/intelligence/learning-insights
  // Returns org-level intervention effectiveness learning report
  app.get("/api/org/intelligence/learning-insights", async (req: any, res) => {
    try {
      const auth = await resolveOrgAuth(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });

      const insights = await buildOrgLearningInsights(auth.orgId);
      return res.json({ insights });
    } catch (err: any) {
      console.error("[LearningInsights] error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/org/intelligence/athletes/:athleteUserId/response-profile
  app.get("/api/org/intelligence/athletes/:athleteUserId/response-profile", async (req: any, res) => {
    try {
      const auth = await resolveOrgAuth(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });

      const { athleteUserId } = req.params;
      const profile = await buildAthleteResponseProfile(athleteUserId, auth.orgId);
      return res.json({ profile });
    } catch (err: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Outcome Tracking ─────────────────────────────────────────────────────────

  // GET /api/org/intelligence/outcomes
  // Returns all outcome records for the org
  app.get("/api/org/intelligence/outcomes", async (req: any, res) => {
    try {
      const auth = await resolveOrgAuth(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });

      const statusFilter = (req.query.status as string) || undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

      let query = db.select({
        id: interventionOutcomes.id,
        orgId: interventionOutcomes.orgId,
        athleteUserId: interventionOutcomes.athleteUserId,
        adaptationDraftId: interventionOutcomes.adaptationDraftId,
        interventionType: interventionOutcomes.interventionType,
        approvedAt: interventionOutcomes.approvedAt,
        evaluatedAt: interventionOutcomes.evaluatedAt,
        readinessBefore: interventionOutcomes.readinessBefore,
        readinessAfter: interventionOutcomes.readinessAfter,
        readinessDelta: interventionOutcomes.readinessDelta,
        complianceBefore: interventionOutcomes.complianceBefore,
        complianceAfter: interventionOutcomes.complianceAfter,
        complianceDelta: interventionOutcomes.complianceDelta,
        rpeBefore: interventionOutcomes.rpeBefore,
        rpeAfter: interventionOutcomes.rpeAfter,
        rpeDelta: interventionOutcomes.rpeDelta,
        riskLevelBefore: interventionOutcomes.riskLevelBefore,
        riskLevelAfter: interventionOutcomes.riskLevelAfter,
        outcomeStatus: interventionOutcomes.outcomeStatus,
        coachFeedback: interventionOutcomes.coachFeedback,
        aiEffectivenessRating: interventionOutcomes.aiEffectivenessRating,
        createdAt: interventionOutcomes.createdAt,
        athleteName: orgUsers.name,
      })
        .from(interventionOutcomes)
        .leftJoin(orgUsers, eq(interventionOutcomes.athleteUserId, orgUsers.id))
        .where(eq(interventionOutcomes.orgId, auth.orgId))
        .orderBy(desc(interventionOutcomes.createdAt))
        .limit(limit);

      const outcomes = await query;
      return res.json({ outcomes });
    } catch (err: any) {
      console.error("[Outcomes] list error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/org/intelligence/outcomes
  // Create a new outcome tracking record (called when a draft is approved)
  app.post("/api/org/intelligence/outcomes", async (req: any, res) => {
    try {
      const auth = await resolveOrgAuth(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });

      const {
        adaptationDraftId, athleteUserId, interventionType,
        readinessBefore, complianceBefore, rpeBefore,
        riskLevelBefore, missedSessionsBefore,
      } = req.body;

      if (!athleteUserId || !interventionType) {
        return res.status(400).json({ message: "athleteUserId and interventionType are required" });
      }

      // Snapshot the current context as the "before" baseline
      const [ctx] = await db.select()
        .from(athleteContextObjects)
        .where(and(eq(athleteContextObjects.orgId, auth.orgId), eq(athleteContextObjects.athleteUserId, athleteUserId)))
        .limit(1);

      const [outcome] = await db.insert(interventionOutcomes).values({
        orgId: auth.orgId,
        athleteUserId,
        adaptationDraftId: adaptationDraftId ?? null,
        interventionType,
        approvedAt: new Date(),
        evaluationDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        readinessBefore: readinessBefore ?? null,
        complianceBefore: complianceBefore ?? (ctx?.complianceRate ?? null),
        rpeBefore: rpeBefore ?? null,
        riskLevelBefore: riskLevelBefore ?? (ctx?.riskLevel ?? null),
        missedSessionsBefore: missedSessionsBefore ?? null,
        beforeSnapshot: ctx ? {
          readinessTrend: ctx.readinessTrend,
          complianceRate: ctx.complianceRate,
          riskLevel: ctx.riskLevel,
          readinessBefore,
          complianceBefore: ctx.complianceRate,
          riskLevelBefore: ctx.riskLevel,
          capturedAt: new Date().toISOString(),
        } : null,
        outcomeStatus: "pending_evaluation",
      }).returning();

      return res.status(201).json({ outcome });
    } catch (err: any) {
      console.error("[Outcomes] create error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // PATCH /api/org/intelligence/outcomes/:outcomeId
  // Coach submits feedback / manual evaluation
  app.patch("/api/org/intelligence/outcomes/:outcomeId", async (req: any, res) => {
    try {
      const auth = await resolveOrgAuth(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });

      const { outcomeId } = req.params;
      const { coachFeedback, outcomeStatus, aiEffectivenessRating } = req.body;

      const [updated] = await db.update(interventionOutcomes).set({
        coachFeedback: coachFeedback ?? undefined,
        outcomeStatus: outcomeStatus ?? undefined,
        aiEffectivenessRating: aiEffectivenessRating ?? undefined,
        evaluatedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(interventionOutcomes.id, outcomeId),
        eq(interventionOutcomes.orgId, auth.orgId),
      )).returning();

      if (!updated) return res.status(404).json({ message: "Outcome not found" });
      return res.json({ outcome: updated });
    } catch (err: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/org/intelligence/outcomes/run-evaluation-cron
  // Manually trigger the outcome evaluation pass
  app.post("/api/org/intelligence/outcomes/run-evaluation-cron", async (req: any, res) => {
    try {
      const auth = await resolveOrgAuth(req);
      if (!auth) return res.status(401).json({ message: "Unauthorized" });

      const result = await runOutcomeEvaluationCron(auth.orgId);
      return res.json({ ...result, message: `Evaluated ${result.evaluated} outcomes.` });
    } catch (err: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });
}
