/**
 * Agent Outcome Attribution Routes — Phase 3
 * 14 endpoints covering outcome logging, agent performance,
 * decision effectiveness, self-improving search, CEO reviews, and playbooks.
 */

import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { isAuthenticated } from "./replit_integrations/auth";

async function getAdminOrgId(req: any): Promise<string | null> {
  const userId = req.user?.claims?.sub ?? req.user?.id;
  if (!userId) return null;
  const { storage } = await import("./storage");
  const user = await storage.getUser(userId);
  return user?.orgId ?? null;
}

async function createTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_decision_outcomes (
      id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id              TEXT NOT NULL,
      agent_type          TEXT NOT NULL,
      recommendation      TEXT NOT NULL,
      action_taken        TEXT,
      expected_outcome    TEXT,
      actual_outcome      TEXT,
      success_score       INTEGER,          -- 0-100, null until outcome recorded
      domain              TEXT,
      tags                JSONB DEFAULT '[]',
      revenue_cents       INTEGER DEFAULT 0,
      meetings_generated  INTEGER DEFAULT 0,
      outcome_date        TIMESTAMPTZ,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_perf_scores (
      id                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id                   TEXT NOT NULL,
      agent_type               TEXT NOT NULL,
      recommendations_issued   INTEGER DEFAULT 0,
      recommendations_executed INTEGER DEFAULT 0,
      success_rate             INTEGER DEFAULT 0,   -- avg success score
      revenue_influenced       INTEGER DEFAULT 0,   -- cents
      meetings_generated       INTEGER DEFAULT 0,
      retention_impact         INTEGER DEFAULT 0,   -- clients retained
      last_calculated_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, agent_type)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ceo_daily_reviews (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id            TEXT NOT NULL,
      review_date       DATE NOT NULL,
      what_worked       TEXT NOT NULL,
      what_failed       TEXT NOT NULL,
      what_repeat       TEXT NOT NULL,
      what_stop         TEXT NOT NULL,
      outcomes_analyzed INTEGER DEFAULT 0,
      ai_generated      BOOLEAN DEFAULT true,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, review_date)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS org_playbooks (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id            TEXT NOT NULL,
      title             TEXT NOT NULL,
      description       TEXT,
      source_learning   TEXT,
      pattern_type      TEXT,
      success_rate      INTEGER DEFAULT 0,
      evidence_count    INTEGER DEFAULT 0,
      trigger_condition TEXT,
      actions           TEXT,
      expected_outcome  TEXT,
      status            TEXT DEFAULT 'active',
      promoted_at       TIMESTAMPTZ DEFAULT NOW(),
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function registerAgentOutcomeAttributionRoutes(app: Express) {
  await createTables();

  // ─── Log a new agent decision/recommendation ─────────────────────────────
  app.post("/api/agent-outcomes/log", isAuthenticated, async (req: any, res) => {
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
  app.patch("/api/agent-outcomes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      const { actualOutcome, successScore, actionTaken, revenueCents, meetingsGenerated } = req.body ?? {};
      if (!actualOutcome || successScore === undefined) return res.status(400).json({ message: "actualOutcome and successScore required" });
      const { updateDecisionOutcome } = await import("./services/agent-outcome-attribution-service");
      await updateDecisionOutcome({ id, orgId, actualOutcome, successScore, actionTaken, revenueCents, meetingsGenerated });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update outcome" });
    }
  });

  // ─── List recent attribution records ─────────────────────────────────────
  app.get("/api/agent-outcomes", isAuthenticated, async (req: any, res) => {
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
  app.get("/api/agent-outcomes/performance", isAuthenticated, async (req: any, res) => {
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
  app.post("/api/agent-outcomes/recalculate", isAuthenticated, async (req: any, res) => {
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
  app.get("/api/agent-outcomes/effectiveness", isAuthenticated, async (req: any, res) => {
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
  app.post("/api/agent-outcomes/search-context", isAuthenticated, async (req: any, res) => {
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
  app.post("/api/agent-outcomes/ceo-review/generate", isAuthenticated, async (req: any, res) => {
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
  app.get("/api/agent-outcomes/ceo-review", isAuthenticated, async (req: any, res) => {
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
  app.get("/api/agent-outcomes/playbooks", isAuthenticated, async (req: any, res) => {
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
  app.get("/api/agent-outcomes/playbooks/candidates", isAuthenticated, async (req: any, res) => {
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
  app.post("/api/agent-outcomes/playbooks/promote", isAuthenticated, async (req: any, res) => {
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
  app.patch("/api/agent-outcomes/playbooks/:id", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      const { status, description } = req.body ?? {};
      await db.execute(sql`
        UPDATE org_playbooks SET
          status      = COALESCE(${status ?? null}, status),
          description = COALESCE(${description ?? null}, description)
        WHERE id = ${id} AND org_id = ${orgId}
      `);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update playbook" });
    }
  });

  // ─── Business flywheel metrics ────────────────────────────────────────────
  app.get("/api/agent-outcomes/flywheel", isAuthenticated, async (req: any, res) => {
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
