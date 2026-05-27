/**
 * Lead Recovery Cron — Hardening Layer
 *
 * Runs every 15 minutes. Finds leads whose follow-up window has passed
 * and queues the appropriate follow-up draft for coach approval.
 *
 * Safety contract:
 * - NEVER auto-sends emails. All drafts are status=proposed, approvalRequired=true.
 * - Suppressed or unsubscribed leads are completely skipped.
 * - Duplicate drafts are prevented (checks for existing proposed action on same lead+stage).
 * - All actions are org-scoped.
 * - No secrets or tokens written to logs.
 */

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface RecoveryCronResult {
  ran: boolean;
  processedCount: number;
  queuedDrafts: number;
  skippedDuplicate: number;
  skippedSuppressed: number;
  advancedStage: number;
  errors: string[];
  durationMs: number;
  timestamp: string;
}

// Follow-up stage progression
const STAGE_PROGRESSION: Record<string, { next: string; delayHours: number; draftType: string; label: string }> = {
  pending_24h: {
    next: "pending_72h",
    delayHours: 72,
    draftType: "propose_draft:followup_24h",
    label: "24-hour follow-up",
  },
  pending_72h: {
    next: "pending_7d",
    delayHours: 7 * 24,
    draftType: "propose_draft:followup_72h",
    label: "72-hour follow-up",
  },
  pending_7d: {
    next: "exhausted",
    delayHours: 0,
    draftType: "propose_draft:followup_7d",
    label: "7-day final follow-up",
  },
};

async function generateFollowUpDraft(
  athleteName: string,
  email: string,
  programName: string,
  aiSummary: string | null,
  followUpType: string,
  previousDraftSubject: string | null,
): Promise<{ subject: string; body: string }> {
  const firstName = athleteName.split(" ")[0];
  const contextLine = aiSummary
    ? `Athlete context: ${aiSummary}`
    : `Athlete: ${athleteName}, applied for ${programName}`;

  const urgencyMap: Record<string, string> = {
    "propose_draft:followup_24h": "gentle, friendly first follow-up — 24 hours since no response",
    "propose_draft:followup_72h": "slightly more direct — 3 days since no response, mention limited spots",
    "propose_draft:followup_7d": "final check-in — a week has passed, offer to keep them on the waitlist",
  };
  const tone = urgencyMap[followUpType] || "friendly follow-up";

  const prompt = `You are a coach following up with a lead who hasn't responded yet. Write a short, personalized follow-up email.

${contextLine}
Original subject (if any): ${previousDraftSubject || "none"}
Follow-up type: ${tone}

Guidelines:
- Keep it under 80 words
- Don't be pushy — respect their time
- Offer a clear, low-friction CTA (quick reply or link to schedule)
- Do NOT repeat the entire original pitch
- Feel personal and human, not automated
- No signature block

Return JSON: { "subject": "...", "body": "..." }`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 300,
    });
    const parsed = JSON.parse(resp.choices[0].message.content || "{}");
    return {
      subject: parsed.subject || `Following up — ${programName}`,
      body: parsed.body || `Hi ${firstName}, just checking in on your application. Let us know if you have any questions!`,
    };
  } catch {
    return {
      subject: `Following up — ${programName}`,
      body: `Hi ${firstName},\n\nJust checking in to see if you're still interested in the program. Happy to answer any questions — reply here or grab a time on our calendar.\n\nLooking forward to it!`,
    };
  }
}

let cronRunning = false;

