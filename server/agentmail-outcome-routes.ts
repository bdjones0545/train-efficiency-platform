/**
 * AgentMail Outcome Routes — Phase E
 * Provides outcome correlation endpoints for AgentMail messages.
 */

import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { recomputeOutcomesForOrg, getOutcomeSummary } from "./services/agentmail-outcome-correlation-service";

// ─── Table bootstrap ───────────────────────────────────────────────────────────

export async function ensureAgentmailOutcomeTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agentmail_outcome_events (
        id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        org_id text NOT NULL,
        action_id text NOT NULL,
        communication_domain text,
        recipient_email text,
        outcome_type text NOT NULL,
        related_entity_type text,
        related_entity_id text,
        outcome_value numeric DEFAULT 0,
        source text NOT NULL DEFAULT 'auto_correlation',
        confidence numeric DEFAULT 1.0,
        metadata jsonb DEFAULT '{}',
        detected_at timestamp DEFAULT now(),
        created_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS agentmail_outcome_events_dedup
        ON agentmail_outcome_events (org_id, action_id, outcome_type, related_entity_type, related_entity_id)
    `);
  } catch (err: any) {
    if (!err.message?.includes("already exists")) {
      console.error("[AgentmailOutcomes] Table bootstrap error:", err.message);
    }
  }
}

// ─── Route registration ────────────────────────────────────────────────────────

export async function registerAgentmailOutcomeRoutes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void,
): Promise<void> {
  // Run table creation on startup
  await ensureAgentmailOutcomeTable();

  const requireAdmin = requireRole("ADMIN");

  // ── GET /api/admin/agentmail-outcomes/summary ─────────────────────────────
  app.get("/api/admin/agentmail-outcomes/summary", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = (req as any)._authProfile?.orgId ?? req.user?.orgId;
      if (!orgId) return res.status(400).json({ error: "No org context" });

      const data = await getOutcomeSummary({
        orgId,
        range: (req.query.range as string) ?? "30d",
        domain: (req.query.domain as string) ?? "all",
      });
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/agentmail-outcomes/recompute ──────────────────────────
  app.post("/api/admin/agentmail-outcomes/recompute", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = (req as any)._authProfile?.orgId ?? req.user?.orgId;
      if (!orgId) return res.status(400).json({ error: "No org context" });

      const result = await recomputeOutcomesForOrg(orgId);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/agentmail-outcomes/recent ──────────────────────────────
  // Lightweight recent events for real-time monitoring
  app.get("/api/admin/agentmail-outcomes/recent", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const orgId = (req as any)._authProfile?.orgId ?? req.user?.orgId;
      if (!orgId) return res.status(400).json({ error: "No org context" });

      const rows = await db.execute(sql`
        SELECT outcome_type, communication_domain, recipient_email, action_id,
               outcome_value, detected_at
        FROM agentmail_outcome_events
        WHERE org_id = ${orgId}
        ORDER BY detected_at DESC
        LIMIT 50
      `);
      const events: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
      res.json({ events });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
