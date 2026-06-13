/**
 * Hermes Recommendation Engine — Sprint 2
 *
 * Promotes Hermes from passive learning to active intelligence participant.
 * Evaluates live signals → generates structured recommendations → queues
 * high-confidence items in autonomous_action_queue for human review.
 *
 * Never auto-executes. Every recommendation requires human approval.
 * Full cross-system traceability: hermes_recommendations.id → autonomous_action_queue.source_action_id
 */

import { db } from "../db";
import { sql, eq, and, lt, gt } from "drizzle-orm";
import { gmailConversations, gmailAgentActions, teamTrainingProspects, workflowRuns } from "@shared/schema";
import { writeTimeline } from "./ceo-heartbeat-service";

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIDENCE_QUEUE_THRESHOLD = 0.70;   // Min confidence to enter action queue

// ─── Table setup ─────────────────────────────────────────────────────────────

let tablesEnsured = false;

export async function ensureHermesTables(): Promise<void> {
  if (tablesEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS hermes_recommendations (
        id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        org_id                  TEXT NOT NULL,
        run_id                  TEXT,
        type                    TEXT NOT NULL,
        title                   TEXT NOT NULL,
        reason                  TEXT NOT NULL,
        confidence              NUMERIC(5,2) DEFAULT 0,
        source_system           TEXT,
        source_conversation_id  TEXT,
        source_record_id        TEXT,
        gmail_thread_id         TEXT,
        recommended_action      TEXT,
        action_queue_id         TEXT,
        status                  TEXT DEFAULT 'generated',
        metadata                JSONB,
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hrec_org ON hermes_recommendations (org_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hrec_run ON hermes_recommendations (run_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hrec_status ON hermes_recommendations (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hrec_created ON hermes_recommendations (created_at DESC)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS hermes_recommendation_feedback (
        id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        recommendation_id     TEXT NOT NULL,
        action_queue_id       TEXT,
        outcome               TEXT NOT NULL,
        editor_id             TEXT,
        edit_notes            TEXT,
        original_confidence   NUMERIC(5,2),
        final_outcome         TEXT,
        created_at            TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hfb_rec ON hermes_recommendation_feedback (recommendation_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hfb_queue ON hermes_recommendation_feedback (action_queue_id)`);

    tablesEnsured = true;
  } catch (e: any) {
    console.warn("[HermesEngine] Table setup warning:", e?.message);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HermesRecommendation {
  id: string;
  orgId: string;
  runId?: string;
  type: HermesRecommendationType;
  title: string;
  reason: string;
  confidence: number;  // 0.0 – 1.0
  sourceSystem: string;
  sourceConversationId?: string;
  sourceRecordId?: string;
  gmailThreadId?: string;
  recommendedAction: string;
  actionQueueId?: string;
  status: "generated" | "queued" | "dismissed";
  metadata?: Record<string, any>;
  createdAt: string;
}

export type HermesRecommendationType =
  | "follow_up"
  | "policy_review"
  | "prospect_outreach"
  | "approval_needed"
  | "engineering_review"
  | "pipeline_advance";

export interface HermesCycleResult {
  runId: string;
  signalsProcessed: number;
  recommendationsGenerated: number;
  queuedForReview: number;
  confidenceAverage: number;
  executionTimeMs: number;
  byType: Record<string, number>;
  errors: string[];
}

// ─── Signal Evaluators ────────────────────────────────────────────────────────

interface RawSignal {
  type: HermesRecommendationType;
  title: string;
  reason: string;
  confidence: number;
  sourceSystem: string;
  sourceConversationId?: string;
  sourceRecordId?: string;
  gmailThreadId?: string;
  recommendedAction: string;
  metadata?: Record<string, any>;
}

async function evalGmailFollowUpSignals(orgId: string): Promise<{ signals: RawSignal[]; count: number }> {
  try {
    const cutoff = new Date(Date.now() - 5 * 24 * 3600_000).toISOString();
    const stale = await db
      .select({
        id: gmailConversations.id,
        gmailThreadId: gmailConversations.gmailThreadId,
        subject: gmailConversations.subject,
        participantEmail: gmailConversations.participantEmail,
        participantName: gmailConversations.participantName,
        lastInboundAt: gmailConversations.lastInboundAt,
        lastOutboundAt: gmailConversations.lastOutboundAt,
        intent: gmailConversations.intent,
      })
      .from(gmailConversations)
      .where(
        and(
          eq(gmailConversations.orgId, orgId),
          eq(gmailConversations.status, "open"),
          lt(gmailConversations.lastOutboundAt, new Date(cutoff)),
          gt(gmailConversations.lastInboundAt, gmailConversations.lastOutboundAt),
        ),
      )
      .limit(10)
      .catch(() => []);

    const signals: RawSignal[] = stale.map((c) => {
      const daysSince = c.lastInboundAt
        ? Math.round((Date.now() - new Date(c.lastInboundAt).getTime()) / 86_400_000)
        : null;
      const isHighIntent = ["interested", "warm", "scheduling", "ready"].some(
        (kw) => (c.intent ?? "").toLowerCase().includes(kw),
      );
      return {
        type: "follow_up",
        title: `Follow up: ${c.participantName ?? c.participantEmail ?? "unknown"} — "${c.subject ?? "no subject"}"`,
        reason: `Inbound reply received${daysSince != null ? ` ${daysSince} day(s) ago` : ""} with no outbound response. Conversation appears to be waiting for your reply.`,
        confidence: isHighIntent ? 0.92 : 0.84,
        sourceSystem: "gmail",
        sourceConversationId: c.id,
        gmailThreadId: c.gmailThreadId,
        recommendedAction: "compose_reply",
        metadata: { participantEmail: c.participantEmail, intent: c.intent, daysSince },
      };
    });

    return { signals, count: stale.length };
  } catch (e: any) {
    console.warn("[HermesEngine] Gmail follow-up eval error:", e?.message);
    return { signals: [], count: 0 };
  }
}

async function evalBlockedSendSignals(orgId: string): Promise<{ signals: RawSignal[]; count: number }> {
  try {
    const rows = await db.execute(sql`
      SELECT COUNT(*) as blocked_count
      FROM outbound_email_audit_log
      WHERE organization_id = ${orgId}
        AND status = 'blocked'
        AND created_at > NOW() - INTERVAL '24 hours'
    `).catch(() => ({ rows: [] }));
    const r: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    const blockedCount = Number(r[0]?.blocked_count ?? 0);

    if (blockedCount === 0) return { signals: [], count: 0 };

    const confidence = blockedCount >= 10 ? 0.85 : blockedCount >= 5 ? 0.75 : 0.70;
    return {
      signals: [
        {
          type: "policy_review",
          title: `Email policy review: ${blockedCount} send(s) blocked in last 24h`,
          reason: `${blockedCount} outbound AgentMail send(s) were blocked in the last 24 hours. This may indicate misconfigured send policy or an emergency pause that should be revisited.`,
          confidence,
          sourceSystem: "outbound_email_audit_log",
          recommendedAction: "review_send_policy",
          metadata: { blockedCount },
        },
      ],
      count: blockedCount,
    };
  } catch (e: any) {
    console.warn("[HermesEngine] Blocked-send eval error:", e?.message);
    return { signals: [], count: 0 };
  }
}

async function evalProspectOutreachSignals(orgId: string): Promise<{ signals: RawSignal[]; count: number }> {
  try {
    const rows = await db.execute(sql`
      SELECT id, organization_name, contact_email, status, updated_at
      FROM team_training_prospects
      WHERE organization_id = ${orgId}
        AND status IN ('contacted','interested','proposal_sent')
        AND updated_at < NOW() - INTERVAL '7 days'
      LIMIT 5
    `).catch(() => ({ rows: [] }));
    const stale: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

    const signals: RawSignal[] = stale.map((p) => {
      const daysSince = Math.round(
        (Date.now() - new Date(p.updated_at).getTime()) / 86_400_000,
      );
      return {
        type: "prospect_outreach",
        title: `Re-engage prospect: ${p.organization_name ?? "unknown"}`,
        reason: `Prospect "${p.organization_name}" (status: ${p.status}) has had no update in ${daysSince} days. High-value prospects go cold after 10 days without contact.`,
        confidence: daysSince > 14 ? 0.82 : 0.73,
        sourceSystem: "team_training_prospects",
        sourceRecordId: p.id,
        recommendedAction: "send_follow_up_email",
        metadata: { organizationName: p.organization_name, contactEmail: p.contact_email, status: p.status, daysSince },
      };
    });

    return { signals, count: stale.length };
  } catch (e: any) {
    console.warn("[HermesEngine] Prospect outreach eval error:", e?.message);
    return { signals: [], count: 0 };
  }
}

async function evalStaleApprovalSignals(orgId: string): Promise<{ signals: RawSignal[]; count: number }> {
  try {
    const rows = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM autonomous_action_queue
      WHERE org_id = ${orgId}
        AND status IN ('pending','awaiting_review')
        AND created_at < NOW() - INTERVAL '48 hours'
    `).catch(() => ({ rows: [] }));
    const r: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    const cnt = Number(r[0]?.cnt ?? 0);

    if (cnt === 0) return { signals: [], count: 0 };

    return {
      signals: [
        {
          type: "approval_needed",
          title: `${cnt} action(s) awaiting review for 48+ hours`,
          reason: `${cnt} item(s) in the autonomous action queue have been waiting for human review for more than 48 hours. Stale approvals reduce system effectiveness and delay high-confidence actions.`,
          confidence: 0.88,
          sourceSystem: "autonomous_action_queue",
          recommendedAction: "review_action_queue",
          metadata: { stalePendingCount: cnt },
        },
      ],
      count: cnt,
    };
  } catch (e: any) {
    console.warn("[HermesEngine] Stale approval eval error:", e?.message);
    return { signals: [], count: 0 };
  }
}

async function evalEngineeringSignals(orgId: string): Promise<{ signals: RawSignal[]; count: number }> {
  try {
    const failed = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.orgId, orgId),
          eq(workflowRuns.status, "failed"),
          gt(workflowRuns.startedAt, new Date(Date.now() - 24 * 3600_000)),
        ),
      )
      .limit(20)
      .catch(() => []);

    if (failed.length < 3) return { signals: [], count: failed.length };

    return {
      signals: [
        {
          type: "engineering_review",
          title: `Workflow failures: ${failed.length} in last 24h`,
          reason: `${failed.length} workflow runs have failed in the last 24 hours. This may indicate a systemic issue in the automation pipeline that requires engineering attention.`,
          confidence: failed.length >= 10 ? 0.90 : 0.78,
          sourceSystem: "workflow_runs",
          recommendedAction: "engineering_review",
          metadata: { failedCount: failed.length },
        },
      ],
      count: failed.length,
    };
  } catch (e: any) {
    console.warn("[HermesEngine] Engineering eval error:", e?.message);
    return { signals: [], count: 0 };
  }
}

// ─── Apply historical feedback to adjust confidence ───────────────────────────

async function applyFeedbackAdjustment(
  orgId: string,
  type: HermesRecommendationType,
  baseConfidence: number,
): Promise<number> {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE outcome = 'approved') as approved,
        COUNT(*) FILTER (WHERE outcome = 'rejected') as rejected
      FROM hermes_recommendation_feedback hf
      JOIN hermes_recommendations hr ON hr.id = hf.recommendation_id
      WHERE hr.org_id = ${orgId}
        AND hr.type = ${type}
        AND hf.created_at > NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [] }));
    const r: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    const total = Number(r[0]?.total ?? 0);
    const approved = Number(r[0]?.approved ?? 0);
    const rejected = Number(r[0]?.rejected ?? 0);

    if (total < 3) return baseConfidence;

    const approvalRate = approved / total;
    const rejectionRate = rejected / total;
    const adjustment = (approvalRate * 0.05) - (rejectionRate * 0.05);
    return Math.max(0.40, Math.min(0.99, baseConfidence + adjustment));
  } catch {
    return baseConfidence;
  }
}

