/**
 * Opportunity Qualification Agent — Phase 3
 * Deterministic scoring engine that analyzes each opportunity and produces
 * a structured qualification assessment. No LLM or scraping in this phase.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QualificationResult {
  fitScore:             number;  // 0–100 composite
  aiFulfillmentScore:   number;  // how much AI can handle (0–100)
  revenuePotentialScore: number; // 0–100
  riskScore:            number;  // 0–100 (lower = safer)
  confidenceScore:      number;  // data completeness (0–100)
  recommendedAction:    string;
  reasoning:            string;
  aiCanFulfill:         string[];
  humanRequired:        string[];
  redFlags:             string[];
  nextSteps:            string[];
  revenuePotential:     "low" | "medium" | "high";
  riskLevel:            "low" | "medium" | "high" | "critical";
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? null;
}
function clamp(v: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}
function containsAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some(t => lower.includes(t));
}

// ─── Scoring sub-functions ────────────────────────────────────────────────────

/**
 * AI Fulfillment Score — how much of the work an AI agent can handle.
 * Remote + digital-first roles score highest.
 */
function scoreAiFulfillment(opp: any): number {
  let score = 40; // base
  const type: string = opp.type ?? "coaching";
  const location: string = opp.location ?? "Remote";
  const text = `${opp.title} ${opp.notes ?? ""}`.toLowerCase();

  // Location bonus
  if (location === "Remote")  score += 35;
  else if (location === "Hybrid") score += 15;
  else score -= 10; // Local/in-person needs human presence

  // Type bonus
  if (["coaching", "content"].includes(type))        score += 20;
  else if (type === "consulting")                     score += 12;
  else if (type === "partnership")                    score += 8;
  else if (type === "training")                       score += (location === "Remote" ? 10 : -5);

  // Signal boosts from title/notes
  if (containsAny(text, ["online", "virtual", "remote", "digital"]))         score += 8;
  if (containsAny(text, ["program design", "programming", "curriculum"]))     score += 5;
  if (containsAny(text, ["in-person", "on-site", "onsite", "hands-on"]))     score -= 20;
  if (containsAny(text, ["certification", "licensed", "supervised"]))         score -= 15;

  return clamp(score);
}

/**
 * Revenue Potential Score — based on estimated value.
 */
function scoreRevenuePotential(opp: any): { score: number; label: "low" | "medium" | "high" } {
  const val = Number(opp.estimated_value ?? 0);
  if (val <= 0)        return { score: 30, label: "medium" }; // unknown — neutral
  if (val >= 100_000)  return { score: 95, label: "high" };
  if (val >= 80_000)   return { score: 85, label: "high" };
  if (val >= 60_000)   return { score: 75, label: "high" };
  if (val >= 40_000)   return { score: 60, label: "medium" };
  if (val >= 20_000)   return { score: 42, label: "medium" };
  return { score: 22, label: "low" };
}

/**
 * Risk Score — higher number = more risk. Lower is safer.
 */
function scoreRisk(opp: any): { score: number; level: "low" | "medium" | "high" | "critical" } {
  let score = 20; // base (low)
  const location: string = opp.location ?? "Remote";
  const type: string = opp.type ?? "coaching";
  const text = `${opp.title} ${opp.notes ?? ""}`.toLowerCase();

  if (location === "Local")   score += 25;
  else if (location === "Hybrid") score += 10;

  if (type === "partnership")  score += 20;
  if (type === "consulting")   score += 10;

  if (containsAny(text, ["certification", "licensed", "legally", "liability"])) score += 30;
  if (containsAny(text, ["exclusive", "equity", "contract", "non-compete"]))    score += 20;
  if (containsAny(text, ["government", "public", "regulated"]))                 score += 15;
  if (containsAny(text, ["in-person", "on-site", "hands-on", "physical"]))     score += 15;

  const clamped = clamp(score);
  const level: "low" | "medium" | "high" | "critical" =
    clamped >= 75 ? "critical" :
    clamped >= 55 ? "high" :
    clamped >= 35 ? "medium" : "low";

  return { score: clamped, level };
}

/**
 * Confidence Score — how complete is the data we have?
 */
function scoreConfidence(opp: any): number {
  let score = 35;
  if (opp.company && opp.company.trim().length > 0)   score += 20;
  if (opp.notes   && opp.notes.trim().length > 10)    score += 20;
  if (Number(opp.estimated_value ?? 0) > 0)           score += 15;
  if (opp.source  && opp.source !== "Manual")         score += 10;
  return clamp(score);
}

/**
 * Composite Fit Score.
 */
function compositeScore(ai: number, rev: number, risk: number, conf: number): number {
  // Weights: AI fulfillment 40%, revenue 30%, inverse-risk 20%, confidence 10%
  return clamp(
    ai  * 0.40 +
    rev * 0.30 +
    (100 - risk) * 0.20 +
    conf * 0.10
  );
}

/**
 * Determine what AI can and cannot fulfill based on type/location.
 */
