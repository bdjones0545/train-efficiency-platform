/**
 * Communication Coordination Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 7 Remediation: Prevents the same prospect from being contacted by
 * multiple channels (Gmail, AgentMail, SendGrid) within a 24-hour window
 * without human awareness.
 *
 * Rules:
 * - Automated sends check the 24-hour window before proceeding.
 * - If any channel contacted this recipient recently, suppress and queue for
 *   approval with reason "Recent cross-channel contact detected."
 * - Human-approved sends (AgentMail reply queue) proceed but show a warning.
 * - Transactional emails (booking, reminders) are exempt.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

const DEFAULT_WINDOW_HOURS = 24;

export interface RecentOutboundRecord {
  id: string;
  channel: string;
  sourceSystem: string;
  subject?: string;
  status: string;
  sentAt?: string;
  createdAt: string;
}

export interface CrossChannelSuppressResult {
  suppress: boolean;
  reason?: string;
  recentContacts?: RecentOutboundRecord[];
}

function rowsOf(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  return (r as any)?.rows ?? [];
}

/**
 * Get all recent outbound communications to a recipient within the given window.
 * Returns records from outbound_email_audit_log where status = 'sent'.
 */
export async function getRecentOutboundForRecipient(
  orgId: string,
  recipientEmail: string,
  windowHours: number = DEFAULT_WINDOW_HOURS
): Promise<RecentOutboundRecord[]> {
  try {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const rows = rowsOf(await db.execute(sql`
      SELECT id, channel, source_system, subject, status, sent_at, created_at
      FROM outbound_email_audit_log
      WHERE organization_id = ${orgId}
        AND recipient_email = ${recipientEmail.toLowerCase()}
        AND status = 'sent'
        AND created_at >= ${cutoff}
      ORDER BY created_at DESC
      LIMIT 10
    `));
    return rows.map((r: any) => ({
      id: r.id,
      channel: r.channel,
      sourceSystem: r.source_system,
      subject: r.subject,
      status: r.status,
      sentAt: r.sent_at,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Check whether an automated send to this recipient should be suppressed due
 * to recent cross-channel contact.
 *
 * Returns { suppress: false } if:
 * - outbound_email_audit_log table doesn't exist yet (new install)
 * - No recent contact found
 * - DB error (fail-open for coordination — guard still catches emergency pause)
 *
 * Returns { suppress: true, reason, recentContacts } if a recent contact is found.
 */
export async function shouldSuppressCrossChannelSend(
  orgId: string,
  recipientEmail: string,
  windowHours: number = DEFAULT_WINDOW_HOURS
): Promise<CrossChannelSuppressResult> {
  try {
    const recent = await getRecentOutboundForRecipient(orgId, recipientEmail, windowHours);
    if (recent.length === 0) return { suppress: false };

    const latest = recent[0];
    const channelLabel = latest.channel === "agentmail" ? "AgentMail" :
                         latest.channel === "gmail" ? "Gmail" : "SendGrid";
    const systemLabel = latest.sourceSystem.replace(/_/g, " ");
    const when = latest.sentAt
      ? new Date(latest.sentAt).toLocaleString()
      : new Date(latest.createdAt).toLocaleString();

    return {
      suppress: true,
      reason: `Recent cross-channel contact detected: contacted via ${channelLabel} (${systemLabel}) at ${when}. Queued for human review.`,
      recentContacts: recent,
    };
  } catch {
    return { suppress: false };
  }
}

/**
 * Record an outbound communication touch for cross-channel coordination.
 * Called after every successful send from any channel.
 * Wraps outbound_email_audit_log which is the source of truth.
 */
export async function recordOutboundTouch(
  orgId: string,
  recipientEmail: string,
  channel: "sendgrid" | "gmail" | "agentmail",
  subject: string,
  sourceSystem: string
): Promise<void> {
  // The actual write happens in writeOutboundAuditLog — this is a no-op
  // coordination signal that can be extended if a separate touches table is needed.
  // Currently the getRecentOutboundForRecipient function reads from outbound_email_audit_log
  // which is already written by guarded-outbound-email.ts and email-audit-routes.ts
  void orgId; void recipientEmail; void channel; void subject; void sourceSystem;
}

/**
 * Get a summary of last touch across all channels for a recipient.
 * Used for UI display in approval UIs.
 */
export async function getLastTouchSummary(
  orgId: string,
  recipientEmail: string
): Promise<{ hasRecentContact: boolean; summary?: string; lastChannel?: string; lastAt?: string }> {
  try {
    const recent = await getRecentOutboundForRecipient(orgId, recipientEmail, 72);
    if (recent.length === 0) return { hasRecentContact: false };

    const latest = recent[0];
    const channelLabel = latest.channel === "agentmail" ? "AgentMail" :
                         latest.channel === "gmail" ? "Gmail" : "SendGrid";
    const when = latest.sentAt || latest.createdAt;
    const hoursAgo = Math.round((Date.now() - new Date(when).getTime()) / 3600000);

    return {
      hasRecentContact: true,
      summary: `Last contacted via ${channelLabel} ${hoursAgo}h ago — "${(latest.subject ?? "no subject").slice(0, 60)}"`,
      lastChannel: latest.channel,
      lastAt: when,
    };
  } catch {
    return { hasRecentContact: false };
  }
}
