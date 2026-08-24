-- Canonical ownership for durable Autonomous, Hermes, and Opportunity state.
-- Runtime feature paths validate these objects but never create or alter them.

CREATE TABLE IF NOT EXISTS decision_trust_registry (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL,
  decision_type TEXT NOT NULL, label TEXT NOT NULL, autonomy_score INTEGER DEFAULT 0,
  success_rate INTEGER DEFAULT 0, revenue_influenced INTEGER DEFAULT 0, executions INTEGER DEFAULT 0,
  human_approvals INTEGER DEFAULT 0, human_overrides INTEGER DEFAULT 0, risk_level TEXT DEFAULT 'medium',
  recommended_mode TEXT DEFAULT 'observe', ceo_override_mode TEXT, last_evaluated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (org_id, decision_type)
);

CREATE TABLE IF NOT EXISTS autonomous_action_queue (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, decision_type TEXT NOT NULL,
  agent_type TEXT NOT NULL, action TEXT NOT NULL, description TEXT, confidence INTEGER DEFAULT 0,
  autonomy_score INTEGER DEFAULT 0, risk_level TEXT DEFAULT 'medium', status TEXT DEFAULT 'pending',
  approved_by TEXT, rejected_by TEXT, rejection_reason TEXT, outcome TEXT, revenue_cents INTEGER DEFAULT 0,
  meetings_gen INTEGER DEFAULT 0, source_system TEXT, source_action_id TEXT, source_conversation_id TEXT,
  gmail_thread_id TEXT, executed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE autonomous_action_queue ADD COLUMN IF NOT EXISTS source_system TEXT;
ALTER TABLE autonomous_action_queue ADD COLUMN IF NOT EXISTS source_action_id TEXT;
ALTER TABLE autonomous_action_queue ADD COLUMN IF NOT EXISTS source_conversation_id TEXT;
ALTER TABLE autonomous_action_queue ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT;

CREATE TABLE IF NOT EXISTS autonomy_overrides (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, queue_action_id TEXT,
  decision_type TEXT NOT NULL, original_recommendation TEXT NOT NULL, override_type TEXT NOT NULL,
  reason TEXT, modified_action TEXT, outcome TEXT, success_score INTEGER, overridden_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_objectives (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT, target_value NUMERIC, target_unit TEXT, current_value NUMERIC DEFAULT 0,
  deadline TIMESTAMPTZ, priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'active', progress INTEGER DEFAULT 0,
  confidence INTEGER DEFAULT 50, assigned_agents JSONB DEFAULT '[]'::jsonb, execution_plan JSONB, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS autonomous_initiatives (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT, initiative_type TEXT DEFAULT 'custom', status TEXT DEFAULT 'running',
  agents_assigned JSONB DEFAULT '[]'::jsonb, progress INTEGER DEFAULT 0, results_summary TEXT,
  automation_mode TEXT DEFAULT 'manual', started_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS business_memory (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, memory_type TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT, outcome TEXT, outcome_value NUMERIC, tags JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS autonomous_actions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, action_type TEXT NOT NULL,
  source_agent TEXT, source_workflow TEXT, initiated_by TEXT DEFAULT 'system', approval_status TEXT DEFAULT 'auto_approved',
  before_state JSONB DEFAULT '{}'::jsonb, after_state JSONB DEFAULT '{}'::jsonb, expected_outcome TEXT,
  actual_outcome TEXT, revenue_impact NUMERIC DEFAULT 0, category TEXT DEFAULT 'automation', risk_level TEXT DEFAULT 'low',
  is_reversible BOOLEAN DEFAULT true, rolled_back BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS recommendation_tracking (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, recommendation_id TEXT,
  title TEXT NOT NULL, expected_impact TEXT, expected_metric TEXT, actual_impact TEXT, status TEXT DEFAULT 'approved',
  outcome TEXT, revenue_impact NUMERIC DEFAULT 0, approved_at TIMESTAMPTZ DEFAULT NOW(), measured_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS execution_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, action_id TEXT, source_system TEXT,
  source_agent TEXT, execution_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ, latency_ms INTEGER, input JSONB, output JSONB, error TEXT, workflow_run_id TEXT,
  gmail_thread_id TEXT, prospect_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exec_events_org ON execution_events (org_id);
CREATE INDEX IF NOT EXISTS idx_exec_events_action ON execution_events (action_id);
CREATE INDEX IF NOT EXISTS idx_exec_events_status ON execution_events (status);
CREATE INDEX IF NOT EXISTS idx_exec_events_type ON execution_events (execution_type);

CREATE TABLE IF NOT EXISTS composio_hermes_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT, agent TEXT NOT NULL, tool TEXT NOT NULL,
  action TEXT NOT NULL, result TEXT NOT NULL, outcome TEXT NOT NULL, metadata JSONB,
  hermes_processed BOOLEAN NOT NULL DEFAULT false, hermes_processed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS composio_hermes_events_org_idx ON composio_hermes_events (org_id);
CREATE INDEX IF NOT EXISTS composio_hermes_events_processed_idx ON composio_hermes_events (hermes_processed, created_at);

CREATE TABLE IF NOT EXISTS hermes_auto_learnings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, domain TEXT NOT NULL DEFAULT 'general',
  metric TEXT, delta TEXT, outcome TEXT NOT NULL, observation TEXT NOT NULL, learning TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system', memory_type TEXT NOT NULL DEFAULT 'lesson', department TEXT NOT NULL DEFAULT 'Operations',
  category TEXT NOT NULL DEFAULT 'System', confidence_score INTEGER NOT NULL DEFAULT 80, impact_score INTEGER NOT NULL DEFAULT 70,
  related_entity_type TEXT, related_entity_id TEXT, content_hash TEXT, occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), retrieved_count INTEGER NOT NULL DEFAULT 0, last_retrieved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE hermes_auto_learnings ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE hermes_auto_learnings ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hermes_auto_learnings ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE hermes_auto_learnings ADD COLUMN IF NOT EXISTS retrieved_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hermes_auto_learnings ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_hal_org ON hermes_auto_learnings (org_id);
CREATE INDEX IF NOT EXISTS idx_hal_domain ON hermes_auto_learnings (domain);
CREATE INDEX IF NOT EXISTS idx_hal_source ON hermes_auto_learnings (source);
CREATE INDEX IF NOT EXISTS idx_hal_created ON hermes_auto_learnings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hal_mtype ON hermes_auto_learnings (memory_type);
CREATE INDEX IF NOT EXISTS idx_hal_last_seen ON hermes_auto_learnings (last_seen_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hal_content_hash ON hermes_auto_learnings (content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS hermes_recommendations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, run_id TEXT, type TEXT NOT NULL,
  title TEXT NOT NULL, reason TEXT NOT NULL, confidence NUMERIC(5,2) DEFAULT 0, source_system TEXT,
  source_conversation_id TEXT, source_record_id TEXT, gmail_thread_id TEXT, recommended_action TEXT,
  action_queue_id TEXT, status TEXT DEFAULT 'generated', metadata JSONB, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrec_org ON hermes_recommendations (org_id);
CREATE INDEX IF NOT EXISTS idx_hrec_run ON hermes_recommendations (run_id);
CREATE INDEX IF NOT EXISTS idx_hrec_status ON hermes_recommendations (status);
CREATE INDEX IF NOT EXISTS idx_hrec_created ON hermes_recommendations (created_at DESC);
CREATE TABLE IF NOT EXISTS hermes_recommendation_feedback (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, recommendation_id TEXT NOT NULL, action_queue_id TEXT,
  outcome TEXT NOT NULL, editor_id TEXT, edit_notes TEXT, original_confidence NUMERIC(5,2), final_outcome TEXT,
  approved_as_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE hermes_recommendation_feedback ADD COLUMN IF NOT EXISTS approved_as_type TEXT;
CREATE INDEX IF NOT EXISTS idx_hfb_rec ON hermes_recommendation_feedback (recommendation_id);
CREATE INDEX IF NOT EXISTS idx_hfb_queue ON hermes_recommendation_feedback (action_queue_id);

CREATE TABLE IF NOT EXISTS opportunity_acquisition_opportunities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'Manual',
  company TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'coaching', location TEXT NOT NULL DEFAULT 'Remote',
  estimated_value INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new', fit_score INTEGER NOT NULL DEFAULT 0,
  notes TEXT, fingerprint TEXT, final_outcome TEXT NOT NULL DEFAULT 'in_progress', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE opportunity_acquisition_opportunities ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE opportunity_acquisition_opportunities ADD COLUMN IF NOT EXISTS final_outcome TEXT NOT NULL DEFAULT 'in_progress';
CREATE TABLE IF NOT EXISTS opportunity_agent_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, agent_name TEXT NOT NULL,
  action TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'info', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS opportunity_qualification_assessments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
  ai_can_fulfill JSONB NOT NULL DEFAULT '[]', human_required JSONB NOT NULL DEFAULT '[]', revenue_potential TEXT NOT NULL DEFAULT 'medium',
  risk_level TEXT NOT NULL DEFAULT 'medium', recommended_action TEXT NOT NULL DEFAULT 'Review manually', fit_score INTEGER NOT NULL DEFAULT 0,
  ai_fulfillment_score INTEGER NOT NULL DEFAULT 0, revenue_potential_score INTEGER NOT NULL DEFAULT 0, risk_score INTEGER NOT NULL DEFAULT 0,
  confidence_score INTEGER NOT NULL DEFAULT 0, reasoning TEXT NOT NULL DEFAULT '', red_flags JSONB NOT NULL DEFAULT '[]',
  next_steps JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE opportunity_qualification_assessments ADD COLUMN IF NOT EXISTS fit_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opportunity_qualification_assessments ADD COLUMN IF NOT EXISTS ai_fulfillment_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opportunity_qualification_assessments ADD COLUMN IF NOT EXISTS revenue_potential_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opportunity_qualification_assessments ADD COLUMN IF NOT EXISTS risk_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opportunity_qualification_assessments ADD COLUMN IF NOT EXISTS confidence_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opportunity_qualification_assessments ADD COLUMN IF NOT EXISTS reasoning TEXT NOT NULL DEFAULT '';
ALTER TABLE opportunity_qualification_assessments ADD COLUMN IF NOT EXISTS red_flags JSONB NOT NULL DEFAULT '[]';
ALTER TABLE opportunity_qualification_assessments ADD COLUMN IF NOT EXISTS next_steps JSONB NOT NULL DEFAULT '[]';
ALTER TABLE opportunity_qualification_assessments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS opportunity_outreach_drafts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', channel TEXT NOT NULL DEFAULT 'email',
  confidence_score INTEGER NOT NULL DEFAULT 0, created_by_agent BOOLEAN NOT NULL DEFAULT true, approved_by_user_id TEXT,
  sent_at TIMESTAMPTZ, call_to_action TEXT NOT NULL DEFAULT '', positioning_angle TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL DEFAULT '', recipient_email TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE opportunity_outreach_drafts ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email';
ALTER TABLE opportunity_outreach_drafts ADD COLUMN IF NOT EXISTS confidence_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opportunity_outreach_drafts ADD COLUMN IF NOT EXISTS created_by_agent BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE opportunity_outreach_drafts ADD COLUMN IF NOT EXISTS approved_by_user_id TEXT;
ALTER TABLE opportunity_outreach_drafts ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE opportunity_outreach_drafts ADD COLUMN IF NOT EXISTS call_to_action TEXT NOT NULL DEFAULT '';
ALTER TABLE opportunity_outreach_drafts ADD COLUMN IF NOT EXISTS positioning_angle TEXT NOT NULL DEFAULT '';
ALTER TABLE opportunity_outreach_drafts ADD COLUMN IF NOT EXISTS recipient_name TEXT NOT NULL DEFAULT '';
ALTER TABLE opportunity_outreach_drafts ADD COLUMN IF NOT EXISTS recipient_email TEXT NOT NULL DEFAULT '';
ALTER TABLE opportunity_outreach_drafts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ DECLARE constraint_row record; BEGIN
  FOR constraint_row IN SELECT conname, conrelid::regclass AS relation FROM pg_constraint
    WHERE contype='u' AND conrelid IN ('opportunity_qualification_assessments'::regclass, 'opportunity_outreach_drafts'::regclass)
      AND array_length(conkey,1)=1 AND (SELECT attname FROM pg_attribute WHERE attrelid=conrelid AND attnum=conkey[1])='opportunity_id'
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', constraint_row.relation, constraint_row.conname); END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_qualification_org_opportunity_unique ON opportunity_qualification_assessments (org_id, opportunity_id);
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_outreach_org_opportunity_unique ON opportunity_outreach_drafts (org_id, opportunity_id);

CREATE TABLE IF NOT EXISTS opportunity_source_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL UNIQUE, sources JSONB NOT NULL DEFAULT '{}',
  qual_rules JSONB NOT NULL DEFAULT '{}', outreach_rules JSONB NOT NULL DEFAULT '{}', agent_perms JSONB NOT NULL DEFAULT '{}',
  discovery_filters JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE opportunity_source_settings ADD COLUMN IF NOT EXISTS discovery_filters JSONB NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS opportunity_discovery_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'running', opportunities_scanned INTEGER NOT NULL DEFAULT 0,
  opportunities_created INTEGER NOT NULL DEFAULT 0, opportunities_rejected INTEGER NOT NULL DEFAULT 0,
  duplicates_skipped INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS opportunity_acquisition_cycles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'running', scanned_count INTEGER NOT NULL DEFAULT 0,
  discovered_count INTEGER NOT NULL DEFAULT 0, duplicates_skipped INTEGER NOT NULL DEFAULT 0, rejected_count INTEGER NOT NULL DEFAULT 0,
  qualified_count INTEGER NOT NULL DEFAULT 0, drafts_created INTEGER NOT NULL DEFAULT 0, errors JSONB NOT NULL DEFAULT '[]',
  notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS opportunity_outreach_executions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, draft_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '', recipient_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  agentmail_message_id TEXT, status TEXT NOT NULL DEFAULT 'pending', delivery_status TEXT NOT NULL DEFAULT 'unknown',
  reply_detected BOOLEAN NOT NULL DEFAULT FALSE, sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, replied_at TIMESTAMPTZ,
  error_message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS opportunity_reply_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, execution_id TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '', sender_email TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '', classification TEXT, confidence_score NUMERIC(4,3) DEFAULT 0, suggested_next_action TEXT,
  reasoning TEXT, key_points TEXT[] DEFAULT '{}', urgency TEXT DEFAULT 'low', pipeline_status TEXT, followup_draft_id TEXT,
  received_at TIMESTAMPTZ, processed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS opportunity_learning_signals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '', company_size TEXT NOT NULL DEFAULT '', opportunity_type TEXT NOT NULL DEFAULT '', fit_score INTEGER NOT NULL DEFAULT 0,
  positioning_angle TEXT NOT NULL DEFAULT '', outreach_subject TEXT NOT NULL DEFAULT '', reply_received BOOLEAN NOT NULL DEFAULT FALSE,
  interested BOOLEAN NOT NULL DEFAULT FALSE, meeting_requested BOOLEAN NOT NULL DEFAULT FALSE, referral_received BOOLEAN NOT NULL DEFAULT FALSE,
  won BOOLEAN NOT NULL DEFAULT FALSE, lost BOOLEAN NOT NULL DEFAULT FALSE, ghosted BOOLEAN NOT NULL DEFAULT FALSE,
  final_outcome TEXT NOT NULL DEFAULT 'in_progress', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS opportunity_learning_insights (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, insight TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general', confidence_score NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  supporting_data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS opportunity_executive_briefs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
  best_action_today TEXT NOT NULL DEFAULT '', key_wins JSONB NOT NULL DEFAULT '[]', key_risks JSONB NOT NULL DEFAULT '[]',
  key_opportunities JSONB NOT NULL DEFAULT '[]', supporting_metrics JSONB NOT NULL DEFAULT '{}',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS opportunity_recommendations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general',
  recommendation TEXT NOT NULL, reasoning TEXT NOT NULL DEFAULT '', confidence_score NUMERIC(5,2) NOT NULL DEFAULT 50,
  supporting_data JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ
);

-- Fail closed if an existing object name concealed an incompatible table shape.
DO $$
DECLARE missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count FROM (VALUES
    ('decision_trust_registry','id'),('decision_trust_registry','org_id'),('decision_trust_registry','decision_type'),('decision_trust_registry','label'),('decision_trust_registry','autonomy_score'),('decision_trust_registry','risk_level'),('decision_trust_registry','recommended_mode'),
    ('autonomous_action_queue','id'),('autonomous_action_queue','org_id'),('autonomous_action_queue','decision_type'),('autonomous_action_queue','agent_type'),('autonomous_action_queue','action'),('autonomous_action_queue','status'),('autonomous_action_queue','source_system'),('autonomous_action_queue','source_action_id'),('autonomous_action_queue','source_conversation_id'),('autonomous_action_queue','gmail_thread_id'),
    ('autonomy_overrides','id'),('autonomy_overrides','org_id'),('autonomy_overrides','decision_type'),('autonomy_overrides','original_recommendation'),('autonomy_overrides','override_type'),
    ('business_objectives','id'),('business_objectives','org_id'),('business_objectives','title'),('business_objectives','status'),('business_objectives','progress'),('business_objectives','execution_plan'),
    ('autonomous_initiatives','id'),('autonomous_initiatives','org_id'),('autonomous_initiatives','name'),('autonomous_initiatives','status'),('autonomous_initiatives','automation_mode'),
    ('business_memory','id'),('business_memory','org_id'),('business_memory','memory_type'),('business_memory','title'),('business_memory','metadata'),
    ('autonomous_actions','id'),('autonomous_actions','org_id'),('autonomous_actions','action_type'),('autonomous_actions','approval_status'),('autonomous_actions','rolled_back'),
    ('recommendation_tracking','id'),('recommendation_tracking','org_id'),('recommendation_tracking','title'),('recommendation_tracking','status'),
    ('execution_events','id'),('execution_events','org_id'),('execution_events','execution_type'),('execution_events','status'),('execution_events','input'),('execution_events','output'),
    ('composio_hermes_events','id'),('composio_hermes_events','org_id'),('composio_hermes_events','agent'),('composio_hermes_events','tool'),('composio_hermes_events','action'),('composio_hermes_events','result'),('composio_hermes_events','hermes_processed'),
    ('hermes_auto_learnings','id'),('hermes_auto_learnings','org_id'),('hermes_auto_learnings','domain'),('hermes_auto_learnings','outcome'),('hermes_auto_learnings','observation'),('hermes_auto_learnings','learning'),('hermes_auto_learnings','content_hash'),('hermes_auto_learnings','occurrence_count'),('hermes_auto_learnings','last_seen_at'),('hermes_auto_learnings','retrieved_count'),
    ('hermes_recommendations','id'),('hermes_recommendations','org_id'),('hermes_recommendations','type'),('hermes_recommendations','title'),('hermes_recommendations','reason'),('hermes_recommendations','confidence'),('hermes_recommendations','status'),
    ('hermes_recommendation_feedback','id'),('hermes_recommendation_feedback','recommendation_id'),('hermes_recommendation_feedback','outcome'),('hermes_recommendation_feedback','approved_as_type'),
    ('opportunity_acquisition_opportunities','id'),('opportunity_acquisition_opportunities','org_id'),('opportunity_acquisition_opportunities','title'),('opportunity_acquisition_opportunities','status'),('opportunity_acquisition_opportunities','fingerprint'),('opportunity_acquisition_opportunities','final_outcome'),
    ('opportunity_agent_events','id'),('opportunity_agent_events','org_id'),('opportunity_agent_events','agent_name'),('opportunity_agent_events','action'),('opportunity_agent_events','event_type'),
    ('opportunity_qualification_assessments','id'),('opportunity_qualification_assessments','org_id'),('opportunity_qualification_assessments','opportunity_id'),('opportunity_qualification_assessments','fit_score'),('opportunity_qualification_assessments','reasoning'),('opportunity_qualification_assessments','updated_at'),
    ('opportunity_outreach_drafts','id'),('opportunity_outreach_drafts','org_id'),('opportunity_outreach_drafts','opportunity_id'),('opportunity_outreach_drafts','subject'),('opportunity_outreach_drafts','body'),('opportunity_outreach_drafts','status'),('opportunity_outreach_drafts','recipient_name'),('opportunity_outreach_drafts','recipient_email'),('opportunity_outreach_drafts','updated_at'),
    ('opportunity_source_settings','id'),('opportunity_source_settings','org_id'),('opportunity_source_settings','sources'),('opportunity_source_settings','discovery_filters'),
    ('opportunity_discovery_runs','id'),('opportunity_discovery_runs','org_id'),('opportunity_discovery_runs','status'),('opportunity_discovery_runs','opportunities_scanned'),
    ('opportunity_acquisition_cycles','id'),('opportunity_acquisition_cycles','org_id'),('opportunity_acquisition_cycles','status'),('opportunity_acquisition_cycles','errors'),
    ('opportunity_outreach_executions','id'),('opportunity_outreach_executions','org_id'),('opportunity_outreach_executions','opportunity_id'),('opportunity_outreach_executions','draft_id'),('opportunity_outreach_executions','recipient_email'),('opportunity_outreach_executions','status'),
    ('opportunity_reply_events','id'),('opportunity_reply_events','org_id'),('opportunity_reply_events','opportunity_id'),('opportunity_reply_events','execution_id'),('opportunity_reply_events','classification'),
    ('opportunity_learning_signals','id'),('opportunity_learning_signals','org_id'),('opportunity_learning_signals','opportunity_id'),('opportunity_learning_signals','final_outcome'),
    ('opportunity_learning_insights','id'),('opportunity_learning_insights','org_id'),('opportunity_learning_insights','insight'),('opportunity_learning_insights','supporting_data'),
    ('opportunity_executive_briefs','id'),('opportunity_executive_briefs','org_id'),('opportunity_executive_briefs','summary'),('opportunity_executive_briefs','supporting_metrics'),
    ('opportunity_recommendations','id'),('opportunity_recommendations','org_id'),('opportunity_recommendations','recommendation'),('opportunity_recommendations','status')
  ) required(table_name,column_name)
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns actual
    WHERE actual.table_schema=current_schema() AND actual.table_name=required.table_name AND actual.column_name=required.column_name);
  IF missing_count > 0 THEN RAISE EXCEPTION 'incompatible Autonomous/Hermes/Opportunity legacy schema'; END IF;

  SELECT count(*) INTO missing_count FROM information_schema.columns
  WHERE table_schema=current_schema()
    AND ((column_name='org_id' AND table_name IN (
      'decision_trust_registry','autonomous_action_queue','autonomy_overrides','business_objectives',
      'autonomous_initiatives','business_memory','autonomous_actions','recommendation_tracking','execution_events',
      'hermes_auto_learnings','hermes_recommendations','opportunity_acquisition_opportunities','opportunity_agent_events',
      'opportunity_qualification_assessments','opportunity_outreach_drafts','opportunity_source_settings',
      'opportunity_discovery_runs','opportunity_acquisition_cycles','opportunity_outreach_executions',
      'opportunity_reply_events','opportunity_learning_signals','opportunity_learning_insights',
      'opportunity_executive_briefs','opportunity_recommendations'
    ) AND (is_nullable <> 'NO' OR udt_name <> 'text'))
    OR (table_name IN ('opportunity_qualification_assessments','opportunity_outreach_drafts')
      AND column_name='opportunity_id' AND (is_nullable <> 'NO' OR udt_name <> 'text')));
  IF missing_count > 0 THEN RAISE EXCEPTION 'incompatible nullable or typed tenant identity in Autonomous/Hermes/Opportunity schema'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index definition JOIN pg_class relation ON relation.oid=definition.indrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname=current_schema() AND relation.relname='decision_trust_registry' AND definition.indisunique
      AND ARRAY(SELECT attribute.attname::text FROM unnest(definition.indkey) WITH ORDINALITY key(attnum,ord)
        JOIN pg_attribute attribute ON attribute.attrelid=definition.indrelid AND attribute.attnum=key.attnum ORDER BY key.ord)
        = ARRAY['org_id','decision_type']::text[]
  ) THEN RAISE EXCEPTION 'missing tenant-scoped decision trust uniqueness'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index definition JOIN pg_class relation ON relation.oid=definition.indrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname=current_schema() AND relation.relname='opportunity_qualification_assessments' AND definition.indisunique
      AND ARRAY(SELECT attribute.attname::text FROM unnest(definition.indkey) WITH ORDINALITY key(attnum,ord)
        JOIN pg_attribute attribute ON attribute.attrelid=definition.indrelid AND attribute.attnum=key.attnum ORDER BY key.ord)
        = ARRAY['org_id','opportunity_id']::text[]
  ) THEN RAISE EXCEPTION 'missing tenant-scoped opportunity qualification uniqueness'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index definition JOIN pg_class relation ON relation.oid=definition.indrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname=current_schema() AND relation.relname='opportunity_outreach_drafts' AND definition.indisunique
      AND ARRAY(SELECT attribute.attname::text FROM unnest(definition.indkey) WITH ORDINALITY key(attnum,ord)
        JOIN pg_attribute attribute ON attribute.attrelid=definition.indrelid AND attribute.attnum=key.attnum ORDER BY key.ord)
        = ARRAY['org_id','opportunity_id']::text[]
  ) THEN RAISE EXCEPTION 'missing tenant-scoped opportunity outreach uniqueness'; END IF;
END $$;
