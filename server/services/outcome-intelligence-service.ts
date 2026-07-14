/**
 * Outcome Intelligence Service
 * Tracks real-world outcomes for every sent AI communication,
 * scores rule effectiveness by outcomes, and powers outcome-weighted
 * learning context injection.
 */

import { db } from "../db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  agentCommunicationOutcomes,
  agentRuleEffectiveness,
  agentMessageLearningRules,
  agentMessageFeedback,
} from "@shared/schema";
import { COMMUNICATION_DOMAINS, DOMAIN_LABELS } from "./message-learning-service";

// ─── Outcome status ordered list ─────────────────────────────────────────────

export const OUTCOME_STATUSES = [
  "sent",
  "opened",
  "replied",
  "meeting_booked",
  "proposal_requested",
  "proposal_sent",
  "proposal_accepted",
  "contract_signed",
  "hired",
  "booked_session",
  "converted",
  "lost",
  "bounced",
  "ignored",
] as const;

export type OutcomeStatus = typeof OUTCOME_STATUSES[number];

// Status → timestamp field mapping
const STATUS_TIMESTAMP_FIELD: Record<string, string> = {
  replied: "repliedAt",
  meeting_booked: "meetingBookedAt",
  proposal_requested: "proposalRequestedAt",
  proposal_sent: "proposalSentAt",
  proposal_accepted: "proposalAcceptedAt",
  contract_signed: "contractSignedAt",
  hired: "hiredAt",
  booked_session: "bookedSessionAt",
  converted: "convertedAt",
  lost: "lostAt",
};

// Outcome "weight" for effectiveness scoring
const OUTCOME_WEIGHTS: Record<string, number> = {
  sent: 0,
  opened: 0.5,
  replied: 1,
  meeting_booked: 3,
  proposal_requested: 2,
  proposal_sent: 2,
  proposal_accepted: 4,
  contract_signed: 5,
  hired: 4,
  booked_session: 3,
  converted: 5,
  lost: -1,
  bounced: -0.5,
  ignored: -0.5,
};

// ─── Create outcome row on send ───────────────────────────────────────────────

export async function createOutcomeOnSend(opts: {
  orgId: string;
  gmailActionId: string;
  feedbackId?: string;
  communicationDomain: string;
  messageType: string;
  recipientEmail?: string;
  recipientName?: string;
  leadId?: string;
  prospectId?: string;
  dealId?: string;
  applicantId?: string;
}): Promise<string> {
  const [row] = await db.insert(agentCommunicationOutcomes).values({
    orgId: opts.orgId,
    gmailActionId: opts.gmailActionId,
    feedbackId: opts.feedbackId ?? null,
    communicationDomain: opts.communicationDomain,
    messageType: opts.messageType ?? null,
    recipientEmail: opts.recipientEmail ?? null,
    recipientName: opts.recipientName ?? null,
    leadId: opts.leadId ?? null,
    prospectId: opts.prospectId ?? null,
    dealId: opts.dealId ?? null,
    applicantId: opts.applicantId ?? null,
    sentAt: new Date(),
    outcomeStatus: "sent",
    outcomeSource: "gmail_reply",
  }).returning();

  // Kevin event wire-in (Phase 3) — non-blocking, fail-open
  void (async () => {
    try {
      const { enqueueKevinEvent } = await import("./kevin-event-service");
      await enqueueKevinEvent({
        orgId: opts.orgId,
        eventType: "te.communication.sent",
        entityType: "gmail_agent_action",
        entityId: opts.gmailActionId,
        idempotencyKey: `te.communication.sent:${opts.orgId}:${opts.gmailActionId}`,
        payload: {
          communicationDomain: opts.communicationDomain,
          messageType: opts.messageType,
          outcomeId: row.id,
        },
        source: "outcome_intelligence",
      });
    } catch {}
  })();

  return row.id;
}

// ─── Manual outcome update ────────────────────────────────────────────────────

