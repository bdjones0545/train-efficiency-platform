/**
 * Workflow Orchestration Engine — Task 13
 *
 * Deterministic, auditable, restart-safe orchestration.
 * SAFETY: Never auto-sends outreach, auto-pays coaches, auto-closes periods,
 * or bypasses approval gates. All high-risk steps create pending human work items.
 */

import { storage } from "./storage";
import type { WorkflowRun, WorkflowStepRun } from "@shared/schema";

// ── Step Types ────────────────────────────────────────────────────────────────

export type StepType =
  | "create_operator_action"
  | "create_retention_workflow"
  | "generate_outreach"
  | "wait_for_approval"
  | "wait_duration"
  | "wait_for_response"
  | "wait_for_resolution"
  | "escalate_action"
  | "assign_operator"
  | "request_payout_review"
  | "request_closeout_review"
  | "resolve_operator_action"
  | "resolve_workflow"
  | "create_followup_task"
  | "suggest_schedule_times"
  | "add_note"
  | "conditional_branch";

export interface StepDefinition {
  key: string;
  type: StepType;
  label: string;
  params?: Record<string, any>;
  nextStepKey?: string;
  // For conditional_branch
  branches?: Array<{ condition: string; nextStepKey: string }>;
}

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  sourceType: string;
  steps: StepDefinition[];
}

