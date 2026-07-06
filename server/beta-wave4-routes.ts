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
function row0(result: unknown): any {
  return rows(result)[0] ?? {};
}
function n(v: unknown): number { return Number(v ?? 0); }
function pct(a: number, b: number): number { return b > 0 ? Math.round((a / b) * 100) : 0; }

export async function registerBetaWave4Routes(app: Express) {

  // ─── PART 1: Ecosystem Outreach data ──────────────────────────────────────
  app.get("/api/platform/ecosystem-outreach", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM beta_invites WHERE role = 'developer')                   AS devs_invited,
          (SELECT COUNT(*) FROM developer_campaigns WHERE status='active')               AS dev_campaigns_active,
          (SELECT COUNT(*) FROM developer_royalty_accounts)                              AS devs_onboarded,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                   AS agents_published,
          (SELECT COUNT(*) FROM beta_invites WHERE role != 'developer')                  AS orgs_invited,
          (SELECT COUNT(*) FROM org_onboarding_sessions)                                 AS orgs_activated,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')              AS installations,
          (SELECT COUNT(*) FROM agent_reviews)                                           AS reviews,
          (SELECT COUNT(*) FROM ai_revenue_events)                                       AS revenue_events
      `));

      const devCampaigns = rows(await db.execute(sql`SELECT * FROM developer_campaigns ORDER BY created_at DESC LIMIT 10`));
      const orgCampaigns = rows(await db.execute(sql`SELECT * FROM org_campaigns ORDER BY created_at DESC LIMIT 10`));

      const devsInv = n(c.devs_invited), devsOnboard = n(c.devs_onboarded);
      const orgsInv = n(c.orgs_invited), orgsAct = n(c.orgs_activated);

      res.json({
        developerFunnel: [
          { stage: "Invited",       count: devsInv,             rate: 100 },
          { stage: "Responded",     count: 0,                   rate: 0 },
          { stage: "Onboarded",     count: devsOnboard,         rate: pct(devsOnboard, devsInv) },
          { stage: "Published Agent",count: n(c.agents_published),rate: pct(n(c.agents_published), devsOnboard) },
        ],
        organizationFunnel: [
          { stage: "Invited",       count: orgsInv,             rate: 100 },
          { stage: "Activated",     count: orgsAct,             rate: pct(orgsAct, orgsInv) },
          { stage: "Installed",     count: n(c.installations),  rate: pct(n(c.installations), orgsAct) },
          { stage: "Reviewed",      count: n(c.reviews),        rate: pct(n(c.reviews), n(c.installations)) },
          { stage: "Revenue Event", count: n(c.revenue_events), rate: pct(n(c.revenue_events), n(c.reviews)) },
        ],
        totals: {
          devsInvited: devsInv, devsOnboarded: devsOnboard,
          agentsPublished: n(c.agents_published),
          orgsInvited: orgsInv, orgsActivated: orgsAct,
          installations: n(c.installations), reviews: n(c.reviews), revenueEvents: n(c.revenue_events),
        },
        devCampaigns,
        orgCampaigns,
      });
    } catch (e) {
      console.error("[platform/ecosystem-outreach]", e);
      res.status(500).json({ error: "Failed to compute ecosystem outreach" });
    }
  });

  // ─── PART 2: Developer Campaigns CRUD ─────────────────────────────────────
  app.get("/api/campaigns/developer", async (_req, res) => {
    try { res.json(rows(await db.execute(sql`SELECT * FROM developer_campaigns ORDER BY created_at DESC`))); }
    catch (e) { res.status(500).json({ error: "Failed to fetch developer campaigns" }); }
  });

  app.post("/api/campaigns/developer", async (req, res) => {
    try {
      const { name, audience, channel, messages_sent } = req.body;
      if (!name) return res.status(400).json({ error: "name required" });
      const r = rows(await db.execute(sql`
        INSERT INTO developer_campaigns (id, name, audience, channel, messages_sent)
        VALUES (gen_random_uuid()::text, ${name}, ${audience ?? null}, ${channel ?? 'email'}, ${messages_sent ?? 0})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create developer campaign" }); }
  });

  app.patch("/api/campaigns/developer/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { responses, registrations, agents_published, installs_generated, revenue_generated, status } = req.body;
      await db.execute(sql`
        UPDATE developer_campaigns SET
          responses         = COALESCE(${responses ?? null}, responses),
          registrations     = COALESCE(${registrations ?? null}, registrations),
          agents_published  = COALESCE(${agents_published ?? null}, agents_published),
          installs_generated= COALESCE(${installs_generated ?? null}, installs_generated),
          revenue_generated = COALESCE(${revenue_generated ?? null}, revenue_generated),
          status            = COALESCE(${status ?? null}, status)
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to update developer campaign" }); }
  });

  // ─── PART 3: Org Campaigns CRUD ───────────────────────────────────────────
  app.get("/api/campaigns/org", async (_req, res) => {
    try { res.json(rows(await db.execute(sql`SELECT * FROM org_campaigns ORDER BY created_at DESC`))); }
    catch (e) { res.status(500).json({ error: "Failed to fetch org campaigns" }); }
  });

  app.post("/api/campaigns/org", async (req, res) => {
    try {
      const { name, audience, channel, invitations } = req.body;
      if (!name) return res.status(400).json({ error: "name required" });
      const r = rows(await db.execute(sql`
        INSERT INTO org_campaigns (id, name, audience, channel, invitations)
        VALUES (gen_random_uuid()::text, ${name}, ${audience ?? null}, ${channel ?? 'email'}, ${invitations ?? 0})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create org campaign" }); }
  });

  app.patch("/api/campaigns/org/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { activations, installs, executions, reviews, revenue_impact, status } = req.body;
      await db.execute(sql`
        UPDATE org_campaigns SET
          activations    = COALESCE(${activations ?? null}, activations),
          installs       = COALESCE(${installs ?? null}, installs),
          executions     = COALESCE(${executions ?? null}, executions),
          reviews        = COALESCE(${reviews ?? null}, reviews),
          revenue_impact = COALESCE(${revenue_impact ?? null}, revenue_impact),
          status         = COALESCE(${status ?? null}, status)
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to update org campaign" }); }
  });

  // ─── PART 4: Publisher Rewards CRUD ───────────────────────────────────────
  app.get("/api/publisher-rewards", async (_req, res) => {
    try { res.json(rows(await db.execute(sql`SELECT * FROM publisher_rewards ORDER BY created_at DESC`))); }
    catch (e) { res.status(500).json({ error: "Failed to fetch publisher rewards" }); }
  });

  app.post("/api/publisher-rewards", async (req, res) => {
    try {
      const { developer_id, milestone, badge_name, badge_color, agent_id } = req.body;
      if (!developer_id || !milestone) return res.status(400).json({ error: "developer_id and milestone required" });
      const r = rows(await db.execute(sql`
        INSERT INTO publisher_rewards (id, developer_id, milestone, badge_name, badge_color, agent_id)
        VALUES (gen_random_uuid()::text, ${developer_id}, ${milestone}, ${badge_name ?? milestone}, ${badge_color ?? 'gold'}, ${agent_id ?? null})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create publisher reward" }); }
  });

  app.patch("/api/publisher-rewards/:id/reach", async (req, res) => {
    try {
      const { id } = req.params;
      await db.execute(sql`
        UPDATE publisher_rewards SET reached=true, reached_at=NOW() WHERE id=${id}
      `);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to mark reward reached" }); }
  });

  // ─── PART 5: Marketplace Revenue ──────────────────────────────────────────
  app.get("/api/platform/marketplace-revenue", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const totals = row0(await db.execute(sql`
        SELECT
          COUNT(*)                               AS total_events,
          COALESCE(SUM(outcome_value),0)         AS total_revenue,
          COUNT(*) FILTER (WHERE outcome_status='converted') AS converted_events
        FROM ai_revenue_events
      `));
      const royalties = row0(await db.execute(sql`
        SELECT
          COALESCE(SUM(developer_share),0)       AS dev_revenue,
          COALESCE(SUM(gross_revenue - developer_share), 0) AS platform_revenue,
          COUNT(*) FILTER (WHERE payout_status='paid') AS paid_count
        FROM royalty_distributions
      `));
      const byAgent = rows(await db.execute(sql`
        SELECT action_source AS agent_id, COUNT(*) AS events,
               COALESCE(SUM(outcome_value),0) AS revenue
        FROM ai_revenue_events
        GROUP BY action_source ORDER BY revenue DESC LIMIT 10
      `));
      const totalRevenue = n(totals.total_revenue);
      const devRevenue   = parseFloat(Number(royalties.dev_revenue ?? 0).toFixed(2));
      const platRevenue  = parseFloat(Number(royalties.platform_revenue ?? 0).toFixed(2));

      res.json({
        totals: { totalRevenue, devRevenue, platformRevenue: platRevenue, royaltyRevenue: devRevenue, events: n(totals.total_events), convertedEvents: n(totals.converted_events) },
        byAgent: byAgent.map((a: any) => ({ agentId: a.agent_id, events: n(a.events), revenue: parseFloat(Number(a.revenue).toFixed(2)) })),
        projected: { total: 0, note: "No projections — only real revenue tracked" },
        actual:    { total: totalRevenue },
        modelValidated: n(totals.total_events) >= 1,
      });
    } catch (e) {
      console.error("[platform/marketplace-revenue]", e);
      res.status(500).json({ error: "Failed to compute marketplace revenue" });
    }
  });

  // ─── PART 6: Install Activation Engine ────────────────────────────────────
  app.get("/api/platform/install-activation", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const steps = rows(await db.execute(sql`
        SELECT
          oia.id,
          oia.agent_id,
          oia.org_id,
          oia.created_at                                     AS installed_at,
          oos.time_to_first_execution,
          oos.time_to_first_outcome,
          oos.time_to_first_review,
          oos.completed
        FROM org_installed_agents oia
        LEFT JOIN org_onboarding_sessions oos ON oos.org_id = oia.org_id
        WHERE oia.status = 'active'
        ORDER BY oia.created_at DESC
        LIMIT 50
      `));

      const withExec     = steps.filter((s: any) => s.time_to_first_execution).length;
      const withOutcome  = steps.filter((s: any) => s.time_to_first_outcome).length;
      const withReview   = steps.filter((s: any) => s.time_to_first_review).length;
      const completed    = steps.filter((s: any) => s.completed).length;
      const total        = steps.length;

      const avgExecTime    = steps.filter((s: any) => s.time_to_first_execution).reduce((a: number, s: any) => a + n(s.time_to_first_execution), 0) / (withExec || 1);
      const avgOutcomeTime = steps.filter((s: any) => s.time_to_first_outcome).reduce((a: number, s: any) => a + n(s.time_to_first_outcome), 0) / (withOutcome || 1);
      const avgReviewTime  = steps.filter((s: any) => s.time_to_first_review).reduce((a: number, s: any) => a + n(s.time_to_first_review), 0) / (withReview || 1);

      const path = [
        { step: "Install",        reached: total,       rate: 100,               avgHours: null },
        { step: "First Execution",reached: withExec,    rate: pct(withExec, total),   avgHours: withExec ? Math.round(avgExecTime / 3600) : null },
        { step: "First Outcome",  reached: withOutcome, rate: pct(withOutcome, total), avgHours: withOutcome ? Math.round(avgOutcomeTime / 3600) : null },
        { step: "First Review",   reached: withReview,  rate: pct(withReview, total),  avgHours: withReview ? Math.round(avgReviewTime / 3600) : null },
        { step: "Completed",      reached: completed,   rate: pct(completed, total),   avgHours: null },
      ];

      const slowestStep = path.slice(1).reduce((s, c) => (c.avgHours ?? 0) > (s.avgHours ?? 0) ? c : s, path[1]);

      res.json({
        totalInstalls: total, path, slowestStep: slowestStep.step,
        timeToValueScore: total > 0 ? Math.round((withExec / total) * 100) : 0,
        recommendation: withExec < total * 0.5 ? "Focus on reducing time-to-first-execution" : withOutcome < total * 0.5 ? "Focus on driving first outcomes after execution" : "Activation path is healthy",
      });
    } catch (e) {
      console.error("[platform/install-activation]", e);
      res.status(500).json({ error: "Failed to compute install activation" });
    }
  });

  // ─── PART 7: Friction Analyzer ────────────────────────────────────────────
  app.get("/api/platform/friction", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const devDropoff = rows(await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE at2.id IS NULL)               AS stuck_no_agent,
          COUNT(*) FILTER (WHERE at2.status='pending_review')  AS stuck_pending_review,
          COUNT(*) FILTER (WHERE oia.id IS NULL AND at2.id IS NOT NULL) AS stuck_no_install
        FROM developer_royalty_accounts dra
        LEFT JOIN agent_templates at2  ON at2.maintainer = dra.developer_id AND at2.status='active'
        LEFT JOIN org_installed_agents oia ON oia.agent_id = at2.agent_id AND oia.status='active'
      `));
      const orgDropoff = rows(await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE oia.id IS NULL)                AS stuck_no_install,
          COUNT(*) FILTER (WHERE oia.id IS NOT NULL AND oos.time_to_first_execution IS NULL) AS stuck_no_exec,
          COUNT(*) FILTER (WHERE oos.time_to_first_execution IS NOT NULL AND ar.id IS NULL)  AS stuck_no_review
        FROM org_onboarding_sessions oos
        LEFT JOIN org_installed_agents oia ON oia.org_id = oos.org_id AND oia.status='active'
        LEFT JOIN agent_reviews ar         ON ar.org_id  = oos.org_id
      `));

      const devD = devDropoff[0] ?? {};
      const orgD = orgDropoff[0] ?? {};

      const devFrictions = [
        { stage: "Registered → Published Agent",  count: n(devD.stuck_no_agent),       priority: n(devD.stuck_no_agent) > 2 ? "high" : "medium",    fix: "Send first-publish guide, offer template agents" },
        { stage: "Submitted → Published (Review)", count: n(devD.stuck_pending_review), priority: "high",                                             fix: "Reduce review queue time — target 48h turnaround" },
        { stage: "Published → First Install",      count: n(devD.stuck_no_install),     priority: n(devD.stuck_no_install) > 3 ? "high" : "medium",  fix: "Feature new agents on homepage, reach out to matching orgs" },
      ];
      const orgFrictions = [
        { stage: "Activated → First Install",       count: n(orgD.stuck_no_install), priority: n(orgD.stuck_no_install) > 3 ? "high" : "medium", fix: "Personalized agent recommendations at onboarding" },
        { stage: "Installed → First Execution",     count: n(orgD.stuck_no_exec),    priority: n(orgD.stuck_no_exec) > 2 ? "high" : "medium",    fix: "Auto-trigger first execution walkthrough in-app" },
        { stage: "Executed → First Review",         count: n(orgD.stuck_no_review),  priority: "medium",                                          fix: "Send review request email 24h after first execution" },
      ];

      const allFrictions = [...devFrictions, ...orgFrictions].sort((a, b) => b.count - a.count);

      res.json({
        developerFrictions: devFrictions,
        organizationFrictions: orgFrictions,
        topPriority: allFrictions[0] ?? null,
        rankedFixes: allFrictions.map((f, i) => ({ rank: i + 1, stage: f.stage, count: f.count, priority: f.priority, fix: f.fix })),
        frictionScore: Math.max(0, 100 - allFrictions.reduce((a, f) => a + f.count * 5, 0)),
      });
    } catch (e) {
      console.error("[platform/friction]", e);
      res.status(500).json({ error: "Failed to compute friction analysis" });
    }
  });

  // ─── PART 8: Referral Growth Engine ───────────────────────────────────────
  app.get("/api/platform/referral-growth", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const dr = row0(await db.execute(sql`
        SELECT
          COUNT(*)                                           AS total,
          COUNT(*) FILTER (WHERE status='accepted')         AS accepted,
          COUNT(*) FILTER (WHERE published_agent=true)      AS converted_publish,
          COALESCE(SUM(generated_revenue),0)                AS revenue
        FROM developer_referrals
      `));
      const or = row0(await db.execute(sql`
        SELECT
          COUNT(*)                                           AS total,
          COUNT(*) FILTER (WHERE status='accepted')         AS accepted,
          COUNT(*) FILTER (WHERE installed_agent=true)      AS converted_install,
          COALESCE(SUM(generated_revenue),0)                AS revenue
        FROM org_referrals
      `));

      const totalSent     = n(dr.total) + n(or.total);
      const totalAccepted = n(dr.accepted) + n(or.accepted);
      const totalRevenue  = parseFloat(Number(n(dr.revenue) + n(or.revenue)).toFixed(2));
      const totalConverted= n(dr.converted_publish) + n(or.converted_install);

      const roi = totalSent > 0
        ? parseFloat((totalRevenue / (totalSent * 1 /* $1 cost per invite */)).toFixed(2))
        : 0;
      const growthScore = Math.min(100,
        totalSent * 5 + totalAccepted * 10 + totalConverted * 20 + (totalRevenue > 0 ? 30 : 0)
      );

      res.json({
        invitations:  { developer: n(dr.total), org: n(or.total), total: totalSent },
        conversions:  { developer: n(dr.converted_publish), org: n(or.converted_install), total: totalConverted },
        revenue:      { developer: parseFloat(Number(dr.revenue).toFixed(2)), org: parseFloat(Number(or.revenue).toFixed(2)), total: totalRevenue },
        rates:        { devAcceptance: pct(n(dr.accepted), n(dr.total)), orgAcceptance: pct(n(or.accepted), n(or.total)), overall: pct(totalAccepted, totalSent) },
        referralRoi:  roi,
        growthScore,
        wave4Target:  5,
        wave4Progress:Math.min(100, Math.round((totalSent / 5) * 100)),
      });
    } catch (e) {
      console.error("[platform/referral-growth]", e);
      res.status(500).json({ error: "Failed to compute referral growth" });
    }
  });

  // ─── PART 10: Marketplace Transactions ────────────────────────────────────
  app.get("/api/platform/transactions", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const installs = rows(await db.execute(sql`
        SELECT oia.id, oia.agent_id, oia.org_id, oia.status, oia.created_at, at2.agent_name
        FROM org_installed_agents oia
        LEFT JOIN agent_templates at2 ON at2.agent_id = oia.agent_id
        ORDER BY oia.created_at DESC LIMIT 20
      `));
      const revEvents = rows(await db.execute(sql`
        SELECT id, org_id, action_type, outcome_status, outcome_value, created_at
        FROM ai_revenue_events ORDER BY created_at DESC LIMIT 20
      `));
      const royaltyDists = rows(await db.execute(sql`
        SELECT id, developer_id, agent_id, developer_share, payout_status, created_at
        FROM royalty_distributions ORDER BY created_at DESC LIMIT 20
      `));
      const referrals = rows(await db.execute(sql`
        SELECT id, referrer_id, referee_email, status, 'developer' AS type, created_at FROM developer_referrals
        UNION ALL
        SELECT id, referrer_id, referee_email, status, 'org' AS type, created_at FROM org_referrals
        ORDER BY created_at DESC LIMIT 20
      `));
      const reviews = rows(await db.execute(sql`
        SELECT id, agent_id, org_id, rating, created_at FROM agent_reviews ORDER BY created_at DESC LIMIT 20
      `));

      res.json({
        installs:    installs.map((i: any) => ({ id: i.id, agentId: i.agent_id, agentName: i.agent_name, orgId: i.org_id, status: i.status, at: i.created_at })),
        revenueEvents: revEvents.map((e: any) => ({ id: e.id, orgId: e.org_id, type: e.action_type, status: e.outcome_status, value: n(e.outcome_value), at: e.created_at })),
        royalties:   royaltyDists.map((r: any) => ({ id: r.id, devId: r.developer_id, agentId: r.agent_id, share: parseFloat(Number(r.developer_share).toFixed(2)), status: r.payout_status, at: r.created_at })),
        referrals:   referrals.map((r: any) => ({ id: r.id, referrerId: r.referrer_id, email: r.referee_email, status: r.status, type: r.type, at: r.created_at })),
        reviews:     reviews.map((r: any) => ({ id: r.id, agentId: r.agent_id, orgId: r.org_id, rating: n(r.rating), at: r.created_at })),
        summary: {
          totalInstalls:   installs.length,
          totalRevEvents:  revEvents.length,
          totalRoyalties:  royaltyDists.length,
          totalReferrals:  referrals.length,
          totalReviews:    reviews.length,
        },
      });
    } catch (e) {
      console.error("[platform/transactions]", e);
      res.status(500).json({ error: "Failed to compute transactions" });
    }
  });

  // ─── PART 11: Participant Success ─────────────────────────────────────────
  app.get("/api/platform/participant-success", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const valueOrgs = rows(await db.execute(sql`
        SELECT oos.org_id, COUNT(DISTINCT oia.id) AS installs, COUNT(DISTINCT ar.id) AS reviews
        FROM org_onboarding_sessions oos
        LEFT JOIN org_installed_agents oia ON oia.org_id = oos.org_id AND oia.status='active'
        LEFT JOIN agent_reviews ar         ON ar.org_id  = oos.org_id
        GROUP BY oos.org_id
        HAVING COUNT(DISTINCT oia.id) > 0
        ORDER BY installs DESC LIMIT 20
      `));
      const earnDevs = rows(await db.execute(sql`
        SELECT dra.developer_id, dra.lifetime_earned, COUNT(DISTINCT oia.id) AS installs
        FROM developer_royalty_accounts dra
        LEFT JOIN agent_templates at2       ON at2.maintainer = dra.developer_id AND at2.status='active'
        LEFT JOIN org_installed_agents oia  ON oia.agent_id = at2.agent_id AND oia.status='active'
        GROUP BY dra.developer_id, dra.lifetime_earned
        HAVING COUNT(DISTINCT oia.id) > 0 OR dra.lifetime_earned > 0
        ORDER BY dra.lifetime_earned DESC LIMIT 20
      `));
      const reviewers = rows(await db.execute(sql`
        SELECT org_id, COUNT(*) AS review_count FROM agent_reviews
        GROUP BY org_id ORDER BY review_count DESC LIMIT 10
      `));
      const referrers = rows(await db.execute(sql`
        SELECT referrer_id, COUNT(*) AS referral_count, 'developer' AS type FROM developer_referrals GROUP BY referrer_id
        UNION ALL
        SELECT referrer_id, COUNT(*) AS referral_count, 'org' AS type FROM org_referrals GROUP BY referrer_id
        ORDER BY referral_count DESC LIMIT 10
      `));

      res.json({
        orgsGeneratingValue:    valueOrgs.map((o: any) => ({ orgId: o.org_id, installs: n(o.installs), reviews: n(o.reviews) })),
        devsGeneratingInstalls: earnDevs.filter((d: any) => n(d.installs) > 0).map((d: any) => ({ devId: d.developer_id, installs: n(d.installs), earned: parseFloat(Number(d.lifetime_earned).toFixed(2)) })),
        devsEarningRoyalties:   earnDevs.filter((d: any) => n(d.lifetime_earned) > 0).map((d: any) => ({ devId: d.developer_id, earned: parseFloat(Number(d.lifetime_earned).toFixed(2)) })),
        activeReviewers:        reviewers.map((r: any) => ({ orgId: r.org_id, reviews: n(r.review_count) })),
        activeReferrers:        referrers.map((r: any) => ({ id: r.referrer_id, count: n(r.referral_count), type: r.type })),
        caseStudyCandidates:    valueOrgs.filter((o: any) => n(o.reviews) > 0).length,
      });
    } catch (e) {
      console.error("[platform/participant-success]", e);
      res.status(500).json({ error: "Failed to compute participant success" });
    }
  });

  // ─── PART 12: Activation Score ────────────────────────────────────────────
  app.get("/api/platform/activation-score", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)              AS devs,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')   AS agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active') AS installs,
          (SELECT COUNT(*) FROM agent_reviews)                           AS reviews,
          (SELECT COUNT(*) FROM ai_revenue_events)                       AS rev_events,
          (SELECT COUNT(*) FROM developer_referrals) + (SELECT COUNT(*) FROM org_referrals) AS referrals,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active') * 100.0
            / NULLIF((SELECT COUNT(*) FROM org_installed_agents),0)     AS retention_pct,
          (SELECT COUNT(*) FROM (
            SELECT maintainer FROM agent_templates WHERE status='active'
            GROUP BY maintainer HAVING COUNT(*) >= 2) t)                AS repeat_pubs,
          (SELECT COUNT(*) FROM (
            SELECT org_id FROM org_installed_agents WHERE status='active'
            GROUP BY org_id HAVING COUNT(*) >= 2) t)                    AS repeat_inst
      `));

      const devAct  = Math.min(100, Math.round(n(c.devs)     / 5  * 100));
      const orgAct  = Math.min(100, Math.round(n(c.installs) / 10 * 100));
      const instAct = Math.min(100, Math.round(n(c.installs) / 25 * 100));
      const revAct  = Math.min(100, Math.round(n(c.reviews)  / 10 * 100));
      const revenAct= Math.min(100, n(c.rev_events) >= 1 ? 100 : 0);
      const refAct  = Math.min(100, Math.round(n(c.referrals)/ 5  * 100));
      const retAct  = Math.min(100, parseFloat(Number(c.retention_pct ?? 0).toFixed(1)));
      const repAct  = Math.min(100, (n(c.repeat_pubs) >= 1 && n(c.repeat_inst) >= 1) ? 100 : (n(c.repeat_pubs) >= 1 || n(c.repeat_inst) >= 1) ? 50 : 0);

      const components = { developerActivity: devAct, organizationActivity: orgAct, installs: instAct, reviews: revAct, revenue: revenAct, referrals: refAct, retention: retAct, repeatUsage: repAct };
      const score = Math.round(Object.values(components).reduce((a, b) => a + b, 0) / 8);
      const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F";
      const status = score >= 70 ? "Active" : score >= 40 ? "Emerging" : "Building";

      const weakest = Object.entries(components).sort(([, a], [, b]) => a - b).slice(0, 3).map(([k]) => k.replace(/([A-Z])/g, " $1").trim());

      res.json({
        score, grade, status, components,
        weakestAreas: weakest,
        trend: "Building",
        wave4Target: 50,
        onTrack: score >= 25,
      });
    } catch (e) {
      console.error("[platform/activation-score]", e);
      res.status(500).json({ error: "Failed to compute activation score" });
    }
  });

  // ─── PART 13: Marketplace Validation ──────────────────────────────────────
  app.get("/api/platform/marketplace-validation", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')              AS real_installs,
          (SELECT COUNT(*) FROM agent_reviews)                                           AS real_reviews,
          (SELECT COUNT(*) FROM developer_referrals) + (SELECT COUNT(*) FROM org_referrals) AS real_referrals,
          (SELECT COUNT(*) FROM ai_revenue_events)                                       AS real_revenue,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid')       AS real_royalties,
          (SELECT COUNT(*) FROM (
            SELECT maintainer FROM agent_templates WHERE status='active'
            GROUP BY maintainer HAVING COUNT(*) >= 2) t)                               AS second_dev_published,
          (SELECT COUNT(*) FROM (
            SELECT org_id FROM org_installed_agents WHERE status='active'
            GROUP BY org_id HAVING COUNT(*) >= 2) t)                                   AS second_org_installed
      `));

      const checks = [
        { question: "Real installs occurred?",            met: n(c.real_installs) >= 1,         value: n(c.real_installs) },
        { question: "Real reviews occurred?",             met: n(c.real_reviews) >= 1,          value: n(c.real_reviews) },
        { question: "Real referrals occurred?",           met: n(c.real_referrals) >= 1,        value: n(c.real_referrals) },
        { question: "Real revenue event occurred?",       met: n(c.real_revenue) >= 1,          value: n(c.real_revenue) },
        { question: "Real royalty event occurred?",       met: n(c.real_royalties) >= 1,        value: n(c.real_royalties) },
        { question: "Second developer published?",        met: n(c.second_dev_published) >= 1,  value: n(c.second_dev_published) },
        { question: "Second org installed second agent?", met: n(c.second_org_installed) >= 1,  value: n(c.second_org_installed) },
      ];
      const metCount = checks.filter(c => c.met).length;
      const verdict  = metCount >= 7 ? "Validated" : metCount >= 5 ? "Active" : metCount >= 2 ? "Emerging" : "Not Active";

      res.json({ checks, metCount, totalChecks: 7, verdict, marketplaceExists: metCount >= 2 });
    } catch (e) {
      console.error("[platform/marketplace-validation]", e);
      res.status(500).json({ error: "Failed to compute marketplace validation" });
    }
  });

  // ─── PART 14: Wave 4 Scorecard ────────────────────────────────────────────
  app.get("/api/platform/wave4-scorecard", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)                                 AS devs,
          (SELECT COUNT(*) FROM org_onboarding_sessions)                                    AS orgs,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                      AS agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')                 AS installs,
          (SELECT COUNT(*) FROM agent_reviews)                                              AS reviews,
          (SELECT COUNT(*) FROM developer_referrals) + (SELECT COUNT(*) FROM org_referrals) AS referrals,
          (SELECT COUNT(*) FROM ai_revenue_events)                                          AS rev_events,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid')          AS royalty_events,
          (SELECT COUNT(*) FROM (
            SELECT maintainer FROM agent_templates WHERE status='active'
            GROUP BY maintainer HAVING COUNT(*) >= 2) t)                                   AS repeat_publishers,
          (SELECT COUNT(*) FROM (
            SELECT org_id FROM org_installed_agents WHERE status='active'
            GROUP BY org_id HAVING COUNT(*) >= 2) t)                                       AS repeat_installers
      `));

      const metrics = {
        developers:        { actual: n(c.devs),              target: 5  },
        organizations:     { actual: n(c.orgs),              target: 10 },
        agentsPublished:   { actual: n(c.agents),            target: 10 },
        installs:          { actual: n(c.installs),          target: 25 },
        reviews:           { actual: n(c.reviews),           target: 10 },
        referrals:         { actual: n(c.referrals),         target: 5  },
        revenueEvents:     { actual: n(c.rev_events),        target: 1  },
        royaltyEvents:     { actual: n(c.royalty_events),    target: 1  },
        repeatPublishers:  { actual: n(c.repeat_publishers), target: 1  },
        repeatInstallers:  { actual: n(c.repeat_installers), target: 1  },
      };

      const exitCriteria = [
        { criterion: "≥5 real developers onboarded",    met: n(c.devs) >= 5 },
        { criterion: "≥10 organizations activated",     met: n(c.orgs) >= 10 },
        { criterion: "≥10 agents published",            met: n(c.agents) >= 10 },
        { criterion: "≥25 installs",                    met: n(c.installs) >= 25 },
        { criterion: "≥10 reviews",                     met: n(c.reviews) >= 10 },
        { criterion: "≥5 referrals",                    met: n(c.referrals) >= 5 },
        { criterion: "≥1 real revenue event",           met: n(c.rev_events) >= 1 },
        { criterion: "≥1 real royalty event",           met: n(c.royalty_events) >= 1 },
        { criterion: "≥1 repeat publisher",             met: n(c.repeat_publishers) >= 1 },
        { criterion: "≥1 repeat installer",             met: n(c.repeat_installers) >= 1 },
      ];

      const vals = Object.values(metrics);
      const overallScore = Math.round(vals.reduce((acc, v) => acc + Math.min((v.actual / v.target) * 100, 100), 0) / vals.length);
      const metCount     = exitCriteria.filter(e => e.met).length;
      const verdict      = metCount >= 10 ? "Wave 4 Complete" : metCount >= 7 ? "Nearly There" : metCount >= 4 ? "In Progress" : "Getting Started";

      res.json({ overallScore, verdict, metrics, exitCriteria, metCriteriaCount: metCount, totalCriteria: exitCriteria.length });
    } catch (e) {
      console.error("[platform/wave4-scorecard]", e);
      res.status(500).json({ error: "Failed to compute wave 4 scorecard" });
    }
  });
}
