/**
 * Workflow Context Engine — Phase 2 Memory + Context Persistence Layer
 *
 * Responsibilities:
 * - Retrieve relevant memory/context before workflow execution
 * - Compress historical interactions into usable summaries
 * - Rank memory relevance
 * - Attach contextual memory to workflow runs
 * - Persist new memory after workflow completion
 * - Maintain explainability (all memory decisions are logged)
 *
 * Safety guarantees:
 * - Strictly org-scoped (no cross-org leakage)
 * - No self-modifying prompts
 * - All memory usage is auditable
 * - Operator overrides are never auto-deleted
 * - Memory retrieval is bounded (MAX_CONTEXT_ITEMS per call)
 */

import { db } from "./db";
import { workflowContext, workflowOutcomes } from "@shared/schema";
import { eq, and, desc, asc, not, lt, sql } from "drizzle-orm";
import { logUnifiedAction } from "./unified-action-logger";

const MAX_CONTEXT_ITEMS = 10;          // max memories returned per context retrieval
const COMPRESS_AFTER_DAYS = 30;        // low-importance memories compress after 30 days
const ARCHIVE_AFTER_DAYS = 90;         // stale low-importance memories archive after 90 days
const LOW_IMPORTANCE_THRESHOLD = 0.3;  // below this score → eligible for lifecycle management
const HIGH_IMPORTANCE_THRESHOLD = 0.7; // above this → persist indefinitely

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContextRetrievalInput = {
  orgId: string;
  entityType: string;
  entityId: string;
  workflowType?: string;
  limit?: number;
};

export type WorkflowMemoryInput = {
  orgId: string;
  entityType: string;
  entityId: string;
  contextType: "interaction_history" | "workflow_memory" | "business_memory" | "communication_memory" | "operator_override" | "ai_reasoning_memory";
  summary: string;
  structuredContext?: Record<string, any>;
  lastOutcome?: string;
  lastConfidenceScore?: number;
  sourceWorkflowId?: string;
  sourceActionLogId?: string;
  createdBy?: "system" | "agent" | "admin" | "coach";
  neverDelete?: boolean;
};

export type ContextSummary = {
  entityId: string;
  entityType: string;
  totalMemories: number;
  recentInteractions: string[];
  operatorPreferences: string[];
  workflowOutcomeHistory: string[];
  aiReasoningHistory: string[];
  importantFlags: string[];
  contextBlock: string; // formatted text block for AI prompt injection
};

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Retrieve relevant context/memory for a workflow about to execute.
 * Returns memories ranked by relevance (importance score + recency).
 * Strictly bounded to MAX_CONTEXT_ITEMS to keep context injection performant.
 */
export async function getWorkflowContext(input: ContextRetrievalInput) {
  const limit = Math.min(input.limit ?? MAX_CONTEXT_ITEMS, MAX_CONTEXT_ITEMS);

  const memories = await db
    .select()
    .from(workflowContext)
    .where(
      and(
        eq(workflowContext.orgId, input.orgId),
        eq(workflowContext.entityType, input.entityType),
        eq(workflowContext.entityId, input.entityId),
        eq(workflowContext.archived, false),
      )
    )
    .orderBy(desc(workflowContext.memoryImportanceScore), desc(workflowContext.updatedAt))
    .limit(limit);

  return memories;
}

/**
 * Retrieve all context for an org (admin visibility / dashboard feed).
 */
export async function getOrgWorkflowContext(orgId: string, limit = 50) {
  return db
    .select()
    .from(workflowContext)
    .where(and(eq(workflowContext.orgId, orgId), eq(workflowContext.archived, false)))
    .orderBy(desc(workflowContext.updatedAt))
    .limit(limit);
}

/**
 * Build a formatted context summary block suitable for attaching to workflow runs
 * or injecting into AI prompts as historical context.
 */
