-- ── connector_tokens: one token row per (org_id, connector) ──────────────────
--
-- server/connectors/google-calendar.ts stores Google OAuth tokens with
--
--   INSERT INTO connector_tokens (...) ... ON CONFLICT (org_id, connector) DO UPDATE ...
--
-- but the only unique index on connector_tokens was the primary key on (id).
-- Postgres infers an ON CONFLICT target from a unique index, not from column
-- names, so every call raised 42P10 ("there is no unique or exclusion
-- constraint matching the ON CONFLICT specification") — including the first
-- insert into an empty table. No Google Calendar token was ever stored.
--
-- This migration collapses any pre-existing duplicates (keeping the most
-- recently updated row per org+connector, which holds the freshest access and
-- refresh tokens) and installs the unique index the upsert has always assumed.

LOCK TABLE connector_tokens IN ACCESS EXCLUSIVE MODE;

DELETE FROM connector_tokens stale
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, connector
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
         ) AS duplicate_position
    FROM connector_tokens
) ranked
WHERE stale.id = ranked.id
  AND ranked.duplicate_position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS connector_tokens_org_connector_unique
  ON connector_tokens (org_id, connector);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index definition
    JOIN pg_class relation ON relation.oid = definition.indrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = current_schema()
      AND relation.relname = 'connector_tokens'
      AND definition.indisunique
      AND definition.indpred IS NULL
      AND ARRAY(
        SELECT attribute.attname::text
        FROM unnest(definition.indkey) WITH ORDINALITY key(attribute_number, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = definition.indrelid
         AND attribute.attnum = key.attribute_number
        ORDER BY key.ordinality
      ) = ARRAY['org_id', 'connector']::text[]
  ) THEN
    RAISE EXCEPTION 'connector_tokens migration blocked: (org_id, connector) uniqueness was not established';
  END IF;
END
$$;
