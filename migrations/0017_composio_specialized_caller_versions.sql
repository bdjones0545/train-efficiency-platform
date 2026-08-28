-- Formal persistence for the four approval-gated specialized Composio callers.
-- Historical Calendar rows are intentionally left unversioned because the old
-- executor reconstructed (and sometimes dropped) approved payload fields.

ALTER TYPE software_improvement_status ADD VALUE IF NOT EXISTS 'github_issue_execution_in_progress';

CREATE TABLE IF NOT EXISTS composio_gmail_draft_requests (
  id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id VARCHAR(256) NOT NULL, agent_id VARCHAR(128) NOT NULL,
  recipient_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  purpose TEXT NOT NULL, risk_level VARCHAR(32) NOT NULL DEFAULT 'medium',
  approval_queue_id VARCHAR(128), gmail_draft_id TEXT,
  status VARCHAR(64) NOT NULL DEFAULT 'draft_queued', error_message TEXT,
  metadata JSONB, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS composio_slack_alert_requests (
  id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id VARCHAR(256) NOT NULL, agent_id VARCHAR(128) NOT NULL,
  channel VARCHAR(256) NOT NULL, alert_type VARCHAR(128) NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'high', message TEXT NOT NULL,
  purpose TEXT NOT NULL, risk_level VARCHAR(32) NOT NULL DEFAULT 'high',
  approval_queue_id VARCHAR(128), slack_message_id TEXT, slack_channel_id TEXT,
  status VARCHAR(64) NOT NULL DEFAULT 'alert_queued', error_message TEXT,
  metadata JSONB, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS composio_calendar_requests (
  id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id VARCHAR(256) NOT NULL, agent_id VARCHAR(128) NOT NULL,
  action_type VARCHAR(64) NOT NULL, title TEXT, description TEXT, location TEXT,
  start_datetime TEXT, end_datetime TEXT, timezone VARCHAR(128), attendees JSONB,
  calendar_id VARCHAR(256) DEFAULT 'primary', event_id TEXT, google_event_id TEXT,
  purpose TEXT NOT NULL, risk_level VARCHAR(32) NOT NULL DEFAULT 'medium',
  approval_queue_id VARCHAR(128), status VARCHAR(64) NOT NULL DEFAULT 'event_queued',
  approved_by TEXT, approved_at TIMESTAMP, executed_at TIMESTAMP,
  rejected_reason TEXT, error_message TEXT, payload JSONB, metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);

-- These tables were formerly runtime-created. Refuse to layer formal version
-- authority onto a same-name table whose complete legacy contract is drifted.
DO $$
DECLARE r RECORD; actual RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('composio_gmail_draft_requests','id','character varying(128)',true),
    ('composio_gmail_draft_requests','org_id','character varying(256)',true),
    ('composio_gmail_draft_requests','agent_id','character varying(128)',true),
    ('composio_gmail_draft_requests','recipient_email','text',true),
    ('composio_gmail_draft_requests','subject','text',true),('composio_gmail_draft_requests','body','text',true),
    ('composio_gmail_draft_requests','purpose','text',true),('composio_gmail_draft_requests','risk_level','character varying(32)',true),
    ('composio_gmail_draft_requests','approval_queue_id','character varying(128)',false),('composio_gmail_draft_requests','gmail_draft_id','text',false),
    ('composio_gmail_draft_requests','status','character varying(64)',true),('composio_gmail_draft_requests','error_message','text',false),
    ('composio_gmail_draft_requests','metadata','jsonb',false),('composio_gmail_draft_requests','created_at','timestamp without time zone',false),
    ('composio_gmail_draft_requests','updated_at','timestamp without time zone',false),
    ('composio_slack_alert_requests','id','character varying(128)',true),('composio_slack_alert_requests','org_id','character varying(256)',true),
    ('composio_slack_alert_requests','agent_id','character varying(128)',true),('composio_slack_alert_requests','channel','character varying(256)',true),
    ('composio_slack_alert_requests','alert_type','character varying(128)',true),('composio_slack_alert_requests','severity','character varying(32)',true),
    ('composio_slack_alert_requests','message','text',true),('composio_slack_alert_requests','purpose','text',true),
    ('composio_slack_alert_requests','risk_level','character varying(32)',true),('composio_slack_alert_requests','approval_queue_id','character varying(128)',false),
    ('composio_slack_alert_requests','slack_message_id','text',false),('composio_slack_alert_requests','slack_channel_id','text',false),
    ('composio_slack_alert_requests','status','character varying(64)',true),('composio_slack_alert_requests','error_message','text',false),
    ('composio_slack_alert_requests','metadata','jsonb',false),('composio_slack_alert_requests','created_at','timestamp without time zone',false),
    ('composio_slack_alert_requests','updated_at','timestamp without time zone',false),
    ('composio_calendar_requests','id','character varying(128)',true),('composio_calendar_requests','org_id','character varying(256)',true),
    ('composio_calendar_requests','agent_id','character varying(128)',true),('composio_calendar_requests','action_type','character varying(64)',true),
    ('composio_calendar_requests','title','text',false),('composio_calendar_requests','description','text',false),
    ('composio_calendar_requests','location','text',false),('composio_calendar_requests','start_datetime','text',false),
    ('composio_calendar_requests','end_datetime','text',false),('composio_calendar_requests','timezone','character varying(128)',false),
    ('composio_calendar_requests','attendees','jsonb',false),('composio_calendar_requests','calendar_id','character varying(256)',false),
    ('composio_calendar_requests','event_id','text',false),('composio_calendar_requests','google_event_id','text',false),
    ('composio_calendar_requests','purpose','text',true),('composio_calendar_requests','risk_level','character varying(32)',true),
    ('composio_calendar_requests','approval_queue_id','character varying(128)',false),('composio_calendar_requests','status','character varying(64)',true),
    ('composio_calendar_requests','approved_by','text',false),('composio_calendar_requests','approved_at','timestamp without time zone',false),
    ('composio_calendar_requests','executed_at','timestamp without time zone',false),('composio_calendar_requests','rejected_reason','text',false),
    ('composio_calendar_requests','error_message','text',false),('composio_calendar_requests','payload','jsonb',false),
    ('composio_calendar_requests','metadata','jsonb',false),('composio_calendar_requests','created_at','timestamp without time zone',false),
    ('composio_calendar_requests','updated_at','timestamp without time zone',false),
    ('software_improvement_tasks','github_issue_url','character varying(512)',false),
    ('software_improvement_tasks','github_approval_queue_id','character varying(256)',false),
    ('software_improvement_tasks','github_issue_draft','jsonb',false)
  ) AS expected(table_name,column_name,canonical_type,is_not_null)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
    WHERE n.nspname=current_schema() AND t.relname=r.table_name AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND OR actual.format_type<>r.canonical_type OR actual.attnotnull<>r.is_not_null THEN
      RAISE EXCEPTION 'specialized Composio legacy contract mismatch %.%',r.table_name,r.column_name;
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['composio_gmail_draft_requests','composio_slack_alert_requests','composio_calendar_requests']) table_name
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname=r.table_name AND c.contype='p'
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['id']::text[])
    THEN RAISE EXCEPTION 'specialized Composio primary key mismatch %',r.table_name; END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('composio_gmail_draft_requests','id','gen_random_uuid()::text'),
    ('composio_gmail_draft_requests','risk_level','medium'),
    ('composio_gmail_draft_requests','status','draft_queued'),
    ('composio_gmail_draft_requests','created_at','now()'),('composio_gmail_draft_requests','updated_at','now()'),
    ('composio_slack_alert_requests','id','gen_random_uuid()::text'),
    ('composio_slack_alert_requests','severity','high'),('composio_slack_alert_requests','risk_level','high'),
    ('composio_slack_alert_requests','status','alert_queued'),
    ('composio_slack_alert_requests','created_at','now()'),('composio_slack_alert_requests','updated_at','now()'),
    ('composio_calendar_requests','id','gen_random_uuid()::text'),
    ('composio_calendar_requests','calendar_id','primary'),('composio_calendar_requests','risk_level','medium'),
    ('composio_calendar_requests','status','event_queued'),
    ('composio_calendar_requests','created_at','now()'),('composio_calendar_requests','updated_at','now()')
  ) expected(table_name,column_name,expected_default)
  LOOP
    SELECT regexp_replace(lower(pg_get_expr(d.adbin,d.adrelid)),'[[:space:]()''":]','','g') default_value INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname=r.table_name;
    IF NOT FOUND OR actual.default_value NOT LIKE '%'||regexp_replace(lower(r.expected_default),'[[:space:]()''":]','','g')||'%' THEN
      RAISE EXCEPTION 'specialized Composio default mismatch %.%',r.table_name,r.column_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
    JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname IN
      ('composio_gmail_draft_requests','composio_slack_alert_requests','composio_calendar_requests')
      AND (t.relname,a.attname) NOT IN (
        ('composio_gmail_draft_requests','id'),('composio_gmail_draft_requests','risk_level'),('composio_gmail_draft_requests','status'),
        ('composio_gmail_draft_requests','created_at'),('composio_gmail_draft_requests','updated_at'),
        ('composio_slack_alert_requests','id'),('composio_slack_alert_requests','severity'),('composio_slack_alert_requests','risk_level'),
        ('composio_slack_alert_requests','status'),('composio_slack_alert_requests','created_at'),('composio_slack_alert_requests','updated_at'),
        ('composio_calendar_requests','id'),('composio_calendar_requests','calendar_id'),('composio_calendar_requests','risk_level'),
        ('composio_calendar_requests','status'),('composio_calendar_requests','created_at'),('composio_calendar_requests','updated_at')
      ))
  THEN RAISE EXCEPTION 'specialized Composio unexpected legacy default'; END IF;
