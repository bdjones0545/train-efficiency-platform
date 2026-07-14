-- ============================================================================
-- Kevin Slack Executive Operations Hub — Migration 0002
-- Created: 2026-07-14
--
-- WHAT THIS MIGRATION DOES
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates (or reconciles) all seven Kevin Slack tables:
--   1. kevin_slack_identity_mappings      (Slack↔TE user links)
--   2. kevin_slack_conversation_state     (multi-step command flows)
--   3. kevin_slack_event_dedup            (replay prevention)
--   4. kevin_slack_action_audit           (append-only audit log)
--   5. kevin_slack_digest_runs            (daily-digest idempotency)
--   6. kevin_slack_notification_log       (dedup for notifications)
--   7. kevin_slack_action_tokens          (durable, hashed, single-use
--                                          confirmation tokens — replaces
--                                          the in-memory Map)
--
-- SAFETY CONTRACT
-- ─────────────────────────────────────────────────────────────────────────────
-- • Every statement is idempotent:
--     CREATE TABLE     → IF NOT EXISTS
--     CREATE INDEX     → IF NOT EXISTS
--     ALTER TABLE      → ADD COLUMN IF NOT EXISTS
-- • No DROP, TRUNCATE, or ALTER … DROP COLUMN.
-- • Safe on a completely empty database.
-- • Safe on a database where the bootstrap path already created tables 1–6
--   (the original bootstrapKevinSlackTables() lazy-create path).
-- • No existing rows are modified.
--
-- ROLLBACK DOCUMENTATION (manual, not executed here)
-- ─────────────────────────────────────────────────────────────────────────────
-- To undo on a development/staging database:
--   DROP TABLE IF EXISTS kevin_slack_action_tokens     CASCADE;
--   DROP TABLE IF EXISTS kevin_slack_notification_log  CASCADE;
--   DROP TABLE IF EXISTS kevin_slack_digest_runs        CASCADE;
--   DROP TABLE IF EXISTS kevin_slack_action_audit       CASCADE;
--   DROP TABLE IF EXISTS kevin_slack_event_dedup        CASCADE;
--   DROP TABLE IF EXISTS kevin_slack_conversation_state CASCADE;
--   DROP TABLE IF EXISTS kevin_slack_identity_mappings  CASCADE;
-- DO NOT run this against production without confirming no open previews exist.
-- ============================================================================

-- ── 1. kevin_slack_identity_mappings ─────────────────────────────────────────
-- Bidirectional Slack ↔ TrainEfficiency user identity link.
-- One row per (slack_team_id, slack_user_id) pair.
-- mapping_status: pending → verified → revoked / disabled
CREATE TABLE IF NOT EXISTS kevin_slack_identity_mappings (
  id                      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slack_team_id           TEXT        NOT NULL,
  slack_enterprise_id     TEXT,
  slack_user_id           TEXT        NOT NULL,
  trainefficiency_user_id TEXT        NOT NULL,
  org_id                  TEXT        NOT NULL,
  mapping_status          TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (mapping_status IN ('pending','verified','revoked','disabled')),
  linked_by               TEXT,
  linked_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at              TIMESTAMPTZ,
  last_verified_at        TIMESTAMPTZ,
  UNIQUE (slack_team_id, slack_user_id)
);

-- Lookup by Slack workspace + user (primary resolution path)
CREATE INDEX IF NOT EXISTS idx_slack_identity_team_user
  ON kevin_slack_identity_mappings (slack_team_id, slack_user_id);

-- Lookup by TE user ID (reverse resolution)
CREATE INDEX IF NOT EXISTS idx_slack_identity_te_user
  ON kevin_slack_identity_mappings (trainefficiency_user_id);

-- Org-scoped listing for admin UI
CREATE INDEX IF NOT EXISTS idx_slack_identity_org
  ON kevin_slack_identity_mappings (org_id, mapping_status);

-- Reconcile columns added after original bootstrap
ALTER TABLE kevin_slack_identity_mappings
  ADD COLUMN IF NOT EXISTS slack_enterprise_id TEXT;

ALTER TABLE kevin_slack_identity_mappings
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE kevin_slack_identity_mappings
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

ALTER TABLE kevin_slack_identity_mappings
  ADD COLUMN IF NOT EXISTS linked_by TEXT;


-- ── 2. kevin_slack_conversation_state ────────────────────────────────────────
-- Active multi-step command conversations (e.g. "/kevin schedule" wizard).
-- One active conversation per (team, channel, user, thread).
-- step: collecting → confirming → executing → complete / cancelled / error
CREATE TABLE IF NOT EXISTS kevin_slack_conversation_state (
  conversation_id TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slack_team_id   TEXT        NOT NULL,
  slack_channel_id TEXT       NOT NULL,
  slack_thread_ts  TEXT,
  slack_user_id   TEXT        NOT NULL,
  org_id          TEXT,
  intent          TEXT        NOT NULL DEFAULT 'unknown',
  step            TEXT        NOT NULL DEFAULT 'collecting'
                  CHECK (step IN ('collecting','confirming','executing','complete','cancelled','error')),
  collected_fields JSONB      NOT NULL DEFAULT '{}',
  expires_at      TIMESTAMPTZ NOT NULL,
  trace_id        TEXT        NOT NULL,
  last_event_id   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slack_team_id, slack_channel_id, slack_user_id, slack_thread_ts)
);

