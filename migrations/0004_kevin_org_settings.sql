-- Kevin Org-Level Capability Settings — Phase 3
-- Idempotent: uses CREATE TABLE IF NOT EXISTS and INSERT ... ON CONFLICT DO NOTHING

CREATE TABLE IF NOT EXISTS kevin_org_capability_settings (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id           TEXT NOT NULL,
  capability_key   TEXT NOT NULL,
  capability_version TEXT NOT NULL DEFAULT '1',
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  execution_mode   TEXT NOT NULL DEFAULT 'require_approval',
  allowed_roles    TEXT[] NOT NULL DEFAULT ARRAY['ADMIN'],
  max_volume_per_hour INT DEFAULT 10,
  approval_policy  TEXT DEFAULT 'always',
  auto_exec_limit  INT DEFAULT 0,
  allowed_scope    TEXT DEFAULT 'org',
  effective_date   TIMESTAMPTZ,
  expiration_date  TIMESTAMPTZ,
  configured_by    TEXT,
  emergency_override BOOLEAN NOT NULL DEFAULT FALSE,
  business_rules   JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, capability_key)
);

CREATE INDEX IF NOT EXISTS idx_kocs_org    ON kevin_org_capability_settings (org_id);
CREATE INDEX IF NOT EXISTS idx_kocs_cap    ON kevin_org_capability_settings (capability_key);
CREATE INDEX IF NOT EXISTS idx_kocs_mode   ON kevin_org_capability_settings (execution_mode);
CREATE INDEX IF NOT EXISTS idx_kocs_enabled ON kevin_org_capability_settings (enabled);

-- Add columns to kevin_intents if they don't exist yet (verification tracking)
ALTER TABLE kevin_intents ADD COLUMN IF NOT EXISTS last_verification_status TEXT;
ALTER TABLE kevin_intents ADD COLUMN IF NOT EXISTS last_verification_at     TIMESTAMPTZ;

-- Add verification columns to kevin_intent_tasks if they don't exist
ALTER TABLE kevin_intent_tasks ADD COLUMN IF NOT EXISTS verification_result JSONB;
ALTER TABLE kevin_intent_tasks ADD COLUMN IF NOT EXISTS verification_status TEXT;
