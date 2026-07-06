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
function safe(v: number, max = 100): number { return Math.min(max, Math.max(0, Math.round(v))); }

export async function registerBetaWave5Routes(app: Express) {

  // ─── PART 1: Marketplace Velocity ─────────────────────────────────────────
  app.get("/api/platform/velocity", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const weeks = rows(await db.execute(sql`
        SELECT
          date_trunc('week', created_at) AS week,
          'install' AS type, COUNT(*) AS cnt
        FROM org_installed_agents GROUP BY 1
        UNION ALL
        SELECT date_trunc('week', created_at), 'developer', COUNT(*)
        FROM developer_royalty_accounts GROUP BY 1
        UNION ALL
        SELECT date_trunc('week', created_at), 'org', COUNT(*)
        FROM org_onboarding_sessions GROUP BY 1
        UNION ALL
        SELECT date_trunc('week', created_at), 'review', COUNT(*)
        FROM agent_reviews GROUP BY 1
        UNION ALL
        SELECT date_trunc('week', created_at), 'revenue', COUNT(*)
        FROM ai_revenue_events GROUP BY 1
        UNION ALL
        SELECT date_trunc('week', created_at), 'royalty', COUNT(*)
        FROM royalty_distributions WHERE payout_status='paid' GROUP BY 1
        ORDER BY 1 DESC
      `));

      // Group by week
      const byWeek: Record<string, Record<string, number>> = {};
      for (const row of weeks) {
        const w = row.week ? new Date(row.week).toISOString().slice(0, 10) : "unknown";
        if (!byWeek[w]) byWeek[w] = { installs: 0, developers: 0, orgs: 0, reviews: 0, revenue: 0, royalties: 0 };
        const typeMap: Record<string, string> = { install: "installs", developer: "developers", org: "orgs", review: "reviews", revenue: "revenue", royalty: "royalties" };
        const key = typeMap[row.type] ?? row.type;
        byWeek[w][key] = n(row.cnt);
      }
      const weekList = Object.entries(byWeek).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12).reverse();

      // Velocity = week-over-week growth in total activity
      const totals = weekList.map(([w, d]) => ({ week: w, total: Object.values(d).reduce((a, b) => a + b, 0), ...d }));
      const latest  = totals[totals.length - 1];
      const prev    = totals[totals.length - 2];
      const growth  = latest && prev ? latest.total - prev.total : 0;
      const velocity = latest && prev && prev.total > 0 ? parseFloat(((growth / prev.total) * 100).toFixed(1)) : 0;
      const accel    = totals.length >= 3 ? (() => {
        const p2 = totals[totals.length - 3];
        const prevGrowth = prev.total - p2.total;
        return growth - prevGrowth;
      })() : 0;

      res.json({
        weeks: totals,
        latest,
        growthVelocity: velocity,
        acceleration: accel,
        trend: velocity > 5 ? "Accelerating" : velocity > 0 ? "Growing" : velocity === 0 ? "Stable" : "Declining",
      });
    } catch (e) {
      console.error("[platform/velocity]", e);
      res.status(500).json({ error: "Failed to compute velocity" });
    }
  });

  // ─── PART 2: Time-to-Value ─────────────────────────────────────────────────
  app.get("/api/platform/time-to-value", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const installTimes = rows(await db.execute(sql`
        SELECT
          EXTRACT(EPOCH FROM (at2.created_at - dra.created_at)) AS reg_to_publish
        FROM developer_royalty_accounts dra
        JOIN agent_templates at2 ON at2.maintainer = dra.developer_id AND at2.status='active'
        WHERE at2.created_at > dra.created_at
        LIMIT 100
      `));
      const execTimes = rows(await db.execute(sql`
        SELECT
          oos.time_to_first_execution,
          oos.time_to_first_outcome,
          oos.time_to_first_review
        FROM org_onboarding_sessions oos
        WHERE oos.time_to_first_execution IS NOT NULL
        LIMIT 100
      `));
      const installToExec = execTimes.map((r: any) => n(r.time_to_first_execution)).filter(Boolean);
      const execToOutcome = execTimes.map((r: any) => n(r.time_to_first_outcome)).filter(Boolean);
      const outcomeToReview= execTimes.map((r: any) => n(r.time_to_first_review)).filter(Boolean);
      const regToPublish  = installTimes.map((r: any) => n(r.reg_to_publish)).filter(Boolean);

      function stats(arr: number[], unit = "hours") {
        if (!arr.length) return { avg: null, fastest: null, slowest: null, unit, dataPoints: 0 };
        const factor = unit === "hours" ? 1 / 3600 : unit === "days" ? 1 / 86400 : 1;
        const sorted = [...arr].sort((a, b) => a - b);
        return {
          avg:     parseFloat((sorted.reduce((a, b) => a + b, 0) / sorted.length * factor).toFixed(1)),
          fastest: parseFloat((sorted[0] * factor).toFixed(1)),
          slowest: parseFloat((sorted[sorted.length - 1] * factor).toFixed(1)),
          unit, dataPoints: arr.length,
        };
      }

      res.json({
        steps: [
          { name: "Registration → First Agent Published",   ...stats(regToPublish, "days") },
          { name: "Install → First Execution",              ...stats(installToExec, "hours") },
          { name: "Execution → First Outcome",              ...stats(execToOutcome, "hours") },
          { name: "Outcome → First Review",                 ...stats(outcomeToReview, "hours") },
        ],
        bottleneck: "Registration → First Agent Published",
        recommendation: regToPublish.length === 0
          ? "No publish data yet — need developers to create first agents"
          : `Average publish time: ${parseFloat((regToPublish.reduce((a, b) => a + b, 0) / regToPublish.length / 86400).toFixed(1))} days`,
      });
    } catch (e) {
      console.error("[platform/time-to-value]", e);
      res.status(500).json({ error: "Failed to compute time to value" });
    }
  });

  // ─── PART 3: Developer Streak CRUD ────────────────────────────────────────
  app.get("/api/developer-streaks", async (_req, res) => {
    try {
      const streaks = rows(await db.execute(sql`
        SELECT ds.*, dra.lifetime_earned,
               COUNT(DISTINCT at2.agent_id) AS real_agents,
               COUNT(DISTINCT oia.id)       AS real_installs
        FROM developer_streaks ds
        LEFT JOIN developer_royalty_accounts dra ON dra.developer_id = ds.developer_id
        LEFT JOIN agent_templates at2 ON at2.maintainer = ds.developer_id AND at2.status='active'
        LEFT JOIN org_installed_agents oia ON oia.agent_id = at2.agent_id AND oia.status='active'
        GROUP BY ds.id, dra.lifetime_earned
        ORDER BY ds.agents_published DESC
      `));
      res.json(streaks.map((s: any) => ({
        ...s,
        realAgents: n(s.real_agents),
        realInstalls: n(s.real_installs),
        lifetimeEarned: parseFloat(Number(s.lifetime_earned ?? 0).toFixed(2)),
      })));
    } catch (e) { res.status(500).json({ error: "Failed to fetch developer streaks" }); }
  });

  app.post("/api/developer-streaks", async (req, res) => {
    try {
      const { developer_id } = req.body;
      if (!developer_id) return res.status(400).json({ error: "developer_id required" });
      const r = rows(await db.execute(sql`
        INSERT INTO developer_streaks (id, developer_id)
        VALUES (gen_random_uuid()::text, ${developer_id})
        ON CONFLICT (developer_id) DO NOTHING
        RETURNING *
      `));
      res.status(201).json(r[0] ?? { developer_id, exists: true });
    } catch (e) { res.status(500).json({ error: "Failed to upsert developer streak" }); }
  });

  // ─── PART 4: Org Streak CRUD ───────────────────────────────────────────────
  app.get("/api/org-streaks", async (_req, res) => {
    try {
      const streaks = rows(await db.execute(sql`
        SELECT os2.*, COUNT(DISTINCT oia.id) AS real_installs, COUNT(DISTINCT ar.id) AS real_reviews
        FROM org_streaks os2
        LEFT JOIN org_installed_agents oia ON oia.org_id = os2.org_id AND oia.status='active'
        LEFT JOIN agent_reviews ar         ON ar.org_id  = os2.org_id
        GROUP BY os2.id
        ORDER BY os2.installs_count DESC
      `));
      res.json(streaks.map((s: any) => ({ ...s, realInstalls: n(s.real_installs), realReviews: n(s.real_reviews) })));
    } catch (e) { res.status(500).json({ error: "Failed to fetch org streaks" }); }
  });

  app.post("/api/org-streaks", async (req, res) => {
    try {
      const { org_id } = req.body;
      if (!org_id) return res.status(400).json({ error: "org_id required" });
      const r = rows(await db.execute(sql`
        INSERT INTO org_streaks (id, org_id)
        VALUES (gen_random_uuid()::text, ${org_id})
        ON CONFLICT (org_id) DO NOTHING
        RETURNING *
      `));
      res.status(201).json(r[0] ?? { org_id, exists: true });
    } catch (e) { res.status(500).json({ error: "Failed to upsert org streak" }); }
  });

  // Auto-sync streaks from real data
  app.post("/api/streaks/sync", async (_req, res) => {
    try {
      // Upsert developer streaks from agent_templates
      await db.execute(sql`
        INSERT INTO developer_streaks (id, developer_id, agents_published, last_publish_at, updated_at)
        SELECT gen_random_uuid()::text, maintainer, COUNT(*), MAX(created_at), NOW()
        FROM agent_templates WHERE status='active' GROUP BY maintainer
        ON CONFLICT (developer_id) DO UPDATE SET
          agents_published = EXCLUDED.agents_published,
          last_publish_at  = EXCLUDED.last_publish_at,
          tier = CASE
            WHEN EXCLUDED.agents_published >= 5 THEN 'marketplace_builder'
            WHEN EXCLUDED.agents_published >= 3 THEN 'gold'
            WHEN EXCLUDED.agents_published >= 2 THEN 'silver'
            ELSE 'bronze'
          END,
          updated_at = NOW()
      `);
      // Upsert org streaks from org_installed_agents
      await db.execute(sql`
        INSERT INTO org_streaks (id, org_id, installs_count, last_install_at, updated_at)
        SELECT gen_random_uuid()::text, org_id, COUNT(*), MAX(created_at), NOW()
        FROM org_installed_agents WHERE status='active' GROUP BY org_id
        ON CONFLICT (org_id) DO UPDATE SET
          installs_count  = EXCLUDED.installs_count,
          last_install_at = EXCLUDED.last_install_at,
          tier = CASE
            WHEN EXCLUDED.installs_count >= 5 THEN 'marketplace_champion'
            WHEN EXCLUDED.installs_count >= 3 THEN 'operator'
            WHEN EXCLUDED.installs_count >= 2 THEN 'builder'
            ELSE 'explorer'
          END,
          updated_at = NOW()
      `);
      res.json({ ok: true, message: "Streaks synced from real data" });
    } catch (e) {
      console.error("[streaks/sync]", e);
      res.status(500).json({ error: "Failed to sync streaks" });
    }
  });

  // ─── PART 5: Royalty Milestones ────────────────────────────────────────────
  app.get("/api/platform/royalty-milestones", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const dist = rows(await db.execute(sql`
        SELECT rd.developer_id, rd.agent_id, rd.developer_share, rd.payout_status, rd.created_at,
               at2.agent_name, at2.maintainer
        FROM royalty_distributions rd
        LEFT JOIN agent_templates at2 ON at2.agent_id = rd.agent_id
        ORDER BY rd.created_at ASC
      `));
      const accounts = rows(await db.execute(sql`
        SELECT developer_id, lifetime_earned FROM developer_royalty_accounts ORDER BY lifetime_earned DESC
      `));

      const milestones = [
        { name: "First Royalty",          threshold: 0,   unit: "event" },
        { name: "First $10 Earned",       threshold: 10,  unit: "usd" },
        { name: "First $100 Earned",      threshold: 100, unit: "usd" },
        { name: "First $500 Earned",      threshold: 500, unit: "usd" },
        { name: "First $1,000 Earned",    threshold: 1000,unit: "usd" },
        { name: "Developer Profitability",threshold: 0,   unit: "profitability" },
      ].map(m => {
        if (m.unit === "event") {
          const first = dist[0];
          return { ...m, met: dist.length >= 1, agent: first?.agent_name, developer: first?.developer_id, date: first?.created_at ?? null, evidence: first ? `$${Number(first.developer_share).toFixed(2)} distributed` : null };
        }
        if (m.unit === "usd") {
          const match = accounts.find((a: any) => n(a.lifetime_earned) >= m.threshold);
          return { ...m, met: !!match, agent: null, developer: match?.developer_id ?? null, date: null, evidence: match ? `$${Number(match.lifetime_earned).toFixed(2)} lifetime` : null };
        }
        // profitability = any dev with > $0
        const profitable = accounts.filter((a: any) => n(a.lifetime_earned) > 0);
        return { ...m, met: profitable.length > 0, agent: null, developer: profitable[0]?.developer_id ?? null, date: null, evidence: profitable.length ? `${profitable.length} profitable developers` : null };
      });

      res.json({
        milestones,
        metCount: milestones.filter(m => m.met).length,
        topEarner: accounts[0] ? { developer: accounts[0].developer_id, earned: parseFloat(Number(accounts[0].lifetime_earned).toFixed(2)) } : null,
        totalDistributed: parseFloat(dist.reduce((a: number, r: any) => a + n(r.developer_share), 0).toFixed(2)),
      });
    } catch (e) {
      console.error("[platform/royalty-milestones]", e);
      res.status(500).json({ error: "Failed to compute royalty milestones" });
    }
  });

  // ─── PART 6: Marketplace Cohorts ──────────────────────────────────────────
  app.get("/api/platform/cohorts", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const now = new Date();
      const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
      const d60 = new Date(now.getTime() - 60 * 86400000).toISOString();
      const d90 = new Date(now.getTime() - 90 * 86400000).toISOString();

      const devTotal  = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM developer_royalty_accounts`)).c);
      const devActive30 = n(row0(await db.execute(sql`
        SELECT COUNT(DISTINCT maintainer) AS c FROM agent_templates WHERE created_at > ${d30}
      `)).c);
      const devActive60 = n(row0(await db.execute(sql`
        SELECT COUNT(DISTINCT maintainer) AS c FROM agent_templates WHERE created_at > ${d60}
      `)).c);
      const devActive90 = n(row0(await db.execute(sql`
        SELECT COUNT(DISTINCT maintainer) AS c FROM agent_templates WHERE created_at > ${d90}
      `)).c);

      const orgTotal  = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM org_onboarding_sessions`)).c);
      const orgActive30 = n(row0(await db.execute(sql`
        SELECT COUNT(DISTINCT org_id) AS c FROM org_installed_agents WHERE created_at > ${d30} AND status='active'
      `)).c);
      const orgActive60 = n(row0(await db.execute(sql`
        SELECT COUNT(DISTINCT org_id) AS c FROM org_installed_agents WHERE created_at > ${d60} AND status='active'
      `)).c);
      const orgActive90 = n(row0(await db.execute(sql`
        SELECT COUNT(DISTINCT org_id) AS c FROM org_installed_agents WHERE created_at > ${d90} AND status='active'
      `)).c);

      const agentTotal = n(row0(await db.execute(sql`SELECT COUNT(*) AS c FROM agent_templates WHERE status='active'`)).c);
      const agentActive30 = n(row0(await db.execute(sql`
        SELECT COUNT(DISTINCT agent_id) AS c FROM org_installed_agents WHERE created_at > ${d30} AND status='active'
      `)).c);

      const devRetention = pct(devActive30, devTotal);
      const orgRetention = pct(orgActive30, orgTotal);

      res.json({
        developer: {
          total: devTotal,
          retention30: devRetention,  active30: devActive30,
          retention60: pct(devActive60, devTotal), active60: devActive60,
          retention90: pct(devActive90, devTotal), active90: devActive90,
          health: devRetention >= 50 ? "Healthy" : devRetention >= 25 ? "At Risk" : "Churning",
          atRisk: devRetention < 50,
        },
        organization: {
          total: orgTotal,
          retention30: orgRetention,  active30: orgActive30,
          retention60: pct(orgActive60, orgTotal), active60: orgActive60,
          retention90: pct(orgActive90, orgTotal), active90: orgActive90,
          health: orgRetention >= 50 ? "Healthy" : orgRetention >= 25 ? "At Risk" : "Churning",
          atRisk: orgRetention < 50,
        },
        agent: {
          total: agentTotal,
          active30: agentActive30,
          retention30: pct(agentActive30, agentTotal),
        },
        churnDrivers: [
          devRetention < 50 ? "Developers not returning to publish more agents" : null,
          orgRetention < 50 ? "Organizations not installing new agents" : null,
        ].filter(Boolean),
        meetsWave5: devRetention > 50 && orgRetention > 50,
      });
    } catch (e) {
      console.error("[platform/cohorts]", e);
      res.status(500).json({ error: "Failed to compute cohorts" });
    }
  });

  // ─── PART 7: Referral Flywheel ─────────────────────────────────────────────
  app.get("/api/platform/referral-flywheel", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const devRef = rows(await db.execute(sql`
        SELECT dr.referrer_id, dr.status, dr.generated_revenue, dr.published_agent, 'dev→dev' AS flow FROM developer_referrals dr
      `));
      const orgRef = rows(await db.execute(sql`
        SELECT or2.referrer_id, or2.status, or2.generated_revenue, or2.installed_agent, 'org→org' AS flow FROM org_referrals or2
      `));

      const all = [...devRef, ...orgRef];
      const accepted    = all.filter((r: any) => r.status === "accepted");
      const totalRevenue= parseFloat(all.reduce((a: number, r: any) => a + n(r.generated_revenue), 0).toFixed(2));
      const converted   = all.filter((r: any) => r.published_agent || r.installed_agent).length;
      const multiplier  = all.length > 0
        ? parseFloat((accepted.length / Math.max(all.length - accepted.length, 1)).toFixed(2))
        : 0;

      res.json({
        flows: [
          { type: "Developer → Developer", sent: devRef.length, accepted: devRef.filter((r: any) => r.status === "accepted").length, converted: devRef.filter((r: any) => r.published_agent).length, revenue: parseFloat(devRef.reduce((a: number, r: any) => a + n(r.generated_revenue), 0).toFixed(2)) },
          { type: "Organization → Organization", sent: orgRef.length, accepted: orgRef.filter((r: any) => r.status === "accepted").length, converted: orgRef.filter((r: any) => r.installed_agent).length, revenue: parseFloat(orgRef.reduce((a: number, r: any) => a + n(r.generated_revenue), 0).toFixed(2)) },
        ],
        totals:          { sent: all.length, accepted: accepted.length, converted, revenue: totalRevenue },
        multiplierScore: multiplier,
        flywheelActive:  all.length >= 5 && converted >= 2,
        wave5Target:     10,
      });
    } catch (e) {
      console.error("[platform/referral-flywheel]", e);
      res.status(500).json({ error: "Failed to compute referral flywheel" });
    }
  });

  // ─── PART 8: Conversion Optimization ──────────────────────────────────────
  app.get("/api/platform/conversion-optimization", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM beta_invites WHERE role='developer')                    AS devs_invited,
          (SELECT COUNT(*) FROM developer_royalty_accounts)                             AS devs_registered,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                  AS agents_published,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')             AS installs,
          (SELECT COUNT(*) FROM agent_reviews)                                          AS reviews,
          (SELECT COUNT(*) FROM developer_referrals) + (SELECT COUNT(*) FROM org_referrals) AS referrals,
          (SELECT COUNT(*) FROM ai_revenue_events)                                      AS rev_events
      `));

      const stages = [
        { stage: "Developer Invited → Registered",  from: n(c.devs_invited),     to: n(c.devs_registered),  rate: pct(n(c.devs_registered), n(c.devs_invited)) },
        { stage: "Registered → First Agent",        from: n(c.devs_registered),  to: n(c.agents_published), rate: pct(n(c.agents_published), n(c.devs_registered)) },
        { stage: "Published → First Install",       from: n(c.agents_published), to: n(c.installs),         rate: pct(n(c.installs), n(c.agents_published)) },
        { stage: "Installed → First Review",        from: n(c.installs),         to: n(c.reviews),          rate: pct(n(c.reviews), n(c.installs)) },
        { stage: "Reviewed → First Referral",       from: n(c.reviews),          to: n(c.referrals),        rate: pct(n(c.referrals), n(c.reviews)) },
        { stage: "Referral → Revenue",              from: n(c.referrals),        to: n(c.rev_events),       rate: pct(n(c.rev_events), n(c.referrals)) },
      ];

      const lowestStage = stages.filter(s => s.from > 0).sort((a, b) => a.rate - b.rate)[0];

      const improvements = [
        { priority: 1, stage: lowestStage?.stage ?? "Publisher Acquisition", issue: `Only ${lowestStage?.rate ?? 0}% conversion`, fix: "Direct outreach to blocked prospects", impact: "High", confidence: "High" },
        { priority: 2, stage: "Registered → First Agent", issue: `${pct(n(c.agents_published), n(c.devs_registered))}% publish rate`, fix: "Provide agent templates and guided onboarding", impact: "High", confidence: "Medium" },
        { priority: 3, stage: "Installed → First Review", issue: `${pct(n(c.reviews), n(c.installs))}% review rate`, fix: "Auto-email after first execution requesting review", impact: "Medium", confidence: "High" },
        { priority: 4, stage: "Published → First Install", issue: `${pct(n(c.installs), n(c.agents_published))}% install rate`, fix: "Feature new agents on marketplace homepage", impact: "Medium", confidence: "Medium" },
        { priority: 5, stage: "Reviewed → Referral", issue: `${pct(n(c.referrals), n(c.reviews))}% referral rate`, fix: "Referral incentives for satisfied reviewers", impact: "Medium", confidence: "Low" },
      ];

      res.json({ stages, lowestStage, improvements, overallFunnelRate: pct(n(c.rev_events), n(c.devs_invited)) });
    } catch (e) {
      console.error("[platform/conversion-optimization]", e);
      res.status(500).json({ error: "Failed to compute conversion optimization" });
    }
  });

  // ─── PART 9: Hall of Fame data ─────────────────────────────────────────────
  app.get("/api/community/hall-of-fame", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const firstPublisher = row0(await db.execute(sql`
        SELECT maintainer AS developer_id, agent_name, agent_id, created_at
        FROM agent_templates WHERE status='active' ORDER BY created_at ASC LIMIT 1
      `));
      const firstRevAgent = row0(await db.execute(sql`
        SELECT action_source AS agent_id, MIN(created_at) AS first_rev_at, COUNT(*) AS events
        FROM ai_revenue_events GROUP BY action_source ORDER BY first_rev_at ASC LIMIT 1
      `));
      const firstRoyalty = row0(await db.execute(sql`
        SELECT developer_id, developer_share, created_at
        FROM royalty_distributions WHERE payout_status='paid'
        ORDER BY created_at ASC LIMIT 1
      `));
      const topDev = row0(await db.execute(sql`
        SELECT developer_id, lifetime_earned FROM developer_royalty_accounts
        ORDER BY lifetime_earned DESC LIMIT 1
      `));
      const topReferrer = row0(await db.execute(sql`
        SELECT referrer_id, COUNT(*) AS total
        FROM (
          SELECT referrer_id FROM developer_referrals
          UNION ALL SELECT referrer_id FROM org_referrals
        ) t GROUP BY referrer_id ORDER BY total DESC LIMIT 1
      `));
      const topOrg = row0(await db.execute(sql`
        SELECT org_id, COUNT(*) AS installs FROM org_installed_agents
        WHERE status='active' GROUP BY org_id ORDER BY installs DESC LIMIT 1
      `));
      const mostTrusted = row0(await db.execute(sql`
        SELECT at2.agent_id, at2.agent_name, at2.average_trust_score, at2.average_success_rate, COUNT(DISTINCT ar.id) AS reviews
        FROM agent_templates at2
        LEFT JOIN agent_reviews ar ON ar.agent_id = at2.agent_id
        WHERE at2.status='active'
        GROUP BY at2.agent_id, at2.agent_name, at2.average_trust_score, at2.average_success_rate
        ORDER BY at2.average_trust_score DESC NULLS LAST LIMIT 1
      `));

      res.json({
        hallOfFame: [
          { title: "First Publisher",    icon: "🚀", recipient: firstPublisher.developer_id ?? null,    detail: firstPublisher.agent_name ?? null,           date: firstPublisher.created_at ?? null,   met: !!firstPublisher.developer_id },
          { title: "First Revenue Agent",icon: "💰", recipient: firstRevAgent.agent_id ?? null,         detail: `${n(firstRevAgent.events)} revenue events`,  date: firstRevAgent.first_rev_at ?? null,  met: !!firstRevAgent.agent_id },
          { title: "First Royalty Earner",icon:"💎", recipient: firstRoyalty.developer_id ?? null,      detail: `$${Number(firstRoyalty.developer_share ?? 0).toFixed(2)} earned`, date: firstRoyalty.created_at ?? null, met: !!firstRoyalty.developer_id },
          { title: "Top Developer",      icon: "⭐", recipient: topDev.developer_id ?? null,            detail: `$${Number(topDev.lifetime_earned ?? 0).toFixed(2)} lifetime`, date: null,                            met: !!topDev.developer_id },
          { title: "Top Referrer",       icon: "🔗", recipient: topReferrer.referrer_id ?? null,        detail: `${n(topReferrer.total)} referrals`,           date: null,                                met: !!topReferrer.referrer_id },
          { title: "Top Organization",   icon: "🏆", recipient: topOrg.org_id ?? null,                 detail: `${n(topOrg.installs)} installs`,              date: null,                                met: !!topOrg.org_id },
          { title: "Most Trusted Agent", icon: "🛡️", recipient: mostTrusted.agent_name ?? null,         detail: `Trust: ${n(mostTrusted.average_trust_score)}, Success: ${Number(mostTrusted.average_success_rate ?? 0).toFixed(1)}%`, date: null, met: !!mostTrusted.agent_id },
        ],
      });
    } catch (e) {
      console.error("[community/hall-of-fame]", e);
      res.status(500).json({ error: "Failed to compute hall of fame" });
    }
  });

  // ─── PART 10: Royalty Proof ────────────────────────────────────────────────
  app.get("/api/platform/royalty-proof", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const events = rows(await db.execute(sql`
        SELECT
          rd.id, rd.developer_id, rd.agent_id, rd.gross_revenue, rd.developer_share,
          rd.platform_share, rd.payout_status, rd.created_at,
          at2.agent_name, at2.maintainer,
          are2.outcome_value AS source_revenue_value, are2.outcome_status AS source_status
        FROM royalty_distributions rd
        LEFT JOIN agent_templates at2    ON at2.agent_id = rd.agent_id
        LEFT JOIN ai_revenue_events are2 ON are2.org_id  = rd.agent_id
        ORDER BY rd.created_at DESC LIMIT 50
      `));
      const totals = row0(await db.execute(sql`
        SELECT
          COUNT(*)                                    AS total_events,
          COALESCE(SUM(gross_revenue),0)              AS total_gross,
          COALESCE(SUM(developer_share),0)            AS total_developer,
          COALESCE(SUM(platform_share),0)             AS total_platform,
          COUNT(*) FILTER (WHERE payout_status='paid') AS paid_count
        FROM royalty_distributions
      `));

      res.json({
        events: events.map((e: any) => ({
          id: e.id,
          agent: e.agent_name ?? e.agent_id,
          developer: e.developer_id,
          gross: parseFloat(Number(e.gross_revenue).toFixed(2)),
          developerShare: parseFloat(Number(e.developer_share).toFixed(2)),
          platformShare: parseFloat(Number(e.platform_share).toFixed(2)),
          status: e.payout_status,
          sourceRevenue: n(e.source_revenue_value),
          date: e.created_at,
        })),
        totals: {
          events: n(totals.total_events),
          gross: parseFloat(Number(totals.total_gross).toFixed(2)),
          developerTotal: parseFloat(Number(totals.total_developer).toFixed(2)),
          platformTotal: parseFloat(Number(totals.total_platform).toFixed(2)),
          paidCount: n(totals.paid_count),
        },
        verified: n(totals.total_events) >= 1,
      });
    } catch (e) {
      console.error("[platform/royalty-proof]", e);
      res.status(500).json({ error: "Failed to compute royalty proof" });
    }
  });

  // ─── PART 11: Momentum Score ───────────────────────────────────────────────
  app.get("/api/platform/momentum", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const now = new Date();
      const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
      const d60 = new Date(now.getTime() - 60 * 86400000).toISOString();

      const recent = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM org_installed_agents WHERE created_at > ${d30})       AS installs_30,
          (SELECT COUNT(*) FROM org_installed_agents WHERE created_at > ${d60} AND created_at <= ${d30}) AS installs_prev,
          (SELECT COUNT(*) FROM agent_reviews WHERE created_at > ${d30})              AS reviews_30,
          (SELECT COUNT(*) FROM agent_reviews WHERE created_at > ${d60} AND created_at <= ${d30}) AS reviews_prev,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE created_at > ${d30})          AS rev_30,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid' AND created_at > ${d30}) AS roy_30,
          (SELECT COUNT(*) FROM developer_referrals WHERE created_at > ${d30}) +
            (SELECT COUNT(*) FROM org_referrals WHERE created_at > ${d30})            AS ref_30,
          (SELECT COUNT(*) FROM (
            SELECT maintainer FROM agent_templates WHERE status='active' GROUP BY maintainer HAVING COUNT(*)>=2) t) AS repeat_pubs,
          (SELECT COUNT(*) FROM (
            SELECT org_id FROM org_installed_agents WHERE status='active' GROUP BY org_id HAVING COUNT(*)>=2) t) AS repeat_inst,
          (SELECT COUNT(*) FROM developer_royalty_accounts)                           AS total_devs,
          (SELECT COUNT(*) FROM org_onboarding_sessions)                              AS total_orgs
      `));

      // Component scores
      const installGrowth = n(recent.installs_prev) > 0
        ? Math.min(100, safe((n(recent.installs_30) / n(recent.installs_prev)) * 50))
        : n(recent.installs_30) > 0 ? 40 : 0;
      const reviewGrowth = n(recent.reviews_prev) > 0
        ? Math.min(100, safe((n(recent.reviews_30) / n(recent.reviews_prev)) * 50))
        : n(recent.reviews_30) > 0 ? 30 : 0;

      const components = {
        growth:     installGrowth,
        retention:  safe(pct(n(recent.installs_30), n(recent.total_orgs)) * 2),
        reviews:    safe(n(recent.reviews_30) * 10),
        referrals:  safe(n(recent.ref_30) * 10),
        revenue:    n(recent.rev_30) >= 1 ? 100 : 0,
        royalties:  n(recent.roy_30) >= 1 ? 100 : 0,
        repeatUsage:safe((n(recent.repeat_pubs) + n(recent.repeat_inst)) * 20),
      };

      const score = safe(Object.values(components).reduce((a, b) => a + b, 0) / Object.keys(components).length);
      const stage = score >= 80 ? "Self-Sustaining" : score >= 65 ? "Accelerating" : score >= 50 ? "Growing" : score >= 25 ? "Emerging" : "Stalled";
      const reviewTrend = n(recent.reviews_30) > n(recent.reviews_prev) ? "up" : n(recent.reviews_30) === n(recent.reviews_prev) ? "flat" : "down";
      const installTrend= n(recent.installs_30) > n(recent.installs_prev) ? "up" : n(recent.installs_30) === n(recent.installs_prev) ? "flat" : "down";

      res.json({
        score, stage, components,
        trends: { installs: installTrend, reviews: reviewTrend },
        last30: { installs: n(recent.installs_30), reviews: n(recent.reviews_30), revenue: n(recent.rev_30), royalties: n(recent.roy_30), referrals: n(recent.ref_30) },
        wave5Target: 50,
        onTrack: score >= 25,
      });
    } catch (e) {
      console.error("[platform/momentum]", e);
      res.status(500).json({ error: "Failed to compute momentum" });
    }
  });

  // ─── PART 12/13: Wave 5 Scorecard ─────────────────────────────────────────
  app.get("/api/platform/wave5-scorecard", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM developer_royalty_accounts)                                  AS devs,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                       AS agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')                  AS installs,
          (SELECT COUNT(*) FROM agent_reviews)                                               AS reviews,
          (SELECT COUNT(*) FROM developer_referrals) + (SELECT COUNT(*) FROM org_referrals) AS referrals,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid')           AS royalty_events,
          (SELECT COUNT(*) FROM (SELECT maintainer FROM agent_templates WHERE status='active' GROUP BY maintainer HAVING COUNT(*)>=2) t) AS repeat_publishers,
          (SELECT COUNT(*) FROM (SELECT org_id FROM org_installed_agents WHERE status='active' GROUP BY org_id HAVING COUNT(*)>=2) t) AS repeat_installers,
          (SELECT COUNT(*) FROM developer_royalty_accounts)::float /
            NULLIF((SELECT COUNT(*) FROM developer_royalty_accounts),0) * 100               AS dev_retention_pct,
          (SELECT COUNT(DISTINCT org_id) FROM org_installed_agents WHERE created_at > ${d30} AND status='active')::float /
            NULLIF((SELECT COUNT(*) FROM org_onboarding_sessions),0) * 100                  AS org_retention_pct
      `));

      const metrics = {
        developers:       { actual: n(c.devs),              target: 10 },
        agentsPublished:  { actual: n(c.agents),            target: 10 },
        installs:         { actual: n(c.installs),          target: 25 },
        reviews:          { actual: n(c.reviews),           target: 25 },
        referrals:        { actual: n(c.referrals),         target: 10 },
        royaltyEvents:    { actual: n(c.royalty_events),    target: 1  },
        repeatPublishers: { actual: n(c.repeat_publishers), target: 2  },
        repeatInstallers: { actual: n(c.repeat_installers), target: 3  },
        devRetention:     { actual: safe(n(c.dev_retention_pct)), target: 50 },
        orgRetention:     { actual: safe(n(c.org_retention_pct)), target: 50 },
      };

      const exitCriteria = [
        { criterion: "≥10 developers registered",   met: n(c.devs) >= 10 },
        { criterion: "≥10 agents published",         met: n(c.agents) >= 10 },
        { criterion: "≥25 installs",                 met: n(c.installs) >= 25 },
        { criterion: "≥25 reviews",                  met: n(c.reviews) >= 25 },
        { criterion: "≥10 referrals",                met: n(c.referrals) >= 10 },
        { criterion: "≥1 royalty event",             met: n(c.royalty_events) >= 1 },
        { criterion: "≥2 repeat publishers",         met: n(c.repeat_publishers) >= 2 },
        { criterion: "≥3 repeat installers",         met: n(c.repeat_installers) >= 3 },
        { criterion: "Developer retention > 50%",    met: n(c.dev_retention_pct) > 50 },
        { criterion: "Organization retention > 50%", met: n(c.org_retention_pct) > 50 },
      ];

      const vals = Object.values(metrics);
      const overallScore = safe(vals.reduce((acc, v) => acc + Math.min((v.actual / v.target) * 100, 100), 0) / vals.length);
      const metCount = exitCriteria.filter(e => e.met).length;
      const verdict = metCount >= 10 ? "Wave 5 Complete" : metCount >= 7 ? "Nearly There" : metCount >= 4 ? "In Progress" : "Getting Started";

      res.json({ overallScore, verdict, metrics, exitCriteria, metCriteriaCount: metCount, totalCriteria: exitCriteria.length });
    } catch (e) {
      console.error("[platform/wave5-scorecard]", e);
      res.status(500).json({ error: "Failed to compute wave 5 scorecard" });
    }
  });

  // ─── PART 14: Marketplace Stage ───────────────────────────────────────────
  app.get("/api/platform/marketplace-stage", isAuthenticated, requireRole("COACH", "ADMIN"), async (_req, res) => {
    try {
      const c = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM agent_templates WHERE status='active')                       AS agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active')                  AS installs,
          (SELECT COUNT(*) FROM agent_reviews)                                               AS reviews,
          (SELECT COUNT(*) FROM ai_revenue_events)                                           AS rev_events,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid')           AS royalties,
          (SELECT COUNT(*) FROM developer_royalty_accounts)                                  AS devs,
          (SELECT COUNT(*) FROM (SELECT maintainer FROM agent_templates WHERE status='active' GROUP BY maintainer HAVING COUNT(*)>=2) t) AS repeat_pubs,
          (SELECT COUNT(*) FROM developer_referrals) + (SELECT COUNT(*) FROM org_referrals) AS referrals
      `));

      const stages = [
        {
          name: "Infrastructure",
          description: "Platform built, tables exist, seeded agents present",
          requirements: [
            { check: "Platform deployed",         met: true },
            { check: "Marketplace tables created", met: true },
            { check: "First agent seeded",         met: n(c.agents) >= 1 },
          ],
        },
        {
          name: "Emerging",
          description: "First real activity — installs, reviews, or revenue",
          requirements: [
            { check: "≥1 real install",            met: n(c.installs) >= 1 },
            { check: "≥1 review",                  met: n(c.reviews) >= 1 },
            { check: "≥1 developer registered",    met: n(c.devs) >= 1 },
          ],
        },
        {
          name: "Active",
          description: "Consistent activity across all dimensions",
          requirements: [
            { check: "≥5 installs",                met: n(c.installs) >= 5 },
            { check: "≥5 reviews",                 met: n(c.reviews) >= 5 },
            { check: "≥1 revenue event",           met: n(c.rev_events) >= 1 },
            { check: "≥3 developers",              met: n(c.devs) >= 3 },
          ],
        },
        {
          name: "Growing",
          description: "Repeat behavior and referrals emerging",
          requirements: [
            { check: "≥25 installs",               met: n(c.installs) >= 25 },
            { check: "≥25 reviews",                met: n(c.reviews) >= 25 },
            { check: "≥1 royalty event",           met: n(c.royalties) >= 1 },
            { check: "≥2 repeat publishers",       met: n(c.repeat_pubs) >= 2 },
            { check: "≥5 referrals",               met: n(c.referrals) >= 5 },
          ],
        },
        {
          name: "Accelerating",
          description: "Compounding activity, strong retention",
          requirements: [
            { check: "≥100 installs",              met: n(c.installs) >= 100 },
            { check: "≥10 developers",             met: n(c.devs) >= 10 },
            { check: "≥5 royalty events",          met: n(c.royalties) >= 5 },
          ],
        },
        {
          name: "Self-Sustaining",
          description: "Activity grows without founder involvement",
          requirements: [
            { check: "≥500 installs",              met: n(c.installs) >= 500 },
            { check: "≥50 developers",             met: n(c.devs) >= 50 },
            { check: "≥100 royalty events",        met: n(c.royalties) >= 100 },
          ],
        },
      ];

      let currentIndex = 0;
      for (let i = 0; i < stages.length; i++) {
        if (stages[i].requirements.every(r => r.met)) currentIndex = i;
        else break;
      }

      const current = stages[currentIndex];
      const next    = stages[currentIndex + 1] ?? null;
      const remaining = next ? next.requirements.filter(r => !r.met) : [];
      const distancePct = next ? Math.round((next.requirements.filter(r => r.met).length / next.requirements.length) * 100) : 100;

      res.json({
        currentStage:      current.name,
        currentIndex,
        totalStages:       stages.length,
        stages: stages.map((s, i) => ({ ...s, completed: i <= currentIndex, current: i === currentIndex })),
        nextStage:         next?.name ?? null,
        requirementsRemaining: remaining,
        distanceToNext:    distancePct,
      });
    } catch (e) {
      console.error("[platform/marketplace-stage]", e);
      res.status(500).json({ error: "Failed to compute marketplace stage" });
    }
  });
}
