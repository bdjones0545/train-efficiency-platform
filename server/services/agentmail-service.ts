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
 * For per-org inboxes pass the full org-specific username (e.g. "revenue-fef2c242...").
 *
 * @param localPart  The username portion (before @domain).
 * @param clientId   Optional client_id for provider-level idempotent creation.
 *                   If the inbox already exists at the provider with this client_id,
 *                   the provider returns the existing one instead of creating a duplicate.
 *                   Use "te-{orgId}-{role}" as the client_id for per-org inboxes.
 */
export async function createOrVerifyInbox(
  localPart: string,
  clientId?: string,
): Promise<{
  ok: boolean;
  inbox?: unknown;
  created?: boolean;
  error?: string;
}> {
  const c = getConfig();
  const domain = c.orgDomain || "agentmail.to";

  const checkRes = await agentMailRequest("GET", `/inboxes/${localPart}@${domain}`);
  if (checkRes.ok) return { ok: true, inbox: checkRes.data, created: false };

  const createBody: Record<string, string> = { username: localPart, domain };
  // client_id makes creation idempotent at the provider — retries return the
  // existing inbox rather than creating a second one (verified from AgentMail docs).
  if (clientId) createBody.client_id = clientId;

  const createRes = await agentMailRequest("POST", "/inboxes", createBody);
  if (createRes.ok) return { ok: true, inbox: createRes.data, created: true };
  return { ok: false, error: createRes.error ?? `HTTP ${createRes.status}` };
}

/**
 * Verify that an inbox exists at the AgentMail provider.
 * Returns the provider inbox_id and email if the inbox is found, for cross-corroboration.
 * Used by ownership verification; does not create the inbox.
 */
export async function verifyInboxExists(emailAddress: string): Promise<{
  exists: boolean;
  inboxId?: string;  // provider's inbox_id — verified field name from docs
  email?: string;
}> {
  const res = await agentMailRequest("GET", `/inboxes/${emailAddress}`);
  if (!res.ok) return { exists: false };
  const data = res.data as any;
  return {
    exists: true,
    inboxId: data?.inbox_id ?? undefined,  // verified: AgentMail returns inbox_id not id
    email: data?.email ?? undefined,
  };
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
 *
 * Provider API: POST /v0/inboxes/{inbox_id}/messages/send
 * Uses persisted provider_inbox_id — not the email address — as the resource identity.
 * "to" is an array per the AgentMail API contract.
 *
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
  // ── 1. Ownership check — must run before the send guard so a non-provisioned
  //       org fails closed immediately rather than hitting policy evaluation.
  const { getActiveOwnershipRow } = await import("./agentmail-ownership-service");
  const ownership = await getActiveOwnershipRow(params.organizationId, params.fromInbox);
  if (!ownership) {
    const errMsg =
      `AgentMail outbound blocked: no active inbox ownership for ` +
      `org=${params.organizationId} role=${params.fromInbox}. ` +
      `Provision and activate org inboxes before sending.`;
    console.error(`[AgentMail] ${errMsg}`);
    await logAgentMailMessage({
      organizationId: params.organizationId,
      agentName: params.agentName,
      inbox: params.fromInbox,
      toEmail: params.to,
      subject: params.subject,
      status: "failed",
      errorMessage: errMsg,
    });
    return { ok: false, error: "AgentMail inbox not provisioned for this organization", blocked: true };
  }

  const { emailAddress: fromEmail, providerInboxId } = ownership;

  // ── 2. Send guard policy check
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

  // ── 3. Call provider: POST /v0/inboxes/{inbox_id}/messages/send ───────────
  // "to" is an array per the verified AgentMail API contract.
  const res = await agentMailRequest(
    "POST",
    `/inboxes/${providerInboxId}/messages/send`,
    {
      to: [params.to],
      subject: params.subject,
      text: params.body,
      from: fromEmail,
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    },
  );

  const messageId = res.ok
    ? ((res.data as any)?.id ?? (res.data as any)?.message_id ?? undefined)
    : undefined;

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
    errorMessage: res.ok ? undefined : (res.error ?? `HTTP ${res.status}`),
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
 *
 * Provider API: POST /v0/inboxes/{inbox_id}/messages/{message_id}/reply
 * Uses persisted provider_inbox_id as the inbox resource identity.
 * replyToMessageId is the provider message_id of the message being replied to.
 *
 * humanApproved=true skips the autonomous-send policy check (use when a human
 * has already approved the draft). Emergency pause always blocks regardless.
 */
export async function replyFromAgentInbox(params: {
  organizationId: string;
  agentName: string;
  fromInbox: AgentInbox;
  /** Provider message_id of the message being replied to. */
  replyToMessageId: string;
  /** Legacy thread_id (kept for backward compat; used for audit log). */
  threadId?: string;
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
  // ── 1. Ownership check
  const { getActiveOwnershipRow } = await import("./agentmail-ownership-service");
  const ownership = await getActiveOwnershipRow(params.organizationId, params.fromInbox);
  if (!ownership) {
    const errMsg =
      `AgentMail reply blocked: no active inbox ownership for ` +
      `org=${params.organizationId} role=${params.fromInbox}. ` +
      `Provision and activate org inboxes before sending.`;
    console.error(`[AgentMail] ${errMsg}`);
    await logAgentMailMessage({
      organizationId: params.organizationId,
      agentName: params.agentName,
      inbox: params.fromInbox,
      toEmail: params.to,
      subject: params.subject,
      status: "failed",
      errorMessage: errMsg,
    });
    return { ok: false, error: "AgentMail inbox not provisioned for this organization", blocked: true };
  }

  const { emailAddress: fromEmail, providerInboxId } = ownership;
  const legacyThreadId = params.threadId ?? params.replyToMessageId;

  // ── 2. Send guard policy check
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
    gmailThreadId: params.gmailThreadId ?? legacyThreadId,
  });

  if (!guardResult.allowed) {
    console.warn(
      `[AgentMail] Reply blocked by policy (${guardResult.policyDecision}) for org=${params.organizationId} to=${params.to}: ${guardResult.reason}`,
    );
    return { ok: false, error: guardResult.reason, blocked: true };
  }

  // ── 3. Call provider ───────────────────────────────────────────────────────
  const res = await agentMailRequest(
    "POST",
    `/inboxes/${providerInboxId}/messages/${params.replyToMessageId}/reply`,
    { text: params.body },
  );

  const messageId = res.ok
    ? ((res.data as any)?.id ?? (res.data as any)?.message_id ?? undefined)
    : undefined;

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
    errorMessage: res.ok ? undefined : (res.error ?? `HTTP ${res.status}`),
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
      gmailThreadId: params.gmailThreadId ?? legacyThreadId,
    }).catch(() => {});
  }

  if (!res.ok) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  return { ok: true, messageId };
}

