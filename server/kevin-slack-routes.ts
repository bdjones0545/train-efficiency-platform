/**
 * Kevin Slack EOH — HTTP Routes
 *
 * Three inbound endpoints:
 *   POST /api/integrations/slack/events   — Slack events (app_mention, message, etc.)
 *   POST /api/integrations/slack/commands — Slash commands (/kevin ...)
 *   POST /api/integrations/slack/actions  — Block Kit interactive actions
 *
 * Three admin endpoints:
 *   GET  /api/admin/kevin-slack/diagnostics   — Integration health
 *   GET  /api/admin/kevin-slack/mappings      — Identity mappings
 *   POST /api/admin/kevin-slack/mappings      — Create/verify mapping
 *   POST /api/admin/kevin-slack/mappings/:id/revoke — Revoke mapping
 *   GET  /api/admin/kevin-slack/audit         — Recent audit log
 *   GET  /api/admin/kevin-slack/config        — Feature flag status (no secrets)
 *
 * Notification endpoint:
 *   POST /api/internal/kevin-slack/notify     — Send a classified notification
 *
 * Registration: call registerKevinSlackRoutes(app) inside registerRoutes() in routes.ts
 */

import type { Express, Request, Response } from "express";
import { isAuthenticated } from "./replit_integrations/auth";
import { requireRole } from "./lib/require-role";

import { rawBodyCapture, verifySlackSignatureMiddleware } from "./kevin-slack/verifier";
import {
  getKevinSlackConfig,
  isSlackEnabled,
  isEventsEnabled,
  isCommandsEnabled,
  isActionsEnabled,
  isNotificationsEnabled,
  isSchedulingEnabled,
  isApprovalsEnabled,
} from "./kevin-slack/config";

import {
  ensureIdentityTables,
  findMapping,
  resolveIdentity,
  createOrUpdateMapping,
  verifyMapping,
  revokeMapping,
  listMappingsForOrg,
  listAllMappings,
} from "./kevin-slack/identity-service";

import {
  ensureConversationTables,
} from "./kevin-slack/conversation-state";

import {
  ensureAuditTables,
  recordAuditEvent,
  getRecentAuditEvents,
  getAuditStats,
} from "./kevin-slack/audit-service";

import { handleSlackEvent, type SlackEventPayload } from "./kevin-slack/event-handler";
import { routeCommand } from "./kevin-slack/command-router";
import { handleSlackAction, type ActionPayload } from "./kevin-slack/approval-handler";
import {
  ensureDigestTables,
  sendDailyDigest,
  getDigestStats,
  hasRecentNotification,
  recordNotificationSent,
} from "./kevin-slack/digest-service";
import { classifyNotification, shouldSendImmediately } from "./kevin-slack/notification-engine";
import { buildCriticalAlert, buildImportantAlert } from "./kevin-slack/block-kit";
import { storeSlackMemoryEvent } from "./kevin-slack/obsidian-bridge";

import { getSlackBotToken } from "./kevin-slack/config";
import crypto from "crypto";

// ─── Bootstrap tables ─────────────────────────────────────────────────────────

export async function bootstrapKevinSlackTables(): Promise<void> {
  await Promise.all([
    ensureIdentityTables(),
    ensureConversationTables(),
    ensureAuditTables(),
    ensureDigestTables(),
  ]);
}

// ─── Slack API helper ─────────────────────────────────────────────────────────

async function postToSlack(
  channel: string,
  blocks: unknown[],
  threadTs?: string,
  ephemeral = false,
  userId?: string,
): Promise<void> {
  const botToken = getSlackBotToken();
  if (!botToken) return;

  try {
    if (ephemeral && userId) {
      await fetch("https://slack.com/api/chat.postEphemeral", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({ channel, user: userId, blocks, ...(threadTs ? { thread_ts: threadTs } : {}) }),
      });
    } else {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({ channel, blocks, ...(threadTs ? { thread_ts: threadTs } : {}) }),
      });
    }
  } catch (err: any) {
    console.error("[Kevin Slack] postToSlack error:", err?.message);
  }
}

