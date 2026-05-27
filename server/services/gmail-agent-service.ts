/**
 * Gmail Agent Service
 * Provides authenticated Gmail API access for the TrainEfficiency agent.
 * Credentials are loaded from the org's external_integrations row,
 * decrypted via credentials-vault, and never exposed outside this module.
 */

import { getIntegration } from "../integration-runtime";
import { decryptCredentials, encryptCredentials } from "../credentials-vault";
import { db } from "../db";
import { gmailConversations, gmailAgentActions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import OpenAI from "openai";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GmailMessageMeta = {
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  snippet: string;
  date: string;
  isUnread: boolean;
};

export type GmailThreadMessage = {
  messageId: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  snippet: string;
  bodyPlainText: string;
};

export type ReplyIntent =
  | "interested"
  | "wants_more_info"
  | "wants_schedule"
  | "objection"
  | "not_interested"
  | "wrong_person"
  | "unsubscribe"
  | "spam"
  | "unknown";

export type ClassifiedReply = {
  threadId: string;
  messageId: string;
  senderEmail: string;
  senderName: string;
  snippet: string;
  date: string;
  intent: ReplyIntent;
  schedulingSignals: string[];
  questions: string[];
  objections: string[];
  preferredTimes: string[];
  urgency: "low" | "medium" | "high";
  rawText: string;
};

// ─── Auth Initializer ─────────────────────────────────────────────────────────

export async function getGmailClient(orgId: string) {
  const integration = await getIntegration(orgId, "gmail");
  if (!integration || integration.status !== "connected") {
    throw new Error(`Gmail not connected for org ${orgId}`);
  }

  const creds = decryptCredentials(integration.encryptedCredentials as any);
  if (!creds?.clientId || !creds?.clientSecret || !creds?.refreshToken) {
    throw new Error(`Gmail credentials incomplete for org ${orgId} — re-connect OAuth`);
  }

  const { google } = await import("googleapis");
  const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  oauth2Client.setCredentials({
    access_token: creds.accessToken || undefined,
    refresh_token: creds.refreshToken,
    expiry_date: creds.tokenExpiry ? Number(creds.tokenExpiry) : undefined,
  });

  // Auto-refresh: persist updated tokens back to DB
  oauth2Client.on("tokens", async (tokens) => {
    try {
      const fresh = decryptCredentials(
        (await getIntegration(orgId, "gmail"))?.encryptedCredentials as any
      ) ?? {};
      const merged: Record<string, string> = {
        ...fresh,
        accessToken: tokens.access_token ?? fresh.accessToken ?? "",
        tokenExpiry: tokens.expiry_date ? String(tokens.expiry_date) : fresh.tokenExpiry ?? "",
      };
      if (tokens.refresh_token) merged.refreshToken = tokens.refresh_token;
      const { upsertIntegration } = await import("../integration-runtime");
      await upsertIntegration(orgId, "gmail", {
        encryptedCredentials: encryptCredentials(merged) as any,
        lastSuccessfulActionAt: new Date(),
      });
    } catch (e) {
      console.error("[gmail-agent-service] token refresh persist error:", e);
    }
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const senderEmail = creds.accountEmail ?? "unknown";
  return { gmail, senderEmail };
}

// ─── Utility Helpers ──────────────────────────────────────────────────────────

function decodeBase64Url(encoded: string): string {
  return Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function encodeBase64Url(str: string): string {
  return Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function extractHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractBodyText(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return stripHtml(decodeBase64Url(part.body.data));
      }
      if (part.parts) {
        const nested = extractBodyText(part);
        if (nested) return nested;
      }
    }
  }
  return "";
}

function buildMimeMessage(opts: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    "",
    opts.body,
  ];
  return encodeBase64Url(lines.join("\r\n"));
}

// ─── Tool: Send Email ─────────────────────────────────────────────────────────

export async function gmailSendEmail(opts: {
  orgId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyToThreadId?: string;
  leadId?: string;
  dealId?: string;
}): Promise<{ messageId: string; threadId: string }> {
  const { gmail, senderEmail } = await getGmailClient(opts.orgId);

  let inReplyTo: string | undefined;
  let references: string | undefined;

  if (opts.replyToThreadId) {
    const thread = await gmail.users.threads.get({ userId: "me", id: opts.replyToThreadId });
    const messages = thread.data.messages ?? [];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.payload?.headers) {
      inReplyTo = extractHeader(lastMsg.payload.headers, "Message-ID");
      references = messages
        .map((m: any) => extractHeader(m.payload?.headers ?? [], "Message-ID"))
        .filter(Boolean)
        .join(" ");
    }
  }

  const raw = buildMimeMessage({
    from: senderEmail,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    body: opts.body,
    inReplyTo,
    references,
  });

  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      ...(opts.replyToThreadId ? { threadId: opts.replyToThreadId } : {}),
    },
  });

  const messageId = result.data.id ?? "";
  const threadId = result.data.threadId ?? "";

  await logGmailAction(opts.orgId, {
    actionType: "send_email",
    gmailThreadId: threadId,
    gmailMessageId: messageId,
    leadId: opts.leadId,
    dealId: opts.dealId,
    recipientEmail: opts.to,
    subject: opts.subject,
    riskLevel: "medium",
    approvalRequired: false,
    status: "executed",
    createdByAgent: "gmail_agent",
    executedAt: new Date(),
  });

  console.log(`[gmail-agent] send_email → to=${opts.to} threadId=${threadId} messageId=${messageId}`);
  return { messageId, threadId };
}

