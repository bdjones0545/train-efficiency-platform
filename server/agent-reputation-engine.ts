/**
 * Agent Reputation Engine — Phase 7
 *
 * Computes composite reputation scores from all quality signals:
 * reviews, ROI, trust, benchmark stability, forecast accuracy,
 * certification level, and adoption rate.
 *
 * This is the foundation of the future Glassdoor-style agent rankings.
 * Scores are publicly comparable — no org-identifying data exposed.
 */

import { db } from "./db";
import {
  agentReputation,
  agentReviews,
  agentBenchmarks,
  agentCertifications,
  agentTemplates,
  agentLifecycleEvents,
  crossOrgLearningEvents,
} from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { AGENT_IDENTITIES } from "./agent-identities";
import { seedAgentTemplates } from "./agent-benchmark-engine";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReputationScore {
  agentId: string;
  agentName: string;
  reputationScore: number;         // 0–100
  marketplaceRank: number;
  trustTier: string;
  recommendationScore: number;     // 0–100
  avgRating: number;               // 0–5
  reviewCount: number;
  breakdown: {
    reviews: number;               // 0–25
    roi: number;                   // 0–20
    trust: number;                 // 0–20
    benchmarkStability: number;    // 0–15
    certification: number;         // 0–10
    adoption: number;              // 0–10
  };
  insights: string[];
}

const CERT_SCORES: Record<string, number> = {
  platform_recommended: 10,
  elite_performer: 9,
  high_performer: 7,
  certified: 5,
  uncertified: 0,
};

const TRUST_TIERS: Array<{ min: number; tier: string }> = [
  { min: 90, tier: "Market Leader" },
  { min: 75, tier: "Highly Trusted" },
  { min: 60, tier: "Trusted" },
  { min: 40, tier: "Building Trust" },
  { min: 0,  tier: "New to Market" },
];

// ─── Compute Single Agent Reputation ─────────────────────────────────────────

