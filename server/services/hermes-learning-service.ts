/**
 * Hermes Learning Service — Phase 2
 *
 * True learning system: deduplicates via content_hash, reinforces confidence
 * on repetition, tracks occurrence_count / last_seen_at, and logs every
 * retrieval so Hermes knows which learnings are being used.
 *
 * Capture modes:
 *   - State-change (heartbeat): hash encodes health-state signature so
 *     healthy→healthy deduplicates (increment), healthy↔error creates a new row.
 *   - Upsert-on-content (all paths): same domain + source + learning text
 *     maps to one row; duplicates reinforce confidence instead of cloning.
 *
 * Top learnings are surfaced for injection into CEO Heartbeat, Recommendation
 * Engine, and Executive Agent via getTopLearningsForContext().
 */

import { createHash } from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Table bootstrap ──────────────────────────────────────────────────────────

let _tableReady = false;

export async function ensureHermesLearningsTable(): Promise<void> {
  if (_tableReady) return;
  try {
    // Base table (idempotent)
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

    // Phase 2 columns — safe to run repeatedly
    await db.execute(sql`ALTER TABLE hermes_auto_learnings ADD COLUMN IF NOT EXISTS content_hash      TEXT`);
    await db.execute(sql`ALTER TABLE hermes_auto_learnings ADD COLUMN IF NOT EXISTS occurrence_count  INTEGER NOT NULL DEFAULT 1`);
    await db.execute(sql`ALTER TABLE hermes_auto_learnings ADD COLUMN IF NOT EXISTS last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await db.execute(sql`ALTER TABLE hermes_auto_learnings ADD COLUMN IF NOT EXISTS retrieved_count   INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE hermes_auto_learnings ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ`);

    // Indexes
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_org         ON hermes_auto_learnings (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_domain      ON hermes_auto_learnings (domain)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_source      ON hermes_auto_learnings (source)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_created     ON hermes_auto_learnings (created_at DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_mtype       ON hermes_auto_learnings (memory_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hal_last_seen   ON hermes_auto_learnings (last_seen_at DESC)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_hal_content_hash ON hermes_auto_learnings (content_hash) WHERE content_hash IS NOT NULL`);

    _tableReady = true;
  } catch (e: any) {
    console.warn("[HermesLearning] Table setup warning:", e?.message);
  }
}

// ─── Content hash ─────────────────────────────────────────────────────────────

/**
 * Stable fingerprint for a learning.
 * Encodes org + domain + source + normalized learning text.
 * The same learning from the same source in the same domain always maps to
 * the same hash — enabling upsert deduplication.
 */
