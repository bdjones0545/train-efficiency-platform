import { sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db";

type Column = { name: string; type: string; notNull: boolean };
const columns = (value: string): Column[] => value.split(",").map(entry => {
  const [name, type, required] = entry.split("|");
  return { name, type, notNull: required === "1" };
});

const TABLES: Record<string, Column[]> = {
  attendance_programs: columns("id|character varying|1,organization_id|character varying|1,program_id|character varying|1,description|text|0,location|character varying|0,start_date|character varying|0,end_date|character varying|0,active|boolean|1,created_at|timestamp without time zone|0,updated_at|timestamp without time zone|0"),
  attendance_program_fields: columns("id|character varying|1,organization_id|character varying|1,program_id|character varying|1,field_name|character varying|1,label|character varying|1,field_type|character varying|1,visibility|character varying|1,display_order|integer|1,options|jsonb|0,created_at|timestamp without time zone|0"),
  attendance_reward_tiers: columns("id|character varying|1,organization_id|character varying|1,program_id|character varying|1,visit_count|integer|1,reward_name|character varying|1,reward_description|text|0,active|boolean|1,created_at|timestamp without time zone|0"),
  attendance_qr_codes: columns("id|character varying|1,organization_id|character varying|1,program_id|character varying|1,public_slug|character varying|1,qr_code_url|text|0,created_at|timestamp without time zone|0"),
  attendance_records: columns("id|character varying|1,organization_id|character varying|1,program_id|character varying|1,athlete_email|character varying|1,athlete_first_name|character varying|0,athlete_last_name|character varying|0,phone|character varying|0,sport|character varying|0,position|character varying|0,school|character varying|0,grad_year|character varying|0,team|character varying|0,age|character varying|0,extra_fields|jsonb|0,visit_number|integer|1,lead_id|character varying|0,ip_address|character varying|0,created_at|timestamp without time zone|0"),
  attendance_rewards_earned: columns("id|character varying|1,organization_id|character varying|1,program_id|character varying|1,tier_id|character varying|1,athlete_email|character varying|1,visit_count_at_earned|integer|1,notification_sent_at|timestamp without time zone|0,redeemed_at|timestamp without time zone|0,created_at|timestamp without time zone|0"),
  attendance_email_history: columns("id|character varying|1,organization_id|character varying|1,program_id|character varying|1,athlete_email|character varying|1,email_type|character varying|1,subject|character varying|0,status|character varying|1,error_message|text|0,created_at|timestamp without time zone|0"),
  attendance_report_recipients: columns("id|character varying|1,org_id|character varying|1,attendance_program_id|character varying|1,coach_id|character varying|0,email|character varying|1,name|character varying|1,receive_daily|boolean|1,receive_weekly|boolean|1,active|boolean|1,created_at|timestamp without time zone|0,updated_at|timestamp without time zone|0"),
  attendance_report_email_history: columns("id|character varying|1,org_id|character varying|1,attendance_program_id|character varying|1,recipient_email|character varying|1,report_type|character varying|1,period_start|date|0,period_end|date|0,sent_at|timestamp without time zone|0,status|character varying|1,sendgrid_message_id|character varying|0,error_message|text|0,created_at|timestamp without time zone|0,sendgrid_status_code|integer|0"),
  session_attendance: columns("id|character varying|1,booking_id|character varying|1,user_id|character varying|0,participant_name|character varying|0,status|character varying|1,marked_by|character varying|0,marked_at|timestamp without time zone|0,notes|text|0,organization_id|character varying|0"),
};
const UNIQUE_KEYS = [["attendance_programs","program_id"],["attendance_qr_codes","program_id"],["attendance_qr_codes","public_slug"],["attendance_report_recipients","attendance_program_id,email"]] as const;
const INDEXES = [["session_attendance","booking_id,user_id",true,"(user_id IS NOT NULL)"],["session_attendance","booking_id,participant_name",true,"((user_id IS NULL) AND (participant_name IS NOT NULL))"]] as const;
const FOREIGN_KEYS = [["session_attendance","booking_id","bookings","id","c","a"],["session_attendance","user_id","users","id","a","a"]] as const;
const DEFAULTS: Record<string,string> = {
  "attendance_programs.id":"gen_random_uuid()","attendance_programs.active":"true","attendance_programs.created_at":"now()","attendance_programs.updated_at":"now()",
  "attendance_program_fields.id":"gen_random_uuid()","attendance_program_fields.field_type":"'text'","attendance_program_fields.visibility":"'required'","attendance_program_fields.display_order":"0","attendance_program_fields.options":"'[]'","attendance_program_fields.created_at":"now()",
  "attendance_reward_tiers.id":"gen_random_uuid()","attendance_reward_tiers.active":"true","attendance_reward_tiers.created_at":"now()",
  "attendance_qr_codes.id":"gen_random_uuid()","attendance_qr_codes.created_at":"now()",
  "attendance_records.id":"gen_random_uuid()","attendance_records.extra_fields":"'{}'","attendance_records.visit_number":"1","attendance_records.created_at":"now()",
  "attendance_rewards_earned.id":"gen_random_uuid()","attendance_rewards_earned.created_at":"now()",
  "attendance_email_history.id":"gen_random_uuid()","attendance_email_history.status":"'sent'","attendance_email_history.created_at":"now()",
  "attendance_report_recipients.id":"gen_random_uuid()","attendance_report_recipients.receive_daily":"true","attendance_report_recipients.receive_weekly":"true","attendance_report_recipients.active":"true","attendance_report_recipients.created_at":"now()","attendance_report_recipients.updated_at":"now()",
  "attendance_report_email_history.id":"gen_random_uuid()","attendance_report_email_history.status":"'sent'","attendance_report_email_history.created_at":"now()",
  "session_attendance.id":"gen_random_uuid()","session_attendance.status":"'present'","session_attendance.marked_at":"now()","session_attendance.notes":"''",
};

export class AttendanceSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`attendance schema migration is not ready: ${problems.join(", ")}`);
    this.name = "AttendanceSchemaUnavailableError";
  }
}
export function sendAttendanceSchemaUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof AttendanceSchemaUnavailableError)) return false;
  response.status(503).json({ message: "Attendance schema unavailable" });
  return true;
}
function resultRows(result: any): any[] { return Array.isArray(result) ? result : result?.rows ?? []; }
function same(actual: unknown, expected: string): boolean { return Array.isArray(actual) && actual.join(",") === expected; }
function normalizedDefault(value: unknown): string | null {
  if (value == null) return null;
  return String(value).toLowerCase().replace(/\s+/g,"").replace(/::(?:charactervarying|text|jsonb|boolean|integer|timestampwithouttimezone)/g,"");
}

