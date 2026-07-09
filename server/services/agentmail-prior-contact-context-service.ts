/**
 * AgentMail Phase G — Lead-Level Closed Loop
 *
 * Retrieves the relationship history between an org and a specific recipient,
 * then returns a deterministic `promptBlock` injected before generation.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

export interface PriorContactContext {
  hasPriorContact: boolean;
  sentCount: number;
  replyCount: number;
  lastSentAt?: string;
  lastOutcome?: string;
  lastSubject?: string;
  lastDomain?: string;
  evaluationScheduled: boolean;
  converted: boolean;
  firstSessionScheduled: boolean;
  programAssigned: boolean;
  paymentRecovered: boolean;
  recommendedTone?: string;
  recommendedCTA?: string;
  avoidRepeating?: string[];
  promptBlock: string;
}

export interface PriorContactOpts {
  orgId: string;
  recipientEmail: string;
  leadId?: string;
  athleteUserId?: string;
  guardianUserId?: string;
  communicationDomain?: string;
}

const EMPTY: PriorContactContext = {
  hasPriorContact: false,
  sentCount: 0,
  replyCount: 0,
  evaluationScheduled: false,
  converted: false,
  firstSessionScheduled: false,
  programAssigned: false,
  paymentRecovered: false,
  promptBlock: "",
};

export async function getPriorContactContext(opts: PriorContactOpts): Promise<PriorContactContext> {
  try {
    const { orgId, recipientEmail } = opts;
    if (!orgId || !recipientEmail) return EMPTY;

    // ── 1. Count sent messages + last sent details ─────────────────────────
    const sentRows = rows(await db.execute(sql`
      SELECT
        id,
        subject,
        communication_domain,
        status,
        created_at
      FROM gmail_agent_actions
      WHERE org_id = ${orgId}
        AND LOWER(recipient_email) = LOWER(${recipientEmail})
        AND status IN ('sent','approved','proposed','drafted')
      ORDER BY created_at DESC
      LIMIT 20
    `));

    const sentCount = sentRows.length;
    if (sentCount === 0) return EMPTY;

    const lastSent = sentRows[0];
    const lastSentAt = lastSent.created_at as string;
    const lastSubject = lastSent.subject as string | null ?? undefined;
    const lastDomain = lastSent.communication_domain as string | null ?? undefined;

    // Collect action ids for outcome lookups
    const actionIds: string[] = sentRows.map((r: any) => r.id as string);
    const idList = actionIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");

    // ── 2. Reply count from agentmail outcome events ───────────────────────
    let replyCount = 0;
    let evaluationScheduled = false;
    let converted = false;
    let paymentRecovered = false;
    let lastOutcome: string | undefined;

    try {
      const outcomeRows = rows(await db.execute(sql`
        SELECT oe.outcome_type
        FROM agentmail_outcome_events oe
        JOIN agent_communication_outcomes aco ON aco.id = oe.outcome_id
        WHERE aco.org_id = ${orgId}
          AND aco.gmail_action_id = ANY(ARRAY[${sql.raw(idList)}]::text[])
        ORDER BY oe.created_at DESC
        LIMIT 50
      `));

      for (const row of outcomeRows) {
        const t = row.outcome_type as string;
        if (t === "reply_received") replyCount++;
        if (t === "evaluation_scheduled") evaluationScheduled = true;
        if (t === "lead_converted") converted = true;
        if (t === "payment_recovered") paymentRecovered = true;
      }
      if (outcomeRows.length > 0) lastOutcome = outcomeRows[0].outcome_type as string;
    } catch {
      // agentmail_outcome_events may not exist yet — fail open
    }

    // ── 3. Reply queue — count actual replies received from this email ─────
    try {
      const rqRows = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM agent_mail_reply_queue
        WHERE LOWER(recipient_email) = LOWER(${recipientEmail})
          AND status = 'sent'
        LIMIT 1
      `));
      const rqCount = Number(rqRows[0]?.cnt ?? 0);
      if (rqCount > replyCount) replyCount = rqCount;
    } catch {}

    // ── 4. Booking state — first session scheduled ─────────────────────────
    let firstSessionScheduled = false;
    try {
      const bookRows = rows(await db.execute(sql`
        SELECT b.id
        FROM bookings b
        JOIN users u ON u.id = b.client_user_id
        WHERE b.org_id = ${orgId}
          AND LOWER(u.email) = LOWER(${recipientEmail})
          AND b.booking_status IN ('CONFIRMED','SCHEDULED','PENDING')
        LIMIT 1
      `));
      firstSessionScheduled = bookRows.length > 0;
    } catch {}

    // ── 5. Program assignment via athlete_onboarding_checklists ───────────
    let programAssigned = false;
    try {
      if (opts.athleteUserId) {
        const pgRows = rows(await db.execute(sql`
          SELECT id FROM athlete_onboarding_checklists
          WHERE user_id = ${opts.athleteUserId}
            AND program_assigned = true
          LIMIT 1
        `));
        programAssigned = pgRows.length > 0;
      }
    } catch {}

    // ── 6. Time since last send ────────────────────────────────────────────
    const daysSinceLast = lastSentAt
      ? Math.floor((Date.now() - new Date(lastSentAt).getTime()) / 86_400_000)
      : null;

    // ── 7. Collect subjects to avoid repeating ────────────────────────────
    const avoidRepeating: string[] = [];
    const firstSentSubject = sentRows[sentRows.length - 1]?.subject as string | null;
    if (firstSentSubject && firstSentSubject !== lastSubject) {
      avoidRepeating.push(`Do not repeat the original subject: "${firstSentSubject.slice(0, 60)}"`);
    }
    if (sentCount >= 2) {
      avoidRepeating.push("Do not start with the same opening line as a previous email.");
    }

    // ── 8. Determine recommended CTA + tone ───────────────────────────────
    let recommendedCTA: string | undefined;
    let recommendedTone: string | undefined;

    if (converted) {
      recommendedCTA = "Do not write as if they are still a lead. Use onboarding or training language.";
      recommendedTone = "warm, onboarding";
    } else if (firstSessionScheduled) {
      recommendedCTA = "Reference the upcoming first session and ask if they have questions.";
      recommendedTone = "warm, supportive";
    } else if (evaluationScheduled) {
      recommendedCTA = "Do not ask them to schedule again. Reference the upcoming evaluation if appropriate.";
      recommendedTone = "professional, confirmatory";
    } else if (paymentRecovered) {
      recommendedCTA = "Do not ask about payment again unless a new issue exists.";
      recommendedTone = "professional";
    } else if (replyCount > 0) {
      recommendedCTA = "Move the conversation toward scheduling an evaluation or next step.";
      recommendedTone = "warm, forward-moving";
    } else if (sentCount >= 1 && daysSinceLast !== null && daysSinceLast >= 2) {
      recommendedCTA = "Use a short follow-up with one clear next step.";
      recommendedTone = "concise, low-pressure";
    } else if (sentCount >= 3) {
      recommendedCTA = "Keep it very short — they've already received multiple emails. One sentence CTA.";
      recommendedTone = "brief, respectful";
    }

    // ── 9. Build prompt block ─────────────────────────────────────────────
    const lines: string[] = [];
    lines.push(`Prior contact context for ${recipientEmail}:`);
    lines.push(`- ${sentCount} previous email${sentCount === 1 ? "" : "s"} sent via AgentMail.`);
    if (lastSentAt) {
      const ago = daysSinceLast === 0 ? "today" : daysSinceLast === 1 ? "1 day ago" : `${daysSinceLast} days ago`;
      lines.push(`- Last email was sent ${ago}.`);
    }
    if (lastSubject) lines.push(`- Last subject: "${lastSubject.slice(0, 80)}"`);

    if (replyCount > 0) {
      lines.push(`- Lead has replied ${replyCount} time${replyCount === 1 ? "" : "s"}.`);
    } else {
      lines.push(`- No reply received from this lead yet.`);
    }

    if (evaluationScheduled) lines.push("- Evaluation/meeting has already been scheduled.");
    if (converted) lines.push("- This lead has already converted — treat as an active client/athlete.");
    if (firstSessionScheduled) lines.push("- First session is scheduled.");
    if (programAssigned) lines.push("- Program has been assigned.");
    if (paymentRecovered) lines.push("- Payment recovery already addressed.");

    if (avoidRepeating.length > 0) {
      for (const a of avoidRepeating) lines.push(`- ${a}`);
    }
    if (recommendedCTA) lines.push(`- Recommended CTA: ${recommendedCTA}`);
    if (recommendedTone) lines.push(`- Tone: ${recommendedTone}`);

    const promptBlock = lines.join("\n");

    return {
      hasPriorContact: true,
      sentCount,
      replyCount,
      lastSentAt,
      lastOutcome,
      lastSubject,
      lastDomain,
      evaluationScheduled,
      converted,
      firstSessionScheduled,
      programAssigned,
      paymentRecovered,
      recommendedTone,
      recommendedCTA,
      avoidRepeating,
      promptBlock,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Org-level summary for CEO Heartbeat and analytics.
 */
