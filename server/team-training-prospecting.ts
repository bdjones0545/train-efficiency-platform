import OpenAI from "openai";
import { storage } from "./storage";
import type { Organization } from "@shared/schema";

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("[Team Leads Research] Missing OPENAI_API_KEY at runtime");
    throw new Error("AI research is not configured");
  }
  return new OpenAI({ apiKey: key });
}

export type ContactQuality = "decision_maker" | "role_based" | "general" | "missing";

export interface ProspectResult {
  prospectName: string;
  organizationType: string;
  sport: string;
  city: string;
  state: string;
  websiteUrl: string | null;
  contactName: string;
  contactRole: string;
  contactEmail: string | null;
  contactPhone: string | null;
  sourceUrl: string | null;
  confidenceScore: number;
  notes: string;
  // Decision-maker contact fields
  decisionMakerName: string | null;
  decisionMakerTitle: string | null;
  decisionMakerEmail: string | null;
  contactConfidence: number;
  contactSourceUrl: string | null;
  contactQuality: ContactQuality;
}

export async function researchProspects(
  org: Organization,
  location: string,
  sportFilter?: string,
  limit: number = 10,
  radiusMiles: number = 25
): Promise<ProspectResult[]> {
  const openai = getOpenAI();

  const specialties = (org as any).specialties || "speed, strength, agility, performance training";

  const sportContext = sportFilter && sportFilter !== "all"
    ? `Prioritize ${sportFilter} organizations, but you may include closely related sports if needed to fill the list.`
    : `Cover a broad variety of sports including youth football, basketball, soccer, volleyball, baseball, lacrosse, wrestling, track & field, swim teams, cheer programs, martial arts gyms, and athletic departments.`;

  const systemPrompt = `You are a lead research assistant for a sports performance training business. Your job is to identify realistic, plausible local sports organizations near a specific location that would be good team training leads.

IMPORTANT RULES:
- The location provided by the user is mandatory — always center your research on that city and state.
- Find organizations within approximately ${radiusMiles} miles of ${location}.
- Never invent specific contact emails or phone numbers. Use null for unknown contact info.
- Use "unknown" for any field you cannot reliably determine.
- Only include websiteUrl if you have a real, known URL for this type of organization.
- Set sourceUrl to a plausible Google search URL so the admin can verify.
- Be honest about confidence. Score 80+ only if you have strong reason the org exists in that area.
- Generate diverse organization types: youth clubs, high school programs, club teams, AAU teams, travel ball, academies, private sports programs, athletic departments.
- Keep notes concise: explain why this prospect is a good fit for team training services.

DECISION-MAKER CONTACT RESEARCH:
For every lead, actively attempt to identify a decision-maker. Search for:
  - Owner, Director, Athletic Director, Head Coach, Program Director
  - Team Director, Operations Manager, Training Coordinator, General Manager

Contact quality priority (use the highest tier you can find):
  1. decision_maker — Named individual with a known direct email (e.g., john.smith@clubname.org)
  2. role_based — Role-based inbox clearly tied to team/program decisions (e.g., director@, coach@, athletics@, teams@, headcoach@)
  3. general — General organization email (e.g., info@, contact@, office@)
  4. missing — No email found at all

Set contactQuality to the tier achieved. Set contactConfidence 0-100 based on how certain you are about the contact.`;

  const userPrompt = `Find organizations within approximately ${radiusMiles} miles of ${location} that would be strong leads for team training services: ${specialties}. Research up to ${limit} organizations.

${sportContext}

Return a JSON array of prospects. Each object must have:
- prospectName: string (name of team/club/school program)
- organizationType: string (e.g. "Youth Club", "High School Program", "AAU Team", "Travel Ball", "Martial Arts Gym", "Athletic Department", "Private Academy", etc.)
- sport: string (e.g. "Football", "Soccer", "Basketball", "Baseball", "Volleyball", "Lacrosse", "Wrestling", "Cheer", "Swimming", "Martial Arts")
- city: string
- state: string (2-letter abbreviation)
- websiteUrl: string | null
- contactName: string (use "unknown" if not known)
- contactRole: string (use "unknown" if not known; e.g. "Head Coach", "Athletic Director", "Program Director")
- contactEmail: null (always null — we use decisionMakerEmail instead)
- contactPhone: null (never guess phones — always null)
- sourceUrl: string | null (plausible Google search URL to find this org)
- confidenceScore: number 1-100 (how confident you are this org exists in this area)
- notes: string (1-2 sentences: why this is a good team training prospect)
- decisionMakerName: string | null (first and last name of the best decision-maker contact you can find, or null)
- decisionMakerTitle: string | null (their title, e.g. "Athletic Director", "Head Football Coach", "Program Director", or null)
- decisionMakerEmail: string | null (their specific email if known, or a role-based email like director@clubname.org if plausible, or null)
- contactConfidence: number 0-100 (confidence in the contact info quality)
- contactSourceUrl: string | null (a plausible search URL to verify this contact)
- contactQuality: "decision_maker" | "role_based" | "general" | "missing"

Return only the JSON array. No markdown, no extra text.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4000,
  });

  const raw = response.choices[0].message.content || "[]";
  let parsed: any[] = [];
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) parsed = [];
  } catch {
    console.error("[ProspectResearch] Failed to parse OpenAI response:", raw);
    parsed = [];
  }

  const validQuality: ContactQuality[] = ["decision_maker", "role_based", "general", "missing"];

  parsed = parsed.map((p) => {
    const dmEmail = p.decisionMakerEmail || null;
    const rawQuality = p.contactQuality;
    const contactQuality: ContactQuality = validQuality.includes(rawQuality) ? rawQuality : (dmEmail ? "general" : "missing");

    return {
      ...p,
      contactEmail: null,
      contactPhone: p.contactPhone || null,
      confidenceScore: Math.max(1, Math.min(100, Math.round(p.confidenceScore || 50))),
      decisionMakerName: p.decisionMakerName || null,
      decisionMakerTitle: p.decisionMakerTitle || null,
      decisionMakerEmail: dmEmail,
      contactConfidence: Math.max(0, Math.min(100, Math.round(p.contactConfidence || 0))),
      contactSourceUrl: p.contactSourceUrl || null,
      contactQuality,
    };
  });

  return parsed as ProspectResult[];
}

export interface EmailDraftParams {
  businessName: string;
  coachName: string;
  prospectName: string;
  sport: string;
  city: string;
  contactName: string;
  services?: string[];
  // Phase 9 — agent context injection
  conversationStage?: string;
  contactQualityScore?: number;
  stageContext?: string;
}

export async function generateOutreachEmailFromVariant(
  params: EmailDraftParams,
  variant: { subjectTemplate: string; bodyTemplate: string }
): Promise<{ subject: string; body: string }> {
  const openai = getOpenAI();

  // Phase 9: stage-aware context injection
  const stageNoteV = params.conversationStage && params.conversationStage !== "cold"
    ? `\nConversation Stage: ${params.conversationStage}${params.stageContext ? ` — ${params.stageContext}` : ""}`
    : "";
  const qualityNoteV = params.contactQualityScore !== undefined && params.contactQualityScore > 0
    ? `\nContact Quality Score: ${params.contactQualityScore}/100${params.contactQualityScore >= 70 ? " (direct decision-maker)" : params.contactQualityScore < 40 ? " (generic inbox — keep brief)" : ""}`
    : "";

  const prompt = `You are personalizing an outreach email template for a sports performance training business.

Fill in the template below using the provided context. Replace any placeholder tokens like {businessName}, {coachName}, {prospectName}, {sport}, {city}, {contactName} with the actual values. Keep the tone and style of the template intact. Do not add or remove significant content beyond the substitutions and minor natural-language polish.

Context:
Business: ${params.businessName}
Coach/Owner: ${params.coachName}
Prospect Team/Club: ${params.prospectName}
Sport: ${params.sport}
Location: ${params.city}
Contact Name: ${params.contactName !== "unknown" ? params.contactName : "Coach/Director"}${stageNoteV}${qualityNoteV}

Subject Template:
${variant.subjectTemplate}

Body Template:
${variant.bodyTemplate}

Return a JSON object with:
- subject: string (personalized subject line)
- body: string (personalized plain text email body, use \\n for line breaks)

Return only JSON. No markdown.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
    max_tokens: 600,
  });

  const raw = response.choices[0].message.content || '{"subject":"","body":""}';
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      subject: variant.subjectTemplate.replace("{prospectName}", params.prospectName).replace("{sport}", params.sport),
      body: variant.bodyTemplate
        .replace(/{businessName}/g, params.businessName)
        .replace(/{coachName}/g, params.coachName)
        .replace(/{prospectName}/g, params.prospectName)
        .replace(/{sport}/g, params.sport)
        .replace(/{city}/g, params.city)
        .replace(/{contactName}/g, params.contactName !== "unknown" ? params.contactName : "Coach"),
    };
  }
}

