/**
 * Partnership Learning Agent — Department OS v2
 * Uses Learning Engine Framework entirely.
 * Maps partnership signals → framework Signal type → standard insights.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import type { Signal, Insight, LearningReport } from "../frameworks/department-os/learning-engine";
import {
  buildLearningReport,
  generateStandardInsights,
} from "../frameworks/department-os/learning-engine";

export type PartnershipLearningInsightV2 = Insight;

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }
function n(v: any): number   { return Number(v ?? 0); }

// ─── Signal mapper ────────────────────────────────────────────────────────────
// Maps partnership_learning_signals rows to the framework Signal interface.
// Partnerships don't have a strict "contacted/responded" funnel the same way
// as hiring, so we map: contacted = opportunity was in outreach_ready+,
// responded = replied, converted = meeting_requested, won = partnered.

function toSignal(r: any, orgId: string): Signal {
  const fitScore = n(r.fit_score);
  const replied  = Boolean(r.replied);
  const meeting  = Boolean(r.meeting_requested);
  const partnered = Boolean(r.partnered);
  const declined  = Boolean(r.declined);

  return {
    orgId,
    department:  "partnerships",
    entityId:    r.partnership_id ? String(r.partnership_id) : undefined,
    source:      r.source    ?? "unknown",
    category:    r.partnership_type ?? "general",
    score:       fitScore,
    contacted:   true,           // signal exists = outreach was attempted
    responded:   replied,
    converted:   meeting,        // "converted" = meeting requested
    terminal:    partnered || declined,
    won:         partnered,
    metadata:    {
      meetingRequested: meeting,
      declined:         declined,
    },
    recordedAt:  r.created_at ? new Date(r.created_at) : new Date(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function computePartnershipsLearningMetrics(orgId: string): Promise<{
  report:   LearningReport;
  insights: PartnershipLearningInsightV2[];
}> {
  const [rawSignals, countRows] = await Promise.all([
    db.execute(sql`
      SELECT * FROM partnership_learning_signals
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT 500
    `).then(rows),
    db.execute(sql`
      SELECT COUNT(*) as cnt FROM partnership_opportunities WHERE org_id = ${orgId}
    `).then(rows),
  ]);

  const signals      = rawSignals.map((r: any) => toSignal(r, orgId));
  const totalEntities = n(countRows[0]?.cnt);
  const declined      = signals.filter(s => s.metadata?.declined).length;
  const rejectionRate = signals.length > 0 ? Math.round((declined / signals.length) * 100) : 0;

  const insights = generateStandardInsights({
    department:      "partnerships",
    orgId,
    entityLabel:     "Partner",
    signals,
    totalEntities,
    rejectionRate,
    minVolumeTarget: 5,
  });

  const report = buildLearningReport("partnerships", orgId, signals, totalEntities, insights);

  return { report, insights };
}
