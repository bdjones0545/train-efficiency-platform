/**
 * AgentMail Schema Migration
 *
 * Single authoritative, deterministic, ordered, process-safe migration for all
 * AgentMail feature tables. Must complete before the webhook handler accepts
 * any traffic (readiness gate enforced in agentmail-routes.ts).
 *
 * Process safety:
 *   pg_advisory_xact_lock is acquired through the SAME transaction that runs
 *   all DDL.  Every statement — CREATE TABLE, ALTER TABLE, CREATE INDEX — is
 *   executed through the transaction connection (tx), never through the global
 *   pool (db).  This is critical: the global pool cannot see tables created
 *   but not yet committed inside the transaction (relation "X" does not exist).
 *
 * Error handling:
 *   DDL failures propagate and keep _ready = false EXCEPT:
 *   - 42710 (duplicate_object): ADD CONSTRAINT already exists — safe to ignore.
 *   - 42701 (duplicate_column): ADD COLUMN already exists — safe to ignore.
 *   - 0A000 (feature_not_supported): ALTER COLUMN DROP NOT NULL on already-nullable.
 *   - 42703 (undefined_column): DROP NOT NULL on missing column — safe.
 *
 * Ordering:
 *   1. agent_mail_inbound_messages  (must exist before ownership FKs or triggers)
 *   2. org_agentmail_inboxes        (UNIQUE constraints + partial index)
 *   3. agent_mail_messages          (outbound audit log)
 *   4. agentmail_effect_log         (downstream idempotency ledger — pending→completed state)
 *   5. agentmail_svix_deliveries    (replay protection ledger keyed by svix-id)
 *   6. automation_settings drift guard
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Readiness gate ──────────────────────────────────────────────────────────

let _ready = false;
let _inFlight: Promise<void> | null = null;

/** True only after runAgentMailMigration() has completed successfully. */
export function isAgentMailSchemaReady(): boolean {
  return _ready;
}

/**
 * Run the migration once per process.  Concurrent callers within the same
 * process share the same in-flight promise.  Cross-process safety is handled
 * by pg_advisory_xact_lock inside a transaction.
 *
 * Throws if migration fails — callers must handle the rejection and keep the
 * webhook handler in a degraded (503) state.
 */
export async function runAgentMailMigration(): Promise<void> {
  if (_ready) return;
  if (_inFlight) return _inFlight;

  _inFlight = _migrate()
    .then(() => {
      _ready = true;
    })
    .catch((err) => {
      // Migration failure: _ready stays false so the webhook returns 503.
      console.error(
        "[AgentMail] CRITICAL: Schema migration failed. " +
        "AgentMail webhook unavailable until fixed and server restarted.",
        err?.message ?? String(err),
      );
      throw err; // Propagate so registerAgentMailRoutes() can log the startup error.
    })
    .finally(() => {
      _inFlight = null;
    });

  return _inFlight;
}

// ─── DDL execution helper ─────────────────────────────────────────────────────

// PostgreSQL error codes that are safe to ignore in idempotent DDL:
const BENIGN_DDL_CODES = new Set([
  "42710", // duplicate_object   — constraint/index already exists (ADD CONSTRAINT)
  "42701", // duplicate_column   — column already exists (ADD COLUMN, belt-and-suspenders)
  "0A000", // feature_not_supported — ALTER COLUMN DROP NOT NULL on already-nullable
  "42703", // undefined_column   — DROP NOT NULL on column that doesn't exist
]);

/**
 * Execute a single DDL statement through the provided executor.
 *
 * INVARIANT: executor MUST be the transaction (tx) that holds the advisory
 * lock — NEVER the global db/pool.  The global connection cannot see tables
 * created but not yet committed inside the transaction.
 *
 * CRITICAL: In PostgreSQL, ANY error inside a transaction immediately marks
 * the transaction as ABORTED.  All subsequent commands in the same transaction
 * fail with `25P02` — even if the application catches and swallows the error.
 *
 * Solution: wrap each DDL statement in a SAVEPOINT / ROLLBACK TO SAVEPOINT.
 * This pattern creates a nested "sub-transaction".  On failure:
 *   1. ROLLBACK TO SAVEPOINT restores the transaction to its pre-error state
 *      (un-aborts it), so subsequent DDL statements can proceed.
 *   2. RELEASE SAVEPOINT discards the savepoint.
 *   3. The benign error is swallowed — the outer transaction remains healthy.
 *
 * On success:
 *   1. RELEASE SAVEPOINT discards the savepoint (commits the nested work).
 *
 * This is the ONLY correct way to handle "IF NOT EXISTS" semantics inside a
 * transaction when the DDL may fail with idempotency-class errors.
 */
