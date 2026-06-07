/**
 * Opportunity Acquisition Orchestrator — Phase 6
 * Runs the full acquisition cycle:
 *   Discovery → Qualification → Outreach Draft Generation → Cycle Summary
 * No emails sent. No auto-apply. Outreach drafts only.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { runOpportunityDiscovery }  from "./opportunity-discovery-agent";
import { qualifyOpportunity }       from "./opportunity-qualification-agent";
import { generateOutreachDraft }    from "./opportunity-outreach-agent";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CycleResult {
  cycleId:       string;
  status:        "completed" | "partial_failure" | "failed" | "running";
  scanned:       number;
  discovered:    number;
  duplicates:    number;
  rejected:      number;
  qualified:     number;
  draftsCreated: number;
  errors:        string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? null;
}
function n(v: unknown): number {
  return Number(v ?? 0);
}

// ─── Table bootstrap ──────────────────────────────────────────────────────────

export async function ensureCyclesTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS opportunity_acquisition_cycles (
      id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id              TEXT NOT NULL,
      started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at        TIMESTAMPTZ,
      status              TEXT NOT NULL DEFAULT 'running',
      scanned_count       INTEGER NOT NULL DEFAULT 0,
      discovered_count    INTEGER NOT NULL DEFAULT 0,
      duplicates_skipped  INTEGER NOT NULL DEFAULT 0,
      rejected_count      INTEGER NOT NULL DEFAULT 0,
      qualified_count     INTEGER NOT NULL DEFAULT 0,
      drafts_created      INTEGER NOT NULL DEFAULT 0,
      errors              JSONB NOT NULL DEFAULT '[]',
      notes               TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ─── Agent event helper ───────────────────────────────────────────────────────

async function logEvent(orgId: string, action: string, eventType = "scan"): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO opportunity_agent_events (org_id, agent_name, action, event_type)
      VALUES (${orgId}, 'Acquisition Orchestrator', ${action}, ${eventType})
    `);
  } catch { /* non-fatal */ }
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

