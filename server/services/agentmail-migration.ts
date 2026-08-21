/**
 * AgentMail Schema Migration
 *
 * Single authoritative, deterministic, idempotent, ordered migration for all
 * AgentMail feature tables.  Must complete before the webhook handler accepts
 * any traffic (readiness gate enforced in agentmail-routes.ts).
 *
 * Ordering:
 *   1. agent_mail_inbound_messages  (includes all columns; ownership ALTERs run later)
 *   2. org_agentmail_inboxes        (with CHECK constraints + UNIQUE provider_inbox_id)
 *   3. agent_mail_messages          (outbound audit log)
 *
 * Each step is safe to run against an existing database — CREATE IF NOT EXISTS
 * and ADD COLUMN IF NOT EXISTS handle the upgrade path from any prior state.
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
 * Run the migration once per process.  Concurrent callers await the same
 * in-flight promise.  Application startup and the webhook handler both call
 * this; the second call is a no-op.
 */
export async function runAgentMailMigration(): Promise<void> {
  if (_ready) return;
  if (_inFlight) return _inFlight;
  _inFlight = _migrate()
    .then(() => { _ready = true; })
    .finally(() => { _inFlight = null; });
  return _inFlight;
}

// ─── Migration steps ─────────────────────────────────────────────────────────

async function exec(statement: string): Promise<void> {
  await db.execute(sql.raw(statement)).catch(() => {});
}

async function _migrate(): Promise<void> {
  // ── Step 1: Inbound messages table ─────────────────────────────────────────
  // Include ALL columns in the initial CREATE so ALTER lines below become
  // true no-ops on fresh databases and safe upgrades on existing ones.
  await db.execute(sql`
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
      provider_event_id     TEXT,                           -- webhook event_id envelope
      classification        TEXT,
      confidence            DOUBLE PRECISION DEFAULT 0,
      routed_agent          TEXT,
      routed_status         TEXT        NOT NULL DEFAULT 'received',
      routing_status        TEXT        NOT NULL DEFAULT 'routed', -- 'routed' | 'quarantine'
      routing_reason        TEXT,
      routed_at             TIMESTAMPTZ,
      processing_state      TEXT        NOT NULL DEFAULT 'received',
                                                            -- 'received'|'processing'|'completed'|'failed'
      processing_started_at TIMESTAMPTZ,
      processing_attempts   INT         NOT NULL DEFAULT 0,
      last_error            TEXT,
      action_type           TEXT,
      action_payload        JSONB,
      error_message         TEXT,
      received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Upgrade columns on pre-existing tables (all no-ops on fresh schema)
  await exec(`ALTER TABLE agent_mail_inbound_messages ALTER COLUMN organization_id DROP NOT NULL`);
  for (const col of [
    `ADD COLUMN IF NOT EXISTS routing_status       TEXT NOT NULL DEFAULT 'routed'`,
    `ADD COLUMN IF NOT EXISTS routing_reason        TEXT`,
    `ADD COLUMN IF NOT EXISTS routed_at             TIMESTAMPTZ`,
    `ADD COLUMN IF NOT EXISTS provider_inbox_id     TEXT`,
    `ADD COLUMN IF NOT EXISTS provider_event_id     TEXT`,
    `ADD COLUMN IF NOT EXISTS processing_state      TEXT NOT NULL DEFAULT 'received'`,
    `ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ`,
    `ADD COLUMN IF NOT EXISTS processing_attempts   INT NOT NULL DEFAULT 0`,
    `ADD COLUMN IF NOT EXISTS last_error            TEXT`,
    `ADD COLUMN IF NOT EXISTS raw_payload           JSONB`,
  ]) {
    await exec(`ALTER TABLE agent_mail_inbound_messages ${col}`);
  }

  for (const idx of [
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_org
       ON agent_mail_inbound_messages (organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_inbox
       ON agent_mail_inbound_messages (inbox)`,
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_routing
       ON agent_mail_inbound_messages (routing_status)`,
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_processing
       ON agent_mail_inbound_messages (processing_state, processing_started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_provider_inbox
       ON agent_mail_inbound_messages (provider_inbox_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_rcvd
       ON agent_mail_inbound_messages (received_at DESC)`,
  ]) {
    await exec(idx);
  }

  // ── Step 2: Ownership table ─────────────────────────────────────────────────
  // Defines the authoritative org ↔ inbox mapping.
  // CHECK constraints on role and ownership_state prevent invalid data at the DB level.
  await db.execute(sql`
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

  // Partial UNIQUE index on provider_inbox_id — NULLs are excluded so
  // multiple un-provisioned rows can co-exist while activated rows are unique.
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uix_org_agentmail_provider_inbox_id
    ON org_agentmail_inboxes (provider_inbox_id)
    WHERE provider_inbox_id IS NOT NULL
  `);

  // Best-effort CHECK constraints on existing tables (no-op if already present)
  await exec(`
    ALTER TABLE org_agentmail_inboxes
    ADD CONSTRAINT chk_org_agentmail_role
    CHECK (role IN ('revenue','hiring','scheduling','support','operations','ceo'))
  `);
  await exec(`
    ALTER TABLE org_agentmail_inboxes
    ADD CONSTRAINT chk_org_agentmail_state
    CHECK (ownership_state IN ('provisioning','active','disabled','retired'))
  `);

  for (const idx of [
    `CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_org
       ON org_agentmail_inboxes (organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_email
       ON org_agentmail_inboxes (email_address)`,
    `CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_state
       ON org_agentmail_inboxes (ownership_state)`,
  ]) {
    await exec(idx);
  }

  // ── Step 3: Outbound audit log ──────────────────────────────────────────────
  await db.execute(sql`
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
  ]) {
    await exec(idx);
  }

  // ── Step 4: automation_settings never_auto_send column (schema drift guard) ─
  await exec(`
    ALTER TABLE org_automation_settings
    ADD COLUMN IF NOT EXISTS never_auto_send BOOLEAN NOT NULL DEFAULT TRUE
  `);
}
