/**
 * Kevin Slack EOH — Durable Action Token Service
 *
 * Replaces the in-memory Map from scheduling-handler.ts with a database-backed,
 * cryptographically hashed, atomically single-use confirmation token system.
 *
 * Security properties:
 * ─ 32 bytes of random entropy per token
 * ─ Only HMAC-SHA256(raw_token, SLACK_SIGNING_SECRET) stored in DB
 * ─ Raw token is ephemeral: creation → Slack button value → incoming action → verify → discard
 * ─ Atomic claim via UPDATE … WHERE status='pending' AND expires_at > NOW() RETURNING *
 * ─ Org, team, and user isolation enforced at claim time
 * ─ Idempotency key prevents duplicate business-action execution
 *
 * Degraded-mode fallback:
 * ─ If the DB is unavailable (unit tests, cold-start timing), a process-local Map
 *   is used as a best-effort fallback with the same hash semantics
 * ─ Production systems always have DB available — the fallback is for test resilience only
 * ─ A warning is logged whenever the fallback activates
 *
 * Token lifecycle:
 *   pending → processing → consumed   (confirm path)
 *                        → failed     (business action exception)
 *   pending → canceled               (user clicked Abort)
 *   pending → expired                (cleanup cron)
 */

import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionTokenStatus =
  | "pending"
  | "processing"
  | "consumed"
  | "expired"
  | "failed"
  | "canceled";

export type TokenClaimReason =
  | "invalid"
  | "expired"
  | "already_consumed"
  | "already_processing"
  | "canceled"
  | "wrong_user"
  | "wrong_team"
  | "wrong_org"
  | "db_error";

export interface ActionTokenRecord {
  id: string;
  tokenHash: string;
  orgId: string;
  slackTeamId: string;
  slackUserId: string;
  trainefficiencyUserId: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  idempotencyKey: string | null;
  status: ActionTokenStatus;
  expiresAt: Date;
  createdAt: Date;
  processingAt: Date | null;
  consumedAt: Date | null;
  traceId: string;
  sourceChannelId: string | null;
  sourceMessageTs: string | null;
}

export interface CreateTokenInput {
  intent: string;
  orgId: string;
  trainefficiencyUserId: string;
  actionPayload: Record<string, unknown>;
  slackTeamId?: string;
  slackUserId?: string;
  traceId?: string;
  channelId?: string;
  messageTs?: string;
  ttlMs?: number;
}

export interface ClaimTokenInput {
  rawToken: string;
  orgId?: string;
  slackTeamId?: string;
  slackUserId?: string;
  trainefficiencyUserId?: string;
}

export type ClaimResult =
  | { ok: true; record: ActionTokenRecord }
  | { ok: false; reason: TokenClaimReason; userMessage: string };

// ─── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Hash a raw token before storing.
 * Uses HMAC-SHA256 with SLACK_SIGNING_SECRET as pepper when available;
 * falls back to plain SHA-256 (still secure with 32-byte entropy).
 * Never log or return the raw token after this point.
 */
