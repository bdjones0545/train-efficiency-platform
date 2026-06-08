/**
 * Sponsorship Learning Agent — Department OS v2
 * Uses Learning Engine Framework entirely.
 * Maps sponsorship signals → framework Signal type → standard insights.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import type { Signal, Insight, LearningReport } from "../frameworks/department-os/learning-engine";
import {
  buildLearningReport,
  generateStandardInsights,
} from "../frameworks/department-os/learning-engine";

export type SponsorshipLearningInsight = Insight;

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }
function n(v: any): number   { return Number(v ?? 0); }

// ─── Signal mapper ────────────────────────────────────────────────────────────
// Maps sponsorship_learning_signals rows to the framework Signal interface.
// responded = responded to outreach
// converted = meeting_requested (serious interest)
// won       = sponsored (deal closed)

function toSignal(r: any, orgId: string): Signal {
  const fitScore         = n(r.fit_score);
  const responded        = Boolean(r.responded);
  const meetingRequested = Boolean(r.meeting_requested);
  const sponsored        = Boolean(r.sponsored);
  const declined         = Boolean(r.declined);

  return {
    orgId,
    department: "sponsorships",
    entityId:   r.sponsorship_id ? String(r.sponsorship_id) : undefined,
    source:     r.source          ?? "unknown",
    category:   r.sponsorship_type ?? "general",
    score:      fitScore,
    contacted:  true,
    responded,
    converted:  meetingRequested,
    terminal:   sponsored || declined,
    won:        sponsored,
    metadata:   {
      meetingRequested,
      proposalRequested: Boolean(r.proposal_requested),
      declined,
    },
    recordedAt: r.created_at ? new Date(r.created_at) : new Date(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function computeSponsorshipsLearningMetrics(orgId: string): Promise<{
  report:   LearningReport;
  insights: SponsorshipLearningInsight[];
}> {
  const [rawSignals, countRows] = await Promise.all([
    db.execute(sql`
      SELECT * FROM sponsorship_learning_signals
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT 500
    `).then(rows),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM sponsorship_opportunities WHERE org_id = ${orgId}
    `).then(rows),
  ]);

  const signals       = rawSignals.map((r: any) => toSignal(r, orgId));
  const totalEntities = n(countRows[0]?.cnt);
  const declined      = signals.filter(s => s.metadata?.declined).length;
  const rejectionRate = signals.length > 0 ? Math.round((declined / signals.length) * 100) : 0;

  const insights = generateStandardInsights({
    department:      "sponsorships",
    orgId,
    entityLabel:     "Sponsor",
    signals,
    totalEntities,
    rejectionRate,
    minVolumeTarget: 5,
  });

  const report = buildLearningReport("sponsorships", orgId, signals, totalEntities, insights);

  return { report, insights };
}