export async function generateOutreachEmail(params: EmailDraftParams): Promise<{ subject: string; body: string }> {
  const openai = getOpenAI();

  const servicesList = (params.services && params.services.length > 0)
    ? params.services.join(", ")
    : "speed and agility, strength development, injury-risk reduction, conditioning, movement mechanics";

  // Phase 9: stage-aware context injection
  const stageNote = params.conversationStage && params.conversationStage !== "cold"
    ? `\nConversation Stage: ${params.conversationStage}${params.stageContext ? ` — ${params.stageContext}` : ""}`
    : "";
  const qualityNote = params.contactQualityScore !== undefined && params.contactQualityScore > 0
    ? `\nContact Quality Score: ${params.contactQualityScore}/100${params.contactQualityScore >= 70 ? " (direct decision-maker — reference their role specifically)" : params.contactQualityScore < 40 ? " (generic inbox — keep it warm and brief)" : ""}`
    : "";

  const prompt = `Write a professional, local, direct outreach email (not spammy) for a sports performance training business reaching out to a local sports team.

Business: ${params.businessName}
Coach/Owner: ${params.coachName}
Prospect Team/Club: ${params.prospectName}
Sport: ${params.sport}
Location: ${params.city}
Contact Name: ${params.contactName !== "unknown" ? params.contactName : "Coach/Director"}
Available Services: ${servicesList}${stageNote}${qualityNote}

Rules:
- Professional and respectful tone. Not pushy or salesy.
- Keep it under 200 words.
- Mention the team name and sport.
- Mention 3-4 specific services.
- End with a simple, low-pressure call to action (open to a quick conversation).
- If conversation stage is "contacted" or "follow_up", acknowledge prior contact briefly.
- If contact quality is high (direct coach/AD), address them by role; if low (generic inbox), keep it brief and warm.
- Sign off with the coach name and business name.

Return a JSON object with:
- subject: string (email subject line)
- body: string (plain text email body, use \\n for line breaks)

Return only JSON. No markdown.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.6,
    max_tokens: 600,
  });

  const raw = response.choices[0].message.content || '{"subject":"","body":""}';
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      subject: `Team training for ${params.prospectName}`,
      body: `Hi ${params.contactName !== "unknown" ? params.contactName : "Coach"},\n\nI'm reaching out from ${params.businessName}. We work with athletes on speed, strength, movement quality, and performance training.\n\nI came across ${params.prospectName} and thought there may be a good fit for off-season or in-season team training.\n\nWould you be open to a quick conversation about team training options?\n\nBest,\n${params.coachName}\n${params.businessName}`,
    };
  }
}

