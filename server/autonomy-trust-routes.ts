/**
 * Autonomy Trust Routes — Phase 4
 * 15 endpoints for the Decision Trust Registry, Autonomous Action Queue,
 * Override Learning, Risk Assessment, and Trust Flywheel.
 */

import type { Express } from "express";
import { isAuthenticated } from "./replit_integrations/auth";
import { requireRole } from "./lib/require-role";
import { handleOrgError, resolveOrgIdOrThrow } from "./lib/resolve-org-id";
import { createAutonomyTables } from "./services/autonomy-scoring-service";

export const autonomyAdminAuth = [isAuthenticated, requireRole("ADMIN")] as const;

export async function registerAutonomyTrustRoutes(app: Express) {
  await createAutonomyTables().catch((error) => {
    console.error("[autonomy-trust] formal schema unavailable; routes remain degraded:", error);
  });

  // ─── Dashboard overview ───────────────────────────────────────────────────
  app.get("/api/autonomy-trust/dashboard", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { getAutonomyDashboard } = await import("./services/autonomy-scoring-service");
      const data = await getAutonomyDashboard(orgId);
      res.json(data);
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      console.error("[autonomy-trust] dashboard error:", e);
      res.status(500).json({ message: "Failed to load dashboard" });
    }
  });

  // ─── Trust flywheel ───────────────────────────────────────────────────────
  app.get("/api/autonomy-trust/flywheel", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { getTrustFlywheel } = await import("./services/autonomy-scoring-service");
      res.json(await getTrustFlywheel(orgId));
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to load flywheel" });
    }
  });

  // ─── Trust registry list ──────────────────────────────────────────────────
  app.get("/api/autonomy-trust/registry", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { getTrustRegistry, seedTrustRegistry } = await import("./services/autonomy-scoring-service");
      const rows = await getTrustRegistry(orgId);
      if (!rows.length) {
        await seedTrustRegistry(orgId);
        res.json(await getTrustRegistry(orgId));
      } else {
        res.json(rows);
      }
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to load trust registry" });
    }
  });

  // ─── Add / update trust registry entry ───────────────────────────────────
  app.post("/api/autonomy-trust/registry", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { decisionType, label, successRate, executions, humanApprovals, humanOverrides, riskLevel, revenueInfluenced } = req.body ?? {};
      if (!decisionType) return res.status(400).json({ message: "decisionType required" });
      const { upsertTrustEntry } = await import("./services/autonomy-scoring-service");
      await upsertTrustEntry(orgId, { decisionType, label, successRate, executions, humanApprovals, humanOverrides, riskLevel, revenueInfluenced });
      res.json({ ok: true });
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to upsert registry entry" });
    }
  });

  // ─── CEO override mode for a decision type ────────────────────────────────
  app.patch("/api/autonomy-trust/registry/:decisionType", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { decisionType } = req.params;
      const { ceoOverrideMode, riskLevel } = req.body ?? {};
      const { upsertTrustEntry } = await import("./services/autonomy-scoring-service");
      await upsertTrustEntry(orgId, { decisionType, ceoOverrideMode: ceoOverrideMode ?? null, riskLevel });
      res.json({ ok: true });
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to update mode" });
    }
  });

  // ─── Evaluate a decision type ─────────────────────────────────────────────
  app.post("/api/autonomy-trust/evaluate", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { decisionType } = req.body ?? {};
      if (!decisionType) return res.status(400).json({ message: "decisionType required" });
      const { evaluateDecision } = await import("./services/autonomy-scoring-service");
      res.json(await evaluateDecision(orgId, decisionType));
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to evaluate decision" });
    }
  });

  // ─── Queue list ───────────────────────────────────────────────────────────
  app.get("/api/autonomy-trust/queue", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { status } = req.query as Record<string, string>;
      const { getActionQueue } = await import("./services/autonomy-scoring-service");
      res.json(await getActionQueue(orgId, status));
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to load queue" });
    }
  });

  // ─── Queue a new action ───────────────────────────────────────────────────
  app.post("/api/autonomy-trust/queue", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { decisionType, agentType, action, description, confidence, riskLevel } = req.body ?? {};
      if (!decisionType || !agentType || !action) return res.status(400).json({ message: "decisionType, agentType, action required" });
      const { queueAction } = await import("./services/autonomy-scoring-service");
      const id = await queueAction({ orgId, decisionType, agentType, action, description, confidence, riskLevel });
      res.json({ ok: true, id });
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to queue action" });
    }
  });

  // ─── Approve queued action ────────────────────────────────────────────────
  app.post("/api/autonomy-trust/queue/:id/approve", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { approveAction } = await import("./services/autonomy-scoring-service");
      await approveAction(orgId, req.params.id, req.user?.claims?.sub ?? req.user?.id ?? "ceo");
      res.json({ ok: true });
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to approve action" });
    }
  });

  // ─── Reject queued action ─────────────────────────────────────────────────
  app.post("/api/autonomy-trust/queue/:id/reject", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { reason } = req.body ?? {};
      const { rejectAction } = await import("./services/autonomy-scoring-service");
      await rejectAction(orgId, req.params.id, req.user?.claims?.sub ?? req.user?.id ?? "ceo", reason);
      res.json({ ok: true });
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to reject action" });
    }
  });

  // ─── Execute an approved action ───────────────────────────────────────────
  app.post("/api/autonomy-trust/queue/:id/execute", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { outcome, revenueCents } = req.body ?? {};
      const { executeQueuedAction } = await import("./services/autonomy-scoring-service");
      await executeQueuedAction(orgId, req.params.id, req.user?.claims?.sub ?? "ceo", outcome, revenueCents);
      res.json({ ok: true });
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to execute action" });
    }
  });

  // ─── Bulk approve by risk level ───────────────────────────────────────────
  app.post("/api/autonomy-trust/queue/bulk-approve", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { maxRisk } = req.body ?? {};
      if (!maxRisk) return res.status(400).json({ message: "maxRisk required (low|medium|high)" });
      const { bulkApproveByRisk } = await import("./services/autonomy-scoring-service");
      const count = await bulkApproveByRisk(orgId, maxRisk, req.user?.claims?.sub ?? "ceo");
      res.json({ ok: true, approved: count });
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to bulk approve" });
    }
  });

  // ─── Override log ─────────────────────────────────────────────────────────
  app.get("/api/autonomy-trust/overrides", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { getOverrides } = await import("./services/autonomy-scoring-service");
      res.json(await getOverrides(orgId));
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to load overrides" });
    }
  });

  // ─── Risk assessment ──────────────────────────────────────────────────────
  app.get("/api/autonomy-trust/risk-assessment", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { getRiskAssessment } = await import("./services/autonomy-scoring-service");
      res.json(await getRiskAssessment(orgId));
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to load risk assessment" });
    }
  });

  // ─── Pause all autonomy ───────────────────────────────────────────────────
  app.post("/api/autonomy-trust/pause-all", ...autonomyAdminAuth, async (req: any, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`
        UPDATE decision_trust_registry
        SET ceo_override_mode = 'observe'
        WHERE org_id = ${orgId} AND recommended_mode = 'execute'
      `);
      res.json({ ok: true, message: "All auto-execute decisions paused" });
    } catch (e: any) {
      if (handleOrgError(e, res)) return;
      res.status(500).json({ message: "Failed to pause autonomy" });
    }
  });
}
