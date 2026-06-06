/**
 * Autonomy Scoring Service — Phase 4
 * Calculates per-decision-type autonomy scores from historical outcomes.
 * Determines execution mode: Observe / Recommend / Queue / Execute.
 * Manages the Decision Trust Registry, Autonomous Action Queue, and Override Learning.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ExecutionMode = "observe" | "recommend" | "queue" | "execute";
export type ActionStatus = "pending" | "approved" | "executed" | "rejected" | "failed";

export const RISK_CEILING: Record<RiskLevel, number> = {
  low:      100,
  medium:   75,
  high:     50,
  critical: 25,
};

export const RISK_PENALTY: Record<RiskLevel, number> = {
  low:      0,
  medium:   8,
  high:     22,
  critical: 45,
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low:      "Low",
  medium:   "Medium",
  high:     "High",
  critical: "Critical",
};

// ─── Default decision categories ─────────────────────────────────────────────

export const DEFAULT_DECISION_TYPES = [
  { type: "session_reminder",    label: "Session Reminder",     risk: "low",      successRate: 99, executions: 500, humanOverrides: 2,  humanApprovals: 498, revenueInfluenced: 125000 },
  { type: "follow_up_lead",      label: "Follow Up Lead",       risk: "medium",   successRate: 72, executions: 150, humanOverrides: 20, humanApprovals: 130, revenueInfluenced: 340000 },
  { type: "book_consultation",   label: "Book Consultation",    risk: "low",      successRate: 88, executions: 80,  humanOverrides: 5,  humanApprovals: 75,  revenueInfluenced: 290000 },
  { type: "send_reminder",       label: "Send Reminder",        risk: "low",      successRate: 94, executions: 300, humanOverrides: 3,  humanApprovals: 297, revenueInfluenced: 85000  },
  { type: "coach_outreach",      label: "Coach Outreach",       risk: "medium",   successRate: 65, executions: 60,  humanOverrides: 15, humanApprovals: 45,  revenueInfluenced: 210000 },
  { type: "hiring_follow_up",    label: "Hiring Follow-Up",     risk: "high",     successRate: 71, executions: 30,  humanOverrides: 8,  humanApprovals: 22,  revenueInfluenced: 0      },
  { type: "retention_check_in",  label: "Retention Check-In",   risk: "low",      successRate: 85, executions: 120, humanOverrides: 5,  humanApprovals: 115, revenueInfluenced: 180000 },
  { type: "revenue_recovery",    label: "Revenue Recovery",     risk: "medium",   successRate: 67, executions: 45,  humanOverrides: 12, humanApprovals: 33,  revenueInfluenced: 420000 },
  { type: "pricing_strategy",    label: "Pricing Strategy",     risk: "high",     successRate: 54, executions: 20,  humanOverrides: 18, humanApprovals: 2,   revenueInfluenced: 0      },
  { type: "contract_modification",label: "Contract Modification",risk: "critical", successRate: 45, executions: 10,  humanOverrides: 8,  humanApprovals: 2,   revenueInfluenced: 0      },
  { type: "schedule_optimization",label: "Schedule Optimization", risk: "low",    successRate: 91, executions: 200, humanOverrides: 4,  humanApprovals: 196, revenueInfluenced: 95000  },
  { type: "prospect_outreach",   label: "Prospect Outreach",    risk: "medium",   successRate: 61, executions: 90,  humanOverrides: 22, humanApprovals: 68,  revenueInfluenced: 275000 },
] as const;

// ─── Score calculation ────────────────────────────────────────────────────────

export function calculateAutonomyScore(opts: {
  successRate: number;     // 0-100
  executions: number;
  humanOverrides: number;
  humanApprovals: number;
  riskLevel: RiskLevel;
  revenueInfluenced?: number; // cents
}): number {
  const { successRate, executions, humanOverrides, humanApprovals, riskLevel, revenueInfluenced = 0 } = opts;

  const totalDecisions = humanOverrides + humanApprovals;
  const overrideRate = totalDecisions > 0 ? humanOverrides / totalDecisions : 0;

  // Component scores (each 0-100 equivalent contribution)
  const successComponent   = successRate * 0.40;                                    // 40%
  const frequencyComponent = Math.min(executions / 100, 1.0) * 20;                 // 20%
  const confidenceComponent= (1 - overrideRate) * 20;                              // 20%
  const revenueComponent   = Math.min(revenueInfluenced / 500_000, 1.0) * 10;      // 10%
  const riskPenalty        = RISK_PENALTY[riskLevel];                               // 10%

  const rawScore = successComponent + frequencyComponent + confidenceComponent + revenueComponent - riskPenalty;
  const ceiling  = RISK_CEILING[riskLevel];

  return Math.round(Math.max(0, Math.min(rawScore, ceiling)));
}

export function scoreToMode(score: number): ExecutionMode {
  if (score >= 76) return "execute";
  if (score >= 51) return "queue";
  if (score >= 26) return "recommend";
  return "observe";
}

export function modeLabel(mode: ExecutionMode): string {
  return { execute: "Auto Execute", queue: "Recommend + Queue", recommend: "Recommend", observe: "Observe Only" }[mode];
}

// ─── Table creation ───────────────────────────────────────────────────────────

export async function createAutonomyTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS decision_trust_registry (
      id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id              TEXT NOT NULL,
      decision_type       TEXT NOT NULL,
      label               TEXT NOT NULL,
      autonomy_score      INTEGER DEFAULT 0,
      success_rate        INTEGER DEFAULT 0,
      revenue_influenced  INTEGER DEFAULT 0,
      executions          INTEGER DEFAULT 0,
      human_approvals     INTEGER DEFAULT 0,
      human_overrides     INTEGER DEFAULT 0,
      risk_level          TEXT DEFAULT 'medium',
      recommended_mode    TEXT DEFAULT 'observe',
      ceo_override_mode   TEXT,
      last_evaluated      TIMESTAMPTZ DEFAULT NOW(),
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, decision_type)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS autonomous_action_queue (
      id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id          TEXT NOT NULL,
      decision_type   TEXT NOT NULL,
      agent_type      TEXT NOT NULL,
      action          TEXT NOT NULL,
      description     TEXT,
      confidence      INTEGER DEFAULT 0,
      autonomy_score  INTEGER DEFAULT 0,
      risk_level      TEXT DEFAULT 'medium',
      status          TEXT DEFAULT 'pending',
      approved_by     TEXT,
      rejected_by     TEXT,
      rejection_reason TEXT,
      outcome         TEXT,
      revenue_cents   INTEGER DEFAULT 0,
      meetings_gen    INTEGER DEFAULT 0,
      executed_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS autonomy_overrides (
      id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id                TEXT NOT NULL,
      queue_action_id       TEXT,
      decision_type         TEXT NOT NULL,
      original_recommendation TEXT NOT NULL,
      override_type         TEXT NOT NULL,   -- 'approved','rejected','modified'
      reason                TEXT,
      modified_action       TEXT,
      outcome               TEXT,
      success_score         INTEGER,
      overridden_by         TEXT,
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// ─── Seed / upsert trust registry defaults ────────────────────────────────────

export async function seedTrustRegistry(orgId: string): Promise<void> {
  for (const dt of DEFAULT_DECISION_TYPES) {
    const score = calculateAutonomyScore({
      successRate:      dt.successRate,
      executions:       dt.executions,
      humanOverrides:   dt.humanOverrides,
      humanApprovals:   dt.humanApprovals,
      riskLevel:        dt.risk as RiskLevel,
      revenueInfluenced: dt.revenueInfluenced,
    });
    const mode = scoreToMode(score);

    await db.execute(sql`
      INSERT INTO decision_trust_registry
        (org_id, decision_type, label, autonomy_score, success_rate, revenue_influenced,
         executions, human_approvals, human_overrides, risk_level, recommended_mode)
      VALUES
        (${orgId}, ${dt.type}, ${dt.label}, ${score}, ${dt.successRate},
         ${dt.revenueInfluenced}, ${dt.executions}, ${dt.humanApprovals},
         ${dt.humanOverrides}, ${dt.risk}, ${mode})
      ON CONFLICT (org_id, decision_type) DO NOTHING
    `);
  }
}

// ─── Get trust registry ───────────────────────────────────────────────────────

export async function getTrustRegistry(orgId: string) {
  const rows = await db.execute(sql`
    SELECT * FROM decision_trust_registry WHERE org_id = ${orgId}
    ORDER BY autonomy_score DESC
  `);
  return Array.isArray(rows) ? rows : (rows as any).rows ?? [];
}

// ─── Evaluate a decision type → current mode ─────────────────────────────────

export async function evaluateDecision(orgId: string, decisionType: string): Promise<{
  score: number;
  mode: ExecutionMode;
  modeLabel: string;
  riskLevel: RiskLevel;
  ceoPaused: boolean;
}> {
  const rows = await db.execute(sql`
    SELECT * FROM decision_trust_registry
    WHERE org_id = ${orgId} AND decision_type = ${decisionType}
    LIMIT 1
  `);
  const r = (Array.isArray(rows) ? rows : (rows as any).rows ?? [])[0];

  if (!r) {
    return { score: 0, mode: "observe", modeLabel: "Observe Only", riskLevel: "medium", ceoPaused: false };
  }

  const effectiveMode = (r.ceo_override_mode ?? r.recommended_mode) as ExecutionMode;
  return {
    score:      r.autonomy_score,
    mode:       effectiveMode,
    modeLabel:  modeLabel(effectiveMode),
    riskLevel:  r.risk_level as RiskLevel,
    ceoPaused:  r.ceo_override_mode === "observe",
  };
}

// ─── Update trust registry entry ─────────────────────────────────────────────

export async function upsertTrustEntry(orgId: string, opts: {
  decisionType: string;
  label?: string;
  successRate?: number;
  executions?: number;
  humanApprovals?: number;
  humanOverrides?: number;
  riskLevel?: RiskLevel;
  revenueInfluenced?: number;
  ceoOverrideMode?: ExecutionMode | null;
}): Promise<void> {
  const existing = await db.execute(sql`
    SELECT * FROM decision_trust_registry
    WHERE org_id = ${orgId} AND decision_type = ${opts.decisionType}
    LIMIT 1
  `);
  const e = (Array.isArray(existing) ? existing : (existing as any).rows ?? [])[0];

  const successRate     = opts.successRate     ?? e?.success_rate     ?? 50;
  const executions      = opts.executions      ?? e?.executions       ?? 0;
  const humanApprovals  = opts.humanApprovals  ?? e?.human_approvals  ?? 0;
  const humanOverrides  = opts.humanOverrides  ?? e?.human_overrides  ?? 0;
  const riskLevel       = (opts.riskLevel      ?? e?.risk_level       ?? "medium") as RiskLevel;
  const revenueInfluenced = opts.revenueInfluenced ?? e?.revenue_influenced ?? 0;
  const label           = opts.label           ?? e?.label            ?? opts.decisionType;

  const score = calculateAutonomyScore({ successRate, executions, humanOverrides, humanApprovals, riskLevel, revenueInfluenced });
  const mode  = scoreToMode(score);

  const ceoPatch = opts.ceoOverrideMode !== undefined
    ? sql`, ceo_override_mode = ${opts.ceoOverrideMode}`
    : sql``;

  await db.execute(sql`
    INSERT INTO decision_trust_registry
      (org_id, decision_type, label, autonomy_score, success_rate, revenue_influenced,
       executions, human_approvals, human_overrides, risk_level, recommended_mode, last_evaluated)
    VALUES
      (${orgId}, ${opts.decisionType}, ${label}, ${score}, ${successRate}, ${revenueInfluenced},
       ${executions}, ${humanApprovals}, ${humanOverrides}, ${riskLevel}, ${mode}, NOW())
    ON CONFLICT (org_id, decision_type) DO UPDATE SET
      label              = EXCLUDED.label,
      autonomy_score     = EXCLUDED.autonomy_score,
      success_rate       = EXCLUDED.success_rate,
      revenue_influenced = EXCLUDED.revenue_influenced,
      executions         = EXCLUDED.executions,
      human_approvals    = EXCLUDED.human_approvals,
      human_overrides    = EXCLUDED.human_overrides,
      risk_level         = EXCLUDED.risk_level,
      recommended_mode   = EXCLUDED.recommended_mode,
      last_evaluated     = NOW()
      ${ceoPatch}
  `);
}

// ─── Queue management ─────────────────────────────────────────────────────────

export async function queueAction(opts: {
  orgId: string;
  decisionType: string;
  agentType: string;
  action: string;
  description?: string;
  confidence?: number;
  riskLevel?: RiskLevel;
}): Promise<string> {
  const eval_ = await evaluateDecision(opts.orgId, opts.decisionType);

  const result = await db.execute(sql`
    INSERT INTO autonomous_action_queue
      (org_id, decision_type, agent_type, action, description, confidence, autonomy_score, risk_level, status)
    VALUES
      (${opts.orgId}, ${opts.decisionType}, ${opts.agentType}, ${opts.action},
       ${opts.description ?? null}, ${opts.confidence ?? eval_.score},
       ${eval_.score}, ${opts.riskLevel ?? eval_.riskLevel}, 'pending')
    RETURNING id
  `);
  const rows = Array.isArray(result) ? result : (result as any).rows ?? [];

  // Auto-execute if mode is "execute" and not critical
  if (eval_.mode === "execute" && eval_.riskLevel !== "critical") {
    const id = rows[0]?.id;
    if (id) await executeQueuedAction(opts.orgId, id, "system_auto");
    return id;
  }

  return rows[0]?.id;
}

export async function getActionQueue(orgId: string, status?: string) {
  const statusFilter = status && status !== "all"
    ? sql`AND status = ${status}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT * FROM autonomous_action_queue
    WHERE org_id = ${orgId} ${statusFilter}
    ORDER BY created_at DESC
    LIMIT 100
  `);
  return Array.isArray(rows) ? rows : (rows as any).rows ?? [];
}

export async function approveAction(orgId: string, actionId: string, approvedBy: string): Promise<void> {
  await db.execute(sql`
    UPDATE autonomous_action_queue SET
      status = 'approved', approved_by = ${approvedBy}, updated_at = NOW()
    WHERE id = ${actionId} AND org_id = ${orgId} AND status = 'pending'
  `);
  // Record override learning
  const row = (await db.execute(sql`SELECT * FROM autonomous_action_queue WHERE id = ${actionId}`));
  const r = (Array.isArray(row) ? row : (row as any).rows ?? [])[0];
  if (r) await recordOverride(orgId, { queueActionId: actionId, decisionType: r.decision_type, originalRecommendation: r.action, overrideType: "approved", overriddenBy: approvedBy });
}

export async function rejectAction(orgId: string, actionId: string, rejectedBy: string, reason?: string): Promise<void> {
  await db.execute(sql`
    UPDATE autonomous_action_queue SET
      status = 'rejected', rejected_by = ${rejectedBy},
      rejection_reason = ${reason ?? null}, updated_at = NOW()
    WHERE id = ${actionId} AND org_id = ${orgId} AND status = 'pending'
  `);
  const row = await db.execute(sql`SELECT * FROM autonomous_action_queue WHERE id = ${actionId}`);
  const r = (Array.isArray(row) ? row : (row as any).rows ?? [])[0];
  if (r) {
    await recordOverride(orgId, { queueActionId: actionId, decisionType: r.decision_type, originalRecommendation: r.action, overrideType: "rejected", reason, overriddenBy: rejectedBy });
    // Bump override count in registry
    await db.execute(sql`
      UPDATE decision_trust_registry SET
        human_overrides = human_overrides + 1,
        last_evaluated  = NOW()
      WHERE org_id = ${orgId} AND decision_type = ${r.decision_type}
    `);
  }
}

export async function executeQueuedAction(orgId: string, actionId: string, executedBy: string, outcome?: string, revenueCents?: number): Promise<void> {
  await db.execute(sql`
    UPDATE autonomous_action_queue SET
      status = 'executed', executed_at = NOW(),
      outcome = ${outcome ?? null},
      revenue_cents = ${revenueCents ?? 0},
      updated_at = NOW()
    WHERE id = ${actionId} AND org_id = ${orgId}
  `);
  // Update registry execution count
  const row = await db.execute(sql`SELECT * FROM autonomous_action_queue WHERE id = ${actionId}`);
  const r = (Array.isArray(row) ? row : (row as any).rows ?? [])[0];
  if (r) {
    await db.execute(sql`
      UPDATE decision_trust_registry SET
        executions       = executions + 1,
        revenue_influenced = revenue_influenced + ${revenueCents ?? 0},
        human_approvals  = CASE WHEN ${executedBy} != 'system_auto' THEN human_approvals + 1 ELSE human_approvals END,
        last_evaluated   = NOW()
      WHERE org_id = ${orgId} AND decision_type = ${r.decision_type}
    `);
  }
}

export async function bulkApproveByRisk(orgId: string, maxRisk: RiskLevel, approvedBy: string): Promise<number> {
  const riskOrder: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const maxIdx = riskOrder[maxRisk];
  const allowedRisks = Object.entries(riskOrder)
    .filter(([, v]) => v <= maxIdx)
    .map(([k]) => k);

  let count = 0;
  const pendingRows = await db.execute(sql`
    SELECT id FROM autonomous_action_queue
    WHERE org_id = ${orgId} AND status = 'pending'
      AND risk_level = ANY(${allowedRisks})
  `);
  const pending = Array.isArray(pendingRows) ? pendingRows : (pendingRows as any).rows ?? [];
  for (const row of pending) {
    await approveAction(orgId, row.id, approvedBy);
    count++;
  }
  return count;
}

// ─── Override learning ────────────────────────────────────────────────────────

export async function recordOverride(orgId: string, opts: {
  queueActionId?: string;
  decisionType: string;
  originalRecommendation: string;
  overrideType: "approved" | "rejected" | "modified";
  reason?: string;
  modifiedAction?: string;
  outcome?: string;
  successScore?: number;
  overriddenBy?: string;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO autonomy_overrides
      (org_id, queue_action_id, decision_type, original_recommendation, override_type,
       reason, modified_action, outcome, success_score, overridden_by)
    VALUES
      (${orgId}, ${opts.queueActionId ?? null}, ${opts.decisionType},
       ${opts.originalRecommendation}, ${opts.overrideType},
       ${opts.reason ?? null}, ${opts.modifiedAction ?? null},
       ${opts.outcome ?? null}, ${opts.successScore ?? null}, ${opts.overriddenBy ?? null})
  `);
}

export async function getOverrides(orgId: string, limit = 50) {
  const rows = await db.execute(sql`
    SELECT * FROM autonomy_overrides WHERE org_id = ${orgId}
    ORDER BY created_at DESC LIMIT ${limit}
  `);
  return Array.isArray(rows) ? rows : (rows as any).rows ?? [];
}

// ─── Dashboard metrics ────────────────────────────────────────────────────────

export async function getAutonomyDashboard(orgId: string) {
  // Seed registry if empty
  const existing = await db.execute(sql`SELECT COUNT(*) AS cnt FROM decision_trust_registry WHERE org_id = ${orgId}`);
  const cnt = parseInt((Array.isArray(existing) ? existing : (existing as any).rows ?? [])[0]?.cnt ?? "0");
  if (cnt === 0) await seedTrustRegistry(orgId);

  const [actionRows, pendingRows, overrideRows, registryRows] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'executed' AND DATE(created_at) = CURRENT_DATE) AS today_executed,
        COUNT(*) FILTER (WHERE status = 'pending')   AS pending_count,
        COUNT(*) FILTER (WHERE status = 'rejected')  AS rejected_count,
        COALESCE(SUM(revenue_cents) FILTER (WHERE status = 'executed'), 0) AS total_revenue,
        COALESCE(SUM(meetings_gen), 0) AS total_meetings
      FROM autonomous_action_queue WHERE org_id = ${orgId}
    `),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM autonomous_action_queue WHERE org_id = ${orgId} AND status = 'pending'`),
    db.execute(sql`SELECT COUNT(*) AS cnt FROM autonomy_overrides WHERE org_id = ${orgId}`),
    db.execute(sql`SELECT autonomy_score, recommended_mode, ceo_override_mode FROM decision_trust_registry WHERE org_id = ${orgId}`),
  ]);

  const toArr = (r: any) => Array.isArray(r) ? r : (r as any).rows ?? [];
  const a  = toArr(actionRows)[0] ?? {};
  const registry = toArr(registryRows);

  const avgTrustScore = registry.length > 0
    ? Math.round(registry.reduce((acc: number, r: any) => acc + (r.autonomy_score ?? 0), 0) / registry.length)
    : 0;

  const autoExecuteCount = registry.filter((r: any) => (r.ceo_override_mode ?? r.recommended_mode) === "execute").length;
  const pendingApprovalCount = parseInt(a.pending_count ?? "0");
  const todayExecuted = parseInt(a.today_executed ?? "0");
  const revenueInfluenced = parseInt(a.total_revenue ?? "0");
  const hoursSaved = todayExecuted * 0.25; // 15min per action

  // High risk pending count
  const highRiskPending = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM autonomous_action_queue
    WHERE org_id = ${orgId} AND status = 'pending' AND risk_level IN ('high','critical')
  `);
  const highRiskCount = parseInt((toArr(highRiskPending)[0])?.cnt ?? "0");

  return {
    todayExecuted,
    pendingApprovalCount,
    hoursSaved: Math.round(hoursSaved * 10) / 10,
    revenueInfluenced,
    avgTrustScore,
    autoExecuteCount,
    highRiskPending: highRiskCount,
    overrideCount: parseInt((toArr(overrideRows)[0])?.cnt ?? "0"),
    readinessScore: Math.min(100, Math.round((autoExecuteCount / Math.max(registry.length, 1)) * 100 * 0.5 + avgTrustScore * 0.5)),
  };
}

// ─── Trust flywheel metrics ───────────────────────────────────────────────────

export async function getTrustFlywheel(orgId: string) {
  const [reg, queue, outcomes, obsidian] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) AS total_types,
        AVG(autonomy_score) AS avg_score,
        COUNT(*) FILTER (WHERE recommended_mode = 'execute') AS auto_execute_types,
        COALESCE(SUM(executions), 0) AS total_executions,
        COALESCE(SUM(human_overrides), 0) AS total_overrides
      FROM decision_trust_registry WHERE org_id = ${orgId}
    `),
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'executed') AS executed,
        COALESCE(SUM(revenue_cents) FILTER (WHERE status = 'executed'), 0) AS revenue
      FROM autonomous_action_queue WHERE org_id = ${orgId}
    `),
    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE success_score >= 80) AS high_score
      FROM agent_decision_outcomes WHERE org_id = ${orgId}
    `).catch(() => ([{ total: 0, high_score: 0 }])),
    import("./obsidian-service").then((m) => m.getVaultStats()).catch(() => ({ totalNotes: 0 })),
  ]);

  const toArr = (r: any) => Array.isArray(r) ? r : (r as any).rows ?? [];
  const re = toArr(reg)[0]   ?? {};
  const qu = toArr(queue)[0] ?? {};
  const ou = toArr(outcomes)[0] ?? {};

  return {
    memoryCreated:    obsidian.totalNotes ?? 0,
    betterDecisions:  Math.round(parseFloat(re.avg_score ?? "0")),
    betterOutcomes:   parseInt(ou.high_score ?? "0"),
    higherTrust:      Math.round(parseFloat(re.avg_score ?? "0")),
    moreAutonomy:     parseInt(re.auto_execute_types ?? "0"),
    moreExecution:    parseInt(qu.executed ?? "0"),
    moreData:         parseInt(re.total_executions ?? "0"),
    revenueGenerated: Math.round(parseInt(qu.revenue ?? "0") / 100),
  };
}

// ─── Risk assessment breakdown ────────────────────────────────────────────────

export async function getRiskAssessment(orgId: string) {
  const rows = await db.execute(sql`
    SELECT
      risk_level,
      COUNT(*)                               AS count,
      AVG(autonomy_score)                    AS avg_score,
      COUNT(*) FILTER (WHERE recommended_mode = 'execute')   AS auto_count,
      COUNT(*) FILTER (WHERE recommended_mode = 'queue')     AS queue_count,
      COUNT(*) FILTER (WHERE recommended_mode = 'recommend') AS rec_count,
      COUNT(*) FILTER (WHERE recommended_mode = 'observe')   AS obs_count,
      COALESCE(SUM(human_overrides), 0)      AS total_overrides,
      COALESCE(SUM(executions), 0)           AS total_executions
    FROM decision_trust_registry WHERE org_id = ${orgId}
    GROUP BY risk_level
  `);
  const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

  return ["low", "medium", "high", "critical"].map((level) => {
    const r = arr.find((x: any) => x.risk_level === level) ?? {};
    return {
      riskLevel:      level,
      label:          RISK_LABELS[level as RiskLevel],
      ceiling:        RISK_CEILING[level as RiskLevel],
      count:          parseInt(r.count ?? "0"),
      avgScore:       Math.round(parseFloat(r.avg_score ?? "0")),
      autoCount:      parseInt(r.auto_count ?? "0"),
      queueCount:     parseInt(r.queue_count ?? "0"),
      recCount:       parseInt(r.rec_count ?? "0"),
      obsCount:       parseInt(r.obs_count ?? "0"),
      totalOverrides: parseInt(r.total_overrides ?? "0"),
      totalExecutions:parseInt(r.total_executions ?? "0"),
    };
  });
}
