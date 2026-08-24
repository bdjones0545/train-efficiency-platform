import type { Pool, PoolClient } from "pg";
import { pool } from "./db";
import { ensureWorkflowJobIdempotencySchema, ensureWorkflowJobReliabilitySchema } from "./workflow-job-queue";
import { ensureAgentDeadLetterSchema } from "./services/agent-dead-letter-service";
import { ensureProviderCircuitSchema } from "./services/retry-reliability";
import { ensureFollowUpReliabilitySchema } from "./email-agent/follow-up-reliability";
import {
  beginRequiredFeatureSchemaInitialization,
  completeRequiredFeatureSchemaInitialization,
  failRequiredFeatureSchemaInitialization,
  getRequiredFeatureSchemaReadiness,
  markRequiredFeatureSubsystem,
} from "./required-feature-readiness-state";

const LOCK_NAMESPACE = "trainefficiency";
const LOCK_GROUP = "required-feature-schemas";

export const REQUIRED_FEATURE_SUBSYSTEMS = [
  "workflow",
  "agent_dead_letter",
  "provider_circuit_breaker",
  "follow_up_reliability",
  "scheduler_locks",
] as const;

export type RequiredFeatureSubsystem = typeof REQUIRED_FEATURE_SUBSYSTEMS[number];
export type RequiredFeatureSchemaOptions = {
  beforeSubsystem?: (name: RequiredFeatureSubsystem, client: PoolClient) => Promise<void> | void;
};

type ColumnInvariant = { table: string; column: string; udt: string; notNull: boolean };

const requiredColumns: ColumnInvariant[] = [
  { table: "workflow_jobs", column: "execution_generation", udt: "int4", notNull: true },
  { table: "workflow_jobs", column: "payload_version", udt: "int4", notNull: true },
  { table: "workflow_job_effects", column: "execution_generation", udt: "int4", notNull: true },
  { table: "workflow_job_effects", column: "effect_key", udt: "text", notNull: true },
  { table: "agent_dead_letter_queue", column: "org_id", udt: "text", notNull: true },
  { table: "agent_dead_letter_queue", column: "execution_generation", udt: "int4", notNull: true },
  { table: "agent_dead_letter_queue", column: "payload_version", udt: "int4", notNull: true },
  { table: "agent_dead_letter_queue", column: "locked_by", udt: "text", notNull: false },
  { table: "agent_dead_letter_effects", column: "effect_key", udt: "text", notNull: true },
  { table: "provider_circuit_breakers", column: "state", udt: "text", notNull: true },
  { table: "provider_circuit_breakers", column: "probe_token", udt: "text", notNull: false },
  { table: "email_follow_ups", column: "processing_started_at", udt: "timestamp", notNull: false },
  { table: "email_follow_ups", column: "attempt_count", udt: "int4", notNull: true },
  { table: "email_follow_ups", column: "next_retry_at", udt: "timestamp", notNull: false },
  { table: "follow_up_send_effects", column: "state", udt: "text", notNull: true },
  { table: "follow_up_send_effects", column: "provider_message_id", udt: "text", notNull: false },
  { table: "job_execution_locks", column: "lock_key", udt: "text", notNull: true },
  { table: "job_execution_locks", column: "expires_at", udt: "timestamp", notNull: true },
  { table: "job_execution_locks", column: "status", udt: "text", notNull: true },
];

const requiredIndexes: Array<{ table: string; columns: string[]; unique: boolean; predicate?: string }> = [
  { table: "workflow_jobs", columns: ["org_id", "idempotency_key"], unique: true },
  { table: "workflow_job_effects", columns: ["org_id", "workflow_job_id", "effect_key", "execution_generation"], unique: true },
  { table: "agent_dead_letter_queue", columns: ["status", "next_retry_at", "created_at"], unique: false },
  { table: "agent_dead_letter_effects", columns: ["dead_letter_id", "execution_generation", "effect_key"], unique: true },
  { table: "provider_circuit_breakers", columns: ["dependency_key"], unique: true },
  { table: "email_follow_ups", columns: ["org_id", "status", "next_retry_at", "processing_started_at"], unique: false },
  { table: "follow_up_send_effects", columns: ["org_id", "follow_up_id"], unique: true },
  { table: "job_execution_locks", columns: ["lock_key"], unique: true },
];

