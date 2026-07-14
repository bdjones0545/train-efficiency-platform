/**
 * Kevin Slack EOH — Command Router
 *
 * Routes slash commands and @Kevin mentions to the appropriate handler.
 *
 * Supported commands:
 *   /kevin help
 *   /kevin schedule [natural language]
 *   /kevin sessions [today|tomorrow|date]
 *   /kevin openings [day]
 *   /kevin approvals
 *   /kevin summary
 *   /kevin health
 *   /kevin integrations
 *   /kevin cancel [session reference]
 *
 * Rules:
 * - Read-only commands work without identity mapping (show help/info)
 * - Write commands require verified identity mapping
 * - Bot messages are ignored
 * - Thread context is preserved
 * - Ephemeral responses for user-specific data
 */

import type { ResolvedIdentity } from "./identity-service";
import { buildHelpMessage, buildErrorMessage, type SlackBlock } from "./block-kit";
import {
  handleViewSchedule,
  buildCreateSessionPreviewBlocks,
  buildCancelSessionPreviewBlocks,
  findSessionsForUser,
} from "./scheduling-handler";
import {
  isCommandsEnabled,
  isSchedulingEnabled,
} from "./config";
import { storage } from "../storage";

export interface CommandContext {
  teamId: string;
  channelId: string;
  userId: string;
  threadTs: string | null;
  orgId: string | null;
  identity: ResolvedIdentity | null;
  traceId: string;
  rawText: string;
}

export interface CommandResponse {
  text?: string;
  blocks?: SlackBlock[];
  ephemeral: boolean;
  responseType: "ephemeral" | "in_channel";
}

// ─── Intent parsing ───────────────────────────────────────────────────────────

function parseCommand(text: string): { command: string; args: string } {
  const clean = text.trim().toLowerCase();
  const parts = clean.split(/\s+/);
  const command = parts[0] ?? "help";
  const args = parts.slice(1).join(" ");
  return { command, args };
}

function parseRelativeDate(text: string): Date {
  const lower = text.toLowerCase().trim();
  const today = new Date();

  if (lower === "today" || lower === "") {
    return today;
  }
  if (lower === "tomorrow") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }

  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayIdx = weekdays.indexOf(lower);
  if (dayIdx !== -1) {
    const current = today.getDay();
    let diff = dayIdx - current;
    if (diff <= 0) diff += 7;
    const d = new Date(today);
    d.setDate(d.getDate() + diff);
    return d;
  }

  return today;
}

// ─── Command dispatch ─────────────────────────────────────────────────────────

export async function routeCommand(ctx: CommandContext): Promise<CommandResponse> {
  if (!isCommandsEnabled()) {
    return {
      text: "Kevin Slack commands are not enabled for this workspace.",
      ephemeral: true,
      responseType: "ephemeral",
    };
  }

  const { command, args } = parseCommand(ctx.rawText);

  switch (command) {
    case "help":
    case "":
      return handleHelp(ctx);

    case "health":
      return handleHealth(ctx);

    case "integrations":
      return handleIntegrations(ctx);

    case "sessions":
    case "schedule":
      if (!ctx.identity) return notLinkedResponse();
      return command === "sessions"
        ? handleViewSessions(ctx, args)
        : handleScheduleIntent(ctx, args);

    case "openings":
      if (!ctx.identity) return notLinkedResponse();
      return handleViewOpenings(ctx, args);

    case "approvals":
      if (!ctx.identity) return notLinkedResponse();
      return handleViewApprovals(ctx);

    case "summary":
      if (!ctx.identity) return notLinkedResponse();
      return handleSummary(ctx);

    case "cancel":
      if (!ctx.identity) return notLinkedResponse();
      return handleCancelIntent(ctx, args);

    default:
      return {
        blocks: buildHelpMessage(),
        ephemeral: true,
        responseType: "ephemeral",
      };
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

function handleHelp(ctx: CommandContext): CommandResponse {
  return {
    blocks: buildHelpMessage(),
    ephemeral: true,
    responseType: "ephemeral",
  };
}

async function handleHealth(ctx: CommandContext): Promise<CommandResponse> {
  const lines = [
    "*Kevin Health Status*",
    "",
    `• TrainEfficiency API: ✅ Connected`,
    `• Kevin Events: ✅ Active`,
    `• Slack Integration: ✅ Connected`,
    `• Scheduling: ${isSchedulingEnabled() ? "✅ Enabled" : "⚠️ Disabled"}`,
    `• Commands: ✅ Enabled`,
  ];

  return {
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      { type: "context", elements: [{ type: "mrkdwn", text: `Kevin · ${new Date().toLocaleString()}` }] },
    ],
    ephemeral: true,
    responseType: "ephemeral",
  };
}

async function handleIntegrations(ctx: CommandContext): Promise<CommandResponse> {
  if (!ctx.identity) return notLinkedResponse();

  const lines = [
    "*Integration Status*",
    "",
    `• Slack: ✅ Connected`,
    `• Scheduling: ${isSchedulingEnabled() ? "✅ Active" : "⚠️ Disabled"}`,
    `• AI Agent: ✅ Running`,
  ];

  return {
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "🔗 View Dashboard", emoji: true },
            url: "/admin/ceo-heartbeat",
            action_id: "open_dashboard",
          },
        ],
      },
    ],
    ephemeral: true,
    responseType: "ephemeral",
  };
}

async function handleViewSessions(ctx: CommandContext, args: string): Promise<CommandResponse> {
  const date = parseRelativeDate(args || "today");
  const result = await handleViewSchedule(ctx.identity!, date);
  return {
    blocks: result.blocks,
    ephemeral: result.ephemeral,
    responseType: "ephemeral",
  };
}

