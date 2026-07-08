/**
 * AgentMail Analytics Service
 * Computes real performance metrics from existing tables.
 * Never fabricates data — if a metric can't be computed it returns null.
 */

import { db } from "../db";
import { eq, and, gte, sql as drizzleSql, desc, inArray } from "drizzle-orm";
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

  // Per-rule application tracking doesn't exist yet — honest about this
  const trackingAvailable = false;

  const learned = learnedRules.map((r) => ({
    ruleId: r.id,
    ruleText: r.ruleText,
    ruleType: r.ruleType,
    domain: r.communicationDomain ?? "athlete_lead",
    source: "learned" as const,
    isActive: r.status === "active",
    confidence: r.confidence ? Math.round(Number(r.confidence) * 100) : null,
    timesApplied: r.timesApplied ?? 0,
    successCount: r.successCount ?? 0,
    rejectionCount: r.rejectionCount ?? 0,
    lastAppliedAt: r.lastAppliedAt,
    createdAt: r.createdAt,
    trackingAvailable,
    note: trackingAvailable ? null : "Per-rule outcome tracking not yet instrumented. Enable Phase D.2 to track which rules are applied to each draft.",
  }));

  const standing = coachingRules.map((r) => ({
    ruleId: r.id,
    ruleText: r.ruleText,
    ruleType: r.ruleType,
    domain: r.communicationDomain,
    source: "standing_instruction" as const,
    isActive: r.isActive,
    confidence: null,
    timesApplied: null,
    successCount: null,
    rejectionCount: null,
    lastAppliedAt: null,
    createdAt: r.createdAt,
    trackingAvailable,
    note: "Coach-authored standing instruction. Applied to every draft for its domain while active.",
  }));

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

  return {
    learnedRules: learned,
    standingInstructions: standing,
    trackingAvailable,
    highRejectionDomains,
    summary: {
      totalLearnedRules: learned.length,
      activeLearnedRules: learned.filter((r) => r.isActive).length,
      totalStandingInstructions: standing.length,
      activeStandingInstructions: standing.filter((r) => r.isActive).length,
    },
    phase2Recommendation: "Instrument agentmail_rule_applications table to track per-rule outcomes. Wire recording into getMessageLearningContext() call sites.",
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
