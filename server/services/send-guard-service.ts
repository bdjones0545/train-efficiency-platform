/**
 * Send Guard Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight pre-send safety checks for HUMAN-APPROVED send paths (Gmail
 * approval, team-training send, old outreach send).  Automated paths use
 * evaluatePolicy() from autonomy-policy-engine instead — this is a targeted
 * guard for the three checks that must hold even when a human clicks "Send":
 *
 *   1. Emergency pause — org-wide halt (compliance/legal)
 *   2. Suppression / opt-out — recipient asked not to be contacted (legal)
 *   3. Daily email cap — prevent burst even through the UI
 *
 * All checks are fail-open (safe default) if DB is unreachable.
 */

import { db } from "../db";
import { orgAiGovernanceSettings, agentAutonomyDecisions, gmailAgentActions, prospectOptOuts } from "@shared/schema";
import { eq, and, gte, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface SendGuardResult {
  blocked: boolean;
  reason?: string;
  blockType?: "emergency_pause" | "suppressed" | "daily_cap";
}

// ─── Exported main guard ───────────────────────────────────────────────────

/**
 * Run all baseline send guards for a human-approved send.
 * Returns { blocked: false } if all checks pass.
 * Returns { blocked: true, reason, blockType } if any check fails.
 */
export async function checkHumanApprovedSendGuards(
  orgId: string,
  recipientEmail: string
): Promise<SendGuardResult> {
  // ── 1. Emergency pause ─────────────────────────────────────────────────
  try {
    const [gov] = await db
      .select({
        emergencyPauseEnabled: orgAiGovernanceSettings.emergencyPauseEnabled,
        emergencyPauseReason: orgAiGovernanceSettings.emergencyPauseReason,
      })
      .from(orgAiGovernanceSettings)
      .where(eq(orgAiGovernanceSettings.orgId, orgId))
      .limit(1);

    if (gov?.emergencyPauseEnabled) {
      return {
        blocked: true,
        blockType: "emergency_pause",
        reason: `Emergency pause active: ${gov.emergencyPauseReason || "no reason given"}`,
      };
    }
  } catch (e: any) {
    console.warn(`[SendGuard] Emergency pause check error for org ${orgId}: ${e.message}`);
  }

  // ── 2. Suppression / opt-out ───────────────────────────────────────────
  try {
    const [row] = await db
      .select({ id: prospectOptOuts.id })
      .from(prospectOptOuts)
      .where(
        and(
          eq(prospectOptOuts.orgId, orgId),
          eq(prospectOptOuts.email, recipientEmail.toLowerCase())
        )
      )
      .limit(1);

    if (row) {
      return {
        blocked: true,
        blockType: "suppressed",
        reason: "Recipient is on the suppression / opt-out list",
      };
    }
  } catch (e: any) {
    console.warn(`[SendGuard] Suppression check error for org ${orgId}: ${e.message}`);
  }

  // ── 3. Daily email cap ─────────────────────────────────────────────────
  try {
    const cap = await getOrgDailyEmailCap(orgId);
    const count = await countTodaysSentEmails(orgId);
    if (count >= cap) {
      return {
        blocked: true,
        blockType: "daily_cap",
        reason: `Daily email cap reached (${count}/${cap} sent today)`,
      };
    }
  } catch (e: any) {
    console.warn(`[SendGuard] Daily cap check error for org ${orgId}: ${e.message}`);
  }

  return { blocked: false };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getOrgDailyEmailCap(orgId: string): Promise<number> {
  try {
    const rows = await db.execute(
      sql`SELECT daily_email_cap FROM org_automation_settings WHERE org_id = ${orgId} LIMIT 1`
    );
    const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return parseInt(data[0]?.daily_email_cap ?? "50", 10) || 50;
  } catch {
    return 50; // safe default
  }
}

async function countTodaysSentEmails(orgId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Count auto_execute decisions from the policy engine
  const [policyRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentAutonomyDecisions)
    .where(
      and(
        eq(agentAutonomyDecisions.orgId, orgId),
        gte(agentAutonomyDecisions.createdAt, startOfDay),
        sql`${agentAutonomyDecisions.decision} = 'auto_execute'`
      )
    );

  // Count human-approved sends through gmail_agent_actions
  const [gmailRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gmailAgentActions)
    .where(
      and(
        eq(gmailAgentActions.orgId, orgId),
        gte(gmailAgentActions.createdAt as any, startOfDay),
        sql`${gmailAgentActions.status} IN ('executed', 'auto_executed')`
      )
    );

  return (policyRow?.count ?? 0) + (gmailRow?.count ?? 0);
}

// ─── Utility: check only emergency pause (for paths that have suppression elsewhere) ─

export async function checkEmergencyPause(orgId: string): Promise<SendGuardResult> {
  try {
    const [gov] = await db
      .select({
        emergencyPauseEnabled: orgAiGovernanceSettings.emergencyPauseEnabled,
        emergencyPauseReason: orgAiGovernanceSettings.emergencyPauseReason,
      })
      .from(orgAiGovernanceSettings)
      .where(eq(orgAiGovernanceSettings.orgId, orgId))
      .limit(1);

    if (gov?.emergencyPauseEnabled) {
      return {
        blocked: true,
        blockType: "emergency_pause",
        reason: `Emergency pause active: ${gov.emergencyPauseReason || "no reason given"}`,
      };
    }
  } catch (e: any) {
    console.warn(`[SendGuard] Emergency pause check error for org ${orgId}: ${e.message}`);
  }
  return { blocked: false };
}
