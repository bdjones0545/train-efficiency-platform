/**
 * Workflow Definitions — 5 canonical workflow types.
 * Pure data structures; no DB access.
 * Each step's buildInput receives the current WorkflowContext so later steps
 * can reference outputs from earlier ones (e.g. the draft created in step 1).
 */

export type WorkflowContext = {
  entityType?: string;
  entityId?: string;
  entityName?: string;
  triggerReason?: string;
  orgId?: string;
  [key: string]: any;
};

export type StepType =
  | "tool_call"
  | "wait_confirmation"
  | "wait_time"
  | "check_response"
  | "branch"
  | "complete"
  | "notify";

export type StepConfig =
  | {
      type: "tool_call";
      toolName: string;
      description: string;
      buildInput: (ctx: WorkflowContext) => Record<string, any>;
      maxRetries?: number;
    }
  | {
      type: "wait_confirmation";
      description: string;
      prompt: string;
    }
  | {
      type: "wait_time";
      description: string;
      days: number;
    }
  | {
      type: "check_response";
      description: string;
      checkFn?: string;
    }
  | {
      type: "branch";
      description: string;
      condition: string;
      trueStepIndex: number;
      falseStepIndex: number;
    }
  | {
      type: "complete";
      description: string;
      outcomeLabel?: string;
    }
  | {
      type: "notify";
      description: string;
      message: string;
    };

export type WorkflowStepDefinition = {
  index: number;
  name: string;
} & StepConfig;

export type WorkflowDefinition = {
  type: string;
  displayName: string;
  description: string;
  category: "sales" | "retention" | "scheduling" | "operations" | "finance";
  estimatedDays: number;
  triggerEvent: string;
  steps: WorkflowStepDefinition[];
};

// ─── Helper builders ──────────────────────────────────────────────────────────

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─── 1. Recover Stalled Deal ──────────────────────────────────────────────────

