/**
 * Sponsorship Outreach Agent — Department OS v2
 * Draft generation only. No autonomous sending.
 */

import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }

export type SponsorshipDraftType =
  | "introduction"
  | "partnership_proposal"
  | "community_sponsorship"
  | "event_sponsorship"
  | "athlete_development_sponsorship"
  | "facility_sponsorship";

const DRAFT_ANGLES: Record<SponsorshipDraftType, string> = {
  introduction:                   "Warm introduction exploring mutual sponsorship fit and shared audience benefits",
  partnership_proposal:           "Formal sponsorship proposal with specific value exchange and exposure metrics",
  community_sponsorship:          "Community-impact angle — shared mission benefiting local athletes and youth",
  event_sponsorship:              "Event-based sponsorship with brand visibility and live audience access",
  athlete_development_sponsorship: "Athlete development sponsorship supporting high-performance coaching programs",
  facility_sponsorship:           "Facility naming rights or co-branded training space sponsorship",
};

// ─── Public API ──────────────────────────────────────────────────────────────

export async function draftSponsorshipOutreach(
  orgId: string,
  sponsorshipId: string,
  draftType: SponsorshipDraftType = "introduction",
): Promise<{ subject: string; body: string; positioningAngle: string; confidence: number }> {
  const opps = await db.execute(sql`
    SELECT * FROM sponsorship_opportunities
    WHERE id = ${sponsorshipId} AND org_id = ${orgId}
    LIMIT 1
  `).then(rows);

  const opp = opps[0];
  if (!opp) throw new Error(`Sponsorship opportunity ${sponsorshipId} not found`);

  const angle   = DRAFT_ANGLES[draftType];
  const contact = opp.contact_name ? `to ${opp.contact_name}` : "";

  const prompt = `You are a professional sponsorship acquisition specialist for a strength and conditioning coaching business.

Draft a ${draftType.replace(/_/g, " ")} email ${contact} at ${opp.organization_name}.

Context:
- Sponsorship Type: ${opp.sponsorship_type ?? "general"}
- Industry: ${opp.industry ?? "not specified"}
- Location: ${opp.location ?? "not specified"}
- Estimated Value: ${opp.estimated_value ? `$${opp.estimated_value}` : "not specified"}
- Website: ${opp.website ?? "not available"}
- Notes: ${opp.notes ?? "none"}
- Positioning Angle: ${angle}

Guidelines:
- Keep the email concise (150–250 words)
- Professional but personable tone
- Emphasize mutual value — what the sponsor gains (brand visibility, athlete access, community association)
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

  const parsed    = JSON.parse(completion.choices[0].message.content ?? "{}");
  const subject   = String(parsed.subject ?? `Sponsorship opportunity — ${opp.organization_name}`);
  const body      = String(parsed.body ?? "Draft generation failed. Please try again.");
  const confidence = Number(parsed.confidence ?? 70);

  await db.execute(sql`
    INSERT INTO sponsorship_outreach_drafts
      (org_id, sponsorship_id, subject, body, status, positioning_angle, confidence_score)
    VALUES (
      ${orgId}, ${sponsorshipId}, ${subject}, ${body},
      'draft', ${angle}, ${confidence}
    )
  `);

  return { subject, body, positioningAngle: angle, confidence };
}
