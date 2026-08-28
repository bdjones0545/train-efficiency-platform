-- Formal ownership for the existing organization-scoped Agent Outcome
-- Attribution feature. Compatible runtime-created tables are adopted without
-- rewriting business data; incompatible structures fail transactionally.

CREATE TABLE IF NOT EXISTS agent_decision_outcomes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  action_taken TEXT,
  expected_outcome TEXT,
  actual_outcome TEXT,
  success_score INTEGER,
  domain TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  revenue_cents INTEGER DEFAULT 0,
  meetings_generated INTEGER DEFAULT 0,
  outcome_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_perf_scores (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  recommendations_issued INTEGER DEFAULT 0,
  recommendations_executed INTEGER DEFAULT 0,
  success_rate INTEGER DEFAULT 0,
  revenue_influenced INTEGER DEFAULT 0,
  meetings_generated INTEGER DEFAULT 0,
  retention_impact INTEGER DEFAULT 0,
  last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, agent_type)
);

CREATE TABLE IF NOT EXISTS ceo_daily_reviews (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  review_date DATE NOT NULL,
  what_worked TEXT NOT NULL,
  what_failed TEXT NOT NULL,
  what_repeat TEXT NOT NULL,
  what_stop TEXT NOT NULL,
  outcomes_analyzed INTEGER DEFAULT 0,
  ai_generated BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, review_date)
);

CREATE TABLE IF NOT EXISTS org_playbooks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_learning TEXT,
  pattern_type TEXT,
  success_rate INTEGER DEFAULT 0,
  evidence_count INTEGER DEFAULT 0,
  trigger_condition TEXT,
  actions TEXT,
  expected_outcome TEXT,
  status TEXT DEFAULT 'active',
  promoted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