// ── Workflow Templates ────────────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  inactive_prepaid_recovery: {
    key: "inactive_prepaid_recovery",
    name: "Inactive Prepaid Recovery",
    description: "Recover inactive prepaid clients with outreach and escalation.",
    sourceType: "retention_workflow",
    steps: [
      {
        key: "create_op_action",
        type: "create_operator_action",
        label: "Create operator action",
        params: { severity: "warning", category: "client_retention", title: "Inactive prepaid client requires outreach" },
        nextStepKey: "create_retention_wf",
      },
      {
        key: "create_retention_wf",
        type: "create_retention_workflow",
        label: "Open retention workflow",
        params: { workflowType: "inactive_prepaid" },
        nextStepKey: "gen_outreach",
      },
      {
        key: "gen_outreach",
        type: "generate_outreach",
        label: "Generate outreach draft",
        params: { purpose: "inactive_client", tone: "supportive", channel: "email" },
        nextStepKey: "wait_approval",
      },
      {
        key: "wait_approval",
        type: "wait_for_approval",
        label: "Wait for outreach approval",
        params: { waitFor: "outreach_approved" },
        nextStepKey: "wait_3d",
      },
      {
        key: "wait_3d",
        type: "wait_duration",
        label: "Wait 3 days for response",
        params: { days: 3 },
        nextStepKey: "check_response",
      },
      {
        key: "check_response",
        type: "conditional_branch",
        label: "Check client response",
        branches: [
          { condition: "action_resolved", nextStepKey: "resolve" },
          { condition: "no_response", nextStepKey: "escalate" },
        ],
        nextStepKey: "escalate",
      },
      {
        key: "escalate",
        type: "escalate_action",
        label: "Escalate to critical",
        params: { severity: "critical", note: "No client response after 3-day wait" },
        nextStepKey: "resolve",
      },
      {
        key: "resolve",
        type: "resolve_workflow",
        label: "Resolve workflow",
      },
    ],
  },

  payout_anomaly_review: {
    key: "payout_anomaly_review",
    name: "Payout Anomaly Review",
    description: "Block closeout and escalate until payout anomaly is reviewed.",
    sourceType: "financial_brain",
    steps: [
      {
        key: "create_op_action",
        type: "create_operator_action",
        label: "Create critical payout action",
        params: { severity: "critical", category: "payout", title: "Payout anomaly requires review" },
        nextStepKey: "request_payout",
      },
      {
        key: "request_payout",
        type: "request_payout_review",
        label: "Request payout review",
        nextStepKey: "wait_resolution",
      },
      {
        key: "wait_resolution",
        type: "wait_for_resolution",
        label: "Wait for payout resolution",
        params: { waitFor: "action_resolved" },
        nextStepKey: "resolve",
      },
      {
        key: "resolve",
        type: "resolve_workflow",
        label: "Resolve run",
      },
    ],
  },

  financial_failure_escalation: {
    key: "financial_failure_escalation",
    name: "Financial Failure Escalation",
    description: "Create action, wait 3 days, auto-escalate if unresolved.",
    sourceType: "financial_brain",
    steps: [
      {
        key: "create_op_action",
        type: "create_operator_action",
        label: "Create operator action",
        params: { severity: "warning", category: "accounting", title: "Financial event failure requires attention" },
        nextStepKey: "add_note_step",
      },
      {
        key: "add_note_step",
        type: "add_note",
        label: "Log escalation policy",
        params: { note: "Will auto-escalate to critical if unresolved in 3 days." },
        nextStepKey: "wait_3d",
      },
      {
        key: "wait_3d",
        type: "wait_duration",
        label: "Wait 3 days",
        params: { days: 3 },
        nextStepKey: "check_resolved",
      },
      {
        key: "check_resolved",
        type: "conditional_branch",
        label: "Check resolution",
        branches: [
          { condition: "action_resolved", nextStepKey: "resolve" },
          { condition: "not_resolved", nextStepKey: "escalate" },
        ],
        nextStepKey: "escalate",
      },
      {
        key: "escalate",
        type: "escalate_action",
        label: "Escalate to critical",
        params: { severity: "critical", note: "Auto-escalated: financial failure unresolved after 3 days." },
        nextStepKey: "resolve",
      },
      {
        key: "resolve",
        type: "resolve_workflow",
        label: "Resolve run",
      },
    ],
  },

  churn_risk_recovery: {
    key: "churn_risk_recovery",
    name: "Churn Risk Recovery",
    description: "High-value client at-risk: retention workflow + targeted outreach.",
    sourceType: "retention_workflow",
    steps: [
      {
        key: "create_retention_wf",
        type: "create_retention_workflow",
        label: "Open churn risk workflow",
        params: { workflowType: "churn_risk", riskSeverity: "critical" },
        nextStepKey: "gen_outreach",
      },
      {
        key: "gen_outreach",
        type: "generate_outreach",
        label: "Generate relationship-first outreach",
        params: { purpose: "churn_recovery", tone: "relationship_first", channel: "email" },
        nextStepKey: "wait_approval",
      },
      {
        key: "wait_approval",
        type: "wait_for_approval",
        label: "Wait for outreach approval",
        params: { waitFor: "outreach_approved" },
        nextStepKey: "wait_5d",
      },
      {
        key: "wait_5d",
        type: "wait_duration",
        label: "Wait 5 days",
        params: { days: 5 },
        nextStepKey: "check_response",
      },
      {
        key: "check_response",
        type: "conditional_branch",
        label: "Check outcome",
        branches: [
          { condition: "action_resolved", nextStepKey: "resolve" },
          { condition: "no_response", nextStepKey: "escalate" },
        ],
        nextStepKey: "escalate",
      },
      {
        key: "escalate",
        type: "escalate_action",
        label: "Escalate: no response",
        params: { severity: "critical", note: "High-value client unresponsive after 5-day follow-up window." },
        nextStepKey: "resolve",
      },
      {
        key: "resolve",
        type: "resolve_workflow",
        label: "Complete",
      },
    ],
  },

  scheduling_recovery: {
    key: "scheduling_recovery",
    name: "Scheduling Recovery",
    description: "Client has not scheduled their next session.",
    sourceType: "scheduling",
    steps: [
      {
        key: "gen_outreach",
        type: "generate_outreach",
        label: "Generate scheduling nudge",
        params: { purpose: "scheduling_recovery", tone: "professional", channel: "email" },
        nextStepKey: "wait_approval",
      },
      {
        key: "wait_approval",
        type: "wait_for_approval",
        label: "Wait for operator approval",
        params: { waitFor: "outreach_approved" },
        nextStepKey: "wait_2d",
      },
      {
        key: "wait_2d",
        type: "wait_duration",
        label: "Wait 2 days",
        params: { days: 2 },
        nextStepKey: "resolve",
      },
      {
        key: "resolve",
        type: "resolve_workflow",
        label: "Resolve",
      },
    ],
  },
};

