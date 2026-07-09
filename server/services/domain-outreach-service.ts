/**
 * Domain Outreach Service
 * Unified AI draft generator for all non-athlete business communication domains.
 * Every generated draft flows into gmail_agent_actions → AI Comms Center → learning loop.
 */

import { db } from "../db";
import { gmailAgentActions } from "@shared/schema";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Domain Configs ────────────────────────────────────────────────────────────

interface MessageTypeConfig {
  goal: string;
  tone: string;
}

interface DomainConfig {
  label: string;
  agentName: string;
  systemPrompt: string;
  messageTypes: Record<string, MessageTypeConfig>;
  riskLevel: "low" | "medium" | "high";
}

const DOMAIN_CONFIGS: Record<string, DomainConfig> = {
  athletic_director: {
    label: "Athletic Director",
    agentName: "athletic_director_outreach_agent",
    riskLevel: "low",
    systemPrompt: `You are a professional outreach specialist for a strength and conditioning business. Write concise, outcome-driven emails to athletic directors at high schools and athletic departments. Use school/athletic language. Respect their busy schedule. Focus on measurable student-athlete performance outcomes. Never use hype or vague claims. Maximum 150 words.`,
    messageTypes: {
      initial_outreach: { goal: "Introduce services and open a conversation", tone: "professional, respectful" },
      followup_7d: { goal: "7-day follow-up with no prior response — brief, non-pushy", tone: "warm, persistent" },
      meeting_request: { goal: "Direct request for a 20-minute discovery call", tone: "direct, value-focused" },
      proposal_followup: { goal: "Follow up after sending a partnership proposal", tone: "confident, helpful" },
      relationship_nurture: { goal: "Maintain relationship without a direct ask", tone: "collegial, informative" },
    },
  },

  school_partnership: {
    label: "School Partnership",
    agentName: "school_partnership_outreach_agent",
    riskLevel: "low",
    systemPrompt: `You are an outreach specialist for a strength and conditioning business targeting school partnerships. Write professional emails to school administrators, principals, and athletic coordinators. Emphasize student athlete development, safety, and program credibility. Keep emails under 175 words with a clear single CTA.`,
    messageTypes: {
      introduction: { goal: "First-touch introduction to start a partnership conversation", tone: "professional, educational" },
      strength_program_offer: { goal: "Offer an in-school or after-school strength program", tone: "solutions-focused" },
      summer_program_offer: { goal: "Pitch summer athletic training program for student-athletes", tone: "energetic, outcome-focused" },
      performance_services: { goal: "Offer performance coaching and sports science services", tone: "expert, credible" },
      followup: { goal: "Follow up on a previous outreach with no response", tone: "polite, brief" },
    },
  },

  coach_outreach: {
    label: "Coach Outreach",
    agentName: "coach_outreach_agent",
    riskLevel: "low",
    systemPrompt: `You are an outreach specialist for a strength and conditioning business. Write professional emails to sports coaches (head coaches, assistant coaches, youth coaches) about training partnerships. Speak their language — wins, athlete development, competitive edge. Keep emails under 150 words with a clear next step.`,
    messageTypes: {
      introduction: { goal: "Introduce S&C services to a coaching staff", tone: "peer-to-peer, sports-focused" },
      program_collaboration: { goal: "Propose joint programming between coach and S&C facility", tone: "collaborative, practical" },
      athlete_referral: { goal: "Ask coach to refer athletes to training programs", tone: "relationship-building" },
      followup: { goal: "Follow up with no prior response", tone: "casual, persistent" },
      relationship_nurture: { goal: "Maintain the coaching relationship with no direct ask", tone: "supportive, collegial" },
    },
  },

  organization_outreach: {
    label: "Organization Outreach",
    agentName: "organization_outreach_agent",
    riskLevel: "low",
    systemPrompt: `You are an outreach specialist for a strength and conditioning business. Write emails targeting sports organizations, clubs, travel teams, and recreation departments. Position the business as a performance partner. Emphasize athlete development, team results, and partnership value. Keep under 175 words with a clear meeting CTA.`,
    messageTypes: {
      introduction: { goal: "First-touch introduction to an organization or club", tone: "professional, partnership-oriented" },
      partnership: { goal: "Propose a formal partnership arrangement", tone: "business-focused, clear ROI" },
      program_offer: { goal: "Offer a specific training program package to the organization", tone: "value-led, practical" },
      followup: { goal: "Follow up after initial outreach", tone: "brief, non-pushy" },
    },
  },

  business_outreach: {
    label: "Business Outreach",
    agentName: "business_outreach_agent",
    riskLevel: "low",
    systemPrompt: `You are a business development specialist for a strength and conditioning business. Write professional outreach to local businesses and potential sponsors or strategic partners. Focus on community connection, brand alignment, and mutual benefit. Keep under 175 words with a specific ask.`,
    messageTypes: {
      introduction: { goal: "Introduce the business and open a relationship", tone: "community-focused, professional" },
      partnership: { goal: "Propose a strategic partnership or cross-promotion", tone: "business-oriented, mutual benefit" },
      sponsorship: { goal: "Pitch a sponsorship opportunity", tone: "value-led, clear benefits" },
      followup: { goal: "Follow up on prior outreach", tone: "polite, direct" },
    },
  },

  employment_opportunity: {
    label: "Employment",
    agentName: "employment_outreach_agent",
    riskLevel: "low",
    systemPrompt: `You are an HR/recruitment specialist for a strength and conditioning business. Write professional, warm emails to coaching applicants and performance staff candidates. Be clear about role expectations and next steps. Respect the applicant's time. Keep under 150 words per email.`,
    messageTypes: {
      application_received: { goal: "Confirm receipt of application and set expectations", tone: "welcoming, professional" },
      interview_request: { goal: "Request a phone or in-person interview", tone: "enthusiastic, clear logistics" },
      followup: { goal: "Follow up with an applicant who hasn't responded", tone: "friendly, brief" },
      offer: { goal: "Extend a job offer", tone: "warm, congratulatory, professional" },
      onboarding: { goal: "Welcome a newly hired coach or staff member", tone: "warm, encouraging, practical" },
    },
  },

  corporate_wellness: {
    label: "Corporate Wellness",
    agentName: "corporate_wellness_outreach_agent",
    riskLevel: "low",
    systemPrompt: `You are a corporate sales specialist for a strength and conditioning business offering workplace wellness programs. Write professional outreach to HR departments, office managers, and business owners. Lead with ROI — reduced absenteeism, improved employee performance, team morale. Keep under 175 words with a clear demo/call CTA.`,
    messageTypes: {
      introduction: { goal: "First-touch to HR or wellness decision-maker", tone: "professional, ROI-focused" },
      wellness_program_offer: { goal: "Pitch a corporate wellness or group training package", tone: "business case, measurable outcomes" },
      demo_request: { goal: "Ask for a brief product/program demo call", tone: "low-commitment, clear value" },
      followup: { goal: "Follow up with no prior response", tone: "polite, concise" },
    },
  },

  facility_partnership: {
    label: "Facility Partnership",
    agentName: "facility_partnership_outreach_agent",
    riskLevel: "low",
    systemPrompt: `You are a business development specialist for a strength and conditioning business seeking facility partnerships. Write professional emails to gym owners, sports complex operators, and facility managers about rental or shared-services arrangements. Be direct about logistics and mutual benefit. Keep under 150 words.`,
    messageTypes: {
      introduction: { goal: "Introduce the business and propose a conversation about facility use", tone: "professional, direct" },
      rental_partnership: { goal: "Propose renting space within their facility", tone: "business-focused, clear terms" },
      shared_services: { goal: "Propose a shared client base or referral partnership", tone: "collaborative, mutually beneficial" },
      followup: { goal: "Follow up after no response", tone: "brief, non-pushy" },
    },
  },

  gym_owner: {
    label: "Gym Owner",
    agentName: "gym_owner_outreach_agent",
    riskLevel: "low",
    systemPrompt: `You are a business development specialist for a strength and conditioning business. Write outreach to independent gym owners about training partnerships, sub-leasing, or referral arrangements. Be peer-to-peer in tone — gym owner to gym owner. Focus on win-win arrangements. Keep under 150 words.`,
    messageTypes: {
      introduction: { goal: "Open a conversation with a gym owner about partnership potential", tone: "peer-to-peer, warm" },
      partnership: { goal: "Propose a formal partnership or referral arrangement", tone: "collaborative, practical" },
      program_offer: { goal: "Offer specialized programming to run inside their gym", tone: "value-led, specific" },
      followup: { goal: "Follow up with no prior response", tone: "casual, brief" },
    },
  },
};

