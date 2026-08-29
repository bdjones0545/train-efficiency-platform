-- Formal ownership for Release 1 AgentMail transport and Kevin callback
-- replay-protection schema. Runtime startup validates these objects read-only.

CREATE TABLE IF NOT EXISTS agent_mail_inbound_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT,
  inbox TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  provider_message_id TEXT UNIQUE,
  provider_inbox_id TEXT,
  provider_thread_id TEXT,
  provider_event_id TEXT,
  classification TEXT,
  confidence DOUBLE PRECISION DEFAULT 0,
  routed_agent TEXT,
  routed_status TEXT NOT NULL DEFAULT 'received',
  routing_status TEXT NOT NULL DEFAULT 'routed',
  routing_reason TEXT,
  routed_at TIMESTAMPTZ,
  processing_state TEXT NOT NULL DEFAULT 'received',
  processing_started_at TIMESTAMPTZ,
  processing_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  action_type TEXT,
  action_payload JSONB,
  raw_payload JSONB,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_org ON agent_mail_inbound_messages (organization_id);
CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_inbox ON agent_mail_inbound_messages (inbox);
CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_routing ON agent_mail_inbound_messages (routing_status);
CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_processing ON agent_mail_inbound_messages (processing_state, processing_started_at);
CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_provider_inbox ON agent_mail_inbound_messages (provider_inbox_id);
CREATE INDEX IF NOT EXISTS idx_agentmail_inbound_rcvd ON agent_mail_inbound_messages (received_at DESC);

CREATE TABLE IF NOT EXISTS org_agentmail_inboxes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  role TEXT NOT NULL CONSTRAINT chk_org_agentmail_role
    CHECK (role IN ('revenue','hiring','scheduling','support','operations','ceo')),
  username TEXT NOT NULL,
  email_address TEXT NOT NULL,
  provider_inbox_id TEXT,
  provider_domain TEXT,
  ownership_state TEXT NOT NULL DEFAULT 'provisioning' CONSTRAINT chk_org_agentmail_state
    CHECK (ownership_state IN ('provisioning','active','disabled','retired')),
  provisioned_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  disable_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, role),
  UNIQUE (email_address),
  UNIQUE (username)
);
CREATE UNIQUE INDEX IF NOT EXISTS uix_org_agentmail_provider_inbox_id
  ON org_agentmail_inboxes (provider_inbox_id) WHERE provider_inbox_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_org ON org_agentmail_inboxes (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_email ON org_agentmail_inboxes (email_address);
CREATE INDEX IF NOT EXISTS idx_org_agentmail_inboxes_state ON org_agentmail_inboxes (ownership_state);

CREATE TABLE IF NOT EXISTS agent_mail_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  inbox TEXT NOT NULL,
  to_email TEXT NOT NULL,
  from_email TEXT,
  subject TEXT NOT NULL,
  body_preview TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_mail_org ON agent_mail_messages (organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_mail_inbox ON agent_mail_messages (inbox);
CREATE INDEX IF NOT EXISTS idx_agent_mail_status ON agent_mail_messages (status);

CREATE TABLE IF NOT EXISTS agentmail_effect_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  inbound_id TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inbound_id, effect_type)
);
CREATE INDEX IF NOT EXISTS idx_agentmail_effect_inbound ON agentmail_effect_log (inbound_id);

CREATE TABLE IF NOT EXISTS agentmail_webhook_deliveries (
  svix_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agentmail_webhook_delivery_status
  ON agentmail_webhook_deliveries (status, claimed_at);

CREATE TABLE IF NOT EXISTS kevin_callback_nonces (
  id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  job_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kcn_received ON kevin_callback_nonces(received_at);
