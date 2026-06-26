/**
 * Financial Brain Service
 *
 * AI-native financial intelligence layer for TrainEfficiency.
 * Consumes accounting data and produces:
 *   - Anomaly detection (rule-based severity scoring)
 *   - Client utilization + churn risk analysis
 *   - Coach operational insights
 *   - Lightweight rolling forecasts
 *   - Actionable recommendations
 *   - Daily digest (AI narrative via OpenAI, falls back to structured)
 *   - Natural-language financial querying
 *   - Closeout readiness scoring
 *
 * SAFETY: This service is strictly READ-ONLY.
 * It never mutates accounting data, closes periods, or adjusts payouts.
 * All outputs are advisory.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { computeUnifiedFinancialMetrics, buildFinancialContextString } from "./financial-metrics";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Anomaly {
  key: string;
  severity: "info" | "warning" | "critical";
  label: string;
  detail: string;
  value?: number;
  priorValue?: number;
  changePercent?: number;
}

export interface ClientRisk {
  clientId: string;
  clientName: string;
  riskType: "unused_credits" | "declining_attendance" | "expiring_soon" | "high_value_inactive" | "fast_consumer";
  severity: "info" | "warning" | "critical";
  description: string;
  sessionsRemaining?: number;
  daysSinceLastSession?: number;
  recommendedAction: string;
}

export interface CoachInsight {
  coachId: string;
  coachName: string;
  sessionsCompleted: number;
  revenueGeneratedCents: number;
  accruedCents: number;
  paidCents: number;
  pendingCents: number;
  payoutRatioPct: number;
  weekOverWeekChange?: number;
  flags: string[];
}

export interface Forecast {
  label: string;
  currentCents: number;
  projectedMonthEndCents: number;
  weeklyRateCents: number;
  trend: "up" | "down" | "flat";
  confidencePct: number;
}

export interface Recommendation {
  key: string;
  severity: "info" | "warning" | "critical";
  label: string;
  detail: string;
  estimatedImpact?: string;
  relatedEntities?: string[];
  suggestedAction: string;
}

export interface FinancialDigest {
  generatedAt: string;
  orgId: string;
  period: { start: string; end: string; label: string };
  revenueSummary: {
    collectedCents: number; recognizedCents: number; deferredLiabilityCents: number;
    wowCollectedChange?: number; wowRecognizedChange?: number;
  };
  coachPayoutSummary: { totalAccruedCents: number; totalPaidCents: number; totalPendingCents: number; coachCount: number };
  failures: { pending: number; failed: number; stale: number };
  anomalies: Anomaly[];
  clientRisks: ClientRisk[];
  coachInsights: CoachInsight[];
  forecasts: Forecast[];
  recommendations: Recommendation[];
  narrative: string | null;
}

export interface CloseoutReadiness {
  closeoutId: string;
  confidenceScore: number;
  readyToClose: boolean;
  requiresAcknowledgment: boolean;
  blockers: Array<{ key: string; label: string; severity: "critical" }>;
  warnings: Array<{ key: string; label: string; count: number }>;
  recommendations: string[];
  summary: string;
}

// ── Internal query helpers ────────────────────────────────────────────────────

async function queryRevenueSummary(orgId: string, start: Date, end: Date) {
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN event_type = 'payment_received' THEN amount_cents ELSE 0 END), 0)::int AS collected,
      COALESCE(SUM(CASE WHEN event_type = 'revenue_recognized' THEN amount_cents ELSE 0 END), 0)::int AS recognized,
      COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_created' THEN amount_cents ELSE 0 END), 0)::int AS deferred_created,
      COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_released' THEN amount_cents ELSE 0 END), 0)::int AS deferred_released,
      COALESCE(SUM(CASE WHEN event_type = 'coach_compensation_accrued' THEN amount_cents ELSE 0 END), 0)::int AS coach_accrued,
      COALESCE(SUM(CASE WHEN event_type = 'coach_compensation_paid' THEN amount_cents ELSE 0 END), 0)::int AS coach_paid,
      COALESCE(SUM(CASE WHEN event_type = 'refund_issued' THEN amount_cents ELSE 0 END), 0)::int AS refunded,
      COALESCE(SUM(CASE WHEN event_type = 'manual_adjustment' THEN amount_cents ELSE 0 END), 0)::int AS manual_adj,
      COUNT(CASE WHEN event_type = 'revenue_recognized' THEN 1 END)::int AS recognition_events
    FROM revenue_ledger_events
    WHERE org_id = ${orgId} AND created_at >= ${start} AND created_at <= ${end}
  `);
  const r = result.rows[0] as any;
  return {
    collected: r?.collected ?? 0,
    recognized: r?.recognized ?? 0,
    deferredCreated: r?.deferred_created ?? 0,
    deferredReleased: r?.deferred_released ?? 0,
    coachAccrued: r?.coach_accrued ?? 0,
    coachPaid: r?.coach_paid ?? 0,
    refunded: r?.refunded ?? 0,
    manualAdj: r?.manual_adj ?? 0,
    recognitionEvents: r?.recognition_events ?? 0,
  };
}

// ── Anomaly Detection ─────────────────────────────────────────────────────────

export async function detectAnomalies(orgId: string): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];
  const now = new Date();

  const thisWeekStart = new Date(now); thisWeekStart.setDate(now.getDate() - 7);
  const lastWeekStart = new Date(now); lastWeekStart.setDate(now.getDate() - 14);
  const lastWeekEnd = new Date(thisWeekStart);

  const [thisWeek, lastWeek, dupCheck, failureCheck, negDeferred] = await Promise.all([
    queryRevenueSummary(orgId, thisWeekStart, now),
    queryRevenueSummary(orgId, lastWeekStart, lastWeekEnd),
    db.execute(sql`
      SELECT
        COUNT(CASE WHEN event_type = 'revenue_recognized' AND redemption_id IN (
          SELECT redemption_id FROM revenue_ledger_events
          WHERE event_type = 'revenue_recognized' AND org_id = ${orgId}
          GROUP BY redemption_id HAVING COUNT(*) > 1
        ) THEN 1 END)::int AS dup_recognition,
        COUNT(CASE WHEN event_type = 'manual_adjustment' AND created_at >= ${thisWeekStart} THEN 1 END)::int AS manual_adj_count
      FROM revenue_ledger_events
      WHERE org_id = ${orgId}
    `),
    db.execute(sql`
      SELECT
        COUNT(CASE WHEN status IN ('pending','retrying') THEN 1 END)::int AS pending_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END)::int AS failed_count,
        COUNT(CASE WHEN status IN ('pending','retrying') AND created_at < ${new Date(now.getTime() - 24 * 3600000)} THEN 1 END)::int AS stale_count
      FROM financial_event_failures
      WHERE org_id = ${orgId}
    `),
    db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_created' THEN amount_cents ELSE 0 END), 0)::int AS created,
        COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_released' THEN amount_cents ELSE 0 END), 0)::int AS released
      FROM revenue_ledger_events WHERE org_id = ${orgId}
    `),
  ]);

  const dupRow = dupCheck.rows[0] as any;
  const failRow = failureCheck.rows[0] as any;
  const defRow = negDeferred.rows[0] as any;

  // Revenue recognition drop
  const pctChange = (base: number, current: number) =>
    base === 0 ? null : ((current - base) / base) * 100;

  const recognizedChange = pctChange(lastWeek.recognized, thisWeek.recognized);
  if (recognizedChange !== null && recognizedChange < -30) {
    anomalies.push({
      key: "revenue_recognition_drop_critical",
      severity: "critical",
      label: "Revenue recognition dropped sharply",
      detail: `Down ${Math.abs(recognizedChange).toFixed(0)}% week-over-week`,
      value: thisWeek.recognized,
      priorValue: lastWeek.recognized,
      changePercent: recognizedChange,
    });
  } else if (recognizedChange !== null && recognizedChange < -20) {
    anomalies.push({
      key: "revenue_recognition_drop_warning",
      severity: "warning",
      label: "Revenue recognition declined",
      detail: `Down ${Math.abs(recognizedChange).toFixed(0)}% week-over-week`,
      value: thisWeek.recognized,
      priorValue: lastWeek.recognized,
      changePercent: recognizedChange,
    });
  }

  // Refund spike
  const refundChange = pctChange(lastWeek.refunded, thisWeek.refunded);
  if (thisWeek.refunded > 0 && refundChange !== null && refundChange > 100) {
    anomalies.push({
      key: "refund_spike",
      severity: "warning",
      label: "Unusually high refunds this week",
      detail: `Refunds up ${refundChange.toFixed(0)}% vs last week`,
      value: thisWeek.refunded,
      priorValue: lastWeek.refunded,
      changePercent: refundChange,
    });
  }

  // Payout accrual spike
  const accrualChange = pctChange(lastWeek.coachAccrued, thisWeek.coachAccrued);
  if (accrualChange !== null && accrualChange > 50) {
    anomalies.push({
      key: "payout_accrual_spike",
      severity: "warning",
      label: "Coach payout accruals spiked",
      detail: `Accruals up ${accrualChange.toFixed(0)}% week-over-week`,
      value: thisWeek.coachAccrued,
      priorValue: lastWeek.coachAccrued,
      changePercent: accrualChange,
    });
  }

  // Negative deferred balance
  const deferredNet = (defRow?.created ?? 0) - (defRow?.released ?? 0);
  if (deferredNet < 0) {
    anomalies.push({
      key: "negative_deferred_revenue",
      severity: "critical",
      label: "Negative net deferred revenue",
      detail: `Released (${((-defRow?.released ?? 0) / 100).toFixed(2)}) exceeds created. Logic error.`,
    });
  }

  // Duplicate recognitions
  if ((dupRow?.dup_recognition ?? 0) > 0) {
    anomalies.push({
      key: "duplicate_recognition",
      severity: "critical",
      label: "Duplicate revenue recognition events detected",
      detail: `${dupRow.dup_recognition} event(s) recognized more than once for the same redemption`,
    });
  }

  // Manual adjustments
  if ((dupRow?.manual_adj_count ?? 0) > 3) {
    anomalies.push({
      key: "high_manual_adjustments",
      severity: "warning",
      label: "Elevated manual adjustments this week",
      detail: `${dupRow.manual_adj_count} manual adjustment events this week`,
    });
  }

  // Failed financial events
  if ((failRow?.failed_count ?? 0) > 0) {
    anomalies.push({
      key: "failed_financial_events",
      severity: "critical",
      label: "Financial event writes failed after max retry attempts",
      detail: `${failRow.failed_count} failure(s) exceeded max attempts and require manual resolution`,
    });
  }

  if ((failRow?.stale_count ?? 0) > 0) {
    anomalies.push({
      key: "stale_pending_failures",
      severity: "critical",
      label: "Stale financial event failures (>24h unresolved)",
      detail: `${failRow.stale_count} failure(s) have been pending for over 24 hours`,
    });
  }

  if ((failRow?.pending_count ?? 0) > 0) {
    anomalies.push({
      key: "pending_financial_failures",
      severity: "warning",
      label: "Financial event writes queued for retry",
      detail: `${failRow.pending_count} pending failure(s) in the retry queue`,
    });
  }

  return anomalies;
}

// ── Client Utilization + Churn Risk ──────────────────────────────────────────

export async function getClientRisks(orgId: string): Promise<ClientRisk[]> {
  const risks: ClientRisk[] = [];

  // Clients with unused credits + no recent session
  const unusedCredits = await db.execute(sql`
    SELECT
      u.id, u.first_name, u.last_name, u.email,
      us.sessions_remaining,
      MAX(b.start_at) AS last_session,
      EXTRACT(DAY FROM NOW() - MAX(b.start_at))::int AS days_since_last
    FROM user_subscriptions us
    JOIN users u ON u.id = us.user_id
    JOIN user_profiles up ON up.user_id = u.id AND up.organization_id = ${orgId}
    LEFT JOIN bookings b ON b.client_id = u.id AND b.status = 'COMPLETED'
    WHERE us.status = 'active'
      AND us.sessions_remaining > 0
    GROUP BY u.id, u.first_name, u.last_name, u.email, us.sessions_remaining
    HAVING (MAX(b.start_at) IS NULL OR EXTRACT(DAY FROM NOW() - MAX(b.start_at)) > 21)
       AND us.sessions_remaining >= 2
    ORDER BY us.sessions_remaining DESC, days_since_last DESC
    LIMIT 30
  `);

  for (const row of unusedCredits.rows as any[]) {
    const days = row.days_since_last ?? 999;
    const sessions = row.sessions_remaining ?? 0;
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || "Unknown";
    risks.push({
      clientId: row.id,
      clientName: name,
      riskType: days > 60 ? "high_value_inactive" : "unused_credits",
      severity: days > 60 ? "critical" : days > 30 ? "warning" : "info",
      description: days > 60
        ? `${sessions} unused session${sessions !== 1 ? "s" : ""}, inactive for ${days} days`
        : `${sessions} unused session${sessions !== 1 ? "s" : ""}, last active ${days} day${days !== 1 ? "s" : ""} ago`,
      sessionsRemaining: sessions,
      daysSinceLastSession: days > 900 ? undefined : days,
      recommendedAction: days > 45
        ? "High-priority re-engagement outreach — prepaid value at risk"
        : "Proactive check-in to schedule sessions",
    });
  }

  return risks;
}

// ── Coach Insights ────────────────────────────────────────────────────────────

export async function getCoachInsights(orgId: string): Promise<CoachInsight[]> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastPeriodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [coachData, lastMonthData] = await Promise.all([
    db.execute(sql`
      SELECT
        cp.id AS coach_id, u.first_name, u.last_name,
        COUNT(DISTINCT CASE WHEN rle.event_type = 'revenue_recognized' THEN rle.redemption_id END)::int AS sessions_completed,
        COALESCE(SUM(CASE WHEN rle.event_type = 'revenue_recognized' THEN rle.amount_cents ELSE 0 END), 0)::int AS revenue_cents,
        COALESCE(SUM(CASE WHEN rle.event_type = 'coach_compensation_accrued' THEN rle.amount_cents ELSE 0 END), 0)::int AS accrued_cents,
        COALESCE(SUM(CASE WHEN rle.event_type = 'coach_compensation_paid' THEN rle.amount_cents ELSE 0 END), 0)::int AS paid_cents
      FROM coach_profiles cp
      JOIN users u ON u.id = cp.user_id
      LEFT JOIN revenue_ledger_events rle ON rle.coach_id = cp.id
        AND rle.created_at >= ${periodStart}
      WHERE cp.organization_id = ${orgId}
      GROUP BY cp.id, u.first_name, u.last_name
    `),
    db.execute(sql`
      SELECT coach_id,
        COALESCE(SUM(CASE WHEN event_type = 'revenue_recognized' THEN amount_cents ELSE 0 END), 0)::int AS revenue_cents
      FROM revenue_ledger_events
      WHERE org_id = ${orgId} AND created_at >= ${lastPeriodStart} AND created_at <= ${lastPeriodEnd}
      GROUP BY coach_id
    `),
  ]);

  const lastMonthMap = new Map((lastMonthData.rows as any[]).map(r => [r.coach_id, r.revenue_cents]));

  return (coachData.rows as any[]).map(r => {
    const accrued = r.accrued_cents ?? 0;
    const revenue = r.revenue_cents ?? 0;
    const paid = r.paid_cents ?? 0;
    const pending = Math.max(0, accrued - paid);
    const payoutRatio = revenue > 0 ? (accrued / revenue) * 100 : 0;
    const lastRevenue = lastMonthMap.get(r.coach_id) ?? 0;
    const wowChange = lastRevenue > 0 ? ((revenue - lastRevenue) / lastRevenue) * 100 : null;
    const flags: string[] = [];
    if (r.sessions_completed === 0) flags.push("No sessions this period");
    if (payoutRatio > 80) flags.push("High payout ratio");
    if (payoutRatio < 20 && revenue > 0) flags.push("Low payout ratio");
    if (wowChange !== null && wowChange < -40) flags.push("Revenue declined significantly month-over-month");
    if (wowChange !== null && wowChange > 80) flags.push("Revenue spiked month-over-month");

    return {
      coachId: r.coach_id,
      coachName: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
      sessionsCompleted: r.sessions_completed ?? 0,
      revenueGeneratedCents: revenue,
      accruedCents: accrued,
      paidCents: paid,
      pendingCents: pending,
      payoutRatioPct: Math.round(payoutRatio * 10) / 10,
      weekOverWeekChange: wowChange !== null ? Math.round(wowChange * 10) / 10 : undefined,
      flags,
    };
  });
}

// ── Lightweight Forecast ──────────────────────────────────────────────────────

export async function getForecast(orgId: string): Promise<Forecast[]> {
  const now = new Date();
  const forecasts: Forecast[] = [];

  // Get last 4 weeks of weekly recognized revenue
  const weeks = await db.execute(sql`
    SELECT
      DATE_TRUNC('week', created_at) AS week,
      COALESCE(SUM(CASE WHEN event_type = 'revenue_recognized' THEN amount_cents ELSE 0 END), 0)::int AS recognized,
      COALESCE(SUM(CASE WHEN event_type = 'coach_compensation_accrued' THEN amount_cents ELSE 0 END), 0)::int AS accrued,
      COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_created' THEN amount_cents ELSE 0 END), 0)::int AS deferred_created,
      COALESCE(SUM(CASE WHEN event_type = 'deferred_revenue_released' THEN amount_cents ELSE 0 END), 0)::int AS deferred_released
    FROM revenue_ledger_events
    WHERE org_id = ${orgId}
      AND created_at >= ${new Date(now.getTime() - 28 * 24 * 3600000)}
    GROUP BY DATE_TRUNC('week', created_at)
    ORDER BY week DESC
  `);

  const rows = weeks.rows as any[];
  if (rows.length === 0) return forecasts;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);

  const weeklyRecognized = rows.map(r => r.recognized ?? 0);
  const weeklyAccrued = rows.map(r => r.accrued ?? 0);

  const avgWeeklyRecognized = avg(weeklyRecognized);
  const avgWeeklyAccrued = avg(weeklyAccrued);

  // Days remaining in month
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysRemaining = (monthEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  const weeksRemaining = daysRemaining / 7;

  // Month-to-date recognized
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const mtdResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN event_type = 'revenue_recognized' THEN amount_cents ELSE 0 END), 0)::int AS recognized,
      COALESCE(SUM(CASE WHEN event_type = 'coach_compensation_accrued' THEN amount_cents ELSE 0 END), 0)::int AS accrued
    FROM revenue_ledger_events
    WHERE org_id = ${orgId} AND created_at >= ${mtdStart}
  `);

  const mtd = mtdResult.rows[0] as any;
  const mtdRecognized = mtd?.recognized ?? 0;
  const mtdAccrued = mtd?.accrued ?? 0;

  const projectedRecognized = mtdRecognized + Math.round(avgWeeklyRecognized * weeksRemaining);
  const projectedAccrued = mtdAccrued + Math.round(avgWeeklyAccrued * weeksRemaining);

  const recognizedTrend = weeklyRecognized.length >= 2
    ? (weeklyRecognized[0] > weeklyRecognized[weeklyRecognized.length - 1] ? "up" : weeklyRecognized[0] < weeklyRecognized[weeklyRecognized.length - 1] ? "down" : "flat")
    : "flat";

  forecasts.push({
    label: "Projected Month-End Recognized Revenue",
    currentCents: mtdRecognized,
    projectedMonthEndCents: projectedRecognized,
    weeklyRateCents: Math.round(avgWeeklyRecognized),
    trend: recognizedTrend as "up" | "down" | "flat",
    confidencePct: Math.min(95, 60 + rows.length * 8),
  });

  forecasts.push({
    label: "Projected Month-End Coach Accruals",
    currentCents: mtdAccrued,
    projectedMonthEndCents: projectedAccrued,
    weeklyRateCents: Math.round(avgWeeklyAccrued),
    trend: (avgWeeklyAccrued > 0 ? "up" : "flat") as "up" | "down" | "flat",
    confidencePct: Math.min(90, 55 + rows.length * 8),
  });

  return forecasts;
}

// ── Recommendations ───────────────────────────────────────────────────────────

export async function generateRecommendations(
  anomalies: Anomaly[],
  clientRisks: ClientRisk[],
  coachInsights: CoachInsight[],
  orgId: string
): Promise<Recommendation[]> {
  const recs: Recommendation[] = [];

  // Failed financial events
  const failedEvents = anomalies.filter(a => a.key === "failed_financial_events");
  if (failedEvents.length > 0) {
    recs.push({
      key: "resolve_failed_events",
      severity: "critical",
      label: "Resolve failed financial event writes",
      detail: "Financial ledger writes have failed after max retry attempts. These block accurate financial reporting.",
      estimatedImpact: "Blocking closeout and accurate revenue recognition",
      suggestedAction: "Visit Financial Event Failures inbox and resolve or manually retry each item",
    });
  }

  // Stale failures
  if (anomalies.some(a => a.key === "stale_pending_failures")) {
    recs.push({
      key: "clear_stale_failures",
      severity: "critical",
      label: "Clear stale financial retry queue",
      detail: "Unresolved failures older than 24 hours indicate a systemic issue with ledger writes.",
      suggestedAction: "Run bulk reconciliation or investigate root cause of persistent write failures",
    });
  }

  // Revenue drop
  if (anomalies.some(a => a.key === "revenue_recognition_drop_critical")) {
    recs.push({
      key: "investigate_revenue_drop",
      severity: "critical",
      label: "Investigate sharp revenue recognition decline",
      detail: "Revenue recognized dropped more than 30% week-over-week. Possible causes: fewer session completions, redemption issues, or data problems.",
      suggestedAction: "Check session completion rates and redemption logs for the past 7 days",
    });
  }

  // High-value inactive clients
  const highRisk = clientRisks.filter(r => r.severity === "critical");
  if (highRisk.length > 0) {
    recs.push({
      key: "reengage_inactive_clients",
      severity: "critical",
      label: `Re-engage ${highRisk.length} high-value inactive client${highRisk.length !== 1 ? "s" : ""}`,
      detail: `${highRisk.length} prepaid client${highRisk.length !== 1 ? "s" : ""} with unused credits have not attended in 60+ days. Prepaid revenue liability at risk.`,
      estimatedImpact: `${highRisk.reduce((a, c) => a + (c.sessionsRemaining ?? 0), 0)} sessions at risk of refund or churn`,
      relatedEntities: highRisk.slice(0, 5).map(c => c.clientName),
      suggestedAction: "Run targeted outreach campaign for these clients immediately",
    });
  }

  // Unused credits (warning level)
  const warningRisk = clientRisks.filter(r => r.severity === "warning");
  if (warningRisk.length > 0) {
    recs.push({
      key: "followup_underutilizing_clients",
      severity: "warning",
      label: `${warningRisk.length} client${warningRisk.length !== 1 ? "s" : ""} underutilizing session packages`,
      detail: "These clients have unused credits and haven't scheduled recently.",
      suggestedAction: "Send proactive scheduling reminders to maintain engagement",
    });
  }

  // Underperforming coaches
  const idleCoaches = coachInsights.filter(c => c.sessionsCompleted === 0);
  if (idleCoaches.length > 0) {
    recs.push({
      key: "coach_no_sessions",
      severity: "warning",
      label: `${idleCoaches.length} coach${idleCoaches.length !== 1 ? "es" : ""} with no sessions this period`,
      detail: "Zero revenue and compensation accrual this period.",
      relatedEntities: idleCoaches.map(c => c.coachName),
      suggestedAction: "Review scheduling coverage and coach availability",
    });
  }

  // Coach payout accrual spike
  if (anomalies.some(a => a.key === "payout_accrual_spike")) {
    recs.push({
      key: "review_payout_spike",
      severity: "warning",
      label: "Coach payout accruals increased significantly",
      detail: "Review whether this reflects legitimate session volume growth or a data anomaly.",
      suggestedAction: "Cross-reference session completions with accrual events in the reconciliation dashboard",
    });
  }

  return recs;
}

// ── Daily Financial Digest ────────────────────────────────────────────────────

export async function generateDigest(orgId: string): Promise<FinancialDigest> {
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
  const lastWeekStart = new Date(now); lastWeekStart.setDate(now.getDate() - 14);
  const lastWeekEnd = new Date(weekStart);

  const [thisWeekSummary, lastWeekSummary, anomalies, clientRisks, coachInsights, forecasts] = await Promise.all([
    queryRevenueSummary(orgId, weekStart, now),
    queryRevenueSummary(orgId, lastWeekStart, lastWeekEnd),
    detectAnomalies(orgId),
    getClientRisks(orgId),
    getCoachInsights(orgId),
    getForecast(orgId),
  ]);

  const recommendations = await generateRecommendations(anomalies, clientRisks, coachInsights, orgId);

  const deferredLiability = Math.max(0, thisWeekSummary.deferredCreated - thisWeekSummary.deferredReleased);

  const wowChange = (cur: number, prior: number) =>
    prior === 0 ? null : Math.round(((cur - prior) / prior) * 1000) / 10;

  const digest: FinancialDigest = {
    generatedAt: now.toISOString(),
    orgId,
    period: {
      start: weekStart.toISOString(),
      end: now.toISOString(),
      label: "Last 7 days",
    },
    revenueSummary: {
      collectedCents: thisWeekSummary.collected,
      recognizedCents: thisWeekSummary.recognized,
      deferredLiabilityCents: deferredLiability,
      wowCollectedChange: wowChange(thisWeekSummary.collected, lastWeekSummary.collected) ?? undefined,
      wowRecognizedChange: wowChange(thisWeekSummary.recognized, lastWeekSummary.recognized) ?? undefined,
    },
    coachPayoutSummary: {
      totalAccruedCents: thisWeekSummary.coachAccrued,
      totalPaidCents: thisWeekSummary.coachPaid,
      totalPendingCents: Math.max(0, thisWeekSummary.coachAccrued - thisWeekSummary.coachPaid),
      coachCount: coachInsights.length,
    },
    failures: {
      pending: anomalies.filter(a => a.key === "pending_financial_failures").length > 0
        ? (anomalies.find(a => a.key === "pending_financial_failures") as any)?.detail?.match(/\d+/)?.[0] ?? 0
        : 0,
      failed: anomalies.filter(a => a.key === "failed_financial_events").length > 0 ? 1 : 0,
      stale: anomalies.filter(a => a.key === "stale_pending_failures").length > 0 ? 1 : 0,
    },
    anomalies,
    clientRisks,
    coachInsights,
    forecasts,
    recommendations,
    narrative: null,
  };

  // Try OpenAI narrative generation
  if (process.env.OPENAI_API_KEY) {
    try {
      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const context = {
        period: "last 7 days",
        collected: `$${(thisWeekSummary.collected / 100).toFixed(2)}`,
        recognized: `$${(thisWeekSummary.recognized / 100).toFixed(2)}`,
        wowRecognized: digest.revenueSummary.wowRecognizedChange,
        deferredLiability: `$${(deferredLiability / 100).toFixed(2)}`,
        coachAccrued: `$${(thisWeekSummary.coachAccrued / 100).toFixed(2)}`,
        coachPending: `$${(Math.max(0, thisWeekSummary.coachAccrued - thisWeekSummary.coachPaid) / 100).toFixed(2)}`,
        anomalies: anomalies.map(a => `[${a.severity.toUpperCase()}] ${a.label}: ${a.detail}`),
        clientRisks: clientRisks.slice(0, 5).map(r => `${r.clientName}: ${r.description}`),
        topRecommendations: recommendations.slice(0, 4).map(r => r.label),
      };

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 600,
        messages: [
          {
            role: "system",
            content: `You are an operational finance analyst for a strength and conditioning coaching platform.
Write a concise, professional daily financial digest. Use ONLY the exact numbers provided in the data — never fabricate figures.
Be direct and analytical. Flag concerns clearly. Avoid consumer fitness language. 3-5 short paragraphs max.`,
          },
          {
            role: "user",
            content: `Generate a financial digest for ${context.period}:\n${JSON.stringify(context, null, 2)}`,
          },
        ],
      });

      digest.narrative = completion.choices[0]?.message?.content ?? null;
    } catch (e: any) {
      console.warn("[FinancialBrain] OpenAI narrative generation failed:", e?.message);
    }
  }

  return digest;
}

// ── Natural-Language Financial Query ─────────────────────────────────────────

export async function answerQuery(orgId: string, question: string): Promise<{
  answer: string;
  dataContext: Record<string, any>;
  isAiGenerated: boolean;
}> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);

  // Build rich data context from real DB data
  const [mtdSummary, weekSummary, coaches, clientRisks, failures] = await Promise.all([
    queryRevenueSummary(orgId, monthStart, now),
    queryRevenueSummary(orgId, weekStart, now),
    getCoachInsights(orgId),
    getClientRisks(orgId),
    db.execute(sql`
      SELECT status, COUNT(*)::int AS n FROM financial_event_failures
      WHERE org_id = ${orgId} GROUP BY status
    `),
  ]);

  const failureMap = Object.fromEntries((failures.rows as any[]).map(r => [r.status, r.n]));

  const dataContext = {
    period: { monthToDate: { start: monthStart.toISOString(), end: now.toISOString() }, last7Days: { start: weekStart.toISOString(), end: now.toISOString() } },
    monthToDate: {
      collectedRevenue: `$${(mtdSummary.collected / 100).toFixed(2)}`,
      recognizedRevenue: `$${(mtdSummary.recognized / 100).toFixed(2)}`,
      deferredLiability: `$${(Math.max(0, mtdSummary.deferredCreated - mtdSummary.deferredReleased) / 100).toFixed(2)}`,
      coachAccrued: `$${(mtdSummary.coachAccrued / 100).toFixed(2)}`,
      coachPaid: `$${(mtdSummary.coachPaid / 100).toFixed(2)}`,
      coachPending: `$${(Math.max(0, mtdSummary.coachAccrued - mtdSummary.coachPaid) / 100).toFixed(2)}`,
      refunds: `$${(mtdSummary.refunded / 100).toFixed(2)}`,
    },
    last7Days: {
      recognizedRevenue: `$${(weekSummary.recognized / 100).toFixed(2)}`,
      coachAccrued: `$${(weekSummary.coachAccrued / 100).toFixed(2)}`,
    },
    coaches: coaches.map(c => ({
      name: c.coachName,
      sessionsCompleted: c.sessionsCompleted,
      revenueGenerated: `$${(c.revenueGeneratedCents / 100).toFixed(2)}`,
      pendingPayout: `$${(c.pendingCents / 100).toFixed(2)}`,
      payoutRatio: `${c.payoutRatioPct}%`,
      flags: c.flags,
    })),
    clientRisks: clientRisks.slice(0, 10).map(r => ({
      name: r.clientName,
      type: r.riskType,
      sessionsRemaining: r.sessionsRemaining,
      daysSinceLastSession: r.daysSinceLastSession,
      description: r.description,
    })),
    financialFailures: {
      pending: failureMap["pending"] ?? 0,
      retrying: failureMap["retrying"] ?? 0,
      failed: failureMap["failed"] ?? 0,
      resolved: failureMap["resolved"] ?? 0,
    },
  };

  if (!process.env.OPENAI_API_KEY) {
    return {
      answer: `I can provide structured data but AI narrative responses require an OpenAI API key. Here is the raw data context for your question: "${question}"`,
      dataContext,
      isAiGenerated: false,
    };
  }

  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: `You are a financial analyst for a strength and conditioning coaching platform.
Answer questions using ONLY the exact data provided below. Never fabricate numbers.
If you cannot find the answer in the data, say so clearly. Be precise and cite exact figures.
Data: ${JSON.stringify(dataContext, null, 2)}`,
        },
        { role: "user", content: question },
      ],
    });

    return {
      answer: completion.choices[0]?.message?.content ?? "No response generated.",
      dataContext,
      isAiGenerated: true,
    };
  } catch (e: any) {
    console.warn("[FinancialBrain] Query OpenAI failed:", e?.message);
    return {
      answer: `AI narrative unavailable (${e?.message}). See raw data context.`,
      dataContext,
      isAiGenerated: false,
    };
  }
}

// ── Closeout Readiness Scoring ────────────────────────────────────────────────

export async function getCloseoutReadiness(orgId: string, periodStart: Date, periodEnd: Date, closeoutId: string): Promise<CloseoutReadiness> {
  let confidence = 100;
  const blockers: CloseoutReadiness["blockers"] = [];
  const warnings: CloseoutReadiness["warnings"] = [];
  const recommendations: string[] = [];

  const [dupRec, dupAccruals, negDeferred, failedEvents, staleFailures, pendingFailures, orphanedEvents, redemptionsNoLedger] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT redemption_id FROM revenue_ledger_events
        WHERE event_type = 'revenue_recognized' AND org_id = ${orgId}
          AND created_at >= ${periodStart} AND created_at <= ${periodEnd}
        GROUP BY redemption_id HAVING COUNT(*) > 1
      ) x
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT redemption_id FROM revenue_ledger_events
        WHERE event_type = 'coach_compensation_accrued' AND org_id = ${orgId}
          AND created_at >= ${periodStart} AND created_at <= ${periodEnd}
        GROUP BY redemption_id HAVING COUNT(*) > 1
      ) x
    `),
    db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN event_type='deferred_revenue_created' THEN amount_cents ELSE 0 END),0)::int AS created,
        COALESCE(SUM(CASE WHEN event_type='deferred_revenue_released' THEN amount_cents ELSE 0 END),0)::int AS released
      FROM revenue_ledger_events WHERE org_id = ${orgId}
    `),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM financial_event_failures WHERE org_id = ${orgId} AND status = 'failed'`),
    db.execute(sql`
      SELECT COUNT(*)::int AS n FROM financial_event_failures
      WHERE org_id = ${orgId} AND status IN ('pending','retrying') AND created_at < ${new Date(Date.now() - 24 * 3600000)}
    `),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM financial_event_failures WHERE org_id = ${orgId} AND status IN ('pending','retrying')`),
    db.execute(sql`
      SELECT COUNT(*)::int AS n FROM revenue_ledger_events rle
      LEFT JOIN bookings b ON b.id = rle.booking_id
      WHERE rle.booking_id IS NOT NULL AND b.id IS NULL AND rle.org_id = ${orgId}
        AND rle.created_at >= ${periodStart} AND rle.created_at <= ${periodEnd}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS n FROM redemptions r
      LEFT JOIN revenue_ledger_events rle ON rle.redemption_id = r.id AND rle.event_type = 'revenue_recognized'
      WHERE rle.id IS NULL AND r.coach_id IN (SELECT id FROM coach_profiles WHERE organization_id = ${orgId})
        AND r.redeemed_at >= ${periodStart} AND r.redeemed_at <= ${periodEnd}
    `),
  ]);

  const n = (result: any) => Number(result.rows[0]?.n ?? 0);
  const defRow = negDeferred.rows[0] as any;
  const isNegDeferred = (defRow?.released ?? 0) > (defRow?.created ?? 0);

  if (n(dupRec) > 0) { blockers.push({ key: "dup_recognition", label: `${n(dupRec)} duplicate revenue recognition event(s)`, severity: "critical" }); confidence -= 25; }
  if (n(dupAccruals) > 0) { blockers.push({ key: "dup_accruals", label: `${n(dupAccruals)} duplicate coach compensation accrual(s)`, severity: "critical" }); confidence -= 20; }
  if (isNegDeferred) { blockers.push({ key: "neg_deferred", label: "Negative net deferred revenue balance", severity: "critical" }); confidence -= 20; }
  if (n(failedEvents) > 0) { blockers.push({ key: "failed_events", label: `${n(failedEvents)} financial event write failure(s) at max attempts`, severity: "critical" }); confidence -= 15; }
  if (n(staleFailures) > 0) { blockers.push({ key: "stale_failures", label: `${n(staleFailures)} stale unresolved failure(s) >24h`, severity: "critical" }); confidence -= 10; }

  if (n(orphanedEvents) > 0) { warnings.push({ key: "orphaned_events", label: "Orphaned revenue events (deleted bookings)", count: n(orphanedEvents) }); confidence -= 3; }
  if (n(redemptionsNoLedger) > 0) { warnings.push({ key: "no_ledger", label: "Redemptions without revenue recognition (pre-Task-6 data)", count: n(redemptionsNoLedger) }); }
  if (n(pendingFailures) > 0) { warnings.push({ key: "pending_failures", label: "Financial event writes pending retry", count: n(pendingFailures) }); confidence -= 5; }

  if (blockers.length > 0) recommendations.push("Resolve all critical blockers before closing this period.");
  if (n(failedEvents) > 0) recommendations.push("Visit the Financial Event Failures inbox and retry or ignore each failed write.");
  if (n(staleFailures) > 0) recommendations.push("Run bulk reconciliation to clear stale pending failures.");
  if (n(dupRec) > 0) recommendations.push("Investigate duplicate recognition events — possible idempotency failure.");
  if (n(pendingFailures) > 0) recommendations.push("Allow the retry cron to resolve pending failures before closing.");
  if (warnings.length > 0 && blockers.length === 0) recommendations.push("Non-critical warnings exist. Acknowledge them to proceed with close.");

  const safeConfidence = Math.max(0, Math.min(100, confidence));

  // Check for unresolved critical operator actions
  try {
    const { storage } = await import("./storage");
    const criticalActions = await (storage as any).getOperatorActions(orgId, { severity: "critical" });
    const unresolvedCritical = (criticalActions as any[]).filter((a: any) => a.status !== "resolved" && a.status !== "ignored");
    const unresolvedPayouts = (criticalActions as any[]).filter((a: any) => a.category === "payout" && a.status !== "resolved" && a.status !== "ignored");
    if (unresolvedCritical.length > 0) {
      blockers.push({ key: "unresolved_critical_actions", label: `${unresolvedCritical.length} unresolved critical operator action${unresolvedCritical.length !== 1 ? "s" : ""}`, severity: "critical" });
      confidence -= 10;
      recommendations.push("Resolve or ignore all critical operator actions before closing this period.");
    }
    if (unresolvedPayouts.length > 0) {
      warnings.push({ key: "unresolved_payout_reviews", label: "Unresolved payout review actions", count: unresolvedPayouts.length });
      confidence -= 5;
    }
  } catch {}

  const summary = blockers.length > 0
    ? `Closeout blocked — ${blockers.length} critical issue${blockers.length !== 1 ? "s" : ""} must be resolved. Confidence: ${Math.max(0, Math.min(100, confidence))}%.`
    : warnings.length > 0
      ? `Closeout confidence: ${Math.max(0, Math.min(100, confidence))}%. ${warnings.length} non-critical warning${warnings.length !== 1 ? "s" : ""} require acknowledgment.`
      : `Closeout confidence: ${Math.max(0, Math.min(100, confidence))}%. No blocking issues — this period is ready to close.`;

  return {
    closeoutId,
    confidenceScore: safeConfidence,
    readyToClose: blockers.length === 0,
    requiresAcknowledgment: blockers.length === 0 && warnings.length > 0,
    blockers,
    warnings,
    recommendations,
    summary,
  };
}
