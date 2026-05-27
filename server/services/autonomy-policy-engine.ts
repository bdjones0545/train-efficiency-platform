/**
 * Autonomy Policy Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates whether an agent action can auto-execute based on:
 *  - Org automation settings
 *  - Confidence thresholds
 *  - Risk classification
 *  - Suppression / unsubscribe status
 *  - Daily rate caps
 *  - Allowed send window
 *  - Sensitive language detection
 *  - Duplicate action prevention
 *
 * Returns: auto_execute | approval_required | blocked
 * Logs every decision to agent_autonomy_decisions.
 */

import { db } from "../db";
import {
  gmailAgentActions,
  leadIntelligenceProfiles,
  agentAutonomyDecisions,
  orgAutomationSettings,
  orgAiGovernanceSettings,
} from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export const POLICY_VERSION = "1.0.0";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PolicyInput {
  orgId: string;
  actionId?: string;
  leadId?: string;
  dealId?: string;
  actionType: string;
  recipientEmail?: string;
  confidence: number;
  riskLevel: "low" | "medium" | "high";
  bodyText?: string;
  isFirstContact?: boolean;
  isNewRecipient?: boolean;
  submissionId?: string;
}

export interface PolicyDecision {
  decision: "auto_execute" | "approval_required" | "blocked";
  reasons: string[];
  confidence: number;
  riskLevel: "low" | "medium" | "high";
  policyVersion: string;
  evaluatedAt: Date;
  decisionId?: string;
}

export type OrgAutomationSettingsRow = {
  autoSendFirstResponse: boolean;
  autoSendLowRiskFollowUps: boolean;
  autoSendBookingConfirmation: boolean;
  autoOfferSchedulingSlots: boolean;
  autoBookConfirmedSlots: boolean;
  minAutoSendConfidence: number;
  minAutoBookingConfidence: number;
  dailyEmailCap: number;
  dailyBookingCap: number;
  allowedSendWindowStart: string;
  allowedSendWindowEnd: string;
  requireApprovalForFirstContact: boolean;
  requireApprovalForNewRecipients: boolean;
  notifyCoachOnAutoAction: boolean;
  policyVersion: string;
};

// ─── Sensitive Language Guard ───────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /\brefund\b/i,
  /\binvoice\b/i,
  /\bpayment\b/i,
  /\bbilling\b/i,
  /\bcharge\b/i,
  /\blegal\b/i,
  /\blawsuit\b/i,
  /\battorney\b/i,
  /\bmedical\b/i,
  /\bdiagnos/i,
  /\binjury\b/i,
  /\bhospital\b/i,
  /\bterminat/i,
  /\bcancell?ation\b/i,
  /\bcontract\b/i,
];

function detectsSensitiveLanguage(text: string): string[] {
  const hits: string[] = [];
  for (const pat of SENSITIVE_PATTERNS) {
    const m = text.match(pat);
    if (m) hits.push(m[0].toLowerCase());
  }
  return hits;
}

// ─── Send Window Check ──────────────────────────────────────────────────────

function isWithinSendWindow(start: string, end: string, tz = "America/New_York"): boolean {
  try {
    const now = new Date();
    const fmt = (d: Date) =>
      d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: tz });
    const current = fmt(now);
    return current >= start && current <= end;
  } catch {
    return true;
  }
}

// ─── Daily Cap Check ────────────────────────────────────────────────────────

async function getDailyEmailCount(orgId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentAutonomyDecisions)
    .where(
      and(
        eq(agentAutonomyDecisions.orgId, orgId),
        gte(agentAutonomyDecisions.createdAt, startOfDay),
        sql`${agentAutonomyDecisions.decision} = 'auto_execute'`,
        sql`${agentAutonomyDecisions.actionType} ILIKE '%email%' OR ${agentAutonomyDecisions.actionType} ILIKE '%draft%' OR ${agentAutonomyDecisions.actionType} ILIKE '%response%' OR ${agentAutonomyDecisions.actionType} ILIKE '%follow%'`
      )
    );
  return row?.count ?? 0;
}

async function getDailyBookingCount(orgId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentAutonomyDecisions)
    .where(
      and(
        eq(agentAutonomyDecisions.orgId, orgId),
        gte(agentAutonomyDecisions.createdAt, startOfDay),
        sql`${agentAutonomyDecisions.decision} = 'auto_execute'`,
        sql`${agentAutonomyDecisions.actionType} ILIKE '%booking%' OR ${agentAutonomyDecisions.actionType} ILIKE '%book%'`
      )
    );
  return row?.count ?? 0;
}

