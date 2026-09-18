/**
 * kevin-action-api-guards.ts — hardening middleware for the Kevin Action API
 * (`/api/internal/kevin/v1/*`, registered in server/kevin-action-api-routes.ts).
 *
 * Three guards live here, all of which run AFTER requireInternalServiceToken:
 *
 *  1. kevinActionReplayGuard
 *     Enforces `X-Kevin-Timestamp` + `X-Kevin-Nonce` on every mutating request
 *     (POST/PATCH/PUT/DELETE) in production. Header names match what the real
 *     caller sends — see `kevin/te-client.ts` (`X-Kevin-Timestamp` is unix
 *     MILLISECONDS, `X-Kevin-Nonce` is a UUID) and docs/kevin-agent-gateway-auth.md.
 *     Nonces are claimed in PostgreSQL (`kevin_callback_nonces`, the same table
 *     and idempotent bootstrap the Kevin callback webhook uses) so that a replay
 *     to a DIFFERENT Replit autoscale instance is still rejected. A per-process
 *     Map cannot do that.
 *
 *  2. kevinOrgAllowlistGuard
 *     The action API is guarded by ONE global bearer token, so any caller
 *     holding it can name any org_id. Per-org credentials are the real fix and
 *     are out of scope; this guard narrows the blast radius to an explicit
 *     allowlist (`KEVIN_ALLOWED_ORG_IDS`) when the operator sets one.
 *
 *  3. kevinActionRateLimiter
 *     Per-token token bucket. Defence in depth only — see the comment on the
 *     limiter: the counter is per-process, so on autoscale the effective limit
 *     is (limit × instances). A shared-store limiter would be required for a
 *     hard guarantee.
 */

import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";

// ─── Header names (must match kevin/te-client.ts) ─────────────────────────────

export const KEVIN_TIMESTAMP_HEADER = "x-kevin-timestamp";
export const KEVIN_NONCE_HEADER = "x-kevin-nonce";

