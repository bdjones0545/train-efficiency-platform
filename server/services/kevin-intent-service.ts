/**
 * Kevin Intent Service — Phase 5
 *
 * Durable, database-backed intent lifecycle manager.
 *
 * An intent represents Kevin's executive goal. Tasks are the execution units.
 * State machine: received → validating → planned → awaiting_approval → queued
 *                → executing → verifying → completed | partially_completed
 *                | failed | cancelled | dead_lettered
 *
 * All state is persisted to the DB — process restarts do not lose intent state.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { recordKevinAuditEvent } from "./kevin-audit-service";
import {
  evaluateKevinPolicy,
  type PolicyContext,
  type PolicyResult,
} from "./kevin-policy-engine";
import { getCapabilityDefinition } from "./kevin-capability-registry";
import { getIntentTaskSummary } from "./kevin-task-bus";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntentState =
  | "received"
  | "validating"
  | "planned"
  | "awaiting_approval"
  | "queued"
  | "executing"
  | "verifying"
  | "completed"
  | "partially_completed"
  | "failed"
  | "cancelled"
  | "dead_lettered";

export interface IntentRecord {
  id: string;
  orgId: string;
  requestId: string;
  idempotencyKey: string;
  correlationId: string | null;
  parentIntentId: string | null;
  initiatedByUserId: string | null;
  kevinIdentity: string;
  capabilityKey: string;
  goal: string;
  reason: string | null;
  expectedResult: string | null;
  structuredArgs: Record<string, unknown>;
  confidence: number | null;
  sourceContext: unknown | null;
  requestedMode: string;
  grantedMode: string | null;
  state: IntentState;
  stateHistory: Array<{ state: string; at: string; reason?: string }>;
  policyResult: unknown | null;
  approvalId: string | null;
  approvalRequired: boolean;
  executionPlan: unknown | null;
  executorAgent: string | null;
  attempts: number;
  maxAttempts: number;
  output: unknown | null;
  verificationResult: unknown | null;
  failureReason: string | null;
  partialResults: unknown | null;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface CreateIntentInput {
  orgId: string;
  requestId?: string;
  idempotencyKey?: string;
  correlationId?: string;
  parentIntentId?: string;
  initiatedByUserId?: string;
  kevinIdentity?: string;
  capabilityKey: string;
  goal: string;
  reason?: string;
  expectedResult?: string;
  structuredArgs?: Record<string, unknown>;
  confidence?: number;
  sourceContext?: Record<string, unknown>;
  requestedMode?: string;
  expiresInSeconds?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractRows(result: unknown): any[] {
  return Array.isArray((result as any)?.rows)
    ? (result as any).rows
    : Array.isArray(result)
      ? (result as any[])
      : [];
}

function rowToIntent(row: any): IntentRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id ?? null,
    parentIntentId: row.parent_intent_id ?? null,
    initiatedByUserId: row.initiated_by_user_id ?? null,
    kevinIdentity: row.kevin_identity ?? "kevin",
    capabilityKey: row.capability_key,
    goal: row.goal,
    reason: row.reason ?? null,
    expectedResult: row.expected_result ?? null,
    structuredArgs: (row.structured_args as Record<string, unknown>) ?? {},
    confidence: row.confidence !== null ? Number(row.confidence) : null,
    sourceContext: row.source_context ?? null,
    requestedMode: row.requested_mode ?? "recommend",
    grantedMode: row.granted_mode ?? null,
    state: (row.state as IntentState) ?? "received",
    stateHistory: (row.state_history as any[]) ?? [],
    policyResult: row.policy_result ?? null,
    approvalId: row.approval_id ?? null,
    approvalRequired: row.approval_required ?? false,
    executionPlan: row.execution_plan ?? null,
    executorAgent: row.executor_agent ?? null,
    attempts: row.attempts ?? 0,
    maxAttempts: row.max_attempts ?? 3,
    output: row.output ?? null,
    verificationResult: row.verification_result ?? null,
    failureReason: row.failure_reason ?? null,
    partialResults: row.partial_results ?? null,
    createdAt: row.created_at?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: row.updated_at?.toISOString?.() ?? new Date().toISOString(),
    queuedAt: row.queued_at?.toISOString?.() ?? null,
    startedAt: row.started_at?.toISOString?.() ?? null,
    completedAt: row.completed_at?.toISOString?.() ?? null,
    expiresAt: row.expires_at?.toISOString?.() ?? null,
  };
}

// ─── Table bootstrap ───────────────────────────────────────────────────────────

let _tablesEnsured = false;

export async function ensureIntentTables(): Promise<void> {
  if (_tablesEnsured) return;
  try {
    // Run migration 0003 inline (idempotent)
    const migrationSql = await import("fs").then(
      async (fs) => {
        const path = await import("path");
        const filePath = path.resolve(process.cwd(), "migrations/0003_kevin_intent_tables.sql");
        return fs.promises.readFile(filePath, "utf8");
      }
    );
    // Execute each statement block individually
    const statements = migrationSql
      .split(/;[\s]*(?=--|\s*$|\s*DO\s*\$\$|\s*CREATE)/gm)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 5);

    for (const stmt of statements) {
      try {
        await db.execute(sql.raw(stmt + (stmt.endsWith("$$") ? "" : ";")));
      } catch {}
    }
    _tablesEnsured = true;
  } catch (e: any) {
    // Fallback: create tables directly if migration file is unavailable
    try {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE kevin_intent_state AS ENUM (
            'received','validating','planned','awaiting_approval','queued',
            'executing','verifying','completed','partially_completed',
            'failed','cancelled','dead_lettered'
          );
        EXCEPTION WHEN duplicate_object THEN NULL; END $$
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS kevin_intents (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          org_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          correlation_id TEXT,
          parent_intent_id TEXT,
          initiated_by_user_id TEXT,
          kevin_identity TEXT NOT NULL DEFAULT 'kevin',
          capability_key TEXT NOT NULL,
          goal TEXT NOT NULL,
          reason TEXT,
          expected_result TEXT,
          structured_args JSONB NOT NULL DEFAULT '{}',
          confidence NUMERIC(3,2),
          source_context JSONB,
          requested_mode TEXT NOT NULL DEFAULT 'recommend',
          granted_mode TEXT,
          state kevin_intent_state NOT NULL DEFAULT 'received',
          state_history JSONB NOT NULL DEFAULT '[]',
          policy_result JSONB,
          approval_id TEXT,
          approval_required BOOLEAN NOT NULL DEFAULT false,
          execution_plan JSONB,
          executor_agent TEXT,
          attempts INT NOT NULL DEFAULT 0,
          max_attempts INT NOT NULL DEFAULT 3,
          output JSONB,
          verification_result JSONB,
          failure_reason TEXT,
          partial_results JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          queued_at TIMESTAMPTZ,
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ,
          CONSTRAINT uq_kevin_intent_idempotency UNIQUE (org_id, idempotency_key)
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_kevin_intents_org_state
        ON kevin_intents (org_id, state, created_at DESC)
      `);
      _tablesEnsured = true;
    } catch (e2: any) {
      console.warn("[KevinIntents] ensureIntentTables fallback error:", e2?.message);
    }
  }
}

// ─── Reads ─────────────────────────────────────────────────────────────────────

export async function getIntentById(id: string, orgId: string): Promise<IntentRecord | null> {
  try {
    const result = await db.execute(sql`
      SELECT * FROM kevin_intents WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
    `);
    const rows = extractRows(result);
    return rows[0] ? rowToIntent(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function getIntentByIdempotencyKey(
  orgId: string,
  key: string,
): Promise<IntentRecord | null> {
  try {
    const result = await db.execute(sql`
      SELECT * FROM kevin_intents WHERE org_id = ${orgId} AND idempotency_key = ${key} LIMIT 1
    `);
    const rows = extractRows(result);
    return rows[0] ? rowToIntent(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function listIntents(
  orgId: string,
  opts?: {
    state?: IntentState | IntentState[];
    capabilityKey?: string;
    limit?: number;
    offset?: number;
  },
): Promise<IntentRecord[]> {
  const limit = Math.min(opts?.limit ?? 30, 100);
  const offset = Math.max(opts?.offset ?? 0, 0);
  try {
    const states = opts?.state
      ? Array.isArray(opts.state)
        ? opts.state
        : [opts.state]
      : null;
    const result = await db.execute(sql`
      SELECT * FROM kevin_intents
      WHERE org_id = ${orgId}
        ${states ? sql`AND state = ANY(${sql.raw(`ARRAY[${states.map((s) => `'${s}'`).join(",")}]`)})` : sql``}
        ${opts?.capabilityKey ? sql`AND capability_key = ${opts.capabilityKey}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return extractRows(result).map(rowToIntent);
  } catch {
    return [];
  }
}

export async function countIntentsByState(orgId: string): Promise<Record<string, number>> {
  try {
    const result = await db.execute(sql`
      SELECT state, COUNT(*) as count
      FROM kevin_intents
      WHERE org_id = ${orgId}
      GROUP BY state
    `);
    const rows = extractRows(result);
    const out: Record<string, number> = {};
    for (const row of rows) {
      out[row.state] = Number(row.count);
    }
    return out;
  } catch {
    return {};
  }
}

// ─── State transitions ─────────────────────────────────────────────────────────

async function transitionState(
  id: string,
  orgId: string,
  newState: IntentState,
  extra?: {
    grantedMode?: string;
    approvalId?: string;
    approvalRequired?: boolean;
    policyResult?: unknown;
    executionPlan?: unknown;
    executorAgent?: string;
    output?: unknown;
    verificationResult?: unknown;
    failureReason?: string;
    partialResults?: unknown;
  },
): Promise<void> {
  try {
    const existing = await getIntentById(id, orgId);
    if (!existing) return;

    const historyEntry = {
      from: existing.state,
      to: newState,
      at: new Date().toISOString(),
    };
    const newHistory = [...existing.stateHistory, historyEntry];

    const now = new Date();
    const queuedAt = newState === "queued" ? now : undefined;
    const startedAt = newState === "executing" ? now : undefined;
    const completedAt = ["completed", "partially_completed", "failed", "cancelled", "dead_lettered"].includes(newState) ? now : undefined;

    await db.execute(sql`
      UPDATE kevin_intents SET
        state = ${newState},
        state_history = ${JSON.stringify(newHistory)}::jsonb,
        updated_at = ${now},
        ${extra?.grantedMode !== undefined ? sql`granted_mode = ${extra.grantedMode},` : sql``}
        ${extra?.approvalId !== undefined ? sql`approval_id = ${extra.approvalId},` : sql``}
        ${extra?.approvalRequired !== undefined ? sql`approval_required = ${extra.approvalRequired},` : sql``}
        ${extra?.policyResult !== undefined ? sql`policy_result = ${JSON.stringify(extra.policyResult)}::jsonb,` : sql``}
        ${extra?.executionPlan !== undefined ? sql`execution_plan = ${JSON.stringify(extra.executionPlan)}::jsonb,` : sql``}
        ${extra?.executorAgent !== undefined ? sql`executor_agent = ${extra.executorAgent},` : sql``}
        ${extra?.output !== undefined ? sql`output = ${JSON.stringify(extra.output)}::jsonb,` : sql``}
        ${extra?.verificationResult !== undefined ? sql`verification_result = ${JSON.stringify(extra.verificationResult)}::jsonb,` : sql``}
        ${extra?.failureReason !== undefined ? sql`failure_reason = ${extra.failureReason},` : sql``}
        ${extra?.partialResults !== undefined ? sql`partial_results = ${JSON.stringify(extra.partialResults)}::jsonb,` : sql``}
        ${queuedAt ? sql`queued_at = ${queuedAt},` : sql``}
        ${startedAt ? sql`started_at = ${startedAt},` : sql``}
        ${completedAt ? sql`completed_at = ${completedAt},` : sql``}
        id = id
      WHERE id = ${id} AND org_id = ${orgId}
    `);
  } catch (e: any) {
    console.warn("[KevinIntents] transitionState error:", e?.message);
  }
}

// ─── Create ────────────────────────────────────────────────────────────────────

/**
 * Create a new intent and immediately run it through the policy engine.
 * Returns the created intent or an existing one if idempotency key matches.
 */
