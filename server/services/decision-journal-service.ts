/**
 * Decision Journal Service
 * Automatically captures every major decision across the platform into a
 * persistent, searchable, org-scoped `decision_journal_entries` table.
 *
 * Table is created lazily on first use — survives deploys and restarts.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Ensure table exists ───────────────────────────────────────────────────────

let _tableReady = false;

export async function ensureDecisionJournalTable(): Promise<void> {
  if (_tableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS decision_journal_entries (
      id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id          TEXT        NOT NULL,
      agent           TEXT        NOT NULL,
      source_type     TEXT        NOT NULL,
      source          TEXT        NOT NULL,
      decision        TEXT        NOT NULL,
      reasoning       TEXT        NOT NULL DEFAULT '',
      outcome         TEXT        NOT NULL DEFAULT '',
      follow_up       TEXT        NOT NULL DEFAULT '',
      confidence      INTEGER     NOT NULL DEFAULT 75,
      decision_type   TEXT        NOT NULL DEFAULT 'action',
      department      TEXT        NOT NULL DEFAULT 'Operations',
      related_entity_type TEXT    DEFAULT NULL,
      related_entity_id   TEXT    DEFAULT NULL,
      metadata        JSONB       DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_decision_journal_org_id    ON decision_journal_entries(org_id);
    CREATE INDEX IF NOT EXISTS idx_decision_journal_source_type ON decision_journal_entries(source_type);
    CREATE INDEX IF NOT EXISTS idx_decision_journal_agent     ON decision_journal_entries(agent);
    CREATE INDEX IF NOT EXISTS idx_decision_journal_created_at ON decision_journal_entries(created_at DESC);
  `).catch(() => {});
  _tableReady = true;
}

// ─── Core types ────────────────────────────────────────────────────────────────

export interface DecisionEntry {
  id: string;
  orgId: string;
  agent: string;
  sourceType: string;
  source: string;
  decision: string;
  reasoning: string;
  outcome: string;
  followUp: string;
  confidence: number;
  decisionType: string;
  department: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface RecordDecisionInput {
  orgId: string;
  agent: string;
  sourceType: "workflow" | "gmail" | "ceo_heartbeat" | "executive_agent" | "revenue_agent" | "business_brain" | "customer_success" | "scheduling" | "reply_classification" | "human_admin" | "recommendation" | string;
  source: string;
  decision: string;
  reasoning?: string;
  outcome?: string;
  followUp?: string;
  confidence?: number;
  decisionType?: "approval" | "rejection" | "edit_approval" | "recommendation" | "execution" | "action" | "scheduling" | "manual" | string;
  department?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: Record<string, any>;
}

// ─── Core write ────────────────────────────────────────────────────────────────

export async function recordDecision(input: RecordDecisionInput): Promise<string | null> {
  try {
    await ensureDecisionJournalTable();
    const id = `dj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.execute(sql`
      INSERT INTO decision_journal_entries (
        id, org_id, agent, source_type, source, decision, reasoning, outcome,
        follow_up, confidence, decision_type, department,
        related_entity_type, related_entity_id, metadata
      ) VALUES (
        ${id},
        ${input.orgId},
        ${input.agent},
        ${input.sourceType},
        ${input.source},
        ${input.decision},
        ${input.reasoning ?? ""},
        ${input.outcome ?? ""},
        ${input.followUp ?? ""},
        ${input.confidence ?? 75},
        ${input.decisionType ?? "action"},
        ${input.department ?? "Operations"},
        ${input.relatedEntityType ?? null},
        ${input.relatedEntityId ?? null},
        ${JSON.stringify(input.metadata ?? {})}
      )
    `);

    // Kevin event wire-in (Phase 3) — non-blocking, fail-open
    void (async () => {
      try {
        const { enqueueKevinEvent } = await import("./kevin-event-service");
        await enqueueKevinEvent({
          orgId: input.orgId,
          eventType: "te.decision.recorded",
          entityType: "decision_journal_entry",
          entityId: id,
          idempotencyKey: `te.decision.recorded:${input.orgId}:${id}`,
          payload: {
            agent: input.agent,
            sourceType: input.sourceType,
            decisionType: input.decisionType ?? "action",
            department: input.department ?? "Operations",
            confidence: input.confidence ?? 75,
            decision: (input.decision ?? "").slice(0, 200),
          },
          source: "decision_journal",
        });
      } catch {}
    })();

    return id;
  } catch (err) {
    console.error("[decision-journal] recordDecision error:", err);
    return null;
  }
}

// ─── Reads ─────────────────────────────────────────────────────────────────────

export async function getDecisions(opts: {
  orgId?: string;
  sourceType?: string;
  agent?: string;
  decisionType?: string;
  limit?: number;
  offset?: number;
}): Promise<DecisionEntry[]> {
  try {
    await ensureDecisionJournalTable();
    const { orgId, sourceType, agent, decisionType, limit = 100, offset = 0 } = opts;
    const rows = await db.execute(sql`
      SELECT * FROM decision_journal_entries
      WHERE 1=1
        ${orgId ? sql`AND org_id = ${orgId}` : sql``}
        ${sourceType ? sql`AND source_type = ${sourceType}` : sql``}
        ${agent ? sql`AND agent = ${agent}` : sql``}
        ${decisionType ? sql`AND decision_type = ${decisionType}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const rawRows = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return rawRows.map(mapRow);
  } catch {
    return [];
  }
}

export async function searchDecisions(q: string, orgId?: string, limit = 30): Promise<DecisionEntry[]> {
  try {
    await ensureDecisionJournalTable();
    const pattern = `%${q.toLowerCase()}%`;
    const rows = await db.execute(sql`
      SELECT * FROM decision_journal_entries
      WHERE 1=1
        ${orgId ? sql`AND org_id = ${orgId}` : sql``}
        AND (
          LOWER(decision) LIKE ${pattern}
          OR LOWER(reasoning) LIKE ${pattern}
          OR LOWER(outcome) LIKE ${pattern}
          OR LOWER(agent) LIKE ${pattern}
          OR LOWER(source) LIKE ${pattern}
          OR LOWER(source_type) LIKE ${pattern}
          OR LOWER(department) LIKE ${pattern}
        )
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rawRows = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return rawRows.map(mapRow);
  } catch {
    return [];
  }
}

export async function countDecisions(orgId?: string): Promise<number> {
  try {
    await ensureDecisionJournalTable();
    const rows = await db.execute(sql`
      SELECT COUNT(*)::integer AS cnt FROM decision_journal_entries
      ${orgId ? sql`WHERE org_id = ${orgId}` : sql``}
    `);
    const rawRows = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return Number(rawRows[0]?.cnt ?? 0);
  } catch {
    return 0;
  }
}

export async function getDecisionStats(orgId?: string): Promise<{
  total: number;
  agentDecisions: number;
  humanDecisions: number;
  approvalCount: number;
  rejectionCount: number;
  bySourceType: Record<string, number>;
  byAgent: Record<string, number>;
  byDecisionType: Record<string, number>;
  avgConfidence: number;
  last7DaysCount: number;
}> {
  try {
    await ensureDecisionJournalTable();
    const rows = await db.execute(sql`
      SELECT
        COUNT(*)::integer                                              AS total,
        COUNT(*) FILTER (WHERE source_type != 'human_admin')::integer AS agent_decisions,
        COUNT(*) FILTER (WHERE source_type  = 'human_admin')::integer AS human_decisions,
        COUNT(*) FILTER (WHERE decision_type IN ('approval','edit_approval'))::integer AS approval_count,
        COUNT(*) FILTER (WHERE decision_type = 'rejection')::integer  AS rejection_count,
        ROUND(AVG(confidence))::integer                               AS avg_confidence,
        COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::integer AS last7
      FROM decision_journal_entries
      ${orgId ? sql`WHERE org_id = ${orgId}` : sql``}
    `);
    const rawRows = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    const r = rawRows[0] ?? {};

    // bySourceType
    const stRows = await db.execute(sql`
      SELECT source_type, COUNT(*)::integer AS cnt
      FROM decision_journal_entries
      ${orgId ? sql`WHERE org_id = ${orgId}` : sql``}
      GROUP BY source_type ORDER BY cnt DESC
    `);
    const stRaw = Array.isArray(stRows) ? stRows : (stRows as any).rows ?? [];
    const bySourceType: Record<string, number> = {};
    stRaw.forEach((s: any) => { bySourceType[s.source_type] = Number(s.cnt); });

    // byAgent
    const agRows = await db.execute(sql`
      SELECT agent, COUNT(*)::integer AS cnt
      FROM decision_journal_entries
      ${orgId ? sql`WHERE org_id = ${orgId}` : sql``}
      GROUP BY agent ORDER BY cnt DESC
    `);
    const agRaw = Array.isArray(agRows) ? agRows : (agRows as any).rows ?? [];
    const byAgent: Record<string, number> = {};
    agRaw.forEach((a: any) => { byAgent[a.agent] = Number(a.cnt); });

    // byDecisionType
    const dtRows = await db.execute(sql`
      SELECT decision_type, COUNT(*)::integer AS cnt
      FROM decision_journal_entries
      ${orgId ? sql`WHERE org_id = ${orgId}` : sql``}
      GROUP BY decision_type ORDER BY cnt DESC
    `);
    const dtRaw = Array.isArray(dtRows) ? dtRows : (dtRows as any).rows ?? [];
    const byDecisionType: Record<string, number> = {};
    dtRaw.forEach((d: any) => { byDecisionType[d.decision_type] = Number(d.cnt); });

    return {
      total: Number(r.total ?? 0),
      agentDecisions: Number(r.agent_decisions ?? 0),
      humanDecisions: Number(r.human_decisions ?? 0),
      approvalCount: Number(r.approval_count ?? 0),
      rejectionCount: Number(r.rejection_count ?? 0),
      avgConfidence: Number(r.avg_confidence ?? 75),
      last7DaysCount: Number(r.last7 ?? 0),
      bySourceType,
      byAgent,
      byDecisionType,
    };
  } catch {
    return { total: 0, agentDecisions: 0, humanDecisions: 0, approvalCount: 0, rejectionCount: 0, avgConfidence: 75, last7DaysCount: 0, bySourceType: {}, byAgent: {}, byDecisionType: {} };
  }
}

// ─── Row mapper ────────────────────────────────────────────────────────────────

function mapRow(r: any): DecisionEntry {
  return {
    id: r.id,
    orgId: r.org_id,
    agent: r.agent,
    sourceType: r.source_type,
    source: r.source,
    decision: r.decision,
    reasoning: r.reasoning ?? "",
    outcome: r.outcome ?? "",
    followUp: r.follow_up ?? "",
    confidence: Number(r.confidence ?? 75),
    decisionType: r.decision_type ?? "action",
    department: r.department ?? "Operations",
    relatedEntityType: r.related_entity_type ?? null,
    relatedEntityId: r.related_entity_id ?? null,
    metadata: (() => { try { return typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata ?? {}); } catch { return {}; } })(),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? new Date().toISOString()),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at ?? new Date().toISOString()),
  };
}

// ─── Convenience wrappers ──────────────────────────────────────────────────────

export async function recordWorkflowDecision(opts: {
  orgId: string;
  workflowId: string;
  workflowType: string;
  displayName?: string;
  status: "approved" | "rejected";
  feedback?: string;
  editedDraft?: boolean;
}): Promise<void> {
  const isApproval = opts.status === "approved";
  const name = opts.displayName ?? opts.workflowType.replace(/_/g, " ");
  await recordDecision({
    orgId: opts.orgId,
    agent: "Workflow Engine",
    sourceType: "workflow",
    source: `Workflow: ${name}`,
    decision: isApproval
      ? `Approved workflow: "${name}"${opts.editedDraft ? " (with edits)" : ""}`
      : `Rejected workflow: "${name}"`,
    reasoning: isApproval
      ? opts.editedDraft ? "Admin approved with content edits before sending." : "Admin reviewed and approved for execution."
      : `Admin rejected workflow.${opts.feedback ? ` Feedback: ${opts.feedback}` : ""}`,
    outcome: isApproval ? "Workflow queued for execution." : "Workflow blocked — not executed.",
    followUp: isApproval ? "Monitor execution result." : opts.feedback ? "Address feedback before re-attempting." : "Review conditions and retry if appropriate.",
    confidence: isApproval ? 90 : 85,
    decisionType: isApproval ? (opts.editedDraft ? "edit_approval" : "approval") : "rejection",
    department: "Operations",
    relatedEntityType: "workflow_run",
    relatedEntityId: opts.workflowId,
    metadata: { workflowType: opts.workflowType, feedback: opts.feedback ?? null, editedDraft: opts.editedDraft ?? false },
  });
}

export async function recordGmailDecision(opts: {
  orgId: string;
  actionId: string;
  actionType: string;
  decision: "approved" | "rejected" | "edited_and_approved";
  communicationDomain?: string;
  reason?: string;
  subject?: string;
}): Promise<void> {
  const decisionLabel =
    opts.decision === "approved" ? "Approved" :
    opts.decision === "rejected" ? "Rejected" :
    "Edited and approved";
  const domain = opts.communicationDomain?.replace(/_/g, " ") ?? "outreach";
  await recordDecision({
    orgId: opts.orgId,
    agent: "AgentMail",
    sourceType: "gmail",
    source: `AgentMail: ${domain}`,
    decision: `${decisionLabel} ${opts.actionType?.replace(/_/g, " ")} draft${opts.subject ? ` — "${opts.subject.slice(0, 60)}"` : ""}`,
    reasoning:
      opts.decision === "approved" ? "Reviewer confirmed draft meets quality and relevance standards." :
      opts.decision === "rejected" ? `Reviewer rejected draft.${opts.reason ? ` Reason: ${opts.reason}` : ""}` :
      "Reviewer edited content before approving — subject or body was modified.",
    outcome:
      opts.decision === "approved" ? "Draft approved and queued for sending." :
      opts.decision === "rejected" ? "Draft blocked — will not be sent." :
      "Edited draft approved and queued for sending.",
    followUp:
      opts.decision === "rejected" ? "Review draft quality for this domain — consider adjusting templates." :
      opts.decision === "edited_and_approved" ? "Learning applied — editing pattern captured for future drafts." :
      "Monitor delivery and reply rate.",
    confidence: opts.decision === "rejected" ? 95 : 88,
    decisionType: opts.decision === "rejected" ? "rejection" : opts.decision === "edited_and_approved" ? "edit_approval" : "approval",
    department: "Revenue",
    relatedEntityType: "gmail_agent_action",
    relatedEntityId: opts.actionId,
    metadata: { actionType: opts.actionType, communicationDomain: opts.communicationDomain ?? null, reason: opts.reason ?? null },
  });
}

export async function recordHeartbeatDecision(opts: {
  orgId: string;
  agentsCoordinated: number;
  prioritiesGenerated: number;
  errors: string[];
  durationMs: number;
  runId: string;
  topPriority?: string;
}): Promise<void> {
  const hasErrors = opts.errors.length > 0;
  await recordDecision({
    orgId: opts.orgId,
    agent: "CEO Heartbeat",
    sourceType: "ceo_heartbeat",
    source: "CEO Heartbeat Cycle",
    decision: `Ran heartbeat cycle — coordinated ${opts.agentsCoordinated} agents, generated ${opts.prioritiesGenerated} priorities${opts.topPriority ? `, top: "${opts.topPriority}"` : ""}`,
    reasoning: `Automated heartbeat cycle completed in ${Math.round(opts.durationMs / 1000)}s.${hasErrors ? ` ${opts.errors.length} error(s) detected.` : " All agents coordinated cleanly."}`,
    outcome: hasErrors ? `Completed with ${opts.errors.length} agent error(s): ${opts.errors.slice(0, 2).join("; ")}` : `Successfully coordinated ${opts.agentsCoordinated} agents with ${opts.prioritiesGenerated} priorities generated.`,
    followUp: hasErrors ? "Review error agents and resolve blocking issues." : "Next heartbeat will re-evaluate all agent priorities.",
    confidence: hasErrors ? 65 : 92,
    decisionType: "recommendation",
    department: "Operations",
    relatedEntityType: "heartbeat_run",
    relatedEntityId: opts.runId,
    metadata: { agentsCoordinated: opts.agentsCoordinated, prioritiesGenerated: opts.prioritiesGenerated, errors: opts.errors, durationMs: opts.durationMs },
  });
}

export async function recordRecommendationDecision(opts: {
  orgId: string;
  recommendationId: string;
  action: "approve" | "reject" | "execute" | "dismiss" | "schedule";
  title?: string;
  description?: string;
  agentType?: string;
  estimatedImpact?: number;
  source?: string;
}): Promise<void> {
  const agentLabel = opts.agentType?.replace(/_/g, " ") ?? "Executive Agent";
  const titleText = opts.title ?? "Untitled recommendation";
  const actionLabel =
    opts.action === "approve" ? "Approved" :
    opts.action === "reject" ? "Rejected" :
    opts.action === "execute" ? "Executed" :
    opts.action === "schedule" ? "Scheduled" :
    "Dismissed";
  await recordDecision({
    orgId: opts.orgId,
    agent: agentLabel,
    sourceType: opts.source ?? "recommendation",
    source: `${agentLabel} Recommendation`,
    decision: `${actionLabel} recommendation: "${titleText}"`,
    reasoning: opts.description
      ? `Agent reasoning: ${opts.description.slice(0, 300)}`
      : `${agentLabel} recommendation was ${actionLabel.toLowerCase()} by operator.`,
    outcome: opts.action === "execute" || opts.action === "approve"
      ? `Recommendation accepted and queued for execution.${opts.estimatedImpact ? ` Estimated impact: $${opts.estimatedImpact.toLocaleString()}.` : ""}`
      : opts.action === "reject" || opts.action === "dismiss"
      ? "Recommendation dismissed — not executed."
      : `Recommendation scheduled for later execution.`,
    followUp: opts.action === "execute" || opts.action === "approve"
      ? "Monitor execution outcome and record results."
      : opts.action === "reject" ? "Consider reviewing conditions under which this recommendation was made."
      : "Check scheduled execution time.",
    confidence: opts.action === "execute" || opts.action === "approve" ? 85 : 80,
    decisionType: opts.action === "execute" || opts.action === "approve" ? "execution" : opts.action === "reject" || opts.action === "dismiss" ? "rejection" : "recommendation",
    department: "Operations",
    relatedEntityType: "recommendation",
    relatedEntityId: opts.recommendationId,
    metadata: { agentType: opts.agentType, estimatedImpact: opts.estimatedImpact ?? null },
  });
}

export async function recordReplyClassificationDecision(opts: {
  orgId: string;
  prospectId: string;
  classification: string;
}): Promise<void> {
  const classLabel = opts.classification.replace(/_/g, " ");
  await recordDecision({
    orgId: opts.orgId,
    agent: "Reply Intelligence",
    sourceType: "reply_classification",
    source: "Reply Classification Engine",
    decision: `Classified prospect reply as: "${classLabel}"`,
    reasoning: `AI classified inbound reply from prospect ${opts.prospectId.slice(0, 8)} as "${classLabel}" based on content analysis.`,
    outcome: opts.classification === "interested" || opts.classification === "ask_info"
      ? "Deal pipeline entry triggered — discovery call sequence initiated."
      : `Reply classified as "${classLabel}" — appropriate follow-up sequence selected.`,
    followUp: opts.classification === "interested" ? "Schedule discovery call within 24 hours." : opts.classification === "not_interested" ? "Remove from active outreach — log for future re-engagement window." : "Send requested information and follow up in 48 hours.",
    confidence: 85,
    decisionType: "action",
    department: "Revenue",
    relatedEntityType: "team_training_prospect",
    relatedEntityId: opts.prospectId,
    metadata: { classification: opts.classification },
  });
}