function computeContentHash(orgId: string, domain: string, source: string, learning: string): string {
  const normalized = [
    orgId,
    domain.toLowerCase().trim(),
    source.toLowerCase().trim(),
    learning.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 300),
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex");
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
  /** Optional override — if omitted, computed from orgId+domain+source+learning */
  contentHash?: string;
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
  contentHash: string | null;
  occurrenceCount: number;
  lastSeenAt: string;
  retrievedCount: number;
  lastRetrievedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertResult {
  id: string;
  occurrenceCount: number;
  isNew: boolean;
}

// ─── Core write (upsert-on-hash) ──────────────────────────────────────────────

/**
 * Record a Hermes learning.
 *
 * If a learning with the same content_hash already exists:
 *   - increment occurrence_count
 *   - reinforce confidence_score (+2, capped at 100)
 *   - update last_seen_at + updated_at
 *   - return { isNew: false }
 *
 * If no matching hash exists → INSERT a new row.
 *
 * Fire-and-forget safe — never throws.
 */
export async function recordHermesLearning(input: HermesLearningInput): Promise<UpsertResult | null> {
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

    const hash = input.contentHash ?? computeContentHash(orgId, domain, source, learning);

    const result = await db.execute(sql`
      INSERT INTO hermes_auto_learnings (
        org_id, domain, metric, delta,
        outcome, observation, learning, source,
        memory_type, department, category,
        confidence_score, impact_score,
        related_entity_type, related_entity_id,
        content_hash, occurrence_count, last_seen_at
      ) VALUES (
        ${orgId}, ${domain}, ${metric ?? null}, ${delta ?? null},
        ${outcome}, ${observation}, ${learning}, ${source},
        ${memoryType}, ${department}, ${category},
        ${confidenceScore}, ${impactScore},
        ${relatedEntityType ?? null}, ${relatedEntityId ?? null},
        ${hash}, 1, NOW()
      )
      ON CONFLICT (content_hash)
      WHERE content_hash IS NOT NULL
      DO UPDATE SET
        occurrence_count  = hermes_auto_learnings.occurrence_count + 1,
        last_seen_at      = NOW(),
        confidence_score  = LEAST(100, hermes_auto_learnings.confidence_score + 2),
        updated_at        = NOW()
      RETURNING id, occurrence_count, (xmax = 0) AS is_new
    `);

    const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    const row = rows[0];
    const id: string = row?.id ?? "";
    const occurrenceCount = Number(row?.occurrence_count ?? 1);
    const isNew = row?.is_new === true || row?.is_new === "t";

    // Fire-and-forget side effects only on first occurrence (new row)
    if (isNew) {
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
    }

    console.log(
      `[HermesLearning] ${isNew ? "✓ New" : "↑ Reinforced"} — source=${source} domain=${domain} occurrences=${occurrenceCount} id=${id}`,
    );
    return { id, occurrenceCount, isNew };
  } catch (err: any) {
    console.warn("[HermesLearning] Failed to record learning:", err?.message);
    return null;
  }
}

// ─── Retrieval logging ────────────────────────────────────────────────────────

/**
 * Increment retrieved_count and update last_retrieved_at for a set of learning IDs.
 * Fire-and-forget — never throws.
 */
export async function markLearningsRetrieved(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await ensureHermesLearningsTable();
    const idList = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    await db.execute(sql`
      UPDATE hermes_auto_learnings
      SET retrieved_count   = retrieved_count + 1,
          last_retrieved_at = NOW(),
          updated_at        = NOW()
      WHERE id IN (${sql.raw(idList)})
    `);
  } catch (err: any) {
    console.warn("[HermesLearning] markLearningsRetrieved error:", err?.message);
  }
}

// ─── Top learnings for context injection ─────────────────────────────────────

export interface LearningContextItem {
  id: string;
  domain: string;
  learning: string;
  outcome: string;
  confidenceScore: number;
  occurrenceCount: number;
  source: string;
  lastSeenAt: string;
}

/**
 * Fetch the top N learnings for a given org, weighted by:
 *   confidence_score * (1 + LN(GREATEST(occurrence_count, 1)))
 * and recency.
 *
 * Automatically increments retrieved_count for returned rows.
 */
export async function getTopLearningsForContext(
  orgId: string,
  limit = 8,
  domainFilter?: string,
): Promise<LearningContextItem[]> {
  try {
    await ensureHermesLearningsTable();

    const rows = await db.execute(sql`
      SELECT
        id, domain, learning, outcome,
        confidence_score, occurrence_count, source, last_seen_at,
        (confidence_score * (1 + LN(GREATEST(occurrence_count, 1)))) AS weight_score
      FROM hermes_auto_learnings
      WHERE org_id = ${orgId}
        ${domainFilter ? sql`AND domain = ${domainFilter}` : sql``}
        AND last_seen_at > NOW() - INTERVAL '90 days'
      ORDER BY weight_score DESC, last_seen_at DESC
      LIMIT ${limit}
    `);

    const data = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
    const items: LearningContextItem[] = data.map((r: any) => ({
      id: r.id,
      domain: r.domain,
      learning: r.learning,
      outcome: r.outcome,
      confidenceScore: Number(r.confidence_score),
      occurrenceCount: Number(r.occurrence_count),
      source: r.source,
      lastSeenAt: r.last_seen_at instanceof Date ? r.last_seen_at.toISOString() : String(r.last_seen_at),
    }));

    // Fire-and-forget retrieval logging
    const ids = items.map((i) => i.id);
    setImmediate(() => markLearningsRetrieved(ids).catch(() => {}));

    return items;
  } catch (err: any) {
    console.warn("[HermesLearning] getTopLearningsForContext error:", err?.message);
    return [];
  }
}

