/**
 * Opportunity Follow-Up Agent — Phase 8
 * Generates follow-up draft recommendations for classified replies.
 *
 * Safety: generates draft only — NEVER sends. Human review required.
 */

import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function row0(result: unknown): any {
  if (Array.isArray(result)) return result[0] ?? null;
  const r = result as any;
  return Array.isArray(r?.rows) ? (r.rows[0] ?? null) : null;
}

async function logEvent(orgId: string, action: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
      VALUES (${orgId}, 'Follow-Up Agent', ${action}, 'draft')
    `);
  } catch { /* non-fatal */ }
}

// ─── Strategy map per classification ─────────────────────────────────────────

const STRATEGY_MAP: Record<string, string> = {
  interested:          "Deepen interest with value proof and clear next step",
  meeting_request:     "Confirm meeting request and propose calendar link",
  information_request: "Answer their question clearly and return to discovery",
  referral:            "Acknowledge referral and ask for introduction",
  not_interested:      "Graceful breakup email leaving door open",
  objection:           "Acknowledge objection and reframe value proposition",
  out_of_office:       "Lightweight reconnect when they return",
  unclear:             "Gentle check-in to re-engage",
};

// ─── Core follow-up generator ─────────────────────────────────────────────────

export async function generateFollowUpRecommendation(
  orgId:   string,
  replyId: string,
): Promise<{
  subject:   string;
  body:      string;
  strategy:  string;
  reasoning: string;
  draftId:   string;
}> {
  // Fetch full reply context
  const reply = row0(await db.execute(sql`
    SELECT r.*,
           o.title   AS opp_title,
           o.company AS company,
           e.subject AS original_subject,
           e.body    AS original_body,
           e.recipient_email
    FROM   opportunity_reply_events r
    JOIN   opportunity_acquisition_opportunities o ON o.id = r.opportunity_id
    JOIN   opportunity_outreach_executions e ON e.id = r.execution_id
    WHERE  r.id = ${replyId} AND r.org_id = ${orgId}
  `));

  if (!reply) throw Object.assign(new Error("Reply not found"), { status: 404 });

  const classification = reply.classification ?? "unclear";
  const strategy       = STRATEGY_MAP[classification] ?? "Thoughtful follow-up";

  const prompt = `You are an expert sales follow-up writer for a strength & conditioning business platform called TrainEfficiency.

Context:
- Opportunity: "${reply.opp_title}" at ${reply.company}
- Original subject: "${reply.original_subject}"
- Reply from: ${reply.sender_name} <${reply.sender_email}>
- Reply classification: ${classification}
- Reply content: "${reply.snippet || reply.body?.slice(0, 400)}"
- Strategy: ${strategy}
- Key points from reply: ${JSON.stringify(reply.key_points ?? [])}

Write a follow-up email. Rules:
1. Max 120 words
2. Personalized to their reply
3. Clear, human, professional tone
4. No fluff or filler
5. One specific call to action

Respond with JSON:
{
  "subject": "Re: <original subject or new subject>",
  "body": "<the email body>",
  "reasoning": "<1-2 sentences on why this approach>"
}`;

  let subject   = `Re: ${reply.original_subject}`;
  let body      = "";
  let reasoning = "";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 600,
    });

    const raw = JSON.parse(completion.choices[0].message.content ?? "{}");
    subject   = raw.subject || subject;
    body      = raw.body    || "";
    reasoning = raw.reasoning || "";
  } catch {
    body      = `Hi ${reply.sender_name || "there"},\n\nThank you for getting back to me. I'd love to continue our conversation about how TrainEfficiency could support ${reply.company}.\n\nWould you have 15 minutes this week for a quick call?\n\nBest,\nThe TrainEfficiency Team`;
    reasoning = "OpenAI unavailable — used template fallback.";
  }

  // Store as outreach draft (status: draft, not approved)
  const opportunityId: string = reply.opportunity_id;

  const draftRow = row0(await db.execute(sql`
    INSERT INTO opportunity_outreach_drafts (
      org_id, opportunity_id, subject, body, status,
      channel, confidence_score, created_by_agent,
      positioning_angle, call_to_action
    ) VALUES (
      ${orgId}, ${opportunityId},
      ${subject}, ${body}, 'draft',
      'email', 0.75, TRUE,
      ${strategy},
      'Human review required before sending'
    ) RETURNING id
  `));

  const draftId: string = draftRow?.id ?? "unknown";

  // Link draft to reply event
  await db.execute(sql`
    UPDATE opportunity_reply_events
    SET followup_draft_id = ${draftId}
    WHERE id = ${replyId}
  `).catch(() => {});

  await logEvent(orgId,
    `Follow-Up Generated — ${classification} reply from ${reply.sender_email} at ${reply.company} (draft ${draftId})`,
  );

  return { subject, body, strategy, reasoning, draftId };
}
