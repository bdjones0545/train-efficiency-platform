/**
 * Kevin Slack EOH — Event Handler
 *
 * Processes incoming Slack events from POST /api/integrations/slack/events.
 *
 * Handles:
 * - url_verification challenge
 * - app_mention
 * - message (non-bot, non-duplicate)
 * - Slack retry deduplication via X-Slack-Retry-Num / X-Slack-Retry-Reason
 *
 * Rules:
 * - Bot messages are ignored (prevent loops)
 * - Retried events are deduplicated
 * - Thread context is preserved
 * - State-changing actions always go through confirmation preview
 */

import { isEventsEnabled } from "./config";
import {
  isEventDuplicate,
  markEventSeen,
  getActiveConversation,
  createConversation,
  updateConversation,
  cancelConversation,
} from "./conversation-state";
import { resolveIdentity } from "./identity-service";
import { recordAuditEvent } from "./audit-service";
import { routeCommand } from "./command-router";
import {
  buildHelpMessage,
  buildErrorMessage,
  buildNotLinkedMessage,
  type SlackBlock,
} from "./block-kit";
import crypto from "crypto";

export interface SlackEventPayload {
  type: string;
  token?: string;
  team_id?: string;
  event_id?: string;
  event?: {
    type: string;
    user?: string;
    text?: string;
    channel?: string;
    thread_ts?: string;
    ts?: string;
    bot_id?: string;
    subtype?: string;
  };
  challenge?: string;
}

export interface EventHandlerResult {
  status: 200 | 401 | 400 | 429;
  body: Record<string, unknown>;
  slackApiCalls?: Array<{ channel: string; blocks: SlackBlock[]; threadTs?: string; ephemeral?: boolean; userId?: string }>;
}

export async function handleSlackEvent(
  payload: SlackEventPayload,
  retryNum?: string,
  retryReason?: string,
): Promise<EventHandlerResult> {
  // URL verification challenge
  if (payload.type === "url_verification") {
    return { status: 200, body: { challenge: payload.challenge } };
  }

  if (!isEventsEnabled()) {
    return { status: 200, body: { ok: true } };
  }

  const event = payload.event;
  if (!event) {
    return { status: 200, body: { ok: true } };
  }

  const teamId = payload.team_id ?? "unknown";
  const eventId = payload.event_id ?? `${Date.now()}_${Math.random()}`;

  // Deduplicate retried events
  const isDup = await isEventDuplicate(eventId, teamId);
  if (isDup) {
    return { status: 200, body: { ok: true, deduplicated: true } };
  }
  await markEventSeen(eventId, teamId);

  // Ignore bot messages and subtypes (prevent loops)
  if (event.bot_id || event.subtype === "bot_message" || event.subtype === "message_changed") {
    return { status: 200, body: { ok: true } };
  }

  const userId = event.user;
  const channelId = event.channel;
  const threadTs = event.thread_ts ?? null;
  const text = event.text ?? "";
  const traceId = crypto.randomBytes(8).toString("hex");

  if (!userId || !channelId) {
    return { status: 200, body: { ok: true } };
  }

  const apiCalls: EventHandlerResult["slackApiCalls"] = [];

  // Handle app_mention and direct messages
  if (event.type === "app_mention" || event.type === "message") {
    const identity = await resolveIdentity(teamId, userId);

    // Check for active conversation context (multi-step flow)
    const activeConv = await getActiveConversation(teamId, channelId, userId, threadTs);

    // Check for cancel intent
    const lowerText = text.replace(/<@[A-Z0-9]+>/g, "").trim().toLowerCase();
    if (lowerText === "cancel" || lowerText === "stop" || lowerText === "abort") {
      if (activeConv) {
        await cancelConversation(activeConv.conversationId);
        apiCalls.push({
          channel: channelId,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "✅ Workflow cancelled." } }],
          threadTs: threadTs ?? undefined,
          ephemeral: true,
          userId,
        });
      } else {
        apiCalls.push({
          channel: channelId,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "No active workflow to cancel." } }],
          threadTs: threadTs ?? undefined,
          ephemeral: true,
          userId,
        });
      }

      await recordAuditEvent({
        slackTeamId: teamId,
        slackUserId: userId,
        trainefficiencyUserId: identity?.userId ?? null,
        orgId: identity?.orgId ?? null,
        intent: "cancel_workflow",
        requestedOperation: "cancel",
        authorizationResult: "allowed",
        confirmationResult: "cancelled",
        executionResult: "skipped",
        outcome: "canceled",
        traceId,
        errorMessage: null,
      });

      return { status: 200, body: { ok: true }, slackApiCalls: apiCalls };
    }

    // Strip the @mention prefix and route as command
    const commandText = text.replace(/<@[A-Z0-9]+>/gi, "").trim();

    const cmdResponse = await routeCommand({
      teamId,
      channelId,
      userId,
      threadTs,
      orgId: identity?.orgId ?? null,
      identity: identity ?? null,
      traceId,
      rawText: commandText,
    });

    if (cmdResponse.blocks) {
      apiCalls.push({
        channel: channelId,
        blocks: cmdResponse.blocks,
        threadTs: threadTs ?? undefined,
        ephemeral: cmdResponse.ephemeral,
        userId,
      });
    }
  }

  return { status: 200, body: { ok: true }, slackApiCalls: apiCalls };
}