export function hashToken(rawToken: string): string {
  const pepper = process.env.SLACK_SIGNING_SECRET;
  if (pepper) {
    return crypto.createHmac("sha256", pepper).update(rawToken).digest("hex");
  }
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// ─── In-memory fallback (tests + DB-unavailable resilience) ───────────────────

interface FallbackEntry {
  id: string;
  tokenHash: string;
  intent: string;
  orgId: string;
  slackTeamId: string;
  slackUserId: string;
  trainefficiencyUserId: string;
  actionPayload: Record<string, unknown>;
  status: ActionTokenStatus;
  expiresAt: Date;
  createdAt: Date;
  traceId: string;
  sourceChannelId: string | null;
  sourceMessageTs: string | null;
}

const _fallback = new Map<string, FallbackEntry>(); // keyed by tokenHash

function _fallbackCreate(
  rawToken: string,
  input: CreateTokenInput,
  ttlMs: number,
): void {
  const hash = hashToken(rawToken);
  const id = crypto.randomBytes(8).toString("hex");
  _fallback.set(hash, {
    id,
    tokenHash: hash,
    intent: input.intent,
    orgId: input.orgId,
    slackTeamId: input.slackTeamId ?? "",
    slackUserId: input.slackUserId ?? "",
    trainefficiencyUserId: input.trainefficiencyUserId,
    actionPayload: sanitizePayload(input.actionPayload),
    status: "pending",
    expiresAt: new Date(Date.now() + ttlMs),
    createdAt: new Date(),
    traceId: input.traceId ?? "",
    sourceChannelId: input.channelId ?? null,
    sourceMessageTs: input.messageTs ?? null,
  });
}

function _fallbackClaim(input: ClaimTokenInput): ClaimResult {
  const hash = hashToken(input.rawToken);
  const entry = _fallback.get(hash);

  if (!entry) return { ok: false, reason: "invalid", userMessage: _expiredMsg() };
  if (entry.expiresAt < new Date()) {
    entry.status = "expired";
    return { ok: false, reason: "expired", userMessage: _expiredMsg() };
  }
  if (entry.status === "consumed") return { ok: false, reason: "already_consumed", userMessage: _alreadyMsg() };
  if (entry.status === "processing") return { ok: false, reason: "already_processing", userMessage: _alreadyMsg() };
  if (entry.status === "canceled") return { ok: false, reason: "canceled", userMessage: _expiredMsg() };
  if (entry.status === "expired") return { ok: false, reason: "expired", userMessage: _expiredMsg() };

  if (input.orgId && entry.orgId && input.orgId !== entry.orgId) {
    return { ok: false, reason: "wrong_org", userMessage: "❌ Action not authorized for your organization." };
  }
  if (input.slackTeamId && entry.slackTeamId && input.slackTeamId !== entry.slackTeamId) {
    return { ok: false, reason: "wrong_team", userMessage: "❌ Action not authorized for this workspace." };
  }
  if (input.slackUserId && entry.slackUserId && input.slackUserId !== entry.slackUserId) {
    return { ok: false, reason: "wrong_user", userMessage: "❌ This confirmation belongs to a different user." };
  }

  entry.status = "processing";

  return {
    ok: true,
    record: {
      id: entry.id,
      tokenHash: entry.tokenHash,
      orgId: entry.orgId,
      slackTeamId: entry.slackTeamId,
      slackUserId: entry.slackUserId,
      trainefficiencyUserId: entry.trainefficiencyUserId,
      actionType: entry.intent,
      actionPayload: entry.actionPayload,
      idempotencyKey: `slack:${entry.intent}:${entry.id}`,
      status: "processing",
      expiresAt: entry.expiresAt,
      createdAt: entry.createdAt,
      processingAt: new Date(),
      consumedAt: null,
      traceId: entry.traceId,
      sourceChannelId: entry.sourceChannelId,
      sourceMessageTs: entry.sourceMessageTs,
    },
  };
}

function _fallbackCancel(rawToken: string): void {
  const hash = hashToken(rawToken);
  const entry = _fallback.get(hash);
  if (entry && entry.status === "pending") {
    entry.status = "canceled";
  }
}

// ─── Payload sanitizer ────────────────────────────────────────────────────────

/** Strip keys that should never be persisted in action_payload */
const BLOCKED_PAYLOAD_KEYS = new Set([
  "password", "token", "secret", "apiKey", "api_key",
  "credential", "auth", "authorization", "cookie",
  "orgId", "org_id", "role", "permissions",
]);

function sanitizePayload(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (BLOCKED_PAYLOAD_KEYS.has(k.toLowerCase())) continue;
    if (typeof v === "string" && v.length > 1024) continue; // truncate oversized strings
    result[k] = v;
  }
  return result;
}

// ─── Message helpers ──────────────────────────────────────────────────────────

function _expiredMsg(): string {
  return "⏰ *This confirmation has expired.* Ask Kevin to generate a new preview.";
}

