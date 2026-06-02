import { storage } from "../storage";
import { buildGlobalActionQueue, type GlobalAction } from "./global-priority-engine";
import { logTriggerEvent, updateTriggerEvent } from "./trigger-logger";

const MAX_AUTO_EXEC_PER_DAY = 3;
const RISK_THRESHOLD = 40;

const SAFE_ACTION_TYPES = new Set([
  "send_follow_up",
  "generate_draft",
  "send_initial_email",
]);

export interface AutoExecution {
  id: string;
  actionType: string;
  title: string;
  prospectId: string;
  prospectName: string;
  estimatedValue: number;
  draftId?: string;
  followUpId?: string;
  executedAt: string;
  outcome: "success" | "failed";
  error?: string;
  undone: boolean;
  engagementOutcome?: boolean;
  revenueAttributed?: number;
}

export interface AutoExecPerformanceMetrics {
  successRate: number;
  engagementRate: number;
  revenuePerAction: number;
  todayCount: number;
  maxPerDay: number;
  totalExecuted: number;
  totalSucceeded: number;
  recentActions: AutoExecution[];
}

export interface AutoExecuteResult {
  executed: boolean;
  execution: AutoExecution | null;
  reason?: string;
}

async function getAutoExecutionLog(orgId: string): Promise<AutoExecution[]> {
  try {
    const raw = await storage.getSetting(`auto_execution_log_${orgId}`);
    if (!raw) return [];
    return JSON.parse(raw) as AutoExecution[];
  } catch {
    return [];
  }
}

async function saveAutoExecutionLog(orgId: string, log: AutoExecution[]): Promise<void> {
  const trimmed = log.slice(-50);
  await storage.setSetting(`auto_execution_log_${orgId}`, JSON.stringify(trimmed));
}

function getTodayCount(log: AutoExecution[]): number {
  const today = new Date().toDateString();
  return log.filter(
    (e) => !e.undone && new Date(e.executedAt).toDateString() === today && e.outcome === "success"
  ).length;
}

function isAutoExecutable(action: GlobalAction, settings: Record<string, any>, todayCount: number): boolean {
  if (!settings.autoExecuteEnabled) return false;
  const maxPerDay = settings.autoExecuteMaxPerDay ?? MAX_AUTO_EXEC_PER_DAY;
  if (todayCount >= maxPerDay) return false;
  if (!SAFE_ACTION_TYPES.has(action.actionType)) return false;
  if (action.confidence !== "high") return false;
  const risk = (action as any).riskScore ?? 0;
  if (risk >= RISK_THRESHOLD) return false;
  if (!action.prospectId) return false;
  return true;
}