export async function runOpportunityAcquisitionCycle(orgId: string): Promise<CycleResult> {
  await ensureCyclesTable();

  // ── Guard: prevent concurrent cycles ────────────────────────────────────────
  const running = row0(await db.execute(sql`
    SELECT id FROM opportunity_acquisition_cycles
    WHERE org_id     = ${orgId}
      AND status     = 'running'
      AND started_at > NOW() - INTERVAL '30 minutes'
    LIMIT 1
  `));
  if (running) {
    throw Object.assign(new Error("An acquisition cycle is already running."), { status: 409 });
  }

  // ── Create cycle record ─────────────────────────────────────────────────────
  const cycleRow = row0(await db.execute(sql`
    INSERT INTO opportunity_acquisition_cycles (org_id, status)
    VALUES (${orgId}, 'running')
    RETURNING id
  `));
  const cycleId: string = cycleRow?.id ?? "unknown";

  await logEvent(orgId, "Acquisition Cycle Started.", "scan");

  const errors: string[] = [];
  let scanned    = 0;
  let discovered = 0;
  let duplicates = 0;
  let rejected   = 0;
  let qualified  = 0;
  let draftsCreated = 0;

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 1 — Discovery
  // ════════════════════════════════════════════════════════════════════════════
  try {
    const disc = await runOpportunityDiscovery(orgId);
    scanned    = disc.scanned;
    discovered = disc.created;
    duplicates = disc.duplicates;
    rejected   = disc.rejected;

    await logEvent(orgId,
      `Discovery Step Completed: ${scanned} scanned, ${discovered} created, ${duplicates} dupes, ${rejected} rejected.`,
      "scan",
    );
  } catch (e: any) {
    const msg = `Discovery failed: ${e.message}`;
    errors.push(msg);
    await logEvent(orgId, `Acquisition Cycle Failed — ${msg}`, "info");

    await db.execute(sql`
      UPDATE opportunity_acquisition_cycles SET
        completed_at = NOW(), status = 'failed',
        errors = ${JSON.stringify([msg])}::jsonb
      WHERE id = ${cycleId}
    `);
    return { cycleId, status: "failed", scanned, discovered, duplicates, rejected, qualified, draftsCreated, errors };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 2 — Qualification (new / unassessed opportunities)
  // ════════════════════════════════════════════════════════════════════════════
  try {
    const unassessed = rows(await db.execute(sql`
      SELECT o.id
      FROM opportunity_acquisition_opportunities o
      LEFT JOIN opportunity_qualification_assessments a ON a.opportunity_id = o.id
      WHERE o.org_id  = ${orgId}
        AND o.status NOT IN ('rejected', 'lost', 'won')
        AND a.id IS NULL
      ORDER BY o.created_at DESC
      LIMIT 30
    `));

    for (const row of unassessed) {
      try {
        await qualifyOpportunity(orgId, row.id);
        qualified++;
      } catch (e: any) {
        errors.push(`Qualify ${row.id}: ${e.message}`);
      }
    }

    await logEvent(orgId,
      `Qualification Step Completed: ${qualified} opportunities scored (${errors.filter(e => e.startsWith("Qualify")).length} errors).`,
      "qualify",
    );
  } catch (e: any) {
    errors.push(`Qualification step error: ${e.message}`);
    await logEvent(orgId, `Qualification Step Error: ${e.message}`, "info");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 3 — Outreach Draft Generation (fit ≥ 65, no draft yet)
  // ════════════════════════════════════════════════════════════════════════════
  try {
    const draftCandidates = rows(await db.execute(sql`
      SELECT o.id
      FROM opportunity_acquisition_opportunities o
      LEFT JOIN opportunity_outreach_drafts d ON d.opportunity_id = o.id
      WHERE o.org_id       = ${orgId}
        AND o.status NOT IN ('rejected', 'lost')
        AND o.fit_score    >= 65
        AND d.id IS NULL
      ORDER BY o.fit_score DESC
      LIMIT 20
    `));

    for (const row of draftCandidates) {
      try {
        await generateOutreachDraft(orgId, row.id);
        draftsCreated++;
      } catch (e: any) {
        errors.push(`Draft ${row.id}: ${e.message}`);
      }
    }

    await logEvent(orgId,
      `Outreach Draft Step Completed: ${draftsCreated} drafts created (${errors.filter(e => e.startsWith("Draft")).length} errors).`,
      "draft",
    );
  } catch (e: any) {
    errors.push(`Outreach draft step error: ${e.message}`);
    await logEvent(orgId, `Outreach Draft Step Error: ${e.message}`, "info");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 4 — Finalize cycle record
  // ════════════════════════════════════════════════════════════════════════════
  const status: CycleResult["status"] = errors.length === 0
    ? "completed"
    : (discovered > 0 || qualified > 0 || draftsCreated > 0)
      ? "partial_failure"
      : "failed";

  await db.execute(sql`
    UPDATE opportunity_acquisition_cycles SET
      completed_at       = NOW(),
      status             = ${status},
      scanned_count      = ${scanned},
      discovered_count   = ${discovered},
      duplicates_skipped = ${duplicates},
      rejected_count     = ${rejected},
      qualified_count    = ${qualified},
      drafts_created     = ${draftsCreated},
      errors             = ${JSON.stringify(errors)}::jsonb
    WHERE id = ${cycleId}
  `);

  const summary = `Acquisition Cycle ${status === "completed" ? "Completed" : status === "partial_failure" ? "Completed with Partial Failures" : "Failed"}: ${scanned} scanned, ${discovered} created, ${qualified} qualified, ${draftsCreated} drafts generated.`;

  await logEvent(orgId, summary, status === "completed" ? "scan" : "info");

  return { cycleId, status, scanned, discovered, duplicates, rejected, qualified, draftsCreated, errors };
}
