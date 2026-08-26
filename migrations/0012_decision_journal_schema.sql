-- Formal ownership for the optional Decision Journal feature.
CREATE TABLE IF NOT EXISTS decision_journal_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source TEXT NOT NULL,
  decision TEXT NOT NULL,
  reasoning TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  follow_up TEXT NOT NULL DEFAULT '',
  confidence INTEGER NOT NULL DEFAULT 75,
  decision_type TEXT NOT NULL DEFAULT 'action',
  department TEXT NOT NULL DEFAULT 'Operations',
  related_entity_type TEXT,
  related_entity_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_journal_org_id ON decision_journal_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_decision_journal_source_type ON decision_journal_entries(source_type);
CREATE INDEX IF NOT EXISTS idx_decision_journal_agent ON decision_journal_entries(agent);
CREATE INDEX IF NOT EXISTS idx_decision_journal_created_at ON decision_journal_entries(created_at DESC);

-- Existing org_id='default' rows are deliberately preserved. Their ownership is
-- ambiguous and requires an explicit data policy; runtime code cannot create new ones.
DO $$
DECLARE r RECORD; actual RECORD; normalized_default TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('id','text',true,'(gen_random_uuid())'),
    ('org_id','text',true,NULL),('agent','text',true,NULL),
    ('source_type','text',true,NULL),('source','text',true,NULL),('decision','text',true,NULL),
    ('reasoning','text',true,''''''),('outcome','text',true,''''''),('follow_up','text',true,''''''),
    ('confidence','integer',true,'75'),('decision_type','text',true,'''action'''),
    ('department','text',true,'''operations'''),
    ('related_entity_type','text',false,NULL),('related_entity_id','text',false,NULL),
    ('metadata','jsonb',false,'''{}'''),
    ('created_at','timestamp with time zone',true,'now()'),
    ('updated_at','timestamp with time zone',true,'now()')
  ) AS expected(column_name,canonical_type,is_not_null,expected_default)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod) canonical_type,a.attnotnull is_not_null,
      pg_get_expr(d.adbin,d.adrelid) column_default INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname='decision_journal_entries' AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing column decision_journal_entries.%',r.column_name; END IF;
    normalized_default := CASE WHEN actual.column_default IS NULL THEN NULL ELSE
      regexp_replace(regexp_replace(lower(actual.column_default),'\\s+','','g'),'::(text|jsonb|integer|timestamp with time zone)','','g') END;
    IF actual.canonical_type<>r.canonical_type OR actual.is_not_null<>r.is_not_null
      OR normalized_default IS DISTINCT FROM r.expected_default THEN
      RAISE EXCEPTION 'decision_journal_entries.% contract mismatch',r.column_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='decision_journal_entries' AND c.contype='p'
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['id']::text[]
  ) THEN RAISE EXCEPTION 'decision_journal_entries PRIMARY KEY(id) contract mismatch'; END IF;

  FOR r IN SELECT * FROM (VALUES
    (ARRAY['org_id']::text[],ARRAY[false]::boolean[]),
    (ARRAY['source_type']::text[],ARRAY[false]::boolean[]),
    (ARRAY['agent']::text[],ARRAY[false]::boolean[]),
    (ARRAY['created_at']::text[],ARRAY[true]::boolean[])
  ) AS expected(columns,descending)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname='decision_journal_entries'
        AND NOT i.indisprimary AND NOT i.indisunique AND i.indisvalid AND i.indpred IS NULL
        AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
          JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=r.columns
        AND (SELECT array_agg((i.indoption[k.ordinality-1] & 1)=1 ORDER BY k.ordinality)::boolean[]
          FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality))=r.descending
    ) THEN RAISE EXCEPTION 'decision_journal_entries required index contract mismatch'; END IF;
  END LOOP;
END $$;
