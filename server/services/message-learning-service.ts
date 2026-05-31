/**
 * Message Learning Service
 * Converts human feedback on AI-generated emails into durable rules,
 * and provides learning context for future message generation.
 */

import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { agentMessageFeedback, agentMessageLearningRules, agentMessageRevisions } from "@shared/schema";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    feedback.reviewerNotes;

  if (!hasCoachingInput) return;

  const tags = (feedback.feedbackTags as string[] | null) ?? [];
  const editDiff =
    feedback.editedBody && feedback.originalBody
      ? `Original body:\n${feedback.originalBody}\n\nEdited body:\n${feedback.editedBody}`
      : "";

  const prompt = `You are an AI communication coach analyzing human feedback on an AI-generated email draft. Extract specific, reusable rules that should guide future message generation for this organization.

Message type: ${feedback.messageType ?? "unknown"}
Decision: ${feedback.decision}
${feedback.rejectionReason ? `Rejection reason: ${feedback.rejectionReason}` : ""}
${feedback.coachingFeedbackText ? `Coaching feedback: ${feedback.coachingFeedbackText}` : ""}
${tags.length > 0 ? `Feedback tags: ${tags.join(", ")}` : ""}
${feedback.reviewerNotes ? `Reviewer notes: ${feedback.reviewerNotes}` : ""}
${editDiff ? `\n${editDiff}` : ""}

Analyze this feedback and extract structured rules. Return ONLY valid JSON in this exact format:
{
  "do_rules": ["string", ...],
  "avoid_rules": ["string", ...],
  "tone_preferences": ["string", ...],
  "cta_preferences": ["string", ...],
  "length_preferences": ["string", ...],
  "applies_globally": false,
  "confidence": 0.85
}

Rules should be:
- Specific and actionable (not vague)
- Written as clear instructions for an AI
- Based only on what the feedback explicitly states
- 1-3 rules per category maximum

If a category has no applicable rules, use an empty array.`;

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

  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.75;

  const ruleEntries: Array<{ ruleType: string; ruleText: string }> = [
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
    })),
  );

  // Store extracted rules back on the feedback record for audit
  await db.update(agentMessageFeedback)
    .set({
      extractedDoRules: (parsed.do_rules ?? []) as any,
      extractedAvoidRules: (parsed.avoid_rules ?? []) as any,
      extractedPreferences: {
        tone: parsed.tone_preferences ?? [],
        cta: parsed.cta_preferences ?? [],
        length: parsed.length_preferences ?? [],
      } as any,
    })
    .where(eq(agentMessageFeedback.id, feedbackId));

  console.log(`[message-learning] extracted ${ruleEntries.length} rules from feedback ${feedbackId}`);
}

// ─── Get learning context for message generation ──────────────────────────────

