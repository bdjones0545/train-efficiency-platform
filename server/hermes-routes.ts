/**
 * Hermes Routes — Sprint 2
 *
 * Deliverables covered:
 *   D5 — /api/actions/:id/context    (action review context)
 *   D6 — /api/hermes/stats           (CEO Heartbeat card data)
 *   D7 — /api/hermes/health          (health monitoring)
 *   D8 — /api/hermes/recommendations/:id/feedback  (feedback loop)
 *        /api/hermes/recommendations  (list)
 *        /api/hermes/run             (manual trigger)
 *        /api/hermes/queue           (unified action queue)
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  runHermesIntelligenceCycle,
  getHermesStats,
  getHermesHealth,
  ensureHermesTables,
} from "./services/hermes-recommendation-engine";
import {
  getUnifiedActionQueue,
  getActionContext,
} from "./services/unified-action-queue";

function getOrgId(req: any): string {
  return req.user?.orgId as string;
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!(req as any).user) {
    res.status(401).json({ message: "Not authenticated" });
    return false;
  }
  return true;
}

export function registerHermesRoutes(app: Express): void {

  // ─── GET /api/hermes/stats ───────────────────────────────────────────────
  app.get("/api/hermes/stats", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = getOrgId(req);
      await ensureHermesTables();
      const stats = await getHermesStats(orgId);
      res.json({ ...stats, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load Hermes stats" });
    }
  });

  // ─── GET /api/hermes/health ──────────────────────────────────────────────
  app.get("/api/hermes/health", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = getOrgId(req);
      await ensureHermesTables();
      const health = await getHermesHealth(orgId);
      res.json({ ...health, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load Hermes health" });
    }
  });

  // ─── GET /api/hermes/recommendations ────────────────────────────────────
  app.get("/api/hermes/recommendations", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = getOrgId(req);
      await ensureHermesTables();
      const { type, status, limit = "50", offset = "0" } = req.query as Record<string, string>;

      const rows = await db.execute(sql`
        SELECT
          id, org_id, run_id, type, title, reason, confidence,
          source_system, source_conversation_id, source_record_id,
          gmail_thread_id, recommended_action, action_queue_id,
          status, metadata, created_at, updated_at
        FROM hermes_recommendations
        WHERE org_id = ${orgId}
          ${type ? sql`AND type = ${type}` : sql``}
          ${status ? sql`AND status = ${status}` : sql``}
        ORDER BY created_at DESC
        LIMIT ${parseInt(limit, 10)}
        OFFSET ${parseInt(offset, 10)}
      `).catch(() => ({ rows: [] }));

      const r: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

      const countRows = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM hermes_recommendations
        WHERE org_id = ${orgId}
          ${type ? sql`AND type = ${type}` : sql``}
          ${status ? sql`AND status = ${status}` : sql``}
      `).catch(() => ({ rows: [] }));
      const cr: any[] = Array.isArray(countRows) ? countRows : (countRows as any).rows ?? [];

      res.json({
        recommendations: r.map((rec) => ({
          ...rec,
          confidence: Number(rec.confidence ?? 0),
          createdAt: rec.created_at,
          updatedAt: rec.updated_at,
        })),
        total: Number(cr[0]?.cnt ?? 0),
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load recommendations" });
    }
  });

  // ─── GET /api/hermes/recommendations/:id ────────────────────────────────
  app.get("/api/hermes/recommendations/:id", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = getOrgId(req);
      await ensureHermesTables();
      const rows = await db.execute(sql`
        SELECT * FROM hermes_recommendations
        WHERE id = ${req.params.id} AND org_id = ${orgId}
        LIMIT 1
      `).catch(() => ({ rows: [] }));
      const r: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
      if (!r[0]) return res.status(404).json({ message: "Recommendation not found" });

      const fbRows = await db.execute(sql`
        SELECT * FROM hermes_recommendation_feedback
        WHERE recommendation_id = ${req.params.id}
        ORDER BY created_at DESC
      `).catch(() => ({ rows: [] }));
      const fb: any[] = Array.isArray(fbRows) ? fbRows : (fbRows as any).rows ?? [];

      res.json({ recommendation: r[0], feedback: fb, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load recommendation" });
    }
  });

  // ─── POST /api/hermes/recommendations/:id/feedback ───────────────────────
  // Deliverable 8 — Recommendation Feedback Loop
  app.post("/api/hermes/recommendations/:id/feedback", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = getOrgId(req);
      await ensureHermesTables();
      const { outcome, editNotes, actionQueueId, finalOutcome } = req.body;

      if (!outcome || !["approved", "rejected", "edited", "dismissed"].includes(outcome)) {
        return res.status(400).json({ message: "outcome must be: approved, rejected, edited, or dismissed" });
      }

      const recRows = await db.execute(sql`
        SELECT id, confidence FROM hermes_recommendations
        WHERE id = ${req.params.id} AND org_id = ${orgId}
        LIMIT 1
      `).catch(() => ({ rows: [] }));
      const rr: any[] = Array.isArray(recRows) ? recRows : (recRows as any).rows ?? [];
      if (!rr[0]) return res.status(404).json({ message: "Recommendation not found" });

      const originalConfidence = Number(rr[0].confidence ?? 0);

      const fbRows = await db.execute(sql`
        INSERT INTO hermes_recommendation_feedback (
          id, recommendation_id, action_queue_id, outcome, editor_id,
          edit_notes, original_confidence, final_outcome, created_at
        ) VALUES (
          gen_random_uuid()::text,
          ${req.params.id},
          ${actionQueueId ?? null},
          ${outcome},
          ${req.user?.id ?? null},
          ${editNotes ?? null},
          ${originalConfidence},
          ${finalOutcome ?? null},
          NOW()
        )
        RETURNING id
      `).catch(() => ({ rows: [] }));
      const fb: any[] = Array.isArray(fbRows) ? fbRows : (fbRows as any).rows ?? [];

      if (outcome === "dismissed") {
        await db.execute(sql`
          UPDATE hermes_recommendations SET status = 'dismissed', updated_at = NOW()
          WHERE id = ${req.params.id}
        `).catch(() => {});
      }

      res.json({
        success: true,
        feedbackId: fb[0]?.id,
        outcome,
        recommendationId: req.params.id,
        recordedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to record feedback" });
    }
  });

  // ─── POST /api/hermes/run ────────────────────────────────────────────────
  // Manual trigger for a Hermes intelligence cycle
  app.post("/api/hermes/run", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = getOrgId(req);
      await ensureHermesTables();
      console.log(`[HermesRoutes] Manual Hermes cycle triggered by user=${req.user?.id} org=${orgId}`);
      const result = await runHermesIntelligenceCycle(orgId);
      res.json({ success: true, ...result, triggeredAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to run Hermes cycle" });
    }
  });

  // ─── GET /api/hermes/queue ───────────────────────────────────────────────
  // Deliverable 4 — Unified Action Queue read layer
  app.get("/api/hermes/queue", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = getOrgId(req);
      const {
        limit = "100",
        offset = "0",
        minConfidence,
        sourceSystem,
        status,
      } = req.query as Record<string, string>;

      const result = await getUnifiedActionQueue(orgId, {
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        minConfidence: minConfidence ? parseInt(minConfidence, 10) : undefined,
        sourceSystem: sourceSystem ? ([sourceSystem] as any) : undefined,
        status: status ? [status] : undefined,
      });

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load unified action queue" });
    }
  });

  // ─── GET /api/actions/:id/context ───────────────────────────────────────
  // Deliverable 5 — Action Review Context Package
  app.get("/api/actions/:id/context", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = getOrgId(req);
      const ctx = await getActionContext(orgId, req.params.id);
      if (!ctx) {
        return res.status(404).json({ message: "Action not found in any queue" });
      }
      res.json({ ...ctx, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load action context" });
    }
  });

  // ─── GET /api/hermes/feedback ────────────────────────────────────────────
  // Feedback history for confidence calibration visibility
  app.get("/api/hermes/feedback", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = getOrgId(req);
      await ensureHermesTables();

      const rows = await db.execute(sql`
        SELECT
          hf.id, hf.recommendation_id, hf.outcome, hf.editor_id,
          hf.original_confidence, hf.final_outcome, hf.edit_notes,
          hf.created_at,
          hr.type as recommendation_type, hr.title as recommendation_title
        FROM hermes_recommendation_feedback hf
        JOIN hermes_recommendations hr ON hr.id = hf.recommendation_id
        WHERE hr.org_id = ${orgId}
        ORDER BY hf.created_at DESC
        LIMIT 100
      `).catch(() => ({ rows: [] }));
      const r: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

      const summaryRows = await db.execute(sql`
        SELECT
          hr.type,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE hf.outcome = 'approved') as approved,
          COUNT(*) FILTER (WHERE hf.outcome = 'rejected') as rejected,
          COUNT(*) FILTER (WHERE hf.outcome = 'edited') as edited,
          AVG(hf.original_confidence) as avg_confidence
        FROM hermes_recommendation_feedback hf
        JOIN hermes_recommendations hr ON hr.id = hf.recommendation_id
        WHERE hr.org_id = ${orgId}
          AND hf.created_at > NOW() - INTERVAL '30 days'
        GROUP BY hr.type
      `).catch(() => ({ rows: [] }));
      const sr: any[] = Array.isArray(summaryRows) ? summaryRows : (summaryRows as any).rows ?? [];

      res.json({
        feedback: r,
        summary: sr.map((s) => ({
          type: s.type,
          total: Number(s.total),
          approved: Number(s.approved),
          rejected: Number(s.rejected),
          edited: Number(s.edited),
          avgConfidence: s.avg_confidence ? Math.round(Number(s.avg_confidence) * 100) : 0,
          approvalRate: Number(s.total) > 0 ? Math.round((Number(s.approved) / Number(s.total)) * 100) : 0,
        })),
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load feedback history" });
    }
  });

  console.log("[Hermes] Routes registered");
}