END $$;

ALTER TABLE composio_gmail_draft_requests
  ADD COLUMN IF NOT EXISTS provider_action_version BIGINT,
  ADD COLUMN IF NOT EXISTS approved_provider_action_version BIGINT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approved_connected_account_id TEXT;
ALTER TABLE composio_slack_alert_requests
  ADD COLUMN IF NOT EXISTS provider_action_version BIGINT,
  ADD COLUMN IF NOT EXISTS approved_provider_action_version BIGINT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approved_connected_account_id TEXT;
ALTER TABLE composio_calendar_requests
  ADD COLUMN IF NOT EXISTS provider_action_version BIGINT,
  ADD COLUMN IF NOT EXISTS approved_provider_action_version BIGINT,
  ADD COLUMN IF NOT EXISTS approved_connected_account_id TEXT;
ALTER TABLE software_improvement_tasks
  ADD COLUMN IF NOT EXISTS github_provider_action_version BIGINT,
  ADD COLUMN IF NOT EXISTS github_approved_provider_action_version BIGINT,
  ADD COLUMN IF NOT EXISTS github_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS github_approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS github_approved_connected_account_id TEXT;

-- Gmail and Slack payload snapshots have always been insert-only.
UPDATE composio_gmail_draft_requests SET provider_action_version=1 WHERE provider_action_version IS NULL;
UPDATE composio_slack_alert_requests SET provider_action_version=1 WHERE provider_action_version IS NULL;
-- Only structurally valid immutable GitHub drafts receive canonical authority.
UPDATE software_improvement_tasks SET github_provider_action_version=1
WHERE github_provider_action_version IS NULL AND github_issue_draft IS NOT NULL
  AND jsonb_typeof(github_issue_draft)='object'
  AND jsonb_typeof(github_issue_draft->'title')='string'
  AND btrim(github_issue_draft->>'title')<>''
  AND jsonb_typeof(github_issue_draft->'body')='string'
  AND jsonb_typeof(github_issue_draft->'labels')='array';

