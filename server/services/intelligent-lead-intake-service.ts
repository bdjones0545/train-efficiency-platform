/**
 * Intelligent Lead Intake Service — Hardened v2
 *
 * Hardening changes:
 *  - AI summary + outreach draft run concurrently (Promise.all) for ~3–4s pipeline time
 *  - Final processing log written after ALL steps complete (profile upsert, Gmail queue, follow-up)
 *  - Stage transitions recorded with full audit metadata
 *  - Suppression helpers exported for use by reply classifier
 */

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawIntakeData {
  submissionId: string;
  orgId: string;
  programId: string;
  programName: string;
  orgName: string;
  athleteName: string;
  parentName?: string | null;
  email: string;
  phone?: string | null;
  age?: string | null;
  grade?: string | null;
  sport?: string | null;
  position?: string | null;
  school?: string | null;
  goals?: string[];
  experienceLevel?: string | null;
  currentTrainingStatus?: string | null;
  commitmentLevel?: string | null;
  notes?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  landingPageId?: string | null;
  submittedAt: Date;
}

export interface NormalizedIntakeProfile {
  athleteName: string;
  parentName: string | null;
  email: string;
  phone: string | null;
  age: number | null;
  grade: string | null;
  sport: string | null;
  position: string | null;
  school: string | null;
  goals: string[];
  commitmentLevel: string | null;
  injuryHistory: string | null;
  availability: string | null;
  experienceLevel: string | null;
  campaignSource: string | null;
  campaignMedium: string | null;
  campaignName: string | null;
  landingPageId: string | null;
  programId: string;
  submittedAt: string;
  aiSummary: string | null;
  leadScore: number;
  temperature: "hot" | "warm" | "cold";
  urgency: "high" | "medium" | "low";
  tags: string[];
}

export interface ScoringResult {
  leadScore: number;
  temperature: "hot" | "warm" | "cold";
  urgency: "high" | "medium" | "low";
  tags: string[];
  scoreBreakdown: Record<string, number>;
}

export interface StageTransition {
  fromStage: string;
  toStage: string;
  reason: string;
  source: "intake_pipeline" | "gmail_reply_classifier" | "recovery_cron" | "manual_admin" | "scheduling_system" | "payment_system";
  confidence: number;
  timestamp: string;
}

export interface IntakeProcessingResult {
  profileId: string;
  normalizedProfile: NormalizedIntakeProfile;
  scoring: ScoringResult;
  aiSummary: string;
  suggestedNextAction: string;
  suggestedNextActionReason: string;
  draftSubject: string;
  draftBody: string;
  gmailDraftActionId: string | null;
  processingLog: ProcessingLogEntry[];
  processingDurationMs: number;
}

export interface ProcessingLogEntry {
  step: string;
  status: "ok" | "error" | "skipped";
  detail?: string;
  timestamp: string;
}

// ─── Heuristic Scoring ───────────────────────────────────────────────────────