export async function getMessageLearningContext(
  orgId: string,
  messageType: string,
  leadContext?: { sport?: string; leadType?: string; program?: string },
): Promise<string> {
  const rules = await db.select().from(agentMessageLearningRules)
    .where(
      and(
        eq(agentMessageLearningRules.orgId, orgId),
        eq(agentMessageLearningRules.status, "active"),
      )
    )
    .orderBy(desc(agentMessageLearningRules.confidence));

  if (rules.length === 0) return "";

  // Priority: same message_type > same lead_type > global
  const specific = rules.filter((r) => r.messageType === messageType);
  const leadTypeRules = leadContext?.leadType
    ? rules.filter((r) => r.leadType === leadContext.leadType && r.messageType !== messageType)
    : [];
  const global = rules.filter((r) => r.appliesGlobally && r.messageType !== messageType);

  const doRules = [...specific, ...leadTypeRules, ...global]
    .filter((r) => r.ruleType === "do")
    .slice(0, 5)
    .map((r) => `• ${r.ruleText}`);

  const avoidRules = [...specific, ...leadTypeRules, ...global]
    .filter((r) => r.ruleType === "avoid")
    .slice(0, 5)
    .map((r) => `• ${r.ruleText}`);

  const toneRules = [...specific, ...leadTypeRules, ...global]
    .filter((r) => r.ruleType === "tone")
    .slice(0, 3)
    .map((r) => `• ${r.ruleText}`);

  const ctaRules = [...specific, ...leadTypeRules, ...global]
    .filter((r) => r.ruleType === "cta")
    .slice(0, 3)
    .map((r) => `• ${r.ruleText}`);

  const lengthRules = [...specific, ...leadTypeRules, ...global]
    .filter((r) => r.ruleType === "length")
    .slice(0, 2)
    .map((r) => `• ${r.ruleText}`);

  const sections: string[] = ["Follow these learned communication rules for this organization:"];
  if (doRules.length) sections.push(`DO:\n${doRules.join("\n")}`);
  if (avoidRules.length) sections.push(`AVOID:\n${avoidRules.join("\n")}`);
  if (toneRules.length) sections.push(`TONE:\n${toneRules.join("\n")}`);
  if (ctaRules.length) sections.push(`CTA:\n${ctaRules.join("\n")}`);
  if (lengthRules.length) sections.push(`LENGTH:\n${lengthRules.join("\n")}`);

  return sections.join("\n\n");
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
  leadContext?: Record<string, any>;
  userId: string;
}): Promise<{ subject: string; body: string; revisionId: string }> {
  const learningContext = await getMessageLearningContext(opts.orgId, opts.messageType, opts.leadContext);

  const prompt = `You are an AI email drafting assistant. An admin reviewed an AI-generated email and asked for changes.

${learningContext ? learningContext + "\n\n" : ""}Original email subject: ${opts.originalSubject}
Original email body:
${opts.originalBody}

Admin feedback: "${opts.adminFeedback}"

Recipient: ${opts.recipientEmail}
Message type: ${opts.messageType}

Please write a revised version of this email that addresses the admin's feedback exactly. Keep what was good, fix what was flagged.

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

  // Get next revision number
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
  }).returning();

  return { subject: revisedSubject, body: revisedBody, revisionId: rev.id };
}

// ─── Learning dashboard data ───────────────────────────────────────────────────

export async function getLearningDashboard(orgId: string) {
  const [rules, feedback] = await Promise.all([
    db.select().from(agentMessageLearningRules)
      .where(and(eq(agentMessageLearningRules.orgId, orgId), eq(agentMessageLearningRules.status, "active")))
      .orderBy(desc(agentMessageLearningRules.confidence)),
    db.select().from(agentMessageFeedback)
      .where(eq(agentMessageFeedback.orgId, orgId)),
  ]);

  const MESSAGE_TYPES = [
    "intake_outreach", "followup_24h", "followup_72h", "followup_7d",
    "retention", "reactivation", "team_partnership", "scheduling_response", "booking_confirmation",
  ];

  return MESSAGE_TYPES.map((mt) => {
    const mtRules = rules.filter((r) => r.messageType === mt || r.appliesGlobally);
    const mtFeedback = feedback.filter((f) => f.messageType === mt);

    const tags: Record<string, number> = {};
    mtFeedback.forEach((f) => {
      const t = (f.feedbackTags as string[] | null) ?? [];
      t.forEach((tag) => { tags[tag] = (tags[tag] ?? 0) + 1; });
    });

    const topTags = Object.entries(tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));

    const repeatedMistakes = topTags.filter((t) => t.count >= 3);

    return {
      messageType: mt,
      rulesCount: mtRules.length,
      doRules: mtRules.filter((r) => r.ruleType === "do").map((r) => ({ id: r.id, text: r.ruleText, confidence: r.confidence, appliesGlobally: r.appliesGlobally })),
      avoidRules: mtRules.filter((r) => r.ruleType === "avoid").map((r) => ({ id: r.id, text: r.ruleText, confidence: r.confidence, appliesGlobally: r.appliesGlobally })),
      toneRules: mtRules.filter((r) => r.ruleType === "tone").map((r) => ({ id: r.id, text: r.ruleText, confidence: r.confidence })),
      ctaRules: mtRules.filter((r) => r.ruleType === "cta").map((r) => ({ id: r.id, text: r.ruleText, confidence: r.confidence })),
      lengthRules: mtRules.filter((r) => r.ruleType === "length").map((r) => ({ id: r.id, text: r.ruleText, confidence: r.confidence })),
      topRejectionTags: topTags,
      repeatedMistakes,
      reviewedCount: mtFeedback.length,
    };
  });
}
