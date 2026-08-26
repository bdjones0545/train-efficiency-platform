import { sql } from "drizzle-orm";
import type { Response } from "express";
import { db } from "./db";

type ColumnContract = { name: string; type: string; notNull: boolean; defaultValue: string | null };

const REGISTRY_COLUMNS: readonly ColumnContract[] = [
  { name: "id", type: "text", notNull: true, defaultValue: "gen_random_uuid()" },
  { name: "org_id", type: "text", notNull: true, defaultValue: null },
  { name: "action_type", type: "text", notNull: true, defaultValue: null },
  { name: "gmail_thread_id", type: "text", notNull: false, defaultValue: null },
  { name: "source_conversation_id", type: "text", notNull: false, defaultValue: null },
  { name: "prospect_id", type: "text", notNull: false, defaultValue: null },
  { name: "lead_id", type: "text", notNull: false, defaultValue: null },
  { name: "canonical_resource_type", type: "text", notNull: false, defaultValue: null },
  { name: "canonical_resource_id", type: "text", notNull: false, defaultValue: null },
  { name: "coordination_generation", type: "text", notNull: false, defaultValue: null },
  { name: "status", type: "text", notNull: true, defaultValue: "'active'" },
  { name: "support_score", type: "integer", notNull: false, defaultValue: "0" },
  { name: "source_agents", type: "text[]", notNull: false, defaultValue: "array[]" },
  { name: "last_agent", type: "text", notNull: false, defaultValue: null },
  { name: "source_action_id", type: "text", notNull: false, defaultValue: null },
  { name: "created_at", type: "timestamp with time zone", notNull: false, defaultValue: "now()" },
  { name: "updated_at", type: "timestamp with time zone", notNull: false, defaultValue: "now()" },
];

const DECISION_COLUMNS: readonly ColumnContract[] = [
  { name: "id", type: "text", notNull: true, defaultValue: "gen_random_uuid()" },
  { name: "org_id", type: "text", notNull: true, defaultValue: null },
  { name: "action_type", type: "text", notNull: true, defaultValue: null },
  { name: "gmail_thread_id", type: "text", notNull: false, defaultValue: null },
  { name: "source_conversation_id", type: "text", notNull: false, defaultValue: null },
  { name: "prospect_id", type: "text", notNull: false, defaultValue: null },
  { name: "lead_id", type: "text", notNull: false, defaultValue: null },
  { name: "canonical_resource_type", type: "text", notNull: false, defaultValue: null },
  { name: "canonical_resource_id", type: "text", notNull: false, defaultValue: null },
  { name: "coordination_generation", type: "text", notNull: false, defaultValue: null },
  { name: "registry_id", type: "text", notNull: false, defaultValue: null },
  { name: "decision", type: "text", notNull: true, defaultValue: null },
  { name: "original_action_id", type: "text", notNull: false, defaultValue: null },
  { name: "merged_action_id", type: "text", notNull: false, defaultValue: null },
  { name: "support_score", type: "integer", notNull: false, defaultValue: "1" },
  { name: "requesting_agent", type: "text", notNull: false, defaultValue: null },
  { name: "metadata", type: "jsonb", notNull: false, defaultValue: null },
  { name: "created_at", type: "timestamp with time zone", notNull: false, defaultValue: "now()" },
];

