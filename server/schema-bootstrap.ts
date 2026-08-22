import type { Pool, PoolClient, QueryResult } from "pg";
import { pool } from "./db";

export type SchemaReadiness = "initializing" | "ready" | "failed";
type QueryExecutor = { query: (text: string, values?: any[]) => Promise<QueryResult<any>> };
export type SchemaBootstrapOptions = {
  beforeStatement?: (category: string, executor: QueryExecutor) => Promise<void> | void;
};

const BOOTSTRAP_VERSION = "2026-08-22.1";
const LOCK_NAMESPACE = "trainefficiency";
const LOCK_GROUP = "required-schema-bootstrap";
let readiness: SchemaReadiness = "initializing";
let readinessError: string | null = null;

const reliabilityStatements: ReadonlyArray<[string, string]> = [
  ["system_logs table", `CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level TEXT NOT NULL DEFAULT 'info', service TEXT NOT NULL DEFAULT 'platform',
    event_type TEXT NOT NULL DEFAULT 'event', message TEXT NOT NULL DEFAULT '', metadata JSONB)`],
  ["system_logs created index", "CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC)"],
  ["system_logs level index", "CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level, created_at DESC)"],
  ["system_logs service index", "CREATE INDEX IF NOT EXISTS idx_system_logs_service ON system_logs(service, created_at DESC)"],
  ["client_errors table", `CREATE TABLE IF NOT EXISTS client_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), route TEXT,
    message TEXT, stack TEXT, user_agent TEXT, source TEXT, line INTEGER, col INTEGER)`],
  ["client_errors index", "CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at DESC)"],
  ["query_failures table", `CREATE TABLE IF NOT EXISTS query_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    route TEXT, query_key TEXT, status_code INTEGER, message TEXT)`],
  ["query_failures index", "CREATE INDEX IF NOT EXISTS idx_query_failures_created ON query_failures(created_at DESC)"],
  ["health_check_results table", `CREATE TABLE IF NOT EXISTS health_check_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    check_name TEXT NOT NULL, status TEXT NOT NULL, response_time_ms INTEGER, details TEXT)`],
  ["health checks created index", "CREATE INDEX IF NOT EXISTS idx_hcr_created ON health_check_results(created_at DESC)"],
  ["health checks name index", "CREATE INDEX IF NOT EXISTS idx_hcr_name ON health_check_results(check_name, created_at DESC)"],
  ["system_alerts table", `CREATE TABLE IF NOT EXISTS system_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    severity TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, description TEXT, resolved_at TIMESTAMPTZ)`],
  ["system alerts created index", "CREATE INDEX IF NOT EXISTS idx_alerts_created ON system_alerts(created_at DESC)"],
  ["system alerts severity index", "CREATE INDEX IF NOT EXISTS idx_alerts_severity ON system_alerts(severity, resolved_at)"],
];

const requiredColumns: Record<string, string[]> = {
  system_logs: ["id", "created_at", "level", "service", "event_type", "message", "metadata"],
  client_errors: ["id", "created_at", "route", "message", "stack", "user_agent", "source", "line", "col"],
  query_failures: ["id", "created_at", "route", "query_key", "status_code", "message"],
  health_check_results: ["id", "created_at", "check_name", "status", "response_time_ms", "details"],
  system_alerts: ["id", "created_at", "severity", "title", "description", "resolved_at"],
};
const requiredIndexes = ["idx_system_logs_created", "idx_system_logs_level", "idx_system_logs_service",
  "idx_client_errors_created", "idx_query_failures_created", "idx_hcr_created", "idx_hcr_name",
  "idx_alerts_created", "idx_alerts_severity"];

async function execDDL(executor: QueryExecutor, category: string, statement: string, options: SchemaBootstrapOptions) {
  try {
    await options.beforeStatement?.(category, executor);
    await executor.query(statement);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DDL category '${category}' failed: ${message}`, { cause: error });
  }
}

export async function validateRequiredSchema(executor: QueryExecutor): Promise<void> {
  const tables = Object.keys(requiredColumns);
  const columns = await executor.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`, [tables]);
  const found = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = Object.entries(requiredColumns).flatMap(([table, names]) =>
    names.filter((name) => !found.has(`${table}.${name}`)).map((name) => `${table}.${name}`));
  const indexes = await executor.query(`SELECT indexname FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = ANY($1::text[])`, [requiredIndexes]);
  const foundIndexes = new Set(indexes.rows.map((row) => row.indexname));
  const missingIndexes = requiredIndexes.filter((name) => !foundIndexes.has(name));
  if (missingColumns.length || missingIndexes.length) {
    throw new Error(`Required schema is incomplete (columns: ${missingColumns.join(", ") || "none"}; indexes: ${missingIndexes.join(", ") || "none"})`);
  }
}

async function runRequiredInitializers(client: PoolClient, options: SchemaBootstrapOptions) {
  await execDDL(client, "bootstrap marker table", `CREATE TABLE IF NOT EXISTS train_efficiency_schema_bootstrap (
    bootstrap_version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`, options);
  for (const [category, statement] of reliabilityStatements) await execDDL(client, category, statement, options);
  await validateRequiredSchema(client);
  await client.query(`INSERT INTO train_efficiency_schema_bootstrap (bootstrap_version, applied_at)
    VALUES ($1, NOW()) ON CONFLICT (bootstrap_version) DO UPDATE SET applied_at = EXCLUDED.applied_at`, [BOOTSTRAP_VERSION]);
}

export function getSchemaReadiness() {
  return { state: readiness, error: readinessError, version: BOOTSTRAP_VERSION } as const;
}

export async function initializeRequiredSchema(dbPool: Pick<Pool, "connect"> = pool, options: SchemaBootstrapOptions = {}) {
  readiness = "initializing";
  readinessError = null;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [LOCK_NAMESPACE, LOCK_GROUP]);
    await runRequiredInitializers(client, options);
    await client.query("COMMIT");
    readiness = "ready";
    console.log(`[SchemaBootstrap] REQUIRED reliability schema ready (${BOOTSTRAP_VERSION})`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    readiness = "failed";
    readinessError = error instanceof Error ? error.message : String(error);
    console.error(`[SchemaBootstrap] REQUIRED initialization failed; readiness blocked: ${readinessError}`);
    throw error;
  } finally {
    client.release();
  }
}
