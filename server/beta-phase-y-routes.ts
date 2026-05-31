import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";

function rows(r: unknown): any[] { if (Array.isArray(r)) return r; const x = r as any; return Array.isArray(x?.rows) ? x.rows : []; }
function row0(r: unknown): any { return rows(r)[0] ?? {}; }
function n(v: unknown): number { return Number(v ?? 0); }
function avg(arr: number[]): number | null { return arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null; }

const SEEDED_ORG_ID = "TrainEfficiency";
const SEEDED_AGENT_IDS = ["growth_agent","recovery_agent","nutrition_agent","performance_agent",
  "mobility_agent","strength_agent","conditioning_agent","mental_performance_agent","assessment_agent"];

const PLAYBOOK_TEMPLATES: Record<string, string[]> = {
  developer: [
    "Hey [Name], I'm building an AI Agent Marketplace for S&C coaches and I think your background would be perfect. Would love to show you how to publish your first agent and earn royalties.",
    "Follow-up: Just checking in — have you had a chance to look at the developer SDK? Happy to walk you through your first publish in 30 min.",
    "Your agent is live! Now let's get your first install. I'm reaching out to 5 coaching businesses this week — want me to pitch yours?",
  ],
  coach: [
    "Hey [Name], I've built an AI agent that can [specific benefit for their gym]. It's free to install — takes 5 minutes. Would you be open to trying it?",
    "Follow-up: Did you get a chance to try the agent? I'd love to know what you think — even a quick reaction helps us improve it.",
    "Thanks for installing! If you've seen any value, a quick review would mean a lot and helps other coaches find it.",
  ],
  gym_owner: [
    "Hey [Name], I'm working with [X] gyms to automate their scheduling and client follow-up with AI. The first agent is free to install. Can I show you how it works?",
    "Follow-up: No pressure — just wanted to make sure the install worked. Happy to jump on a 10-min call if anything feels confusing.",
    "You've been using it for a week — would love to know what's working and what isn't.",
  ],
  consultant: [
    "Hey [Name], I'm building a marketplace where S&C consultants can sell AI tools to gyms. Given what you know about the space, I think you could build something that sells. Can we chat?",
    "Follow-up: I know you're busy — the SDK is genuinely lightweight. I can be on a call with you while you publish your first agent.",
  ],
  agency: [
    "Hey [Name], your agency could white-label AI agents for every S&C client you have. I'm offering founding partner pricing — want to see the economics?",
    "Follow-up: Happy to walk through a custom demo for your agency's use case. What types of clients do you serve most?",
  ],
};

// ─── Part 7: Per-participant Human Validation Score ─────────────────────────
// Returns 5-dimension score per participant: Activation, Completion, Satisfaction, Recommendation, Return Intent
function computeParticipantScore(p: any, fb: any | null): {
  activationScore: number;
  completionScore: number;
  satisfactionScore: number | null;
  recommendationScore: number | null;
  returnIntentScore: number | null;
  overallScore: number;
} {
  // Activation Score (0-100) — how far along the journey
  const STATUS_SCORES: Record<string, number> = {
    invited: 10, activated: 25, published: 55, installed: 55, reviewed: 75, generating_revenue: 100,
  };
  const activationScore = STATUS_SCORES[p.status] ?? 10;

  // Completion Score (0-100) — % of expected milestones hit
  const isDev = p.type === 'developer';
  const devMilestones = [p.activated_at, p.first_publish_at, p.first_install_at, p.first_review_at, p.first_revenue_at];
  const orgMilestones = [p.activated_at, p.first_install_at, p.first_value_at, p.first_review_at, p.first_revenue_at];
  const milestones = isDev ? devMilestones : orgMilestones;
  const completionScore = Math.round(milestones.filter(Boolean).length / milestones.length * 100);

  // Satisfaction Score (0-100) — overall_rating × 10
  const satisfactionScore = fb?.overall_rating != null ? n(fb.overall_rating) * 10 : null;

  // Recommendation Score (0-100) — recommend boolean
  const recommendationScore = fb != null ? (fb.recommend ? 100 : 0) : null;

  // Return Intent Score (0-100) — use_again (org) or publish_another (dev)
  const intentField = isDev ? fb?.publish_another : fb?.use_again;
  const returnIntentScore = fb != null ? (intentField ? 100 : 0) : null;

  // Overall Score — weighted avg of available scores
  const scored: number[] = [activationScore * 0.25, completionScore * 0.25];
  let weightUsed = 0.5;
  if (satisfactionScore !== null)  { scored.push(satisfactionScore  * 0.25); weightUsed += 0.25; }
  if (recommendationScore !== null){ scored.push(recommendationScore * 0.125); weightUsed += 0.125; }
  if (returnIntentScore !== null)  { scored.push(returnIntentScore   * 0.125); weightUsed += 0.125; }
  const rawOverall = scored.reduce((a, b) => a + b, 0) / weightUsed;
  const overallScore = Math.round(rawOverall);

  return { activationScore, completionScore, satisfactionScore, recommendationScore, returnIntentScore, overallScore };
}

