import { Express } from "express";
import { db } from "./db";
import { eq, and, desc, gte, lt, like, or, sql } from "drizzle-orm";
import {
  ceoHeartbeatRuns,
  agentOperatingTimeline,
  adminActionAuditLog,
  jobExecutionLocks,
  organizations,
  agentMessageFeedback,
  agentMessageLearningRules,
  userProfiles,
  coachProfiles,
} from "@shared/schema";
import {
  runHeartbeatCycle,
  pauseCeoHeartbeat,
  resumeCeoHeartbeat,
  getHeartbeatStatus,
  getExecutionHealth,
  writeTimeline,
} from "./services/ceo-heartbeat-service";
import { resolveOrgSession } from "./org-auth";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function getOrgId(req: any): Promise<string | null> {
  // 1. Explicit query param (takes priority — allows org-switching in debug)
  if (req.query.orgId) return req.query.orgId as string;
  // 2. Full 3-path resolver: X-Org-Auth-Token → OIDC req.user → Bearer token
  try {
    const orgSession = await resolveOrgSession(req);
    if (orgSession?.orgId) return orgSession.orgId;
  } catch {
    // fall through
  }
  return null;
}

function getAdminId(req: any): string {
  return req.user?.id ?? req.user?.userId ?? "unknown";
}

function getAdminEmail(req: any): string {
  return req.user?.email ?? "";
}

// ─── Audit log writer ─────────────────────────────────────────────────────────

async function logAdminAction(opts: {
  req: any;
  orgId: string;
  actionType: string;
  targetTable?: string;
  targetId?: string;
  beforeState?: any;
  afterState?: any;
  notes?: string;
}): Promise<void> {
  try {
    await db.insert(adminActionAuditLog).values({
      orgId: opts.orgId,
      adminUserId: getAdminId(opts.req),
      adminEmail: getAdminEmail(opts.req),
      actionType: opts.actionType,
      targetTable: opts.targetTable ?? null,
      targetId: opts.targetId ?? null,
      beforeState: opts.beforeState ?? null,
      afterState: opts.afterState ?? null,
      ipAddress: opts.req.ip ?? opts.req.connection?.remoteAddress ?? null,
      userAgent: opts.req.headers?.["user-agent"] ?? null,
      notes: opts.notes ?? null,
    });
  } catch {}
}

