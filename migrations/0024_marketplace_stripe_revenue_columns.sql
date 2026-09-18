-- Marketplace Stripe webhook persistence.
--
-- POST /api/stripe/marketplace-webhook has always written `currency`,
-- `stripe_event_id` and `metadata` to agent_revenue_events, and
-- `royalty_rate`, `royalty_amount` and `status` to royalty_distributions.
-- None of those columns existed in shared/schema.ts, so Drizzle silently
-- dropped the keys: revenue rows were stored without their Stripe event id
-- (no idempotency — a redelivered event created a duplicate row) and royalty
-- rows were stored with no rate and no amount.
--
-- These columns make the write real. All additions are nullable/defaulted so
-- the migration is safe on tables that already hold rows.

ALTER TABLE agent_revenue_events
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'usd';
ALTER TABLE agent_revenue_events
  ADD COLUMN IF NOT EXISTS stripe_event_id TEXT;
ALTER TABLE agent_revenue_events
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Idempotency for webhook-sourced rows. Partial so that internally generated
-- revenue events (which carry no Stripe event) are not forced to be unique.
CREATE UNIQUE INDEX IF NOT EXISTS agent_revenue_events_stripe_event_id_unique
  ON agent_revenue_events (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

ALTER TABLE royalty_distributions
  ADD COLUMN IF NOT EXISTS royalty_rate DOUBLE PRECISION;
ALTER TABLE royalty_distributions
  ADD COLUMN IF NOT EXISTS royalty_amount_cents INTEGER;
ALTER TABLE royalty_distributions
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
