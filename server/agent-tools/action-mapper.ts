/**
 * Agent Action → Tool Proposal Mapper
 * Maps Brain recommendations and Revenue Agent actions to concrete tool proposals.
 * Pure functions — no DB access, fully testable.
 */

import type { ProposeToolCallInput } from "./runtime";

type BrainRec = {
  id: string;
  agentType: string;
  actionType: string | null;
  title: string;
  description: string | null;
  reason: string | null;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  estimatedImpact: number | null;
  priorityScore: number | null;
};

type RevenueAction = {
  id: string;
  actionType: string;
  reason: string | null;
  estimatedValue: number | null;
  dealId: string | null;
  prospectId: string | null;
  metadata: Record<string, any> | null;
};

// ─── Tomorrow helper ──────────────────────────────────────────────────────────

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function nextWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

// ─── Draft email subject/body builder ────────────────────────────────────────

function buildDraftInput(
  draftType: string,
  context: {
    entityName?: string | null;
    title: string;
    reason?: string | null;
    description?: string | null;
    entityId?: string | null;
    prospectId?: string | null;
    dealId?: string | null;
  }
): Record<string, any> {
  const name = context.entityName ?? "Coach";
  const detail = context.description ?? context.reason ?? context.title;

  const subjectMap: Record<string, string> = {
    re_engage: `Checking in — ${name}`,
    outreach: `Partnership opportunity for ${name}`,
    follow_up: `Following up — ${name}`,
    proposal: `Proposal for ${name}`,
    general: `Next steps — ${name}`,
  };

  const bodyMap: Record<string, string> = {
    re_engage: `Hi ${name},\n\nI wanted to reach out and check in. ${detail}\n\nWould love to reconnect — are you available for a quick call this week?\n\nBest,`,
    outreach: `Hi ${name},\n\nI hope you're doing well. ${detail}\n\nWe'd love to explore how we can support your program. Would you be open to a brief conversation?\n\nBest,`,
    follow_up: `Hi ${name},\n\nJust following up on our previous conversation. ${detail}\n\nPlease let me know if you have any questions or would like to move forward.\n\nBest,`,
    proposal: `Hi ${name},\n\nAs discussed, I'm following up with next steps. ${detail}\n\nLet me know when you'd like to connect.\n\nBest,`,
    general: `Hi ${name},\n\n${detail}\n\nLooking forward to hearing from you.\n\nBest,`,
  };

  return {
    subject: subjectMap[draftType] ?? subjectMap.general,
    body: bodyMap[draftType] ?? bodyMap.general,
    draftType,
    prospectId: context.prospectId ?? (context.entityType === "lead" || context.entityType === "prospect" ? context.entityId ?? undefined : undefined) ?? undefined,
    dealId: context.dealId ?? (context.entityType === "deal" ? context.entityId ?? undefined : undefined) ?? undefined,
    recipientName: context.entityName ?? undefined,
  };
}

// ─── Brain Recommendation → Tool Proposal ────────────────────────────────────

