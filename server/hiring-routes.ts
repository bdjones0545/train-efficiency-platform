/**
 * Hiring Department — API Routes
 * All routes registered inside registerHiringRoutes()
 * which is called from server/routes.ts registerRoutes().
 */

import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { assessCandidate, getAssessmentsForOrg } from "./services/hiring-assessment-agent";
import { generateOutreachDraft, getOutreachDraftsForOrg } from "./services/hiring-outreach-agent";
import { computeHiringLearningMetrics, generateHiringInsights } from "./services/hiring-learning-agent";
import {
  generateHiringBestAction,
  generateHiringExecutiveBrief,
  generateHiringRecommendations,
  runHiringExecutiveAnalysis,
} from "./services/hiring-executive-agent";

function rows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}
function n(v: any): number { return Number(v ?? 0); }

function getOrgId(req: any): string {
  return req.user?.claims?.org_id ?? req.user?.orgId ?? "demo-org";
}

export function registerHiringRoutes(
  app: Express,
  isAuthenticated: any,
  requireRole: any,
): void {

  // ── Candidates ─────────────────────────────────────────────────────────────

  // GET /api/hiring/candidates
  app.get("/api/hiring/candidates", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const result = await db.execute(sql`
        SELECT * FROM hiring_candidates
        WHERE org_id = ${orgId}
        ORDER BY created_at DESC
        LIMIT 200
      `);
      res.json(rows(result));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/hiring/candidates
  app.post("/api/hiring/candidates", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const {
        firstName, lastName, email, phone, location,
        position, source, experienceLevel, resumeUrl, notes,
      } = req.body;

      if (!firstName || !lastName || !position) {
        return res.status(400).json({ error: "firstName, lastName, and position are required" });
      }

      const result = await db.execute(sql`
        INSERT INTO hiring_candidates
          (org_id, first_name, last_name, email, phone, location,
           position, source, experience_level, resume_url, notes)
        VALUES (
          ${orgId}, ${firstName}, ${lastName}, ${email ?? null}, ${phone ?? null},
          ${location ?? null}, ${position}, ${source ?? "manual"},
          ${experienceLevel ?? "mid"}, ${resumeUrl ?? null}, ${notes ?? null}
        )
        RETURNING *
      `);
      res.json(rows(result)[0] ?? {});
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/hiring/candidates/:id/status
  app.patch("/api/hiring/candidates/:id/status", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { id } = req.params;
      const { status } = req.body;
      const validStatuses = ["new","qualified","outreach_ready","contacted","interested","interview","offer","hired","rejected"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      await db.execute(sql`
        UPDATE hiring_candidates SET status = ${status}, updated_at = NOW()
        WHERE id = ${id} AND org_id = ${orgId}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/hiring/candidates/:id
  app.delete("/api/hiring/candidates/:id", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      await db.execute(sql`
        DELETE FROM hiring_candidates WHERE id = ${req.params.id} AND org_id = ${orgId}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Assessments ────────────────────────────────────────────────────────────

  // POST /api/hiring/candidates/:id/assess
  app.post("/api/hiring/candidates/:id/assess", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const result = await assessCandidate(orgId, req.params.id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/hiring/assessments
  app.get("/api/hiring/assessments", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const result = await getAssessmentsForOrg(orgId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Outreach ───────────────────────────────────────────────────────────────

  // POST /api/hiring/candidates/:id/outreach
  app.post("/api/hiring/candidates/:id/outreach", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { outreachType } = req.body;
      const result = await generateOutreachDraft(orgId, req.params.id, outreachType ?? "interview_invitation");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/hiring/outreach
  app.get("/api/hiring/outreach", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const result = await getOutreachDraftsForOrg(orgId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Pipeline ───────────────────────────────────────────────────────────────

  // GET /api/hiring/pipeline
  app.get("/api/hiring/pipeline", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const result = await db.execute(sql`
        SELECT * FROM hiring_candidates
        WHERE org_id = ${orgId}
        ORDER BY fit_score DESC, created_at DESC
        LIMIT 500
      `);
      const candidates = rows(result);
      const pipeline: Record<string, any[]> = {
        new: [], qualified: [], outreach_ready: [], contacted: [],
        interested: [], interview: [], offer: [], hired: [], rejected: [],
      };
      for (const c of candidates) {
        const s = c.status ?? "new";
        if (pipeline[s]) pipeline[s].push(c);
        else pipeline.new.push(c);
      }
      res.json(pipeline);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Interviews ─────────────────────────────────────────────────────────────

  // POST /api/hiring/candidates/:id/interview
  app.post("/api/hiring/candidates/:id/interview", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { scheduledAt, notes } = req.body;
      const result = await db.execute(sql`
        INSERT INTO hiring_interviews (org_id, candidate_id, scheduled_at, notes)
        VALUES (${orgId}, ${req.params.id}, ${scheduledAt ?? null}, ${notes ?? null})
        RETURNING *
      `);
      // Advance candidate status
      await db.execute(sql`
        UPDATE hiring_candidates SET status = 'interview', updated_at = NOW()
        WHERE id = ${req.params.id} AND org_id = ${orgId}
      `);
      res.json(rows(result)[0] ?? {});
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Learning ───────────────────────────────────────────────────────────────

  // GET /api/hiring/learning
  app.get("/api/hiring/learning", isAuthenticated, async (req, res) => {
    try {
      const orgId   = getOrgId(req);
      const [metrics, insights] = await Promise.all([
        computeHiringLearningMetrics(orgId),
        generateHiringInsights(orgId),
      ]);
      res.json({ metrics, insights });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Executive Intelligence ─────────────────────────────────────────────────

  // GET /api/hiring/executive
  app.get("/api/hiring/executive", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const [briefs, recs, bestAction] = await Promise.all([
        db.execute(sql`
          SELECT * FROM hiring_executive_briefs WHERE org_id = ${orgId}
          ORDER BY created_at DESC LIMIT 1
        `).then(rows),
        db.execute(sql`
          SELECT * FROM hiring_recommendations WHERE org_id = ${orgId}
          ORDER BY created_at DESC LIMIT 20
        `).then(rows),
        generateHiringBestAction(orgId),
      ]);
      res.json({ brief: briefs[0] ?? null, recommendations: recs, bestAction });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/hiring/executive/run
  app.post("/api/hiring/executive/run", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const result = await runHiringExecutiveAnalysis(orgId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/hiring/recommendations
  app.get("/api/hiring/recommendations", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const result = await db.execute(sql`
        SELECT * FROM hiring_recommendations WHERE org_id = ${orgId}
        ORDER BY created_at DESC LIMIT 50
      `);
      res.json(rows(result));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/hiring/recommendations/:id
  app.patch("/api/hiring/recommendations/:id", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const { status } = req.body;
      await db.execute(sql`
        UPDATE hiring_recommendations
        SET status = ${status}, reviewed_at = NOW()
        WHERE id = ${req.params.id} AND org_id = ${orgId}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/hiring/heartbeat-summary
  app.get("/api/hiring/heartbeat-summary", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { hiringDepartmentCoordinator } = await import("./services/hiring-department-coordinator");
      const summary = await hiringDepartmentCoordinator.generateSummary(orgId);
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