export async function createIntent(
  input: CreateIntentInput,
): Promise<{ intent: IntentRecord; policyResult: PolicyResult; isNew: boolean }> {
  await ensureIntentTables();

  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const requestId = input.requestId ?? randomUUID();

  // Idempotency check
  if (input.idempotencyKey) {
    const existing = await getIntentByIdempotencyKey(input.orgId, idempotencyKey);
    if (existing) {
      const capDef = getCapabilityDefinition(existing.capabilityKey);
      return {
        intent: existing,
        isNew: false,
        policyResult: {
          decision: "execute",
          requiresApproval: existing.approvalRequired,
          capabilityEnabled: true,
          orgActiveStatus: "active",
          riskLevel: capDef?.riskLevel ?? "medium",
          appliedChecks: ["idempotency_return"],
          meta: { existingIntentId: existing.id },
        },
      };
    }
  }

  // Evaluate policy
  const policyCtx: PolicyContext = {
    orgId: input.orgId,
    userId: input.initiatedByUserId,
    kevinIdentity: input.kevinIdentity ?? "kevin",
    capabilityKey: input.capabilityKey,
    requestedMode: (input.requestedMode ?? "recommend") as any,
    idempotencyKey,
  };
  const policy = await evaluateKevinPolicy(policyCtx);

  // Create the intent record
  const id = randomUUID();
  const capDef = getCapabilityDefinition(input.capabilityKey);
  const expiresAt = input.expiresInSeconds
    ? new Date(Date.now() + input.expiresInSeconds * 1000)
    : capDef
      ? new Date(Date.now() + capDef.timeoutSeconds * 1000 * 10) // 10× timeout as intent expiry
      : new Date(Date.now() + 3600_000); // default 1 hour

  try {
    await db.execute(sql`
      INSERT INTO kevin_intents (
        id, org_id, request_id, idempotency_key, correlation_id, parent_intent_id,
        initiated_by_user_id, kevin_identity, capability_key, goal, reason,
        expected_result, structured_args, confidence, source_context,
        requested_mode, granted_mode, state, state_history, policy_result,
        approval_required, expires_at
      ) VALUES (
        ${id}, ${input.orgId}, ${requestId}, ${idempotencyKey},
        ${input.correlationId ?? null}, ${input.parentIntentId ?? null},
        ${input.initiatedByUserId ?? null}, ${input.kevinIdentity ?? "kevin"},
        ${input.capabilityKey}, ${input.goal}, ${input.reason ?? null},
        ${input.expectedResult ?? null},
        ${JSON.stringify(input.structuredArgs ?? {})}::jsonb,
        ${input.confidence ?? null},
        ${input.sourceContext ? JSON.stringify(input.sourceContext) : null}::jsonb,
        ${input.requestedMode ?? "recommend"},
        ${policy.grantedMode ?? null},
        'received',
        ${JSON.stringify([{ state: "received", at: new Date().toISOString() }])}::jsonb,
        ${JSON.stringify(policy)}::jsonb,
        ${policy.requiresApproval},
        ${expiresAt}
      )
    `);
  } catch (e: any) {
    // Could be a race on unique constraint
    if (e?.message?.includes("uq_kevin_intent_idempotency")) {
      const existing = await getIntentByIdempotencyKey(input.orgId, idempotencyKey);
      if (existing) {
        return { intent: existing, policyResult: policy, isNew: false };
      }
    }
    throw e;
  }

  const intent = (await getIntentById(id, input.orgId))!;

  // Immediately transition to next state based on policy
  if (policy.decision === "denied") {
    await transitionState(id, input.orgId, "failed", {
      failureReason: `Policy denied: ${policy.denialCode} — ${policy.denialReason}`,
      policyResult: policy,
    });
  } else if (policy.requiresApproval) {
    await transitionState(id, input.orgId, "awaiting_approval", {
      policyResult: policy,
      grantedMode: policy.grantedMode,
      approvalRequired: true,
    });
  } else {
    await transitionState(id, input.orgId, "planned", {
      policyResult: policy,
      grantedMode: policy.grantedMode,
    });
  }

  void recordKevinAuditEvent({
    orgId: input.orgId,
    userId: input.initiatedByUserId ?? null,
    eventType: "intent.created",
    payload: {
      intentId: id,
      capabilityKey: input.capabilityKey,
      requestedMode: input.requestedMode ?? "recommend",
      policyDecision: policy.decision,
      approvalRequired: policy.requiresApproval,
    },
  });

  const updated = (await getIntentById(id, input.orgId)) ?? intent;
  return { intent: updated, policyResult: policy, isNew: true };
}

