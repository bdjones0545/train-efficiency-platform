/**
 * AgentMail Outcome Correlation Service — Phase E
 *
 * Deterministically correlates sent AgentMail drafts with downstream
 * platform events. Uses raw event matching — no AI causal inference.
 *
 * "Associated outcomes" ≠ "caused outcomes". Labels are explicit.
 */

import { db } from "../db";
import { sql, and, eq, inArray, gt } from "drizzle-orm";
import {
  gmailAgentActions,
  agentCommunicationOutcomes,
  leadCaptureSubmissions,
  athleteOnboardingChecklists,
  walletTransactions,
  bookings,
} from "@shared/schema";

// ─── Types ─────────────────────────────────────────────────────────────────────

export const AGENTMAIL_OUTCOME_TYPES = [
  "reply_received",
  "evaluation_scheduled",
  "evaluation_completed",
  "lead_converted",
  "first_session_scheduled",
  "program_assigned",
  "payment_recovered",
  "booking_created",
] as const;
export type AgentmailOutcomeType = typeof AGENTMAIL_OUTCOME_TYPES[number];

const OUTCOME_LABELS: Record<string, string> = {
  reply_received: "Reply Received",
  evaluation_scheduled: "Evaluation Scheduled",
  evaluation_completed: "Evaluation Completed",
  lead_converted: "Lead Converted",
  first_session_scheduled: "First Session Scheduled",
  program_assigned: "Program Assigned",
  payment_recovered: "Payment Recovered",
  booking_created: "Booking Created",
};

export function getOutcomeLabel(type: string): string {
  return OUTCOME_LABELS[type] ?? type;
}

const TABLE = "agentmail_outcome_events";

// ─── Parse raw SQL result ──────────────────────────────────────────────────────

function rows(res: unknown): any[] {
  if (Array.isArray(res)) return res;
  return (res as any).rows ?? [];
}

// ─── Check table exists ────────────────────────────────────────────────────────

async function tableExists(): Promise<boolean> {
  try {
    const r = rows(await db.execute(sql`SELECT to_regclass('public.agentmail_outcome_events') as t`));
    return !!r[0]?.t;
  } catch {
    return false;
  }
}

// ─── Recompute outcomes for an org ────────────────────────────────────────────

