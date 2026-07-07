/**
 * Agent Telemetry SDK — Phase 8
 *
 * Automatically captures telemetry for every published agent.
 * No developer implementation required — every agent gets this automatically.
 *
 * Captured signals:
 * - Executions (success / failure)
 * - Revenue events
 * - Trust signals
 * - Learning events
 * - Workflow outcomes
 * - Memory updates
 * - Runtime state
 */

import { db } from "./db";
import {
  agentRuntimes,
  agentMemories,
  agentLifecycleEvents,
  crossOrgLearningEvents,
  agentTemplates,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { AGENT_IDENTITIES } from "./agent-identities";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TelemetryExecution {
  agentId: string;
  orgId: string;
  executionType: string;
  success: boolean;
  durationMs?: number;
  revenueImpact?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface TrustSignal {
  agentId: string;
  orgId: string;
  signalType: "positive" | "negative" | "neutral";
  source: string;   // "execution_success" | "review" | "compliance" | "accuracy"
  value: number;    // contribution to trust (can be negative)
  evidence?: string;
}

export interface AgentTelemetry {
  agentId: string;
  orgId?: string;
  executions: number;
  successes: number;
  failures: number;
  successRate: number;
  avgRevenuePer: number;
  totalRevenue: number;
  trustSignals: number;
  lastActive?: string;
  runtimeStatus: string;
  memoryVersion: number;
}

// ─── Ensure Runtime ───────────────────────────────────────────────────────────

export async function ensureAgentRuntime(agentId: string, orgId: string): Promise<typeof agentRuntimes.$inferSelect> {
  const existing = await db.select().from(agentRuntimes).where(
    and(eq(agentRuntimes.agentId, agentId), eq(agentRuntimes.orgId, orgId))
  ).catch(() => []);

  if (existing[0]) return existing[0];

  const identity = AGENT_IDENTITIES[agentId];
  const toolScope = {
    email: identity?.capabilities?.includes("Email") ?? false,
    crm: identity?.capabilities?.includes("CRM") ?? false,
    calendar: identity?.capabilities?.includes("Scheduling") ?? false,
    reporting: true,
  };

  const [runtime] = await db.insert(agentRuntimes).values({
    agentId, orgId,
    runtimeVersion: "1.0.0",
    memoryScope: { namespaces: ["org", "agent", "workflow"], retentionDays: 90 },
    toolScope,
    executionCount: 0, successCount: 0, failureCount: 0,
    status: "active",
    isolationLevel: "standard",
  }).returning();

  // Log lifecycle event
  await db.insert(agentLifecycleEvents).values({
    agentId, orgId, eventType: "runtime_initialized",
    toStatus: "active", notes: `Runtime initialized — isolation: standard, tool scope: ${JSON.stringify(toolScope)}`,
  }).catch(() => {});

  return runtime;
}

// ─── Capture Execution ────────────────────────────────────────────────────────

export async function captureExecution(exec: TelemetryExecution): Promise<void> {
  const runtime = await ensureAgentRuntime(exec.agentId, exec.orgId);

  await db.update(agentRuntimes).set({
    executionCount: (runtime.executionCount ?? 0) + 1,
    successCount: exec.success ? (runtime.successCount ?? 0) + 1 : runtime.successCount,
    failureCount: !exec.success ? (runtime.failureCount ?? 0) + 1 : runtime.failureCount,
    lastActiveAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(agentRuntimes.agentId, exec.agentId), eq(agentRuntimes.orgId, exec.orgId))).catch(() => {});

  // Update agent template stats
  await db.update(agentTemplates).set({
    totalExecutions: sql`coalesce(total_executions, 0) + 1`,
    updatedAt: new Date(),
  }).where(eq(agentTemplates.agentId, exec.agentId)).catch(() => {});

  // Record as cross-org learning event (anonymized)
  if (exec.success && exec.revenueImpact) {
    await db.insert(crossOrgLearningEvents).values({
      agentId: exec.agentId,
      eventType: exec.executionType,
      benchmarkData: {
        revenueImpact: exec.revenueImpact,
        durationMs: exec.durationMs,
        success: exec.success,
        capturedAt: new Date().toISOString(),
      },
    }).catch(() => {});
  }
}

// ─── Capture Trust Signal ─────────────────────────────────────────────────────

export async function captureTrustSignal(signal: TrustSignal): Promise<void> {
  // Trust signals update the agent template's trust score
  const templates = await db.select().from(agentTemplates)
    .where(eq(agentTemplates.agentId, signal.agentId)).catch(() => []);
  if (!templates[0]) return;

  const current = templates[0].averageTrustScore ?? 0;
  const alpha = 0.1; // exponential moving average weight
  const updated = current + alpha * (signal.value - current);

  await db.update(agentTemplates).set({
    averageTrustScore: Math.max(0, Math.min(100, updated)),
    updatedAt: new Date(),
  }).where(eq(agentTemplates.agentId, signal.agentId)).catch(() => {});
}

// ─── Update Agent Memory ──────────────────────────────────────────────────────

export async function updateAgentMemory(
  agentId: string,
  orgId: string,
  updates: Partial<{
    learnedPreferences: Record<string, any>;
    successfulPatterns: any[];
    failedPatterns: any[];
    orgSpecificContext: Record<string, any>;
    workflowHistory: any[];
    recommendationHistory: any[];
  }>
): Promise<void> {
  const existing = await db.select().from(agentMemories).where(
    and(eq(agentMemories.agentId, agentId), eq(agentMemories.orgId, orgId))
  ).catch(() => []);

  if (existing[0]) {
    await db.update(agentMemories).set({
      ...updates,
      memoryVersion: (existing[0].memoryVersion ?? 1) + 1,
      lastUpdatedAt: new Date(),
    }).where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.orgId, orgId))).catch(() => {});
  } else {
    await db.insert(agentMemories).values({
      agentId, orgId,
      learnedPreferences: updates.learnedPreferences ?? {},
      successfulPatterns: updates.successfulPatterns ?? [],
      failedPatterns: updates.failedPatterns ?? [],
      orgSpecificContext: updates.orgSpecificContext ?? {},
      workflowHistory: updates.workflowHistory ?? [],
      recommendationHistory: updates.recommendationHistory ?? [],
      memoryVersion: 1,
    }).catch(() => {});
  }
}

