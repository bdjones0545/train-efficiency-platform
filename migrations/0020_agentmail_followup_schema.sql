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

DO $$
DECLARE actual TEXT;
DECLARE expected CONSTANT TEXT := $contract$CHECK (((btrim(organization_id) <> ''::text) AND (lower(btrim(organization_id)) <> ALL (ARRAY['default'::text, 'global'::text, 'unknown'::text, 'unscoped'::text])) AND (btrim(inbox) <> ''::text) AND (btrim(recipient_email) <> ''::text) AND (sequence_step > 0) AND (send_attempt_count >= 0) AND (status = ANY (ARRAY['scheduled'::text, 'pending_review'::text, 'sending'::text, 'sent'::text, 'skipped'::text, 'cancelled'::text, 'failed'::text, 'uncertain_provider_outcome'::text])) AND (approval_status = ANY (ARRAY['pending'::text, 'pending_review'::text, 'approved'::text, 'rejected'::text])) AND ((approval_status <> 'approved'::text) OR ((approved_at IS NOT NULL) AND (approved_payload_version IS NOT NULL) AND (btrim(approved_payload_version) <> ''::text))) AND ((status <> ALL (ARRAY['sending'::text, 'sent'::text, 'uncertain_provider_outcome'::text])) OR ((send_attempt_count > 0) AND (send_claimed_at IS NOT NULL))) AND ((status <> 'sent'::text) OR (sent_at IS NOT NULL))))$contract$;
BEGIN
  SELECT pg_get_constraintdef(c.oid,false) INTO actual
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname=current_schema() AND t.relname='agent_mail_followups'
    AND c.conname='agent_mail_followups_contract_check' AND c.contype='c';
  IF FOUND AND actual <> expected THEN
    RAISE EXCEPTION 'AgentMail follow-up migration blocked: lifecycle constraint mismatch';
  ELSIF NOT FOUND THEN
    ALTER TABLE agent_mail_followups ADD CONSTRAINT agent_mail_followups_contract_check CHECK (
      btrim(organization_id) <> '' AND lower(btrim(organization_id)) NOT IN ('default','global','unknown','unscoped') AND
      btrim(inbox) <> '' AND btrim(recipient_email) <> '' AND sequence_step > 0 AND send_attempt_count >= 0 AND
      status IN ('scheduled','pending_review','sending','sent','skipped','cancelled','failed','uncertain_provider_outcome') AND
      approval_status IN ('pending','pending_review','approved','rejected') AND
      (approval_status <> 'approved' OR (approved_at IS NOT NULL AND approved_payload_version IS NOT NULL AND btrim(approved_payload_version) <> '')) AND
      (status NOT IN ('sending','sent','uncertain_provider_outcome') OR (send_attempt_count > 0 AND send_claimed_at IS NOT NULL)) AND
      (status <> 'sent' OR sent_at IS NOT NULL)
    );
  END IF;
END $$;

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
    normalized_default := CASE WHEN actual.pg_get_expr IS NULL THEN NULL ELSE regexp_replace(regexp_replace(actual.pg_get_expr,'\s+','','g'),'::(text|integer|timestampwithtimezone)','','g') END;
    normalized_default := regexp_replace(normalized_default,'^\((.*)\)$','\1');
    IF actual.format_type<>r.canonical_type OR actual.attnotnull<>r.is_not_null OR normalized_default IS DISTINCT FROM r.expected_default THEN
      RAISE EXCEPTION 'agent_mail_followups.% contract mismatch',r.column_name;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE r RECORD; actual RECORD;