// ─── Context Builder ───────────────────────────────────────────────────────────

function buildContextBlock(domain: string, context: DraftContext): string {
  const lines: string[] = [];

  if (context.orgName) lines.push(`Sender organization: ${context.orgName}`);
  if (context.contactName) lines.push(`Recipient: ${context.contactName}${context.contactRole ? ` (${context.contactRole})` : ""}`);
  if (context.organizationName) lines.push(`Their organization: ${context.organizationName}`);
  if (context.sport) lines.push(`Sport/Activity: ${context.sport}`);
  if (context.city || context.state) lines.push(`Location: ${[context.city, context.state].filter(Boolean).join(", ")}`);
  if (context.school) lines.push(`School: ${context.school}`);
  if (context.district) lines.push(`District: ${context.district}`);
  if (context.enrollmentSize) lines.push(`Enrollment: ${context.enrollmentSize}`);
  if (context.employeeCount) lines.push(`Employee count: ${context.employeeCount}`);
  if (context.previousContact) lines.push(`Previous contact history: ${context.previousContact}`);
  if (context.notes) lines.push(`Additional context: ${context.notes}`);
  if (context.estimatedValue) lines.push(`Estimated deal value: $${context.estimatedValue.toLocaleString()}`);

  return lines.join("\n");
}

// ─── Main Generator ────────────────────────────────────────────────────────────

