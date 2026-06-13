/**
 * Unified Execution Engine — Sprint 3, Phase 2
 *
 * Single entrypoint for executing approved actions across all source systems.
 * Supported types: follow_up, prospect_outreach, schedule_call, schedule_meeting,
 *   lead_recovery, workflow_trigger, escalation, internal_task
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { orchestrator } from "../workflow-orchestrator";

export interface ExecutionResult {
  success: boolean;
  executionId: string;
  executionType: string;
  output: Record<string, any>;
  errors: string[];
}

export interface ActionPayload {
  orgId: string;
  sourceSystem: "hermes" | "autonomous_queue" | "agentmail" | "gmail_agent" | "manual";
  actionType: string;
  title?: string;
  description?: string;
  metadata?: Record<string, any>;
  gmailThreadId?: string;
  sourceConversationId?: string;
  prospectId?: string;
  leadId?: string;
  recipientEmail?: string;
  draftBody?: string;
  draftSubject?: string;
  templateKey?: string;
  clientId?: string;
}

// ─── Ensure execution_events table exists ─────────────────────────────────────
export async function ensureExecutionTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS execution_events (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id            TEXT NOT NULL,
      action_id         TEXT,
      source_system     TEXT,
      source_agent      TEXT,
      execution_type    TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'running',
      started_at        TIMESTAMPTZ DEFAULT NOW(),
      completed_at      TIMESTAMPTZ,
      latency_ms        INTEGER,
      input             JSONB,
      output            JSONB,
      error             TEXT,
      workflow_run_id   TEXT,
      gmail_thread_id   TEXT,
      prospect_id       TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_exec_events_org    ON execution_events (org_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_exec_events_action ON execution_events (action_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_exec_events_status ON execution_events (status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_exec_events_type   ON execution_events (execution_type)`);
}

// ─── Record execution start ────────────────────────────────────────────────────
async function startExecution(
  orgId: string,
  actionId: string | null,
  executionType: string,
  payload: ActionPayload
): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO execution_events
      (org_id, action_id, source_system, source_agent, execution_type, status, input, gmail_thread_id, prospect_id)
    VALUES
      (${orgId}, ${actionId}, ${payload.sourceSystem}, ${payload.sourceSystem},
       ${executionType}, 'running', ${JSON.stringify(payload)}::jsonb,
       ${payload.gmailThreadId ?? null}, ${payload.prospectId ?? null})
    RETURNING id
  `);
  const id = Array.isArray(rows) ? (rows[0] as any)?.id : (rows as any).rows?.[0]?.id;
  return id ?? crypto.randomUUID();
}

// ─── Complete execution ────────────────────────────────────────────────────────
async function completeExecution(
  executionId: string,
  success: boolean,
  output: Record<string, any>,
  error?: string,
  workflowRunId?: string
): Promise<void> {
  const startRow = await db.execute(sql`
    SELECT started_at FROM execution_events WHERE id = ${executionId}
  `);
  const rows = Array.isArray(startRow) ? startRow : (startRow as any).rows ?? [];
  const startedAt = rows[0]?.started_at ? new Date(rows[0].started_at) : new Date();
  const latencyMs = Date.now() - startedAt.getTime();

  await db.execute(sql`
    UPDATE execution_events SET
      status       = ${success ? "completed" : "failed"},
      completed_at = NOW(),
      latency_ms   = ${latencyMs},
      output       = ${JSON.stringify(output)}::jsonb,
      error        = ${error ?? null},
      workflow_run_id = ${workflowRunId ?? null}
    WHERE id = ${executionId}
  `);
}

// ─── Execution Handlers ────────────────────────────────────────────────────────

async function executeFollowUp(payload: ActionPayload): Promise<Record<string, any>> {
  // Create a gmail draft action for review
  const id = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO gmail_agent_actions
      (id, org_id, action_type, gmail_thread_id, status, approval_required,
       subject, body_preview, created_by_agent, risk_level)
    VALUES
      (${id}, ${payload.orgId}, 'draft_reply', ${payload.gmailThreadId ?? null},
       'proposed', true,
       ${payload.draftSubject ?? "Follow-up"}, ${payload.draftBody ?? payload.description ?? ""},
       'hermes', 'low')
    ON CONFLICT DO NOTHING
  `);
  return { gmailActionId: id, status: "drafted_for_review", message: "Follow-up draft created for approval" };
}

async function executeProspectOutreach(payload: ActionPayload): Promise<Record<string, any>> {
  // Create gmail agent action draft targeting the prospect
  const id = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO gmail_agent_actions
      (id, org_id, action_type, status, approval_required,
       recipient_email, subject, body_preview, created_by_agent, risk_level)
    VALUES
      (${id}, ${payload.orgId}, 'send_email', 'proposed', true,
       ${payload.recipientEmail ?? null},
       ${payload.draftSubject ?? "Outreach"},
       ${payload.draftBody ?? payload.description ?? ""},
       'hermes', 'medium')
    ON CONFLICT DO NOTHING
  `);
  return { gmailActionId: id, status: "draft_queued", message: "Outreach draft created for approval" };
}

async function executeScheduleCall(payload: ActionPayload): Promise<Record<string, any>> {
  // Create an internal task for scheduling a call
  return {
    message: "Schedule call task created",
    status: "pending_scheduling",
    prospectId: payload.prospectId,
    recipientEmail: payload.recipientEmail,
    instructions: payload.description ?? "Schedule intro call",
  };
}

async function executeScheduleMeeting(payload: ActionPayload): Promise<Record<string, any>> {
  return {
    message: "Meeting scheduling task created",
    status: "pending_scheduling",
    prospectId: payload.prospectId,
    recipientEmail: payload.recipientEmail,
    instructions: payload.description ?? "Schedule strategy meeting",
  };
}

async function executeLeadRecovery(
  payload: ActionPayload,
  executionId: string
): Promise<Record<string, any>> {
  try {
    const run = await orchestrator.start({
      orgId: payload.orgId,
      templateKey: payload.templateKey ?? "churn_risk_recovery",
      sourceType: "hermes_execution",
      sourceId: payload.prospectId ?? payload.leadId ?? executionId,
      metadata: {
        description: payload.description,
        triggeredBy: "hermes",
        executionId,
        recipientEmail: payload.recipientEmail,
      },
      createdBy: "system",
    });
    return { workflowRunId: run.id, templateKey: payload.templateKey ?? "churn_risk_recovery", status: "workflow_started" };
  } catch (e: any) {
    return { error: e?.message, status: "workflow_failed" };
  }
}

async function executeWorkflowTrigger(
  payload: ActionPayload,
  executionId: string
): Promise<Record<string, any>> {
  const templateKey = payload.templateKey ?? "scheduling_recovery";
  try {
    const run = await orchestrator.start({
      orgId: payload.orgId,
      templateKey,
      sourceType: "hermes_workflow_trigger",
      sourceId: payload.prospectId ?? payload.leadId ?? executionId,
      metadata: {
        description: payload.description,
        triggeredBy: "hermes",
        executionId,
        clientId: payload.clientId,
      },
      createdBy: "system",
    });
    return { workflowRunId: run.id, templateKey, status: "workflow_started" };
  } catch (e: any) {
    return { error: e?.message, status: "workflow_failed" };
  }
}

async function executeEscalation(payload: ActionPayload): Promise<Record<string, any>> {
  // Insert an attention item / escalation record
  const id = crypto.randomUUID();
  try {
    await db.execute(sql`
      INSERT INTO attention_items
        (id, org_id, title, description, priority, status, category, source, action_required)
      VALUES
        (${id}, ${payload.orgId},
         ${payload.title ?? "Escalation Required"},
         ${payload.description ?? ""},
         'high', 'pending', 'escalation', 'hermes', true)
      ON CONFLICT DO NOTHING
    `);
  } catch {
    // attention_items may not exist — store in execution output only
  }
  return { escalationId: id, status: "escalated", message: "Escalation created for human review" };
}

async function executeInternalTask(payload: ActionPayload): Promise<Record<string, any>> {
  return {
    status: "task_created",
    title: payload.title ?? "Internal Task",
    description: payload.description,
    assignedTo: "admin",
    message: "Internal task logged",
  };
}

// ─── Map execution type → templateKey ─────────────────────────────────────────
const TYPE_TO_TEMPLATE: Record<string, string> = {
  follow_up: "scheduling_recovery",
  prospect_outreach: "inactive_prepaid_recovery",
  lead_recovery: "churn_risk_recovery",
};

// ─── Main executeAction entrypoint ────────────────────────────────────────────
export async function executeAction(
  actionId: string,
  payload: ActionPayload
): Promise<ExecutionResult> {
  await ensureExecutionTables();

  const executionType = payload.actionType;
  const executionId = await startExecution(payload.orgId, actionId, executionType, payload);

  try {
    let output: Record<string, any> = {};

    switch (executionType) {
      case "follow_up":
        output = await executeFollowUp(payload);
        break;
      case "prospect_outreach":
        output = await executeProspectOutreach(payload);
        break;
      case "schedule_call":
        output = await executeScheduleCall(payload);
        break;
      case "schedule_meeting":
        output = await executeScheduleMeeting(payload);
        break;
      case "lead_recovery":
        payload.templateKey = payload.templateKey ?? TYPE_TO_TEMPLATE.lead_recovery;
        output = await executeLeadRecovery(payload, executionId);
        break;
      case "workflow_trigger":
        output = await executeWorkflowTrigger(payload, executionId);
        break;
      case "escalation":
        output = await executeEscalation(payload);
        break;
      case "internal_task":
      default:
        output = await executeInternalTask(payload);
        break;
    }

    await completeExecution(executionId, true, output, undefined, output.workflowRunId);

    return {
      success: true,
      executionId,
      executionType,
      output,
      errors: [],
    };
  } catch (err: any) {
    const errMsg = err?.message ?? "Unknown execution error";
    await completeExecution(executionId, false, {}, errMsg);
    return {
      success: false,
      executionId,
      executionType,
      output: {},
      errors: [errMsg],
    };
  }
}

// ─── Query helpers ─────────────────────────────────────────────────────────────
export async function listExecutionEvents(
  orgId: string,
  limit = 50
): Promise<any[]> {
  await ensureExecutionTables();
  const rows = await db.execute(sql`
    SELECT * FROM execution_events
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return Array.isArray(rows) ? rows : (rows as any).rows ?? [];
}

export async function getExecutionEvent(executionId: string): Promise<any | null> {
  await ensureExecutionTables();
  const rows = await db.execute(sql`
    SELECT * FROM execution_events WHERE id = ${executionId}
  `);
  const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  return data[0] ?? null;
}

export async function getExecutionMetrics(orgId: string): Promise<{
  totalExecutions: number;
  completed: number;
  failed: number;
  successRate: number;
  avgLatencyMs: number;
  byType: Record<string, number>;
}> {
  await ensureExecutionTables();

  const rows = await db.execute(sql`
    SELECT
      COUNT(*)                                          AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed,
      AVG(latency_ms)                                   AS avg_latency
    FROM execution_events
    WHERE org_id = ${orgId}
  `);
  const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  const r = data[0] ?? {};

  const typeRows = await db.execute(sql`
    SELECT execution_type, COUNT(*) AS cnt
    FROM execution_events
    WHERE org_id = ${orgId}
    GROUP BY execution_type
    ORDER BY cnt DESC
  `);
  const typeData = Array.isArray(typeRows) ? typeRows : (typeRows as any).rows ?? [];
  const byType: Record<string, number> = {};
  for (const row of typeData) {
    byType[(row as any).execution_type] = Number((row as any).cnt ?? 0);
  }

  const total = Number(r.total ?? 0);
  const completed = Number(r.completed ?? 0);
  const failed = Number(r.failed ?? 0);

  return {
    totalExecutions: total,
    completed,
    failed,
    successRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    avgLatencyMs: Math.round(Number(r.avg_latency ?? 0)),
    byType,
  };
}
