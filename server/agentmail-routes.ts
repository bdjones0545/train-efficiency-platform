/**
 * AgentMail Routes
 * All routes are org-scoped and auth-gated.
 */

import type { Express } from "express";
import { resolveOrgIdOrThrow } from "./lib/resolve-org-id";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  isAgentMailConfigured,
  verifyAgentMailConnection,
  listInboxes,
  createOrVerifyInbox,
  getInboxMessages,
  sendAgentEmail,
  replyFromAgentInbox,
  AGENT_INBOXES,
  type AgentInbox,
} from "./services/agentmail-service";
import { verifyAgentMailWebhook } from "./services/agentmail-svix";
import {
  processInboundAgentMail,
  INBOUND_TEST_CASES,
} from "./services/agentmail-inbound-router";
import {
  resolveOrgByProviderInboxId,
  provisionOrgInboxes,
  activateOrgInboxes,
  disableOrgInbox,
  retireOrgInbox,
  retireAllOrgInboxes,
  verifyOrgInboxProvisioning,
  listOrgInboxes,
  type AgentMailRole,
} from "./services/agentmail-ownership-service";
import {
  runAgentMailMigration,
  isAgentMailSchemaReady,
} from "./services/agentmail-migration";

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

// ─── Quarantine persistence helper ───────────────────────────────────────────

interface QuarantineParams {
  inboxRole: string;
  fromAddr: string;
  toAddress: string;
  subject: string;
  bodyText: string | null;
  providerMessageId: string | null;
  providerInboxId: string | null;
  providerEventId: string | null;
  reason: string;
}

/**
 * Durably persist a quarantine record.
 * Returns true on success (or idempotent duplicate).
 * Returns false if the DB insert fails — caller MUST return 503 to trigger provider retry.
 *
 * A 200 response on quarantine persistence failure would permanently lose the evidence.
 */
async function persistQuarantine(p: QuarantineParams): Promise<boolean> {
  try {
    await db.execute(sql`
      INSERT INTO agent_mail_inbound_messages (
        id, organization_id, inbox, from_email, from_name, to_email, subject,
        body_text, provider_message_id, provider_inbox_id, provider_event_id,
        routed_status, routing_status, routing_reason, routed_at,
        processing_state, received_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid()::text,
        NULL,
        ${p.inboxRole},
        ${p.fromAddr},
        ${null},
        ${p.toAddress},
        ${p.subject},
        ${p.bodyText},
        ${p.providerMessageId},
        ${p.providerInboxId},
        ${p.providerEventId},
        ${"quarantine"},
        ${"quarantine"},
        ${p.reason},
        NOW(),
        ${"completed"},
        NOW(), NOW(), NOW()
      )
      ON CONFLICT (provider_message_id) DO NOTHING
    `);
    return true;
  } catch (e: any) {
    console.error("[AgentMail] Quarantine DB insert failed:", e?.message);
    return false;
  }
}

type DeliveryClaim = "claimed" | "completed" | "processing" | "payload_mismatch";

async function claimWebhookDelivery(svixId: string, rawBody: Buffer): Promise<DeliveryClaim> {
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const claimed = rows(await db.execute(sql`
    INSERT INTO agentmail_webhook_deliveries (svix_id, payload_hash, status, claimed_at, updated_at)
    VALUES (${svixId}, ${payloadHash}, 'processing', NOW(), NOW())
    ON CONFLICT (svix_id) DO UPDATE
      SET status = 'processing', claimed_at = NOW(), last_error = NULL, updated_at = NOW()
    WHERE agentmail_webhook_deliveries.payload_hash = EXCLUDED.payload_hash
      AND (
        agentmail_webhook_deliveries.status = 'failed'
        OR (agentmail_webhook_deliveries.status = 'processing'
            AND agentmail_webhook_deliveries.claimed_at < NOW() - INTERVAL '5 minutes')
      )
    RETURNING status
  `));
  if (claimed.length > 0) return "claimed";

  const existing = rows(await db.execute(sql`
    SELECT payload_hash, status FROM agentmail_webhook_deliveries WHERE svix_id = ${svixId}
  `))[0];
  if (!existing || existing.payload_hash !== payloadHash) return "payload_mismatch";
  return existing.status === "completed" ? "completed" : "processing";
}