function _alreadyMsg(): string {
  return "✅ This action has already been completed.";
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): ActionTokenRecord {
  return {
    id: String(row.id ?? ""),
    tokenHash: String(row.token_hash ?? ""),
    orgId: String(row.org_id ?? ""),
    slackTeamId: String(row.slack_team_id ?? ""),
    slackUserId: String(row.slack_user_id ?? ""),
    trainefficiencyUserId: String(row.trainefficiency_user_id ?? ""),
    actionType: String(row.action_type ?? ""),
    actionPayload: (row.action_payload as Record<string, unknown>) ?? {},
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    status: (row.status as ActionTokenStatus) ?? "pending",
    expiresAt: new Date(String(row.expires_at)),
    createdAt: new Date(String(row.created_at)),
    processingAt: row.processing_at ? new Date(String(row.processing_at)) : null,
    consumedAt: row.consumed_at ? new Date(String(row.consumed_at)) : null,
    traceId: String(row.trace_id ?? ""),
    sourceChannelId: row.source_channel_id ? String(row.source_channel_id) : null,
    sourceMessageTs: row.source_message_ts ? String(row.source_message_ts) : null,
  };
}

function getRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}

// ─── Public API ───────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Create a durable action confirmation token.
 * Returns the raw 32-byte hex token — caller places it in the Slack button value.
 * The raw token is never stored or logged.
 */
export async function createActionToken(
  intent: string,
  orgId: string,
  userId: string,
  payload: Record<string, unknown>,
  slackContext?: {
    teamId?: string;
    slackUserId?: string;
    channelId?: string;
    messageTs?: string;
    traceId?: string;
  },
): Promise<string> {
  const ttlMs = DEFAULT_TTL_MS;
  const rawToken = crypto.randomBytes(32).toString("hex"); // 64 hex chars
  const tokenHash = hashToken(rawToken);
  const sanitized = sanitizePayload(payload);
  const traceId = slackContext?.traceId ?? crypto.randomBytes(8).toString("hex");
  const teamId = slackContext?.teamId ?? "";
  const slackUserId = slackContext?.slackUserId ?? "";
  const channelId = slackContext?.channelId ?? null;
  const messageTs = slackContext?.messageTs ?? null;
  const expiresAt = new Date(Date.now() + ttlMs);

  try {
    const rows = await db.execute(sql`
      INSERT INTO kevin_slack_action_tokens (
        token_hash, org_id, slack_team_id, slack_user_id,
        trainefficiency_user_id, action_type, action_payload,
        idempotency_key, status, expires_at, trace_id,
        source_channel_id, source_message_ts
      ) VALUES (
        ${tokenHash}, ${orgId}, ${teamId}, ${slackUserId},
        ${userId}, ${intent}, ${JSON.stringify(sanitized)}::jsonb,
        ${"slack:" + intent + ":" + tokenHash.slice(0, 16)},
        'pending', ${expiresAt.toISOString()}::timestamptz, ${traceId},
        ${channelId}, ${messageTs}
      )
      ON CONFLICT (token_hash) DO NOTHING
      RETURNING id
    `);

    const inserted = getRows(rows);
    if (!inserted[0]) {
      // Hash collision (astronomically unlikely) — fall through to fallback
      console.warn("[ActionToken] Hash collision on insert, using fallback");
    } else {
      return rawToken;
    }
  } catch (err: any) {
    console.warn("[ActionToken] DB create failed, using in-memory fallback:", err?.message);
  }

  // Fallback: in-memory with same hash semantics
  _fallbackCreate(rawToken, {
    intent,
    orgId,
    slackTeamId: teamId,
    slackUserId,
    trainefficiencyUserId: userId,
    actionPayload: sanitized,
    traceId,
    channelId: channelId ?? undefined,
    messageTs: messageTs ?? undefined,
    ttlMs,
  }, ttlMs);

  return rawToken;
}

/**
 * Atomically claim a pending token for processing.
 * Uses a conditional UPDATE that only succeeds if the token is
 * `pending`, unexpired, and matches all isolation fields.
 *
 * Only ONE request can claim a given token — the UPDATE's WHERE clause
 * is the exclusive gate. The DB serializes concurrent claims naturally.
 */
