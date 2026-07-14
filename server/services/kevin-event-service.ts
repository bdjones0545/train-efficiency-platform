/**
 * Kevin Event Service — Phase 3
 *
 * TrainEfficiency → Kevin event queue with:
 * - Non-blocking enqueue (fail-open, never breaks the originating workflow)
 * - Idempotent create via stable business idempotency keys
 * - Payload sanitization (no secrets, no raw PII)
 * - Exponential retry schedule: 30s, 2m, 8m, 30m, 2h
 * - Dead-letter after 5 attempts → Attention Inbox alert
 * - Row-claiming for concurrency safety (no duplicate dispatches)
 *
 * Feature gates:
 *   KEVIN_INTEGRATION_ENABLED   — master kill switch
 *   KEVIN_EVENT_DISPATCH_ENABLED — enables outbound HTTP dispatch to Hermes
 *
 * Hermes /v1/events endpoint is not yet available.
 * Events are queued and tracked locally; dispatch is disabled until Hermes
 * confirms the endpoint contract. See docs/kevin-integration.md for the
 * required Hermes event payload shape.
 */

import { db } from "../db";
import { kevinEvents } from "@shared/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { recordKevinAuditEvent } from "./kevin-audit-service";
import { isKevinCapabilityEnabled } from "./kevin-capability-service";

// ─── Config ───────────────────────────────────────────────────────────────────

function isEventDispatchEnabled(): boolean {
  const master = (process.env.KEVIN_INTEGRATION_ENABLED || "").trim().toLowerCase();
  const dispatch = (process.env.KEVIN_EVENT_DISPATCH_ENABLED || "").trim().toLowerCase();
  const truthy = (v: string) => v === "1" || v === "true" || v === "yes";
  return truthy(master) && truthy(dispatch);
}

// Retry delays in ms: attempt 1=30s, 2=2m, 3=8m, 4=30m, 5=2h
const RETRY_DELAYS_MS = [30_000, 120_000, 480_000, 1_800_000, 7_200_000];
const MAX_ATTEMPTS = 5;

// ─── Sanitization ─────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "secret",
  "key",
  "authorization",
  "credential",
  "apikey",
  "api_key",
  "private",
  "ssn",
  "dob",
  "date_of_birth",
  "credit_card",
  "card_number",
]);