function scoreLeadHeuristic(data: RawIntakeData): ScoringResult {
  const breakdown: Record<string, number> = {};
  let score = 0;

  const commitMap: Record<string, number> = {
    high: 25, "very high": 25, dedicated: 22, serious: 20,
    medium: 12, moderate: 12, casual: 6, low: 3,
  };
  const commitKey = (data.commitmentLevel || "").toLowerCase();
  const commitScore = commitMap[commitKey] ?? 8;
  breakdown.commitment = commitScore;
  score += commitScore;

  const goalCount = (data.goals || []).length;
  const goalScore = Math.min(goalCount * 5, 15);
  breakdown.goals = goalScore;
  score += goalScore;

  let contactScore = 0;
  if (data.email) contactScore += 5;
  if (data.phone) contactScore += 5;
  if (data.school) contactScore += 3;
  if (data.age) contactScore += 2;
  breakdown.contactCompleteness = contactScore;
  score += contactScore;

  const expMap: Record<string, number> = {
    "elite": 15, "advanced": 13, "varsity": 12, "competitive": 11,
    "intermediate": 8, "beginner": 5, "none": 2,
  };
  const expKey = (data.experienceLevel || "").toLowerCase();
  const expScore = expMap[expKey] ?? 6;
  breakdown.experience = expScore;
  score += expScore;

  const sportScore = data.sport ? (data.position ? 10 : 7) : 3;
  breakdown.sport = sportScore;
  score += sportScore;

  const utmScore = data.utmSource ? 8 : (data.utmCampaign ? 6 : 0);
  breakdown.attribution = utmScore;
  score += utmScore;

  const ageNum = parseInt(data.age || "0", 10);
  let ageScore = 5;
  if (ageNum >= 14 && ageNum <= 22) ageScore = 10;
  else if (ageNum >= 10 && ageNum <= 13) ageScore = 7;
  else if (ageNum > 22 && ageNum <= 30) ageScore = 8;
  breakdown.age = ageScore;
  score += ageScore;

  const finalScore = Math.min(Math.max(Math.round(score), 1), 100);
  const temperature: "hot" | "warm" | "cold" =
    finalScore >= 70 ? "hot" : finalScore >= 45 ? "warm" : "cold";
  const urgency: "high" | "medium" | "low" =
    commitKey.includes("high") || commitKey.includes("dedicated") || commitKey.includes("serious")
      ? "high"
      : finalScore >= 60 ? "medium" : "low";

  const tags: string[] = [];
  if (data.sport) tags.push(data.sport.toLowerCase().replace(/\s+/g, "_"));
  if (temperature === "hot") tags.push("high_intent");
  if (data.utmSource) tags.push(`source_${data.utmSource.toLowerCase().replace(/\s+/g, "_")}`);
  if (data.parentName) tags.push("parent_involved");
  if (data.phone) tags.push("phone_provided");
  if (goalCount >= 2) tags.push("goal_oriented");

  return { leadScore: finalScore, temperature, urgency, tags, scoreBreakdown: breakdown };
}

// ─── AI Summary Generator ─────────────────────────────────────────────────────

