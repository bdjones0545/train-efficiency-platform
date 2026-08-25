-- Formal ownership for the optional Sponsorship and Partnership Department OS schemas.
-- Runtime route registration must validate these structures, never create or alter them.

CREATE TABLE IF NOT EXISTS sponsorship_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL,
  organization_name TEXT NOT NULL, contact_name TEXT, contact_email TEXT, contact_phone TEXT,
  website TEXT, industry TEXT, location TEXT, sponsorship_type TEXT DEFAULT 'general',
  source TEXT DEFAULT 'manual', estimated_value INTEGER DEFAULT 0, notes TEXT,
  status TEXT DEFAULT 'new', fit_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sponsorship_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL,
  sponsorship_id UUID REFERENCES sponsorship_opportunities(id) ON DELETE CASCADE,
  fit_score INTEGER DEFAULT 0, brand_alignment_score INTEGER DEFAULT 0,
  financial_value_score INTEGER DEFAULT 0, confidence_score INTEGER DEFAULT 0,
  recommended_action TEXT, reasoning TEXT, strengths JSONB DEFAULT '[]', concerns JSONB DEFAULT '[]',
  next_steps JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sponsorship_outreach_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL,
  sponsorship_id UUID REFERENCES sponsorship_opportunities(id) ON DELETE CASCADE,
  subject TEXT, body TEXT, status TEXT DEFAULT 'draft', positioning_angle TEXT,
  confidence_score INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sponsorship_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL,
  sponsorship_id UUID REFERENCES sponsorship_opportunities(id) ON DELETE CASCADE,
  stage TEXT DEFAULT 'initial', last_contacted_at TIMESTAMPTZ, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sponsorship_learning_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL,
  sponsorship_id UUID REFERENCES sponsorship_opportunities(id) ON DELETE CASCADE,
  source TEXT, industry TEXT, sponsorship_type TEXT, fit_score INTEGER DEFAULT 0,
  responded BOOLEAN DEFAULT FALSE, meeting_requested BOOLEAN DEFAULT FALSE,
  proposal_requested BOOLEAN DEFAULT FALSE, sponsored BOOLEAN DEFAULT FALSE,
  declined BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sponsorship_executive_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL, summary TEXT,
  best_action TEXT, recommendations JSONB DEFAULT '[]', metrics JSONB DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sponsorship_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL, category TEXT,
  recommendation TEXT, reasoning TEXT, confidence_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partnership_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL,
  organization_name TEXT NOT NULL, contact_name TEXT, contact_email TEXT, contact_phone TEXT,
  website TEXT, location TEXT, partnership_type TEXT DEFAULT 'general', source TEXT DEFAULT 'manual',
  notes TEXT, status TEXT DEFAULT 'new', fit_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partnership_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL,
  partnership_id UUID REFERENCES partnership_opportunities(id) ON DELETE CASCADE,
  fit_score INTEGER DEFAULT 0, reach_score INTEGER DEFAULT 0, strategic_value_score INTEGER DEFAULT 0,
  confidence_score INTEGER DEFAULT 0, recommended_action TEXT, reasoning TEXT,
  strengths JSONB DEFAULT '[]', concerns JSONB DEFAULT '[]', next_steps JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partnership_outreach_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL,
  partnership_id UUID REFERENCES partnership_opportunities(id) ON DELETE CASCADE,
  subject TEXT, body TEXT, status TEXT DEFAULT 'draft', positioning_angle TEXT,
  confidence_score INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partnership_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL,
  partnership_id UUID REFERENCES partnership_opportunities(id) ON DELETE CASCADE,
  stage TEXT DEFAULT 'initial', last_contacted_at TIMESTAMPTZ, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partnership_learning_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL,
  partnership_id UUID REFERENCES partnership_opportunities(id) ON DELETE CASCADE,
  source TEXT, partnership_type TEXT, fit_score INTEGER DEFAULT 0, replied BOOLEAN DEFAULT FALSE,
  meeting_requested BOOLEAN DEFAULT FALSE, partnered BOOLEAN DEFAULT FALSE,
  declined BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partnership_executive_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL, summary TEXT,
  best_action TEXT, recommendations JSONB DEFAULT '[]', metrics JSONB DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partnership_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id TEXT NOT NULL, category TEXT,
  recommendation TEXT, reasoning TEXT, confidence_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
DECLARE
  requirement TEXT;
  expected_table TEXT;
  expected_column TEXT;
