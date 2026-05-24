/**
 * Integration Runtime — Phase 5
 *
 * Central execution layer for ALL external integrations.
 * Every outbound API call, every inbound webhook, every model invocation
 * MUST flow through this runtime. No direct execution bypass is permitted.
 *
 * Responsibilities:
 *  - Governance validation before execution
 *  - Idempotency key enforcement for mutating actions
 *  - Retry / failure classification
 *  - Rate-limit enforcement
 *  - Standardized response normalization
 *  - Immutable audit trail via integration_execution_log
 *  - Integration health tracking
 *  - Emergency-pause awareness
 */

import { db } from "./db";
import { externalIntegrations, integrationExecutionLog } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntegrationType =
  | "gmail"
  | "google_calendar"
  | "slack"
  | "openrouter"
  | "claude"
  | "meta_ads"
  | "hubspot"
  | "twilio"
  | "stripe"
  | "discord"
  | "custom_webhook";

export type IntegrationStatus = "connected" | "disconnected" | "degraded" | "paused" | "error";

export type ErrorClass = "transient" | "permanent" | "rate_limited" | "auth" | "governance" | "timeout";

export type GovernanceDecision = "allowed" | "blocked" | "approval_required";

export interface IntegrationActionInput {
  orgId: string;
  integrationType: IntegrationType;
  actionType: string;
  agentType?: string;
  workflowJobId?: string;
  workflowRunId?: string;
  idempotencyKey?: string;
  inputSummary?: string;
  payload: Record<string, any>;
  /** If true, skip external network call (dry-run for governance checks) */
  dryRun?: boolean;
}

export interface IntegrationActionResult {
  ok: boolean;
  data?: Record<string, any>;
  error?: string;
  errorClass?: ErrorClass;
  governanceDecision?: GovernanceDecision;
  latencyMs?: number;
  logId?: string;
  blocked?: boolean;
}

export interface IntegrationHealthReport {
  integrationType: IntegrationType;
  status: IntegrationStatus;
  latencyMs?: number;
  lastSuccessfulActionAt?: Date | null;
  lastFailureAt?: Date | null;
  lastFailureReason?: string | null;
  rateLimitState?: Record<string, any>;
  usageStats?: Record<string, any>;
  authExpiration?: Date | null;
  warnings: string[];
}

// ─── Core Runtime ─────────────────────────────────────────────────────────────

/**
 * Execute an action through the governed integration runtime.
 * All external calls MUST use this function.
 */
