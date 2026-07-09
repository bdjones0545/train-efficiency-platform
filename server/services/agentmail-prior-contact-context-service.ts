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

/**
 * Analytics — drafts with prior context, reply rate when prior context existed.
 * We track this via a `prior_contact_used` flag stored in the action result JSON.
 */
export async function getAgentmailPriorContextAnalytics(orgId: string): Promise<{
  draftsWithPriorContext: number;
  replyRateWithPriorContext: number | null;
  conversionRateWithPriorContext: number | null;
  repeatedNoReplyDomains: { domain: string; count: number }[];
  leadsContactedWithoutReply: number;
}> {
  let draftsWithPriorContext = 0;
  let replyRateWithPriorContext: number | null = null;
  let conversionRateWithPriorContext: number | null = null;
  const repeatedNoReplyDomains: { domain: string; count: number }[] = [];
  let leadsContactedWithoutReply = 0;

  try {
    const withCtxRows = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM gmail_agent_actions
      WHERE org_id = ${orgId}
        AND result::text LIKE '%"priorContactUsed":true%'
    `));
    draftsWithPriorContext = Number(withCtxRows[0]?.cnt ?? 0);

    if (draftsWithPriorContext > 0) {
      try {
        const replyRows = rows(await db.execute(sql`
          SELECT COUNT(DISTINCT aco.gmail_action_id)::int AS cnt
          FROM agent_communication_outcomes aco
          JOIN gmail_agent_actions g ON g.id = aco.gmail_action_id
          WHERE g.org_id = ${orgId}
            AND g.result::text LIKE '%"priorContactUsed":true%'
            AND aco.outcome_status IN ('replied','meeting_booked','converted')
        `));
        const repliedCount = Number(replyRows[0]?.cnt ?? 0);
        replyRateWithPriorContext = Math.round((repliedCount / draftsWithPriorContext) * 100);

        const convRows = rows(await db.execute(sql`
          SELECT COUNT(DISTINCT aco.gmail_action_id)::int AS cnt
          FROM agent_communication_outcomes aco
          JOIN gmail_agent_actions g ON g.id = aco.gmail_action_id
          WHERE g.org_id = ${orgId}
            AND g.result::text LIKE '%"priorContactUsed":true%'
            AND aco.outcome_status IN ('converted','revenue_recovered')
        `));
        const convCount = Number(convRows[0]?.cnt ?? 0);
        conversionRateWithPriorContext = Math.round((convCount / draftsWithPriorContext) * 100);
      } catch {}
    }

    // Domains with repeated no-reply follow-ups
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

    // Leads contacted 3+ times without reply
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
  } catch {}

  return {
    draftsWithPriorContext,
    replyRateWithPriorContext,
    conversionRateWithPriorContext,
    repeatedNoReplyDomains,
    leadsContactedWithoutReply,
  };
}
