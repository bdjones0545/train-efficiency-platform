/**
 * Kevin Slack EOH — Approval Handler
 *
 * Routes Slack-originated approvals to existing TrainEfficiency approval handlers.
 *
 * Rules:
 * - Verify Slack signature (done upstream)
 * - Resolve identity and organization
 * - Verify role
 * - Check the approval is still pending (double-approve prevention)
 * - Use the existing approval handler, not raw DB writes
 * - Preserve all existing send guards and autonomy policy
 * - Audit every approval action
 * - Update the Slack message after action
 * - Action tokens are opaque — no raw authorization data in buttons
 *
 * Supported approval types (only those with canonical backend handlers):
 * - scheduling_change (via scheduling-handler.ts action tokens)
 *
 * Additional types (agentmail, recommendations) will be added when
 * their canonical handlers are verified and stable.
 */

import { isApprovalsEnabled } from "./config";
import type { ResolvedIdentity } from "./identity-service";
import {
  executeCreateSession,
  executeReschedule,
  executeCancelSession,
} from "./scheduling-handler";
import { invalidateActionToken, classifyClaimFailure } from "./action-token-service";
import { recordAuditEvent } from "./audit-service";
import type { SlackBlock } from "./block-kit";
import crypto from "crypto";

export interface ActionPayload {
  type: "block_actions";
  team: { id: string; domain: string };
  user: { id: string; name?: string };
  channel?: { id: string };
  message?: { ts: string; blocks?: SlackBlock[] };
  actions: Array<{
    action_id: string;
    value: string;
    block_id?: string;
  }>;
  response_url?: string;
  trigger_id?: string;
}

export interface ApprovalResult {
  ok: boolean;
  responseBlocks?: SlackBlock[];
  responseText?: string;
  error?: string;
  shouldUpdateMessage?: boolean;
}

/** Build a Block Kit "expired token" response for Slack display */
function expiredTokenBlocks(): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "⏰ *This confirmation has expired.* Ask Kevin to generate a new preview.",
      },
    },
  ];
}

