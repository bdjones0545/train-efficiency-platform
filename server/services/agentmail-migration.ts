/**
 * AgentMail Schema Migration
 *
 * Single authoritative, deterministic, ordered, process-safe migration for all
 * AgentMail feature tables. Must complete before the webhook handler accepts
 * any traffic (readiness gate enforced in agentmail-routes.ts).
 *
 * Process safety:
 *   pg_advisory_xact_lock is used inside a transaction so the lock is tied to a
 *   single DB connection (transaction-scoped) rather than a pool session. Two
 *   server processes racing on startup both acquire the lock in order; the second
 *   runs all IF NOT EXISTS DDL (no-ops) and commits cleanly.
 *
 * Error handling:
 *   DDL is expressed idempotently and all failures propagate, keeping _ready false.
 *
 * Ordering:
 *   1. agent_mail_inbound_messages  (must exist before ownership FKs or triggers)
 *   2. org_agentmail_inboxes        (UNIQUE constraints + partial index)
 *   3. agent_mail_messages          (outbound audit log)
 *   4. agentmail_effect_log         (downstream idempotency ledger)
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

/** Execute DDL through the transaction executor that owns the advisory lock. */
type DdlExecutor = { execute(query: any): Promise<any> };

async function execDDL(executor: DdlExecutor, statement: string): Promise<void> {
  await executor.execute(sql.raw(statement));
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
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY}::bigint)`);
    await _runDDL(tx);
  });
}

// ─── All DDL steps ────────────────────────────────────────────────────────────

async function _runDDL(tx: DdlExecutor): Promise<void> {
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

  // Upgrade columns on pre-existing tables — all safe to ignore benign codes.
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

  // Upgrade pre-existing tables without raising duplicate_object (an error,
  // even if caught in JavaScript, aborts the PostgreSQL transaction).
  await execDDL(tx, `
    DO $ddl$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_agentmail_role'
                     AND conrelid = 'org_agentmail_inboxes'::regclass) THEN
        ALTER TABLE org_agentmail_inboxes ADD CONSTRAINT chk_org_agentmail_role
        CHECK (role IN ('revenue','hiring','scheduling','support','operations','ceo'));
      END IF;
    END $ddl$
  `);
  await execDDL(tx, `
    DO $ddl$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_agentmail_state'
                     AND conrelid = 'org_agentmail_inboxes'::regclass) THEN
        ALTER TABLE org_agentmail_inboxes ADD CONSTRAINT chk_org_agentmail_state
        CHECK (ownership_state IN ('provisioning','active','disabled','retired'));
      END IF;
    END $ddl$
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
  // Each downstream side-effect triggered by an inbound message is recorded here.
  // Before executing any effect, the processor claims it via INSERT ON CONFLICT DO NOTHING.
  // If the claim fails, the effect was already completed — skip it.
  // This prevents duplicate prospect/applicant/attention records on retry after crash.
  await tx.execute(sql`
    CREATE TABLE IF NOT EXISTS agentmail_effect_log (
      id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      inbound_id   TEXT        NOT NULL,
      effect_type  TEXT        NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (inbound_id, effect_type)
    )
  `);
  await execDDL(tx, `CREATE INDEX IF NOT EXISTS idx_agentmail_effect_inbound ON agentmail_effect_log (inbound_id)`);

  await tx.execute(sql`
    CREATE TABLE IF NOT EXISTS agentmail_webhook_deliveries (
      svix_id       TEXT PRIMARY KEY,
      payload_hash  TEXT NOT NULL,
      status        TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
      claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at  TIMESTAMPTZ,
      last_error    TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await tx.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_agentmail_webhook_delivery_status
    ON agentmail_webhook_deliveries (status, claimed_at)
  `);

}
