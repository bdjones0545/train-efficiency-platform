import type { Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";

type Executor = Pick<typeof db, "execute">;

export class AgentMailFollowupSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`AgentMail follow-up schema unavailable: ${problems.join(", ")}`);
    this.name = "AgentMailFollowupSchemaUnavailableError";
  }
}

export function sendAgentMailFollowupUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof AgentMailFollowupSchemaUnavailableError)) return false;
  response.status(503).json({ message: "AgentMail follow-ups temporarily unavailable" });
  return true;
}

const expected = [
  ["id","text",true,"gen_random_uuid()"],["organization_id","text",true,null],
  ["source_inbound_message_id","text",false,null],["source_reply_queue_id","text",false,null],
  ["inbox","text",true,null],["agent_name","text",true,null],["classification","text",true,null],
  ["recipient_email","text",true,null],["recipient_name","text",false,null],["subject","text",true,null],
  ["followup_body","text",true,null],["edited_body","text",false,null],["sequence_name","text",true,null],
  ["sequence_step","integer",true,"1"],["scheduled_for","timestamp with time zone",true,null],
  ["status","text",true,"'scheduled'"],["approval_status","text",true,"'pending'"],
  ["approved_by","text",false,null],["approved_at","timestamp with time zone",false,null],
  ["approved_payload_version","text",false,null],["send_attempt_count","integer",true,"0"],
  ["send_claimed_at","timestamp with time zone",false,null],["sent_at","timestamp with time zone",false,null],
  ["provider_message_id","text",false,null],["skipped_reason","text",false,null],["error_message","text",false,null],
  ["created_at","timestamp with time zone",true,"now()"],["updated_at","timestamp with time zone",true,"now()"],
] as const;

function rows(value: any): any[] { return Array.isArray(value) ? value : value?.rows ?? []; }
function normalize(value: unknown): string | null {
  return value == null ? null : String(value).replace(/\s+/g, "")
    .replace(/::(?:text|integer|timestampwithtimezone)/g, "").replace(/^\((.*)\)$/g, "$1");
}
function same(value: unknown, wanted: readonly string[]): boolean {
  return Array.isArray(value) && value.length === wanted.length && value.every((v, i) => v === wanted[i]);
}

/** Catalog-only validation. Never creates, alters, or repairs schema. */
export async function validateAgentMailFollowupSchema(executor: Executor = db): Promise<void> {
  const problems: string[] = [];
  const columns = rows(await executor.execute(sql`
    SELECT a.attname column_name,format_type(a.atttypid,a.atttypmod) canonical_type,a.attnotnull is_not_null,
      pg_get_expr(d.adbin,d.adrelid) column_default
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname='agent_mail_followups' AND a.attnum>0 AND NOT a.attisdropped
  `));
  for (const [name,type,notNull,defaultValue] of expected) {
    const actual = columns.find(column => column.column_name === name);
    if (!actual) problems.push(`agent_mail_followups.${name}`);
    else if (actual.canonical_type !== type || actual.is_not_null !== notNull || normalize(actual.column_default) !== defaultValue) {
      problems.push(`agent_mail_followups.${name} contract mismatch`);
    }
  }
  const indexes = rows(await executor.execute(sql`
    SELECT idx.relname index_name,i.indisprimary is_primary,i.indisunique is_unique,i.indisvalid is_valid,
      i.indisready is_ready,i.indnkeyatts key_count,i.indnatts total_count,
      bool_or(k.attnum=0) has_expressions,pg_get_expr(i.indpred,i.indrelid) predicate,
      array_agg(a.attname ORDER BY k.ordinality)::text[] columns
    FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
    JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON k.ordinality<=i.indnkeyatts
    LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE n.nspname=current_schema() AND t.relname='agent_mail_followups' GROUP BY i.indexrelid,idx.relname
  `));
  const expectedPredicate = "((source_reply_queue_id IS NOT NULL) AND (status = ANY (ARRAY['scheduled'::text, 'pending_review'::text, 'sending'::text, 'uncertain_provider_outcome'::text])))";
  for (const expectedIndex of [
    ["agent_mail_followups_pkey",true,true,["id"],null],
    ["agent_mail_followups_org_id_id_unique",false,true,["organization_id","id"],null],
    ["agent_mail_followups_sequence_step_unique",false,true,["organization_id","source_reply_queue_id","sequence_step"],expectedPredicate],
    ["idx_followup_org_status_scheduled",false,false,["organization_id","status","scheduled_for"],null],
    ["idx_followup_inbox",false,false,["organization_id","inbox"],null],
    ["idx_followup_inbound",false,false,["organization_id","source_inbound_message_id"],null],
  ] as const) {
    const [name, primary, unique, columnsWanted, predicate] = expectedIndex;
    const actual = indexes.find(index => index.index_name === name);
    if (!actual || actual.is_primary !== primary || actual.is_unique !== unique || !actual.is_valid || !actual.is_ready
      || actual.key_count !== columnsWanted.length || actual.total_count !== actual.key_count
      || actual.has_expressions || !same(actual.columns, columnsWanted)
      || actual.predicate !== predicate) problems.push(`${name} contract mismatch`);
  }
  const constraints = rows(await executor.execute(sql`
    SELECT c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid,false) definition,
      idx.relname backing_index_name,i.indisprimary backing_is_primary,
      (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[]
        FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum) key_columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_class idx ON idx.oid=c.conindid LEFT JOIN pg_index i ON i.indexrelid=c.conindid
    WHERE n.nspname=current_schema() AND t.relname='agent_mail_followups'
  `));
  const primaryKey = constraints.find(c => c.contype === "p");
  if (!primaryKey || !primaryKey.convalidated || primaryKey.backing_index_name !== "agent_mail_followups_pkey"
    || !primaryKey.backing_is_primary || !same(primaryKey.key_columns, ["id"])) {
    problems.push("agent_mail_followups primary key contract mismatch");
  }
  const expectedContract = "CHECK (((btrim(organization_id) <> ''::text) AND (lower(btrim(organization_id)) <> ALL (ARRAY['default'::text, 'global'::text, 'unknown'::text, 'unscoped'::text])) AND (btrim(inbox) <> ''::text) AND (btrim(recipient_email) <> ''::text) AND (sequence_step > 0) AND (send_attempt_count >= 0) AND (status = ANY (ARRAY['scheduled'::text, 'pending_review'::text, 'sending'::text, 'sent'::text, 'skipped'::text, 'cancelled'::text, 'failed'::text, 'uncertain_provider_outcome'::text])) AND (approval_status = ANY (ARRAY['pending'::text, 'pending_review'::text, 'approved'::text, 'rejected'::text])) AND ((approval_status <> 'approved'::text) OR ((approved_at IS NOT NULL) AND (approved_payload_version IS NOT NULL) AND (btrim(approved_payload_version) <> ''::text))) AND ((status <> ALL (ARRAY['sending'::text, 'sent'::text, 'uncertain_provider_outcome'::text])) OR ((send_attempt_count > 0) AND (send_claimed_at IS NOT NULL))) AND ((status <> 'sent'::text) OR (sent_at IS NOT NULL))))";
  const contract = constraints.find(c => c.conname === "agent_mail_followups_contract_check" && c.contype === "c");
  if (!contract || !contract.convalidated || contract.definition !== expectedContract) {
    problems.push("agent_mail_followups_contract_check contract mismatch");
  }
  if (problems.length) throw new AgentMailFollowupSchemaUnavailableError(problems);
}
