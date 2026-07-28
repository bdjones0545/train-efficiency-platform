/**
 * kevin-gateway-client.ts — Dedicated service for dispatching tasks to Kevin.
 *
 * Responsibilities:
 *  - Build the remote request
 *  - Sign the request (HMAC)
 *  - Dispatch the task with timeout handling
 *  - Parse and validate Kevin's response
 *  - Convert failures into safe internal error codes
 *  - Update the agent job status
 *  - Record the remote task ID
 *  - Emit structured logs
 *
 * Never scatters direct fetch calls throughout the application.
 */

import crypto from "node:crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getKevinAgentConfig } from "./kevin-agent-config";
import { buildSignedHeaders, canonicalJson } from "../lib/kevin-hmac";
import { auditAgentJob } from "./kevin-agent-audit";
import type { RetentionContext } from "./retention-context-service";

// ─── Error codes ──────────────────────────────────────────────────────────────

export type KevinErrorCode =
  | "kevin_disabled"
  | "kevin_configuration_missing"
  | "kevin_unreachable"
  | "kevin_timeout"
  | "kevin_authentication_failed"
  | "kevin_request_rejected"
  | "kevin_invalid_response"
  | "kevin_rate_limited"
  | "kevin_internal_error";

export class KevinDispatchError extends Error {
  constructor(
    public readonly code: KevinErrorCode,
    public readonly safeMessage: string,
    public readonly internalDetails?: string,
  ) {
    super(safeMessage);
    this.name = "KevinDispatchError";
  }
}

// ─── Request / Response types ─────────────────────────────────────────────────

export interface KevinTaskRequest {
  schemaVersion: "1.0";
  taskId: string;
  agentId: string;
  taskType: string;
  organizationId: string;
  requestedBy: {
    userId: string;
    role: string;
  };
  subject: {
    type: string;
    id: string;
  };
  context: RetentionContext | Record<string, unknown>;
  callback: {
    url: string;
  };
  idempotencyKey: string;
  correlationId: string;
  requestedAt: string;
}

