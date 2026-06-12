import { storage } from "../storage";
import { type OrgBranding } from "../email";
import { generateOutreachEmailFromVariant } from "../team-training-prospecting";
import { logTriggerEvent, updateTriggerEvent } from "./trigger-logger";
import { evaluatePolicy } from "../services/autonomy-policy-engine";
import { createOutcomeOnSend } from "../services/outcome-intelligence-service";
import { guardedSendTeamTrainingOutreachEmail } from "../services/guarded-outbound-email";
import { db } from "../db";
import { gmailAgentActions, appSettings } from "@shared/schema";
import { acquireJobLock, releaseJobLock } from "../services/ceo-heartbeat-service";
import { like, sql } from "drizzle-orm";
import { pushToDeadLetter } from "../services/agent-dead-letter-service";
import { logSystemEvent } from "../reliability-routes";

// Base follow-up sequence schedule: days after initial send
const BASE_FOLLOW_UP_DAYS = [3, 7, 14];
const MAX_FOLLOW_UPS = 3;

const FOLLOW_UP_OPENERS = [
  "Just wanted to follow up on my previous message regarding team training for",
  "Circling back on my last note about strength & conditioning for",
  "Wanted to reconnect — reaching out again about training programs for",
];

async function getOrgBranding(orgId: string): Promise<OrgBranding | undefined> {
  try {
    const org = await storage.getOrganizationById(orgId);
    if (!org) return undefined;
    const owner = org.ownerUserId ? await storage.getUser(org.ownerUserId) : null;
    return {
      name: org.name,
      accentColor: org.primaryColor || undefined,
      emailPrimaryColor: org.emailPrimaryColor || undefined,
      emailSecondaryColor: org.emailSecondaryColor || undefined,
      ownerName: owner ? `${owner.firstName} ${owner.lastName}`.trim() : undefined,
      ownerEmail: org.ownerEmail || undefined,
    };
  } catch {
    return undefined;
  }
}

async function getCoachName(orgId: string): Promise<string> {
  try {
    const org = await storage.getOrganizationById(orgId);
    if (!org) return "Coach";
    const owner = org.ownerUserId ? await storage.getUser(org.ownerUserId) : null;
    if (owner?.firstName) return `${owner.firstName} ${owner.lastName || ""}`.trim();
    return "Coach";
  } catch {
    return "Coach";
  }
}

/**
 * Compute adaptive follow-up days based on engagement signals (Phase 5).
 */
export function computeAdaptiveFollowUpDays(params: {
  openCount: number;
  clicked: boolean;
  warmthScore: number;
  fitScore: number;
  riskScore: number;
  cooldownDays?: number;
}): number[] {
  const { openCount, clicked, warmthScore, fitScore, riskScore, cooldownDays = 30 } = params;

  let days = [...BASE_FOLLOW_UP_DAYS];

  // High engagement: opened 2+ times or clicked → move next follow-up sooner by 1-2 days
  if (clicked || openCount >= 2) {
    days = days.map((d) => Math.max(1, d - 2));
  } else if (openCount === 0) {
    // No opens: delay by 2 days
    days = days.map((d) => Math.min(cooldownDays - 1, d + 2));
  }

  // High warmth + fit: prioritize earlier
  if (warmthScore >= 60 && fitScore >= 60) {
    days = days.map((d) => Math.max(1, d - 1));
  }

  // High risk: delay or require manual approval (push back by 3 days)
  if (riskScore >= 50) {
    days = days.map((d) => Math.min(cooldownDays - 1, d + 3));
  }

  return days;
}

/**
 * Schedule follow-up steps for a newly-sent outreach draft.
 * Called right after the initial email is successfully sent.
 */
