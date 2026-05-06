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
- NEVER use the string "unknown" — use null for any field you cannot reliably determine.
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

If a websiteUrl is found, infer a likely contact email from the domain:
  - For schools/academies: athletics@domain or admissions@domain
  - For sports teams/clubs: coach@domain or info@domain
  - For general orgs: info@domain or contact@domain
These inferred emails are acceptable — set contactQuality to "role_based" or "general" and mark them clearly.

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
- contactName: string | null (null if not known — NEVER use "unknown")
- contactRole: string | null (null if not known — NEVER use "unknown"; e.g. "Head Coach", "Athletic Director", "Program Director")
- contactEmail: null (always null — we use decisionMakerEmail instead)
- contactPhone: null (never guess phones — always null)
- sourceUrl: string | null (plausible Google search URL to find this org)
- confidenceScore: number 1-100 (how confident you are this org exists in this area)
- notes: string (1-2 sentences: why this is a good team training prospect)
- decisionMakerName: string | null (first and last name of the best decision-maker contact you can find, or null)
- decisionMakerTitle: string | null (their title, e.g. "Athletic Director", "Head Football Coach", "Program Director", or null)
- decisionMakerEmail: string | null (a verified or role-based email like director@clubname.org, or inferred like coach@domain.com if a website is known — null only if no domain can be determined)
- contactConfidence: number 0-100 (confidence in the contact info; 60-80 for inferred from domain, 80-95 for verified)
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
    let dmEmail = normalizeNullable(p.decisionMakerEmail);

    const rawQuality = p.contactQuality;
    // Only count email as present if AI returned a verified/real email for the decision maker
    const dmEmailValid = isValidEmail(dmEmail);
    const contactQuality: ContactQuality = validQuality.includes(rawQuality) ? rawQuality : (dmEmailValid ? "general" : "missing");

    return {
      ...p,
      contactName: normalizeNullable(p.contactName),
      contactRole: normalizeNullable(p.contactRole),
      contactEmail: null,
      contactPhone: null,
      websiteUrl: normalizeNullable(p.websiteUrl),
      sourceUrl: normalizeNullable(p.sourceUrl),
      confidenceScore: Math.max(1, Math.min(100, Math.round(p.confidenceScore || 50))),
      decisionMakerName: normalizeNullable(p.decisionMakerName),
      decisionMakerTitle: normalizeNullable(p.decisionMakerTitle),
      decisionMakerEmail: dmEmail,
      contactConfidence: Math.max(0, Math.min(100, Math.round(p.contactConfidence || 0))),
      contactSourceUrl: normalizeNullable(p.contactSourceUrl),
      contactQuality,
    };
  });

  return parsed as ProspectResult[];
}

// ─── Domain + Email Inference Helpers ──────────────────────────────────────

export function extractDomainFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export interface EmailCandidate {
  email: string;
  label: string;
  sourceType: string;
}

function makeCandidate(local: string, domain: string, label: string): EmailCandidate | null {
  const email = `${local}@${domain}`;
  return isValidEmail(email) ? { email, label, sourceType: "inferred" } : null;
}