async function generateAiSummary(data: RawIntakeData, scoring: ScoringResult): Promise<string> {
  const prompt = `You are an internal AI assistant for an athletic training business. Generate a concise internal context summary (2-3 sentences max) for a new lead. This summary will be used by the Gmail outreach agent to craft personalized messages WITHOUT asking questions already answered in the form.

Athlete: ${data.athleteName}
Age/Grade: ${data.age || "?"}/${data.grade || "?"}
Sport/Position: ${data.sport || "unknown"}${data.position ? ` / ${data.position}` : ""}
School: ${data.school || "not provided"}
Goals: ${(data.goals || []).join(", ") || "not specified"}
Commitment: ${data.commitmentLevel || "not specified"}
Experience: ${data.experienceLevel || "not specified"}
Training status: ${data.currentTrainingStatus || "not specified"}
Notes: ${data.notes || "none"}
Lead score: ${scoring.leadScore}/100 (${scoring.temperature})

Write a brief, factual, internal summary that captures who this athlete is, what they want, and what tone/approach the outreach agent should use. Do NOT use bullet points. Write in plain prose. Be specific about the athlete's sport and goals.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
    });
    return resp.choices[0].message.content?.trim() || "";
  } catch {
    return `${data.athleteName} is a ${data.sport || "athlete"} who submitted an application for ${data.programId}. Commitment: ${data.commitmentLevel || "unknown"}.`;
  }
}

// ─── Suggested Next Action ────────────────────────────────────────────────────

function determineSuggestedNextAction(scoring: ScoringResult, data: RawIntakeData): { action: string; reason: string } {
  if (scoring.temperature === "hot" && data.phone) {
    return { action: "call_now", reason: "High-intent lead with phone — call within the hour for best conversion." };
  }
  if (scoring.temperature === "hot") {
    return { action: "send_educational_followup", reason: "High-intent lead — send personalized intro email within 2 hours." };
  }
  if (scoring.temperature === "warm" && scoring.urgency === "high") {
    return { action: "schedule_consultation", reason: "Warm lead with high commitment — invite to a free consultation." };
  }
  if (scoring.temperature === "warm") {
    return { action: "send_educational_followup", reason: "Warm lead — send value-first educational content." };
  }
  return { action: "wait_24h", reason: "Cold lead — queue a follow-up draft for 24 hours from now." };
}

// ─── Initial Outreach Draft Generator ────────────────────────────────────────

async function generateOutreachDraft(
  data: RawIntakeData,
  scoring: ScoringResult,
  aiSummary: string,
  learningCtx?: string | null,
): Promise<{ subject: string; body: string; priorCtx?: import("./agentmail-prior-contact-context-service").PriorContactContext }> {
  const firstName = data.athleteName.split(" ")[0];
  const sportLine = data.sport
    ? `${data.sport}${data.position ? ` (${data.position})` : ""}`
    : "your sport";
  const goalLine = (data.goals || []).slice(0, 2).join(" and ") || "your athletic goals";
  const toneGuide =
    scoring.temperature === "hot" ? "Direct, urgent, action-oriented. Emphasize limited spots."
    : scoring.temperature === "warm" ? "Warm, value-focused, educational. Build trust first."
    : "Friendly, low-pressure, informational.";

  const learningBlock = learningCtx
    ? `\nCoaching rules from prior feedback (follow these carefully):\n${learningCtx}\n`
    : "";

  let priorContactBlock = "";
  let _intakePriorCtx: import("./agentmail-prior-contact-context-service").PriorContactContext | undefined;
  try {
    const { getPriorContactContext } = await import("./agentmail-prior-contact-context-service");
    _intakePriorCtx = await getPriorContactContext({ orgId: data.orgId, recipientEmail: data.email, communicationDomain: "athlete_lead" });
    if (_intakePriorCtx.hasPriorContact && _intakePriorCtx.promptBlock) {
      priorContactBlock = `\n${_intakePriorCtx.promptBlock}\n`;
    }
  } catch {}

  const prompt = `You are a coach at an elite athletic training facility. Write a short, personalized outreach email to a new athlete lead.
${learningBlock}${priorContactBlock}
Athlete context: ${aiSummary}

Guidelines:
- Tone: ${toneGuide}
- Reference their sport (${sportLine}) and goals (${goalLine}) naturally
- Keep it under 120 words in the body
- Do NOT use generic templates — make it feel handwritten
- End with a soft CTA (schedule a call, reply to this email, or book an evaluation)
- Do NOT include a signature block — the coach will add that
- Subject line: short, personalized, no clickbait

Return JSON: { "subject": "...", "body": "..." }`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 400,
    });
    const parsed = JSON.parse(resp.choices[0].message.content || "{}");
    return {
      subject: parsed.subject || `Welcome to the program, ${firstName}`,
      body: parsed.body || `Hi ${firstName}, thanks for applying! We'd love to connect about your ${sportLine} training goals.`,
      priorCtx: _intakePriorCtx,
    };
  } catch {
    return {
      subject: `Your application for ${data.programName}`,
      body: `Hi ${firstName},\n\nThanks for applying! We reviewed your application and would love to connect about your ${goalLine}. Reply here or book a quick call — we have limited evaluation spots available.\n\nLooking forward to it!`,
      priorCtx: _intakePriorCtx,
    };
  }
}

// ─── Stage Transition Helper ─────────────────────────────────────────────────

export function buildStageTransition(
  fromStage: string,
  toStage: string,
  reason: string,
  source: StageTransition["source"],
  confidence = 1.0,
): StageTransition {
  return { fromStage, toStage, reason, source, confidence, timestamp: new Date().toISOString() };
}

