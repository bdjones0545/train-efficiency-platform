/**
 * kevin-webhook-routes.ts — Hardened Kevin callback webhook handler.
 *
 * Registers two paths that Kevin may POST results to:
 *   POST /api/kevin/webhooks/hermes   ← canonical (Kevin's gateway contract)
 *   POST /api/agent-callbacks/kevin   ← legacy alias (backward compat)
 *
 * Security:
 *  - HMAC-SHA256 verification using verifyKevinCallbackHeaders (golden-vector parity)
 *    Secret resolves from: KEVIN_CALLBACK_HMAC_SECRET → KEVIN_OUTBOUND_HMAC_SECRET
 *                          → TRAINEFFICIENCY_KEVIN_SIGNING_SECRET
 *  - Returns 503 (retryable) when HMAC is not yet configured — never bypasses silently
 *  - Returns 401 for invalid / stale signatures
 *  - Callback-ID nonce deduplication (kevin_callback_nonces table)
 *  - Explicit state-transition enforcement (prevents backward moves)
 *  - Completed-path persisted atomically via db.transaction()
 *  - Nonce released on retryable errors so Kevin can retry with the same request ID
 *  - Returns { ok, retryable, error? } so Kevin knows whether to retry
 *
 * Accepted Kevin callback statuses:
 *   started          — Kevin's canonical "task is running" signal
 *   running          — legacy alias for started (backward compat)
 *   completed        — task finished, result is attached
 *   failed           — task failed, error is attached
 *   requires_approval — paused pending human approval
 *   blocked_by_policy — blocked by TE policy engine
 *   cancelled        — task was cancelled
 */

import type { Express } from "express";
import crypto from "node:crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { publicRateLimiter } from "./middleware/public-rate-limiter";
import {
  isKevinCallbackHmacConfigured,
  getKevinCallbackHmacSource,
  verifyKevinCallbackHeaders,
} from "./services/kevin-outbound-auth";
import { extractCallbackNonce } from "./lib/kevin-hmac";
import { auditAgentJob } from "./services/kevin-agent-audit";

// ─── Constants ────────────────────────────────────────────────────────────────

/** All statuses Kevin's gateway may send in a callback. */
const ALLOWED_CALLBACK_STATUSES = new Set([
  "started",           // Kevin's canonical running signal
  "running",           // legacy alias (TE's Phase 1 draft used this)
  "requires_approval",
  "completed",
  "failed",
  "blocked_by_policy",
  "cancelled",
]);

/** States that are considered terminal — no further transitions allowed. */
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked_by_policy",
]);

/**
 * Valid forward state transitions.
 * Map: currentStatus → Set of allowed next statuses from Kevin callback.
 * Any transition not in this table is rejected as INVALID_STATE_TRANSITION.
 */
const VALID_TRANSITIONS: Record<string, Set<string>> = {
  requested:    new Set(["started", "running", "completed", "failed", "blocked_by_policy", "cancelled"]),
  dispatching:  new Set(["started", "running", "completed", "failed", "blocked_by_policy", "cancelled"]),
  queued:       new Set(["started", "running", "requires_approval", "completed", "failed", "blocked_by_policy", "cancelled"]),
  started:      new Set(["requires_approval", "completed", "failed", "blocked_by_policy", "cancelled"]),
  running:      new Set(["requires_approval", "completed", "failed", "blocked_by_policy", "cancelled"]),
  requires_approval: new Set(["completed", "failed", "cancelled"]),
};

/**
 * Map verifier error codes → stable HTTP status + client error tokens.
 * Keeps the response contract stable even if the underlying verifier changes.
 */
