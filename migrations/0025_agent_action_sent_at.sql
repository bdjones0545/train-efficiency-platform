-- Delivery marker for agent_actions.
--
-- agent_actions.status = 'sent' was written by the level-3 auto-pilot without any
-- provider call, so status alone cannot be trusted to mean "a message left the
-- system". sent_at is written only by a send path that got a provider result, and
-- every consumer that needs real delivery (auto follow-up eligibility, auto-pilot
-- dashboard counts) requires sent_at IS NOT NULL.
--
-- Backfill is deliberately omitted: no evidence exists for which historic
-- 'sent' rows were really delivered, and inventing a timestamp would recreate the
-- defect this column exists to prevent. Rows keep sent_at NULL until a real send
-- sets it.

ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP;

DO $$
DECLARE actual RECORD;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull AS is_not_null,
         pg_get_expr(d.adbin, d.adrelid) AS column_default
    INTO actual
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'sent_at' AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
   WHERE n.nspname = current_schema() AND t.relname = 'agent_actions';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_actions.sent_at missing after migration';
  END IF;
  IF actual.data_type <> 'timestamp without time zone' THEN
    RAISE EXCEPTION 'agent_actions.sent_at type mismatch: %', actual.data_type;
  END IF;
  IF actual.is_not_null THEN
    RAISE EXCEPTION 'agent_actions.sent_at must stay nullable — NULL means "never delivered"';
  END IF;
  IF actual.column_default IS NOT NULL THEN
    RAISE EXCEPTION 'agent_actions.sent_at must have no default — only a real send may set it';
  END IF;
END $$;