// ─── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelIntent(
  id: string,
  orgId: string,
  reason: string,
): Promise<boolean> {
  const intent = await getIntentById(id, orgId);
  if (!intent) return false;
  if (["completed", "failed", "cancelled", "dead_lettered"].includes(intent.state)) return false;

  await transitionState(id, orgId, "cancelled", { failureReason: reason });

  void recordKevinAuditEvent({
    orgId,
    eventType: "intent.cancelled",
    payload: { intentId: id, reason: reason.slice(0, 300) },
  });

  return true;
}

// ─── Mark approval received ────────────────────────────────────────────────────

export async function approveIntent(
  id: string,
  orgId: string,
  approvalId: string,
): Promise<boolean> {
  const intent = await getIntentById(id, orgId);
  if (!intent || intent.state !== "awaiting_approval") return false;

  await transitionState(id, orgId, "queued", { approvalId, queuedAt: new Date() } as any);
  return true;
}

export async function rejectIntent(
  id: string,
  orgId: string,
  approvalId: string,
  reason: string,
): Promise<boolean> {
  const intent = await getIntentById(id, orgId);
  if (!intent || intent.state !== "awaiting_approval") return false;

  await transitionState(id, orgId, "failed", { approvalId, failureReason: `Approval rejected: ${reason}` });
  return true;
}