const recoverStalledDeal: WorkflowDefinition = {
  type: "recover_stalled_deal",
  displayName: "Recover Stalled Deal",
  description: "Re-engage a prospect with a stalled deal via personalized outreach, then follow up with SMS if no response.",
  category: "sales",
  estimatedDays: 7,
  triggerEvent: "deal_stalled",
  steps: [
    {
      index: 0,
      name: "Generate outreach email draft",
      type: "tool_call",
      toolName: "create_email_draft",
      description: "AI generates a personalized re-engagement email for the stalled deal",
      buildInput: (ctx) => ({
        subject: `Following up — ${ctx.entityName ?? "your program"}`,
        body: `Hi${ctx.entityName ? ` ${ctx.entityName}` : ""},\n\nI wanted to follow up on our recent conversation about your strength and conditioning program. ${ctx.triggerReason ?? "We have some exciting options that might be a great fit."}\n\nWould you be open to a quick 15-minute call this week to explore the next steps?\n\nBest,`,
        draftType: "follow_up",
        dealId: ctx.dealId,
        prospectId: ctx.prospectId,
        recipientName: ctx.entityName,
      }),
    },
    {
      index: 1,
      name: "Wait for email approval",
      type: "wait_confirmation",
      description: "Admin reviews and approves the draft before sending",
      prompt: "Review and approve this outreach email before it is sent to the prospect.",
    },
    {
      index: 2,
      name: "Send approved email",
      type: "tool_call",
      toolName: "send_email",
      description: "Sends the approved outreach email",
      buildInput: (ctx) => ({
        to: ctx.prospectEmail ?? ctx.entityEmail ?? "contact@prospect.com",
        subject: ctx.draftSubject ?? `Following up — ${ctx.entityName ?? "your program"}`,
        html: `<p>${(ctx.draftBody ?? "").replace(/\n/g, "<br>")}</p>`,
        orgId: ctx.orgId,
      }),
      maxRetries: 2,
    },
    {
      index: 3,
      name: "Wait 3 days for response",
      type: "wait_time",
      description: "Pause 3 days to give the prospect time to respond",
      days: 3,
    },
    {
      index: 4,
      name: "Check for deal response",
      type: "check_response",
      description: "Check whether the deal has moved or prospect has responded",
      checkFn: "deal_activity",
    },
    {
      index: 5,
      name: "Branch: responded or not",
      type: "branch",
      description: "If response detected, advance deal. Otherwise start SMS follow-up.",
      condition: "hasResponse",
      trueStepIndex: 9,
      falseStepIndex: 6,
    },
    {
      index: 6,
      name: "Generate SMS follow-up draft",
      type: "tool_call",
      toolName: "create_sms_draft",
      description: "Generate a brief follow-up SMS since email went unanswered",
      buildInput: (ctx) => ({
        body: `Hi${ctx.entityName ? ` ${ctx.entityName}` : ""}! Just following up on our S&C program proposal. Would love to connect — are you available for a quick chat? Reply STOP to opt out.`,
        draftType: "follow_up",
        prospectId: ctx.prospectId,
      }),
    },
    {
      index: 7,
      name: "Wait for SMS approval",
      type: "wait_confirmation",
      description: "Admin reviews and approves the SMS",
      prompt: "Review and approve this follow-up SMS before sending.",
    },
    {
      index: 8,
      name: "Send approved SMS",
      type: "tool_call",
      toolName: "send_sms",
      description: "Sends the approved follow-up SMS",
      buildInput: (ctx) => ({
        to: ctx.prospectPhone ?? ctx.entityPhone ?? "+10000000000",
        body: ctx.smsDraftBody ?? `Hi ${ctx.entityName ?? ""}! Just following up on our proposal. Would love to connect — reply STOP to opt out.`,
        orgId: ctx.orgId,
      }),
      maxRetries: 2,
    },
    {
      index: 9,
      name: "Log deal activity",
      type: "tool_call",
      toolName: "log_activity",
      description: "Record the outreach sequence in the deal timeline",
      buildInput: (ctx) => ({
        dealId: ctx.dealId,
        activityType: "workflow",
        summary: `Stalled deal recovery workflow completed. Email sent${ctx.smsSent ? ", SMS sent" : ""}. Response: ${ctx.hasResponse ? "Yes" : "No"}`,
      }),
    },
    {
      index: 10,
      name: "Complete workflow",
      type: "complete",
      description: "Workflow complete",
      outcomeLabel: ctx => ctx.hasResponse ? "responded" : "no_response",
    } as any,
  ],
};

// ─── 2. Re-engage Inactive Client ─────────────────────────────────────────────

