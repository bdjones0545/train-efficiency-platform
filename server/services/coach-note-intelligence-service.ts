/**
 * Coach Note Intelligence Service (Phase 5 of PAIL)
 *
 * Every coach note is analyzed by AI to extract structured intelligence.
 * Extracted data updates the athlete's persistent memory profile.
 */

import OpenAI from "openai";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  athleteContextObjects,
  athleteMemoryProfiles,
} from "@shared/schema";

const openai = new OpenAI();

export interface CoachNoteIntelligence {
  movementIssues: string[];
  motivationPatterns: string[];
  confidenceIssues: string[];
  technicalWeaknesses: string[];
  recurringThemes: string[];
  coachingCuesThatWork: string[];
  summary: string;
}

export async function analyzeCoachNotesForAthlete(
  athleteUserId: string,
  orgId: string
): Promise<CoachNoteIntelligence | null> {
  // Load latest context object (contains coachNotes JSONB array)
  const [contextObj] = await db.select()
    .from(athleteContextObjects)
    .where(and(
      eq(athleteContextObjects.orgId, orgId),
      eq(athleteContextObjects.athleteUserId, athleteUserId),
    ))
    .orderBy(desc(athleteContextObjects.updatedAt))
    .limit(1)
    .catch(() => []);

  const coachNotes: any[] = (contextObj?.coachNotes as any[]) ?? [];

  if (coachNotes.length === 0) return null;

  const notesText = coachNotes
    .map((n: any, i: number) => `[Note ${i + 1}]: ${n.note ?? n.text ?? JSON.stringify(n)}`)
    .join("\n");

  let intelligence: CoachNoteIntelligence | null = null;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert sports scientist analyzing coach notes to extract structured intelligence about an athlete. Be specific, concise, and evidence-based.`,
        },
        {
          role: "user",
          content: `Analyze the following ${coachNotes.length} coach note(s) and extract structured athlete intelligence.

COACH NOTES:
${notesText}

Return ONLY a valid JSON object with these fields:
{
  "movementIssues": ["e.g. hip flexor tightness on left side", ...],
  "motivationPatterns": ["e.g. needs external accountability", ...],
  "confidenceIssues": ["e.g. hesitant with heavy overhead", ...],
  "technicalWeaknesses": ["e.g. slow first step off line", ...],
  "recurringThemes": ["e.g. fatigue reported frequently on Fridays", ...],
  "coachingCuesThatWork": ["e.g. 'chest tall' cue fixes squat pattern", ...],
  "summary": "1-2 sentence overall summary of what this athlete's coach notes reveal"
}

Use empty arrays if no evidence. Only include items explicitly mentioned or strongly implied.`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
    });

    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
    intelligence = {
      movementIssues: parsed.movementIssues ?? [],
      motivationPatterns: parsed.motivationPatterns ?? [],
      confidenceIssues: parsed.confidenceIssues ?? [],
      technicalWeaknesses: parsed.technicalWeaknesses ?? [],
      recurringThemes: parsed.recurringThemes ?? [],
      coachingCuesThatWork: parsed.coachingCuesThatWork ?? [],
      summary: parsed.summary ?? "",
    };
  } catch (err: any) {
    console.warn("[Coach Note Intelligence] OpenAI failed:", err.message);
    return null;
  }

  // Update memory profile with extracted intelligence
  const [existing] = await db.select({ id: athleteMemoryProfiles.id, technicalFocusAreas: athleteMemoryProfiles.technicalFocusAreas, coachingCuesThatWork: athleteMemoryProfiles.coachingCuesThatWork, recurringCompensations: athleteMemoryProfiles.recurringCompensations })
    .from(athleteMemoryProfiles)
    .where(and(
      eq(athleteMemoryProfiles.orgId, orgId),
      eq(athleteMemoryProfiles.athleteUserId, athleteUserId),
    ))
    .limit(1)
    .catch(() => []);

  const allTechnical = [
    ...(existing?.technicalFocusAreas as string[] ?? []),
    ...intelligence.technicalWeaknesses,
    ...intelligence.movementIssues,
  ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 20);

  const allCues = [
    ...(existing?.coachingCuesThatWork as string[] ?? []),
    ...intelligence.coachingCuesThatWork,
  ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 20);

  if (existing) {
    await db.update(athleteMemoryProfiles)
      .set({
        technicalFocusAreas: allTechnical as any,
        coachingCuesThatWork: allCues as any,
        coachNotesSummary: intelligence.summary,
        lastCoachNoteAnalyzedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(athleteMemoryProfiles.id, existing.id))
      .catch(() => {});
  } else {
    await db.insert(athleteMemoryProfiles)
      .values({
        orgId,
        athleteUserId,
        technicalFocusAreas: allTechnical as any,
        coachingCuesThatWork: allCues as any,
        coachNotesSummary: intelligence.summary,
        lastCoachNoteAnalyzedAt: new Date(),
      })
      .catch(() => {});
  }

  return intelligence;
}
