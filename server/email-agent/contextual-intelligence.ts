import { storage } from "../storage";

export type ReplyClassification =
  | "interested" | "not_interested" | "ask_info" | "referral"
  | "wrong_contact" | "out_of_office" | "unknown";

export interface IntelligenceScores {
  warmth: number;
  urgency: number;
  fit: number;
  risk: number;
}

export interface NextBestAction {
  actionType:
    | "send_initial_email" | "generate_draft" | "send_follow_up"
    | "wait" | "mark_interested" | "create_deal" | "schedule_call"
    | "generate_response" | "create_proposal" | "mark_do_not_contact"
    | "stop_sequence";
  priority: "low" | "medium" | "high" | "urgent";
  reason: string;
  estimatedValue: number;
  recommendedPrompt: string;
  requiresApproval: boolean;
}

export interface ProspectContext {
  prospect: any;
  engagement: {
    totalSent: number;
    opened: boolean;
    openCount: number;
    clicked: boolean;
    replied: boolean;
    replyClassification: ReplyClassification | null;
    replyText: string | null;
    lastDraftSentAt: Date | null;
  };
  outreachHistory: any[];
  followUps: any[];
  deal: any | null;
  safety: {
    isDNC: boolean;
    isOptedOut: boolean;
    cooldownActive: boolean;
    nextEligibleDate: Date | null;
  };
  intelligence: {
    scores: IntelligenceScores;
    nextBestAction: NextBestAction;
  };
}

