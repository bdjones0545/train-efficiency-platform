/**
 * Kevin Slack EOH — Audit Service
 *
 * Every Slack interaction creates an audit record.
 * Secrets and raw message content are never stored.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type AuditOutcome =
  | "approved"
  | "modified"
  | "dismissed"
  | "canceled"
  | "executed"
  | "failed"
  | "ignored"
  | "opened"
  | "clicked"
  | "blocked_no_mapping"
  | "blocked_cross_org"
  | "blocked_permissions"
  | "blocked_disabled"
  | "signature_rejected";

export interface SlackAuditRecord {
  id: string;
  slackTeamId: string;
  slackUserId: string;
  trainefficiencyUserId: string | null;
  orgId: string | null;
  intent: string;
  requestedOperation: string;
  authorizationResult: "allowed" | "denied" | "not_resolved";
  confirmationResult: "confirmed" | "cancelled" | "pending" | "not_required";
  executionResult: "success" | "failure" | "skipped" | "pending";
  outcome: AuditOutcome;
  traceId: string;
  errorMessage: string | null;
  createdAt: Date;
}

/**
 * @deprecated Tables are created by migrations/0002_kevin_slack_tables.sql
 * and by runKevinSlackMigration() in kevin-slack-routes.ts at startup.
 * This function is retained for call-site compatibility only. It is a no-op.
 */
export async function ensureAuditTables(): Promise<void> {
  // No-op — tables are created at startup by the committed migration runner.
}

export async function recordAuditEvent(
  record: Omit<SlackAuditRecord, "id" | "createdAt">,
): Promise<string | null> {
  await ensureAuditTables();
  try {
    const rows = await db.execute(sql`
      INSERT INTO kevin_slack_action_audit
        (slack_team_id, slack_user_id, trainefficiency_user_id, org_id, intent,
         requested_operation, authorization_result, confirmation_result,
         execution_result, outcome, trace_id, error_message)
      VALUES
        (${record.slackTeamId}, ${record.slackUserId}, ${record.trainefficiencyUserId ?? null},
         ${record.orgId ?? null}, ${record.intent}, ${record.requestedOperation},
         ${record.authorizationResult}, ${record.confirmationResult},
         ${record.executionResult}, ${record.outcome}, ${record.traceId},
         ${record.errorMessage ?? null})
      RETURNING id
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return arr[0]?.id ?? null;
  } catch (err: any) {
    console.error("[Kevin Slack] recordAuditEvent error:", err?.message);
    return null;
  }
}

export async function getRecentAuditEvents(
  orgId: string,
  limit = 50,
): Promise<SlackAuditRecord[]> {
  await ensureAuditTables();
  try {
    const rows = await db.execute(sql`
      SELECT * FROM kevin_slack_action_audit
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return arr.map(rowToAudit);
  } catch (err: any) {
    console.error("[Kevin Slack] getRecentAuditEvents error:", err?.message);
    return [];
  }
}

export async function getAuditStats(): Promise<{
  totalInteractions: number;
  successRate: number;
  blockedCount: number;
  last24hCount: number;
}> {
  await ensureAuditTables();
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN execution_result = 'success' THEN 1 ELSE 0 END)::int AS successes,
        SUM(CASE WHEN authorization_result = 'denied' THEN 1 ELSE 0 END)::int AS blocked,
        SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END)::int AS last24h
      FROM kevin_slack_action_audit
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    const r = arr[0] ?? {};
    const total = r.total ?? 0;
    const successes = r.successes ?? 0;
    return {
      totalInteractions: total,
      successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
      blockedCount: r.blocked ?? 0,
      last24hCount: r.last24h ?? 0,
    };
  } catch (err: any) {
    console.error("[Kevin Slack] getAuditStats error:", err?.message);
    return { totalInteractions: 0, successRate: 0, blockedCount: 0, last24hCount: 0 };
  }
}

function rowToAudit(row: any): SlackAuditRecord {
  return {
    id: row.id,
    slackTeamId: row.slack_team_id,
    slackUserId: row.slack_user_id,
    trainefficiencyUserId: row.trainefficiency_user_id ?? null,
    orgId: row.org_id ?? null,
    intent: row.intent,
    requestedOperation: row.requested_operation,
    authorizationResult: row.authorization_result,
    confirmationResult: row.confirmation_result,
    executionResult: row.execution_result,
    outcome: row.outcome as AuditOutcome,
    traceId: row.trace_id,
    errorMessage: row.error_message ?? null,
    createdAt: new Date(row.created_at),
  };
}