// ─── Persist recommendation ───────────────────────────────────────────────────

async function persistRecommendation(
  orgId: string,
  runId: string,
  signal: RawSignal,
  adjustedConfidence: number,
): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO hermes_recommendations (
      id, org_id, run_id, type, title, reason, confidence,
      source_system, source_conversation_id, source_record_id,
      gmail_thread_id, recommended_action, status, metadata,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid()::text, ${orgId}, ${runId},
      ${signal.type}, ${signal.title}, ${signal.reason},
      ${adjustedConfidence},
      ${signal.sourceSystem},
      ${signal.sourceConversationId ?? null},
      ${signal.sourceRecordId ?? null},
      ${signal.gmailThreadId ?? null},
      ${signal.recommendedAction},
      'generated',
      ${JSON.stringify(signal.metadata ?? {})}::jsonb,
      NOW(), NOW()
    )
    RETURNING id
  `);
  const r: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  return r[0]?.id as string;
}

// ─── Queue high-confidence recommendation in autonomous_action_queue ──────────

async function queueRecommendation(
  orgId: string,
  recId: string,
  signal: RawSignal,
  confidence: number,
): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO autonomous_action_queue (
      id, org_id, decision_type, agent_type, action, description,
      confidence, autonomy_score, risk_level, status,
      source_system, source_action_id, source_conversation_id, gmail_thread_id,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid()::text, ${orgId},
      ${signal.type}, 'hermes',
      ${signal.recommendedAction},
      ${signal.title + " — " + signal.reason},
      ${Math.round(confidence * 100)},
      ${Math.round(confidence * 100)},
      'low',
      'awaiting_review',
      'hermes', ${recId},
      ${signal.sourceConversationId ?? null},
      ${signal.gmailThreadId ?? null},
      NOW(), NOW()
    )
    RETURNING id
  `);
  const r: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  const queueId = r[0]?.id as string;

  await db.execute(sql`
    UPDATE hermes_recommendations
    SET action_queue_id = ${queueId}, status = 'queued', updated_at = NOW()
    WHERE id = ${recId}
  `).catch(() => {});

  return queueId;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runHermesIntelligenceCycle(
  orgId: string,
  heartbeatId?: string,
): Promise<HermesCycleResult> {
  const startMs = Date.now();
  const runId = `hermes-${Date.now()}-${orgId.slice(0, 8)}`;
  const errors: string[] = [];
  const byType: Record<string, number> = {};

  await ensureHermesTables();

  // ── Evaluate all signal sources in parallel ────────────────────────────────
  const [gmailResult, blockedResult, prospectResult, approvalResult, engineeringResult] =
    await Promise.all([
      evalGmailFollowUpSignals(orgId),
      evalBlockedSendSignals(orgId),
      evalProspectOutreachSignals(orgId),
      evalStaleApprovalSignals(orgId),
      evalEngineeringSignals(orgId),
    ]);

  const allSignals = [
    ...gmailResult.signals,
    ...blockedResult.signals,
    ...prospectResult.signals,
    ...approvalResult.signals,
    ...engineeringResult.signals,
  ];

  const signalsProcessed =
    gmailResult.count +
    blockedResult.count +
    prospectResult.count +
    approvalResult.count +
    engineeringResult.count;

  let recommendationsGenerated = 0;
  let queuedForReview = 0;
  const confidences: number[] = [];

  // ── Process each signal ───────────────────────────────────────────────────
  for (const signal of allSignals) {
    try {
      const adjustedConfidence = await applyFeedbackAdjustment(orgId, signal.type, signal.confidence);
      confidences.push(adjustedConfidence);

      const recId = await persistRecommendation(orgId, runId, signal, adjustedConfidence);
      recommendationsGenerated++;
      byType[signal.type] = (byType[signal.type] ?? 0) + 1;

      if (adjustedConfidence >= CONFIDENCE_QUEUE_THRESHOLD) {
        await queueRecommendation(orgId, recId, signal, adjustedConfidence);
        queuedForReview++;
      }
    } catch (e: any) {
      errors.push(`signal(${signal.type}): ${e?.message}`);
    }
  }

  const confidenceAverage =
    confidences.length > 0
      ? Math.round((confidences.reduce((s, c) => s + c, 0) / confidences.length) * 100) / 100
      : 0;

  const executionTimeMs = Date.now() - startMs;

  const result: HermesCycleResult = {
    runId,
    signalsProcessed,
    recommendationsGenerated,
    queuedForReview,
    confidenceAverage,
    executionTimeMs,
    byType,
    errors,
  };

  if (heartbeatId) {
    await writeTimeline({
      orgId,
      heartbeatId,
      agentName: "hermes_recommendation_engine",
      systemName: "Hermes",
      actionType: "intelligence_cycle",
      actionStatus: errors.length > 0 ? "completed" : "completed",
      summary: `Hermes: ${signalsProcessed} signals → ${recommendationsGenerated} recommendations (${queuedForReview} queued, avg confidence ${Math.round(confidenceAverage * 100)}%)`,
      metadata: result,
    });
  }

  console.log(
    `[Hermes] Cycle complete — org=${orgId} signals=${signalsProcessed} recommendations=${recommendationsGenerated} queued=${queuedForReview} confidence=${Math.round(confidenceAverage * 100)}% time=${executionTimeMs}ms`,
  );

  return result;
}

