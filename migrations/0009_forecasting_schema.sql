-- Formal ownership for durable Forecasting state.
-- Runtime Forecasting paths validate this schema and never create or alter it.

CREATE TABLE IF NOT EXISTS business_forecasts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  horizon_days INTEGER NOT NULL,
  metric TEXT NOT NULL,
  current_value NUMERIC(14,2) DEFAULT 0,
  projected_value NUMERIC(14,2) DEFAULT 0,
  change_pct NUMERIC(8,2) DEFAULT 0,
  confidence INTEGER DEFAULT 0,
  variance_low NUMERIC(14,2) DEFAULT 0,
  variance_high NUMERIC(14,2) DEFAULT 0,
  supporting_factors JSONB DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  forecast_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS risk_signals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL,
  category TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
  risk_level TEXT DEFAULT 'medium', metric_name TEXT, metric_value NUMERIC(14,2),
  threshold NUMERIC(14,2), trend_pct NUMERIC(8,2), status TEXT DEFAULT 'active',
  detected_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS opportunity_signals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL,
  category TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
  impact_level TEXT DEFAULT 'medium', metric_name TEXT, metric_value NUMERIC(14,2),
  trend_pct NUMERIC(8,2), recommended_action TEXT, status TEXT DEFAULT 'active',
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scenario_simulations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL,
  name TEXT NOT NULL, scenario_type TEXT NOT NULL, parameters JSONB DEFAULT '{}',
  baseline JSONB DEFAULT '{}', projected JSONB DEFAULT '{}', impact_summary JSONB DEFAULT '{}',
  created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategic_plans (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL,
  horizon_days INTEGER NOT NULL, title TEXT NOT NULL, objectives JSONB DEFAULT '[]',
  risks JSONB DEFAULT '[]', opportunities JSONB DEFAULT '[]', actions JSONB DEFAULT '[]',
  expected_outcomes JSONB DEFAULT '[]', obsidian_path TEXT, generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forecast_accuracy (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL,
  metric TEXT NOT NULL, horizon_days INTEGER NOT NULL, predicted_value NUMERIC(14,2),
  actual_value NUMERIC(14,2), variance_pct NUMERIC(8,2), accuracy_score INTEGER,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_twin_state (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL UNIQUE,
  monthly_revenue NUMERIC(14,2) DEFAULT 0,
  active_clients INTEGER DEFAULT 0,
  active_coaches INTEGER DEFAULT 0,
  sessions_per_week NUMERIC(8,2) DEFAULT 0,
  lead_volume_30d INTEGER DEFAULT 0,
  conversion_rate NUMERIC(8,4) DEFAULT 0,
  retention_rate NUMERIC(8,4) DEFAULT 0,
  capacity_utilization NUMERIC(8,4) DEFAULT 0,
  revenue_trend_pct NUMERIC(8,2) DEFAULT 0,
  lead_trend_pct NUMERIC(8,2) DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Safe additive transition from the prior runtime-created business_forecasts table.
ALTER TABLE business_forecasts ADD COLUMN IF NOT EXISTS forecast_date DATE;
UPDATE business_forecasts
SET forecast_date = COALESCE((generated_at AT TIME ZONE 'UTC')::date, CURRENT_DATE)
WHERE forecast_date IS NULL;
ALTER TABLE business_forecasts ALTER COLUMN forecast_date SET DEFAULT CURRENT_DATE;
ALTER TABLE business_forecasts ALTER COLUMN forecast_date SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM business_forecasts
    GROUP BY org_id, horizon_days, metric, forecast_date HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Incompatible forecasting schema: duplicate tenant forecast identity';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS business_forecasts_tenant_day_unique
  ON business_forecasts(org_id, horizon_days, metric, forecast_date);
CREATE INDEX IF NOT EXISTS risk_signals_org_status_detected
  ON risk_signals(org_id, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS opportunity_signals_org_status_detected
  ON opportunity_signals(org_id, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS scenario_simulations_org_created
  ON scenario_simulations(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategic_plans_org_generated
  ON strategic_plans(org_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS forecast_accuracy_org_metric_horizon
  ON forecast_accuracy(org_id, metric, horizon_days);

DO $$
DECLARE
  requirement RECORD;
  actual_type TEXT;
  actual_not_null BOOLEAN;
BEGIN
  FOR requirement IN SELECT * FROM (VALUES
    ('business_forecasts','id','text',true), ('business_forecasts','org_id','text',true),
    ('business_forecasts','horizon_days','integer',true), ('business_forecasts','metric','text',true),
    ('business_forecasts','current_value','numeric(14,2)',false), ('business_forecasts','projected_value','numeric(14,2)',false),
    ('business_forecasts','change_pct','numeric(8,2)',false), ('business_forecasts','confidence','integer',false),
    ('business_forecasts','variance_low','numeric(14,2)',false), ('business_forecasts','variance_high','numeric(14,2)',false),
    ('business_forecasts','supporting_factors','jsonb',false), ('business_forecasts','generated_at','timestamp with time zone',false),
    ('business_forecasts','forecast_date','date',true),
    ('risk_signals','id','text',true), ('risk_signals','org_id','text',true), ('risk_signals','category','text',true),
    ('risk_signals','title','text',true), ('risk_signals','description','text',false), ('risk_signals','risk_level','text',false),
    ('risk_signals','metric_name','text',false), ('risk_signals','metric_value','numeric(14,2)',false),
    ('risk_signals','threshold','numeric(14,2)',false), ('risk_signals','trend_pct','numeric(8,2)',false),
    ('risk_signals','status','text',false), ('risk_signals','detected_at','timestamp with time zone',false),
    ('risk_signals','resolved_at','timestamp with time zone',false),
    ('opportunity_signals','id','text',true), ('opportunity_signals','org_id','text',true),
    ('opportunity_signals','category','text',true), ('opportunity_signals','title','text',true),
    ('opportunity_signals','description','text',false), ('opportunity_signals','impact_level','text',false),
    ('opportunity_signals','metric_name','text',false), ('opportunity_signals','metric_value','numeric(14,2)',false),
    ('opportunity_signals','trend_pct','numeric(8,2)',false), ('opportunity_signals','recommended_action','text',false),
    ('opportunity_signals','status','text',false), ('opportunity_signals','detected_at','timestamp with time zone',false),
    ('scenario_simulations','id','text',true), ('scenario_simulations','org_id','text',true),
    ('scenario_simulations','name','text',true), ('scenario_simulations','scenario_type','text',true),
    ('scenario_simulations','parameters','jsonb',false), ('scenario_simulations','baseline','jsonb',false),
    ('scenario_simulations','projected','jsonb',false), ('scenario_simulations','impact_summary','jsonb',false),
    ('scenario_simulations','created_by','text',false), ('scenario_simulations','created_at','timestamp with time zone',false),
    ('strategic_plans','id','text',true), ('strategic_plans','org_id','text',true),
    ('strategic_plans','horizon_days','integer',true), ('strategic_plans','title','text',true),
    ('strategic_plans','objectives','jsonb',false), ('strategic_plans','risks','jsonb',false),
    ('strategic_plans','opportunities','jsonb',false), ('strategic_plans','actions','jsonb',false),
    ('strategic_plans','expected_outcomes','jsonb',false), ('strategic_plans','obsidian_path','text',false),
    ('strategic_plans','generated_at','timestamp with time zone',false),
    ('forecast_accuracy','id','text',true), ('forecast_accuracy','org_id','text',true),
    ('forecast_accuracy','metric','text',true), ('forecast_accuracy','horizon_days','integer',true),
    ('forecast_accuracy','predicted_value','numeric(14,2)',false), ('forecast_accuracy','actual_value','numeric(14,2)',false),
    ('forecast_accuracy','variance_pct','numeric(8,2)',false), ('forecast_accuracy','accuracy_score','integer',false),
    ('forecast_accuracy','recorded_at','timestamp with time zone',false),
    ('business_twin_state','id','text',true), ('business_twin_state','org_id','text',true),
    ('business_twin_state','monthly_revenue','numeric(14,2)',false), ('business_twin_state','active_clients','integer',false),
    ('business_twin_state','active_coaches','integer',false), ('business_twin_state','sessions_per_week','numeric(8,2)',false),
    ('business_twin_state','lead_volume_30d','integer',false), ('business_twin_state','conversion_rate','numeric(8,4)',false),
    ('business_twin_state','retention_rate','numeric(8,4)',false), ('business_twin_state','capacity_utilization','numeric(8,4)',false),
    ('business_twin_state','revenue_trend_pct','numeric(8,2)',false), ('business_twin_state','lead_trend_pct','numeric(8,2)',false),
    ('business_twin_state','last_updated','timestamp with time zone',false)
  ) AS contract(table_name, column_name, canonical_type, required_not_null)
  LOOP
    SELECT format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull
      INTO actual_type, actual_not_null
    FROM pg_attribute attribute
    JOIN pg_class table_definition ON table_definition.oid = attribute.attrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
    WHERE table_namespace.nspname = current_schema()
      AND table_definition.relname = requirement.table_name
      AND attribute.attname = requirement.column_name
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;

    IF actual_type IS NULL THEN
      RAISE EXCEPTION 'Incompatible forecasting schema: missing %.%', requirement.table_name, requirement.column_name;
    END IF;
    IF actual_type <> requirement.canonical_type THEN
      RAISE EXCEPTION 'Incompatible forecasting schema: %.% expected type %, got %',
        requirement.table_name, requirement.column_name, requirement.canonical_type, actual_type;
    END IF;
    IF actual_not_null <> requirement.required_not_null THEN
      RAISE EXCEPTION 'Incompatible forecasting schema: %.% expected nullability %, got %',
        requirement.table_name, requirement.column_name,
        CASE WHEN requirement.required_not_null THEN 'NOT NULL' ELSE 'NULLABLE' END,
        CASE WHEN actual_not_null THEN 'NOT NULL' ELSE 'NULLABLE' END;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  expected_table TEXT;
BEGIN
  FOREACH expected_table IN ARRAY ARRAY[
    'business_forecasts','risk_signals','opportunity_signals','scenario_simulations',
    'strategic_plans','forecast_accuracy','business_twin_state'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM (
        SELECT table_definition.relname AS table_name,
          array_agg(attribute.attname ORDER BY key.ordinality)::text[] AS columns
        FROM pg_constraint constraint_definition
        JOIN pg_class table_definition ON table_definition.oid = constraint_definition.conrelid
        JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
        JOIN unnest(constraint_definition.conkey) WITH ORDINALITY key(attribute_number, ordinality) ON true
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_definition.conrelid
         AND attribute.attnum = key.attribute_number
        WHERE table_namespace.nspname = current_schema() AND constraint_definition.contype = 'p'
        GROUP BY table_definition.relname, constraint_definition.oid
      ) primary_keys
      WHERE primary_keys.table_name = expected_table
        AND primary_keys.columns = ARRAY['id']::text[]
    ) THEN
      RAISE EXCEPTION 'Incompatible forecasting schema: %.PRIMARY KEY expected (id)', expected_table;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  requirement TEXT;
  expected_table TEXT;
  expected_index TEXT;
  expected_columns TEXT[];
  expected_unique BOOLEAN;
BEGIN
  FOREACH requirement IN ARRAY ARRAY[
    'business_forecasts|business_forecasts_tenant_day_unique|org_id,horizon_days,metric,forecast_date|true',
    'risk_signals|risk_signals_org_status_detected|org_id,status,detected_at|false',
    'opportunity_signals|opportunity_signals_org_status_detected|org_id,status,detected_at|false',
    'scenario_simulations|scenario_simulations_org_created|org_id,created_at|false',
    'strategic_plans|strategic_plans_org_generated|org_id,generated_at|false',
    'forecast_accuracy|forecast_accuracy_org_metric_horizon|org_id,metric,horizon_days|false'
  ] LOOP
    expected_table := split_part(requirement, '|', 1);
    expected_index := split_part(requirement, '|', 2);
    expected_columns := string_to_array(split_part(requirement, '|', 3), ',');
    expected_unique := split_part(requirement, '|', 4)::boolean;
    IF NOT EXISTS (
      SELECT 1 FROM (
        SELECT table_definition.relname AS actual_table, index_class.relname AS actual_index,
          index_definition.indisunique AS is_unique,
          array_agg(attribute.attname ORDER BY key.ordinality)::text[] AS columns
        FROM pg_index index_definition
        JOIN pg_class table_definition ON table_definition.oid = index_definition.indrelid
        JOIN pg_class index_class ON index_class.oid = index_definition.indexrelid
        JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
        JOIN unnest(index_definition.indkey) WITH ORDINALITY key(attribute_number, ordinality) ON true
        JOIN pg_attribute attribute ON attribute.attrelid = index_definition.indrelid AND attribute.attnum = key.attribute_number
        WHERE table_namespace.nspname = current_schema() AND index_definition.indisvalid
        GROUP BY table_definition.relname, index_class.relname, index_definition.indisunique
      ) indexes
      WHERE indexes.actual_table = expected_table AND indexes.actual_index = expected_index
        AND indexes.columns = expected_columns AND indexes.is_unique = expected_unique
    ) THEN
      RAISE EXCEPTION 'Incompatible forecasting schema: invalid index %', expected_index;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT table_definition.relname AS table_name,
        array_agg(attribute.attname ORDER BY key.ordinality)::text[] AS columns
      FROM pg_index index_definition
      JOIN pg_class table_definition ON table_definition.oid = index_definition.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
      JOIN unnest(index_definition.indkey) WITH ORDINALITY key(attribute_number, ordinality) ON true
      JOIN pg_attribute attribute ON attribute.attrelid = index_definition.indrelid AND attribute.attnum = key.attribute_number
      WHERE table_namespace.nspname = current_schema() AND index_definition.indisunique AND index_definition.indisvalid
        AND table_definition.relname = 'business_twin_state'
      GROUP BY table_definition.relname, index_definition.indexrelid
    ) unique_indexes
    WHERE unique_indexes.columns = ARRAY['org_id']::text[]
  ) THEN
    RAISE EXCEPTION 'Incompatible forecasting schema: missing tenant twin uniqueness';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT table_definition.relname AS table_name, index_definition.indisprimary,
        array_agg(attribute.attname ORDER BY key.ordinality)::text[] AS columns
      FROM pg_index index_definition
      JOIN pg_class table_definition ON table_definition.oid = index_definition.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
      JOIN unnest(index_definition.indkey) WITH ORDINALITY key(attribute_number, ordinality) ON true
      JOIN pg_attribute attribute ON attribute.attrelid = index_definition.indrelid AND attribute.attnum = key.attribute_number
      WHERE table_namespace.nspname = current_schema() AND index_definition.indisunique
        AND table_definition.relname IN ('business_forecasts','risk_signals','opportunity_signals',
          'scenario_simulations','strategic_plans','forecast_accuracy','business_twin_state')
      GROUP BY table_definition.relname, index_definition.indexrelid, index_definition.indisprimary
    ) unique_indexes
    WHERE NOT unique_indexes.indisprimary
      AND NOT (unique_indexes.table_name = 'business_forecasts'
        AND unique_indexes.columns = ARRAY['org_id','horizon_days','metric','forecast_date']::text[])
      AND NOT (unique_indexes.table_name = 'business_twin_state'
        AND unique_indexes.columns = ARRAY['org_id']::text[])
  ) THEN
    RAISE EXCEPTION 'Incompatible forecasting schema: global business uniqueness is not tenant scoped';
  END IF;
END $$;
