/**
 * Workflow Mapper — maps Brain/Revenue Agent action types to workflow types.
 *
 * Used by:
 *   - Business Brain recommendations  (agentType + actionType)
 *   - Revenue Agent actions            (actionType + dealId/prospectId)
 *   - Command Center API               (eligibility check + metadata)
 *   - executor.startWorkflow           (duplicate prevention)
 */

import { db } from "../db";
import { workflowRuns } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

// ─── Mapping tables ───────────────────────────────────────────────────────────

/**
 * Brain recommendation → workflow type.
 * Keyed by `${agentType}:${actionType}` — wildcards via `${agentType}:*`.
 */
const BRAIN_WORKFLOW_MAP: Record<string, string> = {
  // Retention agent — always reengage
  "retention:*":                    "reengage_inactive_client",
  "retention:urgent_client_outreach": "reengage_inactive_client",

  // Scheduling agent — fill schedule gap
  "scheduling:*":                   "fill_schedule_gap",
  "scheduling:fill_gap":            "fill_schedule_gap",
  "scheduling:match_slot_to_lead":  "fill_schedule_gap",

  // Growth agent — stalled deal recovery or schedule gap
  "growth:send_followup":           "recover_stalled_deal",
  "growth:schedule_call":           "recover_stalled_deal",
  "growth:re_engage":               "recover_stalled_deal",
  "growth:match_slot_to_lead":      "fill_schedule_gap",
  "growth:*":                       "recover_stalled_deal",

  // Client success — reengage
  "client_success:*":               "reengage_inactive_client",
  "client_success:urgent_client_outreach": "reengage_inactive_client",

  // Revenue agent brain signal
  "revenue:send_followup":          "unpaid_session_recovery",
  "revenue:schedule_call":          "recover_stalled_deal",
  "revenue:re_engage":              "recover_stalled_deal",
  "revenue:*":                      "unpaid_session_recovery",

  // Executive cross-agent signals
  "executive:urgent_client_outreach": "reengage_inactive_client",
  "executive:match_slot_to_lead":   "fill_schedule_gap",
  "executive:*":                    "reengage_inactive_client",
};

/**
 * Revenue Agent action type → workflow type.
 */
const REVENUE_ACTION_WORKFLOW_MAP: Record<string, string> = {
  send_followup:  "recover_stalled_deal",
  schedule_call:  "recover_stalled_deal",
  re_engage:      "recover_stalled_deal",
  move_stage:     "recover_stalled_deal",
  create_deal:    "onboarding_sequence",
  mark_lost:      "",  // no workflow for this
};

// ─── Metadata ─────────────────────────────────────────────────────────────────

export type WorkflowMeta = {
  workflowType: string;
  displayName: string;
  stepCount: number;
  approvalGates: number;
  estimatedDays: number;
  category: string;
};

const WORKFLOW_META: Record<string, WorkflowMeta> = {
  recover_stalled_deal: {
    workflowType: "recover_stalled_deal",
    displayName: "Recover Stalled Deal",
    stepCount: 11,
    approvalGates: 2,
    estimatedDays: 7,
    category: "sales",
  },
  reengage_inactive_client: {
    workflowType: "reengage_inactive_client",
    displayName: "Re-engage Inactive Client",
    stepCount: 9,
    approvalGates: 1,
    estimatedDays: 7,
    category: "retention",
  },
  fill_schedule_gap: {
    workflowType: "fill_schedule_gap",
    displayName: "Fill Schedule Gap",
    stepCount: 5,
    approvalGates: 1,
    estimatedDays: 2,
    category: "scheduling",
  },
  onboarding_sequence: {
    workflowType: "onboarding_sequence",
    displayName: "Client Onboarding",
    stepCount: 5,
    approvalGates: 0,
    estimatedDays: 4,
    category: "retention",
  },
  unpaid_session_recovery: {
    workflowType: "unpaid_session_recovery",
    displayName: "Unpaid Session Recovery",
    stepCount: 11,
    approvalGates: 2,
    estimatedDays: 6,
    category: "finance",
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Map a Brain recommendation to a workflow type.
 * Returns null if no workflow is applicable.
 */
export function getWorkflowTypeForRecommendation(rec: {
  agentType: string;
  actionType?: string | null;
}): string | null {
  const at = rec.actionType ?? "*";
  const specific = BRAIN_WORKFLOW_MAP[`${rec.agentType}:${at}`];
  if (specific !== undefined) return specific || null;
  const wildcard = BRAIN_WORKFLOW_MAP[`${rec.agentType}:*`];
  return wildcard || null;
}

/**
 * Map a Revenue Agent action to a workflow type.
 * Returns null if no workflow is applicable.
 */
export function getWorkflowTypeForRevenueAction(action: {
  actionType: string;
}): string | null {
  return REVENUE_ACTION_WORKFLOW_MAP[action.actionType] || null;
}

/**
 * Get display metadata for a workflow type.
 */
export function getWorkflowMeta(workflowType: string): WorkflowMeta | null {
  return WORKFLOW_META[workflowType] ?? null;
}

/**
 * Get all workflow metadata as a lookup map.
 */
export function getWorkflowMetaMap(): Record<string, WorkflowMeta> {
  return WORKFLOW_META;
}

/**
 * Check if an active workflow run already exists for this org + type + entity.
 * Used to prevent duplicate workflow starts.
 */
export async function checkWorkflowDuplicate(
  orgId: string,
  workflowType: string,
  entityId?: string | null,
): Promise<{ isDuplicate: boolean; existingRunId: string | null; existingStatus: string | null }> {
  const ACTIVE_STATUSES = ["pending", "running", "waiting_confirmation", "waiting_response"];

  const conditions = [
    eq(workflowRuns.orgId, orgId),
    eq(workflowRuns.workflowType, workflowType),
    inArray(workflowRuns.status, ACTIVE_STATUSES),
  ];

  if (entityId) {
    conditions.push(eq(workflowRuns.entityId, entityId));
  }

  const existing = await db.select({
    id: workflowRuns.id,
    status: workflowRuns.status,
  }).from(workflowRuns)
    .where(and(...conditions))
    .limit(1);

  if (existing.length > 0) {
    return { isDuplicate: true, existingRunId: existing[0].id, existingStatus: existing[0].status };
  }
  return { isDuplicate: false, existingRunId: null, existingStatus: null };
}

/**
 * Enrich a list of actions (from Brain or Revenue) with workflow eligibility metadata.
 * Returns the same list with `workflowMeta` attached to each eligible item.
 */
export function enrichActionsWithWorkflowMeta<T extends {
  actionType?: string | null;
  agentType?: string;
  entityId?: string | null;
}>(
  actions: T[],
  source: "brain" | "revenue_agent",
): Array<T & { workflowType: string | null; workflowMeta: WorkflowMeta | null }> {
  return actions.map(a => {
    let workflowType: string | null = null;
    if (source === "brain" && a.agentType) {
      workflowType = getWorkflowTypeForRecommendation({ agentType: a.agentType, actionType: a.actionType });
    } else if (source === "revenue_agent" && a.actionType) {
      workflowType = getWorkflowTypeForRevenueAction({ actionType: a.actionType });
    }
    const meta = workflowType ? getWorkflowMeta(workflowType) : null;
    return { ...a, workflowType, workflowMeta: meta };
  });
}