DECLARE expected RECORD; actual RECORD;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('agent_decision_outcomes','id','text',true,'(gen_random_uuid())::text'),
    ('agent_decision_outcomes','org_id','text',true,NULL),
    ('agent_decision_outcomes','agent_type','text',true,NULL),
    ('agent_decision_outcomes','recommendation','text',true,NULL),
    ('agent_decision_outcomes','action_taken','text',false,NULL),
    ('agent_decision_outcomes','expected_outcome','text',false,NULL),
    ('agent_decision_outcomes','actual_outcome','text',false,NULL),
    ('agent_decision_outcomes','success_score','integer',false,NULL),
    ('agent_decision_outcomes','domain','text',false,NULL),
    ('agent_decision_outcomes','tags','jsonb',false,'''[]''::jsonb'),
    ('agent_decision_outcomes','revenue_cents','integer',false,'0'),
    ('agent_decision_outcomes','meetings_generated','integer',false,'0'),
    ('agent_decision_outcomes','outcome_date','timestamp with time zone',false,NULL),
    ('agent_decision_outcomes','created_at','timestamp with time zone',false,'now()'),
    ('agent_decision_outcomes','updated_at','timestamp with time zone',false,'now()'),
    ('agent_perf_scores','id','text',true,'(gen_random_uuid())::text'),
    ('agent_perf_scores','org_id','text',true,NULL),
    ('agent_perf_scores','agent_type','text',true,NULL),
    ('agent_perf_scores','recommendations_issued','integer',false,'0'),
    ('agent_perf_scores','recommendations_executed','integer',false,'0'),
    ('agent_perf_scores','success_rate','integer',false,'0'),
    ('agent_perf_scores','revenue_influenced','integer',false,'0'),
    ('agent_perf_scores','meetings_generated','integer',false,'0'),
    ('agent_perf_scores','retention_impact','integer',false,'0'),
    ('agent_perf_scores','last_calculated_at','timestamp with time zone',false,'now()'),
    ('ceo_daily_reviews','id','text',true,'(gen_random_uuid())::text'),
    ('ceo_daily_reviews','org_id','text',true,NULL),
    ('ceo_daily_reviews','review_date','date',true,NULL),
    ('ceo_daily_reviews','what_worked','text',true,NULL),
    ('ceo_daily_reviews','what_failed','text',true,NULL),
    ('ceo_daily_reviews','what_repeat','text',true,NULL),
    ('ceo_daily_reviews','what_stop','text',true,NULL),
    ('ceo_daily_reviews','outcomes_analyzed','integer',false,'0'),
    ('ceo_daily_reviews','ai_generated','boolean',false,'true'),
    ('ceo_daily_reviews','created_at','timestamp with time zone',false,'now()'),
    ('ceo_daily_reviews','updated_at','timestamp with time zone',false,'now()'),
    ('org_playbooks','id','text',true,'(gen_random_uuid())::text'),
    ('org_playbooks','org_id','text',true,NULL),
    ('org_playbooks','title','text',true,NULL),
    ('org_playbooks','description','text',false,NULL),
    ('org_playbooks','source_learning','text',false,NULL),
    ('org_playbooks','pattern_type','text',false,NULL),
    ('org_playbooks','success_rate','integer',false,'0'),
    ('org_playbooks','evidence_count','integer',false,'0'),
    ('org_playbooks','trigger_condition','text',false,NULL),
    ('org_playbooks','actions','text',false,NULL),
    ('org_playbooks','expected_outcome','text',false,NULL),
    ('org_playbooks','status','text',false,'''active''::text'),
    ('org_playbooks','promoted_at','timestamp with time zone',false,'now()'),
    ('org_playbooks','created_at','timestamp with time zone',false,'now()')
  ) e(table_name,column_name,canonical_type,is_not_null,canonical_default)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS is_not_null,
      pg_get_expr(d.adbin,d.adrelid) AS column_default
      INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=expected.column_name AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname=expected.table_name;
    IF NOT FOUND OR actual.data_type<>expected.canonical_type OR actual.is_not_null<>expected.is_not_null OR
      (expected.canonical_default IS NULL AND actual.column_default IS NOT NULL) OR
      (expected.canonical_default IS NOT NULL AND COALESCE(actual.column_default,'')<>expected.canonical_default)
    THEN RAISE EXCEPTION 'Agent Outcome Attribution column contract mismatch %.%',expected.table_name,expected.column_name; END IF;
  END LOOP;

  FOR expected IN SELECT unnest(ARRAY['agent_decision_outcomes','agent_perf_scores','ceo_daily_reviews','org_playbooks']) table_name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname=expected.table_name AND c.contype='p'
      AND (SELECT array_agg(a.attname ORDER BY k.ord)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['id']::text[])
    THEN RAISE EXCEPTION 'Agent Outcome Attribution primary key mismatch %',expected.table_name; END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agent_perf_scores' AND i.indisunique AND i.indisvalid
      AND i.indnkeyatts=2 AND i.indnatts=2 AND i.indexprs IS NULL AND i.indpred IS NULL
      AND (SELECT array_agg(a.attname ORDER BY k.ord)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','agent_type']::text[])
  THEN RAISE EXCEPTION 'Agent Outcome Attribution performance uniqueness mismatch'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='ceo_daily_reviews' AND i.indisunique AND i.indisvalid
      AND i.indnkeyatts=2 AND i.indnatts=2 AND i.indexprs IS NULL AND i.indpred IS NULL
      AND (SELECT array_agg(a.attname ORDER BY k.ord)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','review_date']::text[])
  THEN RAISE EXCEPTION 'Agent Outcome Attribution review uniqueness mismatch'; END IF;

  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname IN ('agent_decision_outcomes','agent_perf_scores','ceo_daily_reviews','org_playbooks')
      AND i.indisunique AND NOT i.indisprimary
      AND NOT (t.relname='agent_perf_scores' AND i.indnkeyatts=2 AND i.indnatts=2 AND i.indexprs IS NULL AND i.indpred IS NULL
        AND (SELECT array_agg(a.attname ORDER BY k.ord)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','agent_type']::text[])
      AND NOT (t.relname='ceo_daily_reviews' AND i.indnkeyatts=2 AND i.indnatts=2 AND i.indexprs IS NULL AND i.indpred IS NULL
        AND (SELECT array_agg(a.attname ORDER BY k.ord)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','review_date']::text[]))
  THEN RAISE EXCEPTION 'Agent Outcome Attribution unexpected uniqueness'; END IF;
END $$;
