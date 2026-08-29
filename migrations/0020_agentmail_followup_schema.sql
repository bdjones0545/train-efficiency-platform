-- Formal ownership for the human-approved AgentMail follow-up queue.
-- Existing runtime-created rows are preserved; their row id is the durable
-- business identity for one intended follow-up send.

CREATE TABLE IF NOT EXISTS agent_mail_followups (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  source_inbound_message_id TEXT,
  source_reply_queue_id TEXT,
  inbox TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  classification TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  followup_body TEXT NOT NULL,
  edited_body TEXT,
  sequence_name TEXT NOT NULL,
  sequence_step INTEGER NOT NULL DEFAULT 1,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  approval_status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  approved_payload_version TEXT,
  send_attempt_count INTEGER NOT NULL DEFAULT 0,
  send_claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  skipped_reason TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_mail_followups ADD COLUMN IF NOT EXISTS approved_payload_version TEXT;
ALTER TABLE agent_mail_followups ADD COLUMN IF NOT EXISTS send_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_mail_followups ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM agent_mail_followups WHERE btrim(organization_id) = '' OR lower(btrim(organization_id)) IN ('default','global','unknown','unscoped')) THEN
    RAISE EXCEPTION 'AgentMail follow-up migration blocked: invalid tenant identity';
  END IF;
  IF EXISTS (SELECT 1 FROM agent_mail_followups WHERE send_attempt_count < 0) THEN
    RAISE EXCEPTION 'AgentMail follow-up migration blocked: negative attempt count';
  END IF;
  IF EXISTS (SELECT 1 FROM agent_mail_followups WHERE status IN ('sending','sent','uncertain_provider_outcome') AND send_attempt_count < 1) THEN
    RAISE EXCEPTION 'AgentMail follow-up migration blocked: send lifecycle lacks durable attempt';
  END IF;
END $$;

ALTER TABLE agent_mail_followups DROP CONSTRAINT IF EXISTS agent_mail_followups_contract_check;
ALTER TABLE agent_mail_followups ADD CONSTRAINT agent_mail_followups_contract_check CHECK (
  btrim(organization_id) <> '' AND lower(btrim(organization_id)) NOT IN ('default','global','unknown','unscoped') AND
  btrim(inbox) <> '' AND btrim(recipient_email) <> '' AND sequence_step > 0 AND send_attempt_count >= 0 AND
  status IN ('scheduled','pending_review','sending','sent','skipped','cancelled','failed','uncertain_provider_outcome') AND
  approval_status IN ('pending','pending_review','approved','rejected') AND
  (approval_status <> 'approved' OR (approved_at IS NOT NULL AND approved_payload_version IS NOT NULL AND btrim(approved_payload_version) <> '')) AND
  (status NOT IN ('sending','sent','uncertain_provider_outcome') OR (send_attempt_count > 0 AND send_claimed_at IS NOT NULL)) AND
  (status <> 'sent' OR sent_at IS NOT NULL)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agent_mail_followups' AND c.contype='u'
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['organization_id','id']::text[]
  ) THEN
    ALTER TABLE agent_mail_followups ADD CONSTRAINT agent_mail_followups_org_id_id_unique UNIQUE (organization_id,id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS agent_mail_followups_sequence_step_unique
  ON agent_mail_followups (organization_id, source_reply_queue_id, sequence_step)
  WHERE source_reply_queue_id IS NOT NULL AND status IN ('scheduled','pending_review','sending','uncertain_provider_outcome');
CREATE INDEX IF NOT EXISTS idx_followup_org_status_scheduled
  ON agent_mail_followups (organization_id,status,scheduled_for);
CREATE INDEX IF NOT EXISTS idx_followup_inbox ON agent_mail_followups (organization_id,inbox);
CREATE INDEX IF NOT EXISTS idx_followup_inbound ON agent_mail_followups (organization_id,source_inbound_message_id);

-- Exact structural verification is intentionally part of the migration so a
-- same-name but incompatible legacy object cannot be adopted silently.
DO $$
DECLARE r RECORD; actual RECORD; normalized_default TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('id','text',true,'gen_random_uuid()'),('organization_id','text',true,NULL),
    ('source_inbound_message_id','text',false,NULL),('source_reply_queue_id','text',false,NULL),
    ('inbox','text',true,NULL),('agent_name','text',true,NULL),('classification','text',true,NULL),
    ('recipient_email','text',true,NULL),('recipient_name','text',false,NULL),('subject','text',true,NULL),
    ('followup_body','text',true,NULL),('edited_body','text',false,NULL),('sequence_name','text',true,NULL),
    ('sequence_step','integer',true,'1'),('scheduled_for','timestamp with time zone',true,NULL),
    ('status','text',true,'''scheduled'''),('approval_status','text',true,'''pending'''),
    ('approved_by','text',false,NULL),('approved_at','timestamp with time zone',false,NULL),
    ('approved_payload_version','text',false,NULL),('send_attempt_count','integer',true,'0'),
    ('send_claimed_at','timestamp with time zone',false,NULL),('sent_at','timestamp with time zone',false,NULL),
    ('provider_message_id','text',false,NULL),('skipped_reason','text',false,NULL),('error_message','text',false,NULL),
    ('created_at','timestamp with time zone',true,'now()'),('updated_at','timestamp with time zone',true,'now()')
  ) expected(column_name,canonical_type,is_not_null,expected_default)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid) INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname='agent_mail_followups' AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing agent_mail_followups.%',r.column_name; END IF;
    normalized_default := CASE WHEN actual.pg_get_expr IS NULL THEN NULL ELSE regexp_replace(regexp_replace(lower(actual.pg_get_expr),'\s+','','g'),'::(text|integer|timestampwithtimezone)','','g') END;
    normalized_default := regexp_replace(normalized_default,'^\((.*)\)$','\1');
    IF actual.format_type<>r.canonical_type OR actual.attnotnull<>r.is_not_null OR normalized_default IS DISTINCT FROM r.expected_default THEN
      RAISE EXCEPTION 'agent_mail_followups.% contract mismatch',r.column_name;
    END IF;
  END LOOP;
END $$;