async function executeFollowUp(orgId: string, prospectId: string): Promise<string | null> {
  const dueFollowUps = await storage.getDueFollowUps(orgId);
  const prospectFollowUps = dueFollowUps.filter((f) => f.prospectId === prospectId);
  if (prospectFollowUps.length === 0) return null;

  const followUp = prospectFollowUps[0];

  const prospect = await storage.getTeamTrainingProspect(followUp.prospectId);
  if (!prospect?.contactEmail) return null;
  if (prospect.outreachStatus === "Do Not Contact" || prospect.outreachStatus === "Replied") return null;

  const optedOut = await storage.isProspectOptedOut(orgId, prospect.contactEmail);
  if (optedOut) return null;

  const activeDeal = await storage.getTeamTrainingDealByProspect(followUp.prospectId, orgId).catch(() => null);
  if (activeDeal && !["won", "lost"].includes(activeDeal.status)) return null;

  const org = await storage.getOrganizationById(orgId);
  const businessName = org?.name ?? "Our Training Facility";
  const ownerUser = org?.ownerUserId ? await storage.getUser(org.ownerUserId) : null;
  const coachName = ownerUser
    ? `${ownerUser.firstName} ${ownerUser.lastName ?? ""}`.trim()
    : "Coach";

  let subject = followUp.subject;
  let body = followUp.body;

  if (!subject || !body) {
    const FOLLOW_UP_OPENERS = [
      "Just wanted to follow up on my previous message regarding team training for",
      "Circling back on my last note about strength & conditioning for",
      "Wanted to reconnect — reaching out again about training programs for",
    ];
    const closingLines: Record<number, string> = {
      1: "I'd love to connect and share how we've helped similar programs this season.",
      2: "Would a quick 10-minute call make sense this week?",
      3: "If now isn't the right time, no worries — I'll close this out. Otherwise, I'm happy to connect.",
    };
    const opener = FOLLOW_UP_OPENERS[(followUp.stepNumber - 1) % FOLLOW_UP_OPENERS.length];
    const closingLine = closingLines[followUp.stepNumber] ?? closingLines[3];

    const variant = await storage.selectVariantForEmail(orgId);
    if (variant) {
      const { generateOutreachEmailFromVariant } = await import("../team-training-prospecting");
      const generated = await generateOutreachEmailFromVariant(
        {
          prospectName: prospect.prospectName,
          sport: prospect.sport || "sports",
          city: prospect.city || "",
          contactName: prospect.contactName || "",
          businessName,
          coachName,
        },
        variant
      );
      subject = `Re: ${generated.subject}`;
      body = `${opener} ${prospect.prospectName}.\n\n${closingLine}\n\n${generated.body}`;
    } else {
      subject = `Following up — Training for ${prospect.prospectName}`;
      body = `Hi${prospect.contactName ? " " + prospect.contactName : ""},\n\n${opener} ${prospect.prospectName}.\n\n${closingLine}\n\nBest,\n${coachName}\n${businessName}`;
    }
  }

  const branding = org
    ? {
        name: org.name,
        accentColor: org.primaryColor ?? undefined,
        emailPrimaryColor: org.emailPrimaryColor ?? undefined,
        emailSecondaryColor: org.emailSecondaryColor ?? undefined,
        ownerName: coachName,
        ownerEmail: org.ownerEmail ?? undefined,
      }
    : undefined;

  // ── Autonomy Policy Gate (Priority 2 Safety Pass) ────────────────────────
  const { evaluatePolicy } = await import("../services/autonomy-policy-engine");
  const policy = await evaluatePolicy({
    orgId,
    actionType: "send_follow_up",
    recipientEmail: prospect.contactEmail,
    confidence: 0.85,
    riskLevel: "low",
    bodyText: body ?? undefined,
    isFirstContact: false,
  }).catch(() => ({
    decision: "auto_execute" as const,
    reasons: [] as string[],
    confidence: 0.85,
    riskLevel: "low" as const,
    policyVersion: "1.0.0",
    evaluatedAt: new Date(),
  }));

  if (policy.decision !== "auto_execute") {
    // Create a proposal/block record in AI Comms Center for visibility
    const { db: _db } = await import("../db");
    const { gmailAgentActions: _gaa } = await import("@shared/schema");
    await _db
      .insert(_gaa)
      .values({
        orgId,
        actionType: "follow_up_email",
        recipientEmail: prospect.contactEmail,
        subject: subject ?? `Follow-up #${followUp.stepNumber} — ${prospect.prospectName}`,
        bodyPreview: (body ?? "").slice(0, 300),
        riskLevel: "low",
        approvalRequired: policy.decision === "approval_required",
        status: policy.decision === "approval_required" ? "proposed" : "blocked",
        communicationDomain: "team_training",
        createdByAgent: "auto_execution_engine",
        result: { followUpId: followUp.id, stepNumber: followUp.stepNumber },
      })
      .catch(() => {});
    console.log(
      `[Auto-Execute] follow-up ${followUp.id} ${policy.decision} by Autonomy Policy: ${policy.reasons.join("; ")}`
    );
    return null;
  }

  const { sendTeamTrainingOutreachEmail } = await import("../email");
  await sendTeamTrainingOutreachEmail(prospect.contactEmail, subject!, body!, branding, followUp.id);

  await storage.updateFollowUp(followUp.id, { status: "sent", sentAt: new Date(), subject, body });
  await storage.logOutreachEvent({
    orgId,
    prospectId: followUp.prospectId,
    draftId: followUp.outreachDraftId,
    eventType: "sent",
    description: `[Auto-Execute] Follow-up #${followUp.stepNumber} sent to ${prospect.contactEmail}`,
  });

  // Record outcome for attribution
  const { db: _outDb } = await import("../db");
  const { gmailAgentActions: _outGaa } = await import("@shared/schema");
  const [gmailAction] = await _outDb
    .insert(_outGaa)
    .values({
      orgId,
      actionType: "follow_up_email",
      recipientEmail: prospect.contactEmail,
      subject: subject!,
      bodyPreview: (body ?? "").slice(0, 300),
      riskLevel: "low",
      approvalRequired: false,
      status: "auto_executed",
      communicationDomain: "team_training",
      createdByAgent: "auto_execution_engine",
      executedAt: new Date(),
    })
    .returning()
    .catch(() => [{ id: "" }] as { id: string }[]);

  if (gmailAction?.id) {
    const { createOutcomeOnSend } = await import("../services/outcome-intelligence-service");
    createOutcomeOnSend({
      orgId,
      gmailActionId: gmailAction.id,
      communicationDomain: "team_training",
      messageType: "follow_up",
      recipientEmail: prospect.contactEmail,
      prospectId: followUp.prospectId,
    }).catch((e) => console.warn("[Auto-Execute] createOutcomeOnSend failed:", e.message));
  }

  return followUp.id;
}

