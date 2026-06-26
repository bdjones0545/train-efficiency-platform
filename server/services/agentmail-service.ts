/**
 * AgentMail Service
 * Provides dedicated agent inbox management for outbound/inbound email
 * via the AgentMail API. All functions degrade gracefully if credentials
 * are not configured — they never crash the rest of the agent system.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { checkAgentMailSendPolicy } from "./agentmail-send-guard";
import { writeOutboundAuditLog } from "./outbound-audit-log";

// ─── Config ────────────────────────────────────────────────────────────────

function getConfig() {
  return {
    apiKey: process.env.AGENTMAIL_API_KEY ?? "",
    baseUrl: (process.env.AGENTMAIL_BASE_URL ?? "https://api.agentmail.to/v0").replace(/\/$/, ""),
    defaultFrom: process.env.AGENTMAIL_DEFAULT_FROM ?? "",
    webhookSecret: process.env.AGENTMAIL_WEBHOOK_SECRET ?? "",
    orgDomain: process.env.AGENTMAIL_ORG_DOMAIN ?? "",
  };
}

export function isAgentMailConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.apiKey && c.baseUrl);
}

// ─── Agent inbox definitions ────────────────────────────────────────────────

export const AGENT_INBOXES = [
  { agent: "Revenue Agent",          inbox: "revenue",    description: "Outbound revenue, deals, and upsell communications" },
  { agent: "Hiring Agent",           inbox: "hiring",     description: "Employment outreach and candidate communications" },
  { agent: "Scheduling Agent",       inbox: "scheduling", description: "Session scheduling and booking confirmations" },
  { agent: "Support Agent",          inbox: "support",    description: "Client success and support responses" },
  { agent: "Operations Agent",       inbox: "operations", description: "Internal operations and vendor communications" },
  { agent: "CEO Heartbeat",          inbox: "ceo",        description: "Executive summaries and strategic outbound" },
] as const;

export type AgentInbox = typeof AGENT_INBOXES[number]["inbox"];

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function agentMailRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const c = getConfig();
  if (!c.apiKey) {
    return { ok: false, status: 503, data: null, error: "AgentMail not configured. Add AGENTMAIL_API_KEY to Replit Secrets." };
  }

  const AGENTMAIL_FETCH_TIMEOUT_MS = 15_000;
  try {
    const res = await fetch(`${c.baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(AGENTMAIL_FETCH_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${c.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }

    return { ok: res.ok, status: res.status, data };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, error: err?.message ?? "Network error contacting AgentMail" };
  }
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

// ─── Audit logging ───────────────────────────────────────────────────────────

export interface AgentMailAuditRecord {
  organizationId: string;
  agentName: string;
  inbox: string;
  toEmail: string;
  fromEmail?: string;
  subject: string;
  bodyPreview?: string;
  providerMessageId?: string;
  status: "sent" | "failed" | "queued";
  errorMessage?: string;
}

export async function logAgentMailMessage(record: AgentMailAuditRecord): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO agent_mail_messages (
        id, organization_id, agent_name, inbox, to_email, from_email,
        subject, body_preview, provider_message_id, status, error_message,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid()::text,
        ${record.organizationId},
        ${record.agentName},
        ${record.inbox},
        ${record.toEmail},
        ${record.fromEmail ?? null},
        ${record.subject},
        ${record.bodyPreview ?? null},
        ${record.providerMessageId ?? null},
        ${record.status},
        ${record.errorMessage ?? null},
        NOW(), NOW()
      )
    `);
  } catch (e: any) {
    console.error("[AgentMail] Failed to log message:", e?.message);
  }
}

// ─── Core Service Functions ──────────────────────────────────────────────────

/**
 * Verify the AgentMail connection is working.
 */
export async function verifyAgentMailConnection(): Promise<{
  configured: boolean;
  connected: boolean;
  message: string;
  details?: unknown;
}> {
  if (!isAgentMailConfigured()) {
    return {
      configured: false,
      connected: false,
      message: "AgentMail not configured. Add AGENTMAIL_API_KEY to Replit Secrets.",
    };
  }

  const res = await agentMailRequest("GET", "/inboxes");
  if (res.ok) {
    return { configured: true, connected: true, message: "AgentMail connected successfully.", details: res.data };
  }
  return {
    configured: true,
    connected: false,
    message: `AgentMail connection failed: ${res.error ?? `HTTP ${res.status}`}`,
    details: res.data,
  };
}

/**
 * List all inboxes from the AgentMail account.
 */
export async function listInboxes(): Promise<{
  ok: boolean;
  inboxes: unknown[];
  error?: string;
}> {
  const res = await agentMailRequest("GET", "/inboxes");
  if (!res.ok) return { ok: false, inboxes: [], error: res.error ?? `HTTP ${res.status}` };
  const data = res.data as any;
  const inboxList: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.inboxes) ? data.inboxes : [];
  return { ok: true, inboxes: inboxList };
}

/**
 * Create or verify an inbox exists for a given local-part (e.g. "revenue").
 */
