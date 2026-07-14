/**
 * Kevin Slack EOH — Notification Priority Engine
 *
 * Classifies every event into a priority tier using deterministic scoring.
 * No LLM calls during classification to ensure reliability.
 *
 * Priority tiers:
 *   IGNORE          — no action, discard silently
 *   SILENT_MEMORY   — store in Obsidian, do not send Slack message
 *   AGGREGATE       — batch into next digest
 *   DAILY_DIGEST    — include in daily brief
 *   IMPORTANT       — send immediate Slack message with action buttons
 *   CRITICAL        — send immediate Slack message, escalate
 *   EXECUTIVE_BRIEF — elevated CRITICAL, include in CEO summary
 */

export type NotificationPriority =
  | "IGNORE"
  | "SILENT_MEMORY"
  | "AGGREGATE"
  | "DAILY_DIGEST"
  | "IMPORTANT"
  | "CRITICAL"
  | "EXECUTIVE_BRIEF";

export interface NotificationEvent {
  eventType: string;
  urgency: number;           // 0–10
  businessImpact: number;    // 0–10
  revenueImpact: number;     // 0–10
  customerImpact: number;    // 0–10
  operationalImpact: number; // 0–10
  securityImpact: number;    // 0–10
  confidence: number;        // 0–1
  recurrence?: number;       // 0–10, how frequently this fires
  timeSensitivity: number;   // 0–10
  roleRelevance?: string[];  // roles this matters to
  hasOpenAlert?: boolean;    // duplicate suppression
  inQuietHours?: boolean;    // quiet-hours flag
  metadata?: Record<string, unknown>;
}

export interface ClassificationResult {
  priority: NotificationPriority;
  score: number;
  reasons: string[];
  suppressDuplicate: boolean;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

const EVENT_TYPE_BASE_PRIORITY: Record<string, NotificationPriority> = {
  // Critical operational events
  "security.breach": "EXECUTIVE_BRIEF",
  "security.escalation": "CRITICAL",
  "agent.dead_letter_threshold": "CRITICAL",
  "integration.major_failure": "CRITICAL",
  "scheduling.mass_cancellation": "CRITICAL",
  "approval.urgent": "CRITICAL",

  // Important events
  "scheduling.conflict_high_impact": "IMPORTANT",
  "revenue.material_opportunity": "IMPORTANT",
  "lead.high_value": "IMPORTANT",
  "approval.pending": "IMPORTANT",
  "agent.governance_escalation": "IMPORTANT",

  // Digest-level events
  "scheduling.session_created": "AGGREGATE",
  "scheduling.session_cancelled": "AGGREGATE",
  "scheduling.session_rescheduled": "AGGREGATE",
  "lead.new": "DAILY_DIGEST",
  "revenue.daily_summary": "DAILY_DIGEST",
  "agent.completed": "DAILY_DIGEST",

  // Silent memory
  "user.preference_updated": "SILENT_MEMORY",
  "digest.preference_updated": "SILENT_MEMORY",
  "command.read_only": "SILENT_MEMORY",

  // Ignore
  "heartbeat.ping": "IGNORE",
  "bot.self_message": "IGNORE",
};

function computeScore(event: NotificationEvent): number {
  let score = 0;

  score += event.urgency * 2.5;
  score += event.businessImpact * 2.0;
  score += event.revenueImpact * 1.8;
  score += event.customerImpact * 1.5;
  score += event.operationalImpact * 1.5;
  score += event.securityImpact * 3.0;
  score += event.timeSensitivity * 2.0;
  score *= event.confidence;

  // Penalise high-frequency routine events
  if (event.recurrence && event.recurrence > 5) {
    score *= 0.4;
  }

  // Boost time-sensitive events
  if (event.timeSensitivity > 7) {
    score *= 1.3;
  }

  return Math.round(score * 10) / 10;
}

function scoreToTier(score: number): NotificationPriority {
  if (score >= 80) return "EXECUTIVE_BRIEF";
  if (score >= 60) return "CRITICAL";
  if (score >= 40) return "IMPORTANT";
  if (score >= 20) return "DAILY_DIGEST";
  if (score >= 10) return "AGGREGATE";
  if (score >= 2) return "SILENT_MEMORY";
  return "IGNORE";
}

export function classifyNotification(event: NotificationEvent): ClassificationResult {
  const reasons: string[] = [];
  let suppressDuplicate = false;

  // Duplicate suppression
  if (event.hasOpenAlert) {
    suppressDuplicate = true;
    reasons.push("Duplicate of open alert — suppressed");
    return { priority: "IGNORE", score: 0, reasons, suppressDuplicate };
  }

  // Event type override takes precedence
  const basePriority = EVENT_TYPE_BASE_PRIORITY[event.eventType];
  if (basePriority === "IGNORE") {
    return { priority: "IGNORE", score: 0, reasons: ["Event type always ignored"], suppressDuplicate: false };
  }

  const score = computeScore(event);
  let priority = scoreToTier(score);

  // Apply event-type floor (score can never go below base priority)
  if (basePriority) {
    const tierOrder: NotificationPriority[] = [
      "IGNORE", "SILENT_MEMORY", "AGGREGATE", "DAILY_DIGEST", "IMPORTANT", "CRITICAL", "EXECUTIVE_BRIEF",
    ];
    const baseIdx = tierOrder.indexOf(basePriority);
    const scoreIdx = tierOrder.indexOf(priority);
    if (baseIdx > scoreIdx) {
      priority = basePriority;
      reasons.push(`Event type floor applied: ${basePriority}`);
    }
  }

  // Security always goes CRITICAL or higher
  if (event.securityImpact > 5 && tierOrder_indexOf(priority) < tierOrder_indexOf("CRITICAL")) {
    priority = "CRITICAL";
    reasons.push("Security impact elevated to CRITICAL");
  }

  // Quiet hours: downgrade IMPORTANT to DAILY_DIGEST (not CRITICAL/EXECUTIVE_BRIEF)
  if (event.inQuietHours && priority === "IMPORTANT") {
    priority = "DAILY_DIGEST";
    reasons.push("Quiet hours: IMPORTANT downgraded to DAILY_DIGEST");
  }

  reasons.push(`Score: ${score}`);

  return { priority, score, reasons, suppressDuplicate };
}

function tierOrder_indexOf(tier: NotificationPriority): number {
  const order: NotificationPriority[] = [
    "IGNORE", "SILENT_MEMORY", "AGGREGATE", "DAILY_DIGEST", "IMPORTANT", "CRITICAL", "EXECUTIVE_BRIEF",
  ];
  return order.indexOf(tier);
}

export function shouldSendImmediately(priority: NotificationPriority): boolean {
  return priority === "CRITICAL" || priority === "EXECUTIVE_BRIEF" || priority === "IMPORTANT";
}

export function shouldAggregate(priority: NotificationPriority): boolean {
  return priority === "AGGREGATE" || priority === "DAILY_DIGEST";
}

export function shouldStoreMemory(priority: NotificationPriority): boolean {
  return priority !== "IGNORE";
}
