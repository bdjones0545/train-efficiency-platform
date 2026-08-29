import type { Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";

type Executor = Pick<typeof db, "execute">;

const EXPECTED_COLUMNS = [
  ["id", "text", true, "gen_random_uuid()"],
  ["org_id", "text", true, null],
  ["severity", "text", true, "'medium'"],
  ["issue", "text", true, null],
  ["root_cause", "text", true, "''"],
  ["fix_applied", "text", true, "''"],
  ["files_modified", "text", true, "''"],
  ["outcome", "text", true, "''"],
  ["source", "text", true, "'Manual Entry'"],
  ["source_type", "text", true, "'human_admin'"],
  ["related_entity_type", "text", false, null],
  ["related_entity_id", "text", false, null],
  ["metadata", "jsonb", false, "'{}'"],
  ["created_at", "timestamp with time zone", true, "now()"],
  ["updated_at", "timestamp with time zone", true, "now()"],
] as const;

const EXPECTED_INDEXES = [
  ["org_id", false],
  ["severity", false],
  ["source_type", false],
  ["created_at", true],
] as const;

export class SoftwareKbSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super("Software KB unavailable");
    this.name = "SoftwareKbSchemaUnavailableError";
  }
}

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

function normalizeDefault(value: unknown): string | null {
  if (value == null) return null;
  return String(value)
    .replace(/::(?:text|jsonb)/g, "")
    .replace(/^\((.*)\)$/g, "$1");
}

function same(actual: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

/** Catalog-only validation. It never creates, alters, drops, or repairs schema. */
export async function validateSoftwareKbSchema(executor: Executor = db): Promise<void> {
  const [columnResult, constraintResult, indexResult] = await Promise.all([
    executor.execute(sql`SELECT a.attname column_name,
      format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull is_not_null,
      pg_get_expr(d.adbin,d.adrelid) column_default
      FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
      WHERE n.nspname=current_schema() AND t.relname='software_kb_entries'`),
    executor.execute(sql`SELECT c.contype,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)::text[] columns
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname='software_kb_entries' AND c.contype='p'`),
    executor.execute(sql`SELECT i.indisunique,i.indisprimary,i.indisvalid,
      i.indnkeyatts,i.indnatts,i.indexprs IS NULL expression_free,
      i.indpred IS NULL predicate_free,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ord)::text[] columns,
      ARRAY(SELECT (i.indoption[k.ord - 1] & 1) = 1 FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
        ORDER BY k.ord)::boolean[] descending
      FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname='software_kb_entries'`),
  ]);

  const columns = new Map(rows(columnResult).map(row => [row.column_name, row]));
  const constraints = rows(constraintResult);
  const indexes = rows(indexResult);
  const problems: string[] = [];

  for (const [name, type, notNull, expectedDefault] of EXPECTED_COLUMNS) {
    const found = columns.get(name);
    if (!found) { problems.push(`missing software_kb_entries.${name}`); continue; }
    if (found.data_type !== type) problems.push(`type software_kb_entries.${name}`);
    if (Boolean(found.is_not_null) !== notNull) problems.push(`nullability software_kb_entries.${name}`);
    if (normalizeDefault(found.column_default) !== expectedDefault) problems.push(`default software_kb_entries.${name}`);
  }
  if (!constraints.some(row => row.contype === "p" && same(row.columns, ["id"]))) {
    problems.push("primary key software_kb_entries(id)");
  }
  for (const [column, descending] of EXPECTED_INDEXES) {
    if (!indexes.some(row => !row.indisunique && !row.indisprimary && row.indisvalid
      && row.indnkeyatts === 1 && row.indnatts === 1 && row.expression_free && row.predicate_free
      && same(row.columns, [column]) && same(row.descending, [descending]))) {
      problems.push(`index software_kb_entries(${column}${descending ? " DESC" : ""})`);
    }
  }
  if (problems.length) throw new SoftwareKbSchemaUnavailableError(problems);
}

export function sendSoftwareKbUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof SoftwareKbSchemaUnavailableError)) return false;
  response.status(503).json({ message: "Software KB unavailable" });
  return true;
}
