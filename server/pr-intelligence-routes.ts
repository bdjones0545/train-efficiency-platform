import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import crypto from "crypto";
import { z } from "zod";
import OpenAI from "openai";
import {
  orgUsers,
  orgMemberships,
  orgSessions,
  prLiftTypes,
  prLiftEntries,
  prAgentResearchJobs,
  athletePublicProfiles,
  athleteAiSummaries,
} from "@shared/schema";
import { eq, and, desc, inArray, gt } from "drizzle-orm";

function getOpenAI() {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!key) throw new Error("OpenAI API key not configured");
  return new OpenAI({ apiKey: key });
}

async function requireOrgAuth(req: any, res: Response, next: NextFunction) {
  const token = req.headers["x-org-auth-token"] as string;
  if (!token) return res.status(401).json({ message: "Not authenticated" });

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();

  const sessions = await db
    .select()
    .from(orgSessions)
    .where(and(eq(orgSessions.tokenHash, tokenHash), gt(orgSessions.expiresAt, now)))
    .limit(1);

  if (!sessions.length) return res.status(401).json({ message: "Session expired. Please log in again." });

  const session = sessions[0];
  await db.update(orgSessions).set({ lastUsedAt: now }).where(eq(orgSessions.id, session.id));

  const foundUsers = await db.select().from(orgUsers).where(eq(orgUsers.id, session.userId)).limit(1);
  if (!foundUsers.length) return res.status(401).json({ message: "User not found" });

  const memberships = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, session.userId), eq(orgMemberships.orgId, session.orgId)))
    .limit(1);

  req.orgUser = foundUsers[0];
  req.orgSession = session;
  req.orgMembership = memberships[0] || null;
  next();
}

function requireCoach(req: any, res: Response, next: NextFunction) {
  if (!req.orgMembership || req.orgMembership.role !== "coach") {
    return res.status(403).json({ message: "Coach access required" });
  }
  next();
}

async function getAthleteContext(orgId: string, athleteUserId: string) {
  const [membership] = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, athleteUserId), eq(orgMemberships.orgId, orgId)))
    .limit(1);

  if (!membership) return null;

  const [athlete] = await db.select().from(orgUsers).where(eq(orgUsers.id, athleteUserId)).limit(1);
  if (!athlete) return null;

  const liftTypes = await db.select().from(prLiftTypes).where(eq(prLiftTypes.orgId, orgId));
  const liftTypeMap: Record<string, { name: string; unit: string }> = {};
  liftTypes.forEach((lt) => { liftTypeMap[lt.id] = { name: lt.name, unit: lt.unit }; });

  const entries = await db
    .select()
    .from(prLiftEntries)
    .where(and(eq(prLiftEntries.userId, athleteUserId), eq(prLiftEntries.orgId, orgId)))
    .orderBy(desc(prLiftEntries.entryDate));

  const bestByLift: Record<string, { liftName: string; unit: string; bestValue: number; entryCount: number; lastDate: string; firstDate: string; allValues: number[] }> = {};
  for (const e of entries) {
    const lt = liftTypeMap[e.liftTypeId];
    if (!lt) continue;
    if (!bestByLift[e.liftTypeId]) {
      bestByLift[e.liftTypeId] = { liftName: lt.name, unit: lt.unit, bestValue: e.value, entryCount: 0, lastDate: e.entryDate, firstDate: e.entryDate, allValues: [] };
    }
    const rec = bestByLift[e.liftTypeId];
    rec.entryCount++;
    rec.allValues.push(e.value);
    if (e.value > rec.bestValue) rec.bestValue = e.value;
    if (e.entryDate > rec.lastDate) rec.lastDate = e.entryDate;
    if (e.entryDate < rec.firstDate) rec.firstDate = e.entryDate;
  }

  const recentEntries = entries.slice(0, 10).map((e) => ({
    liftName: liftTypeMap[e.liftTypeId]?.name || e.liftTypeId,
    value: e.value,
    unit: liftTypeMap[e.liftTypeId]?.unit || e.unit,
    entryDate: e.entryDate,
    notes: e.notes,
  }));

  return {
    athlete: { id: athlete.id, name: athlete.name, email: athlete.email },
    bestPrs: Object.values(bestByLift),
    recentEntries,
    totalEntries: entries.length,
  };
}

