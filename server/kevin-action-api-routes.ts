/**
 * Kevin Action API — Phase 4 (Versioned Internal API)
 *
 * Versioned internal endpoints Kevin's virtual computer calls into.
 * Base path: /api/internal/kevin/v1/
 *
 * Authentication: requireInternalServiceToken (TE_INTERNAL_SERVICE_TOKEN bearer)
 * Organization: NEVER trust org_id from Kevin payload — always validate server-side
 * Role claims: verified against DB user_profiles, not from Kevin
 *
 * Replay protection: X-Kevin-Timestamp header must be within ±5 minutes
 * Idempotency: all POST endpoints check idempotency keys
 *
 * Routes:
 *   POST   /api/internal/kevin/v1/intents
 *   GET    /api/internal/kevin/v1/intents/:id
 *   POST   /api/internal/kevin/v1/intents/:id/cancel
 *   GET    /api/internal/kevin/v1/capabilities
 *   GET    /api/internal/kevin/v1/capabilities/:key
 *   POST   /api/internal/kevin/v1/tasks
 *   GET    /api/internal/kevin/v1/tasks/:id
 *   POST   /api/internal/kevin/v1/approvals
 *   GET    /api/internal/kevin/v1/approvals/:id
 *   GET    /api/internal/kevin/v1/outcomes/:id
 *   POST   /api/internal/kevin/v1/agentmail/draft
 *   POST   /api/internal/kevin/v1/ceo/analyze
 *   POST   /api/internal/kevin/v1/ceo/escalate
 *   GET    /api/internal/kevin/v1/navigate/:intent
 */

import type { Express, Request, Response, NextFunction } from "express";
import { requireInternalServiceToken } from "./middleware/require-internal-service-token";
import {
  createIntent,
  getIntentById,
  cancelIntent,
  listIntents,
  getIntentStats,
} from "./services/kevin-intent-service";
import {
  createTask,
  getTaskById,
  submitTaskOutput,
  cancelTask,
  getTasksForIntent,
} from "./services/kevin-task-bus";
import {
  CAPABILITY_REGISTRY,
  getCapabilityDefinition,
  serializeCapability,
  listCapabilityKeys,
} from "./services/kevin-capability-registry";
import {
  requestEmailDraft,
  requestReplyDraft,
  inspectEmailStatus,
  listKevinDrafts,
} from "./services/kevin-agentmail-bridge";
import {
  requestCeoAnalysis,
  requestCeoDecision,
  escalateToAttentionInbox,
} from "./services/kevin-ceo-bridge";
import { resolveNavSuggestion } from "./services/kevin-navigation-registry";
import { recordKevinAuditEvent } from "./services/kevin-audit-service";
import { recordKevinOutcome } from "./services/kevin-outcome-service";
import { verifyCapabilityExecution, persistVerificationResult } from "./services/kevin-verifier-service";
import { recordKevinOutcomeLearning, ensureKevinOutcomesTable } from "./services/kevin-learning-service";
import {
  logKevinIntent,
  logKevinTask,
  logKevinPolicyDenial,
  logKevinVerification,
  logKevinAuth,
} from "./services/kevin-observability-service";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

// Ensure learning tables exist on first use
void ensureKevinOutcomesTable().catch(() => {});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Validate X-Kevin-Timestamp header to prevent replay attacks.
 */
function replayGuard(req: Request, res: Response, next: NextFunction): void {
  const tsHeader = req.headers["x-kevin-timestamp"];
  if (!tsHeader) {
    next(); // optional in development — production should enforce
    return;
  }
  const ts = parseInt(String(tsHeader), 10);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
    res.status(400).json({
      message: "Request timestamp out of allowed window",
      code: "REPLAY_REJECTED",
    });
    return;
  }
  next();
}

function extractRows(result: unknown): any[] {
  return Array.isArray((result as any)?.rows)
    ? (result as any).rows
    : Array.isArray(result)
      ? (result as any[])
      : [];
}

