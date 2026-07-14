/**
 * Kevin Slack EOH — Bounded Conversation State
 *
 * Multi-step scheduling workflows require state across Slack messages.
 *
 * Rules:
 * - State is scoped by Slack user + channel + thread (never cross-user)
 * - Expires after inactivity (default 10 minutes)
 * - Sensitive content is never persisted verbatim
 * - Users can always cancel the current workflow
 * - Slack retries cannot duplicate state transitions (deduplication)
 * - Trace IDs are preserved throughout the flow
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type ConversationIntent =
  | "create_session"
  | "reschedule_session"
  | "cancel_session"
  | "view_schedule"
  | "view_openings"
  | "view_approvals"
  | "health_check"
  | "integrations_check"
  | "summary"
  | "help"
  | "unknown";

export type ConversationStep =
  | "collecting"
  | "confirming"
  | "executing"
  | "complete"
  | "cancelled"
  | "error";

export interface ConversationState {
  conversationId: string;
  slackTeamId: string;
  slackChannelId: string;
  slackThreadTs: string | null;
  slackUserId: string;
  orgId: string | null;
  intent: ConversationIntent;
  step: ConversationStep;
  collectedFields: Record<string, unknown>;
  expiresAt: Date;
  traceId: string;
  lastEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const STATE_TTL_MINUTES = 10;
let tablesEnsured = false;

export async function ensureConversationTables(): Promise<void> {
  if (tablesEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kevin_slack_conversation_state (
        conversation_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        slack_team_id TEXT NOT NULL,
        slack_channel_id TEXT NOT NULL,
        slack_thread_ts TEXT,
        slack_user_id TEXT NOT NULL,
        org_id TEXT,
        intent TEXT NOT NULL DEFAULT 'unknown',
        step TEXT NOT NULL DEFAULT 'collecting',
        collected_fields JSONB NOT NULL DEFAULT '{}',
        expires_at TIMESTAMPTZ NOT NULL,
        trace_id TEXT NOT NULL,
        last_event_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (slack_team_id, slack_channel_id, slack_user_id, slack_thread_ts)
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kevin_slack_event_dedup (
        event_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour'
      )
    `);
    tablesEnsured = true;
  } catch (err: any) {
    console.error("[Kevin Slack] ensureConversationTables error:", err?.message);
  }
}

// ─── Deduplication ────────────────────────────────────────────────────────────

export async function isEventDuplicate(eventId: string, teamId: string): Promise<boolean> {
  await ensureConversationTables();
  try {
    const rows = await db.execute(sql`
      SELECT event_id FROM kevin_slack_event_dedup
      WHERE event_id = ${eventId} AND team_id = ${teamId}
      LIMIT 1
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return arr.length > 0;
  } catch {
    return false;
  }
}

export async function markEventSeen(eventId: string, teamId: string): Promise<void> {
  await ensureConversationTables();
  try {
    await db.execute(sql`
      INSERT INTO kevin_slack_event_dedup (event_id, team_id)
      VALUES (${eventId}, ${teamId})
      ON CONFLICT (event_id) DO NOTHING
    `);
    // Clean up expired entries opportunistically
    await db.execute(sql`
      DELETE FROM kevin_slack_event_dedup WHERE expires_at < NOW()
    `);
  } catch (err: any) {
    console.error("[Kevin Slack] markEventSeen error:", err?.message);
  }
}

// ─── State lookup / upsert ────────────────────────────────────────────────────

export async function getActiveConversation(
  slackTeamId: string,
  slackChannelId: string,
  slackUserId: string,
  slackThreadTs: string | null,
): Promise<ConversationState | null> {
  await ensureConversationTables();
  try {
    const rows = await db.execute(sql`
      SELECT * FROM kevin_slack_conversation_state
      WHERE slack_team_id = ${slackTeamId}
        AND slack_channel_id = ${slackChannelId}
        AND slack_user_id = ${slackUserId}
        AND slack_thread_ts IS NOT DISTINCT FROM ${slackThreadTs}
        AND expires_at > NOW()
        AND step NOT IN ('complete', 'cancelled', 'error')
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return arr[0] ? rowToState(arr[0]) : null;
  } catch (err: any) {
    console.error("[Kevin Slack] getActiveConversation error:", err?.message);
    return null;
  }
}

export async function createConversation(
  params: Omit<ConversationState, "conversationId" | "createdAt" | "updatedAt" | "expiresAt">,
): Promise<ConversationState | null> {
  await ensureConversationTables();
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000);
  try {
    const rows = await db.execute(sql`
      INSERT INTO kevin_slack_conversation_state
        (slack_team_id, slack_channel_id, slack_thread_ts, slack_user_id, org_id,
         intent, step, collected_fields, expires_at, trace_id, last_event_id)
      VALUES
        (${params.slackTeamId}, ${params.slackChannelId}, ${params.slackThreadTs ?? null},
         ${params.slackUserId}, ${params.orgId ?? null},
         ${params.intent}, ${params.step},
         ${JSON.stringify(params.collectedFields)}::jsonb,
         ${expiresAt.toISOString()}, ${params.traceId}, ${params.lastEventId ?? null})
      ON CONFLICT (slack_team_id, slack_channel_id, slack_user_id, slack_thread_ts)
      DO UPDATE SET
        intent = EXCLUDED.intent,
        step = EXCLUDED.step,
        collected_fields = EXCLUDED.collected_fields,
        expires_at = EXCLUDED.expires_at,
        trace_id = EXCLUDED.trace_id,
        last_event_id = EXCLUDED.last_event_id,
        updated_at = NOW()
      RETURNING *
    `);
    const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return arr[0] ? rowToState(arr[0]) : null;
  } catch (err: any) {
    console.error("[Kevin Slack] createConversation error:", err?.message);
    return null;
  }
}

export async function updateConversation(
  conversationId: string,
  updates: Partial<Pick<ConversationState, "step" | "collectedFields" | "intent" | "lastEventId">>,
): Promise<boolean> {
  await ensureConversationTables();
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000);
  try {
    await db.execute(sql`
      UPDATE kevin_slack_conversation_state
      SET
        step = COALESCE(${updates.step ?? null}, step),
        collected_fields = COALESCE(${updates.collectedFields ? JSON.stringify(updates.collectedFields) + '::jsonb' : null}, collected_fields),
        last_event_id = COALESCE(${updates.lastEventId ?? null}, last_event_id),
        expires_at = ${expiresAt.toISOString()},
        updated_at = NOW()
      WHERE conversation_id = ${conversationId}
    `);
    return true;
  } catch (err: any) {
    console.error("[Kevin Slack] updateConversation error:", err?.message);
    return false;
  }
}

export async function cancelConversation(conversationId: string): Promise<void> {
  await ensureConversationTables();
  try {
    await db.execute(sql`
      UPDATE kevin_slack_conversation_state
      SET step = 'cancelled', updated_at = NOW()
      WHERE conversation_id = ${conversationId}
    `);
  } catch (err: any) {
    console.error("[Kevin Slack] cancelConversation error:", err?.message);
  }
}

export async function completeConversation(conversationId: string): Promise<void> {
  await ensureConversationTables();
  try {
    await db.execute(sql`
      UPDATE kevin_slack_conversation_state
      SET step = 'complete', updated_at = NOW()
      WHERE conversation_id = ${conversationId}
    `);
  } catch (err: any) {
    console.error("[Kevin Slack] completeConversation error:", err?.message);
  }
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToState(row: any): ConversationState {
  return {
    conversationId: row.conversation_id,
    slackTeamId: row.slack_team_id,
    slackChannelId: row.slack_channel_id,
    slackThreadTs: row.slack_thread_ts ?? null,
    slackUserId: row.slack_user_id,
    orgId: row.org_id ?? null,
    intent: row.intent as ConversationIntent,
    step: row.step as ConversationStep,
    collectedFields: typeof row.collected_fields === "object" ? row.collected_fields : JSON.parse(row.collected_fields ?? "{}"),
    expiresAt: new Date(row.expires_at),
    traceId: row.trace_id,
    lastEventId: row.last_event_id ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
