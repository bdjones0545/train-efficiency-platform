/**
 * AgentMail Routes
 * All routes are org-scoped and auth-gated.
 */

import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  isAgentMailConfigured,
  verifyAgentMailConnection,
  listInboxes,
  createOrVerifyInbox,
  getInboxMessages,
  sendAgentEmail,
  replyFromAgentInbox,
  handleAgentMailWebhook,
  AGENT_INBOXES,
  type AgentInbox,
} from "./services/agentmail-service";

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

async function ensureAgentMailTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_mail_messages (
        id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        organization_id     TEXT NOT NULL,
        agent_name          TEXT NOT NULL,
        inbox               TEXT NOT NULL,
        to_email            TEXT NOT NULL,
        from_email          TEXT,
        subject             TEXT NOT NULL,
        body_preview        TEXT,
        provider_message_id TEXT,
        status              TEXT NOT NULL DEFAULT 'queued',
        error_message       TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_agent_mail_org ON agent_mail_messages (organization_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_agent_mail_inbox ON agent_mail_messages (inbox);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_agent_mail_status ON agent_mail_messages (status);
    `);
  } catch (e: any) {
    console.error("[AgentMail] Table setup error:", e?.message);
  }
}

function getOrgId(req: any): string | null {
  return req.user?.orgId ?? req.query.orgId ?? null;
}

export async function registerAgentMailRoutes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void,
): Promise<void> {
  await ensureAgentMailTable();

  // ─── GET /api/agentmail/status ─────────────────────────────────────────────
  app.get("/api/agentmail/status", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const configured = isAgentMailConfigured();
      if (!configured) {
        return res.json({
          configured: false,
          connected: false,
          message: "AgentMail not configured. Add AGENTMAIL_API_KEY to Replit Secrets.",
          agentInboxes: AGENT_INBOXES,
        });
      }

      const status = await verifyAgentMailConnection();
      return res.json({ ...status, agentInboxes: AGENT_INBOXES });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to get AgentMail status" });
    }
  });

  // ─── GET /api/agentmail/inboxes ────────────────────────────────────────────
  app.get("/api/agentmail/inboxes", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      if (!isAgentMailConfigured()) {
        return res.json({ configured: false, inboxes: [], agentInboxes: AGENT_INBOXES });
      }

      const result = await listInboxes();
      res.json({ configured: true, inboxes: result.inboxes, agentInboxes: AGENT_INBOXES, error: result.error });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to list inboxes" });
    }
  });

  // ─── POST /api/agentmail/inboxes/verify ───────────────────────────────────
  app.post("/api/agentmail/inboxes/verify", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      if (!isAgentMailConfigured()) {
        return res.status(503).json({ message: "AgentMail not configured." });
      }

      const { inbox } = req.body;
      if (!inbox) return res.status(400).json({ message: "inbox is required (e.g. 'revenue')" });

      const result = await createOrVerifyInbox(inbox);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to verify inbox" });
    }
  });

  // ─── POST /api/agentmail/send ──────────────────────────────────────────────
  app.post("/api/agentmail/send", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      if (!isAgentMailConfigured()) {
        return res.status(503).json({ message: "AgentMail not configured." });
      }

      const { agentName, fromInbox, to, subject, body, replyTo } = req.body;
      if (!fromInbox || !to || !subject || !body) {
        return res.status(400).json({ message: "fromInbox, to, subject, and body are required" });
      }

      const result = await sendAgentEmail({
        organizationId: orgId,
        agentName: agentName ?? "Manual Send",
        fromInbox: fromInbox as AgentInbox,
        to,
        subject,
        body,
        replyTo,
      });

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to send email" });
    }
  });

  // ─── GET /api/agentmail/messages ──────────────────────────────────────────
  app.get("/api/agentmail/messages", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { status, inbox, limit = "50", offset = "0" } = req.query as Record<string, string>;
      const lim = Math.min(parseInt(limit, 10) || 50, 200);
      const off = parseInt(offset, 10) || 0;

      let msgs = rows(await db.execute(sql`
        SELECT * FROM agent_mail_messages
        WHERE organization_id = ${orgId}
        ORDER BY created_at DESC
        LIMIT ${lim} OFFSET ${off}
      `));

      if (status) msgs = msgs.filter((m: any) => m.status === status);
      if (inbox) msgs = msgs.filter((m: any) => m.inbox === inbox);

      const statsRows = rows(await db.execute(sql`
        SELECT status, COUNT(*)::int AS cnt
        FROM agent_mail_messages
        WHERE organization_id = ${orgId}
        GROUP BY status
      `));
      const byStatus: Record<string, number> = {};
      for (const r of statsRows) byStatus[r.status] = r.cnt;

      res.json({ messages: msgs, total: msgs.length, byStatus });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to fetch messages" });
    }
  });

  // ─── GET /api/agentmail/inbox-messages ────────────────────────────────────
  app.get("/api/agentmail/inbox-messages", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      if (!isAgentMailConfigured()) {
        return res.json({ configured: false, messages: [] });
      }

      const { inbox, limit = "20" } = req.query as Record<string, string>;
      if (!inbox) return res.status(400).json({ message: "inbox param required (e.g. revenue@yourdomain.com)" });

      const result = await getInboxMessages(inbox, parseInt(limit, 10) || 20);
      res.json({ configured: true, ...result });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to get inbox messages" });
    }
  });

  // ─── POST /api/agentmail/reply ────────────────────────────────────────────
  app.post("/api/agentmail/reply", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      if (!isAgentMailConfigured()) {
        return res.status(503).json({ message: "AgentMail not configured." });
      }

      const { agentName, fromInbox, threadId, to, subject, body } = req.body;
      if (!fromInbox || !threadId || !to || !subject || !body) {
        return res.status(400).json({ message: "fromInbox, threadId, to, subject, and body are required" });
      }

      const result = await replyFromAgentInbox({
        organizationId: orgId,
        agentName: agentName ?? "Manual Reply",
        fromInbox: fromInbox as AgentInbox,
        threadId,
        to,
        subject,
        body,
      });

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to send reply" });
    }
  });

  // ─── POST /api/agentmail/webhook ──────────────────────────────────────────
  // Public endpoint — no auth, validated by HMAC signature
  app.post("/api/agentmail/webhook", async (req: any, res) => {
    try {
      const rawBody = JSON.stringify(req.body);
      const sig = req.headers["x-agentmail-signature"] as string | undefined;

      const result = await handleAgentMailWebhook(rawBody, sig);
      if (!result.ok) {
        return res.status(401).json({ error: result.error });
      }

      const event = result.event as any;
      console.log("[AgentMail] Webhook received:", event?.type ?? "unknown");

      res.json({ received: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Webhook handling failed" });
    }
  });

  // ─── POST /api/agentmail/test ─────────────────────────────────────────────
  app.post("/api/agentmail/test", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      if (!isAgentMailConfigured()) {
        return res.status(503).json({ message: "AgentMail not configured. Add AGENTMAIL_API_KEY to Replit Secrets." });
      }

      const { to } = req.body;
      if (!to) return res.status(400).json({ message: "to email is required for test send" });

      const result = await sendAgentEmail({
        organizationId: orgId,
        agentName: "Test",
        fromInbox: "operations",
        to,
        subject: "AgentMail Test Email — TrainEfficiency",
        body: "This is a test email sent from the AgentMail integration in TrainEfficiency. If you received this, the connection is working correctly.",
      });

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Test send failed" });
    }
  });
}
