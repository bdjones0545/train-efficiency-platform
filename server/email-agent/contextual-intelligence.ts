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

export interface DecisionExplanation {
  decision_reason: string;
  supporting_signals: string[];
  risk_flags: string[];
  confidence_level: "low" | "medium" | "high";
  expected_outcome: string;
  alternative_action: string;
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
  explanation: DecisionExplanation;
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
  const { totalSent, opened, openCount, clicked, replied, replyClassification, replyText, lastDraftSentAt } = engagement;
  const { isDNC, cooldownActive } = safety;
  const estimatedValue = prospect.estimatedValue ?? 0;
  const name = prospect.prospectName ?? "This prospect";
  const valueStr = estimatedValue > 0 ? `$${estimatedValue.toLocaleString()}` : "no estimated value";

  // ── DNC ──────────────────────────────────────────────────────────────────
  if (isDNC) {
    return {
      actionType: "stop_sequence", priority: "low",
      reason: "Marked as Do Not Contact",
      estimatedValue: 0,
      recommendedPrompt: `${name} is marked Do Not Contact. No further outreach.`,
      requiresApproval: false,
      explanation: {
        decision_reason: "This prospect has been marked Do Not Contact. Reaching out would violate their preference and could create legal or reputational risk.",
        supporting_signals: ["Status: Do Not Contact"],
        risk_flags: [
          "Contacting a DNC prospect may violate anti-spam regulations",
          "Could damage your organization's reputation",
        ],
        confidence_level: "high",
        expected_outcome: "No outreach is sent. Prospect remains on your records for reference.",
        alternative_action: "If this was marked in error, manually update their status in the Prospects tab before any outreach.",
      },
    };
  }

  // ── Not Interested Reply ─────────────────────────────────────────────────
  if (replyClassification === "not_interested") {
    return {
      actionType: "stop_sequence", priority: "low",
      reason: "Prospect replied not interested",
      estimatedValue: 0,
      recommendedPrompt: `${name} replied indicating no interest. Consider removing from outreach.`,
      requiresApproval: false,
      explanation: {
        decision_reason: "The prospect replied and explicitly indicated they are not interested. Continuing outreach would be disrespectful and counterproductive.",
        supporting_signals: [
          "Received a reply classified as: Not Interested",
          totalSent > 1 ? `${totalSent} emails were sent before this reply` : "Reply received after initial outreach",
        ],
        risk_flags: [
          "Continued outreach after a 'not interested' reply may result in a spam complaint",
          "Could damage your reputation with this organization",
        ],
        confidence_level: "high",
        expected_outcome: "Prospect is removed from active outreach. Relationship preserved for the future.",
        alternative_action: "Mark them as 'Do Not Contact' or add a note. You can revisit in 6–12 months if circumstances change.",
      },
    };
  }

  // ── Interested + No Deal ──────────────────────────────────────────────────
  if (replied && replyClassification === "interested" && !deal) {
    return {
      actionType: "create_deal", priority: "urgent",
      reason: "Interested reply with no deal — create deal now",
      estimatedValue,
      recommendedPrompt: `Create a deal for ${name} who replied interested. Estimated value: ${valueStr}. Move them into the Deal Pipeline immediately.`,
      requiresApproval: false,
      explanation: {
        decision_reason: "This prospect replied with genuine interest, but no deal has been created yet. Every day without a deal means lost momentum and revenue.",
        supporting_signals: [
          "Replied to outreach — classified as: Interested",
          estimatedValue > 0 ? `Estimated contract value: ${valueStr}` : "No estimated value set — consider adding one",
          opened ? `Email was opened${openCount >= 2 ? ` ${openCount} times` : ""}` : "",
          clicked ? "Clicked a link in the email" : "",
        ].filter(Boolean) as string[],
        risk_flags: [
          "No deal created yet — opportunity may slip without follow-up",
          "Delay increases chance prospect loses interest or chooses a competitor",
        ],
        confidence_level: "high",
        expected_outcome: "Creating a deal now captures the opportunity and enables structured follow-up through your pipeline.",
        alternative_action: "If you are not ready to pitch yet, send a response first to acknowledge their interest and buy time to prepare.",
      },
    };
  }

