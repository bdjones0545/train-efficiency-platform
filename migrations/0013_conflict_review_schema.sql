-- Formal ownership for the optional Conflict Review feature.
CREATE TABLE IF NOT EXISTS conflict_alerts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  entities TEXT[] DEFAULT ARRAY[]::TEXT[],
  agent_actions JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conflict_org ON conflict_alerts(org_id);
CREATE INDEX IF NOT EXISTS idx_conflict_status ON conflict_alerts(status);
CREATE INDEX IF NOT EXISTS idx_conflict_type ON conflict_alerts(conflict_type);

-- Rows without a trustworthy tenant remain data-policy concerns. This migration
-- neither repairs nor reassigns tenant ownership.
DO $$
DECLARE r RECORD; actual RECORD; normalized_default TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('id','text',true,'gen_random_uuid()'),
    ('org_id','text',true,NULL),('conflict_type','text',true,NULL),
    ('severity','text',true,'''medium'''),('entities','text[]',false,'array[]'),
    ('agent_actions','jsonb',false,'''[]'''),('status','text',true,'''open'''),
    ('resolution','text',false,NULL),('resolved_by','text',false,NULL),
    ('resolved_at','timestamp with time zone',false,NULL),
    ('created_at','timestamp with time zone',false,'now()')
  ) AS expected(column_name,canonical_type,is_not_null,expected_default)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod) canonical_type,a.attnotnull is_not_null,
      pg_get_expr(d.adbin,d.adrelid) column_default INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname='conflict_alerts' AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing column conflict_alerts.%',r.column_name; END IF;
    normalized_default := CASE WHEN actual.column_default IS NULL THEN NULL ELSE
      regexp_replace(regexp_replace(lower(actual.column_default),'\s+','','g'),
        '::(text\[\]|text|jsonb|timestampwithtimezone)','','g') END;
    normalized_default := regexp_replace(normalized_default,'^\((.*)\)$','\1');
    IF actual.canonical_type<>r.canonical_type OR actual.is_not_null<>r.is_not_null
      OR normalized_default IS DISTINCT FROM r.expected_default THEN
      RAISE EXCEPTION 'conflict_alerts.% contract mismatch',r.column_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='conflict_alerts' AND c.contype='p'
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['id']::text[]
  ) THEN RAISE EXCEPTION 'conflict_alerts PRIMARY KEY(id) contract mismatch'; END IF;

  FOR r IN SELECT * FROM (VALUES
    (ARRAY['org_id']::text[],ARRAY[false]::boolean[]),
    (ARRAY['status']::text[],ARRAY[false]::boolean[]),
    (ARRAY['conflict_type']::text[],ARRAY[false]::boolean[])
  ) AS expected(columns,descending)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname='conflict_alerts'
        AND NOT i.indisprimary AND NOT i.indisunique AND i.indisvalid AND i.indpred IS NULL
        AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
          JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=r.columns
        AND (SELECT array_agg((i.indoption[k.ordinality-1] & 1)=1 ORDER BY k.ordinality)::boolean[]
          FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality))=r.descending
    ) THEN RAISE EXCEPTION 'conflict_alerts required index contract mismatch'; END IF;
  END LOOP;
END $$;