export async function scheduleFollowUpsForDraft(
  orgId: string,
  outreachDraftId: string,
  prospectId: string,
  sentAt: Date = new Date(),
  engagementParams?: {
    openCount?: number;
    clicked?: boolean;
    warmthScore?: number;
    fitScore?: number;
    riskScore?: number;
  }
): Promise<void> {
  await storage.cancelFollowUpSequence(outreachDraftId);

  const settings = await storage.getEmailAgentSettings(orgId);
  const cooldownDays = settings.cooldownDays ?? 30;

  const followUpDays = computeAdaptiveFollowUpDays({
    openCount: engagementParams?.openCount ?? 0,
    clicked: engagementParams?.clicked ?? false,
    warmthScore: engagementParams?.warmthScore ?? 20,
    fitScore: engagementParams?.fitScore ?? 50,
    riskScore: engagementParams?.riskScore ?? 0,
    cooldownDays,
  });

  for (let i = 0; i < followUpDays.length; i++) {
    const scheduledFor = new Date(sentAt.getTime() + followUpDays[i] * 24 * 60 * 60 * 1000);
    await storage.createFollowUp({
      orgId,
      outreachDraftId,
      prospectId,
      stepNumber: i + 1,
      scheduledFor,
      status: "pending",
    });
  }

  console.log(
    `[FollowUp] Scheduled ${followUpDays.length} follow-ups for draft ${outreachDraftId} (days: ${followUpDays.join(", ")})`
  );
}

/**
 * Process all due follow-ups for a given org.
 *
 * Safety additions (Audit Safety Pass):
 *  - Priority 1: Autonomy Policy Gate — every send goes through evaluatePolicy()
 *    blocked      → mark skipped, log POLICY_BLOCKED
 *    approval_req → create gmail_agent_actions proposal, mark skipped
 *    auto_execute → send + createOutcomeOnSend
 *  - Priority 3: per-org execution lock (acquireJobLock) in runFollowUpCron
 */