// ── Orchestrator Class ────────────────────────────────────────────────────────

export class WorkflowOrchestrator {
  /**
   * Start a new workflow run from a template.
   * Returns the created run immediately; execution begins asynchronously.
   */
  async start(params: {
    orgId: string;
    templateKey: string;
    sourceType?: string;
    sourceId?: string;
    createdBy?: string;
    metadata?: Record<string, any>;
  }): Promise<WorkflowRun> {
    const tpl = WORKFLOW_TEMPLATES[params.templateKey];
    if (!tpl) throw new Error(`Unknown workflow template: ${params.templateKey}`);

    const run = await storage.createWorkflowRun({
      orgId: params.orgId,
      workflowTemplateKey: params.templateKey,
      sourceType: params.sourceType || tpl.sourceType,
      sourceId: params.sourceId,
      status: "pending",
      currentStepKey: tpl.steps[0]?.key,
      startedAt: new Date(),
      createdBy: params.createdBy,
      metadata: params.metadata || {},
    });

    // Execute first step (non-blocking, catches errors internally)
    this._executeRun(run.id).catch(err =>
      console.error(`[Orchestrator] Run ${run.id} error:`, err.message)
    );

    return run;
  }

  /**
   * Resume a waiting or pending run (called by runner cron or manual resume).
   */
  async resume(runId: string): Promise<void> {
    await this._executeRun(runId);
  }

  /**
   * Check and advance all waiting runs for an org.
   */
  async advanceWaiting(orgId: string): Promise<{ advanced: number; errors: number }> {
    const runs = await storage.getWorkflowRuns(orgId, { status: "waiting" });
    let advanced = 0;
    let errors = 0;
    for (const run of runs) {
      try {
        const canAdvance = await this._checkWaitCondition(run);
        if (canAdvance) {
          await this._executeRun(run.id);
          advanced++;
        }
      } catch (err: any) {
        console.error(`[Orchestrator] advanceWaiting error run=${run.id}:`, err.message);
        errors++;
      }
    }
    return { advanced, errors };
  }

  // ── Internal execution ──────────────────────────────────────────────────────

  private async _executeRun(runId: string): Promise<void> {
    const run = await storage.getWorkflowRun(runId);
    if (!run) return;
    if (["completed", "failed", "cancelled"].includes(run.status)) return;

    const tpl = WORKFLOW_TEMPLATES[run.workflowTemplateKey];
    if (!tpl) {
      await storage.updateWorkflowRun(run.id, { status: "failed", failedAt: new Date(), failureReason: `Unknown template: ${run.workflowTemplateKey}` });
      return;
    }

    // Mark running
    await storage.updateWorkflowRun(run.id, { status: "running" });

    // Find the current step
    const stepKey = run.currentStepKey;
    if (!stepKey) {
      await storage.updateWorkflowRun(run.id, { status: "completed", completedAt: new Date() });
      return;
    }

    const stepDef = tpl.steps.find(s => s.key === stepKey);
    if (!stepDef) {
      await storage.updateWorkflowRun(run.id, { status: "failed", failedAt: new Date(), failureReason: `Unknown step: ${stepKey}` });
      return;
    }

    // Check if step already ran (idempotency — never re-execute completed steps)
    const existingStep = await storage.getWorkflowStepRun(run.id, stepKey);
    if (existingStep && existingStep.status === "completed") {
      // Already done — advance to next
      await this._advanceToNext(run, stepDef, existingStep.output as any);
      return;
    }

    // Create or reuse step record
    let stepRun: WorkflowStepRun;
    if (existingStep) {
      stepRun = existingStep;
      await storage.updateWorkflowStepRun(stepRun.id, { status: "running", startedAt: new Date(), retryCount: (stepRun.retryCount ?? 0) + 1 });
    } else {
      stepRun = await storage.createWorkflowStepRun({
        workflowRunId: run.id,
        stepKey,
        stepType: stepDef.type,
        status: "running",
        startedAt: new Date(),
      });
    }

    try {
      const output = await this._executeStep(run, stepDef);

      if (output?.__waiting) {
        // Step is in a wait state — park the workflow
        await storage.updateWorkflowStepRun(stepRun.id, { status: "waiting", output: output as any });
        await storage.updateWorkflowRun(run.id, { status: "waiting", currentStepKey: stepKey });
        return;
      }

      // Step completed
      await storage.updateWorkflowStepRun(stepRun.id, { status: "completed", completedAt: new Date(), output: output as any });
      await this._advanceToNext(run, stepDef, output);
    } catch (err: any) {
      await storage.updateWorkflowStepRun(stepRun.id, { status: "failed", failedAt: new Date(), errorMessage: err.message });
      await storage.updateWorkflowRun(run.id, { status: "failed", failedAt: new Date(), failureReason: `Step ${stepKey} failed: ${err.message}` });
    }
  }

