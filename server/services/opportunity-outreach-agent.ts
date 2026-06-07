/**
 * Opportunity Outreach Agent — Phase 4
 * Generates professional outreach drafts from qualified opportunities using OpenAI.
 * No email is sent in this phase — drafts only.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OutreachDraftResult {
  subject:           string;
  body:              string;
  callToAction:      string;
  positioningAngle:  string;
  confidenceScore:   number;
  opportunityTitle:  string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? null;
}

// ─── Table migration ──────────────────────────────────────────────────────────

async function ensureOutreachDraftColumns(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE opportunity_outreach_drafts
      ADD COLUMN IF NOT EXISTS channel            TEXT NOT NULL DEFAULT 'email',
      ADD COLUMN IF NOT EXISTS confidence_score   INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS created_by_agent   BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS approved_by_user_id TEXT,
      ADD COLUMN IF NOT EXISTS sent_at            TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS call_to_action     TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS positioning_angle  TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateOutreachDraft(
  orgId: string,
  opportunityId: string,
): Promise<OutreachDraftResult> {
  await ensureOutreachDraftColumns();

  // ── Fetch opportunity
  const opp = row0(await db.execute(sql`
    SELECT * FROM opportunity_acquisition_opportunities
    WHERE id = ${opportunityId} AND org_id = ${orgId}
  `));
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`);

  // ── Fetch assessment (if available)
  const assessment = row0(await db.execute(sql`
    SELECT * FROM opportunity_qualification_assessments
    WHERE opportunity_id = ${opportunityId} AND org_id = ${orgId}
  `));

  // ── Fetch org name
  const orgRow = row0(await db.execute(sql`
    SELECT name FROM organizations WHERE id = ${orgId}
  `));
  const orgName: string = orgRow?.name ?? "Our Team";

  // ── Build context for the prompt
  const fitScore: number       = Number(assessment?.fit_score ?? opp.fit_score ?? 0);
  const aiCanFulfill: string[] = assessment?.ai_can_fulfill ?? [];
  const humanRequired: string[]= assessment?.human_required ?? [];
  const reasoning: string      = assessment?.reasoning ?? "";
  const recAction: string      = assessment?.recommended_action ?? "Review manually";
  const estimatedValue: number = Number(opp.estimated_value ?? 0);
  const type: string           = opp.type ?? "coaching";
  const location: string       = opp.location ?? "Remote";

  const systemPrompt = `You are an outreach strategist helping a strength and conditioning coaching business identify B2B software and service revenue opportunities.

Your job is to write a short, professional, non-spammy outreach email that converts a job posting into a business conversation. The email should:
- NOT say "I am an AI" or "I am applying as an AI agent"
- Frame it as a value-add service, not a job application
- Sound curious and collaborative, not salesy
- Be 3–5 short paragraphs max
- Position the org's AI-assisted coaching system as a way to reduce programming/admin load — not replace human coaches

The positioning should be:
"Your posting suggests a need for scalable programming, athlete support, and operational help. [OrgName] can support part of this workload through an AI-assisted coaching system while your staff keeps ownership of relationships and final decisions."

Respond ONLY with a JSON object with these exact keys:
{
  "subject": "...",
  "body": "...",
  "callToAction": "...",
  "positioningAngle": "...",
  "confidenceScore": 0-100
}

The body should use \\n for newlines. The subject should be specific and non-generic. The callToAction should be a single clear ask (1 sentence). The positioningAngle is a short phrase describing the angle (e.g. "Reduce programming load without replacing coaches"). confidenceScore reflects how well this opportunity fits the outreach message (0–100).`;

  const userPrompt = `Opportunity details:
- Title: ${opp.title}
- Company: ${opp.company || "Unknown company"}
- Type: ${type}
- Location: ${location}
- Estimated value: ${estimatedValue > 0 ? `$${estimatedValue.toLocaleString()}` : "Unknown"}
- Source: ${opp.source || "Manual"}
- Notes: ${opp.notes || "None provided"}
- Fit score: ${fitScore}/100
- Recommended action: ${recAction}
- AI can fulfill: ${aiCanFulfill.length > 0 ? aiCanFulfill.join(", ") : "Program design, athlete education, reporting"}
- Human required: ${humanRequired.length > 0 ? humanRequired.join(", ") : "Relationship management, contract review"}
- Reasoning: ${reasoning || "Good remote fit for AI-assisted delivery."}
- Our org name: ${orgName}

Write the outreach draft now.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Record<string, any> = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  const result: OutreachDraftResult = {
    subject:          String(parsed.subject ?? `Opportunity: ${opp.title}`),
    body:             String(parsed.body ?? ""),
    callToAction:     String(parsed.callToAction ?? "Would it be worth a quick conversation?"),
    positioningAngle: String(parsed.positioningAngle ?? "AI-assisted coaching support"),
    confidenceScore:  Math.min(100, Math.max(0, Number(parsed.confidenceScore ?? fitScore))),
    opportunityTitle: opp.title,
  };

  // ── Upsert draft into DB
  await db.execute(sql`
    INSERT INTO opportunity_outreach_drafts
      (org_id, opportunity_id, subject, body, status, channel, confidence_score,
       created_by_agent, call_to_action, positioning_angle)
    VALUES (
      ${orgId}, ${opportunityId},
      ${result.subject}, ${result.body}, 'draft', 'email',
      ${result.confidenceScore}, true,
      ${result.callToAction}, ${result.positioningAngle}
    )
    ON CONFLICT (opportunity_id) DO UPDATE SET
      subject           = EXCLUDED.subject,
      body              = EXCLUDED.body,
      status            = 'draft',
      confidence_score  = EXCLUDED.confidence_score,
      call_to_action    = EXCLUDED.call_to_action,
      positioning_angle = EXCLUDED.positioning_angle,
      updated_at        = NOW()
  `);

  return result;
}