export async function updateOutcomeManual(opts: {
  outcomeId: string;
  orgId: string;
  outcomeStatus: OutcomeStatus;
  revenueCents?: number;
}): Promise<void> {
  const updates: Record<string, any> = {
    outcomeStatus: opts.outcomeStatus,
    outcomeSource: "manual_update",
    updatedAt: new Date(),
  };
  if (opts.revenueCents !== undefined) updates.revenueCents = opts.revenueCents;

  // Set the corresponding timestamp field
  const tsField = STATUS_TIMESTAMP_FIELD[opts.outcomeStatus];
  if (tsField) {
    const col = tsField.replace(/([A-Z])/g, "_$1").toLowerCase();
    updates[col] = new Date();
  }

  await db.update(agentCommunicationOutcomes)
    .set(updates)
    .where(and(
      eq(agentCommunicationOutcomes.id, opts.outcomeId),
      eq(agentCommunicationOutcomes.orgId, opts.orgId),
    ));

  // Recalculate effectiveness scores in the background
  recalculateRuleEffectivenessForOrg(opts.orgId).catch(console.error);
}

// ─── Recalculate rule effectiveness for org ───────────────────────────────────

export async function recalculateRuleEffectivenessForOrg(orgId: string): Promise<void> {
  const [rules, outcomes] = await Promise.all([
    db.select().from(agentMessageLearningRules)
      .where(and(
        eq(agentMessageLearningRules.orgId, orgId),
        eq(agentMessageLearningRules.status, "active"),
      )),
    db.select().from(agentCommunicationOutcomes)
      .where(eq(agentCommunicationOutcomes.orgId, orgId)),
  ]);

  for (const rule of rules) {
    const domainOutcomes = outcomes.filter((o) =>
      (o.communicationDomain ?? "athlete_lead") === (rule.communicationDomain ?? "athlete_lead") &&
      (!rule.messageType || o.messageType === rule.messageType),
    );

    const sentCount = domainOutcomes.filter((o) => o.outcomeStatus !== "proposed").length;
    const replyCount = domainOutcomes.filter((o) =>
      ["replied", "meeting_booked", "proposal_requested", "proposal_sent", "proposal_accepted", "contract_signed", "hired", "booked_session", "converted"].includes(o.outcomeStatus ?? ""),
    ).length;
    const meetingCount = domainOutcomes.filter((o) => o.outcomeStatus === "meeting_booked").length;
    const proposalCount = domainOutcomes.filter((o) =>
      ["proposal_requested", "proposal_sent", "proposal_accepted"].includes(o.outcomeStatus ?? ""),
    ).length;
    const conversionCount = domainOutcomes.filter((o) =>
      ["contract_signed", "converted", "proposal_accepted"].includes(o.outcomeStatus ?? ""),
    ).length;
    const hiredCount = domainOutcomes.filter((o) => o.outcomeStatus === "hired").length;
    const lostCount = domainOutcomes.filter((o) =>
      ["lost", "bounced", "ignored"].includes(o.outcomeStatus ?? ""),
    ).length;
    const revenueCents = domainOutcomes.reduce((acc, o) => acc + (o.revenueCents ?? 0), 0);

    // Effectiveness formula: weighted sum / sent
    const weightedSum =
      replyCount * 1 +
      meetingCount * 3 +
      proposalCount * 2 +
      conversionCount * 5 +
      hiredCount * 4 -
      lostCount * 1;
    const effectivenessScore = sentCount > 0 ? weightedSum / sentCount : 0;

    // Upsert
    const existing = await db.select({ id: agentRuleEffectiveness.id })
      .from(agentRuleEffectiveness)
      .where(and(
        eq(agentRuleEffectiveness.orgId, orgId),
        eq(agentRuleEffectiveness.ruleId, rule.id),
      ))
      .limit(1);

    if (existing.length > 0) {
      await db.update(agentRuleEffectiveness)
        .set({ sentCount, replyCount, meetingCount, proposalCount, conversionCount, hiredCount, lostCount, revenueCents, effectivenessScore, lastCalculatedAt: new Date() })
        .where(eq(agentRuleEffectiveness.id, existing[0].id));
    } else {
      await db.insert(agentRuleEffectiveness).values({
        orgId,
        ruleId: rule.id,
        communicationDomain: rule.communicationDomain ?? "athlete_lead",
        messageType: rule.messageType ?? null,
        timesApplied: rule.timesApplied ?? 0,
        sentCount,
        replyCount,
        meetingCount,
        proposalCount,
        conversionCount,
        hiredCount,
        lostCount,
        revenueCents,
        effectivenessScore,
      });
    }
  }
}