/** Scope prefix for rows this API owns in the shared nonce table. */
export const ACTION_API_NONCE_SCOPE = "action_api";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutatingMethod(method: string | undefined): boolean {
  return MUTATING_METHODS.has(String(method ?? "").toUpperCase());
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Allowed clock skew, in seconds. Same env var and clamp semantics the inbound
 * HMAC verifier uses (KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS, default 300,
 * clamped 30–3600) so both Kevin surfaces agree on "recent".
 */
export function getAllowedSkewSeconds(): number {
  const parsed = parseInt(process.env.KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS ?? "300", 10);
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
  return Math.min(3600, Math.max(30, value));
}

/**
 * Normalise a caller-supplied timestamp to milliseconds.
 * `kevin/te-client.ts` sends Date.now() (milliseconds); the HMAC callback
 * contract uses epoch seconds. Accept both rather than rejecting a correct
 * caller over units.
 */
export function normalizeTimestampMs(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Anything below 1e11 cannot be a millisecond timestamp in this century.
  return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
}

// ─── Nonce store ──────────────────────────────────────────────────────────────

export type NonceClaim = "fresh" | "duplicate";

export interface ActionNonceStore {
  /**
   * Atomically claim a nonce. Returns "fresh" the first time it is seen and
   * "duplicate" for every subsequent claim. MUST throw on infrastructure
   * failure so the caller can fail closed.
   */
  claim(nonce: string): Promise<NonceClaim>;
}

/**
 * Default store: the `kevin_callback_nonces` table, shared with the Kevin
 * callback webhook. Rows are namespaced by an `action_api:` id prefix so the
 * two surfaces cannot collide, and the webhook's existing TTL cleanup cron
 * (started by ensureCallbackNoncesTable) expires our rows too.
 *
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING id` is atomic across instances:
 * exactly one concurrent claim gets a row back, everyone else gets zero rows.
 */
const databaseNonceStore: ActionNonceStore = {
  async claim(nonce: string): Promise<NonceClaim> {
    // Imported lazily so that tests which inject a store never load server/db.ts.
    const [{ db }, { ensureCallbackNoncesTable }, { sql }] = await Promise.all([
      import("../db"),
      import("../kevin-webhook-routes"),
      import("drizzle-orm"),
    ]);
    await ensureCallbackNoncesTable();
    const id = `${ACTION_API_NONCE_SCOPE}:${nonce}`;
    const result: any = await db.execute(sql`
      INSERT INTO kevin_callback_nonces (id, job_id)
      VALUES (${id}, ${ACTION_API_NONCE_SCOPE})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `);
    const rows = Array.isArray(result?.rows) ? result.rows : Array.isArray(result) ? result : [];
    return rows.length > 0 ? "fresh" : "duplicate";
  },
};

let activeNonceStore: ActionNonceStore = databaseNonceStore;

/** Test seam: replace the nonce store (pass null to restore the DB store). */
export function __setActionNonceStoreForTests(store: ActionNonceStore | null): void {
  activeNonceStore = store ?? databaseNonceStore;
}

export function getActionNonceStore(): ActionNonceStore {
  return activeNonceStore;
}

// ─── 1. Replay guard ──────────────────────────────────────────────────────────

let _lenientReplayWarned = false;

/**
 * Rejects replayed and unauthenticated-in-time requests.
 *
 * Production, mutating method:
 *   missing timestamp or nonce   → 400 REPLAY_HEADERS_REQUIRED
 * Any environment, headers present:
 *   timestamp outside skew       → 400 REPLAY_REJECTED
 *   nonce already claimed        → 409 REPLAY_REJECTED   (handler never runs)
 *   nonce store unavailable      → 503 REPLAY_STORE_UNAVAILABLE (fail CLOSED)
 * Outside production with headers absent: allowed, warned once.
 */
export async function kevinActionReplayGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const tsHeader = req.headers[KEVIN_TIMESTAMP_HEADER];
  const nonceHeader = req.headers[KEVIN_NONCE_HEADER];
  const rawTs = Array.isArray(tsHeader) ? tsHeader[0] : tsHeader;
  const rawNonce = Array.isArray(nonceHeader) ? nonceHeader[0] : nonceHeader;
  const mutating = isMutatingMethod(req.method);

  if (!rawTs || !rawNonce) {
    if (mutating && isProduction()) {
      res.status(400).json({
        message: "X-Kevin-Timestamp and X-Kevin-Nonce are required",
        code: "REPLAY_HEADERS_REQUIRED",
      });
      return;
    }
    if (!_lenientReplayWarned) {
      _lenientReplayWarned = true;
      console.warn(
        JSON.stringify({
          event: "KEVIN_ACTION_REPLAY_HEADERS_MISSING",
          note: "Replay headers absent; permitted outside production only. Production requires X-Kevin-Timestamp + X-Kevin-Nonce on mutating requests.",
          method: req.method,
          path: req.path,
          nodeEnv: process.env.NODE_ENV ?? null,
          timestamp: new Date().toISOString(),
        }),
      );
    }
    next();
    return;
  }

  const tsMs = normalizeTimestampMs(String(rawTs));
  const skewMs = getAllowedSkewSeconds() * 1000;
  if (tsMs === null || Math.abs(Date.now() - tsMs) > skewMs) {
    res.status(400).json({
      message: "Request timestamp out of allowed window",
      code: "REPLAY_REJECTED",
    });
    return;
  }

  let claim: NonceClaim;
  try {
    claim = await activeNonceStore.claim(String(rawNonce));
  } catch (error: any) {
    // Fail CLOSED: a nonce we could not record is a nonce we cannot dedupe.
    console.error(
      JSON.stringify({
        event: "KEVIN_ACTION_NONCE_STORE_UNAVAILABLE",
        method: req.method,
        path: req.path,
        error: error?.message ?? "unknown",
        timestamp: new Date().toISOString(),
      }),
    );
    res.status(503).json({
      message: "Replay protection unavailable",
      code: "REPLAY_STORE_UNAVAILABLE",
    });
    return;
  }

  if (claim === "duplicate") {
    res.status(409).json({
      message: "Duplicate nonce — request already processed",
      code: "REPLAY_REJECTED",
    });
    return;
  }

  next();
}

// ─── 2. Organization allowlist ────────────────────────────────────────────────

/**
 * Parsed `KEVIN_ALLOWED_ORG_IDS`. Returns null when the env var is unset or
 * empty, meaning "no restriction configured".
 */
