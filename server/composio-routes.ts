/**
 * Composio Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * All endpoints are under /api/composio/*
 *
 * Endpoints:
 *   GET  /api/composio/status             — health + connection status
 *   GET  /api/composio/registry           — full tool registry snapshot
 *   GET  /api/composio/agent-permissions  — all agent → tool mappings
 *   GET  /api/composio/agent-permissions/:agentId — single agent tools
 *   GET  /api/composio/tools/:toolId/actions — available actions for a tool
 *   POST /api/composio/execute            — request an action (via adapter)
 *   GET  /api/composio/action-log         — org-scoped action history
 *   GET  /api/composio/hermes-events      — org-scoped Hermes events
 *   GET  /api/composio/hermes-events/unprocessed — unprocessed events
 */

import type { Express } from "express";
import {
  checkComposioHealth,
  discoverComposioTools,
  discoverComposioActions,
  getComposioActionLog,
  listConnectedAccounts,
  ensureComposioLogTable,
} from "./services/composio-service";
import { resolveOrgIdOrThrow } from "./lib/resolve-org-id";
import {
  getRegistrySnapshot,
  getAllAgentPermissions,
  getAgentTools,
  COMPOSIO_TOOLS,
  isAgentAllowedTool,
  type ComposioToolId,
} from "./composio-tool-registry";
import { requestComposioAction } from "./composio-action-adapter";
import {
  getRecentHermesEvents,
  getUnprocessedHermesEvents,
  ensureHermesEventTable,
} from "./composio-hermes-emitter";
import { z } from "zod";

// ─── Validation schemas ───────────────────────────────────────────────────────

const executeActionSchema = z.object({
  agentId: z.string().min(1),
  tool: z.string().min(1),
  action: z.string().min(1),
  inputParams: z.record(z.unknown()).default({}),
  entityId: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.7),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
  recipientEmail: z.string().email().optional(),
  notes: z.string().optional(),
});

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerComposioRoutes(
  app: Express,
  isAuthenticated: any,
  requireRole: any,
): Promise<void> {
  // Ensure tables exist on startup
  try {
    await ensureComposioLogTable();
    await ensureHermesEventTable();
    console.log("[Composio] Tables ready");
  } catch (err: any) {
    console.error("[Composio] Table setup failed:", err.message);
  }

  // ── GET /api/composio/status ─────────────────────────────────────────────
  app.get(
    "/api/composio/status",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const [health, connectedAccounts] = await Promise.all([
          checkComposioHealth(),
          listConnectedAccounts().catch(() => []),
        ]);
        const registry = getRegistrySnapshot();
        res.json({
          ...health,
          toolCount: registry.totalTools,
          agentCount: registry.totalAgents,
          connectedAccounts,
          connectedAccountCount: connectedAccounts.length,
          hasConnectedAccounts: connectedAccounts.length > 0,
          phase: 2,
          apiVersion: "v3.1",
          description: "Composio External Tool Layer — v3.1 API",
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── GET /api/composio/registry ───────────────────────────────────────────
  app.get(
    "/api/composio/registry",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (_req, res) => {
      try {
        res.json(getRegistrySnapshot());
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── GET /api/composio/agent-permissions ──────────────────────────────────
  app.get(
    "/api/composio/agent-permissions",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (_req, res) => {
      try {
        const perms = getAllAgentPermissions().map(p => ({
          ...p,
          toolDetails: getAgentTools(p.agentId),
        }));
        res.json({ agentPermissions: perms, total: perms.length });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── GET /api/composio/agent-permissions/:agentId ─────────────────────────
  app.get(
    "/api/composio/agent-permissions/:agentId",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const { agentId } = req.params;
        const tools = getAgentTools(agentId);
        if (!tools.length) {
          return res.status(404).json({
            message: `No permissions found for agent "${agentId}". Valid agents: ${getAllAgentPermissions().map(p => p.agentId).join(", ")}`,
          });
        }
        res.json({ agentId, tools, toolCount: tools.length });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── GET /api/composio/tools/:toolId/actions ──────────────────────────────
  app.get(
    "/api/composio/tools/:toolId/actions",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const toolId = req.params.toolId.toUpperCase() as ComposioToolId;
        const toolDef = COMPOSIO_TOOLS[toolId];
        if (!toolDef) {
          return res.status(404).json({ message: `Unknown tool: ${toolId}` });
        }

        // Return the static allowed/blocked lists (fast, no API call needed)
        res.json({
          tool: toolDef,
          allowedActions: toolDef.allowedActions,
          blockedActions: toolDef.blockedActions,
          note: "Phase 1 — static registry. Live action discovery requires connected Composio account.",
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── GET /api/composio/tools/:toolId/discover ─────────────────────────────
  // Calls the Composio API to list live actions (requires connected account)
  app.get(
    "/api/composio/tools/:toolId/discover",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const toolId = req.params.toolId;
        const actions = await discoverComposioActions(toolId);
        res.json({ toolId: toolId.toUpperCase(), actions, total: actions.length });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── POST /api/composio/execute ───────────────────────────────────────────
  app.post(
    "/api/composio/execute",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const parsed = executeActionSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: "Invalid request body",
            errors: parsed.error.flatten().fieldErrors,
          });
        }

        const orgId = await resolveOrgIdOrThrow(req);

        const result = await requestComposioAction({
          orgId,
          ...parsed.data,
        });

        const statusCode =
          result.outcome === "executed" ? 200
          : result.outcome === "queued_for_approval" ? 202
          : result.outcome === "failed" ? 500
          : 403;

        res.status(statusCode).json(result);
      } catch (err: any) {
        console.error("[Composio] /execute error:", err.message);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── GET /api/composio/action-log ─────────────────────────────────────────
  app.get(
    "/api/composio/action-log",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);
        const { agentId, tool, limit } = req.query;
        const logs = await getComposioActionLog(orgId, {
          agentId: agentId as string | undefined,
          tool: tool as string | undefined,
          limit: limit ? parseInt(limit as string) : 50,
        });
        res.json({ logs, total: logs.length });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── GET /api/composio/hermes-events ──────────────────────────────────────
  app.get(
    "/api/composio/hermes-events",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await resolveOrgIdOrThrow(req);
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const events = await getRecentHermesEvents(orgId, limit);
        res.json({ events, total: events.length });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── GET /api/composio/hermes-events/unprocessed ───────────────────────────
  app.get(
    "/api/composio/hermes-events/unprocessed",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        let orgId: string | undefined;
        try { orgId = await resolveOrgIdOrThrow(req); } catch { orgId = undefined; }
        const events = await getUnprocessedHermesEvents(orgId);
        res.json({ events, total: events.length });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  console.log("[Composio] Routes registered");
}