function mapHmacError(code: string): { http: number; error: string; retryable: boolean } {
  switch (code) {
    case "MISSING_TIMESTAMP":
    case "MISSING_SIGNATURE":
    case "BAD_VERSION":
    case "BAD_SIGNATURE":
      return { http: 401, error: "SIGNATURE_INVALID", retryable: false };
    case "STALE_TIMESTAMP":
      return { http: 401, error: "STALE_TIMESTAMP", retryable: false };
    case "HMAC_UNCONFIGURED":
      return { http: 503, error: "HMAC_UNCONFIGURED", retryable: true };
    default:
      return { http: 401, error: code || "SIGNATURE_INVALID", retryable: false };
  }
}

/**
 * Releases a nonce from kevin_callback_nonces so that Kevin can safely retry
 * the same X-Kevin-Request-ID after a transient (retryable) server error.
 * Must be called before returning any response with retryable:true.
 * Non-fatal: if the DELETE fails the nonce will expire via the cleanup cron.
 */
async function releaseNonce(nonce: string | null | undefined): Promise<void> {
  if (!nonce) return;
  try {
    await db.execute(sql`
      DELETE FROM kevin_callback_nonces WHERE id = ${nonce}
    `);
  } catch {
    // Non-fatal — cleanup cron will expire it; do not mask the outer error
  }
}

// ─── DB bootstrap for nonce table ────────────────────────────────────────────

let _nonceTableReady = false;
let _nonceCleanupStarted = false;

export function startCallbackNonceCleanup(): void {
  if (_nonceCleanupStarted) return;
  _nonceCleanupStarted = true;
  setInterval(async () => {
    try {
      await db.execute(sql`
        DELETE FROM kevin_callback_nonces
        WHERE received_at < NOW() - INTERVAL '60 minutes'
      `);
    } catch {
      // Non-fatal — old nonces expire naturally; next cleanup will catch them
    }
  }, 10 * 60 * 1000);
}