export async function processFollowUpsForOrg(
  orgId: string
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const result = { sent: 0, skipped: 0, errors: [] as string[] };

  const dueFollowUps = await storage.getDueFollowUps(orgId);
  if (dueFollowUps.length === 0) return result;

  console.log(`[FollowUp] org ${orgId} — ${dueFollowUps.length} due follow-ups`);

  const branding = await getOrgBranding(orgId);
  const coachName = await getCoachName(orgId);

  for (const followUp of dueFollowUps) {
    const triggerEventId = await logTriggerEvent({
      organizationId: orgId,
      prospectId: followUp.prospectId,
      followUpId: followUp.id,
      outreachDraftId: followUp.outreachDraftId,
      triggerType: "follow_up_cron",
      triggerSource: "hourly_follow_up_cron",
      actionType: "send_follow_up",
      reasoning: `Follow-up step #${followUp.stepNumber} due for processing`,
    });

    try {
      // ── PHASE 2: Atomic Row Claim — prevents duplicate sends if follow-up-cron
      // and auto-execution-engine both pick up the same row concurrently.
      // Includes org_id in the WHERE clause to guarantee cross-tenant isolation. ──
      const claimResult = await db.execute(sql`
        UPDATE email_follow_ups
        SET status = 'processing'
        WHERE id = ${followUp.id} AND org_id = ${orgId} AND status = 'pending'
        RETURNING id
      `).catch(() => null);
      const claimedRows = Array.isArray(claimResult)
        ? claimResult
        : ((claimResult as any)?.rows ?? []);
      if (claimedRows.length === 0) {
        console.log(`[FollowUp] follow-up ${followUp.id} already claimed by another worker — skipping`);
        result.skipped++;
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: true,
          blockReason: "COOLDOWN_ACTIVE",
          reasoning: "Row already claimed by concurrent worker (race condition prevented)",
        });
        continue;
      }
      // ─────────────────────────────────────────────────────────────────────────

      const prospect = await storage.getTeamTrainingProspect(followUp.prospectId);

      if (!prospect || !prospect.contactEmail) {
        await storage.updateFollowUp(followUp.id, { status: "skipped" });
        result.skipped++;
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: true,
          blockReason: "MISSING_EMAIL",
          reasoning: prospect ? "Prospect has no contact email" : "Prospect not found",
          missedOpportunity: true,
        });
        continue;
      }

      await storage.updateEmailTriggerEvent(triggerEventId, { prospectName: prospect.prospectName });

      if (prospect.outreachStatus === "Do Not Contact" || prospect.outreachStatus === "Replied") {
        await storage.updateFollowUp(followUp.id, { status: "cancelled" });
        result.skipped++;
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: true,
          blockReason: prospect.outreachStatus === "Do Not Contact" ? "DNC" : "DEAL_ACTIVE_BLOCK",
          reasoning: `Prospect status is "${prospect.outreachStatus}" — follow-up cancelled`,
        });
        continue;
      }

      const activeDeal = await storage
        .getTeamTrainingDealByProspect(followUp.prospectId, orgId)
        .catch(() => null);
      if (activeDeal && !["won", "lost"].includes(activeDeal.status)) {
        await storage.updateFollowUp(followUp.id, { status: "skipped" });
        result.skipped++;
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: true,
          blockReason: "DEAL_ACTIVE_BLOCK",
          reasoning: `Active deal exists (status: ${activeDeal.status}) — cold follow-up skipped`,
        });
        continue;
      }

      const optedOut = await storage.isProspectOptedOut(orgId, prospect.contactEmail);
      if (optedOut) {
        await storage.updateFollowUp(followUp.id, { status: "cancelled" });
        result.skipped++;
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: true,
          blockReason: "OPTED_OUT",
          reasoning: "Prospect email is on the opt-out list",
        });
        continue;
      }

      if (followUp.stepNumber > MAX_FOLLOW_UPS) {
        await storage.updateFollowUp(followUp.id, { status: "cancelled" });
        result.skipped++;
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: true,
          blockReason: "COOLDOWN_ACTIVE",
          reasoning: `Max follow-ups (${MAX_FOLLOW_UPS}) reached for this sequence`,
        });
        continue;
      }

      // ── Generate body (needed before policy check for sensitive-language scan) ──
      let subject = followUp.subject;
      let body = followUp.body;

      if (!subject || !body) {
        const variant = await storage.selectVariantForEmail(orgId);
        const org = await storage.getOrganizationById(orgId);
        const businessName = org?.name || "Our Training Facility";
        const opener = FOLLOW_UP_OPENERS[(followUp.stepNumber - 1) % FOLLOW_UP_OPENERS.length];

        const sentDrafts = await storage.getOutreachDraftsByProspect(followUp.prospectId);
        const openCount = sentDrafts.filter((d) => !!d.openedAt).length;
        const clicked = sentDrafts.some((d) => !!d.clickedAt);

        const closingLines: Record<number, string> = {
          1:
            openCount >= 1 || clicked
              ? "I noticed you had a chance to look at my last message — would love to connect for a quick 10 minutes to share what we've done for similar programs."
              : "I'd love to connect and share how we've helped similar programs this season.",
          2:
            openCount >= 2 || clicked
              ? "I can tell you've been looking into this — I'd love to show you exactly what a program would look like for your team."
              : "Would a quick 10-minute call make sense this week?",
          3: "If now isn't the right time, no worries — I'll close this out. Otherwise, I'm happy to connect.",
        };
        const closingLine = closingLines[followUp.stepNumber] ?? closingLines[3];

        if (variant) {
          const emailParams = {
            prospectName: prospect.prospectName,
            sport: prospect.sport || "sports",
            city: prospect.city || "",
            contactName: prospect.contactName || "",
            businessName,
            coachName,
          };
          const generated = await generateOutreachEmailFromVariant(emailParams, variant);
          subject = `Re: ${generated.subject}`;
          body = `${opener} ${prospect.prospectName}.\n\n${closingLine}\n\n${generated.body}`;
        } else {
          subject = `Following up — Training for ${prospect.prospectName}`;
          body = `Hi${prospect.contactName ? " " + prospect.contactName : ""},\n\n${opener} ${prospect.prospectName}.\n\n${closingLine}\n\nBest,\n${coachName}\n${businessName}`;
        }
      }

      // ── Autonomy Policy Gate (Priority 1) ────────────────────────────────────
      // PHASE 3: Fail-closed — policy errors default to approval_required, NOT auto_execute.
      const policy = await evaluatePolicy({
        orgId,
        actionType: "send_follow_up",
        recipientEmail: prospect.contactEmail,
        confidence: 0.80,
        riskLevel: "low",
        bodyText: body ?? undefined,
        isFirstContact: false,
        isNewRecipient: false,
      }).catch((e) => {
        console.warn(
          `[FollowUp] Policy evaluation failed — defaulting to approval_required for safety (org ${orgId}):`,
          e.message
        );
        return {
          decision: "approval_required" as const,
          reasons: ["Policy evaluation error — defaulting to approval_required"] as string[],
          confidence: 0.80,
          riskLevel: "low" as const,
          policyVersion: "1.0.0",
          evaluatedAt: new Date(),
        };
      });

      if (policy.decision === "blocked") {
        await storage.updateFollowUp(followUp.id, { status: "skipped" });
        result.skipped++;
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: true,
          blockReason: "POLICY_BLOCKED",
          reasoning: `Autonomy Policy blocked: ${policy.reasons.join("; ")}`,
        });
        console.log(`[FollowUp] org ${orgId} follow-up ${followUp.id} BLOCKED by policy`);
        continue;
      }

      if (policy.decision === "approval_required") {
        await db
          .insert(gmailAgentActions)
          .values({
            orgId,
            actionType: "follow_up_email",
            recipientEmail: prospect.contactEmail,
            subject: subject ?? `Follow-up #${followUp.stepNumber} — ${prospect.prospectName}`,
            bodyPreview: (body ?? "").slice(0, 300),
            riskLevel: "low",
            approvalRequired: true,
            status: "proposed",
            communicationDomain: "team_training",
            createdByAgent: "follow_up_cron",
            result: {
              followUpId: followUp.id,
              stepNumber: followUp.stepNumber,
              prospectId: followUp.prospectId,
            },
          })
          .catch((e) =>
            console.error(
              `[FollowUp] Failed to create approval proposal for ${followUp.id}:`,
              e.message
            )
          );

        await storage.updateFollowUp(followUp.id, { status: "skipped" });
        result.skipped++;
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: false,
          reasoning: `Approval required — proposal queued in AI Comms Center. Reasons: ${policy.reasons.join("; ")}`,
        });
        console.log(`[FollowUp] org ${orgId} follow-up ${followUp.id} queued for admin approval`);
        continue;
      }

      // ── auto_execute: create tracking record, send, record outcome ────────────
      const [gmailAction] = await db
        .insert(gmailAgentActions)
        .values({
          orgId,
          actionType: "follow_up_email",
          recipientEmail: prospect.contactEmail,
          subject: subject ?? `Follow-up #${followUp.stepNumber} — ${prospect.prospectName}`,
          bodyPreview: (body ?? "").slice(0, 300),
          riskLevel: "low",
          approvalRequired: false,
          status: "auto_executed",
          communicationDomain: "team_training",
          createdByAgent: "follow_up_cron",
          executedAt: new Date(),
        })
        .returning()
        .catch(() => [{ id: "" }] as { id: string }[]);

      // PHASE 4: All automated sends go through the Send Guard chain.
      const sendResult = await guardedSendTeamTrainingOutreachEmail({
        orgId,
        recipientEmail: prospect.contactEmail,
        recipientName: prospect.contactName || undefined,
        subject: subject!,
        body: body!,
        branding,
        trackingId: followUp.id,
        sourceSystem: "follow_up_cron",
        sourceRecordId: followUp.id,
        triggeredBy: "cron",
        emailType: "follow_up",
        policyDecision: "auto_execute",
      });
      if (sendResult.blocked) {
        await storage.updateFollowUp(followUp.id, { status: "skipped" });
        result.skipped++;
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: true,
          blockReason: "POLICY_BLOCKED",
          reasoning: `Send Guard blocked: ${sendResult.blockReason}`,
        });
        console.warn(`[FollowUp] Send Guard blocked follow-up ${followUp.id}: ${sendResult.blockReason}`);
        continue;
      }

      await storage.updateFollowUp(followUp.id, {
        status: "sent",
        sentAt: new Date(),
        subject,
        body,
      });

      await storage.logOutreachEvent({
        orgId,
        prospectId: followUp.prospectId,
        draftId: followUp.outreachDraftId,
        eventType: "sent",
        description: `[Auto] Follow-up #${followUp.stepNumber} sent to ${prospect.contactEmail}`,
      });

      await updateTriggerEvent(triggerEventId, {
        wasExecuted: true,
        executionBlocked: false,
        followUpId: followUp.id,
        outreachDraftId: followUp.outreachDraftId,
        reasoning: `Follow-up #${followUp.stepNumber} sent to ${prospect.contactEmail}`,
      });

      // Record outcome for attribution (fire-and-forget)
      if (gmailAction?.id) {
        createOutcomeOnSend({
          orgId,
          gmailActionId: gmailAction.id,
          communicationDomain: "team_training",
          messageType: "follow_up",
          recipientEmail: prospect.contactEmail,
          prospectId: followUp.prospectId,
        }).catch((e) => console.warn("[FollowUp] createOutcomeOnSend failed:", e.message));
      }

      result.sent++;
    } catch (err: any) {
      console.error(`[FollowUp] Error processing follow-up ${followUp.id}:`, err.message);
      result.errors.push(`follow-up ${followUp.id}: ${err.message}`);
      await storage.updateFollowUp(followUp.id, { status: "skipped" }).catch(() => {});
      await updateTriggerEvent(triggerEventId, {
        wasExecuted: false,
        executionBlocked: true,
        blockReason: "INVALID_STAGE",
        reasoning: `Error during follow-up processing: ${err.message}`,
      });
      // Audit: every failed agent action → dead-letter + system_log
      pushToDeadLetter({
        jobName: "follow_up_cron",
        orgId,
        error: err,
        payload: { followUpId: followUp.id, prospectId: followUp.prospectId, stepNumber: followUp.stepNumber },
      }).catch(() => {});
      logSystemEvent("error", "follow_up_cron", "agent_action_failed", err.message, {
        orgId,
        followUpId: followUp.id,
        prospectId: followUp.prospectId,
      }).catch(() => {});
    }
  }

  console.log(
    `[FollowUp] org ${orgId} — sent=${result.sent} skipped=${result.skipped} errors=${result.errors.length}`
  );
  return result;
}

