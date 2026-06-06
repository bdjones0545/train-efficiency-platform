/**
 * Guarded Outbound Email Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4 Remediation: Wraps all automated SendGrid outreach sends with the
 * full guard chain before any email leaves the system:
 *
 *   1. Emergency pause (org-wide halt)
 *   2. Suppression / opt-out (legal)
 *   3. Daily email cap (burst prevention)
 *   4. Cross-channel coordination (24-hour window, Phase 7)
 *   5. Audit log write (Phase 6)
 *
 * All automated cron paths (follow-up-cron, auto-execution-engine,
 * scheduled-email-agent) MUST use these helpers instead of calling
 * sendTeamTrainingOutreachEmail() directly.
 *
 * Transactional emails (booking confirmations, reminders, password resets)
 * are intentionally NOT routed here — they keep their existing inline guards
 * inside sendEmail() and should not be subject to outreach daily caps.
 */

import { sendTeamTrainingOutreachEmail, sendAgentOutreachEmail, type OrgBranding } from "../email";
import { checkHumanApprovedSendGuards } from "./send-guard-service";
import { shouldSuppressCrossChannelSend, recordOutboundTouch } from "./communication-coordination-service";
import { writeOutboundAuditLog } from "./outbound-audit-log";

export interface GuardedSendResult {
  sent: boolean;
  blocked: boolean;
  blockReason?: string;
  blockType?: "emergency_pause" | "suppressed" | "daily_cap" | "cross_channel";
  auditId?: string;
}

export interface GuardedSendOpts {
  orgId: string;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  body: string;
  branding?: OrgBranding;
  trackingId?: string;
  replyTo?: string;
  sourceSystem: string;
  sourceRecordId?: string;
  triggeredBy: "cron" | "auto_execute" | "agent_tool" | "human_approved";
  emailType: "follow_up" | "initial_outreach" | "agent_outreach";
  policyDecision?: "auto_execute" | "approval_required" | "blocked";
  isTransactionalExempt?: boolean;
}

/**
 * Send a team-training outreach email through the full guard chain.
 * Returns { sent: false, blocked: true, blockReason } if any guard fails.
 */