function sameColumns(actual: unknown, expected: string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export async function validateRequiredFeatureSchemas(client: Pick<PoolClient, "query">): Promise<void> {
  const tables = [...new Set(requiredColumns.map(({ table }) => table))];
  const [columnsResult, indexesResult] = await Promise.all([
    client.query(`SELECT table_name,column_name,udt_name,is_nullable FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name=ANY($1::text[])`, [tables]),
    client.query(`SELECT rel.relname AS table_name,idx.relname AS index_name,ind.indisunique,
        ARRAY(SELECT att.attname::text FROM unnest(ind.indkey) WITH ORDINALITY key(attnum,ord)
          JOIN pg_attribute att ON att.attrelid=ind.indrelid AND att.attnum=key.attnum ORDER BY key.ord)::text[] AS columns,
        pg_get_expr(ind.indpred,ind.indrelid) AS predicate
      FROM pg_index ind JOIN pg_class rel ON rel.oid=ind.indrelid
      JOIN pg_class idx ON idx.oid=ind.indexrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      WHERE ns.nspname=current_schema() AND rel.relname=ANY($1::text[])`, [tables]),
  ]);
  const columns = new Map(columnsResult.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  const problems: string[] = [];
  for (const expected of requiredColumns) {
    const actual = columns.get(`${expected.table}.${expected.column}`);
    if (!actual) {
      problems.push(`missing ${expected.table}.${expected.column}`);
      continue;
    }
    if (actual.udt_name !== expected.udt) problems.push(`type ${expected.table}.${expected.column} expected ${expected.udt} got ${actual.udt_name}`);
    if (expected.notNull && actual.is_nullable !== "NO") problems.push(`nullable ${expected.table}.${expected.column}`);
  }
  for (const expected of requiredIndexes) {
    const match = indexesResult.rows.find((row) => row.table_name === expected.table
      && row.indisunique === expected.unique && sameColumns(row.columns, expected.columns)
      && (!expected.predicate || String(row.predicate ?? "").includes(expected.predicate)));
    if (!match) problems.push(`${expected.unique ? "unique " : ""}index ${expected.table}(${expected.columns.join(",")})`);
  }
  if (problems.length) throw new Error(`Required feature schema is incompatible: ${problems.join("; ")}`);
}

async function runSubsystem(
  name: RequiredFeatureSubsystem,
  client: PoolClient,
  initialize: () => Promise<void>,
  options: RequiredFeatureSchemaOptions,
): Promise<void> {
  try {
    await options.beforeSubsystem?.(name, client);
    await initialize();
    markRequiredFeatureSubsystem(name, "ready");
  } catch (error) {
    markRequiredFeatureSubsystem(name, "failed");
    throw new Error(`Required feature subsystem '${name}' failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export async function initializeRequiredFeatureSchemas(
  dbPool: Pick<Pool, "connect"> = pool,
  options: RequiredFeatureSchemaOptions = {},
): Promise<void> {
  beginRequiredFeatureSchemaInitialization([...REQUIRED_FEATURE_SUBSYSTEMS]);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [LOCK_NAMESPACE, LOCK_GROUP]);
    await runSubsystem("workflow", client, async () => {
      await ensureWorkflowJobIdempotencySchema(client);
      await ensureWorkflowJobReliabilitySchema(client);
    }, options);
    await runSubsystem("agent_dead_letter", client, () => ensureAgentDeadLetterSchema(client), options);
    await runSubsystem("provider_circuit_breaker", client, () => ensureProviderCircuitSchema(client), options);
    await runSubsystem("follow_up_reliability", client, () => ensureFollowUpReliabilitySchema(client), options);
    await runSubsystem("scheduler_locks", client, async () => undefined, options);
    await validateRequiredFeatureSchemas(client);
    await client.query("COMMIT");
    completeRequiredFeatureSchemaInitialization();
    console.log("[RequiredFeatureSchemas] required feature schema ready");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    failRequiredFeatureSchemaInitialization(error);
    console.error(`[RequiredFeatureSchemas] initialization failed; readiness blocked: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    client.release();
  }
}

export { getRequiredFeatureSchemaReadiness };
