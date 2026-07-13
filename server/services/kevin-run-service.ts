/**
 * Kevin run + session persistence (Phase 2).
 * Fail-open table bootstrap; idempotent create via client_request_id.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  hermesCreateRun,
  hermesGetRun,
  hermesStopRun,
  isKevinConfigured,
  KevinHermesError,
} from "./kevin-hermes-client";
import { recordKevinAuditEvent } from "./kevin-audit-service";
import { buildKevinInstructions } from "./kevin-context-builder";

let _tablesReady = false;

export async function ensureKevinRunTables(): Promise<void> {
  if (_tablesReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kevin_sessions (
        id                 TEXT PRIMARY KEY,
        org_id             TEXT NOT NULL,
        user_id            TEXT NOT NULL,
        hermes_session_id  TEXT NOT NULL,
        title              TEXT,
        mode               TEXT NOT NULL DEFAULT 'ops_chat',
        status             TEXT NOT NULL DEFAULT 'active',
        last_run_id        TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_kevin_sessions_org_user
      ON kevin_sessions (org_id, user_id, updated_at DESC)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kevin_runs (
        id                  TEXT PRIMARY KEY,
        org_id              TEXT NOT NULL,
        user_id             TEXT NOT NULL,
        session_id          TEXT NOT NULL,
        hermes_run_id       TEXT NOT NULL,
        client_request_id   TEXT,
        mode                TEXT NOT NULL DEFAULT 'ops_chat',
        status              TEXT NOT NULL DEFAULT 'queued',
        message             TEXT,
        summary             TEXT,
        error_message       TEXT,
        risk_class          TEXT,
        usage               JSONB,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kevin_runs_hermes
      ON kevin_runs (hermes_run_id)
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kevin_runs_idem
      ON kevin_runs (org_id, client_request_id)
      WHERE client_request_id IS NOT NULL
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_kevin_runs_org_created
      ON kevin_runs (org_id, created_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_kevin_runs_session
      ON kevin_runs (session_id, created_at DESC)
    `);

    _tablesReady = true;
  } catch (e: any) {
    console.warn("[KevinRuns] table setup warning:", e?.message);
  }
}

function rowsOf(result: any): any[] {
  if (Array.isArray(result?.rows)) return result.rows;
  if (Array.isArray(result)) return result;
  return [];
}

export type CreateKevinRunInput = {
  orgId: string;
  userId: string;
  message: string;
  sessionId?: string | null;
  mode?: string;
  clientRequestId?: string | null;
  contextHints?: {
    includeOrgSummary?: boolean;
    includePendingApprovals?: boolean;
    includeAgentHealth?: boolean;
  };
};

export type KevinRunRow = {
  id: string;
  orgId: string;
  userId: string;
  sessionId: string;
  hermesRunId: string;
  clientRequestId?: string | null;
  mode: string;
  status: string;
  message?: string | null;
  summary?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function mapRun(r: any): KevinRunRow {
  return {
    id: r.id,
    orgId: r.org_id,
    userId: r.user_id,
    sessionId: r.session_id,
    hermesRunId: r.hermes_run_id,
    clientRequestId: r.client_request_id,
    mode: r.mode,
    status: r.status,
    message: r.message,
    summary: r.summary,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getKevinRunById(
  runId: string,
  orgId: string,
): Promise<KevinRunRow | null> {
  await ensureKevinRunTables();
  if (!_tablesReady) return null;
  const result = await db.execute(sql`
    SELECT * FROM kevin_runs
    WHERE id = ${runId} AND org_id = ${orgId}
    LIMIT 1
  `);
  const row = rowsOf(result)[0];
  return row ? mapRun(row) : null;
}

export async function getKevinRunByClientRequestId(
  orgId: string,
  clientRequestId: string,
): Promise<KevinRunRow | null> {
  await ensureKevinRunTables();
  if (!_tablesReady) return null;
  const result = await db.execute(sql`
    SELECT * FROM kevin_runs
    WHERE org_id = ${orgId} AND client_request_id = ${clientRequestId}
    LIMIT 1
  `);
  const row = rowsOf(result)[0];
  return row ? mapRun(row) : null;
}

export async function listKevinRuns(opts: {
  orgId: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<KevinRunRow[]> {
  await ensureKevinRunTables();
  if (!_tablesReady) return [];
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const result = await db.execute(sql`
    SELECT * FROM kevin_runs
    WHERE org_id = ${opts.orgId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return rowsOf(result).map(mapRun);
}

async function ensureSession(opts: {
  orgId: string;
  userId: string;
  sessionId?: string | null;
  mode: string;
}): Promise<{ id: string; hermesSessionId: string }> {
  await ensureKevinRunTables();
  if (opts.sessionId) {
    const existing = await db.execute(sql`
      SELECT id, hermes_session_id FROM kevin_sessions
      WHERE id = ${opts.sessionId} AND org_id = ${opts.orgId} AND user_id = ${opts.userId}
      LIMIT 1
    `);
    const row = rowsOf(existing)[0];
    if (row) {
      return { id: row.id, hermesSessionId: row.hermes_session_id };
    }
  }

  const id = randomUUID();
  const hermesSessionId = `te_${opts.orgId}_${opts.userId}_${id.slice(0, 8)}`;
  await db.execute(sql`
    INSERT INTO kevin_sessions (id, org_id, user_id, hermes_session_id, mode, title)
    VALUES (
      ${id},
      ${opts.orgId},
      ${opts.userId},
      ${hermesSessionId},
      ${opts.mode},
      ${"Kevin ops"}
    )
  `);
  return { id, hermesSessionId };
}

export async function createKevinRun(
  input: CreateKevinRunInput,
): Promise<{
  receipt: {
    status: "accepted";
    runId: string;
    sessionId: string;
    hermesRunId: string;
  };
  eventsUrl: string;
  statusUrl: string;
  reused?: boolean;
}> {
  if (!isKevinConfigured()) {
    throw new KevinHermesError("Kevin not configured", { code: "KEVIN_UNCONFIGURED" });
  }

  await ensureKevinRunTables();
  if (!_tablesReady) {
    throw new KevinHermesError("Kevin run tables unavailable", { code: "KEVIN_DB" });
  }

  const mode = input.mode || "ops_chat";
  const message = (input.message || "").trim();
  if (!message) {
    throw new KevinHermesError("message is required", { code: "KEVIN_VALIDATION", status: 400 });
  }
  if (message.length > 12_000) {
    throw new KevinHermesError("message too long", { code: "KEVIN_VALIDATION", status: 400 });
  }

  if (input.clientRequestId) {
    const existing = await getKevinRunByClientRequestId(input.orgId, input.clientRequestId);
    if (existing) {
      return {
        receipt: {
          status: "accepted",
          runId: existing.id,
          sessionId: existing.sessionId,
          hermesRunId: existing.hermesRunId,
        },
        eventsUrl: `/api/kevin/runs/${existing.id}/events`,
        statusUrl: `/api/kevin/runs/${existing.id}`,
        reused: true,
      };
    }
  }

  const session = await ensureSession({
    orgId: input.orgId,
    userId: input.userId,
    sessionId: input.sessionId,
    mode,
  });

  const teRunId = randomUUID();
  const instructions = buildKevinInstructions({
    orgId: input.orgId,
    userId: input.userId,
    mode,
    requestId: teRunId,
    contextHints: input.contextHints,
  });

  // Persist queued row before calling Hermes (recoverable identity)
  await db.execute(sql`
    INSERT INTO kevin_runs (
      id, org_id, user_id, session_id, hermes_run_id, client_request_id,
      mode, status, message
    ) VALUES (
      ${teRunId},
      ${input.orgId},
      ${input.userId},
      ${session.id},
      ${"pending_" + teRunId},
      ${input.clientRequestId ?? null},
      ${mode},
      ${"queued"},
      ${message}
    )
  `);

  let hermesRunId: string;
  try {
    const created = await hermesCreateRun({
      input: message,
      instructions,
      sessionId: session.hermesSessionId,
    });
    hermesRunId = created.runId;
  } catch (e: any) {
    await db.execute(sql`
      UPDATE kevin_runs
      SET status = 'failed',
          error_message = ${e?.message || "Hermes create failed"},
          updated_at = NOW()
      WHERE id = ${teRunId}
    `);
    throw e;
  }

  await db.execute(sql`
    UPDATE kevin_runs
    SET hermes_run_id = ${hermesRunId},
        status = 'running',
        updated_at = NOW()
    WHERE id = ${teRunId}
  `);
  await db.execute(sql`
    UPDATE kevin_sessions
    SET last_run_id = ${teRunId}, updated_at = NOW()
    WHERE id = ${session.id}
  `);

  void recordKevinAuditEvent({
    orgId: input.orgId,
    userId: input.userId,
    runId: teRunId,
    eventType: "run.started",
    payload: { hermesRunId, mode, sessionId: session.id },
  });

  return {
    receipt: {
      status: "accepted",
      runId: teRunId,
      sessionId: session.id,
      hermesRunId,
    },
    eventsUrl: `/api/kevin/runs/${teRunId}/events`,
    statusUrl: `/api/kevin/runs/${teRunId}`,
  };
}

export async function reconcileKevinRun(
  run: KevinRunRow,
): Promise<KevinRunRow> {
  if (["completed", "failed", "stopped"].includes(run.status)) return run;
  try {
    const remote = await hermesGetRun(run.hermesRunId);
    const remoteStatus = String(remote?.status || "").toLowerCase();
    let status = run.status;
    if (["completed", "complete", "succeeded", "success"].includes(remoteStatus)) {
      status = "completed";
    } else if (["failed", "error"].includes(remoteStatus)) {
      status = "failed";
    } else if (["stopped", "cancelled", "canceled", "stopping"].includes(remoteStatus)) {
      status = remoteStatus === "stopping" ? "running" : "stopped";
    } else if (remoteStatus.includes("approval") || remoteStatus === "waiting_approval") {
      status = "waiting_approval";
    } else if (remoteStatus) {
      status = "running";
    }

    const summary =
      remote?.summary ||
      remote?.output_text ||
      remote?.result ||
      run.summary ||
      null;
    const errorMessage = remote?.error || remote?.error_message || run.errorMessage || null;

    await db.execute(sql`
      UPDATE kevin_runs
      SET status = ${status},
          summary = ${summary},
          error_message = ${errorMessage},
          updated_at = NOW()
      WHERE id = ${run.id}
    `);
    return { ...run, status, summary, errorMessage };
  } catch {
    return run;
  }
}

export async function stopKevinRun(
  run: KevinRunRow,
): Promise<{ ok: boolean; status: string }> {
  try {
    await hermesStopRun(run.hermesRunId);
  } catch (e: any) {
    // still mark stopped locally if Hermes lost the run
    if (e?.code !== "KEVIN_HTTP" && e?.status !== 404) throw e;
  }
  await db.execute(sql`
    UPDATE kevin_runs
    SET status = 'stopped', updated_at = NOW()
    WHERE id = ${run.id}
  `);
  void recordKevinAuditEvent({
    orgId: run.orgId,
    userId: run.userId,
    runId: run.id,
    eventType: "run.stopped",
    payload: { hermesRunId: run.hermesRunId },
  });
  return { ok: true, status: "stopped" };
}

/** Simple in-memory rate limit: max N creates per user per hour */
const runBuckets = new Map<string, { count: number; windowStart: number }>();

export function checkKevinRunRateLimit(
  userId: string,
  maxPerHour = 20,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const key = userId;
  let entry = runBuckets.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { count: 0, windowStart: now };
    runBuckets.set(key, entry);
  }
  if (entry.count >= maxPerHour) {
    const retryAfterSec = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    return { allowed: false, retryAfterSec: Math.max(retryAfterSec, 1) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}
