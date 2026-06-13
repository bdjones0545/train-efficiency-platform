/**
 * Hermes Learning Service — Automatic Learning Capture
 *
 * DB-backed learning store that survives deploys.  Every system event that
 * represents a decision, outcome, error, or resolution can call
 * recordHermesLearning() to persist a structured entry.
 *
 * Entries land in:
 *   - hermes_auto_learnings table (source of truth, survives redeploys)
 *   - agent_operating_timeline  (timeline view in CEO Heartbeat)
 *   - Obsidian "Hermes Learning" folder (if configured, best-effort)
 *
 * The organisational-memory routes merge these DB entries with the static
 * seed array so every dashboard tab reflects live captured learnings.
 */

import { db } from "../db";
import { sql, eq, desc, or, ilike, and } from "drizzle-orm";

// ─── Table bootstrap ──────────────────────────────────────────────────────────

let _tableReady = false;

export async function ensureHermesLearningsTable(): Promise<void> {
  if (_tableReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS hermes_auto_learnings (
        id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        org_id              TEXT NOT NULL,
        domain              TEXT NOT NULL DEFAULT 'general',
        metric              TEXT,
        delta               TEXT,
        outcome             TEXT NOT NULL,
        observation         TEXT NOT NULL,
        learning            TEXT NOT NULL,
        source              TEXT NOT NULL DEFAULT 'system',
        memory_type         TEXT NOT NULL DEFAULT 'lesson',
        department          TEXT NOT NULL DEFAULT 'Operations',
        category            TEXT NOT NULL DEFAULT 'System',
        confidence_score    INTEGER NOT NULL DEFAULT 80,
        impact_score        INTEGER NOT NULL DEFAULT 70,
        related_entity_type TEXT,
        related_entity_id   TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_org       ON hermes_auto_learnings (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_domain    ON hermes_auto_learnings (domain)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_source    ON hermes_auto_learnings (source)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_created   ON hermes_auto_learnings (created_at DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_mtype     ON hermes_auto_learnings (memory_type)`);
    _tableReady = true;
  } catch (e: any) {
    console.warn("[HermesLearning] Table setup warning:", e?.message);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HermesLearningInput {
  orgId: string;
  domain: string;
  metric?: string;
  delta?: string;
  outcome: string;
  observation: string;
  learning: string;
  source: string;
  memoryType?: "lesson" | "decision" | "insight" | "outcome" | "research" | "playbook" | "policy";
  department?: string;
  category?: string;
  confidenceScore?: number;
  impactScore?: number;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface HermesLearningRecord {
  id: string;
  orgId: string;
  domain: string;
  metric: string | null;
  delta: string | null;
  outcome: string;
  observation: string;
  learning: string;
  source: string;
  memoryType: string;
  department: string;
  category: string;
  confidenceScore: number;
  impactScore: number;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Core write ───────────────────────────────────────────────────────────────

/**
 * Record a Hermes auto-learning from any system event.
 * Fire-and-forget safe — never throws.
 */
export async function recordHermesLearning(input: HermesLearningInput): Promise<string | null> {
  try {
    await ensureHermesLearningsTable();

    const {
      orgId, domain, metric, delta,
      outcome, observation, learning, source,
      memoryType = "lesson",
      department = "Operations",
      category = "System",
      confidenceScore = 80,
      impactScore = 70,
      relatedEntityType,
      relatedEntityId,
    } = input;

    const result = await db.execute(sql`
      INSERT INTO hermes_auto_learnings (
        org_id, domain, metric, delta,
        outcome, observation, learning, source,
        memory_type, department, category,
        confidence_score, impact_score,
        related_entity_type, related_entity_id
      ) VALUES (
        ${orgId}, ${domain}, ${metric ?? null}, ${delta ?? null},
        ${outcome}, ${observation}, ${learning}, ${source},
        ${memoryType}, ${department}, ${category},
        ${confidenceScore}, ${impactScore},
        ${relatedEntityType ?? null}, ${relatedEntityId ?? null}
      )
      RETURNING id
    `);

    const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    const id: string = rows[0]?.id ?? null;

    // Fire-and-forget: also write to timeline and Obsidian (non-blocking)
    setImmediate(async () => {
      try {
        const { writeTimeline } = await import("./ceo-heartbeat-service");
        await writeTimeline({
          orgId,
          agentName: "Hermes Learning Engine",
          systemName: "Hermes",
          actionType: `hermes_learning_${source.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
          actionStatus: "completed",
          priority: 2,
          summary: `[Hermes] Learning captured — ${domain}: ${outcome.slice(0, 120)}`,
          metadata: { source, domain, metric, delta, relatedEntityType, relatedEntityId, learningId: id },
        });
      } catch {}

      try {
        const { recordOutcomeLearning } = await import("./obsidian-service");
        await recordOutcomeLearning({
          outcome,
          observation,
          learning,
          domain,
          metric,
          metricValue: delta ?? undefined,
          orgId,
          tags: [source, domain, memoryType],
        });
      } catch {}
    });

    console.log(`[HermesLearning] ✓ Captured — source=${source} domain=${domain} id=${id}`);
    return id;
  } catch (err: any) {
    console.warn("[HermesLearning] Failed to record learning:", err?.message);
    return null;
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getHermesLearnings(opts: {
  orgId?: string;
  limit?: number;
  offset?: number;
  source?: string;
  domain?: string;
  memoryType?: string;
} = {}): Promise<HermesLearningRecord[]> {
  try {
    await ensureHermesLearningsTable();
    const { orgId, limit = 100, offset = 0, source, domain, memoryType } = opts;

    const rows = await db.execute(sql`
      SELECT
        id, org_id, domain, metric, delta,
        outcome, observation, learning, source,
        memory_type, department, category,
        confidence_score, impact_score,
        related_entity_type, related_entity_id,
        created_at, updated_at
      FROM hermes_auto_learnings
      WHERE 1=1
        ${orgId ? sql`AND org_id = ${orgId}` : sql``}
        ${source ? sql`AND source = ${source}` : sql``}
        ${domain ? sql`AND domain = ${domain}` : sql``}
        ${memoryType ? sql`AND memory_type = ${memoryType}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const data = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
    return data.map((r: any) => ({
      id: r.id,
      orgId: r.org_id,
      domain: r.domain,
      metric: r.metric,
      delta: r.delta,
      outcome: r.outcome,
      observation: r.observation,
      learning: r.learning,
      source: r.source,
      memoryType: r.memory_type,
      department: r.department,
      category: r.category,
      confidenceScore: Number(r.confidence_score),
      impactScore: Number(r.impact_score),
      relatedEntityType: r.related_entity_type,
      relatedEntityId: r.related_entity_id,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    }));
  } catch (err: any) {
    console.warn("[HermesLearning] getHermesLearnings error:", err?.message);
    return [];
  }
}

export async function searchHermesLearnings(query: string, orgId?: string, limit = 20): Promise<HermesLearningRecord[]> {
  try {
    await ensureHermesLearningsTable();
    const q = `%${query.toLowerCase()}%`;
    const rows = await db.execute(sql`
      SELECT
        id, org_id, domain, metric, delta,
        outcome, observation, learning, source,
        memory_type, department, category,
        confidence_score, impact_score,
        related_entity_type, related_entity_id,
        created_at, updated_at
      FROM hermes_auto_learnings
      WHERE (
        lower(outcome) LIKE ${q}
        OR lower(observation) LIKE ${q}
        OR lower(learning) LIKE ${q}
        OR lower(domain) LIKE ${q}
        OR lower(source) LIKE ${q}
        OR lower(category) LIKE ${q}
      )
      ${orgId ? sql`AND org_id = ${orgId}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const data = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
    return data.map((r: any) => ({
      id: r.id,
      orgId: r.org_id,
      domain: r.domain,
      metric: r.metric,
      delta: r.delta,
      outcome: r.outcome,
      observation: r.observation,
      learning: r.learning,
      source: r.source,
      memoryType: r.memory_type,
      department: r.department,
      category: r.category,
      confidenceScore: Number(r.confidence_score),
      impactScore: Number(r.impact_score),
      relatedEntityType: r.related_entity_type,
      relatedEntityId: r.related_entity_id,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    }));
  } catch (err: any) {
    console.warn("[HermesLearning] searchHermesLearnings error:", err?.message);
    return [];
  }
}

export async function countHermesLearnings(orgId?: string): Promise<number> {
  try {
    await ensureHermesLearningsTable();
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM hermes_auto_learnings
      ${orgId ? sql`WHERE org_id = ${orgId}` : sql``}
    `);
    const data = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
    return Number(data[0]?.cnt ?? 0);
  } catch {
    return 0;
  }
}

// ─── Convenience wrappers for common source types ─────────────────────────────

export async function recordHeartbeatLearning(opts: {
  orgId: string;
  agentsCoordinated: number;
  prioritiesGenerated: number;
  errors: string[];
  durationMs: number;
  runId: string;
}): Promise<void> {
  const { orgId, agentsCoordinated, prioritiesGenerated, errors, durationMs, runId } = opts;
  const hasErrors = errors.length > 0;
  await recordHermesLearning({
    orgId,
    domain: "CEO Heartbeat",
    metric: "agents_coordinated",
    delta: String(agentsCoordinated),
    outcome: hasErrors
      ? `Heartbeat completed with ${errors.length} error(s) in ${durationMs}ms`
      : `Heartbeat completed successfully in ${durationMs}ms`,
    observation: `${agentsCoordinated} agents coordinated, ${prioritiesGenerated} priorities generated${hasErrors ? `. Errors: ${errors.slice(0, 3).join("; ")}` : ""}`,
    learning: hasErrors
      ? `Heartbeat cycle encountered errors. Review: ${errors[0]?.slice(0, 200)}`
      : `System healthy — ${agentsCoordinated} agents active, ${prioritiesGenerated} priorities queued`,
    source: "ceo_heartbeat",
    memoryType: hasErrors ? "outcome" : "insight",
    department: "Operations",
    category: "System Health",
    confidenceScore: hasErrors ? 90 : 95,
    impactScore: 75,
    relatedEntityType: "heartbeat_run",
    relatedEntityId: runId,
  });
}

export async function recordWorkflowLearning(opts: {
  orgId: string;
  workflowId: string;
  workflowType: string;
  displayName?: string;
  status: "approved" | "rejected" | "completed" | "failed";
  feedback?: string;
  editedDraft?: boolean;
}): Promise<void> {
  const { orgId, workflowId, workflowType, displayName, status, feedback, editedDraft } = opts;
  const wfName = displayName ?? workflowType;
  await recordHermesLearning({
    orgId,
    domain: "Workflow Execution",
    outcome: `Workflow "${wfName}" was ${status}`,
    observation: [
      `Workflow type: ${workflowType}`,
      editedDraft ? "Admin edited draft before approval." : "",
      feedback ? `Feedback: ${feedback}` : "",
    ].filter(Boolean).join(" "),
    learning: status === "rejected"
      ? `Workflow "${wfName}" was rejected${feedback ? ` — reason: ${feedback}` : ""}. Review template for improvements.`
      : status === "approved" && editedDraft
        ? `Workflow "${wfName}" required edits before approval. Refine the default template.`
        : `Workflow "${wfName}" ${status} without issues.`,
    source: "workflow_execution",
    memoryType: status === "rejected" ? "lesson" : "outcome",
    department: "Operations",
    category: "Workflow",
    confidenceScore: 85,
    impactScore: 65,
    relatedEntityType: "workflow_run",
    relatedEntityId: workflowId,
  });
}

export async function recordGmailActionLearning(opts: {
  orgId: string;
  actionId: string;
  actionType: string;
  decision: "approved" | "rejected" | "edited_and_approved";
  communicationDomain?: string;
  reason?: string;
}): Promise<void> {
  const { orgId, actionId, actionType, decision, communicationDomain, reason } = opts;
  const domain = communicationDomain ?? "outreach";
  await recordHermesLearning({
    orgId,
    domain: `Gmail Agent — ${domain}`,
    outcome: `Agent action "${actionType}" was ${decision}`,
    observation: [
      `Action type: ${actionType}`,
      `Domain: ${domain}`,
      reason ? `Reason: ${reason}` : "",
    ].filter(Boolean).join(". "),
    learning: decision === "rejected"
      ? `Gmail action "${actionType}" rejected${reason ? `: ${reason}` : ""}. Agent should adjust outreach approach for ${domain}.`
      : decision === "edited_and_approved"
        ? `Agent draft for "${actionType}" required human edits before approval in ${domain}. Improve draft quality.`
        : `Gmail action "${actionType}" approved for ${domain} — agent output meets quality bar.`,
    source: "agentmail_decision",
    memoryType: decision === "rejected" ? "lesson" : "outcome",
    department: "Revenue",
    category: "Email Outreach",
    confidenceScore: 88,
    impactScore: 70,
    relatedEntityType: "gmail_agent_action",
    relatedEntityId: actionId,
  });
}

export async function recordReplyClassificationLearning(opts: {
  orgId: string;
  prospectId: string;
  classification: string;
  domain?: string;
}): Promise<void> {
  const { orgId, prospectId, classification, domain = "team_training" } = opts;
  await recordHermesLearning({
    orgId,
    domain: `Reply Intelligence — ${domain}`,
    outcome: `Inbound reply classified as "${classification}"`,
    observation: `Prospect ${prospectId} replied; AI classification: ${classification}`,
    learning: classification === "interested" || classification === "ask_info"
      ? `Positive intent signal detected (${classification}). Prospect should be fast-tracked to deal pipeline.`
      : classification === "not_interested"
        ? `Prospect marked not interested. Suppress from sequences for 90 days.`
        : `Reply classified as "${classification}". Monitor conversion pattern for this classification.`,
    source: "agentmail_reply_classification",
    memoryType: "outcome",
    department: "Revenue",
    category: "Reply Intelligence",
    confidenceScore: 82,
    impactScore: 60,
    relatedEntityType: "team_training_prospect",
    relatedEntityId: prospectId,
  });
}
