CREATE TABLE IF NOT EXISTS composio_connected_account_ownership (
  connected_account_id TEXT PRIMARY KEY,
  toolkit TEXT NOT NULL,
  ownership_class TEXT NOT NULL,
  org_id VARCHAR(256),
  provider_entity_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  authorized_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT composio_connected_account_ownership_contract_check CHECK (
    btrim(connected_account_id) <> '' AND
    toolkit IN ('gmail','googlecalendar','slack','googlesheets','github','stripe') AND
    ownership_class IN ('organization','platform') AND
    ((ownership_class='organization' AND org_id IS NOT NULL AND btrim(org_id)<>'') OR
     (ownership_class='platform' AND org_id IS NULL))
  ),
  CONSTRAINT composio_connected_account_ownership_org_fk
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS composio_connected_account_ownership_org_toolkit_idx
  ON composio_connected_account_ownership(org_id,toolkit) WHERE active AND ownership_class='organization';

CREATE TABLE IF NOT EXISTS composio_platform_account_authorizations (
  org_id VARCHAR(256) NOT NULL,
  connected_account_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  authorized_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id,connected_account_id),
  CONSTRAINT composio_platform_account_authorizations_org_fk
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT composio_platform_account_authorizations_account_fk
    FOREIGN KEY (connected_account_id) REFERENCES composio_connected_account_ownership(connected_account_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS composio_platform_account_authorizations_account_idx
  ON composio_platform_account_authorizations(connected_account_id) WHERE active;

-- Fail closed if same-name objects are structurally incompatible.
DO $$
DECLARE r RECORD; actual RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('composio_connected_account_ownership','connected_account_id','text',true),
    ('composio_connected_account_ownership','toolkit','text',true),
    ('composio_connected_account_ownership','ownership_class','text',true),
    ('composio_connected_account_ownership','org_id','character varying(256)',false),
    ('composio_connected_account_ownership','provider_entity_id','text',false),
    ('composio_connected_account_ownership','active','boolean',true),
    ('composio_connected_account_ownership','authorized_by','text',false),
    ('composio_connected_account_ownership','created_at','timestamp with time zone',true),
    ('composio_connected_account_ownership','updated_at','timestamp with time zone',true),
    ('composio_platform_account_authorizations','org_id','character varying(256)',true),
    ('composio_platform_account_authorizations','connected_account_id','text',true),
    ('composio_platform_account_authorizations','active','boolean',true),
    ('composio_platform_account_authorizations','authorized_by','text',false),
    ('composio_platform_account_authorizations','created_at','timestamp with time zone',true),
    ('composio_platform_account_authorizations','updated_at','timestamp with time zone',true)
  ) AS expected(table_name,column_name,canonical_type,is_not_null)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
    WHERE n.nspname=current_schema() AND t.relname=r.table_name AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND OR actual.format_type<>r.canonical_type OR actual.attnotnull<>r.is_not_null THEN
      RAISE EXCEPTION '%.% contract mismatch',r.table_name,r.column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='composio_connected_account_ownership' AND c.contype='p'
    AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['connected_account_id']::text[])
  THEN RAISE EXCEPTION 'Composio ownership primary key mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='composio_platform_account_authorizations' AND c.contype='p'
    AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','connected_account_id']::text[])
  THEN RAISE EXCEPTION 'Composio platform authorization primary key mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='composio_connected_account_ownership'
      AND c.conname='composio_connected_account_ownership_contract_check' AND c.contype='c'
      AND regexp_replace(lower(pg_get_constraintdef(c.oid,true)),'[[:space:]()''":]','','g')=
        regexp_replace(lower('CHECK (btrim(connected_account_id) <> ''''::text AND (toolkit = ANY (ARRAY[''gmail''::text, ''googlecalendar''::text, ''slack''::text, ''googlesheets''::text, ''github''::text, ''stripe''::text])) AND (ownership_class = ANY (ARRAY[''organization''::text, ''platform''::text])) AND (ownership_class = ''organization''::text AND org_id IS NOT NULL AND btrim(org_id::text) <> ''''::text OR ownership_class = ''platform''::text AND org_id IS NULL))'),'[[:space:]()''":]','','g'))
  THEN RAISE EXCEPTION 'Composio ownership contract check mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
    JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='composio_connected_account_ownership'
      AND idx.relname='composio_connected_account_ownership_org_toolkit_idx' AND NOT i.indisunique AND i.indisvalid
      AND i.indnkeyatts=2 AND i.indnatts=2 AND i.indexprs IS NULL
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','toolkit']::text[]
      AND regexp_replace(lower(pg_get_expr(i.indpred,i.indrelid)),'[[:space:]()''":]','','g')=
        regexp_replace(lower('active AND ownership_class = ''organization''::text'),'[[:space:]()''":]','','g'))
  THEN RAISE EXCEPTION 'Composio ownership organization/toolkit index mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
    JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='composio_platform_account_authorizations'
      AND idx.relname='composio_platform_account_authorizations_account_idx' AND NOT i.indisunique AND i.indisvalid
      AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indexprs IS NULL
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['connected_account_id']::text[]
      AND regexp_replace(lower(pg_get_expr(i.indpred,i.indrelid)),'[[:space:]()]','','g')='active')
  THEN RAISE EXCEPTION 'Composio platform authorization index mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='composio_connected_account_ownership' AND i.indisunique
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','toolkit']::text[])
  THEN RAISE EXCEPTION 'Composio ownership forbids unique organization/toolkit'; END IF;
  FOR r IN SELECT * FROM (VALUES
    ('composio_connected_account_ownership','connected_account_id',NULL),
    ('composio_connected_account_ownership','toolkit',NULL),
    ('composio_connected_account_ownership','ownership_class',NULL),
    ('composio_connected_account_ownership','org_id',NULL),
    ('composio_connected_account_ownership','provider_entity_id',NULL),
    ('composio_connected_account_ownership','active','true'),
    ('composio_connected_account_ownership','authorized_by',NULL),
    ('composio_connected_account_ownership','created_at','now()'),
    ('composio_connected_account_ownership','updated_at','now()'),
    ('composio_platform_account_authorizations','org_id',NULL),
    ('composio_platform_account_authorizations','connected_account_id',NULL),
    ('composio_platform_account_authorizations','active','true'),
    ('composio_platform_account_authorizations','authorized_by',NULL),
    ('composio_platform_account_authorizations','created_at','now()'),
    ('composio_platform_account_authorizations','updated_at','now()')
  ) AS expected(table_name,column_name,default_expression)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
      LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
      WHERE n.nspname=current_schema() AND t.relname=r.table_name
        AND CASE WHEN r.default_expression IS NULL THEN d.oid IS NULL ELSE
          regexp_replace(lower(pg_get_expr(d.adbin,d.adrelid)),'[[:space:]()]','','g')=
          regexp_replace(lower(r.default_expression),'[[:space:]()]','','g') END)
    THEN RAISE EXCEPTION '%.% default mismatch',r.table_name,r.column_name; END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('composio_connected_account_ownership','composio_connected_account_ownership_org_fk','FOREIGN KEY (org_id) REFERENCES organizations(id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
    ('composio_platform_account_authorizations','composio_platform_account_authorizations_org_fk','FOREIGN KEY (org_id) REFERENCES organizations(id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
    ('composio_platform_account_authorizations','composio_platform_account_authorizations_account_fk','FOREIGN KEY (connected_account_id) REFERENCES composio_connected_account_ownership(connected_account_id) ON UPDATE RESTRICT ON DELETE RESTRICT')
  ) AS expected(table_name,constraint_name,definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname=r.table_name AND c.conname=r.constraint_name
        AND c.contype='f' AND regexp_replace(lower(pg_get_constraintdef(c.oid,true)),'[[:space:]()''":]','','g')=
          regexp_replace(lower(r.definition),'[[:space:]()''":]','','g'))
    THEN RAISE EXCEPTION '%.% foreign key mismatch',r.table_name,r.constraint_name; END IF;
  END LOOP;
END $$;
