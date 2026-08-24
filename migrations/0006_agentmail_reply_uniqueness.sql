CREATE TABLE IF NOT EXISTS agent_mail_reply_queue (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  inbound_message_id TEXT NOT NULL,
  inbox TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  classification TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  draft_body TEXT NOT NULL,
  edited_body TEXT,
  final_body TEXT,
  status TEXT NOT NULL DEFAULT 'drafted',
  approval_status TEXT NOT NULL DEFAULT 'pending_review',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  provider_inbound_message_id TEXT,
  thread_id TEXT,
  delivery_status TEXT,
  rejection_reason TEXT,
  confidence DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_mail_reply_queue
  ADD COLUMN IF NOT EXISTS provider_inbound_message_id TEXT;

CREATE TABLE IF NOT EXISTS agent_mail_reply_outcomes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reply_queue_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  inbox TEXT NOT NULL,
  classification TEXT NOT NULL,
  outcome_type TEXT NOT NULL,
  response_time_minutes DOUBLE PRECISION,
  actor TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

LOCK TABLE agent_mail_reply_queue IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'agent_mail_reply_queue'
      AND column_name IN ('organization_id', 'inbound_message_id')
      AND udt_name <> 'text'
  ) OR (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'agent_mail_reply_queue'
      AND column_name IN ('organization_id', 'inbound_message_id')
  ) <> 2 THEN
    RAISE EXCEPTION 'AgentMail reply migration blocked: incompatible tenant or inbound identity schema';
  END IF;

  IF EXISTS (
    SELECT 1 FROM agent_mail_reply_queue
    WHERE organization_id IS NULL OR inbound_message_id IS NULL
  ) THEN
    RAISE EXCEPTION 'AgentMail reply migration blocked: null tenant or inbound identity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM agent_mail_reply_queue a
    JOIN agent_mail_reply_queue b
      ON a.organization_id = b.organization_id
     AND a.inbound_message_id = b.inbound_message_id
     AND a.id < b.id
    WHERE ROW(
      a.inbox, a.agent_name, a.classification, a.recipient_email,
      a.recipient_name, a.subject, a.draft_body, a.edited_body, a.final_body,
      a.status, a.approval_status, a.approved_by, a.approved_at, a.sent_at,
      a.provider_message_id, a.provider_inbound_message_id, a.thread_id,
      a.delivery_status, a.rejection_reason, a.confidence
    ) IS DISTINCT FROM ROW(
      b.inbox, b.agent_name, b.classification, b.recipient_email,
      b.recipient_name, b.subject, b.draft_body, b.edited_body, b.final_body,
      b.status, b.approval_status, b.approved_by, b.approved_at, b.sent_at,
      b.provider_message_id, b.provider_inbound_message_id, b.thread_id,
      b.delivery_status, b.rejection_reason, b.confidence
    )
  ) THEN
    RAISE EXCEPTION 'AgentMail reply migration blocked: divergent tenant-scoped duplicates require manual review';
  END IF;
END
$$;

ALTER TABLE agent_mail_reply_queue
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN inbound_message_id SET NOT NULL;

CREATE TEMP TABLE agentmail_reply_duplicate_map ON COMMIT DROP AS
SELECT id AS duplicate_id, survivor_id
FROM (
  SELECT id,
    first_value(id) OVER (
      PARTITION BY organization_id, inbound_message_id
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS survivor_id,
    row_number() OVER (
      PARTITION BY organization_id, inbound_message_id
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS duplicate_position
  FROM agent_mail_reply_queue
) ranked
WHERE duplicate_position > 1;

UPDATE agent_mail_reply_outcomes outcome
SET reply_queue_id = duplicate_map.survivor_id
FROM agentmail_reply_duplicate_map duplicate_map
WHERE outcome.reply_queue_id = duplicate_map.duplicate_id;

DO $$
BEGIN
  IF to_regclass('agent_mail_followups') IS NOT NULL THEN
    EXECUTE $update$
      UPDATE agent_mail_followups followup
      SET source_reply_queue_id = duplicate_map.survivor_id
      FROM agentmail_reply_duplicate_map duplicate_map
      WHERE followup.source_reply_queue_id = duplicate_map.duplicate_id
    $update$;
  END IF;
END
$$;

DELETE FROM agent_mail_reply_queue reply
USING agentmail_reply_duplicate_map duplicate_map
WHERE reply.id = duplicate_map.duplicate_id;

CREATE INDEX IF NOT EXISTS idx_reply_queue_org ON agent_mail_reply_queue (organization_id);
CREATE INDEX IF NOT EXISTS idx_reply_queue_status ON agent_mail_reply_queue (status);
CREATE INDEX IF NOT EXISTS idx_reply_queue_approval ON agent_mail_reply_queue (approval_status);
CREATE INDEX IF NOT EXISTS idx_reply_queue_inbox ON agent_mail_reply_queue (inbox);
CREATE INDEX IF NOT EXISTS idx_reply_queue_inbound ON agent_mail_reply_queue (inbound_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_queue_inbound_unique
  ON agent_mail_reply_queue (organization_id, inbound_message_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index definition
    JOIN pg_class relation ON relation.oid = definition.indrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = current_schema()
      AND relation.relname = 'agent_mail_reply_queue'
      AND definition.indisunique
      AND ARRAY(
        SELECT attribute.attname::text
        FROM unnest(definition.indkey) WITH ORDINALITY key(attribute_number, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = definition.indrelid
         AND attribute.attnum = key.attribute_number
        ORDER BY key.ordinality
      ) = ARRAY['organization_id', 'inbound_message_id']::text[]
  ) THEN
    RAISE EXCEPTION 'AgentMail reply migration blocked: tenant-scoped uniqueness was not established';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_reply_outcome_org ON agent_mail_reply_outcomes (organization_id);
CREATE INDEX IF NOT EXISTS idx_reply_outcome_agent ON agent_mail_reply_outcomes (agent_name);
CREATE INDEX IF NOT EXISTS idx_reply_outcome_type ON agent_mail_reply_outcomes (outcome_type);
