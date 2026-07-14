/**
 * Kevin Slack EOH — Block Kit Builders
 *
 * All user-facing Slack messages use Block Kit for structured presentation.
 * Messages answer: What happened? Why does it matter? What should I do?
 * How confident is Kevin? Where can I review or act?
 */

export type SlackBlock = Record<string, unknown>;

// ─── Divider ────────────────────────────────────────────────────────────────

export function divider(): SlackBlock {
  return { type: "divider" };
}

// ─── Header ─────────────────────────────────────────────────────────────────

export function header(text: string): SlackBlock {
  return {
    type: "header",
    text: { type: "plain_text", text, emoji: true },
  };
}

// ─── Section (mrkdwn) ────────────────────────────────────────────────────────

export function section(text: string): SlackBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text },
  };
}

// ─── Context (footer-style) ──────────────────────────────────────────────────

export function contextBlock(text: string): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text }],
  };
}

// ─── Button ──────────────────────────────────────────────────────────────────

export function button(
  text: string,
  actionId: string,
  value: string,
  style?: "primary" | "danger",
): SlackBlock {
  return {
    type: "button",
    text: { type: "plain_text", text, emoji: true },
    action_id: actionId,
    value,
    ...(style ? { style } : {}),
  };
}

// ─── Actions block ───────────────────────────────────────────────────────────

export function actions(elements: SlackBlock[]): SlackBlock {
  return { type: "actions", elements };
}

// ─── Fields section ──────────────────────────────────────────────────────────

export function fieldsSection(fields: Array<[string, string]>): SlackBlock {
  return {
    type: "section",
    fields: fields.map(([label, value]) => ({
      type: "mrkdwn",
      text: `*${label}*\n${value}`,
    })),
  };
}

// ─── URL button accessory ─────────────────────────────────────────────────────

export function sectionWithUrl(text: string, buttonLabel: string, url: string): SlackBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text },
    accessory: {
      type: "button",
      text: { type: "plain_text", text: buttonLabel, emoji: true },
      url,
      action_id: "open_url",
    },
  };
}

// ─── Create-session preview ───────────────────────────────────────────────────

export interface CreateSessionPreviewInput {
  sessionType: string;
  date: string;
  time: string;
  timezone: string;
  coachName: string;
  athleteCount: number;
  location?: string;
  recurrence?: string;
  conflictStatus: "none" | "warning" | "blocked";
  requiresApproval: boolean;
  actionToken: string;
  appBaseUrl?: string;
}

export function buildCreateSessionPreview(input: CreateSessionPreviewInput): SlackBlock[] {
  const conflictText =
    input.conflictStatus === "none"
      ? "✅ No conflicts"
      : input.conflictStatus === "warning"
      ? "⚠️ Potential conflict — review recommended"
      : "🚫 Conflict detected — cannot schedule";

  const blocks: SlackBlock[] = [
    header("📅 Schedule Session — Confirmation"),
    fieldsSection([
      ["Session Type", input.sessionType],
      ["Date", input.date],
      ["Time", `${input.time} (${input.timezone})`],
      ["Coach", input.coachName],
      ["Participants", `${input.athleteCount} athlete${input.athleteCount !== 1 ? "s" : ""}`],
      ["Location", input.location ?? "TBD"],
      ["Recurrence", input.recurrence ?? "One-time"],
      ["Conflicts", conflictText],
      ["Approval Required", input.requiresApproval ? "Yes — pending approval" : "No"],
    ]),
    divider(),
    actions([
      button("✅ Confirm", "create_session_confirm", input.actionToken, "primary"),
      button("✏️ Edit", "create_session_edit", input.actionToken),
      button("❌ Cancel", "create_session_cancel", input.actionToken, "danger"),
    ]),
    contextBlock("Kevin · TrainEfficiency Scheduling · Reply with _cancel_ to stop"),
  ];

  return blocks;
}

// ─── Reschedule preview ───────────────────────────────────────────────────────

export interface ReschedulePreviewInput {
  bookingId: string;
  sessionType: string;
  currentDate: string;
  currentTime: string;
  proposedDate: string;
  proposedTime: string;
  timezone: string;
  coachAvailable: boolean;
  conflictStatus: "none" | "warning" | "blocked";
  affectedParticipants: number;
  actionToken: string;
}

export function buildReschedulePreview(input: ReschedulePreviewInput): SlackBlock[] {
  return [
    header("🔄 Reschedule Session — Confirmation"),
    fieldsSection([
      ["Current", `${input.currentDate} at ${input.currentTime}`],
      ["Proposed", `${input.proposedDate} at ${input.proposedTime} (${input.timezone})`],
      ["Session Type", input.sessionType],
      ["Coach Availability", input.coachAvailable ? "✅ Available" : "⚠️ Conflict — check manually"],
      ["Conflicts", input.conflictStatus === "none" ? "✅ None" : input.conflictStatus === "warning" ? "⚠️ Warning" : "🚫 Blocked"],
      ["Affected Participants", `${input.affectedParticipants}`],
    ]),
    divider(),
    actions([
      button("✅ Confirm Reschedule", "reschedule_confirm", input.actionToken, "primary"),
      button("✏️ Edit", "reschedule_edit", input.actionToken),
      button("❌ Cancel", "reschedule_cancel", input.actionToken, "danger"),
    ]),
    contextBlock("Kevin · Participants will be notified of the change"),
  ];
}