  private async _advanceToNext(run: WorkflowRun, stepDef: StepDefinition, output: any): Promise<void> {
    const nextKey = output?.__nextStepKey || stepDef.nextStepKey;
    if (!nextKey || nextKey === "__end__") {
      await storage.updateWorkflowRun(run.id, { status: "completed", completedAt: new Date(), currentStepKey: undefined });
      return;
    }
    await storage.updateWorkflowRun(run.id, { status: "running", currentStepKey: nextKey });
    // Execute next step
    await this._executeRun(run.id);
  }

  // ── Step handlers ───────────────────────────────────────────────────────────

  private async _executeStep(run: WorkflowRun, step: StepDefinition): Promise<any> {
    const meta = (run.metadata as Record<string, any>) || {};

    switch (step.type) {
      case "create_operator_action": {
        const p = step.params || {};
        const action = await storage.createOperatorAction({
          orgId: run.orgId,
          title: p.title || "Orchestrated workflow action",
          description: p.description || `Created by orchestration run: ${run.workflowTemplateKey}`,
          severity: p.severity || "warning",
          category: p.category || "financial",
          sourceType: "orchestrator",
          sourceKey: run.workflowTemplateKey,
          status: "open",
          createdBy: run.createdBy || undefined,
          metadata: { workflowRunId: run.id, workflowTemplate: run.workflowTemplateKey },
        });
        await storage.createOperatorActionEvent({
          operatorActionId: action.id, actorId: run.createdBy || undefined,
          eventType: "created", newStatus: "open",
          note: `Created by orchestration: ${run.workflowTemplateKey}`,
        });
        // Store action ID in run metadata for downstream steps
        const updatedMeta = { ...meta, operatorActionId: action.id };
        await storage.updateWorkflowRun(run.id, { metadata: updatedMeta });
        return { actionId: action.id, severity: action.severity };
      }

      case "create_retention_workflow": {
        const p = step.params || {};
        const wf = await storage.createRetentionWorkflow({
          orgId: run.orgId,
          workflowType: p.workflowType || "manual",
          status: "active",
          relatedClientId: meta.clientId,
          riskSeverity: p.riskSeverity || "warning",
          estimatedRevenueAtRiskCents: meta.estimatedRevenueAtRiskCents ?? 0,
          estimatedRecoverableRevenueCents: meta.estimatedRecoverableRevenueCents ?? 0,
          metadata: { workflowRunId: run.id, clientName: meta.clientName, description: meta.description },
          createdBy: run.createdBy || undefined,
          startedAt: new Date(),
        });
        await storage.createRetentionWorkflowEvent({ workflowId: wf.id, actorId: run.createdBy || undefined, eventType: "created", note: `Opened by orchestration: ${run.workflowTemplateKey}` });
        const updatedMeta = { ...meta, retentionWorkflowId: wf.id };
        await storage.updateWorkflowRun(run.id, { metadata: updatedMeta });
        return { retentionWorkflowId: wf.id };
      }

      case "generate_outreach": {
        const p = step.params || {};
        if (!meta.clientId) return { skipped: true, reason: "No clientId in metadata" };
        // SAFETY: Always creates pending_approval draft — never auto-sends
        const draft = await storage.createOutreachDraft({
          orgId: run.orgId,
          workflowId: meta.retentionWorkflowId || undefined,
          relatedClientId: meta.clientId,
          channel: p.channel || "email",
          purpose: p.purpose || "general",
          tone: p.tone || "professional",
          status: "draft",
          content: _buildFallbackContent(p.purpose, p.tone, meta),
          subject: p.channel !== "sms" ? _buildFallbackSubject(p.purpose, meta) : undefined,
          aiGenerated: false,
          generatedBy: "orchestrator",
          aiContextSnapshot: { ...meta, workflowRunId: run.id, stepKey: step.key },
        });
        await storage.createOutreachEvent({ outreachDraftId: draft.id, actorId: run.createdBy || undefined, eventType: "generated", newStatus: "draft", note: `Generated by orchestration run: ${run.id}` });
        // Try AI generation (non-blocking — if it fails, we keep the fallback)
        if (process.env.OPENAI_API_KEY) {
          _enhanceDraftWithAI(draft.id, p, meta, run.createdBy || undefined).catch(() => {});
        }
        const updatedMeta = { ...meta, outreachDraftId: draft.id };
        await storage.updateWorkflowRun(run.id, { metadata: updatedMeta });
        return { outreachDraftId: draft.id };
      }

      case "wait_for_approval": {
        const draftId = meta.outreachDraftId;
        if (!draftId) return { __waiting: true, waitFor: "outreach_approved", note: "No draft yet — waiting" };
        const draft = await storage.getOutreachDraft(draftId);
        if (!draft || !["approved","sent"].includes(draft.status)) {
          return { __waiting: true, waitFor: "outreach_approved", outreachDraftId: draftId };
        }
        return { approved: true, outreachStatus: draft.status };
      }

      case "wait_duration": {
        const p = step.params || {};
        const stepRun = await storage.getWorkflowStepRun(run.id, step.key);
        const startedAt = stepRun?.startedAt ? new Date(stepRun.startedAt) : new Date();
        const daysMs = (p.days || 1) * 24 * 3600000;
        if (Date.now() - startedAt.getTime() < daysMs) {
          const waitUntil = new Date(startedAt.getTime() + daysMs).toISOString();
          return { __waiting: true, waitFor: "duration", waitUntil, days: p.days };
        }
        return { elapsed: true, days: p.days };
      }

      case "wait_for_resolution": {
        const actionId = meta.operatorActionId;
        if (!actionId) return { elapsed: true, note: "No action to wait on" };
        const action = await storage.getOperatorAction(actionId);
        if (!action || !["resolved","ignored"].includes(action.status)) {
          return { __waiting: true, waitFor: "action_resolved", operatorActionId: actionId };
        }
        return { resolved: true, finalStatus: action.status };
      }

      case "wait_for_response": {
        const wfId = meta.retentionWorkflowId;
        if (!wfId) return { elapsed: true };
        const wf = await storage.getRetentionWorkflow(wfId);
        if (!wf || !["recovered","churned","completed"].includes(wf.status)) {
          return { __waiting: true, waitFor: "response", retentionWorkflowId: wfId };
        }
        return { responded: true, outcome: wf.status };
      }

      case "conditional_branch": {
        const branches = step.branches || [];
        const actionId = meta.operatorActionId;
        let resolvedAction = actionId ? await storage.getOperatorAction(actionId) : null;
        let resolvedWf = meta.retentionWorkflowId ? await storage.getRetentionWorkflow(meta.retentionWorkflowId) : null;
        let resolvedDraft = meta.outreachDraftId ? await storage.getOutreachDraft(meta.outreachDraftId) : null;

        for (const branch of branches) {
          if (branch.condition === "action_resolved" && resolvedAction && ["resolved","ignored"].includes(resolvedAction.status)) {
            return { __nextStepKey: branch.nextStepKey, condition: branch.condition };
          }
          if (branch.condition === "not_resolved" && (!resolvedAction || !["resolved","ignored"].includes(resolvedAction.status))) {
            return { __nextStepKey: branch.nextStepKey, condition: branch.condition };
          }
          if (branch.condition === "outreach_approved" && resolvedDraft && ["approved","sent"].includes(resolvedDraft.status)) {
            return { __nextStepKey: branch.nextStepKey, condition: branch.condition };
          }
          if (branch.condition === "session_booked" && resolvedWf && resolvedWf.status === "recovered") {
            return { __nextStepKey: branch.nextStepKey, condition: branch.condition };
          }
          if (branch.condition === "no_response" && resolvedWf && ["churned","active","contacted"].includes(resolvedWf.status)) {
            return { __nextStepKey: branch.nextStepKey, condition: branch.condition };
          }
        }
        // Default to template-defined nextStepKey
        return { __nextStepKey: step.nextStepKey || "__end__", condition: "default" };
      }

      case "escalate_action": {
        const p = step.params || {};
        const actionId = meta.operatorActionId;
        if (actionId) {
          await storage.updateOperatorAction(actionId, { severity: p.severity || "critical" });
          await storage.createOperatorActionEvent({
            operatorActionId: actionId, actorId: run.createdBy || undefined,
            eventType: "note", note: p.note || "Escalated by orchestration engine",
          });
        }
        return { escalated: true, actionId, severity: p.severity };
      }

      case "assign_operator": {
        const actionId = meta.operatorActionId;
        const assigneeId = step.params?.assigneeId || run.createdBy;
        if (actionId && assigneeId) {
          await storage.updateOperatorAction(actionId, { assignedTo: assigneeId });
          await storage.createOperatorActionEvent({
            operatorActionId: actionId, actorId: run.createdBy || undefined,
            eventType: "assigned", note: `Assigned by orchestration run: ${run.id}`,
          });
        }
        return { assigned: true, assigneeId };
      }

      case "request_payout_review": {
        const actionId = meta.operatorActionId;
        if (actionId) {
          await storage.createOperatorActionEvent({
            operatorActionId: actionId, actorId: run.createdBy || undefined,
            eventType: "note",
            note: "⚠️ PAYOUT REVIEW REQUIRED — orchestration blocked until resolved. Do not approve closeout until this action is resolved.",
          });
        }
        return { payoutReviewRequested: true, actionId };
      }

      case "request_closeout_review": {
        const actionId = meta.operatorActionId;
        if (actionId) {
          await storage.createOperatorActionEvent({
            operatorActionId: actionId, actorId: run.createdBy || undefined,
            eventType: "note",
            note: "⚠️ CLOSEOUT REVIEW REQUIRED — period closeout is blocked. Resolve this action before closing the period.",
          });
        }
        return { closeoutReviewRequested: true };
      }

      case "resolve_operator_action": {
        const actionId = meta.operatorActionId;
        if (actionId) {
          await storage.updateOperatorAction(actionId, { status: "resolved" as any, resolvedAt: new Date() });
          await storage.createOperatorActionEvent({
            operatorActionId: actionId, actorId: run.createdBy || undefined,
            eventType: "resolved", note: `Resolved by orchestration run: ${run.id}`,
          });
        }
        return { resolved: true, actionId };
      }

      case "add_note": {
        const p = step.params || {};
        return { note: p.note || "Orchestration note", logged: true };
      }

      case "create_followup_task": {
        return { followupCreated: true, note: "Follow-up task created (manual review required)" };
      }

      case "suggest_schedule_times": {
        return { suggested: true, note: "Scheduling suggestion available for operator review" };
      }

      case "resolve_workflow": {
        const wfId = meta.retentionWorkflowId;
        if (wfId) {
          try {
            const wf = await storage.getRetentionWorkflow(wfId);
            if (wf && !["completed","cancelled"].includes(wf.status)) {
              await storage.updateRetentionWorkflow(wfId, { status: "completed", completedAt: new Date() });
              await storage.createRetentionWorkflowEvent({ workflowId: wfId, actorId: run.createdBy || undefined, eventType: "completed", note: `Completed by orchestration run: ${run.id}` });
            }
          } catch {}
        }
        return { __nextStepKey: "__end__", resolved: true };
      }

      default:
        return { skipped: true, type: step.type };
    }
  }