export async function getAgentmailLeadLevelSignal(orgId: string): Promise<{
  noReplyAfter3Emails: number;
  repliedButNoEval: number;
  convertedStillReceivingLeadEmails: number;
}> {
  let noReplyAfter3Emails = 0;
  let repliedButNoEval = 0;
  let convertedStillReceivingLeadEmails = 0;

  try {
    // Leads with 3+ sent emails and no reply
    const noReplyRows = rows(await db.execute(sql`
      SELECT recipient_email, COUNT(*)::int AS cnt
      FROM gmail_agent_actions
      WHERE org_id = ${orgId}
        AND status IN ('sent','approved')
        AND recipient_email IS NOT NULL
      GROUP BY recipient_email
      HAVING COUNT(*) >= 3
    `));

    // Check which of those have reply outcomes
    for (const r of noReplyRows) {
      const email = r.recipient_email as string;
      let hasReply = false;
      try {
        const replyRows = rows(await db.execute(sql`
          SELECT oe.id
          FROM agentmail_outcome_events oe
          JOIN agent_communication_outcomes aco ON aco.id = oe.outcome_id
          JOIN gmail_agent_actions g ON g.id = aco.gmail_action_id
          WHERE g.org_id = ${orgId}
            AND LOWER(g.recipient_email) = LOWER(${email})
            AND oe.outcome_type = 'reply_received'
          LIMIT 1
        `));
        hasReply = replyRows.length > 0;
      } catch {}

      if (!hasReply) noReplyAfter3Emails++;
    }

    // Leads who replied but have no evaluation_scheduled outcome
    try {
      const repliedRows = rows(await db.execute(sql`
        SELECT DISTINCT LOWER(g.recipient_email) AS email
        FROM agentmail_outcome_events oe
        JOIN agent_communication_outcomes aco ON aco.id = oe.outcome_id
        JOIN gmail_agent_actions g ON g.id = aco.gmail_action_id
        WHERE g.org_id = ${orgId}
          AND oe.outcome_type = 'reply_received'
          AND g.recipient_email IS NOT NULL
      `));

      for (const r of repliedRows) {
        const email = r.email as string;
        const evalRows = rows(await db.execute(sql`
          SELECT oe.id
          FROM agentmail_outcome_events oe
          JOIN agent_communication_outcomes aco ON aco.id = oe.outcome_id
          JOIN gmail_agent_actions g ON g.id = aco.gmail_action_id
          WHERE g.org_id = ${orgId}
            AND LOWER(g.recipient_email) = LOWER(${email})
            AND oe.outcome_type = 'evaluation_scheduled'
          LIMIT 1
        `));
        if (evalRows.length === 0) repliedButNoEval++;
      }
    } catch {}

    // Converted recipients still receiving lead-domain emails recently
    try {
      const convertedRows = rows(await db.execute(sql`
        SELECT DISTINCT LOWER(g.recipient_email) AS email
        FROM agentmail_outcome_events oe
        JOIN agent_communication_outcomes aco ON aco.id = oe.outcome_id
        JOIN gmail_agent_actions g ON g.id = aco.gmail_action_id
        WHERE g.org_id = ${orgId}
          AND oe.outcome_type = 'lead_converted'
          AND g.recipient_email IS NOT NULL
      `));

      for (const r of convertedRows) {
        const email = r.email as string;
        const recentLeadRows = rows(await db.execute(sql`
          SELECT id FROM gmail_agent_actions
          WHERE org_id = ${orgId}
            AND LOWER(recipient_email) = LOWER(${email})
            AND communication_domain IN ('athlete_lead','parent_lead','team_training_prospect','general')
            AND created_at > NOW() - INTERVAL '14 days'
          LIMIT 1
        `));
        if (recentLeadRows.length > 0) convertedStillReceivingLeadEmails++;
      }
    } catch {}
  } catch {}

  return { noReplyAfter3Emails, repliedButNoEval, convertedStillReceivingLeadEmails };
}

