import { storage } from "../storage";
import { buildGlobalActionQueue, type GlobalAction } from "./global-priority-engine";

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

  if (!settings.autoExecuteEnabled) {
    return { executed: false, execution: null, reason: "auto-execute disabled" };
  }

  const log = await getAutoExecutionLog(orgId);
  const todayCount = getTodayCount(log);
  const maxPerDay = settings.autoExecuteMaxPerDay ?? MAX_AUTO_EXEC_PER_DAY;

  if (todayCount >= maxPerDay) {
    return { executed: false, execution: null, reason: `daily limit reached (${todayCount}/${maxPerDay})` };
  }

  const overview = await storage.getEmailAgentOverview(orgId);
  const dailyLimit = typeof settings.dailyLimit === "number" ? settings.dailyLimit : 10;
  if (overview.sentToday >= dailyLimit) {
    return { executed: false, execution: null, reason: "daily send limit reached" };
  }

  const queue = await buildGlobalActionQueue(orgId);
  const eligibleAction = queue.fullQueue.find((a) => isAutoExecutable(a, settings, todayCount));

  if (!eligibleAction) {
    return { executed: false, execution: null, reason: "no eligible high-confidence actions" };
  }

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
  };

  try {
    if (eligibleAction.actionType === "send_follow_up") {
      const followUpId = await executeFollowUp(orgId, eligibleAction.prospectId!);
      if (!followUpId) {
        return { executed: false, execution: null, reason: "no due follow-up found for prospect" };
      }
      execution.followUpId = followUpId;
    } else if (
      eligibleAction.actionType === "generate_draft" ||
      eligibleAction.actionType === "send_initial_email"
    ) {
      const draftId = await executeDraftGeneration(orgId, eligibleAction.prospectId!, settings);
      if (!draftId) {
        return { executed: false, execution: null, reason: "draft already exists or generation failed" };
      }
      execution.draftId = draftId;
    } else {
      return { executed: false, execution: null, reason: `action type not auto-executable: ${eligibleAction.actionType}` };
    }
  } catch (err: any) {
    execution.outcome = "failed";
    execution.error = err.message;
    await saveAutoExecutionLog(orgId, [...log, execution]);
    return { executed: false, execution, reason: err.message };
  }

  await saveAutoExecutionLog(orgId, [...log, execution]);
  console.log(`[Auto-Execute] org ${orgId} — executed: ${execution.title}`);

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

export function buildAutoExecContextString(
  log: AutoExecution[],
  settings: Record<string, any>
): string {
  const enabled = settings.autoExecuteEnabled === true;
  const maxPerDay = settings.autoExecuteMaxPerDay ?? MAX_AUTO_EXEC_PER_DAY;
  const today = new Date().toDateString();
  const todayExecs = log.filter(
    (e) => !e.undone && new Date(e.executedAt).toDateString() === today && e.outcome === "success"
  );
  const successCount = log.filter((e) => e.outcome === "success" && !e.undone).length;
  const successRate = log.length > 0 ? Math.round((successCount / log.length) * 100) : 0;

  const parts: string[] = [
    `\nAUTO-EXECUTION STATUS: ${enabled ? "enabled" : "disabled"} | today: ${todayExecs.length}/${maxPerDay} | success rate: ${successRate}%`,
  ];

  if (todayExecs.length > 0) {
    parts.push(
      "Recent auto-executions today: " +
        todayExecs
          .slice(-3)
          .map((e) => `${e.title} (${e.actionType})`)
          .join(", ")
    );
  }

  return parts.join("\n");
}
