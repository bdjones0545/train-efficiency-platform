/**
 * Workflow Executor — stateful step-by-step execution engine.
 *
 * States:  pending → running → waiting_confirmation | waiting_response → running → completed | failed | cancelled
 *
 * The executor processes steps synchronously until it hits a gate (confirmation
 * or wait_time). Gates pause the run in the DB; external events (approve/resume)
 * call back into executeNextStep to continue.
 *
 * Concurrency safety:
 *   - executeNextStep acquires a DB-level optimistic lock (lockedAt CAS) before
 *     processing. If the lock is held (lockedAt within 60s), the call is a no-op.
 *   - approveWorkflowStep uses a CAS on status='waiting_confirmation' so double-
 *     click approvals are idempotent.
 *   - resumeWaitingWorkflows acquires the per-run lock before resuming to prevent
 *     concurrent cron calls from double-advancing the same run.
 *   - External side-effect tools (send_email, send_sms) are never auto-retried
 *     by the executor — they rely on implementation-level dedup instead.
 */

import { db } from "../db";
import { workflowRuns, workflowSteps } from "@shared/schema";
import { eq, and, lt, sql } from "drizzle-orm";
import { getWorkflowDefinition, type WorkflowContext, type WorkflowStepDefinition } from "./definitions";
import { proposeToolCall } from "../agent-tools/runtime";
import { getTool } from "../agent-tools/registry";

const MAX_RECURSION = 20; // safeguard against infinite branch loops
const LOCK_TTL_SECONDS = 60; // a stale lock older than this is considered dead

const WORKFLOW_DOMAIN_MAP: Record<string, string> = {
  onboarding_sequence: "onboarding",
  session_booking: "evaluation_scheduling",
  reengage_inactive_client: "retention",
  unpaid_session_recovery: "payment_recovery",
  program_assignment: "program_assignment",
  win_back: "win_back",
  slot_fill_outreach: "athlete_lead",
  deal_followup: "athlete_lead",
};

