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

export type LeadDiscoverySourceType = "website" | "search_result" | "directory" | "social" | "manual";
export type LeadDiscoveryMethod = "google_search" | "web_search" | "directory_scan" | "social_discovery" | "manual";
export type LeadValidationStatus = "verified" | "likely_valid" | "weak" | "stale" | "rejected";

export interface ProspectResult {
  prospectName: string;
  organizationType: string | null;
  sport: string | null;
  city: string | null;
  state: string | null;
  websiteUrl: string | null;
  contactName: string | null;
  contactRole: string | null;
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
  // Lead Discovery Evidence Layer
  discoverySourceType: LeadDiscoverySourceType;
  discoverySourceUrl: string | null;
  discoverySourceTitle: string | null;
  discoverySourceSnippet: string | null;
  discoveryQuery: string | null;
  discoveryMethod: LeadDiscoveryMethod;
  discoveryConfidenceScore: number;
  leadValidationStatus: LeadValidationStatus;
}

const VALID_QUALITY: ContactQuality[] = ["decision_maker", "role_based", "general", "missing"];
const VALID_DISCOVERY_SOURCE: LeadDiscoverySourceType[] = ["website", "search_result", "directory", "social", "manual"];
const VALID_DISCOVERY_METHOD: LeadDiscoveryMethod[] = ["google_search", "web_search", "directory_scan", "social_discovery", "manual"];
const VALID_VALIDATION_STATUS: LeadValidationStatus[] = ["verified", "likely_valid", "weak", "stale", "rejected"];