export async function executeIntegrationAction(
  input: IntegrationActionInput,
  executor: () => Promise<Record<string, any>>,
): Promise<IntegrationActionResult> {
  const startMs = Date.now();
  const logId = randomUUID();

  // 1. Idempotency check — reject duplicate mutating actions
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(integrationExecutionLog)
      .where(eq(integrationExecutionLog.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing && existing.status === "success") {
      console.log(`[IntegrationRuntime] Idempotent skip — key: ${input.idempotencyKey}`);
      return {
        ok: true,
        data: { idempotent: true, originalLogId: existing.id },
        logId: existing.id,
      };
    }
  }

  // 2. Governance check
  const governance = await checkIntegrationGovernance(input);
  if (!governance.allowed) {
    await writeLog({
      id: logId,
      orgId: input.orgId,
      integrationType: input.integrationType,
      actionType: input.actionType,
      agentType: input.agentType,
      workflowJobId: input.workflowJobId,
      workflowRunId: input.workflowRunId,
      idempotencyKey: input.idempotencyKey,
      inputSummary: input.inputSummary,
      status: "blocked",
      governanceChecked: true,
      governanceDecision: governance.decision,
      errorMessage: governance.reason,
      errorClass: "governance",
    });
    return {
      ok: false,
      blocked: true,
      error: governance.reason,
      errorClass: "governance",
      governanceDecision: governance.decision,
      logId,
    };
  }

  // 3. Integration health pre-check
  const integration = await getIntegration(input.orgId, input.integrationType);
  if (integration && integration.status === "paused") {
    return { ok: false, error: `Integration ${input.integrationType} is paused`, errorClass: "governance" };
  }

  // 4. Dry-run short-circuit
  if (input.dryRun) {
    return { ok: true, data: { dryRun: true, governanceDecision: governance.decision }, logId };
  }

  // 5. Execute
  let resultData: Record<string, any> | undefined;
  let errorMessage: string | undefined;
  let errorClass: ErrorClass | undefined;
  let status: string = "pending";

  try {
    resultData = await executor();
    status = "success";

    // Update integration last success
    if (integration) {
      await db.update(externalIntegrations)
        .set({ lastSuccessfulActionAt: new Date(), updatedAt: new Date() })
        .where(eq(externalIntegrations.id, integration.id));
    }
  } catch (err: any) {
    errorMessage = err.message ?? String(err);
    errorClass = classifyProviderError(err);
    status = errorClass === "rate_limited" ? "rate_limited" : "failed";

    // Update integration failure state
    if (integration) {
      const updates: any = {
        lastFailureAt: new Date(),
        lastFailureReason: errorMessage.slice(0, 500),
        updatedAt: new Date(),
      };
      if (errorClass === "auth") updates.status = "error";
      else if (errorClass === "rate_limited") {
        updates.rateLimitState = { ...(integration.rateLimitState as any ?? {}), hitAt: new Date() };
      }
      await db.update(externalIntegrations).set(updates).where(eq(externalIntegrations.id, integration.id));
    }
  }

  const latencyMs = Date.now() - startMs;

  // 6. Write audit log
  await writeLog({
    id: logId,
    orgId: input.orgId,
    integrationId: integration?.id,
    integrationType: input.integrationType,
    actionType: input.actionType,
    agentType: input.agentType,
    workflowJobId: input.workflowJobId,
    workflowRunId: input.workflowRunId,
    idempotencyKey: input.idempotencyKey,
    inputSummary: input.inputSummary,
    status,
    governanceChecked: true,
    governanceDecision: governance.decision,
    errorMessage,
    errorClass,
    latencyMs,
    completedAt: new Date(),
  });

  if (!resultData) {
    return { ok: false, error: errorMessage, errorClass, logId, latencyMs };
  }

  return { ok: true, data: resultData, logId, latencyMs };
}

// ─── Governance ───────────────────────────────────────────────────────────────

