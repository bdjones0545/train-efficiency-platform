/**
 * Cross-Agent Coordination canonical state and audit service.
 * Future callers establish durable coordination before downstream effects.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  type CoordinationIdentityInput,
  deriveCanonicalCoordinationIdentity,
} from "../coordination-identity";
import { validateCrossAgentCoordinationSchema } from "../cross-agent-coordination-schema-validation";

export interface CoordinationRequest extends CoordinationIdentityInput {
  agentName: string;
  metadata?: Record<string, unknown>;
}

export type CoordinationResolutionRequest = CoordinationIdentityInput;

export type CoordinationDecision =
  | { action: "created"; actionId: string; supportScore: number }
  | { action: "deduplicated"; actionId: string; supportScore: number }
  | { action: "merged"; actionId: string; supportScore: number };

export class CoordinationEntryNotFoundError extends Error {
  constructor() {
    super("active coordination entry not found");
    this.name = "CoordinationEntryNotFoundError";
  }
}

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

/** Atomically create or join one active canonical action. */
export async function checkCoordination(
  req: CoordinationRequest,
  sourceActionId?: string,
): Promise<CoordinationDecision> {
  await validateCrossAgentCoordinationSchema();
  const identity = deriveCanonicalCoordinationIdentity({
    ...req,
    sourceActionId: sourceActionId ?? req.sourceActionId,
  });
  if (identity.orgId.toLowerCase() === "default") throw new Error("orgId is unavailable");
  const agentName = req.agentName.trim();
  if (!agentName) throw new Error("agentName is required");

  return db.transaction(async tx => {
    const result = rows(await tx.execute(sql`
      INSERT INTO agent_action_registry (
        id,org_id,action_type,gmail_thread_id,source_conversation_id,prospect_id,lead_id,
        canonical_resource_type,canonical_resource_id,coordination_generation,
        status,support_score,source_agents,last_agent,source_action_id
      ) VALUES (
        gen_random_uuid()::text,${identity.orgId},${identity.actionType},${req.gmailThreadId ?? null},
        ${req.sourceConversationId ?? null},${req.prospectId ?? null},${req.leadId ?? null},
        ${identity.resourceType},${identity.resourceId},${identity.coordinationGeneration},
        'active',1,ARRAY[${agentName}]::text[],${agentName},${sourceActionId ?? req.sourceActionId ?? null}
      )
      ON CONFLICT (org_id,action_type,canonical_resource_type,canonical_resource_id,coordination_generation)
        WHERE status='active'
      DO UPDATE SET
        source_agents=CASE
          WHEN EXCLUDED.last_agent=ANY(agent_action_registry.source_agents) THEN agent_action_registry.source_agents
          ELSE array_append(agent_action_registry.source_agents,EXCLUDED.last_agent)
        END,
        support_score=cardinality(CASE
          WHEN EXCLUDED.last_agent=ANY(agent_action_registry.source_agents) THEN agent_action_registry.source_agents
          ELSE array_append(agent_action_registry.source_agents,EXCLUDED.last_agent)
        END),
        last_agent=EXCLUDED.last_agent,
        updated_at=NOW()
      RETURNING id,support_score,(xmax=0) created
    `))[0];
    if (!result?.id) throw new Error("canonical coordination registration returned no row");

    const supportScore = Number(result.support_score);
    const created = result.created === true;
    const action = created ? "created" : supportScore > 2 ? "merged" : "deduplicated";
    await tx.execute(sql`
      INSERT INTO coordination_decisions (
        org_id,action_type,gmail_thread_id,source_conversation_id,prospect_id,lead_id,
        canonical_resource_type,canonical_resource_id,coordination_generation,registry_id,
        decision,original_action_id,support_score,requesting_agent,metadata
      ) VALUES (
        ${identity.orgId},${identity.actionType},${req.gmailThreadId ?? null},${req.sourceConversationId ?? null},
        ${req.prospectId ?? null},${req.leadId ?? null},${identity.resourceType},${identity.resourceId},
        ${identity.coordinationGeneration},${String(result.id)},${action},
        ${created ? null : String(result.id)},${supportScore},${agentName},${JSON.stringify(req.metadata ?? {})}::jsonb
      )
    `);
    return { action, actionId: String(result.id), supportScore } as CoordinationDecision;
  });
}

/** Resolve exactly one tenant-scoped canonical identity and generation. */
export async function resolveCoordinationEntry(req: CoordinationResolutionRequest): Promise<string> {
  await validateCrossAgentCoordinationSchema();
  const identity = deriveCanonicalCoordinationIdentity(req);
  const result = rows(await db.execute(sql`
    UPDATE agent_action_registry SET status='resolved',updated_at=NOW()
    WHERE org_id=${identity.orgId} AND action_type=${identity.actionType}
      AND canonical_resource_type=${identity.resourceType} AND canonical_resource_id=${identity.resourceId}
      AND coordination_generation=${identity.coordinationGeneration} AND status='active'
    RETURNING id
  `));
  if (!result[0]?.id) throw new CoordinationEntryNotFoundError();
  return String(result[0].id);
}

export async function getCoordinationStats(orgId: string): Promise<{
  totalDecisions: number;
  duplicatesPrevented: number;
  mergedActions: number;
  activeInRegistry: number;
  preventionRate: number;
}> {
  await validateCrossAgentCoordinationSchema();
  const decisionRows = rows(await db.execute(sql`
    SELECT COUNT(*) total,
      SUM(CASE WHEN decision='deduplicated' THEN 1 ELSE 0 END) deduplicated,
      SUM(CASE WHEN decision='merged' THEN 1 ELSE 0 END) merged
    FROM coordination_decisions WHERE org_id=${orgId}
  `));
  const activeRows = rows(await db.execute(sql`
    SELECT COUNT(*) cnt FROM agent_action_registry WHERE org_id=${orgId} AND status='active'
  `));
  const total = Number(decisionRows[0]?.total ?? 0);
  const deduplicated = Number(decisionRows[0]?.deduplicated ?? 0);
  const merged = Number(decisionRows[0]?.merged ?? 0);
  return {
    totalDecisions: total,
    duplicatesPrevented: deduplicated + merged,
    mergedActions: merged,
    activeInRegistry: Number(activeRows[0]?.cnt ?? 0),
    preventionRate: total ? Math.round(((deduplicated + merged) / total) * 100) : 0,
  };
}
