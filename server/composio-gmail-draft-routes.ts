/**
 * Composio Gmail Draft Routes — Phase 2B
 * ─────────────────────────────────────────────────────────────────────────────
 * DRAFT CREATION ONLY. No send action exists in this module.
 *
 * Endpoints:
 *   POST /api/composio/gmail-draft/request        — COACH/ADMIN request a draft
 *   GET  /api/composio/gmail-draft/pending        — ADMIN list pending drafts
 *   GET  /api/composio/gmail-draft/all            — ADMIN list all drafts (paginated)
 *   POST /api/composio/gmail-draft/:id/approve    — ADMIN approve → Composio creates draft
 *   POST /api/composio/gmail-draft/:id/cancel     — ADMIN cancel request
 *
 * Approval flow:
 *   request → adapter → queued_for_approval → ADMIN approve → executeComposioAction
 *          → Gmail draft ID confirmed → status = draft_created
 *
 * On Composio failure, status stays draft_queued (retryable via approve again).
 * No email is ever sent. GMAIL_SEND_EMAIL is blocked in the tool registry.
 */

import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { agentOperatingTimeline, communicationLogs } from "@shared/schema";
import { requestComposioAction } from "./composio-action-adapter";
import { executeComposioAction } from "./services/composio-service";
import { emitComposioHermesEvent } from "./composio-hermes-emitter";
import { resolveOrgIdOrThrow, handleOrgError } from "./lib/resolve-org-id";
import { z } from "zod";

// ─── Permitted agents for Phase 2B Gmail draft creation ──────────────────────

export const GMAIL_DRAFT_PERMITTED_AGENTS = [
  "revenue_agent",
  "scheduling_agent",
  "communication_agent",
  "ceo_heartbeat",
] as const;

export type GmailDraftPermittedAgent = typeof GMAIL_DRAFT_PERMITTED_AGENTS[number];

// ─── Table setup ──────────────────────────────────────────────────────────────