DECLARE expected_contract CONSTANT TEXT := $contract$CHECK (((btrim(organization_id) <> ''::text) AND (lower(btrim(organization_id)) <> ALL (ARRAY['default'::text, 'global'::text, 'unknown'::text, 'unscoped'::text])) AND (btrim(inbox) <> ''::text) AND (btrim(recipient_email) <> ''::text) AND (sequence_step > 0) AND (send_attempt_count >= 0) AND (status = ANY (ARRAY['scheduled'::text, 'pending_review'::text, 'sending'::text, 'sent'::text, 'skipped'::text, 'cancelled'::text, 'failed'::text, 'uncertain_provider_outcome'::text])) AND (approval_status = ANY (ARRAY['pending'::text, 'pending_review'::text, 'approved'::text, 'rejected'::text])) AND ((approval_status <> 'approved'::text) OR ((approved_at IS NOT NULL) AND (approved_payload_version IS NOT NULL) AND (btrim(approved_payload_version) <> ''::text))) AND ((status <> ALL (ARRAY['sending'::text, 'sent'::text, 'uncertain_provider_outcome'::text])) OR ((send_attempt_count > 0) AND (send_claimed_at IS NOT NULL))) AND ((status <> 'sent'::text) OR (sent_at IS NOT NULL))))$contract$;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('agent_mail_followups_pkey',true,true,ARRAY['id']::text[],NULL::text),
    ('agent_mail_followups_org_id_id_unique',false,true,ARRAY['organization_id','id']::text[],NULL::text),
    ('agent_mail_followups_sequence_step_unique',false,true,ARRAY['organization_id','source_reply_queue_id','sequence_step']::text[],
      $predicate$((source_reply_queue_id IS NOT NULL) AND (status = ANY (ARRAY['scheduled'::text, 'pending_review'::text, 'sending'::text, 'uncertain_provider_outcome'::text])))$predicate$),
    ('idx_followup_org_status_scheduled',false,false,ARRAY['organization_id','status','scheduled_for']::text[],NULL::text),
    ('idx_followup_inbox',false,false,ARRAY['organization_id','inbox']::text[],NULL::text),
    ('idx_followup_inbound',false,false,ARRAY['organization_id','source_inbound_message_id']::text[],NULL::text)
  ) expected(index_name,is_primary,is_unique,key_columns,predicate)
  LOOP
    SELECT i.indisprimary is_primary,i.indisunique is_unique,i.indisvalid is_valid,i.indisready is_ready,
      i.indnkeyatts key_count,i.indnatts total_count,bool_or(k.attnum=0) has_expressions,
      array_agg(a.attname ORDER BY k.ordinality)::text[] key_columns,
      pg_get_expr(i.indpred,i.indrelid,false) predicate INTO actual
    FROM pg_class idx JOIN pg_namespace ns ON ns.oid=idx.relnamespace
    JOIN pg_index i ON i.indexrelid=idx.oid JOIN pg_class t ON t.oid=i.indrelid
    JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON k.ordinality<=i.indnkeyatts
    LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE ns.nspname=current_schema() AND t.relname='agent_mail_followups' AND idx.relname=r.index_name
    GROUP BY i.indexrelid;
    IF NOT FOUND OR actual.is_primary<>r.is_primary OR actual.is_unique<>r.is_unique OR NOT actual.is_valid OR NOT actual.is_ready
      OR actual.key_count<>cardinality(r.key_columns) OR actual.total_count<>actual.key_count
      OR actual.has_expressions OR actual.key_columns<>r.key_columns
      OR actual.predicate IS DISTINCT FROM r.predicate THEN
      RAISE EXCEPTION 'AgentMail follow-up migration blocked: index % contract mismatch',r.index_name;
    END IF;
  END LOOP;

  SELECT c.convalidated validated,c.conindid backing_index_oid,idx.relname backing_index_name,
    i.indisprimary backing_is_primary,
    (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[]
      FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum) key_columns
    INTO actual
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  JOIN pg_class idx ON idx.oid=c.conindid JOIN pg_index i ON i.indexrelid=c.conindid
  WHERE n.nspname=current_schema() AND t.relname='agent_mail_followups' AND c.contype='p';
  IF NOT FOUND OR NOT actual.validated OR actual.backing_index_oid=0
    OR actual.backing_index_name<>'agent_mail_followups_pkey' OR NOT actual.backing_is_primary
    OR actual.key_columns<>ARRAY['id']::text[] THEN
    RAISE EXCEPTION 'AgentMail follow-up migration blocked: primary key contract mismatch';
  END IF;

  SELECT pg_get_constraintdef(c.oid,false) definition,c.convalidated validated INTO actual
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname=current_schema() AND t.relname='agent_mail_followups'
    AND c.conname='agent_mail_followups_contract_check' AND c.contype='c';
  IF NOT FOUND OR NOT actual.validated OR actual.definition<>expected_contract THEN
    RAISE EXCEPTION 'AgentMail follow-up migration blocked: lifecycle constraint contract mismatch';
  END IF;
END $$;