function normalizeProspect(p: any): ProspectResult {
  const dmEmail = normalizeNullable(p.decisionMakerEmail);
  const dmEmailValid = isValidEmail(dmEmail);
  const rawQuality = p.contactQuality;
  const contactQuality: ContactQuality = VALID_QUALITY.includes(rawQuality) ? rawQuality : (dmEmailValid ? "general" : "missing");

  const rawDst = p.discoverySourceType;
  const discoverySourceType: LeadDiscoverySourceType = VALID_DISCOVERY_SOURCE.includes(rawDst) ? rawDst : "search_result";
  const rawDm = p.discoveryMethod;
  const discoveryMethod: LeadDiscoveryMethod = VALID_DISCOVERY_METHOD.includes(rawDm) ? rawDm : "web_search";
  const rawVs = p.leadValidationStatus;
  const leadValidationStatus: LeadValidationStatus = VALID_VALIDATION_STATUS.includes(rawVs) ? rawVs : "likely_valid";
  const rawDcs = p.discoveryConfidenceScore;
  const discoveryConfidenceScore = typeof rawDcs === "number" ? Math.max(0, Math.min(1, rawDcs)) : 0.5;

  return {
    prospectName: p.organizationName || p.prospectName || "Unknown",
    organizationType: p.organizationType || "Sports Organization",
    sport: p.sport || "General",
    city: p.city || "",
    state: p.state || "",
    websiteUrl: normalizeNullable(p.websiteUrl),
    contactName: normalizeNullable(p.contactName),
    contactRole: normalizeNullable(p.contactRole),
    contactEmail: normalizeNullable(p.contactEmail),
    contactPhone: normalizeNullable(p.contactPhone),
    sourceUrl: normalizeNullable(p.discoverySourceUrl || p.sourceUrl),
    confidenceScore: Math.max(1, Math.min(100, Math.round((discoveryConfidenceScore * 100) || p.confidenceScore || 50))),
    notes: p.notes || "",
    decisionMakerName: null,
    decisionMakerTitle: null,
    decisionMakerEmail: null,
    contactConfidence: 0,
    contactSourceUrl: null,
    contactQuality: "missing",
    discoverySourceType,
    discoverySourceUrl: normalizeNullable(p.discoverySourceUrl || p.sourceUrl),
    discoverySourceTitle: normalizeNullable(p.discoverySourceTitle),
    discoverySourceSnippet: normalizeNullable(p.discoverySourceSnippet),
    discoveryQuery: normalizeNullable(p.discoveryQuery),
    discoveryMethod,
    discoveryConfidenceScore,
    leadValidationStatus,
  };
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
    ? `Focus specifically on ${sportFilter} organizations. You may include adjacent sports if needed.`
    : `Cover a broad variety of sports: youth football, basketball, soccer, volleyball, baseball, lacrosse, wrestling, track & field, swim teams, cheer, martial arts gyms, athletic departments.`;

  const searchInput = `You are a B2B lead research intelligence system for a sports performance training company. Your task is to find REAL, verifiable sports organizations near ${location} that would be strong prospects for team training services (${specialties}).

CRITICAL — YOU MUST SEARCH THE WEB:
1. Run these searches and visit the pages you find:
   - "${location} youth sports clubs"
   - "${location} ${sportFilter && sportFilter !== "all" ? sportFilter : "travel"} teams site directory"
   - "${location} high school athletics"
   - "${location} AAU ${sportFilter && sportFilter !== "all" ? sportFilter : "basketball"} teams"
   - "${location} recreational sports clubs"
2. For each result, click through to the actual organization website/page to confirm it's real.
3. Verify location — only include orgs within ${radiusMiles} miles of ${location}.

${sportContext}

STRICT RULES:
- You may ONLY return organizations you actually found in web search results or on real pages.
- Do NOT invent, hallucinate, or generate organizations from your training data.
- Each lead MUST have a real source URL (the page or search result where you found it).
- Each lead MUST have a real evidence snippet — actual text from that source proving it exists.
- discoveryConfidenceScore: 0.90+ = confirmed on their official website; 0.75 = directory listing; 0.65 = search snippet; REJECT anything below 0.45.
- If you cannot find enough real orgs, return fewer leads — never pad with hallucinations.

Return a JSON array of up to ${limit} organizations. Each object MUST have these exact fields:
{
  "organizationName": string,
  "organizationType": "Youth Club" | "High School Program" | "AAU Team" | "Travel Ball" | "Athletic Department" | "Private Academy" | "Recreational League" | "Club Team",
  "sport": string,
  "city": string,
  "state": string,
  "websiteUrl": string | null,
  "contactName": string | null,
  "contactRole": string | null,
  "contactEmail": string | null,
  "contactPhone": string | null,
  "notes": string,
  "discoverySourceType": "website" | "search_result" | "directory" | "social",
  "discoverySourceUrl": string,
  "discoverySourceTitle": string,
  "discoverySourceSnippet": string,
  "discoveryQuery": string,
  "discoveryMethod": "web_search" | "directory_scan" | "social_discovery",
  "discoveryConfidenceScore": number,
  "leadValidationStatus": "verified" | "likely_valid" | "weak"
}

URL RULES (critical):
- "websiteUrl": the organization's OWN official website (e.g. "https://hhba.org"). If you visited their site, put it here. null only if they truly have no website.
- "discoverySourceUrl": the exact URL of the page or search result where you first confirmed this org exists. NEVER null — use the URL you actually visited.

NOTES RULES (critical — do NOT write generic text):
- "notes" must be 2-3 specific sentences describing: (1) what age groups or competitive level they serve, (2) how many athletes/teams if visible, (3) why they are a strong candidate for speed/strength/agility training. Example: "Competitive travel baseball club with 8 teams across 10U-18U divisions. Roughly 150+ athletes in the Beaufort area based on their roster pages. High-volume multi-team program ideal for team training packages."
- Do NOT write vague filler like "Provides baseball programs for youth." Include real, specific details from the pages you visited.

CONTACT INFO RULES:
- When you visit an organization's website or directory page, look for the contact person's name, title/role, phone number, or email address. Capture anything you can clearly see.
- "contactName": the name of the coach, director, athletic director, or primary contact if visible on the page — otherwise null.
- "contactRole": their title or role (e.g. "Head Coach", "Club Director", "Athletic Director") — otherwise null.
- "contactPhone": their phone number if listed publicly on the site — otherwise null.
- "contactEmail": their email address ONLY if it is explicitly listed on the page (not inferred or guessed) — otherwise null.
- Do NOT guess or infer contact details. Only capture what is explicitly shown.

Only include leads with discoveryConfidenceScore >= 0.45. Return ONLY the JSON array. No markdown.`;

  // Phase 1: Live web search via Responses API (90-second timeout)
  try {
    const webSearchPromise = (openai as any).responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: searchInput,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("web_search_timeout")), 90000)
    );
    const webResponse = await Promise.race([webSearchPromise, timeoutPromise]);

    const rawText: string = webResponse.output_text || "";
    console.log(`[ProspectResearch] Web search response for ${location}: ${rawText.length} chars`);

    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      let parsed: any[] = [];
      try {
        parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed)) parsed = [];
      } catch {
        console.error("[ProspectResearch] Failed to parse JSON array from web search");
        parsed = [];
      }

      // Apply confidence gate and normalize
      const results = parsed
        .filter((p) => {
          const score = typeof p.discoveryConfidenceScore === "number" ? p.discoveryConfidenceScore : 0;
          if (score < 0.45) {
            console.log(`[ProspectResearch] Rejecting ${p.organizationName || "unknown"} — confidence ${score} < 0.45`);
            return false;
          }
          if (!p.discoverySourceUrl && !p.websiteUrl) {
            console.log(`[ProspectResearch] Rejecting ${p.organizationName || "unknown"} — no source URL`);
            return false;
          }
          if (!p.discoverySourceSnippet) {
            console.log(`[ProspectResearch] Rejecting ${p.organizationName || "unknown"} — no evidence snippet`);
            return false;
          }
          return true;
        })
        .map(normalizeProspect);

      console.log(`[ProspectResearch] Returning ${results.length} verified leads from web search`);
      return results;
    }

    console.error("[ProspectResearch] No JSON array found in web search response");
  } catch (err: any) {
    console.error("[ProspectResearch] Web search failed:", err?.message || err);
  }

  // Phase 2: Fallback — clearly labeled as lower-confidence
  console.warn("[ProspectResearch] Falling back to chat completions (no live web access)");
  return await researchProspectsFallback(openai, location, sportFilter, limit, radiusMiles, specialties);
}

