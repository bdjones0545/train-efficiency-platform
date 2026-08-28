-- Formal ownership for TrainEfficiency's global public Book Funnel.
-- Existing runtime-created rows are preserved; incompatible same-name schema
-- fails transactionally instead of being silently repaired or adopted.

CREATE TABLE IF NOT EXISTS book_funnel_leads (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'book_landing',
  amazon_clicked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  bonus_email_sent_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS book_funnel_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id VARCHAR REFERENCES book_funnel_leads(id) ON DELETE SET NULL,
  email TEXT,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS book_receipt_submissions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id VARCHAR REFERENCES book_funnel_leads(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  receipt_file_url TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  uploaded_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  promo_code TEXT,
  promo_code_generated_at TIMESTAMP,
  promo_code_redeemed_at TIMESTAMP,
  trainchat_account_email TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  fbp TEXT,
  fbc TEXT,
  confirmation_email_sent_at TIMESTAMP
);

-- Deterministic additive adoption for tables created by the former runtime
-- initializer. These columns were always nullable and require no fabricated data.
ALTER TABLE book_funnel_leads ADD COLUMN IF NOT EXISTS bonus_email_sent_at TIMESTAMP;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS promo_code_generated_at TIMESTAMP;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS promo_code_redeemed_at TIMESTAMP;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS trainchat_account_email TEXT;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS utm_content TEXT;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS utm_term TEXT;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS fbp TEXT;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS fbc TEXT;
ALTER TABLE book_receipt_submissions ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMP;

-- A historical per-code uniqueness rule conflicts with the established static
-- TRAINCHAT code. Remove only the exact legacy single-column constraint; reject
-- any ambiguous same-name constraint rather than dropping it blindly.
DO $$
DECLARE legacy RECORD;
BEGIN
  SELECT c.contype,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)::text[] columns
  INTO legacy
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname=current_schema() AND t.relname='book_receipt_submissions'
    AND c.conname='book_receipt_submissions_promo_code_key';
  IF FOUND THEN
    IF legacy.contype<>'u' OR legacy.columns<>ARRAY['promo_code']::text[] THEN
      RAISE EXCEPTION 'Book Funnel legacy promo constraint is ambiguous';
    END IF;
    ALTER TABLE book_receipt_submissions DROP CONSTRAINT book_receipt_submissions_promo_code_key;
  END IF;
END $$;

DO $$
DECLARE expected RECORD; actual RECORD;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('book_funnel_leads','id','character varying',true,'(gen_random_uuid())::text'),
    ('book_funnel_leads','first_name','text',true,NULL),('book_funnel_leads','last_name','text',false,NULL),
    ('book_funnel_leads','email','text',true,NULL),('book_funnel_leads','source','text',false,'''book_landing''::text'),
    ('book_funnel_leads','amazon_clicked_at','timestamp without time zone',false,NULL),
    ('book_funnel_leads','created_at','timestamp without time zone',false,'now()'),
    ('book_funnel_leads','updated_at','timestamp without time zone',false,'now()'),
    ('book_funnel_leads','bonus_email_sent_at','timestamp without time zone',false,NULL),
    ('book_funnel_events','id','character varying',true,'(gen_random_uuid())::text'),
    ('book_funnel_events','lead_id','character varying',false,NULL),('book_funnel_events','email','text',false,NULL),
    ('book_funnel_events','event_type','text',true,NULL),('book_funnel_events','metadata','jsonb',false,'''{}''::jsonb'),
    ('book_funnel_events','created_at','timestamp without time zone',false,'now()'),
    ('book_receipt_submissions','id','character varying',true,'(gen_random_uuid())::text'),
    ('book_receipt_submissions','lead_id','character varying',false,NULL),('book_receipt_submissions','email','text',true,NULL),
    ('book_receipt_submissions','receipt_file_url','text',true,NULL),('book_receipt_submissions','original_filename','text',true,NULL),
    ('book_receipt_submissions','mime_type','text',true,NULL),('book_receipt_submissions','file_size','integer',true,NULL),
    ('book_receipt_submissions','status','text',true,'''pending_review''::text'),
    ('book_receipt_submissions','uploaded_at','timestamp without time zone',false,'now()'),
    ('book_receipt_submissions','created_at','timestamp without time zone',false,'now()'),
    ('book_receipt_submissions','updated_at','timestamp without time zone',false,'now()'),
    ('book_receipt_submissions','promo_code','text',false,NULL),
    ('book_receipt_submissions','promo_code_generated_at','timestamp without time zone',false,NULL),
    ('book_receipt_submissions','promo_code_redeemed_at','timestamp without time zone',false,NULL),
    ('book_receipt_submissions','trainchat_account_email','text',false,NULL),
    ('book_receipt_submissions','utm_source','text',false,NULL),('book_receipt_submissions','utm_medium','text',false,NULL),
    ('book_receipt_submissions','utm_campaign','text',false,NULL),('book_receipt_submissions','utm_content','text',false,NULL),
    ('book_receipt_submissions','utm_term','text',false,NULL),('book_receipt_submissions','fbp','text',false,NULL),
    ('book_receipt_submissions','fbc','text',false,NULL),
    ('book_receipt_submissions','confirmation_email_sent_at','timestamp without time zone',false,NULL)
  ) e(table_name,column_name,canonical_type,is_not_null,canonical_default)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid) column_default INTO actual
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=expected.column_name
      AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND t.relname=expected.table_name;
    IF NOT FOUND OR actual.data_type<>expected.canonical_type OR actual.attnotnull<>expected.is_not_null OR
      (expected.canonical_default IS NULL AND actual.column_default IS NOT NULL) OR
      (expected.canonical_default IS NOT NULL AND COALESCE(actual.column_default,'') <> expected.canonical_default)
    THEN RAISE EXCEPTION 'Book Funnel column contract mismatch %.%',expected.table_name,expected.column_name; END IF;
  END LOOP;

  FOR expected IN SELECT unnest(ARRAY['book_funnel_leads','book_funnel_events','book_receipt_submissions']) table_name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=current_schema() AND t.relname=expected.table_name AND c.contype='p'
      AND (SELECT array_agg(a.attname ORDER BY k.ord)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['id']::text[])
    THEN RAISE EXCEPTION 'Book Funnel primary key mismatch %',expected.table_name; END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='book_funnel_leads' AND i.indisunique AND i.indisvalid
      AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indexprs IS NULL AND i.indpred IS NULL
      AND (SELECT array_agg(a.attname ORDER BY k.ord)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['email']::text[])
  THEN RAISE EXCEPTION 'Book Funnel unique email contract mismatch'; END IF;

  FOR expected IN SELECT unnest(ARRAY['book_funnel_events','book_receipt_submissions']) table_name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_class ft ON ft.oid=c.confrelid WHERE n.nspname=current_schema() AND t.relname=expected.table_name
      AND c.contype='f' AND ft.relname='book_funnel_leads' AND c.confdeltype='n' AND c.confupdtype='a'
      AND (SELECT array_agg(a.attname ORDER BY k.ord)::text[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['lead_id']::text[]
      AND (SELECT array_agg(a.attname ORDER BY k.ord)::text[] FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=ft.oid AND a.attnum=k.attnum)=ARRAY['id']::text[])
    THEN RAISE EXCEPTION 'Book Funnel foreign key mismatch %',expected.table_name; END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='book_receipt_submissions' AND i.indisunique
      AND (SELECT array_agg(a.attname ORDER BY k.ord)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['promo_code']::text[])
  THEN RAISE EXCEPTION 'Book Funnel promo code must not be unique'; END IF;
END $$;