  // ── Interested + Has Deal ─────────────────────────────────────────────────
  if (replied && replyClassification === "interested" && deal) {
    const dealDays = deal.lastActivityAt
      ? Math.floor((Date.now() - new Date(deal.lastActivityAt).getTime()) / 86400000)
      : null;
    return {
      actionType: "schedule_call", priority: "urgent",
      reason: "Interested prospect with active deal — schedule call",
      estimatedValue,
      recommendedPrompt: `${name} is interested and has an active deal. What should I say to schedule a discovery call or close the next step?`,
      requiresApproval: false,
      explanation: {
        decision_reason: "The prospect is interested and a deal is already open in your pipeline. The best next move is to book a call while their intent is high.",
        supporting_signals: [
          "Replied with interest",
          `Active deal exists — stage: ${deal.status}`,
          estimatedValue > 0 ? `Deal value: ${valueStr}` : "",
          dealDays !== null ? `Last deal activity: ${dealDays} day${dealDays !== 1 ? "s" : ""} ago` : "",
        ].filter(Boolean) as string[],
        risk_flags: [
          dealDays !== null && dealDays >= 5 ? `Deal has been inactive for ${dealDays} days — act before interest fades` : "",
        ].filter(Boolean) as string[],
        confidence_level: "high",
        expected_outcome: "A call moves the deal to the next stage and opens the door to a proposal or close.",
        alternative_action: "If a call is too early, send a proposal or program outline to continue building interest before the call.",
      },
    };
  }

  // ── Asking for Info ───────────────────────────────────────────────────────
  if (replied && replyClassification === "ask_info") {
    return {
      actionType: "generate_response", priority: "high",
      reason: "Prospect asking for more info — respond promptly",
      estimatedValue,
      recommendedPrompt: `Generate a response to ${name} who is asking for more information. Their reply: "${replyText ?? "no text"}"`,
      requiresApproval: false,
      explanation: {
        decision_reason: "The prospect replied asking for more information. This is a positive signal — they are engaged and considering your offer. A fast, helpful reply is critical.",
        supporting_signals: [
          "Replied asking for information — high engagement signal",
          replyText ? `Their message: "${replyText.slice(0, 100)}${replyText.length > 100 ? "…" : ""}"` : "Reply text recorded",
          estimatedValue > 0 ? `Potential value: ${valueStr}` : "",
        ].filter(Boolean) as string[],
        risk_flags: [
          "Slow response may cause the prospect to lose interest or contact a competitor",
        ],
        confidence_level: "high",
        expected_outcome: "A clear, prompt answer builds trust and moves the prospect toward a proposal or call.",
        alternative_action: "If you need more time to prepare a full answer, send a brief acknowledgment first to keep the conversation warm.",
      },
    };
  }

  // ── Wrong Contact ─────────────────────────────────────────────────────────
  if (replied && replyClassification === "wrong_contact") {
    return {
      actionType: "mark_do_not_contact", priority: "medium",
      reason: "Wrong contact — update or remove",
      estimatedValue: 0,
      recommendedPrompt: `${name} replied that this is the wrong contact. Update contact info or mark as do not contact.`,
      requiresApproval: true,
      explanation: {
        decision_reason: "The recipient replied saying they are not the right person to contact. You need to either find the correct contact or remove this record.",
        supporting_signals: [
          "Received a reply classified as: Wrong Contact",
          `${totalSent} email${totalSent !== 1 ? "s" : ""} were sent to this contact`,
        ],
        risk_flags: [
          "Continuing to email the wrong person wastes time and may trigger a spam complaint",
          "Requires human review — cannot be automated safely",
        ],
        confidence_level: "high",
        expected_outcome: "Updating the contact info lets you re-engage with the right decision maker.",
        alternative_action: "Search the organization's website or LinkedIn to find the correct athletics director or decision maker.",
      },
    };
  }