// ─── Duplicate Check ────────────────────────────────────────────────────────

async function hasDuplicatePendingAction(orgId: string, actionType: string, recipientEmail?: string): Promise<boolean> {
  if (!recipientEmail) return false;
  const recent = new Date(Date.now() - 60 * 60 * 1000); // last 1h
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gmailAgentActions)
    .where(
      and(
        eq(gmailAgentActions.orgId, orgId),
        sql`${gmailAgentActions.recipientEmail} = ${recipientEmail}`,
        sql`${gmailAgentActions.status} IN ('auto_executed', 'executed')`,
        gte(gmailAgentActions.executedAt as any, recent)
      )
    );
  return (row?.count ?? 0) > 0;
}

// ─── Suppression Check ─────────────────────────────────────────────────────

async function isLeadSuppressed(orgId: string, submissionId?: string, email?: string): Promise<{ suppressed: boolean; reason: string }> {
  if (!submissionId && !email) return { suppressed: false, reason: "" };
  try {
    const conditions = submissionId
      ? [eq(leadIntelligenceProfiles.orgId, orgId), eq(leadIntelligenceProfiles.submissionId, submissionId)]
      : [eq(leadIntelligenceProfiles.orgId, orgId)];
    const rows = await db.select({
      suppressed: leadIntelligenceProfiles.suppressed,
      unsubscribed: leadIntelligenceProfiles.unsubscribed,
    })
    .from(leadIntelligenceProfiles)
    .where(and(...conditions))
    .limit(1);
    if (!rows.length) return { suppressed: false, reason: "" };
    if (rows[0].suppressed) return { suppressed: true, reason: "Lead is suppressed" };
    if (rows[0].unsubscribed) return { suppressed: true, reason: "Lead has unsubscribed" };
    return { suppressed: false, reason: "" };
  } catch {
    return { suppressed: false, reason: "" };
  }
}

// ─── Load Org Settings ─────────────────────────────────────────────────────

export async function getOrCreateOrgAutomationSettings(orgId: string): Promise<OrgAutomationSettingsRow> {
  const [existing] = await db
    .select()
    .from(orgAutomationSettings)
    .where(eq(orgAutomationSettings.orgId, orgId))
    .limit(1);

  if (existing) return existing as OrgAutomationSettingsRow;

  // Create safe defaults
  const [created] = await db
    .insert(orgAutomationSettings)
    .values({
      orgId,
      autoSendFirstResponse: false,
      autoSendLowRiskFollowUps: false,
      autoSendBookingConfirmation: false,
      autoOfferSchedulingSlots: false,
      autoBookConfirmedSlots: false,
      minAutoSendConfidence: 0.85,
      minAutoBookingConfidence: 0.90,
      dailyEmailCap: 20,
      dailyBookingCap: 10,
      allowedSendWindowStart: "08:00",
      allowedSendWindowEnd: "20:00",
      requireApprovalForFirstContact: true,
      requireApprovalForNewRecipients: true,
      notifyCoachOnAutoAction: true,
      policyVersion: POLICY_VERSION,
    })
    .returning();

  return created as OrgAutomationSettingsRow;
}

// ─── Determine Action Category ─────────────────────────────────────────────

function categorizeAction(actionType: string): "first_response" | "follow_up" | "scheduling_offer" | "booking" | "booking_confirmation" | "other" {
  const t = actionType.toLowerCase();
  if (t.includes("intake_outreach") || t.includes("first_response") || t.includes("first_contact")) return "first_response";
  if (t.includes("follow_up") || t.includes("followup") || t.includes("recovery")) return "follow_up";
  if (t.includes("scheduling_response") || t.includes("slot") || t.includes("schedule_offer")) return "scheduling_offer";
  if (t.includes("booking_confirmation") || t.includes("booking_confirm")) return "booking_confirmation";
  if (t.includes("book") || t.includes("booking")) return "booking";
  return "other";
}

// ─── MAIN POLICY EVALUATOR ─────────────────────────────────────────────────

