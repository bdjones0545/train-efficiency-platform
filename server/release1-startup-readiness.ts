import type { Pool, PoolClient } from "pg";
import { pool } from "./db";

export class StartupSchemaUnavailableError extends Error {
  constructor(public readonly family: string, public readonly missing: string[]) {
    super(`${family} schema unavailable: ${missing.join(", ")}`);
    this.name = "StartupSchemaUnavailableError";
  }
}

/** Read-only relation readiness shared by production startup initializers. */
export async function verifyStartupRelations(
  family: string,
  relations: readonly string[],
  dbPool: Pick<Pool, "connect"> = pool,
): Promise<void> {
  const client: PoolClient = await dbPool.connect();
  try {
    const result = await client.query(
      `SELECT name, to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) expected(name)`,
      [relations],
    );
    const missing = result.rows.filter((row) => row.present !== true).map((row) => row.name);
    if (missing.length) throw new StartupSchemaUnavailableError(family, missing);
  } finally {
    client.release();
  }
}
