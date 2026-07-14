-- ============================================================================
-- Kevin Integration Tables — Migration 0001
-- Created: 2026-07-14
--
-- SAFETY CONTRACT
-- ─────────────────────────────────────────────────────────────────────────────
-- • Every statement is idempotent:
--     CREATE TYPE      → guarded with DO $$ ... EXCEPTION WHEN duplicate_object
--     CREATE TABLE     → IF NOT EXISTS
--     CREATE INDEX     → IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS
--     ALTER TABLE      → guarded with IF NOT EXISTS column check (see helper below)
-- • No DROP, TRUNCATE, or ALTER … DROP COLUMN statements.
-- • Safe to run on a database that already contains all six tables
--   (the 2026-07-13 direct-SQL bootstrap path).
-- • Safe to run on a completely empty database.
--
-- ROLLBACK DOCUMENTATION (manual — not executed here)
-- ─────────────────────────────────────────────────────────────────────────────
-- To fully undo this migration on a development/staging database:
--
--   DROP TABLE IF EXISTS kevin_rate_limits   CASCADE;
--   DROP TABLE IF EXISTS kevin_outcomes      CASCADE;
--   DROP TABLE IF EXISTS kevin_context_requests CASCADE;
--   DROP TABLE IF EXISTS kevin_signals       CASCADE;
--   DROP TABLE IF EXISTS kevin_events        CASCADE;
--   DROP TABLE IF EXISTS kevin_capabilities  CASCADE;
--   DROP TABLE IF EXISTS kevin_runs          CASCADE;
--   DROP TABLE IF EXISTS kevin_sessions      CASCADE;
--   DROP TABLE IF EXISTS kevin_audit_events  CASCADE;
--   DROP TYPE IF EXISTS kevin_outcome_type;
--   DROP TYPE IF EXISTS kevin_context_status;
--   DROP TYPE IF EXISTS kevin_signal_status;
--   DROP TYPE IF EXISTS kevin_risk_class;
--   DROP TYPE IF EXISTS kevin_event_status;
--   DROP TYPE IF EXISTS kevin_approval_mode;
--
-- DO NOT run the rollback on a production database unless you are certain
-- no other tables reference these types via a foreign key or CAST.
-- ============================================================================