export class CrossAgentCoordinationSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Cross-Agent Coordination schema is unavailable: ${problems.join(", ")}`);
    this.name = "CrossAgentCoordinationSchemaUnavailableError";
  }
}

export function sendCrossAgentCoordinationUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof CrossAgentCoordinationSchemaUnavailableError)) return false;
  response.status(503).json({ message: "Cross-Agent Coordination unavailable" });
  return true;
}

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

function normalize(value: unknown): string | null {
  if (value == null) return null;
  return String(value).toLowerCase().replace(/\s+/g, "")
    .replace(/::(?:text\[\]|text|jsonb|timestampwithtimezone)/g, "")
    .replace(/^\((.*)\)$/g, "$1");
}

function same(actual: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

async function validateColumns(executor: Pick<typeof db, "execute">, table: string, contract: readonly ColumnContract[], problems: string[]) {
  const found = rows(await executor.execute(sql`
    SELECT c.column_name,c.column_default,format_type(a.atttypid,a.atttypmod) canonical_type,a.attnotnull is_not_null
    FROM information_schema.columns c JOIN pg_namespace n ON n.nspname=c.table_schema
    JOIN pg_class t ON t.relnamespace=n.oid AND t.relname=c.table_name
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name
    WHERE c.table_schema=current_schema() AND c.table_name=${table}
  `));
  for (const expected of contract) {
    const actual = found.find(row => row.column_name === expected.name);
    if (!actual) problems.push(`${table}.${expected.name}`);
    else if (actual.canonical_type !== expected.type || actual.is_not_null !== expected.notNull
      || normalize(actual.column_default) !== expected.defaultValue) problems.push(`${table}.${expected.name} contract mismatch`);
  }
}

/** Catalog-only validation. It never creates, alters, or repairs schema. */
export async function validateCrossAgentCoordinationSchema(
  executor: Pick<typeof db, "execute"> = db,
): Promise<void> {
  const problems: string[] = [];
  await validateColumns(executor, "agent_action_registry", REGISTRY_COLUMNS, problems);
  await validateColumns(executor, "coordination_decisions", DECISION_COLUMNS, problems);

  const keys = rows(await executor.execute(sql`
    SELECT t.relname table_name,i.indisprimary is_primary,i.indisunique is_unique,i.indisvalid is_valid,
      pg_get_expr(i.indpred,i.indrelid) predicate,
      array_agg(a.attname ORDER BY k.ordinality)::text[] columns,
      array_agg((i.indoption[k.ordinality-1]&1)=1 ORDER BY k.ordinality)::boolean[] descending
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON true
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE n.nspname=current_schema() AND t.relname IN ('agent_action_registry','coordination_decisions')
    GROUP BY t.relname,i.indexrelid
  `));
  for (const table of ["agent_action_registry", "coordination_decisions"]) {
    if (!keys.some(key => key.table_name === table && key.is_primary && key.is_valid && same(key.columns, ["id"]))) {
      problems.push(`${table} PRIMARY KEY(id)`);
    }
  }
  const regular = [
    ["agent_action_registry", ["org_id", "action_type"]],
    ["agent_action_registry", ["gmail_thread_id"]],
    ["agent_action_registry", ["prospect_id"]],
    ["coordination_decisions", ["org_id"]],
    ["coordination_decisions", ["gmail_thread_id"]],
    ["coordination_decisions", ["prospect_id"]],
    ["coordination_decisions", ["action_type"]],
    ["coordination_decisions", ["registry_id"]],
  ] as const;
  for (const [table, columns] of regular) {
    if (!keys.some(key => key.table_name === table && !key.is_primary && !key.is_unique && key.is_valid
      && !key.predicate && same(key.columns, columns) && same(key.descending, columns.map(() => false)))) {
      problems.push(`${table} INDEX(${columns.join(",")})`);
    }
  }
  const identityColumns = ["org_id", "action_type", "canonical_resource_type", "canonical_resource_id", "coordination_generation"];
  const activeUnique = keys.find(key => key.table_name === "agent_action_registry" && !key.is_primary
    && key.is_unique && key.is_valid && same(key.columns, identityColumns));
  const predicate = normalize(activeUnique?.predicate)?.replace(/[()]/g, "");
  if (!activeUnique || (predicate !== "status='active'" && predicate !== "'active'=status")) {
    problems.push("agent_action_registry active canonical UNIQUE");
  }

  const checks = rows(await executor.execute(sql`
    SELECT c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agent_action_registry' AND c.contype='c'
  `));
  const activeCheck = checks.find(row => row.conname === "agent_action_registry_active_identity_check");
  const checkDefinition = normalize(activeCheck?.definition) ?? "";
  for (const fragment of ["status<>'active'", "'default'", "canonical_resource_type", "canonical_resource_id", "coordination_generation", "support_score=cardinality(source_agents)", "cross_agent_coordination_has_distinct_agents(source_agents)"]) {
    if (!checkDefinition.includes(fragment)) problems.push(`agent_action_registry active check ${fragment}`);
  }

  const distinctAgentFunctions = rows(await executor.execute(sql`
    SELECT pg_get_function_identity_arguments(p.oid) identity_arguments,
      pg_get_function_result(p.oid) result_type,l.lanname language,p.provolatile volatility,
      p.proisstrict is_strict,p.prosecdef security_definer,p.proparallel parallel_safety,p.prosrc source
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=current_schema() AND p.proname='cross_agent_coordination_has_distinct_agents'
  `));
  const distinctAgentFunction = distinctAgentFunctions[0];
  if (distinctAgentFunctions.length !== 1 || distinctAgentFunction.identity_arguments !== "agents text[]"
    || distinctAgentFunction.result_type !== "boolean" || distinctAgentFunction.language !== "sql"
    || distinctAgentFunction.volatility !== "i" || distinctAgentFunction.is_strict !== true
    || distinctAgentFunction.security_definer !== false || distinctAgentFunction.parallel_safety !== "s"
    || normalize(distinctAgentFunction.source) !== "selectpg_catalog.cardinality(agents)=(selectpg_catalog.count(distinctagent)frompg_catalog.unnest(agents)asagent)") {
    problems.push("cross_agent_coordination_has_distinct_agents(text[])");
  }
  if (problems.length) throw new CrossAgentCoordinationSchemaUnavailableError(problems);
}
