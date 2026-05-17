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
  athleteExternalAssets,
} from "@shared/schema";
import { eq, and, desc, gt } from "drizzle-orm";

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
  // Pull approved public data for context
  const approvedProfiles = await db
    .select()
    .from(athletePublicProfiles)
    .where(and(eq(athletePublicProfiles.athleteUserId, athleteUserId), eq(athletePublicProfiles.orgId, orgId), eq(athletePublicProfiles.status, "approved")));
  const approvedAssets = await db
    .select()
    .from(athleteExternalAssets)
    .where(and(eq(athleteExternalAssets.athleteUserId, athleteUserId), eq(athleteExternalAssets.orgId, orgId), eq(athleteExternalAssets.status, "approved")));
  return {
    athlete: { id: athlete.id, name: athlete.name, email: athlete.email },
    bestPrs: Object.values(bestByLift),
    recentEntries,
    totalEntries: entries.length,
    approvedProfiles,
    approvedAssets,
  };
}

export function registerPrIntelligenceRoutes(app: Express) {

  // ── POST /api/org/coach/athletes/:userId/ai/summary ───────────────────────
  app.post(
    "/api/org/coach/athletes/:userId/ai/summary",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId } = req.params;
        const orgId = req.orgSession.orgId;
        const bodySchema = z.object({
          summaryType: z.enum(["notes", "pr_progress", "player_report", "recruiting_snapshot", "full_profile"]),
          coachNotes: z.string().optional(),
        });
        const { summaryType, coachNotes } = bodySchema.parse(req.body);
        const ctx = await getAthleteContext(orgId, userId);
        if (!ctx) return res.status(404).json({ message: "Athlete not found" });
        const openai = getOpenAI();
        const athleteName = ctx.athlete.name;

        const prLines = ctx.bestPrs.map((p) =>
          `  - ${p.liftName}: best ${p.bestValue} ${p.unit} (${p.entryCount} entries, since ${p.firstDate})`
        ).join("\n");

        const recentLines = ctx.recentEntries.slice(0, 5).map((e) =>
          `  - ${e.entryDate}: ${e.liftName} ${e.value} ${e.unit}${e.notes ? ` (${e.notes})` : ""}`
        ).join("\n");

        const approvedPublicData = ctx.approvedProfiles.map((p: any) =>
          `  Source: ${p.sourceName} | ${p.sourceTitle}\n  Data: ${JSON.stringify(p.extractedData || {})}`
        ).join("\n");

        const approvedMedia = ctx.approvedAssets.map((a: any) =>
          `  ${a.sourceType.toUpperCase()}: ${a.title || a.sourceUrl} | ${a.sourceUrl}`
        ).join("\n");

        let prompt = "";
        const systemMsg = "You are a professional strength and conditioning coach assistant. Be concise, factual, and data-driven. Never make medical diagnoses or claims. Always keep outputs coach-facing. Distinguish confirmed data from possible estimates.";

        if (summaryType === "notes") {
          prompt = `Athlete: ${athleteName}
Coach notes: ${coachNotes || "(none)"}
PR data:
${prLines || "  (none)"}
Recent entries:
${recentLines || "  (none)"}

Generate a structured coach summary with these sections:
1. **Short Summary** (2-3 sentences)
2. **Strengths** (bullets)
3. **Areas to Monitor** (bullets)
4. **Recent Progress**
5. **Suggested Talking Points**
6. **Next Check-In Focus**

Be concise, actionable, coach-facing. No medical claims.`;

        } else if (summaryType === "pr_progress") {
          prompt = `Athlete: ${athleteName} | Total entries: ${ctx.totalEntries}
Best lifts:
${prLines || "  (none)"}
Recent 10 entries:
${recentLines || "  (none)"}

Analyze PR data and provide:
1. **Recent Improvements**
2. **Strongest Lifts**
3. **Stagnant / Plateau Metrics**
4. **Newest PR**
5. **Best Overall PR**
6. **Possible Next Targets** (coach-facing only)

Factual, coach-facing only. No medical claims.`;

        } else if (summaryType === "player_report") {
          prompt = `Athlete: ${athleteName}
Coach notes: ${coachNotes || "(none)"}
Best lifts:
${prLines || "  (none)"}
${approvedPublicData ? `Approved public profile data:\n${approvedPublicData}` : ""}
${approvedMedia ? `Approved media/highlights:\n${approvedMedia}` : ""}

Write a clean, professional "Player Report" blurb (3-5 paragraphs) for sharing with team staff or scouting. Include:
- Athlete overview
- Key performance highlights
- Strength profile
- Areas of development
- Summary statement
${approvedMedia ? "- Highlight media references" : ""}

Professional, factual, no medical claims.`;

        } else if (summaryType === "recruiting_snapshot") {
          prompt = `Athlete: ${athleteName}
Coach notes: ${coachNotes || "(none)"}
Strength & performance data:
${prLines || "  (none)"}
${approvedPublicData ? `Approved public profile (verified by coach):\n${approvedPublicData}` : ""}
${approvedMedia ? `Approved media/highlights:\n${approvedMedia}` : ""}

Write a recruiting-style athlete snapshot with these sections:
1. **Athlete Overview** (name, school if known, sport, position if available)
2. **Physical Profile** (any available height/weight/size data — label as public or estimated)
3. **Athletic Strengths** (based on PR data and notes)
4. **Key Performance Metrics** (best lifts and athletic scores)
5. **Highlight Media** (list approved links)
6. **Development Areas** (honest, coach-facing)
7. **Recruiting Summary** (1-2 sentence headline blurb)

Label what is confirmed vs. approximate. No fabrication. No medical claims. Coach-facing only.`;

        } else {
          prompt = `Athlete: ${athleteName} | Total entries: ${ctx.totalEntries}
Coach notes: ${coachNotes || "(none)"}
Best lifts:
${prLines || "  (none)"}
${approvedPublicData ? `Approved public data:\n${approvedPublicData}` : ""}

Generate a comprehensive full athlete profile:
1. **Profile Overview**
2. **Performance Highlights**
3. **Coach Notes Summary**
4. **PR Progress Analysis**
5. **Public Profile Context** (if available)
6. **Development Recommendations** (coach-facing)
7. **Player Report Blurb**

Factual, coach-facing, no medical claims.`;
        }

        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemMsg },
            { role: "user", content: prompt },
          ],
          max_tokens: 1400,
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
              approvedProfileCount: ctx.approvedProfiles.length,
              approvedAssetCount: ctx.approvedAssets.length,
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
          position: z.string().optional(),
        });
        const query = bodySchema.parse(req.body);
        const [athlete] = await db.select().from(orgUsers).where(eq(orgUsers.id, userId)).limit(1);
        if (!athlete) return res.status(404).json({ message: "Athlete not found" });
        const [job] = await db
          .insert(prAgentResearchJobs)
          .values({ orgId, athleteUserId: userId, coachUserId: req.orgUser.id, status: "running", query })
          .returning();
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
          .set({ status: "approved", approvedByCoachId: req.orgUser.id, approvedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(athletePublicProfiles.id, profileId), eq(athletePublicProfiles.athleteUserId, userId), eq(athletePublicProfiles.orgId, orgId)))
          .returning();
        if (!updated) return res.status(404).json({ message: "Profile not found" });
        res.json({ profile: updated });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── PATCH .../public-profile/:profileId/reject ────────────────────────────
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

  // ── GET /api/org/coach/athletes/:userId/external-assets ──────────────────
  app.get(
    "/api/org/coach/athletes/:userId/external-assets",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId } = req.params;
        const orgId = req.orgSession.orgId;
        const assets = await db
          .select()
          .from(athleteExternalAssets)
          .where(and(eq(athleteExternalAssets.athleteUserId, userId), eq(athleteExternalAssets.orgId, orgId)))
          .orderBy(desc(athleteExternalAssets.createdAt));
        res.json({ assets });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── PATCH .../external-asset/:assetId/approve ─────────────────────────────
  app.patch(
    "/api/org/coach/athletes/:userId/external-asset/:assetId/approve",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId, assetId } = req.params;
        const orgId = req.orgSession.orgId;
        const [updated] = await db
          .update(athleteExternalAssets)
          .set({ status: "approved", approvedByCoachId: req.orgUser.id, approvedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(athleteExternalAssets.id, assetId), eq(athleteExternalAssets.athleteUserId, userId), eq(athleteExternalAssets.orgId, orgId)))
          .returning();
        if (!updated) return res.status(404).json({ message: "Asset not found" });
        res.json({ asset: updated });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── PATCH .../external-asset/:assetId/reject ──────────────────────────────
  app.patch(
    "/api/org/coach/athletes/:userId/external-asset/:assetId/reject",
    requireOrgAuth,
    requireCoach,
    async (req: any, res) => {
      try {
        const { userId, assetId } = req.params;
        const orgId = req.orgSession.orgId;
        const [updated] = await db
          .update(athleteExternalAssets)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(and(eq(athleteExternalAssets.id, assetId), eq(athleteExternalAssets.athleteUserId, userId), eq(athleteExternalAssets.orgId, orgId)))
          .returning();
        if (!updated) return res.status(404).json({ message: "Asset not found" });
        res.json({ asset: updated });
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

    const researchPrompt = `You are a sports research assistant. Search for ALL publicly available information about this athlete.

Athlete: ${query.athleteName}
${query.school ? `School/Organization: ${query.school}` : ""}
${query.team ? `Team: ${query.team}` : ""}
${query.sport ? `Sport: ${query.sport}` : ""}
${query.position ? `Position: ${query.position}` : ""}
${query.graduationYear ? `Graduation Year: ${query.graduationYear}` : ""}
${query.location ? `Location: ${query.location}` : ""}

Search public sources: MaxPreps, Hudl public profiles, school athletics pages, athletic.net, MileSplit, YouTube highlights, recruiting pages, public stat pages, public rosters.

Return a JSON object with this EXACT structure:
{
  "publicProfiles": [
    {
      "sourceName": "MaxPreps|Hudl|School Athletics|athletic.net|MileSplit|Recruiting|Other",
      "sourceUrl": "https://...",
      "sourceTitle": "Page title",
      "confidenceScore": 0.0-1.0,
      "extractedFields": {
        "sport": "",
        "position": "",
        "height": "",
        "weight": "",
        "classYear": "",
        "jerseyNumber": "",
        "school": "",
        "recruitingTags": ""
      },
      "notes": "Why this matches or might not"
    }
  ],
  "externalAssets": [
    {
      "sourceType": "hudl|youtube|maxpreps|roster|recruiting|stats|image",
      "sourceUrl": "https://...",
      "title": "Description of this asset",
      "thumbnailUrl": null,
      "confidenceScore": 0.0-1.0,
      "metadata": {
        "platform": "",
        "description": "",
        "statsContext": "",
        "season": "",
        "eventName": ""
      }
    }
  ],
  "searchSummary": "Brief description of what was found",
  "noResultsReason": ""
}

RULES:
- Only return real, publicly accessible URLs you actually found
- Set confidenceScore based on match quality — be conservative
- Do NOT fabricate URLs or invent stats
- If something is uncertain, set confidence below 0.5
- External assets: include Hudl highlight reels, YouTube game film, MaxPreps stat pages, public roster pages, recruiting profile pages
- Return empty arrays if nothing found`;

    let resultText = "";
    let resultData: any = { publicProfiles: [], externalAssets: [], searchSummary: "No results found", noResultsReason: "Search returned no results" };

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
          { role: "system", content: "You are a sports research assistant. Return only valid JSON. Be conservative — only return URLs you are confident actually exist publicly. Never fabricate." },
          { role: "user", content: researchPrompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 2000,
        temperature: 0.2,
      });
      resultText = fallback.choices[0]?.message?.content || "";
    }

    try {
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (jsonMatch) resultData = JSON.parse(jsonMatch[0]);
    } catch { /* keep default */ }

    // Save public profiles
    const profiles: any[] = resultData.publicProfiles || resultData.matches || [];
    for (const match of profiles) {
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

    // Save external assets
    const assets: any[] = resultData.externalAssets || [];
    for (const asset of assets) {
      if (!asset.sourceUrl) continue;
      await db.insert(athleteExternalAssets).values({
        orgId,
        athleteUserId,
        sourceType: asset.sourceType || "other",
        sourceUrl: asset.sourceUrl,
        title: asset.title || "",
        thumbnailUrl: asset.thumbnailUrl || null,
        extractedMetadata: asset.metadata || {},
        confidenceScore: Math.min(1, Math.max(0, asset.confidenceScore || 0)),
        status: "pending_review",
      });
    }

    await db
      .update(prAgentResearchJobs)
      .set({ status: "completed", result: resultData, completedAt: new Date() })
      .where(eq(prAgentResearchJobs.id, jobId));

  } catch (err: any) {
    await db
      .update(prAgentResearchJobs)
      .set({ status: "failed", errorMessage: err.message, completedAt: new Date() })
      .where(eq(prAgentResearchJobs.id, jobId));
  }
}
