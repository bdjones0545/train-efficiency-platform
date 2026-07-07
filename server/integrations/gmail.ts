/**
 * Gmail Integration — Phase 5
 * Agent: Relay (communication_agent)
 *
 * All actions flow through integration-runtime.ts for governance + audit.
 * Credentials stored in external_integrations.encrypted_credentials.
 */

import { executeIntegrationAction, getIntegration, normalizeProviderResponse } from "../integration-runtime";
import { randomUUID } from "crypto";

export interface GmailSendInput {
  orgId: string;
  agentType?: string;
  workflowJobId?: string;
  workflowRunId?: string;
  to: string;
  subject: string;
  body: string; // HTML
  from?: string;
  replyTo?: string;
  threadId?: string; // for replies
  attachments?: Array<{ filename: string; content: string; mimeType: string }>;
}

export interface GmailDraftInput extends GmailSendInput {
  labels?: string[];
}

export interface GmailClassifyInput {
  orgId: string;
  agentType?: string;
  messageId: string;
  subject: string;
  body: string;
  sender: string;
}

export interface GmailClassification {
  intent: "booking_request" | "cancellation" | "negative_sentiment" | "positive_response" | "unsubscribe" | "auto_reply" | "unknown";
  sentiment: "positive" | "neutral" | "negative";
  requiresEscalation: boolean;
  summary: string;
  confidence: number;
}

// ─── Send Email ───────────────────────────────────────────────────────────────

export async function gmailSendEmail(input: GmailSendInput): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const idempotencyKey = `gmail-send-${input.orgId}-${input.to}-${Date.now()}`;

  const result = await executeIntegrationAction(
    {
      orgId: input.orgId,
      integrationType: "gmail",
      actionType: "send_email",
      agentType: input.agentType ?? "communication_agent",
      workflowJobId: input.workflowJobId,
      workflowRunId: input.workflowRunId,
      idempotencyKey,
      inputSummary: `Send email to ${input.to}: "${input.subject}"`,
      payload: { to: input.to, subject: input.subject },
    },
    async () => {
      const integration = await getIntegration(input.orgId, "gmail");
      if (!integration || integration.status !== "connected") {
        throw new Error("Gmail integration not connected");
      }

      // Use credentials from integration
      const creds = integration.encryptedCredentials as any ?? {};
      if (!creds.accessToken && !creds.serviceAccountKey) {
        throw new Error("Gmail credentials not configured");
      }

      // Real Gmail API call via googleapis
      const { google } = await import("googleapis");
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: creds.accessToken, refresh_token: creds.refreshToken });

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      const from = input.from ?? creds.senderEmail ?? "me";

      // Build RFC 2822 MIME message
      const messageParts = [
        `From: ${from}`,
        `To: ${input.to}`,
        `Subject: ${input.subject}`,
        input.replyTo ? `Reply-To: ${input.replyTo}` : "",
        input.threadId ? "" : "",
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=utf-8",
        "",
        input.body,
      ].filter(p => p !== null);

      const message = messageParts.join("\r\n");
      const encodedMessage = Buffer.from(message).toString("base64url");

      const sendParams: any = {
        userId: "me",
        requestBody: { raw: encodedMessage },
      };
      if (input.threadId) sendParams.requestBody.threadId = input.threadId;

      const response = await gmail.users.messages.send(sendParams);
      return normalizeProviderResponse({ messageId: response.data.id, threadId: response.data.threadId });
    },
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, messageId: result.data?.id as string };
}

// ─── Draft Email ──────────────────────────────────────────────────────────────

export async function gmailCreateDraft(input: GmailDraftInput): Promise<{ ok: boolean; draftId?: string; error?: string }> {
  const result = await executeIntegrationAction(
    {
      orgId: input.orgId,
      integrationType: "gmail",
      actionType: "create_draft",
      agentType: input.agentType ?? "communication_agent",
      inputSummary: `Draft email to ${input.to}: "${input.subject}"`,
      payload: { to: input.to, subject: input.subject },
    },
    async () => {
      const integration = await getIntegration(input.orgId, "gmail");
      if (!integration || integration.status !== "connected") {
        throw new Error("Gmail integration not connected");
      }
      const creds = integration.encryptedCredentials as any ?? {};
      const { google } = await import("googleapis");
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: creds.accessToken, refresh_token: creds.refreshToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      const message = [
        `To: ${input.to}`,
        `Subject: ${input.subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=utf-8",
        "",
        input.body,
      ].join("\r\n");

      const encoded = Buffer.from(message).toString("base64url");
      const response = await gmail.users.drafts.create({
        userId: "me",
        requestBody: { message: { raw: encoded } },
      });
      return { id: response.data.id, messageId: response.data.message?.id };
    },
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, draftId: result.data?.id as string };
}

// ─── Classify Inbound Reply ───────────────────────────────────────────────────

export async function gmailClassifyReply(input: GmailClassifyInput): Promise<GmailClassification> {
  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Classify this email reply for a fitness coaching business.

From: ${input.sender}
Subject: ${input.subject}
Body: ${input.body.slice(0, 1000)}

Return JSON:
{
  "intent": "booking_request|cancellation|negative_sentiment|positive_response|unsubscribe|auto_reply|unknown",
  "sentiment": "positive|neutral|negative",
  "requiresEscalation": boolean,
  "summary": "one sentence summary",
  "confidence": 0.0-1.0
}`;

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 200,
    });

    const parsed = JSON.parse(res.choices[0].message.content ?? "{}");
    return {
      intent: parsed.intent ?? "unknown",
      sentiment: parsed.sentiment ?? "neutral",
      requiresEscalation: parsed.requiresEscalation ?? false,
      summary: parsed.summary ?? "Could not classify",
      confidence: parsed.confidence ?? 0,
    };
  } catch {
    return { intent: "unknown", sentiment: "neutral", requiresEscalation: false, summary: "Classification failed", confidence: 0 };
  }
}

// ─── Summarize Conversation ───────────────────────────────────────────────────

export async function gmailSummarizeConversation(
  orgId: string,
  messages: Array<{ from: string; subject: string; body: string; date: string }>,
): Promise<string> {
  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const thread = messages.map(m => `[${m.date}] ${m.from}: ${m.body.slice(0, 500)}`).join("\n\n");
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Summarize this email conversation for a fitness coaching business in 2-3 sentences:\n\n${thread}`,
      }],
      max_tokens: 200,
    });
    return res.choices[0].message.content ?? "Summary unavailable";
  } catch {
    return "Summary unavailable";
  }
}

// ─── Connection test ──────────────────────────────────────────────────────────

export async function testGmailConnection(orgId: string): Promise<{ ok: boolean; email?: string; error?: string }> {
  try {
    const integration = await getIntegration(orgId, "gmail");
    if (!integration) return { ok: false, error: "Not configured" };
    const creds = integration.encryptedCredentials as any ?? {};
    if (!creds.accessToken) return { ok: false, error: "No access token" };
    return { ok: true, email: creds.senderEmail ?? "connected" };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
