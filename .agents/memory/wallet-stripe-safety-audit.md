---
name: Wallet / Stripe Final Safety Audit
description: 8-item safety audit of the wallet / Stripe credit path — race conditions, idempotency, dead-letter, reconciliation, test-mode separation.
---

## Rule
`creditWallet` is now idempotent at the DB level. Do NOT add application-level pre-checks before calling it — they create a TOCTOU race and are now redundant.

**Why:** `wallet_transactions` has unique partial indexes on `stripe_payment_intent_id` and `stripe_session_id` (both WHERE NOT NULL). `creditWallet` uses `onConflictDoNothing()` + returns the existing record on conflict. The balance increment only runs when the insert succeeds, so no double-credit is possible even under concurrent calls.

**How to apply:** Any new code path that credits a wallet should call `storage.creditWallet(...)` directly; no prior `getWalletTransactionByStripe*` check is needed.

## Schema Changes (all landed in DB and schema.ts)
- `wallet_transactions.livemode` — BOOLEAN NOT NULL DEFAULT false — tracks test vs live Stripe traffic at the transaction level.
- `UNIQUE INDEX wallet_txns_uniq_pi_id ON wallet_transactions(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL`
- `UNIQUE INDEX wallet_txns_uniq_session_id ON wallet_transactions(stripe_session_id) WHERE stripe_session_id IS NOT NULL`

## creditWallet Signature (storage.ts)
```ts
creditWallet(userId, amountCents, description, stripeSessionId?, stripePaymentIntentId?, stripeChargeId?, currency?, paymentStatus?, livemode?): Promise<WalletTransaction>
```
- Throws if `amountCents <= 0` (positive guard).
- Returns existing record on conflict (idempotent).
- Balance only updated if insert succeeds.

## Dead-letter (writeDeadLetterForFailedCredit)
Now includes `userId`, `sessionId`, `currency` in payload — enables the retry cron to actually re-execute the credit. `clientId` column is also set for dashboard filtering.

## Retry Cron (financial-event-retry-cron.ts)
Added `stripe_webhook` case in `replayFinancialEvent`. Requires `userId` + `amountCents > 0` in payload. Checks for existing transaction before crediting (belt-and-suspenders with DB unique index).

## Admin Endpoints Added
- `GET /api/admin/billing/balance-integrity` — compares stored `balance_cents` to `SUM(wallet_transactions)` per user; returns drifters + summary.
- `POST /api/admin/billing/balance-integrity/repair` — fixes drift by setting `balance_cents = computed`; supports `dryRun:true`.

## Audit Item Status
1. Race condition double-credit — **FIXED** (DB unique indexes + onConflictDoNothing)
2. Stable idempotency keys — **FIXED** (DB unique indexes are the keys)
3. Consistent field storage — **FIXED** (livemode, userId in dead-letter)
4. Dead-letter records — **FIXED** (userId/sessionId in payload, stripe_webhook retry handler)
5. Admin manual repair — **PRE-EXISTING** (reconcile + sync-audit + sync-repair endpoints)
6. Balance vs SUM reconciliation — **FIXED** (new balance-integrity endpoints)
7. NULL/negative/duplicate handling — **FIXED** (amountCents > 0 guard, COALESCE from prior session)
8. Test/live mode separation — **FIXED** (livemode column on wallet_transactions)
