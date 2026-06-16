/**
 * Composio Slack Alert Routes — Phase 2C
 * ─────────────────────────────────────────────────────────────────────────────
 * INTERNAL ALERTS ONLY. No DMs, no external messaging, no autonomous posting.
 *
 * Endpoints:
 *   POST /api/composio/slack-alert/request        — COACH/ADMIN request an alert
 *   GET  /api/composio/slack-alert/pending        — ADMIN list pending alerts
 *   GET  /api/composio/slack-alert/all            — ADMIN full history
 *   POST /api/composio/slack-alert/:id/approve    — ADMIN approve → Composio posts
 *   POST /api/composio/slack-alert/:id/cancel     — ADMIN cancel
 *
 * Approval flow:
 *   request → adapter → queued_for_approval → ADMIN approve
 *          → executeComposioAction → Slack message confirmed
 *          → status = alert_posted
 *
 * On Composio failure, status stays alert_queued (retryable via approve again).
 * Slack DMs are not implemented. Only channel posts through the approval gate.
 *
 * Composio action used: SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL
 */

import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { agentOperatingTimeline, communicationLogs } from "@shared/schema";
import { requestComposioAction } from "./composio-action-adapter";
import { executeComposioAction } from "./services/composio-service";
import { emitComposioHermesEvent } from "./composio-hermes-emitter";
import { z } from "zod";

// ─── Phase 2C permitted agents ────────────────────────────────────────────────

export const SLACK_ALERT_PERMITTED_AGENTS = [
  "ceo_heartbeat",
  "executive_agent",
  "software_improvement_agent",
  "revenue_agent",
] as const;

export type SlackAlertPermittedAgent = typeof SLACK_ALERT_PERMITTED_AGENTS[number];

// ─── Per-agent allowed alert types ───────────────────────────────────────────
// Enforced at the endpoint level to prevent misuse across agent domains.

export const AGENT_ALERT_TYPES: Record<SlackAlertPermittedAgent, string[]> = {
  ceo_heartbeat: [
    "daily_executive_summary",
    "critical_business_risk",
    "revenue_anomaly_alert",
  ],
  executive_agent: [
    "daily_executive_summary",
    "critical_business_risk",
    "revenue_anomaly_alert",
    "system_status",
  ],
  software_improvement_agent: [
    "critical_bug_detected",
    "system_failure_detected",
    "high_severity_task_created",
  ],
  revenue_agent: [
    "high_value_lead_alert",
    "large_deal_stage_change",
    "revenue_recovery_opportunity",
  ],
};

// All valid alert types (union of all per-agent lists)
export const ALL_ALERT_TYPES = [
  ...new Set(Object.values(AGENT_ALERT_TYPES).flat()),
] as const;

// ─── Table setup ──────────────────────────────────────────────────────────────