async function refineWorkflowEmailWithLearning(
  orgId: string,
  workflowType: string,
  subject: string,
  body: string,
  recipientEmail?: string,
): Promise<{ subject: string; body: string; appliedRules: import("../services/message-learning-service").AppliedRuleMetadata[] } | null> {
  try {
    const domain = WORKFLOW_DOMAIN_MAP[workflowType] ?? "general";
    const { getMessageLearningContextWithRules } = await import("../services/message-learning-service");
    const { contextText: learningCtx, rules: appliedRules } = await getMessageLearningContextWithRules(orgId, domain);

    let priorContactBlock = "";
    if (recipientEmail) {
      try {
        const { getPriorContactContext } = await import("../services/agentmail-prior-contact-context-service");
        const priorCtx = await getPriorContactContext({ orgId, recipientEmail, communicationDomain: domain });
        if (priorCtx.hasPriorContact && priorCtx.promptBlock) {
          priorContactBlock = `\n${priorCtx.promptBlock}\n`;
        }
      } catch {}
    }

    if (!learningCtx && !priorContactBlock) return null;

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();

    const systemContent = [
      "You are an email refinement assistant. Improve the draft email while preserving its intent and structure.",
      learningCtx ? `\nCoaching rules:\n${learningCtx}` : "",
      priorContactBlock,
      "\nReturn only JSON: { \"subject\": \"...\", \"body\": \"...\" }",
    ].join("");

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: `Refine this email draft:\n\nSubject: ${subject}\n\nBody:\n${body}` },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    }, { timeout: 30_000 });

    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
    if (parsed.subject && parsed.body) {
      return { subject: parsed.subject, body: parsed.body, appliedRules };
    }
    return null;
  } catch {
    return null;
  }
}

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

  // ── Phase 3: Governance early-gate (emergency pause + capability check) ────
  // Check before any DB writes or tool calls. Non-blocking on config errors.
  try {
    const { validateAgentCapability } = await import("../capability-enforcement-engine");
    const { resolveAgentIdentity } = await import("../agent-identities");
    const agentName = input.triggeredBy ?? "workflow_agent";
    const identity = resolveAgentIdentity(agentName);
    const enfDecision = await validateAgentCapability({
      orgId: input.orgId,
      agentType: identity?.agentType ?? "workflow_agent",
      agentName,
      workflowType: input.workflowType,
      riskLevel: "low",
      confidenceScore: input.context?.confidenceScore ?? undefined,
    });
    if (enfDecision.outcome === "blocked") {
      return { runId: "", started: false, error: enfDecision.reason };
    }
  } catch (govErr) {
    // Governance validation failure must FAIL CLOSED — never silently allow
    console.error("[executor] governance pre-check failed — blocking workflow for safety:", govErr);
    try {
      const { logUnifiedAction } = await import("../unified-action-logger");
      await logUnifiedAction({
        orgId: input.orgId,
        actorType: "system",
        actorName: "workflow_agent",
        actionType: "governance_validation_failed",
        status: "failed",
        riskLevel: "high",
        reasoningSummary: `Governance validation error during workflow startup for type "${input.workflowType}": ${govErr instanceof Error ? govErr.message : String(govErr)}. Workflow blocked for safety.`,
      });
    } catch {}
    return { runId: "", started: false, error: "Governance validation failed unexpectedly — workflow blocked for safety. Resolve governance configuration and retry." };
  }

  // ── Duplicate prevention ───────────────────────────────────────────────────
  if (input.entityId) {
    const { checkWorkflowDuplicate } = await import("./mapper");
    const dup = await checkWorkflowDuplicate(input.orgId, input.workflowType, input.entityId);
    if (dup.isDuplicate && dup.existingRunId) {
      return { runId: dup.existingRunId, started: false, duplicate: true, error: `A ${input.workflowType} workflow is already active for this entity (status: ${dup.existingStatus})` };
    }
  }

  // ── Retrieve historical context (memory-aware execution) ──────────────────
  // Load prior memories for this entity so buildInput functions and downstream
  // tools can reference historical patterns, operator overrides, and outcomes.
  // Non-blocking: a failure here must never prevent workflow execution.
  let historicalContextSummary: string | undefined;
  let historicalContextBlock: string | undefined;
  try {
    if (input.entityId && input.entityType) {
      const { buildContextSummary } = await import("../workflow-context-engine");
      const ctxSummary = await buildContextSummary({
        orgId: input.orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        workflowType: input.workflowType,
      });
      if (ctxSummary.totalMemories > 0) {
        historicalContextSummary = `${ctxSummary.totalMemories} memories found`;
        historicalContextBlock = ctxSummary.contextBlock;
      }
    }
  } catch (_) { /* non-blocking */ }

  const context: WorkflowContext = {
    orgId: input.orgId,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    triggerReason: input.triggerReason,
    // Attach historical context so buildInput functions can reference it
    ...(historicalContextBlock ? { historicalContext: historicalContextBlock } : {}),
    ...(historicalContextSummary ? { historicalContextSummary } : {}),
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

  // Patch workflowRunId into context so buildInput functions can reference it
  // (e.g. create_invoice uses it to link the invoice back to this run for payment webhook resumption)
  await db.update(workflowRuns)
    .set({ context: { ...context, workflowRunId: run.id } })
    .where(eq(workflowRuns.id, run.id));

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

  const step = await getCurrentStep(runId, run.currentStepIndex);
  if (!step) return { ok: false, error: "Current step not found" };

  // ── Atomic CAS: only advance if status is actually waiting_confirmation ────
  // If two simultaneous approve requests arrive, only the first UPDATE finds
  // status='waiting_confirmation'; the second finds status='running' and is rejected.
  const patch: Record<string, any> = {};
  const stepOutput = step.output as any ?? {};
  if (stepOutput.subject) patch.draftSubject = stepOutput.subject;
  if (stepOutput.body)    patch.draftBody    = stepOutput.body;
  if (stepOutput.smsBody) patch.smsDraftBody  = stepOutput.smsBody;

  const advanced = await db.update(workflowRuns)
    .set({ status: "running", context: { ...(run.context as any), lastApprovedBy: approvedBy, ...patch } })
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, "waiting_confirmation")))
    .returning();

  if (!advanced.length) {
    const current = await getRunById(runId, orgId);
    return { ok: false, error: `Cannot approve: workflow is currently '${current?.status ?? "unknown"}' (already approved or progressed)` };
  }

  await db.update(workflowSteps)
    .set({ status: "completed", completedAt: new Date(), confirmationStatus: "confirmed", confirmedBy: approvedBy })
    .where(eq(workflowSteps.id, step.id));

  await executeNextStep(runId, orgId, run.currentStepIndex + 1);
  return { ok: true };
}

