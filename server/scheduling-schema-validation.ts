import { sql } from "drizzle-orm";
import type { Response } from "express";
import { db } from "./db";

type Column = { name: string; type: string; notNull: boolean };
function parseColumns(contract: string): Column[] {
  return contract.split(",").map((entry) => {
    const [name, type, required] = entry.split("|");
    return { name, type, notNull: required === "1" };
  });
}
const TABLES: Record<string, Column[]> = {
  athlete_scheduling_profiles: parseColumns("id|character varying|1,user_id|character varying|1,sport|character varying|0,training_level|character varying|0,birth_year|integer|0,updated_at|timestamp without time zone|0"),
  session_recurrence_rules: parseColumns("id|character varying|1,booking_id|character varying|0,recurring_group_id|character varying|0,organization_id|character varying|0,frequency|character varying|1,days_of_week|integer[]|0,end_date|date|0,created_at|timestamp without time zone|0"),
  waitlist_holds: parseColumns("id|character varying|1,booking_id|character varying|1,user_id|character varying|1,hold_expires_at|timestamp without time zone|1,created_at|timestamp without time zone|0"),
  session_waitlists: parseColumns("id|character varying|1,booking_id|character varying|1,user_id|character varying|1,participant_name|character varying|0,created_at|timestamp without time zone|0"),
  scheduling_health_snapshots: parseColumns("id|text|1,org_id|text|1,score|integer|1,utilization_score|integer|1,revenue_score|integer|1,attendance_score|integer|1,retention_score|integer|1,waitlist_score|integer|1,label|text|1,summary|text|0,created_at|timestamp with time zone|0"),
  session_performance_scores: parseColumns("id|text|1,booking_id|text|1,org_id|text|1,score|integer|1,utilization_factor|integer|1,revenue_factor|integer|1,attendance_factor|integer|1,waitlist_factor|integer|1,velocity_factor|integer|1,label|text|1,computed_at|timestamp with time zone|0"),
  scheduling_opportunities: parseColumns("id|text|1,org_id|text|1,type|text|1,priority|text|1,title|text|1,description|text|0,estimated_value_cents|integer|0,action_label|text|0,action_data|jsonb|0,status|text|1,created_at|timestamp with time zone|0"),
  retention_risk_scores: parseColumns("id|text|1,org_id|text|1,client_user_id|text|1,risk_score|integer|1,risk_level|text|1,days_since_last_booking|integer|0,booking_frequency_drop|integer|0,cancellation_rate|integer|0,computed_at|timestamp with time zone|0"),
  fill_campaign_drafts: parseColumns("id|text|1,org_id|text|1,booking_id|text|1,subject|text|0,body|text|0,target_count|integer|0,status|text|1,created_at|timestamp with time zone|0,preview_text|text|0,sms_body|text|0,push_body|text|0,social_caption|text|0,selected_recipient_count|integer|0,recipient_ids|jsonb|0,recipient_summary|jsonb|0,model_used|text|0,generation_version|text|0,generated_at|timestamp with time zone|0"),
  fill_campaign_submissions: parseColumns("id|text|1,org_id|text|1,booking_id|text|1,draft_id|text|0,action_id|text|0,status|text|1,version|integer|1,parent_submission_id|text|0,subject|text|0,preview_text|text|0,email_body|text|0,sms_body|text|0,push_body|text|0,social_caption|text|0,recipients|jsonb|0,recipient_count|integer|0,recipient_summary|jsonb|0,session_name|text|0,coach_name|text|0,org_name|text|0,open_spots|integer|0,estimated_value_cents|integer|0,fill_probability|text|0,approved_at|timestamp with time zone|0,approved_by|text|0,rejected_at|timestamp with time zone|0,rejection_reason|text|0,rejection_type|text|0,regeneration_requested_at|timestamp with time zone|0,timeline|jsonb|0,analytics|jsonb|0,submitted_at|timestamp with time zone|0,sent_at|timestamp with time zone|0,completed_at|timestamp with time zone|0,created_at|timestamp with time zone|0"),
  fill_opportunity_scores: parseColumns("id|text|1,org_id|text|1,booking_id|text|1,session_name|text|0,coach_name|text|0,session_start|timestamp with time zone|0,open_spots|integer|0,total_spots|integer|0,session_price_cents|integer|0,utilization_pct|integer|0,revenue_impact|text|0,urgency|text|0,fill_probability|integer|0,overall_priority|integer|0,detection_triggers|jsonb|0,recommendations|jsonb|0,auto_draft_id|text|0,auto_draft_status|text|0,status|text|0,detected_at|timestamp with time zone|0,last_scanned_at|timestamp with time zone|0"),
  fill_revenue_policies: parseColumns("id|text|1,org_id|text|1,min_fill_threshold_pct|integer|0,min_revenue_cents|integer|0,campaign_lead_time_hours|integer|0,auto_draft_generation|boolean|0,approval_required|boolean|0,waitlist_priority|boolean|0,enabled|boolean|0,updated_at|timestamp with time zone|0,created_at|timestamp with time zone|0"),
  fill_campaign_attributions: parseColumns("id|text|1,org_id|text|1,campaign_submission_id|text|1,booking_id|text|1,participant_id|text|0,user_id|text|1,booking_timestamp|timestamp with time zone|0,hours_since_send|numeric|0,attribution_window|text|0,session_price_cents|integer|0,attributed_revenue_cents|integer|0,created_at|timestamp with time zone|0"),
  scheduling_recommendation_actions: parseColumns("id|text|1,org_id|text|1,opportunity_id|text|1,opportunity_title|text|1,opportunity_type|text|1,opportunity_category|text|1,action|text|1,estimated_value_cents|integer|0,notes|text|0,user_id|text|0,actioned_at|timestamp with time zone|0"),
};

