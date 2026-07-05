/**
 * Execution Routes — Sprint 3
 *
 * Phase 1: Unified approval actions (approve/reject/escalate any action type)
 * Phase 3: Workflow builder execution wiring (Hermes → orchestrator)
 * Phase 6: Execution observability endpoints
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { resolveOrgIdOrThrow } from "./lib/resolve-org-id";
import {
  executeAction,
  listExecutionEvents,
  getExecutionEvent,
  getExecutionMetrics,
  ensureExecutionTables,
  type ActionPayload,
} from "./services/unified-execution-engine";
import {
  getCoordinationStats,
  ensureCoordinationTables,
} from "./services/cross-agent-coordination-service";
import {
  getOpenConflicts,
  getConflictStats,
  resolveConflict,
  ensureConflictTables,
} from "./services/action-resolution-engine";
import {
  ensureHermesTables,
  getHermesStats,
} from "./services/hermes-recommendation-engine";

async function getOrgId(req: any): Promise<string> {
  // Trusted server-side org resolution — never req.user.orgId (never populated) or client input.
  return await resolveOrgIdOrThrow(req);
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!(req as any).user) {
    res.status(401).json({ message: "Not authenticated" });
    return false;
  }
  return true;
}

// ─── Map hermes recommendation type → execution action type ───────────────────
function hermesTypeToActionType(hermesType: string): string {
  const map: Record<string, string> = {
    follow_up:          "follow_up",
    prospect_outreach:  "prospect_outreach",
    lead_recovery:      "lead_recovery",
    policy_review:      "escalation",
    approval_needed:    "internal_task",
    engineering_review: "escalation",
  };
  return map[hermesType] ?? "internal_task";
}

// ─── Map autonomous_queue decision_type → execution action type ───────────────
function autoQueueTypeToActionType(decisionType: string): string {
  const map: Record<string, string> = {
    follow_up_lead:        "follow_up",
    prospect_outreach:     "prospect_outreach",
    revenue_recovery:      "lead_recovery",
    coach_outreach:        "prospect_outreach",
    schedule_optimization: "schedule_call",
    session_reminder:      "follow_up",
    retention_check_in:    "follow_up",
    hiring_follow_up:      "follow_up",
    book_consultation:     "schedule_call",
    pricing_strategy:      "internal_task",
    contract_modification: "escalation",
  };
  return map[decisionType] ?? "internal_task";
}

// ─── Approve a Hermes recommendation + execute ────────────────────────────────
async function approveHermesRec(orgId: string, actionId: string, userId: string, extra: any) {
  await ensureHermesTables();
  // Fetch recommendation details
  const rows = await db.execute(sql`
    SELECT * FROM hermes_recommendations WHERE id = ${actionId} AND org_id = ${orgId}
  `).catch(() => ({ rows: [] }));
  const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  const rec = data[0];

  // Record feedback
  await db.execute(sql`
    INSERT INTO hermes_recommendation_feedback
      (recommendation_id, outcome, editor_id, original_confidence, edit_notes, approved_as_type)
    VALUES
      (${actionId}, 'approved', ${userId},
       ${rec?.confidence ?? null}, ${extra?.notes ?? null},
       ${hermesTypeToActionType(rec?.type ?? "")})
    ON CONFLICT DO NOTHING
  `).catch(() => {});

  // Mark recommendation as approved
  await db.execute(sql`
    UPDATE hermes_recommendations SET status = 'approved' WHERE id = ${actionId}
  `).catch(() => {});

  // Execute via unified engine
  const payload: ActionPayload = {
    orgId,
    sourceSystem: "hermes",
    actionType:   hermesTypeToActionType(rec?.type ?? "internal_task"),
    title:        rec?.title,
    description:  rec?.reason,
    gmailThreadId:        rec?.gmail_thread_id,
    sourceConversationId: rec?.source_conversation_id,
    prospectId:   rec?.metadata?.prospectId,
    recipientEmail: rec?.metadata?.recipientEmail,
    draftSubject:   rec?.metadata?.subject,
    draftBody:      rec?.metadata?.body ?? rec?.reason,
    templateKey:    extra?.templateKey,
    metadata:       rec?.metadata ?? {},
  };
  return executeAction(actionId, payload);
}

// ─── Approve an autonomous_queue item + execute ───────────────────────────────
async function approveAutoQueue(orgId: string, actionId: string, userId: string) {
  // Update status in autonomous_action_queue
  await db.execute(sql`
    UPDATE autonomous_action_queue
    SET status = 'approved', approved_by = ${userId}
    WHERE id = ${actionId} AND org_id = ${orgId}
  `).catch(() => {});

  const rows = await db.execute(sql`
    SELECT * FROM autonomous_action_queue WHERE id = ${actionId}
  `).catch(() => ({ rows: [] }));
  const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  const item = data[0];

  const payload: ActionPayload = {
    orgId,
    sourceSystem:  "autonomous_queue",
    actionType:    autoQueueTypeToActionType(item?.decision_type ?? ""),
    title:         item?.action ?? item?.description,
    description:   item?.description,
    gmailThreadId: item?.gmail_thread_id,
    sourceConversationId: item?.source_conversation_id,
    metadata:      {},
  };
  return executeAction(actionId, payload);
}

// ─── Approve agentmail reply ──────────────────────────────────────────────────
async function approveAgentMail(orgId: string, actionId: string, userId: string) {
  await db.execute(sql`
    UPDATE agent_mail_reply_queue
    SET approval_status = 'approved', status = 'approved'
    WHERE id = ${actionId} AND organization_id = ${orgId}
  `).catch(() => {});
  return {
    success: true,
    executionId: `agentmail-${actionId}`,
    executionType: "follow_up",
    output: { status: "approved", message: "AgentMail reply approved for send" },
    errors: [],
  };
}

// ─── Approve gmail agent action ───────────────────────────────────────────────
async function approveGmailAction(orgId: string, actionId: string, userId: string) {
  await db.execute(sql`
    UPDATE gmail_agent_actions
    SET status = 'approved', approved_by = ${userId}
    WHERE id = ${actionId} AND org_id = ${orgId}
  `).catch(() => {});
  return {
    success: true,
    executionId: `gmail-${actionId}`,
    executionType: "follow_up",
    output: { status: "approved", message: "Gmail action approved" },
    errors: [],
  };
}

// ─── Reject helpers ───────────────────────────────────────────────────────────
async function rejectAction(orgId: string, actionId: string, sourceSystem: string, reason: string, userId: string) {
  switch (sourceSystem) {
    case "hermes":
      await db.execute(sql`
        INSERT INTO hermes_recommendation_feedback
          (recommendation_id, outcome, editor_id, original_confidence, edit_notes)
        VALUES (${actionId}, 'rejected', ${userId}, null, ${reason})
        ON CONFLICT DO NOTHING
      `).catch(() => {});
      await db.execute(sql`
        UPDATE hermes_recommendations SET status = 'rejected' WHERE id = ${actionId}
      `).catch(() => {});
      break;
    case "autonomous_queue":
      await db.execute(sql`
        UPDATE autonomous_action_queue
        SET status = 'rejected', rejected_by = ${userId}, rejection_reason = ${reason}
        WHERE id = ${actionId}
      `).catch(() => {});
      break;
    case "agentmail":
      await db.execute(sql`
        UPDATE agent_mail_reply_queue
        SET status = 'rejected', approval_status = 'rejected'
        WHERE id = ${actionId}
      `).catch(() => {});
      break;
    case "gmail_agent":
      await db.execute(sql`
        UPDATE gmail_agent_actions SET status = 'rejected' WHERE id = ${actionId}
      `).catch(() => {});
      break;
  }
}

export function registerExecutionRoutes(app: Express): void {

  // ─── POST /api/actions/approve ─────────────────────────────────────────────
  // Unified approval endpoint — handles all source systems
  app.post("/api/actions/approve", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await getOrgId(req);
      const { actionId, sourceSystem, templateKey, notes } = req.body;
      if (!actionId || !sourceSystem) {
        return res.status(400).json({ message: "actionId and sourceSystem are required" });
      }
      const userId = req.user?.id ?? "admin";
      let result: any;
      switch (sourceSystem) {
        case "hermes":
          result = await approveHermesRec(orgId, actionId, userId, { templateKey, notes });
          break;
        case "autonomous_queue":
          result = await approveAutoQueue(orgId, actionId, userId);
          break;
        case "agentmail":
          result = await approveAgentMail(orgId, actionId, userId);
          break;
        case "gmail_agent":
          result = await approveGmailAction(orgId, actionId, userId);
          break;
        default:
          return res.status(400).json({ message: `Unknown sourceSystem: ${sourceSystem}` });
      }
      res.json({ ...result, approvedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to approve action" });
    }
  });

  // ─── POST /api/actions/reject ──────────────────────────────────────────────
  app.post("/api/actions/reject", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await getOrgId(req);
      const { actionId, sourceSystem, reason = "Rejected by admin" } = req.body;
      if (!actionId || !sourceSystem) {
        return res.status(400).json({ message: "actionId and sourceSystem are required" });
      }
      const userId = req.user?.id ?? "admin";
      await rejectAction(orgId, actionId, sourceSystem, reason, userId);
      res.json({ success: true, actionId, sourceSystem, rejectedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to reject action" });
    }
  });

  // ─── POST /api/actions/escalate ───────────────────────────────────────────
  app.post("/api/actions/escalate", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await getOrgId(req);
      const { actionId, sourceSystem, reason = "Escalated for review", title = "Action Escalated" } = req.body;
      const userId = req.user?.id ?? "admin";
      const payload: ActionPayload = {
        orgId,
        sourceSystem: "manual",
        actionType: "escalation",
        title,
        description: reason,
        metadata: { originalActionId: actionId, originalSourceSystem: sourceSystem, escalatedBy: userId },
      };
      const result = await executeAction(actionId, payload);
      res.json({ ...result, escalatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to escalate action" });
    }
  });

  // ─── POST /api/actions/execute ────────────────────────────────────────────
  // Direct execution (Phase 3 — workflow trigger endpoint)
  app.post("/api/actions/execute", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await getOrgId(req);
      const { actionId = crypto.randomUUID(), actionType, templateKey, ...rest } = req.body;
      const payload: ActionPayload = {
        orgId,
        sourceSystem: "manual",
        actionType,
        templateKey,
        ...rest,
      };
      const result = await executeAction(actionId, payload);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Execution failed" });
    }
  });

  // ─── GET /api/executions ──────────────────────────────────────────────────
  // Phase 6 — list all execution events
  app.get("/api/executions", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await getOrgId(req);
      const limit = parseInt((req.query.limit as string) ?? "50", 10);
      await ensureExecutionTables();
      const events = await listExecutionEvents(orgId, limit);
      res.json({ events, total: events.length, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load executions" });
    }
  });

  // ─── GET /api/executions/metrics ──────────────────────────────────────────
  app.get("/api/executions/metrics", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await getOrgId(req);
      const metrics = await getExecutionMetrics(orgId);
      res.json({ ...metrics, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load execution metrics" });
    }
  });

  // ─── GET /api/executions/:id ──────────────────────────────────────────────
  app.get("/api/executions/:id", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const event = await getExecutionEvent(req.params.id);
      if (!event) return res.status(404).json({ message: "Execution event not found" });
      res.json(event);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load execution event" });
    }
  });

  // ─── GET /api/coordination/stats ─────────────────────────────────────────
  // Phase 4 — cross-agent coordination stats
  app.get("/api/coordination/stats", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await getOrgId(req);
      await ensureCoordinationTables();
      const stats = await getCoordinationStats(orgId);
      res.json({ ...stats, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load coordination stats" });
    }
  });

  // ─── GET /api/conflicts ───────────────────────────────────────────────────
  // Phase 5 — open conflict alerts
  app.get("/api/conflicts", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await getOrgId(req);
      await ensureConflictTables();
      const [conflicts, stats] = await Promise.all([
        getOpenConflicts(orgId),
        getConflictStats(orgId),
      ]);
      res.json({ conflicts, stats, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load conflicts" });
    }
  });

  // ─── POST /api/conflicts/:id/resolve ─────────────────────────────────────
  app.post("/api/conflicts/:id/resolve", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { resolution = "Resolved by admin" } = req.body;
      const userId = req.user?.id ?? "admin";
      await resolveConflict(req.params.id, resolution, userId);
      res.json({ success: true, resolvedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to resolve conflict" });
    }
  });

  // ─── GET /api/action-center/summary ──────────────────────────────────────
  // Combined summary for the action center dashboard header
  app.get("/api/action-center/summary", async (req: any, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await getOrgId(req);
      await Promise.all([
        ensureExecutionTables(),
        ensureConflictTables(),
        ensureCoordinationTables(),
        ensureHermesTables(),
      ]);

      const [execMetrics, coordStats, conflictStats, hermesStats] = await Promise.all([
        getExecutionMetrics(orgId),
        getCoordinationStats(orgId),
        getConflictStats(orgId),
        getHermesStats(orgId),
      ]);

      // Count pending items across all queues
      const pendingRows = await Promise.all([
        db.execute(sql`
          SELECT COUNT(*) AS cnt FROM hermes_recommendations
          WHERE org_id = ${orgId} AND status = 'pending'
        `).catch(() => [{ cnt: 0 }]),
        db.execute(sql`
          SELECT COUNT(*) AS cnt FROM autonomous_action_queue
          WHERE org_id = ${orgId} AND status = 'pending'
        `).catch(() => [{ cnt: 0 }]),
        db.execute(sql`
          SELECT COUNT(*) AS cnt FROM agent_mail_reply_queue
          WHERE organization_id = ${orgId} AND approval_status = 'pending_review'
        `).catch(() => [{ cnt: 0 }]),
        db.execute(sql`
          SELECT COUNT(*) AS cnt FROM gmail_agent_actions
          WHERE org_id = ${orgId} AND status = 'proposed'
        `).catch(() => [{ cnt: 0 }]),
      ]);

      const extractCount = (r: any) => {
        const data = Array.isArray(r) ? r : (r as any).rows ?? [];
        return Number(data[0]?.cnt ?? 0);
      };

      const hermesPending    = extractCount(pendingRows[0]);
      const autoPending      = extractCount(pendingRows[1]);
      const agentmailPending = extractCount(pendingRows[2]);
      const gmailPending     = extractCount(pendingRows[3]);
      const totalPending     = hermesPending + autoPending + agentmailPending + gmailPending;

      res.json({
        pending: {
          total: totalPending,
          hermes: hermesPending,
          autonomousQueue: autoPending,
          agentmail: agentmailPending,
          gmailAgent: gmailPending,
        },
        executions: execMetrics,
        coordination: coordStats,
        conflicts: { open: conflictStats.open, total: conflictStats.totalConflicts },
        hermes: {
          totalRecommendations: hermesStats.totalRecommendations,
          pendingReview: hermesStats.pendingReview,
          approvalRate: hermesStats.approvalRate,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to load action center summary" });
    }
  });

  console.log("[ExecutionEngine] Routes registered");
}
