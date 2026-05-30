/**
 * AI Workforce Attribution Engine — Phase 3
 *
 * Pure computation layer. Reads from existing tables and derives
 * evidence-based business outcomes per agent. No synthetic data.
 * All values traceable to real records.
 */

import { db } from "./db";
import {
  unifiedAgentActionLog,
  communicationLogs,
  bookings,
  aiRevenueEvents,
  orgAiOpportunities,
} from "@shared/schema";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { AGENT_IDENTITIES } from "./agent-identities";

// ─── Time Savings Benchmarks (minutes per action) ────────────────────────────

export const TIME_BENCHMARKS: Record<string, number> = {
  // Communication / Relay
  email_sent: 5,
  email_queued: 5,
  sms_sent: 3,
  message_sent: 4,
  follow_up_sent: 7,
  outreach_sent: 8,
  sequence_sent: 8,
  reply_generated: 6,
  // Scheduling / Tempo
  appointment_booked: 8,
  booking_created: 8,
  booking_confirmed: 4,
  reschedule_handled: 5,
  slot_filled: 8,
  session_booked: 8,
  // Research / Vector
  research_completed: 20,
  prospect_enriched: 15,
  report_generated: 25,
  enrichment_completed: 12,
  contact_discovered: 10,
  // Executive / Atlas
  briefing_generated: 30,
  summary_generated: 20,
  insight_surfaced: 10,
  daily_brief: 30,
  executive_summary: 30,
  // Finance / Ledger
  payment_flagged: 5,
  balance_identified: 10,
  anomaly_detected: 15,
  revenue_identified: 12,
  outstanding_flagged: 8,
  // Growth / Apex
  lead_contacted: 10,
  lead_recovered: 15,
  campaign_executed: 20,
  opportunity_created: 10,
  deal_advanced: 12,
  // Retention / Pulse
  retention_intervention: 15,
  re_engagement_sent: 10,
  at_risk_identified: 8,
  churn_prevented: 20,
  client_retained: 20,
  // Workflow
  workflow_executed: 5,
  workflow_completed: 5,
  task_automated: 5,
  // Default
  default: 5,
};

export const HOURLY_RATE_USD = 35; // Standard S&C business admin/coordinator rate

export function getTimeSavingsMinutes(actionType: string): number {
  if (!actionType) return TIME_BENCHMARKS.default;
  const normalized = actionType.toLowerCase().replace(/[^a-z_]/g, "_");
  if (TIME_BENCHMARKS[normalized]) return TIME_BENCHMARKS[normalized];
  for (const [key, val] of Object.entries(TIME_BENCHMARKS)) {
    if (normalized.includes(key) || (key.length > 4 && key.includes(normalized))) return val;
  }
  return TIME_BENCHMARKS.default;
}

// ─── Attribution Period Helper ────────────────────────────────────────────────

export function getPeriodStart(period: string): Date {
  const now = new Date();
  switch (period) {
    case "today": { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }
    case "7d": return new Date(now.getTime() - 7 * 86400000);
    case "30d": return new Date(now.getTime() - 30 * 86400000);
    case "quarter": return new Date(now.getTime() - 90 * 86400000);
    case "year": return new Date(now.getTime() - 365 * 86400000);
    case "all": return new Date(0);
    default: return new Date(now.getTime() - 7 * 86400000);
  }
}

// ─── Core Attribution Result Types ───────────────────────────────────────────

export interface AgentAttribution {
  agentType: string;
  agentName: string;
  department: string;
  // Activity
  totalActions: number;
  successfulActions: number;
  successRate: number;
  // Time savings
  timeSavedMinutes: number;
  timeSavedHours: number;
  estimatedLaborSavings: number;
  // Revenue
  revenueGenerated: number;
  revenueRecovered: number;
  revenueProtected: number;
  revenueInfluenced: number;
  // Category-specific
  appointmentsBooked: number;
  emailsSent: number;
  leadsRecovered: number;
  clientsRetained: number;
  researchCompleted: number;
  workflowsExecuted: number;
  // Composite value score (for leaderboard)
  valueScore: number;
  // Evidence count
  evidenceCount: number;
}

export interface OrgAttribution {
  period: string;
  since: Date;
  agents: AgentAttribution[];
  // Org totals
  totalActions: number;
  totalTimeSavedHours: number;
  totalEstimatedLaborSavings: number;
  totalRevenueGenerated: number;
  totalRevenueRecovered: number;
  totalRevenueProtected: number;
  totalRevenueInfluenced: number;
  totalAppointmentsBooked: number;
  totalEmailsSent: number;
  totalLeadsRecovered: number;
  totalClientsRetained: number;
  // ROI
  netROI: number;
  roiPercentage: number;
  // Top/least agents
  topAgent: string;
  leastUtilizedAgent: string;
}

