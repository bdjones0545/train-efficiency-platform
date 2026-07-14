/**
 * Kevin Signal Routes — Phase 3
 *
 * Endpoints for:
 * 1. Kevin→TE inbound signal intake  (protected by internal service token)
 * 2. Admin signal management         (ADMIN only)
 *
 * Security:
 * - Signal intake uses requireInternalServiceToken, NOT browser session auth.
 * - Admin management uses isAuthenticated + requireKevinAccess (ADMIN).
 * - Never expose raw evidence payloads for security signals.
 * - Loop prevention: depth > 3 rejected at intake.
 */

import type { Express } from "express";
import { isAuthenticated } from "./replit_integrations/auth";
import { requireKevinAccess } from "./middleware/require-kevin-access";
import { requireInternalServiceToken } from "./middleware/require-internal-service-token";
import { routeKevinSignal } from "./services/kevin-signal-router";
import { recordKevinAuditEvent } from "./services/kevin-audit-service";
import { recordSignalDismissed } from "./services/kevin-outcome-service";
import { db } from "./db";
import { kevinSignals } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

function getUserId(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? req.user?.userId ?? null;
}

async function resolveOrgId(req: any): Promise<string | null> {
  const direct =
    req.user?.organizationId ??
    req.user?.orgId ??
    req.user?.claims?.org_id ??
    (typeof req.headers["x-org-id"] === "string" ? req.headers["x-org-id"] : null) ??
    null;
  if (direct) return String(direct);
  const userId = getUserId(req);
  if (!userId) return null;
  try {
    const result = await db.execute(sql`
      SELECT organization_id FROM user_profiles WHERE user_id = ${userId} LIMIT 1
    `);
    const rows = Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : Array.isArray(result)
        ? result
        : [];
    return rows[0]?.organization_id ?? null;
  } catch {
    return null;
  }
}