export async function recomputeOutcomesForOrg(orgId: string): Promise<{
  processed: number;
  inserted: number;
  errors: string[];
}> {
  let processed = 0;
  let inserted = 0;
  const errors: string[] = [];

  if (!(await tableExists())) {
    return { processed: 0, inserted: 0, errors: ["agentmail_outcome_events table not yet created"] };
  }

  try {
    const actions = await db
      .select()
      .from(gmailAgentActions)
      .where(
        and(
          eq(gmailAgentActions.orgId, orgId),
          inArray(gmailAgentActions.status, ["approved", "executed", "sent"]),
        ),
      )
      .limit(500);

    processed = actions.length;

    for (const action of actions) {
      const sentAt = action.executedAt ?? action.createdAt;
      if (!sentAt) continue;

      const pending: Array<{
        type: string;
        entityType: string | null;
        entityId: string | null;
        value: number;
        conf: number;
        meta: Record<string, unknown>;
      }> = [];

      // ── Rule 1: Reply received via outcome tracking ───────────────────────
      try {
        const [reply] = await db
          .select({ id: agentCommunicationOutcomes.id, status: agentCommunicationOutcomes.outcomeStatus })
          .from(agentCommunicationOutcomes)
          .where(
            and(
              eq(agentCommunicationOutcomes.gmailActionId, action.id),
              inArray(agentCommunicationOutcomes.outcomeStatus, [
                "replied", "meeting_booked", "booked_session", "converted", "hired",
              ]),
            ),
          )
          .limit(1);
        if (reply) {
          pending.push({ type: "reply_received", entityType: "agent_communication_outcome", entityId: reply.id, value: 1, conf: 1.0, meta: { status: reply.status } });
        }
      } catch {}

      // ── Lead-based correlation ────────────────────────────────────────────
      if (action.leadId) {
        try {
          const [lead] = await db
            .select()
            .from(leadCaptureSubmissions)
            .where(eq(leadCaptureSubmissions.id, action.leadId))
            .limit(1);

          if (lead) {
            // Rule 2: Evaluation scheduled
            if (lead.evaluationBookedAt && lead.evaluationBookedAt > sentAt) {
              pending.push({ type: "evaluation_scheduled", entityType: "lead_capture_submission", entityId: lead.id, value: 1, conf: 0.9, meta: { evaluationBookedAt: lead.evaluationBookedAt } });
            }

            // Rule 3: Evaluation completed
            if (lead.attendedAt && lead.attendedAt > sentAt) {
              pending.push({ type: "evaluation_completed", entityType: "lead_capture_submission", entityId: lead.id, value: 1, conf: 0.9, meta: { attendedAt: lead.attendedAt } });
            }

            // Rule 4: Lead converted
            const convertedAt = lead.convertedAt ?? (lead as any).signupConvertedAt ?? null;
            if (convertedAt && convertedAt > sentAt) {
              pending.push({ type: "lead_converted", entityType: "lead_capture_submission", entityId: lead.id, value: (lead.estimatedValueCents ?? 0) / 100, conf: 1.0, meta: { convertedAt, estimatedValueCents: lead.estimatedValueCents } });
            }

            // Rules 5–8 require linkedUserId
            if (lead.linkedUserId) {
              // Rule 5 & 6: Onboarding checklist
              try {
                const [checklist] = await db
                  .select()
                  .from(athleteOnboardingChecklists)
                  .where(and(
                    eq(athleteOnboardingChecklists.orgId, orgId),
                    eq(athleteOnboardingChecklists.athleteUserId, lead.linkedUserId),
                  ))
                  .limit(1);
                if (checklist) {
                  if (checklist.firstSessionScheduled) {
                    pending.push({ type: "first_session_scheduled", entityType: "athlete_onboarding_checklist", entityId: checklist.id, value: 1, conf: 0.8, meta: { athleteUserId: lead.linkedUserId } });
                  }
                  if (checklist.programAssigned) {
                    pending.push({ type: "program_assigned", entityType: "athlete_onboarding_checklist", entityId: checklist.id, value: 1, conf: 0.8, meta: { athleteUserId: lead.linkedUserId } });
                  }
                }
              } catch {}

              // Rule 7: Booking created after email
              try {
                const [booking] = await db
                  .select({ id: bookings.id, createdAt: bookings.createdAt })
                  .from(bookings)
                  .where(and(eq(bookings.clientId, lead.linkedUserId), gt(bookings.createdAt, sentAt)))
                  .limit(1);
                if (booking) {
                  pending.push({ type: "booking_created", entityType: "booking", entityId: booking.id, value: 1, conf: 0.75, meta: { bookingId: booking.id } });
                }
              } catch {}

              // Rule 8: Payment recovered — only for payment-domain actions
              if (["payment_recovery", "billing"].includes(action.communicationDomain ?? "")) {
                try {
                  const [tx] = await db
                    .select({ id: walletTransactions.id, amountCents: walletTransactions.amountCents })
                    .from(walletTransactions)
                    .where(and(eq(walletTransactions.userId, lead.linkedUserId), gt(walletTransactions.createdAt, sentAt)))
                    .limit(1);
                  if (tx) {
                    pending.push({ type: "payment_recovered", entityType: "wallet_transaction", entityId: tx.id, value: (tx.amountCents ?? 0) / 100, conf: 0.85, meta: { amountCents: tx.amountCents } });
                  }
                } catch {}
              }
            }
          }
        } catch (err: any) {
          errors.push(`lead ${action.leadId}: ${err.message}`);
        }
      }

      // ── Insert all outcome events (ON CONFLICT DO NOTHING) ─────────────────
      for (const o of pending) {
        try {
          await db.execute(sql`
            INSERT INTO agentmail_outcome_events (
              id, org_id, action_id, communication_domain, recipient_email,
              outcome_type, related_entity_type, related_entity_id,
              outcome_value, source, confidence, metadata, detected_at, created_at
            ) VALUES (
              gen_random_uuid()::text, ${orgId}, ${action.id},
              ${action.communicationDomain ?? "athlete_lead"}, ${action.recipientEmail ?? null},
              ${o.type}, ${o.entityType}, ${o.entityId},
              ${o.value}, 'auto_correlation', ${o.conf},
              ${JSON.stringify(o.meta)}::jsonb, now(), now()
            )
            ON CONFLICT (org_id, action_id, outcome_type, related_entity_type, related_entity_id) DO NOTHING
          `);
          inserted++;
        } catch (err: any) {
          if (!err.message?.includes("does not exist") && !err.message?.includes("no such")) {
            errors.push(`insert ${o.type}: ${err.message}`);
          }
        }
      }
    }
  } catch (err: any) {
    errors.push(`recompute error: ${err.message}`);
  }

  return { processed, inserted, errors };
}

