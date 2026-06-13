/**
 * Action Conflict Resolution Engine — Sprint 3, Phase 5
 *
 * Detects when multiple agents propose conflicting actions on the same entity.
 * Generates conflict_alerts requiring human review.
 * Human override always wins.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface AgentAction {
  id: string;
  agentName: string;
  actionType: string;
  intent: "send" | "hold" | "escalate" | "recover" | "follow_up" | "pause" | "other";
  gmailThreadId?: string;
  prospectId?: string;
  leadId?: string;
  description?: string;
  orgId: string;
}

export interface ConflictAlert {
  id: string;
  orgId: string;
  conflictType: string;
  entities: string[];
  agentActions: AgentAction[];
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "resolved" | "overridden";
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}

// ─── Conflict type definitions ─────────────────────────────────────────────────
const CONFLICT_RULES: Array<{
  name: string;
  severity: ConflictAlert["severity"];
  detect: (a: AgentAction, b: AgentAction) => boolean;
  description: string;
}> = [
  {
    name: "send_vs_hold",
    severity: "high",
    detect: (a, b) =>
      (a.intent === "send" && b.intent === "hold") ||
      (a.intent === "hold" && b.intent === "send"),
    description: "One agent wants to send while another wants to pause outreach",
  },
  {
    name: "follow_up_vs_pause",
    severity: "high",
    detect: (a, b) =>
      (a.intent === "follow_up" && b.intent === "pause") ||
      (a.intent === "pause" && b.intent === "follow_up"),
    description: "One agent proposes a follow-up while another is suppressing outreach",
  },
  {
    name: "duplicate_recover",
    severity: "medium",
    detect: (a, b) =>
      a.intent === "recover" && b.intent === "recover",
    description: "Multiple agents both trying to recover the same lead",
  },
  {
    name: "escalation_vs_action",
    severity: "critical",
    detect: (a, b) =>
      (a.intent === "escalate" && b.intent !== "escalate") ||
      (b.intent === "escalate" && a.intent !== "escalate"),
    description: "One agent wants to escalate while another wants to proceed normally",
  },
];

// ─── Ensure tables ─────────────────────────────────────────────────────────────
export async function ensureConflictTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS conflict_alerts (
      id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id           TEXT NOT NULL,
      conflict_type    TEXT NOT NULL,
      severity         TEXT NOT NULL DEFAULT 'medium',
      entities         TEXT[] DEFAULT ARRAY[]::TEXT[],
      agent_actions    JSONB DEFAULT '[]'::jsonb,
      status           TEXT NOT NULL DEFAULT 'open',
      resolution       TEXT,
      resolved_by      TEXT,
      resolved_at      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_conflict_org    ON conflict_alerts (org_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_conflict_status ON conflict_alerts (status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_conflict_type   ON conflict_alerts (conflict_type)`);
}

// ─── Check for conflicts between two proposed actions ─────────────────────────
function detectConflicts(
  a: AgentAction,
  b: AgentAction
): Array<{ name: string; severity: ConflictAlert["severity"]; description: string }> {
  return CONFLICT_RULES
    .filter((rule) => rule.detect(a, b))
    .map((rule) => ({ name: rule.name, severity: rule.severity, description: rule.description }));
}

// ─── Derive entities from actions ─────────────────────────────────────────────
function extractEntities(actions: AgentAction[]): string[] {
  const set = new Set<string>();
  for (const a of actions) {
    if (a.gmailThreadId)  set.add(`thread:${a.gmailThreadId}`);
    if (a.prospectId)     set.add(`prospect:${a.prospectId}`);
    if (a.leadId)         set.add(`lead:${a.leadId}`);
  }
  return Array.from(set);
}

// ─── Public API ────────────────────────────────────────────────────────────────
/**
 * Check if two proposed actions conflict. If so, create a conflict_alert.
 * Returns the alert if a conflict was found, null if no conflict.
 */