/**
 * Format top learnings as a compact context string for AI prompt injection.
 */
export async function buildLearningContextString(orgId: string, limit = 6): Promise<string> {
  const items = await getTopLearningsForContext(orgId, limit);
  if (!items.length) return "";

  const lines = items.map((item, i) => {
    const reinforced = item.occurrenceCount > 1 ? ` (observed ${item.occurrenceCount}×)` : "";
    return `${i + 1}. [${item.domain}]${reinforced} ${item.learning}`;
  });

  return `\n\nHermes Institutional Memory (top learnings):\n${lines.join("\n")}`;
}

// ─── Standard reads ───────────────────────────────────────────────────────────

function mapRow(r: any): HermesLearningRecord {
  return {
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
    contentHash: r.content_hash ?? null,
    occurrenceCount: Number(r.occurrence_count ?? 1),
    lastSeenAt: r.last_seen_at instanceof Date ? r.last_seen_at.toISOString() : String(r.last_seen_at ?? r.created_at),
    retrievedCount: Number(r.retrieved_count ?? 0),
    lastRetrievedAt: r.last_retrieved_at
      ? (r.last_retrieved_at instanceof Date ? r.last_retrieved_at.toISOString() : String(r.last_retrieved_at))
      : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

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
        content_hash, occurrence_count, last_seen_at,
        retrieved_count, last_retrieved_at,
        created_at, updated_at
      FROM hermes_auto_learnings
      WHERE 1=1
        ${orgId     ? sql`AND org_id      = ${orgId}`     : sql``}
        ${source    ? sql`AND source      = ${source}`    : sql``}
        ${domain    ? sql`AND domain      = ${domain}`    : sql``}
        ${memoryType ? sql`AND memory_type = ${memoryType}` : sql``}
      ORDER BY last_seen_at DESC, occurrence_count DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const data = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
    return data.map(mapRow);
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
        content_hash, occurrence_count, last_seen_at,
        retrieved_count, last_retrieved_at,
        created_at, updated_at
      FROM hermes_auto_learnings
      WHERE (
        lower(outcome)      LIKE ${q}
        OR lower(observation) LIKE ${q}
        OR lower(learning)    LIKE ${q}
        OR lower(domain)      LIKE ${q}
        OR lower(source)      LIKE ${q}
        OR lower(category)    LIKE ${q}
      )
      ${orgId ? sql`AND org_id = ${orgId}` : sql``}
      ORDER BY last_seen_at DESC, occurrence_count DESC
      LIMIT ${limit}
    `);
    const data = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
    return data.map(mapRow);
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

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/**
 * Heartbeat learning — state-change capture.
 *
 * The content_hash encodes the health-state signature:
 *   healthy runs  → one row per org, occurrence_count increments each cycle
 *   errored runs  → separate row keyed to first-error signature
 *   recovery      → increments (or creates) the healthy row again
 *
 * This naturally captures state CHANGES while deduplicating repeated states.
 */
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

  // State signature: drives deduplication between health states
  const errorSig = hasErrors
    ? errors[0]?.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 60) ?? "unknown"
    : "none";
  const stateKey = hasErrors ? `errored:${errorSig}` : "healthy";

  // Explicit hash so hash doesn't include full learning text variation
  const contentHash = computeContentHash(orgId, "CEO Heartbeat", "ceo_heartbeat", stateKey);

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
    contentHash,
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