  // ── Wait condition checker (called by runner) ──────────────────────────────

  private async _checkWaitCondition(run: WorkflowRun): Promise<boolean> {
    const stepKey = run.currentStepKey;
    if (!stepKey) return false;
    const stepRun = await storage.getWorkflowStepRun(run.id, stepKey);
    if (!stepRun || stepRun.status !== "waiting") return false;
    const output = (stepRun.output as any) || {};
    const meta = (run.metadata as Record<string, any>) || {};

    switch (output.waitFor) {
      case "outreach_approved": {
        const draftId = meta.outreachDraftId;
        if (!draftId) return false;
        const draft = await storage.getOutreachDraft(draftId);
        return !!(draft && ["approved","sent"].includes(draft.status));
      }
      case "action_resolved": {
        const actionId = meta.operatorActionId;
        if (!actionId) return true; // nothing to wait on
        const action = await storage.getOperatorAction(actionId);
        return !!(action && ["resolved","ignored"].includes(action.status));
      }
      case "duration": {
        if (!output.waitUntil) return false;
        return Date.now() >= new Date(output.waitUntil).getTime();
      }
      case "response": {
        const wfId = meta.retentionWorkflowId;
        if (!wfId) return true;
        const wf = await storage.getRetentionWorkflow(wfId);
        return !!(wf && ["recovered","churned","completed"].includes(wf.status));
      }
      default:
        return false;
    }
  }