export async function guardedSendTeamTrainingOutreachEmail(
  opts: GuardedSendOpts
): Promise<GuardedSendResult> {
  const {
    orgId,
    recipientEmail,
    subject,
    body,
    branding,
    trackingId,
    replyTo,
    sourceSystem,
    sourceRecordId,
    triggeredBy,
    emailType,
    policyDecision,
  } = opts;

  // ── 1-3: Send Guard checks (emergency pause + suppression + daily cap) ──────
  let guardResult: GuardedSendResult["blockType"] | "passed" = "passed";
  const guard = await checkHumanApprovedSendGuards(orgId, recipientEmail).catch((e) => {
    console.warn(`[GuardedSend] Send guard error for org ${orgId}:`, e.message);
    return { blocked: false };
  });

  if (guard.blocked) {
    guardResult = (guard.blockType as GuardedSendResult["blockType"]) ?? "suppressed";
    console.warn(`[GuardedSend] BLOCKED (${guardResult}): ${recipientEmail} — ${guard.reason}`);
    await writeOutboundAuditLog({
      orgId,
      channel: "sendgrid",
      sourceSystem,
      sourceRecordId,
      recipientEmail,
      recipientName: opts.recipientName,
      subject,
      emailType,
      triggeredBy,
      autoSent: triggeredBy !== "human_approved",
      approvalRequired: false,
      approvalStatus: "n/a",
      policyDecision,
      guardResult: `blocked_${guardResult}`,
      status: "blocked",
      errorMessage: guard.reason,
    });
    return { sent: false, blocked: true, blockReason: guard.reason, blockType: guardResult };
  }

  // ── 4: Cross-channel coordination (24-hour window) ─────────────────────────
  if (triggeredBy !== "human_approved") {
    const crossChannel = await shouldSuppressCrossChannelSend(orgId, recipientEmail).catch(() => ({
      suppress: false,
    }));
    if (crossChannel.suppress) {
      guardResult = "cross_channel";
      const reason = crossChannel.reason ?? "Recent cross-channel contact detected";
      console.warn(`[GuardedSend] BLOCKED (cross_channel): ${recipientEmail} — ${reason}`);
      await writeOutboundAuditLog({
        orgId,
        channel: "sendgrid",
        sourceSystem,
        sourceRecordId,
        recipientEmail,
        recipientName: opts.recipientName,
        subject,
        emailType,
        triggeredBy,
        autoSent: true,
        approvalRequired: false,
        approvalStatus: "n/a",
        policyDecision,
        guardResult: "blocked_cross_channel",
        status: "blocked",
        errorMessage: reason,
      });
      return { sent: false, blocked: true, blockReason: reason, blockType: "cross_channel" };
    }
  }

  // ── 5: Send ────────────────────────────────────────────────────────────────
  let providerMessageId: string | undefined;
  try {
    await sendTeamTrainingOutreachEmail(recipientEmail, subject, body, branding, trackingId, replyTo);
    console.log(`[GuardedSend] SENT via SendGrid to ${recipientEmail} (${sourceSystem})`);
  } catch (e: any) {
    console.error(`[GuardedSend] Send failed for ${recipientEmail}:`, e.message);
    await writeOutboundAuditLog({
      orgId,
      channel: "sendgrid",
      sourceSystem,
      sourceRecordId,
      recipientEmail,
      recipientName: opts.recipientName,
      subject,
      emailType,
      triggeredBy,
      autoSent: triggeredBy !== "human_approved",
      approvalRequired: false,
      approvalStatus: "n/a",
      policyDecision,
      guardResult: "passed",
      status: "failed",
      errorMessage: e.message,
    });
    throw e;
  }

  // ── 6: Audit log ───────────────────────────────────────────────────────────
  const auditId = await writeOutboundAuditLog({
    orgId,
    channel: "sendgrid",
    sourceSystem,
    sourceRecordId,
    recipientEmail,
    recipientName: opts.recipientName,
    subject,
    emailType,
    triggeredBy,
    autoSent: triggeredBy !== "human_approved",
    approvalRequired: false,
    approvalStatus: "n/a",
    policyDecision,
    guardResult: "passed",
    status: "sent",
    sentAt: new Date(),
  }).catch(() => undefined);

  // ── 7: Record cross-channel touch ──────────────────────────────────────────
  await recordOutboundTouch(orgId, recipientEmail, "sendgrid", subject, sourceSystem).catch(() => {});

  return { sent: true, blocked: false, auditId };
}

/**
 * Send an agent outreach email (sendAgentOutreachEmail) through the guard chain.
 * Used for non-B2B prospect outreach (client re-engagement, etc.).
 */
export async function guardedSendAgentOutreachEmail(opts: {
  orgId: string;
  clientEmail: string;
  clientFirstName: string;
  emailSubject: string;
  emailBody: string;
  branding?: OrgBranding;
  sourceSystem: string;
  sourceRecordId?: string;
}): Promise<GuardedSendResult> {
  const guard = await checkHumanApprovedSendGuards(opts.orgId, opts.clientEmail).catch(() => ({
    blocked: false,
  }));

  if (guard.blocked) {
    console.warn(`[GuardedSend] AgentOutreach BLOCKED for ${opts.clientEmail}: ${guard.reason}`);
    return { sent: false, blocked: true, blockReason: guard.reason, blockType: guard.blockType };
  }

  try {
    await sendAgentOutreachEmail(opts.clientEmail, opts.clientFirstName, opts.emailSubject, opts.emailBody, opts.branding);
  } catch (e: any) {
    return { sent: false, blocked: false, blockReason: e.message };
  }

  await writeOutboundAuditLog({
    orgId: opts.orgId,
    channel: "sendgrid",
    sourceSystem: opts.sourceSystem,
    sourceRecordId: opts.sourceRecordId,
    recipientEmail: opts.clientEmail,
    recipientName: opts.clientFirstName,
    subject: opts.emailSubject,
    emailType: "agent_outreach",
    triggeredBy: "auto_execute",
    autoSent: true,
    approvalRequired: false,
    approvalStatus: "n/a",
    guardResult: "passed",
    status: "sent",
    sentAt: new Date(),
  }).catch(() => {});

  await recordOutboundTouch(opts.orgId, opts.clientEmail, "sendgrid", opts.emailSubject, opts.sourceSystem).catch(() => {});

  return { sent: true, blocked: false };
}
