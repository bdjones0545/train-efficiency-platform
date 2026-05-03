import type { ReplyClassification } from "./contextual-intelligence";

export type ConversationStage =
  | "cold"
  | "contacted"
  | "engaged"
  | "interested"
  | "deal_open"
  | "proposal"
  | "won"
  | "lost"
  | "do_not_contact";

export interface StageInfo {
  stage: ConversationStage;
  label: string;
  badgeClass: string;
  description: string;
}

export function computeConversationStage(params: {
  prospect: { outreachStatus?: string | null };
  totalSent: number;
  openCount: number;
  clicked: boolean;
  replied: boolean;
  replyClassification: ReplyClassification | null;
  deal: { status: string } | null;
}): ConversationStage {
  const { prospect, totalSent, openCount, clicked, replied, replyClassification, deal } = params;
  const outreachStatus = prospect.outreachStatus ?? "New";

  if (outreachStatus === "Do Not Contact") return "do_not_contact";

  if (deal) {
    if (deal.status === "won") return "won";
    if (deal.status === "lost") return "lost";
    if (deal.status === "proposal_sent" || deal.status === "negotiating") return "proposal";
    return "deal_open";
  }

  if (replied) {
    if (replyClassification === "interested" || replyClassification === "ask_info") return "interested";
    if (replyClassification === "not_interested") return "lost";
    if (replyClassification === "wrong_contact") return "do_not_contact";
    if (replyClassification === "referral") return "engaged";
    return "engaged";
  }

  if (totalSent > 0) {
    if (openCount >= 2 || clicked) return "engaged";
    if (openCount >= 1) return "contacted";
    return "contacted";
  }

  return "cold";
}

export function getStageInfo(stage: ConversationStage): StageInfo {
  const stageMap: Record<ConversationStage, StageInfo> = {
    cold: {
      stage: "cold",
      label: "Cold",
      badgeClass: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
      description: "No outreach sent yet",
    },
    contacted: {
      stage: "contacted",
      label: "Contacted",
      badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
      description: "Initial email sent, no engagement yet",
    },
    engaged: {
      stage: "engaged",
      label: "Engaged",
      badgeClass: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
      description: "Prospect opened or clicked — showing interest",
    },
    interested: {
      stage: "interested",
      label: "Interested",
      badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      description: "Prospect replied with interest or requested info",
    },
    deal_open: {
      stage: "deal_open",
      label: "Deal Open",
      badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
      description: "Active deal in pipeline",
    },
    proposal: {
      stage: "proposal",
      label: "Proposal",
      badgeClass: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
      description: "Proposal sent — awaiting decision",
    },
    won: {
      stage: "won",
      label: "Won",
      badgeClass: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
      description: "Deal closed — revenue attributed",
    },
    lost: {
      stage: "lost",
      label: "Lost",
      badgeClass: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
      description: "Not interested or deal lost",
    },
    do_not_contact: {
      stage: "do_not_contact",
      label: "Do Not Contact",
      badgeClass: "bg-red-200 text-red-700 dark:bg-red-900/50 dark:text-red-300",
      description: "Outreach blocked — DNC status",
    },
  };

  return stageMap[stage];
}

export function getStageSendingBlocked(stage: ConversationStage): boolean {
  return stage === "do_not_contact" || stage === "lost" || stage === "won";
}

export function getStageMessageingGuidance(stage: ConversationStage): string {
  switch (stage) {
    case "cold":
      return "Use a short local intro with a low-pressure CTA. Reference their sport and location.";
    case "contacted":
      return "Send a simple, friendly bump. Keep it brief — one paragraph, one ask.";
    case "engaged":
      return "Reference their prior engagement. Acknowledge they opened or showed interest. Offer something specific.";
    case "interested":
      return "Move toward a call or simple proposal. Be direct — they want to hear more.";
    case "deal_open":
      return "All messaging must be deal-aware. Never use cold language. Reference the open deal directly.";
    case "proposal":
      return "Ask for a decision or next step. Create gentle urgency. Reference what was proposed.";
    case "won":
      return "Do not send prospecting messages. Focus on onboarding and retention.";
    case "lost":
      return "Do not contact. Revisit in 6-12 months with a fresh approach if appropriate.";
    case "do_not_contact":
      return "Outreach is blocked. This prospect must not receive any emails.";
  }
}
