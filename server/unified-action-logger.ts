import { storage } from "./storage";
import type { InsertUnifiedAgentActionLog } from "@shared/schema";

export async function logUnifiedAction(entry: Omit<InsertUnifiedAgentActionLog, "createdAt">): Promise<void> {
  try {
    await storage.logUnifiedAction({
      actorType: "system",
      status: "completed",
      riskLevel: "low",
      rollbackAvailable: false,
      ...entry,
    });
  } catch (err) {
    console.error("[UnifiedActionLogger] Failed to log action:", err);
  }
}

export async function logWorkflowAction(
  orgId: string,
  opts: {
    workflowRunId?: string;
    actionType: string;
    entityType?: string;
    entityId?: string;
    status: "started" | "completed" | "failed" | "skipped" | "requires_approval";
    actorType?: "agent" | "system" | "admin" | "coach";
    actorName?: string;
    toolName?: string;
    confidenceScore?: number;
    riskLevel?: "low" | "medium" | "high" | "critical";
    reasoningSummary?: string;
    errorMessage?: string;
    inputSnapshot?: Record<string, any>;
    outputSnapshot?: Record<string, any>;
  }
): Promise<void> {
  await logUnifiedAction({ orgId, ...opts });
}

export async function logAgentToolExecution(
  orgId: string,
  opts: {
    toolName: string;
    agentName?: string;
    workflowRunId?: string;
    status: "started" | "completed" | "failed" | "skipped" | "requires_approval";
    entityType?: string;
    entityId?: string;
    confidenceScore?: number;
    riskLevel?: "low" | "medium" | "high" | "critical";
    reasoningSummary?: string;
    errorMessage?: string;
    inputSnapshot?: Record<string, any>;
    outputSnapshot?: Record<string, any>;
  }
): Promise<void> {
  await logUnifiedAction({
    orgId,
    actorType: "agent",
    actorName: opts.agentName,
    actionType: `tool:${opts.toolName}`,
    toolName: opts.toolName,
    workflowRunId: opts.workflowRunId,
    status: opts.status,
    entityType: opts.entityType,
    entityId: opts.entityId,
    confidenceScore: opts.confidenceScore,
    riskLevel: opts.riskLevel ?? "low",
    reasoningSummary: opts.reasoningSummary,
    errorMessage: opts.errorMessage,
    inputSnapshot: opts.inputSnapshot,
    outputSnapshot: opts.outputSnapshot,
  });
}

export async function logAttentionItem(
  orgId: string,
  opts: {
    title: string;
    level: "critical" | "important" | "suggested" | "informational";
    sourceId?: string;
    reasoningSummary?: string;
  }
): Promise<void> {
  await logUnifiedAction({
    orgId,
    actorType: "system",
    actionType: "attention_item:created",
    status: "requires_approval",
    riskLevel: opts.level === "critical" ? "high" : opts.level === "important" ? "medium" : "low",
    entityId: opts.sourceId,
    reasoningSummary: opts.reasoningSummary ?? opts.title,
  });
}

export async function logBusinessBrainRun(
  orgId: string,
  opts: {
    status: "completed" | "failed";
    signalsCreated?: number;
    recommendationsCreated?: number;
    errorMessage?: string;
  }
): Promise<void> {
  await logUnifiedAction({
    orgId,
    actorType: "agent",
    actorName: "Business Brain",
    actionType: "business_brain:run",
    status: opts.status,
    riskLevel: "low",
    reasoningSummary: opts.status === "completed"
      ? `Generated ${opts.signalsCreated ?? 0} signals and ${opts.recommendationsCreated ?? 0} recommendations`
      : undefined,
    errorMessage: opts.errorMessage,
  });
}
