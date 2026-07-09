/**
 * AgentMail Analytics Service
 * Computes real performance metrics from existing tables.
 * Never fabricates data — if a metric can't be computed it returns null.
 */

import { db } from "../db";
import { eq, and, gte, sql as drizzleSql, desc } from "drizzle-orm";
import type { AppliedRuleMetadata } from "./message-learning-service";
import {
  gmailAgentActions,
  agentMessageFeedback,
  agentMessageLearningRules,
  agentDraftCoachingRules,
} from "@shared/schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDays(range: string): number {
  if (range === "90d") return 90;
  if (range === "30d") return 30;
  return 7;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function pct(num: number, denom: number): number | null {
  if (!denom) return null;
  return Math.round((num / denom) * 100);
}

function topN<T extends string>(arr: T[], n = 5): { tag: string; count: number }[] {
  const counts: Record<string, number> = {};
  arr.forEach((t) => { counts[t] = (counts[t] ?? 0) + 1; });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([tag, count]) => ({ tag, count }));
}

// ─── Raw data loaders ─────────────────────────────────────────────────────────

async function loadFeedback(orgId: string, since: Date, domain?: string) {
  const conditions = [eq(agentMessageFeedback.orgId, orgId), gte(agentMessageFeedback.createdAt, since)];
  if (domain) conditions.push(eq(agentMessageFeedback.communicationDomain, domain));
  return db.select().from(agentMessageFeedback).where(and(...conditions));
}

async function loadActions(orgId: string, since: Date, domain?: string) {
  const conditions = [eq(gmailAgentActions.orgId, orgId), gte(gmailAgentActions.createdAt, since)];
  if (domain) conditions.push(eq(gmailAgentActions.communicationDomain, domain));
  return db.select({
    id: gmailAgentActions.id,
    status: gmailAgentActions.status,
    communicationDomain: gmailAgentActions.communicationDomain,
    createdAt: gmailAgentActions.createdAt,
    executedAt: gmailAgentActions.executedAt,
    approvalRequired: gmailAgentActions.approvalRequired,
    result: gmailAgentActions.result,
  }).from(gmailAgentActions).where(and(...conditions));
}

// ─── Core metric computation ──────────────────────────────────────────────────

function computeMetrics(
  feedback: Awaited<ReturnType<typeof loadFeedback>>,
  actions: Awaited<ReturnType<typeof loadActions>>,
) {
  const draftsGenerated = actions.filter((a) => a.approvalRequired).length;
  const approved = feedback.filter((f) => f.decision === "approved").length;
  const editedAndApproved = feedback.filter((f) => f.decision === "edited_and_approved").length;
  const rejected = feedback.filter((f) => f.decision === "rejected").length;
  const totalReviewed = approved + editedAndApproved + rejected;

  // "Saved for review" = actions with approval_required=true, status=proposed, and result.savedForReview=true
  const savedForReview = actions.filter((a) => {
    if (!a.approvalRequired || a.status !== "proposed") return false;
    const r = (a.result && typeof a.result === "object") ? a.result as any : {};
    return r.savedForReview === true || r.savedBody;
  }).length;

  // Count distinct proposal_ids that have multiple revisions (regenerated = has revision entries)
  // We can't query agent_message_revisions directly here; use proxy: feedback chip "tone_off" or result.regenerated
  // Honest: we don't have a direct regeneration counter without querying revisions table.
  // We'll compute this via SQL in the summary endpoint for accuracy.

  const approvalRate = pct(approved + editedAndApproved, totalReviewed);
  const rejectionRate = pct(rejected, totalReviewed);
  const editRate = pct(editedAndApproved, totalReviewed);

  // Average time to approval in hours
  let totalHours = 0;
  let timeCount = 0;
  feedback.forEach((f) => {
    if ((f.decision === "approved" || f.decision === "edited_and_approved") && f.reviewedAt && f.createdAt) {
      const diff = (new Date(f.reviewedAt).getTime() - new Date(f.createdAt).getTime()) / 3_600_000;
      if (diff > 0 && diff < 168) { // Sanity: under 1 week
        totalHours += diff;
        timeCount++;
      }
    }
  });
  const avgTimeToApprovalHours = timeCount > 0 ? Math.round((totalHours / timeCount) * 10) / 10 : null;

  // Feedback tags
  const allTags: string[] = [];
  feedback.forEach((f) => {
    const tags = (f.feedbackTags as string[] | null) ?? [];
    allTags.push(...tags);
  });
  const topFeedbackTags = topN(allTags, 5);

  return {
    draftsGenerated,
    approved: approved + editedAndApproved,
    rejected,
    edited: editedAndApproved,
    savedForReview,
    totalReviewed,
    approvalRate,
    rejectionRate,
    editRate,
    avgTimeToApprovalHours,
    topFeedbackTags,
  };
}

