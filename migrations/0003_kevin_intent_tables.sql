-- ============================================================================
-- Kevin Intent & Approval Tables — Migration 0003
-- Created: 2026-07-14
--
-- WHAT THIS MIGRATION DOES
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds three new tables to support the Kevin Executive Operations Layer:
--   1. kevin_intents            — durable, 13-state executive intent model
--   2. kevin_intent_tasks       — individual tasks within an intent
--   3. kevin_exec_approvals     — Kevin-specific approval records with evidence
--
-- SAFETY CONTRACT
-- ─────────────────────────────────────────────────────────────────────────────
-- • Every statement is idempotent (CREATE TABLE IF NOT EXISTS, guarded ENUMs).
-- • No DROP, TRUNCATE, or ALTER … DROP COLUMN statements.
-- • Safe to run on a database that already contains these tables.
-- • Safe to run on a completely empty database.
--
-- ROLLBACK DOCUMENTATION (manual — not executed here)
-- ─────────────────────────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS kevin_exec_approvals CASCADE;
--   DROP TABLE IF EXISTS kevin_intent_tasks   CASCADE;
--   DROP TABLE IF EXISTS kevin_intents        CASCADE;
--   DROP TYPE IF EXISTS kevin_intent_state;
--   DROP TYPE IF EXISTS kevin_task_state;
--   DROP TYPE IF EXISTS kevin_approval_status;
-- ============================================================================