/** Catalog-only validation. It never creates, alters, or repairs Attendance schema. */
export async function validateAttendanceSchema(executor: Pick<typeof db, "execute"> = db): Promise<void> {
  const names = Object.keys(TABLES);
  const list = sql.join(names.map(name => sql`${name}`), sql`, `);
  const foundColumns = resultRows(await executor.execute(sql`
    SELECT c.table_name,c.column_name,c.column_default,format_type(a.atttypid,a.atttypmod) canonical_type,a.attnotnull is_not_null
    FROM information_schema.columns c JOIN pg_namespace n ON n.nspname=c.table_schema
    JOIN pg_class t ON t.relnamespace=n.oid AND t.relname=c.table_name
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name
    WHERE c.table_schema=current_schema() AND c.table_name IN (${list})`));
  const problems: string[] = [];
  for (const [table, expected] of Object.entries(TABLES)) for (const contract of expected) {
    const found = foundColumns.find(row => row.table_name === table && row.column_name === contract.name);
    if (!found) problems.push(`${table}.${contract.name}`);
    else if (found.canonical_type !== contract.type || found.is_not_null !== contract.notNull ||
      normalizedDefault(found.column_default) !== (DEFAULTS[`${table}.${contract.name}`] ?? null)) problems.push(`${table}.${contract.name} contract mismatch`);
  }
  const keys = resultRows(await executor.execute(sql`
    SELECT t.relname table_name,i.indisprimary is_primary,i.indisunique is_unique,i.indisvalid is_valid,
      pg_get_expr(i.indpred,i.indrelid) predicate,array_agg(a.attname ORDER BY k.ordinality)::text[] columns
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON true JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE n.nspname=current_schema() AND t.relname IN (${list}) GROUP BY t.relname,i.indexrelid`));
  for (const table of names) if (!keys.some(row => row.table_name === table && row.is_primary && row.is_valid && same(row.columns,"id"))) problems.push(`${table} PRIMARY KEY(id)`);
  for (const [table, expected] of UNIQUE_KEYS) if (!keys.some(row => row.table_name === table && row.is_unique && row.is_valid && !row.predicate && same(row.columns,expected))) problems.push(`${table} UNIQUE(${expected})`);
  for (const [table, expected, unique, predicate] of INDEXES) if (!keys.some(row => row.table_name === table && row.is_unique === unique && row.is_valid && same(row.columns,expected) && row.predicate === predicate)) problems.push(`${table} INDEX(${expected})`);
  const foreignKeys = resultRows(await executor.execute(sql`
    SELECT s.relname table_name,t.relname foreign_table,c.confdeltype delete_action,c.confupdtype update_action,
      array_agg(sa.attname ORDER BY sk.ordinality)::text[] columns,array_agg(ta.attname ORDER BY sk.ordinality)::text[] foreign_columns
    FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_class t ON t.oid=c.confrelid
    JOIN unnest(c.conkey) WITH ORDINALITY sk(attnum,ordinality) ON true JOIN unnest(c.confkey) WITH ORDINALITY tk(attnum,ordinality) ON tk.ordinality=sk.ordinality
    JOIN pg_attribute sa ON sa.attrelid=s.oid AND sa.attnum=sk.attnum JOIN pg_attribute ta ON ta.attrelid=t.oid AND ta.attnum=tk.attnum
    WHERE n.nspname=current_schema() AND c.contype='f' AND s.relname IN (${list}) GROUP BY s.relname,t.relname,c.oid`));
  for (const [table, expected, foreignTable, foreignColumns, del, upd] of FOREIGN_KEYS) if (!foreignKeys.some(row => row.table_name===table && row.foreign_table===foreignTable && row.delete_action===del && row.update_action===upd && same(row.columns,expected) && same(row.foreign_columns,foreignColumns))) problems.push(`${table} FOREIGN KEY(${expected})`);
  if (problems.length) throw new AttendanceSchemaUnavailableError(problems);
}

export async function requireAttendanceSchema(_request: Request, response: Response, next: NextFunction): Promise<void> {
  try { await validateAttendanceSchema(); next(); }
  catch (error) { if (!sendAttendanceSchemaUnavailable(error,response)) next(error); }
}