// ─── Outcome dashboard data ───────────────────────────────────────────────────

export async function getOutcomeDashboard(orgId: string) {
  const outcomes = await db.select().from(agentCommunicationOutcomes)
    .where(eq(agentCommunicationOutcomes.orgId, orgId))
    .orderBy(desc(agentCommunicationOutcomes.createdAt));

  const ruleEffectiveness = await db.select({
    eff: agentRuleEffectiveness,
    rule: agentMessageLearningRules,
  })
    .from(agentRuleEffectiveness)
    .leftJoin(agentMessageLearningRules, eq(agentRuleEffectiveness.ruleId, agentMessageLearningRules.id))
    .where(eq(agentRuleEffectiveness.orgId, orgId))
    .orderBy(desc(agentRuleEffectiveness.effectivenessScore));

  const total = outcomes.length;
  const replied = outcomes.filter((o) =>
    ["replied", "meeting_booked", "proposal_requested", "proposal_sent", "proposal_accepted", "contract_signed", "hired", "booked_session", "converted"].includes(o.outcomeStatus ?? ""),
  ).length;
  const meetingsBooked = outcomes.filter((o) => o.outcomeStatus === "meeting_booked").length;
  const sessionsBooked = outcomes.filter((o) => o.outcomeStatus === "booked_session").length;
  const proposalsRequested = outcomes.filter((o) =>
    ["proposal_requested", "proposal_sent", "proposal_accepted", "contract_signed"].includes(o.outcomeStatus ?? ""),
  ).length;
  const contractsSigned = outcomes.filter((o) => o.outcomeStatus === "contract_signed").length;
  const hires = outcomes.filter((o) => o.outcomeStatus === "hired").length;
  const revenueCents = outcomes.reduce((acc, o) => acc + (o.revenueCents ?? 0), 0);

  const byDomain = COMMUNICATION_DOMAINS.map((domain) => {
    const dom = outcomes.filter((o) => (o.communicationDomain ?? "athlete_lead") === domain);
    const sent = dom.length;
    const domReplied = dom.filter((o) =>
      ["replied", "meeting_booked", "proposal_requested", "proposal_sent", "proposal_accepted", "contract_signed", "hired", "booked_session", "converted"].includes(o.outcomeStatus ?? ""),
    ).length;
    const domMeetings = dom.filter((o) => o.outcomeStatus === "meeting_booked").length;
    const domConversions = dom.filter((o) => ["contract_signed", "converted", "hired"].includes(o.outcomeStatus ?? "")).length;
    const domRevenue = dom.reduce((acc, o) => acc + (o.revenueCents ?? 0), 0);

    const topWinRules = ruleEffectiveness
      .filter((r) => r.eff.communicationDomain === domain && r.eff.effectivenessScore > 0)
      .slice(0, 3)
      .map((r) => ({ id: r.eff.ruleId, text: r.rule?.ruleText ?? "Unknown rule", score: r.eff.effectivenessScore }));

    const topLoseRules = ruleEffectiveness
      .filter((r) => r.eff.communicationDomain === domain && r.eff.effectivenessScore < 0)
      .slice(0, 3)
      .map((r) => ({ id: r.eff.ruleId, text: r.rule?.ruleText ?? "Unknown rule", score: r.eff.effectivenessScore }));

    return {
      domain,
      label: DOMAIN_LABELS[domain] ?? domain,
      sent,
      replyRate: sent > 0 ? Math.round((domReplied / sent) * 100) : 0,
      meetingRate: sent > 0 ? Math.round((domMeetings / sent) * 100) : 0,
      conversionRate: sent > 0 ? Math.round((domConversions / sent) * 100) : 0,
      revenueCents: domRevenue,
      topWinRules,
      topLoseRules,
    };
  });

  return {
    overall: { total, replied, replyRate: total > 0 ? Math.round((replied / total) * 100) : 0, meetingsBooked, sessionsBooked, proposalsRequested, contractsSigned, hires, revenueCents },
    byDomain,
    recentOutcomes: outcomes.slice(0, 50).map((o) => ({
      id: o.id,
      communicationDomain: o.communicationDomain,
      messageType: o.messageType,
      recipientEmail: o.recipientEmail,
      recipientName: o.recipientName,
      outcomeStatus: o.outcomeStatus,
      sentAt: o.sentAt,
      revenueCents: o.revenueCents,
      gmailActionId: o.gmailActionId,
    })),
  };
}