export function registerKevinSignalRoutes(app: Express): void {

  // ── POST /api/internal/kevin/signals (Kevin→TE signal intake) ──────────────
  app.post(
    "/api/internal/kevin/signals",
    requireInternalServiceToken,
    async (req, res) => {
      try {
        const body = req.body;

        // Validate required fields
        if (!body || typeof body !== "object") {
          return res.status(400).json({ message: "Request body required" });
        }
        const { org_id, signal_type, title } = body as any;
        if (!org_id || typeof org_id !== "string" || org_id.length > 200) {
          return res.status(400).json({ message: "org_id required (max 200 chars)" });
        }
        if (!signal_type || typeof signal_type !== "string" || signal_type.length > 100) {
          return res.status(400).json({ message: "signal_type required (max 100 chars)" });
        }
        if (!title || typeof title !== "string" || title.length > 300) {
          return res.status(400).json({ message: "title required (max 300 chars)" });
        }

        // Validate depth
        const depth = typeof body.depth === "number" ? body.depth : 0;
        if (depth > 3) {
          void recordKevinAuditEvent({
            orgId: org_id,
            eventType: "signal.intake_rejected_loop",
            payload: { depth, signalType: signal_type },
          });
          return res.status(422).json({
            message: "Signal depth exceeded maximum allowed",
            code: "LOOP_DEPTH_EXCEEDED",
          });
        }

        // Validate confidence
        let confidence: number | null = null;
        if (typeof body.confidence === "number") {
          confidence = Math.min(1, Math.max(0, body.confidence));
        }

        // Validate risk_class
        const VALID_RISK_CLASSES = ["low", "medium", "high", "critical"];
        const riskClass =
          typeof body.risk_class === "string" && VALID_RISK_CLASSES.includes(body.risk_class)
            ? (body.risk_class as "low" | "medium" | "high" | "critical")
            : null;

        const result = await routeKevinSignal({
          externalSignalId:
            typeof body.external_signal_id === "string" ? body.external_signal_id : null,
          orgId: org_id,
          signalType: signal_type,
          entityType: typeof body.entity_type === "string" ? body.entity_type : null,
          entityId: typeof body.entity_id === "string" ? body.entity_id : null,
          title,
          summary: typeof body.summary === "string" ? body.summary : null,
          evidence:
            body.evidence && typeof body.evidence === "object" && !Array.isArray(body.evidence)
              ? (body.evidence as Record<string, unknown>)
              : undefined,
          confidence,
          riskClass,
          source: typeof body.source === "string" ? body.source : "kevin",
          traceId: typeof body.trace_id === "string" ? body.trace_id : undefined,
          depth,
        });

        if (!result.ok && result.status !== "duplicate") {
          return res.status(422).json({ message: result.error ?? result.status });
        }

        return res.status(result.status === "duplicate" ? 200 : 201).json({
          ok: result.ok,
          signalId: result.signalId,
          status: result.status,
          routedTo: result.routedTo,
          attentionItemId: result.attentionItemId ?? null,
        });
      } catch (e: any) {
        console.error("[KevinSignalRoutes] intake error:", e?.message);
        return res.status(500).json({ message: "Internal error processing signal" });
      }
    },
  );

  // ── GET /api/admin/kevin/signals ──────────────────────────────────────────
  app.get(
    "/api/admin/kevin/signals",
    isAuthenticated,
    requireKevinAccess,
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const limit = Math.min(Number(req.query.limit) || 50, 100);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const status = typeof req.query.status === "string" ? req.query.status : null;

        const result = await db.execute(sql`
          SELECT id, org_id, external_signal_id, signal_type, entity_type, entity_id,
                 title, summary, confidence, risk_class, source, status, routed_to,
                 attention_item_id, origin_trace_id, depth, created_at, routed_at,
                 actioned_at, dismissed_at
          FROM kevin_signals
          WHERE org_id = ${orgId}
            ${status ? sql`AND status = ${status}` : sql``}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
        const rows = Array.isArray((result as any)?.rows)
          ? (result as any).rows
          : Array.isArray(result)
            ? result
            : [];

        return res.json({ signals: rows, limit, offset });
      } catch (e: any) {
        return res.status(500).json({ message: e?.message ?? "Failed to list signals" });
      }
    },
  );

  // ── GET /api/admin/kevin/signals/:id ─────────────────────────────────────
  app.get(
    "/api/admin/kevin/signals/:id",
    isAuthenticated,
    requireKevinAccess,
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const { id } = req.params;
        const result = await db.execute(sql`
          SELECT * FROM kevin_signals WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
        `);
        const rows = Array.isArray((result as any)?.rows)
          ? (result as any).rows
          : Array.isArray(result)
            ? result
            : [];
        if (!rows[0]) return res.status(404).json({ message: "Signal not found" });

        // Strip evidence for security signals
        const row = { ...rows[0] };
        if (
          typeof row.signal_type === "string" &&
          row.signal_type.toLowerCase().startsWith("security")
        ) {
          row.evidence = { _redacted: "security signal evidence not displayed" };
        }
        return res.json(row);
      } catch (e: any) {
        return res.status(500).json({ message: e?.message ?? "Failed to get signal" });
      }
    },
  );

  // ── POST /api/admin/kevin/signals/:id/dismiss ─────────────────────────────
  app.post(
    "/api/admin/kevin/signals/:id/dismiss",
    isAuthenticated,
    requireKevinAccess,
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });
        const actor = req.user?.claims?.email ?? req.user?.email ?? "admin";
        const { id } = req.params;

        const result = await db.execute(sql`
          UPDATE kevin_signals
          SET status = 'dismissed', dismissed_at = NOW()
          WHERE id = ${id} AND org_id = ${orgId}
            AND status IN ('pending', 'routed')
          RETURNING id
        `);
        const rows = Array.isArray((result as any)?.rows)
          ? (result as any).rows
          : Array.isArray(result)
            ? result
            : [];
        if (!rows[0]) return res.status(404).json({ message: "Signal not found or not dismissible" });

        void recordSignalDismissed({ orgId, signalId: id, dismissedBy: actor });
        return res.json({ ok: true, signalId: id, dismissedBy: actor });
      } catch (e: any) {
        return res.status(500).json({ message: e?.message ?? "Failed to dismiss signal" });
      }
    },
  );

  // ── GET /api/admin/kevin/signals/stats ───────────────────────────────────
  app.get(
    "/api/admin/kevin/signals/stats",
    isAuthenticated,
    requireKevinAccess,
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const result = await db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status = 'pending')    AS pending,
            COUNT(*) FILTER (WHERE status = 'routed')     AS routed,
            COUNT(*) FILTER (WHERE status = 'actioned')   AS actioned,
            COUNT(*) FILTER (WHERE status = 'dismissed')  AS dismissed,
            COUNT(*) FILTER (WHERE status = 'duplicate')  AS duplicates,
            COUNT(*) FILTER (WHERE risk_class = 'critical') AS critical,
            COUNT(*) FILTER (WHERE risk_class = 'high')   AS high_risk,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')   AS last_7d
          FROM kevin_signals
          WHERE org_id = ${orgId}
        `);
        const rows = Array.isArray((result as any)?.rows)
          ? (result as any).rows
          : Array.isArray(result)
            ? result
            : [];

        return res.json(rows[0] ?? {});
      } catch (e: any) {
        return res.status(500).json({ message: e?.message ?? "Failed to get stats" });
      }
    },
  );
}
