import { db } from "./db";
import { storage } from "./storage";
import { bookings, services, agentActions, availabilityBlocks, coachProfiles } from "@shared/schema";
import { eq, and, gte, lte, ne, desc } from "drizzle-orm";
import { startOfWeek, endOfWeek, subWeeks, format, differenceInDays } from "date-fns";

// ============================================================
// TYPES
// ============================================================

export interface WeeklyTargets {
  revenueCents?: number;
  sessions?: number;
  retentionPct?: number;
  utilizationPct?: number;
  weekStartDate: string;
  setAt: string;
}

export interface GoalProgress {
  dimension: "revenue" | "sessions" | "retention" | "utilization";
  label: string;
  target: number;
  targetLabel: string;
  current: number;
  currentLabel: string;
  gap: number;
  gapLabel: string;
  pctComplete: number;
  pctCompleteLabel: string;
  onTrack: boolean;
  projectedOutcome: number;
  projectedOutcomeLabel: string;
  projectedOnTrack: boolean;
  status: "on_track" | "at_risk" | "behind" | "exceeded";
  statusLabel: string;
  urgency: "critical" | "high" | "medium" | "good";
}

export interface WeeklyProgress {
  weekOf: string;
  weekStartDate: string;
  weekEndDate: string;
  daysElapsed: number;
  daysRemaining: number;
  hasTargets: boolean;
  progress: GoalProgress[];
  overallStatus: "on_track" | "at_risk" | "behind" | "exceeded" | "no_targets";
  overallStatusLabel: string;
  topGap: GoalProgress | null;
  summary: string;
  agentNote: string;
}

export interface GoalPriorityWeights {
  revenue: number;
  sessions: number;
  retention: number;
  utilization: number;
  dominantGoal: "revenue" | "sessions" | "retention" | "utilization" | "balanced";
  dominantGoalNote: string;
}

export interface GoalPerformanceSummary {
  weekOf: string;
  targets: WeeklyTargets | null;
  results: {
    dimension: "revenue" | "sessions" | "retention" | "utilization";
    label: string;
    target: number;
    targetLabel: string;
    actual: number;
    actualLabel: string;
    achieved: boolean;
    pctAchieved: number;
  }[];
  topContributingActions: { actionSubType: string; count: number; revenueCents: number; conversionRate: number }[];
  bestStrategy: string;
  whatToChangeNextWeek: string[];
  overallAchieved: boolean;
  achievedCount: number;
  totalTargets: number;
  summary: string;
}

// ============================================================
// STORAGE HELPERS
// ============================================================

function targetsKey(orgId: string): string {
  return `weekly_targets_${orgId}`;
}

export async function setWeeklyTargets(
  orgId: string,
  targets: Omit<WeeklyTargets, "weekStartDate" | "setAt">
): Promise<WeeklyTargets> {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday

  const stored: WeeklyTargets = {
    ...targets,
    weekStartDate: format(weekStart, "yyyy-MM-dd"),
    setAt: now.toISOString(),
  };

  await storage.setSetting(targetsKey(orgId), JSON.stringify(stored));
  return stored;
}

export async function getWeeklyTargets(orgId: string): Promise<WeeklyTargets | null> {
  try {
    const raw = await storage.getSetting(targetsKey(orgId));
    if (!raw) return null;
    return JSON.parse(raw) as WeeklyTargets;
  } catch {
    return null;
  }
}

// ============================================================
// PHASE 1 — WEEKLY PROGRESS COMPUTATION
// ============================================================

