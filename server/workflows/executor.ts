/**
 * Workflow Executor — stateful step-by-step execution engine.
 *
 * States:  pending → running → waiting_confirmation | waiting_response → running → completed | failed | cancelled
 *
 * The executor processes steps synchronously until it hits a gate (confirmation
 * or wait_time). Gates pause the run in the DB; external events (approve/resume)
 * call back into executeNextStep to continue.
 */

import { db } from "../db";
import { workflowRuns, workflowSteps } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";
import { getWorkflowDefinition, type WorkflowContext, type WorkflowStepDefinition } from "./definitions";
import { proposeToolCall } from "../agent-tools/runtime";

const MAX_RECURSION = 20; // safeguard against infinite branch loops

// ─── Public API ───────────────────────────────────────────────────────────────

export type StartWorkflowInput = {
  orgId: string;
  workflowType: string;
  triggerReason?: string;
  triggerSource?: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  sourceRecommendationId?: string;
  sourceRevenueActionId?: string;
  initialContext?: Record<string, any>;
};

export async function startWorkflow(input: StartWorkflowInput): Promise<{ runId: string; started: boolean; error?: string; duplicate?: boolean; existingRunId?: string }> {
  const def = getWorkflowDefinition(input.workflowType);
  if (!def) return { runId: "", started: false, error: `Unknown workflow type: ${input.workflowType}` };

  // ── Duplicate prevention ───────────────────────────────────────────────────
  if (input.entityId) {
    const { checkWorkflowDuplicate } = await import("./mapper");
    const dup = await checkWorkflowDuplicate(input.orgId, input.workflowType, input.entityId);
    if (dup.isDuplicate && dup.existingRunId) {
      return { runId: dup.existingRunId, started: false, duplicate: true, error: `A ${input.workflowType} workflow is already active for this entity (status: ${dup.existingStatus})` };
    }
  }

  const context: WorkflowContext = {
    orgId: input.orgId,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    triggerReason: input.triggerReason,
    ...input.initialContext,
  };

  const [run] = await db.insert(workflowRuns).values({
    orgId: input.orgId,
    workflowType: input.workflowType,
    displayName: def.displayName,
    status: "running",
    currentStepIndex: 0,
    totalSteps: def.steps.length,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    entityName: input.entityName ?? null,
    triggerReason: input.triggerReason ?? null,
    triggerSource: input.triggerSource ?? null,
    sourceRecommendationId: input.sourceRecommendationId ?? null,
    sourceRevenueActionId: input.sourceRevenueActionId ?? null,
    context,
    startedAt: new Date(),
  }).returning();

  // Create all step records up-front (pending state)
  await db.insert(workflowSteps).values(
    def.steps.map(s => ({
      workflowRunId: run.id,
      orgId: input.orgId,
      stepIndex: s.index,
      stepName: s.name,
      stepType: s.type,
      status: "pending",
    }))
  );

  // Execute immediately
  await executeNextStep(run.id, input.orgId, 0);
  return { runId: run.id, started: true };
}

export async function approveWorkflowStep(runId: string, orgId: string, approvedBy: string): Promise<{ ok: boolean; error?: string }> {
  const run = await getRunById(runId, orgId);
  if (!run) return { ok: false, error: "Workflow run not found" };
  if (run.status !== "waiting_confirmation") return { ok: false, error: `Cannot approve: workflow is ${run.status}` };

  const step = await getCurrentStep(runId, run.currentStepIndex);
  if (!step) return { ok: false, error: "Current step not found" };

  // Update context with draft data if this was a wait_confirmation after a tool_call
  const stepOutput = step.output as any ?? {};
  const contextPatch: Record<string, any> = { lastApprovedBy: approvedBy };
  if (stepOutput.subject) contextPatch.draftSubject = stepOutput.subject;
  if (stepOutput.body)    contextPatch.draftBody    = stepOutput.body;
  if (stepOutput.smsBody) contextPatch.smsDraftBody  = stepOutput.smsBody;

  await db.update(workflowSteps)
    .set({ status: "completed", completedAt: new Date(), confirmationStatus: "confirmed", confirmedBy: approvedBy })
    .where(eq(workflowSteps.id, step.id));

  await db.update(workflowRuns)
    .set({ status: "running", context: { ...(run.context as any), ...contextPatch } })
    .where(eq(workflowRuns.id, runId));

  await executeNextStep(runId, orgId, run.currentStepIndex + 1);
  return { ok: true };
}