export async function evaluatePolicy(input: PolicyInput): Promise<PolicyDecision> {
  const reasons: string[] = [];
  let decision: "auto_execute" | "approval_required" | "blocked" = "approval_required";

  try {
    const settings = await getOrCreateOrgAutomationSettings(input.orgId);

    // ── 1. Emergency pause check (governance settings) ──────────────────────
    const [governance] = await db
      .select({ emergencyPauseEnabled: orgAiGovernanceSettings.emergencyPauseEnabled, emergencyPauseReason: orgAiGovernanceSettings.emergencyPauseReason })
      .from(orgAiGovernanceSettings)
      .where(eq(orgAiGovernanceSettings.orgId, input.orgId))
      .limit(1);

    if (governance?.emergencyPauseEnabled) {
      return logDecision(input, {
        decision: "blocked",
        reasons: [`Emergency pause active: ${governance.emergencyPauseReason || "no reason given"}`],
        confidence: input.confidence,
        riskLevel: input.riskLevel,
        policyVersion: settings.policyVersion,
        evaluatedAt: new Date(),
      }, settings);
    }

    // ── 2. Suppression / unsubscribe check ──────────────────────────────────
    const { suppressed, reason: suppressReason } = await isLeadSuppressed(
      input.orgId,
      input.submissionId,
      input.recipientEmail
    );
    if (suppressed) {
      return logDecision(input, {
        decision: "blocked",
        reasons: [suppressReason],
        confidence: input.confidence,
        riskLevel: input.riskLevel,
        policyVersion: settings.policyVersion,
        evaluatedAt: new Date(),
      }, settings);
    }

    // ── 3. Sensitive language check ─────────────────────────────────────────
    if (input.bodyText) {
      const hits = detectsSensitiveLanguage(input.bodyText);
      if (hits.length > 0) {
        return logDecision(input, {
          decision: "blocked",
          reasons: [`Sensitive language detected: ${hits.join(", ")}`],
          confidence: input.confidence,
          riskLevel: input.riskLevel,
          policyVersion: settings.policyVersion,
          evaluatedAt: new Date(),
        }, settings);
      }
    }

    // ── 4. Risk level check ─────────────────────────────────────────────────
    if (input.riskLevel === "high") {
      reasons.push("High risk level — requires human review");
      decision = "approval_required";
      return logDecision(input, { decision, reasons, confidence: input.confidence, riskLevel: input.riskLevel, policyVersion: settings.policyVersion, evaluatedAt: new Date() }, settings);
    }

    // ── 5. Determine action category and check setting ──────────────────────
    const category = categorizeAction(input.actionType);
    let settingEnabled = false;
    let minConfidence = settings.minAutoSendConfidence;

    switch (category) {
      case "first_response":
        settingEnabled = settings.autoSendFirstResponse;
        minConfidence = settings.minAutoSendConfidence;
        break;
      case "follow_up":
        settingEnabled = settings.autoSendLowRiskFollowUps;
        minConfidence = settings.minAutoSendConfidence;
        break;
      case "scheduling_offer":
        settingEnabled = settings.autoOfferSchedulingSlots;
        minConfidence = settings.minAutoSendConfidence;
        break;
      case "booking":
        settingEnabled = settings.autoBookConfirmedSlots;
        minConfidence = settings.minAutoBookingConfidence;
        break;
      case "booking_confirmation":
        settingEnabled = settings.autoSendBookingConfirmation;
        minConfidence = settings.minAutoSendConfidence;
        break;
      default:
        settingEnabled = false;
    }

    if (!settingEnabled) {
      reasons.push(`Auto-execute disabled for action type: ${category}`);
      return logDecision(input, { decision: "approval_required", reasons, confidence: input.confidence, riskLevel: input.riskLevel, policyVersion: settings.policyVersion, evaluatedAt: new Date() }, settings);
    }

    // ── 6. Confidence threshold ─────────────────────────────────────────────
    if (input.confidence < minConfidence) {
      reasons.push(`Confidence ${(input.confidence * 100).toFixed(0)}% is below threshold ${(minConfidence * 100).toFixed(0)}%`);
      return logDecision(input, { decision: "approval_required", reasons, confidence: input.confidence, riskLevel: input.riskLevel, policyVersion: settings.policyVersion, evaluatedAt: new Date() }, settings);
    }

    // ── 7. First contact approval requirement ───────────────────────────────
    if (input.isFirstContact && settings.requireApprovalForFirstContact) {
      reasons.push("First contact requires approval (org policy)");
      return logDecision(input, { decision: "approval_required", reasons, confidence: input.confidence, riskLevel: input.riskLevel, policyVersion: settings.policyVersion, evaluatedAt: new Date() }, settings);
    }

    // ── 8. New recipient approval requirement ───────────────────────────────
    if (input.isNewRecipient && settings.requireApprovalForNewRecipients) {
      reasons.push("New recipient requires approval (org policy)");
      return logDecision(input, { decision: "approval_required", reasons, confidence: input.confidence, riskLevel: input.riskLevel, policyVersion: settings.policyVersion, evaluatedAt: new Date() }, settings);
    }

    // ── 9. Send window check ────────────────────────────────────────────────
    if (!isWithinSendWindow(settings.allowedSendWindowStart, settings.allowedSendWindowEnd)) {
      reasons.push(`Outside allowed send window (${settings.allowedSendWindowStart}–${settings.allowedSendWindowEnd})`);
      return logDecision(input, { decision: "approval_required", reasons, confidence: input.confidence, riskLevel: input.riskLevel, policyVersion: settings.policyVersion, evaluatedAt: new Date() }, settings);
    }

    // ── 10. Daily cap check ─────────────────────────────────────────────────
    if (category === "booking") {
      const bookingCount = await getDailyBookingCount(input.orgId);
      if (bookingCount >= settings.dailyBookingCap) {
        reasons.push(`Daily booking cap reached (${bookingCount}/${settings.dailyBookingCap})`);
        return logDecision(input, { decision: "approval_required", reasons, confidence: input.confidence, riskLevel: input.riskLevel, policyVersion: settings.policyVersion, evaluatedAt: new Date() }, settings);
      }
    } else {
      const emailCount = await getDailyEmailCount(input.orgId);
      if (emailCount >= settings.dailyEmailCap) {
        reasons.push(`Daily email cap reached (${emailCount}/${settings.dailyEmailCap})`);
        return logDecision(input, { decision: "approval_required", reasons, confidence: input.confidence, riskLevel: input.riskLevel, policyVersion: settings.policyVersion, evaluatedAt: new Date() }, settings);
      }
    }

    // ── 11. Duplicate check ─────────────────────────────────────────────────
    if (input.recipientEmail) {
      const isDuplicate = await hasDuplicatePendingAction(input.orgId, input.actionType, input.recipientEmail);
      if (isDuplicate) {
        reasons.push("Duplicate action detected within the last hour");
        return logDecision(input, { decision: "approval_required", reasons, confidence: input.confidence, riskLevel: input.riskLevel, policyVersion: settings.policyVersion, evaluatedAt: new Date() }, settings);
      }
    }

    // ── All checks passed → auto_execute ───────────────────────────────────
    reasons.push(`All policy checks passed (confidence: ${(input.confidence * 100).toFixed(0)}%, risk: ${input.riskLevel})`);
    return logDecision(input, {
      decision: "auto_execute",
      reasons,
      confidence: input.confidence,
      riskLevel: input.riskLevel,
      policyVersion: settings.policyVersion,
      evaluatedAt: new Date(),
    }, settings);

  } catch (err: any) {
    return logDecision(input, {
      decision: "approval_required",
      reasons: [`Policy engine error: ${err.message}`],
      confidence: input.confidence,
      riskLevel: input.riskLevel,
      policyVersion: POLICY_VERSION,
      evaluatedAt: new Date(),
    }, null);
  }
}

