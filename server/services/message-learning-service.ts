/**
 * Message Learning Service
 * Converts human feedback on AI-generated emails into durable rules,
 * and provides learning context for future message generation.
 * Domain-aware: each communication_domain has its own rule set and context.
 */

import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { agentMessageFeedback, agentMessageLearningRules, agentMessageRevisions } from "@shared/schema";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Domain helpers ────────────────────────────────────────────────────────────

export const COMMUNICATION_DOMAINS = [
  "athlete_lead",
  "parent_lead",
  "team_training",
  "school_partnership",
  "athletic_director",
  "coach_outreach",
  "organization_outreach",
  "business_outreach",
  "employment_opportunity",
  "corporate_wellness",
  "facility_partnership",
  "gym_owner",
] as const;

export type CommunicationDomain = typeof COMMUNICATION_DOMAINS[number];

export const DOMAIN_LABELS: Record<string, string> = {
  athlete_lead: "Athlete Leads",
  parent_lead: "Parent Leads",
  team_training: "Team Training",
  school_partnership: "School Partnerships",
  athletic_director: "Athletic Directors",
  coach_outreach: "Coach Outreach",
  organization_outreach: "Organization Outreach",
  business_outreach: "Business Outreach",
  employment_opportunity: "Employment",
  corporate_wellness: "Corporate Wellness",
  facility_partnership: "Facility Partnerships",
  gym_owner: "Gym Owners",
};

export function inferCommunicationDomain(row: {
  communicationDomain?: string | null;
  dealId?: string | null;
  actionType?: string | null;
}): string {
  if (row.communicationDomain) return row.communicationDomain;
  if (row.dealId) return "team_training";
  const at = row.actionType ?? "";
  if (at.includes("employment")) return "employment_opportunity";
  if (at.includes("partner") || at.includes("school")) return "school_partnership";
  if (at.includes("corporate") || at.includes("wellness")) return "corporate_wellness";
  if (at.includes("coach") || at.includes("director")) return "coach_outreach";
  return "athlete_lead";
}

// ─── Extract learning rules from a feedback record ────────────────────────────