export async function rejectWorkflowStep(runId: string, orgId: string, rejectedBy: string): Promise<{ ok: boolean }> {
  const run = await getRunById(runId, orgId);
  if (!run) return { ok: false };

  const step = await getCurrentStep(runId, run.currentStepIndex);
  if (step) {
    await db.update(workflowSteps)
      .set({ status: "failed", completedAt: new Date(), confirmationStatus: "rejected", confirmedBy: rejectedBy, error: "Rejected by admin" })
      .where(eq(workflowSteps.id, step.id));
  }

  await db.update(workflowRuns)
    .set({ status: "cancelled", cancelledAt: new Date(), error: `Step "${step?.stepName}" rejected by ${rejectedBy}` })
    .where(eq(workflowRuns.id, runId));

  return { ok: true };
}

export async function cancelWorkflow(runId: string, orgId: string): Promise<{ ok: boolean }> {
  await db.update(workflowRuns)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.orgId, orgId)));
  return { ok: true };
}

export async function resumeWaitingWorkflows(orgId: string): Promise<number> {
  const now = new Date();
  const waitingRuns = await db.select().from(workflowRuns)
    .where(and(
      eq(workflowRuns.orgId, orgId),
      eq(workflowRuns.status, "waiting_response"),
    ));

  let resumed = 0;
  for (const run of waitingRuns) {
    if (run.nextCheckAt && run.nextCheckAt <= now) {
      // Complete the wait_time step and advance
      const step = await getCurrentStep(run.id, run.currentStepIndex);
      if (step) {
        await db.update(workflowSteps)
          .set({ status: "completed", completedAt: new Date(), output: { waitCompleted: true } })
          .where(eq(workflowSteps.id, step.id));
      }
      await db.update(workflowRuns)
        .set({ status: "running", nextCheckAt: null })
        .where(eq(workflowRuns.id, run.id));
      await executeNextStep(run.id, orgId, run.currentStepIndex + 1);
      resumed++;
    }
  }
  return resumed;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

export async function getWorkflowRunWithSteps(runId: string, orgId: string) {
  const [run] = await db.select().from(workflowRuns)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.orgId, orgId)));
  if (!run) return null;
  const steps = await db.select().from(workflowSteps)
    .where(eq(workflowSteps.workflowRunId, runId))
    .orderBy(workflowSteps.stepIndex);
  return { run, steps };
}

export async function listWorkflowRuns(orgId: string, limit = 50) {
  return db.select().from(workflowRuns)
    .where(eq(workflowRuns.orgId, orgId))
    .orderBy(workflowRuns.createdAt)
    .limit(limit);
}

export async function getWorkflowStats(orgId: string) {
  const runs = await db.select().from(workflowRuns).where(eq(workflowRuns.orgId, orgId));
  const total = runs.length;
  const completed = runs.filter(r => r.status === "completed").length;
  const failed = runs.filter(r => r.status === "failed" || r.status === "cancelled").length;
  const running = runs.filter(r => r.status === "running" || r.status === "waiting_confirmation" || r.status === "waiting_response").length;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const byType: Record<string, number> = {};
  for (const r of runs) {
    byType[r.workflowType] = (byType[r.workflowType] ?? 0) + 1;
  }

  return { total, completed, failed, running, completionRate, byType };
}

// ─── Core Executor ────────────────────────────────────────────────────────────