// ─── By-domain breakdown ──────────────────────────────────────────────────────

const DOMAINS = [
  "athlete_lead", "parent_lead", "evaluation_scheduling", "onboarding",
  "retention", "payment_recovery", "program_assignment", "win_back",
  "team_training", "school_partnership", "athletic_director", "coach_outreach",
  "organization_outreach", "business_outreach", "employment_opportunity",
  "corporate_wellness", "facility_partnership", "gym_owner",
];

const DOMAIN_LABELS: Record<string, string> = {
  athlete_lead: "Athlete Leads", parent_lead: "Parent Leads", evaluation_scheduling: "Evaluation Scheduling",
  onboarding: "Onboarding", retention: "Retention", payment_recovery: "Payment Recovery",
  program_assignment: "Program Assignment", win_back: "Win Back", team_training: "Team Training",
  school_partnership: "School Partnerships", athletic_director: "Athletic Directors",
  coach_outreach: "Coach Outreach", organization_outreach: "Org Outreach",
  business_outreach: "Business Outreach", employment_opportunity: "Employment",
  corporate_wellness: "Corporate Wellness", facility_partnership: "Facility Partnerships",
  gym_owner: "Gym Owners",
};

function computeByDomain(
  feedback: Awaited<ReturnType<typeof loadFeedback>>,
  actions: Awaited<ReturnType<typeof loadActions>>,
) {
  return DOMAINS.map((domain) => {
    const df = feedback.filter((f) => (f.communicationDomain ?? "athlete_lead") === domain);
    const da = actions.filter((a) => (a.communicationDomain ?? "athlete_lead") === domain && a.approvalRequired);
    const m = computeMetrics(df, da);
    if (m.draftsGenerated === 0 && df.length === 0) return null;
    return { domain, label: DOMAIN_LABELS[domain] ?? domain, ...m };
  }).filter(Boolean);
}

// ─── Trends ──────────────────────────────────────────────────────────────────

function computeTrends(
  currentFeedback: Awaited<ReturnType<typeof loadFeedback>>,
  currentActions: Awaited<ReturnType<typeof loadActions>>,
  previousFeedback: Awaited<ReturnType<typeof loadFeedback>>,
  previousActions: Awaited<ReturnType<typeof loadActions>>,
) {
  const current = computeMetrics(currentFeedback, currentActions);
  const previous = computeMetrics(previousFeedback, previousActions);

  const delta = (a: number | null, b: number | null) =>
    a != null && b != null ? Math.round((a - b) * 10) / 10 : null;

  return {
    currentPeriod: {
      draftsGenerated: current.draftsGenerated,
      approvalRate: current.approvalRate,
      editRate: current.editRate,
      rejectionRate: current.rejectionRate,
      avgTimeToApprovalHours: current.avgTimeToApprovalHours,
    },
    previousPeriod: {
      draftsGenerated: previous.draftsGenerated,
      approvalRate: previous.approvalRate,
      editRate: previous.editRate,
      rejectionRate: previous.rejectionRate,
      avgTimeToApprovalHours: previous.avgTimeToApprovalHours,
    },
    deltaApprovalRate: delta(current.approvalRate, previous.approvalRate),
    deltaEditRate: delta(current.editRate, previous.editRate),
    deltaRejectionRate: delta(current.rejectionRate, previous.rejectionRate),
    deltaAvgTimeToApproval: delta(current.avgTimeToApprovalHours, previous.avgTimeToApprovalHours),
  };
}