export function scoreProspect(prospect: ProspectResult): number {
  let score = prospect.confidenceScore || 50;

  // Decision-maker contact scoring
  if (prospect.contactQuality === "decision_maker") {
    score = Math.min(100, score + 20);
  } else if (prospect.contactQuality === "role_based") {
    score = Math.min(100, score + 10);
  } else if (prospect.contactQuality === "general") {
    score = Math.min(100, score + 3);
  } else {
    // missing email — strong penalty; cap at 75 regardless of other signals
    score = Math.min(75, score - 15);
  }

  if (prospect.decisionMakerName) score = Math.min(100, score + 5);
  if (prospect.websiteUrl) score = Math.min(100, score + 5);
  if (prospect.sport && prospect.sport !== "unknown") score = Math.min(100, score + 3);
  return Math.max(1, Math.round(score));
}

export type GateAction = "save" | "reject" | "duplicate";

export interface GateResult {
  action: GateAction;
  needsContact: boolean;
  reason?: string;
  weaknessCount: number;
  weaknesses: string[];
}

/**
 * Apply a quality gate to a scored prospect before persisting it.
 *
 * Weakness dimensions (each counts as 1):
 *   - contactQuality === "missing"
 *   - score < 60
 *   - no sourceUrl
 *   - organizationType is unknown/missing
 *
 * Reject if 2+ weaknesses. Duplicate if name already exists in the org pipeline
 * (case-insensitive, normalised). needsContact = true when saved but email is missing.
 */