let followUpCronInitialized = false;
let followUpCronIsRunning = false;

export function initializeFollowUpCron(): void {
  if (followUpCronInitialized) return;
  followUpCronInitialized = true;

  setTimeout(() => runFollowUpCron(), 15_000);
  setInterval(() => runFollowUpCron(), 60 * 60 * 1000);

  console.log("[FollowUp Cron] started — will run hourly");
}

async function runFollowUpCron(): Promise<void> {
  // Global guard: prevent overlapping ticks (Priority 3)
  if (followUpCronIsRunning) {
    console.log("[FollowUp Cron] previous run still in progress — skipping this tick");
    return;
  }
  followUpCronIsRunning = true;

  try {
    const settingRows = await db
      .select()
      .from(appSettings)
      .where(like(appSettings.key, "email_agent_%"));

    const orgIds = new Set<string>();
    for (const row of settingRows) {
      const match = row.key.match(/^email_agent_(.+)$/);
      if (match) {
        try {
          const val = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
          if (val?.enabled) orgIds.add(match[1]);
        } catch {}
      }
    }

    for (const orgId of Array.from(orgIds)) {
      // Per-org lock: prevents the same org processing twice if a tick fires mid-run
      const { acquired, lockKey } = await acquireJobLock(orgId, "follow_up_cron", 55).catch(
        () => ({ acquired: true, lockKey: "" })
      );
      if (!acquired) {
        console.log(`[FollowUp Cron] org ${orgId} lock held — skipping this tick`);
        continue;
      }
      try {
        await processFollowUpsForOrg(orgId);
      } catch (e: any) {
        console.error(`[FollowUp Cron] org ${orgId} error:`, e.message);
      } finally {
        if (lockKey) await releaseJobLock(lockKey).catch(() => {});
      }
    }
  } catch (err: any) {
    console.error("[FollowUp Cron] error:", err.message);
  } finally {
    followUpCronIsRunning = false;
  }
}