// ─── Public: Summary ─────────────────────────────────────────────────────────

export async function getAgentmailSummary(
  orgId: string,
  range = "7d",
  domain?: string,
) {
  const days = parseDays(range);
  const since = daysAgo(days);
  const prevSince = daysAgo(days * 2);

  const [feedback, actions, prevFeedback, prevActions] = await Promise.all([
    loadFeedback(orgId, since, domain),
    loadActions(orgId, since, domain),
    loadFeedback(orgId, prevSince, domain).then((f) => f.filter((r) => new Date(r.createdAt!) < since)),
    loadActions(orgId, prevSince, domain).then((a) => a.filter((r) => new Date(r.createdAt!) < since)),
  ]);

  // Count regenerations via agent_message_revisions
  let regenerated = 0;
  try {
    const { agentMessageRevisions } = await import("@shared/schema");
    const revs = await db.select({ n: agentMessageRevisions.proposalId })
      .from(agentMessageRevisions)
      .where(and(eq(agentMessageRevisions.orgId, orgId), gte(agentMessageRevisions.createdAt!, since)));
    const uniqueProposals = new Set(revs.map((r) => r.n));
    regenerated = uniqueProposals.size;
  } catch { /* revisions table may not exist */ }

  const totals = computeMetrics(feedback, actions);
  const byDomain = domain ? [] : computeByDomain(feedback, actions);
  const trends = computeTrends(feedback, actions, prevFeedback, prevActions);

  return {
    range,
    domain: domain ?? null,
    totals: { ...totals, regenerated },
    byDomain,
    trends,
  };
}

// ─── Public: Record Rule Applications ────────────────────────────────────────

export async function recordAgentMailRuleApplications(opts: {
  orgId: string;
  actionId: string;
  communicationDomain: string;
  rules: AppliedRuleMetadata[];
}): Promise<void> {
  if (!opts.actionId || opts.rules.length === 0) return;
  try {
    for (const rule of opts.rules) {
      await db.execute(drizzleSql`
        INSERT INTO agentmail_rule_applications
          (org_id, action_id, rule_source, rule_id, communication_domain, applied_at)
        VALUES
          (${opts.orgId}, ${opts.actionId}, ${rule.source}, ${rule.ruleId}, ${opts.communicationDomain}, now())
        ON CONFLICT (action_id, rule_source, rule_id) DO NOTHING
      `);
    }
  } catch (err: any) {
    console.warn("[agentmail-analytics] recordRuleApplications failed (non-fatal):", err.message);
  }
}

// ─── Public: Rule Performance ─────────────────────────────────────────────────

