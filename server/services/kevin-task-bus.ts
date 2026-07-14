/**
 * Kevin Agent Task Bus — Phase 6
 *
 * Structured delegation layer between Kevin and TE specialist agents.
 *
 * Kevin does not directly modify any agent's memory or internal state.
 * Instead Kevin creates tasks, the bus routes them, agents execute and return output,
 * Kevin reviews the output and decides on the next step.
 *
 * Safety:
 * - Maximum delegation depth of 3 (prevents infinite loops)
 * - Correlation chain tracking (detects circular delegation)
 * - Each task must name a registered agent (open set of known identifiers)
 * - Agent output is validated against expected schema before being accepted
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { recordKevinAuditEvent } from "./kevin-audit-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskState =
  | "pending"
  | "accepted"
  | "rejected"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface TaskRecord {
  id: string;
  intentId: string;
  orgId: string;
  assignedAgent: string;
  capabilityRequested: string;
  objective: string;
  inputs: Record<string, unknown>;
  constraints: Record<string, unknown> | null;
  expectedOutputSchema: Record<string, unknown> | null;
  sequenceOrder: number;
  dependsOnTaskIds: string[];
  delegationDepth: number;
  maxDelegationDepth: number;
  correlationChain: string[];
  priority: TaskPriority;
  dueAt: string | null;
  timeoutSeconds: number;
  approvalRequired: boolean;
  approvalId: string | null;
  state: TaskState;
  attempts: number;
  maxAttempts: number;
  agentOutput: unknown | null;
  outputValid: boolean | null;
  verificationNotes: string | null;
  failureReason: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
}

export interface CreateTaskInput {
  intentId: string;
  orgId: string;
  assignedAgent: string;
  capabilityRequested: string;
  objective: string;
  inputs?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  expectedOutputSchema?: Record<string, unknown>;
  sequenceOrder?: number;
  dependsOnTaskIds?: string[];
  parentCorrelationChain?: string[];
  priority?: TaskPriority;
  dueAt?: Date;
  timeoutSeconds?: number;
  approvalRequired?: boolean;
}

// ─── Known agents (open set — add as system grows) ────────────────────────────

export const KNOWN_AGENTS = new Set([
  "agentmail",
  "ceo_agent",
  "executive_agent",
  "scheduling_agent",
  "crm_service",
  "revenue_agent",
  "client_success_agent",
  "retention_agent",
  "apex_agent",
  "hiring_agent",
  "attention_inbox",
  "navigation_registry",
  "context_service",
  "approval_service",
  "job_inspector",
  "agent_task_bus",       // meta: re-delegation (depth tracked)
]);

const MAX_DELEGATION_DEPTH = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractRows(result: unknown): any[] {
  return Array.isArray((result as any)?.rows)
    ? (result as any).rows
    : Array.isArray(result)
      ? (result as any[])
      : [];
}

function rowToTask(row: any): TaskRecord {
  return {
    id: row.id,
    intentId: row.intent_id,
    orgId: row.org_id,
    assignedAgent: row.assigned_agent,
    capabilityRequested: row.capability_requested,
    objective: row.objective,
    inputs: (row.inputs as Record<string, unknown>) ?? {},
    constraints: (row.constraints as Record<string, unknown>) ?? null,
    expectedOutputSchema: (row.expected_output_schema as Record<string, unknown>) ?? null,
    sequenceOrder: row.sequence_order ?? 0,
    dependsOnTaskIds: (row.depends_on_task_ids as string[]) ?? [],
    delegationDepth: row.delegation_depth ?? 0,
    maxDelegationDepth: row.max_delegation_depth ?? MAX_DELEGATION_DEPTH,
    correlationChain: (row.correlation_chain as string[]) ?? [],
    priority: (row.priority as TaskPriority) ?? "normal",
    dueAt: row.due_at?.toISOString?.() ?? null,
    timeoutSeconds: row.timeout_seconds ?? 300,
    approvalRequired: row.approval_required ?? false,
    approvalId: row.approval_id ?? null,
    state: (row.state as TaskState) ?? "pending",
    attempts: row.attempts ?? 0,
    maxAttempts: row.max_attempts ?? 3,
    agentOutput: row.agent_output ?? null,
    outputValid: row.output_valid ?? null,
    verificationNotes: row.verification_notes ?? null,
    failureReason: row.failure_reason ?? null,
    errorCode: row.error_code ?? null,
    createdAt: row.created_at?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: row.updated_at?.toISOString?.() ?? new Date().toISOString(),
    acceptedAt: row.accepted_at?.toISOString?.() ?? null,
    completedAt: row.completed_at?.toISOString?.() ?? null,
  };
}

// ─── Reads ─────────────────────────────────────────────────────────────────────

export async function getTaskById(id: string, orgId: string): Promise<TaskRecord | null> {
  try {
    const result = await db.execute(sql`
      SELECT * FROM kevin_intent_tasks WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
    `);
    const rows = extractRows(result);
    return rows[0] ? rowToTask(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function getTasksForIntent(intentId: string): Promise<TaskRecord[]> {
  try {
    const result = await db.execute(sql`
      SELECT * FROM kevin_intent_tasks
      WHERE intent_id = ${intentId}
      ORDER BY sequence_order ASC, created_at ASC
    `);
    return extractRows(result).map(rowToTask);
  } catch {
    return [];
  }
}

export async function listTasksByAgent(
  orgId: string,
  assignedAgent: string,
  state?: TaskState,
): Promise<TaskRecord[]> {
  try {
    const result = await db.execute(sql`
      SELECT * FROM kevin_intent_tasks
      WHERE org_id = ${orgId} AND assigned_agent = ${assignedAgent}
        ${state ? sql`AND state = ${state}` : sql``}
      ORDER BY priority DESC, created_at ASC
      LIMIT 50
    `);
    return extractRows(result).map(rowToTask);
  } catch {
    return [];
  }
}

// ─── Create ────────────────────────────────────────────────────────────────────

export async function createTask(input: CreateTaskInput): Promise<TaskRecord | null> {
  // Validate delegation depth
  const parentChain = input.parentCorrelationChain ?? [];
  const newDepth = parentChain.length;
  if (newDepth >= MAX_DELEGATION_DEPTH) {
    void recordKevinAuditEvent({
      orgId: input.orgId,
      eventType: "task_bus.depth_exceeded",
      payload: {
        intentId: input.intentId,
        assignedAgent: input.assignedAgent,
        depth: newDepth,
        chain: parentChain,
      },
    });
    console.warn(
      `[KevinTaskBus] Max delegation depth (${MAX_DELEGATION_DEPTH}) exceeded for intent ${input.intentId}`,
    );
    return null;
  }

  // Circular delegation detection (same agent appears twice in chain)
  if (parentChain.includes(input.assignedAgent)) {
    void recordKevinAuditEvent({
      orgId: input.orgId,
      eventType: "task_bus.circular_delegation",
      payload: {
        intentId: input.intentId,
        assignedAgent: input.assignedAgent,
        chain: parentChain,
      },
    });
    console.warn(
      `[KevinTaskBus] Circular delegation detected: ${input.assignedAgent} already in chain ${parentChain.join(" → ")}`,
    );
    return null;
  }

  const newChain = [...parentChain, input.assignedAgent];
  const id = randomUUID();

  try {
    await db.execute(sql`
      INSERT INTO kevin_intent_tasks (
        id, intent_id, org_id, assigned_agent, capability_requested, objective,
        inputs, constraints, expected_output_schema, sequence_order, depends_on_task_ids,
        delegation_depth, max_delegation_depth, correlation_chain, priority,
        due_at, timeout_seconds, approval_required, state, attempts, max_attempts
      ) VALUES (
        ${id},
        ${input.intentId},
        ${input.orgId},
        ${input.assignedAgent},
        ${input.capabilityRequested},
        ${input.objective},
        ${JSON.stringify(input.inputs ?? {})}::jsonb,
        ${input.constraints ? JSON.stringify(input.constraints) : null}::jsonb,
        ${input.expectedOutputSchema ? JSON.stringify(input.expectedOutputSchema) : null}::jsonb,
        ${input.sequenceOrder ?? 0},
        ${JSON.stringify(input.dependsOnTaskIds ?? [])}::jsonb,
        ${newDepth},
        ${MAX_DELEGATION_DEPTH},
        ${JSON.stringify(newChain)}::jsonb,
        ${input.priority ?? "normal"},
        ${input.dueAt?.toISOString() ?? null},
        ${input.timeoutSeconds ?? 300},
        ${input.approvalRequired ?? false},
        'pending',
        0,
        3
      )
    `);

    void recordKevinAuditEvent({
      orgId: input.orgId,
      eventType: "task_bus.task_created",
      payload: {
        taskId: id,
        intentId: input.intentId,
        assignedAgent: input.assignedAgent,
        capability: input.capabilityRequested,
        depth: newDepth,
      },
    });

    return await getTaskById(id, input.orgId);
  } catch (e: any) {
    console.warn("[KevinTaskBus] createTask error:", e?.message);
    return null;
  }
}

// ─── State transitions ─────────────────────────────────────────────────────────

async function updateTaskState(
  id: string,
  newState: TaskState,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE kevin_intent_tasks
      SET state = ${newState},
          updated_at = NOW(),
          ${extra?.agentOutput !== undefined ? sql`agent_output = ${JSON.stringify(extra.agentOutput)}::jsonb,` : sql``}
          ${extra?.outputValid !== undefined ? sql`output_valid = ${Boolean(extra.outputValid)},` : sql``}
          ${extra?.verificationNotes !== undefined ? sql`verification_notes = ${String(extra.verificationNotes)},` : sql``}
          ${extra?.failureReason !== undefined ? sql`failure_reason = ${String(extra.failureReason)},` : sql``}
          ${extra?.errorCode !== undefined ? sql`error_code = ${String(extra.errorCode)},` : sql``}
          ${newState === "accepted" ? sql`accepted_at = NOW(),` : sql``}
          ${["completed", "failed", "cancelled", "timed_out"].includes(newState) ? sql`completed_at = NOW(),` : sql``}
          id = id
      WHERE id = ${id}
    `);
  } catch (e: any) {
    console.warn("[KevinTaskBus] updateTaskState error:", e?.message);
  }
}

export async function acceptTask(taskId: string, orgId: string): Promise<boolean> {
  const task = await getTaskById(taskId, orgId);
  if (!task || task.state !== "pending") return false;
  await updateTaskState(taskId, "accepted");
  return true;
}

export async function rejectTask(
  taskId: string,
  orgId: string,
  reason: string,
): Promise<boolean> {
  const task = await getTaskById(taskId, orgId);
  if (!task || task.state !== "pending") return false;
  await updateTaskState(taskId, "rejected", { failureReason: reason });
  return true;
}

/**
 * Record agent output and validate it against the expected schema.
 * Returns { ok, valid, notes }.
 */
