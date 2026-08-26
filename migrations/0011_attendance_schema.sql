-- Formal ownership for durable Attendance feature state previously created by runtime paths.
CREATE TABLE IF NOT EXISTS attendance_report_recipients (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), org_id VARCHAR NOT NULL,
  attendance_program_id VARCHAR NOT NULL, coach_id VARCHAR, email VARCHAR NOT NULL, name VARCHAR NOT NULL,
  receive_daily BOOLEAN NOT NULL DEFAULT true, receive_weekly BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(attendance_program_id, email)
);
CREATE TABLE IF NOT EXISTS attendance_report_email_history (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), org_id VARCHAR NOT NULL,
  attendance_program_id VARCHAR NOT NULL, recipient_email VARCHAR NOT NULL, report_type VARCHAR NOT NULL,
  period_start DATE, period_end DATE, sent_at TIMESTAMP, status VARCHAR NOT NULL DEFAULT 'sent',
  sendgrid_message_id VARCHAR, error_message TEXT, created_at TIMESTAMP DEFAULT NOW(), sendgrid_status_code INTEGER
);
-- This column was previously added by an import-time runtime repair. Its
-- nullable addition is deterministic and does not reinterpret existing rows.
ALTER TABLE attendance_report_email_history ADD COLUMN IF NOT EXISTS sendgrid_status_code INTEGER;
CREATE TABLE IF NOT EXISTS session_attendance (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), booking_id VARCHAR NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id VARCHAR REFERENCES users(id), participant_name VARCHAR, status VARCHAR NOT NULL DEFAULT 'present',
  marked_by VARCHAR, marked_at TIMESTAMP DEFAULT NOW(), notes TEXT DEFAULT '', organization_id VARCHAR
);
CREATE UNIQUE INDEX IF NOT EXISTS session_attendance_booking_user
  ON session_attendance(booking_id,user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS session_attendance_booking_participant
  ON session_attendance(booking_id,participant_name) WHERE user_id IS NULL AND participant_name IS NOT NULL;

-- Validate all ten Attendance tables, including the seven already owned by the baseline.
DO $$
DECLARE r RECORD; actual_type TEXT; actual_not_null BOOLEAN;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('attendance_programs','id','character varying',true),('attendance_programs','organization_id','character varying',true),('attendance_programs','program_id','character varying',true),('attendance_programs','description','text',false),('attendance_programs','location','character varying',false),('attendance_programs','start_date','character varying',false),('attendance_programs','end_date','character varying',false),('attendance_programs','active','boolean',true),('attendance_programs','created_at','timestamp without time zone',false),('attendance_programs','updated_at','timestamp without time zone',false),
    ('attendance_program_fields','id','character varying',true),('attendance_program_fields','organization_id','character varying',true),('attendance_program_fields','program_id','character varying',true),('attendance_program_fields','field_name','character varying',true),('attendance_program_fields','label','character varying',true),('attendance_program_fields','field_type','character varying',true),('attendance_program_fields','visibility','character varying',true),('attendance_program_fields','display_order','integer',true),('attendance_program_fields','options','jsonb',false),('attendance_program_fields','created_at','timestamp without time zone',false),
    ('attendance_reward_tiers','id','character varying',true),('attendance_reward_tiers','organization_id','character varying',true),('attendance_reward_tiers','program_id','character varying',true),('attendance_reward_tiers','visit_count','integer',true),('attendance_reward_tiers','reward_name','character varying',true),('attendance_reward_tiers','reward_description','text',false),('attendance_reward_tiers','active','boolean',true),('attendance_reward_tiers','created_at','timestamp without time zone',false),
    ('attendance_qr_codes','id','character varying',true),('attendance_qr_codes','organization_id','character varying',true),('attendance_qr_codes','program_id','character varying',true),('attendance_qr_codes','public_slug','character varying',true),('attendance_qr_codes','qr_code_url','text',false),('attendance_qr_codes','created_at','timestamp without time zone',false),
    ('attendance_records','id','character varying',true),('attendance_records','organization_id','character varying',true),('attendance_records','program_id','character varying',true),('attendance_records','athlete_email','character varying',true),('attendance_records','athlete_first_name','character varying',false),('attendance_records','athlete_last_name','character varying',false),('attendance_records','phone','character varying',false),('attendance_records','sport','character varying',false),('attendance_records','position','character varying',false),('attendance_records','school','character varying',false),('attendance_records','grad_year','character varying',false),('attendance_records','team','character varying',false),('attendance_records','age','character varying',false),('attendance_records','extra_fields','jsonb',false),('attendance_records','visit_number','integer',true),('attendance_records','lead_id','character varying',false),('attendance_records','ip_address','character varying',false),('attendance_records','created_at','timestamp without time zone',false),
    ('attendance_rewards_earned','id','character varying',true),('attendance_rewards_earned','organization_id','character varying',true),('attendance_rewards_earned','program_id','character varying',true),('attendance_rewards_earned','tier_id','character varying',true),('attendance_rewards_earned','athlete_email','character varying',true),('attendance_rewards_earned','visit_count_at_earned','integer',true),('attendance_rewards_earned','notification_sent_at','timestamp without time zone',false),('attendance_rewards_earned','redeemed_at','timestamp without time zone',false),('attendance_rewards_earned','created_at','timestamp without time zone',false),
    ('attendance_email_history','id','character varying',true),('attendance_email_history','organization_id','character varying',true),('attendance_email_history','program_id','character varying',true),('attendance_email_history','athlete_email','character varying',true),('attendance_email_history','email_type','character varying',true),('attendance_email_history','subject','character varying',false),('attendance_email_history','status','character varying',true),('attendance_email_history','error_message','text',false),('attendance_email_history','created_at','timestamp without time zone',false),
    ('attendance_report_recipients','id','character varying',true),('attendance_report_recipients','org_id','character varying',true),('attendance_report_recipients','attendance_program_id','character varying',true),('attendance_report_recipients','coach_id','character varying',false),('attendance_report_recipients','email','character varying',true),('attendance_report_recipients','name','character varying',true),('attendance_report_recipients','receive_daily','boolean',true),('attendance_report_recipients','receive_weekly','boolean',true),('attendance_report_recipients','active','boolean',true),('attendance_report_recipients','created_at','timestamp without time zone',false),('attendance_report_recipients','updated_at','timestamp without time zone',false),
    ('attendance_report_email_history','id','character varying',true),('attendance_report_email_history','org_id','character varying',true),('attendance_report_email_history','attendance_program_id','character varying',true),('attendance_report_email_history','recipient_email','character varying',true),('attendance_report_email_history','report_type','character varying',true),('attendance_report_email_history','period_start','date',false),('attendance_report_email_history','period_end','date',false),('attendance_report_email_history','sent_at','timestamp without time zone',false),('attendance_report_email_history','status','character varying',true),('attendance_report_email_history','sendgrid_message_id','character varying',false),('attendance_report_email_history','error_message','text',false),('attendance_report_email_history','created_at','timestamp without time zone',false),('attendance_report_email_history','sendgrid_status_code','integer',false),
    ('session_attendance','id','character varying',true),('session_attendance','booking_id','character varying',true),('session_attendance','user_id','character varying',false),('session_attendance','participant_name','character varying',false),('session_attendance','status','character varying',true),('session_attendance','marked_by','character varying',false),('session_attendance','marked_at','timestamp without time zone',false),('session_attendance','notes','text',false),('session_attendance','organization_id','character varying',false)
  ) AS required(table_name,column_name,type_name,not_null)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull INTO actual_type,actual_not_null
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname=r.table_name AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped;
    IF actual_type IS NULL THEN RAISE EXCEPTION '% missing column %',r.table_name,r.column_name; END IF;
    IF actual_type<>r.type_name OR actual_not_null<>r.not_null THEN RAISE EXCEPTION 'contract mismatch %.%',r.table_name,r.column_name; END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['attendance_programs','attendance_program_fields','attendance_reward_tiers','attendance_qr_codes','attendance_records','attendance_rewards_earned','attendance_email_history','attendance_report_recipients','attendance_report_email_history','session_attendance']) table_name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND t.relname=r.table_name AND c.contype='p' AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=t.oid AND attname='id')]::smallint[]) THEN RAISE EXCEPTION '% invalid PRIMARY KEY',r.table_name; END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('attendance_programs','{program_id}'),('attendance_qr_codes','{program_id}'),('attendance_qr_codes','{public_slug}'),('attendance_report_recipients','{attendance_program_id,email}')) AS required(table_name,key_columns)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND t.relname=r.table_name AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=r.key_columns) THEN RAISE EXCEPTION '% invalid unique scope %',r.table_name,r.key_columns; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND t.relname='session_attendance' AND i.indisunique AND i.indisvalid AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)='{booking_id,user_id}' AND pg_get_expr(i.indpred,i.indrelid)='(user_id IS NOT NULL)') THEN RAISE EXCEPTION 'session_attendance invalid user identity index'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND t.relname='session_attendance' AND i.indisunique AND i.indisvalid AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)='{booking_id,participant_name}' AND pg_get_expr(i.indpred,i.indrelid)='((user_id IS NULL) AND (participant_name IS NOT NULL))') THEN RAISE EXCEPTION 'session_attendance invalid participant identity index'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace n ON n.oid=s.relnamespace WHERE n.nspname=current_schema() AND s.relname='session_attendance' AND t.relname='bookings' AND c.contype='f' AND c.confdeltype='c' AND c.confupdtype='a' AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=t.oid AND attname='id')]::smallint[] AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=s.oid AND a.attnum=k.attnum)='{booking_id}') THEN RAISE EXCEPTION 'session_attendance invalid booking foreign key'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace n ON n.oid=s.relnamespace WHERE n.nspname=current_schema() AND s.relname='session_attendance' AND t.relname='users' AND c.contype='f' AND c.confdeltype='a' AND c.confupdtype='a' AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=t.oid AND attname='id')]::smallint[] AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=s.oid AND a.attnum=k.attnum)='{user_id}') THEN RAISE EXCEPTION 'session_attendance invalid user foreign key'; END IF;