export async function handleSlackAction(
  payload: ActionPayload,
  identity: ResolvedIdentity | null,
): Promise<ApprovalResult> {
  // Acknowledgements, dismissals, and abort actions are always allowed — they
  // are not state-changing writes that require the approvals feature flag.
  const alwaysAllowedActions = [
    "acknowledge_alert", "dismiss_action", "cancel_session_abort",
    "create_session_cancel", "reschedule_cancel",
    "open_dashboard", "open_url", "open_approvals",
  ];
  const firstActionId = payload.actions[0]?.action_id ?? "";
  const isAlwaysAllowed = alwaysAllowedActions.includes(firstActionId)
    || firstActionId.startsWith("cancel_session_select_");

  if (!isAlwaysAllowed && !isApprovalsEnabled() && !payload.actions.some((a) =>
    a.action_id.startsWith("create_session_") ||
    a.action_id.startsWith("reschedule_") ||
    a.action_id.startsWith("cancel_session_confirm")
  )) {
    return { ok: false, error: "Approvals not enabled" };
  }

  const traceId = crypto.randomBytes(8).toString("hex");
  const action = payload.actions[0];
  if (!action) return { ok: false, error: "No action found" };

  const { action_id, value } = action;
  const teamId = payload.team.id;
  const slackUserId = payload.user.id;
  const slackContext = { teamId, slackUserId };

  // Read-only actions (no identity required)
  if (action_id === "open_dashboard" || action_id === "open_url" || action_id === "open_approvals") {
    return { ok: true, responseText: "Opening..." };
  }

  if (!identity) {
    return {
      ok: false,
      responseBlocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "❌ *Cannot process action* — your Slack account is not linked to TrainEfficiency.\n\nAsk your administrator to link your account.",
          },
        },
      ],
      shouldUpdateMessage: true,
    };
  }

  // ─── Scheduling confirmations ──────────────────────────────────────────────

  if (action_id === "create_session_confirm") {
    const result = await executeCreateSession(value, identity, slackContext);

    // If the token was expired/consumed, show a clear Slack message
    if (!result.ok && result.error === "Action token expired or invalid") {
      const classification = await classifyClaimFailure(value);
      await recordAuditEvent({
        slackTeamId: teamId, slackUserId,
        trainefficiencyUserId: identity.userId, orgId: identity.orgId,
        intent: "create_session", requestedOperation: "create_session",
        authorizationResult: "allowed", confirmationResult: "confirmed",
        executionResult: "failure", outcome: "failed",
        traceId, errorMessage: classification.reason,
      });
      return {
        ok: false, shouldUpdateMessage: true,
        responseBlocks: expiredTokenBlocks(),
        error: classification.reason,
      };
    }

    await recordAuditEvent({
      slackTeamId: teamId, slackUserId,
      trainefficiencyUserId: identity.userId, orgId: identity.orgId,
      intent: "create_session", requestedOperation: "create_session",
      authorizationResult: "allowed", confirmationResult: "confirmed",
      executionResult: result.ok ? "success" : "failure",
      outcome: result.ok ? "executed" : "failed",
      traceId, errorMessage: result.error ?? null,
    });
    return {
      ok: result.ok, shouldUpdateMessage: true,
      responseBlocks: result.ok
        ? [{ type: "section", text: { type: "mrkdwn", text: `✅ *Session created successfully.*\nBooking ID: \`${result.bookingId}\`` } }]
        : [{ type: "section", text: { type: "mrkdwn", text: `❌ Failed to create session: ${result.error}` } }],
      error: result.error,
    };
  }

  if (action_id === "create_session_cancel") {
    // Cancel the token so it cannot be used again
    if (value) await invalidateActionToken(value);

    await recordAuditEvent({
      slackTeamId: teamId, slackUserId,
      trainefficiencyUserId: identity.userId, orgId: identity.orgId,
      intent: "create_session", requestedOperation: "create_session",
      authorizationResult: "allowed", confirmationResult: "cancelled",
      executionResult: "skipped", outcome: "canceled",
      traceId, errorMessage: null,
    });
    return {
      ok: true, shouldUpdateMessage: true,
      responseBlocks: [{ type: "section", text: { type: "mrkdwn", text: "✅ Session creation cancelled." } }],
    };
  }

  if (action_id === "reschedule_confirm") {
    const result = await executeReschedule(value, identity, slackContext);

    if (!result.ok && result.error === "Action token expired or invalid") {
      const classification = await classifyClaimFailure(value);
      return {
        ok: false, shouldUpdateMessage: true,
        responseBlocks: expiredTokenBlocks(),
        error: classification.reason,
      };
    }

    await recordAuditEvent({
      slackTeamId: teamId, slackUserId,
      trainefficiencyUserId: identity.userId, orgId: identity.orgId,
      intent: "reschedule_session", requestedOperation: "reschedule_session",
      authorizationResult: "allowed", confirmationResult: "confirmed",
      executionResult: result.ok ? "success" : "failure",
      outcome: result.ok ? "executed" : "failed",
      traceId, errorMessage: result.error ?? null,
    });
    return {
      ok: result.ok, shouldUpdateMessage: true,
      responseBlocks: result.ok
        ? [{ type: "section", text: { type: "mrkdwn", text: `✅ *Session rescheduled successfully.*` } }]
        : [{ type: "section", text: { type: "mrkdwn", text: `❌ Reschedule failed: ${result.error}` } }],
    };
  }

  if (action_id === "reschedule_cancel") {
    if (value) await invalidateActionToken(value);
    return {
      ok: true, shouldUpdateMessage: true,
      responseBlocks: [{ type: "section", text: { type: "mrkdwn", text: "✅ Reschedule cancelled." } }],
    };
  }

  if (action_id === "cancel_session_confirm") {
    const result = await executeCancelSession(value, identity, slackContext);

    if (!result.ok && result.error === "Action token expired or invalid") {
      const classification = await classifyClaimFailure(value);
      return {
        ok: false, shouldUpdateMessage: true,
        responseBlocks: expiredTokenBlocks(),
        error: classification.reason,
      };
    }

    await recordAuditEvent({
      slackTeamId: teamId, slackUserId,
      trainefficiencyUserId: identity.userId, orgId: identity.orgId,
      intent: "cancel_session", requestedOperation: "cancel_session",
      authorizationResult: "allowed", confirmationResult: "confirmed",
      executionResult: result.ok ? "success" : "failure",
      outcome: result.ok ? "executed" : "failed",
      traceId, errorMessage: result.error ?? null,
    });
    return {
      ok: result.ok, shouldUpdateMessage: true,
      responseBlocks: result.ok
        ? [{ type: "section", text: { type: "mrkdwn", text: `✅ *Session cancelled.*` } }]
        : [{ type: "section", text: { type: "mrkdwn", text: `❌ Cancellation failed: ${result.error}` } }],
    };
  }

  if (action_id === "cancel_session_abort") {
    if (value) await invalidateActionToken(value);
    return {
      ok: true, shouldUpdateMessage: true,
      responseBlocks: [{ type: "section", text: { type: "mrkdwn", text: "✅ Session kept — no changes made." } }],
    };
  }

  // Dynamic cancel selection from disambiguation
  if (action_id.startsWith("cancel_session_select_")) {
    const bookingId = value;
    const { buildCancelSessionPreviewBlocks } = await import("./scheduling-handler");
    const result = await buildCancelSessionPreviewBlocks(identity, bookingId);
    return {
      ok: true, shouldUpdateMessage: false,
      responseBlocks: result.blocks,
    };
  }

  // Acknowledge/dismiss alerts
  if (action_id === "acknowledge_alert" || action_id === "dismiss_action") {
    await recordAuditEvent({
      slackTeamId: teamId, slackUserId,
      trainefficiencyUserId: identity.userId, orgId: identity.orgId,
      intent: "alert_acknowledgement", requestedOperation: action_id,
      authorizationResult: "allowed", confirmationResult: "confirmed",
      executionResult: "success",
      outcome: action_id === "dismiss_action" ? "dismissed" : "approved",
      traceId, errorMessage: null,
    });
    return {
      ok: true, shouldUpdateMessage: true,
      responseBlocks: [{ type: "section", text: { type: "mrkdwn", text: "✅ Acknowledged." } }],
    };
  }

  // Unknown action — safe fallback
  return { ok: false, error: `Unknown action_id: ${action_id}` };
}
