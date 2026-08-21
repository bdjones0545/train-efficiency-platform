---
name: AgentMail Provider Contract
description: All critical invariants for the AgentMail integration — provider API contract, webhook auth, effect log state machine, migration patterns, and replay protection.
---

## Provider API Contract
- `event_type` not `type` in webhook payload
- `event.message` not `event.email` for message data
- `to` is an ARRAY in send requests
- `inbox_id` not `id` for inbox identification
- `client_id` provides idempotency on sends
- Webhook auth = `Authorization: Bearer <secret>` header (Svix, not HMAC)
- Svix is unverified from AgentMail docs — use their actual delivery mechanism

## Outbound API Paths
- Send: `POST /v0/inboxes/{inbox_id}/messages/send`
- Reply: `POST /v0/inboxes/{inbox_id}/messages/{message_id}/reply`
- Inbox must be resolved via `getActiveOwnershipRow(orgId, role)` first

## Webhook Signature Verification (`agentmail-svix.ts`)
- HMAC-SHA256 over `"svix-id.svix-timestamp.rawBodyUtf8"`
- Signing key = base64-decode of part after "whsec_" in the secret
- Strict timestamp: `/^\d+$/.test(msgTimestamp)` — rejects trailing junk, decimals, whitespace, empty, negative, hex
- Timestamp range check: `0 ≤ ts ≤ 9_999_999_999` AND `|age| ≤ 300s`
- NO unsigned bypass mode in any environment
- Missing `AGENTMAIL_WEBHOOK_SECRET` → 503 (not allow)

## Replay Protection (`agentmail_svix_deliveries` table)
- After Svix verification succeeds, claim the svix-id: `INSERT ON CONFLICT DO NOTHING RETURNING svix_id`
- Returns row = new delivery (proceed); no row = duplicate (return 200 `{duplicate:true}`)
- Fail open on DB error (return true) — don't drop legitimate deliveries
- Prune inline (best-effort) entries older than 10 min

## Reply Route Contract (`POST /api/agentmail/reply`)
- Requires `replyToMessageId` (provider message_id of the message being replied to)
- `threadId` is OPTIONAL (audit log only)
- Passing only `threadId` would silently fall back to new-message send — FORBIDDEN
- Route validates `!replyToMessageId` and returns 400 with explanation

## Effect Log State Machine (`agentmail_effect_log`)
- Columns: `id`, `inbound_id`, `effect_type`, `status` (pending|completed|failed), `claimed_at`, `completed_at` (nullable)
- `completed_at` has NO DEFAULT (null until fn() succeeds)
- State: pending → completed (permanent) or failed (retryable)
- Claim: `INSERT ... status='pending', claimed_at=NOW() ON CONFLICT DO UPDATE SET status='pending', claimed_at=NOW() WHERE status='failed' OR (status='pending' AND claimed_at < NOW()-'5min')`
- Completed slots: NEVER reclaimed (DO UPDATE WHERE clause prevents)
- Failed slots: reclaimed on retry
- Fresh pending (< 5 min): NOT reclaimed (concurrent worker protection)
- Stale pending (> 5 min): reclaimed (crash recovery)
- After fn() success: UPDATE status='completed', completed_at=NOW()
- After fn() failure: UPDATE status='failed' then re-throw (so inbound message also fails)
- `software_task` effect: catches ONLY 42P01 (undefined_table) as intentional no-op; all other errors re-throw

## Migration Pattern (`agentmail-migration.ts`)

### execDDL SAVEPOINT Pattern — CRITICAL
PostgreSQL marks the transaction ABORTED on ANY error, even when JavaScript catches it.
Catching `42710` (duplicate constraint) without SAVEPOINT leaves the transaction aborted —
every subsequent SQL fails with `25P02`.

The ONLY correct pattern for idempotent DDL inside a transaction:
```typescript
SAVEPOINT sp_N;
-- DDL statement (may error)
-- On success: RELEASE SAVEPOINT sp_N
-- On failure: ROLLBACK TO SAVEPOINT sp_N; RELEASE SAVEPOINT sp_N; check benign code
```

`execDDL(tx, stmt)` implements this pattern. NEVER use bare try/catch without SAVEPOINT.

### Benign DDL codes (safely ignorable via SAVEPOINT pattern):
- `42710` — duplicate_object (constraint/index already exists)
- `42701` — duplicate_column (ADD COLUMN IF NOT EXISTS belt-and-suspenders)
- `0A000` — feature_not_supported (DROP NOT NULL on already-nullable)
- `42703` — undefined_column (DROP NOT NULL on missing column)

### execDDL must ALWAYS receive `tx` not `db`
- On fresh DB, tables created inside `tx` are invisible to the global pool
- Every ALTER TABLE inside `_runDDL` must go through `execDDL(tx, stmt)`
- Large CREATE TABLE blocks can use `tx.execute(sql\`...\`)` directly

### Advisory lock
- `pg_advisory_xact_lock(8675309999001::bigint)` — transaction-scoped, auto-released on commit/rollback
- Inside `db.transaction(async (tx) => { await tx.execute(sql\`SELECT pg_advisory_xact_lock(...)\`) })`

## Database Tables (migration-managed)
1. `agent_mail_inbound_messages` — inbound message log with processing state machine
2. `org_agentmail_inboxes` — ownership registry (UNIQUE on org+role, email, username; partial index on provider_inbox_id)
3. `agent_mail_messages` — outbound audit log
4. `agentmail_effect_log` — downstream effect idempotency ledger (state machine)
5. `agentmail_svix_deliveries` — replay protection ledger (svix_id PRIMARY KEY)