const reengageInactiveClient: WorkflowDefinition = {
  type: "reengage_inactive_client",
  displayName: "Re-engage Inactive Client",
  description: "Reach out to a client who has gone inactive, with a personal email and a follow-up task if no response.",
  category: "retention",
  estimatedDays: 7,
  triggerEvent: "client_inactive",
  steps: [
    {
      index: 0,
      name: "Generate re-engagement email",
      type: "tool_call",
      toolName: "create_email_draft",
      description: "Generate a warm re-engagement email for the inactive client",
      buildInput: (ctx) => ({
        subject: `Checking in — ${ctx.entityName ?? "your training"}`,
        body: `Hi ${ctx.entityName ?? ""},\n\nI hope you're doing well! We noticed you haven't been in recently and wanted to check in. ${ctx.triggerReason ?? "We miss having you around!"}\n\nWould you like to get back on track? We have some great sessions available and would love to see you back.\n\nLet me know if you'd like to chat — I'm happy to help you get back into a rhythm.\n\nBest,`,
        draftType: "re_engage",
        recipientName: ctx.entityName,
      }),
    },
    {
      index: 1,
      name: "Wait for email approval",
      type: "wait_confirmation",
      description: "Review the re-engagement email before sending",
      prompt: "Review and approve this re-engagement email before it is sent to the client.",
    },
    {
      index: 2,
      name: "Send re-engagement email",
      type: "tool_call",
      toolName: "send_email",
      description: "Send the approved re-engagement email",
      buildInput: (ctx) => ({
        to: ctx.clientEmail ?? ctx.entityEmail ?? "client@example.com",
        subject: ctx.draftSubject ?? `Checking in — ${ctx.entityName ?? "your training"}`,
        html: `<p>${(ctx.draftBody ?? "").replace(/\n/g, "<br>")}</p>`,
        orgId: ctx.orgId,
      }),
      maxRetries: 2,
    },
    {
      index: 3,
      name: "Wait 5 days for response",
      type: "wait_time",
      description: "Give the client 5 days to respond",
      days: 5,
    },
    {
      index: 4,
      name: "Check if client responded",
      type: "check_response",
      description: "Check whether the client has booked or responded",
      checkFn: "client_activity",
    },
    {
      index: 5,
      name: "Branch: responded or not",
      type: "branch",
      description: "If responded, update client status. Otherwise, create follow-up task.",
      condition: "hasResponse",
      trueStepIndex: 6,
      falseStepIndex: 7,
    },
    {
      index: 6,
      name: "Update client status — active",
      type: "tool_call",
      toolName: "update_client_status",
      description: "Mark client as active after successful re-engagement",
      buildInput: (ctx) => ({
        clientId: ctx.entityId,
        newStatus: "active",
        note: "Re-engaged via workflow",
      }),
    },
    {
      index: 7,
      name: "Create follow-up task",
      type: "tool_call",
      toolName: "create_follow_up_task",
      description: "Schedule a personal follow-up call if email went unanswered",
      buildInput: (ctx) => ({
        followUpDate: tomorrow(),
        note: `Personal follow-up call needed — ${ctx.entityName ?? "client"} did not respond to re-engagement email.`,
        priority: "high",
      }),
    },
    {
      index: 8,
      name: "Complete workflow",
      type: "complete",
      description: "Workflow complete",
      outcomeLabel: "re_engage_attempted",
    },
  ],
};

// ─── 3. Fill Schedule Gap ─────────────────────────────────────────────────────

const fillScheduleGap: WorkflowDefinition = {
  type: "fill_schedule_gap",
  displayName: "Fill Schedule Gap",
  description: "Identify the best leads to contact for an open session slot and send outreach.",
  category: "scheduling",
  estimatedDays: 2,
  triggerEvent: "schedule_gap_detected",
  steps: [
    {
      index: 0,
      name: "Create prospect follow-up task",
      type: "tool_call",
      toolName: "create_follow_up_task",
      description: "Create a task to identify warm prospects for the open slot",
      buildInput: (ctx) => ({
        followUpDate: tomorrow(),
        note: `Review warm leads for open slot: ${ctx.triggerReason ?? "schedule gap detected"}. Contact top 3 prospects.`,
        priority: "medium",
      }),
    },
    {
      index: 1,
      name: "Generate slot-fill outreach email",
      type: "tool_call",
      toolName: "create_email_draft",
      description: "Generate a targeted email to a warm lead about the available slot",
      buildInput: (ctx) => ({
        subject: `Limited availability — ${ctx.entityName ?? "exclusive S&C session"} opening`,
        body: `Hi${ctx.entityName ? ` ${ctx.entityName}` : ""},\n\n${ctx.triggerReason ?? "We have an exclusive opening in our S&C program."}\n\nThis slot fills up quickly — would you like to secure your spot? Reply to this email or book directly.\n\nBest,`,
        draftType: "outreach",
        prospectId: ctx.prospectId,
        dealId: ctx.dealId,
        recipientName: ctx.entityName,
      }),
    },
    {
      index: 2,
      name: "Wait for outreach approval",
      type: "wait_confirmation",
      description: "Review the outreach email before sending",
      prompt: "Review and approve this slot-fill outreach email.",
    },
    {
      index: 3,
      name: "Send outreach email",
      type: "tool_call",
      toolName: "send_email",
      description: "Send the approved slot-fill outreach email",
      buildInput: (ctx) => ({
        to: ctx.prospectEmail ?? ctx.entityEmail ?? "prospect@example.com",
        subject: ctx.draftSubject ?? `Limited availability — S&C session opening`,
        html: `<p>${(ctx.draftBody ?? "").replace(/\n/g, "<br>")}</p>`,
        orgId: ctx.orgId,
      }),
      maxRetries: 2,
    },
    {
      index: 4,
      name: "Complete workflow",
      type: "complete",
      description: "Schedule gap outreach complete",
      outcomeLabel: "outreach_sent",
    },
  ],
};

