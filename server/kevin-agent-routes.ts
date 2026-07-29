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
import { auditAgentJob } from "./services/kevin-agent-audit";

// ─── Constants ────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked_by_policy",
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
      id                   TEXT PRIMARY KEY,
      organization_id      TEXT NOT NULL,
      agent_id             TEXT NOT NULL,
      task_type            TEXT NOT NULL,
      status               agent_job_status NOT NULL DEFAULT 'requested',
      requested_by_user_id TEXT NOT NULL,
      subject_type         TEXT,
      subject_id           TEXT,
      request_payload      JSONB,
      result_payload       JSONB,
      error_code           TEXT,
      error_message        TEXT,
      remote_task_id       TEXT,
      idempotency_key      TEXT NOT NULL,
      correlation_id       TEXT NOT NULL,
      attempt_count        INTEGER NOT NULL DEFAULT 0,
      -- Phase 1.1 additions (gateway compatibility hardening)
      execution_id         TEXT,
      capability           TEXT,
      callback_id          TEXT,
      callback_receipt_at  TIMESTAMPTZ,
      retryable            BOOLEAN NOT NULL DEFAULT FALSE,
      last_callback_status TEXT,
      requested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_at          TIMESTAMPTZ,
      started_at           TIMESTAMPTZ,
      completed_at         TIMESTAMPTZ,
      failed_at            TIMESTAMPTZ,
      cancelled_at         TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  // Phase 1.1: Add new columns to existing agent_jobs table (idempotent ALTER TABLE)
  const alterCols = [
    `ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS execution_id TEXT`,
    `ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS capability TEXT`,
    `ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS callback_id TEXT`,
    `ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS callback_receipt_at TIMESTAMPTZ`,
    `ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS last_callback_status TEXT`,
  ];
  for (const stmt of alterCols) {
    try {
      await db.execute(sql.raw(stmt));
    } catch {
      // Column already exists — safe to ignore
    }
  }

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

  // NOTE: Callback endpoints (POST /api/kevin/webhooks/hermes and
  // POST /api/agent-callbacks/kevin) are registered by registerKevinWebhookRoutes()
  // in server/kevin-webhook-routes.ts — do NOT add them here.
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