async function executeDraftGeneration(
  orgId: string,
  prospectId: string,
  settings: Record<string, any>
): Promise<string | null> {
  const prospect = await storage.getTeamTrainingProspect(prospectId);
  if (!prospect?.contactEmail) return null;

  const existingDrafts = await storage.getOutreachDraftsByProspect(prospectId);
  if (existingDrafts.some((d) => !d.sentAt)) return null;

  const org = await storage.getOrganizationById(orgId);
  const businessName = org?.name ?? "Our Training Facility";
  const ownerUser = org?.ownerUserId ? await storage.getUser(org.ownerUserId) : null;
  const coachName = ownerUser
    ? `${ownerUser.firstName} ${ownerUser.lastName ?? ""}`.trim()
    : "Coach";

  const emailParams = {
    businessName,
    coachName,
    prospectName: prospect.prospectName,
    sport: prospect.sport || "your sport",
    city: prospect.city || "your area",
    contactName: prospect.contactName || "unknown",
  };

  const variant = await storage.selectVariantForEmail(orgId);
  let generated: { subject: string; body: string };

  if (variant) {
    const { generateOutreachEmailFromVariant } = await import("../team-training-prospecting");
    generated = await generateOutreachEmailFromVariant(emailParams, variant);
    await storage.updateEmailMessageVariant(variant.id, {
      timesUsed: (variant.timesUsed ?? 0) + 1,
    });
  } else {
    const { generateOutreachEmail } = await import("../team-training-prospecting");
    generated = await generateOutreachEmail(emailParams);
  }

  const autoSend = settings.autoSend === true;
  const saved = await storage.createOutreachDraft({
    orgId,
    prospectId,
    subject: generated.subject,
    body: generated.body,
    approved: autoSend,
    approvedAt: autoSend ? new Date() : undefined,
    messageVariantId: variant?.id,
  });

  await storage.logOutreachEvent({
    orgId,
    prospectId,
    draftId: saved.id,
    eventType: "draft_created",
    description: `[Auto-Execute] Draft generated for ${prospect.prospectName}`,
  });

  return saved.id;
}

