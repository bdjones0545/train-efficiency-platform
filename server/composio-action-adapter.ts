/**
 * Composio Action Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * The ONLY entry point for agents requesting Composio tool execution.
 *
 * Pipeline:
 *   Agent
 *     → Permission check     (tool registry)
 *     → Policy engine        (autonomy-policy-engine)
 *     → Approval gate        (auto_execute | approval_required | blocked)
 *     → Composio execution   (composio-service)
 *     → Timeline logging     (agent_operating_timeline)
 *     → Comms log            (communication_logs — if communication tool)
 *     → Hermes event         (composio-hermes-emitter)
 *
 * No agent may call composio-service directly.
 * No Composio action bypasses this adapter.
 */

import { db } from "./db";
import { agentOperatingTimeline, communicationLogs } from "@shared/schema";
import {
  isAgentAllowedTool,
  isActionAllowed,
  getPermissionDeniedReason,
  doesToolRequireApproval,
} from "./composio-tool-registry";
import {
  executeComposioAction,
  writeComposioActionLog,
  type ComposioExecuteResult,
} from "./services/composio-service";
import { emitComposioHermesEvent } from "./composio-hermes-emitter";
import { evaluatePolicy, type PolicyInput } from "./services/autonomy-policy-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComposioActionRequest {
  orgId: string;
  agentId: string;
  tool: string;
  action: string;
  inputParams: Record<string, unknown>;
  entityId?: string;
  confidence?: number;
  riskLevel?: "low" | "medium" | "high";
  recipientEmail?: string;
  notes?: string;
}

export type AdapterOutcome =
  | "executed"
  | "queued_for_approval"
  | "blocked_no_permission"
  | "blocked_by_policy"
  | "blocked_action_not_allowed"
  | "failed";

export interface ComposioAdapterResult {
  outcome: AdapterOutcome;
  logId: string;
  message: string;
  requiresApproval: boolean;
  executionResult?: ComposioExecuteResult;
  approvalQueueId?: string;
  deniedReason?: string;
  policyDecision?: string;
}

// ─── Communication tool detection ────────────────────────────────────────────

const COMMUNICATION_TOOLS = new Set(["GMAIL", "SLACK"]);

// ─── Core adapter ─────────────────────────────────────────────────────────────

export async function requestComposioAction(
  request: ComposioActionRequest,
): Promise<ComposioAdapterResult> {
  const {
    orgId,
    agentId,
    tool,
    action,
    inputParams,
    entityId,
    confidence = 0.7,
    riskLevel = "medium",
    recipientEmail,
    notes,
  } = request;

  const toolUpper = tool.toUpperCase();
  const logId = crypto.randomUUID();

  // ── Step 1: Permission check ─────────────────────────────────────────────
  const permDenied = getPermissionDeniedReason(agentId, toolUpper, action);
  if (permDenied) {
    await logTimelineEntry({
      orgId,
      agentId,
      tool: toolUpper,
      action,
      status: "failed",
      requiresApproval: false,
      summary: `Permission denied: ${permDenied}`,
    });
    return {
      outcome: "blocked_no_permission",
      logId,
      message: permDenied,
      requiresApproval: false,
      deniedReason: permDenied,
    };
  }

  // ── Step 2: Action-level allow-list ──────────────────────────────────────
  if (!isActionAllowed(toolUpper, action)) {
    const reason = `Action "${action}" is not permitted for tool "${toolUpper}"`;
    await logTimelineEntry({
      orgId, agentId, tool: toolUpper, action, status: "failed",
      requiresApproval: false, summary: reason,
    });
    return {
      outcome: "blocked_action_not_allowed",
      logId,
      message: reason,
      requiresApproval: false,
      deniedReason: reason,
    };
  }

  // ── Step 3: Policy engine evaluation ────────────────────────────────────
  let policyDecision: "auto_execute" | "approval_required" | "blocked" = "approval_required";
  const toolNeedsApproval = doesToolRequireApproval(toolUpper);

  try {
    const policyInput: PolicyInput = {
      orgId,
      actionType: `composio_${toolUpper.toLowerCase()}_${action.toLowerCase()}`,
      confidence: Math.round(confidence * 100),
      riskLevel,
      recipientEmail,
      isFirstContact: false,
      isNewRecipient: false,
    };
    const evaluation = await evaluatePolicy(policyInput);
    policyDecision = evaluation.decision;
  } catch (err: any) {
    console.warn(`[ComposioAdapter] Policy engine error for ${agentId}/${toolUpper}/${action}: ${err.message}`);
    policyDecision = "approval_required";
  }

  // Enforce approval for tools that always require it (Gmail, Slack, GitHub, Stripe)
  if (toolNeedsApproval && policyDecision === "auto_execute") {
    policyDecision = "approval_required";
  }

  // ── Step 4: Blocked by policy ─────────────────────────────────────────
  if (policyDecision === "blocked") {
    const reason = `Action blocked by policy engine`;
    await writeComposioActionLog({
      orgId, agentId, tool: toolUpper, action, entityId,
      inputSummary: { actionType: action, notes },
      success: false, errorMessage: reason,
      policyDecision: "blocked", approvalRequired: false,
    });
    await logTimelineEntry({
      orgId, agentId, tool: toolUpper, action,
      status: "failed", requiresApproval: false, summary: reason,
    });
    return {
      outcome: "blocked_by_policy",
      logId,
      message: reason,
      requiresApproval: false,
      policyDecision: "blocked",
      deniedReason: reason,
    };
  }

  // ── Step 5: Queue for approval ────────────────────────────────────────
  if (policyDecision === "approval_required") {
    const approvalQueueId = await queueForApproval({
      orgId, agentId, tool: toolUpper, action,
      inputParams, entityId, confidence, riskLevel, notes,
    });

    await writeComposioActionLog({
      orgId, agentId, tool: toolUpper, action, entityId,
      inputSummary: { actionType: action, confidence, riskLevel, notes },
      success: false,
      policyDecision: "approval_required",
      approvalRequired: true,
    });

    await logTimelineEntry({
      orgId, agentId, tool: toolUpper, action,
      status: "requires_approval", requiresApproval: true,
      summary: `${agentId} requested ${toolUpper}/${action} — queued for human approval`,
    });

    await emitComposioHermesEvent({
      source: "composio",
      orgId,
      agent: agentId,
      tool: toolUpper,
      action,
      result: "queued_for_approval",
      outcome: "pending_approval",
      metadata: { approvalQueueId, confidence, riskLevel },
    });

    return {
      outcome: "queued_for_approval",
      logId,
      message: `Action queued for human approval (approvalQueueId: ${approvalQueueId})`,
      requiresApproval: true,
      approvalQueueId,
      policyDecision: "approval_required",
    };
  }

  // ── Step 6: Auto-execute ──────────────────────────────────────────────
  const execResult = await executeComposioAction({
    orgId, agentId, tool: toolUpper, action,
    inputParams, entityId, logId,
  });

  // ── Step 7: Log to communication_logs if communication tool ──────────
  if (COMMUNICATION_TOOLS.has(toolUpper) && execResult.success) {
    await logCommunicationEvent({
      orgId, agentId, tool: toolUpper, action,
      recipientEmail, notes,
    });
  }

  // ── Step 8: Log to agent_operating_timeline ──────────────────────────
  await logTimelineEntry({
    orgId, agentId, tool: toolUpper, action,
    status: execResult.success ? "completed" : "failed",
    requiresApproval: false,
    summary: execResult.success
      ? `${agentId} executed ${toolUpper}/${action} via Composio`
      : `${agentId} failed ${toolUpper}/${action}: ${execResult.error}`,
    errorMessage: execResult.error,
  });

  // ── Step 9: Emit Hermes event ─────────────────────────────────────────
  await emitComposioHermesEvent({
    source: "composio",
    orgId,
    agent: agentId,
    tool: toolUpper,
    action,
    result: execResult.success ? "success" : "failure",
    outcome: execResult.success ? "completed" : "failed",
    metadata: {
      durationMs: execResult.durationMs,
      error: execResult.error,
    },
  });

  return {
    outcome: execResult.success ? "executed" : "failed",
    logId: execResult.logId,
    message: execResult.success
      ? `${toolUpper}/${action} executed successfully`
      : `Execution failed: ${execResult.error}`,
    requiresApproval: false,
    executionResult: execResult,
    policyDecision: "auto_execute",
  };
}

