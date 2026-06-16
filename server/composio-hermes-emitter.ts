/**
 * Composio Hermes Emitter
 * ─────────────────────────────────────────────────────────────────────────────
 * Emits structured events for every Composio action.
 * Events are persisted and ready for future Hermes learning integration.
 *
 * Phase 1 constraints (per spec):
 *  - Events are STORED only — they do NOT yet modify trust or autonomy scores.
 *  - No AI inference is triggered.
 *  - Obsidian learning write is attempted but failures are silent.
 *
 * Future phases can hook into these events to:
 *  - Update agent trust scores
 *  - Train pattern-matching models
 *  - Surface insights in the CEO Heartbeat
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

// ─── Event schema ─────────────────────────────────────────────────────────────

export interface ComposioHermesEvent {
  source: "composio";
  orgId?: string;
  agent: string;
  tool: string;
  action: string;
  result: "success" | "failure" | "queued_for_approval" | "blocked";
  outcome: string;
  metadata?: Record<string, unknown>;
}

export interface ComposioHermesEventRecord extends ComposioHermesEvent {
  id: string;
  hermesProcessed: boolean;
  hermesProcessedAt?: Date;
  createdAt: Date;
}

// ─── Ensure table ─────────────────────────────────────────────────────────────

export async function ensureHermesEventTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS composio_hermes_events (
      id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id               TEXT,
      agent                TEXT NOT NULL,
      tool                 TEXT NOT NULL,
      action               TEXT NOT NULL,
      result               TEXT NOT NULL,
      outcome              TEXT NOT NULL,
      metadata             JSONB,
      hermes_processed     BOOLEAN NOT NULL DEFAULT false,
      hermes_processed_at  TIMESTAMP WITH TIME ZONE,
      created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS composio_hermes_events_org_idx
      ON composio_hermes_events (org_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS composio_hermes_events_processed_idx
      ON composio_hermes_events (hermes_processed, created_at)
  `);
}

// ─── Emit ──────────────────────────────────────────────────────────────────────

export async function emitComposioHermesEvent(
  event: ComposioHermesEvent,
): Promise<string> {
  const id = crypto.randomUUID();

  try {
    await db.execute(sql`
      INSERT INTO composio_hermes_events (
        id, org_id, agent, tool, action, result, outcome, metadata
      ) VALUES (
        ${id},
        ${event.orgId ?? null},
        ${event.agent},
        ${event.tool},
        ${event.action},
        ${event.result},
        ${event.outcome},
        ${event.metadata ? JSON.stringify(event.metadata) : null}::jsonb
      )
    `);

    console.log(
      `[ComposioHermes] Event stored — agent=${event.agent} tool=${event.tool} action=${event.action} result=${event.result}`,
    );

    // Attempt Hermes learning write (non-blocking, failures are silent)
    // Phase 1: write-only, no score modification
    setImmediate(() => {
      tryHermesLearningWrite(id, event).catch(() => {});
    });
  } catch (err: any) {
    console.error("[ComposioHermes] Failed to store event:", err.message);
  }

  return id;
}

// ─── Hermes learning integration (Phase 1 — read-only write) ─────────────────

async function tryHermesLearningWrite(
  eventId: string,
  event: ComposioHermesEvent,
): Promise<void> {
  try {
    const { processOutcomeEvent } = await import("./services/hermes-service");

    // Phase 1: map to communication_outcome_recorded if result is known
    if (event.result === "success" || event.result === "failure") {
      await processOutcomeEvent("communication_outcome_recorded", {
        orgId: event.orgId,
        domain: `composio.${event.tool.toLowerCase()}`,
        agentType: event.agent,
        outcomeStatus: event.result,
        tags: ["composio", event.tool.toLowerCase(), event.action.toLowerCase()],
      });
    }

    // Mark as processed
    await db.execute(sql`
      UPDATE composio_hermes_events
      SET hermes_processed = true, hermes_processed_at = NOW()
      WHERE id = ${eventId}
    `);
  } catch {
    // Silent — Hermes is optional in Phase 1
  }
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export async function getRecentHermesEvents(
  orgId: string,
  limit = 50,
): Promise<ComposioHermesEventRecord[]> {
  try {
    const raw = await db.execute(sql`
      SELECT * FROM composio_hermes_events
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rows = Array.isArray(raw) ? raw : (raw as any).rows ?? [];
    return rows.map(normaliseRow);
  } catch {
    return [];
  }
}

export async function getUnprocessedHermesEvents(orgId?: string, limit = 100): Promise<ComposioHermesEventRecord[]> {
  try {
    const raw = orgId
      ? await db.execute(sql`
          SELECT * FROM composio_hermes_events
          WHERE hermes_processed = false AND org_id = ${orgId}
          ORDER BY created_at ASC
          LIMIT ${limit}
        `)
      : await db.execute(sql`
          SELECT * FROM composio_hermes_events
          WHERE hermes_processed = false
          ORDER BY created_at ASC
          LIMIT ${limit}
        `);
    const rows = Array.isArray(raw) ? raw : (raw as any).rows ?? [];
    return rows.map(normaliseRow);
  } catch {
    return [];
  }
}

function normaliseRow(r: any): ComposioHermesEventRecord {
  return {
    id: r.id,
    source: "composio",
    orgId: r.org_id,
    agent: r.agent,
    tool: r.tool,
    action: r.action,
    result: r.result,
    outcome: r.outcome,
    metadata: r.metadata,
    hermesProcessed: r.hermes_processed,
    hermesProcessedAt: r.hermes_processed_at,
    createdAt: r.created_at,
  };
}