// ─── Cancellation preview ─────────────────────────────────────────────────────

export interface CancellationPreviewInput {
  bookingId: string;
  sessionType: string;
  date: string;
  time: string;
  coachName: string;
  participantCount: number;
  cancellationPolicy?: string;
  reasonCategory: string;
  actionToken: string;
}

export function buildCancellationPreview(input: CancellationPreviewInput): SlackBlock[] {
  return [
    header("🚫 Cancel Session — Confirmation"),
    fieldsSection([
      ["Session Type", input.sessionType],
      ["Date & Time", `${input.date} at ${input.time}`],
      ["Coach", input.coachName],
      ["Participants to Notify", `${input.participantCount}`],
      ["Cancellation Policy", input.cancellationPolicy ?? "Standard"],
      ["Reason", input.reasonCategory],
    ]),
    section("_Participants and coach will be notified of this cancellation._"),
    divider(),
    actions([
      button("🚫 Confirm Cancellation", "cancel_session_confirm", input.actionToken, "danger"),
      button("↩️ Keep Session", "cancel_session_abort", input.actionToken, "primary"),
    ]),
    contextBlock("Kevin · This cannot be undone from Slack — use the TrainEfficiency dashboard to restore"),
  ];
}

// ─── Critical alert ───────────────────────────────────────────────────────────

export interface CriticalAlertInput {
  what: string;
  why: string;
  recommendation: string;
  confidence: string;
  dashboardUrl?: string;
  actionToken?: string;
}

export function buildCriticalAlert(input: CriticalAlertInput): SlackBlock[] {
  const blocks: SlackBlock[] = [
    header("🚨 Critical — Action Required"),
    section(`*What happened*\n${input.what}`),
    section(`*Why it matters*\n${input.why}`),
    section(`*Recommended action*\n${input.recommendation}`),
    section(`*Kevin's confidence:* ${input.confidence}`),
    divider(),
  ];

  const actionElements: SlackBlock[] = [];
  if (input.dashboardUrl) {
    actionElements.push(button("🔗 Open Dashboard", "open_dashboard", input.dashboardUrl));
  }
  if (input.actionToken) {
    actionElements.push(button("✅ Acknowledge", "acknowledge_alert", input.actionToken));
    actionElements.push(button("🔍 View Evidence", "view_evidence", input.actionToken));
  }
  if (actionElements.length > 0) {
    blocks.push(actions(actionElements));
  }

  blocks.push(contextBlock(`Kevin · ${new Date().toLocaleString()}`));
  return blocks;
}

// ─── Important alert ──────────────────────────────────────────────────────────

export interface ImportantAlertInput {
  summary: string;
  impact: string;
  recommendation: string;
  actionToken: string;
  dashboardUrl?: string;
}

export function buildImportantAlert(input: ImportantAlertInput): SlackBlock[] {
  return [
    header("⚠️ Attention Needed"),
    section(`*Summary*\n${input.summary}`),
    section(`*Impact*\n${input.impact}`),
    section(`*Kevin's recommendation*\n${input.recommendation}`),
    divider(),
    actions([
      button("✅ Approve", "approve_action", input.actionToken, "primary"),
      button("✏️ Modify", "modify_action", input.actionToken),
      button("❌ Dismiss", "dismiss_action", input.actionToken, "danger"),
      ...(input.dashboardUrl ? [button("🔗 Open", "open_dashboard", input.dashboardUrl)] : []),
    ]),
    contextBlock(`Kevin · ${new Date().toLocaleString()}`),
  ];
}

// ─── Help message ─────────────────────────────────────────────────────────────

export function buildHelpMessage(orgName?: string): SlackBlock[] {
  return [
    header("👋 Kevin — TrainEfficiency Operations"),
    section(
      orgName
        ? `Here's what I can help you with for *${orgName}*:`
        : "Here's what I can help you with:",
    ),
    section(
      [
        "*Scheduling*",
        "• `/kevin schedule` — Create or modify a session",
        "• `/kevin sessions` — View today's sessions",
        "• `/kevin openings` — Find available slots",
        "",
        "*Operations*",
        "• `/kevin summary` — Today's activity summary",
        "• `/kevin approvals` — Pending approval requests",
        "• `/kevin health` — System health status",
        "• `/kevin integrations` — Integration status",
      ].join("\n"),
    ),
    section(
      "You can also mention me with *@Kevin* followed by a natural language request like:\n" +
        "_@Kevin schedule Bryan tomorrow at 4pm_",
    ),
    contextBlock("Kevin · TrainEfficiency Scheduling Intelligence"),
  ];
}

// ─── Daily digest ─────────────────────────────────────────────────────────────

