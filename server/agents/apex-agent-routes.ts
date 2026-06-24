/**
 * Apex Agent Routes
 *
 * GET  /api/agents/apex/status                    — last run summary per org
 * POST /api/agents/apex/run                        — manual trigger (admin only)
 * GET  /api/agents/apex/recommendations            — pending_review recs from apex_recommendations
 * POST /api/agents/apex/recommendations/:id/approve   — mark approved
 * POST /api/agents/apex/recommendations/:id/dismiss   — mark dismissed (with optional reason)
 * POST /api/agents/apex/recommendations/:id/complete  — mark completed
 * GET  /api/agents/apex/audit                      — live proof of action counts
 * GET  /api/agents/apex/history                    — recent unified_agent_action_log entries
 * GET  /api/agents/apex/summary/weekly             — 7-day summary: new/closed/top/ignored
 */

import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { db } from "../db";
import { sql, eq, and, desc, gte, lt, ne } from "drizzle-orm";
import { unifiedAgentActionLog, apexRecommendations } from "@shared/schema";
import { runApexForOrg } from "./apex-agent";
import { ensureApexRecommendationsTable } from "./apex-agent";

function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Admin access required" });
  next();
}

function requireCoachOrAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "COACH") {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
}

export function registerApexAgentRoutes(app: Express): void {

  // ── Status: last run info ──────────────────────────────────────────────────
  app.get("/api/agents/apex/status", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;

      const lastRun = await db
        .select()
        .from(unifiedAgentActionLog)
        .where(and(
          eq(unifiedAgentActionLog.orgId, orgId),
          eq(unifiedAgentActionLog.actorType, "growth_agent"),
          eq(unifiedAgentActionLog.actionType, "apex:run_complete"),
        ))
        .orderBy(desc(unifiedAgentActionLog.createdAt))
        .limit(1)
        .catch(() => []);

      const [totalRow] = await db.execute(sql`
        SELECT COUNT(*)::int AS total FROM unified_agent_action_log
        WHERE org_id = ${orgId} AND actor_type = 'growth_agent'
      `).then(r => Array.isArray(r) ? r : (r as any).rows ?? []).catch(() => [{ total: 0 }]);

      const last30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [row30d] = await db.execute(sql`
        SELECT COUNT(*)::int AS total FROM unified_agent_action_log
        WHERE org_id = ${orgId} AND actor_type = 'growth_agent' AND created_at >= ${last30d}
      `).then(r => Array.isArray(r) ? r : (r as any).rows ?? []).catch(() => [{ total: 0 }]);

      const [pendingRow] = await db.execute(sql`
        SELECT COUNT(*)::int AS pending FROM apex_recommendations
        WHERE org_id = ${orgId} AND status = 'pending_review'
      `).then(r => Array.isArray(r) ? r : (r as any).rows ?? []).catch(() => [{ pending: 0 }]);

      const run = lastRun[0];
      const out = run?.outputSnapshot as Record<string, any> | null;

      res.json({
        agentType: "growth_agent",
        agentName: "Apex",
        status: run ? (run.status === "failed" ? "error" : "idle") : "never_run",
        lastRunAt: run?.createdAt ?? null,
        lastRunStatus: run?.status ?? null,
        lastRunDurationMs: out?.durationMs ?? null,
        lastRunSignals: out?.signalsDetected ?? null,
        lastRunNew: out?.newRecommendations ?? null,
        lastRunDeduped: out?.skippedDuplicates ?? null,
        lastRunExpired: out?.expired ?? null,
        lastRunError: run?.errorMessage ?? null,
        totalActions: Number(totalRow?.total ?? 0),
        actionsLast30Days: Number(row30d?.total ?? 0),
        pendingRecommendations: Number(pendingRow?.pending ?? 0),
        scheduledInterval: "daily",
        triggeredBy: (run?.inputSnapshot as any)?.triggeredBy ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch Apex status" });
    }
  });

  // ── Manual trigger ────────────────────────────────────────────────────────
  app.post("/api/agents/apex/run", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const result = await runApexForOrg(orgId, "manual");
      res.json({
        success: !result.error,
        runId: result.runId,
        durationMs: result.durationMs,
        dealsEvaluated: result.dealsEvaluated,
        prospectsEvaluated: result.prospectsEvaluated,
        leadsEvaluated: result.leadsEvaluated,
        signalsDetected: result.signalsDetected,
        newRecommendations: result.newRecommendations,
        skippedDuplicates: result.skippedDuplicates,
        expired: result.expired,
        error: result.error ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Failed to run Apex agent" });
    }
  });

  // ── Recommendations: from apex_recommendations table ──────────────────────
  app.get("/api/agents/apex/recommendations", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      await ensureApexRecommendationsTable();

      const statusFilter = (req.query.status as string) || "pending_review";
      const limitParam = Math.min(Number(req.query.limit ?? 50), 200);

      const rows = await db
        .select()
        .from(apexRecommendations)
        .where(
          statusFilter === "all"
            ? eq(apexRecommendations.orgId, orgId)
            : and(
                eq(apexRecommendations.orgId, orgId),
                eq(apexRecommendations.status, statusFilter),
              )
        )
        .orderBy(desc(apexRecommendations.createdAt))
        .limit(limitParam)
        .catch(() => []);

      res.json({ recommendations: rows, total: rows.length, statusFilter });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch recommendations" });
    }
  });

  // ── Approve ───────────────────────────────────────────────────────────────
  app.post("/api/agents/apex/recommendations/:id/approve", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const { id } = req.params;
      const now = new Date();

      const [updated] = await db
        .update(apexRecommendations)
        .set({ status: "approved", statusUpdatedAt: now, statusUpdatedBy: req.user.id ?? "admin" })
        .where(and(eq(apexRecommendations.id, id), eq(apexRecommendations.orgId, orgId)))
        .returning()
        .catch(() => []);

      if (!updated) return res.status(404).json({ message: "Recommendation not found" });
      res.json({ success: true, recommendation: updated });
    } catch {
      res.status(500).json({ message: "Failed to approve recommendation" });
    }
  });

  // ── Dismiss ───────────────────────────────────────────────────────────────
  app.post("/api/agents/apex/recommendations/:id/dismiss", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const { id } = req.params;
      const { reason } = req.body as { reason?: string };
      const now = new Date();

      const [updated] = await db
        .update(apexRecommendations)
        .set({
          status: "dismissed",
          statusUpdatedAt: now,
          statusUpdatedBy: req.user.id ?? "admin",
          dismissReason: reason ?? null,
        })
        .where(and(eq(apexRecommendations.id, id), eq(apexRecommendations.orgId, orgId)))
        .returning()
        .catch(() => []);

      if (!updated) return res.status(404).json({ message: "Recommendation not found" });
      res.json({ success: true, recommendation: updated });
    } catch {
      res.status(500).json({ message: "Failed to dismiss recommendation" });
    }
  });

  // ── Mark Complete ─────────────────────────────────────────────────────────
  app.post("/api/agents/apex/recommendations/:id/complete", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const { id } = req.params;
      const now = new Date();

      const [updated] = await db
        .update(apexRecommendations)
        .set({ status: "completed", statusUpdatedAt: now, statusUpdatedBy: req.user.id ?? "admin" })
        .where(and(eq(apexRecommendations.id, id), eq(apexRecommendations.orgId, orgId)))
        .returning()
        .catch(() => []);

      if (!updated) return res.status(404).json({ message: "Recommendation not found" });
      res.json({ success: true, recommendation: updated });
    } catch {
      res.status(500).json({ message: "Failed to complete recommendation" });
    }
  });

  // ── Audit: proof that unified_agent_action_log is populated ──────────────
  app.get("/api/agents/apex/audit", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;

      const bySignalType = await db.execute(sql`
        SELECT action_type, COUNT(*)::int AS count, MAX(created_at) AS last_seen
        FROM unified_agent_action_log
        WHERE org_id = ${orgId} AND actor_type = 'growth_agent'
        GROUP BY action_type ORDER BY count DESC
      `).then(r => Array.isArray(r) ? r : (r as any).rows ?? []).catch(() => []);

      const [totals] = await db.execute(sql`
        SELECT
          COUNT(*)::int                                              AS total_actions,
          COUNT(*) FILTER (WHERE status = 'completed')::int         AS completed,
          COUNT(*) FILTER (WHERE status = 'requires_approval')::int AS pending_review,
          COUNT(*) FILTER (WHERE status = 'failed')::int            AS failed,
          MIN(created_at)                                            AS first_action_at,
          MAX(created_at)                                            AS last_action_at
        FROM unified_agent_action_log
        WHERE org_id = ${orgId} AND actor_type = 'growth_agent'
      `).then(r => Array.isArray(r) ? r : (r as any).rows ?? [{}]).catch(() => [{}]);

      const last30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [c30] = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM unified_agent_action_log
        WHERE org_id = ${orgId} AND actor_type = 'growth_agent' AND created_at >= ${last30d}
      `).then(r => Array.isArray(r) ? r : (r as any).rows ?? [{}]).catch(() => [{}]);

      const [recTotals] = await db.execute(sql`
        SELECT
          COUNT(*)::int                                              AS total,
          COUNT(*) FILTER (WHERE status = 'pending_review')::int    AS pending,
          COUNT(*) FILTER (WHERE status = 'approved')::int          AS approved,
          COUNT(*) FILTER (WHERE status = 'dismissed')::int         AS dismissed,
          COUNT(*) FILTER (WHERE status = 'completed')::int         AS completed,
          COUNT(*) FILTER (WHERE status = 'expired')::int           AS expired
        FROM apex_recommendations
        WHERE org_id = ${orgId}
      `).then(r => Array.isArray(r) ? r : (r as any).rows ?? [{}]).catch(() => [{}]);

      const t = totals ?? {};
      res.json({
        table: "unified_agent_action_log",
        actorType: "growth_agent",
        agentName: "Apex",
        totals: {
          allTime: Number(t.total_actions ?? 0),
          last30Days: Number(c30?.count ?? 0),
          completed: Number(t.completed ?? 0),
          pendingReview: Number(t.pending_review ?? 0),
          failed: Number(t.failed ?? 0),
          firstActionAt: t.first_action_at ?? null,
          lastActionAt: t.last_action_at ?? null,
        },
        recommendations: {
          total: Number(recTotals?.total ?? 0),
          pending: Number(recTotals?.pending ?? 0),
          approved: Number(recTotals?.approved ?? 0),
          dismissed: Number(recTotals?.dismissed ?? 0),
          completed: Number(recTotals?.completed ?? 0),
          expired: Number(recTotals?.expired ?? 0),
        },
        bySignalType: bySignalType.map((r: any) => ({
          signalType: String(r.action_type),
          count: Number(r.count),
          lastSeen: r.last_seen,
        })),
        auditNote: "All counts are live reads from unified_agent_action_log WHERE actor_type = 'growth_agent'",
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch audit data" });
    }
  });

  // ── History: recent unified_agent_action_log entries ─────────────────────
  app.get("/api/agents/apex/history", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const limitParam = Math.min(Number(req.query.limit ?? 100), 200);

      const rows = await db
        .select()
        .from(unifiedAgentActionLog)
        .where(and(
          eq(unifiedAgentActionLog.orgId, orgId),
          eq(unifiedAgentActionLog.actorType, "growth_agent"),
        ))
        .orderBy(desc(unifiedAgentActionLog.createdAt))
        .limit(limitParam)
        .catch(() => []);

      res.json({ entries: rows, total: rows.length });
    } catch {
      res.status(500).json({ message: "Failed to fetch history" });
    }
  });

  // ── Weekly Summary ────────────────────────────────────────────────────────
  app.get("/api/agents/apex/summary/weekly", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      await ensureApexRecommendationsTable();

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // New signals this week
      const newSignals = await db
        .select()
        .from(apexRecommendations)
        .where(and(
          eq(apexRecommendations.orgId, orgId),
          gte(apexRecommendations.createdAt, sevenDaysAgo),
        ))
        .orderBy(desc(apexRecommendations.createdAt))
        .catch(() => []);

      // Closed this week (approved + completed)
      const closedSignals = await db
        .select()
        .from(apexRecommendations)
        .where(and(
          eq(apexRecommendations.orgId, orgId),
          gte(apexRecommendations.statusUpdatedAt, sevenDaysAgo),
          sql`status IN ('approved', 'completed')`,
        ))
        .orderBy(desc(apexRecommendations.statusUpdatedAt))
        .catch(() => []);

      // Top revenue opportunities (pending, by estimated_value_cents desc)
      const topOpportunities = await db
        .select()
        .from(apexRecommendations)
        .where(and(
          eq(apexRecommendations.orgId, orgId),
          eq(apexRecommendations.status, "pending_review"),
          sql`estimated_value_cents > 0`,
        ))
        .orderBy(desc(apexRecommendations.estimatedValueCents))
        .limit(5)
        .catch(() => []);

      // Ignored/dismissed this week
      const ignoredSignals = await db
        .select()
        .from(apexRecommendations)
        .where(and(
          eq(apexRecommendations.orgId, orgId),
          gte(apexRecommendations.statusUpdatedAt, sevenDaysAgo),
          sql`status IN ('dismissed', 'expired')`,
        ))
        .orderBy(desc(apexRecommendations.statusUpdatedAt))
        .catch(() => []);

      // All pending (for urgency breakdown)
      const allPending = await db
        .select()
        .from(apexRecommendations)
        .where(and(
          eq(apexRecommendations.orgId, orgId),
          eq(apexRecommendations.status, "pending_review"),
        ))
        .catch(() => []);

      const totalEstimatedValue = allPending.reduce((sum, r) => sum + (r.estimatedValueCents ?? 0), 0);
      const urgencyBreakdown = allPending.reduce((acc: Record<string, number>, r) => {
        acc[r.urgency] = (acc[r.urgency] ?? 0) + 1;
        return acc;
      }, {});

      res.json({
        period: { from: sevenDaysAgo, to: new Date() },
        summary: {
          newSignals: newSignals.length,
          closedSignals: closedSignals.length,
          ignoredSignals: ignoredSignals.length,
          pendingCount: allPending.length,
          totalEstimatedValueCents: totalEstimatedValue,
          urgencyBreakdown,
        },
        newSignals: newSignals.slice(0, 10),
        closedSignals: closedSignals.slice(0, 10),
        topOpportunities,
        ignoredSignals: ignoredSignals.slice(0, 10),
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch weekly summary" });
    }
  });
}
