import { sql } from "drizzle-orm";
import type { Response } from "express";
import { db } from "./db";

const COLUMNS = [
  { name: "id", type: "text", notNull: true, defaultValue: "gen_random_uuid()" },
  { name: "org_id", type: "text", notNull: true, defaultValue: null },
  { name: "conflict_type", type: "text", notNull: true, defaultValue: null },
  { name: "severity", type: "text", notNull: true, defaultValue: "'medium'" },
  { name: "entities", type: "text[]", notNull: false, defaultValue: "array[]" },
  { name: "agent_actions", type: "jsonb", notNull: false, defaultValue: "'[]'" },
  { name: "status", type: "text", notNull: true, defaultValue: "'open'" },
  { name: "resolution", type: "text", notNull: false, defaultValue: null },
  { name: "resolved_by", type: "text", notNull: false, defaultValue: null },
  { name: "resolved_at", type: "timestamp with time zone", notNull: false, defaultValue: null },
  { name: "created_at", type: "timestamp with time zone", notNull: false, defaultValue: "now()" },
] as const;

const INDEXES = ["org_id", "status", "conflict_type"] as const;

export class ConflictReviewSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`conflict review schema is unavailable: ${problems.join(", ")}`);
    this.name = "ConflictReviewSchemaUnavailableError";
  }
}

export class ConflictReviewTenantUnavailableError extends Error {
  constructor() {
    super("conflict review tenant identity is unavailable");
    this.name = "ConflictReviewTenantUnavailableError";
  }
}

export class ConflictReviewNotFoundError extends Error {
  constructor() {
    super("conflict not found");
    this.name = "ConflictReviewNotFoundError";
  }
}

export function assertConflictReviewTenant(orgId: unknown): asserts orgId is string {
  if (typeof orgId !== "string" || !orgId.trim() || orgId.trim().toLowerCase() === "default") {
    throw new ConflictReviewTenantUnavailableError();
  }
}

export function sendConflictReviewUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof ConflictReviewSchemaUnavailableError)) return false;
  response.status(503).json({ message: "Conflict Review unavailable" });
  return true;
}

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

function normalizeDefault(value: unknown): string | null {
  if (value == null) return null;
  return String(value).toLowerCase().replace(/\s+/g, "")
    .replace(/::(?:text\[\]|text|jsonb|timestampwithtimezone)/g, "")
    .replace(/^\((.*)\)$/g, "$1");
}

function same(actual: unknown, expected: string): boolean {
  return Array.isArray(actual) && actual.join(",") === expected;
}

/** Catalog-only validation. It never creates, alters, or repairs schema. */
export async function validateConflictReviewSchema(
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
    WHERE c.table_schema = current_schema() AND c.table_name = 'conflict_alerts'
  `));

  const problems: string[] = [];
  for (const contract of COLUMNS) {
    const found = foundColumns.find(row => row.column_name === contract.name);
    if (!found) problems.push(`conflict_alerts.${contract.name}`);
    else if (found.canonical_type !== contract.type || found.is_not_null !== contract.notNull
      || normalizeDefault(found.column_default) !== contract.defaultValue) {
      problems.push(`conflict_alerts.${contract.name} contract mismatch`);
    }
  }

  const keys = rows(await executor.execute(sql`
    SELECT i.indisprimary AS is_primary, i.indisunique AS is_unique,
      i.indisvalid AS is_valid, pg_get_expr(i.indpred, i.indrelid) AS predicate,
      array_agg(a.attname ORDER BY k.ordinality)::text[] AS columns,
      array_agg((i.indoption[k.ordinality - 1] & 1) = 1 ORDER BY k.ordinality)::boolean[] AS descending
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY k(attnum, ordinality) ON true
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE n.nspname=current_schema() AND t.relname='conflict_alerts'
    GROUP BY i.indexrelid
  `));
  if (!keys.some(row => row.is_primary && row.is_valid && same(row.columns, "id"))) {
    problems.push("conflict_alerts PRIMARY KEY(id)");
  }
  for (const column of INDEXES) {
    if (!keys.some(row => !row.is_primary && !row.is_unique && row.is_valid && !row.predicate
      && same(row.columns, column) && same(row.descending, "false"))) {
      problems.push(`conflict_alerts INDEX(${column})`);
    }
  }
  if (problems.length) throw new ConflictReviewSchemaUnavailableError(problems);
}