// ─── Tool: Create Draft ───────────────────────────────────────────────────────

export async function gmailCreateDraft(opts: {
  orgId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyToThreadId?: string;
  leadId?: string;
  dealId?: string;
}): Promise<{ draftId: string; messageId: string; threadId: string }> {
  const { gmail, senderEmail } = await getGmailClient(opts.orgId);

  let inReplyTo: string | undefined;
  let references: string | undefined;

  if (opts.replyToThreadId) {
    const thread = await gmail.users.threads.get({ userId: "me", id: opts.replyToThreadId });
    const messages = thread.data.messages ?? [];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.payload?.headers) {
      inReplyTo = extractHeader(lastMsg.payload.headers, "Message-ID");
      references = messages
        .map((m: any) => extractHeader(m.payload?.headers ?? [], "Message-ID"))
        .filter(Boolean)
        .join(" ");
    }
  }

  const raw = buildMimeMessage({
    from: senderEmail,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    body: opts.body,
    inReplyTo,
    references,
  });

  const result = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw,
        ...(opts.replyToThreadId ? { threadId: opts.replyToThreadId } : {}),
      },
    },
  });

  const draftId = result.data.id ?? "";
  const messageId = result.data.message?.id ?? "";
  const threadId = result.data.message?.threadId ?? "";

  await logGmailAction(opts.orgId, {
    actionType: "create_draft",
    gmailThreadId: threadId,
    gmailMessageId: messageId,
    leadId: opts.leadId,
    dealId: opts.dealId,
    recipientEmail: opts.to,
    subject: opts.subject,
    riskLevel: "low",
    approvalRequired: true,
    status: "awaiting_approval",
    createdByAgent: "gmail_agent",
  });

  console.log(`[gmail-agent] create_draft → to=${opts.to} draftId=${draftId}`);
  return { draftId, messageId, threadId };
}

// ─── Tool: Search Inbox ───────────────────────────────────────────────────────

export async function gmailSearchInbox(opts: {
  orgId: string;
  query: string;
  maxResults?: number;
}): Promise<GmailMessageMeta[]> {
  const { gmail } = await getGmailClient(opts.orgId);
  const list = await gmail.users.messages.list({
    userId: "me",
    q: opts.query,
    maxResults: opts.maxResults ?? 20,
  });

  const messages = list.data.messages ?? [];
  const results: GmailMessageMeta[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;
    const full = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
    const headers = full.data.payload?.headers ?? [];
    results.push({
      messageId: full.data.id ?? "",
      threadId: full.data.threadId ?? "",
      subject: extractHeader(headers, "Subject"),
      sender: extractHeader(headers, "From"),
      snippet: full.data.snippet ?? "",
      date: extractHeader(headers, "Date"),
      isUnread: (full.data.labelIds ?? []).includes("UNREAD"),
    });
  }

  console.log(`[gmail-agent] search_inbox → query="${opts.query}" found=${results.length}`);
  return results;
}