function deriveCapabilities(opp: any): { aiCanFulfill: string[]; humanRequired: string[] } {
  const type: string = opp.type ?? "coaching";
  const location: string = opp.location ?? "Remote";
  const text = `${opp.title} ${opp.notes ?? ""}`.toLowerCase();

  const aiCanFulfill: string[] = [];
  const humanRequired: string[] = ["Sales approval", "Contract review"];

  // Universal AI capabilities for digital work
  if (["coaching", "training"].includes(type)) {
    aiCanFulfill.push("Program design", "Exercise selection", "Progression logic", "Athlete education", "Reporting");
    if (location === "Remote") aiCanFulfill.push("Session scheduling", "Progress tracking", "Video feedback");
  }
  if (type === "content") {
    aiCanFulfill.push("Content creation", "Curriculum development", "Program design", "Performance tracking", "Reporting");
  }
  if (type === "consulting") {
    aiCanFulfill.push("Data analysis", "Program design", "Reporting", "Documentation", "Strategy drafting");
    humanRequired.push("Client relationship management", "Final recommendations approval");
  }
  if (type === "partnership") {
    aiCanFulfill.push("Program design", "Reporting", "Athlete education", "Documentation");
    humanRequired.push("Relationship ownership", "Negotiation", "Ongoing account management");
  }

  // Location penalties
  if (location === "Local" || containsAny(text, ["in-person", "on-site", "hands-on", "physical"])) {
    humanRequired.push("On-site delivery", "Physical supervision");
  }
  if (containsAny(text, ["certification", "licensed"])) {
    humanRequired.push("Professional certification verification");
  }

  // Value-based
  if (Number(opp.estimated_value ?? 0) >= 80_000) {
    humanRequired.push("Relationship ownership");
  }

  // Deduplicate
  return {
    aiCanFulfill: [...new Set(aiCanFulfill)],
    humanRequired: [...new Set(humanRequired)],
  };
}

/**
 * Red flags worth surfacing.
 */
function deriveRedFlags(opp: any, risk: number): string[] {
  const flags: string[] = [];
  const text = `${opp.title} ${opp.notes ?? ""}`.toLowerCase();

  if ((opp.location ?? "Remote") !== "Remote")                                flags.push("Requires physical presence");
  if (!Number(opp.estimated_value))                                            flags.push("No revenue data — estimate unclear");
  if (Number(opp.estimated_value) > 0 && Number(opp.estimated_value) < 20_000) flags.push("Below typical revenue threshold ($20K)");
  if (containsAny(text, ["certification", "licensed", "certified"]))           flags.push("May require professional certification");
  if (containsAny(text, ["equity", "non-compete", "exclusive"]))               flags.push("Contract terms need legal review");
  if (containsAny(text, ["government", "regulated", "public sector"]))         flags.push("Regulated sector — compliance required");
  if (!opp.company || !opp.company.trim())                                     flags.push("Company not identified");
  if (risk >= 55)                                                               flags.push("Above-average risk profile");

  return flags;
}

/**
 * Next steps based on fit.
 */
function deriveNextSteps(fitScore: number, riskLevel: string): string[] {
  if (fitScore >= 75) {
    return [
      "Draft personalized outreach message",
      "Research primary contact / decision-maker",
      "Verify remote-work or delivery format",
      "Set 3-day follow-up reminder",
    ];
  }
  if (fitScore >= 55) {
    return [
      "Gather more detail on delivery expectations",
      "Verify remote or hybrid option",
      "Research company size and reputation",
      "Reassess after adding notes",
    ];
  }
  return [
    "Review manually before proceeding",
    riskLevel === "critical" ? "Escalate for legal review" : "Archive if unfit",
    "Document reason for low fit score",
  ];
}

/**
 * Recommended action string.
 */
function deriveRecommendedAction(fit: number, risk: string): string {
  if (risk === "critical")  return "Requires Legal Review";
  if (fit >= 80)            return "Proceed to Outreach";
  if (fit >= 65)            return "Qualify Further";
  if (fit >= 45)            return "Review Manually";
  return "Low Priority — Archive or Reject";
}

/**
 * Human-readable reasoning.
 */