export function getAllowedOrgIds(): Set<string> | null {
  const raw = (process.env.KEVIN_ALLOWED_ORG_IDS ?? "").trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

export function isOrgAllowedForActionApi(orgId: string | null | undefined): boolean {
  const allowed = getAllowedOrgIds();
  if (!allowed) return true; // unset → unrestricted (warned at boot in production)
  if (!orgId) return true; // no org named; the route's own ORG_REQUIRED check applies
  return allowed.has(orgId);
}

/** Reads the org_id exactly the way resolveOrgIdFromRequest does. */
function requestedOrgId(req: Request): string | null {
  const raw =
    ((req as any).body?.org_id as string | undefined) ??
    (req.query?.org_id as string | undefined) ??
    (req.headers["x-org-id"] as string | undefined);
  return raw ? String(raw) : null;
}

let _allowlistUnsetWarned = false;

/**
 * Logs once, at boot, when production runs without an allowlist. Deliberately
 * does NOT fail closed: the live Kevin integration predates this env var and
 * must keep working until the operator sets it.
 */
export function warnIfOrgAllowlistUnset(): void {
  if (_allowlistUnsetWarned) return;
  if (!isProduction()) return;
  if (getAllowedOrgIds()) return;
  _allowlistUnsetWarned = true;
  console.warn(
    JSON.stringify({
      event: "KEVIN_ALLOWED_ORG_IDS_UNSET",
      note: "Kevin action API may act on ANY organization. Set KEVIN_ALLOWED_ORG_IDS to restrict it.",
      timestamp: new Date().toISOString(),
    }),
  );
}

export function kevinOrgAllowlistGuard(req: Request, res: Response, next: NextFunction): void {
  const orgId = requestedOrgId(req);
  if (isOrgAllowedForActionApi(orgId)) {
    next();
    return;
  }
  console.warn(
    JSON.stringify({
      event: "KEVIN_ORG_NOT_ALLOWLISTED",
      method: req.method,
      path: req.path,
      orgId,
      timestamp: new Date().toISOString(),
    }),
  );
  res.status(403).json({
    message: "Organization is not permitted for the internal service token",
    code: "ORG_NOT_ALLOWED",
  });
}

// ─── 3. Per-token rate limiter ────────────────────────────────────────────────

/**
 * Token bucket keyed by a hash of the presented bearer token.
 *
 * WEAKNESS, stated plainly: this counter lives in process memory. TrainEfficiency
 * runs on Replit autoscale, so N instances allow N × the limit, and a burst that
 * lands on fresh instances is not limited at all. It is kept as defence in depth
 * (it bounds a single hot instance and makes a brute-force loop visible in logs);
 * a real limit needs a shared store. server/middleware/public-rate-limiter.ts was
 * considered and does not fit: it keys by client IP, and every Kevin request
 * arrives from the same gateway address, so one caller would exhaust the bucket
 * for all of them.
 */
export const KEVIN_ACTION_RATE_LIMIT = 120; // requests
export const KEVIN_ACTION_RATE_WINDOW_MS = 60_000; // per minute

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function tokenKey(req: Request): string {
  const auth = req.headers["authorization"];
  const raw = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  // Hash: the bucket key must never be the token itself (it is logged on 429).
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/** Test seam: clear all buckets. */
export function __resetKevinActionRateLimiterForTests(): void {
  buckets.clear();
}

export function kevinActionRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = tokenKey(req);
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= KEVIN_ACTION_RATE_WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > KEVIN_ACTION_RATE_LIMIT) {
    console.warn(
      JSON.stringify({
        event: "KEVIN_ACTION_RATE_LIMIT_EXCEEDED",
        tokenFingerprint: key,
        count: bucket.count,
        windowMs: KEVIN_ACTION_RATE_WINDOW_MS,
        path: req.path,
        timestamp: new Date().toISOString(),
      }),
    );
    res.set("Retry-After", String(Math.ceil(KEVIN_ACTION_RATE_WINDOW_MS / 1000)));
    res.status(429).json({
      message: "Too many requests",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfterSeconds: Math.ceil(KEVIN_ACTION_RATE_WINDOW_MS / 1000),
    });
    return;
  }

  next();
}
