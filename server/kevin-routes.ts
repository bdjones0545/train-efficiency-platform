/**
 * Kevin BFF routes — Phase 0–2
 *
 * Health/capabilities/audit + async runs + SSE events + stop.
 * Auth: isAuthenticated + requireKevinAccess (ADMIN only).
 */

import type { Express, Request, Response } from "express";
import { isAuthenticated } from "./replit_integrations/auth";
import { requireKevinAccess } from "./middleware/require-kevin-access";
import {
  getKevinHealth,
  getKevinCapabilitiesView,
  getKevinConfig,
  hermesOpenRunEvents,
  mapHermesEventToKevinSse,
  KevinHermesError,
} from "./services/kevin-hermes-client";
import {
  recordKevinAuditEvent,
  shouldSampleHealthAudit,
  ensureKevinAuditTable,
} from "./services/kevin-audit-service";
import {
  ensureKevinRunTables,
  createKevinRun,
  getKevinRunById,
  listKevinRuns,
  reconcileKevinRun,
  stopKevinRun,
  checkKevinRunRateLimit,
} from "./services/kevin-run-service";
import { db } from "./db";
import { sql } from "drizzle-orm";

function getUserId(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? req.user?.userId ?? null;
}

function getOrgId(req: any): string | null {
  return (
    req.user?.organizationId ??
    req.user?.orgId ??
    (req.user as any)?.claims?.org_id ??
    (typeof req.headers["x-org-id"] === "string" ? req.headers["x-org-id"] : null) ??
    null
  );
}

async function resolveOrgId(req: any): Promise<string | null> {
  const direct = getOrgId(req);
  if (direct) return String(direct);
  const userId = getUserId(req);
  if (!userId) return null;
  try {
    const result = await db.execute(sql`
      SELECT organization_id FROM user_profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `);
    const rows = Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : Array.isArray(result)
        ? result
        : [];
    const org = rows[0]?.organization_id;
    return org ? String(org) : "platform";
  } catch {
    return "platform";
  }
}