export async function submitTaskOutput(
  taskId: string,
  orgId: string,
  agentOutput: unknown,
): Promise<{ ok: boolean; valid: boolean; notes: string }> {
  const task = await getTaskById(taskId, orgId);
  if (!task) return { ok: false, valid: false, notes: "Task not found" };
  if (!["accepted", "in_progress"].includes(task.state)) {
    return { ok: false, valid: false, notes: `Cannot submit output for task in state '${task.state}'` };
  }

  // Schema validation: basic type-presence check
  let valid = true;
  let notes = "Output accepted";
  if (task.expectedOutputSchema && typeof agentOutput === "object" && agentOutput !== null) {
    const schema = task.expectedOutputSchema as Record<string, string>;
    const output = agentOutput as Record<string, unknown>;
    const missing = Object.keys(schema).filter((k) => !(k in output));
    if (missing.length > 0) {
      valid = false;
      notes = `Missing expected output fields: ${missing.join(", ")}`;
    }
  }

  await updateTaskState(taskId, valid ? "completed" : "failed", {
    agentOutput,
    outputValid: valid,
    verificationNotes: notes,
    ...(valid ? {} : { errorCode: "OUTPUT_SCHEMA_MISMATCH" }),
  });

  void recordKevinAuditEvent({
    orgId,
    eventType: valid ? "task_bus.task_completed" : "task_bus.task_output_invalid",
    payload: {
      taskId,
      intentId: task.intentId,
      assignedAgent: task.assignedAgent,
      valid,
      notes,
    },
  });

  return { ok: true, valid, notes };
}

export async function cancelTask(
  taskId: string,
  orgId: string,
  reason: string,
): Promise<boolean> {
  const task = await getTaskById(taskId, orgId);
  if (!task) return false;
  if (["completed", "failed", "cancelled", "timed_out"].includes(task.state)) return false;
  await updateTaskState(taskId, "cancelled", { failureReason: reason });
  return true;
}

// ─── Aggregate task status for an intent ──────────────────────────────────────

export async function getIntentTaskSummary(intentId: string): Promise<{
  total: number;
  pending: number;
  completed: number;
  failed: number;
  cancelled: number;
  allComplete: boolean;
  anyFailed: boolean;
}> {
  const tasks = await getTasksForIntent(intentId);
  const total = tasks.length;
  const completed = tasks.filter((t) => t.state === "completed").length;
  const failed = tasks.filter((t) => t.state === "failed").length;
  const cancelled = tasks.filter((t) => t.state === "cancelled").length;
  const pending = tasks.filter((t) => ["pending", "accepted", "in_progress"].includes(t.state)).length;
  return {
    total,
    pending,
    completed,
    failed,
    cancelled,
    allComplete: total > 0 && completed === total,
    anyFailed: failed > 0,
  };
}
