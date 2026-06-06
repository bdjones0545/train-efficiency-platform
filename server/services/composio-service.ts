/**
 * Composio Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized wrapper around the Composio SDK.
 * ALL agent-to-Composio calls must go through this service — never directly.
 *
 * Responsibilities:
 *  - SDK initialisation and health checking
 *  - Tool/action discovery
 *  - Action execution with structured error handling
 *  - Audit logging of every call into composio_action_log
 *
 * What this service does NOT do:
 *  - Policy evaluation  (→ composio-action-adapter.ts)
 *  - Approval gate      (→ composio-action-adapter.ts)
 *  - Hermes event emit  (→ composio-hermes-emitter.ts)
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Composio SDK ─────────────────────────────────────────────────────────────

let composioClient: any = null;

function getClient(): any {
  if (composioClient) return composioClient;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error("COMPOSIO_API_KEY environment variable is not set");
  const { Composio } = require("composio-core");
  composioClient = new Composio({ apiKey, allowTracing: false });
  return composioClient;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComposioExecuteParams {
  orgId: string;
  agentId: string;
  tool: string;
  action: string;
  inputParams: Record<string, unknown>;
  entityId?: string;
  connectedAccountId?: string;
  logId?: string;
}

export interface ComposioExecuteResult {
  success: boolean;
  data?: unknown;
  error?: string;
  executedAt: Date;
  durationMs: number;
  logId: string;
}

export interface ComposioToolInfo {
  appId: string;
  name: string;
  description: string;
  logo?: string;
  categories: string[];
}

export interface ComposioActionInfo {
  actionName: string;
  appId: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ComposioHealthStatus {
  connected: boolean;
  apiKeyPresent: boolean;
  version: string;
  checkedAt: Date;
  error?: string;
}

// ─── Ensure table exists ──────────────────────────────────────────────────────

export async function ensureComposioLogTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS composio_action_log (
      id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id        TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      tool          TEXT NOT NULL,
      action        TEXT NOT NULL,
      entity_id     TEXT,
      input_summary JSONB,
      success       BOOLEAN NOT NULL DEFAULT false,
      result_summary JSONB,
      error_message TEXT,
      duration_ms   INTEGER,
      policy_decision TEXT,
      approval_required BOOLEAN DEFAULT false,
      hermes_emitted BOOLEAN DEFAULT false,
      executed_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS composio_action_log_org_idx ON composio_action_log (org_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS composio_action_log_agent_idx ON composio_action_log (agent_id)
  `);
}

// ─── Logging ──────────────────────────────────────────────────────────────────

export async function writeComposioActionLog(entry: {
  orgId: string;
  agentId: string;
  tool: string;
  action: string;
  entityId?: string;
  inputSummary?: Record<string, unknown>;
  success: boolean;
  resultSummary?: Record<string, unknown>;
  errorMessage?: string;
  durationMs?: number;
  policyDecision?: string;
  approvalRequired?: boolean;
  hermesEmitted?: boolean;
}): Promise<string> {
  const id = crypto.randomUUID();
  try {
    await db.execute(sql`
      INSERT INTO composio_action_log (
        id, org_id, agent_id, tool, action, entity_id,
        input_summary, success, result_summary, error_message,
        duration_ms, policy_decision, approval_required, hermes_emitted
      ) VALUES (
        ${id}, ${entry.orgId}, ${entry.agentId}, ${entry.tool}, ${entry.action},
        ${entry.entityId ?? null},
        ${entry.inputSummary ? JSON.stringify(entry.inputSummary) : null}::jsonb,
        ${entry.success},
        ${entry.resultSummary ? JSON.stringify(entry.resultSummary) : null}::jsonb,
        ${entry.errorMessage ?? null},
        ${entry.durationMs ?? null},
        ${entry.policyDecision ?? null},
        ${entry.approvalRequired ?? false},
        ${entry.hermesEmitted ?? false}
      )
    `);
  } catch (err: any) {
    console.error("[ComposioService] Failed to write action log:", err.message);
  }
  return id;
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkComposioHealth(): Promise<ComposioHealthStatus> {
  const apiKeyPresent = !!process.env.COMPOSIO_API_KEY;
  const base: ComposioHealthStatus = {
    connected: false,
    apiKeyPresent,
    version: "0.5.39",
    checkedAt: new Date(),
  };

  if (!apiKeyPresent) {
    return { ...base, error: "COMPOSIO_API_KEY not set" };
  }

  try {
    const client = getClient();
    await client.apps.list({ limit: 1 });
    return { ...base, connected: true };
  } catch (err: any) {
    return { ...base, error: err.message };
  }
}

// ─── Tool discovery ───────────────────────────────────────────────────────────

export async function discoverComposioTools(appIds?: string[]): Promise<ComposioToolInfo[]> {
  try {
    const client = getClient();
    const result = await client.apps.list();
    const apps: any[] = Array.isArray(result) ? result : (result?.items ?? result?.data ?? []);

    return apps
      .filter((a: any) => !appIds || appIds.includes(a.key?.toUpperCase() ?? a.appId?.toUpperCase()))
      .map((a: any) => ({
        appId: a.key?.toUpperCase() ?? a.appId ?? "UNKNOWN",
        name: a.name ?? a.displayName ?? a.key ?? "Unknown",
        description: a.description ?? "",
        logo: a.logo,
        categories: a.categories ?? [],
      }));
  } catch (err: any) {
    console.error("[ComposioService] discoverComposioTools failed:", err.message);
    return [];
  }
}

export async function discoverComposioActions(appId: string, limit = 20): Promise<ComposioActionInfo[]> {
  try {
    const client = getClient();
    const result = await client.actions.list({ apps: appId.toLowerCase(), limit });
    const items: any[] = Array.isArray(result) ? result : (result?.items ?? result?.data ?? []);

    return items.map((a: any) => ({
      actionName: a.name ?? a.actionName ?? "",
      appId: appId.toUpperCase(),
      description: a.description ?? "",
      parameters: a.parameters ?? {},
    }));
  } catch (err: any) {
    console.error(`[ComposioService] discoverComposioActions(${appId}) failed:`, err.message);
    return [];
  }
}

// ─── Core execution ───────────────────────────────────────────────────────────

export async function executeComposioAction(
  params: ComposioExecuteParams,
): Promise<ComposioExecuteResult> {
  const startMs = Date.now();
  const { orgId, agentId, tool, action, inputParams, entityId, logId } = params;

  const resolvedLogId = logId ?? crypto.randomUUID();

  try {
    const client = getClient();
    const { ComposioToolSet } = require("composio-core");
    const toolset = new ComposioToolSet({
      apiKey: process.env.COMPOSIO_API_KEY,
      entityId: entityId ?? "default",
    });

    const result = await toolset.executeAction({
      action,
      params: inputParams,
      entityId: entityId ?? "default",
    });

    const durationMs = Date.now() - startMs;

    await writeComposioActionLog({
      orgId,
      agentId,
      tool,
      action,
      entityId,
      inputSummary: sanitisePayloadForLog(inputParams),
      success: true,
      resultSummary: sanitisePayloadForLog(result),
      durationMs,
    });

    console.log(`[ComposioService] ✓ ${agentId} executed ${tool}/${action} in ${durationMs}ms`);

    return {
      success: true,
      data: result,
      executedAt: new Date(),
      durationMs,
      logId: resolvedLogId,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    const errorMessage = err.message ?? String(err);

    await writeComposioActionLog({
      orgId,
      agentId,
      tool,
      action,
      entityId,
      inputSummary: sanitisePayloadForLog(inputParams),
      success: false,
      errorMessage,
      durationMs,
    });

    console.error(`[ComposioService] ✗ ${agentId} failed ${tool}/${action}: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage,
      executedAt: new Date(),
      durationMs,
      logId: resolvedLogId,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitisePayloadForLog(obj: Record<string, unknown>): Record<string, unknown> {
  const REDACT_KEYS = new Set(["password", "token", "secret", "api_key", "apiKey", "body", "message_body"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function getComposioActionLog(
  orgId: string,
  filters?: { agentId?: string; tool?: string; limit?: number },
): Promise<any[]> {
  try {
    const limit = filters?.limit ?? 50;
    let q = `
      SELECT * FROM composio_action_log
      WHERE org_id = '${orgId}'
    `;
    if (filters?.agentId) q += ` AND agent_id = '${filters.agentId}'`;
    if (filters?.tool) q += ` AND tool = '${filters.tool}'`;
    q += ` ORDER BY created_at DESC LIMIT ${limit}`;

    const raw = await db.execute(sql.raw(q));
    const rows = Array.isArray(raw) ? raw : (raw as any).rows ?? [];
    return rows;
  } catch {
    return [];
  }
}
