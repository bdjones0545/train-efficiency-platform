/**
 * Pulse Agent Routes
 *
 * GET  /api/agents/pulse/status                         — last run summary per org
 * POST /api/agents/pulse/run                            — manual trigger (admin only)
 * GET  /api/agents/pulse/recommendations               — recs from pulse_recommendations
 * POST /api/agents/pulse/recommendations/:id/approve   — mark approved
 * POST /api/agents/pulse/recommendations/:id/dismiss   — mark dismissed (with optional reason)
 * POST /api/agents/pulse/recommendations/:id/complete  — mark completed
 * GET  /api/agents/pulse/audit                         — live proof of action counts
 * GET  /api/agents/pulse/history                       — recent unified_agent_action_log entries
 * GET  /api/agents/pulse/summary/weekly                — 7-day summary
 */

import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { db } from "../db";
import { sql, eq, and, desc, gte } from "drizzle-orm";
import { unifiedAgentActionLog } from "@shared/schema";
import { runPulseForOrg, ensurePulseRecommendationsTable } from "./pulse-agent";

function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "ADMIN")
    return res.status(403).json({ message: "Admin access required" });
  next();
}

function requireCoachOrAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "COACH") {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
}

export function registerPulseAgentRoutes(app: Express): void {

  // ── Status ────────────────────────────────────────────────────────────────
  app.get("/api/agents/pulse/status", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;

      const lastRun = await db
        .select()
        .from(unifiedAgentActionLog)
        .where(
          and(
            eq(unifiedAgentActionLog.orgId, orgId),
            eq(unifiedAgentActionLog.actorType, "retention_agent"),
            eq(unifiedAgentActionLog.actionType, "pulse:run_complete")
          )
        )
        .orderBy(desc(unifiedAgentActionLog.createdAt))
        .limit(1)
        .catch(() => []);

      const [totalRow] = await db
        .execute(
          sql`SELECT COUNT(*)::int AS total FROM unified_agent_action_log
          WHERE org_id = ${orgId} AND actor_type = 'retention_agent'`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => [{ total: 0 }]);

      const last30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [row30d] = await db
        .execute(
          sql`SELECT COUNT(*)::int AS total FROM unified_agent_action_log
          WHERE org_id = ${orgId} AND actor_type = 'retention_agent' AND created_at >= ${last30d}`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => [{ total: 0 }]);

      await ensurePulseRecommendationsTable();
      const [pendingRow] = await db
        .execute(
          sql`SELECT COUNT(*)::int AS pending FROM pulse_recommendations
          WHERE org_id = ${orgId} AND status = 'pending_review'`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => [{ pending: 0 }]);

      const run = lastRun[0];
      const out = run?.outputSnapshot as Record<string, any> | null;

      res.json({
        agentType: "retention_agent",
        agentName: "Pulse",
        status: run
          ? run.status === "failed"
            ? "error"
            : "idle"
          : "never_run",
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
    } catch {
      res.status(500).json({ message: "Failed to fetch Pulse status" });
    }
  });

  // ── Manual trigger ────────────────────────────────────────────────────────
  app.post("/api/agents/pulse/run", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const result = await runPulseForOrg(orgId, "manual");
      res.json({
        success: !result.error,
        runId: result.runId,
        durationMs: result.durationMs,
        clientsEvaluated: result.clientsEvaluated,
        subscriptionsEvaluated: result.subscriptionsEvaluated,
        signalsDetected: result.signalsDetected,
        newRecommendations: result.newRecommendations,
        skippedDuplicates: result.skippedDuplicates,
        expired: result.expired,
        error: result.error ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Failed to run Pulse agent" });
    }
  });

  // ── Recommendations ───────────────────────────────────────────────────────
  app.get("/api/agents/pulse/recommendations", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      await ensurePulseRecommendationsTable();

      const statusFilter = (req.query.status as string) || "pending_review";
      const limitParam = Math.min(Number(req.query.limit ?? 50), 200);

      const whereClause =
        statusFilter === "all"
          ? sql`WHERE org_id = ${orgId}`
          : sql`WHERE org_id = ${orgId} AND status = ${statusFilter}`;

      const rows = await db
        .execute(
          sql`SELECT * FROM pulse_recommendations ${whereClause}
          ORDER BY created_at DESC LIMIT ${limitParam}`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => []);

      const mapped = rows.map((r: any) => ({
        id: r.id,
        orgId: r.org_id,
        signalType: r.signal_type,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityName: r.entity_name,
        urgency: r.urgency,
        estimatedValueCents: r.estimated_value_cents,
        reasonText: r.reason_text,
        recommendedAction: r.recommended_action,
        confidenceScore: r.confidence_score,
        staleDays: r.stale_days,
        sourceUrl: r.source_url,
        status: r.status,
        statusUpdatedAt: r.status_updated_at,
        statusUpdatedBy: r.status_updated_by,
        dismissReason: r.dismiss_reason,
        runId: r.run_id,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      }));

      res.json({ recommendations: mapped, total: mapped.length, statusFilter });
    } catch {
      res.status(500).json({ message: "Failed to fetch recommendations" });
    }
  });

  // ── Approve ───────────────────────────────────────────────────────────────
  app.post("/api/agents/pulse/recommendations/:id/approve", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const { id } = req.params;
      const now = new Date();

      const result = await db
        .execute(
          sql`UPDATE pulse_recommendations
          SET status = 'approved', status_updated_at = ${now}, status_updated_by = ${req.user.id ?? "admin"}
          WHERE id = ${id} AND org_id = ${orgId}
          RETURNING *`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => []);

      if (!result[0]) return res.status(404).json({ message: "Recommendation not found" });
      res.json({ success: true, recommendation: result[0] });
    } catch {
      res.status(500).json({ message: "Failed to approve recommendation" });
    }
  });

  // ── Dismiss ───────────────────────────────────────────────────────────────
  app.post("/api/agents/pulse/recommendations/:id/dismiss", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const { id } = req.params;
      const { reason } = req.body as { reason?: string };
      const now = new Date();

      const result = await db
        .execute(
          sql`UPDATE pulse_recommendations
          SET status = 'dismissed', status_updated_at = ${now},
              status_updated_by = ${req.user.id ?? "admin"},
              dismiss_reason = ${reason ?? null}
          WHERE id = ${id} AND org_id = ${orgId}
          RETURNING *`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => []);

      if (!result[0]) return res.status(404).json({ message: "Recommendation not found" });
      res.json({ success: true, recommendation: result[0] });
    } catch {
      res.status(500).json({ message: "Failed to dismiss recommendation" });
    }
  });

  // ── Mark Complete ─────────────────────────────────────────────────────────
  app.post("/api/agents/pulse/recommendations/:id/complete", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const { id } = req.params;
      const now = new Date();

      const result = await db
        .execute(
          sql`UPDATE pulse_recommendations
          SET status = 'completed', status_updated_at = ${now}, status_updated_by = ${req.user.id ?? "admin"}
          WHERE id = ${id} AND org_id = ${orgId}
          RETURNING *`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => []);

      if (!result[0]) return res.status(404).json({ message: "Recommendation not found" });
      res.json({ success: true, recommendation: result[0] });
    } catch {
      res.status(500).json({ message: "Failed to mark complete" });
    }
  });

  // ── Audit ─────────────────────────────────────────────────────────────────
  app.get("/api/agents/pulse/audit", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      await ensurePulseRecommendationsTable();

      const bySignalType = await db
        .execute(
          sql`SELECT action_type, COUNT(*)::int AS count, MAX(created_at) AS last_seen
          FROM unified_agent_action_log
          WHERE org_id = ${orgId} AND actor_type = 'retention_agent'
          GROUP BY action_type ORDER BY count DESC`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => []);

      const [totals] = await db
        .execute(
          sql`SELECT
            COUNT(*)::int AS total_actions,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE status = 'requires_approval')::int AS pending_review,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            MIN(created_at) AS first_action_at,
            MAX(created_at) AS last_action_at
          FROM unified_agent_action_log
          WHERE org_id = ${orgId} AND actor_type = 'retention_agent'`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? [{}]))
        .catch(() => [{}]);

      const last30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [c30] = await db
        .execute(
          sql`SELECT COUNT(*)::int AS count FROM unified_agent_action_log
          WHERE org_id = ${orgId} AND actor_type = 'retention_agent' AND created_at >= ${last30d}`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? [{}]))
        .catch(() => [{}]);

      const [recTotals] = await db
        .execute(
          sql`SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'pending_review')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE status = 'dismissed')::int AS dismissed,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE status = 'expired')::int AS expired
          FROM pulse_recommendations
          WHERE org_id = ${orgId}`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? [{}]))
        .catch(() => [{}]);

      const [signalBreakdown] = await db
        .execute(
          sql`SELECT
            COUNT(*) FILTER (WHERE signal_type = 'inactive_client')::int AS inactive_client,
            COUNT(*) FILTER (WHERE signal_type = 'high_churn_risk')::int AS high_churn_risk,
            COUNT(*) FILTER (WHERE signal_type = 'expiring_subscription')::int AS expiring_subscription,
            COUNT(*) FILTER (WHERE signal_type = 'cancelled_subscription')::int AS cancelled_subscription,
            COUNT(*) FILTER (WHERE signal_type = 'no_show_pattern')::int AS no_show_pattern,
            COUNT(*) FILTER (WHERE signal_type = 'declining_frequency')::int AS declining_frequency,
            COUNT(*) FILTER (WHERE signal_type = 'lapsed_client')::int AS lapsed_client,
            COUNT(*) FILTER (WHERE signal_type = 'low_session_remaining')::int AS low_session_remaining
          FROM pulse_recommendations WHERE org_id = ${orgId}`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? [{}]))
        .catch(() => [{}]);

      const t = totals ?? {};
      res.json({
        table: "unified_agent_action_log",
        actorType: "retention_agent",
        agentName: "Pulse",
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
        signalBreakdown: signalBreakdown ?? {},
        byActionType: bySignalType.map((r: any) => ({
          actionType: String(r.action_type),
          count: Number(r.count),
          lastSeen: r.last_seen,
        })),
        auditNote:
          "All counts are live reads from unified_agent_action_log WHERE actor_type = 'retention_agent'",
      });
    } catch {
      res.status(500).json({ message: "Failed to fetch audit data" });
    }
  });

  // ── History ───────────────────────────────────────────────────────────────
  app.get("/api/agents/pulse/history", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      const limitParam = Math.min(Number(req.query.limit ?? 100), 200);

      const rows = await db
        .select()
        .from(unifiedAgentActionLog)
        .where(
          and(
            eq(unifiedAgentActionLog.orgId, orgId),
            eq(unifiedAgentActionLog.actorType, "retention_agent")
          )
        )
        .orderBy(desc(unifiedAgentActionLog.createdAt))
        .limit(limitParam)
        .catch(() => []);

      res.json({ entries: rows, total: rows.length });
    } catch {
      res.status(500).json({ message: "Failed to fetch history" });
    }
  });

  // ── Weekly Summary ────────────────────────────────────────────────────────
  app.get("/api/agents/pulse/summary/weekly", isAuthenticated, requireCoachOrAdmin, async (req: any, res) => {
    try {
      const orgId = req.user.orgId as string;
      await ensurePulseRecommendationsTable();

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const newSignals = await db
        .execute(
          sql`SELECT * FROM pulse_recommendations
          WHERE org_id = ${orgId} AND created_at >= ${sevenDaysAgo}
          ORDER BY created_at DESC LIMIT 50`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => []);

      const closedSignals = await db
        .execute(
          sql`SELECT * FROM pulse_recommendations
          WHERE org_id = ${orgId} AND status_updated_at >= ${sevenDaysAgo}
            AND status IN ('approved', 'completed')
          ORDER BY status_updated_at DESC LIMIT 20`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => []);

      const ignoredSignals = await db
        .execute(
          sql`SELECT * FROM pulse_recommendations
          WHERE org_id = ${orgId} AND status_updated_at >= ${sevenDaysAgo}
            AND status IN ('dismissed', 'expired')
          ORDER BY status_updated_at DESC LIMIT 20`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => []);

      const allPendingRaw = await db
        .execute(
          sql`SELECT * FROM pulse_recommendations
          WHERE org_id = ${orgId} AND status = 'pending_review'
          ORDER BY created_at DESC`
        )
        .then((r) => (Array.isArray(r) ? r : (r as any).rows ?? []))
        .catch(() => []);

      const mapRec = (r: any) => ({
        id: r.id,
        orgId: r.org_id,
        signalType: r.signal_type,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityName: r.entity_name,
        urgency: r.urgency,
        estimatedValueCents: r.estimated_value_cents,
        reasonText: r.reason_text,
        recommendedAction: r.recommended_action,
        confidenceScore: r.confidence_score,
        staleDays: r.stale_days,
        sourceUrl: r.source_url,
        status: r.status,
        statusUpdatedAt: r.status_updated_at,
        statusUpdatedBy: r.status_updated_by,
        dismissReason: r.dismiss_reason,
        runId: r.run_id,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      });

      const urgencyBreakdown = allPendingRaw.reduce(
        (acc: Record<string, number>, r: any) => {
          acc[r.urgency] = (acc[r.urgency] ?? 0) + 1;
          return acc;
        },
        {}
      );

      const signalTypeBreakdown = allPendingRaw.reduce(
        (acc: Record<string, number>, r: any) => {
          acc[r.signal_type] = (acc[r.signal_type] ?? 0) + 1;
          return acc;
        },
        {}
      );

      res.json({
        period: { from: sevenDaysAgo, to: new Date() },
        summary: {
          newSignals: newSignals.length,
          closedSignals: closedSignals.length,
          ignoredSignals: ignoredSignals.length,
          pendingCount: allPendingRaw.length,
          urgencyBreakdown,
          signalTypeBreakdown,
        },
        newSignals: newSignals.slice(0, 10).map(mapRec),
        closedSignals: closedSignals.slice(0, 10).map(mapRec),
        ignoredSignals: ignoredSignals.slice(0, 10).map(mapRec),
        topRisks: allPendingRaw
          .filter((r: any) => r.urgency === "critical" || r.urgency === "high")
          .slice(0, 5)
          .map(mapRec),
      });
    } catch {
      res.status(500).json({ message: "Failed to fetch weekly summary" });
    }
  });
}