// ─── 4. Onboarding Sequence ───────────────────────────────────────────────────

const onboardingSequence: WorkflowDefinition = {
  type: "onboarding_sequence",
  displayName: "Client Onboarding Sequence",
  description: "Welcome new clients with an automated sequence: welcome email → 2-day check-in → milestone log.",
  category: "retention",
  estimatedDays: 4,
  triggerEvent: "new_client_added",
  steps: [
    {
      index: 0,
      name: "Send welcome email",
      type: "tool_call",
      toolName: "send_email",
      description: "Auto-send a warm welcome email to the new client",
      buildInput: (ctx) => ({
        to: ctx.clientEmail ?? ctx.entityEmail ?? "client@example.com",
        subject: `Welcome to the program, ${ctx.entityName ?? "Coach"}!`,
        html: `<p>Hi ${ctx.entityName ?? ""},</p><p>Welcome to the team! We're thrilled to have you on board. ${ctx.triggerReason ?? "Your S&C journey starts now."}</p><p>You'll hear from your coach shortly to schedule your first session. In the meantime, feel free to reach out with any questions.</p><p>Best,<br>The Team</p>`,
        orgId: ctx.orgId,
      }),
      maxRetries: 2,
    },
    {
      index: 1,
      name: "Wait 2 days",
      type: "wait_time",
      description: "Wait 2 days before the check-in",
      days: 2,
    },
    {
      index: 2,
      name: "Create check-in follow-up task",
      type: "tool_call",
      toolName: "create_follow_up_task",
      description: "Remind the coach to personally check in with the new client",
      buildInput: (ctx) => ({
        followUpDate: tomorrow(),
        note: `2-day check-in: Call ${ctx.entityName ?? "new client"} to confirm first session and answer any questions.`,
        priority: "high",
      }),
    },
    {
      index: 3,
      name: "Log onboarding milestone",
      type: "tool_call",
      toolName: "log_activity",
      description: "Record the onboarding sequence completion in the client timeline",
      buildInput: (ctx) => ({
        dealId: ctx.dealId,
        activityType: "milestone",
        summary: `Onboarding sequence completed for ${ctx.entityName ?? "new client"}. Welcome email sent, 2-day check-in task created.`,
      }),
    },
    {
      index: 4,
      name: "Complete workflow",
      type: "complete",
      description: "Onboarding sequence complete",
      outcomeLabel: "onboarded",
    },
  ],
};

// ─── 5. Unpaid Session Recovery ───────────────────────────────────────────────

