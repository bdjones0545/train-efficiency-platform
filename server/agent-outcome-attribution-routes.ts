/**
 * Agent Outcome Attribution Routes — Phase 3
 * 14 endpoints covering outcome logging, agent performance,
 * decision effectiveness, self-improving search, CEO reviews, and playbooks.
 */

import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { isAuthenticated } from "./replit_integrations/auth";
import {
  requireAgentOutcomeAttributionSchema,
  validateAgentOutcomeAttributionSchema,
} from "./agent-outcome-attribution-schema-validation";

async function getAdminOrgId(req: any): Promise<string | null> {
  const userId = req.user?.claims?.sub ?? req.user?.id;
  if (!userId) return null;
  const { storage } = await import("./storage");
  const user = await storage.getUser(userId);
  return user?.orgId ?? null;
}

export async function registerAgentOutcomeAttributionRoutes(app: Express) {
  await validateAgentOutcomeAttributionSchema().catch(() => {
    console.warn("[AgentOutcomeAttribution] Schema unavailable; feature routes will return 503");
  });

  // ─── Log a new agent decision/recommendation ─────────────────────────────
  app.post("/api/agent-outcomes/log", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { agentType, recommendation, actionTaken, expectedOutcome, domain, tags, revenueCents } = req.body ?? {};
      if (!agentType || !recommendation) return res.status(400).json({ message: "agentType and recommendation required" });
      const { logDecisionOutcome } = await import("./services/agent-outcome-attribution-service");
      const id = await logDecisionOutcome({ orgId, agentType, recommendation, actionTaken, expectedOutcome, domain, tags, revenueCents });
      res.json({ ok: true, id });
    } catch (e: any) {
      console.error("[outcome-attribution] log error:", e);
      res.status(500).json({ message: "Failed to log decision" });
    }
  });

  // ─── Update decision with actual outcome + success score ─────────────────
  app.patch("/api/agent-outcomes/:id", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      const { actualOutcome, successScore, actionTaken, revenueCents, meetingsGenerated } = req.body ?? {};
      if (!actualOutcome || successScore === undefined) return res.status(400).json({ message: "actualOutcome and successScore required" });
      const { updateDecisionOutcome } = await import("./services/agent-outcome-attribution-service");
      const updated = await updateDecisionOutcome({ id, orgId, actualOutcome, successScore, actionTaken, revenueCents, meetingsGenerated });
      if (!updated) return res.status(404).json({ message: "Outcome not found" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update outcome" });
    }
  });

  // ─── List recent attribution records ─────────────────────────────────────
  app.get("/api/agent-outcomes", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const limit = parseInt((req.query.limit as string) ?? "50");
      const { getRecentOutcomes } = await import("./services/agent-outcome-attribution-service");
      const rows = await getRecentOutcomes(orgId, limit);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch outcomes" });
    }
  });

  // ─── Agent performance scorecards ────────────────────────────────────────
  app.get("/api/agent-outcomes/performance", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getAgentPerfScores } = await import("./services/agent-outcome-attribution-service");
      const rows = await getAgentPerfScores(orgId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch performance scores" });
    }
  });

  // ─── Trigger performance score recalculation ─────────────────────────────
  app.post("/api/agent-outcomes/recalculate", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { recalculatePerfScores } = await import("./services/agent-outcome-attribution-service");
      await recalculatePerfScores(orgId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to recalculate" });
    }
  });

  // ─── Decision effectiveness analysis ─────────────────────────────────────
  app.get("/api/agent-outcomes/effectiveness", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getDecisionEffectiveness } = await import("./services/agent-outcome-attribution-service");
      const data = await getDecisionEffectiveness(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch decision effectiveness" });
    }
  });

  // ─── Self-improving: search similar past decisions ────────────────────────
  app.post("/api/agent-outcomes/search-context", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { query, agentType, limit } = req.body ?? {};
      if (!query) return res.status(400).json({ message: "query required" });
      const { searchSimilarDecisions } = await import("./services/agent-outcome-attribution-service");
      const data = await searchSimilarDecisions({ orgId, query, agentType, limit });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to search similar decisions" });
    }
  });

  // ─── Generate CEO daily review (AI) ──────────────────────────────────────
  app.post("/api/agent-outcomes/ceo-review/generate", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { generateCEOReview, saveCEOReview } = await import("./services/agent-outcome-attribution-service");
      const review = await generateCEOReview(orgId);
      await saveCEOReview(orgId, review);
      res.json(review);
    } catch (e: any) {
      console.error("[outcome-attribution] CEO review error:", e);
      res.status(500).json({ message: "Failed to generate CEO review" });
    }
  });

  // ─── List past CEO reviews ────────────────────────────────────────────────
  app.get("/api/agent-outcomes/ceo-review", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getCEOReviews } = await import("./services/agent-outcome-attribution-service");
      const rows = await getCEOReviews(orgId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch CEO reviews" });
    }
  });

  // ─── List playbooks ───────────────────────────────────────────────────────
  app.get("/api/agent-outcomes/playbooks", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getPlaybooks } = await import("./services/agent-outcome-attribution-service");
      const rows = await getPlaybooks(orgId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch playbooks" });
    }
  });

  // ─── Find playbook promotion candidates ──────────────────────────────────
  app.get("/api/agent-outcomes/playbooks/candidates", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getPlaybookCandidates } = await import("./services/agent-outcome-attribution-service");
      const rows = await getPlaybookCandidates(orgId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch playbook candidates" });
    }
  });

  // ─── Promote pattern to official playbook ────────────────────────────────
  app.post("/api/agent-outcomes/playbooks/promote", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { title, description, sourceLearning, patternType, successRate, evidenceCount, triggerCondition, actions, expectedOutcome } = req.body ?? {};
      if (!title || !sourceLearning) return res.status(400).json({ message: "title and sourceLearning required" });
      const { promoteToPlaybook } = await import("./services/agent-outcome-attribution-service");
      const id = await promoteToPlaybook(orgId, { title, description, sourceLearning, patternType, successRate: successRate ?? 0, evidenceCount: evidenceCount ?? 0, triggerCondition, actions, expectedOutcome });
      res.json({ ok: true, id });
    } catch (e: any) {
      console.error("[outcome-attribution] promote error:", e);
      res.status(500).json({ message: "Failed to promote playbook" });
    }
  });

  // ─── Update playbook status ───────────────────────────────────────────────
  app.patch("/api/agent-outcomes/playbooks/:id", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      const { status, description } = req.body ?? {};
      const result = await db.execute(sql`
        UPDATE org_playbooks SET
          status      = COALESCE(${status ?? null}, status),
          description = COALESCE(${description ?? null}, description)
        WHERE id = ${id} AND org_id = ${orgId}
        RETURNING id
      `);
      if (result.rows.length === 0) return res.status(404).json({ message: "Playbook not found" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update playbook" });
    }
  });

  // ─── Business flywheel metrics ────────────────────────────────────────────
  app.get("/api/agent-outcomes/flywheel", isAuthenticated, requireAgentOutcomeAttributionSchema, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getBusinessFlywheel } = await import("./services/agent-outcome-attribution-service");
      const data = await getBusinessFlywheel(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch flywheel metrics" });
    }
  });
}
