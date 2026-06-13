/**
 * Unified Action Queue — Sprint 2
 *
 * Single read aggregation layer over all action queues in the system:
 *   - gmail_agent_actions          (proposed drafts awaiting approval)
 *   - autonomous_action_queue      (pending / awaiting_review items)
 *   - agent_pending_actions        (expiring approvals)
 *
 * Returns normalized objects for consistent API consumption.
 * This is a READ-ONLY service — it never modifies any queue.
 */

import { db } from "../db";
import { sql, eq, and, or, gt, inArray } from "drizzle-orm";
import { gmailAgentActions, agentPendingActions } from "@shared/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UnifiedSourceSystem =
  | "gmail_agent_actions"
  | "autonomous_action_queue"
  | "agent_pending_actions";

export interface UnifiedActionItem {
  id: string;
  sourceSystem: UnifiedSourceSystem;
  sourceAgent: string;
  type: string;
  title: string;
  description?: string;
  confidence: number;       // 0–100
  approvalRequired: boolean;
  status: string;
  priority: number;         // 1 = highest
  gmailThreadId?: string;
  sourceConversationId?: string;
  sourceRecordId?: string;
  recommendationReason?: string;
  draftPreview?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  metadata?: Record<string, any>;
}

export interface UnifiedQueueOptions {
  status?: string[];
  sourceSystem?: UnifiedSourceSystem[];
  limit?: number;
  offset?: number;
  minConfidence?: number;
}

