import { storage } from "../storage";

export type AlertSeverity = "critical" | "warning" | "info";

export interface TriggerAlert {
  type: string;
  severity: AlertSeverity;
  message: string;
  affectedCount: number;
  suggestedAction: string;
}

export interface TriggerAlertsResult {
  alerts: TriggerAlert[];
  hasActive: boolean;
  criticalCount: number;
  warningCount: number;
  topRisk: string | null;
}

/**
 * Compute all active trigger system alerts for an org.
 * Looks at the last 24 hours of trigger events.
 */
export async function computeTriggerAlerts(orgId: string): Promise<TriggerAlertsResult> {
  const alerts: TriggerAlert[] = [];

  try {
    const events = await storage.getEmailTriggerEvents(orgId, { sinceHours: 24, limit: 1000 });

    const totalEvaluated = events.length;
    const totalExecuted = events.filter((e) => e.wasExecuted).length;
    const totalBlocked = events.filter((e) => e.executionBlocked).length;
    const missedOpportunities = events.filter((e) => e.missedOpportunity).length;
    const collisions = events.filter((e) => e.collisionDetected).length;

    // ── 1. High blocked rate ─────────────────────────────────────────────────
    if (totalEvaluated >= 3) {
      const blockedRate = totalBlocked / totalEvaluated;
      if (blockedRate > 0.5) {
        alerts.push({
          type: "HIGH_BLOCK_RATE",
          severity: "critical",
          message: `${Math.round(blockedRate * 100)}% of email evaluations were blocked in the last 24h (${totalBlocked}/${totalEvaluated}).`,
          affectedCount: totalBlocked,
          suggestedAction: "Review block reasons in the Trigger Audit. Check DNC list, daily send caps, and cooldown settings.",
        });
      } else if (blockedRate > 0.3) {
        alerts.push({
          type: "HIGH_BLOCK_RATE",
          severity: "warning",
          message: `${Math.round(blockedRate * 100)}% of email evaluations were blocked in the last 24h (${totalBlocked}/${totalEvaluated}).`,
          affectedCount: totalBlocked,
          suggestedAction: "Review block reasons in the Trigger Audit to ensure the agent is working efficiently.",
        });
      }
    }

    // ── 2. Repeated cooldown blocks ──────────────────────────────────────────
    const cooldownEvents = events.filter((e) => e.blockReason === "COOLDOWN_ACTIVE");
    if (cooldownEvents.length >= 3) {
      const affectedProspects = new Set(cooldownEvents.map((e) => e.prospectId).filter(Boolean)).size;
      alerts.push({
        type: "REPEATED_COOLDOWN_BLOCKS",
        severity: "warning",
        message: `${cooldownEvents.length} prospects blocked by cooldown across ${affectedProspects} unique contact${affectedProspects !== 1 ? "s" : ""}.`,
        affectedCount: cooldownEvents.length,
        suggestedAction: "Your cooldown period may be too long relative to your queue size. Consider adjusting the interval in Email Agent Settings.",
      });
    }

    // ── 3. Daily limit reached ───────────────────────────────────────────────
    const dailyLimitBlocks = events.filter((e) => e.blockReason === "DAILY_LIMIT_REACHED");
    if (dailyLimitBlocks.length > 0) {
      alerts.push({
        type: "DAILY_LIMIT_REACHED",
        severity: "info",
        message: `Daily send limit was hit today — ${dailyLimitBlocks.length} prospect${dailyLimitBlocks.length !== 1 ? "s" : ""} blocked by the cap.`,
        affectedCount: dailyLimitBlocks.length,
        suggestedAction: "Increase the daily email limit in Email Agent Settings if you have more prospects to reach.",
      });
    }

    // ── 4. Missed high-priority opportunities ────────────────────────────────
    if (missedOpportunities >= 2) {
      alerts.push({
        type: "MISSED_OPPORTUNITIES",
        severity: "warning",
        message: `${missedOpportunities} high-priority action${missedOpportunities !== 1 ? "s were" : " was"} due but not executed in the last 24h.`,
        affectedCount: missedOpportunities,
        suggestedAction: "Check the Trigger Audit timeline to identify which follow-ups were skipped and re-queue them.",
      });
    }

    // ── 5. No emails sent today (when queue is active) ───────────────────────
    if (totalEvaluated > 0 && totalExecuted === 0) {
      alerts.push({
        type: "NO_EMAILS_SENT",
        severity: "critical",
        message: `No emails were sent in the last 24h, despite ${totalEvaluated} evaluation${totalEvaluated !== 1 ? "s" : ""} running.`,
        affectedCount: totalEvaluated,
        suggestedAction: "Check if auto-send is enabled and the agent isn't hitting blocks. Review the Trigger Audit for details.",
      });
    }

    // ── 6. Auto-execution success rate dropping ──────────────────────────────
    try {
      const { getAutoExecPerformanceMetrics } = await import("./auto-execution-engine");
      const metrics = await getAutoExecPerformanceMetrics(orgId);
      if (metrics.totalExecuted >= 5 && metrics.successRate < 0.4) {
        alerts.push({
          type: "AUTO_EXEC_LOW_SUCCESS",
          severity: "warning",
          message: `Auto-execution success rate is ${Math.round(metrics.successRate * 100)}% — below the 40% target.`,
          affectedCount: metrics.totalExecuted,
          suggestedAction: "Review which actions are being auto-executed and consider tightening confidence/risk thresholds.",
        });
      }
    } catch {
      // best-effort
    }

    // ── 7. Trigger collisions ────────────────────────────────────────────────
    if (collisions >= 2) {
      const affectedProspects = new Set(
        events.filter((e) => e.collisionDetected).map((e) => e.prospectId).filter(Boolean)
      ).size;
      alerts.push({
        type: "TRIGGER_COLLISIONS",
        severity: "warning",
        message: `${collisions} trigger collision${collisions !== 1 ? "s" : ""} detected — same prospect triggered by multiple sources simultaneously.`,
        affectedCount: affectedProspects,
        suggestedAction: "Check for overlapping cron schedules. Collisions can cause duplicate emails or race conditions.",
      });
    }

    // ── 8. DNC violations (should never reach send) ──────────────────────────
    const dncBlocks = events.filter((e) => e.blockReason === "DNC");
    if (dncBlocks.length >= 3) {
      const unique = new Set(dncBlocks.map((e) => e.prospectId).filter(Boolean)).size;
      alerts.push({
        type: "DNC_QUEUE_POLLUTION",
        severity: "critical",
        message: `${dncBlocks.length} DNC prospects appeared in evaluation queue (${unique} unique). These should be excluded earlier.`,
        affectedCount: unique,
        suggestedAction: "Ensure the outreach queue builder filters DNC prospects before evaluation to avoid unnecessary processing.",
      });
    }

    // ── 9. Agent disabled but prospects exist ────────────────────────────────
    const agentDisabledBlocks = events.filter((e) => e.blockReason === "AGENT_DISABLED");
    if (agentDisabledBlocks.length > 0) {
      alerts.push({
        type: "AGENT_DISABLED",
        severity: "info",
        message: `Email Agent is currently disabled — ${agentDisabledBlocks.length} evaluation${agentDisabledBlocks.length !== 1 ? "s were" : " was"} skipped.`,
        affectedCount: agentDisabledBlocks.length,
        suggestedAction: "Enable the Email Agent in Email Agent → Settings to resume automated outreach.",
      });
    }
  } catch (err: any) {
    console.warn("[TriggerAlerts] computeTriggerAlerts error:", err.message);
  }

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const topRisk = alerts.length > 0
    ? (alerts.find((a) => a.severity === "critical") ?? alerts[0]).message
    : null;

  return {
    alerts,
    hasActive: alerts.length > 0,
    criticalCount,
    warningCount,
    topRisk,
  };
}

/**
 * Build a short agent context string from active trigger alerts.
 */
export function buildTriggerAlertsContextString(result: TriggerAlertsResult): string {
  if (!result.hasActive) return "";
  const lines = result.alerts.map(
    (a) => `  [${a.severity.toUpperCase()}] ${a.message} → ${a.suggestedAction}`
  );
  return `\nTRIGGER SYSTEM ALERTS (${result.alerts.length} active):\n${lines.join("\n")}\nRULE: Always mention active CRITICAL alerts before recommending outreach actions. Do not recommend sending emails if NO_EMAILS_SENT or HIGH_BLOCK_RATE alerts are active without first explaining the issue.`;
}