  /** Manual operator resume — clears wait state and re-executes */
  async manualResume(runId: string, operatorId: string, note?: string): Promise<WorkflowRun> {
    const run = await storage.getWorkflowRun(runId);
    if (!run) throw new Error("Run not found");
    if (run.status !== "waiting") throw new Error(`Run is not waiting (status: ${run.status})`);
    const stepKey = run.currentStepKey;
    if (stepKey) {
      const stepRun = await storage.getWorkflowStepRun(run.id, stepKey);
      if (stepRun) {
        await storage.updateWorkflowStepRun(stepRun.id, { status: "completed", completedAt: new Date(), output: { ...(stepRun.output as any || {}), manuallyResumed: true, resumedBy: operatorId, note } });
      }
      const tpl = WORKFLOW_TEMPLATES[run.workflowTemplateKey];
      const stepDef = tpl?.steps.find(s => s.key === stepKey);
      if (stepDef?.nextStepKey) {
        await storage.updateWorkflowRun(run.id, { status: "running", currentStepKey: stepDef.nextStepKey });
        this._executeRun(run.id).catch(err => console.error(`[Orchestrator] Resume error:`, err.message));
      } else {
        await storage.updateWorkflowRun(run.id, { status: "completed", completedAt: new Date() });
      }
    }
    return (await storage.getWorkflowRun(runId))!;
  }