export async function getAgentmailRulePerformance(orgId: string) {
  const [learnedRules, coachingRules, feedback] = await Promise.all([
    db.select().from(agentMessageLearningRules)
      .where(eq(agentMessageLearningRules.orgId, orgId))
      .orderBy(desc(agentMessageLearningRules.confidence)),
    db.select().from(agentDraftCoachingRules)
      .where(eq(agentDraftCoachingRules.orgId, orgId))
      .orderBy(desc(agentDraftCoachingRules.createdAt)),
    db.select({
      communicationDomain: agentMessageFeedback.communicationDomain,
      decision: agentMessageFeedback.decision,
      feedbackTags: agentMessageFeedback.feedbackTags,
      appliedToFutureRuns: agentMessageFeedback.appliedToFutureRuns,
      createdAt: agentMessageFeedback.createdAt,
    }).from(agentMessageFeedback).where(eq(agentMessageFeedback.orgId, orgId)),
  ]);

  // ── Per-rule application stats from instrumentation table ────────────────
  // Join rule_applications → gmail_agent_actions → feedback to get real outcomes
  let appRows: Array<{
    rule_id: string;
    rule_source: string;
    times_applied: number;
    last_applied_at: Date | null;
  }> = [];
  let outcomeRows: Array<{
    rule_id: string;
    rule_source: string;
    decision: string | null;
    status: string | null;
  }> = [];

  try {
    const raw = await db.execute(drizzleSql`
      SELECT
        ra.rule_id,
        ra.rule_source,
        COUNT(*)::int          AS times_applied,
        MAX(ra.applied_at)     AS last_applied_at
      FROM agentmail_rule_applications ra
      WHERE ra.org_id = ${orgId}
      GROUP BY ra.rule_id, ra.rule_source
    `);
    appRows = (Array.isArray(raw) ? raw : (raw as any).rows ?? []) as typeof appRows;
  } catch { /* table may be empty or missing — gracefully skip */ }

  try {
    const raw = await db.execute(drizzleSql`
      SELECT
        ra.rule_id,
        ra.rule_source,
        f.decision,
        g.status
      FROM agentmail_rule_applications ra
      JOIN gmail_agent_actions g ON g.id = ra.action_id
      LEFT JOIN agent_message_feedback f ON f.proposal_id = ra.action_id
      WHERE ra.org_id = ${orgId}
    `);
    outcomeRows = (Array.isArray(raw) ? raw : (raw as any).rows ?? []) as typeof outcomeRows;
  } catch { /* gracefully skip */ }

  // Compute per-rule outcome stats
  const appMap = new Map<string, { timesApplied: number; lastAppliedAt: Date | null }>();
  appRows.forEach((r) => {
    appMap.set(`${r.rule_source}:${r.rule_id}`, {
      timesApplied: r.times_applied,
      lastAppliedAt: r.last_applied_at,
    });
  });

  const outcomeMap = new Map<string, { approved: number; rejected: number; edited: number; total: number }>();
  outcomeRows.forEach((r) => {
    const key = `${r.rule_source}:${r.rule_id}`;
    if (!outcomeMap.has(key)) outcomeMap.set(key, { approved: 0, rejected: 0, edited: 0, total: 0 });
    const m = outcomeMap.get(key)!;
    m.total++;
    const dec = r.decision ?? "";
    if (dec === "approved") m.approved++;
    else if (dec === "edited_and_approved") { m.approved++; m.edited++; }
    else if (dec === "rejected") m.rejected++;
  });

  const trackingAvailable = appRows.length > 0;

  function ruleStats(key: string): {
    timesApplied: number; lastAppliedAt: Date | null;
    approvalsAfterApplied: number | null; rejectionsAfterApplied: number | null;
    editsAfterApplied: number | null;
    approvalRateAfterApplied: number | null; rejectionRateAfterApplied: number | null;
    editRateAfterApplied: number | null;
    outcomeConfidence: "high" | "medium" | "low" | "none";
  } {
    const app = appMap.get(key);
    const outcomes = outcomeMap.get(key);
    const ta = app?.timesApplied ?? 0;
    const confidence: "high" | "medium" | "low" | "none" =
      ta >= 10 ? "high" : ta >= 5 ? "medium" : ta >= 1 ? "low" : "none";
    if (!app) {
      return { timesApplied: 0, lastAppliedAt: null, approvalsAfterApplied: null, rejectionsAfterApplied: null, editsAfterApplied: null, approvalRateAfterApplied: null, rejectionRateAfterApplied: null, editRateAfterApplied: null, outcomeConfidence: "none" };
    }
    return {
      timesApplied: ta,
      lastAppliedAt: app.lastAppliedAt,
      approvalsAfterApplied: outcomes?.approved ?? null,
      rejectionsAfterApplied: outcomes?.rejected ?? null,
      editsAfterApplied: outcomes?.edited ?? null,
      approvalRateAfterApplied: outcomes && outcomes.total > 0 ? Math.round((outcomes.approved / outcomes.total) * 100) : null,
      rejectionRateAfterApplied: outcomes && outcomes.total > 0 ? Math.round((outcomes.rejected / outcomes.total) * 100) : null,
      editRateAfterApplied: outcomes && outcomes.total > 0 ? Math.round((outcomes.edited / outcomes.total) * 100) : null,
      outcomeConfidence: confidence,
    };
  }

  const learned = learnedRules.map((r) => {
    const key = `learned:${r.id}`;
    const stats = ruleStats(key);
    return {
      ruleId: r.id,
      ruleText: r.ruleText,
      ruleType: r.ruleType,
      domain: r.communicationDomain ?? "athlete_lead",
      source: "learned" as const,
      isActive: r.status === "active",
      confidence: r.confidence ? Math.round(Number(r.confidence) * 100) : null,
      lastAppliedAt: r.lastAppliedAt,
      createdAt: r.createdAt,
      trackingAvailable,
      ...stats,
    };
  });

  const standing = coachingRules.map((r) => {
    const key = `standing_instruction:${r.id}`;
    const stats = ruleStats(key);
    return {
      ruleId: r.id,
      ruleText: r.ruleText,
      ruleType: r.ruleType,
      domain: r.communicationDomain,
      source: "standing_instruction" as const,
      isActive: r.isActive,
      confidence: null,
      lastAppliedAt: null,
      createdAt: r.createdAt,
      trackingAvailable,
      ...stats,
    };
  });

  // Domains with poor performance (high rejection) — suggest rule review
  const domainRejections: Record<string, { rejected: number; total: number }> = {};
  feedback.forEach((f) => {
    const d = f.communicationDomain ?? "athlete_lead";
    if (!domainRejections[d]) domainRejections[d] = { rejected: 0, total: 0 };
    domainRejections[d].total++;
    if (f.decision === "rejected") domainRejections[d].rejected++;
  });
  const highRejectionDomains = Object.entries(domainRejections)
    .filter(([, v]) => v.total >= 3 && v.rejected / v.total > 0.4)
    .map(([domain, v]) => ({
      domain,
      label: DOMAIN_LABELS[domain] ?? domain,
      rejectionRate: Math.round((v.rejected / v.total) * 100),
      totalReviewed: v.total,
    }));

  // ── Per-rule outcome rates from agentmail_outcome_events ─────────────────
  let outcomeRateRows: Array<{
    rule_id: string;
    rule_source: string;
    reply_count: number;
    eval_count: number;
    conversion_count: number;
    total_outcomes: number;
  }> = [];
  try {
    const raw = await db.execute(drizzleSql`
      SELECT
        ra.rule_id,
        ra.rule_source,
        COUNT(CASE WHEN oe.outcome_type = 'reply_received' THEN 1 END)::int          AS reply_count,
        COUNT(CASE WHEN oe.outcome_type IN ('evaluation_scheduled','evaluation_completed') THEN 1 END)::int AS eval_count,
        COUNT(CASE WHEN oe.outcome_type = 'lead_converted' THEN 1 END)::int          AS conversion_count,
        COUNT(oe.id)::int                                                             AS total_outcomes
      FROM agentmail_rule_applications ra
      JOIN gmail_agent_actions g ON g.id = ra.action_id
      LEFT JOIN agentmail_outcome_events oe ON oe.action_id = ra.action_id
      WHERE ra.org_id = ${orgId}
      GROUP BY ra.rule_id, ra.rule_source
    `);
    outcomeRateRows = (Array.isArray(raw) ? raw : (raw as any).rows ?? []) as typeof outcomeRateRows;
  } catch { /* table may not exist yet */ }

  const outcomeRateMap = new Map<string, typeof outcomeRateRows[number]>();
  outcomeRateRows.forEach((r) => outcomeRateMap.set(`${r.rule_source}:${r.rule_id}`, r));

  function performanceLabel(
    timesApplied: number,
    approvalRate: number | null,
    rejectionRate: number | null,
    editRate: number | null,
  ): "high_performing" | "stable" | "needs_review" | "insufficient_data" {
    if (timesApplied < 5) return "insufficient_data";
    const rejectPct = rejectionRate ?? 0;
    const approvePct = approvalRate ?? 0;
    const editPct = editRate ?? 0;
    if (timesApplied >= 10 && (rejectPct >= 50 || approvePct < 30 || editPct >= 75)) return "needs_review";
    if (timesApplied >= 5 && approvePct >= 70 && rejectPct <= 15) return "high_performing";
    return "stable";
  }

  const learnedWithLabels = learned.map((r) => {
    const key = `learned:${r.ruleId}`;
    const or = outcomeRateMap.get(key);
    const label = performanceLabel(r.timesApplied, r.approvalRateAfterApplied, r.rejectionRateAfterApplied, r.editRateAfterApplied);
    return {
      ...r,
      outcomeRates: or ? {
        replyCount: or.reply_count,
        evalCount: or.eval_count,
        conversionCount: or.conversion_count,
        totalOutcomes: or.total_outcomes,
      } : null,
      performanceLabel: label,
      needsReview: label === "needs_review",
    };
  });

  const standingWithLabels = standing.map((r) => {
    const key = `standing_instruction:${r.ruleId}`;
    const or = outcomeRateMap.get(key);
    const label = performanceLabel(r.timesApplied, r.approvalRateAfterApplied, r.rejectionRateAfterApplied, r.editRateAfterApplied);
    return {
      ...r,
      outcomeRates: or ? {
        replyCount: or.reply_count,
        evalCount: or.eval_count,
        conversionCount: or.conversion_count,
        totalOutcomes: or.total_outcomes,
      } : null,
      performanceLabel: label,
      needsReview: label === "needs_review",
    };
  });

  const needsReviewCount = learnedWithLabels.filter((r) => r.needsReview).length;
  const highPerformingCount = learnedWithLabels.filter((r) => r.performanceLabel === "high_performing").length;

  return {
    learnedRules: learnedWithLabels,
    standingInstructions: standingWithLabels,
    trackingAvailable,
    highRejectionDomains,
    summary: {
      totalLearnedRules: learned.length,
      activeLearnedRules: learned.filter((r) => r.isActive).length,
      totalStandingInstructions: standing.length,
      activeStandingInstructions: standing.filter((r) => r.isActive).length,
      totalApplicationsRecorded: appRows.reduce((s, r) => s + r.times_applied, 0),
      needsReviewCount,
      highPerformingCount,
    },
  };
}

