-- 0023 — attendance report send uniqueness
--
-- server/attendance-report-cron.ts decided "did we already send this report?"
-- with a SELECT, then sent, then INSERTed the history row. Two instances
-- reaching 17:00 ET together both read "no" and both sent. The code now
-- RESERVES the history row before the send (INSERT ... ON CONFLICT DO NOTHING
-- RETURNING id) and only sends when a row came back. That reservation is only
-- a guard if the database enforces uniqueness — this migration adds it.
--
-- Safety:
--   * Only attendance_report_email_history is touched. These are LOG rows, not
--     money: no invoice, no payment, no booking, no athlete data.
--   * The DELETE removes only rows that are exact duplicates under the index
--     key, keeping the OLDEST row of each group (the send that actually
--     happened first). Rows with a NULL period_start are left alone: a NULL
--     never conflicts in a unique index, so they cannot block the CREATE.
--   * The index is PARTIAL — WHERE status IN ('sending','sent'). 'failed' rows
--     stay out of it, so a real failure can be retried, and any number of
--     failures for the same period can be recorded.
--   * CREATE UNIQUE INDEX IF NOT EXISTS is a no-op on a database that already
--     has it, so re-running is safe.

-- 1. Collapse exact duplicates so the unique index can be created.
DELETE FROM attendance_report_email_history a
USING attendance_report_email_history b
WHERE a.status IN ('sending', 'sent')
  AND b.status IN ('sending', 'sent')
  AND a.org_id = b.org_id
  AND a.attendance_program_id = b.attendance_program_id
  AND a.recipient_email = b.recipient_email
  AND a.report_type = b.report_type
  AND a.period_start IS NOT NULL
  AND b.period_start IS NOT NULL
  AND a.period_start = b.period_start
  AND (COALESCE(a.created_at, TIMESTAMP 'epoch'), a.id)
    > (COALESCE(b.created_at, TIMESTAMP 'epoch'), b.id);

-- 2. Enforce one live send per (org, program, recipient, report type, period).
CREATE UNIQUE INDEX IF NOT EXISTS attendance_report_email_history_scheduled_send
  ON attendance_report_email_history
    (org_id, attendance_program_id, recipient_email, report_type, period_start)
  WHERE status IN ('sending', 'sent');

-- 3. Prove the guard exists, so a partial apply fails loudly instead of
--    leaving the reservation silently unenforced.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_class ix ON ix.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'attendance_report_email_history'
      AND ix.relname = 'attendance_report_email_history_scheduled_send'
      AND i.indisunique
      AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'attendance_report_email_history is missing its scheduled-send uniqueness guard';
  END IF;
END $$;