export async function registerBetaPhaseYRoutes(app: Express) {

  // ─── Playbooks CRUD ───────────────────────────────────────────────────────
  app.get("/api/first10-playbooks", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM first10_playbooks ORDER BY created_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch playbooks" }); }
  });

  app.get("/api/first10-playbooks/templates", async (_req, res) => {
    res.json({ types: Object.keys(PLAYBOOK_TEMPLATES), templates: PLAYBOOK_TEMPLATES });
  });

  app.post("/api/first10-playbooks", async (req, res) => {
    try {
      const { template_type, participant_name, participant_id, notes } = req.body;
      const r = rows(await db.execute(sql`
        INSERT INTO first10_playbooks (id, template_type, participant_name, participant_id, notes)
        VALUES (gen_random_uuid()::text, ${template_type ?? 'developer'}, ${participant_name ?? null}, ${participant_id ?? null}, ${notes ?? null})
        RETURNING *
      `));
      res.status(201).json(r[0]);
    } catch (e) { res.status(500).json({ error: "Failed to create playbook entry" }); }
  });

  app.patch("/api/first10-playbooks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, sent_at, opened_at, responded_at, activated_at, notes } = req.body;
      await db.execute(sql`
        UPDATE first10_playbooks SET
          status       = COALESCE(${status ?? null}, status),
          sent_at      = COALESCE(${sent_at      ? new Date(sent_at)      : null}, sent_at),
          opened_at    = COALESCE(${opened_at    ? new Date(opened_at)    : null}, opened_at),
          responded_at = COALESCE(${responded_at ? new Date(responded_at) : null}, responded_at),
          activated_at = COALESCE(${activated_at ? new Date(activated_at) : null}, activated_at),
          notes        = COALESCE(${notes ?? null}, notes)
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Failed to update playbook entry" }); }
  });

  // ─── Activation Queue ──────────────────────────────────────────────────────
  app.get("/api/platform/activation-queue", async (_req, res) => {
    try {
      const participants = rows(await db.execute(sql`SELECT * FROM validation_participants ORDER BY created_at ASC`));
      const feedback     = rows(await db.execute(sql`SELECT participant_id FROM participant_feedback`));
      const hasFb = new Set(feedback.map((f: any) => f.participant_id));

      const STAGE_SCORE: Record<string, number> = {
        invited: 10, activated: 30, published: 60, installed: 75, reviewed: 85, generating_revenue: 100,
      };
      const NEXT_ACTION: Record<string, string> = {
        invited:    "Follow up — have not yet activated",
        activated:  "Developer: guide to first publish. Org: guide to first install.",
        published:  "Agent exists — reach out to orgs to drive first install",
        installed:  "Org installed — prompt for first review",
        reviewed:   "Review submitted — check if value generated",
        generating_revenue: "Active — check royalty loop",
      };
      const STUCK_THRESHOLD_DAYS: Record<string, number> = {
        invited: 3, activated: 5, published: 7, installed: 4, reviewed: 7, generating_revenue: 99,
      };

      const now = Date.now();
      const queue = participants.map((p: any) => {
        const stageScore = STAGE_SCORE[p.status] ?? 10;
        const lastActivity = p.updated_at || p.created_at;
        const daysSinceUpdate = lastActivity
          ? Math.floor((now - new Date(lastActivity).getTime()) / 86400000)
          : 0;
        const stuckThreshold = STUCK_THRESHOLD_DAYS[p.status] ?? 5;
        const isStuck = daysSinceUpdate >= stuckThreshold;
        const hasFeedback = hasFb.has(p.id);
        const urgency = isStuck ? 100 - stageScore + 50 : 100 - stageScore;

        return {
          id: p.id, name: p.external_name, type: p.type, status: p.status,
          subtype: p.subtype, stageScore, daysSinceUpdate, isStuck, hasFeedback, urgency,
          nextAction: NEXT_ACTION[p.status] ?? "Follow up",
          organization: p.organization, email: p.external_email,
        };
      }).sort((a: any, b: any) => b.urgency - a.urgency);

      res.json({
        queue,
        stuck:            queue.filter((q: any) => q.isStuck).length,
        total:            participants.length,
        closestToPublish: queue.filter((q: any) => q.type === 'developer' && ['activated','invited'].includes(q.status)).slice(0, 3),
        closestToInstall: queue.filter((q: any) => q.type === 'org'       && ['activated','invited'].includes(q.status)).slice(0, 3),
        closestToReview:  queue.filter((q: any) => q.status === 'installed').slice(0, 3),
        noParticipants:   participants.length === 0,
      });
    } catch (e) {
      console.error("[activation-queue]", e);
      res.status(500).json({ error: "Failed to compute activation queue" });
    }
  });

  // ─── First Revenue Countdown ───────────────────────────────────────────────
  app.get("/api/platform/first-revenue-countdown", async (_req, res) => {
    try {
      const ra = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM validation_participants WHERE type='developer')                    AS devs_invited,
          (SELECT COUNT(*) FROM validation_participants WHERE type='developer' AND activated_at IS NOT NULL) AS devs_activated,
          (SELECT COUNT(*) FROM agent_templates WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id=>`'${id}'`).join(","))}))       AS ext_agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id=>`'${id}'`).join(","))}))       AS ext_installs,
          (SELECT COUNT(*) FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID})                   AS ext_reviews,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE org_id != ${SEEDED_ORG_ID})               AS ext_revenue,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid'
           AND developer_id != ${SEEDED_ORG_ID})                                                   AS ext_royalties,
          (SELECT COUNT(*) FROM validation_participants WHERE referral_made_at IS NOT NULL)        AS referrals
      `));

      const participants   = rows(await db.execute(sql`SELECT * FROM validation_participants ORDER BY created_at ASC`));
      const devFeedback    = rows(await db.execute(sql`
        SELECT pf.publish_another FROM participant_feedback pf
        JOIN validation_participants vp ON vp.id = pf.participant_id WHERE vp.type='developer'
      `));
      const publishIntent  = devFeedback.filter((f: any) => f.publish_another === true).length;

      const steps = [
        {
          milestone: "First External Agent Published",
          met: n(ra.ext_agents) >= 1,
          count: n(ra.ext_agents),
          blocker: n(ra.ext_agents) >= 1 ? null
            : n(ra.devs_activated) >= 1 ? "Developer activated — guide them through SDK publish flow"
            : n(ra.devs_invited) >= 1 ? "Developer invited but not yet activated — follow up"
            : "No external developer invited yet",
        },
        {
          milestone: "First External Install",
          met: n(ra.ext_installs) >= 1,
          count: n(ra.ext_installs),
          blocker: n(ra.ext_installs) >= 1 ? null
            : n(ra.ext_agents) >= 1 ? "Agent exists — no org has installed it yet"
            : "Blocked by: no external agent published yet",
        },
        {
          milestone: "First External Review",
          met: n(ra.ext_reviews) >= 1,
          count: n(ra.ext_reviews),
          blocker: n(ra.ext_reviews) >= 1 ? null
            : n(ra.ext_installs) >= 1 ? "Agent installed — prompt org for a review"
            : "Blocked by: no external install yet",
        },
        {
          milestone: "First External Revenue Event",
          met: n(ra.ext_revenue) >= 1,
          count: n(ra.ext_revenue),
          blocker: n(ra.ext_revenue) >= 1 ? null
            : n(ra.ext_installs) >= 1 ? "Agent in use — needs to generate a trackable value event"
            : "Blocked by: no external install yet",
        },
        {
          milestone: "First External Royalty Paid",
          met: n(ra.ext_royalties) >= 1,
          count: n(ra.ext_royalties),
          blocker: n(ra.ext_royalties) >= 1 ? null
            : n(ra.ext_revenue) >= 1 ? "Revenue event recorded — royalty distribution pending"
            : "Blocked by: no external revenue event yet",
        },
        {
          milestone: "First External Referral",
          met: n(ra.referrals) >= 1,
          count: n(ra.referrals),
          blocker: n(ra.referrals) >= 1 ? null
            : "No participant has referred another user yet",
        },
        {
          milestone: "Developer Expresses Intent to Publish Again",
          met: publishIntent >= 1,
          count: publishIntent,
          blocker: publishIntent >= 1 ? null
            : "Collect feedback from developers — ask publish_another question",
        },
      ];

      const metCount = steps.filter(s => s.met).length;
      const nextStep = steps.find(s => !s.met);
      const hasActiveDev = participants.some((p: any) => p.type === 'developer' && p.status !== 'invited');
      const estDays = metCount >= steps.length ? 0
        : nextStep?.milestone.includes("Agent Published")   ? (hasActiveDev ? 3 : 7)
        : nextStep?.milestone.includes("Install")           ? 5
        : nextStep?.milestone.includes("Review")            ? 3
        : nextStep?.milestone.includes("Revenue")           ? 7
        : nextStep?.milestone.includes("Royalty")           ? 14
        : nextStep?.milestone.includes("Referral")          ? 7
        : 7;

      res.json({
        steps, metCount, totalSteps: steps.length,
        allMet: metCount >= steps.length,
        nextMilestone: nextStep?.milestone ?? "All milestones achieved",
        nextBlocker: nextStep?.blocker ?? null,
        estimatedDaysToNext: estDays,
        externalParticipants: participants.length,
      });
    } catch (e) {
      console.error("[first-revenue-countdown]", e);
      res.status(500).json({ error: "Failed to compute revenue countdown" });
    }
  });

  // ─── Founder Actions ───────────────────────────────────────────────────────
  app.get("/api/platform/founder-actions", async (_req, res) => {
    try {
      const participants = rows(await db.execute(sql`SELECT * FROM validation_participants ORDER BY created_at ASC`));
      const playbooks    = rows(await db.execute(sql`SELECT * FROM first10_playbooks ORDER BY created_at DESC`));
      const feedback     = rows(await db.execute(sql`
        SELECT pf.*, vp.external_name, vp.type AS ptype FROM participant_feedback pf
        LEFT JOIN validation_participants vp ON vp.id = pf.participant_id
      `));
      const ra = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM agent_templates WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id=>`'${id}'`).join(","))})) AS ext_agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id=>`'${id}'`).join(","))})) AS ext_installs,
          (SELECT COUNT(*) FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID})              AS ext_reviews
      `));

      const actions: { priority: number; action: string; reason: string; type: string }[] = [];

      if (participants.length === 0) {
        actions.push({ priority: 1, action: "Invite your first external developer", reason: "No external participants yet — this is step 1", type: "recruit" });
        actions.push({ priority: 2, action: "Invite your first external organization", reason: "Need at least one org to create an install event", type: "recruit" });
        actions.push({ priority: 3, action: "Write 3 personalized outreach messages using the playbook templates", reason: "Personal outreach converts 3–5× better than cold messages", type: "outreach" });
      }

      const stuck = participants.filter((p: any) => {
        const lastActivity = p.updated_at || p.created_at;
        const days = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000);
        const thresholds: Record<string, number> = { invited: 3, activated: 5, published: 7, installed: 4 };
        return days >= (thresholds[p.status] ?? 5);
      });
      for (const p of stuck.slice(0, 3)) {
        actions.push({ priority: 2, action: `Follow up with ${p.external_name}`, reason: `${p.type === 'developer' ? 'Developer' : 'Org'} stuck at "${p.status}"${p.external_email ? ` — ${p.external_email}` : ""}`, type: "follow-up" });
      }

      const publishedNeedInstall = participants.filter((p: any) => p.type === 'developer' && p.first_publish_at && !p.first_install_at);
      for (const p of publishedNeedInstall) {
        actions.push({ priority: 2, action: `Get ${p.external_name}'s agent its first install`, reason: "Published an agent but no org installed it — personal intro to a gym owner needed", type: "activation" });
      }

      const installedNeedReview = participants.filter((p: any) => p.type === 'org' && p.first_install_at && !p.first_review_at);
      for (const p of installedNeedReview) {
        actions.push({ priority: 3, action: `Ask ${p.external_name} for a review`, reason: "Installed but hasn't submitted a review — send a 1-sentence ask", type: "activation" });
      }

      if (n(ra.ext_agents) >= 1 && n(ra.ext_installs) === 0) {
        actions.push({ priority: 1, action: "Personally match the published external agent to 3 gym owners", reason: "External agent exists but has 0 installs — highest-leverage action right now", type: "activation" });
      }

      const devCount = participants.filter((p: any) => p.type === 'developer').length;
      if (devCount < 5) actions.push({ priority: 3, action: `Recruit ${5 - devCount} more developer${5 - devCount > 1 ? 's' : ''}`, reason: `Currently ${devCount}/5 Group A creators in the validation cohort`, type: "recruit" });

      const orgCount = participants.filter((p: any) => p.type === 'org').length;
      if (orgCount < 5) actions.push({ priority: 3, action: `Recruit ${5 - orgCount} more organization${5 - orgCount > 1 ? 's' : ''}`, reason: `Currently ${orgCount}/5 Group B consumers in the validation cohort`, type: "recruit" });

      if (feedback.length === 0 && participants.length > 0) {
        actions.push({ priority: 2, action: "Collect friction interview from at least one participant", reason: "No qualitative data yet — Part 5 friction interviews are required", type: "feedback" });
      }

      if (playbooks.filter((p: any) => p.sent_at).length === 0 && participants.length > 0) {
        actions.push({ priority: 3, action: "Log your first outreach message as sent in the Playbooks tab", reason: "Tracking effectiveness helps you see what converts", type: "tracking" });
      }

      if (n(ra.ext_reviews) >= 1 && n(ra.ext_installs) >= 1) {
        actions.push({ priority: 1, action: "Screenshot this proof and share it publicly", reason: "External reviews + installs = social proof. Post it.", type: "amplify" });
      }

      res.json({
        actions: actions.sort((a, b) => a.priority - b.priority).slice(0, 10),
        totalActions: actions.length,
        weekOf: new Date().toISOString().slice(0, 10),
        context: {
          participants: participants.length,
          stuck: stuck.length,
          extAgents: n(ra.ext_agents),
          extInstalls: n(ra.ext_installs),
          extReviews: n(ra.ext_reviews),
        },
      });
    } catch (e) {
      console.error("[founder-actions]", e);
      res.status(500).json({ error: "Failed to compute founder actions" });
    }
  });

  // ─── Part 7: Human Validation Scores (per participant) ────────────────────
  app.get("/api/platform/human-validation-scores", async (_req, res) => {
    try {
      const participants = rows(await db.execute(sql`SELECT * FROM validation_participants ORDER BY created_at ASC`));
      const allFb        = rows(await db.execute(sql`SELECT * FROM participant_feedback`));
      const fbMap = new Map(allFb.map((f: any) => [f.participant_id, f]));

      const scores = participants.map((p: any) => {
        const fb = fbMap.get(p.id) ?? null;
        const s  = computeParticipantScore(p, fb);
        return {
          id:               p.id,
          name:             p.external_name,
          type:             p.type,
          subtype:          p.subtype,
          organization:     p.organization,
          status:           p.status,
          hasFeedback:      fb !== null,
          ...s,
        };
      });

      // Aggregate stats
      const withFb   = scores.filter(s => s.hasFeedback);
      const avgOverall  = avg(scores.map(s => s.overallScore));
      const avgSat      = withFb.length > 0 ? avg(withFb.map(s => s.satisfactionScore).filter((x): x is number => x !== null)) : null;
      const avgRec      = withFb.length > 0 ? avg(withFb.map(s => s.recommendationScore).filter((x): x is number => x !== null)) : null;
      const avgReturn   = withFb.length > 0 ? avg(withFb.map(s => s.returnIntentScore).filter((x): x is number => x !== null)) : null;

      const topScorer = scores.sort((a, b) => b.overallScore - a.overallScore)[0] ?? null;

      res.json({
        scores,
        aggregate: {
          avgOverall,
          avgSatisfaction:  avgSat,
          avgRecommendation: avgRec,
          avgReturnIntent:  avgReturn,
          topScorer:        topScorer ? { name: topScorer.name, score: topScorer.overallScore } : null,
          totalParticipants: participants.length,
          withFeedback:     withFb.length,
        },
      });
    } catch (e) {
      console.error("[human-validation-scores]", e);
      res.status(500).json({ error: "Failed to compute human validation scores" });
    }
  });

  // ─── Part 9+12: Phase Y Scorecard (9 success thresholds + 4-tier verdict) ──
  app.get("/api/platform/phase-y-scorecard", async (_req, res) => {
    try {
      const participants = rows(await db.execute(sql`SELECT * FROM validation_participants`));
      const allFb        = rows(await db.execute(sql`SELECT * FROM participant_feedback`));

      const ra = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM agent_templates WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id=>`'${id}'`).join(","))})) AS ext_agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id=>`'${id}'`).join(","))})) AS ext_installs,
          (SELECT COUNT(*) FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID})              AS ext_reviews,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE org_id != ${SEEDED_ORG_ID})          AS ext_revenue,
          (SELECT COUNT(*) FROM royalty_distributions WHERE payout_status='paid'
           AND developer_id != ${SEEDED_ORG_ID})                                             AS ext_royalties,
          (SELECT COUNT(*) FROM validation_participants WHERE referral_made_at IS NOT NULL)   AS referrals
      `));

      const publishIntent = allFb.filter((f: any) => f.publish_another === true).length;

      // Avg satisfaction (>7 threshold)
      const ratedFb      = allFb.filter((f: any) => f.overall_rating != null);
      const avgSat       = ratedFb.length > 0 ? ratedFb.reduce((a: number, f: any) => a + n(f.overall_rating), 0) / ratedFb.length : null;

      // Avg recommendation rate (>70% threshold)
      const recFb        = allFb.filter((f: any) => f.recommend != null);
      const avgRecPct    = recFb.length > 0 ? recFb.filter((f: any) => f.recommend).length / recFb.length * 100 : null;

      // ── 9 criteria from Part 9 ──
      const criteria = [
        {
          criterion: "3+ developers publish agents",
          met: n(ra.ext_agents) >= 3,
          evidence: `${n(ra.ext_agents)}/3 external agents published`,
          current: n(ra.ext_agents), target: 3,
        },
        {
          criterion: "3+ organizations install agents",
          met: n(ra.ext_installs) >= 3,
          evidence: `${n(ra.ext_installs)}/3 external installs`,
          current: n(ra.ext_installs), target: 3,
        },
        {
          criterion: "3+ reviews submitted",
          met: n(ra.ext_reviews) >= 3,
          evidence: `${n(ra.ext_reviews)}/3 external reviews`,
          current: n(ra.ext_reviews), target: 3,
        },
        {
          criterion: "1+ referral occurs",
          met: n(ra.referrals) >= 1,
          evidence: `${n(ra.referrals)} participant referral(s) tracked`,
          current: n(ra.referrals), target: 1,
        },
        {
          criterion: "1+ revenue event occurs",
          met: n(ra.ext_revenue) >= 1,
          evidence: `${n(ra.ext_revenue)} external revenue events`,
          current: n(ra.ext_revenue), target: 1,
        },
        {
          criterion: "1+ royalty event occurs",
          met: n(ra.ext_royalties) >= 1,
          evidence: `${n(ra.ext_royalties)} royalties paid`,
          current: n(ra.ext_royalties), target: 1,
        },
        {
          criterion: "1+ developer wants to publish again",
          met: publishIntent >= 1,
          evidence: `${publishIntent} developer(s) confirmed intent`,
          current: publishIntent, target: 1,
        },
        {
          criterion: "Average satisfaction > 7/10",
          met: avgSat !== null && avgSat > 7,
          evidence: avgSat !== null ? `Avg satisfaction: ${avgSat.toFixed(1)}/10` : "No satisfaction data yet",
          current: avgSat !== null ? Math.round(avgSat * 10) / 10 : 0, target: 7,
        },
        {
          criterion: "Average recommendation rate > 70%",
          met: avgRecPct !== null && avgRecPct > 70,
          evidence: avgRecPct !== null ? `${Math.round(avgRecPct)}% would recommend` : "No recommendation data yet",
          current: avgRecPct !== null ? Math.round(avgRecPct) : 0, target: 70,
        },
      ];

      const metCount = criteria.filter(c => c.met).length;

      // ── Part 12: 4-tier verdict ──
      const verdict = metCount >= 9 ? "STRONGLY VALIDATED"
        : metCount >= 6              ? "VALIDATED"
        : metCount >= 3              ? "PARTIALLY VALIDATED"
        : "NOT VALIDATED";

      const verdictColor = verdict === "STRONGLY VALIDATED" ? "emerald"
        : verdict === "VALIDATED"          ? "blue"
        : verdict === "PARTIALLY VALIDATED" ? "yellow"
        : "red";

      res.json({
        criteria,
        metCount,
        totalCriteria: 9,
        verdict,
        verdictColor,
        phaseComplete: metCount >= 9,
        participants: participants.length,
        progressPct: Math.round(metCount / 9 * 100),
        // Legacy field for backwards compatibility
        finalQuestion: metCount >= 9 ? "CONFIRMED" : "NOT YET CONFIRMED",
      });
    } catch (e) {
      console.error("[phase-y-scorecard]", e);
      res.status(500).json({ error: "Failed to compute Phase Y scorecard" });
    }
  });
}
