/**
 * AgentMail Send Guard — Sprint 1 Safety Fix
 *
 * Centralized policy gate before any AgentMail outbound send.
 * Called by sendAgentEmail() and replyFromAgentInbox() before hitting the API.
 *
 * Decision hierarchy:
 *  1. Emergency pause active → BLOCK (hardest stop)
 *  2. neverAutoSend=true + humanApproved=false → BLOCK (autonomous sends disabled)
 *  3. allowAutonomousCommunication=false + humanApproved=false → BLOCK
 *  4. Otherwise → ALLOW
 *
 * Blocked sends are logged to outbound_email_audit_log (never throws).
 */

import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import { orgAiGovernanceSettings, orgAutomationSettings } from "@shared/schema";
import { writeOutboundAuditLog } from "./outbound-audit-log";

export interface SendGuardContext {
  orgId: string;
  agentName: string;
  fromInbox: string;
  toEmail: string;
  subject: string;
  bodyPreview?: string;
  humanApproved?: boolean;
  sourceSystem?: string;
  sourceRecordId?: string;
  actionQueueId?: string;
  gmailThreadId?: string;
}

export interface SendGuardResult {
  allowed: boolean;
  reason?: string;
  policyDecision: "allow" | "block_emergency_pause" | "block_auto_send_disabled" | "block_autonomous_communication_disabled";
}

export async function checkAgentMailSendPolicy(
  ctx: SendGuardContext,
): Promise<SendGuardResult> {
  try {
    const [gov] = await db
      .select({
        emergencyPauseEnabled: orgAiGovernanceSettings.emergencyPauseEnabled,
        emergencyPauseReason: orgAiGovernanceSettings.emergencyPauseReason,
        allowAutonomousCommunication: orgAiGovernanceSettings.allowAutonomousCommunication,
      })
      .from(orgAiGovernanceSettings)
      .where(eq(orgAiGovernanceSettings.orgId, ctx.orgId))
      .catch(() => []);

    const [auto] = await db
      .select({
        neverAutoSend: orgAutomationSettings.neverAutoSend,
        autoSendFirstResponse: orgAutomationSettings.autoSendFirstResponse,
      })
      .from(orgAutomationSettings)
      .where(eq(orgAutomationSettings.orgId, ctx.orgId))
      .catch(() => []);

    const isHumanApproved = ctx.humanApproved === true;

    if (gov?.emergencyPauseEnabled) {
      const reason = gov.emergencyPauseReason ?? "Emergency pause is active for this organization";
      await logBlocked(ctx, "block_emergency_pause", reason);
      return { allowed: false, reason, policyDecision: "block_emergency_pause" };
    }

    if (!isHumanApproved) {
      const neverAutoSend = auto?.neverAutoSend !== false;
      if (neverAutoSend) {
        const reason = "Autonomous AgentMail sends are disabled (neverAutoSend=true). Human approval required.";
        await logBlocked(ctx, "block_auto_send_disabled", reason);
        return { allowed: false, reason, policyDecision: "block_auto_send_disabled" };
      }

      const allowAutonomous = gov?.allowAutonomousCommunication === true;
      if (!allowAutonomous) {
        const reason = "Autonomous communication is not enabled for this organization. Human approval required.";
        await logBlocked(ctx, "block_autonomous_communication_disabled", reason);
        return { allowed: false, reason, policyDecision: "block_autonomous_communication_disabled" };
      }
    }

    return { allowed: true, policyDecision: "allow" };
  } catch (err: any) {
    console.error("[AgentMailSendGuard] Policy check error — defaulting to BLOCK:", err?.message);
    await logBlocked(ctx, "block_emergency_pause", `Policy check failed: ${err?.message ?? "unknown error"}`).catch(() => {});
    return {
      allowed: false,
      reason: `Policy check failed: ${err?.message ?? "unknown error"}. Defaulting to blocked for safety.`,
      policyDecision: "block_emergency_pause",
    };
  }
}

async function logBlocked(
  ctx: SendGuardContext,
  policyDecision: string,
  reason: string,
): Promise<void> {
  try {
    await writeOutboundAuditLog({
      orgId: ctx.orgId,
      channel: "agentmail",
      sourceSystem: ctx.sourceSystem ?? ctx.agentName,
      sourceRecordId: ctx.sourceRecordId,
      recipientEmail: ctx.toEmail,
      subject: ctx.subject,
      emailType: "agentmail_outbound",
      triggeredBy: ctx.agentName,
      autoSent: false,
      approvalRequired: true,
      approvalStatus: "requires_approval",
      policyDecision,
      guardResult: reason,
      status: "blocked",
      errorMessage: reason,
      actionQueueId: ctx.actionQueueId,
      gmailThreadId: ctx.gmailThreadId,
    });
  } catch (e: any) {
    console.error("[AgentMailSendGuard] Failed to log blocked send:", e?.message);
  }
}