async function executeNextStep(runId: string, orgId: string, stepIndex: number, depth = 0): Promise<void> {
  if (depth > MAX_RECURSION) {
    await failWorkflow(runId, "Max recursion depth exceeded (possible branch loop)");
    return;
  }

  const run = await getRunById(runId, orgId);
  if (!run || run.status === "cancelled" || run.status === "completed" || run.status === "failed") return;

  const def = getWorkflowDefinition(run.workflowType);
  if (!def) { await failWorkflow(runId, "Workflow definition not found"); return; }

  // Update current step index on run
  await db.update(workflowRuns)
    .set({ currentStepIndex: stepIndex })
    .where(eq(workflowRuns.id, runId));

  if (stepIndex >= def.steps.length) {
    await completeWorkflow(runId);
    return;
  }

  const stepDef = def.steps[stepIndex];
  const step = await getCurrentStep(runId, stepIndex);
  if (!step) { await failWorkflow(runId, `Step ${stepIndex} record not found`); return; }

  const ctx = (run.context ?? {}) as WorkflowContext;

  // Mark step as running
  await db.update(workflowSteps)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(workflowSteps.id, step.id));

  try {
    switch (stepDef.type) {

      case "tool_call": {
        const builtInput = stepDef.buildInput(ctx);
        const result = await proposeToolCall(orgId, {
          agentName: `workflow:${run.workflowType}`,
          toolName: stepDef.toolName,
          targetType: ctx.entityType,
          targetId: ctx.entityId,
          targetName: ctx.entityName,
          proposedInput: builtInput,
          reason: `Workflow step: ${stepDef.description}`,
          confidence: 0.95,
          sourceRecommendationId: run.sourceRecommendationId ?? undefined,
          sourceRevenueActionId: run.sourceRevenueActionId ?? undefined,
        });

        if (result.requiresConfirmation) {
          // Store the draft content in step output for review
          await db.update(workflowSteps)
            .set({ status: "waiting_confirmation", toolCallId: result.toolCallId, output: builtInput, confirmationStatus: "pending" })
            .where(eq(workflowSteps.id, step.id));
          await db.update(workflowRuns)
            .set({ status: "waiting_confirmation" })
            .where(eq(workflowRuns.id, runId));
          return; // gate — executor pauses here
        }

        if (!result.success && (step.retryCount ?? 0) < (stepDef.maxRetries ?? 1)) {
          await db.update(workflowSteps)
            .set({ retryCount: (step.retryCount ?? 0) + 1, error: result.error ?? "Tool execution failed" })
            .where(eq(workflowSteps.id, step.id));
          await executeNextStep(runId, orgId, stepIndex, depth + 1); // retry same step
          return;
        }

        // Patch useful tool outputs into workflow context
        const ctxPatch: Record<string, any> = {};
        if (builtInput.subject) ctxPatch.draftSubject = builtInput.subject;
        if (builtInput.body)    ctxPatch.draftBody    = builtInput.body;
        if (builtInput.body && stepDef.toolName === "create_sms_draft") ctxPatch.smsDraftBody = builtInput.body;
        if (stepDef.toolName === "send_sms") ctxPatch.smsSent = true;
        if (stepDef.toolName === "send_email") ctxPatch.emailSent = true;

        await db.update(workflowSteps)
          .set({ status: result.success ? "completed" : "failed", completedAt: new Date(), toolCallId: result.toolCallId, output: { ...builtInput, toolCallId: result.toolCallId, success: result.success }, error: result.error ?? null })
          .where(eq(workflowSteps.id, step.id));

        if (Object.keys(ctxPatch).length) {
          await db.update(workflowRuns)
            .set({ context: { ...ctx, ...ctxPatch } })
            .where(eq(workflowRuns.id, runId));
        }

        await executeNextStep(runId, orgId, stepIndex + 1, depth + 1);
        break;
      }

      case "wait_confirmation": {
        await db.update(workflowSteps)
          .set({ status: "waiting_confirmation", confirmationStatus: "pending", output: { prompt: stepDef.prompt } })
          .where(eq(workflowSteps.id, step.id));
        await db.update(workflowRuns)
          .set({ status: "waiting_confirmation" })
          .where(eq(workflowRuns.id, runId));
        return; // gate
      }

      case "wait_time": {
        const resumeAt = new Date();
        resumeAt.setDate(resumeAt.getDate() + stepDef.days);
        await db.update(workflowSteps)
          .set({ status: "waiting_response", output: { waitDays: stepDef.days, resumeAt: resumeAt.toISOString() } })
          .where(eq(workflowSteps.id, step.id));
        await db.update(workflowRuns)
          .set({ status: "waiting_response", nextCheckAt: resumeAt })
          .where(eq(workflowRuns.id, runId));
        return; // gate
      }

      case "check_response": {
        // Heuristic: check if the entity has had recent activity in the DB
        const hasResponse = await checkEntityResponse(run, stepDef.checkFn);
        const updatedCtx = { ...ctx, hasResponse };
        await db.update(workflowRuns)
          .set({ context: updatedCtx })
          .where(eq(workflowRuns.id, runId));
        await db.update(workflowSteps)
          .set({ status: "completed", completedAt: new Date(), output: { hasResponse } })
          .where(eq(workflowSteps.id, step.id));
        await executeNextStep(runId, orgId, stepIndex + 1, depth + 1);
        break;
      }

      case "branch": {
        const condition = stepDef.condition;
        const passes = !!(ctx as any)[condition];
        const targetIndex = passes ? stepDef.trueStepIndex : stepDef.falseStepIndex;

        await db.update(workflowSteps)
          .set({ status: "completed", completedAt: new Date(), output: { condition, result: passes, targetIndex } })
          .where(eq(workflowSteps.id, step.id));

        // Skip over any steps between current+1 and targetIndex
        if (targetIndex > stepIndex + 1) {
          await db.update(workflowSteps)
            .set({ status: "skipped", completedAt: new Date() })
            .where(and(
              eq(workflowSteps.workflowRunId, runId),
              // Use raw SQL for range check
            ));
          // Skip steps individually
          for (let i = stepIndex + 1; i < targetIndex; i++) {
            const skipStep = await getCurrentStep(runId, i);
            if (skipStep && skipStep.status === "pending") {
              await db.update(workflowSteps)
                .set({ status: "skipped", completedAt: new Date(), output: { reason: `Branched from step ${stepIndex} → ${targetIndex}` } })
                .where(eq(workflowSteps.id, skipStep.id));
            }
          }
        }

        await executeNextStep(runId, orgId, targetIndex, depth + 1);
        break;
      }

      case "notify": {
        // Future: send real notification. For now, just log.
        await db.update(workflowSteps)
          .set({ status: "completed", completedAt: new Date(), output: { message: stepDef.message } })
          .where(eq(workflowSteps.id, step.id));
        await executeNextStep(runId, orgId, stepIndex + 1, depth + 1);
        break;
      }

      case "complete": {
        await db.update(workflowSteps)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(workflowSteps.id, step.id));
        await completeWorkflow(runId);
        break;
      }

      default: {
        // Unknown step type — skip
        await db.update(workflowSteps)
          .set({ status: "skipped", completedAt: new Date() })
          .where(eq(workflowSteps.id, step.id));
        await executeNextStep(runId, orgId, stepIndex + 1, depth + 1);
      }
    }
  } catch (err: any) {
    await db.update(workflowSteps)
      .set({ status: "failed", completedAt: new Date(), error: err.message })
      .where(eq(workflowSteps.id, step.id));
    await failWorkflow(runId, `Step "${stepDef.name}" failed: ${err.message}`);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getRunById(runId: string, orgId: string) {
  const [run] = await db.select().from(workflowRuns)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.orgId, orgId)));
  return run ?? null;
}