export interface DigestInput {
  date: string;
  orgName: string;
  scheduling: {
    todaySessions: number;
    completed: number;
    cancelled: number;
    utilization: string;
  };
  revenue: {
    todayRevenue: string;
    weekRevenue: string;
    trend: string;
  };
  leads: {
    newLeads: number;
    activeOpportunities: number;
  };
  infrastructure: {
    agentHealth: string;
    pendingApprovals: number;
    deadLetterCount: number;
  };
  topActions: string[];
}

export function buildDailyDigest(input: DigestInput): SlackBlock[] {
  const blocks: SlackBlock[] = [
    header(`📊 Kevin Daily Brief — ${input.date}`),
    section(`*${input.orgName}*`),
    divider(),
    section(
      [
        `*📅 Scheduling*`,
        `Sessions today: ${input.scheduling.todaySessions} (${input.scheduling.completed} completed, ${input.scheduling.cancelled} cancelled)`,
        `Utilization: ${input.scheduling.utilization}`,
      ].join("\n"),
    ),
    section(
      [
        `*💰 Revenue*`,
        `Today: ${input.revenue.todayRevenue}`,
        `This week: ${input.revenue.weekRevenue}`,
        `Trend: ${input.revenue.trend}`,
      ].join("\n"),
    ),
    section(
      [
        `*🎯 Leads*`,
        `New leads: ${input.leads.newLeads}`,
        `Active opportunities: ${input.leads.activeOpportunities}`,
      ].join("\n"),
    ),
    section(
      [
        `*⚙️ Infrastructure*`,
        `Agent health: ${input.infrastructure.agentHealth}`,
        `Pending approvals: ${input.infrastructure.pendingApprovals}`,
        `Dead-letter queue: ${input.infrastructure.deadLetterCount}`,
      ].join("\n"),
    ),
  ];

  if (input.topActions.length > 0) {
    blocks.push(
      section(
        ["*✅ Recommended Actions*", ...input.topActions.slice(0, 5).map((a) => `• ${a}`)].join(
          "\n",
        ),
      ),
    );
  }

  blocks.push(
    divider(),
    actions([button("🔗 Open Dashboard", "open_dashboard", "/admin/ceo-heartbeat")]),
    contextBlock(`Kevin Daily Brief · ${new Date().toISOString()}`),
  );

  return blocks;
}

// ─── Disambiguation / selection list ─────────────────────────────────────────

export function buildDisambiguationMessage(
  prompt: string,
  options: Array<{ label: string; value: string }>,
  actionIdPrefix: string,
): SlackBlock[] {
  const elements = options
    .slice(0, 5)
    .map((opt) =>
      button(opt.label, `${actionIdPrefix}_select_${opt.value}`, opt.value),
    );

  return [
    section(`⚠️ *Multiple matches found*\n${prompt}`),
    actions(elements),
    contextBlock("Select one of the options above, or reply _cancel_ to stop"),
  ];
}

// ─── Ephemeral error ─────────────────────────────────────────────────────────

export function buildErrorMessage(message: string): SlackBlock[] {
  return [
    section(`❌ ${message}`),
    contextBlock("Kevin · If this persists, check the TrainEfficiency dashboard"),
  ];
}

// ─── Identity-not-linked message ─────────────────────────────────────────────

export function buildNotLinkedMessage(): SlackBlock[] {
  return [
    section(
      "👤 *Account not linked*\n\nYour Slack account hasn't been connected to TrainEfficiency yet.\n\nAsk your TrainEfficiency administrator to link your account before using Kevin's scheduling features.",
    ),
    contextBlock("Kevin · Read-only help is still available via `/kevin help`"),
  ];
}

// ─── Schedule view ────────────────────────────────────────────────────────────

export interface SessionSummary {
  id: string;
  time: string;
  sessionType: string;
  coachName: string;
  participantCount: number;
  status: string;
}

export function buildScheduleView(
  title: string,
  sessions: SessionSummary[],
  orgName?: string,
): SlackBlock[] {
  const blocks: SlackBlock[] = [header(title)];

  if (orgName) {
    blocks.push(contextBlock(`*${orgName}*`));
  }

  if (sessions.length === 0) {
    blocks.push(section("_No sessions scheduled._"));
  } else {
    for (const s of sessions.slice(0, 10)) {
      blocks.push(
        section(
          `*${s.time}* — ${s.sessionType}\n👤 Coach: ${s.coachName} · 👥 ${s.participantCount} participant${s.participantCount !== 1 ? "s" : ""} · Status: ${s.status}`,
        ),
      );
    }
    if (sessions.length > 10) {
      blocks.push(section(`_…and ${sessions.length - 10} more. Open the dashboard for the full view._`));
    }
  }

  blocks.push(
    divider(),
    actions([button("🔗 Open Scheduling Dashboard", "open_dashboard", "/admin/scheduling-command-center")]),
    contextBlock(`Kevin · ${new Date().toLocaleString()}`),
  );

  return blocks;
}