// ─── Approval queue helper ────────────────────────────────────────────────────

async function queueForApproval(params: {
  orgId: string;
  agentId: string;
  tool: string;
  action: string;
  inputParams: Record<string, unknown>;
  entityId?: string;
  confidence: number;
  riskLevel: string;
  notes?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  try {
    await db.execute(
      require("drizzle-orm").sql`
        INSERT INTO autonomous_action_queue (
          id, org_id, decision_type, title, description,
          risk_level, confidence_score, status, metadata, created_at
        ) VALUES (
          ${id},
          ${params.orgId},
          ${"composio_action"},
          ${`${params.tool}/${params.action} — ${params.agentId}`},
          ${params.notes ?? `Agent ${params.agentId} requested ${params.tool}/${params.action}`},
          ${params.riskLevel},
          ${Math.round(params.confidence * 100)},
          ${"pending"},
          ${JSON.stringify({
            agentId: params.agentId,
            tool: params.tool,
            action: params.action,
            entityId: params.entityId,
            inputParams: params.inputParams,
            source: "composio_adapter",
          })}::jsonb,
          NOW()
        )
      `,
    );
  } catch (err: any) {
    console.error("[ComposioAdapter] Failed to enqueue approval:", err.message);
  }
  return id;
}

// ─── Timeline logging helper ──────────────────────────────────────────────────

async function logTimelineEntry(params: {
  orgId: string;
  agentId: string;
  tool: string;
  action: string;
  status: string;
  requiresApproval: boolean;
  summary: string;
  errorMessage?: string;
}): Promise<void> {
  try {
    await db.insert(agentOperatingTimeline).values({
      orgId: params.orgId,
      agentName: params.agentId,
      systemName: "composio",
      actionType: "workflow_executed",
      actionStatus: params.status,
      communicationDomain: params.tool.toLowerCase(),
      summary: params.summary,
      requiresApproval: params.requiresApproval,
      approvalStatus: params.requiresApproval ? "pending" : undefined,
      errorMessage: params.errorMessage,
      executedAt: new Date(),
      metadata: { tool: params.tool, action: params.action, source: "composio" },
    });
  } catch (err: any) {
    console.error("[ComposioAdapter] Timeline log failed:", err.message);
  }
}

// ─── Communication log helper ─────────────────────────────────────────────────

async function logCommunicationEvent(params: {
  orgId: string;
  agentId: string;
  tool: string;
  action: string;
  recipientEmail?: string;
  notes?: string;
}): Promise<void> {
  try {
    const channel = params.tool === "SLACK" ? "slack" : "email";
    await db.insert(communicationLogs).values({
      orgId: params.orgId,
      type: `composio_${params.action.toLowerCase()}`,
      channel,
      recipientEmail: params.recipientEmail,
      subject: `Composio ${params.tool}/${params.action}`,
      messageBody: params.notes,
      status: "sent",
      provider: "composio",
    });
  } catch (err: any) {
    console.error("[ComposioAdapter] Comms log failed:", err.message);
  }
}