// ─── Summary builder + patch helper ──────────────────────────────────────────

export function buildPriorContactSummary(ctx: PriorContactContext): {
  priorContactUsed: boolean;
  priorContactSummary?: {
    sentCount: number;
    replyCount: number;
    lastSentAt?: string;
    lastOutcome?: string;
    lastSubject?: string;
    lastDomain?: string;
    evaluationScheduled: boolean;
    converted: boolean;
    firstSessionScheduled: boolean;
    programAssigned: boolean;
    paymentRecovered: boolean;
    recommendedCTA?: string;
    recommendedTone?: string;
  };
} {
  if (!ctx.hasPriorContact) return { priorContactUsed: false };
  return {
    priorContactUsed: true,
    priorContactSummary: {
      sentCount: ctx.sentCount,
      replyCount: ctx.replyCount,
      lastSentAt: ctx.lastSentAt,
      lastOutcome: ctx.lastOutcome,
      lastSubject: ctx.lastSubject,
      lastDomain: ctx.lastDomain,
      evaluationScheduled: ctx.evaluationScheduled,
      converted: ctx.converted,
      firstSessionScheduled: ctx.firstSessionScheduled,
      programAssigned: ctx.programAssigned,
      paymentRecovered: ctx.paymentRecovered,
      recommendedCTA: ctx.recommendedCTA,
      recommendedTone: ctx.recommendedTone,
    },
  };
}