export async function extractMessageLearningFromFeedback(
  orgId: string,
  feedbackId: string,
): Promise<void> {
  const [feedback] = await db.select().from(agentMessageFeedback)
    .where(and(eq(agentMessageFeedback.id, feedbackId), eq(agentMessageFeedback.orgId, orgId)))
    .limit(1);
  if (!feedback) return;

  const hasCoachingInput =
    feedback.coachingFeedbackText ||
    (feedback.feedbackTags && (feedback.feedbackTags as string[]).length > 0) ||
    feedback.rejectionReason ||
    feedback.reviewerNotes ||
    (feedback.editedBody && feedback.originalBody);

  if (!hasCoachingInput) return;

  const domain = (feedback as any).communicationDomain ?? inferCommunicationDomain(feedback as any);
  const tags = (feedback.feedbackTags as string[] | null) ?? [];
  const editDiff =
    feedback.editedBody && feedback.originalBody
      ? `Original body:\n${feedback.originalBody}\n\nEdited body:\n${feedback.editedBody}`
      : "";

  const prompt = `You are an AI communication coach analyzing human feedback on an AI-generated email for a ${DOMAIN_LABELS[domain] ?? domain} context. Extract specific, reusable rules that should guide future message generation.

Message type: ${feedback.messageType ?? "unknown"}
Communication domain: ${domain}
Decision: ${feedback.decision}
${feedback.rejectionReason ? `Rejection reason: ${feedback.rejectionReason}` : ""}
${feedback.coachingFeedbackText ? `Coaching feedback: ${feedback.coachingFeedbackText}` : ""}
${tags.length > 0 ? `Feedback tags: ${tags.join(", ")}` : ""}
${feedback.reviewerNotes ? `Reviewer notes: ${feedback.reviewerNotes}` : ""}
${editDiff ? `\n${editDiff}` : ""}

Extract structured rules. Return ONLY valid JSON:
{
  "do_rules": ["string", ...],
  "avoid_rules": ["string", ...],
  "tone_preferences": ["string", ...],
  "cta_preferences": ["string", ...],
  "length_preferences": ["string", ...],
  "applies_globally": false,
  "confidence": 0.85
}

Rules must be specific, actionable, and written as instructions for an AI. Max 3 per category.`;

  let parsed: any = null;
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
    parsed = JSON.parse(resp.choices[0].message.content ?? "{}");
  } catch (e) {
    console.error("[message-learning] extraction parse error:", e);
    return;
  }

  const isApproval = feedback.decision === "approved" || feedback.decision === "edited_and_approved";
  const rawConfidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.75;
  const confidence = isApproval ? rawConfidence * 0.7 : rawConfidence;
  const ruleEntries = [
    ...((parsed.do_rules ?? []) as string[]).map((r: string) => ({ ruleType: "do", ruleText: r })),
    ...((parsed.avoid_rules ?? []) as string[]).map((r: string) => ({ ruleType: "avoid", ruleText: r })),
    ...((parsed.tone_preferences ?? []) as string[]).map((r: string) => ({ ruleType: "tone", ruleText: r })),
    ...((parsed.cta_preferences ?? []) as string[]).map((r: string) => ({ ruleType: "cta", ruleText: r })),
    ...((parsed.length_preferences ?? []) as string[]).map((r: string) => ({ ruleType: "length", ruleText: r })),
  ].filter((e) => e.ruleText?.trim());

  if (ruleEntries.length === 0) return;

  await db.insert(agentMessageLearningRules).values(
    ruleEntries.map((e) => ({
      orgId,
      sourceFeedbackId: feedbackId,
      ruleType: e.ruleType,
      ruleText: e.ruleText.trim(),
      messageType: feedback.messageType ?? null,
      leadType: feedback.appliestoLeadType ?? null,
      program: feedback.appliestoProgram ?? null,
      appliesGlobally: parsed.applies_globally === true,
      confidence: String(confidence),
      status: "active",
      createdBy: feedback.reviewedBy ?? null,
      communicationDomain: domain,
    })),
  );

  await db.update(agentMessageFeedback)
    .set({
      extractedDoRules: (parsed.do_rules ?? []) as any,
      extractedAvoidRules: (parsed.avoid_rules ?? []) as any,
      extractedPreferences: {
        tone: parsed.tone_preferences ?? [],
        cta: parsed.cta_preferences ?? [],
        length: parsed.length_preferences ?? [],
      } as any,
      appliedToFutureRuns: true,
    })
    .where(eq(agentMessageFeedback.id, feedbackId));

  console.log(`[message-learning] extracted ${ruleEntries.length} rules from feedback ${feedbackId} (domain: ${domain})`);
}

// ─── Get learning context for message generation ──────────────────────────────

// ─── Structured rule type for instrumentation ─────────────────────────────────

export interface AppliedRuleMetadata {
  ruleId: string;
  source: "learned" | "standing_instruction";
  communicationDomain: string;
  ruleType: string;
  ruleText: string;
}

export interface LearningContextWithRules {
  contextText: string;
  rules: AppliedRuleMetadata[];
}

// ─── Core implementation (returns both text + structured rules) ───────────────

