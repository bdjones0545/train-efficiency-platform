/**
 * kevin-agent-routes.ts — Kevin agent integration routes for TrainEfficiency.
 *
 * Phase 1: Retention Agent vertical slice.
 *
 * Endpoints:
 *   POST /api/clients/:clientId/retention-analysis     — trigger analysis
 *   GET  /api/agent-jobs/:jobId                        — poll job status
 *   GET  /api/clients/:clientId/retention-analyses     — list results
 *   GET  /api/clients/:clientId/retention-analyses/latest — latest result
 *   POST /api/agent-callbacks/kevin                    — Kevin callback (server-to-server)
 *
 * Security: authenticated, org-isolated, HMAC-signed, rate-limited, idempotent.
 * Never exposed to the browser directly (Kevin traffic proxied through this backend).
 */

import type { Express } from "express";
import crypto from "node:crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { isAuthenticated } from "./replit_integrations/auth";
import { resolveOrgIdOrThrow } from "./lib/resolve-org-id";
import { publicRateLimiter } from "./middleware/public-rate-limiter";
import { getAgent, isTaskTypeAllowed } from "./services/kevin-agent-registry";
import { getKevinAgentConfig, validateKevinAgentConfig } from "./services/kevin-agent-config";
import { dispatchKevinTask, KevinDispatchError } from "./services/kevin-gateway-client";
import { buildRetentionContext } from "./services/retention-context-service";
import { verifyCallbackSignature } from "./lib/kevin-hmac";
import { auditAgentJob } from "./services/kevin-agent-audit";

// ─── Constants ────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked_by_policy",
]);

const ALLOWED_CALLBACK_STATUSES = new Set([
  "running",
  "requires_approval",
  "completed",
  "failed",
  "blocked_by_policy",
  "cancelled",
]);

// ─── DB Bootstrap ─────────────────────────────────────────────────────────────

