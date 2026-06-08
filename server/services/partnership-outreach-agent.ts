/**
 * Partnership Outreach Agent — Department OS v2
 * Draft generation only. No autonomous sending.
 */

import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }

export type PartnershipDraftType =
  | "introduction"
  | "collaboration_proposal"
  | "facility_partnership"
  | "community_partnership"
  | "referral_partnership";

const DRAFT_ANGLES: Record<PartnershipDraftType, string> = {
  introduction:             "Warm introduction establishing who we are and exploring mutual fit",
  collaboration_proposal:   "Collaborative program proposal with specific joint-value framing",
  facility_partnership:     "Facility sharing or co-location arrangement for training programs",
  community_partnership:    "Community-impact partnership benefiting shared audience",
  referral_partnership:     "Mutual referral arrangement creating reciprocal business value",
};

// ─── Public API ──────────────────────────────────────────────────────────────

export async function draftPartnershipOutreach(
  orgId: string,
  partnershipId: string,
  draftType: PartnershipDraftType = "introduction",
): Promise<{ subject: string; body: string; positioningAngle: string; confidence: number }> {
  const opps = await db.execute(sql`
    SELECT * FROM partnership_opportunities
    WHERE id = ${partnershipId} AND org_id = ${orgId}
    LIMIT 1
  `).then(rows);

  const opp = opps[0];
  if (!opp) throw new Error(`Partnership opportunity ${partnershipId} not found`);

  const angle = DRAFT_ANGLES[draftType];
  const contact = opp.contact_name ? `to ${opp.contact_name}` : "";

  const prompt = `You are a professional partnership outreach specialist for a strength and conditioning coaching business.

Draft a ${draftType.replace(/_/g, " ")} email ${contact} at ${opp.organization_name}.

Context:
- Partnership Type: ${opp.partnership_type ?? "general"}
- Location: ${opp.location ?? "not specified"}
- Website: ${opp.website ?? "not available"}
- Notes: ${opp.notes ?? "none"}
- Positioning Angle: ${angle}

Guidelines:
- Keep the email concise (150–250 words)
- Professional but conversational tone
- No generic filler — be specific to this organization
- End with a clear, low-friction call to action (15-min call, quick question, etc.)
- Subject line: punchy, under 10 words

Return valid JSON only:
{
  "subject": "...",
  "body": "...",
  "confidence": 0-100
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const parsed = JSON.parse(completion.choices[0].message.content ?? "{}");

  const subject   = String(parsed.subject ?? `Partnership opportunity — ${opp.organization_name}`);
  const body      = String(parsed.body ?? "Draft generation failed. Please try again.");
  const confidence = Number(parsed.confidence ?? 70);

  await db.execute(sql`
    INSERT INTO partnership_outreach_drafts
      (org_id, partnership_id, subject, body, status, positioning_angle, confidence_score)
    VALUES (
      ${orgId}, ${partnershipId}, ${subject}, ${body},
      'draft', ${angle}, ${confidence}
    )
  `);

  return { subject, body, positioningAngle: angle, confidence };
}
