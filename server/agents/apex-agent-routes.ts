/**
 * Apex Agent Routes
 *
 * GET  /api/agents/apex/status          — last run summary per org
 * POST /api/agents/apex/run             — manual trigger (admin only)
 * GET  /api/agents/apex/recommendations — ranked signals from last run
 * GET  /api/agents/apex/audit           — live proof of action counts in unified_agent_action_log
 * GET  /api/agents/apex/history         — recent unified_agent_action_log entries for growth_agent
 */

import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { db } from "../db";
import { sql, eq, and, desc, gte } from "drizzle-orm";
import { unifiedAgentActionLog } from "@shared/schema";
import { runApexForOrg } from "./apex-agent";

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
        .where(
          and(
            eq(unifiedAgentActionLog.orgId, orgId),
            eq(unifiedAgentActionLog.actorType, "growth_agent"),
            eq(unifiedAgentActionLog.actionType, "apex:run_complete"),
          )
        )
        .orderBy(desc(unifiedAgentActionLog.createdAt))
        .limit(1)
        .catch(() => []);

      const totalActions = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(unifiedAgentActionLog)
        .where(
          and(
            eq(unifiedAgentActionLog.orgId, orgId),
            eq(unifiedAgentActionLog.actorType, "growth_agent"),
          )
        )
        .catch(() => [{ count: 0 }]);

      const last30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const actions30d = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(unifiedAgentActionLog)
        .where(
          and(
            eq(unifiedAgentActionLog.orgId, orgId),
            eq(unifiedAgentActionLog.actorType, "growth_agent"),
            gte(unifiedAgentActionLog.createdAt, last30d),
          )
        )
        .catch(() => [{ count: 0 }]);

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
        lastRunError: run?.errorMessage ?? null,
        totalActions: Number(totalActions[0]?.count ?? 0),
        actionsLast30Days: Number(actions30d[0]?.count ?? 0),
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
        recommendationsGenerated: result.recommendationsGenerated,
        error: result.error ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Failed to run Apex agent" });
    }
  });

  // ── Recommendations: ranked signals from unified log ─────────────────────
  app.get("/api/agents/apex/recommendations", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const limitParam = Math.min(Number(req.query.limit ?? 50), 100);
      const since = req.query.since
        ? new Date(req.query.since as string)
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const rows = await db
        .select()
        .from(unifiedAgentActionLog)
        .where(
          and(
            eq(unifiedAgentActionLog.orgId, orgId),
            eq(unifiedAgentActionLog.actorType, "growth_agent"),
            eq(unifiedAgentActionLog.status, "requires_approval"),
            gte(unifiedAgentActionLog.createdAt, since),
          )
        )
        .orderBy(desc(unifiedAgentActionLog.createdAt))
        .limit(limitParam)
        .catch(() => []);

      const recs = rows
        .filter(r => r.actionType !== "apex:run_complete")
        .map(r => {
          const inp = r.inputSnapshot as Record<string, any> | null;
          const out = r.outputSnapshot as Record<string, any> | null;
          return {
            id: r.id,
            signalType: r.actionType.replace("apex:", ""),
            urgency: inp?.urgency ?? "low",
            entityType: r.entityType,
            entityId: r.entityId,
            entityName: inp?.entityName ?? r.entityId,
            estimatedValue: inp?.estimatedValue ?? 0,
            staleDays: inp?.staleDays ?? 0,
            recommendedAction: out?.recommendedAction ?? r.reasoningSummary,
            reasoningSummary: r.reasoningSummary,
            confidenceScore: r.confidenceScore,
            riskLevel: r.riskLevel,
            createdAt: r.createdAt,
            runId: r.workflowRunId,
          };
        });

      res.json({ recommendations: recs, total: recs.length, since });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch recommendations" });
    }
  });

  // ── Audit: proof that unified_agent_action_log is populated ──────────────
  app.get("/api/agents/apex/audit", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;

      const bySignalType = await db.execute(sql`
        SELECT
          action_type,
          COUNT(*)::int   AS count,
          MAX(created_at) AS last_seen
        FROM unified_agent_action_log
        WHERE org_id = ${orgId}
          AND actor_type = 'growth_agent'
        GROUP BY action_type
        ORDER BY count DESC
      `).catch(() => ({ rows: [] }));

      const totals = await db.execute(sql`
        SELECT
          COUNT(*)::int                                             AS total_actions,
          COUNT(*) FILTER (WHERE status = 'completed')::int        AS completed,
          COUNT(*) FILTER (WHERE status = 'requires_approval')::int AS pending_review,
          COUNT(*) FILTER (WHERE status = 'failed')::int           AS failed,
          MIN(created_at)                                           AS first_action_at,
          MAX(created_at)                                           AS last_action_at
        FROM unified_agent_action_log
        WHERE org_id = ${orgId}
          AND actor_type = 'growth_agent'
      `).catch(() => ({ rows: [{}] }));

      const last30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const totals30d = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM unified_agent_action_log
        WHERE org_id = ${orgId}
          AND actor_type = 'growth_agent'
          AND created_at >= ${last30d}
      `).catch(() => ({ rows: [{ count: 0 }] }));

      const rows = Array.isArray(bySignalType) ? bySignalType : (bySignalType as any).rows ?? [];
      const t = (Array.isArray(totals) ? totals[0] : (totals as any).rows?.[0]) ?? {};
      const c30 = (Array.isArray(totals30d) ? totals30d[0] : (totals30d as any).rows?.[0]) ?? {};

      res.json({
        table: "unified_agent_action_log",
        actorType: "growth_agent",
        agentName: "Apex",
        totals: {
          allTime: Number(t.total_actions ?? 0),
          last30Days: Number(c30.count ?? 0),
          completed: Number(t.completed ?? 0),
          pendingReview: Number(t.pending_review ?? 0),
          failed: Number(t.failed ?? 0),
          firstActionAt: t.first_action_at ?? null,
          lastActionAt: t.last_action_at ?? null,
        },
        bySignalType: rows.map((r: any) => ({
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

  // ── History: recent log entries ───────────────────────────────────────────
  app.get("/api/agents/apex/history", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const limitParam = Math.min(Number(req.query.limit ?? 100), 200);

      const rows = await db
        .select()
        .from(unifiedAgentActionLog)
        .where(
          and(
            eq(unifiedAgentActionLog.orgId, orgId),
            eq(unifiedAgentActionLog.actorType, "growth_agent"),
          )
        )
        .orderBy(desc(unifiedAgentActionLog.createdAt))
        .limit(limitParam)
        .catch(() => []);

      res.json({ entries: rows, total: rows.length });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch history" });
    }
  });
}