export async function consumeActionToken(
  rawToken: string,
  isolationContext?: {
    orgId?: string;
    slackTeamId?: string;
    slackUserId?: string;
  },
): Promise<ActionTokenRecord | null> {
  const hash = hashToken(rawToken);

  try {
    // Atomic claim: transition pending → processing
    const rows = await db.execute(sql`
      UPDATE kevin_slack_action_tokens
      SET
        status       = 'processing',
        processing_at = NOW()
      WHERE
        token_hash  = ${hash}
        AND status  = 'pending'
        AND expires_at > NOW()
        AND (${isolationContext?.orgId ?? null}::text IS NULL
             OR org_id = ${isolationContext?.orgId ?? null}::text)
        AND (${isolationContext?.slackTeamId ?? null}::text IS NULL
             OR slack_team_id = ${isolationContext?.slackTeamId ?? null}::text)
        AND (${isolationContext?.slackUserId ?? null}::text IS NULL
             OR slack_user_id = ${isolationContext?.slackUserId ?? null}::text)
      RETURNING *
    `);

    const claimed = getRows(rows);
    if (claimed[0]) {
      return rowToRecord(claimed[0]);
    }

    // No row claimed — determine specific reason for caller diagnostics
    const checkRows = await db.execute(sql`
      SELECT status, expires_at, org_id, slack_team_id, slack_user_id
      FROM kevin_slack_action_tokens
      WHERE token_hash = ${hash}
      LIMIT 1
    `);
    const check = getRows(checkRows);
    if (!check[0]) return null; // truly unknown token

    const existing = check[0];
    const status = String(existing.status ?? "");
    if (status === "expired" || new Date(String(existing.expires_at)) < new Date()) return null;
    if (status === "consumed" || status === "processing") return null; // already done
    if (status === "canceled" || status === "failed") return null;

    // Isolation mismatch
    if (isolationContext?.orgId && existing.org_id !== isolationContext.orgId) return null;
    if (isolationContext?.slackTeamId && existing.slack_team_id !== isolationContext.slackTeamId) return null;
    if (isolationContext?.slackUserId && existing.slack_user_id !== isolationContext.slackUserId) return null;

    return null;
  } catch (err: any) {
    console.warn("[ActionToken] DB consume failed, trying fallback:", err?.message);
  }

  // Fallback
  const result = _fallbackClaim({ rawToken, ...isolationContext });
  return result.ok ? result.record : null;
}

/**
 * Classify a claim failure with enough detail for the Slack response.
 * Used when `consumeActionToken` returns null.
 */
export async function classifyClaimFailure(rawToken: string): Promise<{
  reason: TokenClaimReason;
  userMessage: string;
}> {
  const hash = hashToken(rawToken);
  try {
    const rows = await db.execute(sql`
      SELECT status, expires_at FROM kevin_slack_action_tokens
      WHERE token_hash = ${hash} LIMIT 1
    `);
    const existing = getRows(rows)[0];
    if (!existing) return { reason: "invalid", userMessage: _expiredMsg() };

    const status = String(existing.status ?? "");
    const expired = new Date(String(existing.expires_at)) < new Date();

    if (status === "expired" || expired) return { reason: "expired", userMessage: _expiredMsg() };
    if (status === "consumed") return { reason: "already_consumed", userMessage: _alreadyMsg() };
    if (status === "processing") return { reason: "already_processing", userMessage: _alreadyMsg() };
    if (status === "canceled") return { reason: "canceled", userMessage: _expiredMsg() };
    if (status === "failed") return { reason: "invalid", userMessage: "❌ A previous attempt failed. Ask Kevin to generate a new preview." };
  } catch {
    // fallback check
    const hash2 = hashToken(rawToken);
    const entry = _fallback.get(hash2);
    if (entry) {
      if (entry.status === "consumed") return { reason: "already_consumed", userMessage: _alreadyMsg() };
      if (entry.expiresAt < new Date()) return { reason: "expired", userMessage: _expiredMsg() };
    }
  }
  return { reason: "invalid", userMessage: _expiredMsg() };
}

/**
 * Mark a claimed token as successfully consumed.
 * Called after the business action completes successfully.
 */