export interface KevinAcceptResponse {
  remoteTaskId: string;
  status: "queued" | "accepted";
  message?: string;
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Dispatches a task request to Kevin and returns the remote task ID.
 * Updates the agent_jobs record in the DB on success or failure.
 * Throws KevinDispatchError on any failure.
 */
export async function dispatchKevinTask(
  jobId: string,
  agentId: string,
  taskType: string,
  organizationId: string,
  requestedByUserId: string,
  requestedByRole: string,
  subjectType: string,
  subjectId: string,
  context: RetentionContext | Record<string, unknown>,
  idempotencyKey: string,
  correlationId: string,
): Promise<string> {
  const cfg = getKevinAgentConfig();

  if (!cfg.enabled) {
    await markJobFailed(jobId, "kevin_disabled", "Kevin agent integration is not enabled.");
    throw new KevinDispatchError("kevin_disabled", "Kevin agent integration is not enabled.");
  }

  if (!cfg.gatewayBaseUrl || !cfg.outboundHmacSecret) {
    await markJobFailed(jobId, "kevin_configuration_missing", "Kevin gateway is not configured.");
    throw new KevinDispatchError(
      "kevin_configuration_missing",
      "Kevin gateway is not configured.",
    );
  }

  // ── Build request body ────────────────────────────────────────────────────
  const requestBody: KevinTaskRequest = {
    schemaVersion: "1.0",
    taskId: jobId,
    agentId,
    taskType,
    organizationId,
    requestedBy: {
      userId: requestedByUserId,
      role: requestedByRole,
    },
    subject: {
      type: subjectType,
      id: subjectId,
    },
    context,
    callback: {
      url: `${cfg.callbackBaseUrl}/api/agent-callbacks/kevin`,
    },
    idempotencyKey,
    correlationId,
    requestedAt: new Date().toISOString(),
  };

  // Canonical, deterministic serialization
  const bodyStr = canonicalJson(requestBody);
  const path = "/tasks";
  const url = `${cfg.gatewayBaseUrl.replace(/\/$/, "")}${path}`;

  // ── Sign request ──────────────────────────────────────────────────────────
  const headers = buildSignedHeaders(
    "POST",
    path,
    bodyStr,
    cfg.outboundHmacSecret,
    correlationId,
    idempotencyKey,
  );

  // Update job to "dispatching"
  await updateJobStatus(jobId, "dispatching");

  auditAgentJob("agent.job.dispatching", {
    jobId,
    agentId,
    taskType,
    organizationId,
    userId: requestedByUserId,
    correlationId,
    subjectType,
    subjectId,
  });

  const dispatchStart = Date.now();

  // ── HTTP dispatch with timeout ────────────────────────────────────────────
  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      cfg.requestTimeoutMs,
    );

    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: bodyStr,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  } catch (err: any) {
    const isTimeout = err?.name === "AbortError";
    const code: KevinErrorCode = isTimeout ? "kevin_timeout" : "kevin_unreachable";
    const msg = isTimeout ? "Kevin gateway request timed out." : "Kevin gateway is unreachable.";

    console.log(
      JSON.stringify({
        event: "KEVIN_DISPATCH_FAILED",
        jobId,
        code,
        durationMs: Date.now() - dispatchStart,
        // Do NOT log err.message as it may contain infrastructure details
        timestamp: new Date().toISOString(),
      }),
    );

    await markJobFailed(jobId, code, msg);
    throw new KevinDispatchError(code, msg, String(err?.message ?? ""));
  }

  const durationMs = Date.now() - dispatchStart;

  // ── Parse response ────────────────────────────────────────────────────────
  if (response.status === 401 || response.status === 403) {
    await markJobFailed(jobId, "kevin_authentication_failed", "Kevin rejected the request signature.");
    throw new KevinDispatchError(
      "kevin_authentication_failed",
      "Kevin rejected the request signature.",
    );
  }

  if (response.status === 429) {
    await markJobFailed(jobId, "kevin_rate_limited", "Kevin gateway rate limit exceeded.");
    throw new KevinDispatchError(
      "kevin_rate_limited",
      "Kevin gateway rate limit exceeded.",
    );
  }

  if (response.status >= 400 && response.status < 500) {
    await markJobFailed(jobId, "kevin_request_rejected", "Kevin rejected the task request.");
    throw new KevinDispatchError(
      "kevin_request_rejected",
      "Kevin rejected the task request.",
    );
  }

  if (response.status >= 500) {
    await markJobFailed(jobId, "kevin_internal_error", "Kevin returned an internal error.");
    throw new KevinDispatchError(
      "kevin_internal_error",
      "Kevin returned an internal error.",
    );
  }

  let parsed: KevinAcceptResponse;
  try {
    parsed = await response.json() as KevinAcceptResponse;
    if (!parsed.remoteTaskId) throw new Error("missing remoteTaskId");
  } catch (err) {
    await markJobFailed(jobId, "kevin_invalid_response", "Kevin returned an unexpected response.");
    throw new KevinDispatchError(
      "kevin_invalid_response",
      "Kevin returned an unexpected response.",
    );
  }

  // ── Record acceptance ─────────────────────────────────────────────────────
  await db.execute(sql`
    UPDATE agent_jobs
    SET
      status = 'queued',
      remote_task_id = ${parsed.remoteTaskId},
      accepted_at = NOW(),
      updated_at = NOW()
    WHERE id = ${jobId}
  `);

  auditAgentJob("agent.job.accepted", {
    jobId,
    agentId,
    taskType,
    organizationId,
    remoteTaskId: parsed.remoteTaskId,
    correlationId,
    durationMs,
  });

  console.log(
    JSON.stringify({
      event: "KEVIN_DISPATCH_SUCCESS",
      jobId,
      remoteTaskId: parsed.remoteTaskId,
      durationMs,
      timestamp: new Date().toISOString(),
    }),
  );

  return parsed.remoteTaskId;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function updateJobStatus(jobId: string, status: string): Promise<void> {
  await db.execute(sql`
    UPDATE agent_jobs
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function markJobFailed(
  jobId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE agent_jobs
    SET
      status = 'failed',
      error_code = ${errorCode},
      error_message = ${errorMessage},
      failed_at = NOW(),
      updated_at = NOW()
    WHERE id = ${jobId}
  `);
}