// ─── Tool: Read Thread ────────────────────────────────────────────────────────

export async function gmailReadThread(opts: {
  orgId: string;
  threadId: string;
}): Promise<GmailThreadMessage[]> {
  const { gmail } = await getGmailClient(opts.orgId);
  const thread = await gmail.users.threads.get({ userId: "me", id: opts.threadId });
  const messages = thread.data.messages ?? [];

  return messages.map((msg: any) => {
    const headers = msg.payload?.headers ?? [];
    return {
      messageId: msg.id ?? "",
      from: extractHeader(headers, "From"),
      to: extractHeader(headers, "To"),
      date: extractHeader(headers, "Date"),
      subject: extractHeader(headers, "Subject"),
      snippet: msg.snippet ?? "",
      bodyPlainText: extractBodyText(msg.payload).slice(0, 4000),
    };
  });
}

// ─── Tool: List Recent Replies ────────────────────────────────────────────────

export async function gmailListRecentReplies(opts: {
  orgId: string;
  maxResults?: number;
  afterDays?: number;
}): Promise<GmailMessageMeta[]> {
  const afterDays = opts.afterDays ?? 14;
  const afterDate = new Date();
  afterDate.setDate(afterDate.getDate() - afterDays);
  const dateStr = `${afterDate.getFullYear()}/${String(afterDate.getMonth() + 1).padStart(2, "0")}/${String(afterDate.getDate()).padStart(2, "0")}`;
  const query = `in:inbox is:unread after:${dateStr}`;

  return gmailSearchInbox({ orgId: opts.orgId, query, maxResults: opts.maxResults ?? 50 });
}

// ─── Tool: Classify Reply ─────────────────────────────────────────────────────

export async function gmailClassifyReply(opts: {
  orgId: string;
  threadId: string;
  messageId?: string;
}): Promise<ClassifiedReply> {
  const messages = await gmailReadThread({ orgId: opts.orgId, threadId: opts.threadId });
  const last = messages[messages.length - 1];
  if (!last) throw new Error(`No messages in thread ${opts.threadId}`);

  const bodyText = last.bodyPlainText || last.snippet;

  let classified: ClassifiedReply = {
    threadId: opts.threadId,
    messageId: last.messageId,
    senderEmail: last.from,
    senderName: last.from.split("<")[0].trim(),
    snippet: last.snippet,
    date: last.date,
    intent: "unknown",
    schedulingSignals: [],
    questions: [],
    objections: [],
    preferredTimes: [],
    urgency: "low",
    rawText: bodyText,
  };

  try {
    const openai = new OpenAI();
    const systemPrompt = `You are a reply classifier for a fitness coaching business outreach system.
Classify the intent of this email reply and extract signals.
Return ONLY valid JSON in this exact shape:
{
  "intent": "interested|wants_more_info|wants_schedule|objection|not_interested|wrong_person|unsubscribe|spam|unknown",
  "schedulingSignals": ["string"],
  "questions": ["string"],
  "objections": ["string"],
  "preferredTimes": ["string"],
  "urgency": "low|medium|high"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Subject: ${last.subject}\n\nBody:\n${bodyText}` },
      ],
      response_format: { type: "json_object" },
      max_tokens: 400,
    });

    const parsed = JSON.parse(response.choices[0].message.content ?? "{}");
    classified = {
      ...classified,
      intent: parsed.intent ?? "unknown",
      schedulingSignals: parsed.schedulingSignals ?? [],
      questions: parsed.questions ?? [],
      objections: parsed.objections ?? [],
      preferredTimes: parsed.preferredTimes ?? [],
      urgency: parsed.urgency ?? "low",
    };
  } catch (e) {
    console.error("[gmail-agent] classify_reply error:", e);
  }

  console.log(`[gmail-agent] classify_reply → threadId=${opts.threadId} intent=${classified.intent}`);
  return classified;
}

