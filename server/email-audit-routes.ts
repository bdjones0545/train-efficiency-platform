/**
 * Email Audit Routes — Phase 6 Remediation
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides read-only access to the unified outbound_email_audit_log table so
 * admins can see every automated email attempt (sent, blocked, draft_created,
 * or failed) across all channels (SendGrid, Gmail, AgentMail) in one place.
 *
 * Routes:
 *   GET  /api/email-audit          — paginated log with filters
 *   GET  /api/email-audit/stats    — summary stats (sent/blocked/failed counts)
 *   GET  /api/email-audit/blocked  — quick-view of all blocked sends
 */

import type { Express, Request, Response } from "express";
import { queryOutboundAuditLog } from "./services/outbound-audit-log";
import { db } from "./db";
import { sql } from "drizzle-orm";

function rowsOf(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  return (r as any)?.rows ?? [];
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!(req as any).user) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}

function getOrgId(req: Request): string | null {
  const user = (req as any).user;
  return user?.organizationId ?? user?.orgId ?? null;
}

export function registerEmailAuditRoutes(app: Express): void {
  /**
   * GET /api/email-audit
   * Returns paginated records from the outbound_email_audit_log.
   *
   * Query params:
   *   channel         — 'sendgrid' | 'gmail' | 'agentmail'
   *   status          — 'sent' | 'blocked' | 'failed' | 'draft_created'
   *   autoSent        — 'true' | 'false'
   *   approvalRequired — 'true' | 'false'
   *   policyDecision  — 'auto_execute' | 'approval_required' | 'blocked'
   *   recipientEmail  — partial match
   *   limit           — default 50, max 200
   *   offset          — default 0
   */
  app.get("/api/email-audit", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(403).json({ error: "No organization" });

    try {
      const {
        channel,
        status,
        autoSent,
        approvalRequired,
        policyDecision,
        recipientEmail,
        limit,
        offset,
      } = req.query as Record<string, string | undefined>;

      const result = await queryOutboundAuditLog({
        orgId,
        channel,
        status,
        autoSent: autoSent === "true" ? true : autoSent === "false" ? false : undefined,
        approvalRequired:
          approvalRequired === "true"
            ? true
            : approvalRequired === "false"
            ? false
            : undefined,
        policyDecision,
        recipientEmail,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });

      res.json(result);
    } catch (e: any) {
      console.error("[EmailAudit] GET /api/email-audit error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/email-audit/stats
   * Returns aggregate counts for the org.
   */
  app.get("/api/email-audit/stats", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(403).json({ error: "No organization" });

    try {
      const safeOrgId = orgId.replace(/'/g, "''");
      const rows = rowsOf(
        await db.execute(sql.raw(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'sent')          AS total_sent,
            COUNT(*) FILTER (WHERE status = 'blocked')        AS total_blocked,
            COUNT(*) FILTER (WHERE status = 'failed')         AS total_failed,
            COUNT(*) FILTER (WHERE status = 'draft_created')  AS total_draft_created,
            COUNT(*) FILTER (WHERE auto_sent = true)          AS total_auto_sent,
            COUNT(*) FILTER (WHERE approval_required = true)  AS total_approval_required,
            COUNT(*) FILTER (WHERE channel = 'sendgrid')      AS sendgrid_count,
            COUNT(*) FILTER (WHERE channel = 'gmail')         AS gmail_count,
            COUNT(*) FILTER (WHERE channel = 'agentmail')     AS agentmail_count,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h_total,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND status = 'sent') AS last_24h_sent,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND status = 'blocked') AS last_24h_blocked
          FROM outbound_email_audit_log
          WHERE organization_id = '${safeOrgId}'
        `)).catch(() => [])
      );

      const stats = rows[0] ?? {};
      res.json({
        totalSent: parseInt(stats.total_sent ?? "0", 10),
        totalBlocked: parseInt(stats.total_blocked ?? "0", 10),
        totalFailed: parseInt(stats.total_failed ?? "0", 10),
        totalDraftCreated: parseInt(stats.total_draft_created ?? "0", 10),
        totalAutoSent: parseInt(stats.total_auto_sent ?? "0", 10),
        totalApprovalRequired: parseInt(stats.total_approval_required ?? "0", 10),
        sendgridCount: parseInt(stats.sendgrid_count ?? "0", 10),
        gmailCount: parseInt(stats.gmail_count ?? "0", 10),
        agentmailCount: parseInt(stats.agentmail_count ?? "0", 10),
        last24hTotal: parseInt(stats.last_24h_total ?? "0", 10),
        last24hSent: parseInt(stats.last_24h_sent ?? "0", 10),
        last24hBlocked: parseInt(stats.last_24h_blocked ?? "0", 10),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/email-audit/blocked
   * Convenience endpoint — last 100 blocked sends.
   */
  app.get("/api/email-audit/blocked", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(403).json({ error: "No organization" });

    try {
      const result = await queryOutboundAuditLog({ orgId, status: "blocked", limit: 100 });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log("[Email Audit Routes] registered: /api/email-audit, /api/email-audit/stats, /api/email-audit/blocked");
}
