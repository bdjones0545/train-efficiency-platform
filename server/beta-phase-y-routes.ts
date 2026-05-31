import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";

function rows(r: unknown): any[] { if (Array.isArray(r)) return r; const x = r as any; return Array.isArray(x?.rows) ? x.rows : []; }
function row0(r: unknown): any { return rows(r)[0] ?? {}; }
function n(v: unknown): number { return Number(v ?? 0); }

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

export async function registerBetaPhaseYRoutes(app: Express) {

  // ─── Playbooks CRUD ───────────────────────────────────────────────────────
  app.get("/api/first10-playbooks", async (_req, res) => {
    try {
      res.json(rows(await db.execute(sql`SELECT * FROM first10_playbooks ORDER BY created_at DESC`)));
    } catch (e) { res.status(500).json({ error: "Failed to fetch playbooks" }); }
  });

  app.get("/api/first10-playbooks/templates", async (_req, res) => {
    res.json({
      types: Object.keys(PLAYBOOK_TEMPLATES),
      templates: PLAYBOOK_TEMPLATES,
    });
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

  // ─── Part 3: Activation Queue ─────────────────────────────────────────────
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
        const daysSinceUpdate = p.updated_at
          ? Math.floor((now - new Date(p.updated_at).getTime()) / 86400000)
          : Math.floor((now - new Date(p.created_at).getTime()) / 86400000);
        const stuckThreshold = STUCK_THRESHOLD_DAYS[p.status] ?? 5;
        const isStuck = daysSinceUpdate >= stuckThreshold;
        const hasFeedback = hasFb.has(p.id);

        // Urgency: stuck people first, then by proximity to completion
        const urgency = isStuck ? 100 - stageScore + 50 : 100 - stageScore;

        return {
          id: p.id,
          name: p.external_name,
          type: p.type,
          status: p.status,
          stageScore,
          daysSinceUpdate,
          isStuck,
          hasFeedback,
          urgency,
          nextAction: NEXT_ACTION[p.status] ?? "Follow up",
          organization: p.organization,
          email: p.external_email,
        };
      }).sort((a: any, b: any) => b.urgency - a.urgency);

      const stuck     = queue.filter((q: any) => q.isStuck);
      const closestToPublish  = queue.filter((q: any) => q.type === 'developer' && ['activated','invited'].includes(q.status)).slice(0, 3);
      const closestToInstall  = queue.filter((q: any) => q.type === 'org'       && ['activated','invited'].includes(q.status)).slice(0, 3);
      const closestToReview   = queue.filter((q: any) => q.status === 'installed').slice(0, 3);

      res.json({
        queue,
        stuck: stuck.length,
        total: participants.length,
        closestToPublish,
        closestToInstall,
        closestToReview,
        noParticipants: participants.length === 0,
      });
    } catch (e) {
      console.error("[activation-queue]", e);
      res.status(500).json({ error: "Failed to compute activation queue" });
    }
  });

  // ─── Part 4: First Revenue Countdown ──────────────────────────────────────
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
           AND developer_id != ${SEEDED_ORG_ID})                                                   AS ext_royalties
      `));

      const participants = rows(await db.execute(sql`SELECT * FROM validation_participants ORDER BY created_at ASC`));
      const devFeedback  = rows(await db.execute(sql`
        SELECT pf.publish_another FROM participant_feedback pf
        JOIN validation_participants vp ON vp.id = pf.participant_id WHERE vp.type='developer'
      `));
      const publishIntent = devFeedback.filter((f: any) => f.publish_another === true).length;

      const steps = [
        {
          milestone:    "First External Agent Published",
          met:          n(ra.ext_agents) >= 1,
          count:        n(ra.ext_agents),
          blocker:      n(ra.ext_agents) >= 1 ? null
            : n(ra.devs_activated) >= 1 ? "Developer activated — guide them through SDK publish flow"
            : n(ra.devs_invited) >= 1 ? "Developer invited but not yet activated — follow up"
            : "No external developer invited yet",
        },
        {
          milestone:    "First External Install",
          met:          n(ra.ext_installs) >= 1,
          count:        n(ra.ext_installs),
          blocker:      n(ra.ext_installs) >= 1 ? null
            : n(ra.ext_agents) >= 1 ? "Agent exists — no org has installed it yet"
            : "Blocked by: no external agent published yet",
        },
        {
          milestone:    "First External Review",
          met:          n(ra.ext_reviews) >= 1,
          count:        n(ra.ext_reviews),
          blocker:      n(ra.ext_reviews) >= 1 ? null
            : n(ra.ext_installs) >= 1 ? "Agent installed — prompt org for a review"
            : "Blocked by: no external install yet",
        },
        {
          milestone:    "First External Revenue Event",
          met:          n(ra.ext_revenue) >= 1,
          count:        n(ra.ext_revenue),
          blocker:      n(ra.ext_revenue) >= 1 ? null
            : n(ra.ext_installs) >= 1 ? "Agent in use — needs to generate a trackable value event"
            : "Blocked by: no external install yet",
        },
        {
          milestone:    "First External Royalty",
          met:          n(ra.ext_royalties) >= 1,
          count:        n(ra.ext_royalties),
          blocker:      n(ra.ext_royalties) >= 1 ? null
            : n(ra.ext_revenue) >= 1 ? "Revenue event recorded — royalty distribution pending"
            : "Blocked by: no external revenue event yet",
        },
        {
          milestone:    "Developer Expresses Intent to Publish Again",
          met:          publishIntent >= 1,
          count:        publishIntent,
          blocker:      publishIntent >= 1 ? null
            : "Blocked by: no developer feedback with publish_another=true yet",
        },
      ];

      const metCount   = steps.filter(s => s.met).length;
      const nextStep   = steps.find(s => !s.met);
      const allMet     = metCount >= 5;

      // Estimate days to next step (rough heuristic based on participant count and stage)
      const hasActiveDev = participants.some((p: any) => p.type === 'developer' && p.status !== 'invited');
      const estDays = allMet ? 0
        : nextStep?.milestone.includes("Agent Published") ? (hasActiveDev ? 3 : 7)
        : nextStep?.milestone.includes("Install") ? 5
        : nextStep?.milestone.includes("Review") ? 3
        : nextStep?.milestone.includes("Revenue") ? 7
        : nextStep?.milestone.includes("Royalty") ? 14
        : 7;

      res.json({
        steps,
        metCount,
        totalSteps: steps.length,
        allMet,
        nextMilestone: nextStep?.milestone ?? "All milestones achieved",
        nextBlocker:   nextStep?.blocker ?? null,
        estimatedDaysToNext: estDays,
        externalParticipants: participants.length,
      });
    } catch (e) {
      console.error("[first-revenue-countdown]", e);
      res.status(500).json({ error: "Failed to compute revenue countdown" });
    }
  });

  // ─── Part 5: Founder Actions ──────────────────────────────────────────────
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

      // No participants at all
      if (participants.length === 0) {
        actions.push({ priority: 1, action: "Invite your first external developer", reason: "No external participants in the system yet — this is step 1", type: "recruit" });
        actions.push({ priority: 2, action: "Invite your first external organization", reason: "Need at least one org to create an install event", type: "recruit" });
        actions.push({ priority: 3, action: "Write 3 personalized developer outreach messages using the playbook templates", reason: "Personal outreach converts 3–5× better than cold messages", type: "outreach" });
      }

      // Stuck participants
      const stuck = participants.filter((p: any) => {
        const days = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000);
        const thresholds: Record<string, number> = { invited: 3, activated: 5, published: 7, installed: 4 };
        return days >= (thresholds[p.status] ?? 5);
      });
      for (const p of stuck.slice(0, 3)) {
        actions.push({ priority: 2, action: `Follow up with ${p.external_name}`, reason: `${p.type === 'developer' ? 'Developer' : 'Org'} stuck at "${p.status}" for too long${p.external_email ? ` — email: ${p.external_email}` : ""}`, type: "follow-up" });
      }

      // Published but no install
      const publishedNeedInstall = participants.filter((p: any) => p.type === 'developer' && p.first_publish_at && !p.first_install_at);
      for (const p of publishedNeedInstall) {
        actions.push({ priority: 2, action: `Get ${p.external_name}'s agent its first install`, reason: "Published an agent but no organization has installed it — personal intro to a gym owner needed", type: "activation" });
      }

      // Installed but no review
      const installedNeedReview = participants.filter((p: any) => p.type === 'org' && p.first_install_at && !p.first_review_at);
      for (const p of installedNeedReview) {
        actions.push({ priority: 3, action: `Ask ${p.external_name} for a review`, reason: "Installed an agent but hasn't submitted a review — send a 1-sentence ask", type: "activation" });
      }

      // No external installs despite having agents
      if (n(ra.ext_agents) >= 1 && n(ra.ext_installs) === 0) {
        actions.push({ priority: 1, action: "Personally match the published external agent to 3 gym owners", reason: `External agent exists but has 0 installs — this is the highest-leverage action right now`, type: "activation" });
      }

      // Insufficient developer pipeline
      const devCount = participants.filter((p: any) => p.type === 'developer').length;
      if (devCount < 3) {
        actions.push({ priority: 3, action: `Recruit ${3 - devCount} more developer${3 - devCount > 1 ? 's' : ''} to reach cohort target`, reason: `Currently ${devCount}/3 developers in the validation cohort`, type: "recruit" });
      }

      // Insufficient org pipeline
      const orgCount = participants.filter((p: any) => p.type === 'org').length;
      if (orgCount < 5) {
        actions.push({ priority: 3, action: `Recruit ${5 - orgCount} more organization${5 - orgCount > 1 ? 's' : ''} to reach cohort target`, reason: `Currently ${orgCount}/5 organizations in the validation cohort`, type: "recruit" });
      }

      // No feedback collected
      const fbCount = feedback.length;
      if (fbCount === 0 && participants.length > 0) {
        actions.push({ priority: 2, action: "Collect feedback from at least one participant", reason: "No friction data collected — flying blind without qualitative signal", type: "feedback" });
      }

      // No playbooks sent
      const sentPlaybooks = playbooks.filter((p: any) => p.sent_at).length;
      if (sentPlaybooks === 0 && participants.length > 0) {
        actions.push({ priority: 3, action: "Mark your first outreach message as sent in the Playbooks tab", reason: "Tracking outreach effectiveness helps you see what converts", type: "tracking" });
      }

      // Positive signal — escalate
      if (n(ra.ext_reviews) >= 1 && n(ra.ext_installs) >= 1) {
        actions.push({ priority: 1, action: "Screenshot this proof and share it publicly", reason: "You have external reviews + installs — this is social proof. Post it.", type: "amplify" });
      }

      // Sort by priority, dedup, limit to 10
      const sorted = actions.sort((a, b) => a.priority - b.priority).slice(0, 10);

      res.json({
        actions: sorted,
        totalActions: sorted.length,
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

  // ─── Part 7: Phase Y Exit Criteria ────────────────────────────────────────
  app.get("/api/platform/phase-y-scorecard", async (_req, res) => {
    try {
      const participants = rows(await db.execute(sql`SELECT * FROM validation_participants`));
      const ra = row0(await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM agent_templates WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id=>`'${id}'`).join(","))})) AS ext_agents,
          (SELECT COUNT(*) FROM org_installed_agents WHERE status='active'
           AND agent_id NOT IN (${sql.raw(SEEDED_AGENT_IDS.map(id=>`'${id}'`).join(","))})) AS ext_installs,
          (SELECT COUNT(*) FROM agent_reviews WHERE org_id != ${SEEDED_ORG_ID})              AS ext_reviews,
          (SELECT COUNT(*) FROM ai_revenue_events WHERE org_id != ${SEEDED_ORG_ID})          AS ext_revenue
      `));
      const publishIntent = n(row0(await db.execute(sql`
        SELECT COUNT(*) AS c FROM participant_feedback pf
        JOIN validation_participants vp ON vp.id = pf.participant_id
        WHERE vp.type='developer' AND pf.publish_another = true
      `)).c);

      const criteria = [
        { criterion: "1 external developer publishes an agent",         met: n(ra.ext_agents) >= 1,    evidence: `${n(ra.ext_agents)} external agents` },
        { criterion: "1 external organization installs an agent",       met: n(ra.ext_installs) >= 1,  evidence: `${n(ra.ext_installs)} external installs` },
        { criterion: "1 external review submitted",                     met: n(ra.ext_reviews) >= 1,   evidence: `${n(ra.ext_reviews)} external reviews` },
        { criterion: "1 external value event recorded",                 met: n(ra.ext_revenue) >= 1,   evidence: `${n(ra.ext_revenue)} revenue events` },
        { criterion: "1 developer expresses intent to publish again",   met: publishIntent >= 1,       evidence: `${publishIntent} developer(s) confirmed intent` },
      ];

      const metCount  = criteria.filter(c => c.met).length;
      const finalQuestion = metCount >= 5 ? "CONFIRMED" : "NOT YET CONFIRMED";

      res.json({
        criteria,
        metCount,
        totalCriteria: 5,
        finalQuestion,
        phaseComplete: metCount >= 5,
        participants: participants.length,
        progressPct: Math.round(metCount / 5 * 100),
      });
    } catch (e) {
      console.error("[phase-y-scorecard]", e);
      res.status(500).json({ error: "Failed to compute Phase Y scorecard" });
    }
  });
}