function writeSse(res: Response, data: unknown) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function registerKevinRoutes(app: Express): Promise<void> {
  ensureKevinAuditTable().catch(() => {});
  ensureKevinRunTables().catch(() => {});

  app.get(
    "/api/kevin/health",
    isAuthenticated,
    requireKevinAccess,
    async (req: Request, res: Response) => {
      try {
        const health = await getKevinHealth();
        const { hermesHealth: _h, hermesDetailed: _d, ...summary } = health as any;
        if (shouldSampleHealthAudit(0.2)) {
          void recordKevinAuditEvent({
            userId: getUserId(req),
            orgId: await resolveOrgId(req),
            eventType: "health.check",
            payload: {
              status: health.status,
              hermesReachable: health.hermesReachable,
              baseUrlRedacted: health.baseUrlRedacted,
            },
          });
        }
        res.json({
          ...summary,
          phase: "2",
          details: health.hermesDetailed
            ? {
                gateway_state: health.hermesDetailed.gateway_state,
                status: health.hermesDetailed.status,
                active_agents: health.hermesDetailed.active_agents,
                readiness: health.hermesDetailed.readiness ?? null,
              }
            : health.hermesHealth ?? null,
        });
      } catch (e: any) {
        res.status(500).json({
          message: e?.message || "Kevin health check failed",
          code: "KEVIN_HEALTH_ERROR",
        });
      }
    },
  );

  app.get(
    "/api/kevin/capabilities",
    isAuthenticated,
    requireKevinAccess,
    async (req: Request, res: Response) => {
      try {
        const view = await getKevinCapabilitiesView();
        void recordKevinAuditEvent({
          userId: getUserId(req),
          orgId: await resolveOrgId(req),
          eventType: "capabilities.read",
          payload: {
            status: view.status,
            phase: view.teFeatureFlags?.phase,
            hasHermes: Boolean(view.hermes),
          },
        });
        res.json(view);
      } catch (e: any) {
        res.status(500).json({
          message: e?.message || "Kevin capabilities failed",
          code: "KEVIN_CAPABILITIES_ERROR",
        });
      }
    },
  );

  app.get(
    "/api/kevin/config-status",
    isAuthenticated,
    requireKevinAccess,
    async (req: Request, res: Response) => {
      const cfg = getKevinConfig();
      void recordKevinAuditEvent({
        userId: getUserId(req),
        orgId: await resolveOrgId(req),
        eventType: "config.status",
        payload: {
          integrationEnabled: cfg.integrationEnabled,
          configured: cfg.configured,
          baseUrlRedacted: cfg.baseUrlRedacted,
        },
      });
      res.json({
        integrationEnabled: cfg.integrationEnabled,
        configured: cfg.configured,
        baseUrlRedacted: cfg.baseUrlRedacted,
        phase: "2",
        coachAccess: "none",
      });
    },
  );

  app.get(
    "/api/kevin/audit",
    isAuthenticated,
    requireKevinAccess,
    async (req: Request, res: Response) => {
      try {
        await ensureKevinAuditTable();
        const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 100);
        const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
        const rows = await db.execute(sql`
          SELECT id, org_id, user_id, run_id, event_type, payload, created_at
          FROM kevin_audit_events
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
        const list = Array.isArray((rows as any)?.rows)
          ? (rows as any).rows
          : Array.isArray(rows)
            ? rows
            : [];
        res.json({
          events: list.map((r: any) => ({
            id: r.id,
            orgId: r.org_id ?? null,
            userId: r.user_id ?? null,
            runId: r.run_id ?? null,
            eventType: r.event_type,
            payload: r.payload,
            createdAt: r.created_at,
          })),
          limit,
          offset,
        });
      } catch (e: any) {
        res.status(500).json({
          message: e?.message || "Kevin audit list failed",
          code: "KEVIN_AUDIT_ERROR",
        });
      }
    },
  );

  // ─── Phase 2: runs ────────────────────────────────────────────────────────

  app.post(
    "/api/kevin/runs",
    isAuthenticated,
    requireKevinAccess,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        if (!userId) {
          res.status(401).json({ message: "Unauthorized" });
          return;
        }
        const orgId = (await resolveOrgId(req)) || "platform";
        const rl = checkKevinRunRateLimit(userId, 20);
        if (!rl.allowed) {
          res.setHeader("Retry-After", String(rl.retryAfterSec));
          res.status(429).json({
            message: "Kevin run rate limit exceeded",
            code: "KEVIN_RATE_LIMIT",
          });
          return;
        }

        const body = req.body || {};
        const result = await createKevinRun({
          orgId,
          userId,
          message: String(body.message || ""),
          sessionId: body.sessionId ? String(body.sessionId) : null,
          mode: body.mode ? String(body.mode) : "ops_chat",
          clientRequestId: body.clientRequestId
            ? String(body.clientRequestId)
            : null,
          contextHints: body.contextHints || undefined,
        });

        res.status(result.reused ? 200 : 202).json(result);
      } catch (e: any) {
        const status =
          e instanceof KevinHermesError
            ? e.code === "KEVIN_VALIDATION"
              ? 400
              : e.code === "KEVIN_UNCONFIGURED" || e.code === "KEVIN_DISABLED"
                ? 503
                : e.status && e.status >= 400 && e.status < 600
                  ? e.status
                  : 502
            : 500;
        res.status(status).json({
          message: e?.message || "Failed to start Kevin run",
          code: e?.code || "KEVIN_RUN_ERROR",
        });
      }
    },
  );

  app.get(
    "/api/kevin/runs",
    isAuthenticated,
    requireKevinAccess,
    async (req: Request, res: Response) => {
      try {
        const orgId = (await resolveOrgId(req)) || "platform";
        const limit = Math.min(parseInt(String(req.query.limit ?? "30"), 10) || 30, 100);
        const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
        const runs = await listKevinRuns({ orgId, limit, offset });
        res.json({ runs, limit, offset });
      } catch (e: any) {
        res.status(500).json({
          message: e?.message || "Failed to list runs",
          code: "KEVIN_RUN_LIST_ERROR",
        });
      }
    },
  );

  app.get(
    "/api/kevin/runs/:runId",
    isAuthenticated,
    requireKevinAccess,
    async (req: Request, res: Response) => {
      try {
        const orgId = (await resolveOrgId(req)) || "platform";
        const runId = String(req.params.runId);
        let run = await getKevinRunById(runId, orgId);
        if (!run) {
          res.status(404).json({ message: "Run not found" });
          return;
        }
        run = await reconcileKevinRun(run);
        res.json(run);
      } catch (e: any) {
        res.status(500).json({
          message: e?.message || "Failed to get run",
          code: "KEVIN_RUN_GET_ERROR",
        });
      }
    },
  );

  app.post(
    "/api/kevin/runs/:runId/stop",
    isAuthenticated,
    requireKevinAccess,
    async (req: Request, res: Response) => {
      try {
        const orgId = (await resolveOrgId(req)) || "platform";
        const runId = String(req.params.runId);
        const run = await getKevinRunById(runId, orgId);
        if (!run) {
          res.status(404).json({ message: "Run not found" });
          return;
        }
        const result = await stopKevinRun(run);
        res.json(result);
      } catch (e: any) {
        res.status(502).json({
          message: e?.message || "Failed to stop run",
          code: e?.code || "KEVIN_STOP_ERROR",
        });
      }
    },
  );

  /**
   * GET /api/kevin/runs/:runId/events — SSE proxy of Hermes run events.
   */
  app.get(
    "/api/kevin/runs/:runId/events",
    isAuthenticated,
    requireKevinAccess,
    async (req: Request, res: Response) => {
      const orgId = (await resolveOrgId(req)) || "platform";
      const runId = String(req.params.runId);
      const run = await getKevinRunById(runId, orgId);
      if (!run) {
        res.status(404).json({ message: "Run not found" });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof (res as any).flushHeaders === "function") {
        (res as any).flushHeaders();
      }

      writeSse(res, {
        type: "run.status",
        runId,
        status: run.status,
        at: new Date().toISOString(),
      });

      const ac = new AbortController();
      const onClose = () => ac.abort();
      req.on("close", onClose);

      try {
        const upstream = await hermesOpenRunEvents(run.hermesRunId, ac.signal);
        if (!upstream.body) {
          writeSse(res, {
            type: "run.failed",
            runId,
            message: "No event stream body from Hermes",
            at: new Date().toISOString(),
          });
          writeSse(res, { type: "done" });
          res.end();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const lines = part.split("\n");
            for (const line of lines) {
              if (line.startsWith(":")) {
                // keepalive / comment
                writeSse(res, { type: "heartbeat", at: new Date().toISOString() });
                continue;
              }
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const hermesEvent = JSON.parse(payload);
                const mapped = mapHermesEventToKevinSse(hermesEvent, runId);
                if (mapped) writeSse(res, mapped);
              } catch {
                // ignore malformed chunks
              }
            }
          }
        }

        // final reconcile
        try {
          await reconcileKevinRun(run);
        } catch {
          /* ignore */
        }
        writeSse(res, { type: "done" });
        res.end();
      } catch (e: any) {
        if (!res.headersSent) {
          res.status(502).json({
            message: e?.message || "SSE proxy failed",
            code: e?.code || "KEVIN_SSE_ERROR",
          });
          return;
        }
        writeSse(res, {
          type: "run.failed",
          runId,
          message: e?.message || "SSE proxy failed",
          code: e?.code,
          at: new Date().toISOString(),
        });
        writeSse(res, { type: "done" });
        res.end();
      } finally {
        req.off("close", onClose);
      }
    },
  );
}