// ─── Decision Logger ────────────────────────────────────────────────────────

async function logDecision(
  input: PolicyInput,
  decision: PolicyDecision,
  settings: OrgAutomationSettingsRow | null
): Promise<PolicyDecision> {
  try {
    const [logged] = await db
      .insert(agentAutonomyDecisions)
      .values({
        orgId: input.orgId,
        actionId: input.actionId,
        leadId: input.leadId,
        dealId: input.dealId,
        actionType: input.actionType,
        decision: decision.decision,
        reasons: decision.reasons as any,
        confidence: decision.confidence,
        riskLevel: decision.riskLevel,
        policyVersion: decision.policyVersion,
        settingsSnapshot: settings as any,
      })
      .returning({ id: agentAutonomyDecisions.id });

    return { ...decision, decisionId: logged?.id };
  } catch {
    return decision;
  }
}

// ─── Bulk Fetch Helper (for UI display) ────────────────────────────────────

export async function getDecisionsForAction(actionId: string) {
  return db
    .select()
    .from(agentAutonomyDecisions)
    .where(eq(agentAutonomyDecisions.actionId, actionId))
    .orderBy(agentAutonomyDecisions.createdAt);
}

export async function getRecentDecisions(orgId: string, limit = 50) {
  return db
    .select()
    .from(agentAutonomyDecisions)
    .where(eq(agentAutonomyDecisions.orgId, orgId))
    .orderBy(sql`${agentAutonomyDecisions.createdAt} DESC`)
    .limit(limit);
}
