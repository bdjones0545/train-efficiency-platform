import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? null;
}
function n(v: unknown): number {
  return Number(v ?? 0);
}
function resolveUserId(req: any): string {
  return req.user?.claims?.sub ?? req.user?.id ?? "";
}

// ─── Table Bootstrap ─────────────────────────────────────────────────────────

async function createTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_acquisition_opportunities (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id            TEXT NOT NULL,
      title             TEXT NOT NULL,
      source            TEXT NOT NULL DEFAULT 'Manual',
      company           TEXT NOT NULL DEFAULT '',
      type              TEXT NOT NULL DEFAULT 'coaching',
      location          TEXT NOT NULL DEFAULT 'Remote',
      estimated_value   INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'new',
      fit_score         INTEGER NOT NULL DEFAULT 0,
      notes             TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_agent_events (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id      TEXT NOT NULL,
      agent_name  TEXT NOT NULL,
      action      TEXT NOT NULL,
      event_type  TEXT NOT NULL DEFAULT 'info',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_qualification_assessments (
      id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id                  TEXT NOT NULL,
      opportunity_id          TEXT NOT NULL UNIQUE,
      ai_can_fulfill          JSONB NOT NULL DEFAULT '[]',
      human_required          JSONB NOT NULL DEFAULT '[]',
      revenue_potential       TEXT NOT NULL DEFAULT 'medium',
      risk_level              TEXT NOT NULL DEFAULT 'medium',
      recommended_action      TEXT NOT NULL DEFAULT 'Review manually',
      fit_score               INTEGER NOT NULL DEFAULT 0,
      ai_fulfillment_score    INTEGER NOT NULL DEFAULT 0,
      revenue_potential_score INTEGER NOT NULL DEFAULT 0,
      risk_score              INTEGER NOT NULL DEFAULT 0,
      confidence_score        INTEGER NOT NULL DEFAULT 0,
      reasoning               TEXT NOT NULL DEFAULT '',
      red_flags               JSONB NOT NULL DEFAULT '[]',
      next_steps              JSONB NOT NULL DEFAULT '[]',
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_outreach_drafts (
      id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id              TEXT NOT NULL,
      opportunity_id      TEXT NOT NULL UNIQUE,
      subject             TEXT NOT NULL DEFAULT '',
      body                TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL DEFAULT 'draft',
      channel             TEXT NOT NULL DEFAULT 'email',
      confidence_score    INTEGER NOT NULL DEFAULT 0,
      created_by_agent    BOOLEAN NOT NULL DEFAULT true,
      approved_by_user_id TEXT,
      sent_at             TIMESTAMPTZ,
      call_to_action      TEXT NOT NULL DEFAULT '',
      positioning_angle   TEXT NOT NULL DEFAULT '',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_source_settings (
      id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id          TEXT NOT NULL UNIQUE,
      sources         JSONB NOT NULL DEFAULT '{}',
      qual_rules      JSONB NOT NULL DEFAULT '{}',
      outreach_rules  JSONB NOT NULL DEFAULT '{}',
      agent_perms     JSONB NOT NULL DEFAULT '{}',
      discovery_filters JSONB NOT NULL DEFAULT '{}',
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    ALTER TABLE opportunity_source_settings
      ADD COLUMN IF NOT EXISTS discovery_filters JSONB NOT NULL DEFAULT '{}'
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_discovery_runs (
      id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id                 TEXT NOT NULL,
      started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at           TIMESTAMPTZ,
      status                 TEXT NOT NULL DEFAULT 'running',
      opportunities_scanned  INTEGER NOT NULL DEFAULT 0,
      opportunities_created  INTEGER NOT NULL DEFAULT 0,
      opportunities_rejected INTEGER NOT NULL DEFAULT 0,
      duplicates_skipped     INTEGER NOT NULL DEFAULT 0,
      notes                  TEXT,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    ALTER TABLE opportunity_acquisition_opportunities
      ADD COLUMN IF NOT EXISTS fingerprint TEXT
  `);
}

// ─── Route Registration ───────────────────────────────────────────────────────

export async function registerOpportunityAcquisitionRoutes(
  app: Express,
  isAuthenticated: any,
  requireRole: any,
) {
  await createTables();

  const auth = [isAuthenticated, requireRole("COACH", "ADMIN")];

  // ── GET /api/opportunity-acquisition/summary ────────────────────────────────
  app.get("/api/opportunity-acquisition/summary", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json({ foundToday: 0, qualified: 0, outreachReady: 0, pipelineValue: 0 });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [summary] = rows(await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= ${today.toISOString()}::timestamptz)         AS found_today,
          COUNT(*) FILTER (WHERE status = 'qualified')                                       AS qualified,
          COUNT(*) FILTER (WHERE status = 'outreach_ready')                                  AS outreach_ready,
          COALESCE(SUM(estimated_value) FILTER (WHERE status NOT IN ('lost','won')), 0)      AS pipeline_value
        FROM opportunity_acquisition_opportunities
        WHERE org_id = ${orgId}
      `));

      res.json({
        foundToday:    n(summary?.found_today),
        qualified:     n(summary?.qualified),
        outreachReady: n(summary?.outreach_ready),
        pipelineValue: n(summary?.pipeline_value),
      });
    } catch (e: any) {
      console.error("[opportunity/summary]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/opportunity-acquisition/opportunities ──────────────────────────
  app.get("/api/opportunity-acquisition/opportunities", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json([]);

      const opps = rows(await db.execute(sql`
        SELECT * FROM opportunity_acquisition_opportunities
        WHERE org_id = ${orgId}
        ORDER BY created_at DESC
        LIMIT 200
      `));

      res.json(opps.map(o => ({
        id:             o.id,
        title:          o.title,
        source:         o.source,
        company:        o.company,
        type:           o.type,
        location:       o.location,
        estimatedValue: n(o.estimated_value),
        status:         o.status,
        fitScore:       n(o.fit_score),
        notes:          o.notes ?? "",
        createdAt:      o.created_at,
      })));
    } catch (e: any) {
      console.error("[opportunity/list]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/opportunity-acquisition/opportunities ─────────────────────────
  app.post("/api/opportunity-acquisition/opportunities", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      const {
        title, source = "Manual", company = "", type = "coaching",
        location = "Remote", estimatedValue = 0, fitScore = 0, notes = "",
      } = req.body;

      if (!title) return res.status(400).json({ message: "title is required" });

      const inserted = row0(await db.execute(sql`
        INSERT INTO opportunity_acquisition_opportunities
          (org_id, title, source, company, type, location, estimated_value, fit_score, notes)
        VALUES
          (${orgId}, ${title}, ${source}, ${company}, ${type}, ${location},
           ${estimatedValue}, ${fitScore}, ${notes})
        RETURNING *
      `));

      // Log agent event
      await db.execute(sql`
        INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
        VALUES (${orgId}, 'System', ${`Opportunity "${title}" added manually.`}, 'info')
      `);

      res.json({ success: true, opportunity: inserted });
    } catch (e: any) {
      console.error("[opportunity/create]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH /api/opportunity-acquisition/opportunities/:id ────────────────────
  app.patch("/api/opportunity-acquisition/opportunities/:id", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      const { id } = req.params;
      const { status, fitScore, notes, estimatedValue } = req.body;

      const existing = row0(await db.execute(sql`
        SELECT id FROM opportunity_acquisition_opportunities WHERE id = ${id} AND org_id = ${orgId}
      `));
      if (!existing) return res.status(404).json({ message: "Not found" });

      await db.execute(sql`
        UPDATE opportunity_acquisition_opportunities
        SET
          status          = COALESCE(${status ?? null}, status),
          fit_score       = COALESCE(${fitScore != null ? fitScore : null}, fit_score),
          notes           = COALESCE(${notes ?? null}, notes),
          estimated_value = COALESCE(${estimatedValue != null ? estimatedValue : null}, estimated_value),
          updated_at      = NOW()
        WHERE id = ${id} AND org_id = ${orgId}
      `);

      if (status) {
        await db.execute(sql`
          INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
          VALUES (${orgId}, 'System', ${`Opportunity status updated to "${status}".`}, 'info')
        `);
      }

      res.json({ success: true });
    } catch (e: any) {
      console.error("[opportunity/update]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/opportunity-acquisition/events ─────────────────────────────────
  app.get("/api/opportunity-acquisition/events", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json([]);

      const events = rows(await db.execute(sql`
        SELECT * FROM opportunity_agent_events
        WHERE org_id = ${orgId}
        ORDER BY created_at DESC
        LIMIT 50
      `));

      res.json(events.map(e => ({
        id:        e.id,
        agentName: e.agent_name,
        action:    e.action,
        eventType: e.event_type,
        createdAt: e.created_at,
      })));
    } catch (e: any) {
      console.error("[opportunity/events]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/opportunity-acquisition/settings ───────────────────────────────
  app.get("/api/opportunity-acquisition/settings", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json(null);

      let settings = row0(await db.execute(sql`
        SELECT * FROM opportunity_source_settings WHERE org_id = ${orgId}
      `));

      if (!settings) {
        const defaultSources     = { linkedin: true, indeed: true, agentScan: false, directReferrals: true };
        const defaultQualRules   = { minFitScore70: true, remoteOnly: false, revenueMin40k: true, autoQualifyHigh: false };
        const defaultOutreach    = { requireHumanApproval: true, autoSendHighConf: false, ccFounder: true };
        const defaultAgentPerms  = { discovery: "scan_only", qualification: "score_qualify", outreach: "draft_only", executive: "flag_escalate" };

        settings = row0(await db.execute(sql`
          INSERT INTO opportunity_source_settings (org_id, sources, qual_rules, outreach_rules, agent_perms)
          VALUES (
            ${orgId},
            ${JSON.stringify(defaultSources)},
            ${JSON.stringify(defaultQualRules)},
            ${JSON.stringify(defaultOutreach)},
            ${JSON.stringify(defaultAgentPerms)}
          )
          ON CONFLICT (org_id) DO UPDATE SET updated_at = NOW()
          RETURNING *
        `));
      }

      res.json({
        sources:       settings.sources,
        qualRules:     settings.qual_rules,
        outreachRules: settings.outreach_rules,
        agentPerms:    settings.agent_perms,
      });
    } catch (e: any) {
      console.error("[opportunity/settings]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH /api/opportunity-acquisition/settings ─────────────────────────────
  app.patch("/api/opportunity-acquisition/settings", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      const { sources, qualRules, outreachRules, agentPerms } = req.body;

      await db.execute(sql`
        INSERT INTO opportunity_source_settings (org_id, sources, qual_rules, outreach_rules, agent_perms)
        VALUES (
          ${orgId},
          ${JSON.stringify(sources ?? {})},
          ${JSON.stringify(qualRules ?? {})},
          ${JSON.stringify(outreachRules ?? {})},
          ${JSON.stringify(agentPerms ?? {})}
        )
        ON CONFLICT (org_id) DO UPDATE SET
          sources        = EXCLUDED.sources,
          qual_rules     = EXCLUDED.qual_rules,
          outreach_rules = EXCLUDED.outreach_rules,
          agent_perms    = EXCLUDED.agent_perms,
          updated_at     = NOW()
      `);

      res.json({ success: true });
    } catch (e: any) {
      console.error("[opportunity/settings/save]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/opportunity-acquisition/assessments ────────────────────────────
  app.get("/api/opportunity-acquisition/assessments", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json([]);

      const assessments = rows(await db.execute(sql`
        SELECT a.*, o.title AS opportunity_title
        FROM opportunity_qualification_assessments a
        JOIN opportunity_acquisition_opportunities o ON o.id = a.opportunity_id
        WHERE a.org_id = ${orgId}
        ORDER BY a.updated_at DESC
        LIMIT 100
      `));

      res.json(assessments.map((a: any) => ({
        id:                   a.id,
        opportunityId:        a.opportunity_id,
        opportunityTitle:     a.opportunity_title,
        fitScore:             n(a.fit_score),
        aiFulfillmentScore:   n(a.ai_fulfillment_score),
        revenuePotentialScore:n(a.revenue_potential_score),
        riskScore:            n(a.risk_score),
        confidenceScore:      n(a.confidence_score),
        revenuePotential:     a.revenue_potential,
        riskLevel:            a.risk_level,
        recommendedAction:    a.recommended_action,
        reasoning:            a.reasoning,
        aiCanFulfill:         a.ai_can_fulfill ?? [],
        humanRequired:        a.human_required ?? [],
        redFlags:             a.red_flags ?? [],
        nextSteps:            a.next_steps ?? [],
        updatedAt:            a.updated_at,
      })));
    } catch (e: any) {
      console.error("[opportunity/assessments]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/opportunity-acquisition/opportunities/:id/qualify ──────────────
  app.post("/api/opportunity-acquisition/opportunities/:id/qualify", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      const { id } = req.params;

      // Log started event
      await db.execute(sql`
        INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
        VALUES (${orgId}, 'Qualification Agent', ${`Qualification started for opportunity ${id}.`}, 'qualify')
      `);

      const { qualifyOpportunity } = await import("./services/opportunity-qualification-agent");
      const result = await qualifyOpportunity(orgId, id);

      // Log completion events
      await db.execute(sql`
        INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
        VALUES (${orgId}, 'Qualification Agent',
          ${`Qualification complete for "${result.opportunityTitle}" — fit score ${result.fitScore}/100. Action: ${result.recommendedAction}.`},
          'qualify')
      `);

      if (result.fitScore >= 80) {
        await db.execute(sql`
          INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
          VALUES (${orgId}, 'Executive Agent',
            ${`High-value opportunity flagged: "${result.opportunityTitle}" scored ${result.fitScore}/100.`},
            'flag')
        `);
      }

      if (result.fitScore < 45) {
        await db.execute(sql`
          INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
          VALUES (${orgId}, 'Qualification Agent',
            ${`Low-fit opportunity: "${result.opportunityTitle}" scored ${result.fitScore}/100 — marked for review.`},
            'info')
        `);
      }

      res.json({ success: true, result });
    } catch (e: any) {
      console.error("[opportunity/qualify]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/opportunity-acquisition/qualify-all ────────────────────────────
  app.post("/api/opportunity-acquisition/qualify-all", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      await db.execute(sql`
        INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
        VALUES (${orgId}, 'Qualification Agent', 'Bulk qualification run started.', 'qualify')
      `);

      const { qualifyAllPending } = await import("./services/opportunity-qualification-agent");
      const { qualified, results } = await qualifyAllPending(orgId);

      await db.execute(sql`
        INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
        VALUES (${orgId}, 'Qualification Agent',
          ${`Bulk qualification complete — ${qualified} opportunit${qualified === 1 ? "y" : "ies"} scored.`},
          'qualify')
      `);

      res.json({ success: true, qualified, results });
    } catch (e: any) {
      console.error("[opportunity/qualify-all]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/opportunity-acquisition/opportunities/:id/generate-outreach ───
  app.post("/api/opportunity-acquisition/opportunities/:id/generate-outreach", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      const { id } = req.params;

      await db.execute(sql`
        INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
        VALUES (${orgId}, 'Outreach Agent', ${`Outreach draft generation started for opportunity ${id}.`}, 'draft')
      `);

      const { generateOutreachDraft } = await import("./services/opportunity-outreach-agent");
      const result = await generateOutreachDraft(orgId, id);

      await db.execute(sql`
        INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
        VALUES (${orgId}, 'Outreach Agent',
          ${`Outreach draft generated for "${result.opportunityTitle}" — confidence ${result.confidenceScore}/100.`},
          'draft')
      `);

      res.json({ success: true, result });
    } catch (e: any) {
      console.error("[opportunity/generate-outreach]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/opportunity-acquisition/outreach-drafts ────────────────────────
  app.get("/api/opportunity-acquisition/outreach-drafts", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json([]);

      const drafts = rows(await db.execute(sql`
        SELECT d.*, o.title AS opportunity_title, o.company, o.fit_score, o.type, o.location
        FROM opportunity_outreach_drafts d
        JOIN opportunity_acquisition_opportunities o ON o.id = d.opportunity_id
        WHERE d.org_id = ${orgId}
        ORDER BY d.updated_at DESC
        LIMIT 100
      `));

      res.json(drafts.map((d: any) => ({
        id:                 d.id,
        opportunityId:      d.opportunity_id,
        opportunityTitle:   d.opportunity_title,
        company:            d.company ?? "",
        fitScore:           n(d.fit_score),
        opportunityType:    d.type ?? "coaching",
        location:           d.location ?? "Remote",
        subject:            d.subject,
        body:               d.body,
        status:             d.status,
        channel:            d.channel ?? "email",
        confidenceScore:    n(d.confidence_score),
        createdByAgent:     d.created_by_agent ?? true,
        approvedByUserId:   d.approved_by_user_id ?? null,
        sentAt:             d.sent_at ?? null,
        callToAction:       d.call_to_action ?? "",
        positioningAngle:   d.positioning_angle ?? "",
        createdAt:          d.created_at,
        updatedAt:          d.updated_at,
      })));
    } catch (e: any) {
      console.error("[opportunity/outreach-drafts]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH /api/opportunity-acquisition/outreach-drafts/:id ──────────────────
  app.patch("/api/opportunity-acquisition/outreach-drafts/:id", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      const { id } = req.params;
      const userId = resolveUserId(req);
      const { status, subject, body } = req.body as { status?: string; subject?: string; body?: string };

      if (!status && !subject && !body) {
        return res.status(400).json({ message: "Provide status, subject, or body to update" });
      }

      const draft = row0(await db.execute(sql`
        SELECT * FROM opportunity_outreach_drafts WHERE id = ${id} AND org_id = ${orgId}
      `));
      if (!draft) return res.status(404).json({ message: "Draft not found" });

      if (status) {
        await db.execute(sql`
          UPDATE opportunity_outreach_drafts
          SET status = ${status},
              approved_by_user_id = CASE WHEN ${status} = 'approved' THEN ${userId} ELSE approved_by_user_id END,
              updated_at = NOW()
          WHERE id = ${id} AND org_id = ${orgId}
        `);

        const actionLabel =
          status === "approved" ? "Outreach draft approved." :
          status === "rejected" ? "Outreach draft rejected." : `Outreach draft status changed to ${status}.`;
        const eventType = status === "approved" ? "flag" : status === "rejected" ? "info" : "update";

        await db.execute(sql`
          INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
          VALUES (${orgId}, 'Outreach Agent', ${actionLabel}, ${eventType})
        `);
      }

      if (subject !== undefined || body !== undefined) {
        await db.execute(sql`
          UPDATE opportunity_outreach_drafts
          SET subject    = COALESCE(${subject ?? null}, subject),
              body       = COALESCE(${body ?? null}, body),
              updated_at = NOW()
          WHERE id = ${id} AND org_id = ${orgId}
        `);
        await db.execute(sql`
          INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
          VALUES (${orgId}, 'Outreach Agent', 'Outreach draft edited by user.', 'update')
        `);
      }

      const updated = row0(await db.execute(sql`
        SELECT d.*, o.title AS opportunity_title, o.company, o.fit_score
        FROM opportunity_outreach_drafts d
        JOIN opportunity_acquisition_opportunities o ON o.id = d.opportunity_id
        WHERE d.id = ${id}
      `));

      res.json({ success: true, draft: updated });
    } catch (e: any) {
      console.error("[opportunity/outreach-drafts/patch]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/opportunity-acquisition/discovery/run ─────────────────────────
  app.post("/api/opportunity-acquisition/discovery/run", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      const { runOpportunityDiscovery } = await import("./services/opportunity-discovery-agent");
      const result = await runOpportunityDiscovery(orgId);

      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("[opportunity/discovery/run]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/opportunity-acquisition/discovery/history ───────────────────────
  app.get("/api/opportunity-acquisition/discovery/history", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json([]);

      const runs = rows(await db.execute(sql`
        SELECT * FROM opportunity_discovery_runs
        WHERE org_id = ${orgId}
        ORDER BY started_at DESC
        LIMIT 50
      `));

      res.json(runs.map((r: any) => ({
        id:          r.id,
        startedAt:   r.started_at,
        completedAt: r.completed_at,
        status:      r.status,
        scanned:     n(r.opportunities_scanned),
        created:     n(r.opportunities_created),
        rejected:    n(r.opportunities_rejected),
        duplicates:  n(r.duplicates_skipped),
        notes:       r.notes ?? "",
      })));
    } catch (e: any) {
      console.error("[opportunity/discovery/history]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/opportunity-acquisition/discovery/stats ─────────────────────────
  app.get("/api/opportunity-acquisition/discovery/stats", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json({ totalRuns: 0, totalScanned: 0, totalCreated: 0, totalDuplicates: 0, avgCreatedPerRun: 0 });

      const stat = row0(await db.execute(sql`
        SELECT
          COUNT(*)                                                          AS total_runs,
          COALESCE(SUM(opportunities_scanned), 0)                          AS total_scanned,
          COALESCE(SUM(opportunities_created), 0)                          AS total_created,
          COALESCE(SUM(duplicates_skipped), 0)                             AS total_duplicates,
          COALESCE(AVG(opportunities_created)::numeric(10,1), 0)           AS avg_created
        FROM opportunity_discovery_runs
        WHERE org_id = ${orgId}
      `));

      res.json({
        totalRuns:       n(stat?.total_runs),
        totalScanned:    n(stat?.total_scanned),
        totalCreated:    n(stat?.total_created),
        totalDuplicates: n(stat?.total_duplicates),
        avgCreatedPerRun: Math.round(Number(stat?.avg_created ?? 0) * 10) / 10,
      });
    } catch (e: any) {
      console.error("[opportunity/discovery/stats]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/opportunity-acquisition/run-cycle ──────────────────────────────
  app.post("/api/opportunity-acquisition/run-cycle", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      const { runOpportunityAcquisitionCycle } = await import("./services/opportunity-acquisition-orchestrator");
      const result = await runOpportunityAcquisitionCycle(orgId);
      res.json(result);
    } catch (e: any) {
      const status = (e as any)?.status === 409 ? 409 : 500;
      console.error("[opportunity/run-cycle]", e);
      res.status(status).json({ message: e.message });
    }
  });

  // ── GET /api/opportunity-acquisition/cycles ───────────────────────────────────
  app.get("/api/opportunity-acquisition/cycles", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json([]);

      const cycles = rows(await db.execute(sql`
        SELECT * FROM opportunity_acquisition_cycles
        WHERE org_id = ${orgId}
        ORDER BY started_at DESC
        LIMIT 50
      `));

      res.json(cycles.map((c: any) => ({
        id:          c.id,
        startedAt:   c.started_at,
        completedAt: c.completed_at,
        status:      c.status,
        scanned:     n(c.scanned_count),
        discovered:  n(c.discovered_count),
        duplicates:  n(c.duplicates_skipped),
        rejected:    n(c.rejected_count),
        qualified:   n(c.qualified_count),
        drafts:      n(c.drafts_created),
        errors:      Array.isArray(c.errors) ? c.errors : [],
        notes:       c.notes ?? "",
      })));
    } catch (e: any) {
      console.error("[opportunity/cycles]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/opportunity-acquisition/cycles/latest ────────────────────────────
  app.get("/api/opportunity-acquisition/cycles/latest", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json(null);

      const c = row0(await db.execute(sql`
        SELECT * FROM opportunity_acquisition_cycles
        WHERE org_id = ${orgId}
        ORDER BY started_at DESC
        LIMIT 1
      `));

      if (!c) return res.json(null);
      res.json({
        id:          c.id,
        startedAt:   c.started_at,
        completedAt: c.completed_at,
        status:      c.status,
        scanned:     n(c.scanned_count),
        discovered:  n(c.discovered_count),
        duplicates:  n(c.duplicates_skipped),
        rejected:    n(c.rejected_count),
        qualified:   n(c.qualified_count),
        drafts:      n(c.drafts_created),
        errors:      Array.isArray(c.errors) ? c.errors : [],
        notes:       c.notes ?? "",
      });
    } catch (e: any) {
      console.error("[opportunity/cycles/latest]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/opportunity-acquisition/outreach-drafts/:id/send ──────────────
  app.post("/api/opportunity-acquisition/outreach-drafts/:id/send", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      const { id } = req.params;
      const { recipientEmail, recipientName = "" } = req.body;

      if (!recipientEmail || typeof recipientEmail !== "string") {
        return res.status(400).json({ message: "recipientEmail is required" });
      }

      const { executeOutreachDraft } = await import("./services/opportunity-outreach-execution-agent");
      const result = await executeOutreachDraft(orgId, id, recipientEmail, recipientName);
      res.json({ success: true, ...result });
    } catch (e: any) {
      const status = (e as any)?.status ?? 500;
      console.error("[opportunity/outreach-drafts/send]", e);
      res.status(status).json({ message: e.message, executionId: (e as any)?.executionId });
    }
  });

  // ── GET /api/opportunity-acquisition/outreach-executions ─────────────────────
  app.get("/api/opportunity-acquisition/outreach-executions", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.json([]);

      // Ensure table exists
      const { ensureExecutionsTable } = await import("./services/opportunity-outreach-execution-agent");
      await ensureExecutionsTable();

      const execs = rows(await db.execute(sql`
        SELECT e.*,
               o.title    AS opportunity_title,
               o.company  AS opportunity_company
        FROM   opportunity_outreach_executions e
        JOIN   opportunity_acquisition_opportunities o ON o.id = e.opportunity_id
        WHERE  e.org_id = ${orgId}
        ORDER  BY e.created_at DESC
        LIMIT  100
      `));

      res.json(execs.map((x: any) => ({
        id:                  x.id,
        opportunityId:       x.opportunity_id,
        opportunityTitle:    x.opportunity_title ?? "",
        opportunityCompany:  x.opportunity_company ?? "",
        draftId:             x.draft_id,
        recipientName:       x.recipient_name ?? "",
        recipientEmail:      x.recipient_email ?? "",
        subject:             x.subject ?? "",
        agentmailMessageId:  x.agentmail_message_id ?? null,
        status:              x.status,
        deliveryStatus:      x.delivery_status ?? "unknown",
        replyDetected:       Boolean(x.reply_detected),
        sentAt:              x.sent_at ?? null,
        deliveredAt:         x.delivered_at ?? null,
        repliedAt:           x.replied_at ?? null,
        errorMessage:        x.error_message ?? null,
        createdAt:           x.created_at,
      })));
    } catch (e: any) {
      console.error("[opportunity/outreach-executions]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/opportunity-acquisition/outreach-executions/:id ─────────────────
  app.get("/api/opportunity-acquisition/outreach-executions/:id", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });

      const { id } = req.params;
      const x = row0(await db.execute(sql`
        SELECT e.*,
               o.title   AS opportunity_title,
               o.company AS opportunity_company
        FROM   opportunity_outreach_executions e
        JOIN   opportunity_acquisition_opportunities o ON o.id = e.opportunity_id
        WHERE  e.id = ${id} AND e.org_id = ${orgId}
      `));

      if (!x) return res.status(404).json({ message: "Execution not found" });
      res.json({
        id:                 x.id,
        opportunityId:      x.opportunity_id,
        opportunityTitle:   x.opportunity_title ?? "",
        opportunityCompany: x.opportunity_company ?? "",
        draftId:            x.draft_id,
        recipientName:      x.recipient_name ?? "",
        recipientEmail:     x.recipient_email ?? "",
        subject:            x.subject ?? "",
        body:               x.body ?? "",
        agentmailMessageId: x.agentmail_message_id ?? null,
        status:             x.status,
        deliveryStatus:     x.delivery_status ?? "unknown",
        replyDetected:      Boolean(x.reply_detected),
        sentAt:             x.sent_at ?? null,
        deliveredAt:        x.delivered_at ?? null,
        repliedAt:          x.replied_at ?? null,
        errorMessage:       x.error_message ?? null,
        createdAt:          x.created_at,
      });
    } catch (e: any) {
      console.error("[opportunity/outreach-executions/:id]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/opportunity-acquisition/run-scan (legacy alias) ────────────────
  app.post("/api/opportunity-acquisition/run-scan", ...auth, async (req: any, res) => {
    try {
      const orgId = await storage.getOrgContextForUser(resolveUserId(req)).then(r => r?.orgId ?? "");
      if (!orgId) return res.status(403).json({ message: "No organization" });
      const { runOpportunityDiscovery } = await import("./services/opportunity-discovery-agent");
      const result = await runOpportunityDiscovery(orgId);
      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("[opportunity/run-scan]", e);
      res.status(500).json({ message: e.message });
    }
  });

  console.log("[OpportunityAcquisition] Routes registered");
}
