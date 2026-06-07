/**
 * Hiring Assessment Agent
 * Deterministic candidate scoring — no AI inference, no autonomous decisions.
 * Reads candidate data and produces a structured assessment.
 *
 * GUARDRAILS:
 *  ✗ No autonomous hiring decisions
 *  ✗ No autonomous rejections
 *  ✓ Score / Recommend / Summarize only
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}

// ─── Scoring tables ────────────────────────────────────────────────────────────

const EXPERIENCE_SCORE: Record<string, number> = {
  entry:   45,
  junior:  55,
  mid:     70,
  senior:  85,
  lead:    90,
  expert:  95,
};

const SOURCE_BONUS: Record<string, number> = {
  referral:    20,
  coach:       15,
  internal:    10,
  linkedin:     5,
  job_board:    0,
  manual:       0,
  unknown:      0,
};

const POSITION_DEMAND: Record<string, number> = {
  coach:          80,
  trainer:        75,
  "head coach":   90,
  intern:         60,
  staff:          65,
  contractor:     55,
};

function scoreFromNotes(notes: string | null): number {
  if (!notes) return 0;
  const lower = notes.toLowerCase();
  let score = 0;
  if (lower.includes("certified") || lower.includes("certification")) score += 10;
  if (lower.includes("experience")) score += 5;
  if (lower.includes("degree")) score += 8;
  if (lower.includes("available immediately") || lower.includes("immediately available")) score += 5;
  if (lower.includes("strong") || lower.includes("excellent") || lower.includes("outstanding")) score += 7;
  if (lower.includes("no experience") || lower.includes("limited")) score -= 10;
  return Math.max(-15, Math.min(20, score));
}

// ─── Main assessment function ──────────────────────────────────────────────────

export interface CandidateAssessmentResult {
  fitScore:          number;
  experienceScore:   number;
  cultureScore:      number;
  confidenceScore:   number;
  recommendedAction: string;
  reasoning:         string;
  strengths:         string[];
  concerns:          string[];
  nextSteps:         string[];
}

export async function assessCandidate(
  orgId: string,
  candidateId: string,
): Promise<CandidateAssessmentResult> {
  const result = await db.execute(sql`
    SELECT * FROM hiring_candidates WHERE id = ${candidateId} AND org_id = ${orgId} LIMIT 1
  `);
  const candidate = rows(result)[0];
  if (!candidate) throw new Error(`Candidate ${candidateId} not found`);

  const expScore    = EXPERIENCE_SCORE[candidate.experience_level?.toLowerCase() ?? "mid"] ?? 65;
  const sourceBonus = SOURCE_BONUS[candidate.source?.toLowerCase() ?? "manual"] ?? 0;
  const posBase     = POSITION_DEMAND[candidate.position?.toLowerCase() ?? "staff"] ?? 65;
  const noteBonus   = scoreFromNotes(candidate.notes);
  const cultureScore = 65 + (sourceBonus > 10 ? 10 : 0);

  const fitScore = Math.min(100, Math.round(
    (expScore * 0.4) + (posBase * 0.35) + (cultureScore * 0.15) + noteBonus + (sourceBonus * 0.5),
  ));
  const confidenceScore = candidate.notes && candidate.notes.length > 50 ? 80 : 60;

  const strengths: string[] = [];
  const concerns:  string[] = [];
  const nextSteps: string[] = [];

  if (expScore >= 80) strengths.push(`Strong ${candidate.experience_level} experience level`);
  if (expScore >= 70) strengths.push("Relevant background for the role");
  if (sourceBonus >= 15) strengths.push("Referred by a trusted source — higher hire-rate signal");
  if (sourceBonus >= 10) strengths.push("Warm sourcing channel");
  if (noteBonus > 5) strengths.push("Additional qualifications noted");

  if (expScore < 55) concerns.push("Limited experience — may need significant onboarding");
  if (!candidate.email) concerns.push("No contact email on file");
  if (!candidate.notes || candidate.notes.length < 20) concerns.push("Sparse candidate notes — limited assessment confidence");
  if (sourceBonus === 0) concerns.push("Cold-source candidate — lower historical hire rate");

  if (fitScore >= 80) {
    nextSteps.push("Schedule an initial screening call");
    nextSteps.push("Send interview invitation via Outreach tab");
  } else if (fitScore >= 60) {
    nextSteps.push("Review notes and request additional information");
    nextSteps.push("Consider for follow-up outreach");
  } else {
    nextSteps.push("Evaluate against current open positions before proceeding");
  }

  let recommendedAction: string;
  if (fitScore >= 80)      recommendedAction = "advance_to_interview";
  else if (fitScore >= 65) recommendedAction = "conduct_screening";
  else if (fitScore >= 50) recommendedAction = "request_more_info";
  else                     recommendedAction = "hold_for_review";

  const reasoning = `Candidate scored ${fitScore}/100 based on ${candidate.experience_level} experience (${expScore}/100), ` +
    `position demand for "${candidate.position}" (${posBase}/100), ` +
    `source channel "${candidate.source}" (+${sourceBonus} pts), and notes quality (+${noteBonus} pts). ` +
    `Recommendation: ${recommendedAction.replace(/_/g, " ")}.`;

  // Persist assessment
  await db.execute(sql`
    INSERT INTO hiring_assessments
      (org_id, candidate_id, fit_score, experience_score, culture_score, confidence_score,
       recommended_action, reasoning, strengths, concerns, next_steps)
    VALUES
      (${orgId}, ${candidateId}, ${fitScore}, ${expScore}, ${cultureScore}, ${confidenceScore},
       ${recommendedAction}, ${reasoning},
       ${JSON.stringify(strengths)}::jsonb, ${JSON.stringify(concerns)}::jsonb, ${JSON.stringify(nextSteps)}::jsonb)
  `);

  // Update candidate fit_score + status
  const newStatus = fitScore >= 65 ? "qualified" : "new";
  await db.execute(sql`
    UPDATE hiring_candidates
    SET fit_score = ${fitScore}, status = ${newStatus}, updated_at = NOW()
    WHERE id = ${candidateId} AND org_id = ${orgId}
  `);

  // Log learning signal
  await db.execute(sql`
    INSERT INTO hiring_learning_signals (org_id, candidate_id, source, position, fit_score)
    VALUES (${orgId}, ${candidateId}, ${candidate.source ?? "manual"}, ${candidate.position}, ${fitScore})
  `);

  return { fitScore, experienceScore: expScore, cultureScore, confidenceScore, recommendedAction, reasoning, strengths, concerns, nextSteps };
}

// ─── Bulk get assessments for org ─────────────────────────────────────────────

export async function getAssessmentsForOrg(orgId: string): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT a.*, c.first_name, c.last_name, c.position, c.status
    FROM hiring_assessments a
    JOIN hiring_candidates c ON c.id = a.candidate_id
    WHERE a.org_id = ${orgId}
    ORDER BY a.created_at DESC
    LIMIT 100
  `);
  return rows(result);
}