export async function getMessageLearningContextWithRules(
  orgId: string,
  messageType: string,
  leadContext?: { sport?: string; leadType?: string; program?: string; domain?: string },
): Promise<LearningContextWithRules> {
  const domain = leadContext?.domain ?? "athlete_lead";

  const [rules, coachingRules] = await Promise.all([
    db.select().from(agentMessageLearningRules)
      .where(and(eq(agentMessageLearningRules.orgId, orgId), eq(agentMessageLearningRules.status, "active")))
      .orderBy(desc(agentMessageLearningRules.confidence)),
    (async () => {
      try {
        const { agentDraftCoachingRules } = await import("@shared/schema");
        return await db.select().from(agentDraftCoachingRules)
          .where(and(eq(agentDraftCoachingRules.orgId, orgId), eq(agentDraftCoachingRules.isActive, true)))
          .orderBy(agentDraftCoachingRules.createdAt);
      } catch {
        return [];
      }
    })(),
  ]);

  // ── Coach-authored standing instructions (highest priority) ──────────────
  // Domain-specific first, then general
  const standingInstructions = [
    ...coachingRules.filter((r) => r.communicationDomain === domain),
    ...coachingRules.filter((r) => r.communicationDomain === "general"),
  ].slice(0, 8);

  const hasLearnedRules = rules.length > 0;
  const hasStanding = standingInstructions.length > 0;

  if (!hasLearnedRules && !hasStanding) return { contextText: "", rules: [] };

  // ── Learned rules (priority: same domain+type > same domain > global) ────
  const specific = rules.filter((r) => r.messageType === messageType && (r.communicationDomain === domain || !r.communicationDomain));
  const domainRules = rules.filter((r) => r.communicationDomain === domain && r.messageType !== messageType);
  const global = rules.filter((r) => r.appliesGlobally);
  const candidatePool = [...specific, ...domainRules, ...global];

  // Track which learned rules are actually included
  const includedLearnedRuleIds = new Set<string>();
  const pick = (type: string, limit: number) => {
    const selected = candidatePool.filter((r) => r.ruleType === type).slice(0, limit);
    selected.forEach((r) => includedLearnedRuleIds.add(r.id));
    return selected.map((r) => `• ${r.ruleText}`);
  };

  const doRules = pick("do", 5);
  const avoidRules = pick("avoid", 5);
  const toneRules = pick("tone", 3);
  const ctaRules = pick("cta", 3);
  const lengthRules = pick("length", 2);

  const sections: string[] = ["Follow these communication rules for this organization:"];

  // Standing instructions come first — they are coach-owned and highest priority
  if (hasStanding) {
    const instructionLines = standingInstructions.map((r) => {
      const prefix = r.ruleType !== "instruction" ? `[${r.ruleType.toUpperCase()}] ` : "";
      return `• ${prefix}${r.ruleText}`;
    });
    sections.push(`STANDING INSTRUCTIONS (coach-authored — follow exactly):\n${instructionLines.join("\n")}`);
  }

  // Learned rules follow
  if (doRules.length) sections.push(`DO:\n${doRules.join("\n")}`);
  if (avoidRules.length) sections.push(`AVOID:\n${avoidRules.join("\n")}`);
  if (toneRules.length) sections.push(`TONE:\n${toneRules.join("\n")}`);
  if (ctaRules.length) sections.push(`CTA:\n${ctaRules.join("\n")}`);
  if (lengthRules.length) sections.push(`LENGTH:\n${lengthRules.join("\n")}`);

  // Outcome-weighted rules: inject patterns that produce real business results
  try {
    const { getOutcomeWeightedRules } = await import("./outcome-intelligence-service");
    const { winRules, loseRules } = await getOutcomeWeightedRules(orgId, domain, messageType);
    if (winRules.length) sections.push(`OUTCOME-WINNING PATTERNS (these patterns produce replies, meetings, and revenue — prioritize them):\n${winRules.join("\n")}`);
    if (loseRules.length) sections.push(`OUTCOME-LOSING PATTERNS (these patterns are associated with no-response or lost deals — avoid them):\n${loseRules.join("\n")}`);
  } catch {
    // outcome service not yet populated — skip
  }

  const contextText = sections.join("\n\n");

  // Build structured rules metadata
  const appliedRules: AppliedRuleMetadata[] = [
    // Standing instructions first
    ...standingInstructions.map((r) => ({
      ruleId: r.id,
      source: "standing_instruction" as const,
      communicationDomain: r.communicationDomain ?? domain,
      ruleType: r.ruleType ?? "instruction",
      ruleText: r.ruleText,
    })),
    // Included learned rules
    ...candidatePool
      .filter((r) => includedLearnedRuleIds.has(r.id))
      .map((r) => ({
        ruleId: r.id,
        source: "learned" as const,
        communicationDomain: r.communicationDomain ?? domain,
        ruleType: r.ruleType ?? "do",
        ruleText: r.ruleText,
      })),
  ];

  return { contextText, rules: appliedRules };
}