// ─── Suppression Helper ──────────────────────────────────────────────────────

export async function suppressLead(
  profileId: string,
  reason: string,
  orgId: string,
): Promise<void> {
  const { db } = await import("../db");
  const { leadIntelligenceProfiles, gmailAgentActions } = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");

  await Promise.all([
    db.update(leadIntelligenceProfiles)
      .set({
        suppressed: true,
        suppressionReason: reason,
        suppressedAt: new Date(),
        pipelineStage: "lost",
        updatedAt: new Date(),
      })
      .where(eq(leadIntelligenceProfiles.id, profileId)),
    db.update(gmailAgentActions)
      .set({ status: "dismissed", result: { reason: `suppressed:${reason}`, suppressedAt: new Date().toISOString() } as any })
      .where(and(
        eq(gmailAgentActions.orgId, orgId),
        eq(gmailAgentActions.status, "proposed"),
      )),
  ]);
  console.log(`[Suppression] profileId=${profileId} reason=${reason}`);
}

// ─── Main Pipeline Entry Point ────────────────────────────────────────────────

export async function runIntelligentLeadIntakePipeline(data: RawIntakeData): Promise<IntakeProcessingResult> {
  const { db } = await import("../db");
  const { leadIntelligenceProfiles, gmailAgentActions } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  const pipelineStart = Date.now();
  const log: ProcessingLogEntry[] = [];
  const ts = () => new Date().toISOString();
  const timings: Record<string, number> = { pipeline_start: Date.now() };

  const addLog = (step: string, status: ProcessingLogEntry["status"], detail?: string) => {
    log.push({ step, status, detail, timestamp: ts() });
    console.log(`[IntakeIntelligence:${data.submissionId}] ${step} → ${status}${detail ? ` — ${detail}` : ""}`);
  };

  addLog("pipeline_start", "ok", `submissionId=${data.submissionId}`);

  // ── Step 1: Heuristic scoring (synchronous) ──────────────────────────────
  const scoring = scoreLeadHeuristic(data);
  timings.scoring_completed = Date.now();
  addLog("heuristic_scoring", "ok", `score=${scoring.leadScore} temp=${scoring.temperature} urgency=${scoring.urgency}`);

  // ── Step 2: Suggested next action (synchronous) ──────────────────────────
  const { action: suggestedNextAction, reason: suggestedNextActionReason } =
    determineSuggestedNextAction(scoring, data);
  addLog("next_action", "ok", suggestedNextAction);

  // ── Step 3: Normalize profile (synchronous) ──────────────────────────────
  const normalizedProfile: NormalizedIntakeProfile = {
    athleteName: data.athleteName,
    parentName: data.parentName || null,
    email: data.email,
    phone: data.phone || null,
    age: data.age ? parseInt(data.age, 10) || null : null,
    grade: data.grade || null,
    sport: data.sport || null,
    position: data.position || null,
    school: data.school || null,
    goals: data.goals || [],
    commitmentLevel: data.commitmentLevel || null,
    injuryHistory: null,
    availability: null,
    experienceLevel: data.experienceLevel || null,
    campaignSource: data.utmSource || null,
    campaignMedium: data.utmMedium || null,
    campaignName: data.utmCampaign || null,
    landingPageId: data.landingPageId || null,
    programId: data.programId,
    submittedAt: data.submittedAt.toISOString(),
    aiSummary: null,
    leadScore: scoring.leadScore,
    temperature: scoring.temperature,
    urgency: scoring.urgency,
    tags: scoring.tags,
  };
  addLog("normalize_profile", "ok");

  // ── Step 4: AI summary + outreach draft — PARALLEL ──────────────────────
  let aiSummary = "";
  let draftSubject = "";
  let draftBody = "";

  const earlyDomain = data.parentName ? "parent_lead" : "athlete_lead";
  let draftLearningCtx: string | null = null;
  let draftAppliedRules: import("./message-learning-service").AppliedRuleMetadata[] = [];
  try {
    const { getMessageLearningContextWithRules } = await import("./message-learning-service");
    const result = await getMessageLearningContextWithRules(data.orgId, earlyDomain, { domain: earlyDomain });
    draftLearningCtx = result.contextText;
    draftAppliedRules = result.rules;
  } catch {}

  const [summaryResult, draftResult] = await Promise.allSettled([
    generateAiSummary(data, scoring),
    (async () => {
      // draft needs a summary — generate a fast inline one for the draft prompt
      // if summary is still running, the draft uses the same scoring context
      const quickContext = `${data.athleteName}, ${data.sport || "athlete"} (${data.experienceLevel || ""}), goals: ${(data.goals || []).slice(0, 2).join(", ")}`;
      return generateOutreachDraft(data, scoring, quickContext, draftLearningCtx);
    })(),
  ]);

  timings.ai_summary_generated = Date.now();
  timings.outreach_draft_generated = Date.now();

  if (summaryResult.status === "fulfilled") {
    aiSummary = summaryResult.value;
    normalizedProfile.aiSummary = aiSummary;
    addLog("ai_summary", "ok", `length=${aiSummary.length}`);
  } else {
    aiSummary = `${data.athleteName}, ${data.sport || "athlete"}, commitment=${data.commitmentLevel || "unknown"}`;
    normalizedProfile.aiSummary = aiSummary;
    addLog("ai_summary", "error", String(summaryResult.reason));
  }

  let _outreachPriorCtx: import("./agentmail-prior-contact-context-service").PriorContactContext | undefined;
  if (draftResult.status === "fulfilled") {
    draftSubject = draftResult.value.subject;
    draftBody = draftResult.value.body;
    _outreachPriorCtx = draftResult.value.priorCtx;
    addLog("outreach_draft", "ok", `subject="${draftSubject}"`);
  } else {
    const firstName = data.athleteName.split(" ")[0];
    draftSubject = `Your application for ${data.programName}`;
    draftBody = `Hi ${firstName},\n\nThanks for applying! We'd love to connect about your training goals. Reply here or book a quick call.\n\nLooking forward to it!`;
    addLog("outreach_draft", "error", String(draftResult.reason));
  }

  // ── Step 5: Build initial stage transition ───────────────────────────────
  const initialTransition = buildStageTransition(
    "none",
    "new_lead",
    "Lead submitted via intake form",
    "intake_pipeline",
    1.0,
  );

  // ── Step 6: Persist intelligence profile ────────────────────────────────
  let profileId = "";
  try {
    const [profile] = await db
      .insert(leadIntelligenceProfiles)
      .values({
        orgId: data.orgId,
        submissionId: data.submissionId,
        pipelineStage: "new_lead",
        aiSummary,
        normalizedProfileJson: normalizedProfile as any,
        leadScore: scoring.leadScore,
        temperature: scoring.temperature,
        urgency: scoring.urgency,
        suggestedNextAction,
        suggestedNextActionReason,
        campaignSource: data.utmSource || null,
        campaignMedium: data.utmMedium || null,
        campaignName: data.utmCampaign || null,
        landingPageId: data.landingPageId || null,
        programId: data.programId,
        tags: scoring.tags,
        initialDraftSubject: draftSubject || null,
        initialDraftBody: draftBody || null,
        intakeProcessedAt: new Date(),
        scoringProcessedAt: new Date(),
        draftGeneratedAt: draftSubject ? new Date() : null,
        stageTransitions: [initialTransition] as any,
        processingLog: [] as any,
      })
      .onConflictDoUpdate({
        target: leadIntelligenceProfiles.submissionId,
        set: {
          aiSummary,
          normalizedProfileJson: normalizedProfile as any,
          leadScore: scoring.leadScore,
          temperature: scoring.temperature,
          urgency: scoring.urgency,
          suggestedNextAction,
          suggestedNextActionReason,
          campaignSource: data.utmSource || null,
          campaignMedium: data.utmMedium || null,
          campaignName: data.utmCampaign || null,
          tags: scoring.tags,
          initialDraftSubject: draftSubject || null,
          initialDraftBody: draftBody || null,
          intakeProcessedAt: new Date(),
          scoringProcessedAt: new Date(),
          draftGeneratedAt: draftSubject ? new Date() : null,
          processingLog: [] as any,
          updatedAt: new Date(),
        },
      })
      .returning();
    profileId = profile.id;
    timings.profile_persisted = Date.now();
    addLog("persist_profile", "ok", `profileId=${profileId}`);
  } catch (e: any) {
    addLog("persist_profile", "error", e.message);
  }

  // ── Step 7: Queue Gmail draft action ────────────────────────────────────
  let gmailDraftActionId: string | null = null;
  if (draftSubject && draftBody) {
    try {
      const [gmailAction] = await db
        .insert(gmailAgentActions)
        .values({
          orgId: data.orgId,
          actionType: "propose_draft:intake_outreach",
          leadId: data.submissionId,
          recipientEmail: data.email,
          subject: draftSubject,
          bodyPreview: draftBody.slice(0, 300),
          riskLevel: "low",
          approvalRequired: true,
          status: "proposed",
          createdByAgent: "intelligent_intake_pipeline",
          communicationDomain: data.parentName ? "parent_lead" : "athlete_lead",
          result: {
            fullBody: draftBody,
            aiSummary,
            leadScore: scoring.leadScore,
            temperature: scoring.temperature,
            programName: data.programName,
            athleteName: data.athleteName,
            ...(_outreachPriorCtx
              ? (await import("./agentmail-prior-contact-context-service")).buildPriorContactSummary(_outreachPriorCtx)
              : { priorContactUsed: false }),
          } as any,
        })
        .returning();
      gmailDraftActionId = gmailAction.id;

      // Record which rules were applied — non-blocking
      if (draftAppliedRules.length > 0) {
        import("./agentmail-analytics-service").then(({ recordAgentMailRuleApplications }) =>
          recordAgentMailRuleApplications({ orgId: data.orgId, actionId: gmailAction.id, communicationDomain: earlyDomain, rules: draftAppliedRules })
        ).catch(() => {});
      }

      if (profileId) {
        await db
          .update(leadIntelligenceProfiles)
          .set({ gmailDraftActionId, updatedAt: new Date() })
          .where(eq(leadIntelligenceProfiles.id, profileId));
      }
      timings.gmail_draft_queued = Date.now();
      addLog("queue_gmail_draft", "ok", `gmailActionId=${gmailDraftActionId}`);
    } catch (e: any) {
      addLog("queue_gmail_draft", "error", e.message);
    }
  }

  // ── Step 8: Schedule follow-up windows ───────────────────────────────────
  try {
    const now = new Date();
    const followUpAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (profileId) {
      await db
        .update(leadIntelligenceProfiles)
        .set({ nextFollowUpAt: followUpAt, followUpStage: "pending_24h", updatedAt: new Date() })
        .where(eq(leadIntelligenceProfiles.id, profileId));
    }
    timings.follow_up_scheduled = Date.now();
    addLog("schedule_followup", "ok", `nextFollowUp=${followUpAt.toISOString()}`);
  } catch (e: any) {
    addLog("schedule_followup", "error", e.message);
  }

  // ── Step 9: Final log — write complete log back to DB ───────────────────
  const processingDurationMs = Date.now() - pipelineStart;
  addLog("pipeline_complete", "ok", `profileId=${profileId} durationMs=${processingDurationMs}`);

  // Build complete timeline with named timestamps
  const completeLog = [
    ...log,
    {
      step: "processing_timeline",
      status: "ok" as const,
      detail: JSON.stringify({
        intake_received: new Date(pipelineStart).toISOString(),
        scoring_completed: new Date(timings.scoring_completed || pipelineStart).toISOString(),
        ai_summary_generated: new Date(timings.ai_summary_generated || pipelineStart).toISOString(),
        outreach_draft_generated: new Date(timings.outreach_draft_generated || pipelineStart).toISOString(),
        profile_persisted: timings.profile_persisted ? new Date(timings.profile_persisted).toISOString() : null,
        gmail_draft_queued: timings.gmail_draft_queued ? new Date(timings.gmail_draft_queued).toISOString() : null,
        follow_up_scheduled: timings.follow_up_scheduled ? new Date(timings.follow_up_scheduled).toISOString() : null,
        processing_completed: new Date().toISOString(),
        processing_duration_ms: processingDurationMs,
      }),
      timestamp: ts(),
    },
  ];

  if (profileId) {
    try {
      await db
        .update(leadIntelligenceProfiles)
        .set({
          processingLog: completeLog as any,
          processingDurationMs,
          updatedAt: new Date(),
        })
        .where(eq(leadIntelligenceProfiles.id, profileId));
    } catch (e: any) {
      console.error(`[IntakeIntelligence] Failed to write final log:`, e.message);
    }
  }

  // Kevin event wire-in (Phase 3) — non-blocking, fail-open
  void (async () => {
    try {
      const { enqueueKevinEvent } = await import("./kevin-event-service");
      await enqueueKevinEvent({
        orgId: data.orgId,
        eventType: "te.lead.intake.completed",
        entityType: "lead_intelligence_profile",
        entityId: profileId ?? data.submissionId,
        idempotencyKey: `te.lead.intake.completed:${data.orgId}:${data.submissionId}`,
        payload: {
          leadScore: scoring.leadScore,
          temperature: scoring.temperature,
          urgency: scoring.urgency,
          suggestedNextAction,
          processingDurationMs,
          sport: (data as any).sport ?? null,
          programId: data.programId ?? null,
        },
        source: "lead_intake",
      });
    } catch {}
  })();

  return {
    profileId,
    normalizedProfile,
    scoring,
    aiSummary,
    suggestedNextAction,
    suggestedNextActionReason,
    draftSubject,
    draftBody,
    gmailDraftActionId,
    processingLog: completeLog,
    processingDurationMs,
  };
}