function deriveReasoning(opp: any, fit: number, ai: number, rev: { score: number; label: string }, risk: { score: number; level: string }, conf: number): string {
  const parts: string[] = [];

  parts.push(`Fit score: ${fit}/100.`);

  if (opp.location === "Remote") {
    parts.push("Remote delivery strongly favors AI fulfillment.");
  } else if (opp.location === "Hybrid") {
    parts.push("Hybrid delivery partially limits AI-only fulfillment.");
  } else {
    parts.push("In-person delivery significantly reduces AI suitability.");
  }

  if (ai >= 70)       parts.push(`AI can handle ${ai}% of this engagement autonomously.`);
  else if (ai >= 50)  parts.push(`AI can assist with roughly ${ai}% of deliverables.`);
  else                parts.push(`This role requires significant human involvement (AI score: ${ai}/100).`);

  if (rev.label === "high")   parts.push("Revenue potential is high — worth prioritizing.");
  else if (rev.label === "low") parts.push("Revenue potential is below average.");

  if (conf < 55) parts.push("Confidence is low due to missing company or value data — add more details to improve scoring.");

  return parts.join(" ");
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function qualifyOpportunity(orgId: string, opportunityId: string): Promise<QualificationResult & { opportunityTitle: string }> {
  const opp = row0(await db.execute(sql`
    SELECT * FROM opportunity_acquisition_opportunities
    WHERE id = ${opportunityId} AND org_id = ${orgId}
  `));

  if (!opp) throw new Error(`Opportunity ${opportunityId} not found for org ${orgId}`);

  // ── Score
  const aiFulfillmentScore    = scoreAiFulfillment(opp);
  const rev                   = scoreRevenuePotential(opp);
  const risk                  = scoreRisk(opp);
  const confidenceScore       = scoreConfidence(opp);
  const fitScore              = compositeScore(aiFulfillmentScore, rev.score, risk.score, confidenceScore);

  const { aiCanFulfill, humanRequired } = deriveCapabilities(opp);
  const redFlags             = deriveRedFlags(opp, risk.score);
  const nextSteps            = deriveNextSteps(fitScore, risk.level);
  const recommendedAction    = deriveRecommendedAction(fitScore, risk.level);
  const reasoning            = deriveReasoning(opp, fitScore, aiFulfillmentScore, rev, risk, confidenceScore);

  const result: QualificationResult = {
    fitScore,
    aiFulfillmentScore,
    revenuePotentialScore: rev.score,
    riskScore:             risk.score,
    confidenceScore,
    recommendedAction,
    reasoning,
    aiCanFulfill,
    humanRequired,
    redFlags,
    nextSteps,
    revenuePotential: rev.label,
    riskLevel:        risk.level,
  };

  // ── Persist assessment (upsert by opportunity_id + org_id)
  await db.execute(sql`
    ALTER TABLE opportunity_qualification_assessments
      ADD COLUMN IF NOT EXISTS fit_score             INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ai_fulfillment_score  INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS revenue_potential_score INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS risk_score            INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS confidence_score      INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reasoning             TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS red_flags             JSONB NOT NULL DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS next_steps            JSONB NOT NULL DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await db.execute(sql`
    INSERT INTO opportunity_qualification_assessments
      (org_id, opportunity_id, fit_score, ai_fulfillment_score, revenue_potential_score,
       risk_score, confidence_score, revenue_potential, risk_level, recommended_action,
       reasoning, ai_can_fulfill, human_required, red_flags, next_steps)
    VALUES (
      ${orgId}, ${opportunityId},
      ${result.fitScore}, ${result.aiFulfillmentScore}, ${result.revenuePotentialScore},
      ${result.riskScore}, ${result.confidenceScore},
      ${result.revenuePotential}, ${result.riskLevel}, ${result.recommendedAction},
      ${result.reasoning},
      ${JSON.stringify(result.aiCanFulfill)},
      ${JSON.stringify(result.humanRequired)},
      ${JSON.stringify(result.redFlags)},
      ${JSON.stringify(result.nextSteps)}
    )
    ON CONFLICT (opportunity_id) DO UPDATE SET
      fit_score              = EXCLUDED.fit_score,
      ai_fulfillment_score   = EXCLUDED.ai_fulfillment_score,
      revenue_potential_score = EXCLUDED.revenue_potential_score,
      risk_score             = EXCLUDED.risk_score,
      confidence_score       = EXCLUDED.confidence_score,
      revenue_potential      = EXCLUDED.revenue_potential,
      risk_level             = EXCLUDED.risk_level,
      recommended_action     = EXCLUDED.recommended_action,
      reasoning              = EXCLUDED.reasoning,
      ai_can_fulfill         = EXCLUDED.ai_can_fulfill,
      human_required         = EXCLUDED.human_required,
      red_flags              = EXCLUDED.red_flags,
      next_steps             = EXCLUDED.next_steps,
      updated_at             = NOW()
  `);

  // ── Update opportunity fit_score and auto-qualify if threshold met
  const newStatus = fitScore >= 65 ? "qualified" : opp.status;
  await db.execute(sql`
    UPDATE opportunity_acquisition_opportunities
    SET fit_score  = ${result.fitScore},
        status     = ${newStatus},
        updated_at = NOW()
    WHERE id = ${opportunityId} AND org_id = ${orgId}
  `);

  return { ...result, opportunityTitle: opp.title };
}

export async function qualifyAllPending(orgId: string): Promise<{ qualified: number; results: string[] }> {
  const pending = rows(await db.execute(sql`
    SELECT o.id, o.title FROM opportunity_acquisition_opportunities o
    WHERE o.org_id = ${orgId}
      AND o.status IN ('new')
      AND NOT EXISTS (
        SELECT 1 FROM opportunity_qualification_assessments a
        WHERE a.opportunity_id = o.id
      )
    ORDER BY o.created_at ASC
    LIMIT 20
  `));

  const results: string[] = [];
  for (const p of pending) {
    try {
      const r = await qualifyOpportunity(orgId, p.id);
      results.push(`"${r.opportunityTitle}" → fit ${r.fitScore}/100`);
    } catch (e: any) {
      results.push(`"${p.title}" → error: ${e.message}`);
    }
  }
  return { qualified: pending.length, results };
}