ALTER TABLE composio_gmail_draft_requests ALTER COLUMN provider_action_version SET NOT NULL;
ALTER TABLE composio_slack_alert_requests ALTER COLUMN provider_action_version SET NOT NULL;

ALTER TABLE composio_gmail_draft_requests DROP CONSTRAINT IF EXISTS composio_gmail_version_check;
ALTER TABLE composio_gmail_draft_requests ADD CONSTRAINT composio_gmail_version_check CHECK
  (provider_action_version BETWEEN 1 AND 9007199254740991 AND
   (approved_provider_action_version IS NULL OR
    (approved_provider_action_version=provider_action_version AND approved_by IS NOT NULL AND
     approved_at IS NOT NULL AND approved_connected_account_id IS NOT NULL)));
ALTER TABLE composio_slack_alert_requests DROP CONSTRAINT IF EXISTS composio_slack_version_check;
ALTER TABLE composio_slack_alert_requests ADD CONSTRAINT composio_slack_version_check CHECK
  (provider_action_version BETWEEN 1 AND 9007199254740991 AND
   (approved_provider_action_version IS NULL OR
    (approved_provider_action_version=provider_action_version AND approved_by IS NOT NULL AND
     approved_at IS NOT NULL AND approved_connected_account_id IS NOT NULL)));