export async function rejectWorkflowStep(runId: string, orgId: string, rejectedBy: string): Promise<{ ok: boolean }> {
  const run = await getRunById(runId, orgId);
  if (!run) return { ok: false };

  // Guard: only cancel if currently waiting for confirmation
  if (run.status !== "waiting_confirmation") return { ok: false };

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
    if (!run.nextCheckAt || run.nextCheckAt > now) continue;

    // ── Per-run lock: skip if another process is already handling this run ──
    // Acquire by CAS: set locked_at only if not already locked (within TTL).
    const acquired = await db.update(workflowRuns)
      .set({ lockedAt: now })
      .where(and(
        eq(workflowRuns.id, run.id),
        eq(workflowRuns.status, "waiting_response"),
        sql`(locked_at IS NULL OR locked_at < NOW() - INTERVAL '${sql.raw(String(LOCK_TTL_SECONDS))} seconds')`,
      ))
      .returning();

    if (!acquired.length) {
      // Another worker holds the lock for this run — skip.
      continue;
    }

    try {
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
    } catch (err) {
      // Release the lock on unexpected error so it can be retried
      await db.update(workflowRuns)
        .set({ lockedAt: null })
        .where(eq(workflowRuns.id, run.id));
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

  // ── Execution lock ─────────────────────────────────────────────────────────
  // Acquire an optimistic lock on the run row. If lockedAt is set and fresh
  // (< LOCK_TTL_SECONDS old), another concurrent executeNextStep is in-flight
  // for this run. We bail out to avoid double-advancing steps.
  // This guard only applies to the outermost call (depth=0); recursive depth>0
  // calls are part of the same logical execution chain and don't need to re-lock.
  if (depth === 0) {
    const lockNow = new Date();
    const locked = await db.update(workflowRuns)
      .set({ lockedAt: lockNow })
      .where(and(
        eq(workflowRuns.id, runId),
        sql`(locked_at IS NULL OR locked_at < NOW() - INTERVAL '${sql.raw(String(LOCK_TTL_SECONDS))} seconds')`,
      ))
      .returning();

    if (!locked.length) {
      // Lock held by another concurrent caller — no-op.
      return;
    }
  }

  const run = await getRunById(runId, orgId);
  if (!run || run.status === "cancelled" || run.status === "completed" || run.status === "failed") {
    if (depth === 0) await releaseLock(runId);
    return;
  }

  const def = getWorkflowDefinition(run.workflowType);
  if (!def) {
    await failWorkflow(runId, "Workflow definition not found");
    await releaseLock(runId);
    return;
  }

  // Update current step index on run
  await db.update(workflowRuns)
    .set({ currentStepIndex: stepIndex })
    .where(eq(workflowRuns.id, runId));

  if (stepIndex >= def.steps.length) {
    await completeWorkflow(runId);
    return; // lock cleared by completeWorkflow
  }

  const stepDef = def.steps[stepIndex];
  const step = await getCurrentStep(runId, stepIndex);
  if (!step) {
    await failWorkflow(runId, `Step ${stepIndex} record not found`);
    return;
  }

  const ctx = (run.context ?? {}) as WorkflowContext;

  // Mark step as running
  await db.update(workflowSteps)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(workflowSteps.id, step.id));

  try {
    switch (stepDef.type) {

      case "tool_call": {
        let builtInput = stepDef.buildInput(ctx);

        let _workflowAppliedRules: import("../services/message-learning-service").AppliedRuleMetadata[] = [];
        if (stepDef.toolName === "create_email_draft" && builtInput.subject && builtInput.body) {
          const _wfRecipient = (builtInput.to ?? builtInput.recipientEmail ?? ctx.entityEmail ?? undefined) as string | undefined;
          const refined = await refineWorkflowEmailWithLearning(orgId, run.workflowType, builtInput.subject as string, builtInput.body as string, _wfRecipient);
          if (refined) {
            builtInput = { ...builtInput, subject: refined.subject, body: refined.body };
            _workflowAppliedRules = refined.appliedRules;
          }
        }

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

        // Record rule applications for email drafts — non-blocking, fail-open
        if (stepDef.toolName === "create_email_draft" && _workflowAppliedRules.length > 0 && result.toolCallId) {
          const _wfDomain = WORKFLOW_DOMAIN_MAP[run.workflowType] ?? "general";
          import("../services/agentmail-analytics-service").then(({ recordAgentMailRuleApplications }) =>
            recordAgentMailRuleApplications({ orgId, actionId: result.toolCallId!, communicationDomain: _wfDomain, rules: _workflowAppliedRules })
          ).catch(() => {});
        }

        if (result.requiresConfirmation) {
          // Store the draft content in step output for review
          await db.update(workflowSteps)
            .set({ status: "waiting_confirmation", toolCallId: result.toolCallId, output: builtInput, confirmationStatus: "pending" })
            .where(eq(workflowSteps.id, step.id));
          await db.update(workflowRuns)
            .set({ status: "waiting_confirmation", lockedAt: null })
            .where(eq(workflowRuns.id, runId));
          return; // gate — executor pauses here; lock released above
        }

        // ── Retry logic: NEVER auto-retry external side-effect tools ────────
        // Retrying send_email or send_sms risks duplicate sends even with
        // dedup in the implementation. Rely on implementation-level idempotency
        // only for explicit user-initiated retries, never automatic ones.
        const toolDef = getTool(stepDef.toolName);
        const isExternalSideEffect = toolDef?.permissions.external_side_effect ?? false;
        const maxRetries = isExternalSideEffect ? 0 : (stepDef.maxRetries ?? 1);

        if (!result.success && !isExternalSideEffect && (step.retryCount ?? 0) < maxRetries) {
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
        // Connector result patching
        if (stepDef.toolName === "create_calendar_event" && result.result?.calendarEventId) {
          ctxPatch.calendarEventId = result.result.calendarEventId;
        }
        if (stepDef.toolName === "create_invoice" && result.result?.agentInvoiceId) {
          ctxPatch.agentInvoiceId = result.result.agentInvoiceId;
          ctxPatch.stripeInvoiceId = result.result.stripeInvoiceId;
          ctxPatch.invoiceUrl = result.result.invoiceUrl;
        }

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
          .set({ status: "waiting_confirmation", lockedAt: null })
          .where(eq(workflowRuns.id, runId));
        return; // gate; lock released above
      }

      case "wait_time": {
        const resumeAt = new Date();
        resumeAt.setDate(resumeAt.getDate() + stepDef.days);
        await db.update(workflowSteps)
          .set({ status: "waiting_response", output: { waitDays: stepDef.days, resumeAt: resumeAt.toISOString() } })
          .where(eq(workflowSteps.id, step.id));
        await db.update(workflowRuns)
          .set({ status: "waiting_response", nextCheckAt: resumeAt, lockedAt: null })
          .where(eq(workflowRuns.id, runId));
        return; // gate; lock released above
      }

      case "wait_payment": {
        const agentInvoiceId = (ctx as any).agentInvoiceId ?? null;
        if (!agentInvoiceId) {
          throw new Error(
            "wait_payment step requires agentInvoiceId in workflow context — did the create_invoice step succeed?"
          );
        }

        const timeoutDays = (stepDef as any).timeoutDays ?? 14;
        const timeoutAt = new Date();
        timeoutAt.setDate(timeoutAt.getDate() + timeoutDays);

        await db.update(workflowSteps)
          .set({
            status: "waiting_response",
            output: { awaitingInvoiceId: agentInvoiceId, timeoutAt: timeoutAt.toISOString() },
          })
          .where(eq(workflowSteps.id, step.id));

        await db.update(workflowRuns)
          .set({
            status: "waiting_response",
            nextCheckAt: timeoutAt,
            context: { ...ctx, awaitingInvoiceId: agentInvoiceId },
            lockedAt: null,
          })
          .where(eq(workflowRuns.id, runId));

        // Back-link this run onto the agent_invoice record so the webhook can find it
        try {
          const { sql: sqlRaw } = await import("drizzle-orm");
          await db.execute(sqlRaw`
            UPDATE agent_invoices
            SET workflow_run_id = ${runId}, updated_at = NOW()
            WHERE id = ${agentInvoiceId}
              OR stripe_invoice_id = ${agentInvoiceId}
          `);
        } catch (e) {
          console.warn("[Workflow] Could not back-link agent_invoice to workflow run:", e);
        }

        return; // gate; lock released above
      }

      case "check_response": {
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
        for (let i = stepIndex + 1; i < targetIndex; i++) {
          const skipStep = await getCurrentStep(runId, i);
          if (skipStep && skipStep.status === "pending") {
            await db.update(workflowSteps)
              .set({ status: "skipped", completedAt: new Date(), output: { reason: `Branched from step ${stepIndex} → ${targetIndex}` } })
              .where(eq(workflowSteps.id, skipStep.id));
          }
        }

        await executeNextStep(runId, orgId, targetIndex, depth + 1);
        break;
      }

      case "notify": {
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
    .set({ status: "completed", completedAt: new Date(), lockedAt: null })
    .where(eq(workflowRuns.id, runId));

  // Persist workflow completion memory (non-blocking)
  try {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
    if (run?.entityId && run.orgId) {
      const { persistWorkflowMemory } = await import("../workflow-context-engine");
      await persistWorkflowMemory({
        orgId: run.orgId,
        entityType: run.entityType ?? "workflow",
        entityId: run.entityId,
        contextType: "workflow_memory",
        summary: `Workflow "${run.displayName ?? run.workflowType}" completed successfully.`,
        lastOutcome: "completed",
        sourceWorkflowId: runId,
        createdBy: "system",
      });
    }
  } catch (_) { /* non-blocking — never fail the completion */ }
}

async function failWorkflow(runId: string, error: string) {
  await db.update(workflowRuns)
    .set({ status: "failed", error, completedAt: new Date(), lockedAt: null })
    .where(eq(workflowRuns.id, runId));

  // Persist workflow failure memory (non-blocking)
  try {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
    if (run?.entityId && run.orgId) {
      const { persistWorkflowMemory } = await import("../workflow-context-engine");
      await persistWorkflowMemory({
        orgId: run.orgId,
        entityType: run.entityType ?? "workflow",
        entityId: run.entityId,
        contextType: "workflow_memory",
        summary: `Workflow "${run.displayName ?? run.workflowType}" failed: ${error.substring(0, 100)}`,
        lastOutcome: "failed",
        sourceWorkflowId: runId,
        createdBy: "system",
      });
    }
  } catch (_) { /* non-blocking */ }
}

async function releaseLock(runId: string) {
  await db.update(workflowRuns)
    .set({ lockedAt: null })
    .where(eq(workflowRuns.id, runId));
}

async function checkEntityResponse(run: any, checkFn?: string): Promise<boolean> {
  if (!run.entityId) return false;

  try {
    if (checkFn === "deal_activity" && run.entityId) {
      const { db: database } = await import("../db");
      const { sql: s } = await import("drizzle-orm");
      const result = await database.execute(s`
        SELECT COUNT(*) as cnt FROM deal_activities
        WHERE deal_id = ${run.entityId}
          AND created_at > ${run.startedAt ?? new Date(0)}
        LIMIT 1
      `);
      return Number((result.rows[0] as any)?.cnt ?? 0) > 0;
    }
    if (checkFn === "client_activity" && run.entityId) {
      const { db: database } = await import("../db");
      const { sql: s } = await import("drizzle-orm");
      const result = await database.execute(s`
        SELECT COUNT(*) as cnt FROM sessions
        WHERE client_id = ${run.entityId}
          AND created_at > ${run.startedAt ?? new Date(0)}
        LIMIT 1
      `);
      return Number((result.rows[0] as any)?.cnt ?? 0) > 0;
    }
    if (checkFn === "payment_status" && run.entityId) {
      const { db: database } = await import("../db");
      const { sql: s } = await import("drizzle-orm");
      const result = await database.execute(s`
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

// ─── Resume after payment (called by Stripe webhook) ─────────────────────────

export async function resumeWorkflowAfterPayment(
  runId: string,
  stripeInvoiceId: string
): Promise<{ resumed: boolean }> {
  // Only resume if the run is actually waiting_response and not locked
  const now = new Date();
  const acquired = await db.update(workflowRuns)
    .set({ lockedAt: now })
    .where(
      and(
        eq(workflowRuns.id, runId),
        eq(workflowRuns.status, "waiting_response"),
        sql`(locked_at IS NULL OR locked_at < NOW() - INTERVAL '60 seconds')`,
      )
    )
    .returning();

  if (!acquired.length) return { resumed: false };

  const run = acquired[0];
  const ctx = (run.context ?? {}) as Record<string, any>;

  const steps = await db.select().from(workflowSteps)
    .where(and(eq(workflowSteps.workflowRunId, runId), eq(workflowSteps.status, "waiting_response")));

  for (const step of steps) {
    await db.update(workflowSteps)
      .set({
        status: "completed",
        completedAt: now,
        output: { paymentReceived: true, stripeInvoiceId, resumedAt: now.toISOString() },
      })
      .where(eq(workflowSteps.id, step.id));
  }

  const updatedCtx = { ...ctx, paymentReceived: true, stripeInvoiceId, paidAt: now.toISOString() };
  await db.update(workflowRuns)
    .set({ status: "running", context: updatedCtx })
    .where(eq(workflowRuns.id, runId));

  const nextIndex = (run.currentStepIndex ?? 0) + 1;
  await executeNextStep(runId, run.orgId, nextIndex, 0);

  console.log(`[Workflow] Resumed run ${runId} after payment ${stripeInvoiceId} — advancing to step ${nextIndex}`);
  return { resumed: true };
}
