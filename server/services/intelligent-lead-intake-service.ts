/**
 * Intelligent Lead Intake Service
 *
 * Runs as a non-blocking pipeline immediately after a lead capture submission.
 * Responsibilities:
 *  1. Normalize the raw intake form data into a structured profile
 *  2. Score the lead (heuristic + AI)
 *  3. Generate an AI context summary for the Gmail agent
 *  4. Create the lead_intelligence_profiles record
 *  5. Generate a personalized initial outreach draft (queued, approval required)
 *  6. Schedule recovery follow-up windows
 *  7. Log every processing step
 */

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Types ───────────────────────────────────────────────────────────────────

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

  // Commitment level (0–25)
  const commitMap: Record<string, number> = {
    high: 25, "very high": 25, dedicated: 22, serious: 20,
    medium: 12, moderate: 12, casual: 6, low: 3,
  };
  const commitKey = (data.commitmentLevel || "").toLowerCase();
  const commitScore = commitMap[commitKey] ?? 8;
  breakdown.commitment = commitScore;
  score += commitScore;

  // Goals quality (0–15)
  const goalCount = (data.goals || []).length;
  const goalScore = Math.min(goalCount * 5, 15);
  breakdown.goals = goalScore;
  score += goalScore;

  // Contact completeness (0–15)
  let contactScore = 0;
  if (data.email) contactScore += 5;
  if (data.phone) contactScore += 5;
  if (data.school) contactScore += 3;
  if (data.age) contactScore += 2;
  breakdown.contactCompleteness = contactScore;
  score += contactScore;

  // Experience level (0–15)
  const expMap: Record<string, number> = {
    "elite": 15, "advanced": 13, "varsity": 12, "competitive": 11,
    "intermediate": 8, "beginner": 5, "none": 2,
  };
  const expKey = (data.experienceLevel || "").toLowerCase();
  const expScore = expMap[expKey] ?? 6;
  breakdown.experience = expScore;
  score += expScore;

  // Sport specificity (0–10)
  const sportScore = data.sport ? (data.position ? 10 : 7) : 3;
  breakdown.sport = sportScore;
  score += sportScore;

  // UTM / campaign attribution (0–10)
  const utmScore = data.utmSource ? 8 : (data.utmCampaign ? 6 : 0);
  breakdown.attribution = utmScore;
  score += utmScore;

  // Age bracket (0–10)
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
): Promise<{ subject: string; body: string }> {
  const firstName = data.athleteName.split(" ")[0];
  const sportLine = data.sport
    ? `${data.sport}${data.position ? ` (${data.position})` : ""}`
    : "your sport";
  const goalLine = (data.goals || []).slice(0, 2).join(" and ") || "your athletic goals";
  const schoolLine = data.school ? ` at ${data.school}` : "";
  const toneGuide =
    scoring.temperature === "hot" ? "Direct, urgent, action-oriented. Emphasize limited spots."
    : scoring.temperature === "warm" ? "Warm, value-focused, educational. Build trust first."
    : "Friendly, low-pressure, informational.";

  const prompt = `You are a coach at an elite athletic training facility. Write a short, personalized outreach email to a new athlete lead. 

Athlete context: ${aiSummary}

Guidelines:
- Tone: ${toneGuide}
- Reference their sport (${sportLine}) and goals (${goalLine}) naturally
- Mention their school${schoolLine || " if provided"}
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
    };
  } catch {
    return {
      subject: `Your application for ${data.programName}`,
      body: `Hi ${firstName},\n\nThanks for applying! We reviewed your application and would love to connect about your ${goalLine}. Reply here or book a quick call — we have limited evaluation spots available.\n\nLooking forward to it!`,
    };
  }
}

// ─── Main Pipeline Entry Point ────────────────────────────────────────────────

export async function runIntelligentLeadIntakePipeline(data: RawIntakeData): Promise<IntakeProcessingResult> {
  const { db } = await import("../db");
  const { leadIntelligenceProfiles, gmailAgentActions } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  const log: ProcessingLogEntry[] = [];
  const ts = () => new Date().toISOString();

  const addLog = (step: string, status: ProcessingLogEntry["status"], detail?: string) => {
    log.push({ step, status, detail, timestamp: ts() });
    console.log(`[IntakeIntelligence:${data.submissionId}] ${step} → ${status}${detail ? ` — ${detail}` : ""}`);
  };

  addLog("pipeline_start", "ok", `submissionId=${data.submissionId}`);

  // 1. Heuristic scoring
  const scoring = scoreLeadHeuristic(data);
  addLog("heuristic_scoring", "ok", `score=${scoring.leadScore} temp=${scoring.temperature} urgency=${scoring.urgency}`);

  // 2. AI summary
  let aiSummary = "";
  try {
    aiSummary = await generateAiSummary(data, scoring);
    addLog("ai_summary", "ok", `length=${aiSummary.length}`);
  } catch (e: any) {
    addLog("ai_summary", "error", e.message);
    aiSummary = `${data.athleteName}, ${data.sport || "athlete"}, commitment=${data.commitmentLevel || "unknown"}`;
  }

  // 3. Suggested next action
  const { action: suggestedNextAction, reason: suggestedNextActionReason } =
    determineSuggestedNextAction(scoring, data);
  addLog("next_action", "ok", suggestedNextAction);

  // 4. Normalize profile
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
    aiSummary,
    leadScore: scoring.leadScore,
    temperature: scoring.temperature,
    urgency: scoring.urgency,
    tags: scoring.tags,
  };
  addLog("normalize_profile", "ok");

  // 5. Generate outreach draft
  let draftSubject = "";
  let draftBody = "";
  try {
    const draft = await generateOutreachDraft(data, scoring, aiSummary);
    draftSubject = draft.subject;
    draftBody = draft.body;
    addLog("outreach_draft", "ok", `subject="${draftSubject}"`);
  } catch (e: any) {
    addLog("outreach_draft", "error", e.message);
  }

  // 6. Persist intelligence profile
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
        processingLog: log as any,
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
          processingLog: log as any,
          updatedAt: new Date(),
        },
      })
      .returning();
    profileId = profile.id;
    addLog("persist_profile", "ok", `profileId=${profileId}`);
  } catch (e: any) {
    addLog("persist_profile", "error", e.message);
  }

  // 7. Queue Gmail draft action (approval required, low-risk)
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
          result: {
            fullBody: draftBody,
            aiSummary,
            leadScore: scoring.leadScore,
            temperature: scoring.temperature,
            programName: data.programName,
            athleteName: data.athleteName,
          } as any,
        })
        .returning();
      gmailDraftActionId = gmailAction.id;

      // Update profile with draft action ID
      if (profileId) {
        await db
          .update(leadIntelligenceProfiles)
          .set({ gmailDraftActionId, updatedAt: new Date() })
          .where(eq(leadIntelligenceProfiles.id, profileId));
      }
      addLog("queue_gmail_draft", "ok", `gmailActionId=${gmailDraftActionId}`);
    } catch (e: any) {
      addLog("queue_gmail_draft", "error", e.message);
    }
  }

  // 8. Schedule follow-up windows (update profile with next follow-up time)
  try {
    const now = new Date();
    const followUpAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h
    if (profileId) {
      await db
        .update(leadIntelligenceProfiles)
        .set({ nextFollowUpAt: followUpAt, followUpStage: "pending_24h", updatedAt: new Date() })
        .where(eq(leadIntelligenceProfiles.id, profileId));
    }
    addLog("schedule_followup", "ok", `nextFollowUp=${followUpAt.toISOString()}`);
  } catch (e: any) {
    addLog("schedule_followup", "error", e.message);
  }

  addLog("pipeline_complete", "ok", `profileId=${profileId}`);

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
    processingLog: log,
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