// ─── Public: Feedback Analytics ───────────────────────────────────────────────

export async function getAgentmailFeedbackAnalytics(orgId: string, range = "30d") {
  const days = parseDays(range);
  const since = daysAgo(days);

  const feedback = await db.select().from(agentMessageFeedback)
    .where(and(eq(agentMessageFeedback.orgId, orgId), gte(agentMessageFeedback.createdAt, since)));

  // Global tag stats
  const allTags: string[] = [];
  feedback.forEach((f) => {
    const tags = (f.feedbackTags as string[] | null) ?? [];
    allTags.push(...tags);
  });
  const topFeedbackTags = topN(allTags, 10);

  // By domain
  const domainStats: Record<string, {
    domain: string; label: string; total: number;
    approved: number; edited: number; rejected: number;
    correctionRate: number | null; topTags: { tag: string; count: number }[];
  }> = {};

  feedback.forEach((f) => {
    const d = f.communicationDomain ?? "athlete_lead";
    if (!domainStats[d]) {
      domainStats[d] = { domain: d, label: DOMAIN_LABELS[d] ?? d, total: 0, approved: 0, edited: 0, rejected: 0, correctionRate: null, topTags: [] };
    }
    domainStats[d].total++;
    if (f.decision === "approved") domainStats[d].approved++;
    else if (f.decision === "edited_and_approved") domainStats[d].edited++;
    else if (f.decision === "rejected") domainStats[d].rejected++;
  });

  // Compute correction rates and per-domain top tags
  Object.entries(domainStats).forEach(([d, s]) => {
    s.correctionRate = pct(s.edited + s.rejected, s.total);
    const dTags: string[] = [];
    feedback
      .filter((f) => (f.communicationDomain ?? "athlete_lead") === d)
      .forEach((f) => dTags.push(...((f.feedbackTags as string[] | null) ?? [])));
    s.topTags = topN(dTags, 5);
  });

  const byDomain = Object.values(domainStats)
    .sort((a, b) => b.total - a.total);

  const highCorrectionDomains = byDomain
    .filter((d) => d.total >= 3 && (d.correctionRate ?? 0) > 40)
    .sort((a, b) => (b.correctionRate ?? 0) - (a.correctionRate ?? 0));

  // Over-time bucketed by day (last N days)
  const dailyCounts: Record<string, { date: string; approved: number; edited: number; rejected: number }> = {};
  feedback.forEach((f) => {
    const dateKey = new Date(f.createdAt!).toISOString().slice(0, 10);
    if (!dailyCounts[dateKey]) dailyCounts[dateKey] = { date: dateKey, approved: 0, edited: 0, rejected: 0 };
    if (f.decision === "approved") dailyCounts[dateKey].approved++;
    else if (f.decision === "edited_and_approved") dailyCounts[dateKey].edited++;
    else if (f.decision === "rejected") dailyCounts[dateKey].rejected++;
  });
  const dailyTimeline = Object.values(dailyCounts).sort((a, b) => a.date.localeCompare(b.date));

  // Coaching comment count (non-null, non-empty)
  const coachingCommentCount = feedback.filter((f) => f.coachingFeedbackText?.trim()).length;

  return {
    range,
    totalFeedbackRecords: feedback.length,
    topFeedbackTags,
    byDomain,
    highCorrectionDomains,
    dailyTimeline,
    coachingCommentCount,
  };
}