export async function registerCeoHeartbeatRoutes(app: Express): Promise<void> {

  // ─── GET /api/admin/ceo-heartbeat/status ───────────────────────────────────
  // Returns current heartbeat state, last run info, and next scheduled run.
  app.get("/api/admin/ceo-heartbeat/status", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const status = getHeartbeatStatus();

      const [lastRun] = await db.select()
        .from(ceoHeartbeatRuns)
        .where(eq(ceoHeartbeatRuns.orgId, orgId))
        .orderBy(desc(ceoHeartbeatRuns.startedAt))
        .limit(1)
        .catch(() => []);

      const recentRuns = await db.select()
        .from(ceoHeartbeatRuns)
        .where(eq(ceoHeartbeatRuns.orgId, orgId))
        .orderBy(desc(ceoHeartbeatRuns.startedAt))
        .limit(10)
        .catch(() => []);

      res.json({
        ...status,
        lastRun: lastRun ?? null,
        recentRuns,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/admin/ceo-heartbeat/run ─────────────────────────────────────
  // Manually trigger a heartbeat cycle for this org.
  app.post("/api/admin/ceo-heartbeat/run", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      await logAdminAction({
        req, orgId,
        actionType: "heartbeat_trigger",
        notes: "Manual heartbeat trigger from admin UI",
      });

      console.log(`[CEO Heartbeat] Manual run starting — orgId=${orgId}`);
      const result = await runHeartbeatCycle({ orgId, triggeredBy: "manual" });
      console.log(`[CEO Heartbeat] Manual run complete — runId=${result.runId} success=${result.success} errors=${result.errors.length}`);

      // Fetch the completed run record so the frontend can render Last Heartbeat
      // immediately without waiting for a separate status refetch.
      let completedRun: any = null;
      if (result.runId) {
        const [row] = await db.select()
          .from(ceoHeartbeatRuns)
          .where(eq(ceoHeartbeatRuns.id, result.runId))
          .limit(1)
          .catch(() => []);
        completedRun = row ?? null;
      }
      console.log(`[CEO Heartbeat] Run record fetched — status=${completedRun?.status} agents=${completedRun?.agentsCoordinated}`);

      res.json({ ...result, run: completedRun });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/admin/ceo-heartbeat/timeline ─────────────────────────────────
  // Unified operating timeline with rich filters.
  app.get("/api/admin/ceo-heartbeat/timeline", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const {
        agent,
        domain,
        actionType,
        actionStatus,
        outcomeStatus,
        approvalStatus,
        heartbeatId,
        since,
        limit: limitParam,
        offset: offsetParam,
      } = req.query as Record<string, string>;

      const limitVal = Math.min(parseInt(limitParam ?? "100"), 500);
      const offsetVal = parseInt(offsetParam ?? "0");
      const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 3600 * 1000);

      const conditions: any[] = [
        eq(agentOperatingTimeline.orgId, orgId),
        gte(agentOperatingTimeline.createdAt, sinceDate),
      ];
      if (agent) conditions.push(eq(agentOperatingTimeline.agentName, agent));
      if (domain) conditions.push(eq(agentOperatingTimeline.communicationDomain, domain));
      if (actionType) conditions.push(eq(agentOperatingTimeline.actionType, actionType));
      if (actionStatus) conditions.push(eq(agentOperatingTimeline.actionStatus, actionStatus));
      if (outcomeStatus) conditions.push(eq(agentOperatingTimeline.outcomeStatus, outcomeStatus));
      if (approvalStatus) conditions.push(eq(agentOperatingTimeline.approvalStatus, approvalStatus));
      if (heartbeatId) conditions.push(eq(agentOperatingTimeline.heartbeatId, heartbeatId));

      const [rows, countResult] = await Promise.all([
        db.select()
          .from(agentOperatingTimeline)
          .where(and(...conditions))
          .orderBy(desc(agentOperatingTimeline.createdAt))
          .limit(limitVal)
          .offset(offsetVal)
          .catch(() => []),
        db.select({ count: sql<number>`count(*)` })
          .from(agentOperatingTimeline)
          .where(and(...conditions))
          .catch(() => [{ count: 0 }]),
      ]);

      res.json({
        entries: rows,
        total: Number(countResult[0]?.count ?? 0),
        limit: limitVal,
        offset: offsetVal,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/admin/ceo-heartbeat/priorities ───────────────────────────────
  // Returns the latest CEO priority ranking for this org.
  app.get("/api/admin/ceo-heartbeat/priorities", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      // Get priorities from the last heartbeat timeline entries
      const priorities = await db.select()
        .from(agentOperatingTimeline)
        .where(and(
          eq(agentOperatingTimeline.orgId, orgId),
          eq(agentOperatingTimeline.actionType, "recommendation"),
          gte(agentOperatingTimeline.createdAt, new Date(Date.now() - 6 * 3600 * 1000)),
        ))
        .orderBy(desc(agentOperatingTimeline.priority))
        .limit(20)
        .catch(() => []);

      res.json({ priorities });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/admin/ceo-heartbeat/health ───────────────────────────────────
  // Returns execution health stats for the last 24 hours.
  app.get("/api/admin/ceo-heartbeat/health", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const health = await getExecutionHealth(orgId);
      res.json(health);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/admin/ceo-heartbeat/pause ───────────────────────────────────
  app.post("/api/admin/ceo-heartbeat/pause", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      pauseCeoHeartbeat();

      await logAdminAction({
        req, orgId,
        actionType: "emergency_pause",
        notes: "CEO Heartbeat paused by admin",
        afterState: { paused: true },
      });

      await writeTimeline({
        orgId, agentName: "ceo_heartbeat", systemName: "CEO Heartbeat",
        actionType: "heartbeat_cycle", actionStatus: "completed",
        summary: "CEO Heartbeat paused by admin",
        metadata: { adminId: getAdminId(req) },
      });

      res.json({ paused: true, message: "CEO Heartbeat paused. Existing cron jobs will skip execution." });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/admin/ceo-heartbeat/resume ──────────────────────────────────
  app.post("/api/admin/ceo-heartbeat/resume", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      resumeCeoHeartbeat();

      await logAdminAction({
        req, orgId,
        actionType: "settings_change",
        notes: "CEO Heartbeat resumed by admin",
        afterState: { paused: false },
      });

      await writeTimeline({
        orgId, agentName: "ceo_heartbeat", systemName: "CEO Heartbeat",
        actionType: "heartbeat_cycle", actionStatus: "completed",
        summary: "CEO Heartbeat resumed by admin",
      });

      res.json({ paused: false, message: "CEO Heartbeat resumed." });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/admin/ceo-heartbeat/retry-failed ────────────────────────────
  // Retries all failed timeline entries from the last 6 hours.
  app.post("/api/admin/ceo-heartbeat/retry-failed", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const failed = await db.select()
        .from(agentOperatingTimeline)
        .where(and(
          eq(agentOperatingTimeline.orgId, orgId),
          eq(agentOperatingTimeline.actionStatus, "failed"),
          gte(agentOperatingTimeline.createdAt, new Date(Date.now() - 6 * 3600 * 1000)),
        ))
        .limit(50)
        .catch(() => []);

      // Mark them as retried
      await db.update(agentOperatingTimeline)
        .set({ actionStatus: "pending", errorMessage: null })
        .where(and(
          eq(agentOperatingTimeline.orgId, orgId),
          eq(agentOperatingTimeline.actionStatus, "failed"),
          gte(agentOperatingTimeline.createdAt, new Date(Date.now() - 6 * 3600 * 1000)),
        ))
        .catch(() => {});

      await logAdminAction({
        req, orgId,
        actionType: "settings_change",
        notes: `Retried ${failed.length} failed jobs`,
      });

      res.json({ retried: failed.length, message: `${failed.length} failed jobs queued for retry` });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/admin/ceo-heartbeat/recalculate-priorities ─────────────────
  app.post("/api/admin/ceo-heartbeat/recalculate-priorities", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const result = await runHeartbeatCycle({ orgId, triggeredBy: "manual_priority_recalc" });

      await logAdminAction({
        req, orgId,
        actionType: "heartbeat_trigger",
        notes: "Manual priority recalculation",
      });

      res.json({ priorities: result.priorities, runId: result.runId });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/admin/ceo-heartbeat/audit-log ────────────────────────────────
  // Admin action audit log with filters.
  app.get("/api/admin/ceo-heartbeat/audit-log", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { actionType, adminUserId, since, limit: lp, offset: op } = req.query as Record<string, string>;
      const limitVal = Math.min(parseInt(lp ?? "50"), 200);
      const offsetVal = parseInt(op ?? "0");
      const sinceDate = since ? new Date(since) : new Date(Date.now() - 7 * 24 * 3600 * 1000);

      const conditions: any[] = [
        eq(adminActionAuditLog.orgId, orgId),
        gte(adminActionAuditLog.createdAt, sinceDate),
      ];
      if (actionType) conditions.push(eq(adminActionAuditLog.actionType, actionType));
      if (adminUserId) conditions.push(eq(adminActionAuditLog.adminUserId, adminUserId));

      const rows = await db.select()
        .from(adminActionAuditLog)
        .where(and(...conditions))
        .orderBy(desc(adminActionAuditLog.createdAt))
        .limit(limitVal)
        .offset(offsetVal)
        .catch(() => []);

      res.json({ entries: rows, limit: limitVal, offset: offsetVal });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/admin/ceo-heartbeat/locks ────────────────────────────────────
  app.get("/api/admin/ceo-heartbeat/locks", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const locks = await db.select()
        .from(jobExecutionLocks)
        .where(eq(jobExecutionLocks.orgId, orgId))
        .orderBy(desc(jobExecutionLocks.acquiredAt))
        .limit(50)
        .catch(() => []);

      res.json({ locks });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/admin/ceo-heartbeat/runs ─────────────────────────────────────
  app.get("/api/admin/ceo-heartbeat/runs", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { limit: lp } = req.query as Record<string, string>;
      const limitVal = Math.min(parseInt(lp ?? "20"), 100);

      const runs = await db.select()
        .from(ceoHeartbeatRuns)
        .where(eq(ceoHeartbeatRuns.orgId, orgId))
        .orderBy(desc(ceoHeartbeatRuns.startedAt))
        .limit(limitVal)
        .catch(() => []);

      res.json({ runs });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
  // ─── GET /api/admin/ceo-heartbeat/session-context ─────────────────────────
  // Returns the orgId for the currently authenticated admin/coach session.
  // Used by the frontend to bootstrap queries without requiring window.__orgId.
  app.get("/api/admin/ceo-heartbeat/session-context", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(200).json({ orgId: null });

      const [org] = await db.select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1)
        .catch(() => []);

      res.json({ orgId, orgName: org?.name ?? null });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/admin/ceo-heartbeat/learning-health ─────────────────────────
  // Returns learning system health: rules count, domain coverage, feedback stats.
  app.get("/api/admin/ceo-heartbeat/learning-health", async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const ALL_DOMAINS = [
        "athlete_lead", "parent_lead", "team_training", "school_partnership",
        "athletic_director", "coach_outreach", "organization_outreach",
        "business_outreach", "employment_opportunity", "corporate_wellness",
        "facility_partnership", "gym_owner",
      ];

      // Total active rules
      const totalRulesResult = await db.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM agent_message_learning_rules
        WHERE org_id = ${orgId} AND status = 'active'
      `).catch(() => []);
      const totalRules = Array.isArray(totalRulesResult)
        ? (totalRulesResult[0]?.total ?? 0)
        : ((totalRulesResult as any).rows?.[0]?.total ?? 0);

      // Rules by domain
      const rulesByDomainResult = await db.execute(sql`
        SELECT communication_domain, COUNT(*)::int AS count
        FROM agent_message_learning_rules
        WHERE org_id = ${orgId} AND status = 'active'
        GROUP BY communication_domain
      `).catch(() => []);
      const rulesByDomainRows: any[] = Array.isArray(rulesByDomainResult)
        ? rulesByDomainResult
        : ((rulesByDomainResult as any).rows ?? []);
      const rulesByDomain: Record<string, number> = {};
      for (const r of rulesByDomainRows) rulesByDomain[r.communication_domain] = r.count;
      const domainsWithRules = Object.keys(rulesByDomain);
      const domainsWithZeroRules = ALL_DOMAINS.filter((d) => !domainsWithRules.includes(d));

      // Feedback stats — last 7 days
      const feedbackResult = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE decision IN ('approved', 'edited_and_approved'))::int AS approved_count,
          COUNT(*) FILTER (WHERE decision = 'rejected')::int AS rejected_count,
          COUNT(*) FILTER (WHERE applied_to_future_runs = true)::int AS converted_to_rules
        FROM agent_message_feedback
        WHERE org_id = ${orgId}
          AND created_at > NOW() - INTERVAL '7 days'
      `).catch(() => []);
      const fbRow: any = Array.isArray(feedbackResult)
        ? feedbackResult[0]
        : ((feedbackResult as any).rows?.[0] ?? {});

      // Failed extractions: had rejection reason but not converted (older than 1 hour, last 7 days)
      const failedResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM agent_message_feedback
        WHERE org_id = ${orgId}
          AND rejection_reason IS NOT NULL
          AND applied_to_future_runs = false
          AND created_at > NOW() - INTERVAL '7 days'
          AND created_at < NOW() - INTERVAL '1 hour'
      `).catch(() => []);
      const failedExtractions = Array.isArray(failedResult)
        ? (failedResult[0]?.count ?? 0)
        : ((failedResult as any).rows?.[0]?.count ?? 0);

      // Latest learned rule
      const latestRuleResult = await db.execute(sql`
        SELECT rule_text, rule_type, communication_domain, created_at
        FROM agent_message_learning_rules
        WHERE org_id = ${orgId} AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
      `).catch(() => []);
      const latestRule: any = Array.isArray(latestRuleResult)
        ? latestRuleResult[0]
        : ((latestRuleResult as any).rows?.[0] ?? null);

      const approvedCount = Number(fbRow?.approved_count ?? 0);
      const rejectedCount = Number(fbRow?.rejected_count ?? 0);
      const totalFeedback = Number(fbRow?.total ?? 0);
      const convertedToRules = Number(fbRow?.converted_to_rules ?? 0);
      const approvalRatio = totalFeedback > 0
        ? Math.round((approvedCount / totalFeedback) * 100)
        : null;

      res.json({
        totalRules: Number(totalRules),
        rulesByDomain,
        domainsWithRules: domainsWithRules.length,
        totalDomains: ALL_DOMAINS.length,
        domainsWithZeroRules,
        feedback7d: {
          total: totalFeedback,
          approved: approvedCount,
          rejected: rejectedCount,
          convertedToRules,
          conversionRate: totalFeedback > 0 ? Math.round((convertedToRules / totalFeedback) * 100) : null,
          approvalRatio,
        },
        failedExtractions: Number(failedExtractions),
        latestRule: latestRule ?? null,
        healthScore: (() => {
          let score = 100;
          if (Number(totalRules) === 0) score -= 40;
          else if (Number(totalRules) < 5) score -= 20;
          if (domainsWithZeroRules.length > 8) score -= 20;
          else if (domainsWithZeroRules.length > 4) score -= 10;
          if (Number(failedExtractions) > 3) score -= 15;
          else if (Number(failedExtractions) > 0) score -= 5;
          if (totalFeedback === 0) score -= 10;
          return Math.max(score, 0);
        })(),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}

// ─── Exported audit log writer for use in other routes ────────────────────────
export { logAdminAction };
