/**
 * Athlete Intelligence Routes (PAIL)
 *
 * Endpoints for managing and querying persistent athlete memory,
 * exercise effectiveness, session outcomes, coach note intelligence,
 * and athlete autonomy trust levels.
 */

import type { Express } from "express";
import { db } from "./db";
import { eq, and, desc, gte, asc } from "drizzle-orm";
import {
  athleteMemoryProfiles,
  exerciseEffectivenessScores,
  athleteSessionOutcomes,
  programAdaptationDrafts,
  workoutCompletionLogs,
  workoutReadinessCheckins,
  athleteRiskFlags,
  orgUsers,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth";

async function getAdminOrgId(req: any): Promise<string | null> {
  const userId = req.user?.claims?.sub ?? req.user?.id;
  if (!userId) return null;
  const [row] = await db.select({ orgId: orgUsers.orgId })
    .from(orgUsers)
    .where(eq(orgUsers.userId, userId))
    .limit(1)
    .catch(() => []);
  return row?.orgId ?? (req.query.orgId as string) ?? null;
}

export async function registerAthleteIntelligenceRoutes(app: Express) {
  // ── GET /api/admin/athlete-intelligence/athletes ──────────────────────────
  // Overview: all athletes with memory summaries and risk badges.
  app.get("/api/admin/athlete-intelligence/athletes", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });

      // Memory profiles for all athletes in this org
      const profiles = await db.select()
        .from(athleteMemoryProfiles)
        .where(eq(athleteMemoryProfiles.orgId, orgId))
        .orderBy(desc(athleteMemoryProfiles.updatedAt))
        .catch(() => []);

      // Recent completion logs for compliance (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const completions = await db.select({
        athleteUserId: workoutCompletionLogs.athleteUserId,
      })
        .from(workoutCompletionLogs)
        .where(and(
          eq(workoutCompletionLogs.orgId, orgId),
          gte(workoutCompletionLogs.createdAt, thirtyDaysAgo),
        ))
        .catch(() => []);

      // Recent risk flags
      const riskFlags = await db.select()
        .from(athleteRiskFlags)
        .where(and(
          eq(athleteRiskFlags.orgId, orgId),
          gte(athleteRiskFlags.createdAt, thirtyDaysAgo),
        ))
        .catch(() => []);

      // Compile compliance map
      const complianceMap = new Map<string, number>();
      for (const c of completions) {
        complianceMap.set(c.athleteUserId, (complianceMap.get(c.athleteUserId) ?? 0) + 1);
      }

      // Compile risk flag map
      const riskMap = new Map<string, { count: number; highestSeverity: string }>();
      for (const f of riskFlags) {
        const existing = riskMap.get(f.athleteUserId) ?? { count: 0, highestSeverity: "low" };
        existing.count++;
        if (f.severity === "critical" || (f.severity === "high" && existing.highestSeverity !== "critical")) {
          existing.highestSeverity = f.severity ?? "low";
        }
        riskMap.set(f.athleteUserId, existing);
      }

      const result = profiles.map(p => ({
        ...p,
        recentCompletions: complianceMap.get(p.athleteUserId) ?? 0,
        activeRiskFlags: riskMap.get(p.athleteUserId)?.count ?? 0,
        highestRiskSeverity: riskMap.get(p.athleteUserId)?.highestSeverity ?? null,
      }));

      res.json({ athletes: result, total: result.length });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load athletes", error: e.message });
    }
  });

  // ── GET /api/admin/athlete-intelligence/profile/:athleteUserId ────────────
  app.get("/api/admin/athlete-intelligence/profile/:athleteUserId", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });
      const { athleteUserId } = req.params;

      const [profile] = await db.select()
        .from(athleteMemoryProfiles)
        .where(and(
          eq(athleteMemoryProfiles.orgId, orgId),
          eq(athleteMemoryProfiles.athleteUserId, athleteUserId),
        ))
        .limit(1)
        .catch(() => []);

      if (!profile) {
        return res.json({ profile: null, message: "No memory profile yet — run synthesis to generate one" });
      }

      res.json({ profile });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load profile", error: e.message });
    }
  });

  // ── PUT /api/admin/athlete-intelligence/profile/:athleteUserId ────────────
  // Manual coach override of any memory profile field.
  app.put("/api/admin/athlete-intelligence/profile/:athleteUserId", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });
      const { athleteUserId } = req.params;

      const [existing] = await db.select({ id: athleteMemoryProfiles.id })
        .from(athleteMemoryProfiles)
        .where(and(
          eq(athleteMemoryProfiles.orgId, orgId),
          eq(athleteMemoryProfiles.athleteUserId, athleteUserId),
        ))
        .limit(1)
        .catch(() => []);

      const updates = { ...req.body, updatedAt: new Date() };

      if (existing) {
        await db.update(athleteMemoryProfiles).set(updates).where(eq(athleteMemoryProfiles.id, existing.id));
      } else {
        await db.insert(athleteMemoryProfiles).values({ orgId, athleteUserId, ...updates });
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update profile", error: e.message });
    }
  });

  // ── POST /api/admin/athlete-intelligence/synthesize/:athleteUserId ─────────
  // Trigger full AI synthesis for one athlete.
  app.post("/api/admin/athlete-intelligence/synthesize/:athleteUserId", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });
      const { athleteUserId } = req.params;

      const { synthesizeAthleteIntelligence } = await import("./services/athlete-learning-engine");
      const result = await synthesizeAthleteIntelligence(athleteUserId, orgId);
      res.json({ success: true, result });
    } catch (e: any) {
      res.status(500).json({ message: "Synthesis failed", error: e.message });
    }
  });

  // ── POST /api/admin/athlete-intelligence/synthesize-org ───────────────────
  // Trigger synthesis for all active athletes in the org.
  app.post("/api/admin/athlete-intelligence/synthesize-org", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });

      const { runAthleteLearningSynthesisForOrg } = await import("./services/athlete-learning-engine");
      const result = await runAthleteLearningSynthesisForOrg(orgId);
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ message: "Org synthesis failed", error: e.message });
    }
  });

  // ── GET /api/admin/athlete-intelligence/effectiveness/:athleteUserId ───────
  app.get("/api/admin/athlete-intelligence/effectiveness/:athleteUserId", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });
      const { athleteUserId } = req.params;

      const scores = await db.select()
        .from(exerciseEffectivenessScores)
        .where(and(
          eq(exerciseEffectivenessScores.orgId, orgId),
          eq(exerciseEffectivenessScores.athleteUserId, athleteUserId),
        ))
        .orderBy(desc(exerciseEffectivenessScores.effectivenessScore))
        .catch(() => []);

      res.json({ scores, total: scores.length });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load effectiveness scores", error: e.message });
    }
  });

  // ── GET /api/admin/athlete-intelligence/session-outcomes/:athleteUserId ────
  app.get("/api/admin/athlete-intelligence/session-outcomes/:athleteUserId", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });
      const { athleteUserId } = req.params;
      const limit = parseInt(req.query.limit as string) || 30;

      const outcomes = await db.select()
        .from(athleteSessionOutcomes)
        .where(and(
          eq(athleteSessionOutcomes.orgId, orgId),
          eq(athleteSessionOutcomes.athleteUserId, athleteUserId),
        ))
        .orderBy(desc(athleteSessionOutcomes.createdAt))
        .limit(limit)
        .catch(() => []);

      res.json({ outcomes, total: outcomes.length });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load session outcomes", error: e.message });
    }
  });

  // ── POST /api/admin/athlete-intelligence/analyze-notes/:athleteUserId ──────
  // Trigger coach note AI analysis for one athlete.
  app.post("/api/admin/athlete-intelligence/analyze-notes/:athleteUserId", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });
      const { athleteUserId } = req.params;

      const { analyzeCoachNotesForAthlete } = await import("./services/coach-note-intelligence-service");
      const intelligence = await analyzeCoachNotesForAthlete(athleteUserId, orgId);

      if (!intelligence) {
        return res.json({ success: false, message: "No coach notes found to analyze" });
      }

      res.json({ success: true, intelligence });
    } catch (e: any) {
      res.status(500).json({ message: "Note analysis failed", error: e.message });
    }
  });

  // ── PUT /api/admin/athlete-intelligence/trust-level/:athleteUserId ─────────
  // Coach adjusts athlete autonomy trust level (0-3).
  app.put("/api/admin/athlete-intelligence/trust-level/:athleteUserId", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });
      const { athleteUserId } = req.params;
      const { trustLevel, reason } = req.body;

      if (typeof trustLevel !== "number" || trustLevel < 0 || trustLevel > 3) {
        return res.status(400).json({ message: "trustLevel must be 0, 1, 2, or 3" });
      }

      const [existing] = await db.select({ id: athleteMemoryProfiles.id })
        .from(athleteMemoryProfiles)
        .where(and(
          eq(athleteMemoryProfiles.orgId, orgId),
          eq(athleteMemoryProfiles.athleteUserId, athleteUserId),
        ))
        .limit(1)
        .catch(() => []);

      if (existing) {
        await db.update(athleteMemoryProfiles)
          .set({ trustLevel, trustLevelReason: reason ?? null, updatedAt: new Date() })
          .where(eq(athleteMemoryProfiles.id, existing.id));
      } else {
        await db.insert(athleteMemoryProfiles).values({ orgId, athleteUserId, trustLevel, trustLevelReason: reason ?? null });
      }

      res.json({ success: true, trustLevel });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update trust level", error: e.message });
    }
  });

  // ── GET /api/admin/athlete-intelligence/adaptation-history/:athleteUserId ──
  app.get("/api/admin/athlete-intelligence/adaptation-history/:athleteUserId", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });
      const { athleteUserId } = req.params;

      const adaptations = await db.select()
        .from(programAdaptationDrafts)
        .where(and(
          eq(programAdaptationDrafts.orgId, orgId),
          eq(programAdaptationDrafts.athleteUserId, athleteUserId),
        ))
        .orderBy(desc(programAdaptationDrafts.createdAt))
        .limit(20)
        .catch(() => []);

      res.json({ adaptations, total: adaptations.length });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load adaptation history", error: e.message });
    }
  });

  // ── POST /api/admin/athlete-intelligence/session-outcome ──────────────────
  // Record a session outcome (called from workout execution routes).
  app.post("/api/admin/athlete-intelligence/session-outcome", isAuthenticated, async (req, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(401).json({ message: "Unauthorized" });

      const { athleteUserId, sessionId, programId, ...rest } = req.body;
      if (!athleteUserId || !sessionId) {
        return res.status(400).json({ message: "athleteUserId and sessionId required" });
      }

      const [inserted] = await db.insert(athleteSessionOutcomes)
        .values({ orgId, athleteUserId, sessionId, programId, ...rest })
        .returning();

      res.json({ success: true, outcome: inserted });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to record outcome", error: e.message });
    }
  });
}