export function applyLeadQualityGate(
  prospect: ProspectResult,
  score: number,
  existingNames: string[]
): GateResult {
  // ── Duplicate check ──────────────────────────────────────────────────────
  const normalise = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
  const candidateNorm = normalise(prospect.prospectName);
  const isDuplicate = existingNames.some((n) => normalise(n) === candidateNorm);
  if (isDuplicate) {
    return {
      action: "duplicate",
      needsContact: false,
      reason: "Duplicate — organization already exists in your pipeline",
      weaknessCount: 0,
      weaknesses: [],
    };
  }

  // ── Weakness scoring ─────────────────────────────────────────────────────
  const weaknesses: string[] = [];
  if (prospect.contactQuality === "missing") weaknesses.push("no contact email found");
  if (score < 60) weaknesses.push(`low confidence score (${score})`);
  if (!prospect.sourceUrl) weaknesses.push("no source URL to verify");
  const orgType = (prospect.organizationType || "").toLowerCase().trim();
  if (!orgType || orgType === "unknown") weaknesses.push("organization type unclear");

  const weaknessCount = weaknesses.length;

  if (weaknessCount >= 2) {
    return {
      action: "reject",
      needsContact: false,
      reason: `Too many weak signals: ${weaknesses.join("; ")}`,
      weaknessCount,
      weaknesses,
    };
  }

  return {
    action: "save",
    needsContact: prospect.contactQuality === "missing",
    weaknessCount,
    weaknesses,
  };
}

export type ContactSourceType = "verified" | "scraped" | "social" | "inferred" | "manual";
export type VerificationStatus = "verified" | "inferred" | "unverified";

export interface AlternativeContact {
  email: string;
  label: string;
  sourceType: ContactSourceType;
  name?: string | null;
}

export interface EnrichedContact {
  decisionMakerName: string | null;
  decisionMakerTitle: string | null;
  decisionMakerEmail: string | null;
  contactConfidence: number;
  contactSourceUrl: string | null;
  contactQuality: ContactQuality;
  contactSourceType: ContactSourceType;
  verificationStatus: VerificationStatus;
  enrichmentExplanation: string;
  alternativeContacts: AlternativeContact[];
}

function emptyEnrichment(): EnrichedContact {
  return {
    decisionMakerName: null,
    decisionMakerTitle: null,
    decisionMakerEmail: null,
    contactConfidence: 0,
    contactSourceUrl: null,
    contactQuality: "missing",
    contactSourceType: "inferred",
    verificationStatus: "unverified",
    enrichmentExplanation: "No contact could be found after exhausting all discovery phases.",
    alternativeContacts: [],
  };
}