// ─── Mark complete / failed ────────────────────────────────────────────────────

export async function completeIntent(
  id: string,
  orgId: string,
  output: unknown,
  verificationResult?: unknown,
): Promise<void> {
  const taskSummary = await getIntentTaskSummary(id);
  const finalState = taskSummary.anyFailed && taskSummary.completed > 0
    ? "partially_completed"
    : "completed";
  await transitionState(id, orgId, finalState, { output, verificationResult });
}

export async function failIntent(
  id: string,
  orgId: string,
  reason: string,
  partialResults?: unknown,
): Promise<void> {
  const intent = await getIntentById(id, orgId);
  if (!intent) return;
  if (intent.attempts + 1 >= intent.maxAttempts) {
    await transitionState(id, orgId, "dead_lettered", { failureReason: reason, partialResults });
  } else {
    await db.execute(sql`
      UPDATE kevin_intents SET attempts = attempts + 1, updated_at = NOW() WHERE id = ${id}
    `);
    await transitionState(id, orgId, "failed", { failureReason: reason, partialResults });
  }
}

// ─── Statistics ────────────────────────────────────────────────────────────────

export async function getIntentStats(orgId: string): Promise<{
  total: number;
  byState: Record<string, number>;
  byCapability: Record<string, number>;
  completionRate: number;
  avgTasksPerIntent: number;
}> {
  try {
    const byState = await countIntentsByState(orgId);
    const total = Object.values(byState).reduce((a, b) => a + b, 0);
    const completed = (byState["completed"] ?? 0) + (byState["partially_completed"] ?? 0);
    const completionRate = total > 0 ? Math.round((completed / total) * 100) / 100 : 0;

    const capResult = await db.execute(sql`
      SELECT capability_key, COUNT(*) as count
      FROM kevin_intents WHERE org_id = ${orgId}
      GROUP BY capability_key ORDER BY count DESC LIMIT 10
    `);
    const byCapability: Record<string, number> = {};
    for (const row of extractRows(capResult)) {
      byCapability[row.capability_key] = Number(row.count);
    }

    return { total, byState, byCapability, completionRate, avgTasksPerIntent: 0 };
  } catch {
    return { total: 0, byState: {}, byCapability: {}, completionRate: 0, avgTasksPerIntent: 0 };
  }
}