const UNIQUE_KEYS = [
  ["athlete_scheduling_profiles", "user_id"], ["session_waitlists", "booking_id,user_id"],
  ["fill_opportunity_scores", "org_id,booking_id"], ["fill_revenue_policies", "org_id"],
  ["fill_campaign_attributions", "campaign_submission_id,user_id"],
] as const;
const INDEXES = [
  ["scheduling_health_snapshots", "org_id,created_at"], ["session_performance_scores", "org_id,booking_id"],
  ["scheduling_opportunities", "org_id,status,created_at"], ["retention_risk_scores", "org_id,client_user_id"],
  ["fill_campaign_drafts", "org_id,booking_id"], ["fill_campaign_submissions", "org_id,booking_id"],
  ["fill_campaign_attributions", "org_id,booking_id"], ["scheduling_recommendation_actions", "org_id,opportunity_id"],
  ["session_recurrence_rules", "organization_id,booking_id"], ["waitlist_holds", "booking_id,hold_expires_at"],
] as const;
const FOREIGN_KEYS = [
  ["athlete_scheduling_profiles", "user_id", "users", "id", "a"],
  ["session_recurrence_rules", "booking_id", "bookings", "id", "c"],
  ["waitlist_holds", "booking_id", "bookings", "id", "c"],
  ["waitlist_holds", "user_id", "users", "id", "a"],
  ["session_waitlists", "booking_id", "bookings", "id", "c"],
  ["session_waitlists", "user_id", "users", "id", "a"],
] as const;

export class SchedulingSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`scheduling schema migration is not ready: ${problems.join(", ")}`);
    this.name = "SchedulingSchemaUnavailableError";
  }
}

export function sendSchedulingSchemaUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof SchedulingSchemaUnavailableError)) return false;
  response.status(503).json({ message: "Scheduling schema unavailable" });
  return true;
}

function rows(result: any): any[] { return Array.isArray(result) ? result : result?.rows ?? []; }
function same(actual: unknown, expected: string): boolean {
  return Array.isArray(actual) && actual.join(",") === expected;
}