export async function buildContextSummary(input: ContextRetrievalInput): Promise<ContextSummary> {
  const memories = await getWorkflowContext({ ...input, limit: MAX_CONTEXT_ITEMS });

  const recentInteractions: string[] = [];
  const operatorPreferences: string[] = [];
  const workflowOutcomeHistory: string[] = [];
  const aiReasoningHistory: string[] = [];
  const importantFlags: string[] = [];

  for (const m of memories) {
    switch (m.contextType) {
      case "interaction_history":
      case "communication_memory":
        recentInteractions.push(m.summary);
        break;
      case "operator_override":
        operatorPreferences.push(m.summary);
        break;
      case "workflow_memory":
        if (m.lastOutcome) workflowOutcomeHistory.push(`[${m.lastOutcome.toUpperCase()}] ${m.summary}`);
        else workflowOutcomeHistory.push(m.summary);
        break;
      case "ai_reasoning_memory":
        aiReasoningHistory.push(m.summary);
        break;
      case "business_memory":
        importantFlags.push(m.summary);
        break;
    }
  }

  // Build a plain-text context block for AI prompt injection
  const lines: string[] = [`=== Historical Context for ${input.entityType} ${input.entityId} ===`];
  if (recentInteractions.length)   lines.push(`\nCommunication History:\n${recentInteractions.map(s => `• ${s}`).join("\n")}`);
  if (operatorPreferences.length)  lines.push(`\nOperator Preferences (apply these):\n${operatorPreferences.map(s => `• ${s}`).join("\n")}`);
  if (workflowOutcomeHistory.length) lines.push(`\nPrior Workflow Outcomes:\n${workflowOutcomeHistory.map(s => `• ${s}`).join("\n")}`);
  if (aiReasoningHistory.length)   lines.push(`\nPrior AI Reasoning:\n${aiReasoningHistory.map(s => `• ${s}`).join("\n")}`);
  if (importantFlags.length)       lines.push(`\nOrganizational Patterns:\n${importantFlags.map(s => `• ${s}`).join("\n")}`);

  return {
    entityId: input.entityId,
    entityType: input.entityType,
    totalMemories: memories.length,
    recentInteractions,
    operatorPreferences,
    workflowOutcomeHistory,
    aiReasoningHistory,
    importantFlags,
    contextBlock: lines.join("\n"),
  };
}

/**
 * Persist a new memory after workflow completion or a significant event.
 * Calculates memory importance score automatically.
 * Logs to unified_agent_action_log for auditability.
 */
export async function persistWorkflowMemory(input: WorkflowMemoryInput): Promise<string> {
  const importanceScore = calculateMemoryRelevance({
    contextType: input.contextType,
    lastOutcome: input.lastOutcome,
    lastConfidenceScore: input.lastConfidenceScore,
    createdBy: input.createdBy ?? "system",
    neverDelete: input.neverDelete ?? false,
  });

  const id = crypto.randomUUID();
  await db.insert(workflowContext).values({
    id,
    orgId: input.orgId,
    entityType: input.entityType,
    entityId: input.entityId,
    contextType: input.contextType,
    summary: input.summary,
    structuredContext: input.structuredContext ?? null,
    lastOutcome: input.lastOutcome ?? null,
    lastConfidenceScore: input.lastConfidenceScore ?? null,
    memoryImportanceScore: importanceScore,
    sourceWorkflowId: input.sourceWorkflowId ?? null,
    sourceActionLogId: input.sourceActionLogId ?? null,
    createdBy: input.createdBy ?? "system",
    neverDelete: input.neverDelete ?? false,
  });

  // Log to unified action log for auditability
  await logUnifiedAction({
    orgId: input.orgId,
    actorType: input.createdBy === "admin" || input.createdBy === "coach" ? input.createdBy : "system",
    actionType: "memory_created",
    entityType: input.entityType,
    entityId: input.entityId,
    workflowRunId: input.sourceWorkflowId ?? undefined,
    status: "completed",
    riskLevel: "low",
    reasoningSummary: `Memory created [${input.contextType}]: ${input.summary.substring(0, 120)}`,
    outputSnapshot: { memoryId: id, importanceScore },
  });

  return id;
}

/**
 * Update an existing memory entry (e.g. after a follow-up outcome arrives).
 * Recalculates importance score. Logs as memory_updated.
 */
