-- Google Calendar tokens are upserted with
--   INSERT INTO connector_tokens ... ON CONFLICT (org_id, connector) DO UPDATE
-- but the table shipped with only a primary key, so Postgres rejected every
-- token exchange with 42P10 ("no unique or exclusion constraint matching the
-- ON CONFLICT specification"). This migration makes (org_id, connector) unique.
--
-- Idempotent and safe on a populated database: if duplicate rows already exist
-- for the same (org_id, connector), only the newest row (by updated_at, then
-- created_at, then id) is kept. These are OAuth tokens, so the newest row is
-- the only one that can still be valid.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM connector_tokens
    GROUP BY org_id, connector
    HAVING count(*) > 1
  ) THEN
    DELETE FROM connector_tokens
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               row_number() OVER (
                 PARTITION BY org_id, connector
                 ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
               ) AS rn
        FROM connector_tokens
      ) ranked
      WHERE ranked.rn > 1
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS connector_tokens_org_connector_unique
  ON connector_tokens (org_id, connector);
