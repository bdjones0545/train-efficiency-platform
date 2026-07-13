/**
 * Kevin audit events — Phase 1
 *
 * Append-only operational audit for /api/kevin/* access. Fail-open: never block
 * health/capabilities responses if the audit table is unavailable.
 *
 * Sampling: health checks are sampled (default 20%) to avoid write storms when
 * the Console polls; capabilities and explicit config probes are always logged.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

let _tableReady = false;

export async function ensureKevinAuditTable(): Promise<void> {
  if (_tableReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kevin_audit_events (
        id           TEXT PRIMARY KEY,
        org_id       TEXT,
        user_id      TEXT,
        run_id       TEXT,
        event_type   TEXT NOT NULL,
        payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_kevin_audit_created
      ON kevin_audit_events (created_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_kevin_audit_type
      ON kevin_audit_events (event_type)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_kevin_audit_org
      ON kevin_audit_events (org_id)
    `);
    _tableReady = true;
  } catch (e: any) {
    console.warn("[KevinAudit] table setup warning:", e?.message);
  }
}

export type KevinAuditInput = {
  orgId?: string | null;
  userId?: string | null;
  runId?: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
};

/** Redact obvious secrets from payloads before persistence. */
function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload || {})) {
    const key = k.toLowerCase();
    if (
      key.includes("key") ||
      key.includes("secret") ||
      key.includes("token") ||
      key.includes("password") ||
      key.includes("authorization")
    ) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Best-effort insert. Never throws to callers.
 */
export async function recordKevinAuditEvent(input: KevinAuditInput): Promise<void> {
  try {
    await ensureKevinAuditTable();
    if (!_tableReady) return;
    const id = randomUUID();
    const payload = sanitizePayload(input.payload || {});
    await db.execute(sql`
      INSERT INTO kevin_audit_events (id, org_id, user_id, run_id, event_type, payload)
      VALUES (
        ${id},
        ${input.orgId ?? null},
        ${input.userId ?? null},
        ${input.runId ?? null},
        ${input.eventType},
        ${JSON.stringify(payload)}::jsonb
      )
    `);
  } catch (e: any) {
    console.warn("[KevinAudit] write failed:", e?.message);
  }
}

/**
 * Sample health audits (default 20%). Always returns whether a write was attempted.
 */
export function shouldSampleHealthAudit(sampleRate = 0.2): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return Math.random() < sampleRate;
}