BEGIN
  FOREACH requirement IN ARRAY ARRAY[
    'sponsorship_opportunities.id', 'sponsorship_opportunities.org_id',
    'sponsorship_opportunities.organization_name', 'sponsorship_opportunities.status',
    'sponsorship_opportunities.created_at', 'sponsorship_opportunities.updated_at',
    'sponsorship_assessments.id', 'sponsorship_assessments.org_id',
    'sponsorship_assessments.sponsorship_id', 'sponsorship_assessments.fit_score',
    'sponsorship_assessments.created_at', 'sponsorship_outreach_drafts.id',
    'sponsorship_outreach_drafts.org_id', 'sponsorship_outreach_drafts.sponsorship_id',
    'sponsorship_outreach_drafts.subject', 'sponsorship_outreach_drafts.body',
    'sponsorship_outreach_drafts.status', 'sponsorship_relationships.id',
    'sponsorship_relationships.org_id', 'sponsorship_relationships.sponsorship_id',
    'sponsorship_relationships.stage', 'sponsorship_learning_signals.id',
    'sponsorship_learning_signals.org_id', 'sponsorship_learning_signals.sponsorship_id',
    'sponsorship_learning_signals.fit_score', 'sponsorship_executive_briefs.id',
    'sponsorship_executive_briefs.org_id', 'sponsorship_executive_briefs.summary',
    'sponsorship_executive_briefs.generated_at', 'sponsorship_recommendations.id',
    'sponsorship_recommendations.org_id', 'sponsorship_recommendations.recommendation',
    'sponsorship_recommendations.created_at',
    'partnership_opportunities.id', 'partnership_opportunities.org_id',
    'partnership_opportunities.organization_name', 'partnership_opportunities.status',
    'partnership_opportunities.created_at', 'partnership_opportunities.updated_at',
    'partnership_assessments.id', 'partnership_assessments.org_id',
    'partnership_assessments.partnership_id', 'partnership_assessments.fit_score',
    'partnership_assessments.created_at', 'partnership_outreach_drafts.id',
    'partnership_outreach_drafts.org_id', 'partnership_outreach_drafts.partnership_id',
    'partnership_outreach_drafts.subject', 'partnership_outreach_drafts.body',
    'partnership_outreach_drafts.status', 'partnership_relationships.id',
    'partnership_relationships.org_id', 'partnership_relationships.partnership_id',
    'partnership_relationships.stage', 'partnership_learning_signals.id',
    'partnership_learning_signals.org_id', 'partnership_learning_signals.partnership_id',
    'partnership_learning_signals.fit_score', 'partnership_executive_briefs.id',
    'partnership_executive_briefs.org_id', 'partnership_executive_briefs.summary',
    'partnership_executive_briefs.generated_at', 'partnership_recommendations.id',
    'partnership_recommendations.org_id', 'partnership_recommendations.recommendation',
    'partnership_recommendations.created_at'
  ] LOOP
    expected_table := split_part(requirement, '.', 1);
    expected_column := split_part(requirement, '.', 2);
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = current_schema()
        AND c.table_name = expected_table AND c.column_name = expected_column
    ) THEN
      RAISE EXCEPTION 'Incompatible optional feature schema: missing %', requirement;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname IN (
        'sponsorship_opportunities','sponsorship_assessments','sponsorship_outreach_drafts',
        'sponsorship_relationships','sponsorship_learning_signals','sponsorship_executive_briefs',
        'sponsorship_recommendations','partnership_opportunities','partnership_assessments',
        'partnership_outreach_drafts','partnership_relationships','partnership_learning_signals',
        'partnership_executive_briefs','partnership_recommendations'
      )
      AND a.attname = 'org_id' AND NOT a.attnotnull
  ) THEN
    RAISE EXCEPTION 'Incompatible optional feature schema: org_id must be NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = current_schema()
      AND c.table_name IN (
        'sponsorship_opportunities','sponsorship_assessments','sponsorship_outreach_drafts',
        'sponsorship_relationships','sponsorship_learning_signals','sponsorship_executive_briefs',
        'sponsorship_recommendations','partnership_opportunities','partnership_assessments',
        'partnership_outreach_drafts','partnership_relationships','partnership_learning_signals',
        'partnership_executive_briefs','partnership_recommendations'
      )
      AND c.column_name = 'org_id' AND c.data_type <> 'text'
  ) THEN
    RAISE EXCEPTION 'Incompatible optional feature schema: org_id must have type TEXT';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sponsorship_opportunities_org_created
  ON sponsorship_opportunities(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS partnership_opportunities_org_created
  ON partnership_opportunities(org_id, created_at DESC);

DO $$
DECLARE
  requirement TEXT;
  expected_table TEXT;
  expected_index TEXT;
BEGIN
  FOREACH requirement IN ARRAY ARRAY[
    'sponsorship_opportunities.sponsorship_opportunities_org_created',
    'partnership_opportunities.partnership_opportunities_org_created'
  ] LOOP
    expected_table := split_part(requirement, '.', 1);
    expected_index := split_part(requirement, '.', 2);
    IF NOT EXISTS (
      SELECT 1
      FROM (
        SELECT table_definition.relname AS actual_table,
          index_class.relname AS actual_index,
          array_agg(attribute.attname ORDER BY key.ordinality)::text[] AS columns
        FROM pg_index index_definition
        JOIN pg_class table_definition ON table_definition.oid = index_definition.indrelid
        JOIN pg_class index_class ON index_class.oid = index_definition.indexrelid
        JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
        JOIN unnest(index_definition.indkey) WITH ORDINALITY key(attribute_number, ordinality) ON true
        JOIN pg_attribute attribute
          ON attribute.attrelid = index_definition.indrelid
         AND attribute.attnum = key.attribute_number
        WHERE table_namespace.nspname = current_schema() AND index_definition.indisvalid
        GROUP BY table_definition.relname, index_class.relname
      ) indexes
      WHERE indexes.actual_table = expected_table
        AND indexes.actual_index = expected_index
        AND indexes.columns = ARRAY['org_id','created_at']::text[]
    ) THEN
      RAISE EXCEPTION 'Incompatible optional feature schema: invalid tenant index %', expected_index;
    END IF;
  END LOOP;
END $$;
