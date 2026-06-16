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
import {
  processInboundAgentMail,
  resolveOrgFromInbox,
  INBOUND_TEST_CASES,
} from "./services/agentmail-inbound-router";

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

async function ensureAgentMailTables(): Promise<void> {
  // Schema migration: add never_auto_send column if missing (schema drift guard)
  try {
    await db.execute(sql`
      ALTER TABLE org_automation_settings
      ADD COLUMN IF NOT EXISTS never_auto_send BOOLEAN NOT NULL DEFAULT TRUE
    `);
  } catch (e: any) {
    console.error("[AgentMail] never_auto_send migration error:", e?.message);
  }

  // Outbound audit log
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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agent_mail_org    ON agent_mail_messages (organization_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agent_mail_inbox  ON agent_mail_messages (inbox)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agent_mail_status ON agent_mail_messages (status)`);
  } catch (e: any) {
    console.error("[AgentMail] Outbound table setup error:", e?.message);
  }

  // Inbound messages
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_mail_inbound_messages (
        id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        organization_id      TEXT NOT NULL,
        inbox                TEXT NOT NULL,
        from_email           TEXT NOT NULL,
        from_name            TEXT,
        to_email             TEXT NOT NULL,
        subject              TEXT NOT NULL,
        body_text            TEXT,
        body_html            TEXT,
        provider_message_id  TEXT UNIQUE,
        provider_thread_id   TEXT,
        classification       TEXT,
        confidence           DOUBLE PRECISION DEFAULT 0,
        routed_agent         TEXT,
        routed_status        TEXT NOT NULL DEFAULT 'received',
        action_type          TEXT,
        action_payload       JSONB,
        raw_payload          JSONB,
        error_message        TEXT,
        received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_org    ON agent_mail_inbound_messages (organization_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_inbox  ON agent_mail_inbound_messages (inbox)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_class  ON agent_mail_inbound_messages (classification)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_status ON agent_mail_inbound_messages (routed_status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_rcvd   ON agent_mail_inbound_messages (received_at DESC)`);
  } catch (e: any) {
    console.error("[AgentMail] Inbound table setup error:", e?.message);
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
  await ensureAgentMailTables();

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

      // Inbound stats
      const inboundStats = rows(await db.execute(sql`
        SELECT routed_status, COUNT(*)::int AS cnt
        FROM agent_mail_inbound_messages
        WHERE organization_id = ${orgId}
        GROUP BY routed_status
      `).catch(() => []));
      const byRoutedStatus: Record<string, number> = {};
      for (const r of inboundStats) byRoutedStatus[r.routed_status] = r.cnt;

      const classStats = rows(await db.execute(sql`
        SELECT classification, COUNT(*)::int AS cnt
        FROM agent_mail_inbound_messages
        WHERE organization_id = ${orgId}
        GROUP BY classification
      `).catch(() => []));
      const byClassification: Record<string, number> = {};
      for (const r of classStats) byClassification[r.classification ?? "unknown"] = r.cnt;

      const urgentCount = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM agent_mail_inbound_messages
        WHERE organization_id = ${orgId} AND classification = 'urgent_escalation'
        AND routed_status != 'spam_stored'
      `).catch(() => []))[0]?.cnt ?? 0;

      return res.json({
        ...status,
        agentInboxes: AGENT_INBOXES,
        inbound: { byRoutedStatus, byClassification, urgentEscalations: urgentCount },
      });
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
      if (!isAgentMailConfigured()) return res.status(503).json({ message: "AgentMail not configured." });

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
      if (!isAgentMailConfigured()) return res.status(503).json({ message: "AgentMail not configured." });

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
        humanApproved: true,
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

  // ─── GET /api/agentmail/inbound ───────────────────────────────────────────
  app.get("/api/agentmail/inbound", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const {
        inbox,
        classification,
        routed_status,
        limit = "100",
        offset = "0",
      } = req.query as Record<string, string>;
      const lim = Math.min(parseInt(limit, 10) || 100, 500);
      const off = parseInt(offset, 10) || 0;

      let msgs = rows(await db.execute(sql`
        SELECT * FROM agent_mail_inbound_messages
        WHERE organization_id = ${orgId}
        ORDER BY received_at DESC
        LIMIT ${lim} OFFSET ${off}
      `).catch(() => []));

      if (inbox) msgs = msgs.filter((m: any) => m.inbox === inbox);
      if (classification) msgs = msgs.filter((m: any) => m.classification === classification);
      if (routed_status) msgs = msgs.filter((m: any) => m.routed_status === routed_status);

      const statsRows = rows(await db.execute(sql`
        SELECT classification, routed_status, COUNT(*)::int AS cnt
        FROM agent_mail_inbound_messages
        WHERE organization_id = ${orgId}
        GROUP BY classification, routed_status
      `).catch(() => []));

      const byClassification: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      for (const r of statsRows) {
        byClassification[r.classification ?? "unknown"] = (byClassification[r.classification ?? "unknown"] ?? 0) + r.cnt;
        byStatus[r.routed_status] = (byStatus[r.routed_status] ?? 0) + r.cnt;
      }

      res.json({ messages: msgs, total: msgs.length, byClassification, byStatus });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to fetch inbound messages" });
    }
  });

  // ─── GET /api/agentmail/inbound/:id ──────────────────────────────────────
  app.get("/api/agentmail/inbound/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { id } = req.params;
      const record = rows(await db.execute(sql`
        SELECT * FROM agent_mail_inbound_messages
        WHERE id = ${id} AND organization_id = ${orgId}
        LIMIT 1
      `).catch(() => []))[0];

      if (!record) return res.status(404).json({ message: "Message not found" });
      res.json(record);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to fetch inbound message" });
    }
  });

  // ─── GET /api/agentmail/inbox-messages ────────────────────────────────────
  app.get("/api/agentmail/inbox-messages", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      if (!isAgentMailConfigured()) return res.json({ configured: false, messages: [] });

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
      if (!isAgentMailConfigured()) return res.status(503).json({ message: "AgentMail not configured." });

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
        humanApproved: true,
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
      const eventType: string = event?.type ?? "unknown";
      console.log("[AgentMail] Webhook received:", eventType);

      // ── Inbound email event routing ───────────────────────────────────────
      if (eventType === "email.received" || eventType === "inbound" || event?.email) {
        const emailData = event?.email ?? event?.data ?? event;

        const toAddress: string = emailData?.to ?? emailData?.to_email ?? "";
        const inboxLocal = toAddress.split("@")[0]?.toLowerCase() ?? "operations";

        // Resolve org — best-effort
        let organizationId: string | null = await resolveOrgFromInbox(toAddress).catch(() => null);
        if (!organizationId) {
          console.warn("[AgentMail] Could not resolve org for inbox:", toAddress);
          // Store unresolved for admin review
          await db.execute(sql`
            INSERT INTO agent_mail_inbound_messages (
              id, organization_id, inbox, from_email, to_email, subject,
              body_text, provider_message_id, routed_status, error_message, received_at, created_at, updated_at
            ) VALUES (
              gen_random_uuid()::text, 'unresolved', ${inboxLocal},
              ${emailData?.from ?? "unknown"}, ${toAddress},
              ${emailData?.subject ?? "(no subject)"}, ${emailData?.text ?? emailData?.body ?? null},
              ${emailData?.id ?? emailData?.message_id ?? null},
              ${"failed"}, ${"Could not resolve organization from inbox address"},
              NOW(), NOW(), NOW()
            )
          `).catch(() => {});
          return res.json({ received: true, routed: false, reason: "org_unresolved" });
        }

        const processResult = await processInboundAgentMail({
          organizationId,
          inbox: inboxLocal,
          fromEmail: emailData?.from ?? emailData?.from_email ?? "unknown",
          fromName: emailData?.from_name ?? emailData?.sender_name ?? undefined,
          toEmail: toAddress,
          subject: emailData?.subject ?? "(no subject)",
          bodyText: emailData?.text ?? emailData?.body_text ?? emailData?.plain ?? undefined,
          bodyHtml: emailData?.html ?? emailData?.body_html ?? undefined,
          providerMessageId: emailData?.id ?? emailData?.message_id ?? undefined,
          providerThreadId: emailData?.thread_id ?? undefined,
          receivedAt: emailData?.date ? new Date(emailData.date) : new Date(),
          rawPayload: event,
        });

        console.log("[AgentMail] Inbound processed:", processResult.classification, processResult.routedAgent);
        return res.json({ received: true, routed: processResult.ok, ...processResult });
      }

      res.json({ received: true, routed: false, reason: "not_an_inbound_email_event" });
    } catch (e: any) {
      console.error("[AgentMail] Webhook error:", e?.message);
      res.status(500).json({ message: e?.message ?? "Webhook handling failed" });
    }
  });

  // ─── POST /api/agentmail/simulate-inbound ─────────────────────────────────
  // Test/debug endpoint for simulating inbound email payloads
  app.post("/api/agentmail/simulate-inbound", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { testCaseIndex, custom } = req.body;

      let payload: any;
      if (custom) {
        payload = { ...custom, organizationId: orgId };
      } else if (typeof testCaseIndex === "number" && INBOUND_TEST_CASES[testCaseIndex]) {
        payload = { ...INBOUND_TEST_CASES[testCaseIndex].payload, organizationId: orgId };
        // Make message ID unique so it's not deduped
        payload.providerMessageId = `sim-${testCaseIndex}-${Date.now()}`;
      } else {
        return res.status(400).json({
          message: "Provide testCaseIndex (0–5) or a custom payload",
          availableTestCases: INBOUND_TEST_CASES.map((tc, i) => ({ index: i, label: tc.label })),
        });
      }

      const result = await processInboundAgentMail(payload);
      res.json({ simulated: true, ...result });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Simulation failed" });
    }
  });

  // ─── GET /api/agentmail/simulate-inbound/cases ────────────────────────────
  app.get("/api/agentmail/simulate-inbound/cases", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req: any, res) => {
    res.json(INBOUND_TEST_CASES.map((tc, i) => ({ index: i, label: tc.label, inbox: tc.payload.inbox })));
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
        humanApproved: true,
      });

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Test send failed" });
    }
  });
}