// ─── Stats query ──────────────────────────────────────────────────────────────

export interface HermesStats {
  lastRunAt: string | null;
  lastInsightAt: string | null;
  recommendations24h: number;
  queuedForReview24h: number;
  failures24h: number;
  successRate: number;
  confidenceAverage: number;
  signalsProcessed24h: number;
}

export async function getHermesStats(orgId: string): Promise<HermesStats> {
  await ensureHermesTables();
  try {
    const rows = await db.execute(sql`
      SELECT
        MAX(created_at) AS last_insight_at,
        COUNT(*) AS total_24h,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued_24h,
        AVG(confidence) AS avg_confidence
      FROM hermes_recommendations
      WHERE org_id = ${orgId}
        AND created_at > NOW() - INTERVAL '24 hours'
    `).catch(() => ({ rows: [] }));
    const r: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    const rec = r[0] ?? {};

    const fbRows = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE hf.outcome = 'approved') as approved_count
      FROM hermes_recommendation_feedback hf
      JOIN hermes_recommendations hr ON hr.id = hf.recommendation_id
      WHERE hr.org_id = ${orgId}
        AND hf.created_at > NOW() - INTERVAL '7 days'
    `).catch(() => ({ rows: [] }));
    const fb: any[] = Array.isArray(fbRows) ? fbRows : (fbRows as any).rows ?? [];
    const fbRec = fb[0] ?? {};
    const fbTotal = Number(fbRec.total ?? 0);
    const fbApproved = Number(fbRec.approved_count ?? 0);
    const successRate = fbTotal > 0 ? Math.round((fbApproved / fbTotal) * 100) : 0;

    const tlRows = await db.execute(sql`
      SELECT created_at FROM agent_operating_timeline
      WHERE org_id = ${orgId}
        AND agent_name = 'hermes_recommendation_engine'
      ORDER BY created_at DESC LIMIT 1
    `).catch(() => ({ rows: [] }));
    const tl: any[] = Array.isArray(tlRows) ? tlRows : (tlRows as any).rows ?? [];
    const lastRunAt = tl[0]?.created_at ? new Date(tl[0].created_at).toISOString() : null;

    return {
      lastRunAt,
      lastInsightAt: rec.last_insight_at ? new Date(rec.last_insight_at).toISOString() : null,
      recommendations24h: Number(rec.total_24h ?? 0),
      queuedForReview24h: Number(rec.queued_24h ?? 0),
      failures24h: 0,
      successRate,
      confidenceAverage: rec.avg_confidence ? Math.round(Number(rec.avg_confidence) * 100) : 0,
      signalsProcessed24h: 0,
    };
  } catch (e: any) {
    console.warn("[HermesEngine] Stats query error:", e?.message);
    return { lastRunAt: null, lastInsightAt: null, recommendations24h: 0, queuedForReview24h: 0, failures24h: 0, successRate: 0, confidenceAverage: 0, signalsProcessed24h: 0 };
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────

export interface HermesHealth {
  status: "healthy" | "degraded" | "critical";
  lastRunAt: string | null;
  lastInsightAt: string | null;
  minutesSinceLastRun: number | null;
  recommendations24h: number;
  failures24h: number;
  details: string;
}

export async function getHermesHealth(orgId: string): Promise<HermesHealth> {
  const stats = await getHermesStats(orgId);
  const now = Date.now();

  let minutesSinceLastRun: number | null = null;
  if (stats.lastRunAt) {
    minutesSinceLastRun = Math.round((now - new Date(stats.lastRunAt).getTime()) / 60_000);
  }

  let status: "healthy" | "degraded" | "critical" = "healthy";
  let details = "Hermes is operating normally";

  if (minutesSinceLastRun === null) {
    status = "degraded";
    details = "Hermes has not run yet — no timeline entry found";
  } else if (minutesSinceLastRun > 12 * 60) {
    status = "critical";
    details = `Hermes has not run in ${Math.round(minutesSinceLastRun / 60)}h (> 12h threshold)`;
  } else if (minutesSinceLastRun > 2 * 60) {
    status = "degraded";
    details = `Hermes last ran ${Math.round(minutesSinceLastRun / 60)}h ago (> 2h threshold)`;
  } else if (stats.failures24h > 0) {
    const failRate = stats.failures24h / Math.max(stats.recommendations24h, 1);
    if (failRate > 0.1) {
      status = "degraded";
      details = `Failure rate ${Math.round(failRate * 100)}% exceeds 10% threshold`;
    }
  }

  return {
    status,
    lastRunAt: stats.lastRunAt,
    lastInsightAt: stats.lastInsightAt,
    minutesSinceLastRun,
    recommendations24h: stats.recommendations24h,
    failures24h: stats.failures24h,
    details,
  };
}
