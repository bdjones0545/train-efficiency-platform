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
  return value == null ? null : String(value).toLowerCase().replace(/\s+/g, "")
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
    SELECT i.indisprimary is_primary,i.indisunique is_unique,i.indisvalid is_valid,i.indnkeyatts key_count,
      bool_or(k.attnum=0) has_expressions,pg_get_expr(i.indpred,i.indrelid) predicate,
      array_agg(a.attname ORDER BY k.ordinality)::text[] columns
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON true
    LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE n.nspname=current_schema() AND t.relname='agent_mail_followups' GROUP BY i.indexrelid
  `));
  if (!indexes.some(i => i.is_primary && i.is_valid && i.key_count === 1 && !i.has_expressions && same(i.columns,["id"]))) problems.push("PRIMARY KEY(id)");
  if (!indexes.some(i => i.is_unique && i.is_valid && i.key_count === 2 && !i.has_expressions && !i.predicate && same(i.columns,["organization_id","id"]))) problems.push("UNIQUE(organization_id,id)");
  const sequence = indexes.find(i => i.is_unique && i.is_valid && i.key_count === 3 && !i.has_expressions && same(i.columns,["organization_id","source_reply_queue_id","sequence_step"]));
  const sequencePredicate = normalize(sequence?.predicate)?.replace(/[()]/g,"") ?? "";
  if (!sequence || !sequencePredicate.includes("source_reply_queue_idisnotnull")
    || !sequencePredicate.includes("status=anyarray['scheduled','pending_review','sending','uncertain_provider_outcome']")) {
    problems.push("sequence identity unique index");
  }
  for (const columnsWanted of [["organization_id","status","scheduled_for"],["organization_id","inbox"],["organization_id","source_inbound_message_id"]]) {
    if (!indexes.some(i => i.is_valid && !i.is_unique && !i.predicate && !i.has_expressions && same(i.columns,columnsWanted))) problems.push(`INDEX(${columnsWanted.join(",")})`);
  }
  const constraints = rows(await executor.execute(sql`
    SELECT c.conname,c.contype,pg_get_constraintdef(c.oid) definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agent_mail_followups'
  `));
  const contract = constraints.find(c => c.conname === "agent_mail_followups_contract_check" && c.contype === "c");
  const definition = normalize(contract?.definition)?.replace(/[()]/g,"") ?? "";
  for (const fragment of ["uncertain_provider_outcome","send_attempt_count>0","approved_payload_versionisnotnull","status<>'sent'","sent_atisnotnull"]) {
    if (!definition.includes(fragment)) problems.push(`contract check ${fragment}`);
  }
  if (problems.length) throw new AgentMailFollowupSchemaUnavailableError(problems);
}