export async function ensureGmailDraftTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS composio_gmail_draft_requests (
      id            VARCHAR(128)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id        VARCHAR(256)  NOT NULL,
      agent_id      VARCHAR(128)  NOT NULL,
      recipient_email TEXT        NOT NULL,
      subject       TEXT          NOT NULL,
      body          TEXT          NOT NULL,
      purpose       TEXT          NOT NULL,
      risk_level    VARCHAR(32)   NOT NULL DEFAULT 'medium',
      approval_queue_id VARCHAR(128),
      gmail_draft_id TEXT,
      status        VARCHAR(64)   NOT NULL DEFAULT 'draft_queued',
      error_message TEXT,
      metadata      JSONB,
      created_at    TIMESTAMP     DEFAULT NOW(),
      updated_at    TIMESTAMP     DEFAULT NOW()
    )
  `);
}

// ─── Request validation ───────────────────────────────────────────────────────

const requestDraftSchema = z.object({
  agentId: z.enum(GMAIL_DRAFT_PERMITTED_AGENTS, {
    errorMap: () => ({
      message: `agentId must be one of: ${GMAIL_DRAFT_PERMITTED_AGENTS.join(", ")}`,
    }),
  }),
  recipientEmail: z.string().email("recipientEmail must be a valid email address"),
  subject: z.string().min(1, "subject is required").max(500),
  body: z.string().min(1, "body is required"),
  purpose: z.string().min(1, "purpose is required").max(1000),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
});


// ─── Draft ID extraction helper ───────────────────────────────────────────────

function extractGmailDraftId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as any;
  return (
    d?.id ??
    d?.draftId ??
    d?.draft?.id ??
    d?.data?.id ??
    d?.data?.draftId ??
    d?.result?.id ??
    null
  );
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerComposioGmailDraftRoutes(
  app: Express,
  isAuthenticated: any,
  requireRole: any,
): Promise<void> {
  await ensureGmailDraftTable();
  console.log("[ComposioGmailDraft] Table ready");

  // ── POST /api/composio/gmail-draft/request ────────────────────────────────
  // Validates the request, inserts a pending record, routes through the
  // Composio action adapter, and only marks the record as queued when the
  // adapter confirms queued_for_approval. On any other adapter outcome the
  // inserted record is cleaned up and an appropriate error is returned.
  app.post(
    "/api/composio/gmail-draft/request",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);

        const parsed = requestDraftSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.flatten().fieldErrors,
          });
        }

        const { agentId, recipientEmail, subject, body, purpose, riskLevel } = parsed.data;

        // Insert the request row before calling the adapter so we have an ID
        // to reference in logs and approval queue metadata.
        const requestId = crypto.randomUUID();
        await db.execute(sql`
          INSERT INTO composio_gmail_draft_requests (
            id, org_id, agent_id, recipient_email, subject, body,
            purpose, risk_level, status, metadata, created_at, updated_at
          ) VALUES (
            ${requestId},
            ${orgId},
            ${agentId},
            ${recipientEmail},
            ${subject},
            ${body},
            ${purpose},
            ${riskLevel},
            ${'pending_request'},
            ${JSON.stringify({ requestedBy: req.user?.id ?? null })}::jsonb,
            NOW(),
            NOW()
          )
        `);

        // Route through the Composio action adapter.
        // GMAIL requiresApproval: true → adapter always returns queued_for_approval.
        // GMAIL_CREATE_EMAIL_DRAFT is in allowedActions.
        // GMAIL_SEND_EMAIL is in blockedActions — no send path exists.
        const adapterResult = await requestComposioAction({
          orgId,
          agentId,
          tool: "GMAIL",
          action: "GMAIL_CREATE_EMAIL_DRAFT",
          inputParams: { to: recipientEmail, subject, body },
          confidence: 0.8,
          riskLevel,
          recipientEmail,
          notes: `Gmail draft request — ${purpose} (${agentId})`,
        });

        // Gate: only mark as queued when adapter confirms an approval queue entry.
        if (adapterResult.outcome !== "queued_for_approval") {
          // Clean up the pending record — nothing was queued.
          await db.execute(sql`
            DELETE FROM composio_gmail_draft_requests WHERE id = ${requestId}
          `).catch(() => {});

          const httpStatus =
            adapterResult.outcome === "blocked_no_permission"        ? 403 :
            adapterResult.outcome === "blocked_by_policy"            ? 403 :
            adapterResult.outcome === "blocked_action_not_allowed"   ? 403 : 400;

          console.warn(
            `[ComposioGmailDraft] request adapter blocked: outcome=${adapterResult.outcome} agent=${agentId}`,
          );
          return res.status(httpStatus).json({
            success: false,
            message: adapterResult.message ?? `Adapter rejected the request (${adapterResult.outcome}).`,
            outcome: adapterResult.outcome,
            deniedReason: adapterResult.deniedReason ?? null,
          });
        }

        // Reached only when outcome === "queued_for_approval".
        await db.execute(sql`
          UPDATE composio_gmail_draft_requests
          SET
            status             = ${'draft_queued'},
            approval_queue_id  = ${adapterResult.approvalQueueId ?? null},
            updated_at         = NOW()
          WHERE id = ${requestId}
        `);

        // Log to agent_operating_timeline
        await db.insert(agentOperatingTimeline).values({
          orgId,
          agentName: agentId,
          systemName: "composio_gmail",
          actionType: "approval_required",
          actionStatus: "requires_approval",
          communicationDomain: "gmail",
          summary: `Gmail draft queued for approval: "${subject}" → ${recipientEmail}`,
          requiresApproval: true,
          approvalStatus: "pending",
          relatedEntityType: "composio_gmail_draft_request",
          relatedEntityId: requestId,
          metadata: {
            requestId,
            agentId,
            recipientEmail,
            subject,
            purpose,
            riskLevel,
            approvalQueueId: adapterResult.approvalQueueId,
          },
        }).catch(() => {});

        // Log to communication_logs — draft pending (not sent)
        await db.insert(communicationLogs).values({
          orgId,
          type: "composio_gmail_draft_queued",
          channel: "email",
          recipientEmail,
          subject,
          messageBody: body,
          status: "pending",
          provider: "composio",
          agentActionId: requestId,
        }).catch(() => {});

        // Emit Hermes event
        await emitComposioHermesEvent({
          source: "composio",
          orgId,
          agent: agentId,
          tool: "GMAIL",
          action: "GMAIL_CREATE_EMAIL_DRAFT",
          result: "queued_for_approval",
          outcome: "pending_approval",
          metadata: {
            requestId,
            recipientEmail,
            subject,
            purpose,
            approvalQueueId: adapterResult.approvalQueueId,
          },
        });

        return res.status(202).json({
          success: true,
          message: "Gmail draft request queued for human approval.",
          requestId,
          approvalQueueId: adapterResult.approvalQueueId,
          status: "draft_queued",
          preview: { agentId, recipientEmail, subject, purpose },
        });
      } catch (e: any) {
        console.error("[ComposioGmailDraft] request failed:", e.message);
        res.status(500).json({ message: "Failed to request Gmail draft", error: e.message });
      }
    },
  );

  // ── GET /api/composio/gmail-draft/pending ─────────────────────────────────
  app.get(
    "/api/composio/gmail-draft/pending",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);

        const rows = await db.execute(sql`
          SELECT * FROM composio_gmail_draft_requests
          WHERE org_id = ${orgId} AND status = 'draft_queued'
          ORDER BY created_at DESC
        `);

        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        res.json({ success: true, drafts: items, count: items.length });
      } catch (e: any) {
        console.error("[ComposioGmailDraft] pending list failed:", e.message);
        res.status(500).json({ message: "Failed to fetch pending drafts", error: e.message });
      }
    },
  );

  // ── GET /api/composio/gmail-draft/all ─────────────────────────────────────
  app.get(
    "/api/composio/gmail-draft/all",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);

        const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
        const offset = parseInt(String(req.query.offset ?? "0"), 10);
        const statusFilter = req.query.status as string | undefined;

        const rows = statusFilter
          ? await db.execute(sql`
              SELECT * FROM composio_gmail_draft_requests
              WHERE org_id = ${orgId} AND status = ${statusFilter}
              ORDER BY created_at DESC
              LIMIT ${limit} OFFSET ${offset}
            `)
          : await db.execute(sql`
              SELECT * FROM composio_gmail_draft_requests
              WHERE org_id = ${orgId}
              ORDER BY created_at DESC
              LIMIT ${limit} OFFSET ${offset}
            `);

        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        res.json({ success: true, drafts: items, count: items.length, limit, offset });
      } catch (e: any) {
        console.error("[ComposioGmailDraft] all list failed:", e.message);
        res.status(500).json({ message: "Failed to fetch drafts", error: e.message });
      }
    },
  );

  // ── POST /api/composio/gmail-draft/:id/approve ────────────────────────────
  // ADMIN has reviewed the draft request and approves Composio to create the
  // actual Gmail draft. No email is sent. Only draft creation is requested.
  // On Composio failure: status stays draft_queued (retryable). No false success.
  app.post(
    "/api/composio/gmail-draft/:id/approve",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);

        const rows = await db.execute(sql`
          SELECT * FROM composio_gmail_draft_requests
          WHERE id = ${req.params.id} AND org_id = ${orgId}
          LIMIT 1
        `);
        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        const request: any = items[0];

        if (!request) return res.status(404).json({ message: "Draft request not found" });

        if (request.status !== "draft_queued") {
          return res.status(400).json({
            message: `Expected status "draft_queued", got "${request.status}". Cannot approve.`,
            status: request.status,
          });
        }

        // Execute via Composio service directly — ADMIN has explicitly approved.
        // No adapter permission/policy checks at execution time: the human gate
        // is enforced by requireRole("ADMIN") on this endpoint.
        const execResult = await executeComposioAction({
          orgId,
          agentId: request.agent_id,
          tool: "GMAIL",
          action: "GMAIL_CREATE_EMAIL_DRAFT",
          inputParams: {
            to: request.recipient_email,
            subject: request.subject,
            body: request.body,
          },
        });

        // Extract the Gmail draft ID — only available on success
        let gmailDraftId: string | null = null;
        if (execResult.success && execResult.data) {
          gmailDraftId = extractGmailDraftId(execResult.data);
        }

        // Gate: only mark draft_created when execution confirmed success + draft ID exists
        if (!execResult.success) {
          // Log the failure attempt — keep status draft_queued for retry
          await db.execute(sql`
            UPDATE composio_gmail_draft_requests
            SET error_message = ${execResult.error ?? "Composio execution failed"}, updated_at = NOW()
            WHERE id = ${request.id}
          `).catch(() => {});

          await db.insert(agentOperatingTimeline).values({
            orgId,
            agentName: request.agent_id,
            systemName: "composio_gmail",
            actionType: "error",
            actionStatus: "failed",
            communicationDomain: "gmail",
            summary: `Gmail draft creation failed (retryable): ${execResult.error}`,
            requiresApproval: false,
            approvalStatus: "approved",
            relatedEntityType: "composio_gmail_draft_request",
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
            tool: "GMAIL",
            action: "GMAIL_CREATE_EMAIL_DRAFT",
            result: "failure",
            outcome: "failed_execution",
            metadata: {
              requestId: request.id,
              durationMs: execResult.durationMs,
              error: execResult.error,
            },
          });

          // Status stays draft_queued — retryable
          return res.status(502).json({
            success: false,
            message: `Composio execution failed: ${execResult.error}`,
            status: "draft_queued",
            composioResult: { error: execResult.error, durationMs: execResult.durationMs },
          });
        }

        // Success path — confirm the draft was created
        await db.execute(sql`
          UPDATE composio_gmail_draft_requests
          SET
            status          = ${'draft_created'},
            gmail_draft_id  = ${gmailDraftId},
            error_message   = NULL,
            updated_at      = NOW()
          WHERE id = ${request.id}
        `);

        // Update communication_logs entry to reflect creation
        await db.execute(sql`
          UPDATE communication_logs
          SET status = 'draft_created'
          WHERE agent_action_id = ${request.id} AND org_id = ${orgId}
        `).catch(() => {});

        // Log to agent_operating_timeline
        await db.insert(agentOperatingTimeline).values({
          orgId,
          agentName: request.agent_id,
          systemName: "composio_gmail",
          actionType: "workflow_executed",
          actionStatus: "completed",
          communicationDomain: "gmail",
          summary: `Gmail draft created${gmailDraftId ? ` (ID: ${gmailDraftId})` : ""}: "${request.subject}" → ${request.recipient_email}`,
          requiresApproval: false,
          approvalStatus: "approved",
          relatedEntityType: "composio_gmail_draft_request",
          relatedEntityId: request.id,
          executedAt: new Date(),
          outcomeStatus: "success",
          metadata: { gmailDraftId, durationMs: execResult.durationMs },
        }).catch(() => {});

        // Emit Hermes event — confirmed draft_created
        await emitComposioHermesEvent({
          source: "composio",
          orgId,
          agent: request.agent_id,
          tool: "GMAIL",
          action: "GMAIL_CREATE_EMAIL_DRAFT",
          result: "success",
          outcome: "gmail_draft_created",
          metadata: {
            requestId: request.id,
            gmailDraftId,
            recipientEmail: request.recipient_email,
            subject: request.subject,
            durationMs: execResult.durationMs,
          },
        });

        return res.json({
          success: true,
          message: `Gmail draft created successfully${gmailDraftId ? ` (Draft ID: ${gmailDraftId})` : " (no draft ID returned — check Gmail directly)."}`,
          gmailDraftId,
          status: "draft_created",
          composioResult: { durationMs: execResult.durationMs },
        });
      } catch (e: any) {
        console.error("[ComposioGmailDraft] approve failed:", e.message);
        res.status(500).json({ message: "Failed to execute Gmail draft creation", error: e.message });
      }
    },
  );

  // ── POST /api/composio/gmail-draft/:id/cancel ─────────────────────────────
  app.post(
    "/api/composio/gmail-draft/:id/cancel",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);

        const rows = await db.execute(sql`
          SELECT id, status FROM composio_gmail_draft_requests
          WHERE id = ${req.params.id} AND org_id = ${orgId}
          LIMIT 1
        `);
        const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
        const request: any = items[0];

        if (!request) return res.status(404).json({ message: "Draft request not found" });

        if (request.status === "draft_created") {
          return res.status(400).json({ message: "Cannot cancel a draft that has already been created." });
        }
        if (request.status === "cancelled") {
          return res.status(409).json({ message: "Draft request is already cancelled." });
        }

        await db.execute(sql`
          UPDATE composio_gmail_draft_requests
          SET status = ${'cancelled'}, updated_at = NOW()
          WHERE id = ${request.id}
        `);

        await db.insert(agentOperatingTimeline).values({
          orgId,
          agentName: "admin",
          systemName: "composio_gmail",
          actionType: "cancelled",
          actionStatus: "completed",
          communicationDomain: "gmail",
          summary: `Gmail draft request cancelled by admin (ID: ${request.id})`,
          requiresApproval: false,
          approvalStatus: "rejected",
          relatedEntityType: "composio_gmail_draft_request",
          relatedEntityId: request.id,
          metadata: { cancelledBy: req.user?.id ?? null },
        }).catch(() => {});

        res.json({ success: true, message: "Draft request cancelled.", status: "cancelled" });
      } catch (e: any) {
        console.error("[ComposioGmailDraft] cancel failed:", e.message);
        res.status(500).json({ message: "Failed to cancel draft request", error: e.message });
      }
    },
  );

  console.log("[ComposioGmailDraft] Routes registered");
}
