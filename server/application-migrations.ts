import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as applicationSchema from "@shared/schema";
import { pool } from "./db";

const LOCK_NAMESPACE = "trainefficiency";
const LOCK_NAME = "application-migrations";
const LEDGER_TABLE = "train_efficiency_migrations";

export type MigrationReadiness = "not_started" | "migrating" | "ready" | "failed";
export type ApplicationMigrationOptions = {
  migrationsDirectory?: string;
  beforeMigration?: (migrationId: string, client: PoolClient) => Promise<void> | void;
};

export type MigrationReadinessCode =
  | "MIGRATION_INFRASTRUCTURE_MISSING"
  | "MIGRATIONS_REQUIRED"
  | "MIGRATION_STATE_INVALID";

export class ApplicationMigrationReadinessError extends Error {
  constructor(public readonly code: MigrationReadinessCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ApplicationMigrationReadinessError";
  }
}

let readiness: MigrationReadiness = "not_started";
let readinessError: string | null = null;
let latestExpected: string | null = null;
let latestApplied: string | null = null;

export function getApplicationMigrationReadiness() {
  return { state: readiness, error: readinessError, latestExpected, latestApplied } as const;
}

function migrationDirectory(explicit?: string): string {
  return explicit ?? path.resolve(process.cwd(), "migrations");
}