export function buildEmailCandidates(
  domain: string,
  orgType?: string | null,
  sport?: string | null,
  orgName?: string | null
): EmailCandidate[] {
  const t = (orgType || "").toLowerCase();
  const s = (sport || "").toLowerCase();
  const n = (orgName || "").toLowerCase();

  const c = (local: string, label: string) => makeCandidate(local, domain, label);

  let ranked: (EmailCandidate | null)[];

  const isSchool = t.includes("academy") || t.includes("school") || t.includes("high school") || t.includes("college") || t.includes("university") || t.includes("private");
  const isVolleyball = s.includes("volleyball") || n.includes("volleyball");
  const isBasketball = s.includes("basketball") || n.includes("aau") || t.includes("aau") || s.includes("aau");
  const isMartialArts = t.includes("martial arts") || t.includes("gym") || s.includes("martial arts") || s.includes("mma") || s.includes("jiu-jitsu") || s.includes("karate");
  const isTeamSport = s.includes("football") || s.includes("baseball") || s.includes("soccer") || s.includes("lacrosse") || s.includes("wrestling") || s.includes("cheer") || s.includes("swim");

  if (isSchool) {
    ranked = [
      c("athletics", "Athletics Dept"),
      c("athleticdirector", "Athletic Director"),
      c("admissions", "Admissions"),
      c("contact", "General Contact"),
      c("info", "General Info"),
    ];
  } else if (isVolleyball) {
    ranked = [
      c("director", "Club Director"),
      c("coach", "Head Coach"),
      c("volleyball", "Volleyball Inbox"),
      c("club", "Club Contact"),
      c("contact", "General Contact"),
      c("info", "General Info"),
    ];
  } else if (isBasketball) {
    ranked = [
      c("director", "Club Director"),
      c("coach", "Head Coach"),
      c("basketball", "Basketball Inbox"),
      c("aau", "AAU Contact"),
      c("teams", "Teams Inbox"),
      c("contact", "General Contact"),
      c("info", "General Info"),
    ];
  } else if (isMartialArts) {
    ranked = [
      c("instructor", "Lead Instructor"),
      c("coach", "Head Coach"),
      c("training", "Training Inbox"),
      c("contact", "General Contact"),
      c("info", "General Info"),
    ];
  } else if (isTeamSport) {
    ranked = [
      c("coach", "Head Coach"),
      c("director", "Program Director"),
      c("contact", "General Contact"),
      c("info", "General Info"),
    ];
  } else {
    ranked = [
      c("contact", "General Contact"),
      c("admin", "Admin"),
      c("info", "General Info"),
    ];
  }

  return ranked.filter((x): x is EmailCandidate => x !== null);
}