export async function createOrVerifyInbox(localPart: string): Promise<{
  ok: boolean;
  inbox?: unknown;
  created?: boolean;
  error?: string;
}> {
  const c = getConfig();
  const domain = c.orgDomain || "agentmail.to";

  const checkRes = await agentMailRequest("GET", `/inboxes/${localPart}@${domain}`);
  if (checkRes.ok) return { ok: true, inbox: checkRes.data, created: false };

  const createRes = await agentMailRequest("POST", "/inboxes", {
    username: localPart,
    domain,
  });

  if (createRes.ok) return { ok: true, inbox: createRes.data, created: true };
  return { ok: false, error: createRes.error ?? `HTTP ${createRes.status}` };
}

/**
 * Get messages from a specific inbox.
 */
export async function getInboxMessages(inboxAddress: string, limit = 20): Promise<{
  ok: boolean;
  messages: unknown[];
  error?: string;
}> {
  const res = await agentMailRequest("GET", `/inboxes/${inboxAddress}/threads?limit=${limit}`);
  if (!res.ok) return { ok: false, messages: [], error: res.error ?? `HTTP ${res.status}` };
  const data = res.data as any;
  const msgs: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.threads) ? data.threads : Array.isArray(data?.messages) ? data.messages : [];
  return { ok: true, messages: msgs };
}

/**
 * Send an email from a specific agent inbox.
 * humanApproved=true skips the autonomous-send policy check (use when a human
 * has already approved the draft). Emergency pause always blocks regardless.
 */
export async function sendAgentEmail(params: {
  organizationId: string;
  agentName: string;
  fromInbox: AgentInbox;
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  humanApproved?: boolean;
  actionQueueId?: string;
  gmailThreadId?: string;
}): Promise<{
  ok: boolean;
  messageId?: string;
  error?: string;
  blocked?: boolean;
}> {
  const guardResult = await checkAgentMailSendPolicy({
    orgId: params.organizationId,
    agentName: params.agentName,
    fromInbox: params.fromInbox,
    toEmail: params.to,
    subject: params.subject,
    bodyPreview: params.body.slice(0, 200),
    humanApproved: params.humanApproved,
    sourceSystem: params.agentName,
    actionQueueId: params.actionQueueId,
    gmailThreadId: params.gmailThreadId,
  });

  if (!guardResult.allowed) {
    console.warn(
      `[AgentMail] Send blocked by policy (${guardResult.policyDecision}) for org=${params.organizationId} to=${params.to}: ${guardResult.reason}`,
    );
    return { ok: false, error: guardResult.reason, blocked: true };
  }

  const c = getConfig();
  const domain = c.orgDomain || "agentmail.to";
  const fromEmail = `${params.fromInbox}@${domain}`;

  const payload = {
    from: fromEmail,
    to: params.to,
    subject: params.subject,
    text: params.body,
    reply_to: params.replyTo,
  };

  // NOTE: AgentMail v0 REST API is inbound-only. POST /inboxes/{email}/emails returns 404.
  // All confirmed endpoints: GET /inboxes, GET /inboxes/{email}, GET /inboxes/{email}/threads.
  // Outbound send requires SMTP credentials or a future API version.
  const res = await agentMailRequest("POST", `/inboxes/${fromEmail}/emails`, payload);

  if (!res.ok && (res.data as any)?.message === "Route not found") {
    console.warn(`[AgentMail] sendAgentEmail: outbound send not available in AgentMail v0 REST API. ` +
      `from=${fromEmail} to=${params.to} — AgentMail is inbound-only; use Gmail agent for outbound.`);
  }

  const messageId = res.ok ? ((res.data as any)?.id ?? (res.data as any)?.messageId ?? undefined) : undefined;

  await logAgentMailMessage({
    organizationId: params.organizationId,
    agentName: params.agentName,
    inbox: params.fromInbox,
    toEmail: params.to,
    fromEmail,
    subject: params.subject,
    bodyPreview: params.body.slice(0, 300),
    providerMessageId: messageId,
    status: res.ok ? "sent" : "failed",
    errorMessage: res.ok ? undefined : (res.error ?? `AgentMail outbound not available (HTTP ${res.status})`),
  });

  if (res.ok) {
    await writeOutboundAuditLog({
      orgId: params.organizationId,
      channel: "agentmail",
      sourceSystem: params.agentName,
      recipientEmail: params.to,
      subject: params.subject,
      emailType: "agentmail_outbound",
      triggeredBy: params.agentName,
      autoSent: !params.humanApproved,
      approvalRequired: !params.humanApproved,
      approvalStatus: params.humanApproved ? "approved" : "n/a",
      policyDecision: "allow",
      status: "sent",
      providerMessageId: messageId,
      sentAt: new Date(),
      actionQueueId: params.actionQueueId,
      gmailThreadId: params.gmailThreadId,
    }).catch(() => {});
  }

  if (!res.ok) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  return { ok: true, messageId };
}

/**
 * Reply from an agent inbox to an existing email thread.
 * humanApproved=true skips the autonomous-send policy check (use when a human
 * has already approved the draft). Emergency pause always blocks regardless.
 */
