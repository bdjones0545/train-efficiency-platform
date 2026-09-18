-- Belt-and-braces uniqueness for money-moving rows.
--
-- The primary defense against double credits / double redemptions is the
-- per-key advisory transaction lock in server/storage.ts (creditWallet,
-- executeRedemption, requestCashout). These partial unique indexes are the
-- belt: they make a duplicate impossible even for a code path that bypasses
-- the lock.
--
-- This chain runs at every production boot and aborts boot on failure, so the
-- migration must never fail on a database that already contains duplicate
-- rows. Each index is created only when its table holds no duplicates; when
-- duplicates exist the index is skipped with a NOTICE and the money rows are
-- left untouched for a human to reconcile. The migration is idempotent: a
-- later boot creates any index that was skipped once the duplicates are gone
-- (re-run the statements by hand or ship a follow-up migration).

DO $$
DECLARE duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count FROM (
    SELECT stripe_payment_intent_id FROM wallet_transactions
    WHERE stripe_payment_intent_id IS NOT NULL
    GROUP BY stripe_payment_intent_id HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE NOTICE '[0022] skipping wallet_transactions_stripe_payment_intent_id_unique: % duplicated stripe_payment_intent_id value(s) exist; reconcile before creating the index', duplicate_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_stripe_payment_intent_id_unique
      ON wallet_transactions (stripe_payment_intent_id)
      WHERE stripe_payment_intent_id IS NOT NULL;
  END IF;

  SELECT count(*) INTO duplicate_count FROM (
    SELECT stripe_session_id FROM wallet_transactions
    WHERE stripe_session_id IS NOT NULL
    GROUP BY stripe_session_id HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE NOTICE '[0022] skipping wallet_transactions_stripe_session_id_unique: % duplicated stripe_session_id value(s) exist; reconcile before creating the index', duplicate_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_stripe_session_id_unique
      ON wallet_transactions (stripe_session_id)
      WHERE stripe_session_id IS NOT NULL;
  END IF;

  SELECT count(*) INTO duplicate_count FROM (
    SELECT booking_id FROM redemptions
    GROUP BY booking_id HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE NOTICE '[0022] skipping redemptions_booking_id_unique: % booking(s) have more than one redemption row; reconcile before creating the index', duplicate_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS redemptions_booking_id_unique
      ON redemptions (booking_id);
  END IF;
END $$;