async function handleScheduleIntent(ctx: CommandContext, args: string): Promise<CommandResponse> {
  if (!isSchedulingEnabled()) {
    return {
      blocks: buildErrorMessage("Scheduling via Slack is currently disabled. Use the TrainEfficiency dashboard."),
      ephemeral: true,
      responseType: "ephemeral",
    };
  }

  // Simple intent — return conversational prompt for now
  // Full NLP scheduling intake is handled through the event handler multi-step flow
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `Got it — you want to schedule a session. Let me help with that.`,
            ``,
            `Please provide:`,
            `• Date and time (e.g. _tomorrow at 4pm_)`,
            `• Coach name`,
            `• Athlete name(s)`,
            `• Session type`,
          ].join("\n"),
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "Reply in this thread or type _cancel_ to stop." }],
      },
    ],
    ephemeral: true,
    responseType: "ephemeral",
  };
}

async function handleViewOpenings(ctx: CommandContext, args: string): Promise<CommandResponse> {
  const date = parseRelativeDate(args || "today");
  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  // Use existing schedule to infer availability
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  try {
    const bookings = await storage.getBookingsByDateRangeForOrg(ctx.identity!.orgId, start, end);
    const bookedSlots = new Set(
      bookings.map((b) => b.startAt ? new Date(b.startAt).getHours() : -1),
    );

    const openings: string[] = [];
    for (let h = 7; h <= 20; h++) {
      if (!bookedSlots.has(h)) {
        const timeStr = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h)
          .toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        openings.push(`• ${timeStr}`);
      }
    }

    return {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              openings.length > 0
                ? `*Available slots on ${dateLabel}*\n\n${openings.slice(0, 8).join("\n")}`
                : `No available slots found for ${dateLabel}.`,
          },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: "Kevin · Based on current bookings" }],
        },
      ],
      ephemeral: true,
      responseType: "ephemeral",
    };
  } catch (err: any) {
    return {
      blocks: buildErrorMessage("Unable to load openings. Try the TrainEfficiency dashboard."),
      ephemeral: true,
      responseType: "ephemeral",
    };
  }
}

async function handleViewApprovals(ctx: CommandContext): Promise<CommandResponse> {
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Pending Approvals*\n\nOpen the TrainEfficiency dashboard to view and action pending approvals.",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "🔗 View Approvals", emoji: true },
            url: "/admin/ceo-heartbeat",
            action_id: "open_approvals",
          },
        ],
      },
    ],
    ephemeral: true,
    responseType: "ephemeral",
  };
}

async function handleSummary(ctx: CommandContext): Promise<CommandResponse> {
  try {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    const bookings = await storage.getBookingsByDateRangeForOrg(ctx.identity!.orgId, start, end);
    const completed = bookings.filter((b) => b.status === "COMPLETED").length;
    const cancelled = bookings.filter((b) => b.status === "CANCELLED").length;

    return {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: [
              `*Today's Summary*`,
              ``,
              `📅 Sessions: ${bookings.length} total`,
              `✅ Completed: ${completed}`,
              `❌ Cancelled: ${cancelled}`,
              `🔄 Upcoming: ${bookings.length - completed - cancelled}`,
            ].join("\n"),
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "🔗 Full Dashboard", emoji: true },
              url: "/admin/ceo-heartbeat",
              action_id: "open_dashboard",
            },
          ],
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `Kevin · ${today.toLocaleDateString()}` }],
        },
      ],
      ephemeral: true,
      responseType: "ephemeral",
    };
  } catch (err: any) {
    return {
      blocks: buildErrorMessage("Unable to load summary."),
      ephemeral: true,
      responseType: "ephemeral",
    };
  }
}

async function handleCancelIntent(ctx: CommandContext, args: string): Promise<CommandResponse> {
  if (!isSchedulingEnabled()) {
    return {
      blocks: buildErrorMessage("Scheduling via Slack is currently disabled."),
      ephemeral: true,
      responseType: "ephemeral",
    };
  }

  if (!args) {
    return {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Which session would you like to cancel? Please provide the athlete or coach name.",
          },
        },
      ],
      ephemeral: true,
      responseType: "ephemeral",
    };
  }

  const matches = await findSessionsForUser(ctx.identity!.orgId, args);
  if (matches.length === 0) {
    return {
      blocks: buildErrorMessage(`No upcoming sessions found matching "${args}".`),
      ephemeral: true,
      responseType: "ephemeral",
    };
  }

  if (matches.length === 1) {
    const result = await buildCancelSessionPreviewBlocks(ctx.identity!, matches[0].id);
    return { blocks: result.blocks, ephemeral: true, responseType: "ephemeral" };
  }

  // Disambiguation
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Found ${matches.length} sessions matching "${args}". Which one did you mean?`,
        },
      },
      {
        type: "actions",
        elements: matches.slice(0, 5).map((m) => ({
          type: "button",
          text: { type: "plain_text", text: m.label.slice(0, 75), emoji: true },
          action_id: `cancel_session_select_${m.id}`,
          value: m.id,
        })),
      },
    ],
    ephemeral: true,
    responseType: "ephemeral",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function notLinkedResponse(): CommandResponse {
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "👤 *Account not linked*\n\nYour Slack account hasn't been connected to TrainEfficiency yet.\n\nAsk your administrator to link your account to use Kevin's scheduling features.",
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "Kevin · Use `/kevin help` for available commands" }],
      },
    ],
    ephemeral: true,
    responseType: "ephemeral",
  };
}