export interface DraftContext {
  contactName?: string;
  contactRole?: string;
  organizationName?: string;
  sport?: string;
  city?: string;
  state?: string;
  school?: string;
  district?: string;
  enrollmentSize?: string;
  employeeCount?: string;
  previousContact?: string;
  notes?: string;
  orgName?: string;
  estimatedValue?: number;
}

export interface GenerateDomainDraftOpts {
  orgId: string;
  domain: string;
  messageType: string;
  context: DraftContext;
  recipientEmail?: string;
  prospectId?: string;
  dealId?: string;
}

export interface DomainDraftResult {
  subject: string;
  body: string;
  actionId: string;
  domain: string;
  messageType: string;
}

export async function generateDomainDraft(opts: GenerateDomainDraftOpts): Promise<DomainDraftResult> {
  const { orgId, domain, messageType, context, recipientEmail, prospectId, dealId } = opts;

  const config = DOMAIN_CONFIGS[domain];
  if (!config) throw new Error(`Unknown domain: ${domain}`);

  const mtConfig = config.messageTypes[messageType];
  if (!mtConfig) throw new Error(`Unknown messageType "${messageType}" for domain "${domain}"`);

  // Get domain-aware learning context with rule tracking
  const { getMessageLearningContextWithRules } = await import("./message-learning-service");
  const { contextText: learningCtx, rules: _appliedRules } = await getMessageLearningContextWithRules(orgId, messageType, { domain });

  let priorContactBlock = "";
  if (recipientEmail) {
    try {
      const { getPriorContactContext } = await import("./agentmail-prior-contact-context-service");
      const priorCtx = await getPriorContactContext({ orgId, recipientEmail, communicationDomain: domain });
      if (priorCtx.hasPriorContact && priorCtx.promptBlock) {
        priorContactBlock = `\n${priorCtx.promptBlock}\n`;
      }
    } catch {}
  }

  const contextBlock = buildContextBlock(domain, context);

  const userPrompt = `${contextBlock ? contextBlock + "\n\n" : ""}Message type: ${messageType}
Goal: ${mtConfig.goal}
Tone: ${mtConfig.tone}
${learningCtx ? "\n" + learningCtx + "\n" : ""}${priorContactBlock}
Write the best possible outreach email for this situation. Return ONLY valid JSON: { "subject": "...", "body": "..." }`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.65,
    max_tokens: 600,
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(resp.choices[0].message.content ?? "{}");
  const subject: string = parsed.subject ?? `${config.label} Outreach`;
  const body: string = parsed.body ?? "";

  // Queue in gmail_agent_actions so it appears in AI Comms Center
  const [action] = await db.insert(gmailAgentActions).values({
    orgId,
    actionType: `propose_draft:${messageType}`,
    recipientEmail: recipientEmail ?? null,
    subject,
    bodyPreview: body.slice(0, 500),
    dealId: dealId ?? null,
    riskLevel: config.riskLevel,
    approvalRequired: true,
    status: "proposed",
    createdByAgent: config.agentName,
    communicationDomain: domain,
    result: {
      fullBody: body,
      prospectId: prospectId ?? null,
      domain,
      messageType,
      contextUsed: contextBlock,
      learningApplied: learningCtx.length > 0,
    } as any,
  } as any).returning();

  // Record which rules were applied — non-blocking, fail-open
  if (_appliedRules.length > 0) {
    import("./agentmail-analytics-service").then(({ recordAgentMailRuleApplications }) =>
      recordAgentMailRuleApplications({ orgId, actionId: action.id, communicationDomain: domain, rules: _appliedRules })
    ).catch(() => {});
  }

  return { subject, body, actionId: action.id, domain, messageType };
}

// ─── List available message types for a domain ────────────────────────────────

export function getDomainMessageTypes(domain: string): Array<{ value: string; label: string; goal: string }> {
  const config = DOMAIN_CONFIGS[domain];
  if (!config) return [];
  return Object.entries(config.messageTypes).map(([value, mt]) => ({
    value,
    label: value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    goal: mt.goal,
  }));
}

export function getSupportedDomains(): Array<{ value: string; label: string }> {
  return Object.entries(DOMAIN_CONFIGS).map(([value, cfg]) => ({
    value,
    label: cfg.label,
  }));
}

// ─── Domain inference from teamTrainingProspects.organizationType ─────────────

export function inferDomainFromOrganizationType(orgType: string): string {
  const t = (orgType ?? "").toLowerCase();
  if (t.includes("school") || t.includes("high school") || t.includes("hs") || t.includes("district")) return "school_partnership";
  if (t.includes("athletic director") || t.includes("ad ")) return "athletic_director";
  if (t.includes("gym")) return "gym_owner";
  if (t.includes("facility") || t.includes("complex") || t.includes("training center")) return "facility_partnership";
  if (t.includes("corporate") || t.includes("wellness") || t.includes("hr ") || t.includes("employer")) return "corporate_wellness";
  if (t.includes("club") || t.includes("travel") || t.includes("league") || t.includes("recreation") || t.includes("organization")) return "organization_outreach";
  if (t.includes("business") || t.includes("sponsor") || t.includes("partner")) return "business_outreach";
  return "organization_outreach";
}