export async function computeAgentReputation(agentId: string): Promise<ReputationScore> {
  const identity = AGENT_IDENTITIES[agentId];

  const [reviews, benchmarkRows, certRows, templateRows] = await Promise.all([
    db.select().from(agentReviews).where(eq(agentReviews.agentId, agentId)).catch(() => []),
    db.select().from(agentBenchmarks).where(
      and(eq(agentBenchmarks.agentId, agentId), eq(agentBenchmarks.benchmarkType, "platform"))
    ).orderBy(desc(agentBenchmarks.createdAt)).limit(10).catch(() => []),
    db.select().from(agentCertifications).where(eq(agentCertifications.agentId, agentId)).catch(() => []),
    db.select().from(agentTemplates).where(eq(agentTemplates.agentId, agentId)).catch(() => []),
  ]);

  const template = templateRows[0];
  const cert = certRows[0];

  // ── Component 1: Reviews (25 pts) ────────────────────────────────────────
  const avgRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + (r.rating ?? 0), 0) / reviews.length
    : 0;
  const reviewScore = Math.round((avgRating / 5) * 20 + Math.min(5, reviews.length));

  // ── Component 2: ROI (20 pts) ─────────────────────────────────────────────
  const latestBench = benchmarkRows[0];
  const roi = latestBench?.roi ?? template?.averageRoi ?? 0;
  const roiScore = Math.min(20, Math.round(roi * 4));

  // ── Component 3: Trust (20 pts) ───────────────────────────────────────────
  const trustRaw = latestBench?.trustScore ?? template?.averageTrustScore ?? 0;
  const trustScore = Math.round(trustRaw * 0.2);

  // ── Component 4: Benchmark Stability (15 pts) ─────────────────────────────
  // Stability = consistency of sample size and success rates over time
  let stabilityScore = 0;
  if (benchmarkRows.length >= 3) {
    const rates = benchmarkRows.map(b => b.successRate ?? 0);
    const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
    const variance = rates.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / rates.length;
    stabilityScore = Math.round(Math.max(0, 15 - variance * 100));
  } else if (benchmarkRows.length >= 1) {
    stabilityScore = 5; // some data
  }

  // ── Component 5: Certification (10 pts) ───────────────────────────────────
  const certLevel = cert?.certificationLevel ?? template?.certificationLevel ?? "uncertified";
  const certScore = CERT_SCORES[certLevel] ?? 0;

  // ── Component 6: Adoption (10 pts) ────────────────────────────────────────
  const installCount = template?.installationCount ?? 0;
  const adoptionScore = Math.min(10, installCount);

  const total = reviewScore + roiScore + trustScore + stabilityScore + certScore + adoptionScore;
  const reputationScore = Math.min(100, Math.max(0, total));

  const tier = TRUST_TIERS.find(t => reputationScore >= t.min)?.tier ?? "New to Market";

  const recommendationScore = Math.round(
    (avgRating / 5) * 40 +
    Math.min(30, roi * 6) +
    Math.min(30, reputationScore * 0.3)
  );

  const insights: string[] = [];
  if (reviews.length === 0) insights.push("No org reviews yet — first reviewer earns bonus visibility");
  else if (avgRating >= 4.5) insights.push(`Exceptional rating: ${avgRating.toFixed(1)}/5 across ${reviews.length} reviews`);
  else if (avgRating < 3.0) insights.push("Below-average rating — review feedback and improve agent configurations");

  if (roi >= 4) insights.push(`Outstanding ROI: ${roi.toFixed(1)}x — qualifies for Elite certification`);
  else if (roi === 0) insights.push("No ROI data yet — agent needs activation across orgs to generate benchmarks");

  if (certLevel === "platform_recommended") insights.push("Platform Recommended — top certification tier achieved");
  else if (certLevel === "uncertified") insights.push("Not yet certified — run benchmark refresh to compute certification");

  if (benchmarkRows.length < 3) insights.push("More benchmark snapshots needed for stability scoring");

  return {
    agentId,
    agentName: identity?.agentName ?? template?.agentName ?? agentId,
    reputationScore,
    marketplaceRank: 0, // set by generateAllReputationScores
    trustTier: tier,
    recommendationScore: Math.min(100, recommendationScore),
    avgRating: Math.round(avgRating * 10) / 10,
    reviewCount: reviews.length,
    breakdown: {
      reviews: reviewScore,
      roi: roiScore,
      trust: trustScore,
      benchmarkStability: stabilityScore,
      certification: certScore,
      adoption: adoptionScore,
    },
    insights,
  };
}

// ─── Generate All Reputation Scores ──────────────────────────────────────────

export async function generateAllReputationScores(): Promise<ReputationScore[]> {
  await seedAgentTemplates();
  const templates = await db.select({ agentId: agentTemplates.agentId }).from(agentTemplates).catch(() => []);
  const allAgentIds = [...Object.keys(AGENT_IDENTITIES), ...templates.map(t => t.agentId).filter(Boolean)];
  const uniqueIds = [...new Set(allAgentIds)];

  const scores = await Promise.all(uniqueIds.map(id => computeAgentReputation(id).catch(() => null)));
  const valid = scores.filter(Boolean) as ReputationScore[];

  // Assign ranks
  const sorted = valid.sort((a, b) => b.reputationScore - a.reputationScore);
  for (let i = 0; i < sorted.length; i++) sorted[i].marketplaceRank = i + 1;

  // Persist to DB
  for (const score of sorted) {
    const existing = await db.select({ id: agentReputation.id }).from(agentReputation).where(
      eq(agentReputation.agentId, score.agentId)
    ).catch(() => []);

    const upsertData = {
      agentId: score.agentId,
      reputationScore: score.reputationScore,
      marketplaceRank: score.marketplaceRank,
      trustTier: score.trustTier,
      recommendationScore: score.recommendationScore,
      avgRating: score.avgRating,
      reviewCount: score.reviewCount,
      roiContribution: score.breakdown.roi,
      trustContribution: score.breakdown.trust,
      certificationContribution: score.breakdown.certification,
      adoptionContribution: score.breakdown.adoption,
      benchmarkStabilityContribution: score.breakdown.benchmarkStability,
      computedAt: new Date(),
    };

    if (existing.length > 0) {
      await db.update(agentReputation).set(upsertData).where(eq(agentReputation.agentId, score.agentId)).catch(() => {});
    } else {
      await db.insert(agentReputation).values(upsertData).catch(() => {});
    }
  }

  return sorted;
}

