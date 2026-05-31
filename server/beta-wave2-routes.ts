import type { Express } from "express";
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

export async function registerBetaWave2Routes(app: Express) {

  // ─── PART 1: Developer Recruitment ────────────────────────────────────────
  app.get("/api/platform/developer-recruitment", async (_req, res) => {
    try {
      const inv = rows(await db.execute(sql`
        SELECT
          bi.role,
          COUNT(*)                                                AS invited,
          COUNT(*) FILTER (WHERE bi.invite_status = 'accepted')  AS accepted,
          COUNT(*) FILTER (WHERE bi.activation_status != 'not_activated') AS registered
        FROM beta_invites bi
        WHERE bi.role = 'developer'
        GROUP BY bi.role
      `));

      const devRow = inv[0] ?? { invited: 0, accepted: 0, registered: 0 };
      const invited    = n(devRow.invited);
      const accepted   = n(devRow.accepted);
      const registered = n(devRow.registered);

      const devSessions = rows(await db.execute(sql`
        SELECT COUNT(*) FILTER (WHERE completed = true) AS finished,
               COUNT(*)                                 AS total
        FROM developer_onboarding_sessions
      `));
      const ds = devSessions[0] ?? {};

      const referrals = rows(await db.execute(sql`
        SELECT COUNT(*)                                             AS total,
               COUNT(*) FILTER (WHERE status = 'accepted')         AS accepted_refs,
               COUNT(*) FILTER (WHERE published_agent = true)      AS published
        FROM developer_referrals
      `));
      const ref = referrals[0] ?? {};

      const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 100) : 0;

      res.json({
        recruitmentFunnel: [
          { stage: "Invited",            count: invited,                   conversionRate: 100 },
          { stage: "Accepted",           count: accepted,                  conversionRate: pct(accepted, invited) },
          { stage: "Registered",         count: registered,                conversionRate: pct(registered, accepted) },
          { stage: "Published 1st Agent",count: n(ds.finished),            conversionRate: pct(n(ds.finished), registered) },
          { stage: "Referred Another",   count: n(ref.published),          conversionRate: pct(n(ref.published), n(ds.finished)) },
        ],
        totals: { invited, accepted, registered, onboardingCompleted: n(ds.finished), referrals: n(ref.total) },
        referralConversion: pct(n(ref.accepted_refs), n(ref.total)),
        biggestDropOff: (() => {
          const stages = [invited, accepted, registered, n(ds.finished)];
          const drops = stages.map((v, i) => ({ i, drop: i > 0 ? stages[i-1] - v : 0 })).sort((a,b) => b.drop - a.drop);
          const labels = ["Invite → Accept", "Accept → Register", "Register → Publish"];
          return labels[drops[0]?.i - 1] ?? "None";
        })(),
        target: 10,
        progress: Math.min(Math.round((registered / 10) * 100), 100),
      });
    } catch (e) {
      console.error("[platform/developer-recruitment]", e);
      res.status(500).json({ error: "Failed to compute developer recruitment" });
    }
  });

  // ─── PART 2: Org Recruitment ───────────────────────────────────────────────
  app.get("/api/platform/org-recruitment", async (_req, res) => {
    try {
      const inv = row0(await db.execute(sql`
        SELECT
          COUNT(*)                                                              AS invited,
          COUNT(*) FILTER (WHERE invite_status = 'accepted')                   AS accepted,
          COUNT(*) FILTER (WHERE activation_status != 'not_activated')         AS activated
        FROM beta_invites
        WHERE role IN ('gym_owner', 'facility', 'consultant', 'coach')
      `));

      const os = row0(await db.execute(sql`
        SELECT
          COUNT(*)                                                         AS total_sessions,
          COUNT(*) FILTER (WHERE install_count > 0)                       AS installed,
          COUNT(*) FILTER (WHERE time_to_first_execution IS NOT NULL)     AS executed,
          COUNT(*) FILTER (WHERE completed = true)                        AS completed
        FROM org_onboarding_sessions
      `));

      const orgs = rows(await db.execute(sql`
        SELECT role, COUNT(*) AS cnt FROM beta_invites
        WHERE role IN ('gym_owner', 'facility', 'consultant', 'coach')
        GROUP BY role
      `));

      const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 100) : 0;
      const invited = n(inv.invited), accepted = n(inv.accepted), activated = n(inv.activated);

      res.json({
        recruitmentFunnel: [
          { stage: "Invited",             count: invited,        conversionRate: 100 },
          { stage: "Accepted",            count: accepted,       conversionRate: pct(accepted, invited) },
          { stage: "Activated",           count: activated,      conversionRate: pct(activated, accepted) },
          { stage: "Installed 1st Agent", count: n(os.installed),conversionRate: pct(n(os.installed), activated) },
          { stage: "Executed Workflow",   count: n(os.executed), conversionRate: pct(n(os.executed), n(os.installed)) },
          { stage: "Submitted Review",    count: 0,              conversionRate: 0 },
          { stage: "Renewed Usage",       count: n(os.completed),conversionRate: pct(n(os.completed), n(os.executed)) },
        ],
        totals: { invited, accepted, activated, installed: n(os.installed), executed: n(os.executed) },
        byRole: orgs.map((r: any) => ({ role: r.role, count: n(r.cnt) })),
        target: 20,
        progress: Math.min(Math.round((n(os.installed) / 20) * 100), 100),
      });
    } catch (e) {
      console.error("[platform/org-recruitment]", e);
      res.status(500).json({ error: "Failed to compute org recruitment" });
    }
  });

  // ─── PART 3: Agent Launch Programs CRUD ───────────────────────────────────
  app.get("/api/marketplace/launch-programs", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM marketplace_launch_programs ORDER BY created_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch launch programs" }); }
  });

  app.post("/api/marketplace/launch-programs", async (req, res) => {
    try {
      const { agent_id, agent_name, developer_id } = req.body;
      if (!agent_id) return res.status(400).json({ error: "agent_id required" });
      const checklist = {
        completeProfile:      false,
        addDescription:       false,
        addBenchmarkData:     false,
        addSupportedIndustries: false,
        getFirstReview:       false,
        getFirstInstall:      false,
        getFirstCaseStudy:    false,
      };
      const r = rows(await db.execute(sql`
        INSERT INTO marketplace_launch_programs (id, agent_id, agent_name, developer_id, checklist)
        VALUES (gen_random_uuid()::text, ${agent_id}, ${agent_name ?? null}, ${developer_id ?? null}, ${JSON.stringify(checklist)}::jsonb)
        ON CONFLICT DO NOTHING RETURNING *
      `));
      res.status(201).json(r[0] ?? { message: "Already exists" });
    } catch (e) { res.status(500).json({ error: "Failed to create launch program" }); }
  });

  app.patch("/api/marketplace/launch-programs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { checklist, launched } = req.body;
      const score = checklist ? Math.round(Object.values(checklist).filter(Boolean).length / Object.keys(checklist).length * 100) : null;
      await db.execute(sql`
        UPDATE marketplace_launch_programs SET
          checklist        = COALESCE(${checklist ? JSON.stringify(checklist) : null}::jsonb, checklist),
          completion_score = COALESCE(${score}, completion_score),
          launched         = COALESCE(${launched ?? null}, launched),
          updated_at       = NOW()
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to update launch program" }); }
  });

  // ─── PART 4: Marketplace Growth ───────────────────────────────────────────
  app.get("/api/marketplace/growth", async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                     AS total_agents,
          (SELECT COUNT(*) FROM agent_templates WHERE created_at > NOW() - INTERVAL '30 days' AND status='active') AS new_agents_30d,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')               AS active_installs,
          (SELECT COUNT(*) FROM org_installed_agents WHERE created_at > NOW() - INTERVAL '30 days') AS new_installs_30d,
          (SELECT COUNT(*) FROM agent_reviews)                                             AS total_reviews,
          (SELECT COUNT(*) FROM agent_reviews WHERE created_at > NOW() - INTERVAL '30 days') AS new_reviews_30d,
          (SELECT COUNT(*) FROM beta_case_studies WHERE verification_status='verified')    AS case_studies,
          (SELECT COUNT(*) FROM ai_revenue_events)                                         AS revenue_events,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE created_at > NOW() - INTERVAL '30 days') AS revenue_events_30d,
          (SELECT COUNT(*) FROM unified_agent_action_log)                                  AS total_executions,
          (SELECT COUNT(*) FROM unified_agent_action_log WHERE created_at > NOW() - INTERVAL '30 days') AS executions_30d
      `));

      // Weekly trend — installs per week for last 8 weeks
      const trend = rows(await db.execute(sql`
        SELECT
          date_trunc('week', created_at) AS week,
          COUNT(*) AS installs
        FROM org_installed_agents
        WHERE created_at > NOW() - INTERVAL '8 weeks'
        GROUP BY 1
        ORDER BY 1 ASC
      `));

      res.json({
        totals: {
          agents:     n(c.total_agents),
          installs:   n(c.active_installs),
          reviews:    n(c.total_reviews),
          caseStudies:n(c.case_studies),
          revenueEvents: n(c.revenue_events),
          executions: n(c.total_executions),
        },
        last30Days: {
          newAgents:    n(c.new_agents_30d),
          newInstalls:  n(c.new_installs_30d),
          newReviews:   n(c.new_reviews_30d),
          revenueEvents:n(c.revenue_events_30d),
          executions:   n(c.executions_30d),
        },
        weeklyInstallTrend: trend.map((r: any) => ({
          week: r.week, installs: n(r.installs),
        })),
        growthRate: {
          agents:  n(c.total_agents) > 0 ? Math.round((n(c.new_agents_30d) / n(c.total_agents)) * 100) : 0,
          installs:n(c.active_installs) > 0 ? Math.round((n(c.new_installs_30d) / n(c.active_installs)) * 100) : 0,
        },
      });
    } catch (e) {
      console.error("[marketplace/growth]", e);
      res.status(500).json({ error: "Failed to compute growth" });
    }
  });

  // ─── PART 5: Revenue Validation ───────────────────────────────────────────
  app.get("/api/platform/revenue-validation", async (_req, res) => {
    try {
      const rev = row0(await db.execute(sql`
        SELECT
          COUNT(*)          AS total_events,
          COALESCE(SUM(COALESCE(outcome_value, 0)), 0) AS total_amount,
          MIN(created_at)   AS first_event_at
        FROM ai_revenue_events
      `));

      const royalties = row0(await db.execute(sql`
        SELECT
          COUNT(*)                         AS total_accounts,
          COALESCE(SUM(lifetime_earned),0) AS total_earned,
          COALESCE(SUM(lifetime_paid),0)   AS total_paid,
          COALESCE(SUM(balance),0)         AS total_balance,
          MIN(created_at)                  AS first_royalty_at
        FROM developer_royalty_accounts
      `));

      const distributions = row0(await db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(developer_share),0) AS total_dev_share
        FROM royalty_distributions
        WHERE payout_status = 'paid'
      `));

      const totalAmount = parseFloat(Number(rev.total_amount ?? 0).toFixed(2));
      const totalEarned = parseFloat(Number(royalties.total_earned ?? 0).toFixed(2));

      const milestones = [
        { name: "First Revenue Event", reached: n(rev.total_events) >= 1, timestamp: rev.first_event_at ?? null },
        { name: "First Royalty",       reached: totalEarned > 0,           timestamp: royalties.first_royalty_at ?? null },
        { name: "First $100",          reached: totalAmount >= 100,         timestamp: null },
        { name: "First $1,000",        reached: totalAmount >= 1000,        timestamp: null },
        { name: "First $10,000",       reached: totalAmount >= 10000,       timestamp: null },
      ];

      res.json({
        revenueEvents:    { total: n(rev.total_events), totalAmount },
        royalties:        { accounts: n(royalties.total_accounts), totalEarned, totalPaid: parseFloat(Number(royalties.total_paid ?? 0).toFixed(2)), balance: parseFloat(Number(royalties.total_balance ?? 0).toFixed(2)) },
        distributions:    { total: n(distributions.total), totalDevShare: parseFloat(Number(distributions.total_dev_share ?? 0).toFixed(2)) },
        milestones,
        modelValidated:   n(rev.total_events) >= 1 && totalEarned > 0,
        nextMilestone:    milestones.find(m => !m.reached)?.name ?? "All milestones reached",
      });
    } catch (e) {
      console.error("[platform/revenue-validation]", e);
      res.status(500).json({ error: "Failed to compute revenue validation" });
    }
  });

  // ─── PART 6: Agent Retention Analytics ────────────────────────────────────
  app.get("/api/marketplace/retention", async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          COUNT(*)                                                                    AS total_ever,
          COUNT(*) FILTER (WHERE status = 'active')                                  AS currently_active,
          COUNT(*) FILTER (WHERE status = 'active' AND created_at > NOW() - INTERVAL '1 day')  AS day1,
          COUNT(*) FILTER (WHERE status = 'active' AND created_at > NOW() - INTERVAL '7 days') AS day7,
          COUNT(*) FILTER (WHERE status = 'active' AND created_at > NOW() - INTERVAL '30 days')AS day30,
          COUNT(*) FILTER (WHERE status = 'active' AND created_at > NOW() - INTERVAL '90 days')AS day90,
          COUNT(*) FILTER (WHERE status = 'inactive')                                AS churned
        FROM org_installed_agents
      `));

      const topRetained = rows(await db.execute(sql`
        SELECT agent_id, COUNT(*) AS cnt
        FROM org_installed_agents
        WHERE status = 'active'
        GROUP BY agent_id
        ORDER BY cnt DESC
        LIMIT 5
      `));

      const topAbandoned = rows(await db.execute(sql`
        SELECT agent_id, COUNT(*) AS cnt
        FROM org_installed_agents
        WHERE status = 'inactive'
        GROUP BY agent_id
        ORDER BY cnt DESC
        LIMIT 5
      `));

      const total  = n(c.total_ever);
      const active = n(c.currently_active);

      res.json({
        retentionRates: {
          day1:  total > 0 ? Math.round((n(c.day1)  / total) * 100) : 0,
          day7:  total > 0 ? Math.round((n(c.day7)  / total) * 100) : 0,
          day30: total > 0 ? Math.round((n(c.day30) / total) * 100) : 0,
          day90: total > 0 ? Math.round((n(c.day90) / total) * 100) : 0,
        },
        churnRate:    total > 0 ? Math.round((n(c.churned) / total) * 100) : 0,
        reinstallRate: 0,
        totals: { totalInstalls: total, active, churned: n(c.churned) },
        mostRetained: topRetained.map((r: any) => ({ agentId: r.agent_id, count: n(r.cnt) })),
        mostAbandoned: topAbandoned.map((r: any) => ({ agentId: r.agent_id, count: n(r.cnt) })),
      });
    } catch (e) {
      console.error("[marketplace/retention]", e);
      res.status(500).json({ error: "Failed to compute retention" });
    }
  });

  // ─── PART 7: Recommendation Performance ───────────────────────────────────
  app.get("/api/marketplace/recommendation-performance", async (_req, res) => {
    try {
      const agents = rows(await db.execute(sql`
        SELECT
          at2.agent_id,
          at2.agent_name,
          at2.average_roi,
          at2.average_trust_score,
          at2.average_success_rate,
          at2.installation_count,
          COUNT(ar.id)         AS review_count,
          AVG(ar.rating)       AS avg_rating,
          COUNT(oia.id)        AS install_count
        FROM agent_templates at2
        LEFT JOIN agent_reviews ar    ON ar.agent_id = at2.agent_id
        LEFT JOIN org_installed_agents oia ON oia.agent_id = at2.agent_id AND oia.status='active'
        WHERE at2.status = 'active'
        GROUP BY at2.agent_id, at2.agent_name, at2.average_roi, at2.average_trust_score,
                 at2.average_success_rate, at2.installation_count
        ORDER BY install_count DESC
        LIMIT 20
      `));

      const total = agents.length;
      const withReviews    = agents.filter((a: any) => n(a.review_count) > 0).length;
      const withInstalls   = agents.filter((a: any) => n(a.install_count) > 0).length;
      const conversionRate = total > 0 ? Math.round((withInstalls / total) * 100) : 0;

      res.json({
        summary: { totalRecommendable: total, withReviews, withInstalls, conversionRate },
        topPerformers: agents.slice(0, 5).map((a: any) => ({
          agentId:      a.agent_id,
          name:         a.agent_name,
          installs:     n(a.install_count),
          avgRating:    a.avg_rating ? parseFloat(Number(a.avg_rating).toFixed(2)) : null,
          roi:          a.average_roi,
          trustScore:   a.average_trust_score,
        })),
        optimizationSignals: {
          installSuccessWeight: 0.40,
          reviewScoreWeight:    0.25,
          retentionWeight:      0.20,
          industryFitWeight:    0.10,
          roiWeight:            0.05,
        },
      });
    } catch (e) {
      console.error("[marketplace/recommendation-performance]", e);
      res.status(500).json({ error: "Failed to compute recommendation performance" });
    }
  });

  // ─── PART 8: Success Stories Engine ───────────────────────────────────────
  app.get("/api/platform/success-stories", async (_req, res) => {
    try {
      const existing = rows(await db.execute(sql`
        SELECT * FROM beta_case_studies ORDER BY created_at DESC
      `));

      // Candidate agents: high rating + active installs
      const candidates = rows(await db.execute(sql`
        SELECT
          at2.agent_id,
          at2.agent_name,
          COUNT(DISTINCT oia.id)  AS install_count,
          AVG(ar.rating)          AS avg_rating,
          COUNT(DISTINCT ar.id)   AS review_count,
          at2.average_roi
        FROM agent_templates at2
        LEFT JOIN org_installed_agents oia ON oia.agent_id = at2.agent_id AND oia.status='active'
        LEFT JOIN agent_reviews ar          ON ar.agent_id = at2.agent_id
        WHERE at2.status = 'active'
        GROUP BY at2.agent_id, at2.agent_name, at2.average_roi
        HAVING COUNT(DISTINCT oia.id) > 0 OR AVG(ar.rating) >= 4
        ORDER BY avg_rating DESC NULLS LAST, install_count DESC
        LIMIT 10
      `));

      const verified = existing.filter((c: any) => c.verification_status === 'verified').length;

      res.json({
        verified,
        target: 10,
        progress: Math.min(Math.round((verified / 10) * 100), 100),
        existingCaseStudies: existing,
        candidateAgents: candidates.map((a: any) => ({
          agentId:    a.agent_id,
          name:       a.agent_name,
          installs:   n(a.install_count),
          avgRating:  a.avg_rating ? parseFloat(Number(a.avg_rating).toFixed(2)) : null,
          reviews:    n(a.review_count),
          roi:        a.average_roi,
          readyForCaseStudy: n(a.install_count) >= 1 && parseFloat(Number(a.avg_rating ?? 0).toFixed(2)) >= 4,
        })),
      });
    } catch (e) {
      console.error("[platform/success-stories]", e);
      res.status(500).json({ error: "Failed to compute success stories" });
    }
  });

  // ─── PART 9: Referrals CRUD ────────────────────────────────────────────────
  app.get("/api/referrals/developer", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM developer_referrals ORDER BY created_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch developer referrals" }); }
  });

  app.post("/api/referrals/developer", async (req, res) => {
    try {
      const { referrer_id, referee_email, reward_type } = req.body;
      if (!referrer_id || !referee_email) return res.status(400).json({ error: "referrer_id and referee_email required" });
      const r = rows(await db.execute(sql`
        INSERT INTO developer_referrals (id, referrer_id, referee_email, reward_type)
        VALUES (gen_random_uuid()::text, ${referrer_id}, ${referee_email}, ${reward_type ?? 'royalty_bonus'})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create developer referral" }); }
  });

  app.get("/api/referrals/org", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM org_referrals ORDER BY created_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch org referrals" }); }
  });

  app.post("/api/referrals/org", async (req, res) => {
    try {
      const { referrer_id, referee_email, reward_type } = req.body;
      if (!referrer_id || !referee_email) return res.status(400).json({ error: "referrer_id and referee_email required" });
      const r = rows(await db.execute(sql`
        INSERT INTO org_referrals (id, referrer_id, referee_email, reward_type)
        VALUES (gen_random_uuid()::text, ${referrer_id}, ${referee_email}, ${reward_type ?? 'recognition_badge'})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create org referral" }); }
  });

  // ─── PART 10: Flywheel Acceleration ──────────────────────────────────────
  app.get("/api/platform/flywheel-acceleration", async (_req, res) => {
    try {
      const devs      = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM developer_royalty_accounts`))?.c);
      const agents    = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_templates WHERE status='active'`))?.c);
      const installs  = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM org_installed_agents`))?.c);
      const active    = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM org_installed_agents WHERE status='active'`))?.c);
      const execs     = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM unified_agent_action_log`))?.c);
      const outcomes  = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM ai_revenue_events`))?.c);
      const reviews   = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_reviews`))?.c);
      const royalties = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM developer_royalty_accounts WHERE balance > 0`))?.c);
      const newAgents = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_templates WHERE created_at > NOW() - INTERVAL '30 days'`))?.c);

      const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 100) : 0;

      const stages = [
        { stage: "Developer → Publish",   from: devs,     to: agents,    conversion: pct(agents,   devs),    label: `${agents} of ${devs} devs published` },
        { stage: "Publish → Install",     from: agents,   to: installs,  conversion: pct(installs, agents),  label: `${installs} installs from ${agents} agents` },
        { stage: "Install → Execute",     from: installs, to: execs,     conversion: pct(execs,    installs),label: `${execs} execs from ${installs} installs` },
        { stage: "Execute → Outcome",     from: execs,    to: outcomes,  conversion: pct(outcomes, execs),   label: `${outcomes} outcomes from ${execs} execs` },
        { stage: "Outcome → Review",      from: outcomes, to: reviews,   conversion: pct(reviews,  outcomes),label: `${reviews} reviews from ${outcomes} outcomes` },
        { stage: "Review → Install",      from: reviews,  to: active,    conversion: pct(active,   reviews), label: `${active} active installs, ${reviews} reviews` },
        { stage: "Install → Royalty",     from: active,   to: royalties, conversion: pct(royalties,active),  label: `${royalties} devs earning royalties` },
        { stage: "Royalty → New Agent",   from: royalties,to: newAgents, conversion: pct(newAgents,royalties),label: `${newAgents} new agents published last 30d` },
      ];

      const conversions = stages.map(s => s.conversion).filter(c => c > 0);
      const strongest = stages.reduce((best, s) => s.conversion > best.conversion ? s : best, stages[0]);
      const weakest   = stages.reduce((worst,s) => (s.conversion < worst.conversion || worst.conversion === 0) && s.from > 0 ? s : worst, stages[0]);
      const overall   = conversions.length > 0 ? Math.round(conversions.reduce((a,b) => a+b, 0) / conversions.length) : 0;

      res.json({
        stages,
        strongestStage:    strongest.stage,
        weakestStage:      weakest.stage,
        biggestBottleneck: weakest.stage,
        overallConversion: overall,
        accelerationScore: Math.min(100, overall),
      });
    } catch (e) {
      console.error("[platform/flywheel-acceleration]", e);
      res.status(500).json({ error: "Failed to compute flywheel acceleration" });
    }
  });

  // ─── PART 11: Marketplace Maturity Model ──────────────────────────────────
  app.get("/api/marketplace/maturity", async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)                               AS developers,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                    AS agents,
          (SELECT COUNT(*) FROM organizations)                                             AS organizations,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')               AS installs,
          (SELECT COUNT(*) FROM agent_reviews)                                             AS reviews,
          (SELECT COUNT(*) FROM ai_revenue_events)                                         AS revenue_events,
          (SELECT COUNT(*) FROM developer_royalty_accounts WHERE lifetime_earned > 0)     AS earning_devs,
          (SELECT COALESCE(SUM(lifetime_earned),0) FROM developer_royalty_accounts)       AS total_royalties,
          (SELECT COUNT(*) FROM beta_case_studies WHERE verification_status='verified')   AS verified_stories,
          (SELECT COUNT(*) FROM unified_agent_action_log)                                  AS executions,
          (SELECT AVG(rating) FROM agent_reviews)                                          AS avg_rating
      `));

      const devs     = n(c.developers);
      const agents   = n(c.agents);
      const orgs     = n(c.organizations);
      const installs = n(c.installs);
      const reviews  = n(c.reviews);
      const revEvents= n(c.revenue_events);
      const earnDevs = n(c.earning_devs);
      const royalties= parseFloat(Number(c.total_royalties ?? 0).toFixed(2));
      const stories  = n(c.verified_stories);
      const execs    = n(c.executions);
      const avgRating= c.avg_rating ? parseFloat(Number(c.avg_rating).toFixed(2)) : 0;

      // Stage criteria
      const stages = [
        {
          stage: 1, name: "Infrastructure",
          description: "Platform built, tables exist, endpoints live",
          criteria: { agents: 1, installs: 1 },
          met: agents >= 1 && installs >= 1,
        },
        {
          stage: 2, name: "Emerging",
          description: "First real users, first agent installs, first reviews",
          criteria: { developers: 1, agents: 3, installs: 5, reviews: 1 },
          met: devs >= 1 && agents >= 3 && installs >= 5 && reviews >= 1,
        },
        {
          stage: 3, name: "Active",
          description: "Regular usage, multiple developers, revenue events",
          criteria: { developers: 5, agents: 10, installs: 25, reviews: 10, revenueEvents: 1 },
          met: devs >= 5 && agents >= 10 && installs >= 25 && reviews >= 10 && revEvents >= 1,
        },
        {
          stage: 4, name: "Growing",
          description: "Compounding installs, royalties flowing, repeat developers",
          criteria: { developers: 10, agents: 20, installs: 50, reviews: 25, royalties: 100 },
          met: devs >= 10 && agents >= 20 && installs >= 50 && reviews >= 25 && royalties >= 100,
        },
        {
          stage: 5, name: "Self-Sustaining",
          description: "Ecosystem grows without intervention, referrals driving growth",
          criteria: { developers: 20, agents: 50, installs: 200, reviews: 100, royalties: 1000 },
          met: devs >= 20 && agents >= 50 && installs >= 200 && reviews >= 100 && royalties >= 1000,
        },
      ];

      const currentStage = [...stages].reverse().find(s => s.met) ?? stages[0];
      const nextStage    = stages.find(s => s.stage === currentStage.stage + 1) ?? null;

      res.json({
        currentStage:  currentStage.stage,
        currentName:   currentStage.name,
        description:   currentStage.description,
        stages,
        nextStage:     nextStage ? { stage: nextStage.stage, name: nextStage.name, criteria: nextStage.criteria } : null,
        components:    { developers: devs, agents, organizations: orgs, installs, reviews, revenueEvents: revEvents, earningDevs: earnDevs, royalties, verifiedStories: stories, executions: execs, avgRating },
        wave2Target:   "Active",
        onTrack:       currentStage.stage >= 2,
      });
    } catch (e) {
      console.error("[marketplace/maturity]", e);
      res.status(500).json({ error: "Failed to compute maturity" });
    }
  });

  // ─── PART 12: Community CRUD ───────────────────────────────────────────────
  app.get("/api/community/announcements", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM marketplace_announcements WHERE published=true ORDER BY pinned DESC, created_at DESC LIMIT 50`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch announcements" }); }
  });

  app.post("/api/community/announcements", async (req, res) => {
    try {
      const { title, body, type, author_id, author_name, pinned } = req.body;
      if (!title || !body) return res.status(400).json({ error: "title and body required" });
      const r = rows(await db.execute(sql`
        INSERT INTO marketplace_announcements (id, title, body, type, author_id, author_name, pinned)
        VALUES (gen_random_uuid()::text, ${title}, ${body}, ${type ?? 'general'}, ${author_id ?? null}, ${author_name ?? null}, ${pinned ?? false})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create announcement" }); }
  });

  app.get("/api/community/developer-updates", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM developer_updates WHERE published=true ORDER BY created_at DESC LIMIT 50`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch developer updates" }); }
  });

  app.post("/api/community/developer-updates", async (req, res) => {
    try {
      const { developer_id, agent_id, agent_name, title, body, update_type } = req.body;
      if (!developer_id || !title || !body) return res.status(400).json({ error: "developer_id, title and body required" });
      const r = rows(await db.execute(sql`
        INSERT INTO developer_updates (id, developer_id, agent_id, agent_name, title, body, update_type)
        VALUES (gen_random_uuid()::text, ${developer_id}, ${agent_id ?? null}, ${agent_name ?? null}, ${title}, ${body}, ${update_type ?? 'update'})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create developer update" }); }
  });

  app.get("/api/community/release-notes", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM agent_release_notes WHERE published=true ORDER BY released_at DESC LIMIT 50`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch release notes" }); }
  });

  app.post("/api/community/release-notes", async (req, res) => {
    try {
      const { agent_id, agent_name, version, title, body, change_type } = req.body;
      if (!agent_id || !title || !body) return res.status(400).json({ error: "agent_id, title and body required" });
      const r = rows(await db.execute(sql`
        INSERT INTO agent_release_notes (id, agent_id, agent_name, version, title, body, change_type)
        VALUES (gen_random_uuid()::text, ${agent_id}, ${agent_name ?? null}, ${version ?? null}, ${title}, ${body}, ${change_type ?? 'improvement'})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create release note" }); }
  });

  // ─── PART 13: Beta Wave 2 Scorecard ───────────────────────────────────────
  app.get("/api/platform/beta-wave2-scorecard", async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)                                    AS developers,
          (SELECT COUNT(*) FROM org_onboarding_sessions)                                       AS organizations,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                         AS agents_published,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')                    AS installs,
          (SELECT COUNT(*) FROM unified_agent_action_log)                                      AS executions,
          (SELECT COUNT(*) FROM agent_reviews)                                                  AS reviews,
          (SELECT COUNT(*) FILTER (WHERE verification_status='verified') FROM beta_case_studies) AS case_studies,
          (SELECT COUNT(*) FROM ai_revenue_events)                                              AS revenue_events,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid')              AS royalty_payouts,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')                    AS active_installs,
          (SELECT COUNT(*) FROM org_installed_agents)                                          AS total_installs
      `));

      const retentionRate = n(c.total_installs) > 0
        ? Math.round((n(c.active_installs) / n(c.total_installs)) * 100) : 0;

      // Liquidity score (inline)
      const liquidityScore = Math.min(100, Math.round(
        Math.min(n(c.developers) / 10, 1)  * 15 +
        Math.min(n(c.agents_published)/20,1)* 15 +
        Math.min(n(c.organizations)/20,1)  * 10 +
        Math.min(n(c.installs) / 50, 1)    * 20 +
        Math.min(n(c.reviews)  / 25, 1)    * 15 +
        Math.min(n(c.executions)/200, 1)   * 15 +
        Math.min(n(c.revenue_events)/5, 1) * 10
      ));

      const betaScore = Math.min(100, Math.round(
        Math.min(n(c.developers)/10,1)       * 12 +
        Math.min(n(c.organizations)/20,1)    * 12 +
        Math.min(n(c.agents_published)/20,1) * 12 +
        Math.min(n(c.installs)/50,1)         * 12 +
        Math.min(n(c.executions)/200,1)      * 12 +
        Math.min(n(c.reviews)/25,1)          * 10 +
        Math.min(n(c.case_studies)/10,1)     * 10 +
        Math.min(n(c.revenue_events)/5,1)    * 10 +
        Math.min(retentionRate/70,1)         * 10
      ));

      const metrics: Record<string, { actual: number; target: number }> = {
        developers:        { actual: n(c.developers),       target: 10  },
        organizations:     { actual: n(c.organizations),    target: 20  },
        agentsPublished:   { actual: n(c.agents_published), target: 20  },
        installs:          { actual: n(c.installs),         target: 50  },
        executions:        { actual: n(c.executions),       target: 200 },
        reviews:           { actual: n(c.reviews),          target: 25  },
        caseStudies:       { actual: n(c.case_studies),     target: 10  },
        revenueEvents:     { actual: n(c.revenue_events),   target: 5   },
        royaltyPayouts:    { actual: n(c.royalty_payouts),  target: 1   },
        retentionRate:     { actual: retentionRate,         target: 70  },
        liquidityScore:    { actual: liquidityScore,        target: 50  },
        betaScore:         { actual: betaScore,             target: 70  },
      };

      const exitCriteria = [
        { criterion: "≥10 developers publish agents",       met: n(c.developers) >= 10 },
        { criterion: "≥20 organizations install agents",    met: n(c.organizations) >= 20 },
        { criterion: "≥50 agent installs",                  met: n(c.installs) >= 50 },
        { criterion: "≥200 executions",                     met: n(c.executions) >= 200 },
        { criterion: "≥25 reviews submitted",               met: n(c.reviews) >= 25 },
        { criterion: "≥10 verified case studies",           met: n(c.case_studies) >= 10 },
        { criterion: "≥5 revenue events",                   met: n(c.revenue_events) >= 5 },
        { criterion: "≥1 royalty payout generated",         met: n(c.royalty_payouts) >= 1 },
        { criterion: "Liquidity Score ≥ 50",                met: liquidityScore >= 50 },
        { criterion: "Beta Score ≥ 70",                     met: betaScore >= 70 },
        { criterion: "Marketplace Maturity = Active+",      met: false },
      ];

      const metricVals = Object.values(metrics);
      const overallScore = Math.round(
        metricVals.reduce((acc, v) => acc + Math.min((v.actual / v.target) * 100, 100), 0) / metricVals.length
      );

      res.json({
        overallScore,
        betaScore,
        liquidityScore,
        verdict: overallScore >= 70 ? "PASS" : overallScore >= 40 ? "IN_PROGRESS" : "NEEDS_WORK",
        metrics,
        exitCriteria,
        metCriteriaCount: exitCriteria.filter(e => e.met).length,
        totalCriteria: exitCriteria.length,
      });
    } catch (e) {
      console.error("[platform/beta-wave2-scorecard]", e);
      res.status(500).json({ error: "Failed to compute scorecard" });
    }
  });
}