export async function runLeadRecoveryCron(): Promise<RecoveryCronResult> {
  const startMs = Date.now();
  const result: RecoveryCronResult = {
    ran: false,
    processedCount: 0,
    queuedDrafts: 0,
    skippedDuplicate: 0,
    skippedSuppressed: 0,
    advancedStage: 0,
    errors: [],
    durationMs: 0,
    timestamp: new Date().toISOString(),
  };

  if (cronRunning) {
    console.log("[RecoveryCron] Already running — skipping this tick");
    return result;
  }

  cronRunning = true;

  try {
    const { db } = await import("../db");
    const { leadIntelligenceProfiles, gmailAgentActions } = await import("@shared/schema");
    const { lte, inArray, eq, and, sql, count } = await import("drizzle-orm");

    const now = new Date();

    // Find leads ready for follow-up
    const dueleads = await db
      .select()
      .from(leadIntelligenceProfiles)
      .where(
        and(
          lte(leadIntelligenceProfiles.nextFollowUpAt, now),
          inArray(leadIntelligenceProfiles.pipelineStage, ["new_lead", "engaged", "stalled"]),
          inArray(leadIntelligenceProfiles.followUpStage, ["pending_24h", "pending_72h", "pending_7d"]),
          eq(leadIntelligenceProfiles.suppressed, false),
          eq(leadIntelligenceProfiles.unsubscribed, false),
        ),
      )
      .limit(50);

    console.log(`[RecoveryCron] Found ${dueleads.length} leads due for follow-up`);
    result.ran = true;
    result.processedCount = dueleads.length;

    for (const profile of dueleads) {
      try {
        const progression = STAGE_PROGRESSION[profile.followUpStage || ""];
        if (!progression) continue;

        // Check for duplicate — no pending proposed action for same lead + draft type
        const [dupCheck] = await db
          .select({ cnt: count() })
          .from(gmailAgentActions)
          .where(
            and(
              eq(gmailAgentActions.leadId, profile.submissionId),
              eq(gmailAgentActions.actionType, progression.draftType),
              eq(gmailAgentActions.status, "proposed"),
            ),
          );
        if (Number(dupCheck?.cnt) > 0) {
          console.log(`[RecoveryCron] Skipping duplicate for ${profile.submissionId} (${progression.draftType})`);
          result.skippedDuplicate++;
          continue;
        }

        // Get normalized profile data
        const np = profile.normalizedProfileJson as any;
        const athleteName = np?.athleteName || profile.submissionId;
        const email = np?.email;
        const programName = np?.programId || "our program";

        if (!email) {
          result.errors.push(`No email for profile ${profile.id}`);
          continue;
        }

        // Generate follow-up draft
        const draft = await generateFollowUpDraft(
          athleteName,
          email,
          programName,
          profile.aiSummary,
          progression.draftType,
          profile.initialDraftSubject,
        );

        // Queue draft action — approval required, never auto-send
        const [action] = await db
          .insert(gmailAgentActions)
          .values({
            orgId: profile.orgId,
            actionType: progression.draftType,
            leadId: profile.submissionId,
            recipientEmail: email,
            subject: draft.subject,
            bodyPreview: draft.body.slice(0, 300),
            riskLevel: "low",
            approvalRequired: true,
            status: "proposed",
            createdByAgent: "recovery_cron",
            result: {
              fullBody: draft.body,
              followUpStage: profile.followUpStage,
              autoGenerated: true,
              profileId: profile.id,
            } as any,
          })
          .returning();

        // Build stage transition record for follow-up stage advancement
        const { buildStageTransition } = await import("./intelligent-lead-intake-service");
        const transition = buildStageTransition(
          profile.followUpStage || "pending_24h",
          progression.next,
          `${progression.label} — draft queued by recovery cron`,
          "recovery_cron",
          0.95,
        );
        const existingTransitions = (profile.stageTransitions as any[]) || [];

        // Advance follow-up stage and set next follow-up time
        const nextFollowUpAt = progression.next !== "exhausted"
          ? new Date(Date.now() + progression.delayHours * 60 * 60 * 1000)
          : null;

        await db
          .update(leadIntelligenceProfiles)
          .set({
            followUpStage: progression.next,
            nextFollowUpAt,
            stageTransitions: [...existingTransitions, transition] as any,
            updatedAt: new Date(),
          })
          .where(eq(leadIntelligenceProfiles.id, profile.id));

        result.queuedDrafts++;
        result.advancedStage++;
        console.log(`[RecoveryCron] Queued ${progression.draftType} for ${profile.submissionId} → action=${action.id}`);
      } catch (e: any) {
        const msg = `Error processing profile ${profile.id}: ${e.message}`;
        result.errors.push(msg);
        console.error(`[RecoveryCron] ${msg}`);
      }
    }
  } catch (e: any) {
    result.errors.push(`Fatal cron error: ${e.message}`);
    console.error(`[RecoveryCron] Fatal:`, e.message);
  } finally {
    cronRunning = false;
  }

  result.durationMs = Date.now() - startMs;
  console.log(`[RecoveryCron] Done — queued=${result.queuedDrafts} skippedDup=${result.skippedDuplicate} errors=${result.errors.length} duration=${result.durationMs}ms`);
  return result;
}

// ─── Cron Scheduler ──────────────────────────────────────────────────────────

let cronInterval: ReturnType<typeof setInterval> | null = null;

export function startLeadRecoveryCron(intervalMs = 15 * 60 * 1000): void {
  if (cronInterval) return;
  console.log(`[RecoveryCron] Starting — interval=${intervalMs / 60000}min`);
  cronInterval = setInterval(async () => {
    try {
      await runLeadRecoveryCron();
    } catch (e: any) {
      console.error("[RecoveryCron] Unhandled error:", e.message);
    }
  }, intervalMs);
  // Run once on startup after a short delay
  setTimeout(async () => {
    try {
      await runLeadRecoveryCron();
    } catch (e: any) {
      console.error("[RecoveryCron] Startup run error:", e.message);
    }
  }, 30_000);
}

export function stopLeadRecoveryCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    console.log("[RecoveryCron] Stopped");
  }
}