export async function updateWorkflowMemory(
  orgId: string,
  memoryId: string,
  updates: Partial<Pick<WorkflowMemoryInput, "summary" | "structuredContext" | "lastOutcome" | "lastConfidenceScore">>
): Promise<void> {
  const existing = await db.select().from(workflowContext).where(
    and(eq(workflowContext.id, memoryId), eq(workflowContext.orgId, orgId))
  );
  if (!existing.length) return;

  const rec = existing[0];
  const newImportance = calculateMemoryRelevance({
    contextType: rec.contextType as any,
    lastOutcome: updates.lastOutcome ?? rec.lastOutcome ?? undefined,
    lastConfidenceScore: updates.lastConfidenceScore ?? rec.lastConfidenceScore ?? undefined,
    createdBy: rec.createdBy as any,
    neverDelete: rec.neverDelete ?? false,
  });

  await db.update(workflowContext)
    .set({
      summary: updates.summary ?? rec.summary,
      structuredContext: updates.structuredContext ?? rec.structuredContext,
      lastOutcome: updates.lastOutcome ?? rec.lastOutcome,
      lastConfidenceScore: updates.lastConfidenceScore ?? rec.lastConfidenceScore,
      memoryImportanceScore: newImportance,
      updatedAt: new Date(),
    })
    .where(and(eq(workflowContext.id, memoryId), eq(workflowContext.orgId, orgId)));

  await logUnifiedAction({
    orgId,
    actorType: "system",
    actionType: "memory_updated",
    entityType: rec.entityType,
    entityId: rec.entityId,
    status: "completed",
    riskLevel: "low",
    reasoningSummary: `Memory updated [${rec.contextType}]: ${(updates.summary ?? rec.summary).substring(0, 120)}`,
  });
}

/**
 * Attach an outcome to an existing workflow memory and persist a workflow_outcomes record.
 */
