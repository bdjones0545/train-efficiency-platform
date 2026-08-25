-- Formal ownership for durable Scheduling feature state.
-- Runtime Scheduling paths validate this schema and never create or alter it.

CREATE TABLE IF NOT EXISTS athlete_scheduling_profiles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), user_id VARCHAR NOT NULL REFERENCES users(id) UNIQUE,
  sport VARCHAR DEFAULT '', training_level VARCHAR DEFAULT '', birth_year INTEGER,
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS session_recurrence_rules (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), booking_id VARCHAR REFERENCES bookings(id) ON DELETE CASCADE,
  recurring_group_id VARCHAR, organization_id VARCHAR, frequency VARCHAR NOT NULL DEFAULT 'weekly',
  days_of_week INTEGER[] DEFAULT '{}', end_date DATE, created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS waitlist_holds (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), booking_id VARCHAR NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id), hold_expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS session_waitlists (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), booking_id VARCHAR NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id), participant_name VARCHAR, created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(booking_id, user_id)
);

CREATE TABLE IF NOT EXISTS scheduling_health_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, score INTEGER NOT NULL,
  utilization_score INTEGER NOT NULL DEFAULT 0, revenue_score INTEGER NOT NULL DEFAULT 0,
  attendance_score INTEGER NOT NULL DEFAULT 0, retention_score INTEGER NOT NULL DEFAULT 0,
  waitlist_score INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT 'Moderate', summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS session_performance_scores (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, booking_id TEXT NOT NULL, org_id TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0, utilization_factor INTEGER NOT NULL DEFAULT 0,
  revenue_factor INTEGER NOT NULL DEFAULT 0, attendance_factor INTEGER NOT NULL DEFAULT 0,
  waitlist_factor INTEGER NOT NULL DEFAULT 0, velocity_factor INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT 'Moderate', computed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS scheduling_opportunities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium', title TEXT NOT NULL, description TEXT,
  estimated_value_cents INTEGER DEFAULT 0, action_label TEXT, action_data JSONB,
  status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS retention_risk_scores (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, client_user_id TEXT NOT NULL,
  risk_score INTEGER NOT NULL DEFAULT 0, risk_level TEXT NOT NULL DEFAULT 'low',
  days_since_last_booking INTEGER DEFAULT 0, booking_frequency_drop INTEGER DEFAULT 0,
  cancellation_rate INTEGER DEFAULT 0, computed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS fill_campaign_drafts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, booking_id TEXT NOT NULL,
  subject TEXT, body TEXT, target_count INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(), preview_text TEXT, sms_body TEXT, push_body TEXT,
  social_caption TEXT, selected_recipient_count INTEGER DEFAULT 0, recipient_ids JSONB,
  recipient_summary JSONB, model_used TEXT, generation_version TEXT, generated_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS fill_campaign_submissions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, booking_id TEXT NOT NULL,
  draft_id TEXT, action_id TEXT, status TEXT NOT NULL DEFAULT 'pending_approval', version INTEGER NOT NULL DEFAULT 1,
  parent_submission_id TEXT, subject TEXT, preview_text TEXT, email_body TEXT, sms_body TEXT, push_body TEXT,
  social_caption TEXT, recipients JSONB DEFAULT '[]', recipient_count INTEGER DEFAULT 0,
  recipient_summary JSONB DEFAULT '{}', session_name TEXT, coach_name TEXT, org_name TEXT,
  open_spots INTEGER DEFAULT 0, estimated_value_cents INTEGER DEFAULT 0, fill_probability TEXT,
  approved_at TIMESTAMPTZ, approved_by TEXT, rejected_at TIMESTAMPTZ, rejection_reason TEXT,
  rejection_type TEXT, regeneration_requested_at TIMESTAMPTZ, timeline JSONB DEFAULT '[]',
  analytics JSONB DEFAULT '{"delivered":0,"opened":0,"clicked":0,"booked":0,"revenueGenerated":0}',
  submitted_at TIMESTAMPTZ DEFAULT NOW(), sent_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS fill_opportunity_scores (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, booking_id TEXT NOT NULL,
  session_name TEXT, coach_name TEXT, session_start TIMESTAMPTZ, open_spots INTEGER DEFAULT 0,
  total_spots INTEGER DEFAULT 0, session_price_cents INTEGER DEFAULT 0, utilization_pct INTEGER DEFAULT 0,
  revenue_impact TEXT, urgency TEXT, fill_probability INTEGER DEFAULT 0, overall_priority INTEGER DEFAULT 0,
  detection_triggers JSONB DEFAULT '[]', recommendations JSONB DEFAULT '[]', auto_draft_id TEXT,
  auto_draft_status TEXT DEFAULT 'not_generated', status TEXT DEFAULT 'active', detected_at TIMESTAMPTZ DEFAULT NOW(),
  last_scanned_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(org_id, booking_id)
);
CREATE TABLE IF NOT EXISTS fill_revenue_policies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL UNIQUE,
  min_fill_threshold_pct INTEGER DEFAULT 70, min_revenue_cents INTEGER DEFAULT 5000,
  campaign_lead_time_hours INTEGER DEFAULT 72, auto_draft_generation BOOLEAN DEFAULT false,
  approval_required BOOLEAN DEFAULT true, waitlist_priority BOOLEAN DEFAULT true, enabled BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS fill_campaign_attributions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL,
  campaign_submission_id TEXT NOT NULL, booking_id TEXT NOT NULL, participant_id TEXT, user_id TEXT NOT NULL,
  booking_timestamp TIMESTAMPTZ, hours_since_send NUMERIC, attribution_window TEXT,
  session_price_cents INTEGER DEFAULT 0, attributed_revenue_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(campaign_submission_id, user_id)
);
CREATE TABLE IF NOT EXISTS scheduling_recommendation_actions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
  opportunity_title TEXT NOT NULL, opportunity_type TEXT NOT NULL,
  opportunity_category TEXT NOT NULL DEFAULT 'revenue',
  action TEXT NOT NULL CHECK (action IN ('approved','rejected','dismissed','viewed')),
  estimated_value_cents INTEGER DEFAULT 0, notes TEXT, user_id TEXT, actioned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduling_health_snapshots_org_created ON scheduling_health_snapshots(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS session_performance_scores_org_booking ON session_performance_scores(org_id, booking_id);
CREATE INDEX IF NOT EXISTS scheduling_opportunities_org_status_created ON scheduling_opportunities(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS retention_risk_scores_org_client ON retention_risk_scores(org_id, client_user_id);
CREATE INDEX IF NOT EXISTS fill_campaign_drafts_org_booking ON fill_campaign_drafts(org_id, booking_id);
CREATE INDEX IF NOT EXISTS fill_campaign_submissions_org_booking ON fill_campaign_submissions(org_id, booking_id);
CREATE INDEX IF NOT EXISTS fill_campaign_attributions_org_booking ON fill_campaign_attributions(org_id, booking_id);
CREATE INDEX IF NOT EXISTS scheduling_recommendation_actions_org_opportunity ON scheduling_recommendation_actions(org_id, opportunity_id);
CREATE INDEX IF NOT EXISTS session_recurrence_rules_org_booking ON session_recurrence_rules(organization_id, booking_id);
CREATE INDEX IF NOT EXISTS waitlist_holds_booking_expiry ON waitlist_holds(booking_id, hold_expires_at);

-- Fail closed on legacy drift. The application migration runner wraps this file
-- in one transaction, so no ledger row or partial structural change survives.
DO $$
DECLARE requirement RECORD; actual_type TEXT; actual_not_null BOOLEAN;
BEGIN
  FOR requirement IN SELECT * FROM (VALUES
    ('athlete_scheduling_profiles','id','character varying',true),
    ('athlete_scheduling_profiles','user_id','character varying',true),
    ('athlete_scheduling_profiles','sport','character varying',false),
    ('athlete_scheduling_profiles','training_level','character varying',false),
    ('athlete_scheduling_profiles','birth_year','integer',false),
    ('athlete_scheduling_profiles','updated_at','timestamp without time zone',false),
    ('session_recurrence_rules','id','character varying',true),
    ('session_recurrence_rules','booking_id','character varying',false),
    ('session_recurrence_rules','recurring_group_id','character varying',false),
    ('session_recurrence_rules','organization_id','character varying',false),
    ('session_recurrence_rules','frequency','character varying',true),
    ('session_recurrence_rules','days_of_week','integer[]',false),
    ('session_recurrence_rules','end_date','date',false),
    ('session_recurrence_rules','created_at','timestamp without time zone',false),
    ('waitlist_holds','id','character varying',true),
    ('waitlist_holds','booking_id','character varying',true),
    ('waitlist_holds','user_id','character varying',true),
    ('waitlist_holds','hold_expires_at','timestamp without time zone',true),
    ('waitlist_holds','created_at','timestamp without time zone',false),
    ('session_waitlists','id','character varying',true),
    ('session_waitlists','booking_id','character varying',true),
    ('session_waitlists','user_id','character varying',true),
    ('session_waitlists','participant_name','character varying',false),
    ('session_waitlists','created_at','timestamp without time zone',false),
    ('scheduling_health_snapshots','id','text',true),
    ('scheduling_health_snapshots','org_id','text',true),
    ('scheduling_health_snapshots','score','integer',true),
    ('scheduling_health_snapshots','utilization_score','integer',true),
    ('scheduling_health_snapshots','revenue_score','integer',true),
    ('scheduling_health_snapshots','attendance_score','integer',true),
    ('scheduling_health_snapshots','retention_score','integer',true),
    ('scheduling_health_snapshots','waitlist_score','integer',true),
    ('scheduling_health_snapshots','label','text',true),
    ('scheduling_health_snapshots','summary','text',false),
    ('scheduling_health_snapshots','created_at','timestamp with time zone',false),
    ('session_performance_scores','id','text',true),
    ('session_performance_scores','booking_id','text',true),
    ('session_performance_scores','org_id','text',true),
    ('session_performance_scores','score','integer',true),
    ('session_performance_scores','utilization_factor','integer',true),
    ('session_performance_scores','revenue_factor','integer',true),
    ('session_performance_scores','attendance_factor','integer',true),
    ('session_performance_scores','waitlist_factor','integer',true),
    ('session_performance_scores','velocity_factor','integer',true),
    ('session_performance_scores','label','text',true),
    ('session_performance_scores','computed_at','timestamp with time zone',false),
    ('scheduling_opportunities','id','text',true),
    ('scheduling_opportunities','org_id','text',true),
    ('scheduling_opportunities','type','text',true),
    ('scheduling_opportunities','priority','text',true),
    ('scheduling_opportunities','title','text',true),
    ('scheduling_opportunities','description','text',false),
    ('scheduling_opportunities','estimated_value_cents','integer',false),
    ('scheduling_opportunities','action_label','text',false),
    ('scheduling_opportunities','action_data','jsonb',false),
    ('scheduling_opportunities','status','text',true),
    ('scheduling_opportunities','created_at','timestamp with time zone',false),
    ('retention_risk_scores','id','text',true),
    ('retention_risk_scores','org_id','text',true),
    ('retention_risk_scores','client_user_id','text',true),
    ('retention_risk_scores','risk_score','integer',true),
    ('retention_risk_scores','risk_level','text',true),
    ('retention_risk_scores','days_since_last_booking','integer',false),
    ('retention_risk_scores','booking_frequency_drop','integer',false),
    ('retention_risk_scores','cancellation_rate','integer',false),
    ('retention_risk_scores','computed_at','timestamp with time zone',false),
    ('fill_campaign_drafts','id','text',true),
    ('fill_campaign_drafts','org_id','text',true),
    ('fill_campaign_drafts','booking_id','text',true),
    ('fill_campaign_drafts','subject','text',false),
    ('fill_campaign_drafts','body','text',false),
    ('fill_campaign_drafts','target_count','integer',false),
    ('fill_campaign_drafts','status','text',true),
    ('fill_campaign_drafts','created_at','timestamp with time zone',false),
    ('fill_campaign_drafts','preview_text','text',false),
    ('fill_campaign_drafts','sms_body','text',false),
    ('fill_campaign_drafts','push_body','text',false),
    ('fill_campaign_drafts','social_caption','text',false),
    ('fill_campaign_drafts','selected_recipient_count','integer',false),
    ('fill_campaign_drafts','recipient_ids','jsonb',false),
    ('fill_campaign_drafts','recipient_summary','jsonb',false),
    ('fill_campaign_drafts','model_used','text',false),
    ('fill_campaign_drafts','generation_version','text',false),
    ('fill_campaign_drafts','generated_at','timestamp with time zone',false),
    ('fill_campaign_submissions','id','text',true),
    ('fill_campaign_submissions','org_id','text',true),
    ('fill_campaign_submissions','booking_id','text',true),
    ('fill_campaign_submissions','draft_id','text',false),
    ('fill_campaign_submissions','action_id','text',false),
    ('fill_campaign_submissions','status','text',true),
    ('fill_campaign_submissions','version','integer',true),
    ('fill_campaign_submissions','parent_submission_id','text',false),
    ('fill_campaign_submissions','subject','text',false),
    ('fill_campaign_submissions','preview_text','text',false),
    ('fill_campaign_submissions','email_body','text',false),
    ('fill_campaign_submissions','sms_body','text',false),
    ('fill_campaign_submissions','push_body','text',false),
    ('fill_campaign_submissions','social_caption','text',false),
    ('fill_campaign_submissions','recipients','jsonb',false),
    ('fill_campaign_submissions','recipient_count','integer',false),
    ('fill_campaign_submissions','recipient_summary','jsonb',false),
    ('fill_campaign_submissions','session_name','text',false),
    ('fill_campaign_submissions','coach_name','text',false),
    ('fill_campaign_submissions','org_name','text',false),
    ('fill_campaign_submissions','open_spots','integer',false),
    ('fill_campaign_submissions','estimated_value_cents','integer',false),
    ('fill_campaign_submissions','fill_probability','text',false),
    ('fill_campaign_submissions','approved_at','timestamp with time zone',false),
    ('fill_campaign_submissions','approved_by','text',false),
    ('fill_campaign_submissions','rejected_at','timestamp with time zone',false),
    ('fill_campaign_submissions','rejection_reason','text',false),
    ('fill_campaign_submissions','rejection_type','text',false),
    ('fill_campaign_submissions','regeneration_requested_at','timestamp with time zone',false),
    ('fill_campaign_submissions','timeline','jsonb',false),
    ('fill_campaign_submissions','analytics','jsonb',false),
    ('fill_campaign_submissions','submitted_at','timestamp with time zone',false),
    ('fill_campaign_submissions','sent_at','timestamp with time zone',false),
    ('fill_campaign_submissions','completed_at','timestamp with time zone',false),
    ('fill_campaign_submissions','created_at','timestamp with time zone',false),
    ('fill_opportunity_scores','id','text',true),
    ('fill_opportunity_scores','org_id','text',true),
    ('fill_opportunity_scores','booking_id','text',true),
    ('fill_opportunity_scores','session_name','text',false),
    ('fill_opportunity_scores','coach_name','text',false),
    ('fill_opportunity_scores','session_start','timestamp with time zone',false),
    ('fill_opportunity_scores','open_spots','integer',false),
    ('fill_opportunity_scores','total_spots','integer',false),
    ('fill_opportunity_scores','session_price_cents','integer',false),
    ('fill_opportunity_scores','utilization_pct','integer',false),
    ('fill_opportunity_scores','revenue_impact','text',false),
    ('fill_opportunity_scores','urgency','text',false),
    ('fill_opportunity_scores','fill_probability','integer',false),
    ('fill_opportunity_scores','overall_priority','integer',false),
    ('fill_opportunity_scores','detection_triggers','jsonb',false),
    ('fill_opportunity_scores','recommendations','jsonb',false),
    ('fill_opportunity_scores','auto_draft_id','text',false),
    ('fill_opportunity_scores','auto_draft_status','text',false),
    ('fill_opportunity_scores','status','text',false),
    ('fill_opportunity_scores','detected_at','timestamp with time zone',false),
    ('fill_opportunity_scores','last_scanned_at','timestamp with time zone',false),
    ('fill_revenue_policies','id','text',true),
    ('fill_revenue_policies','org_id','text',true),
    ('fill_revenue_policies','min_fill_threshold_pct','integer',false),
    ('fill_revenue_policies','min_revenue_cents','integer',false),
    ('fill_revenue_policies','campaign_lead_time_hours','integer',false),
    ('fill_revenue_policies','auto_draft_generation','boolean',false),
    ('fill_revenue_policies','approval_required','boolean',false),
    ('fill_revenue_policies','waitlist_priority','boolean',false),
    ('fill_revenue_policies','enabled','boolean',false),
    ('fill_revenue_policies','updated_at','timestamp with time zone',false),
    ('fill_revenue_policies','created_at','timestamp with time zone',false),
    ('fill_campaign_attributions','id','text',true),
    ('fill_campaign_attributions','org_id','text',true),
    ('fill_campaign_attributions','campaign_submission_id','text',true),
    ('fill_campaign_attributions','booking_id','text',true),
    ('fill_campaign_attributions','participant_id','text',false),
    ('fill_campaign_attributions','user_id','text',true),
    ('fill_campaign_attributions','booking_timestamp','timestamp with time zone',false),
    ('fill_campaign_attributions','hours_since_send','numeric',false),
    ('fill_campaign_attributions','attribution_window','text',false),
    ('fill_campaign_attributions','session_price_cents','integer',false),
    ('fill_campaign_attributions','attributed_revenue_cents','integer',false),
    ('fill_campaign_attributions','created_at','timestamp with time zone',false),
    ('scheduling_recommendation_actions','id','text',true),
    ('scheduling_recommendation_actions','org_id','text',true),
    ('scheduling_recommendation_actions','opportunity_id','text',true),
    ('scheduling_recommendation_actions','opportunity_title','text',true),
    ('scheduling_recommendation_actions','opportunity_type','text',true),
    ('scheduling_recommendation_actions','opportunity_category','text',true),
    ('scheduling_recommendation_actions','action','text',true),
    ('scheduling_recommendation_actions','estimated_value_cents','integer',false),
    ('scheduling_recommendation_actions','notes','text',false),
    ('scheduling_recommendation_actions','user_id','text',false),
    ('scheduling_recommendation_actions','actioned_at','timestamp with time zone',false)
  ) AS contract(table_name,column_name,canonical_type,required_not_null)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull INTO actual_type,actual_not_null
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname=requirement.table_name AND a.attname=requirement.column_name
      AND a.attnum>0 AND NOT a.attisdropped;
    IF actual_type IS NULL OR actual_type <> requirement.canonical_type OR actual_not_null <> requirement.required_not_null THEN
      RAISE EXCEPTION 'Incompatible scheduling schema: %.% contract mismatch', requirement.table_name, requirement.column_name;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE requirement TEXT; source_table TEXT; source_columns TEXT[]; target_table TEXT; target_columns TEXT[]; delete_action "char";
BEGIN
  FOREACH requirement IN ARRAY ARRAY[
    'athlete_scheduling_profiles|user_id|users|id|a',
    'session_recurrence_rules|booking_id|bookings|id|c',
    'waitlist_holds|booking_id|bookings|id|c',
    'waitlist_holds|user_id|users|id|a',
    'session_waitlists|booking_id|bookings|id|c',
    'session_waitlists|user_id|users|id|a'
  ] LOOP
    source_table:=split_part(requirement,'|',1); source_columns:=string_to_array(split_part(requirement,'|',2),',');
    target_table:=split_part(requirement,'|',3); target_columns:=string_to_array(split_part(requirement,'|',4),',');
    delete_action:=split_part(requirement,'|',5)::"char";
    IF NOT EXISTS (SELECT 1 FROM pg_constraint constraint_record
      WHERE constraint_record.contype='f' AND constraint_record.conrelid=source_table::regclass
        AND constraint_record.confrelid=target_table::regclass AND constraint_record.confdeltype=delete_action
        AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[]
          FROM unnest(constraint_record.conkey) WITH ORDINALITY k(attnum,ordinality)
          JOIN pg_attribute a ON a.attrelid=constraint_record.conrelid AND a.attnum=k.attnum)=source_columns
        AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[]
          FROM unnest(constraint_record.confkey) WITH ORDINALITY k(attnum,ordinality)
          JOIN pg_attribute a ON a.attrelid=constraint_record.confrelid AND a.attnum=k.attnum)=target_columns) THEN
      RAISE EXCEPTION 'Incompatible scheduling schema: invalid foreign key on % (%)', source_table, array_to_string(source_columns,',');
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE requirement TEXT; expected_relation TEXT; column_names TEXT[]; actual_count INTEGER;
BEGIN
  FOREACH requirement IN ARRAY ARRAY[
    'athlete_scheduling_profiles|id,user_id,sport,training_level,birth_year,updated_at',
    'session_recurrence_rules|id,booking_id,recurring_group_id,organization_id,frequency,days_of_week,end_date,created_at',
    'waitlist_holds|id,booking_id,user_id,hold_expires_at,created_at',
    'session_waitlists|id,booking_id,user_id,participant_name,created_at',
    'scheduling_health_snapshots|id,org_id,score,utilization_score,revenue_score,attendance_score,retention_score,waitlist_score,label,summary,created_at',
    'session_performance_scores|id,booking_id,org_id,score,utilization_factor,revenue_factor,attendance_factor,waitlist_factor,velocity_factor,label,computed_at',
    'scheduling_opportunities|id,org_id,type,priority,title,description,estimated_value_cents,action_label,action_data,status,created_at',
    'retention_risk_scores|id,org_id,client_user_id,risk_score,risk_level,days_since_last_booking,booking_frequency_drop,cancellation_rate,computed_at',
    'fill_campaign_drafts|id,org_id,booking_id,subject,body,target_count,status,created_at,preview_text,sms_body,push_body,social_caption,selected_recipient_count,recipient_ids,recipient_summary,model_used,generation_version,generated_at',
    'fill_campaign_submissions|id,org_id,booking_id,draft_id,action_id,status,version,parent_submission_id,subject,preview_text,email_body,sms_body,push_body,social_caption,recipients,recipient_count,recipient_summary,session_name,coach_name,org_name,open_spots,estimated_value_cents,fill_probability,approved_at,approved_by,rejected_at,rejection_reason,rejection_type,regeneration_requested_at,timeline,analytics,submitted_at,sent_at,completed_at,created_at',
    'fill_opportunity_scores|id,org_id,booking_id,session_name,coach_name,session_start,open_spots,total_spots,session_price_cents,utilization_pct,revenue_impact,urgency,fill_probability,overall_priority,detection_triggers,recommendations,auto_draft_id,auto_draft_status,status,detected_at,last_scanned_at',
    'fill_revenue_policies|id,org_id,min_fill_threshold_pct,min_revenue_cents,campaign_lead_time_hours,auto_draft_generation,approval_required,waitlist_priority,enabled,updated_at,created_at',
    'fill_campaign_attributions|id,org_id,campaign_submission_id,booking_id,participant_id,user_id,booking_timestamp,hours_since_send,attribution_window,session_price_cents,attributed_revenue_cents,created_at',
    'scheduling_recommendation_actions|id,org_id,opportunity_id,opportunity_title,opportunity_type,opportunity_category,action,estimated_value_cents,notes,user_id,actioned_at'
  ] LOOP
    expected_relation := split_part(requirement,'|',1); column_names := string_to_array(split_part(requirement,'|',2),',');
    SELECT count(*) INTO actual_count FROM information_schema.columns
      WHERE table_schema=current_schema() AND information_schema.columns.table_name=expected_relation
        AND column_name=ANY(column_names);
    IF actual_count <> cardinality(column_names) THEN
      RAISE EXCEPTION 'Incompatible scheduling schema: missing column(s) on %', expected_relation;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE expected_table TEXT;
BEGIN
  FOREACH expected_table IN ARRAY ARRAY[
    'athlete_scheduling_profiles','session_recurrence_rules','waitlist_holds','session_waitlists',
    'scheduling_health_snapshots','session_performance_scores','scheduling_opportunities','retention_risk_scores',
    'fill_campaign_drafts','fill_campaign_submissions','fill_opportunity_scores','fill_revenue_policies',
    'fill_campaign_attributions','scheduling_recommendation_actions'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=expected_table::regclass AND c.contype='p'
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['id']::text[]) THEN
      RAISE EXCEPTION 'Incompatible scheduling schema: %.PRIMARY KEY expected (id)', expected_table;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE requirement TEXT; expected_relation TEXT; columns TEXT[]; require_unique BOOLEAN;
BEGIN
  FOREACH requirement IN ARRAY ARRAY[
    'athlete_scheduling_profiles|user_id|true','session_waitlists|booking_id,user_id|true',
    'fill_opportunity_scores|org_id,booking_id|true','fill_revenue_policies|org_id|true',
    'fill_campaign_attributions|campaign_submission_id,user_id|true',
    'scheduling_health_snapshots|org_id,created_at|false','session_performance_scores|org_id,booking_id|false',
    'scheduling_opportunities|org_id,status,created_at|false','retention_risk_scores|org_id,client_user_id|false',
    'fill_campaign_drafts|org_id,booking_id|false','fill_campaign_submissions|org_id,booking_id|false',
    'fill_campaign_attributions|org_id,booking_id|false','scheduling_recommendation_actions|org_id,opportunity_id|false',
    'session_recurrence_rules|organization_id,booking_id|false','waitlist_holds|booking_id,hold_expires_at|false'
  ] LOOP
    expected_relation:=split_part(requirement,'|',1); columns:=string_to_array(split_part(requirement,'|',2),',');
    require_unique:=split_part(requirement,'|',3)::boolean;
    IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=expected_relation::regclass AND i.indisvalid
      AND i.indisunique=require_unique AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[]
        FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=columns) THEN
      RAISE EXCEPTION 'Incompatible scheduling schema: invalid index on % (%)', expected_relation, array_to_string(columns,',');
    END IF;
  END LOOP;
END $$;