  // ── Active (non-stale) or Stale Deal ─────────────────────────────────────
  if (deal && !["won", "lost"].includes(deal.status)) {
    const daysSince = deal.lastActivityAt
      ? Math.floor((Date.now() - new Date(deal.lastActivityAt).getTime()) / 86400000)
      : 99;
    if (daysSince >= 7) {
      return {
        actionType: "generate_response", priority: "high",
        reason: `Deal stale ${daysSince} days — re-engage`,
        estimatedValue,
        recommendedPrompt: `The deal with ${name} has been inactive for ${daysSince} days. What should I send to re-engage and advance to the next stage?`,
        requiresApproval: false,
        explanation: {
          decision_reason: `This deal has had no activity for ${daysSince} days. Deals that go quiet this long often die — a timely re-engagement message can revive them.`,
          supporting_signals: [
            `Deal stage: ${deal.status}`,
            `Last activity: ${daysSince} day${daysSince !== 1 ? "s" : ""} ago`,
            estimatedValue > 0 ? `Deal value at stake: ${valueStr}` : "",
            deal.probability > 0 ? `Close probability: ${deal.probability}%` : "",
          ].filter(Boolean) as string[],
          risk_flags: [
            `${daysSince >= 14 ? "Critical: " : ""}Deal inactive for ${daysSince} days — risk of losing to inaction`,
            "Prospect may have moved on or selected a competitor",
          ],
          confidence_level: daysSince >= 14 ? "high" : "medium",
          expected_outcome: "A re-engagement message reopens the conversation and gives the deal a chance to advance.",
          alternative_action: `If the prospect is unresponsive after re-engagement, update the deal stage to 'Lost' and note the reason for future reference.`,
        },
      };
    }
    return {
      actionType: "schedule_call", priority: "medium",
      reason: `Active deal — advance stage (${deal.status})`,
      estimatedValue,
      recommendedPrompt: `What is the best next step to advance the deal with ${name}? Current stage: ${deal.status}.`,
      requiresApproval: false,
      explanation: {
        decision_reason: `There is an active deal in the "${deal.status}" stage. The priority is to move it forward before momentum fades.`,
        supporting_signals: [
          `Deal stage: ${deal.status}`,
          deal.lastActivityAt ? `Last activity: ${Math.floor((Date.now() - new Date(deal.lastActivityAt).getTime()) / 86400000)} days ago` : "Activity date unknown",
          estimatedValue > 0 ? `Deal value: ${valueStr}` : "",
          deal.probability > 0 ? `Close probability: ${deal.probability}%` : "",
          deal.nextAction ? `Recorded next action: ${deal.nextAction}` : "",
        ].filter(Boolean) as string[],
        risk_flags: [],
        confidence_level: "medium",
        expected_outcome: "Advancing the stage brings you closer to a signed contract and onboarding.",
        alternative_action: "If no call is ready, send a short check-in email to maintain momentum and reconfirm interest.",
      },
    };
  }

