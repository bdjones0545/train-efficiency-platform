import { sql } from "drizzle-orm";
import { db } from "./db";

type Executor = Pick<typeof db, "execute">;
const MAX_SAFE_VERSION = 9_007_199_254_740_991;

export class ComposioSpecializedVersionSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super("Specialized Composio requests temporarily unavailable");
    this.name = "ComposioSpecializedVersionSchemaUnavailableError";
  }
}

function rows(result: any): any[] { return Array.isArray(result) ? result : result?.rows ?? []; }
function normalized(value: unknown): string { return String(value ?? "").replace(/[\s()'":]/g, "").toLowerCase(); }

/** Catalog-only readiness validation. It never creates, alters, or repairs schema. */
export async function validateComposioSpecializedVersionSchema(executor: Executor = db): Promise<void> {
  const expected = [
    ["composio_gmail_draft_requests","id","character varying(128)",true,"uuid"],
    ["composio_gmail_draft_requests","org_id","character varying(256)",true,null],
    ["composio_gmail_draft_requests","agent_id","character varying(128)",true,null],
    ["composio_gmail_draft_requests","recipient_email","text",true,null],
    ["composio_gmail_draft_requests","subject","text",true,null],["composio_gmail_draft_requests","body","text",true,null],
    ["composio_gmail_draft_requests","purpose","text",true,null],["composio_gmail_draft_requests","risk_level","character varying(32)",true,"medium"],
    ["composio_gmail_draft_requests","approval_queue_id","character varying(128)",false,null],["composio_gmail_draft_requests","gmail_draft_id","text",false,null],
    ["composio_gmail_draft_requests","status","character varying(64)",true,"draft_queued"],["composio_gmail_draft_requests","error_message","text",false,null],
    ["composio_gmail_draft_requests","metadata","jsonb",false,null],["composio_gmail_draft_requests","created_at","timestamp without time zone",false,"now"],
    ["composio_gmail_draft_requests","updated_at","timestamp without time zone",false,"now"],
    ["composio_gmail_draft_requests", "provider_action_version", "bigint", true],
    ["composio_gmail_draft_requests", "approved_provider_action_version", "bigint", false],
    ["composio_gmail_draft_requests", "approved_by", "text", false],
    ["composio_gmail_draft_requests", "approved_at", "timestamp without time zone", false],
    ["composio_gmail_draft_requests", "approved_connected_account_id", "text", false],
    ["composio_slack_alert_requests","id","character varying(128)",true,"uuid"],["composio_slack_alert_requests","org_id","character varying(256)",true,null],
    ["composio_slack_alert_requests","agent_id","character varying(128)",true,null],["composio_slack_alert_requests","channel","character varying(256)",true,null],
    ["composio_slack_alert_requests","alert_type","character varying(128)",true,null],["composio_slack_alert_requests","severity","character varying(32)",true,"high"],
    ["composio_slack_alert_requests","message","text",true,null],["composio_slack_alert_requests","purpose","text",true,null],
    ["composio_slack_alert_requests","risk_level","character varying(32)",true,"high"],["composio_slack_alert_requests","approval_queue_id","character varying(128)",false,null],
    ["composio_slack_alert_requests","slack_message_id","text",false,null],["composio_slack_alert_requests","slack_channel_id","text",false,null],
    ["composio_slack_alert_requests","status","character varying(64)",true,"alert_queued"],["composio_slack_alert_requests","error_message","text",false,null],
    ["composio_slack_alert_requests","metadata","jsonb",false,null],["composio_slack_alert_requests","created_at","timestamp without time zone",false,"now"],
    ["composio_slack_alert_requests","updated_at","timestamp without time zone",false,"now"],
    ["composio_slack_alert_requests", "provider_action_version", "bigint", true],
    ["composio_slack_alert_requests", "approved_provider_action_version", "bigint", false],
    ["composio_slack_alert_requests", "approved_by", "text", false],["composio_slack_alert_requests", "approved_at", "timestamp without time zone", false],
    ["composio_slack_alert_requests", "approved_connected_account_id", "text", false],
    ["composio_calendar_requests","id","character varying(128)",true,"uuid"],["composio_calendar_requests","org_id","character varying(256)",true,null],
    ["composio_calendar_requests","agent_id","character varying(128)",true,null],["composio_calendar_requests","action_type","character varying(64)",true,null],
    ["composio_calendar_requests","title","text",false,null],["composio_calendar_requests","description","text",false,null],
    ["composio_calendar_requests","location","text",false,null],["composio_calendar_requests","start_datetime","text",false,null],
    ["composio_calendar_requests","end_datetime","text",false,null],["composio_calendar_requests","timezone","character varying(128)",false,null],
    ["composio_calendar_requests","attendees","jsonb",false,null],["composio_calendar_requests","calendar_id","character varying(256)",false,"primary"],
    ["composio_calendar_requests","event_id","text",false,null],["composio_calendar_requests","google_event_id","text",false,null],
    ["composio_calendar_requests","purpose","text",true,null],["composio_calendar_requests","risk_level","character varying(32)",true,"medium"],
    ["composio_calendar_requests","approval_queue_id","character varying(128)",false,null],["composio_calendar_requests","status","character varying(64)",true,"event_queued"],
    ["composio_calendar_requests","approved_by","text",false,null],["composio_calendar_requests","approved_at","timestamp without time zone",false,null],
    ["composio_calendar_requests","executed_at","timestamp without time zone",false,null],["composio_calendar_requests","rejected_reason","text",false,null],
    ["composio_calendar_requests","error_message","text",false,null],
    ["composio_calendar_requests", "payload", "jsonb", false],
    ["composio_calendar_requests","metadata","jsonb",false,null],["composio_calendar_requests","created_at","timestamp without time zone",false,"now"],
    ["composio_calendar_requests","updated_at","timestamp without time zone",false,"now"],
    ["composio_calendar_requests", "provider_action_version", "bigint", false],
    ["composio_calendar_requests", "approved_provider_action_version", "bigint", false],
    ["composio_calendar_requests", "approved_connected_account_id", "text", false],
    ["software_improvement_tasks", "github_issue_url", "character varying(512)", false],
    ["software_improvement_tasks", "github_approval_queue_id", "character varying(256)", false],
    ["software_improvement_tasks", "github_issue_draft", "jsonb", false],
    ["software_improvement_tasks", "github_provider_action_version", "bigint", false],
    ["software_improvement_tasks", "github_approved_provider_action_version", "bigint", false],
    ["software_improvement_tasks", "github_approved_connected_account_id", "text", false],
  ] as const;
  const found = rows(await executor.execute(sql`
    SELECT c.table_name,c.column_name,format_type(a.atttypid,a.atttypmod) canonical_type,
      a.attnotnull is_not_null,pg_get_expr(d.adbin,d.adrelid) column_default
    FROM information_schema.columns c
    JOIN pg_namespace n ON n.nspname=c.table_schema
    JOIN pg_class t ON t.relnamespace=n.oid AND t.relname=c.table_name
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE c.table_schema=current_schema() AND c.table_name IN
      ('composio_gmail_draft_requests','composio_slack_alert_requests',
       'composio_calendar_requests','software_improvement_tasks')
  `));
  const problems: string[] = [];
  for (const [table,column,type,notNull,expectedDefault] of expected) {
    const actual = found.find(row=>row.table_name===table&&row.column_name===column);
    const renderedDefault=normalized(actual?.column_default);
    const defaultValid=expectedDefault===undefined||expectedDefault===null ? renderedDefault==="" :
      expectedDefault==="uuid" ? renderedDefault.includes("gen_random_uuid")&&renderedDefault.includes("text") :
      expectedDefault==="now" ? renderedDefault==="now" : renderedDefault.includes(normalized(expectedDefault));
    if (!actual || actual.canonical_type!==type || actual.is_not_null!==notNull || !defaultValid) {
      problems.push(`${table}.${column}`);
    }
  }
  const primaryKeys=rows(await executor.execute(sql`
    SELECT t.relname table_name,array_agg(a.attname ORDER BY k.ordinality)::text[] columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) ON true
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE n.nspname=current_schema() AND c.contype='p' AND t.relname IN
      ('composio_gmail_draft_requests','composio_slack_alert_requests','composio_calendar_requests')
    GROUP BY t.relname,c.oid
  `));
  for(const table of ['composio_gmail_draft_requests','composio_slack_alert_requests','composio_calendar_requests'])
    if(!primaryKeys.some(key=>key.table_name===table&&Array.isArray(key.columns)&&key.columns.length===1&&key.columns[0]==='id')) problems.push(`${table} PRIMARY KEY`);
  const checks = rows(await executor.execute(sql`
    SELECT t.relname table_name,c.conname,pg_get_constraintdef(c.oid,true) definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND c.contype='c' AND c.conname IN
      ('composio_gmail_version_check','composio_slack_version_check',
       'composio_calendar_version_check','composio_calendar_approval_version_check',
       'software_improvement_github_version_check','software_improvement_github_approval_version_check')
  `));
  const expectedChecks:Record<string,string>={
    composio_gmail_version_check:`CHECK (provider_action_version >= 1 AND provider_action_version <= '${MAX_SAFE_VERSION}'::bigint AND (approved_provider_action_version IS NULL OR approved_provider_action_version = provider_action_version AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_connected_account_id IS NOT NULL))`,
    composio_slack_version_check:`CHECK (provider_action_version >= 1 AND provider_action_version <= '${MAX_SAFE_VERSION}'::bigint AND (approved_provider_action_version IS NULL OR approved_provider_action_version = provider_action_version AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_connected_account_id IS NOT NULL))`,
    composio_calendar_version_check:`CHECK (provider_action_version IS NULL OR provider_action_version >= 1 AND provider_action_version <= '${MAX_SAFE_VERSION}'::bigint)`,
    composio_calendar_approval_version_check:`CHECK (approved_provider_action_version IS NULL OR approved_provider_action_version = provider_action_version AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_connected_account_id IS NOT NULL)`,
    software_improvement_github_version_check:`CHECK (github_provider_action_version IS NULL OR github_provider_action_version >= 1 AND github_provider_action_version <= '${MAX_SAFE_VERSION}'::bigint)`,
    software_improvement_github_approval_version_check:`CHECK (github_approved_provider_action_version IS NULL OR github_approved_provider_action_version = github_provider_action_version AND github_approved_by IS NOT NULL AND github_approved_at IS NOT NULL AND github_approved_connected_account_id IS NOT NULL)`,
  };
  for(const [name,definition] of Object.entries(expectedChecks))
    if(normalized(checks.find(row=>row.conname===name)?.definition)!==normalized(definition)) problems.push(name);
  const indexes=rows(await executor.execute(sql`
    SELECT t.relname table_name,idx.relname index_name,i.indisunique,i.indisvalid,
      i.indnkeyatts key_count,i.indnatts attribute_count,(i.indexprs IS NULL) no_expressions,
      (i.indpred IS NULL) no_predicate,
      (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum) columns
    FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND idx.relname IN
      ('composio_gmail_requests_org_status_idx','composio_slack_requests_org_status_idx','composio_calendar_requests_org_status_idx')
  `));
  for(const name of ['composio_gmail_requests_org_status_idx','composio_slack_requests_org_status_idx','composio_calendar_requests_org_status_idx']){
    const index=indexes.find(value=>value.index_name===name);
    if(!index||index.indisunique||!index.indisvalid||!index.no_expressions||!index.no_predicate||index.key_count!==2||index.attribute_count!==2||
      !Array.isArray(index.columns)||index.columns.length!==2||index.columns[0]!=='org_id'||index.columns[1]!=='status') problems.push(`${name} INDEX`);
  }
  if (problems.length) throw new ComposioSpecializedVersionSchemaUnavailableError(problems);
}
