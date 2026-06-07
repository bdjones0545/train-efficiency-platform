/**
 * Hiring Outreach Agent
 * Generates outreach drafts for candidates. Draft-only — no sending.
 *
 * GUARDRAILS:
 *  ✗ No autonomous sending
 *  ✓ Draft / Template / Suggest only
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}

export type OutreachType = "interview_invitation" | "follow_up" | "application_request" | "offer_letter_intro";

interface OutreachDraft {
  subject:           string;
  body:              string;
  positioningAngle:  string;
  confidenceScore:   number;
}

// ─── Template generators ───────────────────────────────────────────────────────

function buildInterviewInvitation(firstName: string, position: string, orgName: string): OutreachDraft {
  return {
    subject: `Interview Invitation — ${position} at ${orgName}`,
    body: `Hi ${firstName},

Thank you for your interest in the ${position} role at ${orgName}.

We've reviewed your background and would love to connect for an initial conversation. This would be a 20–30 minute call to learn more about your experience and share details about the opportunity.

Please reply with a few times that work for you, or let me know if you have any questions.

Looking forward to connecting,
${orgName} Hiring Team`,
    positioningAngle: "Value-first, respectful of their time",
    confidenceScore: 85,
  };
}

function buildFollowUp(firstName: string, position: string, orgName: string): OutreachDraft {
  return {
    subject: `Following up — ${position} Opportunity`,
    body: `Hi ${firstName},

I wanted to follow up on our previous message about the ${position} role at ${orgName}.

We're still very interested in connecting and would love to hear your thoughts. Even if the timing isn't right, I'd be happy to answer any questions you might have.

Let me know if you'd like to chat!

Best,
${orgName} Hiring Team`,
    positioningAngle: "Soft follow-up, low pressure",
    confidenceScore: 75,
  };
}

function buildApplicationRequest(firstName: string, position: string, orgName: string): OutreachDraft {
  return {
    subject: `${position} Opening at ${orgName} — We'd Love Your Application`,
    body: `Hi ${firstName},

We came across your profile and believe you could be a great fit for a ${position} opportunity at ${orgName}.

We're building a high-performance team and are looking for someone with your background. If you're open to exploring this, we'd love to receive your application or simply have a quick conversation.

Feel free to reply to this message or send your resume if you're interested.

Best regards,
${orgName} Hiring Team`,
    positioningAngle: "Proactive sourcing, candidate-led",
    confidenceScore: 70,
  };
}

function buildOfferLetterIntro(firstName: string, position: string, orgName: string): OutreachDraft {
  return {
    subject: `Exciting News — ${position} Offer from ${orgName}`,
    body: `Hi ${firstName},

We're thrilled to let you know that we'd like to extend an offer for the ${position} role at ${orgName}.

We've been very impressed with your background and believe you'd be a fantastic addition to our team. We'll be sending over the formal offer details shortly.

In the meantime, please feel free to reach out with any questions.

Congratulations, and we hope to welcome you to the team!

Warm regards,
${orgName} Hiring Team`,
    positioningAngle: "Celebratory, clear next steps",
    confidenceScore: 90,
  };
}

// ─── Main draft generation ─────────────────────────────────────────────────────

export async function generateOutreachDraft(
  orgId: string,
  candidateId: string,
  outreachType: OutreachType,
  orgName = "Our Organization",
): Promise<any> {
  const result = await db.execute(sql`
    SELECT * FROM hiring_candidates WHERE id = ${candidateId} AND org_id = ${orgId} LIMIT 1
  `);
  const candidate = rows(result)[0];
  if (!candidate) throw new Error(`Candidate ${candidateId} not found`);

  const firstName = candidate.first_name ?? "there";
  const position  = candidate.position ?? "the open position";

  let draft: OutreachDraft;
  switch (outreachType) {
    case "interview_invitation":  draft = buildInterviewInvitation(firstName, position, orgName); break;
    case "follow_up":             draft = buildFollowUp(firstName, position, orgName); break;
    case "offer_letter_intro":    draft = buildOfferLetterIntro(firstName, position, orgName); break;
    default:                      draft = buildApplicationRequest(firstName, position, orgName);
  }

  const insertResult = await db.execute(sql`
    INSERT INTO hiring_outreach_drafts
      (org_id, candidate_id, subject, body, status, positioning_angle, confidence_score)
    VALUES
      (${orgId}, ${candidateId}, ${draft.subject}, ${draft.body}, 'draft',
       ${draft.positioningAngle}, ${draft.confidenceScore})
    RETURNING *
  `);
  return rows(insertResult)[0] ?? null;
}

// ─── Get drafts for org ────────────────────────────────────────────────────────

export async function getOutreachDraftsForOrg(orgId: string): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT d.*, c.first_name, c.last_name, c.position, c.status
    FROM hiring_outreach_drafts d
    JOIN hiring_candidates c ON c.id = d.candidate_id
    WHERE d.org_id = ${orgId}
    ORDER BY d.created_at DESC
    LIMIT 100
  `);
  return rows(result);
}