export function registerPrIntelligenceRoutes(app: Express) {
  // ── POST /api/org/coach/athletes/:userId/ai/summary ──────────────────────
  app.post(
    "/api/org/coach/athletes/:userId/ai/summary",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId } = req.params;
        const orgId = req.orgSession.orgId;

        const bodySchema = z.object({
          summaryType: z.enum(["notes", "pr_progress", "player_report", "full_profile"]),
          coachNotes: z.string().optional(),
        });
        const { summaryType, coachNotes } = bodySchema.parse(req.body);

        const ctx = await getAthleteContext(orgId, userId);
        if (!ctx) return res.status(404).json({ message: "Athlete not found" });

        const openai = getOpenAI();
        let prompt = "";
        const athleteName = ctx.athlete.name;

        const prSummaryLines = ctx.bestPrs.map((p) =>
          `  - ${p.liftName}: best ${p.bestValue} ${p.unit} (${p.entryCount} entries, tracked since ${p.firstDate})`
        ).join("\n");

        const recentLines = ctx.recentEntries.slice(0, 5).map((e) =>
          `  - ${e.entryDate}: ${e.liftName} ${e.value} ${e.unit}${e.notes ? ` (${e.notes})` : ""}`
        ).join("\n");

        if (summaryType === "notes") {
          prompt = `You are a coach assistant helping a strength and conditioning coach understand an athlete.

Athlete: ${athleteName}
Total PR entries: ${ctx.totalEntries}

Coach's private notes:
${coachNotes || "(no notes entered yet)"}

PR Data (best lifts):
${prSummaryLines || "  (no PR data yet)"}

Recent entries:
${recentLines || "  (none)"}

Generate a structured coach summary with these sections:
1. **Short Summary** (2-3 sentences overview)
2. **Strengths** (bullet points)
3. **Areas to Monitor** (bullet points)
4. **Recent Progress** (based on PR data)
5. **Suggested Talking Points** for next check-in
6. **Next Check-In Focus**

Be concise, coach-facing, and actionable. Do not make medical claims. Base insights only on the data provided.`;
        } else if (summaryType === "pr_progress") {
          prompt = `You are a coach assistant helping analyze an athlete's performance record data.

Athlete: ${athleteName}
Total entries: ${ctx.totalEntries}

Best lifts (all time):
${prSummaryLines || "  (no PR data yet)"}

Recent 10 entries:
${recentLines || "  (none)"}

Analyze the PR data and provide:
1. **Recent Improvements** (any lift showing upward trend)
2. **Strongest Lifts / Metrics** (relative to what's logged)
3. **Stagnant or Plateau Metrics** (lifts with flat or no recent progress)
4. **Newest PR** (most recently logged)
5. **Best Overall PR** (standout performance)
6. **Possible Next Targets** (suggested milestone goals, coach-facing only)

Keep it factual and coach-facing. Do not over-prescribe training. Do not make medical claims. Only analyze what is in the data.`;
        } else if (summaryType === "player_report") {
          prompt = `You are a coach assistant writing a clean player report blurb for a strength and conditioning athlete.

Athlete: ${athleteName}
Coach notes: ${coachNotes || "(none)"}

Best lifts:
${prSummaryLines || "  (no PR data)"}

Write a clean, professional "Player Report" blurb (3-5 paragraphs) suitable for sharing with team staff or for scouting purposes. Include:
- Athlete overview
- Key performance highlights
- Strength profile
- Areas of development
- Summary statement

Keep it professional, coach-facing, and factual. Do not make medical claims. Base all statements on the data provided.`;
        } else {
          prompt = `You are a coach assistant generating a full athlete profile summary.

Athlete: ${athleteName}
Total PR entries: ${ctx.totalEntries}
Coach notes: ${coachNotes || "(none)"}

Best lifts:
${prSummaryLines || "  (no PR data)"}

Recent entries:
${recentLines || "  (none)"}

Generate a comprehensive athlete profile summary including:
1. **Profile Overview**
2. **Performance Highlights**
3. **Coach Notes Summary**
4. **PR Progress Analysis**
5. **Development Recommendations** (coach-facing only)
6. **Player Report Blurb**

Keep all content factual, professional, and coach-facing. Do not make medical claims.`;
        }

        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You are a professional strength and conditioning coach assistant. Be concise, factual, and data-driven. Never make medical diagnoses or claims. Always keep outputs coach-facing." },
            { role: "user", content: prompt },
          ],
          max_tokens: 1200,
          temperature: 0.5,
        });

        const generatedText = completion.choices[0]?.message?.content || "";

        const [saved] = await db
          .insert(athleteAiSummaries)
          .values({
            orgId,
            athleteUserId: userId,
            coachUserId: req.orgUser.id,
            summaryType,
            sourceSnapshot: {
              bestPrs: ctx.bestPrs,
              totalEntries: ctx.totalEntries,
              coachNotesLength: coachNotes?.length || 0,
              generatedAt: new Date().toISOString(),
            },
            generatedText,
            status: "draft",
          })
          .returning();

        res.json({ summary: saved });
      } catch (err: any) {
        console.error("AI summary error:", err);
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── POST /api/org/coach/athletes/:userId/ai/research ─────────────────────
  app.post(
    "/api/org/coach/athletes/:userId/ai/research",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId } = req.params;
        const orgId = req.orgSession.orgId;

        const bodySchema = z.object({
          athleteName: z.string().min(1),
          school: z.string().optional(),
          team: z.string().optional(),
          sport: z.string().optional(),
          graduationYear: z.string().optional(),
          location: z.string().optional(),
        });
        const query = bodySchema.parse(req.body);

        const [ctx] = await db.select().from(orgUsers).where(eq(orgUsers.id, userId)).limit(1);
        if (!ctx) return res.status(404).json({ message: "Athlete not found" });

        const [job] = await db
          .insert(prAgentResearchJobs)
          .values({
            orgId,
            athleteUserId: userId,
            coachUserId: req.orgUser.id,
            status: "running",
            query,
          })
          .returning();

        // Run research async
        runPublicResearch(job.id, orgId, userId, req.orgUser.id, query).catch((e) =>
          console.error("Research job failed:", e)
        );

        res.json({ job });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── GET /api/org/coach/athletes/:userId/ai/research-jobs ─────────────────
  app.get(
    "/api/org/coach/athletes/:userId/ai/research-jobs",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId } = req.params;
        const orgId = req.orgSession.orgId;

        const jobs = await db
          .select()
          .from(prAgentResearchJobs)
          .where(and(eq(prAgentResearchJobs.athleteUserId, userId), eq(prAgentResearchJobs.orgId, orgId)))
          .orderBy(desc(prAgentResearchJobs.createdAt))
          .limit(20);

        res.json({ jobs });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── GET /api/org/coach/athletes/:userId/public-profiles ──────────────────
  app.get(
    "/api/org/coach/athletes/:userId/public-profiles",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId } = req.params;
        const orgId = req.orgSession.orgId;

        const profiles = await db
          .select()
          .from(athletePublicProfiles)
          .where(and(eq(athletePublicProfiles.athleteUserId, userId), eq(athletePublicProfiles.orgId, orgId)))
          .orderBy(desc(athletePublicProfiles.createdAt));

        res.json({ profiles });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── PATCH .../public-profile/:profileId/approve ───────────────────────────
  app.patch(
    "/api/org/coach/athletes/:userId/public-profile/:profileId/approve",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId, profileId } = req.params;
        const orgId = req.orgSession.orgId;

        const [updated] = await db
          .update(athletePublicProfiles)
          .set({
            status: "approved",
            approvedByCoachId: req.orgUser.id,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(athletePublicProfiles.id, profileId), eq(athletePublicProfiles.athleteUserId, userId), eq(athletePublicProfiles.orgId, orgId)))
          .returning();

        if (!updated) return res.status(404).json({ message: "Profile not found" });
        res.json({ profile: updated });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── PATCH .../public-profile/:profileId/reject ───────────────────────────
  app.patch(
    "/api/org/coach/athletes/:userId/public-profile/:profileId/reject",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId, profileId } = req.params;
        const orgId = req.orgSession.orgId;

        const [updated] = await db
          .update(athletePublicProfiles)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(and(eq(athletePublicProfiles.id, profileId), eq(athletePublicProfiles.athleteUserId, userId), eq(athletePublicProfiles.orgId, orgId)))
          .returning();

        if (!updated) return res.status(404).json({ message: "Profile not found" });
        res.json({ profile: updated });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── GET /api/org/coach/athletes/:userId/ai/summaries ─────────────────────
  app.get(
    "/api/org/coach/athletes/:userId/ai/summaries",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId } = req.params;
        const orgId = req.orgSession.orgId;

        const summaries = await db
          .select()
          .from(athleteAiSummaries)
          .where(and(eq(athleteAiSummaries.athleteUserId, userId), eq(athleteAiSummaries.orgId, orgId)))
          .orderBy(desc(athleteAiSummaries.createdAt))
          .limit(30);

        res.json({ summaries });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── PATCH /api/org/coach/athletes/:userId/ai/summary/:summaryId ──────────
  app.patch(
    "/api/org/coach/athletes/:userId/ai/summary/:summaryId",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId, summaryId } = req.params;
        const orgId = req.orgSession.orgId;

        const bodySchema = z.object({
          editedText: z.string().optional(),
          status: z.enum(["draft", "approved", "archived"]).optional(),
        });
        const updates = bodySchema.parse(req.body);

        const [updated] = await db
          .update(athleteAiSummaries)
          .set({ ...updates, updatedAt: new Date() })
          .where(and(eq(athleteAiSummaries.id, summaryId), eq(athleteAiSummaries.athleteUserId, userId), eq(athleteAiSummaries.orgId, orgId)))
          .returning();

        if (!updated) return res.status(404).json({ message: "Summary not found" });
        res.json({ summary: updated });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );
}