export async function checkAndRecordConflict(
  orgId: string,
  actions: AgentAction[]
): Promise<ConflictAlert | null> {
  if (actions.length < 2) return null;
  await ensureConflictTables();

  const [a, b] = actions;
  const conflicts = detectConflicts(a, b);
  if (conflicts.length === 0) return null;

  // Use highest severity
  const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
  const topConflict = conflicts.reduce((max, cur) =>
    severityOrder[cur.severity] > severityOrder[max.severity] ? cur : max
  );

  const entities = extractEntities(actions);

  const rows = await db.execute(sql`
    INSERT INTO conflict_alerts
      (org_id, conflict_type, severity, entities, agent_actions, status)
    VALUES
      (${orgId}, ${topConflict.name}, ${topConflict.severity},
       ARRAY[${entities.join(",") || ""}]::text[],
       ${JSON.stringify(actions)}::jsonb, 'open')
    RETURNING id, created_at
  `);
  const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  const row = data[0] ?? {};

  return {
    id: row.id ?? crypto.randomUUID(),
    orgId,
    conflictType: topConflict.name,
    entities,
    agentActions: actions,
    severity: topConflict.severity,
    status: "open",
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

/**
 * Resolve a conflict alert (human override). Human override always wins.
 */
export async function resolveConflict(
  conflictId: string,
  resolution: string,
  resolvedBy: string
): Promise<void> {
  await ensureConflictTables();
  await db.execute(sql`
    UPDATE conflict_alerts
    SET status = 'overridden', resolution = ${resolution},
        resolved_by = ${resolvedBy}, resolved_at = NOW()
    WHERE id = ${conflictId}
  `);
}

/**
 * Get all open conflicts for an org
 */
export async function getOpenConflicts(orgId: string): Promise<ConflictAlert[]> {
  await ensureConflictTables();
  const rows = await db.execute(sql`
    SELECT * FROM conflict_alerts
    WHERE org_id = ${orgId} AND status = 'open'
    ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      created_at DESC
    LIMIT 50
  `);
  const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  return data.map((r: any) => ({
    id: r.id,
    orgId: r.org_id,
    conflictType: r.conflict_type,
    entities: r.entities ?? [],
    agentActions: r.agent_actions ?? [],
    severity: r.severity,
    status: r.status,
    resolution: r.resolution,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  }));
}

/**
 * Get conflict resolution stats
 */
export async function getConflictStats(orgId: string): Promise<{
  totalConflicts: number;
  open: number;
  resolved: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
}> {
  await ensureConflictTables();

  const rows = await db.execute(sql`
    SELECT
      COUNT(*)                                                    AS total,
      SUM(CASE WHEN status = 'open'        THEN 1 ELSE 0 END)    AS open,
      SUM(CASE WHEN status = 'overridden'  THEN 1 ELSE 0 END)    AS resolved
    FROM conflict_alerts WHERE org_id = ${orgId}
  `);
  const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  const r = data[0] ?? {};

  const sevRows = await db.execute(sql`
    SELECT severity, COUNT(*) AS cnt FROM conflict_alerts
    WHERE org_id = ${orgId} GROUP BY severity
  `);
  const sevData = Array.isArray(sevRows) ? sevRows : (sevRows as any).rows ?? [];
  const bySeverity: Record<string, number> = {};
  for (const row of sevData) bySeverity[(row as any).severity] = Number((row as any).cnt);

  const typeRows = await db.execute(sql`
    SELECT conflict_type, COUNT(*) AS cnt FROM conflict_alerts
    WHERE org_id = ${orgId} GROUP BY conflict_type
  `);
  const typeData = Array.isArray(typeRows) ? typeRows : (typeRows as any).rows ?? [];
  const byType: Record<string, number> = {};
  for (const row of typeData) byType[(row as any).conflict_type] = Number((row as any).cnt);

  return {
    totalConflicts: Number(r.total ?? 0),
    open: Number(r.open ?? 0),
    resolved: Number(r.resolved ?? 0),
    bySeverity,
    byType,
  };
}