export async function getWeeklyProgress(orgId: string): Promise<WeeklyProgress> {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const daysElapsed = Math.max(1, differenceInDays(now, weekStart));
  const daysRemaining = Math.max(0, differenceInDays(weekEnd, now));
  const daysInWeek = 7;

  const targets = await getWeeklyTargets(orgId);

  if (!targets) {
    return {
      weekOf: `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`,
      weekStartDate: weekStart.toISOString(),
      weekEndDate: weekEnd.toISOString(),
      daysElapsed,
      daysRemaining,
      hasTargets: false,
      progress: [],
      overallStatus: "no_targets",
      overallStatusLabel: "No targets set",
      topGap: null,
      summary: "No weekly targets set. Ask the agent to set targets — e.g. 'Set a $5,000 revenue goal this week'.",
      agentNote: "No targets configured yet.",
    };
  }

  // Fetch this week's bookings
  const weekBookings = await db
    .select({
      id: bookings.id,
      serviceId: bookings.serviceId,
      clientId: bookings.clientId,
      startAt: bookings.startAt,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        gte(bookings.startAt, weekStart),
        lte(bookings.startAt, weekEnd),
        ne(bookings.status, "CANCELLED")
      )
    );

  // Service prices
  const allServices = await db.select().from(services).where(eq(services.organizationId, orgId));
  const priceMap: Record<string, number> = {};
  for (const s of allServices) priceMap[s.id] = s.priceCents;

  const currentRevenueCents = weekBookings.reduce((s, b) => s + (priceMap[b.serviceId] ?? 0), 0);
  const currentSessions = weekBookings.length;

  // Project end-of-week based on pace
  const paceMultiplier = daysElapsed > 0 ? daysInWeek / daysElapsed : 1;
  const projectedRevenueCents = Math.round(currentRevenueCents * paceMultiplier);
  const projectedSessions = Math.round(currentSessions * paceMultiplier);

  const progress: GoalProgress[] = [];

  // Revenue goal
  if (targets.revenueCents) {
    const g = makeGoalProgress(
      "revenue",
      "Weekly Revenue",
      targets.revenueCents,
      currentRevenueCents,
      projectedRevenueCents,
      (v) => `$${(v / 100).toFixed(0)}`,
      daysElapsed,
      daysInWeek
    );
    progress.push(g);
  }

  // Sessions goal
  if (targets.sessions) {
    const g = makeGoalProgress(
      "sessions",
      "Sessions This Week",
      targets.sessions,
      currentSessions,
      projectedSessions,
      (v) => `${v} session${v !== 1 ? "s" : ""}`,
      daysElapsed,
      daysInWeek
    );
    progress.push(g);
  }

  // Retention goal (% of clients who had a session in last 30 days that also booked this week)
  if (targets.retentionPct) {
    const since30 = new Date(now);
    since30.setDate(since30.getDate() - 30);

    const recentClientIds = new Set(
      (await db
        .select({ clientId: bookings.clientId })
        .from(bookings)
        .where(
          and(
            eq(bookings.organizationId, orgId),
            gte(bookings.startAt, since30),
            ne(bookings.status, "CANCELLED")
          )
        )).map(b => b.clientId)
    );

    const activeTotal = recentClientIds.size;
    const retained = weekBookings.filter(b => recentClientIds.has(b.clientId)).length;
    const retainedUniqueClients = new Set(
      weekBookings.filter(b => recentClientIds.has(b.clientId)).map(b => b.clientId)
    ).size;
    const currentRetentionPct = activeTotal > 0 ? Math.round((retainedUniqueClients / activeTotal) * 100) : 0;
    const projectedRetentionPct = Math.min(100, Math.round(currentRetentionPct * paceMultiplier * 0.5 + currentRetentionPct * 0.5));

    const g = makeGoalProgress(
      "retention",
      "Client Retention Rate",
      targets.retentionPct,
      currentRetentionPct,
      projectedRetentionPct,
      (v) => `${v}%`,
      daysElapsed,
      daysInWeek
    );
    progress.push(g);
  }

  // Utilization goal
  if (targets.utilizationPct) {
    try {
      const coaches = await storage.getCoachProfilesByOrganization(orgId);
      const coachIds = coaches.map((c: any) => c.id);
      let totalSlots = 0;
      let bookedSlots = 0;

      if (coachIds.length > 0) {
        const availBlocks = (await Promise.all(
          coachIds.map((id: string) => storage.getAvailabilityBlocks(id))
        )).flat();
        totalSlots = availBlocks.length * daysInWeek;
        bookedSlots = weekBookings.length;
      }

      const currentUtilPct = totalSlots > 0 ? Math.min(100, Math.round((bookedSlots / totalSlots) * 100)) : 0;
      const projectedUtilPct = Math.min(100, Math.round(currentUtilPct * paceMultiplier * 0.6 + currentUtilPct * 0.4));

      const g = makeGoalProgress(
        "utilization",
        "Schedule Utilization",
        targets.utilizationPct,
        currentUtilPct,
        projectedUtilPct,
        (v) => `${v}%`,
        daysElapsed,
        daysInWeek
      );
      progress.push(g);
    } catch { /* skip if utilization data unavailable */ }
  }

  // Overall status
  const behind = progress.filter(p => p.status === "behind");
  const atRisk = progress.filter(p => p.status === "at_risk");
  const exceeded = progress.filter(p => p.status === "exceeded");

  let overallStatus: WeeklyProgress["overallStatus"] = "on_track";
  let overallStatusLabel = "On Track";

  if (behind.length > 0) {
    overallStatus = "behind";
    overallStatusLabel = `Behind on ${behind.length} target${behind.length !== 1 ? "s" : ""}`;
  } else if (atRisk.length > 0) {
    overallStatus = "at_risk";
    overallStatusLabel = `At risk on ${atRisk.length} target${atRisk.length !== 1 ? "s" : ""}`;
  } else if (exceeded.length === progress.length && progress.length > 0) {
    overallStatus = "exceeded";
    overallStatusLabel = "All targets exceeded";
  }

  const topGap = [...behind, ...atRisk].sort((a, b) => a.pctComplete - b.pctComplete)[0] ?? null;

  // Agent note
  let agentNote = "";
  if (topGap) {
    if (topGap.dimension === "revenue") {
      agentNote = `You're behind your revenue target — prioritizing upsell and backfill actions to close the $${(topGap.gap / 100).toFixed(0)} gap.`;
    } else if (topGap.dimension === "sessions") {
      agentNote = `Session count is behind target — prioritizing slot-filling and re-engagement outreach.`;
    } else if (topGap.dimension === "retention") {
      agentNote = `Retention is dropping — shifting focus to churn recovery to protect your active client base.`;
    } else if (topGap.dimension === "utilization") {
      agentNote = `Utilization is low — prioritizing backfill outreach to fill open slots.`;
    }
  } else if (progress.length > 0) {
    agentNote = `All targets on track. ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining this week.`;
  } else {
    agentNote = "No targets set yet.";
  }

  const summary = progress.length === 0
    ? "No targets configured this week."
    : `${overallStatusLabel}. ${daysElapsed}/${daysInWeek} days elapsed. ${topGap ? `Biggest gap: ${topGap.label} at ${topGap.pctCompleteLabel}.` : "All targets on pace."}`;

  return {
    weekOf: `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`,
    weekStartDate: weekStart.toISOString(),
    weekEndDate: weekEnd.toISOString(),
    daysElapsed,
    daysRemaining,
    hasTargets: true,
    progress,
    overallStatus,
    overallStatusLabel,
    topGap,
    summary,
    agentNote,
  };
}

