import { storage } from "../storage";
import { buildProspectContext, type ProspectContext } from "./contextual-intelligence";

export interface GlobalAction {
  id: string;
  actionType: string;
  title: string;
  reason: string;
  priorityScore: number;
  estimatedValue: number;
  confidence: "low" | "medium" | "high";
  sourceType: "prospect" | "deal" | "followup" | "risk";
  prospectId?: string;
  prospectName?: string;
  dealId?: string;
  dealStatus?: string;
  sport?: string;
  city?: string;
}

export interface GlobalPriorityQueue {
  topAction: GlobalAction | null;
  topThree: GlobalAction[];
  fullQueue: GlobalAction[];
  generatedAt: string;
}

function normalizeValue(value: number, max = 5000): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

function computeGlobalPriorityScore(params: {
  revenueValue: number;
  urgency: number;
  likelihood: number;
  risk: number;
  actionType: string;
}): number {
  const { revenueValue, urgency, likelihood, risk, actionType } = params;

  const revenueWeight = Math.min(100, revenueValue);
  const urgencyWeight = Math.min(100, urgency);
  const likelihoodWeight = Math.min(100, likelihood);
  const riskPenalty = Math.min(100, risk);

  const lowEffortActions: Record<string, number> = {
    create_deal: 5,
    generate_response: 5,
    send_follow_up: 3,
    send_initial_email: 3,
    schedule_call: 2,
    mark_interested: 2,
    generate_draft: 1,
    stop_sequence: 1,
    wait: 0,
  };
  const effortBonus = lowEffortActions[actionType] ?? 0;

  const raw =
    revenueWeight * 0.35 +
    urgencyWeight * 0.25 +
    likelihoodWeight * 0.25 -
    riskPenalty * 0.15 +
    effortBonus;

  return Math.round(Math.max(0, Math.min(100, raw)));
}

function actionTitle(actionType: string, prospectName: string): string {
  const titles: Record<string, string> = {
    create_deal: `Create deal for ${prospectName}`,
    generate_response: `Respond to ${prospectName}`,
    schedule_call: `Schedule call with ${prospectName}`,
    send_follow_up: `Follow up with ${prospectName}`,
    generate_draft: `Draft outreach to ${prospectName}`,
    send_initial_email: `Send initial email to ${prospectName}`,
    mark_interested: `Mark ${prospectName} as interested`,
    create_proposal: `Send proposal to ${prospectName}`,
    mark_do_not_contact: `Review contact status for ${prospectName}`,
    stop_sequence: `Stop outreach to ${prospectName}`,
    wait: `Monitor ${prospectName}`,
  };
  return titles[actionType] ?? `Take action on ${prospectName}`;
}

function confidenceFromPriority(priority: string): "low" | "medium" | "high" {
  if (priority === "urgent" || priority === "high") return "high";
  if (priority === "medium") return "medium";
  return "low";
}