async function migrationFiles(directory: string): Promise<string[]> {
  return (await fs.readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

async function relationExists(client: PoolClient, relation: string): Promise<boolean> {
  const result = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [relation]);
  return result.rows[0]?.present === true;
}

function expectedTables() {
  const tables = new Map<string, ReturnType<typeof getTableConfig>>();
  for (const value of Object.values(applicationSchema)) {
    try {
      const config = getTableConfig(value as any);
      if (config?.name) tables.set(config.name, config);
    } catch {
      // Non-table schema exports are intentionally ignored.
    }
  }
  return [...tables.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function compatibleType(expectedSqlType: string, actualUdt: string): boolean {
  const expected = expectedSqlType.toLowerCase().replace(/\s+/g, " ");
  const actual = actualUdt.toLowerCase();
  if (expected.endsWith("[]")) {
    const element = expected.slice(0, -2);
    const aliases: Record<string, string> = {
      integer: "int4",
      bigint: "int8",
      boolean: "bool",
      varchar: "varchar",
      text: "text",
      uuid: "uuid",
    };
    return actual === `_${aliases[element] ?? element}`;
  }
  if (expected.startsWith("varchar")) return actual === "varchar";
  if (expected === "text") return actual === "text";
  if (expected === "boolean") return actual === "bool";
  if (expected === "integer" || expected === "serial") return actual === "int4";
  if (expected === "bigint" || expected === "bigserial") return actual === "int8";
  if (expected.startsWith("numeric") || expected.startsWith("decimal")) return actual === "numeric";
  if (expected.startsWith("double precision")) return actual === "float8";
  if (expected.startsWith("real")) return actual === "float4";
  if (expected.startsWith("timestamp with time zone")) return actual === "timestamptz";
  if (expected.startsWith("timestamp")) return actual === "timestamp";
  if (expected === "date") return actual === "date";
  if (expected === "json" || expected === "jsonb") return actual === expected;
  if (expected === "uuid") return actual === "uuid";
  return actual === expected.replaceAll('"', "");
}

const dialect = new PgDialect();

function excludedBaselineColumn(table: string, column: string): boolean {
  return table === "user_org_preferences" && column === "unsubscribe_token";
}

function normalizeExpression(value: string | null | undefined): string | null {
  if (value == null) return null;
  let normalized = value.replace(/\s+/g, " ").trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized
    .replace(/::(?:character varying|text|boolean|integer|bigint|numeric|uuid|regclass|timestamp(?: without time zone)?|[a-z_][a-z0-9_]*)(?:\[\])?/gi, "")
    .replace(/"([^"}]*)"/g, "$1")
    .replace(/^'(true|false)'$/i, (match) => match.slice(1, -1).toLowerCase())
    .replace(/\s+/g, " ")
    .trim();
}

function expectedDefault(value: unknown, sqlType: string): string {
  if (value && (value as any).constructor?.name === "SQL") return dialect.sqlToQuery(value as any).sql;
  if (Array.isArray(value) && (sqlType === "json" || sqlType === "jsonb")) return `'${JSON.stringify(value)}'`;
  if (Array.isArray(value)) return `'{${value.map((item) => String(item).replaceAll('"', '\\"')).join(",")}}'`;
  if (typeof value === "object" && value !== null) return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  return String(value);
}

function sameColumns(actual: unknown, expected: string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function expectedEnums(): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  for (const value of Object.values(applicationSchema)) {
    if (typeof value === "function" && "enumName" in value && "enumValues" in value) {
      enums.set(String((value as any).enumName), [...(value as any).enumValues]);
    }
  }
  return enums;
}

/**
 * Existing installations may adopt the generated baseline only after every
 * Drizzle-owned material invariant is proven compatible. Additive drift (extra
 * columns, indexes, and enum labels) is accepted, but required identity,
 * uniqueness, defaults, references, and ordered enum labels may not drift.
 * Validation is read-only: incompatible installations require an explicit
 * migration and are never repaired or silently marked complete here.
 */
export async function validateExistingBaseline(client: PoolClient): Promise<void> {
  const [tableRows, columnRows, constraintRows, indexRows, enumRows] = await Promise.all([
    client.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_type='BASE TABLE'`),
    client.query(`SELECT table_name,column_name,is_nullable,udt_name,column_default
      FROM information_schema.columns WHERE table_schema=current_schema()`),
    client.query(`SELECT rel.relname AS table_name, con.conname, con.contype,
        ARRAY(SELECT att.attname::text FROM unnest(con.conkey) WITH ORDINALITY key(attnum,ord)
          JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=key.attnum ORDER BY key.ord)::text[] AS columns,
        foreign_rel.relname AS foreign_table,
        ARRAY(SELECT att.attname::text FROM unnest(con.confkey) WITH ORDINALITY key(attnum,ord)
          JOIN pg_attribute att ON att.attrelid=con.confrelid AND att.attnum=key.attnum ORDER BY key.ord)::text[] AS foreign_columns,
        con.confdeltype,con.confupdtype
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      LEFT JOIN pg_class foreign_rel ON foreign_rel.oid=con.confrelid
      WHERE ns.nspname=current_schema() AND con.contype IN ('p','u','f')`),
    client.query(`SELECT rel.relname AS table_name, idx.relname AS index_name, ind.indisunique,
        ARRAY(SELECT att.attname::text FROM unnest(ind.indkey) WITH ORDINALITY key(attnum,ord)
          JOIN pg_attribute att ON att.attrelid=ind.indrelid AND att.attnum=key.attnum ORDER BY key.ord)::text[] AS columns
      FROM pg_index ind JOIN pg_class rel ON rel.oid=ind.indrelid
      JOIN pg_class idx ON idx.oid=ind.indexrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      WHERE ns.nspname=current_schema()`),
    client.query(`SELECT typ.typname AS enum_name, enum.enumlabel,
        row_number() OVER (PARTITION BY typ.oid ORDER BY enum.enumsortorder)::int AS position
      FROM pg_type typ JOIN pg_namespace ns ON ns.oid=typ.typnamespace
      JOIN pg_enum enum ON enum.enumtypid=typ.oid WHERE ns.nspname=current_schema()`),
  ]);
  const actualTables = new Set(tableRows.rows.map((row) => row.table_name));
  const actual = new Map(columnRows.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  const constraints = constraintRows.rows;
  const indexes = indexRows.rows;
  const problems: string[] = [];
  for (const table of expectedTables()) {
    if (!actualTables.has(table.name)) {
      problems.push(`missing table ${table.name}`);
      continue;
    }
    for (const column of table.columns) {
      if (excludedBaselineColumn(table.name, column.name)) continue;
      const found = actual.get(`${table.name}.${column.name}`);
      if (!found) {
        problems.push(`missing ${table.name}.${column.name}`);
        continue;
      }
      if (column.notNull && found.is_nullable !== "NO") problems.push(`nullable ${table.name}.${column.name}`);
      if (!compatibleType(column.getSQLType(), found.udt_name)) {
        problems.push(`type ${table.name}.${column.name} expected ${column.getSQLType()} got ${found.udt_name}`);
      }
      if (column.default !== undefined && normalizeExpression(found.column_default) !== normalizeExpression(expectedDefault(column.default, column.getSQLType()))) {
        problems.push(`default ${table.name}.${column.name} expected ${expectedDefault(column.default, column.getSQLType())} got ${found.column_default ?? "none"}`);
      }
      if ((column.getSQLType() === "serial" || column.getSQLType() === "bigserial") && !normalizeExpression(found.column_default)?.startsWith("nextval(")) {
        problems.push(`default ${table.name}.${column.name} expected sequence nextval got ${found.column_default ?? "none"}`);
      }
    }

    const primaryColumns = [
      ...table.columns.filter((column) => column.primary).map((column) => column.name),
      ...table.primaryKeys.flatMap((key) => key.columns.map((column) => column.name)),
    ];
    if (primaryColumns.length && !constraints.some((row) => row.table_name === table.name && row.contype === "p" && sameColumns(row.columns, primaryColumns))) {
      problems.push(`primary key ${table.name} expected (${primaryColumns.join(",")})`);
    }

    const uniqueSets = [
      ...table.columns.filter((column) => column.isUnique && !excludedBaselineColumn(table.name, column.name))
        .map((column) => ({ name: column.uniqueName, columns: [column.name] })),
      ...table.uniqueConstraints.map((unique) => ({ name: unique.name, columns: unique.columns.map((column) => column.name) })),
      ...table.indexes.filter((index) => index.config.unique && index.config.name !== "user_org_preferences_unsubscribe_token_unique")
        .map((index) => ({ name: index.config.name, columns: index.config.columns.map((column: any) => column.name) })),
    ];
    for (const unique of uniqueSets) {
      const present = constraints.some((row) => row.table_name === table.name && row.contype === "u" && sameColumns(row.columns, unique.columns))
        || indexes.some((row) => row.table_name === table.name && row.indisunique && sameColumns(row.columns, unique.columns));
      if (!present) problems.push(`unique ${table.name}.${unique.name} expected (${unique.columns.join(",")})`);
    }

    for (const foreignKey of table.foreignKeys) {
      const reference = foreignKey.reference();
      const columns = reference.columns.map((column) => column.name);
      if (columns.some((column) => excludedBaselineColumn(table.name, column))) continue;
      const foreignTable = getTableConfig(reference.foreignTable).name;
      const foreignColumns = reference.foreignColumns.map((column) => column.name);
      const actionCode = (action: string | undefined) => ({ cascade: "c", restrict: "r", "set null": "n", "set default": "d" })[action ?? ""] ?? "a";
      const present = constraints.some((row) => row.table_name === table.name && row.contype === "f"
        && sameColumns(row.columns, columns) && row.foreign_table === foreignTable
        && sameColumns(row.foreign_columns, foreignColumns)
        && row.confdeltype === actionCode(foreignKey.onDelete) && row.confupdtype === actionCode(foreignKey.onUpdate));
      if (!present) problems.push(`foreign key ${table.name}.${foreignKey.getName()} expected (${columns.join(",")}) -> ${foreignTable}(${foreignColumns.join(",")})`);
    }
  }

  const actualEnums = new Map<string, string[]>();
  for (const row of enumRows.rows) {
    const labels = actualEnums.get(row.enum_name) ?? [];
    labels.push(row.enumlabel);
    actualEnums.set(row.enum_name, labels);
  }
  for (const [name, required] of expectedEnums()) {
    const labels = actualEnums.get(name);
    if (!labels) {
      problems.push(`missing enum ${name}`);
      continue;
    }
    const requiredInActualOrder = labels.filter((label) => required.includes(label));
    if (!sameColumns(requiredInActualOrder, required)) {
      problems.push(`enum ${name} expected ordered labels ${required.join(",")}`);
    }
    for (const label of required) if (!labels.includes(label)) problems.push(`enum ${name} missing label ${label}`);
  }
  if (problems.length) {
    throw new Error(`Existing database is incompatible with application baseline: ${problems.slice(0, 20).join("; ")}${problems.length > 20 ? `; and ${problems.length - 20} more` : ""}`);
  }
}

async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
    migration_id TEXT PRIMARY KEY,
    checksum_sha256 TEXT NOT NULL,
    execution_kind TEXT NOT NULL CHECK (execution_kind IN ('executed','adopted')),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function applyOne(
  client: PoolClient,
  migrationId: string,
  sql: string,
  digest: string,
  executionKind: "executed" | "adopted",
  beforeMigration?: ApplicationMigrationOptions["beforeMigration"],
): Promise<void> {
  await client.query("BEGIN");
  try {
    await beforeMigration?.(migrationId, client);
    if (executionKind === "executed") await client.query(sql);
    await client.query(`INSERT INTO ${LEDGER_TABLE}(migration_id,checksum_sha256,execution_kind)
      VALUES($1,$2,$3)`, [migrationId, digest, executionKind]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function runApplicationMigrations(
  dbPool: Pick<Pool, "connect"> = pool,
  options: ApplicationMigrationOptions = {},
): Promise<void> {
  readiness = "migrating";
  readinessError = null;
  const directory = migrationDirectory(options.migrationsDirectory);
  const files = await migrationFiles(directory);
  if (!files.length || files[0] !== "0000_application_baseline.sql") {
    throw new Error("Application migration baseline is missing or not first");
  }
  latestExpected = files.at(-1) ?? null;
  const client = await dbPool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1),hashtext($2))", [LOCK_NAMESPACE, LOCK_NAME]);
    await ensureLedger(client);
    const appliedRows = await client.query(`SELECT migration_id,checksum_sha256 FROM ${LEDGER_TABLE} ORDER BY migration_id`);
    const applied = new Map(appliedRows.rows.map((row) => [row.migration_id, row.checksum_sha256]));

    for (const file of files) {
      const sql = await fs.readFile(path.join(directory, file), "utf8");
      const digest = checksum(sql);
      const recorded = applied.get(file);
      if (recorded) {
        if (recorded !== digest) throw new Error(`Applied migration checksum mismatch: ${file}`);
        latestApplied = file;
        continue;
      }

      let kind: "executed" | "adopted" = "executed";
      if (file === "0000_application_baseline.sql" && await relationExists(client, "users")) {
        await validateExistingBaseline(client);
        kind = "adopted";
      }
      await applyOne(client, file, sql, digest, kind, options.beforeMigration);
      latestApplied = file;
    }

    if (latestApplied !== latestExpected) throw new Error("Application migration ledger is incomplete");
    readiness = "ready";
    console.log(`[ApplicationMigrations] ready latest=${latestApplied}`);
  } catch (error) {
    readiness = "failed";
    readinessError = error instanceof Error ? error.message : String(error);
    console.error(`[ApplicationMigrations] failed: ${readinessError}`);
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1),hashtext($2))", [LOCK_NAMESPACE, LOCK_NAME]).catch(() => undefined);
    client.release();
  }
}

/**
 * Proves that the database is at the repository's canonical migration state.
 * This runtime-authority path is deliberately read-only: it never locks,
 * bootstraps, applies, or repairs migration state.
 */
export async function verifyApplicationMigrationReadiness(
  dbPool: Pick<Pool, "connect"> = pool,
  options: Pick<ApplicationMigrationOptions, "migrationsDirectory"> = {},
): Promise<void> {
  readiness = "migrating";
  readinessError = null;
  latestApplied = null;
  let client: PoolClient | null = null;
  try {
    const directory = migrationDirectory(options.migrationsDirectory);
    const files = await migrationFiles(directory);
    if (!files.length || files[0] !== "0000_application_baseline.sql") {
      throw new ApplicationMigrationReadinessError("MIGRATION_STATE_INVALID", "repository migration baseline is missing or not first");
    }
    latestExpected = files.at(-1) ?? null;
    client = await dbPool.connect();
    if (!await relationExists(client, LEDGER_TABLE)) {
      throw new ApplicationMigrationReadinessError(
        "MIGRATION_INFRASTRUCTURE_MISSING",
        `migration ledger ${LEDGER_TABLE} is missing; run the privileged migration command`,
      );
    }

    const result = await client.query(`SELECT migration_id,checksum_sha256 FROM ${LEDGER_TABLE} ORDER BY migration_id`);
    const rows = result.rows as Array<{ migration_id: string; checksum_sha256: string }>;
    const appliedIds = rows.map((row) => row.migration_id);
    const expectedPrefix = files.slice(0, appliedIds.length);
    const isCanonicalPrefix = appliedIds.every((id, index) => id === expectedPrefix[index]);
    if (!isCanonicalPrefix || appliedIds.length > files.length) {
      throw new ApplicationMigrationReadinessError(
        "MIGRATION_STATE_INVALID",
        `ledger ordering or contents conflict with repository migrations (applied: ${appliedIds.join(", ") || "none"})`,
      );
    }

    for (const row of rows) {
      const sql = await fs.readFile(path.join(directory, row.migration_id), "utf8");
      if (row.checksum_sha256 !== checksum(sql)) {
        throw new ApplicationMigrationReadinessError("MIGRATION_STATE_INVALID", `checksum mismatch for ${row.migration_id}`);
      }
      latestApplied = row.migration_id;
    }

    if (rows.length < files.length) {
      throw new ApplicationMigrationReadinessError(
        "MIGRATIONS_REQUIRED",
        `pending migrations: ${files.slice(rows.length).join(", ")}`,
      );
    }
    if (latestApplied !== latestExpected) {
      throw new ApplicationMigrationReadinessError("MIGRATION_STATE_INVALID", "ledger latest migration is not canonical");
    }
    readiness = "ready";
    console.log(`[ApplicationMigrations] runtime readiness verified latest=${latestApplied}`);
  } catch (error) {
    readiness = "failed";
    readinessError = error instanceof Error ? error.message : String(error);
    console.error(`[ApplicationMigrations] runtime readiness failed: ${readinessError}`);
    throw error;
  } finally {
    client?.release();
  }
}
