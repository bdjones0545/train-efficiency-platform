/**
 * Opportunity Reply Intelligence Agent — Phase 8
 * Classifies inbound replies to outreach using GPT-4o-mini.
 *
 * Safety: read-only intelligence — no autonomous replies, no autonomous follow-ups.
 */

import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReplyClassification =
  | "interested"
  | "objection"
  | "not_interested"
  | "meeting_request"
  | "information_request"
  | "out_of_office"
  | "referral"
  | "unclear";

export interface ClassificationResult {
  classification:    ReplyClassification;
  confidenceScore:   number;   // 0.0 – 1.0
  reasoning:         string;
  suggestedNextAction: string;
  keyPoints:         string[];
  urgency:           "low" | "medium" | "high";
}

// ─── Pipeline status mapping ──────────────────────────────────────────────────

export const CLASSIFICATION_TO_PIPELINE: Record<ReplyClassification, string> = {
  interested:          "interested",
  meeting_request:     "demo",
  information_request: "interested",
  referral:            "interested",
  not_interested:      "lost",
  objection:           "interested",
  out_of_office:       "contacted",
  unclear:             "contacted",
};

export const SUGGESTED_ACTIONS: Record<ReplyClassification, string> = {
  interested:          "Generate Follow-Up",
  meeting_request:     "Schedule Meeting",
  information_request: "Provide Information",
  referral:            "Create Referral Opportunity",
  not_interested:      "Close Opportunity",
  objection:           "Address Objection",
  out_of_office:       "Follow Up Later",
  unclear:             "Generate Follow-Up",
};

// ─── DB helpers ───────────────────────────────────────────────────────────────

function row0(result: unknown): any {
  if (Array.isArray(result)) return result[0] ?? null;
  const r = result as any;
  return Array.isArray(r?.rows) ? (r.rows[0] ?? null) : null;
}

async function logEvent(orgId: string, action: string, eventType = "reply"): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
      VALUES (${orgId}, 'Reply Intelligence Agent', ${action}, ${eventType})
    `);
  } catch { /* non-fatal */ }
}

// ─── Table bootstrap ──────────────────────────────────────────────────────────

export async function ensureReplyEventsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_reply_events (
      id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id               TEXT NOT NULL,
      opportunity_id       TEXT NOT NULL,
      execution_id         TEXT NOT NULL,
      sender_name          TEXT NOT NULL DEFAULT '',
      sender_email         TEXT NOT NULL DEFAULT '',
      subject              TEXT NOT NULL DEFAULT '',
      body                 TEXT NOT NULL DEFAULT '',
      snippet              TEXT NOT NULL DEFAULT '',
      classification       TEXT,
      confidence_score     NUMERIC(4,3) DEFAULT 0,
      suggested_next_action TEXT,
      reasoning            TEXT,
      key_points           TEXT[] DEFAULT '{}',
      urgency              TEXT DEFAULT 'low',
      pipeline_status      TEXT,
      followup_draft_id    TEXT,
      received_at          TIMESTAMPTZ,
      processed_at         TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ─── Core classification ──────────────────────────────────────────────────────

export async function classifyReply(
  orgId:       string,
  executionId: string,
  emailContent: {
    senderName:  string;
    senderEmail: string;
    subject:     string;
    body:        string;
    receivedAt?: string;
  },
): Promise<ClassificationResult> {
  await ensureReplyEventsTable();

  // Fetch execution context
  const exec = row0(await db.execute(sql`
    SELECT e.*, o.title AS opp_title, o.company
    FROM   opportunity_outreach_executions e
    JOIN   opportunity_acquisition_opportunities o ON o.id = e.opportunity_id
    WHERE  e.id = ${executionId} AND e.org_id = ${orgId}
  `));

  const context = exec
    ? `Outreach was sent to ${exec.recipient_email} regarding "${exec.opp_title}" at ${exec.company}.`
    : "Context not found.";

  const prompt = `You are an expert sales reply classifier for a strength & conditioning business platform.

Context: ${context}

Inbound reply:
From: ${emailContent.senderName} <${emailContent.senderEmail}>
Subject: ${emailContent.subject}
Body:
${emailContent.body}