async function finishWebhookDelivery(svixId: string, ok: boolean, error?: string): Promise<void> {
  await db.execute(sql`
    UPDATE agentmail_webhook_deliveries
    SET status = ${ok ? "completed" : "failed"},
        completed_at = ${ok ? sql`NOW()` : sql`NULL`},
        last_error = ${error ?? null}, updated_at = NOW()
    WHERE svix_id = ${svixId}
  `);
}

// Legacy shim — kept so any callers that already imported it still compile.
// The real migration now lives in agentmail-migration.ts.
async function ensureAgentMailTables(): Promise<void> {
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

async function getOrgId(req: any): Promise<string | null> {
  try {
    return await resolveOrgIdOrThrow(req);
  } catch {
    return null;
  }
}

export async function registerAgentMailRoutes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void,
  ownershipOverrides: Partial<{
    provisionOrgInboxes: typeof provisionOrgInboxes;
    activateOrgInboxes: typeof activateOrgInboxes;
    disableOrgInbox: typeof disableOrgInbox;
    retireOrgInbox: typeof retireOrgInbox;
    retireAllOrgInboxes: typeof retireAllOrgInboxes;
  }> = {},
): Promise<void> {
  const provisionOwnership = ownershipOverrides.provisionOrgInboxes ?? provisionOrgInboxes;
  const activateOwnership = ownershipOverrides.activateOrgInboxes ?? activateOrgInboxes;
  const disableOwnership = ownershipOverrides.disableOrgInbox ?? disableOrgInbox;
  const retireOwnership = ownershipOverrides.retireOrgInbox ?? retireOrgInbox;
  const retireAllOwnership = ownershipOverrides.retireAllOrgInboxes ?? retireAllOrgInboxes;
  // Deterministic ordered migration — must succeed before any route handles traffic.
  // Uses the shared runAgentMailMigration() from agentmail-migration.ts; concurrent
  // calls share the same in-flight promise (idempotent).
  try {
    await runAgentMailMigration();
  } catch (e: any) {
    console.error("[AgentMail] Schema migration failed — AgentMail routes degraded:", e?.message);
    // Don't throw: let the process start so /status can report the problem.
  }

  // ─── GET /api/agentmail/status ─────────────────────────────────────────────
  app.get("/api/agentmail/status", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
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

      let status: { configured: boolean; connected: boolean; message: string; details?: unknown };
      try {
        status = await verifyAgentMailConnection();
      } catch (connErr: any) {
        status = {
          configured: true,
          connected: false,
          message: `AgentMail connection check failed: ${connErr?.message ?? "network error"}`,
        };
      }

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
        orgDomain: process.env.AGENTMAIL_ORG_DOMAIN || "trainefficiency.com",
        inbound: { byRoutedStatus, byClassification, urgentEscalations: urgentCount },
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to get AgentMail status" });
    }
  });

  // ─── GET /api/agentmail/inboxes ────────────────────────────────────────────
  app.get("/api/agentmail/inboxes", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      if (!isAgentMailConfigured()) {
        return res.json({ configured: false, inboxes: [], agentInboxes: AGENT_INBOXES, orgDomain: process.env.AGENTMAIL_ORG_DOMAIN || "trainefficiency.com" });
      }

      const result = await listInboxes();
      res.json({ configured: true, inboxes: result.inboxes, agentInboxes: AGENT_INBOXES, orgDomain: process.env.AGENTMAIL_ORG_DOMAIN || "trainefficiency.com", error: result.error });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to list inboxes" });
    }
  });

  // ─── POST /api/agentmail/inboxes/verify ───────────────────────────────────
  app.post("/api/agentmail/inboxes/verify", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
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

  // ─── POST /api/agentmail/inboxes/verify-all ───────────────────────────────
  // Bulk verify / create all configured agent inboxes in a single call.
  app.post("/api/agentmail/inboxes/verify-all", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      if (!isAgentMailConfigured()) return res.status(503).json({ message: "AgentMail not configured." });

      const domain = process.env.AGENTMAIL_ORG_DOMAIN || "trainefficiency.com";
      const results = await Promise.all(
        AGENT_INBOXES.map(async (def) => {
          const r = await createOrVerifyInbox(def.inbox);
          return { inbox: def.inbox, email: `${def.inbox}@${domain}`, agent: def.agent, ...r };
        }),
      );
      const allOk = results.every((r) => r.ok);
      res.json({ allOk, domain, results });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to verify all inboxes" });
    }
  });

  // ─── POST /api/agentmail/send ──────────────────────────────────────────────
  app.post("/api/agentmail/send", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
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
      const orgId = await getOrgId(req);
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
      const orgId = await getOrgId(req);
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
      const orgId = await getOrgId(req);
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
      const orgId = await getOrgId(req);
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
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      if (!isAgentMailConfigured()) return res.status(503).json({ message: "AgentMail not configured." });

      const { agentName, fromInbox, replyToMessageId, threadId, to, subject, body } = req.body;
      if (!fromInbox || !replyToMessageId || !to || !subject || !body) {
        return res.status(400).json({ message: "fromInbox, replyToMessageId, to, subject, and body are required" });
      }

      const result = await replyFromAgentInbox({
        organizationId: orgId,
        agentName: agentName ?? "Manual Reply",
        fromInbox: fromInbox as AgentInbox,
        replyToMessageId,
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

  // ─── POST /api/agentmail/webhook ─────────────────────────────────────────────
  // Unauthenticated endpoint — verified via Svix headers against raw request body.
  //
  // AgentMail uses Svix for webhook delivery (ref: agentmail.to/docs/webhook-verification).
  // Required headers: svix-id, svix-timestamp, svix-signature.
  // Signature covers the EXACT raw bytes — never reconstruct from JSON.stringify.
  // req.rawBody is captured by the express.json({ verify }) callback in server/index.ts.
  //
  // Routing invariant: inbox_id is MANDATORY.
  //   Missing inbox_id  → quarantine (malformed/untrusted event)
  //   Unknown inbox_id  → quarantine (no ownership record)
  //   Address-only path → REMOVED (destination address cannot establish tenant ownership)
  //
  // Quarantine durability invariant:
  //   If the quarantine record cannot be persisted → return 503 (retryable).
  //   A 200 response on quarantine persistence failure would permanently lose evidence.
  app.post("/api/agentmail/webhook", async (req: any, res) => {
    try {
      // ── Readiness gate ────────────────────────────────────────────────────
      if (!isAgentMailSchemaReady()) {
        console.warn("[AgentMail] Webhook received before schema ready — returning 503");
        return res.status(503).json({ error: "Service starting up — retry later" });
      }

      // ── Svix signature verification ───────────────────────────────────────
      // req.rawBody is the exact network bytes before body parsing.
      // express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }) in
      // server/index.ts (line ~147) captures this for every JSON request.
      const rawBody: Buffer | undefined = (req as any).rawBody;
      if (!Buffer.isBuffer(rawBody)) {
        console.error("[AgentMail] Webhook: req.rawBody not a Buffer — server middleware misconfigured");
        return res.status(503).json({ error: "Raw body unavailable — check server middleware" });
      }

      const verifyResult = verifyAgentMailWebhook(rawBody, req.headers);
      if (!verifyResult.ok) {
        const status = verifyResult.httpStatus ?? 401;
        console.warn(`[AgentMail] Webhook rejected (${status}): ${verifyResult.error}`);
        return res.status(status).json({ error: verifyResult.error });
      }

      const svixId = Array.isArray(req.headers["svix-id"])
        ? req.headers["svix-id"][0]
        : req.headers["svix-id"];
      if (!svixId) return res.status(401).json({ error: "Missing svix-id" });
      const deliveryClaim = await claimWebhookDelivery(svixId, rawBody);
      if (deliveryClaim === "payload_mismatch") {
        return res.status(401).json({ error: "Webhook delivery ID payload mismatch" });
      }
      if (deliveryClaim === "completed") {
        return res.json({ received: true, duplicate: true });
      }
      if (deliveryClaim === "processing") {
        return res.status(409).json({ error: "Webhook delivery already processing" });
      }

      // ── Parse verified event ──────────────────────────────────────────────
      let event: any;
      try {
        event = JSON.parse(rawBody.toString("utf8"));
      } catch {
        await finishWebhookDelivery(svixId, false, "invalid_json");
        return res.status(400).json({ error: "Webhook body is not valid JSON" });
      }

      const eventType: string = event?.event_type ?? "unknown";
      console.log("[AgentMail] Webhook received:", eventType);

      // ── Inbound email events ──────────────────────────────────────────────
      const RECEIVED_EVENTS = new Set([
        "message.received",
        "message.received.spam",
        "message.received.blocked",
        "message.received.unauthenticated",
      ]);

      if (RECEIVED_EVENTS.has(eventType)) {
        const msg = event?.message;
        if (!msg) {
          console.warn(`[AgentMail] Webhook ${eventType}: missing 'message' object`);
          await finishWebhookDelivery(svixId, false, "missing_message_object");
          return res.status(400).json({ error: "Malformed webhook: missing message object" });
        }

        // ── inbox_id is MANDATORY — no address-only fallback ──────────────
        // Events without inbox_id are malformed/untrusted.
        const providerInboxId: string | null = msg.inbox_id ?? null;
        if (!providerInboxId) {
          console.warn("[AgentMail] Quarantine: missing inbox_id — cannot establish tenant identity");
          const persisted = await persistQuarantine({
            inboxRole: "unknown",
            fromAddr: msg.from ?? "unknown",
            toAddress: "unknown",
            subject: msg.subject ?? "(no subject)",
            bodyText: msg.text ?? null,
            providerMessageId: msg.message_id ?? null,
            providerInboxId: null,
            providerEventId: event.event_id ?? null,
            reason: "missing_inbox_id",
          });
          if (!persisted) {
            await finishWebhookDelivery(svixId, false, "quarantine_persistence_failed");
            return res.status(503).json({ error: "Quarantine persistence failed — retry later" });
          }
          await finishWebhookDelivery(svixId, true);
          return res.json({ received: true, routed: false, reason: "missing_inbox_id" });
        }

        // to is an ARRAY of RFC 2822 address strings (verified from docs)
        const toList: string[] = Array.isArray(msg.to) ? msg.to : msg.to ? [msg.to] : [];
        const toAddress: string = toList[0] ?? "";
        const inboxRole = toAddress.split("@")[0]?.split("-")[0]?.toLowerCase() ?? "unknown";

        const providerMessageId: string | null = msg.message_id ?? null;
        const providerThreadId:  string | null = msg.thread_id  ?? null;
        const providerEventId:   string | null = event.event_id ?? null;

        // ── Tenant resolution — provider inbox_id is the ONLY routing key ──
        const resolveResult = await resolveOrgByProviderInboxId(providerInboxId, toAddress).catch(() => ({
          orgId: null as string | null,
          role: null as AgentMailRole | null,
          reason: "no_ownership_record",
        }));

        if (!resolveResult.orgId) {
          const routingReason = resolveResult.reason;
          console.warn(`[AgentMail] Quarantine (${routingReason}) inbox=${providerInboxId} to=${toAddress}`);

          // ── Quarantine fail-safe ──────────────────────────────────────────
          // Must durably persist — return 503 if it fails so provider retries.
          const persisted = await persistQuarantine({
            inboxRole,
            fromAddr: msg.from ?? "unknown",
            toAddress: toAddress || "unknown",
            subject: msg.subject ?? "(no subject)",
            bodyText: msg.text ?? null,
            providerMessageId,
            providerInboxId,
            providerEventId,
            reason: routingReason,
          });
          if (!persisted) {
            await finishWebhookDelivery(svixId, false, "quarantine_persistence_failed");
            return res.status(503).json({ error: "Quarantine persistence failed — retry later" });
          }
          await finishWebhookDelivery(svixId, true);
          return res.json({ received: true, routed: false, reason: routingReason });
        }

        const organizationId = resolveResult.orgId;
        const resolvedRole = resolveResult.role ?? inboxRole;

        const processResult = await processInboundAgentMail({
          organizationId,
          inbox: resolvedRole,
          fromEmail: msg.from ?? "unknown",
          fromName: undefined,
          toEmail: toAddress,
          subject: msg.subject ?? "(no subject)",
          bodyText: msg.text ?? undefined,
          bodyHtml: msg.html ?? undefined,
          providerMessageId: providerMessageId ?? undefined,
          providerInboxId: providerInboxId ?? undefined,
          providerThreadId: providerThreadId ?? undefined,
          providerEventId: providerEventId ?? undefined,
          receivedAt: msg.timestamp ? new Date(msg.timestamp) : new Date(),
        });

        console.log("[AgentMail] Inbound processed:", processResult.classification, processResult.routedAgent);
        await finishWebhookDelivery(svixId, processResult.ok, processResult.error);
        if (!processResult.ok) return res.status(503).json({ received: true, routed: false, ...processResult });
        return res.json({ received: true, routed: true, ...processResult });
      }

      await finishWebhookDelivery(svixId, true);
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
      const orgId = await getOrgId(req);
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
      const orgId = await getOrgId(req);
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

  // ─── Per-org Inbox Ownership — Provisioning & Lifecycle Routes ───────────

  // GET /api/agentmail/ownership — list inboxes for the authenticated org
  app.get("/api/agentmail/ownership", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const inboxes = await listOrgInboxes(orgId);
      res.json({ ok: true, orgId, inboxes });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /api/agentmail/ownership/provision — provision per-org inboxes at provider + DB
  // ADMIN-only: mutates provider state and ownership rows.
  app.post("/api/agentmail/ownership/provision", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const roles: AgentMailRole[] | undefined = req.body?.roles;
      const result = await provisionOwnership(orgId, roles);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /api/agentmail/ownership/activate — activate provisioned inboxes (gated on provider verification)
  // ADMIN-only: mutates ownership_state.
  app.post("/api/agentmail/ownership/activate", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const roles: AgentMailRole[] | undefined = req.body?.roles;
      const result = await activateOwnership(orgId, roles);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /api/agentmail/ownership/verify — check provider + DB state alignment
  app.post("/api/agentmail/ownership/verify", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const result = await verifyOrgInboxProvisioning(orgId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /api/agentmail/ownership/disable/:role — soft-disable one role inbox
  // ADMIN-only: mutates ownership_state.
  app.post("/api/agentmail/ownership/disable/:role", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const role = req.params.role as AgentMailRole;
      const reason: string | undefined = req.body?.reason;
      const result = await disableOwnership(orgId, role, reason);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /api/agentmail/ownership/retire/:role — permanently retire one role inbox
  // ADMIN-only: irreversible lifecycle change.
  app.post("/api/agentmail/ownership/retire/:role", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const role = req.params.role as AgentMailRole;
      const result = await retireOwnership(orgId, role);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /api/agentmail/ownership/retire-all — retire all inboxes for the org
  // ADMIN-only: irreversible, org-wide lifecycle change.
  app.post("/api/agentmail/ownership/retire-all", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const result = await retireAllOwnership(orgId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });
}
