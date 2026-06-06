/**
 * Communication Intelligence Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only intelligence layer aggregating signals from every communication
 * channel and system.  No sends, approvals, or mutations of any kind.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  return (r as any)?.rows ?? [];
}

async function safeQuery(q: string, fallback: any[] = []): Promise<any[]> {
  try {
    return rows(await db.execute(sql.raw(q)));
  } catch {
    return fallback;
  }
}

function esc(s: string) {
  return s.replace(/'/g, "''");
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export async function getCommunicationOverview(orgId: string) {
  const o = esc(orgId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [auditStats, gmailPending, agentmailPending, followupPending,
         attentionActive, triggerBlocked, triggerSent] = await Promise.all([
    // outbound_email_audit_log — today's sends/blocks/fails
    safeQuery(`
      SELECT
        COUNT(*)                                    AS total_outbound,
        COUNT(*) FILTER (WHERE status = 'sent')    AS sent_today,
        COUNT(*) FILTER (WHERE status = 'blocked') AS blocked_today,
        COUNT(*) FILTER (WHERE status = 'failed')  AS failed_today,
        COUNT(*) FILTER (WHERE status = 'draft_created') AS drafts_today
      FROM outbound_email_audit_log
      WHERE organization_id = '${o}' AND created_at >= '${todayIso}'
    `),
    // gmail pending approvals
    safeQuery(`
      SELECT COUNT(*)::int AS cnt FROM gmail_agent_actions
      WHERE org_id = '${o}' AND status = 'proposed' AND approval_required = true
    `),
    // agentmail reply queue pending
    safeQuery(`
      SELECT COUNT(*)::int AS cnt FROM agent_mail_reply_queue
      WHERE organization_id = '${o}' AND approval_status = 'pending_review'
    `),
    // email_follow_ups pending
    safeQuery(`
      SELECT COUNT(*)::int AS cnt FROM email_follow_ups
      WHERE org_id = '${o}' AND status = 'pending'
    `),
    // attention_items active
    safeQuery(`
      SELECT COUNT(*)::int AS cnt FROM attention_items
      WHERE org_id = '${o}' AND status = 'active'
    `),
    // trigger events blocked in last 24h
    safeQuery(`
      SELECT COUNT(*)::int AS cnt FROM email_trigger_events
      WHERE organization_id = '${o}' AND execution_blocked = true
        AND created_at >= NOW() - INTERVAL '24 hours'
    `),
    // trigger events sent in last 24h
    safeQuery(`
      SELECT COUNT(*)::int AS cnt FROM email_trigger_events
      WHERE organization_id = '${o}' AND was_executed = true
        AND created_at >= NOW() - INTERVAL '24 hours'
    `),
  ]);

  const audit = auditStats[0] ?? {};
  const pendingApprovals = (gmailPending[0]?.cnt ?? 0) + (agentmailPending[0]?.cnt ?? 0) + (followupPending[0]?.cnt ?? 0);

  return {
    totalOutboundToday: Number(audit.total_outbound ?? 0),
    sentToday: Number(audit.sent_today ?? 0),
    blockedToday: Number(audit.blocked_today ?? 0),
    failedToday: Number(audit.failed_today ?? 0),
    draftsCreatedToday: Number(audit.drafts_today ?? 0),
    pendingApprovals,
    gmailPendingApprovals: gmailPending[0]?.cnt ?? 0,
    agentmailPendingApprovals: agentmailPending[0]?.cnt ?? 0,
    followupPendingApprovals: followupPending[0]?.cnt ?? 0,
    activeAttentionItems: attentionActive[0]?.cnt ?? 0,
    triggersBlockedLast24h: triggerBlocked[0]?.cnt ?? 0,
    triggersSentLast24h: triggerSent[0]?.cnt ?? 0,
  };
}

// ─── Channel Performance ───────────────────────────────────────────────────────

export async function getChannelPerformance(orgId: string) {
  const o = esc(orgId);
  const [auditChannels, agentmailInbound, agentmailReplies, gmailActions, commLogs] = await Promise.all([
    safeQuery(`
      SELECT
        channel,
        COUNT(*)                                    AS total,
        COUNT(*) FILTER (WHERE status = 'sent')    AS sent,
        COUNT(*) FILTER (WHERE status = 'blocked') AS blocked,
        COUNT(*) FILTER (WHERE status = 'failed')  AS failed,
        COUNT(*) FILTER (WHERE status = 'draft_created') AS drafts,
        COUNT(*) FILTER (WHERE approval_required = true) AS required_approval,
        COUNT(*) FILTER (WHERE approval_status = 'approved') AS approved
      FROM outbound_email_audit_log
      WHERE organization_id = '${o}'
        AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY channel
    `),
    safeQuery(`
      SELECT COUNT(*)::int AS cnt FROM agent_mail_inbound_messages
      WHERE organization_id = '${o}' AND received_at >= NOW() - INTERVAL '7 days'
    `),
    safeQuery(`
      SELECT
        COUNT(*)::int                                                    AS total,
        COUNT(*) FILTER (WHERE approval_status = 'approved')::int       AS approved,
        COUNT(*) FILTER (WHERE approval_status = 'pending_review')::int AS pending,
        COUNT(*) FILTER (WHERE approval_status = 'rejected')::int       AS rejected
      FROM agent_mail_reply_queue
      WHERE organization_id = '${o}' AND created_at >= NOW() - INTERVAL '7 days'
    `),
    safeQuery(`
      SELECT
        COUNT(*)::int                                                  AS total,
        COUNT(*) FILTER (WHERE status = 'executed')::int              AS executed,
        COUNT(*) FILTER (WHERE status = 'proposed')::int              AS proposed,
        COUNT(*) FILTER (WHERE status = 'rejected')::int              AS rejected
      FROM gmail_agent_actions
      WHERE org_id = '${o}' AND created_at >= NOW() - INTERVAL '7 days'
    `),
    safeQuery(`
      SELECT
        channel,
        COUNT(*)::int                                                   AS total,
        COUNT(*) FILTER (WHERE status = 'sent')::int                   AS sent,
        COUNT(*) FILTER (WHERE status = 'failed')::int                 AS failed
      FROM communication_logs
      WHERE org_id = '${o}' AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY channel
    `),
  ]);

  const byChannel: Record<string, any> = {};
  for (const row of auditChannels) {
    byChannel[row.channel] = {
      channel: row.channel,
      outbound: Number(row.total ?? 0),
      sent: Number(row.sent ?? 0),
      blocked: Number(row.blocked ?? 0),
      failed: Number(row.failed ?? 0),
      drafts: Number(row.drafts ?? 0),
      approvalRequired: Number(row.required_approval ?? 0),
      approved: Number(row.approved ?? 0),
      approvalRate: row.required_approval > 0
        ? Math.round((Number(row.approved) / Number(row.required_approval)) * 100)
        : 0,
      blockRate: row.total > 0
        ? Math.round((Number(row.blocked) / Number(row.total)) * 100)
        : 0,
      failRate: row.total > 0
        ? Math.round((Number(row.failed) / Number(row.total)) * 100)
        : 0,
    };
  }

  const am = agentmailReplies[0] ?? {};
  const gmail = gmailActions[0] ?? {};

  return {
    byChannel,
    agentmail: {
      inbound7d: agentmailInbound[0]?.cnt ?? 0,
      replyQueueTotal: Number(am.total ?? 0),
      replyQueueApproved: Number(am.approved ?? 0),
      replyQueuePending: Number(am.pending ?? 0),
      replyQueueRejected: Number(am.rejected ?? 0),
    },
    gmail: {
      actionsTotal: Number(gmail.total ?? 0),
      actionsExecuted: Number(gmail.executed ?? 0),
      actionsProposed: Number(gmail.proposed ?? 0),
      actionsRejected: Number(gmail.rejected ?? 0),
    },
    sendgrid: {
      ...(commLogs.find((r) => r.channel === "email") ?? { sent: 0, failed: 0, total: 0 }),
    },
  };
}

// ─── Conversation Health ───────────────────────────────────────────────────────

export async function getConversationHealth(orgId: string) {
  const o = esc(orgId);
  const [prospects, agentOutcomes, inboundMsgs] = await Promise.all([
    safeQuery(`
      SELECT
        outreach_status,
        COUNT(*)::int AS cnt,
        COUNT(*) FILTER (WHERE last_contacted_at IS NULL)::int AS never_contacted,
        COUNT(*) FILTER (WHERE last_contacted_at < NOW() - INTERVAL '7 days')::int AS stale_7d,
        COUNT(*) FILTER (WHERE last_contacted_at < NOW() - INTERVAL '14 days')::int AS stale_14d
      FROM team_training_prospects
      WHERE org_id = '${o}'
      GROUP BY outreach_status
    `),
    safeQuery(`
      SELECT
        outcome_status,
        communication_domain,
        COUNT(*)::int AS cnt,
        AVG(EXTRACT(EPOCH FROM (replied_at - sent_at))/3600)::numeric(8,1) AS avg_hours_to_reply
      FROM agent_communication_outcomes
      WHERE org_id = '${o}'
      GROUP BY outcome_status, communication_domain
    `),
    safeQuery(`
      SELECT
        classification,
        COUNT(*)::int AS cnt
      FROM agent_mail_inbound_messages
      WHERE organization_id = '${o}' AND received_at >= NOW() - INTERVAL '30 days'
      GROUP BY classification
    `),
  ]);

  const statusMap: Record<string, number> = {};
  let neverContacted = 0;
  let stale7d = 0;
  let stale14d = 0;
  for (const r of prospects) {
    statusMap[r.outreach_status] = r.cnt;
    neverContacted += Number(r.never_contacted ?? 0);
    stale7d += Number(r.stale_7d ?? 0);
    stale14d += Number(r.stale_14d ?? 0);
  }

  const replied = agentOutcomes.filter((r) => ["replied", "meeting_booked", "converted"].includes(r.outcome_status));
  const totalOutcomes = agentOutcomes.reduce((s: number, r: any) => s + Number(r.cnt), 0);
  const positiveOutcomes = replied.reduce((s: number, r: any) => s + Number(r.cnt), 0);
  const healthScore = totalOutcomes > 0 ? Math.round((positiveOutcomes / totalOutcomes) * 100) : 50;

  const inboundByClass: Record<string, number> = {};
  for (const r of inboundMsgs) {
    inboundByClass[r.classification ?? "unknown"] = r.cnt;
  }

  return {
    healthScore,
    prospectsNeverContacted: neverContacted,
    prospectsStale7d: stale7d,
    prospectsStale14d: stale14d,
    prospectsByStatus: statusMap,
    outcomesByStatus: agentOutcomes.map((r: any) => ({
      status: r.outcome_status,
      domain: r.communication_domain,
      count: Number(r.cnt),
      avgHoursToReply: Number(r.avg_hours_to_reply ?? 0),
    })),
    inboundByClassification: inboundByClass,
    healthy: Math.max(0, healthScore - 30),
    atRisk: healthScore < 60 ? 1 : 0,
  };
}

// ─── Approval Metrics ─────────────────────────────────────────────────────────

export async function getApprovalMetrics(orgId: string) {
  const o = esc(orgId);
  const [gmailApprovals, agentmailApprovals, followupApprovals, feedbackStats] = await Promise.all([
    safeQuery(`
      SELECT
        status,
        approval_required,
        COUNT(*)::int AS cnt,
        AVG(EXTRACT(EPOCH FROM (executed_at - created_at))/3600)::numeric(8,1) AS avg_hours_to_approve,
        communication_domain
      FROM gmail_agent_actions
      WHERE org_id = '${o}'
      GROUP BY status, approval_required, communication_domain
    `),
    safeQuery(`
      SELECT
        approval_status,
        COUNT(*)::int AS cnt,
        AVG(EXTRACT(EPOCH FROM (NOW() - created_at))/3600)::numeric(8,1) AS avg_age_hours
      FROM agent_mail_reply_queue
      WHERE organization_id = '${o}'
      GROUP BY approval_status
    `),
    safeQuery(`
      SELECT
        status,
        COUNT(*)::int AS cnt,
        COUNT(*) FILTER (WHERE scheduled_for < NOW() AND status = 'pending')::int AS overdue
      FROM email_follow_ups
      WHERE org_id = '${o}'
      GROUP BY status
    `),
    safeQuery(`
      SELECT
        decision,
        COUNT(*)::int AS cnt,
        AVG(quality_rating)::numeric(4,2) AS avg_quality
      FROM agent_message_feedback
      WHERE org_id = '${o}' AND reviewed_at >= NOW() - INTERVAL '30 days'
      GROUP BY decision
    `),
  ]);

  const gmailProposed = gmailApprovals.filter((r: any) => r.status === "proposed");
  const gmailPending = gmailProposed.reduce((s: number, r: any) => s + Number(r.cnt), 0);
  const amPending = agentmailApprovals.find((r: any) => r.approval_status === "pending_review")?.cnt ?? 0;
  const followupOverdue = followupApprovals.reduce((s: number, r: any) => s + Number(r.overdue ?? 0), 0);

  const approvedFeedback = feedbackStats.find((r: any) => r.decision === "approved")?.cnt ?? 0;
  const rejectedFeedback = feedbackStats.find((r: any) => r.decision === "rejected")?.cnt ?? 0;
  const editedFeedback = feedbackStats.find((r: any) => r.decision === "edited_and_approved")?.cnt ?? 0;
  const totalFeedback = Number(approvedFeedback) + Number(rejectedFeedback) + Number(editedFeedback);
  const approvalRate30d = totalFeedback > 0 ? Math.round(((Number(approvedFeedback) + Number(editedFeedback)) / totalFeedback) * 100) : 0;
  const avgQuality = feedbackStats.reduce((s: number, r: any) => s + Number(r.avg_quality ?? 0), 0) / Math.max(feedbackStats.length, 1);

  const amAvgAge = agentmailApprovals.find((r: any) => r.approval_status === "pending_review")?.avg_age_hours ?? 0;
  const gmailAvgHours = gmailApprovals.find((r: any) => r.status === "executed")?.avg_hours_to_approve ?? 0;

  return {
    totalPending: gmailPending + Number(amPending),
    gmailPending,
    agentmailPending: Number(amPending),
    followupOverdue,
    approvalRate30d,
    avgQualityScore: Math.round(Number(avgQuality) * 20),
    avgGmailApprovalHours: Number(gmailAvgHours),
    avgAgentmailAgeHours: Number(amAvgAge),
    approvedLast30d: Number(approvedFeedback) + Number(editedFeedback),
    rejectedLast30d: Number(rejectedFeedback),
    bottleneckRisk: (gmailPending + Number(amPending)) > 20 ? "high" :
                    (gmailPending + Number(amPending)) > 10 ? "medium" : "low",
    gmailByDomain: gmailApprovals.reduce((acc: any, r: any) => {
      const key = r.communication_domain ?? "unknown";
      if (!acc[key]) acc[key] = { pending: 0, executed: 0 };
      if (r.status === "proposed") acc[key].pending += Number(r.cnt);
      if (r.status === "executed") acc[key].executed += Number(r.cnt);
      return acc;
    }, {}),
  };
}

// ─── Response Metrics ─────────────────────────────────────────────────────────

export async function getResponseMetrics(orgId: string) {
  const o = esc(orgId);
  const [variants, outreachDrafts, triggerStats] = await Promise.all([
    safeQuery(`
      SELECT name, times_used, replies, conversions, performance_score
      FROM email_message_variants
      WHERE org_id = '${o}' AND active = true
      ORDER BY performance_score DESC LIMIT 5
    `),
    safeQuery(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE approved = true)::int AS approved,
        COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,
        COUNT(*) FILTER (WHERE response_received = true)::int AS replied,
        COUNT(*) FILTER (WHERE meeting_booked = true)::int AS meetings
      FROM team_training_outreach_drafts
      WHERE org_id = '${o}'
    `),
    safeQuery(`
      SELECT
        trigger_type,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE was_executed = true)::int AS executed,
        COUNT(*) FILTER (WHERE execution_blocked = true)::int AS blocked,
        COUNT(*) FILTER (WHERE missed_opportunity = true)::int AS missed
      FROM email_trigger_events
      WHERE organization_id = '${o}' AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY trigger_type
    `),
  ]);

  const drafts = outreachDrafts[0] ?? {};
  const total = Number(drafts.total ?? 0);
  const replied = Number(drafts.replied ?? 0);
  const sent = Number(drafts.sent ?? 0);

  return {
    responseRate: sent > 0 ? Math.round((replied / sent) * 100) : 0,
    meetingRate: sent > 0 ? Math.round((Number(drafts.meetings ?? 0) / sent) * 100) : 0,
    approvalRate: total > 0 ? Math.round((Number(drafts.approved ?? 0) / total) * 100) : 0,
    totalDrafts: total,
    totalSent: sent,
    totalReplied: replied,
    totalMeetings: Number(drafts.meetings ?? 0),
    topVariants: variants.map((v: any) => ({
      name: v.name,
      used: v.times_used ?? 0,
      replies: v.replies ?? 0,
      conversions: v.conversions ?? 0,
      score: v.performance_score ?? 50,
    })),
    triggersByType: triggerStats.map((r: any) => ({
      type: r.trigger_type,
      total: r.total,
      executed: r.executed,
      blocked: r.blocked,
      missed: r.missed,
    })),
  };
}

// ─── Lead Communication Metrics ───────────────────────────────────────────────

export async function getLeadCommunicationMetrics(orgId: string) {
  const o = esc(orgId);
  const [prospects, intel, followups] = await Promise.all([
    safeQuery(`
      SELECT
        outreach_status,
        COUNT(*)::int AS cnt,
        COUNT(*) FILTER (WHERE outreach_status = 'Replied')::int AS replied,
        COUNT(*) FILTER (WHERE last_contacted_at IS NOT NULL AND last_contacted_at >= NOW() - INTERVAL '7 days')::int AS active_7d
      FROM team_training_prospects
      WHERE org_id = '${o}'
      GROUP BY outreach_status
    `),
    safeQuery(`
      SELECT pipeline_stage, COUNT(*)::int AS cnt
      FROM lead_intelligence_profiles
      WHERE org_id = '${o}'
      GROUP BY pipeline_stage
    `),
    safeQuery(`
      SELECT
        status,
        COUNT(*)::int AS cnt
      FROM email_follow_ups
      WHERE org_id = '${o}'
      GROUP BY status
    `),
  ]);

  const totalProspects = prospects.reduce((s: number, r: any) => s + Number(r.cnt), 0);
  const contacted = prospects.filter((r: any) => !["New", "Needs Review"].includes(r.outreach_status))
    .reduce((s: number, r: any) => s + Number(r.cnt), 0);
  const replied = prospects.filter((r: any) => r.outreach_status === "Replied")
    .reduce((s: number, r: any) => s + Number(r.cnt), 0);
  const active7d = prospects.reduce((s: number, r: any) => s + Number(r.active_7d ?? 0), 0);

  const byStage: Record<string, number> = {};
  for (const r of intel) byStage[r.pipeline_stage] = r.cnt;

  const followupPending = followups.find((r: any) => r.status === "pending")?.cnt ?? 0;
  const followupSent = followups.find((r: any) => r.status === "sent")?.cnt ?? 0;

  return {
    totalProspects,
    contacted,
    replied,
    active7d,
    highIntent: prospects.find((r: any) => r.outreach_status === "Replied")?.cnt ?? 0,
    responseRate: contacted > 0 ? Math.round((replied / contacted) * 100) : 0,
    byStage,
    followupPending: Number(followupPending),
    followupSent: Number(followupSent),
    prospectsByStatus: prospects.reduce((acc: any, r: any) => {
      acc[r.outreach_status] = r.cnt;
      return acc;
    }, {}),
  };
}

// ─── Hiring Communication Metrics ─────────────────────────────────────────────

export async function getHiringCommunicationMetrics(orgId: string) {
  const o = esc(orgId);
  const [applicants, outcomes] = await Promise.all([
    safeQuery(`
      SELECT
        status,
        COUNT(*)::int AS cnt,
        AVG(EXTRACT(EPOCH FROM (NOW() - created_at))/86400)::numeric(6,1) AS avg_age_days
      FROM employment_applicants
      WHERE org_id = '${o}'
      GROUP BY status
    `),
    safeQuery(`
      SELECT outcome_status, COUNT(*)::int AS cnt
      FROM agent_communication_outcomes
      WHERE org_id = '${o}' AND communication_domain = 'employment'
      GROUP BY outcome_status
    `),
  ]);

  const total = applicants.reduce((s: number, r: any) => s + Number(r.cnt), 0);
  const active = applicants.filter((r: any) => !["hired", "rejected", "withdrawn"].includes(r.status))
    .reduce((s: number, r: any) => s + Number(r.cnt), 0);
  const hired = applicants.find((r: any) => r.status === "hired")?.cnt ?? 0;
  const interviewing = applicants.find((r: any) => r.status === "interviewing")?.cnt ?? 0;

  const replied = outcomes.find((r: any) => r.outcome_status === "replied")?.cnt ?? 0;
  const totalOutcomes = outcomes.reduce((s: number, r: any) => s + Number(r.cnt), 0);

  return {
    totalApplicants: total,
    activeApplicants: active,
    hired: Number(hired),
    interviewing: Number(interviewing),
    waitingOnCandidate: applicants.find((r: any) => r.status === "awaiting_reply")?.cnt ?? 0,
    waitingOnInternal: applicants.find((r: any) => r.status === "under_review")?.cnt ?? 0,
    candidateResponseRate: totalOutcomes > 0 ? Math.round((Number(replied) / totalOutcomes) * 100) : 0,
    byStatus: applicants.reduce((acc: any, r: any) => {
      acc[r.status] = { count: r.cnt, avgAgeDays: Number(r.avg_age_days ?? 0) };
      return acc;
    }, {}),
  };
}

// ─── Support Communication Metrics ────────────────────────────────────────────

export async function getSupportCommunicationMetrics(orgId: string) {
  const o = esc(orgId);
  const [attentionByCategory, outcomes] = await Promise.all([
    safeQuery(`
      SELECT
        category,
        level,
        COUNT(*)::int AS cnt,
        COUNT(*) FILTER (WHERE status = 'active')::int AS open,
        AVG(EXTRACT(EPOCH FROM (NOW() - created_at))/3600)::numeric(8,1) AS avg_age_hours
      FROM attention_items
      WHERE org_id = '${o}'
      GROUP BY category, level
    `),
    safeQuery(`
      SELECT outcome_status, COUNT(*)::int AS cnt
      FROM agent_communication_outcomes
      WHERE org_id = '${o}' AND communication_domain = 'support'
      GROUP BY outcome_status
    `),
  ]);

  const total = attentionByCategory.reduce((s: number, r: any) => s + Number(r.open ?? 0), 0);
  const escalated = attentionByCategory.filter((r: any) => r.level === "urgent" || r.level === "critical")
    .reduce((s: number, r: any) => s + Number(r.open ?? 0), 0);

  return {
    openIssues: total,
    escalated,
    byCategory: attentionByCategory.reduce((acc: any, r: any) => {
      const key = r.category;
      if (!acc[key]) acc[key] = { open: 0, total: 0, avgAgeHours: 0 };
      acc[key].open += Number(r.open ?? 0);
      acc[key].total += Number(r.cnt ?? 0);
      acc[key].avgAgeHours = Number(r.avg_age_hours ?? 0);
      return acc;
    }, {}),
    outcomesByStatus: outcomes.reduce((acc: any, r: any) => {
      acc[r.outcome_status] = r.cnt;
      return acc;
    }, {}),
  };
}

// ─── Revenue Communication Metrics ────────────────────────────────────────────

export async function getRevenueCommunicationMetrics(orgId: string) {
  const o = esc(orgId);
  const [revenueEvents, outcomes, deals] = await Promise.all([
    safeQuery(`
      SELECT
        outcome_status,
        action_type,
        COUNT(*)::int AS cnt,
        SUM(credited_value)::int AS total_credited
      FROM ai_revenue_events
      WHERE org_id = '${o}'
      GROUP BY outcome_status, action_type
    `),
    safeQuery(`
      SELECT
        outcome_status,
        COUNT(*)::int AS cnt,
        SUM(revenue_cents)::int AS total_revenue
      FROM agent_communication_outcomes
      WHERE org_id = '${o}'
      GROUP BY outcome_status
    `),
    safeQuery(`
      SELECT
        status,
        COUNT(*)::int AS cnt,
        SUM(value)::int AS pipeline_value
      FROM team_training_deals
      WHERE organization_id = '${o}'
      GROUP BY status
    `),
  ]);

  const totalCredited = revenueEvents.reduce((s: number, r: any) => s + Number(r.total_credited ?? 0), 0);
  const won = deals.find((r: any) => r.status === "Won")?.cnt ?? 0;
  const open = deals.filter((r: any) => !["Won", "Lost"].includes(r.status))
    .reduce((s: number, r: any) => s + Number(r.cnt), 0);
  const pipelineValue = deals.reduce((s: number, r: any) => s + Number(r.pipeline_value ?? 0), 0);
  const revenueFromComms = outcomes.reduce((s: number, r: any) => s + Number(r.total_revenue ?? 0), 0);

  return {
    totalAiCreditedValue: totalCredited,
    totalRevenueCents: revenueFromComms,
    openDeals: open,
    wonDeals: Number(won),
    pipelineValue,
    byOutcomeStatus: outcomes.map((r: any) => ({
      status: r.outcome_status,
      count: r.cnt,
      revenueCents: r.total_revenue ?? 0,
    })),
    byActionType: revenueEvents.map((r: any) => ({
      actionType: r.action_type,
      status: r.outcome_status,
      count: r.cnt,
      creditedValue: r.total_credited ?? 0,
    })),
    dealsByStatus: deals.reduce((acc: any, r: any) => {
      acc[r.status] = { count: r.cnt, value: r.pipeline_value ?? 0 };
      return acc;
    }, {}),
  };
}

// ─── Stalled Conversation Detection ───────────────────────────────────────────

export async function getStalledConversationMetrics(orgId: string) {
  const o = esc(orgId);
  const [stalledProspects, overdueFollowups, stalledApplicants, stalledGmail] = await Promise.all([
    safeQuery(`
      SELECT
        id, prospect_name, outreach_status, contact_email,
        last_contacted_at,
        EXTRACT(EPOCH FROM (NOW() - last_contacted_at))/86400 AS days_stale
      FROM team_training_prospects
      WHERE org_id = '${o}'
        AND outreach_status NOT IN ('Not Interested', 'Do Not Contact')
        AND (last_contacted_at < NOW() - INTERVAL '7 days' OR last_contacted_at IS NULL)
      ORDER BY last_contacted_at ASC NULLS FIRST
      LIMIT 20
    `),
    safeQuery(`
      SELECT
        f.id, f.prospect_id, f.status, f.scheduled_for, f.step_number,
        p.prospect_name, p.contact_email,
        EXTRACT(EPOCH FROM (NOW() - f.scheduled_for))/3600 AS hours_overdue
      FROM email_follow_ups f
      LEFT JOIN team_training_prospects p ON p.id = f.prospect_id
      WHERE f.org_id = '${o}' AND f.status = 'pending'
        AND f.scheduled_for < NOW() - INTERVAL '24 hours'
      ORDER BY f.scheduled_for ASC
      LIMIT 15
    `),
    safeQuery(`
      SELECT
        id,
        first_name || ' ' || last_name AS name,
        email, status, role_applied_for,
        EXTRACT(EPOCH FROM (NOW() - updated_at))/86400 AS days_stale
      FROM employment_applicants
      WHERE org_id = '${o}'
        AND status NOT IN ('hired', 'rejected', 'withdrawn')
        AND updated_at < NOW() - INTERVAL '7 days'
      ORDER BY updated_at ASC
      LIMIT 10
    `),
    safeQuery(`
      SELECT
        id, subject, recipient_email, status, created_at, communication_domain,
        EXTRACT(EPOCH FROM (NOW() - created_at))/3600 AS hours_waiting
      FROM gmail_agent_actions
      WHERE org_id = '${o}'
        AND status = 'proposed'
        AND approval_required = true
        AND created_at < NOW() - INTERVAL '24 hours'
      ORDER BY created_at ASC
      LIMIT 10
    `),
  ]);

  const queue: any[] = [
    ...stalledProspects.map((r: any) => ({
      id: r.id,
      contact: r.prospect_name ?? "Unknown",
      email: r.contact_email,
      type: "lead",
      domain: "sales",
      lastActivity: r.last_contacted_at,
      daysStale: Math.round(Number(r.days_stale ?? 99)),
      status: r.outreach_status,
      suggestedAction: "Send follow-up outreach",
      urgency: Number(r.days_stale ?? 99) > 14 ? "high" : "medium",
    })),
    ...overdueFollowups.map((r: any) => ({
      id: r.id,
      contact: r.prospect_name ?? "Unknown",
      email: r.contact_email,
      type: "follow_up",
      domain: "sales",
      lastActivity: r.scheduled_for,
      daysStale: Math.round(Number(r.hours_overdue ?? 0) / 24),
      status: "overdue",
      suggestedAction: `Review step ${r.step_number} follow-up`,
      urgency: Number(r.hours_overdue ?? 0) > 72 ? "high" : "medium",
    })),
    ...stalledApplicants.map((r: any) => ({
      id: r.id,
      contact: r.name ?? "Applicant",
      email: r.email,
      type: "applicant",
      domain: "hiring",
      lastActivity: null,
      daysStale: Math.round(Number(r.days_stale ?? 0)),
      status: r.status,
      suggestedAction: "Follow up with applicant",
      urgency: Number(r.days_stale ?? 0) > 14 ? "high" : "low",
    })),
    ...stalledGmail.map((r: any) => ({
      id: r.id,
      contact: r.recipient_email,
      email: r.recipient_email,
      type: "gmail_approval",
      domain: r.communication_domain ?? "general",
      lastActivity: r.created_at,
      daysStale: Math.round(Number(r.hours_waiting ?? 0) / 24),
      status: "awaiting_approval",
      suggestedAction: "Review and approve Gmail draft",
      urgency: Number(r.hours_waiting ?? 0) > 48 ? "high" : "medium",
    })),
  ];

  queue.sort((a, b) => {
    const urgencyScore = { high: 3, medium: 2, low: 1 };
    return (urgencyScore[b.urgency as keyof typeof urgencyScore] ?? 1) -
           (urgencyScore[a.urgency as keyof typeof urgencyScore] ?? 1);
  });

  return {
    totalStalled: queue.length,
    stalledLeads: stalledProspects.length,
    overdueFollowups: overdueFollowups.length,
    stalledApplicants: stalledApplicants.length,
    stalledGmailApprovals: stalledGmail.length,
    recoveryQueue: queue.slice(0, 30),
  };
}

// ─── Communication Risks ───────────────────────────────────────────────────────

export async function getCommunicationRisks(orgId: string) {
  const o = esc(orgId);
  const [blockedSpike, failedSpike, approvalBacklog, triggerFailures,
         duplicateAttempts, policyErrors] = await Promise.all([
    safeQuery(`
      SELECT
        DATE_TRUNC('hour', created_at) AS hour,
        COUNT(*)::int AS blocked_count
      FROM outbound_email_audit_log
      WHERE organization_id = '${o}'
        AND status = 'blocked'
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour DESC
    `),
    safeQuery(`
      SELECT
        DATE_TRUNC('hour', created_at) AS hour,
        COUNT(*)::int AS failed_count
      FROM outbound_email_audit_log
      WHERE organization_id = '${o}'
        AND status = 'failed'
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour DESC
    `),
    safeQuery(`
      SELECT COUNT(*)::int AS cnt FROM gmail_agent_actions
      WHERE org_id = '${o}' AND status = 'proposed' AND approval_required = true
        AND created_at < NOW() - INTERVAL '48 hours'
    `),
    safeQuery(`
      SELECT
        block_reason,
        COUNT(*)::int AS cnt
      FROM email_trigger_events
      WHERE organization_id = '${o}'
        AND execution_blocked = true
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY block_reason
      ORDER BY cnt DESC
    `),
    safeQuery(`
      SELECT recipient_email, COUNT(*)::int AS attempts
      FROM outbound_email_audit_log
      WHERE organization_id = '${o}'
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY recipient_email
      HAVING COUNT(*) > 3
      LIMIT 10
    `),
    safeQuery(`
      SELECT
        policy_decision,
        COUNT(*)::int AS cnt
      FROM outbound_email_audit_log
      WHERE organization_id = '${o}'
        AND policy_decision IS NOT NULL
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY policy_decision
    `),
  ]);

  const risks: Array<{ id: string; type: string; severity: "low" | "medium" | "high" | "critical"; title: string; description: string; count: number }> = [];

  const totalBlocked = blockedSpike.reduce((s: number, r: any) => s + Number(r.blocked_count), 0);
  if (totalBlocked > 50) {
    risks.push({ id: "blocked-spike", type: "send_block", severity: "critical", title: "Blocked Send Spike", description: `${totalBlocked} sends blocked in last 24h — policy/guard chain is active`, count: totalBlocked });
  } else if (totalBlocked > 20) {
    risks.push({ id: "blocked-elevated", type: "send_block", severity: "high", title: "Elevated Blocked Sends", description: `${totalBlocked} sends blocked in last 24h`, count: totalBlocked });
  } else if (totalBlocked > 5) {
    risks.push({ id: "blocked-moderate", type: "send_block", severity: "medium", title: "Blocked Sends", description: `${totalBlocked} sends blocked in last 24h`, count: totalBlocked });
  }

  const totalFailed = failedSpike.reduce((s: number, r: any) => s + Number(r.failed_count), 0);
  if (totalFailed > 10) {
    risks.push({ id: "failed-spike", type: "send_failure", severity: totalFailed > 30 ? "critical" : "high", title: "Send Failure Spike", description: `${totalFailed} failed sends in last 24h — check provider credentials`, count: totalFailed });
  }

  const overdueApprovals = approvalBacklog[0]?.cnt ?? 0;
  if (Number(overdueApprovals) > 10) {
    risks.push({ id: "approval-backlog", type: "approval_backlog", severity: Number(overdueApprovals) > 25 ? "critical" : "high", title: "Approval Backlog", description: `${overdueApprovals} Gmail drafts awaiting approval >48h`, count: Number(overdueApprovals) });
  } else if (Number(overdueApprovals) > 0) {
    risks.push({ id: "approval-aging", type: "approval_backlog", severity: "medium", title: "Aging Approvals", description: `${overdueApprovals} approvals waiting >48 hours`, count: Number(overdueApprovals) });
  }

  for (const tf of triggerFailures.slice(0, 3)) {
    risks.push({ id: `trigger-${tf.block_reason}`, type: "trigger_block", severity: "medium", title: `Trigger Block: ${tf.block_reason}`, description: `${tf.cnt} triggers blocked by ${tf.block_reason}`, count: tf.cnt });
  }

  if (duplicateAttempts.length > 0) {
    risks.push({ id: "duplicate-comms", type: "duplicate", severity: "high", title: "Duplicate Communication Attempts", description: `${duplicateAttempts.length} recipients received >3 attempts in 24h`, count: duplicateAttempts.length });
  }

  const policyBlocked = policyErrors.find((r: any) => r.policy_decision === "blocked")?.cnt ?? 0;
  if (Number(policyBlocked) > 0) {
    risks.push({ id: "policy-block", type: "policy_failure", severity: "medium", title: "Policy Engine Blocks", description: `${policyBlocked} sends policy-blocked in last 24h`, count: Number(policyBlocked) });
  }

  return {
    risks,
    totalRisks: risks.length,
    criticalRisks: risks.filter((r) => r.severity === "critical").length,
    highRisks: risks.filter((r) => r.severity === "high").length,
    blockedSendHourly: blockedSpike,
    failedSendHourly: failedSpike,
    duplicateAttempts,
    topBlockReasons: triggerFailures,
  };
}

// ─── Full Dashboard Aggregate ──────────────────────────────────────────────────

export async function getFullCommunicationDashboard(orgId: string) {
  const [overview, channels, health, approvals, responses, leads, hiring, support, revenue, stalled, risks] =
    await Promise.all([
      getCommunicationOverview(orgId),
      getChannelPerformance(orgId),
      getConversationHealth(orgId),
      getApprovalMetrics(orgId),
      getResponseMetrics(orgId),
      getLeadCommunicationMetrics(orgId),
      getHiringCommunicationMetrics(orgId),
      getSupportCommunicationMetrics(orgId),
      getRevenueCommunicationMetrics(orgId),
      getStalledConversationMetrics(orgId),
      getCommunicationRisks(orgId),
    ]);

  return { overview, channels, health, approvals, responses, leads, hiring, support, revenue, stalled, risks };
}
