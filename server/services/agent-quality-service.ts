/**
 * Agent Quality Service
 * Computes per-agent trust scores from feedback, approval, rejection,
 * edit-before-send, failure, and learning conversion data.
 * Runs across 7/30/90-day rolling windows.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export const TRUST_TIERS = ["training", "assisted", "trusted", "high_trust", "restricted"] as const;
export type TrustTier = typeof TRUST_TIERS[number];

export const TRUST_TIER_LABELS: Record<string, string> = {
  training:   "Training",
  assisted:   "Assisted",
  trusted:    "Trusted",
  high_trust: "High Trust",
  restricted: "Restricted",
};

export const TRUST_TIER_COLORS: Record<string, string> = {
  training:   "bg-gray-100 text-gray-700",
  assisted:   "bg-blue-100 text-blue-700",
  trusted:    "bg-green-100 text-green-700",
  high_trust: "bg-purple-100 text-purple-700",
  restricted: "bg-red-100 text-red-700",
};

const MIN_ACTIONS = 5;
const TIER_THRESHOLDS = { high_trust: 75, trusted: 55, assisted: 35 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rows(result: any): any[] {
  if (Array.isArray(result)) return result;
  return (result as any).rows ?? [];
}

function n(v: any): number { return Number(v ?? 0); }

function computeTier(score: number, totalActions: number, spike: boolean): TrustTier {
  if (spike) return "restricted";
  if (totalActions < MIN_ACTIONS) return "training";
  if (score >= TIER_THRESHOLDS.high_trust) return "high_trust";
  if (score >= TIER_THRESHOLDS.trusted) return "trusted";
  if (score >= TIER_THRESHOLDS.assisted) return "assisted";
  return "training";
}

function computeScore(p: {
  totalActions: number;
  approvedCount: number;
  rejectedCount: number;
  editedCount: number;
  failedCount: number;
  learningConversionCount: number;
  rejectionSpike: boolean;
}): number {
  if (p.totalActions < MIN_ACTIONS) return 0;
  const approvalRate   = p.approvedCount / p.totalActions;
  const rejectionRate  = p.rejectedCount / p.totalActions;
  const editRate       = p.approvedCount > 0 ? p.editedCount / p.approvedCount : 0;
  const failureRate    = (p.totalActions + p.failedCount) > 0
    ? p.failedCount / (p.totalActions + p.failedCount) : 0;
  const learningRate   = Math.min(p.learningConversionCount / p.totalActions, 1);

  let score = (
    approvalRate * 35 +
    (1 - rejectionRate) * 25 +
    (1 - editRate) * 15 +
    (1 - Math.min(failureRate, 1)) * 15 +
    learningRate * 10
  );
  if (p.rejectionSpike) score = Math.min(score, 50);
  return Math.round(score * 100) / 100;
}

// ─── Spike Detection ──────────────────────────────────────────────────────────

async function detectRejectionSpikes(orgId: string): Promise<Set<string>> {
  const result = await db.execute(sql`
    WITH w7 AS (
      SELECT agent_name, COALESCE(communication_domain,'all') AS domain,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE decision = 'rejected')::int AS rejected
      FROM agent_message_feedback
      WHERE org_id = ${orgId}
        AND created_at > NOW() - INTERVAL '7 days'
        AND agent_name IS NOT NULL
      GROUP BY agent_name, domain
    ),
    w30 AS (
      SELECT agent_name, COALESCE(communication_domain,'all') AS domain,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE decision = 'rejected')::int AS rejected
      FROM agent_message_feedback
      WHERE org_id = ${orgId}
        AND created_at > NOW() - INTERVAL '30 days'
        AND agent_name IS NOT NULL
      GROUP BY agent_name, domain
    )
    SELECT w7.agent_name, w7.domain
    FROM w7
    JOIN w30 ON w30.agent_name = w7.agent_name AND w30.domain = w7.domain
    WHERE w7.rejected >= 3
      AND w30.total > 0
      AND (w7.rejected::float / GREATEST(w7.total,1)) > (w30.rejected::float / GREATEST(w30.total,1)) * 1.5
  `).catch(() => []);
  const spikes = new Set<string>();
  for (const r of rows(result)) spikes.add(`${r.agent_name}::${r.domain}`);
  return spikes;
}

// ─── Main Computation ─────────────────────────────────────────────────────────

export async function computeAgentQualityScores(orgId: string): Promise<{ updated: number }> {
  const spikes = await detectRejectionSpikes(orgId);
  let updated = 0;

  for (const days of [7, 30, 90]) {
    // Aggregate across all domains per agent
    const aggResult = await db.execute(sql`
      SELECT
        COALESCE(agent_name, 'unknown') AS agent_name,
        'all' AS communication_domain,
        COUNT(*)::int AS total_actions,
        COUNT(*) FILTER (WHERE decision IN ('approved','edited_and_approved'))::int AS approved_count,
        COUNT(*) FILTER (WHERE decision = 'rejected')::int AS rejected_count,
        COUNT(*) FILTER (WHERE decision = 'edited_and_approved')::int AS edited_count,
        COUNT(*) FILTER (WHERE applied_to_future_runs = true)::int AS learning_conversion_count
      FROM agent_message_feedback
      WHERE org_id = ${orgId}
        AND created_at > NOW() - (${days} || ' days')::INTERVAL
        AND agent_name IS NOT NULL
      GROUP BY agent_name
    `).catch(() => []);

    // Per-domain breakdown
    const domainResult = await db.execute(sql`
      SELECT
        COALESCE(agent_name, 'unknown') AS agent_name,
        COALESCE(communication_domain, 'all') AS communication_domain,
        COUNT(*)::int AS total_actions,
        COUNT(*) FILTER (WHERE decision IN ('approved','edited_and_approved'))::int AS approved_count,
        COUNT(*) FILTER (WHERE decision = 'rejected')::int AS rejected_count,
        COUNT(*) FILTER (WHERE decision = 'edited_and_approved')::int AS edited_count,
        COUNT(*) FILTER (WHERE applied_to_future_runs = true)::int AS learning_conversion_count
      FROM agent_message_feedback
      WHERE org_id = ${orgId}
        AND created_at > NOW() - (${days} || ' days')::INTERVAL
        AND agent_name IS NOT NULL
      GROUP BY agent_name, communication_domain
    `).catch(() => []);

    // Failed actions from gmail_agent_actions
    const failedResult = await db.execute(sql`
      SELECT
        COALESCE(created_by_agent,'unknown') AS agent_name,
        COALESCE(communication_domain,'all') AS communication_domain,
        COUNT(*)::int AS failed_count
      FROM gmail_agent_actions
      WHERE org_id = ${orgId}
        AND status = 'failed'
        AND created_at > NOW() - (${days} || ' days')::INTERVAL
        AND created_by_agent IS NOT NULL
      GROUP BY created_by_agent, communication_domain
    `).catch(() => []);

    const failedMap: Record<string, number> = {};
    for (const r of rows(failedResult)) failedMap[`${r.agent_name}::${r.communication_domain}`] = n(r.failed_count);

    // Average confidence from learning rules (using createdBy as agent proxy)
    const confResult = await db.execute(sql`
      SELECT
        COALESCE(created_by,'unknown') AS agent_name,
        COALESCE(communication_domain,'all') AS communication_domain,
        AVG(confidence::numeric)::float AS avg_confidence
      FROM agent_message_learning_rules
      WHERE org_id = ${orgId}
        AND status = 'active'
        AND created_by IS NOT NULL
        AND created_at > NOW() - (${days} || ' days')::INTERVAL
      GROUP BY created_by, communication_domain
    `).catch(() => []);
    const confMap: Record<string, number> = {};
    for (const r of rows(confResult)) confMap[`${r.agent_name}::${r.communication_domain}`] = n(r.avg_confidence);

    const allRows = [...rows(aggResult), ...rows(domainResult)];

    for (const row of allRows) {
      const agentName: string     = row.agent_name;
      const domain: string        = row.communication_domain;
      const totalActions          = n(row.total_actions);
      const approvedCount         = n(row.approved_count);
      const rejectedCount         = n(row.rejected_count);
      const editedCount           = n(row.edited_count);
      const failedCount           = failedMap[`${agentName}::${domain}`] ?? 0;
      const learningCount         = n(row.learning_conversion_count);
      const avgConfidence         = confMap[`${agentName}::${domain}`] ?? null;
      const rejectionSpike        = spikes.has(`${agentName}::${domain}`);

      const qualityScore = computeScore({ totalActions, approvedCount, rejectedCount, editedCount, failedCount, learningConversionCount: learningCount, rejectionSpike });
      const trustTier    = computeTier(qualityScore, totalActions, rejectionSpike);

      const approvalRate          = totalActions > 0 ? approvedCount / totalActions : null;
      const rejectionRate         = totalActions > 0 ? rejectedCount / totalActions : null;
      const editRate              = approvedCount > 0 ? editedCount / approvedCount : null;
      const failureRate           = (totalActions + failedCount) > 0 ? failedCount / (totalActions + failedCount) : null;
      const learningConversionRate= totalActions > 0 ? learningCount / totalActions : null;

      await db.execute(sql`
        INSERT INTO agent_quality_scores (
          id, org_id, agent_name, communication_domain, window_days,
          total_actions, approved_count, rejected_count, edited_count,
          failed_count, override_count, learning_conversion_count,
          approval_rate, rejection_rate, edit_rate, failure_rate,
          learning_conversion_rate, average_confidence,
          quality_score, score_delta, trust_tier, rejection_spike,
          window_start, computed_at
        ) VALUES (
          gen_random_uuid()::text, ${orgId}, ${agentName}, ${domain}, ${days},
          ${totalActions}, ${approvedCount}, ${rejectedCount}, ${editedCount},
          ${failedCount}, ${editedCount}, ${learningCount},
          ${approvalRate}, ${rejectionRate}, ${editRate}, ${failureRate},
          ${learningConversionRate}, ${avgConfidence},
          ${qualityScore}, 0, ${trustTier}, ${rejectionSpike},
          NOW() - (${days} || ' days')::INTERVAL, NOW()
        )
        ON CONFLICT (org_id, agent_name, communication_domain, window_days)
        DO UPDATE SET
          total_actions            = EXCLUDED.total_actions,
          approved_count           = EXCLUDED.approved_count,
          rejected_count           = EXCLUDED.rejected_count,
          edited_count             = EXCLUDED.edited_count,
          failed_count             = EXCLUDED.failed_count,
          override_count           = EXCLUDED.override_count,
          learning_conversion_count= EXCLUDED.learning_conversion_count,
          approval_rate            = EXCLUDED.approval_rate,
          rejection_rate           = EXCLUDED.rejection_rate,
          edit_rate                = EXCLUDED.edit_rate,
          failure_rate             = EXCLUDED.failure_rate,
          learning_conversion_rate = EXCLUDED.learning_conversion_rate,
          average_confidence       = EXCLUDED.average_confidence,
          quality_score            = EXCLUDED.quality_score,
          score_delta              = EXCLUDED.quality_score - agent_quality_scores.quality_score,
          trust_tier               = EXCLUDED.trust_tier,
          rejection_spike          = EXCLUDED.rejection_spike,
          window_start             = EXCLUDED.window_start,
          computed_at              = EXCLUDED.computed_at
      `).catch(console.error);
      updated++;
    }
  }
  return { updated };
}

// ─── Report Queries ───────────────────────────────────────────────────────────

export async function getAgentQualityReport(orgId: string): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT aqs.*,
           ato.override_tier,
           ato.reason AS override_reason,
           ato.overridden_by,
           ato.created_at AS override_created_at
    FROM agent_quality_scores aqs
    LEFT JOIN agent_trust_overrides ato
      ON ato.org_id  = aqs.org_id
     AND ato.agent_name = aqs.agent_name
     AND ato.communication_domain = aqs.communication_domain
    WHERE aqs.org_id = ${orgId}
      AND aqs.window_days = 30
      AND aqs.communication_domain = 'all'
    ORDER BY aqs.quality_score DESC NULLS LAST
  `).catch(() => []);

  return rows(result).map((r: any) => ({
    ...r,
    effectiveTier: r.override_tier ?? r.trust_tier,
    hasOverride: !!r.override_tier,
  }));
}

export async function getAgentWindowScores(orgId: string, agentName: string): Promise<any> {
  const result = await db.execute(sql`
    SELECT aqs.*,
           ato.override_tier, ato.reason AS override_reason, ato.overridden_by
    FROM agent_quality_scores aqs
    LEFT JOIN agent_trust_overrides ato
      ON ato.org_id = aqs.org_id AND ato.agent_name = aqs.agent_name AND ato.communication_domain = aqs.communication_domain
    WHERE aqs.org_id = ${orgId}
      AND aqs.agent_name = ${agentName}
    ORDER BY aqs.window_days ASC, aqs.communication_domain ASC
  `).catch(() => []);
  return rows(result);
}

export async function getTrustTierForAgent(
  orgId: string,
  agentName: string,
  domain: string = "all",
): Promise<{ tier: TrustTier; requiresApproval: boolean; isAutoEligible: boolean }> {
  // Override takes precedence
  const overResult = await db.execute(sql`
    SELECT override_tier FROM agent_trust_overrides
    WHERE org_id = ${orgId} AND agent_name = ${agentName} AND communication_domain = ${domain}
    LIMIT 1
  `).catch(() => []);
  const overRow = rows(overResult)[0];
  if (overRow?.override_tier) {
    const tier = overRow.override_tier as TrustTier;
    return { tier, requiresApproval: tier !== "high_trust", isAutoEligible: tier === "high_trust" };
  }

  const scoreResult = await db.execute(sql`
    SELECT trust_tier, rejection_spike FROM agent_quality_scores
    WHERE org_id = ${orgId} AND agent_name = ${agentName}
      AND communication_domain = ${domain} AND window_days = 30
    ORDER BY computed_at DESC LIMIT 1
  `).catch(() => []);
  const scoreRow = rows(scoreResult)[0];
  const tier: TrustTier = (scoreRow?.rejection_spike ? "restricted" : (scoreRow?.trust_tier ?? "training")) as TrustTier;
  return {
    tier,
    requiresApproval: tier !== "high_trust",
    isAutoEligible: tier === "high_trust",
  };
}

export async function getAgentQualityRisks(orgId: string): Promise<any> {
  const report = await getAgentQualityReport(orgId);
  const withData = report.filter((r) => n(r.total_actions) >= 3);
  const sorted = [...withData].sort((a, b) => n(b.quality_score) - n(a.quality_score));

  const bestAgent  = sorted[0] ?? null;
  const worstAgent = sorted.length > 1 ? sorted[sorted.length - 1] : null;
  const spikeAgents = report.filter((r) => r.rejection_spike);

  const lcResult = await db.execute(sql`
    SELECT communication_domain,
           AVG(average_confidence)::float AS avg_conf,
           AVG(quality_score)::float AS avg_score
    FROM agent_quality_scores
    WHERE org_id = ${orgId} AND window_days = 30
      AND communication_domain != 'all'
      AND average_confidence IS NOT NULL AND total_actions >= 3
    GROUP BY communication_domain
    ORDER BY avg_conf ASC
    LIMIT 1
  `).catch(() => []);
  const lcRow = rows(lcResult)[0] ?? null;

  const risingResult = await db.execute(sql`
    SELECT agent_name,
           rejection_rate,
           score_delta,
           quality_score
    FROM agent_quality_scores
    WHERE org_id = ${orgId} AND window_days = 30
      AND communication_domain = 'all'
      AND score_delta < -10
    ORDER BY score_delta ASC
    LIMIT 3
  `).catch(() => []);

  return {
    bestAgent:  bestAgent  ? { agentName: bestAgent.agent_name,  score: bestAgent.quality_score,  tier: bestAgent.effectiveTier } : null,
    worstAgent: worstAgent ? { agentName: worstAgent.agent_name, score: worstAgent.quality_score, tier: worstAgent.effectiveTier } : null,
    rejectionSpikeAgents: spikeAgents.map((r) => ({
      agentName: r.agent_name,
      rejectionRate: r.rejection_rate,
      score: r.quality_score,
    })),
    lowConfidenceDomain: lcRow ? { domain: lcRow.communication_domain, avgConfidence: lcRow.avg_conf, avgScore: lcRow.avg_score } : null,
    decliningAgents: rows(risingResult).map((r: any) => ({
      agentName: r.agent_name,
      scoreDelta: r.score_delta,
      currentScore: r.quality_score,
    })),
    hasRisks: spikeAgents.length > 0 || rows(risingResult).length > 0 || (worstAgent && n(worstAgent.quality_score) < 30),
  };
}
