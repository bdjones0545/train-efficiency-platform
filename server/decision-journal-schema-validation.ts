import { sql } from "drizzle-orm";
import type { Response } from "express";
import { db } from "./db";

type ColumnContract = {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
};

const COLUMNS: readonly ColumnContract[] = [
  { name: "id", type: "text", notNull: true, defaultValue: "gen_random_uuid()" },
  { name: "org_id", type: "text", notNull: true, defaultValue: null },
  { name: "agent", type: "text", notNull: true, defaultValue: null },
  { name: "source_type", type: "text", notNull: true, defaultValue: null },
  { name: "source", type: "text", notNull: true, defaultValue: null },
  { name: "decision", type: "text", notNull: true, defaultValue: null },
  { name: "reasoning", type: "text", notNull: true, defaultValue: "''" },
  { name: "outcome", type: "text", notNull: true, defaultValue: "''" },
  { name: "follow_up", type: "text", notNull: true, defaultValue: "''" },
  { name: "confidence", type: "integer", notNull: true, defaultValue: "75" },
  { name: "decision_type", type: "text", notNull: true, defaultValue: "'action'" },
  { name: "department", type: "text", notNull: true, defaultValue: "'operations'" },
  { name: "related_entity_type", type: "text", notNull: false, defaultValue: null },
  { name: "related_entity_id", type: "text", notNull: false, defaultValue: null },
  { name: "metadata", type: "jsonb", notNull: false, defaultValue: "'{}'" },
  { name: "created_at", type: "timestamp with time zone", notNull: true, defaultValue: "now()" },
  { name: "updated_at", type: "timestamp with time zone", notNull: true, defaultValue: "now()" },
] as const;

const INDEXES = [
  { columns: "org_id", descending: "false" },
  { columns: "source_type", descending: "false" },
  { columns: "agent", descending: "false" },
  { columns: "created_at", descending: "true" },
] as const;

export class DecisionJournalSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`decision journal schema is unavailable: ${problems.join(", ")}`);
    this.name = "DecisionJournalSchemaUnavailableError";
  }
}

export class DecisionJournalTenantUnavailableError extends Error {
  constructor() {
    super("decision journal tenant identity is unavailable");
    this.name = "DecisionJournalTenantUnavailableError";
  }
}

export function assertDecisionJournalTenant(orgId: unknown): asserts orgId is string {
  if (typeof orgId !== "string" || !orgId.trim() || orgId.trim().toLowerCase() === "default") {
    throw new DecisionJournalTenantUnavailableError();
  }
}

export function sendDecisionJournalUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof DecisionJournalSchemaUnavailableError)) return false;
  response.status(503).json({ message: "Decision Journal unavailable" });
  return true;
}

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

function normalizeDefault(value: unknown): string | null {
  if (value == null) return null;
  return String(value).toLowerCase().replace(/\s+/g, "")
    .replace(/::(?:text|jsonb|integer|timestampwithtimezone)/g, "")
    .replace(/^\((.*)\)$/g, "$1");
}

function same(actual: unknown, expected: string): boolean {
  return Array.isArray(actual) && actual.join(",") === expected;
}

/** Catalog-only validation. It never creates, alters, or repairs schema. */
export async function validateDecisionJournalSchema(
  executor: Pick<typeof db, "execute"> = db,
): Promise<void> {
  const foundColumns = rows(await executor.execute(sql`
    SELECT c.column_name, c.column_default,
      format_type(a.atttypid, a.atttypmod) AS canonical_type,
      a.attnotnull AS is_not_null
    FROM information_schema.columns c
    JOIN pg_namespace n ON n.nspname = c.table_schema
    JOIN pg_class t ON t.relnamespace = n.oid AND t.relname = c.table_name
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
    WHERE c.table_schema = current_schema()
      AND c.table_name = 'decision_journal_entries'
  `));

  const problems: string[] = [];
  for (const contract of COLUMNS) {
    const found = foundColumns.find(row => row.column_name === contract.name);
    if (!found) problems.push(`decision_journal_entries.${contract.name}`);
    else if (
      found.canonical_type !== contract.type
      || found.is_not_null !== contract.notNull
      || normalizeDefault(found.column_default) !== contract.defaultValue
    ) problems.push(`decision_journal_entries.${contract.name} contract mismatch`);
  }

  const keys = rows(await executor.execute(sql`
    SELECT i.indisprimary AS is_primary, i.indisunique AS is_unique,
      i.indisvalid AS is_valid, pg_get_expr(i.indpred, i.indrelid) AS predicate,
      array_agg(a.attname ORDER BY k.ordinality)::text[] AS columns,
      array_agg((i.indoption[k.ordinality - 1] & 1) = 1 ORDER BY k.ordinality)::boolean[] AS descending
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY k(attnum, ordinality) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = current_schema() AND t.relname = 'decision_journal_entries'
    GROUP BY i.indexrelid
  `));
  if (!keys.some(row => row.is_primary && row.is_valid && same(row.columns, "id"))) {
    problems.push("decision_journal_entries PRIMARY KEY(id)");
  }
  for (const contract of INDEXES) {
    if (!keys.some(row => !row.is_primary && !row.is_unique && row.is_valid && !row.predicate
      && same(row.columns, contract.columns) && same(row.descending, contract.descending))) {
      problems.push(`decision_journal_entries INDEX(${contract.columns})`);
    }
  }
  if (problems.length) throw new DecisionJournalSchemaUnavailableError(problems);
}