function makeGoalProgress(
  dimension: GoalProgress["dimension"],
  label: string,
  target: number,
  current: number,
  projected: number,
  fmt: (v: number) => string,
  daysElapsed: number,
  daysInWeek: number
): GoalProgress {
  const pctComplete = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  // Expected pace: what % should we be at by now
  const expectedPct = Math.round((daysElapsed / daysInWeek) * 100);

  let status: GoalProgress["status"];
  let statusLabel: string;
  let urgency: GoalProgress["urgency"];

  const pctBehindPace = expectedPct - pctComplete;

  if (current >= target) {
    status = "exceeded";
    statusLabel = "Target Exceeded";
    urgency = "good";
  } else if (pctBehindPace <= 5) {
    status = "on_track";
    statusLabel = "On Track";
    urgency = "good";
  } else if (pctBehindPace <= 20) {
    status = "at_risk";
    statusLabel = "At Risk";
    urgency = "medium";
  } else if (pctBehindPace <= 40) {
    status = "behind";
    statusLabel = "Behind";
    urgency = "high";
  } else {
    status = "behind";
    statusLabel = "Significantly Behind";
    urgency = "critical";
  }

  const gap = Math.max(0, target - current);
  const projectedOnTrack = projected >= target;

  return {
    dimension,
    label,
    target,
    targetLabel: fmt(target),
    current,
    currentLabel: fmt(current),
    gap,
    gapLabel: gap > 0 ? fmt(gap) : "None — target met!",
    pctComplete,
    pctCompleteLabel: `${pctComplete}%`,
    onTrack: status === "on_track" || status === "exceeded",
    projectedOutcome: projected,
    projectedOutcomeLabel: fmt(projected),
    projectedOnTrack,
    status,
    statusLabel,
    urgency,
  };
}

// ============================================================
// PHASE 2 — GOAL PRIORITY WEIGHTS
// ============================================================

