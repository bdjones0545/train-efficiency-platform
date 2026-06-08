/**
 * Sponsorship Routes — Department OS v2
 * 14 endpoints for the Sponsorship Department.
 * Tables created on startup. Coordinator registered with Department Registry.
 */

import type { Express } from "express";
import { db }           from "./db";
import { sql }          from "drizzle-orm";
import { createSponsorshipsCoordinator } from "./services/sponsorship-department-coordinator";
import { departmentRegistry }            from "./services/department-registry";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }
function getOrgId(req: any): string {
  return (req.session as any)?.organizationId ?? (req.user as any)?.organizationId ?? "";
}

// ─── Table creation ──────────────────────────────────────────────────────────

async function createTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sponsorship_opportunities (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id            TEXT NOT NULL,
      organization_name TEXT NOT NULL,
      contact_name      TEXT,
      contact_email     TEXT,
      contact_phone     TEXT,
      website           TEXT,
      industry          TEXT,
      location          TEXT,
      sponsorship_type  TEXT DEFAULT 'general',
      source            TEXT DEFAULT 'manual',
      estimated_value   INTEGER DEFAULT 0,
      notes             TEXT,
      status            TEXT DEFAULT 'new',
      fit_score         INTEGER DEFAULT 0,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sponsorship_assessments (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id                TEXT NOT NULL,
      sponsorship_id        UUID REFERENCES sponsorship_opportunities(id) ON DELETE CASCADE,
      fit_score             INTEGER DEFAULT 0,
      brand_alignment_score INTEGER DEFAULT 0,
      financial_value_score INTEGER DEFAULT 0,
      confidence_score      INTEGER DEFAULT 0,
      recommended_action    TEXT,
      reasoning             TEXT,
      strengths             JSONB DEFAULT '[]',
      concerns              JSONB DEFAULT '[]',
      next_steps            JSONB DEFAULT '[]',
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sponsorship_outreach_drafts (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id            TEXT NOT NULL,
      sponsorship_id    UUID REFERENCES sponsorship_opportunities(id) ON DELETE CASCADE,
      subject           TEXT,
      body              TEXT,
      status            TEXT DEFAULT 'draft',
      positioning_angle TEXT,
      confidence_score  INTEGER DEFAULT 0,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sponsorship_relationships (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id            TEXT NOT NULL,
      sponsorship_id    UUID REFERENCES sponsorship_opportunities(id) ON DELETE CASCADE,
      stage             TEXT DEFAULT 'initial',
      last_contacted_at TIMESTAMPTZ,
      notes             TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sponsorship_learning_signals (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id             TEXT NOT NULL,
      sponsorship_id     UUID REFERENCES sponsorship_opportunities(id) ON DELETE CASCADE,
      source             TEXT,
      industry           TEXT,
      sponsorship_type   TEXT,
      fit_score          INTEGER DEFAULT 0,
      responded          BOOLEAN DEFAULT FALSE,
      meeting_requested  BOOLEAN DEFAULT FALSE,
      proposal_requested BOOLEAN DEFAULT FALSE,
      sponsored          BOOLEAN DEFAULT FALSE,
      declined           BOOLEAN DEFAULT FALSE,
      created_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sponsorship_executive_briefs (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id          TEXT NOT NULL,
      summary         TEXT,
      best_action     TEXT,
      recommendations JSONB DEFAULT '[]',
      metrics         JSONB DEFAULT '{}',
      generated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sponsorship_recommendations (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id           TEXT NOT NULL,
      category         TEXT,
      recommendation   TEXT,
      reasoning        TEXT,
      confidence_score INTEGER DEFAULT 0,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerSponsorshipRoutes(
  app: Express,
  isAuthenticated: any,
  requireRole: any,
): void {
  createTables().catch(err => console.error("[sponsorships] table creation error:", err));

  try {
    departmentRegistry.register(createSponsorshipsCoordinator(), {
      name:             "Sponsorship Department",
      description:      "Sponsorship pipeline management, outreach, and executive intelligence",
      version:          "2.0.0",
      enabled:          true,
      discoveryEnabled: true,
      outreachEnabled:  true,
      executionEnabled: true,
      learningEnabled:  true,
      executiveEnabled: true,
    });
    console.log("[sponsorships] department registered with Department OS");
  } catch (err) {
    console.error("[sponsorships] registry registration failed:", err);
  }

  // ── GET /api/sponsorships ─────────────────────────────────────────────────
  app.get("/api/sponsorships", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const result = await db.execute(sql`
        SELECT * FROM sponsorship_opportunities
        WHERE org_id = ${orgId}
        ORDER BY created_at DESC
        LIMIT 500
      `);
      res.json(rows(result));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── POST /api/sponsorships ────────────────────────────────────────────────
  app.post("/api/sponsorships", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const {
        organizationName, contactName, contactEmail, contactPhone,
        website, industry, location, sponsorshipType, source, estimatedValue, notes,
      } = req.body;

      if (!organizationName) {
        return res.status(400).json({ error: "organizationName is required" });
      }

      const result = await db.execute(sql`
        INSERT INTO sponsorship_opportunities
          (org_id, organization_name, contact_name, contact_email, contact_phone,
           website, industry, location, sponsorship_type, source, estimated_value, notes)
        VALUES (
          ${orgId}, ${organizationName}, ${contactName ?? null}, ${contactEmail ?? null},
          ${contactPhone ?? null}, ${website ?? null}, ${industry ?? null},
          ${location ?? null}, ${sponsorshipType ?? "general"}, ${source ?? "manual"},
          ${estimatedValue ? Number(estimatedValue) : 0}, ${notes ?? null}
        )
        RETURNING *
      `);
      res.json(rows(result)[0] ?? {});
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── GET /api/sponsorships/pipeline ────────────────────────────────────────
  app.get("/api/sponsorships/pipeline", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const result = await db.execute(sql`
        SELECT status, COUNT(*) as cnt
        FROM sponsorship_opportunities
        WHERE org_id = ${orgId}
        GROUP BY status
      `);
      const byStatus = Object.fromEntries(rows(result).map((r: any) => [r.status, Number(r.cnt)]));
      const stages   = ["new","qualified","outreach_ready","contacted","interested","meeting","proposal","negotiation","sponsored","declined"];
      res.json(stages.map(s => ({ stage: s, count: byStatus[s] ?? 0 })));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── GET /api/sponsorships/:id ─────────────────────────────────────────────
  app.get("/api/sponsorships/:id", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const result = await db.execute(sql`
        SELECT * FROM sponsorship_opportunities
        WHERE id = ${req.params.id} AND org_id = ${orgId}
        LIMIT 1
      `);
      const item = rows(result)[0];
      if (!item) return res.status(404).json({ error: "Not found" });
      res.json(item);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── PATCH /api/sponsorships/:id/status ───────────────────────────────────
  app.patch("/api/sponsorships/:id/status", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const { status } = req.body;
      const valid  = ["new","qualified","outreach_ready","contacted","interested","meeting","proposal","negotiation","sponsored","declined"];
      if (!valid.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${valid.join(", ")}` });
      }
      await db.execute(sql`
        UPDATE sponsorship_opportunities
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${req.params.id} AND org_id = ${orgId}
      `);

      if (status === "sponsored" || status === "declined") {
        const opps = await db.execute(sql`
          SELECT * FROM sponsorship_opportunities WHERE id = ${req.params.id}
        `).then(rows);
        const opp = opps[0];
        if (opp) {
          await db.execute(sql`
            INSERT INTO sponsorship_learning_signals
              (org_id, sponsorship_id, source, industry, sponsorship_type, fit_score, sponsored, declined)
            VALUES (
              ${orgId}, ${req.params.id}, ${opp.source ?? "manual"},
              ${opp.industry ?? null}, ${opp.sponsorship_type ?? "general"},
              ${opp.fit_score ?? 0},
              ${status === "sponsored"}, ${status === "declined"}
            )
          `).catch(() => {});
        }
      }

      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── DELETE /api/sponsorships/:id ──────────────────────────────────────────
  app.delete("/api/sponsorships/:id", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      await db.execute(sql`
        DELETE FROM sponsorship_opportunities WHERE id = ${req.params.id} AND org_id = ${orgId}
      `);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── GET /api/sponsorships/assessments ─────────────────────────────────────
  app.get("/api/sponsorships/assessments", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const result = await db.execute(sql`
        SELECT sa.*, so.organization_name, so.sponsorship_type
        FROM sponsorship_assessments sa
        LEFT JOIN sponsorship_opportunities so ON sa.sponsorship_id = so.id
        WHERE sa.org_id = ${orgId}
        ORDER BY sa.created_at DESC
        LIMIT 200
      `);
      res.json(rows(result));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── POST /api/sponsorships/:id/assess ─────────────────────────────────────
  app.post("/api/sponsorships/:id/assess", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const { assessSponsorship } = await import("./services/sponsorship-assessment-agent");
      const result = await assessSponsorship(orgId, req.params.id);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── GET /api/sponsorships/outreach-drafts ─────────────────────────────────
  app.get("/api/sponsorships/outreach-drafts", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const result = await db.execute(sql`
        SELECT sod.*, so.organization_name
        FROM sponsorship_outreach_drafts sod
        LEFT JOIN sponsorship_opportunities so ON sod.sponsorship_id = so.id
        WHERE sod.org_id = ${orgId}
        ORDER BY sod.created_at DESC
        LIMIT 200
      `);
      res.json(rows(result));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── POST /api/sponsorships/:id/draft-outreach ─────────────────────────────
  app.post("/api/sponsorships/:id/draft-outreach", isAuthenticated, async (req, res) => {
    try {
      const orgId     = getOrgId(req);
      const draftType = req.body.draftType ?? "introduction";
      const { draftSponsorshipOutreach } = await import("./services/sponsorship-outreach-agent");
      const result = await draftSponsorshipOutreach(orgId, req.params.id, draftType);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── GET /api/sponsorships/learning ────────────────────────────────────────
  app.get("/api/sponsorships/learning", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { computeSponsorshipsLearningMetrics } = await import("./services/sponsorship-learning-agent");
      const result = await computeSponsorshipsLearningMetrics(orgId);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── GET /api/sponsorships/executive ───────────────────────────────────────
  app.get("/api/sponsorships/executive", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const {
        generateSponsorshipsBrief,
        generateSponsorshipsRecommendations,
        generateSponsorshipsBestAction,
      } = await import("./services/sponsorship-executive-agent");

      const [brief, recommendations, bestAction] = await Promise.all([
        generateSponsorshipsBrief(orgId),
        generateSponsorshipsRecommendations(orgId),
        generateSponsorshipsBestAction(orgId),
      ]);

      res.json({ brief, recommendations, bestAction });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── POST /api/sponsorships/relationships ──────────────────────────────────
  app.post("/api/sponsorships/relationships", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { sponsorshipId, stage, notes } = req.body;
      if (!sponsorshipId) return res.status(400).json({ error: "sponsorshipId is required" });

      const existing = await db.execute(sql`
        SELECT id FROM sponsorship_relationships
        WHERE org_id = ${orgId} AND sponsorship_id = ${sponsorshipId}
        LIMIT 1
      `).then(rows);

      if (existing.length > 0) {
        await db.execute(sql`
          UPDATE sponsorship_relationships
          SET stage = ${stage ?? "active"}, notes = ${notes ?? null}, last_contacted_at = NOW()
          WHERE org_id = ${orgId} AND sponsorship_id = ${sponsorshipId}
        `);
      } else {
        await db.execute(sql`
          INSERT INTO sponsorship_relationships (org_id, sponsorship_id, stage, notes, last_contacted_at)
          VALUES (${orgId}, ${sponsorshipId}, ${stage ?? "initial"}, ${notes ?? null}, NOW())
        `);
      }

      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── GET /api/sponsorships/health ──────────────────────────────────────────
  app.get("/api/sponsorships/health", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const coordinator = createSponsorshipsCoordinator();
      const review      = await coordinator.runHeartbeatReview(orgId);
      res.json(review);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  console.log("[Sponsorships] Routes registered");
}