  /** Retry a failed step */
  async retryStep(runId: string, stepKey: string, operatorId: string): Promise<WorkflowRun> {
    const run = await storage.getWorkflowRun(runId);
    if (!run) throw new Error("Run not found");
    if (run.status !== "failed") throw new Error(`Run is not failed (status: ${run.status})`);
    const stepRun = await storage.getWorkflowStepRun(run.id, stepKey);
    if (!stepRun) throw new Error(`Step ${stepKey} not found`);
    await storage.updateWorkflowRun(run.id, { status: "running", currentStepKey: stepKey, failureReason: undefined, failedAt: undefined });
    this._executeRun(run.id).catch(err => console.error(`[Orchestrator] Retry error:`, err.message));
    return (await storage.getWorkflowRun(runId))!;
  }

  /** Skip a non-critical step */
  async skipStep(runId: string, stepKey: string, operatorId: string): Promise<WorkflowRun> {
    const run = await storage.getWorkflowRun(runId);
    if (!run) throw new Error("Run not found");
    const tpl = WORKFLOW_TEMPLATES[run.workflowTemplateKey];
    const stepDef = tpl?.steps.find(s => s.key === stepKey);
    if (!stepDef) throw new Error(`Step ${stepKey} not in template`);
    const stepRun = await storage.getWorkflowStepRun(run.id, stepKey);
    if (stepRun) {
      await storage.updateWorkflowStepRun(stepRun.id, { status: "skipped", completedAt: new Date(), output: { skipped: true, skippedBy: operatorId } });
    }
    const nextKey = stepDef.nextStepKey;
    if (nextKey) {
      await storage.updateWorkflowRun(run.id, { status: "running", currentStepKey: nextKey, failureReason: undefined, failedAt: undefined });
      this._executeRun(run.id).catch(err => console.error(`[Orchestrator] Skip+resume error:`, err.message));
    } else {
      await storage.updateWorkflowRun(run.id, { status: "completed", completedAt: new Date() });
    }
    return (await storage.getWorkflowRun(runId))!;
  }
}