async function researchProspectsFallback(
  openai: OpenAI,
  location: string,
  sportFilter: string | undefined,
  limit: number,
  radiusMiles: number,
  specialties: string
): Promise<ProspectResult[]> {
  const sportContext = sportFilter && sportFilter !== "all"
    ? `Focus specifically on ${sportFilter} organizations.`
    : `Cover a broad variety of sports: youth football, basketball, soccer, volleyball, baseball, lacrosse, wrestling, track & field, swim teams, cheer, martial arts.`;

  const systemPrompt = `You are a lead research assistant for a sports performance training business. Find real, known sports organizations near ${location}. Only include organizations you have genuine knowledge of from training data — no made-up names. Mark all leads with discoveryConfidenceScore 0.50-0.65 to reflect limited web verification.`;

  const userPrompt = `Find up to ${limit} real sports organizations within ${radiusMiles} miles of ${location}. ${sportContext}

Return a JSON array. Each object must have:
- "organizationName": string
- "organizationType": string
- "sport": string
- "city": string
- "state": string
- "websiteUrl": string | null
- "contactName": string | null — name of the head coach, director, or athletic director if you know it from training data
- "contactRole": string | null — their title or role if known (e.g. "Head Coach", "Athletic Director")
- "contactEmail": null
- "contactPhone": null
- "notes": string
- "discoverySourceType": "search_result"
- "discoverySourceUrl": null
- "discoverySourceTitle": null
- "discoverySourceSnippet": null
- "discoveryQuery": "fallback research - ${location}"
- "discoveryMethod": "web_search"
- "discoveryConfidenceScore": number (0.50-0.65 for training data, lower if uncertain)
- "leadValidationStatus": "likely_valid" | "weak"

Only include orgs you have strong reason to believe exist. Return ONLY the JSON array.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    });

    const raw = response.choices[0].message.content || "[]";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) parsed = [];
    } catch {
      parsed = [];
    }

    return parsed
      .filter((p) => typeof p.discoveryConfidenceScore !== "number" || p.discoveryConfidenceScore >= 0.45)
      .map(normalizeProspect);
  } catch (err) {
    console.error("[ProspectResearch] Fallback also failed:", err);
    return [];
  }
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
  // Base score from discovery confidence (0-1 → 0-100)
  let score = Math.round(prospect.discoveryConfidenceScore * 100) || prospect.confidenceScore || 50;

  // Evidence quality bonuses
  if (prospect.discoverySourceSnippet) score = Math.min(100, score + 5);
  if (prospect.discoverySourceUrl) score = Math.min(100, score + 3);
  if (prospect.websiteUrl) score = Math.min(100, score + 5);
  if (prospect.sport) score = Math.min(100, score + 2);

  // Validation status modifiers
  if (prospect.leadValidationStatus === "verified") score = Math.min(100, score + 10);
  else if (prospect.leadValidationStatus === "weak") score = Math.max(1, score - 15);
  else if (prospect.leadValidationStatus === "stale") score = Math.max(1, score - 20);
  else if (prospect.leadValidationStatus === "rejected") return 0;

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
 * Primary gate: discoveryConfidenceScore < 0.45 → immediate reject (no evidence).
 * Secondary: duplicate check by normalized name.
 * Weakness dimensions: missing source, missing snippet, score < 50, unknown org type.
 */
export function applyLeadQualityGate(
  prospect: ProspectResult,
  score: number,
  existingNames: string[]
): GateResult {
  // ── Hard reject — below minimum discovery confidence ──────────────────────
  if (prospect.discoveryConfidenceScore < 0.45 || prospect.leadValidationStatus === "rejected") {
    return {
      action: "reject",
      needsContact: false,
      reason: `Discovery confidence too low (${Math.round(prospect.discoveryConfidenceScore * 100)}%) — no verifiable evidence`,
      weaknessCount: 1,
      weaknesses: ["discovery confidence below minimum threshold"],
    };
  }

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
  if (!prospect.discoverySourceUrl) weaknesses.push("no source URL to verify");
  if (!prospect.discoverySourceSnippet) weaknesses.push("no evidence snippet from source");
  if (score < 50) weaknesses.push(`low confidence score (${score})`);
  const orgType = (prospect.organizationType || "").toLowerCase().trim();
  if (!orgType || orgType === "unknown") weaknesses.push("organization type unclear");

  const weaknessCount = weaknesses.length;

  if (weaknessCount >= 3) {
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

export type DiscoveryMethod =
  | "website_contact_page"
  | "website_staff_page"
  | "athletics_page"
  | "directory_listing"
  | "social_profile"
  | "search_result"
  | "manual";

export interface AlternativeContactFull {
  email: string;
  name: string | null;
  role: string | null;
  sourceType: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceSnippet: string | null;
  confidence: number;
  explanation: string;
}

export interface EnrichedContact {
  decisionMakerName: string | null;
  decisionMakerTitle: string | null;
  decisionMakerEmail: string | null;
  contactPhone: string | null;
  contactFormUrl: string | null;
  contactConfidence: number;
  contactSourceUrl: string | null;
  contactSourceTitle: string | null;
  contactSourceSnippet: string | null;
  contactDiscoveryMethod: DiscoveryMethod | null;
  contactConfidenceScore: number | null;
  contactQuality: ContactQuality;
  contactSourceType: ContactSourceType;
  verificationStatus: VerificationStatus;
  enrichmentExplanation: string;
  alternativeContacts: AlternativeContact[];
  partial?: boolean;
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
    contactPhone: null,
    contactFormUrl: null,
    contactConfidence: 0,
    contactSourceUrl: null,
    contactSourceTitle: null,
    contactSourceSnippet: null,
    contactDiscoveryMethod: null,
    contactConfidenceScore: null,
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

  const validQuality: ContactQuality[] = ["decision_maker", "role_based", "general", "missing"];
  const validSourceTypes: ContactSourceType[] = ["verified", "scraped", "social", "website", "directory", "search_result", "manual"];
  const validVerification: VerificationStatus[] = ["verified", "unverified"];
  const validDiscoveryMethods: DiscoveryMethod[] = ["website_contact_page", "website_staff_page", "athletics_page", "directory_listing", "social_profile", "search_result", "manual"];

  function parseEnrichedResult(parsed: any): EnrichedContact | null {
    const contactEmail = normalizeNullable(parsed.contactEmail);
    const hasRealEmail = parsed.foundRealEmail && isValidEmail(contactEmail);
    const contactPhone = normalizeNullable(parsed.contactPhone);
    const contactFormUrl = normalizeNullable(parsed.contactFormUrl);
    const contactName = normalizeNullable(parsed.contactName);

    // If no email AND no partial data at all, return null
    if (!hasRealEmail && !contactPhone && !contactFormUrl && !contactName) return null;

    const contactQuality: ContactQuality = validQuality.includes(parsed.contactQuality) ? parsed.contactQuality : (hasRealEmail ? "general" : "missing");
    const rawSourceType = parsed.contactSourceType ?? parsed.sourceType;
    const contactSourceType: ContactSourceType = validSourceTypes.includes(rawSourceType) ? rawSourceType : "website";
    const rawVerification = parsed.verificationStatus;
    const verificationStatus: VerificationStatus = validVerification.includes(rawVerification) ? rawVerification : "unverified";
    const rawMethod = parsed.contactDiscoveryMethod;
    const contactDiscoveryMethod: DiscoveryMethod | null = validDiscoveryMethods.includes(rawMethod) ? rawMethod : null;
    const rawScore = parsed.contactConfidenceScore;
    const contactConfidenceScore = typeof rawScore === "number" ? Math.max(0, Math.min(1, rawScore)) : null;

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

    const scoreInt = contactConfidenceScore !== null
      ? Math.round(contactConfidenceScore * 100)
      : Math.max(0, Math.min(100, Math.round(parsed.contactConfidence || parsed.confidence || (hasRealEmail ? 70 : 30))));

    return {
      decisionMakerName: contactName,
      decisionMakerTitle: normalizeNullable(parsed.contactRole),
      decisionMakerEmail: hasRealEmail ? contactEmail : null,
      contactPhone,
      contactFormUrl,
      contactConfidence: scoreInt,
      contactSourceUrl: normalizeNullable(parsed.contactSourceUrl || parsed.sourceUrl) || null,
      contactSourceTitle: normalizeNullable(parsed.contactSourceTitle) || null,
      contactSourceSnippet: normalizeNullable(parsed.contactSourceSnippet) || null,
      contactDiscoveryMethod,
      contactConfidenceScore,
      contactQuality,
      contactSourceType,
      verificationStatus,
      enrichmentExplanation: parsed.enrichmentExplanation || (hasRealEmail ? "Email found via live web search." : "Partial contact info found — no email available."),
      alternativeContacts,
      partial: !hasRealEmail,
    };
  }

  // Build search queries — most targeted first
  const websitePart = websiteUrl ? `Website: ${websiteUrl}.` : "";
  const domainPart = websiteUrl ? websiteUrl.replace(/^https?:\/\//, "").split("/")[0] : "";
  const searchInput = `You are a B2B contact researcher. Search the web RIGHT NOW to find contact information for this sports organization.

Organization: ${prospectName}
Type: ${organizationType}
Sport: ${sport}
Location: ${city}, ${state}
${websitePart}

STEP 1 — Run ALL of these searches (do not skip any):
1. ${websiteUrl ? `Visit ${websiteUrl}/contact — look for email, phone, staff names` : `Search: "${prospectName} ${city} ${state} contact"`}
2. ${websiteUrl ? `Visit ${websiteUrl}/staff and ${websiteUrl}/about` : `Search: "${prospectName} ${sport} staff directory"`}
3. Search: "${prospectName} ${city} ${state} email"
4. Search: "${prospectName} ${sport} coach director email"
5. ${domainPart ? `Search: site:${domainPart} email contact` : `Search: "${prospectName}" "@" email`}
6. Search: "${prospectName} ${city}" site:facebook.com — Facebook pages often list email in the About section
7. Search: "${prospectName} ${sport}" site:maxpreps.com OR site:sportsengine.com OR site:teamsnap.com — sports directories list coach contacts
8. Search: "${prospectName} ${state} ${sport} coach" site:linkedin.com

STEP 2 — Capture everything you find:
- Email addresses (personal or general inbox)
- Phone numbers
- Staff/coach names and titles
- The URL where you found each piece of info

EMAIL RULES:
- You MAY report a personal email (coach@gmail.com, jsmith@schooldistrict.edu) if you see it on any page.
- You MAY report a general/role-based inbox (info@, contact@, athletics@, office@) if it is EXPLICITLY LISTED on a page you fetched.
- Do NOT construct or guess email addresses — only report what you literally see in text.
- If you find only a general inbox, set contactQuality to "role_based".
- If you cannot find any email after all searches, set foundRealEmail to false.

PHONE RULES:
- Always capture phone numbers if visible — even when no email is found.

STEP 3 — Return ONLY this JSON (no markdown, no explanation):
{
  "foundRealEmail": boolean,
  "contactName": string | null,
  "contactRole": string | null,
  "contactEmail": string | null,
  "contactPhone": string | null,
  "contactFormUrl": string | null,
  "contactQuality": "decision_maker" | "role_based" | "general" | "missing",
  "contactSourceType": "website" | "social" | "directory" | "search_result" | null,
  "verificationStatus": "verified" | "unverified" | null,
  "contactSourceUrl": string | null,
  "contactSourceTitle": string | null,
  "contactSourceSnippet": string | null,
  "contactDiscoveryMethod": "website_contact_page" | "website_staff_page" | "athletics_page" | "directory_listing" | "social_profile" | "search_result" | null,
  "contactConfidenceScore": number | null,
  "enrichmentExplanation": string,
  "alternativeContacts": []
}

Confidence score guide:
- 1.00 = personal email explicitly on official contact/staff page
- 0.90 = personal email on athletics or team directory
- 0.80 = personal email on directory listing site
- 0.75 = general inbox (info@/contact@) explicitly listed on official page
- 0.70 = email on social profile or search snippet
- 0.60 = general inbox from search result snippet`;

  // Phase 1: Live web search via Responses API (60-second timeout)
  try {
    const enrichSearchPromise = (openai as any).responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: searchInput,
    });
    const enrichTimeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("web_search_timeout")), 60000)
    );
    const webResponse = await Promise.race([enrichSearchPromise, enrichTimeoutPromise]);

    const rawText: string = webResponse.output_text || "";
    console.log(`[EnrichContact] Web search raw output for ${prospectName}:`, rawText.slice(0, 300));

    // Extract JSON block from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const result = parseEnrichedResult(parsed);
      if (result) {
        console.log(`[EnrichContact] Found real email for ${prospectName}: ${result.decisionMakerEmail} (confidence: ${result.contactConfidenceScore})`);
        return result;
      }
    }
    console.log(`[EnrichContact] No real email found via web search for ${prospectName}`);
  } catch (err: any) {
    console.error("[EnrichContact] Web search failed:", err?.message || err);

    // Phase 2: Fallback to chat completions if Responses API fails
    try {
      const fallbackResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a contact researcher. Only report emails you have seen in your training data for this specific organization. Never invent or construct email addresses. If you don't know a real email, return foundRealEmail: false.`,
          },
          {
            role: "user",
            content: `Do you have a known, real contact email for "${prospectName}" located in ${city}, ${state}? This is a ${organizationType} for ${sport}.${websiteUrl ? ` Their website is ${websiteUrl}.` : ""}

Return ONLY JSON:
{
  "foundRealEmail": boolean,
  "contactName": string | null,
  "contactRole": string | null,
  "contactEmail": string | null,
  "contactQuality": "decision_maker" | "role_based" | "general" | "missing",
  "contactSourceType": "website" | "search_result" | null,
  "verificationStatus": "unverified",
  "contactSourceUrl": null,
  "contactSourceTitle": null,
  "contactSourceSnippet": null,
  "contactDiscoveryMethod": "search_result",
  "contactConfidenceScore": 0.60,
  "enrichmentExplanation": string | null,
  "alternativeContacts": []
}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 400,
      });

      const raw2 = fallbackResponse.choices[0].message.content || "{}";
      const cleaned2 = raw2.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed2 = JSON.parse(cleaned2);
      const fallbackResult = parseEnrichedResult(parsed2);
      if (fallbackResult) return fallbackResult;
    } catch (fallbackErr) {
      console.error("[EnrichContact] Fallback also failed:", fallbackErr);
    }
  }

  return emptyEnrichment();
}