export async function getGoalPriorityWeights(orgId: string): Promise<GoalPriorityWeights> {
  const progress = await getWeeklyProgress(orgId);

  if (!progress.hasTargets || progress.progress.length === 0) {
    return {
      revenue: 1.0,
      sessions: 1.0,
      retention: 1.0,
      utilization: 1.0,
      dominantGoal: "balanced",
      dominantGoalNote: "No targets set — using balanced weights.",
    };
  }

  const weights: Record<GoalProgress["dimension"], number> = {
    revenue: 1.0,
    sessions: 1.0,
    retention: 1.0,
    utilization: 1.0,
  };

  let dominantGoal: GoalPriorityWeights["dominantGoal"] = "balanced";
  let dominantGoalNote = "All targets on track — balanced weighting.";
  let highestUrgencyScore = 0;

  for (const p of progress.progress) {
    const urgencyBoost =
      p.urgency === "critical" ? 2.5
      : p.urgency === "high" ? 1.8
      : p.urgency === "medium" ? 1.3
      : 1.0;

    weights[p.dimension] = urgencyBoost;

    const urgencyScore =
      p.urgency === "critical" ? 4
      : p.urgency === "high" ? 3
      : p.urgency === "medium" ? 2
      : 1;

    if (urgencyScore > highestUrgencyScore) {
      highestUrgencyScore = urgencyScore;
      dominantGoal = p.dimension;
      if (p.dimension === "revenue") {
        dominantGoalNote = `Behind revenue target (${p.pctCompleteLabel} of ${p.targetLabel}) — boosting upsell, backfill, and high-revenue actions.`;
      } else if (p.dimension === "sessions") {
        dominantGoalNote = `Behind session target (${p.pctCompleteLabel} of ${p.targetLabel}) — boosting slot-filling and re-engagement outreach.`;
      } else if (p.dimension === "retention") {
        dominantGoalNote = `Retention dropping (${p.pctCompleteLabel} of ${p.targetLabel} goal) — boosting churn recovery actions.`;
      } else if (p.dimension === "utilization") {
        dominantGoalNote = `Utilization low (${p.pctCompleteLabel} of ${p.targetLabel} goal) — boosting backfill and slot-filling outreach.`;
      }
    }
  }

  return {
    revenue: weights.revenue,
    sessions: weights.sessions,
    retention: weights.retention,
    utilization: weights.utilization,
    dominantGoal,
    dominantGoalNote,
  };
}

// Map action categories/subtypes to goal dimensions they contribute to
export function getActionGoalDimension(
  category: string,
  subType: string
): GoalProgress["dimension"] {
  if (["upsell", "Upsell Opportunity"].includes(category) || subType === "upsell") return "revenue";
  if (["Follow-Up Due", "Open Slots", "backfill"].includes(category) || subType === "backfill") return "utilization";
  if (["Churn Risk", "Churn Risk (Medium)", "churn_risk", "inactive"].includes(category) || subType === "churn_risk") return "retention";
  if (["Package Expiring", "Low Sessions", "renewal", "low_sessions"].includes(category)) return "sessions";
  return "revenue"; // default — most actions contribute to revenue
}

// ============================================================
// PHASE 5 — GOAL PERFORMANCE SUMMARY
// ============================================================