-- Active conversation lookup
CREATE INDEX IF NOT EXISTS idx_slack_conv_team_user
  ON kevin_slack_conversation_state (slack_team_id, slack_user_id);

-- Expiry sweep
CREATE INDEX IF NOT EXISTS idx_slack_conv_expires
  ON kevin_slack_conversation_state (expires_at)
  WHERE step NOT IN ('complete','cancelled','error');

-- Reconcile nullable org_id (bootstrap had it NOT NULL)
ALTER TABLE kevin_slack_conversation_state
  ADD COLUMN IF NOT EXISTS org_id TEXT;

ALTER TABLE kevin_slack_conversation_state
  ADD COLUMN IF NOT EXISTS last_event_id TEXT;


-- ── 3. kevin_slack_event_dedup ────────────────────────────────────────────────
-- Replay prevention for Slack event_callback deliveries.
-- Keyed by (event_id, team_id) — must scope by team_id to prevent cross-workspace
-- false-positive deduplication.
-- Records auto-expire after 1 hour via expires_at; a periodic cron deletes them.
CREATE TABLE IF NOT EXISTS kevin_slack_event_dedup (
  event_id    TEXT        NOT NULL,
  team_id     TEXT        NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  PRIMARY KEY (event_id, team_id)
);

-- Expiry sweep index
CREATE INDEX IF NOT EXISTS idx_slack_event_dedup_expires
  ON kevin_slack_event_dedup (expires_at);

-- Reconcile: original bootstrap used TEXT PRIMARY KEY (event_id only).
-- We cannot ALTER the primary key idempotently, so we create the composite-PK
-- version above (IF NOT EXISTS). If the old single-key version exists it remains
-- valid and is reconciled by adding the team_id column.
ALTER TABLE kevin_slack_event_dedup
  ADD COLUMN IF NOT EXISTS team_id TEXT NOT NULL DEFAULT '';