export async function checkIntegrationGovernance(input: IntegrationActionInput): Promise<{
  allowed: boolean;
  decision: GovernanceDecision;
  reason?: string;
}> {
  try {
    const { getGovernanceSettings } = await import("./capability-enforcement-engine");
    const settings = await getGovernanceSettings(input.orgId);

    // Emergency pause blocks everything
    if (settings?.emergencyPause) {
      return { allowed: false, decision: "blocked", reason: "Emergency pause is active — all integrations halted" };
    }

    // Check integration-level governance restrictions
    const integration = await getIntegration(input.orgId, input.integrationType);
    if (integration) {
      const restrictions = integration.governanceRestrictions as any ?? {};

      // Agent whitelist check
      if (input.agentType && integration.enabledAgents && Array.isArray(integration.enabledAgents)) {
        const enabledAgents = integration.enabledAgents as string[];
        if (enabledAgents.length > 0 && !enabledAgents.includes(input.agentType)) {
          return {
            allowed: false,
            decision: "blocked",
            reason: `Agent ${input.agentType} not permitted for ${input.integrationType} integration`,
          };
        }
      }

      // Time restrictions (e.g., no Gmail sends after 8pm)
      if (restrictions.noSendAfterHour !== undefined) {
        const hour = new Date().getUTCHours();
        if (hour >= restrictions.noSendAfterHour) {
          return {
            allowed: false,
            decision: "blocked",
            reason: `${input.integrationType} sending disabled after ${restrictions.noSendAfterHour}:00 UTC`,
          };
        }
      }

      // Require approval for certain action types
      if (restrictions.requireApprovalFor && Array.isArray(restrictions.requireApprovalFor)) {
        if (restrictions.requireApprovalFor.includes(input.actionType)) {
          return {
            allowed: false,
            decision: "approval_required",
            reason: `Action ${input.actionType} requires operator approval`,
          };
        }
      }
    }

    return { allowed: true, decision: "allowed" };
  } catch (err: any) {
    console.error("[IntegrationRuntime] Governance check error:", err.message);
    return { allowed: true, decision: "allowed" };
  }
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function validateIntegrationHealth(
  orgId: string,
  integrationType: IntegrationType,
): Promise<IntegrationHealthReport> {
  const integration = await getIntegration(orgId, integrationType);
  const warnings: string[] = [];

  if (!integration) {
    return {
      integrationType,
      status: "disconnected",
      warnings: ["Integration not configured"],
    };
  }

  const status = integration.status as IntegrationStatus;

  // Check for stale health check (> 1 hour)
  if (integration.lastHealthCheckAt) {
    const staleMs = Date.now() - new Date(integration.lastHealthCheckAt).getTime();
    if (staleMs > 3600_000) warnings.push("Health check stale (> 1 hour)");
  } else {
    warnings.push("No health check performed yet");
  }

  // Check for recent failures
  if (integration.lastFailureAt) {
    const failMs = Date.now() - new Date(integration.lastFailureAt).getTime();
    if (failMs < 3600_000) warnings.push(`Recent failure: ${integration.lastFailureReason ?? "unknown"}`);
  }

  // Check credentials expiry hint (stored in governance_restrictions)
  const restrictions = integration.governanceRestrictions as any ?? {};
  let authExpiration: Date | null = null;
  if (restrictions.tokenExpiresAt) {
    authExpiration = new Date(restrictions.tokenExpiresAt);
    const daysLeft = (authExpiration.getTime() - Date.now()) / 86_400_000;
    if (daysLeft < 7) warnings.push(`Auth token expires in ${Math.ceil(daysLeft)} day(s)`);
  }

  // Update lastHealthCheckAt
  await db.update(externalIntegrations)
    .set({ lastHealthCheckAt: new Date(), updatedAt: new Date() })
    .where(eq(externalIntegrations.id, integration.id));

  return {
    integrationType,
    status,
    lastSuccessfulActionAt: integration.lastSuccessfulActionAt,
    lastFailureAt: integration.lastFailureAt,
    lastFailureReason: integration.lastFailureReason,
    rateLimitState: integration.rateLimitState as any,
    usageStats: integration.usageStats as any,
    authExpiration,
    warnings,
  };
}

export async function pauseIntegration(orgId: string, integrationType: string, reason: string): Promise<void> {
  await db.update(externalIntegrations)
    .set({
      status: "paused",
      governanceRestrictions: { pauseReason: reason, pausedAt: new Date() },
      updatedAt: new Date(),
    })
    .where(and(eq(externalIntegrations.orgId, orgId), eq(externalIntegrations.integrationType, integrationType)));
  console.log(`[IntegrationRuntime] Paused ${integrationType} for org ${orgId}: ${reason}`);
}

export async function resumeIntegration(orgId: string, integrationType: string): Promise<void> {
  await db.update(externalIntegrations)
    .set({ status: "connected", updatedAt: new Date() })
    .where(and(eq(externalIntegrations.orgId, orgId), eq(externalIntegrations.integrationType, integrationType)));
  console.log(`[IntegrationRuntime] Resumed ${integrationType} for org ${orgId}`);
}

export async function refreshIntegrationState(orgId: string, integrationType: IntegrationType): Promise<void> {
  const health = await validateIntegrationHealth(orgId, integrationType);

  // Auto-degrade if recent persistent failures
  const integration = await getIntegration(orgId, integrationType);
  if (!integration) return;

  const recentLogs = await db.select()
    .from(integrationExecutionLog)
    .where(and(
      eq(integrationExecutionLog.orgId, orgId),
      eq(integrationExecutionLog.integrationType, integrationType),
    ))
    .orderBy(desc(integrationExecutionLog.createdAt))
    .limit(10);

  const recentFailures = recentLogs.filter(l => l.status === "failed").length;
  if (recentFailures >= 5 && integration.status === "connected") {
    await db.update(externalIntegrations)
      .set({ status: "degraded", updatedAt: new Date() })
      .where(eq(externalIntegrations.id, integration.id));
  } else if (recentFailures === 0 && integration.status === "degraded") {
    await db.update(externalIntegrations)
      .set({ status: "connected", updatedAt: new Date() })
      .where(eq(externalIntegrations.id, integration.id));
  }
}

// ─── Error classification ─────────────────────────────────────────────────────

export function classifyProviderError(err: any): ErrorClass {
  const msg = String(err?.message ?? err).toLowerCase();
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;

  if (status === 401 || status === 403 || msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("invalid_grant")) {
    return "auth";
  }
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("quota")) {
    return "rate_limited";
  }
  if (status === 408 || msg.includes("timeout") || msg.includes("timed out") || msg.includes("econnrefused")) {
    return "timeout";
  }
  if (status && status >= 500) return "transient";
  if (status && status >= 400 && status < 500) return "permanent";
  return "transient";
}

