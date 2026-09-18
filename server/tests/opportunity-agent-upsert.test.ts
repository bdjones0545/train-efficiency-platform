import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";

/**
 * Both opportunity agents upsert one row per opportunity:
 *
 *   server/services/opportunity-qualification-agent.ts
 *     INSERT INTO opportunity_qualification_assessments ... ON CONFLICT (opportunity_id)
 *   server/services/opportunity-outreach-agent.ts
 *     INSERT INTO opportunity_outreach_drafts ... ON CONFLICT (opportunity_id)
 *
 * migrations/0007_autonomous_hermes_opportunity_schema.sql explicitly DROPS the
 * single-column unique constraint on opportunity_id (it was cross-tenant) and
 * replaces it with the tenant-scoped
 *
 *   opportunity_qualification_org_opportunity_unique (org_id, opportunity_id)
 *   opportunity_outreach_org_opportunity_unique      (org_id, opportunity_id)
 *
 * so `ON CONFLICT (opportunity_id)` matched no unique index and Postgres raised
 * 42P10 on every call — on the first insert as much as on a repeat. No
 * qualification assessment and no outreach draft was ever persisted.
 *
 * These tests call the real exported functions twice with the same key.
 */

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
process.env.OPENAI_API_KEY ??= "test-key-not-used";

const { Pool } = pg;
const pool = new Pool({ connectionString });

// The outreach agent asks OpenAI for the draft copy. The upsert underneath is
// what is under test, so the transport is stubbed at the client boundary —
// nothing else about generateOutreachDraft is replaced.
const openaiModule = await import("openai");
let openaiCalls = 0;
let openaiReply: Record<string, unknown> = {};
(openaiModule.default as any).prototype.post = async () => {
  openaiCalls += 1;
  return { choices: [{ message: { content: JSON.stringify(openaiReply) } }] };
};

const { runApplicationMigrations } = await import("../application-migrations");
const { qualifyOpportunity } = await import("../services/opportunity-qualification-agent");
const { generateOutreachDraft } = await import("../services/opportunity-outreach-agent");
const { pool: appPool } = await import("../db");

const orgId = `org-opportunity-${randomUUID()}`;

async function createOpportunity(overrides: Record<string, string | number> = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO opportunity_acquisition_opportunities
       (id, org_id, title, company, type, location, estimated_value, source, status, notes)
     VALUES ($1, $2, $3, $4, 'coaching', 'Remote', $5, 'manual', 'new', $6)`,
    [
      id,
      orgId,
      overrides.title ?? "Remote strength programming partner",
      overrides.company ?? "Northside Athletics",
      overrides.estimated_value ?? 24000,
      overrides.notes ?? "Wants scalable remote programming and athlete reporting.",
    ],
  );
  return id;
}

before(async () => {
  // opportunity_* tables live only in migrations/*.sql, not in shared/schema.ts,
  // so drizzle-kit push alone does not create them.
  await runApplicationMigrations(appPool as any);
  await pool.query(
    `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [orgId, "Opportunity Upsert Org", orgId],
  );
});

after(async () => {
  await pool.query(`DELETE FROM opportunity_outreach_drafts WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM opportunity_qualification_assessments WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM opportunity_acquisition_opportunities WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  await pool.end();
  await appPool.end();
});

test("qualifyOpportunity persists an assessment instead of raising 42P10", async () => {
  const opportunityId = await createOpportunity();
  const result = await qualifyOpportunity(orgId, opportunityId);

  const rows = await pool.query(
    `SELECT org_id, opportunity_id, fit_score FROM opportunity_qualification_assessments
      WHERE org_id = $1 AND opportunity_id = $2`,
    [orgId, opportunityId],
  );
  assert.equal(rows.rows.length, 1, "the assessment must be written");
  assert.equal(Number(rows.rows[0].fit_score), result.fitScore);
});

test("qualifying the same opportunity twice updates the one row", async () => {
  const opportunityId = await createOpportunity({ estimated_value: 1000, notes: "Sparse posting." });
  const first = await qualifyOpportunity(orgId, opportunityId);

  await pool.query(
    `UPDATE opportunity_acquisition_opportunities
        SET estimated_value = 90000,
            notes = 'Remote, fully digital delivery, needs automated programming, reporting, and athlete education at scale.'
      WHERE id = $1 AND org_id = $2`,
    [opportunityId, orgId],
  );
  const second = await qualifyOpportunity(orgId, opportunityId);

  const rows = await pool.query(
    `SELECT fit_score, recommended_action FROM opportunity_qualification_assessments
      WHERE org_id = $1 AND opportunity_id = $2`,
    [orgId, opportunityId],
  );
  assert.equal(rows.rows.length, 1, "the second call must UPDATE, not duplicate or fail");
  assert.notEqual(second.fitScore, first.fitScore, "the re-scored opportunity must differ");
  assert.equal(Number(rows.rows[0].fit_score), second.fitScore, "the stored row must hold the newest score");
  assert.equal(rows.rows[0].recommended_action, second.recommendedAction);
});

test("generateOutreachDraft persists a draft, and a second run updates it", async () => {
  const opportunityId = await createOpportunity();
  await qualifyOpportunity(orgId, opportunityId);

  openaiReply = {
    subject: "Scaling your remote programming",
    body: "First draft body.",
    callToAction: "Worth a 15-minute call?",
    positioningAngle: "Reduce programming load",
    confidenceScore: 71,
  };
  const first = await generateOutreachDraft(orgId, opportunityId);
  assert.equal(first.subject, "Scaling your remote programming");

  openaiReply = { ...openaiReply, subject: "Revised: scaling your remote programming", body: "Second draft body.", confidenceScore: 84 };
  const second = await generateOutreachDraft(orgId, opportunityId);

  const rows = await pool.query(
    `SELECT subject, body, confidence_score, status FROM opportunity_outreach_drafts
      WHERE org_id = $1 AND opportunity_id = $2`,
    [orgId, opportunityId],
  );
  assert.equal(rows.rows.length, 1, "the draft must be upserted, not duplicated — and never lost to 42P10");
  assert.equal(rows.rows[0].subject, second.subject);
  assert.equal(rows.rows[0].body, "Second draft body.");
  assert.equal(Number(rows.rows[0].confidence_score), 84);
  assert.equal(rows.rows[0].status, "draft");
  assert.equal(openaiCalls, 2, "both runs went through the real generation path");
});

test("the only unique index on either table is the tenant-scoped one the code now targets", async () => {
  const rows = await pool.query(
    `SELECT t.relname AS table_name, i.relname AS index_name, pg_get_indexdef(ix.indexrelid) AS def
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname IN ('opportunity_qualification_assessments', 'opportunity_outreach_drafts')
        AND ix.indisunique
      ORDER BY t.relname, i.relname`,
  );

  const byTable = new Map<string, string[]>();
  for (const row of rows.rows) {
    byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.def]);
  }

  for (const table of ["opportunity_qualification_assessments", "opportunity_outreach_drafts"]) {
    const defs = byTable.get(table) ?? [];
    assert.ok(
      defs.some((def) => /\(org_id, opportunity_id\)/.test(def)),
      `${table} must carry the tenant-scoped unique index the upsert targets`,
    );
    assert.ok(
      !defs.some((def) => /\(opportunity_id\)/.test(def)),
      `${table} has no single-column unique index on opportunity_id — targeting it can only raise 42P10`,
    );
  }
});