// ─── Public: Attention Items ──────────────────────────────────────────────────

export async function generateAgentmailAttentionItems(orgId: string): Promise<void> {
  const { attentionItems } = await import("@shared/schema");
  const since = daysAgo(7);

  const [feedback, actions] = await Promise.all([
    loadFeedback(orgId, since),
    loadActions(orgId, since),
  ]);

  const totalMetrics = computeMetrics(feedback, actions);
  const byDomain = computeByDomain(feedback, actions) as any[];

  const upsert = async (
    key: string,
    title: string,
    body: string,
    severity: number,
    urgency: number,
  ) => {
    try {
      // Check if item already active with this key
      const existing = await db.execute(drizzleSql`
        SELECT id FROM attention_items
        WHERE org_id = ${orgId}
          AND source = 'agentmail-analytics'
          AND status = 'active'
          AND metadata->>'stableKey' = ${key}
        LIMIT 1
      `);
      const rows = Array.isArray(existing) ? existing : (existing as any).rows ?? [];
      if (rows.length > 0) return; // already exists, don't duplicate

      await db.insert(attentionItems).values({
        orgId,
        level: severity >= 70 ? "warning" : "informational",
        category: "agentmail_performance",
        title,
        body,
        source: "agentmail-analytics",
        severity,
        urgency,
        businessImpact: 40,
        confidence: 0.85,
        actionUrl: "/admin/agentmail-analytics",
        actionLabel: "View Analytics",
        status: "active",
        metadata: { stableKey: key },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });
    } catch (err: any) {
      console.warn("[agentmail-attention] upsert failed:", err.message);
    }
  };

  // 1. High saved-for-review backlog
  const savedBacklog = actions.filter((a) => {
    if (!a.approvalRequired || a.status !== "proposed") return false;
    const r = (a.result && typeof a.result === "object") ? a.result as any : {};
    return r.savedForReview === true || r.savedBody;
  });
  if (savedBacklog.length >= 5) {
    await upsert(
      `${orgId}:agentmail:saved-backlog`,
      `${savedBacklog.length} drafts saved for review but not yet approved`,
      `${savedBacklog.length} email drafts have been saved for review but haven't been approved or sent. Review them in AI Approvals to keep outreach moving.`,
      70, 65,
    );
  }

  // 2. High rejection rate domain
  for (const d of byDomain) {
    if (d.totalReviewed >= 5 && (d.rejectionRate ?? 0) >= 50) {
      await upsert(
        `${orgId}:agentmail:high-rejection:${d.domain}`,
        `${d.label} drafts have a ${d.rejectionRate}% rejection rate`,
        `${d.totalReviewed} ${d.label} drafts were reviewed in the last 7 days and ${d.rejectionRate}% were rejected. Consider reviewing learning rules for this domain.`,
        65, 55,
      );
    }
  }

  // 3. High edit rate domain
  for (const d of byDomain) {
    if (d.totalReviewed >= 5 && (d.editRate ?? 0) >= 60) {
      await upsert(
        `${orgId}:agentmail:high-edit:${d.domain}`,
        `${d.label} drafts have a ${d.editRate}% edit rate`,
        `Coaches are editing ${d.editRate}% of ${d.label} drafts before approving. Add standing instructions to teach the AI your preferences and reduce editing.`,
        55, 45,
      );
    }
  }

  // 4. Learned rules needing review (based on rule performance)
  try {
    const { getAgentmailRulePerformance } = await import("./agentmail-analytics-service");
    const perf = await getAgentmailRulePerformance(orgId);
    const needsReview = perf.learnedRules.filter((r: any) => r.needsReview && r.isActive);
    if (needsReview.length > 0) {
      await upsert(
        `${orgId}:agentmail:rules-needs-review`,
        `${needsReview.length} learned rule${needsReview.length === 1 ? "" : "s"} ${needsReview.length === 1 ? "is" : "are"} associated with repeated rejections`,
        `${needsReview.length} active learned rule${needsReview.length === 1 ? "" : "s"} ${needsReview.length === 1 ? "has" : "have"} a rejection rate ≥50% or approval rate <30% (10+ applications). Review them in the AgentMail Learning Center.`,
        65, 60,
      );
    }
  } catch { /* fail open */ }

  // 5. Saved drafts with high-performing rules (unsent opportunity)
  try {
    const unsent = actions.filter((a) => {
      if (!a.approvalRequired || a.status !== "proposed") return false;
      const r = (a.result && typeof a.result === "object") ? a.result as any : {};
      return r.savedForReview === true;
    });
    if (unsent.length >= 3) {
      await upsert(
        `${orgId}:agentmail:unsent-high-performing-drafts`,
        `${unsent.length} saved drafts are ready to review and send`,
        `${unsent.length} AgentMail drafts have been saved for review but not yet approved. These drafts used your learned rules — send them to keep outreach active.`,
        60, 55,
      );
    }
  } catch { /* fail open */ }
}