function sanitizePayload(obj: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    // Normalize control characters and null bytes
    return obj.replace(/\0/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, 2000);
  }
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.slice(0, 50).map((v) => sanitizePayload(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lower = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (SENSITIVE_KEYS.has(lower) || SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else {
      out[k] = sanitizePayload(v, depth + 1);
    }
  }
  return out;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type EnqueueKevinEventInput = {
  orgId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  traceId?: string;
  source?: string;
};

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Enqueue a Kevin event. Non-blocking and fail-open.
 * The originating workflow MUST NOT depend on this succeeding.
 *
 * Idempotency key format:
 *   {eventType}:{orgId}:{stableEntityId}
 * e.g. "decision.recorded:org-123:dj-abc"
 */
export async function enqueueKevinEvent(
  input: EnqueueKevinEventInput,
): Promise<void> {
  try {
    // Master kill switch
    if (!(process.env.KEVIN_INTEGRATION_ENABLED || "").match(/^(1|true|yes)$/i)) return;
    // Capability gate
    const capEnabled = await isKevinCapabilityEnabled(input.orgId, "outcome_learning", "observe");
    if (!capEnabled) return;

    const sanitized = sanitizePayload({
      ...(input.payload ?? {}),
      _trace: input.traceId ?? null,
      _source: input.source ?? "trainefficiency",
    }) as Record<string, unknown>;

    await db
      .insert(kevinEvents)
      .values({
        orgId: input.orgId,
        eventType: input.eventType,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        payload: sanitized,
        idempotencyKey: input.idempotencyKey,
        status: "pending",
        attempts: 0,
        nextRetryAt: new Date(),
      })
      .onConflictDoNothing(); // idempotency_key unique constraint
  } catch (e: any) {
    // Fail open — never propagate to caller
    console.warn("[KevinEvents] enqueue failed (non-fatal):", e?.message);
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Attempt to dispatch a single pending event to Hermes.
 *
 * NOTE: The Hermes /v1/events endpoint is not yet available.
 * This function is implemented and ready; dispatch is controlled by
 * KEVIN_EVENT_DISPATCH_ENABLED. When Hermes provides the endpoint,
 * set KEVIN_EVENT_DISPATCH_ENABLED=true and the queue will drain automatically.
 *
 * Required Hermes contract:
 *   POST /v1/events
 *   Authorization: Bearer {KEVIN_HERMES_API_KEY}
 *   Content-Type: application/json
 *   Body: { event_id, org_id, event_type, entity_type, entity_id, payload, occurred_at, trace_id }
 *   Response: { ok: true, event_id: string }
 */
export async function dispatchKevinEvent(eventId: string): Promise<{
  ok: boolean;
  status: string;
  error?: string;
}> {
  if (!isEventDispatchEnabled()) {
    return { ok: false, status: "dispatch_disabled" };
  }

  // Claim the row atomically
  const claimResult = await db
    .update(kevinEvents)
    .set({ status: "processing" })
    .where(
      and(
        eq(kevinEvents.id, eventId),
        eq(kevinEvents.status, "pending"),
      ),
    )
    .returning();
  const event = claimResult[0];
  if (!event) return { ok: false, status: "not_claimable" };

  try {
    const { hermesSubmitEvent } = await import("./kevin-hermes-client");
    await hermesSubmitEvent({
      eventId: event.id,
      orgId: event.orgId,
      eventType: event.eventType,
      entityType: event.entityType ?? undefined,
      entityId: event.entityId ?? undefined,
      payload: (event.payload ?? {}) as Record<string, unknown>,
      occurredAt: event.createdAt?.toISOString() ?? new Date().toISOString(),
      traceId: (event.payload as any)?._trace ?? event.id,
    });

    await markKevinEventSent(event.id);
    return { ok: true, status: "sent" };
  } catch (e: any) {
    const err = e?.message ?? String(e);
    await markKevinEventFailed(event, err);
    return { ok: false, status: "failed", error: err };
  }
}

export async function markKevinEventSent(eventId: string): Promise<void> {
  try {
    await db
      .update(kevinEvents)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(kevinEvents.id, eventId));
  } catch {}
}

export async function markKevinEventFailed(
  event: typeof kevinEvents.$inferSelect,
  error: string,
): Promise<void> {
  const attempts = (event.attempts ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await deadLetterKevinEvent(event, error);
    return;
  }
  const delayMs = RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  const nextRetryAt = new Date(Date.now() + delayMs);
  try {
    await db
      .update(kevinEvents)
      .set({
        status: "pending",
        attempts,
        lastError: error.slice(0, 500),
        nextRetryAt,
      })
      .where(eq(kevinEvents.id, event.id));
  } catch {}
}

export async function deadLetterKevinEvent(
  event: typeof kevinEvents.$inferSelect,
  error: string,
): Promise<void> {
  try {
    await db
      .update(kevinEvents)
      .set({
        status: "dead_lettered",
        lastError: error.slice(0, 500),
        deadLetteredAt: new Date(),
        attempts: (event.attempts ?? 0) + 1,
      })
      .where(eq(kevinEvents.id, event.id));

    void recordKevinAuditEvent({
      orgId: event.orgId,
      eventType: "event.dead_lettered",
      payload: {
        eventId: event.id,
        eventType: event.eventType,
        attempts: (event.attempts ?? 0) + 1,
        lastError: error.slice(0, 300),
      },
    });

    // Create Attention Inbox alert (fail-open)
    try {
      const { db: dbInst } = await import("../db");
      const { sql: rawSql } = await import("drizzle-orm");
      await dbInst.execute(rawSql`
        INSERT INTO attention_items (
          id, org_id, level, category, title, body, source,
          source_id, severity, urgency, business_impact, confidence, status
        ) VALUES (
          gen_random_uuid()::text,
          ${event.orgId},
          'suggested',
          'operations',
          'Kevin event delivery failed',
          ${`Event type "${event.eventType}" could not be delivered to Kevin after ${MAX_ATTEMPTS} attempts. Manual review may be needed.`},
          'kevin_events',
          ${event.id},
          40, 35, 30, 0.9, 'active'
        )
        ON CONFLICT DO NOTHING
      `);
    } catch {}
  } catch (e: any) {
    console.warn("[KevinEvents] dead-letter error:", e?.message);
  }
}

// ─── Flush worker ─────────────────────────────────────────────────────────────

let _flushing = false;

/**
 * Process pending events. Run every ~5 minutes via cron.
 * Row-claiming prevents duplicate dispatch across instances.
 */
export async function flushPendingKevinEvents(opts?: { limit?: number }): Promise<{
  processed: number;
  sent: number;
  failed: number;
  deadLettered: number;
}> {
  if (_flushing) return { processed: 0, sent: 0, failed: 0, deadLettered: 0 };
  if (!isEventDispatchEnabled()) return { processed: 0, sent: 0, failed: 0, deadLettered: 0 };

  _flushing = true;
  const limit = Math.min(opts?.limit ?? 50, 100);
  let processed = 0, sent = 0, failed = 0, deadLettered = 0;

  try {
    // Select due events with atomic claim
    const due = await db
      .update(kevinEvents)
      .set({ status: "processing" })
      .where(
        and(
          eq(kevinEvents.status, "pending"),
          lte(kevinEvents.nextRetryAt, new Date()),
        ),
      )
      .returning()
      .limit(limit);

    for (const event of due) {
      processed++;
      try {
        const result = await dispatchKevinEvent(event.id);
        if (result.ok) {
          sent++;
        } else if (result.status === "dead_lettered") {
          deadLettered++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
  } finally {
    _flushing = false;
  }

  return { processed, sent, failed, deadLettered };
}

// ─── Cron ─────────────────────────────────────────────────────────────────────

let _cronHandle: ReturnType<typeof setInterval> | null = null;

export function startKevinEventWorker(): void {
  if (_cronHandle) return;
  _cronHandle = setInterval(() => {
    flushPendingKevinEvents().catch((e) =>
      console.warn("[KevinEvents] worker error:", e?.message),
    );
  }, 5 * 60 * 1000); // 5 minutes
  console.log("[KevinEvents] event worker started (5-min interval)");
}

export function stopKevinEventWorker(): void {
  if (_cronHandle) {
    clearInterval(_cronHandle);
    _cronHandle = null;
  }
}
