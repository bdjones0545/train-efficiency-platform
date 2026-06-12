/**
 * Partnership Routes — Department OS v2
 * 14 endpoints for the Partnerships Department.
 * Tables created on startup. Coordinator registered with Department Registry.
 */

import type { Express } from "express";
import { db }           from "./db";
import { sql }          from "drizzle-orm";
import { createPartnershipsCoordinator } from "./services/partnership-department-coordinator";
import { departmentRegistry }            from "./services/department-registry";
import { resolveOrgIdOrThrow, handleOrgError } from "./lib/resolve-org-id";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }

// ─── Table creation ──────────────────────────────────────────────────────────

async function createTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS partnership_opportunities (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       TEXT NOT NULL,
      organization_name TEXT NOT NULL,
      contact_name  TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      website       TEXT,
      location      TEXT,
      partnership_type TEXT DEFAULT 'general',
      source        TEXT DEFAULT 'manual',
      notes         TEXT,
      status        TEXT DEFAULT 'new',
      fit_score     INTEGER DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS partnership_assessments (
      id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id                 TEXT NOT NULL,
      partnership_id         UUID REFERENCES partnership_opportunities(id) ON DELETE CASCADE,
      fit_score              INTEGER DEFAULT 0,
      reach_score            INTEGER DEFAULT 0,
      strategic_value_score  INTEGER DEFAULT 0,
      confidence_score       INTEGER DEFAULT 0,
      recommended_action     TEXT,
      reasoning              TEXT,
      strengths              JSONB DEFAULT '[]',
      concerns               JSONB DEFAULT '[]',
      next_steps             JSONB DEFAULT '[]',
      created_at             TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS partnership_outreach_drafts (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id            TEXT NOT NULL,
      partnership_id    UUID REFERENCES partnership_opportunities(id) ON DELETE CASCADE,
      subject           TEXT,
      body              TEXT,
      status            TEXT DEFAULT 'draft',
      positioning_angle TEXT,
      confidence_score  INTEGER DEFAULT 0,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS partnership_relationships (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id           TEXT NOT NULL,
      partnership_id   UUID REFERENCES partnership_opportunities(id) ON DELETE CASCADE,
      stage            TEXT DEFAULT 'initial',
      last_contacted_at TIMESTAMPTZ,
      notes            TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS partnership_learning_signals (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id           TEXT NOT NULL,
      partnership_id   UUID REFERENCES partnership_opportunities(id) ON DELETE CASCADE,
      source           TEXT,
      partnership_type TEXT,
      fit_score        INTEGER DEFAULT 0,
      replied          BOOLEAN DEFAULT FALSE,
      meeting_requested BOOLEAN DEFAULT FALSE,
      partnered        BOOLEAN DEFAULT FALSE,
      declined         BOOLEAN DEFAULT FALSE,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS partnership_executive_briefs (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id         TEXT NOT NULL,
      summary        TEXT,
      best_action    TEXT,
      recommendations JSONB DEFAULT '[]',
      metrics        JSONB DEFAULT '{}',
      generated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS partnership_recommendations (
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

export function registerPartnershipRoutes(
  app: Express,
  isAuthenticated: any,
  requireRole: any,
): void {
  // Create tables + register coordinator
  createTables().catch(err => console.error("[partnerships] table creation error:", err));

  try {
    departmentRegistry.register(createPartnershipsCoordinator(), {
      name:              "Partnerships",
      description:       "Partnership pipeline management, outreach, and executive intelligence",
      version:           "2.0.0",
      enabled:           true,
      discoveryEnabled:  true,
      outreachEnabled:   true,
      executionEnabled:  true,
      learningEnabled:   true,
      executiveEnabled:  true,
    });
    console.log("[partnerships] department registered with Department OS");
  } catch (err) {
    console.error("[partnerships] registry registration failed:", err);
  }

  // ── GET /api/partnerships ─────────────────────────────────────────────────
  app.get("/api/partnerships", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const result = await db.execute(sql`
        SELECT * FROM partnership_opportunities
        WHERE org_id = ${orgId}
        ORDER BY created_at DESC
        LIMIT 500
      `);
      res.json(rows(result));
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/partnerships ────────────────────────────────────────────────
  app.post("/api/partnerships", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const {
        organizationName, contactName, contactEmail, contactPhone,
        website, location, partnershipType, source, notes,
      } = req.body;

      if (!organizationName) {
        return res.status(400).json({ error: "organizationName is required" });
      }

      const result = await db.execute(sql`
        INSERT INTO partnership_opportunities
          (org_id, organization_name, contact_name, contact_email, contact_phone,
           website, location, partnership_type, source, notes)
        VALUES (
          ${orgId}, ${organizationName}, ${contactName ?? null}, ${contactEmail ?? null},
          ${contactPhone ?? null}, ${website ?? null}, ${location ?? null},
          ${partnershipType ?? "general"}, ${source ?? "manual"}, ${notes ?? null}
        )
        RETURNING *
      `);
      res.json(rows(result)[0] ?? {});
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/partnerships/:id ─────────────────────────────────────────────
  app.get("/api/partnerships/:id", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const result = await db.execute(sql`
        SELECT * FROM partnership_opportunities
        WHERE id = ${req.params.id} AND org_id = ${orgId}
        LIMIT 1
      `);
      const item = rows(result)[0];
      if (!item) return res.status(404).json({ error: "Not found" });
      res.json(item);
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/partnerships/:id/status ────────────────────────────────────
  app.patch("/api/partnerships/:id/status", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { status } = req.body;
      const valid = ["new","qualified","outreach_ready","contacted","interested","meeting","negotiation","partnered","declined"];
      if (!valid.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${valid.join(", ")}` });
      }
      await db.execute(sql`
        UPDATE partnership_opportunities
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${req.params.id} AND org_id = ${orgId}
      `);

      // Log learning signal on terminal status
      if (status === "partnered" || status === "declined") {
        const opps = await db.execute(sql`
          SELECT * FROM partnership_opportunities WHERE id = ${req.params.id}
        `).then(rows);
        const opp = opps[0];
        if (opp) {
          await db.execute(sql`
            INSERT INTO partnership_learning_signals
              (org_id, partnership_id, source, partnership_type, fit_score, partnered, declined)
            VALUES (
              ${orgId}, ${req.params.id}, ${opp.source ?? "manual"},
              ${opp.partnership_type ?? "general"}, ${opp.fit_score ?? 0},
              ${status === "partnered"}, ${status === "declined"}
            )
          `).catch(() => {});
        }
      }

      res.json({ success: true });
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/partnerships/:id ──────────────────────────────────────────
  app.delete("/api/partnerships/:id", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      await db.execute(sql`
        DELETE FROM partnership_opportunities WHERE id = ${req.params.id} AND org_id = ${orgId}
      `);
      res.json({ success: true });
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/partnerships/assessments ─────────────────────────────────────
  app.get("/api/partnerships/assessments", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const result = await db.execute(sql`
        SELECT pa.*, po.organization_name, po.partnership_type
        FROM partnership_assessments pa
        LEFT JOIN partnership_opportunities po ON pa.partnership_id = po.id
        WHERE pa.org_id = ${orgId}
        ORDER BY pa.created_at DESC
        LIMIT 200
      `);
      res.json(rows(result));
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/partnerships/:id/assess ─────────────────────────────────────
  app.post("/api/partnerships/:id/assess", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { assessPartnership } = await import("./services/partnership-assessment-agent");
      const result = await assessPartnership(orgId, req.params.id);
      res.json(result);
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/partnerships/outreach-drafts ─────────────────────────────────
  app.get("/api/partnerships/outreach-drafts", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const result = await db.execute(sql`
        SELECT pod.*, po.organization_name
        FROM partnership_outreach_drafts pod
        LEFT JOIN partnership_opportunities po ON pod.partnership_id = po.id
        WHERE pod.org_id = ${orgId}
        ORDER BY pod.created_at DESC
        LIMIT 200
      `);
      res.json(rows(result));
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/partnerships/:id/draft-outreach ─────────────────────────────
  app.post("/api/partnerships/:id/draft-outreach", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const draftType = req.body.draftType ?? "introduction";
      const { draftPartnershipOutreach } = await import("./services/partnership-outreach-agent");
      const result = await draftPartnershipOutreach(orgId, req.params.id, draftType);
      res.json(result);
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/partnerships/pipeline ────────────────────────────────────────
  app.get("/api/partnerships/pipeline", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const result = await db.execute(sql`
        SELECT status, COUNT(*) as cnt
        FROM partnership_opportunities
        WHERE org_id = ${orgId}
        GROUP BY status
      `);
      const byStatus = Object.fromEntries(rows(result).map((r: any) => [r.status, Number(r.cnt)]));
      const stages = ["new","qualified","outreach_ready","contacted","interested","meeting","negotiation","partnered","declined"];
      res.json(stages.map(s => ({ stage: s, count: byStatus[s] ?? 0 })));
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/partnerships/learning ────────────────────────────────────────
  app.get("/api/partnerships/learning", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { computePartnershipsLearningMetrics } = await import("./services/partnership-learning-agent");
      const result = await computePartnershipsLearningMetrics(orgId);
      res.json(result);
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/partnerships/executive ───────────────────────────────────────
  app.get("/api/partnerships/executive", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const {
        generatePartnershipsBrief,
        generatePartnershipsRecommendations,
        generatePartnershipsBestAction,
      } = await import("./services/partnership-executive-agent");

      const [brief, recommendations, bestAction] = await Promise.all([
        generatePartnershipsBrief(orgId),
        generatePartnershipsRecommendations(orgId),
        generatePartnershipsBestAction(orgId),
      ]);

      res.json({ brief, recommendations, bestAction });
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/partnerships/relationships ──────────────────────────────────
  app.post("/api/partnerships/relationships", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const { partnershipId, stage, notes } = req.body;
      if (!partnershipId) return res.status(400).json({ error: "partnershipId is required" });

      const existing = await db.execute(sql`
        SELECT id FROM partnership_relationships
        WHERE org_id = ${orgId} AND partnership_id = ${partnershipId}
        LIMIT 1
      `).then(rows);

      if (existing.length > 0) {
        await db.execute(sql`
          UPDATE partnership_relationships
          SET stage = ${stage ?? "active"}, notes = ${notes ?? null}, last_contacted_at = NOW()
          WHERE org_id = ${orgId} AND partnership_id = ${partnershipId}
        `);
      } else {
        await db.execute(sql`
          INSERT INTO partnership_relationships (org_id, partnership_id, stage, notes, last_contacted_at)
          VALUES (${orgId}, ${partnershipId}, ${stage ?? "initial"}, ${notes ?? null}, NOW())
        `);
      }

      res.json({ success: true });
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });
}
