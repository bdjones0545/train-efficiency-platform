/**
 * Opportunity Executive Coordinator — Phase 11
 * ─────────────────────────────────────────────────────────────────────────────
 * Promotes Opportunity Acquisition into a fully integrated organizational
 * department. Called by the CEO Heartbeat on every cycle.
 *
 * SAFETY GUARDRAILS (immutable):
 *  ✗ No autonomous outreach
 *  ✗ No autonomous negotiation
 *  ✗ No autonomous pricing
 *  ✗ No autonomous meeting scheduling
 *  ✓ Monitor / Summarize / Recommend / Prioritize / Alert only
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { attentionItems } from "@shared/schema";

// ─── Local helpers ─────────────────────────────────────────────────────────────

function rows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}
function n(v: any): number {
  return Number(v ?? 0);
}

async function logOppEvent(orgId: string, agentName: string, action: string, eventType = "info"): Promise<void> {
  await db.execute(sql`
    INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
    VALUES (${orgId}, ${agentName}, ${action}, ${eventType})
  `).catch(() => {});
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface OpportunityHealthCheck {
  id: string;
  label: string;
  severity: "critical" | "high" | "medium" | "low";
  passed: boolean;
  detail: string;
}

export interface BestActionCandidate {
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  route: string;
}

export interface OpportunityHeartbeatSummary {
  opportunitiesFound: number;
  qualified: number;
  contacted: number;
  replies: number;
  meetings: number;
  wins: number;
  losses: number;
  pendingDrafts: number;
  pendingRecommendations: number;
  bestAction: BestActionCandidate | null;
  executiveSummary: string;
  healthChecks: OpportunityHealthCheck[];
  generatedAt: string;
}

// ─── Health check evaluators ───────────────────────────────────────────────────

async function evaluateHealthChecks(orgId: string): Promise<OpportunityHealthCheck[]> {
  const checks: OpportunityHealthCheck[] = [];
  const now = Date.now();

  // 1. Approved Draft Aging (>7 days)
  try {
    const sevenDaysAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
    const aged = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_outreach_drafts
      WHERE org_id = ${orgId}
        AND status = 'approved'
        AND created_at < ${sevenDaysAgo}
    `));
    const cnt = n(aged[0]?.cnt ?? 0);
    checks.push({
      id: "approved_draft_aging",
      label: "Approved Draft Aging",
      severity: "medium",
      passed: cnt === 0,
      detail: cnt === 0
        ? "No approved drafts older than 7 days."
        : `${cnt} approved draft${cnt > 1 ? "s" : ""} waiting to send for 7+ days.`,
    });
  } catch { checks.push({ id: "approved_draft_aging", label: "Approved Draft Aging", severity: "medium", passed: true, detail: "Check skipped." }); }

  // 2. Interested Opportunity Aging (no follow-up in 5+ days)
  try {
    const fiveDaysAgo = new Date(now - 5 * 24 * 3600 * 1000).toISOString();
    const aging = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_reply_events r
      JOIN opportunity_acquisition_opportunities o ON o.id = r.opportunity_id
      WHERE r.org_id = ${orgId}
        AND r.classification IN ('interested', 'information_request')
        AND o.status NOT IN ('won', 'lost', 'meeting_requested')
        AND r.created_at < ${fiveDaysAgo}
    `));
    const cnt = n(aging[0]?.cnt ?? 0);
    checks.push({
      id: "interested_opportunity_aging",
      label: "Interested Opportunity Aging",
      severity: "high",
      passed: cnt === 0,
      detail: cnt === 0
        ? "No interested opportunities without follow-up for 5+ days."
        : `${cnt} interested opportunit${cnt > 1 ? "ies" : "y"} without follow-up for 5+ days.`,
    });
  } catch { checks.push({ id: "interested_opportunity_aging", label: "Interested Opportunity Aging", severity: "high", passed: true, detail: "Check skipped." }); }

  // 3. Meeting Request Waiting (not acknowledged)
  try {
    const meetings = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_reply_events r
      JOIN opportunity_acquisition_opportunities o ON o.id = r.opportunity_id
      WHERE r.org_id = ${orgId}
        AND r.classification = 'meeting_request'
        AND o.status NOT IN ('won', 'lost', 'meeting_requested')
    `));
    const cnt = n(meetings[0]?.cnt ?? 0);
    checks.push({
      id: "meeting_request_waiting",
      label: "Meeting Request Waiting",
      severity: "critical",
      passed: cnt === 0,
      detail: cnt === 0
        ? "No unacknowledged meeting requests."
        : `${cnt} meeting request${cnt > 1 ? "s" : ""} classified but not yet acknowledged.`,
    });
  } catch { checks.push({ id: "meeting_request_waiting", label: "Meeting Request Waiting", severity: "critical", passed: true, detail: "Check skipped." }); }

  // 4. Low Discovery Volume (no discoveries in 7 days)
  try {
    const sevenDaysAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
    const recent = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_acquisition_opportunities
      WHERE org_id = ${orgId}
        AND created_at >= ${sevenDaysAgo}
    `));
    const cnt = n(recent[0]?.cnt ?? 0);
    checks.push({
      id: "low_discovery_volume",
      label: "Low Discovery Volume",
      severity: "medium",
      passed: cnt > 0,
      detail: cnt > 0
        ? `${cnt} opportunit${cnt > 1 ? "ies" : "y"} discovered in the last 7 days.`
        : "No opportunities discovered in the last 7 days. Consider running a discovery scan.",
    });
  } catch { checks.push({ id: "low_discovery_volume", label: "Low Discovery Volume", severity: "medium", passed: true, detail: "Check skipped." }); }

  // 5. Learning Stale (no learning run in 14+ days)
  try {
    const fourteenDaysAgo = new Date(now - 14 * 24 * 3600 * 1000).toISOString();
    const recentLearning = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_agent_events
      WHERE org_id = ${orgId}
        AND action LIKE '%Learning analysis%'
        AND created_at >= ${fourteenDaysAgo}
    `));
    const cnt = n(recentLearning[0]?.cnt ?? 0);
    checks.push({
      id: "learning_stale",
      label: "Learning Analysis Stale",
      severity: "low",
      passed: cnt > 0,
      detail: cnt > 0
        ? "Learning analysis has run within the last 14 days."
        : "Learning analysis has not run in 14+ days. Run Hermes to keep insights current.",
    });
  } catch { checks.push({ id: "learning_stale", label: "Learning Analysis Stale", severity: "low", passed: true, detail: "Check skipped." }); }

  // 6. Executive Review Needed (pending recommendations > 3)
  try {
    const pending = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_recommendations
      WHERE org_id = ${orgId}
        AND status = 'pending'
    `).catch(() => []));
    const cnt = n(pending[0]?.cnt ?? 0);
    const threshold = 3;
    checks.push({
      id: "executive_review_needed",
      label: "Executive Review Needed",
      severity: "medium",
      passed: cnt <= threshold,
      detail: cnt <= threshold
        ? `${cnt} pending recommendation${cnt !== 1 ? "s" : ""} — within threshold.`
        : `${cnt} pending recommendations awaiting executive review.`,
    });
  } catch { checks.push({ id: "executive_review_needed", label: "Executive Review Needed", severity: "medium", passed: true, detail: "Check skipped." }); }

  return checks;
}

// ─── Best Action Today generator ───────────────────────────────────────────────

async function generateBestAction(orgId: string): Promise<BestActionCandidate | null> {
  // Meeting requests are always highest priority
  try {
    const meetings = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_reply_events r
      JOIN opportunity_acquisition_opportunities o ON o.id = r.opportunity_id
      WHERE r.org_id = ${orgId}
        AND r.classification = 'meeting_request'
        AND o.status NOT IN ('won', 'lost', 'meeting_requested')
    `));
    const cnt = n(meetings[0]?.cnt ?? 0);
    if (cnt > 0) {
      return {
        title: `Respond to ${cnt} meeting request${cnt > 1 ? "s" : ""}`,
        description: `${cnt} prospect${cnt > 1 ? "s have" : " has"} requested a meeting. Respond promptly to maximize conversion.`,
        priority: "critical",
        route: "/admin/opportunity-acquisition?tab=replies",
      };
    }
  } catch {}

  // Approved drafts ready to send
  try {
    const drafts = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_outreach_drafts
      WHERE org_id = ${orgId}
        AND status = 'approved'
    `));
    const cnt = n(drafts[0]?.cnt ?? 0);
    if (cnt > 0) {
      return {
        title: `Send ${cnt} approved outreach draft${cnt > 1 ? "s" : ""}`,
        description: `${cnt} outreach draft${cnt > 1 ? "s are" : " is"} approved and ready to send to qualified prospects.`,
        priority: cnt >= 5 ? "high" : "medium",
        route: "/admin/opportunity-acquisition?tab=outreach",
      };
    }
  } catch {}

  // Interested replies needing follow-up
  try {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const followUps = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_reply_events r
      JOIN opportunity_acquisition_opportunities o ON o.id = r.opportunity_id
      WHERE r.org_id = ${orgId}
        AND r.classification IN ('interested', 'information_request')
        AND o.status NOT IN ('won', 'lost', 'meeting_requested')
        AND r.created_at < ${fiveDaysAgo}
    `));
    const cnt = n(followUps[0]?.cnt ?? 0);
    if (cnt > 0) {
      return {
        title: `Follow up with ${cnt} interested prospect${cnt > 1 ? "s" : ""}`,
        description: `${cnt} interested prospect${cnt > 1 ? "s have" : " has"} not been followed up in 5+ days.`,
        priority: "high",
        route: "/admin/opportunity-acquisition?tab=replies",
      };
    }
  } catch {}

  // Pending executive recommendations
  try {
    const recs = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_recommendations
      WHERE org_id = ${orgId}
        AND status = 'pending'
    `).catch(() => []));
    const cnt = n(recs[0]?.cnt ?? 0);
    if (cnt > 0) {
      return {
        title: `Review ${cnt} executive recommendation${cnt > 1 ? "s" : ""}`,
        description: `${cnt} AI-generated recommendation${cnt > 1 ? "s" : ""} await${cnt === 1 ? "s" : ""} your review in the Executive Intelligence tab.`,
        priority: "medium",
        route: "/admin/opportunity-acquisition?tab=executive",
      };
    }
  } catch {}

  // Encourage running learning analysis
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const recentLearning = rows(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM opportunity_agent_events
      WHERE org_id = ${orgId}
        AND action LIKE '%Learning analysis%'
        AND created_at >= ${fourteenDaysAgo}
    `));
    const cnt = n(recentLearning[0]?.cnt ?? 0);
    if (cnt === 0) {
      return {
        title: "Run learning analysis",
        description: "Hermes hasn't analyzed your pipeline performance in 14+ days. Run a fresh analysis to surface optimization insights.",
        priority: "low",
        route: "/admin/opportunity-acquisition?tab=learning",
      };
    }
  } catch {}

  return null;
}

// ─── Heartbeat summary ─────────────────────────────────────────────────────────

export async function getOpportunityHeartbeatSummary(orgId: string): Promise<OpportunityHeartbeatSummary> {
  // Pipeline metrics
  const statsRaw = rows(await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE TRUE)                                    AS total,
      COUNT(*) FILTER (WHERE status = 'qualified')                    AS qualified,
      COUNT(*) FILTER (WHERE status = 'contacted')                    AS contacted,
      COUNT(*) FILTER (WHERE status = 'replied')                      AS replied,
      COUNT(*) FILTER (WHERE status = 'meeting_requested')            AS meetings,
      COUNT(*) FILTER (WHERE status = 'won')                          AS wins,
      COUNT(*) FILTER (WHERE status = 'lost')                         AS losses
    FROM opportunity_acquisition_opportunities
    WHERE org_id = ${orgId}
  `).catch(() => []));

  const statsRow = statsRaw[0] ?? {};

  const replyMetrics = rows(await db.execute(sql`
    SELECT COUNT(*) AS total_replies
    FROM opportunity_reply_events
    WHERE org_id = ${orgId}
  `).catch(() => []));

  const pendingDraftsRaw = rows(await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM opportunity_outreach_drafts
    WHERE org_id = ${orgId} AND status = 'approved'
  `).catch(() => []));

  const pendingRecsRaw = rows(await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM opportunity_recommendations
    WHERE org_id = ${orgId} AND status = 'pending'
  `).catch(() => []));

  const opportunitiesFound  = n(statsRow.total);
  const qualified           = n(statsRow.qualified);
  const contacted           = n(statsRow.contacted);
  const replies             = n(replyMetrics[0]?.total_replies ?? 0);
  const meetings            = n(statsRow.meetings);
  const wins                = n(statsRow.wins);
  const losses              = n(statsRow.losses);
  const pendingDrafts       = n(pendingDraftsRaw[0]?.cnt ?? 0);
  const pendingRecommendations = n(pendingRecsRaw[0]?.cnt ?? 0);

  // Best action
  const bestAction = await generateBestAction(orgId).catch(() => null);

  // Health checks
  const healthChecks = await evaluateHealthChecks(orgId).catch(() => [] as OpportunityHealthCheck[]);

  // Executive summary
  const replyRate = opportunitiesFound > 0 ? Math.round((replies / opportunitiesFound) * 100) : 0;
  const failedChecks = healthChecks.filter(c => !c.passed);
  let summaryParts: string[] = [];

  if (opportunitiesFound === 0) {
    summaryParts.push("No opportunities have been discovered yet. Run a discovery scan to begin.");
  } else {
    summaryParts.push(`Opportunity Acquisition has identified ${opportunitiesFound} prospect${opportunitiesFound !== 1 ? "s" : ""}, with ${qualified} qualified and ${replies} repl${replies !== 1 ? "ies" : "y"} (${replyRate}% reply rate).`);
    if (meetings > 0) summaryParts.push(`${meetings} meeting request${meetings > 1 ? "s" : ""} have been generated.`);
    if (wins > 0) summaryParts.push(`${wins} opportunit${wins > 1 ? "ies" : "y"} closed as won.`);
    if (pendingDrafts > 0) summaryParts.push(`${pendingDrafts} approved draft${pendingDrafts > 1 ? "s" : ""} await${pendingDrafts === 1 ? "s" : ""} sending.`);
  }
  if (failedChecks.length > 0) {
    const critical = failedChecks.filter(c => c.severity === "critical" || c.severity === "high");
    if (critical.length > 0) {
      summaryParts.push(`⚠ ${critical.length} health alert${critical.length > 1 ? "s" : ""} require attention: ${critical.map(c => c.label).join(", ")}.`);
    }
  }

  return {
    opportunitiesFound,
    qualified,
    contacted,
    replies,
    meetings,
    wins,
    losses,
    pendingDrafts,
    pendingRecommendations,
    bestAction,
    executiveSummary: summaryParts.join(" "),
    healthChecks,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Attention inbox integration ───────────────────────────────────────────────

async function createAttentionSignals(
  orgId: string,
  checks: OpportunityHealthCheck[],
  summary: OpportunityHeartbeatSummary,
): Promise<number> {
  let created = 0;
  const now = new Date().toISOString().slice(0, 10); // date bucket for idempotency

  const severityScores: Record<string, { severity: number; urgency: number; businessImpact: number; level: string }> = {
    critical: { severity: 90, urgency: 90, businessImpact: 85, level: "critical" },
    high:     { severity: 70, urgency: 75, businessImpact: 70, level: "important" },
    medium:   { severity: 50, urgency: 50, businessImpact: 55, level: "suggested" },
    low:      { severity: 20, urgency: 15, businessImpact: 25, level: "informational" },
  };

  for (const check of checks.filter(c => !c.passed)) {
    const scores = severityScores[check.severity] ?? severityScores.medium;
    const sourceId = `opp-health-${check.id}-${orgId}-${now}`;
    try {
      await db.insert(attentionItems).values({
        orgId,
        level: scores.level as any,
        category: "opportunity_acquisition",
        title: `Opportunity Acquisition: ${check.label}`,
        body: check.detail,
        source: "opportunity_coordinator",
        sourceId,
        severity: scores.severity,
        urgency: scores.urgency,
        businessImpact: scores.businessImpact,
        confidence: 0.90,
        actionUrl: "/admin/opportunity-acquisition",
      }).catch(() => {});
      created++;
    } catch {}
  }

  // Meeting request alert (always create if pending)
  if (summary.meetings > 0) {
    const meetingSourceId = `opp-meeting-req-${orgId}-${now}`;
    try {
      await db.insert(attentionItems).values({
        orgId,
        level: "critical" as any,
        category: "opportunity_acquisition",
        title: `Meeting request requires response`,
        body: `${summary.meetings} prospect${summary.meetings > 1 ? "s have" : " has"} requested a meeting through the Opportunity Acquisition pipeline. Respond promptly to maximize close rate.`,
        source: "opportunity_coordinator",
        sourceId: meetingSourceId,
        severity: 90,
        urgency: 90,
        businessImpact: 85,
        confidence: 0.95,
        actionUrl: "/admin/opportunity-acquisition?tab=replies",
      }).catch(() => {});
      created++;
    } catch {}
  }

  // Pending drafts signal
  if (summary.pendingDrafts >= 3) {
    const draftSourceId = `opp-pending-drafts-${orgId}-${now}`;
    try {
      await db.insert(attentionItems).values({
        orgId,
        level: "suggested" as any,
        category: "opportunity_acquisition",
        title: `${summary.pendingDrafts} approved drafts waiting to send`,
        body: `${summary.pendingDrafts} outreach drafts have been approved but not yet sent. Visit the Outreach tab to send them.`,
        source: "opportunity_coordinator",
        sourceId: draftSourceId,
        severity: 50,
        urgency: 55,
        businessImpact: 60,
        confidence: 0.95,
        actionUrl: "/admin/opportunity-acquisition?tab=outreach",
      }).catch(() => {});
      created++;
    } catch {}
  }

  return created;
}

// ─── CEO Heartbeat review ──────────────────────────────────────────────────────

export async function runOpportunityHeartbeatReview(orgId: string): Promise<{
  checksRun: number;
  checksPassed: number;
  alertsCreated: number;
  bestAction: BestActionCandidate | null;
  executiveSummary: string;
}> {
  await logOppEvent(orgId, "Opportunity Coordinator", "Opportunity Review Started", "info");

  const summary = await getOpportunityHeartbeatSummary(orgId);
  const { healthChecks, bestAction, executiveSummary } = summary;

  const alertsCreated = await createAttentionSignals(orgId, healthChecks, summary);

  if (bestAction) {
    await logOppEvent(
      orgId,
      "Opportunity Coordinator",
      `Best Action Generated: ${bestAction.title}`,
      "info",
    );
  }

  await logOppEvent(
    orgId,
    "Opportunity Coordinator",
    `Heartbeat Summary Generated — ${healthChecks.filter(c => !c.passed).length} alert(s), ${alertsCreated} attention signal(s) created.`,
    "info",
  );

  await logOppEvent(orgId, "Opportunity Coordinator", "Opportunity Review Completed", "info");

  return {
    checksRun: healthChecks.length,
    checksPassed: healthChecks.filter(c => c.passed).length,
    alertsCreated,
    bestAction,
    executiveSummary,
  };
}

// ─── Main coordinator entrypoint ───────────────────────────────────────────────

export async function coordinateOpportunityAcquisition(orgId: string): Promise<{
  success: boolean;
  review: Awaited<ReturnType<typeof runOpportunityHeartbeatReview>> | null;
  error?: string;
}> {
  try {
    const review = await runOpportunityHeartbeatReview(orgId);
    return { success: true, review };
  } catch (err: any) {
    console.error("[OpportunityCoordinator] Error:", err.message);
    await logOppEvent(orgId, "Opportunity Coordinator", `Error during coordination: ${err.message}`, "error");
    return { success: false, review: null, error: err.message };
  }
}

// ─── Callable cycle functions (automation preparation) ─────────────────────────

export async function runOpportunityAcquisitionCycle(orgId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { runOpportunityDiscovery } = await import("../services/opportunity-discovery-agent").catch(() => ({ runOpportunityDiscovery: null }));
    if (runOpportunityDiscovery) await (runOpportunityDiscovery as Function)(orgId);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function runOpportunityLearningAnalysis(orgId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { runOpportunityLearning } = await import("../services/opportunity-learning-agent");
    await runOpportunityLearning(orgId);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function runOpportunityExecutiveAnalysis(orgId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { runOpportunityExecutiveAnalysis: run } = await import("../services/opportunity-executive-agent");
    await run(orgId);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