let _spSeq = 0;
async function execDDL(executor: any, statement: string): Promise<void> {
  // Generate a unique savepoint name for this invocation.
  // Names must be SQL identifiers (alphanumeric + underscore, no hyphens).
  const sp = `sp_agentmail_${Date.now()}_${(_spSeq++) % 10000}`;

  // ── Create the savepoint BEFORE the DDL ──────────────────────────────────
  await executor.execute(sql.raw(`SAVEPOINT ${sp}`));

  try {
    await executor.execute(sql.raw(statement));
    // DDL succeeded — release the savepoint (confirms the nested work).
    await executor.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
  } catch (err: any) {
    // ── DDL failed — ROLLBACK TO SAVEPOINT first ─────────────────────────
    // This is mandatory: it un-aborts the outer transaction.
    // Without this, every subsequent SQL in the transaction would fail
    // with `25P02 current transaction is aborted`.
    try {
      await executor.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
      await executor.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
    } catch {
      // If ROLLBACK itself fails, the transaction is unrecoverable.
      // Re-throw the original error (not the rollback error).
    }

    const code: string = err?.code ?? err?.cause?.code ?? "";
    if (BENIGN_DDL_CODES.has(code)) {
      // Known idempotency class — safe to skip (e.g. constraint already exists).
      return;
    }
    // Unknown DDL error — propagate to fail the migration.
    throw err;
  }
}

// ─── Process-safe migration entry point ───────────────────────────────────────

// Deterministic advisory lock key for AgentMail migration.
// Must be a 64-bit integer constant that no other subsystem uses.
const ADVISORY_LOCK_KEY = BigInt("8675309999001");

async function _migrate(): Promise<void> {
  // ── Cross-process advisory lock ────────────────────────────────────────────
  // pg_advisory_xact_lock is *transaction-scoped*: it is held for the duration
  // of the enclosing transaction and released automatically at COMMIT/ROLLBACK.
  // This works correctly with connection pools because the lock is tied to the
  // single connection that runs the transaction, not to the pool session.
  //
  // Two processes racing on startup: one blocks at pg_advisory_xact_lock until
  // the other commits; then it re-runs all IF NOT EXISTS DDL (idempotent no-ops)
  // and also commits cleanly.
  //
  // CRITICAL: _runDDL(tx) receives the transaction object and must pass it to
  // execDDL() for every statement.  Using the global db inside _runDDL would
  // read from a different pool connection that cannot see uncommitted tables.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY}::bigint)`);
    await _runDDL(tx);
  });
}

// ─── All DDL steps ────────────────────────────────────────────────────────────