-- ── 4. kevin_slack_action_audit ───────────────────────────────────────────────
-- Append-only audit log for every Slack command and action handled by Kevin.
-- Never updated after insert; retention window managed by cleanup cron (90 days).
CREATE TABLE IF NOT EXISTS kevin_slack_action_audit (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slack_team_id        TEXT        NOT NULL,
  slack_user_id        TEXT        NOT NULL,
  trainefficiency_user_id TEXT,
  org_id               TEXT,
  intent               TEXT        NOT NULL DEFAULT 'unknown',
  requested_operation  TEXT        NOT NULL,
  authorization_result TEXT        NOT NULL DEFAULT 'not_resolved'
                       CHECK (authorization_result IN ('allowed','denied','not_resolved')),
  confirmation_result  TEXT        NOT NULL DEFAULT 'pending'
                       CHECK (confirmation_result IN ('confirmed','declined','not_required','pending','timeout')),
  execution_result     TEXT        NOT NULL DEFAULT 'pending'
                       CHECK (execution_result IN ('success','failure','pending','skipped')),
  outcome              TEXT        NOT NULL DEFAULT 'ignored',
  trace_id             TEXT        NOT NULL,
  error_message        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by team+user with time ordering
CREATE INDEX IF NOT EXISTS idx_slack_audit_team_user
  ON kevin_slack_action_audit (slack_team_id, slack_user_id, created_at DESC);

-- Org-scoped audit (admin UI)
CREATE INDEX IF NOT EXISTS idx_slack_audit_org
  ON kevin_slack_action_audit (org_id, created_at DESC)
  WHERE org_id IS NOT NULL;

-- Trace lookup
CREATE INDEX IF NOT EXISTS idx_slack_audit_trace
  ON kevin_slack_action_audit (trace_id);

-- Reconcile authorization_result check constraint columns that may be missing
ALTER TABLE kevin_slack_action_audit
  ADD COLUMN IF NOT EXISTS trainefficiency_user_id TEXT;

ALTER TABLE kevin_slack_action_audit
  ADD COLUMN IF NOT EXISTS error_message TEXT;


-- ── 5. kevin_slack_digest_runs ────────────────────────────────────────────────
-- Idempotency guard for daily executive digests.
-- (org_id, digest_type, period_key) is unique — prevents double-send on retry.
-- status: pending → sent / failed
CREATE TABLE IF NOT EXISTS kevin_slack_digest_runs (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id      TEXT        NOT NULL,
  digest_type TEXT        NOT NULL,
  period_key  TEXT        NOT NULL,
  channel     TEXT        NOT NULL,
  sent_at     TIMESTAMPTZ,
  status      TEXT        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','sent','failed','skipped')),
  error_msg   TEXT,
  UNIQUE (org_id, digest_type, period_key)
);

-- Lookup pending digests for retry
CREATE INDEX IF NOT EXISTS idx_slack_digest_status
  ON kevin_slack_digest_runs (status, period_key);

-- Reconcile
ALTER TABLE kevin_slack_digest_runs
  ADD COLUMN IF NOT EXISTS error_msg TEXT;

ALTER TABLE kevin_slack_digest_runs
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;


-- ── 6. kevin_slack_notification_log ──────────────────────────────────────────
-- Records every notification sent via Slack.
-- dedup_key prevents duplicate alerts for the same open event.
-- Retention: 90 days (managed by cleanup cron).
CREATE TABLE IF NOT EXISTS kevin_slack_notification_log (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          TEXT,
  slack_team_id   TEXT        NOT NULL,
  channel         TEXT        NOT NULL,
  priority        TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  dedup_key       TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_status TEXT        NOT NULL DEFAULT 'sent'
                  CHECK (delivery_status IN ('sent','failed','suppressed')),
  error_message   TEXT
);

-- Dedup lookup (suppression check)
CREATE INDEX IF NOT EXISTS idx_slack_notif_dedup
  ON kevin_slack_notification_log (dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Org + time listing for admin UI
CREATE INDEX IF NOT EXISTS idx_slack_notif_org_time
  ON kevin_slack_notification_log (org_id, sent_at DESC)
  WHERE org_id IS NOT NULL;

-- Reconcile
ALTER TABLE kevin_slack_notification_log
  ADD COLUMN IF NOT EXISTS error_message TEXT;


-- ── 7. kevin_slack_action_tokens ─────────────────────────────────────────────
-- Durable, database-backed, hashed, single-use Slack action confirmation tokens.
-- Replaces the in-memory Map from scheduling-handler.ts.
--
-- Security model:
--   • 32 bytes of random entropy generated per token
--   • Only HMAC-SHA256(raw_token, SLACK_SIGNING_SECRET) stored in token_hash
--   • Raw token exists only: in creation return value, in the Slack button value,
--     and in the incoming action request
--   • Atomic single-use enforced by:
--       UPDATE … SET status='processing' WHERE status='pending' AND expires_at > NOW()
--       AND org_id=? AND slack_team_id=? AND slack_user_id=? RETURNING *
--
-- Isolation guarantees (enforced at claim time):
--   • org_id must match the acting user's org
--   • slack_team_id must match the workspace the action came from
--   • slack_user_id must match the user who clicked the button
--   • trainefficiency_user_id must match the TE identity
--
-- Lifecycle:
--   pending → processing → consumed   (normal confirm path)
--                        ↓
--                      failed         (business action failed)
--   pending → canceled                (user clicked Abort)
--   pending → expired                 (cleanup cron after expires_at)
--
-- Retention: records kept for 30 days after terminal state for audit.
-- action_payload must not contain secrets, credentials, or raw org/role claims.
CREATE TABLE IF NOT EXISTS kevin_slack_action_tokens (
  id                      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  token_hash              TEXT        NOT NULL,   -- HMAC-SHA256 of raw token; UNIQUE
  org_id                  TEXT        NOT NULL,
  slack_team_id           TEXT        NOT NULL,
  slack_enterprise_id     TEXT,
  slack_user_id           TEXT        NOT NULL,
  trainefficiency_user_id TEXT        NOT NULL,
  action_type             TEXT        NOT NULL
                          CHECK (action_type IN (
                            'create_session','reschedule_session','cancel_session',
                            'acknowledge_alert','dismiss_action'
                          )),
  action_payload          JSONB       NOT NULL DEFAULT '{}',
  idempotency_key         TEXT,                  -- e.g. slack:create_session:{id}
  status                  TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processing','consumed','expired','failed','canceled')),
  expires_at              TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_at           TIMESTAMPTZ,
  consumed_at             TIMESTAMPTZ,
  failed_at               TIMESTAMPTZ,
  canceled_at             TIMESTAMPTZ,
  last_error              TEXT,
  trace_id                TEXT        NOT NULL DEFAULT '',
  request_id              TEXT,                  -- Slack retry-num, for dedup
  source_channel_id       TEXT,
  source_message_ts       TEXT,
  UNIQUE (token_hash)
);

-- Primary token lookup path (hash → row)
CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_tokens_hash
  ON kevin_slack_action_tokens (token_hash);

-- Expiry sweep — only scan pending rows
CREATE INDEX IF NOT EXISTS idx_slack_tokens_pending_expires
  ON kevin_slack_action_tokens (expires_at)
  WHERE status = 'pending';

-- Org isolation listing (admin diagnostics)
CREATE INDEX IF NOT EXISTS idx_slack_tokens_org
  ON kevin_slack_action_tokens (org_id, created_at DESC);

-- Team + user lookup (isolation verification)
CREATE INDEX IF NOT EXISTS idx_slack_tokens_team_user
  ON kevin_slack_action_tokens (slack_team_id, slack_user_id, created_at DESC);

-- Trace lookup (audit correlation)
CREATE INDEX IF NOT EXISTS idx_slack_tokens_trace
  ON kevin_slack_action_tokens (trace_id)
  WHERE trace_id <> '';

-- Idempotency key lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_tokens_idem
  ON kevin_slack_action_tokens (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- End of migration 0002
-- ============================================================================