// ─── Get sent messages with outcome rows ─────────────────────────────────────

export async function getSentMessages(orgId: string, domain?: string) {
  const rows = await db.select().from(agentCommunicationOutcomes)
    .where(eq(agentCommunicationOutcomes.orgId, orgId))
    .orderBy(desc(agentCommunicationOutcomes.createdAt))
    .limit(200);

  if (domain && domain !== "all") {
    return rows.filter((r) => r.communicationDomain === domain);
  }
  return rows;
}

// ─── Get outcome-weighted rules for learning context ─────────────────────────

export async function getOutcomeWeightedRules(
  orgId: string,
  domain: string,
  messageType: string,
): Promise<{ winRules: string[]; loseRules: string[] }> {
  const effectiveness = await db.select({
    eff: agentRuleEffectiveness,
    rule: agentMessageLearningRules,
  })
    .from(agentRuleEffectiveness)
    .leftJoin(agentMessageLearningRules, eq(agentRuleEffectiveness.ruleId, agentMessageLearningRules.id))
    .where(and(
      eq(agentRuleEffectiveness.orgId, orgId),
      eq(agentRuleEffectiveness.communicationDomain, domain),
    ))
    .orderBy(desc(agentRuleEffectiveness.effectivenessScore))
    .limit(20);

  const winRules = effectiveness
    .filter((r) => r.eff.effectivenessScore > 0 && r.rule?.ruleText)
    .slice(0, 5)
    .map((r) => `• ${r.rule!.ruleText} (score: ${r.eff.effectivenessScore.toFixed(2)})`);

  const loseRules = effectiveness
    .filter((r) => r.eff.effectivenessScore < 0 && r.rule?.ruleText)
    .slice(0, 3)
    .map((r) => `• ${r.rule!.ruleText} (avoid — score: ${r.eff.effectivenessScore.toFixed(2)})`);

  return { winRules, loseRules };
}

// ─── Outcome-aware autonomy readiness ─────────────────────────────────────────

export async function getOutcomeAutonomyReadiness(
  orgId: string,
  domain: string,
): Promise<{
  outcomeSentCount: number;
  outcomeReplyCount: number;
  outcomeMeetingCount: number;
  hasPositiveOutcomes: boolean;
  replyRateAboveBaseline: boolean;
  readyForLevel2WithOutcomes: boolean;
  readyForLevel3WithOutcomes: boolean;
}> {
  const outcomes = await db.select().from(agentCommunicationOutcomes)
    .where(and(
      eq(agentCommunicationOutcomes.orgId, orgId),
      eq(agentCommunicationOutcomes.communicationDomain, domain),
    ));

  const sentCount = outcomes.length;
  const replyCount = outcomes.filter((o) =>
    ["replied", "meeting_booked", "proposal_requested", "proposal_sent", "proposal_accepted", "contract_signed", "hired", "booked_session", "converted"].includes(o.outcomeStatus ?? ""),
  ).length;
  const meetingCount = outcomes.filter((o) => o.outcomeStatus === "meeting_booked").length;
  const positiveOutcomes = outcomes.filter((o) =>
    ["meeting_booked", "proposal_accepted", "contract_signed", "hired", "converted", "booked_session"].includes(o.outcomeStatus ?? ""),
  ).length;

  const replyRate = sentCount > 0 ? replyCount / sentCount : 0;
  const hasPositiveOutcomes = positiveOutcomes > 0;
  const replyRateAboveBaseline = replyRate >= 0.05; // 5% baseline

  return {
    outcomeSentCount: sentCount,
    outcomeReplyCount: replyCount,
    outcomeMeetingCount: meetingCount,
    hasPositiveOutcomes,
    replyRateAboveBaseline,
    readyForLevel2WithOutcomes: sentCount >= 5 && (replyRateAboveBaseline || hasPositiveOutcomes),
    readyForLevel3WithOutcomes: sentCount >= 30 && hasPositiveOutcomes && replyRate >= 0.1,
  };
}
