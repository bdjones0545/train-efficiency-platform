import type { Express } from "express";
import { isAuthenticated } from "./replit_integrations/auth";
import { requireRole } from "./lib/require-role";
import { db } from "./db";
import { sql } from "drizzle-orm";

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any { return rows(result)[0] ?? {}; }
function n(v: unknown): number { return Number(v ?? 0); }
function pct(a: number, b: number): number { return b > 0 ? Math.round((a / b) * 100) : 0; }
function safe(v: number): number { return Math.min(100, Math.max(0, Math.round(v))); }

const SEEDED_AGENT_IDS = ["growth_agent", "recovery_agent", "nutrition_agent", "performance_agent",
  "mobility_agent", "strength_agent", "conditioning_agent", "mental_performance_agent", "assessment_agent"];
const SEEDED_ORG_ID = "TrainEfficiency";

export async function registerBetaWave6Routes(app: Express) {

  // ─── PART 1: Developer Pipeline CRUD ──────────────────────────────────────
  app.get("/api/developer-pipeline", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM developer_pipeline ORDER BY updated_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch developer pipeline" }); }
  });

  app.post("/api/developer-pipeline", async (req, res) => {
    try {
      const { name, email, source, industry, organization, stage, notes, is_external = true } = req.body;
      if (!name) return res.status(400).json({ error: "name required" });
      const r = rows(await db.execute(sql`
        INSERT INTO developer_pipeline (id, name, email, source, industry, organization, stage, notes, is_external, contact_date, last_touch)
        VALUES (gen_random_uuid()::text, ${name}, ${email ?? null}, ${source ?? null}, ${industry ?? null},
                ${organization ?? null}, ${stage ?? 'prospect'}, ${notes ?? null}, ${is_external}, NOW(), NOW())
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create pipeline entry" }); }
  });

  app.patch("/api/developer-pipeline/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { stage, next_action, notes, last_touch } = req.body;
      await db.execute(sql`
        UPDATE developer_pipeline SET
          stage       = COALESCE(${stage ?? null}, stage),
          next_action = COALESCE(${next_action ?? null}, next_action),
          notes       = COALESCE(${notes ?? null}, notes),
          last_touch  = COALESCE(${last_touch ? new Date(last_touch) : null}, last_touch),
          updated_at  = NOW()
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to update pipeline entry" }); }
  });

  app.delete("/api/developer-pipeline/:id", async (req, res) => {
    try {
      await db.execute(sql`DELETE FROM developer_pipeline WHERE id = ${req.params.id}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to delete pipeline entry" }); }
  });

  // ─── PART 2: Ambassadors CRUD ─────────────────────────────────────────────
  app.get("/api/marketplace-ambassadors", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM marketplace_ambassadors ORDER BY revenue_generated DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch ambassadors" }); }
  });

  app.post("/api/marketplace-ambassadors", async (req, res) => {
    try {
      const { name, type, email, organization } = req.body;
      if (!name) return res.status(400).json({ error: "name required" });
      const r = rows(await db.execute(sql`
        INSERT INTO marketplace_ambassadors (id, name, type, email, organization)
        VALUES (gen_random_uuid()::text, ${name}, ${type ?? 'coach'}, ${email ?? null}, ${organization ?? null})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create ambassador" }); }
  });

  app.patch("/api/marketplace-ambassadors/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { invites_sent, developers_recruited, orgs_recruited, installs_generated, revenue_generated, status } = req.body;
      await db.execute(sql`
        UPDATE marketplace_ambassadors SET
          invites_sent         = COALESCE(${invites_sent ?? null}, invites_sent),
          developers_recruited = COALESCE(${developers_recruited ?? null}, developers_recruited),
          orgs_recruited       = COALESCE(${orgs_recruited ?? null}, orgs_recruited),
          installs_generated   = COALESCE(${installs_generated ?? null}, installs_generated),
          revenue_generated    = COALESCE(${revenue_generated ?? null}, revenue_generated),
          status               = COALESCE(${status ?? null}, status)
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to update ambassador" }); }
  });

  // ─── PART 5: Developer Success Tracking ───────────────────────────────────
  app.get("/api/platform/developer-success", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const pipeline = rows(await db.execute(sql`
        SELECT dp.*, dra.lifetime_earned,
               COUNT(DISTINCT at2.agent_id) AS agents_published,
               COUNT(DISTINCT oia.id)       AS installs_generated
        FROM developer_pipeline dp
        LEFT JOIN developer_royalty_accounts dra ON dra.developer_id = dp.developer_id
        LEFT JOIN agent_templates at2 ON at2.maintainer = dp.developer_id AND at2.status='active'
        LEFT JOIN org_installed_agents oia ON oia.agent_id = at2.agent_id AND oia.status='active'
        WHERE dp.is_external = true
        GROUP BY dp.id, dra.lifetime_earned
        ORDER BY dp.created_at ASC
      `));

      const stageCounts: Record<string, number> = {};
      const stages = ["prospect","contacted","interested","registered","published_agent","generated_install","generated_revenue","generated_royalty"];
      for (const s of stages) stageCounts[s] = 0;
      for (const p of pipeline) stageCounts[p.stage] = (stageCounts[p.stage] ?? 0) + 1;

      const blocked  = pipeline.filter((p: any) => ["prospect","contacted"].includes(p.stage) && !p.next_action);
      const active   = pipeline.filter((p: any) => !["prospect"].includes(p.stage));
      const earners  = pipeline.filter((p: any) => n(p.lifetime_earned) > 0);

      const funnel = stages.map((s, i) => ({
        stage: s.replace(/_/g, " "),
        count: stageCounts[s],
        rate: i === 0 ? 100 : pct(stageCounts[s], pipeline.length || 1),
      }));

      res.json({
        total: pipeline.length,
        active: active.length,
        blocked: blocked.length,
        earners: earners.length,
        stageCounts,
        funnel,
        developers: pipeline.map((p: any) => ({
          id: p.id, name: p.name, email: p.email, stage: p.stage, source: p.source,
          agentsPublished: n(p.agents_published), installsGenerated: n(p.installs_generated),
          lifetimeEarned: parseFloat(Number(p.lifetime_earned ?? 0).toFixed(2)),
          lastTouch: p.last_touch, nextAction: p.next_action,
          daysInStage: p.updated_at ? Math.floor((Date.now() - new Date(p.updated_at).getTime()) / 86400000) : null,
        })),
        dropoffCauses: [
          { cause: "No next action defined",    count: blocked.length },
          { cause: "Stuck in prospect stage",    count: stageCounts["prospect"] },
          { cause: "Registered but not published",count: stageCounts["registered"] },
        ].filter(d => d.count > 0),
      });
    } catch (e) {
      console.error("[platform/developer-success]", e);
      res.status(500).json({ error: "Failed to compute developer success" });
    }
  });

  // ─── PART 6: Adoption Audit (real vs seeded) ──────────────────────────────
  app.get("/api/platform/adoption-audit", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)                          AS total_devs,
          (SELECT COUNT(*) FROM developer_royalty_accounts
           WHERE developer_id != ${SEEDED_ORG_ID})                                  AS real_devs,
          (SELECT COUNT(*) FROM org_onboarding_sessions)                             AS total_orgs,
          (SELECT COUNT(*) FROM org_onboarding_sessions
           WHERE org_id != ${SEEDED_ORG_ID})                                        AS real_orgs,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')               AS total_agents,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS real_agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')          AS total_installs,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND org_id != ${SEEDED_ORG_ID}
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS real_installs,
          (SELECT COUNT(*) FROM agent_reviews)                                       AS total_reviews,
          (SELECT COUNT(*) FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID})     AS real_reviews,
          (SELECT COUNT(*) FROM ai_revenue_events)                                   AS total_rev,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE org_id != ${SEEDED_ORG_ID}) AS real_rev,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid')   AS total_royalties,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid'
           AND developer_id != ${SEEDED_ORG_ID})                                    AS real_royalties
      `));

      const metrics = [
        { label: "Developers",    total: n(c.total_devs),     real: n(c.real_devs),      seeded: n(c.total_devs) - n(c.real_devs) },
        { label: "Organizations", total: n(c.total_orgs),     real: n(c.real_orgs),      seeded: n(c.total_orgs) - n(c.real_orgs) },
        { label: "Agents",        total: n(c.total_agents),   real: n(c.real_agents),    seeded: n(c.total_agents) - n(c.real_agents) },
        { label: "Installs",      total: n(c.total_installs), real: n(c.real_installs),  seeded: n(c.total_installs) - n(c.real_installs) },
        { label: "Reviews",       total: n(c.total_reviews),  real: n(c.real_reviews),   seeded: n(c.total_reviews) - n(c.real_reviews) },
        { label: "Revenue Events",total: n(c.total_rev),      real: n(c.real_rev),       seeded: n(c.total_rev) - n(c.real_rev) },
        { label: "Royalties",     total: n(c.total_royalties),real: n(c.real_royalties), seeded: n(c.total_royalties) - n(c.real_royalties) },
      ];

      const realActivity = metrics.reduce((a, m) => a + m.real, 0);
      res.json({
        metrics,
        realActivity,
        marketplaceIsReal: realActivity > 0,
        summary: {
          realDevs:     n(c.real_devs),
          realOrgs:     n(c.real_orgs),
          realInstalls: n(c.real_installs),
          realReviews:  n(c.real_reviews),
          realRevenue:  n(c.real_rev),
          realRoyalties:n(c.real_royalties),
        },
        seededIds: { agents: SEEDED_AGENT_IDS, orgs: [SEEDED_ORG_ID] },
      });
    } catch (e) {
      console.error("[platform/adoption-audit]", e);
      res.status(500).json({ error: "Failed to compute adoption audit" });
    }
  });

  // ─── PART 7: Royalty Readiness ─────────────────────────────────────────────
  app.get("/api/platform/royalty-readiness", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM ai_revenue_events WHERE outcome_status='converted')  AS rev_converted,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='pending') AS royalties_pending,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid')    AS royalties_paid,
          (SELECT COALESCE(SUM(developer_share),0) FROM royalty_distributions WHERE payout_status='pending') AS pending_amount,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS real_agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS real_installs
      `));

      const requirements = [
        { requirement: "Real agent published (non-seeded)", met: n(c.real_agents) >= 1,    value: n(c.real_agents) },
        { requirement: "Real agent installed",              met: n(c.real_installs) >= 1,  value: n(c.real_installs) },
        { requirement: "Revenue event converted",           met: n(c.rev_converted) >= 1,  value: n(c.rev_converted) },
        { requirement: "Royalty distribution created",      met: n(c.royalties_pending) + n(c.royalties_paid) >= 1, value: n(c.royalties_pending) + n(c.royalties_paid) },
        { requirement: "Royalty paid out",                  met: n(c.royalties_paid) >= 1, value: n(c.royalties_paid) },
      ];

      const metCount = requirements.filter(r => r.met).length;
      const nextReq  = requirements.find(r => !r.met);

      res.json({
        requirements, metCount, totalRequirements: requirements.length,
        isReady:        n(c.royalties_paid) >= 1,
        pendingAmount:  parseFloat(Number(c.pending_amount).toFixed(2)),
        pendingCount:   n(c.royalties_pending),
        paidCount:      n(c.royalties_paid),
        nextStep:       nextReq?.requirement ?? "All requirements met — royalty loop is live!",
        projectedFirstRoyalty: n(c.rev_converted) >= 1 && n(c.royalties_pending) >= 1 ? "Imminent" : n(c.rev_converted) >= 1 ? "Waiting for distribution" : "Needs first revenue event",
      });
    } catch (e) {
      console.error("[platform/royalty-readiness]", e);
      res.status(500).json({ error: "Failed to compute royalty readiness" });
    }
  });

  // ─── PART 9: First Success Stories ────────────────────────────────────────
  app.get("/api/platform/first-success-stories", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const candidates = rows(await db.execute(sql`
        SELECT
          at2.agent_id, at2.agent_name, at2.maintainer AS developer_id,
          COUNT(DISTINCT oia.id)                       AS installs,
          COUNT(DISTINCT ar.id)                        AS reviews,
          AVG(ar.rating)                               AS avg_rating,
          COALESCE(SUM(rd.developer_share),0)          AS earned,
          CASE
            WHEN COUNT(DISTINCT ar.id) >= 1 AND AVG(ar.rating) >= 4 AND COALESCE(SUM(rd.developer_share),0) > 0
              THEN 'verified'
            WHEN COUNT(DISTINCT ar.id) >= 1 AND AVG(ar.rating) >= 3.5
              THEN 'candidate'
            WHEN COUNT(DISTINCT oia.id) >= 1
              THEN 'installed'
            ELSE 'no_activity'
          END AS story_status
        FROM agent_templates at2
        LEFT JOIN org_installed_agents oia ON oia.agent_id = at2.agent_id AND oia.status='active'
          AND oia.org_id != ${SEEDED_ORG_ID}
        LEFT JOIN agent_reviews ar ON ar.agent_id = at2.agent_id
          AND ar.org_id != ${SEEDED_ORG_ID}
        LEFT JOIN royalty_distributions rd ON rd.agent_id = at2.agent_id AND rd.payout_status='paid'
        WHERE at2.status='active'
          AND at2.agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})
        GROUP BY at2.agent_id, at2.agent_name, at2.maintainer
        ORDER BY avg_rating DESC NULLS LAST, installs DESC
      `));

      const verified   = candidates.filter((c: any) => c.story_status === "verified");
      const candidate_ = candidates.filter((c: any) => c.story_status === "candidate");

      res.json({
        candidates: candidates.map((c: any) => ({
          agentId: c.agent_id, agentName: c.agent_name, developerId: c.developer_id,
          installs: n(c.installs), reviews: n(c.reviews),
          avgRating: c.avg_rating ? parseFloat(Number(c.avg_rating).toFixed(2)) : null,
          earned: parseFloat(Number(c.earned).toFixed(2)),
          status: c.story_status,
        })),
        verified:   verified.length,
        candidates: candidate_.length,
        readyToPublish: verified.length,
      });
    } catch (e) {
      console.error("[platform/first-success-stories]", e);
      res.status(500).json({ error: "Failed to compute first success stories" });
    }
  });

  // ─── PART 10: Founder KPIs ─────────────────────────────────────────────────
  app.get("/api/platform/founder-kpis", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_pipeline WHERE is_external=true)           AS devs_recruited,
          (SELECT COUNT(*) FROM developer_pipeline WHERE is_external=true
           AND stage NOT IN ('prospect'))                                             AS devs_contacted,
          (SELECT COUNT(*) FROM developer_pipeline WHERE is_external=true
           AND stage IN ('registered','published_agent','generated_install','generated_revenue','generated_royalty')) AS devs_registered,
          (SELECT COUNT(*) FROM org_onboarding_sessions WHERE org_id != ${SEEDED_ORG_ID}) AS orgs_recruited,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS agents_published,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS installs_generated,
          (SELECT COUNT(*) FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID})      AS reviews_generated,
          (SELECT COALESCE(SUM(outcome_value),0) FROM ai_revenue_events
           WHERE org_id != ${SEEDED_ORG_ID})                                         AS revenue_generated,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid'
           AND developer_id != ${SEEDED_ORG_ID})                                     AS royalties_generated,
          (SELECT COUNT(*) FROM marketplace_ambassadors WHERE status='active')        AS ambassadors_active
      `));

      const kpis = [
        { label: "Developers Recruited",  value: n(c.devs_recruited),    target: 5,   unit: "people",  wave6Target: true },
        { label: "Developers Contacted",  value: n(c.devs_contacted),    target: 5,   unit: "people",  wave6Target: false },
        { label: "Developers Registered", value: n(c.devs_registered),   target: 5,   unit: "people",  wave6Target: true },
        { label: "Organizations Active",  value: n(c.orgs_recruited),    target: 10,  unit: "orgs",    wave6Target: true },
        { label: "Agents Published",      value: n(c.agents_published),  target: 3,   unit: "agents",  wave6Target: true },
        { label: "Real Installs",         value: n(c.installs_generated),target: 25,  unit: "installs",wave6Target: true },
        { label: "Reviews Generated",     value: n(c.reviews_generated), target: 10,  unit: "reviews", wave6Target: true },
        { label: "Revenue Generated",     value: n(c.revenue_generated), target: 1,   unit: "events",  wave6Target: true },
        { label: "Royalties Generated",   value: n(c.royalties_generated),target: 1,  unit: "events",  wave6Target: true },
        { label: "Active Ambassadors",    value: n(c.ambassadors_active), target: 3,  unit: "people",  wave6Target: false },
      ];

      const wave6kpis = kpis.filter(k => k.wave6Target);
      const overallProgress = Math.round(wave6kpis.reduce((a, k) => a + Math.min((k.value / k.target) * 100, 100), 0) / wave6kpis.length);

      res.json({ kpis, overallProgress, weekOf: new Date().toISOString().slice(0, 10) });
    } catch (e) {
      console.error("[platform/founder-kpis]", e);
      res.status(500).json({ error: "Failed to compute founder KPIs" });
    }
  });

  // ─── PART 11: Marketplace Readiness ───────────────────────────────────────
  app.get("/api/platform/readiness", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts WHERE developer_id != ${SEEDED_ORG_ID}) AS real_devs,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS real_agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS real_installs,
          (SELECT COUNT(*) FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID})      AS real_reviews,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE org_id != ${SEEDED_ORG_ID})  AS real_revenue,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid'
           AND developer_id != ${SEEDED_ORG_ID})                                     AS real_royalties,
          (SELECT COUNT(*) FROM developer_referrals) + (SELECT COUNT(*) FROM org_referrals) AS referrals,
          (SELECT COUNT(*) FROM (SELECT maintainer FROM agent_templates WHERE status='active'
           GROUP BY maintainer HAVING COUNT(*)>=2) t)                                AS repeat_pubs,
          (SELECT COUNT(*) FROM (SELECT org_id FROM org_installed_agents WHERE status='active'
           GROUP BY org_id HAVING COUNT(*)>=2) t)                                    AS repeat_inst
      `));

      const components = {
        developerSupply:   safe(n(c.real_devs) / 5 * 100),
        organizationDemand:safe(n(c.real_installs) / 10 * 100),
        installActivity:   safe(n(c.real_installs) / 25 * 100),
        reviewActivity:    safe(n(c.real_reviews) / 10 * 100),
        revenueActivity:   n(c.real_revenue) >= 1 ? 100 : 0,
        royaltyActivity:   n(c.real_royalties) >= 1 ? 100 : 0,
        referralActivity:  safe(n(c.referrals) / 5 * 100),
        retention:         safe((n(c.repeat_pubs) + n(c.repeat_inst)) * 25),
      };

      const score  = safe(Object.values(components).reduce((a, b) => a + b, 0) / 8);
      const status = score >= 70 ? "Validated" : score >= 50 ? "Active" : score >= 30 ? "Emerging" : score >= 10 ? "Early" : "Not Ready";

      res.json({
        score, status, components,
        wave6Target: 50,
        onTrack: score >= 25,
        lowestComponents: Object.entries(components).sort(([, a], [, b]) => a - b).slice(0, 3).map(([k]) => k.replace(/([A-Z])/g, " $1").trim()),
      });
    } catch (e) {
      console.error("[platform/readiness]", e);
      res.status(500).json({ error: "Failed to compute marketplace readiness" });
    }
  });

  // ─── PART 12: Wave 6 Scorecard ────────────────────────────────────────────
  app.get("/api/platform/wave6-scorecard", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_pipeline WHERE is_external=true
           AND stage IN ('registered','published_agent','generated_install','generated_revenue','generated_royalty')) AS ext_devs_registered,
          (SELECT COUNT(*) FROM developer_pipeline WHERE is_external=true AND stage='published_agent') AS ext_devs_published,
          (SELECT COUNT(*) FROM org_onboarding_sessions WHERE org_id != ${SEEDED_ORG_ID}) AS real_orgs,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS real_installs,
          (SELECT COUNT(*) FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID})      AS real_reviews,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE org_id != ${SEEDED_ORG_ID})  AS real_revenue,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid'
           AND developer_id != ${SEEDED_ORG_ID})                                     AS real_royalties,
          (SELECT COUNT(*) FROM developer_pipeline WHERE is_external=true AND stage='generated_royalty') AS ext_earners
      `));

      const metrics = {
        externalDevsRegistered: { actual: n(c.ext_devs_registered), target: 5 },
        externalDevsPublishing: { actual: n(c.ext_devs_published),  target: 3 },
        organizationsActive:    { actual: n(c.real_orgs),           target: 10 },
        realInstalls:           { actual: n(c.real_installs),        target: 25 },
        realReviews:            { actual: n(c.real_reviews),         target: 10 },
        realRevenueEvents:      { actual: n(c.real_revenue),         target: 1 },
        realRoyaltyEvents:      { actual: n(c.real_royalties),       target: 1 },
        externalEarners:        { actual: n(c.ext_earners),          target: 1 },
      };

      const exitCriteria = [
        { criterion: "≥5 external developers registered",         met: n(c.ext_devs_registered) >= 5 },
        { criterion: "≥3 external developers publish agents",     met: n(c.ext_devs_published) >= 3 },
        { criterion: "≥10 organizations install agents",          met: n(c.real_orgs) >= 10 },
        { criterion: "≥25 real installs",                         met: n(c.real_installs) >= 25 },
        { criterion: "≥10 reviews",                               met: n(c.real_reviews) >= 10 },
        { criterion: "≥1 real revenue event",                     met: n(c.real_revenue) >= 1 },
        { criterion: "≥1 real royalty event",                     met: n(c.real_royalties) >= 1 },
        { criterion: "≥1 external developer earns royalty",       met: n(c.ext_earners) >= 1 },
        { criterion: "Marketplace Readiness > 50",                met: false }, // checked separately
      ];

      const vals = Object.values(metrics);
      const overallScore = safe(vals.reduce((acc, v) => acc + Math.min((v.actual / v.target) * 100, 100), 0) / vals.length);
      const metCount = exitCriteria.filter(e => e.met).length;
      const verdict = metCount >= 9 ? "Wave 6 Complete" : metCount >= 6 ? "Nearly There" : metCount >= 3 ? "In Progress" : "Getting Started";

      res.json({ overallScore, verdict, metrics, exitCriteria, metCriteriaCount: metCount, totalCriteria: exitCriteria.length });
    } catch (e) {
      console.error("[platform/wave6-scorecard]", e);
      res.status(500).json({ error: "Failed to compute wave 6 scorecard" });
    }
  });

  // ─── PART 13: Wave 6 Validation ───────────────────────────────────────────
  app.get("/api/platform/wave6-validation", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status='active')                                      AS agents_ok
        FROM agent_templates
      `));
      const realDevs    = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM developer_royalty_accounts WHERE developer_id != ${SEEDED_ORG_ID}`)).c);
      const realInstalls= n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM org_installed_agents WHERE status='active' AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})`)).c);
      const realRevenue = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM ai_revenue_events WHERE org_id != ${SEEDED_ORG_ID}`)).c);
      const realRoyalties=n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM royalty_distributions WHERE payout_status='paid' AND developer_id != ${SEEDED_ORG_ID}`)).c);
      const realReviews = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID}`)).c);

      const checks = [
        { question: "Infrastructure complete?",         met: n(c.agents_ok) >= 1,   evidence: `${n(c.agents_ok)} agents available` },
        { question: "Marketplace active (any installs)?",met: realInstalls >= 1,    evidence: `${realInstalls} real installs` },
        { question: "Developer supply exists?",          met: realDevs >= 1,        evidence: `${realDevs} real developers` },
        { question: "Organization demand exists?",       met: realInstalls >= 1,    evidence: `${realInstalls} real installs` },
        { question: "Royalty loop exists?",              met: realRoyalties >= 1,   evidence: `${realRoyalties} paid royalties` },
        { question: "Success stories exist?",            met: realReviews >= 1,     evidence: `${realReviews} real reviews` },
        { question: "Revenue loop closed?",              met: realRevenue >= 1,     evidence: `${realRevenue} real revenue events` },
      ];

      const metCount = checks.filter(c => c.met).length;
      const verdict = metCount >= 7 ? "Strongly Validated" : metCount >= 5 ? "Validated" : metCount >= 3 ? "Partially Validated" : "Not Validated";

      res.json({ checks, metCount, totalChecks: 7, verdict, marketplaceIsReal: realInstalls >= 1 && realDevs >= 1 });
    } catch (e) {
      console.error("[platform/wave6-validation]", e);
      res.status(500).json({ error: "Failed to compute wave 6 validation" });
    }
  });

  // ─── PART 14: Hall of Fame Expansion ──────────────────────────────────────
  app.get("/api/community/hall-of-fame-expansion", async (_req, res) => {
    try {
      const firstExtDev = row0(await db.execute(sql`
        SELECT developer_id, created_at FROM developer_royalty_accounts
        WHERE developer_id != ${SEEDED_ORG_ID} ORDER BY created_at ASC LIMIT 1
      `));
      const firstExtPub = row0(await db.execute(sql`
        SELECT maintainer AS developer_id, agent_name, agent_id, created_at FROM agent_templates
        WHERE status='active' AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})
        ORDER BY created_at ASC LIMIT 1
      `));
      const firstExtInstall = row0(await db.execute(sql`
        SELECT oia.org_id, oia.agent_id, oia.created_at, at2.agent_name
        FROM org_installed_agents oia
        LEFT JOIN agent_templates at2 ON at2.agent_id = oia.agent_id
        WHERE oia.status='active'
          AND oia.agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})
        ORDER BY oia.created_at ASC LIMIT 1
      `));
      const firstExtReview = row0(await db.execute(sql`
        SELECT ar.id, ar.org_id, ar.agent_id, ar.rating, ar.created_at, at2.agent_name
        FROM agent_reviews ar
        LEFT JOIN agent_templates at2 ON at2.agent_id = ar.agent_id
        WHERE ar.org_id != ${SEEDED_ORG_ID}
        ORDER BY ar.created_at ASC LIMIT 1
      `));
      const firstExtRevenue = row0(await db.execute(sql`
        SELECT id, org_id, action_type, outcome_value, created_at FROM ai_revenue_events
        WHERE org_id != ${SEEDED_ORG_ID} ORDER BY created_at ASC LIMIT 1
      `));
      const firstExtRoyalty = row0(await db.execute(sql`
        SELECT developer_id, developer_share, agent_id, created_at FROM royalty_distributions
        WHERE payout_status='paid' AND developer_id != ${SEEDED_ORG_ID}
        ORDER BY created_at ASC LIMIT 1
      `));

      res.json({
        expansionMilestones: [
          { title: "First External Developer",    icon: "👤", recipient: firstExtDev.developer_id ?? null,    detail: "First developer from outside TrainEfficiency",  date: firstExtDev.created_at ?? null,    met: !!firstExtDev.developer_id },
          { title: "First External Publisher",    icon: "🚀", recipient: firstExtPub.developer_id ?? null,    detail: firstExtPub.agent_name ?? null,                  date: firstExtPub.created_at ?? null,    met: !!firstExtPub.developer_id },
          { title: "First External Install",      icon: "⚡", recipient: firstExtInstall.org_id ?? null,      detail: firstExtInstall.agent_name ?? null,              date: firstExtInstall.created_at ?? null,met: !!firstExtInstall.org_id },
          { title: "First External Review",       icon: "⭐", recipient: firstExtReview.org_id ?? null,       detail: firstExtReview.agent_name ? `${firstExtReview.agent_name} — ${n(firstExtReview.rating)} stars` : null, date: firstExtReview.created_at ?? null, met: !!firstExtReview.org_id },
          { title: "First External Revenue Event",icon: "💰", recipient: firstExtRevenue.org_id ?? null,      detail: firstExtRevenue.outcome_value ? `$${n(firstExtRevenue.outcome_value)} value` : null, date: firstExtRevenue.created_at ?? null, met: !!firstExtRevenue.org_id },
          { title: "First External Royalty",      icon: "💎", recipient: firstExtRoyalty.developer_id ?? null,detail: firstExtRoyalty.developer_share ? `$${parseFloat(Number(firstExtRoyalty.developer_share).toFixed(2))} earned` : null, date: firstExtRoyalty.created_at ?? null, met: !!firstExtRoyalty.developer_id },
        ],
        externalActivityExists: !!firstExtInstall.org_id || !!firstExtDev.developer_id,
      });
    } catch (e) {
      console.error("[community/hall-of-fame-expansion]", e);
      res.status(500).json({ error: "Failed to compute hall of fame expansion" });
    }
  });
}