export function mapBrainRecToToolProposal(
  rec: BrainRec
): Omit<ProposeToolCallInput, "agentName"> | null {
  const base = {
    targetType: rec.entityType ?? undefined,
    targetId: rec.entityId ?? undefined,
    targetName: rec.entityName ?? undefined,
    reason: rec.description ?? rec.reason ?? rec.title,
    confidence: rec.priorityScore ? rec.priorityScore / 100 : 0.7,
    estimatedImpact: rec.estimatedImpact ?? undefined,
    sourceRecommendationId: rec.id,
  };

  // ── Retention Agent ──────────────────────────────────────────────────────
  if (rec.agentType === "retention") {
    if (rec.actionType === "send_reengagement" || rec.actionType?.includes("re_engage") || rec.actionType?.includes("reengag")) {
      return {
        ...base,
        toolName: "create_email_draft",
        proposedInput: buildDraftInput("re_engage", {
          entityName: rec.entityName,
          title: rec.title,
          reason: rec.reason,
          description: rec.description,
          entityId: rec.entityId,
          entityType: rec.entityType,
        }),
      };
    }
    if (rec.actionType === "renewal_outreach" || rec.actionType?.includes("renewal")) {
      return {
        ...base,
        toolName: "create_email_draft",
        proposedInput: buildDraftInput("outreach", {
          entityName: rec.entityName,
          title: rec.title,
          reason: rec.reason,
          description: rec.description,
          entityId: rec.entityId,
        }),
      };
    }
    // Default retention → follow-up task
    return {
      ...base,
      toolName: "create_follow_up_task",
      proposedInput: {
        prospectId: rec.entityType === "client" ? undefined : (rec.entityId ?? undefined),
        followUpDate: tomorrow(),
        note: rec.description ?? rec.title,
        priority: "high",
      },
    };
  }

  // ── Scheduling Agent ─────────────────────────────────────────────────────
  if (rec.agentType === "scheduling") {
    if (rec.actionType === "fill_schedule_gap" || rec.actionType?.includes("schedule") || rec.actionType?.includes("slot")) {
      return {
        ...base,
        toolName: "create_follow_up_task",
        proposedInput: {
          followUpDate: tomorrow(),
          note: `Schedule gap opportunity: ${rec.title}. ${rec.description ?? ""}`.trim(),
          priority: "medium",
        },
      };
    }
    return {
      ...base,
      toolName: "create_follow_up_task",
      proposedInput: { followUpDate: tomorrow(), note: rec.title, priority: "medium" },
    };
  }

  // ── Growth Agent ─────────────────────────────────────────────────────────
  if (rec.agentType === "growth") {
    if (rec.actionType === "followup_hot_lead" || rec.actionType?.includes("follow") || rec.actionType?.includes("lead")) {
      return {
        ...base,
        toolName: "create_email_draft",
        proposedInput: buildDraftInput("follow_up", {
          entityName: rec.entityName,
          title: rec.title,
          reason: rec.reason,
          description: rec.description,
          entityId: rec.entityId,
          entityType: rec.entityType,
        }),
      };
    }
    if (rec.actionType === "revive_stalled_deal" || rec.actionType?.includes("stall") || rec.actionType?.includes("deal")) {
      if (rec.entityId && (rec.entityType === "deal")) {
        return {
          ...base,
          toolName: "create_follow_up_task",
          proposedInput: {
            dealId: rec.entityId,
            followUpDate: tomorrow(),
            note: `Revive stalled deal: ${rec.title}. ${rec.description ?? ""}`.trim(),
            priority: "high",
          },
        };
      }
      return {
        ...base,
        toolName: "create_follow_up_task",
        proposedInput: { followUpDate: tomorrow(), note: `Stalled deal: ${rec.title}`, priority: "high" },
      };
    }
    // expand_lead_source or other growth actions
    return {
      ...base,
      toolName: "create_follow_up_task",
      proposedInput: { followUpDate: nextWeek(), note: rec.title, priority: "low" },
    };
  }

  // ── Client Success Agent ──────────────────────────────────────────────────
  if (rec.agentType === "client_success") {
    if (rec.actionType === "client_checkin" || rec.actionType?.includes("checkin") || rec.actionType?.includes("check")) {
      return {
        ...base,
        toolName: "create_follow_up_task",
        proposedInput: {
          followUpDate: tomorrow(),
          note: `Client check-in: ${rec.title}. ${rec.description ?? ""}`.trim(),
          priority: "medium",
        },
      };
    }
    if (rec.entityId) {
      return {
        ...base,
        toolName: "log_activity",
        proposedInput: {
          dealId: rec.entityId,
          activityType: "note",
          summary: `Client success action: ${rec.title}. ${rec.description ?? rec.reason ?? ""}`.trim(),
        },
      };
    }
    return {
      ...base,
      toolName: "create_follow_up_task",
      proposedInput: { followUpDate: tomorrow(), note: rec.title, priority: "medium" },
    };
  }

  // ── Revenue / Executive Agent ─────────────────────────────────────────────
  if (rec.agentType === "revenue" || rec.agentType === "executive") {
    return {
      ...base,
      toolName: "create_email_draft",
      proposedInput: buildDraftInput("follow_up", {
        entityName: rec.entityName,
        title: rec.title,
        reason: rec.reason,
        description: rec.description,
        entityId: rec.entityId,
        entityType: rec.entityType,
      }),
    };
  }

  // Fallback — follow-up task for anything unrecognized
  return {
    ...base,
    toolName: "create_follow_up_task",
    proposedInput: { followUpDate: tomorrow(), note: rec.title, priority: "medium" },
  };
}

// ─── Revenue Action → Tool Proposal ──────────────────────────────────────────

export function mapRevenueActionToToolProposal(
  action: RevenueAction
): Omit<ProposeToolCallInput, "agentName"> | null {
  const base = {
    targetType: action.dealId ? "deal" : action.prospectId ? "lead" : undefined,
    targetId: action.dealId ?? action.prospectId ?? undefined,
    targetName: (action.metadata as any)?.prospectName ?? (action.metadata as any)?.dealName ?? undefined,
    reason: action.reason ?? undefined,
    confidence: 0.8,
    estimatedImpact: action.estimatedValue ?? undefined,
    sourceRevenueActionId: action.id,
  };

  const entityName = base.targetName;

  switch (action.actionType) {
    case "send_followup":
    case "re_engage":
      return {
        ...base,
        toolName: "create_email_draft",
        proposedInput: buildDraftInput(
          action.actionType === "re_engage" ? "re_engage" : "follow_up",
          {
            entityName,
            title: action.reason ?? "Follow-up",
            reason: action.reason,
            prospectId: action.prospectId ?? undefined,
            dealId: action.dealId ?? undefined,
          }
        ),
      };

    case "schedule_call":
      return {
        ...base,
        toolName: "create_follow_up_task",
        proposedInput: {
          prospectId: action.prospectId ?? undefined,
          dealId: action.dealId ?? undefined,
          followUpDate: tomorrow(),
          note: `Schedule call: ${action.reason ?? "Revenue Agent recommendation"}`,
          priority: "high",
        },
      };

    case "move_stage":
      if (!action.dealId) return null;
      return {
        ...base,
        toolName: "update_deal_stage",
        proposedInput: {
          dealId: action.dealId,
          newStage: "negotiation",
          note: action.reason ?? "Revenue Agent: stage advance",
        },
      };

    case "mark_lost":
      if (!action.dealId) return null;
      return {
        ...base,
        toolName: "update_deal_stage",
        proposedInput: {
          dealId: action.dealId,
          newStage: "closed_lost",
          note: action.reason ?? "Revenue Agent: marked lost (stale)",
        },
      };

    case "create_deal":
      return {
        ...base,
        toolName: "create_follow_up_task",
        proposedInput: {
          prospectId: action.prospectId ?? undefined,
          followUpDate: tomorrow(),
          note: `Create deal: ${action.reason ?? "Revenue Agent: hot lead ready for deal"}`,
          priority: "high",
        },
      };

    default:
      return {
        ...base,
        toolName: "create_follow_up_task",
        proposedInput: {
          prospectId: action.prospectId ?? undefined,
          dealId: action.dealId ?? undefined,
          followUpDate: tomorrow(),
          note: action.reason ?? action.actionType,
          priority: "medium",
        },
      };
  }
}
