/**
 * Kevin → TE inbound webhook (Hermes agent-gateway callbacks).
 *
 * POST /api/kevin/webhooks/hermes
 *
 * Auth: x-kevin-timestamp + x-kevin-signature v1 over exact raw body
 * (shared/kevin/outbound-hmac.ts). Uses req.rawBody from express.json verify hook.
 *
 * Response envelope (stable for Kevin retries):
 *   { ok: true, ... } | { ok: false, retryable: boolean, error: string }
 */
import type { Express, Request, Response } from "express";
import { createHash } from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  verifyKevinCallbackHeaders,
  isKevinCallbackHmacConfigured,
  getKevinCallbackHmacSource,
} from "./services/kevin-outbound-auth";

type RawRequest = Request & { rawBody?: Buffer | string };

function rawBodyString(req: RawRequest): string {
  const rb = req.rawBody;
  if (Buffer.isBuffer(rb)) return rb.toString("utf8");
  if (typeof rb === "string") return rb;
  // Last resort — NEVER preferred (re-serialization breaks HMAC)
  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }
  return "";
}

function headerCI(req: Request, name: string): string | null {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.toLowerCase() === want) {
      if (Array.isArray(v)) return v[0] ?? null;
      return typeof v === "string" ? v : null;
    }
  }
  return null;
}

/** Map verifier codes → stable production error tokens. */
function mapErrorCode(code: string): { http: number; error: string; retryable: boolean } {
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

async function ensureAgentJobsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      task_type TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      hermes_job_id TEXT,
      correlation_id TEXT,
      idempotency_key TEXT,
      request_payload JSONB,
      result_payload JSONB,
      error_payload JSONB,
      callback_status TEXT,
      callback_last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_idempotency_uidx
      ON agent_jobs (idempotency_key)
      WHERE idempotency_key IS NOT NULL
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS agent_jobs_hermes_job_idx
      ON agent_jobs (hermes_job_id)
      WHERE hermes_job_id IS NOT NULL
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_job_callbacks (
      id TEXT PRIMARY KEY,
      agent_job_id TEXT,
      hermes_job_id TEXT,
      event TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload JSONB,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (payload_hash)
    )
  `);
}

function payloadHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export async function registerKevinWebhookRoutes(app: Express): Promise<void> {
  // Best-effort schema; failures logged once at first request
  let schemaReady = false;
  const ensureSchema = async () => {
    if (schemaReady) return;
    try {
      await ensureAgentJobsTable();
      schemaReady = true;
    } catch (e) {
      console.warn("[kevin-webhook] agent_jobs schema ensure failed:", (e as Error)?.message);
    }
  };

  app.post("/api/kevin/webhooks/hermes", async (req: RawRequest, res: Response) => {
    try {
      if (!isKevinCallbackHmacConfigured()) {
        return res.status(503).json({
          ok: false,
          retryable: true,
          error: "HMAC_UNCONFIGURED",
          hmacEnv: getKevinCallbackHmacSource(),
        });
      }

      const raw = rawBodyString(req);
      if (!raw) {
        return res.status(400).json({
          ok: false,
          retryable: false,
          error: "EMPTY_BODY",
        });
      }

      const verified = verifyKevinCallbackHeaders({
        rawBody: raw,
        timestampHeader: headerCI(req, "x-kevin-timestamp"),
        signatureHeader: headerCI(req, "x-kevin-signature"),
      });

      if (!verified.ok) {
        const mapped = mapErrorCode(verified.code);
        // HTTP 200 with ok:false kept only for legacy probes that expect body error;
        // prefer correct 401 for real clients. Kevin agent-gateway treats 2xx as delivered.
        return res.status(mapped.http).json({
          ok: false,
          retryable: mapped.retryable,
          error: mapped.error,
          code: verified.code,
        });
      }

      let body: any = null;
      try {
        body = JSON.parse(raw);
      } catch {
        return res.status(400).json({ ok: false, retryable: false, error: "MALFORMED_JSON" });
      }

      await ensureSchema();

      const event = String(body?.event || "");
      const hermesJobId = body?.jobId ? String(body.jobId) : null;
      const correlationId = body?.correlationId ? String(body.correlationId) : null;
      const status = body?.status ? String(body.status) : null;
      const callbackId = body?.callbackId ? String(body.callbackId) : null;
      const hash = payloadHash(raw);
      const rowId = callbackId || `cb_${hash.slice(0, 24)}`;

      // Idempotent callback insert
      let duplicate = false;
      try {
        await db.execute(sql`
          INSERT INTO agent_job_callbacks (id, agent_job_id, hermes_job_id, event, payload_hash, payload)
          VALUES (
            ${rowId},
            NULL,
            ${hermesJobId},
            ${event || "unknown"},
            ${hash},
            ${JSON.stringify(body)}::jsonb
          )
          ON CONFLICT (payload_hash) DO NOTHING
        `);
        const existing = await db.execute(sql`
          SELECT id FROM agent_job_callbacks WHERE payload_hash = ${hash} LIMIT 1
        `);
        const rows = Array.isArray((existing as any)?.rows)
          ? (existing as any).rows
          : Array.isArray(existing)
            ? existing
            : [];
        // If insert lost race, still ok
        duplicate = false;
        void rows;
      } catch (e: any) {
        // Unique violation → duplicate callback
        if (String(e?.message || e).toLowerCase().includes("unique") || e?.code === "23505") {
          duplicate = true;
        } else {
          console.warn("[kevin-webhook] callback persist warn:", e?.message || e);
        }
      }

      // Update matching agent_jobs by hermes_job_id when present
      if (hermesJobId && (event === "task.completed" || event === "task.failed" || event === "task.started")) {
        try {
          const newStatus =
            event === "task.completed" ? "completed" : event === "task.failed" ? "failed" : "processing";
          await db.execute(sql`
            UPDATE agent_jobs
            SET
              status = CASE
                WHEN status = 'completed' AND ${newStatus} <> 'completed' THEN status
                ELSE ${newStatus}
              END,
              result_payload = CASE
                WHEN ${event} = 'task.completed' THEN ${JSON.stringify(body?.result ?? null)}::jsonb
                ELSE result_payload
              END,
              error_payload = CASE
                WHEN ${event} = 'task.failed' THEN ${JSON.stringify(body?.error ?? null)}::jsonb
                ELSE error_payload
              END,
              callback_status = 'delivered',
              updated_at = NOW(),
              completed_at = CASE
                WHEN ${newStatus} IN ('completed','failed') THEN COALESCE(completed_at, NOW())
                ELSE completed_at
              END
            WHERE hermes_job_id = ${hermesJobId}
               OR (correlation_id IS NOT NULL AND correlation_id = ${correlationId})
          `);
        } catch (e: any) {
          console.warn("[kevin-webhook] agent_jobs update warn:", e?.message || e);
        }
      }

      return res.status(200).json({
        ok: true,
        received: true,
        duplicate,
        event: event || null,
        jobId: hermesJobId,
        correlationId,
        status,
      });
    } catch (e: any) {
      console.error("[kevin-webhook] handler error:", e?.message || e);
      return res.status(500).json({
        ok: false,
        retryable: true,
        error: "INTERNAL_ERROR",
      });
    }
  });
}
