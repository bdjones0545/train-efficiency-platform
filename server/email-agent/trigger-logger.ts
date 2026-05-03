import { storage } from "../storage";
import type { InsertEmailTriggerEvent, EmailTriggerEvent } from "@shared/schema";

export type TriggerType = "daily_outreach" | "follow_up_cron" | "auto_execution" | "manual" | "system_event";
export type TriggerSource = "cron_8_30am" | "hourly_follow_up_cron" | "auto_exec_hook" | "user_click" | "api_call";
export type TriggerActionType = "send_initial_email" | "send_follow_up" | "generate_draft" | "send_response";
export type BlockReason =
  | "DNC"
  | "OPTED_OUT"
  | "COOLDOWN_ACTIVE"
  | "DAILY_LIMIT_REACHED"
  | "AUTO_EXEC_LIMIT_REACHED"
  | "LOW_CONFIDENCE"
  | "HIGH_RISK"
  | "MISSING_EMAIL"
  | "DUPLICATE_CONTACT"
  | "INVALID_STAGE"
  | "DEAL_ACTIVE_BLOCK"
  | "AGENT_DISABLED"
  | "NO_ELIGIBLE_PROSPECTS";

export interface TriggerLogInput {
  organizationId: string;
  prospectId?: string;
  prospectName?: string;
  outreachDraftId?: string;
  followUpId?: string;
  triggerType: TriggerType;
  triggerSource: TriggerSource;
  actionType: TriggerActionType;
  reasoning?: string;
  confidenceLevel?: string;
  riskScore?: number;
  priorityScore?: number;
}

export interface TriggerOutcome {
  wasExecuted: boolean;
  executionBlocked: boolean;
  blockReason?: BlockReason;
  reasoning?: string;
  outreachDraftId?: string;
  followUpId?: string;
  missedOpportunity?: boolean;
}

/**
 * Log a trigger event BEFORE execution decision.
 * Returns the event id so you can call updateTriggerEvent() after.
 */
export async function logTriggerEvent(input: TriggerLogInput): Promise<string> {
  try {
    const event = await storage.createEmailTriggerEvent({
      organizationId: input.organizationId,
      prospectId: input.prospectId,
      prospectName: input.prospectName,
      outreachDraftId: input.outreachDraftId,
      followUpId: input.followUpId,
      triggerType: input.triggerType,
      triggerSource: input.triggerSource,
      actionType: input.actionType,
      wasExecuted: false,
      executionBlocked: false,
      reasoning: input.reasoning,
      confidenceLevel: input.confidenceLevel,
      riskScore: input.riskScore,
      priorityScore: input.priorityScore,
    });
    return event.id;
  } catch (err: any) {
    console.warn("[TriggerLogger] logTriggerEvent failed:", err.message);
    return "";
  }
}

/**
 * Update a trigger event AFTER execution decision with the outcome.
 */
export async function updateTriggerEvent(
  eventId: string,
  outcome: TriggerOutcome
): Promise<void> {
  if (!eventId) return;
  try {
    await storage.updateEmailTriggerEvent(eventId, {
      wasExecuted: outcome.wasExecuted,
      executionBlocked: outcome.executionBlocked,
      blockReason: outcome.blockReason,
      reasoning: outcome.reasoning,
      outreachDraftId: outcome.outreachDraftId,
      followUpId: outcome.followUpId,
      missedOpportunity: outcome.missedOpportunity ?? false,
    });
  } catch (err: any) {
    console.warn("[TriggerLogger] updateTriggerEvent failed:", err.message);
  }
}

/**
 * Detect if the same prospect is being triggered by multiple sources within a short window.
 * Returns collision details if detected, null otherwise.
 */
export async function detectTriggerCollision(
  orgId: string,
  prospectId: string,
  windowMinutes = 5
): Promise<string | null> {
  try {
    const events = await storage.getEmailTriggerEvents(orgId, {
      sinceMinutes: windowMinutes,
      prospectId,
    });
    if (events.length >= 2) {
      const sources = [...new Set(events.map((e) => e.triggerSource))];
      if (sources.length >= 2) {
        return `Collision: prospect triggered by ${sources.join(" + ")} within ${windowMinutes}min`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a short trigger-history context string for a specific prospect.
 * Used by the email agent to factor in recent blocks/collisions before execution.
 */
export async function buildTriggerContextForProspect(orgId: string, prospectId: string): Promise<string> {
  try {
    const events = await storage.getEmailTriggerEvents(orgId, { prospectId, sinceMinutes: 60 * 24 * 7 });
    if (events.length === 0) return "";
    const blocked = events.filter((e) => e.executionBlocked);
    const executed = events.filter((e) => e.wasExecuted);
    const blockReasons = [...new Set(blocked.map((e) => e.blockReason).filter(Boolean))];
    const collisions = events.filter((e) => e.collisionDetected);
    const parts: string[] = [];
    if (executed.length > 0) parts.push(`${executed.length} sent`);
    if (blocked.length > 0) parts.push(`${blocked.length} blocked (${blockReasons.join(", ")})`);
    if (collisions.length > 0) parts.push(`${collisions.length} collision(s)`);
    return parts.length > 0 ? `[TriggerHistory/7d: ${parts.join("; ")}]` : "";
  } catch {
    return "";
  }
}

export async function logMissedOpportunity(input: TriggerLogInput, reason: BlockReason): Promise<void> {
  try {
    await storage.createEmailTriggerEvent({
      organizationId: input.organizationId,
      prospectId: input.prospectId,
      prospectName: input.prospectName,
      triggerType: input.triggerType,
      triggerSource: input.triggerSource,
      actionType: input.actionType,
      wasExecuted: false,
      executionBlocked: true,
      blockReason: reason,
      reasoning: input.reasoning ?? "Missed opportunity: action was due but not executed",
      missedOpportunity: true,
    });
  } catch (err: any) {
    console.warn("[TriggerLogger] logMissedOpportunity failed:", err.message);
  }
}