/**
 * Handle inbound webhook from AgentMail.
 *
 * Authentication — verified from AgentMail documentation:
 *   AgentMail uses custom delivery headers for webhook endpoint authentication.
 *   When creating the webhook, configure a secret as a custom Authorization header:
 *     client.webhooks.create({ headers: { "Authorization": "Bearer <AGENTMAIL_WEBHOOK_SECRET>" } })
 *   AgentMail will include this header on every delivery. We validate it here.
 *
 * Production invariants:
 *   - AGENTMAIL_WEBHOOK_SECRET set + header absent or wrong → reject (401)
 *   - AGENTMAIL_WEBHOOK_SECRET not set → warn + allow (development only)
 *   - No configuration path where an unsigned production webhook silently succeeds
 *     (the secret must be explicitly absent for the bypass to occur)
 *
 * We do NOT reconstruct or HMAC the body — authentication is header-only per the
 * documented provider mechanism.  The body is the already-parsed req.body object
 * passed in by the caller (never re-serialized via JSON.stringify).
 *
 * @param _body     Ignored — the webhook route now uses Svix header verification.
 * @param _headers  Ignored — use verifyAgentMailWebhook from agentmail-svix.ts.
 * @deprecated Use verifyAgentMailWebhook from agentmail-svix.ts with req.rawBody.
 */
export async function handleAgentMailWebhook(
  _body: unknown,
  _headers: Record<string, string | string[] | undefined>,
): Promise<{ ok: boolean; event?: unknown; error?: string }> {
  console.error(
    "[AgentMail] handleAgentMailWebhook() is deprecated. " +
    "The webhook route must call verifyAgentMailWebhook() from agentmail-svix.ts " +
    "with req.rawBody (Buffer) for Svix signature verification.",
  );
  return { ok: false, error: "Deprecated — use Svix verification path in agentmail-routes.ts" };
}