export async function runAutoExecution(orgId: string): Promise<AutoExecuteResult> {
  const settings = await storage.getEmailAgentSettings(orgId);

  // Log the auto-exec evaluation event
  const triggerEventId = await logTriggerEvent({
    organizationId: orgId,
    triggerType: "auto_execution",
    triggerSource: "auto_exec_hook",
    actionType: "send_follow_up",
    reasoning: "Auto-execution engine evaluating highest-confidence action",
  });

  if (!settings.autoExecuteEnabled) {
    await updateTriggerEvent(triggerEventId, {
      wasExecuted: false,
      executionBlocked: true,
      blockReason: "AGENT_DISABLED",
      reasoning: "Auto-execute is disabled in settings",
    });
    return { executed: false, execution: null, reason: "auto-execute disabled" };
  }

  const log = await getAutoExecutionLog(orgId);
  const todayCount = getTodayCount(log);
  const maxPerDay = settings.autoExecuteMaxPerDay ?? MAX_AUTO_EXEC_PER_DAY;

  if (todayCount >= maxPerDay) {
    await updateTriggerEvent(triggerEventId, {
      wasExecuted: false,
      executionBlocked: true,
      blockReason: "AUTO_EXEC_LIMIT_REACHED",
      reasoning: `Auto-exec daily limit reached: ${todayCount}/${maxPerDay}`,
    });
    return { executed: false, execution: null, reason: `daily limit reached (${todayCount}/${maxPerDay})` };
  }

  const overview = await storage.getEmailAgentOverview(orgId);
  const dailyLimit = typeof settings.dailyLimit === "number" ? settings.dailyLimit : 10;
  if (overview.sentToday >= dailyLimit) {
    await updateTriggerEvent(triggerEventId, {
      wasExecuted: false,
      executionBlocked: true,
      blockReason: "DAILY_LIMIT_REACHED",
      reasoning: `Overall daily send limit reached: ${overview.sentToday}/${dailyLimit}`,
    });
    return { executed: false, execution: null, reason: "daily send limit reached" };
  }

  const queue = await buildGlobalActionQueue(orgId);
  const eligibleAction = queue.fullQueue.find((a) => isAutoExecutable(a, settings, todayCount));

  if (!eligibleAction) {
    await updateTriggerEvent(triggerEventId, {
      wasExecuted: false,
      executionBlocked: false,
      reasoning: "No eligible high-confidence actions found in global priority queue",
      missedOpportunity: queue.fullQueue.length > 0,
    });
    return { executed: false, execution: null, reason: "no eligible high-confidence actions" };
  }

  // Update trigger event with the selected action's context
  await storage.updateEmailTriggerEvent(triggerEventId, {
    prospectId: eligibleAction.prospectId ?? undefined,
    prospectName: eligibleAction.prospectName ?? undefined,
    actionType: eligibleAction.actionType as any,
    confidenceLevel: eligibleAction.confidence,
    riskScore: (eligibleAction as any).riskScore ?? 0,
    priorityScore: eligibleAction.priorityScore,
    reasoning: `Auto-executing: ${eligibleAction.title} (confidence: ${eligibleAction.confidence}, priority: ${eligibleAction.priorityScore})`,
  });

  const execution: AutoExecution = {
    id: crypto.randomUUID(),
    actionType: eligibleAction.actionType,
    title: eligibleAction.title,
    prospectId: eligibleAction.prospectId ?? "",
    prospectName: eligibleAction.prospectName ?? "Unknown",
    estimatedValue: eligibleAction.estimatedValue,
    executedAt: new Date().toISOString(),
    outcome: "success",
    undone: false,
    engagementOutcome: false,
    revenueAttributed: 0,
  };

  try {
    if (eligibleAction.actionType === "send_follow_up") {
      const followUpId = await executeFollowUp(orgId, eligibleAction.prospectId!);
      if (!followUpId) {
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: true,
          blockReason: "INVALID_STAGE",
          reasoning: "No due follow-up found for prospect",
          missedOpportunity: true,
        });
        return { executed: false, execution: null, reason: "no due follow-up found for prospect" };
      }
      execution.followUpId = followUpId;
    } else if (
      eligibleAction.actionType === "generate_draft" ||
      eligibleAction.actionType === "send_initial_email"
    ) {
      const draftId = await executeDraftGeneration(orgId, eligibleAction.prospectId!, settings);
      if (!draftId) {
        await updateTriggerEvent(triggerEventId, {
          wasExecuted: false,
          executionBlocked: true,
          blockReason: "INVALID_STAGE",
          reasoning: "Draft already exists or generation failed",
        });
        return { executed: false, execution: null, reason: "draft already exists or generation failed" };
      }
      execution.draftId = draftId;
    } else {
      await updateTriggerEvent(triggerEventId, {
        wasExecuted: false,
        executionBlocked: true,
        blockReason: "INVALID_STAGE",
        reasoning: `Action type not auto-executable: ${eligibleAction.actionType}`,
      });
      return { executed: false, execution: null, reason: `action type not auto-executable: ${eligibleAction.actionType}` };
    }
  } catch (err: any) {
    execution.outcome = "failed";
    execution.error = err.message;
    await saveAutoExecutionLog(orgId, [...log, execution]);
    await updateTriggerEvent(triggerEventId, {
      wasExecuted: false,
      executionBlocked: true,
      blockReason: "INVALID_STAGE",
      reasoning: `Execution error: ${err.message}`,
    });
    return { executed: false, execution, reason: err.message };
  }

  await saveAutoExecutionLog(orgId, [...log, execution]);
  console.log(`[Auto-Execute] org ${orgId} — executed: ${execution.title}`);

  await updateTriggerEvent(triggerEventId, {
    wasExecuted: true,
    executionBlocked: false,
    outreachDraftId: execution.draftId,
    followUpId: execution.followUpId,
    reasoning: `Successfully auto-executed: ${execution.title}`,
  });

  // Log to revenue outcome engine for attribution tracking
  try {
    const { logActionAsEvent } = await import("./revenue-outcome-engine");
    if (eligibleAction.prospectId) {
      const prospect = await storage.getTeamTrainingProspect(eligibleAction.prospectId);
      await logActionAsEvent(orgId, {
        actionType: eligibleAction.actionType,
        actionSource: "auto_executed",
        prospectId: eligibleAction.prospectId,
        prospectName: prospect?.prospectName ?? eligibleAction.prospectName,
        sport: prospect?.sport ?? eligibleAction.sport,
        executionLogId: execution.id,
        outcomeSource: eligibleAction.actionType,
      });
    }
  } catch (revErr: any) {
    console.warn("[Auto-Execute] revenue event log failed:", revErr.message);
  }

  return { executed: true, execution };
}