// ─── Get All Reputation Records ───────────────────────────────────────────────

export async function getAllReputationRecords(): Promise<ReputationScore[]> {
  const records = await db.select().from(agentReputation).orderBy(agentReputation.marketplaceRank).catch(() => []);

  if (records.length === 0) return generateAllReputationScores();

  return records.map(r => ({
    agentId: r.agentId,
    agentName: AGENT_IDENTITIES[r.agentId]?.agentName ?? r.agentId,
    reputationScore: r.reputationScore ?? 0,
    marketplaceRank: r.marketplaceRank ?? 0,
    trustTier: r.trustTier ?? "New to Market",
    recommendationScore: r.recommendationScore ?? 0,
    avgRating: r.avgRating ?? 0,
    reviewCount: r.reviewCount ?? 0,
    breakdown: {
      reviews: 0,
      roi: r.roiContribution ?? 0,
      trust: r.trustContribution ?? 0,
      benchmarkStability: r.benchmarkStabilityContribution ?? 0,
      certification: r.certificationContribution ?? 0,
      adoption: r.adoptionContribution ?? 0,
    },
    insights: [],
  }));
}

// ─── Ecosystem Analytics ──────────────────────────────────────────────────────

export async function computeEcosystemAnalytics(): Promise<Record<string, any>> {
  await seedAgentTemplates();

  const [templates, submissions, installs, reviews, reputation, devAccounts, revenueEvents] = await Promise.all([
    db.select().from(agentTemplates).catch(() => []),
    db.select().from(agentSubmissions).catch(() => []),
    db.execute(sql`SELECT agent_id, count(*) as cnt FROM org_installed_agents WHERE status='active' GROUP BY agent_id`).catch(() => ({ rows: [] })),
    db.select().from(agentReviews).catch(() => []),
    db.select().from(agentReputation).orderBy(agentReputation.reputationScore).catch(() => []),
    db.select().from(developerAccounts).catch(() => []),
    db.select().from(agentRevenueEvents).catch(() => []),
  ]);

  const installRows = Array.isArray(installs) ? installs : (installs as any).rows ?? [];
  const totalInstalls = installRows.reduce((s: number, r: any) => s + Number(r.cnt ?? 0), 0);
  const totalRevenue = revenueEvents.reduce((s, e) => s + (e.amount ?? 0), 0);
  const totalRoyalties = revenueEvents.reduce((s, e) => s + (e.royaltyAmount ?? 0), 0);

  const published = templates.filter(t => t.status === "active");
  const topRated = [...reviews].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 3);
  const topReputation = reputation.slice(-5).reverse();

  const avgRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + (r.rating ?? 0), 0) / reviews.length
    : 0;

  return {
    totalAgents: templates.length,
    publishedAgents: published.length,
    developers: devAccounts.length,
    totalInstalls,
    totalReviews: reviews.length,
    avgRating: Math.round(avgRating * 10) / 10,
    marketplaceRevenue: Math.round(totalRevenue),
    totalRoyaltiesPaid: Math.round(totalRoyalties),
    pendingSubmissions: submissions.filter(s => s.submissionStatus === "submitted" || s.submissionStatus === "under_review").length,
    topRatedAgents: topRated.map(r => ({
      agentId: r.agentId,
      agentName: AGENT_IDENTITIES[r.agentId]?.agentName ?? r.agentId,
      rating: r.rating,
    })),
    topReputationAgents: topReputation.map(r => ({
      agentId: r.agentId,
      agentName: AGENT_IDENTITIES[r.agentId]?.agentName ?? r.agentId,
      reputationScore: r.reputationScore,
      trustTier: r.trustTier,
    })),
    certificationBreakdown: {
      platform_recommended: templates.filter(t => t.certificationLevel === "platform_recommended").length,
      elite_performer: templates.filter(t => t.certificationLevel === "elite_performer").length,
      high_performer: templates.filter(t => t.certificationLevel === "high_performer").length,
      certified: templates.filter(t => t.certificationLevel === "certified").length,
      uncertified: templates.filter(t => !t.certificationLevel || t.certificationLevel === "uncertified").length,
    },
  };
}