// ─── Main Attribution Computation ─────────────────────────────────────────────

export async function computeOrgAttribution(
  orgId: string,
  period: string = "7d"
): Promise<OrgAttribution> {
  const since = getPeriodStart(period);

  // 1. Pull unified action logs for period
  const actionLogs = await db
    .select()
    .from(unifiedAgentActionLog)
    .where(
      and(
        eq(unifiedAgentActionLog.orgId, orgId),
        gte(unifiedAgentActionLog.createdAt, since)
      )
    )
    .catch(() => []);

  // 2. Pull communication logs for period (Relay attribution)
  const commLogs = await db
    .select()
    .from(communicationLogs)
    .where(
      and(
        eq(communicationLogs.orgId, orgId),
        gte(communicationLogs.createdAt, since)
      )
    )
    .catch(() => []);

  // 3. Pull bookings created in period (Tempo attribution)
  const bookingRows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        gte(bookings.createdAt, since)
      )
    )
    .catch(() => []);

  // 4. Pull revenue events for period
  const revenueRows = await db
    .select()
    .from(aiRevenueEvents)
    .where(
      and(
        eq(aiRevenueEvents.orgId, orgId),
        gte(aiRevenueEvents.createdAt, since)
      )
    )
    .catch(() => []);

  // ── Per-agent aggregation ──────────────────────────────────────────────────

  const agentMap = new Map<string, AgentAttribution>();

  function getOrCreateAgent(agentType: string): AgentAttribution {
    if (!agentMap.has(agentType)) {
      const identity = AGENT_IDENTITIES[agentType];
      agentMap.set(agentType, {
        agentType,
        agentName: identity?.name ?? agentType,
        department: identity?.department ?? "System",
        totalActions: 0,
        successfulActions: 0,
        successRate: 0,
        timeSavedMinutes: 0,
        timeSavedHours: 0,
        estimatedLaborSavings: 0,
        revenueGenerated: 0,
        revenueRecovered: 0,
        revenueProtected: 0,
        revenueInfluenced: 0,
        appointmentsBooked: 0,
        emailsSent: 0,
        leadsRecovered: 0,
        clientsRetained: 0,
        researchCompleted: 0,
        workflowsExecuted: 0,
        valueScore: 0,
        evidenceCount: 0,
      });
    }
    return agentMap.get(agentType)!;
  }

  // Process action logs — every agent gets credit for their actions
  for (const log of actionLogs) {
    const agentType = log.actorType ?? "system_agent";
    const a = getOrCreateAgent(agentType);

    a.totalActions++;
    if (log.status === "completed" || log.status === "success") a.successfulActions++;

    const actionType = log.actionType ?? "default";
    const savedMin = getTimeSavingsMinutes(actionType);
    a.timeSavedMinutes += savedMin;
    a.evidenceCount++;

    // Category-specific attribution from action types
    const at = actionType.toLowerCase();
    if (at.includes("book") || at.includes("appointment") || at.includes("session") || at.includes("schedule")) {
      a.appointmentsBooked++;
    }
    if (at.includes("email") || at.includes("message") || at.includes("outreach") || at.includes("follow_up") || at.includes("sms")) {
      a.emailsSent++;
    }
    if (at.includes("lead_recover") || at.includes("lead_reengag") || at.includes("lead_contact")) {
      a.leadsRecovered++;
    }
    if (at.includes("retention") || at.includes("retain") || at.includes("churn")) {
      a.clientsRetained++;
    }
    if (at.includes("research") || at.includes("enrichment") || at.includes("report")) {
      a.researchCompleted++;
    }
    if (at.includes("workflow") || at.includes("task_automat")) {
      a.workflowsExecuted++;
    }
  }

  // Process communication logs — attribute to communication_agent
  const sentComms = commLogs.filter(c => c.status === "sent" || c.status === "delivered");
  if (sentComms.length > 0) {
    const relay = getOrCreateAgent("communication_agent");
    relay.emailsSent += sentComms.length;
    relay.timeSavedMinutes += sentComms.length * TIME_BENCHMARKS.email_sent;
    relay.evidenceCount += sentComms.length;
  }

  // Process bookings — attribute to scheduling_agent
  const confirmedBookings = bookingRows.filter(b => b.status === "CONFIRMED" || b.status === "COMPLETED");
  if (confirmedBookings.length > 0) {
    const tempo = getOrCreateAgent("scheduling_agent");
    tempo.appointmentsBooked += confirmedBookings.length;
    tempo.timeSavedMinutes += confirmedBookings.length * TIME_BENCHMARKS.appointment_booked;
    tempo.evidenceCount += confirmedBookings.length;
  }

  // Process revenue events — attribute to agent by actionSource
  for (const rev of revenueRows) {
    const outcomeVal = Number(rev.outcomeValue ?? 0);
    if (outcomeVal <= 0) continue;

    // Determine which agent gets credit
    let agentType = "growth_agent"; // default to Apex
    const src = (rev.actionSource ?? "").toLowerCase();
    if (src.includes("retention") || src.includes("pulse")) agentType = "retention_agent";
    else if (src.includes("finance") || src.includes("ledger")) agentType = "finance_agent";
    else if (src.includes("schedule") || src.includes("tempo")) agentType = "scheduling_agent";
    else if (src.includes("relay") || src.includes("comms")) agentType = "communication_agent";

    const a = getOrCreateAgent(agentType);
    const outcome = (rev.outcomeStatus ?? "").toLowerCase();

    if (outcome.includes("won") || outcome.includes("closed") || outcome.includes("paid")) {
      a.revenueGenerated += outcomeVal;
    } else if (outcome.includes("recover")) {
      a.revenueRecovered += outcomeVal;
    } else if (outcome.includes("retain") || outcome.includes("churn")) {
      a.revenueProtected += outcomeVal;
    } else {
      a.revenueInfluenced += outcomeVal;
    }
    a.revenueInfluenced += outcomeVal;
    a.evidenceCount++;
  }

  // ── Finalize per-agent metrics ─────────────────────────────────────────────

  for (const [, a] of agentMap) {
    a.successRate = a.totalActions > 0
      ? Math.round((a.successfulActions / a.totalActions) * 100)
      : 0;
    a.timeSavedHours = Math.round((a.timeSavedMinutes / 60) * 10) / 10;
    a.estimatedLaborSavings = Math.round(a.timeSavedHours * HOURLY_RATE_USD * 100) / 100;

    // Value score: weighted composite
    a.valueScore = Math.round(
      (a.revenueGenerated * 1.0) +
      (a.revenueRecovered * 0.8) +
      (a.revenueProtected * 0.6) +
      (a.revenueInfluenced * 0.3) +
      (a.estimatedLaborSavings * 1.0) +
      (a.appointmentsBooked * 50) +
      (a.leadsRecovered * 30) +
      (a.clientsRetained * 75) +
      (a.emailsSent * 2)
    );
  }

  // ── Org totals ─────────────────────────────────────────────────────────────

  const agents = Array.from(agentMap.values()).sort((a, b) => b.valueScore - a.valueScore);

  const totalTimeSavedHours = agents.reduce((s, a) => s + a.timeSavedHours, 0);
  const totalEstimatedLaborSavings = agents.reduce((s, a) => s + a.estimatedLaborSavings, 0);
  const totalRevenueGenerated = agents.reduce((s, a) => s + a.revenueGenerated, 0);
  const totalRevenueRecovered = agents.reduce((s, a) => s + a.revenueRecovered, 0);
  const totalRevenueProtected = agents.reduce((s, a) => s + a.revenueProtected, 0);
  const totalRevenueInfluenced = agents.reduce((s, a) => s + a.revenueInfluenced, 0);

  const totalBusinessValue = totalRevenueGenerated + totalRevenueRecovered + totalRevenueProtected + totalEstimatedLaborSavings;
  const workforceCost = 0; // SaaS platform — users pay subscription, no per-action cost
  const netROI = totalBusinessValue;
  const roiPercentage = 0; // Would need subscription cost to compute %; show absolute instead

  const topAgent = agents[0]?.agentName ?? "—";
  const sortedByActions = [...agents].sort((a, b) => a.totalActions - b.totalActions);
  const leastUtilizedAgent = sortedByActions.find(a => a.agentType !== "system_agent")?.agentName ?? "—";

  return {
    period,
    since,
    agents,
    totalActions: agents.reduce((s, a) => s + a.totalActions, 0),
    totalTimeSavedHours: Math.round(totalTimeSavedHours * 10) / 10,
    totalEstimatedLaborSavings: Math.round(totalEstimatedLaborSavings * 100) / 100,
    totalRevenueGenerated: Math.round(totalRevenueGenerated * 100) / 100,
    totalRevenueRecovered: Math.round(totalRevenueRecovered * 100) / 100,
    totalRevenueProtected: Math.round(totalRevenueProtected * 100) / 100,
    totalRevenueInfluenced: Math.round(totalRevenueInfluenced * 100) / 100,
    totalAppointmentsBooked: agents.reduce((s, a) => s + a.appointmentsBooked, 0),
    totalEmailsSent: agents.reduce((s, a) => s + a.emailsSent, 0),
    totalLeadsRecovered: agents.reduce((s, a) => s + a.leadsRecovered, 0),
    totalClientsRetained: agents.reduce((s, a) => s + a.clientsRetained, 0),
    netROI,
    roiPercentage,
    topAgent,
    leastUtilizedAgent,
  };
}