// ─── Status hierarchy & sync ───────────────────────────────────────────────────

const STATUS_RANK: Record<string, number> = {
  sent: 1, opened: 2, replied: 3,
  meeting_booked: 4, booked_session: 4,
  converted: 5, hired: 5, contract_signed: 5,
  revenue_recovered: 6,
};

const OUTCOME_TO_STATUS: Record<string, string> = {
  reply_received:       "replied",
  evaluation_scheduled: "meeting_booked",
  lead_converted:       "converted",
  payment_recovered:    "revenue_recovered",
};

/**
 * After recompute, upgrade `agent_communication_outcomes.outcome_status`
 * using the correlated outcome events. Only upgrades — never downgrades.
 * Returns the number of rows actually updated.
 */
export async function syncOutcomeStatusesForOrg(orgId: string): Promise<number> {
  let updated = 0;
  try {
    if (!(await tableExists())) return 0;

    // Load all outcome events for this org that have a status mapping
    const evtRows = rows(await db.execute(sql`
      SELECT action_id, outcome_type
      FROM agentmail_outcome_events
      WHERE org_id = ${orgId}
        AND outcome_type = ANY(ARRAY['reply_received','evaluation_scheduled','lead_converted','payment_recovered'])
    `));

    // Load matching communication outcomes keyed by gmailActionId
    const actionIds = [...new Set(evtRows.map((r: any) => r.action_id as string))];
    if (actionIds.length === 0) return 0;

    const outcomeRows = rows(await db.execute(sql`
      SELECT id, gmail_action_id, outcome_status
      FROM agent_communication_outcomes
      WHERE org_id = ${orgId}
        AND gmail_action_id = ANY(${sql`ARRAY[${actionIds.map((id) => sql`${id}`).reduce((a, b) => sql`${a},${b}`)}]`})
    `));

    const outcomeByAction = new Map<string, { id: string; status: string }>();
    for (const row of outcomeRows as any[]) {
      outcomeByAction.set(row.gmail_action_id, { id: row.id, status: row.outcome_status ?? "sent" });
    }

    for (const evt of evtRows as any[]) {
      const targetStatus = OUTCOME_TO_STATUS[evt.outcome_type];
      if (!targetStatus) continue;
      const existing = outcomeByAction.get(evt.action_id);
      if (!existing) continue;

      const currentRank = STATUS_RANK[existing.status] ?? 0;
      const targetRank = STATUS_RANK[targetStatus] ?? 0;
      if (targetRank <= currentRank) continue; // never downgrade

      try {
        await db.execute(sql`
          UPDATE agent_communication_outcomes
          SET outcome_status = ${targetStatus}, updated_at = now()
          WHERE id = ${existing.id}
        `);
        existing.status = targetStatus; // update in-map for subsequent events
        updated++;
      } catch { /* skip if update fails */ }
    }
  } catch (err: any) {
    console.warn("[agentmail-outcome-sync] syncOutcomeStatuses error:", err.message);
  }
  return updated;
}

// ─── Learning performance signal for CEO heartbeat ────────────────────────────

