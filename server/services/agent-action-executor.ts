/**
 * Agent Action Executor
 * ─────────────────────────────────────────────────────────────────────────────
 * Polls proposed Gmail agent actions every 5 minutes.
 *
 * For each action the Autonomy Policy Engine is called. The result is then
 * handled as follows:
 *
 *   blocked          → mark blocked, log reason, write timeline
 *   approval_required → mark awaiting_approval, log reason, write timeline
 *   auto_execute + EMAIL action
 *                    → DO NOT send. Route to approval queue.
 *                      Mark awaiting_approval + approvalRequired=true.
 *                      Persist autoExecuteEligible=true in `result` so the
 *                      AI Comms Center can surface it as "low-risk / auto-eligible".
 *                      Log deferred reason to timeline.
 *   auto_execute + non-email action (future)
 *                    → reserved for future use; treated as approval_required now.
 *
 * Safety contract:
 *  - executedAt is NEVER set unless an actual send has occurred.
 *  - No email action can be marked executed without a real SendGrid call.
 *  - All three outcome branches are logged (timeline + trigger event).
 */

import { db } from "../db";
import {
  gmailAgentActions,
  agentAutonomyDecisions,
  leadIntelligenceProfiles,
  type GmailAgentAction,
} from "@shared/schema";
import { eq, and, gt, sql } from "drizzle-orm";
import { evaluatePolicy } from "./autonomy-policy-engine";

let executorRunning = false;
let executorInterval: NodeJS.Timeout | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true for every action type that involves sending an email to an
 * external recipient. All current gmail_agent_actions are email actions.
 * Kept explicit so future non-email action types can opt out.
 */
function isEmailAction(action: GmailAgentAction): boolean {
  if (action.recipientEmail) return true;
  const t = action.actionType.toLowerCase();
  return (
    t.includes("email") ||
    t.includes("outreach") ||
    t.includes("follow_up") ||
    t.includes("first_response") ||
    t.startsWith("propose_draft")
  );
}

async function logTimeline(
  orgId: string,
  action: GmailAgentAction,
  outcome: "approval_required" | "auto_execute_deferred" | "blocked",
  reasons: string[],
  decisionId?: string
): Promise<void> {
  try {
    const { writeTimeline } = await import("./ceo-heartbeat-service");
    const actionStatusMap = {
      approval_required: "requires_approval",
      auto_execute_deferred: "requires_approval",
      blocked: "failed",
    } as const;

    const summaryMap = {
      approval_required: `AI draft queued for human approval — ${action.actionType}`,
      auto_execute_deferred:
        `AI draft auto-eligible but deferred to approval queue — email auto-send disabled`,
      blocked: `AI draft blocked by policy — ${reasons[0] ?? "policy check failed"}`,
    } as const;

    await writeTimeline({
      orgId,
      agentName: action.createdByAgent ?? "action_executor",
      systemName: "ActionExecutor",
      actionType: outcome === "blocked" ? "error" : "approval_required",
      actionStatus: actionStatusMap[outcome],
      communicationDomain: action.communicationDomain ?? "athlete_lead",
      relatedEntityType: "gmail_action",
      relatedEntityId: action.id,
      summary: summaryMap[outcome],
      decisionReason: reasons.join("; "),
      requiresApproval: outcome !== "blocked",
      approvalStatus: outcome !== "blocked" ? "pending" : undefined,
      errorMessage: outcome === "blocked" ? reasons.join("; ") : undefined,
      metadata: {
        policyDecision: outcome === "auto_execute_deferred" ? "auto_execute" : outcome,
        autoExecuteEligible: outcome === "auto_execute_deferred",
        autoExecuteDeferredReason:
          outcome === "auto_execute_deferred" ? "email_auto_send_disabled" : undefined,
        agentAutonomyDecisionId: decisionId,
        actionType: action.actionType,
        riskLevel: action.riskLevel,
        recipientEmail: action.recipientEmail ?? null,
      },
    });
  } catch {
    // Timeline write failures must never crash the executor
  }
}

async function logTrigger(
  orgId: string,
  action: GmailAgentAction,
  blocked: boolean,
  blockReason?: string,
  reasoning?: string
): Promise<void> {
  try {
    const { logTriggerEvent } = await import("../email-agent/trigger-logger");
    await logTriggerEvent({
      organizationId: orgId,
      triggerType: "auto_execution",
      triggerSource: "auto_exec_hook",
      actionType: "generate_draft",
      reasoning: reasoning ?? blockReason ?? "Policy evaluated by ActionExecutor",
    });
  } catch {
    // Trigger log failures must never crash the executor
  }
}

// ─── Main executor loop ────────────────────────────────────────────────────