export async function ensureCallbackNoncesTable(): Promise<void> {
  if (_nonceTableReady) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kevin_callback_nonces (
      id           TEXT PRIMARY KEY,
      received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      job_id       TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS kcn_received ON kevin_callback_nonces(received_at)
  `);

  _nonceTableReady = true;

  startCallbackNonceCleanup();
}

// ─── Raw body middleware ──────────────────────────────────────────────────────

/**
 * Captures raw request body for HMAC verification.
 * Handles the case where express.json() has already consumed the stream.
 */
function captureRawBody(req: any, _res: any, next: any): void {
  // Already captured
  if (Buffer.isBuffer(req.rawBody) || typeof req.rawBody === "string") {
    return next();
  }
  // express.json() already parsed it — reconstitute from parsed object
  if (req.body !== undefined) {
    req.rawBody = Buffer.from(
      typeof req.body === "string" ? req.body : JSON.stringify(req.body),
    );
    return next();
  }
  // Stream not yet consumed — collect raw bytes
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
  req.on("error", () => next());
}

// ─── Core callback handler ────────────────────────────────────────────────────

/**
 * Processes an inbound Kevin callback for the given request path.
 * `requestPath` is the exact path Kevin POST-ed to (used in audit logs).
 *
 * HMAC contract (golden-vector parity):
 *  - Verified via verifyKevinCallbackHeaders (server/services/kevin-outbound-auth.ts)
 *  - Secret resolved from env chain: KEVIN_CALLBACK_HMAC_SECRET →
 *    KEVIN_OUTBOUND_HMAC_SECRET → TRAINEFFICIENCY_KEVIN_SIGNING_SECRET
 *  - Returns 503 (retryable) when secret is not yet configured
 *  - Returns 401 for invalid/stale signatures
 *
 * Nonce lifecycle contract:
 *  1. HMAC and body validation happen BEFORE nonce insertion (no nonce consumed on invalid input).
 *  2. Nonce insert is FAIL-CLOSED: DB error → return retryable error, don't bypass dedup.
 *  3. A `try-catch-finally` block wraps ALL post-nonce processing. If any retryable failure
 *     is detected (flagged via `retryableFailure = true`), the finally block releases the
 *     nonce so Kevin can safely retry with the same X-Kevin-Request-ID.
 *  4. Non-retryable failures (validation, state rejections) do NOT set `retryableFailure`
 *     so the nonce is kept — Kevin should not re-deliver those.
 */
async function handleKevinCallback(req: any, res: any, requestPath: string): Promise<void> {
  const rawBody: Buffer =
    req.rawBody ??
    (Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {})));

  const rawBodyStr = rawBody.toString("utf8");

  // ── HMAC guard: fail-closed when secret is not yet configured ─────────────
  if (!isKevinCallbackHmacConfigured()) {
    console.warn(JSON.stringify({
      event: "KEVIN_CALLBACK_HMAC_UNCONFIGURED",
      path: requestPath,
      hmacEnv: getKevinCallbackHmacSource(),
      timestamp: new Date().toISOString(),
    }));
    return void res.status(503).json({
      ok: false,
      retryable: true,
      error: "HMAC_UNCONFIGURED",
      hmacEnv: getKevinCallbackHmacSource(),
    });
  }

  // ── HMAC verification (before nonce — no nonce consumed on bad signature) ─
  const verification = verifyKevinCallbackHeaders({
    rawBody: rawBodyStr,
    timestampHeader: (req.headers["x-kevin-timestamp"] as string) ?? null,
    signatureHeader: (req.headers["x-kevin-signature"] as string) ?? null,
  });

  if (!verification.ok) {
    const mapped = mapHmacError(verification.code);
    auditAgentJob("agent.job.invalid_signature_rejected", {
      reason: verification.code,
      message: verification.message,
    });
    console.log(JSON.stringify({
      event: "KEVIN_CALLBACK_SIGNATURE_REJECTED",
      code: verification.code,
      path: requestPath,
      timestamp: new Date().toISOString(),
    }));
    return void res.status(mapped.http).json({
      ok: false,
      retryable: mapped.retryable,
      error: mapped.error,
      code: verification.code,
    });
  }

  // ── Extract nonce (before parsing body) ────────────────────────────────────
  const callbackNonce = extractCallbackNonce(
    req.headers as Record<string, string | string[] | undefined>,
  );

  // ── Parse body (before nonce insert — no nonce consumed on bad JSON) ───────
  let body: any;
  try {
    body = JSON.parse(rawBodyStr);
  } catch {
    return void res.status(400).json({ ok: false, retryable: false, error: "INVALID_JSON" });
  }

  const {
    schemaVersion,
    taskId: jobId,
    remoteTaskId,
    executionId,
    agentId,
    taskType,
    capability,
    organizationId,
    correlationId,
    status: rawCallbackStatus,
    completedAt,
    result,
    error: callbackError,
  } = body ?? {};

  // Normalise: Kevin sends "started"; legacy path sent "running". Both accepted.
  const callbackStatus: string = rawCallbackStatus === "running" ? "started" : rawCallbackStatus;

  // ── Schema validation (before nonce insert — no nonce consumed on bad schema) ─
  if (
    schemaVersion !== "1.0" ||
    !jobId ||
    !agentId ||
    !taskType ||
    !organizationId ||
    !rawCallbackStatus ||
    !ALLOWED_CALLBACK_STATUSES.has(rawCallbackStatus)
  ) {
    return void res.status(400).json({ ok: false, retryable: false, error: "INVALID_SCHEMA" });
  }

  auditAgentJob("agent.job.callback_received", {
    jobId, remoteTaskId, executionId, agentId, taskType,
    capability, organizationId, correlationId,
    callbackStatus, rawCallbackStatus,
    path: requestPath,
    nonce: callbackNonce ? "[present]" : "[absent]",
  });

  // ── Nonce gate — FAIL-CLOSED ───────────────────────────────────────────────
  // Any DB error during nonce insert causes a retryable error; we never bypass
  // dedup silently. The nonce must be inserted BEFORE job processing begins.
  let nonceInserted = false;

  if (callbackNonce) {
    let insertRows: any[];
    try {
      const insertResult = await db.execute(sql`
        INSERT INTO kevin_callback_nonces (id, received_at, job_id)
        VALUES (${callbackNonce}, NOW(), ${jobId})
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `);
      insertRows = Array.isArray(insertResult)
        ? insertResult
        : (insertResult as any).rows ?? [];
    } catch (nonceErr) {
      // Fail-closed: cannot guarantee dedup → Kevin must retry on a fresh attempt
      console.error(JSON.stringify({
        event: "KEVIN_CALLBACK_NONCE_DB_ERROR",
        jobId, path: requestPath,
        error: String((nonceErr as Error)?.message ?? nonceErr),
        timestamp: new Date().toISOString(),
      }));
      return void res.status(500).json({ ok: false, retryable: true, error: "NONCE_DB_ERROR" });
    }

    if (insertRows.length === 0) {
      // Duplicate nonce — idempotent ack; nonce was NOT inserted by us, so no release needed
      auditAgentJob("agent.job.duplicate_nonce_rejected", {
        jobId, callbackNonce: "[present]", callbackStatus, path: requestPath,
      });
      console.log(JSON.stringify({
        event: "KEVIN_CALLBACK_DUPLICATE_NONCE",
        jobId, path: requestPath, timestamp: new Date().toISOString(),
      }));
      return void res.status(200).json({ ok: true, retryable: false, idempotent: true });
    }

    // Fresh nonce inserted — all retryable failures from here must release it
    nonceInserted = true;
  }

  // ── Post-nonce processing: try-catch-finally for nonce lifecycle ───────────
  // `retryableFailure = true` is set at every path that returns `retryable: true`.
  // The finally block releases the nonce on retryable failures so Kevin's next
  // retry with the same X-Kevin-Request-ID passes the nonce gate.
  let retryableFailure = false;

  try {
    // ── Load and validate the job ──────────────────────────────────────────────
    let jobData: any[];
    try {
      const jobRows = await db.execute(sql`
        SELECT id, organization_id, agent_id, task_type, status,
               correlation_id, remote_task_id, subject_id, requested_at
        FROM agent_jobs
        WHERE id = ${jobId}
        LIMIT 1
      `);
      jobData = Array.isArray(jobRows) ? jobRows : (jobRows as any).rows ?? [];
    } catch (err) {
      retryableFailure = true;
      console.error(JSON.stringify({
        event: "KEVIN_CALLBACK_JOB_LOOKUP_ERROR",
        jobId, error: String((err as Error)?.message ?? err),
        timestamp: new Date().toISOString(),
      }));
      return void res.status(500).json({ ok: false, retryable: true, error: "DB_ERROR" });
    }

    if (!jobData.length) {
      // Unknown job — non-retryable; Kevin should not send callbacks for unknown jobs
      return void res.status(200).json({ ok: false, retryable: false, error: "JOB_NOT_FOUND" });
    }

    const job = jobData[0];
    const currentStatus = String(job.status);

    // ── Cross-field validation ─────────────────────────────────────────────────
    if (String(job.organization_id) !== String(organizationId)) {
      return void res.status(200).json({ ok: false, retryable: false, error: "ORG_MISMATCH" });
    }
    if (String(job.agent_id) !== agentId) {
      return void res.status(200).json({ ok: false, retryable: false, error: "AGENT_MISMATCH" });
    }
    if (String(job.task_type) !== taskType) {
      return void res.status(200).json({ ok: false, retryable: false, error: "TASK_TYPE_MISMATCH" });
    }
    if (correlationId && String(job.correlation_id) !== correlationId) {
      return void res.status(200).json({ ok: false, retryable: false, error: "CORRELATION_MISMATCH" });
    }
    if (remoteTaskId && job.remote_task_id && String(job.remote_task_id) !== remoteTaskId) {
      return void res.status(200).json({ ok: false, retryable: false, error: "REMOTE_TASK_ID_MISMATCH" });
    }

    // ── Idempotency: terminal job replayed ────────────────────────────────────
    if (TERMINAL_STATUSES.has(currentStatus)) {
      auditAgentJob("agent.job.replayed_callback_rejected", { jobId, currentStatus, callbackStatus, remoteTaskId });
      return void res.status(200).json({ ok: true, idempotent: true });
    }

    // ── Idempotency: same effective status (in-progress heartbeats) ──────────
    // "started" (Kevin canonical) and "running" (TE internal) are the same state.
    const effectiveCurrent = currentStatus === "running" ? "started" : currentStatus;
    if (effectiveCurrent === callbackStatus && !TERMINAL_STATUSES.has(currentStatus)) {
      auditAgentJob("agent.job.idempotent_status_ack", { jobId, currentStatus, callbackStatus, remoteTaskId });
      return void res.status(200).json({ ok: true, retryable: false, idempotent: true });
    }

    // ── State-transition enforcement ───────────────────────────────────────────
    const allowedNext = VALID_TRANSITIONS[currentStatus];
    if (!allowedNext || !allowedNext.has(callbackStatus)) {
      auditAgentJob("agent.job.invalid_state_transition", { jobId, currentStatus, callbackStatus, remoteTaskId });
      console.log(JSON.stringify({
        event: "KEVIN_CALLBACK_INVALID_TRANSITION",
        jobId, from: currentStatus, to: callbackStatus, timestamp: new Date().toISOString(),
      }));
      return void res.status(200).json({
        ok: false, retryable: false, error: "INVALID_STATE_TRANSITION",
        from: currentStatus, to: callbackStatus,
      });
    }

    // ── Process by normalised status ───────────────────────────────────────────

    if (callbackStatus === "started") {
      await db.execute(sql`
        UPDATE agent_jobs
        SET status = 'running',
            execution_id = COALESCE(execution_id, ${executionId ?? null}),
            last_callback_status = ${rawCallbackStatus},
            callback_receipt_at = COALESCE(callback_receipt_at, NOW()),
            started_at = COALESCE(started_at, NOW()),
            updated_at = NOW()
        WHERE id = ${jobId}
      `);
      auditAgentJob("agent.job.started", { jobId, remoteTaskId, executionId, agentId, organizationId });
      return void res.status(200).json({ ok: true, retryable: false });
    }

    if (callbackStatus === "requires_approval") {
      await db.execute(sql`
        UPDATE agent_jobs
        SET status = 'requires_approval',
            last_callback_status = ${rawCallbackStatus},
            callback_receipt_at = COALESCE(callback_receipt_at, NOW()),
            updated_at = NOW()
        WHERE id = ${jobId}
      `);
      return void res.status(200).json({ ok: true, retryable: false });
    }

    if (callbackStatus === "blocked_by_policy") {
      await db.execute(sql`
        UPDATE agent_jobs
        SET status = 'blocked_by_policy',
            last_callback_status = ${rawCallbackStatus},
            callback_receipt_at = COALESCE(callback_receipt_at, NOW()),
            updated_at = NOW()
        WHERE id = ${jobId}
      `);
      auditAgentJob("agent.job.blocked", { jobId, agentId, organizationId });
      return void res.status(200).json({ ok: true, retryable: false });
    }

    if (callbackStatus === "cancelled") {
      await db.execute(sql`
        UPDATE agent_jobs
        SET status = 'cancelled',
            last_callback_status = ${rawCallbackStatus},
            callback_receipt_at = COALESCE(callback_receipt_at, NOW()),
            cancelled_at = NOW(),
            updated_at = NOW()
        WHERE id = ${jobId}
      `);
      auditAgentJob("agent.job.cancelled", { jobId, agentId, organizationId });
      return void res.status(200).json({ ok: true, retryable: false });
    }

    if (callbackStatus === "failed") {
      const errCode = callbackError?.code ?? "kevin_internal_error";
      const errMsg = callbackError?.message ?? "Agent task failed.";
      const retryableFlag = callbackError?.retryable === true;
      await db.execute(sql`
        UPDATE agent_jobs
        SET status = 'failed',
            error_code = ${errCode},
            error_message = ${errMsg},
            retryable = ${retryableFlag},
            last_callback_status = ${rawCallbackStatus},
            callback_receipt_at = COALESCE(callback_receipt_at, NOW()),
            failed_at = NOW(),
            result_payload = ${JSON.stringify(body)},
            updated_at = NOW()
        WHERE id = ${jobId}
      `);
      auditAgentJob("agent.job.failed", {
        jobId, agentId, organizationId,
        errorCode: errCode, remoteTaskId, retryable: retryableFlag,
      });
      return void res.status(200).json({ ok: true, retryable: false });
    }

    // ── COMPLETED — atomic via db.transaction() ────────────────────────────────
    if (callbackStatus === "completed") {
      if (!result) {
        return void res.status(400).json({ ok: false, retryable: false, error: "MISSING_RESULT" });
      }

      // ── Generic agents (non-retention): persist result on the job itself ────
      if (agentId !== "retention-agent") {
        const completedTsGeneric = completedAt
          ? new Date(completedAt).toISOString()
          : new Date().toISOString();
        try {
          await db.execute(sql`
            UPDATE agent_jobs
            SET status               = 'completed',
                completed_at         = ${completedTsGeneric},
                execution_id         = COALESCE(execution_id, ${executionId ?? null}),
                last_callback_status = ${rawCallbackStatus},
                callback_receipt_at  = COALESCE(callback_receipt_at, NOW()),
                result_payload       = ${JSON.stringify(result)},
                updated_at           = NOW()
            WHERE id = ${jobId}
          `);
        } catch (err) {
          retryableFailure = true;
          console.error(JSON.stringify({
            event: "KEVIN_CALLBACK_COMPLETED_DB_ERROR",
            jobId, error: String((err as Error)?.message ?? err),
            timestamp: new Date().toISOString(),
          }));
          return void res.status(500).json({ ok: false, retryable: true, error: "DB_ERROR" });
        }

        auditAgentJob("agent.job.completed", {
          jobId, agentId, taskType, organizationId, remoteTaskId,
          executionId, correlationId,
        });
        return void res.status(200).json({ ok: true, retryable: false });
      }

      const {
        clientId: resultClientId,
        riskLevel,
        riskScore,
        confidenceScore,
        summary,
        riskFactors,
        recommendedActions,
        draftMessage,
        evidence,
        modelVersion,
      } = result;

      if (!riskLevel || riskScore == null || confidenceScore == null || !summary) {
        return void res.status(400).json({ ok: false, retryable: false, error: "INCOMPLETE_RESULT" });
      }

      const VALID_RISK_LEVELS = ["low", "moderate", "high", "critical"];
      if (!VALID_RISK_LEVELS.includes(riskLevel)) {
        return void res.status(400).json({ ok: false, retryable: false, error: "INVALID_RISK_LEVEL" });
      }

      const clientId = resultClientId ?? String(job.subject_id);
      const analysisId = crypto.randomUUID();
      const completedTs = completedAt ? new Date(completedAt).toISOString() : new Date().toISOString();

      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`
            INSERT INTO retention_agent_analyses (
              id, organization_id, client_id, agent_job_id,
              risk_level, risk_score, confidence_score, summary,
              risk_factors, recommended_actions, draft_message,
              evidence, model_version, created_at, updated_at
            ) VALUES (
              ${analysisId}, ${organizationId}, ${clientId}, ${jobId},
              ${riskLevel}, ${riskScore}, ${confidenceScore}, ${summary},
              ${JSON.stringify(riskFactors ?? [])},
              ${JSON.stringify(recommendedActions ?? [])},
              ${draftMessage ?? null},
              ${JSON.stringify(evidence ?? [])},
              ${modelVersion ?? null},
              NOW(), NOW()
            )
            ON CONFLICT (agent_job_id) DO UPDATE SET
              risk_level          = EXCLUDED.risk_level,
              risk_score          = EXCLUDED.risk_score,
              confidence_score    = EXCLUDED.confidence_score,
              summary             = EXCLUDED.summary,
              risk_factors        = EXCLUDED.risk_factors,
              recommended_actions = EXCLUDED.recommended_actions,
              draft_message       = EXCLUDED.draft_message,
              evidence            = EXCLUDED.evidence,
              model_version       = EXCLUDED.model_version,
              updated_at          = NOW()
          `);

          await tx.execute(sql`
            UPDATE agent_jobs
            SET status               = 'completed',
                completed_at         = ${completedTs},
                execution_id         = COALESCE(execution_id, ${executionId ?? null}),
                last_callback_status = ${rawCallbackStatus},
                callback_receipt_at  = COALESCE(callback_receipt_at, NOW()),
                result_payload       = ${JSON.stringify(result)},
                updated_at           = NOW()
            WHERE id = ${jobId}
          `);
        });
      } catch (err) {
        retryableFailure = true;
        console.error(JSON.stringify({
          event: "KEVIN_CALLBACK_COMPLETED_DB_ERROR",
          jobId, error: String((err as Error)?.message ?? err),
          timestamp: new Date().toISOString(),
        }));
        return void res.status(500).json({ ok: false, retryable: true, error: "DB_ERROR" });
      }

      const durationMs = job.requested_at
        ? Date.now() - new Date(job.requested_at as string).getTime()
        : undefined;

      auditAgentJob("agent.job.completed", {
        jobId, agentId, taskType, organizationId, remoteTaskId,
        executionId, clientId, correlationId, durationMs,
      });
      auditAgentJob("retention.analysis.created", { jobId, organizationId, clientId, agentId });

      return void res.status(200).json({ ok: true, retryable: false, analysisId });
    }

    return void res.status(400).json({ ok: false, retryable: false, error: "UNHANDLED_STATUS" });

  } catch (unexpectedErr) {
    // Catch-all for any unhandled exception after nonce insertion.
    // Treat as retryable so Kevin can redeliver the callback.
    retryableFailure = true;
    console.error(JSON.stringify({
      event: "KEVIN_CALLBACK_UNEXPECTED_ERROR",
      jobId, path: requestPath,
      error: String((unexpectedErr as Error)?.message ?? unexpectedErr),
      timestamp: new Date().toISOString(),
    }));
    return void res.status(500).json({ ok: false, retryable: true, error: "INTERNAL_ERROR" });

  } finally {
    // Release nonce on any retryable failure so Kevin can retry with the same
    // X-Kevin-Request-ID and have it processed normally rather than idempotent-acked.
    if (retryableFailure && nonceInserted && callbackNonce) {
      await releaseNonce(callbackNonce);
    }
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

// 100 callbacks per minute (server-to-server from Kevin)
const callbackLimiter = publicRateLimiter(100, 60_000, "kevin-callback");

export function registerKevinWebhookRoutes(app: Express): void {
  /**
   * POST /api/kevin/webhooks/hermes — canonical callback path.
   * This is the URL TE should configure in Kevin's gateway:
   *   https://{REPLIT_DEV_DOMAIN}/api/kevin/webhooks/hermes
   */
  app.post(
    "/api/kevin/webhooks/hermes",
    callbackLimiter,
    captureRawBody,
    (req: any, res: any) => handleKevinCallback(req, res, "/api/kevin/webhooks/hermes"),
  );

  /**
   * POST /api/agent-callbacks/kevin — legacy alias.
   * Kept for backward compatibility; delegates to the same hardened handler.
   * Kevin's callback URL in existing jobs references this path.
   */
  app.post(
    "/api/agent-callbacks/kevin",
    callbackLimiter,
    captureRawBody,
    (req: any, res: any) => handleKevinCallback(req, res, "/api/agent-callbacks/kevin"),
  );
}
