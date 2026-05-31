import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";

// Helper: db.execute() may return array or QueryResult
function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  if (Array.isArray(r?.rows)) return r.rows;
  return [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? {};
}

export async function registerBetaWave1Routes(app: Express) {

  // ─── PART 3: Agent Installation Funnel ────────────────────────────────────
  app.get("/api/marketplace/funnel", async (_req, res) => {
    try {
      const sv = Number(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_templates WHERE status='active'`))?.c ?? 0);
      const ic = Number(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM org_installed_agents`))?.c ?? 0);
      const ia = Number(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM org_installed_agents WHERE status='active'`))?.c ?? 0);
      const ex = Number(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM unified_agent_action_log`))?.c ?? 0);
      const rv = Number(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_reviews`))?.c ?? 0);

      const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0;
      const funnel = [
        { stage: "Store Views",          count: sv, conversionRate: 100 },
        { stage: "Installs Started",     count: ic, conversionRate: pct(ic, sv) },
        { stage: "Installs Completed",   count: ia, conversionRate: pct(ia, ic) },
        { stage: "Executions Triggered", count: ex, conversionRate: pct(ex, ia) },
        { stage: "Reviews Submitted",    count: rv, conversionRate: pct(rv, ex) },
      ];
      const drops = [
        { name: "Store → Installs",        drop: sv - ic },
        { name: "Installs → Active",       drop: ic - ia },
        { name: "Active → Executions",     drop: ia - ex },
        { name: "Executions → Reviews",    drop: ex - rv },
      ].sort((a, b) => b.drop - a.drop);

      res.json({ funnel, biggestDropOff: drops[0]?.name ?? "N/A", overallConversion: pct(rv, sv) });
    } catch (e) {
      console.error("[marketplace/funnel]", e);
      res.status(500).json({ error: "Failed to compute funnel" });
    }
  });

  // ─── PART 4: Agent Adoption Analytics ─────────────────────────────────────
  app.get("/api/marketplace/adoption-wave1", async (_req, res) => {
    try {
      const agentRows = rows(await db.execute(sql`
        SELECT
          oia.agent_id,
          COUNT(*)                                          AS total_installs,
          COUNT(*) FILTER (WHERE oia.status = 'active')    AS active_installs,
          COUNT(*) FILTER (WHERE oia.status = 'inactive')  AS uninstalls
        FROM org_installed_agents oia
        GROUP BY oia.agent_id
        ORDER BY total_installs DESC
        LIMIT 20
      `));

      const exRows = rows(await db.execute(sql`
        SELECT entity_id AS agent_id, COUNT(*) AS exec_count
        FROM unified_agent_action_log
        WHERE entity_type = 'agent'
        GROUP BY entity_id
        ORDER BY exec_count DESC
        LIMIT 20
      `));

      const t = row0(await db.execute(sql`
        SELECT
          COUNT(*)                                         AS total_installs,
          COUNT(*) FILTER (WHERE status = 'active')       AS active_installs,
          COUNT(*) FILTER (WHERE status = 'inactive')     AS uninstalls
        FROM org_installed_agents
      `));
      const rvCount = Number(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_reviews`))?.c ?? 0);

      const totalInstalls   = Number(t?.total_installs ?? 0);
      const activeInstalls  = Number(t?.active_installs ?? 0);
      const uninstalls      = Number(t?.uninstalls ?? 0);
      const execMap = new Map<string, number>();
      exRows.forEach((r: any) => execMap.set(r.agent_id, Number(r.exec_count)));

      res.json({
        summary: { totalInstalls, activeInstalls, uninstalls, reviewCount: rvCount },
        retentionRate: totalInstalls > 0 ? Math.round((activeInstalls / totalInstalls) * 100) : 0,
        reviewRate:    activeInstalls > 0 ? Math.round((rvCount / activeInstalls) * 100) : 0,
        topPerforming: agentRows.filter((r: any) => Number(r.active_installs) > 0).slice(0, 5).map((r: any) => ({
          agentId: r.agent_id, installs: Number(r.active_installs), executions: execMap.get(r.agent_id) ?? 0,
        })),
        topAbandoned: agentRows.filter((r: any) => Number(r.uninstalls) > 0).slice(0, 5).map((r: any) => ({
          agentId: r.agent_id, uninstalls: Number(r.uninstalls),
        })),
        executionFrequency: exRows.slice(0, 10).map((r: any) => ({ agentId: r.agent_id, executions: Number(r.exec_count) })),
      });
    } catch (e) {
      console.error("[marketplace/adoption-wave1]", e);
      res.status(500).json({ error: "Failed to compute adoption analytics" });
    }
  });

  // ─── PART 5: First Value Validation ───────────────────────────────────────
  app.get("/api/platform/first-value", async (_req, res) => {
    try {
      const fi  = row0(await db.execute(sql`SELECT MIN(created_at) AS ts FROM org_installed_agents`))?.ts ?? null;
      const fe  = row0(await db.execute(sql`SELECT MIN(created_at) AS ts FROM unified_agent_action_log`))?.ts ?? null;
      const fr  = row0(await db.execute(sql`SELECT MIN(created_at) AS ts FROM ai_revenue_events`))?.ts ?? null;
      const frv = row0(await db.execute(sql`SELECT MIN(created_at) AS ts FROM agent_reviews`))?.ts ?? null;

      const nowMs = Date.now();
      const minsAgo = (ts: string | null) => ts ? Math.round((nowMs - new Date(ts).getTime()) / 60000) : null;

      res.json({
        milestones: {
          firstInstall:   { timestamp: fi,  minutesAgo: minsAgo(fi),  reached: !!fi },
          firstExecution: { timestamp: fe,  minutesAgo: minsAgo(fe),  reached: !!fe },
          firstRevenue:   { timestamp: fr,  minutesAgo: minsAgo(fr),  reached: !!fr },
          firstReview:    { timestamp: frv, minutesAgo: minsAgo(frv), reached: !!frv },
        },
        fastestMilestone: [
          { name: "First Install",   ts: fi },
          { name: "First Execution", ts: fe },
          { name: "First Revenue",   ts: fr },
          { name: "First Review",    ts: frv },
        ].filter(x => x.ts).sort((a, b) => new Date(a.ts!).getTime() - new Date(b.ts!).getTime())[0]?.name ?? "None reached",
        timeToValueMinutes: fi && fe ? Math.round((new Date(fe).getTime() - new Date(fi).getTime()) / 60000) : null,
      });
    } catch (e) {
      console.error("[platform/first-value]", e);
      res.status(500).json({ error: "Failed to compute first value metrics" });
    }
  });

  // ─── PART 6: Review Generation Audit ──────────────────────────────────────
  app.get("/api/marketplace/review-health", async (_req, res) => {
    try {
      const s = row0(await db.execute(sql`
        SELECT
          COUNT(*)                          AS total_reviews,
          AVG(rating)                       AS avg_rating,
          COUNT(*) FILTER (WHERE rating=5)  AS five_star,
          COUNT(*) FILTER (WHERE rating=4)  AS four_star,
          COUNT(*) FILTER (WHERE rating=3)  AS three_star,
          COUNT(*) FILTER (WHERE rating<=2) AS low_star
        FROM agent_reviews
      `));
      const activeInstalls = Number(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM org_installed_agents WHERE status='active'`))?.c ?? 0);

      const totalReviews = Number(s?.total_reviews ?? 0);
      const avgRating = s?.avg_rating ? parseFloat(Number(s.avg_rating).toFixed(2)) : 0;
      const conversionRate = activeInstalls > 0 ? Math.round((totalReviews / activeInstalls) * 100) : 0;

      res.json({
        summary: { totalReviews, avgRating, conversionRate },
        distribution: {
          fiveStar:  Number(s?.five_star ?? 0),
          fourStar:  Number(s?.four_star ?? 0),
          threeStar: Number(s?.three_star ?? 0),
          lowStar:   Number(s?.low_star ?? 0),
        },
        naturalReviews: totalReviews > 0,
        recommendation: totalReviews === 0
          ? "No reviews yet — ensure post-execution review prompts are active"
          : conversionRate < 20
          ? "Low review rate — consider in-app review nudges after executions"
          : "Review health is good",
      });
    } catch (e) {
      console.error("[marketplace/review-health]", e);
      res.status(500).json({ error: "Failed to compute review health" });
    }
  });

  // ─── PART 7: Developer Economics Validation ────────────────────────────────
  app.get("/api/developer/economics", async (_req, res) => {
    try {
      const devRows = rows(await db.execute(sql`
        SELECT
          dra.developer_id,
          dra.balance,
          dra.lifetime_earned,
          dra.lifetime_paid,
          dra.pending_amount,
          COALESCE(
            (SELECT COUNT(*) FROM royalty_distributions rd WHERE rd.developer_id = dra.developer_id),
            0
          ) AS distribution_count
        FROM developer_royalty_accounts dra
        ORDER BY lifetime_earned DESC
        LIMIT 50
      `));

      const t = row0(await db.execute(sql`
        SELECT
          COUNT(*)               AS total_devs,
          COALESCE(SUM(lifetime_earned), 0)  AS total_royalties,
          COALESCE(SUM(balance), 0)          AS total_balance
        FROM developer_royalty_accounts
      `));

      const agentCount = Number(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_templates WHERE status='active'`))?.c ?? 0);
      const totalDevs = Number(t?.total_devs ?? 0);

      res.json({
        summary: {
          activeDevelopers:     totalDevs,
          totalPublishedAgents: agentCount,
          totalRoyalties:       parseFloat(Number(t?.total_royalties ?? 0).toFixed(2)),
          totalBalance:         parseFloat(Number(t?.total_balance ?? 0).toFixed(2)),
        },
        developers: devRows.map((r: any) => ({
          developerId:       r.developer_id,
          balance:           parseFloat(Number(r.balance ?? 0).toFixed(2)),
          lifetimeEarned:    parseFloat(Number(r.lifetime_earned ?? 0).toFixed(2)),
          lifetimePaid:      parseFloat(Number(r.lifetime_paid ?? 0).toFixed(2)),
          pending:           parseFloat(Number(r.pending_amount ?? 0).toFixed(2)),
          distributions:     Number(r.distribution_count ?? 0),
        })),
        insights: {
          royaltiesMotivating: parseFloat(Number(t?.total_royalties ?? 0).toFixed(2)) > 0,
          avgAgentsPerDev:     totalDevs > 0 ? parseFloat((agentCount / totalDevs).toFixed(1)) : 0,
        },
      });
    } catch (e) {
      console.error("[developer/economics]", e);
      res.status(500).json({ error: "Failed to compute developer economics" });
    }
  });

  // ─── PART 8: Marketplace Liquidity Score ──────────────────────────────────
  app.get("/api/marketplace/liquidity", async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)                AS developers,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')     AS agents,
          (SELECT COUNT(*) FROM organizations)                             AS organizations,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active') AS installs,
          (SELECT COUNT(*) FROM agent_reviews)                             AS reviews,
          (SELECT COUNT(*) FROM unified_agent_action_log)                  AS executions,
          (SELECT COUNT(*) FROM ai_revenue_events)                         AS revenue_events
      `));

      const devs     = Number(c?.developers ?? 0);
      const agents   = Number(c?.agents ?? 0);
      const orgs     = Number(c?.organizations ?? 0);
      const installs = Number(c?.installs ?? 0);
      const reviews  = Number(c?.reviews ?? 0);
      const execs    = Number(c?.executions ?? 0);
      const revEvents= Number(c?.revenue_events ?? 0);

      const score = Math.min(100, Math.round(
        Math.min(devs / 5, 1)     * 15 +
        Math.min(agents / 10, 1)  * 15 +
        Math.min(orgs / 10, 1)    * 10 +
        Math.min(installs / 25, 1)* 20 +
        Math.min(reviews / 10, 1) * 15 +
        Math.min(execs / 50, 1)   * 15 +
        Math.min(revEvents / 1, 1)* 10
      ));

      const level = score >= 80 ? "Self-Sustaining"
        : score >= 60 ? "Healthy"
        : score >= 40 ? "Active"
        : score >= 20 ? "Emerging"
        : "Inactive";

      res.json({
        liquidityScore: score,
        level,
        components: { developers: devs, agents, organizations: orgs, installs, reviews, executions: execs, revenueEvents: revEvents },
        exitCriteria: {
          developersTarget: 5,   developersActual: devs,    developersMet: devs >= 5,
          installsTarget:   25,  installsActual:   installs, installsMet:   installs >= 25,
          executionsTarget: 50,  executionsActual: execs,    executionsMet: execs >= 50,
          reviewsTarget:    10,  reviewsActual:    reviews,  reviewsMet:    reviews >= 10,
          liquidityTarget:  50,  liquidityActual:  score,    liquidityMet:  score >= 50,
        },
      });
    } catch (e) {
      console.error("[marketplace/liquidity]", e);
      res.status(500).json({ error: "Failed to compute liquidity score" });
    }
  });

  // ─── PART 9: Ecosystem Flywheel Tracking ──────────────────────────────────
  app.get("/api/platform/flywheel", async (_req, res) => {
    try {
      const fw = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)                AS devs_joined,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')     AS agents_published,
          (SELECT COUNT(*) FROM org_installed_agents)                      AS orgs_installed,
          (SELECT COUNT(*) FROM unified_agent_action_log)                  AS executions,
          (SELECT COUNT(*) FROM ai_revenue_events)                         AS outcomes,
          (SELECT COUNT(*) FROM agent_reviews)                             AS reviews,
          (SELECT COUNT(*) FROM developer_royalty_accounts WHERE balance > 0) AS royalties_created,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')   AS active_installs
      `));

      const stages = [
        { stage: "Developer Joins",       count: Number(fw?.devs_joined ?? 0),      target: 5  },
        { stage: "Agent Published",       count: Number(fw?.agents_published ?? 0), target: 10 },
        { stage: "Organization Installs", count: Number(fw?.orgs_installed ?? 0),   target: 25 },
        { stage: "Execution Occurs",      count: Number(fw?.executions ?? 0),       target: 50 },
        { stage: "Outcome Generated",     count: Number(fw?.outcomes ?? 0),         target: 20 },
        { stage: "Review Submitted",      count: Number(fw?.reviews ?? 0),          target: 10 },
        { stage: "Royalty Created",       count: Number(fw?.royalties_created ?? 0),target: 1  },
        { stage: "Repeat Installs",       count: Number(fw?.active_installs ?? 0),  target: 10 },
      ];

      const reachedCount = stages.filter(s => s.count > 0).length;
      const biggestBottleneck = stages.find(s => s.count === 0)?.stage ?? "All stages reached!";
      const flywheelScore = Math.round(stages.reduce((acc, s) => acc + Math.min(s.count / s.target, 1), 0) / stages.length * 100);

      res.json({ stages, reachedCount, totalStages: stages.length, biggestBottleneck, flywheelScore });
    } catch (e) {
      console.error("[platform/flywheel]", e);
      res.status(500).json({ error: "Failed to compute flywheel" });
    }
  });

  // ─── PART 10: Beta Interviews CRUD ────────────────────────────────────────
  app.get("/api/beta/interviews", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM beta_interviews ORDER BY created_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch interviews" }); }
  });

  app.post("/api/beta/interviews", async (req, res) => {
    try {
      const { participant_id, role, organization, agent_used, positive_feedback,
              negative_feedback, requested_features, confusion_points, value_realized,
              likelihood_to_continue } = req.body;
      const r = rows(await db.execute(sql`
        INSERT INTO beta_interviews (id, participant_id, role, organization, agent_used,
          positive_feedback, negative_feedback, requested_features, confusion_points,
          value_realized, likelihood_to_continue)
        VALUES (gen_random_uuid()::text, ${participant_id ?? null}, ${role ?? null},
          ${organization ?? null}, ${agent_used ?? null}, ${positive_feedback ?? null},
          ${negative_feedback ?? null}, ${requested_features ?? null},
          ${confusion_points ?? null}, ${value_realized ?? null},
          ${likelihood_to_continue ?? null})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create interview" }); }
  });

  // ─── PART 11: Case Studies CRUD ───────────────────────────────────────────
  app.get("/api/beta/case-studies", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM beta_case_studies ORDER BY created_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch case studies" }); }
  });

  app.post("/api/beta/case-studies", async (req, res) => {
    try {
      const { organization, agent_name, problem, action_taken, outcome,
              revenue_impact, hours_saved, review_score, verification_status } = req.body;
      if (!organization || !agent_name) return res.status(400).json({ error: "organization and agent_name required" });
      const r = rows(await db.execute(sql`
        INSERT INTO beta_case_studies (id, organization, agent_name, problem, action_taken,
          outcome, revenue_impact, hours_saved, review_score, verification_status)
        VALUES (gen_random_uuid()::text, ${organization}, ${agent_name}, ${problem ?? null},
          ${action_taken ?? null}, ${outcome ?? null}, ${revenue_impact ?? null},
          ${hours_saved ?? null}, ${review_score ?? null}, ${verification_status ?? 'pending'})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create case study" }); }
  });

  app.patch("/api/beta/case-studies/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { verification_status, published, outcome, revenue_impact, hours_saved, review_score } = req.body;
      await db.execute(sql`
        UPDATE beta_case_studies SET
          verification_status = COALESCE(${verification_status ?? null}, verification_status),
          published           = COALESCE(${published ?? null}, published),
          outcome             = COALESCE(${outcome ?? null}, outcome),
          revenue_impact      = COALESCE(${revenue_impact ?? null}, revenue_impact),
          hours_saved         = COALESCE(${hours_saved ?? null}, hours_saved),
          review_score        = COALESCE(${review_score ?? null}, review_score),
          updated_at          = NOW()
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to update case study" }); }
  });

  // ─── PART 1: Developer Onboarding Sessions ────────────────────────────────
  app.get("/api/onboarding/developer", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM developer_onboarding_sessions ORDER BY created_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch developer sessions" }); }
  });

  app.post("/api/onboarding/developer", async (req, res) => {
    try {
      const { developer_id, org_id, email } = req.body;
      const r = rows(await db.execute(sql`
        INSERT INTO developer_onboarding_sessions (id, developer_id, org_id, email)
        VALUES (gen_random_uuid()::text, ${developer_id ?? null}, ${org_id ?? null}, ${email ?? null})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create developer session" }); }
  });

  app.patch("/api/onboarding/developer/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { steps_completed, completion_time, support_requests, drop_off_reason, completed } = req.body;
      await db.execute(sql`
        UPDATE developer_onboarding_sessions SET
          steps_completed  = COALESCE(${steps_completed ? JSON.stringify(steps_completed) : null}::jsonb, steps_completed),
          completion_time  = COALESCE(${completion_time ?? null}, completion_time),
          support_requests = COALESCE(${support_requests ?? null}, support_requests),
          drop_off_reason  = COALESCE(${drop_off_reason ?? null}, drop_off_reason),
          completed        = COALESCE(${completed ?? null}, completed),
          updated_at       = NOW()
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to update developer session" }); }
  });

  // ─── PART 2: Org Onboarding Sessions ──────────────────────────────────────
  app.get("/api/onboarding/org", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM org_onboarding_sessions ORDER BY created_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch org sessions" }); }
  });

  app.post("/api/onboarding/org", async (req, res) => {
    try {
      const { org_id, org_name, role } = req.body;
      const r = rows(await db.execute(sql`
        INSERT INTO org_onboarding_sessions (id, org_id, org_name, role)
        VALUES (gen_random_uuid()::text, ${org_id ?? null}, ${org_name ?? null}, ${role ?? null})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create org session" }); }
  });

  // ─── PART 13: Beta Wave 1 Scorecard ───────────────────────────────────────
  app.get("/api/platform/beta-wave1-scorecard", async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)                              AS devs_recruited,
          (SELECT COUNT(*) FROM org_onboarding_sessions)                                 AS orgs_recruited,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                   AS agents_published,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')              AS agents_installed,
          (SELECT COUNT(*) FROM agent_reviews)                                           AS reviews_submitted,
          (SELECT COUNT(*) FROM unified_agent_action_log)                                AS executions_completed,
          (SELECT COUNT(*) FROM ai_revenue_events)                                       AS outcomes_generated,
          (SELECT COUNT(*) FROM ai_revenue_events)                                       AS revenue_events,
          (SELECT COUNT(*) FILTER (WHERE verification_status='verified') FROM beta_case_studies) AS case_studies_verified
      `));

      const totalInstalls = Number(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM org_installed_agents`))?.c ?? 0);
      const activeInstalls = Number(c?.agents_installed ?? 0);
      const retentionActual = totalInstalls > 0 ? Math.round((activeInstalls / totalInstalls) * 100) : 0;

      const metrics: Record<string, { actual: number; target: number }> = {
        developersRecruited:   { actual: Number(c?.devs_recruited ?? 0),       target: 5  },
        organizationsRecruited:{ actual: Number(c?.orgs_recruited ?? 0),       target: 10 },
        agentsPublished:       { actual: Number(c?.agents_published ?? 0),     target: 10 },
        agentsInstalled:       { actual: Number(c?.agents_installed ?? 0),     target: 25 },
        reviewsSubmitted:      { actual: Number(c?.reviews_submitted ?? 0),    target: 10 },
        executionsCompleted:   { actual: Number(c?.executions_completed ?? 0), target: 50 },
        outcomesGenerated:     { actual: Number(c?.outcomes_generated ?? 0),   target: 20 },
        revenueEvents:         { actual: Number(c?.revenue_events ?? 0),       target: 1  },
        caseStudiesCreated:    { actual: Number(c?.case_studies_verified ?? 0),target: 5  },
        retentionRate:         { actual: retentionActual,                      target: 70 },
      };

      const metricVals = Object.values(metrics);
      const overallScore = Math.round(
        metricVals.reduce((acc, v) => acc + Math.min((v.actual / v.target) * 100, 100), 0) / metricVals.length
      );

      const exitCriteria = [
        { criterion: "≥5 developers publish agents",     met: Number(c?.devs_recruited ?? 0) >= 5 },
        { criterion: "≥10 organizations install agents", met: Number(c?.orgs_recruited ?? 0) >= 10 },
        { criterion: "≥25 agent installs",               met: Number(c?.agents_installed ?? 0) >= 25 },
        { criterion: "≥50 executions",                   met: Number(c?.executions_completed ?? 0) >= 50 },
        { criterion: "≥10 reviews submitted",            met: Number(c?.reviews_submitted ?? 0) >= 10 },
        { criterion: "≥5 verified case studies",         met: Number(c?.case_studies_verified ?? 0) >= 5 },
        { criterion: "≥1 revenue event generated",       met: Number(c?.revenue_events ?? 0) >= 1 },
        { criterion: "≥1 developer publishes 2nd agent", met: false },
        { criterion: "Marketplace Liquidity Score > 50", met: false },
        { criterion: "Beta Score > 70",                  met: overallScore > 70 },
      ];

      res.json({
        overallScore,
        verdict: overallScore >= 70 ? "PASS" : overallScore >= 40 ? "IN_PROGRESS" : "NEEDS_WORK",
        metrics,
        exitCriteria,
        metCriteriaCount: exitCriteria.filter(e => e.met).length,
        totalCriteria: exitCriteria.length,
      });
    } catch (e) {
      console.error("[platform/beta-wave1-scorecard]", e);
      res.status(500).json({ error: "Failed to compute scorecard" });
    }
  });
}