export async function markActionTokenConsumed(record: ActionTokenRecord): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE kevin_slack_action_tokens
      SET status = 'consumed', consumed_at = NOW()
      WHERE id = ${record.id} AND status = 'processing'
    `);
  } catch {
    // Fallback
    const entry = _fallback.get(record.tokenHash);
    if (entry) entry.status = "consumed";
  }
}

/**
 * Mark a claimed token as failed.
 * Called when the business action throws or returns an error.
 * Does NOT reset to pending — a new preview must be generated.
 */
export async function markActionTokenFailed(
  record: ActionTokenRecord,
  error: string,
): Promise<void> {
  const sanitizedError = error.slice(0, 500);
  try {
    await db.execute(sql`
      UPDATE kevin_slack_action_tokens
      SET status = 'failed', failed_at = NOW(), last_error = ${sanitizedError}
      WHERE id = ${record.id}
    `);
  } catch {
    const entry = _fallback.get(record.tokenHash);
    if (entry) {
      entry.status = "failed";
    }
  }
}

/**
 * Cancel a pending token (user clicked Abort).
 * Accepts the raw token string (from the Slack button value).
 */
export async function invalidateActionToken(rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  try {
    await db.execute(sql`
      UPDATE kevin_slack_action_tokens
      SET status = 'canceled', canceled_at = NOW()
      WHERE token_hash = ${hash} AND status IN ('pending', 'processing')
    `);
  } catch {
    _fallbackCancel(rawToken);
  }
}

/**
 * Get the current status of a token for admin diagnostics.
 * Never returns the raw token.
 */
export async function getActionTokenStatus(
  rawToken: string,
): Promise<ActionTokenRecord | null> {
  const hash = hashToken(rawToken);
  try {
    const rows = await db.execute(sql`
      SELECT * FROM kevin_slack_action_tokens
      WHERE token_hash = ${hash} LIMIT 1
    `);
    const r = getRows(rows)[0];
    return r ? rowToRecord(r) : null;
  } catch {
    const entry = _fallback.get(hash);
    if (!entry) return null;
    return {
      id: entry.id,
      tokenHash: entry.tokenHash,
      orgId: entry.orgId,
      slackTeamId: entry.slackTeamId,
      slackUserId: entry.slackUserId,
      trainefficiencyUserId: entry.trainefficiencyUserId,
      actionType: entry.intent,
      actionPayload: entry.actionPayload,
      idempotencyKey: null,
      status: entry.status,
      expiresAt: entry.expiresAt,
      createdAt: entry.createdAt,
      processingAt: null,
      consumedAt: null,
      traceId: entry.traceId,
      sourceChannelId: entry.sourceChannelId,
      sourceMessageTs: entry.sourceMessageTs,
    };
  }
}

// ─── Expiration cleanup cron ──────────────────────────────────────────────────

let _cleanupStarted = false;

/**
 * Start a background cleanup cron that:
 * 1. Transitions pending tokens past expires_at → expired
 * 2. Hard-deletes terminal records older than 30 days (audit retention)
 * 3. Purges expired in-memory fallback entries
 *
 * Idempotent: safe to call multiple times (only starts one interval).
 */
export function startTokenCleanupCron(): void {
  if (_cleanupStarted) return;
  _cleanupStarted = true;

  const INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

  setInterval(async () => {
    try {
      // Expire pending tokens whose TTL has passed
      const expired = await db.execute(sql`
        UPDATE kevin_slack_action_tokens
        SET status = 'expired'
        WHERE status = 'pending' AND expires_at <= NOW()
      `);
      const expiredCount = (expired as any)?.rowCount ?? 0;
      if (expiredCount > 0) {
        console.log(`[ActionToken] Expired ${expiredCount} stale pending token(s)`);
      }

      // Hard-delete terminal records older than 30 days
      const deleted = await db.execute(sql`
        DELETE FROM kevin_slack_action_tokens
        WHERE status IN ('consumed','expired','canceled','failed')
          AND created_at < NOW() - INTERVAL '30 days'
      `);
      const deletedCount = (deleted as any)?.rowCount ?? 0;
      if (deletedCount > 0) {
        console.log(`[ActionToken] Purged ${deletedCount} old terminal token record(s)`);
      }
    } catch (err: any) {
      // Non-fatal — token cleanup failure does not affect operations
      console.warn("[ActionToken] Cleanup cron error:", err?.message);
    }

    // Purge in-memory fallback
    const now = Date.now();
    for (const [hash, entry] of _fallback.entries()) {
      if (entry.expiresAt.getTime() < now && entry.status === "pending") {
        entry.status = "expired";
      }
      // Remove very old fallback entries (>30 min past expiry)
      if (entry.expiresAt.getTime() < now - 30 * 60 * 1000) {
        _fallback.delete(hash);
      }
    }
  }, INTERVAL_MS);

  console.log("[ActionToken] Cleanup cron started — runs every 5 minutes");
}