export async function getGoalPerformanceSummary(orgId: string): Promise<GoalPerformanceSummary> {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  const targets = await getWeeklyTargets(orgId);

  // This week's bookings
  const weekBookings = await db
    .select({
      serviceId: bookings.serviceId,
      clientId: bookings.clientId,
      startAt: bookings.startAt,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, orgId),
        gte(bookings.startAt, weekStart),
        lte(bookings.startAt, weekEnd),
        ne(bookings.status, "CANCELLED")
      )
    );

  const allServices = await db.select().from(services).where(eq(services.organizationId, orgId));
  const priceMap: Record<string, number> = {};
  for (const s of allServices) priceMap[s.id] = s.priceCents;

  const actualRevenueCents = weekBookings.reduce((s, b) => s + (priceMap[b.serviceId] ?? 0), 0);
  const actualSessions = weekBookings.length;

  // Top contributing agent actions this week
  const weekActions = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.organizationId, orgId),
        gte(agentActions.createdAt, weekStart),
        lte(agentActions.createdAt, weekEnd),
        eq(agentActions.actionType, "outreach")
      )
    );

  const actionTypeMap: Record<string, { count: number; booked: number; revenueCents: number }> = {};
  for (const a of weekActions) {
    const key = a.actionSubType ?? "general";
    if (!actionTypeMap[key]) actionTypeMap[key] = { count: 0, booked: 0, revenueCents: 0 };
    if (["sent", "responded", "booked", "ignored"].includes(a.status ?? "")) actionTypeMap[key].count++;
    if (a.status === "booked") { actionTypeMap[key].booked++; actionTypeMap[key].revenueCents += a.outcomeValueCents ?? 0; }
  }

  const topContributingActions = Object.entries(actionTypeMap)
    .map(([subType, d]) => ({
      actionSubType: subType,
      count: d.count,
      revenueCents: d.revenueCents,
      conversionRate: d.count > 0 ? Math.round((d.booked / d.count) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 3);

  // Build results vs targets
  const results: GoalPerformanceSummary["results"] = [];
  let achievedCount = 0;
  const totalTargets = targets
    ? [targets.revenueCents, targets.sessions, targets.retentionPct, targets.utilizationPct].filter(Boolean).length
    : 0;

  if (targets?.revenueCents) {
    const achieved = actualRevenueCents >= targets.revenueCents;
    if (achieved) achievedCount++;
    results.push({
      dimension: "revenue",
      label: "Weekly Revenue",
      target: targets.revenueCents,
      targetLabel: `$${(targets.revenueCents / 100).toFixed(0)}`,
      actual: actualRevenueCents,
      actualLabel: `$${(actualRevenueCents / 100).toFixed(0)}`,
      achieved,
      pctAchieved: Math.min(100, Math.round((actualRevenueCents / targets.revenueCents) * 100)),
    });
  }

  if (targets?.sessions) {
    const achieved = actualSessions >= targets.sessions;
    if (achieved) achievedCount++;
    results.push({
      dimension: "sessions",
      label: "Sessions",
      target: targets.sessions,
      targetLabel: `${targets.sessions}`,
      actual: actualSessions,
      actualLabel: `${actualSessions}`,
      achieved,
      pctAchieved: Math.min(100, Math.round((actualSessions / targets.sessions) * 100)),
    });
  }

  // Best strategy
  const bestAction = topContributingActions[0];
  const bestStrategy = bestAction
    ? `${bestAction.actionSubType} outreach drove the most bookings this week (${bestAction.count} messages, $${(bestAction.revenueCents / 100).toFixed(0)} revenue). Keep using it.`
    : "Not enough outreach data to identify a top strategy this week.";

  // What to change next week
  const whatToChangeNextWeek: string[] = [];
  if (results.some(r => r.dimension === "revenue" && !r.achieved)) {
    const revResult = results.find(r => r.dimension === "revenue")!;
    const gapCents = revResult.target - revResult.actual;
    whatToChangeNextWeek.push(`Close $${(gapCents / 100).toFixed(0)} revenue gap — increase upsell frequency and target high-LTV clients first`);
  }
  if (results.some(r => r.dimension === "sessions" && !r.achieved)) {
    whatToChangeNextWeek.push("Fill more open slots — run backfill outreach earlier in the week, not mid-week");
  }
  if (topContributingActions.some(a => a.conversionRate < 0.15 && a.count >= 3)) {
    const lowPerformer = topContributingActions.find(a => a.conversionRate < 0.15)!;
    whatToChangeNextWeek.push(`"${lowPerformer.actionSubType}" outreach underperformed — test a new message style or timing next week`);
  }
  if (whatToChangeNextWeek.length === 0) {
    whatToChangeNextWeek.push("Maintain current approach — performance was strong. Consider increasing outreach volume to scale results.");
  }

  const overallAchieved = achievedCount === totalTargets && totalTargets > 0;

  const summary = totalTargets === 0
    ? "No weekly targets were set. Set targets next week to track goal performance."
    : overallAchieved
      ? `All ${totalTargets} target${totalTargets !== 1 ? "s" : ""} achieved this week.`
      : `${achievedCount}/${totalTargets} target${totalTargets !== 1 ? "s" : ""} achieved. ${whatToChangeNextWeek[0] ?? ""}`;

  const nextWeekCTA = totalTargets > 0
    ? `Ready to set targets for next week? Just say "Set a $${((targets?.revenueCents ?? 500000) / 100).toFixed(0)} revenue goal" or tell me your target.`
    : "No targets were set this week. Say 'Set a $5,000 revenue goal' to start tracking goal performance next week.";

  return {
    weekOf: `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`,
    targets,
    results,
    topContributingActions,
    bestStrategy,
    whatToChangeNextWeek,
    overallAchieved,
    achievedCount,
    totalTargets,
    summary,
    nextWeekCTA,
  };
}