async function getCurrentStep(runId: string, stepIndex: number) {
  const [step] = await db.select().from(workflowSteps)
    .where(and(eq(workflowSteps.workflowRunId, runId), eq(workflowSteps.stepIndex, stepIndex)));
  return step ?? null;
}

async function completeWorkflow(runId: string) {
  await db.update(workflowRuns)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(workflowRuns.id, runId));
}

async function failWorkflow(runId: string, error: string) {
  await db.update(workflowRuns)
    .set({ status: "failed", error, completedAt: new Date() })
    .where(eq(workflowRuns.id, runId));
}

async function checkEntityResponse(run: any, checkFn?: string): Promise<boolean> {
  // Heuristic checks based on entity type and available data
  // In production, these would query real event data (email opens, deal movement, etc.)
  if (!run.entityId) return false;

  try {
    if (checkFn === "deal_activity" && run.entityId) {
      const { db: database } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const result = await database.execute(sql`
        SELECT COUNT(*) as cnt FROM deal_activities
        WHERE deal_id = ${run.entityId}
          AND created_at > ${run.startedAt ?? new Date(0)}
        LIMIT 1
      `);
      return Number((result.rows[0] as any)?.cnt ?? 0) > 0;
    }
    if (checkFn === "client_activity" && run.entityId) {
      const { db: database } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const result = await database.execute(sql`
        SELECT COUNT(*) as cnt FROM sessions
        WHERE client_id = ${run.entityId}
          AND created_at > ${run.startedAt ?? new Date(0)}
        LIMIT 1
      `);
      return Number((result.rows[0] as any)?.cnt ?? 0) > 0;
    }
    if (checkFn === "payment_status" && run.entityId) {
      const { db: database } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const result = await database.execute(sql`
        SELECT COUNT(*) as cnt FROM payments
        WHERE client_id = ${run.entityId} OR session_id = ${run.entityId}
          AND created_at > ${run.startedAt ?? new Date(0)}
          AND status = 'succeeded'
        LIMIT 1
      `);
      return Number((result.rows[0] as any)?.cnt ?? 0) > 0;
    }
  } catch {
    // Table might not exist — default to false
  }

  return false;
}
