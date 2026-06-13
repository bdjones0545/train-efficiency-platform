/**
 * Cross-Agent Coordination Service — Sprint 3, Phase 4
 *
 * Before any agent creates a new action, it should call checkCoordination().
 * If a duplicate exists (same thread/prospect/lead + action_type), the service
 * merges the request and returns the existing action so work is not duplicated.
 *
 * Stores every decision in `coordination_decisions` for audit.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface CoordinationRequest {
  orgId: string;
  actionType: string;
  gmailThreadId?: string;
  sourceConversationId?: string;
  prospectId?: string;
  leadId?: string;
  agentName?: string;
  metadata?: Record<string, any>;
}

export type CoordinationDecision =
  | { action: "created"; actionId: null }
  | { action: "deduplicated"; actionId: string; supportScore: number }
  | { action: "merged"; actionId: string; supportScore: number };

// ─── Ensure tables ─────────────────────────────────────────────────────────────
export async function ensureCoordinationTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS coordination_decisions (
      id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id                TEXT NOT NULL,
      action_type           TEXT NOT NULL,
      gmail_thread_id       TEXT,
      source_conversation_id TEXT,
      prospect_id           TEXT,
      lead_id               TEXT,
      decision              TEXT NOT NULL,
      original_action_id    TEXT,
      merged_action_id      TEXT,
      support_score         INTEGER DEFAULT 1,
      requesting_agent      TEXT,
      metadata              JSONB,
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_coord_org       ON coordination_decisions (org_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_coord_thread    ON coordination_decisions (gmail_thread_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_coord_prospect  ON coordination_decisions (prospect_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_coord_type      ON coordination_decisions (action_type)`);

  // Table for tracking pending actions across agents (lightweight dedup index)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_action_registry (
      id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id                TEXT NOT NULL,
      action_type           TEXT NOT NULL,
      gmail_thread_id       TEXT,
      source_conversation_id TEXT,
      prospect_id           TEXT,
      lead_id               TEXT,
      status                TEXT NOT NULL DEFAULT 'active',
      support_score         INTEGER DEFAULT 1,
      source_agents         TEXT[] DEFAULT ARRAY[]::TEXT[],
      last_agent            TEXT,
      source_action_id      TEXT,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      updated_at            TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_aar_org_type ON agent_action_registry (org_id, action_type)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_aar_thread   ON agent_action_registry (gmail_thread_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_aar_prospect ON agent_action_registry (prospect_id)`);
}

// ─── Find duplicate in registry ───────────────────────────────────────────────
async function findDuplicate(req: CoordinationRequest): Promise<any | null> {
  const conditions: string[] = [`org_id = '${req.orgId}'`, `action_type = '${req.actionType}'`, `status = 'active'`];
  if (req.gmailThreadId)       conditions.push(`gmail_thread_id = '${req.gmailThreadId}'`);
  if (req.sourceConversationId) conditions.push(`source_conversation_id = '${req.sourceConversationId}'`);
  if (req.prospectId)          conditions.push(`prospect_id = '${req.prospectId}'`);
  if (req.leadId)              conditions.push(`lead_id = '${req.leadId}'`);

  if (conditions.length <= 3) return null; // No specific identifier — can't deduplicate

  const whereClause = conditions.join(" AND ");
  try {
    const rows = await db.execute(sql.raw(`
      SELECT * FROM agent_action_registry
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT 1
    `));
    const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return data[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Register new action ───────────────────────────────────────────────────────
async function registerAction(
  req: CoordinationRequest,
  sourceActionId?: string
): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO agent_action_registry
      (id, org_id, action_type, gmail_thread_id, source_conversation_id,
       prospect_id, lead_id, status, support_score, source_agents, last_agent, source_action_id)
    VALUES
      (${id}, ${req.orgId}, ${req.actionType},
       ${req.gmailThreadId ?? null}, ${req.sourceConversationId ?? null},
       ${req.prospectId ?? null}, ${req.leadId ?? null},
       'active', 1,
       ${req.agentName ? `ARRAY['${req.agentName}']::text[]` : `ARRAY[]::text[]`},
       ${req.agentName ?? null}, ${sourceActionId ?? null})
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  return id;
}

// ─── Merge duplicate ──────────────────────────────────────────────────────────
async function mergeAction(existingId: string, req: CoordinationRequest): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE agent_action_registry
    SET
      support_score = support_score + 1,
      last_agent    = ${req.agentName ?? null},
      updated_at    = NOW()
    WHERE id = ${existingId}
    RETURNING support_score
  `);
  const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  return Number(data[0]?.support_score ?? 1);
}

// ─── Log coordination decision ─────────────────────────────────────────────────
async function logDecision(
  req: CoordinationRequest,
  decision: string,
  originalId?: string,
  mergedId?: string,
  supportScore?: number
): Promise<void> {
  await db.execute(sql`
    INSERT INTO coordination_decisions
      (org_id, action_type, gmail_thread_id, source_conversation_id,
       prospect_id, lead_id, decision, original_action_id, merged_action_id,
       support_score, requesting_agent, metadata)
    VALUES
      (${req.orgId}, ${req.actionType}, ${req.gmailThreadId ?? null},
       ${req.sourceConversationId ?? null}, ${req.prospectId ?? null},
       ${req.leadId ?? null}, ${decision}, ${originalId ?? null},
       ${mergedId ?? null}, ${supportScore ?? 1},
       ${req.agentName ?? null}, ${JSON.stringify(req.metadata ?? {})}::jsonb)
  `);
}

// ─── Public API ────────────────────────────────────────────────────────────────
/**
 * Call this before creating any agent action.
 * Returns decision: if 'deduplicated' or 'merged', do NOT create a new action.
 */
