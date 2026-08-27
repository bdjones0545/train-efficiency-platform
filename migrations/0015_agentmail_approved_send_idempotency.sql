-- Durable authority for human-approved AgentMail reply sends only.
-- Historical reply rows are preserved. No logical identity or approval version
-- is fabricated for them; legacy rows fail closed until explicitly reapproved.

ALTER TABLE agent_mail_reply_queue ADD COLUMN IF NOT EXISTS logical_send_id TEXT;
ALTER TABLE agent_mail_reply_queue ADD COLUMN IF NOT EXISTS approval_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_mail_reply_queue ADD COLUMN IF NOT EXISTS approved_payload_version TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM agent_mail_reply_queue WHERE approval_version < 0) THEN
    RAISE EXCEPTION 'AgentMail approved-send migration blocked: negative approval version';
  END IF;
END $$;

ALTER TABLE agent_mail_reply_queue DROP CONSTRAINT IF EXISTS agent_mail_reply_queue_approval_version_check;
ALTER TABLE agent_mail_reply_queue ADD CONSTRAINT agent_mail_reply_queue_approval_version_check
  CHECK (approval_version >= 0);

-- NOT VALID preserves ambiguous historical approvals while enforcing the
-- contract for every new or subsequently updated approved row.
ALTER TABLE agent_mail_reply_queue DROP CONSTRAINT IF EXISTS agent_mail_reply_queue_approved_payload_check;
ALTER TABLE agent_mail_reply_queue ADD CONSTRAINT agent_mail_reply_queue_approved_payload_check CHECK (
  approval_status <> 'approved' OR (
    logical_send_id IS NOT NULL AND btrim(logical_send_id) <> '' AND
    approved_payload_version IS NOT NULL AND btrim(approved_payload_version) <> '' AND
    approval_version > 0
  )
) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agent_mail_reply_queue'
      AND c.contype='u'
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[]
        FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)
        = ARRAY['organization_id','id']::text[]
  ) THEN
    ALTER TABLE agent_mail_reply_queue ADD CONSTRAINT agent_mail_reply_queue_org_id_id_unique
      UNIQUE (organization_id,id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agentmail_approved_logical_sends (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  send_class TEXT NOT NULL DEFAULT 'human_approved',
  logical_send_id TEXT NOT NULL,
  authority_type TEXT NOT NULL DEFAULT 'agentmail_reply_queue',
  authority_id TEXT NOT NULL,
  approved_payload_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed',
  provider TEXT NOT NULL DEFAULT 'agentmail',
  succeeded_at TIMESTAMPTZ,
  uncertain_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agentmail_approved_logical_sends_identity_check CHECK (
    btrim(org_id)<>'' AND lower(btrim(org_id)) NOT IN ('default','global','unknown','unscoped') AND
    send_class='human_approved' AND btrim(logical_send_id)<>'' AND
    authority_type='agentmail_reply_queue' AND btrim(authority_id)<>'' AND
    btrim(approved_payload_version)<>'' AND provider='agentmail' AND
    status IN ('claimed','attempt_in_progress','confirmed_success','confirmed_failure','uncertain_provider_outcome') AND
    (status='confirmed_success')=(succeeded_at IS NOT NULL) AND
    (status='uncertain_provider_outcome')=(uncertain_at IS NOT NULL)
  ),
  CONSTRAINT agentmail_approved_logical_sends_authority_fk
    FOREIGN KEY (org_id,authority_id)
    REFERENCES agent_mail_reply_queue(organization_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS agentmail_approved_logical_sends_identity_unique
  ON agentmail_approved_logical_sends(org_id,send_class,logical_send_id);
CREATE UNIQUE INDEX IF NOT EXISTS agentmail_approved_logical_sends_authority_version_unique
  ON agentmail_approved_logical_sends(org_id,authority_type,authority_id,approved_payload_version);
CREATE INDEX IF NOT EXISTS agentmail_approved_logical_sends_authority_idx
  ON agentmail_approved_logical_sends(org_id,authority_id);

CREATE TABLE IF NOT EXISTS agentmail_approved_send_attempts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  logical_send_row_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'agentmail',
  approved_payload_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  provider_message_id TEXT,
  provider_thread_id TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agentmail_approved_send_attempts_contract_check CHECK (
    attempt_number>0 AND provider='agentmail' AND btrim(approved_payload_version)<>'' AND
    status IN ('authorized','in_progress','confirmed_success','confirmed_failure','uncertain_provider_outcome') AND
    (status IN ('authorized','in_progress'))=(completed_at IS NULL)
  ),
  CONSTRAINT agentmail_approved_send_attempts_logical_fk
    FOREIGN KEY (logical_send_row_id)
    REFERENCES agentmail_approved_logical_sends(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT agentmail_approved_send_attempts_number_unique
    UNIQUE (logical_send_row_id,attempt_number)
);

CREATE INDEX IF NOT EXISTS agentmail_approved_send_attempts_logical_idx
  ON agentmail_approved_send_attempts(logical_send_row_id);
CREATE INDEX IF NOT EXISTS agentmail_approved_send_attempts_provider_receipt_idx
  ON agentmail_approved_send_attempts(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Validate exact owned structures rather than trusting same-name objects.
DO $$
DECLARE r RECORD; actual RECORD; normalized_default TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('agent_mail_reply_queue','logical_send_id','text',false,NULL),
    ('agent_mail_reply_queue','approval_version','integer',true,'0'),
    ('agent_mail_reply_queue','approved_payload_version','text',false,NULL),
    ('agentmail_approved_logical_sends','id','text',true,'gen_random_uuid()'),
    ('agentmail_approved_logical_sends','org_id','text',true,NULL),
    ('agentmail_approved_logical_sends','send_class','text',true,'''human_approved'''),
    ('agentmail_approved_logical_sends','logical_send_id','text',true,NULL),
    ('agentmail_approved_logical_sends','authority_type','text',true,'''agentmail_reply_queue'''),
    ('agentmail_approved_logical_sends','authority_id','text',true,NULL),
    ('agentmail_approved_logical_sends','approved_payload_version','text',true,NULL),
    ('agentmail_approved_logical_sends','status','text',true,'''claimed'''),
    ('agentmail_approved_logical_sends','provider','text',true,'''agentmail'''),
    ('agentmail_approved_logical_sends','succeeded_at','timestamp with time zone',false,NULL),
    ('agentmail_approved_logical_sends','uncertain_at','timestamp with time zone',false,NULL),
    ('agentmail_approved_logical_sends','created_at','timestamp with time zone',true,'now()'),
    ('agentmail_approved_logical_sends','updated_at','timestamp with time zone',true,'now()'),
    ('agentmail_approved_send_attempts','id','text',true,'gen_random_uuid()'),
    ('agentmail_approved_send_attempts','logical_send_row_id','text',true,NULL),
    ('agentmail_approved_send_attempts','attempt_number','integer',true,NULL),
    ('agentmail_approved_send_attempts','provider','text',true,'''agentmail'''),
    ('agentmail_approved_send_attempts','approved_payload_version','text',true,NULL),
    ('agentmail_approved_send_attempts','status','text',true,'''in_progress'''),
    ('agentmail_approved_send_attempts','provider_message_id','text',false,NULL),
    ('agentmail_approved_send_attempts','provider_thread_id','text',false,NULL),
    ('agentmail_approved_send_attempts','error_message','text',false,NULL),
    ('agentmail_approved_send_attempts','started_at','timestamp with time zone',true,'now()'),
    ('agentmail_approved_send_attempts','completed_at','timestamp with time zone',false,NULL),
    ('agentmail_approved_send_attempts','created_at','timestamp with time zone',true,'now()'),
    ('agentmail_approved_send_attempts','updated_at','timestamp with time zone',true,'now()')
  ) AS expected(table_name,column_name,canonical_type,is_not_null,expected_default)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod) canonical_type,a.attnotnull is_not_null,
      pg_get_expr(d.adbin,d.adrelid) column_default INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname=r.table_name AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing %.%',r.table_name,r.column_name; END IF;
    normalized_default := CASE WHEN actual.column_default IS NULL THEN NULL ELSE
      regexp_replace(regexp_replace(lower(actual.column_default),'\s+','','g'),
        '::(text|integer|timestampwithtimezone)','','g') END;
    normalized_default := regexp_replace(normalized_default,'^\((.*)\)$','\1');
    IF actual.canonical_type<>r.canonical_type OR actual.is_not_null<>r.is_not_null
      OR normalized_default IS DISTINCT FROM r.expected_default THEN
      RAISE EXCEPTION '%.% contract mismatch',r.table_name,r.column_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema()
    AND t.relname='agentmail_approved_logical_sends' AND c.contype='p'
    AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['id']::text[])
  THEN RAISE EXCEPTION 'agentmail approved logical send primary key mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema()
    AND t.relname='agentmail_approved_send_attempts' AND c.contype='p'
    AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['id']::text[])
  THEN RAISE EXCEPTION 'agentmail approved attempt primary key mismatch'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agentmail_approved_logical_sends' AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
    AND i.indnkeyatts=3 AND NOT (0=ANY(i.indkey::smallint[]))
    AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','send_class','logical_send_id']::text[])
  THEN RAISE EXCEPTION 'agentmail approved logical identity uniqueness mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agentmail_approved_logical_sends' AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
    AND i.indnkeyatts=4 AND NOT (0=ANY(i.indkey::smallint[]))
    AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','authority_type','authority_id','approved_payload_version']::text[])
  THEN RAISE EXCEPTION 'agentmail approved authority version uniqueness mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class ft ON ft.oid=c.confrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND t.relname='agentmail_approved_logical_sends'
    AND c.contype='f' AND ft.relname='agent_mail_reply_queue' AND c.confdeltype='r' AND c.confupdtype='r'
    AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','authority_id']::text[])
  THEN RAISE EXCEPTION 'agentmail approved tenant authority foreign key mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class ft ON ft.oid=c.confrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND t.relname='agentmail_approved_send_attempts'
    AND c.contype='f' AND ft.relname='agentmail_approved_logical_sends' AND c.confdeltype='r' AND c.confupdtype='r'
    AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['logical_send_row_id']::text[])
  THEN RAISE EXCEPTION 'agentmail approved attempt foreign key mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agentmail_approved_logical_sends' AND c.contype='c'
      AND c.conname='agentmail_approved_logical_sends_identity_check')
  THEN RAISE EXCEPTION 'agentmail approved logical lifecycle check missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agentmail_approved_send_attempts' AND c.contype='c'
      AND c.conname='agentmail_approved_send_attempts_contract_check')
  THEN RAISE EXCEPTION 'agentmail approved attempt lifecycle check missing'; END IF;
END $$;
