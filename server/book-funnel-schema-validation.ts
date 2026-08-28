import type { Response, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";

type Executor = Pick<typeof db, "execute">;

export class BookFunnelSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super("Book Funnel unavailable");
    this.name = "BookFunnelSchemaUnavailableError";
  }
}

function rows(result: any): any[] { return Array.isArray(result) ? result : result?.rows ?? []; }
function sameColumns(actual: unknown, expected: string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

const EXPECTED_COLUMNS = [
  ["book_funnel_leads", "id", "character varying", true, "(gen_random_uuid())::text"],
  ["book_funnel_leads", "first_name", "text", true, null],
  ["book_funnel_leads", "last_name", "text", false, null],
  ["book_funnel_leads", "email", "text", true, null],
  ["book_funnel_leads", "source", "text", false, "'book_landing'::text"],
  ["book_funnel_leads", "amazon_clicked_at", "timestamp without time zone", false, null],
  ["book_funnel_leads", "created_at", "timestamp without time zone", false, "now()"],
  ["book_funnel_leads", "updated_at", "timestamp without time zone", false, "now()"],
  ["book_funnel_leads", "bonus_email_sent_at", "timestamp without time zone", false, null],
  ["book_funnel_events", "id", "character varying", true, "(gen_random_uuid())::text"],
  ["book_funnel_events", "lead_id", "character varying", false, null],
  ["book_funnel_events", "email", "text", false, null],
  ["book_funnel_events", "event_type", "text", true, null],
  ["book_funnel_events", "metadata", "jsonb", false, "'{}'::jsonb"],
  ["book_funnel_events", "created_at", "timestamp without time zone", false, "now()"],
  ["book_receipt_submissions", "id", "character varying", true, "(gen_random_uuid())::text"],
  ["book_receipt_submissions", "lead_id", "character varying", false, null],
  ["book_receipt_submissions", "email", "text", true, null],
  ["book_receipt_submissions", "receipt_file_url", "text", true, null],
  ["book_receipt_submissions", "original_filename", "text", true, null],
  ["book_receipt_submissions", "mime_type", "text", true, null],
  ["book_receipt_submissions", "file_size", "integer", true, null],
  ["book_receipt_submissions", "status", "text", true, "'pending_review'::text"],
  ["book_receipt_submissions", "uploaded_at", "timestamp without time zone", false, "now()"],
  ["book_receipt_submissions", "created_at", "timestamp without time zone", false, "now()"],
  ["book_receipt_submissions", "updated_at", "timestamp without time zone", false, "now()"],
  ["book_receipt_submissions", "promo_code", "text", false, null],
  ["book_receipt_submissions", "promo_code_generated_at", "timestamp without time zone", false, null],
  ["book_receipt_submissions", "promo_code_redeemed_at", "timestamp without time zone", false, null],
  ["book_receipt_submissions", "trainchat_account_email", "text", false, null],
  ["book_receipt_submissions", "utm_source", "text", false, null],
  ["book_receipt_submissions", "utm_medium", "text", false, null],
  ["book_receipt_submissions", "utm_campaign", "text", false, null],
  ["book_receipt_submissions", "utm_content", "text", false, null],
  ["book_receipt_submissions", "utm_term", "text", false, null],
  ["book_receipt_submissions", "fbp", "text", false, null],
  ["book_receipt_submissions", "fbc", "text", false, null],
  ["book_receipt_submissions", "confirmation_email_sent_at", "timestamp without time zone", false, null],
] as const;

/** Catalog-only validation. It never creates, alters, drops, or repairs schema. */
export async function validateBookFunnelSchema(executor: Executor = db): Promise<void> {
  let catalogResults: any[];
  try {
    catalogResults = await Promise.all([
    executor.execute(sql`SELECT t.relname table_name, a.attname column_name,
      format_type(a.atttypid,a.atttypmod) data_type, a.attnotnull is_not_null,
      pg_get_expr(d.adbin,d.adrelid) column_default
      FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
      WHERE n.nspname=current_schema() AND t.relname IN
        ('book_funnel_leads','book_funnel_events','book_receipt_submissions')`),
    executor.execute(sql`SELECT t.relname table_name,c.contype,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)::text[] columns,
      ft.relname foreign_table,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord)::text[] foreign_columns,
      c.confdeltype,c.confupdtype
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace LEFT JOIN pg_class ft ON ft.oid=c.confrelid
      WHERE n.nspname=current_schema() AND t.relname IN
        ('book_funnel_leads','book_funnel_events','book_receipt_submissions') AND c.contype IN ('p','u','f')`),
    executor.execute(sql`SELECT t.relname table_name,i.indisunique,i.indisvalid,i.indnkeyatts,i.indnatts,
      i.indexprs IS NULL expression_free,i.indpred IS NULL predicate_free,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ord)::text[] columns
      FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname IN
        ('book_funnel_leads','book_funnel_events','book_receipt_submissions')`),
    ]);
  } catch {
    throw new BookFunnelSchemaUnavailableError(["catalog validation failed"]);
  }
  const [columnResult, constraintResult, indexResult] = catalogResults;
  const columns = new Map(rows(columnResult).map(row => [`${row.table_name}.${row.column_name}`, row]));
  const constraints = rows(constraintResult);
  const indexes = rows(indexResult);
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
  for (const table of ["book_funnel_leads", "book_funnel_events", "book_receipt_submissions"]) {
    if (!constraints.some(c => c.table_name === table && c.contype === "p" && sameColumns(c.columns, ["id"]))) {
      problems.push(`primary key ${table}`);
    }
  }
  const emailUnique = constraints.some(c => c.table_name === "book_funnel_leads" && c.contype === "u" && sameColumns(c.columns, ["email"]))
    || indexes.some(i => i.table_name === "book_funnel_leads" && i.indisunique && i.indisvalid
      && i.indnkeyatts === 1 && i.indnatts === 1 && i.expression_free && i.predicate_free && sameColumns(i.columns, ["email"]));
  if (!emailUnique) problems.push("unique book_funnel_leads(email)");
  for (const table of ["book_funnel_events", "book_receipt_submissions"]) {
    if (!constraints.some(c => c.table_name === table && c.contype === "f" && sameColumns(c.columns, ["lead_id"])
      && c.foreign_table === "book_funnel_leads" && sameColumns(c.foreign_columns, ["id"])
      && c.confdeltype === "n" && c.confupdtype === "a")) problems.push(`foreign key ${table}.lead_id`);
  }
  if (indexes.some(i => i.table_name === "book_receipt_submissions" && i.indisunique && sameColumns(i.columns, ["promo_code"]))) {
    problems.push("unexpected unique book_receipt_submissions(promo_code)");
  }
  if (problems.length) throw new BookFunnelSchemaUnavailableError(problems);
}

export function sendBookFunnelUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof BookFunnelSchemaUnavailableError)) return false;
  response.status(503).json({ message: "Book Funnel unavailable" });
  return true;
}

export const requireBookFunnelSchema: RequestHandler = async (_request, response, next) => {
  try { await validateBookFunnelSchema(); next(); }
  catch (error) {
    if (!sendBookFunnelUnavailable(error, response)) next(error);
  }
};