END $$;

DO $$
DECLARE r RECORD; actual_default TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('attendance_programs','id','gen_random_uuid()'),('attendance_programs','active','true'),('attendance_programs','created_at','now()'),('attendance_programs','updated_at','now()'),
    ('attendance_program_fields','id','gen_random_uuid()'),('attendance_program_fields','field_type','''text'''),('attendance_program_fields','visibility','''required'''),('attendance_program_fields','display_order','0'),('attendance_program_fields','options','''[]'''),('attendance_program_fields','created_at','now()'),
    ('attendance_reward_tiers','id','gen_random_uuid()'),('attendance_reward_tiers','active','true'),('attendance_reward_tiers','created_at','now()'),
    ('attendance_qr_codes','id','gen_random_uuid()'),('attendance_qr_codes','created_at','now()'),
    ('attendance_records','id','gen_random_uuid()'),('attendance_records','extra_fields','''{}'''),('attendance_records','visit_number','1'),('attendance_records','created_at','now()'),
    ('attendance_rewards_earned','id','gen_random_uuid()'),('attendance_rewards_earned','created_at','now()'),
    ('attendance_email_history','id','gen_random_uuid()'),('attendance_email_history','status','''sent'''),('attendance_email_history','created_at','now()'),
    ('attendance_report_recipients','id','gen_random_uuid()'),('attendance_report_recipients','receive_daily','true'),('attendance_report_recipients','receive_weekly','true'),('attendance_report_recipients','active','true'),('attendance_report_recipients','created_at','now()'),('attendance_report_recipients','updated_at','now()'),
    ('attendance_report_email_history','id','gen_random_uuid()'),('attendance_report_email_history','status','''sent'''),('attendance_report_email_history','created_at','now()'),
    ('session_attendance','id','gen_random_uuid()'),('session_attendance','status','''present'''),('session_attendance','marked_at','now()'),('session_attendance','notes','''''')
  ) AS required(table_name,column_name,expected_default)
  LOOP
    SELECT lower(regexp_replace(regexp_replace(column_default,'::(character varying|text|jsonb|boolean|integer|timestamp without time zone)','', 'g'),'\s','','g')) INTO actual_default
    FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=r.table_name AND column_name=r.column_name;
    IF actual_default IS DISTINCT FROM r.expected_default THEN RAISE EXCEPTION 'default contract mismatch %.%',r.table_name,r.column_name; END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND column_default IS NOT NULL
      AND table_name=ANY(ARRAY['attendance_programs','attendance_program_fields','attendance_reward_tiers','attendance_qr_codes','attendance_records','attendance_rewards_earned','attendance_email_history','attendance_report_recipients','attendance_report_email_history','session_attendance'])
      AND table_name||'.'||column_name<>ALL(ARRAY[
        'attendance_programs.id','attendance_programs.active','attendance_programs.created_at','attendance_programs.updated_at',
        'attendance_program_fields.id','attendance_program_fields.field_type','attendance_program_fields.visibility','attendance_program_fields.display_order','attendance_program_fields.options','attendance_program_fields.created_at',
        'attendance_reward_tiers.id','attendance_reward_tiers.active','attendance_reward_tiers.created_at','attendance_qr_codes.id','attendance_qr_codes.created_at',
        'attendance_records.id','attendance_records.extra_fields','attendance_records.visit_number','attendance_records.created_at','attendance_rewards_earned.id','attendance_rewards_earned.created_at',
        'attendance_email_history.id','attendance_email_history.status','attendance_email_history.created_at','attendance_report_recipients.id','attendance_report_recipients.receive_daily','attendance_report_recipients.receive_weekly','attendance_report_recipients.active','attendance_report_recipients.created_at','attendance_report_recipients.updated_at',
        'attendance_report_email_history.id','attendance_report_email_history.status','attendance_report_email_history.created_at','session_attendance.id','session_attendance.status','session_attendance.marked_at','session_attendance.notes'
      ])
  ) THEN RAISE EXCEPTION 'unexpected Attendance column default'; END IF;
END $$;