-- ── ENUM: kevin_intent_state ───────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE kevin_intent_state AS ENUM (
    'received',
    'validating',
    'planned',
    'awaiting_approval',
    'queued',
    'executing',
    'verifying',
    'completed',
    'partially_completed',
    'failed',
    'cancelled',
    'dead_lettered'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── ENUM: kevin_task_state ─────────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE kevin_task_state AS ENUM (
    'pending',
    'accepted',
    'rejected',
    'in_progress',
    'completed',
    'failed',
    'cancelled',
    'timed_out'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── ENUM: kevin_approval_status ────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE kevin_approval_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'changes_requested',
    'expired',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 1. kevin_intents ───────────────────────────────────────────────────────
-- Durable representation of a Kevin executive intent.
-- One intent → many tasks. An intent persists across restarts.
CREATE TABLE IF NOT EXISTS kevin_intents (
  id                    TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id                TEXT          NOT NULL,

  -- Identity & correlation
  request_id            TEXT          NOT NULL,
  idempotency_key       TEXT          NOT NULL,
  correlation_id        TEXT,
  parent_intent_id      TEXT,

  -- Who initiated this
  initiated_by_user_id  TEXT,
  kevin_identity        TEXT          NOT NULL DEFAULT 'kevin',

  -- What Kevin wants to do
  capability_key        TEXT          NOT NULL,
  goal                  TEXT          NOT NULL,
  reason                TEXT,
  expected_result       TEXT,
  structured_args       JSONB         NOT NULL DEFAULT '{}',
  confidence            NUMERIC(3,2),
  source_context        JSONB,

  -- Execution mode requested/granted
  requested_mode        TEXT          NOT NULL DEFAULT 'recommend',
  granted_mode          TEXT,

  -- State machine
  state                 kevin_intent_state NOT NULL DEFAULT 'received',
  state_history         JSONB         NOT NULL DEFAULT '[]',

  -- Policy + approval
  policy_result         JSONB,
  approval_id           TEXT,
  approval_required     BOOLEAN       NOT NULL DEFAULT false,

  -- Execution
  execution_plan        JSONB,
  executor_agent        TEXT,
  attempts              INT           NOT NULL DEFAULT 0,
  max_attempts          INT           NOT NULL DEFAULT 3,

  -- Outputs
  output                JSONB,
  verification_result   JSONB,
  failure_reason        TEXT,
  partial_results       JSONB,

  -- Timestamps
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  queued_at             TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,

  CONSTRAINT uq_kevin_intent_idempotency UNIQUE (org_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_kevin_intents_org_state
  ON kevin_intents (org_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kevin_intents_capability
  ON kevin_intents (org_id, capability_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kevin_intents_correlation
  ON kevin_intents (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kevin_intents_approval
  ON kevin_intents (approval_id) WHERE approval_id IS NOT NULL;

-- ── 2. kevin_intent_tasks ──────────────────────────────────────────────────
-- Individual units of work delegated to a TE agent as part of an intent.
CREATE TABLE IF NOT EXISTS kevin_intent_tasks (
  id                    TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  intent_id             TEXT          NOT NULL REFERENCES kevin_intents(id) ON DELETE CASCADE,
  org_id                TEXT          NOT NULL,

  -- Task definition
  assigned_agent        TEXT          NOT NULL,
  capability_requested  TEXT          NOT NULL,
  objective             TEXT          NOT NULL,
  inputs                JSONB         NOT NULL DEFAULT '{}',
  constraints           JSONB,
  expected_output_schema JSONB,

  -- Sequencing & delegation safety
  sequence_order        INT           NOT NULL DEFAULT 0,
  depends_on_task_ids   JSONB         NOT NULL DEFAULT '[]',
  delegation_depth      INT           NOT NULL DEFAULT 0,
  max_delegation_depth  INT           NOT NULL DEFAULT 3,
  correlation_chain     JSONB         NOT NULL DEFAULT '[]',

  -- Priority & timing
  priority              TEXT          NOT NULL DEFAULT 'normal',
  due_at                TIMESTAMPTZ,
  timeout_seconds       INT           NOT NULL DEFAULT 300,

  -- Approval
  approval_required     BOOLEAN       NOT NULL DEFAULT false,
  approval_id           TEXT,

  -- State
  state                 kevin_task_state NOT NULL DEFAULT 'pending',
  attempts              INT           NOT NULL DEFAULT 0,
  max_attempts          INT           NOT NULL DEFAULT 3,

  -- Output
  agent_output          JSONB,
  output_valid          BOOLEAN,
  verification_notes    TEXT,
  failure_reason        TEXT,
  error_code            TEXT,

  -- Timestamps
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  accepted_at           TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_kevin_intent_tasks_intent
  ON kevin_intent_tasks (intent_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_kevin_intent_tasks_agent_state
  ON kevin_intent_tasks (org_id, assigned_agent, state);
CREATE INDEX IF NOT EXISTS idx_kevin_intent_tasks_org_state
  ON kevin_intent_tasks (org_id, state, created_at DESC);

-- ── 3. kevin_exec_approvals ────────────────────────────────────────────────
-- Kevin-specific approval records with rich metadata: evidence, risks,
-- exact payload, reversibility, affected records.
CREATE TABLE IF NOT EXISTS kevin_exec_approvals (
  id                    TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id                TEXT          NOT NULL,
  intent_id             TEXT,
  task_id               TEXT,

  -- What Kevin wants to do
  capability_key        TEXT          NOT NULL,
  action_summary        TEXT          NOT NULL,
  action_reason         TEXT,
  action_payload        JSONB         NOT NULL DEFAULT '{}',
  exact_payload         JSONB         NOT NULL DEFAULT '{}',

  -- Evidence & context
  evidence              JSONB,
  affected_records      JSONB,
  expected_benefit      TEXT,
  risk_description      TEXT,
  risk_level            TEXT          NOT NULL DEFAULT 'medium',
  is_reversible         BOOLEAN       NOT NULL DEFAULT false,
  rollback_strategy     TEXT,

  -- Producing agent
  producer_agent        TEXT,
  kevin_confidence      NUMERIC(3,2),

  -- Decision
  status                kevin_approval_status NOT NULL DEFAULT 'pending',
  decided_by            TEXT,
  decided_at            TIMESTAMPTZ,
  decision_notes        TEXT,
  approved_payload      JSONB,

  -- Scope limits
  approve_once          BOOLEAN       NOT NULL DEFAULT true,
  approve_similar_limit INT,
  similar_approved_count INT          NOT NULL DEFAULT 0,

  -- Timing
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kevin_exec_approvals_org_status
  ON kevin_exec_approvals (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kevin_exec_approvals_intent
  ON kevin_exec_approvals (intent_id) WHERE intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kevin_exec_approvals_capability
  ON kevin_exec_approvals (org_id, capability_key, status);