  // ── Opened/Clicked, No Reply, Not in Cooldown ─────────────────────────────
  if ((opened || clicked) && !replied && !cooldownActive) {
    return {
      actionType: "send_follow_up", priority: "medium",
      reason: `Engaged${clicked ? " and clicked" : " — opened"} but no reply — follow up`,
      estimatedValue,
      recommendedPrompt: `${name} opened${clicked ? " and clicked" : ""} the email but hasn't replied. Suggest a compelling follow-up message.`,
      requiresApproval: false,
      explanation: {
        decision_reason: `${name} showed real interest by ${clicked ? "clicking a link and opening" : "opening"} your email, but has not replied. A timely follow-up can convert this engagement into a conversation.`,
        supporting_signals: [
          opened ? `Opened email${openCount >= 2 ? ` ${openCount} times` : ""}` : "",
          clicked ? "Clicked a link — strong interest signal" : "",
          `${totalSent} email${totalSent !== 1 ? "s" : ""} sent so far`,
          estimatedValue > 0 ? `Potential value: ${valueStr}` : "",
          scores.fit >= 60 ? `Fit score: ${scores.fit}/100 — strong match` : `Fit score: ${scores.fit}/100`,
        ].filter(Boolean) as string[],
        risk_flags: [
          "No reply yet — prospect may need a nudge or a different angle",
        ],
        confidence_level: "medium",
        expected_outcome: "A well-timed follow-up with a clear call-to-action often converts passive openers into replies.",
        alternative_action: "If multiple follow-ups get no reply, pause outreach and revisit in 30 days with a fresh angle.",
      },
    };
  }

  // ── No Outreach Yet ───────────────────────────────────────────────────────
  if (totalSent === 0 && prospect.contactEmail) {
    const priority = scores.fit >= 60 ? "medium" : "low";
    return {
      actionType: "generate_draft", priority,
      reason: "No outreach sent yet — generate initial email",
      estimatedValue,
      recommendedPrompt: `Generate an initial outreach email for ${name} (${prospect.sport ?? "sport unknown"}) in ${prospect.city ?? "unknown city"}.`,
      requiresApproval: false,
      explanation: {
        decision_reason: `No emails have been sent to ${name} yet. They have a valid email address and are ready for initial contact.`,
        supporting_signals: [
          "No emails sent yet — fresh prospect",
          prospect.contactEmail ? "Email address is on file" : "",
          prospect.sport && prospect.sport !== "unknown" ? `Sport: ${prospect.sport}` : "",
          prospect.city && prospect.city !== "unknown" ? `Location: ${prospect.city}${prospect.state ? `, ${prospect.state}` : ""}` : "",
          estimatedValue > 0 ? `Estimated value: ${valueStr}` : "",
          `Fit score: ${scores.fit}/100`,
        ].filter(Boolean) as string[],
        risk_flags: scores.fit < 40 ? ["Low fit score — consider prioritizing higher-fit prospects first"] : [],
        confidence_level: priority === "medium" ? "medium" : "low",
        expected_outcome: "Sending an initial email opens the relationship and may generate a reply or deal.",
        alternative_action: "If fit is low, focus on higher-fit prospects first and return to this one when your pipeline has capacity.",
      },
    };
  }

  // ── Full Sequence, No Engagement ──────────────────────────────────────────
  if (totalSent >= 3 && !replied && !opened) {
    return {
      actionType: "wait", priority: "low",
      reason: `Full sequence sent (${totalSent} emails) with no engagement`,
      estimatedValue: 0,
      recommendedPrompt: `${name} received ${totalSent} emails with no response. Consider marking cold or pausing outreach.`,
      requiresApproval: false,
      explanation: {
        decision_reason: `${totalSent} emails have been sent with zero opens or replies. This prospect is not engaging with your outreach — continuing would waste resources and risk being marked as spam.`,
        supporting_signals: [
          `${totalSent} emails sent`,
          "Zero opens recorded",
          "Zero replies received",
          estimatedValue > 0 ? `Potential value if converted: ${valueStr}` : "",
        ],
        risk_flags: [
          "High volume with no engagement increases spam risk",
          "May indicate incorrect email address or unresponsive contact",
        ],
        confidence_level: "high",
        expected_outcome: "Pausing outreach protects your sender reputation and frees up resources for warmer prospects.",
        alternative_action: "Verify the email address is correct. If confirmed, try a different channel (phone, LinkedIn) or park this prospect for 3–6 months.",
      },
    };
  }