export async function buildProspectContext(prospectId: string, orgId: string): Promise<ProspectContext | null> {
  const prospect = await storage.getTeamTrainingProspect(prospectId);
  if (!prospect || prospect.orgId !== orgId) return null;

  const settings = await storage.getEmailAgentSettings(orgId);
  const cooldownDays = settings.cooldownDays ?? 30;

  const drafts = await storage.getOutreachDraftsByProspect(prospectId);
  const sentDrafts = drafts.filter((d: any) => !!d.sentAt);

  const allFollowUps = await storage.getFollowUpsByOrg(orgId);
  const prospectFollowUps = allFollowUps.filter((f: any) => f.prospectId === prospectId);

  const deal = await storage.getTeamTrainingDealByProspect(prospectId, orgId);

  const isDNC = prospect.outreachStatus === "Do Not Contact";

  const lastContactedAt = prospect.lastContactedAt ? new Date(prospect.lastContactedAt) : null;
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  const cooldownActive = !isDNC && lastContactedAt ? (Date.now() - lastContactedAt.getTime()) < cooldownMs : false;
  const nextEligibleDate = cooldownActive && lastContactedAt ? new Date(lastContactedAt.getTime() + cooldownMs) : null;

  const sorted = sentDrafts.sort((a: any, b: any) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  const latestDraft = sorted[0] ?? null;
  const totalSent = sentDrafts.length;
  const openCount = sentDrafts.filter((d: any) => !!d.openedAt).length;
  const opened = openCount > 0;
  const clicked = sentDrafts.some((d: any) => !!d.clickedAt);
  const replied = sentDrafts.some((d: any) => !!d.repliedAt);
  const replyClassification = (latestDraft?.replyClassification ?? null) as ReplyClassification | null;
  const replyText = latestDraft?.replyText ?? null;
  const lastDraftSentAt = latestDraft?.sentAt ? new Date(latestDraft.sentAt) : null;

  const scores = computeIntelligenceScores({
    prospect, totalSent, openCount, opened, clicked, replied, replyClassification,
    deal, isDNC, cooldownActive, settings,
  });

  const safety = { isDNC, isOptedOut: false, cooldownActive, nextEligibleDate };
  const engagement = { totalSent, opened, openCount, clicked, replied, replyClassification, replyText, lastDraftSentAt };

  return {
    prospect,
    engagement,
    outreachHistory: sentDrafts,
    followUps: prospectFollowUps,
    deal: deal ?? null,
    safety,
    intelligence: {
      scores,
      nextBestAction: getNextBestAction({ prospect, engagement, deal: deal ?? null, safety, scores }),
    },
  };
}

function computeIntelligenceScores(params: {
  prospect: any;
  totalSent: number;
  openCount: number;
  opened: boolean;
  clicked: boolean;
  replied: boolean;
  replyClassification: ReplyClassification | null;
  deal: any | null;
  isDNC: boolean;
  cooldownActive: boolean;
  settings: Record<string, any>;
}): IntelligenceScores {
  const { prospect, totalSent, openCount, opened, clicked, replied, replyClassification, deal, isDNC, cooldownActive, settings } = params;

  // ─── Warmth Score ──────────────────────────────────────────────────────────
  let warmth = 20;
  if (replied) warmth += 35;
  if (replyClassification === "interested" || replyClassification === "ask_info") warmth += 25;
  else if (replyClassification === "not_interested" || replyClassification === "wrong_contact") warmth -= 35;
  if (clicked) warmth += 15;
  if (openCount >= 2) warmth += 15;
  else if (opened) warmth += 8;
  if (deal && !["won", "lost"].includes(deal.status)) warmth += 10;
  if (totalSent >= 3 && !replied && !opened) warmth -= 15;
  warmth = Math.max(0, Math.min(100, warmth));

  // ─── Urgency Score ─────────────────────────────────────────────────────────
  let urgency = 0;
  if (replyClassification === "interested") urgency += 50;
  else if (replyClassification === "ask_info") urgency += 35;
  if (deal && !["won", "lost"].includes(deal.status)) {
    urgency += 20;
    const daysSince = deal.lastActivityAt
      ? Math.floor((Date.now() - new Date(deal.lastActivityAt).getTime()) / 86400000)
      : 99;
    if (daysSince >= 7) urgency += 20;
    if (deal.nextAction) urgency += 15;
  }
  if ((prospect.estimatedValue ?? 0) >= 3000) urgency += 10;
  if (opened && !replied) urgency += 10;
  urgency = Math.max(0, Math.min(100, urgency));

  // ─── Fit Score ─────────────────────────────────────────────────────────────
  let fit = 20;
  if (prospect.contactEmail) fit += 20;
  fit += Math.round((prospect.confidenceScore ?? 50) * 0.3);
  if (prospect.sport && prospect.sport !== "unknown") fit += 15;
  if ((settings.preferredSports ?? []).length > 0 && (settings.preferredSports ?? []).includes(prospect.sport)) fit += 10;
  if ((prospect.estimatedValue ?? 0) > 0) fit += 10;
  fit = Math.max(0, Math.min(100, fit));

  // ─── Risk Score ────────────────────────────────────────────────────────────
  let risk = 0;
  if (isDNC) {
    risk = 100;
  } else {
    if (cooldownActive) risk += 45;
    if (replyClassification === "not_interested") risk += 40;
    if (replyClassification === "wrong_contact") risk += 30;
    if (totalSent >= 5) risk += 25;
    if (!prospect.contactEmail) risk += 20;
  }
  risk = Math.max(0, Math.min(100, risk));

  return { warmth, urgency, fit, risk };
}

export function getNextBestAction(params: {
  prospect: any;
  engagement: {
    totalSent: number;
    opened: boolean;
    openCount: number;
    clicked: boolean;
    replied: boolean;
    replyClassification: ReplyClassification | null;
    replyText: string | null;
    lastDraftSentAt: Date | null;
  };
  deal: any | null;
  safety: { isDNC: boolean; isOptedOut: boolean; cooldownActive: boolean; nextEligibleDate: Date | null };
  scores: IntelligenceScores;
}): NextBestAction {
  const { prospect, engagement, deal, safety, scores } = params;
  const { totalSent, opened, clicked, replied, replyClassification, replyText, lastDraftSentAt } = engagement;
  const { isDNC, cooldownActive } = safety;
  const estimatedValue = prospect.estimatedValue ?? 0;
  const name = prospect.prospectName ?? "This prospect";

  if (isDNC) {
    return { actionType: "stop_sequence", priority: "low", reason: "Marked as Do Not Contact", estimatedValue: 0, recommendedPrompt: `${name} is marked Do Not Contact. No further outreach.`, requiresApproval: false };
  }

  if (replyClassification === "not_interested") {
    return { actionType: "stop_sequence", priority: "low", reason: "Prospect replied not interested", estimatedValue: 0, recommendedPrompt: `${name} replied indicating no interest. Consider removing from outreach.`, requiresApproval: false };
  }

  if (replied && replyClassification === "interested" && !deal) {
    return { actionType: "create_deal", priority: "urgent", reason: "Interested reply with no deal — create deal now", estimatedValue, recommendedPrompt: `Create a deal for ${name} who replied interested. Estimated value: $${estimatedValue.toLocaleString()}. Move them into the Deal Pipeline immediately.`, requiresApproval: false };
  }

  if (replied && replyClassification === "interested" && deal) {
    return { actionType: "schedule_call", priority: "urgent", reason: "Interested prospect with active deal — schedule call", estimatedValue, recommendedPrompt: `${name} is interested and has an active deal. What should I say to schedule a discovery call or close the next step?`, requiresApproval: false };
  }

  if (replied && replyClassification === "ask_info") {
    return { actionType: "generate_response", priority: "high", reason: "Prospect asking for more info — respond promptly", estimatedValue, recommendedPrompt: `Generate a response to ${name} who is asking for more information. Their reply: "${replyText ?? "no text"}"`, requiresApproval: false };
  }

  if (replied && replyClassification === "wrong_contact") {
    return { actionType: "mark_do_not_contact", priority: "medium", reason: "Wrong contact — update or remove", estimatedValue: 0, recommendedPrompt: `${name} replied that this is the wrong contact. Update contact info or mark as do not contact.`, requiresApproval: true };
  }

  if (deal && !["won", "lost"].includes(deal.status)) {
    const daysSince = deal.lastActivityAt ? Math.floor((Date.now() - new Date(deal.lastActivityAt).getTime()) / 86400000) : 99;
    if (daysSince >= 7) {
      return { actionType: "generate_response", priority: "high", reason: `Deal stale ${daysSince} days — re-engage`, estimatedValue, recommendedPrompt: `The deal with ${name} has been inactive for ${daysSince} days. What should I send to re-engage and advance to the next stage?`, requiresApproval: false };
    }
    return { actionType: "schedule_call", priority: "medium", reason: `Active deal — advance stage (${deal.status})`, estimatedValue, recommendedPrompt: `What is the best next step to advance the deal with ${name}? Current stage: ${deal.status}.`, requiresApproval: false };
  }

  if ((opened || clicked) && !replied && !cooldownActive) {
    return { actionType: "send_follow_up", priority: "medium", reason: `Engaged${clicked ? " and clicked" : " — opened"} but no reply — follow up`, estimatedValue, recommendedPrompt: `${name} opened${clicked ? " and clicked" : ""} the email but hasn't replied. Suggest a compelling follow-up message.`, requiresApproval: false };
  }

  if (totalSent === 0 && prospect.contactEmail) {
    return { actionType: "generate_draft", priority: scores.fit >= 60 ? "medium" : "low", reason: "No outreach sent yet — generate initial email", estimatedValue, recommendedPrompt: `Generate an initial outreach email for ${name} (${prospect.sport ?? "sport unknown"}) in ${prospect.city ?? "unknown city"}.`, requiresApproval: false };
  }

  if (totalSent >= 3 && !replied && !opened) {
    return { actionType: "wait", priority: "low", reason: `Full sequence sent (${totalSent} emails) with no engagement`, estimatedValue: 0, recommendedPrompt: `${name} received ${totalSent} emails with no response. Consider marking cold or pausing outreach.`, requiresApproval: false };
  }

  if (cooldownActive) {
    const nextDate = safety.nextEligibleDate ? new Date(safety.nextEligibleDate).toLocaleDateString() : "soon";
    return { actionType: "wait", priority: "low", reason: `In cooldown — eligible again ${nextDate}`, estimatedValue, recommendedPrompt: `Waiting for cooldown period to expire before contacting ${name}.`, requiresApproval: false };
  }

  if (scores.risk >= 60) {
    return { actionType: "wait", priority: "low", reason: "High risk — review before contacting", estimatedValue, recommendedPrompt: `Review ${name}'s contact history before sending more outreach.`, requiresApproval: true };
  }

  const daysSinceLast = lastDraftSentAt ? Math.floor((Date.now() - lastDraftSentAt.getTime()) / 86400000) : null;
  return { actionType: "send_follow_up", priority: "low", reason: "Eligible for follow-up", estimatedValue, recommendedPrompt: `Follow up with ${name} about team training.${daysSinceLast != null ? ` Last email was ${daysSinceLast} days ago.` : ""}`, requiresApproval: false };
}

export async function getIntelligenceOverview(orgId: string): Promise<{
  warmestProspect: any | null;
  highestValueOpportunity: any | null;
  mostUrgentFollowUp: any | null;
  pipelineRisk: any | null;
  nextBestActions: any[];
}> {
  const prospects = await storage.getTeamTrainingProspects(orgId);
  const limited = prospects.slice(0, 60);

  const ctxs = await Promise.all(limited.map(p => buildProspectContext(p.id, orgId).catch(() => null)));
  const valid = ctxs.filter(Boolean) as ProspectContext[];
  const safe = valid.filter(c => !c.safety.isDNC && !c.safety.isOptedOut && c.intelligence.scores.risk < 100);

  const byWarmth = [...safe].sort((a, b) => b.intelligence.scores.warmth - a.intelligence.scores.warmth);
  const byUrgency = [...safe].sort((a, b) => b.intelligence.scores.urgency - a.intelligence.scores.urgency);
  const byValue = [...safe].filter(c => (c.prospect.estimatedValue ?? 0) > 0)
    .sort((a, b) => (b.prospect.estimatedValue ?? 0) - (a.prospect.estimatedValue ?? 0));
  const byRisk = [...valid].filter(c => c.intelligence.scores.risk >= 30 && !c.safety.isDNC)
    .sort((a, b) => b.intelligence.scores.risk - a.intelligence.scores.risk);

  const priorityOrder: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };

  const nextBestActions = [...safe]
    .filter(c => {
      const p = c.intelligence.nextBestAction.priority;
      return p === "urgent" || p === "high" || (p === "medium" && c.intelligence.scores.warmth >= 50);
    })
    .sort((a, b) => (priorityOrder[b.intelligence.nextBestAction.priority] ?? 0) - (priorityOrder[a.intelligence.nextBestAction.priority] ?? 0))
    .slice(0, 6)
    .map(c => ({
      prospectId: c.prospect.id,
      prospectName: c.prospect.prospectName,
      sport: c.prospect.sport,
      estimatedValue: c.prospect.estimatedValue ?? 0,
      scores: c.intelligence.scores,
      nextBestAction: c.intelligence.nextBestAction,
    }));

  const toCard = (c: ProspectContext) => ({
    prospectId: c.prospect.id,
    prospectName: c.prospect.prospectName,
    sport: c.prospect.sport,
    city: c.prospect.city,
    estimatedValue: c.prospect.estimatedValue ?? 0,
    scores: c.intelligence.scores,
    nextBestAction: c.intelligence.nextBestAction,
    engagement: c.engagement,
  });

  return {
    warmestProspect: byWarmth[0] ? toCard(byWarmth[0]) : null,
    highestValueOpportunity: byValue[0] ? toCard(byValue[0]) : null,
    mostUrgentFollowUp: byUrgency[0] ? toCard(byUrgency[0]) : null,
    pipelineRisk: byRisk[0] ? {
      prospectId: byRisk[0].prospect.id,
      prospectName: byRisk[0].prospect.prospectName,
      sport: byRisk[0].prospect.sport,
      riskScore: byRisk[0].intelligence.scores.risk,
      reason: byRisk[0].intelligence.nextBestAction.reason,
      isDNC: byRisk[0].safety.isDNC,
    } : null,
    nextBestActions,
  };
}