export async function getAgentmailOutcomeLearningSignal(orgId: string): Promise<{
  summary: string;
  details: string[];
  hasIssues: boolean;
} | null> {
  try {
    if (!(await tableExists())) return null;

    // Count rules needing review via rule application stats
    const ruleRows = rows(await db.execute(sql`
      SELECT
        ra.rule_id,
        COUNT(*)::int AS times_applied,
        COUNT(CASE WHEN f.decision = 'rejected' THEN 1 END)::int AS rejections,
        COUNT(CASE WHEN f.decision = 'approved' THEN 1 END)::int AS approvals
      FROM agentmail_rule_applications ra
      JOIN gmail_agent_actions g ON g.id = ra.action_id
      LEFT JOIN agent_message_feedback f ON f.proposal_id = ra.action_id
      WHERE ra.org_id = ${orgId}
      GROUP BY ra.rule_id
      HAVING COUNT(*) >= 10
    `));

    const needsReviewRules = (ruleRows as any[]).filter((r) => {
      const total = r.times_applied;
      const rejectPct = total > 0 ? (r.rejections / total) * 100 : 0;
      const approvePct = total > 0 ? (r.approvals / total) * 100 : 0;
      return rejectPct >= 50 || approvePct < 30;
    });

    // Count outcome events in last 30 days
    const outcomeCount = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM agentmail_outcome_events
      WHERE org_id = ${orgId} AND created_at >= now() - interval '30 days'
    `));
    const totalOutcomes = Number((outcomeCount as any[])[0]?.cnt ?? 0);

    const details: string[] = [];
    let hasIssues = false;

    if (needsReviewRules.length > 0) {
      details.push(`${needsReviewRules.length} learned rule${needsReviewRules.length === 1 ? "" : "s"} associated with repeated rejections — review AgentMail Learning Center`);
      hasIssues = true;
    }

    if (totalOutcomes > 0) {
      details.push(`AgentMail outcome correlation: ${totalOutcomes} events tracked in last 30 days`);
    }

    if (details.length === 0) return null;

    const summary = hasIssues
      ? `AgentMail Learning: ${needsReviewRules.length} rule${needsReviewRules.length === 1 ? "" : "s"} need${needsReviewRules.length === 1 ? "s" : ""} review — associated with high rejection rates`
      : `AgentMail Learning: ${totalOutcomes} outcome events correlated — rules performing well`;

    return { summary, details, hasIssues };
  } catch {
    return null;
  }
}

// ─── Outcome summary ───────────────────────────────────────────────────────────

const DOMAIN_LABELS: Record<string, string> = {
  athlete_lead: "Athlete Leads", parent_lead: "Parent Leads",
  evaluation_scheduling: "Evaluation Scheduling", onboarding: "Onboarding",
  re_engagement: "Re-engagement", payment_recovery: "Payment Recovery",
  team_training: "Team Training", gym_owner: "Gym Owner", general: "General",
};

export async function getOutcomeSummary(opts: {
  orgId: string;
  range?: string;
  domain?: string;
}): Promise<{
  totals: Record<string, number>;
  byDomain: Array<{ domain: string; label: string; counts: Record<string, number>; sentCount: number }>;
  byOutcomeType: Array<{ outcomeType: string; label: string; count: number; rate: number }>;
  byRule: Array<{ ruleId: string; ruleSource: string; ruleText: string; timesApplied: number; associatedOutcomes: number; topOutcomeType: string | null }>;
  recentEvents: Array<Record<string, unknown>>;
  sentCount: number;
  lastRecomputedAt: string | null;
  dataAvailable: boolean;
}> {
  const EMPTY = { totals: {}, byDomain: [], byOutcomeType: [], byRule: [], recentEvents: [], sentCount: 0, lastRecomputedAt: null, dataAvailable: false };

  try {
    if (!(await tableExists())) return EMPTY;

    const days = ({ "7d": 7, "30d": 30, "90d": 90 }[opts.range ?? "30d"]) ?? 30;
    const since = new Date(Date.now() - days * 86_400_000);
    const domainFilter = opts.domain && opts.domain !== "all" ? opts.domain : null;

    // Sent count
    const sentRes = rows(await db.execute(sql`
      SELECT COUNT(DISTINCT id)::int as cnt FROM gmail_agent_actions
      WHERE org_id = ${opts.orgId} AND status IN ('approved','executed','sent') AND created_at >= ${since}
      ${domainFilter ? sql`AND communication_domain = ${domainFilter}` : sql``}
    `));
    const sentCount = Number(sentRes[0]?.cnt ?? 0);

    // Outcome events
    const evtRes = rows(await db.execute(sql`
      SELECT outcome_type, communication_domain, action_id,
             related_entity_type, related_entity_id, outcome_value,
             detected_at, recipient_email
      FROM agentmail_outcome_events
      WHERE org_id = ${opts.orgId} AND created_at >= ${since}
      ${domainFilter ? sql`AND communication_domain = ${domainFilter}` : sql``}
      ORDER BY detected_at DESC LIMIT 500
    `));

    if (evtRes.length === 0 && sentCount === 0) return EMPTY;

    // Unique action_ids per outcome_type
    const byType: Record<string, Set<string>> = {};
    for (const e of evtRes) {
      if (!byType[e.outcome_type]) byType[e.outcome_type] = new Set();
      byType[e.outcome_type].add(e.action_id);
    }

    const totals: Record<string, number> = {
      sentMessages: sentCount,
      replies: byType["reply_received"]?.size ?? 0,
      evaluationsScheduled: byType["evaluation_scheduled"]?.size ?? 0,
      evaluationsCompleted: byType["evaluation_completed"]?.size ?? 0,
      conversions: byType["lead_converted"]?.size ?? 0,
      firstSessionsScheduled: byType["first_session_scheduled"]?.size ?? 0,
      programsAssigned: byType["program_assigned"]?.size ?? 0,
      paymentsRecovered: byType["payment_recovered"]?.size ?? 0,
      bookingsCreated: byType["booking_created"]?.size ?? 0,
    };

    const byOutcomeType = AGENTMAIL_OUTCOME_TYPES.map((type) => ({
      outcomeType: type,
      label: getOutcomeLabel(type),
      count: byType[type]?.size ?? 0,
      rate: sentCount > 0 ? Math.round(((byType[type]?.size ?? 0) / sentCount) * 100) : 0,
    }));

    // By domain
    const domEvts: Record<string, any[]> = {};
    for (const e of evtRes) {
      const d = e.communication_domain ?? "general";
      if (!domEvts[d]) domEvts[d] = [];
      domEvts[d].push(e);
    }
    const domSentRes = rows(await db.execute(sql`
      SELECT communication_domain, COUNT(DISTINCT id)::int as cnt
      FROM gmail_agent_actions
      WHERE org_id = ${opts.orgId} AND status IN ('approved','executed','sent') AND created_at >= ${since}
      GROUP BY communication_domain
    `));
    const domSentMap: Record<string, number> = {};
    for (const r of domSentRes) domSentMap[r.communication_domain ?? "general"] = Number(r.cnt);

    const allDomains = new Set([...Object.keys(domEvts), ...Object.keys(domSentMap)]);
    const byDomain = Array.from(allDomains).map((d) => {
      const counts: Record<string, number> = {};
      for (const e of domEvts[d] ?? []) counts[e.outcome_type] = (counts[e.outcome_type] ?? 0) + 1;
      return { domain: d, label: DOMAIN_LABELS[d] ?? d, counts, sentCount: domSentMap[d] ?? 0 };
    }).filter((x) => x.sentCount > 0 || Object.keys(x.counts).length > 0);

    // By rule (raw SQL join on agentmail_rule_applications)
    let byRule: any[] = [];
    try {
      const ruleRes = rows(await db.execute(sql`
        SELECT
          ara.rule_id,
          ara.rule_source,
          ara.rule_text,
          COUNT(DISTINCT ara.action_id)::int as times_applied,
          COUNT(DISTINCT oe.action_id)::int as associated_outcomes
        FROM agentmail_rule_applications ara
        LEFT JOIN agentmail_outcome_events oe
          ON oe.action_id = ara.action_id AND oe.org_id = ${opts.orgId}
        WHERE ara.org_id = ${opts.orgId}
        GROUP BY ara.rule_id, ara.rule_source, ara.rule_text
        ORDER BY times_applied DESC
        LIMIT 20
      `));
      byRule = ruleRes.map((r: any) => ({
        ruleId: r.rule_id,
        ruleSource: r.rule_source,
        ruleText: r.rule_text ?? "(no text)",
        timesApplied: Number(r.times_applied),
        associatedOutcomes: Number(r.associated_outcomes),
        topOutcomeType: null,
      }));
    } catch {}

    // Recent events
    const recentEvents = evtRes.slice(0, 20).map((e: any) => ({
      outcomeType: e.outcome_type,
      label: getOutcomeLabel(e.outcome_type),
      communicationDomain: e.communication_domain,
      recipientEmail: e.recipient_email,
      actionId: e.action_id,
      detectedAt: e.detected_at,
    }));

    // Last recomputed
    const lastRes = rows(await db.execute(sql`
      SELECT MAX(created_at) as last FROM agentmail_outcome_events WHERE org_id = ${opts.orgId}
    `));
    const lastRecomputedAt = lastRes[0]?.last ? new Date(lastRes[0].last).toISOString() : null;

    return { totals, byDomain, byOutcomeType, byRule, recentEvents, sentCount, lastRecomputedAt, dataAvailable: evtRes.length > 0 || sentCount > 0 };
  } catch {
    return EMPTY;
  }
}

// ─── CEO Heartbeat signal ──────────────────────────────────────────────────────

export async function getAgentmailOutcomeHeartbeatSignal(orgId: string): Promise<{
  summary: string;
  details: string[];
  hasIssues: boolean;
} | null> {
  try {
    if (!(await tableExists())) return null;

    const since = new Date(Date.now() - 30 * 86_400_000);

    const typeRes = rows(await db.execute(sql`
      SELECT outcome_type, COUNT(DISTINCT action_id)::int as cnt
      FROM agentmail_outcome_events
      WHERE org_id = ${orgId} AND created_at >= ${since}
      GROUP BY outcome_type
    `));

    const sentRes = rows(await db.execute(sql`
      SELECT COUNT(DISTINCT id)::int as cnt FROM gmail_agent_actions
      WHERE org_id = ${orgId} AND status IN ('approved','executed','sent') AND created_at >= ${since}
    `));

    const sent = Number(sentRes[0]?.cnt ?? 0);
    if (sent === 0) return null;

    const counts: Record<string, number> = {};
    for (const r of typeRes) counts[r.outcome_type] = Number(r.cnt);

    const replies = counts["reply_received"] ?? 0;
    const conversions = counts["lead_converted"] ?? 0;
    const evaluations = counts["evaluation_scheduled"] ?? 0;
    const replyRate = Math.round((replies / sent) * 100);

    const details: string[] = [];
    if (replies > 0) details.push(`${replies} associated replies (${replyRate}% reply rate, last 30d)`);
    if (evaluations > 0) details.push(`${evaluations} evaluations scheduled after email`);
    if (conversions > 0) details.push(`${conversions} lead conversions associated with emails`);
    if (counts["payment_recovered"]) details.push(`${counts["payment_recovered"]} payment recovery outcomes`);
    if (details.length === 0) details.push(`${sent} emails sent — no outcomes correlated yet`);

    const hasIssues = sent >= 10 && replyRate < 5;

    const summary = conversions > 0
      ? `AgentMail associated with ${conversions} conversion${conversions !== 1 ? "s" : ""} in 30d (${replyRate}% reply rate)`
      : replies > 0
        ? `AgentMail: ${replies} replies from ${sent} emails (${replyRate}% rate) — no conversions yet`
        : `AgentMail: ${sent} emails sent — outcomes being tracked`;

    return { summary, details, hasIssues };
  } catch {
    return null;
  }
}