async function updateSlackMessage(
  responseUrl: string,
  blocks: unknown[],
): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replace_original: true, blocks }),
    });
  } catch (err: any) {
    console.error("[Kevin Slack] updateSlackMessage error:", err?.message);
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerKevinSlackRoutes(app: Express): void {
  // ── POST /api/integrations/slack/events ─────────────────────────────────────
  app.post(
    "/api/integrations/slack/events",
    rawBodyCapture,
    verifySlackSignatureMiddleware,
    async (req: any, res: Response) => {
      // Ack immediately to Slack (3-second window)
      res.status(200).json({ ok: true });

      if (!isSlackEnabled()) return;

      const payload = req.body as SlackEventPayload;

      // URL verification challenge — synchronous response already sent above,
      // but we handle it in handleSlackEvent to ensure challenge reply is returned first.
      if (payload.type === "url_verification") {
        // Already responded 200 above; Slack challenge is re-handled:
        res.status(200).json({ challenge: payload.challenge });
        return;
      }

      if (!isEventsEnabled()) return;

      const retryNum = req.headers["x-slack-retry-num"] as string | undefined;
      const retryReason = req.headers["x-slack-retry-reason"] as string | undefined;

      try {
        const result = await handleSlackEvent(payload, retryNum, retryReason);

        // Execute any queued Slack API calls
        if (result.slackApiCalls) {
          for (const call of result.slackApiCalls) {
            await postToSlack(call.channel, call.blocks, call.threadTs, call.ephemeral ?? false, call.userId);
          }
        }
      } catch (err: any) {
        console.error("[Kevin Slack] Event handler error:", err?.message);
      }
    },
  );

  // ── POST /api/integrations/slack/commands ────────────────────────────────────
  app.post(
    "/api/integrations/slack/commands",
    rawBodyCapture,
    verifySlackSignatureMiddleware,
    async (req: any, res: Response) => {
      if (!isSlackEnabled() || !isCommandsEnabled()) {
        return res.status(200).json({ text: "Kevin Slack commands are currently disabled." });
      }

      const body = req.body as Record<string, string>;
      const teamId = body.team_id ?? "";
      const userId = body.user_id ?? "";
      const channelId = body.channel_id ?? "";
      const text = (body.text ?? "").trim();
      const threadTs = body.thread_ts ?? null;
      const traceId = crypto.randomBytes(8).toString("hex");

      // Identify the user
      const identity = await resolveIdentity(teamId, userId);

      try {
        const response = await routeCommand({
          teamId,
          channelId,
          userId,
          threadTs,
          orgId: identity?.orgId ?? null,
          identity: identity ?? null,
          traceId,
          rawText: text,
        });

        // Record audit
        await recordAuditEvent({
          slackTeamId: teamId,
          slackUserId: userId,
          trainefficiencyUserId: identity?.userId ?? null,
          orgId: identity?.orgId ?? null,
          intent: text.split(" ")[0] ?? "unknown",
          requestedOperation: `command:${text}`,
          authorizationResult: identity ? "allowed" : "not_resolved",
          confirmationResult: "not_required",
          executionResult: "success",
          outcome: "executed",
          traceId,
          errorMessage: null,
        });

        return res.status(200).json({
          response_type: response.responseType,
          blocks: response.blocks,
          text: response.text,
        });
      } catch (err: any) {
        console.error("[Kevin Slack] Command handler error:", err?.message);
        return res.status(200).json({ text: "⚠️ Kevin encountered an error. Please try again." });
      }
    },
  );

  // ── POST /api/integrations/slack/actions ────────────────────────────────────
  app.post(
    "/api/integrations/slack/actions",
    rawBodyCapture,
    verifySlackSignatureMiddleware,
    async (req: any, res: Response) => {
      if (!isSlackEnabled() || !isActionsEnabled()) {
        return res.status(200).json({ text: "Kevin Slack actions are currently disabled." });
      }

      // Slack sends actions as URL-encoded payload= field
      let payload: ActionPayload;
      try {
        const rawPayload = req.body?.payload ?? req.body;
        payload =
          typeof rawPayload === "string"
            ? JSON.parse(rawPayload)
            : rawPayload;
      } catch (err: any) {
        return res.status(400).json({ error: "Invalid payload" });
      }

      const teamId = payload.team?.id ?? "";
      const userId = payload.user?.id ?? "";
      const responseUrl = (payload as any).response_url as string | undefined;

      // Ack immediately
      res.status(200).json({ ok: true });

      const identity = await resolveIdentity(teamId, userId);

      try {
        const result = await handleSlackAction(payload, identity ?? null);

        if (result.shouldUpdateMessage && responseUrl && result.responseBlocks) {
          await updateSlackMessage(responseUrl, result.responseBlocks);
        } else if (result.responseBlocks && payload.channel?.id) {
          await postToSlack(payload.channel.id, result.responseBlocks, undefined, true, userId);
        }
      } catch (err: any) {
        console.error("[Kevin Slack] Action handler error:", err?.message);
      }
    },
  );

  // ── GET /api/admin/kevin-slack/config ────────────────────────────────────────
  app.get(
    "/api/admin/kevin-slack/config",
    isAuthenticated,
    requireRole("ADMIN"),
    (_req: any, res: Response) => {
      const cfg = getKevinSlackConfig();
      // Never expose secrets
      res.json({
        enabled: cfg.enabled,
        eventsEnabled: cfg.eventsEnabled,
        commandsEnabled: cfg.commandsEnabled,
        actionsEnabled: cfg.actionsEnabled,
        notificationsEnabled: cfg.notificationsEnabled,
        digestsEnabled: cfg.digestsEnabled,
        schedulingEnabled: cfg.schedulingEnabled,
        approvalsEnabled: cfg.approvalsEnabled,
        obsidianMemoryEnabled: cfg.obsidianMemoryEnabled,
        appIdConfigured: !!cfg.appId,
        botTokenConfigured: !!getSlackBotToken(),
        signingSecretConfigured: !!(process.env.SLACK_SIGNING_SECRET),
        clientIdConfigured: !!(process.env.SLACK_CLIENT_ID),
        // Staged activation guide
        stages: {
          stage1_verification: cfg.enabled && cfg.eventsEnabled,
          stage2_read_commands: cfg.enabled && cfg.commandsEnabled,
          stage3_scheduling: isSchedulingEnabled(),
          stage4_notifications: cfg.enabled && cfg.notificationsEnabled,
          stage5_digests: cfg.enabled && cfg.digestsEnabled,
          stage6_approvals: isApprovalsEnabled(),
          stage7_obsidian: cfg.enabled && cfg.obsidianMemoryEnabled,
        },
      });
    },
  );

  // ── GET /api/admin/kevin-slack/diagnostics ───────────────────────────────────
  app.get(
    "/api/admin/kevin-slack/diagnostics",
    isAuthenticated,
    requireRole("ADMIN"),
    async (_req: any, res: Response) => {
      try {
        const [auditStats, digestStats] = await Promise.all([
          getAuditStats(),
          getDigestStats(),
        ]);

        const cfg = getKevinSlackConfig();

        res.json({
          integration: {
            enabled: cfg.enabled,
            botTokenConfigured: !!getSlackBotToken(),
            signingSecretConfigured: !!(process.env.SLACK_SIGNING_SECRET),
            eventsEnabled: cfg.eventsEnabled,
            commandsEnabled: cfg.commandsEnabled,
            actionsEnabled: cfg.actionsEnabled,
            notificationsEnabled: cfg.notificationsEnabled,
            digestsEnabled: cfg.digestsEnabled,
            schedulingEnabled: isSchedulingEnabled(),
          },
          interactions: auditStats,
          digests: digestStats,
          circuitState: "closed",
          lastChecked: new Date().toISOString(),
        });
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Diagnostics error" });
      }
    },
  );

  // ── GET /api/admin/kevin-slack/mappings ──────────────────────────────────────
  app.get(
    "/api/admin/kevin-slack/mappings",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res: Response) => {
      const orgId = req.query.orgId as string | undefined;
      try {
        const mappings = orgId
          ? await listMappingsForOrg(orgId)
          : await listAllMappings();
        res.json({ mappings });
      } catch (err: any) {
        res.status(500).json({ error: err?.message });
      }
    },
  );

  // ── POST /api/admin/kevin-slack/mappings ─────────────────────────────────────
  app.post(
    "/api/admin/kevin-slack/mappings",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res: Response) => {
      const { slackTeamId, slackUserId, trainefficiencyUserId, orgId, status } = req.body ?? {};
      if (!slackTeamId || !slackUserId || !trainefficiencyUserId || !orgId) {
        return res.status(400).json({ error: "slackTeamId, slackUserId, trainefficiencyUserId, orgId are required" });
      }

      const adminUserId = req.user?.claims?.sub ?? req.user?.id ?? "admin";
      try {
        const mapping = await createOrUpdateMapping({
          slackTeamId,
          slackUserId,
          trainefficiencyUserId,
          orgId,
          linkedBy: adminUserId,
          status: status ?? "verified",
        });
        if (!mapping) return res.status(500).json({ error: "Failed to create mapping" });
        res.json({ mapping });
      } catch (err: any) {
        res.status(500).json({ error: err?.message });
      }
    },
  );

  // ── POST /api/admin/kevin-slack/mappings/:id/verify ──────────────────────────
  app.post(
    "/api/admin/kevin-slack/mappings/:id/verify",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res: Response) => {
      const { id } = req.params;
      const adminUserId = req.user?.claims?.sub ?? req.user?.id ?? "admin";
      const ok = await verifyMapping(id, adminUserId);
      res.json({ ok });
    },
  );

  // ── POST /api/admin/kevin-slack/mappings/:id/revoke ──────────────────────────
  app.post(
    "/api/admin/kevin-slack/mappings/:id/revoke",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res: Response) => {
      const { id } = req.params;
      const adminUserId = req.user?.claims?.sub ?? req.user?.id ?? "admin";
      const ok = await revokeMapping(id, adminUserId);
      res.json({ ok });
    },
  );

  // ── GET /api/admin/kevin-slack/audit ─────────────────────────────────────────
  app.get(
    "/api/admin/kevin-slack/audit",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res: Response) => {
      const orgId = req.query.orgId as string | undefined;
      const limit = parseInt(req.query.limit as string ?? "50", 10);
      if (!orgId) return res.status(400).json({ error: "orgId required" });
      try {
        const events = await getRecentAuditEvents(orgId, limit);
        res.json({ events });
      } catch (err: any) {
        res.status(500).json({ error: err?.message });
      }
    },
  );

  // ── POST /api/admin/kevin-slack/digest/send ──────────────────────────────────
  app.post(
    "/api/admin/kevin-slack/digest/send",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res: Response) => {
      const { orgId, channel } = req.body ?? {};
      if (!orgId || !channel) return res.status(400).json({ error: "orgId and channel required" });
      const result = await sendDailyDigest(orgId, channel);
      res.json(result);
    },
  );

  // ── POST /api/internal/kevin-slack/notify ────────────────────────────────────
  // Internal endpoint for other services to send Kevin Slack notifications
  app.post(
    "/api/internal/kevin-slack/notify",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res: Response) => {
      if (!isNotificationsEnabled()) {
        return res.status(200).json({ ok: false, reason: "notifications_disabled" });
      }

      const {
        orgId,
        teamId,
        channel,
        eventType,
        what,
        why,
        recommendation,
        confidence = "Medium",
        urgency = 5,
        businessImpact = 5,
        revenueImpact = 0,
        customerImpact = 0,
        operationalImpact = 5,
        securityImpact = 0,
        timeSensitivity = 5,
        dedupKey,
      } = req.body ?? {};

      if (!teamId || !channel || !eventType) {
        return res.status(400).json({ error: "teamId, channel, eventType required" });
      }

      // Classify
      const classification = classifyNotification({
        eventType,
        urgency,
        businessImpact,
        revenueImpact,
        customerImpact,
        operationalImpact,
        securityImpact,
        confidence: 0.8,
        timeSensitivity,
        hasOpenAlert: dedupKey ? await hasRecentNotification(dedupKey) : false,
      });

      if (!shouldSendImmediately(classification.priority)) {
        return res.json({ ok: true, priority: classification.priority, sent: false });
      }

      const botToken = getSlackBotToken();
      if (!botToken) return res.status(500).json({ error: "Bot token not configured" });

      const blocks =
        classification.priority === "CRITICAL" || classification.priority === "EXECUTIVE_BRIEF"
          ? buildCriticalAlert({ what, why, recommendation, confidence, actionToken: dedupKey })
          : buildImportantAlert({ summary: what, impact: why, recommendation, actionToken: dedupKey ?? "na" });

      try {
        const response = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${botToken}`,
          },
          body: JSON.stringify({ channel, blocks }),
        });
        const result = await response.json() as any;

        await recordNotificationSent(teamId, channel, classification.priority, eventType, orgId ?? null, dedupKey);

        return res.json({ ok: result.ok, priority: classification.priority, sent: true, slackTs: result.ts });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );
}