export async function buildGlobalActionQueue(orgId: string): Promise<GlobalPriorityQueue> {
  const prospects = await storage.getTeamTrainingProspects(orgId);
  const limited = prospects.slice(0, 80);

  const ctxs = await Promise.all(
    limited.map((p) => buildProspectContext(p.id, orgId).catch(() => null))
  );
  const valid = ctxs.filter(Boolean) as ProspectContext[];

  const actions: GlobalAction[] = [];

  const maxValue = Math.max(
    1000,
    ...valid.map((c) => c.prospect.estimatedValue ?? 0),
    ...valid.map((c) => (c.deal ? c.deal.estimatedValue ?? 0 : 0))
  );

  for (const ctx of valid) {
    const { prospect, safety, intelligence, deal, followUps } = ctx;
    const { isDNC, isOptedOut } = safety;

    if (isDNC || isOptedOut) continue;

    const nba = intelligence.nextBestAction;
    const scores = intelligence.scores;

    if (nba.actionType === "stop_sequence" || nba.actionType === "wait") {
      if (scores.risk < 70) continue;
    }

    const revenueValue = normalizeValue(prospect.estimatedValue ?? 0, maxValue);
    const urgencyBoost = nba.priority === "urgent" ? 20 : nba.priority === "high" ? 10 : 0;
    const urgency = Math.min(100, scores.urgency + urgencyBoost);
    const likelihood = Math.round((scores.warmth + scores.fit) / 2);

    const score = computeGlobalPriorityScore({
      revenueValue,
      urgency,
      likelihood,
      risk: scores.risk,
      actionType: nba.actionType,
    });

    const action: GlobalAction = {
      id: `prospect-${prospect.id}`,
      actionType: nba.actionType,
      title: actionTitle(nba.actionType, prospect.prospectName),
      reason: nba.reason,
      priorityScore: score,
      estimatedValue: prospect.estimatedValue ?? 0,
      confidence: confidenceFromPriority(nba.priority),
      sourceType: "prospect",
      prospectId: prospect.id,
      prospectName: prospect.prospectName,
      sport: prospect.sport ?? undefined,
      city: prospect.city ?? undefined,
    };

    if (deal && !["won", "lost"].includes(deal.status)) {
      const dealDays = deal.lastActivityAt
        ? Math.floor((Date.now() - new Date(deal.lastActivityAt).getTime()) / 86400000)
        : 99;
      const dealUrgencyBonus = dealDays >= 14 ? 25 : dealDays >= 7 ? 15 : 5;
      const dealValue = normalizeValue(deal.estimatedValue ?? prospect.estimatedValue ?? 0, maxValue);
      const dealScore = computeGlobalPriorityScore({
        revenueValue: dealValue,
        urgency: Math.min(100, urgency + dealUrgencyBonus),
        likelihood: Math.min(100, likelihood + 10),
        risk: scores.risk,
        actionType: "schedule_call",
      });

      const dealTitle = dealDays >= 7
        ? `Re-engage stale deal with ${prospect.prospectName} (${dealDays}d inactive)`
        : `Advance deal with ${prospect.prospectName} — stage: ${deal.status}`;

      actions.push({
        id: `deal-${deal.id}`,
        actionType: dealDays >= 7 ? "generate_response" : "schedule_call",
        title: dealTitle,
        reason: dealDays >= 7
          ? `Deal has been inactive for ${dealDays} days — re-engage before it goes cold`
          : `Active deal in "${deal.status}" stage — advance to next step`,
        priorityScore: Math.max(score, dealScore),
        estimatedValue: deal.estimatedValue ?? prospect.estimatedValue ?? 0,
        confidence: dealDays >= 14 ? "high" : "medium",
        sourceType: "deal",
        prospectId: prospect.id,
        prospectName: prospect.prospectName,
        dealId: deal.id,
        dealStatus: deal.status,
        sport: prospect.sport ?? undefined,
        city: prospect.city ?? undefined,
      });
    }

    const dueFollowUps = followUps.filter(
      (f: any) =>
        f.status === "pending" &&
        f.scheduledFor &&
        new Date(f.scheduledFor) <= new Date()
    );
    if (dueFollowUps.length > 0) {
      const followUpScore = computeGlobalPriorityScore({
        revenueValue,
        urgency: Math.min(100, urgency + 15),
        likelihood,
        risk: scores.risk,
        actionType: "send_follow_up",
      });
      actions.push({
        id: `followup-${prospect.id}-${dueFollowUps[0].id}`,
        actionType: "send_follow_up",
        title: `Follow-up due: ${prospect.prospectName}`,
        reason: `${dueFollowUps.length} follow-up step${dueFollowUps.length > 1 ? "s" : ""} scheduled and ready to send`,
        priorityScore: Math.max(score, followUpScore),
        estimatedValue: prospect.estimatedValue ?? 0,
        confidence: "medium",
        sourceType: "followup",
        prospectId: prospect.id,
        prospectName: prospect.prospectName,
        sport: prospect.sport ?? undefined,
        city: prospect.city ?? undefined,
      });
    }

    if (nba.actionType !== "wait" && nba.actionType !== "stop_sequence") {
      actions.push(action);
    }
  }

  const sorted = actions
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 20);

  const deduped: GlobalAction[] = [];
  const seenProspects = new Set<string>();
  for (const action of sorted) {
    const key = action.prospectId ?? action.id;
    if (seenProspects.has(key)) continue;
    seenProspects.add(key);
    deduped.push(action);
    if (deduped.length >= 10) break;
  }

  const fullQueue = deduped.slice(0, 5);
  const topThree = fullQueue.slice(0, 3);
  const topAction = fullQueue[0] ?? null;

  return { topAction, topThree, fullQueue, generatedAt: new Date().toISOString() };
}

export function buildGlobalPriorityContextString(queue: GlobalPriorityQueue): string {
  if (!queue.topAction) {
    return "\nGLOBAL PRIORITY CONTEXT: No high-priority actions identified. All prospects are either in cooldown, handled, or low priority.";
  }

  const lines: string[] = ["\nGLOBAL PRIORITY CONTEXT:"];
  lines.push(`- TOP ACTION: ${queue.topAction.title}`);
  lines.push(`  Why #1: ${queue.topAction.reason} | Est. value: $${queue.topAction.estimatedValue.toLocaleString()} | Priority score: ${queue.topAction.priorityScore}/100`);

  if (queue.topThree.length > 1) {
    lines.push("- NEXT BEST ACTIONS:");
    queue.topThree.slice(1).forEach((a, i) => {
      lines.push(`  ${i + 2}. ${a.title} — ${a.reason} (score: ${a.priorityScore}/100)`);
    });
  }

  lines.push("RULES: Always recommend the top action first when the coach asks 'what should I do'. Avoid suggesting lower-priority actions unless asked. High-value warm leads outrank cold outreach. Deal-closing actions outrank prospecting when pipeline is active.");

  return lines.join("\n");
}