export async function replyFromAgentInbox(params: {
  organizationId: string;
  agentName: string;
  fromInbox: AgentInbox;
  threadId: string;
  to: string;
  subject: string;
  body: string;
  humanApproved?: boolean;
  actionQueueId?: string;
  gmailThreadId?: string;
}): Promise<{
  ok: boolean;
  messageId?: string;
  error?: string;
  blocked?: boolean;
}> {
  const guardResult = await checkAgentMailSendPolicy({
    orgId: params.organizationId,
    agentName: params.agentName,
    fromInbox: params.fromInbox,
    toEmail: params.to,
    subject: params.subject,
    bodyPreview: params.body.slice(0, 200),
    humanApproved: params.humanApproved,
    sourceSystem: params.agentName,
    actionQueueId: params.actionQueueId,
    gmailThreadId: params.gmailThreadId ?? params.threadId,
  });

  if (!guardResult.allowed) {
    console.warn(
      `[AgentMail] Reply blocked by policy (${guardResult.policyDecision}) for org=${params.organizationId} to=${params.to}: ${guardResult.reason}`,
    );
    return { ok: false, error: guardResult.reason, blocked: true };
  }

  const c = getConfig();
  const domain = c.orgDomain || "agentmail.to";
  const fromEmail = `${params.fromInbox}@${domain}`;

  const payload = {
    from: fromEmail,
    to: params.to,
    subject: params.subject,
    text: params.body,
    thread_id: params.threadId,
  };

  // NOTE: AgentMail v0 REST API is inbound-only. POST /inboxes/{email}/emails returns 404.
  // Outbound replies require SMTP credentials or a future API version.
  const res = await agentMailRequest("POST", `/inboxes/${fromEmail}/emails`, payload);

  if (!res.ok && (res.data as any)?.message === "Route not found") {
    console.warn(`[AgentMail] replyFromAgentInbox: outbound send not available in AgentMail v0 REST API. ` +
      `from=${fromEmail} to=${params.to} thread=${params.threadId} — use Gmail agent for outbound.`);
  }

  const messageId = res.ok ? ((res.data as any)?.id ?? (res.data as any)?.messageId ?? undefined) : undefined;

  await logAgentMailMessage({
    organizationId: params.organizationId,
    agentName: params.agentName,
    inbox: params.fromInbox,
    toEmail: params.to,
    fromEmail,
    subject: params.subject,
    bodyPreview: params.body.slice(0, 300),
    providerMessageId: messageId,
    status: res.ok ? "sent" : "failed",
    errorMessage: res.ok ? undefined : (res.error ?? `AgentMail outbound not available (HTTP ${res.status})`),
  });

  if (res.ok) {
    await writeOutboundAuditLog({
      orgId: params.organizationId,
      channel: "agentmail",
      sourceSystem: params.agentName,
      recipientEmail: params.to,
      subject: params.subject,
      emailType: "agentmail_reply",
      triggeredBy: params.agentName,
      autoSent: !params.humanApproved,
      approvalRequired: !params.humanApproved,
      approvalStatus: params.humanApproved ? "approved" : "n/a",
      policyDecision: "allow",
      status: "sent",
      providerMessageId: messageId,
      sentAt: new Date(),
      actionQueueId: params.actionQueueId,
      gmailThreadId: params.gmailThreadId ?? params.threadId,
    }).catch(() => {});
  }

  if (!res.ok) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  return { ok: true, messageId };
}

/**
 * Handle inbound webhook from AgentMail.
 * Verifies the secret if configured, then returns the parsed payload.
 */
export async function handleAgentMailWebhook(
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<{ ok: boolean; event?: unknown; error?: string }> {
  const c = getConfig();

  if (c.webhookSecret) {
    // Secret is configured — every request MUST carry a valid signature.
    // Unsigned requests are rejected to prevent spoofed inbound email injection.
    if (!signatureHeader) {
      console.warn("[AgentMail] Webhook rejected: signature header missing (AGENTMAIL_WEBHOOK_SECRET is set)");
      return { ok: false, error: "Webhook signature required but not provided" };
    }

    const crypto = await import("crypto");

    // AgentMail uses Stripe-style whsec_ prefix: strip it and base64-decode to get the raw HMAC key.
    // Fall back to using the raw string if the prefix is absent (legacy format).
    let hmacKey: string | Buffer = c.webhookSecret;
    if (c.webhookSecret.startsWith("whsec_")) {
      hmacKey = Buffer.from(c.webhookSecret.slice(6), "base64");
    }

    const expected = crypto
      .createHmac("sha256", hmacKey)
      .update(rawBody)
      .digest("hex");
    const provided = signatureHeader.replace(/^sha256=/, "");
    if (expected !== provided) {
      console.warn("[AgentMail] Webhook rejected: signature mismatch");
      return { ok: false, error: "Webhook signature mismatch" };
    }
  }

  try {
    const event = JSON.parse(rawBody);
    return { ok: true, event };
  } catch {
    return { ok: false, error: "Invalid JSON in webhook body" };
  }
}
