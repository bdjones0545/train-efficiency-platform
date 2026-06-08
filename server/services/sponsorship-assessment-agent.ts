/**
 * Sponsorship Assessment Agent — Department OS v2
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
  { dimension: "brand_alignment",   weight: 0.30 },
  { dimension: "audience_overlap",  weight: 0.25 },
  { dimension: "financial_value",   weight: 0.20 },
  { dimension: "market_relevance",  weight: 0.15 },
  { dimension: "strategic_fit",     weight: 0.10 },
];

// ─── Keyword rule sets ────────────────────────────────────────────────────────

const BRAND_ALIGNMENT_RULES: KeywordRule[] = [
  { keywords: ["fitness", "athletic", "sport"],          points: 20 },
  { keywords: ["strength", "conditioning", "training"],  points: 20 },
  { keywords: ["health", "wellness", "nutrition"],       points: 15 },
  { keywords: ["performance", "athlete"],                points: 15 },
  { keywords: ["recovery", "equipment"],                 points: 12 },
  { keywords: ["coaching", "gym", "exercise"],           points: 10 },
  { keywords: ["active", "lifestyle", "movement"],       points: 8  },
];

const AUDIENCE_RULES: KeywordRule[] = [
  { keywords: ["national", "international"],             points: 25 },
  { keywords: ["regional", "statewide"],                 points: 20 },
  { keywords: ["university", "college", "campus"],       points: 18 },
  { keywords: ["youth", "school", "student"],            points: 15 },
  { keywords: ["community", "local", "county"],          points: 10 },
  { keywords: ["team", "league", "club"],                points: 12 },
];

const FINANCIAL_RULES: KeywordRule[] = [
  { keywords: ["brand", "national brand", "fortune"],   points: 25 },
  { keywords: ["corporate", "enterprise"],              points: 20 },
  { keywords: ["equipment", "supplement", "nutrition"], points: 18 },
  { keywords: ["media", "broadcast", "publisher"],      points: 15 },
  { keywords: ["foundation", "nonprofit"],              points: 10 },
  { keywords: ["local", "small business"],              points: 8  },
];

const MARKET_RULES: KeywordRule[] = [
  { keywords: ["local", "community"],                   points: 20 },
  { keywords: ["regional", "area"],                     points: 15 },
  { keywords: ["partner", "sponsor"],                   points: 12 },
  { keywords: ["athlete", "player"],                    points: 10 },
  { keywords: ["established", "recognized"],            points: 10 },
];

const STRATEGIC_RULES: KeywordRule[] = [
  { keywords: ["long-term", "multi-year"],               points: 25 },
  { keywords: ["exclusive", "preferred"],                points: 20 },
  { keywords: ["co-branded", "collaboration"],           points: 15 },
  { keywords: ["event", "tournament", "showcase"],       points: 12 },
  { keywords: ["content", "media", "exposure"],          points: 10 },
];

// ─── Dimension scorers ────────────────────────────────────────────────────────

function scoreBrandAlignment(data: any): number {
  const text = `${data.organizationName ?? ""} ${data.industry ?? ""} ${data.notes ?? ""}`;
  return Math.min(100, scoreKeywords(text, BRAND_ALIGNMENT_RULES));
}

function scoreAudienceOverlap(data: any): number {
  const text = `${data.organizationName ?? ""} ${data.industry ?? ""} ${data.location ?? ""} ${data.notes ?? ""}`;
  const typeBonus = ["sports_nutrition", "equipment", "recovery"].includes(data.sponsorshipType ?? "") ? 15 : 0;
  return Math.min(100, typeBonus + scoreKeywords(text, AUDIENCE_RULES));
}

function scoreFinancialValue(data: any): number {
  let score = 20;
  const estimated = Number(data.estimatedValue ?? 0);
  if (estimated > 10000) score += 40;
  else if (estimated > 5000) score += 25;
  else if (estimated > 1000) score += 15;
  const text = `${data.organizationName ?? ""} ${data.industry ?? ""}`;
  return Math.min(100, score + scoreKeywords(text, FINANCIAL_RULES));
}

function scoreMarketRelevance(data: any): number {
  const text = `${data.organizationName ?? ""} ${data.location ?? ""} ${data.notes ?? ""}`;
  const hasContact = data.contactEmail ? 15 : 0;
  return Math.min(100, hasContact + scoreKeywords(text, MARKET_RULES));
}

function scoreStrategicFit(data: any): number {
  const text = `${data.notes ?? ""} ${data.sponsorshipType ?? ""}`;
  const typeBonus = ["media_partner", "corporate"].includes(data.sponsorshipType ?? "") ? 20 : 0;
  return Math.min(100, typeBonus + scoreKeywords(text, STRATEGIC_RULES));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function assessSponsorship(
  orgId: string,
  sponsorshipId: string,
): Promise<AssessmentResult> {
  const opps = await db.execute(sql`
    SELECT * FROM sponsorship_opportunities
    WHERE id = ${sponsorshipId} AND org_id = ${orgId}
    LIMIT 1
  `).then(rows);

  const opp = opps[0];
  if (!opp) throw new Error(`Sponsorship opportunity ${sponsorshipId} not found`);

  const data = {
    organizationName: opp.organization_name,
    notes:            opp.notes,
    website:          opp.website,
    sponsorshipType:  opp.sponsorship_type,
    industry:         opp.industry,
    location:         opp.location,
    contactEmail:     opp.contact_email,
    contactPhone:     opp.contact_phone,
    contactName:      opp.contact_name,
    estimatedValue:   opp.estimated_value,
  };

  const dimensions: Record<string, number> = {
    brand_alignment:  scoreBrandAlignment(data),
    audience_overlap: scoreAudienceOverlap(data),
    financial_value:  scoreFinancialValue(data),
    market_relevance: scoreMarketRelevance(data),
    strategic_fit:    scoreStrategicFit(data),
  };

  const fitScore         = compositeScore(dimensions, WEIGHTS);
  const recommendedAction = actionFromScore(fitScore, "advance_to_outreach", "qualify_further", "hold_for_review");
  const populatedDims    = Object.values(dimensions).filter(v => v > 0).length;
  const confidence       = Math.min(100, 40 + populatedDims * 12);

  const strengths:       string[] = [];
  const concerns:        string[] = [];
  const recommendations: string[] = [];

  if (dimensions.brand_alignment > 60)  strengths.push("Strong brand alignment with fitness/athletic domain");
  if (dimensions.audience_overlap > 60) strengths.push("Significant audience overlap with target athletes");
  if (dimensions.financial_value > 60)  strengths.push("Strong estimated financial value");
  if (dimensions.strategic_fit > 60)    strengths.push("High strategic fit for long-term partnership");

  if (dimensions.brand_alignment < 40)  concerns.push("Limited brand alignment with S&C coaching");
  if (dimensions.financial_value < 30)  concerns.push("Estimated financial value appears low");
  if (!opp.contact_email)               concerns.push("No contact email — outreach route unclear");
  if (!opp.estimated_value)             concerns.push("No estimated value recorded — financial potential unknown");

  if (fitScore >= 70) recommendations.push("Draft sponsorship proposal and move to outreach_ready");
  if (fitScore >= 50) recommendations.push("Research current sponsorship portfolio of this organization");
  recommendations.push("Log first contact attempt in the relationship tracker");
  if (fitScore < 40)  recommendations.push("Consider deferring — revisit with more information or a stronger alignment angle");

  const reasoning = `Composite score ${fitScore}/100 across 5 dimensions. ` +
    `Brand alignment (${Math.round(dimensions.brand_alignment)}) and ` +
    `audience overlap (${Math.round(dimensions.audience_overlap)}) are the primary drivers.`;

  const result: AssessmentResult = {
    entityId:          sponsorshipId,
    entityType:        "sponsorship",
    score:             fitScore,
    confidence,
    reasoning,
    strengths,
    concerns,
    recommendations,
    recommendedAction,
    dimensions,
  };

  await db.execute(sql`
    INSERT INTO sponsorship_assessments
      (org_id, sponsorship_id, fit_score, brand_alignment_score, financial_value_score,
       confidence_score, recommended_action, reasoning, strengths, concerns, next_steps)
    VALUES (
      ${orgId}, ${sponsorshipId},
      ${Math.round(fitScore)},
      ${Math.round(dimensions.brand_alignment)},
      ${Math.round(dimensions.financial_value)},
      ${Math.round(confidence)},
      ${recommendedAction},
      ${reasoning},
      ${JSON.stringify(strengths)},
      ${JSON.stringify(concerns)},
      ${JSON.stringify(recommendations)}
    )
  `);

  await db.execute(sql`
    UPDATE sponsorship_opportunities
    SET fit_score = ${Math.round(fitScore)}, updated_at = NOW()
    WHERE id = ${sponsorshipId} AND org_id = ${orgId}
  `);

  return result;
}