// ─── Backward-compatible wrapper (existing callers unchanged) ─────────────────

export async function getMessageLearningContext(
  orgId: string,
  messageType: string,
  leadContext?: { sport?: string; leadType?: string; program?: string; domain?: string },
): Promise<string> {
  const { contextText } = await getMessageLearningContextWithRules(orgId, messageType, leadContext);
  return contextText;
}

// ─── Regenerate a draft with admin feedback ────────────────────────────────────

export async function regenerateDraftWithFeedback(opts: {
  orgId: string;
  proposalId: string;
  originalSubject: string;
  originalBody: string;
  adminFeedback: string;
  messageType: string;
  recipientEmail: string;
  domain?: string;
  leadContext?: Record<string, any>;
  userId: string;
}): Promise<{ subject: string; body: string; revisionId: string }> {
  const { contextText: learningContext, rules: _regenAppliedRules } = await getMessageLearningContextWithRules(
    opts.orgId,
    opts.messageType,
    { domain: opts.domain ?? "athlete_lead", ...opts.leadContext },
  );

  const prompt = `You are an AI email drafting assistant for a ${DOMAIN_LABELS[opts.domain ?? "athlete_lead"] ?? opts.domain} outreach. An admin reviewed an AI-generated email and asked for changes.

${learningContext ? learningContext + "\n\n" : ""}Original email subject: ${opts.originalSubject}
Original email body:
${opts.originalBody}

Admin feedback: "${opts.adminFeedback}"

Recipient: ${opts.recipientEmail}
Message type: ${opts.messageType}

Write a revised version that addresses the admin's feedback exactly. Keep what was good, fix what was flagged.

Return ONLY valid JSON: { "subject": "...", "body": "..." }`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(resp.choices[0].message.content ?? "{}");
  const revisedSubject = parsed.subject ?? opts.originalSubject;
  const revisedBody = parsed.body ?? opts.originalBody;

  const existing = await db.select({ n: agentMessageRevisions.revisionNumber })
    .from(agentMessageRevisions)
    .where(eq(agentMessageRevisions.proposalId, opts.proposalId))
    .orderBy(desc(agentMessageRevisions.revisionNumber))
    .limit(1);
  const nextNum = existing.length > 0 ? (existing[0].n ?? 0) + 1 : 1;

  const [rev] = await db.insert(agentMessageRevisions).values({
    proposalId: opts.proposalId,
    orgId: opts.orgId,
    revisionNumber: nextNum,
    originalSubject: opts.originalSubject,
    originalBody: opts.originalBody,
    revisedSubject,
    revisedBody,
    feedbackUsed: opts.adminFeedback,
    createdBy: opts.userId,
    communicationDomain: opts.domain ?? "athlete_lead",
  }).returning();

  // Record which rules were applied to the regenerated draft — non-blocking
  // proposalId references the original gmail_agent_actions row
  if (_regenAppliedRules.length > 0) {
    import("./agentmail-analytics-service").then(({ recordAgentMailRuleApplications }) =>
      recordAgentMailRuleApplications({
        orgId: opts.orgId,
        actionId: opts.proposalId,
        communicationDomain: opts.domain ?? "athlete_lead",
        rules: _regenAppliedRules,
      })
    ).catch(() => {});
  }

  return { subject: revisedSubject, body: revisedBody, revisionId: rev.id };
}

