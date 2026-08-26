-- Formal ownership for Cross-Agent Coordination canonical state and history.
CREATE OR REPLACE FUNCTION cross_agent_coordination_has_distinct_agents(agents TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS 'SELECT pg_catalog.cardinality(agents) = (SELECT pg_catalog.count(DISTINCT agent) FROM pg_catalog.unnest(agents) AS agent)';

CREATE TABLE IF NOT EXISTS agent_action_registry (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  gmail_thread_id TEXT,
  source_conversation_id TEXT,
  prospect_id TEXT,
  lead_id TEXT,
  canonical_resource_type TEXT,
  canonical_resource_id TEXT,
  coordination_generation TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  support_score INTEGER DEFAULT 0,
  source_agents TEXT[] DEFAULT ARRAY[]::TEXT[],
  last_agent TEXT,
  source_action_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coordination_decisions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  gmail_thread_id TEXT,
  source_conversation_id TEXT,
  prospect_id TEXT,
  lead_id TEXT,
  canonical_resource_type TEXT,
  canonical_resource_id TEXT,
  coordination_generation TEXT,
  registry_id TEXT,
  decision TEXT NOT NULL,
  original_action_id TEXT,
  merged_action_id TEXT,
  support_score INTEGER DEFAULT 1,
  requesting_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add only the new contract fields when adopting the exact legacy runtime shape.
ALTER TABLE agent_action_registry ADD COLUMN IF NOT EXISTS canonical_resource_type TEXT;
ALTER TABLE agent_action_registry ADD COLUMN IF NOT EXISTS canonical_resource_id TEXT;
ALTER TABLE agent_action_registry ADD COLUMN IF NOT EXISTS coordination_generation TEXT;
ALTER TABLE coordination_decisions ADD COLUMN IF NOT EXISTS canonical_resource_type TEXT;
ALTER TABLE coordination_decisions ADD COLUMN IF NOT EXISTS canonical_resource_id TEXT;
ALTER TABLE coordination_decisions ADD COLUMN IF NOT EXISTS coordination_generation TEXT;
ALTER TABLE coordination_decisions ADD COLUMN IF NOT EXISTS registry_id TEXT;

-- Null arrays are not evidence. Normalizing them to the empty set is safe for
-- both active and resolved rows, but no identity or generation is synthesized.
UPDATE agent_action_registry SET source_agents=ARRAY[]::TEXT[] WHERE source_agents IS NULL;
ALTER TABLE agent_action_registry ALTER COLUMN source_agents SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE agent_action_registry ALTER COLUMN support_score SET DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM agent_action_registry WHERE status='active' AND (
      btrim(org_id)='' OR lower(btrim(org_id))='default' OR btrim(action_type)='' OR
      canonical_resource_type IS NULL OR btrim(canonical_resource_type)='' OR
      canonical_resource_id IS NULL OR btrim(canonical_resource_id)='' OR
      coordination_generation IS NULL OR btrim(coordination_generation)='' OR
      canonical_resource_type NOT IN ('prospect','lead','gmail_thread') OR
      source_agents IS NULL OR support_score IS NULL OR support_score<1 OR
      support_score<>cardinality(source_agents) OR
      NOT cross_agent_coordination_has_distinct_agents(source_agents)
    )
  ) THEN
    RAISE EXCEPTION 'active agent_action_registry rows require an approved canonical resource, generation, and distinct-agent support repair';
  END IF;

  IF EXISTS (
    SELECT 1 FROM agent_action_registry WHERE status='active'
    GROUP BY org_id,action_type,canonical_resource_type,canonical_resource_id,coordination_generation
    HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'duplicate active Cross-Agent Coordination identities require explicit repair';
  END IF;
END $$;

ALTER TABLE agent_action_registry DROP CONSTRAINT IF EXISTS agent_action_registry_active_identity_check;
ALTER TABLE agent_action_registry ADD CONSTRAINT agent_action_registry_active_identity_check CHECK (
  status<>'active' OR (
    btrim(org_id)<>'' AND lower(btrim(org_id))<>'default' AND btrim(action_type)<>'' AND
    canonical_resource_type IN ('prospect','lead','gmail_thread') AND
    canonical_resource_id IS NOT NULL AND btrim(canonical_resource_id)<>'' AND
    coordination_generation IS NOT NULL AND btrim(coordination_generation)<>'' AND
    source_agents IS NOT NULL AND support_score IS NOT NULL AND support_score>0 AND
    support_score=cardinality(source_agents) AND
    cross_agent_coordination_has_distinct_agents(source_agents)
  )
);

CREATE INDEX IF NOT EXISTS idx_aar_org_type ON agent_action_registry(org_id,action_type);
CREATE INDEX IF NOT EXISTS idx_aar_thread ON agent_action_registry(gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_aar_prospect ON agent_action_registry(prospect_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aar_active_canonical_identity
  ON agent_action_registry(org_id,action_type,canonical_resource_type,canonical_resource_id,coordination_generation)
  WHERE status='active';

CREATE INDEX IF NOT EXISTS idx_coord_org ON coordination_decisions(org_id);
CREATE INDEX IF NOT EXISTS idx_coord_thread ON coordination_decisions(gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_coord_prospect ON coordination_decisions(prospect_id);
CREATE INDEX IF NOT EXISTS idx_coord_type ON coordination_decisions(action_type);
CREATE INDEX IF NOT EXISTS idx_coord_registry ON coordination_decisions(registry_id);

-- Validate full migration ownership rather than accepting same-name drift.
DO $$
DECLARE r RECORD; actual RECORD; normalized_default TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('id','text',true,'gen_random_uuid()'),('org_id','text',true,NULL),('action_type','text',true,NULL),
    ('gmail_thread_id','text',false,NULL),('source_conversation_id','text',false,NULL),
    ('prospect_id','text',false,NULL),('lead_id','text',false,NULL),
    ('canonical_resource_type','text',false,NULL),('canonical_resource_id','text',false,NULL),
    ('coordination_generation','text',false,NULL),('status','text',true,'''active'''),
    ('support_score','integer',false,'0'),('source_agents','text[]',false,'array[]'),
    ('last_agent','text',false,NULL),('source_action_id','text',false,NULL),
    ('created_at','timestamp with time zone',false,'now()'),('updated_at','timestamp with time zone',false,'now()')
  ) AS expected(column_name,canonical_type,is_not_null,expected_default)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid) INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname='agent_action_registry' AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing column agent_action_registry.%',r.column_name; END IF;
    normalized_default := CASE WHEN actual.pg_get_expr IS NULL THEN NULL ELSE regexp_replace(regexp_replace(lower(actual.pg_get_expr),'\s+','','g'),'::(text\[\]|text|jsonb|timestampwithtimezone)','','g') END;
    normalized_default := regexp_replace(normalized_default,'^\((.*)\)$','\1');
    IF actual.format_type<>r.canonical_type OR actual.attnotnull<>r.is_not_null OR normalized_default IS DISTINCT FROM r.expected_default
      THEN RAISE EXCEPTION 'agent_action_registry.% contract mismatch',r.column_name; END IF;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('id','text',true,'gen_random_uuid()'),('org_id','text',true,NULL),('action_type','text',true,NULL),
    ('gmail_thread_id','text',false,NULL),('source_conversation_id','text',false,NULL),('prospect_id','text',false,NULL),('lead_id','text',false,NULL),
    ('canonical_resource_type','text',false,NULL),('canonical_resource_id','text',false,NULL),('coordination_generation','text',false,NULL),
    ('registry_id','text',false,NULL),('decision','text',true,NULL),('original_action_id','text',false,NULL),('merged_action_id','text',false,NULL),
    ('support_score','integer',false,'1'),('requesting_agent','text',false,NULL),('metadata','jsonb',false,NULL),
    ('created_at','timestamp with time zone',false,'now()')
  ) AS expected(column_name,canonical_type,is_not_null,expected_default)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid) INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname='coordination_decisions' AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing column coordination_decisions.%',r.column_name; END IF;
    normalized_default := CASE WHEN actual.pg_get_expr IS NULL THEN NULL ELSE regexp_replace(regexp_replace(lower(actual.pg_get_expr),'\s+','','g'),'::(text\[\]|text|jsonb|timestampwithtimezone)','','g') END;
    normalized_default := regexp_replace(normalized_default,'^\((.*)\)$','\1');
    IF actual.format_type<>r.canonical_type OR actual.attnotnull<>r.is_not_null OR normalized_default IS DISTINCT FROM r.expected_default
      THEN RAISE EXCEPTION 'coordination_decisions.% contract mismatch',r.column_name; END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agent_action_registry' AND c.contype='p' AND
      (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
       JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['id']::text[])
    THEN RAISE EXCEPTION 'agent_action_registry PRIMARY KEY mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='coordination_decisions' AND c.contype='p' AND
      (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
       JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['id']::text[])
    THEN RAISE EXCEPTION 'coordination_decisions PRIMARY KEY mismatch'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agent_action_registry' AND i.indisunique AND i.indisvalid
      AND regexp_replace(regexp_replace(pg_get_expr(i.indpred,i.indrelid),'::text','','g'),'[()[:space:]]','','g') IN ('status=''active''','''active''=status')
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
       JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','action_type','canonical_resource_type','canonical_resource_id','coordination_generation']::text[])
    THEN RAISE EXCEPTION 'active canonical identity unique index mismatch'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='agent_action_registry' AND c.contype='c'
      AND c.conname='agent_action_registry_active_identity_check')
    THEN RAISE EXCEPTION 'active identity check constraint missing'; END IF;

  SELECT lower(regexp_replace(regexp_replace(pg_get_constraintdef(c.oid),'::text','','g'),'[()[:space:]]','','g')) definition INTO actual
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname=current_schema() AND t.relname='agent_action_registry'
    AND c.conname='agent_action_registry_active_identity_check' AND c.contype='c';
  IF actual.definition NOT LIKE '%status<>''active''%' OR actual.definition NOT LIKE '%canonical_resource_type%'
    OR actual.definition NOT LIKE '%canonical_resource_id%' OR actual.definition NOT LIKE '%coordination_generation%'
    OR actual.definition NOT LIKE '%support_score=cardinalitysource_agents%'
    OR actual.definition NOT LIKE '%cross_agent_coordination_has_distinct_agentssource_agents%'
    OR actual.definition NOT LIKE '%''default''%'
    THEN RAISE EXCEPTION 'active identity check constraint mismatch'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=current_schema() AND p.proname='cross_agent_coordination_has_distinct_agents'
      AND pg_get_function_identity_arguments(p.oid)='agents text[]' AND pg_get_function_result(p.oid)='boolean'
      AND l.lanname='sql' AND p.provolatile='i' AND p.proisstrict AND NOT p.prosecdef AND p.proparallel='s'
      AND regexp_replace(lower(p.prosrc),'[[:space:]]','','g')=
        'selectpg_catalog.cardinality(agents)=(selectpg_catalog.count(distinctagent)frompg_catalog.unnest(agents)asagent)'
  ) THEN RAISE EXCEPTION 'Cross-Agent Coordination distinct-agent function mismatch'; END IF;

  FOR r IN SELECT * FROM (VALUES
    ('agent_action_registry',ARRAY['org_id','action_type']::text[]),
    ('agent_action_registry',ARRAY['gmail_thread_id']::text[]),
    ('agent_action_registry',ARRAY['prospect_id']::text[]),
    ('coordination_decisions',ARRAY['org_id']::text[]),
    ('coordination_decisions',ARRAY['gmail_thread_id']::text[]),
    ('coordination_decisions',ARRAY['prospect_id']::text[]),
    ('coordination_decisions',ARRAY['action_type']::text[]),
    ('coordination_decisions',ARRAY['registry_id']::text[])
  ) AS expected(table_name,columns)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname=r.table_name AND NOT i.indisprimary AND NOT i.indisunique
        AND i.indisvalid AND i.indpred IS NULL
        AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
          JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=r.columns)
      THEN RAISE EXCEPTION '%.% required index mismatch',r.table_name,r.columns; END IF;
  END LOOP;
END $$;
