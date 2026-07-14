/**
 * Kevin Structured Responses — Step 10
 *
 * Maps TrainEfficiency control-plane results to typed chat-action blocks.
 * Kevin returns structured data when the TE interface supports it.
 *
 * Block types (14):
 *   direct_answer | recommendation | capability_unavailable | action_available
 *   draft_created | approval_required | task_delegated | task_in_progress
 *   task_completed | navigation | warning | policy_denial | failure | outcome_report
 *
 * Rules:
 *   - Never invent internal routes
 *   - Use only navigation targets returned or approved by the control plane
 *   - Never embed all actions in prose when a typed block is available
 */

import type { IntentRecord, TaskRecord, ApprovalRecord, CapabilityRecord } from "./te-client";
import type { EmergencyResponse } from "./emergency-handler";

// ─── Block types (mirror admin-kevin.tsx ActionBlock) ─────────────────────────

export type ActionBlockType =
  | "direct_answer" | "recommendation" | "capability_unavailable" | "action_available"
  | "draft_created" | "approval_required" | "task_delegated" | "task_in_progress"
  | "task_completed" | "navigation" | "warning" | "policy_denial" | "failure" | "outcome_report";

export interface BlockAction {
  label: string;
  action: "navigate" | "open_url" | "copy";
  routeKey?: string;
  url?: string;
  value?: string;
}

export interface ActionBlock {
  type: ActionBlockType;
  title: string;
  summary: string;
  confidence?: number;
  severity?: "low" | "medium" | "high";
  approvalId?: string;
  draftId?: string;
  taskId?: string;
  assignedAgent?: string;
  outcome?: string;
  denialCode?: string;
  reason?: string;
  errorCode?: string;
  retryable?: boolean;
  markdown?: string;
  actions?: BlockAction[];
}

// ─── Builders ─────────────────────────────────────────────────────────────────

export function buildDirectAnswer(title: string, summary: string, markdown?: string): ActionBlock {
  return { type: "direct_answer", title, summary, markdown };
}

export function buildRecommendation(args: { title: string; summary: string; confidence?: number; actions?: BlockAction[] }): ActionBlock {
  return { type: "recommendation", ...args };
}

export function buildCapabilityUnavailable(capabilityKey: string, reason: string): ActionBlock {
  return {
    type: "capability_unavailable",
    title: "Action Unavailable",
    summary: `The requested capability (${capabilityKey}) is not available: ${reason}`,
    reason,
  };
}

export function buildActionAvailable(cap: CapabilityRecord, actions?: BlockAction[]): ActionBlock {
  return {
    type: "action_available",
    title: cap.displayName ?? cap.key,
    summary: cap.description,
    actions,
  };
}

export function buildDraftCreated(args: { draftId?: string; recipientHint?: string; subjectHint?: string; intentId?: string }): ActionBlock {
  return {
    type: "draft_created",
    title: "Email Draft Created",
    summary: `An email draft has been created and is ready for review${args.recipientHint ? ` for ${args.recipientHint}` : ""}.`,
    draftId: args.draftId,
    actions: [
      { label: "Review Draft", action: "navigate", routeKey: "agentmail.drafts" },
    ],
  };
}

export function buildApprovalRequired(approval: ApprovalRecord): ActionBlock {
  return {
    type: "approval_required",
    title: "Action Awaiting Approval",
    summary: `This action requires human approval before proceeding. ${approval.summary ?? ""}`.trim(),
    approvalId: approval.id,
    actions: [
      { label: "Review Approval", action: "navigate", routeKey: "approvals.inbox" },
    ],
  };
}

export function buildTaskDelegated(task: TaskRecord): ActionBlock {
  return {
    type: "task_delegated",
    title: "Task Delegated to Platform Agent",
    summary: `Task delegated to ${task.assignedAgent ?? "platform agent"} for execution.`,
    taskId: task.id,
    assignedAgent: task.assignedAgent,
    actions: [{ label: "View Tasks", action: "navigate", routeKey: "admin.kevin" }],
  };
}

export function buildTaskInProgress(task: TaskRecord): ActionBlock {
  return {
    type: "task_in_progress",
    title: "Task In Progress",
    summary: `Task is being processed by ${task.assignedAgent ?? "a platform agent"}.`,
    taskId: task.id,
    assignedAgent: task.assignedAgent,
  };
}

export function buildTaskCompleted(task: TaskRecord, actions?: BlockAction[]): ActionBlock {
  return {
    type: "task_completed",
    title: "Task Completed",
    summary: `Task executed successfully by ${task.assignedAgent ?? "a platform agent"}.`,
    taskId: task.id,
    actions,
  };
}

export function buildNavigation(args: { label: string; routeKey?: string; path?: string; reason?: string }): ActionBlock {
  return {
    type: "navigation",
    title: args.label,
    summary: args.reason ?? "Navigate to the relevant section.",
    actions: args.routeKey || args.path
      ? [{ label: args.label, action: "navigate", routeKey: args.routeKey, url: args.path }]
      : [],
  };
}

