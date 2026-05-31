import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";

function rows(r: unknown): any[] { if (Array.isArray(r)) return r; const x = r as any; return Array.isArray(x?.rows) ? x.rows : []; }
function row0(r: unknown): any { return rows(r)[0] ?? {}; }
function n(v: unknown): number { return Number(v ?? 0); }
function pct(a: number, b: number) { return b > 0 ? Math.round(a / b * 100) : 0; }

const SEEDED_ORG_ID = "TrainEfficiency";
const SEEDED_AGENT_IDS = ["growth_agent","recovery_agent","nutrition_agent","performance_agent",
  "mobility_agent","strength_agent","conditioning_agent","mental_performance_agent","assessment_agent"];

export async function registerBetaWaveXRoutes(app: Express) {

  // ─── Participant CRUD ─────────────────────────────────────────────────────
  app.get("/api/validation-participants", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM validation_participants ORDER BY created_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch participants" }); }
  });

  app.post("/api/validation-participants", async (req, res) => {
    try {
      const { type, external_name, external_email, organization, notes } = req.body;
      if (!external_name) return res.status(400).json({ error: "external_name required" });
      const r = rows(await db.execute(sql`
        INSERT INTO validation_participants (id, type, external_name, external_email, organization, notes)
        VALUES (gen_random_uuid()::text, ${type ?? 'developer'}, ${external_name}, ${external_email ?? null}, ${organization ?? null}, ${notes ?? null})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create participant" }); }
  });

  app.patch("/api/validation-participants/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, activated_at, first_publish_at, first_install_at, first_value_at, first_review_at, first_revenue_at, notes } = req.body;
      await db.execute(sql`
        UPDATE validation_participants SET
          status           = COALESCE(${status ?? null}, status),
          activated_at     = COALESCE(${activated_at     ? new Date(activated_at)     : null}, activated_at),
          first_publish_at = COALESCE(${first_publish_at ? new Date(first_publish_at) : null}, first_publish_at),
          first_install_at = COALESCE(${first_install_at ? new Date(first_install_at) : null}, first_install_at),
          first_value_at   = COALESCE(${first_value_at   ? new Date(first_value_at)   : null}, first_value_at),
          first_review_at  = COALESCE(${first_review_at  ? new Date(first_review_at)  : null}, first_review_at),
          first_revenue_at = COALESCE(${first_revenue_at ? new Date(first_revenue_at) : null}, first_revenue_at),
          notes            = COALESCE(${notes ?? null}, notes)
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to update participant" }); }
  });

  app.delete("/api/validation-participants/:id", async (req, res) => {
    try {
      await db.execute(sql`DELETE FROM validation_participants WHERE id = ${req.params.id}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to delete participant" }); }
  });

  // ─── Feedback CRUD ────────────────────────────────────────────────────────
  app.get("/api/participant-feedback", async (_req, res) => {
    try {
      const result = rows(await db.execute(sql`
        SELECT pf.*, vp.external_name, vp.type AS participant_type, vp.organization
        FROM participant_feedback pf
        LEFT JOIN validation_participants vp ON vp.id = pf.participant_id
        ORDER BY pf.submitted_at DESC
      `));
      res.json(result);
    } catch (e) { res.status(500).json({ error: "Failed to fetch feedback" }); }
  });

  app.post("/api/participant-feedback", async (req, res) => {
    try {
      const { participant_id, confused_by, expected, loved, almost_quit, use_again, recommend, pay_for_it, publish_another, overall_rating } = req.body;
      if (!participant_id) return res.status(400).json({ error: "participant_id required" });
      const r = rows(await db.execute(sql`
        INSERT INTO participant_feedback
          (id, participant_id, confused_by, expected, loved, almost_quit, use_again, recommend, pay_for_it, publish_another, overall_rating)
        VALUES
          (gen_random_uuid()::text, ${participant_id}, ${confused_by ?? null}, ${expected ?? null}, ${loved ?? null},
           ${almost_quit ?? null}, ${use_again ?? null}, ${recommend ?? null}, ${pay_for_it ?? null},
           ${publish_another ?? null}, ${overall_rating ?? null})
        RETURNING *
      `));
      // Update participant activation timestamp if first feedback
      await db.execute(sql`
        UPDATE validation_participants SET activated_at = COALESCE(activated_at, NOW()), status = 'activated'
        WHERE id = ${participant_id} AND activated_at IS NULL
      `);
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to submit feedback" }); }
  });

  // ─── Developer Friction Report ─────────────────────────────────────────────
  app.get("/api/platform/developer-friction-report", async (_req, res) => {
    try {
      const devs = rows(await db.execute(sql`
        SELECT vp.*, pf.confused_by, pf.expected, pf.loved, pf.almost_quit,
               pf.use_again, pf.recommend, pf.pay_for_it, pf.publish_another, pf.overall_rating
        FROM validation_participants vp
        LEFT JOIN participant_feedback pf ON pf.participant_id = vp.id
        WHERE vp.type = 'developer'
        ORDER BY vp.created_at ASC
      `));

      const withFeedback = devs.filter((d: any) => d.confused_by || d.loved || d.almost_quit);
      const totalDevs = devs.length;

      const confusionThemes = withFeedback.flatMap((d: any) => d.confused_by ? [d.confused_by] : []);
      const lovedThemes     = withFeedback.flatMap((d: any) => d.loved ? [d.loved] : []);
      const quittingRisks   = withFeedback.flatMap((d: any) => d.almost_quit ? [d.almost_quit] : []);

      const scores = {
        wouldUseAgain:      withFeedback.length > 0 ? pct(withFeedback.filter((d: any) => d.use_again).length, withFeedback.length) : null,
        wouldRecommend:     withFeedback.length > 0 ? pct(withFeedback.filter((d: any) => d.recommend).length, withFeedback.length) : null,
        wouldPay:           withFeedback.length > 0 ? pct(withFeedback.filter((d: any) => d.pay_for_it).length, withFeedback.length) : null,
        wouldPublishAgain:  withFeedback.length > 0 ? pct(withFeedback.filter((d: any) => d.publish_another).length, withFeedback.length) : null,
        avgRating:          withFeedback.filter((d: any) => d.overall_rating).length > 0
          ? parseFloat((withFeedback.filter((d: any) => d.overall_rating).reduce((a: number, d: any) => a + n(d.overall_rating), 0) / withFeedback.filter((d: any) => d.overall_rating).length).toFixed(1))
          : null,
      };

      const timings = devs.filter((d: any) => d.invited_at && d.first_publish_at).map((d: any) => ({
        name: d.external_name,
        timeToPublish: Math.floor((new Date(d.first_publish_at).getTime() - new Date(d.invited_at).getTime()) / 3600000),
        timeToInstall: d.first_install_at ? Math.floor((new Date(d.first_install_at).getTime() - new Date(d.invited_at).getTime()) / 3600000) : null,
      }));

      res.json({
        totalDevelopers: totalDevs,
        withFeedback: withFeedback.length,
        scores,
        timings,
        confusionThemes,
        lovedThemes,
        quittingRisks,
        developers: devs.map((d: any) => ({
          id: d.id, name: d.external_name, email: d.external_email, organization: d.organization,
          status: d.status, invitedAt: d.invited_at, activatedAt: d.activated_at,
          firstPublishAt: d.first_publish_at, firstInstallAt: d.first_install_at,
          hasFeedback: !!(d.confused_by || d.loved || d.almost_quit),
          rating: d.overall_rating,
        })),
        verdict: totalDevs === 0 ? "No external developers invited yet" :
          withFeedback.length === 0 ? "Developers invited but no feedback collected" :
          scores.wouldPublishAgain !== null && (scores.wouldPublishAgain ?? 0) >= 50 ? "Developers want to continue — platform has traction" :
          "Collecting feedback — friction points being identified",
      });
    } catch (e) {
      console.error("[developer-friction-report]", e);
      res.status(500).json({ error: "Failed to generate developer friction report" });
    }
  });

  // ─── Organization Friction Report ──────────────────────────────────────────
  app.get("/api/platform/org-friction-report", async (_req, res) => {
    try {
      const orgs = rows(await db.execute(sql`
        SELECT vp.*, pf.confused_by, pf.expected, pf.loved, pf.almost_quit,
               pf.use_again, pf.recommend, pf.pay_for_it, pf.overall_rating
        FROM validation_participants vp
        LEFT JOIN participant_feedback pf ON pf.participant_id = vp.id
        WHERE vp.type = 'org'
        ORDER BY vp.created_at ASC
      `));

      const withFeedback = orgs.filter((o: any) => o.confused_by || o.loved || o.almost_quit);

      const scores = {
        wouldUseAgain:   withFeedback.length > 0 ? pct(withFeedback.filter((o: any) => o.use_again).length,   withFeedback.length) : null,
        wouldRecommend:  withFeedback.length > 0 ? pct(withFeedback.filter((o: any) => o.recommend).length,   withFeedback.length) : null,
        wouldPay:        withFeedback.length > 0 ? pct(withFeedback.filter((o: any) => o.pay_for_it).length,  withFeedback.length) : null,
        avgRating:       withFeedback.filter((o: any) => o.overall_rating).length > 0
          ? parseFloat((withFeedback.filter((o: any) => o.overall_rating).reduce((a: number, o: any) => a + n(o.overall_rating), 0) / withFeedback.filter((o: any) => o.overall_rating).length).toFixed(1))
          : null,
      };

      const timings = orgs.filter((o: any) => o.invited_at && o.first_install_at).map((o: any) => ({
        name: o.external_name,
        timeToInstall: Math.floor((new Date(o.first_install_at).getTime() - new Date(o.invited_at).getTime()) / 3600000),
        timeToValue:   o.first_value_at ? Math.floor((new Date(o.first_value_at).getTime() - new Date(o.invited_at).getTime()) / 3600000) : null,
        timeToReview:  o.first_review_at ? Math.floor((new Date(o.first_review_at).getTime() - new Date(o.invited_at).getTime()) / 3600000) : null,
        timeToRevenue: o.first_revenue_at ? Math.floor((new Date(o.first_revenue_at).getTime() - new Date(o.invited_at).getTime()) / 3600000) : null,
      }));

      res.json({
        totalOrgs: orgs.length,
        withFeedback: withFeedback.length,
        scores,
        timings,
        confusionThemes: withFeedback.flatMap((o: any) => o.confused_by ? [o.confused_by] : []),
        lovedThemes:     withFeedback.flatMap((o: any) => o.loved ? [o.loved] : []),
        quittingRisks:   withFeedback.flatMap((o: any) => o.almost_quit ? [o.almost_quit] : []),
        orgs: orgs.map((o: any) => ({
          id: o.id, name: o.external_name, email: o.external_email, organization: o.organization,
          status: o.status, invitedAt: o.invited_at, activatedAt: o.activated_at,
          firstInstallAt: o.first_install_at, firstValueAt: o.first_value_at,
          firstReviewAt: o.first_review_at, firstRevenueAt: o.first_revenue_at,
          hasFeedback: !!(o.confused_by || o.loved || o.almost_quit),
          rating: o.overall_rating,
        })),
        verdict: orgs.length === 0 ? "No external organizations invited yet" :
          withFeedback.length === 0 ? "Organizations invited but no feedback collected" :
          scores.wouldUseAgain !== null && (scores.wouldUseAgain ?? 0) >= 50 ? "Organizations want to return — value confirmed" :
          "Collecting feedback — identifying friction points",
      });
    } catch (e) {
      console.error("[org-friction-report]", e);
      res.status(500).json({ error: "Failed to generate org friction report" });
    }
  });

  // ─── Human Validation Report ───────────────────────────────────────────────
  app.get("/api/platform/human-validation-report", async (_req, res) => {
    try {
      const allPart = rows(await db.execute(sql`SELECT * FROM validation_participants ORDER BY created_at ASC`));
      const allFb   = rows(await db.execute(sql`
        SELECT pf.*, vp.type AS participant_type FROM participant_feedback pf
        LEFT JOIN validation_participants vp ON vp.id = pf.participant_id
      `));
      const devs    = allPart.filter((p: any) => p.type === 'developer');
      const orgs    = allPart.filter((p: any) => p.type === 'org');

      // Pull real activity from marketplace tables
      const realActivity = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM agent_templates WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS published_agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS real_installs,
          (SELECT COUNT(*) FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID})               AS real_reviews,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE org_id != ${SEEDED_ORG_ID})           AS real_revenue,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid'
           AND developer_id != ${SEEDED_ORG_ID})                                              AS real_royalties
      `));

      // Success criteria assessment
      const devWithPublishIntent = allFb.filter((f: any) => f.participant_type === 'developer' && f.publish_another === true);
      const criteria = [
        { criterion: "Non-founder developer publishes an agent",         met: n(realActivity.published_agents) >= 1, evidence: `${n(realActivity.published_agents)} external agents published` },
        { criterion: "Non-founder organization installs an agent",       met: n(realActivity.real_installs) >= 1,    evidence: `${n(realActivity.real_installs)} real installs` },
        { criterion: "Non-founder user leaves a review",                 met: n(realActivity.real_reviews) >= 1,     evidence: `${n(realActivity.real_reviews)} real reviews` },
        { criterion: "Non-founder user generates value",                 met: n(realActivity.real_revenue) >= 1,     evidence: `${n(realActivity.real_revenue)} real revenue events` },
        { criterion: "Non-founder developer expresses intent to publish another agent", met: devWithPublishIntent.length >= 1, evidence: `${devWithPublishIntent.length} developers intend to publish again` },
      ];

      const metCount = criteria.filter(c => c.met).length;
      const verdict  = metCount >= 5 ? "Wave X Complete — External Participation Validated"
        : metCount >= 3 ? "Partially Validated — Real Activity Detected"
        : metCount >= 1 ? "Early Signal — First External Touch"
        : "Not Yet Validated — No External Activity";

      // Summary question: Can someone other than Bryan Jones participate?
      const canParticipate = n(realActivity.published_agents) >= 1 || n(realActivity.real_installs) >= 1;

      // Time-to metrics
      const timeMetrics = [
        { metric: "Time to First Publish",  hours: devs.filter((d: any) => d.invited_at && d.first_publish_at).map((d: any) => Math.floor((new Date(d.first_publish_at).getTime() - new Date(d.invited_at).getTime()) / 3600000)) },
        { metric: "Time to First Install",  hours: [...devs, ...orgs].filter((p: any) => p.invited_at && p.first_install_at).map((p: any) => Math.floor((new Date(p.first_install_at).getTime() - new Date(p.invited_at).getTime()) / 3600000)) },
        { metric: "Time to First Value",    hours: orgs.filter((o: any) => o.invited_at && o.first_value_at).map((o: any) => Math.floor((new Date(o.first_value_at).getTime() - new Date(o.invited_at).getTime()) / 3600000)) },
        { metric: "Time to First Review",   hours: orgs.filter((o: any) => o.invited_at && o.first_review_at).map((o: any) => Math.floor((new Date(o.first_review_at).getTime() - new Date(o.invited_at).getTime()) / 3600000)) },
        { metric: "Time to First Revenue",  hours: orgs.filter((o: any) => o.invited_at && o.first_revenue_at).map((o: any) => Math.floor((new Date(o.first_revenue_at).getTime() - new Date(o.invited_at).getTime()) / 3600000)) },
      ].map(m => ({
        metric: m.metric,
        n: m.hours.length,
        avg: m.hours.length > 0 ? Math.round(m.hours.reduce((a, b) => a + b, 0) / m.hours.length) : null,
        fastest: m.hours.length > 0 ? Math.min(...m.hours) : null,
        slowest: m.hours.length > 0 ? Math.max(...m.hours) : null,
      }));

      res.json({
        summary: {
          devsInvited:    devs.length,
          devsActivated:  devs.filter((d: any) => d.activated_at).length,
          orgsInvited:    orgs.length,
          orgsActivated:  orgs.filter((o: any) => o.activated_at).length,
          feedbackCount:  allFb.length,
          ...{
            agentsPublished: n(realActivity.published_agents),
            realInstalls:    n(realActivity.real_installs),
            realReviews:     n(realActivity.real_reviews),
            realRevenue:     n(realActivity.real_revenue),
            realRoyalties:   n(realActivity.real_royalties),
          },
        },
        canSomeoneOtherThanBryanJonesParticipate: canParticipate,
        verdict,
        criteria,
        metCount,
        totalCriteria: criteria.length,
        timeMetrics,
        participants: allPart,
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[human-validation-report]", e);
      res.status(500).json({ error: "Failed to generate human validation report" });
    }
  });

  // ─── Wave X Scorecard ─────────────────────────────────────────────────────
  app.get("/api/platform/wave-x-scorecard", async (_req, res) => {
    try {
      const allPart = rows(await db.execute(sql`SELECT * FROM validation_participants`));
      const devFb   = rows(await db.execute(sql`
        SELECT pf.* FROM participant_feedback pf
        JOIN validation_participants vp ON vp.id = pf.participant_id WHERE vp.type='developer'
      `));
      const ra = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM agent_templates WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS ext_agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id => `'${id}'`).join(","))})) AS ext_installs,
          (SELECT COUNT(*) FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID})               AS ext_reviews,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE org_id != ${SEEDED_ORG_ID})           AS ext_revenue
      `));

      const devs = allPart.filter((p: any) => p.type === 'developer');
      const orgs = allPart.filter((p: any) => p.type === 'org');

      const metrics = {
        devsInvited:       { actual: devs.length,                               target: 3 },
        devsActivated:     { actual: devs.filter((d: any) => d.activated_at).length, target: 3 },
        externalAgents:    { actual: n(ra.ext_agents),                          target: 1 },
        orgsInvited:       { actual: orgs.length,                               target: 5 },
        orgsActivated:     { actual: orgs.filter((o: any) => o.activated_at).length, target: 5 },
        externalInstalls:  { actual: n(ra.ext_installs),                        target: 1 },
        feedbackSubmitted: { actual: devFb.length + rows(await db.execute(sql`SELECT id FROM participant_feedback`)).length, target: 3 },
        publishIntentExpressed: { actual: devFb.filter((f: any) => f.publish_another).length, target: 1 },
        externalReviews:   { actual: n(ra.ext_reviews),                         target: 1 },
        externalRevenue:   { actual: n(ra.ext_revenue),                         target: 1 },
      };

      const vals = Object.values(metrics);
      const overallScore = Math.min(100, Math.round(vals.reduce((a, v) => a + Math.min((v.actual / v.target) * 100, 100), 0) / vals.length));
      const metCriteria  = vals.filter(v => v.actual >= v.target).length;
      const verdict = metCriteria >= 9 ? "Wave X Complete" : metCriteria >= 6 ? "Strong Progress" : metCriteria >= 3 ? "In Progress" : "Getting Started";

      res.json({ overallScore, verdict, metrics, metCriteria, totalCriteria: Object.keys(metrics).length });
    } catch (e) {
      console.error("[wave-x-scorecard]", e);
      res.status(500).json({ error: "Failed to compute Wave X scorecard" });
    }
  });
}