export async function enrichProspectContact(
  org: Organization,
  prospectName: string,
  city: string,
  state: string,
  sport: string,
  organizationType: string,
  websiteUrl?: string | null
): Promise<EnrichedContact> {
  const openai = getOpenAI();

  const knownWebsite = websiteUrl ? `Known Website: ${websiteUrl}` : `Known Website: Unknown — determine the most likely domain from the org name and location`;

  const systemPrompt = `You are a professional B2B contact researcher specializing in finding decision-maker contacts for sports and athletic organizations. Your job is to find at least one usable outreach email through a structured multi-phase discovery process. You are aggressive and thorough — you do NOT give up easily.`;

  const userPrompt = `Find the best outreach contact for this organization using a structured 6-phase discovery process.

Organization: ${prospectName}
Type: ${organizationType}
Sport/Program: ${sport}
Location: ${city}, ${state}
${knownWebsite}

Work through these phases in order:

PHASE 1 — WEBSITE DISCOVERY
- Determine the most likely domain (e.g., prospectname.com, orgname.org, teamname.net)
- Identify likely contact page URLs: /contact, /staff, /coaches, /about, /athletics, /team, /directory, /leadership
- What emails would typically be listed on these pages for a ${organizationType}?
- Search URL to recommend for verification (e.g., site:domain.com contact OR "contact" site:domain.com)

PHASE 2 — SOCIAL MEDIA SIGNALS
- Instagram: What handle would this org use? Do ${organizationType}s in ${sport} typically post contact info in their bio?
- Facebook: Does this type of org usually have a Facebook page with contact info?
- LinkedIn: Is there a company page? Would a coach/director have a LinkedIn?
- Linktree or link-in-bio tools: Common for youth sports and athletic programs

PHASE 3 — DECISION MAKER IDENTIFICATION
For a ${organizationType} focused on ${sport} in ${city}, ${state}:
- Who is the typical decision maker for outside vendor contracts like team performance training?
- Most likely titles: (e.g., Athletic Director, Head Coach, Program Director, Owner, Strength Coordinator)
- Based on the region and org type, what first/last names are common for this role?
- Best decision-maker role to target for outreach

PHASE 4 — EMAIL PATTERN GENERATION
Based on the likely domain, generate the most probable email addresses even if not verified:
Priority order:
1. firstname.lastname@domain (e.g., john.smith@orgname.com)
2. coach@domain
3. director@domain
4. athletics@domain
5. admin@domain
6. info@domain
7. contact@domain
These INFERRED emails are acceptable — label them clearly as inferred/unverified.

PHASE 5 — CONTACT RANKING
Rank your discovered/inferred contacts:
- decision_maker: Named person with direct email (highest priority)
- role_based: Role-specific inbox (director@, coach@, athletics@)
- general: General inbox (info@, contact@, office@)
- IMPORTANT: Only use "missing" if you literally cannot guess a domain for this organization

PHASE 6 — SELECTION + EXPLANATION
Select the single best contact and explain your reasoning in 1-2 sentences.

Return ONLY this JSON (no markdown, no explanation outside JSON):
{
  "decisionMakerName": string | null,
  "decisionMakerTitle": string | null,
  "decisionMakerEmail": string,
  "contactConfidence": number 0-100,
  "contactSourceUrl": string | null,
  "contactQuality": "decision_maker" | "role_based" | "general" | "missing",
  "contactSourceType": "verified" | "scraped" | "social" | "inferred",
  "verificationStatus": "verified" | "inferred" | "unverified",
  "enrichmentExplanation": "1-2 sentence explanation of where this email came from and why it was selected",
  "alternativeContacts": [
    { "email": string, "label": string, "sourceType": "inferred" | "scraped" | "social" | "general", "name": string | null }
  ]
}

CRITICAL RULES:
- It is REQUIRED to return at least one email address unless you absolutely cannot determine any possible domain.
- Inferred/pattern-generated emails are acceptable and preferred over returning "missing".
- Most organizations have a guessable domain. Use it.
- contactConfidence should reflect how certain you are: verified=75-95, role_based inferred=45-65, general inferred=25-45.
- alternativeContacts should include 2-4 backup options beyond the primary selection.
- verificationStatus must be "inferred" if the email is pattern-generated, "verified" if found on a real page.`;

  // Phase 1-5: Primary discovery attempt
  let primaryResult: EnrichedContact | null = null;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 700,
    });

    const raw = response.choices[0].message.content || "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const validQuality: ContactQuality[] = ["decision_maker", "role_based", "general", "missing"];
    const contactQuality: ContactQuality = validQuality.includes(parsed.contactQuality) ? parsed.contactQuality : "general";
    const validSourceTypes: ContactSourceType[] = ["verified", "scraped", "social", "inferred", "manual"];
    const contactSourceType: ContactSourceType = validSourceTypes.includes(parsed.contactSourceType) ? parsed.contactSourceType : "inferred";
    const validVerification: VerificationStatus[] = ["verified", "inferred", "unverified"];
    const verificationStatus: VerificationStatus = validVerification.includes(parsed.verificationStatus) ? parsed.verificationStatus : "unverified";

    const alternativeContacts: AlternativeContact[] = Array.isArray(parsed.alternativeContacts)
      ? parsed.alternativeContacts
          .filter((c: any) => c?.email && typeof c.email === "string")
          .map((c: any) => ({
            email: c.email,
            label: c.label || "Alternative",
            sourceType: validSourceTypes.includes(c.sourceType) ? c.sourceType : "inferred",
            name: c.name || null,
          }))
      : [];

    primaryResult = {
      decisionMakerName: parsed.decisionMakerName || null,
      decisionMakerTitle: parsed.decisionMakerTitle || null,
      decisionMakerEmail: parsed.decisionMakerEmail || null,
      contactConfidence: Math.max(0, Math.min(100, Math.round(parsed.contactConfidence || 0))),
      contactSourceUrl: parsed.contactSourceUrl || null,
      contactQuality,
      contactSourceType,
      verificationStatus,
      enrichmentExplanation: parsed.enrichmentExplanation || "Contact discovered via AI research pipeline.",
      alternativeContacts,
    };
  } catch (err) {
    console.error("[EnrichContact] Primary discovery failed:", err);
  }

  // Phase 6: Fallback — pure pattern inference if primary returned missing or failed
  if (!primaryResult || (primaryResult.contactQuality === "missing" && !primaryResult.decisionMakerEmail)) {
    try {
      const fallbackPrompt = `Generate plausible email patterns for this organization. Even if you cannot verify them, infer the most likely domain and email addresses.

Organization: ${prospectName}
Type: ${organizationType}
Location: ${city}, ${state}

Determine:
1. The most likely website domain
2. 3-5 email patterns for the decision-maker (coach@, director@, athletics@, info@, contact@)

Return ONLY JSON:
{
  "domain": "guesseddomain.com",
  "decisionMakerEmail": "best_guess@domain.com",
  "contactQuality": "role_based" or "general",
  "contactConfidence": 25,
  "alternativeContacts": [
    { "email": "alt@domain.com", "label": "General Inbox", "sourceType": "inferred", "name": null }
  ],
  "enrichmentExplanation": "Domain inferred from organization name. Email patterns are unverified."
}`;

      const fallbackResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: fallbackPrompt }],
        temperature: 0.2,
        max_tokens: 300,
      });

      const raw2 = fallbackResponse.choices[0].message.content || "{}";
      const cleaned2 = raw2.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed2 = JSON.parse(cleaned2);

      if (parsed2.decisionMakerEmail) {
        const validQuality: ContactQuality[] = ["decision_maker", "role_based", "general", "missing"];
        return {
          decisionMakerName: null,
          decisionMakerTitle: null,
          decisionMakerEmail: parsed2.decisionMakerEmail,
          contactConfidence: Math.max(0, Math.min(100, Math.round(parsed2.contactConfidence || 25))),
          contactSourceUrl: parsed2.domain ? `https://${parsed2.domain}` : null,
          contactQuality: validQuality.includes(parsed2.contactQuality) ? parsed2.contactQuality : "general",
          contactSourceType: "inferred",
          verificationStatus: "inferred",
          enrichmentExplanation: parsed2.enrichmentExplanation || "Email pattern inferred from organization domain.",
          alternativeContacts: Array.isArray(parsed2.alternativeContacts)
            ? parsed2.alternativeContacts.filter((c: any) => c?.email).map((c: any) => ({
                email: c.email,
                label: c.label || "Alternative",
                sourceType: "inferred" as ContactSourceType,
                name: c.name || null,
              }))
            : [],
        };
      }
    } catch (err) {
      console.error("[EnrichContact] Fallback inference failed:", err);
    }

    return primaryResult || emptyEnrichment();
  }

  return primaryResult;
}
