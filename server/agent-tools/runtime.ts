/**
 * Agent Tool Runtime
 * Central execution engine: validate → check permissions → execute → log.
 * All agents MUST use this to call tools — never call implementations directly.
 */

import { db } from "../db";
import { agentToolCalls } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getTool, TOOL_REGISTRY } from "./registry";
import { TOOL_IMPLEMENTATIONS } from "./implementations";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProposeToolCallInput = {
  agentName: string;
  toolName: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  proposedInput: Record<string, any>;
  reason?: string;
  confidence?: number;
  estimatedImpact?: number;
};

export type ToolExecutionResult = {
  success: boolean;
  toolCallId: string;
  requiresConfirmation: boolean;
  pendingConfirmation?: boolean;
  result?: Record<string, any>;
  error?: string;
  message: string;
};

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateToolInput(
  toolName: string,
  input: Record<string, any>
): { valid: boolean; error?: string; parsed?: Record<string, any> } {
  const tool = getTool(toolName);
  if (!tool) return { valid: false, error: `Unknown tool: ${toolName}` };

  const result = tool.inputSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    return { valid: false, error: `${first.path.join(".")}: ${first.message}` };
  }
  return { valid: true, parsed: result.data };
}

// ─── Propose (creates a pending confirmation record) ─────────────────────────

export async function proposeToolCall(
  orgId: string,
  proposal: ProposeToolCallInput
): Promise<ToolExecutionResult> {
  const tool = getTool(proposal.toolName);
  if (!tool) {
    return { success: false, toolCallId: "", requiresConfirmation: false, message: `Unknown tool: ${proposal.toolName}` };
  }

  const validation = validateToolInput(proposal.toolName, proposal.proposedInput);
  if (!validation.valid) {
    return { success: false, toolCallId: "", requiresConfirmation: false, message: `Validation failed: ${validation.error}` };
  }

  const requiresConfirmation = tool.permissions.requires_confirmation && !tool.permissions.safe_auto_execute;
  const inputSummary = buildInputSummary(proposal.toolName, proposal.proposedInput);

  const [record] = await db.insert(agentToolCalls).values({
    orgId,
    agentName: proposal.agentName,
    toolName: proposal.toolName,
    targetType: proposal.targetType ?? null,
    targetId: proposal.targetId ?? null,
    targetName: proposal.targetName ?? null,
    inputSummary,
    proposedInput: validation.parsed ?? proposal.proposedInput,
    reason: proposal.reason ?? null,
    confidence: proposal.confidence ?? null,
    estimatedImpact: proposal.estimatedImpact ?? null,
    requiresConfirmation,
    confirmationStatus: requiresConfirmation ? "pending" : "auto",
    status: requiresConfirmation ? "pending_confirmation" : "pending",
  }).returning();

  if (!requiresConfirmation) {
    return executePendingToolCall(orgId, record.id, "system");
  }

  return {
    success: true,
    toolCallId: record.id,
    requiresConfirmation: true,
    pendingConfirmation: true,
    message: `Tool call proposed — waiting for admin confirmation: ${proposal.toolName}`,
  };
}

// ─── Execute (used after confirmation or for auto-execute tools) ──────────────

export async function executePendingToolCall(
  orgId: string,
  toolCallId: string,
  confirmedBy: string
): Promise<ToolExecutionResult> {
  const [record] = await db.select().from(agentToolCalls)
    .where(and(eq(agentToolCalls.id, toolCallId), eq(agentToolCalls.orgId, orgId)));

  if (!record) {
    return { success: false, toolCallId, requiresConfirmation: false, message: "Tool call record not found" };
  }

  await db.update(agentToolCalls)
    .set({ status: "executing", confirmedAt: new Date(), confirmedBy })
    .where(eq(agentToolCalls.id, toolCallId));

  const impl = TOOL_IMPLEMENTATIONS[record.toolName];
  if (!impl) {
    await db.update(agentToolCalls)
      .set({ status: "failed", error: `No implementation for tool: ${record.toolName}` })
      .where(eq(agentToolCalls.id, toolCallId));
    return { success: false, toolCallId, requiresConfirmation: false, message: `No implementation for: ${record.toolName}` };
  }

  const start = Date.now();
  try {
    const result = await impl(orgId, record.proposedInput as Record<string, any>);
    const ms = Date.now() - start;

    await db.update(agentToolCalls)
      .set({
        status: result.success ? "success" : "failed",
        result: result.data ?? { message: result.message },
        error: result.success ? null : result.message,
        executionTimeMs: ms,
        executedAt: new Date(),
      })
      .where(eq(agentToolCalls.id, toolCallId));

    return {
      success: result.success,
      toolCallId,
      requiresConfirmation: false,
      result: result.data,
      message: result.message,
    };
  } catch (e: any) {
    const ms = Date.now() - start;
    await db.update(agentToolCalls)
      .set({ status: "failed", error: e.message, executionTimeMs: ms, executedAt: new Date() })
      .where(eq(agentToolCalls.id, toolCallId));
    return { success: false, toolCallId, requiresConfirmation: false, error: e.message, message: e.message };
  }
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectToolCall(
  orgId: string,
  toolCallId: string,
  rejectedBy: string
): Promise<void> {
  await db.update(agentToolCalls)
    .set({ status: "rejected", confirmationStatus: "rejected", confirmedAt: new Date(), confirmedBy: rejectedBy })
    .where(and(eq(agentToolCalls.id, toolCallId), eq(agentToolCalls.orgId, orgId)));
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getPendingToolCalls(orgId: string) {
  return db.select().from(agentToolCalls)
    .where(and(eq(agentToolCalls.orgId, orgId), eq(agentToolCalls.confirmationStatus, "pending")))
    .orderBy(desc(agentToolCalls.createdAt));
}

export async function getToolCallAuditLog(orgId: string, limit = 50) {
  return db.select().from(agentToolCalls)
    .where(eq(agentToolCalls.orgId, orgId))
    .orderBy(desc(agentToolCalls.createdAt))
    .limit(limit);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildInputSummary(toolName: string, input: Record<string, any>): string {
  switch (toolName) {
    case "send_email":
    case "create_email_draft":
      return `To: ${input.to ?? input.recipientEmail ?? "—"} | Subject: ${input.subject}`;
    case "send_sms":
    case "create_sms_draft":
      return `To: ${input.to ?? input.recipientPhone ?? "—"} | "${String(input.body ?? "").slice(0, 80)}"`;
    case "update_deal_stage":
      return `Deal ${input.dealId?.slice(-6)} → ${input.newStage}`;
    case "update_lead_status":
      return `Prospect ${input.prospectId?.slice(-6)} → ${input.newStatus}`;
    case "log_activity":
      return `${input.activityType}: ${String(input.summary ?? "").slice(0, 80)}`;
    case "create_follow_up_task":
      return `Follow-up on ${input.followUpDate} ${input.note ? `| ${input.note}` : ""}`;
    case "create_invoice":
      return `Client ${input.clientId?.slice(-6)} — $${((input.amountCents ?? 0) / 100).toFixed(2)}: ${input.description}`;
    case "record_payment":
      return `Client ${input.clientId?.slice(-6)} — $${((input.amountCents ?? 0) / 100).toFixed(2)} via ${input.paymentMethod}`;
    case "book_session":
    case "cancel_session":
    case "reschedule_session":
      return `Booking ${input.bookingId?.slice(-6) ?? "—"} | ${input.reason ?? input.newStartIso ?? ""}`;
    case "create_calendar_event":
      return `"${input.title}" at ${input.startIso}`;
    default:
      return Object.entries(input).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" | ");
  }
}