-- ── ENUM: kevin_approval_mode ──────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE kevin_approval_mode AS ENUM (
    'disabled',
    'observe',
    'recommend',
    'draft',
    'require_approval',
    'auto'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── ENUM: kevin_event_status ───────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE kevin_event_status AS ENUM (
    'pending',
    'processing',
    'sent',
    'failed',
    'dead_lettered'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── ENUM: kevin_risk_class ─────────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE kevin_risk_class AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── ENUM: kevin_signal_status ──────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE kevin_signal_status AS ENUM (
    'pending',
    'routed',
    'actioned',
    'dismissed',
    'duplicate',
    'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── ENUM: kevin_context_status ─────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE kevin_context_status AS ENUM (
    'success',
    'empty',
    'timeout',
    'disabled',
    'unavailable',
    'failed',
    'blocked_loop'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── ENUM: kevin_outcome_type ───────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE kevin_outcome_type AS ENUM (
    'accepted',
    'modified',
    'rejected',
    'dismissed',
    'no_action',
    'successful',
    'unsuccessful',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── TABLE: kevin_capabilities ──────────────────────────────────────────────
-- Per-org approval-mode control for each Kevin capability.
CREATE TABLE IF NOT EXISTS kevin_capabilities (
  id            TEXT        PRIMARY KEY,
  org_id        TEXT        NOT NULL,
  capability    TEXT        NOT NULL,
  approval_mode TEXT        NOT NULL DEFAULT 'observe'
                            CHECK (approval_mode IN ('disabled','observe','recommend','draft','require_approval','auto')),
  enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS kevin_capabilities_unique
  ON kevin_capabilities (org_id, capability);

CREATE INDEX IF NOT EXISTS kevin_capabilities_org
  ON kevin_capabilities (org_id);

-- ── TABLE: kevin_events ────────────────────────────────────────────────────
-- Outbound TE→Kevin event queue with retry tracking.
CREATE TABLE IF NOT EXISTS kevin_events (
  id               TEXT        PRIMARY KEY,
  org_id           TEXT        NOT NULL,
  event_type       TEXT        NOT NULL,
  entity_type      TEXT,
  entity_id        TEXT,
  payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key  TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','processing','sent','failed','dead_lettered')),
  attempts         INTEGER     NOT NULL DEFAULT 0,
  last_error       TEXT,
  next_retry_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at          TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS kevin_events_idem
  ON kevin_events (idempotency_key);

CREATE INDEX IF NOT EXISTS kevin_events_status
  ON kevin_events (status);

CREATE INDEX IF NOT EXISTS kevin_events_retry
  ON kevin_events (next_retry_at);

CREATE INDEX IF NOT EXISTS kevin_events_org
  ON kevin_events (org_id);

CREATE INDEX IF NOT EXISTS kevin_events_type
  ON kevin_events (event_type);

-- ── TABLE: kevin_signals ───────────────────────────────────────────────────
-- Inbound Kevin→TE signal intake with routing result.
CREATE TABLE IF NOT EXISTS kevin_signals (
  id                 TEXT          PRIMARY KEY,
  external_signal_id TEXT,
  org_id             TEXT          NOT NULL,
  signal_type        TEXT          NOT NULL,
  entity_type        TEXT,
  entity_id          TEXT,
  title              TEXT          NOT NULL,
  summary            TEXT,
  evidence           JSONB         NOT NULL DEFAULT '{}'::jsonb,
  confidence         DOUBLE PRECISION,
  risk_class         TEXT
                     CHECK (risk_class IN ('low','medium','high','critical')),
  source             TEXT,
  status             TEXT          NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','routed','actioned','dismissed','duplicate','rejected')),
  routed_to          TEXT,
  attention_item_id  TEXT,
  origin_trace_id    TEXT,
  depth              INTEGER       NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  routed_at          TIMESTAMPTZ,
  actioned_at        TIMESTAMPTZ,
  dismissed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kevin_signals_org
  ON kevin_signals (org_id);

CREATE INDEX IF NOT EXISTS kevin_signals_status
  ON kevin_signals (status);

CREATE INDEX IF NOT EXISTS kevin_signals_risk
  ON kevin_signals (risk_class);

-- Replay-dedup: fastest lookup by external signal id within org
CREATE INDEX IF NOT EXISTS kevin_signals_ext_id
  ON kevin_signals (org_id, external_signal_id)
  WHERE external_signal_id IS NOT NULL;

-- ── TABLE: kevin_context_requests ─────────────────────────────────────────
-- Records every context retrieval request for observability and rate limiting.
CREATE TABLE IF NOT EXISTS kevin_context_requests (
  id                TEXT          PRIMARY KEY,
  org_id            TEXT          NOT NULL,
  agent_type        TEXT          NOT NULL,
  workflow          TEXT,
  entity_type       TEXT,
  entity_id         TEXT,
  question          TEXT,
  response_summary  TEXT,
  confidence        DOUBLE PRECISION,
  memories_count    INTEGER       NOT NULL DEFAULT 0,
  duration_ms       INTEGER,
  status            TEXT          NOT NULL
                    CHECK (status IN ('success','empty','timeout','disabled','unavailable','failed','blocked_loop')),
  origin_trace_id   TEXT,
  depth             INTEGER       NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kevin_context_requests_org
  ON kevin_context_requests (org_id);

CREATE INDEX IF NOT EXISTS kevin_context_requests_agent
  ON kevin_context_requests (agent_type);

-- ── TABLE: kevin_outcomes ──────────────────────────────────────────────────
-- Feedback loop: TE outcomes forwarded to Kevin for learning.
CREATE TABLE IF NOT EXISTS kevin_outcomes (
  id                  TEXT        PRIMARY KEY,
  org_id              TEXT        NOT NULL,
  signal_id           TEXT,
  context_request_id  TEXT,
  run_id              TEXT,
  entity_type         TEXT,
  entity_id           TEXT,
  outcome             TEXT        NOT NULL
                      CHECK (outcome IN ('accepted','modified','rejected','dismissed','no_action','successful','unsuccessful','unknown')),
  result_summary      TEXT,
  was_useful          BOOLEAN,
  was_modified        BOOLEAN,
  recurred            BOOLEAN,
  recorded_by         TEXT,
  forward_status      TEXT        NOT NULL DEFAULT 'pending',
  forward_attempts    INTEGER     NOT NULL DEFAULT 0,
  last_forward_error  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  forwarded_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kevin_outcomes_org
  ON kevin_outcomes (org_id);

CREATE INDEX IF NOT EXISTS kevin_outcomes_signal
  ON kevin_outcomes (signal_id);

CREATE INDEX IF NOT EXISTS kevin_outcomes_forward
  ON kevin_outcomes (forward_status);

-- ── TABLE: kevin_rate_limits ───────────────────────────────────────────────
-- Per-org per-user sliding window for Kevin run rate limiting.
CREATE TABLE IF NOT EXISTS kevin_rate_limits (
  id             TEXT        PRIMARY KEY,
  org_id         TEXT        NOT NULL,
  user_id        TEXT        NOT NULL,
  window_start   TIMESTAMPTZ NOT NULL,
  request_count  INTEGER     NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS kevin_rate_limits_window
  ON kevin_rate_limits (org_id, user_id, window_start);

-- ── TABLE: kevin_audit_events ──────────────────────────────────────────────
-- Append-only operational audit for /api/kevin/* access.
-- Sampled at 20% for health checks; always written for config changes.
CREATE TABLE IF NOT EXISTS kevin_audit_events (
  id          TEXT        PRIMARY KEY,
  org_id      TEXT,
  user_id     TEXT,
  run_id      TEXT,
  event_type  TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kevin_audit_created
  ON kevin_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kevin_audit_type
  ON kevin_audit_events (event_type);

CREATE INDEX IF NOT EXISTS idx_kevin_audit_org
  ON kevin_audit_events (org_id);

-- ── TABLE: kevin_sessions ─────────────────────────────────────────────────
-- Kevin conversation sessions. One session may contain many runs.
CREATE TABLE IF NOT EXISTS kevin_sessions (
  id                TEXT        PRIMARY KEY,
  org_id            TEXT        NOT NULL,
  user_id           TEXT        NOT NULL,
  hermes_session_id TEXT        NOT NULL,
  title             TEXT,
  mode              TEXT        NOT NULL DEFAULT 'ops_chat',
  status            TEXT        NOT NULL DEFAULT 'active',
  last_run_id       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kevin_sessions_org_user
  ON kevin_sessions (org_id, user_id, updated_at DESC);

-- ── TABLE: kevin_runs ──────────────────────────────────────────────────────
-- Individual Kevin runs (one per user prompt). Maps TE run_id ↔ Hermes run_id.
CREATE TABLE IF NOT EXISTS kevin_runs (
  id                TEXT        PRIMARY KEY,
  org_id            TEXT        NOT NULL,
  user_id           TEXT        NOT NULL,
  session_id        TEXT        NOT NULL,
  hermes_run_id     TEXT        NOT NULL,
  client_request_id TEXT,
  mode              TEXT        NOT NULL DEFAULT 'ops_chat',
  status            TEXT        NOT NULL DEFAULT 'queued',
  message           TEXT,
  summary           TEXT,
  error_message     TEXT,
  risk_class        TEXT,
  usage             JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kevin_runs_hermes
  ON kevin_runs (hermes_run_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kevin_runs_idem
  ON kevin_runs (org_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kevin_runs_org_created
  ON kevin_runs (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kevin_runs_session
  ON kevin_runs (session_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 3: Schema reconciliation (pre-existing bootstrap tables)
-- ═══════════════════════════════════════════════════════════════════════════════
-- All statements are idempotent.
-- - "ADD COLUMN IF NOT EXISTS" is available in Postgres 9.6+ (used here).
-- - Columns that already exist are silently skipped.
-- - No columns are dropped; only additive changes.
-- - Missing indexes are created with "CREATE INDEX IF NOT EXISTS".
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── kevin_signals — add columns missing from early bootstrap ────────────────
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS external_signal_id TEXT;
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS entity_id TEXT;
-- title is NOT NULL in schema; bootstrap DB lacks it; add with DEFAULT so existing rows are valid
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}';
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;
-- risk_class references the kevin_risk_class enum (created in Section 1 above)
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS risk_class TEXT;
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS routed_to TEXT;
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS attention_item_id TEXT;
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS origin_trace_id TEXT;
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS actioned_at TIMESTAMPTZ;
ALTER TABLE kevin_signals ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

-- Indexes that reference the new columns
CREATE INDEX IF NOT EXISTS kevin_signals_risk
  ON kevin_signals (risk_class);
CREATE INDEX IF NOT EXISTS kevin_signals_ext_id
  ON kevin_signals (org_id, external_signal_id)
  WHERE external_signal_id IS NOT NULL;

-- ─── kevin_context_requests — add origin_trace_id missing from bootstrap ──────
ALTER TABLE kevin_context_requests ADD COLUMN IF NOT EXISTS origin_trace_id TEXT;

-- ─── kevin_outcomes — add columns missing from bootstrap ──────────────────────
ALTER TABLE kevin_outcomes ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE kevin_outcomes ADD COLUMN IF NOT EXISTS recurred BOOLEAN;
ALTER TABLE kevin_outcomes ADD COLUMN IF NOT EXISTS last_forward_error TEXT;

-- Indexes on outcomes that may not exist yet
CREATE INDEX IF NOT EXISTS kevin_outcomes_signal
  ON kevin_outcomes (signal_id)
  WHERE signal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kevin_outcomes_forward
  ON kevin_outcomes (forward_status);

-- ─── kevin_rate_limits — bootstrap used (bucket, count) instead of (user_id, request_count) ──
-- Add the columns the Drizzle ORM expects; leave legacy (bucket, count) untouched.
ALTER TABLE kevin_rate_limits ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE kevin_rate_limits ADD COLUMN IF NOT EXISTS request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kevin_rate_limits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS kevin_rate_limits_window
  ON kevin_rate_limits (org_id, user_id, window_start);