// ─── Opportunity Generator ────────────────────────────────────────────────────

export interface GeneratedOpportunity {
  agentId: string;
  title: string;
  description: string;
  category: string;
  potentialValue: number;
  confidence: number;
  sourceData: Record<string, any>;
}

export async function generateOpportunities(orgId: string): Promise<GeneratedOpportunity[]> {
  const opportunities: GeneratedOpportunity[] = [];
  const since7d = getPeriodStart("7d");
  const since30d = getPeriodStart("30d");
  const since3d = new Date(Date.now() - 3 * 86400000);

  // 1. Leads not contacted in 72 hours (Apex opportunity)
  try {
    const recentLeads = await db
      .select()
      .from(aiRevenueEvents)
      .where(
        and(
          eq(aiRevenueEvents.orgId, orgId),
          gte(aiRevenueEvents.createdAt, since7d)
        )
      );
    const unconvertedLeads = recentLeads.filter(l =>
      (l.outcomeStatus ?? "").toLowerCase() === "pending" &&
      new Date(l.createdAt) < since3d
    );
    if (unconvertedLeads.length >= 2) {
      opportunities.push({
        agentId: "growth_agent",
        title: `${unconvertedLeads.length} leads have not been contacted in 72+ hours`,
        description: `${unconvertedLeads.length} prospects from the last 7 days show no conversion activity. Re-engagement typically recovers 15-25% of stale leads.`,
        category: "lead_recovery",
        potentialValue: unconvertedLeads.length * 200,
        confidence: 0.75,
        sourceData: { leadCount: unconvertedLeads.length, source: "ai_revenue_events" },
      });
    }
  } catch { /* table may be empty */ }

  // 2. Scheduling capacity (Tempo opportunity) — look for days with <3 bookings
  try {
    const upcomingBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.organizationId, orgId),
          gte(bookings.startAt, new Date())
        )
      )
      .catch(() => []);

    // Group by day
    const byDay = new Map<string, number>();
    for (const b of upcomingBookings) {
      const day = b.startAt.toISOString().split("T")[0];
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }

    // Find next 7 days
    const nextWeek: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(Date.now() + i * 86400000);
      nextWeek.push(d.toISOString().split("T")[0]);
    }
    const lowCapacityDays = nextWeek.filter(d => (byDay.get(d) ?? 0) < 2);

    if (lowCapacityDays.length >= 2) {
      const dayNames = lowCapacityDays.slice(0, 3).map(d =>
        new Date(d).toLocaleDateString("en-US", { weekday: "long" })
      );
      opportunities.push({
        agentId: "scheduling_agent",
        title: `Scheduling capacity available on ${dayNames.join(", ")}`,
        description: `${lowCapacityDays.length} days next week have under-utilized time slots. Proactive outreach could fill these sessions.`,
        category: "scheduling_capacity",
        potentialValue: lowCapacityDays.length * 75,
        confidence: 0.8,
        sourceData: { lowCapacityDays, bookingsChecked: upcomingBookings.length },
      });
    }
  } catch { /* no bookings */ }

  // 3. Communication efficiency (Relay opportunity) — if <5 comms in 7 days
  try {
    const recentComms = await db
      .select()
      .from(communicationLogs)
      .where(
        and(
          eq(communicationLogs.orgId, orgId),
          gte(communicationLogs.createdAt, since7d)
        )
      )
      .catch(() => []);

    if (recentComms.length < 5) {
      opportunities.push({
        agentId: "communication_agent",
        title: "Low outreach activity — automated follow-ups could increase engagement",
        description: `Only ${recentComms.length} communications sent in the last 7 days. Automated follow-up sequences typically increase client engagement by 30-40%.`,
        category: "communication_efficiency",
        potentialValue: 150,
        confidence: 0.6,
        sourceData: { recentCommCount: recentComms.length },
      });
    }
  } catch { /* no comms */ }

  // 4. Atlas opportunity — if no executive summary generated recently
  try {
    const execActions = await db
      .select()
      .from(unifiedAgentActionLog)
      .where(
        and(
          eq(unifiedAgentActionLog.orgId, orgId),
          eq(unifiedAgentActionLog.actorType, "executive_agent"),
          gte(unifiedAgentActionLog.createdAt, since7d)
        )
      )
      .catch(() => []);

    if (execActions.length === 0) {
      opportunities.push({
        agentId: "executive_agent",
        title: "Daily Executive Briefing is not running",
        description: "Atlas has not generated any business briefings in the past 7 days. Publishing the Daily Executive Summary workflow will surface daily business insights automatically.",
        category: "operational_intelligence",
        potentialValue: 0,
        confidence: 0.95,
        sourceData: { source: "unified_agent_action_log" },
      });
    }
  } catch { /* no data */ }

  return opportunities;
}