export async function undoAutoExecution(
  orgId: string,
  executionId: string
): Promise<{ success: boolean; message: string }> {
  const log = await getAutoExecutionLog(orgId);
  const execIndex = log.findIndex((e) => e.id === executionId);

  if (execIndex === -1) return { success: false, message: "Execution not found" };
  const exec = log[execIndex];
  if (exec.undone) return { success: false, message: "Already undone" };

  try {
    if (exec.followUpId) {
      const drafts = await storage.getOutreachDraftsByProspect(exec.prospectId);
      for (const draft of drafts) {
        await storage.cancelFollowUpSequence(draft.id).catch(() => {});
      }
    } else if (exec.draftId) {
      await storage.updateOutreachDraft(exec.draftId, {
        approved: false,
        body: "[Auto-execution undone — edit or delete this draft]",
      });
    }

    log[execIndex] = { ...exec, undone: true };
    await saveAutoExecutionLog(orgId, log);
    return { success: true, message: `Undone: ${exec.title}` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export async function getExecutionLog(orgId: string): Promise<AutoExecution[]> {
  return getAutoExecutionLog(orgId);
}

/**
 * Phase 6: Record engagement outcome for a past auto-execution (learning loop).
 * Call this when a prospect opens/clicks after an auto-executed email.
 */
export async function recordAutoExecEngagement(orgId: string, prospectId: string): Promise<void> {
  try {
    const log = await getAutoExecutionLog(orgId);
    const recentIdx = log.findIndex(
      (e) => e.prospectId === prospectId && !e.undone && e.outcome === "success" && !e.engagementOutcome
    );
    if (recentIdx === -1) return;
    log[recentIdx] = { ...log[recentIdx], engagementOutcome: true };
    await saveAutoExecutionLog(orgId, log);
  } catch {}
}

/**
 * Phase 6: Record revenue attribution for a past auto-execution (learning loop).
 */
export async function recordAutoExecRevenue(orgId: string, prospectId: string, value: number): Promise<void> {
  try {
    const log = await getAutoExecutionLog(orgId);
    const recentIdx = [...log].reverse().findIndex(
      (e) => e.prospectId === prospectId && !e.undone && e.outcome === "success"
    );
    if (recentIdx === -1) return;
    const actualIdx = log.length - 1 - recentIdx;
    log[actualIdx] = { ...log[actualIdx], revenueAttributed: (log[actualIdx].revenueAttributed ?? 0) + value };
    await saveAutoExecutionLog(orgId, log);
  } catch {}
}

export function getAutoExecPerformanceMetrics(
  log: AutoExecution[],
  settings: Record<string, any>
): AutoExecPerformanceMetrics {
  const today = new Date().toDateString();
  const todayExecs = log.filter(
    (e) => !e.undone && new Date(e.executedAt).toDateString() === today && e.outcome === "success"
  );
  const successExecs = log.filter((e) => e.outcome === "success" && !e.undone);
  const successRate = log.length > 0 ? Math.round((successExecs.length / log.length) * 100) : 100;
  const engagedExecs = successExecs.filter((e) => e.engagementOutcome === true);
  const engagementRate = successExecs.length > 0
    ? Math.round((engagedExecs.length / successExecs.length) * 100)
    : 0;
  const totalRevenue = successExecs.reduce((sum, e) => sum + (e.revenueAttributed ?? 0), 0);
  const revenuePerAction = successExecs.length > 0 ? Math.round(totalRevenue / successExecs.length) : 0;

  return {
    successRate,
    engagementRate,
    revenuePerAction,
    todayCount: todayExecs.length,
    maxPerDay: settings.autoExecuteMaxPerDay ?? MAX_AUTO_EXEC_PER_DAY,
    totalExecuted: log.length,
    totalSucceeded: successExecs.length,
    recentActions: log.slice(-10).reverse(),
  };
}

export function buildAutoExecContextString(
  log: AutoExecution[],
  settings: Record<string, any>
): string {
  const enabled = settings.autoExecuteEnabled === true;
  const metrics = getAutoExecPerformanceMetrics(log, settings);

  const parts: string[] = [
    `\nAUTO-EXECUTION STATUS: ${enabled ? "enabled" : "disabled"} | today: ${metrics.todayCount}/${metrics.maxPerDay} | success rate: ${metrics.successRate}% | engagement rate: ${metrics.engagementRate}% | revenue/action: $${metrics.revenuePerAction}`,
  ];

  const todayActions = metrics.recentActions.filter(
    (e) => new Date(e.executedAt).toDateString() === new Date().toDateString()
  );
  if (todayActions.length > 0) {
    parts.push(
      "Today's auto-executions: " +
        todayActions.slice(0, 3).map((e) => `${e.title} (${e.actionType})`).join(", ")
    );
  }

  if (metrics.engagementRate >= 40) {
    parts.push(`Auto-execution is performing well — ${metrics.engagementRate}% of auto-sent emails are generating engagement.`);
  } else if (metrics.engagementRate > 0 && metrics.engagementRate < 20) {
    parts.push(`Auto-execution engagement rate is low (${metrics.engagementRate}%) — consider reviewing prospect quality.`);
  }

  return parts.join("\n");
}