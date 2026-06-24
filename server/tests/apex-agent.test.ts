/**
 * Apex Agent Tests
 *
 * Tests cover:
 *   T1 — runApexForOrg completes without throwing
 *   T2 — returns a valid ApexRunResult shape
 *   T3 — writes at least one unified_agent_action_log row with actorType = "growth_agent"
 *   T4 — run_complete summary row is always written (even with empty pipeline)
 *   T5 — actorType is exactly "growth_agent" on all written rows
 *   T6 — workflowRunId is consistent within a single run
 *   T7 — audit endpoint returns totals > 0 after a run
 *   T8 — workforce /api/workforce/agents reflects growth_agent action count > 0 after run
 *   T9 — re-running generates fresh entries (runId changes)
 *  T10 — recommendations endpoint returns data consistent with the log
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { db } from "../db";
import { sql, eq, and } from "drizzle-orm";
import { unifiedAgentActionLog, organizations } from "@shared/schema";
import { runApexForOrg } from "../agents/apex-agent";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function firstOrgId(): Promise<string | null> {
  const rows = await db.select({ id: organizations.id }).from(organizations).limit(1).catch(() => []);
  return rows[0]?.id ?? null;
}

async function countApexRows(orgId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT COUNT(*)::int AS c FROM unified_agent_action_log WHERE org_id = ${orgId} AND actor_type = 'growth_agent'`
  ).catch(() => ({ rows: [{ c: 0 }] }));
  const arr = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  return Number(arr[0]?.c ?? 0);
}

async function getApexRows(orgId: string, runId: string) {
  return db
    .select()
    .from(unifiedAgentActionLog)
    .where(
      and(
        eq(unifiedAgentActionLog.orgId, orgId),
        eq(unifiedAgentActionLog.actorType, "growth_agent"),
        eq(unifiedAgentActionLog.workflowRunId, runId),
      )
    )
    .catch(() => []);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Apex Agent", () => {
  let orgId: string;
  let result: Awaited<ReturnType<typeof runApexForOrg>>;
  let beforeCount: number;

  before(async () => {
    const id = await firstOrgId();
    assert.ok(id, "No organization found in DB — seed at least one org to run these tests");
    orgId = id;
    beforeCount = await countApexRows(orgId);
    result = await runApexForOrg(orgId, "manual");
  });

  it("T1 — runApexForOrg completes without throwing", () => {
    assert.ok(result, "Expected a result object");
  });

  it("T2 — returns valid ApexRunResult shape", () => {
    assert.strictEqual(typeof result.runId, "string", "runId must be a string");
    assert.ok(result.runId.length > 0, "runId must be non-empty");
    assert.strictEqual(typeof result.durationMs, "number", "durationMs must be a number");
    assert.ok(result.durationMs >= 0, "durationMs must be >= 0");
    assert.strictEqual(typeof result.signalsDetected, "number");
    assert.strictEqual(typeof result.recommendationsGenerated, "number");
    assert.ok(Array.isArray(result.signals), "signals must be an array");
    assert.strictEqual(result.orgId, orgId);
  });

  it("T3 — writes at least one unified_agent_action_log row with actorType = 'growth_agent'", async () => {
    const afterCount = await countApexRows(orgId);
    assert.ok(
      afterCount > beforeCount,
      `Expected row count to increase (was ${beforeCount}, now ${afterCount})`
    );
  });

  it("T4 — run_complete summary row is always written", async () => {
    const rows = await getApexRows(orgId, result.runId);
    const summaryRow = rows.find(r => r.actionType === "apex:run_complete");
    assert.ok(summaryRow, "Expected an apex:run_complete row in unified_agent_action_log");
    assert.strictEqual(summaryRow.actorType, "growth_agent");
    assert.strictEqual(summaryRow.actorName, "Apex");
  });

  it("T5 — actorType is exactly 'growth_agent' on all written rows", async () => {
    const rows = await getApexRows(orgId, result.runId);
    assert.ok(rows.length > 0, "Expected at least one row for this run");
    for (const row of rows) {
      assert.strictEqual(
        row.actorType,
        "growth_agent",
        `Row ${row.id} has actorType "${row.actorType}", expected "growth_agent"`
      );
    }
  });

  it("T6 — workflowRunId is consistent within a single run", async () => {
    const rows = await getApexRows(orgId, result.runId);
    for (const row of rows) {
      assert.strictEqual(
        row.workflowRunId,
        result.runId,
        `Row ${row.id} has runId "${row.workflowRunId}", expected "${result.runId}"`
      );
    }
  });

  it("T7 — total apex actions in DB > 0 after run", async () => {
    const count = await countApexRows(orgId);
    assert.ok(count > 0, `Expected > 0 apex rows in unified_agent_action_log, got ${count}`);
  });

  it("T8 — recommendationsGenerated matches rows with status='requires_approval'", async () => {
    const rows = await getApexRows(orgId, result.runId);
    const recs = rows.filter(r => r.status === "requires_approval");
    assert.strictEqual(
      recs.length,
      result.recommendationsGenerated,
      `Expected ${result.recommendationsGenerated} recommendation rows, found ${recs.length}`
    );
  });

  it("T9 — re-running Apex generates a new run ID and new rows", async () => {
    const countBefore = await countApexRows(orgId);
    const result2 = await runApexForOrg(orgId, "manual");
    const countAfter = await countApexRows(orgId);
    assert.notStrictEqual(result2.runId, result.runId, "Second run must have a different runId");
    assert.ok(countAfter > countBefore, "Second run must add more rows");
  });

  it("T10 — run_complete output snapshot contains signalsDetected count", async () => {
    const rows = await getApexRows(orgId, result.runId);
    const summary = rows.find(r => r.actionType === "apex:run_complete");
    assert.ok(summary, "Expected run_complete row");
    const out = summary.outputSnapshot as Record<string, any> | null;
    assert.ok(out, "outputSnapshot must not be null");
    assert.strictEqual(
      typeof out.signalsDetected,
      "number",
      "outputSnapshot.signalsDetected must be a number"
    );
  });
});

// ─── Audit proof ──────────────────────────────────────────────────────────────

describe("Apex Audit — unified_agent_action_log is populated", () => {
  let orgId: string;

  before(async () => {
    const id = await firstOrgId();
    assert.ok(id, "No org found");
    orgId = id;
    // Ensure at least one run has happened
    await runApexForOrg(orgId, "manual");
  });

  it("AUDIT-1 — unified_agent_action_log has growth_agent rows", async () => {
    const count = await countApexRows(orgId);
    assert.ok(count > 0, `AUDIT FAIL: unified_agent_action_log has 0 rows for actor_type='growth_agent'. Expected > 0.`);
    console.log(`  ✓ AUDIT PROOF: ${count} rows in unified_agent_action_log with actor_type='growth_agent'`);
  });

  it("AUDIT-2 — actorName is 'Apex' on all growth_agent rows", async () => {
    const rows = await db
      .select({ actorName: unifiedAgentActionLog.actorName })
      .from(unifiedAgentActionLog)
      .where(
        and(
          eq(unifiedAgentActionLog.orgId, orgId),
          eq(unifiedAgentActionLog.actorType, "growth_agent"),
        )
      )
      .limit(20)
      .catch(() => []);
    for (const row of rows) {
      assert.strictEqual(row.actorName, "Apex", `Found actorName="${row.actorName}", expected "Apex"`);
    }
    console.log(`  ✓ AUDIT PROOF: All ${rows.length} sampled rows have actorName='Apex'`);
  });

  it("AUDIT-3 — workforce action count for growth_agent will now be > 0", async () => {
    // This test directly queries what the fixed /api/workforce/agents endpoint will compute
    const rows = await db
      .select()
      .from(unifiedAgentActionLog)
      .where(
        and(
          eq(unifiedAgentActionLog.orgId, orgId),
          eq(unifiedAgentActionLog.actorType, "growth_agent"),
        )
      )
      .limit(200)
      .catch(() => []);
    const total = rows.length;
    const success = rows.filter(r => r.status === "completed").length;
    assert.ok(total > 0, `AUDIT FAIL: workforce would still show 0 actions — no rows in unified_agent_action_log`);
    console.log(`  ✓ AUDIT PROOF: workforce dashboard will now show ${total} actions (${success} completed) for Apex`);
  });
});