ALTER TABLE composio_calendar_requests DROP CONSTRAINT IF EXISTS composio_calendar_version_check;
ALTER TABLE composio_calendar_requests ADD CONSTRAINT composio_calendar_version_check CHECK
  (provider_action_version IS NULL OR provider_action_version BETWEEN 1 AND 9007199254740991);
ALTER TABLE composio_calendar_requests DROP CONSTRAINT IF EXISTS composio_calendar_approval_version_check;
ALTER TABLE composio_calendar_requests ADD CONSTRAINT composio_calendar_approval_version_check CHECK
  (approved_provider_action_version IS NULL OR
   (approved_provider_action_version=provider_action_version AND approved_by IS NOT NULL AND
    approved_at IS NOT NULL AND approved_connected_account_id IS NOT NULL));
ALTER TABLE software_improvement_tasks DROP CONSTRAINT IF EXISTS software_improvement_github_version_check;
ALTER TABLE software_improvement_tasks ADD CONSTRAINT software_improvement_github_version_check CHECK
  (github_provider_action_version IS NULL OR github_provider_action_version BETWEEN 1 AND 9007199254740991);
ALTER TABLE software_improvement_tasks DROP CONSTRAINT IF EXISTS software_improvement_github_approval_version_check;
ALTER TABLE software_improvement_tasks ADD CONSTRAINT software_improvement_github_approval_version_check CHECK
  (github_approved_provider_action_version IS NULL OR
   (github_approved_provider_action_version=github_provider_action_version AND github_approved_by IS NOT NULL AND
    github_approved_at IS NOT NULL AND github_approved_connected_account_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS composio_gmail_requests_org_status_idx ON composio_gmail_draft_requests(org_id,status);
CREATE INDEX IF NOT EXISTS composio_slack_requests_org_status_idx ON composio_slack_alert_requests(org_id,status);
CREATE INDEX IF NOT EXISTS composio_calendar_requests_org_status_idx ON composio_calendar_requests(org_id,status);

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('composio_gmail_draft_requests','composio_gmail_requests_org_status_idx'),
    ('composio_slack_alert_requests','composio_slack_requests_org_status_idx'),
    ('composio_calendar_requests','composio_calendar_requests_org_status_idx')
  ) expected(table_name,index_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
      JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname=r.table_name AND idx.relname=r.index_name
        AND NOT i.indisunique AND i.indisvalid AND i.indnkeyatts=2 AND i.indnatts=2
        AND i.indexprs IS NULL AND i.indpred IS NULL
        AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
          JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','status']::text[])
    THEN RAISE EXCEPTION 'specialized Composio index mismatch %',r.index_name; END IF;
  END LOOP;
END $$;