// ─── Tool: Track Conversation ─────────────────────────────────────────────────

export async function gmailTrackConversation(opts: {
  orgId: string;
  gmailThreadId: string;
  leadId?: string;
  dealId?: string;
  clientId?: string;
  subject?: string;
  participantEmail?: string;
  participantName?: string;
  status?: string;
  intent?: string;
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
  lastSnippet?: string;
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select()
    .from(gmailConversations)
    .where(and(eq(gmailConversations.orgId, opts.orgId), eq(gmailConversations.gmailThreadId, opts.gmailThreadId)))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(gmailConversations)
      .set({
        leadId: opts.leadId ?? existing[0].leadId,
        dealId: opts.dealId ?? existing[0].dealId,
        clientId: opts.clientId ?? existing[0].clientId,
        subject: opts.subject ?? existing[0].subject,
        participantEmail: opts.participantEmail ?? existing[0].participantEmail,
        participantName: opts.participantName ?? existing[0].participantName,
        status: opts.status ?? existing[0].status,
        intent: opts.intent ?? existing[0].intent,
        lastInboundAt: opts.lastInboundAt ?? existing[0].lastInboundAt,
        lastOutboundAt: opts.lastOutboundAt ?? existing[0].lastOutboundAt,
        lastSnippet: opts.lastSnippet ?? existing[0].lastSnippet,
        updatedAt: new Date(),
      })
      .where(eq(gmailConversations.id, existing[0].id))
      .returning();
    return { id: updated.id, created: false };
  }

  const [created] = await db
    .insert(gmailConversations)
    .values({
      orgId: opts.orgId,
      gmailThreadId: opts.gmailThreadId,
      leadId: opts.leadId,
      dealId: opts.dealId,
      clientId: opts.clientId,
      subject: opts.subject,
      participantEmail: opts.participantEmail,
      participantName: opts.participantName,
      status: opts.status ?? "open",
      intent: opts.intent,
      lastInboundAt: opts.lastInboundAt,
      lastOutboundAt: opts.lastOutboundAt,
      lastSnippet: opts.lastSnippet,
    })
    .returning();

  return { id: created.id, created: true };
}

// ─── Tool: Get Thread by Email ────────────────────────────────────────────────

export async function gmailGetThreadByEmail(opts: {
  orgId: string;
  email: string;
}): Promise<GmailMessageMeta[]> {
  return gmailSearchInbox({
    orgId: opts.orgId,
    query: `from:${opts.email} OR to:${opts.email}`,
    maxResults: 20,
  });
}

// ─── Tool: Mark Thread Processed ─────────────────────────────────────────────

export async function gmailMarkThreadProcessed(opts: {
  orgId: string;
  threadId: string;
  approvedBy?: string;
}): Promise<void> {
  await db
    .update(gmailConversations)
    .set({ processedAt: new Date(), status: "processed", updatedAt: new Date() })
    .where(and(eq(gmailConversations.orgId, opts.orgId), eq(gmailConversations.gmailThreadId, opts.threadId)));

  console.log(`[gmail-agent] mark_thread_processed → threadId=${opts.threadId}`);
}

// ─── Lead Reply Recovery Workflow ─────────────────────────────────────────────
// Syncs recent replies, classifies them, links to leads/deals, queues drafts.