// ─── Public: CEO Heartbeat Signal ────────────────────────────────────────────

export async function getAgentmailHeartbeatSignal(orgId: string): Promise<{
  summary: string;
  details: string[];
  hasIssues: boolean;
} | null> {
  try {
    const since = daysAgo(7);
    const [feedback, actions] = await Promise.all([
      loadFeedback(orgId, since),
      loadActions(orgId, since),
    ]);

    if (feedback.length === 0 && actions.length === 0) return null;

    const m = computeMetrics(feedback, actions);
    const byDomain = computeByDomain(feedback, actions) as any[];
    const details: string[] = [];
    let hasIssues = false;

    // Saved for review backlog
    if (m.savedForReview >= 3) {
      details.push(`${m.savedForReview} drafts saved for review and not yet approved`);
      hasIssues = true;
    }

    // Rejection rate
    if (m.rejectionRate != null && m.rejectionRate >= 40 && m.totalReviewed >= 5) {
      details.push(`Overall draft rejection rate: ${m.rejectionRate}% (last 7 days)`);
      hasIssues = true;
    }

    // High edit rate domains
    const highEditDomains = byDomain.filter((d) => d.totalReviewed >= 3 && (d.editRate ?? 0) >= 60);
    if (highEditDomains.length > 0) {
      const names = highEditDomains.map((d) => `${d.label} (${d.editRate}%)`).join(", ");
      details.push(`High edit rate domains: ${names} — add standing instructions to reduce editing`);
      hasIssues = true;
    }

    // Approval rate improvement note
    if (m.approvalRate != null && m.approvalRate >= 70 && m.totalReviewed >= 5) {
      details.push(`AgentMail approval rate: ${m.approvalRate}% across ${m.totalReviewed} reviewed drafts`);
    }

    if (details.length === 0) return null;

    const summary = hasIssues
      ? `AgentMail: ${m.totalReviewed} drafts reviewed (${m.approvalRate ?? "?"}% approval rate) — ${details[0]}`
      : `AgentMail: ${m.approvalRate ?? "?"}% approval rate across ${m.totalReviewed} drafts this week`;

    return { summary, details, hasIssues };
  } catch (err: any) {
    console.warn("[agentmail-analytics] heartbeat signal error:", err.message);
    return null; // Fail open
  }
}
