import type { Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";

type Executor = Pick<typeof db, "execute">;

export class AgentMailApprovedSendSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`AgentMail approved-send schema unavailable: ${problems.join(", ")}`);
    this.name = "AgentMailApprovedSendSchemaUnavailableError";
  }
}

export function sendAgentMailApprovedSendUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof AgentMailApprovedSendSchemaUnavailableError)) return false;
  response.status(503).json({ message: "AgentMail approved sends temporarily unavailable" });
  return true;
}

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

function same(actual: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

const columns = {
  agent_mail_reply_queue: [
    ["logical_send_id", "text", false, null],
    ["approval_version", "integer", true, "0"],
    ["approved_payload_version", "text", false, null],
  ],
  agentmail_approved_logical_sends: [
    ["id", "text", true, "gen_random_uuid()"], ["org_id", "text", true, null],
    ["send_class", "text", true, "'human_approved'"], ["logical_send_id", "text", true, null],
    ["authority_type", "text", true, "'agentmail_reply_queue'"], ["authority_id", "text", true, null],
    ["approved_payload_version", "text", true, null], ["status", "text", true, "'claimed'"],
    ["provider", "text", true, "'agentmail'"], ["succeeded_at", "timestamp with time zone", false, null],
    ["uncertain_at", "timestamp with time zone", false, null], ["created_at", "timestamp with time zone", true, "now()"],
    ["updated_at", "timestamp with time zone", true, "now()"],
  ],
  agentmail_approved_send_attempts: [
    ["id", "text", true, "gen_random_uuid()"], ["logical_send_row_id", "text", true, null],
    ["attempt_number", "integer", true, null], ["provider", "text", true, "'agentmail'"],
    ["approved_payload_version", "text", true, null], ["status", "text", true, "'in_progress'"],
    ["provider_message_id", "text", false, null], ["provider_thread_id", "text", false, null],
    ["error_message", "text", false, null], ["started_at", "timestamp with time zone", true, "now()"],
    ["completed_at", "timestamp with time zone", false, null], ["created_at", "timestamp with time zone", true, "now()"],
    ["updated_at", "timestamp with time zone", true, "now()"],
  ],
} as const;

function normalize(value: unknown): string | null {
  if (value == null) return null;
  return String(value).toLowerCase().replace(/\s+/g, "")
    .replace(/::(?:text|integer|timestampwithtimezone)/g, "")
    .replace(/^\((.*)\)$/g, "$1");
}

/** Catalog-only validation. This function never creates, alters, or repairs schema. */
export async function validateAgentMailApprovedSendSchema(executor: Executor = db): Promise<void> {
  const problems: string[] = [];
  const foundColumns = rows(await executor.execute(sql`
    SELECT c.table_name,c.column_name,format_type(a.atttypid,a.atttypmod) canonical_type,
      a.attnotnull is_not_null,pg_get_expr(d.adbin,d.adrelid) column_default
    FROM information_schema.columns c JOIN pg_namespace n ON n.nspname=c.table_schema
    JOIN pg_class t ON t.relnamespace=n.oid AND t.relname=c.table_name
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE c.table_schema=current_schema() AND c.table_name IN
      ('agent_mail_reply_queue','agentmail_approved_logical_sends','agentmail_approved_send_attempts')
  `));
  for (const [table, expectedColumns] of Object.entries(columns)) {
    for (const [name, type, notNull, defaultValue] of expectedColumns) {
      const actual = foundColumns.find(row => row.table_name === table && row.column_name === name);
      if (!actual) problems.push(`${table}.${name}`);
      else if (actual.canonical_type !== type || actual.is_not_null !== notNull
        || normalize(actual.column_default) !== defaultValue) problems.push(`${table}.${name} contract mismatch`);
    }
  }

  const indexes = rows(await executor.execute(sql`
    SELECT t.relname table_name,i.indisprimary is_primary,i.indisunique is_unique,i.indisvalid is_valid,
      i.indnkeyatts key_count,bool_or(k.attnum=0) has_expressions,
      pg_get_expr(i.indpred,i.indrelid) predicate,
      array_agg(a.attname ORDER BY k.ordinality)::text[] columns
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON true
    LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE n.nspname=current_schema() AND t.relname IN
      ('agent_mail_reply_queue','agentmail_approved_logical_sends','agentmail_approved_send_attempts')
    GROUP BY t.relname,i.indexrelid
  `));
  for (const table of ["agentmail_approved_logical_sends", "agentmail_approved_send_attempts"]) {
    if (!indexes.some(index => index.table_name === table && index.is_primary && index.is_valid
      && index.key_count === 1 && !index.has_expressions && same(index.columns, ["id"]))) {
      problems.push(`${table} PRIMARY KEY(id)`);
    }
  }
  for (const expected of [
    ["agentmail_approved_logical_sends", ["org_id", "send_class", "logical_send_id"]],
    ["agentmail_approved_logical_sends", ["org_id", "authority_type", "authority_id", "approved_payload_version"]],
    ["agentmail_approved_send_attempts", ["logical_send_row_id", "attempt_number"]],
  ] as const) {
    if (!indexes.some(index => index.table_name === expected[0] && index.is_unique && index.is_valid
      && index.key_count === expected[1].length && !index.has_expressions
      && !index.predicate && same(index.columns, expected[1]))) problems.push(`${expected[0]} UNIQUE(${expected[1].join(",")})`);
  }

  const constraints = rows(await executor.execute(sql`
    SELECT t.relname table_name,c.conname,c.contype,c.convalidated,
      ft.relname foreign_table,c.confdeltype,c.confupdtype,pg_get_constraintdef(c.oid) definition,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY k.ordinality)::text[] columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=ft.oid AND a.attnum=k.attnum ORDER BY k.ordinality)::text[] foreign_columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_class ft ON ft.oid=c.confrelid
    WHERE n.nspname=current_schema() AND t.relname IN
      ('agent_mail_reply_queue','agentmail_approved_logical_sends','agentmail_approved_send_attempts')
  `));
  const authorityFk = constraints.find(c => c.table_name === "agentmail_approved_logical_sends" && c.contype === "f"
    && same(c.columns, ["org_id", "authority_id"]));
  if (!authorityFk || authorityFk.foreign_table !== "agent_mail_reply_queue"
    || !same(authorityFk.foreign_columns, ["organization_id", "id"])
    || authorityFk.confdeltype !== "r" || authorityFk.confupdtype !== "r") problems.push("logical send tenant authority FK");
  const attemptFk = constraints.find(c => c.table_name === "agentmail_approved_send_attempts" && c.contype === "f"
    && same(c.columns, ["logical_send_row_id"]));
  if (!attemptFk || attemptFk.foreign_table !== "agentmail_approved_logical_sends"
    || !same(attemptFk.foreign_columns, ["id"]) || attemptFk.confdeltype !== "r" || attemptFk.confupdtype !== "r") {
    problems.push("attempt logical send FK");
  }
  for (const name of ["agent_mail_reply_queue_approval_version_check", "agent_mail_reply_queue_approved_payload_check",
    "agentmail_approved_logical_sends_identity_check", "agentmail_approved_send_attempts_contract_check"]) {
    if (!constraints.some(c => c.conname === name && c.contype === "c")) problems.push(name);
  }
  const checkFragments: Record<string, string[]> = {
    agent_mail_reply_queue_approval_version_check: ["approval_version>=0"],
    agent_mail_reply_queue_approved_payload_check: ["approval_status<>'approved'", "logical_send_idisnotnull", "approved_payload_versionisnotnull", "approval_version>0"],
    agentmail_approved_logical_sends_identity_check: ["send_class='human_approved'", "authority_type='agentmail_reply_queue'", "provider='agentmail'", "uncertain_provider_outcome", "succeeded_atisnotnull"],
    agentmail_approved_send_attempts_contract_check: ["attempt_number>0", "provider='agentmail'", "authorized", "uncertain_provider_outcome", "completed_atisnull"],
  };
  for (const [name, fragments] of Object.entries(checkFragments)) {
    const check = constraints.find(c => c.conname === name && c.contype === "c");
    const definition = normalize(check?.definition)?.replace(/[()]/g, "") ?? "";
    for (const fragment of fragments) {
      if (!definition.includes(fragment)) problems.push(`${name} ${fragment}`);
    }
  }
  const legacyApprovalCheck = constraints.find(c => c.conname === "agent_mail_reply_queue_approved_payload_check");
  if (legacyApprovalCheck?.convalidated !== false) problems.push("historical approved payload check must remain NOT VALID");
  if (problems.length) throw new AgentMailApprovedSendSchemaUnavailableError(problems);
}