export async function ensureSlackAlertTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS composio_slack_alert_requests (
      id                VARCHAR(128)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id            VARCHAR(256)  NOT NULL,
      agent_id          VARCHAR(128)  NOT NULL,
      channel           VARCHAR(256)  NOT NULL,
      alert_type        VARCHAR(128)  NOT NULL,
      severity          VARCHAR(32)   NOT NULL DEFAULT 'high',
      message           TEXT          NOT NULL,
      purpose           TEXT          NOT NULL,
      risk_level        VARCHAR(32)   NOT NULL DEFAULT 'high',
      approval_queue_id VARCHAR(128),
      slack_message_id  TEXT,
      slack_channel_id  TEXT,
      status            VARCHAR(64)   NOT NULL DEFAULT 'alert_queued',
      error_message     TEXT,
      metadata          JSONB,
      created_at        TIMESTAMP     DEFAULT NOW(),
      updated_at        TIMESTAMP     DEFAULT NOW()
    )
  `);
}

// ─── Request validation ───────────────────────────────────────────────────────

const requestAlertSchema = z.object({
  agentId: z.enum(SLACK_ALERT_PERMITTED_AGENTS, {
    errorMap: () => ({
      message: `agentId must be one of: ${SLACK_ALERT_PERMITTED_AGENTS.join(", ")}`,
    }),
  }),
  channel: z
    .string()
    .min(1, "channel is required")
    .regex(/^[#a-zA-Z0-9_-]+$/, "channel must be a valid Slack channel name (e.g. #ops-alerts)"),
  alertType: z.string().min(1, "alertType is required"),
  severity: z.enum(["critical", "high", "medium"]).default("high"),
  message: z.string().min(1, "message is required").max(3000),
  purpose: z.string().min(1, "purpose is required").max(1000),
  riskLevel: z.enum(["low", "medium", "high"]).default("high"),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrgId(req: any): string | null {
  return req.user?.orgId ?? null;
}

function extractSlackMessageId(data: unknown): { messageId: string | null; channelId: string | null } {
  if (!data || typeof data !== "object") return { messageId: null, channelId: null };
  const d = data as any;
  return {
    messageId:
      d?.ts ??
      d?.message_id ??
      d?.id ??
      d?.message?.ts ??
      d?.data?.ts ??
      null,
    channelId:
      d?.channel ??
      d?.channel_id ??
      d?.data?.channel ??
      null,
  };
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerComposioSlackAlertRoutes(
  app: Express,
  isAuthenticated: any,
  requireRole: any,
): Promise<void> {
  await ensureSlackAlertTable();
  console.log("[ComposioSlackAlert] Table ready");

  // ── POST /api/composio/slack-alert/request ────────────────────────────────
  // Validates the request, routes through the Composio adapter, and only
  // creates the alert record when the adapter confirms queued_for_approval.
  // On any other outcome the request is rejected with no DB side-effects.
  app.post(
    "/api/composio/slack-alert/request",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = getOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const parsed = requestAlertSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.flatten().fieldErrors,
          });
        }

        const { agentId, channel, alertType, severity, message, purpose, riskLevel } = parsed.data;

        // Validate alertType against per-agent allowlist
        const allowedTypes = AGENT_ALERT_TYPES[agentId as SlackAlertPermittedAgent];
        if (!allowedTypes.includes(alertType)) {
          return res.status(400).json({
            message: `Alert type "${alertType}" is not permitted for agent "${agentId}". Allowed types: ${allowedTypes.join(", ")}`,
          });
        }

        // Route through the Composio action adapter.
        // SLACK requiresApproval: true → adapter always returns queued_for_approval.
        // No autonomous posting path exists.
        const adapterResult = await requestComposioAction({
          orgId,
          agentId,
          tool: "SLACK",
          action: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
          inputParams: { channel, text: message },
          confidence: 0.85,
          riskLevel,
          notes: `[${severity.toUpperCase()}] ${alertType} — ${purpose} (${agentId})`,
        });

        // Gate: only persist when adapter confirmed an approval queue entry.
        if (adapterResult.outcome !== "queued_for_approval") {
          const httpStatus =
            adapterResult.outcome === "blocked_no_permission"       ? 403 :
            adapterResult.outcome === "blocked_by_policy"           ? 403 :
            adapterResult.outcome === "blocked_action_not_allowed"  ? 403 : 400;

          console.warn(
            `[ComposioSlackAlert] request adapter blocked: outcome=${adapterResult.outcome} agent=${agentId}`,
          );
          return res.status(httpStatus).json({
            success: false,
            message: adapterResult.message ?? `Adapter rejected the request (${adapterResult.outcome}).`,
            outcome: adapterResult.outcome,
            deniedReason: adapterResult.deniedReason ?? null,
          });
        }

        // Reached only when outcome === "queued_for_approval".
        const requestId = crypto.randomUUID();
        await db.execute(sql`
          INSERT INTO composio_slack_alert_requests (
            id, org_id, agent_id, channel, alert_type, severity, message,
            purpose, risk_level, approval_queue_id, status, metadata,
            created_at, updated_at
          ) VALUES (
            ${requestId},
            ${orgId},
            ${agentId},
            ${channel},
            ${alertType},
            ${severity},
            ${message},
            ${purpose},
            ${riskLevel},
            ${adapterResult.approvalQueueId ?? null},
            ${'alert_queued'},
            ${JSON.stringify({
              requestedBy: req.user?.id ?? null,
              approvalQueueId: adapterResult.approvalQueueId,
            })}::jsonb,
            NOW(),
            NOW()
          )
        `);

        // Log to agent_operating_timeline
        await db.insert(agentOperatingTimeline).values({
          orgId,
          agentName: agentId,
          systemName: "composio_slack",
          actionType: "approval_required",
          actionStatus: "requires_approval",
          communicationDomain: "slack",
          summary: `Slack alert queued for approval: [${severity.toUpperCase()}] ${alertType} → ${channel}`,
          requiresApproval: true,
          approvalStatus: "pending",
          relatedEntityType: "composio_slack_alert_request",
          relatedEntityId: requestId,
          metadata: {
            requestId,
            agentId,
            channel,
            alertType,
            severity,
            purpose,
            approvalQueueId: adapterResult.approvalQueueId,
            messagePreview: message.slice(0, 200),
          },
        }).catch(() => {});

        // Log to communication_logs
        await db.insert(communicationLogs).values({
          orgId,
          type: `composio_slack_alert_queued`,
          channel: "slack",
          subject: `[${severity.toUpperCase()}] ${alertType}`,
          messageBody: message,
          status: "pending",
          provider: "composio",
          agentActionId: requestId,
        }).catch(() => {});

        // Emit Hermes event
        await emitComposioHermesEvent({
          source: "composio",
          orgId,
          agent: agentId,
          tool: "SLACK",
          action: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
          result: "queued_for_approval",
          outcome: "pending_approval",
          metadata: {
            requestId,
            channel,
            alertType,
            severity,
            purpose,
            approvalQueueId: adapterResult.approvalQueueId,
            messagePreview: message.slice(0, 200),
          },
        });

        return res.status(202).json({
          success: true,
          message: "Slack alert queued for human approval.",
          requestId,
          approvalQueueId: adapterResult.approvalQueueId,
          status: "alert_queued",
          preview: { agentId, channel, alertType, severity, purpose },
        });
      } catch (e: any) {
        console.error("[ComposioSlackAlert] request failed:", e.message);
        res.status(500).json({ message: "Failed to request Slack alert", error: e.message });
      }
    },
  );

  // ── GET /api/composio/slack-alert/pending ─────────────────────────────────
  app.get(
    "/api/composio/slack-alert/pending",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = getOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const rows = await db.execute(sql`
          SELECT * FROM composio_slack_alert_requests
          WHERE org_id = ${orgId} AND status = 'alert_queued'
          ORDER BY created_at DESC
        `);

        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        res.json({ success: true, alerts: items, count: items.length });
      } catch (e: any) {
        console.error("[ComposioSlackAlert] pending list failed:", e.message);
        res.status(500).json({ message: "Failed to fetch pending alerts", error: e.message });
      }
    },
  );

  // ── GET /api/composio/slack-alert/all ────────────────────────────────────
  app.get(
    "/api/composio/slack-alert/all",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = getOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
        const offset = parseInt(String(req.query.offset ?? "0"), 10);
        const statusFilter = req.query.status as string | undefined;

        const rows = statusFilter
          ? await db.execute(sql`
              SELECT * FROM composio_slack_alert_requests
              WHERE org_id = ${orgId} AND status = ${statusFilter}
              ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
            `)
          : await db.execute(sql`
              SELECT * FROM composio_slack_alert_requests
              WHERE org_id = ${orgId}
              ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
            `);

        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        res.json({ success: true, alerts: items, count: items.length, limit, offset });
      } catch (e: any) {
        console.error("[ComposioSlackAlert] all list failed:", e.message);
        res.status(500).json({ message: "Failed to fetch alerts", error: e.message });
      }
    },
  );

  // ── POST /api/composio/slack-alert/:id/approve ───────────────────────────
  // ADMIN has reviewed the alert and approves Composio to post it.
  // On Composio failure, status stays alert_queued (retryable). No false success.
  app.post(
    "/api/composio/slack-alert/:id/approve",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = getOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const rows = await db.execute(sql`
          SELECT * FROM composio_slack_alert_requests
          WHERE id = ${req.params.id} AND org_id = ${orgId}
          LIMIT 1
        `);
        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        const request: any = items[0];

        if (!request) return res.status(404).json({ message: "Alert request not found" });

        if (request.status !== "alert_queued") {
          return res.status(400).json({
            message: `Expected status "alert_queued", got "${request.status}". Cannot approve.`,
            status: request.status,
          });
        }

        // Execute via Composio service directly — ADMIN is the explicit human gate.
        const execResult = await executeComposioAction({
          orgId,
          agentId: request.agent_id,
          tool: "SLACK",
          action: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
          inputParams: {
            channel: request.channel,
            text: request.message,
          },
        });

        // Extract Slack identifiers — only available on success
        let slackMessageId: string | null = null;
        let slackChannelId: string | null = null;
        if (execResult.success && execResult.data) {
          const extracted = extractSlackMessageId(execResult.data);
          slackMessageId = extracted.messageId;
          slackChannelId = extracted.channelId;
        }

        // Gate: only mark alert_posted when execution confirmed success
        if (!execResult.success) {
          // Store error but keep status alert_queued — retryable
          await db.execute(sql`
            UPDATE composio_slack_alert_requests
            SET error_message = ${execResult.error ?? "Composio execution failed"}, updated_at = NOW()
            WHERE id = ${request.id}
          `).catch(() => {});

          await db.insert(agentOperatingTimeline).values({
            orgId,
            agentName: request.agent_id,
            systemName: "composio_slack",
            actionType: "error",
            actionStatus: "failed",
            communicationDomain: "slack",
            summary: `Slack alert post failed (retryable): ${execResult.error}`,
            requiresApproval: false,
            approvalStatus: "approved",
            relatedEntityType: "composio_slack_alert_request",
            relatedEntityId: request.id,
            executedAt: new Date(),
            outcomeStatus: "failure",
            errorMessage: execResult.error,
            metadata: { durationMs: execResult.durationMs },
          }).catch(() => {});

          await emitComposioHermesEvent({
            source: "composio",
            orgId,
            agent: request.agent_id,
            tool: "SLACK",
            action: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
            result: "failure",
            outcome: "failed_execution",
            metadata: {
              requestId: request.id,
              channel: request.channel,
              alertType: request.alert_type,
              severity: request.severity,
              durationMs: execResult.durationMs,
              error: execResult.error,
            },
          });

          // Status stays alert_queued — retryable
          return res.status(502).json({
            success: false,
            message: `Composio execution failed: ${execResult.error}`,
            status: "alert_queued",
            composioResult: { error: execResult.error, durationMs: execResult.durationMs },
          });
        }

        // Success path — mark as posted
        await db.execute(sql`
          UPDATE composio_slack_alert_requests
          SET
            status           = ${'alert_posted'},
            slack_message_id = ${slackMessageId},
            slack_channel_id = ${slackChannelId},
            error_message    = NULL,
            updated_at       = NOW()
          WHERE id = ${request.id}
        `);

        // Update communication_logs
        await db.execute(sql`
          UPDATE communication_logs
          SET status = 'sent'
          WHERE agent_action_id = ${request.id} AND org_id = ${orgId}
        `).catch(() => {});

        await db.insert(agentOperatingTimeline).values({
          orgId,
          agentName: request.agent_id,
          systemName: "composio_slack",
          actionType: "workflow_executed",
          actionStatus: "completed",
          communicationDomain: "slack",
          summary: `Slack alert posted: [${request.severity.toUpperCase()}] ${request.alert_type} → ${request.channel}${slackMessageId ? ` (ts: ${slackMessageId})` : ""}`,
          requiresApproval: false,
          approvalStatus: "approved",
          relatedEntityType: "composio_slack_alert_request",
          relatedEntityId: request.id,
          executedAt: new Date(),
          outcomeStatus: "success",
          metadata: { slackMessageId, slackChannelId, durationMs: execResult.durationMs },
        }).catch(() => {});

        await emitComposioHermesEvent({
          source: "composio",
          orgId,
          agent: request.agent_id,
          tool: "SLACK",
          action: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
          result: "success",
          outcome: "slack_alert_posted",
          metadata: {
            requestId: request.id,
            channel: request.channel,
            alertType: request.alert_type,
            severity: request.severity,
            slackMessageId,
            slackChannelId,
            durationMs: execResult.durationMs,
          },
        });

        return res.json({
          success: true,
          message: `Slack alert posted successfully to ${request.channel}${slackMessageId ? ` (message ts: ${slackMessageId})` : "."}`,
          slackMessageId,
          slackChannelId,
          status: "alert_posted",
          composioResult: { durationMs: execResult.durationMs },
        });
      } catch (e: any) {
        console.error("[ComposioSlackAlert] approve failed:", e.message);
        res.status(500).json({ message: "Failed to execute Slack alert post", error: e.message });
      }
    },
  );

  // ── POST /api/composio/slack-alert/:id/cancel ─────────────────────────────
  app.post(
    "/api/composio/slack-alert/:id/cancel",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = getOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const rows = await db.execute(sql`
          SELECT id, status FROM composio_slack_alert_requests
          WHERE id = ${req.params.id} AND org_id = ${orgId}
          LIMIT 1
        `);
        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        const request: any = items[0];

        if (!request) return res.status(404).json({ message: "Alert request not found" });
        if (request.status === "alert_posted") {
          return res.status(400).json({ message: "Cannot cancel an alert that has already been posted." });
        }
        if (request.status === "cancelled") {
          return res.status(409).json({ message: "Alert request is already cancelled." });
        }

        await db.execute(sql`
          UPDATE composio_slack_alert_requests
          SET status = ${'cancelled'}, updated_at = NOW()
          WHERE id = ${request.id}
        `);

        await db.insert(agentOperatingTimeline).values({
          orgId,
          agentName: "admin",
          systemName: "composio_slack",
          actionType: "cancelled",
          actionStatus: "completed",
          communicationDomain: "slack",
          summary: `Slack alert request cancelled by admin (ID: ${request.id})`,
          requiresApproval: false,
          approvalStatus: "rejected",
          relatedEntityType: "composio_slack_alert_request",
          relatedEntityId: request.id,
          metadata: { cancelledBy: req.user?.id ?? null },
        }).catch(() => {});

        await emitComposioHermesEvent({
          source: "composio",
          orgId,
          agent: "admin",
          tool: "SLACK",
          action: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
          result: "blocked",
          outcome: "cancelled",
          metadata: { requestId: request.id },
        });

        res.json({ success: true, message: "Alert request cancelled.", status: "cancelled" });
      } catch (e: any) {
        console.error("[ComposioSlackAlert] cancel failed:", e.message);
        res.status(500).json({ message: "Failed to cancel alert request", error: e.message });
      }
    },
  );

  console.log("[ComposioSlackAlert] Routes registered");
}
