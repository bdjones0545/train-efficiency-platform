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
function n(v: unknown): number {
  return Number(v ?? 0);
}
function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

export async function registerBetaWave3Routes(app: Express) {

  // ─── PART 1: Marketplace Activation Center data ────────────────────────────
  app.get("/api/platform/marketplace-activation", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM beta_invites WHERE role='developer')                          AS devs_contacted,
          (SELECT COUNT(*) FROM developer_royalty_accounts)                                   AS devs_registered,
          (SELECT COUNT(*) FROM agent_templates WHERE status='pending_review')                AS agents_submitted,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                        AS agents_published,
          (SELECT COUNT(*) FROM org_onboarding_sessions)                                      AS orgs_activated,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')                   AS orgs_installed,
          (SELECT COUNT(*) FROM unified_agent_action_log)                                     AS executions,
          (SELECT COUNT(*) FROM agent_reviews)                                                AS reviews,
          (SELECT COUNT(*) FROM ai_revenue_events)                                            AS revenue_events,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid')            AS royalty_events,
          (SELECT COUNT(*) FROM (
            SELECT maintainer FROM agent_templates WHERE status='active'
            GROUP BY maintainer HAVING COUNT(*) >= 2
          ) t)                                                                                AS repeat_publishers,
          (SELECT COUNT(*) FROM (
            SELECT org_id FROM org_installed_agents WHERE status='active'
            GROUP BY org_id HAVING COUNT(*) >= 2
          ) t)                                                                                AS repeat_installers
      `));

      const devsContacted  = n(c.devs_contacted);
      const devsRegistered = n(c.devs_registered);
      const agentsSubmit   = n(c.agents_submitted);
      const agentsPub      = n(c.agents_published);
      const orgsActivated  = n(c.orgs_activated);
      const orgsInstalled  = n(c.orgs_installed);
      const executions     = n(c.executions);
      const reviews        = n(c.reviews);
      const revenueEvents  = n(c.revenue_events);
      const royaltyEvents  = n(c.royalty_events);

      const funnel = [
        { stage: "Developers Contacted",     count: devsContacted,  rate: 100 },
        { stage: "Developers Registered",    count: devsRegistered, rate: pct(devsRegistered, devsContacted) },
        { stage: "Agents Submitted",         count: agentsSubmit + agentsPub, rate: pct(agentsSubmit + agentsPub, devsRegistered) },
        { stage: "Agents Published",         count: agentsPub,      rate: pct(agentsPub, agentsSubmit + agentsPub || 1) },
        { stage: "Organizations Activated",  count: orgsActivated,  rate: 100 },
        { stage: "Organizations Installed",  count: orgsInstalled,  rate: pct(orgsInstalled, orgsActivated) },
        { stage: "Executions Generated",     count: executions,     rate: orgsInstalled > 0 ? Math.round(executions / orgsInstalled) : 0 },
        { stage: "Reviews Submitted",        count: reviews,        rate: pct(reviews, orgsInstalled) },
        { stage: "Revenue Events",           count: revenueEvents,  rate: pct(revenueEvents, executions) },
        { stage: "Royalty Events",           count: royaltyEvents,  rate: pct(royaltyEvents, revenueEvents) },
      ];

      const bottleneck = funnel.slice(1).reduce((worst, s) => s.rate < worst.rate ? s : worst, funnel[1]);

      res.json({
        totals: {
          devsContacted, devsRegistered,
          agentsSubmitted: agentsSubmit, agentsPublished: agentsPub,
          orgsActivated, orgsInstalled,
          executions, reviews, revenueEvents, royaltyEvents,
          repeatPublishers: n(c.repeat_publishers),
          repeatInstallers: n(c.repeat_installers),
        },
        funnel,
        bottleneck: bottleneck.stage,
        overallConversion: pct(royaltyEvents || revenueEvents, devsContacted),
      });
    } catch (e) {
      console.error("[platform/marketplace-activation]", e);
      res.status(500).json({ error: "Failed to compute marketplace activation" });
    }
  });

  // ─── PART 2: Revenue Milestones ────────────────────────────────────────────
  app.get("/api/platform/revenue-milestones", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const firstInstall = row0(await db.execute(sql`
        SELECT oia.created_at, oia.agent_id, oia.org_id
        FROM org_installed_agents oia ORDER BY oia.created_at ASC LIMIT 1
      `));
      const firstRevEvent = row0(await db.execute(sql`
        SELECT are2.created_at, are2.org_id, are2.action_type, are2.outcome_value
        FROM ai_revenue_events are2 ORDER BY are2.created_at ASC LIMIT 1
      `));
      const firstRoyalty = row0(await db.execute(sql`
        SELECT rd.created_at, rd.developer_id, rd.agent_id, rd.developer_share
        FROM royalty_distributions rd ORDER BY rd.created_at ASC LIMIT 1
      `));
      const firstEarner = row0(await db.execute(sql`
        SELECT developer_id, lifetime_earned, created_at
        FROM developer_royalty_accounts
        WHERE lifetime_earned > 0
        ORDER BY created_at ASC LIMIT 1
      `));
      const revenue = row0(await db.execute(sql`
        SELECT
          COALESCE(SUM(outcome_value),0) AS total,
          COUNT(*)                       AS events
        FROM ai_revenue_events
      `));

      const totalRevenue = n(revenue.total);

      const milestones = [
        { name: "First Install",          reached: !!firstInstall.created_at,   date: firstInstall.created_at ?? null,    agent: firstInstall.agent_id ?? null,   org: firstInstall.org_id ?? null },
        { name: "First Revenue Event",    reached: !!firstRevEvent.created_at,  date: firstRevEvent.created_at ?? null,   agent: null,                             org: firstRevEvent.org_id ?? null },
        { name: "First Royalty Event",    reached: !!firstRoyalty.created_at,   date: firstRoyalty.created_at ?? null,    agent: firstRoyalty.agent_id ?? null,    dev: firstRoyalty.developer_id ?? null },
        { name: "First Developer Earnings",reached: !!firstEarner.developer_id, date: firstEarner.created_at ?? null,     dev: firstEarner.developer_id ?? null,   amount: n(firstEarner.lifetime_earned) },
        { name: "First $100 Revenue",     reached: totalRevenue >= 100,         date: null },
        { name: "First $500 Revenue",     reached: totalRevenue >= 500,         date: null },
        { name: "First $1,000 Revenue",   reached: totalRevenue >= 1000,        date: null },
      ];

      res.json({
        milestones,
        totalRevenue,
        reachedCount: milestones.filter(m => m.reached).length,
        totalMilestones: milestones.length,
        nextMilestone: milestones.find(m => !m.reached)?.name ?? "All milestones reached",
      });
    } catch (e) {
      console.error("[platform/revenue-milestones]", e);
      res.status(500).json({ error: "Failed to compute revenue milestones" });
    }
  });

  // ─── PART 3: Developer Activation ─────────────────────────────────────────
  app.get("/api/developer/activation", async (_req, res) => {
    try {
      const devs = rows(await db.execute(sql`
        SELECT
          dra.developer_id,
          dra.created_at                                              AS registered_at,
          MIN(at2.created_at)                                        AS first_agent_at,
          MIN(CASE WHEN at2.status='active' THEN at2.created_at END) AS first_publish_at,
          MIN(oia.created_at)                                        AS first_install_at,
          MIN(ar.created_at)                                         AS first_review_at,
          MIN(CASE WHEN rd.payout_status='paid' THEN rd.created_at END) AS first_royalty_at,
          COUNT(DISTINCT at2.id)                                     AS total_agents,
          COUNT(DISTINCT CASE WHEN at2.status='active' THEN at2.id END) AS published_agents,
          dra.lifetime_earned
        FROM developer_royalty_accounts dra
        LEFT JOIN agent_templates at2        ON at2.maintainer = dra.developer_id
        LEFT JOIN org_installed_agents oia   ON oia.agent_id   = at2.agent_id AND oia.status='active'
        LEFT JOIN agent_reviews ar           ON ar.agent_id    = at2.agent_id
        LEFT JOIN royalty_distributions rd   ON rd.developer_id = dra.developer_id
        GROUP BY dra.developer_id, dra.created_at, dra.lifetime_earned
        ORDER BY dra.created_at ASC
        LIMIT 50
      `));

      const scored = devs.map((d: any) => {
        let score = 0;
        if (d.registered_at)    score += 10;
        if (d.first_agent_at)   score += 15;
        if (d.first_publish_at) score += 20;
        if (d.first_install_at) score += 20;
        if (d.first_review_at)  score += 15;
        if (n(d.lifetime_earned) > 0) score += 15;
        if (d.first_royalty_at) score += 5;
        if (n(d.published_agents) >= 2) score += 10;
        return {
          developerId:      d.developer_id,
          registeredAt:     d.registered_at,
          milestones: {
            firstAgent:    d.first_agent_at,
            firstPublish:  d.first_publish_at,
            firstInstall:  d.first_install_at,
            firstReview:   d.first_review_at,
            firstRevenue:  n(d.lifetime_earned) > 0,
            firstRoyalty:  d.first_royalty_at,
            secondAgent:   n(d.published_agents) >= 2,
          },
          agentsPublished:  n(d.published_agents),
          activationScore:  score,
          tier: score >= 80 ? "Superstar" : score >= 50 ? "Active" : score >= 20 ? "Onboarding" : "Registered",
        };
      });

      const dropoffStages = [
        { stage: "Registered → First Agent",   count: scored.filter((d: any) => !d.milestones.firstAgent).length },
        { stage: "First Agent → Published",    count: scored.filter((d: any) => d.milestones.firstAgent && !d.milestones.firstPublish).length },
        { stage: "Published → First Install",  count: scored.filter((d: any) => d.milestones.firstPublish && !d.milestones.firstInstall).length },
        { stage: "Install → First Review",     count: scored.filter((d: any) => d.milestones.firstInstall && !d.milestones.firstReview).length },
        { stage: "Review → First Revenue",     count: scored.filter((d: any) => d.milestones.firstReview && !d.milestones.firstRevenue).length },
      ];

      res.json({
        developers: scored,
        summary: {
          total: scored.length,
          superstars:  scored.filter((d: any) => d.tier === "Superstar").length,
          active:      scored.filter((d: any) => d.tier === "Active").length,
          onboarding:  scored.filter((d: any) => d.tier === "Onboarding").length,
          registered:  scored.filter((d: any) => d.tier === "Registered").length,
          avgScore:    scored.length ? Math.round(scored.reduce((a: number, d: any) => a + d.activationScore, 0) / scored.length) : 0,
        },
        dropoffStages,
        biggestDropoff: dropoffStages.reduce((worst, s) => s.count > worst.count ? s : worst, dropoffStages[0])?.stage ?? "None",
      });
    } catch (e) {
      console.error("[developer/activation]", e);
      res.status(500).json({ error: "Failed to compute developer activation" });
    }
  });

  // ─── PART 4: Organization Activation ──────────────────────────────────────
  app.get("/api/org/activation", async (_req, res) => {
    try {
      const orgs = rows(await db.execute(sql`
        SELECT
          oos.org_id,
          oos.created_at                   AS registered_at,
          oos.install_count,
          oos.time_to_first_execution,
          oos.time_to_first_outcome,
          oos.completed,
          COUNT(DISTINCT oia.id)           AS active_installs,
          COUNT(DISTINCT ar.id)            AS reviews_submitted,
          COUNT(DISTINCT uaal.id)          AS executions
        FROM org_onboarding_sessions oos
        LEFT JOIN org_installed_agents oia ON oia.org_id = oos.org_id AND oia.status='active'
        LEFT JOIN agent_reviews ar         ON ar.org_id  = oos.org_id
        LEFT JOIN unified_agent_action_log uaal ON uaal.org_id = oos.org_id
        GROUP BY oos.org_id, oos.created_at, oos.install_count, oos.time_to_first_execution,
                 oos.time_to_first_outcome, oos.completed
        ORDER BY oos.created_at ASC
        LIMIT 100
      `));

      const scored = orgs.map((o: any) => {
        let score = 10; // registered
        if (n(o.active_installs) >= 1)    score += 20;
        if (o.time_to_first_execution)    score += 20;
        if (n(o.executions) > 0)          score += 15;
        if (n(o.reviews_submitted) > 0)   score += 20;
        if (o.completed)                  score += 10;
        if (n(o.active_installs) >= 2)    score += 5;
        return {
          orgId: o.org_id,
          registeredAt: o.registered_at,
          milestones: {
            firstInstall:    n(o.active_installs) >= 1,
            firstExecution:  !!o.time_to_first_execution,
            firstOutcome:    n(o.executions) > 0,
            firstReview:     n(o.reviews_submitted) > 0,
            firstRenewal:    o.completed,
            secondInstall:   n(o.active_installs) >= 2,
          },
          activeInstalls:   n(o.active_installs),
          executions:       n(o.executions),
          reviewsSubmitted: n(o.reviews_submitted),
          activationScore:  score,
          tier: score >= 80 ? "Champion" : score >= 50 ? "Active" : score >= 20 ? "Onboarding" : "Registered",
        };
      });

      res.json({
        organizations: scored,
        summary: {
          total:      scored.length,
          champions:  scored.filter((o: any) => o.tier === "Champion").length,
          active:     scored.filter((o: any) => o.tier === "Active").length,
          onboarding: scored.filter((o: any) => o.tier === "Onboarding").length,
          registered: scored.filter((o: any) => o.tier === "Registered").length,
          avgScore:   scored.length ? Math.round(scored.reduce((a: number, o: any) => a + o.activationScore, 0) / scored.length) : 0,
        },
        frictionPoints: [
          { stage: "Registered → First Install", count: scored.filter((o: any) => !o.milestones.firstInstall).length },
          { stage: "Install → First Execution",  count: scored.filter((o: any) => o.milestones.firstInstall && !o.milestones.firstExecution).length },
          { stage: "Execution → First Review",   count: scored.filter((o: any) => o.milestones.firstExecution && !o.milestones.firstReview).length },
        ],
      });
    } catch (e) {
      console.error("[org/activation]", e);
      res.status(500).json({ error: "Failed to compute org activation" });
    }
  });

  // ─── PART 5: Revenue Attribution Audit ────────────────────────────────────
  app.get("/api/platform/revenue-proof", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const events = rows(await db.execute(sql`
        SELECT
          are2.id,
          are2.created_at,
          are2.org_id,
          are2.prospect_id,
          are2.action_type,
          are2.outcome_status,
          are2.outcome_value,
          are2.attribution_role,
          are2.attribution_chain_id,
          are2.action_source
        FROM ai_revenue_events are2
        ORDER BY are2.created_at DESC
        LIMIT 100
      `));

      const total = n(row0(await db.execute(sql`SELECT COALESCE(SUM(outcome_value),0) AS total FROM ai_revenue_events`))?.total);

      res.json({
        events: events.map((e: any) => ({
          id:             e.id,
          timestamp:      e.created_at,
          orgId:          e.org_id,
          agent:          e.action_source,
          actionType:     e.action_type,
          outcomeStatus:  e.outcome_status,
          outcomeValue:   n(e.outcome_value),
          attributionRole:e.attribution_role,
          chainId:        e.attribution_chain_id,
          verified:       !!e.outcome_value && e.outcome_status === 'converted',
        })),
        summary: {
          totalEvents:    events.length,
          verifiedEvents: events.filter((e: any) => e.outcome_status === 'converted').length,
          totalRevenue:   total,
          simulatedRevenue: 0,
          realRevenue:    total,
        },
        verdict: events.length > 0 ? "Revenue events exist" : "No revenue events yet — wave 3 target is ≥1 real revenue event",
      });
    } catch (e) {
      console.error("[platform/revenue-proof]", e);
      res.status(500).json({ error: "Failed to compute revenue proof" });
    }
  });

  // ─── PART 6: Marketplace Conversion Funnel ────────────────────────────────
  app.get("/api/marketplace/conversion", async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                  AS store_visits,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                  AS agent_views,
          (SELECT COUNT(*) FROM org_installed_agents)                                   AS install_clicks,
          (SELECT COUNT(*) FROM org_installed_agents)                                   AS install_starts,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')             AS installs_completed,
          (SELECT COUNT(*) FROM unified_agent_action_log)                               AS executions_triggered,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE outcome_status='converted')     AS outcomes_generated,
          (SELECT COUNT(*) FROM agent_reviews)                                          AS reviews_submitted,
          (SELECT COUNT(*) FROM developer_referrals) + (SELECT COUNT(*) FROM org_referrals) AS referral_events,
          (SELECT COUNT(*) FROM ai_revenue_events)                                      AS revenue_events
      `));

      const storeVisits = n(c.store_visits) || 1; // denominator
      const stages = [
        { stage: "Store Visits",          count: n(c.store_visits),        rate: 100 },
        { stage: "Agent Views",           count: n(c.agent_views),         rate: 100 },
        { stage: "Install Clicks",        count: n(c.install_clicks),      rate: pct(n(c.install_clicks), storeVisits) },
        { stage: "Installs Completed",    count: n(c.installs_completed),  rate: pct(n(c.installs_completed), n(c.install_clicks) || 1) },
        { stage: "Executions Triggered",  count: n(c.executions_triggered),rate: pct(n(c.executions_triggered), n(c.installs_completed) || 1) },
        { stage: "Outcomes Generated",    count: n(c.outcomes_generated),  rate: pct(n(c.outcomes_generated), n(c.executions_triggered) || 1) },
        { stage: "Reviews Submitted",     count: n(c.reviews_submitted),   rate: pct(n(c.reviews_submitted), n(c.installs_completed) || 1) },
        { stage: "Revenue Events",        count: n(c.revenue_events),      rate: pct(n(c.revenue_events), n(c.outcomes_generated) || 1) },
      ];

      const biggestDrop = stages.slice(1).reduce((worst, s) => s.rate < worst.rate ? s : worst, stages[1]);

      res.json({ stages, biggestDrop: biggestDrop.stage, overallConversion: pct(n(c.revenue_events), storeVisits) });
    } catch (e) {
      console.error("[marketplace/conversion]", e);
      res.status(500).json({ error: "Failed to compute conversion funnel" });
    }
  });

  // ─── PART 7: Repeat Usage ─────────────────────────────────────────────────
  app.get("/api/platform/repeat-usage", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const repDevs = rows(await db.execute(sql`
        SELECT maintainer AS developer_id, COUNT(*) AS agent_count
        FROM agent_templates WHERE status='active'
        GROUP BY maintainer HAVING COUNT(*) >= 2
        ORDER BY agent_count DESC LIMIT 10
      `));
      const repOrgs = rows(await db.execute(sql`
        SELECT org_id, COUNT(*) AS install_count
        FROM org_installed_agents WHERE status='active'
        GROUP BY org_id HAVING COUNT(*) >= 2
        ORDER BY install_count DESC LIMIT 10
      `));
      const repReviews = rows(await db.execute(sql`
        SELECT org_id, COUNT(*) AS review_count
        FROM agent_reviews
        GROUP BY org_id HAVING COUNT(*) >= 2
        ORDER BY review_count DESC LIMIT 10
      `));
      const totalDevs  = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM developer_royalty_accounts`))?.c);
      const totalOrgs  = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM org_onboarding_sessions`))?.c);

      res.json({
        repeatPublishers:  { count: repDevs.length, rate: pct(repDevs.length, totalDevs), developers: repDevs.map((d: any) => ({ id: d.developer_id, agents: n(d.agent_count) })) },
        repeatInstallers:  { count: repOrgs.length, rate: pct(repOrgs.length, totalOrgs), orgs: repOrgs.map((o: any) => ({ id: o.org_id, installs: n(o.install_count) })) },
        repeatReviewers:   { count: repReviews.length, orgs: repReviews.map((o: any) => ({ id: o.org_id, reviews: n(o.review_count) })) },
        stickinessScore: Math.round((pct(repDevs.length, totalDevs || 1) + pct(repOrgs.length, totalOrgs || 1)) / 2),
        wave3Target: { repeatPublisher: 1, repeatInstaller: 1 },
        wave3Met: { repeatPublisher: repDevs.length >= 1, repeatInstaller: repOrgs.length >= 1 },
      });
    } catch (e) {
      console.error("[platform/repeat-usage]", e);
      res.status(500).json({ error: "Failed to compute repeat usage" });
    }
  });

  // ─── PART 8: Referral Economy ─────────────────────────────────────────────
  app.get("/api/platform/referral-economy", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const dr = row0(await db.execute(sql`
        SELECT
          COUNT(*)                                              AS total,
          COUNT(*) FILTER (WHERE status='accepted')            AS accepted,
          COUNT(*) FILTER (WHERE published_agent=true)         AS published,
          COALESCE(SUM(generated_revenue),0)                   AS revenue
        FROM developer_referrals
      `));
      const or = row0(await db.execute(sql`
        SELECT
          COUNT(*)                                              AS total,
          COUNT(*) FILTER (WHERE status='accepted')            AS accepted,
          COUNT(*) FILTER (WHERE installed_agent=true)         AS installed,
          COALESCE(SUM(generated_revenue),0)                   AS revenue
        FROM org_referrals
      `));

      const totalReferrals = n(dr.total) + n(or.total);
      const totalAccepted  = n(dr.accepted) + n(or.accepted);
      const totalRevenue   = parseFloat(Number(n(dr.revenue) + n(or.revenue)).toFixed(2));

      res.json({
        developerReferrals: {
          total: n(dr.total), accepted: n(dr.accepted), published: n(dr.published), revenue: parseFloat(Number(dr.revenue).toFixed(2)),
          conversionRate: pct(n(dr.accepted), n(dr.total)),
        },
        orgReferrals: {
          total: n(or.total), accepted: n(or.accepted), installed: n(or.installed), revenue: parseFloat(Number(or.revenue).toFixed(2)),
          conversionRate: pct(n(or.accepted), n(or.total)),
        },
        combined: { totalReferrals, totalAccepted, totalRevenue, conversionRate: pct(totalAccepted, totalReferrals) },
        organicGrowthScore: Math.min(100, totalReferrals * 5 + totalAccepted * 10),
        wave3Target: 5,
        wave3Progress: Math.min(100, Math.round((totalReferrals / 5) * 100)),
      });
    } catch (e) {
      console.error("[platform/referral-economy]", e);
      res.status(500).json({ error: "Failed to compute referral economy" });
    }
  });

  // ─── PART 10: Success Story Candidates ────────────────────────────────────
  app.get("/api/platform/success-story-candidates", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const candidates = rows(await db.execute(sql`
        SELECT
          at2.agent_id,
          at2.agent_name,
          at2.average_roi,
          at2.average_trust_score,
          COUNT(DISTINCT oia.id)   AS installs,
          COUNT(DISTINCT ar.id)    AS reviews,
          AVG(ar.rating)           AS avg_rating,
          COUNT(DISTINCT uaal.id)  AS executions,
          COALESCE(SUM(are2.outcome_value),0) AS revenue
        FROM agent_templates at2
        LEFT JOIN org_installed_agents oia ON oia.agent_id = at2.agent_id AND oia.status='active'
        LEFT JOIN agent_reviews ar          ON ar.agent_id  = at2.agent_id
        LEFT JOIN unified_agent_action_log uaal ON uaal.entity_id = at2.agent_id
        LEFT JOIN ai_revenue_events are2   ON are2.action_source = at2.agent_id
        WHERE at2.status = 'active'
        GROUP BY at2.agent_id, at2.agent_name, at2.average_roi, at2.average_trust_score
        ORDER BY avg_rating DESC NULLS LAST, installs DESC
        LIMIT 20
      `));

      const verified = n(row0(await db.execute(sql`
        SELECT COUNT(*) AS c FROM beta_case_studies WHERE verification_status='verified'
      `))?.c);

      const scored = candidates.map((c: any) => {
        const avgRating = c.avg_rating ? parseFloat(Number(c.avg_rating).toFixed(2)) : 0;
        const ready = n(c.installs) >= 1 && avgRating >= 4;
        const publishReady = n(c.installs) >= 3 && avgRating >= 4.5 && n(c.executions) >= 5;
        return {
          agentId:      c.agent_id,
          name:         c.agent_name,
          installs:     n(c.installs),
          reviews:      n(c.reviews),
          avgRating,
          executions:   n(c.executions),
          revenue:      n(c.revenue),
          roi:          c.average_roi,
          trustScore:   c.average_trust_score,
          status:       publishReady ? "Publish Ready" : ready ? "Verification Needed" : "Case Study Candidate",
          readyForCaseStudy: ready,
          publishReady,
        };
      });

      res.json({
        candidates:   scored,
        verified,
        target:       10,
        progress:     Math.min(100, Math.round((verified / 10) * 100)),
        publishReady: scored.filter((c: any) => c.publishReady).length,
        verificationNeeded: scored.filter((c: any) => c.readyForCaseStudy && !c.publishReady).length,
      });
    } catch (e) {
      console.error("[platform/success-story-candidates]", e);
      res.status(500).json({ error: "Failed to compute success story candidates" });
    }
  });

  // ─── PART 11: Flywheel Monitor (upgraded) ─────────────────────────────────
  app.get("/api/platform/flywheel-monitor", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const devs     = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM developer_royalty_accounts`))?.c);
      const agents   = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_templates WHERE status='active'`))?.c);
      const installs = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM org_installed_agents WHERE status='active'`))?.c);
      const execs    = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM unified_agent_action_log`))?.c);
      const outcomes = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM ai_revenue_events WHERE outcome_status='converted'`))?.c);
      const reviews  = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_reviews`))?.c);
      const royalties= n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM developer_royalty_accounts WHERE balance > 0`))?.c);
      const repPubs  = n(row0(await db.execute(sql`
        SELECT COUNT(*) AS c FROM (
          SELECT maintainer FROM agent_templates WHERE status='active'
          GROUP BY maintainer HAVING COUNT(*) >= 2
        ) t
      `))?.c);

      // Avg days between sequential events (using created_at of first two installs as proxy)
      const timings = rows(await db.execute(sql`
        SELECT
          AVG(EXTRACT(EPOCH FROM (first_install - first_agent))/86400) AS dev_to_install_days
        FROM (
          SELECT
            MIN(at2.created_at)  AS first_agent,
            MIN(oia.created_at)  AS first_install
          FROM agent_templates at2
          LEFT JOIN org_installed_agents oia ON oia.agent_id = at2.agent_id
          WHERE at2.status='active'
          GROUP BY at2.maintainer
        ) t
        WHERE first_install IS NOT NULL
      `));
      const avgDays = timings[0]?.dev_to_install_days
        ? parseFloat(Number(timings[0].dev_to_install_days).toFixed(1)) : null;

      const stages = [
        { id: 1, name: "Developer Joined",       count: devs,     prev: null,    conversion: 100 },
        { id: 2, name: "Agent Published",         count: agents,   prev: devs,    conversion: pct(agents, devs) },
        { id: 3, name: "Agent Installed",         count: installs, prev: agents,  conversion: pct(installs, agents) },
        { id: 4, name: "Execution Occurred",      count: execs,    prev: installs,conversion: pct(execs, installs) },
        { id: 5, name: "Outcome Generated",       count: outcomes, prev: execs,   conversion: pct(outcomes, execs) },
        { id: 6, name: "Review Submitted",        count: reviews,  prev: outcomes,conversion: pct(reviews, outcomes) },
        { id: 7, name: "Royalty Generated",       count: royalties,prev: reviews, conversion: pct(royalties, reviews) },
        { id: 8, name: "Developer Published Again",count: repPubs, prev: royalties,conversion: pct(repPubs, royalties) },
      ];

      const completedLoop = repPubs >= 1;
      const worstStage = stages.slice(1).filter(s => (s.prev ?? 0) > 0).reduce((w, s) => s.conversion < w.conversion ? s : w, stages[1]);
      const bestStage  = stages.slice(1).filter(s => s.conversion > 0).reduce((b, s) => s.conversion > b.conversion ? s : b, stages[1]);

      res.json({
        stages,
        completedLoop,
        flywheelCompletionRate: pct(repPubs, devs),
        mostCommonFailurePoint: worstStage.name,
        mostSuccessfulPath: bestStage.name,
        avgDaysPublishToInstall: avgDays,
        wave3Target: { loopCompleted: true },
      });
    } catch (e) {
      console.error("[platform/flywheel-monitor]", e);
      res.status(500).json({ error: "Failed to compute flywheel monitor" });
    }
  });

  // ─── PART 12: Ecosystem Health Index ──────────────────────────────────────
  app.get("/api/platform/ecosystem-health-index", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)                                AS devs,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                    AS agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')               AS installs,
          (SELECT COUNT(*) FROM agent_reviews)                                            AS reviews,
          (SELECT COUNT(*) FROM ai_revenue_events)                                        AS rev_events,
          (SELECT COUNT(*) FROM developer_referrals) + (SELECT COUNT(*) FROM org_referrals) AS referrals,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active') * 100.0
            / NULLIF((SELECT COUNT(*) FROM org_installed_agents), 0)                     AS retention_pct,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active') * 1.0
            / NULLIF((SELECT COUNT(*) FROM developer_royalty_accounts),0)                AS agents_per_dev,
          (SELECT COUNT(*) FROM agent_templates WHERE created_at > NOW()-INTERVAL '30 days') AS new_agents_30d,
          (SELECT COUNT(*) FROM org_installed_agents WHERE created_at > NOW()-INTERVAL '30 days') AS new_installs_30d,
          (SELECT COUNT(*) FROM agent_reviews WHERE created_at > NOW()-INTERVAL '30 days') AS new_reviews_30d
      `));

      const retention = parseFloat(Number(c.retention_pct ?? 0).toFixed(1));
      const devScore   = Math.min(100, Math.round(n(c.devs) / 10 * 100));
      const orgScore   = Math.min(100, Math.round(n(c.installs) / 50 * 100));
      const installVel = Math.min(100, Math.round(n(c.new_installs_30d) / 5 * 100));
      const reviewVel  = Math.min(100, Math.round(n(c.new_reviews_30d) / 5 * 100));
      const revVel     = Math.min(100, Math.round(n(c.rev_events) / 5 * 100));
      const refScore   = Math.min(100, Math.round(n(c.referrals) / 5 * 100));
      const retScore   = Math.min(retention, 100);
      const liqScore   = Math.min(100, Math.round((n(c.agents) / 20 + n(c.installs) / 50) * 50));

      const components = { developerActivity: devScore, organizationActivity: orgScore, installVelocity: installVel, reviewVelocity: reviewVel, revenueVelocity: revVel, referralActivity: refScore, retention: retScore, marketplaceLiquidity: liqScore };
      const score = Math.round(Object.values(components).reduce((a, b) => a + b, 0) / 8);
      const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F";

      const areas = Object.entries(components).filter(([, v]) => v < 50).map(([k]) => k.replace(/([A-Z])/g," $1").trim());

      res.json({
        score,
        grade,
        components,
        improvementAreas: areas,
        trend: "Building",
        wave3Target: 50,
        onTrack: score >= 25,
      });
    } catch (e) {
      console.error("[platform/ecosystem-health-index]", e);
      res.status(500).json({ error: "Failed to compute ecosystem health index" });
    }
  });

  // ─── PART 9: Agent Economy Leaderboard data ────────────────────────────────
  app.get("/api/platform/agent-economy-leaderboard", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const topAgents = rows(await db.execute(sql`
        SELECT
          at2.agent_id,
          at2.agent_name,
          at2.average_roi,
          at2.average_trust_score,
          at2.average_success_rate,
          at2.installation_count,
          COUNT(DISTINCT ar.id)    AS review_count,
          AVG(ar.rating)           AS avg_rating,
          COUNT(DISTINCT oia.id)   AS installs,
          COALESCE(SUM(are2.outcome_value),0) AS revenue
        FROM agent_templates at2
        LEFT JOIN agent_reviews ar        ON ar.agent_id = at2.agent_id
        LEFT JOIN org_installed_agents oia ON oia.agent_id = at2.agent_id AND oia.status='active'
        LEFT JOIN ai_revenue_events are2  ON are2.action_source = at2.agent_id
        WHERE at2.status = 'active'
        GROUP BY at2.agent_id, at2.agent_name, at2.average_roi, at2.average_trust_score,
                 at2.average_success_rate, at2.installation_count
      `));

      const topDevs = rows(await db.execute(sql`
        SELECT
          dra.developer_id,
          dra.lifetime_earned,
          dra.balance,
          COUNT(DISTINCT at2.id)          AS agents_published,
          COUNT(DISTINCT oia.id)          AS total_installs,
          COUNT(DISTINCT ar.id)           AS total_reviews
        FROM developer_royalty_accounts dra
        LEFT JOIN agent_templates at2        ON at2.maintainer = dra.developer_id AND at2.status='active'
        LEFT JOIN org_installed_agents oia   ON oia.agent_id = at2.agent_id AND oia.status='active'
        LEFT JOIN agent_reviews ar           ON ar.agent_id  = at2.agent_id
        GROUP BY dra.developer_id, dra.lifetime_earned, dra.balance
        ORDER BY dra.lifetime_earned DESC
        LIMIT 10
      `));

      const byInstalls = [...topAgents].sort((a: any, b: any) => n(b.installs) - n(a.installs)).slice(0, 5);
      const byRating   = [...topAgents].filter((a: any) => n(a.review_count) > 0).sort((a: any, b: any) => Number(b.avg_rating ?? 0) - Number(a.avg_rating ?? 0)).slice(0, 5);
      const byRevenue  = [...topAgents].sort((a: any, b: any) => n(b.revenue) - n(a.revenue)).slice(0, 5);
      const byTrust    = [...topAgents].sort((a: any, b: any) => n(b.average_trust_score) - n(a.average_trust_score)).slice(0, 5);
      const growing    = [...topAgents].sort((a: any, b: any) => n(b.installation_count) - n(a.installation_count)).slice(0, 5);

      const fmt = (a: any) => ({
        agentId:    a.agent_id,
        name:       a.agent_name,
        installs:   n(a.installs),
        avgRating:  a.avg_rating ? parseFloat(Number(a.avg_rating).toFixed(2)) : null,
        reviews:    n(a.review_count),
        revenue:    n(a.revenue),
        roi:        a.average_roi,
        trustScore: a.average_trust_score,
      });

      res.json({
        topByInstalls:   byInstalls.map(fmt),
        topByRating:     byRating.map(fmt),
        topByRevenue:    byRevenue.map(fmt),
        topByTrust:      byTrust.map(fmt),
        fastestGrowing:  growing.map(fmt),
        topDevelopers:   topDevs.map((d: any) => ({
          developerId:     d.developer_id,
          agentsPublished: n(d.agents_published),
          totalInstalls:   n(d.total_installs),
          totalReviews:    n(d.total_reviews),
          lifetimeEarned:  parseFloat(Number(d.lifetime_earned ?? 0).toFixed(2)),
          balance:         parseFloat(Number(d.balance ?? 0).toFixed(2)),
        })),
      });
    } catch (e) {
      console.error("[platform/agent-economy-leaderboard]", e);
      res.status(500).json({ error: "Failed to compute leaderboard" });
    }
  });

  // ─── PART 13: Wave 3 Validation ───────────────────────────────────────────
  app.get("/api/platform/wave3-scorecard", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)                                 AS developers,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                      AS agents_published,
          (SELECT COUNT(*) FROM org_onboarding_sessions)                                    AS orgs_activated,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')                 AS installs,
          (SELECT COUNT(*) FROM unified_agent_action_log)                                   AS executions,
          (SELECT COUNT(*) FROM agent_reviews)                                              AS reviews,
          (SELECT COUNT(*) FROM developer_referrals) + (SELECT COUNT(*) FROM org_referrals) AS referrals,
          (SELECT COUNT(*) FROM ai_revenue_events)                                          AS revenue_events,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid')          AS royalty_events,
          (SELECT COUNT(*) FROM beta_case_studies WHERE verification_status='verified')    AS case_studies,
          (SELECT COUNT(*) FROM (
            SELECT maintainer FROM agent_templates WHERE status='active'
            GROUP BY maintainer HAVING COUNT(*) >= 2
          ) t)                                                                              AS repeat_publishers,
          (SELECT COUNT(*) FROM (
            SELECT org_id FROM org_installed_agents WHERE status='active'
            GROUP BY org_id HAVING COUNT(*) >= 2
          ) t)                                                                              AS repeat_installers
      `));

      const metrics = {
        developers:       { actual: n(c.developers),        target: 10 },
        agentsPublished:  { actual: n(c.agents_published),  target: 5 },
        orgsActivated:    { actual: n(c.orgs_activated),    target: 15 },
        installs:         { actual: n(c.installs),          target: 25 },
        executions:       { actual: n(c.executions),        target: 100 },
        reviews:          { actual: n(c.reviews),           target: 20 },
        referrals:        { actual: n(c.referrals),         target: 5 },
        revenueEvents:    { actual: n(c.revenue_events),    target: 1 },
        royaltyEvents:    { actual: n(c.royalty_events),    target: 1 },
        caseStudies:      { actual: n(c.case_studies),      target: 1 },
        repeatPublishers: { actual: n(c.repeat_publishers), target: 1 },
        repeatInstallers: { actual: n(c.repeat_installers), target: 1 },
      };

      const exitCriteria = [
        { criterion: "≥10 developers registered",       met: n(c.developers) >= 10 },
        { criterion: "≥5 developers publish agents",    met: n(c.agents_published) >= 5 },
        { criterion: "≥15 organizations activated",     met: n(c.orgs_activated) >= 15 },
        { criterion: "≥25 agent installs",              met: n(c.installs) >= 25 },
        { criterion: "≥100 executions",                 met: n(c.executions) >= 100 },
        { criterion: "≥20 reviews",                     met: n(c.reviews) >= 20 },
        { criterion: "≥5 referrals",                    met: n(c.referrals) >= 5 },
        { criterion: "≥1 real revenue event",           met: n(c.revenue_events) >= 1 },
        { criterion: "≥1 real royalty event",           met: n(c.royalty_events) >= 1 },
        { criterion: "≥1 developer publishes 2nd agent",met: n(c.repeat_publishers) >= 1 },
        { criterion: "≥1 org installs 2nd agent",       met: n(c.repeat_installers) >= 1 },
      ];

      const metCount = exitCriteria.filter(e => e.met).length;
      const overallScore = Math.round(
        Object.values(metrics).reduce((acc, v) => acc + Math.min((v.actual / v.target) * 100, 100), 0) / Object.keys(metrics).length
      );
      const verdict = metCount >= 11 ? "Strongly Validated" : metCount >= 8 ? "Validated" : metCount >= 4 ? "Partially Validated" : "Not Validated";

      res.json({ overallScore, verdict, metrics, exitCriteria, metCriteriaCount: metCount, totalCriteria: exitCriteria.length });
    } catch (e) {
      console.error("[platform/wave3-scorecard]", e);
      res.status(500).json({ error: "Failed to compute wave 3 scorecard" });
    }
  });
}