/** Catalog-only validation. It never creates, alters, or repairs Scheduling schema. */
export async function validateSchedulingSchema(): Promise<void> {
  const names = Object.keys(TABLES);
  const list = sql.join(names.map(name => sql`${name}`), sql`, `);
  const columns = rows(await db.execute(sql`
    SELECT c.table_name,c.column_name,format_type(a.atttypid,a.atttypmod) canonical_type,a.attnotnull is_not_null
    FROM information_schema.columns c JOIN pg_namespace n ON n.nspname=c.table_schema
    JOIN pg_class t ON t.relnamespace=n.oid AND t.relname=c.table_name
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name
    WHERE c.table_schema=current_schema() AND c.table_name IN (${list})`));
  const problems: string[] = [];
  for (const [table, expected] of Object.entries(TABLES)) for (const contract of expected) {
    const found = columns.find(row => row.table_name === table && row.column_name === contract.name);
    if (!found) problems.push(`${table}.${contract.name}`);
    else if (found.canonical_type !== contract.type || found.is_not_null !== contract.notNull)
      problems.push(`${table}.${contract.name} expected ${contract.type} ${contract.notNull ? "NOT NULL" : "NULLABLE"}`);
  }
  const keys = rows(await db.execute(sql`
    SELECT t.relname table_name,i.indisprimary is_primary,i.indisunique is_unique,i.indisvalid is_valid,
      array_agg(a.attname ORDER BY k.ordinality)::text[] columns
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON true
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE n.nspname=current_schema() AND t.relname IN (${list}) GROUP BY t.relname,i.indexrelid`));
  for (const table of names) if (!keys.some(row => row.table_name === table && row.is_primary && row.is_valid && same(row.columns, "id"))) problems.push(`${table} PRIMARY KEY(id)`);
  for (const [table, columns] of UNIQUE_KEYS) if (!keys.some(row => row.table_name === table && row.is_unique && row.is_valid && same(row.columns, columns))) problems.push(`${table} UNIQUE(${columns})`);
  for (const [table, columns] of INDEXES) if (!keys.some(row => row.table_name === table && !row.is_unique && row.is_valid && same(row.columns, columns))) problems.push(`${table} INDEX(${columns})`);
  const foreignKeys = rows(await db.execute(sql`
    SELECT source.relname table_name, target.relname foreign_table, constraint_record.confdeltype delete_action,
      array_agg(source_column.attname ORDER BY source_key.ordinality)::text[] columns,
      array_agg(target_column.attname ORDER BY source_key.ordinality)::text[] foreign_columns
    FROM pg_constraint constraint_record
    JOIN pg_class source ON source.oid=constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid=source.relnamespace
    JOIN pg_class target ON target.oid=constraint_record.confrelid
    JOIN unnest(constraint_record.conkey) WITH ORDINALITY source_key(attnum,ordinality) ON true
    JOIN unnest(constraint_record.confkey) WITH ORDINALITY target_key(attnum,ordinality) ON target_key.ordinality=source_key.ordinality
    JOIN pg_attribute source_column ON source_column.attrelid=source.oid AND source_column.attnum=source_key.attnum
    JOIN pg_attribute target_column ON target_column.attrelid=target.oid AND target_column.attnum=target_key.attnum
    WHERE namespace.nspname=current_schema() AND constraint_record.contype='f' AND source.relname IN (${list})
    GROUP BY source.relname,target.relname,constraint_record.oid,constraint_record.confdeltype`));
  for (const [table, columns, foreignTable, foreignColumns, deleteAction] of FOREIGN_KEYS)
    if (!foreignKeys.some(row => row.table_name === table && row.foreign_table === foreignTable &&
      row.delete_action === deleteAction && same(row.columns, columns) && same(row.foreign_columns, foreignColumns)))
      problems.push(`${table} FOREIGN KEY(${columns}) REFERENCES ${foreignTable}(${foreignColumns})`);
  if (problems.length) throw new SchedulingSchemaUnavailableError(problems);
}