export function getDealIntelligence(deal: any, prospect: any): {
  health: "excellent" | "good" | "at_risk" | "stale" | "critical";
  insight: string;
  suggestedCloseMove: string;
  staleDays: number;
  urgency: "low" | "medium" | "high" | "urgent";
} {
  const daysSince = deal.lastActivityAt
    ? Math.floor((Date.now() - new Date(deal.lastActivityAt).getTime()) / 86400000)
    : 99;

  const statusInsights: Record<string, { insight: string; move: string }> = {
    interested: { insight: "High intent — create proposal or schedule call", move: "Send a training proposal or book a call this week" },
    call_scheduled: { insight: "Call scheduled — prepare your pitch", move: "Review their org profile and prepare a custom program outline" },
    proposal_sent: { insight: "Proposal pending response", move: `Follow up on the proposal${daysSince >= 3 ? " — it has been " + daysSince + " days" : ""}` },
    negotiating: { insight: "In negotiation — close the deal", move: "Address any objections and ask for a commitment" },
    new: { insight: "New deal — take action", move: "Reach out to start the conversation" },
    won: { insight: "Won — onboard the team", move: "Schedule the kickoff session" },
    lost: { insight: "Lost — review what happened", move: "Note the reason and decide whether to re-engage later" },
  };

  const base = statusInsights[deal.status] ?? { insight: "Active deal", move: "Follow up and advance to next stage" };

  let health: "excellent" | "good" | "at_risk" | "stale" | "critical" = "good";
  let urgency: "low" | "medium" | "high" | "urgent" = "medium";

  if (["won", "lost"].includes(deal.status)) {
    health = deal.status === "won" ? "excellent" : "at_risk";
    urgency = "low";
  } else if (daysSince >= 14) {
    health = "critical";
    urgency = "urgent";
  } else if (daysSince >= 7) {
    health = "stale";
    urgency = "high";
  } else if (deal.status === "interested" || deal.status === "call_scheduled") {
    health = "excellent";
    urgency = deal.probability >= 70 ? "urgent" : "high";
  } else if (deal.probability >= 50) {
    health = "good";
    urgency = "medium";
  }

  const insightText = daysSince >= 7 && !["won", "lost"].includes(deal.status)
    ? `Stale ${daysSince} days — ${base.insight}`
    : base.insight;

  return { health, insight: insightText, suggestedCloseMove: base.move, staleDays: daysSince, urgency };
}