// ─── Get Agent Telemetry ──────────────────────────────────────────────────────

export async function getAgentTelemetry(agentId: string, orgId?: string): Promise<AgentTelemetry> {
  const runtimeQuery = orgId
    ? db.select().from(agentRuntimes).where(and(eq(agentRuntimes.agentId, agentId), eq(agentRuntimes.orgId, orgId)))
    : db.select().from(agentRuntimes).where(eq(agentRuntimes.agentId, agentId));

  const runtimes = await runtimeQuery.catch(() => []);
  const memory = orgId
    ? (await db.select().from(agentMemories).where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.orgId, orgId))).catch(() => []))[0]
    : null;

  // Aggregate runtime stats
  const totalExec = runtimes.reduce((s, r) => s + (r.executionCount ?? 0), 0);
  const totalSuccess = runtimes.reduce((s, r) => s + (r.successCount ?? 0), 0);
  const totalFailure = runtimes.reduce((s, r) => s + (r.failureCount ?? 0), 0);
  const successRate = totalExec > 0 ? Math.round((totalSuccess / totalExec) * 100) : 0;
  const lastActive = runtimes.map(r => r.lastActiveAt).filter(Boolean).sort().at(-1);
  const status = runtimes.length > 0 ? (runtimes[0].status ?? "unknown") : "no_runtime";

  return {
    agentId,
    orgId,
    executions: totalExec,
    successes: totalSuccess,
    failures: totalFailure,
    successRate,
    avgRevenuePer: 0, // populated from revenue events in caller
    totalRevenue: 0,
    trustSignals: runtimes.length,
    lastActive: lastActive?.toISOString(),
    runtimeStatus: status,
    memoryVersion: memory?.memoryVersion ?? 0,
  };
}

// ─── Get All Runtimes for Org ─────────────────────────────────────────────────

export async function getOrgRuntimes(orgId: string) {
  const runtimes = await db.select().from(agentRuntimes).where(eq(agentRuntimes.orgId, orgId)).catch(() => []);
  return runtimes.map(r => ({
    ...r,
    agentName: AGENT_IDENTITIES[r.agentId]?.agentName ?? r.agentId,
    successRate: r.executionCount
      ? Math.round((r.successCount ?? 0) / r.executionCount * 100)
      : 0,
  }));
}

// ─── Initialize Runtimes for All Active Agents ────────────────────────────────
// Called once per org to bootstrap runtime isolation.

export async function bootstrapOrgRuntimes(orgId: string): Promise<number> {
  let count = 0;
  for (const [agentId] of Object.entries(AGENT_IDENTITIES)) {
    try {
      await ensureAgentRuntime(agentId, orgId);
      count++;
    } catch {}
  }
  return count;
}
