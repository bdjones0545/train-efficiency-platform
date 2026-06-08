/**
 * Partnership Assessment Agent — Department OS v2
 * Uses Assessment Framework: compositeScore, scoreKeywords, actionFromScore.
 * Computes 5 dimension scores, passes to framework's composite engine.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  compositeScore,
  scoreKeywords,
  actionFromScore,
} from "../frameworks/department-os/assessment";
import type {
  ScoringWeight,
  AssessmentResult,
  KeywordRule,
} from "../frameworks/department-os/assessment";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }

// ─── Scoring weights ─────────────────────────────────────────────────────────

const WEIGHTS: ScoringWeight[] = [
  { dimension: "org_quality",           weight: 0.25 },
  { dimension: "strategic_alignment",   weight: 0.30 },
  { dimension: "reach",                 weight: 0.20 },
  { dimension: "partnership_potential", weight: 0.15 },
  { dimension: "community_impact",      weight: 0.10 },
];

// ─── Keyword rule sets ────────────────────────────────────────────────────────

const ORG_QUALITY_RULES: KeywordRule[] = [
  { keywords: ["established", "founded"],          points: 12 },
  { keywords: ["certified", "accredited"],         points: 15 },
  { keywords: ["professional", "official"],        points: 10 },
  { keywords: ["national", "statewide"],           points: 18 },
  { keywords: ["regional", "district"],            points: 12 },
  { keywords: ["licensed"],                        points: 10 },
  { keywords: ["award", "recognized"],             points: 8  },
  { keywords: ["reputable", "well-known"],         points: 8  },
];

const ALIGNMENT_RULES: KeywordRule[] = [
  { keywords: ["strength", "conditioning"],        points: 20 },
  { keywords: ["fitness", "athletic", "sport"],    points: 15 },
  { keywords: ["training", "performance"],         points: 15 },
  { keywords: ["coaching", "athlete"],             points: 15 },
  { keywords: ["wellness", "health", "physical"],  points: 10 },
  { keywords: ["exercise", "gym"],                 points: 10 },
  { keywords: ["competition", "program"],          points: 8  },
];

const REACH_RULES: KeywordRule[] = [
  { keywords: ["national"],                        points: 25 },
  { keywords: ["statewide", "regional"],           points: 20 },
  { keywords: ["university", "college"],           points: 18 },
  { keywords: ["k-12", "district"],                points: 15 },
  { keywords: ["league"],                          points: 15 },
  { keywords: ["large", "multi-location"],         points: 12 },
  { keywords: ["community", "county"],             points: 8  },
];

const COMMUNITY_RULES: KeywordRule[] = [
  { keywords: ["community", "nonprofit"],          points: 20 },
  { keywords: ["youth", "school"],                 points: 18 },
  { keywords: ["local", "public"],                 points: 10 },
  { keywords: ["volunteer", "outreach"],           points: 12 },
  { keywords: ["underserved", "inclusive"],        points: 15 },
  { keywords: ["diversity", "charity"],            points: 12 },
];

// ─── Dimension scorers ────────────────────────────────────────────────────────

function scoreOrgQuality(data: any): number {
  const text = `${data.organizationName ?? ""} ${data.notes ?? ""}`;
  const base = data.website ? 25 : 5;
  return Math.min(100, base + scoreKeywords(text, ORG_QUALITY_RULES));
}

function scoreStrategicAlignment(data: any): number {
  const text = `${data.organizationName ?? ""} ${data.partnershipType ?? ""} ${data.notes ?? ""}`;
  return Math.min(100, scoreKeywords(text, ALIGNMENT_RULES));
}

function scoreReach(data: any): number {
  const text = `${data.organizationName ?? ""} ${data.notes ?? ""}`;
  const typeBonus = ["school","league","sports_club","franchise"].includes(data.partnershipType ?? "") ? 20 : 0;
  return Math.min(100, typeBonus + scoreKeywords(text, REACH_RULES));
}

function scorePartnershipPotential(data: any): number {
  let score = 30;
  if (data.contactEmail) score += 25;
  if (data.contactPhone) score += 15;
  if (data.contactName)  score += 15;
  if (data.website)      score += 15;
  return Math.min(100, score);
}

function scoreCommunityImpact(data: any): number {
  const text = `${data.organizationName ?? ""} ${data.partnershipType ?? ""} ${data.notes ?? ""}`;
  return Math.min(100, scoreKeywords(text, COMMUNITY_RULES));
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function assessPartnership(
  orgId: string,
  partnershipId: string,
): Promise<AssessmentResult> {
  const opps = await db.execute(sql`
    SELECT * FROM partnership_opportunities
    WHERE id = ${partnershipId} AND org_id = ${orgId}
    LIMIT 1
  `).then(rows);

  const opp = opps[0];
  if (!opp) throw new Error(`Partnership opportunity ${partnershipId} not found`);

  const data = {
    organizationName: opp.organization_name,
    notes:            opp.notes,
    website:          opp.website,
    partnershipType:  opp.partnership_type,
    contactEmail:     opp.contact_email,
    contactPhone:     opp.contact_phone,
    contactName:      opp.contact_name,
  };

  // Compute dimension scores
  const dimensions: Record<string, number> = {
    org_quality:           scoreOrgQuality(data),
    strategic_alignment:   scoreStrategicAlignment(data),
    reach:                 scoreReach(data),
    partnership_potential: scorePartnershipPotential(data),
    community_impact:      scoreCommunityImpact(data),
  };

  // Framework composite score
  const fitScore = compositeScore(dimensions, WEIGHTS);
  const recommendedAction = actionFromScore(fitScore, "advance_to_outreach", "qualify_further", "hold_for_review");

  // Derive confidence from data completeness
  const populatedDims = Object.values(dimensions).filter(v => v > 0).length;
  const confidence = Math.min(100, 45 + populatedDims * 11);

  // Narrative strengths / concerns / recommendations
  const strengths: string[] = [];
  const concerns:  string[] = [];
  const recommendations: string[] = [];

  if (dimensions.strategic_alignment > 60) strengths.push("Strong strategic alignment with fitness/athletic domain");
  if (dimensions.org_quality > 60)         strengths.push("High-quality, established organization");
  if (dimensions.reach > 60)               strengths.push("Significant community or geographic reach");
  if (dimensions.partnership_potential > 70) strengths.push("Complete contact information available for outreach");

  if (dimensions.strategic_alignment < 40)  concerns.push("Limited fitness/athletic alignment detected");
  if (dimensions.org_quality < 40)           concerns.push("Organization profile is sparse — research recommended");
  if (dimensions.reach < 30)                 concerns.push("Reach may be limited relative to target partnerships");
  if (!opp.contact_email)                    concerns.push("No contact email — outreach route unclear");

  if (fitScore >= 70) recommendations.push("Draft personalized outreach email and move to outreach_ready");
  if (fitScore >= 50) recommendations.push("Research current fitness partnerships at this organization");
  recommendations.push("Log first contact attempt in the relationship tracker");
  if (fitScore < 40)  recommendations.push("Consider deferring — revisit with more information");

  const reasoning = `Composite score ${fitScore}/100 across 5 dimensions. ` +
    `Strategic alignment (${Math.round(dimensions.strategic_alignment)}) and ` +
    `reach (${Math.round(dimensions.reach)}) are the primary drivers.`;

  const result: AssessmentResult = {
    entityId:          partnershipId,
    entityType:        "partnership",
    score:             fitScore,
    confidence,
    reasoning,
    strengths,
    concerns,
    recommendations,
    recommendedAction,
    dimensions,
  };

  // Persist
  await db.execute(sql`
    INSERT INTO partnership_assessments
      (org_id, partnership_id, fit_score, reach_score, strategic_value_score,
       confidence_score, recommended_action, reasoning, strengths, concerns, next_steps)
    VALUES (
      ${orgId}, ${partnershipId},
      ${Math.round(fitScore)},
      ${Math.round(dimensions.reach)},
      ${Math.round(dimensions.strategic_alignment)},
      ${Math.round(confidence)},
      ${recommendedAction},
      ${reasoning},
      ${JSON.stringify(strengths)},
      ${JSON.stringify(concerns)},
      ${JSON.stringify(recommendations)}
    )
  `);

  await db.execute(sql`
    UPDATE partnership_opportunities
    SET fit_score = ${Math.round(fitScore)}, updated_at = NOW()
    WHERE id = ${partnershipId} AND org_id = ${orgId}
  `);

  return result;
}