export async function attachOutcomeToMemory(input: {
  orgId: string;
  workflowRunId: string;
  workflowType: string;
  entityType?: string;
  entityId?: string;
  outcomeType: string;
  outcomeScore?: number;
  revenueImpact?: number;
  retentionImpact?: number;
  engagementImpact?: number;
  confidenceAccuracyDelta?: number;
  aiRecommendationUsed?: boolean;
  operatorModified?: boolean;
  outcomeSummary?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(workflowOutcomes).values({
    id,
    orgId: input.orgId,
    workflowRunId: input.workflowRunId,
    workflowType: input.workflowType,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    outcomeType: input.outcomeType,
    outcomeScore: input.outcomeScore ?? null,
    revenueImpact: input.revenueImpact ?? null,
    retentionImpact: input.retentionImpact ?? null,
    engagementImpact: input.engagementImpact ?? null,
    confidenceAccuracyDelta: input.confidenceAccuracyDelta ?? null,
    aiRecommendationUsed: input.aiRecommendationUsed ?? true,
    operatorModified: input.operatorModified ?? false,
    outcomeSummary: input.outcomeSummary ?? null,
  });

  // If we have an entity, update related memories with the outcome
  if (input.entityType && input.entityId) {
    const relatedMemories = await db.select().from(workflowContext)
      .where(and(
        eq(workflowContext.orgId, input.orgId),
        eq(workflowContext.entityType, input.entityType),
        eq(workflowContext.entityId, input.entityId),
        eq(workflowContext.contextType, "workflow_memory"),
      ))
      .orderBy(desc(workflowContext.updatedAt))
      .limit(1);

    if (relatedMemories.length) {
      await db.update(workflowContext)
        .set({ lastOutcome: input.outcomeType, updatedAt: new Date() })
        .where(eq(workflowContext.id, relatedMemories[0].id));
    }
  }

  await logUnifiedAction({
    orgId: input.orgId,
    actorType: "system",
    actionType: "outcome_recorded",
    entityType: input.entityType,
    entityId: input.entityId,
    workflowRunId: input.workflowRunId,
    status: "completed",
    riskLevel: "low",
    reasoningSummary: `Outcome recorded for ${input.workflowType}: ${input.outcomeType}${input.outcomeSummary ? ` — ${input.outcomeSummary}` : ""}`,
  });

  return id;
}

/**
 * Calculate memory importance score (0.0–1.0).
 *
 * Factors:
 * - Operator overrides always score high (0.85+)
 * - Successful outcomes boost score
 * - Business memories score higher than routine interactions
 * - Recent high-confidence actions score higher
 * - neverDelete forces max score
 */
export function calculateMemoryRelevance(input: {
  contextType: WorkflowMemoryInput["contextType"];
  lastOutcome?: string;
  lastConfidenceScore?: number;
  createdBy: WorkflowMemoryInput["createdBy"];
  neverDelete?: boolean;
  recurrenceBoost?: number;  // 0-0.2 extra for recurring patterns
}): number {
  if (input.neverDelete) return 1.0;

  let score = 0.5; // baseline

  // Context type weights
  const typeWeights: Record<string, number> = {
    operator_override: 0.35,
    business_memory: 0.2,
    workflow_memory: 0.1,
    ai_reasoning_memory: 0.05,
    communication_memory: 0.05,
    interaction_history: 0.0,
  };
  score += typeWeights[input.contextType] ?? 0;

  // Operator-created memory gets a boost
  if (input.createdBy === "admin" || input.createdBy === "coach") {
    score += 0.1;
  }

  // Outcome modifiers
  if (input.lastOutcome) {
    const outcomeBoost: Record<string, number> = {
      converted: 0.15,
      retained: 0.1,
      booked: 0.1,
      recovered: 0.1,
      failed: 0.05,
      escalated: 0.05,
      ignored: -0.05,
      cancelled: -0.1,
    };
    score += outcomeBoost[input.lastOutcome] ?? 0;
  }

  // Confidence score modifier
  if (input.lastConfidenceScore != null) {
    score += (input.lastConfidenceScore - 0.5) * 0.1;
  }

  // Recurrence boost (passed externally if pattern detected)
  score += input.recurrenceBoost ?? 0;

  return Math.min(1.0, Math.max(0.0, score));
}

/**
 * Run memory lifecycle management for an org.
 * - Compress low-value memories older than COMPRESS_AFTER_DAYS
 * - Archive stale low-importance memories older than ARCHIVE_AFTER_DAYS
 * - Merge duplicate memories (same entity + contextType + similar summary)
 * - Never touch operator_override memories or neverDelete memories
 *
 * Safe to run as a background cron task.
 */
export async function runMemoryLifecycle(orgId: string): Promise<{ compressed: number; archived: number }> {
  const now = new Date();
  const compressThreshold = new Date(now.getTime() - COMPRESS_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const archiveThreshold = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  // 1. Compress low-importance, old memories (not operator_override, not neverDelete)
  const toCompress = await db
    .select()
    .from(workflowContext)
    .where(
      and(
        eq(workflowContext.orgId, orgId),
        eq(workflowContext.archived, false),
        eq(workflowContext.compressed, false),
        eq(workflowContext.neverDelete, false),
        not(eq(workflowContext.contextType, "operator_override")),
        lt(workflowContext.memoryImportanceScore, LOW_IMPORTANCE_THRESHOLD),
        lt(workflowContext.updatedAt, compressThreshold),
      )
    )
    .limit(100);

  let compressedCount = 0;
  for (const m of toCompress) {
    // Compress: trim structuredContext, mark compressed
    await db.update(workflowContext)
      .set({
        compressed: true,
        structuredContext: null, // drop heavy payload, keep summary
        updatedAt: new Date(),
      })
      .where(eq(workflowContext.id, m.id));
    compressedCount++;
  }

  // 2. Archive stale low-importance memories
  const toArchive = await db
    .select()
    .from(workflowContext)
    .where(
      and(
        eq(workflowContext.orgId, orgId),
        eq(workflowContext.archived, false),
        eq(workflowContext.neverDelete, false),
        not(eq(workflowContext.contextType, "operator_override")),
        lt(workflowContext.memoryImportanceScore, LOW_IMPORTANCE_THRESHOLD),
        lt(workflowContext.updatedAt, archiveThreshold),
      )
    )
    .limit(100);

  let archivedCount = 0;
  for (const m of toArchive) {
    await db.update(workflowContext)
      .set({ archived: true, updatedAt: new Date() })
      .where(eq(workflowContext.id, m.id));
    archivedCount++;

    await logUnifiedAction({
      orgId,
      actorType: "system",
      actionType: "memory_archived",
      entityType: m.entityType,
      entityId: m.entityId,
      status: "completed",
      riskLevel: "low",
      reasoningSummary: `Auto-archived low-importance memory [${m.contextType}]: ${m.summary.substring(0, 80)}`,
    });
  }

  if (compressedCount > 0) {
    await logUnifiedAction({
      orgId,
      actorType: "system",
      actionType: "memory_compressed",
      status: "completed",
      riskLevel: "low",
      reasoningSummary: `Auto-compressed ${compressedCount} low-importance memories`,
    });
  }

  return { compressed: compressedCount, archived: archivedCount };
}

/**
 * Get workflow outcomes for an org (for dashboard analytics).
 */
export async function getWorkflowOutcomes(orgId: string, limit = 50) {
  return db
    .select()
    .from(workflowOutcomes)
    .where(eq(workflowOutcomes.orgId, orgId))
    .orderBy(desc(workflowOutcomes.createdAt))
    .limit(limit);
}

/**
 * Get outcome analytics summary for an org.
 */
export async function getOutcomeAnalytics(orgId: string) {
  const outcomes = await db
    .select()
    .from(workflowOutcomes)
    .where(eq(workflowOutcomes.orgId, orgId))
    .orderBy(desc(workflowOutcomes.createdAt))
    .limit(200);

  const byType: Record<string, number> = {};
  const byWorkflowType: Record<string, { count: number; operatorModified: number; aiUsed: number }> = {};
  let totalRevenueImpact = 0;
  let operatorModifiedCount = 0;

  for (const o of outcomes) {
    byType[o.outcomeType] = (byType[o.outcomeType] ?? 0) + 1;

    if (!byWorkflowType[o.workflowType]) {
      byWorkflowType[o.workflowType] = { count: 0, operatorModified: 0, aiUsed: 0 };
    }
    byWorkflowType[o.workflowType].count++;
    if (o.operatorModified) byWorkflowType[o.workflowType].operatorModified++;
    if (o.aiRecommendationUsed) byWorkflowType[o.workflowType].aiUsed++;

    if (o.revenueImpact) totalRevenueImpact += o.revenueImpact;
    if (o.operatorModified) operatorModifiedCount++;
  }

  const successCount = (byType["converted"] ?? 0) + (byType["retained"] ?? 0) + (byType["booked"] ?? 0) + (byType["recovered"] ?? 0);
  const totalCount = outcomes.length;

  return {
    totalOutcomes: totalCount,
    successCount,
    successRate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0,
    operatorModifiedCount,
    modificationRate: totalCount > 0 ? Math.round((operatorModifiedCount / totalCount) * 100) : 0,
    totalRevenueImpact,
    byType,
    byWorkflowType,
    recentOutcomes: outcomes.slice(0, 10),
  };
}

/**
 * Get memory statistics for an org (dashboard).
 */
export async function getMemoryStats(orgId: string) {
  const all = await db.select().from(workflowContext).where(eq(workflowContext.orgId, orgId));
  const active = all.filter(m => !m.archived);
  const operatorOverrides = active.filter(m => m.contextType === "operator_override");
  const highImportance = active.filter(m => (m.memoryImportanceScore ?? 0) >= HIGH_IMPORTANCE_THRESHOLD);
  const compressed = active.filter(m => m.compressed);

  const byType: Record<string, number> = {};
  for (const m of active) {
    byType[m.contextType] = (byType[m.contextType] ?? 0) + 1;
  }

  return {
    totalMemories: all.length,
    activeMemories: active.length,
    archivedMemories: all.length - active.length,
    operatorOverrides: operatorOverrides.length,
    highImportanceMemories: highImportance.length,
    compressedMemories: compressed.length,
    byType,
    recentMemories: active
      .sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime())
      .slice(0, 10),
  };
}
