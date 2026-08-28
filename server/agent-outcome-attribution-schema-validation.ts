import type { RequestHandler, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";

type Executor = Pick<typeof db, "execute">;

export class AgentOutcomeAttributionSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super("Agent Outcome Attribution unavailable");
    this.name = "AgentOutcomeAttributionSchemaUnavailableError";
  }
}

function rows(result: any): any[] { return Array.isArray(result) ? result : result?.rows ?? []; }
function sameColumns(actual: unknown, expected: string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

const EXPECTED_COLUMNS = [
  ["agent_decision_outcomes", "id", "text", true, "(gen_random_uuid())::text"],
  ["agent_decision_outcomes", "org_id", "text", true, null],
  ["agent_decision_outcomes", "agent_type", "text", true, null],
  ["agent_decision_outcomes", "recommendation", "text", true, null],
  ["agent_decision_outcomes", "action_taken", "text", false, null],
  ["agent_decision_outcomes", "expected_outcome", "text", false, null],
  ["agent_decision_outcomes", "actual_outcome", "text", false, null],
  ["agent_decision_outcomes", "success_score", "integer", false, null],
  ["agent_decision_outcomes", "domain", "text", false, null],
  ["agent_decision_outcomes", "tags", "jsonb", false, "'[]'::jsonb"],
  ["agent_decision_outcomes", "revenue_cents", "integer", false, "0"],
  ["agent_decision_outcomes", "meetings_generated", "integer", false, "0"],
  ["agent_decision_outcomes", "outcome_date", "timestamp with time zone", false, null],
  ["agent_decision_outcomes", "created_at", "timestamp with time zone", false, "now()"],
  ["agent_decision_outcomes", "updated_at", "timestamp with time zone", false, "now()"],
  ["agent_perf_scores", "id", "text", true, "(gen_random_uuid())::text"],
  ["agent_perf_scores", "org_id", "text", true, null],
  ["agent_perf_scores", "agent_type", "text", true, null],
  ["agent_perf_scores", "recommendations_issued", "integer", false, "0"],
  ["agent_perf_scores", "recommendations_executed", "integer", false, "0"],
  ["agent_perf_scores", "success_rate", "integer", false, "0"],
  ["agent_perf_scores", "revenue_influenced", "integer", false, "0"],
  ["agent_perf_scores", "meetings_generated", "integer", false, "0"],
  ["agent_perf_scores", "retention_impact", "integer", false, "0"],
  ["agent_perf_scores", "last_calculated_at", "timestamp with time zone", false, "now()"],
  ["ceo_daily_reviews", "id", "text", true, "(gen_random_uuid())::text"],
  ["ceo_daily_reviews", "org_id", "text", true, null],
  ["ceo_daily_reviews", "review_date", "date", true, null],
  ["ceo_daily_reviews", "what_worked", "text", true, null],
  ["ceo_daily_reviews", "what_failed", "text", true, null],
  ["ceo_daily_reviews", "what_repeat", "text", true, null],
  ["ceo_daily_reviews", "what_stop", "text", true, null],
  ["ceo_daily_reviews", "outcomes_analyzed", "integer", false, "0"],
  ["ceo_daily_reviews", "ai_generated", "boolean", false, "true"],
  ["ceo_daily_reviews", "created_at", "timestamp with time zone", false, "now()"],
  ["ceo_daily_reviews", "updated_at", "timestamp with time zone", false, "now()"],
  ["org_playbooks", "id", "text", true, "(gen_random_uuid())::text"],
  ["org_playbooks", "org_id", "text", true, null],
  ["org_playbooks", "title", "text", true, null],
  ["org_playbooks", "description", "text", false, null],
  ["org_playbooks", "source_learning", "text", false, null],
  ["org_playbooks", "pattern_type", "text", false, null],
  ["org_playbooks", "success_rate", "integer", false, "0"],
  ["org_playbooks", "evidence_count", "integer", false, "0"],
  ["org_playbooks", "trigger_condition", "text", false, null],
  ["org_playbooks", "actions", "text", false, null],
  ["org_playbooks", "expected_outcome", "text", false, null],
  ["org_playbooks", "status", "text", false, "'active'::text"],
  ["org_playbooks", "promoted_at", "timestamp with time zone", false, "now()"],
  ["org_playbooks", "created_at", "timestamp with time zone", false, "now()"],
] as const;

const TABLES = ["agent_decision_outcomes", "agent_perf_scores", "ceo_daily_reviews", "org_playbooks"] as const;

/** Catalog-only validation. It never creates, alters, drops, or repairs schema. */
export async function validateAgentOutcomeAttributionSchema(executor: Executor = db): Promise<void> {
  const results = await Promise.all([
      executor.execute(sql`SELECT t.relname table_name,a.attname column_name,
        format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull is_not_null,
        pg_get_expr(d.adbin,d.adrelid) column_default
        FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
        LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
        WHERE n.nspname=current_schema() AND t.relname IN
          ('agent_decision_outcomes','agent_perf_scores','ceo_daily_reviews','org_playbooks')`),
      executor.execute(sql`SELECT t.relname table_name,c.contype,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)::text[] columns
        FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname=current_schema() AND t.relname IN
          ('agent_decision_outcomes','agent_perf_scores','ceo_daily_reviews','org_playbooks') AND c.contype IN ('p','u')`),
      executor.execute(sql`SELECT t.relname table_name,i.indisunique,i.indisprimary,i.indisvalid,
        i.indnkeyatts,i.indnatts,i.indexprs IS NULL expression_free,i.indpred IS NULL predicate_free,
        ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ord)::text[] columns
        FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname=current_schema() AND t.relname IN
          ('agent_decision_outcomes','agent_perf_scores','ceo_daily_reviews','org_playbooks')`),
  ]);

  const columns = new Map(rows(results[0]).map(row => [`${row.table_name}.${row.column_name}`, row]));
  const constraints = rows(results[1]);
  const indexes = rows(results[2]);
  const problems: string[] = [];

  for (const [table, column, type, notNull, expectedDefault] of EXPECTED_COLUMNS) {
    const found = columns.get(`${table}.${column}`);
    if (!found) { problems.push(`missing ${table}.${column}`); continue; }
    if (found.data_type !== type) problems.push(`type ${table}.${column}`);
    if (Boolean(found.is_not_null) !== notNull) problems.push(`nullability ${table}.${column}`);
    if (expectedDefault === null ? found.column_default !== null : found.column_default !== expectedDefault) {
      problems.push(`default ${table}.${column}`);
    }
  }

  for (const table of TABLES) {
    if (!constraints.some(c => c.table_name === table && c.contype === "p" && sameColumns(c.columns, ["id"]))) {
      problems.push(`primary key ${table}`);
    }
  }

  const expectedUnique = (table: string, columns: string[]) => indexes.some(i => i.table_name === table
    && i.indisunique && !i.indisprimary && i.indisvalid && i.indnkeyatts === columns.length && i.indnatts === columns.length
    && i.expression_free && i.predicate_free && sameColumns(i.columns, columns));
  if (!expectedUnique("agent_perf_scores", ["org_id", "agent_type"])) problems.push("unique agent_perf_scores(org_id,agent_type)");
  if (!expectedUnique("ceo_daily_reviews", ["org_id", "review_date"])) problems.push("unique ceo_daily_reviews(org_id,review_date)");
  for (const index of indexes.filter(i => i.indisunique && !i.indisprimary)) {
    const expected = (index.table_name === "agent_perf_scores" && sameColumns(index.columns, ["org_id", "agent_type"]))
      || (index.table_name === "ceo_daily_reviews" && sameColumns(index.columns, ["org_id", "review_date"]));
    if (!expected) problems.push(`unexpected uniqueness ${index.table_name}`);
  }

  if (problems.length) throw new AgentOutcomeAttributionSchemaUnavailableError(problems);
}

export function sendAgentOutcomeAttributionUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof AgentOutcomeAttributionSchemaUnavailableError)) return false;
  response.status(503).json({ message: "Agent Outcome Attribution unavailable" });
  return true;
}

export const requireAgentOutcomeAttributionSchema: RequestHandler = async (_request, response, next) => {
  try { await validateAgentOutcomeAttributionSchema(); next(); }
  catch (error) {
    if (!sendAgentOutcomeAttributionUnavailable(error, response)) next(error);
  }
};