export interface UnifiedQueueResult {
  items: UnifiedActionItem[];
  totals: {
    gmailActions: number;
    autonomousActions: number;
    pendingActions: number;
    total: number;
  };
  generatedAt: string;
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchGmailActions(orgId: string, limit: number): Promise<UnifiedActionItem[]> {
  try {
    const rows = await db
      .select({
        id: gmailAgentActions.id,
        actionType: gmailAgentActions.actionType,
        gmailThreadId: gmailAgentActions.gmailThreadId,
        leadId: gmailAgentActions.leadId,
        status: gmailAgentActions.status,
        draftContent: gmailAgentActions.draftContent,
        subject: gmailAgentActions.subject,
        toEmail: gmailAgentActions.toEmail,
        fromEmail: gmailAgentActions.fromEmail,
        createdAt: gmailAgentActions.createdAt,
        updatedAt: gmailAgentActions.updatedAt,
      })
      .from(gmailAgentActions)
      .where(
        and(
          eq(gmailAgentActions.orgId, orgId),
          or(
            eq(gmailAgentActions.status, "proposed"),
            eq(gmailAgentActions.status, "draft_created"),
          ),
        ),
      )
      .orderBy(gmailAgentActions.createdAt)
      .limit(limit)
      .catch(() => []);

    return rows.map((r) => ({
      id: r.id,
      sourceSystem: "gmail_agent_actions" as const,
      sourceAgent: "gmail_agent",
      type: r.actionType ?? "email_draft",
      title: r.subject ? `Draft: "${r.subject}"` : `Email draft to ${r.toEmail ?? "unknown"}`,
      description: r.draftContent?.slice(0, 200),
      confidence: 75,
      approvalRequired: true,
      status: r.status ?? "proposed",
      priority: 2,
      gmailThreadId: r.gmailThreadId ?? undefined,
      draftPreview: r.draftContent?.slice(0, 500),
      metadata: { toEmail: r.toEmail, fromEmail: r.fromEmail, leadId: r.leadId },
      createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: r.updatedAt?.toISOString() ?? new Date().toISOString(),
    }));
  } catch (e: any) {
    console.warn("[UnifiedQueue] Gmail actions fetch error:", e?.message);
    return [];
  }
}

async function fetchAutonomousActions(orgId: string, statusFilter: string[], limit: number): Promise<UnifiedActionItem[]> {
  try {
    const allowedStatuses = statusFilter.length > 0 ? statusFilter : ["pending", "awaiting_review"];
    const rows = await db.execute(sql`
      SELECT id, decision_type, agent_type, action, description, confidence,
             risk_level, status, source_system, source_action_id,
             source_conversation_id, gmail_thread_id,
             created_at, updated_at
      FROM autonomous_action_queue
      WHERE org_id = ${orgId}
        AND status = ANY(${allowedStatuses}::text[])
      ORDER BY created_at ASC
      LIMIT ${limit}
    `).catch(() => ({ rows: [] }));

    const r: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

    return r.map((row) => {
      const conf = Number(row.confidence ?? 0);
      return {
        id: row.id,
        sourceSystem: "autonomous_action_queue" as const,
        sourceAgent: row.agent_type ?? row.source_system ?? "autonomy_engine",
        type: row.decision_type ?? "autonomous_action",
        title: row.action ?? "Pending action",
        description: row.description,
        confidence: conf,
        approvalRequired: true,
        status: row.status,
        priority: row.status === "awaiting_review" ? 1 : 3,
        gmailThreadId: row.gmail_thread_id ?? undefined,
        sourceConversationId: row.source_conversation_id ?? undefined,
        sourceRecordId: row.source_action_id ?? undefined,
        recommendationReason: row.description,
        metadata: {
          riskLevel: row.risk_level,
          sourceSystem: row.source_system,
          decisionType: row.decision_type,
        },
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
      };
    });
  } catch (e: any) {
    console.warn("[UnifiedQueue] Autonomous actions fetch error:", e?.message);
    return [];
  }
}

async function fetchAgentPendingActions(orgId: string, limit: number): Promise<UnifiedActionItem[]> {
  try {
    const now = new Date();
    const rows = await db
      .select({
        id: agentPendingActions.id,
        actionType: agentPendingActions.actionType,
        actionData: agentPendingActions.actionData,
        status: agentPendingActions.status,
        expiresAt: agentPendingActions.expiresAt,
        createdAt: agentPendingActions.createdAt,
      })
      .from(agentPendingActions)
      .where(
        and(
          eq(agentPendingActions.orgId, orgId),
          eq(agentPendingActions.status, "pending"),
          gt(agentPendingActions.expiresAt, now),
        ),
      )
      .limit(limit)
      .catch(() => []);

    return rows.map((r) => {
      const data = r.actionData as Record<string, any> | null;
      return {
        id: r.id,
        sourceSystem: "agent_pending_actions" as const,
        sourceAgent: r.actionType ?? "scheduling_agent",
        type: r.actionType ?? "pending_action",
        title: data?.description ?? data?.action ?? `Pending ${r.actionType ?? "action"}`,
        confidence: 70,
        approvalRequired: true,
        status: r.status ?? "pending",
        priority: 2,
        metadata: data ?? {},
        expiresAt: r.expiresAt?.toISOString(),
        createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
        updatedAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
      };
    });
  } catch (e: any) {
    console.warn("[UnifiedQueue] Agent pending actions fetch error:", e?.message);
    return [];
  }
}

// ─── Count queries ────────────────────────────────────────────────────────────

async function countQueue(orgId: string): Promise<{
  gmailActions: number;
  autonomousActions: number;
  pendingActions: number;
}> {
  const [g, a, p] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as cnt FROM gmail_agent_actions WHERE org_id = ${orgId} AND status IN ('proposed','draft_created')`).catch(() => ({ rows: [] })),
    db.execute(sql`SELECT COUNT(*) as cnt FROM autonomous_action_queue WHERE org_id = ${orgId} AND status IN ('pending','awaiting_review')`).catch(() => ({ rows: [] })),
    db.execute(sql`SELECT COUNT(*) as cnt FROM agent_pending_actions WHERE org_id = ${orgId} AND status = 'pending' AND expires_at > NOW()`).catch(() => ({ rows: [] })),
  ]);
  const gRows: any[] = Array.isArray(g) ? g : (g as any).rows ?? [];
  const aRows: any[] = Array.isArray(a) ? a : (a as any).rows ?? [];
  const pRows: any[] = Array.isArray(p) ? p : (p as any).rows ?? [];

  return {
    gmailActions: Number(gRows[0]?.cnt ?? 0),
    autonomousActions: Number(aRows[0]?.cnt ?? 0),
    pendingActions: Number(pRows[0]?.cnt ?? 0),
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function getUnifiedActionQueue(
  orgId: string,
  opts: UnifiedQueueOptions = {},
): Promise<UnifiedQueueResult> {
  const limit = opts.limit ?? 100;
  const perSourceLimit = Math.ceil(limit / 3);
  const statusFilter = opts.status ?? [];
  const systems = opts.sourceSystem ?? ["gmail_agent_actions", "autonomous_action_queue", "agent_pending_actions"];

  const [gmailItems, autonomousItems, pendingItems, counts] = await Promise.all([
    systems.includes("gmail_agent_actions")
      ? fetchGmailActions(orgId, perSourceLimit)
      : Promise.resolve([]),
    systems.includes("autonomous_action_queue")
      ? fetchAutonomousActions(orgId, statusFilter, perSourceLimit)
      : Promise.resolve([]),
    systems.includes("agent_pending_actions")
      ? fetchAgentPendingActions(orgId, perSourceLimit)
      : Promise.resolve([]),
    countQueue(orgId),
  ]);

  let all: UnifiedActionItem[] = [...gmailItems, ...autonomousItems, ...pendingItems];

  if (opts.minConfidence != null) {
    all = all.filter((i) => i.confidence >= opts.minConfidence!);
  }

  all.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const offset = opts.offset ?? 0;
  const items = all.slice(offset, offset + limit);

  return {
    items,
    totals: {
      ...counts,
      total: counts.gmailActions + counts.autonomousActions + counts.pendingActions,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Single item context builder ─────────────────────────────────────────────

export interface ActionItemContext {
  item: UnifiedActionItem;
  sourceSystem: UnifiedSourceSystem;
  conversation?: Record<string, any> | null;
  workflow?: Record<string, any> | null;
  auditHistory?: Record<string, any>[];
  hermesRecommendation?: Record<string, any> | null;
  relatedActions?: UnifiedActionItem[];
}

export async function getActionContext(
  orgId: string,
  actionId: string,
): Promise<ActionItemContext | null> {
  let item: UnifiedActionItem | null = null;

  const [gmailRow, autonomousRows, pendingRow] = await Promise.all([
    db
      .select()
      .from(gmailAgentActions)
      .where(and(eq(gmailAgentActions.id, actionId), eq(gmailAgentActions.orgId, orgId)))
      .limit(1)
      .catch(() => []),
    db
      .execute(
        sql`SELECT * FROM autonomous_action_queue WHERE id = ${actionId} AND org_id = ${orgId}`,
      )
      .catch(() => ({ rows: [] })),
    db
      .select()
      .from(agentPendingActions)
      .where(and(eq(agentPendingActions.id, actionId), eq(agentPendingActions.orgId, orgId)))
      .limit(1)
      .catch(() => []),
  ]);

  const aRows: any[] = Array.isArray(autonomousRows) ? autonomousRows : (autonomousRows as any).rows ?? [];

  if (gmailRow[0]) {
    const r = gmailRow[0] as any;
    item = {
      id: r.id,
      sourceSystem: "gmail_agent_actions",
      sourceAgent: "gmail_agent",
      type: r.actionType ?? "email_draft",
      title: r.subject ? `Draft: "${r.subject}"` : `Email draft to ${r.toEmail}`,
      description: r.draftContent?.slice(0, 200),
      confidence: 75,
      approvalRequired: true,
      status: r.status,
      priority: 2,
      gmailThreadId: r.gmailThreadId,
      draftPreview: r.draftContent,
      metadata: { toEmail: r.toEmail, fromEmail: r.fromEmail, leadId: r.leadId },
      createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: r.updatedAt?.toISOString() ?? new Date().toISOString(),
    };
  } else if (aRows[0]) {
    const r = aRows[0];
    item = {
      id: r.id,
      sourceSystem: "autonomous_action_queue",
      sourceAgent: r.agent_type ?? "autonomy_engine",
      type: r.decision_type,
      title: r.action,
      description: r.description,
      confidence: Number(r.confidence ?? 0),
      approvalRequired: true,
      status: r.status,
      priority: r.status === "awaiting_review" ? 1 : 3,
      gmailThreadId: r.gmail_thread_id,
      sourceConversationId: r.source_conversation_id,
      sourceRecordId: r.source_action_id,
      recommendationReason: r.description,
      metadata: { riskLevel: r.risk_level, sourceSystem: r.source_system },
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    };
  } else if (pendingRow[0]) {
    const r = pendingRow[0] as any;
    const data = r.actionData as Record<string, any> | null;
    item = {
      id: r.id,
      sourceSystem: "agent_pending_actions",
      sourceAgent: r.actionType,
      type: r.actionType,
      title: data?.description ?? `Pending ${r.actionType}`,
      confidence: 70,
      approvalRequired: true,
      status: r.status,
      priority: 2,
      metadata: data ?? {},
      expiresAt: r.expiresAt?.toISOString(),
      createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  if (!item) return null;

  const [conversation, auditHistory, hermesRec] = await Promise.all([
    item.sourceConversationId || item.gmailThreadId
      ? db
          .execute(
            sql`SELECT * FROM gmail_conversations
                WHERE org_id = ${orgId}
                  AND (id = ${item.sourceConversationId ?? null}
                    OR gmail_thread_id = ${item.gmailThreadId ?? null})
                LIMIT 1`,
          )
          .catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),

    db
      .execute(
        sql`SELECT action_type, status, created_at, error_message
            FROM gmail_agent_actions
            WHERE org_id = ${orgId} AND gmail_thread_id = ${item.gmailThreadId ?? ""}
            ORDER BY created_at DESC LIMIT 10`,
      )
      .catch(() => ({ rows: [] })),

    item.sourceRecordId
      ? db
          .execute(
            sql`SELECT * FROM hermes_recommendations WHERE id = ${item.sourceRecordId} LIMIT 1`,
          )
          .catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
  ]);

  const convRows: any[] = Array.isArray(conversation) ? conversation : (conversation as any).rows ?? [];
  const auditRows: any[] = Array.isArray(auditHistory) ? auditHistory : (auditHistory as any).rows ?? [];
  const hermesRows: any[] = Array.isArray(hermesRec) ? hermesRec : (hermesRec as any).rows ?? [];

  return {
    item,
    sourceSystem: item.sourceSystem,
    conversation: convRows[0] ?? null,
    workflow: null,
    auditHistory: auditRows,
    hermesRecommendation: hermesRows[0] ?? null,
    relatedActions: [],
  };
}