export function inferEmailFromDomain(domain: string, orgType?: string | null, sport?: string | null, orgName?: string | null): string | null {
  const candidates = buildEmailCandidates(domain, orgType, sport, orgName);
  return candidates.length > 0 ? candidates[0].email : null;
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
Contact Name: ${params.contactName && params.contactName !== "unknown" ? params.contactName : "Coach/Director"}${stageNoteV}${qualityNoteV}

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
        .replace(/{contactName}/g, params.contactName && params.contactName !== "unknown" ? params.contactName : "Coach"),
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
Contact Name: ${params.contactName && params.contactName !== "unknown" ? params.contactName : "Coach/Director"}
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
      body: `Hi ${params.contactName && params.contactName !== "unknown" ? params.contactName : "Coach"},\n\nI'm reaching out from ${params.businessName}. We work with athletes on speed, strength, movement quality, and performance training.\n\nI came across ${params.prospectName} and thought there may be a good fit for off-season or in-season team training.\n\nWould you be open to a quick conversation about team training options?\n\nBest,\n${params.coachName}\n${params.businessName}`,
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
  if (prospect.sport) score = Math.min(100, score + 3);
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

export type ContactSourceType = "verified" | "scraped" | "social" | "website" | "directory" | "search_result" | "manual";
export type VerificationStatus = "verified" | "unverified";

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

export function normalizeNullable(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  const lowered = cleaned.toLowerCase();
  if (["unknown", "n/a", "none", "not found", "unavailable", "null", ""].includes(lowered)) {
    return null;
  }
  return cleaned;
}

export function isValidEmail(value?: string | null): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function emptyEnrichment(): EnrichedContact {
  return {
    decisionMakerName: null,
    decisionMakerTitle: null,
    decisionMakerEmail: null,
    contactConfidence: 0,
    contactSourceUrl: null,
    contactQuality: "missing",
    contactSourceType: "manual",
    verificationStatus: "unverified",
    enrichmentExplanation: "No real email was found in available sources.",
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

  const knownWebsite = websiteUrl
    ? `Known Website: ${websiteUrl}`
    : `Known Website: None provided. Only search using the organization name and location.`;

  const systemPrompt = `You are a professional B2B contact researcher for a sports performance training company. Your job is to find real, source-backed email addresses for sports organizations.

STRICT RULES — NEVER VIOLATE:
- You may ONLY return an email address that explicitly appears in a real source (website, contact page, social bio, staff directory, public search result).
- You must NOT invent, guess, infer, generate, or pattern-match email addresses from domains.
- You must NOT create role-based emails like coach@domain.com or info@domain.com unless that exact email appears in a public source.
- If no real email is found in available sources, set foundRealEmail to false and contactEmail to null.
- Never use "unknown", "n/a", or "not found" for name or role — use null.
- foundRealEmail must be true ONLY when a real email was explicitly discovered.`;

  const userPrompt = `Search for a real, publicly available outreach email for this organization.

Organization: ${prospectName}
Type: ${organizationType}
Sport/Program: ${sport}
Location: ${city}, ${state}
${knownWebsite}

Search these sources:
- Website contact page (/contact, /staff, /coaches, /about, /athletics, /directory, /leadership)
- Social bios (Instagram, Facebook, Linktree)
- LinkedIn company page or staff profiles
- Published staff/coaching directories
- Google search snippets that show the email explicitly

Return ONLY this JSON (no markdown):
{
  "foundRealEmail": boolean,
  "contactName": string | null,
  "contactRole": string | null,
  "contactEmail": string | null,
  "contactPhone": string | null,
  "contactSourceType": "website" | "social" | "directory" | "search_result" | null,
  "verificationStatus": "verified" | "unverified" | null,
  "sourceUrl": string | null,
  "enrichmentExplanation": string | null,
  "alternativeContacts": [
    {
      "email": string,
      "name": string | null,
      "role": string | null,
      "sourceType": "website" | "social" | "directory" | "search_result",
      "sourceUrl": string | null,
      "confidence": number,
      "explanation": string
    }
  ]
}

Rules for alternativeContacts:
- Only include emails that were explicitly found in a real source.
- Do NOT include inferred or pattern-generated emails.
- If none found, return an empty array.`;

  const validQuality: ContactQuality[] = ["decision_maker", "role_based", "general", "missing"];
  const validSourceTypes: ContactSourceType[] = ["verified", "scraped", "social", "website", "directory", "search_result", "manual"];
  const validVerification: VerificationStatus[] = ["verified", "unverified"];

  function parseEnrichedResult(parsed: any): EnrichedContact | null {
    if (!parsed.foundRealEmail) return null;
    const contactEmail = normalizeNullable(parsed.contactEmail);
    if (!isValidEmail(contactEmail)) return null;

    const contactQuality: ContactQuality = validQuality.includes(parsed.contactQuality) ? parsed.contactQuality : "general";
    const rawSourceType = parsed.contactSourceType ?? parsed.sourceType;
    const contactSourceType: ContactSourceType = validSourceTypes.includes(rawSourceType) ? rawSourceType : "website";
    const rawVerification = parsed.verificationStatus;
    const verificationStatus: VerificationStatus = validVerification.includes(rawVerification) ? rawVerification : "unverified";

    const alternativeContacts: AlternativeContact[] = Array.isArray(parsed.alternativeContacts)
      ? parsed.alternativeContacts
          .filter((c: any) => c?.email && isValidEmail(c.email))
          .map((c: any) => ({
            email: c.email.trim(),
            label: c.role || c.label || "Alternative Contact",
            sourceType: validSourceTypes.includes(c.sourceType) ? c.sourceType : "website",
            name: normalizeNullable(c.name),
          }))
      : [];

    return {
      decisionMakerName: normalizeNullable(parsed.contactName),
      decisionMakerTitle: normalizeNullable(parsed.contactRole),
      decisionMakerEmail: contactEmail,
      contactConfidence: Math.max(0, Math.min(100, Math.round(parsed.contactConfidence || parsed.confidence || 70))),
      contactSourceUrl: normalizeNullable(parsed.sourceUrl || parsed.contactSourceUrl) || null,
      contactQuality,
      contactSourceType,
      verificationStatus,
      enrichmentExplanation: parsed.enrichmentExplanation || "Email found via source research.",
      alternativeContacts,
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 700,
    });

    const raw = response.choices[0].message.content || "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const result = parseEnrichedResult(parsed);
    if (result) return result;
  } catch (err) {
    console.error("[EnrichContact] Discovery failed:", err);
  }

  return emptyEnrichment();
}