export async function runLeadReplyRecovery(orgId: string): Promise<{
  synced: number;
  classified: number;
  actionsQueued: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let synced = 0;
  let classified = 0;
  let actionsQueued = 0;

  console.log(`[gmail-agent] lead_reply_recovery start — orgId=${orgId}`);

  const replies = await gmailListRecentReplies({ orgId, afterDays: 14, maxResults: 50 });
  synced = replies.length;
  console.log(`[gmail-agent] replies found: ${synced}`);

  for (const reply of replies) {
    try {
      let classification: ClassifiedReply;
      try {
        classification = await gmailClassifyReply({ orgId, threadId: reply.threadId, messageId: reply.messageId });
        classified++;
      } catch (e: any) {
        errors.push(`classify ${reply.threadId}: ${e.message}`);
        continue;
      }

      // Link to lead by email
      const senderEmail = extractEmailAddress(reply.sender);
      let leadId: string | undefined;
      let dealId: string | undefined;

      try {
        const lead = await findLeadByEmail(orgId, senderEmail);
        leadId = lead?.id;
        const deal = await findDealByEmail(orgId, senderEmail);
        dealId = deal?.id;
      } catch (e: any) {
        errors.push(`link ${senderEmail}: ${e.message}`);
      }

      await gmailTrackConversation({
        orgId,
        gmailThreadId: reply.threadId,
        leadId,
        dealId,
        participantEmail: senderEmail,
        participantName: classification.senderName,
        subject: reply.subject,
        intent: classification.intent,
        lastInboundAt: new Date(reply.date),
        lastSnippet: reply.snippet,
        status: "needs_response",
      });

      // Suppress unsubscribe / not-interested
      if (classification.intent === "unsubscribe" || classification.intent === "not_interested") {
        if (leadId) await suppressLeadOutreach(orgId, leadId);
        await gmailMarkThreadProcessed({ orgId, threadId: reply.threadId });
        continue;
      }

      // ── Scheduling Agent Integration ──────────────────────────────────────
      // When scheduling intent is detected, route to the internal scheduling
      // agent which finds slots and queues a personalised draft with real times.
      if (
        classification.intent === "wants_schedule" ||
        (classification.intent === "interested" && classification.schedulingSignals?.length > 0)
      ) {
        try {
          // Look up the lead intelligence profile by sender email
          const { db: _db } = await import("../db");
          const { leadIntelligenceProfiles: _lip } = await import("@shared/schema");
          const { sql: _sql } = await import("drizzle-orm");
          const [intelProfile] = await _db.execute(
            _sql`SELECT id, submission_id FROM lead_intelligence_profiles
                 WHERE org_id = ${orgId}
                   AND normalized_profile_json->>'email' = ${senderEmail}
                 ORDER BY created_at DESC LIMIT 1`
          ) as any;

          if (intelProfile?.submission_id) {
            const { handleSchedulingIntent } = await import("./internal-scheduling-agent-service");
            const schedResult = await handleSchedulingIntent({
              orgId,
              submissionId: intelProfile.submission_id,
              leadId: intelProfile.id,
              intent: classification.intent,
              replyText: reply.snippet,
              preferredTimes: classification.preferredTimes || [],
              gmailThreadId: reply.threadId,
              messageId: reply.messageId,
            });
            if (schedResult.handled) {
              actionsQueued++;
              console.log(`[gmail-agent] scheduling_agent handled thread=${reply.threadId}: ${schedResult.message}`);
              continue; // Scheduling agent took ownership — skip generic draft
            }
          }
        } catch (schedErr: any) {
          console.error(`[gmail-agent] scheduling_agent error: ${schedErr.message}`);
          // Fall through to generic draft
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      // Queue a draft action based on intent
      let draftNote = "";
      if (classification.intent === "wants_schedule") draftNote = "scheduling_response";
      else if (classification.intent === "interested") draftNote = "follow_up";
      else if (classification.intent === "objection") draftNote = "objection_handling";
      else if (classification.intent === "wants_more_info") draftNote = "info_response";

      if (draftNote) {
        await logGmailAction(orgId, {
          actionType: `propose_draft:${draftNote}`,
          gmailThreadId: reply.threadId,
          gmailMessageId: reply.messageId,
          leadId,
          dealId,
          recipientEmail: senderEmail,
          subject: `Re: ${reply.subject}`,
          riskLevel: "low",
          approvalRequired: true,
          status: "proposed",
          createdByAgent: "lead_reply_recovery",
        });
        actionsQueued++;
      }
    } catch (e: any) {
      errors.push(`thread ${reply.threadId}: ${e.message}`);
    }
  }

  console.log(`[gmail-agent] lead_reply_recovery done — synced=${synced} classified=${classified} queued=${actionsQueued} errors=${errors.length}`);
  return { synced, classified, actionsQueued, errors };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function logGmailAction(orgId: string, data: {
  actionType: string;
  gmailThreadId?: string;
  gmailMessageId?: string;
  leadId?: string;
  dealId?: string;
  recipientEmail?: string;
  subject?: string;
  bodyPreview?: string;
  riskLevel?: string;
  approvalRequired?: boolean;
  status?: string;
  result?: any;
  errorMessage?: string;
  createdByAgent?: string;
  approvedBy?: string;
  executedAt?: Date;
}): Promise<void> {
  try {
    await db.insert(gmailAgentActions).values({
      orgId,
      actionType: data.actionType,
      gmailThreadId: data.gmailThreadId,
      gmailMessageId: data.gmailMessageId,
      leadId: data.leadId,
      dealId: data.dealId,
      recipientEmail: data.recipientEmail,
      subject: data.subject,
      bodyPreview: data.bodyPreview,
      riskLevel: data.riskLevel ?? "medium",
      approvalRequired: data.approvalRequired ?? true,
      status: data.status ?? "proposed",
      result: data.result,
      errorMessage: data.errorMessage,
      createdByAgent: data.createdByAgent,
      approvedBy: data.approvedBy,
      executedAt: data.executedAt,
    });
  } catch (e) {
    console.error("[gmail-agent] log action error:", e);
  }
}

function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : from.toLowerCase().trim();
}

async function findLeadByEmail(orgId: string, email: string) {
  try {
    const { teamTrainingProspects } = await import("@shared/schema");
    const rows = await db
      .select()
      .from(teamTrainingProspects)
      .where(and(eq(teamTrainingProspects.orgId, orgId), eq(teamTrainingProspects.contactEmail, email)))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function findDealByEmail(orgId: string, email: string) {
  try {
    const { teamTrainingDeals } = await import("@shared/schema");
    const rows = await db
      .select()
      .from(teamTrainingDeals)
      .where(and(eq((teamTrainingDeals as any).orgId, orgId), eq((teamTrainingDeals as any).contactEmail, email)))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function suppressLeadOutreach(orgId: string, leadId: string) {
  try {
    const { teamTrainingLeads } = await import("@shared/schema");
    await db
      .update(teamTrainingLeads)
      .set({ status: "do_not_contact" } as any)
      .where(and(eq(teamTrainingLeads.id, leadId), eq(teamTrainingLeads.orgId, orgId)));
    console.log(`[gmail-agent] suppressed outreach for leadId=${leadId}`);
  } catch (e) {
    console.error("[gmail-agent] suppress outreach error:", e);
  }
}

// ─── Test Mode Helpers ────────────────────────────────────────────────────────

export const TEST_GMAIL_PAYLOADS = {
  inboundReply: {
    messageId: "test-msg-001",
    threadId: "test-thread-001",
    subject: "Re: Team Training Program for Riverside Youth Soccer",
    sender: "Coach Mike <coachmike@riversideyouth.com>",
    snippet: "This looks great! We would love to schedule a call to learn more about the program.",
    date: new Date().toISOString(),
    isUnread: true,
  } as GmailMessageMeta,
  classifiedReply: {
    threadId: "test-thread-001",
    messageId: "test-msg-001",
    senderEmail: "coachmike@riversideyouth.com",
    senderName: "Coach Mike",
    snippet: "This looks great! We would love to schedule a call to learn more.",
    date: new Date().toISOString(),
    intent: "wants_schedule" as ReplyIntent,
    schedulingSignals: ["schedule a call", "learn more"],
    questions: ["What does the program cost?"],
    objections: [],
    preferredTimes: [],
    urgency: "high" as const,
    rawText: "This looks great! We would love to schedule a call to learn more about the program.",
  } as ClassifiedReply,
};