/**
 * Patches gmail_agent_actions.result JSONB with prior contact metadata.
 * Fail-open — never throws.
 */
export async function persistPriorContactMetadata(actionId: string, ctx: PriorContactContext): Promise<void> {
  try {
    if (!actionId) return;
    const meta = buildPriorContactSummary(ctx);
    await db.execute(sql`
      UPDATE gmail_agent_actions
      SET result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify(meta)}::jsonb
      WHERE id = ${actionId}
    `);
  } catch {}
}

// ─── Analytics — comparison shape ────────────────────────────────────────────

function confidenceLevel(count: number): "none" | "low" | "medium" | "high" {
  if (count === 0) return "none";
  if (count < 5) return "low";
  if (count < 20) return "medium";
  return "high";
}

function pct(n: number, d: number): number | null {
  if (d === 0) return null;
  return Math.round((n / d) * 100);
}

function domainInterpretation(
  withCtx: number,
  rateWith: number | null,
  rateWithout: number | null,
): string {
  if (withCtx === 0) return "No prior-context drafts yet for this domain.";
  if (rateWith === null && rateWithout === null) return "Outcome data unavailable.";
  if (rateWith === null) return "Insufficient data for comparison.";
  if (rateWithout === null) return "All drafts in this domain use prior context — no baseline available.";
  const diff = (rateWith ?? 0) - (rateWithout ?? 0);
  if (diff >= 5) return "Prior context associated with higher reply rate in this domain.";
  if (diff <= -5) return "Prior-context drafts still underperform baseline — review strategy for this domain.";
  return "Similar performance with and without prior context.";
}

export interface PriorContextDomainRow {
  domain: string;
  withContextCount: number;
  withoutContextCount: number;
  replyRateWithContext: number | null;
  replyRateWithoutContext: number | null;
  conversionRateWithContext: number | null;
  conversionRateWithoutContext: number | null;
  evaluationRateWithContext: number | null;
  evaluationRateWithoutContext: number | null;
  dataConfidence: "none" | "low" | "medium" | "high";
  interpretation: string;
}