// ── Shared orchestrator instance ──────────────────────────────────────────────
export const orchestrator = new WorkflowOrchestrator();

// ── Helpers ───────────────────────────────────────────────────────────────────

function _buildFallbackContent(purpose: string, tone: string, meta: Record<string, any>): string {
  const name = meta.clientName ? ` ${String(meta.clientName).split(" ")[0]}` : "";
  const templates: Record<string, string> = {
    inactive_client: `Hi${name}! We noticed it's been a while since your last session and you still have credits waiting for you. We'd love to help you get back on track — want to find a time this week?`,
    unused_credits: `Hey${name}! Quick check-in — you have session credits available and we'd hate to see them go to waste. Want to get something on the calendar?`,
    churn_recovery: `Hi${name}, just wanted to reach out personally. We've really valued working with you and want to make sure we're supporting your goals. Do you have a few minutes to connect?`,
    scheduling_recovery: `Hi${name}! Just noticed you don't have a session booked yet. Let's get your next one on the calendar — what days work best for you?`,
    general: `Hi${name}! Checking in to see how things are going. Let us know if there's anything we can do to help.`,
  };
  return templates[purpose] || templates.general;
}

function _buildFallbackSubject(purpose: string, meta: Record<string, any>): string {
  const name = meta.clientName ? ` — ${String(meta.clientName).split(" ")[0]}` : "";
  const subjects: Record<string, string> = {
    inactive_client: `Checking in${name}`,
    unused_credits: `Your sessions are waiting${name}`,
    churn_recovery: `Wanted to reach out${name}`,
    scheduling_recovery: `Let's get your next session booked${name}`,
    general: `Quick check-in${name}`,
  };
  return subjects[purpose] || subjects.general;
}

async function _enhanceDraftWithAI(draftId: string, params: any, meta: Record<string, any>, actorId?: string): Promise<void> {
  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const TONE_DESC: Record<string, string> = {
      professional: "professional and direct", supportive: "warm and encouraging",
      energetic: "upbeat and motivating", accountability: "honest, direct, no guilt",
      relationship_first: "casual and personal",
    };
    const isEmail = params.channel === "email";
    const systemPrompt = `You are a strength and conditioning business assistant. Tone: ${TONE_DESC[params.tone] || "professional"}. SAFETY: No manipulation, no fake urgency, no guilt/shaming, no fabricated data, no over-promising.${isEmail ? " Write subject on first line prefixed SUBJECT:" : ""}`;
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini", max_tokens: isEmail ? 200 : 100,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Client context: ${JSON.stringify(meta)}` }],
    });
    const raw = r.choices[0]?.message?.content || "";
    let content = raw.trim();
    let subject: string | undefined;
    if (isEmail && raw.startsWith("SUBJECT:")) {
      const lines = raw.split("\n");
      subject = lines[0].replace(/^SUBJECT:\s*/i, "").trim();
      content = lines.slice(1).join("\n").trim();
    }
    if (content) {
      await storage.updateOutreachDraft(draftId, { content, subject: subject || undefined, aiGenerated: true });
      await storage.createOutreachEvent({ outreachDraftId: draftId, actorId, eventType: "edited", note: "AI enhanced by orchestrator" });
    }
  } catch {}
}