const unpaidSessionRecovery: WorkflowDefinition = {
  type: "unpaid_session_recovery",
  displayName: "Unpaid Session Recovery",
  description: "Follow up on overdue session payments with a polite email, then an SMS reminder if needed.",
  category: "finance",
  estimatedDays: 6,
  triggerEvent: "payment_overdue",
  steps: [
    {
      index: 0,
      name: "Generate payment request email",
      type: "tool_call",
      toolName: "create_email_draft",
      description: "Generate a professional payment reminder email",
      buildInput: (ctx) => ({
        subject: `Payment reminder — ${ctx.entityName ?? "your recent session"}`,
        body: `Hi ${ctx.entityName ?? ""},\n\nI hope you enjoyed your recent session! We noticed that payment for ${ctx.triggerReason ?? "your session"} is still outstanding.\n\nCould you take a moment to settle this at your earliest convenience? If you have any questions about the invoice, please don't hesitate to reach out.\n\nThank you!\nBest,`,
        draftType: "general",
        recipientName: ctx.entityName,
      }),
    },
    {
      index: 1,
      name: "Wait for payment email approval",
      type: "wait_confirmation",
      description: "Review the payment reminder email before sending",
      prompt: "Review and approve this payment reminder email.",
    },
    {
      index: 2,
      name: "Send payment reminder email",
      type: "tool_call",
      toolName: "send_email",
      description: "Send the approved payment reminder email",
      buildInput: (ctx) => ({
        to: ctx.clientEmail ?? ctx.entityEmail ?? "client@example.com",
        subject: ctx.draftSubject ?? `Payment reminder — ${ctx.entityName ?? "your recent session"}`,
        html: `<p>${(ctx.draftBody ?? "").replace(/\n/g, "<br>")}</p>`,
        orgId: ctx.orgId,
      }),
      maxRetries: 2,
    },
    {
      index: 3,
      name: "Wait 3 days for payment",
      type: "wait_time",
      description: "Wait 3 days for payment to be processed",
      days: 3,
    },
    {
      index: 4,
      name: "Check if payment received",
      type: "check_response",
      description: "Check whether payment has been processed",
      checkFn: "payment_status",
    },
    {
      index: 5,
      name: "Branch: paid or not",
      type: "branch",
      description: "If payment received, complete. Otherwise send SMS reminder.",
      condition: "hasResponse",
      trueStepIndex: 9,
      falseStepIndex: 6,
    },
    {
      index: 6,
      name: "Generate SMS payment reminder",
      type: "tool_call",
      toolName: "create_sms_draft",
      description: "Generate a brief SMS payment reminder",
      buildInput: (ctx) => ({
        body: `Hi ${ctx.entityName ?? ""}! This is a friendly reminder that payment for your recent session is still outstanding. Please contact us at your earliest convenience. Reply STOP to opt out.`,
        draftType: "general",
      }),
    },
    {
      index: 7,
      name: "Wait for SMS approval",
      type: "wait_confirmation",
      description: "Review and approve the SMS payment reminder",
      prompt: "Review and approve this SMS payment reminder.",
    },
    {
      index: 8,
      name: "Send SMS reminder",
      type: "tool_call",
      toolName: "send_sms",
      description: "Send the approved payment reminder SMS",
      buildInput: (ctx) => ({
        to: ctx.clientPhone ?? ctx.entityPhone ?? "+10000000000",
        body: ctx.smsDraftBody ?? `Hi ${ctx.entityName ?? ""}! Payment reminder for your recent session is still outstanding. Reply STOP to opt out.`,
        orgId: ctx.orgId,
      }),
      maxRetries: 2,
    },
    {
      index: 9,
      name: "Log payment follow-up",
      type: "tool_call",
      toolName: "log_activity",
      description: "Log the payment recovery attempt",
      buildInput: (ctx) => ({
        dealId: ctx.dealId,
        activityType: "note",
        summary: `Payment recovery workflow: email sent${ctx.hasResponse ? ", payment received" : ", SMS sent — awaiting payment"}.`,
      }),
    },
    {
      index: 10,
      name: "Complete workflow",
      type: "complete",
      description: "Payment recovery workflow complete",
      outcomeLabel: ctx => ctx.hasResponse ? "payment_received" : "escalation_needed",
    } as any,
  ],
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const WORKFLOW_DEFINITIONS: Record<string, WorkflowDefinition> = {
  recover_stalled_deal: recoverStalledDeal,
  reengage_inactive_client: reengageInactiveClient,
  fill_schedule_gap: fillScheduleGap,
  onboarding_sequence: onboardingSequence,
  unpaid_session_recovery: unpaidSessionRecovery,
};

export function getWorkflowDefinition(type: string): WorkflowDefinition | undefined {
  return WORKFLOW_DEFINITIONS[type];
}

export function listWorkflowDefinitions(): WorkflowDefinition[] {
  return Object.values(WORKFLOW_DEFINITIONS);
}
