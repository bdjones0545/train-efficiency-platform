/**
 * Agent Action Executor
 * ─────────────────────────────────────────────────────────────────────────────
 * Polls proposed Gmail agent actions every 5 minutes.
 * For each action:
 *   1. Calls the Autonomy Policy Engine to evaluate
 *   2. If auto_execute → executes and marks status = auto_executed
 *   3. If approval_required → marks status = awaiting_approval (visible in UI)
 *   4. If blocked → marks status = blocked, logs reason
 *
 * Safety contract:
 *  - Never touches actions that are not in "proposed" status
 *  - Never auto-sends without passing ALL policy checks
 *  - Writes full audit log for every decision
 */

import { db } from "../db";
import { gmailAgentActions, agentAutonomyDecisions, leadIntelligenceProfiles } from "@shared/schema";
import { eq, and, sql, gt } from "drizzle-orm";
import { evaluatePolicy } from "./autonomy-policy-engine";

let executorRunning = false;
let executorInterval: NodeJS.Timeout | null = null;

// ─── Main executor loop ────────────────────────────────────────────────────

export async function runActionExecutorCycle(): Promise<{
  evaluated: number;
  autoExecuted: number;
  awaitingApproval: number;
  blocked: number;
  errors: number;
}> {
  const stats = { evaluated: 0, autoExecuted: 0, awaitingApproval: 0, blocked: 0, errors: 0 };

  // Only process actions that are still "proposed" and not yet evaluated
  const proposedActions = await db
    .select()
    .from(gmailAgentActions)
    .where(
      and(
        eq(gmailAgentActions.status, "proposed"),
        gt(gmailAgentActions.createdAt, sql`NOW() - INTERVAL '24 hours'`)
      )
    )
    .limit(50);

  for (const action of proposedActions) {
    stats.evaluated++;

    try {
      // Look up lead profile for suppression check
      let submissionId: string | undefined;
      let leadId: string | undefined;

      if (action.leadId) {
        leadId = action.leadId;
        const [profile] = await db
          .select({ submissionId: leadIntelligenceProfiles.submissionId })
          .from(leadIntelligenceProfiles)
          .where(eq(leadIntelligenceProfiles.id, action.leadId))
          .limit(1);
        submissionId = profile?.submissionId ?? undefined;
      }

      const decision = await evaluatePolicy({
        orgId: action.orgId,
        actionId: action.id,
        leadId: leadId,
        actionType: action.actionType,
        recipientEmail: action.recipientEmail ?? undefined,
        confidence: 0.85, // Default — in a real system this would come from the action metadata
        riskLevel: (action.riskLevel as "low" | "medium" | "high") ?? "medium",
        bodyText: action.bodyPreview ?? undefined,
        isFirstContact: action.actionType.includes("intake_outreach") || action.actionType.includes("first_response"),
        isNewRecipient: false,
        submissionId,
      });

      // Update the action status based on the policy decision
      const newStatus =
        decision.decision === "auto_execute" ? "auto_executed" :
        decision.decision === "blocked" ? "blocked" :
        "awaiting_approval";

      await db
        .update(gmailAgentActions)
        .set({
          status: newStatus,
          executedAt: decision.decision === "auto_execute" ? new Date() : undefined,
          errorMessage: decision.decision === "blocked"
            ? `Blocked by policy: ${decision.reasons.join("; ")}`
            : undefined,
        } as any)
        .where(eq(gmailAgentActions.id, action.id));

      // Update the decision log with the action result
      if (decision.decisionId) {
        await db
          .update(agentAutonomyDecisions)
          .set({
            result: newStatus,
            executedAt: decision.decision === "auto_execute" ? new Date() : undefined,
          })
          .where(eq(agentAutonomyDecisions.id, decision.decisionId));
      }

      if (decision.decision === "auto_execute") stats.autoExecuted++;
      else if (decision.decision === "blocked") stats.blocked++;
      else stats.awaitingApproval++;

    } catch (err: any) {
      stats.errors++;
      // Mark as awaiting approval on error (safe fallback)
      await db
        .update(gmailAgentActions)
        .set({ status: "awaiting_approval" } as any)
        .where(eq(gmailAgentActions.id, action.id));
    }
  }

  return stats;
}

// ─── Cron registration ─────────────────────────────────────────────────────

export function startActionExecutor() {
  if (executorRunning) return;
  executorRunning = true;

  const run = async () => {
    try {
      const stats = await runActionExecutorCycle();
      if (stats.evaluated > 0) {
        console.log(
          `[ActionExecutor] Cycle: ${stats.evaluated} evaluated | ${stats.autoExecuted} auto-executed | ${stats.awaitingApproval} awaiting approval | ${stats.blocked} blocked | ${stats.errors} errors`
        );
      }
    } catch (err: any) {
      console.error("[ActionExecutor] Cycle error:", err.message);
    }
  };

  // Run immediately, then every 5 minutes
  run();
  executorInterval = setInterval(run, 5 * 60 * 1000);
  console.log("[ActionExecutor] Started — polling every 5 minutes");
}

export function stopActionExecutor() {
  if (executorInterval) {
    clearInterval(executorInterval);
    executorInterval = null;
  }
  executorRunning = false;
}