// ── Background research job ──────────────────────────────────────────────────
async function runPublicResearch(jobId: string, orgId: string, athleteUserId: string, coachUserId: string, query: any) {
  try {
    const openai = getOpenAI();

    const searchTerms = [
      query.athleteName,
      query.school,
      query.team,
      query.sport,
      query.graduationYear,
      query.location,
    ].filter(Boolean).join(" ");

    const researchPrompt = `You are a sports research assistant. Search for publicly available information about this athlete.

Athlete: ${query.athleteName}
${query.school ? `School/Organization: ${query.school}` : ""}
${query.team ? `Team: ${query.team}` : ""}
${query.sport ? `Sport: ${query.sport}` : ""}
${query.graduationYear ? `Graduation Year: ${query.graduationYear}` : ""}
${query.location ? `Location: ${query.location}` : ""}

Search public sources such as MaxPreps, school athletics pages, public roster pages, Hudl public profiles, athletic.net, MileSplit, and other public sports profile pages.

Return a JSON object with this exact structure:
{
  "matches": [
    {
      "sourceName": "MaxPreps" | "School Athletics" | "Hudl" | "athletic.net" | "MileSplit" | "Other",
      "sourceUrl": "https://...",
      "sourceTitle": "Page title or description",
      "confidenceScore": 0.0-1.0,
      "extractedFields": {
        "sport": "...",
        "position": "...",
        "height": "...",
        "weight": "...",
        "classYear": "...",
        "jerseyNumber": "...",
        "school": "...",
        "publicStats": "...",
        "profileLinks": []
      },
      "notes": "Brief explanation of why this might or might not be the right athlete"
    }
  ],
  "searchSummary": "Brief description of what was found",
  "noResultsReason": "If no matches, explain why"
}

IMPORTANT:
- Only return real, publicly accessible URLs
- Set confidenceScore based on how well the result matches the query
- If uncertain, set confidenceScore below 0.5
- Do not fabricate or guess information
- If no matches found, return empty matches array`;

    let resultText = "";
    let resultData: any = { matches: [], searchSummary: "No results found", noResultsReason: "Search returned no results" };

    try {
      const response = await (openai as any).responses.create({
        model: "gpt-4o",
        tools: [{ type: "web_search_preview" }],
        input: researchPrompt,
      });

      resultText = response.output_text || "";
    } catch (webErr) {
      const fallback = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a sports research assistant. Return only valid JSON. Be conservative — only return information you are confident exists publicly." },
          { role: "user", content: researchPrompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1500,
        temperature: 0.2,
      });
      resultText = fallback.choices[0]?.message?.content || "";
    }

    try {
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        resultData = JSON.parse(jsonMatch[0]);
      }
    } catch { /* keep default */ }

    // Save each match as an athletePublicProfile
    const matches: any[] = resultData.matches || [];
    for (const match of matches) {
      if (!match.sourceUrl) continue;
      await db.insert(athletePublicProfiles).values({
        orgId,
        athleteUserId,
        sourceName: match.sourceName || "Unknown",
        sourceUrl: match.sourceUrl,
        sourceTitle: match.sourceTitle || "",
        confidenceScore: Math.min(1, Math.max(0, match.confidenceScore || 0)),
        extractedData: match.extractedFields || {},
        status: "pending_review",
      });
    }

    await db
      .update(prAgentResearchJobs)
      .set({
        status: "completed",
        result: resultData,
        completedAt: new Date(),
      })
      .where(eq(prAgentResearchJobs.id, jobId));
  } catch (err: any) {
    await db
      .update(prAgentResearchJobs)
      .set({ status: "failed", errorMessage: err.message, completedAt: new Date() })
      .where(eq(prAgentResearchJobs.id, jobId));
  }
}