export function normalizeProviderResponse(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") return { message: raw };
  if (typeof raw === "object") {
    return {
      id: raw.id ?? raw.messageId ?? raw.event_id ?? raw.ts,
      status: raw.status ?? raw.state ?? "ok",
      data: raw.data ?? raw.result ?? raw,
    };
  }
  return { raw };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function getIntegration(orgId: string, integrationType: string) {
  const [row] = await db.select().from(externalIntegrations)
    .where(and(eq(externalIntegrations.orgId, orgId), eq(externalIntegrations.integrationType, integrationType)))
    .limit(1);
  return row ?? null;
}

export async function getAllIntegrations(orgId: string) {
  return db.select().from(externalIntegrations)
    .where(eq(externalIntegrations.orgId, orgId))
    .orderBy(externalIntegrations.integrationType);
}

export async function upsertIntegration(
  orgId: string,
  integrationType: string,
  data: Partial<typeof externalIntegrations.$inferSelect>,
): Promise<typeof externalIntegrations.$inferSelect> {
  const existing = await getIntegration(orgId, integrationType);
  if (existing) {
    const [updated] = await db.update(externalIntegrations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(externalIntegrations.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db.insert(externalIntegrations)
    .values({
      orgId,
      integrationType,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)
    .returning();
  return created;
}

export async function getIntegrationExecutionLogs(
  orgId: string,
  opts?: { integrationType?: string; limit?: number; status?: string },
) {
  const conditions: any[] = [eq(integrationExecutionLog.orgId, orgId)];
  if (opts?.integrationType) {
    conditions.push(eq(integrationExecutionLog.integrationType, opts.integrationType));
  }
  if (opts?.status) {
    conditions.push(eq(integrationExecutionLog.status, opts.status));
  }
  return db.select()
    .from(integrationExecutionLog)
    .where(and(...conditions))
    .orderBy(desc(integrationExecutionLog.createdAt))
    .limit(opts?.limit ?? 50);
}

export async function getIntegrationStats(orgId: string) {
  const all = await getAllIntegrations(orgId);
  const connected = all.filter(i => i.status === "connected").length;
  const degraded = all.filter(i => i.status === "degraded").length;
  const error = all.filter(i => i.status === "error").length;
  const paused = all.filter(i => i.status === "paused").length;

  const recentLogs = await db.select()
    .from(integrationExecutionLog)
    .where(eq(integrationExecutionLog.orgId, orgId))
    .orderBy(desc(integrationExecutionLog.createdAt))
    .limit(100);

  const successCount = recentLogs.filter(l => l.status === "success").length;
  const failCount = recentLogs.filter(l => l.status === "failed").length;
  const blockedCount = recentLogs.filter(l => l.status === "blocked").length;

  return {
    total: all.length,
    connected,
    degraded,
    error,
    paused,
    recentActions: recentLogs.length,
    successRate: recentLogs.length ? Math.round((successCount / recentLogs.length) * 100) : 100,
    failCount,
    blockedCount,
    integrations: all,
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function writeLog(entry: Partial<typeof integrationExecutionLog.$inferSelect> & { id: string; orgId: string; integrationType: string; actionType: string }) {
  try {
    await db.insert(integrationExecutionLog).values(entry as any).onConflictDoNothing();
  } catch (err: any) {
    console.error("[IntegrationRuntime] Failed to write audit log:", err.message);
  }
}