async function _runDDL(tx: any): Promise<void> {
  // ── Step 1: Inbound messages ──────────────────────────────────────────────
  await tx.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_mail_inbound_messages (
      id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id       TEXT,                           -- NULL for quarantined messages
      inbox                 TEXT        NOT NULL,
      from_email            TEXT        NOT NULL,
      from_name             TEXT,
      to_email              TEXT        NOT NULL,
      subject               TEXT        NOT NULL,
      body_text             TEXT,
      body_html             TEXT,
      provider_message_id   TEXT        UNIQUE,             -- SMTP Message-ID for dedup
      provider_inbox_id     TEXT,                           -- authoritative inbox identity
      provider_thread_id    TEXT,
      provider_event_id     TEXT,
      classification        TEXT,
      confidence            DOUBLE PRECISION DEFAULT 0,
      routed_agent          TEXT,
      routed_status         TEXT        NOT NULL DEFAULT 'received',
      routing_status        TEXT        NOT NULL DEFAULT 'routed',
      routing_reason        TEXT,
      routed_at             TIMESTAMPTZ,
      processing_state      TEXT        NOT NULL DEFAULT 'received',
      processing_started_at TIMESTAMPTZ,
      processing_attempts   INT         NOT NULL DEFAULT 0,
      last_error            TEXT,
      action_type           TEXT,
      action_payload        JSONB,
      raw_payload           JSONB,
      error_message         TEXT,
      received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Upgrade columns on pre-existing tables — benign codes are swallowed.
  // ALL execDDL calls pass tx (not db) so they stay on the locked connection.
  const inboundAlters = [
    `ALTER TABLE agent_mail_inbound_messages ALTER COLUMN organization_id DROP NOT NULL`,
    `ALTER TABLE agent_mail_inbound_messages ADD COLUMN IF NOT EXISTS routing_status       TEXT NOT NULL DEFAULT 'routed'`,
    `ALTER TABLE agent_mail_inbound_messages ADD COLUMN IF NOT EXISTS routing_reason        TEXT`,
    `ALTER TABLE agent_mail_inbound_messages ADD COLUMN IF NOT EXISTS routed_at             TIMESTAMPTZ`,
    `ALTER TABLE agent_mail_inbound_messages ADD COLUMN IF NOT EXISTS provider_inbox_id     TEXT`,
    `ALTER TABLE agent_mail_inbound_messages ADD COLUMN IF NOT EXISTS provider_event_id     TEXT`,
    `ALTER TABLE agent_mail_inbound_messages ADD COLUMN IF NOT EXISTS processing_state      TEXT NOT NULL DEFAULT 'received'`,
    `ALTER TABLE agent_mail_inbound_messages ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ`,
    `ALTER TABLE agent_mail_inbound_messages ADD COLUMN IF NOT EXISTS processing_attempts   INT NOT NULL DEFAULT 0`,
    `ALTER TABLE agent_mail_inbound_messages ADD COLUMN IF NOT EXISTS last_error            TEXT`,
    `ALTER TABLE agent_mail_inbound_messages ADD COLUMN IF NOT EXISTS raw_payload           JSONB`,
  ];
  for (const stmt of inboundAlters) await execDDL(tx, stmt);

  const inboundIndexes = [
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_org       ON agent_mail_inbound_messages (organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_inbox     ON agent_mail_inbound_messages (inbox)`,
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_routing   ON agent_mail_inbound_messages (routing_status)`,
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_processing ON agent_mail_inbound_messages (processing_state, processing_started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_provider_inbox ON agent_mail_inbound_messages (provider_inbox_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_rcvd      ON agent_mail_inbound_messages (received_at DESC)`,
  ];
  for (const idx of inboundIndexes) await execDDL(tx, idx);

  // ── Step 2: Ownership table ────────────────────────────────────────────────
  await tx.execute(sql`
    CREATE TABLE IF NOT EXISTS org_agentmail_inboxes (
      id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id   TEXT        NOT NULL,
      role              TEXT        NOT NULL
                                    CHECK (role IN ('revenue','hiring','scheduling','support','operations','ceo')),
      username          TEXT        NOT NULL,
      email_address     TEXT        NOT NULL,
      provider_inbox_id TEXT,
      provider_domain   TEXT,
      ownership_state   TEXT        NOT NULL DEFAULT 'provisioning'
                                    CHECK (ownership_state IN ('provisioning','active','disabled','retired')),
      provisioned_at    TIMESTAMPTZ,
      activated_at      TIMESTAMPTZ,
      disabled_at       TIMESTAMPTZ,
      retired_at        TIMESTAMPTZ,
      disable_reason    TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, role),
      UNIQUE (email_address),
      UNIQUE (username)
    )
  `);

  // Partial UNIQUE index — NULLs are excluded so multiple un-provisioned rows coexist.
  await execDDL(tx, `
    CREATE UNIQUE INDEX IF NOT EXISTS uix_org_agentmail_provider_inbox_id
    ON org_agentmail_inboxes (provider_inbox_id)
    WHERE provider_inbox_id IS NOT NULL
  `);

  // ADD CONSTRAINT — swallows 42710 if already present from a prior run.
  await execDDL(tx, `
    ALTER TABLE org_agentmail_inboxes
    ADD CONSTRAINT chk_org_agentmail_role
    CHECK (role IN ('revenue','hiring','scheduling','support','operations','ceo'))
  `);
  await execDDL(tx, `
    ALTER TABLE org_agentmail_inboxes
    ADD CONSTRAINT chk_org_agentmail_state
    CHECK (ownership_state IN ('provisioning','active','disabled','retired'))
  `);

  const ownershipIndexes = [
    `CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_org   ON org_agentmail_inboxes (organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_email ON org_agentmail_inboxes (email_address)`,
    `CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_state ON org_agentmail_inboxes (ownership_state)`,
  ];
  for (const idx of ownershipIndexes) await execDDL(tx, idx);

  // ── Step 3: Outbound audit log ─────────────────────────────────────────────
  await tx.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_mail_messages (
      id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id     TEXT NOT NULL,
      agent_name          TEXT NOT NULL,
      inbox               TEXT NOT NULL,
      to_email            TEXT NOT NULL,
      from_email          TEXT,
      subject             TEXT NOT NULL,
      body_preview        TEXT,
      provider_message_id TEXT,
      status              TEXT NOT NULL DEFAULT 'queued',
      error_message       TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (const idx of [
    `CREATE INDEX IF NOT EXISTS idx_agent_mail_org    ON agent_mail_messages (organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_mail_inbox  ON agent_mail_messages (inbox)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_mail_status ON agent_mail_messages (status)`,
  ]) await execDDL(tx, idx);

  // ── Step 4: Effect log — downstream idempotency ledger ────────────────────
  //
  // State machine: pending → completed | failed
  //
  // pending:   claimed by a worker — business write has NOT yet happened.
  //            If worker crashes, claimed_at goes stale after 5 minutes and
  //            a retry can reclaim via ON CONFLICT DO UPDATE.
  //
  // completed: business write succeeded and was confirmed.  This state is
  //            permanent — no retry allowed.  The unique (inbound_id, effect_type)
  //            constraint enforces exactly-once delivery.
  //
  // failed:    business write failed.  Retry is allowed — the claim loop uses
  //            ON CONFLICT DO UPDATE to reclaim failed slots.
  //
  // INVARIANT: a row may only enter 'completed' AFTER the business write
  //            succeeds.  Inserting 'pending' BEFORE the write is intentional —
  //            the worker owns the slot while the write is in flight.  The
  //            'completed' transition happens AFTER the write returns.
  await tx.execute(sql`
    CREATE TABLE IF NOT EXISTS agentmail_effect_log (
      id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      inbound_id   TEXT        NOT NULL,
      effect_type  TEXT        NOT NULL,
      status       TEXT        NOT NULL DEFAULT 'pending',  -- pending | completed | failed
      claimed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,                             -- NULL until status = completed
      UNIQUE (inbound_id, effect_type)
    )
  `);

  // Upgrade existing rows from old schema (which had no status/claimed_at columns
  // and completed_at was NOT NULL DEFAULT NOW()).  Existing rows were by definition
  // already completed so default them to 'completed'.
  const effectLogAlters = [
    `ALTER TABLE agentmail_effect_log ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'`,
    `ALTER TABLE agentmail_effect_log ALTER COLUMN status SET DEFAULT 'pending'`,
    `ALTER TABLE agentmail_effect_log ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`,
    // completed_at was NOT NULL DEFAULT NOW() in the old schema.
    // First remove NOT NULL, then remove the DEFAULT so new rows get NULL
    // (completed_at should only be set when status transitions to 'completed').
    `ALTER TABLE agentmail_effect_log ALTER COLUMN completed_at DROP NOT NULL`,
    `ALTER TABLE agentmail_effect_log ALTER COLUMN completed_at DROP DEFAULT`,
  ];
  for (const stmt of effectLogAlters) await execDDL(tx, stmt);

  await execDDL(tx, `
    CREATE INDEX IF NOT EXISTS idx_agentmail_effect_inbound ON agentmail_effect_log (inbound_id)
  `);
  await execDDL(tx, `
    CREATE INDEX IF NOT EXISTS idx_agentmail_effect_status ON agentmail_effect_log (status)
  `);

  // ── Step 5: Svix delivery replay ledger ───────────────────────────────────
  //
  // Cryptographic timestamp tolerance (±5 min) prevents most replays but does
  // not prevent the EXACT same signed delivery from being processed twice within
  // the window.  This table provides a bounded deduplication ledger keyed by
  // the Svix delivery ID (svix-id header) — unique per delivery attempt.
  //
  // Retention: entries older than 10 minutes are pruned periodically (cron or
  // inline cleanup) since no valid delivery would arrive after the 5-min window.
  await tx.execute(sql`
    CREATE TABLE IF NOT EXISTS agentmail_svix_deliveries (
      svix_id     TEXT        PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await execDDL(tx, `
    CREATE INDEX IF NOT EXISTS idx_agentmail_svix_received ON agentmail_svix_deliveries (received_at DESC)
  `);

  // ── Step 6: automation_settings schema drift guard ─────────────────────────
  await execDDL(tx, `
    ALTER TABLE org_automation_settings
    ADD COLUMN IF NOT EXISTS never_auto_send BOOLEAN NOT NULL DEFAULT TRUE
  `);
}
