import type { Pool, PoolClient } from "pg";
import { pool } from "../db";
import { isRequiredFeatureSchemaReady } from "../required-feature-readiness-state";

export type RetryRandom = () => number;

/** Positive-only bounded jitter preserves the subsystem base delay as a floor. */
export function jitteredDelayMs(baseDelayMs: number, random: RetryRandom = Math.random, maxFraction = 0.2): number {
  const sample = Math.min(1, Math.max(0, random()));
  return Math.round(baseDelayMs * (1 + sample * maxFraction));
}

export type BreakerState = "closed" | "open" | "half_open";
export interface CircuitPermit { allowed: boolean; state: BreakerState; probeToken?: string; retryAfterMs?: number }
export interface CircuitOptions { threshold?: number; cooldownMs?: number; now?: Date }

const DEFAULT_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60_000;
let schemaPromise: Promise<void> | null = null;

export async function ensureProviderCircuitSchema(db: Pick<Pool, "query"> = pool): Promise<void> {
  if (db === pool && isRequiredFeatureSchemaReady()) return;
  if (db === pool && schemaPromise) return schemaPromise;
  const initialize = () => db.query(`CREATE TABLE IF NOT EXISTS provider_circuit_breakers (
    dependency_key TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed','open','half_open')),
    failure_count INTEGER NOT NULL DEFAULT 0,
    opened_at TIMESTAMPTZ,
    probe_token TEXT,
    probe_expires_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).then(() => undefined);
  if (db === pool) {
    schemaPromise = initialize().catch(error => { schemaPromise = null; throw error; });
    return schemaPromise;
  }
  return initialize();
}

async function transaction<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function acquireCircuitPermit(
  dependencyKey: string, db: Pool = pool, options: CircuitOptions = {},
): Promise<CircuitPermit> {
  await ensureProviderCircuitSchema(db);
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = options.now ?? new Date();
  return transaction(db, async client => {
    await client.query(`INSERT INTO provider_circuit_breakers(dependency_key) VALUES($1) ON CONFLICT DO NOTHING`, [dependencyKey]);
    const result = await client.query(`SELECT * FROM provider_circuit_breakers WHERE dependency_key=$1 FOR UPDATE`, [dependencyKey]);
    const row = result.rows[0];
    if (row.state === "closed") return { allowed: true, state: "closed" };
    const openedAt = row.opened_at ? new Date(row.opened_at).getTime() : now.getTime();
    const retryAfterMs = Math.max(0, cooldownMs - (now.getTime() - openedAt));
    if (row.state === "open" && retryAfterMs > 0) return { allowed: false, state: "open", retryAfterMs };
    if (row.state === "half_open" && row.probe_expires_at && new Date(row.probe_expires_at) > now) {
      return { allowed: false, state: "half_open", retryAfterMs: cooldownMs };
    }
    const probeToken = crypto.randomUUID();
    await client.query(`UPDATE provider_circuit_breakers SET state='half_open',probe_token=$2,
      probe_expires_at=$3,updated_at=$4 WHERE dependency_key=$1`,
      [dependencyKey, probeToken, new Date(now.getTime() + cooldownMs), now]);
    return { allowed: true, state: "half_open", probeToken };
  });
}

export function isBreakerWorthyFailure(error: unknown): boolean {
  const status = Number((error as any)?.status ?? (error as any)?.statusCode ?? 0);
  if (status === 408 || status === 429 || status >= 500) return true;
  if (status >= 400) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|econn|connection|network|socket|rate.?limit|temporar|unavailable|provider.*5\d\d/i.test(message);
}

export async function recordCircuitFailure(
  dependencyKey: string, error: unknown, permit: CircuitPermit, db: Pool = pool, options: CircuitOptions = {},
): Promise<void> {
  if (!isBreakerWorthyFailure(error)) return;
  await ensureProviderCircuitSchema(db);
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const now = options.now ?? new Date();
  await transaction(db, async client => {
    const result = await client.query(`SELECT * FROM provider_circuit_breakers WHERE dependency_key=$1 FOR UPDATE`, [dependencyKey]);
    const row = result.rows[0];
    if (!row) return;
    if (permit.state === "half_open" && row.probe_token === permit.probeToken) {
      await client.query(`UPDATE provider_circuit_breakers SET state='open',opened_at=$2,probe_token=NULL,
        probe_expires_at=NULL,failure_count=failure_count+1,last_failure_at=$2,updated_at=$2 WHERE dependency_key=$1`, [dependencyKey, now]);
      return;
    }
    const failures = Number(row.failure_count) + 1;
    await client.query(`UPDATE provider_circuit_breakers SET failure_count=$2::integer,last_failure_at=$3::timestamptz,
      state=CASE WHEN $2::integer >= $4::integer THEN 'open' ELSE state END,
      opened_at=CASE WHEN $2::integer >= $4::integer THEN $3::timestamptz ELSE opened_at END,
      updated_at=$3::timestamptz WHERE dependency_key=$1`,
      [dependencyKey, failures, now, threshold]);
  });
}

export async function recordCircuitSuccess(
  dependencyKey: string, permit: CircuitPermit, db: Pool = pool,
): Promise<void> {
  await db.query(`UPDATE provider_circuit_breakers SET state='closed',failure_count=0,opened_at=NULL,
    probe_token=NULL,probe_expires_at=NULL,updated_at=NOW() WHERE dependency_key=$1 AND probe_token=$2`,
    [dependencyKey, permit.state === "half_open" ? permit.probeToken : null]);
  if (permit.state === "closed") {
    await db.query(`UPDATE provider_circuit_breakers SET failure_count=0,updated_at=NOW()
      WHERE dependency_key=$1 AND state='closed'`, [dependencyKey]);
  }
}

export class CircuitOpenError extends Error {
  constructor(public dependencyKey: string, public retryAfterMs: number) {
    super(`CIRCUIT_OPEN:${dependencyKey}:${retryAfterMs}`);
    this.name = "CircuitOpenError";
  }
}

export async function executeWithCircuitBreaker<T>(
  dependencyKey: string, execute: () => Promise<T>, db: Pool = pool, options: CircuitOptions = {},
): Promise<T> {
  const permit = await acquireCircuitPermit(dependencyKey, db, options);
  if (!permit.allowed) throw new CircuitOpenError(dependencyKey, permit.retryAfterMs ?? DEFAULT_COOLDOWN_MS);
  try { const result = await execute(); await recordCircuitSuccess(dependencyKey, permit, db); return result; }
  catch (error) { await recordCircuitFailure(dependencyKey, error, permit, db, options); throw error; }
}