export async function runActionExecutorCycle(): Promise<{
  evaluated: number;
  autoExecuted: number;
  awaitingApproval: number;
  autoEligibleDeferred: number;
  blocked: number;
  errors: number;
}> {
  const stats = {
    evaluated: 0,
    autoExecuted: 0,
    awaitingApproval: 0,
    autoEligibleDeferred: 0,
    blocked: 0,
    errors: 0,
  };

  // Only process actions that are still "proposed" and created in the last 24h
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
        leadId,
        actionType: action.actionType,
        recipientEmail: action.recipientEmail ?? undefined,
        confidence: 0.85,
        riskLevel: (action.riskLevel as "low" | "medium" | "high") ?? "medium",
        bodyText: action.bodyPreview ?? undefined,
        isFirstContact:
          action.actionType.includes("intake_outreach") ||
          action.actionType.includes("first_response"),
        isNewRecipient: false,
        submissionId,
      });

      const reasons = decision.reasons;
      const decisionId = decision.decisionId;

      // ── Branch: BLOCKED ──────────────────────────────────────────────────
      if (decision.decision === "blocked") {
        await db
          .update(gmailAgentActions)
          .set({
            status: "blocked",
            approvalRequired: true,
            errorMessage: `Blocked by policy: ${reasons.join("; ")}`,
            // executedAt intentionally NOT set — no send occurred
          } as any)
          .where(eq(gmailAgentActions.id, action.id));

        if (decisionId) {
          await db
            .update(agentAutonomyDecisions)
            .set({ result: "blocked" })
            .where(eq(agentAutonomyDecisions.id, decisionId));
        }

        await Promise.allSettled([
          logTimeline(action.orgId, action, "blocked", reasons, decisionId),
          logTrigger(action.orgId, action, true, reasons[0], reasons.join("; ")),
        ]);

        stats.blocked++;
        continue;
      }

      // ── Branch: AUTO_EXECUTE — email action → defer to approval queue ────
      if (decision.decision === "auto_execute" && isEmailAction(action)) {
        const deferredMeta = {
          autoExecuteEligible: true,
          autoExecuteDeferredReason: "email_auto_send_disabled",
          policyDecision: "auto_execute",
          policyReasons: reasons,
          riskLevel: action.riskLevel,
        };

        await db
          .update(gmailAgentActions)
          .set({
            status: "awaiting_approval",
            approvalRequired: true,
            result: deferredMeta,
            // executedAt intentionally NOT set — no send occurred
          } as any)
          .where(eq(gmailAgentActions.id, action.id));

        if (decisionId) {
          await db
            .update(agentAutonomyDecisions)
            .set({ result: "auto_execute_deferred" })
            .where(eq(agentAutonomyDecisions.id, decisionId));
        }

        await Promise.allSettled([
          logTimeline(action.orgId, action, "auto_execute_deferred", reasons, decisionId),
          logTrigger(
            action.orgId,
            action,
            false,
            undefined,
            "Auto-execute approved by policy but deferred — email auto-send is disabled. Queued for human approval."
          ),
        ]);

        stats.autoEligibleDeferred++;
        stats.awaitingApproval++;
        continue;
      }

      // ── Branch: APPROVAL_REQUIRED (or auto_execute for non-email) ────────
      await db
        .update(gmailAgentActions)
        .set({
          status: "awaiting_approval",
          approvalRequired: true,
          result: {
            autoExecuteEligible: false,
            policyDecision: decision.decision,
            policyReasons: reasons,
          },
          // executedAt intentionally NOT set — no send occurred
        } as any)
        .where(eq(gmailAgentActions.id, action.id));

      if (decisionId) {
        await db
          .update(agentAutonomyDecisions)
          .set({ result: "awaiting_approval" })
          .where(eq(agentAutonomyDecisions.id, decisionId));
      }

      await Promise.allSettled([
        logTimeline(action.orgId, action, "approval_required", reasons, decisionId),
        logTrigger(
          action.orgId,
          action,
          false,
          undefined,
          `Requires human approval: ${reasons.join("; ")}`
        ),
      ]);

      stats.awaitingApproval++;

    } catch (err: any) {
      stats.errors++;
      // Safe fallback: move to approval queue so nothing is lost
      await db
        .update(gmailAgentActions)
        .set({ status: "awaiting_approval", approvalRequired: true } as any)
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
          `[ActionExecutor] Cycle: ${stats.evaluated} evaluated | ` +
          `${stats.awaitingApproval} awaiting approval | ` +
          `${stats.autoEligibleDeferred} auto-eligible (deferred) | ` +
          `${stats.blocked} blocked | ` +
          `${stats.errors} errors`
        );
      }
    } catch (err: any) {
      console.error("[ActionExecutor] Cycle error:", err.message);
    }
  };

  // Run immediately on startup, then every 5 minutes
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