// ─── Test Payload Generator ───────────────────────────────────────────────────

export const TEST_INTAKE_PAYLOADS: RawIntakeData[] = [
  {
    submissionId: "test-001",
    orgId: "test-org",
    programId: "test-program",
    programName: "Elite Speed Academy",
    orgName: "Train Efficiency",
    athleteName: "Jordan Mitchell",
    parentName: "Terri Mitchell",
    email: "jordan.mitchell@example.com",
    phone: "555-0101",
    age: "16",
    grade: "11th",
    sport: "Track & Field",
    position: "400m / 200m",
    school: "Lincoln High School",
    goals: ["Improve sprint speed", "Gain explosive power", "Earn a college scholarship"],
    experienceLevel: "competitive",
    currentTrainingStatus: "training with school team",
    commitmentLevel: "high",
    notes: "Ran 52s 400m last season. Wants to break 50 before senior year.",
    utmSource: "instagram",
    utmCampaign: "speed-academy-spring",
    submittedAt: new Date(),
  },
  {
    submissionId: "test-002",
    orgId: "test-org",
    programId: "test-program",
    programName: "Youth Strength Program",
    orgName: "Train Efficiency",
    athleteName: "Marcus Williams",
    email: "marcus.w@example.com",
    age: "14",
    grade: "9th",
    sport: "Football",
    position: "Wide Receiver",
    school: "Jefferson Middle",
    goals: ["Get stronger", "Improve agility"],
    experienceLevel: "beginner",
    commitmentLevel: "medium",
    submittedAt: new Date(),
  },
];