// ─── Learning dashboard — grouped by domain ────────────────────────────────────

export async function getLearningDashboard(orgId: string) {
  const { gmailAgentActions } = await import("@shared/schema");
  const [rules, feedback, pendingActions] = await Promise.all([
    db.select().from(agentMessageLearningRules)
      .where(and(eq(agentMessageLearningRules.orgId, orgId), eq(agentMessageLearningRules.status, "active")))
      .orderBy(desc(agentMessageLearningRules.confidence)),
    db.select().from(agentMessageFeedback)
      .where(eq(agentMessageFeedback.orgId, orgId)),
    db.select({ communicationDomain: gmailAgentActions.communicationDomain, result: gmailAgentActions.result })
      .from(gmailAgentActions)
      .where(eq(gmailAgentActions.orgId, orgId))
      .catch(() => [] as any[]),
  ]);

  return COMMUNICATION_DOMAINS.map((domain) => {
    const domainRules = rules.filter((r) => (r.communicationDomain ?? "athlete_lead") === domain || r.appliesGlobally);
    const domainFeedback = feedback.filter((f) => ((f as any).communicationDomain ?? "athlete_lead") === domain);
    const domainActions = (pendingActions as any[]).filter((a) => (a.communicationDomain ?? "athlete_lead") === domain);
    const autoEligibleCount = domainActions.filter((a) => {
      const res = (a.result && typeof a.result === "object") ? a.result : {};
      return (res as any).autoExecuteEligible === true;
    }).length;
    const autoEligibleRate = domainActions.length > 0 ? Math.round((autoEligibleCount / domainActions.length) * 100) : null;

    const tags: Record<string, number> = {};
    domainFeedback.forEach((f) => {
      const t = (f.feedbackTags as string[] | null) ?? [];
      t.forEach((tag) => { tags[tag] = (tags[tag] ?? 0) + 1; });
    });

    const topTags = Object.entries(tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));

    const repeatedMistakes = topTags.filter((t) => t.count >= 3);

    // Outcome summary
    const outcomes = { approved: 0, rejected: 0, edited: 0, sent: 0, replied: 0 };
    domainFeedback.forEach((f) => {
      if (f.decision === "approved") outcomes.approved++;
      else if (f.decision === "edited_and_approved") outcomes.edited++;
      else if (f.decision === "rejected") outcomes.rejected++;
      if (f.outcome === "sent") outcomes.sent++;
      if (f.outcome === "replied") outcomes.replied++;
    });

    return {
      domain,
      label: DOMAIN_LABELS[domain] ?? domain,
      rulesCount: domainRules.length,
      reviewedCount: domainFeedback.length,
      autoEligibleCount,
      autoEligibleRate,
      totalDrafts: domainActions.length,
      doRules: domainRules.filter((r) => r.ruleType === "do").map((r) => ({ id: r.id, text: r.ruleText, confidence: r.confidence, appliesGlobally: r.appliesGlobally, messageType: r.messageType })),
      avoidRules: domainRules.filter((r) => r.ruleType === "avoid").map((r) => ({ id: r.id, text: r.ruleText, confidence: r.confidence, appliesGlobally: r.appliesGlobally, messageType: r.messageType })),
      toneRules: domainRules.filter((r) => r.ruleType === "tone").map((r) => ({ id: r.id, text: r.ruleText, confidence: r.confidence })),
      ctaRules: domainRules.filter((r) => r.ruleType === "cta").map((r) => ({ id: r.id, text: r.ruleText, confidence: r.confidence })),
      lengthRules: domainRules.filter((r) => r.ruleType === "length").map((r) => ({ id: r.id, text: r.ruleText, confidence: r.confidence })),
      topRejectionTags: topTags,
      repeatedMistakes,
      outcomes,
    };
  });
}