  // ── Cooldown Active ───────────────────────────────────────────────────────
  if (cooldownActive) {
    const nextDate = safety.nextEligibleDate
      ? new Date(safety.nextEligibleDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "soon";
    const daysRemaining = safety.nextEligibleDate
      ? Math.ceil((new Date(safety.nextEligibleDate).getTime() - Date.now()) / 86400000)
      : null;
    return {
      actionType: "wait", priority: "low",
      reason: `In cooldown — eligible again ${nextDate}`,
      estimatedValue,
      recommendedPrompt: `Waiting for cooldown period to expire before contacting ${name}.`,
      requiresApproval: false,
      explanation: {
        decision_reason: `This prospect was recently contacted and is in a mandatory cooldown period. Reaching out again too soon can feel aggressive and reduce response rates.`,
        supporting_signals: [
          `Last contacted: ${prospect.lastContactedAt ? new Date(prospect.lastContactedAt).toLocaleDateString() : "recently"}`,
          daysRemaining !== null ? `Days until eligible: ${daysRemaining}` : "",
          `Eligible to contact again: ${nextDate}`,
          estimatedValue > 0 ? `Estimated value when eligible: ${valueStr}` : "",
        ].filter(Boolean) as string[],
        risk_flags: [
          "Contacting during cooldown reduces reply rate and may trigger opt-out",
        ],
        confidence_level: "high",
        expected_outcome: "Respecting the cooldown window increases the chance of a positive response when you do follow up.",
        alternative_action: "Use this time to prepare a stronger follow-up message or update their profile with any new information.",
      },
    };
  }

  // ── High Risk ─────────────────────────────────────────────────────────────
  if (scores.risk >= 60) {
    return {
      actionType: "wait", priority: "low",
      reason: "High risk — review before contacting",
      estimatedValue,
      recommendedPrompt: `Review ${name}'s contact history before sending more outreach.`,
      requiresApproval: true,
      explanation: {
        decision_reason: `This prospect has a high risk score (${scores.risk}/100), indicating multiple caution signals. Human review is required before any further outreach.`,
        supporting_signals: [
          `Risk score: ${scores.risk}/100`,
          totalSent >= 5 ? `${totalSent} emails already sent — high outreach volume` : "",
          !prospect.contactEmail ? "No email address on file" : "",
        ].filter(Boolean) as string[],
        risk_flags: [
          "Multiple risk signals detected — automated outreach paused",
          "Manual review required before proceeding",
        ],
        confidence_level: "medium",
        expected_outcome: "After review, you can decide to continue, update contact info, or remove from outreach.",
        alternative_action: "Check the contact details, verify the organization still exists, and consider whether a fresh approach or different channel is more appropriate.",
      },
    };
  }

  // ── Default Follow-Up ─────────────────────────────────────────────────────
  const daysSinceLast = lastDraftSentAt
    ? Math.floor((Date.now() - lastDraftSentAt.getTime()) / 86400000)
    : null;
  return {
    actionType: "send_follow_up", priority: "low",
    reason: "Eligible for follow-up",
    estimatedValue,
    recommendedPrompt: `Follow up with ${name} about team training.${daysSinceLast != null ? ` Last email was ${daysSinceLast} days ago.` : ""}`,
    requiresApproval: false,
    explanation: {
      decision_reason: `${name} is eligible for a follow-up — no blockers found, cooldown has passed, and outreach has been attempted.`,
      supporting_signals: [
        daysSinceLast !== null ? `Last email sent ${daysSinceLast} day${daysSinceLast !== 1 ? "s" : ""} ago` : "Previous emails sent",
        `${totalSent} email${totalSent !== 1 ? "s" : ""} sent total`,
        estimatedValue > 0 ? `Potential value: ${valueStr}` : "",
        `Fit score: ${scores.fit}/100`,
      ].filter(Boolean) as string[],
      risk_flags: totalSent >= 4 ? ["High email count — consider trying a different channel or message angle"] : [],
      confidence_level: "low",
      expected_outcome: "A well-crafted follow-up may re-engage the prospect or get a definitive answer.",
      alternative_action: "If previous emails had no opens, try updating the subject line or approach entirely before sending another message.",
    },
  };
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
      explanation: byRisk[0].intelligence.nextBestAction.explanation,
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
  explanation: DecisionExplanation;
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

  // Build explanation based on health + status
  const signals: string[] = [
    `Deal stage: ${deal.status}`,
    deal.lastActivityAt ? `Last activity: ${daysSince} day${daysSince !== 1 ? "s" : ""} ago` : "No activity recorded",
    (deal.estimatedValue ?? 0) > 0 ? `Deal value: $${(deal.estimatedValue ?? 0).toLocaleString()}` : "",
    deal.probability > 0 ? `Close probability: ${deal.probability}%` : "",
    deal.nextAction ? `Recorded next action: ${deal.nextAction}` : "",
    prospect?.sport && prospect.sport !== "unknown" ? `Sport: ${prospect.sport}` : "",
  ].filter(Boolean) as string[];

  const riskFlags: string[] = [];
  if (daysSince >= 14) riskFlags.push(`Critical: deal has been inactive for ${daysSince} days`);
  else if (daysSince >= 7) riskFlags.push(`Deal inactive for ${daysSince} days — risk of losing momentum`);
  if (deal.status === "proposal_sent" && daysSince >= 3) riskFlags.push(`Proposal has been pending for ${daysSince} days without a response`);
  if (deal.status === "lost") riskFlags.push("Deal was lost — review reason before considering re-engagement");

  let confidenceLevel: "low" | "medium" | "high" = "medium";
  if (health === "excellent" || health === "critical" || deal.status === "won" || deal.status === "lost") confidenceLevel = "high";
  else if (health === "at_risk") confidenceLevel = "low";

  let expectedOutcome = "Advancing this deal through the pipeline leads to a signed contract and team onboarding.";
  if (deal.status === "won") expectedOutcome = "Schedule the kickoff session to begin team training and deliver on your commitment.";
  if (deal.status === "lost") expectedOutcome = "Review the outcome to improve future deals. Consider re-engaging in 6 months.";
  if (health === "critical") expectedOutcome = "Re-engagement now may save the deal. Without action, it will likely be lost to inaction.";

  let alternativeAction = "If the primary action isn't possible right now, send a brief check-in message to maintain visibility.";
  if (deal.status === "proposal_sent") alternativeAction = "If you don't hear back after a follow-up, try calling or reaching out via a different channel.";
  if (deal.status === "interested") alternativeAction = "If you are not ready to propose yet, schedule a discovery call to better understand their needs first.";
  if (deal.status === "lost") alternativeAction = "If the reason was budget or timing, add a note to re-evaluate in 3–6 months.";
  if (health === "critical") alternativeAction = "If re-engagement fails, mark the deal as Lost and use the notes to improve your next approach with a similar prospect.";

  const explanation: DecisionExplanation = {
    decision_reason: daysSince >= 14
      ? `This deal has been completely inactive for ${daysSince} days. Without immediate action, it is almost certainly going to be lost.`
      : daysSince >= 7
        ? `The deal has been quiet for ${daysSince} days. A follow-up now can re-activate it before the prospect loses interest.`
        : deal.status === "won"
          ? "The deal is won. Focus shifts to delivering on your promise — schedule the kickoff session as soon as possible."
          : deal.status === "lost"
            ? "This deal did not close. A quick review of what happened will help you improve your next opportunity."
            : `The deal is in the "${deal.status}" stage. The recommended action will push it toward a close.`,
    supporting_signals: signals,
    risk_flags: riskFlags,
    confidence_level: confidenceLevel,
    expected_outcome: expectedOutcome,
    alternative_action: alternativeAction,
  };

  return { health, insight: insightText, suggestedCloseMove: base.move, staleDays: daysSince, urgency, explanation };
}