export function buildWarning(args: { title: string; summary: string; severity?: "low" | "medium" | "high" }): ActionBlock {
  return { type: "warning", ...args };
}

export function buildPolicyDenial(args: { code?: string; reason?: string; capabilityKey?: string }): ActionBlock {
  return {
    type: "policy_denial",
    title: "Action Denied by Policy",
    summary: `This action is not permitted: ${args.reason ?? args.code ?? "policy violation"}`,
    denialCode: args.code,
    reason: args.reason,
  };
}

export function buildFailure(args: { title?: string; summary: string; errorCode?: string; retryable?: boolean }): ActionBlock {
  return {
    type: "failure",
    title: args.title ?? "Action Failed",
    summary: args.summary,
    errorCode: args.errorCode,
    retryable: args.retryable ?? false,
  };
}

export function buildOutcomeReport(intent: IntentRecord, outcome: string, actions?: BlockAction[]): ActionBlock {
  return {
    type: "outcome_report",
    title: "Operation Outcome",
    summary: `Intent for ${intent.capabilityKey} completed with outcome: ${outcome}.`,
    outcome,
    actions,
  };
}

export function buildEmergencyWarning(emergency: EmergencyResponse): ActionBlock {
  return {
    type: emergency.actionBlock.type as ActionBlockType,
    title: emergency.actionBlock.title,
    summary: emergency.actionBlock.summary,
    severity: (emergency.actionBlock as any).severity,
    errorCode: emergency.condition,
    retryable: false,
  };
}

// ─── Intent → Block mapping ───────────────────────────────────────────────────

/**
 * Map the current intent state to an appropriate action block for the user.
 * This is the primary way Kevin communicates structured progress to the TE chat interface.
 */
export function intentToBlock(intent: IntentRecord): ActionBlock {
  switch (intent.state) {
    case "received":
    case "validating":
    case "planned":
    case "queued":
      return buildDirectAnswer(
        "Request Received",
        `Kevin is processing your request for ${intent.capabilityKey}. Current state: ${intent.state}.`,
      );

    case "awaiting_approval": {
      const approval = intent.approvals?.[0];
      if (approval) return buildApprovalRequired(approval);
      return buildWarning({ title: "Awaiting Approval", summary: "This action requires human approval. Check the approvals inbox.", severity: "medium" });
    }

    case "executing": {
      const task = intent.tasks?.[0];
      if (task) return buildTaskInProgress(task);
      return buildDirectAnswer("Executing", `Task for ${intent.capabilityKey} is being executed.`);
    }

    case "verifying":
      return buildDirectAnswer("Verifying", "Verifying execution result before confirming completion.");

    case "completed": {
      return buildOutcomeReport(intent, "success");
    }

    case "partially_completed":
      return buildOutcomeReport(intent, "partial");

    case "failed":
      return buildFailure({ summary: `The intent for ${intent.capabilityKey} failed.`, errorCode: "INTENT_FAILED", retryable: false });

    case "cancelled":
      return buildWarning({ title: "Cancelled", summary: `The intent for ${intent.capabilityKey} was cancelled.` });

    case "dead_lettered":
      return buildFailure({ title: "Dead-Lettered", summary: `The intent for ${intent.capabilityKey} has been dead-lettered after exhausting retries.`, errorCode: "DEAD_LETTERED", retryable: false });

    default:
      return buildDirectAnswer("In Progress", `Intent state: ${intent.state}`);
  }
}

// ─── Mode → Block mapping ─────────────────────────────────────────────────────

/**
 * Step 8 — Map capability modes to the appropriate response type.
 */
export function modeToBlock(mode: string, capabilityKey: string): ActionBlock | null {
  switch (mode) {
    case "disabled":
      return buildCapabilityUnavailable(capabilityKey, "This capability is currently disabled for your organization.");
    case "observe":
      return buildDirectAnswer("Observation Only", `${capabilityKey} is available in observe mode. Kevin can retrieve and inspect but will not create side effects.`);
    case "recommend":
      return buildRecommendation({ title: "Recommendation Mode", summary: `Kevin will provide a recommendation for ${capabilityKey} without creating any side effects.` });
    case "draft":
      return buildDirectAnswer("Draft Mode", `${capabilityKey} will create a reversible draft or proposed artifact for review.`);
    case "require_approval":
      return buildWarning({ title: "Approval Required", summary: `${capabilityKey} requires human approval. Kevin will submit the action and surface the approval state.`, severity: "medium" });
    case "auto":
      return null; // proceed normally, no special user message needed
    default:
      return buildDirectAnswer("Mode Active", `${capabilityKey} operating in ${mode} mode.`);
  }
}