export interface PriorContextAnalytics {
  totals: {
    draftsWithPriorContext: number;
    draftsWithoutPriorContext: number;
    replyRateWithContext: number | null;
    replyRateWithoutContext: number | null;
    conversionRateWithContext: number | null;
    conversionRateWithoutContext: number | null;
    evaluationRateWithContext: number | null;
    evaluationRateWithoutContext: number | null;
    firstSessionRateWithContext: number | null;
    firstSessionRateWithoutContext: number | null;
  };
  byDomain: PriorContextDomainRow[];
  recentExamples: {
    actionId: string;
    domain: string;
    recipientEmail: string;
    priorContactSummary: Record<string, unknown> | null;
    outcomes: string[];
    createdAt: string;
  }[];
  repeatedNoReplyDomains: { domain: string; count: number }[];
  leadsContactedWithoutReply: number;
}

export async function getAgentmailPriorContextAnalytics(orgId: string): Promise<PriorContextAnalytics> {
  const empty: PriorContextAnalytics = {
    totals: {
      draftsWithPriorContext: 0,
      draftsWithoutPriorContext: 0,
      replyRateWithContext: null,
      replyRateWithoutContext: null,
      conversionRateWithContext: null,
      conversionRateWithoutContext: null,
      evaluationRateWithContext: null,
      evaluationRateWithoutContext: null,
      firstSessionRateWithContext: null,
      firstSessionRateWithoutContext: null,
    },
    byDomain: [],
    recentExamples: [],
    repeatedNoReplyDomains: [],
    leadsContactedWithoutReply: 0,
  };

  try {
    // ── 1. Outcome rates by prior context flag ─────────────────────────────
    let outcomeCounts: {
      hasCtx: boolean;
      total: number;
      replied: number;
      converted: number;
      evalScheduled: number;
      firstSession: number;
    }[] = [];

    try {
      const outRows = rows(await db.execute(sql`
        SELECT
          (g.result::text LIKE '%"priorContactUsed":true%') AS has_ctx,
          COUNT(DISTINCT g.id)::int AS total,
          COUNT(DISTINCT CASE WHEN oe.outcome_type = 'reply_received' THEN g.id END)::int AS replied,
          COUNT(DISTINCT CASE WHEN oe.outcome_type = 'lead_converted' THEN g.id END)::int AS converted,
          COUNT(DISTINCT CASE WHEN oe.outcome_type = 'evaluation_scheduled' THEN g.id END)::int AS eval_scheduled,
          COUNT(DISTINCT CASE WHEN oe.outcome_type = 'first_session_scheduled' THEN g.id END)::int AS first_session
        FROM gmail_agent_actions g
        LEFT JOIN agent_communication_outcomes aco ON aco.gmail_action_id = g.id
        LEFT JOIN agentmail_outcome_events oe ON oe.outcome_id = aco.id
        WHERE g.org_id = ${orgId}
          AND g.status IN ('sent','approved')
          AND g.result IS NOT NULL
        GROUP BY has_ctx
      `));
      outcomeCounts = outRows.map((r: any) => ({
        hasCtx: r.has_ctx === true || r.has_ctx === 't',
        total: Number(r.total ?? 0),
        replied: Number(r.replied ?? 0),
        converted: Number(r.converted ?? 0),
        evalScheduled: Number(r.eval_scheduled ?? 0),
        firstSession: Number(r.first_session ?? 0),
      }));
    } catch {}

    const withCtxTotals = outcomeCounts.find((r) => r.hasCtx) ?? { hasCtx: true, total: 0, replied: 0, converted: 0, evalScheduled: 0, firstSession: 0 };
    const noCtxTotals = outcomeCounts.find((r) => !r.hasCtx) ?? { hasCtx: false, total: 0, replied: 0, converted: 0, evalScheduled: 0, firstSession: 0 };

    // Also count drafts that have no result at all or result lacks the flag (= without context)
    let totalNoResult = 0;
    try {
      const nr = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM gmail_agent_actions
        WHERE org_id = ${orgId}
          AND status IN ('sent','approved')
          AND (result IS NULL OR result::text NOT LIKE '%"priorContactUsed"%')
      `));
      totalNoResult = Number(nr[0]?.cnt ?? 0);
    } catch {}

    const draftsWithPriorContext = withCtxTotals.total;
    const draftsWithoutPriorContext = noCtxTotals.total + totalNoResult;

    // ── 2. By domain ──────────────────────────────────────────────────────
    const byDomain: PriorContextDomainRow[] = [];
    try {
      const domRows = rows(await db.execute(sql`
        SELECT
          g.communication_domain AS domain,
          (g.result::text LIKE '%"priorContactUsed":true%') AS has_ctx,
          COUNT(DISTINCT g.id)::int AS total,
          COUNT(DISTINCT CASE WHEN oe.outcome_type = 'reply_received' THEN g.id END)::int AS replied,
          COUNT(DISTINCT CASE WHEN oe.outcome_type = 'lead_converted' THEN g.id END)::int AS converted,
          COUNT(DISTINCT CASE WHEN oe.outcome_type = 'evaluation_scheduled' THEN g.id END)::int AS eval_scheduled
        FROM gmail_agent_actions g
        LEFT JOIN agent_communication_outcomes aco ON aco.gmail_action_id = g.id
        LEFT JOIN agentmail_outcome_events oe ON oe.outcome_id = aco.id
        WHERE g.org_id = ${orgId}
          AND g.status IN ('sent','approved')
          AND g.communication_domain IS NOT NULL
          AND g.result IS NOT NULL
        GROUP BY g.communication_domain, has_ctx
        ORDER BY g.communication_domain
      `));

      const domMap: Record<string, { withCtx: any; noCtx: any }> = {};
      for (const r of domRows) {
        const d = r.domain as string;
        if (!domMap[d]) domMap[d] = { withCtx: null, noCtx: null };
        const hasCtx = r.has_ctx === true || r.has_ctx === 't';
        if (hasCtx) domMap[d].withCtx = r;
        else domMap[d].noCtx = r;
      }

      for (const [domain, { withCtx, noCtx }] of Object.entries(domMap)) {
        const wc = withCtx ? Number(withCtx.total ?? 0) : 0;
        const nc = noCtx ? Number(noCtx.total ?? 0) : 0;
        const rWith = pct(withCtx ? Number(withCtx.replied ?? 0) : 0, wc);
        const rWithout = pct(noCtx ? Number(noCtx.replied ?? 0) : 0, nc);
        const cvWith = pct(withCtx ? Number(withCtx.converted ?? 0) : 0, wc);
        const cvWithout = pct(noCtx ? Number(noCtx.converted ?? 0) : 0, nc);
        const evWith = pct(withCtx ? Number(withCtx.eval_scheduled ?? 0) : 0, wc);
        const evWithout = pct(noCtx ? Number(noCtx.eval_scheduled ?? 0) : 0, nc);
        byDomain.push({
          domain,
          withContextCount: wc,
          withoutContextCount: nc,
          replyRateWithContext: rWith,
          replyRateWithoutContext: rWithout,
          conversionRateWithContext: cvWith,
          conversionRateWithoutContext: cvWithout,
          evaluationRateWithContext: evWith,
          evaluationRateWithoutContext: evWithout,
          dataConfidence: confidenceLevel(wc),
          interpretation: domainInterpretation(wc, rWith, rWithout),
        });
      }
      byDomain.sort((a, b) => b.withContextCount - a.withContextCount);
    } catch {}

    // ── 3. Recent examples ────────────────────────────────────────────────
    const recentExamples: PriorContextAnalytics["recentExamples"] = [];
    try {
      const exRows = rows(await db.execute(sql`
        SELECT g.id, g.communication_domain, g.recipient_email,
               g.result->'priorContactSummary' AS summary,
               g.created_at
        FROM gmail_agent_actions g
        WHERE g.org_id = ${orgId}
          AND g.result::text LIKE '%"priorContactUsed":true%'
        ORDER BY g.created_at DESC
        LIMIT 8
      `));

      for (const r of exRows) {
        let outcomes: string[] = [];
        try {
          const oRows = rows(await db.execute(sql`
            SELECT DISTINCT oe.outcome_type
            FROM agentmail_outcome_events oe
            JOIN agent_communication_outcomes aco ON aco.id = oe.outcome_id
            WHERE aco.gmail_action_id = ${r.id as string}
            LIMIT 5
          `));
          outcomes = oRows.map((o: any) => o.outcome_type as string);
        } catch {}
        recentExamples.push({
          actionId: r.id as string,
          domain: (r.communication_domain as string) ?? "unknown",
          recipientEmail: (r.recipient_email as string) ?? "",
          priorContactSummary: r.summary as Record<string, unknown> | null,
          outcomes,
          createdAt: r.created_at as string,
        });
      }
    } catch {}

    // ── 4. Repeated no-reply domains ──────────────────────────────────────
    const repeatedNoReplyDomains: { domain: string; count: number }[] = [];
    let leadsContactedWithoutReply = 0;
    try {
      const domainRows = rows(await db.execute(sql`
        SELECT communication_domain AS domain, COUNT(DISTINCT recipient_email)::int AS count
        FROM gmail_agent_actions
        WHERE org_id = ${orgId}
          AND status IN ('sent','approved')
          AND communication_domain IS NOT NULL
          AND recipient_email NOT IN (
            SELECT DISTINCT LOWER(g2.recipient_email)
            FROM agentmail_outcome_events oe2
            JOIN agent_communication_outcomes aco2 ON aco2.id = oe2.outcome_id
            JOIN gmail_agent_actions g2 ON g2.id = aco2.gmail_action_id
            WHERE g2.org_id = ${orgId}
              AND oe2.outcome_type = 'reply_received'
          )
        GROUP BY communication_domain
        HAVING COUNT(*) >= 2
        ORDER BY count DESC
        LIMIT 5
      `));
      for (const r of domainRows) {
        repeatedNoReplyDomains.push({ domain: r.domain as string, count: Number(r.count) });
      }
    } catch {}

    try {
      const lcrRows = rows(await db.execute(sql`
        SELECT COUNT(DISTINCT recipient_email)::int AS cnt
        FROM gmail_agent_actions
        WHERE org_id = ${orgId}
          AND status IN ('sent','approved')
          AND recipient_email IS NOT NULL
          AND recipient_email NOT IN (
            SELECT DISTINCT LOWER(g3.recipient_email)
            FROM agentmail_outcome_events oe3
            JOIN agent_communication_outcomes aco3 ON aco3.id = oe3.outcome_id
            JOIN gmail_agent_actions g3 ON g3.id = aco3.gmail_action_id
            WHERE g3.org_id = ${orgId}
              AND oe3.outcome_type = 'reply_received'
          )
        GROUP BY recipient_email
        HAVING COUNT(*) >= 3
      `));
      leadsContactedWithoutReply = lcrRows.length;
    } catch {}

    return {
      totals: {
        draftsWithPriorContext,
        draftsWithoutPriorContext,
        replyRateWithContext: pct(withCtxTotals.replied, withCtxTotals.total),
        replyRateWithoutContext: pct(noCtxTotals.replied, noCtxTotals.total),
        conversionRateWithContext: pct(withCtxTotals.converted, withCtxTotals.total),
        conversionRateWithoutContext: pct(noCtxTotals.converted, noCtxTotals.total),
        evaluationRateWithContext: pct(withCtxTotals.evalScheduled, withCtxTotals.total),
        evaluationRateWithoutContext: pct(noCtxTotals.evalScheduled, noCtxTotals.total),
        firstSessionRateWithContext: pct(withCtxTotals.firstSession, withCtxTotals.total),
        firstSessionRateWithoutContext: pct(noCtxTotals.firstSession, noCtxTotals.total),
      },
      byDomain,
      recentExamples,
      repeatedNoReplyDomains,
      leadsContactedWithoutReply,
    };
  } catch {
    return empty;
  }
}