Classify this reply into exactly one of these categories:
- interested: Positive or curious response, wants to know more
- meeting_request: Explicitly asks for a call, meeting, or demo
- information_request: Asks specific questions about pricing, features, services
- referral: Directs to another contact or decision-maker
- not_interested: Clear rejection, no current need
- objection: Has concerns but not a flat rejection
- out_of_office: Automated or away message
- unclear: Ambiguous, cannot determine intent

Respond with JSON only:
{
  "classification": "<one of the above>",
  "confidenceScore": <0.0-1.0>,
  "reasoning": "<1-2 sentences explaining why>",
  "suggestedNextAction": "<specific recommended action>",
  "keyPoints": ["<point 1>", "<point 2>"],
  "urgency": "low|medium|high"
}`;

  let result: ClassificationResult;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 400,
    });

    const raw = JSON.parse(completion.choices[0].message.content ?? "{}");

    const classification = (raw.classification ?? "unclear") as ReplyClassification;
    result = {
      classification,
      confidenceScore:     Math.min(1, Math.max(0, Number(raw.confidenceScore ?? 0.5))),
      reasoning:           raw.reasoning ?? "",
      suggestedNextAction: raw.suggestedNextAction ?? SUGGESTED_ACTIONS[classification],
      keyPoints:           Array.isArray(raw.keyPoints) ? raw.keyPoints : [],
      urgency:             (raw.urgency === "high" || raw.urgency === "medium") ? raw.urgency : "low",
    };
  } catch {
    result = {
      classification:      "unclear",
      confidenceScore:     0.3,
      reasoning:           "Classification failed — defaulting to unclear.",
      suggestedNextAction: SUGGESTED_ACTIONS.unclear,
      keyPoints:           [],
      urgency:             "low",
    };
  }

  // Persist reply event
  const snippet = emailContent.body.slice(0, 280).replace(/\n+/g, " ");
  const pipelineStatus = CLASSIFICATION_TO_PIPELINE[result.classification];

  const replyRow = row0(await db.execute(sql`
    INSERT INTO opportunity_reply_events (
      org_id, opportunity_id, execution_id,
      sender_name, sender_email, subject, body, snippet,
      classification, confidence_score, suggested_next_action,
      reasoning, key_points, urgency, pipeline_status,
      received_at, processed_at
    )
    SELECT
      ${orgId},
      COALESCE(${exec?.opportunity_id ?? null}, ''),
      ${executionId},
      ${emailContent.senderName}, ${emailContent.senderEmail},
      ${emailContent.subject}, ${emailContent.body}, ${snippet},
      ${result.classification}, ${result.confidenceScore},
      ${result.suggestedNextAction}, ${result.reasoning},
      ${result.keyPoints}::text[],
      ${result.urgency}, ${pipelineStatus},
      ${emailContent.receivedAt ?? new Date().toISOString()},
      NOW()
    RETURNING id
  `));

  const replyId = replyRow?.id ?? "unknown";

  // Update execution reply_detected flag
  if (exec?.opportunity_id) {
    await db.execute(sql`
      UPDATE opportunity_outreach_executions
      SET reply_detected = TRUE, replied_at = NOW(), status = 'replied'
      WHERE id = ${executionId}
    `).catch(() => {});

    // Update opportunity pipeline status
    await db.execute(sql`
      UPDATE opportunity_acquisition_opportunities
      SET status = ${pipelineStatus}
      WHERE id = ${exec.opportunity_id} AND org_id = ${orgId}
    `).catch(() => {});
  }

  await logEvent(orgId,
    `Reply Classified — ${result.classification} (confidence: ${(result.confidenceScore * 100).toFixed(0)}%) from ${emailContent.senderEmail} [reply ${replyId}]`,
    "reply",
  );

  // Log interest / lost events
  if (result.classification === "interested" || result.classification === "meeting_request") {
    await logEvent(orgId, `Opportunity Marked Interested — ${exec?.opp_title ?? "unknown"} at ${exec?.company ?? ""}`, "reply");
  } else if (result.classification === "not_interested") {
    await logEvent(orgId, `Opportunity Marked Lost — ${exec?.opp_title ?? "unknown"} at ${exec?.company ?? ""}`, "reply");
  }

  return result;
}