export async function createAgentTables(): Promise<void> {
  // agent_job_status enum
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_job_status') THEN
        CREATE TYPE agent_job_status AS ENUM (
          'requested','dispatching','queued','running','requires_approval',
          'completed','failed','cancelled','timed_out','blocked_by_policy'
        );
      END IF;
    END $$
  `);

  // retention_risk_level enum
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'retention_risk_level') THEN
        CREATE TYPE retention_risk_level AS ENUM ('low','moderate','high','critical');
      END IF;
    END $$
  `);

  // agent_jobs table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id                  TEXT PRIMARY KEY,
      organization_id     TEXT NOT NULL,
      agent_id            TEXT NOT NULL,
      task_type           TEXT NOT NULL,
      status              agent_job_status NOT NULL DEFAULT 'requested',
      requested_by_user_id TEXT NOT NULL,
      subject_type        TEXT,
      subject_id          TEXT,
      request_payload     JSONB,
      result_payload      JSONB,
      error_code          TEXT,
      error_message       TEXT,
      remote_task_id      TEXT,
      idempotency_key     TEXT NOT NULL,
      correlation_id      TEXT NOT NULL,
      attempt_count       INTEGER NOT NULL DEFAULT 0,
      requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_at         TIMESTAMPTZ,
      started_at          TIMESTAMPTZ,
      completed_at        TIMESTAMPTZ,
      failed_at           TIMESTAMPTZ,
      cancelled_at        TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_jobs_org ON agent_jobs(organization_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_jobs_status ON agent_jobs(status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_jobs_agent ON agent_jobs(agent_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_jobs_subject ON agent_jobs(subject_type, subject_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_jobs_remote_task ON agent_jobs(remote_task_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_jobs_created ON agent_jobs(created_at)`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_idempotency ON agent_jobs(idempotency_key)
  `);

  // retention_agent_analyses table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS retention_agent_analyses (
      id                TEXT PRIMARY KEY,
      organization_id   TEXT NOT NULL,
      client_id         TEXT NOT NULL,
      agent_job_id      TEXT NOT NULL,
      risk_level        retention_risk_level NOT NULL,
      risk_score        INTEGER NOT NULL,
      confidence_score  INTEGER NOT NULL,
      summary           TEXT NOT NULL,
      risk_factors      JSONB,
      recommended_actions JSONB,
      draft_message     TEXT,
      evidence          JSONB,
      model_version     TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS raa_org ON retention_agent_analyses(organization_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS raa_client ON retention_agent_analyses(client_id)`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS raa_job ON retention_agent_analyses(agent_job_id)
  `);

  console.log(
    JSON.stringify({
      event: "KEVIN_AGENT_TABLES_READY",
      timestamp: new Date().toISOString(),
    }),
  );
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

// 10 task creation requests per user per minute
const taskCreationLimiter = publicRateLimiter(10, 60_000, "kevin-task-create");
// 100 callbacks per minute (server-to-server from Kevin)
const callbackLimiter = publicRateLimiter(100, 60_000, "kevin-callback");

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getUserId(req: any): string {
  return req.user?.claims?.sub ?? req.user?.id ?? req.user?.userId ?? "";
}

function getUserRole(req: any): string {
  return (req as any)._authProfile?.role ?? req.user?.role ?? "member";
}

/** Require admin or owner role */
function requireAdmin(req: any, res: any, next: any): void {
  const role = getUserRole(req);
  if (role !== "admin" && role !== "owner") {
    res.status(403).json({ error: "FORBIDDEN", message: "Admin or owner role required." });
    return;
  }
  next();
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerKevinAgentRoutes(app: Express): void {
  // ── POST /api/clients/:clientId/retention-analysis ──────────────────────────
  // Triggers a retention risk analysis for a client via Kevin.
  app.post(
    "/api/clients/:clientId/retention-analysis",
    isAuthenticated,
    requireAdmin,
    taskCreationLimiter,
    async (req: any, res: any) => {
      const { clientId } = req.params as { clientId: string };
      const userId = getUserId(req);
      const userRole = getUserRole(req);

      let orgId: string;
      try {
        orgId = await resolveOrgIdOrThrow(req);
      } catch {
        return res.status(403).json({ error: "ORG_RESOLUTION_FAILED", message: "Organization could not be resolved." });
      }

      // ── Validate agent is enabled ─────────────────────────────────────────
      const agentId = "retention-agent";
      const taskType = "evaluate_client_retention_risk";

      if (!isTaskTypeAllowed(agentId, taskType)) {
        return res.status(422).json({
          error: "AGENT_DISABLED",
          message: "The Retention Agent is not enabled.",
        });
      }

      // ── Validate client belongs to org ────────────────────────────────────
      const clientRows = await db.execute(sql`
        SELECT u.id FROM users u
        JOIN user_profiles up ON up.user_id = u.id
        WHERE u.id = ${clientId} AND up.organization_id = ${orgId}
        LIMIT 1
      `);
      const clientData = Array.isArray(clientRows) ? clientRows : (clientRows as any).rows ?? [];
      if (!clientData.length) {
        return res.status(404).json({
          error: "CLIENT_NOT_FOUND",
          message: "Client not found in your organization.",
        });
      }

      // ── Idempotency key — scoped to org + agent + client ──────────────────
      const idempotencyKey = `${orgId}:${agentId}:${taskType}:${clientId}`;

      // ── Check for existing non-terminal job (return it) ───────────────────
      const existing = await db.execute(sql`
        SELECT id, status, agent_id, task_type, subject_id, created_at
        FROM agent_jobs
        WHERE idempotency_key = ${idempotencyKey}
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const existingRows = Array.isArray(existing) ? existing : (existing as any).rows ?? [];

      if (existingRows.length > 0) {
        const job = existingRows[0];
        const status = String(job.status);
        // Return existing job if still active (non-terminal)
        if (!TERMINAL_STATUSES.has(status)) {
          return res.json({
            success: true,
            idempotent: true,
            job: formatJobResponse(job),
          });
        }
        // For terminal jobs, allow re-run with a new unique key
      }

      // ── Create agent job ──────────────────────────────────────────────────
      const jobId = crypto.randomUUID();
      const correlationId = crypto.randomUUID();
      // Make idempotency key unique per run for re-runs after terminal state
      const uniqueKey = `${idempotencyKey}:${jobId}`;

      // Build context before inserting job (validates client exists)
      const context = await buildRetentionContext(clientId, orgId);
      if (!context) {
        return res.status(404).json({
          error: "CLIENT_CONTEXT_UNAVAILABLE",
          message: "Could not build retention context for this client.",
        });
      }

      const requestPayload = {
        agentId,
        taskType,
        clientId,
        organizationId: orgId,
        requestedByUserId: userId,
      };

      await db.execute(sql`
        INSERT INTO agent_jobs (
          id, organization_id, agent_id, task_type, status,
          requested_by_user_id, subject_type, subject_id,
          request_payload, idempotency_key, correlation_id,
          attempt_count, requested_at, created_at, updated_at
        ) VALUES (
          ${jobId}, ${orgId}, ${agentId}, ${taskType}, 'requested',
          ${userId}, 'client', ${clientId},
          ${JSON.stringify(requestPayload)}, ${uniqueKey}, ${correlationId},
          1, NOW(), NOW(), NOW()
        )
      `);

      auditAgentJob("agent.job.requested", {
        jobId,
        agentId,
        taskType,
        organizationId: orgId,
        userId,
        clientId,
        correlationId,
      });

      // ── Dispatch to Kevin (async — return quickly) ────────────────────────
      const cfg = getKevinAgentConfig();
      if (cfg.enabled) {
        // Fire-and-forget — do not keep HTTP request open
        dispatchKevinTask(
          jobId,
          agentId,
          taskType,
          orgId,
          userId,
          userRole,
          "client",
          clientId,
          context,
          uniqueKey,
          correlationId,
        ).catch((err: KevinDispatchError | Error) => {
          // Already logged and DB updated inside dispatchKevinTask
          console.log(
            JSON.stringify({
              event: "KEVIN_DISPATCH_ERROR_BACKGROUND",
              jobId,
              code: (err as KevinDispatchError).code ?? "unknown",
              timestamp: new Date().toISOString(),
            }),
          );
        });

        return res.status(202).json({
          success: true,
          job: {
            id: jobId,
            status: "queued",
            agentId,
            taskType,
            clientId,
            createdAt: new Date().toISOString(),
          },
        });
      }

      // Integration disabled — job created but not dispatched
      await db.execute(sql`
        UPDATE agent_jobs
        SET status = 'failed', error_code = 'kevin_disabled',
            error_message = 'Kevin integration is disabled.',
            failed_at = NOW(), updated_at = NOW()
        WHERE id = ${jobId}
      `);

      return res.status(503).json({
        error: "INTEGRATION_DISABLED",
        message: "Kevin agent integration is not enabled. Contact your administrator.",
      });
    },
  );

  // ── GET /api/agent-jobs/:jobId ─────────────────────────────────────────────
  // Poll job status. Enforces org isolation.
  app.get("/api/agent-jobs/:jobId", isAuthenticated, async (req: any, res: any) => {
    const { jobId } = req.params as { jobId: string };

    let orgId: string;
    try {
      orgId = await resolveOrgIdOrThrow(req);
    } catch {
      return res.status(403).json({ error: "ORG_RESOLUTION_FAILED" });
    }

    const rows = await db.execute(sql`
      SELECT id, organization_id, agent_id, task_type, status,
             subject_type, subject_id, error_code, error_message,
             remote_task_id, correlation_id, attempt_count,
             requested_at, accepted_at, started_at, completed_at,
             failed_at, cancelled_at, created_at, updated_at
      FROM agent_jobs
      WHERE id = ${jobId}
      LIMIT 1
    `);
    const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

    if (!data.length) {
      return res.status(404).json({ error: "JOB_NOT_FOUND" });
    }

    const job = data[0];
    if (String(job.organization_id) !== orgId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const isTerminal = TERMINAL_STATUSES.has(String(job.status));
    const userId = getUserId(req);

    auditAgentJob("retention.analysis.viewed", {
      jobId,
      organizationId: orgId,
      userId,
      status: String(job.status),
    });

    return res.json({
      job: formatJobResponse(job),
      meta: {
        isTerminal,
        canRerun:
          isTerminal && String(job.status) !== "completed",
        pollIntervalMs: isTerminal ? null : 3000,
      },
    });
  });

  // ── GET /api/clients/:clientId/retention-analyses ──────────────────────────
  app.get(
    "/api/clients/:clientId/retention-analyses",
    isAuthenticated,
    async (req: any, res: any) => {
      const { clientId } = req.params as { clientId: string };

      let orgId: string;
      try {
        orgId = await resolveOrgIdOrThrow(req);
      } catch {
        return res.status(403).json({ error: "ORG_RESOLUTION_FAILED" });
      }

      const rows = await db.execute(sql`
        SELECT raa.*, aj.status AS job_status, aj.error_code, aj.error_message,
               aj.created_at AS job_created_at
        FROM retention_agent_analyses raa
        JOIN agent_jobs aj ON aj.id = raa.agent_job_id
        WHERE raa.client_id = ${clientId}
          AND raa.organization_id = ${orgId}
        ORDER BY raa.created_at DESC
        LIMIT 20
      `);
      const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

      auditAgentJob("retention.analysis.viewed", {
        clientId,
        organizationId: orgId,
        userId: getUserId(req),
      });

      return res.json({ analyses: data.map(formatAnalysis) });
    },
  );

  // ── GET /api/clients/:clientId/retention-analyses/latest ──────────────────
  app.get(
    "/api/clients/:clientId/retention-analyses/latest",
    isAuthenticated,
    async (req: any, res: any) => {
      const { clientId } = req.params as { clientId: string };

      let orgId: string;
      try {
        orgId = await resolveOrgIdOrThrow(req);
      } catch {
        return res.status(403).json({ error: "ORG_RESOLUTION_FAILED" });
      }

      // Latest completed analysis
      const analysisRows = await db.execute(sql`
        SELECT raa.*, aj.status AS job_status, aj.created_at AS job_created_at
        FROM retention_agent_analyses raa
        JOIN agent_jobs aj ON aj.id = raa.agent_job_id
        WHERE raa.client_id = ${clientId}
          AND raa.organization_id = ${orgId}
        ORDER BY raa.created_at DESC
        LIMIT 1
      `);
      const analysisData = Array.isArray(analysisRows) ? analysisRows : (analysisRows as any).rows ?? [];

      // Latest active (non-terminal) job
      const activeJobRows = await db.execute(sql`
        SELECT id, status, agent_id, task_type, created_at, error_code, error_message
        FROM agent_jobs
        WHERE subject_id = ${clientId}
          AND organization_id = ${orgId}
          AND agent_id = 'retention-agent'
          AND status NOT IN ('completed','failed','cancelled','timed_out','blocked_by_policy')
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const activeData = Array.isArray(activeJobRows) ? activeJobRows : (activeJobRows as any).rows ?? [];

      // Latest terminal job (for showing most recent attempt)
      const latestJobRows = await db.execute(sql`
        SELECT id, status, agent_id, task_type, created_at, error_code, error_message,
               completed_at, failed_at
        FROM agent_jobs
        WHERE subject_id = ${clientId}
          AND organization_id = ${orgId}
          AND agent_id = 'retention-agent'
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const latestData = Array.isArray(latestJobRows) ? latestJobRows : (latestJobRows as any).rows ?? [];

      auditAgentJob("retention.analysis.viewed", {
        clientId,
        organizationId: orgId,
        userId: getUserId(req),
      });

      return res.json({
        analysis: analysisData.length ? formatAnalysis(analysisData[0]) : null,
        activeJob: activeData.length ? formatJobResponse(activeData[0]) : null,
        latestJob: latestData.length ? formatJobResponse(latestData[0]) : null,
        meta: {
          hasResult: analysisData.length > 0,
          hasPendingJob: activeData.length > 0,
          canAnalyze: activeData.length === 0,
        },
      });
    },
  );

  // ── POST /api/agent-callbacks/kevin ───────────────────────────────────────
  // Server-to-server callback from Kevin. Must NOT be authenticated as a user.
  // Reads raw body for HMAC verification.
  app.post(
    "/api/agent-callbacks/kevin",
    callbackLimiter,
    // Raw body parser for this route so we can verify HMAC over exact bytes
    (req: any, res: any, next: any) => {
      // If body is already a Buffer (from express.raw earlier), proceed
      if (Buffer.isBuffer(req.body)) return next();
      // Otherwise collect raw bytes manually
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        req.rawBody = Buffer.concat(chunks);
        next();
      });
    },
    async (req: any, res: any) => {
      const rawBody: Buffer = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {})));

      const cfg = getKevinAgentConfig();

      // ── HMAC verification ─────────────────────────────────────────────────
      if (cfg.enabled && cfg.callbackHmacSecret) {
        const verification = verifyCallbackSignature(
          rawBody,
          req.headers as Record<string, string | string[] | undefined>,
          cfg.callbackHmacSecret,
          cfg.callbackAllowedSkewSeconds,
        );

        if (!verification.ok) {
          auditAgentJob("agent.job.invalid_signature_rejected", {
            reason: verification.reason,
          });
          console.log(
            JSON.stringify({
              event: "KEVIN_CALLBACK_SIGNATURE_REJECTED",
              reason: verification.reason,
              timestamp: new Date().toISOString(),
            }),
          );
          // Return 200 to avoid Kevin retrying with a bad signature
          return res.status(200).json({ ok: false, error: "SIGNATURE_INVALID" });
        }
      }

      // ── Parse body ────────────────────────────────────────────────────────
      let body: any;
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ ok: false, error: "INVALID_JSON" });
      }

      const {
        schemaVersion,
        taskId: jobId,
        remoteTaskId,
        agentId,
        taskType,
        organizationId,
        correlationId,
        status: callbackStatus,
        completedAt,
        result,
        error: callbackError,
      } = body ?? {};

      // ── Schema validation ─────────────────────────────────────────────────
      if (
        schemaVersion !== "1.0" ||
        !jobId ||
        !agentId ||
        !taskType ||
        !organizationId ||
        !callbackStatus ||
        !ALLOWED_CALLBACK_STATUSES.has(callbackStatus)
      ) {
        return res.status(400).json({ ok: false, error: "INVALID_SCHEMA" });
      }

      auditAgentJob("agent.job.callback_received", {
        jobId,
        remoteTaskId,
        agentId,
        taskType,
        organizationId,
        correlationId,
        status: callbackStatus,
      });

      // ── Load and validate the job ─────────────────────────────────────────
      const jobRows = await db.execute(sql`
        SELECT id, organization_id, agent_id, task_type, status,
               correlation_id, remote_task_id, subject_id
        FROM agent_jobs
        WHERE id = ${jobId}
        LIMIT 1
      `);
      const jobData = Array.isArray(jobRows) ? jobRows : (jobRows as any).rows ?? [];

      if (!jobData.length) {
        return res.status(200).json({ ok: false, error: "JOB_NOT_FOUND" });
      }

      const job = jobData[0];

      // Validate org, agent, task type, correlation, remote task
      if (String(job.organization_id) !== String(organizationId)) {
        return res.status(200).json({ ok: false, error: "ORG_MISMATCH" });
      }
      if (String(job.agent_id) !== agentId) {
        return res.status(200).json({ ok: false, error: "AGENT_MISMATCH" });
      }
      if (String(job.task_type) !== taskType) {
        return res.status(200).json({ ok: false, error: "TASK_TYPE_MISMATCH" });
      }
      if (correlationId && String(job.correlation_id) !== correlationId) {
        return res.status(200).json({ ok: false, error: "CORRELATION_MISMATCH" });
      }
      if (
        remoteTaskId &&
        job.remote_task_id &&
        String(job.remote_task_id) !== remoteTaskId
      ) {
        return res.status(200).json({ ok: false, error: "REMOTE_TASK_ID_MISMATCH" });
      }

      // ── Idempotency: reject replayed callbacks on terminal jobs ───────────
      if (TERMINAL_STATUSES.has(String(job.status))) {
        auditAgentJob("agent.job.replayed_callback_rejected", {
          jobId,
          currentStatus: String(job.status),
          callbackStatus,
          remoteTaskId,
        });
        // Acknowledge without re-processing
        return res.status(200).json({ ok: true, idempotent: true });
      }

      // ── Process by status ─────────────────────────────────────────────────

      if (callbackStatus === "running") {
        await db.execute(sql`
          UPDATE agent_jobs
          SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
          WHERE id = ${jobId}
        `);
        auditAgentJob("agent.job.running", { jobId, remoteTaskId, agentId, organizationId });
        return res.status(200).json({ ok: true });
      }

      if (callbackStatus === "requires_approval") {
        await db.execute(sql`
          UPDATE agent_jobs
          SET status = 'requires_approval', updated_at = NOW()
          WHERE id = ${jobId}
        `);
        return res.status(200).json({ ok: true });
      }

      if (callbackStatus === "blocked_by_policy") {
        await db.execute(sql`
          UPDATE agent_jobs
          SET status = 'blocked_by_policy', updated_at = NOW()
          WHERE id = ${jobId}
        `);
        auditAgentJob("agent.job.blocked", { jobId, agentId, organizationId });
        return res.status(200).json({ ok: true });
      }

      if (callbackStatus === "cancelled") {
        await db.execute(sql`
          UPDATE agent_jobs
          SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
          WHERE id = ${jobId}
        `);
        auditAgentJob("agent.job.cancelled", { jobId, agentId, organizationId });
        return res.status(200).json({ ok: true });
      }

      if (callbackStatus === "failed") {
        const errCode = callbackError?.code ?? "kevin_internal_error";
        const errMsg = callbackError?.message ?? "Agent task failed.";
        await db.execute(sql`
          UPDATE agent_jobs
          SET status = 'failed', error_code = ${errCode}, error_message = ${errMsg},
              failed_at = NOW(), result_payload = ${JSON.stringify(body)}, updated_at = NOW()
          WHERE id = ${jobId}
        `);
        auditAgentJob("agent.job.failed", {
          jobId,
          agentId,
          organizationId,
          errorCode: errCode,
          remoteTaskId,
        });
        return res.status(200).json({ ok: true });
      }

      // ── COMPLETED — persist result transactionally ────────────────────────
      if (callbackStatus === "completed") {
        if (!result) {
          return res.status(400).json({ ok: false, error: "MISSING_RESULT" });
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
          return res.status(400).json({ ok: false, error: "INCOMPLETE_RESULT" });
        }

        const VALID_RISK_LEVELS = ["low", "moderate", "high", "critical"];
        if (!VALID_RISK_LEVELS.includes(riskLevel)) {
          return res.status(400).json({ ok: false, error: "INVALID_RISK_LEVEL" });
        }

        const clientId = resultClientId ?? String(job.subject_id);
        const analysisId = crypto.randomUUID();
        const completedTs = completedAt ? new Date(completedAt).toISOString() : new Date().toISOString();

        // Atomic transaction: insert analysis + update job
        await db.execute(sql`
          BEGIN;

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
            risk_level = EXCLUDED.risk_level,
            risk_score = EXCLUDED.risk_score,
            confidence_score = EXCLUDED.confidence_score,
            summary = EXCLUDED.summary,
            risk_factors = EXCLUDED.risk_factors,
            recommended_actions = EXCLUDED.recommended_actions,
            draft_message = EXCLUDED.draft_message,
            evidence = EXCLUDED.evidence,
            model_version = EXCLUDED.model_version,
            updated_at = NOW();

          UPDATE agent_jobs
          SET
            status = 'completed',
            completed_at = ${completedTs},
            result_payload = ${JSON.stringify(result)},
            updated_at = NOW()
          WHERE id = ${jobId};

          COMMIT;
        `);

        const durationMs =
          job.requested_at
            ? Date.now() - new Date(job.requested_at as string).getTime()
            : undefined;

        auditAgentJob("agent.job.completed", {
          jobId,
          agentId,
          taskType,
          organizationId,
          remoteTaskId,
          clientId,
          correlationId,
          durationMs,
        });
        auditAgentJob("retention.analysis.created", {
          jobId,
          organizationId,
          clientId,
          agentId,
        });

        return res.status(200).json({ ok: true, analysisId });
      }

      return res.status(400).json({ ok: false, error: "UNHANDLED_STATUS" });
    },
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatJobResponse(job: any) {
  return {
    id: String(job.id),
    status: String(job.status),
    agentId: String(job.agent_id),
    taskType: String(job.task_type),
    clientId: job.subject_id ? String(job.subject_id) : null,
    remoteTaskId: job.remote_task_id ? String(job.remote_task_id) : null,
    errorCode: job.error_code ?? null,
    errorMessage: job.error_message ?? null,
    requestedAt: job.requested_at ? new Date(job.requested_at as string).toISOString() : null,
    acceptedAt: job.accepted_at ? new Date(job.accepted_at as string).toISOString() : null,
    completedAt: job.completed_at ? new Date(job.completed_at as string).toISOString() : null,
    failedAt: job.failed_at ? new Date(job.failed_at as string).toISOString() : null,
    createdAt: job.created_at ? new Date(job.created_at as string).toISOString() : null,
  };
}

function formatAnalysis(a: any) {
  return {
    id: String(a.id),
    organizationId: String(a.organization_id),
    clientId: String(a.client_id),
    agentJobId: String(a.agent_job_id),
    riskLevel: String(a.risk_level),
    riskScore: Number(a.risk_score),
    confidenceScore: Number(a.confidence_score),
    summary: String(a.summary),
    riskFactors: a.risk_factors ?? [],
    recommendedActions: a.recommended_actions ?? [],
    draftMessage: a.draft_message ?? null,
    evidence: a.evidence ?? [],
    modelVersion: a.model_version ?? null,
    createdAt: a.created_at ? new Date(a.created_at as string).toISOString() : null,
    updatedAt: a.updated_at ? new Date(a.updated_at as string).toISOString() : null,
  };
}
