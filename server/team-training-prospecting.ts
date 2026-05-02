import OpenAI from "openai";
import { storage } from "./storage";
import type { Organization } from "@shared/schema";

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

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
}

export async function researchProspects(
  org: Organization,
  sportFilter?: string,
  limit: number = 10
): Promise<ProspectResult[]> {
  const openai = getOpenAI();

  const orgCity = (org as any).city || "";
  const orgState = (org as any).state || "";
  const serviceRadius = (org as any).serviceRadius || "25";
  const specialties = (org as any).specialties || "speed, strength, agility, performance training";

  const locationHint = [orgCity, orgState].filter(Boolean).join(", ") || "the local area";
  const sportContext = sportFilter
    ? `Focus specifically on ${sportFilter} organizations.`
    : `Cover a variety of sports including youth football, basketball, soccer, volleyball, baseball, lacrosse, wrestling, track & field, swim teams, cheer programs, and martial arts gyms.`;

  const systemPrompt = `You are a lead research assistant for a sports performance training business. Your job is to identify realistic, plausible local sports organizations that would be good team training leads.

IMPORTANT RULES:
- Never invent specific contact emails or phone numbers. Use null for unknown contact info.
- Use "unknown" for any field you cannot reliably determine.
- Only include websiteUrl if you have a real, known URL for this type of organization.
- Set sourceUrl to a plausible search URL (e.g. a Google search link) so the admin can verify.
- Be honest about confidence. Score 80+ only if you have strong reason the org exists in that area.
- Generate diverse organization types: youth teams, high school programs, club teams, AAU, travel ball, academies.
- Keep notes concise: explain why this prospect is relevant to the training business.`;

  const userPrompt = `Research up to ${limit} local sports organizations near ${locationHint} (within ~${serviceRadius} miles) that would be strong leads for team training services: ${specialties}.

${sportContext}

Return a JSON array of prospects. Each object must have:
- prospectName: string (name of team/club/school program)
- organizationType: string (e.g. "Youth Club", "High School Program", "AAU Team", "Travel Ball", "Martial Arts Gym", etc.)
- sport: string (e.g. "Football", "Soccer", "Basketball", "Baseball", "Volleyball", "Lacrosse", "Wrestling", "Cheer", "Swimming", "Martial Arts")
- city: string
- state: string (2-letter abbreviation)
- websiteUrl: string | null
- contactName: string (use "unknown" if not known)
- contactRole: string (use "unknown" if not known; e.g. "Head Coach", "Athletic Director", "Program Director")
- contactEmail: null (never guess emails)
- contactPhone: null (never guess phones)
- sourceUrl: string | null (plausible Google search URL to find this org)
- confidenceScore: number 1-100 (how confident you are this org exists in this area)
- notes: string (1-2 sentences: why this is a good team training prospect)

Return only the JSON array. No markdown, no extra text.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 3000,
  });

  const raw = response.choices[0].message.content || "[]";
  let parsed: ProspectResult[] = [];
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) parsed = [];
  } catch {
    console.error("[ProspectResearch] Failed to parse OpenAI response:", raw);
    parsed = [];
  }

  parsed = parsed.map((p) => ({
    ...p,
    contactEmail: null,
    contactPhone: p.contactPhone || null,
    confidenceScore: Math.max(1, Math.min(100, Math.round(p.confidenceScore || 50))),
  }));

  return parsed;
}

export interface EmailDraftParams {
  businessName: string;
  coachName: string;
  prospectName: string;
  sport: string;
  city: string;
  contactName: string;
  services?: string[];
}

export async function generateOutreachEmailFromVariant(
  params: EmailDraftParams,
  variant: { subjectTemplate: string; bodyTemplate: string }
): Promise<{ subject: string; body: string }> {
  const openai = getOpenAI();

  const prompt = `You are personalizing an outreach email template for a sports performance training business.

Fill in the template below using the provided context. Replace any placeholder tokens like {businessName}, {coachName}, {prospectName}, {sport}, {city}, {contactName} with the actual values. Keep the tone and style of the template intact. Do not add or remove significant content beyond the substitutions and minor natural-language polish.

Context:
Business: ${params.businessName}
Coach/Owner: ${params.coachName}
Prospect Team/Club: ${params.prospectName}
Sport: ${params.sport}
Location: ${params.city}
Contact Name: ${params.contactName !== "unknown" ? params.contactName : "Coach/Director"}

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

  const prompt = `Write a professional, local, direct outreach email (not spammy) for a sports performance training business reaching out to a local sports team.

Business: ${params.businessName}
Coach/Owner: ${params.coachName}
Prospect Team/Club: ${params.prospectName}
Sport: ${params.sport}
Location: ${params.city}
Contact Name: ${params.contactName !== "unknown" ? params.contactName : "Coach/Director"}
Available Services: ${servicesList}

Rules:
- Professional and respectful tone. Not pushy or salesy.
- Keep it under 200 words.
- Mention the team name and sport.
- Mention 3-4 specific services.
- End with a simple, low-pressure call to action (open to a quick conversation).
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
  if (prospect.contactEmail) score = Math.min(100, score + 15);
  if (prospect.contactName && prospect.contactName !== "unknown") score = Math.min(100, score + 5);
  if (prospect.websiteUrl) score = Math.min(100, score + 5);
  if (prospect.sport && prospect.sport !== "unknown") score = Math.min(100, score + 5);
  return Math.round(score);
}