export async function checkCoordination(
  req: CoordinationRequest,
  sourceActionId?: string
): Promise<CoordinationDecision> {
  await ensureCoordinationTables();

  const existing = await findDuplicate(req);

  if (existing) {
    const supportScore = await mergeAction(existing.id, req);
    const decision = supportScore > 2 ? "merged" : "deduplicated";
    await logDecision(req, decision, existing.id, undefined, supportScore);
    return { action: decision as "merged" | "deduplicated", actionId: existing.id, supportScore };
  }

  await registerAction(req, sourceActionId);
  await logDecision(req, "created");
  return { action: "created", actionId: null };
}

/**
 * Mark a registry entry as resolved (after execution or rejection)
 */
export async function resolveCoordinationEntry(
  orgId: string,
  actionType: string,
  gmailThreadId?: string,
  prospectId?: string
): Promise<void> {
  await ensureCoordinationTables();
  if (!gmailThreadId && !prospectId) return;

  if (gmailThreadId) {
    await db.execute(sql`
      UPDATE agent_action_registry SET status = 'resolved', updated_at = NOW()
      WHERE org_id = ${orgId} AND action_type = ${actionType}
        AND gmail_thread_id = ${gmailThreadId} AND status = 'active'
    `);
  } else if (prospectId) {
    await db.execute(sql`
      UPDATE agent_action_registry SET status = 'resolved', updated_at = NOW()
      WHERE org_id = ${orgId} AND action_type = ${actionType}
        AND prospect_id = ${prospectId} AND status = 'active'
    `);
  }
}

// ─── Stats queries ─────────────────────────────────────────────────────────────
export async function getCoordinationStats(orgId: string): Promise<{
  totalDecisions: number;
  duplicatesPrevented: number;
  mergedActions: number;
  activeInRegistry: number;
  preventionRate: number;
}> {
  await ensureCoordinationTables();

  const rows = await db.execute(sql`
    SELECT
      COUNT(*)                                                       AS total,
      SUM(CASE WHEN decision = 'deduplicated' THEN 1 ELSE 0 END)    AS deduplicated,
      SUM(CASE WHEN decision = 'merged'       THEN 1 ELSE 0 END)    AS merged
    FROM coordination_decisions
    WHERE org_id = ${orgId}
  `);
  const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  const r = data[0] ?? {};

  const activeRows = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM agent_action_registry
    WHERE org_id = ${orgId} AND status = 'active'
  `);
  const activeData = Array.isArray(activeRows) ? activeRows : (activeRows as any).rows ?? [];

  const total = Number(r.total ?? 0);
  const deduped = Number(r.deduplicated ?? 0);
  const merged = Number(r.merged ?? 0);
  const prevented = deduped + merged;

  return {
    totalDecisions: total,
    duplicatesPrevented: prevented,
    mergedActions: merged,
    activeInRegistry: Number(activeData[0]?.cnt ?? 0),
    preventionRate: total > 0 ? Math.round((prevented / total) * 100) : 0,
  };
}