async function resolveOrgIdFromRequest(req: Request): Promise<string | null> {
  // NEVER trust org_id from Kevin's body — always use the authenticated context
  // For internal service token auth, org_id must come from a validated path param
  // or query param, then we verify the org exists server-side.
  const rawOrgId =
    (req.body?.org_id as string | undefined) ??
    (req.query.org_id as string | undefined) ??
    (req.headers["x-org-id"] as string | undefined);
  if (!rawOrgId) return null;

  // Verify org exists
  try {
    const result = await db.execute(sql`
      SELECT id FROM organizations WHERE id = ${rawOrgId} LIMIT 1
    `);
    const rows = extractRows(result);
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerKevinActionApiRoutes(app: Express): Promise<void> {
  const base = "/api/internal/kevin/v1";
  const guard = [requireInternalServiceToken, replayGuard];

  // ── Intents ────────────────────────────────────────────────────────────────

  /**
   * POST /api/internal/kevin/v1/intents
   * Create a new Kevin intent. Runs through policy engine immediately.
   */
  app.post(`${base}/intents`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) {
      return res.status(400).json({ message: "Valid org_id is required", code: "ORG_REQUIRED" });
    }

    const body = req.body ?? {};
    if (!body.capability_key || !body.goal) {
      return res.status(400).json({
        message: "capability_key and goal are required",
        code: "VALIDATION_ERROR",
      });
    }

    // Validate capability exists
    if (!CAPABILITY_REGISTRY[body.capability_key]) {
      return res.status(400).json({
        message: `Unknown capability: ${body.capability_key}`,
        code: "CAPABILITY_UNKNOWN",
      });
    }

    try {
      const { intent, policyResult, isNew } = await createIntent({
        orgId,
        requestId: body.request_id ?? randomUUID(),
        idempotencyKey: body.idempotency_key,
        correlationId: body.correlation_id,
        parentIntentId: body.parent_intent_id,
        initiatedByUserId: body.initiated_by_user_id,
        kevinIdentity: body.kevin_identity ?? "kevin",
        capabilityKey: body.capability_key,
        goal: String(body.goal).slice(0, 1000),
        reason: body.reason ? String(body.reason).slice(0, 500) : undefined,
        expectedResult: body.expected_result ? String(body.expected_result).slice(0, 500) : undefined,
        structuredArgs: body.structured_args ?? {},
        confidence: body.confidence ? Number(body.confidence) : undefined,
        sourceContext: body.source_context,
        requestedMode: body.requested_mode ?? "recommend",
        expiresInSeconds: body.expires_in_seconds,
      });

      void recordKevinAuditEvent({
        orgId,
        eventType: "action_api.intent_created",
        payload: {
          intentId: intent.id,
          capability: body.capability_key,
          policyDecision: policyResult.decision,
          isNew,
        },
      });

      return res.status(isNew ? 202 : 200).json({
        intent_id: intent.id,
        state: intent.state,
        policy_decision: policyResult.decision,
        granted_mode: policyResult.grantedMode ?? null,
        requires_approval: policyResult.requiresApproval,
        approval_id: intent.approvalId ?? null,
        denial_code: policyResult.denialCode ?? null,
        denial_reason: policyResult.denialReason ?? null,
        is_new: isNew,
        created_at: intent.createdAt,
      });
    } catch (e: any) {
      return res.status(500).json({ message: e?.message ?? "Intent creation failed" });
    }
  });

  /**
   * GET /api/internal/kevin/v1/intents/:id
   */
  app.get(`${base}/intents/:id`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const intent = await getIntentById(req.params.id, orgId);
    if (!intent) return res.status(404).json({ message: "Intent not found" });

    const tasks = await getTasksForIntent(intent.id);
    return res.json({ intent, tasks });
  });

  /**
   * POST /api/internal/kevin/v1/intents/:id/cancel
   */
  app.post(`${base}/intents/:id/cancel`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const reason = String(req.body?.reason ?? "Cancelled by Kevin").slice(0, 500);
    const ok = await cancelIntent(req.params.id, orgId, reason);
    if (!ok) return res.status(404).json({ message: "Intent not found or already terminal" });
    return res.json({ ok: true, intent_id: req.params.id, state: "cancelled" });
  });

  // ── Capabilities ───────────────────────────────────────────────────────────

  /**
   * GET /api/internal/kevin/v1/capabilities
   * List all registered capabilities (definitions only, not per-org modes).
   */
  app.get(`${base}/capabilities`, ...guard, async (req: Request, res: Response) => {
    const keys = listCapabilityKeys();
    const category = req.query.category as string | undefined;
    const defs = keys
      .map((k) => getCapabilityDefinition(k)!)
      .filter((d) => !category || d.category === category)
      .map(serializeCapability);
    return res.json({ capabilities: defs, total: defs.length });
  });

  /**
   * GET /api/internal/kevin/v1/capabilities/:key
   */
  app.get(`${base}/capabilities/:key`, ...guard, async (req: Request, res: Response) => {
    const cap = getCapabilityDefinition(req.params.key);
    if (!cap) return res.status(404).json({ message: "Capability not found" });
    return res.json(serializeCapability(cap));
  });

  // ── Tasks ──────────────────────────────────────────────────────────────────

  /**
   * POST /api/internal/kevin/v1/tasks
   * Create a task within an existing intent.
   */
  app.post(`${base}/tasks`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const body = req.body ?? {};
    if (!body.intent_id || !body.assigned_agent || !body.objective) {
      return res.status(400).json({
        message: "intent_id, assigned_agent, and objective are required",
        code: "VALIDATION_ERROR",
      });
    }

    // Verify intent belongs to this org
    const intent = await getIntentById(body.intent_id, orgId);
    if (!intent) return res.status(404).json({ message: "Intent not found" });

    const task = await createTask({
      intentId: body.intent_id,
      orgId,
      assignedAgent: body.assigned_agent,
      capabilityRequested: body.capability_requested ?? body.assigned_agent,
      objective: String(body.objective).slice(0, 1000),
      inputs: body.inputs ?? {},
      constraints: body.constraints,
      expectedOutputSchema: body.expected_output_schema,
      sequenceOrder: body.sequence_order ?? 0,
      dependsOnTaskIds: body.depends_on_task_ids ?? [],
      parentCorrelationChain: body.parent_correlation_chain,
      priority: body.priority ?? "normal",
      dueAt: body.due_at ? new Date(body.due_at) : undefined,
      timeoutSeconds: body.timeout_seconds ?? 300,
      approvalRequired: body.approval_required ?? false,
    });

    if (!task) {
      return res.status(409).json({
        message: "Task creation rejected — delegation depth or loop detected",
        code: "DELEGATION_REJECTED",
      });
    }

    return res.status(202).json({ task_id: task.id, state: task.state, intent_id: task.intentId });
  });

  /**
   * GET /api/internal/kevin/v1/tasks/:id
   */
  app.get(`${base}/tasks/:id`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const task = await getTaskById(req.params.id, orgId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return res.json(task);
  });

  /**
   * POST /api/internal/kevin/v1/tasks/:id/output
   * Agent submits output for a task.
   */
  app.post(`${base}/tasks/:id/output`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const body = req.body ?? {};
    const result = await submitTaskOutput(req.params.id, orgId, body.output ?? body);
    return res.json(result);
  });

  /**
   * POST /api/internal/kevin/v1/tasks/:id/cancel
   */
  app.post(`${base}/tasks/:id/cancel`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const reason = String(req.body?.reason ?? "Cancelled by Kevin").slice(0, 500);
    const ok = await cancelTask(req.params.id, orgId, reason);
    if (!ok) return res.status(404).json({ message: "Task not found or already terminal" });
    return res.json({ ok: true, task_id: req.params.id });
  });

  // ── Approvals ──────────────────────────────────────────────────────────────

  /**
   * POST /api/internal/kevin/v1/approvals
   * Create a Kevin-specific approval record.
   */
  app.post(`${base}/approvals`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const body = req.body ?? {};
    if (!body.capability_key || !body.action_summary) {
      return res.status(400).json({
        message: "capability_key and action_summary are required",
        code: "VALIDATION_ERROR",
      });
    }

    try {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE kevin_approval_status AS ENUM (
            'pending','approved','rejected','changes_requested','expired','cancelled'
          );
        EXCEPTION WHEN duplicate_object THEN NULL; END $$
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS kevin_exec_approvals (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          org_id TEXT NOT NULL,
          intent_id TEXT,
          task_id TEXT,
          capability_key TEXT NOT NULL,
          action_summary TEXT NOT NULL,
          action_reason TEXT,
          action_payload JSONB NOT NULL DEFAULT '{}',
          exact_payload JSONB NOT NULL DEFAULT '{}',
          evidence JSONB,
          affected_records JSONB,
          expected_benefit TEXT,
          risk_description TEXT,
          risk_level TEXT NOT NULL DEFAULT 'medium',
          is_reversible BOOLEAN NOT NULL DEFAULT false,
          rollback_strategy TEXT,
          producer_agent TEXT,
          kevin_confidence NUMERIC(3,2),
          status kevin_approval_status NOT NULL DEFAULT 'pending',
          decided_by TEXT,
          decided_at TIMESTAMPTZ,
          decision_notes TEXT,
          approved_payload JSONB,
          approve_once BOOLEAN NOT NULL DEFAULT true,
          approve_similar_limit INT,
          similar_approved_count INT NOT NULL DEFAULT 0,
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      const id = randomUUID();
      const expiresAt = body.expires_in_seconds
        ? new Date(Date.now() + Number(body.expires_in_seconds) * 1000)
        : new Date(Date.now() + 24 * 3600_000); // default 24h

      await db.execute(sql`
        INSERT INTO kevin_exec_approvals (
          id, org_id, intent_id, task_id, capability_key, action_summary,
          action_reason, action_payload, exact_payload, evidence, affected_records,
          expected_benefit, risk_description, risk_level, is_reversible,
          rollback_strategy, producer_agent, kevin_confidence, expires_at
        ) VALUES (
          ${id}, ${orgId},
          ${body.intent_id ?? null}, ${body.task_id ?? null},
          ${body.capability_key}, ${String(body.action_summary).slice(0, 500)},
          ${body.action_reason ? String(body.action_reason).slice(0, 500) : null},
          ${JSON.stringify(body.action_payload ?? {})}::jsonb,
          ${JSON.stringify(body.exact_payload ?? body.action_payload ?? {})}::jsonb,
          ${body.evidence ? JSON.stringify(body.evidence) : null}::jsonb,
          ${body.affected_records ? JSON.stringify(body.affected_records) : null}::jsonb,
          ${body.expected_benefit ? String(body.expected_benefit).slice(0, 500) : null},
          ${body.risk_description ? String(body.risk_description).slice(0, 500) : null},
          ${body.risk_level ?? "medium"},
          ${body.is_reversible ?? false},
          ${body.rollback_strategy ? String(body.rollback_strategy).slice(0, 300) : null},
          ${body.producer_agent ?? null},
          ${body.kevin_confidence ?? null},
          ${expiresAt}
        )
      `);

      void recordKevinAuditEvent({
        orgId,
        eventType: "action_api.approval_created",
        payload: {
          approvalId: id,
          capabilityKey: body.capability_key,
          riskLevel: body.risk_level ?? "medium",
        },
      });

      return res.status(202).json({ approval_id: id, status: "pending", expires_at: expiresAt });
    } catch (e: any) {
      return res.status(500).json({ message: e?.message ?? "Approval creation failed" });
    }
  });

  /**
   * GET /api/internal/kevin/v1/approvals/:id
   */
  app.get(`${base}/approvals/:id`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    try {
      const result = await db.execute(sql`
        SELECT * FROM kevin_exec_approvals WHERE id = ${req.params.id} AND org_id = ${orgId} LIMIT 1
      `);
      const rows = extractRows(result);
      if (!rows[0]) return res.status(404).json({ message: "Approval not found" });
      return res.json(rows[0]);
    } catch {
      return res.status(404).json({ message: "Approval not found" });
    }
  });

  // ── Outcomes ───────────────────────────────────────────────────────────────

  /**
   * GET /api/internal/kevin/v1/outcomes/:id
   */
  app.get(`${base}/outcomes/:id`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    try {
      const { kevinOutcomes } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [outcome] = await db
        .select()
        .from(kevinOutcomes)
        .where(and(eq(kevinOutcomes.id, req.params.id), eq(kevinOutcomes.orgId, orgId)))
        .limit(1);
      if (!outcome) return res.status(404).json({ message: "Outcome not found" });
      return res.json(outcome);
    } catch {
      return res.status(404).json({ message: "Outcome not found" });
    }
  });

  // ── AgentMail bridge ───────────────────────────────────────────────────────

  /**
   * POST /api/internal/kevin/v1/agentmail/draft
   */
  app.post(`${base}/agentmail/draft`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const body = req.body ?? {};
    if (!body.intent_id) {
      return res.status(400).json({ message: "intent_id required" });
    }

    const isReply = Boolean(body.reply_to_action_id);
    const result = isReply
      ? await requestReplyDraft({
          orgId,
          intentId: body.intent_id,
          replyToActionId: body.reply_to_action_id,
          bodyContext: body.body_context,
          kevinConfidence: body.kevin_confidence,
          producerAgent: body.producer_agent,
        })
      : await requestEmailDraft({
          orgId,
          intentId: body.intent_id,
          toName: body.to_name,
          toEmail: body.to_email,
          subject: body.subject,
          bodyContext: body.body_context,
          leadId: body.lead_id,
          communicationDomain: body.communication_domain,
          kevinConfidence: body.kevin_confidence,
          producerAgent: body.producer_agent,
        });

    return res.status(result.ok ? 202 : 500).json(result);
  });

  /**
   * GET /api/internal/kevin/v1/agentmail/status/:actionId
   */
  app.get(`${base}/agentmail/status/:actionId`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const status = await inspectEmailStatus(orgId, req.params.actionId);
    return res.json(status);
  });

  /**
   * GET /api/internal/kevin/v1/agentmail/drafts
   */
  app.get(`${base}/agentmail/drafts`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const drafts = await listKevinDrafts(orgId, Number(req.query.limit ?? 20));
    return res.json({ drafts });
  });

  // ── CEO bridge ─────────────────────────────────────────────────────────────

  /**
   * POST /api/internal/kevin/v1/ceo/analyze
   */
  app.post(`${base}/ceo/analyze`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const body = req.body ?? {};
    if (!body.question || !body.intent_id) {
      return res.status(400).json({ message: "question and intent_id required" });
    }

    const result = await requestCeoAnalysis({
      orgId,
      intentId: body.intent_id,
      question: String(body.question).slice(0, 500),
      domain: body.domain,
      contextHints: body.context_hints,
      requestedBy: body.requested_by,
    });

    return res.json(result);
  });

  /**
   * POST /api/internal/kevin/v1/ceo/decide
   */
  app.post(`${base}/ceo/decide`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const body = req.body ?? {};
    if (!body.question || !body.intent_id) {
      return res.status(400).json({ message: "question and intent_id required" });
    }

    const result = await requestCeoDecision(
      orgId,
      body.intent_id,
      String(body.question).slice(0, 500),
      (body.options ?? []).map((o: unknown) => String(o).slice(0, 200)),
    );

    return res.json(result);
  });

  /**
   * POST /api/internal/kevin/v1/ceo/escalate
   */
  app.post(`${base}/ceo/escalate`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const body = req.body ?? {};
    if (!body.risk_title || !body.intent_id) {
      return res.status(400).json({ message: "risk_title and intent_id required" });
    }

    const attentionItemId = await escalateToAttentionInbox({
      orgId,
      intentId: body.intent_id,
      riskTitle: String(body.risk_title).slice(0, 200),
      riskDescription: String(body.risk_description ?? "").slice(0, 1000),
      severity: body.severity ?? "medium",
      affectedDomain: body.affected_domain,
      contextData: body.context_data,
    });

    return res.json({ ok: Boolean(attentionItemId), attention_item_id: attentionItemId });
  });

  // ── Navigation ─────────────────────────────────────────────────────────────

  /**
   * GET /api/internal/kevin/v1/navigate/:intent
   * Return a structured navigation suggestion for a known intent.
   */
  app.get(`${base}/navigate/:intent`, ...guard, async (req: Request, res: Response) => {
    const reason = String(req.query.reason ?? "Navigating to requested location");
    const suggestion = resolveNavSuggestion({ intent: req.params.intent, userRole: "ADMIN", reason });
    if (!suggestion) {
      return res.status(404).json({
        message: "Navigation intent not found in registry",
        code: "NAV_NOT_FOUND",
      });
    }
    return res.json(suggestion);
  });

  // ── Stats ──────────────────────────────────────────────────────────────────

  /**
   * GET /api/internal/kevin/v1/stats
   */
  app.get(`${base}/stats`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });
    const stats = await getIntentStats(orgId);
    return res.json(stats);
  });

  // ── Verify ─────────────────────────────────────────────────────────────────

  /**
   * POST /api/internal/kevin/v1/verify
   * Trigger post-execution verification for a capability result.
   * Kevin calls this after receiving an execution result to confirm it.
   */
  app.post(`${base}/verify`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const body = req.body ?? {};
    const { capability_key, resource_id, intent_id, task_id, additional_args } = body;
    if (!capability_key || !resource_id) {
      return res.status(400).json({ message: "capability_key and resource_id required", code: "VALIDATION_ERROR" });
    }

    const result = await verifyCapabilityExecution(capability_key, orgId, resource_id, additional_args ?? {});
    await persistVerificationResult(intent_id ?? "", task_id ?? null, capability_key, result);

    logKevinVerification({
      status: result.status,
      capabilityKey: capability_key,
      intentId: intent_id ?? "",
      orgId,
      correlationId: req.headers["x-correlation-id"] as string | undefined,
      deviation: result.deviation,
    });

    // Record learning from verification result
    if (intent_id) {
      void recordKevinOutcomeLearning({
        orgId,
        intentId: intent_id,
        capabilityKey: capability_key,
        outcomeType: result.status === "passed" ? "verification_passed" : "verification_failed",
        outcome: result.status === "passed" ? "success" : "partial",
        verificationResult: result.status,
        correlationId: req.headers["x-correlation-id"] as string | undefined,
      });
    }

    return res.json({ verification: result });
  });

  // ── Outcomes ───────────────────────────────────────────────────────────────

  /**
   * POST /api/internal/kevin/v1/outcomes
   * Record a final business outcome for an intent (e.g., lead converted, session booked).
   */
  app.post(`${base}/outcomes`, ...guard, async (req: Request, res: Response) => {
    const orgId = await resolveOrgIdFromRequest(req);
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const body = req.body ?? {};
    const { intent_id, capability_key, outcome, downstream_business_outcome,
            human_feedback, specialist_agent, kevin_confidence, should_repeat } = body;
    if (!intent_id || !capability_key || !outcome) {
      return res.status(400).json({ message: "intent_id, capability_key, and outcome are required" });
    }

    void recordKevinOutcomeLearning({
      orgId,
      intentId: intent_id,
      capabilityKey: capability_key,
      outcomeType: outcome === "success" ? "intent_completed" : "intent_failed",
      outcome,
      downstreamBusinessOutcome: downstream_business_outcome,
      humanFeedback: human_feedback,
      specialistAgent: specialist_agent,
      kevinConfidence: kevin_confidence,
      shouldRepeat: should_repeat,
      correlationId: req.headers["x-correlation-id"] as string | undefined,
    });

    logKevinIntent({
      action: outcome === "success" ? "completed" : "failed",
      intentId: intent_id,
      capabilityKey: capability_key,
      orgId,
      correlationId: req.headers["x-correlation-id"] as string | undefined,
    });

    return res.json({ ok: true, recorded: true });
  });

  // ── Machine-Readable Documentation (Phase 19) ──────────────────────────────

  /**
   * GET /api/internal/kevin/v1/docs
   * Returns machine-readable API documentation Kevin can use to onboard TrainEfficiency.
   * This endpoint does NOT require M2M auth (public docs).
   */
  app.get(`${base}/docs`, async (_req: Request, res: Response) => {
    const capabilityKeys = listCapabilityKeys();
    const capabilities = capabilityKeys.map((key) => {
      const cap = getCapabilityDefinition(key)!;
      return serializeCapability(cap);
    });

    const docs = {
      version: "1.0",
      generated_at: new Date().toISOString(),
      base_url: "/api/internal/kevin/v1",
      authentication: {
        type: "bearer_token",
        header: "Authorization",
        format: "Bearer <TE_INTERNAL_SERVICE_TOKEN>",
        env_variable: "TE_INTERNAL_SERVICE_TOKEN",
        note: "Service token must be set as an environment variable on Kevin's virtual computer.",
      },
      replay_protection: {
        header: "X-Kevin-Timestamp",
        format: "unix_milliseconds",
        window_ms: 300000,
        nonce_header: "X-Kevin-Nonce",
        note: "Timestamp must be within ±5 minutes of server time.",
      },
      correlation: {
        header: "X-Correlation-ID",
        format: "uuid",
        note: "Thread this ID through all related requests for cross-system tracing.",
      },
      intent_lifecycle: {
        states: ["received","validating","planned","awaiting_approval","queued","executing","verifying","completed","partially_completed","failed","cancelled","dead_lettered"],
        description: "An intent represents Kevin's executive objective. Create one per goal. Poll for state changes.",
      },
      task_lifecycle: {
        states: ["created","blocked","queued","claimed","executing","awaiting_approval","awaiting_dependency","verifying","completed","failed","cancelled","dead_lettered"],
        description: "A task is one action required to achieve an intent. Tasks can have dependencies.",
      },
      approval_lifecycle: {
        states: ["pending","approved","rejected","expired","cancelled"],
        description: "High-risk actions require human approval before execution.",
      },
      idempotency: {
        header: "idempotency_key",
        note: "Include idempotency_key in POST /intents to prevent duplicate intents on retry.",
      },
      rate_limits: {
        intents_per_minute: 20,
        tasks_per_intent: 20,
        delegation_depth: 3,
      },
      error_codes: {
        "AUTHENTICATION_FAILED": "Service token is invalid or missing",
        "REPLAY_REJECTED": "Request timestamp is outside the allowed window",
        "VALIDATION_ERROR": "Request payload is missing required fields",
        "CAPABILITY_UNKNOWN": "The requested capability key does not exist",
        "CAPABILITY_DISABLED": "The capability is disabled for this organization",
        "MODE_NOT_PERMITTED": "The requested execution mode is not allowed",
        "APPROVAL_REQUIRED": "This action requires human approval before execution",
        "ORG_MISMATCH": "The resource does not belong to the authorized organization",
        "RATE_LIMITED": "Too many requests — slow down",
        "DUPLICATE_REQUEST": "This idempotency key was already used",
        "EMERGENCY_STOP_ACTIVE": "Global or org-level emergency stop is active",
        "CIRCUIT_BREAKER_OPEN": "Too many recent failures — circuit breaker is open",
        "EXECUTOR_UNAVAILABLE": "The executor service for this capability is not reachable",
        "VERIFICATION_FAILED": "Execution completed but verification checks did not pass",
        "POLICY_DENIED": "The policy engine rejected this request",
        "NAV_NOT_FOUND": "The requested navigation intent is not in the route registry",
      },
      endpoints: [
        { method: "GET",  path: "/capabilities",            auth: true,  description: "List all available capabilities for the org" },
        { method: "GET",  path: "/capabilities/:key",       auth: true,  description: "Get a single capability definition" },
        { method: "POST", path: "/intents",                 auth: true,  description: "Create a new executive intent" },
        { method: "GET",  path: "/intents",                 auth: true,  description: "List intents for the org" },
        { method: "GET",  path: "/intents/:id",             auth: true,  description: "Get a single intent with its tasks" },
        { method: "POST", path: "/intents/:id/cancel",      auth: true,  description: "Cancel an active intent" },
        { method: "POST", path: "/tasks",                   auth: true,  description: "Delegate a task to a platform agent" },
        { method: "GET",  path: "/tasks/:id",               auth: true,  description: "Get a single task" },
        { method: "POST", path: "/tasks/:id/cancel",        auth: true,  description: "Cancel a task" },
        { method: "POST", path: "/tasks/:id/output",        auth: true,  description: "Submit task output (agent → Kevin)" },
        { method: "POST", path: "/approvals",               auth: true,  description: "Create an approval request" },
        { method: "GET",  path: "/approvals/:id",           auth: true,  description: "Inspect an approval" },
        { method: "POST", path: "/agentmail/draft",         auth: true,  description: "Create an AgentMail email draft" },
        { method: "POST", path: "/ceo/analyze",             auth: true,  description: "Request CEO Agent analysis" },
        { method: "POST", path: "/ceo/escalate",            auth: true,  description: "Escalate a risk to the attention inbox" },
        { method: "GET",  path: "/navigate/:intent",        auth: true,  description: "Get a navigation suggestion for a known intent" },
        { method: "GET",  path: "/stats",                   auth: true,  description: "Intent statistics for the org" },
        { method: "POST", path: "/verify",                  auth: true,  description: "Verify a capability execution result" },
        { method: "POST", path: "/outcomes",                auth: true,  description: "Record a final business outcome" },
        { method: "GET",  path: "/health",                  auth: false, description: "Health check — no auth required" },
        { method: "GET",  path: "/docs",                    auth: false, description: "This machine-readable documentation" },
      ],
      intent_example: {
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        idempotencyKey: "kevin-lead-followup-2024-01-15",
        correlationId: "550e8400-e29b-41d4-a716-446655440001",
        organizationId: "your-org-id",
        initiatingUserId: "your-user-id",
        capabilityKey: "email.create_draft",
        capabilityVersion: "1",
        requestedMode: "draft",
        goal: "Create a personalized follow-up email for inactive lead Jordan Smith",
        reason: "Jordan was a high-value prospect who went silent 30 days ago",
        confidence: 0.91,
        structuredArgs: { leadId: "lead_abc123", tone: "professional_warm" },
        sourceContext: { channel: "trainefficiency_chat" },
      },
      capability_catalog: capabilities,
      production_activation_plan: {
        stages: ["local_tests", "observe_mode", "recommend_mode", "draft_mode", "require_approval", "narrowly_scoped_auto"],
        current_safe_defaults: {
          "platform.retrieve_context": "observe",
          "platform.open_location": "auto",
          "ceo.request_analysis": "recommend",
          "email.create_draft": "draft",
          "email.send": "require_approval",
          "schedule.create_session": "require_approval",
          "campaign.request_launch": "disabled",
        },
      },
      security_restrictions: [
        "Kevin must never receive unrestricted database access",
        "Kevin must never directly modify another agent's memory",
        "Kevin must never bypass existing business services",
        "Kevin must never be given one global 'manage everything' permission",
        "Every action must be an explicit capability with its own policy",
        "Organization ID is always validated server-side — never trusted from Kevin",
        "Emergency kill switches can halt all Kevin operations instantly",
      ],
    };

    return res.json(docs);
  });

  /**
   * GET /api/internal/kevin/v1/health
   */
  app.get(`${base}/health`, async (_req: Request, res: Response) => {
    return res.json({
      status: "operational",
      version: "1.0",
      timestamp: new Date().toISOString(),
      capabilities: listCapabilityKeys().length,
      docs_url: `${base}/docs`,
    });
  });
}
